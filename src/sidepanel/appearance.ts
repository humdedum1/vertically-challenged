import { type Appearance, DEFAULT_SETTINGS, ROW_HEIGHT } from '../settings/schema';
import { findTheme } from '../themes/builtin';
import { themeToCss } from '../themes/token-mapper';

const CACHE_KEY = 'vc:appearance';
let appliedThemeId: string | null = null;

/**
 * Applies settings to the document. Colours go into one generated <style>; non-colour
 * tokens are inline custom properties on <html> so they override base.css defaults.
 */
export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  if (a.themeId !== appliedThemeId) {
    let el = document.getElementById('vc-theme');
    if (!el) {
      el = document.createElement('style');
      el.id = 'vc-theme';
      document.head.append(el);
    }
    el.textContent = themeToCss(findTheme(a.themeId));
    appliedThemeId = a.themeId;
  }
  if (a.mode === 'system') delete root.dataset.mode;
  else root.dataset.mode = a.mode;
  root.dataset.density = a.density;

  const s = root.style;
  s.setProperty('--radius-card', `${a.radius}px`);
  s.setProperty('--radius-row', `${Math.max(0, a.radius - 4)}px`);
  s.setProperty('--radius-control', `${Math.max(0, a.radius - 6)}px`);
  s.setProperty('--font', a.fontFamily);
  s.setProperty('--font-size', `${a.fontSize}px`);
  s.setProperty('--row-height', `${ROW_HEIGHT[a.density]}px`);

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(a));
  } catch {
    // Storage blocked; first paint just falls back to defaults.
  }
}

/**
 * chrome.storage is async, so the first frame would otherwise paint default colours and
 * then flip. The last applied appearance is mirrored in localStorage for a sync read.
 * Its contents are re-validated by the caller via migrateSettings.
 */
export function readCachedAppearance(): unknown {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { version: DEFAULT_SETTINGS.version, appearance: JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}
