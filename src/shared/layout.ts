/**
 * Window layouts: each window's Essentials, pinned tree and the saved setups that
 * windows can be bound to. Only the worker writes these; the panel reads them through
 * messages. Parsing never throws, because a corrupt entry must not take the other
 * windows' layouts down with it.
 */

export const FOLDER_ICONS = [
  'folder',
  'star',
  'work',
  'book',
  'code',
  'music',
  'cart',
  'home',
  'chat',
  'game',
] as const;
export type FolderIcon = (typeof FOLDER_ICONS)[number];

export interface PinItem {
  kind: 'item';
  id: string;
  homeUrl: string;
  /** Where the tab was last navigated; reopened after a restart or a close. */
  lastUrl: string;
  title: string;
  /** Live tab backing this item, or null when the item is dormant. */
  tabId: number | null;
}

export interface PinFolder {
  kind: 'folder';
  id: string;
  name: string;
  icon: FolderIcon;
  collapsed: boolean;
  children: PinNode[];
}

export type PinNode = PinItem | PinFolder;

export interface WindowLayout {
  /** Stable, /^l[a-z0-9]{10}$/. */
  id: string;
  /** null = use the active tab's title. */
  name: string | null;
  essentials: PinItem[];
  pinned: PinNode[];
  /** Layout ids of OTHER windows collapsed in this window's panel. */
  collapsed: string[];
  incognito: boolean;
  lastUsed: number;
}

export interface LayoutStore {
  v: 1;
  layouts: WindowLayout[];
  bindings: { windowId: number; layoutId: string }[];
}

/** Where a node lands; `index` counts siblings after removing the moved node. Shared because it travels on the wire. */
export type PinDest =
  | { zone: 'essentials'; index: number }
  | { zone: 'pinned'; folderId: string | null; index: number };

export const LAYOUTS_KEY = 'layouts';
/** Incognito layouts live only in storage.session so they never reach the disk. */
export const INCOGNITO_LAYOUTS_KEY = 'layouts:incognito';

export const MAX_ITEMS = 500;
export const MAX_SETUPS = 50;
/** Root-level folders are depth 1; a folder at depth 3 may hold items but not folders. */
export const MAX_FOLDER_DEPTH = 3;
export const MAX_NAME = 100;

const MAX_URL = 8192;
const MAX_TITLE = 200;
const MAX_ID = 40;
const LAYOUT_ID = /^l[a-z0-9]{10}$/;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** Only schemes the panel may open. Anything else (javascript:, data:, ...) is dropped on load. */
const SCHEMES = new Set(['http:', 'https:', 'file:', 'chrome:', 'about:']);

/** Ids are prefix + 10 chars; the random byte is rejected above 252 (= 36 * 7) to avoid modulo bias. */
export function newId(prefix: 'l' | 'i' | 'f'): string {
  let out = '';
  const buf = new Uint8Array(16);
  while (out.length < 10) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 252 && out.length < 10) out += ID_CHARS.charAt(b % 36);
    }
  }
  return prefix + out;
}

export function emptyLayout(incognito: boolean): WindowLayout {
  return {
    id: newId('l'),
    name: null,
    essentials: [],
    pinned: [],
    collapsed: [],
    incognito,
    lastUsed: Date.now(),
  };
}

/** Essentials in grid order, then the pinned tree depth-first (including collapsed folders). */
export function flattenItems(l: WindowLayout): PinItem[] {
  const out: PinItem[] = [...l.essentials];
  const walk = (nodes: PinNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'item') out.push(n);
      else walk(n.children);
    }
  };
  walk(l.pinned);
  return out;
}

/** A layout with a folder but no items is still a real layout, so only a bare one counts as empty. */
export function isEmptyLayout(l: WindowLayout): boolean {
  return l.essentials.length === 0 && l.pinned.length === 0;
}

type NodeHit = {
  node: PinNode;
  parent: PinFolder | null;
  zone: 'essentials' | 'pinned';
  /** 0 for essentials, 1 for root-level pinned nodes, +1 per enclosing folder. */
  depth: number;
};

