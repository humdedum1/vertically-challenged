/**
 * Backup file codec: JSON → gzip → optional AES-GCM. Plain files start with the gzip magic
 * (1f 8b); encrypted ones with "VCBE". Zero dependencies (CompressionStream + WebCrypto).
 */
const MAGIC = new TextEncoder().encode('VCBE');
const PBKDF2_ITERATIONS = 600_000;
const SALT = 16;
const IV = 12;
/** Largest accepted file and decompressed size; a hostile file can't exhaust memory. */
export const MAX_BACKUP_BYTES = 50_000_000;
export const MAX_BACKUP_JSON = 200_000_000;
/** Header: magic, 4-byte iteration count, salt, iv. */
const HEADER = MAGIC.length + 4 + SALT + IV;

export class BackupError extends Error {}

/** A response body, refused as soon as it passes the backup size limit (a server can't fill memory). */
export async function readBody(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (declared > MAX_BACKUP_BYTES) throw new BackupError('File is too large to be a backup');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BACKUP_BYTES) {
      await reader.cancel();
      throw new BackupError('File is too large to be a backup');
    }
    parts.push(value);
  }
  return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
}

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream, cap: number) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const c of out as unknown as AsyncIterable<Uint8Array>) {
    size += c.length;
    if (size > cap) throw new BackupError('Backup is too large');
    chunks.push(c);
  }
  return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function isEncrypted(bytes: Uint8Array): boolean {
  return MAGIC.every((b, i) => bytes[i] === b);
}

export async function encode(value: unknown, passphrase = ''): Promise<Uint8Array> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const gz = await pipe(json, new CompressionStream('gzip'), MAX_BACKUP_BYTES);
  if (!passphrase) return gz;
  const salt = crypto.getRandomValues(new Uint8Array(SALT));
  const iv = crypto.getRandomValues(new Uint8Array(IV));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      gz as BufferSource,
    ),
  );
  const out = new Uint8Array(HEADER + cipher.length);
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(MAGIC.length, PBKDF2_ITERATIONS);
  out.set(salt, MAGIC.length + 4);
  out.set(iv, MAGIC.length + 4 + SALT);
  out.set(cipher, HEADER);
  return out;
}

/** Throws BackupError with a user-readable message on any failure; never returns partial data. */
export async function decode(bytes: Uint8Array, passphrase = ''): Promise<unknown> {
  if (bytes.length > MAX_BACKUP_BYTES) throw new BackupError('File is too large to be a backup');
  let gz = bytes;
  if (isEncrypted(bytes)) {
    if (!passphrase) throw new BackupError('This backup is encrypted: enter its passphrase');
    if (bytes.length <= HEADER) throw new BackupError('Not a valid backup file');
    const iterations = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length);
    // Bounded so a crafted header can't pin the CPU.
    if (iterations < 1 || iterations > 5_000_000) throw new BackupError('Not a valid backup file');
    const salt = bytes.slice(MAGIC.length + 4, MAGIC.length + 4 + SALT);
    const iv = bytes.slice(MAGIC.length + 4 + SALT, HEADER);
    try {
      const key = await deriveKey(passphrase, salt, iterations);
      gz = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          key,
          bytes.slice(HEADER) as BufferSource,
        ),
      );
    } catch {
      throw new BackupError('Wrong passphrase, or the file is damaged');
    }
  } else if (gz[0] !== 0x1f || gz[1] !== 0x8b) {
    throw new BackupError('Not a Vertically Challenged backup file');
  }
  let json: Uint8Array;
  try {
    json = await pipe(gz, new DecompressionStream('gzip'), MAX_BACKUP_JSON);
  } catch (err) {
    throw err instanceof BackupError ? err : new BackupError('The backup file is damaged');
  }
  try {
    return JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new BackupError('The backup file is damaged');
  }
}
