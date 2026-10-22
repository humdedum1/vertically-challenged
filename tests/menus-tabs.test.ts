import { expect, it } from 'vitest';
import type { PanelMessage } from '../src/shared/protocol';
import { tabMenu } from '../src/sidepanel/model/menus';
import { tab } from './helpers';

it('offers grouping and adds the whole normal-tab selection to Essentials', () => {
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
  for (const label of ['Add to Essentials', 'Group tabs by website']) {
    const entry = items.find((item) => item.type === 'item' && item.label === label);
    expect(entry?.type).toBe('item');
    if (entry?.type === 'item') entry.onselect();
  }
  expect(sent).toEqual([
    { type: 'pinTabs', tabIds: [7, 8, 9], windowId: 1, dest: { zone: 'essentials', index: 2 } },
    { type: 'autoGroup', windowId: 1 },
  ]);
});
