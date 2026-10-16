export const DEFAULT_FOOTPAD_THRESHOLD_VOLTS = 2;
export const DEFAULT_FOOTPAD_HALF_FAULT_DELAY_MS = 250;
export const DEFAULT_FOOTPAD_FULL_FAULT_DELAY_MS = 250;

export function normalizeFootpadThreshold(value: number): number {
  return Number.isFinite(value) && value >= 0 && value <= 3.3 ? value : DEFAULT_FOOTPAD_THRESHOLD_VOLTS;
}

export function footpadIsActive(voltage: number, thresholdVolts: number): boolean {
  return voltage >= thresholdVolts;
}

