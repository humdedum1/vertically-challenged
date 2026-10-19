import type { Range, SearchHit } from '../../lib/search/search-index';
import {
  flattenItems,
  type PinFolder,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../../shared/layout';
import type { GroupInfo, TabInfo, WindowInfo } from '../../shared/types';

interface TreePos {
  /**
   * aria-level: 1 for top-level items, 2 for tabs inside a group; one deeper for each
   * when nested under a window header in the multi-window view.
   */
  level: number;
  /** aria-posinset / aria-setsize among siblings at that level. */
  pos: number;
  size: number;
}

export type TabRow = TreePos & {
  kind: 'tab';
  key: string;
  tab: TabInfo;
  /** Last pinned row, so the UI can draw the pinned/unpinned separator. */
  pinnedEnd: boolean;
  /** Search highlights; absent outside search. */
  highlight?: { title: Range[]; url: Range[] };
};

export type GroupRow = TreePos & {
  kind: 'group';
  key: string;
  group: GroupInfo;
  /** Number of tabs in the group (including hidden ones when collapsed). */
  count: number;
};

export type WindowRow = TreePos & {
  kind: 'window';
  key: string;
  info: WindowInfo;
  /** 1-based label number in display order ("Window 2"). */
  number: number;
  isHome: boolean;
  count: number;
  collapsed: boolean;
  /** Layout name, else the window's active tab title, else "Window N". */
  name: string;
  /** null until the window's layout has been received. */
  layoutId: string | null;
};

export type PinRow = TreePos & {
  kind: 'pin';
  key: string;
  windowId: number;
  item: PinItem;
  /** null when the item is dormant. */
  tab: TabInfo | null;
  /** 1 at the pinned root, +1 per enclosing folder. */
  depth: number;
  /** Always false in rows (Essentials render as tiles); kept so the grid and menus can share the type. */
  essential: boolean;
};

export type FolderRow = TreePos & {
  kind: 'folder';
  key: string;
  windowId: number;
  folder: PinFolder;
  /** 1 at the pinned root, +1 per enclosing folder. */
  depth: number;
  /** Items in the folder subtree. */
  count: number;
};

export type DividerRow = TreePos & {
  kind: 'divider';
  key: string;
  windowId: number;
  /** Unpinned tabs in the window that are not active. */
  clearable: number;
};

export type TilesRow = TreePos & {
  kind: 'tiles';
  key: string;
  windowId: number;
  tiles: { item: PinItem; tab: TabInfo | null }[];
};

/** What the legacy multi-window view (buildWindowRows, search) emits; TabList moves to Row in a later task. */
export type ListRow = TabRow | GroupRow | WindowRow;

export type Row = TabRow | GroupRow | WindowRow | PinRow | FolderRow | DividerRow | TilesRow;

/** The window a row belongs to. */
export const rowWindowId = (r: Row): number => {
  switch (r.kind) {
    case 'tab':
      return r.tab.windowId;
    case 'group':
      return r.group.windowId;
    case 'window':
      return r.info.id;
    default:
      return r.windowId;
  }
};

/**
 * Flattens a window into the rows the virtual list renders, in tab-strip order. Group
 * headers precede their tabs; collapsed groups hide them, like Chrome's strip. Built in
 * one pass plus one pass to fill sibling counts, so it stays O(n) for 1,500 tabs.
 */
export function buildRows(
  tabs: readonly TabInfo[],
  groups: readonly GroupInfo[],
  levelOffset = 0,
): (TabRow | GroupRow)[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const counts = new Map<number, number>();
  for (const t of tabs)
    if (t.groupId !== -1) counts.set(t.groupId, (counts.get(t.groupId) ?? 0) + 1);

  const rows: (TabRow | GroupRow)[] = [];
  let currentGroup = -1;
  let topLevel = 0;
  let childIndex = 0;
  let header: GroupRow | null = null;
  const children: TabRow[] = [];
  const top: (TabRow | GroupRow)[] = [];

  const closeGroup = () => {
    for (const c of children) c.size = children.length;
    children.length = 0;
    header = null;
  };

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i] as TabInfo;
    const group = tab.groupId === -1 || tab.pinned ? undefined : byId.get(tab.groupId);
    if (!group || group.id !== currentGroup) closeGroup();
    if (group && group.id !== currentGroup) {
      header = {
        kind: 'group',
        key: `g${group.id}`,
        group,
        count: counts.get(group.id) ?? 0,
        level: 1 + levelOffset,
        pos: ++topLevel,
        size: 0,
      };
      rows.push(header);
      top.push(header);
      childIndex = 0;
    }
    currentGroup = group ? group.id : -1;
    if (group?.collapsed) continue;

    const next = tabs[i + 1];
    const row: TabRow = {
      kind: 'tab',
      key: `t${tab.id}`,
      tab,
      pinnedEnd: tab.pinned && !next?.pinned,
      level: (group ? 2 : 1) + levelOffset,
      pos: group ? ++childIndex : ++topLevel,
      size: 0,
    };
    rows.push(row);
    if (group) children.push(row);
    else top.push(row);
  }
  closeGroup();
  for (const r of top) r.size = topLevel;
  return rows;
}

