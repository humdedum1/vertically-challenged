import { describe, expect, it } from 'vitest';
import { normalizeCombo } from '../src/lib/keymap';
import { migrateSettings } from '../src/settings/migrate';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  MAX_BINDINGS,
  SETTINGS_VERSION,
  SHORTCUT_ACTIONS,
} from '../src/settings/schema';

const D = DEFAULT_SETTINGS;
const suspend = (s: Record<string, unknown>) => migrateSettings({ version: 3, suspend: s }).suspend;
const keys = (s: Record<string, unknown>) =>
  migrateSettings({ version: 3, shortcuts: s }).shortcuts;

describe('v2 -> v3 migration', () => {
  const v2 = {
    version: 2,
    appearance: { ...D.appearance, mode: 'dark', accent: '#abcdef' },
    tabs: {
      layout: 'double',
      actions: 'always',
      showClose: false,
      showMute: false,
      showNewTabButton: false,
      showCount: false,
    },
    layout: {
      panels: [
        { id: 'history', visible: false },
        { id: 'tabs', visible: true },
      ],
      sections: [{ id: 'recentlyClosed', visible: false }],
    },
  };

  it('keeps everything and default-fills the new groups', () => {
    const r = migrateSettings(v2);
    expect(SETTINGS_VERSION).toBe(4);
    expect(r.version).toBe(4);
    expect(r.appearance).toEqual(v2.appearance);
    expect(r.tabs).toEqual(v2.tabs);
    expect(r.layout.panels[0]).toEqual({ id: 'history', visible: false });
    expect(r.layout.sections[0]).toEqual({ id: 'recentlyClosed', visible: false });
    expect(r.suspend).toEqual(D.suspend);
    expect(r.sessions).toEqual(D.sessions);
    expect(r.shortcuts).toEqual(D.shortcuts);
  });

  it('is idempotent and the default round-trips', () => {
    const once = migrateSettings(v2);
    expect(migrateSettings(once)).toEqual(once);
    expect(migrateSettings(D)).toEqual(D);
  });

  it('does not share mutable arrays with DEFAULT_SETTINGS', () => {
    const r = migrateSettings({});
    r.shortcuts.focusSearch.push('Z');
    r.suspend.whitelist.push('x.com');
    expect(D.shortcuts.focusSearch).toEqual(['/', 'Ctrl+F']);
    expect(D.suspend.whitelist).toEqual([]);
    const c = migrateSettings(null);
    c.shortcuts.closeTab.push('Z');
    expect(D.shortcuts.closeTab).toEqual(['Delete']);
  });

  it('sessions.restoreDiscarded is read as a boolean with a default', () => {
    expect(migrateSettings({ version: 3, sessions: { restoreDiscarded: false } }).sessions).toEqual(
      { restoreDiscarded: false },
    );
    expect(migrateSettings({ version: 3, sessions: { restoreDiscarded: 'no' } }).sessions).toEqual(
      D.sessions,
    );
    expect(migrateSettings({ version: 3, sessions: 7 }).sessions).toEqual(D.sessions);
  });
});

