import { describe, expect, it } from 'vitest';
import { createWriteQueue } from '../src/background/write-queue';

describe('createWriteQueue', () => {
  it('runs tasks in order, one at a time', async () => {
    const enqueue = createWriteQueue();
    const log: string[] = [];
    const a = enqueue(async () => {
      await new Promise((r) => setTimeout(r, 5));
      log.push('a');
    });
    const b = enqueue(async () => {
      log.push('b');
    });
    await Promise.all([a, b]);
    expect(log).toEqual(['a', 'b']);
  });

  it('keeps going after a failed task, which rejects for its caller', async () => {
    const enqueue = createWriteQueue();
    const failed = enqueue(() => Promise.reject(new Error('boom')));
    await expect(failed).rejects.toThrow('boom');
    await expect(enqueue(async () => 1)).resolves.toBe(1);
  });
});
