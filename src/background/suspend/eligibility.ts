import type { SuspendSettings } from '../../settings/schema';
import { matchesHostPattern } from '../../shared/host-pattern';
import type { TabInfo } from '../../shared/types';

/** Why a tab is skipped; useful for tests and for explaining "why wasn't this suspended". */
export type SkipReason =
  | 'active'
  | 'discarded'
  | 'loading'
  | 'not-web'
  | 'pinned'
  | 'audible'
  | 'whitelisted'
  | 'recent'
  | 'unknown-age';

/**
 * Decides whether auto-suspend may discard a tab now. Only http(s) pages qualify: other
 * schemes are either cheap (extension and chrome:// pages) or can't be restored the same
 * way (file:// without access). Tabs never seen inactive have no age yet and are skipped
 * until the tracker has observed them.
 */
export function autoSuspendDecision(
  tab: TabInfo,
  lastActive: number | undefined,
  now: number,
  s: SuspendSettings,
): SkipReason | 'suspend' {
  if (tab.active) return 'active';
  if (tab.discarded) return 'discarded';
  if (tab.loading) return 'loading';
  if (!/^https?:/i.test(tab.url)) return 'not-web';
  if (s.skipPinned && tab.pinned) return 'pinned';
  if (s.skipAudible && tab.audible) return 'audible';
  if (matchesHostPattern(tab.url, s.whitelist)) return 'whitelisted';
  if (lastActive === undefined) return 'unknown-age';
  return now - lastActive >= s.minutes * 60_000 ? 'suspend' : 'recent';
}

/** Manual suspend ignores timers and the whitelist; Chrome can't discard an active tab. */
export const canDiscardManually = (tab: TabInfo): boolean => !tab.active && !tab.discarded;

/**
 * Whether auto-archive may save and close a tab: one not opened for `days`. Anything the
 * user would miss stays (active, pinned, playing, never-suspend list), and incognito tabs
 * are never archived because sessions don't store them, so closing would lose them.
 */
export function shouldArchive(
  tab: TabInfo,
  now: number,
  days: number,
  whitelist: readonly string[],
): boolean {
  if (days <= 0 || tab.active || tab.pinned || tab.audible || tab.incognito) return false;
  if (!/^https?:/i.test(tab.url) || matchesHostPattern(tab.url, whitelist)) return false;
  return tab.lastAccessed !== undefined && now - tab.lastAccessed >= days * 86_400_000;
}
