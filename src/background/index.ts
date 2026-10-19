import { type Browser, browser } from 'wxt/browser';
import { migrateSettings } from '../settings/migrate';
import { hostOf } from '../shared/host-pattern';
import { PANEL_PORT_NAME, parsePanelMessage, type WorkerMessage } from '../shared/protocol';
import type { GroupInfo, TabInfo, WindowInfo } from '../shared/types';
import { createBatcher } from './batcher';
import { type CommandDeps, runCommand } from './commands';
import { registerContextMenus } from './context-menus';
import { PinManager } from './pins/pin-manager';
import { createSuspender } from './suspend/suspender';
import { ChangeSet, TabStore } from './tab-store';
import { toGroupInfo, toTabInfo } from './to-tab-info';

/**
 * Everything is registered synchronously inside this call: MV3 only delivers the event
 * that woke the worker to listeners added in the first turn of the event loop. It is a
 * function rather than top-level code because WXT imports entrypoints at build time.
 */
export function startBackground(): void {
  // Toolbar icon opens the panel; this persists, but setting it on every wake is cheap.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  const store = new TabStore();
  let pending = new ChangeSet();
  /** Open panels: the window each one lives in, and whether it shows all windows. */
  const subs = new Map<Browser.runtime.Port, { windowId: number; all: boolean }>();
  const hasPanel = (windowId: number) => [...subs.values()].some((s) => s.windowId === windowId);
  /** Set by the "focus search" shortcut when the panel isn't connected yet. */
  const pendingFocus = new Set<number>();

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

  async function queryGroups(windowId: number): Promise<GroupInfo[]> {
    try {
      return (await browser.tabGroups.query({ windowId }))
        .map(toGroupInfo)
        .sort((a, b) => a.id - b.id);
    } catch {
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
    const groupsByWindow = new Map<number, GroupInfo[]>();
    for (const g of (await browser.tabGroups.query({}))
      .map(toGroupInfo)
      .sort((a, b) => a.id - b.id)) {
      const list = groupsByWindow.get(g.windowId) ?? [];
      list.push(g);
      groupsByWindow.set(g.windowId, list);
    }
    store.apply(new ChangeSet(), byWindow, groupsByWindow);
  })();

  const batcher = createBatcher(async () => {
    await ready;
    const changes = pending;
    pending = new ChangeSet();
    if (changes.isEmpty) return;
    const resynced = new Map<number, TabInfo[]>();
    const groups = new Map<number, GroupInfo[]>();
    await Promise.all([
      ...[...changes.resync].map(async (w) => resynced.set(w, await queryWindow(w))),
      ...[...changes.groupWindows].map(async (w) => groups.set(w, await queryGroups(w))),
    ]);
    const patches = store.apply(changes, resynced, groups);
    for (const patch of patches) {
      broadcast(patch.windowId, { type: 'patch', patch });
    }
    // Layouts follow the store; awaiting keeps the next flush from moving it underneath.
    await pins.afterFlush(patches.map((p) => p.windowId));
  });

  function broadcast(windowId: number | null, msg: WorkerMessage): void {
    for (const [port, sub] of subs) {
      if (windowId !== null && !sub.all && sub.windowId !== windowId) continue;
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
    suspender.onRemoved(tabId);
    pending.removed.add(tabId);
    pending.upserts.delete(tabId);
    batcher.schedule();
  });
  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    // The store is at most one flush behind, which is plenty for an idle timer.
    const previous = store.snapshot(windowId).tabs.find((t) => t.active && t.id !== tabId);
    suspender.onActivated(tabId, previous?.id);
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

  const GROUP_COMMANDS = new Set<string>([
    'group',
    'ungroup',
    'updateGroup',
    'move',
    'moveGroup',
    'closeGroup',
  ]);
  const markGroups = (g: { windowId: number }) => {
    pending.groupWindows.add(g.windowId);
    batcher.schedule();
  };
  browser.tabGroups.onCreated.addListener(markGroups);
  browser.tabGroups.onUpdated.addListener(markGroups);
  browser.tabGroups.onRemoved.addListener(markGroups);
  browser.tabGroups.onMoved.addListener(markGroups);

  // --- Windows -------------------------------------------------------------------------

  let windowList: WindowInfo[] = [];
  async function refreshWindows(): Promise<void> {
    const wins = await browser.windows.getAll({ windowTypes: ['normal'] });
    const next = wins
      .filter((w): w is typeof w & { id: number } => w.id !== undefined)
      .map((w) => ({ id: w.id, incognito: w.incognito, focused: w.focused }))
      .sort((a, b) => a.id - b.id);
    if (JSON.stringify(next) === JSON.stringify(windowList)) return;
    windowList = next;
    broadcast(null, { type: 'windows', windows: windowList });
  }
  const onWindowsChanged = () => void refreshWindows().catch(() => {});
  browser.windows.onCreated.addListener(onWindowsChanged);
  browser.windows.onRemoved.addListener(onWindowsChanged);
  browser.windows.onFocusChanged.addListener(onWindowsChanged);
  const windowsReady = refreshWindows().catch(() => {});

  // --- Pinned layouts ---------------------------------------------------------------------

  const pins = new PinManager({
    store,
    ready: Promise.all([ready, windowsReady]).then(() => {}),
    tabsApi: browser.tabs,
    storage: { local: browser.storage.local, session: browser.storage.session },
    windows: () => windowList,
    broadcast,
    notice: (windowId, text) => {
      for (const [port, sub] of subs) {
        if (sub.windowId !== windowId) continue;
        try {
          port.postMessage({ type: 'notice', level: 'info', text } satisfies WorkerMessage);
        } catch {}
      }
    },
  });
  browser.windows.onRemoved.addListener((id) => pins.onWindowRemoved(id));
  browser.windows.onFocusChanged.addListener((id) => pins.onWindowFocused(id));

  // --- Commands ---------------------------------------------------------------------------

  const settingsNow = async () =>
    migrateSettings((await browser.storage.sync.get('settings')).settings);
  const deps: CommandDeps = {
    windows: (scope, windowId) =>
      (scope === 'all' ? windowList.map((w) => w.id) : [windowId]).map((id) => store.snapshot(id)),
    tab: (id) => store.get(id),
    restoreDiscarded: async () => (await settingsNow()).sessions.restoreDiscarded,
  };

  const suspender = createSuspender(async () => {
    await ready;
    return windowList.flatMap((w) => store.snapshot(w.id).tabs);
  });
  suspender.register();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT_NAME || port.sender?.id !== browser.runtime.id) return;

    port.onMessage.addListener(async (raw) => {
      const msg = parsePanelMessage(raw);
      if (!msg) return;
      if (msg.type === 'subscribe') {
        // Re-subscribing (switching to/from all windows) just replaces the registration.
        subs.set(port, { windowId: msg.windowId, all: msg.all });
        await ready;
        await windowsReady;
        await pins.loaded;
        // Patches are deltas against the store, so a snapshot of the store as it is now
        // lines up exactly with the next patch, even if events are still pending.
        const ids = msg.all ? windowList.map((w) => w.id) : [msg.windowId];
        if (!ids.includes(msg.windowId)) ids.unshift(msg.windowId);
        try {
          port.postMessage({ type: 'windows', windows: windowList } satisfies WorkerMessage);
          for (const id of ids) {
            port.postMessage({
              type: 'snapshot',
              windowId: id,
              ...store.snapshot(id),
            } satisfies WorkerMessage);
          }
          for (const id of ids) {
            port.postMessage({
              type: 'layout',
              windowId: id,
              layout: pins.layoutOf(id),
            } satisfies WorkerMessage);
          }
          port.postMessage({ type: 'setups', setups: pins.setups() } satisfies WorkerMessage);
          if (pendingFocus.delete(msg.windowId))
            port.postMessage({ type: 'focusSearch' } satisfies WorkerMessage);
        } catch {
          // Panel closed while we waited.
        }
        return;
      }
      const home = subs.get(port)?.windowId ?? null;
      try {
        const text = await runCommand(msg, deps);
        if (text) port.postMessage({ type: 'notice', level: 'info', text } satisfies WorkerMessage);
      } catch (err) {
        // Tabs can vanish between the click and the call; those failures are expected
        // noise and the panel converges through events. Session restores are reported.
        console.debug('[vc] command failed', msg.type, err);
        if (
          msg.type === 'restoreSession' ||
          msg.type === 'saveSession' ||
          msg.type === 'moveToNewWindow'
        ) {
          const text = `Couldn't complete that: ${err instanceof Error ? err.message : 'unknown error'}`;
          try {
            port.postMessage({ type: 'notice', level: 'error', text } satisfies WorkerMessage);
          } catch {}
        }
      }
      // chrome.tabGroups.onUpdated is not reliably delivered for API-driven changes
      // (observed: no event for title/colour/collapsed updates on headless Chrome 145), so
      // group commands re-read the affected windows' groups. Unchanged lists cost nothing.
      if (GROUP_COMMANDS.has(msg.type)) {
        if (home !== null) markGroups({ windowId: home });
        if (msg.type === 'move') markGroups({ windowId: msg.target.windowId });
      }
    });

    port.onDisconnect.addListener(() => {
      subs.delete(port);
    });
  });

  // --- Global shortcuts and context menus -------------------------------------------------

  /** sidePanel.open must run synchronously in the gesture, before any await. */
  function openPanel(windowId: number): void {
    browser.sidePanel.open({ windowId }).catch((err: unknown) => console.warn('[vc] open', err));
  }

  async function activeTab(windowId?: number): Promise<TabInfo | undefined> {
    const [t] = await browser.tabs.query(
      windowId === undefined
        ? { active: true, lastFocusedWindow: true }
        : { active: true, windowId },
    );
    return t ? (toTabInfo(t) ?? undefined) : undefined;
  }

  async function suspendFrom(tab: TabInfo | undefined, others: boolean): Promise<void> {
    if (!tab) return;
    if (others) await runCommand({ type: 'discardOthers', tabId: tab.id }, deps);
    else {
      // The active tab can't be discarded; switch away from it first, like closing would.
      const [win] = deps.windows('window', tab.windowId);
      const tabs = win?.tabs ?? [];
      const i = tabs.findIndex((t) => t.id === tab.id);
      const next = tabs[i + 1] ?? tabs[i - 1];
      if (tab.active && next) await browser.tabs.update(next.id, { active: true });
      await browser.tabs.discard(tab.id).catch(() => {});
    }
  }

  browser.commands.onCommand.addListener((command, tab) => {
    const windowId = tab?.windowId;
    switch (command) {
      case 'toggle-side-panel':
        if (windowId === undefined) return;
        // close() exists from Chrome 141; older versions can only open.
        if (hasPanel(windowId) && typeof browser.sidePanel.close === 'function') {
          browser.sidePanel.close({ windowId }).catch(() => {});
        } else openPanel(windowId);
        return;
      case 'focus-search': {
        if (windowId === undefined) return;
        const connected = [...subs].filter(([, s]) => s.windowId === windowId);
        if (!connected.length) {
          pendingFocus.add(windowId);
          openPanel(windowId);
        }
        for (const [port] of connected)
          port.postMessage({ type: 'focusSearch' } satisfies WorkerMessage);
        return;
      }
      case 'suspend-tab':
      case 'suspend-other-tabs':
        void activeTab(windowId).then((t) => suspendFrom(t, command === 'suspend-other-tabs'));
        return;
    }
  });

  registerContextMenus({
    openPanel,
    suspend: (tab, others) => void suspendFrom(tab, others),
    neverSuspend: async (url) => {
      const s = await settingsNow();
      const host = hostOf(url);
      if (!host || s.suspend.whitelist.includes(host)) return;
      s.suspend.whitelist = [...s.suspend.whitelist, host];
      await browser.storage.sync.set({ settings: migrateSettings(s) });
    },
    saveWindow: async (windowId) => {
      const name = `Window · ${new Date().toLocaleString()}`;
      await runCommand({ type: 'saveSession', scope: 'window', windowId, name }, deps);
    },
  });
}
