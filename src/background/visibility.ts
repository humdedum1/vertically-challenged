/**
 * Incognito and normal windows never mix in one panel: a panel sees only windows of its
 * own kind, so incognito tabs never reach a normal panel and vice versa.
 */
export const visibleTo = (panelIncognito: boolean, window: { incognito: boolean }): boolean =>
  window.incognito === panelIncognito;