describe('suspend settings', () => {
  it.each([
    [0, 1],
    [-5, 1],
    [0.4, 1],
    [5000, 1440],
    [12.6, 13],
    [12.4, 12],
    [1440, 1440],
    [1, 1],
  ])('minutes %j -> %j', (input, out) => {
    expect(suspend({ minutes: input }).minutes).toBe(out);
  });

  it.each(['10', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}])(
    'non-numeric/non-finite minutes %j -> default',
    (v) => {
      expect(suspend({ minutes: v }).minutes).toBe(D.suspend.minutes);
    },
  );

  it('limits come from LIMITS', () => {
    expect(LIMITS.suspendMinutes).toEqual({ min: 1, max: 1440 });
    expect(LIMITS.whitelist).toBe(200);
  });

  it('booleans fall back individually', () => {
    expect(suspend({ auto: true, skipPinned: 'x', skipAudible: false })).toMatchObject({
      auto: true,
      skipPinned: true,
      skipAudible: false,
    });
  });

  it('whitelist: normalizes, drops invalid and duplicates, keeps order', () => {
    const r = suspend({
      whitelist: [
        'https://www.Example.com/path?q=1',
        'example.com',
        'WWW.EXAMPLE.COM',
        '*.foo.org',
        'bad host',
        '*',
        '*.com',
        'localhost:3000',
        5,
        null,
        '',
      ],
    });
    expect(r.whitelist).toEqual(['example.com', '*.foo.org', 'localhost:3000']);
  });

  it('whitelist: non-array -> empty', () => {
    expect(suspend({ whitelist: 'example.com' }).whitelist).toEqual([]);
    expect(suspend({}).whitelist).toEqual([]);
  });

  it('whitelist: capped at LIMITS.whitelist, first entries win', () => {
    const many = Array.from({ length: 250 }, (_, i) => `h${i}.com`);
    const r = suspend({ whitelist: many }).whitelist;
    expect(r).toHaveLength(LIMITS.whitelist);
    expect(r[0]).toBe('h0.com');
    expect(r[199]).toBe('h199.com');
  });

  it('whitelist: invalid entries do not consume the cap', () => {
    const list = [
      ...Array.from({ length: 50 }, () => 'nope!'),
      ...Array.from({ length: 210 }, (_, i) => `h${i}.com`),
    ];
    expect(suspend({ whitelist: list }).whitelist).toHaveLength(200);
  });
});

describe('shortcuts keymap', () => {
  it('missing keymap or non-object -> defaults', () => {
    expect(migrateSettings({ version: 3 }).shortcuts).toEqual(D.shortcuts);
    expect(keys(5 as never)).toEqual(D.shortcuts);
    expect(migrateSettings({ version: 3, shortcuts: [] }).shortcuts).toEqual(D.shortcuts);
  });

  it('missing actions get defaults; given actions override', () => {
    const r = keys({ focusSearch: ['ctrl+k'] });
    expect(r.focusSearch).toEqual(['Ctrl+K']);
    expect(r.closeTab).toEqual(D.shortcuts.closeTab);
    expect(r.moveDown).toEqual(D.shortcuts.moveDown);
  });

  it('an empty array means unbound, not default', () => {
    const r = keys({ closeTab: [], focusSearch: [] });
    expect(r.closeTab).toEqual([]);
    expect(r.focusSearch).toEqual([]);
  });

  it('non-array values fall back to defaults', () => {
    const r = keys({ renameGroup: 'F3', closeTab: null, selectAll: { 0: 'Ctrl+A' }, openMenu: 5 });
    expect(r.renameGroup).toEqual(['F2']);
    expect(r.closeTab).toEqual(['Delete']);
    expect(r.selectAll).toEqual(['Ctrl+A']);
    expect(r.openMenu).toEqual(['Shift+F10', 'ContextMenu']);
  });

  it('combos are normalized, deduped, and invalid ones dropped', () => {
    const r = keys({
      newTab: ['control+shift+t', 'Ctrl+Shift+T', '  ', 5, null, 'bogus+!', 'esc'],
    });
    expect(r.newTab).toEqual(['Ctrl+Shift+T', 'Escape']);
  });

  it('is capped at MAX_BINDINGS; invalid combos do not consume the cap', () => {
    expect(MAX_BINDINGS).toBe(2);
    expect(keys({ newTab: ['a', 'b', 'c'] }).newTab).toEqual(['A', 'B']);
    expect(keys({ newTab: ['bad key', 'a', 'a', 'b', 'c'] }).newTab).toEqual(['A', 'B']);
  });

  it('unknown actions are dropped', () => {
    expect(keys({ launchRocket: ['Ctrl+R'] })).not.toHaveProperty('launchRocket');
  });

  it('every action is present in the result', () => {
    expect(Object.keys(keys({})).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
  });

  it('DEFAULT_SETTINGS.shortcuts are stored in normal form', () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(D.shortcuts[action].length).toBeLessThanOrEqual(MAX_BINDINGS);
      for (const combo of D.shortcuts[action]) expect(normalizeCombo(combo)).toBe(combo);
    }
  });
});
