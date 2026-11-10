import { describe, expect, it } from 'vitest';
import {
  crossesKind,
  shouldDeliver,
  snapshotPlan,
  visibleWindows,
} from '../src/background/visibility';

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

// Defence in depth: the port is extension-only, but a panel bug must still not act on the
// other kind's tabs or windows.
describe('crossesKind', () => {
  const tabs: Record<number, boolean> = { 1: false, 2: false, 9: true };
  const wins: Record<number, boolean> = { 10: false, 90: true };
  const groups: Record<number, boolean> = { 5: false, 7: true };
  const check = (msg: object, incognito: boolean | null) =>
    crossesKind(
      msg,
      incognito,
      (id) => tabs[id],
      (id) => wins[id],
      (id) => groups[id],
    );

  it('allows ids of the panel own kind, and unknown ids', () => {
    expect(check({ type: 'close', tabIds: [1, 2] }, false)).toBe(false);
    expect(check({ type: 'move', tabIds: [1], target: { windowId: 10, index: 0 } }, false)).toBe(
      false,
    );
    expect(check({ type: 'activate', tabId: 55 }, false)).toBe(false);
    expect(check({ type: 'close', tabIds: [9] }, true)).toBe(false);
  });

  it('refuses any tab or window of the other kind, wherever it is named', () => {
    expect(check({ type: 'close', tabIds: [1, 9] }, false)).toBe(true);
    expect(check({ type: 'activate', tabId: 9 }, false)).toBe(true);
    expect(check({ type: 'nestTab', tabId: 1, parentTabId: 9 }, false)).toBe(true);
    expect(check({ type: 'move', tabIds: [1], target: { windowId: 90, index: 0 } }, false)).toBe(
      true,
    );
    expect(check({ type: 'pinMove', windowId: 10, toWindowId: 90 }, false)).toBe(true);
    expect(check({ type: 'setWindowCollapsed', windowId: 10, otherWindowId: 90 }, false)).toBe(
      true,
    );
    expect(check({ type: 'closeGroup', groupId: 7 }, false)).toBe(true);
    expect(check({ type: 'group', tabIds: [1], groupId: 5 }, false)).toBe(false);
    expect(check({ type: 'group', tabIds: [1], groupId: null }, false)).toBe(false);
    expect(check({ type: 'close', tabIds: [1] }, true)).toBe(true);
  });

  it('refuses everything while the panel kind is unknown', () => {
    expect(check({ type: 'close', tabIds: [1] }, null)).toBe(true);
  });
});
