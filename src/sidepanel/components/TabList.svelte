<script lang="ts">
import { browser } from 'wxt/browser';
import { EXTENSION_SCHEME } from '../../shared/browser-urls';
/*
 * Keyboard map (focus stays on the tree; rows are addressed with aria-activedescendant).
 * Fixed navigation keys:
 *   Up / Down          move focus            Home / End      first / last row
 *   Left               collapse group / folder / window, or go to the parent header
 *   Right              expand group / folder / window, or go to its first child
 *   Enter              activate tab, open pinned tab / toggle group, folder or window /
 *                      list another window's Staples (tiles row)
 *   Space              toggle selection of the focused tab (group, folder, window: toggle)
 *   Shift+Up / Down    extend selection
 *   Escape             clear selection, then clear the search
 * Configurable (Settings > Shortcuts; defaults in parentheses), looked up with actionFor():
 *   closeTab (Delete; suspends a pinned tab), renameGroup (F2; also folders and windows),
 *   moveUp / moveDown (Alt+Up / Down; pins and folders move among their siblings), openMenu
 *   (Shift+F10, ContextMenu), selectAll (Ctrl+A), focusSearch (/, Ctrl+F; also works from
 *   outside the tree), newTab, duplicateTab, togglePin, toggleMute, suspendTab (unbound).
 */

import { tick, untrack } from 'svelte';
import { type HoverTarget, PointerDrag } from '../../lib/drag/pointer-drag';
import { tileInsertionIndex } from '../../lib/drag/tile-hit';
import { actionFor, formatCombo } from '../../lib/keymap';
import { matchesFilters, parseQuery } from '../../lib/search/filters';
import { FuzzyIndex } from '../../lib/search/fuzzy-index';
import type { SearchHit, SearchIndex } from '../../lib/search/search-index';
import {
  DEFAULT_SETTINGS,
  type Keymap,
  type MouseAction,
  type MouseSettings,
  type ShortcutAction,
} from '../../settings/schema';
import { flattenItems, type PinItem, type PinNode, type WindowLayout } from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { GroupInfo, TabInfo } from '../../shared/types';
import { buildChildRows } from '../model/child-tabs';
import { type Command, matchCommands, menuCommands } from '../model/commands';
import { canBeEssential, type DragContext, dragName, dragOf } from '../model/drag-source';
import {
  type Drag,
  type DropZone,
  type GridTarget,
  type MultiDropContext,
  planDropMulti,
  planPinDrop,
} from '../model/drop-plan';
import { nodeName, planKeyMove } from '../model/key-move';
import {
  dividerMenu,
  essentialMenu,
  folderMenu,
  groupMenu,
  pinMenu,
  tabMenu,
  tilesMenu,
  windowLabel,
  windowMenu,
} from '../model/menus';
import { pinStep } from '../model/pin-step';
import {
  buildPanelRows,
  buildSearchRows,
  type PinRow as PinRowT,
  type Row,
  reuseRows,
  rowWindowId,
} from '../model/rows';
import { movableTabIds, pruneSelection, tabIdsBetween } from '../model/selection';
import type { TabState } from '../tab-state.svelte';
import { tintCache } from '../tint-cache.svelte';
import CommandList from './CommandList.svelte';
import ContextMenu from './ContextMenu.svelte';
import DividerRow from './DividerRow.svelte';
import EssentialsGrid from './EssentialsGrid.svelte';
import FolderRow from './FolderRow.svelte';
import GroupRow from './GroupRow.svelte';
import Icon from './Icon.svelte';
import type { MenuItem } from './menu-types';
import PinRow from './PinRow.svelte';
import SearchMore from './SearchMore.svelte';
import ShortcutHelp from './ShortcutHelp.svelte';
import TabRow from './TabRow.svelte';
import TidyUp from './TidyUp.svelte';
import TilesRow, { TILES_ROW_INSET } from './TilesRow.svelte';
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
  childTabs?: boolean;
  showClose?: boolean;
  showMute?: boolean;
  shortcuts: Keymap;
  mouse?: MouseSettings;
  /** Dim tabs not opened for this many days; 0 = off. */
  ageDays?: number;
  /** For the window menu's Theme submenu. */
  themes: readonly { id: string; name: string }[];
  /** Never-auto-suspend host patterns, for the tab menu. */
  whitelist: readonly string[];
  onWhitelist: (host: string, add: boolean) => void;
}

