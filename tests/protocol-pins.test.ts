import { describe, expect, it } from 'vitest';
import { MAX_ITEMS } from '../src/shared/layout';
import { parsePanelMessage } from '../src/shared/protocol';

const I = 'iabcdefghij';
const F = 'f0123456789';
const L = 'lzzzzzzzzzz';
const badNodeIds = [
  '',
  'x0123456789',
  'iABCDEFGHIJ',
  'i012345678',
  'i01234567890',
  5,
  null,
  undefined,
];
const badWindowIds = [-1, 1.5, '1', null, undefined];
const ess = { zone: 'essentials', index: 0 } as const;
const root = { zone: 'pinned', folderId: null, index: 2 } as const;
const inFolder = { zone: 'pinned', folderId: F, index: 0 } as const;
const badDests = [
  null,
  { zone: 'essentials', index: -1 },
  { zone: 'essentials', index: 1.5 },
  { zone: 'essentials', index: MAX_ITEMS + 1 },
  { zone: 'pinned', folderId: 'nope', index: 0 },
  { zone: 'pinned', index: 0 },
  { zone: 'grid', index: 0 },
];

/** Each valid message parses to itself, with unknown fields dropped. */
const valid = [
  { type: 'pinTabs', tabIds: [1, 2], windowId: 1, dest: ess },
  { type: 'pinTabs', tabIds: [0], windowId: 0, dest: inFolder },
  { type: 'pinMove', windowId: 1, nodeId: F, toWindowId: 2, dest: root },
  { type: 'pinOpen', windowId: 1, itemId: I },
  { type: 'pinClose', windowId: 1, itemIds: [I] },
  { type: 'pinRemove', windowId: 1, itemId: I, mode: 'unpin' },
  { type: 'pinRemove', windowId: 1, itemId: I, mode: 'close' },
  { type: 'pinHome', windowId: 1, itemId: I },
  { type: 'pinSetHome', windowId: 1, itemId: I },
  { type: 'folderCreate', windowId: 1, name: 'Work', dest: root, itemIds: [I] },
  { type: 'folderCreate', windowId: 1, name: 'Empty', dest: inFolder, itemIds: [] },
  { type: 'folderUpdate', windowId: 1, folderId: F },
  { type: 'folderUpdate', windowId: 1, folderId: F, name: 'X', icon: 'star', collapsed: true },
  { type: 'folderDelete', windowId: 1, folderId: F, keepTabs: false },
  { type: 'folderSuspend', windowId: 1, folderId: F },
  { type: 'clearTabs', windowId: 1 },
  { type: 'renameWindow', windowId: 1, name: 'Research' },
  { type: 'renameWindow', windowId: 1, name: null },
  { type: 'setWindowCollapsed', windowId: 1, otherWindowId: 2, collapsed: true },
  { type: 'setupOpen', setupId: L },
  { type: 'setupApply', setupId: L, windowId: 3 },
  { type: 'setupRename', setupId: L, name: 'Morning' },
  { type: 'setupDelete', setupId: L },
] as const;

describe('pin messages: valid', () => {
  for (const m of valid) {
    it(`${m.type} round-trips`, () => {
      expect(parsePanelMessage({ ...m, junk: 1 })).toEqual(m);
    });
  }

  it('trims names', () => {
    expect(parsePanelMessage({ type: 'renameWindow', windowId: 1, name: '  Research  ' })).toEqual({
      type: 'renameWindow',
      windowId: 1,
      name: 'Research',
    });
    expect(parsePanelMessage({ type: 'setupRename', setupId: L, name: ' a ' })).toEqual({
      type: 'setupRename',
      setupId: L,
      name: 'a',
    });
  });

  it('keeps only valid optional folderUpdate fields', () => {
    expect(
      parsePanelMessage({
        type: 'folderUpdate',
        windowId: 1,
        folderId: F,
        name: '   ',
        icon: 'rocket',
        collapsed: 'yes',
      }),
    ).toEqual({ type: 'folderUpdate', windowId: 1, folderId: F });
  });
});

