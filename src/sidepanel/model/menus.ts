import type { PanelMessage } from '../../shared/protocol';
import type { GroupInfo, TabInfo } from '../../shared/types';
import type { MenuItem } from '../components/menu-types';

export interface TabMenuContext {
  /** The tab the menu was opened on. */
  target: TabInfo;
  /** What actions apply to: the selection if the target is in it, else just the target. */
  tabs: TabInfo[];
  allTabs: readonly TabInfo[];
  groups: readonly GroupInfo[];
  windowId: number;
  send: (msg: PanelMessage) => void;
  /** Called after "Add to new group" so the UI can open the rename field once it appears. */
  onNewGroup: (tabIds: number[]) => void;
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

  const items: MenuItem[] = [
    {
      type: 'item',
      label: 'New tab below',
      onselect: () => c.send({ type: 'newTab', windowId: c.windowId, afterTabId: c.target.id }),
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
  windowId: number;
  send: (msg: PanelMessage) => void;
  onRename: () => void;
}

export function groupMenu(c: GroupMenuContext): MenuItem[] {
  const ids = c.tabs.filter((t) => t.groupId === c.group.id).map((t) => t.id);
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
      onselect: () => c.send({ type: 'newTab', windowId: c.windowId, afterTabId: lastId }),
    },
    {
      type: 'item',
      label: 'Ungroup',
      disabled: ids.length === 0,
      onselect: () => c.send({ type: 'ungroup', tabIds: ids }),
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
