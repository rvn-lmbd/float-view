import { DataSource, State, Units, type RowWithIndex } from '../lib/parse/types';
import { miToKm } from '../lib/misc';
import settings from '../lib/settings.svelte';
import { footpadIsActive } from '../lib/footpad';
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
  energyUsedWh: number;
  energyRegeneratedWh: number;
  netEnergyWh: number;
  netWhPerKm: number;
}

const MAX_STATS_SAMPLE_GAP_SECONDS = 60;
const MAX_SMOOTHING_SAMPLE_GAP_SECONDS = 5;
const MAX_FOOTPAD_FAULT_GAP_SECONDS = 1;
const MIN_CALIBRATION_SPEED_KMH = 5;
const MIN_MOVING_SPEED_KMH = 0;
const MIN_RECENT_CONSUMPTION_SPEED_KMH = 2;
export const ENERGY_CONSUMPTION_WINDOW_KM = 0.05;

/** Typical sample cadence, ignoring long pauses/gaps, for describing frame-based smoothing in real time. */
export function calculateMedianFrameIntervalSeconds(rows: RowWithIndex[]): number {
  const intervals: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const interval = rows[i]!.time - rows[i - 1]!.time;
    if (Number.isFinite(interval) && interval > 0 && interval <= MAX_SMOOTHING_SAMPLE_GAP_SECONDS) {
      intervals.push(interval);
    }
  }
  if (!intervals.length) return NaN;
  intervals.sort((a, b) => a - b);
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 ? intervals[middle]! : (intervals[middle - 1]! + intervals[middle]!) / 2;
}

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

export interface EnergyConsumptionSeries {
  cumulative: number[];
  current: number[];
}

/** Integrate only the portion of an interval where the board is moving above the low-speed cutoff. */
function integrateRecentConsumptionInterval(
  startWatts: number,
  endWatts: number,
  startSpeed: number,
  endSpeed: number,
  elapsedSeconds: number,
  minimumSpeed: number,
  throughFraction = 1,
) {
  if (startSpeed <= minimumSpeed && endSpeed <= minimumSpeed) return { energyWh: 0, distance: 0 };

  let movingStart = 0;
  let movingEnd = 1;
  if (startSpeed <= minimumSpeed || endSpeed <= minimumSpeed) {
    const crossing = (minimumSpeed - startSpeed) / (endSpeed - startSpeed);
    if (startSpeed <= minimumSpeed) movingStart = crossing;
    else movingEnd = crossing;
  }

  const from = movingStart;
  const to = Math.min(movingEnd, throughFraction);
  if (to <= from) return { energyWh: 0, distance: 0 };

  const duration = (to - from) * elapsedSeconds;
  const fromPower = startWatts + (endWatts - startWatts) * from;
  const toPower = startWatts + (endWatts - startWatts) * to;
  const fromSpeed = startSpeed + (endSpeed - startSpeed) * from;
  const toSpeed = startSpeed + (endSpeed - startSpeed) * to;
  return {
    energyWh: ((fromPower + toPower) / 2) * (duration / 3600),
    distance: ((fromSpeed + toSpeed) / 2) * (duration / 3600),
  };
}