/** Search results: a flat, ranked list of tab rows with highlights. */
export function buildSearchRows(tabs: readonly TabInfo[], hits: readonly SearchHit[]): TabRow[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const rows: TabRow[] = [];
  for (const h of hits) {
    const tab = byId.get(h.id);
    if (!tab) continue;
    rows.push({
      kind: 'tab',
      key: `t${tab.id}`,
      tab,
      pinnedEnd: false,
      level: 1,
      pos: rows.length + 1,
      size: hits.length,
      highlight: { title: h.title, url: h.url },
    });
  }
  for (const r of rows) r.size = rows.length;
  return rows;
}

/**
 * Multi-window view: one header per window (home window first, as given), each followed
 * by that window's tree one level deeper. Collapsed windows show only their header.
 */
export function buildWindowRows(
  windows: readonly { info: WindowInfo; tabs: readonly TabInfo[]; groups: readonly GroupInfo[] }[],
  homeId: number | null,
  collapsed: ReadonlySet<number>,
): ListRow[] {
  const rows: ListRow[] = [];
  windows.forEach((w, i) => {
    const isCollapsed = collapsed.has(w.info.id);
    rows.push({
      kind: 'window',
      key: `w${w.info.id}`,
      info: w.info,
      number: i + 1,
      isHome: w.info.id === homeId,
      count: w.tabs.length,
      collapsed: isCollapsed,
      name: windowName(w.tabs, undefined, i + 1),
      layoutId: null,
      level: 1,
      pos: i + 1,
      size: windows.length,
    });
    if (!isCollapsed) rows.push(...buildRows(w.tabs, w.groups, 1));
  });
  return rows;
}

const windowName = (tabs: readonly TabInfo[], layout: WindowLayout | undefined, number: number) =>
  layout?.name || tabs.find((t) => t.active)?.title || `Window ${number}`;

const countItems = (nodes: readonly PinNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind === 'item' ? 1 : countItems(x.children)), 0);

/** Rows for one window's pinned tree; `offset` is 1 under a window header. */
function pinnedTreeRows(
  nodes: readonly PinNode[],
  windowId: number,
  byTab: ReadonlyMap<number, TabInfo>,
  offset: number,
  depth = 1,
): Row[] {
  const rows: Row[] = [];
  const pinRow = (item: PinItem, d: number, pos: number, size: number): PinRow => ({
    kind: 'pin',
    key: `p${item.id}`,
    windowId,
    item,
    tab: item.tabId === null ? null : (byTab.get(item.tabId) ?? null),
    depth: d,
    essential: false,
    level: d + offset,
    pos,
    size,
  });
  nodes.forEach((node, i) => {
    if (node.kind === 'item') {
      rows.push(pinRow(node, depth, i + 1, nodes.length));
      return;
    }
    rows.push({
      kind: 'folder',
      key: `f${node.id}`,
      windowId,
      folder: node,
      depth,
      count: countItems(node.children),
      level: depth + offset,
      pos: i + 1,
      size: nodes.length,
    });
    if (!node.collapsed) {
      rows.push(...pinnedTreeRows(node.children, windowId, byTab, offset, depth + 1));
      return;
    }
    // A collapsed folder still shows the tab you are on, so the active tab never vanishes.
    const active = pinnedTreeRows(node.children, windowId, byTab, offset, depth + 1).find(
      (r): r is PinRow => r.kind === 'pin' && r.tab?.active === true,
    );
    if (active)
      rows.push({ ...active, depth: depth + 1, level: depth + 1 + offset, pos: 1, size: 1 });
  });
  return rows;
}

