import { type Palette, ROLES, type Theme } from './palette';

const declarations = (p: Palette): string => ROLES.map((r) => `--${r}:${p[r]};`).join('');

/**
 * Builds one stylesheet that serves all three modes, so switching mode is a single
 * attribute flip with no recomputation:
 *   no data-mode  → follows prefers-color-scheme
 *   data-mode=dark|light → forced
 * Derived tokens (state layers, elevations) live in base.css and are computed from
 * these with color-mix(), so a theme only ever carries the 16 roles.
 */
export function themeToCss(theme: Theme): string {
  const dark = `color-scheme:dark;${declarations(theme.dark)}`;
  const light = `color-scheme:light;${declarations(theme.light)}`;
  return [
    `:root{${dark}}`,
    `@media (prefers-color-scheme: light){:root:not([data-mode="dark"]){${light}}}`,
    `:root[data-mode="light"]{${light}}`,
  ].join('\n');
}
