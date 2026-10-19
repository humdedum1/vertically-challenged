import type { GroupInfo, TabInfo } from '../src/shared/types';

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

export function group(id: number, overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    id,
    windowId: 1,
    title: `Group ${id}`,
    color: 'blue',
    collapsed: false,
    ...overrides,
  };
}
