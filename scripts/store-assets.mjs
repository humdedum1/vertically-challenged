// Builds the Chrome Web Store images from the style screenshots (docs/store/style-*.png):
// 1280x800 images showing each view in all three styles, and the 440x280 small promo tile.
//   node scripts/store-assets.mjs        (needs ImageMagick 7 as `magick`)
import { execFileSync } from 'node:child_process';

const OUT = 'docs/store';
const SKINS = ['Classic', 'Dense', 'Glass'];
const SHOTS = [
  {
    file: 'store-1-tabs',
    view: 'tabs',
    light: true,
    title: 'Every tab, one fast list',
    sub: 'All windows in a vertical list, with child tabs, groups and search. In three styles.',
  },
  {
    file: 'store-2-search',
    view: 'search',
    light: false,
    title: 'Find it before you finish typing',
    sub: 'Fuzzy search over tabs, bookmarks, history and sessions. Type > for commands.',
  },
  {
    file: 'store-3-history',
    view: 'history',
    light: true,
    title: 'Your history, by day',
    sub: 'Search and reopen anything you visited, without leaving the panel.',
  },
  {
    file: 'store-4-settings',
    view: 'settings',
    light: false,
    title: 'Make it your own',
    sub: 'Pick a style, then tune themes, layout, shortcuts, sync and encrypted backups.',
  },
];
const run = (args) => execFileSync('magick', args, { stdio: 'inherit' });

const PANEL_W = 320;
const PANEL_H = Math.round((PANEL_W * 640) / 360);
const GAP = 40;
const PANEL_Y = 192;
const LEFT = (1280 - 3 * PANEL_W - 2 * GAP) / 2;

for (const s of SHOTS) {
  const [bg1, bg2, ink, soft, accent] = s.light
    ? ['#f4f6fb', '#dde4f0', '#15171c', '#4a5160', '#0071e3']
    : ['#1a1d24', '#0d0e12', '#f3f5f9', '#a9b0bf', '#7cb7ff'];
  const panels = SKINS.flatMap((skin, i) => {
    const x = LEFT + i * (PANEL_W + GAP);
    return [
      // A rounded panel with a soft shadow.
      '(',
      `${OUT}/style-${s.view}-${skin.toLowerCase()}.png`,
      '-resize',
      `${PANEL_W}x${PANEL_H}!`,
      '-alpha',
      'set',
      '(',
      '-size',
      `${PANEL_W}x${PANEL_H}`,
      'xc:none',
      '-fill',
      'white',
      '-draw',
      `roundrectangle 0,0 ${PANEL_W - 1},${PANEL_H - 1} 14,14`,
      ')',
      '-compose',
      'DstIn',
      '-composite',
      '-compose',
      'Over',
      '(',
      '+clone',
      '-background',
      'black',
      '-shadow',
      '40x14+0+8',
      ')',
      '+swap',
      '-background',
      'none',
      '-layers',
      'merge',
      '+repage',
      ')',
      '-gravity',
      'northwest',
      '-geometry',
      `+${x - 28}+${PANEL_Y - 28}`,
      '-composite',
      '-font',
      'Noto-Sans-Bold',
      '-pointsize',
      '20',
      '-fill',
      accent,
      '-annotate',
      `+${x + 2}+${PANEL_Y - 38}`,
      skin,
    ];
  });
  run([
    '-size',
    '1280x800',
    `gradient:${bg1}-${bg2}`,
    '-gravity',
    'northwest',
    '-font',
    'Noto-Sans-Bold',
    '-pointsize',
    '46',
    '-fill',
    ink,
    '-annotate',
    `+${LEFT}+30`,
    s.title,
    '-font',
    'Noto-Sans-Regular',
    '-pointsize',
    '22',
    '-fill',
    soft,
    '-annotate',
    `+${LEFT}+98`,
    s.sub,
    ...panels,
    `${OUT}/${s.file}.png`,
  ]);
}

run([
  '-size',
  '440x280',
  'gradient:#1a1d24-#0d0e12',
  'public/icon/128.png',
  '-gravity',
  'west',
  '-geometry',
  '+44+0',
  '-composite',
  '-font',
  'Noto-Sans-Bold',
  '-pointsize',
  '30',
  '-fill',
  '#f3f5f9',
  '-gravity',
  'northwest',
  '-annotate',
  '+190+84',
  'Vertically\nChallenged',
  '-font',
  'Noto-Sans-Regular',
  '-pointsize',
  '17',
  '-fill',
  '#a9b0bf',
  '-annotate',
  '+190+190',
  'Vertical tabs for Chrome',
  `${OUT}/store-promo-small.png`,
]);
