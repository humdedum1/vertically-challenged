import { migrateSettings } from '../settings/migrate';
import type { Settings } from '../settings/schema';
import { parseBackupLayouts, type WindowLayout } from '../shared/layout';
import { type ParseResult, parseTheme, ROLES, type Theme } from './palette';

export const BACKUP_FORMAT = 'vertically-challenged';
export const BACKUP_VERSION = 1;
/** Maximum theme or backup file size accepted by the panel. */
export const MAX_IMPORT_BYTES = 1_000_000;
export const MAX_NAME = 60;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  kind: 'backup';
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  settings: Settings;
  themes: { id: string; name: string; dark: Theme['dark']; light: Theme['light'] }[];
  layouts: WindowLayout[];
}

export function cleanName(raw: unknown, fallback: string): string {
  // Names are rendered as text, never HTML, but control characters still make a mess.
  const s =
    typeof raw === 'string'
      ? raw
          .replace(/\p{Cc}/gu, '')
          .trim()
          .slice(0, MAX_NAME)
      : '';
  return s || fallback;
}

export function parseJsonText(text: string): ParseResult<unknown> {
  if (text.length > MAX_IMPORT_BYTES)
    return { ok: false, error: 'File is too large to be a theme or backup' };
  try {
    return { ok: true, value: JSON.parse(text), warnings: [] };
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
}

/** Noctalia format, so exported themes load straight into Noctalia and back. */
export function exportTheme(theme: Theme): string {
  const pick = (p: Theme['dark']) => Object.fromEntries(ROLES.map((r) => [r, p[r]]));
  return `${JSON.stringify({ dark: pick(theme.dark), light: pick(theme.light) }, null, 2)}\n`;
}

/**
 * Imports one theme file. The name comes from a `name` field if present (some tools add
 * one), otherwise from the file name. The caller assigns the id.
 */
export function importTheme(text: string, fileName: string, id: string): ParseResult<Theme> {
  const json = parseJsonText(text);
  if (!json.ok) return json;
  const fromFile = fileName.replace(/\.json$/i, '');
  const raw = json.value as Record<string, unknown> | null;
  const name = cleanName(
    raw && typeof raw === 'object' ? raw.name : undefined,
    cleanName(fromFile, 'Imported theme'),
  );
  return parseTheme(json.value, { id, name });
}

export function createBackup(
  settings: Settings,
  themes: readonly Theme[],
  now = new Date(),
  layouts: readonly WindowLayout[] = [],
): string {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    kind: 'backup',
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    settings,
    themes: themes.map(({ id, name, dark, light }) => ({ id, name, dark, light })),
    layouts: parseBackupLayouts(layouts),
  };
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export interface RestoredBackup {
  settings: Settings;
  themes: Theme[];
  layouts: WindowLayout[];
}

/**
 * Restores a backup. Settings go through the normal migration (so a backup from an older
 * or newer version still loads); each theme is validated on its own and invalid ones are
 * skipped with a warning rather than failing the whole import.
 */
export function parseBackup(
  text: string,
  isCustomId: (id: string) => boolean,
): ParseResult<RestoredBackup> {
  const json = parseJsonText(text);
  if (!json.ok) return json;
  const raw = json.value;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).format !== BACKUP_FORMAT
  ) {
    return { ok: false, error: 'Not a Vertically Challenged backup file' };
  }
  const b = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const themes: Theme[] = [];
  const seen = new Set<string>();
  for (const [i, t] of (Array.isArray(b.themes) ? b.themes : []).entries()) {
    const rec = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!isCustomId(id) || seen.has(id)) {
      warnings.push(`Theme ${i + 1}: invalid or duplicate id, skipped`);
      continue;
    }
    const r = parseTheme(rec, { id, name: cleanName(rec.name, `Theme ${i + 1}`) });
    if (!r.ok) {
      warnings.push(`Theme ${i + 1}: ${r.error}`);
      continue;
    }
    seen.add(id);
    themes.push(r.value);
  }
  const layouts = parseBackupLayouts(b.layouts);
  if (Array.isArray(b.layouts) && layouts.length !== b.layouts.length)
    warnings.push('Invalid, empty, duplicate or incognito layouts were skipped');
  return { ok: true, value: { settings: migrateSettings(b.settings), themes, layouts }, warnings };
}
