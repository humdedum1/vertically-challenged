import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../src/shared/types';
import { staleByHost } from '../src/sidepanel/model/tidy';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const tab = (
  id: number,
  url: string,
  daysAgo: number | undefined,
  over: Partial<TabInfo> = {},
): TabInfo => ({
  id,
  windowId: 1,
  title: `t${id}`,
  url,
  pinned: false,
  active: false,
  audible: false,
  muted: false,
  discarded: false,
  loading: false,
  groupId: -1,
  incognito: false,
  lastAccessed: daysAgo === undefined ? undefined : NOW - daysAgo * DAY,
  ...over,
});

describe('staleByHost', () => {
  it('groups old tabs by site, biggest group first, oldest tab first', () => {
    const g = staleByHost(
      [
        tab(1, 'https://www.a.example/1', 40),
        tab(2, 'https://b.example/', 31),
        tab(3, 'https://a.example/2', 90),
        tab(4, 'https://a.example/3', 5),
      ],
      NOW,
      30,
    );
    expect(g.map((x) => [x.host, x.tabs.map((t) => t.id)])).toEqual([
      ['a.example', [3, 1]],
      ['b.example', [2]],
    ]);
  });

  it('never offers pinned, current, audible, incognito or never-used tabs', () => {
    const list = [
      tab(1, 'https://a.example/', 60, { pinned: true }),
      tab(2, 'https://a.example/', 60, { active: true }),
      tab(3, 'https://a.example/', 60, { audible: true }),
      tab(4, 'https://a.example/', 60, { incognito: true }),
      tab(5, 'https://a.example/', undefined),
      tab(6, 'https://a.example/', 60),
    ];
    expect(staleByHost(list, NOW, 30).flatMap((g) => g.tabs.map((t) => t.id))).toEqual([6]);
  });

  it('puts pages without a web address under one heading and respects the age', () => {
    expect(staleByHost([tab(1, 'chrome://version/', 10)], NOW, 7)[0]?.host).toBe('Other pages');
    expect(staleByHost([tab(1, 'https://a.example/', 10)], NOW, 30)).toEqual([]);
  });
});
