import { describe, expect, it } from 'vitest';
import { BackupError, decode, encode, isEncrypted } from '../src/backup/codec';
import {
  buildFullBackup,
  FULL_FORMAT,
  mergeSessions,
  parseFullBackup,
} from '../src/backup/snapshot';
import { DEFAULT_SETTINGS } from '../src/settings/schema';
import type { Session } from '../src/shared/sessions';

const session = (id: string, createdAt: number): Session => ({
  id,
  name: id,
  createdAt,
  windows: [{ tabs: [{ url: 'https://example.com/' }], groups: [] } as never],
});
const isCustom = (id: string) => id.startsWith('custom-');
const parts = (sessions: unknown) => ({
  settings: DEFAULT_SETTINGS,
  themes: [],
  layouts: [],
  sessions,
  customCss: 'body{}',
});

describe('backup codec', () => {
  it('round-trips plain and encrypted, and marks encrypted files', async () => {
    const v = { a: [1, 2, 'três'] };
    const plain = await encode(v);
    expect(isEncrypted(plain)).toBe(false);
    expect(await decode(plain)).toEqual(v);
    const enc = await encode(v, 'hunter2');
    expect(isEncrypted(enc)).toBe(true);
    expect(await decode(enc, 'hunter2')).toEqual(v);
  });

  it('rejects a wrong passphrase, a missing one and corruption', async () => {
    const enc = await encode({ a: 1 }, 'right');
    await expect(decode(enc, 'wrong')).rejects.toThrow(BackupError);
    await expect(decode(enc)).rejects.toThrow(/passphrase/);
    const bad = enc.slice();
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 0xff;
    await expect(decode(bad, 'right')).rejects.toThrow(BackupError);
    await expect(decode(new TextEncoder().encode('{"a":1}'))).rejects.toThrow(BackupError);
  });

  it('rejects an absurd iteration count in a crafted header', async () => {
    const enc = await encode({ a: 1 }, 'p');
    new DataView(enc.buffer).setUint32(4, 0xffffffff);
    await expect(decode(enc, 'p')).rejects.toThrow(BackupError);
  });
});

describe('full backup', () => {
  it('round-trips settings, sessions and custom CSS through the codec', async () => {
    const built = buildFullBackup(parts([session('s1', 5)]), '1.0.0');
    const r = parseFullBackup(await decode(await encode(built, 'pw'), 'pw'), isCustom);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sessions.map((s) => s.id)).toEqual(['s1']);
    expect(r.value.customCss).toBe('body{}');
    expect(r.value.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('refuses a newer or foreign format and drops invalid sessions', () => {
    expect(parseFullBackup({ format: 'nope' }, isCustom).ok).toBe(false);
    const built = buildFullBackup(parts([]), '1');
    expect(parseFullBackup({ ...built, version: 99 }, isCustom).ok).toBe(false);
    const r = parseFullBackup({ ...built, sessions: [session('ok', 1), { id: '../x' }] }, isCustom);
    expect(r.ok && r.value.sessions.length).toBe(1);
    expect(r.ok && r.warnings.join()).toMatch(/invalid sessions/);
    expect(built.format).toBe(FULL_FORMAT);
  });
});

describe('mergeSessions', () => {
  it('keeps existing sessions untouched and adds only new ids', () => {
    const existing = [session('a', 1), session('b', 9)];
    const out = mergeSessions(existing, [{ ...session('a', 5), name: 'changed' }, session('c', 3)]);
    expect(out.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(out[0]?.name).toBe('a');
  });
});
