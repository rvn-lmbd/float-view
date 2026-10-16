import { describe, expect, test } from 'vitest';
import { formatAxisTick } from './Chart';

describe(formatAxisTick.name, () => {
  test('keeps axis tick labels to four digits plus an optional minus sign', () => {
    expect(formatAxisTick(1234)).toBe('1234');
    expect(formatAxisTick(-9999)).toBe('-9999');

    for (const value of [10_000, -12_345, 1_234_567]) {
      const label = formatAxisTick(value);
      expect(label.match(/\d/g)?.length).toBeLessThanOrEqual(4);
    }
  });
});

