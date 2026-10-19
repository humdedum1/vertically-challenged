<script lang="ts">
/*
 * Keyboard map (focus stays on the tree; rows are addressed with aria-activedescendant):
 *   Up / Down          move focus            Home / End      first / last row
 *   Left               collapse group, or go to the parent group
 *   Right              expand group, or go to its first tab
 *   Enter              activate tab / toggle group
 *   Space              toggle selection of the focused tab (group: toggle)
 *   Shift+Up / Down    extend selection      Ctrl+A          select all visible tabs
 *   Delete             close selection (or the focused tab / group)
 *   F2                 rename the focused group
 *   Alt+Up / Down      move the focused tab, selection or group one row
 *   ContextMenu / Shift+F10   open the context menu
 *   Escape             clear selection, then clear the search
 *   / or Ctrl+F        focus the search field (Down from it enters the results)
 */
import { untrack } from 'svelte';
import { type HoverTarget, PointerDrag } from '../../lib/drag/pointer-drag';
import { FuzzyIndex } from '../../lib/search/fuzzy-index';
import type { SearchIndex } from '../../lib/search/search-index';
import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import { type Drag, planDrop } from '../model/drop-plan';
import { groupMenu, tabMenu } from '../model/menus';
import { buildRows, buildSearchRows, type Row } from '../model/rows';
import { pruneSelection, tabIdsBetween } from '../model/selection';
import type { TabState } from '../tab-state.svelte';
import ContextMenu from './ContextMenu.svelte';
import GroupRow from './GroupRow.svelte';
import Icon from './Icon.svelte';
import type { MenuItem } from './menu-types';
import TabRow from './TabRow.svelte';
import VirtualList from './VirtualList.svelte';

interface Props {
  tabState: TabState;
  /** Driven by the density setting; applyAppearance sets the matching --row-height. */
  rowHeight: number;
  /** Where the search field sits relative to the list, or hidden (then search is disabled). */
  search?: 'top' | 'bottom' | 'hidden';
  /** Title + URL rows. */
  twoLine?: boolean;
  showClose?: boolean;
  showMute?: boolean;
}

let {
  tabState,
  rowHeight,
  search = 'top',
  twoLine = false,
  showClose = true,
  showMute = true,
}: Props = $props();

const send = (msg: PanelMessage): void => tabState.send(msg);

// --- Data ------------------------------------------------------------------------------

// The only place a concrete matcher is chosen; everything else sees the interface.
const index: SearchIndex = new FuzzyIndex();
let fedTabs = $state.raw<TabInfo[]>([]);
// Pre-effect so the index is fed before the derived search below reads it in the same flush.
$effect.pre(() => {
  index.replaceAll(tabState.tabs);
  fedTabs = tabState.tabs;
});

let query = $state('');
const needle = $derived(query.trim());
const searching = $derived(needle !== '');
const treeRows = $derived(buildRows(tabState.tabs, tabState.groups));
const view: Row[] = $derived(searching ? buildSearchRows(fedTabs, index.search(needle)) : treeRows);
const keyIndex = $derived(new Map(view.map((r, i) => [r.key, i])));
const groupById = $derived(new Map(tabState.groups.map((g) => [g.id, g])));
const showUrl = $derived(twoLine || (rowHeight >= 34 && searching));

// --- Focus -----------------------------------------------------------------------------

let list: ReturnType<typeof VirtualList<Row>> | undefined = $state();
let searchInput: HTMLInputElement | undefined = $state();
let focusKey = $state<string | null>(null);
// Plain: only read when the focused row has vanished, so it must not trigger anything.
let lastIndex = 0;

const focusedIndex = $derived.by(() => {
  const i = focusKey === null ? undefined : keyIndex.get(focusKey);
  return i ?? Math.max(0, Math.min(lastIndex, view.length - 1));
});
const focusedRow = $derived(view[focusedIndex]);

const tree = (): HTMLElement | undefined => list?.scroller();

