import { describe, expect, it } from 'vitest';
import { FuzzyIndex, matchToken } from '../src/lib/search/fuzzy-index';
import { displayUrl, type SearchDoc } from '../src/lib/search/search-index';

describe('displayUrl', () => {
  it('strips scheme and leading www.', () => {
    expect(displayUrl('https://www.example.com/a?b=1')).toBe('example.com/a?b=1');
    expect(displayUrl('http://example.com')).toBe('example.com');
    expect(displayUrl('HTTPS://WWW.Example.com')).toBe('Example.com');
    expect(displayUrl('chrome://extensions')).toBe('extensions');
    expect(displayUrl('chrome-extension://abc/page.html')).toBe('abc/page.html');
  });
  it('leaves non-leading www and schemeless input alone', () => {
    expect(displayUrl('https://docs.www.example.com')).toBe('docs.www.example.com');
    expect(displayUrl('example.com')).toBe('example.com');
    expect(displayUrl('about:blank')).toBe('about:blank');
  });
});

describe('matchToken', () => {
  it('returns null when no match', () => {
    expect(matchToken('hello', 'xyz')).toBeNull();
    expect(matchToken('abc', 'cba')).toBeNull();
  });

  it('substring ranges are exact', () => {
    expect(matchToken('hello world', 'wor')?.ranges).toEqual([[6, 9]]);
  });

  it('substring beats subsequence', () => {
    const sub = matchToken('xx hello', 'hello') as { score: number };
    const seq = matchToken('h-e-l-l-o', 'hello') as { score: number };
    expect(sub.score).toBeGreaterThan(seq.score);
    // Even a poor substring beats the best possible subsequence.
    const poor = matchToken(`${'z'.repeat(60)}abc`, 'abc') as { score: number };
    const goodSeq = matchToken('a b c', 'abc') as { score: number };
    expect(poor.score).toBeGreaterThan(goodSeq.score);
  });

  it('prefers a word-boundary occurrence and start-of-text', () => {
    const start = matchToken('tab one', 'tab') as { score: number };
    const boundary = matchToken('my tabs', 'tab') as { score: number };
    const inner = matchToken('mytabs', 'tab') as { score: number };
    expect(start.score).toBeGreaterThan(boundary.score);
    expect(boundary.score).toBeGreaterThan(inner.score);
  });

  it('picks the boundary occurrence for the range', () => {
    expect(matchToken('atab tab', 'tab')?.ranges).toEqual([[5, 8]]);
  });

  it('subsequence ranges are correct and adjacent chars are merged', () => {
    expect(matchToken('hello', 'hlo')?.ranges).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(matchToken('hello', 'helo')?.ranges).toEqual([
      [0, 3],
      [4, 5],
    ]);
  });

  it('subsequence scores are capped below substring scores', () => {
    const m = matchToken('a b c d e f', 'abcdef') as { score: number };
    expect(m.score).toBeLessThanOrEqual(90);
  });
});

const doc = (id: number, title: string, url = `https://example.com/${id}`): SearchDoc => ({
  id,
  title,
  url,
});

function index(docs: SearchDoc[]) {
  const ix = new FuzzyIndex();
  ix.replaceAll(docs);
  return ix;
}

