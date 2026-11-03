import { parseTheme, type Theme } from './palette';
import { cleanName } from './transfer';

/** Custom themes are storage.sync keys named theme:<id>. */
export const THEME_PREFIX = 'theme:';
export const CUSTOM_ID_PREFIX = 'custom-';
export const isCustomId = (id: string): boolean => /^custom-[a-z0-9]{6,32}$/.test(id);

/** Valid custom themes out of a storage.sync dump; anything malformed is skipped. */
export function parseCustomThemes(dump: Record<string, unknown>): Theme[] {
  const out: Theme[] = [];
  for (const [key, value] of Object.entries(dump)) {
    if (!key.startsWith(THEME_PREFIX)) continue;
    const id = key.slice(THEME_PREFIX.length);
    const name = cleanName((value as { name?: unknown } | null)?.name, 'Custom theme');
    const r = isCustomId(id) ? parseTheme(value, { id, name }) : null;
    if (r?.ok) out.push(r.value);
  }
  return out;
}
