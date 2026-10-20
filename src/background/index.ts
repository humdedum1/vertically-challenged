import { type Browser, browser } from 'wxt/browser';
import { migrateSettings } from '../settings/migrate';
import { hostOf } from '../shared/host-pattern';
import {
  isPinMessage,
  PANEL_PORT_NAME,
  parsePanelMessage,
  type WorkerMessage,
} from '../shared/protocol';
import type { GroupInfo, TabInfo, WindowInfo } from '../shared/types';
import { createBatcher } from './batcher';
import { type CommandDeps, runCommand } from './commands';
import { registerContextMenus } from './context-menus';
import { runPinCommand } from './pins/commands';
import { PinManager } from './pins/pin-manager';
import { createSuspender } from './suspend/suspender';
import { ChangeSet, type TabOp, TabStore } from './tab-store';
import { toGroupInfo, toTabInfo } from './to-tab-info';
import { shouldDeliver, snapshotPlan, visibleWindows } from './visibility';

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
  /**
   * Open panels: the window each one lives in, and whether that window is incognito. A
   * panel sees every window of its own kind; a panel whose kind isn't
   * known yet (null) is sent nothing window-scoped.
   */
  const subs = new Map<Browser.runtime.Port, { windowId: number; incognito: boolean | null }>();
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

  /**
   * Windows being re-read by tabs.query. A structural event for one of them may or may
   * not be in the query's result, so it can't be replayed; it marks the window instead.
   * Until `ready` every window counts as being queried.
   */
  let querying: Set<number> | 'all' = 'all';
  void ready.then(() => {
    if (querying === 'all') querying = new Set();
  });

  const batcher = createBatcher(async () => {
    await ready;
    const changes = pending;
    pending = new ChangeSet();
    if (changes.isEmpty) return;
    for (const w of store.unreplayable(changes)) changes.resync.add(w);
    const resynced = new Map<number, TabInfo[]>();
    const groups = new Map<number, GroupInfo[]>();
    querying = new Set(changes.resync);
    try {
      await Promise.all([
        ...[...changes.resync].map(async (w) => resynced.set(w, await queryWindow(w))),
        ...[...changes.groupWindows].map(async (w) => groups.set(w, await queryGroups(w))),
      ]);
    } finally {
      querying = new Set();
    }
    const patches = store.apply(changes, resynced, groups);
    for (const patch of patches) {
      broadcast(patch.windowId, { type: 'patch', patch });
    }
    // Layouts follow the store; awaiting keeps the next flush from moving it underneath.
    await pins.afterFlush(patches.map((p) => p.windowId));
  });

  /** Whether a window is incognito: the window list first, then its tabs; unknown = yes. */
  function windowIncognito(windowId: number): boolean {
    const w = windowList.find((x) => x.id === windowId);
    if (w) return w.incognito;
    const tabs = store.snapshot(windowId).tabs;
    return tabs.length > 0 ? tabs.some((t) => t.incognito) : true;
  }

  /**
   * Window-scoped messages reach the panels that may see that window; `windows` is
   * filtered per panel and everything else unscoped (null) goes to every panel.
   */
  function broadcast(windowId: number | null, msg: WorkerMessage): void {
    const scope = windowId === null ? null : { incognito: windowIncognito(windowId) };
    for (const [port, sub] of subs) {
      if (!shouldDeliver(sub, scope)) continue;
      // The window list is per panel; an unknown-kind panel gets it with its snapshots.
      if (msg.type === 'windows' && sub.incognito === null) continue;
      const out =
        msg.type === 'windows'
          ? { ...msg, windows: visibleWindows(sub.incognito, msg.windows) }
          : msg;
      try {
        port.postMessage(out);
      } catch {
        // Port died without onDisconnect firing yet; cleanup happens there.
      }
    }
  }

  function markResync(windowId: number): void {
    pending.resync.add(windowId);
    batcher.schedule();
  }

  /**
   * Records a structural event to apply locally, which saves a full-window tabs.query
   * (about 37 ms for 1,400 tabs). A window being queried right now gets a resync
   * instead: the event may already be in the query's result.
   */
  function logOp(op: TabOp): void {
    if (querying === 'all' || querying.has(op.windowId)) {
      if (op.kind === 'remove') pending.unlogged.add(op.windowId);
      else pending.resync.add(op.windowId);
    } else if (!pending.resync.has(op.windowId)) {
      pending.ops.push(op);
    }
    batcher.schedule();
  }

  browser.tabs.onCreated.addListener((tab) => {
    const info = toTabInfo(tab);
    if (info) logOp({ kind: 'create', windowId: tab.windowId, tab: info, index: tab.index });
    else markResync(tab.windowId);
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
  browser.tabs.onRemoved.addListener((tabId, { windowId }) => {
    suspender.onRemoved(tabId);
    pending.removed.add(tabId);
    pending.upserts.delete(tabId);
    logOp({ kind: 'remove', windowId, tabId });
  });
  browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    // The store is at most one flush behind, which is plenty for an idle timer.
    const previous = store.snapshot(windowId).tabs.find((t) => t.active && t.id !== tabId);
    suspender.onActivated(tabId, previous?.id);
    pending.activations.set(windowId, tabId);
    batcher.schedule();
  });
  browser.tabs.onMoved.addListener((tabId, { windowId, fromIndex, toIndex }) =>
    logOp({ kind: 'move', windowId, tabId, from: fromIndex, to: toIndex }),
  );
  // The new window is queried rather than given the tab's last known state: Chrome
  // changes a tab on the way (a pinned tab moved by the API arrives unpinned) and reports
  // that against the old window, before the detach.
  browser.tabs.onAttached.addListener((_id, { newWindowId }) => markResync(newWindowId));
  browser.tabs.onDetached.addListener((tabId, { oldWindowId, oldPosition }) =>
    logOp({ kind: 'detach', windowId: oldWindowId, tabId, position: oldPosition }),
  );
  browser.tabs.onReplaced.addListener((added, removed) => {
    // Discards and prerender/instant swaps replace the tab id in place.
    pins.onReplaced(added, removed);
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
    const prev = windowList;
    windowList = next;
    broadcast(null, { type: 'windows', windows: windowList });
    // Panels drop patches for windows they haven't been told about, so a new window's
    // first patch may be lost; its snapshot is taken from the store right now, which is
    // what later patches are diffed against.
    const ports = [...subs.keys()];
    const plan = snapshotPlan(prev, next, [...subs.values()]);
    plan.forEach((ids, i) => {
      const port = ports[i] as Browser.runtime.Port;
      for (const id of ids) {
        try {
          port.postMessage({
            type: 'snapshot',
            windowId: id,
            ...store.snapshot(id),
          } satisfies WorkerMessage);
        } catch {}
      }
      if (ids.length === 0) return;
      void pins.loaded.then(() => {
        for (const id of ids) {
          try {
            port.postMessage({
              type: 'layout',
              windowId: id,
              layout: pins.layoutOf(id),
            } satisfies WorkerMessage);
          } catch {}
        }
      });
    });
  }
  const onWindowsChanged = () => void refreshWindows().catch(() => {});
  browser.windows.onCreated.addListener(onWindowsChanged);
  browser.windows.onRemoved.addListener(onWindowsChanged);
  browser.windows.onFocusChanged.addListener(onWindowsChanged);
  const windowsReady = refreshWindows().catch(() => {});

  // --- Pinned layouts ---------------------------------------------------------------------

  /** A toast for the window's panel, if one is open; otherwise it is dropped. */
  const noticeTo = (windowId: number, text: string) => {
    for (const [port, sub] of subs) {
      if (sub.windowId !== windowId) continue;
      try {
        port.postMessage({ type: 'notice', level: 'info', text } satisfies WorkerMessage);
      } catch {}
    }
  };

  const pins = new PinManager({
    store,
    ready: Promise.all([ready, windowsReady]).then(() => {}),
    tabsApi: browser.tabs,
    storage: { local: browser.storage.local, session: browser.storage.session },
    windows: () => windowList,
    broadcast,
    notice: noticeTo,
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
    layouts: pins,
    chrome: { tabs: browser.tabs, windows: browser.windows },
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
        // Re-subscribing keeps a known kind (it can't change for a window); a new port is
        // unknown, hence sent nothing, until the window list has loaded.
        subs.set(port, { windowId: msg.windowId, incognito: subs.get(port)?.incognito ?? null });
        await ready;
        await windowsReady;
        await pins.loaded;
        const incognito = windowIncognito(msg.windowId);
        subs.set(port, { windowId: msg.windowId, incognito });
        // Patches are deltas against the store, so a snapshot of the store as it is now
        // lines up exactly with the next patch, even if events are still pending.
        const visible = visibleWindows(incognito, windowList);
        const ids = visible.map((w) => w.id);
        if (!ids.includes(msg.windowId)) ids.unshift(msg.windowId);
        try {
          port.postMessage({ type: 'windows', windows: visible } satisfies WorkerMessage);
          for (const id of ids) {
            port.postMessage({
              type: 'snapshot',
              windowId: id,
              ...store.snapshot(id),
            } satisfies WorkerMessage);
          }
          // Outside the pins queue; layoutOf is synchronous and at most creates an empty layout.
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
        const text = isPinMessage(msg)
          ? await runPinCommand(msg, pins, deps)
          : await runCommand(msg, deps);
        if (text) port.postMessage({ type: 'notice', level: 'info', text } satisfies WorkerMessage);
      } catch (err) {
        // Tabs can vanish between the click and the call; those failures are expected
        // noise and the panel converges through events. Session restores are reported.
        console.debug('[vc] command failed', msg.type, err);
        if (
          msg.type === 'restoreSession' ||
          msg.type === 'saveSession' ||
          msg.type === 'moveToNewWindow' ||
          msg.type === 'setupOpen'
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
      // E.g. an incognito window can't be saved; without a panel there is nowhere to say so.
      const text = await runCommand({ type: 'saveSession', scope: 'window', windowId, name }, deps);
      if (text) noticeTo(windowId, text);
    },
  });
}
