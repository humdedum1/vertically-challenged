/**
 * Dominant-colour extraction for Essentials tile tinting. Takes raw RGBA so it stays pure:
 * the caller draws the favicon into a 16×16 canvas and passes the pixels in.
 */

const MIN_ALPHA = 128;
// Near-white and near-black favicon pixels are usually background or outline, not identity.
const MAX_LIGHTNESS = 0.92;
const MIN_LIGHTNESS = 0.08;
// Greys carry no hue, so they can't name a colour.
const MIN_SATURATION = 0.15;
const BUCKETS = 24;
const BUCKET_DEGREES = 360 / BUCKETS;

/**
 * Buckets the saturated, mid-tone pixels by hue, picks the most populated bucket, and
 * returns the average RGB of its pixels as lowercase `#rrggbb`. Returns null when no pixel
 * survives the filters. Ties go to the lower hue bucket so the result is deterministic.
 */
export function dominantColor(rgba: Uint8ClampedArray): string | null {
  const counts = new Array<number>(BUCKETS).fill(0);
  const sums = Array.from({ length: BUCKETS }, () => [0, 0, 0]);

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 0) < MIN_ALPHA) continue;
    const r = (rgba[i] ?? 0) / 255;
    const g = (rgba[i + 1] ?? 0) / 255;
    const b = (rgba[i + 2] ?? 0) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;
    if (lightness > MAX_LIGHTNESS || lightness < MIN_LIGHTNESS || delta === 0) continue;
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (saturation < MIN_SATURATION) continue;

    let hue: number;
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;

    const bucket = Math.floor(hue / BUCKET_DEGREES) % BUCKETS;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    const sum = sums[bucket] as number[];
    sum[0] = (sum[0] ?? 0) + (rgba[i] ?? 0);
    sum[1] = (sum[1] ?? 0) + (rgba[i + 1] ?? 0);
    sum[2] = (sum[2] ?? 0) + (rgba[i + 2] ?? 0);
  }

  let best = -1;
  let bestCount = 0;
  counts.forEach((count, bucket) => {
    if (count > bestCount) {
      best = bucket;
      bestCount = count;
    }
  });
  if (best < 0) return null;

  const sum = sums[best] as number[];
  return `#${sum.map((channel) => toHexByte(channel / bestCount)).join('')}`;
}

function toHexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}
