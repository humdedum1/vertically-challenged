import type { TabInfo } from '../../shared/types';
import { relativeTime } from '../panels/sessions/relative-time';

/**
 * The hover text of a tab row: its name, address, and what is useful to know before acting on
 * it (suspended, playing, last used). Native tooltips keep this accessible and cost nothing.
 */
export function tabTooltip(label: string, tab: TabInfo, now: number): string {
  const facts: string[] = [];
  if (tab.active) facts.push('Current tab');
  else if (tab.lastAccessed) facts.push(`Last used ${relativeTime(tab.lastAccessed, now)}`);
  if (tab.discarded) facts.push('Suspended');
  if (tab.audible) facts.push(tab.muted ? 'Playing audio (muted)' : 'Playing audio');
  else if (tab.muted) facts.push('Muted');
  if (tab.pinned) facts.push('Pinned');
  return [label, tab.url, facts.join(' · ')].filter(Boolean).join('\n');
}
