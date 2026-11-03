import { flattenItems, type PinItem, type WindowLayout } from '../../shared/layout';
import type { GroupInfo, TabInfo } from '../../shared/types';
import type { Drag } from './drop-plan';
import { nodeName } from './key-move';
import type { PinRow, Row } from './rows';

/** What the tab list knows when a pointer drag starts. */
export interface DragContext {
  view: readonly Row[];
  searching: boolean;
  selection: ReadonlySet<number>;
  tabById: ReadonlyMap<number, TabInfo>;
  groupById: ReadonlyMap<number, GroupInfo>;
  layoutTabIds: ReadonlySet<number>;
  windowIds: readonly number[];
  homeId: number | null;
  layoutOf: (windowId: number) => WindowLayout | undefined;
  isIncognito: (windowId: number) => boolean;
  movableTargets: (tab: TabInfo) => number[];
}

/** The item of a pinned tab, in whichever layout has it. */
function itemOfTab(c: DragContext, tabId: number): { windowId: number; item: PinItem } | null {
  for (const windowId of c.windowIds) {
    const l = c.layoutOf(windowId);
    const item = l && flattenItems(l).find((i) => i.tabId === tabId);
    if (item) return { windowId, item };
  }
  return null;
}

/**
 * A pinned row drags its node, or the selection when every selected tab is a live pin
 * of that window (then as tabs, in layout order, which pinTabs moves as their items).
 */
function pinDrag(c: DragContext, row: PinRow): Drag {
  const { selection, tabById } = c;
  const tab = row.tab;
  const l = c.layoutOf(row.windowId);
  if (tab && l && selection.size > 1 && selection.has(tab.id)) {
    const ids = flattenItems(l)
      .map((i) => i.tabId)
      .filter((id): id is number => id !== null && selection.has(id) && tabById.has(id));
    if (ids.length === selection.size) return { kind: 'tabs', tabIds: ids };
  }
  return { kind: 'node', windowId: row.windowId, nodeId: row.item.id };
}

export function dragOf(c: DragContext, i: number, target: Element): Drag | null {
  const row = c.view[i];
  if (!row || c.searching) return null;
  switch (row.kind) {
    case 'group':
      return { kind: 'group', groupId: row.group.id };
    case 'folder':
      return { kind: 'node', windowId: row.windowId, nodeId: row.folder.id };
    case 'pin':
      return pinDrag(c, row);
    case 'tiles': {
      const id = target.closest<HTMLElement>('[data-item]')?.dataset.item;
      return id ? { kind: 'node', windowId: row.windowId, nodeId: id } : null;
    }
    case 'tab': {
      // R18: anything pinned drags as a pin (its item, or the bare tab for pinTabs / unpin).
      if (row.tab.pinned || c.layoutTabIds.has(row.tab.id)) {
        const own = itemOfTab(c, row.tab.id);
        return own
          ? { kind: 'node', windowId: own.windowId, nodeId: own.item.id }
          : { kind: 'tabs', tabIds: [row.tab.id] };
      }
      const tabIds = c.movableTargets(row.tab);
      return tabIds.length > 0 ? { kind: 'tabs', tabIds } : null;
    }
    default:
      return null;
  }
}

export function dragName(c: DragContext, payload: Drag): string {
  if (payload.kind === 'group') return c.groupById.get(payload.groupId)?.title || 'Unnamed group';
  if (payload.kind === 'node') {
    const l = c.layoutOf(payload.windowId);
    return (l && nodeName(l, payload.nodeId, c.tabById)) || 'Pinned tab';
  }
  if (payload.tabIds.length > 1) return `${payload.tabIds.length} tabs`;
  const t = c.tabById.get(payload.tabIds[0] as number);
  return t?.title || t?.url || 'New Tab';
}

/**
 * Whether the drag could land in the home grid, which decides if the empty drop area
 * opens: not folders or groups, and nothing from a window of the other incognito kind.
 */
export function canBeEssential(c: DragContext, payload: Drag): boolean {
  const home = c.homeId;
  if (payload.kind === 'group' || home === null) return false;
  const incognito = c.isIncognito(home);
  if (payload.kind === 'tabs') {
    return payload.tabIds.every((id) => {
      const t = c.tabById.get(id);
      return t !== undefined && c.isIncognito(t.windowId) === incognito;
    });
  }
  const l = c.layoutOf(payload.windowId);
  return (
    c.isIncognito(payload.windowId) === incognito &&
    !!l &&
    flattenItems(l).some((i) => i.id === payload.nodeId)
  );
}
