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

