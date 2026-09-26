/* Machine check that the ported calm pages still match their approved labs, rule by rule.
   Reads every selector from the lab's own <style>, maps it the way bo-calm.css was generated
   (lab body → the .view root, main → .c-main, aside → .c-aside, everything else prefixed with
   the root), then compares computed style + box size of the first 5 matches in each page.
   The lab is fed the app's demo data (same in-memory localStorage shim as demo-fill.js).

     python scripts/serve.py            (already running on :8080)
     node scripts/design-check.mjs      exits 1 on any mismatch
     BASE=http://127.0.0.1:8080 node scripts/design-check.mjs                                  */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = process.env.BASE || 'http://127.0.0.1:8080';

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

const pad = n => String(n).padStart(2, '0');
const d = new Date(), TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const CASES = [
  ['Sales', '/sales-calendar-lab.html', '/admin/sales', '?month=2026-07', '.view.calm-sales'],
  ['Sales, day open', '/sales-calendar-lab.html', '/admin/sales', '?month=2026-07&day=2026-07-14', '.view.calm-sales'],
  ['Dashboard', '/dashboard-calm-lab.html', '/admin', '?range=7d&vs=none', '.view.calm-dash'],
  ['Dashboard, bar open', '/dashboard-calm-lab.html', '/admin', `?range=7d&vs=none&at=${TODAY}`, '.view.calm-dash'],
  ['Transactions', '/transactions-compact-lab.html', '/admin/sales', '?by=tx&range=7d', '.view.calm-tx'],
  ['Transactions, filtered', '/transactions-compact-lab.html', '/admin/sales', '?by=tx&range=30d&pay=gcash', '.view.calm-tx'],
];
// Differences that are data or port plumbing, not design. Keyed "selector|prop" (lab selector), or "selector|count".
const WHITELIST = new Map([
  ['.bar h1|width', 'greeting: the app defaults the cashier to "El John", the lab to "there"'],
  ['.bar h1|margin', 'same greeting: its auto right margin takes up the difference'],
  ['dialog|margin', 'the pop-up centres in the viewport, and the app viewport also holds the sidebar'],
]);

