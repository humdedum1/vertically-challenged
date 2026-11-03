import { expect, it } from 'vitest';
import { matchesFilters, parseQuery } from '../src/lib/search/filters';
import type { TabInfo } from '../src/shared/types';

const tab = (more: Partial<TabInfo>): TabInfo => ({
  id: 1,
  windowId: 1,
  title: 't',
  url: 'https://www.github.com/x',
  pinned: false,
  active: false,
  audible: false,
  muted: false,
  discarded: false,
  loading: false,
  groupId: -1,
  incognito: false,
  ...more,
});

it('splits text from filters and keeps unknown prefixes as text', () => {
  expect(parseQuery('pull is:Audible -site:www.example.com localhost:3000 group:Work')).toEqual({
    text: 'pull localhost:3000',
    filters: [
      { kind: 'is', value: 'audible', not: false },
      { kind: 'site', value: 'example.com', not: true },
      { kind: 'group', value: 'work', not: false },
    ],
  });
  expect(parseQuery('is:nonsense').text).toBe('is:nonsense');
});

it('matches tabs against every filter', () => {
  const titles = (id: number) => (id === 4 ? 'Work stuff' : undefined);
  const f = (q: string) => parseQuery(q).filters;
  expect(matchesFilters(tab({}), f('site:github.com is:ungrouped'), titles)).toBe(true);
  expect(matchesFilters(tab({}), f('site:hub.com'), titles)).toBe(false);
  expect(matchesFilters(tab({ groupId: 4 }), f('group:work'), titles)).toBe(true);
  expect(matchesFilters(tab({ discarded: true }), f('is:suspended -is:pinned'), titles)).toBe(true);
  expect(matchesFilters(tab({ audible: true }), f('-is:audible'), titles)).toBe(false);
});
