import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseGeoidGrid } from './geoid';

const file = readFileSync(resolve(process.cwd(), 'src/assets/egm96-15.pgm'));
const grid = parseGeoidGrid(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

describe('EGM96 geoid correction', () => {
  test('reads the bundled grid and wraps longitude', () => {
    expect(grid.undulation(50.0755, 14.4378)).toBeGreaterThan(0);
    expect(grid.undulation(50.0755, 14.4378)).toBeCloseTo(grid.undulation(50.0755, 374.4378), 8);
  });

  test('interpolates at both poles and rejects invalid latitudes', () => {
    expect(Number.isFinite(grid.undulation(90, 0))).toBe(true);
    expect(Number.isFinite(grid.undulation(-90, 0))).toBe(true);
    expect(() => grid.undulation(91, 0)).toThrow();
  });
});

