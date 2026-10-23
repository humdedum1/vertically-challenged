import {
  findNode,
  flattenItems,
  MAX_FOLDER_DEPTH,
  type PinDest,
  type PinFolder,
  type PinNode,
  type WindowLayout,
} from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import { type Row, rowWindowId } from './rows';

/** `node`: an Essential, pinned item or folder of `windowId`'s layout. */
export type Drag =
  | { kind: 'tabs'; tabIds: number[] }
  | { kind: 'group'; groupId: number }
  | { kind: 'node'; windowId: number; nodeId: string };

/** A drop on an Essentials grid (the home grid, or another window's tiles row). */
export type GridTarget = { kind: 'grid'; windowId: number; index: number }; // insertion index among essentials
export type RowTarget = { index: number; zone: DropZone };

/**
 * Row edges reorder; the center joins a group or nests under a tab.
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
  if (target.kind === 'tab' && zone === 'inside') {
    if (
      drag.kind !== 'tabs' ||
      drag.tabIds.length !== 1 ||
      target.tab.pinned ||
      target.tab.url.startsWith('chrome-extension:')
    )
      return null;
    const tabId = drag.tabIds[0] as number;
    if (tabId === target.tab.id || ctx.tabs.find((t) => t.id === tabId)?.pinned) return null;
    const seen = new Set<number>([tabId]);
    let ancestor: TabInfo | undefined = target.tab;
    while (ancestor) {
      if (seen.has(ancestor.id)) return null;
      seen.add(ancestor.id);
      ancestor = ctx.tabs.find((t) => t.id === ancestor?.openerTabId);
    }
    return { type: 'nestTab', tabId, parentTabId: target.tab.id };
  }
  // Pins need the layouts to plan; planPinDrop (via planDropMulti) handles them.
  if (drag.kind === 'node') return null;

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
  /** The window's layout; undefined while it hasn't arrived (pinned-area drops are then refused). */
  layoutOf?(windowId: number): WindowLayout | undefined;
}

/**
 * planDrop for the multi-window view. Resolves the target row's window and delegates;
 * dropping on a window header appends to that window. Not allowed: moving tabs between
 * incognito and normal windows (Chrome refuses) and moving whole groups across windows.
 * Drags of pins and drops on the pinned area (pins, folders, tiles, divider) go through
 * planPinDrop.
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
  if (drag.kind === 'node' || isPinArea(target) || (drag.kind === 'tabs' && isPinDrag(m, drag))) {
    return planPinDrop(m, rows, drag, { index, zone });
  }
  return planNormalDrop(m, rows, drag, index, zone);
}

const isPinArea = (r: Row): boolean =>
  r.kind === 'pin' || r.kind === 'folder' || r.kind === 'tiles' || r.kind === 'divider';

/** Tab ids that back a layout item of their own window. */
function hasItem(m: MultiDropContext, t: TabInfo): boolean {
  const l = m.layoutOf?.(t.windowId);
  return !!l && flattenItems(l).some((i) => i.tabId === t.id);
}

/**
 * A drag of pinned tabs (live pins, or pinned tabs without an item). These never take the
 * normal `move` path, which would reorder them among pinned tabs behind the layout's back:
 * they go into the layout with pinTabs, or out of the pinned area with an explicit unpin.
 */
function isPinDrag(m: MultiDropContext, drag: { tabIds: number[] }): boolean {
  return drag.tabIds.some((id) => {
    const t = m.tab(id);
    return !!t && (t.pinned || hasItem(m, t));
  });
}

