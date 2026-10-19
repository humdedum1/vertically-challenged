import { describe, expect, it } from 'vitest';
import { shouldDeliver, snapshotPlan, visibleWindows } from '../src/background/visibility';

describe('shouldDeliver', () => {
  it('a panel whose kind is unknown receives nothing scoped', () => {
    expect(shouldDeliver({ incognito: null }, { incognito: false })).toBe(false);
    expect(shouldDeliver({ incognito: null }, { incognito: true })).toBe(false);
  });
  it('a normal panel never receives incognito-scoped messages', () => {
    expect(shouldDeliver({ incognito: false }, { incognito: true })).toBe(false);
    expect(shouldDeliver({ incognito: false }, { incognito: false })).toBe(true);
  });
  it('an incognito panel never receives normal-scoped messages', () => {
    expect(shouldDeliver({ incognito: true }, { incognito: false })).toBe(false);
    expect(shouldDeliver({ incognito: true }, { incognito: true })).toBe(true);
  });
  it('unscoped messages (setups, notices) reach every panel', () => {
    for (const incognito of [null, false, true])
      expect(shouldDeliver({ incognito }, null)).toBe(true);
  });
});

describe('visibleWindows', () => {
  const wins = [
    { id: 1, incognito: false },
    { id: 2, incognito: true },
    { id: 3, incognito: false },
  ];
  it('keeps only windows of the panel kind', () => {
    expect(visibleWindows(false, wins).map((w) => w.id)).toEqual([1, 3]);
    expect(visibleWindows(true, wins).map((w) => w.id)).toEqual([2]);
  });
  it('shows an unknown-kind panel nothing', () => {
    expect(visibleWindows(null, wins)).toEqual([]);
  });
});

describe('snapshotPlan', () => {
  const w = (id: number, incognito = false) => ({ id, incognito });
  it('sends each panel the new windows visible to it', () => {
    const plan = snapshotPlan(
      [w(1)],
      [w(1), w(2), w(3, true)],
      [{ incognito: false }, { incognito: true }, { incognito: null }],
    );
    expect(plan).toEqual([[2], [3], []]);
  });
  it('sends nothing when no window is new', () => {
    expect(snapshotPlan([w(1), w(2)], [w(2)], [{ incognito: false }])).toEqual([[]]);
  });
  it('treats a window whose kind flipped as unchanged', () => {
    expect(snapshotPlan([w(1)], [w(1)], [{ incognito: false }])).toEqual([[]]);
  });
});
