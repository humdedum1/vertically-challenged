import { describe, expect, it } from 'vitest';
import { dominantColor } from '../src/sidepanel/model/tint';

/** Builds RGBA bytes from [r, g, b, a] tuples; each tuple is one pixel. */
function pixels(...px: [number, number, number, number][]): Uint8ClampedArray {
  return new Uint8ClampedArray(px.flat());
}

function repeat(
  n: number,
  px: [number, number, number, number],
): [number, number, number, number][] {
  return Array.from({ length: n }, () => px);
}

function expectNear(hex: string | null, [r, g, b]: [number, number, number], tol = 8): void {
  expect(hex).not.toBeNull();
  const n = Number.parseInt((hex as string).slice(1), 16);
  expect(Math.abs(((n >> 16) & 0xff) - r)).toBeLessThanOrEqual(tol);
  expect(Math.abs(((n >> 8) & 0xff) - g)).toBeLessThanOrEqual(tol);
  expect(Math.abs((n & 0xff) - b)).toBeLessThanOrEqual(tol);
}

describe('dominantColor', () => {
  it('returns the colour of a solid red image', () => {
    expectNear(dominantColor(pixels(...repeat(256, [255, 0, 0, 255]))), [255, 0, 0]);
  });

  it('returns null for white-only and transparent-only images', () => {
    expect(dominantColor(pixels(...repeat(256, [255, 255, 255, 255])))).toBeNull();
    expect(dominantColor(pixels(...repeat(256, [255, 0, 0, 0])))).toBeNull();
  });

  it('ignores near-black and unsaturated grey pixels', () => {
    expect(dominantColor(pixels(...repeat(256, [10, 5, 5, 255])))).toBeNull();
    expect(dominantColor(pixels(...repeat(256, [128, 128, 128, 255])))).toBeNull();
  });

  it('picks the blue over a grey majority-free mix', () => {
    const img = pixels(...repeat(70, [0, 0, 255, 255]), ...repeat(30, [128, 128, 128, 255]));
    expectNear(dominantColor(img), [0, 0, 255]);
  });

  it('picks the most populated hue bucket', () => {
    const img = pixels(...repeat(40, [0, 200, 0, 255]), ...repeat(60, [200, 0, 200, 255]));
    expectNear(dominantColor(img), [200, 0, 200]);
  });

  it('ignores pixels below the alpha threshold', () => {
    const img = pixels(...repeat(10, [0, 0, 255, 127]), ...repeat(5, [255, 0, 0, 255]));
    expectNear(dominantColor(img), [255, 0, 0]);
  });

  it('always returns lowercase #rrggbb', () => {
    const samples = [
      pixels(...repeat(16, [255, 171, 0, 255])),
      pixels(...repeat(16, [10, 200, 90, 255])),
      pixels(...repeat(16, [250, 10, 240, 255])),
    ];
    for (const img of samples) {
      expect(dominantColor(img)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
