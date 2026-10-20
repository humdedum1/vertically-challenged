import { describe, expect, it } from 'vitest';
import {
  MAX_TINT_ENTRIES,
  NO_COLOR_TTL_MS,
  parseStoredTints,
  serializeTints,
  type Tints,
  tintsPersist,
  withEntry,
} from '../src/sidepanel/model/tint-store';

const NOW = 1_800_000_000_000;

describe('parseStoredTints', () => {
  it('returns an empty map for missing, junk, or non-object storage', () => {
    expect(parseStoredTints(null, NOW)).toEqual({});
    expect(parseStoredTints('{not json', NOW)).toEqual({});
    expect(parseStoredTints('[1,2]', NOW)).toEqual({});
    expect(parseStoredTints('"text"', NOW)).toEqual({});
    expect(parseStoredTints('null', NOW)).toEqual({});
  });

  it('keeps valid hex colours', () => {
    const raw = JSON.stringify({ 'https://a.test': '#ff0000' });
    expect(parseStoredTints(raw, NOW)).toEqual({ 'https://a.test': '#ff0000' });
  });

  it('keeps no-colour timestamps younger than the TTL', () => {
    const at = NOW - NO_COLOR_TTL_MS + 1000;
    const raw = JSON.stringify({ 'https://grey.test': at });
    expect(parseStoredTints(raw, NOW)).toEqual({ 'https://grey.test': at });
  });

  it('drops no-colour timestamps at or past the TTL so they reload', () => {
    const raw = JSON.stringify({
      'https://old.test': NOW - NO_COLOR_TTL_MS,
      'https://older.test': NOW - NO_COLOR_TTL_MS * 3,
    });
    expect(parseStoredTints(raw, NOW)).toEqual({});
  });

  it('drops malformed values rather than trusting them', () => {
    const raw = JSON.stringify({
      'https://bad-hex.test': '#GGGGGG',
      'https://short.test': '#fff',
      'https://null.test': null,
      'https://neg.test': -5,
      'https://nan.test': 'NaN',
      'https://ok.test': '#00ff00',
    });
    expect(parseStoredTints(raw, NOW)).toEqual({ 'https://ok.test': '#00ff00' });
  });

  it('keeps only the newest MAX_TINT_ENTRIES', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < MAX_TINT_ENTRIES + 5; i++) obj[`https://s${i}.test`] = '#101010';
    const out = parseStoredTints(JSON.stringify(obj), NOW);
    const keys = Object.keys(out);
    expect(keys).toHaveLength(MAX_TINT_ENTRIES);
    expect(keys[0]).toBe('https://s5.test');
    expect(keys.at(-1)).toBe(`https://s${MAX_TINT_ENTRIES + 4}.test`);
  });
});

describe('serializeTints', () => {
  it('drops in-memory-only null entries (transient failures are never persisted)', () => {
    const tints = { 'https://a.test': '#ff0000', 'https://b.test': null, 'https://c.test': NOW };
    expect(JSON.parse(serializeTints(tints))).toEqual({
      'https://a.test': '#ff0000',
      'https://c.test': NOW,
    });
  });

  it('round-trips through parseStoredTints', () => {
    const tints = { 'https://a.test': '#ff0000', 'https://c.test': NOW };
    expect(parseStoredTints(serializeTints(tints), NOW)).toEqual(tints);
  });
});

describe('withEntry', () => {
  it('appends a new origin and does not mutate the input', () => {
    const before = { 'https://a.test': '#ff0000' };
    const after = withEntry(before, 'https://b.test', '#00ff00');
    expect(after).toEqual({ 'https://a.test': '#ff0000', 'https://b.test': '#00ff00' });
    expect(before).toEqual({ 'https://a.test': '#ff0000' });
  });

  it('evicts the oldest inserted entry once the cap is reached', () => {
    let tints: Tints = {};
    for (let i = 0; i < MAX_TINT_ENTRIES; i++) tints = withEntry(tints, `https://s${i}.test`, null);
    tints = withEntry(tints, 'https://new.test', '#123456');
    const keys = Object.keys(tints);
    expect(keys).toHaveLength(MAX_TINT_ENTRIES);
    expect(keys).not.toContain('https://s0.test');
    expect(tints['https://new.test']).toBe('#123456');
  });
});

describe('tintsPersist', () => {
  it('writes to disk only from a panel known to be in a normal window', () => {
    expect(tintsPersist(false)).toBe(true);
    // Incognito origins must never reach localStorage, which spanning mode shares with
    // the normal profile; until the window is known, nothing is written either.
    expect(tintsPersist(true)).toBe(false);
    expect(tintsPersist(null)).toBe(false);
  });
});
