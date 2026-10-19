export interface SingleMove {
  tabId: number;
  /** Final index of the tab after this single move, as chrome.tabs.move expects. */
  index: number;
}

/**
 * Turns "put these tabs, in this order, right before `beforeTabId`" into single-tab
 * moves. chrome.tabs.move with an array advances the index after each tab, which puts
 * tabs in the wrong order when they move downward past each other (moving [A,B] before E
 * in ABCDE yields CADBE). Placing each tab immediately before the anchor, against a
 * simulated order, gives the intended result for any mix of directions.
 *
 * `order` is the target window's current order; tabs from other windows may appear in
 * `moved` and are simply inserted. A missing or moved anchor means "end of window".
 */
export function planMoves(
  order: readonly number[],
  moved: readonly number[],
  beforeTabId: number | null,
): SingleMove[] {
  const movedSet = new Set(moved);
  const anchor =
    beforeTabId !== null && !movedSet.has(beforeTabId) && order.includes(beforeTabId)
      ? beforeTabId
      : null;
  const unique = [...movedSet];
  const rest = order.filter((id) => !movedSet.has(id));
  const at = anchor === null ? rest.length : rest.indexOf(anchor);
  const desired = [...rest.slice(0, at), ...unique, ...rest.slice(at)];
  // A drop back onto its own position is common; don't issue moves that change nothing.
  if (desired.length === order.length && desired.every((id, i) => id === order[i])) return [];

  const sim = [...order];
  const out: SingleMove[] = [];
  for (const id of unique) {
    const from = sim.indexOf(id);
    if (from !== -1) sim.splice(from, 1);
    const to = anchor === null ? sim.length : sim.indexOf(anchor);
    sim.splice(to, 0, id);
    if (from !== to) out.push({ tabId: id, index: to });
  }
  return out;
}

/** Index of a group's first tab after moving the whole group before `beforeTabId`. */
export function planGroupMove(
  order: readonly number[],
  groupTabs: readonly number[],
  beforeTabId: number | null,
): number {
  const inGroup = new Set(groupTabs);
  const rest = order.filter((id) => !inGroup.has(id));
  const at = beforeTabId === null || inGroup.has(beforeTabId) ? -1 : rest.indexOf(beforeTabId);
  return at === -1 ? rest.length : at;
}
