/**
 * Publishes this device's sync document (see shared/sync.ts) into chrome.storage.sync and
 * keeps a status for the Settings card. The worker is its only writer.
 */

import type { SyncSettings } from '../../settings/schema';
import type { Session } from '../../shared/sessions';
import {
  chunk,
  DEVICE_ID,
  deviceBudget,
  fitDoc,
  MAX_DEVICE_NAME,
  type SyncDevice,
  type SyncWorkspace,
} from '../../shared/sync';
import {
  chunkPrefix,
  DEVICE_KEY,
  keysOfDevice,
  publishItems,
  readSync,
  STALE_DEVICE_MS,
  SYNC_STATUS_KEY,
  type SyncStatus,
} from '../../shared/sync-store';

export { DEVICE_KEY, SYNC_STATUS_KEY, type SyncStatus };

interface Area {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PublisherDeps {
  sync: Area;
  local: Area;
  /** Open windows' workspaces first, then setups by last use (never incognito). */
  workspaces: () => Promise<SyncWorkspace[]>;
  /** Saved sessions, newest first. */
  sessions: () => Promise<Session[]>;
  settings: () => Promise<SyncSettings>;
  platform: () => Promise<string>;
  now?: () => number;
}

/** Quiet time after the last change before publishing. */
const DEBOUNCE_MS = 15_000;
/** At most one publish per this long, however busy (storage.sync: 120 writes a minute). */
const MIN_INTERVAL_MS = 60_000;

const OS_NAMES: Record<string, string> = {
  win: 'Windows computer',
  mac: 'Mac',
  linux: 'Linux computer',
  cros: 'Chromebook',
  android: 'Android device',
};

function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => chars.charAt(b % 36)).join('');
}