/** Cumulative counter-based and centered 50-meter power-integrated net battery consumption. */
export function calculateEnergyConsumptionSeries(
  rows: RowWithIndex[],
  dataUnits: Units = Units.Metric,
): EnergyConsumptionSeries {
  const cumulative = new Array<number>(rows.length).fill(Number.NaN);
  const current = new Array<number>(rows.length).fill(Number.NaN);
  if (rows.length < 2) return { cumulative, current };

  const recordedUsedWh: number[] = [0];
  const recordedRegeneratedWh: number[] = [0];
  const integratedUsedWh: number[] = [0];
  const integratedRegeneratedWh: number[] = [0];
  const recentEnergyWh: number[] = [0];
  const recentDistance: number[] = [0];
  const recentSegmentIds: number[] = [0];
  let recentSegment = 0;
  const recentSpeedThreshold = MIN_RECENT_CONSUMPTION_SPEED_KMH / (dataUnits === Units.Imperial ? 1.609344 : 1);

  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!;
    const current = rows[i]!;
    let recordedUsed = recordedUsedWh[i - 1]!;
    let recordedRegenerated = recordedRegeneratedWh[i - 1]!;
    const usedDelta = current.wh - previous.wh;
    if (usedDelta > 0) recordedUsed += usedDelta;
    if (Number.isFinite(previous.wh_charged) && Number.isFinite(current.wh_charged)) {
      const regeneratedDelta = current.wh_charged! - previous.wh_charged!;
      if (regeneratedDelta > 0) recordedRegenerated += regeneratedDelta;
    }
    recordedUsedWh.push(recordedUsed);
    recordedRegeneratedWh.push(recordedRegenerated);

    let integratedUsed = integratedUsedWh[i - 1]!;
    let integratedRegenerated = integratedRegeneratedWh[i - 1]!;
    const elapsed = current.time - previous.time;
    const previousPower = previous.voltage * previous.current_battery;
    const currentPower = current.voltage * current.current_battery;
    const previousSpeed = Math.abs(previous.speed);
    const currentSpeed = Math.abs(current.speed);
    const recentIntervalIsValid =
      elapsed > 0 &&
      elapsed <= MAX_SMOOTHING_SAMPLE_GAP_SECONDS &&
      Number.isFinite(previousPower) &&
      Number.isFinite(currentPower) &&
      Number.isFinite(previousSpeed) &&
      Number.isFinite(currentSpeed);
    if (recentIntervalIsValid) {
      const interval = integrateRecentConsumptionInterval(
        previousPower,
        currentPower,
        previousSpeed,
        currentSpeed,
        elapsed,
        recentSpeedThreshold,
      );
      recentEnergyWh.push(recentEnergyWh[i - 1]! + interval.energyWh);
      recentDistance.push(recentDistance[i - 1]! + interval.distance);
    } else {
      recentSegment++;
      recentEnergyWh.push(recentEnergyWh[i - 1]!);
      recentDistance.push(recentDistance[i - 1]!);
    }
    recentSegmentIds.push(recentSegment);
    if (elapsed > 0 && elapsed <= MAX_STATS_SAMPLE_GAP_SECONDS) {
      const energy = integrateBatteryEnergy(previousPower, currentPower, elapsed);
      integratedUsed += energy.usedWh;
      integratedRegenerated += energy.regeneratedWh;
    }
    integratedUsedWh.push(integratedUsed);
    integratedRegeneratedWh.push(integratedRegenerated);
  }

  const useRecordedUsed = recordedUsedWh.at(-1)! > 0;
  const useRecordedRegeneration = recordedRegeneratedWh.at(-1)! > 0;
  const baselineDistance = rows[0]!.distance;
  for (let i = 1; i < rows.length; i++) {
    const distance = rows[i]!.distance - baselineDistance;
    const used = useRecordedUsed ? recordedUsedWh[i]! : integratedUsedWh[i]!;
    const regenerated = useRecordedRegeneration ? recordedRegeneratedWh[i]! : integratedRegeneratedWh[i]!;
    const netEnergyWh = used - regenerated;
    if (distance > 0 && Number.isFinite(distance)) cumulative[i] = netEnergyWh / distance;
  }

  const halfWindowDistance = ENERGY_CONSUMPTION_WINDOW_KM / (2 * (dataUnits === Units.Imperial ? 1.609344 : 1));
  const segmentRanges = new Map<number, [number, number]>();
  recentSegmentIds.forEach((segmentId, index) => {
    const range = segmentRanges.get(segmentId);
    if (range) range[1] = index;
    else segmentRanges.set(segmentId, [index, index]);
  });

  const energyAtDistance = (targetDistance: number, segmentStart: number, segmentEnd: number) => {
    if (targetDistance < recentDistance[segmentStart]! || targetDistance > recentDistance[segmentEnd]!) {
      return Number.NaN;
    }

    let low = segmentStart;
    let high = segmentEnd;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (recentDistance[middle]! < targetDistance) low = middle + 1;
      else high = middle;
    }

    const rightIndex = low;
    if (recentDistance[rightIndex] === targetDistance || rightIndex === segmentStart) {
      return recentEnergyWh[rightIndex]!;
    }

    const leftIndex = rightIndex - 1;
    const distanceBeforeInterval = recentDistance[leftIndex]!;
    const distanceInInterval = targetDistance - distanceBeforeInterval;
    const previous = rows[leftIndex]!;
    const next = rows[rightIndex]!;
    const elapsed = next.time - previous.time;
    if (!(elapsed > 0 && elapsed <= MAX_SMOOTHING_SAMPLE_GAP_SECONDS)) return Number.NaN;

    let fractionLow = 0;
    let fractionHigh = 1;
    const previousPower = previous.voltage * previous.current_battery;
    const nextPower = next.voltage * next.current_battery;
    const previousSpeed = Math.abs(previous.speed);
    const nextSpeed = Math.abs(next.speed);
    for (let iteration = 0; iteration < 24; iteration++) {
      const fraction = (fractionLow + fractionHigh) / 2;
      const partial = integrateRecentConsumptionInterval(
        previousPower,
        nextPower,
        previousSpeed,
        nextSpeed,
        elapsed,
        recentSpeedThreshold,
        fraction,
      );
      if (partial.distance < distanceInInterval) fractionLow = fraction;
      else fractionHigh = fraction;
    }

    const partial = integrateRecentConsumptionInterval(
      previousPower,
      nextPower,
      previousSpeed,
      nextSpeed,
      elapsed,
      recentSpeedThreshold,
      (fractionLow + fractionHigh) / 2,
    );
    return recentEnergyWh[leftIndex]! + partial.energyWh;
  };

  for (const [segmentStart, segmentEnd] of segmentRanges.values()) {
    for (let i = segmentStart; i <= segmentEnd; i++) {
      // Keep gaps caused by invalid telemetry visible, but use the available
      // distance at the actual start/end of a ride instead of leaving the
      // centered window undefined there.
      if ((i === segmentStart && segmentStart > 0) || (i === segmentEnd && segmentEnd < rows.length - 1)) {
        continue;
      }

      if (Number.isFinite(rows[i]!.speed) && Math.abs(rows[i]!.speed) <= recentSpeedThreshold) {
        current[i] = 0;
        continue;
      }

      const centerDistance = recentDistance[i]!;
      const segmentStartDistance = recentDistance[segmentStart]!;
      const segmentEndDistance = recentDistance[segmentEnd]!;
      const startDistance = Math.max(segmentStartDistance, centerDistance - halfWindowDistance);
      const endDistance = Math.min(segmentEndDistance, centerDistance + halfWindowDistance);
      const windowDistance = endDistance - startDistance;

      // Wh/km is undefined with no distance to divide by. Since stationary
      // energy is intentionally excluded from this metric, show zero rather
      // than a chart gap when the window contains no qualifying movement.
      if (windowDistance <= 0) {
        current[i] = 0;
        continue;
      }

      const startEnergy = energyAtDistance(startDistance, segmentStart, segmentEnd);
      const endEnergy = energyAtDistance(endDistance, segmentStart, segmentEnd);
      if (Number.isFinite(startEnergy) && Number.isFinite(endEnergy)) {
        current[i] = (endEnergy - startEnergy) / windowDistance;
      }
    }
  }

  return { cumulative, current };
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
  let integratedEnergyUsedWh = 0;
  let integratedEnergyRegeneratedWh = 0;
  let recordedEnergyUsedWh = 0;
  let recordedEnergyRegeneratedWh = 0;
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!;
    const current = rows[i]!;
    const elapsed = current.time - previous.time;
    const usedCounterDelta = current.wh - previous.wh;
    if (usedCounterDelta > 0) recordedEnergyUsedWh += usedCounterDelta;
    if (Number.isFinite(previous.wh_charged) && Number.isFinite(current.wh_charged)) {
      const chargedCounterDelta = current.wh_charged! - previous.wh_charged!;
      if (chargedCounterDelta > 0) recordedEnergyRegeneratedWh += chargedCounterDelta;
    }

    if (!(elapsed > 0) || elapsed > MAX_STATS_SAMPLE_GAP_SECONDS) continue;

    const speedUnitToKmh = dataUnits === Units.Imperial ? 1.609344 : 1;
    const movingSpeed = integrateSpeedWhileMoving(
      Math.abs(previous.speed) * speedUnitToKmh,
      Math.abs(current.speed) * speedUnitToKmh,
      elapsed,
    );
    movingSpeedKmhSeconds += movingSpeed.speedKmhSeconds;
    movingSeconds += movingSpeed.movingSeconds;

    const previousPower = previous.voltage * previous.current_battery;
    const currentPower = current.voltage * current.current_battery;
    const energy = integrateBatteryEnergy(previousPower, currentPower, elapsed);
    integratedEnergyUsedWh += energy.usedWh;
    integratedEnergyRegeneratedWh += energy.regeneratedWh;

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
  const energyUsedWh = recordedEnergyUsedWh > 0 ? recordedEnergyUsedWh : integratedEnergyUsedWh;
  const energyRegeneratedWh =
    recordedEnergyRegeneratedWh > 0 ? recordedEnergyRegeneratedWh : integratedEnergyRegeneratedWh;
  const netEnergyWh = energyUsedWh - energyRegeneratedWh;
  const rawDistance = Math.max(0, (rows.at(-1)?.distance ?? 0) - (rows[0]?.distance ?? 0));
  const distanceKm = dataUnits === Units.Imperial ? miToKm(rawDistance) : rawDistance;

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
    energyUsedWh,
    energyRegeneratedWh,
    netEnergyWh,
    netWhPerKm: distanceKm > 0 ? netEnergyWh / distanceKm : NaN,
  };
}

