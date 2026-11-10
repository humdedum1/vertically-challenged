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
import { segments } from '../../model/highlight';
import type { TabState } from '../../tab-state.svelte';
import {
  type BookmarkRow,
  collectUrls,
  flattenTree,
  isFolder,
  isScriptUrl,
  type Node,
} from './flatten';
import { matchRanges } from './match-ranges';

let { tabState }: { tabState: TabState } = $props();

const STORE_KEY = 'vc.bookmarks.expanded';
const OPEN_ALL_CONFIRM = 20;

const rh = new RowHeight();
$effect(rh.start);

let root = $state.raw<Node | undefined>();
let loading = $state(true);
let error = $state<string | null>(null);
let status = $state('');
let expanded = $state.raw<ReadonlySet<string>>(loadExpanded());
let focusedId = $state<string | null>(null);
let query = $state('');
let results = $state.raw<Node[] | null>(null);
let searching = $state(false);
let menu = $state<{ x: number; y: number; items: MenuItem[]; label: string } | null>(null);
let confirm = $state<{ message: string; action: string; danger: boolean; run: () => void } | null>(
  null,
);
let bookmarkedActive = $state(true);

let list: ReturnType<typeof VirtualList<BookmarkRow>> | undefined = $state();
let search: HTMLInputElement | undefined = $state();

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return new Set();
}

function saveExpanded(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...expanded]));
  } catch {
    // Remembering is a convenience only.
  }
}

function setExpanded(next: Set<string>): void {
  expanded = next;
  saveExpanded();
}

let hasStored = (() => {
  try {
    return localStorage.getItem(STORE_KEY) !== null;
  } catch {
    return false;
  }
})();

const rows = $derived(flattenTree(root, expanded));
const searchMode = $derived(results !== null);
const activeTab = $derived(tabState.tabs.find((t) => t.active));

