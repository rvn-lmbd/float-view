import { RowKey } from '../../lib/parse/types';
import { parse } from '../../lib/parse';
import type { WorkerCommand, WorkerCommandDef, Renderer } from './types';
import { VideoFileWriter, VideoFileManager } from './files';
import { fatal, log, postUpdateMessage } from './messaging';
import { interpolate, VideoFrameData, VideoSegmentManager } from './data';
import { createRenderer } from './render';

postMessage({ type: 'log', message: 'Renderer worker started.' });

const images: Record<string, ImageBitmap> = {};
const segmentManager = new VideoSegmentManager();

let started = false;
let currentVideoIndex = 0;
let currentVideoProgress = 0;
let framesGenerated = 0;
let renderer: Renderer | null = null;

self.addEventListener('message', async (e) => {
  const command = e.data as WorkerCommand;
  switch (command.type) {
    case 'image': {
      const { name, image } = command;
      log(`Loaded bitmap "${name}" (${image.width}x${image.height})...`);
      images[name] = image;
      return;
    }

    case 'draw': {
      if (renderer) {
        renderer.close();
        renderer = null;
      }

      renderer = await createRenderer(
        command.canvas,
        {
          drawRemoteTilt: command.drawRemoteTilt,
          footpadThresholdVolts: command.footpadThresholdVolts,
          backgroundColor: command.backgroundColor,
          boardPosition3d: command.boardPosition3d,
          boardPosition3dRaised: command.boardPosition3dRaised,
          images,
        },
        command.use3dRenderer,
      );

      renderer.draw(command.data);
      return;
    }

    case 'file': {
      log('Reading input file...');
      const result = await parse(command.inputFile);
      log('Finished reading input file.');
      for (const error of result.errors) log(`Import warning: ${error.message}`);

      const startingIndex = command.startingIndex ? Math.max(0, command.startingIndex) : 0;
      const endingIndex = command.endingIndex ? Math.min(result.data.length, command.endingIndex) : result.data.length;

      segmentManager.processDataIntoSegments(result.data, startingIndex, endingIndex, command.gapThresholdSecs);
      return;
    }

    case 'start':
      log('Reading input file...');
      if (segmentManager.getSegmentCount() === 0) {
        fatal('Error: no data available to render, please load a file.');
      } else {
        generateVideo(command);
      }
      return;

    case 'update':
      postUpdateMessage({
        currentVideoIndex,
        currentVideoProgress,
        videosTotal: segmentManager.getSegmentCount(),
        framesGenerated,
      });
      return;

    case 'stop':
      started = false;
      log('Stopping video generation...');
      return;

    default:
      console.warn(`Unknown command`, command);
  }
});

interface ProgressCallback {
  onFrameEncoded: (timestampMicros: number) => void;
  shouldStop: () => boolean;
}

class VideoGenerator {
  private renderer: Renderer | null = null;
  private frameDurationMicros: number;
  private backoffThreshold: number;

  constructor(private options: WorkerCommandDef['start'] & { images: Record<string, ImageBitmap> }) {
    this.frameDurationMicros = 1_000_000 / options.fps;
    this.backoffThreshold = options.fps * 2;
  }

  async initialize(): Promise<void> {
    // Setup canvas
    this.options.canvas.width = this.options.width;
    this.options.canvas.height = this.options.height;

    // Create renderer
    this.renderer = await createRenderer(
      this.options.canvas,
      {
        drawRemoteTilt: this.options.drawRemoteTilt,
        footpadThresholdVolts: this.options.footpadThresholdVolts,
        backgroundColor: this.options.backgroundColor,
        boardPosition3d: this.options.boardPosition3d,
        boardPosition3dRaised: this.options.boardPosition3dRaised,
        images: this.options.images,
      },
      this.options.use3dRenderer,
    );

    // Test creating encoder to fail early if browser doesn't have support
    await this.createEncoder(() => {});
  }

  private async createEncoder(output: EncodedVideoChunkOutputCallback) {
    const encoderConfig: VideoEncoderConfig = {
      codec: 'vp8',
      width: this.options.canvas.width,
      height: this.options.canvas.height,
      bitrate: 2_000_000,
      framerate: this.options.fps,
    };

    const { supported } = await VideoEncoder.isConfigSupported(encoderConfig);
    if (!supported) {
      throw new Error(`The chosen options are not supported: ${JSON.stringify(encoderConfig, null, 2)}`);
    }

    const encoder = new VideoEncoder({
      output,
      error: (e) => {
        log(`Encoder error: ${e.message}`);
      },
    });
    encoder.configure(encoderConfig);

    return encoder;
  }