export function findNode(l: WindowLayout, id: string): NodeHit | null {
  const ess = l.essentials.find((i) => i.id === id);
  if (ess) return { node: ess, parent: null, zone: 'essentials', depth: 0 };
  const walk = (nodes: PinNode[], parent: PinFolder | null, depth: number): NodeHit | null => {
    for (const n of nodes) {
      if (n.id === id) return { node: n, parent, zone: 'pinned', depth };
      if (n.kind === 'folder') {
        const hit = walk(n.children, n, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(l.pinned, null, 1);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether a URL survives parsing; anything else is dropped from the stored layout on load. */
export const isLayoutUrl = (v: unknown): v is string => {
  if (typeof v !== 'string' || !v || v.length > MAX_URL) return false;
  try {
    return SCHEMES.has(new URL(v).protocol);
  } catch {
    return false;
  }
};

const isTabId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Per-layout parse state: the item budget and every node id seen so far (ids must be unique for findNode). */
interface Ctx {
  items: number;
  ids: Set<string>;
}

function freshId(v: unknown, ctx: Ctx): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID && !ctx.ids.has(v);
}

function parseItem(r: Record<string, unknown>, ctx: Ctx): PinItem | null {
  const { id, homeUrl, lastUrl } = r;
  if (
    ctx.items >= MAX_ITEMS ||
    !freshId(id, ctx) ||
    !isLayoutUrl(homeUrl) ||
    !isLayoutUrl(lastUrl)
  ) {
    return null;
  }
  ctx.ids.add(id);
  ctx.items++;
  return {
    kind: 'item',
    id,
    homeUrl,
    lastUrl,
    title: typeof r.title === 'string' ? r.title.slice(0, MAX_TITLE) : '',
    tabId: isTabId(r.tabId) ? r.tabId : null,
  };
}

/** `depth` is the depth of the folder that holds `raw`; 0 for the layout root. */
function parseNodes(raw: unknown, depth: number, ctx: Ctx): PinNode[] {
  const out: PinNode[] = [];
  if (!Array.isArray(raw)) return out;
  for (const r of raw) {
    if (!isObj(r)) continue;
    if (r.kind === 'item') {
      const item = parseItem(r, ctx);
      if (item) out.push(item);
    } else if (r.kind === 'folder') {
      const id = r.id;
      if (!freshId(id, ctx)) continue;
      ctx.ids.add(id);
      const children = parseNodes(r.children, depth + 1, ctx);
      // Too deep to exist as a folder: its (already flattened) contents move up into the parent.
      if (depth + 1 > MAX_FOLDER_DEPTH) {
        out.push(...children);
        continue;
      }
      const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_NAME) : '';
      out.push({
        kind: 'folder',
        id,
        name: name || 'Folder',
        icon: (FOLDER_ICONS as readonly unknown[]).includes(r.icon)
          ? (r.icon as FolderIcon)
          : 'folder',
        collapsed: r.collapsed === true,
        children,
      });
    }
  }
  return out;
}

function parseLayout(raw: Record<string, unknown>): WindowLayout | null {
  const id = raw.id;
  if (typeof id !== 'string' || !LAYOUT_ID.test(id)) return null;
  const ctx: Ctx = { items: 0, ids: new Set() };
  const essentials: PinItem[] = [];
  if (Array.isArray(raw.essentials)) {
    for (const r of raw.essentials) {
      if (!isObj(r) || r.kind !== 'item') continue;
      const item = parseItem(r, ctx);
      if (item) essentials.push(item);
    }
  }
  const pinned = parseNodes(raw.pinned, 0, ctx);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, MAX_NAME) : null;
  const collapsed = Array.isArray(raw.collapsed)
    ? raw.collapsed.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    id,
    name,
    essentials,
    pinned,
    collapsed,
    incognito: raw.incognito === true,
    lastUsed: typeof raw.lastUsed === 'number' && Number.isFinite(raw.lastUsed) ? raw.lastUsed : 0,
  };
}

/**
 * Validates the stored layout store. Invalid parts are dropped, not repaired. The
 * layout cap keeps every layout a window is bound to, so a binding never points at a
 * layout that was silently evicted; the remaining slots go to the most recently used.
 */
export function parseLayoutStore(raw: unknown): LayoutStore {
  if (!isObj(raw) || raw.v !== 1 || !Array.isArray(raw.layouts)) {
    return { v: 1, layouts: [], bindings: [] };
  }

  const parsed: WindowLayout[] = [];
  const seen = new Set<string>();
  for (const r of raw.layouts) {
    if (!isObj(r)) continue;
    const l = parseLayout(r);
    if (!l || seen.has(l.id)) continue;
    seen.add(l.id);
    parsed.push(l);
  }
  const known = new Set(parsed.map((l) => l.id));

  const bindings: LayoutStore['bindings'] = [];
  const bound = new Set<string>();
  for (const b of Array.isArray(raw.bindings) ? raw.bindings : []) {
    if (!isObj(b)) continue;
    const { windowId, layoutId } = b;
    if (typeof windowId !== 'number' || !Number.isInteger(windowId)) continue;
    if (typeof layoutId !== 'string' || !known.has(layoutId)) continue;
    // A window can only be bound to one layout; the first binding wins.
    if (bindings.some((x) => x.windowId === windowId)) continue;
    bindings.push({ windowId, layoutId });
    bound.add(layoutId);
  }

  const unbound = parsed
    .filter((l) => !bound.has(l.id))
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_SETUPS);
  const keep = new Set([...bound, ...unbound.map((l) => l.id)]);

  const layouts = parsed
    .filter((l) => keep.has(l.id))
    .map((l) => ({
      ...l,
      // Collapsed markers for layouts that were dropped would never match anything.
      collapsed: [...new Set(l.collapsed)].filter((id) => id !== l.id && keep.has(id)),
    }));
  return { v: 1, layouts, bindings };
}
