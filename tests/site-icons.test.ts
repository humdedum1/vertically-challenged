import { describe, expect, it } from 'vitest';
import { rememberIcons, siteIcon } from '../src/shared/site-icons';
import type { TabInfo } from '../src/shared/types';

const tab = (url: string, favIconUrl?: string, incognito = false) =>
  ({ url, favIconUrl, incognito }) as TabInfo;

describe('rememberIcons', () => {
  it('keys icons by site, so other pages of that site get them', () => {
    const next = rememberIcons({}, [tab('https://a.example/x', 'https://a.example/icon.png')]);
    expect(next).toEqual({ 'https://a.example': 'https://a.example/icon.png' });
    expect(siteIcon(new Map(Object.entries(next ?? {})), 'https://a.example/other?q=1')).toBe(
      'https://a.example/icon.png',
    );
  });

  it('never keeps icons from private tabs', () => {
    expect(
      rememberIcons({}, [tab('https://a.example/', 'https://a.example/i.png', true)]),
    ).toBeNull();
  });

  it('skips tabs without an icon and non-web pages', () => {
    expect(
      rememberIcons({}, [tab('https://a.example/'), tab('about:config', 'https://x/i.png')]),
    ).toBeNull();
  });

  it('returns null when nothing changed', () => {
    const stored = { 'https://a.example': 'https://a.example/i.png' };
    expect(
      rememberIcons(stored, [tab('https://a.example/y', 'https://a.example/i.png')]),
    ).toBeNull();
  });

  it('drops the oldest sites past the cap, keeping the newest', () => {
    const stored = { 'https://a.example': 'A', 'https://b.example': 'B' };
    const next = rememberIcons(
      stored,
      [tab('https://a.example/', 'A2'), tab('https://c.example/', 'C')],
      2,
    );
    expect(next).toEqual({ 'https://a.example': 'A2', 'https://c.example': 'C' });
  });
});

describe('siteIcon', () => {
  it('has no icon for non-web or malformed URLs', () => {
    expect(siteIcon(new Map([['null', 'X']]), 'about:blank')).toBeUndefined();
    expect(siteIcon(new Map(), 'not a url')).toBeUndefined();
  });
});
