import { describe, expect, it } from 'vitest';
import type { GroupInfo, TabInfo } from '../../shared/types';
import { buildRows } from './rows';
import { pruneSelection, tabIdsBetween } from './selection';

const tab = (id: number, groupId = -1): TabInfo => ({
  id,
  windowId: 1,
  title: `T${id}`,
  url: '',
  pinned: false,
  active: false,
  audible: false,
  muted: false,
  discarded: false,
  loading: false,
  groupId,
  incognito: false,
});
const group: GroupInfo = { id: 9, windowId: 1, title: 'G', color: 'blue', collapsed: false };

describe('selection', () => {
  it('ranges skip group headers', () => {
    const tabs = [tab(1), tab(2, 9), tab(3, 9), tab(4)];
    const rows = buildRows(tabs, [group]);
    expect(tabIdsBetween(rows, 3, 0)).toEqual([1, 2, 3]);
  });
  it('prunes closed tabs and keeps identity when unchanged', () => {
    const sel = new Set([1, 2]);
    expect(pruneSelection(sel, [tab(1), tab(2)])).toBe(sel);
    expect([...pruneSelection(sel, [tab(2)])]).toEqual([2]);
  });
});
