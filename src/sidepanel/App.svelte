<script lang="ts">
import { ROW_HEIGHT } from '../settings/schema';
import { applyAppearance } from './appearance';
import Icon from './components/Icon.svelte';
import PanelStrip, { type PanelDef } from './components/PanelStrip.svelte';
import SegmentCard from './components/SegmentCard.svelte';
import TabList from './components/TabList.svelte';
import TopBar from './components/TopBar.svelte';
import type { SettingsState } from './settings-state.svelte';
import { TabState } from './tab-state.svelte';

let { settings }: { settings: SettingsState } = $props();

// Data-driven so Sessions / Bookmarks / History only need an entry here and a branch below.
const PANELS = [
  { id: 'tabs', label: 'Tabs', icon: 'tabs' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
] as const satisfies readonly PanelDef<string>[];
type PanelId = (typeof PANELS)[number]['id'];

let panel: PanelId = $state('tabs');
const current = $derived(PANELS.find((p) => p.id === panel) ?? PANELS[0]);

$effect(() => applyAppearance(settings.value.appearance));

let tabState = $state.raw(new TabState());

// Retry swaps in a fresh TabState; the effect cleanup disposes the old one.
$effect(() => {
  const s = tabState;
  void s.start();
  return () => s.dispose();
});

const count = $derived(tabState.tabs.length);
</script>

<main>
  <TopBar
    title={current.label}
    showBack={panel !== 'tabs'}
    mode={settings.value.appearance.mode}
    onback={() => (panel = 'tabs')}
    onmode={(mode) => settings.update((s) => ({ ...s, appearance: { ...s.appearance, mode } }))}
  />
  <PanelStrip panels={PANELS} selected={panel} onselect={(id) => (panel = id)} />

  <div class="panel" role="tabpanel" id="vc-panel-{panel}" aria-labelledby="vc-tab-{panel}">
    {#if panel === 'tabs'}
      <SegmentCard title="Open tabs" fill>
        {#snippet icon()}<Icon name="list" size={12} />{/snippet}
        {#snippet trailing()}
          {#if tabState.status === 'ready'}
            <span class="count" role="img" aria-label="{count} tabs">{count}</span>
            <button
              type="button"
              class="add"
              aria-label="New tab"
              title="New tab"
              onclick={() => {
                if (tabState.windowId !== null) tabState.send({ type: 'newTab', windowId: tabState.windowId, afterTabId: null });
              }}
            >
              <Icon name="plus" size={14} />
            </button>
          {/if}
        {/snippet}

        <!-- The worker is suspended when idle and the port reconnects; keep showing the last
             known list meanwhile instead of unmounting it and losing scroll position. -->
        {#if tabState.status === 'connecting' && count === 0}
          <div class="skeleton" role="status" aria-live="polite">
            <span class="sr">Connecting…</span>
            {#each { length: 8 } as _, i (i)}
              <div class="sk-row" aria-hidden="true"><span class="sk-icon"></span><span class="sk-text" style:width="{45 + ((i * 17) % 40)}%"></span></div>
            {/each}
          </div>
        {:else if tabState.status === 'error'}
          <div class="message" role="alert">
            <p>{tabState.error ?? 'Could not connect to the extension.'}</p>
            <button type="button" onclick={() => (tabState = new TabState())}>Retry</button>
          </div>
        {:else if count === 0}
          <p class="message empty">No tabs in this window</p>
        {:else}
          <TabList {tabState} rowHeight={ROW_HEIGHT[settings.value.appearance.density]} />
        {/if}
      </SegmentCard>
    {:else if panel === 'settings'}
      <!-- Lazy: settings UI is rarely opened, so keep it out of the initial bundle. -->
      {#await import('./panels/SettingsPanel.svelte')}
        <p class="message" role="status">Loading…</p>
      {:then m}
        <m.default {settings} />
      {:catch}
        <p class="message" role="alert">Could not load settings.</p>
      {/await}
    {/if}
  </div>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: var(--pad-panel);
    gap: var(--gap);
  }

  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .count {
    min-width: 22px;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--mOnSurfaceVariant);
    font-size: 11px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .add {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-left: 6px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .add:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .add:active {
    background: var(--state-pressed);
  }

  .message {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
  }

  .message button {
    margin-top: 8px;
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-row);
    background: var(--mPrimary);
    color: var(--mOnPrimary);
    font-weight: 600;
    cursor: pointer;
  }

  .skeleton {
    padding: 4px;
  }

  .sk-row {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--row-height);
    padding: 0 12px;
  }

  .sk-icon,
  .sk-text {
    background: var(--mOutline);
    border-radius: 4px;
    opacity: 0.5;
  }

  .sk-icon {
    width: 16px;
    height: 16px;
  }

  .sk-text {
    height: 10px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
