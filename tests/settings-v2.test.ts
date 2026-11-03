import { describe, expect, it } from 'vitest';
import { migrateSettings, sanitizeOrder } from '../src/settings/migrate';
import {
  DEFAULT_SETTINGS,
  FONT_PRESETS,
  PANEL_IDS,
  ROW_HEIGHTS,
  rowHeight,
  SECTION_IDS,
  SETTINGS_VERSION,
  type Settings,
} from '../src/settings/schema';

const v1 = {
  version: 1,
  appearance: {
    themeId: 'nord',
    mode: 'dark',
    density: 'compact',
    radius: 6,
    fontFamily: 'Georgia, serif',
    fontSize: 15,
  },
};

describe('migration to v2/v3', () => {
  it('the default is at the current schema version', () => {
    expect(DEFAULT_SETTINGS.version).toBe(SETTINGS_VERSION);
  });

  it('v1 object keeps appearance and default-fills the new groups', () => {
    const r = migrateSettings(v1);
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.appearance).toEqual({ ...v1.appearance, accent: null, motion: 'system' });
    expect(r.tabs).toEqual(DEFAULT_SETTINGS.tabs);
    expect(r.layout).toEqual(DEFAULT_SETTINGS.layout);
  });

  it('v0 (unversioned) object migrates the same way', () => {
    const { version: _v, ...v0 } = v1;
    expect(migrateSettings(v0)).toEqual(migrateSettings(v1));
  });

  it('current-version round-trip is identity for a customised object', () => {
    const s: Settings = {
      version: SETTINGS_VERSION,
      sync: { workspaces: false, sessions: true, intervalMinutes: 1 },
      appearance: {
        ...v1.appearance,
        mode: 'dark',
        density: 'compact',
        motion: 'reduce',
        accent: '#aabbcc',
      },
      tabs: {
        newTabUrl: '',
        childTabs: false,
        layout: 'double',
        actions: 'always',
        showClose: false,
        showMute: false,
        showNewTabButton: false,
        showCount: false,
        ageDays: 7,
        lazyFavicons: false,
      },
      layout: {
        panels: [
          { id: 'history', visible: false },
          { id: 'tabs', visible: true },
          { id: 'sessions', visible: true },
          { id: 'bookmarks', visible: false },
          { id: 'settings', visible: true },
        ],
        sections: [
          { id: 'recentlyClosed', visible: false },
          { id: 'tabs', visible: true },
          { id: 'search', visible: true },
        ],
      },
      suspend: {
        auto: true,
        minutes: 10,
        skipPinned: false,
        skipAudible: false,
        whitelist: ['example.com'],
      },
      sessions: { restoreDiscarded: false },
      display: { mode: 'popup', openOnLaunch: true },
      rules: [
        { host: 'github.com', path: '', action: 'group', group: 'Code' },
        { host: 'docs.rs', path: '/tokio', action: 'pin', group: '' },
      ],
      mouse: { middle: 'suspend', double: 'close', wheelSwitch: false },
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts, newTab: ['Ctrl+Alt+T'], closeTab: [] },
    };
    expect(migrateSettings(s)).toEqual(s);
    expect(migrateSettings(migrateSettings(s))).toEqual(s);
    expect(migrateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a newer version (9) best-effort, keeping known fields and dropping unknown', () => {
    const r = migrateSettings({
      version: 9,
      appearance: { ...v1.appearance, accent: '#112233', extra: 1 },
      tabs: { layout: 'double', future: true },
      layout: { sections: [{ id: 'recentlyClosed', visible: false }], other: 1 },
      brandNew: {},
    });
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.appearance.accent).toBe('#112233');
    expect(r.appearance).not.toHaveProperty('extra');
    expect(r.tabs.layout).toBe('double');
    expect(r.tabs).not.toHaveProperty('future');
    expect(r.layout.sections[0]).toEqual({ id: 'recentlyClosed', visible: false });
    expect(r).not.toHaveProperty('brandNew');
  });
});

