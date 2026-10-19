import { browser } from 'wxt/browser';
import type { TabInfo } from '../shared/types';
import { toTabInfo } from './to-tab-info';

interface MenuActions {
  openPanel(windowId: number): void;
  suspend(tab: TabInfo, others: boolean): void;
  neverSuspend(url: string): Promise<void>;
  saveWindow(windowId: number): Promise<void>;
}

const ITEMS = [
  { id: 'vc-open', title: 'Open vertical tabs', contexts: ['action'] },
  { id: 'vc-suspend', title: 'Suspend this tab', contexts: ['page', 'action'] },
  {
    id: 'vc-suspend-others',
    title: 'Suspend other tabs in this window',
    contexts: ['page', 'action'],
  },
  { id: 'vc-never-suspend', title: 'Never auto-suspend this site', contexts: ['page', 'action'] },
  { id: 'vc-save-window', title: 'Save window as session', contexts: ['page', 'action'] },
] as const;

/**
 * Chrome's own right-click menus (page and toolbar icon). Items persist across worker
 * restarts, so they're (re)created only on install/update; the click listener is
 * registered on every start, synchronously, as MV3 requires.
 */
export function registerContextMenus(actions: MenuActions): void {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.removeAll(() => {
      for (const item of ITEMS) {
        browser.contextMenus.create({
          id: item.id,
          title: item.title,
          contexts: [...item.contexts],
        });
      }
    });
  });

  browser.contextMenus.onClicked.addListener((info, raw) => {
    const tab = raw ? toTabInfo(raw) : null;
    if (info.menuItemId === 'vc-open') {
      // Must stay synchronous: sidePanel.open needs the click's user gesture.
      if (raw?.windowId !== undefined) actions.openPanel(raw.windowId);
      return;
    }
    if (!tab) return;
    switch (info.menuItemId) {
      case 'vc-suspend':
        actions.suspend(tab, false);
        return;
      case 'vc-suspend-others':
        actions.suspend(tab, true);
        return;
      case 'vc-never-suspend':
        void actions.neverSuspend(tab.url);
        return;
      case 'vc-save-window':
        void actions.saveWindow(tab.windowId);
        return;
    }
  });
}
