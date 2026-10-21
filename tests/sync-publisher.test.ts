import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSyncPublisher,
  DEVICE_KEY,
  SYNC_STATUS_KEY,
  type SyncStatus,
} from '../src/background/sync/publisher';
import type { WindowLayout } from '../src/shared/layout';
import type { Session } from '../src/shared/sessions';
import { SYNC_ITEM_QUOTA, type SyncWorkspace, savedFromLayout } from '../src/shared/sync';
import { readSync } from '../src/shared/sync-store';

function area(init: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(structuredClone(init)));
  let writes = 0;
  return {
    data,
    writes: () => writes,
    async get(keys: string | null) {
      if (keys === null) return Object.fromEntries(structuredClone([...data]));
      return data.has(keys) ? { [keys]: structuredClone(data.get(keys)) } : {};
    },
    async set(items: Record<string, unknown>) {
      writes++;
      for (const [k, v] of Object.entries(items)) {
        if (JSON.stringify(v).length + k.length > SYNC_ITEM_QUOTA)
          throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
        data.set(k, structuredClone(v));
      }
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
    },
  };
}

const layout = (id: string, n: number): WindowLayout => ({
  id,
  name: null,
  essentials: Array.from({ length: n }, (_, i) => ({
    kind: 'item' as const,
    id: `i${id}${i}`,
    homeUrl: `https://site${i}.example/`,
    lastUrl: `https://site${i}.example/`,
    title: `Site ${i}`,
    tabId: i,
  })),
  pinned: [],
  collapsed: [],
  incognito: false,
  lastUsed: 1,
});
const ws = (id: string, n = 3): SyncWorkspace => ({
  id,
  name: `W ${id}`,
  kind: 'window',
  lastUsed: 1,
  window: savedFromLayout(layout(id, n)),
});
const session = (id: string, tabs: number): Session => ({
  id,
  name: id,
  createdAt: 1,
  windows: [
    {
      tabs: Array.from({ length: tabs }, (_, i) => ({
        url: `https://e.com/${id}/${i}/${Math.random()}`,
        title: `t${i}`,
        pinned: false,
        group: null,
      })),
      groups: [],
    },
  ],
});

