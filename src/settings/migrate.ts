import { normalizeCombo } from '../lib/keymap';
import { normalizeHostPattern } from '../shared/host-pattern';
import { isRestorableUrl } from '../shared/sessions';
import {
  type Appearance,
  DEFAULT_SETTINGS,
  DISPLAY_MODES,
  type DisplaySettings,
  type Keymap,
  type LayoutSettings,
  LIMITS,
  MAX_BINDINGS,
  type Ordered,
  PANEL_IDS,
  SECTION_IDS,
  SETTINGS_VERSION,
  type SessionSettings,
  type Settings,
  SHORTCUT_ACTIONS,
  type SuspendSettings,
  SYNC_INTERVALS,
  type SyncSettings,
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
  // v2 → v3: new `suspend`, `sessions`, `shortcuts` and `tabs.allWindows`; default-filled.
  (s) => s,
  // v3 → v4: the panel always shows every window, so `tabs.allWindows` is gone.
  (s) => {
    if (!isObj(s.tabs)) return s;
    const { allWindows: _dropped, ...tabs } = s.tabs;
    return { ...s, tabs };
  },
  // v4 → v5: new `sync` group; default-filled.
  (s) => s,
  // v5 → v6: new `display` group (side panel or in-page popup); default-filled.
  (s) => s,
  // v6 → v7: opener-based child tabs, enabled by default.
  (s) => s,
  // v7 → v8: automatic sync interval, default-filled.
  (s) => s,
  // v8 → v9: optional new-tab URL; empty preserves the browser default.
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

/**
 * A stored keymap only overrides actions it mentions with a valid array, so a keymap
 * from an older build keeps the defaults for actions added later.
 */
function sanitizeKeymap(raw: unknown): Keymap {
  const src = isObj(raw) ? raw : {};
  const out = {} as Keymap;
  for (const action of SHORTCUT_ACTIONS) {
    const v = src[action];
    if (!Array.isArray(v)) {
      out[action] = [...DEFAULT_SETTINGS.shortcuts[action]];
      continue;
    }
    const combos: string[] = [];
    for (const c of v) {
      const n = typeof c === 'string' ? normalizeCombo(c) : null;
      if (n && !combos.includes(n) && combos.length < MAX_BINDINGS) combos.push(n);
    }
    out[action] = combos;
  }
  return out;
}

/** Empty uses the browser default; null means the supplied URL is invalid. */
export function normalizeNewTabUrl(value: string): string | null {
  const url = value.trim();
  if (!url) return '';
  if (url.length > 2048 || !isRestorableUrl(url)) return null;
  try {
    return new URL(url).href;
  } catch {
    return null;
  }
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
    newTabUrl: typeof t.newTabUrl === 'string' ? (normalizeNewTabUrl(t.newTabUrl) ?? '') : '',
    childTabs: bool(t.childTabs, d.tabs.childTabs),
    layout: oneOf(t.layout, ['single', 'double'] as const, d.tabs.layout),
    actions: oneOf(t.actions, ['hover', 'always'] as const, d.tabs.actions),
    showClose: bool(t.showClose, d.tabs.showClose),
    showMute: bool(t.showMute, d.tabs.showMute),
    showNewTabButton: bool(t.showNewTabButton, d.tabs.showNewTabButton),
    showCount: bool(t.showCount, d.tabs.showCount),
  };

  const su = isObj(raw.suspend) ? raw.suspend : {};
  const whitelist: string[] = [];
  for (const w of Array.isArray(su.whitelist) ? su.whitelist : []) {
    const n = typeof w === 'string' ? normalizeHostPattern(w) : null;
    if (n && !whitelist.includes(n) && whitelist.length < LIMITS.whitelist) whitelist.push(n);
  }
  const suspend: SuspendSettings = {
    auto: bool(su.auto, d.suspend.auto),
    minutes: clampInt(su.minutes, LIMITS.suspendMinutes, d.suspend.minutes),
    skipPinned: bool(su.skipPinned, d.suspend.skipPinned),
    skipAudible: bool(su.skipAudible, d.suspend.skipAudible),
    whitelist,
  };

  const se = isObj(raw.sessions) ? raw.sessions : {};
  const sessions: SessionSettings = {
    restoreDiscarded: bool(se.restoreDiscarded, d.sessions.restoreDiscarded),
  };

  const sy = isObj(raw.sync) ? raw.sync : {};
  const sync: SyncSettings = {
    workspaces: bool(sy.workspaces, d.sync.workspaces),
    sessions: bool(sy.sessions, d.sync.sessions),
    intervalMinutes: SYNC_INTERVALS.some((n) => n === sy.intervalMinutes)
      ? (sy.intervalMinutes as number)
      : d.sync.intervalMinutes,
  };

  const di = isObj(raw.display) ? raw.display : {};
  const display: DisplaySettings = {
    mode: oneOf(di.mode, DISPLAY_MODES, d.display.mode),
    openOnLaunch: typeof di.openOnLaunch === 'boolean' ? di.openOnLaunch : d.display.openOnLaunch,
  };

  const l = isObj(raw.layout) ? raw.layout : {};
  const layout: LayoutSettings = {
    panels: sanitizeOrder(l.panels, PANEL_IDS, UNHIDEABLE_PANELS),
    sections: sanitizeOrder(l.sections, SECTION_IDS, ['tabs']),
  };

  return {
    version: SETTINGS_VERSION,
    appearance,
    tabs,
    layout,
    suspend,
    sessions,
    sync,
    display,
    shortcuts: sanitizeKeymap(raw.shortcuts),
  };
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
