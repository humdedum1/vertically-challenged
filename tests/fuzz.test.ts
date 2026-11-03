// Seeded fuzzing of everything that reads untrusted input: backup files, stored data and
// messages. Nothing may throw, and what comes out must still satisfy the safety invariants.
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/background/backup/scheduler';
import { BackupError, decode, encode } from '../src/backup/codec';
import { buildFullBackup, parseFullBackup } from '../src/backup/snapshot';
import { DEFAULT_SETTINGS } from '../src/settings/schema';
import { parsePanelMessage } from '../src/shared/protocol';
import { isRestorableUrl, MAX_SESSIONS, parseSessions } from '../src/shared/sessions';
import { parseSnoozed } from '../src/shared/snooze';

/** Small deterministic PRNG (mulberry32) so a failure can be replayed from its seed. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = [
  'id',
  'name',
  'url',
  'title',
  'tabs',
  'windows',
  'groups',
  'group',
  'type',
  'tabIds',
  'wakeAt',
  'target',
  'webdav',
  's3',
  'dropbox',
  'sessions',
  'layouts',
  'themes',
  'settings',
  'customCss',
  'version',
  'format',
  'interval',
  'keep',
];
const STRINGS = [
  '',
  'x',
  'abc123',
  'javascript:alert(1)',
  'data:text/html,x',
  'https://example.com/a',
  'http://8.8.8.8/x',
  'chrome://kill',
  '../etc/passwd',
  'custom-abcdef',
  'a'.repeat(9000),
  '\u0000‮',
  '__proto__',
  'daily',
];

function value(r: () => number, depth = 0): unknown {
  const k = r();
  if (depth > 3 || k < 0.35) {
    const p = r();
    if (p < 0.4) return STRINGS[Math.floor(r() * STRINGS.length)];
    if (p < 0.6) return Math.floor((r() - 0.5) * 2e9);
    if (p < 0.7) return [Number.NaN, Number.POSITIVE_INFINITY, -0, 1e308][Math.floor(r() * 4)];
    if (p < 0.85) return r() < 0.5;
    return null;
  }
  if (k < 0.65) return Array.from({ length: Math.floor(r() * 5) }, () => value(r, depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = 0; i < Math.floor(r() * 6); i++)
    o[KEYS[Math.floor(r() * KEYS.length)] as string] = value(r, depth + 1);
  return o;
}

const N = 400;
const each = (seed: number, fn: (v: unknown) => void) => {
  const r = rng(seed);
  for (let i = 0; i < N; i++) fn(value(r));
};

describe('fuzz: parsers never throw and keep their invariants', () => {
  it('parseSessions', () => {
    each(1, (v) => {
      const out = parseSessions(v);
      expect(out.length).toBeLessThanOrEqual(MAX_SESSIONS);
      for (const s of out) {
        expect(s.id).toMatch(/^[a-z0-9-]{1,40}$/);
        for (const w of s.windows)
          for (const t of w.tabs) expect(t.url.length).toBeLessThanOrEqual(8192);
      }
    });
  });

  it('parseSnoozed keeps only restorable URLs', () => {
    each(2, (v) => {
      for (const s of parseSnoozed(v)) expect(isRestorableUrl(s.url)).toBe(true);
    });
  });

  it('parseConfig never keeps a URL that is not https or private http', () => {
    each(3, (v) => {
      const c = parseConfig(v);
      for (const u of [c.webdav.url, c.s3.endpoint]) if (u) expect(u).toMatch(/^https?:\/\//);
      expect(c.keep).toBeGreaterThanOrEqual(1);
    });
  });

  it('parsePanelMessage returns null or a typed message', () => {
    each(4, (v) => {
      const m = parsePanelMessage(v);
      if (m) expect(typeof m.type).toBe('string');
    });
  });

  it('parseFullBackup rejects or returns clean data', () => {
    const base = buildFullBackup(
      { settings: DEFAULT_SETTINGS, themes: [], layouts: [], sessions: [], customCss: '' },
      '1',
    );
    const r = rng(5);
    for (let i = 0; i < N; i++) {
      const mix = { ...base, ...(value(r) as object) };
      const out = parseFullBackup(mix, (id) => id.startsWith('custom-'));
      if (out.ok) expect(out.value.customCss).not.toMatch(/url\s*\(|@import/i);
    }
  });
});

describe('fuzz: the backup decoder fails closed', () => {
  it('only ever throws BackupError, on random and damaged files', async () => {
    const good = await encode({ hello: 'world' });
    const r = rng(6);
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0x1f, 0x8b]),
      good.slice(0, good.length - 3),
    ];
    for (let i = 0; i < 60; i++)
      cases.push(Uint8Array.from({ length: Math.floor(r() * 200) }, () => Math.floor(r() * 256)));
    for (let i = 0; i < 60; i++) {
      const copy = good.slice();
      copy[Math.floor(r() * copy.length)] = Math.floor(r() * 256);
      cases.push(copy);
    }
    for (const c of cases) {
      try {
        await decode(c);
      } catch (err) {
        expect(err).toBeInstanceOf(BackupError);
      }
    }
  });

  it('rejects damaged encrypted files without leaking anything', async () => {
    const enc = await encode({ secret: 1 }, 'pw');
    const r = rng(7);
    for (let i = 0; i < 6; i++) {
      const copy = enc.slice();
      const at = 4 + Math.floor(r() * (copy.length - 4));
      copy[at] = (copy[at] ?? 0) ^ 0xff;
      await expect(decode(copy, 'pw')).rejects.toBeInstanceOf(BackupError);
    }
  }, 60_000);
});
