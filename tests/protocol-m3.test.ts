import { describe, expect, it } from 'vitest';
import { parsePanelMessage } from '../src/shared/protocol';
import { GROUP_COLORS } from '../src/shared/types';

const badIds = [-1, 1.5, '3', null, undefined, Number.NaN, Number.POSITIVE_INFINITY];
const longIds = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('single-id messages', () => {
  for (const type of ['activate', 'closeOthers', 'closeBelow', 'duplicate'] as const) {
    it(`${type}: valid and invalid`, () => {
      expect(parsePanelMessage({ type, tabId: 0, junk: 1 })).toEqual({ type, tabId: 0 });
      for (const bad of badIds) expect(parsePanelMessage({ type, tabId: bad })).toBeNull();
    });
  }
  it('subscribe validates windowId', () => {
    expect(parsePanelMessage({ type: 'subscribe', windowId: 2 })).toEqual({
      type: 'subscribe',
      windowId: 2,
      all: false,
    });
    for (const bad of badIds)
      expect(parsePanelMessage({ type: 'subscribe', windowId: bad })).toBeNull();
  });
  it('closeGroup validates groupId', () => {
    expect(parsePanelMessage({ type: 'closeGroup', groupId: 4, x: 1 })).toEqual({
      type: 'closeGroup',
      groupId: 4,
    });
    for (const bad of badIds)
      expect(parsePanelMessage({ type: 'closeGroup', groupId: bad })).toBeNull();
  });
});

describe('id-list messages', () => {
  const kinds: [string, Record<string, unknown>][] = [
    ['close', {}],
    ['ungroup', {}],
    ['setPinned', { pinned: true }],
    ['setMuted', { muted: false }],
    ['move', { target: { windowId: 1, beforeTabId: null, groupId: null, pinned: null } }],
    ['group', { groupId: null }],
  ];
  for (const [type, extra] of kinds) {
    it(`${type}: rejects bad ids, empty and oversized lists; accepts the limit`, () => {
      const msg = (tabIds: unknown) => parsePanelMessage({ type, tabIds, ...extra });
      expect(msg([1, 2])).toMatchObject({ type, tabIds: [1, 2] });
      expect(msg(longIds(5000))).not.toBeNull();
      expect(msg(longIds(5001))).toBeNull();
      expect(msg([])).toBeNull();
      expect(msg('1')).toBeNull();
      expect(msg(undefined)).toBeNull();
      for (const bad of [-1, 1.5, '3', null]) expect(msg([1, bad])).toBeNull();
    });
  }

  it('setPinned / setMuted require booleans', () => {
    expect(parsePanelMessage({ type: 'setPinned', tabIds: [1], pinned: true, z: 1 })).toEqual({
      type: 'setPinned',
      tabIds: [1],
      pinned: true,
    });
    expect(parsePanelMessage({ type: 'setPinned', tabIds: [1], pinned: 'yes' })).toBeNull();
    expect(parsePanelMessage({ type: 'setPinned', tabIds: [1] })).toBeNull();
    expect(parsePanelMessage({ type: 'setMuted', tabIds: [1], muted: false })).toEqual({
      type: 'setMuted',
      tabIds: [1],
      muted: false,
    });
    expect(parsePanelMessage({ type: 'setMuted', tabIds: [1], muted: 0 })).toBeNull();
  });
});

describe('newTab', () => {
  it('accepts null or id afterTabId', () => {
    expect(parsePanelMessage({ type: 'newTab', windowId: 1, afterTabId: null })).toEqual({
      type: 'newTab',
      windowId: 1,
      afterTabId: null,
    });
    expect(parsePanelMessage({ type: 'newTab', windowId: 1, afterTabId: 5 })).toEqual({
      type: 'newTab',
      windowId: 1,
      afterTabId: 5,
    });
  });
  it('rejects bad values', () => {
    expect(parsePanelMessage({ type: 'newTab', windowId: 1 })).toBeNull();
    expect(parsePanelMessage({ type: 'newTab', windowId: 1, afterTabId: -1 })).toBeNull();
    expect(parsePanelMessage({ type: 'newTab', windowId: '1', afterTabId: null })).toBeNull();
  });
});

describe('move', () => {
  const target = { windowId: 1, beforeTabId: 7, groupId: 3, pinned: false };
  it('accepts a full target', () => {
    expect(parsePanelMessage({ type: 'move', tabIds: [1], target })).toEqual({
      type: 'move',
      tabIds: [1],
      target,
    });
  });
  it('accepts groupId -1 / null / id, pinned null / bool, beforeTabId null / id', () => {
    for (const groupId of [-1, null, 0, 9]) {
      for (const pinned of [null, true, false]) {
        for (const beforeTabId of [null, 0, 4]) {
          const t = { windowId: 2, beforeTabId, groupId, pinned };
          expect(parsePanelMessage({ type: 'move', tabIds: [1], target: t })).toEqual({
            type: 'move',
            tabIds: [1],
            target: t,
          });
        }
      }
    }
  });
  it('rejects invalid targets', () => {
    const bad: Record<string, unknown>[] = [
      { ...target, groupId: -2 },
      { ...target, groupId: 1.5 },
      { ...target, groupId: '3' },
      { ...target, groupId: undefined },
      { ...target, pinned: 'no' },
      { ...target, pinned: undefined },
      { ...target, beforeTabId: -1 },
      { ...target, beforeTabId: undefined },
      { ...target, windowId: -1 },
      { ...target, windowId: null },
    ];
    for (const t of bad)
      expect(parsePanelMessage({ type: 'move', tabIds: [1], target: t })).toBeNull();
    for (const t of [null, undefined, 5, 'x']) {
      expect(parsePanelMessage({ type: 'move', tabIds: [1], target: t })).toBeNull();
    }
  });
  it('drops unknown fields inside the target and message', () => {
    const out = parsePanelMessage({
      type: 'move',
      tabIds: [1],
      target: { ...target, evil: 1 },
      evil: 2,
    });
    expect(out).toEqual({ type: 'move', tabIds: [1], target });
  });
});

