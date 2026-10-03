/* Sales, stock changes and account rows live in IndexedDB (data-store.js "Sheets"), because
   localStorage stops saving after ~2,600 sales. Checks, in a real browser (Edge):
   an old till's localStorage rows move across and leave localStorage; a sale survives a reload;
   a list past the old 5M-character ceiling saves; a second tab sees the sale; rows left in
   localStorage merge by id and time; /demo (memory only) never touches IndexedDB. Plus the ways
   IndexedDB lets a till down: a start that hangs or opens late, a connection lost mid-shift, saves
   refused for a while (cashier told, rows kept, no ghosts after).
   Run: node scripts/sheets-check.mjs */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
let pw;
try { pw = require('playwright-core'); } catch { pw = require(join(process.env.LOCALAPPDATA || '', 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core')); }
const edge = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.md': 'text/plain' };
const server = createServer(async (req, res) => {
  const p = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try { const body = await readFile(p); res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await pw.chromium.launch({ executablePath: edge, headless: true });
const errors = [];
const KEY = 'hwpos.orders.v1';
const row = (id, ts) => ({ id, number: '9-' + id, ts, status: 'completed', items: [], subtotal: 0, total: 0 });

async function open(ctx, path = '/index.html') {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  if (path === '/index.html') await page.evaluate(() => HWPOS_STORE.ready());
  return page;
}
const orders = (page) => page.evaluate((k) => JSON.parse(HWPOS_STORE.kv.getItem(k) || '[]'), KEY);
const inLs = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const sell = (page) => page.evaluate(() => {
  window.confirm = () => true;
  state.cart = [];
  addToCart(state.products.find((p) => p.stock > 0 && p.price > 0).id);
  state.paymentMethod = 'cash';
  completeSale();
  return loadOrders()[0].id;
});

try {
  const ctx = await browser.newContext();
  // 1. An old till: its orders sit in localStorage. Opening the new build moves them across.
  const blank = await open(ctx, '/README.md');
  await blank.evaluate(([k, rows]) => localStorage.setItem(k, JSON.stringify(rows)), [KEY, [row('old1', 1)]]);
  let page = await open(ctx);
  assert.equal(await page.evaluate(async () => (await HWPOS_STORE.health()).adapter), 'indexedDB');
  assert.deepEqual((await orders(page)).map((o) => o.id), ['old1'], 'old orders read from IndexedDB');
  assert.equal(await inLs(page), null, 'and gone from localStorage');

  // 2. A sale survives a reload, and never lands in localStorage.
  const sold = await sell(page);
  await page.reload(); await page.evaluate(() => HWPOS_STORE.ready());
  assert.equal((await orders(page))[0].id, sold, 'sale kept across reload');
  assert.equal(await page.evaluate(() => state.orders[0].id), sold, 'till shows it');
  assert.equal(await inLs(page), null);

  // 3. Past the old ceiling: 6M characters (localStorage throws at ~5.2M in Edge).
  const big = await page.evaluate((k) => {
    const rows = JSON.parse(HWPOS_STORE.kv.getItem(k));
    const pad = 'x'.repeat(6000);
    for (let i = 0; i < 1000; i++) rows.push({ id: 'pad' + i, ts: 0, status: 'completed', items: [], note: pad });
    const s = JSON.stringify(rows);
    HWPOS_STORE.kv.setItem(k, s);
    return s.length;
  }, KEY);
  assert.ok(big > 6e6);
  // 6M characters take a moment to commit; a till closed inside that moment parks only the new
  // rows in localStorage, and 6M of new rows would not fit there. Wait for IndexedDB to have it.
  await page.waitForFunction(([k, n]) => new Promise((r) => {
    const q = indexedDB.open('hwpos-sheets');
    q.onsuccess = () => { const g = q.result.transaction('sheets').objectStore('sheets').get(k); g.onsuccess = () => { r((g.result || '').length === n); q.result.close(); }; };
  }), [KEY, big], { timeout: 10000 });
  await page.reload(); await page.evaluate(() => HWPOS_STORE.ready());
  assert.equal(await page.evaluate((k) => HWPOS_STORE.kv.getItem(k).length, KEY), big, '6M characters saved');
  await page.evaluate((k) => { const r = JSON.parse(HWPOS_STORE.kv.getItem(k)); HWPOS_STORE.kv.setItem(k, JSON.stringify(r.filter((o) => !String(o.id).startsWith('pad')))); }, KEY);

  // 4. A second till tab sees the sale without a reload.
  const other = await open(ctx);
  const sold2 = await sell(page);
  await other.waitForFunction((id) => state.orders.some((o) => o.id === id), sold2, { timeout: 3000 });

  // 4b. Two tabs save at once: each sends a list without the other's row. Neither row may be lost
  //     (a cash payment on an account vanished this way). Tab 2's stale list is sent raw.
  const LEDGER = 'hwpos.customerLedger.v1';
  const ledgerIds = (p) => p.evaluate((k) => JSON.parse(HWPOS_STORE.kv.getItem(k) || '[]').map((r) => r.id).filter((id) => id.startsWith('pay')).sort().join(), LEDGER);
  await page.evaluate((k) => HWPOS_STORE.kv.setItem(k, JSON.stringify([{ id: 'payA', ts: 2 }])), LEDGER);
  await other.waitForFunction((k) => (HWPOS_STORE.kv.getItem(k) || '').includes('payA'), LEDGER, { timeout: 3000 });
  await other.evaluate((k) => new BroadcastChannel('hwpos-sheets').postMessage({ key: k, value: JSON.stringify([{ id: 'payB', ts: 3 }]) }), LEDGER);
  for (const p of [page, other]) await p.waitForFunction((k) => /payA[\s\S]*payB|payB[\s\S]*payA/.test(HWPOS_STORE.kv.getItem(k) || ''), LEDGER, { timeout: 3000 });
  assert.equal(await ledgerIds(page), 'payA,payB', 'both payments kept');
  assert.equal(await ledgerIds(other), 'payA,payB');
  await page.evaluate((k) => HWPOS_STORE.kv.removeItem(k), LEDGER);

  // 5. Rows left in localStorage merge in by id and time: a stale, older full copy must not put
  //    old sales on top (orders are newest first).
  await other.close(); await page.close();
  await blank.evaluate(([k, rows]) => localStorage.setItem(k, JSON.stringify(rows)), [KEY, [row('ls1', 9), row('old1', 1)]]);
  page = await open(ctx);
  let ids = (await orders(page)).map((o) => o.id);
  assert.deepEqual(ids, [sold2, sold, 'ls1', 'old1'], 'merged by time: ' + ids);
  assert.equal(await inLs(page), null);

  // 6. Connection lost once (iPad asleep): it reopens and the sale lands in IndexedDB.
  await page.evaluate(() => {
    const real = IDBDatabase.prototype.transaction;
    let once = true;
    IDBDatabase.prototype.transaction = function (...a) {
      if (once && a[0] === 'sheets') { once = false; throw new DOMException('The database connection is closing.', 'InvalidStateError'); }
      return real.apply(this, a);
    };
  });
  const sold3 = await sell(page);
  await page.waitForTimeout(300);
  assert.equal(await inLs(page), null, 'no fallback needed');
  await page.reload(); await page.evaluate(() => HWPOS_STORE.ready());
  assert.equal((await orders(page))[0].id, sold3, 'kept after reconnect');

  // 7. Saves refused for a while: the cashier is told and the rows sit in localStorage; the first
  //    save that works clears that copy, so a later delete stays deleted.
  await page.evaluate(() => {
    window.__told = 0;
    HWPOS_STORE.events.on('save:failed', () => { window.__told++; });
    window.__real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      if (a[0] === 'sheets') throw new DOMException('closing', 'InvalidStateError');
      return window.__real.apply(this, a);
    };
  });
  const sold4 = await sell(page);
  await page.waitForFunction(() => window.__told > 0, null, { timeout: 12000 });
  assert.equal(JSON.parse(await inLs(page))[0].id, sold4, 'kept in localStorage while refused');
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__real; });
  const sold5 = await sell(page);
  await page.waitForFunction((k) => localStorage.getItem(k) == null, KEY, { timeout: 12000 });
  await page.evaluate((k) => HWPOS_STORE.kv.setItem(k, JSON.stringify(JSON.parse(HWPOS_STORE.kv.getItem(k)).filter((o) => o.id !== 'ls1'))), KEY);
  await page.waitForTimeout(300);
  await page.reload(); await page.evaluate(() => HWPOS_STORE.ready());
  ids = (await orders(page)).map((o) => o.id);
  assert.deepEqual(ids.slice(0, 2), [sold5, sold4], 'both kept, newest first: ' + ids);
  assert.ok(!ids.includes('ls1'), 'deleted row stays deleted');

  // 7b. The till closes before IndexedDB commits the sale: the new rows were parked as it closed.
  await page.evaluate(() => {
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      if (a[0] === 'sheets' && a[1] === 'readwrite') return { objectStore: () => ({ put() {}, delete() {} }) };
      return real.apply(this, a);
    };
  });
  const sold6 = await sell(page);
  await page.reload(); await page.evaluate(() => HWPOS_STORE.ready());
  ids = (await orders(page)).map((o) => o.id);
  assert.deepEqual(ids.slice(0, 3), [sold6, sold5, sold4], 'parked sale kept: ' + ids);
  assert.equal(await inLs(page), null);
  await ctx.close();

  // 8. The start hangs inside IndexedDB: the till still opens (5 s) and sells on localStorage.
  const hang = await browser.newContext();
  await hang.addInitScript(() => {
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      if (a[0] === 'sheets') return { objectStore: () => ({ get: () => ({}), put() {} }) };
      return real.apply(this, a);
    };
  });
  page = await open(hang);
  assert.ok(await page.evaluate(() => state.products.length > 0), 'till started');
  await sell(page);
  assert.equal(JSON.parse(await inLs(page)).length, 1, 'sale kept in localStorage');
  await hang.close();

  // 9. IndexedDB opens late (after the 5 s wait): the history shows up when it does, with what
  //    was rung meanwhile, and localStorage empties.
  const slow = await browser.newContext();
  const seedPage = await open(slow);
  const early = await sell(seedPage);
  await seedPage.close();
  await slow.addInitScript(() => {
    const real = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...a) {
      if (a[0] !== 'hwpos-sheets') return real.apply(this, a);
      const fake = {};
      setTimeout(() => {
        const r = real.apply(indexedDB, a);
        r.onupgradeneeded = () => { fake.result = r.result; fake.onupgradeneeded && fake.onupgradeneeded(); };
        r.onsuccess = () => { fake.result = r.result; fake.onsuccess && fake.onsuccess(); };
        r.onerror = () => { fake.error = r.error; fake.onerror && fake.onerror(); };
      }, 6500);
      return fake;
    };
  });
  page = await open(slow);
  assert.equal(await page.evaluate(() => state.orders.length), 0, 'started before the database');
  const meanwhile = await sell(page);
  await page.waitForFunction((id) => state.orders.some((o) => o.id === id), early, { timeout: 5000 });
  ids = await page.evaluate(() => state.orders.map((o) => o.id));
  assert.deepEqual(ids, [meanwhile, early], 'adopted late: ' + ids);
  assert.equal(await inLs(page), null);
  await slow.close();

  // 10. /demo swaps localStorage for memory; nothing it rings reaches the real IndexedDB.
  const demo = await browser.newContext();
  await demo.addInitScript(() => { window.HWPOS_MEMORY_ONLY = true; });
  page = await open(demo);
  assert.equal(await page.evaluate(async () => (await HWPOS_STORE.health()).adapter), 'localStorage');
  await sell(page);
  assert.equal(await page.evaluate(() => new Promise((r) => { const q = indexedDB.open('hwpos-sheets'); q.onupgradeneeded = () => r('none'); q.onsuccess = () => r(q.result.objectStoreNames.length ? 'exists' : 'none'); })), 'none');
  await demo.close();

  assert.deepEqual(errors, [], 'no page errors');
  console.log('sheets-check: ok');
} finally {
  await browser.close();
  server.close();
}
