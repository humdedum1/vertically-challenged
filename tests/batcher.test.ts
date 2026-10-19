import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBatcher } from '../src/background/batcher';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createBatcher', () => {
  it('coalesces many schedule() calls into one flush', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher(flush, 16);
    for (let i = 0; i < 100; i++) b.schedule();
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('schedules a new flush after the previous one completes', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher(flush, 16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('schedule during an in-flight flush causes exactly one follow-up after it resolves', async () => {
    let release!: () => void;
    let calls = 0;
    const flush = vi.fn(() => {
      calls++;
      if (calls === 1) {
        return new Promise<void>((res) => {
          release = res;
        });
      }
      return Promise.resolve();
    });
    const b = createBatcher(flush, 16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(1);

    // events arrive mid-flush, across several timer periods
    for (let i = 0; i < 10; i++) {
      b.schedule();
      await vi.advanceTimersByTimeAsync(20);
    }
    // never overlaps
    expect(flush).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    // follow-up is scheduled via timer
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('no follow-up when nothing arrived mid-flush', async () => {
    let release!: () => void;
    const flush = vi.fn(
      () =>
        new Promise<void>((res) => {
          release = res;
        }),
    );
    const b = createBatcher(flush, 16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('logs flush rejection and keeps working afterwards', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('boom');
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValue(undefined);
    const b = createBatcher(flush, 16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]).toContain(boom);

    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('a rejecting flush with events mid-flush still runs the follow-up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (e: unknown) => void;
    let n = 0;
    const flush = vi.fn(() => {
      n++;
      return n === 1
        ? new Promise<void>((_, rej) => {
            rejectFirst = rej;
          })
        : Promise.resolve();
    });
    const b = createBatcher(flush, 16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    b.schedule();
    await vi.advanceTimersByTimeAsync(16);
    rejectFirst(new Error('x'));
    await vi.advanceTimersByTimeAsync(16);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('respects a custom delay', async () => {
    const flush = vi.fn(async () => {});
    const b = createBatcher(flush, 100);
    b.schedule();
    await vi.advanceTimersByTimeAsync(99);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
