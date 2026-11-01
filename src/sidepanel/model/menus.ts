import { hostOf, matchesHostPattern } from '../../shared/host-pattern';
import {
  FOLDER_ICONS,
  MAX_FOLDER_DEPTH,
  type PinFolder,
  type PinItem,
  type PinNode,
} from '../../shared/layout';
import type { PanelMessage } from '../../shared/protocol';
import type { GroupInfo, TabInfo, WindowInfo } from '../../shared/types';
import type { MenuItem } from '../components/menu-types';

export interface TabMenuContext {
  /** The tab the menu was opened on. */
  target: TabInfo;
  /** What actions apply to: the selection if the target is in it, else just the target. */
  tabs: TabInfo[];
  allTabs: readonly TabInfo[];
  essentialsCount: number;
  pinned: readonly PinNode[];
  groups: readonly GroupInfo[];
  send: (msg: PanelMessage) => void;
  /** Called after "Add to new group" so the UI can open the rename field once it appears. */
  onNewGroup: (tabIds: number[]) => void;
  /** All normal windows (for "Move to window"), and the one this panel lives in. */
  windows: readonly WindowInfo[];
  homeWindowId: number | null;
  /** Current never-auto-suspend host patterns. */
  whitelist: readonly string[];
  onWhitelist: (host: string, add: boolean) => void;
}

/** Display order shared by the tree and the menus: home window first, then by id. */
export function orderedWindows(
  windows: readonly WindowInfo[],
  homeId: number | null,
): WindowInfo[] {
  return [...windows].sort((a, b) => (a.id === homeId ? -1 : b.id === homeId ? 1 : a.id - b.id));
}

export function windowLabel(number: number, isHome: boolean): string {
  return isHome ? 'This window' : `Window ${number}`;
}

const SEP: MenuItem = { type: 'separator' };

