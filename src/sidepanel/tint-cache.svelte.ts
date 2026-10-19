import { faviconUrl } from '../shared/favicon';
import { dominantColor } from './model/tint';

const KEY = 'vc:tints:v1';
const MAX_ENTRIES = 500;
const HEX = /^#[0-9a-f]{6}$/;

type Tints = Record<string, string | null>;

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

/** Keeps the most recently inserted entries; object key order is insertion order. */
function trim(entries: [string, string | null][]): Tints {
  return Object.fromEntries(entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries);
}

function readStored(): Tints {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const valid = Object.entries(parsed).filter(
      (entry): entry is [string, string | null] =>
        entry[1] === null || (typeof entry[1] === 'string' && HEX.test(entry[1])),
    );
    return trim(valid);
  } catch {
    // Storage can be blocked or hold junk; tints are a cache, so start empty.
    return {};
  }
}

function writeStored(tints: Tints): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tints));
  } catch {
    // Quota or blocked storage: the in-memory map still works for this session.
  }
}

/** Draws the favicon into 16×16 and reads its pixels. Same-origin, so the canvas isn't tainted. */
function extract(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    return dominantColor(ctx.getImageData(0, 0, 16, 16).data);
  } catch {
    return null;
  }
}

/**
 * Reactive origin → tint map. `get` is safe to call from templates: it reads a `$state.raw`
 * field, so readers re-render when a lazy load lands. Failed and colourless favicons are
 * cached as null so they aren't retried.
 */
export class TintCache {
  private tints = $state.raw<Tints>({});
  private loading = new Set<string>();

  constructor() {
    this.tints = readStored();
  }

  get(url: string): string | null {
    const origin = originOf(url);
    if (origin === null) return null;
    if (Object.hasOwn(this.tints, origin)) return this.tints[origin] ?? null;

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
    const settle = (hex: string | null) => {
      this.loading.delete(origin);
      this.store(origin, hex);
    };
    img.onload = () => settle(extract(img));
    img.onerror = () => settle(null);
    img.src = src;
  }

  private store(origin: string, hex: string | null): void {
    const next = trim([...Object.entries(this.tints), [origin, hex]]);
    this.tints = next;
    writeStored(next);
  }
}

export const tintCache = new TintCache();
