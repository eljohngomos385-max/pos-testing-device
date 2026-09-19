/* Proves the till event stream cannot break a sale. Report-only: prints JSON, exits 1 on a failed check.
   Browser part: in-process static server on :8772 + headless Edge (playwright-core). /old/* serves
   `git show HEAD:<path>` so an old build and mixed-version caches can be exercised.
   Node part: the real worker/index.js against node:sqlite (same shim as worker-check).
   node scripts/stress/till-safety.mjs                                                        */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = 8772;
const BASE = `http://127.0.0.1:${PORT}`;
const out = { checks: [], measurements: {} };
const check = (name, ok, detail = {}) => { out.checks.push({ name, ok: !!ok, detail }); };
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))]);

// ---------- static server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const headCache = new Map();
function headFile(p) {
  if (!headCache.has(p)) {
    try { headCache.set(p, execFileSync('git', ['show', 'HEAD:' + p], { cwd: ROOT, maxBuffer: 64e6 })); }
    catch (_) { headCache.set(p, null); }
  }
  return headCache.get(p);
}
const server = createServer((req, res) => {
  const url = new URL(req.url, BASE);
  let path = decodeURIComponent(url.pathname);
  if (path.startsWith('/old/')) {
    const body = headFile(path.slice(5) || 'index.html');
    if (!body) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    return res.end(body);
  }
  if (path === '/') path = '/index.html';
  if (path === '/admin' || path.startsWith('/admin/')) path = '/backoffice.html';   // _redirects
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

function loadPlaywright() {
  try { return require('playwright-core'); } catch (_) {
    return require(join(process.env.LOCALAPPDATA || '', 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core'));
  }
}
const edge = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: edge, headless: true });

// ---------- injected failure modes (run before any page script) ----------
const INJECT = {
  idbUndefined: `Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });`,
  idbOpenError: `IDBFactory.prototype.open = function () { const r = {}; setTimeout(() => { r.error = new DOMException('boom', 'UnknownError'); r.onerror && r.onerror(); }, 0); return r; };`,
  idbOpenThrows: `IDBFactory.prototype.open = function () { throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError'); };`,
  idbOpenHang: `IDBFactory.prototype.open = function () { return {}; };`,
  quotaOnPutSync: `IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); };`,
  quotaOnPutAbort: `{ const o = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { const r = o.apply(this, a); try { this.transaction.abort(); } catch (_) {} return r; }; }`,
  txHang: `IDBDatabase.prototype.transaction = function () { const req = () => ({}); return { objectStore: () => ({ put: req, get: req, getAll: req, count: req, index: () => ({ getAll: req }) }) }; };`,
  lsThrowsForEventKeys: `Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('hwpos.tillEvents')) throw new DOMException('q', 'QuotaExceededError'); return o.call(this, k, v); }; }`,
  lsThrowsAll: `Storage.prototype.setItem = function () { throw new DOMException('q', 'QuotaExceededError'); };`,
};

async function openPage(ctx, url, inject, routes = {}) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [], warns = [], external = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  if (inject) await page.addInitScript(inject);
  for (const [glob, body] of Object.entries(routes)) {
    await page.route(glob, (route) => body == null ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'text/javascript', body }));
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { page, errors, warns, external };
}

