import { describe, expect, it } from 'vitest';
import type { PinFolder, PinItem, WindowLayout } from '../src/shared/layout';
import type { WindowInfo } from '../src/shared/types';
import { buildPanelRows, rowWindowId } from '../src/sidepanel/model/rows';
import { tab } from './helpers';

const win = (id: number): WindowInfo => ({ id, incognito: false, focused: false });
const item = (id: string, tabId: number | null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: 'https://example.com/',
  lastUrl: 'https://example.com/',
  title: id,
  tabId,
});
const folder = (id: string, children: PinFolder['children'], collapsed = false): PinFolder => ({
  kind: 'folder',
  id,
  name: id,
  icon: 'folder',
  collapsed,
  children,
});
const layout = (over: Partial<WindowLayout> = {}): WindowLayout => ({
  id: 'laaaaaaaaaa',
  name: null,
  essentials: [],
  pinned: [],
  collapsed: [],
  incognito: false,
  lastUsed: 0,
  ...over,
});
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);
const opts = { tilesPerRow: 4 };

const homeTabs = (extra: Parameters<typeof tab>[1] = {}) => [
  tab(1, { pinned: true }),
  tab(2, { pinned: true }),
  tab(3, { pinned: true, ...extra }),
  tab(4, { pinned: true }),
  tab(5, { pinned: true }),
  tab(10),
  tab(11),
  tab(12),
];
const homeLayout = (collapsed = false) =>
  layout({
    essentials: [item('e1', 1), item('e2', 2)],
    pinned: [folder('F', [item('a', 3), item('b', 4)], collapsed), item('c', 5)],
  });

describe('buildPanelRows home window', () => {
  it('folder, children, root item, divider, unpinned; essentials stay out', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: homeTabs(), groups: [], layout: homeLayout() }],
      1,
      opts,
    );
    expect(keys(rows)).toEqual(['fF', 'pa', 'pb', 'pc', 'd1', 't10', 't11', 't12']);
    expect(rows.find((r) => r.key === 'd1')).toMatchObject({ kind: 'divider', clearable: 3 });
    expect(rows[0]).toMatchObject({ kind: 'folder', count: 2, depth: 1 });
  });

  it('collapsed folder keeps only its active descendant', () => {
    const rows = buildPanelRows(
      [
        {
          info: win(1),
          tabs: homeTabs({ active: false }).map((t) => (t.id === 4 ? { ...t, active: true } : t)),
          groups: [],
          layout: homeLayout(true),
        },
      ],
      1,
      opts,
    );
    expect(keys(rows).slice(0, 4)).toEqual(['fF', 'pb', 'pc', 'd1']);
    expect(rows[1]).toMatchObject({ depth: 2, level: 2, pos: 1, size: 1 });
  });

  it('collapsed folder without an active descendant shows the header only', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: homeTabs(), groups: [], layout: homeLayout(true) }],
      1,
      opts,
    );
    expect(keys(rows).slice(0, 3)).toEqual(['fF', 'pc', 'd1']);
  });

  it('aria levels and pos/size: folder child level 2, siblings counted', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: homeTabs(), groups: [], layout: homeLayout() }],
      1,
      opts,
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.pa).toMatchObject({ level: 2, pos: 1, size: 2 });
    expect(by.pb).toMatchObject({ level: 2, pos: 2, size: 2 });
    // folder, c, divider, t10..t12 are level-1 siblings.
    expect(by.fF).toMatchObject({ level: 1, pos: 1, size: 6 });
    expect(by.d1).toMatchObject({ level: 1, pos: 3, size: 6 });
    expect(by.t12).toMatchObject({ level: 1, pos: 6, size: 6 });
  });

  it('dormant item has tab null; unreferenced pinned tab becomes a TabRow before the divider', () => {
    const rows = buildPanelRows(
      [
        {
          info: win(1),
          tabs: [tab(7, { pinned: true }), tab(10)],
          groups: [],
          layout: layout({ pinned: [item('z', null)] }),
        },
      ],
      1,
      opts,
    );
    expect(keys(rows)).toEqual(['pz', 't7', 'd1', 't10']);
    expect(rows[0]).toMatchObject({ kind: 'pin', tab: null });
  });

  it('no divider without pinned content', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: [tab(10)], groups: [], layout: layout() }],
      1,
      opts,
    );
    expect(keys(rows)).toEqual(['t10']);
  });

  it('undefined layout renders pinned tabs as plain tab rows with no divider', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: [tab(1, { pinned: true }), tab(10)], groups: [], layout: undefined }],
      1,
      opts,
    );
    expect(keys(rows)).toEqual(['t1', 't10']);
  });
});

