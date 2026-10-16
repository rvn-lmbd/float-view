import { describe, expect, test } from 'vitest';
import { DataSource, State, Units, type RowWithIndex } from '../lib/parse/types';
import {
  calculateEnergyConsumptionSeries,
  calculateMedianFrameIntervalSeconds,
  computeStats,
  extractGpsInformation,
  findPointsOfInterest,
} from './View';

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

describe(extractGpsInformation.name, () => {
  test('replaces leading (0,0) gps points with first non-zero coordinate for all sources', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, time: 0, gps_latitude: 0, gps_longitude: 0 }),
      makeRow({ index: 1, time: 1, gps_latitude: 0, gps_longitude: 0 }),
      makeRow({ index: 2, time: 2, gps_latitude: -37.81, gps_longitude: 144.96 }),
      makeRow({ index: 3, time: 3, gps_latitude: -37.82, gps_longitude: 144.97 }),
    ];

    const sources = [DataSource.FloatControl, DataSource.Floaty, DataSource.VescTool];
    for (const source of sources) {
      const { gpsPoints } = extractGpsInformation(rows, source);

      expect(gpsPoints[0]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[1]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[2]).toEqual([-37.81, 144.96]);
      expect(gpsPoints[3]).toEqual([-37.82, 144.97]);
    }
  });
});

describe(findPointsOfInterest.name, () => {
  test('does not infer footpad faults when ADC telemetry is absent', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, speed: 10, adc1: 0, adc2: 0 }),
      makeRow({ index: 1, speed: 15, adc1: 0, adc2: 0 }),
    ];

    const points = findPointsOfInterest(rows);
    expect(points).toEqual([]);
  });

  test('still infers footpad faults when ADC telemetry is present', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, time: 0, speed: 10, adc1: 0, adc2: 3 }),
      makeRow({ index: 1, time: 0.14, speed: 10, adc1: 0, adc2: 3 }),
      makeRow({ index: 2, time: 0.28, speed: 10, adc1: 0, adc2: 3 }),
    ];

    const points = findPointsOfInterest(rows);
    expect(points).toEqual([{ index: 0, state: State.Custom_OneFootpadAtSpeed }]);
  });

  test('uses the configured voltage for each sensor independently', () => {
    const rows: RowWithIndex[] = [
      makeRow({ index: 0, time: 0, speed: 10, adc1: 1.2, adc2: 1.2 }),
      makeRow({ index: 1, time: 0.3, speed: 10, adc1: 0.9, adc2: 1.2 }),
      makeRow({ index: 2, time: 0.6, speed: 10, adc1: 0.9, adc2: 1.2 }),
    ];

    expect(findPointsOfInterest(rows, 1, 250)).toEqual([{ index: 1, state: State.Custom_OneFootpadAtSpeed }]);
    expect(findPointsOfInterest(rows, 1.5, 250)).toEqual([{ index: 0, state: State.Custom_NoFootpadsAtSpeed }]);
  });

  test('ignores footpad faults shorter than the confirmation duration', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 10, adc1: 0, adc2: 3 }),
      makeRow({ index: 1, time: 0.14, speed: 10, adc1: 0, adc2: 3 }),
    ];

    expect(findPointsOfInterest(rows, 2, 250)).toEqual([]);
  });

  test('collapses repeated frames of one quickstop but keeps separate events', () => {
    const rows = [
      makeRow({ index: 0, time: 0, state: State.Riding }),
      makeRow({ index: 1, time: 0.1, state: State.Quickstop }),
      makeRow({ index: 2, time: 0.2, state: State.Quickstop }),
      makeRow({ index: 3, time: 0.3, state: State.Riding }),
      makeRow({ index: 4, time: 0.4, state: State.Quickstop }),
    ];

    expect(findPointsOfInterest(rows)).toEqual([
      { index: 1, state: State.Quickstop },
      { index: 4, state: State.Quickstop },
    ]);
  });
});

describe(calculateMedianFrameIntervalSeconds.name, () => {
  test('uses the median cadence and ignores long pauses', () => {
    const rows = [
      makeRow({ index: 0, time: 0 }),
      makeRow({ index: 1, time: 0.1 }),
      makeRow({ index: 2, time: 0.2 }),
      makeRow({ index: 3, time: 10.2 }),
      makeRow({ index: 4, time: 10.3 }),
    ];

    expect(calculateMedianFrameIntervalSeconds(rows)).toBeCloseTo(0.1);
  });
});

