import { faviconUrl } from '../shared/favicon';
import { api } from './api';
import { dominantColor } from './model/tint';
import {
  parseStoredTints,
  serializeTints,
  type Tints,
  tintsPersist,
  withEntry,
} from './model/tint-store';

const KEY = 'vc:tints:v1';

/**
 * Keyed by origin: every page on a site shares one favicon, and the origin is what the
 * favicon endpoint resolves. Returns null for URLs that can't have a favicon, which are
 * never cached.
 */
function originOf(url: string): string | null {
  try {
    const origin = new URL(url).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function readStored(): Tints {
  try {
    return parseStoredTints(localStorage.getItem(KEY), Date.now());
  } catch {
    // Storage can be blocked; tints are a cache, so start empty.
    return {};
  }
}

function writeStored(tints: Tints): void {
  try {
    localStorage.setItem(KEY, serializeTints(tints));
  } catch {
    // Quota or blocked storage: the in-memory map still works for this session.
  }
}

type Extracted = { ok: true; hex: string | null } | { ok: false };

/**
 * Draws the favicon into 16×16 and reads its pixels. Same-origin, so the canvas isn't
 * tainted. `ok: false` means the attempt itself failed and shouldn't be remembered.
 */
function extract(img: HTMLImageElement): Extracted {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false };
    ctx.drawImage(img, 0, 0, 16, 16);
    return { ok: true, hex: dominantColor(ctx.getImageData(0, 0, 16, 16).data) };
  } catch {
    return { ok: false };
  }
}

/**
 * Reactive origin → tint map. `get` is safe to call from templates: it reads a `$state.raw`
 * field, so readers re-render when a lazy load lands.
 *
 * Persistence follows the outcome: a colour is kept; a successful load with no usable
 * colour is kept for 24 h (see tint-store); a failed load is remembered in memory only, so
 * the next panel session retries it. Only a panel in a normal window writes (see
 * tintsPersist); an incognito one reads the stored tints but keeps its own in memory.
 */
export class TintCache {
  private tints = $state.raw<Tints>({});
  private loading = new Set<string>();
  /** The panel window's incognito state, once known. */
  private incognito: boolean | null = null;
  /** Lookups settled before the window was known; written once it turns out normal. */
  private unsaved = false;

  constructor() {
    this.tints = readStored();
    api.windows
      .getCurrent()
      .then((w) => this.setIncognito(w.incognito))
      // Unknown stays memory-only: failing closed only costs a re-extraction next time.
      .catch(() => {});
  }

  private setIncognito(incognito: boolean): void {
    this.incognito = incognito;
    if (this.unsaved && tintsPersist(incognito)) writeStored(this.tints);
    this.unsaved = false;
  }

  get(url: string): string | null {
    const origin = originOf(url);
    if (origin === null) return null;
    if (Object.hasOwn(this.tints, origin)) {
      const entry = this.tints[origin];
      return typeof entry === 'string' ? entry : null;
    }

    const src = faviconUrl(url, 16);
    if (src === null) return null;
    if (!this.loading.has(origin)) {
      this.loading.add(origin);
      this.load(origin, src);
    }
    return null;
  }

  private load(origin: string, src: string): void {
    const img = new Image();
    img.onload = () => {
      const result = extract(img);
      if (!result.ok) return this.settle(origin, null);
      // A successful load with no saturated pixels (grey or monochrome icon) is a result
      // worth keeping, stamped so it expires and is re-checked later.
      this.settle(origin, result.hex ?? Date.now());
    };
    // Network or decode failure: memo for this session only.
    img.onerror = () => this.settle(origin, null);
    img.src = src;
  }

  private settle(origin: string, entry: string | number | null): void {
    this.loading.delete(origin);
    const next = withEntry(this.tints, origin, entry);
    this.tints = next;
    if (tintsPersist(this.incognito)) writeStored(next);
    else if (this.incognito === null) this.unsaved = true;
  }
}

export const tintCache = new TintCache();