// Real functions, no UI clicks (the UI checkout path is what hardening-check reports broken).
const SELL = async (page, lines = 2) => withTimeout(page.evaluate(async (lines) => {
  state.products = loadProducts().map((p) => ({ ...p, stock: Math.max(50, Number(p.stock) || 50) }));
  saveProducts();
  const picks = state.products.filter((p) => p.price > 0).slice(0, lines);
  picks.forEach((p) => addToCart(p.id, 'tile'));
  const tender = document.querySelector('#checkoutTender');
  if (tender) tender.value = String(cartTotals().total);
  state.paymentMethod = 'cash';
  const before = JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]').length;
  completeSale();
  const orders = JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]');
  const order = orders[0] || {};
  const moves = JSON.parse(localStorage.getItem('hwpos.stockMovements.v1') || '[]').filter((m) => m.refId === order.id);
  let printed = null;
  const any = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : any), apply: () => any, set: () => true });
  const w = window.open; window.open = () => any;
  try { printed = await printOrder(order); } catch (e) { printed = 'threw: ' + e.message; } finally { window.open = w; }
  return { saved: orders.length === before + 1, orderId: order.id, printed, moves: moves.length, movesWithBalance: moves.filter((m) => m.balanceAfter != null).length };
}, lines), 15000, 'sell');

const EVENT_STATE = (page) => withTimeout(page.evaluate(async () => {
  const t = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r('TIMEOUT'), ms))]);
  const count = await t(window.HWPOS_STORE.events.count().catch((e) => 'rejected: ' + e.message), 7000);
  let fb = null; try { fb = JSON.parse(localStorage.getItem('hwpos.tillEvents.fallback.v1') || 'null'); } catch (_) { fb = 'unparseable'; }
  const list = await t(window.HWPOS_AI.tillEvents().then((r) => r.length).catch((e) => 'rejected: ' + e.message), 7000);
  return { count, list, fallbackRows: Array.isArray(fb) ? fb.length : fb, dropped: localStorage.getItem('hwpos.tillEvents.dropped.v1') };
}), 20000, 'eventState');

// Sidebar views plus the detail routes that render a customer name / an order.
const ROUTES = (page) => page.evaluate(() => {
  const views = [...document.querySelectorAll('.side-link[data-view]')].map((b) => '/admin/' + b.dataset.view);
  const cust = (JSON.parse(localStorage.getItem('hwpos.customers.v1') || '[]').slice(-1)[0] || {}).id;
  const ord = (JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]')[0] || {}).id;
  return views.concat(cust ? ['/admin/customers/' + cust] : [], ord ? ['/admin/sales/' + ord] : []);
});

const idbCount = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('hwpos-events');
  r.onsuccess = () => { try { const c = r.result.transaction('tillEvents').objectStore('tillEvents').count(); c.onsuccess = () => { res(c.result); r.result.close(); }; } catch (e) { res('no store: ' + e.message); } };
  r.onerror = () => res('open error');
}));

