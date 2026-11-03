import { expect, it, vi } from 'vitest';
import type { MenuItem } from '../src/sidepanel/components/menu-types';
import { matchCommands, menuCommands } from '../src/sidepanel/model/commands';

const run = vi.fn();
const menu: MenuItem[] = [
  { type: 'item', label: 'Close duplicate tabs', onselect: run },
  { type: 'item', label: 'Switch to window', disabled: true, onselect: run },
  { type: 'separator' },
  { type: 'submenu', label: 'Theme', items: [{ type: 'item', label: 'Abyss', onselect: run }] },
  {
    type: 'submenu',
    label: 'Close window…',
    items: [{ type: 'item', label: 'Confirm: close 3 tabs', danger: true, onselect: run }],
  },
  { type: 'colors', label: 'Colour', value: 'blue', onpick: run },
];

it('flattens menus into commands, skipping disabled items and pickers', () => {
  expect(menuCommands(menu).map((c) => [c.label, c.danger])).toEqual([
    ['Close duplicate tabs', false],
    ['Theme: Abyss', false],
    ['Close window', true],
  ]);
});

it('matches every word in any order', () => {
  const cmds = menuCommands(menu);
  expect(matchCommands(cmds, 'abyss THEME').map((c) => c.label)).toEqual(['Theme: Abyss']);
  expect(matchCommands(cmds, 'close').length).toBe(2);
  expect(matchCommands(cmds, '').length).toBe(3);
  expect(matchCommands(cmds, 'nothing')).toEqual([]);
});
