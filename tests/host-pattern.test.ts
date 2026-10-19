import { describe, expect, it } from 'vitest';
import { hostOf, matchesHostPattern, normalizeHostPattern } from '../src/shared/host-pattern';

describe('normalizeHostPattern', () => {
  it.each([
    ['example.com', 'example.com'],
    ['  Example.COM  ', 'example.com'],
    ['www.example.com', 'example.com'],
    ['sub.example.co.uk', 'sub.example.co.uk'],
    ['*.example.com', '*.example.com'],
    ['*.Example.com', '*.example.com'],
    ['example.com:8080', 'example.com:8080'],
    ['*.example.com:8080', '*.example.com:8080'],
    ['localhost', 'localhost'],
    ['localhost:3000', 'localhost:3000'],
    ['*.localhost', '*.localhost'],
    ['192.168.0.1', '192.168.0.1'],
    ['my-site.io', 'my-site.io'],
    ['example.com/some/path', 'example.com'],
  ])('%j -> %j', (input, out) => {
    expect(normalizeHostPattern(input)).toBe(out);
  });

  it.each([
    ['https://www.example.com/path?q=1#h', 'example.com'],
    ['http://Example.com:8080/x', 'example.com:8080'],
    ['https://sub.example.com', 'sub.example.com'],
    ['ftp://files.example.com/pub', 'files.example.com'],
  ])('pasted URL %j -> %j', (input, out) => {
    expect(normalizeHostPattern(input)).toBe(out);
  });

  it.each([
    '',
    '   ',
    '*',
    '*.',
    '*.com',
    'com',
    'example',
    'localhost.',
    'ex ample.com',
    '/path/only',
    '/',
    'a_b.com',
    'exa!mple.com',
    '**.example.com',
    'foo.*.com',
    'example.com:',
    'example.com:123456',
    'example.com:abc',
    'http://',
    'https://exa mple.com',
    'javascript:alert(1)',
  ])('rejects %j', (input) => {
    expect(normalizeHostPattern(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const v of [null, undefined, 1, {}]) expect(normalizeHostPattern(v as never)).toBeNull();
  });

  it('rejects inputs over 253 characters, accepts a long valid host below it', () => {
    const label = 'a'.repeat(60);
    const ok = `${label}.${label}.${label}.com`;
    expect(ok.length).toBeLessThanOrEqual(253);
    expect(normalizeHostPattern(ok)).toBe(ok);
    const tooLong = `${'a'.repeat(250)}.com`;
    expect(tooLong.length).toBeGreaterThan(253);
    expect(normalizeHostPattern(tooLong)).toBeNull();
  });
});

describe('hostOf', () => {
  it('returns host without www., lowercased, keeping the port', () => {
    expect(hostOf('https://www.Example.com/x')).toBe('example.com');
    expect(hostOf('http://example.com:8080/x')).toBe('example.com:8080');
    expect(hostOf('http://localhost:3000')).toBe('localhost:3000');
    expect(hostOf('https://a.b.example.com')).toBe('a.b.example.com');
  });

  it('only strips a leading www.', () => {
    expect(hostOf('https://notwww.example.com')).toBe('notwww.example.com');
    expect(hostOf('https://a.www.example.com')).toBe('a.www.example.com');
  });

  it('is null for non-http(s) and unparsable URLs', () => {
    for (const u of [
      'chrome://settings',
      'chrome-extension://abc/page.html',
      'file:///etc/hosts',
      'about:blank',
      'data:text/plain,hi',
      'javascript:void(0)',
      'not a url',
      '',
    ])
      expect(hostOf(u)).toBeNull();
  });
});

describe('matchesHostPattern', () => {
  it('bare host matches itself and subdomains, not look-alikes', () => {
    const p = ['example.com'];
    expect(matchesHostPattern('https://example.com/', p)).toBe(true);
    expect(matchesHostPattern('https://www.example.com/', p)).toBe(true);
    expect(matchesHostPattern('https://a.example.com/x', p)).toBe(true);
    expect(matchesHostPattern('https://a.b.example.com/x', p)).toBe(true);
    expect(matchesHostPattern('https://badexample.com/', p)).toBe(false);
    expect(matchesHostPattern('https://example.com.evil.org/', p)).toBe(false);
    expect(matchesHostPattern('https://example.org/', p)).toBe(false);
  });

  it('wildcard matches subdomains but not the apex', () => {
    const p = ['*.example.com'];
    expect(matchesHostPattern('https://a.example.com/', p)).toBe(true);
    expect(matchesHostPattern('https://x.y.example.com/', p)).toBe(true);
    expect(matchesHostPattern('https://example.com/', p)).toBe(false);
    expect(matchesHostPattern('https://www.example.com/', p)).toBe(false);
    expect(matchesHostPattern('https://badexample.com/', p)).toBe(false);
  });

  it('ports must match as given', () => {
    expect(matchesHostPattern('http://localhost:3000/', ['localhost:3000'])).toBe(true);
    expect(matchesHostPattern('http://localhost:4000/', ['localhost:3000'])).toBe(false);
    expect(matchesHostPattern('http://localhost/', ['localhost:3000'])).toBe(false);
    expect(matchesHostPattern('http://localhost:3000/', ['localhost'])).toBe(false);
    expect(matchesHostPattern('https://example.com:8080/', ['example.com'])).toBe(false);
    expect(matchesHostPattern('https://example.com:8080/', ['example.com:8080'])).toBe(true);
    expect(matchesHostPattern('https://a.example.com:8080/', ['*.example.com:8080'])).toBe(true);
  });

  it('non-web URLs never match', () => {
    expect(matchesHostPattern('chrome://example.com/', ['example.com'])).toBe(false);
    expect(matchesHostPattern('file:///example.com', ['example.com'])).toBe(false);
    expect(matchesHostPattern('garbage', ['example.com'])).toBe(false);
  });

  it('any pattern in the list may match; empty list never does', () => {
    expect(matchesHostPattern('https://b.org/', ['a.com', 'b.org'])).toBe(true);
    expect(matchesHostPattern('https://b.org/', [])).toBe(false);
  });
});
