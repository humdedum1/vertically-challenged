import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  tabs: undefined as undefined | { create: ReturnType<typeof vi.fn> },
  runtime: { sendMessage: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: fake }));

import { api } from '../src/sidepanel/api';

beforeEach(() => {
  fake.tabs = undefined;
  fake.runtime.sendMessage.mockReset();
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
});
