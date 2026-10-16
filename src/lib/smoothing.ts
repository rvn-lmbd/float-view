import type { RowWithIndex } from './parse/types';

/** Smooths each continuous chart segment with a centered moving average. */
export function smoothChartValues(values: number[], windowFrames: number, gapIndices: number[] = []): number[] {
  const frameCount = Math.max(1, Math.floor(windowFrames));
  if (frameCount <= 1 || values.length < 2) return values;

  const radius = Math.floor(frameCount / 2);
  const boundaries = [0, ...gapIndices.filter((index) => index > 0 && index < values.length), values.length].sort(
    (a, b) => a - b,
  );
  const result = new Array<number>(values.length).fill(Number.NaN);

  for (let segment = 0; segment < boundaries.length - 1; segment++) {
    const start = boundaries[segment]!;
    const end = boundaries[segment + 1]!;
    for (let index = start; index < end; index++) {
      if (!Number.isFinite(values[index])) continue;
      const windowStart = Math.max(start, index - radius);
      const windowEnd = Math.min(end, index + radius + 1);
      let sum = 0;
      let count = 0;
      for (let cursor = windowStart; cursor < windowEnd; cursor++) {
        const value = values[cursor]!;
        if (Number.isFinite(value)) {
          sum += value;
          count++;
        }
      }
      if (count) result[index] = sum / count;
    }
  }

  return result;
}


const MAX_FRAME_INTERVAL_FOR_CADENCE_SECONDS = 5;

/** Uses typical positive frame intervals and ignores long pauses so stops do not inflate the displayed window. */
export function calculateMedianFrameIntervalSeconds(rows: readonly Pick<RowWithIndex, 'time'>[]): number {
  const intervals: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const interval = rows[i]!.time - rows[i - 1]!.time;
    if (Number.isFinite(interval) && interval > 0 && interval <= MAX_FRAME_INTERVAL_FOR_CADENCE_SECONDS) {
      intervals.push(interval);
    }
  }
  if (!intervals.length) return Number.NaN;
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 ? intervals[middle]! : (intervals[middle - 1]! + intervals[middle]!) / 2;
}
