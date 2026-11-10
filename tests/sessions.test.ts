import { describe, expect, it } from 'vitest';
import type { WindowLayout } from '../src/shared/layout';
import {
  captureWindow,
  isRestorableUrl,
  MAX_SESSIONS,
  parseSessions,
  type Session,
  saveSummary,
  sessionTabCount,
  splitIncognito,
} from '../src/shared/sessions';
import { group, tab } from './helpers';

const OWN = 'chrome-extension://abcdef';

describe('captureWindow', () => {
  it('captures url, title, pinned', () => {
    const w = captureWindow([tab(1, { pinned: true, title: 'A', url: 'https://a.com/' })], [], OWN);
    expect(w).toEqual({
      tabs: [{ url: 'https://a.com/', title: 'A', pinned: true, group: null }],
      groups: [],
    });
  });

  it('skips own-origin and empty URLs', () => {
    const w = captureWindow(
      [
        tab(1, { url: `${OWN}/sidepanel.html` }),
        tab(2, { url: '' }),
        tab(3, { url: 'https://ok.com/' }),
        tab(4, { url: `chrome-extension://other/p.html` }),
      ],
      [],
      OWN,
    );
    expect(w.tabs.map((t) => t.url)).toEqual([
      'https://ok.com/',
      'chrome-extension://other/p.html',
    ]);
  });

  it('maps groups by position, in first-appearance order, shared across tabs', () => {
    const groups = [
      group(10, { title: 'Ten', color: 'red', collapsed: true }),
      group(20, { title: 'Twenty', color: 'green' }),
    ];
    const w = captureWindow(
      [
        tab(1),
        tab(2, { groupId: 20 }),
        tab(3, { groupId: 20 }),
        tab(4, { groupId: 10 }),
        tab(5, { groupId: 20 }),
      ],
      groups,
      OWN,
    );
    expect(w.groups).toEqual([
      { title: 'Twenty', color: 'green', collapsed: false },
      { title: 'Ten', color: 'red', collapsed: true },
    ]);
    expect(w.tabs.map((t) => t.group)).toEqual([null, 0, 0, 1, 0]);
  });

  it('pinned tabs are never grouped (and do not create the group)', () => {
    const w = captureWindow(
      [tab(1, { pinned: true, groupId: 10 }), tab(2, { groupId: 11 })],
      [group(10), group(11)],
      OWN,
    );
    expect(w.tabs.map((t) => t.group)).toEqual([null, 0]);
    expect(w.groups).toHaveLength(1);
  });

  it('a tab referencing an unknown group id has group null and creates no group', () => {
    const w = captureWindow([tab(1, { groupId: 99 })], [group(1)], OWN);
    expect(w.tabs[0]?.group).toBeNull();
    expect(w.groups).toEqual([]);
  });

  it('groups whose only tabs were skipped are not saved', () => {
    const w = captureWindow([tab(1, { groupId: 10, url: `${OWN}/x` })], [group(10)], OWN);
    expect(w).toEqual({ tabs: [], groups: [] });
  });

  it('empty input', () => {
    expect(captureWindow([], [], OWN)).toEqual({ tabs: [], groups: [] });
  });
});

describe('sessionTabCount', () => {
  it('sums tabs across windows', () => {
    const t = { url: 'https://a.com', title: '', pinned: false, group: null };
    const s: Session = {
      id: 'a',
      name: 'n',
      createdAt: 0,
      windows: [
        { tabs: [t, t], groups: [] },
        { tabs: [t], groups: [] },
      ],
    };
    expect(sessionTabCount(s)).toBe(3);
    expect(sessionTabCount({ ...s, windows: [] })).toBe(0);
  });
});

