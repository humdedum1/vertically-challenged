import { describe, expect, it } from 'vitest';
import { migrateSettings } from '../src/settings/migrate';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '../src/settings/schema';
import type { WindowLayout } from '../src/shared/layout';
import { BUILTIN_THEMES } from '../src/themes/builtin';
import { type Palette, parseTheme, ROLES, type Theme } from '../src/themes/palette';
import {
  BACKUP_FORMAT,
  cleanName,
  createBackup,
  exportTheme,
  importTheme,
  MAX_IMPORT_BYTES,
  MAX_NAME,
  parseBackup,
  parseJsonText,
} from '../src/themes/transfer';

const isCustom = (id: string) => /^custom-[a-z0-9]{6,32}$/.test(id);
const base = BUILTIN_THEMES[0] as Theme;
const palette = (over: Partial<Palette> = {}): Palette => ({ ...base.dark, ...over });
const theme = (id: string, name = 'Mine', over: Partial<Palette> = {}): Theme => ({
  id,
  name,
  dark: palette(over),
  light: { ...base.light },
});

describe('cleanName', () => {
  it('removes control characters including newlines and NUL', () => {
    expect(cleanName('a\nb\u0000c\td\r', 'fb')).toBe('abcd');
    expect(cleanName('\u0007\u001b[31mred', 'fb')).toBe('[31mred');
  });
  it('trims', () => {
    expect(cleanName('  hello  ', 'fb')).toBe('hello');
  });
  it('limits to 60 chars', () => {
    expect(MAX_NAME).toBe(60);
    expect(cleanName('x'.repeat(100), 'fb')).toHaveLength(60);
    expect(cleanName('x'.repeat(60), 'fb')).toHaveLength(60);
  });
  it.each(['', '   ', '\n\u0000', undefined, null, 5, {}, []])('%j -> fallback', (v) => {
    expect(cleanName(v, 'fb')).toBe('fb');
  });
});

describe('parseJsonText', () => {
  it('parses valid JSON', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, warnings: [] });
  });
  it('reports invalid JSON', () => {
    const r = parseJsonText('{nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/);
  });
  it('rejects oversized input before parsing', () => {
    const r = parseJsonText(`"${'a'.repeat(MAX_IMPORT_BYTES)}"`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i);
  });
  it('accepts input at the limit', () => {
    const body = 'a'.repeat(MAX_IMPORT_BYTES - 2);
    expect(parseJsonText(`"${body}"`).ok).toBe(true);
  });
});

describe('exportTheme', () => {
  it('has exactly dark and light keys with 16 roles each', () => {
    const o = JSON.parse(exportTheme(base));
    expect(Object.keys(o).sort()).toEqual(['dark', 'light']);
    expect(ROLES).toHaveLength(16);
    expect(Object.keys(o.dark).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(o.light).sort()).toEqual([...ROLES].sort());
  });
  it('omits id and name', () => {
    const o = JSON.parse(exportTheme(theme('custom-abc123def456', 'Secret')));
    expect(o).not.toHaveProperty('id');
    expect(o).not.toHaveProperty('name');
  });
  it.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))(
    '%s round-trips through parseTheme',
    (_id, t) => {
      const r = parseTheme(JSON.parse(exportTheme(t)), { id: t.id, name: t.name });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.dark).toEqual(t.dark);
        expect(r.value.light).toEqual(t.light);
        expect(r.warnings).toEqual([]);
      }
    },
  );
});