describe('buildPanelRows other windows', () => {
  const other = (over: Partial<WindowLayout> = {}) => ({
    info: win(2),
    tabs: [
      ...[1, 2, 3, 4, 5].map((i) => tab(20 + i, { windowId: 2, pinned: true })),
      tab(30, { windowId: 2, active: true, title: 'Active' }),
    ],
    groups: [],
    layout: layout({
      id: 'lbbbbbbbbbb',
      essentials: [1, 2, 3, 4, 5].map((i) => item(`e${i}`, 20 + i)),
      ...over,
    }),
  });
  const home = { info: win(1), tabs: [tab(10)], groups: [], layout: layout() };

  it('header, tiles chunks, divider, unpinned', () => {
    const rows = buildPanelRows([home, other()], 1, opts);
    expect(keys(rows)).toEqual(['t10', 'w2', 'x2-0', 'x2-1', 'd2', 't30']);
    const tiles = rows.filter((r) => r.kind === 'tiles');
    expect(tiles.map((r) => r.kind === 'tiles' && r.tiles.length)).toEqual([4, 1]);
    expect(rows[1]).toMatchObject({ kind: 'window', name: 'Active', layoutId: 'lbbbbbbbbbb' });
    expect(rows[2]).toMatchObject({ level: 2, pos: 1, size: 4 });
  });

  it('collapsed per the home layout hides everything but the header', () => {
    const h = { ...home, layout: layout({ collapsed: ['lbbbbbbbbbb'] }) };
    const rows = buildPanelRows([h, other()], 1, opts);
    expect(keys(rows)).toEqual(['t10', 'w2']);
    expect(rows[1]).toMatchObject({ collapsed: true });
  });

  it('folder child sits at level 3; layout name wins; fallback name', () => {
    const o = other({ name: 'Work', essentials: [], pinned: [folder('G', [item('g1', 21)])] });
    const rows = buildPanelRows([home, o], 1, opts);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.w2).toMatchObject({ name: 'Work' });
    expect(by.fG).toMatchObject({ level: 2 });
    expect(by.pg1).toMatchObject({ level: 3 });
    const bare = buildPanelRows(
      [home, { info: win(2), tabs: [tab(40, { windowId: 2 })], groups: [], layout: undefined }],
      1,
      opts,
    );
    expect(bare[1]).toMatchObject({ name: 'Window 2', layoutId: null });
    expect(keys(bare)).toEqual(['t10', 'w2', 't40']);
  });
});

describe('buildPanelRows window headers', () => {
  const w = (id: number) => ({
    info: win(id),
    tabs: [tab(id * 10, { windowId: id })],
    groups: [],
    layout: layout({ id: `l${String(id).repeat(10)}` }),
  });

  it('only the other windows count as header siblings (the home window has none)', () => {
    const rows = buildPanelRows([w(1), w(2), w(3)], 1, opts);
    const headers = rows.filter((r) => r.kind === 'window');
    expect(headers.map((h) => [h.key, h.pos, h.size])).toEqual([
      ['w2', 1, 2],
      ['w3', 2, 2],
    ]);
  });

  it('with no home window every window is a header', () => {
    const rows = buildPanelRows([w(1), w(2)], null, opts);
    const headers = rows.filter((r) => r.kind === 'window');
    expect(headers.map((h) => [h.key, h.pos, h.size])).toEqual([
      ['w1', 1, 2],
      ['w2', 2, 2],
    ]);
  });
});

describe('buildPanelRows parent and index', () => {
  it('pin and folder rows carry their enclosing folder and sibling index', () => {
    const rows = buildPanelRows(
      [{ info: win(1), tabs: homeTabs(), groups: [], layout: homeLayout() }],
      1,
      opts,
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.fF).toMatchObject({ parentId: null, index: 0 });
    expect(by.pa).toMatchObject({ parentId: 'F', index: 0 });
    expect(by.pb).toMatchObject({ parentId: 'F', index: 1 });
    expect(by.pc).toMatchObject({ parentId: null, index: 1 });
  });
});

describe('rowWindowId for pin rows', () => {
  it('resolves new kinds', () => {
    const rows = buildPanelRows(
      [
        {
          info: win(2),
          tabs: [tab(1, { windowId: 2, pinned: true })],
          groups: [],
          layout: layout({ essentials: [item('e', 1)], pinned: [folder('F', [item('a', null)])] }),
        },
      ],
      null,
      opts,
    );
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(rowWindowId(r)).toBe(2);
  });
});

describe('buildPanelRows performance', () => {
  it('builds 1,500 unpinned tabs in under 5 ms', () => {
    const tabs = Array.from({ length: 1500 }, (_, i) => tab(i + 1));
    const w = [{ info: win(1), tabs, groups: [], layout: layout({ pinned: [item('a', null)] }) }];
    buildPanelRows(w, 1, opts);
    const t0 = performance.now();
    const rows = buildPanelRows(w, 1, opts);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(rows).toHaveLength(1502);
  });
});

describe('buildPanelRows transient duplicates', () => {
  it('keeps row keys unique while a pinned item is in two windows at once', () => {
    // pinMove sends the target window's layout before the source's has caught up.
    const both = item('x', 7);
    const rows = buildPanelRows(
      [
        {
          info: win(1),
          tabs: [tab(7, { windowId: 1, pinned: true }), tab(10, { windowId: 1 })],
          groups: [],
          layout: layout({ pinned: [both] }),
        },
        {
          info: win(2),
          tabs: [tab(7, { windowId: 2, pinned: true })],
          groups: [],
          layout: layout({ id: 'lbbbbbbbbbb', pinned: [both] }),
        },
      ],
      1,
      opts,
    );
    expect(new Set(keys(rows)).size).toBe(rows.length);
    expect(keys(rows).filter((k) => k === 'px')).toHaveLength(1);
  });
});
