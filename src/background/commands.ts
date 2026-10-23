import { browser } from 'wxt/browser';
import type { MoveTarget, PanelMessage, PinMessage } from '../shared/protocol';
import { saveSummary } from '../shared/sessions';
import type { GroupColor, GroupInfo, TabInfo } from '../shared/types';
import { planGroupMove, planMoves } from './move-plan';
import type { SessionLayouts } from './sessions';
import { deleteSession, renameSession, restoreSession, saveSession } from './sessions';
import { canDiscardManually } from './suspend/eligibility';

export interface CommandDeps {
  /** Store contents for windows, in strip order. */
  windows(scope: 'window' | 'all', windowId: number): { tabs: TabInfo[]; groups: GroupInfo[] }[];
  tab(tabId: number): TabInfo | undefined;
  restoreDiscarded(): Promise<boolean>;
  /** Layouts to save into and rebuild from sessions; absent in tests that don't need them. */
  layouts?: SessionLayouts & { loaded: Promise<void> };
  /** The Chrome calls the pin commands make; injected so they run in unit tests. */
  chrome: ChromeApi;
}

export interface ChromeApi {
  tabs: {
    query(q: { windowId: number }): Promise<{ id?: number; pinned: boolean; active: boolean }[]>;
    update(id: number, p: { active?: boolean; pinned?: boolean; url?: string }): Promise<unknown>;
    move(id: number, p: { windowId: number; index: number }): Promise<unknown>;
    discard(id: number): Promise<unknown>;
    remove(ids: number[]): Promise<void>;
  };
  windows: {
    create(p: { focused: boolean }): Promise<{ id?: number } | undefined>;
    update(id: number, p: { focused: boolean }): Promise<unknown>;
  };
}

const groupingWindows = new Set<number>();

type Ids = [number, ...number[]];
/** The protocol rejects empty id lists; this narrows to the tuple Chrome's typings want. */
const ids = (list: number[]): Ids | null => (list.length ? (list as Ids) : null);

/**
 * Executes panel commands. State is never updated here: every effect flows back through
 * the regular chrome.tabs / tabGroups events, so there is exactly one path into the store.
 * Live order is re-queried rather than taken from the store, which may be a flush behind.
 */
export async function runCommand(
  msg: Exclude<PanelMessage, { type: 'subscribe' } | PinMessage>,
  deps: CommandDeps,
): Promise<string | undefined> {
  switch (msg.type) {
    case 'activate': {
      const tab = await browser.tabs.update(msg.tabId, { active: true });
      // In the multi-window view the tab may live in another window; bring it forward.
      if (tab) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
      // Activating a tab inside a collapsed group would leave it hidden in the strip.
      if (tab && tab.groupId !== -1) {
        await browser.tabGroups.update(tab.groupId, { collapsed: false }).catch(() => {});
      }
      return;
    }
    case 'reload':
      await Promise.all(msg.tabIds.map((id) => browser.tabs.reload(id)));
      return;
    case 'close':
      await browser.tabs.remove(msg.tabIds);
      return;
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
      await setPinned(msg.tabIds, msg.pinned);
      return;
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
      await moveTabs(msg.tabIds, msg.target);
      return;
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
    case 'autoGroup': {
      if (groupingWindows.has(msg.windowId)) return 'Website grouping is already running';
      groupingWindows.add(msg.windowId);
      try {
        const tabs = await browser.tabs.query({ windowId: msg.windowId });
        const sites = new Map<string, number[]>();
        for (const tab of tabs) {
          if (tab.id === undefined || tab.pinned || tab.groupId !== -1) continue;
          let url: URL;
          try {
            url = new URL(tab.pendingUrl || tab.url || '');
          } catch {
            continue;
          }
          if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
          const host = url.hostname.replace(/^www\./, '');
          const list = sites.get(host) ?? [];
          list.push(tab.id);
          sites.set(host, list);
        }
        let grouped = 0;
        let count = 0;
        for (const [title, list] of sites) {
          if (list.length < 2) continue;
          const groupId = await browser.tabs.group({
            tabIds: list as Ids,
            createProperties: { windowId: msg.windowId },
          });
          await browser.tabGroups.update(groupId, { title });
          grouped += list.length;
          count++;
        }
        return count
          ? `Grouped ${grouped} tabs into ${count} website ${count === 1 ? 'group' : 'groups'}`
          : 'No ungrouped websites with multiple tabs';
      } finally {
        groupingWindows.delete(msg.windowId);
      }
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
    case 'discard':
      await discardTabs(msg.tabIds.map((id) => deps.tab(id)).filter((t): t is TabInfo => !!t));
      return;
    case 'discardOthers': {
      const self = deps.tab(msg.tabId);
      if (!self) return;
      const [win] = deps.windows('window', self.windowId);
      await discardTabs((win?.tabs ?? []).filter((t) => t.id !== msg.tabId));
      return;
    }
    case 'moveToNewWindow': {
      const [first, ...rest] = msg.tabIds;
      if (first === undefined) return;
      const win = await browser.windows.create({ tabId: first, focused: true });
      if (win?.id !== undefined && rest.length) {
        await browser.tabs.move(rest as [number, ...number[]], { windowId: win.id, index: -1 });
      }
      return;
    }
    case 'saveSession': {
      await deps.layouts?.loaded;
      const wins = deps.windows(msg.scope, msg.windowId).map((w) => {
        const id = w.tabs[0]?.windowId;
        return id === undefined || !deps.layouts ? w : { ...w, layout: deps.layouts.layoutOf(id) };
      });
      const { count, skipped } = await saveSession(msg.name, wins);
      return saveSummary(msg.name, count, skipped);
    }
    case 'renameSession':
      await renameSession(msg.id, msg.name);
      return;
    case 'deleteSession':
      await deleteSession(msg.id);
      return;
    case 'restoreSession':
      await deps.layouts?.loaded;
      return restoreSession(
        msg.id,
        msg.target,
        msg.windowId,
        await deps.restoreDiscarded(),
        deps.layouts,
      );
  }
}

/** Manual suspend: ignores the idle timer and whitelist, but Chrome can't discard active tabs. */
async function discardTabs(tabs: readonly TabInfo[]): Promise<void> {
  await Promise.all(
    tabs.filter(canDiscardManually).map((t) => browser.tabs.discard(t.id).catch(() => {})),
  );
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
