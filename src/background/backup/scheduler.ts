import { encode } from '../../backup/codec';
import type { DropboxConfig } from '../../backup/dropbox';
import { backupName, selectToDelete } from '../../backup/retention';
import { buildFullBackup, type FullParts } from '../../backup/snapshot';
import type { BackupTarget, S3Config, WebDavConfig } from '../../backup/targets';

export type { BackupTarget };

export const CONFIG_KEY = 'vc:backup:config';
export const STATUS_KEY = 'vc:backup:status';
export const BACKUP_ALARM = 'vc-auto-backup';

export type Interval = 'off' | 'daily' | 'weekly';
export type TargetKind = 'downloads' | 'webdav' | 's3' | 'dropbox';
/**
 * Per machine, in storage.local: never synced and never part of a backup. Server credentials
 * live here in plain form (the extension needs them unattended); use an app password or a
 * bucket-scoped key.
 */
export interface BackupConfig {
  interval: Interval;
  target: TargetKind;
  webdav: WebDavConfig;
  s3: S3Config;
  dropbox: DropboxConfig;
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
export interface StorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}
export interface SchedulerDeps {
  storage: StorageLike;
  collect(): Promise<FullParts>;
  target(cfg: BackupConfig): BackupTarget;
  version: string;
  device: () => Promise<string>;
  now?: () => Date;
}

export const DEFAULT_CONFIG: BackupConfig = {
  interval: 'off',
  target: 'downloads',
  webdav: { url: '', user: '', password: '' },
  s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: '', accessKey: '', secretKey: '' },
  dropbox: { appKey: '', refreshToken: '' },
  passphrase: '',
  keep: 7,
};

const text = (v: unknown, max = 500): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
/** Only http(s) URLs are ever fetched. */
const url = (v: unknown): string => {
  const t = text(v, 2000);
  try {
    return ['http:', 'https:'].includes(new URL(t).protocol) ? t : '';
  } catch {
    return '';
  }
};
const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

/** Host pattern to request at runtime for a server URL; null when it isn't a valid URL. */
export function originPattern(raw: string): string | null {
  const u = url(raw);
  return u ? `${new URL(u).protocol}//${new URL(u).host}/*` : null;
}

export function parseConfig(raw: unknown): BackupConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const interval: Interval = r.interval === 'daily' || r.interval === 'weekly' ? r.interval : 'off';
  const keep = typeof r.keep === 'number' && r.keep >= 1 && r.keep <= 100 ? Math.floor(r.keep) : 7;
  const w = obj(r.webdav);
  const c = obj(r.s3);
  const d = DEFAULT_CONFIG.s3;
  return {
    interval,
    keep,
    target:
      r.target === 'webdav' || r.target === 's3' || r.target === 'dropbox' ? r.target : 'downloads',
    webdav: {
      url: url(w.url),
      user: text(w.user),
      password: typeof w.password === 'string' ? w.password : '',
    },
    s3: {
      endpoint: url(c.endpoint),
      region: text(c.region, 60) || d.region,
      bucket: text(c.bucket, 100),
      prefix: text(c.prefix, 200),
      accessKey: text(c.accessKey),
      secretKey: typeof c.secretKey === 'string' ? c.secretKey : '',
    },
    dropbox: {
      appKey: text(obj(r.dropbox).appKey, 100),
      refreshToken: text(obj(r.dropbox).refreshToken, 500),
    },
    passphrase: typeof r.passphrase === 'string' ? r.passphrase : '',
  };
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
      const target = deps.target(cfg);
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
