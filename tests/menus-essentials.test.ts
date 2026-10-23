import { describe, expect, it, vi } from 'vitest';
import type { PinItem } from '../src/shared/layout';
import type { PanelMessage } from '../src/shared/protocol';
import type { MenuItem } from '../src/sidepanel/components/menu-types';
import { awayFromHome, essentialMenu } from '../src/sidepanel/model/menus';
import { tab } from './helpers';

const item = (overrides: Partial<PinItem> = {}): PinItem => ({
  kind: 'item',
  id: 'iaaaaaaaaaa',
  homeUrl: 'https://mail.example.com/inbox',
  lastUrl: 'https://mail.example.com/inbox',
  title: 'Mail',
  tabId: 7,
  ...overrides,
});

type Entry = Extract<MenuItem, { type: 'item' }>;

function entries(items: MenuItem[]): Map<string, Entry> {
  return new Map(
    items.filter((m): m is Entry => m.type === 'item').map((m) => [m.label, m] as const),
  );
}

function menuFor(it: PinItem, live: ReturnType<typeof tab> | null, pinnedCount = 3) {
  const sent: PanelMessage[] = [];
  const send = vi.fn((m: PanelMessage) => sent.push(m));
  const items = entries(essentialMenu({ item: it, tab: live, windowId: 1, pinnedCount, send }));
  return { items, sent };
}

describe('awayFromHome', () => {
  it('ignores the hash', () => {
    expect(awayFromHome('https://a.com/x#inbox', 'https://a.com/x')).toBe(false);
    expect(awayFromHome('https://a.com/x#a', 'https://a.com/x#b')).toBe(false);
  });

  it('notices a different path or query', () => {
    expect(awayFromHome('https://a.com/y', 'https://a.com/x')).toBe(true);
    expect(awayFromHome('https://a.com/x?q=1', 'https://a.com/x')).toBe(true);
  });

  it('an empty URL (tab still committing) is not away', () => {
    expect(awayFromHome('', 'https://a.com/x')).toBe(false);
  });
});

describe('essentialMenu', () => {
  it('lists the actions in order', () => {
    const { items } = menuFor(item(), tab(7, { pinned: true }));
    expect([...items.keys()]).toEqual([
      'Open',
      'Reload',
      'Back to home URL',
      'Set this page as home',
      'Mute',
      'Suspend',
      'Remove from Essentials',
      'Unpin',
      'Close tab',
    ]);
  });

  it('home actions apply only once the tab has navigated away', () => {
    const atHome = menuFor(item(), tab(7, { url: 'https://mail.example.com/inbox#later' }));
    expect(atHome.items.get('Back to home URL')?.disabled).toBe(true);
    expect(atHome.items.get('Set this page as home')?.disabled).toBe(true);

    const away = menuFor(item(), tab(7, { url: 'https://mail.example.com/sent' }));
    expect(away.items.get('Back to home URL')?.disabled).toBe(false);
    away.items.get('Back to home URL')?.onselect();
    away.items.get('Set this page as home')?.onselect();
    expect(away.sent).toEqual([
      { type: 'pinHome', windowId: 1, itemId: 'iaaaaaaaaaa' },
      { type: 'pinSetHome', windowId: 1, itemId: 'iaaaaaaaaaa' },
    ]);
  });

  it('a dormant item can be opened, unpinned and re-homed from its last URL, nothing else', () => {
    const { items } = menuFor(
      item({ tabId: null, lastUrl: 'https://mail.example.com/sent' }),
      null,
    );
    expect(items.get('Open')?.disabled).toBeFalsy();
    expect(items.get('Back to home URL')?.disabled).toBe(true);
    expect(items.get('Set this page as home')?.disabled).toBe(false);
    expect(items.get('Reload')?.disabled).toBe(true);
    expect(items.get('Mute')?.disabled).toBe(true);
    expect(items.get('Suspend')?.disabled).toBe(true);
    expect(items.get('Unpin')?.disabled).toBeFalsy();
    expect(items.get('Close tab')?.disabled).toBe(true);
  });

  it('a discarded tab cannot be suspended again', () => {
    const { items } = menuFor(item(), tab(7, { discarded: true }));
    expect(items.get('Suspend')?.disabled).toBe(true);
  });

  it('sends the pin commands', () => {
    const { items, sent } = menuFor(item(), tab(7, { muted: true }), 4);
    expect(items.has('Unmute')).toBe(true);
    for (const label of [
      'Open',
      'Reload',
      'Unmute',
      'Suspend',
      'Remove from Essentials',
      'Unpin',
      'Close tab',
    ]) {
      items.get(label)?.onselect();
    }
    expect(sent).toEqual([
      { type: 'pinOpen', windowId: 1, itemId: 'iaaaaaaaaaa' },
      { type: 'reload', tabIds: [7] },
      { type: 'setMuted', tabIds: [7], muted: false },
      { type: 'pinClose', windowId: 1, itemIds: ['iaaaaaaaaaa'] },
      {
        type: 'pinMove',
        windowId: 1,
        nodeId: 'iaaaaaaaaaa',
        toWindowId: 1,
        dest: { zone: 'pinned', folderId: null, index: 4 },
      },
      { type: 'pinRemove', windowId: 1, itemId: 'iaaaaaaaaaa', mode: 'unpin' },
      { type: 'pinRemove', windowId: 1, itemId: 'iaaaaaaaaaa', mode: 'close' },
    ]);
  });
});
