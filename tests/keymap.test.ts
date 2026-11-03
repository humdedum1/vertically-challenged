import { describe, expect, it } from 'vitest';
import {
  actionFor,
  chromeUse,
  comboFromEvent,
  findConflicts,
  formatCombo,
  type KeyLike,
  normalizeCombo,
} from '../src/lib/keymap';

const ev = (key: string, m: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...m,
});

describe('normalizeCombo', () => {
  it.each([
    ['ctrl+k', 'Ctrl+K'],
    ['Control+K', 'Ctrl+K'],
    ['cmd+k', 'Meta+K'],
    ['command+k', 'Meta+K'],
    ['win+k', 'Meta+K'],
    ['META+k', 'Meta+K'],
    ['option+k', 'Alt+K'],
    ['ALT+k', 'Alt+K'],
    ['  ctrl + shift + k ', 'Ctrl+Shift+K'],
    ['k', 'K'],
    ['1', '1'],
    ['/', '/'],
    ['?', '?'],
  ])('%j -> %j', (input, out) => {
    expect(normalizeCombo(input)).toBe(out);
  });

  it('uses a fixed modifier order regardless of input order', () => {
    expect(normalizeCombo('meta+shift+alt+ctrl+x')).toBe('Ctrl+Alt+Shift+Meta+X');
    expect(normalizeCombo('shift+ctrl+x')).toBe('Ctrl+Shift+X');
  });

  it('collapses repeated modifiers', () => {
    expect(normalizeCombo('ctrl+control+k')).toBe('Ctrl+K');
  });

  it.each([
    ['arrowup', 'ArrowUp'],
    ['ARROWDOWN', 'ArrowDown'],
    ['up', 'ArrowUp'],
    ['left', 'ArrowLeft'],
    ['right', 'ArrowRight'],
    ['esc', 'Escape'],
    ['escape', 'Escape'],
    ['space', 'Space'],
    ['spacebar', 'Space'],
    ['del', 'Delete'],
    ['delete', 'Delete'],
    ['enter', 'Enter'],
    ['f2', 'F2'],
    ['F12', 'F12'],
    ['contextmenu', 'ContextMenu'],
    ['pageup', 'PageUp'],
    ['alt+up', 'Alt+ArrowUp'],
    ['ctrl+space', 'Ctrl+Space'],
    ['shift+f10', 'Shift+F10'],
  ])('named key %j -> %j', (input, out) => {
    expect(normalizeCombo(input)).toBe(out);
  });

  it('accepts "+" as the key', () => {
    expect(normalizeCombo('+')).toBe('+');
    expect(normalizeCombo('Ctrl++')).toBe('Ctrl++');
    expect(normalizeCombo('ctrl+shift++')).toBe('Ctrl+Shift++');
  });

  it.each([
    '',
    '   ',
    ' ',
    'Ctrl+',
    '+K',
    'Ctrl++K',
    'Ctrl+Shift+',
    'a+b',
    'Ctrl+a+b',
    'Ctrl',
    'Ctrl+Shift',
    'Alt+Meta+Control',
    'Ctrl+Foo',
    'F13',
    'Hyper+K',
    'ab',
  ])('rejects %j', (input) => {
    expect(normalizeCombo(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 5, {}, ['a']]) expect(normalizeCombo(v as never)).toBeNull();
  });

  it('rejects text longer than 40 characters, accepts exactly 40', () => {
    const pad = (n: number) => `${' '.repeat(n)}Ctrl+K`;
    expect(pad(34)).toHaveLength(40);
    expect(normalizeCombo(pad(34))).toBe('Ctrl+K');
    expect(normalizeCombo(pad(35))).toBeNull();
  });

  it('is idempotent', () => {
    for (const c of ['ctrl+shift+k', 'esc', 'Ctrl++', 'alt+up', 'f5', '/']) {
      const n = normalizeCombo(c) as string;
      expect(normalizeCombo(n)).toBe(n);
    }
  });
});

