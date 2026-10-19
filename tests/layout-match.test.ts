import { describe, expect, it } from 'vitest';
import { matchLayouts } from '../src/background/pins/match';
import type { PinItem, WindowLayout } from '../src/shared/layout';

let n = 0;
const item = (url: string, over: Partial<PinItem> = {}): PinItem => ({
  kind: 'item',
  id: `i${++n}`,
  homeUrl: url,
  lastUrl: url,
  title: '',
  tabId: null,
  ...over,
});

const layout = (id: string, items: PinItem[], over: Partial<WindowLayout> = {}): WindowLayout => ({
  id,
  name: null,
  essentials: [],
  pinned: items,
  collapsed: [],
  incognito: false,
  lastUsed: 0,
  ...over,
});

const tabs = (...urls: string[]) => urls.map((url, i) => ({ id: 100 + i, url, title: '' }));
const win = (windowId: number, pinned: ReturnType<typeof tabs>, incognito = false) => ({
  windowId,
  incognito,
  pinned,
});

describe('matchLayouts', () => {
  it('binds exact URL matches in order', () => {
    const a = item('https://a.com/');
    const b = item('https://b.com/');
    const m = matchLayouts(
      [layout('l1', [a, b])],
      [win(1, tabs('https://b.com/', 'https://a.com/'))],
    );
    expect(m.get(1)?.layoutId).toBe('l1');
    expect([...(m.get(1)?.bind ?? [])]).toEqual([
      [b.id, 100],
      [a.id, 101],
    ]);
  });

  it('binds two identical items to two distinct tabs', () => {
    const a = item('https://mail.google.com/mail/u/0/');
    const b = item('https://mail.google.com/mail/u/0/');
    const m = matchLayouts(
      [layout('l1', [a, b])],
      [win(1, tabs('https://mail.google.com/mail/u/0/', 'https://mail.google.com/mail/u/0/'))],
    );
    expect(m.get(1)?.bind.get(a.id)).toBe(100);
    expect(m.get(1)?.bind.get(b.id)).toBe(101);
  });

  it('ignores the hash when comparing', () => {
    const a = item('https://a.com/x');
    const m = matchLayouts([layout('l1', [a])], [win(1, tabs('https://a.com/x#top'))]);
    expect(m.get(1)?.bind.get(a.id)).toBe(100);
  });

  it('falls back to the same origin', () => {
    const a = item('https://a.com/home');
    const m = matchLayouts([layout('l1', [a])], [win(1, tabs('https://a.com/x'))]);
    expect(m.get(1)?.bind.get(a.id)).toBe(100);
  });

  it('matches lastUrl as well as homeUrl', () => {
    const a = item('https://a.com/home', { lastUrl: 'https://a.com/last' });
    const m = matchLayouts([layout('l1', [a])], [win(1, tabs('https://a.com/last'))]);
    expect(m.get(1)?.bind.get(a.id)).toBe(100);
  });

  it('leaves a window below half unmatched', () => {
    const a = item('https://a.com/');
    const m = matchLayouts(
      [layout('l1', [a])],
      [win(1, tabs('https://a.com/', 'https://x.com/', 'https://y.com/', 'https://z.com/'))],
    );
    expect(m.size).toBe(0);
  });

  it('matches at exactly half', () => {
    const a = item('https://a.com/');
    const b = item('https://b.com/');
    const m = matchLayouts(
      [layout('l1', [a, b])],
      [win(1, tabs('https://a.com/', 'https://x.com/'))],
    );
    expect([...(m.get(1)?.bind ?? [])]).toEqual([[a.id, 100]]);
  });

  it('gives a contested layout to the higher score', () => {
    const a = item('https://a.com/');
    const b = item('https://b.com/');
    const m = matchLayouts(
      [layout('l1', [a, b])],
      [
        win(1, tabs('https://a.com/', 'https://x.com/')),
        win(2, tabs('https://a.com/', 'https://b.com/')),
      ],
    );
    expect(m.get(2)?.layoutId).toBe('l1');
    expect(m.has(1)).toBe(false);
  });

  it('breaks score ties by most recent lastUsed', () => {
    const l1 = layout('l1', [item('https://a.com/')], { lastUsed: 1 });
    const l2 = layout('l2', [item('https://a.com/')], { lastUsed: 2 });
    const m = matchLayouts([l1, l2], [win(1, tabs('https://a.com/'))]);
    expect(m.get(1)?.layoutId).toBe('l2');
  });

  it('leaves an empty pinned list unmatched', () => {
    expect(matchLayouts([layout('l1', [item('https://a.com/')])], [win(1, [])]).size).toBe(0);
  });

  it('never matches across incognito', () => {
    const l = layout('l1', [item('https://a.com/')]);
    expect(matchLayouts([l], [win(1, tabs('https://a.com/'), true)]).size).toBe(0);
    const li = layout('l2', [item('https://a.com/')], { incognito: true });
    expect(matchLayouts([li], [win(1, tabs('https://a.com/'))]).size).toBe(0);
    expect(matchLayouts([li], [win(1, tabs('https://a.com/'), true)]).get(1)?.layoutId).toBe('l2');
  });

  it('compares unparseable URLs as raw strings with no origin', () => {
    const a = item('weird', { lastUrl: 'weird' });
    expect(
      matchLayouts([layout('l1', [a])], [win(1, tabs('weird'))])
        .get(1)
        ?.bind.get(a.id),
    ).toBe(100);
    const b = item('weird-a', { lastUrl: 'weird-a' });
    expect(matchLayouts([layout('l1', [b])], [win(1, tabs('weird-b'))]).size).toBe(0);
  });
});
