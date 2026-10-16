import { DataSource, State, Units, type RowWithIndex } from '../lib/parse/types';
import settings from '../lib/settings.svelte';
import { smoothChartValues } from '../lib/smoothing';
import type { PointOfInterest } from './Map';

export interface Banner {
  text: string;
  kind: 'info' | 'warning' | 'error';
}

export interface RideStats {
  totalHalfFaults: number;
  totalFullFaults: number;
  totalQuickStops: number;
  highestPitch: number;
  peakHighestPitch: number;
  lowestPitch: number;
  peakLowestPitch: number;
  highestRoll: number;
  peakHighestRoll: number;
  lowestRoll: number;
  peakLowestRoll: number;
  highestSpeed: number;
  peakSpeed: number;
  averageSpeed: number;
  averageMovingSpeed: number;
  highestErpm: number;
  peakErpm: number;
  highestDuty: number;
  peakDuty: number;
  averageDuty: number;
  highestMotorCurrent: number;
  peakMotorCurrent: number;
  highestMotorRegenCurrent: number;
  peakMotorRegenCurrent: number;
  highestMotorPower: number;
  peakMotorPower: number;
  highestMotorRegenPower: number;
  peakMotorRegenPower: number;
  highestBatteryCurrent: number;
  peakBatteryCurrent: number;
  highestBatteryRegenCurrent: number;
  peakBatteryRegenCurrent: number;
  highestBatteryPower: number;
  peakBatteryPower: number;
  highestBatteryRegenPower: number;
  peakBatteryRegenPower: number;
  highestFieldWeakeningCurrent: number;
  peakFieldWeakeningCurrent: number;
  highestTempMotor: number;
  peakTempMotor: number;
  highestTempController: number;
  peakTempController: number;
  totalDistance: number;
  highestGpsSpeed: number;
  peakGpsSpeed: number;
  averageSpeedDeviation: number;
  wheelDiameterFactor: number;
}

const MAX_STATS_SAMPLE_GAP_SECONDS = 60;
const MIN_CALIBRATION_SPEED_KMH = 5;
const MIN_MOVING_SPEED_KMH = 0;

function integrateSpeedWhileMoving(startKmh: number, endKmh: number, elapsedSeconds: number) {
  if (startKmh > MIN_MOVING_SPEED_KMH && endKmh > MIN_MOVING_SPEED_KMH) {
    return { speedKmhSeconds: ((startKmh + endKmh) / 2) * elapsedSeconds, movingSeconds: elapsedSeconds };
  }
  if (startKmh <= MIN_MOVING_SPEED_KMH && endKmh <= MIN_MOVING_SPEED_KMH) {
    return { speedKmhSeconds: 0, movingSeconds: 0 };
  }

  const crossingFraction = (MIN_MOVING_SPEED_KMH - startKmh) / (endKmh - startKmh);
  const movingFraction = startKmh > MIN_MOVING_SPEED_KMH ? crossingFraction : 1 - crossingFraction;
  const movingSeconds = elapsedSeconds * movingFraction;
  const movingEndpoint = startKmh > MIN_MOVING_SPEED_KMH ? startKmh : endKmh;
  return {
    speedKmhSeconds: ((MIN_MOVING_SPEED_KMH + movingEndpoint) / 2) * movingSeconds,
    movingSeconds,
  };
}

interface WindowedExtrema {
  maximum: number;
  peakMaximum: number;
  minimum: number;
  peakMinimum: number;
}

/** Compare extrema of the selected moving average with the raw one-frame peaks. */
function getWindowedExtrema(
  rows: RowWithIndex[],
  getValue: (row: RowWithIndex) => number,
  smoothingFrames: number,
): WindowedExtrema {
  const values = rows.map(getValue);
  let peakMaximum = Number.NEGATIVE_INFINITY;
  let peakMinimum = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    peakMaximum = Math.max(peakMaximum, value);
    peakMinimum = Math.min(peakMinimum, value);
  }

  let maximum = Number.NEGATIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  for (const value of smoothChartValues(values, smoothingFrames)) {
    if (!Number.isFinite(value)) continue;
    maximum = Math.max(maximum, value);
    minimum = Math.min(minimum, value);
  }

  return {
    maximum: Number.isFinite(maximum) ? maximum : Number.isFinite(peakMaximum) ? peakMaximum : NaN,
    peakMaximum: Number.isFinite(peakMaximum) ? peakMaximum : NaN,
    minimum: Number.isFinite(minimum) ? minimum : Number.isFinite(peakMinimum) ? peakMinimum : NaN,
    peakMinimum: Number.isFinite(peakMinimum) ? peakMinimum : NaN,
  };
}