function setFocus(i: number, reveal = true): void {
  const n = Math.max(0, Math.min(i, view.length - 1));
  lastIndex = n;
  focusKey = view[n]?.key ?? null;
  if (reveal) list?.reveal(n);
}

// Keep the focused row in view after it moves (keyboard moves, remote changes).
$effect(() => {
  const i = focusedIndex;
  untrack(() => {
    if (document.activeElement === tree()) list?.reveal(i);
  });
});

// Follow the active tab when it changes from outside (Ctrl+Tab, tab strip, first load).
let activeSeen: number | null = null;
$effect(() => {
  const id = tabState.tabs.find((t) => t.active)?.id ?? null;
  if (id === activeSeen) return;
  activeSeen = id;
  untrack(() => {
    const i = id === null || searching ? undefined : keyIndex.get(`t${id}`);
    if (i !== undefined) setFocus(i);
  });
});

// --- Selection -------------------------------------------------------------------------

let selection = $state.raw<ReadonlySet<number>>(new Set());
let anchorId: number | null = null;

$effect(() => {
  const next = pruneSelection(
    untrack(() => selection),
    tabState.tabs,
  );
  if (next !== untrack(() => selection)) selection = next;
});

function select(ids: Iterable<number>): void {
  selection = new Set(ids);
}

function selectRangeTo(i: number): void {
  const anchor = anchorId === null ? undefined : keyIndex.get(`t${anchorId}`);
  select(tabIdsBetween(view, anchor ?? focusedIndex, i));
}

function toggleSelect(id: number): void {
  const next = new Set(selection);
  if (!next.delete(id)) next.add(id);
  selection = next;
  anchorId = id;
}

// --- Row events ------------------------------------------------------------------------

let preToggle = false;

function onTabClick(e: MouseEvent, i: number, tab: TabInfo): void {
  setFocus(i, false);
  tree()?.focus();
  if (e.shiftKey) selectRangeTo(i);
  else if (e.ctrlKey || e.metaKey) toggleSelect(tab.id);
  else {
    select([tab.id]);
    anchorId = tab.id;
    send({ type: 'activate', tabId: tab.id });
  }
}

function onGroupClick(e: MouseEvent, i: number): void {
  const row = view[i];
  if (row?.kind !== 'group') return;
  setFocus(i, false);
  tree()?.focus();
  // The second click of a double-click is the start of a rename, not another toggle.
  if (e.detail > 1) return;
  preToggle = row.group.collapsed;
  send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
}

function onGroupDblclick(i: number): void {
  const row = view[i];
  if (row?.kind !== 'group') return;
  // Always send (not "only if it differs"): the patch for the first click's toggle hasn't
  // arrived yet, so local state can't tell whether the toggle already happened.
  send({ type: 'updateGroup', groupId: row.group.id, collapsed: preToggle });
  startRename(row.group.id);
}

function targetsOf(tab: TabInfo): number[] {
  return selection.has(tab.id) ? [...selection] : [tab.id];
}

// --- Rename ----------------------------------------------------------------------------

let renamingId = $state<number | null>(null);
let pendingGroup: { tabIds: number[]; known: Set<number>; until: number } | null = null;

function startRename(groupId: number): void {
  const i = keyIndex.get(`g${groupId}`);
  if (i === undefined) return;
  setFocus(i);
  renamingId = groupId;
}

function onRenamed(groupId: number, title: string | null): void {
  renamingId = null;
  const g = groupById.get(groupId);
  if (title !== null && g && title !== g.title) send({ type: 'updateGroup', groupId, title });
  tree()?.focus();
}

// "Add to new group": the new group id is unknown until Chrome reports it, so watch for
// a group that now contains the first tab and wasn't there before.
$effect(() => {
  const tabs = tabState.tabs;
  void tabState.groups;
  const p = pendingGroup;
  if (!p) return;
  if (Date.now() > p.until) {
    pendingGroup = null;
    return;
  }
  const first = tabs.find((t) => t.id === p.tabIds[0]);
  if (
    first &&
    first.groupId !== -1 &&
    !p.known.has(first.groupId) &&
    groupById.has(first.groupId)
  ) {
    pendingGroup = null;
    untrack(() => startRename(first.groupId));
  }
});

