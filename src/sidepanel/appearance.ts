import { rowHeight, type Settings } from '../settings/schema';
import { withAccent } from '../themes/accent';
import { legibleTheme } from '../themes/contrast';
import { isCustomId } from '../themes/custom-themes';
import type { Theme } from '../themes/palette';
import { themeToCss } from '../themes/token-mapper';

const CACHE_KEY = 'vc:appearance:v2';
let appliedCss: string | null = null;

function setThemeCss(css: string): void {
  if (css === appliedCss) return;
  let el = document.getElementById('vc-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'vc-theme';
    document.head.append(el);
  }
  el.textContent = css;
  appliedCss = css;
}

/**
 * Applies settings to the document. A null theme (custom theme not loaded yet) keeps the
 * current colours. Colours go into one generated <style>; non-colour
 * tokens are inline custom properties on <html> so they override base.css defaults;
 * behaviour switches (hover vs always-visible actions, row layout) are data attributes.
 */
export function applyAppearance(
  settings: Settings,
  theme: Theme | null,
  { persist = true, accent }: { persist?: boolean; accent?: { light: string; dark: string } } = {},
): void {
  const a = settings.appearance;
  if (theme) {
    const t = withAccent(theme, accent ?? a.accent);
    // Built-in palettes get readable text; user themes are shown exactly as made.
    setThemeCss(themeToCss(isCustomId(theme.id) ? t : legibleTheme(t)));
  }

  const root = document.documentElement;
  if (a.mode === 'system') delete root.dataset.mode;
  else root.dataset.mode = a.mode;
  root.dataset.density = a.density;
  root.dataset.motion = a.motion;
  root.dataset.rowLayout = settings.tabs.layout;
  root.dataset.actions = settings.tabs.actions;

  const s = root.style;
  s.setProperty('--radius-card', `${a.radius}px`);
  s.setProperty('--radius-row', `${Math.max(0, a.radius - 4)}px`);
  s.setProperty('--radius-control', `${Math.max(0, a.radius - 6)}px`);
  s.setProperty('--font', a.fontFamily);
  s.setProperty('--font-size', `${a.fontSize}px`);
  s.setProperty('--row-height', `${rowHeight(settings)}px`);

  // Unsaved editor drafts are previewed but never become the next first paint.
  if (!persist) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ settings, css: appliedCss }));
  } catch {
    // Storage blocked; first paint just falls back to defaults.
  }
}

/**
 * chrome.storage is async (and custom themes need a second read), so the first frame would
 * otherwise paint defaults and then flip. The last applied settings and the generated
 * theme CSS are mirrored in localStorage for a synchronous read. Settings are re-validated
 * by the caller; the CSS is only ever written by applyAppearance above.
 */
export function applyCachedAppearance(): unknown {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { settings?: unknown; css?: unknown };
    if (typeof cached.css === 'string') setThemeCss(cached.css);
    return cached.settings ?? null;
  } catch {
    return null;
  }
}
