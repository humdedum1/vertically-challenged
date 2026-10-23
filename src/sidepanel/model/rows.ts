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
   * aria-level: 1 for top-level items; groups, windows and child-tab branches add depth.
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
  /** Opener-based branch, present only when child tabs are enabled. */
  parentTabId?: number;
  childDepth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
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
  /** Enclosing folder (null at the pinned root) and the index among its children. */
  parentId: string | null;
  index: number;
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
  /** Enclosing folder (null at the pinned root) and the index among its children. */
  parentId: string | null;
  index: number;
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

const windowName = (tabs: readonly TabInfo[], layout: WindowLayout | undefined, number: number) =>
  layout?.name || tabs.find((t) => t.active)?.title || `Window ${number}`;

const countItems = (nodes: readonly PinNode[]): number =>
  nodes.reduce((n, x) => n + (x.kind === 'item' ? 1 : countItems(x.children)), 0);

interface TabLookup {
  get(id: number): TabInfo | undefined;
}

/** Rows for one window's pinned tree; `offset` is 1 under a window header. */
function pinnedTreeRows(
  nodes: readonly PinNode[],
  windowId: number,
  byTab: TabLookup,
  offset: number,
  depth = 1,
  parentId: string | null = null,
): Row[] {
  const rows: Row[] = [];
  const pinRow = (item: PinItem, d: number, pos: number, size: number): PinRow => ({
    kind: 'pin',
    key: `p${item.id}`,
    windowId,
    item,
    tab: item.tabId === null ? null : (byTab.get(item.tabId) ?? null),
    depth: d,
    parentId,
    index: pos - 1,
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
      parentId,
      index: i,
      count: countItems(node.children),
      level: depth + offset,
      pos: i + 1,
      size: nodes.length,
    });
    if (!node.collapsed) {
      rows.push(...pinnedTreeRows(node.children, windowId, byTab, offset, depth + 1, node.id));
      return;
    }
    // A collapsed folder still shows the tab you are on, so the active tab never vanishes.
    const active = pinnedTreeRows(node.children, windowId, byTab, offset, depth + 1, node.id).find(
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
  // Windows' layouts and tab lists arrive as separate messages, so for a moment a moved
  // item or tab can be in two windows at once. Row keys must be unique (keyed each blocks
  // throw); the first window to show a row keeps it.
  const seen = new Set<string>();
  // Mid-move, a tab can already be in its new window's tab list while only the old
  // window's layout lists it. It is drawn once, as that layout's item, not also as a loose
  // pinned tab in the new window.
  // Only needed while a tab is between windows, so it is built on first use.
  let allTabs: Map<number, TabInfo> | undefined;
  const anyTab = (id: number) => {
    allTabs ??= new Map(windows.flatMap((w) => w.tabs.map((t) => [t.id, t] as const)));
    return allTabs.get(id);
  };
  const listedBy = new Map<number, number>();
  for (const w of windows) {
    if (!w.layout) continue;
    for (const i of flattenItems(w.layout)) if (i.tabId !== null) listedBy.set(i.tabId, w.info.id);
  }
  // The home window has no header, so only the other windows' headers are siblings.
  const headers = windows.filter((w) => w.info.id !== homeId).length;
  let header = 0;

  /** Drops rows from `start` on whose key an earlier row already has, in place. */
  const dedupeFrom = (start: number) => {
    let j = start;
    for (let i = start; i < rows.length; i++) {
      const r = rows[i] as Row;
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      rows[j++] = r;
    }
    rows.length = j;
  };

  windows.forEach((w, wi) => {
    const windowStart = rows.length;
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
        pos: ++header,
        size: headers,
      });
      if (collapsed) {
        dedupeFrom(windowStart);
        return;
      }
    }

    if (!layout) {
      rows.push(...buildRows(w.tabs, w.groups, offset));
      dedupeFrom(windowStart);
      return;
    }

    const byTab = new Map(w.tabs.map((t) => [t.id, t]));
    const referenced = new Set<number>();
    for (const item of flattenItems(layout))
      if (item.tabId !== null && byTab.has(item.tabId)) referenced.add(item.tabId);
    // Items find their tab in any window (see listedBy): one moving out stays live here.
    const itemTabs: TabLookup = {
      get: (id) => byTab.get(id) ?? (listedBy.get(id) === windowId ? anyTab(id) : undefined),
    };

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

    rows.push(...pinnedTreeRows(layout.pinned, windowId, itemTabs, offset));
    let strays = 0;
    for (const t of w.tabs) {
      if (!t.pinned || referenced.has(t.id)) continue;
      const other = listedBy.get(t.id);
      if (other !== undefined && other !== windowId) continue;
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

    // Drop duplicates before numbering, so aria positions count only the rows shown.
    dedupeFrom(windowStart);
    // Renumber this window's rows at the top level; deeper levels were numbered by their parents.
    const own = rows.slice(windowStart).filter((r) => r.level === level && r.kind !== 'window');
    own.forEach((r, i) => {
      r.pos = i + 1;
      r.size = own.length;
    });
  });
  return rows;
}

/** Equal by reference, or arrays whose items are equal objects field by field (tiles). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((x, i) => x === b[i] || sameFields(x, b[i]));
}

function sameFields(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => ra[k] === rb[k]);
}

function sameRow(a: Row, b: Row): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const ka = Object.keys(ra);
  return ka.length === Object.keys(rb).length && ka.every((k) => sameValue(ra[k], rb[k]));
}

/**
 * `next` with every row whose content didn't change replaced by the object from `prev`,
 * or `prev` itself when no row changed. Rows are rebuilt from scratch on each patch; with
 * the old objects kept, the keyed list only re-renders the rows that really changed (a
 * title update re-renders one row instead of every visible one).
 */
export function reuseRows(prev: readonly Row[], next: Row[]): Row[] {
  if (prev.length === 0) return next;
  const old = new Map(prev.map((r) => [r.key, r]));
  let unchanged = prev.length === next.length;
  for (let i = 0; i < next.length; i++) {
    const n = next[i] as Row;
    const o = old.get(n.key);
    if (o && o.kind === n.kind && sameRow(o, n)) next[i] = o;
    if (next[i] !== prev[i]) unchanged = false;
  }
  return unchanged ? (prev as Row[]) : next;
}