export function computeStats(
  rows: RowWithIndex[],
  pois: PointOfInterest[],
  dataUnits: Units = Units.Metric,
  smoothingFrames = settings.chartSmoothingFrames,
): RideStats {
  let totalHalfFaults = 0;
  let totalFullFaults = 0;
  let totalQuickStops = 0;

  for (const poi of pois) {
    const state = poi.state;
    if (state === State.Custom_OneFootpadAtSpeed) {
      totalHalfFaults += 1;
    } else if (state === State.Custom_NoFootpadsAtSpeed) {
      totalFullFaults += 1;
    } else if (state === State.Quickstop) {
      totalQuickStops += 1;
    }
  }

  const pitchExtrema = getWindowedExtrema(rows, (row) => row.pitch, smoothingFrames);
  const rollExtrema = getWindowedExtrema(rows, (row) => row.roll, smoothingFrames);
  const speedExtrema = getWindowedExtrema(rows, (row) => Math.abs(row.speed), smoothingFrames);
  const gpsSpeedExtrema = getWindowedExtrema(
    rows,
    (row) => (Number.isFinite(row.gps_speed) ? Math.abs(row.gps_speed!) : NaN),
    smoothingFrames,
  );
  const erpmExtrema = getWindowedExtrema(
    rows,
    (row) => (row.erpm === undefined ? NaN : Math.abs(row.erpm)),
    smoothingFrames,
  );
  const dutyExtrema = getWindowedExtrema(rows, (row) => row.duty, smoothingFrames);
  const motorCurrentExtrema = getWindowedExtrema(rows, (row) => row.current_motor, smoothingFrames);
  const batteryCurrentExtrema = getWindowedExtrema(rows, (row) => row.current_battery, smoothingFrames);
  const motorPowerExtrema = getWindowedExtrema(
    rows,
    (row) => row.voltage * (row.duty / 100) * row.current_motor,
    smoothingFrames,
  );
  const batteryPowerExtrema = getWindowedExtrema(rows, (row) => row.voltage * row.current_battery, smoothingFrames);
  const fieldWeakeningExtrema = getWindowedExtrema(
    rows,
    (row) => (row.current_field_weakening === undefined ? NaN : Math.abs(row.current_field_weakening)),
    smoothingFrames,
  );
  const motorTempExtrema = getWindowedExtrema(rows, (row) => row.temp_motor, smoothingFrames);
  const controllerTempExtrema = getWindowedExtrema(rows, (row) => row.temp_mosfet, smoothingFrames);
  const positiveMaximum = (extrema: WindowedExtrema) => (extrema.maximum > 0 ? extrema.maximum : NaN);
  const positivePeak = (extrema: WindowedExtrema) => (extrema.peakMaximum > 0 ? extrema.peakMaximum : NaN);
  const negativeMaximum = (extrema: WindowedExtrema) => (extrema.minimum < 0 ? -extrema.minimum : NaN);
  const negativePeak = (extrema: WindowedExtrema) => (extrema.peakMinimum < 0 ? -extrema.peakMinimum : NaN);
  const speedSum = rows.reduce((sum, row) => sum + row.speed, 0);
  const dutySum = rows.reduce((sum, row) => sum + row.duty, 0);
  const averageSpeed = rows.length > 0 ? speedSum / rows.length : 0;
  const averageDuty = rows.length > 0 ? dutySum / rows.length : 0;

  let movingSpeedKmhSeconds = 0;
  let movingSeconds = 0;
  let comparedSeconds = 0;
  let absoluteSpeedDifferenceSeconds = 0;
  let controllerDistanceForCalibration = 0;
  let gpsDistanceForCalibration = 0;
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!;
    const current = rows[i]!;
    const elapsed = current.time - previous.time;
    if (!(elapsed > 0) || elapsed > MAX_STATS_SAMPLE_GAP_SECONDS) continue;

    const speedUnitToKmh = dataUnits === Units.Imperial ? 1.609344 : 1;
    const movingSpeed = integrateSpeedWhileMoving(
      Math.abs(previous.speed) * speedUnitToKmh,
      Math.abs(current.speed) * speedUnitToKmh,
      elapsed,
    );
    movingSpeedKmhSeconds += movingSpeed.speedKmhSeconds;
    movingSeconds += movingSpeed.movingSeconds;

    if (!Number.isFinite(previous.gps_speed) || !Number.isFinite(current.gps_speed)) continue;
    const gpsPrevious = Math.abs(previous.gps_speed!);
    const gpsCurrent = Math.abs(current.gps_speed!);
    const controllerPrevious = Math.abs(previous.speed);
    const controllerCurrent = Math.abs(current.speed);
    if (
      Math.min(gpsPrevious, gpsCurrent, controllerPrevious, controllerCurrent) * speedUnitToKmh <
      MIN_CALIBRATION_SPEED_KMH
    ) {
      continue;
    }

    const previousDifference = Math.abs(gpsPrevious - controllerPrevious);
    const currentDifference = Math.abs(gpsCurrent - controllerCurrent);
    absoluteSpeedDifferenceSeconds += ((previousDifference + currentDifference) / 2) * elapsed;
    comparedSeconds += elapsed;
    controllerDistanceForCalibration += ((controllerPrevious + controllerCurrent) / 2) * elapsed;
    gpsDistanceForCalibration += ((gpsPrevious + gpsCurrent) / 2) * elapsed;
  }

  const averageSpeedDeviation = comparedSeconds > 0 ? absoluteSpeedDifferenceSeconds / comparedSeconds : NaN;
  const averageMovingSpeed =
    movingSeconds > 0 ? movingSpeedKmhSeconds / movingSeconds / (dataUnits === Units.Imperial ? 1.609344 : 1) : NaN;
  const wheelDiameterFactor =
    controllerDistanceForCalibration > 0 ? gpsDistanceForCalibration / controllerDistanceForCalibration : NaN;
  const rawDistance = Math.max(0, (rows.at(-1)?.distance ?? 0) - (rows[0]?.distance ?? 0));

  return {
    totalHalfFaults,
    totalFullFaults,
    totalQuickStops,
    highestPitch: pitchExtrema.maximum,
    peakHighestPitch: pitchExtrema.peakMaximum,
    lowestPitch: pitchExtrema.minimum,
    peakLowestPitch: pitchExtrema.peakMinimum,
    highestRoll: rollExtrema.maximum,
    peakHighestRoll: rollExtrema.peakMaximum,
    lowestRoll: rollExtrema.minimum,
    peakLowestRoll: rollExtrema.peakMinimum,
    highestSpeed: speedExtrema.maximum,
    peakSpeed: speedExtrema.peakMaximum,
    averageSpeed,
    averageMovingSpeed,
    highestErpm: erpmExtrema.maximum,
    peakErpm: erpmExtrema.peakMaximum,
    highestDuty: dutyExtrema.maximum,
    peakDuty: dutyExtrema.peakMaximum,
    averageDuty,
    highestMotorCurrent: positiveMaximum(motorCurrentExtrema),
    peakMotorCurrent: positivePeak(motorCurrentExtrema),
    highestMotorRegenCurrent: negativeMaximum(motorCurrentExtrema),
    peakMotorRegenCurrent: negativePeak(motorCurrentExtrema),
    highestMotorPower: positiveMaximum(motorPowerExtrema),
    peakMotorPower: positivePeak(motorPowerExtrema),
    highestMotorRegenPower: negativeMaximum(motorPowerExtrema),
    peakMotorRegenPower: negativePeak(motorPowerExtrema),
    highestBatteryCurrent: positiveMaximum(batteryCurrentExtrema),
    peakBatteryCurrent: positivePeak(batteryCurrentExtrema),
    highestBatteryRegenCurrent: negativeMaximum(batteryCurrentExtrema),
    peakBatteryRegenCurrent: negativePeak(batteryCurrentExtrema),
    highestBatteryPower: positiveMaximum(batteryPowerExtrema),
    peakBatteryPower: positivePeak(batteryPowerExtrema),
    highestBatteryRegenPower: negativeMaximum(batteryPowerExtrema),
    peakBatteryRegenPower: negativePeak(batteryPowerExtrema),
    highestFieldWeakeningCurrent: fieldWeakeningExtrema.maximum,
    peakFieldWeakeningCurrent: fieldWeakeningExtrema.peakMaximum,
    highestTempMotor: motorTempExtrema.maximum,
    peakTempMotor: motorTempExtrema.peakMaximum,
    highestTempController: controllerTempExtrema.maximum,
    peakTempController: controllerTempExtrema.peakMaximum,
    totalDistance: rawDistance,
    highestGpsSpeed: gpsSpeedExtrema.maximum,
    peakGpsSpeed: gpsSpeedExtrema.peakMaximum,
    averageSpeedDeviation,
    wheelDiameterFactor,
  };
}