export function tabMenu(c: TabMenuContext): MenuItem[] {
  const ids = c.tabs.map((t) => t.id);
  const allPinned = c.tabs.every((t) => t.pinned);
  const allMuted = c.tabs.every((t) => t.muted);
  const anyGrouped = c.tabs.some((t) => t.groupId !== -1);
  const last = c.allTabs[c.allTabs.length - 1];
  const newGroup = () => {
    c.onNewGroup(ids);
    c.send({ type: 'group', tabIds: ids, groupId: null });
  };
  const n = ids.length;
  const plural = n > 1 ? ` (${n})` : '';
  const suspendable = c.tabs.filter((t) => !t.discarded).map((t) => t.id);
  const host = hostOf(c.target.url);
  const listed = host !== null && c.whitelist.includes(host);
  const covered = host !== null && !listed && matchesHostPattern(c.target.url, c.whitelist);
  const moveTargets = orderedWindows(c.windows, c.homeWindowId)
    .map((w, i) => ({ w, number: i + 1 }))
    .filter(({ w }) => w.id !== c.target.windowId && w.incognito === c.target.incognito);
  const moveTo = (windowId: number) =>
    c.send({
      type: 'move',
      tabIds: ids,
      target: { windowId, beforeTabId: null, groupId: -1, pinned: null },
    });

  const folders: MenuItem[] = [];
  const visitFolders = (nodes: readonly PinNode[], path = ''): void => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      const label = path ? `${path} / ${node.name}` : node.name;
      folders.push({
        type: 'item',
        label,
        icon: node.icon,
        onselect: () =>
          c.send({
            type: 'pinTabs',
            tabIds: ids,
            windowId: c.target.windowId,
            dest: { zone: 'pinned', folderId: node.id, index: node.children.length },
          }),
      });
      visitFolders(node.children, label);
    }
  };
  visitFolders(c.pinned);
  const items: MenuItem[] = [
    {
      type: 'item',
      label: 'New tab below',
      onselect: () =>
        c.send({ type: 'newTab', windowId: c.target.windowId, afterTabId: c.target.id }),
    },
    {
      type: 'item',
      label: `Reload${plural}`,
      onselect: () => c.send({ type: 'reload', tabIds: ids }),
    },
    {
      type: 'item',
      label: `Duplicate${plural}`,
      onselect: () => {
        for (const id of ids) c.send({ type: 'duplicate', tabId: id });
      },
    },
    {
      type: 'item',
      label: allPinned ? `Unpin${plural}` : `Pin${plural}`,
      onselect: () => c.send({ type: 'setPinned', tabIds: ids, pinned: !allPinned }),
    },
    {
      type: 'item',
      label: allMuted ? `Unmute${plural}` : `Mute${plural}`,
      onselect: () => c.send({ type: 'setMuted', tabIds: ids, muted: !allMuted }),
    },
    SEP,
    {
      type: 'item',
      label: 'Add to Staples',
      onselect: () =>
        c.send({
          type: 'pinTabs',
          tabIds: ids,
          windowId: c.target.windowId,
          dest: { zone: 'essentials', index: c.essentialsCount },
        }),
    },
    ...(folders.length
      ? [{ type: 'submenu' as const, label: 'Pin to folder', items: folders }]
      : []),
    {
      type: 'item',
      label: 'Group tabs by website',
      onselect: () => c.send({ type: 'autoGroup', windowId: c.target.windowId }),
    },
    { type: 'item', label: 'Add to new group', onselect: newGroup },
    {
      type: 'submenu',
      label: 'Move to group',
      items: [
        ...c.groups.map<MenuItem>((g) => ({
          type: 'item',
          label: g.title || 'Unnamed group',
          dot: `var(--g-${g.color})`,
          onselect: () => c.send({ type: 'group', tabIds: ids, groupId: g.id }),
        })),
        ...(c.groups.length ? [SEP] : []),
        { type: 'item', label: 'New group', onselect: newGroup },
      ],
    },
  ];
  if (anyGrouped) {
    items.push({
      type: 'item',
      label: 'Remove from group',
      onselect: () => c.send({ type: 'ungroup', tabIds: ids }),
    });
  }
  items.push(
    {
      type: 'submenu',
      label: 'Move to window',
      items: [
        ...moveTargets.map<MenuItem>(({ w, number }) => ({
          type: 'item',
          label: windowLabel(number, w.id === c.homeWindowId),
          onselect: () => moveTo(w.id),
        })),
        ...(moveTargets.length ? [SEP] : []),
        {
          type: 'item',
          label: 'New window',
          onselect: () => c.send({ type: 'moveToNewWindow', tabIds: ids }),
        },
      ],
    },
    SEP,
    {
      type: 'item',
      label: `Suspend${suspendable.length > 1 ? ` (${suspendable.length})` : ''}`,
      disabled: suspendable.length === 0,
      onselect: () => c.send({ type: 'discard', tabIds: suspendable }),
    },
    {
      type: 'item',
      label: 'Suspend other tabs',
      disabled: c.allTabs.length < 2,
      onselect: () => c.send({ type: 'discardOthers', tabId: c.target.id }),
    },
    {
      type: 'item',
      label: listed
        ? 'Auto-suspend allowed for this site'
        : covered
          ? 'Site is in the never-suspend list'
          : 'Never auto-suspend this site',
      disabled: host === null || covered,
      onselect: () => {
        if (host !== null) c.onWhitelist(host, !listed);
      },
    },
    SEP,
    {
      type: 'item',
      label: `Close${plural}`,
      danger: true,
      onselect: () => c.send({ type: 'close', tabIds: ids }),
    },
    {
      type: 'item',
      label: 'Close other tabs',
      disabled: c.allTabs.length < 2,
      onselect: () => c.send({ type: 'closeOthers', tabId: c.target.id }),
    },
    {
      type: 'item',
      label: 'Close tabs below',
      disabled: last === undefined || last.id === c.target.id,
      onselect: () => c.send({ type: 'closeBelow', tabId: c.target.id }),
    },
  );
  return items;
}

export interface GroupMenuContext {
  group: GroupInfo;
  tabs: readonly TabInfo[];
  send: (msg: PanelMessage) => void;
  onRename: () => void;
}

