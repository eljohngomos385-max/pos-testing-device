/* Sharp screenshots for the owner: one PNG per matching element, at 3x pixel density (a phone's), never scaled or JPEG'd.
   The in-app browser's shots come back as 800px JPEGs, which read blurry.

     node scripts/shot.mjs <url> <selector> <out-prefix> [--width=1100] [--scale=3]
     node scripts/shot.mjs http://localhost:8655/receipt-look-lab/ .look shots/receipt-r4
       -> shots/receipt-r4-01.png, -02.png, ...                                                              */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [url, selector, prefix] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flag = (k, d) => Number((process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1]) || d;
if (!prefix) { console.error('usage: node scripts/shot.mjs <url> <selector> <out-prefix> [--width=1100] [--scale=3]'); process.exit(2); }

function loadPlaywright() {
  try { return require('playwright-core'); }
  catch (_) {
    const fallback = process.env.PLAYWRIGHT_CORE_PATH
      || join(process.env.LOCALAPPDATA || '', 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core');
    if (fallback && existsSync(fallback)) return require(fallback);
    throw new Error('playwright-core was not found. Install it or set PLAYWRIGHT_CORE_PATH.');
  }
}

function edgePath() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Microsoft Edge was not found. Set EDGE_PATH to the browser executable.');
  return found;
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: edgePath(), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: flag('width', 1100), height: 900 }, deviceScaleFactor: flag('scale', 3) });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const els = await page.locator(selector).all();
  for (const [i, el] of els.entries()) {
    const out = `${prefix}-${String(i + 1).padStart(2, '0')}.png`;
    await el.screenshot({ path: out });
    console.log(out);
  }
  if (!els.length) { console.error(`no element matches ${selector}`); process.exitCode = 1; }
} finally {
  await browser.close();
}
