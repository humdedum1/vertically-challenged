import { describe, expect, it } from 'vitest';
import { activePathDepths } from '../src/sidepanel/model/active-path';
import type { Row } from '../src/sidepanel/model/rows';

// Minimal tab rows: only kind and childDepth are read by the helper.
const t = (childDepth: number): Row => ({ kind: 'tab', childDepth }) as unknown as Row;
const lit = (rows: Row[], at: number | undefined) => activePathDepths(rows, at);

describe('activePathDepths', () => {
  // Tree:  0 A
  //        1   B (depth 1)
  //        2     C (depth 2)
  //        3   D (depth 1)
  //        4 E (depth 0)
  //        5   F (depth 1)
  const tree = [t(0), t(1), t(2), t(1), t(0), t(1)];

  it('lights nothing when there is no active row', () => {
    expect(lit(tree, undefined).every((x) => x.length === 0)).toBe(true);
  });

  it('lights nothing for an active row at depth 0', () => {
    expect(lit(tree, 0).every((x) => x.length === 0)).toBe(true);
  });

  it('lights the ancestor guides of a deep active row only', () => {
    // Active C (index 2) has ancestors A (depth 0) and B (depth 1).
    const out = lit(tree, 2);
    expect(out[0]).toEqual([]); // A has no guides
    expect(out[1]).toEqual([0]); // B sits under A: line 0 is A's, on the path
    expect(out[2]).toEqual([0, 1]); // C itself: both of its ancestors' lines
    expect(out[3]).toEqual([0]); // D is under A, so A's line is lit
    expect(out[4]).toEqual([]); // E is another root
    expect(out[5]).toEqual([]); // F is under E, not on the path
  });

  it('does not brighten guides of siblings in another branch', () => {
    // Active F (index 5): its line 0 belongs to E, so A's branch stays dim.
    const out = lit(tree, 5);
    expect(out[1]).toEqual([]);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual([]);
    expect(out[5]).toEqual([0]);
  });

  it('ignores non-tab rows', () => {
    const rows = [{ kind: 'window' } as unknown as Row, t(0), t(1)];
    expect(lit(rows, 2)).toEqual([[], [], [0]]);
  });
});