describe('tabs per-field fallback', () => {
  const tabs = (t: Record<string, unknown>) => migrateSettings({ version: 2, tabs: t }).tabs;
  const D = DEFAULT_SETTINGS.tabs;

  it.each(['triple', '', 1, null, 'Double'])('layout %j -> default', (v) => {
    expect(tabs({ layout: v }).layout).toBe(D.layout);
  });
  it.each(['sometimes', '', 0, null, 'HOVER'])('actions %j -> default', (v) => {
    expect(tabs({ actions: v }).actions).toBe(D.actions);
  });
  it('accepts every valid layout and actions value', () => {
    for (const layout of ['single', 'double']) expect(tabs({ layout }).layout).toBe(layout);
    for (const actions of ['hover', 'always']) expect(tabs({ actions }).actions).toBe(actions);
  });

  it.each(['showClose', 'showMute', 'showNewTabButton', 'showCount'] as const)(
    '%s falls back for non-booleans and keeps real booleans',
    (key) => {
      for (const bad of ['false', 'true', 0, 1, null, {}]) {
        expect(tabs({ [key]: bad })[key]).toBe(D[key]);
      }
      expect(tabs({ [key]: false })[key]).toBe(false);
      expect(tabs({ [key]: true })[key]).toBe(true);
    },
  );

  it('one bad field does not reset the others', () => {
    const r = tabs({ layout: 'bogus', actions: 'always', showClose: false });
    expect(r.layout).toBe(D.layout);
    expect(r.actions).toBe('always');
    expect(r.showClose).toBe(false);
  });

  it.each([null, 'x', 5, []])('non-object tabs %j -> defaults', (t) => {
    expect(migrateSettings({ version: 2, tabs: t }).tabs).toEqual(D);
  });
});

describe('appearance.accent', () => {
  const accent = (a: unknown) =>
    migrateSettings({ version: 2, appearance: { accent: a } }).appearance.accent;

  it('accepts #rrggbb and lowercases it', () => {
    expect(accent('#aabbcc')).toBe('#aabbcc');
    expect(accent('#AABBCC')).toBe('#aabbcc');
    expect(accent('#1A2b3C')).toBe('#1a2b3c');
  });
  it.each([
    '#abc',
    'aabbcc',
    '#aabbccdd',
    '#gggggg',
    'red',
    '',
    ' #aabbcc',
    '#aabbcc;',
    5,
    true,
    {},
    undefined,
    null,
  ])('invalid accent %j -> null', (v) => {
    expect(accent(v)).toBeNull();
  });
});

