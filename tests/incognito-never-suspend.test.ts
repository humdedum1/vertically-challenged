import { beforeEach, expect, it, vi } from 'vitest';
import type { MenuItem } from '../src/sidepanel/components/menu-types';
import { tabMenu } from '../src/sidepanel/model/menus';
import { tab } from './helpers';

const clicked: ((info: { menuItemId: string }, raw: unknown) => void)[] = [];
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onInstalled: { addListener: () => {} } },
    contextMenus: { onClicked: { addListener: (fn: (typeof clicked)[0]) => clicked.push(fn) } },
  },
}));
const { registerContextMenus } = await import('../src/background/context-menus');

beforeEach(() => {
  clicked.length = 0;
});

function neverSuspendItem(incognito: boolean) {
  const added: string[] = [];
  const t = tab(1, { incognito });
  const items: MenuItem[] = tabMenu({
    target: t,
    tabs: [t],
    allTabs: [t],
    groups: [],
    windows: [],
    homeWindowId: 1,
    whitelist: [],
    essentialsCount: 0,
    pinned: [],
    send: () => {},
    onNewGroup: () => {},
    onWhitelist: (host) => added.push(host),
  });
  const item = items.find((i) => i.type === 'item' && /auto-suspend this site/i.test(i.label));
  return { item, added };
}

it('panel menu: an incognito tab cannot be added to the synced never-suspend list', () => {
  const { item, added } = neverSuspendItem(true);
  expect(item?.type === 'item' && item.disabled).toBe(true);
  if (item?.type === 'item') item.onselect();
  expect(added).toEqual([]);
});

it('panel menu: a normal tab still can', () => {
  const { item, added } = neverSuspendItem(false);
  if (item?.type === 'item') item.onselect();
  expect(added).toEqual(['example.com']);
});

it("Chrome's page menu: never-suspend on an incognito tab writes nothing", () => {
  const neverSuspend = vi.fn(async () => {});
  registerContextMenus({
    openPanel: () => {},
    suspend: () => {},
    neverSuspend,
    saveWindow: async () => {},
  });
  const raw = {
    id: 5,
    windowId: 2,
    url: 'https://secret.example/',
    title: 's',
    index: 0,
    pinned: false,
    active: true,
    incognito: true,
    highlighted: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
  };
  for (const fn of clicked) fn({ menuItemId: 'vc-never-suspend' }, raw);
  expect(neverSuspend).not.toHaveBeenCalled();
  for (const fn of clicked) fn({ menuItemId: 'vc-never-suspend' }, { ...raw, incognito: false });
  expect(neverSuspend).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://secret.example/' }),
  );
});
