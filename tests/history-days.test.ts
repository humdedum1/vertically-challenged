import { describe, expect, it } from 'vitest';
import { matchRanges } from '../src/sidepanel/panels/bookmarks/match-ranges';
import { dayKey, dayLabel, withDayHeaders } from '../src/sidepanel/panels/history/days';
import { pluralize, relativeTime } from '../src/sidepanel/panels/sessions/relative-time';

// Local-time constructors keep these tests independent of the machine's timezone.
const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 10, 19, 15);

describe('dayLabel', () => {
  it('labels today and yesterday', () => {
    expect(dayLabel(at(2026, 10, 19, 0, 1), NOW)).toBe('Today');
    expect(dayLabel(at(2026, 10, 19, 23, 59), NOW)).toBe('Today');
    expect(dayLabel(at(2026, 10, 18, 23, 59), NOW)).toBe('Yesterday');
  });
  it('uses weekday + date otherwise', () => {
    expect(dayLabel(at(2026, 10, 12), NOW)).toBe('Monday, Oct 12');
  });
  it('adds the year for other years', () => {
    expect(dayLabel(at(2025, 12, 31), NOW)).toBe('Wednesday, Dec 31, 2025');
  });
  it('treats the day before a month start as yesterday', () => {
    expect(dayLabel(at(2026, 9, 30), at(2026, 10, 1, 1))).toBe('Yesterday');
  });
  it('shares a key within a local day', () => {
    expect(dayKey(at(2026, 1, 5, 0, 0))).toBe(dayKey(at(2026, 1, 5, 23, 59)));
    expect(dayKey(at(2026, 1, 5))).not.toBe(dayKey(at(2026, 1, 6)));
  });
});

describe('withDayHeaders', () => {
  const v = (id: string, t: number) => ({ id, lastVisitTime: t });
  it('inserts one header per day, in order', () => {
    const rows = withDayHeaders(
      [
        v('a', at(2026, 10, 19, 14)),
        v('b', at(2026, 10, 19, 9)),
        v('c', at(2026, 10, 18, 20)),
        v('d', at(2026, 10, 1)),
      ],
      NOW,
    );
    expect(rows.map((r) => (r.kind === 'day' ? `#${r.label}` : r.item.id))).toEqual([
      '#Today',
      'a',
      'b',
      '#Yesterday',
      'c',
      '#Thursday, Oct 1',
      'd',
    ]);
  });
  it('returns nothing for an empty list', () => {
    expect(withDayHeaders([], NOW)).toEqual([]);
  });
});

describe('matchRanges', () => {
  it('finds and merges word hits case-insensitively', () => {
    expect(matchRanges('Foo foobar', 'foo')).toEqual([
      [0, 3],
      [4, 7],
    ]);
    expect(matchRanges('abcdef', 'abc cde')).toEqual([[0, 5]]);
  });
  it('is empty for a blank query', () => {
    expect(matchRanges('abc', '  ')).toEqual([]);
  });
});

describe('relativeTime', () => {
  it('formats recent and older times', () => {
    expect(relativeTime(NOW - 10_000, NOW, 'en')).toBe('just now');
    expect(relativeTime(NOW - 5 * 60_000, NOW, 'en')).toBe('5 minutes ago');
    expect(relativeTime(NOW - 86_400_000, NOW, 'en')).toBe('yesterday');
  });
  it('pluralizes', () => {
    expect(pluralize(1, 'tab')).toBe('1 tab');
    expect(pluralize(2, 'tab')).toBe('2 tabs');
  });
});
