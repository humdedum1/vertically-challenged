import { describe, expect, it } from 'vitest';
import type { PinFolder, PinItem, WindowLayout } from '../src/shared/layout';
import { pinStep } from '../src/sidepanel/model/pin-step';

const item = (id: string): PinItem => ({
  kind: 'item',
  id,
  homeUrl: 'https://example.com/',
  lastUrl: 'https://example.com/',
  title: id,
  tabId: null,
});
const folder = (id: string, children: PinFolder['children'], collapsed = false): PinFolder => ({
  kind: 'folder',
  id,
  name: id,
  icon: 'folder',
  collapsed,
  children,
});

// Essentials e1 e2; root: a, F{ b, c }, K{ k } (collapsed), d, H{ I{ J{} } }.
const l: WindowLayout = {
  id: 'laaaaaaaaaa',
  name: null,
  essentials: [item('e1'), item('e2')],
  pinned: [
    item('a'),
    folder('F', [item('b'), item('c')]),
    folder('K', [item('k')], true),
    item('d'),
    folder('H', [folder('I', [folder('J', [])])]),
  ],
  collapsed: [],
  incognito: false,
  lastUsed: 0,
};
const root = (index: number) => ({ zone: 'pinned', folderId: null, index });
const inFolder = (folderId: string, index: number) => ({ zone: 'pinned', folderId, index });

describe('pinStep', () => {
  it('steps over a sibling item', () => {
    expect(pinStep(l, 'd', -1)).toMatchObject({ dest: root(2), how: 'above', ref: 'K' });
    expect(pinStep(l, 'b', 1)).toMatchObject({ dest: inFolder('F', 1), how: 'below', ref: 'c' });
  });

  it('enters an expanded folder: as its last child going up, first going down', () => {
    expect(pinStep(l, 'a', 1)).toMatchObject({ dest: inFolder('F', 0), how: 'into', ref: 'F' });
    expect(pinStep(l, 'K', -1)).toMatchObject({ dest: inFolder('F', 2), how: 'into', ref: 'F' });
  });

  it('steps over a collapsed folder', () => {
    expect(pinStep(l, 'd', -1)).toMatchObject({ how: 'above', ref: 'K' });
    expect(pinStep(l, 'F', 1)).toMatchObject({ dest: root(2), how: 'below', ref: 'K' });
  });

  it('leaves its folder at the edges: before it going up, after it going down', () => {
    expect(pinStep(l, 'b', -1)).toMatchObject({ dest: root(1), how: 'out of', ref: 'F' });
    expect(pinStep(l, 'c', 1)).toMatchObject({ dest: root(2), how: 'out of', ref: 'F' });
  });

  it('stops at the ends of the pinned root', () => {
    expect(pinStep(l, 'a', -1)).toEqual({ edge: true });
    expect(pinStep(l, 'H', 1)).toEqual({ edge: true });
  });

  it("doesn't enter a folder past the depth limit; steps over it instead", () => {
    expect(pinStep(l, 'd', 1)).toMatchObject({ dest: inFolder('H', 0), how: 'into' });
    // V is three levels tall, so inside T it would reach depth 4.
    const tall: WindowLayout = {
      ...l,
      pinned: [folder('T', [folder('U', [])]), folder('V', [folder('W', [folder('Q', [])])])],
    };
    expect(pinStep(tall, 'V', -1)).toMatchObject({ dest: root(0), how: 'above', ref: 'T' });
    // T is two levels tall: inside V its child U sits at depth 3, which is allowed.
    expect(pinStep(tall, 'T', 1)).toMatchObject({ dest: inFolder('V', 0), how: 'into' });
  });

  it('reorders Essentials one tile at a time', () => {
    expect(pinStep(l, 'e1', 1)).toMatchObject({
      dest: { zone: 'essentials', index: 1 },
      how: 'below',
      ref: 'e2',
    });
    expect(pinStep(l, 'e2', -1)).toMatchObject({ dest: { zone: 'essentials', index: 0 } });
    expect(pinStep(l, 'e1', -1)).toEqual({ edge: true });
    expect(pinStep(l, 'e2', 1)).toEqual({ edge: true });
  });

  it('returns null for a missing node', () => {
    expect(pinStep(l, 'gone', 1)).toBeNull();
  });
});
