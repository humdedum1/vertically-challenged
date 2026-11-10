import { browser } from 'wxt/browser';
import {
  dueSnoozed,
  PARKED,
  parseSnoozed,
  planSnooze,
  SNOOZE_KEY,
  type Snoozed,
} from '../shared/snooze';
import type { TabInfo } from '../shared/types';
import { createWriteQueue } from './write-queue';

export const SNOOZE_ALARM = 'vc-snooze';

/** Writes are queued so a wake and a snooze at the same moment can't lose each other. */
const enqueue = createWriteQueue();
function mutate<T>(fn: (list: Snoozed[]) => { list: Snoozed[]; result: T }): Promise<T> {
  return enqueue(async () => {
    const list = parseSnoozed((await browser.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY]);
    const { list: next, result } = fn(list);
    await browser.storage.local.set({ [SNOOZE_KEY]: next });
    return result;
  });
}

const newId = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

/** Arms one alarm for the earliest wake time (or clears it when nothing is snoozed). */
export async function scheduleSnoozeAlarm(): Promise<void> {
  const list = parseSnoozed((await browser.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY]);
  if (!list.length) {
    await browser.alarms.clear(SNOOZE_ALARM);
    return;
  }
  // Parked tabs have no wake time, so they never set the alarm.
  const timed = list.filter((s) => s.wakeAt !== PARKED);
  if (!timed.length) {
    await browser.alarms.clear(SNOOZE_ALARM);
    return;
  }
  const next = Math.min(...timed.map((s) => s.wakeAt));
  await browser.alarms.create(SNOOZE_ALARM, { when: Math.max(next, Date.now() + 30_000) });
}

/** Puts tabs away and closes them. Incognito tabs are skipped: nothing of theirs is stored. */
export async function snoozeTabs(tabs: readonly TabInfo[], wakeAt: number): Promise<number> {
  const plan = await mutate((list) => {
    const p = planSnooze(tabs, list.length, wakeAt, Date.now(), newId);
    return { list: [...list, ...p.entries], result: p };
  });
  // Close only after the entries are stored. A tab that won't close but is still open
  // drops its entry (no duplicate later); one already gone keeps it (its only copy).
  const kept = await Promise.all(
    plan.tabIds.map((id) =>
      browser.tabs.remove(id).then(
        () => true,
        () =>
          browser.tabs.get(id).then(
            () => false,
            () => true,
          ),
      ),
    ),
  );
  const drop = new Set(plan.entries.filter((_, i) => !kept[i]).map((e) => e.id));
  if (drop.size)
    await mutate((list) => ({ list: list.filter((s) => !drop.has(s.id)), result: null }));
  await scheduleSnoozeAlarm();
  return plan.entries.length - drop.size;
}

/**
 * Reopens the picked entries, removing each from storage only once its tab exists: a worker
 * stopped or a create failing midway leaves the rest stored (a duplicate beats a lost tab).
 * Runs as one queued write, so two wakes at once can't open the same entry twice.
 */
function wake(pick: (list: Snoozed[]) => Snoozed[]): Promise<number> {
  return enqueue(async () => {
    let list = parseSnoozed((await browser.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY]);
    let opened = 0;
    for (const s of pick(list)) {
      try {
        await browser.tabs.create({ url: s.url, active: false });
      } catch (err) {
        console.warn('[vc] reopening a snoozed tab failed; it stays snoozed', err);
        continue;
      }
      list = list.filter((x) => x.id !== s.id);
      await browser.storage.local.set({ [SNOOZE_KEY]: list });
      opened++;
    }
    return opened;
  }).finally(() => scheduleSnoozeAlarm());
}

/** Reopens everything due (also run at startup, for tabs that came due while closed). */
export function wakeDue(): Promise<number> {
  return wake((list) => dueSnoozed(list, Date.now()));
}

export async function wakeNow(id: string): Promise<void> {
  await wake((list) => list.filter((s) => s.id === id));
}

export async function deleteSnoozed(id: string): Promise<void> {
  await mutate((list) => ({ list: list.filter((s) => s.id !== id), result: null }));
  await scheduleSnoozeAlarm();
}
