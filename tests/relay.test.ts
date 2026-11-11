import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  windows: { get: vi.fn(), remove: vi.fn() },
  tabs: { get: vi.fn(), remove: vi.fn(), query: vi.fn() },
  sessions: { getRecentlyClosed: vi.fn(), restore: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: api }));

import { planRelay, type RelaySender, runRelay } from '../src/background/relay';

const T = 'tok';
const ok: RelaySender = {
  tab: { windowId: 7, incognito: false },
  frameId: 3,
  url: `moz-extension://x/sidepanel.html?surface=popup&t=${T}`,
};
const plan = (method: string, args: unknown, s: RelaySender = ok, token: unknown = T) =>
  planRelay({ type: 'relay', method, args }, s, token);

describe('planRelay sender', () => {
  it('refuses the sidebar, the window surface and a top-level panel tab', () => {
    expect(plan('tabs.query', [{}], { ...ok, tab: undefined })).toHaveProperty('error');
    expect(plan('tabs.query', [{}], { ...ok, frameId: 0 })).toHaveProperty('error');
    expect(
      plan('tabs.query', [{}], {
        ...ok,
        url: 'moz-extension://x/sidepanel.html?surface=window&windowId=1',
      }),
    ).toHaveProperty('error');
  });
  it('refuses a missing or stale popup token', () => {
    expect(plan('tabs.query', [{}], ok, null)).toHaveProperty('error');
    expect(plan('tabs.query', [{}], ok, 'old')).toHaveProperty('error');
  });
  it('refuses senders in a private tab', () => {
    expect(
      plan('tabs.query', [{}], { ...ok, tab: { windowId: 7, incognito: true } }),
    ).toHaveProperty('error');
  });
});

describe('planRelay shape', () => {
  it('refuses unknown methods, non-array args and null or non-object options', () => {
    expect(plan('tabs.remove', [1])).toHaveProperty('error');
    expect(plan('tabs.query', {})).toHaveProperty('error');
    expect(plan('tabs.query', [null])).toHaveProperty('error');
    expect(plan('tabs.create', ['x'])).toHaveProperty('error');
  });
  it('pins tabs.create to the sender window and refuses another window or extra keys', () => {
    expect(plan('tabs.create', [{ url: 'https://a.b' }])).toEqual({
      method: 'tabs.create',
      args: [{ url: 'https://a.b', windowId: 7 }],
    });
    expect(plan('tabs.create', [{ windowId: 8 }])).toHaveProperty('error');
    expect(plan('tabs.create', [{ cookieStoreId: 'x' }])).toHaveProperty('error');
  });
  it('pins tabs.query, including {}, and refuses another window, currentWindow and lastFocusedWindow', () => {
    expect(plan('tabs.query', [{}])).toEqual({ method: 'tabs.query', args: [{ windowId: 7 }] });
    expect(plan('tabs.query', [{ windowId: 8 }])).toHaveProperty('error');
    expect(plan('tabs.query', [{ currentWindow: true }])).toHaveProperty('error');
    expect(plan('tabs.query', [{ lastFocusedWindow: true }])).toHaveProperty('error');
  });
  it('windows.create forces incognito false and refuses tabId', () => {
    expect(plan('windows.create', [{ url: 'https://a.b' }])).toEqual({
      method: 'windows.create',
      args: [{ url: 'https://a.b', incognito: false }],
    });
    expect(plan('windows.create', [{ tabId: 1 }])).toHaveProperty('error');
    expect(plan('windows.create', [{ incognito: true }])).toHaveProperty('error');
  });
  it('sessions.restore requires a session id', () => {
    expect(plan('sessions.restore', [])).toHaveProperty('error');
    expect(plan('sessions.restore', ['5'])).toEqual({ method: 'sessions.restore', args: ['5'] });
  });
  it('passes bookmarks and history calls through unchanged', () => {
    expect(plan('bookmarks.search', ['q'])).toEqual({ method: 'bookmarks.search', args: ['q'] });
    expect(plan('history.search', [{ text: '' }])).toEqual({
      method: 'history.search',
      args: [{ text: '' }],
    });
  });
});

describe('runRelay', () => {
  beforeEach(() => vi.clearAllMocks());
  it('refuses tabs.update on a tab in another window', async () => {
    api.tabs.get.mockResolvedValue({ id: 1, windowId: 9, incognito: false });
    const r = await runRelay({ method: 'tabs.update', args: [1, { active: true }] }, 7);
    expect(r.ok).toBe(false);
  });
  it('maps windows.getCurrent to the sender window', async () => {
    api.windows.get.mockResolvedValue({ id: 7 });
    expect(await runRelay({ method: 'windows.getCurrent', args: [] }, 7)).toEqual({
      ok: true,
      value: { id: 7 },
    });
    expect(api.windows.get).toHaveBeenCalledWith(7);
  });
  it('filters private entries from getRecentlyClosed', async () => {
    api.sessions.getRecentlyClosed.mockResolvedValue([
      { tab: { incognito: true } },
      { window: { incognito: true } },
      { tab: { incognito: false } },
    ]);
    const r = await runRelay({ method: 'sessions.getRecentlyClosed', args: [] }, 7);
    expect(r).toEqual({ ok: true, value: [{ tab: { incognito: false } }] });
  });
  it('closes a private session restore and refuses', async () => {
    api.sessions.restore.mockResolvedValue({ tab: { id: 4, incognito: true } });
    const r = await runRelay({ method: 'sessions.restore', args: ['1'] }, 7);
    expect(r.ok).toBe(false);
    expect(api.tabs.remove).toHaveBeenCalledWith(4);
  });
  it('turns a thrown error into { ok: false, error }', async () => {
    api.tabs.query.mockRejectedValue(new Error('boom'));
    expect(await runRelay({ method: 'tabs.query', args: [{}] }, 7)).toEqual({
      ok: false,
      error: 'boom',
    });
  });
});
