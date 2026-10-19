import { describe, expect, it } from 'vitest';
import { planGroupMove, planMoves, type SingleMove } from '../src/background/move-plan';

/** Simulates chrome.tabs.move({index}) one tab at a time: remove, then insert at index. */
function applyMoves(order: readonly number[], moves: readonly SingleMove[]): number[] {
  const sim = [...order];
  for (const m of moves) {
    const from = sim.indexOf(m.tabId);
    if (from !== -1) sim.splice(from, 1);
    sim.splice(m.index, 0, m.tabId);
  }
  return sim;
}

const ABCDE = [1, 2, 3, 4, 5];

describe('planMoves', () => {
  it('moves down past each other: A,B before E => CDABE', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [1, 2], 5))).toEqual([3, 4, 1, 2, 5]);
  });

  it('moves up: D,E before B => ADEBC', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [4, 5], 2))).toEqual([1, 4, 5, 2, 3]);
  });

  it('handles mixed directions: E,A before C => BEACD', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [5, 1], 3))).toEqual([2, 5, 1, 3, 4]);
  });

  it('keeps the order of `moved` as given', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [4, 2], 5))).toEqual([1, 3, 4, 2, 5]);
  });

  it('null anchor moves to the end', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [1, 3], null))).toEqual([2, 4, 5, 1, 3]);
  });

  it('unknown anchor means end', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [1], 99))).toEqual([2, 3, 4, 5, 1]);
  });

  it('an anchor that is itself moved means end', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [1, 3], 3))).toEqual([2, 4, 5, 1, 3]);
  });

  it('inserts a tab from another window', () => {
    const moves = planMoves(ABCDE, [99], 3);
    expect(applyMoves(ABCDE, moves)).toEqual([1, 2, 99, 3, 4, 5]);
    expect(moves).toEqual([{ tabId: 99, index: 2 }]);
  });

  it('inserts a foreign tab at the end for a null anchor', () => {
    expect(applyMoves(ABCDE, planMoves(ABCDE, [99], null))).toEqual([1, 2, 3, 4, 5, 99]);
  });

  it('handles duplicates in `moved` once', () => {
    const moves = planMoves(ABCDE, [1, 1, 2], 5);
    expect(applyMoves(ABCDE, moves)).toEqual([3, 4, 1, 2, 5]);
    expect(moves.filter((m) => m.tabId === 1).length).toBeLessThanOrEqual(1);
  });

  it('returns no moves when already in place', () => {
    expect(planMoves(ABCDE, [2, 3], 4)).toEqual([]);
    expect(planMoves(ABCDE, [5], null)).toEqual([]);
    expect(planMoves(ABCDE, [1], 2)).toEqual([]);
    expect(planMoves(ABCDE, [], 3)).toEqual([]);
  });

  it('property: result equals rest with moved inserted before the anchor', () => {
    let seed = 0x2f6e2b1;
    const rand = () => {
      // mulberry32
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (n: number) => Math.floor(rand() * n);

    for (let c = 0; c < 200; c++) {
      const n = 2 + int(11);
      const order = Array.from({ length: n }, (_, i) => i + 1);
      for (let i = n - 1; i > 0; i--) {
        const j = int(i + 1);
        [order[i], order[j]] = [order[j] as number, order[i] as number];
      }
      const k = 1 + int(n - 1);
      const pool = [...order];
      const moved: number[] = [];
      for (let i = 0; i < k; i++) moved.push(pool.splice(int(pool.length), 1)[0] as number);
      // Anchor: any tab (maybe one of the moved) or null.
      const r = int(n + 1);
      const anchor = r === n ? null : (order[r] as number);

      const movedSet = new Set(moved);
      const rest = order.filter((id) => !movedSet.has(id));
      const at = anchor === null || movedSet.has(anchor) ? rest.length : rest.indexOf(anchor);
      const expected = [...rest.slice(0, at), ...moved, ...rest.slice(at)];

      const moves = planMoves(order, moved, anchor);
      expect(applyMoves(order, moves), `case ${c}: ${order} / ${moved} / ${anchor}`).toEqual(
        expected,
      );
      if (expected.every((id, i) => id === order[i])) expect(moves).toEqual([]);
    }
  });
});

describe('planGroupMove', () => {
  const order = [1, 2, 3, 4, 5, 6];
  it('returns the group start index after moving before an anchor', () => {
    // group 2,3 before 6 => 1,4,5,2,3,6 => start index 3
    expect(planGroupMove(order, [2, 3], 6)).toBe(3);
    // group 5,6 before 1 => start 0
    expect(planGroupMove(order, [5, 6], 1)).toBe(0);
  });
  it('null anchor means the end', () => {
    expect(planGroupMove(order, [2, 3], null)).toBe(4);
  });
  it('an anchor inside the group means the end', () => {
    expect(planGroupMove(order, [2, 3], 3)).toBe(4);
  });
  it('an unknown anchor means the end', () => {
    expect(planGroupMove(order, [2, 3], 99)).toBe(4);
  });
});
