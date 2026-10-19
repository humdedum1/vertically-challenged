/** [start, end) offsets into the original string, for highlighting. */
export type Range = readonly [start: number, end: number];

export interface SearchDoc {
  id: number;
  title: string;
  url: string;
}

export interface SearchHit {
  id: number;
  score: number;
  /** Matched ranges in `title`. */
  title: Range[];
  /** Matched ranges in the display URL (see `displayUrl`). */
  url: Range[];
}

/**
 * Seam for swapping the matcher (e.g. a Rust/WASM build) without touching the UI.
 * Implementations own any precomputation and must be safe to call on every keystroke.
 */
export interface SearchIndex {
  /** Replace the document set; implementations may reuse work for unchanged docs. */
  replaceAll(docs: readonly SearchDoc[]): void;
  /** Hits sorted by descending score; ties keep document order. Empty query → []. */
  search(query: string, limit?: number): SearchHit[];
}

/** The URL as shown and matched: no scheme or leading www., which only add noise. */
export function displayUrl(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/(www\.)?/i, '');
}