// --- Context menu ----------------------------------------------------------------------

let menu = $state.raw<{ x: number; y: number; label: string; items: MenuItem[] } | null>(null);

function openMenu(i: number, x: number, y: number): void {
  const row = view[i];
  if (!row) return;
  setFocus(i, false);
  if (row.kind === 'group') {
    menu = {
      x,
      y,
      label: 'Group actions',
      items: groupMenu({
        group: row.group,
        tabs: tabState.tabs,
        windowId: tabState.windowId ?? 0,
        send,
        onRename: () => startRename(row.group.id),
      }),
    };
    return;
  }
  const tabs = selection.has(row.tab.id)
    ? tabState.tabs.filter((t) => selection.has(t.id))
    : [row.tab];
  menu = {
    x,
    y,
    label: 'Tab actions',
    items: tabMenu({
      target: row.tab,
      tabs,
      allTabs: tabState.tabs,
      groups: tabState.groups,
      windowId: tabState.windowId ?? 0,
      send,
      onNewGroup: (tabIds) => {
        pendingGroup = {
          tabIds,
          known: new Set(tabState.groups.map((g) => g.id)),
          until: Date.now() + 4000,
        };
      },
    }),
  };
}

function onContextMenu(e: MouseEvent, i: number): void {
  e.preventDefault();
  openMenu(i, e.clientX, e.clientY);
}

function closeMenu(): void {
  if (!menu) return;
  menu = null;
  tree()?.focus();
}

function openMenuFromKeyboard(): void {
  const el = tree();
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const y = rect.top + focusedIndex * rowHeight - el.scrollTop + rowHeight;
  openMenu(focusedIndex, rect.left + 40, Math.min(Math.max(y, rect.top), rect.bottom - 8));
}

// --- Keyboard moves + announcements ----------------------------------------------------

let announcement = $state('');

const rowName = (r: Row): string =>
  r.kind === 'group' ? r.group.title || 'Unnamed group' : r.tab.title || r.tab.url || 'New Tab';

function moveByKey(dir: -1 | 1): void {
  if (searching) return;
  const row = focusedRow;
  if (!row) return;
  let drag: Drag;
  let isMoving: (r: Row) => boolean;
  let what: string;
  if (row.kind === 'group') {
    const gid = row.group.id;
    drag = { kind: 'group', groupId: gid };
    isMoving = (r) => (r.kind === 'group' ? r.group.id === gid : r.tab.groupId === gid);
    what = rowName(row);
  } else {
    const ids = selection.has(row.tab.id) ? new Set(selection) : new Set([row.tab.id]);
    drag = { kind: 'tabs', tabIds: [...ids] };
    isMoving = (r) => r.kind === 'tab' && ids.has(r.tab.id);
    what = ids.size > 1 ? `${ids.size} tabs` : rowName(row);
  }
  let first = -1;
  let last = -1;
  for (let i = 0; i < view.length; i++) {
    if (!isMoving(view[i] as Row)) continue;
    if (first === -1) first = i;
    last = i;
  }
  let j = dir < 0 ? first - 1 : last + 1;
  while (j >= 0 && j < view.length && isMoving(view[j] as Row)) j += dir;
  const neighbour = view[j];
  if (!neighbour) {
    announcement = `${what} is already ${dir < 0 ? 'first' : 'last'}`;
    return;
  }
  // Crossing a group edge takes one press of its own: the first press only changes
  // membership (enter as last child / leave just past the group), like moving through a
  // folder boundary, instead of jumping a row and changing membership at once.
  let zone: 'before' | 'after' = dir < 0 ? 'before' : 'after';
  if (drag.kind === 'tabs' && row.kind === 'tab') {
    const from = row.tab.pinned ? -1 : row.tab.groupId;
    if (
      dir < 0 &&
      neighbour.kind === 'tab' &&
      neighbour.level === 2 &&
      neighbour.tab.groupId !== from
    ) {
      zone = 'after';
    } else if (
      dir > 0 &&
      from !== -1 &&
      (neighbour.kind === 'group' || neighbour.tab.groupId !== from)
    ) {
      zone = 'before';
    }
  }
  const plan = planDrop(dropContext(), view, drag, j, zone);
  if (!plan) {
    announcement = `Can’t move ${what} ${dir < 0 ? 'above' : 'below'} ${rowName(neighbour)}`;
    return;
  }
  send(plan);
  announcement = `Moved ${what} ${dir < 0 ? 'above' : 'below'} ${rowName(neighbour)}`;
}