export function groupMenu(c: GroupMenuContext): MenuItem[] {
  const ids = c.tabs.filter((t) => t.groupId === c.group.id).map((t) => t.id);
  const suspendable = c.tabs
    .filter((t) => t.groupId === c.group.id && !t.discarded)
    .map((t) => t.id);
  const lastId = ids[ids.length - 1] ?? null;
  return [
    { type: 'item', label: 'Rename', onselect: c.onRename },
    {
      type: 'colors',
      label: 'Colour',
      value: c.group.color,
      onpick: (color) => c.send({ type: 'updateGroup', groupId: c.group.id, color }),
    },
    {
      type: 'item',
      label: c.group.collapsed ? 'Expand' : 'Collapse',
      onselect: () =>
        c.send({ type: 'updateGroup', groupId: c.group.id, collapsed: !c.group.collapsed }),
    },
    {
      type: 'item',
      label: 'New tab in group',
      onselect: () => c.send({ type: 'newTab', windowId: c.group.windowId, afterTabId: lastId }),
    },
    {
      type: 'item',
      label: 'Ungroup',
      disabled: ids.length === 0,
      onselect: () => c.send({ type: 'ungroup', tabIds: ids }),
    },
    {
      type: 'item',
      label: 'Suspend all',
      disabled: suspendable.length === 0,
      onselect: () => c.send({ type: 'discard', tabIds: suspendable }),
    },
    SEP,
    {
      type: 'item',
      label: 'Close group',
      danger: true,
      onselect: () => c.send({ type: 'closeGroup', groupId: c.group.id }),
    },
  ];
}

export interface WindowMenuContext {
  info: WindowInfo;
  /** Every tab of the window. */
  tabs: readonly TabInfo[];
  send: (msg: PanelMessage) => void;
  /** Opens the inline name field on the header. */
  onRename: () => void;
}

export function windowMenu(c: WindowMenuContext): MenuItem[] {
  const ids = c.tabs.map((t) => t.id);
  const target = c.tabs.find((t) => t.active) ?? c.tabs[0];
  const closeAll = (): void => c.send({ type: 'close', tabIds: ids });
  return [
    { type: 'item', label: 'Rename', onselect: c.onRename },
    {
      type: 'item',
      label: 'Group tabs by website',
      onselect: () => c.send({ type: 'autoGroup', windowId: c.info.id }),
    },
    {
      type: 'item',
      label: 'Switch to window',
      disabled: target === undefined,
      onselect: () => {
        if (target) c.send({ type: 'activate', tabId: target.id });
      },
    },
    {
      type: 'item',
      label: 'New tab in window',
      onselect: () => c.send({ type: 'newTab', windowId: c.info.id, afterTabId: null }),
    },
    SEP,
    // Closing many tabs at once can't be undone with one click, so ask first (inside a
    // submenu, which needs no extra menu machinery).
    ids.length > 1
      ? {
          type: 'submenu',
          label: 'Close window…',
          items: [
            {
              type: 'item',
              label: `Confirm: close ${ids.length} tabs`,
              danger: true,
              onselect: closeAll,
            },
          ],
        }
      : {
          type: 'item',
          label: 'Close window',
          danger: true,
          disabled: ids.length === 0,
          onselect: closeAll,
        },
  ];
}

/**
 * Whether a pinned tab has left its home page. The hash is ignored: single-page apps
 * (mail, chat) rewrite it constantly without the user going anywhere. An empty URL is a
 * tab that hasn't committed yet, not one that navigated away.
 */
export function awayFromHome(url: string, homeUrl: string): boolean {
  if (!url) return false;
  const strip = (u: string): string => u.split('#', 1)[0] ?? u;
  return strip(url) !== strip(homeUrl);
}

export interface EssentialMenuContext {
  item: PinItem;
  /** The live tab, or null while the item is dormant. */
  tab: TabInfo | null;
  windowId: number;
  /** Root nodes of the window's pinned tree: "Remove from Staples" lands after them. */
  pinnedCount: number;
  send: (msg: PanelMessage) => void;
}

/**
 * The entries Staples and pinned rows share: both are launchers with a home URL, and
 * closing either only suspends it.
 */
