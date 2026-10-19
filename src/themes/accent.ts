import { contrastRatio } from './contrast';
import type { Palette, Theme } from './palette';

const onColor = (bg: string): string =>
  contrastRatio(bg, '#000000') >= contrastRatio(bg, '#ffffff') ? '#000000' : '#ffffff';

const tint = (p: Palette, accent: string): Palette => ({
  ...p,
  mPrimary: accent,
  mOnPrimary: onColor(accent),
});

/**
 * Applies a user accent over a theme's primary in both modes. mOnPrimary is recomputed
 * (black or white, whichever contrasts more) so text on accent fills stays readable.
 */
export function withAccent(theme: Theme, accent: string | null): Theme {
  if (!accent) return theme;
  return { ...theme, dark: tint(theme.dark, accent), light: tint(theme.light, accent) };
}
