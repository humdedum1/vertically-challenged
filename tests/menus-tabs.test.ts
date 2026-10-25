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

it('suspends only inactive tabs in the chosen group', () => {
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
  expect(sent).toEqual([{ type: 'discard', tabIds: [2] }]);
});

it('disables group suspend when no inactive tabs remain', () => {
  const items = groupMenu({
    group: group(4),
    tabs: [tab(1, { groupId: 4, active: true }), tab(2)],
    send: () => {},
    onRename: () => {},
  });
  expect(items.find((item) => item.type === 'item' && item.label === 'Suspend all')).toMatchObject({
    disabled: true,
  });
});
