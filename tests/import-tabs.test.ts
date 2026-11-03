import { expect, it } from 'vitest';
import { parseImport } from '../src/shared/import-tabs';

it('reads a nested JSON export, grouping tabs by their named container', () => {
  const sidebery = {
    ver: '5.2.0',
    snapshots: [
      {
        panels: [
          {
            name: 'Work',
            tabs: [
              { url: 'https://github.com', title: 'GitHub' },
              { url: 'javascript:alert(1)', title: 'bad' },
            ],
          },
          { name: 'Read', tabs: [{ url: 'https://news.ycombinator.com', title: 'HN' }] },
        ],
      },
    ],
    loose: { url: 'https://example.com' },
  };
  const w = parseImport(JSON.stringify(sidebery));
  expect(w?.groups.map((g) => g.title)).toEqual(['Work', 'Read']);
  expect(w?.tabs).toEqual([
    { url: 'https://github.com', title: 'GitHub', pinned: false, group: 0 },
    { url: 'https://news.ycombinator.com', title: 'HN', pinned: false, group: 1 },
    { url: 'https://example.com', title: 'https://example.com', pinned: false, group: null },
  ]);
});

it('reads Markdown with headings, OneTab lines and bare URLs', () => {
  const text = [
    '# Panel A',
    '- [Docs](https://docs.rs/tokio)',
    'https://a.com/x | Page A',
    'see https://b.com/y, and more',
    '## Panel B',
    '- [Bad](javascript:void(0))',
  ].join('\n');
  const w = parseImport(text);
  expect(w?.tabs.map((t) => [t.url, t.title, t.group])).toEqual([
    ['https://docs.rs/tokio', 'Docs', 0],
    ['https://a.com/x', 'Page A', 0],
    ['https://b.com/y', 'https://b.com/y', 0],
  ]);
});

it('reads bookmark HTML with folders and decodes entities', () => {
  const html =
    '<DL><DT><H3>Dev</H3><DL><DT><A HREF="https://x.com/?a=1&amp;b=2">X &amp; Y</A></DL></DL>';
  expect(parseImport(html)?.tabs).toEqual([
    { url: 'https://x.com/?a=1&b=2', title: 'X & Y', pinned: false, group: 0 },
  ]);
});

it('returns null when nothing importable is found', () => {
  expect(parseImport('{"a": 1}')).toBeNull();
  expect(parseImport('hello')).toBeNull();
});
