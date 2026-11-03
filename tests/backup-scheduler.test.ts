import { describe, expect, it } from 'vitest';
import {
  type BackupTarget,
  backupHealth,
  CONFIG_KEY,
  originPattern,
  parseConfig,
  requiredAccess,
  runBackup,
  STATUS_KEY,
  type StorageLike,
  targetKey,
} from '../src/background/backup/scheduler';
import { decode } from '../src/backup/codec';
import { makeTarget } from '../src/backup/make-target';
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
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock.n++)),
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
    const names = [1, 2, 3, 4].map((s) =>
      backupName(new Date(Date.UTC(2026, 0, 1, 0, 0, s)), 'My PC!'),
    );
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
    const seen: string[] = [];
    await runBackup({
      ...deps,
      target: (cfg) => {
        seen.push(cfg.target);
        return t;
      },
    });
    expect(seen).toEqual(['s3']);
    expect(used).toHaveLength(1);
  });
});

describe('dropbox config', () => {
  it('keeps trimmed app key and token, and selects the dropbox target', () => {
    const c = parseConfig({
      target: 'dropbox',
      dropbox: { appKey: ' k ', refreshToken: 'rt', extra: 1 },
    });
    expect(c.target).toBe('dropbox');
    expect(c.dropbox).toEqual({ appKey: 'k', refreshToken: 'rt' });
  });
});

describe('hardening', () => {
  it('never selects names that are not plain backup file names', () => {
    const evil = [
      'vc-backup-20260101-000000/../../x.vcb',
      'vc-backup-20260101-000000-a/b.vcb',
      'vc-backup-20260101-000001..vcb',
    ];
    expect(
      selectToDelete(
        [...evil, 'vc-backup-20260101-000002.vcb', 'vc-backup-20260101-000003.vcb'],
        1,
      ),
    ).toEqual(['vc-backup-20260101-000002.vcb']);
  });
});

describe('audit regressions', () => {
  it('asks for the Downloads permission even when the schedule is off', () => {
    expect(requiredAccess(parseConfig({}))).toEqual({ permissions: ['downloads'] });
  });

  it('refuses incomplete remote settings before asking for access', () => {
    expect(() => requiredAccess(parseConfig({ target: 'webdav' }))).toThrow(/valid http/);
    expect(() =>
      requiredAccess(parseConfig({ target: 'webdav', webdav: { url: 'https://a.example/d' } })),
    ).toThrow(/user and password/);
    expect(() => requiredAccess(parseConfig({ target: 'dropbox' }))).toThrow(/Connect Dropbox/);
  });

  it('makes the first backup to a new target even when the data is unchanged', async () => {
    const a = target();
    const b = target();
    const { storage, deps } = setup({ target: 'downloads' }, a);
    await runBackup(deps);
    storage.data[CONFIG_KEY] = {
      target: 's3',
      s3: { endpoint: 'https://s3.example', bucket: 'b' },
    };
    const s = await runBackup({ ...deps, target: () => b });
    expect(s.skipped).toBeUndefined();
    expect(b.files.size).toBe(1);
    expect(s.to).toBe(targetKey(parseConfig(storage.data[CONFIG_KEY])));
  });

  it("keeps each device's newest copies instead of one shared count", () => {
    const mk = (s: number, dev: string) => backupName(new Date(Date.UTC(2026, 0, 1, 0, 0, s)), dev);
    const names = [mk(1, 'busy'), mk(2, 'busy'), mk(3, 'busy'), mk(4, 'busy'), mk(0, 'quiet')];
    expect(selectToDelete(names, 2).sort()).toEqual([mk(1, 'busy'), mk(2, 'busy')].sort());
  });
});

describe('makeTarget', () => {
  it('maps every configured kind to its own target, never silently to Downloads', () => {
    const local: BackupTarget = { put: async () => {} };
    const pick = (target: string) => makeTarget(parseConfig({ target }), () => local);
    expect(pick('downloads')).toBe(local);
    for (const kind of ['webdav', 's3', 'dropbox']) {
      const t = pick(kind);
      expect(t).not.toBe(local);
      expect(typeof t.list).toBe('function');
    }
  });
});

describe('backupHealth', () => {
  const DAY = 86_400_000;
  const daily = parseConfig({ interval: 'daily' });
  it('is off when no schedule is set', () => {
    expect(backupHealth(parseConfig({}), { error: 'x' }, 0)).toBe('off');
  });
  it('flags a failed last run', () => {
    expect(backupHealth(daily, { at: 1, error: 'disk full' }, 2)).toBe('failed');
  });
  it('gives a fresh schedule time, then flags a silent one after 2.5 intervals', () => {
    expect(backupHealth(daily, {}, 10 * DAY)).toBe('ok');
    expect(backupHealth(daily, { checkedAt: 0 }, 2 * DAY)).toBe('ok');
    expect(backupHealth(daily, { checkedAt: 0 }, 3 * DAY)).toBe('stale');
  });
  it('counts unchanged-data skips as healthy', async () => {
    const t = target();
    const { storage, deps } = setup({ interval: 'daily' }, t);
    await runBackup(deps);
    const s = await runBackup(deps);
    expect(s.skipped).toBe(true);
    expect(s.checkedAt).toBeGreaterThan(s.at ?? 0);
    expect((storage.data[STATUS_KEY] as { checkedAt: number }).checkedAt).toBe(s.checkedAt);
  });
});

describe('server addresses', () => {
  it('allows http:// only on private networks', () => {
    for (const u of [
      'http://localhost:8080',
      'http://192.168.1.5/dav',
      'http://10.0.0.2',
      'http://172.20.1.1',
      'http://nas.local/x',
      'http://nas/x',
      'http://[::1]/x',
    ])
      expect(parseConfig({ target: 'webdav', webdav: { url: u } }).webdav.url, u).toBe(u);
    for (const u of [
      'http://example.com/dav',
      'http://172.32.0.1',
      'http://8.8.8.8',
      'http://192.169.1.1',
      'ftp://x',
      'https-not://x',
    ])
      expect(parseConfig({ target: 'webdav', webdav: { url: u } }).webdav.url, u).toBe('');
    expect(parseConfig({ webdav: { url: 'https://cloud.example.com/dav' } }).webdav.url).toBe(
      'https://cloud.example.com/dav',
    );
  });
});

describe('upload verification', () => {
  it('accepts an upload that reads back identically', async () => {
    const files = new Map<string, Uint8Array>();
    const ok: BackupTarget = {
      put: async (n, b) => void files.set(n, b),
      get: async (n) => files.get(n) as Uint8Array,
    };
    const { deps } = setup({}, ok);
    expect((await runBackup(deps)).error).toBeUndefined();
  });

  it('fails the run when the server returns different bytes', async () => {
    const bad: BackupTarget = {
      put: async () => {},
      get: async () => new Uint8Array([1, 2, 3]),
    };
    const { deps } = setup({}, bad);
    const s = await runBackup(deps);
    expect(s.error).toMatch(/did not match/);
    expect(s.hash).toBeUndefined();
  });
});