/** Tab and group drags onto normal rows: the pre-Essentials rules. */
function planNormalDrop(
  m: MultiDropContext,
  rows: readonly Row[],
  drag: Exclude<Drag, { kind: 'node' }>,
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

/**
 * Pinned tabs dropped on normal rows: an explicit unpin to that spot. Pinned tab rows are
 * refused as targets (a pinned tab only moves as a pin), and so is a window header of the
 * window they are already in.
 */
function planUnpin(
  m: MultiDropContext,
  rows: readonly Row[],
  tabIds: number[],
  index: number,
  zone: DropZone,
): PanelMessage | null {
  const target = rows[index];
  if (!target) return null;
  if (target.kind === 'tab' && target.tab.pinned) return null;
  const drag = { kind: 'tabs' as const, tabIds };
  if (target.kind === 'window') {
    const dragged = tabIds.map((id) => m.tab(id));
    if (dragged.some((t) => !t || m.isIncognito(t.windowId) !== m.isIncognito(target.info.id)))
      return null;
    if (dragged.every((t) => t?.windowId === target.info.id)) return null;
    return {
      type: 'move',
      tabIds,
      target: { windowId: target.info.id, beforeTabId: null, groupId: -1, pinned: false },
    };
  }
  const plan = planNormalDrop(m, rows, drag, index, zone);
  return plan?.type === 'move' && plan.target.pinned === false ? plan : null;
}

/** Just below a divider: the top of that window's normal tabs. */
function planBelowDivider(
  m: MultiDropContext,
  rows: readonly Row[],
  drag: Exclude<Drag, { kind: 'node' }>,
  index: number,
  pinDrag: boolean,
): PanelMessage | null {
  const divider = rows[index];
  const next = rows[index + 1];
  if (!divider) return null;
  const windowId = rowWindowId(divider);
  if (next && rowWindowId(next) === windowId && (next.kind === 'tab' || next.kind === 'group')) {
    return pinDrag && drag.kind === 'tabs'
      ? planUnpin(m, rows, drag.tabIds, index + 1, 'before')
      : planNormalDrop(m, rows, drag, index + 1, 'before');
  }
  // No normal tabs in the window: append, unpinned.
  if (drag.kind !== 'tabs') return null;
  const dragged = drag.tabIds.map((id) => m.tab(id));
  if (dragged.some((t) => !t || m.isIncognito(t.windowId) !== m.isIncognito(windowId))) return null;
  return {
    type: 'move',
    tabIds: drag.tabIds,
    target: { windowId, beforeTabId: null, groupId: -1, pinned: false },
  };
}

/** A spot in a layout, counted in the list as it is now (the moved nodes still in it). */
interface Spot {
  windowId: number;
  layout: WindowLayout;
  dest: PinDest;
}

/** The sibling list a destination points at, or null when its folder is missing. */
function listOf(l: WindowLayout, dest: PinDest): readonly PinNode[] | null {
  if (dest.zone === 'essentials') return l.essentials;
  if (dest.folderId === null) return l.pinned;
  const hit = findNode(l, dest.folderId);
  return hit?.zone === 'pinned' && hit.node.kind === 'folder' ? hit.node.children : null;
}

/**
 * Where a drop lands in the pinned area, or null when the target isn't part of it. A
 * folder header splits like a group header: before it is its sibling, inside (and just
 * below an expanded header, where the line is drawn) is its first child, below a
 * collapsed one is the sibling after it. Below the last child of an expanded folder
 * stays in that folder.
 */
function spotFor(
  m: MultiDropContext,
  rows: readonly Row[],
  target: RowTarget | GridTarget,
): Spot | null {
  if ('kind' in target) {
    const layout = m.layoutOf?.(target.windowId);
    if (!layout) return null;
    const index = Math.max(0, Math.min(target.index, layout.essentials.length));
    return { windowId: target.windowId, layout, dest: { zone: 'essentials', index } };
  }
  const row = rows[target.index];
  if (!row) return null;
  const windowId = rowWindowId(row);
  const layout = m.layoutOf?.(windowId);
  if (!layout) return null;
  const pinned = (folderId: string | null, index: number): Spot => ({
    windowId,
    layout,
    dest: { zone: 'pinned', folderId, index },
  });
  switch (row.kind) {
    case 'tiles':
      return { windowId, layout, dest: { zone: 'essentials', index: layout.essentials.length } };
    case 'pin':
      return pinned(row.parentId, row.index + (target.zone === 'before' ? 0 : 1));
    case 'folder':
      if (target.zone === 'before') return pinned(row.parentId, row.index);
      if (target.zone === 'inside' || !row.folder.collapsed) return pinned(row.folder.id, 0);
      return pinned(row.parentId, row.index + 1);
    case 'divider':
      return target.zone === 'before' ? pinned(null, layout.pinned.length) : null;
    default:
      return null;
  }
}

/** Number of folder levels in a subtree, counting the folder itself. */
function height(f: PinFolder): number {
  let h = 0;
  for (const c of f.children) if (c.kind === 'folder') h = Math.max(h, height(c));
  return h + 1;
}

/**
 * Mirrors moveNode in background/pins/ops.ts, so a drop the worker would ignore shows no
 * indicator: folders stay out of Essentials, out of themselves, within the depth limit.
 */
export function folderFits(l: WindowLayout, f: PinFolder, dest: PinDest): boolean {
  if (dest.zone === 'essentials') return false;
  if (dest.folderId === null) return height(f) <= MAX_FOLDER_DEPTH;
  if (dest.folderId === f.id || findNode({ ...l, essentials: [], pinned: [f] }, dest.folderId))
    return false;
  const hit = findNode(l, dest.folderId);
  return hit?.node.kind === 'folder' && hit.depth + height(f) <= MAX_FOLDER_DEPTH;
}

/**
 * Turns a spot into the wire destination: the index counts the siblings left once the
 * moved nodes are taken out (as the worker applies it). Null when the folder is gone or
 * when the moved nodes already sit there in that order.
 */
function resolve(spot: Spot, movedIds: readonly string[]): PinDest | null {
  const list = listOf(spot.layout, spot.dest);
  if (!list) return null;
  const raw = Math.min(spot.dest.index, list.length);
  const moved = new Set(movedIds);
  const index = list.slice(0, raw).filter((n) => !moved.has(n.id)).length;
  if (movedIds.length > 0 && movedIds.every((id) => list.some((n) => n.id === id))) {
    const rest = list.filter((n) => !moved.has(n.id)).map((n) => n.id);
    const after = [...rest.slice(0, index), ...movedIds, ...rest.slice(index)];
    if (after.every((id, i) => list[i]?.id === id)) return null;
  }
  return { ...spot.dest, index };
}

/**
 * Drops that involve the pinned area: a drag of pins (a node, or pinned tabs) or a drop on
 * pinned rows, folders, tiles, the divider or a grid. Tabs land with pinTabs, nodes with
 * pinMove (`toWindowId` is the target row's window); a live pin dropped on normal rows is
 * unpinned there with `move`, a dormant one or a folder can't be. Folders never go into
 * Essentials, into themselves, past the depth limit or to another window. Nothing crosses
 * between incognito and normal windows. Null means no indicator and no command.
 */
export function planPinDrop(
  m: MultiDropContext,
  rows: readonly Row[],
  drag: Drag,
  target: RowTarget | GridTarget,
): PanelMessage | null {
  const row = 'kind' in target ? undefined : rows[target.index];
  if (!('kind' in target) && !row) return null;
  const windowId = row ? rowWindowId(row) : (target as GridTarget).windowId;
  const spot = spotFor(m, rows, target);
  const belowDivider = row?.kind === 'divider' && (target as RowTarget).zone === 'after';

  if (drag.kind === 'group') {
    return belowDivider
      ? planBelowDivider(m, rows, drag, (target as RowTarget).index, false)
      : null;
  }

  if (drag.kind === 'tabs') {
    const pinDrag = isPinDrag(m, drag);
    if (!spot) {
      if (!row) return null;
      if (belowDivider)
        return planBelowDivider(m, rows, drag, (target as RowTarget).index, pinDrag);
      const t = target as RowTarget;
      return pinDrag
        ? planUnpin(m, rows, drag.tabIds, t.index, t.zone)
        : planNormalDrop(m, rows, drag, t.index, t.zone);
    }
    const dragged = drag.tabIds.map((id) => m.tab(id));
    const incognito = m.isIncognito(windowId);
    if (dragged.some((t) => !t || m.isIncognito(t.windowId) !== incognito)) return null;
    const moved = drag.tabIds.flatMap((id) => {
      const it = flattenItems(spot.layout).find((i) => i.tabId === id);
      return it ? [it.id] : [];
    });
    const dest = resolve(spot, moved);
    return dest && { type: 'pinTabs', tabIds: drag.tabIds, windowId, dest };
  }

  const from = m.layoutOf?.(drag.windowId);
  const hit = from && findNode(from, drag.nodeId);
  if (!hit) return null;
  if (m.isIncognito(drag.windowId) !== m.isIncognito(windowId)) return null;
  const { node } = hit;

  if (!spot) {
    // Normal rows: unpin a live item there; folders and dormant items have no tab to move.
    if (!row || node.kind !== 'item' || node.tabId === null || !m.tab(node.tabId)) return null;
    const t = target as RowTarget;
    if (belowDivider)
      return planBelowDivider(m, rows, { kind: 'tabs', tabIds: [node.tabId] }, t.index, true);
    return planUnpin(m, rows, [node.tabId], t.index, t.zone);
  }
  if (node.kind === 'folder') {
    // R13: folders exist only in one window's layout.
    if (windowId !== drag.windowId || !folderFits(spot.layout, node, spot.dest)) return null;
  }
  const dest = resolve(spot, windowId === drag.windowId ? [node.id] : []);
  return (
    dest && {
      type: 'pinMove',
      windowId: drag.windowId,
      nodeId: node.id,
      toWindowId: windowId,
      dest,
    }
  );
}
