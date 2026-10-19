import { describe, expect, it } from 'vitest';
import { hitTest } from './pointer-drag';

const isGroup = (i: number) => i === 2;

describe('hitTest', () => {
  it('splits tab rows into before/after halves', () => {
    expect(hitTest(5, 34, 5, isGroup)).toEqual({ index: 0, zone: 'before' });
    expect(hitTest(30, 34, 5, isGroup)).toEqual({ index: 0, zone: 'after' });
  });
  it('gives group rows before/inside/after bands', () => {
    expect(hitTest(68 + 2, 34, 5, isGroup)?.zone).toBe('before');
    expect(hitTest(68 + 17, 34, 5, isGroup)?.zone).toBe('inside');
    expect(hitTest(68 + 32, 34, 5, isGroup)?.zone).toBe('after');
  });
  it('clamps outside the content', () => {
    expect(hitTest(-10, 34, 5, isGroup)).toEqual({ index: 0, zone: 'before' });
    expect(hitTest(9999, 34, 5, isGroup)).toEqual({ index: 4, zone: 'after' });
    expect(hitTest(10, 34, 0, isGroup)).toBeNull();
  });
});
