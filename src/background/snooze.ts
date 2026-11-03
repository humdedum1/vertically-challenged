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

export const SNOOZE_ALARM = 'vc-snooze';

/** Writes are queued so a wake and a snooze at the same moment can't lose each other. */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (list: Snoozed[]) => { list: Snoozed[]; result: T }): Promise<T> {
  const run = queue.then(async () => {
    const list = parseSnoozed((await browser.storage.local.get(SNOOZE_KEY))[SNOOZE_KEY]);
    const { list: next, result } = fn(list);
    await browser.storage.local.set({ [SNOOZE_KEY]: next });
    return result;
  });
  queue = run.catch(() => {});
  return run;
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
  // Close only after the entries are stored.
  if (plan.tabIds.length) await browser.tabs.remove(plan.tabIds);
  await scheduleSnoozeAlarm();
  return plan.entries.length;
}

async function open(entries: readonly Snoozed[]): Promise<void> {
  for (const s of entries) await browser.tabs.create({ url: s.url, active: false });
}

/** Reopens everything due (also run at startup, for tabs that came due while closed). */
export async function wakeDue(): Promise<number> {
  const due = await mutate((list) => {
    const d = dueSnoozed(list, Date.now());
    return { list: list.filter((s) => !d.includes(s)), result: d };
  });
  await open(due);
  await scheduleSnoozeAlarm();
  return due.length;
}

export async function wakeNow(id: string): Promise<void> {
  const woken = await mutate((list) => ({
    list: list.filter((s) => s.id !== id),
    result: list.filter((s) => s.id === id),
  }));
  await open(woken);
  await scheduleSnoozeAlarm();
}

export async function deleteSnoozed(id: string): Promise<void> {
  await mutate((list) => ({ list: list.filter((s) => s.id !== id), result: null }));
  await scheduleSnoozeAlarm();
}
