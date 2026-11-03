import { beforeEach, expect, it, vi } from 'vitest';
import { applyTabRule, ruleFor } from '../src/background/tab-rules';

const api = vi.hoisted(() => ({
  tabs: { group: vi.fn(), update: vi.fn() },
  tabGroups: { query: vi.fn(), update: vi.fn() },
}));
vi.mock('wxt/browser', () => ({ browser: api }));

const rules = [
  { host: 'github.com', path: '', action: 'group' as const, group: 'Code' },
  { host: '*.google.com', path: '', action: 'group' as const, group: 'Google' },
];
const tab = { id: 5, windowId: 1, url: 'https://gist.github.com/x', pinned: false, groupId: -1 };

beforeEach(() => {
  vi.resetAllMocks();
  api.tabs.group.mockResolvedValue(9);
});

it('matches hosts with the whitelist rules', () => {
  expect(ruleFor('https://github.com/a', rules)?.group).toBe('Code');
  expect(ruleFor('https://mail.google.com', rules)?.group).toBe('Google');
  expect(ruleFor('https://google.com', rules)).toBeUndefined();
  expect(ruleFor('chrome://settings', rules)).toBeUndefined();
});

it('joins the window group with the same title', async () => {
  api.tabGroups.query.mockResolvedValue([{ id: 3 }]);
  await applyTabRule(tab, rules);
  expect(api.tabGroups.query).toHaveBeenCalledWith({ windowId: 1, title: 'Code' });
  expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: 5, groupId: 3 });
  expect(api.tabGroups.update).not.toHaveBeenCalled();
});

it('creates and titles the group when the window has none', async () => {
  api.tabGroups.query.mockResolvedValue([]);
  await applyTabRule(tab, rules);
  expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: 5, createProperties: { windowId: 1 } });
  expect(api.tabGroups.update).toHaveBeenCalledWith(9, { title: 'Code' });
});

it('leaves pinned, grouped and unmatched tabs alone', async () => {
  await applyTabRule({ ...tab, pinned: true }, rules);
  await applyTabRule({ ...tab, groupId: 2 }, rules);
  await applyTabRule({ ...tab, url: 'https://example.com' }, rules);
  expect(api.tabGroups.query).not.toHaveBeenCalled();
});

it('matches path prefixes and applies pin and mute rules', async () => {
  const more = [
    { host: 'github.com', path: '/myorg', action: 'pin' as const, group: '' },
    { host: 'youtube.com', path: '', action: 'mute' as const, group: '' },
    ...rules,
  ];
  expect(ruleFor('https://github.com/myorg/repo', more)?.action).toBe('pin');
  expect(ruleFor('https://github.com/other', more)?.action).toBe('group');
  await applyTabRule({ ...tab, url: 'https://github.com/myorg/repo' }, more);
  expect(api.tabs.update).toHaveBeenCalledWith(5, { pinned: true });
  await applyTabRule({ ...tab, url: 'https://www.youtube.com/watch' }, more);
  expect(api.tabs.update).toHaveBeenCalledWith(5, { muted: true });
  api.tabs.update.mockClear();
  await applyTabRule({ ...tab, url: 'https://youtube.com/', mutedInfo: { muted: true } }, more);
  expect(api.tabs.update).not.toHaveBeenCalled();
});
