import type { MenuItem } from '../components/menu-types';

/** One runnable entry in the command palette (search text starting with ">"). */
export interface Command {
  label: string;
  run: () => void;
  danger: boolean;
}

/**
 * Turns a context menu into palette commands, so the palette and the menus can't drift
 * apart. Submenu entries are prefixed with their parent ("Theme: Abyss"); separators,
 * disabled items and colour pickers (which need the swatch UI) are left out.
 */
export function menuCommands(items: readonly MenuItem[], prefix = ''): Command[] {
  const out: Command[] = [];
  for (const item of items) {
    if (item.type === 'submenu') {
      // A one-item "Close window…" submenu is a confirm step; typing the command and
      // pressing Enter already confirms, so it becomes plain "Close window".
      const only = item.label.endsWith('…') && item.items.length === 1 ? item.items[0] : undefined;
      if (only?.type === 'item') {
        out.push({
          label: prefix + item.label.slice(0, -1),
          run: only.onselect,
          danger: only.danger === true,
        });
      } else out.push(...menuCommands(item.items, `${prefix}${item.label}: `));
    } else if (item.type === 'item' && !item.disabled) {
      out.push({ label: prefix + item.label, run: item.onselect, danger: item.danger === true });
    }
  }
  return out;
}

/** Commands whose label holds every word of `text`, in any order, ignoring case. */
export function matchCommands(commands: readonly Command[], text: string): Command[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) => {
    const l = c.label.toLowerCase();
    return words.every((w) => l.includes(w));
  });
}
