import { describe, expect, it } from 'vitest';
import {
  emptyLayout,
  findNode,
  flattenItems,
  INCOGNITO_LAYOUTS_KEY,
  isEmptyLayout,
  isLayoutUrl,
  LAYOUTS_KEY,
  MAX_ITEMS,
  MAX_SETUPS,
  newId,
  type PinFolder,
  type PinItem,
  parseLayoutStore,
  type WindowLayout,
} from '../src/shared/layout';
import { parsePanelMessage } from '../src/shared/protocol';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'item',
  id,
  homeUrl: 'https://a.test/',
  lastUrl: 'https://a.test/x',
  title: 'A',
  tabId: null,
  ...over,
});
const folder = (id: string, children: unknown[] = [], over: Record<string, unknown> = {}) => ({
  kind: 'folder',
  id,
  name: 'F',
  icon: 'folder',
  collapsed: false,
  children,
  ...over,
});
const lid = (n: number) => `l${String(n).padStart(10, '0')}`;
const layout = (n: number, over: Record<string, unknown> = {}) => ({
  id: lid(n),
  name: null,
  essentials: [],
  pinned: [],
  collapsed: [],
  incognito: false,
  lastUsed: n,
  ...over,
});
const store = (layouts: unknown[], bindings: unknown[] = []) => ({ v: 1, layouts, bindings });

const ids = (items: PinItem[]) => items.map((i) => i.id);

