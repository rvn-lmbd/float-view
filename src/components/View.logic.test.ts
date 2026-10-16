import { describe, expect, test } from 'vitest';
import { DataSource, State, Units, type RowWithIndex } from '../lib/parse/types';
import { computeStats, extractGpsInformation, findPointsOfInterest } from './View';

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
      makeRow({ index: 0, speed: 10, adc1: 0, adc2: 3 }),
      makeRow({ index: 1, speed: 10, adc1: 0, adc2: 1 }),
    ];

    const points = findPointsOfInterest(rows);
    expect(points).toEqual([
      { index: 0, state: State.Custom_OneFootpadAtSpeed },
      { index: 1, state: State.Custom_NoFootpadsAtSpeed },
    ]);
  });
});

describe(computeStats.name, () => {
  test('reports energy use and regeneration from logged counters, with battery power as a fallback', () => {
    const counterRows = [
      makeRow({ index: 0, time: 0, wh: 10, wh_charged: 2, voltage: 100, current_battery: 10, distance: 0 }),
      makeRow({ index: 1, time: 10, wh: 12.5, wh_charged: 2.75, voltage: 100, current_battery: 10, distance: 1 }),
    ];
    const fromCounters = computeStats(counterRows, []);
    expect(fromCounters.energyUsedWh).toBeCloseTo(2.5);
    expect(fromCounters.energyRegeneratedWh).toBeCloseTo(0.75);
    expect(fromCounters.netEnergyWh).toBeCloseTo(1.75);
    expect(fromCounters.netWhPerKm).toBeCloseTo(1.75);

    const integratedRows = [
      makeRow({ index: 0, time: 0, voltage: 100, current_battery: 10, distance: 0 }),
      makeRow({ index: 1, time: 10, voltage: 100, current_battery: 10, distance: 1 }),
      makeRow({ index: 2, time: 20, voltage: 100, current_battery: -10, distance: 1 }),
    ];
    const fromPower = computeStats(integratedRows, []);
    expect(fromPower.energyUsedWh).toBeCloseTo(3.472222, 5);
    expect(fromPower.energyRegeneratedWh).toBeCloseTo(0.694444, 5);
  });
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
