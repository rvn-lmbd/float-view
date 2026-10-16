<script lang="ts" module>
  import { RowKey, Units, type RowWithIndex } from '../lib/parse/types';
  import type { RideStats } from './View';

  export interface Props {
    data: RowWithIndex | undefined;
    stats: RideStats;
    batterySpecs: ZBatterySpecs;
    units: Units;
    hasAdcTelemetry: boolean;
  }
</script>

<script lang="ts">
  import Footpads from './Footpads.svelte';
  import List from './List.svelte';
  import Pitch from './Pitch.svelte';
  import Roll from './Roll.svelte';
  import settings, { type ZBatterySpecs } from '../lib/settings.svelte';
  import Button from './Button.svelte';
  import { ChartColours } from './Chart';
  import { empty } from '../lib/parse/types';
  import { formatFloat, formatInt, formatTime } from '../lib/misc';
  import { globalState } from '../lib/global.svelte';
  import { getStateColor } from './Details';

  let { data = empty, stats, batterySpecs, units, hasAdcTelemetry }: Props = $props();

  let showStats = $state(false);

  let voltsPerCell = $derived(batterySpecs.cellCount ? data.voltage / batterySpecs.cellCount : NaN);
  let cellVoltsLow = $derived(voltsPerCell && batterySpecs.cellMinVolt && voltsPerCell < batterySpecs.cellMinVolt);
  let formatSpeed = $derived((x: number) => (Number.isNaN(x) ? '??' : globalState.mapSpeed(x).toFixed(1)));
  let showMovingAveragePeaks = $derived(settings.chartSmoothingFrames > 1);
  const formatWithPeak = (value: number, peak: number, unit: string) =>
    `${formatFloat(value)}${unit}${showMovingAveragePeaks ? ` (${formatFloat(peak)}${unit})` : ''}`;

  const itemClass =
    'text-xs wide:text-sm relative bg-slate-900 text-slate-100 flex justify-around items-center h-full w-full';
</script>

<div
  class="relative h-full w-full bg-slate-600 grid gap-px place-items-center
  grid-cols-[repeat(2,minmax(0,1fr))]
  grid-rows-[repeat(3,minmax(0,1fr))]
  wide:grid-cols-[repeat(3,minmax(0,1fr))]
  wide:grid-rows-[repeat(2,minmax(0,1fr))]"
