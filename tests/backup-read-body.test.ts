import { describe, expect, it } from 'vitest';
import { MAX_BACKUP_BYTES, readBody } from '../src/backup/codec';

describe('readBody', () => {
  it('returns a normal body', async () => {
    expect([...(await readBody(new Response(new Uint8Array([1, 2, 3]))))]).toEqual([1, 2, 3]);
  });
  it('refuses a declared oversize body without reading it', async () => {
    const res = new Response('x', { headers: { 'content-length': String(MAX_BACKUP_BYTES + 1) } });
    await expect(readBody(res)).rejects.toThrow('too large');
  });
  it('stops reading an undeclared oversize stream', async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 10_000_000;
        c.enqueue(new Uint8Array(10_000_000));
        if (sent > 200_000_000) c.close();
      },
    });
    await expect(readBody(new Response(body))).rejects.toThrow('too large');
    expect(sent).toBeLessThan(100_000_000);
  });
});
