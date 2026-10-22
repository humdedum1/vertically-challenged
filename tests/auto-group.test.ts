import { beforeEach, expect, it, vi } from 'vitest';
import { type CommandDeps, runCommand } from '../src/background/commands';
import { parsePanelMessage } from '../src/shared/protocol';

const api = vi.hoisted(() => ({
  tabs: { query: vi.fn(), group: vi.fn() },
  tabGroups: { update: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: api }));

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.group.mockResolvedValue(42);
});

it('validates the window-scoped command', () => {
  expect(parsePanelMessage({ type: 'autoGroup', windowId: 2 })).toEqual({
    type: 'autoGroup',
    windowId: 2,
  });
  for (const windowId of [-1, '2', null, undefined]) {
    expect(parsePanelMessage({ type: 'autoGroup', windowId })).toBeNull();
  }
});

it('groups same-site tabs locally, preserving pinned tabs, existing groups and singletons', async () => {
  api.tabs.query.mockResolvedValue([
    { id: 1, url: 'https://www.example.com/a', groupId: -1 },
    { id: 2, url: 'http://example.com/b', groupId: -1 },
    { id: 3, url: 'https://example.com/pinned', groupId: -1, pinned: true },
    { id: 4, url: 'https://example.com/grouped', groupId: 7 },
    { id: 5, url: 'https://other.example.com/', groupId: -1 },
    { id: 6, url: 'chrome://settings', groupId: -1 },
    { id: 7, url: 'invalid', groupId: -1 },
  ]);
  expect(await runCommand({ type: 'autoGroup', windowId: 2 }, {} as CommandDeps)).toBe(
    'Grouped 2 tabs into 1 website group',
  );
  expect(api.tabs.query).toHaveBeenCalledWith({ windowId: 2 });
  expect(api.tabs.group).toHaveBeenCalledExactlyOnceWith({
    tabIds: [1, 2],
    createProperties: { windowId: 2 },
  });
  expect(api.tabGroups.update).toHaveBeenCalledWith(42, { title: 'example.com' });
});

it('reports when there are no matching tabs', async () => {
  api.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com', groupId: -1 }]);
  expect(await runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps)).toBe(
    'No ungrouped websites with multiple tabs',
  );
  expect(api.tabs.group).not.toHaveBeenCalled();
});

it('propagates browser errors to the existing command error handler', async () => {
  api.tabs.query.mockRejectedValue(new Error('Window closed'));
  await expect(runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps)).rejects.toThrow(
    'Window closed',
  );
});

it('does not overlap grouping requests for the same window', async () => {
  let release = () => {};
  api.tabs.query.mockReturnValue(
    new Promise((resolve) => {
      release = () => resolve([]);
    }),
  );
  const first = runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps);
  const second = runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps);
  release();
  await Promise.all([first, second]);
  expect(api.tabs.query).toHaveBeenCalledTimes(1);
});

it('allows another grouping attempt after an error', async () => {
  api.tabs.query.mockRejectedValueOnce(new Error('Window closed')).mockResolvedValueOnce([]);
  await expect(runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps)).rejects.toThrow();
  expect(await runCommand({ type: 'autoGroup', windowId: 1 }, {} as CommandDeps)).toBe(
    'No ungrouped websites with multiple tabs',
  );
});
