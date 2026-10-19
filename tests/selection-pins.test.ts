import { describe, expect, it } from 'vitest';
import type { WindowLayout } from '../src/shared/layout';
import { buildPanelRows } from '../src/sidepanel/model/rows';
import { tabIdsBetween } from '../src/sidepanel/model/selection';
import { tab } from './helpers';

const item = (id: string, tabId: number | null) =>
  ({ kind: 'item', id, homeUrl: 'https://a/', lastUrl: 'https://a/', title: id, tabId }) as const;

describe('tabIdsBetween with pinned rows', () => {
  it('includes live pinned rows but not dormant ones, folders or the divider', () => {
    const layout: WindowLayout = {
      id: 'laaaaaaaaaa',
      name: null,
      essentials: [],
      pinned: [
        {
          kind: 'folder',
          id: 'fF',
          name: 'F',
          icon: 'folder',
          collapsed: false,
          children: [item('ia', 5), item('ib', null)],
        },
      ],
      collapsed: [],
      incognito: false,
      lastUsed: 0,
    };
    const rows = buildPanelRows(
      [
        {
          info: { id: 1, incognito: false, focused: false },
          tabs: [tab(5, { pinned: true }), tab(6)],
          groups: [],
          layout,
        },
      ],
      1,
      { tilesPerRow: 4 },
    );
    expect(rows.map((r) => r.kind)).toEqual(['folder', 'pin', 'pin', 'divider', 'tab']);
    expect(tabIdsBetween(rows, 0, rows.length - 1)).toEqual([5, 6]);
  });
});
