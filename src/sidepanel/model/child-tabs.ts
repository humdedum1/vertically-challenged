import type { Row, TabRow } from './rows';

/** Nest contiguous opener branches, keeping browser order and native group boundaries. */
export function buildChildRows(source: readonly Row[], collapsed: ReadonlySet<number>): Row[] {
  const branch: TabRow[] = [];
  const positions = new Map<number, number>();
  const rows: Row[] = [];
  const trim = (length: number) => {
    while (branch.length > length) positions.delete((branch.pop() as TabRow).tab.id);
  };
  for (const row of source) {
    const previous = branch.at(-1);
    if (row.kind !== 'tab' || row.tab.pinned) {
      trim(0);
      rows.push({ ...row });
      continue;
    }
    if (
      previous &&
      (previous.tab.windowId !== row.tab.windowId || previous.tab.groupId !== row.tab.groupId)
    )
      trim(0);
    const at = row.tab.openerTabId === undefined ? undefined : positions.get(row.tab.openerTabId);
    trim(at === undefined || branch[at]?.tab.url.startsWith('chrome-extension:') ? 0 : at + 1);
    const parent = branch.at(-1);
    const next: TabRow = {
      ...row,
      childDepth: branch.length,
      level: row.level + branch.length,
      parentTabId: parent?.tab.id,
      hasChildren: false,
      collapsed: false,
    };
    if (parent) parent.hasChildren = true;
    positions.set(row.tab.id, branch.length);
    branch.push(next);
    rows.push(next);
  }

  // Count actual siblings at every level, including rows hidden by a collapsed branch.
  const ancestors: Row[] = [];
  const siblings = new Map<Row | undefined, Row[]>();
  for (const row of rows) {
    while (ancestors.length && (ancestors.at(-1) as Row).level >= row.level) ancestors.pop();
    const parent = ancestors.at(-1);
    const list = siblings.get(parent) ?? [];
    row.pos = list.length + 1;
    list.push(row);
    siblings.set(parent, list);
    ancestors.push(row);
  }
  for (const list of siblings.values()) for (const row of list) row.size = list.length;

  // An activated child stays visible, even when an ancestor was previously collapsed.
  const activePath = new Set<number>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] as Row;
    if (row.kind !== 'tab') continue;
    if ((row.tab.active || activePath.has(row.tab.id)) && row.parentTabId !== undefined)
      activePath.add(row.parentTabId);
    row.collapsed = !!row.hasChildren && collapsed.has(row.tab.id) && !activePath.has(row.tab.id);
  }
  let hiddenBelow = Infinity;
  return rows.filter((row) => {
    if (row.level > hiddenBelow) return false;
    hiddenBelow = row.kind === 'tab' && row.collapsed ? row.level : Infinity;
    return true;
  });
}
