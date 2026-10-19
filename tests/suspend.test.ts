import { describe, expect, it } from 'vitest';
import { autoSuspendDecision, canDiscardManually } from '../src/background/suspend/eligibility';
import { LastActive } from '../src/background/suspend/last-active';
import type { SuspendSettings } from '../src/settings/schema';
import { tab } from './helpers';

const MIN = 60_000;
const NOW = 10_000_000_000;
const S: SuspendSettings = {
  auto: true,
  minutes: 30,
  skipPinned: true,
  skipAudible: true,
  whitelist: [],
};
const idleSince = NOW - 31 * MIN;

describe('autoSuspendDecision', () => {
  it('suspends an idle, ordinary background tab', () => {
    expect(autoSuspendDecision(tab(1), idleSince, NOW, S)).toBe('suspend');
  });

  it('boundary: exactly `minutes` elapsed suspends, one ms less is recent', () => {
    expect(autoSuspendDecision(tab(1), NOW - 30 * MIN, NOW, S)).toBe('suspend');
    expect(autoSuspendDecision(tab(1), NOW - 30 * MIN + 1, NOW, S)).toBe('recent');
    expect(autoSuspendDecision(tab(1), NOW, NOW, S)).toBe('recent');
  });

  it('uses the configured minutes', () => {
    expect(autoSuspendDecision(tab(1), NOW - 5 * MIN, NOW, { ...S, minutes: 5 })).toBe('suspend');
    expect(autoSuspendDecision(tab(1), NOW - 5 * MIN + 1, NOW, { ...S, minutes: 5 })).toBe(
      'recent',
    );
  });

  it('each skip reason', () => {
    const d = (t: Partial<Parameters<typeof tab>[1]>, la: number | null = idleSince, s = S) =>
      autoSuspendDecision(tab(1, t), la ?? undefined, NOW, s);
    expect(d({ active: true })).toBe('active');
    expect(d({ discarded: true })).toBe('discarded');
    expect(d({ loading: true })).toBe('loading');
    expect(d({ url: 'chrome://settings' })).toBe('not-web');
    expect(d({ url: 'file:///a.html' })).toBe('not-web');
    expect(d({ url: 'chrome-extension://abc/p.html' })).toBe('not-web');
    expect(d({ url: '' })).toBe('not-web');
    expect(d({ pinned: true })).toBe('pinned');
    expect(d({ audible: true })).toBe('audible');
    expect(d({}, idleSince, { ...S, whitelist: ['example.com'] })).toBe('whitelisted');
    expect(d({}, null)).toBe('unknown-age');
    expect(d({}, NOW - MIN)).toBe('recent');
  });

  it('http and https (any case) are web', () => {
    expect(autoSuspendDecision(tab(1, { url: 'http://a.com' }), idleSince, NOW, S)).toBe('suspend');
    expect(autoSuspendDecision(tab(1, { url: 'HTTPS://a.com' }), idleSince, NOW, S)).toBe(
      'suspend',
    );
  });

  it('skipPinned=false lets pinned tabs through; skipAudible=false lets audible through', () => {
    const pinned = tab(1, { pinned: true });
    expect(autoSuspendDecision(pinned, idleSince, NOW, S)).toBe('pinned');
    expect(autoSuspendDecision(pinned, idleSince, NOW, { ...S, skipPinned: false })).toBe(
      'suspend',
    );
    const audible = tab(1, { audible: true });
    expect(autoSuspendDecision(audible, idleSince, NOW, S)).toBe('audible');
    expect(autoSuspendDecision(audible, idleSince, NOW, { ...S, skipAudible: false })).toBe(
      'suspend',
    );
  });

  it('whitelist honours subdomains and wildcard rules', () => {
    const t = tab(1, { url: 'https://docs.example.com/a' });
    expect(autoSuspendDecision(t, idleSince, NOW, { ...S, whitelist: ['example.com'] })).toBe(
      'whitelisted',
    );
    expect(autoSuspendDecision(t, idleSince, NOW, { ...S, whitelist: ['*.example.com'] })).toBe(
      'whitelisted',
    );
    expect(autoSuspendDecision(t, idleSince, NOW, { ...S, whitelist: ['other.com'] })).toBe(
      'suspend',
    );
  });

  describe('precedence', () => {
    const everything = tab(1, {
      active: true,
      discarded: true,
      loading: true,
      url: 'chrome://x',
      pinned: true,
      audible: true,
    });
    const s = { ...S, whitelist: ['example.com'] };

    it('walks down the documented order as conditions are removed', () => {
      const t = { ...everything, url: 'https://example.com/' };
      const order: [Partial<typeof t>, string][] = [
        [{}, 'active'],
        [{ active: false }, 'discarded'],
        [{ active: false, discarded: false }, 'loading'],
        [{ active: false, discarded: false, loading: false }, 'pinned'],
        [{ active: false, discarded: false, loading: false, pinned: false }, 'audible'],
        [
          { active: false, discarded: false, loading: false, pinned: false, audible: false },
          'whitelisted',
        ],
      ];
      for (const [patch, want] of order)
        expect(autoSuspendDecision({ ...t, ...patch }, undefined, NOW, s)).toBe(want);
    });

    it('not-web outranks pinned/audible/whitelist/unknown-age but not active/discarded/loading', () => {
      const t = { ...everything, active: false, discarded: false, loading: false };
      expect(autoSuspendDecision(t, undefined, NOW, s)).toBe('not-web');
      expect(autoSuspendDecision({ ...t, loading: true }, undefined, NOW, s)).toBe('loading');
    });

    it('whitelisted outranks unknown-age and recent', () => {
      const t = tab(1, { url: 'https://example.com/' });
      expect(autoSuspendDecision(t, undefined, NOW, s)).toBe('whitelisted');
      expect(autoSuspendDecision(t, NOW, NOW, s)).toBe('whitelisted');
    });

    it('unknown-age outranks the timer', () => {
      expect(autoSuspendDecision(tab(1), undefined, NOW, S)).toBe('unknown-age');
    });
  });
});

