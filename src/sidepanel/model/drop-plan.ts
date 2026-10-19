import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import { type Row, rowWindowId } from './rows';

export type Drag = { kind: 'tabs'; tabIds: number[] } | { kind: 'group'; groupId: number };

/**
 * Where the pointer is relative to the target row. Tab rows use before/after (top/bottom
 * half); group headers also have `inside` (join the group).
 */
export type DropZone = 'before' | 'after' | 'inside';

export interface DropContext {
  windowId: number;
  /** Every tab of the window in strip order, including tabs hidden in collapsed groups. */
  tabs: readonly TabInfo[];
}

/**
 * Translates "dropped `drag` at `zone` of `rows[index]`" into a move command, or null if
 * the drop is a no-op or not allowed. Positions are expressed as "before tab X" so the
 * worker can resolve them against the live order. Invariants it maintains:
 * - pinned tabs stay ahead of unpinned ones (dropping into the pinned zone pins);
 * - an ungrouped tab or a whole group never lands strictly inside another group;
 * - a group is never dropped into a group.
 */
export function planDrop(
  ctx: DropContext,
  rows: readonly Row[],
  drag: Drag,
  index: number,
  zone: DropZone,
): PanelMessage | null {
  const target = rows[index];
  if (!target || (target.kind !== 'tab' && target.kind !== 'group')) return null;

  const moving = new Set(
    drag.kind === 'tabs'
      ? drag.tabIds
      : ctx.tabs.filter((t) => t.groupId === drag.groupId).map((t) => t.id),
  );
  if (moving.size === 0) return null;
  // Order with the dragged tabs removed: "after X" means "before the next remaining tab".
  const rest = ctx.tabs.filter((t) => !moving.has(t.id));
  const nextAfter = (id: number): number | null => {
    const all = ctx.tabs;
    for (let i = all.findIndex((t) => t.id === id) + 1; i < all.length; i++) {
      const t = all[i] as TabInfo;
      if (!moving.has(t.id)) return t.id;
    }
    return null;
  };
  const groupTabs = (groupId: number) => rest.filter((t) => t.groupId === groupId && !t.pinned);
  const firstOf = (groupId: number) => groupTabs(groupId)[0]?.id ?? null;
  const afterGroup = (groupId: number): number | null => {
    const tabs = ctx.tabs.filter((t) => t.groupId === groupId);
    const last = tabs[tabs.length - 1];
    return last ? nextAfter(last.id) : null;
  };
  const firstUnpinned = rest.find((t) => !t.pinned)?.id ?? null;

  if (drag.kind === 'group') {
    if (target.kind === 'group' && target.group.id === drag.groupId) return null;
    if (target.kind === 'tab' && moving.has(target.tab.id)) return null;
    let before: number | null;
    if (target.kind === 'tab' && target.tab.pinned) before = firstUnpinned;
    else if (target.kind === 'group') {
      before = zone === 'before' ? firstOf(target.group.id) : afterGroup(target.group.id);
    } else if (target.kind === 'tab' && target.tab.groupId !== -1) {
      // Snap to the edges of the other group rather than splitting it.
      before = zone === 'before' ? firstOf(target.tab.groupId) : afterGroup(target.tab.groupId);
    } else if (target.kind === 'tab') {
      before = zone === 'before' ? target.tab.id : nextAfter(target.tab.id);
    } else return null;
    return {
      type: 'moveGroup',
      groupId: drag.groupId,
      windowId: ctx.windowId,
      beforeTabId: before,
    };
  }

  if (target.kind === 'tab' && moving.has(target.tab.id)) return null;

  let before: number | null;
  let groupId: number;
  let pinned: boolean;
  if (target.kind === 'group') {
    const g = target.group;
    pinned = false;
    if (zone === 'before') {
      groupId = -1;
      before = firstOf(g.id);
    } else if (zone === 'inside' && !g.collapsed) {
      groupId = g.id;
      before = firstOf(g.id) ?? afterGroup(g.id);
    } else if (zone === 'inside') {
      // Collapsed: there are no visible children to aim between, so append.
      groupId = g.id;
      before = afterGroup(g.id);
    } else {
      groupId = g.collapsed ? -1 : g.id;
      before = g.collapsed ? afterGroup(g.id) : (firstOf(g.id) ?? afterGroup(g.id));
    }
  } else {
    const t = target.tab;
    pinned = t.pinned;
    groupId = t.pinned ? -1 : t.groupId;
    before = zone === 'before' ? t.id : nextAfter(t.id);
    // "After the last pinned tab" stays pinned even though the next tab isn't.
  }

  // Tabs dragged in from another window aren't in ctx.tabs; keep the drag's own order then.
  const local = ctx.tabs.filter((t) => moving.has(t.id)).map((t) => t.id);
  const crossWindow = drag.kind === 'tabs' && local.length !== moving.size;
  const ids = crossWindow && drag.kind === 'tabs' ? [...new Set(drag.tabIds)] : local;
  const unchanged =
    !crossWindow &&
    ids.every((id) => {
      const t = ctx.tabs.find((x) => x.id === id) as TabInfo;
      return t.pinned === pinned && (pinned || t.groupId === groupId);
    }) &&
    isContiguousBefore(ctx.tabs, ids, before);
  if (unchanged) return null;

  return {
    type: 'move',
    tabIds: ids,
    target: { windowId: ctx.windowId, beforeTabId: before, groupId: pinned ? -1 : groupId, pinned },
  };
}

/** True if `ids` already sit contiguously, in order, immediately before `before`. */
function isContiguousBefore(
  tabs: readonly TabInfo[],
  ids: readonly number[],
  before: number | null,
): boolean {
  const order = tabs.map((t) => t.id);
  const end = before === null ? order.length : order.indexOf(before);
  if (end < ids.length) return false;
  return ids.every((id, i) => order[end - ids.length + i] === id);
}

export interface MultiDropContext {
  /** Context for a window, or null if it isn't loaded. */
  ctxFor(windowId: number): DropContext | null;
  tab(tabId: number): TabInfo | undefined;
  isIncognito(windowId: number): boolean;
}

/**
 * planDrop for the multi-window view. Resolves the target row's window and delegates;
 * dropping on a window header appends to that window. Not allowed: moving tabs between
 * incognito and normal windows (Chrome refuses) and moving whole groups across windows.
 */
export function planDropMulti(
  m: MultiDropContext,
  rows: readonly Row[],
  drag: Drag,
  index: number,
  zone: DropZone,
): PanelMessage | null {
  const target = rows[index];
  if (!target) return null;
  const windowId = rowWindowId(target);
  const ctx = m.ctxFor(windowId);
  if (!ctx) return null;

  if (drag.kind === 'group') {
    const inTarget = ctx.tabs.some((t) => t.groupId === drag.groupId);
    if (!inTarget) return null;
    return target.kind === 'window' ? null : planDrop(ctx, rows, drag, index, zone);
  }

  const incognito = m.isIncognito(windowId);
  const dragged = drag.tabIds.map((id) => m.tab(id)).filter((t): t is TabInfo => !!t);
  if (dragged.length !== drag.tabIds.length) return null;
  if (dragged.some((t) => m.isIncognito(t.windowId) !== incognito)) return null;

  if (target.kind === 'window') {
    if (dragged.every((t) => t.windowId === windowId)) return null;
    return {
      type: 'move',
      tabIds: dragged.map((t) => t.id),
      target: { windowId, beforeTabId: null, groupId: -1, pinned: null },
    };
  }
  return planDrop(ctx, rows, drag, index, zone);
}
