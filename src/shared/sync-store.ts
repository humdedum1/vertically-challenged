/**
 * Option 1's transport: device documents in chrome.storage.sync. A device owns the keys
 * `dev:<id>` (a small header) and `dev:<id>:0` … `:<n-1>` (its encoded document in chunks).
 * Read by both the worker (budget, commands) and the panel (lists), never written by the
 * panel.
 */
import { DEVICE_ID, decodeDoc, itemBytes, parseSyncDoc, type SyncDoc } from './sync';

export const DEVICE_PREFIX = 'dev:';

/** This machine's id and name, in storage.local: per machine, never synced. */
export const DEVICE_KEY = 'vc:device';
/** What the Settings card shows about this device's last publish. */
export const SYNC_STATUS_KEY = 'vc:syncStatus';

export interface SyncStatus {
  deviceId: string;
  /** Last successful publish (ms), or 0. */
  publishedAt: number;
  /** Bytes this device's document takes in sync storage. */
  bytes: number;
  /** Total bytes in sync storage (all devices, settings, themes). */
  used: number;
  budget: number;
  omitted: { workspaces: number; sessions: number };
  /** Last failure, cleared by the next success. */
  error: string | null;
  /** Both switches are off: nothing is published. */
  off: boolean;
}

/** Documents not updated for this long belong to devices that are gone. */
export const STALE_DEVICE_MS = 90 * 24 * 60 * 60 * 1000;

export interface DeviceHeader {
  /** Chunk count. */
  n: number;
  updatedAt: number;
  name: string;
}

export interface SyncSnapshot {
  /** Every device's valid document, newest first. */
  docs: SyncDoc[];
  /** Bytes of everything that isn't a device document (settings, themes). */
  sharedBytes: number;
  /** Bytes per device id, header and chunks. */
  deviceBytes: Map<string, number>;
  /** Headers per device id, including devices whose document didn't decode. */
  headers: Map<string, DeviceHeader>;
}

const headerKey = (id: string) => `${DEVICE_PREFIX}${id}`;
export const chunkPrefix = (id: string) => `${DEVICE_PREFIX}${id}:`;

function parseHeader(v: unknown): DeviceHeader | null {
  if (typeof v !== 'object' || v === null) return null;
  const h = v as Record<string, unknown>;
  if (!Number.isInteger(h.n) || (h.n as number) < 1 || (h.n as number) > 64) return null;
  if (typeof h.updatedAt !== 'number') return null;
  return {
    n: h.n as number,
    updatedAt: h.updatedAt,
    name: typeof h.name === 'string' ? h.name.slice(0, 40) : '',
  };
}

/** The device id a sync key belongs to, or null for keys that aren't ours. */
export function deviceOfKey(key: string): string | null {
  if (!key.startsWith(DEVICE_PREFIX)) return null;
  const id = key.slice(DEVICE_PREFIX.length).split(':')[0] ?? '';
  return DEVICE_ID.test(id) ? id : null;
}

/** All of a device's keys present in `all`. */
export function keysOfDevice(all: Record<string, unknown>, id: string): string[] {
  return Object.keys(all).filter((k) => deviceOfKey(k) === id);
}

/**
 * Reads every device document out of a storage.sync dump. A document whose chunks don't
 * line up with its header (sync delivers keys one by one, so another device's new header
 * can arrive before all of its chunks) is skipped until the next change completes it.
 */
export async function readSync(all: Record<string, unknown>): Promise<SyncSnapshot> {
  const headers = new Map<string, DeviceHeader>();
  const deviceBytes = new Map<string, number>();
  let sharedBytes = 0;
  for (const [k, v] of Object.entries(all)) {
    const id = deviceOfKey(k);
    if (id === null) {
      sharedBytes += itemBytes(k, v);
      continue;
    }
    deviceBytes.set(id, (deviceBytes.get(id) ?? 0) + itemBytes(k, v));
    if (k === headerKey(id)) {
      const h = parseHeader(v);
      if (h) headers.set(id, h);
    }
  }
  const docs: SyncDoc[] = [];
  for (const [id, h] of headers) {
    const parts: string[] = [];
    for (let i = 0; i < h.n; i++) {
      const part = all[`${chunkPrefix(id)}${i}`];
      if (typeof part !== 'string') break;
      parts.push(part);
    }
    if (parts.length !== h.n) continue;
    const doc = parseSyncDoc(await decodeDoc(parts.join('')));
    // A document from another device's header, or one torn between two publishes.
    if (!doc || doc.device.id !== id || doc.updatedAt !== h.updatedAt) continue;
    docs.push(doc);
  }
  docs.sort((a, b) => b.updatedAt - a.updatedAt);
  return { docs, sharedBytes, deviceBytes, headers };
}

/**
 * The storage writes that publish `doc` (already encoded and cut into `chunks`) for its
 * device, and the stale keys to remove afterwards (chunks past the new count).
 */
export function publishItems(
  all: Record<string, unknown>,
  doc: SyncDoc,
  chunks: Record<string, string>,
): { set: Record<string, unknown>; remove: string[] } {
  const id = doc.device.id;
  const set: Record<string, unknown> = {
    ...chunks,
    [headerKey(id)]: {
      n: Object.keys(chunks).length,
      updatedAt: doc.updatedAt,
      name: doc.device.name,
    },
  };
  const remove = keysOfDevice(all, id).filter((k) => !(k in set));
  return { set, remove };
}
