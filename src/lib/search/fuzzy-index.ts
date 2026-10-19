import {
  displayUrl,
  type Range,
  type SearchDoc,
  type SearchHit,
  type SearchIndex,
} from './search-index';

interface Entry {
  id: number;
  title: string;
  url: string;
  titleLower: string;
  urlLower: string;
}

interface TokenMatch {
  score: number;
  ranges: Range[];
}

const MAX_TOKENS = 8;
const MAX_QUERY = 100;
/** URL matches count for less than title matches. */
const URL_WEIGHT = 0.6;

const isBoundary = (s: string, i: number): boolean =>
  i === 0 || /[\s\-_./:?#&=()[\]]/.test(s[i - 1] ?? '');

/**
 * Scores one query token against one lowercased field. Substring matches beat scattered
 * (subsequence) matches by construction: their base score is higher than any
 * subsequence score can reach.
 */
export function matchToken(text: string, token: string): TokenMatch | null {
  const at = text.indexOf(token);
  if (at !== -1) {
    // Prefer a later occurrence that starts on a word boundary ("tab" in "my tabs").
    let best = at;
    for (let i = at; i !== -1; i = text.indexOf(token, i + 1)) {
      if (isBoundary(text, i)) {
        best = i;
        break;
      }
    }
    const bonus = best === 0 ? 30 : isBoundary(text, best) ? 20 : 0;
    return {
      score: 100 + bonus + token.length * 2 - Math.min(best, 50) * 0.2,
      ranges: [[best, best + token.length]],
    };
  }

  // Subsequence: greedy, but each character prefers a word-boundary occurrence that still
  // leaves room for the rest of the token.
  const ranges: [number, number][] = [];
  let score = 0;
  let pos = 0;
  let prev = -2;
  for (let k = 0; k < token.length; k++) {
    const ch = token[k] as string;
    let i = text.indexOf(ch, pos);
    if (i === -1) return null;
    if (i !== prev + 1) {
      for (
        let j = i;
        j !== -1 && j < text.length - (token.length - k - 1);
        j = text.indexOf(ch, j + 1)
      ) {
        if (isBoundary(text, j)) {
          i = j;
          break;
        }
      }
    }
    if (i === prev + 1) {
      score += 6;
      const last = ranges[ranges.length - 1];
      if (last) last[1] = i + 1;
    } else {
      score += isBoundary(text, i) ? 8 : 1;
      score -= Math.min(i - pos, 20) * 0.3;
      ranges.push([i, i + 1]);
    }
    prev = i;
    pos = i + 1;
  }
  return { score: Math.min(score, 90), ranges };
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** In-memory linear-scan fuzzy matcher; ~1–2 ms per keystroke at 1,500 tabs. */
export class FuzzyIndex implements SearchIndex {
  private entries: Entry[] = [];
  private cache = new Map<number, Entry>();

  replaceAll(docs: readonly SearchDoc[]): void {
    const next = new Map<number, Entry>();
    this.entries = docs.map((d) => {
      const url = displayUrl(d.url);
      const old = this.cache.get(d.id);
      // Lowercasing 1,500 titles per patch is cheap, but most patches change one tab.
      const e =
        old && old.title === d.title && old.url === url
          ? old
          : {
              id: d.id,
              title: d.title,
              url,
              titleLower: d.title.toLowerCase(),
              urlLower: url.toLowerCase(),
            };
      next.set(d.id, e);
      return e;
    });
    this.cache = next;
  }

  search(query: string, limit = Number.POSITIVE_INFINITY): SearchHit[] {
    const tokens = query
      .toLowerCase()
      .slice(0, MAX_QUERY)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_TOKENS);
    if (tokens.length === 0) return [];
    const hits: (SearchHit & { order: number })[] = [];
    this.entries.forEach((e, order) => {
      let total = 0;
      const title: Range[] = [];
      const url: Range[] = [];
      // Every token must match somewhere (AND), each in whichever field scores better.
      for (const tok of tokens) {
        const t = matchToken(e.titleLower, tok);
        const u = matchToken(e.urlLower, tok);
        const ts = t ? t.score : -1;
        const us = u ? u.score * URL_WEIGHT : -1;
        if (ts < 0 && us < 0) return;
        if (ts >= us && t) {
          total += ts;
          title.push(...t.ranges);
        } else if (u) {
          total += us;
          url.push(...u.ranges);
        }
      }
      hits.push({
        id: e.id,
        score: total,
        title: mergeRanges(title),
        url: mergeRanges(url),
        order,
      });
    });
    hits.sort((a, b) => b.score - a.score || a.order - b.order);
    return hits.slice(0, limit).map(({ order: _o, ...h }) => h);
  }
}
