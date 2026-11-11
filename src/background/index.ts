import { type Browser, browser } from 'wxt/browser';
import { makeTarget } from '../backup/make-target';
import { migrateSettings } from '../settings/migrate';
import { saveSettings } from '../settings/save';
import type { TabRule } from '../settings/schema';
import { EXTENSION_SCHEME, isNewTabUrl } from '../shared/browser-urls';
import { hostOf } from '../shared/host-pattern';
import { parseImport } from '../shared/import-tabs';
import {
  isPinMessage,
  isSyncMessage,
  PANEL_PORT_NAME,
  parsePanelMessage,
  type WorkerMessage,
} from '../shared/protocol';
import { parseSessions, SESSIONS_KEY } from '../shared/sessions';
import { rememberIcons, SITE_ICONS_KEY, type SiteIcons } from '../shared/site-icons';
import { POPUP_TOKEN_KEY, type Surface } from '../shared/surface';
import { DEVICE_KEY } from '../shared/sync-store';
import type { GroupInfo, TabInfo, WindowInfo } from '../shared/types';
import { parseCustomThemes } from '../themes/custom-themes';
import { downloadsTarget } from './backup/downloads';
import {
  BACKUP_ALARM,
  CONFIG_KEY as BACKUP_CONFIG_KEY,
  STATUS_KEY as BACKUP_STATUS_KEY,
  type BackupConfig,
  type BackupStatus,
  backupHealth,
  intervalMinutes,
  parseConfig,
  runBackup,
} from './backup/scheduler';
import { createBatcher } from './batcher';
import { placeChildTab } from './child-tabs';
import { type CommandDeps, runCommand } from './commands';
import { registerContextMenus } from './context-menus';
import { createDisplay, launchAction, POPUP_WINDOW, type TargetTab } from './display';
import { createMruCycle } from './mru';
import { runPinCommand } from './pins/commands';
import { PinManager } from './pins/pin-manager';
import { planRelay, runRelay } from './relay';
import { addSession, addSessions, listSessions, restoreSessionValue } from './sessions';
import { SNOOZE_ALARM, scheduleSnoozeAlarm, wakeDue } from './snooze';
import { createSuspender } from './suspend/suspender';
import { runSyncCommand, type SyncCommandDeps } from './sync/commands';
import { createSyncPublisher } from './sync/publisher';
import { applyTabRule } from './tab-rules';
import { ChangeSet, type TabOp, TabStore } from './tab-store';
import { toTabInfo as browserTabInfo, toGroupInfo } from './to-tab-info';
import { crossesKind, shouldDeliver, snapshotPlan, visibleWindows } from './visibility';

/**
 * Everything is registered synchronously inside this call: MV3 only delivers the event
 * that woke the worker to listeners added in the first turn of the event loop. It is a
 * function rather than top-level code because WXT imports entrypoints at build time.
 */
interface SidebarAction {
  open(): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
}

