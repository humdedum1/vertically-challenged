/** AWS Signature V4 for S3-compatible servers, on WebCrypto (no SDK). */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array): string =>
  [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** RFC 3986 percent-encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export const uriEncode = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export interface SignInput {
  method: string;
  url: URL;
  region: string;
  accessKey: string;
  secretKey: string;
  /** Hex SHA-256 of the body ("e3b0…" for an empty one). */
  payloadHash: string;
  date: Date;
  /** Extra headers to sign (lowercase names). */
  headers?: Record<string, string>;
  service?: string;
}

/** Returns the headers to send: x-amz-date, x-amz-content-sha256 and Authorization. */
export async function signRequest(i: SignInput): Promise<Record<string, string>> {
  const amzDate = i.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const service = i.service ?? 's3';
  const signed: Record<string, string> = {
    ...(i.headers ?? {}),
    host: i.url.host,
    'x-amz-content-sha256': i.payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(signed[n]).trim()}\n`).join('');
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = i.url.pathname
    .split('/')
    .map((s) => uriEncode(decodeURIComponent(s)))
    .join('/');
  const canonical = [i.method, path, query, canonicalHeaders, names.join(';'), i.payloadHash].join(
    '\n',
  );
  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let key = await hmac(enc.encode(`AWS4${i.secretKey}`), day);
  for (const part of [i.region, service, 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': i.payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
