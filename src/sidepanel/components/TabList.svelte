<script lang="ts">
/*
 * Keyboard map (focus stays on the tree; rows are addressed with aria-activedescendant).
 * Fixed navigation keys:
 *   Up / Down          move focus            Home / End      first / last row
 *   Left               collapse group / window, or go to the parent header
 *   Right              expand group / window, or go to its first child
 *   Enter              activate tab / toggle group or window
 *   Space              toggle selection of the focused tab (group, window: toggle)
 *   Shift+Up / Down    extend selection
 *   Escape             clear selection, then clear the search
 * Configurable (Settings > Shortcuts; defaults in parentheses), looked up with actionFor():
 *   closeTab (Delete), renameGroup (F2), moveUp / moveDown (Alt+Up / Down), openMenu
 *   (Shift+F10, ContextMenu), selectAll (Ctrl+A), focusSearch (/, Ctrl+F; also works from
 *   outside the tree), newTab, duplicateTab, togglePin, toggleMute, suspendTab (unbound).
 */

import { untrack } from 'svelte';
import { type HoverTarget, PointerDrag } from '../../lib/drag/pointer-drag';
import { actionFor } from '../../lib/keymap';
import { FuzzyIndex } from '../../lib/search/fuzzy-index';
import type { SearchIndex } from '../../lib/search/search-index';
import type { Keymap, ShortcutAction } from '../../settings/schema';
import type { PinItem } from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { GroupInfo, TabInfo } from '../../shared/types';
import { type Drag, type DropZone, type MultiDropContext, planDropMulti } from '../model/drop-plan';
import { essentialMenu, groupMenu, tabMenu, windowLabel, windowMenu } from '../model/menus';
import { buildSearchRows, buildWindowRows, type ListRow as Row, rowWindowId } from '../model/rows';
import { pruneSelection, tabIdsBetween } from '../model/selection';
import type { TabState } from '../tab-state.svelte';
import { tintCache } from '../tint-cache.svelte';
import ContextMenu from './ContextMenu.svelte';
import EssentialsGrid from './EssentialsGrid.svelte';
import GroupRow from './GroupRow.svelte';
import Icon from './Icon.svelte';
import type { MenuItem } from './menu-types';
import TabRow from './TabRow.svelte';
import VirtualList from './VirtualList.svelte';
import WindowRow from './WindowRow.svelte';

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
  shortcuts: Keymap;
  /** Never-auto-suspend host patterns, for the tab menu. */
  whitelist: readonly string[];
  onWhitelist: (host: string, add: boolean) => void;
}

let {
  tabState,
  rowHeight,
  search = 'top',
  twoLine = false,
  showClose = true,
  showMute = true,
  shortcuts,
  whitelist,
  onWhitelist,
}: Props = $props();

const send = (msg: PanelMessage): void => tabState.send(msg);

// --- Data ------------------------------------------------------------------------------

// The only place a concrete matcher is chosen; everything else sees the interface.
const index: SearchIndex = new FuzzyIndex();
let fedTabs = $state.raw<readonly TabInfo[]>([]);

// Every tab / group the view can show: all windows of this panel's kind.
const allTabs = $derived(tabState.windows.flatMap((w) => w.tabs));
const allGroups = $derived(tabState.windows.flatMap((w) => w.groups));
const tabById = $derived(new Map(allTabs.map((t) => [t.id, t])));
const windowViewById = $derived(new Map(tabState.windows.map((w) => [w.info.id, w])));
const windowNumber = $derived(new Map(tabState.windows.map((w, i) => [w.info.id, i + 1])));
const tabsOfWindow = (id: number): readonly TabInfo[] => windowViewById.get(id)?.tabs ?? [];

// Pre-effect so the index is fed before the derived search below reads it in the same flush.
$effect.pre(() => {
  index.replaceAll(allTabs);
  fedTabs = allTabs;
});

// Collapsed windows are UI state only (Chrome has no such concept). Window ids don't survive
// a browser restart, so entries for windows that no longer exist are pruned.
const COLLAPSED_KEY = 'vc.collapsedWindows';
function loadCollapsed(): ReadonlySet<number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is number => Number.isInteger(x)) : []);
  } catch {
    return new Set();
  }
}
let collapsedWindows = $state.raw<ReadonlySet<number>>(loadCollapsed());

