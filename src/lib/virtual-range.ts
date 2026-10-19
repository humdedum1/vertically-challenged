export interface VirtualRange {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
  /** translateY for the first rendered row. */
  offset: number;
  totalHeight: number;
}

/**
 * Fixed-row-height windowing. Fixed heights keep this O(1) per scroll frame; density
 * settings change the row height globally rather than per row.
 */
export function computeRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): VirtualRange {
  const totalHeight = count * rowHeight;
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0, offset: 0, totalHeight };
  const maxTop = Math.max(0, totalHeight - viewportHeight);
  const top = Math.min(Math.max(0, scrollTop), maxTop);
  const first = Math.floor(top / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);
  return { start, end, offset: start * rowHeight, totalHeight };
}

/** scrollTop that brings `index` fully into view, or null if it already is. */
export function scrollToReveal(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return null;
}
