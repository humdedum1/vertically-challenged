import { describe, expect, it, vi } from 'vitest';
import { FOLDER_ICONS, type PinFolder, type PinItem } from '../src/shared/layout';
import type { PanelMessage } from '../src/shared/protocol';
import type { MenuItem } from '../src/sidepanel/components/menu-types';
import {
  dividerMenu,
  folderMenu,
  pinMenu,
  tilesMenu,
  windowMenu,
} from '../src/sidepanel/model/menus';
import { tab } from './helpers';

type Entry = Extract<MenuItem, { type: 'item' }>;
type Sub = Extract<MenuItem, { type: 'submenu' }>;

const labels = (items: MenuItem[]) => items.map((m) => (m.type === 'separator' ? '—' : m.label));
const find = (items: MenuItem[], label: string): Entry => {
  const m = items.find((x) => x.type === 'item' && x.label === label);
  if (m?.type !== 'item') throw new Error(`no item ${label}`);
  return m;
};
const sub = (items: MenuItem[], label: string): Sub => {
  const m = items.find((x) => x.type === 'submenu' && x.label === label);
  if (m?.type !== 'submenu') throw new Error(`no submenu ${label}`);
  return m;
};

const item = (over: Partial<PinItem> = {}): PinItem => ({
  kind: 'item',
  id: 'iaaaaaaaaaa',
  homeUrl: 'https://mail.example.com/inbox',
  lastUrl: 'https://mail.example.com/inbox',
  title: 'Mail',
  tabId: 7,
  ...over,
});
const folder = (over: Partial<PinFolder> = {}): PinFolder => ({
  kind: 'folder',
  id: 'fbbbbbbbbbb',
  name: 'Work',
  icon: 'folder',
  collapsed: false,
  children: [item()],
  ...over,
});

function recorder() {
  const sent: PanelMessage[] = [];
  return { sent, send: vi.fn((m: PanelMessage) => sent.push(m)) };
}

describe('pinMenu', () => {
  const build = (
    it: PinItem,
    live: ReturnType<typeof tab> | null,
    depth = 2,
    tabs = live ? [live] : [],
  ) => {
    const r = recorder();
    const onNewFolder = vi.fn();
    const items = pinMenu({
      item: it,
      tab: live,
      tabs,
      windowId: 1,
      parentId: 'fparent0000',
      index: 2,
      depth,
      essentialsCount: 5,
      send: r.send,
      onNewFolder,
    });
    return { items, ...r, onNewFolder };
  };

  it('adds the selected range to Essentials and groups the clicked window', () => {
    const selected = [tab(7, { pinned: true }), tab(8, { pinned: true }), tab(9)];
    const { items, sent } = build(item(), selected[0] ?? null, 2, selected);
    find(items, 'Add to Essentials').onselect();
    find(items, 'Group tabs by website').onselect();
    expect(sent).toEqual([
      { type: 'pinTabs', tabIds: [7, 8, 9], windowId: 1, dest: { zone: 'essentials', index: 5 } },
      { type: 'autoGroup', windowId: 1 },
    ]);
  });

  it('lists the actions in order', () => {
    const { items } = build(item(), tab(7, { pinned: true }));
    expect(labels(items)).toEqual([
      'Open',
      'Reload',
      'Back to home URL',
      'Set this page as home',
      '—',
      'Mute',
      'Suspend',
      '—',
      'Add to Essentials',
      'Group tabs by website',
      'New folder',
      'Unpin',
      '—',
      'Close tab',
    ]);
    expect(find(items, 'Close tab').danger).toBe(true);
  });

  it('sends the pin commands with their payloads', () => {
    const { items, sent, onNewFolder } = build(
      item(),
      tab(7, { pinned: true, muted: true, url: 'https://mail.example.com/sent' }),
    );
    for (const l of [
      'Open',
      'Reload',
      'Back to home URL',
      'Set this page as home',
      'Unmute',
      'Suspend',
      'Add to Essentials',
      'New folder',
      'Unpin',
      'Close tab',
    ])
      find(items, l).onselect();
    const itemId = 'iaaaaaaaaaa';
    expect(sent).toEqual([
      { type: 'pinOpen', windowId: 1, itemId },
      { type: 'reload', tabIds: [7] },
      { type: 'pinHome', windowId: 1, itemId },
      { type: 'pinSetHome', windowId: 1, itemId },
      { type: 'setMuted', tabIds: [7], muted: false },
      { type: 'pinClose', windowId: 1, itemIds: [itemId] },
      {
        type: 'pinMove',
        windowId: 1,
        nodeId: itemId,
        toWindowId: 1,
        dest: { zone: 'essentials', index: 5 },
      },
      {
        type: 'folderCreate',
        windowId: 1,
        name: 'New folder',
        dest: { zone: 'pinned', folderId: 'fparent0000', index: 2 },
        itemIds: [itemId],
      },
      { type: 'pinRemove', windowId: 1, itemId, mode: 'unpin' },
      { type: 'pinRemove', windowId: 1, itemId, mode: 'close' },
    ]);
    expect(onNewFolder).toHaveBeenCalledTimes(1);
  });

  it('a dormant item: only open, re-home from its last URL, add to Essentials, folder, unpin', () => {
    const { items } = build(item({ tabId: null, lastUrl: 'https://mail.example.com/x' }), null);
    expect(find(items, 'Open').disabled).toBeFalsy();
    expect(find(items, 'Back to home URL').disabled).toBe(true);
    expect(find(items, 'Set this page as home').disabled).toBe(false);
    expect(find(items, 'Mute').disabled).toBe(true);
    expect(find(items, 'Suspend').disabled).toBe(true);
    expect(find(items, 'Add to Essentials').disabled).toBeFalsy();
    expect(find(items, 'New folder').disabled).toBeFalsy();
    expect(find(items, 'Unpin').disabled).toBeFalsy();
    expect(find(items, 'Close tab').disabled).toBe(true);
  });

  it('New folder is disabled inside a folder at the depth limit', () => {
    // depth 4 = inside a depth-3 folder, which can't hold folders.
    expect(find(build(item(), tab(7), 3).items, 'New folder').disabled).toBeFalsy();
    expect(find(build(item(), tab(7), 4).items, 'New folder').disabled).toBe(true);
  });
});