describe('importTheme', () => {
  const text = exportTheme(base);
  const id = 'custom-aaaaaaaaaaaa';

  it('falls back to the file name without .json', () => {
    const r = importTheme(text, 'My Theme.json', id);
    expect(r.ok && r.value.name).toBe('My Theme');
    expect(r.ok && r.value.id).toBe(id);
  });
  it('strips .JSON case-insensitively, keeps other extensions', () => {
    const a = importTheme(text, 'x.JSON', id);
    expect(a.ok && a.value.name).toBe('x');
    const b = importTheme(text, 'x.txt', id);
    expect(b.ok && b.value.name).toBe('x.txt');
  });
  it('prefers a name field', () => {
    const o = { ...JSON.parse(text), name: '  Pretty\nName ' };
    const r = importTheme(JSON.stringify(o), 'file.json', id);
    expect(r.ok && r.value.name).toBe('PrettyName');
  });
  it('uses the file name when the name field is blank or not a string', () => {
    for (const name of ['', '  ', 7, null]) {
      const r = importTheme(JSON.stringify({ ...JSON.parse(text), name }), 'file.json', id);
      expect(r.ok && r.value.name).toBe('file');
    }
  });
  it('uses the fallback name when the file name is empty', () => {
    for (const f of ['', '.json', '   .json']) {
      const r = importTheme(text, f, id);
      expect(r.ok && r.value.name).toBe('Imported theme');
    }
  });
  it('caps long names', () => {
    const r = importTheme(text, `${'n'.repeat(100)}.json`, id);
    expect(r.ok && r.value.name).toHaveLength(60);
  });
  it('passes warnings through for a flat palette', () => {
    const r = importTheme(JSON.stringify(base.dark), 'flat.json', id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.value.dark).toEqual(r.value.light);
    }
  });
  it('rejects invalid colours', () => {
    const o = JSON.parse(text);
    o.dark.mPrimary = 'red; } body { x';
    const r = importTheme(JSON.stringify(o), 'bad.json', id);
    expect(r.ok).toBe(false);
  });
  it('rejects bad JSON, arrays and non-objects', () => {
    expect(importTheme('nope', 'a.json', id).ok).toBe(false);
    expect(importTheme('[]', 'a.json', id).ok).toBe(false);
    expect(importTheme('null', 'a.json', id).ok).toBe(false);
    expect(importTheme('42', 'a.json', id).ok).toBe(false);
  });
});

describe('createBackup / parseBackup', () => {
  const settings: Settings = {
    ...structuredClone(DEFAULT_SETTINGS),
    appearance: { ...DEFAULT_SETTINGS.appearance, accent: '#123456', radius: 3 },
  };
  const themes = [
    theme('custom-aaaaaaaaaaaa', 'One'),
    theme('custom-bbbbbbbbbbbb', 'Two', { mPrimary: '#010203' }),
  ];
  const now = new Date('2026-01-02T03:04:05.000Z');

  it('writes the expected envelope', () => {
    const b = JSON.parse(createBackup(settings, themes, now));
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.kind).toBe('backup');
    expect(b.version).toBe(1);
    expect(b.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(b.themes).toHaveLength(2);
  });

  it('round-trips settings and themes', () => {
    const r = parseBackup(createBackup(settings, themes, now), isCustom);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.settings).toEqual(settings);
      expect(r.value.themes).toEqual(themes);
      expect(r.warnings).toEqual([]);
    }
  });

  it('defaults exportedAt to a valid ISO date', () => {
    const b = JSON.parse(createBackup(settings, []));
    expect(new Date(b.exportedAt).toISOString()).toBe(b.exportedAt);
  });

  it.each([
    ['not json', 'oops'],
    ['array', '[]'],
    ['null', 'null'],
    ['number', '5'],
    ['no format', '{"themes":[]}'],
    ['wrong format', '{"format":"other"}'],
  ])('rejects %s', (_n, text) => {
    expect(parseBackup(text, isCustom).ok).toBe(false);
  });

  it('rejects a plain theme file', () => {
    expect(parseBackup(exportTheme(base), isCustom).ok).toBe(false);
  });

  it('skips invalid ids, duplicate ids and bad palettes with warnings, keeping valid themes', () => {
    const good1 = theme('custom-aaaaaaaaaaaa', 'Good1');
    const good2 = theme('custom-cccccccccccc', 'Good2');
    const bad = { ...theme('custom-dddddddddddd'), dark: { ...palette(), mPrimary: 'nope' } };
    const text = JSON.stringify({
      format: BACKUP_FORMAT,
      settings,
      themes: [
        good1,
        { ...good1, name: 'Dup' },
        theme('abyss', 'BuiltinId'),
        { name: 'no id', dark: palette(), light: palette() },
        null,
        'str',
        bad,
        good2,
      ],
    });
    const r = parseBackup(text, isCustom);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.themes.map((t) => t.id)).toEqual([
        'custom-aaaaaaaaaaaa',
        'custom-cccccccccccc',
      ]);
      expect(r.value.themes[0]?.name).toBe('Good1');
      expect(r.warnings).toHaveLength(6);
      expect(r.warnings.some((w) => /Theme 7/.test(w))).toBe(true);
    }
  });

  it('sanitises theme names and uses a numbered fallback', () => {
    const t = theme('custom-aaaaaaaaaaaa', ' \nNice\u0000 ');
    const u = { ...theme('custom-bbbbbbbbbbbb'), name: 12 };
    const r = parseBackup(JSON.stringify({ format: BACKUP_FORMAT, themes: [t, u] }), isCustom);
    expect(r.ok && r.value.themes.map((x) => x.name)).toEqual(['Nice', 'Theme 2']);
  });

  it('runs settings through migration: a v1 settings object comes back at the current version', () => {
    const v1 = {
      version: 1,
      appearance: {
        themeId: 'nord',
        mode: 'light',
        density: 'compact',
        radius: 4,
        fontFamily: 'Arial',
        fontSize: 12,
      },
    };
    const r = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, settings: v1, themes: [] }),
      isCustom,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.settings.version).toBe(SETTINGS_VERSION);
      expect(r.value.settings).toEqual(migrateSettings(v1));
      expect(r.value.settings.appearance.themeId).toBe('nord');
      expect(r.value.settings.tabs).toEqual(DEFAULT_SETTINGS.tabs);
      expect(r.value.settings.layout).toEqual(DEFAULT_SETTINGS.layout);
    }
  });

  it('missing or invalid settings become defaults', () => {
    for (const s of [undefined, null, 'x', 5]) {
      const r = parseBackup(
        JSON.stringify({ format: BACKUP_FORMAT, settings: s, themes: [] }),
        isCustom,
      );
      expect(r.ok && r.value.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('handles themes missing or not an array', () => {
    for (const themesVal of [undefined, null, 'x', 5, {}]) {
      const r = parseBackup(
        JSON.stringify({ format: BACKUP_FORMAT, settings, themes: themesVal }),
        isCustom,
      );
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.themes).toEqual([]);
        expect(r.value.settings).toEqual(settings);
      }
    }
  });
});

