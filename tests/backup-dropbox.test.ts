import { describe, expect, it } from 'vitest';
import {
  authUrl,
  codeFromRedirect,
  dropboxTarget,
  exchangeCode,
  newPkce,
} from '../src/backup/dropbox';

type Call = { url: string; init: RequestInit };
function fake(reply: (c: Call) => unknown) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = reply(c);
    return r instanceof Response ? r : new Response(JSON.stringify(r ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, f };
}

describe('dropbox oauth', () => {
  it('builds a PKCE S256 auth URL and validates the redirect', async () => {
    const p = await newPkce();
    const u = new URL(authUrl('KEY', 'https://x.chromiumapp.org/', p.challenge, p.state));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('token_access_type')).toBe('offline');
    expect(codeFromRedirect(`https://x.chromiumapp.org/?code=abc&state=${p.state}`, p.state)).toBe(
      'abc',
    );
    expect(() =>
      codeFromRedirect('https://x.chromiumapp.org/?code=abc&state=evil', p.state),
    ).toThrow();
    expect(() =>
      codeFromRedirect('https://x.chromiumapp.org/?error=access_denied', p.state),
    ).toThrow();
  });

  it('exchanges a code for a refresh token and sends no client secret', async () => {
    const { calls, f } = fake(() => ({ refresh_token: 'RT' }));
    expect(await exchangeCode('KEY', 'code', 'ver', 'https://r/', f)).toBe('RT');
    const body = String(calls[0]?.init.body);
    expect(body).toContain('code_verifier=ver');
    expect(body).not.toContain('secret');
  });
});

describe('dropbox target', () => {
  const cfg = { appKey: 'KEY', refreshToken: 'RT' };
  it('refreshes once, uploads with an ASCII-safe arg header, lists with paging, deletes', async () => {
    const { calls, f } = fake((c) => {
      if (c.url.endsWith('/oauth2/token')) return { access_token: 'AT' };
      if (c.url.endsWith('/list_folder'))
        return { entries: [{ name: 'a.vcb' }], has_more: true, cursor: 'c' };
      if (c.url.endsWith('/list_folder/continue'))
        return { entries: [{ name: 'b.vcb' }], has_more: false };
      return {};
    });
    const t = dropboxTarget(cfg, f);
    await t.put('vc-backup-ö.vcb', new Uint8Array([1]));
    expect(await t.list?.()).toEqual(['a.vcb', 'b.vcb']);
    await t.delete?.('a.vcb');
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(1);
    const up = calls.find((c) => c.url.endsWith('/files/upload'));
    const hdr = ((up?.init.headers ?? {}) as Record<string, string>)['Dropbox-API-Arg'] ?? '';
    expect(hdr).toContain('\\u00f6');
    expect(hdr).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(hdr).path).toBe('/vc-backup-ö.vcb');
  });

  it('reports HTTP errors without tokens', async () => {
    const { f } = fake((c) =>
      c.url.endsWith('/oauth2/token') ? { access_token: 'AT' } : new Response('', { status: 507 }),
    );
    await expect(dropboxTarget(cfg, f).put('a', new Uint8Array())).rejects.toThrow(
      'Dropbox upload failed (HTTP 507)',
    );
  });
});

describe('dropbox download', () => {
  it('downloads by path with an ASCII-safe arg header', async () => {
    const { calls, f } = fake((c) =>
      c.url.endsWith('/oauth2/token')
        ? { access_token: 'AT' }
        : new Response(new Uint8Array([1, 2]), { status: 200 }),
    );
    const bytes = await dropboxTarget({ appKey: 'K', refreshToken: 'R' }, f).get?.(
      'vc-backup-ö.vcb',
    );
    expect([...(bytes ?? [])]).toEqual([1, 2]);
    const dl = calls.find((c) => c.url.endsWith('/files/download'));
    expect(((dl?.init.headers ?? {}) as Record<string, string>)['Dropbox-API-Arg']).toContain(
      '\\u00f6',
    );
  });
});
