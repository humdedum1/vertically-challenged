import { describe, expect, it } from 'vitest';
import { flattenItems, type PinItem, type WindowLayout } from '../src/shared/layout';
import type { Session } from '../src/shared/sessions';
import {
  chunk,
  decodeDoc,
  deviceBudget,
  encodeDoc,
  fitDoc,
  itemBytes,
  layoutFromSaved,
  MAX_DEVICE_BUDGET,
  parseSyncDoc,
  SYNC_ITEM_QUOTA,
  SYNC_QUOTA,
  SYNC_RESERVE,
  type SyncDoc,
  type SyncWorkspace,
  savedFromLayout,
} from '../src/shared/sync';

const item = (id: string, url: string, tabId: number | null = 5): PinItem => ({
  kind: 'item',
  id,
  homeUrl: url,
  lastUrl: `${url}later`,
  title: `T ${id}`,
  tabId,
});
const layout: WindowLayout = {
  id: 'laaaaaaaaaa',
  name: 'Work',
  essentials: [item('ia', 'https://mail.example/'), item('ib', 'https://cal.example/')],
  pinned: [
    {
      kind: 'folder',
      id: 'fa',
      name: 'Docs',
      icon: 'book',
      collapsed: true,
      children: [item('ic', 'https://docs.example/')],
    },
    item('id', 'https://chat.example/', null),
  ],
  collapsed: [],
  incognito: false,
  lastUsed: 7,
};
const device = { id: 'abcdefghij', name: 'Linux computer', os: 'linux' };
const workspace = (id: string, l = layout): SyncWorkspace => ({
  id,
  name: l.name ?? 'Workspace',
  kind: 'window',
  lastUsed: 1,
  window: savedFromLayout(l),
});
const session = (id: string, tabs: number): Session => ({
  id,
  name: `Session ${id}`,
  createdAt: 1,
  windows: [
    {
      tabs: Array.from({ length: tabs }, (_, i) => ({
        url: `https://example.com/${id}/${i}/${'x'.repeat(i % 50)}`,
        title: `Page ${i} of ${id}`,
        pinned: false,
        group: null,
      })),
      groups: [],
    },
  ],
});
const doc = (over: Partial<SyncDoc> = {}): SyncDoc => ({
  v: 1,
  device,
  updatedAt: 100,
  workspaces: [workspace('lbbbbbbbbbb')],
  sessions: [session('s1', 3)],
  omitted: { workspaces: 0, sessions: 0 },
  ...over,
});

describe('layout <-> saved window', () => {
  it('keeps Essentials, the folder tree and home URLs; drops tab ids and last URLs', () => {
    const w = savedFromLayout(layout);
    expect(w.tabs.map((t) => t.url)).toEqual([
      'https://mail.example/',
      'https://cal.example/',
      'https://docs.example/',
      'https://chat.example/',
    ]);
    expect(w.tabs.every((t) => t.pinned)).toBe(true);
    expect(JSON.stringify(w)).not.toContain('later');
    expect(w.layout?.essentials).toEqual([0, 1]);

    const back = layoutFromSaved(w, 'Work');
    expect(back.name).toBe('Work');
    expect(back.essentials.map((i) => i.homeUrl)).toEqual([
      'https://mail.example/',
      'https://cal.example/',
    ]);
    expect(back.pinned[0]).toMatchObject({
      kind: 'folder',
      name: 'Docs',
      icon: 'book',
      collapsed: true,
    });
    expect(flattenItems(back).every((i) => i.tabId === null)).toBe(true);
    // Fresh ids, so the copy can't collide with the original if both end up here.
    expect(flattenItems(back).map((i) => i.id)).not.toContain('ia');
    expect(back.id).not.toBe(layout.id);
  });

  it('drops items on URLs a layout cannot hold', () => {
    const w = savedFromLayout(layout);
    w.tabs[0] = { ...w.tabs[0], url: 'javascript:alert(1)' } as (typeof w.tabs)[0];
    expect(layoutFromSaved(w, null).essentials.map((i) => i.homeUrl)).toEqual([
      'https://cal.example/',
    ]);
  });
});