it('backs up Staples, nested folders, dormant pins and home URLs without browser bindings', () => {
  const layouts: WindowLayout[] = [
    {
      id: 'laaaaaaaaaa',
      name: 'Work',
      incognito: false,
      lastUsed: 1,
      collapsed: [],
      tabUrls: ['https://ordinary.test/'],
      essentials: [
        {
          kind: 'item',
          id: 'mail',
          homeUrl: 'https://mail.test/',
          lastUrl: 'https://mail.test/inbox',
          title: 'Mail',
          tabId: 42,
        },
      ],
      pinned: [
        {
          kind: 'folder',
          id: 'work',
          name: 'Work',
          icon: 'work',
          collapsed: true,
          children: [
            {
              kind: 'folder',
              id: 'nested',
              name: 'Nested',
              icon: 'code',
              collapsed: false,
              children: [
                {
                  kind: 'item',
                  id: 'docs',
                  homeUrl: 'https://docs.test/',
                  lastUrl: 'https://docs.test/page',
                  title: 'Docs',
                  tabId: null,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  const privateLayout = {
    ...(layouts[0] as WindowLayout),
    id: 'lbbbbbbbbbb',
    incognito: true,
    name: 'Private',
  };
  const text = createBackup(DEFAULT_SETTINGS, [], new Date(), [...layouts, privateLayout]);
  const r = parseBackup(text, isCustom);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.value.layouts).toHaveLength(1);
  expect(r.value.layouts[0]?.essentials[0]).toMatchObject({
    homeUrl: 'https://mail.test/',
    lastUrl: 'https://mail.test/inbox',
    tabId: null,
  });
  expect(r.value.layouts[0]?.pinned).toEqual(layouts[0]?.pinned);
  expect(text).not.toContain('ordinary.test');
  expect(text).not.toContain('Private');
});

it('keeps older settings-only backups compatible and validates imported layout URLs', () => {
  const old = parseBackup(createBackup(DEFAULT_SETTINGS, []), isCustom);
  expect(old.ok && old.value.layouts).toEqual([]);
  const r = parseBackup(
    JSON.stringify({
      format: BACKUP_FORMAT,
      layouts: [
        {
          id: 'laaaaaaaaaa',
          essentials: [{ kind: 'item', id: 'bad', homeUrl: 'javascript:alert(1)', tabId: 42 }],
          pinned: [],
        },
        null,
        { id: 'invalid' },
      ],
    }),
    isCustom,
  );
  expect(r.ok && r.value.layouts).toEqual([]);
});
