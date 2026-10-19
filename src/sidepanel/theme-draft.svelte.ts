import type { Theme } from '../themes/palette';

/**
 * The custom theme currently open in the editor. App applies it instead of the saved
 * theme, so the whole panel previews edits live; null when nothing is being edited.
 */
export class ThemeDraft {
  theme = $state.raw<Theme | null>(null);
  /** Palette being edited; the panel previews in this mode so edits are always visible. */
  mode = $state<'dark' | 'light'>('dark');
}
