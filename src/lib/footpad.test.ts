import { describe, expect, test } from 'vitest';
import {
  DEFAULT_FOOTPAD_HALF_FAULT_DELAY_MS,
  DEFAULT_FOOTPAD_FULL_FAULT_DELAY_MS,
  DEFAULT_FOOTPAD_THRESHOLD_VOLTS,
  footpadIsActive,
  normalizeFootpadThreshold,
} from './footpad';

describe('footpad threshold', () => {
  test('treats voltage exactly at the threshold as active', () => {
    expect(footpadIsActive(0.99, 1)).toBe(false);
    expect(footpadIsActive(1, 1)).toBe(true);
    expect(footpadIsActive(1.01, 1)).toBe(true);
  });

  test('defaults to 2 V and falls back to it for invalid settings', () => {
    expect(DEFAULT_FOOTPAD_THRESHOLD_VOLTS).toBe(2);
    expect(DEFAULT_FOOTPAD_HALF_FAULT_DELAY_MS).toBe(250);
    expect(DEFAULT_FOOTPAD_FULL_FAULT_DELAY_MS).toBe(250);
    expect(normalizeFootpadThreshold(Number.NaN)).toBe(DEFAULT_FOOTPAD_THRESHOLD_VOLTS);
    expect(normalizeFootpadThreshold(4)).toBe(DEFAULT_FOOTPAD_THRESHOLD_VOLTS);
  });
});

