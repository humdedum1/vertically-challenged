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

/**
 * Linear scans, not backtracking regexes: the file is hostile input, and `<a [^>]*href=` or
 * `\[[^\]]*\]\(` take quadratic time on a long run of `<a ` or `[` (240 KB hung for 10-40 s).
 * Bookmark exports carry multi-KB ICON="data:..." attributes, so tag length can't be bounded.
 */
function fromHtml(text: string): Found[] {
  const out: Found[] = [];
  let group: string | null = null;
  let i = text.indexOf('<');
  while (out.length < MAX_TABS && i !== -1) {
    const end = text.indexOf('>', i);
    if (end === -1) break;
    const tag = text.slice(i + 1, end);
    const next = text.indexOf('<', end + 1);
    const inner = text.slice(end + 1, next === -1 ? undefined : next);
    if (/^h3[\s/]|^h3$/i.test(tag)) {
      group = clean(decode(inner), MAX_GROUP) || null;
    } else if (/^a\s/i.test(tag)) {
      const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
      if (href && isRestorableUrl(decode(href)))
        out.push({ url: decode(href), title: clean(decode(inner), MAX_TITLE), group });
    }
    i = next;
  }
  return out;
}

/** `[label](url)` links in a line, found from each `](` with a bounded look back. */
function markdownLinks(line: string): { label: string; url: string }[] {
  const out: { label: string; url: string }[] = [];
  const stopper = /[)\s]/g;
  let stop = -1; // next `)` or whitespace, reused while it is still ahead: keeps this linear
  for (let at = line.indexOf(']('); at !== -1; at = line.indexOf('](', at + 2)) {
    const from = Math.max(0, at - 300);
    const open = line.slice(from, at).lastIndexOf('[');
    if (open === -1) continue;
    const label = line.slice(from + open + 1, at);
    if (label.includes(']')) continue;
    const start = at + 2;
    if (stop < start) {
      stopper.lastIndex = start;
      stop = stopper.exec(line)?.index ?? line.length;
    }
    if (stop > start && stop - start <= 2000 && line[stop] === ')')
      out.push({ label, url: line.slice(start, stop) });
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
    const md = markdownLinks(line);
    if (md.length) {
      for (const m of md)
        if (isRestorableUrl(m.url))
          out.push({ url: m.url, title: clean(m.label, MAX_TITLE), group });
      continue;
    }
    const bar = line.search(/\s\|\s/);
    const head = bar === -1 ? '' : line.slice(0, bar).trim();
    if (/^\S+:\/\/\S+$/.test(head) && isRestorableUrl(head)) {
      out.push({
        url: head,
        title: clean(line.slice(bar + 1).replace(/^\s*\|\s*/, ''), MAX_TITLE),
        group,
      });
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
  } else if (/<a\s/i.test(trimmed) && /href=/i.test(trimmed)) found = fromHtml(trimmed);
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
