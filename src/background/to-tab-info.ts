import type { Browser } from 'wxt/browser';
import { GROUP_COLORS, type GroupColor, type GroupInfo, type TabInfo } from '../shared/types';

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
    discarded: tab.discarded || tab.status === 'unloaded',
    loading: tab.status === 'loading',
    groupId: tab.groupId ?? -1,
    ...(tab.openerTabId === undefined ? {} : { openerTabId: tab.openerTabId }),
    incognito: tab.incognito,
  };
}

export function toGroupInfo(g: Browser.tabGroups.TabGroup): GroupInfo {
  return {
    id: g.id,
    windowId: g.windowId,
    title: g.title ?? '',
    // Newer Chrome versions may add colours; fall back rather than send an unknown one.
    color: GROUP_COLORS.includes(g.color as GroupColor) ? (g.color as GroupColor) : 'grey',
    collapsed: g.collapsed,
  };
}
