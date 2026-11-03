import { describe, expect, it } from 'vitest';
import type { TabInfo } from '../src/shared/types';
import { tabTooltip } from '../src/sidepanel/model/tab-tooltip';

const tab = (over: Partial<TabInfo> = {}): TabInfo => ({
  id: 1,
  windowId: 1,
  title: 'T',
  url: 'https://a.example/x',
  pinned: false,
  active: false,
  audible: false,
  muted: false,
  discarded: false,
  loading: false,
  groupId: -1,
  incognito: false,
  ...over,
});
const NOW = 10 * 86_400_000;

describe('tabTooltip', () => {
  it('shows name, address and when the tab was last used', () => {
    expect(tabTooltip('Title', tab({ lastAccessed: NOW - 3 * 86_400_000 }), NOW)).toBe(
      'Title\nhttps://a.example/x\nLast used 3 days ago',
    );
  });
  it('lists suspended, audio and pinned state, and calls the current tab current', () => {
    const t = tabTooltip(
      'T',
      tab({ active: true, discarded: true, audible: true, muted: true, pinned: true }),
      NOW,
    );
    expect(t).toContain('Current tab · Suspended · Playing audio (muted) · Pinned');
    expect(t).not.toContain('Last used');
  });
  it('leaves out empty parts', () => {
    expect(tabTooltip('Only', tab({ url: '' }), NOW)).toBe('Only');
  });
});
