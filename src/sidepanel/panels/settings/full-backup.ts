import { browser } from 'wxt/browser';
import { BackupError, decode, encode, isEncrypted, MAX_BACKUP_BYTES } from '../../../backup/codec';
import { buildFullBackup, parseFullBackup, type RestoredFull } from '../../../backup/snapshot';
import type { Settings } from '../../../settings/schema';
import type { WindowLayout } from '../../../shared/layout';
import { SESSIONS_KEY } from '../../../shared/sessions';
import type { Theme } from '../../../themes/palette';
import { isCustomId } from '../../theme-registry.svelte';

const CSS_KEY = 'customCss';

/** Reads everything, builds the snapshot and encodes it (encrypted when a passphrase is given). */
export async function createFullBackup(
  settings: Settings,
  themes: readonly Theme[],
  passphrase: string,
): Promise<{ bytes: Uint8Array; sessions: number; layouts: number }> {
  const res: { ok: boolean; layouts: WindowLayout[]; error?: string } =
    await browser.runtime.sendMessage({ type: 'backupLayouts' });
  if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t read pinned layouts');
  const local = await browser.storage.local.get([SESSIONS_KEY, CSS_KEY]);
  const full = buildFullBackup(
    {
      settings,
      themes,
      layouts: res.layouts,
      sessions: local[SESSIONS_KEY],
      customCss: local[CSS_KEY],
    },
    browser.runtime.getManifest().version,
  );
  return {
    bytes: await encode(full, passphrase),
    sessions: full.sessions.length,
    layouts: full.backup.layouts.length,
  };
}

export type Opened =
  | { ok: true; value: RestoredFull; warnings: string[] }
  | { ok: false; error: string; needsPassphrase?: boolean };

/** Decodes and validates a .vcb file; nothing is written. */
export async function openFullBackup(file: File, passphrase: string): Promise<Opened> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, error: 'File is too large to be a backup' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const r = parseFullBackup(await decode(bytes, passphrase), isCustomId);
    return r.ok ? { ok: true, value: r.value, warnings: r.warnings } : r;
  } catch (err) {
    if (!(err instanceof BackupError)) throw err;
    return { ok: false, error: err.message, needsPassphrase: isEncrypted(bytes) && !passphrase };
  }
}

/** Additive parts only; settings and themes are applied by the caller (they own that state). */
export async function restoreFullExtras(r: RestoredFull): Promise<void> {
  if (r.layouts.length) {
    const res: { ok: boolean; error?: string } = await browser.runtime.sendMessage({
      type: 'restoreBackupLayouts',
      layouts: r.layouts,
    });
    if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t restore pinned layouts');
  }
  if (r.sessions.length) {
    const res: { ok: boolean; error?: string } = await browser.runtime.sendMessage({
      type: 'restoreSessions',
      sessions: r.sessions,
    });
    if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t restore sessions');
  }
  if (r.customCss) await browser.storage.local.set({ [CSS_KEY]: r.customCss });
}
