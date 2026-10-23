import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type CommandDeps, runCommand } from '../src/background/commands';
import { parsePanelMessage } from '../src/shared/protocol';
import { tabMenu } from '../src/sidepanel/model/menus';
import { tab } from './helpers';

const api = vi.hoisted(() => ({
  tabs: {
    reload: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
  },
}));
vi.mock('wxt/browser', () => ({ browser: api }));

let listeners: Set<(id: number, change: { status?: string; title?: string }) => void>;
const updated = (id: number, change: { status?: string; title?: string }) => {
  for (const listener of listeners) listener(id, change);
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  listeners = new Set();
  api.tabs.onUpdated.addListener.mockImplementation((listener) => listeners.add(listener));
  api.tabs.onUpdated.removeListener.mockImplementation((listener) => listeners.delete(listener));
  api.tabs.reload.mockImplementation(async (id: number) => updated(id, { status: 'loading' }));
});
afterEach(() => {
  expect(listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

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

it('retries once when an accepted reload silently does nothing', async () => {
  api.tabs.reload.mockResolvedValueOnce(undefined);
  const result = runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps);
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(api.tabs.reload.mock.calls).toEqual([[7], [7]]);
});

it('retries when the browser never answers the first reload call', async () => {
  api.tabs.reload.mockReturnValueOnce(new Promise(() => {}));
  const result = runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps);
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(api.tabs.reload.mock.calls).toEqual([[7], [7]]);
});

it('reports two silent attempts without retrying indefinitely', async () => {
  api.tabs.reload.mockResolvedValue(undefined);
  const result = runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps);
  const rejected = expect(result).rejects.toThrow('did not report a reload');
  await vi.advanceTimersByTimeAsync(4000);
  await rejected;
  expect(api.tabs.reload).toHaveBeenCalledTimes(2);
});

it('waits for delayed progress without reloading a healthy tab twice', async () => {
  api.tabs.reload.mockImplementation(async (id: number) => {
    setTimeout(() => updated(id, { status: 'complete' }), 1000);
  });
  const result = runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps);
  await vi.advanceTimersByTimeAsync(1000);
  await result;
  expect(api.tabs.reload).toHaveBeenCalledExactlyOnceWith(7);
});

it('ignores status events for other tabs and unrelated changes on the target', async () => {
  api.tabs.reload.mockImplementationOnce(async () => {
    updated(8, { status: 'loading' });
    updated(7, { title: 'Changed title' });
  });
  const result = runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps);
  await vi.advanceTimersByTimeAsync(2000);
  await result;
  expect(api.tabs.reload).toHaveBeenCalledTimes(2);
});

it('preserves browser errors and removes its listener', async () => {
  api.tabs.reload.mockRejectedValue(new Error('Tab closed'));
  await expect(runCommand({ type: 'reload', tabIds: [7] }, {} as CommandDeps)).rejects.toThrow(
    'Tab closed',
  );
  expect(api.tabs.reload).toHaveBeenCalledExactlyOnceWith(7);
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