describe('parseSyncDoc', () => {
  it('accepts a document it wrote', () => {
    const d = doc();
    expect(parseSyncDoc(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('rejects other versions and bad device ids', () => {
    expect(parseSyncDoc({ ...doc(), v: 2 })).toBeNull();
    expect(parseSyncDoc({ ...doc(), device: { ...device, id: '../evil' } })).toBeNull();
    expect(parseSyncDoc('nope')).toBeNull();
  });

  it('drops invalid workspaces and unsafe URLs, keeps the rest', () => {
    const bad = JSON.parse(JSON.stringify(doc()));
    bad.workspaces.push({
      id: 'not-an-id',
      name: 'x',
      kind: 'window',
      lastUsed: 0,
      window: bad.workspaces[0].window,
    });
    bad.workspaces.push({
      id: 'lccccccccccc'.slice(0, 11),
      name: 'x',
      kind: 'window',
      lastUsed: 0,
      window: { tabs: [] },
    });
    bad.sessions[0].windows[0].tabs[0].url = 'x'.repeat(10_000);
    const d = parseSyncDoc(bad);
    expect(d?.workspaces.map((w) => w.id)).toEqual(['lbbbbbbbbbb']);
    expect(d?.sessions[0]?.windows[0]?.tabs).toHaveLength(2);
  });

  it('caps names and fills a missing device name', () => {
    const d = parseSyncDoc({
      ...doc(),
      device: { id: device.id, name: 'n'.repeat(500), os: 'linux' },
    });
    expect(d?.device.name.length).toBe(40);
    expect(parseSyncDoc({ ...doc(), device: { id: device.id } })?.device.name).toBe(
      'Another device',
    );
  });
});

describe('encoding', () => {
  it('round-trips through deflate and base64', async () => {
    const d = doc({ sessions: [session('s1', 300)] });
    const e = await encodeDoc(d);
    expect(e).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(e.length).toBeLessThan(JSON.stringify(d).length / 2);
    expect(parseSyncDoc(await decodeDoc(e))).toEqual(d);
  });

  it('refuses garbage and documents that inflate past the cap', async () => {
    expect(await decodeDoc('!!!not base64')).toBeNull();
    const huge = new TextEncoder().encode(JSON.stringify({ x: 'a'.repeat(3_000_000) }));
    const stream = new Blob([huge]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    expect(await decodeDoc(btoa(s))).toBeNull();
  });
});

describe('fitDoc', () => {
  it('takes everything when it fits', async () => {
    const { doc: d } = await fitDoc(
      { device, updatedAt: 1 },
      [workspace('lbbbbbbbbbb')],
      [session('s1', 5)],
      20_000,
    );
    expect(d.workspaces).toHaveLength(1);
    expect(d.sessions).toHaveLength(1);
    expect(d.omitted).toEqual({ workspaces: 0, sessions: 0 });
  });

  it('keeps workspaces before sessions and lets smaller sessions fill the gap', async () => {
    const sessions = [session('big', 2000), session('small', 3)];
    const { doc: d, encoded } = await fitDoc(
      { device, updatedAt: 1 },
      [workspace('lbbbbbbbbbb')],
      sessions,
      3_000,
    );
    expect(encoded.length).toBeLessThanOrEqual(3_000);
    expect(d.workspaces).toHaveLength(1);
    expect(d.sessions.map((s) => s.id)).toEqual(['small']);
    expect(d.omitted.sessions).toBe(1);
    expect(parseSyncDoc(await decodeDoc(encoded))).toEqual(d);
  });

  it('a zero budget still yields a valid, empty document', async () => {
    const { doc: d } = await fitDoc({ device, updatedAt: 1 }, [workspace('lbbbbbbbbbb')], [], 0);
    expect(d.workspaces).toEqual([]);
    expect(d.omitted.workspaces).toBe(1);
  });
});

describe('quota helpers', () => {
  it('splits the free space evenly, capped', () => {
    const room = SYNC_QUOTA - 10_000 - SYNC_RESERVE;
    expect(deviceBudget({ shared: 10_000, others: 0, devices: 1 })).toBe(MAX_DEVICE_BUDGET);
    expect(deviceBudget({ shared: 10_000, others: 30_000, devices: 3 })).toBe(Math.floor(room / 3));
    // Others took more than their share: this device gets only what is left.
    expect(deviceBudget({ shared: 10_000, others: 80_000, devices: 2 })).toBe(room - 80_000);
    expect(deviceBudget({ shared: 99_000, others: 0, devices: 1 })).toBe(0);
  });

  it('chunks stay under the per-item limit and reassemble', () => {
    const encoded = 'A'.repeat(30_000);
    const parts = chunk(encoded, 'dev:abcdefghij:');
    expect(Object.keys(parts)).toEqual([
      'dev:abcdefghij:0',
      'dev:abcdefghij:1',
      'dev:abcdefghij:2',
      'dev:abcdefghij:3',
    ]);
    for (const [k, v] of Object.entries(parts))
      expect(itemBytes(k, v)).toBeLessThanOrEqual(SYNC_ITEM_QUOTA);
    expect(Object.values(parts).join('')).toBe(encoded);
    expect(chunk('', 'p:')).toEqual({ 'p:0': '' });
  });
});
