<script lang="ts">
  import { untrack } from 'svelte';
  import { State, Units } from '../lib/parse/types';
  import Input from './Input.svelte';
  import { getIcon } from './Map';
  import Modal from './Modal.svelte';
  import settings, { localStorageKey } from '../lib/settings.svelte';
  import type { ChangeEventHandler } from 'svelte/elements';
  import Button from './Button.svelte';

  let draftUnits = $state<Units>(settings.units);
  let draftHiddenStates = $state<State[]>([...settings.hiddenStates]);
  let draftCellCount = $state<number | undefined>(settings.cellCount);
  let draftCellMinVolt = $state<number | undefined>(settings.cellMinVolt);
  let draftCellMaxVolt = $state<number | undefined>(settings.cellMaxVolt);
  let draftFootpadThresholdVolts = $state(settings.footpadThresholdVolts);
  let draftFootpadHalfFaultDelayMs = $state(settings.footpadHalfFaultDelayMs);
  let draftFootpadFullFaultDelayMs = $state(settings.footpadFullFaultDelayMs);
  let draftMapIconsGreyscale = $state(settings.mapIconsGreyscale);
  let draftChartSpacingByTime = $state(settings.chartSpacingByTime);
  let wasOpen = false;

  let isImperial = $derived(draftUnits === Units.Imperial);

  $effect(() => {
    const isOpen = settings.open;
    if (isOpen && !wasOpen) {
      untrack(() => {
        draftUnits = settings.units;
        draftHiddenStates = [...settings.hiddenStates];
        draftCellCount = settings.cellCount;
        draftCellMinVolt = settings.cellMinVolt;
        draftCellMaxVolt = settings.cellMaxVolt;
        draftFootpadThresholdVolts = settings.footpadThresholdVolts;
        draftFootpadHalfFaultDelayMs = settings.footpadHalfFaultDelayMs;
        draftFootpadFullFaultDelayMs = settings.footpadFullFaultDelayMs;
        draftMapIconsGreyscale = settings.mapIconsGreyscale;
        draftChartSpacingByTime = settings.chartSpacingByTime;
      });
    }
    wasOpen = isOpen;
  });

  $effect(() => {
    window.localStorage.setItem(localStorageKey, settings.storedSettings);
  });

  const inputClass = 'w-[70%] m-px';

  const onchangeUnits: ChangeEventHandler<HTMLInputElement> = (e) => {
    draftUnits = isImperial ? Units.Metric : Units.Imperial;
  };

  const applyAndClose = () => {
    settings.units = draftUnits;
    settings.hiddenStates = [...draftHiddenStates];
    settings.cellCount = draftCellCount;
    settings.cellMinVolt = draftCellMinVolt;
    settings.cellMaxVolt = draftCellMaxVolt;
    settings.footpadThresholdVolts = draftFootpadThresholdVolts;
    settings.footpadHalfFaultDelayMs = draftFootpadHalfFaultDelayMs;
    settings.footpadFullFaultDelayMs = draftFootpadFullFaultDelayMs;
    settings.mapIconsGreyscale = draftMapIconsGreyscale;
    settings.chartSpacingByTime = draftChartSpacingByTime;
    settings.open = false;
  };
</script>