let {
  tabState,
  rowHeight,
  search = 'top',
  twoLine = false,
  childTabs = true,
  showClose = true,
  showMute = true,
  shortcuts,
  mouse = DEFAULT_SETTINGS.mouse,
  ageDays = 0,
  themes,
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
// Kept as the same array until a window's group list changes (tab patches leave the
// lists alone), so group lookups in every row don't re-run on each title update.
let groupLists: readonly (readonly GroupInfo[])[] = [];
let groupsFlat: GroupInfo[] = [];
const allGroups = $derived.by(() => {
  const lists = tabState.windows.map((w) => w.groups);
  if (lists.length !== groupLists.length || lists.some((g, i) => g !== groupLists[i])) {
    groupLists = lists;
    groupsFlat = lists.flat();
  }
  return groupsFlat;
});
const tabById = $derived(new Map(allTabs.map((t) => [t.id, t])));
const windowViewById = $derived(new Map(tabState.windows.map((w) => [w.info.id, w])));
const windowNumber = $derived(new Map(tabState.windows.map((w, i) => [w.info.id, i + 1])));
const tabsOfWindow = (id: number): readonly TabInfo[] => windowViewById.get(id)?.tabs ?? [];

// Collapsing another window is remembered by the worker in this window's layout (per panel).
function setWindowCollapsed(otherWindowId: number, collapsed: boolean): void {
  const windowId = tabState.windowId;
  if (windowId === null) return;
  send({ type: 'setWindowCollapsed', windowId, otherWindowId, collapsed });
}

// Other windows' Staples are chunked into fixed-height rows; how many fit depends on
// the list width (36px minimum per tile, 4px gaps).
let listWidth = $state(0);
const tilesPerRow = $derived(Math.max(1, Math.floor((listWidth - TILES_ROW_INSET + 4) / (36 + 4))));

function observeWidth(node: HTMLElement) {
  const ro = new ResizeObserver(([entry]) => {
    if (entry) listWidth = entry.contentRect.width;
  });
  ro.observe(node);
  return { destroy: () => ro.disconnect() };
}

let query = $state('');
// ">" turns the search field into a command palette over this window's menu.
const palette = $derived(query.trimStart().startsWith('>'));
const needle = $derived(palette ? '' : query.trim());
const searching = $derived(needle !== '');
// Pre-effect so the index is fed before the derived search below reads it in the same flush.
// Only while searching: outside search nothing reads the index, and patches arrive often.
$effect.pre(() => {
  if (!searching) return;
  index.replaceAll(allTabs);
  fedTabs = allTabs;
});
// The previous rows, so unchanged ones keep their objects (see reuseRows).
let lastTree: Row[] = [];
let collapsedTabs = $state.raw<ReadonlySet<number>>(new Set());
function setTabCollapsed(id: number, collapsed: boolean): void {
  const next = new Set(collapsedTabs);
  if (collapsed) next.add(id);
  else next.delete(id);
  collapsedTabs = next;
}
const treeRows: Row[] = $derived.by(() => {
  const rows = buildPanelRows(
    tabState.windows.map((w) => ({ ...w, layout: tabState.layoutOf(w.info.id) })),
    tabState.windowId,
    { tilesPerRow },
  );
  lastTree = reuseRows(lastTree, childTabs ? buildChildRows(rows, collapsedTabs) : rows);
  return lastTree;
});
const parsed = $derived(parseQuery(needle));
// Bookmarks/history only for plain text searches; a filter like is:audible is about tabs.
const searchMore = $derived(parsed.text.length >= 2 && parsed.filters.length === 0);
const openUrls = $derived(new Set(allTabs.map((t) => t.url)));
/** Free-text hits, narrowed by any is:/site:/group: filters (filters alone list every match). */
const hits = $derived.by((): SearchHit[] => {
  if (!searching) return [];
  // Read first: the index isn't reactive, so this is what reruns the search on tab changes.
  const tabs = fedTabs;
  const { text, filters } = parsed;
  const base: SearchHit[] = text
    ? index.search(text)
    : tabs.map((t) => ({ id: t.id, score: 0, title: [], url: [] }));
  if (!filters.length) return base;
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const title = (id: number) => groupById.get(id)?.title;
  return base.filter((h) => {
    const t = byId.get(h.id);
    return t !== undefined && matchesFilters(t, filters, title);
  });
});
const view: Row[] = $derived(searching ? buildSearchRows(fedTabs, hits) : treeRows);
const keyIndex = $derived(new Map(view.map((r, i) => [r.key, i])));
/** Row index of each live tab, whether it renders as a tab row or a pinned row. */
const tabRowIndex = $derived.by(() => {
  const m = new Map<number, number>();
  view.forEach((r, i) => {
    if (r.kind === 'tab') m.set(r.tab.id, i);
    else if (r.kind === 'pin' && r.tab) m.set(r.tab.id, i);
  });
  return m;
});
/** Under another window's header (search results are flat). */
const isNested = (r: Row): boolean => !searching && rowWindowId(r) !== tabState.windowId;
/** A tab shown as a child of its group header (only in the tree; search is flat). */
const isGroupedTab = (t: TabInfo): boolean =>
  !searching && !t.pinned && t.groupId !== -1 && groupById.has(t.groupId);
const groupById = $derived(new Map<number, GroupInfo>(allGroups.map((g) => [g.id, g])));
const windowName = (id: number): string =>
  windowLabel(windowNumber.get(id) ?? 0, id === tabState.windowId);
/** The name a window's header shows (layout name or active tab title). */
const windowViewName = (id: number): string => {
  const i = keyIndex.get(`w${id}`);
  const r = i === undefined ? undefined : view[i];
  return r?.kind === 'window' ? r.name : windowName(id);
};
const showUrl = $derived(twoLine || (rowHeight >= 34 && searching));

// The home window's Staples sit above the list as a grid; other windows' render as rows.
const homeLayout = $derived(
  tabState.windowId === null ? undefined : tabState.layoutOf(tabState.windowId),
);
const essentials = $derived(homeLayout?.essentials ?? []);
const layoutOf = (windowId: number): WindowLayout | undefined => tabState.layoutOf(windowId);
const homeTabById = $derived(new Map(tabState.tabs.map((t) => [t.id, t])));
const showGrid = $derived(!searching && essentials.length > 0);
/** A running drag that could become a Staple: an empty grid then shows a drop area. */
let dragWantsGrid = $state(false);
/**
 * The empty grid's drop area lies over the search field instead of taking room in the
 * flow, which would push the list down under the pointer mid-drag. Without a top search
 * field there is nowhere to put it; Staples then start from the menus.
 */
const dropArea = $derived(
  !showGrid && dragWantsGrid && !searching && search === 'top' && homeLayout !== undefined,
);
const gridVisible = $derived(showGrid || dropArea);
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
    const i = id === null || searching ? undefined : tabRowIndex.get(id);
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
  const anchor = anchorId === null ? undefined : tabRowIndex.get(anchorId);
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

// Recomputed when the setting changes or the list updates; a day-scale cutoff doesn't need
// a timer.
const staleBefore = $derived.by(() => {
  void tabState.tabs;
  return ageDays > 0 ? Date.now() - ageDays * 86_400_000 : 0;
});

/** A configurable mouse gesture on a tab row (Settings → Mouse). */
function mouseAction(action: MouseAction, tab: TabInfo): void {
  const tabIds = targetsOf(tab);
  switch (action) {
    case 'close':
      send({ type: 'close', tabIds });
      return;
    case 'suspend':
      send({ type: 'discard', tabIds });
      return;
    case 'duplicate':
      send({ type: 'duplicate', tabId: tab.id });
      return;
    case 'pin':
      send({ type: 'setPinned', tabIds, pinned: !tab.pinned });
      return;
    case 'reload':
      send({ type: 'reload', tabIds });
      return;
    case 'mute':
      send({ type: 'setMuted', tabIds, muted: !tab.muted });
      return;
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

function onWindowClick(e: MouseEvent, i: number): void {
  const row = view[i];
  if (row?.kind !== 'window') return;
  setFocus(i, false);
  tree()?.focus();
  if (e.detail > 1) return;
  preToggle = row.collapsed;
  setWindowCollapsed(row.info.id, !row.collapsed);
}

function onFolderClick(e: MouseEvent, i: number): void {
  const row = view[i];
  if (row?.kind !== 'folder') return;
  setFocus(i, false);
  tree()?.focus();
  if (e.detail > 1) return;
  preToggle = row.folder.collapsed;
  setFolderCollapsed(row.windowId, row.folder.id, !row.folder.collapsed);
}

function setFolderCollapsed(windowId: number, folderId: string, collapsed: boolean): void {
  send({ type: 'folderUpdate', windowId, folderId, collapsed });
}

function onPinClick(e: MouseEvent, i: number): void {
  const row = view[i];
  if (row?.kind !== 'pin') return;
  setFocus(i, false);
  tree()?.focus();
  const tab = row.tab;
  // Pinned tabs join range / Ctrl selections like tab rows; a plain click opens.
  if (tab && e.shiftKey) selectRangeTo(i);
  else if (tab && (e.ctrlKey || e.metaKey)) toggleSelect(tab.id);
  else openPin(row.windowId, row.item.id, tab);
}

function openPin(windowId: number, itemId: string, tab: TabInfo | null): void {
  if (tab) {
    select([tab.id]);
    anchorId = tab.id;
  } else select([]);
  send({ type: 'pinOpen', windowId, itemId });
}

// The second click of a double-click is the start of a rename. Undo the first click's
// toggle: always send (not "only if it differs"), because the update for that toggle
// hasn't arrived yet, so local state can't tell whether it already happened.
function onHeaderDblclick(i: number): void {
  const row = view[i];
  if (row?.kind === 'group') {
    send({ type: 'updateGroup', groupId: row.group.id, collapsed: preToggle });
  } else if (row?.kind === 'folder') {
    setFolderCollapsed(row.windowId, row.folder.id, preToggle);
  } else if (row?.kind === 'window') {
    setWindowCollapsed(row.info.id, preToggle);
  } else return;
  startRename(row.key);
}

/** What an action on `tab` applies to: the selection if it contains the tab, else the tab. */
function targetTabs(tab: TabInfo): TabInfo[] {
  return selection.has(tab.id) ? allTabs.filter((t) => selection.has(t.id)) : [tab];
}

const targetsOf = (tab: TabInfo): number[] => targetTabs(tab).map((t) => t.id);

/** Tabs backing a layout item in any window (rebuilt when a layout changes). */
const layoutTabIds = $derived.by(() => {
  const ids = new Set<number>();
  for (const l of tabState.layouts.values())
    for (const item of flattenItems(l)) if (item.tabId !== null) ids.add(item.tabId);
  return ids;
});

/** What a drag or keyboard move of `tab` carries: its targets minus pinned / layout tabs. */
const movableTargets = (tab: TabInfo): number[] =>
  movableTabIds(targetsOf(tab), tabById, layoutTabIds);

// --- Rename ----------------------------------------------------------------------------

/** Key of the group, folder or window header whose name field is open. */
let renamingKey = $state<string | null>(null);
let pendingGroup: { tabIds: number[]; known: Set<number>; until: number } | null = null;
let pendingFolder: { windowId: number; known: Set<string>; until: number } | null = null;

function startRename(key: string): void {
  const i = keyIndex.get(key);
  if (i === undefined) return;
  setFocus(i);
  renamingKey = key;
}

function onRenamed(groupId: number, title: string | null): void {
  renamingKey = null;
  const g = groupById.get(groupId);
  if (title !== null && g && title !== g.title) send({ type: 'updateGroup', groupId, title });
  tree()?.focus();
}

function onFolderRenamed(windowId: number, folderId: string, name: string | null): void {
  renamingKey = null;
  const current = view.find((r) => r.kind === 'folder' && r.folder.id === folderId);
  // A folder needs a name; clearing the field keeps the old one.
  if (name && current?.kind === 'folder' && name !== current.folder.name) {
    send({ type: 'folderUpdate', windowId, folderId, name });
  }
  tree()?.focus();
}

function onWindowRenamed(windowId: number, shown: string, name: string | null): void {
  renamingKey = null;
  // Empty goes back to the default (the active tab's title).
  if (name === '') send({ type: 'renameWindow', windowId, name: null });
  else if (name !== null && name !== shown) send({ type: 'renameWindow', windowId, name });
  tree()?.focus();
}

const folderIdsOf = (nodes: readonly PinNode[], out = new Set<string>()): Set<string> => {
  for (const n of nodes) {
    if (n.kind === 'folder') {
      out.add(n.id);
      folderIdsOf(n.children, out);
    }
  }
  return out;
};

/** "New folder": the id is minted by the worker, so watch for a folder that wasn't there. */
function expectFolder(windowId: number): void {
  pendingFolder = {
    windowId,
    known: folderIdsOf(layoutOf(windowId)?.pinned ?? []),
    until: Date.now() + 4000,
  };
}

$effect(() => {
  void view;
  const p = pendingFolder;
  if (!p) return;
  if (Date.now() > p.until) {
    pendingFolder = null;
    return;
  }
  const fresh = [...folderIdsOf(layoutOf(p.windowId)?.pinned ?? [])].find((id) => !p.known.has(id));
  if (fresh === undefined || !keyIndex.has(`f${fresh}`)) return;
  pendingFolder = null;
  untrack(() => startRename(`f${fresh}`));
});

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
    untrack(() => startRename(`g${first.groupId}`));
  }
});

