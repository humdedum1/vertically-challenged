/**
 * Panel commands for sync: acting on another device's workspaces and sessions, forgetting a
 * device, renaming this one. Another device's document is re-read from sync storage, so a
 * command acts on what is published now, not on what the panel last showed.
 */

import type { SyncMessage } from '../../shared/protocol';
import { layoutFromSaved, type SyncDoc } from '../../shared/sync';
import { readSync } from '../../shared/sync-store';
import type { PinManager } from '../pins/pin-manager';
import type { SessionLayouts } from '../sessions';
import type { SyncPublisher } from './publisher';

export interface SyncCommandDeps {
  publisher: SyncPublisher;
  pins: PinManager;
  syncArea: { get(keys: null): Promise<Record<string, unknown>> };
  createWindow(): Promise<{ id?: number }>;
  restoreSession: (
    session: SyncDoc['sessions'][number],
    target: 'newWindow' | 'currentWindow',
    windowId: number,
    discard: boolean,
    layouts?: SessionLayouts,
  ) => Promise<string>;
  keepSession(session: SyncDoc['sessions'][number]): Promise<void>;
  restoreDiscarded(): Promise<boolean>;
}

const GONE = 'That device no longer shares it';

async function docOf(deps: SyncCommandDeps, deviceId: string): Promise<SyncDoc | null> {
  const me = await deps.publisher.device();
  if (deviceId === me.id) return null;
  const { docs } = await readSync(await deps.syncArea.get(null));
  return docs.find((d) => d.device.id === deviceId) ?? null;
}

/** Runs a sync command; returns a message for the panel's toast, or null. */
export async function runSyncCommand(
  msg: SyncMessage,
  deps: SyncCommandDeps,
): Promise<string | null> {
  switch (msg.type) {
    case 'syncWorkspace': {
      const ws = (await docOf(deps, msg.deviceId))?.workspaces.find(
        (w) => w.id === msg.workspaceId,
      );
      if (!ws) return GONE;
      await deps.pins.loaded;
      const ordinary = ws.window.tabs.filter((t) => !t.pinned);
      const snapshot = {
        id: ws.id,
        name: ws.name,
        createdAt: Date.now(),
        windows: [ws.window],
      };
      const restoreOrdinary = async (windowId: number): Promise<void> => {
        if (ordinary.length)
          await deps.restoreSession(
            { ...snapshot, windows: [{ tabs: ordinary, groups: ws.window.groups }] },
            'currentWindow',
            windowId,
            await deps.restoreDiscarded(),
            deps.pins,
          );
      };
      const setupId = await deps.pins.importSetup(layoutFromSaved(ws.window, ws.name));
      if (!setupId) return `“${ws.name}” has nothing that can be opened here`;
      if (msg.action === 'keep') {
        if (ordinary.length) await deps.keepSession(snapshot);
        return `Kept “${ws.name}” in Window setups${ordinary.length ? ' and Saved sessions' : ''}`;
      }
      if (msg.action === 'open') {
        const win = await deps.createWindow();
        if (win.id !== undefined) {
          await deps.pins.bindSetup(setupId, win.id);
          await restoreOrdinary(win.id);
        }
        return null;
      }
      const refused = await deps.pins.applySetup(setupId, msg.windowId);
      if (refused === null) {
        await restoreOrdinary(msg.windowId);
        return `Added “${ws.name}” to this window`;
      }
      // Not applied: don't leave the copy behind as a setup the user didn't ask for.
      await deps.pins.deleteSetup(setupId);
      return refused === 'full'
        ? 'This window has no room for all of those pinned tabs'
        : "Workspaces can't be added to an incognito window";
    }
    case 'syncSession': {
      const session = (await docOf(deps, msg.deviceId))?.sessions.find(
        (s) => s.id === msg.sessionId,
      );
      if (!session) return GONE;
      if (msg.action === 'keep') {
        await deps.keepSession(session);
        return `Kept “${session.name}” in Saved sessions`;
      }
      await deps.pins.loaded;
      return deps.restoreSession(
        session,
        msg.action,
        msg.windowId,
        await deps.restoreDiscarded(),
        deps.pins,
      );
    }
    case 'syncForget':
      await deps.publisher.forget(msg.deviceId);
      return null;
    case 'syncRename':
      await deps.publisher.rename(msg.name);
      return null;
    case 'syncNow':
      await deps.publisher.now();
      return null;
  }
}
