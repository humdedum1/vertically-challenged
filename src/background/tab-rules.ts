import { browser } from 'wxt/browser';
import type { TabRule } from '../settings/schema';
import { matchesHostPattern } from '../shared/host-pattern';

/** The first rule whose host pattern and (if set) path prefix match the URL. */
export function ruleFor(url: string, rules: readonly TabRule[]): TabRule | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  return rules.find(
    (r) => matchesHostPattern(url, [r.host]) && (r.path === '' || path.startsWith(r.path)),
  );
}

/**
 * Applies the rule matching a tab that just navigated: pin, mute, or put it in the window's
 * group with the rule's title (created if missing). Already pinned/grouped/muted tabs are
 * left alone, so undoing a rule by hand sticks until the tab navigates elsewhere.
 */
export async function applyTabRule(
  tab: {
    id?: number;
    windowId: number;
    url?: string;
    pinned: boolean;
    groupId: number;
    mutedInfo?: { muted: boolean };
  },
  rules: readonly TabRule[],
): Promise<void> {
  if (tab.id === undefined || !tab.url) return;
  const rule = ruleFor(tab.url, rules);
  if (!rule) return;
  if (rule.action === 'pin') {
    if (!tab.pinned) await browser.tabs.update(tab.id, { pinned: true });
    return;
  }
  if (rule.action === 'mute') {
    if (!tab.mutedInfo?.muted) await browser.tabs.update(tab.id, { muted: true });
    return;
  }
  if (tab.pinned || tab.groupId !== -1) return;
  const [existing] = await browser.tabGroups.query({ windowId: tab.windowId, title: rule.group });
  if (existing) {
    await browser.tabs.group({ tabIds: tab.id, groupId: existing.id });
    return;
  }
  const groupId = await browser.tabs.group({
    tabIds: tab.id,
    createProperties: { windowId: tab.windowId },
  });
  await browser.tabGroups.update(groupId, { title: rule.group });
}