describe('folderMenu', () => {
  const build = (f: PinFolder, depth = 1) => {
    const r = recorder();
    const onRename = vi.fn();
    const onNewFolder = vi.fn();
    const items = folderMenu({
      folder: f,
      depth,
      windowId: 3,
      send: r.send,
      onRename,
      onNewFolder,
    });
    return { items, ...r, onRename, onNewFolder };
  };

  it('lists the actions in order', () => {
    expect(labels(build(folder()).items)).toEqual([
      'Rename',
      'Change icon',
      'New subfolder',
      '—',
      'Suspend all',
      '—',
      'Delete…',
    ]);
  });

  it('Change icon offers every folder icon and sends folderUpdate', () => {
    const { items, sent } = build(folder());
    const icons = sub(items, 'Change icon').items;
    expect(icons.map((m) => m.type === 'item' && m.icon)).toEqual([...FOLDER_ICONS]);
    const star = icons.find((m) => m.type === 'item' && m.icon === 'star');
    if (star?.type === 'item') star.onselect();
    expect(sent).toEqual([
      { type: 'folderUpdate', windowId: 3, folderId: 'fbbbbbbbbbb', icon: 'star' },
    ]);
  });

  it('Rename, New subfolder, Suspend all', () => {
    const { items, sent, onRename, onNewFolder } = build(folder({ children: [item(), item()] }));
    find(items, 'Rename').onselect();
    find(items, 'New subfolder').onselect();
    find(items, 'Suspend all').onselect();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onNewFolder).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      {
        type: 'folderCreate',
        windowId: 3,
        name: 'New folder',
        dest: { zone: 'pinned', folderId: 'fbbbbbbbbbb', index: 2 },
        itemIds: [],
      },
      { type: 'folderSuspend', windowId: 3, folderId: 'fbbbbbbbbbb' },
    ]);
  });

  it('New subfolder in a collapsed folder expands it first', () => {
    const { items, sent } = build(folder({ collapsed: true }));
    find(items, 'New subfolder').onselect();
    expect(sent.map((m) => m.type)).toEqual(['folderUpdate', 'folderCreate']);
    expect(sent[0]).toEqual({
      type: 'folderUpdate',
      windowId: 3,
      folderId: 'fbbbbbbbbbb',
      collapsed: false,
    });
  });

  it('New subfolder is disabled at depth 3', () => {
    expect(find(build(folder(), 2).items, 'New subfolder').disabled).toBeFalsy();
    expect(find(build(folder(), 3).items, 'New subfolder').disabled).toBe(true);
  });

  it('Delete… asks whether to keep the tabs', () => {
    const { items, sent } = build(folder());
    const choices = sub(items, 'Delete…').items;
    expect(labels(choices)).toEqual(['Keep tabs as pinned', 'Close tabs']);
    expect(find(choices, 'Close tabs').danger).toBe(true);
    find(choices, 'Keep tabs as pinned').onselect();
    find(choices, 'Close tabs').onselect();
    expect(sent).toEqual([
      { type: 'folderDelete', windowId: 3, folderId: 'fbbbbbbbbbb', keepTabs: true },
      { type: 'folderDelete', windowId: 3, folderId: 'fbbbbbbbbbb', keepTabs: false },
    ]);
  });
});

