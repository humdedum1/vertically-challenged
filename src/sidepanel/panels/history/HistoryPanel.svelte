<script lang="ts">
import { onMount, tick } from 'svelte';
import { browser } from 'wxt/browser';
import { displayUrl } from '../../../lib/search/search-index';
import ContextMenu from '../../components/ContextMenu.svelte';
import Favicon from '../../components/Favicon.svelte';
import Icon from '../../components/Icon.svelte';
import type { MenuItem } from '../../components/menu-types';
import { RowHeight } from '../../components/row-height.svelte';
import SegmentCard from '../../components/SegmentCard.svelte';
import VirtualList from '../../components/VirtualList.svelte';
import { copyLink } from '../../copy-link';
import type { TabState } from '../../tab-state.svelte';
import { type HistoryRow, withDayHeaders } from './days';

let { tabState }: { tabState: TabState } = $props();

type Entry = { id: string; url: string; title: string; lastVisitTime: number };

const PAGE = 100;
const SEARCH_DEBOUNCE = 200;
const VISIT_THROTTLE = 500;

const rh = new RowHeight();
$effect(rh.start);

let items = $state.raw<Entry[]>([]);
let query = $state('');
let loading = $state(true);
let loadingMore = $state(false);
let done = $state(false);
let error = $state<string | null>(null);
let status = $state('');
let focused = $state<number | null>(null);
let menu = $state<{ x: number; y: number; items: MenuItem[]; label: string } | null>(null);
let now = $state(Date.now());

let list: ReturnType<typeof VirtualList<HistoryRow<Entry>>> | undefined = $state();
let search: HTMLInputElement | undefined = $state();
// Bumped for every fresh search so a slow earlier response can't overwrite a newer one.
let generation = 0;

const rows = $derived(withDayHeaders(items, now));
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function toEntry(h: {
  id: string;
  url?: string;
  title?: string;
  lastVisitTime?: number;
}): Entry | null {
  if (!h.url) return null;
  return { id: h.id, url: h.url, title: h.title ?? '', lastVisitTime: h.lastVisitTime ?? 0 };
}

async function fetchPage(text: string, endTime?: number): Promise<Entry[]> {
  const found = await browser.history.search({
    text,
    startTime: 0,
    maxResults: PAGE,
    ...(endTime === undefined ? {} : { endTime }),
  });
  return found.flatMap((h) => toEntry(h) ?? []);
}

async function runSearch(): Promise<void> {
  const gen = ++generation;
  loading = true;
  error = null;
  done = false;
  try {
    const page = await fetchPage(query.trim());
    if (gen !== generation) return;
    items = page;
    done = page.length === 0;
    now = Date.now();
    focused = null;
    status = query.trim() ? `${page.length} results` : '';
  } catch (e) {
    if (gen !== generation) return;
    items = [];
    error = e instanceof Error ? e.message : 'Could not read history.';
  } finally {
    if (gen === generation) loading = false;
  }
  await tick();
  void maybeLoadMore();
}

async function loadMore(): Promise<void> {
  if (loading || loadingMore || done || error || items.length === 0) return;
  const gen = generation;
  const last = items[items.length - 1];
  if (!last) return;
  loadingMore = true;
  try {
    // No -1: lastVisitTime is fractional ms, so subtracting 1 skips entries in the same
    // millisecond. endTime is exclusive in Chrome; dedupe by id covers it if it ever isn't.
    const page = await fetchPage(query.trim(), last.lastVisitTime);
    if (gen !== generation) return;
    const seen = new Set(items.map((i) => i.id));
    const fresh = page.filter((p) => !seen.has(p.id));
    items = [...items, ...fresh];
    // Chrome can return fewer than maxResults before the end, so only an empty or
    // all-duplicate page counts as the end.
    if (fresh.length === 0) done = true;
  } catch (e) {
    if (gen === generation) {
      done = true;
      status = e instanceof Error ? e.message : 'Could not load more history.';
    }
  } finally {
    loadingMore = false;
  }
  await tick();
  void maybeLoadMore();
}