describe(computeStats.name, () => {
  test('calculates GPS/controller deviation and the VESC wheel-diameter multiplier', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 20, gps_speed: 22, distance: 1.5 }),
      makeRow({ index: 1, time: 10, speed: 20, gps_speed: 22, distance: 1.6 }),
    ];

    const stats = computeStats(rows, [], Units.Metric);
    expect(stats.averageSpeedDeviation).toBeCloseTo(2);
    expect(stats.wheelDiameterFactor).toBeCloseTo(1.1);
    expect(stats.highestGpsSpeed).toBe(22);
    expect(stats.totalDistance).toBeCloseTo(0.1);
  });

  test('calculates time-weighted average controller speed while moving above zero, excluding stops', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 10 }),
      makeRow({ index: 1, time: 10, speed: 10 }),
      makeRow({ index: 2, time: 20, speed: 0 }),
      makeRow({ index: 3, time: 30, speed: 0 }),
      makeRow({ index: 4, time: 40, speed: 10 }),
    ];

    const stats = computeStats(rows, []);
    expect(stats.averageSpeed).toBeCloseTo(6);
    expect(stats.averageMovingSpeed).toBeCloseTo(20 / 3);
  });

  test('includes low but nonzero speeds in the moving average', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 10 }),
      makeRow({ index: 1, time: 10, speed: 10 }),
      makeRow({ index: 2, time: 20, speed: 0 }),
      makeRow({ index: 3, time: 30, speed: 0.1 }),
      makeRow({ index: 4, time: 40, speed: 10 }),
    ];

    expect(computeStats(rows, []).averageMovingSpeed).toBeCloseTo(5.025);
  });

  test('integrates battery use and regeneration from signed battery power', () => {
    const rows = [
      makeRow({ index: 0, time: 0, voltage: 100, current_battery: 10, distance: 0 }),
      makeRow({ index: 1, time: 10, voltage: 100, current_battery: 10, distance: 1 }),
      makeRow({ index: 2, time: 20, voltage: 100, current_battery: -10, distance: 1 }),
    ];

    const stats = computeStats(rows, []);
    expect(stats.energyUsedWh).toBeCloseTo(3.472222, 5);
    expect(stats.energyRegeneratedWh).toBeCloseTo(0.694444, 5);
    expect(stats.netEnergyWh).toBeCloseTo(2.777778, 5);
    expect(stats.netWhPerKm).toBeCloseTo(2.777778, 5);
  });

  test('prefers logged cumulative Wh counters when they are available', () => {
    const rows = [
      makeRow({ index: 0, time: 0, wh: 10, wh_charged: 2, voltage: 100, current_battery: 10 }),
      makeRow({
        index: 1,
        time: 10,
        wh: 12.5,
        wh_charged: 2.75,
        voltage: 100,
        current_battery: 10,
        distance: 1,
      }),
    ];

    const stats = computeStats(rows, []);
    expect(stats.energyUsedWh).toBeCloseTo(2.5);
    expect(stats.energyRegeneratedWh).toBeCloseTo(0.75);
  });

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

  test('reports selected moving-average current and power maxima separately from raw peaks and regen', () => {
    const motorCurrents = [20, 20, 20, 20, 20, 100, 0, 0, 0, 0, -30, -30, -30, -30, -30];
    const rows = motorCurrents.map((current_motor, index) =>
      makeRow({
        index,
        time: index,
        voltage: 100,
        duty: 50,
        current_motor,
        current_battery: current_motor / 10,
      }),
    );

    const stats = computeStats(rows, [], Units.Metric, 5);
    expect(stats.highestMotorCurrent).toBeCloseTo(36);
    expect(stats.peakMotorCurrent).toBe(100);
    expect(stats.highestMotorRegenCurrent).toBe(30);
    expect(stats.peakMotorRegenCurrent).toBe(30);
    expect(stats.highestMotorPower).toBeCloseTo(1800);
    expect(stats.peakMotorPower).toBe(5000);
    expect(stats.highestMotorRegenPower).toBe(1500);
    expect(stats.highestBatteryCurrent).toBeCloseTo(3.6);
    expect(stats.peakBatteryCurrent).toBe(10);
    expect(stats.highestBatteryRegenCurrent).toBe(3);
    expect(stats.highestBatteryPower).toBeCloseTo(360);
    expect(stats.highestBatteryRegenPower).toBe(300);
  });

  test('uses the selected moving-average window for maxima while preserving raw peaks', () => {
    const rows = [0, 0, 9, 0, 0].map((current_motor, index) => makeRow({ index, time: index, current_motor }));

    const unfiltered = computeStats(rows, [], Units.Metric, 1);
    const movingAverage = computeStats(rows, [], Units.Metric, 3);

    expect(unfiltered.highestMotorCurrent).toBe(9);
    expect(movingAverage.highestMotorCurrent).toBe(3);
    expect(unfiltered.peakMotorCurrent).toBe(9);
    expect(movingAverage.peakMotorCurrent).toBe(9);
  });

  test('does not compare GPS calibration below 5 km/h or across long gaps', () => {
    const rows = [
      makeRow({ index: 0, time: 0, speed: 2, gps_speed: 10 }),
      makeRow({ index: 1, time: 10, speed: 2, gps_speed: 10 }),
      makeRow({ index: 2, time: 100, speed: 20, gps_speed: 22 }),
    ];

    const stats = computeStats(rows, []);
    expect(stats.averageSpeedDeviation).toBeNaN();
    expect(stats.wheelDiameterFactor).toBeNaN();
  });
});

