import { browser } from 'wxt/browser';
import { migrateSettings } from '../../settings/migrate';
import type { Settings } from '../../settings/schema';
import type { GroupInfo, TabInfo } from '../../shared/types';
import { archiveTabs } from '../sessions';
import { autoSuspendDecision, shouldArchive } from './eligibility';
import { LastActive } from './last-active';

const ALARM = 'vc-auto-suspend';
const KEY = 'lastActive';

/**
 * Auto-suspend. Driven by a 1-minute chrome.alarms tick, because the worker is shut down
 * after ~30 s idle and timers don't survive that; alarms do, and wake the worker.
 * "Suspend" is Chrome's native discard: memory is freed, the tab stays in the strip and
 * reloads when activated, so no placeholder page (and no host permission) is needed.
 */
export function createSuspender(
  liveWindows: () => Promise<{ tabs: TabInfo[]; groups: GroupInfo[] }[]>,
) {
  const last = new LastActive(
    async () => (await browser.storage.session.get(KEY))[KEY] as Record<string, number> | undefined,
    (v) => browser.storage.session.set({ [KEY]: v }),
  );
  const loaded = last.load().catch(() => {});
  let settings: Settings | null = null;

  async function getSettings(): Promise<Settings> {
    if (!settings)
      settings = migrateSettings((await browser.storage.sync.get('settings')).settings);
    return settings;
  }

  async function syncAlarm(): Promise<void> {
    const s = await getSettings();
    const existing = await browser.alarms.get(ALARM);
    const on = s.suspend.auto || s.suspend.archiveDays > 0;
    if (on && !existing) await browser.alarms.create(ALARM, { periodInMinutes: 1 });
    if (!on && existing) await browser.alarms.clear(ALARM);
  }

  async function tick(): Promise<void> {
    await loaded;
    const s = await getSettings();
    const windows = await liveWindows();
    const tabs = windows.flatMap((w) => w.tabs);
    const now = Date.now();
    last.retain(new Set(tabs.map((t) => t.id)));
    for (const tab of tabs) {
      // Active tabs are in use right now; keep their clock current.
      if (tab.active) last.touch(tab.id, now);
      else last.seen(tab.id, now);
    }
    if (s.suspend.auto) {
      for (const tab of tabs) {
        if (autoSuspendDecision(tab, last.get(tab.id), now, s.suspend) !== 'suspend') continue;
        // The tab may have been activated or closed since the query; Chrome rejects those.
        await browser.tabs.discard(tab.id).catch(() => {});
      }
    }
    await last.flush();
    if (s.suspend.archiveDays > 0) await archive(windows, now, s);
  }

  /** Saves old tabs to the Archived tabs session, then closes them; never closes unsaved. */
  async function archive(
    windows: { tabs: TabInfo[]; groups: GroupInfo[] }[],
    now: number,
    s: Settings,
  ): Promise<void> {
    const old = windows
      .map((w) => ({
        groups: w.groups,
        tabs: w.tabs.filter((t) =>
          shouldArchive(t, now, s.suspend.archiveDays, s.suspend.whitelist),
        ),
      }))
      .filter((w) => w.tabs.length > 0);
    if (!old.length) return;
    await archiveTabs(old);
    const ids = old.flatMap((w) => w.tabs.map((t) => t.id));
    // A tab activated since the snapshot is in use again; keep it (it stays archived too).
    const live = await browser.tabs.query({ active: true });
    const keep = new Set(live.map((t) => t.id));
    const close = ids.filter((id) => !keep.has(id));
    if (close.length) await browser.tabs.remove(close).catch(() => {});
  }

  return {
    /** Must be called synchronously at worker start-up (listener registration). */
    register(): void {
      browser.alarms.onAlarm.addListener((a) => {
        if (a.name === ALARM)
          void tick().catch((err: unknown) => console.warn('[vc] suspend tick', err));
      });
      browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.settings) return;
        settings = migrateSettings(changes.settings.newValue);
        void syncAlarm();
      });
      void syncAlarm().catch(() => {});
    },
    /** The tab that just lost focus stops ageing from now; the new one is in use. */
    onActivated(tabId: number, previousTabId: number | undefined): void {
      const now = Date.now();
      if (previousTabId !== undefined) last.touch(previousTabId, now);
      last.touch(tabId, now);
      void loaded.then(() => last.flush()).catch(() => {});
    },
    onRemoved(tabId: number): void {
      last.forget(tabId);
    },
  };
}
