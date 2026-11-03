import type { Settings } from '../settings/schema';
import type { WindowLayout } from '../shared/layout';
import { MAX_SESSIONS, parseSessions, type Session } from '../shared/sessions';
import type { ParseResult, Theme } from '../themes/palette';
import { buildBackup, parseBackupObject, type RestoredBackup } from '../themes/transfer';

export const FULL_FORMAT = 'vc-full-backup';
export const FULL_VERSION = 1;
export const MAX_CUSTOM_CSS = 20_000;

/**
 * Everything the extension keeps that is worth restoring. Settings, themes and layouts reuse
 * the existing backup object (and its validation); sessions and custom CSS are added.
 * Excluded on purpose: device id and sync status (per machine), storage.session (incognito
 * and ephemeral), UI caches, device sync documents (re-published), and any credentials.
 */
export interface FullBackup {
  format: typeof FULL_FORMAT;
  version: typeof FULL_VERSION;
  createdAt: string;
  appVersion: string;
  backup: ReturnType<typeof buildBackup>;
  sessions: Session[];
  customCss: string;
}

export interface FullParts {
  settings: Settings;
  themes: readonly Theme[];
  layouts: readonly WindowLayout[];
  sessions: unknown;
  customCss: unknown;
}

export interface RestoredFull extends RestoredBackup {
  sessions: Session[];
  customCss: string;
}

/**
 * A backup file is untrusted input. CSS can't run script, but url() and @import would make
 * the panel fetch from any server, which a hostile file could use to leak what the panel shows.
 */
export function stripRemoteCss(css: string): { css: string; stripped: boolean } {
  const out = css.replace(/@import\b[^;]*;?/gi, '').replace(/url\s*\([^)]*\)/gi, 'none');
  return { css: out, stripped: out !== css };
}

export function buildFullBackup(
  parts: FullParts,
  appVersion: string,
  now = new Date(),
): FullBackup {
  return {
    format: FULL_FORMAT,
    version: FULL_VERSION,
    createdAt: now.toISOString(),
    appVersion,
    backup: buildBackup(parts.settings, parts.themes, now, parts.layouts),
    sessions: parseSessions(parts.sessions),
    customCss: typeof parts.customCss === 'string' ? parts.customCss.slice(0, MAX_CUSTOM_CSS) : '',
  };
}

export function parseFullBackup(
  raw: unknown,
  isCustomId: (id: string) => boolean,
): ParseResult<RestoredFull> {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (b.format !== FULL_FORMAT)
    return { ok: false, error: 'Not a full Vertically Challenged backup' };
  if (typeof b.version !== 'number' || b.version > FULL_VERSION)
    return {
      ok: false,
      error: 'This backup was made by a newer version; update the extension first',
    };
  const inner = parseBackupObject(b.backup, isCustomId);
  if (!inner.ok) return inner;
  const sessions = parseSessions(b.sessions);
  const warnings = [...inner.warnings];
  if (Array.isArray(b.sessions) && sessions.length !== b.sessions.length)
    warnings.push('Some invalid sessions were skipped');
  const css = stripRemoteCss(
    typeof b.customCss === 'string' ? b.customCss.slice(0, MAX_CUSTOM_CSS) : '',
  );
  if (css.stripped) warnings.push('Removed url() and @import from the custom CSS');
  return { ok: true, value: { ...inner.value, sessions, customCss: css.css }, warnings };
}

/** Additive restore: sessions already present (same id) are kept; existing order kept, new ones newest first, capped. */
export function mergeSessions(
  existing: readonly Session[],
  incoming: readonly Session[],
): Session[] {
  const have = new Set(existing.map((s) => s.id));
  const added = incoming.filter((s) => !have.has(s.id)).sort((a, b) => b.createdAt - a.createdAt);
  return [...existing, ...added].slice(0, MAX_SESSIONS);
}