/** Loads the next page when the viewport is near the end, including when rows don't fill it. */
async function maybeLoadMore(): Promise<void> {
  const el = list?.scroller();
  if (!el || done || loading || loadingMore) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < rh.value * 8) await loadMore();
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
function onSearchInput(value: string): void {
  query = value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), SEARCH_DEBOUNCE);
}

$effect(() => {
  const el = list?.scroller();
  if (!el) return;
  const onScroll = () => void maybeLoadMore();
  el.addEventListener('scroll', onScroll, { passive: true });
  return () => el.removeEventListener('scroll', onScroll);
});

// Live updates. Visits are coalesced because navigation bursts fire many events.
let pendingVisits = new Map<string, Entry>();
let visitTimer: ReturnType<typeof setTimeout> | undefined;

function matchesQuery(e: Entry): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${e.title} ${e.url}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

function flushVisits(): void {
  visitTimer = undefined;
  const fresh = [...pendingVisits.values()].filter(matchesQuery);
  pendingVisits = new Map();
  if (fresh.length === 0) return;
  const ids = new Set(fresh.map((f) => f.id));
  items = [
    ...fresh.sort((a, b) => b.lastVisitTime - a.lastVisitTime),
    ...items.filter((i) => !ids.has(i.id)),
  ];
  now = Date.now();
}

onMount(() => {
  void runSearch();
  const onVisited = (h: { id: string; url?: string; title?: string; lastVisitTime?: number }) => {
    const e = toEntry(h);
    if (!e) return;
    pendingVisits.set(e.id, e);
    visitTimer ??= setTimeout(flushVisits, VISIT_THROTTLE);
  };
  const onRemoved = (r: { allHistory: boolean; urls?: string[] }) => {
    if (r.allHistory) {
      items = [];
      done = true;
    } else if (r.urls?.length) {
      const gone = new Set(r.urls);
      items = items.filter((i) => !gone.has(i.url));
    }
  };
  // Some profiles (policy, kiosk) have no history API at all.
  try {
    browser.history.onVisited.addListener(onVisited);
    browser.history.onVisitRemoved.addListener(onRemoved);
  } catch {
    // Search already reports the error state.
  }
  return () => {
    clearTimeout(searchTimer);
    clearTimeout(visitTimer);
    try {
      browser.history.onVisited.removeListener(onVisited);
      browser.history.onVisitRemoved.removeListener(onRemoved);
    } catch {
      // Nothing was registered.
    }
  };
});

// ---- actions

async function openUrl(url: string, newTab: boolean): Promise<void> {
  try {
    if (newTab) {
      await browser.tabs.create({ url });
      return;
    }
    // Target the home window's active tab explicitly: "current tab" from a panel page is ambiguous.
    // Asks the browser instead of the mirrored list, which can lag a tab switch.
    const [active] = await browser.tabs.query({
      active: true,
      windowId: tabState.windowId ?? undefined,
    });
    if (active?.id !== undefined) await browser.tabs.update(active.id, { url });
    else await browser.tabs.create({ url });
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not open that page.';
  }
}

async function removeEntry(e: Entry): Promise<void> {
  try {
    await browser.history.deleteUrl({ url: e.url });
    items = items.filter((i) => i.url !== e.url);
    status = 'Removed from history.';
  } catch (err) {
    status = err instanceof Error ? err.message : 'Could not delete that entry.';
  }
}

// ---- keyboard / menu

const itemAt = (i: number | null): Entry | null => {
  const r = i === null ? undefined : rows[i];
  return r?.kind === 'item' ? r.item : null;
};

function step(from: number | null, dir: 1 | -1): number | null {
  let i = from === null ? (dir === 1 ? -1 : rows.length) : from;
  for (i += dir; i >= 0 && i < rows.length; i += dir) if (rows[i]?.kind === 'item') return i;
  return from;
}

function edge(dir: 1 | -1): number | null {
  return step(dir === 1 ? -1 : rows.length, dir);
}

