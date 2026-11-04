import { EXTENSION_SCHEME } from './browser-urls';
/**
 * Sync between a user's machines. Every device publishes one document describing itself
 * (its workspaces and saved sessions) and only ever reads the others': nothing is merged,
 * so two machines can't overwrite each other. The document is transport-neutral; option 1
 * carries it in chrome.storage.sync (see background/sync), later transports reuse it.
 */
import {
  flattenItems,
  isLayoutUrl,
  MAX_NAME,
  newId,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from './layout';
import {
  captureWindow,
  parseSessions,
  type SavedPinNode,
  type SavedWindow,
  type Session,
} from './sessions';
import type { GroupInfo, TabInfo } from './types';

export const SYNC_VERSION = 1;

export interface SyncDevice {
  id: string;
  name: string;
  /** chrome.runtime.PlatformOs: 'win', 'mac', 'linux', 'cros', … */
  os: string;
}

/** A window's or setup's pinned structure: Essentials, pinned tabs and folders. */
export interface SyncWorkspace {
  /** The layout id on the publishing device. */
  id: string;
  name: string;
  kind: 'window' | 'setup';
  lastUsed: number;
  window: SavedWindow;
}

export interface SyncDoc {
  v: typeof SYNC_VERSION;
  device: SyncDevice;
  updatedAt: number;
  /** Open windows first, then setups by last use. */
  workspaces: SyncWorkspace[];
  /** Newest first. */
  sessions: Session[];
  /** Left out because the document had no more room. */
  omitted: { workspaces: number; sessions: number };
}

export const DEVICE_ID = /^[a-z0-9]{10}$/;
export const MAX_DEVICE_NAME = 40;
const MAX_WORKSPACES = 100;

// --- Layout <-> saved window ---------------------------------------------------------------

/**
 * A saved window with the complete pinned tree, including dormant items, followed by
 * ordinary tabs and native groups. Live pins use their current URL; dormant pins use
 * their home URL. Browser IDs are replaced by indices for restoration on other devices.
 */
export function savedFromLayout(
  layout: WindowLayout,
  tabs: readonly TabInfo[] = [],
  groups: readonly GroupInfo[] = [],
): SavedWindow {
  const items = flattenItems(layout);
  const live = new Map(tabs.filter((t) => !t.incognito).map((t) => [t.id, t]));
  const bound = new Set(items.map((i) => i.tabId));
  const extra = captureWindow(
    tabs.filter((t) => !t.incognito && !bound.has(t.id)),
    groups,
    EXTENSION_SCHEME,
  );
  const index = new Map(items.map((i, n) => [i.id, n]));
  const tree = (nodes: readonly PinNode[]): SavedPinNode[] =>
    nodes.map((n) =>
      n.kind === 'item'
        ? { kind: 'item', tab: index.get(n.id) as number }
        : {
            kind: 'folder',
            name: n.name,
            icon: n.icon,
            collapsed: n.collapsed,
            children: tree(n.children),
          },
    );
  return {
    tabs: [
      ...items.map((i) => ({
        url: (i.tabId === null ? undefined : live.get(i.tabId)?.url) ?? i.homeUrl,
        title: i.title,
        pinned: true,
        group: null,
      })),
      ...extra.tabs,
    ],
    groups: extra.groups,
    layout: {
      essentials: layout.essentials.map((i) => index.get(i.id) as number),
      pinned: tree(layout.pinned),
    },
  };
}

/**
 * A new, unbound layout (fresh ids, every item dormant) from a saved window's layout, for
 * keeping another device's workspace as a setup here. Tabs outside the layout are ignored;
 * items on URLs a layout can't hold are dropped.
 */
export function layoutFromSaved(win: SavedWindow, name: string | null): WindowLayout {
  const item = (tab: number): PinItem | null => {
    const t = win.tabs[tab];
    if (!t || !isLayoutUrl(t.url)) return null;
    return {
      kind: 'item',
      id: newId('i'),
      homeUrl: t.url,
      lastUrl: t.url,
      title: t.title,
      tabId: null,
    };
  };
  const tree = (nodes: readonly SavedPinNode[]): PinNode[] => {
    const out: PinNode[] = [];
    for (const n of nodes) {
      if (n.kind === 'item') {
        const i = item(n.tab);
        if (i) out.push(i);
        continue;
      }
      const children = tree(n.children);
      if (children.length) {
        out.push({
          kind: 'folder',
          id: newId('f'),
          name: n.name,
          icon: n.icon,
          collapsed: n.collapsed,
          children,
        });
      }
    }
    return out;
  };
  return {
    id: newId('l'),
    name: name?.trim().slice(0, MAX_NAME) || null,
    essentials: (win.layout?.essentials ?? []).map(item).filter((i): i is PinItem => i !== null),
    pinned: tree(win.layout?.pinned ?? []),
    collapsed: [],
    incognito: false,
    lastUsed: Date.now(),
  };
}

// --- Validation ------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const text = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/** One saved window through the session validator (URLs, indices, folder depth). */
function parseWindow(raw: unknown): SavedWindow | null {
  return (
    parseSessions([{ id: 'w', name: 'w', createdAt: 0, windows: [raw] }])[0]?.windows[0] ?? null
  );
}

/**
 * Another device's document, validated. It comes from sync storage, so it is untrusted
 * input: every URL in it may later be opened. Invalid parts are dropped; a document that
 * isn't one at all (wrong version, no device) is null.
 */
export function parseSyncDoc(raw: unknown): SyncDoc | null {
  if (!isObj(raw) || raw.v !== SYNC_VERSION || !isObj(raw.device)) return null;
  const id = raw.device.id;
  if (typeof id !== 'string' || !DEVICE_ID.test(id)) return null;
  const workspaces: SyncWorkspace[] = [];
  for (const w of Array.isArray(raw.workspaces) ? raw.workspaces.slice(0, MAX_WORKSPACES) : []) {
    if (!isObj(w) || typeof w.id !== 'string' || !/^l[a-z0-9]{10}$/.test(w.id)) continue;
    const win = parseWindow(w.window);
    if (!win) continue;
    workspaces.push({
      id: w.id,
      name: text(w.name, MAX_NAME) || 'Workspace',
      kind: w.kind === 'setup' ? 'setup' : 'window',
      lastUsed: num(w.lastUsed),
      window: win,
    });
  }
  const omitted = isObj(raw.omitted) ? raw.omitted : {};
  return {
    v: SYNC_VERSION,
    device: {
      id,
      name: text(raw.device.name, MAX_DEVICE_NAME) || 'Another device',
      os: text(raw.device.os, 10),
    },
    updatedAt: num(raw.updatedAt),
    workspaces,
    sessions: parseSessions(raw.sessions),
    omitted: {
      workspaces: Math.max(0, Math.floor(num(omitted.workspaces))),
      sessions: Math.max(0, Math.floor(num(omitted.sessions))),
    },
  };
}

// --- Encoding --------------------------------------------------------------------------------

/** Decompressed documents larger than this are refused (a 40 KB budget compresses ~4:1). */
export const MAX_DOC_BYTES = 2_000_000;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  max: number,
) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    // A small payload can inflate enormously; stop reading instead of holding it all.
    if (size > max) {
      await reader.cancel();
      throw new Error('document too large');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** JSON, deflate-raw, base64. */
export async function encodeDoc(doc: SyncDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  return toBase64(await pipe(json, new CompressionStream('deflate-raw'), Number.POSITIVE_INFINITY));
}

/** The raw (still unvalidated) document, or null when it can't be decoded. */
export async function decodeDoc(b64: string): Promise<unknown> {
  try {
    const bytes = await pipe(
      fromBase64(b64),
      new DecompressionStream('deflate-raw'),
      MAX_DOC_BYTES,
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

// --- Fitting into a budget ----------------------------------------------------------------------

/**
 * The largest document in priority order (workspaces, then sessions, each list already
 * ordered) whose encoding stays within `budget` characters. An item that doesn't fit is
 * left out and counted, and smaller ones after it still get their chance.
 */
export async function fitDoc(
  base: Pick<SyncDoc, 'device' | 'updatedAt'>,
  workspaces: readonly SyncWorkspace[],
  sessions: readonly Session[],
  budget: number,
): Promise<{ doc: SyncDoc; encoded: string }> {
  const doc: SyncDoc = {
    v: SYNC_VERSION,
    ...base,
    workspaces: [],
    sessions: [],
    omitted: { workspaces: 0, sessions: 0 },
  };
  let encoded = await encodeDoc(doc);
  const tryAdd = async (add: () => void, undo: () => void, kind: 'workspaces' | 'sessions') => {
    add();
    const next = await encodeDoc(doc);
    if (next.length <= budget) {
      encoded = next;
      return;
    }
    undo();
    doc.omitted[kind]++;
  };
  for (const w of workspaces) {
    await tryAdd(
      () => doc.workspaces.push(w),
      () => doc.workspaces.pop(),
      'workspaces',
    );
  }
  for (const s of sessions) {
    await tryAdd(
      () => doc.sessions.push(s),
      () => doc.sessions.pop(),
      'sessions',
    );
  }
  // `encoded` matches the document as it is now (the last failed attempt was undone).
  encoded = await encodeDoc(doc);
  return { doc, encoded };
}

// --- storage.sync quota ---------------------------------------------------------------------------

/** chrome.storage.sync limits (QUOTA_BYTES, QUOTA_BYTES_PER_ITEM). */
export const SYNC_QUOTA = 102_400;
export const SYNC_ITEM_QUOTA = 8_192;
/** Head-room kept free for settings and themes to grow. */
export const SYNC_RESERVE = 6_144;
/** No device takes more than this, however much is free. */
export const MAX_DEVICE_BUDGET = 40_960;

/** How Chrome counts an item against the quota: the key plus the JSON of its value. */
export const itemBytes = (key: string, value: unknown): number =>
  new TextEncoder().encode(key).length + new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * This device's share: an equal split of what settings and themes leave, among all devices
 * with documents (this one included), capped by what is actually free and by
 * MAX_DEVICE_BUDGET. Every device computes the same split, so none crowds out the others.
 */
export function deviceBudget(opts: {
  /** Bytes of everything that isn't a device document (settings, themes). */
  shared: number;
  /** Bytes of the other devices' documents. */
  others: number;
  /** Devices with documents, this one included. */
  devices: number;
}): number {
  const room = SYNC_QUOTA - opts.shared - SYNC_RESERVE;
  const fair = Math.floor(room / Math.max(1, opts.devices));
  const free = room - opts.others;
  return Math.max(0, Math.min(MAX_DEVICE_BUDGET, fair, free));
}

/**
 * Cuts an encoded document into storage items `<prefix>0`, `<prefix>1`, … each within
 * Chrome's per-item limit (key and JSON quotes included).
 */
export function chunk(encoded: string, prefix: string): Record<string, string> {
  // base64 is ASCII, so characters are bytes; 2 for the JSON quotes, 4 for the index.
  const size = SYNC_ITEM_QUOTA - prefix.length - 2 - 4 - 16;
  const out: Record<string, string> = {};
  for (let i = 0, n = 0; i < encoded.length || n === 0; i += size, n++) {
    out[`${prefix}${n}`] = encoded.slice(i, i + size);
  }
  return out;
}
