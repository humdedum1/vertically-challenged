import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  tabs: undefined as undefined | { create: ReturnType<typeof vi.fn> },
  history: undefined as undefined | { onVisited: Listenable },
  runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
}));
type Listenable = {
  addListener: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};
vi.mock('wxt/browser', () => ({ browser: fake }));

import { api, onRelayed } from '../src/sidepanel/api';

beforeEach(() => {
  fake.tabs = undefined;
  fake.runtime.sendMessage.mockReset();
  fake.history = undefined;
  fake.runtime.onMessage.addListener.mockReset();
  fake.runtime.onMessage.removeListener.mockReset();
});

describe('panel API shim', () => {
  it('calls the browser directly when tabs exists', async () => {
    fake.tabs = { create: vi.fn().mockResolvedValue({ id: 1 }) };
    await expect(api.tabs.create({ url: 'https://a.example/' })).resolves.toEqual({ id: 1 });
    expect(fake.tabs.create).toHaveBeenCalledWith({ url: 'https://a.example/' });
    expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('relays when tabs is missing', async () => {
    fake.runtime.sendMessage.mockResolvedValue({ ok: true, value: { id: 2 } });
    await expect(api.tabs.create({ url: 'https://a.example/' })).resolves.toEqual({ id: 2 });
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'relay',
      method: 'tabs.create',
      args: [{ url: 'https://a.example/' }],
    });
  });

  it('rejects with the relayed error', async () => {
    fake.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'No tab' });
    await expect(api.tabs.create({ url: 'https://a.example/' })).rejects.toThrow('No tab');
  });

  it('onRelayed uses the real listener when the API exists', () => {
    const on = { addListener: vi.fn(), removeListener: vi.fn() };
    fake.history = { onVisited: on };
    const cb = vi.fn();
    const off = onRelayed('history.onVisited', cb);
    expect(on.addListener).toHaveBeenCalledWith(cb);
    off();
    expect(on.removeListener).toHaveBeenCalledWith(cb);
    expect(fake.runtime.onMessage.addListener).not.toHaveBeenCalled();
  });

  it('onRelayed passes the relayed args when framed, and stops after unsubscribe', () => {
    const cb = vi.fn();
    const off = onRelayed('history.onVisited', cb);
    const listener = fake.runtime.onMessage.addListener.mock.calls[0]?.[0];
    listener({ type: 'relayEvent', event: 'history.onVisited', args: [{ id: '9' }] });
    expect(cb).toHaveBeenCalledWith({ id: '9' });
    listener({ type: 'relayEvent', event: 'sessions.onChanged', args: [] });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(fake.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });
});