function focusRow(i: number | null): void {
  focused = i;
  if (i !== null) list?.reveal(i);
}

function menuItems(e: Entry): MenuItem[] {
  return [
    { type: 'item', label: 'Open', onselect: () => void openUrl(e.url, false) },
    { type: 'item', label: 'Open in new tab', onselect: () => void openUrl(e.url, true) },
    {
      type: 'item',
      label: 'Copy link',
      onselect: () => void copyLink(e.url).then((m) => (status = m)),
    },
    { type: 'separator' },
    {
      type: 'item',
      label: 'Delete from history',
      danger: true,
      onselect: () => void removeEntry(e),
    },
  ];
}

function openMenu(e: Entry, x: number, y: number): void {
  menu = { x, y, items: menuItems(e), label: `Actions for ${e.title || e.url}` };
}

function closeMenu(): void {
  if (!menu) return;
  menu = null;
  list?.scroller()?.focus();
}

function onRowClick(ev: MouseEvent, i: number, e: Entry): void {
  focused = i;
  void openUrl(e.url, ev.ctrlKey || ev.metaKey);
}

function onRowAux(ev: MouseEvent, e: Entry): void {
  if (ev.button !== 1) return;
  ev.preventDefault();
  void openUrl(e.url, true);
}

function onContext(ev: MouseEvent, i: number, e: Entry): void {
  ev.preventDefault();
  focused = i;
  openMenu(e, ev.clientX, ev.clientY);
}

function menuFromKeyboard(): void {
  const e = itemAt(focused);
  const el = list?.scroller();
  if (!e || !el || focused === null) return;
  const row = el.querySelector<HTMLElement>(`#vc-h-${CSS.escape(e.id)}`);
  const r = (row ?? el).getBoundingClientRect();
  openMenu(e, r.left + 24, r.bottom);
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.altKey) return;
  const e = itemAt(focused);
  switch (ev.key) {
    case 'ArrowDown':
      focusRow(step(focused, 1));
      break;
    case 'ArrowUp':
      focusRow(step(focused, -1));
      break;
    case 'Home':
      focusRow(edge(1));
      break;
    case 'End':
      focusRow(edge(-1));
      break;
    case 'PageDown':
      focusRow(step(focused, 1));
      break;
    case 'Enter':
      if (e) void openUrl(e.url, ev.ctrlKey || ev.metaKey);
      break;
    case 'Delete':
      if (e) {
        const next = step(focused, 1) ?? step(focused, -1);
        void removeEntry(e).then(() =>
          focusRow(next === null ? null : Math.min(next, rows.length - 1)),
        );
      }
      break;
    case 'ContextMenu':
      menuFromKeyboard();
      break;
    case 'F10':
      if (!ev.shiftKey) return;
      menuFromKeyboard();
      break;
    case '/':
      search?.focus();
      break;
    default:
      return;
  }
  ev.preventDefault();
}

function onSearchKey(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    list?.scroller()?.focus();
    focusRow(focused ?? edge(1));
  } else if (ev.key === 'Escape' && query) {
    ev.preventDefault();
    onSearchInput('');
    if (search) search.value = '';
  }
}

const activeId = $derived.by(() => {
  const e = itemAt(focused);
  return e ? `vc-h-${e.id}` : undefined;
});
</script>

