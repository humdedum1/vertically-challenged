/**
 * Generates the extension icons in public/icon/ (16, 32, 48 and 128 px).
 *
 * Run once with `node scripts/generate-icons.mjs` and commit the outputs.
 * Zero dependencies: PNG encoding uses node:zlib plus a local CRC32.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = fileURLToPath(new URL('../public/icon/', import.meta.url));
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const COLORS = {
  background: hexToRgb('#0b1215'),
  border: hexToRgb('#2a3d44'),
  activeTab: hexToRgb('#3fd0c4'),
  inactiveTab: hexToRgb('#8fa6ab'),
  accent: hexToRgb('#c9a45c'),
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function mix(foreground, background, opacity) {
  return foreground.map((channel, i) => channel * opacity + background[i] * (1 - opacity));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Point-in-rounded-rect test; the rect is x, y, w, h with corner radius r. */
function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) {
    return false;
  }
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Describes the icon geometry in pixels. Below 32px the border is dropped and
 * the tab bars use a fixed 2px height so the vertical-tab read survives.
 */
function layoutIcon(size) {
  const tiny = size <= 16;
  const barHeight = tiny ? 2 : size * 0.14;
  const barGap = tiny ? 2 : size * 0.1;
  const stackHeight = 3 * barHeight + 2 * barGap;
  const stackTop = (size - stackHeight) / 2;
  const barLeft = size * 0.24;
  const barWidth = size * 0.46;

  const bars = [0, 1, 2].map((index) => ({
    x: barLeft,
    y: stackTop + index * (barHeight + barGap),
    w: barWidth,
    h: barHeight,
    color: index === 0 ? COLORS.activeTab : COLORS.inactiveTab,
    opacity: index === 0 ? 1 : 0.45,
  }));
  const accent = {
    x: size * 0.14,
    y: bars[0].y,
    w: Math.max(1, size * 0.05),
    h: barHeight,
    color: COLORS.accent,
    opacity: 1,
  };

  return {
    size,
    radius: size * 0.22,
    borderWidth: tiny ? 0 : Math.max(1, size / 64),
    shapes: [accent, ...bars],
  };
}

/** Returns the RGB colour at a sub-pixel point, or null outside the icon. */
function sampleColor(layout, sx, sy) {
  const { size, radius, borderWidth: bw } = layout;
  if (!insideRoundedRect(sx, sy, 0, 0, size, size, radius)) {
    return null;
  }

  let color = COLORS.background;
  const innerInside =
    bw > 0 &&
    insideRoundedRect(sx, sy, bw, bw, size - 2 * bw, size - 2 * bw, Math.max(0, radius - bw));
  if (bw > 0 && !innerInside) {
    color = COLORS.border;
  }

  for (const shape of layout.shapes) {
    const r = Math.min(shape.w, shape.h) / 2;
    if (insideRoundedRect(sx, sy, shape.x, shape.y, shape.w, shape.h, r)) {
      color = mix(shape.color, color, shape.opacity);
    }
  }
  return color;
}

/** Averages SUPERSAMPLE^2 samples per pixel; alpha is the covered fraction. */
function renderPixel(layout, x, y) {
  const total = SUPERSAMPLE * SUPERSAMPLE;
  const sum = [0, 0, 0];
  let covered = 0;

  for (let j = 0; j < SUPERSAMPLE; j++) {
    for (let i = 0; i < SUPERSAMPLE; i++) {
      const color = sampleColor(layout, x + (i + 0.5) / SUPERSAMPLE, y + (j + 0.5) / SUPERSAMPLE);
      if (color) {
        covered++;
        for (let c = 0; c < 3; c++) {
          sum[c] += color[c];
        }
      }
    }
  }

  if (covered === 0) {
    return [0, 0, 0, 0];
  }
  return [
    Math.round(sum[0] / covered),
    Math.round(sum[1] / covered),
    Math.round(sum[2] / covered),
    Math.round((255 * covered) / total),
  ];
}

function renderIcon(size) {
  const layout = layoutIcon(size);
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      rgba.set(renderPixel(layout, x, y), (y * size + x) * 4);
    }
  }
  return rgba;
}

/** Prefixes each RGBA scanline with filter type 0 (None), as PNG requires. */
function addFilterBytes(width, height, rgba) {
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    out[y * (stride + 1)] = 0;
    rgba.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return out;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGBA 8-bit (colour type 6) pixels as a PNG file. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(addFilterBytes(width, height, rgba))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(size, size, renderIcon(size));
    const file = join(OUT_DIR, `${size}.png`);
    writeFileSync(file, png);
    console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`);
  }
}

main();
