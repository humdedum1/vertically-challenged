import { findNode, type PinDest, type PinNode, type WindowLayout } from '../../shared/layout';
import { folderFits } from './drop-plan';

/** One keyboard move of a node: where it lands and how to announce it. */
export type PinStep =
  | {
      dest: PinDest;
      /** Relative to `ref`: stepped above / below a sibling, into or out of a folder. */
      how: 'above' | 'below' | 'into' | 'out of';
      /** Id of that sibling or folder. */
      ref: string;
    }
  | { edge: true };

/**
 * Alt+Up / Down on a pin or folder (Alt+Left / Right on a tile): one step among its
 * siblings. Like moving through a tab group, crossing a folder edge takes a press of its
 * own: next to an expanded folder the node joins it (last child going up, first going
 * down), at the first / last child it leaves (just before / after the folder). Collapsed
 * folders, and folders the node would exceed the depth limit in, are stepped over.
 * `dest.index` counts siblings after removing the node, as pinMove expects. Null when
 * the node is gone; `edge` at the ends of the grid or the pinned root.
 */
export function pinStep(l: WindowLayout, nodeId: string, dir: -1 | 1): PinStep | null {
  const hit = findNode(l, nodeId);
  if (!hit) return null;
  if (hit.zone === 'essentials') {
    const i = l.essentials.findIndex((n) => n.id === nodeId);
    const ref = l.essentials[i + dir];
    if (!ref) return { edge: true };
    return {
      dest: { zone: 'essentials', index: i + dir },
      how: dir < 0 ? 'above' : 'below',
      ref: ref.id,
    };
  }
  const parentId = hit.parent?.id ?? null;
  const list: readonly PinNode[] = hit.parent ? hit.parent.children : l.pinned;
  const i = list.findIndex((n) => n.id === nodeId);
  const sibling = list[i + dir];
  if (!sibling) {
    if (!hit.parent) return { edge: true };
    const outer = findNode(l, hit.parent.id);
    const outerList: readonly PinNode[] = outer?.parent ? outer.parent.children : l.pinned;
    const at = outerList.findIndex((n) => n.id === hit.parent?.id);
    return {
      dest: { zone: 'pinned', folderId: outer?.parent?.id ?? null, index: at + (dir < 0 ? 0 : 1) },
      how: 'out of',
      ref: hit.parent.id,
    };
  }
  if (sibling.kind === 'folder' && !sibling.collapsed) {
    const dest: PinDest = {
      zone: 'pinned',
      folderId: sibling.id,
      index: dir < 0 ? sibling.children.length : 0,
    };
    if (hit.node.kind === 'item' || folderFits(l, hit.node, dest)) {
      return { dest, how: 'into', ref: sibling.id };
    }
  }
  return {
    dest: { zone: 'pinned', folderId: parentId, index: i + dir },
    how: dir < 0 ? 'above' : 'below',
    ref: sibling.id,
  };
}