describe('sanitizeOrder', () => {
  const ids = ['a', 'b', 'c', 'd'] as const;

  it('keeps stored order and visibility', () => {
    const raw = [
      { id: 'c', visible: false },
      { id: 'a', visible: true },
      { id: 'd', visible: false },
      { id: 'b', visible: true },
    ];
    expect(sanitizeOrder(raw, ids)).toEqual(raw);
  });

  it('drops unknown ids, duplicates and non-objects', () => {
    const r = sanitizeOrder(
      [
        { id: 'b', visible: false },
        { id: 'zzz' },
        { id: 'b', visible: true },
        null,
        'a',
        3,
        { visible: true },
      ],
      ids,
    );
    expect(r.map((x) => x.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(r[0]).toEqual({ id: 'b', visible: false });
  });

  it('appends missing ids as visible', () => {
    expect(sanitizeOrder([{ id: 'c', visible: false }], ids)).toEqual([
      { id: 'c', visible: false },
      { id: 'a', visible: true },
      { id: 'b', visible: true },
      { id: 'd', visible: true },
    ]);
  });

  it.each([undefined, null, 'x', 5, {}])(
    'non-array %j -> all ids visible in canonical order',
    (raw) => {
      expect(sanitizeOrder(raw, ids)).toEqual(ids.map((id) => ({ id, visible: true })));
    },
  );

  it('coerces non-boolean visible to true', () => {
    const r = sanitizeOrder(
      [
        { id: 'a', visible: 'false' },
        { id: 'b', visible: 0 },
        { id: 'c', visible: null },
        { id: 'd' },
      ],
      ids,
    );
    expect(r.every((x) => x.visible)).toBe(true);
  });

  it('forces alwaysVisible ids visible', () => {
    const r = sanitizeOrder(
      [
        { id: 'a', visible: false },
        { id: 'b', visible: false },
      ],
      ids,
      ['a'],
    );
    expect(r.find((x) => x.id === 'a')?.visible).toBe(true);
    expect(r.find((x) => x.id === 'b')?.visible).toBe(false);
  });

  it('always returns a full permutation', () => {
    const r = sanitizeOrder([{ id: 'd' }, { id: 'd' }, { id: 'q' }], ids);
    expect([...r.map((x) => x.id)].sort()).toEqual([...ids]);
  });
});

describe('layout panels and sections', () => {
  const layout = (l: unknown) => migrateSettings({ version: 2, layout: l }).layout;

  it('tabs and settings panels cannot be hidden', () => {
    const r = layout({ panels: PANEL_IDS.map((id) => ({ id, visible: false })) });
    for (const id of ['sessions', 'bookmarks', 'history'])
      expect(r.panels.find((p) => p.id === id)?.visible).toBe(false);
    expect(r.panels.find((p) => p.id === 'tabs')?.visible).toBe(true);
    expect(r.panels.find((p) => p.id === 'settings')?.visible).toBe(true);
  });

  it('other panels can be hidden', () => {
    const r = layout({ panels: [{ id: 'history', visible: false }] });
    expect(r.panels.find((p) => p.id === 'history')?.visible).toBe(false);
  });

  it('the tabs section cannot be hidden, others can', () => {
    const r = layout({ sections: SECTION_IDS.map((id) => ({ id, visible: false })) });
    expect(r.sections.find((s) => s.id === 'tabs')?.visible).toBe(true);
    expect(r.sections.find((s) => s.id === 'search')?.visible).toBe(false);
    expect(r.sections.find((s) => s.id === 'recentlyClosed')?.visible).toBe(false);
  });

  it('panel and section reorders are kept', () => {
    const r = layout({
      panels: [{ id: 'settings' }, { id: 'tabs' }],
      sections: [{ id: 'recentlyClosed' }, { id: 'search' }],
    });
    expect(r.panels.map((p) => p.id)).toEqual([
      'settings',
      'tabs',
      'sessions',
      'bookmarks',
      'history',
    ]);
    expect(r.sections.map((s) => s.id)).toEqual(['recentlyClosed', 'search', 'tabs']);
  });

  it.each([null, 'x', 7, [], { panels: 'nope', sections: 3 }])(
    'invalid layout %j -> defaults',
    (l) => {
      expect(layout(l)).toEqual(DEFAULT_SETTINGS.layout);
    },
  );
});

describe('fresh results', () => {
  it('mutating migrated defaults, including nested arrays, never changes DEFAULT_SETTINGS', () => {
    const snapshot = structuredClone(DEFAULT_SETTINGS);
    for (const input of [undefined, { version: 2 }, v1]) {
      const r = migrateSettings(input);
      r.appearance.radius = 0;
      r.appearance.accent = '#000000';
      r.tabs.showClose = false;
      r.tabs.layout = 'double';
      (r.layout.panels[0] as { visible: boolean }).visible = false;
      r.layout.panels.reverse();
      r.layout.panels.push({ id: 'tabs', visible: true });
      (r.layout.sections[0] as { visible: boolean }).visible = false;
      r.layout.sections.length = 0;
      expect(DEFAULT_SETTINGS).toEqual(snapshot);
    }
    expect(migrateSettings(undefined)).toEqual(snapshot);
  });

  it('results do not alias each other or the input', () => {
    const a = migrateSettings(undefined);
    const b = migrateSettings(undefined);
    expect(a.layout.panels).not.toBe(b.layout.panels);
    expect(a.layout.panels[0]).not.toBe(b.layout.panels[0]);
    expect(a.tabs).not.toBe(DEFAULT_SETTINGS.tabs);
    const input = { version: 2, layout: { panels: [{ id: 'history', visible: false }] } };
    const r = migrateSettings(input);
    (r.layout.panels[0] as { visible: boolean }).visible = true;
    expect(input.layout.panels[0]?.visible).toBe(false);
  });
});

describe('schema helpers', () => {
  it('rowHeight covers all four layout x density combinations', () => {
    const at = (layout: 'single' | 'double', density: 'compact' | 'comfortable') => {
      const s = structuredClone(DEFAULT_SETTINGS);
      s.tabs.layout = layout;
      s.appearance.density = density;
      return rowHeight(s);
    };
    expect(at('single', 'compact')).toBe(ROW_HEIGHTS.single.compact);
    expect(at('single', 'comfortable')).toBe(ROW_HEIGHTS.single.comfortable);
    expect(at('double', 'compact')).toBe(ROW_HEIGHTS.double.compact);
    expect(at('double', 'comfortable')).toBe(ROW_HEIGHTS.double.comfortable);
    expect(
      new Set([
        at('single', 'compact'),
        at('single', 'comfortable'),
        at('double', 'compact'),
        at('double', 'comfortable'),
      ]).size,
    ).toBe(4);
    expect(at('double', 'compact')).toBeGreaterThan(at('single', 'comfortable'));
  });

  it('DEFAULT_SETTINGS panels and sections are full permutations, all visible', () => {
    expect(DEFAULT_SETTINGS.layout.panels.map((p) => p.id).sort()).toEqual([...PANEL_IDS].sort());
    expect(DEFAULT_SETTINGS.layout.sections.map((s) => s.id).sort()).toEqual(
      [...SECTION_IDS].sort(),
    );
    expect(DEFAULT_SETTINGS.layout.panels.every((p) => p.visible)).toBe(true);
    expect(DEFAULT_SETTINGS.layout.sections.every((s) => s.visible)).toBe(true);
  });

  it.each(FONT_PRESETS.map((p) => [p.label, p.value]))(
    'font preset "%s" passes validation',
    (_l, value) => {
      expect(
        migrateSettings({ version: 2, appearance: { fontFamily: value } }).appearance.fontFamily,
      ).toBe(value);
    },
  );
});
