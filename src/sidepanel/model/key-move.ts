import type { PinNode, WindowLayout } from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { TabInfo } from '../../shared/types';
import type { Drag, DropZone } from './drop-plan';
import type { Row } from './rows';

export function rowName(r: Row): string {
  switch (r.kind) {
    case 'window':
      return r.name;
    case 'group':
      return r.group.title || 'Unnamed group';
    case 'tab':
      return r.tab.title || r.tab.url || 'New Tab';
    case 'pin':
      return r.tab?.title || r.item.title || r.item.homeUrl;
    case 'folder':
      return r.folder.name;
    case 'divider':
      return 'the pinned tabs';
    case 'tiles':
      return 'Staples';
  }
}

/** Rows that keyboard moves of normal tabs step over (pins move with their own keys). */
const isPinnedArea = (r: Row | undefined): boolean =>
  r?.kind === 'pin' || r?.kind === 'folder' || r?.kind === 'divider' || r?.kind === 'tiles';

/** Display name of a node of a layout (item: its tab's title first). */
export function nodeName(
  l: WindowLayout,
  id: string,
  tabById: ReadonlyMap<number, TabInfo>,
): string {
  const stack: PinNode[] = [...l.essentials, ...l.pinned];
  while (stack.length) {
    const n = stack.pop() as PinNode;
    if (n.id === id) {
      if (n.kind === 'folder') return n.name;
      const t = n.tabId === null ? undefined : tabById.get(n.tabId);
      return t?.title || n.title || n.homeUrl;
    }
    if (n.kind === 'folder') stack.push(...n.children);
  }
  return '';
}

export interface KeyMoveContext {
  view: readonly Row[];
  movableTargets: (tab: TabInfo) => number[];
  isGroupedTab: (tab: TabInfo) => boolean;
  planFor: (drag: Drag, index: number, zone: DropZone) => PanelMessage | null;
}

export interface KeyMove {
  /** Null when the move can't happen; `announcement` then says why. */
  plan: PanelMessage | null;
  announcement: string;
}

/** Alt+Up / Down on a tab or group: what to send and what to announce. */
export function planKeyMove(
  { view, movableTargets, isGroupedTab, planFor }: KeyMoveContext,
  row: Extract<Row, { kind: 'tab' | 'group' }>,
  dir: -1 | 1,
): KeyMove {
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
    const ids = new Set(movableTargets(row.tab));
    if (ids.size === 0) {
      return { plan: null, announcement: `${rowName(row)} is pinned and can’t be moved this way` };
    }
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
  // A tab can't move into the pinned area by keyboard (yet): going up, step over it to
  // this window's header, which then hands the tab to the window above.
  let skippedPinned = false;
  if (row.kind === 'tab' && dir < 0) {
    while (isPinnedArea(view[j])) {
      j--;
      skippedPinned = true;
    }
  }
  let neighbour = view[j];
  // A window header between two windows: step over it so one press crosses into the
  // neighbouring window (top of its normal tabs, bottom of the previous one).
  let crossZone: DropZone | null = null;
  if (neighbour?.kind === 'window' && row.kind === 'tab') {
    if (dir > 0) {
      let k = j + 1;
      while (isPinnedArea(view[k])) k++;
      const firstThere = view[k];
      if (firstThere && firstThere.kind !== 'window') {
        j = k;
        neighbour = firstThere;
        crossZone = 'before';
      } else {
        // Collapsed, or no normal tabs: drop on the header, which appends.
        crossZone = 'inside';
      }
    } else {
      const beyond = view[j - 1];
      if (beyond && !isPinnedArea(beyond)) {
        j -= 1;
        neighbour = beyond;
        crossZone = 'after';
      } else neighbour = undefined;
    }
  }
  if (!neighbour) {
    return {
      plan: null,
      announcement: skippedPinned
        ? `Can’t move ${what} into the pinned tabs`
        : `${what} is already ${dir < 0 ? 'first' : 'last'}`,
    };
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
      isGroupedTab(neighbour.tab) &&
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
  const where = `${dir < 0 ? 'above' : 'below'} ${rowName(neighbour)}`;
  return { plan, announcement: plan ? `Moved ${what} ${where}` : `Can’t move ${what} ${where}` };
}
