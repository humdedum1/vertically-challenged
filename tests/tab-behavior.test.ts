import { beforeEach, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { type CommandDeps, runCommand } from '../src/background/commands';
import { toTabInfo } from '../src/background/to-tab-info';
import { tab } from './helpers';

const api = vi.hoisted(() => ({
  tabs: {
    query: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    discard: vi.fn(),
  },
}));
vi.mock('wxt/browser', () => ({ browser: api }));
beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.discard.mockResolvedValue(undefined);
});

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

it('switches to the last selected tab before suspending the active tab', async () => {
  api.tabs.query.mockResolvedValue([
    { id: 1, lastAccessed: 20 },
    { id: 2, lastAccessed: 30 },
    { id: 3, active: true, lastAccessed: 40 },
  ]);
  const current = tab(3, { active: true });
  await runCommand({ type: 'discard', tabIds: [3] }, {
    tab: () => current,
  } as unknown as CommandDeps);
  expect(api.tabs.update).toHaveBeenCalledWith(2, { active: true });
  expect(api.tabs.discard).toHaveBeenCalledWith(3);
  expect(api.tabs.update.mock.invocationCallOrder[0]).toBeLessThan(
    api.tabs.discard.mock.invocationCallOrder[0] ?? 0,
  );
});

it('opens a new tab before suspending the only tab', async () => {
  api.tabs.query.mockResolvedValue([{ id: 3, active: true }]);
  await runCommand({ type: 'discard', tabIds: [3] }, {
    tab: () => tab(3, { active: true }),
  } as unknown as CommandDeps);
  expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, active: true });
  expect(api.tabs.discard).toHaveBeenCalledWith(3);
});

it('keeps every selected tab out of the suspension fallback', async () => {
  api.tabs.query.mockResolvedValue([
    { id: 1, lastAccessed: 10 },
    { id: 2, lastAccessed: 30 },
    { id: 3, active: true, lastAccessed: 40 },
  ]);
  await runCommand({ type: 'discard', tabIds: [2, 3] }, {
    tab: (id: number) => tab(id, { active: id === 3 }),
  } as unknown as CommandDeps);
  expect(api.tabs.update).toHaveBeenCalledWith(1, { active: true });
  expect(api.tabs.discard.mock.calls).toEqual([[2], [3]]);
});

it('does not discard the current tab if switching away fails', async () => {
  api.tabs.query.mockResolvedValue([{ id: 1 }, { id: 3, active: true }]);
  api.tabs.update.mockRejectedValue(new Error('Tab closed'));
  await expect(
    runCommand({ type: 'discard', tabIds: [3] }, {
      tab: () => tab(3, { active: true }),
    } as unknown as CommandDeps),
  ).rejects.toThrow('Tab closed');
  expect(api.tabs.discard).not.toHaveBeenCalled();
});
