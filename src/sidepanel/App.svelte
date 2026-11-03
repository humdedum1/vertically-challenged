<script lang="ts">
import { tick } from 'svelte';
import { type PanelId, rowHeight, type Settings } from '../settings/schema';
import { POPUP_CLOSE, parseSurface } from '../shared/surface';
import type { GroupColor } from '../shared/types';
import { applyAppearance } from './appearance';
import Icon from './components/Icon.svelte';
import PanelStrip, { type PanelDef } from './components/PanelStrip.svelte';
import SegmentCard from './components/SegmentCard.svelte';
import TabList from './components/TabList.svelte';
import Toasts, { type Toast } from './components/Toasts.svelte';
import TopBar from './components/TopBar.svelte';
import { IMPLEMENTED_PANELS, PANEL_ICONS, PANEL_LABELS } from './panel-defs';
import SettingsPanel from './panels/SettingsPanel.svelte';
import { scrollIdle } from './scroll-idle.svelte';
import RecentlyClosed from './sections/RecentlyClosed.svelte';
import type { SettingsState } from './settings-state.svelte';
import { TabState } from './tab-state.svelte';
import { ThemeDraft } from './theme-draft.svelte';
import type { ThemeRegistry } from './theme-registry.svelte';

let { settings, themes }: { settings: SettingsState; themes: ThemeRegistry } = $props();

/** Side panel, in-page popup or popup window; fixed for the page's lifetime. */
const where = parseSurface(location.search);

/** Closes an in-page popup (via its host page) or a popup window; the side panel has no close. */
function requestClose(): void {
  if (where.surface === 'popup') window.parent.postMessage({ type: POPUP_CLOSE }, '*');
  else if (where.surface === 'window') window.close();
}

// Escape that nothing in the panel used (menu, selection, search, drag) closes a popup.
function onWindowKeydown(e: KeyboardEvent): void {
  if (where.surface !== 'sidebar' && e.key === 'Escape' && !e.defaultPrevented) requestClose();
}

// A popup window is a launcher: it goes away once the user is back in the browser.
function onWindowBlur(): void {
  if (where.surface === 'window' && !document.hasFocus()) window.close();
}

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

$effect(() => {
  scrollIdle.lazy = settings.value.tabs.lazyFavicons;
});

// Mouse wheel over the top bar steps through this window's tabs (Sidebery-style). Deltas
// are accumulated so a touchpad's many small events don't skip several tabs at once.
let wheelAcc = 0;
function onTopWheel(e: WheelEvent): void {
  if (!settings.value.mouse.wheelSwitch) return;
  wheelAcc += e.deltaY || e.deltaX;
  if (Math.abs(wheelAcc) < 50) return;
  const step = wheelAcc > 0 ? 1 : -1;
  wheelAcc = 0;
  const tabs = tabState.tabs;
  const at = tabs.findIndex((t) => t.active);
  const next = tabs[(at + step + tabs.length) % tabs.length];
  if (next && at !== -1) tabState.send({ type: 'activate', tabId: next.id });
}

const sections = $derived(settings.value.layout.sections);
const searchPos = $derived.by((): 'top' | 'bottom' | 'hidden' => {
  const s = sections.find((x) => x.id === 'search');
  if (!s?.visible) return 'hidden';
  return sections.findIndex((x) => x.id === 'search') < sections.findIndex((x) => x.id === 'tabs')
    ? 'top'
    : 'bottom';
});

let tabState = $state.raw(new TabState(where));

// Chrome's group colours per mode, for a window's accent (window menu → Accent colour).
// The light set is too dark to read on dark surfaces, so dark mode uses Chrome's own.
const ACCENT_HEX: Record<GroupColor, { light: string; dark: string }> = {
  grey: { light: '#5f6368', dark: '#dadce0' },
  blue: { light: '#1a73e8', dark: '#8ab4f8' },
  red: { light: '#d93025', dark: '#f28b82' },
  yellow: { light: '#f9ab00', dark: '#fdd663' },
  green: { light: '#1e8e3e', dark: '#81c995' },
  pink: { light: '#d01884', dark: '#ff8bcb' },
  purple: { light: '#9334e6', dark: '#c58af9' },
  cyan: { light: '#007b83', dark: '#78d9ec' },
  orange: { light: '#fa903e', dark: '#fcad70' },
};

// This window's own look (window menu): theme, density and accent override the settings.
const ownLook = $derived(
  tabState.windowId === null ? undefined : tabState.layouts.get(tabState.windowId),
);
const effective = $derived.by((): Settings => {
  const s = settings.value;
  const l = ownLook;
  if (!l?.themeId && !l?.density) return s;
  return {
    ...s,
    appearance: {
      ...s.appearance,
      themeId: l.themeId ?? s.appearance.themeId,
      density: l.density ?? s.appearance.density,
    },
  };
});

// A theme open in the settings editor overrides the saved one so edits preview live.
const draft = new ThemeDraft();
const ownAccent = $derived(ownLook?.accent ? ACCENT_HEX[ownLook.accent] : undefined);
$effect(() => {
  const s = effective;
  const accent = ownAccent;
  if (draft.theme) {
    // Preview in the palette being edited, whatever the saved colour mode is.
    const preview = { ...s, appearance: { ...s.appearance, mode: draft.mode } };
    applyAppearance(preview, draft.theme, { persist: false, accent });
  } else {
    // The first-frame cache only holds the global look, not one window's.
    applyAppearance(s, themes.resolveReady(s.appearance.themeId), {
      persist: s === settings.value && !accent,
      accent,
    });
  }
});

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
  void s.start();
  return () => s.dispose();
});

function setWhitelisted(host: string, add: boolean): void {
  settings.update((s) => {
    const rest = s.suspend.whitelist.filter((h) => h !== host);
    return { ...s, suspend: { ...s.suspend, whitelist: add ? [...rest, host] : rest } };
  });
}

const count = $derived(tabState.tabs.length);
</script>

<svelte:window onkeydown={onWindowKeydown} onblur={onWindowBlur} />

<main>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="wheel" onwheel={onTopWheel}>
  <TopBar
    title={currentLabel}
    showBack={panel !== 'tabs'}
    mode={settings.value.appearance.mode}
    onback={() => (selected = 'tabs')}
    onclose={where.surface === 'sidebar' ? undefined : requestClose}
    onmode={(mode) => settings.update((s) => ({ ...s, appearance: { ...s.appearance, mode } }))}
  />
  </div>
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
            <button type="button" onclick={() => (tabState = new TabState(where))}>Retry</button>
          </div>
        {:else if count === 0}
          <p class="message empty">No tabs in this window</p>
        {:else}
          <TabList
            bind:this={tabList}
            {tabState}
            shortcuts={settings.value.shortcuts}
            themes={themes.all}
            mouse={settings.value.mouse}
            ageDays={settings.value.tabs.ageDays}
            whitelist={settings.value.suspend.whitelist}
            onWhitelist={setWhitelisted}
            rowHeight={rowHeight(effective)}
            search={searchPos}
            twoLine={settings.value.tabs.layout === 'double'}
            showClose={settings.value.tabs.showClose}
            showMute={settings.value.tabs.showMute}
            childTabs={settings.value.tabs.childTabs}
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
      <SettingsPanel {settings} {themes} {tabState} {draft} />
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

  .wheel {
    display: contents;
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
