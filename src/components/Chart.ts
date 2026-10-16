import { Units, type RowWithIndex } from '../lib/parse/types';
import type { Props as ChartProps } from './Chart';
import { calculateEnergyConsumptionSeries, ENERGY_CONSUMPTION_WINDOW_KM } from '../lib/energy';
import settings from '../lib/settings.svelte';
import { globalState } from '../lib/global.svelte';
export { smoothChartValues } from '../lib/smoothing';

export interface Props {
  data: {
    color?: string;
    label?: string;
    values: number[];
  }[];
  xValues?: number[];
  spacingByTime?: boolean;
  smoothingFrames?: number;
  selectedIndex: number;
  setSelectedIdx: (index: number) => void;
  gapIndices: number[];

  yAxis?: TickOptions;
  unit?: string;
  title?: string;
  precision?: number;
  showMax?: boolean | 'nonzero';
  showMin?: boolean | 'nonzero';
  description?: string;
  emptyMessage?: string;
}

// https://tailwindcss.com/docs/customizing-colors
export enum ChartColours {
  Speed = '#fde68a',
  GpsSpeed = '#38bdf8',
  CumulativeEnergy = '#eab308',
  CurrentEnergy = '#38bdf8',
  DutyCycle = '#f472b6',
  BatteryVoltage = '#34d399',
  BatteryWatts = '#eab308',
  Elevation = '#ea580c',
  CurrentMotor = '#67e8f9',
  CurrentBattery = '#a5b4fc',
  TempMotor = '#facc15',
  TempMosfet = '#fb7185',
}

export type ChartFactoryFn = (
  visibleRows: RowWithIndex[],
  allRows?: RowWithIndex[],
) => Omit<ChartProps, 'title' | 'selectedIndex' | 'setSelectedIdx' | 'gapIndices'>;

export const Charts = {
  Speed: (visibleRows) => ({
    data: [
      {
        values: visibleRows.map((x) => globalState.mapSpeed(x.speed)),
        color: ChartColours.Speed,
        label: 'Controller',
      },
      ...(visibleRows.some((x) => Number.isFinite(x.gps_speed))
        ? [
            {
              values: visibleRows.map((x) =>
                Number.isFinite(x.gps_speed) ? globalState.mapSpeed(x.gps_speed!) : Number.NaN,
              ),
              color: ChartColours.GpsSpeed,
              label: 'GPS',
            },
          ]
        : []),
    ],
    precision: 1,
    unit: settings.units === Units.Metric ? ' km/h' : ' mph',
    showMax: true,
    showMin: 'nonzero',
  }),
  'Duty Cycle': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.duty), color: ChartColours.DutyCycle }],
    unit: '%',
    showMax: true,
    showMin: 'nonzero',
  }),
  Elevation: (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.altitude), color: ChartColours.Elevation }],
    unit: 'm',
    showMax: true,
    showMin: true,
  }),
  'Battery Voltage': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.voltage), color: ChartColours.BatteryVoltage }],
    unit: 'V',
    showMax: true,
    showMin: true,
    precision: 1,
    yAxis: { suggestedMin: settings.suggestedVMin, suggestedMax: settings.suggestedVMax },
  }),
  'Battery Watts': (visibleRows) => ({
    data: [{ values: visibleRows.map((x) => x.voltage * x.current_battery), color: ChartColours.BatteryWatts }],
    unit: 'W',
    showMax: true,
    showMin: true,
    precision: 1,
  }),
  'I-Motor / I-Battery': (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.current_motor), color: ChartColours.CurrentMotor, label: 'Motor current' },
      {
        values: visibleRows.map((x) => x.current_battery),
        color: ChartColours.CurrentBattery,
        label: 'Battery current',
      },
    ],
    unit: 'A',
    showMax: true,
    showMin: 'nonzero',
    precision: 1,
  }),
  'T-Motor / T-Controller': (visibleRows) => ({
    data: [
      { values: visibleRows.map((x) => x.temp_motor), color: ChartColours.TempMotor, label: 'Motor temp' },
      { values: visibleRows.map((x) => x.temp_mosfet), color: ChartColours.TempMosfet, label: 'Controller temp' },
    ],
    unit: '°C',
    showMax: true,
    showMin: true,
    precision: 1,
  }),

  'Energy consumption': (visibleRows, allRows = visibleRows) => {
    const energyPerDistance = calculateEnergyConsumptionSeries(allRows, globalState.unitsFromData);
    const cumulativeByIndex = new Map(allRows.map((row, index) => [row.index, energyPerDistance.cumulative[index]!]));
    const currentByIndex = new Map(allRows.map((row, index) => [row.index, energyPerDistance.current[index]!]));
    const convertsDistanceUnits = settings.units !== globalState.unitsFromData;
    const unitFactor = convertsDistanceUnits ? (settings.units === Units.Metric ? 1 / 1.609344 : 1.609344) : 1;
    const mapEfficiency = (value: number | undefined) => (Number.isFinite(value) ? value! * unitFactor : Number.NaN);
    const windowLabel =
      settings.units === Units.Metric
        ? `${ENERGY_CONSUMPTION_WINDOW_KM * 1000} m`
        : `${Math.round((ENERGY_CONSUMPTION_WINDOW_KM / 1.609344) * 5280)} ft`;
    return {
      data: [
        {
          values: visibleRows.map((row) => mapEfficiency(cumulativeByIndex.get(row.index))),
          color: ChartColours.CumulativeEnergy,
          label: 'Cumulative average',
        },
        {
          values: visibleRows.map((row) => mapEfficiency(currentByIndex.get(row.index))),
          color: ChartColours.CurrentEnergy,
          label: `Recent (${windowLabel})`,
        },
      ],
      unit: settings.units === Units.Metric ? ' Wh/km' : ' Wh/mi',
      precision: 1,
      showMax: true,
      showMin: true,
      description: `Cumulative average since the start of the log compared with recent net battery energy per distance. Recent consumption integrates battery voltage × current and controller speed over a centered ${windowLabel} distance window, using half the distance before and after each point. Samples at or below 2 km/h (1.2 mph) are shown as zero; those samples are excluded from both energy and distance to avoid stop/near-stop spikes. Regeneration appears as negative consumption; the cumulative line prefers logged energy counters, otherwise energy is integrated from battery voltage × current. The global Moving Average selector applies to both curves.`,
      emptyMessage: 'Ride distance or battery energy data is not available.',
    };
  },

} satisfies Record<string, ChartFactoryFn>;
export type ChartKey = keyof typeof Charts;
export const chartKeys = Object.keys(Charts);

