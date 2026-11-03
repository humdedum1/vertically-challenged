import { expect, it } from 'vitest';
import { createMruCycle } from '../src/background/mru';

const tabs = [
  { id: 1, lastAccessed: 10 },
  { id: 2, lastAccessed: 30 },
  { id: 3, lastAccessed: 20 },
];

it('goes to the previously used tab, then further back while pressed quickly', () => {
  const m = createMruCycle(1000);
  expect(m.next(1, tabs, 0)).toBe(3);
  expect(m.next(1, tabs, 500)).toBe(1);
  expect(m.next(1, tabs, 900)).toBe(2); // wraps to the start
  expect(m.next(1, tabs, 1000, -1)).toBe(1);
});

it('starts a new cycle after a pause or in another window, from fresh lastAccessed', () => {
  const m = createMruCycle(1000);
  expect(m.next(1, tabs, 0)).toBe(3);
  const after = [
    { id: 1, lastAccessed: 10 },
    { id: 2, lastAccessed: 30 },
    { id: 3, lastAccessed: 40 },
  ];
  expect(m.next(1, after, 5000)).toBe(2);
  expect(m.next(2, after, 5100)).toBe(2);
});

it('does nothing with fewer than two tabs', () => {
  expect(createMruCycle().next(1, [{ id: 1 }], 0)).toBeUndefined();
});
