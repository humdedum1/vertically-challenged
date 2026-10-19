import { type Browser, browser } from 'wxt/browser';
import { PANEL_PORT_NAME, parsePanelMessage, type WorkerMessage } from '../shared/protocol';
import type { TabInfo } from '../shared/types';
import { createBatcher } from './batcher';
import { ChangeSet, TabStore } from './tab-store';
import { toTabInfo } from './to-tab-info';

const store = new TabStore();
let pending = new ChangeSet();
/** Open panels, keyed by the window each one shows. */
const panels = new Map<number, Set<Browser.runtime.Port>>();

async function queryWindow(windowId: number): Promise<TabInfo[]> {
  try {
    const tabs = await browser.tabs.query({ windowId });
    return tabs
      .sort((a, b) => a.index - b.index)
      .map(toTabInfo)
      .filter((t): t is TabInfo => t !== null);
  } catch {
    // Window closed between the event and the query.
    return [];
  }
}

/**
 * Nothing about tabs is persisted: when Chrome suspends the worker, the live browser is
 * the source of truth, so waking up just re-reads every window. Events that arrive before
 * this finishes accumulate in `pending` and are applied by the first flush.
 */
const ready: Promise<void> = (async () => {
  const all = await browser.tabs.query({});
  const byWindow = new Map<number, TabInfo[]>();
  for (const tab of all.sort((a, b) => a.index - b.index)) {
    const info = toTabInfo(tab);
    if (!info) continue;
    let list = byWindow.get(info.windowId);
    if (!list) {
      list = [];
      byWindow.set(info.windowId, list);
    }
    list.push(info);
  }
  store.apply(new ChangeSet(), byWindow);
})();

const batcher = createBatcher(async () => {
  await ready;
  const changes = pending;
  pending = new ChangeSet();
  if (changes.isEmpty) return;
  const resynced = new Map<number, TabInfo[]>();
  await Promise.all([...changes.resync].map(async (w) => resynced.set(w, await queryWindow(w))));
  for (const patch of store.apply(changes, resynced)) {
    broadcast(patch.windowId, { type: 'patch', patch });
  }
});

function broadcast(windowId: number, msg: WorkerMessage): void {
  for (const port of panels.get(windowId) ?? []) {
    try {
      port.postMessage(msg);
    } catch {
      // Port died without onDisconnect firing yet; cleanup happens there.
    }
  }
}

function markResync(windowId: number): void {
  pending.resync.add(windowId);
  batcher.schedule();
}

browser.tabs.onCreated.addListener((tab) => {
  markResync(tab.windowId);
});
browser.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
  const info = toTabInfo(tab);
  if (!info) return;
  pending.upserts.set(info.id, info);
  // Pinning reorders the tab strip; group changes may too.
  if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined)
    pending.resync.add(info.windowId);
  batcher.schedule();
});
browser.tabs.onRemoved.addListener((tabId) => {
  pending.removed.add(tabId);
  pending.upserts.delete(tabId);
  batcher.schedule();
});
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
  pending.activations.set(windowId, tabId);
  batcher.schedule();
});
browser.tabs.onMoved.addListener((_id, { windowId }) => markResync(windowId));
browser.tabs.onAttached.addListener((_id, { newWindowId }) => markResync(newWindowId));
browser.tabs.onDetached.addListener((_id, { oldWindowId }) => markResync(oldWindowId));
browser.tabs.onReplaced.addListener((added, removed) => {
  // Prerender/instant swaps replace the tab id in place.
  pending.removed.add(removed);
  browser.tabs.get(added).then(
    (t) => markResync(t.windowId),
    () => {},
  );
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT_NAME || port.sender?.id !== browser.runtime.id) return;
  let windowId: number | null = null;

  port.onMessage.addListener(async (raw) => {
    const msg = parsePanelMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case 'subscribe': {
        windowId = msg.windowId;
        let set = panels.get(windowId);
        if (!set) {
          set = new Set();
          panels.set(windowId, set);
        }
        set.add(port);
        await ready;
        // Patches are deltas against the store, so a snapshot of the store as it is now
        // lines up exactly with the next patch, even if events are still pending.
        const snap = store.snapshot(windowId);
        port.postMessage({ type: 'snapshot', windowId, ...snap } satisfies WorkerMessage);
        break;
      }
      case 'activate': {
        await browser.tabs.update(msg.tabId, { active: true }).catch(() => {});
        break;
      }
      case 'close':
        await browser.tabs.remove(msg.tabIds).catch(() => {});
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    if (windowId === null) return;
    const set = panels.get(windowId);
    set?.delete(port);
    if (set?.size === 0) panels.delete(windowId);
  });
});

/** Shortcut toggles the panel. sidePanel.open must run synchronously in the gesture. */
browser.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-side-panel' || tab?.windowId === undefined) return;
  const windowId = tab.windowId;
  // close() exists from Chrome 141; older versions can only open.
  if (panels.has(windowId) && typeof browser.sidePanel.close === 'function') {
    browser.sidePanel.close({ windowId }).catch(() => {});
  } else {
    browser.sidePanel.open({ windowId }).catch((err: unknown) => console.warn('[vc] open', err));
  }
});

export function startBackground(): void {
  // Toolbar icon opens the panel; this persists, but setting it on every wake is cheap.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