async function load(): Promise<void> {
  try {
    const tree = await browser.bookmarks.getTree();
    root = tree[0] as Node | undefined;
    error = null;
    if (!hasStored && root?.children) {
      // First run: show the top-level folders open so the panel isn't just three closed rows.
      hasStored = true;
      setExpanded(new Set(root.children.map((c) => c.id)));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Could not read bookmarks.';
  } finally {
    loading = false;
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload(): void {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    void load();
    if (query.trim()) void runSearch();
    void checkBookmarked();
  }, 200);
}

onMount(() => {
  void load();
  const ev = browser.bookmarks;
  const events = [ev.onCreated, ev.onRemoved, ev.onChanged, ev.onMoved];
  try {
    for (const e of events) e.addListener(scheduleReload);
  } catch {
    // The load above reports the error state.
  }
  return () => {
    clearTimeout(reloadTimer);
    clearTimeout(searchTimer);
    try {
      for (const e of events) e.removeListener(scheduleReload);
    } catch {
      // Nothing was registered.
    }
  };
});

// ---- search

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchGen = 0;

async function runSearch(): Promise<void> {
  const q = query.trim();
  const gen = ++searchGen;
  if (!q) {
    results = null;
    searching = false;
    return;
  }
  searching = true;
  try {
    const found = (await browser.bookmarks.search(q)) as Node[];
    if (gen !== searchGen) return;
    results = found.filter((n) => n.url !== undefined);
    status = `${results.length} ${results.length === 1 ? 'result' : 'results'}`;
    focusedId = null;
  } catch (e) {
    if (gen !== searchGen) return;
    results = [];
    status = e instanceof Error ? e.message : 'Search failed.';
  } finally {
    if (gen === searchGen) searching = false;
  }
}

function onSearchInput(value: string): void {
  query = value;
  clearTimeout(searchTimer);
  if (!value.trim()) {
    void runSearch();
    return;
  }
  searchTimer = setTimeout(() => void runSearch(), 150);
}

// Search results are flat rows at level 1 so one renderer and key handler serve both modes.
const shownRows = $derived.by((): BookmarkRow[] =>
  results
    ? results.map((node, i) => ({
        node,
        level: 1,
        pos: i + 1,
        size: results?.length ?? 0,
        parentId: null,
      }))
    : rows,
);

// ---- bookmark current tab

async function checkBookmarked(): Promise<void> {
  const url = activeTab?.url;
  if (!url || !/^https?:/i.test(url)) {
    bookmarkedActive = true;
    return;
  }
  try {
    bookmarkedActive = (await browser.bookmarks.search({ url })).length > 0;
  } catch {
    bookmarkedActive = true;
  }
}

$effect(() => {
  void activeTab?.url;
  void checkBookmarked();
});

function otherFolderId(): string | undefined {
  const kids = root?.children ?? [];
  const typed = kids.find((k) => (k as { folderType?: string }).folderType === 'other');
  // Older Chrome has no folderType; "Other bookmarks" is then the second root child.
  return (typed ?? kids[1])?.id;
}

async function bookmarkCurrent(): Promise<void> {
  const t = activeTab;
  const parentId = otherFolderId();
  if (!t || !parentId) return;
  try {
    await browser.bookmarks.create({ parentId, title: t.title || t.url, url: t.url });
    status = 'Bookmarked this tab.';
    bookmarkedActive = true;
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not add the bookmark.';
  }
}

// ---- actions

async function openBookmark(n: Node, mode: 'current' | 'tab' | 'window'): Promise<void> {
  const url = n.url;
  if (!url) return;
  if (isScriptUrl(url)) {
    status = 'Bookmarklets are not run from the side panel.';
    return;
  }
  try {
    if (mode === 'window') await browser.windows.create({ url });
    else if (mode === 'tab') await browser.tabs.create({ url });
    else await updateActiveTab(url);
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not open that bookmark.';
  }
}

// Asks the browser instead of trusting the mirrored list, which can lag a tab switch.
async function updateActiveTab(url: string): Promise<void> {
  const [active] = await browser.tabs.query({
    active: true,
    windowId: tabState.windowId ?? undefined,
  });
  if (active?.id !== undefined) await browser.tabs.update(active.id, { url });
  else await browser.tabs.create({ url });
}

async function openAll(folder: Node): Promise<void> {
  const urls = collectUrls(folder).filter((u) => !isScriptUrl(u));
  try {
    for (const url of urls) await browser.tabs.create({ url, active: false });
    status = `Opened ${urls.length} tabs.`;
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not open the bookmarks.';
  }
}

function acceptConfirm(): void {
  const run = confirm?.run;
  confirm = null;
  run?.();
}

function askOpenAll(folder: Node): void {
  const n = collectUrls(folder).filter((u) => !isScriptUrl(u)).length;
  if (n === 0) {
    status = 'This folder has no bookmarks.';
    return;
  }
  if (n <= OPEN_ALL_CONFIRM) {
    void openAll(folder);
    return;
  }
  confirm = {
    message: `Open ${n} bookmarks in new tabs?`,
    action: 'Open all',
    danger: false,
    run: () => void openAll(folder),
  };
}

async function removeBookmark(n: Node): Promise<void> {
  try {
    await browser.bookmarks.remove(n.id);
    status = `Deleted “${n.title || n.url}”.`;
  } catch (e) {
    status = e instanceof Error ? e.message : 'Could not delete that bookmark.';
  }
}

function askDelete(n: Node): void {
  confirm = {
    message: `Delete bookmark “${n.title || n.url}”?`,
    action: 'Delete',
    danger: true,
    run: () => void removeBookmark(n),
  };
}

function toggleFolder(id: string, open?: boolean): void {
  const next = new Set(expanded);
  const want = open ?? !next.has(id);
  if (want) next.add(id);
  else next.delete(id);
  setExpanded(next);
}

function activate(r: BookmarkRow, newTab: boolean): void {
  if (isFolder(r.node)) toggleFolder(r.node.id);
  else void openBookmark(r.node, newTab ? 'tab' : 'current');
}

// ---- focus / keyboard

const focusedIndex = $derived(
  focusedId === null ? -1 : shownRows.findIndex((r) => r.node.id === focusedId),
);

function focusIndex(i: number): void {
  const r = shownRows[Math.max(0, Math.min(i, shownRows.length - 1))];
  if (!r) return;
  focusedId = r.node.id;
  list?.reveal(shownRows.indexOf(r));
}

function menuFor(r: BookmarkRow): MenuItem[] {
  const n = r.node;
  if (isFolder(n)) {
    const open = expanded.has(n.id);
    return [
      { type: 'item', label: 'Open all in new tabs', onselect: () => askOpenAll(n) },
      { type: 'separator' },
      { type: 'item', label: open ? 'Collapse' : 'Expand', onselect: () => toggleFolder(n.id) },
    ];
  }
  const url = n.url ?? '';
  const blocked = isScriptUrl(url);
  return [
    {
      type: 'item',
      label: 'Open',
      disabled: blocked,
      onselect: () => void openBookmark(n, 'current'),
    },
    {
      type: 'item',
      label: 'Open in new tab',
      disabled: blocked,
      onselect: () => void openBookmark(n, 'tab'),
    },
    {
      type: 'item',
      label: 'Open in new window',
      disabled: blocked,
      onselect: () => void openBookmark(n, 'window'),
    },
    {
      type: 'item',
      label: 'Copy link',
      onselect: () => void copyLink(url).then((m) => (status = m)),
    },
    { type: 'separator' },
    { type: 'item', label: 'Delete', danger: true, onselect: () => askDelete(n) },
  ];
}

function openMenu(r: BookmarkRow, x: number, y: number): void {
  menu = {
    x,
    y,
    items: menuFor(r),
    label: `Actions for ${r.node.title || r.node.url || 'folder'}`,
  };
}

function closeMenu(): void {
  if (!menu) return;
  menu = null;
  list?.scroller()?.focus();
}

function onContext(ev: MouseEvent, r: BookmarkRow): void {
  ev.preventDefault();
  focusedId = r.node.id;
  openMenu(r, ev.clientX, ev.clientY);
}

function onRowClick(ev: MouseEvent, r: BookmarkRow): void {
  focusedId = r.node.id;
  activate(r, ev.ctrlKey || ev.metaKey);
}

function onRowAux(ev: MouseEvent, r: BookmarkRow): void {
  if (ev.button !== 1) return;
  ev.preventDefault();
  if (isFolder(r.node)) askOpenAll(r.node);
  else void openBookmark(r.node, 'tab');
}

function onKeydown(ev: KeyboardEvent): void {
  if (ev.altKey) return;
  const i = focusedIndex;
  const r = i >= 0 ? shownRows[i] : undefined;
  switch (ev.key) {
    case 'ArrowDown':
      focusIndex(i + 1);
      break;
    case 'ArrowUp':
      focusIndex(i < 0 ? 0 : i - 1);
      break;
    case 'Home':
      focusIndex(0);
      break;
    case 'End':
      focusIndex(shownRows.length - 1);
      break;
    case 'ArrowRight':
      if (r && isFolder(r.node)) {
        if (!expanded.has(r.node.id)) toggleFolder(r.node.id, true);
        else focusIndex(i + 1);
      }
      break;
    case 'ArrowLeft':
      if (r && !searchMode) {
        if (isFolder(r.node) && expanded.has(r.node.id)) toggleFolder(r.node.id, false);
        else if (r.parentId) focusedId = r.parentId;
        if (focusedId) list?.reveal(shownRows.findIndex((x) => x.node.id === focusedId));
      }
      break;
    case 'Enter':
    case ' ':
      if (r) activate(r, ev.ctrlKey || ev.metaKey);
      break;
    case 'Delete':
      if (r && !isFolder(r.node)) askDelete(r.node);
      break;
    case 'ContextMenu':
      openMenuFromKeyboard(r);
      break;
    case 'F10':
      if (!ev.shiftKey) return;
      openMenuFromKeyboard(r);
      break;
    case '/':
      search?.focus();
      break;
    default:
      return;
  }
  ev.preventDefault();
}

function openMenuFromKeyboard(r: BookmarkRow | undefined): void {
  const el = list?.scroller();
  if (!r || !el) return;
  const row = el.querySelector<HTMLElement>(`#vc-bm-${CSS.escape(r.node.id)}`);
  const box = (row ?? el).getBoundingClientRect();
  openMenu(r, box.left + 24, box.bottom);
}

function onSearchKey(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    list?.scroller()?.focus();
  } else if (ev.key === 'Escape' && query) {
    ev.preventDefault();
    onSearchInput('');
  }
}

