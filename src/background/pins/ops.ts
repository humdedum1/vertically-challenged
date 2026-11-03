/**
 * Pure edits of a WindowLayout. Every op returns a new layout and never mutates its
 * input; an invalid request returns the input itself so callers can detect a no-op
 * with `===`.
 */
import {
  FOLDER_ICONS,
  type FolderIcon,
  findNode,
  flattenItems,
  folderHeight,
  MAX_FOLDER_DEPTH,
  MAX_ITEMS,
  MAX_NAME,
  newId,
  type PinDest,
  type PinFolder,
  type PinItem,
  type PinNode,
  type WindowLayout,
} from '../../shared/layout';

type PinnedDest = Extract<PinDest, { zone: 'pinned' }>;

const clone = (l: WindowLayout): WindowLayout => structuredClone(l);

/** The sibling list a destination points at, or null when its folder is missing. */
function listFor(l: WindowLayout, dest: PinDest): PinNode[] | PinItem[] | null {
  if (dest.zone === 'essentials') return l.essentials;
  if (dest.folderId === null) return l.pinned;
  const hit = findNode(l, dest.folderId);
  return hit?.zone === 'pinned' && hit.node.kind === 'folder' ? hit.node.children : null;
}

/** Depth of the folder a destination sits in: 0 for the pinned root. */
function destDepth(l: WindowLayout, dest: PinnedDest): number | null {
  if (dest.folderId === null) return 0;
  const hit = findNode(l, dest.folderId);
  return hit?.zone === 'pinned' && hit.node.kind === 'folder' ? hit.depth : null;
}

function splice(list: PinNode[] | PinItem[], index: number, nodes: PinNode[]): void {
  const at = Math.min(Math.max(0, index), list.length);
  (list as PinNode[]).splice(at, 0, ...nodes);
}

/** Detaches a node from its parent list (in a clone) and returns it. */
function detach(l: WindowLayout, id: string): PinNode | null {
  const hit = findNode(l, id);
  if (!hit) return null;
  const list: PinNode[] =
    hit.zone === 'essentials' ? l.essentials : hit.parent ? hit.parent.children : l.pinned;
  const i = list.findIndex((n) => n.id === id);
  if (i < 0) return null;
  return list.splice(i, 1)[0] ?? null;
}

export function insertItems(l: WindowLayout, items: PinItem[], dest: PinDest): WindowLayout {
  if (items.length === 0 || flattenItems(l).length + items.length > MAX_ITEMS) return l;
  const out = clone(l);
  const list = listFor(out, dest);
  if (!list) return l;
  splice(list, dest.index, structuredClone(items));
  return out;
}

export function moveNode(l: WindowLayout, nodeId: string, dest: PinDest): WindowLayout {
  const hit = findNode(l, nodeId);
  if (!hit) return l;
  if (hit.node.kind === 'folder') {
    if (dest.zone === 'essentials') return l;
    if (dest.folderId !== null) {
      // Into itself or any descendant.
      if (
        dest.folderId === nodeId ||
        findNode({ ...l, essentials: [], pinned: [hit.node] }, dest.folderId)
      )
        return l;
    }
    const depth = destDepth(l, dest);
    if (depth === null || depth + folderHeight(hit.node) > MAX_FOLDER_DEPTH) return l;
  } else if (dest.zone === 'pinned' && dest.folderId === nodeId) {
    return l;
  }
  const out = clone(l);
  const node = detach(out, nodeId);
  const list = node && listFor(out, dest);
  if (!node || !list) return l;
  splice(list, dest.index, [node]);
  return out;
}

export function removeItem(l: WindowLayout, itemId: string): WindowLayout {
  const hit = findNode(l, itemId);
  if (hit?.node.kind !== 'item') return l;
  const out = clone(l);
  detach(out, itemId);
  return out;
}

export function createFolder(
  l: WindowLayout,
  name: string,
  dest: PinnedDest,
  itemIds: string[],
): { layout: WindowLayout; folderId: string } {
  const depth = destDepth(l, dest);
  if (depth === null || depth + 1 > MAX_FOLDER_DEPTH) return { layout: l, folderId: '' };
  const wanted = new Set(itemIds);
  const out = clone(l);
  // Flattened order, not the caller's order, so the folder mirrors what the user sees.
  const children = flattenItems(out).filter((i) => wanted.has(i.id));
  for (const c of children) detach(out, c.id);
  const folder: PinFolder = {
    kind: 'folder',
    id: newId('f'),
    name: name.trim().slice(0, MAX_NAME) || 'New folder',
    icon: 'folder',
    collapsed: false,
    children,
  };
  const list = listFor(out, dest);
  if (!list) return { layout: l, folderId: '' };
  splice(list, dest.index, [folder]);
  return { layout: out, folderId: folder.id };
}

export function updateFolder(
  l: WindowLayout,
  folderId: string,
  patch: { name?: string; icon?: FolderIcon; collapsed?: boolean },
): WindowLayout {
  if (findNode(l, folderId)?.node.kind !== 'folder') return l;
  const out = clone(l);
  const f = findNode(out, folderId)?.node;
  if (f?.kind !== 'folder') return l;
  const name = patch.name?.trim().slice(0, MAX_NAME);
  if (name) f.name = name;
  if (patch.icon !== undefined && (FOLDER_ICONS as readonly string[]).includes(patch.icon)) {
    f.icon = patch.icon;
  }
  if (typeof patch.collapsed === 'boolean') f.collapsed = patch.collapsed;
  return out;
}

export function deleteFolder(
  l: WindowLayout,
  folderId: string,
  keepItems: boolean,
): { layout: WindowLayout; removedItems: PinItem[] } {
  const hit = findNode(l, folderId);
  if (hit?.node.kind !== 'folder' || hit.zone !== 'pinned') return { layout: l, removedItems: [] };
  const out = clone(l);
  const outHit = findNode(out, folderId);
  const list = outHit?.parent ? outHit.parent.children : out.pinned;
  const i = list.findIndex((n) => n.id === folderId);
  const folder = list[i] as PinFolder;
  if (keepItems) {
    list.splice(i, 1, ...folder.children);
    return { layout: out, removedItems: [] };
  }
  list.splice(i, 1);
  return { layout: out, removedItems: flattenItems({ ...out, essentials: [], pinned: [folder] }) };
}

/**
 * "Apply setup": the source's Essentials and pinned tree are appended to the target
 * with fresh ids and no live tabs, so applying the same setup twice never collides.
 * Items past the item cap are skipped.
 */
export function appendLayout(target: WindowLayout, source: WindowLayout): WindowLayout {
  const out = clone(target);
  let budget = MAX_ITEMS - flattenItems(out).length;
  const fresh = (n: PinNode): PinNode | null => {
    if (n.kind === 'item') {
      if (budget <= 0) return null;
      budget--;
      return { ...n, id: newId('i'), tabId: null };
    }
    const children = n.children.map(fresh).filter((c): c is PinNode => c !== null);
    return { ...n, id: newId('f'), children };
  };
  for (const i of source.essentials) {
    const c = fresh(i);
    if (c?.kind === 'item') out.essentials.push(c);
  }
  for (const n of source.pinned) {
    const c = fresh(n);
    if (c) out.pinned.push(c);
  }
  return out;
}