export function startBackground(): void {
  // Side panel or in-page popup (Display setting). In side-panel mode Chrome opens the panel
  // from the toolbar button itself; the behaviour persists, and is set again on every wake.
  // Firefox has sidebarAction instead of sidePanel; it acts on the current window.
  const sidebar = import.meta.env.FIREFOX
    ? (browser as unknown as { sidebarAction: SidebarAction }).sidebarAction
    : undefined;
  const panelApi = sidebar
    ? {
        setPanelBehavior: async () => {},
        openSidePanel: () => sidebar.open(),
        closeSidePanel: () => sidebar.close(),
        toggleSidebar: () => sidebar.toggle(),
        overlay: false,
      }
    : {
        setPanelBehavior: (b: { openPanelOnActionClick: boolean }) =>
          browser.sidePanel.setPanelBehavior(b),
        openSidePanel: (windowId: number) => browser.sidePanel.open({ windowId }),
        closeSidePanel:
          typeof browser.sidePanel.close === 'function'
            ? (windowId: number) => browser.sidePanel.close({ windowId })
            : undefined,
      };
  const display = createDisplay(
    {
      ...panelApi,
      injectToggle: async (tabId) => {
        await browser.scripting.executeScript({ target: { tabId }, files: ['/popup-toggle.js'] });
      },
      createPopupWindow: (url) =>
        browser.windows.create({ url, type: 'popup', focused: true, ...POPUP_WINDOW }),
      removeWindow: (id) => browser.windows.remove(id),
      getURL: (path) => browser.runtime.getURL(path as '/sidepanel.html'),
    },
    (...a) => console.warn(...a),
  );
  // Only fires in popup mode: in side-panel mode Chrome handles the click.
  browser.action.onClicked.addListener((tab) => void display.actionClicked(targetOf(tab)));

  // "Open on launch": a notification whose click is the gesture sidePanel.open needs. The
  // target is in the id, so the click opens synchronously even if the worker slept since.
  browser.runtime.onStartup.addListener(() => void notifyLaunch());
  browser.notifications?.onClicked.addListener((id) => {
    const m = /^vc-launch:(\d+):(\d+):(0|1)$/.exec(id);
    if (!m) return;
    display.open(
      { windowId: Number(m[1]), id: Number(m[2]), incognito: m[3] === '1' },
      { toggle: false, sidebarOpen: false },
    );
    void browser.notifications.clear(id);
  });
  // A launch prompt for a closed window would open nothing: drop it with the window.
  browser.windows.onRemoved.addListener(async (windowId) => {
    if (!browser.notifications) return;
    const prefix = `vc-launch:${windowId}:`;
    for (const id of Object.keys(await browser.notifications.getAll().catch(() => ({}))))
      if (id.startsWith(prefix)) void browser.notifications.clear(id);
  });
  async function notifyLaunch(): Promise<void> {
    const { display: d } = await settingsNow();
    if (!d.openOnLaunch) return;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) return;
    // The popup and window need no gesture (the popup falls back to a window without activeTab).
    const action = launchAction(d.mode, !!import.meta.env.FIREFOX);
    if (action === 'open')
      return display.open(targetOf(tab), { toggle: false, sidebarOpen: false });
    if (action === 'none' || !browser.notifications) return;
    await browser.notifications.create(
      `vc-launch:${tab.windowId}:${tab.id}:${tab.incognito ? 1 : 0}`,
      {
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icon/128.png'),
        title: 'Vertically Challenged',
        message: 'Click to open your vertical tabs.',
        requireInteraction: true,
      },
    );
  }

  // Firefox: remember each site's icon for bookmarks, history and Staples (shared/site-icons.ts).
  let iconBatch: TabInfo[] = [];
  let iconTimer: ReturnType<typeof setTimeout> | undefined;
  function noteIcons(tabs: TabInfo[]): void {
    if (!import.meta.env.FIREFOX) return;
    iconBatch.push(...tabs);
    if (iconTimer !== undefined) return;
    iconTimer = setTimeout(() => {
      iconTimer = undefined;
      const batch = iconBatch;
      iconBatch = [];
      void (async () => {
        const stored = (await browser.storage.local.get(SITE_ICONS_KEY))[SITE_ICONS_KEY];
        const next = rememberIcons((stored ?? {}) as SiteIcons, batch);
        if (next) await browser.storage.local.set({ [SITE_ICONS_KEY]: next });
      })().catch((err: unknown) => console.debug('[vc] site icons', err));
    }, 3000);
  }
  // Clearing all history also forgets which sites the icons came from.
  if (import.meta.env.FIREFOX)
    browser.history.onVisitRemoved.addListener(({ allHistory }) => {
      if (allHistory) void browser.storage.local.remove(SITE_ICONS_KEY);
    });

  const detachedTabs = new Set<number>();
  const detachedReady = browser.storage.session.get('detachedTabs').then((stored) => {
    if (Array.isArray(stored.detachedTabs))
      for (const id of stored.detachedTabs) if (typeof id === 'number') detachedTabs.add(id);
  });
  const saveDetached = () => browser.storage.session.set({ detachedTabs: [...detachedTabs] });
  const toTabInfo = (tab: Browser.tabs.Tab): TabInfo | null => {
    const info = browserTabInfo(tab);
    if (info && detachedTabs.has(info.id)) delete info.openerTabId;
    return info;
  };
  const store = new TabStore();
  let pending = new ChangeSet();
  /**
   * Open panels: the window each one lives in, and whether that window is incognito. A
   * panel sees every window of its own kind; a panel whose kind isn't
   * known yet (null) is sent nothing window-scoped.
   */
  const subs = new Map<
    Browser.runtime.Port,
    { windowId: number; incognito: boolean | null; surface: Surface }
  >();
  /** Whether the window's side panel is open (in-page popups and popup windows don't count). */
  const hasPanel = (windowId: number) =>
    [...subs.values()].some((s) => s.windowId === windowId && s.surface === 'sidebar');
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
   * Live tab contents come from the browser; only explicit detachments survive worker
   * suspension in session storage. Waking up re-reads every window. Events that arrive before
   * this finishes accumulate in `pending` and are applied by the first flush.
   */
  const ready: Promise<void> = (async () => {
    await detachedReady;
    const all = await browser.tabs.query({});
    const byWindow = new Map<number, TabInfo[]>();
    for (const tab of all.sort((a, b) => a.index - b.index)) {
      const info = toTabInfo(tab);
      if (!info) continue;
      noteIcons([info]);
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
    if (patches.some((p) => !windowIncognito(p.windowId))) void publisher.schedule();
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

  // 0.3s after the redirected page loads, move focus from the address bar to the page's
  // search box. Needs the optional site access; without it the script is refused and skipped.
  function focusPageSearch(tabId: number): void {
    const onLoaded = (id: number, change: { status?: string }) => {
      if (id !== tabId || change.status !== 'complete') return;
      browser.tabs.onUpdated.removeListener(onLoaded);
      setTimeout(() => {
        browser.scripting
          .executeScript({
            target: { tabId },
            func: () => {
              const box = document.querySelector<HTMLElement>(
                'input[type=search], [role=search] input, [name=q], [role=searchbox]',
              );
              window.focus();
              box?.focus();
            },
          })
          .catch((err: unknown) => console.debug('[vc] new tab search focus skipped', err));
      }, 300);
    };
    browser.tabs.onUpdated.addListener(onLoaded);
    // Stop waiting if the page never finishes loading.
    setTimeout(() => browser.tabs.onUpdated.removeListener(onLoaded), 30_000);
  }

  browser.tabs.onCreated.addListener((tab) => {
    const info = toTabInfo(tab);
    if (info) logOp({ kind: 'create', windowId: tab.windowId, tab: info, index: tab.index });
    else markResync(tab.windowId);
    void placeChildTab(tab).catch((err: unknown) =>
      console.debug('[vc] child tab placement failed', err),
    );
    // Browser-opened blank tabs (Ctrl+T, + button) are swapped for the configured new-tab URL.
    const id = tab.id;
    if (id !== undefined && isNewTabUrl(tab.pendingUrl ?? tab.url))
      void settingsNow()
        .then(async ({ tabs }) => {
          if (!tabs.newTabUrl) return;
          // A tab Chrome opened keeps the address bar focused even after navigating, so
          // open the URL in a tab of our own (page focused) and close Chrome's blank one.
          const next = await browser.tabs.create({
            windowId: tab.windowId,
            index: tab.index,
            url: tabs.newTabUrl,
            active: tab.active,
          });
          if (next.id === undefined) return;
          if (tab.groupId !== undefined && tab.groupId !== -1)
            await browser.tabs.group({ groupId: tab.groupId, tabIds: [next.id] });
          await browser.tabs.remove(id);
          focusPageSearch(next.id);
        })
        .catch((err: unknown) => console.debug('[vc] new tab redirect failed', err));
  });
  // Tab rules (Settings): kept in memory, refreshed from the settings below.
  let tabRules: TabRule[] = [];
  browser.tabs.onUpdated.addListener((_id, changeInfo, tab) => {
    if (changeInfo.url && tabRules.length)
      void applyTabRule(tab, tabRules).catch((err: unknown) =>
        console.debug('[vc] tab rule failed', err),
      );
    const info = toTabInfo(tab);
    if (!info) return;
    if (changeInfo.favIconUrl) noteIcons([info]);
    pending.upserts.set(info.id, info);
    // Pinning reorders the tab strip; group changes may too.
    if (changeInfo.pinned !== undefined || changeInfo.groupId !== undefined)
      pending.resync.add(info.windowId);
    batcher.schedule();
  });
  browser.tabs.onRemoved.addListener((tabId, { windowId, isWindowClosing }) => {
    if (isWindowClosing) pins.onWindowClosing(windowId);
    suspender.onRemoved(tabId);
    void detachedReady.then(async () => {
      if (detachedTabs.delete(tabId)) await saveDetached();
    });
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
    'autoGroup',
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
    // Called asynchronously (layouts load after `ready`), once `publisher` exists.
    onChange: () => publisher.schedule(),
  });
  browser.windows.onRemoved.addListener((id) => {
    pins.onWindowRemoved(id);
    display.windowRemoved(id);
  });
  browser.windows.onFocusChanged.addListener((id) => pins.onWindowFocused(id));

  // --- Commands ---------------------------------------------------------------------------

  const settingsNow = async () =>
    migrateSettings((await browser.storage.sync.get('settings')).settings);

  // --- Sync (see shared/sync.ts) -----------------------------------------------------------

  const publisher = createSyncPublisher({
    sync: browser.storage.sync,
    local: browser.storage.local,
    workspaces: async () => {
      await pins.loaded;
      return pins.syncWorkspaces();
    },
    sessions: listSessions,
    settings: async () => (await settingsNow()).sync,
    platform: async () => (await browser.runtime.getPlatformInfo()).os,
  });
  // --- Scheduled full backup (see backup/scheduler.ts) -------------------------------------
  const backupDeps = {
    storage: browser.storage.local,
    target: (cfg: BackupConfig) => makeTarget(cfg, downloadsTarget),
    version: browser.runtime.getManifest().version,
    device: async () => {
      const d = (await browser.storage.local.get(DEVICE_KEY))[DEVICE_KEY] as
        | { id?: string; name?: string }
        | undefined;
      // Readable name first, then the stable id that retention groups by.
      return [d?.name, d?.id].filter(Boolean).join('-');
    },
    collect: async () => {
      await pins.loaded;
      const [sync, local] = await Promise.all([
        browser.storage.sync.get(null),
        browser.storage.local.get([SESSIONS_KEY, 'customCss']),
      ]);
      const themes = parseCustomThemes(sync);
      return {
        settings: migrateSettings(sync.settings),
        themes,
        layouts: await pins.backupLayouts(),
        sessions: local[SESSIONS_KEY],
        customCss: local.customCss,
      };
    },
  };
  /** A "!" on the toolbar icon when scheduled backups are failing or have stopped. */
  async function refreshBackupBadge(): Promise<void> {
    const s = await browser.storage.local.get([BACKUP_CONFIG_KEY, BACKUP_STATUS_KEY]);
    const health = backupHealth(
      parseConfig(s[BACKUP_CONFIG_KEY]),
      (s[BACKUP_STATUS_KEY] ?? {}) as BackupStatus,
      Date.now(),
    );
    const warn = health === 'failed' || health === 'stale';
    await browser.action.setBadgeText({ text: warn ? '!' : '' });
    if (warn) await browser.action.setBadgeBackgroundColor({ color: '#c0392b' });
  }
  async function configureBackupAlarm(): Promise<void> {
    const cfg = parseConfig(
      (await browser.storage.local.get(BACKUP_CONFIG_KEY))[BACKUP_CONFIG_KEY],
    );
    const minutes = intervalMinutes(cfg.interval);
    const existing = await browser.alarms.get(BACKUP_ALARM);
    if (minutes === 0) {
      if (existing) await browser.alarms.clear(BACKUP_ALARM);
    } else if (existing?.periodInMinutes !== minutes) {
      await browser.alarms.create(BACKUP_ALARM, { periodInMinutes: minutes });
    }
  }
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[BACKUP_CONFIG_KEY] || changes[BACKUP_STATUS_KEY]))
      void refreshBackupBadge().catch(() => {});
    if (area === 'local' && changes[BACKUP_CONFIG_KEY])
      void configureBackupAlarm().catch((err: unknown) =>
        console.warn('[vc] backup alarm failed', err),
      );
  });
  void configureBackupAlarm().catch((err: unknown) =>
    console.warn('[vc] backup alarm failed', err),
  );
  // Fresh installs only (not updates) get the one-time welcome card in the panel.
  browser.runtime.onInstalled.addListener((d) => {
    if (d.reason === 'install') void browser.storage.local.set({ 'vc:welcome': 'pending' });
  });
  void refreshBackupBadge().catch(() => {});
  // Tabs that came due while the browser was closed reopen now; then arm the next alarm.
  void wakeDue()
    .then(scheduleSnoozeAlarm)
    .catch(() => {});

  const syncAlarm = 'vc-auto-sync';
  async function configureSyncAlarm(): Promise<void> {
    const prefs = (await settingsNow()).sync;
    const minutes = prefs.workspaces || prefs.sessions ? prefs.intervalMinutes : 0;
    const existing = await browser.alarms.get(syncAlarm);
    if (minutes === 0) {
      if (existing) await browser.alarms.clear(syncAlarm);
    } else if (existing?.periodInMinutes !== minutes) {
      await browser.alarms.create(syncAlarm, { periodInMinutes: minutes });
    }
  }
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SNOOZE_ALARM) void wakeDue().catch(() => {});
    if (alarm.name === BACKUP_ALARM) void runBackup(backupDeps).then(refreshBackupBadge);
    if (alarm.name === syncAlarm)
      void pins.loaded
        .then(() => publisher.auto())
        .catch((err: unknown) => console.warn('[vc] automatic sync failed', err));
  });
  void configureSyncAlarm().catch((err: unknown) => console.warn('[vc] sync alarm failed', err));
  // Saved sessions and the sync switches live outside the layouts. Other settings aren't
  // part of the document; a switch takes effect at once (off removes what was shared).
  let syncPrefs = '';
  void settingsNow().then((s) => {
    syncPrefs = JSON.stringify(s.sync);
    display.setMode(s.display.mode);
    tabRules = s.rules;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SESSIONS_KEY in changes) publisher.schedule();
    if (area === 'sync' && 'settings' in changes) {
      const settings = migrateSettings(changes.settings?.newValue);
      if (settings.display.mode !== display.mode) display.setMode(settings.display.mode);
      tabRules = settings.rules;
      const next = JSON.stringify(settings.sync);
      if (next === syncPrefs) return;
      const previous = syncPrefs
        ? (JSON.parse(syncPrefs) as { workspaces: boolean; sessions: boolean })
        : null;
      syncPrefs = next;
      void configureSyncAlarm().catch((err: unknown) =>
        console.warn('[vc] sync alarm failed', err),
      );
      if (
        previous &&
        (previous.workspaces !== settings.sync.workspaces ||
          previous.sessions !== settings.sync.sessions)
      )
        void publisher.now();
      else void publisher.schedule(true);
    }
  });
  void pins.loaded.then(() => publisher.schedule());
  const syncDeps: SyncCommandDeps = {
    publisher,
    pins,
    syncArea: browser.storage.sync,
    createWindow: () => browser.windows.create({ focused: true }) as Promise<{ id?: number }>,
    restoreSession: restoreSessionValue,
    keepSession: addSession,
    restoreDiscarded: async () => (await settingsNow()).sessions.restoreDiscarded,
  };
  const deps: CommandDeps = {
    windows: (scope, windowId) =>
      (scope === 'all' ? windowList.map((w) => w.id) : [windowId]).map((id) => store.snapshot(id)),
    tab: (id) => store.get(id),
    restoreDiscarded: async () => (await settingsNow()).sessions.restoreDiscarded,
    newTabUrl: async () => (await settingsNow()).tabs.newTabUrl,
    layouts: pins,
    chrome: { tabs: browser.tabs, windows: browser.windows },
  };

  const suspender = createSuspender(async () => {
    await ready;
    return windowList.map((w) => store.snapshot(w.id));
  });
  suspender.register();

  browser.runtime.onMessage.addListener((raw, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      !sender.url ||
      new URL(sender.url).protocol !== EXTENSION_SCHEME ||
      new URL(sender.url).pathname !== '/sidepanel.html'
    )
      return;
    if (raw?.type === 'relay') {
      if (!import.meta.env.FIREFOX) {
        respond({ ok: false, error: 'Relay is Firefox-only' });
        return;
      }
      void (async () => {
        const token = (await browser.storage.local.get(POPUP_TOKEN_KEY))[POPUP_TOKEN_KEY];
        const plan = planRelay(raw, sender, token);
        respond(
          'error' in plan
            ? { ok: false, error: plan.error }
            : await runRelay(plan, sender.tab?.windowId ?? -1),
        );
      })();
      return true;
    }
    if (raw?.type === 'importTabs') {
      const result = importTabs(raw);
      void result.then(respond);
      return true;
    }
    if (raw?.type === 'runBackup') {
      void runBackup(backupDeps, true).then((s) => {
        respond(s);
        void refreshBackupBadge();
      });
      return true;
    }
    if (raw?.type === 'restoreSessions') {
      // Same validation as sessions read from storage.
      const sessions = parseSessions(raw.sessions);
      void addSessions(sessions)
        .then((count) => ({ ok: true, count }))
        .catch(() => ({ ok: false, error: 'Couldn’t restore sessions' }))
        .then(respond);
      return true;
    }
    if (raw?.type !== 'backupLayouts' && raw?.type !== 'restoreBackupLayouts') return;
    void (async () => {
      try {
        await pins.loaded;
        if (raw.type === 'backupLayouts') return { ok: true, layouts: await pins.backupLayouts() };
        return { ok: true, count: await pins.restoreBackupLayouts(raw.layouts) };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Couldn’t back up or restore layouts',
        };
      }
    })().then(respond);
    return true;
  });

  /** A file from another tab manager → a saved session (Settings → Backup → Import). */
  async function importTabs(raw: {
    text?: unknown;
    name?: unknown;
  }): Promise<{ ok: boolean; count?: number; error?: string }> {
    if (typeof raw.text !== 'string' || raw.text.length > 10_000_000)
      return { ok: false, error: 'The file is too large or empty' };
    const win = parseImport(raw.text);
    if (!win) return { ok: false, error: 'No tabs found in this file' };
    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 100) : 'Imported';
    // Same validation as sessions read from storage or another device.
    const [session] = parseSessions([
      { id: 'import', name, createdAt: Date.now(), windows: [win] },
    ]);
    if (!session) return { ok: false, error: 'No tabs found in this file' };
    await addSession(session);
    return { ok: true, count: session.windows[0]?.tabs.length ?? 0 };
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT_NAME || port.sender?.id !== browser.runtime.id) return;

    port.onMessage.addListener(async (raw) => {
      const msg = parsePanelMessage(raw);
      if (!msg) return;
      if (msg.type === 'ping') {
        try {
          port.postMessage({ type: 'pong' } satisfies WorkerMessage);
        } catch {
          // Panel closed before the reply.
        }
        return;
      }
      if (msg.type === 'subscribe') {
        // Re-subscribing keeps a known kind (it can't change for a window); a new port is
        // unknown, hence sent nothing, until the window list has loaded.
        const surface = msg.surface ?? 'sidebar';
        subs.set(port, {
          windowId: msg.windowId,
          incognito: subs.get(port)?.incognito ?? null,
          surface,
        });
        await ready;
        await windowsReady;
        await pins.loaded;
        const incognito = windowIncognito(msg.windowId);
        subs.set(port, { windowId: msg.windowId, incognito, surface });
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
      await windowsReady;
      const sub = subs.get(port);
      const kind = sub ? (sub.incognito ?? windowIncognito(sub.windowId)) : null;
      if (
        crossesKind(
          msg,
          kind,
          (id) => store.get(id)?.incognito,
          (id) => windowList.find((w) => w.id === id)?.incognito,
          (id) => windowList.find((w) => store.groups(w.id).some((g) => g.id === id))?.incognito,
        )
      ) {
        console.warn('[vc] refused a panel command naming the other window kind:', msg.type);
        return;
      }
      try {
        const text = isPinMessage(msg)
          ? await runPinCommand(msg, pins, deps)
          : isSyncMessage(msg)
            ? await runSyncCommand(msg, syncDeps)
            : await runCommand(msg, deps);
        // Chrome retains a moved tab's opener, so edge drops explicitly detach it.
        if (msg.type === 'move') {
          await detachedReady;
          for (const id of msg.tabIds) detachedTabs.add(id);
          await saveDetached();
          markResync(msg.target.windowId);
        }
        // Chrome does not emit onUpdated for an opener-only change.
        if (msg.type === 'nestTab') {
          await detachedReady;
          detachedTabs.delete(msg.tabId);
          await saveDetached();
          markResync((await browser.tabs.get(msg.tabId)).windowId);
        }
        if (text) port.postMessage({ type: 'notice', level: 'info', text } satisfies WorkerMessage);
      } catch (err) {
        // Tabs can vanish between the click and the call; those failures are expected
        // noise and the panel converges through events. Session restores are reported.
        console.debug('[vc] command failed', msg.type, err);
        if (
          msg.type === 'reload' ||
          msg.type === 'restoreSession' ||
          msg.type === 'saveSession' ||
          msg.type === 'moveToNewWindow' ||
          msg.type === 'autoGroup' ||
          msg.type === 'setupOpen' ||
          isSyncMessage(msg)
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
        if (msg.type === 'autoGroup') markGroups({ windowId: msg.windowId });
      }
    });

    port.onDisconnect.addListener(() => {
      subs.delete(port);
    });
  });

  // --- Global shortcuts and context menus -------------------------------------------------

  /**
   * Opens the panel for a tab's window, as the Display setting says. Must run synchronously
   * in the gesture (sidePanel.open), before any await.
   */
  function openPanel(tab: TargetTab, toggle = false): void {
    void display.open(tab, { toggle, sidebarOpen: hasPanel(tab.windowId) });
  }

  async function activeTab(windowId?: number): Promise<TabInfo | undefined> {
    const [t] = await browser.tabs.query(
      windowId === undefined
        ? { active: true, lastFocusedWindow: true }
        : { active: true, windowId },
    );
    return t ? (browserTabInfo(t) ?? undefined) : undefined;
  }

  async function suspendFrom(tab: TabInfo | undefined, others: boolean): Promise<void> {
    if (!tab) return;
    if (others) await runCommand({ type: 'discardOthers', tabId: tab.id }, deps);
    else await runCommand({ type: 'discard', tabIds: [tab.id] }, deps);
  }

  const mru = createMruCycle();
  browser.commands.onCommand.addListener((command, tab) => {
    const windowId = tab?.windowId;
    switch (command) {
      case 'toggle-side-panel':
        // close() exists from Chrome 141; older versions can only open.
        if (tab && windowId !== undefined) openPanel(targetOf(tab), true);
        return;
      case 'focus-search': {
        if (!tab || windowId === undefined) return;
        const connected = [...subs].filter(([, s]) => s.windowId === windowId);
        if (!connected.length) {
          pendingFocus.add(windowId);
          openPanel(targetOf(tab));
        }
        for (const [port] of connected)
          port.postMessage({ type: 'focusSearch' } satisfies WorkerMessage);
        return;
      }
      case 'mru-back':
      case 'mru-forward': {
        if (windowId === undefined) return;
        void browser.tabs.query({ windowId }).then((tabs) => {
          const id = mru.next(windowId, tabs, Date.now(), command === 'mru-back' ? 1 : -1);
          if (id !== undefined) return browser.tabs.update(id, { active: true });
        });
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
    neverSuspend: async (tab) => {
      // The whitelist is in storage.sync: an incognito site must never reach it.
      if (tab.incognito) return;
      const s = await settingsNow();
      const host = hostOf(tab.url);
      if (!host || s.suspend.whitelist.includes(host)) return;
      s.suspend.whitelist = [...s.suspend.whitelist, host];
      await saveSettings(browser.storage.sync, migrateSettings(s));
    },
    saveWindow: async (windowId) => {
      const name = `Window · ${new Date().toLocaleString()}`;
      // E.g. an incognito window can't be saved; without a panel there is nowhere to say so.
      const text = await runCommand({ type: 'saveSession', scope: 'window', windowId, name }, deps);
      if (text) noticeTo(windowId, text);
    },
  });
}

function targetOf(tab: Browser.tabs.Tab): TargetTab {
  return { id: tab.id, windowId: tab.windowId, incognito: tab.incognito };
}
