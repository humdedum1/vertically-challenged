// Builds the store images from the style screenshots (docs/store/style-*.png, from
// tests/e2e/shots.mjs): 1280x800 images showing each view in all three styles with numbered
// callouts, and the 440x280 small promo tile.
//   node scripts/store-assets.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = 'docs/store';
const SKINS = ['Classic', 'Dense', 'Glass'];
const png = (path) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
const shot = (view, skin) => png(`${OUT}/style-${view}-${skin.toLowerCase()}.png`);

// `at` is the height a callout points to on the Classic panel, as a fraction of the panel. Keep
// callouts sorted so their leader lines don't cross.
const SHOTS = [
  {
    file: 'store-1-tabs',
    view: 'tabs',
    light: true,
    title: 'Every tab, one fast list',
    sub: 'All your windows in one vertical list, in the style you like.',
    callouts: [
      { at: 0.252, head: 'Search or command', text: 'Type to filter, or > for commands' },
      { at: 0.329, head: 'Staples', text: 'Your everyday sites, one click away' },
      { at: 0.413, head: 'Pinned folders', text: 'Keep pinned tabs sorted and tidy' },
      { at: 0.625, head: 'Active tab', text: 'Always easy to spot' },
      { at: 0.9, head: 'Recently closed', text: 'Bring back a tab in one click' },
    ],
    facts: ['Every window', 'Tab groups', 'Snooze', 'Suspend', 'Sync'],
  },
  {
    file: 'store-2-search',
    view: 'search',
    zoom: 'Classic',
    light: false,
    title: 'Find it before you finish typing',
    sub: 'One box for everything you have open, saved or visited.',
    callouts: [
      { at: 0.25, head: 'One search box', text: 'Type > to run commands instead' },
      { at: 0.31, head: 'Instant matches', text: 'Hits are highlighted as you type' },
      { at: 0.476, head: 'Fuzzy matching', text: 'Partial words still match' },
    ],
    facts: ['Tabs', 'Bookmarks', 'History', 'Saved sessions', '> Commands'],
  },
  {
    file: 'store-3-history',
    view: 'history',
    zoom: 'Classic',
    light: true,
    title: 'Your history, by day',
    sub: 'Search and reopen anything you visited, without leaving the panel.',
    callouts: [
      { at: 0.24, head: 'Search history', text: 'Find a page by title or address' },
      { at: 0.306, head: 'Grouped by day', text: 'Newest first, with the time of each visit' },
      { at: 0.41, head: 'Reopen in a click', text: 'Every entry is one click away' },
    ],
    facts: ['No new tab needed', 'Delete entries you choose', 'Nothing is copied or uploaded'],
  },
  {
    file: 'store-4-settings',
    view: 'settings',
    light: false,
    title: 'Make it your own',
    sub: 'Pick a style, then tune it until it feels like yours.',
    callouts: [
      { at: 0.255, head: 'Search settings', text: 'Jump straight to any option' },
      { at: 0.61, head: 'Themes', text: 'Choose one, or edit your own' },
      { at: 0.72, head: 'Density', text: 'Compact or comfortable' },
      { at: 0.83, head: 'Style', text: 'Classic, Dense or Glass' },
    ],
    facts: ['Custom CSS', 'Keyboard shortcuts', 'Sync', 'Encrypted backups'],
  },
];

const BASE = `*{box-sizing:border-box;margin:0}body{font-family:'Noto Sans',sans-serif;overflow:hidden}`;

const PANEL_W = 290;
const PANEL_H = Math.round((PANEL_W * 1280) / 720);
const PANEL_X = 330;
const PANEL_Y = 172;
const GAP = 20;
const LEGEND_R = 296;
const LEGEND_GAP = 76;
// `zoom` slides show one style, larger and cropped to the top of the panel.
const ZOOM_W = 520;
const ZOOM_H = 528;
const ZOOM_X = 420;

