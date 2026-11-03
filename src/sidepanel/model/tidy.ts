import { hostOf } from '../../shared/host-pattern';
import type { TabInfo } from '../../shared/types';

export interface TidyGroup {
  host: string;
  tabs: TabInfo[];
}

const DAY = 86_400_000;

/**
 * Tabs you have not touched for `days`, grouped by site, biggest group first. Pinned tabs, the
 * current tab, tabs playing sound, incognito tabs and tabs with no last-used time are never
 * offered, so nothing you might be using shows up here.
 */
export function staleByHost(tabs: readonly TabInfo[], now: number, days: number): TidyGroup[] {
  const cutoff = now - days * DAY;
  const by = new Map<string, TabInfo[]>();
  for (const t of tabs) {
    if (t.pinned || t.active || t.audible || t.incognito) continue;
    if (t.lastAccessed === undefined || t.lastAccessed > cutoff) continue;
    const host = hostOf(t.url) || 'Other pages';
    by.set(host, [...(by.get(host) ?? []), t]);
  }
  return [...by.entries()]
    .map(([host, list]) => ({
      host,
      tabs: list.sort((a, b) => (a.lastAccessed ?? 0) - (b.lastAccessed ?? 0)),
    }))
    .sort((a, b) => b.tabs.length - a.tabs.length || a.host.localeCompare(b.host));
}
