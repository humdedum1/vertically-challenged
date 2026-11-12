import abyss from './abyss.json';
import { NOCTALIA_THEMES } from './noctalia';
import { parseTheme, type Theme } from './palette';
import { TERMINAL_THEMES } from './terminal';
import velo from './velo.json';

function builtin(raw: unknown, id: string, name: string): Theme {
  const r = parseTheme(raw, { id, name });
  // Bundled files are covered by tests; failing loudly beats shipping a broken palette.
  if (!r.ok) throw new Error(`Built-in theme ${id}: ${r.error}`);
  return r.value;
}

export const DEFAULT_THEME_ID = 'noctalia';

export const BUILTIN_THEMES: readonly Theme[] = [
  builtin(abyss, 'abyss', 'Abyss'),
  builtin(velo, 'velo', 'Velo'),
  ...NOCTALIA_THEMES.map((t) => builtin(t.raw, t.id, t.name)),
  ...TERMINAL_THEMES.map((t) => builtin(t.raw, t.id, t.name)),
];

export function findTheme(id: string): Theme {
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ??
    (BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID) as Theme)
  );
}