describe('dividerMenu', () => {
  it('New folder at the end of the pinned root; Clear only where shown', () => {
    const r = recorder();
    const onNewFolder = vi.fn();
    const items = dividerMenu({
      windowId: 1,
      pinnedCount: 4,
      clearable: 3,
      showClear: true,
      send: r.send,
      onNewFolder,
    });
    expect(labels(items)).toEqual(['Group tabs by website', 'New folder', '—', 'Clear 3 tabs']);
    find(items, 'New folder').onselect();
    find(items, 'Clear 3 tabs').onselect();
    expect(r.sent).toEqual([
      {
        type: 'folderCreate',
        windowId: 1,
        name: 'New folder',
        dest: { zone: 'pinned', folderId: null, index: 4 },
        itemIds: [],
      },
      { type: 'clearTabs', windowId: 1 },
    ]);
    expect(onNewFolder).toHaveBeenCalledTimes(1);
    find(items, 'Group tabs by website').onselect();
    expect(r.sent.at(-1)).toEqual({ type: 'autoGroup', windowId: 1 });

    const other = dividerMenu({
      windowId: 2,
      pinnedCount: 0,
      clearable: 3,
      showClear: false,
      send: r.send,
      onNewFolder,
    });
    expect(labels(other)).toEqual(['Group tabs by website', 'New folder']);
    const none = dividerMenu({
      windowId: 1,
      pinnedCount: 0,
      clearable: 0,
      showClear: true,
      send: r.send,
      onNewFolder,
    });
    expect(find(none, 'Clear tabs').disabled).toBe(true);
  });
});

describe('tilesMenu', () => {
  it('one Open entry per tile, sent to the tile window', () => {
    const r = recorder();
    const items = tilesMenu({
      windowId: 2,
      tiles: [
        { item: item({ id: 'ia000000000', title: 'Mail' }), tab: tab(7, { title: 'Inbox' }) },
        { item: item({ id: 'ib000000000', title: 'Music' }), tab: null },
      ],
      send: r.send,
    });
    expect(labels(items)).toEqual(['Open Inbox', 'Open Music']);
    find(items, 'Open Music').onselect();
    expect(r.sent).toEqual([{ type: 'pinOpen', windowId: 2, itemId: 'ib000000000' }]);
  });
});

describe('windowMenu', () => {
  it('starts with Rename', () => {
    const r = recorder();
    const onRename = vi.fn();
    const items = windowMenu({
      info: { id: 2, incognito: false, focused: false },
      tabs: [tab(1, { windowId: 2 })],
      send: r.send,
      onRename,
    });
    expect(labels(items)[0]).toBe('Rename');
    find(items, 'Rename').onselect();
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(r.sent).toEqual([]);
    find(items, 'Group tabs by website').onselect();
    expect(r.sent).toEqual([{ type: 'autoGroup', windowId: 2 }]);
  });
});
