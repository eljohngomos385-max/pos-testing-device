/* Smallest thing that fails if the till event stream breaks: append never throws, N appends are
   one IndexedDB transaction, IDB failure falls back to a capped localStorage key, and the read
   side (list/count/exportAll/markSynced) sees everything. Runs the REAL data-store.js in a
   node:vm realm against a fake IndexedDB and a fake localStorage written below.
   node scripts/events-check.mjs                                                            */
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert';

const script = new Script(readFileSync(new URL('../data-store.js', import.meta.url), 'utf8'), { filename: 'data-store.js' });
const FALLBACK = 'hwpos.tillEvents.fallback.v1';
const DROPPED = 'hwpos.tillEvents.dropped.v1';
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

function fakeLocalStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    rows: (k) => JSON.parse(m.get(k) || '[]'),
    has: (k) => m.has(k),
  };
}

// IndexedDB-shaped fake: requests fire async, a transaction commits its staged writes on
// complete, and a failing put aborts the whole transaction (as a real QuotaExceededError does).
function fakeIndexedDB() {
  const data = new Map();
  const stats = { writeTx: 0, failPut: false, data };
  let created = false;
  const db = {
    createObjectStore() { created = true; return { createIndex() {} }; },
    transaction(_name, mode) {
      if (mode === 'readwrite') stats.writeTx++;
      const staged = new Map(data);
      const queue = [];
      const t = { error: null };
      const op = (fn) => {
        const r = {};
        queue.push(() => { r.result = fn(); r.onsuccess && r.onsuccess(); });
        return r;
      };
      const all = () => [...staged.values()].map((v) => structuredClone(v));
      const os = {
        put: (v) => op(() => {
          if (stats.failPut) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
          staged.set(v.id, structuredClone(v));
          return v.id;
        }),
        get: (id) => op(() => (staged.has(id) ? structuredClone(staged.get(id)) : undefined)),
        getAll: () => op(all),
        count: () => op(() => staged.size),
        index: (name) => ({
          getAll: (q, count) => op(() => {
            const rows = all().filter((v) => (q == null ? true : typeof q === 'object' ? q.includes(v[name]) : v[name] === q))
              .sort((a, b) => (a[name] < b[name] ? -1 : a[name] > b[name] ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));   // index-key order, as real IDB
            return count ? rows.slice(0, count) : rows;
          }),
        }),
      };
      t.objectStore = () => os;
      setImmediate(() => {
        try { while (queue.length) queue.shift()(); }
        catch (e) { t.error = e; t.onerror && t.onerror(); t.onabort && t.onabort(); return; }
        if (mode === 'readwrite') { data.clear(); staged.forEach((v, k) => data.set(k, v)); }
        t.oncomplete && t.oncomplete();
      });
      return t;
    },
  };
  return {
    stats,
    open() {
      const r = { result: db };
      setImmediate(() => { if (!created) r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess(); });
      return r;
    },
  };
}

