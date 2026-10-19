import { describe, expect, it } from 'vitest';
import {
  appendLayout,
  createFolder,
  deleteFolder,
  insertItems,
  moveNode,
  removeItem,
  updateFolder,
} from '../src/background/pins/ops';
import {
  findNode,
  flattenItems,
  MAX_ITEMS,
  type PinFolder,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../src/shared/layout';

const item = (id: string, tabId: number | null = null): PinItem => ({
  kind: 'item',
  id,
  homeUrl: `https://${id}.test/`,
  lastUrl: `https://${id}.test/`,
  title: id,
  tabId,
});
const folder = (id: string, children: PinNode[] = []): PinFolder => ({
  kind: 'folder',
  id,
  name: id,
  icon: 'folder',
  collapsed: false,
  children,
});
const layout = (essentials: PinItem[], pinned: PinNode[]): WindowLayout => ({
  id: 'labcdefghij0',
  name: null,
  essentials,
  pinned,
  collapsed: [],
  incognito: false,
  lastUsed: 1,
});
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}
const kidNodes = (l: WindowLayout, id: string): PinNode[] => {
  const n = findNode(l, id)?.node;
  if (n?.kind !== 'folder') throw new Error('not a folder');
  return n.children;
};
const kids = (l: WindowLayout, id: string) => kidNodes(l, id).map((c) => c.id);
const ids = (nodes: PinNode[]) => nodes.map((n) => n.id);
const pinned = (id: string | null, index: number) => ({
  zone: 'pinned' as const,
  folderId: id,
  index,
});

describe('moveNode', () => {
  it('moves an essential into a pinned folder at index 0', () => {
    const l = deepFreeze(layout([item('a'), item('b')], [folder('F', [item('x')])]));
    const r = moveNode(l, 'a', pinned('F', 0));
    expect(ids(r.essentials)).toEqual(['b']);
    expect(kids(r, 'F')).toEqual(['a', 'x']);
  });

  it('moves a pinned item to essentials index 1', () => {
    const l = deepFreeze(layout([item('a'), item('b')], [folder('F', [item('x')])]));
    const r = moveNode(l, 'x', { zone: 'essentials', index: 1 });
    expect(ids(r.essentials)).toEqual(['a', 'x', 'b']);
    expect(kidNodes(r, 'F')).toEqual([]);
  });

  it('index counts siblings after removal and clamps past the end', () => {
    const l = layout([], [item('a'), item('b'), item('c')]);
    expect(ids(moveNode(l, 'a', pinned(null, 1)).pinned)).toEqual(['b', 'a', 'c']);
    expect(ids(moveNode(l, 'a', pinned(null, 99)).pinned)).toEqual(['b', 'c', 'a']);
  });

  it('same-position move is structurally equal', () => {
    const l = layout([], [item('a'), item('b')]);
    expect(moveNode(l, 'a', pinned(null, 0))).toEqual(l);
  });

  it('rejects a folder into itself or a descendant', () => {
    const l = deepFreeze(layout([], [folder('F', [folder('G')])]));
    expect(moveNode(l, 'F', pinned('F', 0))).toBe(l);
    expect(moveNode(l, 'F', pinned('G', 0))).toBe(l);
  });

  it('rejects a folder to essentials', () => {
    const l = layout([], [folder('F')]);
    expect(moveNode(l, 'F', { zone: 'essentials', index: 0 })).toBe(l);
  });

  it('rejects a folder ending beyond depth 3, allows depth 3', () => {
    const l = layout(
      [],
      [folder('A', [folder('B', [folder('C')])]), folder('S', [folder('T')]), folder('Z')],
    );
    expect(moveNode(l, 'Z', pinned('C', 0))).toBe(l); // would be depth 4
    expect(moveNode(l, 'S', pinned('B', 0))).toBe(l); // S(2) -> T(3) under B(2): S at 3, T at 4
    const ok = moveNode(l, 'Z', pinned('B', 0));
    expect(findNode(ok, 'Z')?.depth).toBe(3);
  });

  it('rejects unknown ids and destinations', () => {
    const l = layout([item('a')], []);
    expect(moveNode(l, 'nope', pinned(null, 0))).toBe(l);
    expect(moveNode(l, 'a', pinned('nope', 0))).toBe(l);
    expect(moveNode(l, 'a', pinned('a', 0))).toBe(l);
  });
});

