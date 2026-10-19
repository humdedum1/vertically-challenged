import { describe, expect, it } from 'vitest';
import {
  collectUrls,
  flattenTree,
  isScriptUrl,
  type Node,
} from '../src/sidepanel/panels/bookmarks/flatten';

const bm = (id: string, url: string): Node => ({ id, title: id, url });
const root: Node = {
  id: '0',
  title: '',
  children: [
    {
      id: '1',
      title: 'Bar',
      children: [
        bm('a', 'https://a.test'),
        { id: 'f', title: 'F', children: [bm('b', 'https://b.test')] },
      ],
    },
    { id: '2', title: 'Other', children: [] },
    { id: '3', title: 'Mobile', children: [] },
  ],
};

describe('flattenTree', () => {
  it('shows only top-level folders when collapsed, hiding an empty Mobile', () => {
    const rows = flattenTree(root, new Set());
    expect(rows.map((r) => r.node.id)).toEqual(['1', '2']);
  });
  it('descends into expanded folders with levels and positions', () => {
    const rows = flattenTree(root, new Set(['1', 'f']));
    expect(rows.map((r) => [r.node.id, r.level, r.pos, r.size, r.parentId])).toEqual([
      ['1', 1, 1, 2, null],
      ['a', 2, 1, 2, '1'],
      ['f', 2, 2, 2, '1'],
      ['b', 3, 1, 1, 'f'],
      ['2', 1, 2, 2, null],
    ]);
  });
  it('handles a missing root', () => {
    expect(flattenTree(undefined, new Set())).toEqual([]);
  });
});

describe('helpers', () => {
  it('collects URLs recursively', () => {
    expect(collectUrls(root.children?.[0] as Node)).toEqual(['https://a.test', 'https://b.test']);
  });
  it('detects bookmarklets', () => {
    expect(isScriptUrl(' JavaScript:alert(1)')).toBe(true);
    expect(isScriptUrl('https://x.test')).toBe(false);
  });
});
