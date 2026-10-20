import { describe, expect, it } from 'vitest';
import { type Box, tileInsertionIndex } from '../src/lib/drag/tile-hit';

// Two rows: tiles 0-2 at y 0-48, tiles 3-4 at y 54-102; 64px wide with 6px gaps.
const box = (col: number, row: number): Box => ({
  left: col * 70,
  right: col * 70 + 64,
  top: row * 54,
  bottom: row * 54 + 48,
});
const tiles = [box(0, 0), box(1, 0), box(2, 0), box(0, 1), box(1, 1)];

describe('tileInsertionIndex', () => {
  it('left half of a tile inserts before it, right half after it', () => {
    expect(tileInsertionIndex(tiles, 80, 20)).toBe(1);
    expect(tileInsertionIndex(tiles, 120, 20)).toBe(2);
    expect(tileInsertionIndex(tiles, 10, 70)).toBe(3);
    expect(tileInsertionIndex(tiles, 130, 70)).toBe(5);
  });

  it('past the last tile of a row inserts at the end of that row', () => {
    expect(tileInsertionIndex(tiles, 260, 20)).toBe(3);
    expect(tileInsertionIndex(tiles, 260, 70)).toBe(5);
  });

  it('gaps and padding count toward the nearest row', () => {
    expect(tileInsertionIndex(tiles, 10, 50)).toBe(0);
    expect(tileInsertionIndex(tiles, 10, 53)).toBe(3);
    expect(tileInsertionIndex(tiles, 200, -5)).toBe(3);
    expect(tileInsertionIndex(tiles, 10, 140)).toBe(3);
    expect(tileInsertionIndex(tiles, 67, 20)).toBe(1);
  });

  it('no tiles: index 0', () => {
    expect(tileInsertionIndex([], 0, 0)).toBe(0);
  });
});
