import { describe, expect, it } from 'vitest';
import type { PanelMessage } from '../src/shared/protocol';
import type { TabInfo } from '../src/shared/types';
import { type KeyMoveContext, planKeyMove } from '../src/sidepanel/model/key-move';
import type { Row } from '../src/sidepanel/model/rows';

const row = (id: number, title: string) =>
  ({ kind: 'tab', tab: { id, title, groupId: -1, pinned: false } as TabInfo }) as Extract<
    Row,
    { kind: 'tab' }
  >;
const plan = { type: 'x' } as unknown as PanelMessage;
const a = row(1, 'A');
const b = row(2, 'B');
const c = (over: Partial<KeyMoveContext> = {}): KeyMoveContext => ({
  view: [a, b],
  movableTargets: (t) => [t.id],
  isGroupedTab: () => false,
  planFor: () => plan,
  ...over,
});

describe('planKeyMove', () => {
  it('plans and announces a step over the neighbour', () => {
    expect(planKeyMove(c(), a, 1)).toEqual({ plan, announcement: 'Moved A below B' });
  });
  it('stops at the edge', () => {
    expect(planKeyMove(c(), a, -1)).toEqual({ plan: null, announcement: 'A is already first' });
  });
  it('explains a refused plan', () => {
    expect(planKeyMove(c({ planFor: () => null }), a, 1).announcement).toBe('Can’t move A below B');
  });
  it('refuses pinned tabs', () => {
    expect(planKeyMove(c({ movableTargets: () => [] }), a, 1).plan).toBeNull();
  });
});
