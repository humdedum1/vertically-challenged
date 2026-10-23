import { beforeEach, expect, it, vi } from 'vitest';
import { placeChildTab } from '../src/background/child-tabs';

const api = vi.hoisted(() => ({
  storage: { sync: { get: vi.fn() } },
  tabs: { query: vi.fn(), move: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: api }));
const parent = {
  id: 1,
  index: 0,
  windowId: 1,
  url: 'https://example.com',
  pinned: false,
  groupId: -1,
};
const child = { ...parent, id: 3, index: 2, openerTabId: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  api.storage.sync.get.mockResolvedValue({});
  api.tabs.query.mockResolvedValue([parent, { ...parent, id: 2, index: 1 }, child]);
});

it('places a link tab opened at the end next to its opener branch', async () => {
  await placeChildTab(child);
  expect(api.tabs.move).toHaveBeenCalledWith(3, { index: 1 });
});

it('keeps existing descendants together and leaves correctly placed children alone', async () => {
  api.tabs.query.mockResolvedValue([parent, { ...parent, id: 2, index: 1, openerTabId: 1 }, child]);
  await placeChildTab(child);
  expect(api.tabs.move).not.toHaveBeenCalled();
});

it('does nothing when disabled, no opener is reported, or the parent is pinned', async () => {
  api.storage.sync.get.mockResolvedValue({ settings: { tabs: { childTabs: false } } });
  await placeChildTab(child);
  expect(api.tabs.query).not.toHaveBeenCalled();
  api.storage.sync.get.mockResolvedValue({});
  await placeChildTab(parent);
  expect(api.tabs.query).not.toHaveBeenCalled();
  api.tabs.query.mockResolvedValue([{ ...parent, pinned: true }, child]);
  await placeChildTab(child);
  expect(api.tabs.move).not.toHaveBeenCalled();
});

it('leaves other native groups and closed openers alone', async () => {
  api.tabs.query.mockResolvedValue([{ ...parent, groupId: 9 }, child]);
  await placeChildTab(child);
  api.tabs.query.mockResolvedValue([child]);
  await placeChildTab(child);
  expect(api.tabs.move).not.toHaveBeenCalled();
});
