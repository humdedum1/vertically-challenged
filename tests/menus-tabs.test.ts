import { expect, it } from 'vitest';
import type { PanelMessage } from '../src/shared/protocol';
import { groupMenu, tabMenu } from '../src/sidepanel/model/menus';
import { group, tab } from './helpers';

it('offers grouping and adds the whole normal-tab selection to Staples', () => {
  const sent: PanelMessage[] = [];
  const tabs = [tab(7), tab(8), tab(9)];
  const items = tabMenu({
    target: tab(8),
    tabs,
    allTabs: tabs,
    groups: [],
    windows: [],
    homeWindowId: 1,
    whitelist: [],
    essentialsCount: 2,
    pinned: [],
    send: (message) => sent.push(message),
    onNewGroup: () => {},
    onWhitelist: () => {},
  });
  for (const label of ['Add to Staples', 'Group tabs by website']) {
    const entry = items.find((item) => item.type === 'item' && item.label === label);
    expect(entry?.type).toBe('item');
    if (entry?.type === 'item') entry.onselect();
  }
  expect(sent).toEqual([
    { type: 'pinTabs', tabIds: [7, 8, 9], windowId: 1, dest: { zone: 'essentials', index: 2 } },
    { type: 'autoGroup', windowId: 1 },
  ]);
});

it('suspends active and inactive tabs in the chosen group', () => {
  const sent: PanelMessage[] = [];
  const items = groupMenu({
    group: group(4),
    tabs: [tab(1, { groupId: 4, active: true }), tab(2, { groupId: 4 }), tab(3)],
    send: (message) => sent.push(message),
    onRename: () => {},
  });
  const entry = items.find((item) => item.type === 'item' && item.label === 'Suspend all');
  expect(entry?.type).toBe('item');
  if (entry?.type === 'item') {
    expect(entry.disabled).toBe(false);
    entry.onselect();
  }
  expect(sent).toEqual([{ type: 'discard', tabIds: [1, 2] }]);
});

it('disables group suspend when all group tabs are discarded', () => {
  const items = groupMenu({
    group: group(4),
    tabs: [tab(1, { groupId: 4, discarded: true }), tab(2)],
    send: () => {},
    onRename: () => {},
  });
  expect(items.find((item) => item.type === 'item' && item.label === 'Suspend all')).toMatchObject({
    disabled: true,
  });
});

it('pins the selected tabs directly into a nested folder', () => {
  const sent: PanelMessage[] = [];
  const items = tabMenu({
    target: tab(8),
    tabs: [tab(8), tab(9)],
    allTabs: [tab(8), tab(9)],
    essentialsCount: 0,
    groups: [],
    windows: [],
    homeWindowId: 1,
    whitelist: [],
    pinned: [
      {
        kind: 'folder',
        id: 'faaaaaaaaaa',
        name: 'Work',
        icon: 'work',
        collapsed: true,
        children: [
          {
            kind: 'folder',
            id: 'fbbbbbbbbbb',
            name: 'Research',
            icon: 'book',
            collapsed: true,
            children: [],
          },
        ],
      },
    ],
    send: (message) => sent.push(message),
    onNewGroup: () => {},
    onWhitelist: () => {},
  });
  const submenu = items.find((item) => item.type === 'submenu' && item.label === 'Pin to folder');
  expect(submenu?.type).toBe('submenu');
  if (submenu?.type !== 'submenu') return;
  const entry = submenu.items.find(
    (item) => item.type === 'item' && item.label === 'Work / Research',
  );
  expect(entry?.type).toBe('item');
  if (entry?.type === 'item') entry.onselect();
  expect(sent).toEqual([
    {
      type: 'pinTabs',
      tabIds: [8, 9],
      windowId: 1,
      dest: { zone: 'pinned', folderId: 'fbbbbbbbbbb', index: 0 },
    },
  ]);
});
