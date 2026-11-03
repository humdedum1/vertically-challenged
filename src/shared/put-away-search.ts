import type { Session } from './sessions';
import type { Snoozed } from './snooze';

export interface SessionHit {
  url: string;
  title: string;
  session: string;
}

const words = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (ws: readonly string[], ...fields: string[]): boolean => {
  const hay = fields.join(' ').toLowerCase();
  return ws.every((w) => hay.includes(w));
};

/**
 * Tabs the user has put away that match the search: pages inside saved sessions, and snoozed
 * tabs. Every word must appear in the title or address, in any order. Pages already open are
 * left out, and each list is capped, newest first.
 */
export function searchPutAway(
  query: string,
  sessions: readonly Session[],
  snoozed: readonly Snoozed[],
  open: ReadonlySet<string>,
  limit = 5,
): { sessionHits: SessionHit[]; snoozedHits: Snoozed[] } {
  const ws = words(query);
  if (!ws.length) return { sessionHits: [], snoozedHits: [] };
  const sessionHits: SessionHit[] = [];
  const seen = new Set<string>();
  for (const s of [...sessions].sort((a, b) => b.createdAt - a.createdAt)) {
    for (const w of s.windows)
      for (const t of w.tabs) {
        if (sessionHits.length >= limit) break;
        if (seen.has(t.url) || open.has(t.url) || !matches(ws, t.title, t.url, s.name)) continue;
        seen.add(t.url);
        sessionHits.push({ url: t.url, title: t.title || t.url, session: s.name });
      }
  }
  const snoozedHits = snoozed
    .filter((s) => !open.has(s.url) && matches(ws, s.title, s.url))
    .sort((a, b) => a.wakeAt - b.wakeAt)
    .slice(0, limit);
  return { sessionHits, snoozedHits };
}
