export interface MruTab {
  id?: number;
  lastAccessed?: number;
}

/**
 * Most-recently-used tab cycling (Vivaldi-style Ctrl+Tab). Chrome's tabs already carry
 * lastAccessed, so nothing is tracked; the order is snapshotted when a cycle starts, because
 * each activation during the cycle updates lastAccessed. Presses within `windowMs` of each
 * other continue the same cycle; a pause commits the tab reached.
 */
export function createMruCycle(windowMs = 1200) {
  let cycle: { windowId: number; order: number[]; pos: number; at: number } | null = null;
  return {
    /** The tab to activate for one press; `step` -1 walks the cycle back. */
    next(windowId: number, tabs: readonly MruTab[], now: number, step = 1): number | undefined {
      if (!cycle || cycle.windowId !== windowId || now - cycle.at > windowMs) {
        const order = tabs
          .filter((t): t is MruTab & { id: number } => t.id !== undefined)
          .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
          .map((t) => t.id);
        cycle = { windowId, order, pos: 0, at: now };
      }
      const n = cycle.order.length;
      if (n < 2) return undefined;
      cycle.pos = (((cycle.pos + step) % n) + n) % n;
      cycle.at = now;
      return cycle.order[cycle.pos];
    },
  };
}