describe('isRestorableUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com',
    'HTTPS://EXAMPLE.COM',
    'chrome://settings',
    'chrome://extensions',
    'about:blank',
    'chrome-extension://abc/page.html',
    'ftp://example.com/file',
  ])('allows %s', (u) => {
    expect(isRestorableUrl(u)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<b>hi</b>',
    'file:///etc/passwd',
    'chrome://kill',
    'chrome://crash',
    'chrome://hang',
    'chrome://quit',
    'chrome://restart',
    'CHROME://KILL',
    // Spellings the URL parser normalises to a debug page, and debug pages outside the old list.
    'chrome://cr\tash',
    'chrome://\ncrash',
    'chrome:crash',
    'chrome:/kill',
    'chrome://gpucrash',
    'chrome://memory-exhaust',
    'chrome://shorthang',
    'chrome-error://chromewebdata/',
    'devtools://devtools/bundled/x.html',
    'ws://example.com',
    'blob:https://example.com/x',
    'example.com',
    '',
  ])('rejects %s', (u) => {
    expect(isRestorableUrl(u)).toBe(false);
  });
});

describe('parseSessions', () => {
  const good = (over: Record<string, unknown> = {}) => ({
    id: 'abc-1',
    name: 'Work',
    createdAt: 123,
    windows: [
      {
        groups: [{ title: 'G', color: 'blue', collapsed: true }],
        tabs: [
          { url: 'https://a.com', title: 'A', pinned: true, group: null },
          { url: 'https://b.com', title: 'B', pinned: false, group: 0 },
        ],
      },
    ],
    ...over,
  });

  it('round-trips a valid session', () => {
    expect(parseSessions([good()])).toEqual([good()]);
  });

  it('non-array -> []', () => {
    for (const v of [null, undefined, {}, 'x', 5, { 0: good() }])
      expect(parseSessions(v)).toEqual([]);
  });

  it('drops invalid ids', () => {
    const ids = ['', 'A', 'a_b', 'a b', 'x'.repeat(41), 5, null, undefined];
    for (const id of ids) expect(parseSessions([good({ id })])).toEqual([]);
    expect(parseSessions([good({ id: 'x'.repeat(40) })])).toHaveLength(1);
    expect(parseSessions([good({ id: '0' })])).toHaveLength(1);
  });

  it('drops non-object sessions and keeps the valid ones', () => {
    const r = parseSessions([null, 5, 'x', [], good({ id: 'one' }), good({ id: 'two' })]);
    expect(r.map((s) => s.id)).toEqual(['one', 'two']);
  });

  it('drops sessions with no valid windows', () => {
    expect(parseSessions([good({ windows: [] })])).toEqual([]);
    expect(parseSessions([good({ windows: 'x' })])).toEqual([]);
    expect(parseSessions([good({ windows: undefined })])).toEqual([]);
    expect(parseSessions([good({ windows: [null, 5, { tabs: [] }, { tabs: 'x' }, {}] })])).toEqual(
      [],
    );
  });

  it('drops invalid windows but keeps valid siblings', () => {
    const s = good();
    const r = parseSessions([{ ...s, windows: [null, ...s.windows, { tabs: [] }] }]);
    expect(r[0]?.windows).toHaveLength(1);
  });

  it('drops invalid tabs', () => {
    const r = parseSessions([
      good({
        windows: [
          {
            groups: [],
            tabs: [
              null,
              5,
              { url: '' },
              { url: 5 },
              { title: 'no url' },
              { url: 'https://ok.com' },
            ],
          },
        ],
      }),
    ]);
    expect(r[0]?.windows[0]?.tabs).toEqual([
      { url: 'https://ok.com', title: '', pinned: false, group: null },
    ]);
  });

  it('a window whose tabs are all invalid is dropped, and so is its session', () => {
    expect(parseSessions([good({ windows: [{ groups: [], tabs: [{ url: '' }] }] })])).toEqual([]);
  });

  it('URL length cap: 8192 kept, 8193 dropped', () => {
    const base = 'https://a.com/';
    const mk = (n: number) => base + 'x'.repeat(n - base.length);
    const r = parseSessions([
      good({
        windows: [{ groups: [], tabs: [{ url: mk(8192) }, { url: mk(8193) }] }],
      }),
    ]);
    expect(r[0]?.windows[0]?.tabs).toHaveLength(1);
    expect(r[0]?.windows[0]?.tabs[0]?.url).toHaveLength(8192);
  });

  it('group index out of range or not an integer -> null', () => {
    const tabs = [-1, 1, 2, 1.5, '0', null, undefined, Number.NaN].map((g) => ({
      url: 'https://a.com',
      group: g,
    }));
    const r = parseSessions([
      good({ windows: [{ groups: [{ title: 'only', color: 'red' }], tabs }] }),
    ]);
    expect(r[0]?.windows[0]?.tabs.map((t) => t.group)).toEqual(Array(8).fill(null));
    const ok = parseSessions([
      good({
        windows: [{ groups: [{ color: 'red' }], tabs: [{ url: 'https://a.com', group: 0 }] }],
      }),
    ]);
    expect(ok[0]?.windows[0]?.tabs[0]?.group).toBe(0);
  });

  it('unknown colour -> grey; missing group fields default', () => {
    const r = parseSessions([
      good({
        windows: [
          {
            groups: [{ color: 'magenta' }, { color: 5 }, 'junk', { title: 'T', color: 'cyan' }],
            tabs: [{ url: 'https://a.com' }],
          },
        ],
      }),
    ]);
    expect(r[0]?.windows[0]?.groups).toEqual([
      { title: '', color: 'grey', collapsed: false },
      { title: '', color: 'grey', collapsed: false },
      { title: 'T', color: 'cyan', collapsed: false },
    ]);
  });

  it('collapsed and pinned must be exactly true', () => {
    const r = parseSessions([
      good({
        windows: [
          {
            groups: [{ collapsed: 'true' }],
            tabs: [
              { url: 'https://a.com', pinned: 1 },
              { url: 'https://b.com', pinned: true },
            ],
          },
        ],
      }),
    ]);
    expect(r[0]?.windows[0]?.groups[0]?.collapsed).toBe(false);
    expect(r[0]?.windows[0]?.tabs.map((t) => t.pinned)).toEqual([false, true]);
  });

  it('name: trimmed, falls back to "Session", capped at 100 chars', () => {
    const name = (n: unknown) => parseSessions([good({ name: n })])[0]?.name;
    expect(name('  Hello  ')).toBe('Hello');
    expect(name('')).toBe('Session');
    expect(name('    ')).toBe('Session');
    expect(name(undefined)).toBe('Session');
    expect(name(42)).toBe('Session');
    expect(name('x'.repeat(150))).toBe('x'.repeat(100));
  });

  it('title is capped (tab 500, group 200)', () => {
    const r = parseSessions([
      good({
        windows: [
          {
            groups: [{ title: 'g'.repeat(300), color: 'red' }],
            tabs: [{ url: 'https://a.com', title: 't'.repeat(600) }],
          },
        ],
      }),
    ]);
    expect(r[0]?.windows[0]?.tabs[0]?.title).toHaveLength(500);
    expect(r[0]?.windows[0]?.groups[0]?.title).toHaveLength(200);
  });

  it('createdAt must be a finite number, else 0', () => {
    const at = (v: unknown) => parseSessions([good({ createdAt: v })])[0]?.createdAt;
    expect(at(99)).toBe(99);
    expect(at('99')).toBe(0);
    expect(at(Number.NaN)).toBe(0);
    expect(at(Number.POSITIVE_INFINITY)).toBe(0);
    expect(at(undefined)).toBe(0);
  });

  it('caps the number of sessions at MAX_SESSIONS', () => {
    expect(MAX_SESSIONS).toBe(200);
    const many = Array.from({ length: 250 }, (_, i) => good({ id: `s${i}` }));
    const r = parseSessions(many);
    expect(r).toHaveLength(MAX_SESSIONS);
    expect(r[0]?.id).toBe('s0');
    expect(r[199]?.id).toBe('s199');
  });

  it('does not keep unknown fields', () => {
    const r = parseSessions([good({ extra: 1 })]);
    expect(r[0]).not.toHaveProperty('extra');
  });
});

