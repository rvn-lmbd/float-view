import { describe, expect, test } from 'vitest';
import { State, Units, type RowWithIndex } from './parse/types';
import { calculateEnergyConsumptionSeries } from './energy';

const makeRow = (overrides: Partial<RowWithIndex> = {}): RowWithIndex => ({
  index: 0,
  adc1: 0,
  adc2: 0,
  ah: 0,
  altitude: 0,
  current_battery: 0,
  current_motor: 0,
  distance: 0,
  duty: 0,
  gps_accuracy: 0,
  gps_latitude: 0,
  gps_longitude: 0,
  motor_fault: 0,
  pitch: 0,
  roll: 0,
  speed: 0,
  state: State.Riding,
  state_raw: 0,
  temp_mosfet: 0,
  temp_motor: 0,
  time: 0,
  true_pitch: 0,
  voltage: 0,
  wh: 0,
  ...overrides,
});

describe(calculateEnergyConsumptionSeries.name, () => {
  test('calculates cumulative net Wh per distance from logged energy counters', () => {
    const rows = [
      makeRow({ index: 0, time: 0, distance: 0, wh: 0, wh_charged: 0, speed: 10, voltage: 100, current_battery: 2 }),
      makeRow({ index: 1, time: 10, distance: 1, wh: 2, wh_charged: 0, speed: 20, voltage: 100, current_battery: 4 }),
      makeRow({
        index: 2,
        time: 20,
        distance: 2,
        wh: 4,
        wh_charged: 0.5,
        speed: 10,
        voltage: 100,
        current_battery: -1,
      }),
      makeRow({ index: 3, time: 30, distance: 3, wh: 6, wh_charged: 0.5, speed: 10, voltage: 100, current_battery: 2 }),
    ];

    const efficiency = calculateEnergyConsumptionSeries(rows);
    expect(efficiency.cumulative[0]).toBeNaN();
    expect(efficiency.cumulative[1]).toBeCloseTo(2);
    expect(efficiency.cumulative[2]).toBeCloseTo(1.75);
    expect(efficiency.current[0]).toBeNaN();
  });

  test('calculates cumulative net Wh per distance from integrated battery power as fallback', () => {
    const rows = [
      makeRow({ index: 0, time: 0, distance: 0, voltage: 100, current_battery: 10, speed: 100 }),
      makeRow({ index: 1, time: 3.6, distance: 0.1, voltage: 100, current_battery: 10, speed: 100 }),
      makeRow({ index: 2, time: 7.2, distance: 0.2, voltage: 100, current_battery: 10, speed: 100 }),
      makeRow({ index: 3, time: 10.8, distance: 0.3, voltage: 100, current_battery: 10, speed: 100 }),
    ];

    const efficiency = calculateEnergyConsumptionSeries(rows);
    expect(efficiency.cumulative[1]).toBeCloseTo(10);
  });

  test('integrates recent power over a centered 50-meter window, independent of logged Wh steps', () => {
    const rows = [
      makeRow({ index: 0, time: 0, wh: 0, speed: 10, voltage: 100, current_battery: 1 }),
      makeRow({ index: 1, time: 5, wh: 0, speed: 10, voltage: 100, current_battery: 1 }),
      makeRow({ index: 2, time: 10, wh: 1, speed: 10, voltage: 100, current_battery: 3 }),
      makeRow({ index: 3, time: 15, wh: 1, speed: 10, voltage: 100, current_battery: 3 }),
      makeRow({ index: 4, time: 20, wh: 2, speed: 10, voltage: 100, current_battery: 3 }),
    ];
    const consumption = calculateEnergyConsumptionSeries(rows);

    expect(Number.isFinite(consumption.current[0])).toBe(true);
    expect(Number.isFinite(consumption.current[1])).toBe(true);
    expect(consumption.current[2]).toBeCloseTo(22.777778, 5);
    expect(Number.isFinite(consumption.current[3])).toBe(true);
    expect(Number.isFinite(consumption.current[4])).toBe(true);
  });

  test('does not average recent consumption across telemetry gaps', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 10, voltage: 100, current_battery: 2 }),
      makeRow({ index: 1, time: 5, speed: 10, voltage: 100, current_battery: 2 }),
      makeRow({ index: 2, time: 11, speed: 10, voltage: 100, current_battery: 2 }),
      makeRow({ index: 3, time: 16, speed: 10, voltage: 100, current_battery: 2 }),
    ];
    const consumption = calculateEnergyConsumptionSeries(rows);

    expect(Number.isFinite(consumption.current[0])).toBe(true);
    expect(Number.isNaN(consumption.current[1])).toBe(true);
    expect(Number.isNaN(consumption.current[2])).toBe(true);
    expect(Number.isFinite(consumption.current[3])).toBe(true);
  });

  test('reports zero recent consumption while stopped or creeping below 2 km/h', () => {
    const rows = [0, 0.2, 0.5, 0.1, 0].map((speed, index) =>
      makeRow({ index, time: index * 5, speed, voltage: 48, current_battery: 30 }),
    );
    const consumption = calculateEnergyConsumptionSeries(rows);

    expect(consumption.current).toEqual([0, 0, 0, 0, 0]);
  });

  test('shows zero while stopped and excludes stationary power from recent consumption', () => {
    const speeds = [10, 10, 10, 10, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10];
    const rows = speeds.map((speed, index) =>
      makeRow({ index, time: index * 5, speed, voltage: 100, current_battery: 10 }),
    );
    const consumption = calculateEnergyConsumptionSeries(rows);

    expect(consumption.current[3]).toBeGreaterThan(0);
    expect(consumption.current[4]).toBe(0);
    expect(consumption.current[5]).toBe(0);
  });

  test('converts the low-speed cutoff for imperial source data', () => {
    const belowCutoffRows = Array.from({ length: 31 }, (_, index) =>
      makeRow({ index, time: index * 5, speed: 1, voltage: 48, current_battery: 30 }),
    );
    const belowCutoff = calculateEnergyConsumptionSeries(belowCutoffRows, Units.Imperial);
    expect(belowCutoff.current.every((value) => value === 0)).toBe(true);

    const aboveCutoffRows = Array.from({ length: 31 }, (_, index) =>
      makeRow({ index, time: index * 5, speed: 1.5, voltage: 48, current_battery: 30 }),
    );
    const aboveCutoff = calculateEnergyConsumptionSeries(aboveCutoffRows, Units.Imperial);
    expect(aboveCutoff.current[15]).toBeCloseTo(960);
  });
});
