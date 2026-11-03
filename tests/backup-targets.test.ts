import { describe, expect, it } from 'vitest';
import { sha256Hex, signRequest } from '../src/backup/sigv4';
import { s3Target, webdavTarget } from '../src/backup/targets';

describe('sigv4', () => {
  it('matches the AWS documentation example (GET object with Range)', async () => {
    const h = await signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      region: 'us-east-1',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      payloadHash: await sha256Hex(''),
      date: new Date('2013-05-24T00:00:00Z'),
      headers: { range: 'bytes=0-9' },
    });
    expect(h.Authorization).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(h.Authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
  });
});

type Call = { url: string; method: string; headers: Record<string, string> };
function fake(responses: (call: Call) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const call = {
      url: String(url),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return responses(call);
  }) as unknown as typeof fetch;
  return { calls, f };
}

describe('webdav', () => {
  const cfg = { url: 'https://cloud.example/dav/Backups/', user: 'me', password: 'pw' };

  it('uploads with basic auth and creates the folder when missing', async () => {
    let first = true;
    const { calls, f } = fake((c) => {
      if (c.method === 'PUT' && first) {
        first = false;
        return new Response('', { status: 409 });
      }
      return new Response('', { status: 201 });
    });
    await webdavTarget(cfg, f).put('vc-backup-1.vcb', new Uint8Array([1]));
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'MKCOL', 'PUT']);
    expect(calls[0]?.url).toBe('https://cloud.example/dav/Backups/vc-backup-1.vcb');
    expect(calls[0]?.headers.Authorization).toBe(`Basic ${btoa('me:pw')}`);
  });

  it('lists file names from a PROPFIND response and reports HTTP errors without secrets', async () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Backups/</d:href></d:response>
      <d:response><d:href>/dav/Backups/vc-backup-1%20x.vcb</d:href></d:response></d:multistatus>`;
    const t = webdavTarget(cfg, fake(() => new Response(xml, { status: 207 })).f);
    expect(await t.list?.()).toContain('vc-backup-1 x.vcb');
    const bad = webdavTarget(cfg, fake(() => new Response('', { status: 401 })).f);
    await expect(bad.put('a', new Uint8Array())).rejects.toThrow('WebDAV upload failed (HTTP 401)');
  });
});

describe('s3', () => {
  const cfg = {
    endpoint: 'https://s3.example.com',
    region: 'eu-1',
    bucket: 'my-bucket',
    prefix: 'vc',
    accessKey: 'AK',
    secretKey: 'SK',
  };
  const now = () => new Date('2026-01-01T00:00:00Z');

  it('signs a path-style PUT under the prefix', async () => {
    const { calls, f } = fake(() => new Response('', { status: 200 }));
    await s3Target(cfg, f, now).put('vc-backup-1.vcb', new Uint8Array([1, 2]));
    expect(calls[0]?.url).toBe('https://s3.example.com/my-bucket/vc/vc-backup-1.vcb');
    expect(calls[0]?.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/20260101\/eu-1\/s3\/aws4_request/,
    );
  });

  it('lists keys under the prefix and strips it', async () => {
    const xml =
      '<ListBucketResult><Key>vc/vc-backup-1.vcb</Key><Key>other/x</Key><Key>vc/a&amp;b.vcb</Key></ListBucketResult>';
    const { calls, f } = fake(() => new Response(xml, { status: 200 }));
    expect(await s3Target(cfg, f, now).list?.()).toEqual(['vc-backup-1.vcb', 'a&b.vcb']);
    expect(calls[0]?.url).toContain('list-type=2&prefix=vc%2F');
  });
});

describe('downloading backups', () => {
  const body = () => new Response(new Uint8Array([7, 8, 9]), { status: 200 });
  it('reads a file back from WebDAV and S3', async () => {
    const wd = webdavTarget({ url: 'https://c.example/d', user: 'u', password: 'p' }, fake(body).f);
    expect([...((await wd.get?.('a.vcb')) ?? [])]).toEqual([7, 8, 9]);
    const s3 = s3Target(
      {
        endpoint: 'https://s3.example',
        region: 'r',
        bucket: 'b',
        prefix: '',
        accessKey: 'A',
        secretKey: 'S',
      },
      fake(body).f,
      () => new Date('2026-01-01T00:00:00Z'),
    );
    expect([...((await s3.get?.('a.vcb')) ?? [])]).toEqual([7, 8, 9]);
  });
});