describe('session layouts', () => {
  const pin = (id: number, tabId: number | null) => ({
    kind: 'item' as const,
    id: `i${id}`,
    homeUrl: `https://${id}.com/`,
    lastUrl: `https://${id}.com/`,
    title: `T${id}`,
    tabId,
  });
  const layout = (o: Partial<WindowLayout>): WindowLayout => ({
    id: 'l0000000001',
    name: null,
    essentials: [],
    pinned: [],
    collapsed: [],
    incognito: false,
    lastUsed: 0,
    ...o,
  });
  const strip = [
    tab(1, { pinned: true, url: 'https://1.com/' }),
    tab(2, { pinned: true, url: 'https://2.com/' }),
    tab(3, { pinned: true, url: 'https://3.com/' }),
    tab(4, { pinned: true, url: 'https://4.com/' }),
    tab(5, { url: 'https://5.com/' }),
  ];

  it('stores essentials and folders as indices into the captured tabs', () => {
    const w = captureWindow(
      [tab(9, { url: `${OWN}/p.html`, pinned: true }), ...strip],
      [],
      OWN,
      layout({
        essentials: [pin(1, 1), pin(2, 2)],
        pinned: [
          {
            kind: 'folder',
            id: 'f1',
            name: 'Work',
            icon: 'code',
            collapsed: true,
            children: [pin(3, 3), pin(7, null)],
          },
          pin(4, 4),
        ],
      }),
    );
    // The own-origin tab is skipped, so tab 1 is index 0.
    expect(w.layout).toEqual({
      essentials: [0, 1],
      pinned: [
        {
          kind: 'folder',
          name: 'Work',
          icon: 'code',
          collapsed: true,
          children: [{ kind: 'item', tab: 2 }],
        },
        { kind: 'item', tab: 3 },
      ],
    });
  });

  it('leaves the layout out when nothing live is in it', () => {
    const w = captureWindow(strip, [], OWN, layout({ essentials: [pin(1, null)] }));
    expect(w).not.toHaveProperty('layout');
    expect(captureWindow(strip, [], OWN)).not.toHaveProperty('layout');
  });

  it('skips layout items whose tab is not pinned', () => {
    const w = captureWindow(strip, [], OWN, layout({ essentials: [pin(5, 5), pin(1, 1)] }));
    expect(w.layout?.essentials).toEqual([0]);
  });

  const stored = (l: unknown, extra: unknown[] = []) => [
    {
      id: 's1',
      name: 'S',
      createdAt: 1,
      windows: [
        {
          groups: [],
          tabs: [
            { url: 'https://a.com', title: 'A', pinned: true, group: null },
            { url: 'https://b.com', title: 'B', pinned: true, group: null },
            { url: 'https://c.com', title: 'C', pinned: false, group: null },
            ...extra,
          ],
          layout: l,
        },
      ],
    },
  ];
  const parsed = (l: unknown, extra: unknown[] = []) =>
    parseSessions(stored(l, extra))[0]?.windows[0]?.layout;

  it('round-trips a captured layout through parseSessions', () => {
    const w = captureWindow(
      strip,
      [],
      OWN,
      layout({
        essentials: [pin(1, 1)],
        pinned: [
          {
            kind: 'folder',
            id: 'f',
            name: 'F',
            icon: 'star',
            collapsed: false,
            children: [pin(2, 2)],
          },
        ],
      }),
    );
    const s: Session = { id: 'x', name: 'n', createdAt: 5, windows: [w] };
    expect(parseSessions(JSON.parse(JSON.stringify([s])))).toEqual([s]);
  });

  it('old sessions without a layout parse unchanged', () => {
    const r = parseSessions(stored(undefined))[0]?.windows[0];
    expect(r).not.toHaveProperty('layout');
    expect(r?.tabs).toHaveLength(3);
  });

  it('drops out-of-range, repeated, non-pinned and malformed references only', () => {
    expect(
      parsed({
        essentials: [0, 0, 7, -1, 1.5, '1', 2, null],
        pinned: [
          { kind: 'item', tab: 1 },
          { kind: 'item', tab: 99 },
          { kind: 'item', tab: 0 },
          'junk',
        ],
      }),
    ).toEqual({ essentials: [0], pinned: [{ kind: 'item', tab: 1 }] });
  });

  it('re-targets indices when invalid tabs before them are dropped', () => {
    const s = stored({ essentials: [1] });
    (s[0] as { windows: { tabs: unknown[] }[] }).windows[0]?.tabs.unshift({ url: '', title: '' });
    // Stored index 1 was tab "a" (index 0 after the empty-URL tab is dropped).
    expect(parseSessions(s)[0]?.windows[0]?.layout).toEqual({ essentials: [0], pinned: [] });
  });

  it('validates folders: depth, name, icon, empties', () => {
    const f = (children: unknown[], over: Record<string, unknown> = {}) => ({
      kind: 'folder',
      name: 'F',
      icon: 'star',
      collapsed: false,
      children,
      ...over,
    });
    const extra = [1, 2, 3].map((n) => ({
      url: `https://p${n}.com`,
      title: '',
      pinned: true,
      group: null,
    }));
    const l = parsed(
      {
        essentials: [],
        pinned: [
          f([f([f([f([{ kind: 'item', tab: 0 }])])])]),
          f([{ kind: 'item', tab: 1 }], { name: 'x'.repeat(300), icon: 'nope' }),
          f([{ kind: 'item', tab: 77 }]),
        ],
      },
      extra,
    );
    const first = l?.pinned[0];
    // Depth 4 is too deep: its item moves up into the depth-3 folder.
    const d3 = ((first as { children: unknown[] }).children[0] as { children: unknown[] })
      .children[0] as { children: unknown[] };
    expect(d3.children).toEqual([{ kind: 'item', tab: 0 }]);
    expect(l?.pinned[1]).toMatchObject({ kind: 'folder', icon: 'folder' });
    expect((l?.pinned[1] as unknown as { name: string })?.name).toHaveLength(100);
    // The folder whose only item is invalid is gone.
    expect(l?.pinned).toHaveLength(2);
  });
});

