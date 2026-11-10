import { beforeEach, expect, it, vi } from 'vitest';
import { SNOOZE_KEY } from '../src/shared/snooze';

const store: Record<string, unknown> = {};
const api = {
  storage: {
    local: {
      get: async (k: string) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
      set: async (items: Record<string, unknown>) =>
        void Object.assign(store, structuredClone(items)),
    },
  },
  tabs: { create: vi.fn(), remove: vi.fn(), get: vi.fn() },
  alarms: { clear: vi.fn(async () => true), create: vi.fn(async () => {}) },
};
vi.mock('wxt/browser', () => ({ browser: api }));
const { snoozeTabs, wakeDue, wakeNow } = await import('../src/background/snooze');

const entry = (id: string, wakeAt = 1) => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  wakeAt,
  snoozedAt: 0,
});
const stored = () => (store[SNOOZE_KEY] as { id: string }[]).map((s) => s.id);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  api.tabs.create.mockReset();
  api.tabs.remove.mockReset();
  api.tabs.get.mockReset();
});

it('keeps a due entry whose tab could not be created', async () => {
  store[SNOOZE_KEY] = [entry('a'), entry('b')];
  api.tabs.create.mockImplementation(async ({ url }: { url: string }) => {
    if (url.endsWith('/b')) throw new Error('worker gone');
    return { id: 1 };
  });
  await wakeDue().catch(() => {});
  expect(stored()).toEqual(['b']);
});

it('wakeNow keeps the entry when its tab could not be created', async () => {
  store[SNOOZE_KEY] = [entry('a', Date.now() + 1e9)];
  api.tabs.create.mockRejectedValue(new Error('no'));
  await wakeNow('a').catch(() => {});
  expect(stored()).toEqual(['a']);
});

it('removes an entry only after its tab exists', async () => {
  store[SNOOZE_KEY] = [entry('a')];
  let seenDuringCreate: string[] = [];
  api.tabs.create.mockImplementation(async () => {
    seenDuringCreate = stored();
    return { id: 1 };
  });
  await wakeDue();
  expect(seenDuringCreate).toEqual(['a']);
  expect(stored()).toEqual([]);
});

it('a tab that failed to close but is still open loses its entry (no duplicate)', async () => {
  api.tabs.remove.mockImplementation(async (ids: number | number[]) => {
    if ((Array.isArray(ids) ? ids : [ids]).includes(2))
      throw new Error('Tabs cannot be edited right now');
  });
  api.tabs.get.mockImplementation(async (id: number) => ({ id }));
  await snoozeTabs([tab(1), tab(2)] as never, Date.now() + 1e9);
  expect(urls()).toEqual(['https://example.com/t1']);
});

it('a tab that failed to close because it is already gone keeps its entry (no loss)', async () => {
  api.tabs.remove.mockImplementation(async (ids: number | number[]) => {
    if ((Array.isArray(ids) ? ids : [ids]).includes(2)) throw new Error('No tab with id: 2');
  });
  api.tabs.get.mockRejectedValue(new Error('No tab with id: 2'));
  await snoozeTabs([tab(1), tab(2)] as never, Date.now() + 1e9);
  expect(urls()).toEqual(['https://example.com/t1', 'https://example.com/t2']);
});

const tab = (id: number) => ({
  id,
  url: `https://example.com/t${id}`,
  title: `t${id}`,
  incognito: false,
});
const urls = () => (store[SNOOZE_KEY] as { url: string }[]).map((s) => s.url);
