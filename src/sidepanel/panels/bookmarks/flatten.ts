export interface Node {
  id: string;
  title: string;
  url?: string;
  children?: Node[];
}

export interface BookmarkRow {
  node: Node;
  level: number;
  pos: number;
  size: number;
  parentId: string | null;
}

export const isFolder = (n: Node): boolean => n.url === undefined;

/**
 * Visible rows for the tree. The invisible root is skipped; its children (bar, other,
 * mobile) are level 1. Mobile is hidden while empty since most profiles never use it.
 */
export function flattenTree(root: Node | undefined, expanded: ReadonlySet<string>): BookmarkRow[] {
  const out: BookmarkRow[] = [];
  const walk = (nodes: Node[], level: number, parentId: string | null): void => {
    nodes.forEach((node, i) => {
      out.push({ node, level, pos: i + 1, size: nodes.length, parentId });
      if (isFolder(node) && expanded.has(node.id) && node.children?.length) {
        walk(node.children, level + 1, node.id);
      }
    });
  };
  const top = (root?.children ?? []).filter(
    (n, i, all) => i < 2 || all.length <= 2 || n.children?.length,
  );
  walk(top, 1, null);
  return out;
}

/** Every bookmark URL under a folder (recursive), in tree order. */
export function collectUrls(folder: Node): string[] {
  const urls: string[] = [];
  const walk = (n: Node): void => {
    if (n.url !== undefined) urls.push(n.url);
    for (const c of n.children ?? []) walk(c);
  };
  walk(folder);
  return urls;
}

export const isScriptUrl = (url: string): boolean => /^\s*javascript:/i.test(url);