function setCollapsedWindows(next: ReadonlySet<number>): void {
  collapsedWindows = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    // Storage unavailable: the choice just doesn't persist.
  }
}

function setWindowCollapsed(id: number, collapsed: boolean): void {
  if (collapsedWindows.has(id) === collapsed) return;
  const next = new Set(collapsedWindows);
  if (collapsed) next.add(id);
  else next.delete(id);
  setCollapsedWindows(next);
}

$effect(() => {
  const known = new Set(tabState.windowList.map((w) => w.id));
  const current = untrack(() => collapsedWindows);
  if (known.size === 0) return;
  const next = new Set([...current].filter((id) => known.has(id)));
  if (next.size !== current.size) untrack(() => setCollapsedWindows(next));
});

let query = $state('');
const needle = $derived(query.trim());
const searching = $derived(needle !== '');
const treeRows: Row[] = $derived(
  buildWindowRows(tabState.windows, tabState.windowId, collapsedWindows),
);
// aria-level of tabs inside a group: one deeper under a window header.
const nested = $derived(!searching);
const groupLevel = $derived(nested ? 3 : 2);
const view: Row[] = $derived(searching ? buildSearchRows(fedTabs, index.search(needle)) : treeRows);
const keyIndex = $derived(new Map(view.map((r, i) => [r.key, i])));
const groupById = $derived(new Map<number, GroupInfo>(allGroups.map((g) => [g.id, g])));
const windowName = (id: number): string =>
  windowLabel(windowNumber.get(id) ?? 0, id === tabState.windowId);
const showUrl = $derived(twoLine || (rowHeight >= 34 && searching));

// The home window's Essentials sit above the list as a grid; other windows' render as rows.
const homeLayout = $derived(
  tabState.windowId === null ? undefined : tabState.layoutOf(tabState.windowId),
);
const essentials = $derived(homeLayout?.essentials ?? []);
const homeTabById = $derived(new Map(tabState.tabs.map((t) => [t.id, t])));
const showGrid = $derived(!searching && essentials.length > 0);
let grid: ReturnType<typeof EssentialsGrid> | undefined = $state();

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
    allTabs,
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

function onWindowClick(i: number): void {
  const row = view[i];
  if (row?.kind !== 'window') return;
  setFocus(i, false);
  tree()?.focus();
  setWindowCollapsed(row.info.id, !row.collapsed);
}

function onGroupDblclick(i: number): void {
  const row = view[i];
  if (row?.kind !== 'group') return;
  // Always send (not "only if it differs"): the patch for the first click's toggle hasn't
  // arrived yet, so local state can't tell whether the toggle already happened.
  send({ type: 'updateGroup', groupId: row.group.id, collapsed: preToggle });
  startRename(row.group.id);
}

/** What an action on `tab` applies to: the selection if it contains the tab, else the tab. */
function targetTabs(tab: TabInfo): TabInfo[] {
  return selection.has(tab.id) ? allTabs.filter((t) => selection.has(t.id)) : [tab];
}

const targetsOf = (tab: TabInfo): number[] => targetTabs(tab).map((t) => t.id);

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
  const tabs = allTabs;
  void allGroups;
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

let menu = $state.raw<{
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  /** Opened on an Essentials tile: focus goes back to the grid, not the tree. */
  fromGrid?: boolean;
} | null>(null);

function openEssentialMenu(x: number, y: number, item: PinItem): void {
  const windowId = tabState.windowId;
  if (windowId === null) return;
  menu = {
    x,
    y,
    label: 'Essential actions',
    fromGrid: true,
    items: essentialMenu({
      item,
      tab: item.tabId === null ? null : (homeTabById.get(item.tabId) ?? null),
      windowId,
      pinnedCount: homeLayout?.pinned.length ?? 0,
      send,
    }),
  };
}