// --- Context menu ----------------------------------------------------------------------

let menu = $state.raw<{
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  /** Opened on a Staples tile: focus goes back to the grid, not the tree. */
  fromGrid?: boolean;
} | null>(null);

function essentialItems(windowId: number, item: PinItem): MenuItem[] {
  return essentialMenu({
    item,
    tab: item.tabId === null ? null : (tabById.get(item.tabId) ?? null),
    windowId,
    pinnedCount: layoutOf(windowId)?.pinned.length ?? 0,
    send,
  });
}

function openEssentialMenu(x: number, y: number, item: PinItem): void {
  const windowId = tabState.windowId;
  if (windowId === null) return;
  menu = {
    x,
    y,
    label: 'Staple actions',
    fromGrid: true,
    items: essentialItems(windowId, item),
  };
}

/** Right-click on a tile in another window's row, or on the row (`item` null: list them). */
function openTilesMenu(i: number, x: number, y: number, item: PinItem | null): void {
  const row = view[i];
  if (row?.kind !== 'tiles') return;
  setFocus(i, false);
  menu = item
    ? { x, y, label: 'Staple actions', items: essentialItems(row.windowId, item) }
    : {
        x,
        y,
        label: 'Staples',
        items: tilesMenu({ windowId: row.windowId, tiles: row.tiles, send }),
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
        onRename: () => startRename(row.key),
        layout: tabState.layouts.get(row.info.id),
        themes,
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
        onRename: () => startRename(row.key),
      }),
    };
    return;
  }
  if (row.kind === 'pin') {
    menu = {
      x,
      y,
      label: 'Pinned tab actions',
      items: pinMenu({
        item: row.item,
        tab: row.tab,
        tabs: row.tab ? targetTabs(row.tab) : [],
        windowId: row.windowId,
        parentId: row.parentId,
        index: row.index,
        depth: row.depth,
        essentialsCount: layoutOf(row.windowId)?.essentials.length ?? 0,
        send,
        onNewFolder: () => expectFolder(row.windowId),
      }),
    };
    return;
  }
  if (row.kind === 'folder') {
    menu = {
      x,
      y,
      label: 'Folder actions',
      items: folderMenu({
        folder: row.folder,
        depth: row.depth,
        windowId: row.windowId,
        send,
        onRename: () => startRename(row.key),
        onNewFolder: () => expectFolder(row.windowId),
      }),
    };
    return;
  }
  if (row.kind === 'divider') {
    menu = {
      x,
      y,
      label: 'Pinned tabs',
      items: dividerMenu({
        windowId: row.windowId,
        pinnedCount: layoutOf(row.windowId)?.pinned.length ?? 0,
        clearable: row.clearable,
        showClear: row.windowId === tabState.windowId,
        send,
        onNewFolder: () => expectFolder(row.windowId),
      }),
    };
    return;
  }
  if (row.kind === 'tiles') {
    openTilesMenu(i, x, y, null);
    return;
  }
  menu = { x, y, label: 'Tab actions', items: tabMenuFor(row.tab) };
}