/** Integrates signed battery watts, treating positive power as energy use and negative power as regeneration. */
function integrateBatteryEnergy(startWatts: number, endWatts: number, elapsedSeconds: number) {
  const totalWh = ((startWatts + endWatts) / 2) * (elapsedSeconds / 3600);
  if (startWatts >= 0 && endWatts >= 0) return { usedWh: totalWh, regeneratedWh: 0 };
  if (startWatts <= 0 && endWatts <= 0) return { usedWh: 0, regeneratedWh: -totalWh };

  const positiveFraction = Math.abs(startWatts) / (Math.abs(startWatts) + Math.abs(endWatts));
  const positiveWh = (0.5 * Math.abs(startWatts) * elapsedSeconds * positiveFraction) / 3600;
  const negativeWh = (0.5 * Math.abs(endWatts) * elapsedSeconds * (1 - positiveFraction)) / 3600;
  return startWatts > 0
    ? { usedWh: positiveWh, regeneratedWh: negativeWh }
    : { usedWh: negativeWh, regeneratedWh: positiveWh };
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

export function findPointsOfInterest(
  rows: RowWithIndex[],
  footpadThresholdVolts = settings.footpadThreshold,
  footpadFaultDebounceMs = settings.footpadFaultDebounceMs,
  hiddenStates: readonly State[] = settings.hiddenStates,
): PointOfInterest[] {
  const points: PointOfInterest[] = [];
  const adcFaultsEnabled = hasAdcTelemetry(rows);
  const addVisiblePoint = (index: number, state: string) => {
    if (!hiddenStates.includes(state as State)) points.push({ index, state });
  };

  // VESC states are repeated in every frame; only keep the first frame of a contiguous event.
  let previousVescState: string = State.Riding;

  let footpadFaultState: State.Custom_OneFootpadAtSpeed | State.Custom_NoFootpadsAtSpeed | undefined;
  let footpadFaultStartIndex = -1;
  let footpadFaultStartTime = Number.NaN;
  let footpadFaultLastTime = Number.NaN;
  const debounceSeconds = Math.max(0, footpadFaultDebounceMs) / 1000;
  const flushFootpadFault = () => {
    if (footpadFaultState && footpadFaultLastTime - footpadFaultStartTime >= debounceSeconds) {
      addVisiblePoint(footpadFaultStartIndex, footpadFaultState);
    }
    footpadFaultState = undefined;
    footpadFaultStartIndex = -1;
    footpadFaultStartTime = Number.NaN;
    footpadFaultLastTime = Number.NaN;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;

    const gapFromPrevious = i > 0 ? row.time - rows[i - 1]!.time : 0;
    if (i === 0 || gapFromPrevious > MAX_STATS_SAMPLE_GAP_SECONDS || gapFromPrevious <= 0) {
      previousVescState = State.Riding;
    }
    if (row.state !== State.Riding && row.state !== previousVescState) addVisiblePoint(i, row.state);
    previousVescState = row.state;

    // custom footpad faults
    let currentFootpadFault: State.Custom_OneFootpadAtSpeed | State.Custom_NoFootpadsAtSpeed | undefined;
    if (adcFaultsEnabled && row.speed > 2) {
      const activeFootpads =
        Number(footpadIsActive(row.adc1, footpadThresholdVolts)) +
        Number(footpadIsActive(row.adc2, footpadThresholdVolts));
      if (activeFootpads === 0) {
        currentFootpadFault = State.Custom_NoFootpadsAtSpeed;
      } else if (activeFootpads === 1) {
        currentFootpadFault = State.Custom_OneFootpadAtSpeed;
      }
    }

    const faultGap = row.time - footpadFaultLastTime;
    if (
      footpadFaultState &&
      (currentFootpadFault !== footpadFaultState ||
        !Number.isFinite(faultGap) ||
        faultGap <= 0 ||
        faultGap > MAX_FOOTPAD_FAULT_GAP_SECONDS)
    ) {
      flushFootpadFault();
    }
    if (currentFootpadFault) {
      if (!footpadFaultState) {
        footpadFaultState = currentFootpadFault;
        footpadFaultStartIndex = i;
        footpadFaultStartTime = row.time;
      }
      footpadFaultLastTime = row.time;
    }

    // inferred charge points
    const prevRow = rows[i - 1];
    if (prevRow !== undefined) {
      const secondsElapsed = row.time - prevRow.time;
      const voltageDifference = row.voltage - prevRow.voltage;
      if (secondsElapsed > CHARGE_THRESHOLD_SECONDS && voltageDifference > getChargeThreshold()) {
        addVisiblePoint(i, State.Custom_ChargePoint);
      }
    }
  }

  flushFootpadFault();
  points.sort((a, b) => a.index - b.index);

  return points;
}

