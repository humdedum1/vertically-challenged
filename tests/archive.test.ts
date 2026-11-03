import { describe, expect, it } from 'vitest';
import { shouldArchive } from '../src/background/suspend/eligibility';
import { ARCHIVE_ID, type SavedWindow, type Session, withArchived } from '../src/shared/sessions';
import { tab } from './helpers';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const old = { url: 'https://a.com/', lastAccessed: NOW - 8 * DAY };

describe('shouldArchive', () => {
  it('archives a plain tab not opened for the set days', () => {
    expect(shouldArchive(tab(1, old), NOW, 7, [])).toBe(true);
    expect(shouldArchive(tab(1, { ...old, lastAccessed: NOW - 6 * DAY }), NOW, 7, [])).toBe(false);
  });

  it('keeps tabs the user would miss or that sessions cannot store', () => {
    for (const p of [{ active: true }, { pinned: true }, { audible: true }, { incognito: true }]) {
      expect(shouldArchive(tab(1, { ...old, ...p }), NOW, 7, [])).toBe(false);
    }
    expect(shouldArchive(tab(1, old), NOW, 7, ['a.com'])).toBe(false);
    expect(shouldArchive(tab(1, { ...old, url: 'chrome://settings/' }), NOW, 7, [])).toBe(false);
    expect(shouldArchive(tab(1, { ...old, lastAccessed: undefined }), NOW, 7, [])).toBe(false);
    expect(shouldArchive(tab(1, old), NOW, 0, [])).toBe(false);
  });
});

const win = (urls: string[], group: number | null = null): SavedWindow => ({
  tabs: urls.map((url) => ({ url, title: url, pinned: false, group })),
  groups: group === null ? [] : [{ title: 'G', color: 'blue', collapsed: false }],
});

describe('withArchived', () => {
  const other: Session = {
    id: 'x1',
    name: 'Mine',
    createdAt: 1,
    windows: [win(['https://m.com/'])],
  };

  it('creates one archive session first and leaves other sessions alone', () => {
    const list = withArchived([other], [win(['https://a.com/']), win(['https://b.com/'])], 5);
    expect(list.map((s) => s.id)).toEqual([ARCHIVE_ID, 'x1']);
    expect(list[0]?.windows).toHaveLength(1);
    expect(list[0]?.windows[0]?.tabs.map((t) => t.url)).toEqual([
      'https://a.com/',
      'https://b.com/',
    ]);
    expect(list[1]).toBe(other);
  });

  it('appends to the archive, re-archived URLs move to the end, groups stay attached', () => {
    const first = withArchived([], [win(['https://a.com/', 'https://b.com/'], 0)], 1);
    const next = withArchived(first, [win(['https://a.com/', 'https://c.com/'], 0)], 2);
    const w = next[0]?.windows[0];
    expect(w?.tabs.map((t) => t.url)).toEqual([
      'https://b.com/',
      'https://a.com/',
      'https://c.com/',
    ]);
    expect(w?.tabs.map((t) => t.group)).toEqual([0, 1, 1]);
    expect(w?.groups).toHaveLength(2);
  });
});