function boot({ idb = null, crypto = webcrypto, hidden = false } = {}) {
  const ls = fakeLocalStorage({ 'hwpos.settings.v1': JSON.stringify({ store: { cashier: 'Ana', registerNo: '3' } }) });
  const timers = [];
  const warns = [];
  const persistCalls = [];
  const sb = {
    localStorage: ls,
    navigator: { onLine: true, storage: { persist: () => { persistCalls.push(1); return Promise.resolve(true); } } },
    document: {
      visibilityState: hidden ? 'hidden' : 'visible',
      addEventListener() {},
      querySelector: () => ({ getAttribute: () => 'app.js?v=51' }),
    },
    console: { warn: (...a) => warns.push(a), log() {}, error() {} },
    setTimeout: (fn, ms) => { timers.push(ms); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
  };
  if (idb) { sb.indexedDB = idb; sb.IDBKeyRange = { lowerBound: (v) => ({ includes: (x) => x >= v }) }; }
  if (crypto) sb.crypto = crypto;
  sb.window = sb;
  createContext(sb);
  script.runInContext(sb);
  return { ev: sb.HWPOS_STORE.events, ai: sb.HWPOS_AI, ls, timers, warns, persistCalls,
    flushTimers: () => timers.filter((ms) => ms === 2000).length };
}

// ---- 1. IndexedDB path: never throws, batching, common fields, reads, markSynced ----
{
  const idb = fakeIndexedDB();
  const { ev, ai, flushTimers, persistCalls } = boot({ idb });
  assert.equal(typeof ev.on, 'function', 'pub-sub still on HWPOS_STORE.events');
  ev.setContext({ cartId: 'cart-1' });
  const circular = {}; circular.self = circular;
  assert.doesNotThrow(() => {
    ev.append();
    ev.append(null, null);
    ev.append('bad', circular);
    ev.append('bad', { n: 1n });
    ev.append({}, 5);
  });
  for (let i = 0; i < 50; i++) ev.append('item_add', { i, productId: 'p' + i, qty: 1 });
  assert.equal(flushTimers(), 1, '55 appends schedule one auto-flush');
  await ev.flush();
  assert.equal(idb.stats.writeTx, 1, '55 appends -> one transaction');
  assert.equal(idb.stats.data.size, 55);
  await ev.flush();
  assert.equal(idb.stats.writeTx, 1, 'empty buffer opens no transaction');

  await tick(5);
  ev.append('late', { x: 1 });
  const rows = await ev.exportAll();
  assert.equal(rows.length, 56);
  const row = rows.find((r) => r.type === 'item_add');
  for (const k of ['id', 'ts', 'type', 'sessionId', 'terminal', 'cashier', 'cartId', 'online', 'appVersion', 'synced', 'storeId', 'data']) {
    assert.ok(k in row, `common field ${k}`);
  }
  assert.deepEqual([row.terminal, row.cashier, row.cartId, row.online, row.appVersion, row.synced, row.storeId],
    ['3', 'Ana', 'cart-1', true, 'app.js?v=51', 0, '']);
  assert.equal(typeof row.data.productId, 'string', 'fields live under data');
  assert.equal(new Set(rows.map((r) => r.sessionId)).size, 1, 'one sessionId per page load');
  assert.equal(new Set(rows.map((r) => r.id)).size, 56, 'ids unique');
  assert.deepEqual(rows.find((r) => r.type === 'bad').data, {}, 'unserialisable fields become {}');

  const late = rows.find((r) => r.type === 'late');
  const since = await ev.list({ since: late.ts });
  assert.ok(since.some((r) => r.id === late.id) && since.every((r) => r.ts >= late.ts), 'list since');
  assert.equal((await ev.list({ type: 'item_add' })).length, 50, 'list type');
  assert.equal((await ev.list({ type: 'item_add', limit: 10 })).length, 10, 'list limit');

  await ev.markSynced(rows.slice(0, 10).map((r) => r.id));
  assert.equal((await ev.list({ synced: 1 })).length, 10, 'markSynced');
  assert.equal((await ev.list({ synced: 0 })).length, 46);
  assert.equal(await ev.count(), 56);
  assert.equal((await ai.tillEvents()).length, 56, 'HWPOS_AI.tillEvents');
  assert.equal(ai.health().tillEvents.droppedRows, 0);
  assert.equal(persistCalls.length, 1, 'storage.persist asked once on DB open');
}

// ---- 2. No indexedDB, no crypto.randomUUID: fallback, warn once, cap 2000 + dropped count ----
{
  const { ev, ls, warns } = boot({ idb: null, crypto: null });
  for (let i = 0; i < 3; i++) ev.append('scan', { code: 'x' + i });
  await ev.flush();
  assert.equal(ls.rows(FALLBACK).length, 3, 'fallback when indexedDB is undefined');
  assert.ok(ls.rows(FALLBACK)[0].id.startsWith('ev_'), 'newId-style id without crypto');
  assert.equal(await ev.count(), 3, 'count reads fallback');
  assert.equal((await ev.list({ type: 'scan' })).length, 3, 'list reads fallback');
  for (let i = 0; i < 2100; i++) ev.append('item_add', { i });
  await ev.flush();
  const kept = ls.rows(FALLBACK);
  assert.equal(kept.length, 2000, 'fallback capped at 2000');
  assert.equal(ls.getItem(DROPPED), '103', 'dropped count kept');
  assert.equal(ev.dropped(), 103);
  assert.equal(kept[0].data.i, 100, 'oldest rows dropped first');
  assert.equal(warns.length, 1, 'warned once');
}

// ---- 3. put throws QuotaExceededError: fallback, then migrated on the next good flush ----
{
  const idb = fakeIndexedDB();
  idb.stats.failPut = true;
  const { ev, ls } = boot({ idb });
  for (let i = 0; i < 5; i++) ev.append('search', { query: 'q' + i });
  await ev.flush();
  assert.equal(idb.stats.writeTx, 1);
  assert.equal(idb.stats.data.size, 0, 'aborted transaction wrote nothing');
  assert.equal(ls.rows(FALLBACK).length, 5, 'fallback on QuotaExceededError');
  idb.stats.failPut = false;
  ev.append('search', { query: 'ok' });
  await ev.flush();
  assert.equal(idb.stats.data.size, 6, 'fallback rows moved into IDB');
  assert.ok(!ls.has(FALLBACK), 'fallback key cleared after migration');
  assert.equal(await ev.count(), 6, 'no double count after migration');
}

// ---- 4. Page hidden: an append flushes straight away instead of waiting on a timer ----
{
  const idb = fakeIndexedDB();
  const { ev, flushTimers } = boot({ idb, hidden: true });
  ev.append('app_hidden', {});
  await tick(20);
  assert.equal(idb.stats.data.size, 1, 'hidden append flushed');
  assert.equal(flushTimers(), 0);
}

// ---- 5. Malformed rows in the fallback key don't poison count()/list() forever ----
{
  const idb = fakeIndexedDB();
  const { ev, ls } = boot({ idb });
  ls.setItem(FALLBACK, JSON.stringify([null, 1, [1, 2, 3], { x: 1 },
    { id: 'good-1', ts: '2026-01-01T00:00:00.000Z', type: 'ok' }]));
  const rows = await ev.list();
  assert.equal(rows.length, 1, 'malformed fallback rows dropped, one good row kept');
  assert.equal(await ev.count(), 1, 'count() agrees with list()');
}

// ---- 6. markSynced rejects (not resolves false) when the transaction fails ----
{
  const idb = fakeIndexedDB();
  const { ev } = boot({ idb });
  ev.append('sale', { total: 100 });
  await ev.flush();
  const rows = await ev.exportAll();
  idb.stats.failPut = true;
  await assert.rejects(() => ev.markSynced(rows.map((r) => r.id)), 'markSynced rejects on tx failure');
  idb.stats.failPut = false;
  await ev.markSynced(rows.map((r) => r.id));
  assert.equal((await ev.list({ synced: 1 })).length, rows.length, 'retry after rejection succeeds');
}

console.log('events-check: ok');
