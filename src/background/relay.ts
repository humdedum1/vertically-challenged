import { browser } from 'wxt/browser';
import { RELAY_METHODS, type RelayMethod, type RelayResponse } from '../shared/relay';
import { parseSurface, popupTokenOk } from '../shared/surface';

export interface RelaySender {
  tab?: { windowId: number; incognito: boolean };
  frameId?: number;
  url?: string;
}

type Plan = { method: RelayMethod; args: unknown[] };
type Rec = Record<string, unknown>;

const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (o: Rec, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));

/** Validates a relay request and pins it to the sender's window. Pure. */
export function planRelay(
  raw: unknown,
  sender: RelaySender,
  storedToken: unknown,
): Plan | { error: string } {
  const refuse = (error: string) => ({ error });
  if (!sender.tab || sender.tab.incognito) return refuse('Relay refused: no normal tab');
  if (typeof sender.frameId !== 'number' || sender.frameId <= 0)
    return refuse('Relay refused: not a framed page');
  let search: string;
  try {
    search = new URL(sender.url ?? '').search;
  } catch {
    return refuse('Relay refused: bad sender');
  }
  if (parseSurface(search).surface !== 'popup' || !popupTokenOk(search, storedToken))
    return refuse('Relay refused: not the popup');

  const req = raw as { method?: unknown; args?: unknown } | null;
  const method = req?.method as RelayMethod;
  if (!RELAY_METHODS.includes(method)) return refuse('Relay refused: unknown method');
  const args = req?.args;
  if (!Array.isArray(args)) return refuse('Relay refused: bad args');
  const win = sender.tab.windowId;
  const o = args[0];

  switch (method) {
    case 'tabs.create':
    case 'tabs.query': {
      if (!isObj(o)) return refuse('Relay refused: bad options');
      if (
        !onlyKeys(
          o,
          method === 'tabs.create' ? ['url', 'active', 'windowId'] : ['active', 'windowId'],
        )
      )
        return refuse('Relay refused: unexpected option');
      if (o.windowId !== undefined && o.windowId !== win)
        return refuse('Relay refused: other window');
      return { method, args: [{ ...o, windowId: win }] };
    }
    case 'tabs.update': {
      if (typeof o !== 'number' || !isObj(args[1]) || !onlyKeys(args[1], ['url', 'active']))
        return refuse('Relay refused: bad update');
      return { method, args: [o, args[1]] };
    }
    case 'windows.create': {
      if (!isObj(o) || !onlyKeys(o, ['url', 'focused']))
        return refuse('Relay refused: bad options');
      const { url } = o;
      if (
        url !== undefined &&
        typeof url !== 'string' &&
        !(Array.isArray(url) && url.every((u) => typeof u === 'string'))
      )
        return refuse('Relay refused: bad url');
      return { method, args: [{ ...o, incognito: false }] };
    }
    case 'sessions.restore':
      if (typeof o !== 'string' || o === '') return refuse('Relay refused: session id required');
      return { method, args: [o] };
    default:
      return { method, args };
  }
}

interface SessionEntry {
  tab?: { sessionId?: string; incognito?: boolean };
  window?: { sessionId?: string; incognito?: boolean };
}
const isPrivate = (e: SessionEntry | undefined) => !!(e?.tab?.incognito || e?.window?.incognito);

export async function runRelay(plan: Plan, senderWindowId: number): Promise<RelayResponse> {
  try {
    const { method, args } = plan;
    // biome-ignore lint/suspicious/noExplicitAny: dynamic dispatch over a fixed allowlist
    const b = browser as any;
    switch (method) {
      case 'windows.getCurrent':
        return { ok: true, value: await b.windows.get(senderWindowId) };
      case 'tabs.update': {
        const t = await b.tabs.get(args[0]);
        if (t.windowId !== senderWindowId || t.incognito)
          return { ok: false, error: 'Relay refused: tab in another window' };
        break;
      }
      case 'sessions.getRecentlyClosed': {
        const list: SessionEntry[] = await b.sessions.getRecentlyClosed(...args);
        return { ok: true, value: list.filter((e) => !isPrivate(e)) };
      }
      case 'sessions.restore': {
        // Refuse before restoring: only sessions the popup could have seen, never private ones.
        const list: SessionEntry[] = await b.sessions.getRecentlyClosed();
        const entry = list.find((e) => (e.tab ?? e.window)?.sessionId === args[0]);
        if (!entry || isPrivate(entry))
          return { ok: false, error: 'Relay refused: unknown or private session' };
        // Backstop for a list that changed between the check and the restore.
        const restored: SessionEntry = await b.sessions.restore(...args);
        if (isPrivate(restored)) {
          if (restored.window) await b.windows.remove((restored.window as { id: number }).id);
          else if (restored.tab) await b.tabs.remove((restored.tab as { id: number }).id);
          return { ok: false, error: 'Relay refused: private session' };
        }
        return { ok: true, value: restored };
      }
    }
    const [ns, fn] = method.split('.') as [string, string];
    return { ok: true, value: await b[ns][fn](...args) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