function setup(
  o: {
    workspaces?: SyncWorkspace[];
    sessions?: Session[];
    prefs?: { workspaces: boolean; sessions: boolean };
    sync?: Record<string, unknown>;
  } = {},
) {
  const sync = area(o.sync);
  const local = area();
  let clock = 1_000_000_000_000;
  const state = {
    workspaces: o.workspaces ?? [ws('laaaaaaaaaa')],
    sessions: o.sessions ?? [],
    prefs: o.prefs ?? { workspaces: true, sessions: true },
  };
  const p = createSyncPublisher({
    sync,
    local,
    workspaces: async () => state.workspaces,
    sessions: async () => state.sessions,
    settings: async () => state.prefs,
    platform: async () => 'linux',
    now: () => clock,
  });
  return { p, sync, local, state, tick: (ms: number) => (clock += ms) };
}
const status = async (local: ReturnType<typeof area>) =>
  (await local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] as SyncStatus;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('sync publisher', () => {
  it('creates a device identity and publishes a document others can read', async () => {
    const { p, sync, local } = setup();
    await p.now();
    const me = (await local.get(DEVICE_KEY))[DEVICE_KEY] as { id: string; name: string };
    expect(me.id).toMatch(/^[a-z0-9]{10}$/);
    expect(me.name).toBe('Linux computer');
    const snap = await readSync(await sync.get(null));
    expect(snap.docs).toHaveLength(1);
    expect(snap.docs[0]?.device).toEqual({ id: me.id, name: 'Linux computer', os: 'linux' });
    expect(snap.docs[0]?.workspaces.map((w) => w.id)).toEqual(['laaaaaaaaaa']);
    const st = await status(local);
    expect(st.error).toBeNull();
    expect(st.bytes).toBeGreaterThan(0);
  });

  it('does not rewrite an unchanged document', async () => {
    const { p, sync, tick } = setup();
    await p.now();
    const writes = sync.writes();
    tick(120_000);
    p.schedule();
    await vi.advanceTimersByTimeAsync(20_000);
    await p.settled();
    expect(sync.writes()).toBe(writes);
  });

  it('debounces bursts of changes into one write, at most once a minute', async () => {
    const { p, sync, state, tick } = setup();
    await p.now();
    const writes = sync.writes();
    for (let i = 0; i < 5; i++) {
      state.workspaces = [ws('laaaaaaaaaa', 3 + i)];
      p.schedule();
      await vi.advanceTimersByTimeAsync(2_000);
      tick(2_000);
    }
    await vi.advanceTimersByTimeAsync(70_000);
    await p.settled();
    expect(sync.writes()).toBe(writes + 1);
    const snap = await readSync(await sync.get(null));
    expect(snap.docs[0]?.workspaces[0]?.window.tabs).toHaveLength(7);
  });

  it('splits a big document into chunks within the item limit and drops old chunks', async () => {
    const big = Array.from({ length: 40 }, (_, i) => session(`s${i}`, 60));
    const { p, sync, state } = setup({ sessions: big });
    await p.now();
    const before = [...sync.data.keys()].filter((k) => /:\d+$/.test(k)).length;
    expect(before).toBeGreaterThan(1);
    state.sessions = [];
    await p.now();
    const after = [...sync.data.keys()].filter((k) => /:\d+$/.test(k)).length;
    expect(after).toBe(1);
    expect((await readSync(await sync.get(null))).docs[0]?.sessions).toEqual([]);
  });

  it('stays within its budget and reports what it left out', async () => {
    const big = Array.from({ length: 80 }, (_, i) => session(`s${i}`, 80));
    const { p, local, sync } = setup({ sessions: big });
    await p.now();
    const st = await status(local);
    expect(st.bytes).toBeLessThanOrEqual(st.budget + 600);
    expect(st.omitted.sessions).toBeGreaterThan(0);
    expect((await readSync(await sync.get(null))).docs[0]?.workspaces).toHaveLength(1);
  });

  it('removes its document when both switches are off', async () => {
    const { p, sync, state, local } = setup();
    await p.now();
    state.prefs = { workspaces: false, sessions: false };
    await p.now();
    expect([...sync.data.keys()].filter((k) => k.startsWith('dev:'))).toEqual([]);
    expect((await status(local)).off).toBe(true);
  });

  it('leaves sessions out when that switch is off', async () => {
    const { p, sync } = setup({
      sessions: [session('s1', 3)],
      prefs: { workspaces: true, sessions: false },
    });
    await p.now();
    const doc = (await readSync(await sync.get(null))).docs[0];
    expect(doc?.sessions).toEqual([]);
    expect(doc?.workspaces).toHaveLength(1);
  });

  it('forgets another device and prunes ones unseen for 90 days, never itself', async () => {
    const other = setup();
    await other.p.now();
    const otherId = ((await other.local.get(DEVICE_KEY))[DEVICE_KEY] as { id: string }).id;
    const shared = Object.fromEntries(other.sync.data);
    const mine = setup({ sync: shared });
    await mine.p.now();
    expect((await readSync(await mine.sync.get(null))).docs).toHaveLength(2);
    await mine.p.forget(otherId);
    expect((await readSync(await mine.sync.get(null))).docs).toHaveLength(1);

    const again = setup({ sync: shared });
    again.tick(91 * 24 * 3600 * 1000);
    await again.p.now();
    const docs = (await readSync(await again.sync.get(null))).docs;
    expect(docs.map((d) => d.device.id)).not.toContain(otherId);
    expect(docs).toHaveLength(1);
  });

  it('renames this device and republishes', async () => {
    const { p, sync } = setup();
    await p.now();
    await p.rename('  Work laptop  ');
    expect((await readSync(await sync.get(null))).docs[0]?.device.name).toBe('Work laptop');
  });

  it('reports a full storage instead of throwing', async () => {
    const { p, sync, local } = setup();
    sync.set = async () => {
      throw new Error('QUOTA_BYTES quota exceeded');
    };
    await p.now();
    expect((await status(local)).error).toBe('Sync storage is full');
  });
});
