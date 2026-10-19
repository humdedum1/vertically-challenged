import abyss from './abyss.json';
import { NOCTALIA_THEMES } from './noctalia';
import { parseTheme, type Theme } from './palette';

function builtin(raw: unknown, id: string, name: string): Theme {
  const r = parseTheme(raw, { id, name });
  // Bundled files are covered by tests; failing loudly beats shipping a broken palette.
  if (!r.ok) throw new Error(`Built-in theme ${id}: ${r.error}`);
  return r.value;
}

export const DEFAULT_THEME_ID = 'abyss';

export const BUILTIN_THEMES: readonly Theme[] = [
  builtin(abyss, DEFAULT_THEME_ID, 'Abyss'),
  ...NOCTALIA_THEMES.map((t) => builtin(t.raw, t.id, t.name)),
];

export function findTheme(id: string): Theme {
  return BUILTIN_THEMES.find((t) => t.id === id) ?? (BUILTIN_THEMES[0] as Theme);
}
