import type { Browser } from 'wxt/browser';
import type { TabInfo } from '../shared/types';

/** Returns null for tabs without an id (devtools windows, some session-restore states). */
export function toTabInfo(tab: Browser.tabs.Tab): TabInfo | null {
  if (tab.id === undefined || tab.id < 0) return null;
  return {
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title || tab.pendingUrl || tab.url || 'Untitled',
    url: tab.url || tab.pendingUrl || '',
    pinned: tab.pinned,
    active: tab.active,
    audible: tab.audible ?? false,
    muted: tab.mutedInfo?.muted ?? false,
    discarded: tab.discarded,
    loading: tab.status === 'loading',
    groupId: tab.groupId ?? -1,
    incognito: tab.incognito,
  };
}
