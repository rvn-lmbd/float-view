import type { RowWithIndex } from '../../lib/parse/types';
import type { Canvas } from './svg';

/*
 * Incoming commands
 */

export type WorkerCommandDef = {
  image: {
    name: string;
    image: ImageBitmap;
  };
  draw: {
    canvas: OffscreenCanvas;
    drawRemoteTilt: boolean;
    backgroundColor: string;
    boardPosition3d: BoardPosition3d;
    boardPosition3dRaised: boolean;
    use3dRenderer: boolean;
    footpadThresholdVolts: number;
    data: RowWithIndex;
  };
  file: {
    inputFile: File;
    startingIndex: number;
    endingIndex: number;
    gapThresholdSecs: number;
    fps: number;
  };
  start: {
    directoryHandle: FileSystemDirectoryHandle;
    filename: string;
    canvas: OffscreenCanvas;
    interpolate: boolean;
    drawRemoteTilt: boolean;
    backgroundColor: string;
    boardPosition3d: BoardPosition3d;
    boardPosition3dRaised: boolean;
    use3dRenderer: boolean;
    fps: number;
    width: number;
    height: number;
    footpadThresholdVolts: number;
  };
  update: {};
  stop: {};
};

export type WorkerCommand = {
  [K in keyof WorkerCommandDef]: { type: K } & WorkerCommandDef[K];
}[keyof WorkerCommandDef];

/*
 * Outgoing messages
 */

export type WorkerMessageDef = {
  complete: {
    totalMilliseconds: number;
  };
  progress: {
    videosTotal: number;
    currentVideoIndex: number;
    currentVideoProgress: number;
    framesGenerated: number;
  };
  log: {
    message: string;
  };
  fatal: {
    message: string;
  };
};

export type WorkerMessage = {
  [K in keyof WorkerMessageDef]: { type: K } & WorkerMessageDef[K];
}[keyof WorkerMessageDef];

/*
 * Worker definition
 */

interface TypedWorkerCreator<C, M> {
  postMessage(message: C, transfer?: Transferable[]): void;

  addEventListener(
    type: 'message',
    listener: (this: Worker, ev: MessageEvent<M>) => any,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener(
    type: 'message',
    listener: (this: Worker, ev: MessageEvent<M>) => any,
    options?: boolean | EventListenerOptions,
  ): void;

  terminate(): void;

  onmessage: ((this: Worker, ev: MessageEvent<M>) => any) | null;
}

export interface TypedWorker<C, M> extends TypedWorkerCreator<C, M>, Omit<Worker, keyof TypedWorkerCreator<C, M>> {}

/*
 * Render interface
 */

export enum BoardPosition3d {
  Left = 'left',
  Right = 'right',
  Front = 'front',
  FrontLeft = 'front-left',
  FrontRight = 'front-right',
  Back = 'back',
  BackLeft = 'back-left',
  BackRight = 'back-right',
}

export interface RendererOptions {
  backgroundColor: string;
  boardPosition3d: BoardPosition3d;
  boardPosition3dRaised: boolean;

  drawRemoteTilt: boolean;
  footpadThresholdVolts: number;
  images: Record<string, ImageBitmap>;
}

export type SendProgressUpdate = (progress: number, message: string) => void;

export type CreateRenderer = (
  canvas: Canvas,
  options: RendererOptions,
  sendProgressUpdate: SendProgressUpdate,
) => Promise<Renderer>;

export interface Renderer {
  draw(data: RowWithIndex): Promise<void>;
  close(): void;
}