function launcherItems(c: {
  item: PinItem;
  tab: TabInfo | null;
  windowId: number;
  send: (msg: PanelMessage) => void;
}): MenuItem[] {
  const { item, tab, windowId } = c;
  const itemId = item.id;
  // Mirrors pinSetHome in the worker: the live URL, else where the item was last.
  const current = tab?.url ?? item.lastUrl;
  return [
    { type: 'item', label: 'Open', onselect: () => c.send({ type: 'pinOpen', windowId, itemId }) },
    {
      type: 'item',
      label: 'Reload',
      disabled: tab === null,
      onselect: () => {
        if (tab) c.send({ type: 'reload', tabIds: [tab.id] });
      },
    },
    {
      type: 'item',
      label: 'Back to home URL',
      // A dormant item reopens at its home URL anyway.
      disabled: tab === null || !awayFromHome(tab.url, item.homeUrl),
      onselect: () => c.send({ type: 'pinHome', windowId, itemId }),
    },
    {
      type: 'item',
      label: 'Set this page as home',
      disabled: !awayFromHome(current, item.homeUrl),
      onselect: () => c.send({ type: 'pinSetHome', windowId, itemId }),
    },
    SEP,
    {
      type: 'item',
      label: tab?.muted ? 'Unmute' : 'Mute',
      disabled: tab === null,
      onselect: () => {
        if (tab) c.send({ type: 'setMuted', tabIds: [tab.id], muted: !tab.muted });
      },
    },
    {
      type: 'item',
      label: 'Suspend',
      disabled: tab === null || tab.discarded,
      onselect: () => c.send({ type: 'pinClose', windowId, itemIds: [itemId] }),
    },
  ];
}

export function essentialMenu(c: EssentialMenuContext): MenuItem[] {
  const { item, tab, windowId } = c;
  const itemId = item.id;
  return [
    ...launcherItems(c),
    SEP,
    {
      type: 'item',
      label: 'Remove from Staples',
      onselect: () =>
        c.send({
          type: 'pinMove',
          windowId,
          nodeId: itemId,
          toWindowId: windowId,
          dest: { zone: 'pinned', folderId: null, index: c.pinnedCount },
        }),
    },
    {
      type: 'item',
      label: 'Unpin',
      onselect: () => c.send({ type: 'pinRemove', windowId, itemId, mode: 'unpin' }),
    },
    SEP,
    {
      type: 'item',
      label: 'Close tab',
      danger: true,
      // Closing for real (tile and tab); the close button and shortcut only suspend.
      disabled: tab === null,
      onselect: () => c.send({ type: 'pinRemove', windowId, itemId, mode: 'close' }),
    },
  ];
}

export interface PinMenuContext {
  item: PinItem;
  /** The live tab, or null while the item is dormant. */
  tab: TabInfo | null;
  /** Selection when it contains the clicked tab, otherwise just the clicked tab. */
  tabs: readonly TabInfo[];
  windowId: number;
  /** Where the item sits, so "New folder" can take its place. */
  parentId: string | null;
  index: number;
  /** 1 at the pinned root, +1 per enclosing folder. */
  depth: number;
  /** "Add to Staples" appends to the grid. */
  essentialsCount: number;
  send: (msg: PanelMessage) => void;
  /** Called after "New folder" so the UI can open the name field once the folder appears. */
  onNewFolder: () => void;
}

const NEW_FOLDER = 'New folder';

export function pinMenu(c: PinMenuContext): MenuItem[] {
  const { item, tab, windowId } = c;
  const itemId = item.id;
  return [
    ...launcherItems(c),
    SEP,
    {
      type: 'item',
      label: 'Add to Staples',
      onselect: () => {
        if (tab && c.tabs.length > 1) {
          c.send({
            type: 'pinTabs',
            tabIds: c.tabs.map((t) => t.id),
            windowId,
            dest: { zone: 'essentials', index: c.essentialsCount },
          });
          return;
        }
        c.send({
          type: 'pinMove',
          windowId,
          nodeId: itemId,
          toWindowId: windowId,
          dest: { zone: 'essentials', index: c.essentialsCount },
        });
      },
    },
    {
      type: 'item',
      label: 'Group tabs by website',
      onselect: () => c.send({ type: 'autoGroup', windowId }),
    },
    {
      type: 'item',
      label: 'New folder',
      // The folder takes the item's place, one level below its parent: past the depth
      // limit (inside a depth-3 folder) there is no room for another folder.
      disabled: c.depth > MAX_FOLDER_DEPTH,
      onselect: () => {
        c.onNewFolder();
        c.send({
          type: 'folderCreate',
          windowId,
          name: NEW_FOLDER,
          dest: { zone: 'pinned', folderId: c.parentId, index: c.index },
          itemIds: [itemId],
        });
      },
    },
    {
      type: 'item',
      label: 'Unpin',
      onselect: () => c.send({ type: 'pinRemove', windowId, itemId, mode: 'unpin' }),
    },
    SEP,
    {
      type: 'item',
      label: 'Close tab',
      danger: true,
      disabled: tab === null,
      onselect: () => c.send({ type: 'pinRemove', windowId, itemId, mode: 'close' }),
    },
  ];
}

