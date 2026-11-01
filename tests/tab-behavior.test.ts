import { beforeEach, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { type CommandDeps, runCommand } from '../src/background/commands';
import { toTabInfo } from '../src/background/to-tab-info';
import { tab } from './helpers';

const api = vi.hoisted(() => ({
  tabs: { query: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), get: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: api }));
beforeEach(() => vi.resetAllMocks());

it('appends a new tab at the bottom regardless of the active tab', async () => {
  api.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await runCommand({ type: 'newTab', windowId: 1, afterTabId: null }, {} as CommandDeps);
  expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, index: 3 });
});

it('shows a lazily restored tab as suspended', () => {
  expect(
    toTabInfo({ ...tab(2), discarded: false, status: 'unloaded' } as unknown as Browser.tabs.Tab)
      ?.discarded,
  ).toBe(true);
});

it('selects the most recently used loaded survivor before closing the active tab', async () => {
  api.tabs.get.mockResolvedValue({ id: 3, windowId: 1 });
  api.tabs.query.mockResolvedValue([
    { id: 1, windowId: 1, lastAccessed: 20 },
    { id: 2, windowId: 1, lastAccessed: 30, discarded: true },
    { id: 3, windowId: 1, active: true, lastAccessed: 40 },
    { id: 4, windowId: 1, lastAccessed: 10 },
  ]);
  await runCommand({ type: 'close', tabIds: [3] }, {} as CommandDeps);
  expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(api.tabs.update.mock.invocationCallOrder[0]).toBeLessThan(
    api.tabs.remove.mock.invocationCallOrder[0] ?? 0,
  );
});

it('does not switch tabs when closing only background tabs', async () => {
  api.tabs.get.mockResolvedValue({ id: 2, windowId: 1 });
  api.tabs.query.mockResolvedValue([{ id: 1, active: true }, { id: 2 }]);
  await runCommand({ type: 'close', tabIds: [2] }, {} as CommandDeps);
  expect(api.tabs.update).not.toHaveBeenCalled();
  expect(api.tabs.remove).toHaveBeenCalledWith([2]);
});

it('lets Chrome choose when every surviving tab is suspended', async () => {
  api.tabs.get.mockResolvedValue({ id: 3, windowId: 1 });
  api.tabs.query.mockResolvedValue([
    { id: 1, discarded: true },
    { id: 2, status: 'unloaded' },
    { id: 3, active: true },
  ]);
  await runCommand({ type: 'close', tabIds: [3] }, {} as CommandDeps);
  expect(api.tabs.update).not.toHaveBeenCalled();
  expect(api.tabs.remove).toHaveBeenCalledWith([3]);
});

it('excludes every tab in a bulk close when selecting a survivor', async () => {
  api.tabs.get.mockImplementation(async (id) => ({ id, windowId: 1 }));
  api.tabs.query.mockResolvedValue([
    { id: 1, lastAccessed: 10 },
    { id: 2, lastAccessed: 30 },
    { id: 3, active: true, lastAccessed: 40 },
  ]);
  await runCommand({ type: 'close', tabIds: [2, 3] }, {} as CommandDeps);
  expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(api.tabs.remove).toHaveBeenCalledWith([2, 3]);
});
