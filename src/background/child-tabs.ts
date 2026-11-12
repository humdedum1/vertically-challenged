import { type Browser, browser } from 'wxt/browser';
import { migrateSettings } from '../settings/migrate';

/** Keep newly opened links in a contiguous branch even with "new tabs at end" enabled. */
export async function placeChildTab(
  tab: Pick<Browser.tabs.Tab, 'id' | 'windowId' | 'openerTabId' | 'pinned'>,
): Promise<void> {
  if (tab.id === undefined || tab.pinned) return;
  const settings = migrateSettings((await browser.storage.sync.get('settings')).settings);
  if (!settings.tabs.childTabs) return;
  const tabs = (await browser.tabs.query({ windowId: tab.windowId })).sort(
    (a, b) => a.index - b.index,
  );
  const child = tabs.find((t) => t.id === tab.id);
  // Chrome's onCreated omits the opener of tabs.create({ openerTabId }); the query has it.
  const openerId = tab.openerTabId ?? child?.openerTabId;
  if (openerId === undefined) return;
  const parent = tabs.find((t) => t.id === openerId);
  if (
    !parent ||
    !child ||
    parent.pinned ||
    child.pinned ||
    parent.groupId !== child.groupId ||
    !/^https?:/i.test(parent.url ?? '')
  )
    return;
  const branch = new Set([parent.id]);
  let end = parent.index;
  for (const item of tabs.slice(parent.index + 1)) {
    if (item.id === child.id) continue;
    if (item.groupId !== parent.groupId || !branch.has(item.openerTabId)) break;
    branch.add(item.id);
    end = item.index;
  }
  if (child.index > parent.index && child.index <= end + 1) return;
  await browser.tabs.move(tab.id, { index: end + (child.index < end ? 0 : 1) });
}
