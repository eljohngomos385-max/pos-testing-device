// Bakes the empty pages' pictures (emptyState in pos-lab/pos-core.js) from the owner's Grain lab, empty-lab/a4-grain.html
// (owner 2026-11-16): each picture is drawn there live (SVG mottle, colour table, rim, film grain) and shot here at 140 CSS px,
// 3x, light and dark, into pos-lab/img/empty/<pic>.webp and <pic>-dark.webp (WebP q92: ~25 KB each, PNG was ~130 KB;
// the grain survives, std 6.2 vs 6.4). The POS only shows the pictures, so no SVG
// filter runs on it: live filters made iPhone swipes lag (owner 2026-11-06). The pattern of each picture is the lab's,
// picked by its place in the lab page below, so a picture keeps its look whatever the POS adds or reorders.
// Run after changing a drawing in the lab: node scripts/bake-empty-pics.mjs  (needs Edge, playwright-core in node_modules,
// python3 with Pillow).
// A new picture also goes in pos-core.js's prefetch list (EMPTY_PICS).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const pw = require(ROOT + 'node_modules/playwright-core');
const OUT = ROOT + 'pos-lab/img/empty/', SIZE = 140, DPR = 3;
// POS picture -> its card in a4-grain.html (0-based, in page order)
const PICS = { search: 0, tag: 1, folder: 2, box: 3, receipt: 6, grid: 11, toggle: 12, plus: 13, percent: 14, person: 15, cash: 17, clock: 18 };
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await pw.chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: DPR });
for (const theme of ['light', 'dark']) {
  await page.goto('file://' + ROOT + 'empty-lab/a4-grain.html');
  if (theme === 'dark') await page.click('#tDark');
  await page.addStyleTag({ content: `html, body, main, .card { background: none !important; } .card { width: auto !important; height: auto !important; border: 0 !important; }
    .card svg { width: ${SIZE}px !important; height: ${SIZE}px !important; margin: 0 !important; }` });
  await page.waitForTimeout(600);   // the grain tile (feImage) loads and refits to the new size
  const svgs = await page.$$('.card svg');
  for (const [pic, i] of Object.entries(PICS))
    await svgs[i].screenshot({ path: `${OUT}${pic}${theme === 'dark' ? '-dark' : ''}.png`, omitBackground: true });
}
await browser.close();
execFileSync('python3', ['-c', `import glob, os
from PIL import Image
for f in glob.glob(${JSON.stringify(OUT)} + '*.png'):
    Image.open(f).save(f[:-4] + '.webp', quality=92, method=6); os.remove(f)`]);
console.log('baked', Object.keys(PICS).length * 2, 'pictures into', OUT);