/**
 * Everything the panel list renders, across windows: per window, Essentials tiles
 * (other windows only; the home grid is separate), the pinned tree, a divider, then the
 * unpinned tabs. Other windows sit one level under a header. A window whose layout
 * hasn't arrived renders its pinned tabs as plain tab rows so the list never blanks.
 */
export function buildPanelRows(
  windows: readonly {
    info: WindowInfo;
    tabs: readonly TabInfo[];
    groups: readonly GroupInfo[];
    layout: WindowLayout | undefined;
  }[],
  homeId: number | null,
  opts: { tilesPerRow: number },
): Row[] {
  const homeLayout = windows.find((w) => w.info.id === homeId)?.layout;
  const perRow = Math.max(1, opts.tilesPerRow);
  const rows: Row[] = [];

  windows.forEach((w, wi) => {
    const windowId = w.info.id;
    const isHome = windowId === homeId;
    const offset = isHome ? 0 : 1;
    const { layout } = w;

    if (!isHome) {
      const collapsed =
        layout !== undefined && (homeLayout?.collapsed.includes(layout.id) ?? false);
      rows.push({
        kind: 'window',
        key: `w${windowId}`,
        info: w.info,
        number: wi + 1,
        isHome,
        count: w.tabs.length,
        collapsed,
        name: windowName(w.tabs, layout, wi + 1),
        layoutId: layout?.id ?? null,
        level: 1,
        pos: wi + 1,
        size: windows.length,
      });
      if (collapsed) return;
    }

    if (!layout) {
      rows.push(...buildRows(w.tabs, w.groups, offset));
      return;
    }

    const byTab = new Map(w.tabs.map((t) => [t.id, t]));
    const referenced = new Set<number>();
    for (const item of flattenItems(layout))
      if (item.tabId !== null && byTab.has(item.tabId)) referenced.add(item.tabId);

    // Same-level siblings across tiles, pinned tree, strays, divider and unpinned tops.
    const top: Row[] = [];
    const level = 1 + offset;

    if (!isHome) {
      for (let i = 0; i < layout.essentials.length; i += perRow) {
        top.push({
          kind: 'tiles',
          key: `x${windowId}-${i / perRow}`,
          windowId,
          tiles: layout.essentials.slice(i, i + perRow).map((item) => ({
            item,
            tab: item.tabId === null ? null : (byTab.get(item.tabId) ?? null),
          })),
          level,
          pos: 0,
          size: 0,
        });
      }
    }
    rows.push(...top);
    const topStart = rows.length - top.length;

    rows.push(...pinnedTreeRows(layout.pinned, windowId, byTab, offset));
    let strays = 0;
    for (const t of w.tabs) {
      if (!t.pinned || referenced.has(t.id)) continue;
      strays++;
      rows.push({
        kind: 'tab',
        key: `t${t.id}`,
        tab: t,
        pinnedEnd: false,
        level,
        pos: 0,
        size: 0,
      });
    }

    const unpinned = w.tabs.filter((t) => !t.pinned);
    if (flattenItems(layout).length > 0 || layout.pinned.length > 0 || strays > 0) {
      rows.push({
        kind: 'divider',
        key: `d${windowId}`,
        windowId,
        clearable: unpinned.reduce((n, t) => n + (t.active ? 0 : 1), 0),
        level,
        pos: 0,
        size: 0,
      });
    }
    rows.push(...buildRows(unpinned, w.groups, offset));

    // Renumber this window's rows at the top level; deeper levels were numbered by their parents.
    const own = rows.slice(topStart).filter((r) => r.level === level);
    own.forEach((r, i) => {
      r.pos = i + 1;
      r.size = own.length;
    });
  });
  return rows;
}