<div class="wrap">
  <SegmentCard title="History" fill>
    {#snippet icon()}<Icon name="history" size={12} />{/snippet}
    <div class="inner">
      <div class="search">
        <Icon name="search" size={14} />
        <input
          bind:this={search}
          type="search"
          aria-label="Search history"
          placeholder="Search history"
          autocomplete="off"
          spellcheck="false"
          value={query}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          onkeydown={onSearchKey}
        />
      </div>

      {#if loading && items.length === 0}
        <div class="skeleton" role="status" aria-label="Loading history">
          {#each { length: 8 } as _, i (i)}
            <div class="sk-row" aria-hidden="true"><span class="sk-icon"></span><span class="sk-text" style:width="{45 + ((i * 17) % 40)}%"></span></div>
          {/each}
        </div>
      {:else if error}
        <div class="message" role="alert">
          <p>History isn’t available: {error}</p>
          <button type="button" class="retry" onclick={() => void runSearch()}>Retry</button>
        </div>
      {:else if items.length === 0}
        <p class="message">{query.trim() ? 'No matching history' : 'No browsing history yet'}</p>
      {:else}
        <VirtualList
          bind:this={list}
          items={rows}
          rowHeight={rh.value}
          key={(r) => (r.kind === 'day' ? `d:${r.key}` : `i:${r.item.id}`)}
          role="listbox"
          tabindex={0}
          aria-label="History"
          aria-activedescendant={activeId}
          onkeydown={onKeydown}
          onfocus={() => {
            if (focused === null) focusRow(edge(1));
          }}
        >
          {#snippet row(r, i)}
            {#if r.kind === 'day'}
              <div class="day" role="presentation" style:height="{rh.value}px">{r.label}</div>
            {:else}
              {@const e = r.item}
              <!-- Keyboard activation is handled on the listbox via aria-activedescendant. -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                id="vc-h-{e.id}"
                class="row"
                class:focused={focused === i}
                style:height="{rh.value}px"
                role="option"
                tabindex="-1"
                aria-selected={focused === i}
                title="{e.title || e.url}&#10;{e.url}&#10;{new Date(e.lastVisitTime).toLocaleString()}"
                onclick={(ev) => onRowClick(ev, i, e)}
                onauxclick={(ev) => onRowAux(ev, e)}
                oncontextmenu={(ev) => onContext(ev, i, e)}
              >
                <Favicon url={e.url} />
                <span class="text">
                  <span class="label">{e.title || displayUrl(e.url)}</span>
                  <span class="url">{displayUrl(e.url)}</span>
                </span>
                <time class="time" datetime={new Date(e.lastVisitTime).toISOString()}>{timeFmt.format(e.lastVisitTime)}</time>
              </div>
            {/if}
          {/snippet}
        </VirtualList>
        {#if loadingMore}<p class="more" role="status">Loading more…</p>{/if}
      {/if}
    </div>
  </SegmentCard>

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onclose={closeMenu} />
  {/if}

  <p class="sr" role="status" aria-live="polite">{status}</p>
</div>

<style>
  .wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .inner {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .inner > :global(.viewport) {
    flex: 1;
    min-height: 0;
    height: auto;
    padding: 0 4px 6px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px var(--pad-card) 6px;
    padding: 0 10px;
    height: 32px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-control);
    background: var(--surface-0);
    color: var(--mOnSurfaceVariant);
  }

  .search:focus-within {
    border-color: var(--focus-ring);
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .search input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--mOnSurface);
    font: inherit;
  }

  .search input::placeholder {
    color: var(--mOnSurfaceVariant);
  }

  .day {
    display: flex;
    align-items: flex-end;
    padding: 0 8px 4px;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 12px;
    border-radius: var(--radius-row);
    cursor: default;
    user-select: none;
    transition: background-color var(--dur) var(--ease);
  }

  .row:hover {
    background: var(--state-hover);
  }

  .row:active {
    background: var(--state-pressed);
  }

  .row.focused {
    background: var(--state-focus);
  }

  :global([role='listbox']:focus-visible) .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .label,
  .url {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .url {
    display: none;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    line-height: 1.15;
  }

  :global(html[data-row-layout='double']) .url {
    display: block;
  }

  :global(html[data-row-layout='double']) .label {
    line-height: 1.2;
  }

  .time {
    flex: none;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    font-variant-numeric: tabular-nums;
  }

  .message {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
  }

  .retry {
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-row);
    background: var(--mPrimary);
    color: var(--mOnPrimary);
    font-weight: 600;
    cursor: pointer;
  }

  .more {
    margin: 0;
    padding: 4px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
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
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