export const RIDE_GAP_THRESHOLD_SECONDS = 60;
export const CHARGE_THRESHOLD_SECONDS = 600;
const DEFAULT_CHARGE_THRESHOLD_VOLTS = 2.5;

export const getChargeThreshold = () => {
  if (!settings.cellCount || !settings.cellMinVolt || !settings.cellMaxVolt) {
    return DEFAULT_CHARGE_THRESHOLD_VOLTS;
  }

  const maxVoltage = settings.cellCount * settings.cellMaxVolt;
  const minVoltage = settings.cellCount * settings.cellMinVolt;
  return (maxVoltage - minVoltage) * 0.1;
};

export interface GpsGap {
  index: number;
  secondsElapsed: number;
}

export function extractGpsInformation(rows: RowWithIndex[], source: DataSource) {
  const gpsPoints: [number, number][] = [];

  // TODO: verify paused sessions from Floaty
  const gpsGaps: GpsGap[] = [{ index: 0, secondsElapsed: 0 }];
  for (let i = 0; i < rows.length; ++i) {
    const prev = rows[i - 1];
    const curr = rows[i]!;

    gpsPoints.push([curr.gps_latitude, curr.gps_longitude]);
    if (prev) {
      const secondsElapsed = curr.time - prev.time;
      if (secondsElapsed > RIDE_GAP_THRESHOLD_SECONDS) {
        gpsGaps.push({ index: i, secondsElapsed });
      }
    }
  }

  // Some logs begin before GNSS has a fix, producing leading (0, 0) values.
  // Replace only the leading invalid points with the first non-zero coordinate
  const firstGoodPointIndex = gpsPoints.findIndex(([lat, lon]) => lat !== 0 || lon !== 0);
  if (firstGoodPointIndex > 0) {
    const firstGoodPoint = gpsPoints[firstGoodPointIndex]!;
    for (let i = 0; i < firstGoodPointIndex; ++i) {
      gpsPoints[i] = firstGoodPoint;
    }
  }

  // When Float Control starts recording a ride, it appears that the first few data points
  // have incorrect GPS data. If it's the start of the ride, it's (0, 0), but if it's a resumed
  // ride, then it seems to be the last known point from the paused ride.
  // Either way, here we attempt to find the first "good" point and use that instead.
  if (source === DataSource.FloatControl) {
    for (let i = 0; i < gpsGaps.length; ++i) {
      const start = gpsGaps[i]!.index;
      const end = gpsGaps[i + 1];
      const curr = rows[start]!;
      const guessedGoodValue = rows.slice(start, end?.index).find((row) => {
        const samePoint = curr.gps_latitude === row.gps_latitude && curr.gps_longitude === row.gps_longitude;
        return row.gps_accuracy > 0 && !samePoint;
      });

      if (guessedGoodValue) {
        for (let j = start; j < guessedGoodValue.index; ++j) {
          gpsPoints[j] = [guessedGoodValue.gps_latitude, guessedGoodValue.gps_longitude];
        }
      }
    }
  }

  return { gpsPoints, gpsGaps };
}