describe('parseLayoutStore', () => {
  it('returns an empty store for garbage input', () => {
    for (const raw of [undefined, 'x', { v: 2 }]) {
      expect(parseLayoutStore(raw)).toEqual({ v: 1, layouts: [], bindings: [] });
    }
  });

  it('falls back to the other URL when one is disallowed; drops an item only when both are', () => {
    const long = `https://a.test/${'a'.repeat(8200)}`;
    const raw = store([
      layout(1, {
        essentials: [
          item('i1', { homeUrl: 'javascript:alert(1)' }),
          item('i2', { homeUrl: 'data:text/html,x', lastUrl: 'blob:https://a.test/x' }),
          item('i3', { lastUrl: 'ftp://x.test/' }),
          item('i4', { lastUrl: long }),
          item('i5', { homeUrl: 'file:///tmp/x', lastUrl: 'chrome://newtab/' }),
          item('i6', { homeUrl: 'about:blank', lastUrl: 'http://a.test/' }),
          item('i7', { homeUrl: 'not a url', lastUrl: 'view-source:https://a.test/' }),
          item('i8', { lastUrl: 'chrome-extension://abcdef/suspended.html#u=x' }),
        ],
      }),
    ]);
    const out = parseLayoutStore(raw).layouts[0];
    expect(out).toBeDefined();
    const urls = flattenItems(out as WindowLayout).map((i) => [i.id, i.homeUrl, i.lastUrl]);
    expect(urls).toEqual([
      ['i1', 'https://a.test/x', 'https://a.test/x'],
      ['i3', 'https://a.test/', 'https://a.test/'],
      ['i4', 'https://a.test/', 'https://a.test/'],
      ['i5', 'file:///tmp/x', 'chrome://newtab/'],
      ['i6', 'about:blank', 'http://a.test/'],
      ['i8', 'https://a.test/', 'chrome-extension://abcdef/suspended.html#u=x'],
    ]);
  });

  it('drops folders nested deeper than 3 and lifts their items into the depth-3 parent', () => {
    const deep = folder('f4', [item('ix'), folder('f5', [item('iy')])]);
    const raw = store([
      layout(1, {
        pinned: [folder('f1', [folder('f2', [folder('f3', [deep, item('iz')])])]), item('ilast')],
      }),
    ]);
    const out = parseLayoutStore(raw).layouts[0] as WindowLayout;
    const f1 = out.pinned[0] as PinFolder;
    const f2 = f1.children[0] as PinFolder;
    const f3 = f2.children[0] as PinFolder;
    expect(f3.id).toBe('f3');
    expect(f3.children.map((n) => n.id)).toEqual(['ix', 'iy', 'iz']);
    expect(f3.children.every((n) => n.kind === 'item')).toBe(true);
    expect(out.pinned.map((n) => n.id)).toEqual(['f1', 'ilast']);
    expect(findNode(out, 'f4')).toBeNull();
  });

  it('truncates to MAX_ITEMS items per layout in flatten order', () => {
    const essentials = Array.from({ length: MAX_ITEMS + 100 }, (_, i) => item(`i${i}`));
    const raw = store([layout(1, { essentials })]);
    const out = parseLayoutStore(raw).layouts[0] as WindowLayout;
    const flat = flattenItems(out);
    expect(flat).toHaveLength(MAX_ITEMS);
    expect(flat[0]?.id).toBe('i0');
    expect(flat[MAX_ITEMS - 1]?.id).toBe(`i${MAX_ITEMS - 1}`);
  });

  it('keeps every bound layout but at most MAX_SETUPS unbound ones (highest lastUsed)', () => {
    const total = MAX_SETUPS + 10;
    const layouts = Array.from({ length: total }, (_, i) => layout(i + 1));
    const raw = store(layouts, [{ windowId: 7, layoutId: lid(1) }]);
    const out = parseLayoutStore(raw).layouts.map((l) => l.id);
    expect(out).toHaveLength(MAX_SETUPS + 1);
    expect(out).toContain(lid(1));
    expect(out).toContain(lid(total));
    expect(out).not.toContain(lid(2));
    expect(out).toContain(lid(11));
  });

  it('drops bindings that reference unknown layouts', () => {
    const raw = store(
      [layout(1)],
      [
        { windowId: 1, layoutId: lid(1) },
        { windowId: 2, layoutId: lid(99) },
      ],
    );
    expect(parseLayoutStore(raw).bindings).toEqual([{ windowId: 1, layoutId: lid(1) }]);
  });

  it('binds a layout to at most one window; the first binding wins', () => {
    const raw = store(
      [layout(1), layout(2)],
      [
        { windowId: 1, layoutId: lid(1) },
        { windowId: 2, layoutId: lid(1) },
        { windowId: 3, layoutId: lid(2) },
      ],
    );
    expect(parseLayoutStore(raw).bindings).toEqual([
      { windowId: 1, layoutId: lid(1) },
      { windowId: 3, layoutId: lid(2) },
    ]);
  });

  it('trims layout names to 100 chars', () => {
    const raw = store([layout(1, { name: 'x'.repeat(150) })]);
    expect(parseLayoutStore(raw).layouts[0]?.name).toHaveLength(100);
  });

  it('resets tabId to null only when it is not a non-negative integer', () => {
    const raw = store([
      layout(1, {
        essentials: [
          item('i1', { tabId: 5 }),
          item('i2', { tabId: -1 }),
          item('i3', { tabId: 1.5 }),
          item('i4', { tabId: 'x' }),
          item('i5', { tabId: 0 }),
        ],
      }),
    ]);
    const flat = flattenItems(parseLayoutStore(raw).layouts[0] as WindowLayout);
    expect(flat.map((i) => i.tabId)).toEqual([5, null, null, null, 0]);
  });
});