// ---- in-page helpers (serialised into the page) ----
function labSelectors() {
  const out = new Set(), skip = /:(hover|focus|focus-visible|focus-within|active|visited|popover-open)|::|^\*|^:root|^html/;
  const walk = rules => { for (const r of rules) {
    if (r.cssRules && !(r instanceof CSSStyleRule)) walk(r.cssRules);
    else if (r.selectorText) r.selectorText.split(',').map(s => s.trim()).filter(s => s && !skip.test(s)).forEach(s => out.add(s));
  } };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules); } catch (_) {} }   // Google Fonts sheet is cross-origin
  return [...out];
}
function measure(pairs) {   // [[key, selector]] -> { key: { n, items } }
  const PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textTransform', 'color', 'backgroundColor',
    'borderRadius', 'padding', 'margin', 'gap', 'display', 'gridTemplateColumns', 'textAlign', 'boxShadow', 'opacity'];
  const res = {};
  document.activeElement?.blur?.();   // a dialog autofocuses its first button; compare resting styles, not focus rings
  for (const [key, sel] of pairs) {
    let els; try { els = [...document.querySelectorAll(sel)]; } catch (_) { res[key] = { n: -1, items: [] }; continue; }
    res[key] = { n: els.length, items: els.slice(0, 5).map(el => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(), o = {};
      for (const p of PROPS) o[p] = cs[p];
      o.fontFamily = o.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (o.letterSpacing === 'normal') o.letterSpacing = '0px';
      for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
        const st = cs[`border${s}Style`];
        o[`border${s}`] = st === 'none' || st === 'hidden' ? 'none' : `${cs[`border${s}Width`]} ${st} ${cs[`border${s}Color`]}`;
      }
      o.width = r.width; o.height = r.height;
      return o;
    }) };
  }
  return res;
}
const toApp = (sel, root) => {
  const m = sel.replace(/(^|[\s>+~(])(main|aside)(?=$|[\s.#:[>+~)])/g, (_, a, t) => a + (t === 'main' ? '.c-main' : '.c-aside'));
  return /^body(?![\w-])/.test(m) ? m.replace(/^body/, root) : `${root} ${m}`;
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: edgePath(), headless: true });
let bad = 0;
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'hwpos_demo', value: '1', url: BASE }]);
  const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400); };
  for (const [name, labPath, appPath, query, root] of CASES) {
    const app = await ctx.newPage();
    await app.setViewportSize({ width: 1440, height: 900 });
    await app.goto(BASE + appPath + query);
    await app.waitForSelector(`${root}:not([hidden]) .c-main`);
    await settle(app);
    const { w, h, entries } = await app.evaluate(r => {
      const e = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); e.push([k, localStorage.getItem(k)]); }
      return { w: document.querySelector(r).getBoundingClientRect().width, h: innerHeight, entries: e };
    }, root);

    const lab = await ctx.newPage();
    await lab.addInitScript(entries => {
      const mem = new Map(entries);   // same shim as the top of scripts/demo-fill.js
      Object.defineProperty(window, 'localStorage', { configurable: true, value: {
        getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
        setItem: (k, v) => { mem.set(String(k), String(v)); },
        removeItem: (k) => { mem.delete(String(k)); },
        clear: () => mem.clear(),
        key: (i) => [...mem.keys()][i] ?? null,
        get length() { return mem.size; },
      } });
    }, entries);
    let vw = Math.round(w);
    for (let i = 0; i < 2; i++) {   // a scrollbar eats width: size the viewport so the lab body equals the app view
      await lab.setViewportSize({ width: vw, height: h });
      await lab.goto(BASE + labPath + query);
      await settle(lab);
      const bw = await lab.evaluate(() => document.body.getBoundingClientRect().width);
      if (Math.abs(bw - w) < 0.5) break;
      vw += Math.round(w - bw);
    }

    await lab.evaluate(() => document.getElementById('source')?.remove());   // the lab's "Reading N orders" dev line; the app has none
    await app.evaluate(() => document.querySelectorAll('[data-app-only]').forEach(e => e.remove()));   // extras the lab lacks on purpose, e.g. Transactions' "Ends on"
    const sels = await lab.evaluate(labSelectors);
    const L = await lab.evaluate(measure, sels.map(s => [s, s]));
    const A = await app.evaluate(measure, sels.map(s => [s, toApp(s, root)]));
    console.log(`\n== ${name}  (${query})  body ${w}px, ${sels.length} selectors`);
    for (const s of sels) {
      const l = L[s], a = A[s], out = [];
      if (l.n !== a.n && !WHITELIST.has(`${s}|count`)) out.push(`count: lab ${l.n}, app ${a.n}`);
      for (let i = 0; i < Math.min(l.items.length, a.items.length); i++) {
        for (const p of Object.keys(l.items[i])) {
          const lv = l.items[i][p], av = a.items[i][p];
          const same = typeof lv === 'number' ? Math.abs(lv - av) <= 1 : lv === av;
          if (!same && !WHITELIST.has(`${s}|${p}`)) out.push(`[${i}] ${p}: lab ${typeof lv === 'number' ? lv.toFixed(1) : lv} | app ${typeof av === 'number' ? av.toFixed(1) : av}`);
        }
      }
      if (out.length) { bad += out.length; console.log(`  ${s}\n    ${out.join('\n    ')}`); }
    }
    await lab.close(); await app.close();
  }
} finally {
  await browser.close();   // orphaned msedge.exe makes the other browser checks flaky
}
console.log(bad ? `\n${bad} mismatch(es)` : '\nlab and app match');
process.exit(bad ? 1 : 0);
