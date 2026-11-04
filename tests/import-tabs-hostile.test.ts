import { describe, expect, it } from 'vitest';
import { parseImport } from '../src/shared/import-tabs';

/** Each of these took 10-40 s at 240 KB with the old backtracking regexes. */
describe('parseImport on hostile input stays linear', () => {
  const big = 2_000_000;
  for (const [name, text] of [
    ['<a repeated', '<a '.repeat(big / 3)],
    ['< repeated with href', `href=${'<a '.repeat(big / 3)}`],
    ['[ repeated', '['.repeat(big)],
    ['](  repeated', '](['.repeat(big / 3)],
    ['://  repeated', 'a://'.repeat(big / 4)],
    ['pipe spam', `x://${'x'.repeat(big)} |`],
  ] as const)
    it(name, () => {
      const t0 = performance.now();
      parseImport(text);
      expect(performance.now() - t0).toBeLessThan(2000);
    });
});

describe('parseImport still reads real exports', () => {
  it('bookmark HTML with long ICON attributes and folders', () => {
    const icon = `data:image/png;base64,${'A'.repeat(20_000)}`;
    const html = `<DL><DT><H3 ADD_DATE="1">Work</H3><DL><DT><A HREF="https://a.example/?x=1&amp;y=2" ICON="${icon}">Site &amp; A</A></DL></DL>`;
    const w = parseImport(html);
    expect(w?.tabs).toEqual([
      { url: 'https://a.example/?x=1&y=2', title: 'Site & A', pinned: false, group: 0 },
    ]);
    expect(w?.groups[0]?.title).toBe('Work');
  });
  it('markdown links and OneTab lines', () => {
    const w = parseImport('# Reading\n[Doc](https://d.example/a)\nhttps://o.example/b | One tab\n');
    expect(w?.tabs.map((t) => [t.url, t.title, t.group])).toEqual([
      ['https://d.example/a', 'Doc', 0],
      ['https://o.example/b', 'One tab', 0],
    ]);
  });
  it('drops unsafe schemes', () => {
    expect(parseImport('[x](javascript:alert(1))\n[y](data:text/html,hi)')).toBeNull();
  });
});
