import { describe, expect, it } from 'vitest';
import { searchPutAway } from '../src/shared/put-away-search';
import type { Session } from '../src/shared/sessions';
import type { Snoozed } from '../src/shared/snooze';

const session = (id: string, name: string, createdAt: number, tabs: [string, string][]): Session =>
  ({
    id,
    name,
    createdAt,
    windows: [
      {
        groups: [],
        tabs: tabs.map(([url, title]) => ({ url, title, pinned: false, group: null })),
      },
    ],
  }) as Session;
const snz = (id: string, url: string, title: string, wakeAt: number): Snoozed => ({
  id,
  url,
  title,
  wakeAt,
  snoozedAt: 0,
});

describe('searchPutAway', () => {
  const sessions = [
    session('a', 'Trip', 1, [
      ['https://hotels.example/rome', 'Hotels in Rome'],
      ['https://x.example/', 'Other'],
    ]),
    session('b', 'Work', 2, [
      ['https://hotels.example/rome', 'Hotels in Rome'],
      ['https://docs.example/plan', 'Quarterly plan'],
    ]),
  ];
  const snoozed = [
    snz('s1', 'https://news.example/rome-trip', 'Rome travel guide', 50),
    snz('s2', 'https://a.example/', 'Unrelated', 10),
  ];

  it('matches every word in any order across title, address and session name', () => {
    const r = searchPutAway('rome hotels', sessions, snoozed, new Set());
    expect(r.sessionHits.map((h) => h.url)).toEqual(['https://hotels.example/rome']);
    expect(r.snoozedHits).toEqual([]);
    expect(
      searchPutAway('trip rome', sessions, snoozed, new Set()).snoozedHits.map((s) => s.id),
    ).toEqual(['s1']);
    expect(searchPutAway('work plan', sessions, [], new Set()).sessionHits[0]?.session).toBe(
      'Work',
    );
  });

  it('skips pages that are already open, lists a page once, and caps results', () => {
    const open = new Set(['https://hotels.example/rome']);
    expect(searchPutAway('hotels', sessions, snoozed, open).sessionHits).toEqual([]);
    const many = session(
      'c',
      'Big',
      3,
      Array.from(
        { length: 20 },
        (_, i) => [`https://m.example/${i}`, `match ${i}`] as [string, string],
      ),
    );
    expect(searchPutAway('match', [many], [], new Set(), 5).sessionHits).toHaveLength(5);
  });

  it('returns nothing for an empty query', () => {
    expect(searchPutAway('  ', sessions, snoozed, new Set())).toEqual({
      sessionHits: [],
      snoozedHits: [],
    });
  });
});
