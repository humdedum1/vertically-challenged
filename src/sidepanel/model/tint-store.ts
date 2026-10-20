/**
 * Pure persistence rules for the tint cache. Kept out of the reactive class so the expiry
 * and eviction decisions can be unit-tested.
 *
 * Entry values:
 * - `string`: a `#rrggbb` colour, kept until evicted.
 * - `number`: epoch ms of a load that succeeded but found no usable colour (grey or
 *   monochrome favicon). Kept for NO_COLOR_TTL_MS so it isn't re-extracted every launch,
 *   then reloaded in case the site changed its icon.
 * - `null`: in-memory only, for transient failures (image error, canvas unavailable).
 *   Never persisted, so the next panel session retries.
 */

export type TintEntry = string | number | null;
export type Tints = Record<string, TintEntry>;

export const MAX_TINT_ENTRIES = 500;
export const NO_COLOR_TTL_MS = 24 * 60 * 60 * 1000;

const HEX = /^#[0-9a-f]{6}$/;

/** Keeps the most recently inserted entries; object key order is insertion order. */
function newest(entries: [string, TintEntry][]): Tints {
  return Object.fromEntries(
    entries.length > MAX_TINT_ENTRIES ? entries.slice(-MAX_TINT_ENTRIES) : entries,
  );
}

/** Returns a new map with `origin` set to `value` (moved to the newest slot), capped. */
export function withEntry(tints: Tints, origin: string, value: TintEntry): Tints {
  const rest = Object.entries(tints).filter(([key]) => key !== origin);
  return newest([...rest, [origin, value]]);
}

/** Parses persisted tints, dropping malformed values and expired no-colour entries. */
export function parseStoredTints(raw: string | null, now: number): Tints {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const valid: [string, TintEntry][] = [];
  for (const [origin, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && HEX.test(value)) {
      valid.push([origin, value]);
    } else if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      if (now - value < NO_COLOR_TTL_MS) valid.push([origin, value]);
    }
  }
  return newest(valid);
}

/** Serialises for storage. In-memory-only nulls are omitted. */
export function serializeTints(tints: Tints): string {
  const persisted = Object.entries(tints).filter(
    (entry): entry is [string, string | number] => entry[1] !== null,
  );
  return JSON.stringify(Object.fromEntries(persisted));
}

/**
 * Whether the panel may write tints to localStorage. Without an `incognito` manifest key
 * the extension runs in spanning mode, so an incognito window's panel shares the normal
 * profile's on-disk storage; its origins stay in memory. `null` (window not known yet)
 * writes nothing either.
 */
export function tintsPersist(panelIncognito: boolean | null): boolean {
  return panelIncognito === false;
}
