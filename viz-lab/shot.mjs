// Viz lab — screenshot one category (or the whole page) of index.html with Edge.
// Run: node viz-lab/shot.mjs <section-id|all> [out.png] [page.html]   page defaults to index.html   → prints console errors, writes the png
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = (() => {
  try { return require('playwright-core'); }
  catch { return require(process.env.PLAYWRIGHT_CORE_PATH || join(process.env.LOCALAPPDATA || '', 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core')); }
})();
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const dir = dirname(fileURLToPath(import.meta.url));
const id = process.argv[2] || 'all';
const out = resolve(process.argv[3] || join(dir, 'shots', id + '.png'));

const browser = await pw.chromium.launch({ executablePath: edge, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await page.goto(pathToFileURL(join(dir, process.argv[4] || 'index.html')).href);
  await page.waitForTimeout(600);
  if (id === 'all') await page.screenshot({ path: out, fullPage: true });
  else { await page.addStyleTag({ content: '.lab-top{position:static}' }); await page.locator('#' + id).screenshot({ path: out }); }
  console.log(out);
  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
} finally { await browser.close(); }
