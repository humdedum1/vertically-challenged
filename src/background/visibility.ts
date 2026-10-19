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
