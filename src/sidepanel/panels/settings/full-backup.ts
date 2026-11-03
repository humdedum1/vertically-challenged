import { browser } from 'wxt/browser';
import { CONFIG_KEY, parseConfig } from '../../../background/backup/scheduler';
import { BackupError, decode, encode, isEncrypted, MAX_BACKUP_BYTES } from '../../../backup/codec';
import { makeTarget } from '../../../backup/make-target';
import { BACKUP_FILE } from '../../../backup/retention';
import { buildFullBackup, parseFullBackup, type RestoredFull } from '../../../backup/snapshot';
import type { BackupTarget } from '../../../backup/targets';
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

/** Decodes and validates backup bytes; nothing is written. */
export async function openFullBackupBytes(bytes: Uint8Array, passphrase: string): Promise<Opened> {
  if (bytes.length > MAX_BACKUP_BYTES)
    return { ok: false, error: 'File is too large to be a backup' };
  try {
    const r = parseFullBackup(await decode(bytes, passphrase), isCustomId);
    return r.ok ? { ok: true, value: r.value, warnings: r.warnings } : r;
  } catch (err) {
    if (!(err instanceof BackupError)) throw err;
    return { ok: false, error: err.message, needsPassphrase: isEncrypted(bytes) && !passphrase };
  }
}

export async function openFullBackup(file: File, passphrase: string): Promise<Opened> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, error: 'File is too large to be a backup' };
  return openFullBackupBytes(new Uint8Array(await file.arrayBuffer()), passphrase);
}

async function remoteTarget(): Promise<
  BackupTarget & Required<Pick<BackupTarget, 'list' | 'get'>>
> {
  const stored = (await browser.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
  const cfg = parseConfig(stored);
  const t = makeTarget(cfg, () => ({ put: async () => {} }));
  if (cfg.target === 'downloads' || !t.list || !t.get)
    throw new Error('Choose and save a server under Automatic backups first');
  return t as BackupTarget & Required<Pick<BackupTarget, 'list' | 'get'>>;
}

/** Backup file names on the configured server, newest first. */
export async function listRemoteBackups(): Promise<string[]> {
  const t = await remoteTarget();
  return (await t.list())
    .filter((n) => BACKUP_FILE.test(n))
    .sort()
    .reverse();
}

export async function openRemoteBackup(name: string, passphrase: string): Promise<Opened> {
  if (!BACKUP_FILE.test(name)) return { ok: false, error: 'Not a backup file name' };
  return openFullBackupBytes(await (await remoteTarget()).get(name), passphrase);
}

/** Additive parts only; settings and themes are applied by the caller (they own that state). */
/** Returns how many sessions were actually added (the rest already existed or exceeded the cap). */
export async function restoreFullExtras(r: RestoredFull): Promise<number> {
  if (r.layouts.length) {
    const res: { ok: boolean; error?: string } = await browser.runtime.sendMessage({
      type: 'restoreBackupLayouts',
      layouts: r.layouts,
    });
    if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t restore pinned layouts');
  }
  let added = 0;
  if (r.sessions.length) {
    const res: { ok: boolean; count?: number; error?: string } = await browser.runtime.sendMessage({
      type: 'restoreSessions',
      sessions: r.sessions,
    });
    if (!res?.ok) throw new Error(res?.error ?? 'Couldn’t restore sessions');
    added = res.count ?? 0;
  }
  if (r.customCss) await browser.storage.local.set({ [CSS_KEY]: r.customCss });
  return added;
}
