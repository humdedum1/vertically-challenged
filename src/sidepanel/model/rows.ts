import type { Range, SearchHit } from '../../lib/search/search-index';
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
};

export type Row = TabRow | GroupRow | WindowRow;

/** The window a row belongs to. */
export const rowWindowId = (r: Row): number =>
  r.kind === 'tab' ? r.tab.windowId : r.kind === 'group' ? r.group.windowId : r.info.id;

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
): Row[] {
  const rows: Row[] = [];
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
      level: 1,
      pos: i + 1,
      size: windows.length,
    });
    if (!isCollapsed) rows.push(...buildRows(w.tabs, w.groups, 1));
  });
  return rows;
}