export function createSyncPublisher(deps: PublisherDeps) {
  const now = () => deps.now?.() ?? Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;
  let running: Promise<void> = Promise.resolve();
  /** Content of the last publish, without its timestamp, so unchanged state isn't rewritten. */
  let lastContent: string | null = null;

  // Cached so concurrent first calls can't each create (and publish under) a different id.
  let cached: Promise<SyncDevice> | null = null;
  function device(): Promise<SyncDevice> {
    cached ??= loadDevice().catch((err) => {
      cached = null;
      throw err;
    });
    return cached;
  }

  async function loadDevice(): Promise<SyncDevice> {
    const raw = (await deps.local.get(DEVICE_KEY))[DEVICE_KEY] as Partial<SyncDevice> | undefined;
    const os = await deps.platform().catch(() => '');
    if (
      raw &&
      typeof raw.id === 'string' &&
      DEVICE_ID.test(raw.id) &&
      typeof raw.name === 'string'
    ) {
      return { id: raw.id, name: raw.name, os };
    }
    const d = { id: randomId(), name: OS_NAMES[os] ?? 'This computer', os };
    await deps.local.set({ [DEVICE_KEY]: { id: d.id, name: d.name } });
    return d;
  }

  async function writeStatus(patch: Partial<SyncStatus>): Promise<void> {
    const cur = ((await deps.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] ??
      {}) as Partial<SyncStatus>;
    await deps.local.set({ [SYNC_STATUS_KEY]: { ...cur, ...patch } });
  }

  async function publish(force: boolean): Promise<void> {
    const me = await device();
    const prefs = await deps.settings();
    const all = await deps.sync.get(null);
    // Devices nobody has heard from in months: whoever notices removes them.
    const snap = await readSync(all);
    const stale = new Set(
      [...snap.headers]
        .filter(([id, h]) => id !== me.id && now() - h.updatedAt > STALE_DEVICE_MS)
        .map(([id]) => id),
    );
    const staleKeys = [...stale].flatMap((id) => keysOfDevice(all, id));
    if (staleKeys.length) await deps.sync.remove(staleKeys);

    if (!prefs.workspaces && !prefs.sessions) {
      const mine = keysOfDevice(all, me.id);
      if (mine.length) await deps.sync.remove(mine);
      lastContent = null;
      await writeStatus({ deviceId: me.id, off: true, bytes: 0, error: null });
      return;
    }

    const workspaces = prefs.workspaces ? await deps.workspaces() : [];
    const sessions = prefs.sessions ? await deps.sessions() : [];
    const others = [...snap.deviceBytes]
      .filter(([id]) => id !== me.id && !stale.has(id))
      .reduce((n, [, b]) => n + b, 0);
    const devices = new Set([...snap.headers.keys()].filter((id) => !stale.has(id)));
    devices.add(me.id);
    // The header and chunk keys cost a little on top of the encoded text.
    const budget = Math.max(
      0,
      deviceBudget({ shared: snap.sharedBytes, others, devices: devices.size }) - 400,
    );
    const { doc, encoded } = await fitDoc(
      { device: me, updatedAt: now() },
      workspaces,
      sessions,
      budget,
    );
    const content = JSON.stringify({ ...doc, updatedAt: 0 });
    if (!force && content === lastContent) return;

    const parts = chunk(encoded, chunkPrefix(me.id));
    const { set, remove } = publishItems(all, doc, parts);
    try {
      // One write operation for the whole document.
      await deps.sync.set(set);
      if (remove.length) await deps.sync.remove(remove);
    } catch (err) {
      await writeStatus({
        deviceId: me.id,
        off: false,
        error: /quota/i.test(String(err))
          ? 'Sync storage is full'
          : `Couldn't sync: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    lastContent = content;
    const after = await readSync(await deps.sync.get(null));
    const used = after.sharedBytes + [...after.deviceBytes.values()].reduce((n, b) => n + b, 0);
    await writeStatus({
      deviceId: me.id,
      off: false,
      publishedAt: doc.updatedAt,
      bytes: after.deviceBytes.get(me.id) ?? 0,
      used,
      budget,
      omitted: doc.omitted,
      error: null,
    });
  }

  function run(force = false): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    lastRun = now();
    running = running
      .then(() => publish(force))
      .catch((err: unknown) => console.warn('[vc] sync publish failed', err));
    return running;
  }

  return {
    /** Something this device publishes changed: publish soon, within the rate limits. */
    async schedule(reset = false): Promise<void> {
      try {
        const prefs = await deps.settings();
        if (reset && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (prefs.intervalMinutes === 0) {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          return;
        }
        if (timer !== null) return;
        const interval = Math.max(MIN_INTERVAL_MS, prefs.intervalMinutes * 60_000);
        const status = (await deps.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] as
          | Partial<SyncStatus>
          | undefined;
        const previous = Math.max(lastRun, Math.min(now(), status?.publishedAt ?? 0));
        if (timer !== null) return;
        const wait = Math.max(DEBOUNCE_MS, previous + interval - now());
        timer = setTimeout(() => void run(), wait);
      } catch (err) {
        console.warn('[vc] scheduling sync failed', err);
      }
    },
    /** Alarm wake-up: unchanged snapshots aren't rewritten and manual mode is respected. */
    async auto(): Promise<void> {
      const prefs = await deps.settings();
      if (prefs.intervalMinutes === 0) return;
      const status = (await deps.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] as
        | Partial<SyncStatus>
        | undefined;
      const previous = Math.max(lastRun, Math.min(now(), status?.publishedAt ?? 0));
      if (now() - previous >= prefs.intervalMinutes * 60_000) await run();
    },
    /** Resolves when the publish under way (if any) is done. */
    settled: (): Promise<void> => running,
    /** Publishes now ("Sync now", a rename, a switch turned off). */
    now: () => run(true),
    /** This device's identity, created on first use. */
    device,
    /** Removes another device's document ("Forget"). */
    async forget(deviceId: string): Promise<void> {
      const me = await device();
      if (deviceId === me.id || !DEVICE_ID.test(deviceId)) return;
      const keys = keysOfDevice(await deps.sync.get(null), deviceId);
      if (keys.length) await deps.sync.remove(keys);
    },
    async rename(name: string): Promise<void> {
      const me = await device();
      const trimmed = name.trim().slice(0, MAX_DEVICE_NAME);
      if (!trimmed || trimmed === me.name) return;
      await deps.local.set({ [DEVICE_KEY]: { id: me.id, name: trimmed } });
      cached = null;
      await run(true);
    },
  };
}

export type SyncPublisher = ReturnType<typeof createSyncPublisher>;