export interface TickOptions {
  min?: number;
  max?: number;
  suggestedMin?: number;
  suggestedMax?: number;
  maxTicks?: number;
}

/** Keep axis labels short while retaining scale context for very large values. */
export function formatAxisTick(value: number): string {
  const label = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  const digitCount = label.match(/\d/g)?.length ?? 0;
  if (digitCount <= 4) return label;

  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumSignificantDigits: 3,
  }).format(value);
}

export const ticks = (values: number[], opts: TickOptions = {}): number[] => {
  const valuesWithoutNan = values.filter((x) => !Number.isNaN(x));
  const min =
    opts.min ?? Math.min(...valuesWithoutNan, ...(opts.suggestedMin !== undefined ? [opts.suggestedMin] : []));
  const max =
    opts.max ?? Math.max(...valuesWithoutNan, ...(opts.suggestedMax !== undefined ? [opts.suggestedMax] : []));
  const maxTicks = opts.maxTicks ?? 10;

  const niceNum = (range: number, round: boolean) => {
    const magnitude = 10 ** Math.floor(Math.log10(range));
    const fraction = range / magnitude;
    const roundFactor = round ? 1.5 : 1;
    const niceFraction =
      fraction < 1 * roundFactor ? 1 : fraction < 2 * roundFactor ? 2 : fraction < 5 * roundFactor ? 5 : 10;
    return niceFraction * magnitude;
  };

  const range = niceNum(max - min, false);
  const tickSpacing = niceNum(range / (maxTicks - 1), true);
  const niceMin = Math.floor(min / tickSpacing) * tickSpacing;
  const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;

  const result: number[] = [];
  let n = niceMin;
  while (n <= niceMax) {
    if ((opts.min === undefined || n >= opts.min) && (opts.max === undefined || n <= opts.max)) result.push(n);
    n += tickSpacing;
  }
  if (max > niceMax) result.push(n);
  while (result[0] && min < result[0]) result.unshift(result[0] - tickSpacing);

  if (!result.length) {
    return [0, 100];
  }

  return result;
};

