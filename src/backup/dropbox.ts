import { readBody } from './codec';
import type { BackupTarget } from './targets';

/**
 * Dropbox via OAuth 2 + PKCE (no client secret). The user registers their own "App folder"
 * app and pastes its app key, so the extension ships no shared credentials and a backup can
 * only touch Apps/<their app>. Only the refresh token is stored.
 */
export interface DropboxConfig {
  appKey: string;
  refreshToken: string;
}
type Fetch = typeof fetch;

const AUTH = 'https://www.dropbox.com/oauth2/authorize';
const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
export const DROPBOX_ORIGINS = [`${API}/*`, `${CONTENT}/*`];

const b64url = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export async function newPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const rand = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = rand();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(hash)), state: rand() };
}

export function authUrl(
  appKey: string,
  redirect: string,
  challenge: string,
  state: string,
): string {
  const u = new URL(AUTH);
  u.search = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    state,
  }).toString();
  return u.toString();
}

/** Pulls the code out of the redirect URL, rejecting a mismatched state or an error reply. */
export function codeFromRedirect(redirectUrl: string, state: string): string {
  const q = new URL(redirectUrl).searchParams;
  if (q.get('error')) throw new Error('Dropbox sign-in was cancelled or refused');
  const code = q.get('code');
  if (!code || q.get('state') !== state)
    throw new Error('Dropbox sign-in returned an unexpected reply');
  return code;
}

async function token(body: Record<string, string>, f: Fetch): Promise<Record<string, unknown>> {
  const res = await f(`${API}/oauth2/token`, { method: 'POST', body: new URLSearchParams(body) });
  if (!res.ok) throw new Error(`Dropbox sign-in failed (HTTP ${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

export async function exchangeCode(
  appKey: string,
  code: string,
  verifier: string,
  redirect: string,
  f: Fetch = fetch,
): Promise<string> {
  const r = await token(
    {
      grant_type: 'authorization_code',
      code,
      client_id: appKey,
      code_verifier: verifier,
      redirect_uri: redirect,
    },
    f,
  );
  if (typeof r.refresh_token !== 'string')
    throw new Error('Dropbox did not return a refresh token');
  return r.refresh_token;
}

/** Header values must be ASCII, so non-ASCII in the JSON argument is \u-escaped. */
const arg = (o: unknown): string =>
  JSON.stringify(o).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

export function dropboxTarget(c: DropboxConfig, f: Fetch = fetch): BackupTarget {
  let access: Promise<string> | null = null;
  const bearer = () =>
    (access ??= token(
      { grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.appKey },
      f,
    ).then((r) => {
      if (typeof r.access_token !== 'string')
        throw new Error('Dropbox did not return an access token');
      return r.access_token;
    }));
  async function rpc(path: string, body: unknown): Promise<Response> {
    const res = await f(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Dropbox request failed (HTTP ${res.status})`);
    return res;
  }
  return {
    async put(name, bytes) {
      const res = await f(`${CONTENT}/2/files/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await bearer()}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': arg({ path: `/${name}`, mode: 'overwrite', mute: true }),
        },
        body: bytes as BodyInit,
      });
      if (!res.ok) throw new Error(`Dropbox upload failed (HTTP ${res.status})`);
    },
    async list() {
      const names: string[] = [];
      let r = (await (await rpc('/2/files/list_folder', { path: '' })).json()) as Record<
        string,
        unknown
      >;
      for (;;) {
        for (const e of (r.entries as { name?: unknown }[]) ?? [])
          if (typeof e.name === 'string') names.push(e.name);
        if (r.has_more !== true) return names;
        r = (await (
          await rpc('/2/files/list_folder/continue', { cursor: r.cursor })
        ).json()) as Record<string, unknown>;
      }
    },
    async delete(name) {
      await rpc('/2/files/delete_v2', { path: `/${name}` });
    },
    async get(name) {
      const res = await f(`${CONTENT}/2/files/download`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await bearer()}`,
          'Dropbox-API-Arg': arg({ path: `/${name}` }),
        },
      });
      if (!res.ok) throw new Error(`Dropbox download failed (HTTP ${res.status})`);
      return readBody(res);
    },
  };
}