describe('canDiscardManually', () => {
  it('only inactive, not-yet-discarded tabs', () => {
    expect(canDiscardManually(tab(1))).toBe(true);
    expect(canDiscardManually(tab(1, { active: true }))).toBe(false);
    expect(canDiscardManually(tab(1, { discarded: true }))).toBe(false);
  });

  it('ignores pinned, audible, loading, scheme and whitelist', () => {
    expect(
      canDiscardManually(
        tab(1, { pinned: true, audible: true, loading: true, url: 'chrome://settings' }),
      ),
    ).toBe(true);
  });
});

describe('LastActive', () => {
  function make(initial?: Record<string, number>) {
    const writes: Record<string, number>[] = [];
    const la = new LastActive(
      async () => initial,
      async (v) => {
        writes.push(v);
      },
    );
    return { la, writes };
  }

  it('load reads stored values', async () => {
    const { la } = make({ '1': 100, '2': 200 });
    await la.load();
    expect(la.get(1)).toBe(100);
    expect(la.get(2)).toBe(200);
    expect(la.get(3)).toBeUndefined();
  });

  it('load tolerates missing storage', async () => {
    const { la } = make(undefined);
    await la.load();
    expect(la.get(1)).toBeUndefined();
  });

  it('load ignores invalid entries', async () => {
    const { la } = make({
      '1': 100,
      abc: 5,
      '2.5': 7,
      '3': Number.NaN,
      '4': Number.POSITIVE_INFINITY,
      '5': 'x' as unknown as number,
      '6': null as unknown as number,
      '7': 70,
    });
    await la.load();
    expect(la.get(1)).toBe(100);
    expect(la.get(7)).toBe(70);
    for (const id of [2.5, 3, 4, 5, 6]) expect(la.get(id)).toBeUndefined();
  });

  it('load does not overwrite values touched before it completed', async () => {
    let release: (v: Record<string, number>) => void = () => {};
    const slow = new Promise<Record<string, number>>((r) => {
      release = r;
    });
    const la = new LastActive(
      () => slow,
      async () => {},
    );
    const loading = la.load();
    la.touch(1, 500);
    la.seen(3, 600);
    release({ '1': 100, '2': 200, '3': 300 });
    await loading;
    expect(la.get(1)).toBe(500);
    expect(la.get(2)).toBe(200);
    expect(la.get(3)).toBe(600);
  });

  it('seen only sets once; touch overwrites', () => {
    const { la } = make();
    la.seen(1, 10);
    la.seen(1, 20);
    expect(la.get(1)).toBe(10);
    la.touch(1, 30);
    expect(la.get(1)).toBe(30);
  });

  it('retain drops ids that are not live', () => {
    const { la } = make();
    la.touch(1, 1);
    la.touch(2, 2);
    la.touch(3, 3);
    la.retain(new Set([2]));
    expect(la.get(1)).toBeUndefined();
    expect(la.get(2)).toBe(2);
    expect(la.get(3)).toBeUndefined();
  });

  it('flush writes only when dirty, with string keys', async () => {
    const { la, writes } = make();
    await la.flush();
    expect(writes).toHaveLength(0);
    la.touch(1, 10);
    la.touch(22, 20);
    await la.flush();
    expect(writes).toEqual([{ '1': 10, '22': 20 }]);
    expect(Object.keys(writes[0] as object).every((k) => typeof k === 'string')).toBe(true);
    await la.flush();
    expect(writes).toHaveLength(1);
  });

  it('a load alone does not make the next flush write', async () => {
    const { la, writes } = make({ '1': 100 });
    await la.load();
    await la.flush();
    expect(writes).toHaveLength(0);
  });

  it('seen on an existing id does not dirty; on a new id it does', async () => {
    const { la, writes } = make({ '1': 100 });
    await la.load();
    la.seen(1, 999);
    await la.flush();
    expect(writes).toHaveLength(0);
    la.seen(2, 5);
    await la.flush();
    expect(writes).toEqual([{ '1': 100, '2': 5 }]);
  });

  it('forget marks dirty only if the id is present', async () => {
    const { la, writes } = make();
    la.forget(9);
    await la.flush();
    expect(writes).toHaveLength(0);
    la.touch(1, 1);
    await la.flush();
    la.forget(1);
    await la.flush();
    expect(writes).toEqual([{ '1': 1 }, {}]);
  });

  it('retain with everything live does not dirty', async () => {
    const { la, writes } = make();
    la.touch(1, 1);
    await la.flush();
    la.retain(new Set([1]));
    await la.flush();
    expect(writes).toHaveLength(1);
  });
});