  async renderSegment(
    video: VideoFrameData,
    writer: VideoFileWriter,
    progressCallback: ProgressCallback,
  ): Promise<void> {
    const encoder = await this.createEncoder((chunk) => writer.addFrame(chunk));

    const encodeFrame = async (frame: number, timestamp: number): Promise<boolean> => {
      if (progressCallback.shouldStop()) {
        return false;
      }

      // Backoff if encoder queue is full
      while (encoder.encodeQueueSize > this.backoffThreshold) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const videoFrame = new VideoFrame(this.options.canvas, { timestamp });
      encoder.encode(videoFrame, { keyFrame: frame % this.options.fps === 0 });
      videoFrame.close();

      progressCallback.onFrameEncoded(timestamp);
      return true;
    };

    if (this.options.interpolate) {
      await this.renderInterpolatedFrames(video, encodeFrame);
    } else {
      await this.renderStaticFrames(video, encodeFrame);
    }

    await encoder.flush();
    encoder.close();
  }

  private async renderInterpolatedFrames(
    video: VideoFrameData,
    encodeFrame: (frame: number, timestamp: number) => Promise<boolean>,
  ) {
    let frameCount = 0;

    const startTimeMicros = video.startTime() * 1_000_000;
    for (let i = 0; i < video.data.length - 1; i++) {
      const curr = video.data[i]!;
      const next = video.data[i + 1]!;
      const currTimeMicros = curr[RowKey.Time] * 1_000_000;
      const stopTimeMicros = next[RowKey.Time] * 1_000_000;

      // encode frames until we reach the next data point
      while (true) {
        const frameTimestamp = Math.round(frameCount * this.frameDurationMicros);

        await this.renderer!.draw(
          interpolate(
            curr,
            next,
            frameTimestamp <= currTimeMicros
              ? 0
              : (frameTimestamp - currTimeMicros) / (stopTimeMicros - currTimeMicros),
          ),
        );

        if (!(await encodeFrame(frameCount++, frameTimestamp))) {
          break;
        }

        if (startTimeMicros + frameTimestamp >= stopTimeMicros) {
          break;
        }
      }
    }

    // Handle the last data point (no interpolation needed)
    const last = video.data[video.data.length - 1]!;
    const lastTimeMicros = last[RowKey.Time];

    while (true) {
      const frameTimestamp = frameCount * this.frameDurationMicros;
      await this.renderer!.draw(last);

      if (!(await encodeFrame(frameCount++, frameTimestamp))) break;

      if (startTimeMicros + frameTimestamp >= lastTimeMicros) {
        break;
      }
    }
  }

  private async renderStaticFrames(
    video: VideoFrameData,
    encodeFrame: (frame: number, timestamp: number) => Promise<boolean>,
  ) {
    let frameCount = 0;

    const startTimeMicros = video.startTime() * 1_000_000;
    for (let i = 0; i < video.data.length; i++) {
      const curr = video.data[i]!;
      const next = video.data[i + 1];
      const stopTimeSecs = next?.[RowKey.Time] ?? curr[RowKey.Time] + 1;
      const stopTimeMicros = stopTimeSecs * 1_000_000;

      await this.renderer!.draw(curr);

      // encode duplicate frames until time is reached
      while (true) {
        const frameTimestamp = Math.round(frameCount * this.frameDurationMicros);

        if (!(await encodeFrame(frameCount++, frameTimestamp))) {
          break;
        }

        if (startTimeMicros + frameTimestamp >= stopTimeMicros) {
          break;
        }
      }
    }
  }

  dispose(): void {
    if (this.renderer) {
      this.renderer.close();
      this.renderer = null;
    }
  }
}

async function generateVideo(options: WorkerCommandDef['start']) {
  log('Setting up video generator...');

  const generator = new VideoGenerator({ ...options, images });
  const { directoryHandle, fps, canvas, filename, interpolate } = options;
  const fileManager = new VideoFileManager(directoryHandle);

  try {
    await generator.initialize();

    log(`Beginning render... (interpolate: ${interpolate})`);

    framesGenerated = 0;
    const start = performance.now();

    const segments = segmentManager.getSegments();

    started = true;
    for (let i = 0; i < segments.length; i++) {
      const video = segments[i]!;
      const baseName = `${filename} - segment_${(i + 1).toString().padStart(`${segments.length}`.length, '0')}`;
      const writer = await fileManager.createWriter(canvas, baseName, fps);

      currentVideoIndex = i;
      const endTimeMicros = (video.endTime() - video.startTime() + 1) * 1_000_000;
      const progressCallback: ProgressCallback = {
        shouldStop: () => !started,
        onFrameEncoded: (timestampMicros) => {
          currentVideoProgress = timestampMicros / endTimeMicros;
          framesGenerated++;
        },
      };

      try {
        log(`Rendering segment ${i + 1} into ${writer.name}...`);
        await generator.renderSegment(video, writer, progressCallback);
      } finally {
        // Always ensure writer is closed, even if rendering fails
        await writer.close();
      }
    }

    const duration = performance.now() - start;
    log(`Rendered ${framesGenerated} frames in ${(duration / 1_000 / 60).toFixed(2)} min(s)`);
    log(`Average frame time: ${(duration / framesGenerated).toFixed(2)} ms`);

    postMessage({ type: 'complete', totalMilliseconds: duration });
  } catch (error) {
    fatal(`Video generation failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    generator.dispose();
  }
}

