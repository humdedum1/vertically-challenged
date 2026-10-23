import { expect, it, vi } from 'vitest';
import { type CommandDeps, runCommand } from '../src/background/commands';
import { parsePanelMessage } from '../src/shared/protocol';
import { tabMenu } from '../src/sidepanel/model/menus';
import { tab } from './helpers';

const api = vi.hoisted(() => ({ tabs: { reload: vi.fn() } }));
vi.mock('wxt/browser', () => ({ browser: api }));

it('validates reload tab ids', () => {
  expect(parsePanelMessage({ type: 'reload', tabIds: [7, 8] })).toEqual({
    type: 'reload',
    tabIds: [7, 8],
  });
  for (const tabIds of [[], [-1], ['7'], null]) {
    expect(parsePanelMessage({ type: 'reload', tabIds })).toBeNull();
  }
});

it('reloads every selected tab using normal browser reload', async () => {
  await runCommand({ type: 'reload', tabIds: [7, 8] }, {} as CommandDeps);
  expect(api.tabs.reload.mock.calls).toEqual([[7], [8]]);
});

it('offers reload for the tab selection', () => {
  const send = vi.fn();
  const tabs = [tab(7), tab(8)];
  const items = tabMenu({
    target: tab(7),
    tabs,
    allTabs: tabs,
    groups: [],
    windows: [],
    homeWindowId: 1,
    whitelist: [],
    essentialsCount: 0,
    send,
    onNewGroup: () => {},
    onWhitelist: () => {},
  });
  const reload = items.find((item) => item.type === 'item' && item.label === 'Reload (2)');
  expect(reload?.type).toBe('item');
  if (reload?.type === 'item') reload.onselect();
  expect(send).toHaveBeenCalledWith({ type: 'reload', tabIds: [7, 8] });
});
