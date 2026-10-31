// node .claude/skills/start-lines/measure.cjs phone|ipad [before]
// Opens every page in PAGES, finds where it starts (the first painted box or line of words under the ☰ / ‹ row),
// screenshots it, and checks it against the start line. Writes <OUT>/<dev>/m.json (or <OUT>/before-<dev>/).
// Needs the pos-static server (127.0.0.1:8642) and Playwright from scripts' verify install. No app change.
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require(process.env.LOCALAPPDATA + '/Temp/pos-app-verify-playwright/node_modules/playwright-core');
const wait = ms => new Promise(r => setTimeout(r, ms));
const DEV = process.argv[2] || 'phone';
const OUT = process.env.START_LINES_OUT || path.join(os.tmpdir(), 'start-lines');
const dir = path.join(OUT, (process.argv[3] === 'before' ? 'before-' : '') + DEV);
const URL = process.env.START_LINES_URL || 'http://127.0.0.1:8642/pos-lab/index.html';
const LINE = { phone: 126, ipad: 76 }[DEV];   // Orders' first date band: head + 8 + 8 (owner 2026-10-31)
// owner 2026-10-31: these keep their own start, everything else sits on LINE
const EXCEPT = new Set(['Items', 'Refund', 'A customer', 'Item editor', 'Category editor', 'Modifier editor', 'Discount editor']);
// iPad pages with a list pane + a detail pane: each pane is checked apart (left = x < a third of the width)
// (Customers is not: its right pane is A customer, an exception, so only its list is checked)
const SPLITS = new Set(['Orders', 'An order', 'Refund', 'A customer']);
// [name, steps]: each step runs in the page, 600ms apart. A new page = one line here, opened the way a person reaches it.
const PAGES = [
  ['Orders', ["switchView('orders')"]],
  ['Items', ["switchView('items')"]],
  ['Customers', ["switchView('customers')"]],
  ['Shift', ["switchView('shift')"]],
  ['Reports', ["switchView('reports')"]],
  ['QR codes', ["switchView('qr')"]],
  ['Settings', ["switchView('settings')"]],
  ['Past shifts', ["switchView('orders'); switchView('shift')", 'shiftPast(true)']],
  ['Cash in & out', ["shiftPast(false); switchView('shift')", "[...document.querySelectorAll('.view-shift .rp-units button')].find(b => /Cash in/.test(b.textContent)).click()"]],
  ['QR table', ["switchView('qr')", "document.querySelector('[data-qr-open] .lb').click()"]],
  ['Payment types', ["switchView('settings')", 'openPayTypes(true)']],
  ['Payment type', ["openPayType('cash')"]],
  ['Ask for', ["openPayType('gcash')", "document.querySelector('#ptAskRow').click()"]],
  ['Add payment type', ['addPayType(); document.activeElement.blur()']],
  ['Fulfilment types', ['openFulTypes(true)']],
  ['Add fulfilment type', ['addFulType(); document.activeElement.blur()']],
  ['Setting choice', ["showStPage('settingsPage'); openPick(Object.keys(SETTING_PICKS)[0])"]],
  ['An order', ["showStPage('settingsPage'); switchView('orders')", "document.querySelector('.view-orders [data-order-id]').click()"]],
  ['Refund', ["document.querySelector('#orderRefund').click()"]],
  ['A customer', ["switchView('customers')", "document.querySelector('.view-customers [data-customer-id]').click()"]],
  ['Item editor', ["switchView('items')", 'openItemEditor(loadProducts()[0].id)']],
  ['Category editor', ['closeItemEditor()', "openKindEditor('cats', kindCats()[0].id)"]],
  ['Modifier editor', ['closeItemEditor()', "openKindEditor('mods', kindList('mods')[0].id)"]],
  ['Discount editor', ['closeItemEditor()', "openKindEditor('discs', liveDiscounts()[0].id)"]],
];
function measure() {
  const vw = innerWidth, onTop = (e, x, y) => { const h = document.elementFromPoint(x, y); return h && (e.contains(h) || h.contains(e)); };
  // the head row = the topmost visible ☰ or ‹ button; anything inside the head (Items' tabs) counts once it is below it
  const btns = [...document.querySelectorAll('button, a')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.left < 80 && r.top >= 0 && r.top < 140 && onTop(b, r.left + r.width / 2, r.top + r.height / 2); }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const cut = btns[0] ? btns[0].getBoundingClientRect().bottom : 110;
  const split = vw > 700 ? vw / 3 : vw;
  const firstIn = (lo, hi) => {
    let box = null;   // a painted box (fill, border or shadow) at least 180 wide, not covered
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect(); if (r.width < 180 || r.height < 20 || r.top < cut - 1 || r.top > innerHeight || r.left < lo - 1 || r.left >= hi) continue;
      const cs = getComputedStyle(e);
      const painted = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== 'none';
      if (painted && (!box || r.top < box.r.top) && onTop(e, r.left + Math.min(r.width / 2, 60), r.top + 3)) box = { e, r };
    }
    let text = null; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);   // a line of words, not covered
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
      if (!r.height || r.top < cut - 1 || r.top > innerHeight || r.left < lo - 1 || r.left >= hi || r.right < 0) continue;
      if (!onTop(n.parentElement, Math.max(1, r.left + 2), r.top + r.height / 2)) continue;
      if (!text || r.top < text.top) text = { top: r.top, s: n.textContent.trim().slice(0, 24) };
    }
    return { box, text, start: Math.round(Math.min(box ? box.r.top : 1e9, text ? text.top : 1e9)) };
  };
  const L = firstIn(0, split), R = split < vw ? firstIn(split, vw) : null;
  const nz = n => (n >= 1e9 ? null : n);
  const { box, text } = L.start <= (R ? R.start : 1e9) ? L : R;
  // where the gap comes from: the first thing and its parents (top, padding-top, margin-top) — the rule to change is in here
  const first = box && (!text || box.r.top <= text.top) ? box.e : text && document.elementFromPoint(20, text.top + 2);
  const chain = []; for (let e = first, i = 0; e && i < 6 && e !== document.body; e = e.parentElement, i++) { const c = getComputedStyle(e); chain.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${e.className.toString().split(' ').slice(0, 3).join('.')} t${Math.round(e.getBoundingClientRect().top)} pt${c.paddingTop} mt${c.marginTop}`); }
  return { start: nz(Math.min(L.start, R ? R.start : 1e9)), left: nz(L.start), right: R ? nz(R.start) : null, text: text ? text.s : '', chain };
}
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const ctx = await b.newContext(DEV === 'ipad' ? { viewport: { width: 1180, height: 820 }, hasTouch: true } : { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await wait(900);
  const biz = p.locator('[data-v="food"]').first(); if (await biz.isVisible().catch(() => false)) { await biz.click(); await wait(400); }   // food: QR codes exist
  await p.evaluate(dev => { if (dev === 'phone') document.documentElement.style.setProperty('--ph-top', '58px'); state.theme = 'light'; paintTheme(); }, DEV);   // phone: the iPhone's 58 status strip
  const out = {}; let off = 0;
  for (const [name, steps] of PAGES) {
    try { for (const s of steps) { await p.evaluate(s); await wait(600); } }
    catch (e) { out[name] = { err: e.message.split('\n')[0] }; console.log(`ERR  ${name}: ${out[name].err}`); off++; continue; }
    await wait(300);
    const m = out[name] = await p.evaluate(measure);
    await p.screenshot({ path: path.join(dir, name.replace(/[^a-z0-9]+/gi, '-') + '.png') });
    // iPad split pages: both panes on the line; else the page's start
    const vals = DEV === 'ipad' && SPLITS.has(name) ? [m.left, m.right] : [m.start];
    const ok = vals.every(v => v === LINE), ex = EXCEPT.has(name);
    if (!ok && !ex) off++;
    console.log(`${ok ? 'ok ' : ex ? 'exc' : 'OFF'}  ${name.padEnd(20)} ${vals.join(' | ')}${ok ? '' : `  (${vals.map(v => (v > LINE ? '+' : '') + (v - LINE)).join(' | ')})`}${!ok && !ex ? '  ' + m.chain.slice(0, 3).join('  <  ') : ''}`);
  }
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ line: LINE, pages: out }, null, 1));
  console.log(`\n${DEV}: line ${LINE}, ${off ? off + ' page(s) OFF' : 'every page on the line'} (exceptions: ${[...EXCEPT].join(', ')})`);
  console.log('page errors', errs.length ? errs : 'none', '\nsaved', dir);
  await b.close();
  process.exitCode = off ? 1 : 0;
})();
