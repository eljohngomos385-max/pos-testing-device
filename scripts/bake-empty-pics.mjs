// Bakes the empty pages' silhouette (owner's C1/B3, emptyState in pos-lab/pos-core.js) into pictures, pos-lab/img/empty/:
// per drawing, <pic>.png -- the blurred field + rim -- and <pic>-obj.png -- the soft white shape -- as white PNGs whose alpha
// is the shape; plus grain.png, one seamless noise tile. The CSS paints var(--haze) + grain and var(--bg) through them, so
// no SVG filter runs on the POS: live filters made iPhone swipes lag (owner 2026-11-06). Every drawing is from
// empty-lab/silhouettes.html. Run after adding or changing one: node scripts/bake-empty-pics.mjs  (needs Edge + py with Pillow);
// a new one's name also goes in pos-core.js's prefetch list (EMPTY_PICS).
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const pw = require(join(process.env.LOCALAPPDATA, 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core'));
const ROOT = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/'), OUT = ROOT + 'pos-lab/img/empty/', RAW = OUT + 'raw/';
fs.mkdirSync(RAW, { recursive: true });
const ART = {
  search: '<circle cx="88" cy="88" r="42"/><rect x="-11" y="0" width="22" height="56" rx="11" transform="translate(116 116) rotate(-45)"/>',
  box: '<path class="mid" d="M52 86L32 58l58-6 10 34Z"/><path class="mid" d="M148 86l20-28-58-6-10 34Z"/><rect x="50" y="84" width="100" height="74" rx="7"/>',
  folder: '<path d="M42 64q0-9 9-9h30l11 11h57q9 0 9 9v68q0 9-9 9H51q-9 0-9-9Z"/>',
  folders: '<path class="far" d="M62 46q0-8 8-8h24l9 9h48q8 0 8 8v58q0 8-8 8H70q-8 0-8-8Z"/><path d="M40 72q0-9 9-9h28l10 10h52q9 0 9 9v62q0 9-9 9H49q-9 0-9-9Z"/>',
  tags: '<path class="far" fill-rule="evenodd" transform="rotate(-22 100 100) translate(14 -16)" d="M74 70h62q10 0 10 10v40q0 10-10 10H74l-26-30Z M62 100a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z"/><path fill-rule="evenodd" d="M72 72h70q10 0 10 10v44q0 10-10 10H72l-28-32Z M58 104a8 8 0 1 0 16 0a8 8 0 1 0-16 0Z"/>',
  receipt: '<path d="M60 38q0-6 6-6h68q6 0 6 6v124l-10-10-10 10-10-10-10 10-10-10-10 10-10-10-10 10Z"/>',
  people: '<g class="far"><circle cx="134" cy="66" r="19"/><path d="M98 132q0-38 36-38t36 38Z"/></g><circle cx="88" cy="80" r="24"/><path d="M40 162q0-46 48-46t48 46Z"/>',
  cash: '<path class="far" transform="rotate(-12 100 100) translate(6 -20)" d="M40 70q0-8 8-8h104q8 0 8 8v52q0 8-8 8H48q-8 0-8-8Z"/><path fill-rule="evenodd" d="M38 82q0-8 8-8h108q8 0 8 8v54q0 8-8 8H46q-8 0-8-8Z M85 109a15 15 0 1 0 30 0a15 15 0 1 0-30 0Z"/>',
  clock: '<circle cx="100" cy="100" r="56" mask="url(#sil-clockCut)"/>',
  sliders: '<g class="far"><rect x="44" y="64" width="112" height="9" rx="4.5"/><rect x="44" y="96" width="112" height="9" rx="4.5"/><rect x="44" y="128" width="112" height="9" rx="4.5"/></g><circle cx="78" cy="68.5" r="15"/><circle cx="128" cy="100.5" r="15"/><circle cx="92" cy="132.5" r="15"/>',
  addon: '<rect class="far" x="40" y="44" width="80" height="80" rx="20"/><rect x="64" y="68" width="84" height="84" rx="22" mask="url(#sil-plusCut)"/>',
};
const CUTS = `<mask id="sil-clockCut" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff"/>
        <path d="M100 100V62M100 100l26 15" stroke="#000" stroke-width="10" stroke-linecap="round" fill="none"/>
      </mask>
      <mask id="sil-plusCut" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
        <rect width="200" height="200" fill="#fff"/>
        <path d="M106 88v44M84 110h44" stroke="#000" stroke-width="12" stroke-linecap="round"/>
      </mask>`;
const BOX = 'filterUnits="userSpaceOnUse" x="-110" y="-110" width="420" height="420"';
const DEFS = `<defs>${CUTS}<filter id="f" ${BOX}><feGaussianBlur stdDeviation="30"/></filter>
  <filter id="r" ${BOX}><feMorphology operator="dilate" radius="16"/><feGaussianBlur stdDeviation="16"/></filter>
  <filter id="o" ${BOX}><feGaussianBlur stdDeviation="4.5"/></filter></defs>`;
const browser = await pw.chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 600, height: 600 } });
for (const [pic, art] of Object.entries(ART)) {
  await page.setContent(`<style>body{margin:0}</style><svg id="s" width="525" height="525" viewBox="-110 -110 420 420">${DEFS}
    <ellipse cx="100" cy="102" rx="98" ry="92" fill="#fff" opacity=".9" filter="url(#f)"/><g fill="#fff" filter="url(#r)">${art}</g></svg>`);
  await page.locator('#s').screenshot({ path: `${RAW}${pic}.png`, omitBackground: true });
  await page.setContent(`<style>body{margin:0} .far{opacity:.5} .mid{opacity:.78}</style><svg id="s" width="525" height="525" viewBox="-110 -110 420 420">${DEFS}
    <g fill="#fff" filter="url(#o)">${art}</g></svg>`);
  await page.locator('#s').screenshot({ path: `${RAW}${pic}-obj.png`, omitBackground: true });
}
// the grain: two fractal noises (dark-blue and white specks), stitched so the tile repeats; 128 CSS px = 102.4 units, at 3x
const g = await browser.newPage({ viewport: { width: 200, height: 200 }, deviceScaleFactor: 3 });
await g.setContent(`<style>body{margin:0}</style><svg id="s" width="128" height="128" viewBox="0 0 102.4 102.4"><defs>
  <filter id="g" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="0" y="0" width="102.4" height="102.4">
    <feTurbulence stitchTiles="stitch" type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="3" result="n1"/>
    <feColorMatrix in="n1" type="matrix" values="0 0 0 0 .1  0 0 0 0 .3  0 0 0 0 .75  1.0 0 0 0 -.45" result="d1"/>
    <feTurbulence stitchTiles="stitch" type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="11" result="n2"/>
    <feColorMatrix in="n2" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  .7 0 0 0 -.35" result="d2"/>
    <feMerge><feMergeNode in="d1"/><feMergeNode in="d2"/></feMerge></filter></defs>
  <rect width="102.4" height="102.4" fill="#fff" filter="url(#g)"/></svg>`);
await g.locator('#s').screenshot({ path: `${RAW}grain.png`, omitBackground: true });
await browser.close();
// half size is plenty for the 20px-soft haze (10 KB each); the shape (6px soft) keeps 1x; the grain keeps 3x, cut to 64 colours
execFileSync('py', ['-c', `
from PIL import Image
import os
R, O = ${JSON.stringify(RAW)}, ${JSON.stringify(OUT)}
for f in os.listdir(R):
    im = Image.open(R + f).convert('RGBA')
    if f == 'grain.png': im.quantize(64, method=Image.FASTOCTREE).save(O + f, optimize=True)
    else:
        a = im.getchannel('A')
        if not f.endswith('-obj.png'): a = a.resize((264, 264), Image.LANCZOS)
        w = Image.new('LA', a.size, 255); w.putalpha(a); w.save(O + f, optimize=True)
`], { stdio: 'inherit' });
fs.rmSync(RAW, { recursive: true });
console.log('baked', Object.keys(ART).length, 'pictures + grain into', OUT);