<Modal open={settings.open} closeHandler={applyAndClose} closeText="Apply and close" title="Settings">
  <div class="h-full w-full flex flex-col justify-start items-center">
    <h3 class="font-bold text-lg my-2">General</h3>
    <Input
      class={inputClass}
      id="units"
      label="Use Imperial Units"
      type="checkbox"
      checked={isImperial}
      onchange={onchangeUnits}
    />
    <h3 class="font-bold text-lg my-2">Battery Specs</h3>
    <p>
      The following options help with calculating the voltage per cell, as well as configuring the voltage chart's axis
      limits.
    </p>
    <Input
      class={inputClass}
      id="cell_count"
      label="Cell Count"
      type="number"
      placeholder="20"
      bind:value={draftCellCount}
    />
    <Input
      class={inputClass}
      id="cell_min_v"
      label="Cell Min Voltage"
      type="number"
      placeholder="3.0"
      step="0.1"
      bind:value={draftCellMinVolt}
    />
    <Input
      class={inputClass}
      id="cell_max_v"
      label="Cell Max Voltage"
      type="number"
      placeholder="4.2"
      step="0.1"
      bind:value={draftCellMaxVolt}
    />
    <h3 class="font-bold text-lg my-2">Footpad Sensors</h3>
    <p>ADC voltage below this value marks a footpad as inactive while riding.</p>
    <Input
      class={inputClass}
      id="footpad_threshold"
      label="Inactive below (V)"
      type="number"
      min="0"
      max="3.3"
      step="0.1"
      bind:value={draftFootpadThresholdVolts}
    />
    <p class="mt-2">
      Mirrors Refloat Cfg → General → Specs → Foot Sensors: ADC1 Switch Voltage (<code>fault_adc1</code>) and ADC2 Switch
      Voltage (<code>fault_adc2</code>). Both default to 2 V.
    </p>
    <p class="mt-2">
      Mirrors Refloat Cfg → General → Stop → Switches: Half Switch Fault Delay
      (<code>fault_delay_switch_half</code>) and Full Switch Fault Delay (<code>fault_delay_switch_full</code>). Both
      default to 250 ms.
    </p>
    <Input
      class={inputClass}
      id="footpad_half_fault_delay"
      label="Half Switch Fault Delay (ms)"
      type="number"
      min="0"
      max="2000"
      step="25"
      bind:value={draftFootpadHalfFaultDelayMs}
    />
    <Input
      class={inputClass}
      id="footpad_full_fault_delay"
      label="Full Switch Fault Delay (ms)"
      type="number"
      min="0"
      max="2000"
      step="25"
      bind:value={draftFootpadFullFaultDelayMs}
    />
    <h3 class="font-bold text-lg my-2">Map Options</h3>
    <Input
      class={inputClass}
      id="map_greyscale_icons"
      label="Unreached markers greyed out"
      title="When moving the rider across the map, markers that the ride has not yet reached will be greyed out."
      type="checkbox"
      bind:checked={draftMapIconsGreyscale}
    />
    <h3 class="font-bold text-lg my-2">Chart Options</h3>
    <Input
      class={inputClass}
      id="chart_spacing_by_time"
      label="Space chart points by time"
      title="When enabled, distances between chart points are proportional to elapsed time between log entries."
      type="checkbox"
      bind:checked={draftChartSpacingByTime}
    />
    <h4 class="font-bold text-md my-2">Visible map markers</h4>
    <ul class="text-left select-none">
      {#each Object.values(State) as state}
        {#if state !== State.Riding}
          {@const checked = !draftHiddenStates.includes(state)}
          {@const { icon, className } = getIcon(state)}
          {@const html = icon.createIcon().innerHTML.trim()}
          <li class="flex flex-rol justify-start items-center gap-2">
            <input
              type="checkbox"
              id="map_{state}"
              {checked}
              onchange={() => {
                if (draftHiddenStates.includes(state)) {
                  draftHiddenStates = draftHiddenStates.filter((s) => s !== state);
                } else {
                  draftHiddenStates = draftHiddenStates.concat(state);
                }
              }}
            />
            <div class="w-4 h-4 state-icon {className} {html ? 'svg' : ''}">
              {#if html}
                {@html html}
              {:else}
                &nbsp;
              {/if}
            </div>

            <label for="map_{state}">{state}</label>
          </li>
        {/if}
      {/each}
    </ul>

    <div class="grow flex flex-col justify-around items-center">
      <hr />
      <p>
        <strong>TIP:</strong> use the left and right arrows to step through one data point at a time!
      </p>
    </div>

    <div class="flex flex-row justify-center align-center">
      <a href="/float-view/?app=renderer">
        <Button>Looking for Float Renderer? Click here!</Button>
      </a>
    </div>

    {#if window.location.href.includes('test')}
      <div class="mt-2 flex flex-row gap-2">
        <Button onclick={() => window.location.reload()}>Reload</Button>
        <Button onclick={() => (window.location.href = window.location.href.split('?')[0] + '?t=' + Date.now())}
          >Revisit</Button
        >
      </div>
    {/if}
  </div>
</Modal>

