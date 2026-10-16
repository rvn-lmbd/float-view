import { Units, type RowWithIndex } from './parse/types';

export const ENERGY_CONSUMPTION_WINDOW_KM = 0.05;
const MAX_ENERGY_TOTAL_GAP_SECONDS = 60;
const MAX_ENERGY_WINDOW_GAP_SECONDS = 5;
const MIN_RECENT_CONSUMPTION_SPEED_KMH = 2;

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
      elapsed <= MAX_ENERGY_WINDOW_GAP_SECONDS &&
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
    if (elapsed > 0 && elapsed <= MAX_ENERGY_TOTAL_GAP_SECONDS) {
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
    if (!(elapsed > 0 && elapsed <= MAX_ENERGY_WINDOW_GAP_SECONDS)) return Number.NaN;

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

/** Integrates signed battery watts, treating positive power as energy use and negative power as regeneration. */
export function integrateBatteryEnergy(startWatts: number, endWatts: number, elapsedSeconds: number) {
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

/** Prefer logged cumulative Wh counters; fall back to integrating signed battery power across valid sample intervals. */
export function calculateBatteryEnergyTotals(
  rows: RowWithIndex[],
  maximumGapSeconds = MAX_ENERGY_TOTAL_GAP_SECONDS,
) {
  let integratedUsedWh = 0;
  let integratedRegeneratedWh = 0;
  let recordedUsedWh = 0;
  let recordedRegeneratedWh = 0;
  for (let i = 1; i < rows.length; i++) {
    const previous = rows[i - 1]!;
    const current = rows[i]!;
    const usedCounterDelta = current.wh - previous.wh;
    if (usedCounterDelta > 0) recordedUsedWh += usedCounterDelta;
    if (Number.isFinite(previous.wh_charged) && Number.isFinite(current.wh_charged)) {
      const chargedCounterDelta = current.wh_charged! - previous.wh_charged!;
      if (chargedCounterDelta > 0) recordedRegeneratedWh += chargedCounterDelta;
    }
    const elapsed = current.time - previous.time;
    if (elapsed > 0 && elapsed <= maximumGapSeconds) {
      const energy = integrateBatteryEnergy(
        previous.voltage * previous.current_battery,
        current.voltage * current.current_battery,
        elapsed,
      );
      integratedUsedWh += energy.usedWh;
      integratedRegeneratedWh += energy.regeneratedWh;
    }
  }
  return {
    energyUsedWh: recordedUsedWh > 0 ? recordedUsedWh : integratedUsedWh,
    energyRegeneratedWh: recordedRegeneratedWh > 0 ? recordedRegeneratedWh : integratedRegeneratedWh,
  };
}