import { hostOf } from '../../shared/host-pattern';
import type { TabInfo } from '../../shared/types';

export type Filter =
  | { kind: 'is'; value: string; not: boolean }
  | { kind: 'site'; value: string; not: boolean }
  | { kind: 'group'; value: string; not: boolean };

export const IS_FILTERS = [
  'audible',
  'muted',
  'suspended',
  'pinned',
  'active',
  'loading',
  'grouped',
  'ungrouped',
] as const;

/**
 * Splits a search into free text and filters: `is:audible`, `is:suspended`, `site:github.com`,
 * `group:work`, each negatable with a leading `-`. Unknown `x:y` words stay as text, so
 * searching for "localhost:3000" still works.
 */
export function parseQuery(query: string): { text: string; filters: Filter[] } {
  const filters: Filter[] = [];
  const text: string[] = [];
  for (const word of query.split(/\s+/)) {
    const m = /^(-?)(is|site|group):(.+)$/i.exec(word);
    const kind = m?.[2]?.toLowerCase();
    const value = m?.[3]?.toLowerCase() ?? '';
    if (m && kind === 'is' && (IS_FILTERS as readonly string[]).includes(value))
      filters.push({ kind: 'is', value, not: m[1] === '-' });
    else if (m && (kind === 'site' || kind === 'group'))
      filters.push({ kind, value: value.replace(/^www\./, ''), not: m[1] === '-' });
    else if (word) text.push(word);
  }
  return { text: text.join(' '), filters };
}

function test(f: Filter, tab: TabInfo, groupTitle: (id: number) => string | undefined): boolean {
  switch (f.kind) {
    case 'site': {
      const host = hostOf(tab.url);
      return host !== null && (host === f.value || host.endsWith(`.${f.value}`));
    }
    case 'group':
      return tab.groupId !== -1 && (groupTitle(tab.groupId) ?? '').toLowerCase().includes(f.value);
    case 'is':
      switch (f.value) {
        case 'audible':
          return tab.audible;
        case 'muted':
          return tab.muted;
        case 'suspended':
          return tab.discarded;
        case 'pinned':
          return tab.pinned;
        case 'active':
          return tab.active;
        case 'loading':
          return tab.loading;
        case 'grouped':
          return tab.groupId !== -1;
        default:
          return tab.groupId === -1;
      }
  }
}

export function matchesFilters(
  tab: TabInfo,
  filters: readonly Filter[],
  groupTitle: (id: number) => string | undefined,
): boolean {
  return filters.every((f) => test(f, tab, groupTitle) !== f.not);
}
