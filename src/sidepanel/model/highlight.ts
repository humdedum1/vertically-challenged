import type { Range } from '../../lib/search/search-index';

export interface Segment {
  text: string;
  hit: boolean;
}

/** Splits `text` at sorted, non-overlapping `ranges` so the UI can wrap hits in <mark>. */
export function segments(text: string, ranges: readonly Range[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    const start = Math.max(pos, Math.min(s, text.length));
    const end = Math.min(e, text.length);
    if (end <= start) continue;
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}
