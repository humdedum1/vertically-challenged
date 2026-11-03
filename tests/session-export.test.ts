import { describe, expect, it } from 'vitest';
import { sessionToBookmarksHtml, sessionToMarkdown } from '../src/shared/session-export';
import type { Session } from '../src/shared/sessions';

const session = {
  id: 's1',
  name: 'Trip <plan>',
  createdAt: 0,
  windows: [
    {
      groups: [{ title: 'Hotels', color: 'blue', collapsed: false }],
      tabs: [
        { url: 'https://a.example/x?a=1&b=2', title: 'Hotel [A]', pinned: false, group: 0 },
        { url: 'https://b.example/(menu)', title: '', pinned: false, group: null },
      ],
    },
  ],
} as unknown as Session;

describe('session export', () => {
  it('writes Markdown with groups and safe link text and URLs', () => {
    const md = sessionToMarkdown(session);
    expect(md).toContain('# Trip <plan>');
    expect(md).toContain('### Hotels');
    expect(md).toContain('- [Hotel \\[A\\]](https://a.example/x?a=1&b=2)');
    expect(md).toContain('- [https://b.example/(menu)](https://b.example/%28menu%29)');
  });

  it('writes a bookmarks file with every field escaped', () => {
    const html = sessionToBookmarksHtml(session);
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<H3>Trip &lt;plan&gt;</H3>');
    expect(html).toContain('HREF="https://a.example/x?a=1&amp;b=2"');
    expect(html).not.toContain('<plan>');
  });
});