export interface FolderMenuContext {
  folder: PinFolder;
  /** 1 at the pinned root, +1 per enclosing folder. */
  depth: number;
  windowId: number;
  send: (msg: PanelMessage) => void;
  onRename: () => void;
  onNewFolder: () => void;
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function folderMenu(c: FolderMenuContext): MenuItem[] {
  const { folder, windowId } = c;
  const folderId = folder.id;
  return [
    { type: 'item', label: 'Rename', onselect: c.onRename },
    {
      type: 'submenu',
      label: 'Change icon',
      items: FOLDER_ICONS.map<MenuItem>((icon) => ({
        type: 'item',
        label: capitalize(icon),
        icon,
        onselect: () => c.send({ type: 'folderUpdate', windowId, folderId, icon }),
      })),
    },
    {
      type: 'item',
      label: 'New subfolder',
      disabled: c.depth >= MAX_FOLDER_DEPTH,
      onselect: () => {
        // Inside a collapsed folder the new one would be hidden, and so would its name field.
        if (folder.collapsed)
          c.send({ type: 'folderUpdate', windowId, folderId, collapsed: false });
        c.onNewFolder();
        c.send({
          type: 'folderCreate',
          windowId,
          name: NEW_FOLDER,
          dest: { zone: 'pinned', folderId, index: folder.children.length },
          itemIds: [],
        });
      },
    },
    SEP,
    {
      type: 'item',
      label: 'Suspend all',
      onselect: () => c.send({ type: 'folderSuspend', windowId, folderId }),
    },
    SEP,
    // Deleting can close tabs, so the choice is a step of its own (like "Close window…").
    {
      type: 'submenu',
      label: 'Delete…',
      items: [
        {
          type: 'item',
          label: 'Keep tabs as pinned',
          onselect: () => c.send({ type: 'folderDelete', windowId, folderId, keepTabs: true }),
        },
        {
          type: 'item',
          label: 'Close tabs',
          danger: true,
          onselect: () => c.send({ type: 'folderDelete', windowId, folderId, keepTabs: false }),
        },
      ],
    },
  ];
}

export interface DividerMenuContext {
  windowId: number;
  /** Root nodes of the pinned tree: "New folder" lands after them. */
  pinnedCount: number;
  clearable: number;
  /** Clear is offered on the panel's own window only. */
  showClear: boolean;
  send: (msg: PanelMessage) => void;
  onNewFolder: () => void;
}

export function dividerMenu(c: DividerMenuContext): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item',
      label: 'Group tabs by website',
      onselect: () => c.send({ type: 'autoGroup', windowId: c.windowId }),
    },
    {
      type: 'item',
      label: 'New folder',
      onselect: () => {
        c.onNewFolder();
        c.send({
          type: 'folderCreate',
          windowId: c.windowId,
          name: NEW_FOLDER,
          dest: { zone: 'pinned', folderId: null, index: c.pinnedCount },
          itemIds: [],
        });
      },
    },
  ];
  if (c.showClear) {
    items.push(SEP, {
      type: 'item',
      label:
        c.clearable > 0
          ? `Clear ${c.clearable} ${c.clearable === 1 ? 'tab' : 'tabs'}`
          : 'Clear tabs',
      disabled: c.clearable === 0,
      onselect: () => c.send({ type: 'clearTabs', windowId: c.windowId }),
    });
  }
  return items;
}

export interface TilesMenuContext {
  windowId: number;
  tiles: readonly { item: PinItem; tab: TabInfo | null }[];
  send: (msg: PanelMessage) => void;
}

/** Keyboard route to another window's mini Staples: one entry per tile. */
export function tilesMenu(c: TilesMenuContext): MenuItem[] {
  return c.tiles.map(({ item, tab }) => ({
    type: 'item',
    label: `Open ${tab?.title || item.title || item.homeUrl}`,
    onselect: () => c.send({ type: 'pinOpen', windowId: c.windowId, itemId: item.id }),
  }));
}
