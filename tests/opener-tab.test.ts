import { expect, it } from 'vitest';
import type { Browser } from 'wxt/browser';
import { tabsEqual } from '../src/background/tab-store';
import { toTabInfo } from '../src/background/to-tab-info';
import { tab } from './helpers';

it('carries the browser opener into the panel and detects relationship changes', () => {
  const info = toTabInfo({ ...tab(2), openerTabId: 1 } as unknown as Browser.tabs.Tab);
  expect(info?.openerTabId).toBe(1);
  expect(tabsEqual(tab(2), tab(2, { openerTabId: 1 }))).toBe(false);
  expect(tabsEqual(tab(2, { openerTabId: 1 }), tab(2, { openerTabId: 1 }))).toBe(true);
});
