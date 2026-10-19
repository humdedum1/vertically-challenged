import { describe, expect, it } from 'vitest';
import abyssRaw from '../src/themes/abyss.json';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, findTheme } from '../src/themes/builtin';
import { contrastIssues, contrastRatio, TEXT_PAIRS } from '../src/themes/contrast';
import { type Palette, parseTheme, ROLES, type Theme } from '../src/themes/palette';
import { themeToCss } from '../src/themes/token-mapper';

const META = { id: 't', name: 'T' };

function pal(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  ROLES.forEach((r, i) => {
    p[r] = `#${(i + 1).toString(16).padStart(2, '0').repeat(3)}`;
  });
  return { ...p, ...overrides };
}

function abyssTheme(): Theme {
  const r = parseTheme(abyssRaw, { id: 'abyss', name: 'Abyss' });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('abyss.json', () => {
  it('parses without warnings', () => {
    const r = parseTheme(abyssRaw, META);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('has exactly 2 top-level keys', () => {
    expect(Object.keys(abyssRaw).sort()).toEqual(['dark', 'light']);
  });

  it('has all 16 roles in both variants', () => {
    expect(ROLES).toHaveLength(16);
    for (const mode of ['dark', 'light'] as const) {
      expect(Object.keys(abyssRaw[mode]).sort()).toEqual([...ROLES].sort());
    }
  });

  it('has known values', () => {
    expect(abyssRaw.dark.mPrimary).toBe('#3fd0c4');
    expect(abyssRaw.light.mSurface).toBe('#e9f1f2');
  });

  it('is the registered default builtin', () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toContain(DEFAULT_THEME_ID);
  });
});

describe('contrast', () => {
  it('computes known ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#3fd0c4', '#0b1215')).toBe(contrastRatio('#0b1215', '#3fd0c4'));
  });

  it('abyss meets WCAG AA for every text pair in both modes', () => {
    expect(TEXT_PAIRS.length).toBeGreaterThan(0);
    expect(contrastIssues(abyssTheme())).toEqual([]);
  });

  it('reports issues for low contrast themes', () => {
    const t = abyssTheme();
    const bad: Theme = { ...t, dark: { ...t.dark, mOnSurface: t.dark.mSurface } };
    const issues = contrastIssues(bad);
    expect(
      issues.some((i) => i.mode === 'dark' && i.fg === 'mOnSurface' && i.bg === 'mSurface'),
    ).toBe(true);
    expect(issues.every((i) => i.ratio < 4.5)).toBe(true);
  });
});

describe('parseTheme', () => {
  it('accepts {dark, light}', () => {
    const r = parseTheme({ dark: pal(), light: pal({ mPrimary: '#abcdef' }) }, META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toEqual([]);
      expect(r.value.id).toBe('t');
      expect(r.value.light.mPrimary).toBe('#abcdef');
      expect(r.value.dark.mPrimary).not.toBe('#abcdef');
    }
  });

  it('normalizes uppercase hex to lowercase', () => {
    const r = parseTheme({ dark: pal({ mPrimary: '#ABCDEF' }), light: pal() }, META);
    expect(r.ok && r.value.dark.mPrimary).toBe('#abcdef');
  });

  it('dark-only copies the palette with a warning', () => {
    const r = parseTheme({ dark: pal() }, META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.light).toEqual(r.value.dark);
      expect(r.warnings).toHaveLength(1);
    }
  });

  it('light-only copies the palette with a warning', () => {
    const r = parseTheme({ light: pal() }, META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dark).toEqual(r.value.light);
      expect(r.warnings).toHaveLength(1);
    }
  });

  it('accepts a flat palette with a warning', () => {
    const r = parseTheme(pal(), META);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.dark).toEqual(r.value.light);
      expect(r.warnings).toHaveLength(1);
    }
  });

  it.each([
    ['string', 'x'],
    ['number', 42],
    ['array', []],
    ['null', null],
    ['undefined', undefined],
  ])('rejects non-object (%s)', (_n, v) => {
    expect(parseTheme(v, META).ok).toBe(false);
  });

  it('rejects a missing role naming role and variant', () => {
    const light = pal();
    delete light.mShadow;
    const r = parseTheme({ dark: pal(), light }, META);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('mShadow');
      expect(r.error).toContain('light');
    }
  });

  it('names the dark variant when dark is broken', () => {
    const r = parseTheme({ dark: pal({ mHover: undefined }), light: pal() }, META);
    expect(!r.ok && r.error).toContain('dark.mHover');
  });

  it('rejects a non-object variant', () => {
    expect(parseTheme({ dark: 'nope', light: pal() }, META).ok).toBe(false);
  });

  it.each([
    ['3-digit hex', '#fff'],
    ['8-digit hex (alpha)', '#ffffff80'],
    ['named colour', 'red'],
    ['rgb()', 'rgb(0,0,0)'],
    ['no hash', 'ffffff'],
    ['non-hex digits', '#gggggg'],
    ['injection', '#000000;} body{display:none'],
    ['trailing newline', '#000000\n'],
    ['number', 0],
  ])('rejects %s', (_n, bad) => {
    const r = parseTheme({ dark: pal({ mPrimary: bad }), light: pal() }, META);
    expect(r.ok).toBe(false);
    const flat = parseTheme(pal({ mPrimary: bad }), META);
    expect(flat.ok).toBe(false);
  });

  it('ignores extra unknown keys', () => {
    const r = parseTheme(
      { name: 'x', dark: { ...pal(), extra: 'zzz' }, light: pal(), foo: 1 },
      META,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value.dark).sort()).toEqual([...ROLES].sort());
      expect(r.value.name).toBe('T');
    }
  });
});

describe('themeToCss', () => {
  const t = abyssTheme();
  const css = themeToCss(t);

  it('declares every role for both palettes', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const role of ROLES) {
        expect(css).toContain(`--${role}:${t[mode][role]};`);
      }
    }
    for (const role of ROLES) {
      expect(css.split(`--${role}:`)).toHaveLength(4);
    }
  });

  it('has the media query, forced-light block, and color-scheme', () => {
    expect(css).toContain('@media (prefers-color-scheme: light)');
    expect(css).toContain(':root:not([data-mode="dark"])');
    expect(css).toContain(':root[data-mode="light"]');
    expect(css).toContain('color-scheme:dark;');
    expect(css.match(/color-scheme:light;/g)).toHaveLength(2);
  });

  it('has balanced braces', () => {
    expect(css.match(/\{/g)?.length).toBe(css.match(/\}/g)?.length);
    expect(css.match(/\{/g)).toHaveLength(4);
  });

  it('dark is the base :root rule', () => {
    expect(css.startsWith(':root{color-scheme:dark;')).toBe(true);
  });

  it('cannot be broken out of by parsed themes', () => {
    const p = pal() as unknown as Palette;
    const r = parseTheme({ dark: p, light: p }, META);
    expect(r.ok).toBe(true);
    if (r.ok) expect(themeToCss(r.value).match(/\{/g)).toHaveLength(4);
  });
});

describe('findTheme', () => {
  it('finds a known id', () => {
    expect(findTheme('abyss').id).toBe('abyss');
  });
  it('falls back to the default for unknown ids', () => {
    expect(findTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID);
    expect(findTheme('')).toBe(findTheme(DEFAULT_THEME_ID));
  });
});
