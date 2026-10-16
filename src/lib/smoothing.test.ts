import { describe, expect, test } from 'vitest';
import { calculateMedianFrameIntervalSeconds, smoothChartValues } from './smoothing';

describe(smoothChartValues.name, () => {
  test('uses a centered moving average without shifting an isolated peak in time', () => {
    const values = [0, 0, 9, 0, 0];
    const smoothed = smoothChartValues(values, 3);

    expect(smoothed).toEqual([0, 3, 3, 3, 0]);
  });

  test('does not smooth across missing samples or chart gaps', () => {
    expect(smoothChartValues([1, 2, Number.NaN, 10, 20], 3)).toEqual([1.5, 1.5, Number.NaN, 15, 15]);
    expect(smoothChartValues([1, 2, 10, 20], 3, [2])).toEqual([1.5, 1.5, 15, 15]);
  });

  test('returns the original samples when the window is off', () => {
    const values = [1, Number.NaN, 3];
    expect(smoothChartValues(values, 1)).toBe(values);
  });
});

describe(calculateMedianFrameIntervalSeconds.name, () => {
  test('uses the median cadence and ignores long pauses', () => {
    const rows = [0, 0.1, 0.2, 10.2, 10.3].map((time) => ({ time }));
    expect(calculateMedianFrameIntervalSeconds(rows)).toBeCloseTo(0.1);
  });

  test('returns NaN if the ride has no usable frame intervals', () => {
    expect(calculateMedianFrameIntervalSeconds([{ time: 5 }, { time: 5 }])).toBeNaN();
  });
});