describe('moveGroup', () => {
  it('validates fields', () => {
    expect(
      parsePanelMessage({ type: 'moveGroup', groupId: 1, windowId: 2, beforeTabId: null, x: 1 }),
    ).toEqual({
      type: 'moveGroup',
      groupId: 1,
      windowId: 2,
      beforeTabId: null,
    });
    expect(
      parsePanelMessage({ type: 'moveGroup', groupId: 1, windowId: 2, beforeTabId: 3 }),
    ).not.toBeNull();
    expect(
      parsePanelMessage({ type: 'moveGroup', groupId: -1, windowId: 2, beforeTabId: null }),
    ).toBeNull();
    expect(
      parsePanelMessage({ type: 'moveGroup', groupId: 1, windowId: 1.5, beforeTabId: null }),
    ).toBeNull();
    expect(
      parsePanelMessage({ type: 'moveGroup', groupId: 1, windowId: 2, beforeTabId: -3 }),
    ).toBeNull();
    expect(parsePanelMessage({ type: 'moveGroup', groupId: 1, windowId: 2 })).toBeNull();
  });
});

describe('group', () => {
  it('accepts null or id groupId, with optional title/color', () => {
    expect(parsePanelMessage({ type: 'group', tabIds: [1], groupId: null })).toEqual({
      type: 'group',
      tabIds: [1],
      groupId: null,
    });
    expect(
      parsePanelMessage({ type: 'group', tabIds: [1], groupId: 4, title: 'Work', color: 'red' }),
    ).toEqual({
      type: 'group',
      tabIds: [1],
      groupId: 4,
      title: 'Work',
      color: 'red',
    });
  });
  it('requires groupId and rejects invalid ones', () => {
    expect(parsePanelMessage({ type: 'group', tabIds: [1] })).toBeNull();
    expect(parsePanelMessage({ type: 'group', tabIds: [1], groupId: -4 })).toBeNull();
    expect(parsePanelMessage({ type: 'group', tabIds: [1], groupId: '2' })).toBeNull();
  });
  it('accepts every real colour and drops others rather than rejecting', () => {
    for (const color of GROUP_COLORS) {
      expect(parsePanelMessage({ type: 'group', tabIds: [1], groupId: null, color })).toMatchObject(
        { color },
      );
    }
    const out = parsePanelMessage({ type: 'group', tabIds: [1], groupId: null, color: 'magenta' });
    expect(out).toEqual({ type: 'group', tabIds: [1], groupId: null });
    expect(out).not.toHaveProperty('color');
  });
  it('title: 200 chars kept, 201 dropped, non-string dropped, empty kept', () => {
    const t = (title: unknown) =>
      parsePanelMessage({ type: 'group', tabIds: [1], groupId: null, title });
    expect(t('x'.repeat(200))).toMatchObject({ title: 'x'.repeat(200) });
    expect(t('x'.repeat(201))).toEqual({ type: 'group', tabIds: [1], groupId: null });
    expect(t(5)).toEqual({ type: 'group', tabIds: [1], groupId: null });
    expect(t('')).toMatchObject({ title: '' });
  });
  it('drops unknown fields', () => {
    expect(parsePanelMessage({ type: 'group', tabIds: [1], groupId: null, evil: 1 })).toEqual({
      type: 'group',
      tabIds: [1],
      groupId: null,
    });
  });
});

describe('updateGroup', () => {
  it('parses with only groupId', () => {
    expect(parsePanelMessage({ type: 'updateGroup', groupId: 2 })).toEqual({
      type: 'updateGroup',
      groupId: 2,
    });
  });
  it('keeps all valid optional fields', () => {
    expect(
      parsePanelMessage({
        type: 'updateGroup',
        groupId: 2,
        title: 'T',
        color: 'cyan',
        collapsed: true,
        z: 1,
      }),
    ).toEqual({ type: 'updateGroup', groupId: 2, title: 'T', color: 'cyan', collapsed: true });
    expect(parsePanelMessage({ type: 'updateGroup', groupId: 2, collapsed: false })).toEqual({
      type: 'updateGroup',
      groupId: 2,
      collapsed: false,
    });
  });
  it('omits invalid optional fields instead of rejecting', () => {
    expect(
      parsePanelMessage({
        type: 'updateGroup',
        groupId: 2,
        title: 'x'.repeat(201),
        color: 'nope',
        collapsed: 'yes',
      }),
    ).toEqual({ type: 'updateGroup', groupId: 2 });
  });
  it('rejects a bad groupId', () => {
    for (const bad of badIds)
      expect(parsePanelMessage({ type: 'updateGroup', groupId: bad })).toBeNull();
  });
});

describe('unknown types', () => {
  it('returns null', () => {
    expect(parsePanelMessage({ type: 'nope' })).toBeNull();
    expect(parsePanelMessage({})).toBeNull();
    expect(parsePanelMessage({ type: 5 })).toBeNull();
  });
});