export function hasAdcTelemetry(rows: RowWithIndex[]): boolean {
  return rows.some((row) => row.adc1 !== 0 || row.adc2 !== 0);
}

export function findPointsOfInterest(rows: RowWithIndex[]): PointOfInterest[] {
  const points: PointOfInterest[] = [];
  const adcFaultsEnabled = hasAdcTelemetry(rows);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    let states: string[] = [];

    // fault from VESC
    if (row.state !== 'riding') {
      states.push(row.state);
    }

    // custom footpad faults
    if (adcFaultsEnabled && row.speed > 2) {
      const combinedAdcVoltage = row.adc1 + row.adc2;
      if (combinedAdcVoltage < 2) {
        states.push(State.Custom_NoFootpadsAtSpeed);
      } else if (combinedAdcVoltage < 4) {
        states.push(State.Custom_OneFootpadAtSpeed);
      }
    }

    // inferred charge points
    const prevRow = rows[i - 1];
    if (prevRow !== undefined) {
      const secondsElapsed = row.time - prevRow.time;
      const voltageDifference = row.voltage - prevRow.voltage;
      if (secondsElapsed > CHARGE_THRESHOLD_SECONDS && voltageDifference > getChargeThreshold()) {
        states.push(State.Custom_ChargePoint);
      }
    }

    // SAFETY: since the enum is non-exhaustive, just check it's not in here so
    // any ones we don't know about are shown
    for (const state of states) {
      if (!settings.hiddenStates.includes(state as State)) {
        points.push({ index: i, state });
      }
    }
  }

  return points;
}
