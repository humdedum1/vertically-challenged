/**
 * Incognito and normal windows never mix in one panel: a panel sees only windows of its
 * own kind, so incognito tabs never reach a normal panel and vice versa.
 */
export const visibleTo = (panelIncognito: boolean, window: { incognito: boolean }): boolean =>
  window.incognito === panelIncognito;

/** `null` = the panel's kind isn't known yet; such a panel is shown nothing window-scoped. */
export const shouldDeliver = (
  sub: { incognito: boolean | null },
  scope: { incognito: boolean } | null,
): boolean => scope === null || (sub.incognito !== null && visibleTo(sub.incognito, scope));

export const visibleWindows = <W extends { incognito: boolean }>(
  panelIncognito: boolean | null,
  windows: readonly W[],
): W[] => (panelIncognito === null ? [] : windows.filter((w) => visibleTo(panelIncognito, w)));

/**
 * For each panel, the ids of windows that appear in `next` but not in `prev` and are
 * visible to it. Those windows need a snapshot: a panel that drops patches for windows it
 * hasn't been told about would otherwise miss the new window's first (full) patch.
 */
export const snapshotPlan = (
  prev: readonly { id: number }[],
  next: readonly { id: number; incognito: boolean }[],
  panels: readonly { incognito: boolean | null }[],
): number[][] => {
  const known = new Set(prev.map((w) => w.id));
  const fresh = next.filter((w) => !known.has(w.id));
  return panels.map((p) => visibleWindows(p.incognito, fresh).map((w) => w.id));
};

const TAB_KEYS = new Set(['tabId', 'tabIds', 'parentTabId', 'afterTabId', 'beforeTabId']);
const WINDOW_KEYS = new Set(['windowId', 'toWindowId', 'otherWindowId']);
const GROUP_KEYS = new Set(['groupId']);

/**
 * Whether a panel command names a tab or window of the other kind (or the panel's kind isn't
 * known yet). The port is extension-only; this keeps a panel bug from crossing the
 * incognito boundary. Ids the worker doesn't know pass: the browser call fails on them anyway.
 */
export function crossesKind(
  msg: object,
  panelIncognito: boolean | null,
  tabKind: (id: number) => boolean | undefined,
  windowKind: (id: number) => boolean | undefined,
  groupKind: (id: number) => boolean | undefined,
): boolean {
  if (panelIncognito === null) return true;
  const other = (kind: boolean | undefined): boolean =>
    kind !== undefined && kind !== panelIncognito;
  const walk = (o: object): boolean =>
    Object.entries(o).some(([k, v]) => {
      const ids =
        typeof v === 'number'
          ? [v]
          : Array.isArray(v)
            ? v.filter((x) => typeof x === 'number')
            : [];
      if (TAB_KEYS.has(k)) return ids.some((id) => other(tabKind(id)));
      if (WINDOW_KEYS.has(k)) return ids.some((id) => other(windowKind(id)));
      if (GROUP_KEYS.has(k)) return ids.some((id) => other(groupKind(id)));
      return v !== null && typeof v === 'object' && !Array.isArray(v) && walk(v);
    });
  return walk(msg);
}
