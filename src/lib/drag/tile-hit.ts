export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Insertion index for a pointer over wrapped tiles (in DOM order): the hovered tile's
 * index, +1 in its right half. The pointer counts as being in the nearest row (gaps and
 * padding included), and past the last tile of a row (the empty area after the last
 * tile) inserts after it.
 */
export function tileInsertionIndex(tiles: readonly Box[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  let rowTop = 0;
  for (const t of tiles) {
    const d = y < t.top ? t.top - y : y > t.bottom ? y - t.bottom : 0;
    if (d < best) {
      best = d;
      rowTop = t.top;
    }
  }
  let index = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i] as Box;
    if (t.top !== rowTop) continue;
    if (x < (t.left + t.right) / 2) return i;
    index = i + 1;
  }
  return index;
}
