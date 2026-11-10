import type { Session } from './sessions';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Markdown link text: brackets and a leading character that could start markup. */
const mdText = (s: string): string =>
  s
    .replace(/[[\]\\]/g, '\\$&')
    .replace(/\s+/g, ' ')
    .trim();
/** A URL that can sit inside ( ) of a Markdown link. */
const mdUrl = (u: string): string =>
  u.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

/** javascript: links would become clickable bookmarklets in the exported file. */
const exportable = (t: { url: string }): boolean => {
  try {
    return new URL(t.url).protocol !== 'javascript:'; // parsed: leading whitespace can't hide it
  } catch {
    return true;
  }
};

/** A readable outline: one heading per window, groups as sub-headings, tabs as links. */
export function sessionToMarkdown(s: Session): string {
  const out = [`# ${mdText(s.name) || 'Session'}`, ''];
  s.windows.forEach((w, wi) => {
    if (s.windows.length > 1) out.push(`## Window ${wi + 1}`, '');
    const sections = new Map<number | null, typeof w.tabs>();
    for (const t of w.tabs.filter(exportable))
      sections.set(t.group, [...(sections.get(t.group) ?? []), t]);
    for (const [g, tabs] of sections) {
      if (g !== null) out.push(`### ${mdText(w.groups[g]?.title ?? '') || 'Group'}`, '');
      for (const t of tabs) out.push(`- [${mdText(t.title) || t.url}](${mdUrl(t.url)})`);
      out.push('');
    }
  });
  return `${out.join('\n').trimEnd()}\n`;
}

/** The Netscape bookmarks file every browser can import. */
export function sessionToBookmarksHtml(s: Session): string {
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    `<TITLE>${esc(s.name)}</TITLE>`,
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `  <DT><H3>${esc(s.name)}</H3>`,
    '  <DL><p>',
  ];
  s.windows.forEach((w, wi) => {
    const nested = s.windows.length > 1;
    if (nested) lines.push(`    <DT><H3>Window ${wi + 1}</H3>`, '    <DL><p>');
    for (const t of w.tabs.filter(exportable))
      lines.push(`      <DT><A HREF="${esc(t.url)}">${esc(t.title || t.url)}</A>`);
    if (nested) lines.push('    </DL><p>');
  });
  lines.push('  </DL><p>', '</DL><p>');
  return `${lines.join('\n')}\n`;
}
