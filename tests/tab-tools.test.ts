import { expect, it } from 'vitest';
import { duplicateTabIds, sortMoves, type ToolTab } from '../src/background/tab-tools';

const t = (id: number, url: string, more: Partial<ToolTab> = {}): ToolTab => ({
  id,
  index: id,
  url,
  title: url,
  pinned: false,
  active: false,
  groupId: -1,
  ...more,
});

it('closes duplicates, keeping the active, then pinned, then leftmost copy', () => {
  const tabs = [
    t(0, 'https://a.com/x'),
    t(1, 'https://a.com/x#part'),
    t(2, 'https://a.com/x', { active: true }),
    t(3, 'https://b.com', { pinned: true }),
    t(4, 'https://b.com'),
    t(5, 'https://c.com'),
    t(6, 'https://c.com'),
    t(7, 'chrome://newtab/'),
    t(8, 'chrome://newtab/'),
  ];
  expect(duplicateTabIds(tabs)).toEqual([0, 1, 4, 6]);
});

/** Applies the moves like Chrome does, returning the ids in strip order. */
function apply(tabs: ToolTab[], moves: { id: number; index: number }[]): number[] {
  const order = [...tabs].sort((a, b) => a.index - b.index).map((x) => x.id as number);
  for (const m of moves) {
    order.splice(order.indexOf(m.id), 1);
    order.splice(m.index, 0, m.id);
  }
  return order;
}

it('sorts each run of same-group tabs without crossing group or pinned boundaries', () => {
  const tabs = [
    t(0, 'https://z.com', { pinned: true }),
    t(1, 'https://c.com'),
    t(2, 'https://a.com'),
    t(3, 'https://y.com', { groupId: 9 }),
    t(4, 'https://b.com', { groupId: 9 }),
    t(5, 'https://e.com'),
    t(6, 'https://d.com'),
  ];
  expect(apply(tabs, sortMoves(tabs, 'site'))).toEqual([0, 2, 1, 4, 3, 6, 5]);
  expect(apply(tabs, sortMoves(tabs, 'site', 9))).toEqual([0, 1, 2, 4, 3, 5, 6]);
});

it('sorts by title and by most recently used', () => {
  const tabs = [
    t(0, 'u', { title: 'beta', lastAccessed: 1 }),
    t(1, 'u', { title: 'Alpha', lastAccessed: 3 }),
    t(2, 'u', { title: 'gamma', lastAccessed: 2 }),
  ];
  expect(apply(tabs, sortMoves(tabs, 'title'))).toEqual([1, 0, 2]);
  expect(apply(tabs, sortMoves(tabs, 'recent'))).toEqual([1, 2, 0]);
});
