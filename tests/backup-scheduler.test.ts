import { describe, expect, it } from 'vitest';
import {
  type BackupTarget,
  CONFIG_KEY,
  originPattern,
  parseConfig,
  runBackup,
  STATUS_KEY,
  type StorageLike,
} from '../src/background/backup/scheduler';
import { decode } from '../src/backup/codec';
import { backupName, selectToDelete } from '../src/backup/retention';
import { DEFAULT_SETTINGS } from '../src/settings/schema';

function store(
  initial: Record<string, unknown> = {},
): StorageLike & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (k) => ({ [k]: data[k] }),
    set: async (items) => void Object.assign(data, items),
  };
}
function target(): BackupTarget & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    put: async (n, b) => void files.set(n, b),
    list: async () => [...files.keys()],
    delete: async (n) => void files.delete(n),
  };
}
const setup = (cfg: unknown, t: BackupTarget, content = { css: 'a' }, clock = { n: 0 }) => {
  const storage = store({ [CONFIG_KEY]: cfg });
  const deps = {
    storage,
    target: () => t,
    version: '1.0.0',
    device: async () => 'laptop',
    now: () => new Date(2026, 0, 1, 0, 0, clock.n++),
    collect: async () => ({
      settings: DEFAULT_SETTINGS,
      themes: [],
      layouts: [],
      sessions: [],
      customCss: content.css,
    }),
  };
  return { storage, deps, content };
};

describe('retention', () => {
  it('names files sortably and keeps only the newest N of our own files', () => {
    const names = [1, 2, 3, 4].map((s) => backupName(new Date(2026, 0, 1, 0, 0, s), 'My PC!'));
    expect(names[0]).toMatch(/^vc-backup-20260101-000001-My-PC\.vcb$/);
    const all = [...names, 'holiday.jpg'];
    expect(selectToDelete(all, 2)).toEqual([names[1], names[0]]);
    expect(selectToDelete(all, 0)).toHaveLength(3); // always keeps at least the newest
  });
});

describe('runBackup', () => {
  it('writes a decodable backup and records status', async () => {
    const t = target();
    const { storage, deps } = setup({ interval: 'daily', passphrase: 'pw', keep: 3 }, t);
    const s = await runBackup(deps);
    expect(s.error).toBeUndefined();
    const [bytes] = [...t.files.values()];
    expect(await decode(bytes as Uint8Array, 'pw')).toMatchObject({ format: 'vc-full-backup' });
    expect((storage.data[STATUS_KEY] as { name: string }).name).toMatch(/laptop\.vcb$/);
  });

  it('skips unchanged content unless forced, and prunes old copies', async () => {
    const t = target();
    const { deps, content } = setup({ interval: 'daily', keep: 2 }, t);
    await runBackup(deps);
    expect((await runBackup(deps)).skipped).toBe(true);
    expect(t.files.size).toBe(1);
    await runBackup(deps, true);
    content.css = 'b';
    await runBackup(deps);
    expect(t.files.size).toBe(2);
  });

  it('keeps the last good status and reports the error when the target fails', async () => {
    const t: BackupTarget = {
      put: async () => {
        throw new Error('disk full');
      },
    };
    const { storage, deps } = setup({}, t);
    storage.data[STATUS_KEY] = { at: 5, name: 'old.vcb', hash: 'x' };
    const s = await runBackup(deps);
    expect(s).toMatchObject({ at: 5, name: 'old.vcb', error: 'disk full' });
  });

  it('retries after an error even when content is unchanged', async () => {
    let fail = true;
    const files: string[] = [];
    const t: BackupTarget = {
      put: async (n) => {
        if (fail) throw new Error('x');
        files.push(n);
      },
    };
    const { deps } = setup({}, t);
    await runBackup(deps);
    fail = false;
    expect((await runBackup(deps)).error).toBeUndefined();
    expect(files).toHaveLength(1);
  });
});

describe('parseConfig', () => {
  it('falls back to safe defaults', () => {
    expect(parseConfig({ interval: 'hourly', keep: 9999, passphrase: 5 })).toMatchObject({
      interval: 'off',
      target: 'downloads',
      keep: 7,
      passphrase: '',
    });
    expect(parseConfig({ interval: 'weekly', keep: 3.7 })).toMatchObject({
      interval: 'weekly',
      keep: 3,
    });
  });
});

describe('remote config', () => {
  it('accepts only http(s) server URLs and derives the origin to request', () => {
    const c = parseConfig({
      target: 'webdav',
      webdav: { url: 'javascript:alert(1)', user: ' me ', password: 'p' },
      s3: { endpoint: 'ftp://x', bucket: 'b' },
    });
    expect(c.target).toBe('webdav');
    expect(c.webdav).toEqual({ url: '', user: 'me', password: 'p' });
    expect(c.s3.endpoint).toBe('');
    expect(originPattern('https://cloud.example.com:8443/remote.php/dav')).toBe(
      'https://cloud.example.com:8443/*',
    );
    expect(originPattern('nonsense')).toBeNull();
  });

  it('runs against the target chosen in the config', async () => {
    const used: string[] = [];
    const t: BackupTarget = { put: async (n) => void used.push(n) };
    const { deps } = setup({ target: 's3' }, t);
    let seen = '';
    await runBackup({ ...deps, target: (cfg) => ((seen = cfg.target), t) });
    expect(seen).toBe('s3');
    expect(used).toHaveLength(1);
  });
});