function openMenu(i: number, x: number, y: number): void {
  const row = view[i];
  if (!row) return;
  setFocus(i, false);
  if (row.kind === 'window') {
    menu = {
      x,
      y,
      label: 'Window actions',
      items: windowMenu({
        info: row.info,
        tabs: windowViewById.get(row.info.id)?.tabs ?? [],
        send,
      }),
    };
    return;
  }
  if (row.kind === 'group') {
    menu = {
      x,
      y,
      label: 'Group actions',
      items: groupMenu({
        group: row.group,
        tabs: tabsOfWindow(row.group.windowId),
        send,
        onRename: () => startRename(row.group.id),
      }),
    };
    return;
  }
  const winId = row.tab.windowId;
  menu = {
    x,
    y,
    label: 'Tab actions',
    items: tabMenu({
      target: row.tab,
      tabs: targetTabs(row.tab),
      allTabs: tabsOfWindow(winId),
      groups: allGroups.filter((g) => g.windowId === winId),
      send,
      windows: tabState.windowList,
      homeWindowId: tabState.windowId,
      whitelist,
      onWhitelist,
      onNewGroup: (tabIds) => {
        pendingGroup = {
          tabIds,
          known: new Set(allGroups.map((g) => g.id)),
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
  const fromGrid = menu.fromGrid;
  menu = null;
  if (fromGrid && grid) grid.focus();
  else tree()?.focus();
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
  r.kind === 'window'
    ? windowLabel(r.number, r.isHome)
    : r.kind === 'group'
      ? r.group.title || 'Unnamed group'
      : r.tab.title || r.tab.url || 'New Tab';

const multiCtx: MultiDropContext = {
  ctxFor: (id) => {
    const w = windowViewById.get(id);
    return w ? { windowId: id, tabs: w.tabs } : null;
  },
  tab: (id) => tabById.get(id),
  isIncognito: (id) => windowViewById.get(id)?.info.incognito ?? false,
};

function planFor(drag: Drag, index: number, zone: DropZone): PanelMessage | null {
  return planDropMulti(multiCtx, view, drag, index, zone);
}

function moveByKey(dir: -1 | 1): void {
  if (searching) return;
  const row = focusedRow;
  if (!row || row.kind === 'window') return;
  let drag: Drag;
  let isMoving: (r: Row) => boolean;
  let what: string;
  if (row.kind === 'group') {
    const gid = row.group.id;
    drag = { kind: 'group', groupId: gid };
    isMoving = (r) =>
      r.kind === 'group' ? r.group.id === gid : r.kind === 'tab' && r.tab.groupId === gid;
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
  let neighbour = view[j];
  // A window header between two windows: step over it so one press crosses into the
  // neighbouring window (top of the next one, bottom of the previous one).
  let crossZone: DropZone | null = null;
  if (neighbour?.kind === 'window' && row.kind === 'tab') {
    const beyond = view[dir < 0 ? j - 1 : j + 1];
    if (beyond) {
      if (dir > 0 && beyond.kind !== 'window') {
        j += 1;
        neighbour = beyond;
        crossZone = 'before';
      } else if (dir < 0) {
        j -= 1;
        neighbour = beyond;
        crossZone = 'after';
      }
    } else if (dir < 0) neighbour = undefined;
  }
  if (!neighbour) {
    announcement = `${what} is already ${dir < 0 ? 'first' : 'last'}`;
    return;
  }
  // Crossing a group edge takes one press of its own: the first press only changes
  // membership (enter as last child / leave just past the group), like moving through a
  // folder boundary, instead of jumping a row and changing membership at once.
  let zone: DropZone = crossZone ?? (dir < 0 ? 'before' : 'after');
  if (crossZone === null && drag.kind === 'tabs' && row.kind === 'tab') {
    const from = row.tab.pinned ? -1 : row.tab.groupId;
    if (
      dir < 0 &&
      neighbour.kind === 'tab' &&
      neighbour.level === groupLevel &&
      neighbour.tab.groupId !== from
    ) {
      zone = 'after';
    } else if (
      dir > 0 &&
      from !== -1 &&
      (neighbour.kind === 'group' || (neighbour.kind === 'tab' && neighbour.tab.groupId !== from))
    ) {
      zone = 'before';
    }
  }
  const plan = planFor(drag, j, zone);
  if (!plan) {
    announcement = `Can’t move ${what} ${dir < 0 ? 'above' : 'below'} ${rowName(neighbour)}`;
    return;
  }
  send(plan);
  announcement = `Moved ${what} ${dir < 0 ? 'above' : 'below'} ${rowName(neighbour)}`;
}

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
  isGroup: (i) => view[i]?.kind === 'group' || view[i]?.kind === 'window',
  begin: (i) => {
    const row = view[i];
    if (!row || searching || row.kind === 'window') return null;
    if (row.kind === 'group') return { kind: 'group', groupId: row.group.id };
    return { kind: 'tabs', tabIds: targetsOf(row.tab) };
  },
  onStart: (payload) => {
    dragPayload = payload;
    if (payload.kind === 'group') {
      dragLabel = groupById.get(payload.groupId)?.title || 'Unnamed group';
    } else if (payload.tabIds.length > 1) {
      dragLabel = `${payload.tabIds.length} tabs`;
    } else {
      const t = tabById.get(payload.tabIds[0] as number);
      dragLabel = t?.title || t?.url || 'New Tab';
    }
    menu = null;
  },
  onHover: (t) => {
    drop = t && dragPayload ? { ...t, ok: planFor(dragPayload, t.index, t.zone) !== null } : null;
  },
  onMove: (x, y) => {
    pointer = { x, y };
    if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  },
  onDrop: (payload, t) => {
    if (!t) return;
    const plan = planFor(payload, t.index, t.zone);
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

/** Runs a configurable shortcut; false means it doesn't apply to the focused row. */
function runAction(action: ShortcutAction, row: Row | undefined): boolean {
  switch (action) {
    case 'focusSearch':
      return false; // handled on window so it also works when the tree isn't focused
    case 'closeTab':
      if (row?.kind === 'tab') send({ type: 'close', tabIds: targetsOf(row.tab) });
      else if (row?.kind === 'group') send({ type: 'closeGroup', groupId: row.group.id });
      else return false;
      return true;
    case 'renameGroup':
      if (row?.kind !== 'group') return false;
      startRename(row.group.id);
      return true;
    case 'moveUp':
    case 'moveDown':
      moveByKey(action === 'moveUp' ? -1 : 1);
      return true;
    case 'openMenu':
      openMenuFromKeyboard();
      return true;
    case 'selectAll':
      select(tabIdsBetween(view, 0, view.length - 1));
      return true;
    case 'newTab':
      if (row?.kind === 'tab') {
        send({ type: 'newTab', windowId: row.tab.windowId, afterTabId: row.tab.id });
      } else if (row?.kind === 'group') {
        let lastId: number | null = null;
        for (const t of tabsOfWindow(row.group.windowId))
          if (t.groupId === row.group.id) lastId = t.id;
        send({ type: 'newTab', windowId: row.group.windowId, afterTabId: lastId });
      } else if (row?.kind === 'window') {
        send({ type: 'newTab', windowId: row.info.id, afterTabId: null });
      } else return false;
      return true;
    case 'duplicateTab':
      if (row?.kind !== 'tab') return false;
      for (const id of targetsOf(row.tab)) send({ type: 'duplicate', tabId: id });
      return true;
    case 'togglePin':
      if (row?.kind !== 'tab') return false;
      send({
        type: 'setPinned',
        tabIds: targetsOf(row.tab),
        pinned: !targetTabs(row.tab).every((t) => t.pinned),
      });
      return true;
    case 'toggleMute':
      if (row?.kind !== 'tab') return false;
      send({
        type: 'setMuted',
        tabIds: targetsOf(row.tab),
        muted: !targetTabs(row.tab).every((t) => t.muted),
      });
      return true;
    case 'suspendTab': {
      if (row?.kind !== 'tab') return false;
      const ids = targetTabs(row.tab)
        .filter((t) => !t.active)
        .map((t) => t.id);
      if (ids.length === 0) announcement = 'The active tab can’t be suspended';
      else send({ type: 'discard', tabIds: ids });
      return true;
    }
  }
}

function onkeydown(e: KeyboardEvent): void {
  const row = focusedRow;
  const action = actionFor(shortcuts, e);
  if (action !== null && runAction(action, row)) {
    e.preventDefault();
    return;
  }
  // Fixed navigation keys never carry these modifiers.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      // Up from the first row climbs into the Essentials grid.
      if (e.key === 'ArrowUp' && !e.shiftKey && focusedIndex === 0 && showGrid && grid) {
        grid.focus();
        break;
      }
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
      if (row.kind === 'window') {
        if (row.collapsed) return;
        setWindowCollapsed(row.info.id, true);
      } else if (row.kind === 'group' && !row.group.collapsed) {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: true });
      } else {
        const parentKey =
          row.kind === 'tab' && row.level === groupLevel && row.tab.groupId !== -1
            ? `g${row.tab.groupId}`
            : nested
              ? `w${rowWindowId(row)}`
              : undefined;
        const parent = parentKey === undefined ? undefined : keyIndex.get(parentKey);
        if (parent !== undefined) setFocus(parent);
      }
      break;
    case 'ArrowRight':
      if (searching || !row || row.kind === 'tab') return;
      if (row.kind === 'window' ? row.collapsed : row.group.collapsed) {
        if (row.kind === 'window') setWindowCollapsed(row.info.id, false);
        else send({ type: 'updateGroup', groupId: row.group.id, collapsed: false });
      } else if (
        view[focusedIndex + 1]?.kind !== undefined &&
        view[focusedIndex + 1]?.kind !== 'window'
      ) {
        setFocus(focusedIndex + 1);
      }
      break;
    case 'Enter':
      if (row?.kind === 'tab') {
        select([row.tab.id]);
        anchorId = row.tab.id;
        send({ type: 'activate', tabId: row.tab.id });
      } else if (row?.kind === 'window') {
        setWindowCollapsed(row.info.id, !row.collapsed);
      } else if (row) {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
      }
      break;
    case ' ':
      if (row?.kind === 'tab') toggleSelect(row.tab.id);
      else if (row?.kind === 'window') setWindowCollapsed(row.info.id, !row.collapsed);
      else if (row)
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
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

/** Focuses the search field; false if there is none (hidden in Layout settings). */
export function focusSearch(): boolean {
  if (!searchInput) return false;
  searchInput.focus();
  searchInput.select();
  return true;
}

$effect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (actionFor(shortcuts, e) !== 'focusSearch') return;
    const t = e.target as HTMLElement | null;
    const typing =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    // Typing in some other field must not be hijacked; the search field itself may re-select.
    if (typing && !(t === searchInput && (e.ctrlKey || e.metaKey || e.altKey))) return;
    if (!focusSearch()) return;
    e.preventDefault();
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
    {#if showGrid && tabState.windowId !== null}
      <EssentialsGrid
        bind:this={grid}
        windowId={tabState.windowId}
        items={essentials}
        tabs={homeTabById}
        tints={tintCache}
        {send}
        {shortcuts}
        onmenu={openEssentialMenu}
        onexit={() => {
          setFocus(0);
          tree()?.focus();
        }}
      />
    {/if}
    <div class="list">
      {#if searching && view.length === 0}
        <p class="empty" role="status">No tabs match “{needle}”</p>
      {:else}
        <VirtualList
          bind:this={list}
          items={view}
          {rowHeight}
          key={(r) => r.key}
          role="tree"
          aria-label="Tabs in all windows"
          aria-multiselectable="true"
          tabindex={0}
          aria-activedescendant={focusedRow ? `vc-row-${focusedRow.key}` : undefined}
          {onkeydown}
          onfocus={() => list?.reveal(focusedIndex)}
          onpointerdown={onPointerDown}
          onmousedown={onMouseDown}
        >
          {#snippet row(r, i)}
            {#if r.kind === 'window'}
              <WindowRow
                name={windowLabel(r.number, r.isHome)}
                count={r.count}
                collapsed={r.collapsed}
                incognito={r.info.incognito}
                windowFocused={r.info.focused}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                onclick={() => onWindowClick(i)}
                oncontextmenu={(e) => onContextMenu(e, i)}
              />
            {:else if r.kind === 'group'}
              <GroupRow
                group={r.group}
                count={r.count}
                pos={r.pos}
                size={r.size}
                level={r.level}
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
                grouped={r.level === groupLevel && groupById.has(r.tab.groupId)}
                {nested}
                windowTag={searching && r.tab.windowId !== tabState.windowId
                  ? windowName(r.tab.windowId)
                  : undefined}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                selected={selection.has(r.tab.id)}
                selectedLook={selection.has(r.tab.id) && (selection.size > 1 || !r.tab.active)}
                pinnedEnd={r.pinnedEnd}
                groupColor={r.level === groupLevel && groupById.has(r.tab.groupId)
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
              {#if drop.zone === 'inside' || view[drop.index]?.kind === 'window'}
                <div class="drop-box" style:top="{drop.index * rowHeight}px" style:height="{rowHeight}px"></div>
              {:else}
                <div class="drop-line" style:top="{(drop.index + (drop.zone === 'after' ? 1 : 0)) * rowHeight - 1}px"></div>
              {/if}
            {/if}
          {/snippet}
        </VirtualList>
      {/if}
    </div>
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
    display: flex;
    flex-direction: column;
  }

  .list {
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