describe('comboFromEvent', () => {
  it.each(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS'])(
    'bare %s -> null',
    (key) => {
      expect(comboFromEvent(ev(key))).toBeNull();
      expect(comboFromEvent(ev(key, { ctrlKey: true, shiftKey: true }))).toBeNull();
    },
  );

  it('plain keys', () => {
    expect(comboFromEvent(ev('k'))).toBe('K');
    expect(comboFromEvent(ev('/'))).toBe('/');
    expect(comboFromEvent(ev('Delete'))).toBe('Delete');
    expect(comboFromEvent(ev('F2'))).toBe('F2');
  });

  it('drops Shift for punctuation, keeps it for letters, digits and named keys', () => {
    expect(comboFromEvent(ev('?', { shiftKey: true }))).toBe('?');
    expect(comboFromEvent(ev('+', { shiftKey: true }))).toBe('+');
    expect(comboFromEvent(ev('K', { shiftKey: true }))).toBe('Shift+K');
    expect(comboFromEvent(ev('1', { shiftKey: true }))).toBe('Shift+1');
    expect(comboFromEvent(ev('F10', { shiftKey: true }))).toBe('Shift+F10');
    expect(comboFromEvent(ev('ArrowUp', { shiftKey: true }))).toBe('Shift+ArrowUp');
  });

  it('other modifiers are kept for punctuation', () => {
    expect(comboFromEvent(ev('+', { ctrlKey: true }))).toBe('Ctrl++');
    expect(comboFromEvent(ev('/', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+/');
  });

  it('Space key', () => {
    expect(comboFromEvent(ev(' '))).toBe('Space');
    expect(comboFromEvent(ev(' ', { ctrlKey: true }))).toBe('Ctrl+Space');
  });

  it('modifier order is Ctrl, Alt, Shift, Meta', () => {
    expect(
      comboFromEvent(ev('k', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true })),
    ).toBe('Ctrl+Alt+Shift+Meta+K');
    expect(comboFromEvent(ev('ArrowUp', { altKey: true }))).toBe('Alt+ArrowUp');
  });

  it('unrecognised keys -> null', () => {
    expect(comboFromEvent(ev('Unidentified'))).toBeNull();
    expect(comboFromEvent(ev('Dead'))).toBeNull();
    expect(comboFromEvent(ev('F20'))).toBeNull();
  });

  it('agrees with normalizeCombo on the same combo', () => {
    expect(comboFromEvent(ev('k', { ctrlKey: true, shiftKey: true }))).toBe(
      normalizeCombo('shift+ctrl+k'),
    );
    expect(comboFromEvent(ev('+', { ctrlKey: true }))).toBe(normalizeCombo('Ctrl++'));
  });
});

describe('actionFor', () => {
  const map = { find: ['/', 'Ctrl+F'], close: ['Delete'], none: [] as string[] };

  it('finds the bound action for any of its combos', () => {
    expect(actionFor(map, ev('/'))).toBe('find');
    expect(actionFor(map, ev('f', { ctrlKey: true }))).toBe('find');
    expect(actionFor(map, ev('Delete'))).toBe('close');
  });

  it('returns null for unbound keys and bare modifiers', () => {
    expect(actionFor(map, ev('x'))).toBeNull();
    expect(actionFor(map, ev('f'))).toBeNull();
    expect(actionFor(map, ev('Control', { ctrlKey: true }))).toBeNull();
  });

  it('returns the first action in key order when two share a combo', () => {
    expect(actionFor({ a: ['X'], b: ['X'] }, ev('x'))).toBe('a');
  });
});

describe('findConflicts', () => {
  it('reports only combos shared by two or more actions', () => {
    const c = findConflicts({ a: ['X', 'Y'], b: ['X'], c: ['Z'], d: ['Y', 'Q'], e: [] });
    expect([...c.keys()].sort()).toEqual(['X', 'Y']);
    expect(c.get('X')).toEqual(['a', 'b']);
    expect(c.get('Y')).toEqual(['a', 'd']);
  });

  it('is empty without conflicts', () => {
    expect(findConflicts({ a: ['X'], b: ['Y'], c: [] }).size).toBe(0);
    expect(findConflicts({}).size).toBe(0);
  });

  it('a combo listed twice on one action counts as shared by that action twice', () => {
    // Stored keymaps are deduped by migrateSettings; this documents the raw behaviour.
    expect(findConflicts({ a: ['X', 'X'] }).get('X')).toEqual(['a', 'a']);
  });
});

describe('formatCombo', () => {
  it.each([
    ['Ctrl+Shift+K', 'Ctrl + Shift + K'],
    ['Alt+ArrowUp', 'Alt + ↑'],
    ['ArrowDown', '↓'],
    ['ArrowLeft', '←'],
    ['ArrowRight', '→'],
    ['Ctrl++', 'Ctrl + +'],
    ['+', '+'],
    ['/', '/'],
    ['Ctrl+Space', 'Ctrl + Space'],
    ['Shift+F10', 'Shift + F10'],
  ])('%j -> %j', (input, out) => {
    expect(formatCombo(input)).toBe(out);
  });
});

describe('chromeUse', () => {
  it('names the Chrome shortcut a combo would shadow, on both platforms', () => {
    expect(chromeUse('Ctrl+K')).toBe('search the web');
    expect(chromeUse('Meta+W')).toBe('close tab');
    expect(chromeUse('Ctrl+Shift+T')).toBe('reopen closed tab');
    expect(chromeUse('F5')).toBe('reload');
    expect(chromeUse('Alt+ArrowLeft')).toBe('back');
  });

  it('leaves panel-only keys and the defaults alone', () => {
    for (const c of [
      '/',
      '>',
      'Delete',
      'F2',
      'Ctrl+F',
      'Ctrl+A',
      'Alt+ArrowUp',
      'Shift+F10',
      'Ctrl+Shift+K',
    ]) {
      expect(chromeUse(c)).toBeNull();
    }
  });
});
