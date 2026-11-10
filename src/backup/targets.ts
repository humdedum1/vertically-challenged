import { readBody } from './codec';
import { sha256Hex, signRequest } from './sigv4';

export interface BackupTarget {
  put(name: string, bytes: Uint8Array): Promise<void>;
  list?(): Promise<string[]>;
  delete?(name: string): Promise<void>;
  /** Reads one backup back, for restoring from the server. */
  get?(name: string): Promise<Uint8Array>;
}

export interface WebDavConfig {
  /** Folder URL, e.g. https://cloud.example.com/remote.php/dav/files/me/Backups */
  url: string;
  user: string;
  password: string;
}
export interface S3Config {
  /** e.g. https://s3.eu-west-1.amazonaws.com or https://<id>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKey: string;
  secretKey: string;
}
type Fetch = typeof fetch;

/** Secrets must never reach logs or the UI, so errors carry only the verb and status. */
async function ok(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status})`);
  return res;
}
const unxml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function webdavTarget(c: WebDavConfig, fetcher: Fetch = fetch): BackupTarget {
  // No cookies: Nextcloud rejects (401, CSRF) a Basic-auth call that also carries a logged-in session.
  const f: Fetch = (u, init) => fetcher(u, { ...init, credentials: 'omit' });
  const base = c.url.replace(/\/+$/, '');
  const cred = new TextEncoder().encode(`${c.user}:${c.password}`);
  const auth = { Authorization: `Basic ${btoa(String.fromCharCode(...cred))}` };
  const file = (name: string) => `${base}/${encodeURIComponent(name)}`;
  const put = (name: string, bytes: Uint8Array) =>
    f(file(name), {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'application/octet-stream' },
      body: bytes as BodyInit,
    });
  return {
    async put(name, bytes) {
      let res = await put(name, bytes);
      if (res.status === 404 || res.status === 409) {
        // The folder may not exist yet; create it (one level) and retry once.
        await f(base, { method: 'MKCOL', headers: auth });
        res = await put(name, bytes);
      }
      await ok(res, 'WebDAV upload');
    },
    async list() {
      const res = await ok(
        await f(base, {
          method: 'PROPFIND',
          headers: { ...auth, Depth: '1', 'Content-Type': 'application/xml' },
        }),
        'WebDAV listing',
      );
      const names: string[] = [];
      for (const m of (await res.text()).matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/gi)) {
        const seg =
          unxml(m[1] ?? '')
            .replace(/\/+$/, '')
            .split('/')
            .pop() ?? '';
        try {
          names.push(decodeURIComponent(seg));
        } catch {}
      }
      return names;
    },
    async delete(name) {
      await ok(await f(file(name), { method: 'DELETE', headers: auth }), 'WebDAV delete');
    },
    async get(name) {
      const res = await ok(
        await f(file(name), { method: 'GET', headers: auth }),
        'WebDAV download',
      );
      return readBody(res);
    },
  };
}

export function s3Target(
  c: S3Config,
  f: Fetch = fetch,
  now: () => Date = () => new Date(),
): BackupTarget {
  const prefix = c.prefix
    .replace(/^\/+/, '')
    .replace(/([^/])$/, '$1/')
    .replace(/^\/$/, '');
  const root = `${c.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(c.bucket)}`;
  const key = (name: string) => `${prefix}${name}`;
  const objectUrl = (name: string) =>
    new URL(`${root}/${key(name).split('/').map(encodeURIComponent).join('/')}`);
  async function send(method: string, url: URL, body?: Uint8Array): Promise<Response> {
    const headers = await signRequest({
      method,
      url,
      region: c.region,
      accessKey: c.accessKey,
      secretKey: c.secretKey,
      payloadHash: await sha256Hex(body ?? ''),
      date: now(),
    });
    return f(url.toString(), { method, headers, body: body as BodyInit | undefined });
  }
  return {
    async put(name, bytes) {
      await ok(await send('PUT', objectUrl(name), bytes), 'S3 upload');
    },
    async list() {
      const url = new URL(`${root}/`);
      url.searchParams.set('list-type', '2');
      url.searchParams.set('prefix', prefix);
      const res = await ok(await send('GET', url), 'S3 listing');
      return [...(await res.text()).matchAll(/<Key>([^<]+)<\/Key>/g)]
        .map((m) => unxml(m[1] ?? ''))
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length));
    },
    async delete(name) {
      await ok(await send('DELETE', objectUrl(name)), 'S3 delete');
    },
    async get(name) {
      const res = await ok(await send('GET', objectUrl(name)), 'S3 download');
      return readBody(res);
    },
  };
}

/** Whether a server address the user typed sends login and data unencrypted (http://). */
export function isPlainHttp(address: string): boolean {
  try {
    return new URL(address.trim()).protocol === 'http:';
  } catch {
    return false;
  }
}
