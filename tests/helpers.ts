import type { TabInfo } from '../src/shared/types';

export function tab(id: number, overrides: Partial<TabInfo> = {}): TabInfo {
  return {
    id,
    windowId: 1,
    title: `Tab ${id}`,
    url: `https://example.com/${id}`,
    pinned: false,
    active: false,
    audible: false,
    muted: false,
    discarded: false,
    loading: false,
    groupId: -1,
    incognito: false,
    ...overrides,
  };
}
