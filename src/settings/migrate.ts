import {
  type Appearance,
  type ColorMode,
  DEFAULT_SETTINGS,
  type Density,
  LIMITS,
  SETTINGS_VERSION,
  type Settings,
} from './schema';

type Raw = Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a stored object from version n to n+1. Steps only reshape data;
 * `sanitize` then validates every field, so a step never needs to be defensive.
 * Version 0 is "no version field" (nothing shipped before v1, so it's identity).
 */
const MIGRATIONS: readonly ((s: Raw) => Raw)[] = [(s) => s];

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const clampInt = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;

// Font family ends up in a CSS custom property; refuse anything that could close the
// declaration or pull in a URL.
const SAFE_FONT = /^[\w ,"'-]{1,200}$/;

function sanitize(raw: Raw): Settings {
  const d = DEFAULT_SETTINGS.appearance;
  const a = isObj(raw.appearance) ? raw.appearance : {};
  const appearance: Appearance = {
    themeId: typeof a.themeId === 'string' && a.themeId.length <= 64 ? a.themeId : d.themeId,
    mode: oneOf<ColorMode>(a.mode, ['system', 'light', 'dark'], d.mode),
    density: oneOf<Density>(a.density, ['compact', 'comfortable'], d.density),
    radius: clampInt(a.radius, LIMITS.radius, d.radius),
    fontFamily:
      typeof a.fontFamily === 'string' && SAFE_FONT.test(a.fontFamily)
        ? a.fontFamily
        : d.fontFamily,
    fontSize: clampInt(a.fontSize, LIMITS.fontSize, d.fontSize),
  };
  return { version: SETTINGS_VERSION, appearance };
}

/**
 * Turns whatever is in storage (nothing, garbage, an old version, or a newer version
 * written by a later build on another synced machine) into valid current settings.
 * Newer versions are read best-effort rather than reset, so a downgrade keeps what it can.
 */
export function migrateSettings(stored: unknown): Settings {
  if (!isObj(stored)) return structuredClone(DEFAULT_SETTINGS);
  let s: Raw = stored;
  let v = typeof s.version === 'number' && Number.isInteger(s.version) ? s.version : 0;
  while (v < SETTINGS_VERSION && v >= 0) {
    const step = MIGRATIONS[v];
    if (!step) break;
    s = step(s);
    v++;
  }
  return sanitize(s);
}
