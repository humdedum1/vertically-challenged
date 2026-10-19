import { describe, expect, it } from 'vitest';
import { segments } from './highlight';

describe('segments', () => {
  it('returns one plain segment without ranges', () => {
    expect(segments('Bravo', [])).toEqual([{ text: 'Bravo', hit: false }]);
  });
  it('splits around ranges', () => {
    expect(segments('Bravo', [[0, 4]])).toEqual([
      { text: 'Brav', hit: true },
      { text: 'o', hit: false },
    ]);
  });
  it('clamps out-of-range ends', () => {
    expect(segments('ab', [[1, 9]])).toEqual([
      { text: 'a', hit: false },
      { text: 'b', hit: true },
    ]);
  });
});
