import { browser } from 'wxt/browser';

const KEY = 'customCss';
const CACHE_KEY = 'vc:custom-css';

export { MAX_CUSTOM_CSS } from '../backup/snapshot';

import { MAX_CUSTOM_CSS } from '../backup/snapshot';

const WRITE_DELAY_MS = 400;

function apply(css: string): void {
  let el = document.getElementById('vc-custom-css');
  if (!el) {
    el = document.createElement('style');
    el.id = 'vc-custom-css';
  }
  // Last in <head>, after the theme, so user rules win at equal specificity.
  document.head.append(el);
  el.textContent = css;
  try {
    localStorage.setItem(CACHE_KEY, css);
  } catch {}
}

/**
 * The user's own stylesheet for the panel (Sidebery-style). Kept in storage.local, not with
 * the synced settings: storage.sync caps an item at 8 KB. Cached in localStorage so the
 * first frame already has it; CSS can't run script, so it needs no sanitizing beyond length.
 */
export class CustomCss {
  value = $state('');
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        this.value = cached;
        apply(cached);
      }
    } catch {}
    browser.storage.onChanged.addListener((changes, area) => {
      const c = changes[KEY];
      if (area !== 'local' || !c || this.timer !== null) return;
      this.value = typeof c.newValue === 'string' ? c.newValue : '';
      apply(this.value);
    });
    void browser.storage.local.get(KEY).then((s) => {
      if (this.timer !== null) return;
      this.value = typeof s[KEY] === 'string' ? s[KEY] : '';
      apply(this.value);
    });
  }

  set(css: string): void {
    this.value = css.slice(0, MAX_CUSTOM_CSS);
    apply(this.value);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void browser.storage.local
        .set({ [KEY]: this.value })
        .catch((err: unknown) => console.warn('[vc] custom CSS save failed', err))
        .finally(() => {
          this.timer = null;
        });
    }, WRITE_DELAY_MS);
  }
}

export const customCss = new CustomCss();
