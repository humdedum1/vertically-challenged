import type { Settings } from '../settings/schema';
import type { Theme } from '../themes/palette';

export const UNDO_KEY = 'vc:restore-undo';

/**
 * What a restore replaces, kept so one click can put it back: settings, custom CSS, and the
 * custom themes it overwrote or added. Sessions and layouts are only ever added by a restore
 * and are not part of the undo (they are removed from the Sessions panel).
 */
export interface RestoreUndo {
  at: number;
  settings: Settings;
  customCss: string;
  /** Themes the restore overwrote: put these versions back. */
  themes: Theme[];
  /** Theme ids the restore created: remove them. */
  addedThemeIds: string[];
}

export function buildUndo(
  before: { settings: Settings; customCss: string; themes: readonly Theme[] },
  incoming: readonly Theme[],
  now = Date.now(),
): RestoreUndo {
  const had = new Map(before.themes.map((t) => [t.id, t]));
  return {
    at: now,
    settings: before.settings,
    customCss: before.customCss,
    themes: incoming.flatMap((t) => (had.has(t.id) ? [had.get(t.id) as Theme] : [])),
    addedThemeIds: incoming.filter((t) => !had.has(t.id)).map((t) => t.id),
  };
}
