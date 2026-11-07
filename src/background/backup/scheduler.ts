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
  /** Last time a run finished without error, even when it skipped unchanged data. */
  checkedAt?: number;
  /** Where the last good backup went (see targetKey), so a new target gets its first copy. */
  to?: string;
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
/**
 * http:// is only acceptable on a network you control: loopback, private ranges, .local names
 * and single-label intranet hosts. Anything on the public internet must use https://.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1')
    return true;
  if (/^fe80:|^f[cd][0-9a-f]{2}:/.test(h)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  return !h.includes('.') && !h.includes(':');
}

/** Only https:// URLs, or http:// on a private network, are ever fetched. */
const url = (v: unknown): string => {
  const t = text(v, 2000);
  try {
    const u = new URL(t);
    if (u.protocol === 'https:') return t;
    return u.protocol === 'http:' && isPrivateHost(u.hostname) ? t : '';
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

/** A Nextcloud web-UI link (/apps/files/…?dir=/X) isn't WebDAV; rewrite it to the DAV folder. */
export function davUrl(raw: string, user: string): string {
  try {
    const u = new URL(raw);
    if (!user || !u.pathname.includes('/apps/files')) return raw;
    const dir = (u.searchParams.get('dir') ?? '/').split('/').filter(Boolean);
    const root = u.pathname.slice(0, u.pathname.indexOf('/apps/files'));
    return `${u.origin}${root}/remote.php/dav/files/${encodeURIComponent(user)}/${dir.map(encodeURIComponent).join('/')}`.replace(
      /\/$/,
      '',
    );
  } catch {
    return raw;
  }
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
      url: davUrl(url(w.url), text(w.user)),
      user: text(w.user),
      // Trimmed: a pasted app password with a stray space/newline gets a 401.
      password: typeof w.password === 'string' ? w.password.trim() : '',
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

/** Identifies a destination (and whether it gets encrypted copies) without secrets. */
export function targetKey(c: BackupConfig): string {
  return `${c.passphrase ? 'enc:' : ''}${rawTargetKey(c)}`;
}

function rawTargetKey(c: BackupConfig): string {
  return c.target === 'webdav'
    ? `webdav:${c.webdav.url}`
    : c.target === 's3'
      ? `s3:${c.s3.endpoint}/${c.s3.bucket}/${c.s3.prefix}`
      : c.target === 'dropbox'
        ? `dropbox:${c.dropbox.appKey}`
        : 'downloads';
}

/** What the browser must grant before this config can back up; throws on incomplete input. */
export function requiredAccess(
  c: BackupConfig,
  originOf: (url: string) => string | null = originPattern,
  dropboxOrigins: string[] = ['https://api.dropboxapi.com/*', 'https://content.dropboxapi.com/*'],
): { permissions?: string[]; origins?: string[] } {
  if (c.target === 'downloads') return { permissions: ['downloads'] };
  if (c.target === 'dropbox') {
    if (!c.dropbox.refreshToken) throw new Error('Connect Dropbox first');
    return { origins: dropboxOrigins };
  }
  const origin = originOf(c.target === 'webdav' ? c.webdav.url : c.s3.endpoint);
  if (!origin)
    throw new Error('Enter a valid https:// address (http:// works only on your own network)');
  if (c.target === 'webdav' && !(c.webdav.user && c.webdav.password))
    throw new Error('Enter the WebDAV user and password');
  if (c.target === 's3' && !(c.s3.bucket && c.s3.accessKey && c.s3.secretKey))
    throw new Error('Enter the bucket, access key and secret key');
  return { origins: [origin] };
}

export type Health = 'off' | 'ok' | 'failed' | 'stale';

/** Whether the schedule is working: the last run failed, or none succeeded in 2.5 intervals. */
export function backupHealth(cfg: BackupConfig, status: BackupStatus, nowMs: number): Health {
  const minutes = intervalMinutes(cfg.interval);
  if (minutes === 0) return 'off';
  if (status.error) return 'failed';
  const last = status.checkedAt ?? status.at;
  // Never ran yet (just switched on): give the first alarm a full period before warning.
  if (last === undefined) return 'ok';
  return nowMs - last > minutes * 60_000 * 2.5 ? 'stale' : 'ok';
}

export const intervalMinutes = (i: Interval): number =>
  i === 'daily' ? 1440 : i === 'weekly' ? 10080 : 0;

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', b as BufferSource);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
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
    if (!force && hash === prev.hash && prev.to === targetKey(cfg) && !prev.error) {
      status = { ...prev, skipped: true, checkedAt: now.getTime() };
    } else {
      const bytes = await encode(buildFullBackup(parts, deps.version, now), cfg.passphrase);
      const target = deps.target(cfg);
      const name = backupName(now, await deps.device());
      await target.put(name, bytes);
      // Read it back: a server that accepted the upload but stored something else is caught now,
      // not on the day the backup is needed.
      if (target.get && (await sha256Bytes(await target.get(name))) !== (await sha256Bytes(bytes)))
        throw new Error('The uploaded backup did not match what was sent; check the server');
      if (target.list && target.delete) {
        for (const old of selectToDelete(await target.list(), cfg.keep)) await target.delete(old);
      }
      status = { at: now.getTime(), checkedAt: now.getTime(), name, hash, to: targetKey(cfg) };
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
