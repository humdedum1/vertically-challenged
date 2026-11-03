import { encode } from '../../backup/codec';
import { backupName, selectToDelete } from '../../backup/retention';
import { buildFullBackup, type FullParts } from '../../backup/snapshot';

export const CONFIG_KEY = 'vc:backup:config';
export const STATUS_KEY = 'vc:backup:status';
export const BACKUP_ALARM = 'vc-auto-backup';

export type Interval = 'off' | 'daily' | 'weekly';
/** Per machine, in storage.local: never synced and never part of a backup. */
export interface BackupConfig {
  interval: Interval;
  /** Empty = unencrypted. Stored locally so unattended runs can encrypt; see the design spec. */
  passphrase: string;
  keep: number;
}
export interface BackupStatus {
  at?: number;
  name?: string;
  hash?: string;
  error?: string;
  skipped?: boolean;
}
export interface BackupTarget {
  put(name: string, bytes: Uint8Array): Promise<void>;
  /** Present only when the target can enumerate and delete, which enables retention. */
  list?(): Promise<string[]>;
  delete?(name: string): Promise<void>;
}
export interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export interface SchedulerDeps {
  storage: StorageLike;
  collect(): Promise<FullParts>;
  target(): BackupTarget;
  version: string;
  device: () => Promise<string>;
  now?: () => Date;
}

export const DEFAULT_CONFIG: BackupConfig = { interval: 'off', passphrase: '', keep: 7 };

export function parseConfig(raw: unknown): BackupConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const interval: Interval = r.interval === 'daily' || r.interval === 'weekly' ? r.interval : 'off';
  const keep = typeof r.keep === 'number' && r.keep >= 1 && r.keep <= 100 ? Math.floor(r.keep) : 7;
  return { interval, keep, passphrase: typeof r.passphrase === 'string' ? r.passphrase : '' };
}

export const intervalMinutes = (i: Interval): number =>
  i === 'daily' ? 1440 : i === 'weekly' ? 10080 : 0;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Runs one backup. `force` ignores the unchanged-content skip (Back up now). Never throws. */
export async function runBackup(deps: SchedulerDeps, force = false): Promise<BackupStatus> {
  const now = (deps.now ?? (() => new Date()))();
  const stored = await deps.storage.get(STATUS_KEY);
  const prev = (stored[STATUS_KEY] ?? {}) as BackupStatus;
  let status: BackupStatus;
  try {
    const cfg = parseConfig((await deps.storage.get(CONFIG_KEY))[CONFIG_KEY]);
    const parts = await deps.collect();
    // Hash with a fixed clock so only real content changes count as a change.
    const hash = await sha256(JSON.stringify(buildFullBackup(parts, deps.version, new Date(0))));
    if (!force && hash === prev.hash && !prev.error) {
      status = { ...prev, skipped: true };
    } else {
      const bytes = await encode(buildFullBackup(parts, deps.version, now), cfg.passphrase);
      const target = deps.target();
      const name = backupName(now, await deps.device());
      await target.put(name, bytes);
      if (target.list && target.delete) {
        for (const old of selectToDelete(await target.list(), cfg.keep)) await target.delete(old);
      }
      status = { at: now.getTime(), name, hash };
    }
  } catch (err) {
    status = {
      ...prev,
      error: err instanceof Error ? err.message : 'Backup failed',
      skipped: false,
    };
  }
  await deps.storage.set({ [STATUS_KEY]: status });
  return status;
}