describe('insertItems', () => {
  it('inserts into essentials and folders', () => {
    const l = deepFreeze(layout([item('a')], [folder('F')]));
    expect(ids(insertItems(l, [item('n')], { zone: 'essentials', index: 0 }).essentials)).toEqual([
      'n',
      'a',
    ]);
    const r = insertItems(l, [item('n'), item('m')], pinned('F', 5));
    expect(kids(r, 'F')).toEqual(['n', 'm']);
  });

  it('returns the input past the item cap or for a bad folder', () => {
    const many = Array.from({ length: MAX_ITEMS }, (_, i) => item(`i${i}`));
    const l = layout(many, []);
    expect(insertItems(l, [item('extra')], pinned(null, 0))).toBe(l);
    expect(insertItems(layout([], []), [item('a')], pinned('nope', 0)).pinned).toEqual([]);
  });
});

describe('removeItem', () => {
  it('removes from essentials and nested folders', () => {
    const l = deepFreeze(layout([item('a')], [folder('F', [folder('G', [item('z')])])]));
    expect(removeItem(l, 'a').essentials).toEqual([]);
    expect(flattenItems(removeItem(l, 'z')).map((i) => i.id)).toEqual(['a']);
    expect(removeItem(l, 'nope')).toBe(l);
    expect(removeItem(l, 'F')).toBe(l);
  });
});

describe('createFolder', () => {
  it('moves found items in flattened order and ignores unknown ids', () => {
    const l = deepFreeze(layout([item('a')], [item('x'), item('y')]));
    const { layout: r, folderId } = createFolder(
      l,
      '  Work ',
      { zone: 'pinned', folderId: null, index: 0 },
      ['y', 'a', 'ghost'],
    );
    const f = findNode(r, folderId)?.node as PinFolder;
    expect(f.name).toBe('Work');
    expect(f.icon).toBe('folder');
    expect(f.collapsed).toBe(false);
    expect(f.children.map((c) => c.id)).toEqual(['a', 'y']);
    expect(ids(r.essentials)).toEqual([]);
    expect(ids(r.pinned)).toEqual([folderId, 'x']);
  });

  it('defaults an empty name and rejects beyond depth 3', () => {
    const l = layout([], [folder('A', [folder('B', [folder('C')])])]);
    expect(
      createFolder(l, ' ', { zone: 'pinned', folderId: null, index: 0 }, []).layout.pinned[0],
    ).toMatchObject({ name: 'New folder' });
    const bad = createFolder(l, 'x', { zone: 'pinned', folderId: 'C', index: 0 }, []);
    expect(bad.layout).toBe(l);
    expect(bad.folderId).toBe('');
  });
});

describe('updateFolder', () => {
  it('patches valid fields and ignores invalid ones', () => {
    const l = deepFreeze(layout([], [folder('F')]));
    const r = updateFolder(l, 'F', { name: ' New ', icon: 'star', collapsed: true });
    expect(r.pinned[0]).toMatchObject({ name: 'New', icon: 'star', collapsed: true });
    const r2 = updateFolder(l, 'F', { name: '  ', icon: 'bogus' as never });
    expect(r2.pinned[0]).toMatchObject({ name: 'F', icon: 'folder' });
    expect(updateFolder(l, 'nope', { name: 'x' })).toBe(l);
  });
});

describe('deleteFolder', () => {
  const base = () =>
    layout([], [item('x'), folder('F', [item('y'), folder('G', [item('z')])]), item('w')]);
  it('keep=true splices children in place', () => {
    const l = deepFreeze(base());
    const { layout: r, removedItems } = deleteFolder(l, 'F', true);
    expect(ids(r.pinned)).toEqual(['x', 'y', 'G', 'w']);
    expect(removedItems).toEqual([]);
  });
  it('keep=false returns removed items', () => {
    const l = deepFreeze(base());
    const { layout: r, removedItems } = deleteFolder(l, 'F', false);
    expect(ids(r.pinned)).toEqual(['x', 'w']);
    expect(removedItems.map((i) => i.id)).toEqual(['y', 'z']);
  });
  it('unknown folder is a no-op', () => {
    const l = base();
    expect(deleteFolder(l, 'x', true)).toEqual({ layout: l, removedItems: [] });
  });
});

describe('appendLayout', () => {
  it('appends with fresh ids, dormant', () => {
    const t = deepFreeze(layout([item('a')], [item('p')]));
    const s = deepFreeze(layout([item('a', 5)], [folder('F', [item('q', 6)])]));
    const r = appendLayout(t, s);
    expect(r.essentials).toHaveLength(2);
    expect(r.pinned).toHaveLength(2);
    const all = flattenItems(r);
    expect(all.slice(1).every((i) => i.tabId === null)).toBe(true);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    expect(r.essentials[1]?.id).not.toBe('a');
    expect(r.essentials[1]?.homeUrl).toBe('https://a.test/');
    const f = r.pinned[1] as PinFolder;
    expect(f.id).not.toBe('F');
    expect(f.id).toMatch(/^f/);
    expect(f.children[0]?.id).toMatch(/^i/);
    expect(r.id).toBe(t.id);
  });
});
