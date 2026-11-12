import { describe, expect, it, vi } from 'vitest';
import { createEventRelay } from '../src/background/event-relay';
import { RELAY_EVENTS, type RelayEvent } from '../src/shared/relay';

function setup(send = vi.fn().mockResolvedValue(undefined)) {
  const offs = new Map<RelayEvent, ReturnType<typeof vi.fn>>();
  const handlers = new Map<RelayEvent, (...a: unknown[]) => void>();
  const listen = vi.fn((event: RelayEvent, fn: (...a: unknown[]) => void) => {
    handlers.set(event, fn);
    const off = vi.fn();
    offs.set(event, off);
    return off;
  });
  const relay = createEventRelay({ listen, send });
  return { relay, listen, send, offs, handlers };
}

describe('createEventRelay', () => {
  it('listens to nothing with no popup open', () => {
    const { listen } = setup();
    expect(listen).not.toHaveBeenCalled();
  });

  it('listens once for two popups, and stops only when both close', () => {
    const { relay, listen, offs } = setup();
    relay.popupOpened();
    relay.popupOpened();
    expect(listen).toHaveBeenCalledTimes(RELAY_EVENTS.length);
    relay.popupClosed();
    for (const off of offs.values()) expect(off).not.toHaveBeenCalled();
    relay.popupClosed();
    for (const off of offs.values()) expect(off).toHaveBeenCalledTimes(1);
  });

  it('listens again after a close and reopen', () => {
    const { relay, listen, offs } = setup();
    relay.popupOpened();
    const firstOff = offs.get('sessions.onChanged');
    relay.popupClosed();
    expect(firstOff).toHaveBeenCalledTimes(1);
    relay.popupOpened();
    expect(listen).toHaveBeenCalledTimes(RELAY_EVENTS.length * 2);
    expect(offs.get('sessions.onChanged')).not.toBe(firstOff);
  });

  it('forwards args, and a rejected send does not throw', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Could not establish connection'));
    const { relay, handlers } = setup(send);
    relay.popupOpened();
    expect(() => handlers.get('history.onVisited')?.({ id: '1' })).not.toThrow();
    expect(send).toHaveBeenCalledWith({
      type: 'relayEvent',
      event: 'history.onVisited',
      args: [{ id: '1' }],
    });
    await Promise.resolve();
  });
});