const dropContext = () => ({ windowId: tabState.windowId ?? 0, tabs: tabState.tabs });

// --- Pointer drag and drop -------------------------------------------------------------

let ghost: HTMLDivElement | undefined = $state();
let dragLabel = $state<string | null>(null);
let drop = $state.raw<(HoverTarget & { ok: boolean }) | null>(null);
let dragPayload: Drag | null = null;
// The ghost mounts a frame after the drag starts, so remember where the pointer is.
let pointer = { x: 0, y: 0 };

const placeGhost = (node: HTMLElement): void => {
  node.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
};

const dnd = new PointerDrag<Drag>({
  scroller: () => list?.scroller(),
  rowHeight: () => rowHeight,
  rowCount: () => view.length,
  isGroup: (i) => view[i]?.kind === 'group',
  begin: (i) => {
    const row = view[i];
    if (!row || searching) return null;
    if (row.kind === 'group') return { kind: 'group', groupId: row.group.id };
    const ids = selection.has(row.tab.id)
      ? tabState.tabs.filter((t) => selection.has(t.id)).map((t) => t.id)
      : [row.tab.id];
    return { kind: 'tabs', tabIds: ids };
  },
  onStart: (payload) => {
    dragPayload = payload;
    if (payload.kind === 'group') {
      dragLabel = groupById.get(payload.groupId)?.title || 'Unnamed group';
    } else if (payload.tabIds.length > 1) {
      dragLabel = `${payload.tabIds.length} tabs`;
    } else {
      const t = tabState.tabs.find((x) => x.id === payload.tabIds[0]);
      dragLabel = t?.title || t?.url || 'New Tab';
    }
    menu = null;
  },
  onHover: (t) => {
    drop =
      t && dragPayload
        ? { ...t, ok: planDrop(dropContext(), view, dragPayload, t.index, t.zone) !== null }
        : null;
  },
  onMove: (x, y) => {
    pointer = { x, y };
    if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  },
  onDrop: (payload, t) => {
    if (!t) return;
    const plan = planDrop(dropContext(), view, payload, t.index, t.zone);
    if (plan) send(plan);
  },
  onEnd: () => {
    dragLabel = null;
    drop = null;
    dragPayload = null;
  },
});

$effect(() => () => dnd.dispose());

function onPointerDown(e: PointerEvent): void {
  if ((e.target as Element).closest('[role=treeitem]')) dnd.press(e);
}

// Keeps focus on the tree instead of letting a click land on a row, and stops the
// middle-click autoscroll cursor; the rename input needs the default behaviour.
function onMouseDown(e: MouseEvent): void {
  if ((e.target as Element).closest('input')) return;
  e.preventDefault();
  tree()?.focus();
}

// --- Keyboard --------------------------------------------------------------------------

