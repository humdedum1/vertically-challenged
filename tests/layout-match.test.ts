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

describe('named window restart matching', () => {
  const named = (id: string, urls: string[]) => layout(id, [], { name: id, tabUrls: urls });
  const restored = (windowId: number, urls: string[]) => ({ ...win(windowId, []), urls });

  it('recovers names without pinned tabs despite changed ids and tab order', () => {
    const matches = matchLayouts(
      [
        named('Work', ['https://work.test/a', 'https://work.test/b#old']),
        named('Home', ['https://home.test/']),
      ],
      [
        restored(8, ['https://home.test/']),
        restored(7, ['https://work.test/b#new', 'https://work.test/a']),
      ],
    );
    expect(matches.get(7)?.layoutId).toBe('Work');
    expect(matches.get(8)?.layoutId).toBe('Home');
    expect(matches.get(7)?.bind.size).toBe(0);
  });

  it('does not guess between identical windows or saved names', () => {
    expect(
      matchLayouts(
        [named('Work', ['https://same.test/']), named('Home', ['https://same.test/'])],
        [restored(7, ['https://same.test/'])],
      ).size,
    ).toBe(0);
    expect(
      matchLayouts(
        [named('Work', ['https://same.test/'])],
        [restored(7, ['https://same.test/']), restored(8, ['https://same.test/'])],
      ).size,
    ).toBe(0);
  });

  it('does not match unrelated windows through one shared page', () => {
    expect(
      matchLayouts(
        [named('Work', ['https://shared.test/', 'https://work.test/a', 'https://work.test/b'])],
        [restored(7, ['https://shared.test/', 'https://home.test/a', 'https://home.test/b'])],
      ).size,
    ).toBe(0);
  });

  it('never restores a normal window name into an incognito window', () => {
    expect(
      matchLayouts(
        [named('Work', ['https://work.test/'])],
        [{ ...restored(7, ['https://work.test/']), incognito: true }],
      ).size,
    ).toBe(0);
  });

  it('uses regular tabs to distinguish windows sharing pinned sites', () => {
    const matches = matchLayouts(
      [
        layout('Work', [item('https://shared.test/')], {
          name: 'Work',
          tabUrls: ['https://work.test/'],
        }),
        layout('Home', [item('https://shared.test/')], {
          name: 'Home',
          tabUrls: ['https://home.test/'],
        }),
      ],
      [
        { ...win(7, tabs('https://shared.test/')), urls: ['https://home.test/'] },
        { ...win(8, tabs('https://shared.test/')), urls: ['https://work.test/'] },
      ],
    );
    expect(matches.get(7)?.layoutId).toBe('Home');
    expect(matches.get(8)?.layoutId).toBe('Work');
  });
});

it('does not swap named layouts with identical pinned and regular tabs', () => {
  const urls = ['https://shared.test/'];
  const named = (id: string) =>
    layout(id, [item('https://shared.test/')], { name: id, tabUrls: urls });
  const matches = matchLayouts(
    [named('Work'), named('Home')],
    [{ ...win(7, tabs(...urls)), urls }],
  );
  expect(matches.size).toBe(0);
});

it('recovers overlapping named windows once the stronger match is assigned', () => {
  const a = 'https://a.test/';
  const b = 'https://b.test/';
  const c = 'https://c.test/';
  const matches = matchLayouts(
    [
      layout('Work', [], { name: 'Work', tabUrls: [a, b, c] }),
      layout('Home', [], { name: 'Home', tabUrls: [a, b] }),
    ],
    [
      { ...win(7, []), urls: [a, b, c] },
      { ...win(8, []), urls: [a, b] },
    ],
  );
  expect(matches.get(7)?.layoutId).toBe('Work');
  expect(matches.get(8)?.layoutId).toBe('Home');
});
