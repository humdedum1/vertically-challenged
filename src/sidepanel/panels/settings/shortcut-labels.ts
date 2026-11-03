import type { ShortcutAction } from '../../../settings/schema';

/** What each bindable action is called, in Settings and in the shortcut help. */
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  focusSearch: 'Focus search',
  commandPalette: 'Command palette',
  closeTab: 'Close tab or group',
  renameGroup: 'Rename group',
  moveUp: 'Move up',
  moveDown: 'Move down',
  openMenu: 'Open context menu',
  selectAll: 'Select all tabs',
  newTab: 'New tab below',
  duplicateTab: 'Duplicate tab',
  togglePin: 'Pin or unpin tab',
  toggleMute: 'Mute or unmute tab',
  suspendTab: 'Suspend tab',
};
