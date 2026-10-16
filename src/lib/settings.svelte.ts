import { z } from 'zod';
import { State, Units } from './parse/types';
import { type ChartKey } from '../components/Chart';
import {
  DEFAULT_FOOTPAD_FAULT_DEBOUNCE_MS,
  DEFAULT_FOOTPAD_THRESHOLD_VOLTS,
  normalizeFootpadThreshold,
} from './footpad';

type SelectedCharts = [ChartKey, ChartKey, ChartKey, ChartKey, ChartKey, ChartKey];
export const defaultSelectedCharts = Object.freeze([
  'Speed',
  'Duty Cycle',
  'Battery Voltage',
  'Elevation',
  'I-Motor / I-Battery',
  'T-Motor / T-Controller',
]) as SelectedCharts;

const BatterySpecsSchema = z.object({
  cellCount: z.coerce.number().nullish(),
  cellMinVolt: z.coerce.number().nullish(),
  cellMaxVolt: z.coerce.number().nullish(),
});
export type ZBatterySpecs = z.infer<typeof BatterySpecsSchema>;

const HiddenStateSchema = z.nativeEnum(State).array();
const UnitsSchema = z.nativeEnum(Units);

const SavedSettingsSchema = z.object({
  batterySpecs: BatterySpecsSchema,
  hiddenStates: HiddenStateSchema,
  mapIconsGreyscale: z.boolean().default(false),
  chartSpacingByTime: z.boolean().default(false),
  units: UnitsSchema,
  charts: z.string().array(),
  footpadThresholdVolts: z.number().finite().min(0).max(3.3).catch(DEFAULT_FOOTPAD_THRESHOLD_VOLTS),
  footpadFaultDebounceMs: z.number().finite().min(0).max(2000).catch(DEFAULT_FOOTPAD_FAULT_DEBOUNCE_MS),
});
type ZSavedSettings = z.infer<typeof SavedSettingsSchema>;

export const localStorageKey = 'fv_settings';
const savedSettings: ZSavedSettings | undefined = (() => {
  const value = window.localStorage.getItem(localStorageKey);
  try {
    if (typeof value === 'string' && value.length > 0) {
      const json = JSON.parse(value);
      return SavedSettingsSchema.parse(json);
    }
  } catch (err) {
    console.error('Failed to parse saved settings', err, value);
    window.localStorage.removeItem(localStorageKey);
  }
})();

const settings = new (class {
  /** whether the settings modal is open */
  open = $state(false);

  /** user selected units */
  units = $state(savedSettings?.units ?? Units.Metric);
  /** faults to hide from the map */
  hiddenStates = $state<State[]>(savedSettings?.hiddenStates ?? [State.Startup, State.StopHalf]);

  /** user-defined cell count */
  cellCount = $state<number | undefined>(savedSettings?.batterySpecs.cellCount ?? undefined);
  /** user-defined cell min voltage */
  cellMinVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMinVolt ?? undefined);
  /** user-defined cell max voltage */
  cellMaxVolt = $state<number | undefined>(savedSettings?.batterySpecs.cellMaxVolt ?? undefined);

  /** ADC voltage below which a footpad is treated as inactive */
  footpadThresholdVolts = $state(savedSettings?.footpadThresholdVolts ?? DEFAULT_FOOTPAD_THRESHOLD_VOLTS);
  /** How long an at-speed footpad fault must persist before it is recorded as an event. */
  footpadFaultDebounceMs = $state(savedSettings?.footpadFaultDebounceMs ?? DEFAULT_FOOTPAD_FAULT_DEBOUNCE_MS);

  /** user selected charts */
  charts = $state<SelectedCharts>((savedSettings?.charts as SelectedCharts) ?? [...defaultSelectedCharts]);

  /** whether icons in map should be greyed out */
  mapIconsGreyscale = $state(savedSettings?.mapIconsGreyscale ?? false);

  /** whether chart x-axis spacing should be proportional to time */
  chartSpacingByTime = $state(savedSettings?.chartSpacingByTime ?? false);

  /*
   * derived state
   */

  suggestedVMin = $derived(this.cellCount && this.cellMinVolt ? this.cellCount * this.cellMinVolt : undefined);
  suggestedVMax = $derived(this.cellCount && this.cellMaxVolt ? this.cellCount * this.cellMaxVolt : undefined);
  batterySpecs = $derived<ZBatterySpecs>({
    cellCount: this.cellCount,
    cellMinVolt: this.cellMinVolt,
    cellMaxVolt: this.cellMaxVolt,
  });
  footpadThreshold = $derived(normalizeFootpadThreshold(this.footpadThresholdVolts));

  /** serialised settings */
  storedSettings = $derived(
    JSON.stringify({
      batterySpecs: this.batterySpecs,
      hiddenStates: this.hiddenStates,
      mapIconsGreyscale: this.mapIconsGreyscale,
      chartSpacingByTime: this.chartSpacingByTime,
      units: this.units,
      charts: this.charts,
      footpadThresholdVolts: this.footpadThreshold,
      footpadFaultDebounceMs: this.footpadFaultDebounceMs,
    } satisfies ZSavedSettings),
  );
})();

export default settings;