/** The tab context menu for a tab (also the palette's "Tab:" commands). */
function tabMenuFor(tab: TabInfo): MenuItem[] {
  const winId = tab.windowId;
  return tabMenu({
    target: tab,
    tabs: targetTabs(tab),
    essentialsCount: layoutOf(winId)?.essentials.length ?? 0,
    pinned: layoutOf(winId)?.pinned ?? [],
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
  });
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

const multiCtx: MultiDropContext = {
  ctxFor: (id) => {
    const w = windowViewById.get(id);
    return w ? { windowId: id, tabs: w.tabs } : null;
  },
  tab: (id) => tabById.get(id),
  isIncognito: (id) => windowViewById.get(id)?.info.incognito ?? false,
  layoutOf: (id) => tabState.layoutOf(id),
};

function planFor(drag: Drag, index: number, zone: DropZone): PanelMessage | null {
  return planDropMulti(multiCtx, view, drag, index, zone);
}

/** Keyboard move of a pin, folder or tile (`across`: a tile, announced as before / after). */
function moveNodeByKey(windowId: number, nodeId: string, dir: -1 | 1, across = false): void {
  const l = layoutOf(windowId);
  const step = l && pinStep(l, nodeId, dir);
  if (!l || !step) return;
  const what = nodeName(l, nodeId, tabById);
  if ('edge' in step) {
    announcement = `${what} is already ${dir < 0 ? 'first' : 'last'}`;
    return;
  }
  send({ type: 'pinMove', windowId, nodeId, toWindowId: windowId, dest: step.dest });
  const ref = nodeName(l, step.ref, tabById);
  const how =
    across && step.how !== 'into' && step.how !== 'out of'
      ? dir < 0
        ? 'before'
        : 'after'
      : step.how;
  announcement = `Moved ${what} ${how} ${ref}`;
}

function moveByKey(dir: -1 | 1): void {
  if (searching) return;
  const row = focusedRow;
  if (row?.kind === 'pin' || row?.kind === 'folder') {
    moveNodeByKey(row.windowId, row.kind === 'pin' ? row.item.id : row.folder.id, dir);
    return;
  }
  if (row?.kind !== 'tab' && row?.kind !== 'group') return;
  const move = planKeyMove({ view, movableTargets, isGroupedTab, planFor }, row, dir);
  if (move.plan) send(move.plan);
  announcement = move.announcement;
}

// --- Pointer drag and drop -------------------------------------------------------------

let ghost: HTMLDivElement | undefined = $state();
let dragLabel = $state<string | null>(null);
let drop = $state.raw<(HoverTarget & { ok: boolean }) | null>(null);
/** Insertion index shown in the home grid while an allowed drop is aimed at it. */
let gridDrop = $state<number | null>(null);
/** Bar between two mini tiles of another window's row, in list content coordinates. */
let tilesBar = $state.raw<{ top: number; left: number; height: number } | null>(null);
let dragPayload: Drag | null = null;
// The ghost mounts a frame after the drag starts, so remember where the pointer is.
let pointer = { x: 0, y: 0 };
// Plain: the list row under the pointer, and the grid / tile slot that overrides it.
let listHover: HoverTarget | null = null;
let gridTarget: GridTarget | null = null;
let dropKey = '';

const dragCtx: DragContext = {
  get view() {
    return view;
  },
  get searching() {
    return searching;
  },
  get selection() {
    return selection;
  },
  get tabById() {
    return tabById;
  },
  get groupById() {
    return groupById;
  },
  get layoutTabIds() {
    return layoutTabIds;
  },
  get windowIds() {
    return tabState.windows.map((w) => w.info.id);
  },
  get homeId() {
    return tabState.windowId;
  },
  layoutOf,
  isIncognito: (id) => multiCtx.isIncognito(id),
  movableTargets,
};

const placeGhost = (node: HTMLElement): void => {
  node.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
};

/** The slot between mini tiles of another window's row under the pointer. */
function tilesSlot(
  i: number,
  x: number,
  y: number,
): { target: GridTarget; bar: { top: number; left: number; height: number } } | null {
  const row = view[i];
  const el = document.getElementById(`vc-row-${row?.key}`);
  const spacer = list?.scroller()?.firstElementChild;
  const l = row?.kind === 'tiles' ? layoutOf(row.windowId) : undefined;
  if (row?.kind !== 'tiles' || !el || !spacer || !l) return null;
  const tiles = [...el.querySelectorAll<HTMLElement>('.tile')].map((t) =>
    t.getBoundingClientRect(),
  );
  const at = tileInsertionIndex(tiles, x, y);
  const start = l.essentials.findIndex((e) => e.id === row.tiles[0]?.item.id);
  if (start < 0) return null;
  const origin = spacer.getBoundingClientRect();
  const ref = tiles[at] ?? tiles[at - 1];
  if (!ref) return null;
  const left = (tiles[at] ? ref.left - 3 : ref.right + 1) - origin.left;
  return {
    target: { kind: 'grid', windowId: row.windowId, index: start + at },
    bar: { top: ref.top - origin.top, left, height: ref.height },
  };
}

/**
 * Recomputes the drop target after the pointer or the hovered row changed: the home grid
 * first, then a slot between another window's mini tiles, then the list row. Plans are
 * only re-run when the target changes.
 */
function refreshDrop(): void {
  const payload = dragPayload;
  if (!payload) return;
  const home = tabState.windowId;
  const gi = grid && home !== null ? grid.targetAt(pointer.x, pointer.y) : null;
  let target: GridTarget | null =
    gi !== null && home !== null ? { kind: 'grid', windowId: home, index: gi } : null;
  let bar: { top: number; left: number; height: number } | null = null;
  if (!target && listHover && view[listHover.index]?.kind === 'tiles') {
    const slot = tilesSlot(listHover.index, pointer.x, pointer.y);
    if (slot) ({ target, bar } = slot);
  }
  const key = target
    ? `g${target.windowId}:${target.index}`
    : listHover
      ? `r${listHover.index}:${listHover.zone}`
      : '';
  if (key === dropKey) return;
  dropKey = key;
  gridTarget = target;
  if (target) {
    const ok = planPinDrop(multiCtx, view, payload, target) !== null;
    gridDrop = ok && gi !== null ? gi : null;
    tilesBar = ok ? bar : null;
    drop = null;
    return;
  }
  gridDrop = null;
  tilesBar = null;
  drop = listHover
    ? { ...listHover, ok: planFor(payload, listHover.index, listHover.zone) !== null }
    : null;
}

const dnd = new PointerDrag<Drag>({
  scroller: () => list?.scroller(),
  rowHeight: () => rowHeight,
  rowCount: () => view.length,
  isGroup: (i) => {
    const k = view[i]?.kind;
    const r = view[i];
    return (
      k === 'group' ||
      k === 'window' ||
      k === 'folder' ||
      (childTabs &&
        dragPayload?.kind === 'tabs' &&
        dragPayload.tabIds.length === 1 &&
        r?.kind === 'tab' &&
        !r.tab.pinned &&
        !r.tab.url.startsWith(EXTENSION_SCHEME))
    );
  },
  begin: (i, e) => dragOf(dragCtx, i, e.target as Element),
  elsewhere: (x, y) => (grid?.targetAt(x, y) ?? null) !== null,
  onStart: (payload) => {
    dragPayload = payload;
    dragLabel = dragName(dragCtx, payload);
    dragWantsGrid = canBeEssential(dragCtx, payload);
    menu = null;
  },
  onHover: (t) => {
    listHover = t;
    refreshDrop();
  },
  onMove: (x, y) => {
    pointer = { x, y };
    if (ghost) ghost.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
    refreshDrop();
  },
  onDrop: (payload, t) => {
    const plan = gridTarget
      ? planPinDrop(multiCtx, view, payload, gridTarget)
      : t
        ? planFor(payload, t.index, t.zone)
        : null;
    if (plan) send(plan);
  },
  onEnd: () => {
    dragLabel = null;
    drop = null;
    gridDrop = null;
    tilesBar = null;
    dragPayload = null;
    dragWantsGrid = false;
    listHover = null;
    gridTarget = null;
    dropKey = '';
  },
});

// The grid above the list can appear (empty drop area) or change height mid-drag, which
// moves the list: hit-testing must use its new position.
$effect(() => {
  void gridVisible;
  void essentials.length;
  untrack(() => dnd.remeasure());
});

// The list can change under a pointer that isn't moving (a tab opens, a move settles):
// the hovered index now names another row, so the target is planned again instead of
// leaving an indicator (or a mini-tile bar) that no longer matches what a drop would do.
$effect(() => {
  void view;
  untrack(() => {
    if (!dragPayload) return;
    if (listHover && listHover.index >= view.length) listHover = null;
    dropKey = '';
    refreshDrop();
  });
});

$effect(() => () => dnd.dispose());

function onPointerDown(e: PointerEvent): void {
  if ((e.target as Element).closest('[role=treeitem]')) dnd.press(e);
}

// Keeps focus on the tree instead of letting a click land on a row, and stops the
// middle-click autoscroll cursor; the rename input needs the default behaviour.
function onMouseDown(e: MouseEvent): void {
  if ((e.target as Element).closest('input, .new-page')) return;
  e.preventDefault();
  // A mouse focus must not reveal the old focused row: that scrolls the list between
  // mousedown and click, so the click lands on a different row.
  mouseFocus = true;
  tree()?.focus();
  mouseFocus = false;
}
let mouseFocus = false;

// --- Keyboard --------------------------------------------------------------------------

/** Runs a configurable shortcut; false means it doesn't apply to the focused row. */
function runAction(action: ShortcutAction, row: Row | undefined): boolean {
  switch (action) {
    case 'focusSearch':
    case 'commandPalette':
      return false; // handled on window so it also works when the tree isn't focused
    case 'closeTab':
      if (row?.kind === 'tab') send({ type: 'close', tabIds: targetsOf(row.tab) });
      else if (row?.kind === 'group') send({ type: 'closeGroup', groupId: row.group.id });
      // Closing a pinned tab only suspends it; the row stays.
      else if (row?.kind === 'pin' && row.tab)
        send({ type: 'pinClose', windowId: row.windowId, itemIds: [row.item.id] });
      else return false;
      return true;
    case 'renameGroup':
      if (row?.kind !== 'group' && row?.kind !== 'folder' && row?.kind !== 'window') return false;
      startRename(row.key);
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
      if (row?.kind === 'pin') {
        send({ type: 'pinRemove', windowId: row.windowId, itemId: row.item.id, mode: 'unpin' });
        return true;
      }
      if (row?.kind !== 'tab') return false;
      send({
        type: 'setPinned',
        tabIds: targetsOf(row.tab),
        pinned: !targetTabs(row.tab).every((t) => t.pinned),
      });
      return true;
    case 'toggleMute':
      if (row?.kind === 'pin') {
        if (!row.tab) return false;
        send({ type: 'setMuted', tabIds: [row.tab.id], muted: !row.tab.muted });
        return true;
      }
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
        .filter((t) => !t.discarded)
        .map((t) => t.id);
      if (ids.length === 0) announcement = 'Selected tabs are already suspended';
      else send({ type: 'discard', tabIds: ids });
      return true;
    }
  }
}

