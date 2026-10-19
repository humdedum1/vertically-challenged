import type { Range } from '../../../lib/search/search-index';

/**
 * Case-insensitive ranges of every whitespace-separated query word in `text`, merged and
 * sorted so model/highlight `segments` can consume them. Chrome's bookmark search is
 * word-based too, so this matches what the user sees as "why did this match".
 */
export function matchRanges(text: string, query: string): Range[] {
  const hay = text.toLowerCase();
  const found: [number, number][] = [];
  for (const word of query.toLowerCase().split(/\s+/)) {
    if (!word) continue;
    let from = 0;
    for (let i = hay.indexOf(word, from); i !== -1; i = hay.indexOf(word, from)) {
      found.push([i, i + word.length]);
      from = i + word.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