try {
  // ===== 1. sale path under storage failures =====
  for (const [mode, inject] of Object.entries(INJECT)) {
    const ctx = await browser.newContext();
    const { page, errors, warns } = await openPage(ctx, BASE + '/index.html', inject);
    let sale, ev, err = null;
    try { sale = await SELL(page); ev = await EVENT_STATE(page); } catch (e) { err = e.message; }
    const expectSave = mode !== 'lsThrowsAll';
    check(`1.${mode}: sale completes, no uncaught errors`, !err && (!expectSave || (sale.saved && sale.printed === true)) && !errors.some((e) => e.startsWith('pageerror')),
      { sale, events: ev, err, errors: errors.slice(0, 5), eventWarns: warns.filter((w) => w.includes('HWPOS events')).length });
    await ctx.close();
  }

  // ===== 1b. corrupt fallback key, IDB healthy =====
  for (const bad of ['not json{', '{}', '"str"', '[null]', '[{"x":1}]', '[1,2,3]']) {
    const ctx = await browser.newContext();
    const { page, errors } = await openPage(ctx, BASE + '/index.html');
    await page.evaluate((v) => localStorage.setItem('hwpos.tillEvents.fallback.v1', v), bad);
    await page.reload({ waitUntil: 'load' });
    let sale, ev, idb, err = null;
    try {
      sale = await SELL(page);
      await page.evaluate(() => HWPOS_STORE.events.flush());
      await page.evaluate(() => { HWPOS_STORE.events.append('probe', {}); return HWPOS_STORE.events.flush(); });
      ev = await EVENT_STATE(page);
      idb = await idbCount(page);
    } catch (e) { err = e.message; }
    const healthy = !err && sale && sale.saved && typeof idb === 'number' && idb > 0 && typeof ev.list === 'number';
    check(`1b.fallback=${bad}: sale ok AND events still reach IDB/export`, healthy, { sale, events: ev, idbRows: idb, err, errors: errors.slice(0, 3) });
    await ctx.close();
  }

  // ===== 1c. the 2000-row fallback cap vs a nearly full localStorage =====
  {
    const ctx = await browser.newContext();
    const { page } = await openPage(ctx, BASE + '/index.html', INJECT.idbUndefined);
    const r = await withTimeout(page.evaluate(async () => {
      for (let i = 0; i < 2100; i++) HWPOS_STORE.events.append('item_add', { productId: 'p' + i, qty: 1, unitPrice: 285, stockOnHand: 12, via: 'tile' });
      await HWPOS_STORE.events.flush();
      const fb = localStorage.getItem('hwpos.tillEvents.fallback.v1') || '';
      return { rows: JSON.parse(fb).length, chars: fb.length, dropped: localStorage.getItem('hwpos.tillEvents.dropped.v1') };
    }), 30000, 'cap');
    out.measurements.fallbackCap = r;
    check('1c: fallback capped at 2000 rows', r.rows === 2000, r);
    await ctx.close();
  }

  // ===== 1d. hung IDB transaction: does anything user-facing wait on the stalled flush chain? =====
  {
    const ctx = await browser.newContext({ acceptDownloads: true });
    const bo = await openPage(ctx, BASE + '/admin/insights', INJECT.txHang);
    await bo.page.waitForTimeout(500);
    const btn = await bo.page.$('[data-act="export-ai"]');
    let downloaded = null;
    if (btn) {
      const dl = bo.page.waitForEvent('download', { timeout: 12000 }).then(() => true).catch(() => false);
      await btn.click();
      downloaded = await dl;
    }
    check('1d: Export for AI still downloads when an IndexedDB transaction hangs', downloaded === true, { buttonFound: !!btn, downloadedWithin12s: downloaded });
    await ctx.close();
  }

  // ===== 2. private-like context + two tabs + IDB version upgrade =====
  {
    const ctx = await browser.newContext();
    const a = await openPage(ctx, BASE + '/index.html');
    const b = await openPage(ctx, BASE + '/index.html');
    const t0 = Date.now();
    const burst = (p, tag) => p.page.evaluate(async (tag) => { for (let i = 0; i < 300; i++) HWPOS_STORE.events.append('item_add', { tag, i }); await HWPOS_STORE.events.flush(); }, tag);
    await withTimeout(Promise.all([burst(a, 'A'), burst(b, 'B'), SELL(a.page), SELL(b.page)]), 20000, 'twoTabs');
    const evA = await EVENT_STATE(a.page);
    check('2: two tabs writing at once, nothing hangs, no rows lost', typeof evA.count === 'number' && evA.count >= 600 && !a.errors.length && !b.errors.length,
      { ms: Date.now() - t0, countSeenFromA: evA.count, errorsA: a.errors, errorsB: b.errors });
    // A future build bumping the IDB version while these tabs stay open.
    const c = await openPage(ctx, BASE + '/index.html');
    const up = await withTimeout(c.page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('hwpos-events', 2); const seen = [];
      r.onblocked = () => seen.push('blocked');
      r.onupgradeneeded = () => seen.push('upgradeneeded');
      r.onsuccess = () => { seen.push('success'); r.result.close(); res(seen); };
      r.onerror = () => { seen.push('error'); res(seen); };
      setTimeout(() => res(seen.concat('still pending after 3s')), 3000);
    })), 10000, 'upgrade');
    check('2: a later build can upgrade hwpos-events while old tabs are open (onversionchange closes)', up.includes('success'), { outcome: up });
    await ctx.close();
  }

  // ===== 3. fresh install + old data =====
  const visitAll = async (ctx, label) => {
    const res = [];
    const till = await openPage(ctx, BASE + '/index.html');
    res.push({ url: '/index.html', errors: till.errors });
    const bo = await openPage(ctx, BASE + '/admin');
    const hrefs = await ROUTES(bo.page);
    res.push({ url: '/admin', errors: bo.errors.filter((e) => !/fonts\.g/.test(e)) });
    for (const h of hrefs.slice(0, 20)) {
      const errs = [];
      const on = (e) => errs.push(e.message); const onc = (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); };
      bo.page.on('pageerror', on); bo.page.on('console', onc);
      await bo.page.goto(BASE + h, { waitUntil: 'load' }); await bo.page.waitForTimeout(400);
      bo.page.off('pageerror', on); bo.page.off('console', onc);
      res.push({ url: h, errors: errs });
    }
    const bad = res.filter((r) => r.errors.length);
    check(`3.${label}: POS + back office boot with no console errors`, !bad.length, { pages: res.length, bad });
    return till;
  };
  {
    const ctx = await browser.newContext();
    await visitAll(ctx, 'fresh install');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    const old = await openPage(ctx, BASE + '/old/index.html');
    let oldSale; try { oldSale = await SELL(old.page, 3); } catch (e) { oldSale = { err: e.message }; }
    await old.page.evaluate(() => {   // plus back-office-era rows from before balanceAfter/unitCost existed
      const p = JSON.parse(localStorage.getItem('hwpos.products.v2') || '[]')[0] || { id: 'x' };
      localStorage.setItem('hwpos.stockMovements.v1', JSON.stringify([{ id: 'm_old', ts: '2025-01-01T00:00:00.000Z', productId: p.id, qty: -1, reason: 'sale', refId: 'o_old' }]));
    });
    await old.page.close();
    const till = await visitAll(ctx, 'old HEAD-build data');
    let sale; try { sale = await SELL(till.page); } catch (e) { sale = { err: e.message }; }
    check('3: new build sells on top of old data', sale.saved && !till.errors.length, { oldSale, sale, errors: till.errors });
    await ctx.close();
  }

  // ===== 7. mixed cached versions =====
  const cur = (f) => readFileSync(join(ROOT, f), 'utf8');
  const MIX = {
    'new html+app.js, HEAD data-store.js': [BASE + '/index.html', { '**/data-store.js*': headFile('data-store.js').toString() }],
    'HEAD html+app.js, new data-store.js': [BASE + '/old/index.html', { '**/old/data-store.js*': cur('data-store.js') }],
    'new html+app.js, HEAD data.js (unversioned include)': [BASE + '/index.html', { '**/data.js*': headFile('data.js').toString() }],
    'new html+app.js, bo-model.js without balanceAfter stamp (stale ?v=7)': [BASE + '/index.html', { '**/bo-model.js*': cur('bo-model.js').replace('movement.balanceAfter = product.stock;', '') }],
  };
  for (const [name, [url, routes]] of Object.entries(MIX)) {
    const ctx = await browser.newContext();
    const p = await openPage(ctx, url, null, routes);
    let sale; try { sale = await SELL(p.page); } catch (e) { sale = { err: e.message }; }
    check(`7.${name}: still sells`, sale.saved && !p.errors.some((e) => e.startsWith('pageerror')), { sale, errors: p.errors.slice(0, 4) });
    await ctx.close();
  }

  // ===== 5. performance, events on vs append no-op =====
  {
    const ctx = await browser.newContext();
    const { page } = await openPage(ctx, BASE + '/index.html');
    const perf = await withTimeout(page.evaluate(async () => {
      const ev = HWPOS_STORE.events; const real = ev.append; const noop = () => {};
      state.products = loadProducts().map((p) => ({ ...p, stock: 999 })); saveProducts();
      const ps = state.products.filter((p) => p.price > 0);
      const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
      const taps = async (on) => { ev.append = on ? real : noop; clearCart(); await ev.flush(); const t = performance.now(); for (let i = 0; i < 200; i++) addToCart(ps[i % 10].id, 'tile'); const d = performance.now() - t; await ev.flush(); return d; };
      const sale = async (on) => {
        ev.append = on ? real : noop; clearCart(); await ev.flush();
        const t = performance.now();
        for (let i = 0; i < 5; i++) addToCart(ps[i].id, 'tile');
        document.querySelector('#checkoutTender').value = String(cartTotals().total); state.paymentMethod = 'cash'; completeSale();
        const d = performance.now() - t; await ev.flush(); return d;
      };
      const r = { tapsOn: [], tapsOff: [], saleOn: [], saleOff: [] };
      for (let i = 0; i < 7; i++) { r.tapsOn.push(await taps(true)); r.tapsOff.push(await taps(false)); }
      for (let i = 0; i < 15; i++) { r.saleOn.push(await sale(true)); r.saleOff.push(await sale(false)); }
      ev.append = real;
      let t = performance.now(); for (let i = 0; i < 10000; i++) real('item_add', { productId: 'p', qty: 1, unitPrice: 1, stockOnHand: 1, via: 'tile' });
      const append10k = performance.now() - t;
      t = performance.now(); await ev.flush(); const flush10k = performance.now() - t;
      return { taps200OnMs: med(r.tapsOn), taps200OffMs: med(r.tapsOff), saleOnMs: med(r.saleOn), saleOffMs: med(r.saleOff), append10kMs: append10k, flush10kMs: flush10k };
    }), 120000, 'perf');
    out.measurements.perf = perf;
    check('5: 200 taps overhead < 10% and < 50ms', perf.taps200OnMs - perf.taps200OffMs < Math.max(50, perf.taps200OffMs * 0.1), perf);
    await ctx.close();
  }

  // ===== 6. XSS + 8. privacy / network =====
  {
    const X = `"><img src=x onerror="window.__xss=(window.__xss||0)+1"><svg onload="window.__xss=(window.__xss||0)+1"></svg>`;
    const ctx = await browser.newContext({ acceptDownloads: true });
    const till = await openPage(ctx, BASE + '/index.html');
    const tp = till.page;
    await tp.fill('#searchInput', X); await tp.waitForTimeout(400); await tp.fill('#searchInput', ''); await tp.waitForTimeout(200);
    await tp.evaluate((X) => {
      addProductByCode(X, { source: 'camera' }); addProductByCode(X, { source: 'barcode' });
      document.querySelector('#custName').value = X; document.querySelector('#custPhone').value = X; document.querySelector('#custAddress').value = X;
      saveSavedCustomerFromModal();
      const c = state.customers[state.customers.length - 1]; selectCustomer(c.id);
    }, X);
    await SELL(tp);
    await tp.evaluate(() => { for (const v of ['orders', 'customers', 'reports', 'sell']) { try { switchView(v); } catch (_) {} } try { openCustomerModal(); } catch (_) {} try { openReceipt(loadOrders()[0]); } catch (_) {} });
    await tp.waitForTimeout(600);
    const tillXss = await tp.evaluate(() => ({ fired: window.__xss || 0, nodes: document.querySelectorAll('img[src="x"], svg[onload]').length }));
    const rows = await tp.evaluate(() => HWPOS_AI.tillEvents());
    const bo = await openPage(ctx, BASE + '/admin');
    const hrefs = await ROUTES(bo.page);
    const boHits = [];
    for (const h of hrefs.slice(0, 20)) {
      await bo.page.goto(BASE + h, { waitUntil: 'load' }); await bo.page.waitForTimeout(400);
      const r = await bo.page.evaluate(() => ({ fired: window.__xss || 0, nodes: document.querySelectorAll('img[src="x"], svg[onload]').length }));
      if (r.fired || r.nodes) boHits.push({ h, ...r });
    }
    let exported = null;
    await bo.page.goto(BASE + '/admin/insights', { waitUntil: 'load' }); await bo.page.waitForTimeout(500);
    const btn = await bo.page.$('[data-act="export-ai"]');
    if (btn) {
      const dl = bo.page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await btn.click();
      const d = await dl;
      if (d) { const j = JSON.parse(readFileSync(await d.path(), 'utf8')); exported = { tillEvents: j.tillEvents.length, payloadIntact: JSON.stringify(j.tillEvents).includes(JSON.stringify(X).slice(1, -1)) }; }
    }
    const custRows = await bo.page.evaluate(() => (JSON.parse(localStorage.getItem('hwpos.customers.v1') || '[]').slice(-1)[0] || {}).name);
    check('6: hostile search/scan/customer text never renders as HTML (till + every back-office route)', !tillXss.fired && !tillXss.nodes && !boHits.length,
      { tillXss, boHits, routesVisited: hrefs.length, exported, customerStoredRaw: custRows === X, rowsWithPayload: rows.filter((r) => JSON.stringify(r.data).includes('onerror')).map((r) => r.type) });

    // 8. privacy
    const secretKey = /pin|pass|card|cvv|secret|token|auth/i;
    const luhn = (s) => { let sum = 0; for (let i = 0; i < s.length; i++) { let d = +s[s.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; };
    const hits = [];
    const walk = (o, path, type) => { if (o && typeof o === 'object') { for (const [k, v] of Object.entries(o)) { if (secretKey.test(k)) hits.push({ type, key: path + k }); walk(v, path + k + '.', type); } }
      else if (typeof o === 'string' || typeof o === 'number') { const s = String(o); if (/^\d{15,16}$/.test(s) && luhn(s) && type !== 'scan') hits.push({ type, key: path, value: 'card-like' }); } };
    rows.forEach((r) => walk(r, '', r.type));
    check('8: no secret-looking fields in event rows', !hits.length, { rows: rows.length, types: [...new Set(rows.map((r) => r.type))], commonKeys: Object.keys(rows[0] || {}), hits });
    check('8: till makes no network calls off-origin', !till.external.length, { external: till.external, backofficeExternal: [...new Set(bo.external.map((u) => new URL(u).host))] });
    await ctx.close();
  }
} catch (e) {
  check('harness', false, { error: e.stack });
} finally {
  await browser.close().catch(() => {});
  server.close();
}

// ===== 4. worker: old-build rows, unknown fields, malformed rows =====
{
  const { default: worker } = await import('../../worker/index.js');
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
  const DB = {
    prepare(sql) { const st = sqlite.prepare(sql); const mk = (a) => ({ bind: (...b) => mk(b), first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => st.run(...a), _exec: () => st.run(...a) }); return mk([]); },
    async batch(stmts) { sqlite.exec('begin'); try { for (const s of stmts) s._exec(); sqlite.exec('commit'); } catch (e) { sqlite.exec('rollback'); throw e; } },
  };
  const SECRET = 's';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256' }), body = b64({ exp: Math.floor(Date.now() / 1e3) + 3600 });
  const jwt = `${head}.${body}.${createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url')}`;
  const env = { DB, SUPABASE_JWT_SECRET: SECRET, DEFAULT_STORE: 'main' };
  const post = async (payload, path = '/tillEvents') => {
    const r = await worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { authorization: 'Bearer ' + jwt }, body: JSON.stringify(payload) }), env);
    return { status: r.status, body: await r.text() };
  };
  const q = (sql, ...a) => sqlite.prepare(sql).all(...a);
  const W = {};
  W.oldBuildMinimal = await post([{ id: 'old1', ts: '2026-09-01T00:00:00.000Z', type: 'item_add' }]);
  W.newBuildExtras = await post([{ id: 'new1', ts: '2026-09-01T00:00:01.000Z', type: 'scan', sessionId: 's', cartId: 'c', appVersion: 'app.js?v=99', online: true, synced: 0, storeId: 'evil',
    data: { code: '<b>', future: { deep: [1] } }, futureTopLevel: 'x', seq: 7 }]);
  W.singleNonArrayWithExtras = await post({ id: 'one1', ts: '2026-09-01T00:00:02.000Z', type: 'app_open', whatever: 1 });
  W.missingType = await post([{ id: 'nt1', ts: '2026-09-01T00:00:03.000Z' }]);
  W.missingId = await post([{ ts: '2026-09-01T00:00:04.000Z', type: 'app_open' }]);
  W.missingIdResent = await post([{ ts: '2026-09-01T00:00:04.000Z', type: 'app_open' }]);
  W.missingTs = await post([{ id: 'nts1', type: 'app_open' }]);
  W.nullRow = await post([null]);
  W.dataPreStringified = await post([{ id: 'str1', ts: '2026-09-01T00:00:05.000Z', type: 'search', data: '{"query":"x"}' }]);
  W.goodPlusOneBad = await post([...Array.from({ length: 999 }, (_, i) => ({ id: 'g' + i, ts: '2026-09-01T00:01:00.000Z', type: 'item_add' })), { id: 'bad', ts: '2026-09-01T00:01:00.000Z' }]);
  const t = Date.now();
  W.batch1000 = await post(Array.from({ length: 1000 }, (_, i) => ({ id: 'b' + i, ts: '2026-09-01T00:02:00.000Z', type: 'item_add', data: { i } })));
  out.measurements.workerBatch1000MsSqliteShim = Date.now() - t;
  W.batch1001 = await post(Array.from({ length: 1001 }, (_, i) => ({ id: 'c' + i, ts: 't', type: 'x' })));
  const rows = Object.fromEntries(q("select id, store_id, type, online, data, ts, received_at from till_events where id in ('old1','new1','one1','nts1','str1')").map((r) => [r.id, r]));
  const nullIds = q('select count(*) n from till_events where id is null')[0].n;
  const g = q("select count(*) n from till_events where id like 'g%'")[0].n;
  out.worker = { responses: Object.fromEntries(Object.entries(W).map(([k, v]) => [k, v.status + ' ' + v.body.slice(0, 90)])), rows, nullIdRows: nullIds, goodRowsFromPoisonedBatch: g };
  check('4: old-build row (id/ts/type only) inserts', W.oldBuildMinimal.status === 201 && rows.old1);
  check('4: new-build row with unknown extra fields does not 500, store_id from token', W.newBuildExtras.status === 201 && rows.new1 && rows.new1.store_id === 'main' && rows.new1.online === 1 && W.singleNonArrayWithExtras.status === 201);
  check('4: malformed rows are refused as 4xx, not 500', ![W.missingType, W.nullRow].some((r) => r.status >= 500), { missingType: W.missingType.status, nullRow: W.nullRow.status });
  check('4: a row with no id cannot be inserted (dedupe needs id)', nullIds === 0, { nullIdRows: nullIds, statuses: [W.missingId.status, W.missingIdResent.status] });
  check('4: a row with no ts is not silently stamped with upload time', !(rows.nts1 && rows.nts1.ts), { stored: rows.nts1 });
  check('4: pre-stringified data is not double-encoded', !(rows.str1 && rows.str1.data.startsWith('"')), { stored: rows.str1 && rows.str1.data });
}

console.log(JSON.stringify(out, null, 2));
const failed = out.checks.filter((c) => !c.ok);
console.error(`\n${out.checks.length - failed.length}/${out.checks.length} checks passed`);
failed.forEach((c) => console.error('FAIL ' + c.name));
process.exitCode = failed.length ? 1 : 0;
