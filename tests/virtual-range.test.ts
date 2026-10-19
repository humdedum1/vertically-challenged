import { describe, expect, it } from 'vitest';
import { computeRange, scrollToReveal } from '../src/lib/virtual-range';

describe('computeRange', () => {
  it('empty list', () => {
    expect(computeRange(0, 400, 20, 0)).toEqual({ start: 0, end: 0, offset: 0, totalHeight: 0 });
  });

  it('non-positive row height yields an empty range', () => {
    expect(computeRange(0, 400, 0, 10)).toEqual({ start: 0, end: 0, offset: 0, totalHeight: 0 });
  });

  it('top of list', () => {
    // visible = ceil(400/20)+1 = 21; end = 0 + 21 + 8
    expect(computeRange(0, 400, 20, 1000)).toEqual({
      start: 0,
      end: 29,
      offset: 0,
      totalHeight: 20000,
    });
  });

  it('middle with overscan', () => {
    // first = 50, start = 42, end = 50 + 21 + 8 = 79
    expect(computeRange(1000, 400, 20, 1000)).toEqual({
      start: 42,
      end: 79,
      offset: 840,
      totalHeight: 20000,
    });
  });

  it('custom overscan', () => {
    const r = computeRange(1000, 400, 20, 1000, 0);
    expect(r.start).toBe(50);
    expect(r.end).toBe(71);
  });

  it('clamped at bottom', () => {
    // maxTop = 19600, first = 980
    const r = computeRange(19600, 400, 20, 1000);
    expect(r.end).toBe(1000);
    expect(r.start).toBe(972);
    expect(r.offset).toBe(972 * 20);
  });

  it('scrollTop beyond max behaves like max', () => {
    expect(computeRange(1e9, 400, 20, 1000)).toEqual(computeRange(19600, 400, 20, 1000));
  });

  it('negative scrollTop behaves like 0', () => {
    expect(computeRange(-500, 400, 20, 1000)).toEqual(computeRange(0, 400, 20, 1000));
  });

  it('viewport larger than content renders everything', () => {
    const r = computeRange(0, 1000, 20, 5);
    expect(r).toEqual({ start: 0, end: 5, offset: 0, totalHeight: 100 });
    expect(computeRange(300, 1000, 20, 5)).toEqual(r);
  });
});

describe('scrollToReveal', () => {
  it('row above the viewport: align to its top', () => {
    expect(scrollToReveal(2, 100, 200, 20)).toBe(40);
  });

  it('row below the viewport: align its bottom to the viewport bottom', () => {
    // bottom = 11*20 = 220; 220 - 200 = 20
    expect(scrollToReveal(10, 0, 200, 20)).toBe(20);
  });

  it('row already visible returns null', () => {
    expect(scrollToReveal(3, 0, 200, 20)).toBeNull();
    // exactly fitting at both edges
    expect(scrollToReveal(5, 100, 200, 20)).toBeNull();
    expect(scrollToReveal(14, 100, 200, 20)).toBeNull();
  });

  it('partially visible rows are revealed', () => {
    expect(scrollToReveal(4, 90, 200, 20)).toBe(80);
    expect(scrollToReveal(15, 100, 200, 20)).toBe(120);
  });
});