describe('incognito windows are never saved (R23)', () => {
  const win = (incognito: boolean) => ({
    tabs: [tab(1, { incognito, url: 'https://a.com/' })],
    groups: [],
  });

  it('splits incognito windows out, counting them', () => {
    const { keep, skipped } = splitIncognito([win(false), win(true), win(true)]);
    expect(keep).toHaveLength(1);
    expect(skipped).toBe(2);
  });

  it('a window with any incognito tab is skipped', () => {
    const mixed = { tabs: [tab(1), tab(2, { incognito: true })], groups: [] };
    expect(splitIncognito([mixed]).skipped).toBe(1);
  });

  it('words the toast', () => {
    expect(saveSummary('X', 12, 0)).toBe('Saved “X” (12 tabs)');
    expect(saveSummary('X', 1, 0)).toBe('Saved “X” (1 tab)');
    expect(saveSummary('X', 12, 1)).toBe('Saved “X” (12 tabs) · 1 incognito window skipped');
    expect(saveSummary('X', 12, 2)).toBe('Saved “X” (12 tabs) · 2 incognito windows skipped');
    expect(saveSummary('X', 0, 1)).toBe("Incognito windows aren't saved");
    expect(saveSummary('X', 0, 0)).toBe('Nothing to save in this window');
  });
});

describe('parseSessions on hostile nesting', () => {
  it('survives ~10,000 nested folders without throwing', () => {
    let node: unknown = { kind: 'item', tab: 0 };
    for (let i = 0; i < 10_000; i++) {
      node = { kind: 'folder', name: 'F', icon: 'folder', collapsed: false, children: [node] };
    }
    const raw = [
      {
        id: 's1',
        name: 'S',
        createdAt: 1,
        windows: [
          {
            groups: [],
            tabs: [{ url: 'https://a.com', title: 'A', pinned: true, group: null }],
            layout: { essentials: [], pinned: [node] },
          },
        ],
      },
    ];
    const w = parseSessions(raw)[0]?.windows[0];
    expect(w?.tabs).toHaveLength(1);
    expect(JSON.stringify(w?.layout)).toContain('"tab":0');
  });
});
