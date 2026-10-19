<script lang="ts">
import { tick, untrack } from 'svelte';
import { type PanelId, rowHeight } from '../settings/schema';
import { applyAppearance } from './appearance';
import Icon from './components/Icon.svelte';
import PanelStrip, { type PanelDef } from './components/PanelStrip.svelte';
import SegmentCard from './components/SegmentCard.svelte';
import TabList from './components/TabList.svelte';
import Toasts, { type Toast } from './components/Toasts.svelte';
import TopBar from './components/TopBar.svelte';
import { IMPLEMENTED_PANELS, PANEL_ICONS, PANEL_LABELS } from './panel-defs';
import RecentlyClosed from './sections/RecentlyClosed.svelte';
import type { SettingsState } from './settings-state.svelte';
import { TabState } from './tab-state.svelte';
import { ThemeDraft } from './theme-draft.svelte';
import type { ThemeRegistry } from './theme-registry.svelte';

let { settings, themes }: { settings: SettingsState; themes: ThemeRegistry } = $props();

// The strip follows the user's order and visibility; panels not built yet are skipped.
const panels = $derived(
  settings.value.layout.panels
    .filter((p) => p.visible && IMPLEMENTED_PANELS.has(p.id))
    .map(
      (p): PanelDef<PanelId> => ({
        id: p.id,
        label: PANEL_LABELS[p.id],
        icon: PANEL_ICONS[p.id] ?? 'list',
      }),
    ),
);

let selected: PanelId = $state('tabs');
// A hidden panel can't stay selected (settings and tabs can't be hidden, so 'tabs' always exists).
const panel = $derived(panels.some((p) => p.id === selected) ? selected : 'tabs');
const currentLabel = $derived(PANEL_LABELS[panel]);

// A theme open in the settings editor overrides the saved one so edits preview live.
const draft = new ThemeDraft();
$effect(() => {
  const s = settings.value;
  if (draft.theme) {
    // Preview in the palette being edited, whatever the saved colour mode is.
    const preview = { ...s, appearance: { ...s.appearance, mode: draft.mode } };
    applyAppearance(preview, draft.theme, { persist: false });
  } else {
    applyAppearance(s, themes.resolveReady(s.appearance.themeId));
  }
});

const sections = $derived(settings.value.layout.sections);
const searchPos = $derived.by((): 'top' | 'bottom' | 'hidden' => {
  const s = sections.find((x) => x.id === 'search');
  if (!s?.visible) return 'hidden';
  return sections.findIndex((x) => x.id === 'search') < sections.findIndex((x) => x.id === 'tabs')
    ? 'top'
    : 'bottom';
});

let tabState = $state.raw(new TabState());
let tabList: ReturnType<typeof TabList> | undefined = $state();

// --- Notices ---------------------------------------------------------------------------

let toasts = $state.raw<Toast[]>([]);
let nextToast = 0;
const TOAST_MS = 5000;

function notify(n: { level: 'info' | 'error'; text: string }): void {
  const id = nextToast++;
  // Keep the stack short: a burst of notices shouldn't cover the list.
  toasts = [...toasts, { id, ...n }].slice(-3);
  setTimeout(() => dismiss(id), TOAST_MS);
}

function dismiss(id: number): void {
  if (toasts.some((t) => t.id === id)) toasts = toasts.filter((t) => t.id !== id);
}

async function focusSearch(): Promise<void> {
  if (searchPos === 'hidden') {
    notify({ level: 'info', text: 'Search is hidden in Layout settings' });
    return;
  }
  selected = 'tabs';
  await tick();
  tabList?.focusSearch();
}

// Retry swaps in a fresh TabState; the effect cleanup disposes the old one.
$effect(() => {
  const s = tabState;
  s.onNotice = notify;
  s.onFocusSearch = () => void focusSearch();
  void s.start(untrack(() => settings.value.tabs.allWindows));
  return () => s.dispose();
});

const allWindows = $derived(settings.value.tabs.allWindows);
$effect(() => {
  tabState.setAllWindows(allWindows);
});