async function onListFocus(): Promise<void> {
  if (focusedId === null && shownRows.length) {
    focusedId = shownRows[0]?.node.id ?? null;
    await tick();
  }
}

const title = (n: Node): string => n.title || (n.url ? displayUrl(n.url) : 'Untitled');
</script>

<div class="wrap">
  <SegmentCard title="Bookmarks" fill>
    {#snippet icon()}<Icon name="bookmark" size={12} />{/snippet}
    {#snippet trailing()}
      {#if !loading && !error && activeTab && !bookmarkedActive}
        <button type="button" class="add" onclick={() => void bookmarkCurrent()} title="Bookmark the current tab">
          <Icon name="plus" size={12} /> Bookmark tab
        </button>
      {/if}
    {/snippet}

    <div class="inner">
      <div class="search">
        <Icon name="search" size={14} />
        <input
          bind:this={search}
          type="search"
          aria-label="Search bookmarks"
          placeholder="Search bookmarks"
          autocomplete="off"
          spellcheck="false"
          value={query}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          onkeydown={onSearchKey}
        />
      </div>

      {#if confirm}
        {@const c = confirm}
        <div class="confirm" role="alertdialog" aria-label="Confirm" aria-describedby="vc-bm-confirm">
          <p id="vc-bm-confirm">{c.message}</p>
          <div class="confirm-row">
            <button
              type="button"
              class="btn"
              class:danger={c.danger}
              onclick={acceptConfirm}>{c.action}</button
            >
            <button type="button" class="btn text" onclick={() => (confirm = null)}>Cancel</button>
          </div>
        </div>
      {/if}

      {#if loading}
        <p class="message" role="status">Loading bookmarks…</p>
      {:else if error}
        <div class="message" role="alert">
          <p>Bookmarks aren’t available: {error}</p>
          <button type="button" class="btn primary" onclick={() => void load()}>Retry</button>
        </div>
      {:else if searching && !searchMode}
        <p class="message" role="status">Searching…</p>
      {:else if shownRows.length === 0}
        <p class="message">{searchMode ? 'No matching bookmarks' : 'No bookmarks yet'}</p>
      {:else}
        <VirtualList
          bind:this={list}
          items={shownRows}
          rowHeight={rh.value}
          key={(r) => r.node.id}
          role={searchMode ? 'listbox' : 'tree'}
          tabindex={0}
          aria-label={searchMode ? 'Bookmark search results' : 'Bookmarks'}
          aria-activedescendant={focusedId ? `vc-bm-${focusedId}` : undefined}
          onkeydown={onKeydown}
          onfocus={onListFocus}
        >
          {#snippet row(r)}
            {@const n = r.node}
            {@const folder = isFolder(n)}
            {@const blocked = !folder && isScriptUrl(n.url ?? '')}
            {@const label = title(n)}
            {@const titleParts = searchMode && n.title ? segments(n.title, matchRanges(n.title, query)) : null}
            {@const shown = n.url ? displayUrl(n.url) : ''}
            {@const urlParts = searchMode && shown ? segments(shown, matchRanges(shown, query)) : null}
            <!-- Keyboard activation is handled on the tree via aria-activedescendant. -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              id="vc-bm-{n.id}"
              class="row"
              class:focused={focusedId === n.id}
              class:blocked
              style:height="{rh.value}px"
              style:padding-left="{12 + (r.level - 1) * 16}px"
              role={searchMode ? 'option' : 'treeitem'}
              tabindex="-1"
              aria-level={searchMode ? undefined : r.level}
              aria-posinset={r.pos}
              aria-setsize={r.size}
              aria-expanded={folder && !searchMode ? expanded.has(n.id) : undefined}
              aria-selected={focusedId === n.id}
              aria-disabled={blocked ? true : undefined}
              title={blocked
                ? `${label}\nBookmarklets are not run from the side panel`
                : `${label}${n.url ? `\n${n.url}` : ''}`}
              onclick={(ev) => onRowClick(ev, r)}
              onauxclick={(ev) => onRowAux(ev, r)}
              oncontextmenu={(ev) => onContext(ev, r)}
            >
              {#if folder}
                <span class="chev" class:open={expanded.has(n.id)} aria-hidden="true"><Icon name="chevron" size={12} /></span>
                <span class="folder" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /></svg>
                </span>
              {:else}
                <Favicon url={n.url ?? ''} />
              {/if}
              <span class="text">
                <span class="label" class:folder-label={folder}
                  >{#if titleParts}{#each titleParts as s, i (i)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}{:else}{label}{/if}</span
                >
                {#if !folder && shown}
                  <span class="url"
                    >{#if blocked}Bookmarklet, not run here{:else if urlParts}{#each urlParts as s, i (i)}{#if s.hit}<mark>{s.text}</mark>{:else}{s.text}{/if}{/each}{:else}{shown}{/if}</span
                  >
                {/if}
              </span>
              {#if folder && n.children?.length}<span class="n" aria-hidden="true">{n.children.length}</span>{/if}
            </div>
          {/snippet}
        </VirtualList>
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

  .add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--state-selected);
    color: var(--mOnSurface);
    font-size: var(--font-size-meta);
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease);
  }

  .add:hover {
    background: color-mix(in srgb, var(--mPrimary) 22%, transparent);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px var(--pad-card) 6px;
    padding: 0 10px;
    height: 32px;
    flex: none;
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

  .confirm {
    flex: none;
    margin: 0 var(--pad-card) 6px;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-row);
    background: var(--surface-0);
  }

  .confirm p {
    margin: 0 0 6px;
    overflow-wrap: anywhere;
  }

  .confirm-row {
    display: flex;
    gap: 6px;
  }

  .btn {
    height: 26px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--state-selected);
    font-weight: 500;
    cursor: pointer;
  }

  .btn.primary {
    border-color: transparent;
    background: var(--mPrimary);
    color: var(--mOnPrimary);
  }

  .btn.danger {
    border-color: var(--mError);
    background: transparent;
    color: var(--mError);
  }

  .btn.text {
    border-color: transparent;
    background: transparent;
    color: var(--mOnSurfaceVariant);
  }

  .btn:hover {
    filter: brightness(1.1);
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
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

  :global([role='tree']:focus-visible) .row.focused,
  :global([role='listbox']:focus-visible) .row.focused {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .row.blocked {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .chev {
    flex: none;
    display: grid;
    place-items: center;
    width: 12px;
    color: var(--mOnSurfaceVariant);
    transition: transform var(--dur) var(--ease);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .folder {
    flex: none;
    display: grid;
    place-items: center;
    color: var(--mPrimaryText);
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

  .folder-label {
    font-weight: 600;
  }

  .url {
    display: none;
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    line-height: 1.15;
  }

  :global(html[data-row-layout='double']) .url,
  .row.blocked .url {
    display: block;
  }

  :global(html[data-row-layout='double']) .label {
    line-height: 1.2;
  }

  .n {
    flex: none;
    min-width: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--mOnSurfaceVariant);
    font-size: var(--font-size-meta);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  mark {
    padding: 0;
    border-radius: 2px;
    background: color-mix(in srgb, var(--mPrimary) 35%, transparent);
    /* Pale dark-mode primaries mix to grey; the underline keeps the match visible. */
    box-shadow: inset 0 -2px 0 var(--mPrimary);
    color: inherit;
  }

  .message {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
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