describe('FuzzyIndex.search', () => {
  it('empty / whitespace query returns []', () => {
    const ix = index([doc(1, 'hello')]);
    expect(ix.search('')).toEqual([]);
    expect(ix.search('   \t ')).toEqual([]);
  });

  it('returns [] on an empty index', () => {
    expect(new FuzzyIndex().search('x')).toEqual([]);
  });

  it('requires every token to match (AND)', () => {
    const ix = index([doc(1, 'apple pie'), doc(2, 'apple'), doc(3, 'pie')]);
    expect(ix.search('apple pie').map((h) => h.id)).toEqual([1]);
    expect(
      ix
        .search('apple')
        .map((h) => h.id)
        .sort(),
    ).toEqual([1, 2]);
  });

  it('tokens may match in different fields', () => {
    const ix = index([doc(1, 'Docs', 'https://github.com/x')]);
    const hits = ix.search('docs github');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toEqual([[0, 4]]);
    expect(hits[0]?.url).toEqual([[0, 6]]);
  });

  it('prefers a title match over a URL match', () => {
    const ix = index([
      doc(1, 'nothing', 'https://rust.dev/'),
      doc(2, 'rust', 'https://other.dev/'),
    ]);
    const hits = ix.search('rust');
    expect(hits.map((h) => h.id)).toEqual([2, 1]);
    expect(hits[0]?.title).toEqual([[0, 4]]);
    expect(hits[0]?.url).toEqual([]);
    expect(hits[1]?.title).toEqual([]);
    expect(hits[1]?.url).toEqual([[0, 4]]);
  });

  it('matches against the display URL, not the scheme', () => {
    const ix = index([doc(1, 'zzz', 'https://www.example.com/')]);
    expect(ix.search('https')).toEqual([]);
    expect(ix.search('www')).toEqual([]);
    expect(ix.search('example')[0]?.url).toEqual([[0, 7]]);
  });

  it('ties keep document order', () => {
    const ix = index([doc(5, 'same', 'x://a'), doc(2, 'same', 'x://a'), doc(9, 'same', 'x://a')]);
    expect(ix.search('same').map((h) => h.id)).toEqual([5, 2, 9]);
  });

  it('sorts by descending score', () => {
    const ix = index([
      doc(1, 'xx react', 'x://a'),
      doc(2, 'react', 'x://a'),
      doc(3, 'r e a c t', 'x://a'),
    ]);
    expect(ix.search('react').map((h) => h.id)).toEqual([2, 1, 3]);
    const scores = ix.search('react').map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('limit truncates after sorting', () => {
    const ix = index([
      doc(1, 'xx react', 'x://a'),
      doc(2, 'react', 'x://a'),
      doc(3, 'zz react', 'x://a'),
    ]);
    expect(ix.search('react', 1).map((h) => h.id)).toEqual([2]);
    expect(ix.search('react', 2)).toHaveLength(2);
    expect(ix.search('react', 0)).toEqual([]);
  });

  it('merges overlapping and adjacent ranges', () => {
    const ix = index([doc(1, 'abc', 'x://z')]);
    expect(ix.search('ab bc')[0]?.title).toEqual([[0, 3]]);
    expect(ix.search('ab c')[0]?.title).toEqual([[0, 3]]);
  });

  it('is case-insensitive and handles unicode', () => {
    const ix = index([
      doc(1, 'Straße Café', 'x://a'),
      doc(2, 'ÅNGSTRÖM', 'x://a'),
      doc(3, '日本語のページ', 'x://a'),
    ]);
    expect(ix.search('CAFÉ').map((h) => h.id)).toEqual([1]);
    expect(ix.search('café')[0]?.title).toEqual([[7, 11]]);
    expect(ix.search('ångström').map((h) => h.id)).toEqual([2]);
    expect(ix.search('日本').map((h) => h.id)).toEqual([3]);
  });

  it('truncates a very long query without error', () => {
    const ix = index([doc(1, 'a'.repeat(50))]);
    const long = 'a'.repeat(10_000);
    expect(() => ix.search(long)).not.toThrow();
    const many = Array.from({ length: 500 }, () => 'a').join(' ');
    expect(() => ix.search(many)).not.toThrow();
    expect(ix.search(many).map((h) => h.id)).toEqual([1]);
  });

  it('replaceAll reflects title changes and removals (cache reuse stays correct)', () => {
    const ix = index([doc(1, 'alpha'), doc(2, 'beta')]);
    expect(ix.search('alpha').map((h) => h.id)).toEqual([1]);
    ix.replaceAll([doc(1, 'gamma'), doc(2, 'beta')]);
    expect(ix.search('alpha')).toEqual([]);
    expect(ix.search('gamma').map((h) => h.id)).toEqual([1]);
    expect(ix.search('beta').map((h) => h.id)).toEqual([2]);
    ix.replaceAll([doc(2, 'beta')]);
    expect(ix.search('gamma')).toEqual([]);
  });

  it('replaceAll reflects url changes and reordering', () => {
    const ix = index([doc(1, 'a', 'https://one.com'), doc(2, 'a', 'https://two.com')]);
    ix.replaceAll([doc(2, 'a', 'https://two.com'), doc(1, 'a', 'https://three.com')]);
    expect(ix.search('one')).toEqual([]);
    expect(ix.search('three').map((h) => h.id)).toEqual([1]);
    expect(ix.search('a', 10).map((h) => h.id)).toEqual([2, 1]);
  });

  it('perf guard: 1,500 docs, two-token query under 5 ms on average', () => {
    const words = [
      'react',
      'svelte',
      'github',
      'docs',
      'issue',
      'pull',
      'request',
      'google',
      'mail',
      'news',
    ];
    const docs = Array.from({ length: 1500 }, (_, i) =>
      doc(
        i,
        `${words[i % 10]} ${words[(i * 7) % 10]} page ${i} - Some Long Title Here`,
        `https://www.${words[i % 10]}.com/path/${i}/${words[(i * 3) % 10]}?q=${i}`,
      ),
    );
    const ix = index(docs);
    ix.search('git pull');
    const runs = 50;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) ix.search('git pull');
    const avg = (performance.now() - t0) / runs;
    expect(avg).toBeLessThan(5);
  });
});