describe('pin messages: invalid', () => {
  it('rejects every message with a field removed', () => {
    for (const m of valid) {
      for (const key of Object.keys(m)) {
        if (key === 'type') continue;
        // folderUpdate's patch fields are optional.
        if (m.type === 'folderUpdate' && ['name', 'icon', 'collapsed'].includes(key)) continue;
        const { [key]: _drop, ...rest } = m as Record<string, unknown>;
        expect(parsePanelMessage(rest), `${m.type} without ${key}`).toBeNull();
      }
    }
  });

  it('rejects bad node and layout ids', () => {
    for (const bad of badNodeIds) {
      expect(parsePanelMessage({ type: 'pinOpen', windowId: 1, itemId: bad })).toBeNull();
      expect(parsePanelMessage({ type: 'folderSuspend', windowId: 1, folderId: bad })).toBeNull();
      expect(parsePanelMessage({ type: 'setupDelete', setupId: bad })).toBeNull();
      expect(parsePanelMessage({ type: 'pinClose', windowId: 1, itemIds: [I, bad] })).toBeNull();
      expect(
        parsePanelMessage({ type: 'pinMove', windowId: 1, nodeId: bad, toWindowId: 1, dest: ess }),
      ).toBeNull();
    }
  });

  it('rejects bad window and tab ids', () => {
    for (const bad of badWindowIds) {
      expect(parsePanelMessage({ type: 'clearTabs', windowId: bad })).toBeNull();
      expect(
        parsePanelMessage({
          type: 'setWindowCollapsed',
          windowId: 1,
          otherWindowId: bad,
          collapsed: true,
        }),
      ).toBeNull();
      expect(
        parsePanelMessage({ type: 'pinTabs', tabIds: [1, bad], windowId: 1, dest: ess }),
      ).toBeNull();
    }
    expect(parsePanelMessage({ type: 'pinTabs', tabIds: [], windowId: 1, dest: ess })).toBeNull();
  });

  it('rejects oversized names and lists', () => {
    const long = 'x'.repeat(101);
    expect(parsePanelMessage({ type: 'renameWindow', windowId: 1, name: long })).toBeNull();
    expect(parsePanelMessage({ type: 'renameWindow', windowId: 1, name: '   ' })).toBeNull();
    expect(parsePanelMessage({ type: 'setupRename', setupId: L, name: long })).toBeNull();
    expect(
      parsePanelMessage({ type: 'folderCreate', windowId: 1, name: long, dest: root, itemIds: [] }),
    ).toBeNull();
    expect(
      parsePanelMessage({ type: 'folderCreate', windowId: 1, name: '', dest: root, itemIds: [] }),
    ).toBeNull();
    const many = Array(501).fill(I);
    expect(
      parsePanelMessage({
        type: 'folderCreate',
        windowId: 1,
        name: 'a',
        dest: root,
        itemIds: many,
      }),
    ).toBeNull();
    expect(parsePanelMessage({ type: 'pinClose', windowId: 1, itemIds: many })).toBeNull();
    expect(
      parsePanelMessage({ type: 'pinTabs', tabIds: Array(501).fill(1), windowId: 1, dest: ess }),
    ).toBeNull();
  });

  it('rejects invalid destinations', () => {
    for (const dest of badDests) {
      expect(parsePanelMessage({ type: 'pinTabs', tabIds: [1], windowId: 1, dest })).toBeNull();
      expect(
        parsePanelMessage({ type: 'pinMove', windowId: 1, nodeId: I, toWindowId: 1, dest }),
      ).toBeNull();
    }
    // Folders can't live in Essentials, so a folder destination there is rejected.
    expect(
      parsePanelMessage({ type: 'folderCreate', windowId: 1, name: 'a', dest: ess, itemIds: [] }),
    ).toBeNull();
    expect(
      parsePanelMessage({
        type: 'pinTabs',
        tabIds: [1],
        windowId: 1,
        dest: { ...root, index: MAX_ITEMS },
      }),
    ).not.toBeNull();
  });

  it('rejects unknown enum values', () => {
    expect(
      parsePanelMessage({ type: 'pinRemove', windowId: 1, itemId: I, mode: 'delete' }),
    ).toBeNull();
    expect(
      parsePanelMessage({ type: 'folderDelete', windowId: 1, folderId: F, keepTabs: 'no' }),
    ).toBeNull();
    expect(
      parsePanelMessage({
        type: 'setWindowCollapsed',
        windowId: 1,
        otherWindowId: 2,
        collapsed: 1,
      }),
    ).toBeNull();
    expect(parsePanelMessage({ type: 'renameWindow', windowId: 1, name: 5 })).toBeNull();
  });
});
