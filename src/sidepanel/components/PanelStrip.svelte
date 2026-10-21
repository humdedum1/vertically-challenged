<script lang="ts" module>
import type { IconName } from './Icon.svelte';

export interface PanelDef<I extends string> {
  id: I;
  label: string;
  icon: IconName;
}
</script>

<script lang="ts" generics="Id extends string">
import { tick } from 'svelte';
import Icon from './Icon.svelte';

interface Props {
  panels: readonly PanelDef<Id>[];
  selected: Id;
  onselect: (id: Id) => void;
}

let { panels, selected, onselect }: Props = $props();

let strip: HTMLDivElement | undefined = $state();

/**
 * How much label the strip can afford: every label, only the selected pill's, or icons
 * only. Hidden labels stay as the button's accessible name (and its tooltip), so a
 * narrow panel still shows every panel instead of scrolling some out of sight.
 */
let fit = $state<'full' | 'compact' | 'icons'>('full');
const labelHidden = (id: Id) => fit === 'icons' || (fit === 'compact' && id !== selected);

async function refit(): Promise<void> {
  for (const level of ['full', 'compact', 'icons'] as const) {
    fit = level;
    await tick();
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
  }
}

$effect(() => {
  if (!strip) return;
  const ro = new ResizeObserver(() => void refit());
  ro.observe(strip);
  return () => ro.disconnect();
});

// The selected pill's label decides whether the compact strip fits.
$effect(() => {
  void selected;
  void panels.length;
  void refit();
});

// Selected pill must stay visible when the strip overflows (and when selection changes via Back).
$effect(() => {
  const id = selected;
  void tick().then(() => strip?.querySelector(`#vc-tab-${id}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));
});

function onkeydown(e: KeyboardEvent): void {
  const i = panels.findIndex((p) => p.id === selected);
  let n: number;
  switch (e.key) {
    case 'ArrowRight':
      n = (i + 1) % panels.length;
      break;
    case 'ArrowLeft':
      n = (i - 1 + panels.length) % panels.length;
      break;
    case 'Home':
      n = 0;
      break;
    case 'End':
      n = panels.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  const p = panels[n];
  if (!p) return;
  onselect(p.id);
  // Automatic activation: focus follows selection.
  void tick().then(() => strip?.querySelector<HTMLElement>(`#vc-tab-${p.id}`)?.focus());
}
</script>

<div class="strip" role="tablist" aria-label="Panels" tabindex="-1" bind:this={strip} {onkeydown}>
  {#each panels as p (p.id)}
    <button
      type="button"
      role="tab"
      id="vc-tab-{p.id}"
      aria-selected={p.id === selected}
      aria-controls="vc-panel-{p.id}"
      tabindex={p.id === selected ? 0 : -1}
      class:selected={p.id === selected}
      class:icon-only={labelHidden(p.id)}
      title={labelHidden(p.id) ? p.label : undefined}
      onclick={() => onselect(p.id)}
    >
      <Icon name={p.icon} size={15} />
      <span class:sr={labelHidden(p.id)}>{p.label}</span>
    </button>
  {/each}
</div>

<style>
  .strip {
    display: flex;
    gap: 6px;
    padding: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .strip::-webkit-scrollbar {
    display: none;
  }

  button {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  button:hover {
    background: var(--state-hover);
  }

  button:active {
    background: var(--state-pressed);
  }

  button.selected {
    background: var(--state-selected);
    color: var(--mOnSurface);
  }

  button.selected :global(svg) {
    color: var(--mPrimary);
  }

  button.icon-only {
    justify-content: center;
    width: 32px;
    padding: 0;
  }

  button:focus-visible {
    outline-offset: -2px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
