import { browser } from 'wxt/browser';
import { migrateSettings } from '../../settings/migrate';
import type { Settings } from '../../settings/schema';
import type { TabInfo } from '../../shared/types';
import { autoSuspendDecision } from './eligibility';
import { LastActive } from './last-active';

const ALARM = 'vc-auto-suspend';
const KEY = 'lastActive';

/**
 * Auto-suspend. Driven by a 1-minute chrome.alarms tick, because the worker is shut down
 * after ~30 s idle and timers don't survive that; alarms do, and wake the worker.
 * "Suspend" is Chrome's native discard: memory is freed, the tab stays in the strip and
 * reloads when activated, so no placeholder page (and no host permission) is needed.
 */
export function createSuspender(liveTabs: () => Promise<TabInfo[]>) {
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
    if (s.suspend.auto && !existing) await browser.alarms.create(ALARM, { periodInMinutes: 1 });
    if (!s.suspend.auto && existing) await browser.alarms.clear(ALARM);
  }

  async function tick(): Promise<void> {
    await loaded;
    const s = await getSettings();
    const tabs = await liveTabs();
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
