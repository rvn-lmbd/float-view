export const DEFAULT_FOOTPAD_THRESHOLD_VOLTS = 2;
export const DEFAULT_FOOTPAD_FAULT_DEBOUNCE_MS = 250;

export function normalizeFootpadThreshold(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 3.3 ? value : DEFAULT_FOOTPAD_THRESHOLD_VOLTS;
}

export function footpadIsActive(voltage: number, thresholdVolts: number): boolean {
  return voltage >= thresholdVolts;
}

