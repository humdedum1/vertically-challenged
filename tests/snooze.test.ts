import { describe, expect, it } from 'vitest';
import { parsePanelMessage } from '../src/shared/protocol';
import { dueSnoozed, isWakeTime, parseSnoozed, snoozePresets } from '../src/shared/snooze';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'abc123',
  url: 'https://example.com/a',
  title: 'A',
  wakeAt: 1000,
  snoozedAt: 1,
  ...over,
});

describe('snooze storage', () => {
  it('keeps valid entries and drops unsafe or malformed ones', () => {
    const out = parseSnoozed([
      entry(),
      entry({ id: 'bad id!' }),
      entry({ url: 'javascript:alert(1)' }),
      entry({ wakeAt: 'soon' }),
      null,
    ]);
    expect(out.map((s) => s.id)).toEqual(['abc123']);
    expect(parseSnoozed('nope')).toEqual([]);
  });

  it('finds the entries that are due', () => {
    const list = parseSnoozed([entry({ id: 'a', wakeAt: 5 }), entry({ id: 'b', wakeAt: 50 })]);
    expect(dueSnoozed(list, 10).map((s) => s.id)).toEqual(['a']);
  });
});

describe('snooze presets', () => {
  it('offers only future times, in order, at 9:00 for the dated ones', () => {
    const now = new Date(2026, 10, 3, 14, 30); // Tuesday
    const p = snoozePresets(now);
    expect(p.map((x) => x.at)).toEqual([...p.map((x) => x.at)].sort((a, b) => a - b));
    for (const x of p) expect(x.at).toBeGreaterThan(now.getTime());
    expect(new Date(p[1]?.at ?? 0).getHours()).toBe(9);
    expect(new Date(p[2]?.at ?? 0).getDay()).toBe(1); // Monday
    expect(new Date(p[2]?.at ?? 0).getDate()).toBe(9);
  });

  it('picks the following Monday when today is Monday', () => {
    const p = snoozePresets(new Date(2026, 10, 2, 8, 0)); // Monday
    expect(new Date(p[2]?.at ?? 0).getDate()).toBe(9);
  });
});

describe('snooze messages', () => {
  const now = Date.now();
  it('accepts a future wake time and rejects past, huge or fractional-id input', () => {
    expect(
      parsePanelMessage({ type: 'snooze', tabIds: [1, 2], wakeAt: now + 60_000 }),
    ).toMatchObject({ type: 'snooze' });
    expect(parsePanelMessage({ type: 'snooze', tabIds: [1], wakeAt: now - 1 })).toBeNull();
    expect(parsePanelMessage({ type: 'snooze', tabIds: [1], wakeAt: now + 1e13 })).toBeNull();
    expect(parsePanelMessage({ type: 'snooze', tabIds: [], wakeAt: now + 60_000 })).toBeNull();
    expect(isWakeTime(Number.NaN, now)).toBe(false);
  });
  it('validates snoozed ids', () => {
    expect(parsePanelMessage({ type: 'wakeSnoozed', id: 'abc-1' })).toEqual({
      type: 'wakeSnoozed',
      id: 'abc-1',
    });
    expect(parsePanelMessage({ type: 'deleteSnoozed', id: '../x' })).toBeNull();
  });
});
