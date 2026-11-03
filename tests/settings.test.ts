import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_FONT, DEFAULT_SETTINGS, LIMITS, SETTINGS_VERSION } from '../src/settings/schema';

const D = DEFAULT_SETTINGS.appearance;
const mig = (appearance: Record<string, unknown>) =>
  migrateSettings({ version: SETTINGS_VERSION, appearance });

describe('migrateSettings: non-objects', () => {
  it.each([undefined, null, 42, 'x', []])('%j -> defaults', (v) => {
    expect(migrateSettings(v)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns a fresh object each time', () => {
    const a = migrateSettings(undefined);
    expect(a).not.toBe(DEFAULT_SETTINGS);
    expect(a.appearance).not.toBe(DEFAULT_SETTINGS.appearance);
    a.appearance.radius = 1;
    a.appearance.themeId = 'mutated';
    expect(DEFAULT_SETTINGS.appearance.radius).toBe(14);
    expect(DEFAULT_SETTINGS.appearance.themeId).toBe('abyss');
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitized output is also not aliased to defaults', () => {
    const a = migrateSettings({ version: SETTINGS_VERSION });
    expect(a.appearance).not.toBe(DEFAULT_SETTINGS.appearance);
  });
});

describe('migrateSettings: versions', () => {
  const valid = {
    themeId: 'abyss',
    mode: 'dark',
    density: 'compact',
    radius: 8,
    fontFamily: 'Georgia, serif',
    fontSize: 15,
    accent: null,
    motion: 'system' as const,
  };
  const full = { ...DEFAULT_SETTINGS, appearance: valid };

  it('keeps valid appearance on an unversioned object and stamps the version', () => {
    const r = migrateSettings({ appearance: valid });
    expect(r).toEqual(full);
  });

  it('current-version round-trip is identity', () => {
    const s = full;
    expect(migrateSettings(s)).toEqual(s);
    expect(migrateSettings(migrateSettings(s))).toEqual(s);
    expect(migrateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('reads newer versions best-effort and drops unknown fields', () => {
    const r = migrateSettings({
      version: 99,
      appearance: { ...valid, futureThing: true, mode: 'dark' },
      somethingNew: { a: 1 },
    });
    expect(r).toEqual(full);
    expect(r).not.toHaveProperty('somethingNew');
    expect(r.appearance).not.toHaveProperty('futureThing');
  });

  it('newer version with an invalid field only resets that field', () => {
    const r = migrateSettings({ version: 99, appearance: { ...valid, mode: 'neon' } });
    expect(r.appearance).toEqual({ ...valid, mode: D.mode });
  });

  it.each([-1, 1.5, '1', NaN, null])('odd version %j still yields valid settings', (version) => {
    const r = migrateSettings({ version, appearance: valid });
    expect(r.version).toBe(SETTINGS_VERSION);
    expect(r.appearance).toEqual(valid);
  });
});

describe('migrateSettings: appearance', () => {
  it.each([undefined, null, 'x', 5, [], [1]])(
    'invalid appearance %j -> default appearance',
    (appearance) => {
      expect(migrateSettings({ version: SETTINGS_VERSION, appearance })).toEqual(DEFAULT_SETTINGS);
    },
  );

  it('missing appearance -> default appearance', () => {
    expect(migrateSettings({ version: SETTINGS_VERSION })).toEqual(DEFAULT_SETTINGS);
  });

  it('empty appearance -> defaults', () => {
    expect(mig({}).appearance).toEqual(D);
  });
});

describe('migrateSettings: per-field fallback', () => {
  const others = {
    themeId: 'custom',
    mode: 'light',
    density: 'compact',
    radius: 5,
    fontFamily: 'Arial',
    fontSize: 12,
  };

  function onlyFieldReset(field: keyof typeof others, bad: unknown) {
    const r = mig({ ...others, [field]: bad }).appearance;
    expect(r[field]).toBe(D[field]);
    for (const k of Object.keys(others) as (keyof typeof others)[]) {
      if (k !== field) expect(r[k]).toBe(others[k]);
    }
  }

  it.each(['purple', '', 3, null, 'DARK'])('mode %j', (v) => onlyFieldReset('mode', v));
  it.each([3, 'tiny', null, 'Compact'])('density %j', (v) => onlyFieldReset('density', v));
  it.each([123, null, {}, 'x'.repeat(65)])('themeId %j', (v) => onlyFieldReset('themeId', v));
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '14', null])(
    'radius %j',
    (v) => onlyFieldReset('radius', v),
  );
  it.each([Number.NaN, Number.POSITIVE_INFINITY, '13', undefined, true])('fontSize %j', (v) =>
    onlyFieldReset('fontSize', v),
  );
  it.each([5, null, ''])('fontFamily %j', (v) => onlyFieldReset('fontFamily', v));

  it('themeId of 64 chars is accepted, 65 rejected', () => {
    expect(mig({ themeId: 'a'.repeat(64) }).appearance.themeId).toBe('a'.repeat(64));
    expect(mig({ themeId: 'a'.repeat(65) }).appearance.themeId).toBe(D.themeId);
  });

  it('accepts every valid mode and density', () => {
    for (const mode of ['system', 'light', 'dark'])
      expect(mig({ mode }).appearance.mode).toBe(mode);
    for (const density of ['compact', 'comfortable'])
      expect(mig({ density }).appearance.density).toBe(density);
  });
});

describe('migrateSettings: numeric clamping', () => {
  it('clamps radius to LIMITS', () => {
    expect(mig({ radius: -5 }).appearance.radius).toBe(LIMITS.radius.min);
    expect(mig({ radius: 1000 }).appearance.radius).toBe(LIMITS.radius.max);
    expect(mig({ radius: 0 }).appearance.radius).toBe(0);
    expect(mig({ radius: 24 }).appearance.radius).toBe(24);
  });

  it('clamps fontSize to LIMITS', () => {
    expect(mig({ fontSize: 1 }).appearance.fontSize).toBe(LIMITS.fontSize.min);
    expect(mig({ fontSize: 99 }).appearance.fontSize).toBe(LIMITS.fontSize.max);
    expect(mig({ fontSize: 11 }).appearance.fontSize).toBe(11);
    expect(mig({ fontSize: 16 }).appearance.fontSize).toBe(16);
  });

  it('rounds floats', () => {
    expect(mig({ radius: 10.4 }).appearance.radius).toBe(10);
    expect(mig({ radius: 10.6 }).appearance.radius).toBe(11);
    expect(mig({ fontSize: 13.5 }).appearance.fontSize).toBe(14);
    expect(mig({ fontSize: 12.2 }).appearance.fontSize).toBe(12);
  });

  it('rounds then clamps', () => {
    expect(mig({ radius: 24.4 }).appearance.radius).toBe(24);
    expect(mig({ radius: 23.6 }).appearance.radius).toBe(24);
    expect(mig({ radius: -0.4 }).appearance.radius + 0).toBe(0);
  });
});

describe('migrateSettings: fontFamily safety', () => {
  const rejected: [string, string][] = [
    ['semicolon', 'Arial; color: red'],
    ['open brace', 'Arial { x'],
    ['close brace', 'Arial } body'],
    ['url(', 'url(http://evil.example/f.woff)'],
    ['newline', 'Arial\nserif'],
    ['carriage return', 'Arial\rserif'],
    ['over 200 chars', 'a'.repeat(201)],
    ['empty', ''],
    ['parenthesis', 'Arial(1)'],
    ['backslash', 'Arial\\3b'],
    ['slash comment', 'Arial/*x*/'],
    ['angle bracket', 'Arial<script>'],
    ['at-rule', '@import'],
    ['colon', 'a:b'],
  ];
  it.each(rejected)('rejects %s', (_n, f) => {
    expect(mig({ fontFamily: f }).appearance.fontFamily).toBe(DEFAULT_FONT);
  });

  it('accepts a normal stack with quotes', () => {
    const f = '"Segoe UI", \'Helvetica Neue\', Roboto, sans-serif';
    expect(mig({ fontFamily: f }).appearance.fontFamily).toBe(f);
  });

  it('accepts the default font and exactly 200 chars', () => {
    expect(mig({ fontFamily: DEFAULT_FONT }).appearance.fontFamily).toBe(DEFAULT_FONT);
    expect(mig({ fontFamily: 'a'.repeat(200) }).appearance.fontFamily).toBe('a'.repeat(200));
  });
});