describe('flattenItems', () => {
  it('returns essentials first, then pinned depth-first', () => {
    const l: WindowLayout = {
      id: lid(1),
      name: null,
      essentials: [item('a'), item('b')] as PinItem[],
      pinned: [
        item('c'),
        folder('F1', [item('d'), folder('F2', [item('e')])]),
        item('f'),
      ] as WindowLayout['pinned'],
      collapsed: [],
      incognito: false,
      lastUsed: 0,
    };
    expect(ids(flattenItems(l))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

describe('isEmptyLayout', () => {
  it('is true for a fresh layout and false once a folder exists', () => {
    const l = emptyLayout(false);
    expect(isEmptyLayout(l)).toBe(true);
    l.pinned.push({
      kind: 'folder',
      id: 'f1',
      name: 'F',
      icon: 'folder',
      collapsed: false,
      children: [],
    });
    expect(isEmptyLayout(l)).toBe(false);
  });
});

describe('newId and storage keys', () => {
  it('generates prefixed 11-char ids of [a-z0-9]', () => {
    for (const p of ['l', 'i', 'f'] as const) {
      expect(newId(p)).toMatch(new RegExp(`^${p}[a-z0-9]{10}$`));
    }
  });

  it('uses separate storage keys for incognito', () => {
    expect(LAYOUTS_KEY).toBe('layouts');
    expect(INCOGNITO_LAYOUTS_KEY).toBe('layouts:incognito');
  });
});

it('preserves named layouts without pins and validates bounded restart evidence', () => {
  const raw = store([
    layout(1, {
      name: 'Work',
      tabUrls: [
        7,
        'javascript:alert(1)',
        'https://work.test/',
        ...Array(MAX_ITEMS + 1).fill('https://other.test/'),
      ],
    }),
  ]);
  const parsed = parseLayoutStore(raw).layouts[0] as WindowLayout;
  expect(isEmptyLayout(parsed)).toBe(false);
  expect(parsed.tabUrls?.[0]).toBe('https://work.test/');
  expect(parsed.tabUrls).toHaveLength(MAX_ITEMS);
});

describe('per-window look', () => {
  it('keeps a valid theme id and icon, drops bad ones, and keeps a look-only layout', () => {
    const base = { id: 'labcdefghij', name: null, essentials: [], pinned: [], collapsed: [] };
    const store = parseLayoutStore({
      v: 1,
      layouts: [
        { ...base, themeId: 'custom-x1', icon: 'code' },
        { ...base, id: 'lbbbbbbbbbb', themeId: 'Bad Id; }', icon: 'skull' },
      ],
      bindings: [],
    });
    expect(store.layouts[0]).toMatchObject({ themeId: 'custom-x1', icon: 'code' });
    expect(store.layouts[1]).not.toHaveProperty('themeId');
    expect(store.layouts[1]).not.toHaveProperty('icon');
    expect(isEmptyLayout(store.layouts[0] as WindowLayout)).toBe(false);
    expect(isEmptyLayout(store.layouts[1] as WindowLayout)).toBe(true);
  });

  it('validates setWindowLook messages', () => {
    expect(parsePanelMessage({ type: 'setWindowLook', windowId: 1, themeId: 'nord' })).toEqual({
      type: 'setWindowLook',
      windowId: 1,
      themeId: 'nord',
    });
    expect(parsePanelMessage({ type: 'setWindowLook', windowId: 1, icon: null })).toEqual({
      type: 'setWindowLook',
      windowId: 1,
      icon: null,
    });
    expect(parsePanelMessage({ type: 'setWindowLook', windowId: 1, themeId: 'x;}' })).toBeNull();
    expect(parsePanelMessage({ type: 'setWindowLook', windowId: 1, icon: 'skull' })).toBeNull();
  });
});

describe('isLayoutUrl', () => {
  it('refuses Chrome debug pages that crash or hang the browser', () => {
    expect(isLayoutUrl('chrome://crash')).toBe(false);
    expect(isLayoutUrl('CHROME://hang/')).toBe(false);
    for (const u of [
      ' chrome://kill',
      '\tchrome://kill',
      'chrome:kill',
      'chrome:/kill',
      'chrome:///kill',
      'chrome://cr\tash',
      'chrome://gpucrash',
      'chrome://gpuhang',
      'chrome://memory-exhaust',
    ])
      expect(isLayoutUrl(u), JSON.stringify(u)).toBe(false);
    expect(isLayoutUrl('chrome://gpu')).toBe(true);
    expect(isLayoutUrl('chrome://settings')).toBe(true);
    expect(isLayoutUrl('file:///home/me/notes.txt')).toBe(true);
  });
});