function onkeydown(e: KeyboardEvent): void {
  const row = focusedRow;
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      moveByKey(e.key === 'ArrowUp' ? -1 : 1);
      e.preventDefault();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'a') {
      select(tabIdsBetween(view, 0, view.length - 1));
      e.preventDefault();
    }
    return;
  }
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      const next = Math.max(
        0,
        Math.min(view.length - 1, focusedIndex + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      if (e.shiftKey) {
        if (anchorId === null && row?.kind === 'tab') anchorId = row.tab.id;
        selectRangeTo(next);
      }
      setFocus(next);
      break;
    }
    case 'Home':
      setFocus(0);
      break;
    case 'End':
      setFocus(view.length - 1);
      break;
    case 'ArrowLeft':
      if (searching || !row) return;
      if (row.kind === 'group' && !row.group.collapsed) {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: true });
      } else if (row.kind === 'tab' && row.level === 2) {
        const parent = keyIndex.get(`g${row.tab.groupId}`);
        if (parent !== undefined) setFocus(parent);
      }
      break;
    case 'ArrowRight':
      if (searching || row?.kind !== 'group') return;
      if (row.group.collapsed)
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: false });
      else if (view[focusedIndex + 1]?.kind === 'tab') setFocus(focusedIndex + 1);
      break;
    case 'Enter':
      if (row?.kind === 'tab') {
        select([row.tab.id]);
        anchorId = row.tab.id;
        send({ type: 'activate', tabId: row.tab.id });
      } else if (row) {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
      }
      break;
    case ' ':
      if (row?.kind === 'tab') toggleSelect(row.tab.id);
      else if (row)
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
      break;
    case 'Delete':
      if (row?.kind === 'tab') send({ type: 'close', tabIds: targetsOf(row.tab) });
      else if (row) send({ type: 'closeGroup', groupId: row.group.id });
      break;
    case 'F2':
      if (row?.kind !== 'group') return;
      startRename(row.group.id);
      break;
    case 'ContextMenu':
      openMenuFromKeyboard();
      break;
    case 'F10':
      if (!e.shiftKey) return;
      openMenuFromKeyboard();
      break;
    case 'Escape':
      if (selection.size > 0) select([]);
      else if (query !== '') query = '';
      else return;
      break;
    default:
      return;
  }
  e.preventDefault();
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    if (view.length === 0) return;
    e.preventDefault();
    setFocus(0);
    tree()?.focus();
  } else if (e.key === 'Enter') {
    const first = view[0];
    if (first?.kind === 'tab') {
      e.preventDefault();
      send({ type: 'activate', tabId: first.tab.id });
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (query !== '') query = '';
    else searchInput?.blur();
  }
}

// A filter with no field to clear it would trap the list in a filtered state.
$effect(() => {
  if (search === 'hidden') query = '';
});

$effect(() => {
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    const find = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f';
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
    if ((!find && !slash) || !searchInput) return;
    e.preventDefault();
    searchInput?.focus();
    searchInput?.select();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
});
</script>

