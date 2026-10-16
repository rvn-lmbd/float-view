<script lang="ts" module>
  import Button from './Button.svelte';
  import { demoFile } from '../lib/parse/float-control';
  import settings from '../lib/settings.svelte';

  export interface Props {
    file: File | undefined;
    trimSliderOpen: boolean;
    frameIntervalSeconds: number;
  }
</script>

<script lang="ts">
  let { file = $bindable(), trimSliderOpen = $bindable(), frameIntervalSeconds }: Props = $props();

  const closeRide = () => (file = undefined);
  const toggleTrimSlider = () => (trimSliderOpen = !trimSliderOpen);
  const describeWindow = (frames: number) => {
    if (frames === 1) return 'off';
    const seconds = (frames - 1) * frameIntervalSeconds;
    if (!Number.isFinite(seconds) || seconds <= 0) return `${frames} frames`;
    const duration = seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(1)} s`;
    return `${frames} frames (~${duration})`;
  };
</script>

<div class="fixed z-[9000] h-[calc(var(--header-height)+1000px)] top-[-1000px] left-0 right-0 bg-slate-950">
  <!-- hack to stop mobiles with notches from showing content as they scroll -->
</div>

<header
  class="sticky z-[10000] top-0 flex justify-between items-center
  gap-4 bg-slate-950 border-b h-[--header-height] px-4 whitespace-nowrap"
>
  <h1 class="font-bold text-lg grow flex flex-rol justify-start">
    Float View
    {#if file === demoFile}
      <span class="w-[1px] text-xs font-mono text-fuchsia-500"> (demo) </span>
    {/if}
  </h1>
  <label
    class="flex flex-row items-center gap-2 text-xs text-slate-300"
    title="Centered moving-average window used by all graphs. Its approximate time span is estimated from the loaded log's median frame interval."
  >
    <span>moving avg</span>
    <select
      aria-label="Graph moving average"
      class="rounded border bg-slate-700 px-2 py-1 text-slate-100"
      value={String(settings.chartSmoothingFrames)}
      onchange={(event) => (settings.chartSmoothingFrames = Number(event.currentTarget.value) as 1 | 3 | 5 | 9 | 15)}
    >
      <option value="1">{describeWindow(1)}</option>
      <option value="3">{describeWindow(3)}</option>
      <option value="5">{describeWindow(5)}</option>
      <option value="9">{describeWindow(9)}</option>
      <option value="15">{describeWindow(15)}</option>
    </select>
  </label>
  {#if file}
    <Button data-testid="close-ride-button" onclick={closeRide}>close ride</Button>
    <div class="hidden wide:block">
      <Button onclick={toggleTrimSlider}>trim</Button>
    </div>
  {/if}
  <Button onclick={() => (settings.open = true)}>configure</Button>
</header>