/**
 * The header a row sits under: its group, its folder (nearest folder row above at one
 * depth less), or its window header. Undefined for top-level rows of the home window.
 */
function parentIndex(i: number): number | undefined {
  const row = view[i];
  if (!row || searching) return undefined;
  if (row.kind === 'tab' && row.parentTabId !== undefined)
    return keyIndex.get(`t${row.parentTabId}`);
  if (row.kind === 'tab' && isGroupedTab(row.tab)) return keyIndex.get(`g${row.tab.groupId}`);
  if ((row.kind === 'pin' || row.kind === 'folder') && row.depth > 1) {
    for (let k = i - 1; k >= 0; k--) {
      const r = view[k];
      if (r?.kind === 'folder' && r.windowId === row.windowId && r.depth === row.depth - 1)
        return k;
    }
  }
  return isNested(row) ? keyIndex.get(`w${rowWindowId(row)}`) : undefined;
}

function onkeydown(e: KeyboardEvent): void {
  if ((e.target as Element).closest('.new-page')) return;
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
      // Up from the first row climbs into the Staples grid.
      if (e.key === 'ArrowUp' && !e.shiftKey && focusedIndex === 0 && showGrid && grid) {
        grid.focus();
        break;
      }
      // Down from the last search result moves on to the bookmark/history results.
      if (e.key === 'ArrowDown' && !e.shiftKey && searching && focusedIndex === view.length - 1) {
        const more = document.querySelector<HTMLElement>('.search-more button');
        if (more) {
          more.focus();
          break;
        }
      }
      const next = Math.max(
        0,
        Math.min(view.length - 1, focusedIndex + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      if (e.shiftKey) {
        if (anchorId === null && row?.kind === 'tab') anchorId = row.tab.id;
        else if (anchorId === null && row?.kind === 'pin' && row.tab) anchorId = row.tab.id;
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
      if (row.kind === 'tab' && row.hasChildren && !row.collapsed)
        setTabCollapsed(row.tab.id, true);
      else if (row.kind === 'window' && !row.collapsed) setWindowCollapsed(row.info.id, true);
      else if (row.kind === 'group' && !row.group.collapsed) {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: true });
      } else if (row.kind === 'folder' && !row.folder.collapsed) {
        setFolderCollapsed(row.windowId, row.folder.id, true);
      } else if (row.kind !== 'window') {
        const parent = parentIndex(focusedIndex);
        if (parent !== undefined) setFocus(parent);
      }
      break;
    case 'ArrowRight': {
      if (searching || !row) return;
      const collapsed =
        row.kind === 'window'
          ? row.collapsed
          : row.kind === 'group'
            ? row.group.collapsed
            : row.kind === 'folder'
              ? row.folder.collapsed
              : row.kind === 'tab' && row.hasChildren
                ? row.collapsed
                : null;
      if (collapsed === null) return;
      if (collapsed) {
        if (row.kind === 'window') setWindowCollapsed(row.info.id, false);
        else if (row.kind === 'group')
          send({ type: 'updateGroup', groupId: row.group.id, collapsed: false });
        else if (row.kind === 'folder') setFolderCollapsed(row.windowId, row.folder.id, false);
        else if (row.kind === 'tab') setTabCollapsed(row.tab.id, false);
      } else if (parentIndex(focusedIndex + 1) === focusedIndex) {
        setFocus(focusedIndex + 1);
      }
      break;
    }
    case 'Enter':
    case ' ':
      if (!row) break;
      if (row.kind === 'tab') {
        if (e.key === ' ') toggleSelect(row.tab.id);
        else {
          select([row.tab.id]);
          anchorId = row.tab.id;
          send({ type: 'activate', tabId: row.tab.id });
        }
      } else if (row.kind === 'pin') {
        if (e.key === ' ' && row.tab) toggleSelect(row.tab.id);
        else if (e.key === 'Enter') openPin(row.windowId, row.item.id, row.tab);
      } else if (row.kind === 'window') setWindowCollapsed(row.info.id, !row.collapsed);
      else if (row.kind === 'group') {
        send({ type: 'updateGroup', groupId: row.group.id, collapsed: !row.group.collapsed });
      } else if (row.kind === 'folder') {
        setFolderCollapsed(row.windowId, row.folder.id, !row.folder.collapsed);
      } else if (row.kind === 'tiles') openMenuFromKeyboard();
      // The divider does nothing on Enter: Clear closes tabs, so it takes the button or menu.
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

/** Tab menu entries that the shortcut actions run, for the palette's key hints. */
const TAB_COMMAND_KEYS: Record<string, ShortcutAction> = {
  'New tab below': 'newTab',
  Close: 'closeTab',
  Duplicate: 'duplicateTab',
  Pin: 'togglePin',
  Unpin: 'togglePin',
  Mute: 'toggleMute',
  Unmute: 'toggleMute',
  Suspend: 'suspendTab',
};

/** Palette commands: the active tab's menu, then this window's, as on their rows. */
const commands = $derived.by((): Command[] => {
  if (!palette) return [];
  const id = tabState.windowId;
  const w = id === null ? undefined : windowViewById.get(id);
  if (!w) return [];
  const active = w.tabs.find((t) => t.active);
  return [
    ...(active ? menuCommands(tabMenuFor(active), 'Tab') : []).map((c) => {
      const combo = shortcuts[TAB_COMMAND_KEYS[c.label] as ShortcutAction]?.[0];
      return combo ? { ...c, keys: formatCombo(combo) } : c;
    }),
    ...menuCommands(
      windowMenu({
        info: w.info,
        tabs: w.tabs,
        send,
        onRename: () => void tick().then(() => startRename(`w${w.info.id}`)),
        layout: tabState.layouts.get(w.info.id),
        themes,
      }),
      'Window',
    ),
    {
      label: 'Tidy up tabs…',
      group: 'Panel',
      danger: false,
      run: () => {
        tidyOpen = true;
      },
    },
    {
      label: 'Back up now',
      group: 'Backup',
      danger: false,
      run: () => {
        void browser.runtime
          .sendMessage({ type: 'runBackup' })
          .then((s?: { error?: string; skipped?: boolean }) =>
            tabState.onNotice?.(
              s?.error
                ? { level: 'error', text: `Backup failed: ${s.error}` }
                : {
                    level: 'info',
                    text: s?.skipped ? 'Nothing changed since the last backup' : 'Backup saved',
                  },
            ),
          );
      },
    },
  ];
});
const paletteHits = $derived(matchCommands(commands, query.trimStart().slice(1)));

function runCommand(c: Command): void {
  query = '';
  c.run();
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (palette && (e.key === 'Enter' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const first = paletteHits[0];
    if (e.key === 'Enter') {
      if (first) runCommand(first);
    } else document.querySelector<HTMLElement>('.commands button')?.focus();
    return;
  }
  if (e.key === 'ArrowDown') {
    if (view.length === 0) {
      const more = document.querySelector<HTMLElement>('.search-more button');
      if (more) {
        e.preventDefault();
        more.focus();
      }
      return;
    }
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

let helpOpen = $state(false);
let tidyOpen = $state(false);
const tidyTabs = $derived.by(() => {
  const id = tabState.windowId;
  return (id === null ? undefined : windowViewById.get(id)?.tabs) ?? [];
});

// Alt+1 to Alt+9 jump to that tab of this window, in the order the list shows them.
$effect(() => {
  const onJump = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
    if (!n) return;
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable)
      return;
    const id = tabState.windowId;
    const target = id === null ? undefined : windowViewById.get(id)?.tabs[n - 1];
    if (!target) return;
    e.preventDefault();
    send({ type: 'activate', tabId: target.id });
  };
  window.addEventListener('keydown', onJump);
  return () => window.removeEventListener('keydown', onJump);
});
// "?" (outside text fields) shows what the keyboard can do.
$effect(() => {
  const onHelp = (e: KeyboardEvent) => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable)
      return;
    e.preventDefault();
    helpOpen = true;
  };
  window.addEventListener('keydown', onHelp);
  return () => window.removeEventListener('keydown', onHelp);
});

$effect(() => {
  const onKey = (e: KeyboardEvent) => {
    const action = actionFor(shortcuts, e);
    if (action !== 'focusSearch' && action !== 'commandPalette') return;
    const t = e.target as HTMLElement | null;
    const typing =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable;
    // Typing in some other field must not be hijacked; the search field itself may re-select.
    if (typing && !(t === searchInput && (e.ctrlKey || e.metaKey || e.altKey))) return;
    if (action === 'commandPalette' && search !== 'hidden') query = '>';
    if (!focusSearch()) return;
    e.preventDefault();
    // Caret after the ">" so typing filters commands instead of replacing it.
    if (action === 'commandPalette') searchInput?.setSelectionRange(1, 1);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
});
</script>

{#if tidyOpen}
  <TidyUp tabs={tidyTabs} {send} onclose={() => (tidyOpen = false)} />
{/if}

{#if helpOpen}
  <ShortcutHelp {shortcuts} onclose={() => (helpOpen = false)} />
{/if}

{#snippet searchField()}
  <div class="search" class:bottom={search === 'bottom'}>
    <span class="lead"><Icon name="search" size={14} /></span>
    <input
      bind:this={searchInput}
      bind:value={query}
      type="text"
      role="searchbox"
      placeholder="Search or > commands"
      title="Filters: is:audible, is:muted, is:suspended, is:pinned, is:grouped, site:example.com, group:name. Put - in front to exclude."
      aria-label="Search tabs"
      aria-describedby={searching && view.length === 0 ? 'vc-filter-hint' : undefined}
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

{#snippet essentialsGrid(homeId: number)}
  <EssentialsGrid
    bind:this={grid}
    windowId={homeId}
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
    onpress={(e, item) => {
      if (!searching) dnd.pressWith(e, { kind: 'node', windowId: homeId, nodeId: item.id });
    }}
    onmove={(item, dir) => moveNodeByKey(homeId, item.id, dir, true)}
    dropIndex={gridDrop}
    dropping={dragWantsGrid}
  />
{/snippet}

<div class="wrap">
  {#if search === 'top'}{@render searchField()}{/if}
  {#if dropArea && tabState.windowId !== null}
    <div class="drop-area">{@render essentialsGrid(tabState.windowId)}</div>
  {/if}

  <div class="body">
    {#if showGrid && tabState.windowId !== null}{@render essentialsGrid(tabState.windowId)}{/if}
    <div class="list" use:observeWidth>
      {#if palette}
        <CommandList commands={paletteHits} onrun={runCommand} />
      {:else if searching && view.length === 0}
        <p class="empty" role="status">No tabs match “{needle}”</p>
        <p class="filters-hint" id="vc-filter-hint">
          Narrow with <code>is:audible</code> <code>is:muted</code> <code>is:suspended</code>
          <code>is:pinned</code> <code>is:grouped</code> <code>site:example.com</code>
          <code>group:name</code>. Put <code>-</code> in front to exclude.
        </p>
        {#if searchMore}
          <SearchMore text={parsed.text} windowId={tabState.windowId} {openUrls} onwake={(id) => send({ type: 'wakeSnoozed', id })} />
        {/if}
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
          onfocus={() => { if (!mouseFocus) list?.reveal(focusedIndex); }}
          onpointerdown={onPointerDown}
          onmousedown={onMouseDown}
        >
          {#snippet row(r, i)}
            {#if r.kind === 'window'}
              <WindowRow
                windowId={r.info.id}
                name={r.name}
                icon={r.icon}
                count={r.count}
                collapsed={r.collapsed}
                incognito={r.info.incognito}
                windowFocused={r.info.focused}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                renaming={renamingKey === r.key}
                onclick={(e) => onWindowClick(e, i)}
                ondblclick={() => onHeaderDblclick(i)}
                oncontextmenu={(e) => onContextMenu(e, i)}
                onrenamed={(name) => onWindowRenamed(r.info.id, r.name, name)}
              />
            {:else if r.kind === 'group'}
              <GroupRow
                group={r.group}
                count={r.count}
                pos={r.pos}
                size={r.size}
                level={r.level}
                focused={i === focusedIndex}
                renaming={renamingKey === r.key}
                onclick={(e) => onGroupClick(e, i)}
                ondblclick={() => onHeaderDblclick(i)}
                oncontextmenu={(e) => onContextMenu(e, i)}
                onrenamed={(title) => onRenamed(r.group.id, title)}
              />
            {:else if r.kind === 'pin'}
              <PinRow
                rowKey={r.key}
                item={r.item}
                tab={r.tab}
                depth={r.depth}
                nested={isNested(r)}
                level={r.level}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                selected={r.tab !== null && selection.has(r.tab.id)}
                selectedLook={r.tab !== null &&
                  selection.has(r.tab.id) &&
                  (selection.size > 1 || !r.tab.active)}
                {showClose}
                {showMute}
                onclick={(e) => onPinClick(e, i)}
                oncontextmenu={(e) => onContextMenu(e, i)}
                onclose={() => send({ type: 'pinClose', windowId: r.windowId, itemIds: [r.item.id] })}
                onhome={() => send({ type: 'pinHome', windowId: r.windowId, itemId: r.item.id })}
                onmute={() => {
                  if (r.tab) send({ type: 'setMuted', tabIds: [r.tab.id], muted: !r.tab.muted });
                }}
              />
            {:else if r.kind === 'folder'}
              <FolderRow
                folder={r.folder}
                count={r.count}
                depth={r.depth}
                nested={isNested(r)}
                level={r.level}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                renaming={renamingKey === r.key}
                onclick={(e) => onFolderClick(e, i)}
                ondblclick={() => onHeaderDblclick(i)}
                oncontextmenu={(e) => onContextMenu(e, i)}
                onrenamed={(name) => onFolderRenamed(r.windowId, r.folder.id, name)}
              />
            {:else if r.kind === 'divider'}
              <DividerRow
                rowKey={r.key}
                clearable={r.clearable}
                showClear={r.windowId === tabState.windowId}
                level={r.level}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                onclear={() => send({ type: 'clearTabs', windowId: r.windowId })}
                oncontextmenu={(e) => onContextMenu(e, i)}
              />
            {:else if r.kind === 'tiles'}
              <TilesRow
                rowKey={r.key}
                tiles={r.tiles}
                tints={tintCache}
                windowName={windowViewName(r.windowId)}
                level={r.level}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                onopen={(item) => {
                  setFocus(i, false);
                  tree()?.focus();
                  send({ type: 'pinOpen', windowId: r.windowId, itemId: item.id });
                }}
                onclose={(item) => send({ type: 'pinClose', windowId: r.windowId, itemIds: [item.id] })}
                oncontextmenu={(e, item) => {
                  e.preventDefault();
                  openTilesMenu(i, e.clientX, e.clientY, item);
                }}
              />
            {:else}
              {@const grouped = isGroupedTab(r.tab)}
              <TabRow
                tab={r.tab}
                level={r.level}
                {grouped}
                childDepth={r.childDepth}
                hasChildren={r.hasChildren}
                collapsed={r.collapsed}
                ontoggle={() => {
                  setFocus(i, false);
                  tree()?.focus();
                  setTabCollapsed(r.tab.id, !r.collapsed);
                }}
                nested={isNested(r)}
                windowTag={searching && r.tab.windowId !== tabState.windowId
                  ? windowName(r.tab.windowId)
                  : undefined}
                pos={r.pos}
                size={r.size}
                focused={i === focusedIndex}
                selected={selection.has(r.tab.id)}
                selectedLook={selection.has(r.tab.id) && (selection.size > 1 || !r.tab.active)}
                pinnedEnd={r.pinnedEnd}
                groupColor={grouped ? `var(--g-${groupById.get(r.tab.groupId)?.color})` : undefined}
                highlight={r.highlight}
                {showUrl}
                {showClose}
                {showMute}
                onclick={(e) => onTabClick(e, i, r.tab)}
                oncontextmenu={(e) => onContextMenu(e, i)}
                onclose={() => send({ type: 'close', tabIds: targetsOf(r.tab) })}
                onmute={() => send({ type: 'setMuted', tabIds: targetsOf(r.tab), muted: !r.tab.muted })}
                stale={staleBefore > 0 && (r.tab.lastAccessed ?? Infinity) < staleBefore}
                onmiddle={() => mouseAction(mouse.middle, r.tab)}
                ondouble={mouse.double === 'none' ? undefined : () => mouseAction(mouse.double, r.tab)}
              />
            {/if}
          {/snippet}
          {#snippet footer()}
            {#if searching && searchMore}
              <SearchMore text={parsed.text} windowId={tabState.windowId} {openUrls} onwake={(id) => send({ type: 'wakeSnoozed', id })} />
            {/if}
            {#if !searching && tabState.windowId !== null}
              <button type="button" class="new-page" onclick={() => {
                if (tabState.windowId !== null) send({ type: 'newTab', windowId: tabState.windowId, afterTabId: null });
              }}>
                <Icon name="plus" size={14} />
                New page
              </button>
            {/if}
          {/snippet}
          {#snippet overlay()}
            {#if tilesBar}
              <div class="tiles-bar" style:top="{tilesBar.top}px" style:left="{tilesBar.left}px" style:height="{tilesBar.height}px"></div>
            {/if}
            {#if drop?.ok}
              {#if drop.zone === 'inside' || view[drop.index]?.kind === 'window' || view[drop.index]?.kind === 'tiles'}
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
  .new-page {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: var(--row-height);
    padding: 0 20px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--mOnSurfaceVariant);
    font: inherit;
    cursor: pointer;
  }

  .new-page:hover { background: var(--state-hover); }
  .new-page:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

  .wrap {
    position: relative;
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
    width: 24px;
    height: 24px;
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
    /* VirtualList scrolls itself; this is for the palette and the no-match results. */
    overflow-y: auto;
  }

  .body :global([role='tree']) {
    padding: 4px;
    outline: none;
  }

  .filters-hint {
    margin: -16px 16px 8px;
    color: var(--mOnSurfaceVariant);
    font-size: calc(var(--font-size) - 1px);
    line-height: 1.6;
    text-align: center;
    text-wrap: pretty;
  }

  .filters-hint code {
    padding: 0 3px;
    border-radius: 4px;
    background: var(--surface-0);
    color: var(--mOnSurface);
    font: 11px var(--font-mono, ui-monospace, monospace);
    white-space: nowrap;
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

  /* Over the search field (2 + 32 + 6 px), so showing it moves nothing. */
  .drop-area {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    background: var(--surface-1);
  }

  .drop-area :global(.grid) {
    padding: 2px 8px 6px;
  }

  .drop-area :global(.empty) {
    height: 32px;
  }

  .tiles-bar {
    position: absolute;
    width: 2px;
    border-radius: 2px;
    background: var(--mPrimary);
    pointer-events: none;
  }

  .drop-box {
    position: absolute;
    left: 2px;
    right: 2px;
    /* Dashed, so a drop target never reads as the solid focus or selection ring. */
    border: 2px dashed var(--mPrimary);
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
    font-size: calc(var(--font-size) - 1px);
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