function slide(s) {
  const c = s.light
    ? {
        bg: '#f4f6fb,#dde4f0',
        ink: '#15171c',
        soft: '#4a5160',
        accent: '#0071e3',
        chip: '#ffffffb3',
      }
    : {
        bg: '#1a1d24,#0d0e12',
        ink: '#f3f5f9',
        soft: '#a9b0bf',
        accent: '#7cb7ff',
        chip: '#ffffff14',
      };
  // Sit each label level with its target, pushed down just enough not to overlap the last one.
  const panelH = s.zoom ? (ZOOM_W * 1280) / 720 : PANEL_H;
  const panelX = s.zoom ? ZOOM_X : PANEL_X;
  const ys = [];
  for (const k of s.callouts) {
    const y = PANEL_Y + k.at * panelH;
    ys.push(ys.length ? Math.max(y, ys[ys.length - 1] + LEGEND_GAP) : y);
  }
  const legendY = (i) => ys[i];
  const legend = s.callouts
    .map(
      (k, i) =>
        `<div class="k" style="top:${legendY(i)}px"><b><i>${i + 1}</i>${k.head}</b><span>${k.text}</span></div>`,
    )
    .join('');
  const lines = s.callouts
    .map((k, i) => {
      const y = PANEL_Y + k.at * panelH;
      return `<path d="M${LEGEND_R} ${legendY(i)}H${LEGEND_R + 8}L${panelX - 8} ${y}H${panelX + 4}"/><circle cx="${panelX + 4}" cy="${y}" r="5"/>`;
    })
    .join('');
  const panels = s.zoom
    ? `<figure class="zoom" style="left:${ZOOM_X}px"><figcaption>${s.zoom}</figcaption><img src="${shot(s.view, s.zoom)}"></figure>`
    : SKINS.map(
        (skin, i) =>
          `<figure style="left:${PANEL_X + i * (PANEL_W + GAP)}px"><figcaption>${skin}</figcaption><img src="${shot(s.view, skin)}"></figure>`,
      ).join('');
  return `<style>${BASE}
  body{width:1280px;height:800px;position:relative;background:linear-gradient(${c.bg});color:${c.ink}}
  h1{position:absolute;left:56px;top:22px;font-size:46px;font-weight:800;letter-spacing:-.5px}
  p{position:absolute;left:56px;top:90px;font-size:21px;color:${c.soft}}
  figure{position:absolute;top:${PANEL_Y}px;width:${PANEL_W}px}
  figcaption{position:absolute;top:-30px;left:2px;font-size:17px;font-weight:700;color:${c.accent}}
  img{display:block;width:${PANEL_W}px;height:${PANEL_H}px;border-radius:14px;box-shadow:0 10px 28px #0006}
  .zoom{width:${ZOOM_W}px;height:${ZOOM_H}px;overflow:hidden;border-radius:14px 14px 0 0;box-shadow:0 10px 28px #0006;-webkit-mask:linear-gradient(#000 85%,#0000)}
  .zoom figcaption{display:none}
  .zoom img{width:${ZOOM_W}px;height:auto;border-radius:0;box-shadow:none}
  .k{position:absolute;left:56px;width:${LEGEND_R - 64}px;transform:translateY(-50%)}
  .k b{display:flex;align-items:center;gap:8px;font-size:16px}
  .k i{flex:none;width:22px;height:22px;border-radius:50%;background:${c.accent};color:${s.light ? '#fff' : '#0d0e12'};font:700 13px/22px 'Noto Sans';text-align:center}
  .k span{display:block;margin:3px 0 0 30px;font-size:14px;line-height:1.3;color:${c.soft}}
  svg{position:absolute;inset:0}svg path{fill:none;stroke:${c.accent};stroke-width:1.5}
  svg circle{fill:${c.accent};stroke:${s.light ? '#fff' : '#0d0e12'};stroke-width:2}
  ul{position:absolute;left:56px;right:40px;top:716px;height:44px;display:flex;gap:10px;justify-content:center;list-style:none;padding:0}
  li{padding:0 18px;line-height:44px;border-radius:22px;background:${c.chip};font-size:16px;font-weight:600;white-space:nowrap}
  </style><h1>${s.title}</h1><p>${s.sub}</p>${panels}${legend}
  <svg width="1280" height="800">${lines}</svg>
  <ul>${s.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
}

// One large crop of the Staples and pinned folder: Chrome's guidance is to avoid small text here.
const promo = () => `<style>${BASE}
  body{width:440px;height:280px;position:relative;background:linear-gradient(#1a1d24,#0d0e12);color:#f3f5f9}
  .logo{position:absolute;left:24px;top:36px;width:56px;height:56px}
  h1{position:absolute;left:24px;top:104px;font-size:27px;line-height:1.15;font-weight:800}
  p{position:absolute;left:24px;top:178px;width:170px;font-size:16px;line-height:1.3;color:#a9b0bf}
  .crop{position:absolute;left:196px;top:24px;width:226px;height:256px;overflow:hidden;border-radius:12px 12px 0 0;box-shadow:0 6px 18px #000a}
  .crop img{display:block;width:250px;margin:-108px 0 0 -12px}
  </style><img class="logo" src="${png('public/icon/128.png')}"><h1>Vertically<br>Challenged</h1>
  <p>Vertical tabs, Staples and pinned folders</p>
  <div class="crop"><img src="${shot('tabs', 'Glass')}"></div>`;

const browser = await chromium.launch();
const render = async (html, width, height, file, deviceScaleFactor = 1) => {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`, { waitUntil: 'load' });
  await page.screenshot({ path: `${OUT}/${file}.png` });
  await page.close();
};
for (const s of SHOTS) await render(slide(s), 1280, 800, s.file);
await render(promo(), 440, 280, 'store-promo-small');
// The README shows the tile larger; 2x keeps it sharp there.
await render(promo(), 440, 280, 'readme-promo', 2);
await browser.close();