>
  {#if showStats && showMovingAveragePeaks}
    <p class="absolute inset-x-2 top-1 z-20 text-center text-[10px] text-slate-400 pointer-events-none">
      Maxima use the selected {settings.chartSmoothingFrames}-frame moving average; parentheses show absolute 1-frame
      peaks.
    </p>
  {/if}
  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Total Half Faults (at speed)',
            value: formatInt(stats.totalHalfFaults),
          },
          {
            label: 'Total Full Faults',
            value: formatInt(stats.totalFullFaults),
          },
          {
            label: 'Total Quick Stops',
            value: formatInt(stats.totalQuickStops),
          },
        ]}
      />
    {:else}
      <Footpads {data} {hasAdcTelemetry} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Pitch',
            value: formatWithPeak(stats.highestPitch, stats.peakHighestPitch, '°'),
          },
          {
            label: 'Lowest Pitch',
            value: formatWithPeak(stats.lowestPitch, stats.peakLowestPitch, '°'),
          },
        ]}
      />
    {:else}
      <Pitch {data} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Roll',
            value: formatWithPeak(stats.highestRoll, stats.peakHighestRoll, '°'),
          },
          {
            label: 'Lowest Roll',
            value: formatWithPeak(stats.lowestRoll, stats.peakLowestRoll, '°'),
          },
        ]}
      />
    {:else}
      <Roll {data} />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Controller Speed',
            value: `${formatSpeed(stats.highestSpeed)}${showMovingAveragePeaks ? ` (${formatSpeed(stats.peakSpeed)})` : ''} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
          },
          {
            label: 'Average Controller Speed',
            value: `${formatSpeed(stats.averageSpeed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
          },
          {
            label: 'Average Controller Speed (moving)',
            value: `${formatSpeed(stats.averageMovingSpeed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
            htmlTitle:
              'Time-weighted controller speed while moving faster than 0 km/h; intervals at zero speed are excluded.',
          },
          ...(Number.isFinite(stats.highestGpsSpeed)
            ? [
                {
                  label: 'Highest GPS Speed',
                  value: `${formatSpeed(stats.highestGpsSpeed)}${showMovingAveragePeaks ? ` (${formatSpeed(stats.peakGpsSpeed)})` : ''} ${units === Units.Metric ? 'km/h' : 'mph'}`,
                  color: ChartColours.GpsSpeed,
                },
              ]
            : []),
          ...(Number.isFinite(stats.averageSpeedDeviation)
            ? [
                {
                  label: 'Avg Speed Difference',
                  value: `${formatSpeed(stats.averageSpeedDeviation)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
                  color: ChartColours.GpsSpeed,
                  htmlTitle: 'Mean absolute GPS/controller speed difference while both speeds are at least 5 km/h.',
                },
              ]
            : []),
          ...(Number.isFinite(stats.wheelDiameterFactor)
            ? [
                {
                  label: 'Wheel Diameter Factor',
                  value: `×${stats.wheelDiameterFactor.toFixed(3)}`,
                  htmlTitle:
                    'Multiply the current VESC Tool wheel diameter by this factor. Calculated from GPS/controller distance while both speeds are at least 5 km/h.',
                },
              ]
            : []),
          ...(data.erpm !== undefined
            ? [
                {
                  label: 'Highest ERPM',
                  value: `${formatInt(stats.highestErpm)}${showMovingAveragePeaks ? ` (${formatInt(stats.peakErpm)})` : ''}`,
                },
              ]
            : []),
          {
            label: 'Total Distance',
            value: `${formatFloat(globalState.mapSpeed(stats.totalDistance))} ${units === Units.Metric ? 'km' : 'mi'}`,
          },
          '-',
          {
            label: 'Time (index)',
            value: `${formatTime(data[RowKey.Time])} (${formatInt(data.index + 1)})`,
            htmlTitle:
              'Time from log (index is the line number from the CSV file, or the specific log from the JSON file)',
          },
          { value: swapDetailsButton },
        ]}
      />{:else}
      <List
        items={[
          {
            label: 'Controller Speed',
            value: `${formatSpeed(data.speed)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
            color: ChartColours.Speed,
          },
          ...(Number.isFinite(data.gps_speed)
            ? [
                {
                  label: 'GPS Speed',
                  value: `${formatSpeed(data.gps_speed!)} ${units === Units.Metric ? 'km/h' : 'mph'}`,
                  color: ChartColours.GpsSpeed,
                },
              ]
            : []),
          ...(data.erpm !== undefined ? [{ label: 'ERPM', value: `${data.erpm}` }] : []),
          { label: 'Distance', value: `${formatSpeed(data.distance)} ${units === Units.Metric ? 'km' : 'mi'}` },
          '-',
          { label: 'State', value: data.state.toUpperCase(), color: getStateColor(data.state) },
          {
            label: 'Time (index)',
            value: `${formatTime(data[RowKey.Time])} (${formatInt(data.index + 1)})`,
            htmlTitle:
              'Time from log (index is the line number from the CSV file, or the specific log from the JSON file)',
          },
          { value: swapDetailsButton },
        ]}
      />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Duty',
            value: formatWithPeak(stats.highestDuty, stats.peakDuty, '%'),
            color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
          },
          {
            label: 'Average Duty',
            value: `${formatFloat(stats.averageDuty)}%`,
            color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
          },
          {
            label: 'Highest Motor Current',
            value: formatWithPeak(stats.highestMotorCurrent, stats.peakMotorCurrent, ' A'),
            color: ChartColours.CurrentMotor,
          },
          {
            label: 'Highest Motor Regen Current',
            value: formatWithPeak(stats.highestMotorRegenCurrent, stats.peakMotorRegenCurrent, ' A'),
            color: ChartColours.CurrentMotor,
          },
          {
            label: 'Highest Motor Power (est.)',
            value: formatWithPeak(stats.highestMotorPower, stats.peakMotorPower, ' W'),
            htmlTitle: 'Estimated as battery voltage × duty fraction × motor phase current.',
          },
          {
            label: 'Highest Motor Regen Power (est.)',
            value: formatWithPeak(stats.highestMotorRegenPower, stats.peakMotorRegenPower, ' W'),
            htmlTitle: 'Magnitude of negative estimated motor power; estimated as voltage × duty × phase current.',
          },
          ...(data.current_field_weakening !== undefined
            ? [
                {
                  label: 'Highest Field Weakening',
                  value: formatWithPeak(stats.highestFieldWeakeningCurrent, stats.peakFieldWeakeningCurrent, ' A'),
                  color: ChartColours.CurrentMotor,
                },
              ]
            : []),
          {
            label: 'Highest Temp Motor',
            value: formatWithPeak(stats.highestTempMotor, stats.peakTempMotor, '°C'),
            color: ChartColours.TempMotor,
          },
          {
            label: 'Highest Temp Controller',
            value: formatWithPeak(stats.highestTempController, stats.peakTempController, '°C'),
            color: ChartColours.TempMosfet,
          },
        ]}
      />
    {:else}
      <List
        items={[
          {
            label: 'Duty',
            value: `${formatFloat(data.duty)}%`,
            color: data.duty > 80 ? 'red' : ChartColours.DutyCycle,
          },
          {
            label: 'Motor Current',
            value: `${formatFloat(data.current_motor)} A`,
            color: ChartColours.CurrentMotor,
          },
          {
            label: 'Motor Power (est.)',
            value: `${formatFloat(data.voltage * (data.duty / 100) * data.current_motor)} W`,
            htmlTitle:
              'Estimated electrical power: battery voltage × duty fraction × motor phase current; not shaft output power.',
          },
          ...(data.current_field_weakening !== undefined
            ? [
                {
                  label: 'Field Weakening',
                  value: `${formatFloat(data.current_field_weakening)} A`,
                  color: ChartColours.CurrentMotor,
                },
              ]
            : []),
          '-',
          { label: 'Temp Motor', value: `${formatFloat(data.temp_motor)}°C`, color: ChartColours.TempMotor },
          { label: 'Temp Controller', value: `${formatFloat(data.temp_mosfet)}°C`, color: ChartColours.TempMosfet },
        ]}
      />
    {/if}
  </div>

  <div class={itemClass}>
    {#if showStats}
      <List
        items={[
          {
            label: 'Highest Battery Current',
            value: formatWithPeak(stats.highestBatteryCurrent, stats.peakBatteryCurrent, ' A'),
            color: ChartColours.CurrentBattery,
          },
          {
            label: 'Highest Battery Regen Current',
            value: formatWithPeak(stats.highestBatteryRegenCurrent, stats.peakBatteryRegenCurrent, ' A'),
            color: ChartColours.CurrentBattery,
          },
          {
            label: 'Highest Battery Power',
            value: formatWithPeak(stats.highestBatteryPower, stats.peakBatteryPower, ' W'),
          },
          {
            label: 'Highest Battery Regen Power',
            value: formatWithPeak(stats.highestBatteryRegenPower, stats.peakBatteryRegenPower, ' W'),
          },
        ]}
      />
    {:else}
      <List
        items={[
          { label: 'Spec', value: batterySpecs.cellCount ? `${batterySpecs.cellCount}S` : configureButton },
          '-',
          {
            label: 'Batt V (total)',
            value: `${formatFloat(data.voltage)} V`,
            color: ChartColours.BatteryVoltage,
          },
          {
            label: 'Batt V (cell)',
            value: `${voltsPerCell ? voltsPerCell.toFixed(1) : '??'} V`,
            color: cellVoltsLow ? 'red' : ChartColours.BatteryVoltage,
          },
          {
            label: 'Batt Current',
            value: `${formatFloat(data.current_battery)} A`,
            color: ChartColours.CurrentBattery,
          },
          {
            label: 'Batt Power',
            value: `${formatFloat(data.current_battery * data.voltage)} W`,
            htmlTitle: 'Signed battery electrical power: positive is energy use, negative is regeneration.',
          },
        ]}
      />
    {/if}
  </div>
</div>

{#snippet configureButton()}
  <Button onclick={() => (settings.open = true)}>set</Button>
{/snippet}

{#snippet swapDetailsButton()}
  {#if showStats}
    <Button onclick={() => (showStats = false)}>Show Point Stats</Button>
  {:else}
    <Button onclick={() => (showStats = true)}>Show Ride Stats</Button>
  {/if}
{/snippet}