{#snippet searchField()}
  <div class="search" class:bottom={search === 'bottom'}>
    <span class="lead"><Icon name="search" size={14} /></span>
    <input
      bind:this={searchInput}
      bind:value={query}
      type="text"
      role="searchbox"
      placeholder="Search tabs"
      aria-label="Search tabs"
      spellcheck="false"
      autocomplete="off"
      onkeydown={onSearchKeydown}
    />
    {#if query}
      <button type="button" class="clear" aria-label="Clear search" onclick={() => { query = ''; searchInput?.focus(); }}>
        <Icon name="close" size={12} />
      </button>
    {/if}
  </div>
{/snippet}

<div class="wrap">
  {#if search === 'top'}{@render searchField()}{/if}

  <div class="body">
    {#if searching && view.length === 0}
      <p class="empty" role="status">No tabs match “{needle}”</p>
    {:else}
      <VirtualList
        bind:this={list}
        items={view}
        {rowHeight}
        key={(r) => r.key}
        role="tree"
        aria-label="Tabs in this window"
        aria-multiselectable="true"
        tabindex={0}
        aria-activedescendant={focusedRow ? `vc-row-${focusedRow.key}` : undefined}
        {onkeydown}
        onfocus={() => list?.reveal(focusedIndex)}
        onpointerdown={onPointerDown}
        onmousedown={onMouseDown}
      >
        {#snippet row(r, i)}
          {#if r.kind === 'group'}
            <GroupRow
              group={r.group}
              count={r.count}
              pos={r.pos}
              size={r.size}
              focused={i === focusedIndex}
              renaming={renamingId === r.group.id}
              onclick={(e) => onGroupClick(e, i)}
              ondblclick={() => onGroupDblclick(i)}
              oncontextmenu={(e) => onContextMenu(e, i)}
              onrenamed={(title) => onRenamed(r.group.id, title)}
            />
          {:else}
            <TabRow
              tab={r.tab}
              level={r.level}
              pos={r.pos}
              size={r.size}
              focused={i === focusedIndex}
              selected={selection.has(r.tab.id)}
              selectedLook={selection.has(r.tab.id) && (selection.size > 1 || !r.tab.active)}
              pinnedEnd={r.pinnedEnd}
              groupColor={r.level === 2 && groupById.has(r.tab.groupId)
                ? `var(--g-${groupById.get(r.tab.groupId)?.color})`
                : undefined}
              highlight={r.highlight}
              {showUrl}
              {showClose}
              {showMute}
              onclick={(e) => onTabClick(e, i, r.tab)}
              oncontextmenu={(e) => onContextMenu(e, i)}
              onclose={() => send({ type: 'close', tabIds: targetsOf(r.tab) })}
              onmute={() => send({ type: 'setMuted', tabIds: targetsOf(r.tab), muted: !r.tab.muted })}
            />
          {/if}
        {/snippet}
        {#snippet overlay()}
          {#if drop?.ok}
            {#if drop.zone === 'inside'}
              <div class="drop-box" style:top="{drop.index * rowHeight}px" style:height="{rowHeight}px"></div>
            {:else}
              <div class="drop-line" style:top="{(drop.index + (drop.zone === 'after' ? 1 : 0)) * rowHeight - 1}px"></div>
            {/if}
          {/if}
        {/snippet}
      </VirtualList>
    {/if}
  </div>

  {#if search === 'bottom'}{@render searchField()}{/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} label={menu.label} items={menu.items} onclose={closeMenu} />
  {/if}

  {#if dragLabel !== null}
    <div class="ghost" bind:this={ghost} use:placeGhost aria-hidden="true">{dragLabel}</div>
  {/if}

  <div class="sr" role="status" aria-live="polite">{announcement}</div>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .search {
    position: relative;
    flex: none;
    margin: 2px 8px 6px;
  }

  .search.bottom {
    margin: 6px 8px 8px;
  }

  .search input {
    width: 100%;
    height: 32px;
    padding: 0 32px 0 32px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: inherit;
  }

  .search input::placeholder {
    color: var(--mOnSurfaceVariant);
  }

  .lead {
    position: absolute;
    left: 11px;
    top: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    color: var(--mOnSurfaceVariant);
    pointer-events: none;
  }

  .clear {
    position: absolute;
    right: 5px;
    top: 5px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--mOnSurfaceVariant);
    cursor: pointer;
  }

  .clear:hover {
    background: var(--state-hover);
    color: var(--mOnSurface);
  }

  .body {
    flex: 1;
    min-height: 0;
  }

  .body :global([role='tree']) {
    padding: 4px;
    outline: none;
  }

  .empty {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    color: var(--mOnSurfaceVariant);
  }

  .drop-line {
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 2px;
    background: var(--mPrimary);
    pointer-events: none;
  }

  .drop-box {
    position: absolute;
    left: 2px;
    right: 2px;
    border: 2px solid var(--mPrimary);
    border-radius: var(--radius-row);
    background: color-mix(in srgb, var(--mPrimary) 12%, transparent);
    pointer-events: none;
  }

  .ghost {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 90;
    max-width: 220px;
    padding: 4px 10px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border: 1px solid var(--mPrimary);
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--mOnSurface);
    font-size: 12px;
    box-shadow: var(--shadow-2);
    pointer-events: none;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