function setWhitelisted(host: string, add: boolean): void {
  settings.update((s) => {
    const rest = s.suspend.whitelist.filter((h) => h !== host);
    return { ...s, suspend: { ...s.suspend, whitelist: add ? [...rest, host] : rest } };
  });
}

const count = $derived(
  allWindows ? tabState.windows.reduce((n, w) => n + w.tabs.length, 0) : tabState.tabs.length,
);
</script>

<main>
  <TopBar
    title={currentLabel}
    showBack={panel !== 'tabs'}
    mode={settings.value.appearance.mode}
    onback={() => (selected = 'tabs')}
    onmode={(mode) => settings.update((s) => ({ ...s, appearance: { ...s.appearance, mode } }))}
  />
  <PanelStrip {panels} selected={panel} onselect={(id) => (selected = id)} />

  <div class="panel" role="tabpanel" id="vc-panel-{panel}" aria-labelledby="vc-tab-{panel}">
    {#if panel === 'tabs'}
      <div class="sections">
      {#each sections as sec (sec.id)}
      {#if sec.id === 'recentlyClosed' && sec.visible}
        <RecentlyClosed {tabState} />
      {:else if sec.id === 'tabs'}
      <SegmentCard title="Open tabs" fill>
        {#snippet icon()}<Icon name="list" size={12} />{/snippet}
        {#snippet trailing()}
          {#if tabState.status === 'ready'}
            {#if settings.value.tabs.showCount}
              <span class="count" role="img" aria-label="{count} tabs">{count}</span>
            {/if}
            <button
              type="button"
              class="add"
              class:on={allWindows}
              aria-label="Show all windows"
              aria-pressed={allWindows}
              title="Show all windows"
              onclick={() => settings.update((s) => ({ ...s, tabs: { ...s.tabs, allWindows: !s.tabs.allWindows } }))}
            >
              <Icon name="windows" size={14} />
            </button>
            {#if settings.value.tabs.showNewTabButton}
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
          <TabList
            bind:this={tabList}
            {tabState}
            {allWindows}
            shortcuts={settings.value.shortcuts}
            whitelist={settings.value.suspend.whitelist}
            onWhitelist={setWhitelisted}
            rowHeight={rowHeight(settings.value)}
            search={searchPos}
            twoLine={settings.value.tabs.layout === 'double'}
            showClose={settings.value.tabs.showClose}
            showMute={settings.value.tabs.showMute}
          />
        {/if}
      </SegmentCard>
      {/if}
      {/each}
      </div>
    {:else if panel === 'sessions'}
      <!-- Lazy like settings: each rarely used panel is its own chunk. -->
      {#await import('./panels/sessions/SessionsPanel.svelte')}
        <p class="message" role="status">Loading…</p>
      {:then m}
        <m.default {tabState} {settings} />
      {:catch}
        <p class="message" role="alert">Could not load sessions.</p>
      {/await}
    {:else if panel === 'bookmarks'}
      {#await import('./panels/bookmarks/BookmarksPanel.svelte')}
        <p class="message" role="status">Loading…</p>
      {:then m}
        <m.default {tabState} />
      {:catch}
        <p class="message" role="alert">Could not load bookmarks.</p>
      {/await}
    {:else if panel === 'history'}
      {#await import('./panels/history/HistoryPanel.svelte')}
        <p class="message" role="status">Loading…</p>
      {:then m}
        <m.default {tabState} />
      {:catch}
        <p class="message" role="alert">Could not load history.</p>
      {/await}
    {:else if panel === 'settings'}
      <!-- Lazy: settings UI is rarely opened, so keep it out of the initial bundle. -->
      {#await import('./panels/SettingsPanel.svelte')}
        <p class="message" role="status">Loading…</p>
      {:then m}
        <m.default {settings} {themes} {tabState} {draft} />
      {:catch}
        <p class="message" role="alert">Could not load settings.</p>
      {/await}
    {/if}
  </div>

  <Toasts {toasts} ondismiss={dismiss} />
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

  .sections {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
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

  .add.on {
    background: var(--state-selected);
    color: var(--mPrimary);
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
