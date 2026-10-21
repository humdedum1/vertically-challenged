import { describe, expect, it } from 'vitest';
import { parsePanelMessage } from '../src/shared/protocol';

describe('parsePanelMessage', () => {
  it('parses valid messages', () => {
    expect(parsePanelMessage({ type: 'subscribe', windowId: 3 })).toEqual({
      type: 'subscribe',
      windowId: 3,
    });
    expect(parsePanelMessage({ type: 'activate', tabId: 7 })).toEqual({
      type: 'activate',
      tabId: 7,
    });
    expect(parsePanelMessage({ type: 'close', tabIds: [1, 2, 3] })).toEqual({
      type: 'close',
      tabIds: [1, 2, 3],
    });
  });

  it('strips unknown extra properties', () => {
    expect(parsePanelMessage({ type: 'activate', tabId: 1, evil: true })).toEqual({
      type: 'activate',
      tabId: 1,
    });
  });

  it('rejects non-objects', () => {
    for (const v of [null, undefined, 5, 'subscribe', true]) {
      expect(parsePanelMessage(v)).toBeNull();
    }
  });

  it('rejects unknown or missing type', () => {
    expect(parsePanelMessage({ type: 'nope' })).toBeNull();
    expect(parsePanelMessage({})).toBeNull();
    expect(parsePanelMessage({ type: 5 })).toBeNull();
  });

  it('rejects negative, float, string, NaN and missing ids', () => {
    for (const bad of [-1, 1.5, '1', Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(parsePanelMessage({ type: 'subscribe', windowId: bad })).toBeNull();
      expect(parsePanelMessage({ type: 'activate', tabId: bad })).toBeNull();
      expect(parsePanelMessage({ type: 'close', tabIds: [bad] })).toBeNull();
    }
  });

  it('rejects empty, non-array and mixed tabIds', () => {
    expect(parsePanelMessage({ type: 'close', tabIds: [] })).toBeNull();
    expect(parsePanelMessage({ type: 'close', tabIds: 5 })).toBeNull();
    expect(parsePanelMessage({ type: 'close' })).toBeNull();
    expect(parsePanelMessage({ type: 'close', tabIds: [1, '2', 3] })).toBeNull();
    expect(parsePanelMessage({ type: 'close', tabIds: [1, -2] })).toBeNull();
    expect(parsePanelMessage({ type: 'close', tabIds: [1, 2.5] })).toBeNull();
  });
});

describe('subscribe surface', () => {
  it('keeps popup and window surfaces and drops the default or unknown ones', () => {
    expect(parsePanelMessage({ type: 'subscribe', windowId: 3, surface: 'popup' })).toEqual({
      type: 'subscribe',
      windowId: 3,
      surface: 'popup',
    });
    expect(parsePanelMessage({ type: 'subscribe', windowId: 3, surface: 'window' })).toEqual({
      type: 'subscribe',
      windowId: 3,
      surface: 'window',
    });
    for (const surface of ['sidebar', 'frame', 1, null])
      expect(parsePanelMessage({ type: 'subscribe', windowId: 3, surface })).toEqual({
        type: 'subscribe',
        windowId: 3,
      });
  });
});
