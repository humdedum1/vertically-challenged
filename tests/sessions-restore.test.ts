import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestoredLayout } from '../src/background/pins/pin-manager';
import { SESSIONS_KEY } from '../src/shared/sessions';

const h = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  created: [] as { pinned?: boolean; url: string }[],
  sessions: [] as unknown[],
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: () => 'chrome-extension://x/' },
    storage: {
      local: {
        get: async () => ({ [SESSIONS_KEY]: h.sessions }),
        set: async () => {},
      },
    },
    windows: { create: async () => ({ id: 5, tabs: [{ id: 100 }] }) },
    tabs: {
      update: async () => {},
      create: async (p: { pinned?: boolean; url: string }) => {
        // Plain tabs are slow; pinned ones are quick.
        if (!p.pinned && h.gate) await h.gate;
        h.created.push(p);
        return { id: 200 + h.created.length };
      },
      group: async () => 1,
    },
    tabGroups: { update: async () => {} },
  },
}));

const { restoreSession } = await import('../src/background/sessions');

describe('restoreSession with layouts', () => {
  beforeEach(() => {
    h.created = [];
    h.gate = null;
    h.sessions = [
      {
        id: 's1',
        name: 'S',
        createdAt: 1,
        windows: [
          {
            groups: [],
            tabs: [
              { url: 'https://a.com/', title: 'A', pinned: true, group: null },
              { url: 'https://b.com/', title: 'B', pinned: true, group: null },
              { url: 'https://c.com/', title: 'C', pinned: false, group: null },
              { url: 'https://d.com/', title: 'D', pinned: false, group: null },
            ],
            layout: { essentials: [0], pinned: [{ kind: 'item', tab: 1 }] },
          },
        ],
      },
    ];
  });

  it('only creates the pinned tabs inside the layout queue', async () => {
    let release = () => {};
    h.gate = new Promise((r) => {
      release = r;
    });
    let q: Promise<unknown> = Promise.resolve();
    const bound: RestoredLayout[] = [];
    const layouts = {
      layoutOf: () => {
        throw new Error('unused');
      },
      restoreLayout: (run: (report: (r: RestoredLayout) => void) => Promise<void>) => {
        const p = q.then(() => run((r) => bound.push(r)));
        q = p.catch(() => {});
        return p;
      },
    };
    const done = restoreSession('s1', 'newWindow', 1, false, layouts);
    // Another window's edit queued behind the restore's binding step.
    let other = false;
    const otherEdit = q.then(() => {
      other = true;
    });
    // Let the restore reach the slow plain-tab creations.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await otherEdit;
    expect(other).toBe(true);
    expect(h.created.map((c) => c.url)).toEqual(['https://b.com/']);
    expect(bound[0]?.essentials).toHaveLength(1);
    release();
    await done;
    expect(h.created.map((c) => c.url)).toEqual([
      'https://b.com/',
      'https://c.com/',
      'https://d.com/',
    ]);
  });
});
