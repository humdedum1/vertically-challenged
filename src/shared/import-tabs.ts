import { isRestorableUrl, type SavedGroup, type SavedTab, type SavedWindow } from './sessions';
import { GROUP_COLORS } from './types';

/**
 * Turns another tab manager's export into a session window: Sidebery backups and
 * snapshots (JSON or Markdown), SideTab Pro / VertiTab / other JSON exports, OneTab-style
 * "url | title" lists, bookmark HTML files, or plain lists of URLs.
 *
 * Their formats aren't documented and change between versions, so JSON is read
 * structurally rather than by schema: every object with a `url` becomes a tab, grouped
 * under the nearest enclosing object that has a name or title (a Sidebery panel, a folder,
 * a group). Nothing is executed or opened here; URLs are only kept if they're restorable.
 */
const MAX_TABS = 5000;
const MAX_TITLE = 200;
const MAX_GROUP = 60;

interface Found {
  url: string;
  title: string;
  group: string | null;
}

const clean = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function fromJson(root: unknown): Found[] {
  const out: Found[] = [];
  const seen = new WeakSet<object>();
  const walk = (v: unknown, group: string | null, depth: number): void => {
    if (out.length >= MAX_TABS || depth > 40 || typeof v !== 'object' || v === null) return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const x of v) walk(x, group, depth + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.url === 'string' && isRestorableUrl(o.url)) {
      out.push({ url: o.url, title: clean(o.title ?? o.name, MAX_TITLE), group });
      return;
    }
    // A named object that holds more objects is a container (panel, folder, group).
    const name = clean(o.name ?? o.title, MAX_GROUP);
    const holds = Object.values(o).some((x) => typeof x === 'object' && x !== null);
    const next = name && holds && depth > 0 ? name : group;
    for (const x of Object.values(o)) walk(x, next, depth + 1);
  };
  walk(root, null, 0);
  return out;
}

const decode = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function fromHtml(text: string): Found[] {
  const out: Found[] = [];
  let group: string | null = null;
  const re = /<h3[^>]*>([^<]*)<\/h3>|<a\s[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) group = clean(decode(m[1]), MAX_GROUP) || null;
    else if (m[2] && isRestorableUrl(decode(m[2])))
      out.push({ url: decode(m[2]), title: clean(decode(m[3] ?? ''), MAX_TITLE), group });
    if (out.length >= MAX_TABS) break;
  }
  return out;
}

/** Markdown links, headings as groups, "url | title" (OneTab) and bare URLs, line by line. */
function fromText(text: string): Found[] {
  const out: Found[] = [];
  let group: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (out.length >= MAX_TABS) break;
    const heading = /^\s*#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      group = clean(heading[1], MAX_GROUP) || null;
      continue;
    }
    const md = [...line.matchAll(/\[([^\]]*)\]\(([^)\s]+)\)/g)];
    if (md.length) {
      for (const m of md)
        if (isRestorableUrl(m[2] as string))
          out.push({ url: m[2] as string, title: clean(m[1], MAX_TITLE), group });
      continue;
    }
    const pipe = /^\s*(\S+:\/\/\S+)\s+\|\s+(.*)$/.exec(line);
    if (pipe && isRestorableUrl(pipe[1] as string)) {
      out.push({ url: pipe[1] as string, title: clean(pipe[2], MAX_TITLE), group });
      continue;
    }
    for (const m of line.matchAll(/\b(?:https?|file):\/\/[^\s<>"')\]]+/g)) {
      // Sentence punctuation after a URL in prose isn't part of it.
      const url = m[0].replace(/[.,;:!?]+$/, '');
      if (isRestorableUrl(url)) out.push({ url, title: '', group });
    }
  }
  return out;
}

export function parseImport(text: string): SavedWindow | null {
  const trimmed = text.trim();
  let found: Found[];
  if (/^[[{]/.test(trimmed)) {
    try {
      found = fromJson(JSON.parse(trimmed));
    } catch {
      found = fromText(trimmed);
    }
  } else if (/<a\s[^>]*href=/i.test(trimmed)) found = fromHtml(trimmed);
  else found = fromText(trimmed);
  if (found.length === 0) return null;

  const groups: SavedGroup[] = [];
  const groupIndex = new Map<string, number>();
  const tabs: SavedTab[] = found.slice(0, MAX_TABS).map((f) => {
    let group: number | null = null;
    if (f.group) {
      group = groupIndex.get(f.group) ?? null;
      if (group === null) {
        group = groups.length;
        groupIndex.set(f.group, group);
        groups.push({
          title: f.group,
          color: GROUP_COLORS[group % GROUP_COLORS.length] ?? 'grey',
          collapsed: true,
        });
      }
    }
    return { url: f.url, title: f.title || f.url, pinned: false, group };
  });
  return { tabs, groups };
}
