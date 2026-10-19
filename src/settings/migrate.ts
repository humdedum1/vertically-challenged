import {
  type Appearance,
  DEFAULT_SETTINGS,
  type LayoutSettings,
  LIMITS,
  type Ordered,
  PANEL_IDS,
  SECTION_IDS,
  SETTINGS_VERSION,
  type Settings,
  type TabRowSettings,
  UNHIDEABLE_PANELS,
} from './schema';

type Raw = Record<string, unknown>;

/**
 * MIGRATIONS[n] upgrades a stored object from version n to n+1. Steps only reshape data;
 * `sanitize` then validates every field and fills defaults, so a step never needs to be
 * defensive. Version 0 is "no version field" (nothing shipped before v1).
 */
const MIGRATIONS: readonly ((s: Raw) => Raw)[] = [
  (s) => s,
  // v1 → v2: new `tabs` and `layout` groups and `appearance.accent`; all default-filled.
  (s) => s,
];

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const clampInt = (v: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;

// Font family ends up in a CSS custom property; refuse anything that could close the
// declaration or pull in a URL. Literal space only: \s would admit newlines.
const SAFE_FONT = /^[\w ,"'-]{1,200}$/;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Validates an ordered list against a fixed id set: keeps the stored order for known ids,
 * drops unknown and duplicate ones, and appends missing ids (visible) at the end so panels
 * added by a later version show up.
 */
export function sanitizeOrder<T extends string>(
  raw: unknown,
  ids: readonly T[],
  alwaysVisible: readonly T[] = [],
): Ordered<T>[] {
  const out: Ordered<T>[] = [];
  const seen = new Set<T>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!isObj(item) || !ids.includes(item.id as T) || seen.has(item.id as T)) continue;
      const id = item.id as T;
      seen.add(id);
      out.push({ id, visible: alwaysVisible.includes(id) || bool(item.visible, true) });
    }
  }
  for (const id of ids) if (!seen.has(id)) out.push({ id, visible: true });
  return out;
}

function sanitize(raw: Raw): Settings {
  const d = DEFAULT_SETTINGS;
  const a = isObj(raw.appearance) ? raw.appearance : {};
  const appearance: Appearance = {
    themeId:
      typeof a.themeId === 'string' && a.themeId.length > 0 && a.themeId.length <= 64
        ? a.themeId
        : d.appearance.themeId,
    mode: oneOf(a.mode, ['system', 'light', 'dark'] as const, d.appearance.mode),
    density: oneOf(a.density, ['compact', 'comfortable'] as const, d.appearance.density),
    radius: clampInt(a.radius, LIMITS.radius, d.appearance.radius),
    fontFamily:
      typeof a.fontFamily === 'string' && SAFE_FONT.test(a.fontFamily)
        ? a.fontFamily
        : d.appearance.fontFamily,
    fontSize: clampInt(a.fontSize, LIMITS.fontSize, d.appearance.fontSize),
    accent: typeof a.accent === 'string' && HEX.test(a.accent) ? a.accent.toLowerCase() : null,
  };

  const t = isObj(raw.tabs) ? raw.tabs : {};
  const tabs: TabRowSettings = {
    layout: oneOf(t.layout, ['single', 'double'] as const, d.tabs.layout),
    actions: oneOf(t.actions, ['hover', 'always'] as const, d.tabs.actions),
    showClose: bool(t.showClose, d.tabs.showClose),
    showMute: bool(t.showMute, d.tabs.showMute),
    showNewTabButton: bool(t.showNewTabButton, d.tabs.showNewTabButton),
    showCount: bool(t.showCount, d.tabs.showCount),
  };

  const l = isObj(raw.layout) ? raw.layout : {};
  const layout: LayoutSettings = {
    panels: sanitizeOrder(l.panels, PANEL_IDS, UNHIDEABLE_PANELS),
    sections: sanitizeOrder(l.sections, SECTION_IDS, ['tabs']),
  };

  return { version: SETTINGS_VERSION, appearance, tabs, layout };
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
