import { describe, expect, it } from 'vitest';
import { parsePanelMessage } from '../src/shared/protocol';

const badIds = [-1, 1.5, '1', null, undefined, Number.NaN, {}];

describe('discard / moveToNewWindow', () => {
  for (const type of ['discard', 'moveToNewWindow'] as const) {
    it(`${type}: valid`, () => {
      expect(parsePanelMessage({ type, tabIds: [1, 2, 3], junk: 1 })).toEqual({
        type,
        tabIds: [1, 2, 3],
      });
      expect(parsePanelMessage({ type, tabIds: [0] })).toEqual({ type, tabIds: [0] });
    });
    it(`${type}: invalid`, () => {
      expect(parsePanelMessage({ type, tabIds: [] })).toBeNull();
      expect(parsePanelMessage({ type })).toBeNull();
      expect(parsePanelMessage({ type, tabIds: 5 })).toBeNull();
      expect(parsePanelMessage({ type, tabIds: Array(5001).fill(1) })).toBeNull();
      for (const bad of badIds) expect(parsePanelMessage({ type, tabIds: [1, bad] })).toBeNull();
    });
  }
});

describe('discardOthers', () => {
  it('valid and invalid', () => {
    expect(parsePanelMessage({ type: 'discardOthers', tabId: 0, junk: 1 })).toEqual({
      type: 'discardOthers',
      tabId: 0,
    });
    for (const bad of badIds)
      expect(parsePanelMessage({ type: 'discardOthers', tabId: bad })).toBeNull();
    expect(parsePanelMessage({ type: 'discardOthers' })).toBeNull();
  });
});

describe('subscribe legacy all', () => {
  it('parses with or without the legacy all field and drops it', () => {
    for (const all of [true, false, undefined, 1, 'true', null])
      expect(parsePanelMessage({ type: 'subscribe', windowId: 1, all })).toEqual({
        type: 'subscribe',
        windowId: 1,
      });
  });
});

describe('saveSession', () => {
  const msg = (o: Record<string, unknown> = {}) => ({
    type: 'saveSession',
    scope: 'window',
    windowId: 4,
    name: 'My session',
    ...o,
  });

  it('valid, for both scopes', () => {
    expect(parsePanelMessage(msg())).toEqual({
      type: 'saveSession',
      scope: 'window',
      windowId: 4,
      name: 'My session',
    });
    expect(parsePanelMessage(msg({ scope: 'all' }))).toMatchObject({ scope: 'all' });
  });

  it('trims the name', () => {
    expect(parsePanelMessage(msg({ name: '   padded  ' }))).toMatchObject({ name: 'padded' });
  });

  it('rejects empty / whitespace-only / non-string names', () => {
    for (const name of ['', ' ', '   \t\n', null, undefined, 5, {}])
      expect(parsePanelMessage(msg({ name }))).toBeNull();
  });

  it('name length: 100 ok, 101 rejected', () => {
    expect(parsePanelMessage(msg({ name: 'a'.repeat(100) }))).toMatchObject({
      name: 'a'.repeat(100),
    });
    expect(parsePanelMessage(msg({ name: 'a'.repeat(101) }))).toBeNull();
  });

  it('rejects bad scope or windowId', () => {
    for (const scope of ['', 'tab', 'ALL', null, undefined, 1])
      expect(parsePanelMessage(msg({ scope }))).toBeNull();
    for (const windowId of badIds) expect(parsePanelMessage(msg({ windowId }))).toBeNull();
  });

  it('drops unknown fields', () => {
    expect(parsePanelMessage(msg({ extra: 1 }))).not.toHaveProperty('extra');
  });
});

describe('renameSession', () => {
  it('valid, trimmed', () => {
    expect(parsePanelMessage({ type: 'renameSession', id: 'abc-1', name: '  New  ' })).toEqual({
      type: 'renameSession',
      id: 'abc-1',
      name: 'New',
    });
  });
  it('rejects bad id or name', () => {
    expect(parsePanelMessage({ type: 'renameSession', id: 'abc', name: ' ' })).toBeNull();
    expect(
      parsePanelMessage({ type: 'renameSession', id: 'abc', name: 'a'.repeat(101) }),
    ).toBeNull();
    expect(parsePanelMessage({ type: 'renameSession', id: 'ABC', name: 'x' })).toBeNull();
    expect(parsePanelMessage({ type: 'renameSession', name: 'x' })).toBeNull();
    expect(parsePanelMessage({ type: 'renameSession', id: 'abc' })).toBeNull();
  });
});

describe('session ids', () => {
  const ok = ['a', 'abc-123', '0', 'x'.repeat(40), 'a-b-c', '-'];
  const bad = ['', 'A', 'a_b', 'a b', 'a.b', 'a/b', 'x'.repeat(41), '../x', 5, null, undefined];

  it('deleteSession', () => {
    for (const id of ok)
      expect(parsePanelMessage({ type: 'deleteSession', id, junk: 1 })).toEqual({
        type: 'deleteSession',
        id,
      });
    for (const id of bad) expect(parsePanelMessage({ type: 'deleteSession', id })).toBeNull();
  });

  it('restoreSession and renameSession use the same id rule', () => {
    for (const id of ok) {
      expect(
        parsePanelMessage({ type: 'restoreSession', id, target: 'newWindow', windowId: 1 }),
      ).not.toBeNull();
      expect(parsePanelMessage({ type: 'renameSession', id, name: 'n' })).not.toBeNull();
    }
    for (const id of bad) {
      expect(
        parsePanelMessage({ type: 'restoreSession', id, target: 'newWindow', windowId: 1 }),
      ).toBeNull();
      expect(parsePanelMessage({ type: 'renameSession', id, name: 'n' })).toBeNull();
    }
  });
});

describe('restoreSession', () => {
  it('accepts both targets', () => {
    for (const target of ['newWindow', 'currentWindow'] as const)
      expect(
        parsePanelMessage({ type: 'restoreSession', id: 's-1', target, windowId: 2, junk: 1 }),
      ).toEqual({ type: 'restoreSession', id: 's-1', target, windowId: 2 });
  });

  it('rejects other targets and bad window ids', () => {
    for (const target of ['', 'window', 'newwindow', 'all', null, undefined, 1])
      expect(
        parsePanelMessage({ type: 'restoreSession', id: 's-1', target, windowId: 2 }),
      ).toBeNull();
    for (const windowId of badIds)
      expect(
        parsePanelMessage({ type: 'restoreSession', id: 's-1', target: 'newWindow', windowId }),
      ).toBeNull();
  });
});
