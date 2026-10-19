import { browser } from 'wxt/browser';
import type { MoveTarget, PanelMessage } from '../shared/protocol';
import type { GroupColor } from '../shared/types';
import { planGroupMove, planMoves } from './move-plan';

type Ids = [number, ...number[]];
/** The protocol rejects empty id lists; this narrows to the tuple Chrome's typings want. */
const ids = (list: number[]): Ids | null => (list.length ? (list as Ids) : null);

/**
 * Executes panel commands. State is never updated here: every effect flows back through
 * the regular chrome.tabs / tabGroups events, so there is exactly one path into the store.
 * Live order is re-queried rather than taken from the store, which may be a flush behind.
 */
export async function runCommand(msg: Exclude<PanelMessage, { type: 'subscribe' }>): Promise<void> {
  switch (msg.type) {
    case 'activate': {
      const tab = await browser.tabs.update(msg.tabId, { active: true });
      // Activating a tab inside a collapsed group would leave it hidden in the strip.
      if (tab && tab.groupId !== -1) {
        await browser.tabGroups.update(tab.groupId, { collapsed: false }).catch(() => {});
      }
      return;
    }
    case 'close':
      return browser.tabs.remove(msg.tabIds);
    case 'closeOthers': {
      const ids = await windowTabs(msg.tabId, (t) => !t.pinned && t.id !== msg.tabId);
      if (ids.length) await browser.tabs.remove(ids);
      return;
    }
    case 'closeBelow': {
      const self = await browser.tabs.get(msg.tabId);
      const ids = await windowTabs(msg.tabId, (t) => !t.pinned && t.index > self.index);
      if (ids.length) await browser.tabs.remove(ids);
      return;
    }
    case 'duplicate':
      await browser.tabs.duplicate(msg.tabId);
      return;
    case 'setPinned':
      return setPinned(msg.tabIds, msg.pinned);
    case 'setMuted':
      await Promise.all(msg.tabIds.map((id) => browser.tabs.update(id, { muted: msg.muted })));
      return;
    case 'newTab': {
      if (msg.afterTabId === null) {
        await browser.tabs.create({ windowId: msg.windowId });
        return;
      }
      const after = await browser.tabs.get(msg.afterTabId);
      const tab = await browser.tabs.create({ windowId: after.windowId, index: after.index + 1 });
      // Matches Chrome's "New tab to the right", which stays in the neighbour's group.
      if (tab.id !== undefined && after.groupId !== -1 && !after.pinned) {
        await browser.tabs.group({ groupId: after.groupId, tabIds: [tab.id] });
      }
      return;
    }
    case 'move':
      return moveTabs(msg.tabIds, msg.target);
    case 'moveGroup': {
      const tabs = await browser.tabs.query({ windowId: msg.windowId });
      const order = sortedIds(tabs);
      const inGroup = tabs.filter((t) => t.groupId === msg.groupId).map((t) => t.id as number);
      const index = planGroupMove(order, inGroup, msg.beforeTabId);
      await browser.tabGroups.move(msg.groupId, { windowId: msg.windowId, index });
      return;
    }
    case 'group': {
      const tabIds = ids(msg.tabIds);
      if (!tabIds) return;
      const first = await browser.tabs.get(tabIds[0]);
      // Pinned tabs can't be grouped; Chrome rejects the whole call if any are included.
      await unpinAll(tabIds);
      const groupId =
        msg.groupId === null
          ? await browser.tabs.group({ tabIds, createProperties: { windowId: first.windowId } })
          : await browser.tabs.group({ tabIds, groupId: msg.groupId });
      const props: { title?: string; color?: GroupColor } = {};
      if (msg.title !== undefined) props.title = msg.title;
      if (msg.color !== undefined) props.color = msg.color;
      if (Object.keys(props).length) await browser.tabGroups.update(groupId, props);
      return;
    }
    case 'ungroup': {
      const tabIds = ids(msg.tabIds);
      if (tabIds) await browser.tabs.ungroup(tabIds);
      return;
    }
    case 'updateGroup': {
      const { groupId, type: _t, ...props } = msg;
      await browser.tabGroups.update(groupId, props);
      return;
    }
    case 'closeGroup': {
      const tabs = await browser.tabs.query({ groupId: msg.groupId });
      const ids = tabs.map((t) => t.id).filter((id): id is number => id !== undefined);
      if (ids.length) await browser.tabs.remove(ids);
      return;
    }
  }
}

/**
 * Sequential on purpose: Chrome moves each newly (un)pinned tab to the pinned-zone
 * boundary, so parallel updates would leave them in completion order.
 */
async function setPinned(tabIds: number[], pinned: boolean): Promise<void> {
  for (const id of tabIds) await browser.tabs.update(id, { pinned });
}

async function unpinAll(tabIds: number[]): Promise<void> {
  const tabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id)));
  await setPinned(
    tabs.filter((t) => t.pinned).map((t) => t.id as number),
    false,
  );
}

function sortedIds(tabs: { id?: number; index: number }[]): number[] {
  return [...tabs]
    .sort((a, b) => a.index - b.index)
    .map((t) => t.id)
    .filter((id): id is number => id !== undefined);
}

async function windowTabs(
  tabId: number,
  pick: (t: { id?: number; pinned: boolean; index: number }) => boolean,
): Promise<number[]> {
  const self = await browser.tabs.get(tabId);
  const tabs = await browser.tabs.query({ windowId: self.windowId });
  return tabs.filter(pick).map((t) => t.id as number);
}

/**
 * Order matters: pin state first (Chrome confines pinned tabs to the front), then group
 * membership, then the exact position. Chrome adjusts membership when a tab lands on a
 * group boundary, so membership is checked once more at the end and corrected.
 */
async function moveTabs(tabIds: number[], target: MoveTarget): Promise<void> {
  if (target.pinned !== null) await setPinned(tabIds, target.pinned);
  const all = ids(tabIds);
  if (!all) return;
  const wantGroup = target.pinned === true ? -1 : target.groupId;
  // Ungrouping tabs that aren't grouped is a no-op error; ignore it.
  if (wantGroup === -1) await browser.tabs.ungroup(all).catch(() => {});
  else if (wantGroup !== null) await browser.tabs.group({ groupId: wantGroup, tabIds: all });

  const order = sortedIds(await browser.tabs.query({ windowId: target.windowId }));
  for (const m of planMoves(order, tabIds, target.beforeTabId)) {
    await browser.tabs.move(m.tabId, { windowId: target.windowId, index: m.index });
  }

  if (wantGroup === null) return;
  const after = await Promise.all(tabIds.map((id) => browser.tabs.get(id)));
  const wrong = ids(after.filter((t) => t.groupId !== wantGroup).map((t) => t.id as number));
  if (!wrong) return;
  if (wantGroup === -1) await browser.tabs.ungroup(wrong);
  else await browser.tabs.group({ groupId: wantGroup, tabIds: wrong });
}
