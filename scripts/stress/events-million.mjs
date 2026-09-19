/* Stress the till event stream at ~1,000,000 events. Report-only: prints measurements, asserts
   only the invariants (no loss, no duplicates, store scoping).
     node scripts/stress/events-million.mjs store [N]    HWPOS_STORE.events in node:vm, fast fake IDB
     node scripts/stress/events-million.mjs worker [N]   real worker/index.js on a SQLite file (D1 shim)
   Browser half is driven by hand (Playwright MCP); see the report.                              */
import { readFileSync, rmSync, statSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { webcrypto, createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

const [mode = 'store', nArg] = process.argv.slice(2);
const N = Number(nArg) || 1_000_000;
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const now = () => process.hrtime.bigint();
const mb = (b) => (b / 1048576).toFixed(1) + 'MB';
const out = (k, v) => console.log(k.padEnd(44), v);
const TYPES = ['item_add', 'scan', 'search', 'item_qty', 'cart_start', 'checkout_open', 'payment_method', 'sale_complete', 'item_remove', 'receipt_print'];
const dataFor = (type, i) => type === 'item_add' ? { productId: 'p' + (i % 800), qty: 1, unitPrice: 285.75, stockOnHand: 40 - (i % 50), via: 'scan' }
  : type === 'scan' ? { code: '48001234' + (i % 9999), found: true, productId: 'p' + (i % 800) }
  : type === 'search' ? { query: 'cement ' + (i % 30), results: 12, chosenProductId: 'p' + (i % 800) }
  : type === 'sale_complete' ? { orderId: 'ord_' + i.toString(36), total: 1234.5, lines: 4, fulfilment: 'pickup', customerId: '', msSinceCartStart: 81234 }
  : { productId: 'p' + (i % 800), from: 1, to: 2 };

// ------------------------------------------------------------------ store
async function stressStore() {
  const script = new Script(readFileSync(new URL('../../data-store.js', import.meta.url), 'utf8'), { filename: 'data-store.js' });
  // Same contract as events-check's fake, but O(batch) per transaction instead of copying the whole store,
  // so 1M rows is measurable. structuredClone on put/read stands in for IDB's clone cost.
  function fakeIDB() {
    const data = new Map();
    const s = { data, writeTx: 0, hang: false, failPut: false };
    const db = {
      createObjectStore: () => ({ createIndex() {} }),
      transaction(_n, mode) {
        if (mode === 'readwrite') s.writeTx++;
        const staged = new Map(), q = [], t = {};
        const op = (fn) => { const r = {}; q.push(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }); return r; };
        const val = (id) => (staged.has(id) ? staged.get(id) : data.get(id));
        const all = () => [...data.values()].map((v) => structuredClone(v));
        const os = {
          put: (v) => op(() => { if (s.failPut) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); staged.set(v.id, structuredClone(v)); }),
          get: (id) => op(() => (val(id) ? structuredClone(val(id)) : undefined)),
          getAll: () => op(all),
          count: () => op(() => data.size),
          // Real IndexedDB: undefined = every row, rows in index-key then primary-key order, count caps.
          index: (name) => ({ getAll: (qq, count) => op(() => { const rows = all().filter((v) => (qq == null ? true : typeof qq === 'object' ? qq.includes(v[name]) : v[name] === qq))
            .sort((a, b) => (a[name] < b[name] ? -1 : a[name] > b[name] ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); return count ? rows.slice(0, count) : rows; }) }),
        };
        t.objectStore = () => os;
        if (s.hang && mode === 'readwrite') return t;   // a transaction that never completes nor errors
        setImmediate(() => {
          try { while (q.length) q.shift()(); } catch (e) { t.error = e; t.onerror && t.onerror(); return; }
          staged.forEach((v, k) => data.set(k, v));
          t.oncomplete && t.oncomplete();
        });
        return t;
      },
    };
    return { s, open() { const r = { result: db }; setImmediate(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess(); }); return r; } };
  }
  function boot(idb) {
    const m = new Map([['hwpos.settings.v1', JSON.stringify({ store: { cashier: 'Ana', registerNo: '3', name: 'EJ Hardware' }, vatRate: 0.12 })]]);
    const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
    const warns = [];
    const sb = { localStorage: ls, navigator: { onLine: true }, console: { warn: (...a) => warns.push(a), log() {}, error() {} },
      document: { visibilityState: 'visible', addEventListener() {}, querySelector: () => ({ getAttribute: () => 'app.js?v=53' }) },
      setTimeout, clearTimeout, addEventListener() {}, crypto: webcrypto };
    if (idb) { sb.indexedDB = idb; sb.IDBKeyRange = { lowerBound: (v) => ({ includes: (x) => x >= v }) }; }
    sb.window = sb;
    createContext(sb);
    script.runInContext(sb);
    return { ev: sb.HWPOS_STORE.events, ls, warns };
  }
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  // 1. 1M appends in bursts, flushes overlapping appends. Latency of every append.
  {
    const idb = fakeIDB();
    const { ev } = boot(idb);
    const lat = new Float64Array(N);
    const flushes = [];
    const heap0 = process.memoryUsage().heapUsed;
    let peakHeap = 0, i = 0;
    const T0 = now();
    while (i < N) {
      const burst = Math.min(5000, N - i);
      for (let k = 0; k < burst; k++, i++) {
        const type = TYPES[i % TYPES.length];
        const t0 = now(); ev.append(type, dataFor(type, i)); lat[i] = ms(t0);
      }
      const f0 = now();
      const pending = ev.flush();                      // not awaited: next burst lands during the write
      if (i < N) {
        const burst2 = Math.min(5000, N - i);
        for (let k = 0; k < burst2; k++, i++) { const type = TYPES[i % TYPES.length]; const t0 = now(); ev.append(type, dataFor(type, i)); lat[i] = ms(t0); }
      }
      await pending;
      flushes.push(ms(f0));
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    await ev.flush();
    const total = ms(T0);
    const sorted = Float64Array.from(lat).sort();
    out('store: appends', N.toLocaleString());
    out('store: append p50 / p99 / p99.9 / max (ms)', [0.5, 0.99, 0.999].map((p) => pct(sorted, p).toFixed(4)).join(' / ') + ' / ' + sorted[N - 1].toFixed(2));
    out('store: wall time incl. fake-IDB flushes', (total / 1000).toFixed(1) + 's  (' + Math.round(N / (total / 1000)).toLocaleString() + ' ev/s)');
    const fs = flushes.slice().sort((a, b) => a - b);
    out('store: flush (5k-10k rows) p50 / p99 (ms)', pct(fs, 0.5).toFixed(1) + ' / ' + pct(fs, 0.99).toFixed(1) + '  tx=' + idb.s.writeTx);
    out('store: peak heap during load', mb(peakHeap) + ' (start ' + mb(heap0) + ', fake IDB holds the rows in-process)');

    const c0 = now(); const n = await ev.count(); out('store: count()', n.toLocaleString() + ' in ' + ms(c0).toFixed(1) + 'ms');
    assert.equal(n, N, 'count exact');
    global.gc && global.gc();
    const h1 = process.memoryUsage().heapUsed;
    const e0 = now(); let rows = await ev.exportAll(); const eMs = ms(e0);
    const h2 = process.memoryUsage().heapUsed;
    out('store: exportAll()', rows.length.toLocaleString() + ' rows in ' + (eMs / 1000).toFixed(2) + 's, heap +' + mb(h2 - h1));
    assert.equal(rows.length, N, 'export exact');
    assert.equal(new Set(rows.map((r) => r.id)).size, N, 'ids unique');
    const perRow = Buffer.byteLength(JSON.stringify(rows.slice(0, 10000))) / 10000;
    out('store: JSON bytes per row (avg of 10k)', perRow.toFixed(0));
    rows = null;
    const l0 = now(); const lim = await ev.list({ type: 'sale_complete', limit: 10 });
    out('store: list({type, limit:10})', lim.length + ' rows in ' + ms(l0).toFixed(0) + 'ms (reads all, then slices)');
    const s0 = now(); const unsynced = await ev.list({ synced: 0, limit: 1000 });
    out('store: list({synced:0, limit:1000})', unsynced.length + ' rows in ' + ms(s0).toFixed(0) + 'ms (reads all unsynced, sorts, slices)');
    const m0 = now(); await ev.markSynced(unsynced.map((r) => r.id));
    out('store: markSynced(1000)', ms(m0).toFixed(0) + 'ms');
    assert.equal((await ev.list({ synced: 1 })).length, 1000);
  }

  // 2. IDB permanently failing: 1M appends into the capped fallback.
  {
    const idb = fakeIDB(); idb.s.failPut = true;
    const { ev, ls, warns } = boot(idb);
    const T0 = now(); const flushMs = [];
    for (let i = 0; i < N;) {
      for (let k = 0; k < 5000 && i < N; k++, i++) ev.append('item_add', dataFor('item_add', i));
      const f0 = now(); await ev.flush(); flushMs.push(ms(f0));
    }
    const kept = JSON.parse(ls.getItem('hwpos.tillEvents.fallback.v1')).length;
    out('fallback: kept / dropped / warns', kept + ' / ' + ev.dropped().toLocaleString() + ' / ' + warns.length);
    assert.equal(kept + ev.dropped(), N, 'kept + dropped accounts for every append');
    out('fallback: localStorage key size', mb(ls.getItem('hwpos.tillEvents.fallback.v1').length * 2) + ' (UTF-16)');
    out('fallback: flush p50 at cap (ms)', flushMs.sort((a, b) => a - b)[flushMs.length >> 1].toFixed(1) + '  total ' + (ms(T0) / 1000).toFixed(1) + 's');
    idb.s.failPut = false;
    ev.append('app_visible', {});
    await ev.flush();
    out('fallback: after IDB recovers, IDB rows / fallback key', idb.s.data.size + ' / ' + (ls.getItem('hwpos.tillEvents.fallback.v1') ? 'present' : 'cleared'));
  }

  // 3. A readwrite transaction that hangs (no complete, no error, no abort). evtTx gives up after 15 s per
  // attempt and the rows go to the fallback, so the chain settles in two timeouts (the 1-row flush, then the 200k).
  {
    const idb = fakeIDB();
    const { ev, ls } = boot(idb);
    ev.append('app_open', {}); await ev.flush();
    idb.s.hang = true;
    ev.append('item_add', dataFor('item_add', 0));
    ev.flush();
    await new Promise((r) => setTimeout(r, 2100));   // let earlier sections' auto-flush timers release their realms
    global.gc && global.gc();
    const h0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 200_000; i++) ev.append('item_add', dataFor('item_add', i));
    const race = (p) => Promise.race([p.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('still pending after 35s'), 35000))]);
    out('hang: flush() after a hung tx', await race(ev.flush()));
    out('hang: count() / exportAll()', (await race(ev.count())) + ' / ' + (await race(ev.exportAll())));
    await new Promise((r) => setTimeout(r, 2100));
    global.gc && global.gc();
    out('hang: heap held by 200k unflushable appends', mb(process.memoryUsage().heapUsed - h0) + ' (~' + Math.round((process.memoryUsage().heapUsed - h0) / 200000) + ' B/event)');
    out('hang: IDB rows / fallback rows', idb.s.data.size + ' / ' + JSON.parse(ls.getItem('hwpos.tillEvents.fallback.v1') || '[]').length + ' (fallback capped; the rest counted as dropped: ' + ev.dropped() + ')');
  }
  process.exit(0);
}

// ------------------------------------------------------------------ worker
async function stressWorker() {
  const { DatabaseSync } = await import('node:sqlite');
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const worker = (await import('../../worker/index.js')).default;
  const file = join(process.env.STRESS_DIR || tmpdir(), 'events-million.sqlite');
  for (const f of [file, file + '-wal', file + '-shm']) rmSync(f, { force: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('pragma journal_mode=wal; pragma synchronous=normal;');
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  // D1 shim like worker-check's, except batch() is one transaction (D1's documented batch semantics).
  const DB = {
    prepare(sql) { const st = sqlite.prepare(sql); const mk = (a) => ({ bind: (...b) => mk(b), first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => st.run(...a), _exec: () => st.run(...a) }); return mk([]); },
    async batch(stmts) { sqlite.exec('begin'); try { for (const s of stmts) s._exec(); sqlite.exec('commit'); } catch (e) { sqlite.exec('rollback'); throw e; } },
  };
  const SECRET = 's';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (store) => { const h = b64({ alg: 'HS256' }), b = b64({ exp: Math.floor(Date.now() / 1e3) + 36000, app_metadata: { store_id: store } }); return `${h}.${b}.${createHmac('sha256', SECRET).update(h + '.' + b).digest('base64url')}`; };
  const env = { DB, SUPABASE_JWT_SECRET: SECRET };
  const tok = { A: token('storeA'), B: token('storeB') };
  const call = (method, path, body, store = 'A') => worker.fetch(new Request('https://api.test' + path, { method, headers: { authorization: 'Bearer ' + tok[store], 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const count = (store) => sqlite.prepare('select count(*) c from till_events where store_id=?').get(store).c;

  // Rows exactly as a tablet stores them. Base ts: a year ago, 3 tablets, ~1 event / 15s per store.
  const base = Date.parse('2025-09-14T00:00:00.000Z');
  const row = (store, i) => { const type = TYPES[i % TYPES.length]; return { id: webcrypto.randomUUID(), ts: new Date(base + i * 15000 + (i % 7)).toISOString(), type,
    sessionId: 'sess-' + store + (i >> 12), terminal: String(1 + (i % 3)), cashier: 'Aldrin S.', cartId: 'cart_' + (i >> 4).toString(36), online: i % 11 !== 0,
    appVersion: 'app.js?v=53', synced: 0, storeId: '', data: dataFor(type, i) }; };

  const BATCH = 1000;
  const page0 = sqlite.prepare('pragma page_count').get().page_count;
  const ids = { A: [], B: [] };
  let bodyBytes = 0, statusBad = 0;
  const T0 = now();
  const lap = [];
  for (let i = 0, b = 0; i < N; b++) {
    const store = b % 2 ? 'B' : 'A';
    const n = Math.min(BATCH, N - i);
    const off = ids[store].length;
    const rows = Array.from({ length: n }, (_, k) => row(store, off + k));
    if (b < 60) ids[store].push(...rows.map((r) => r.id)); else ids[store].length += n;   // keep the first 30k ids per store for the retry storm
    const body = JSON.stringify(rows); bodyBytes += body.length;
    const res = await worker.fetch(new Request('https://api.test/tillEvents', { method: 'POST', headers: { authorization: 'Bearer ' + tok[store], 'content-type': 'application/json' }, body }), env);
    if (res.status !== 201) statusBad++;
    i += n;
    if (i % 100_000 === 0) lap.push(Math.round(100_000 / (ms(T0) / 1000 - lap.reduce((a, x) => a + 100_000 / x, 0))));
  }
  const upMs = ms(T0);
  out('worker: rows uploaded through handler', N.toLocaleString() + ' in ' + (upMs / 1000).toFixed(1) + 's = ' + Math.round(N / (upMs / 1000)).toLocaleString() + ' rows/s, non-201: ' + statusBad);
  out('worker: rows/s per 100k slice', lap.join(', '));
  out('worker: counts A / B', count('storeA').toLocaleString() + ' / ' + count('storeB').toLocaleString());
  assert.equal(count('storeA') + count('storeB'), N);
  out('worker: request body bytes per row (camelCase JSON)', (bodyBytes / N).toFixed(0));
  sqlite.exec('pragma wal_checkpoint(truncate)');
  const { page_count, page_size } = { ...sqlite.prepare('pragma page_count').get(), ...sqlite.prepare('pragma page_size').get() };
  out('worker: SQLite bytes per row (table + 3 indexes)', ((page_count - page0) * page_size / N).toFixed(0) + '  (file ' + mb(statSync(file).size) + ')');
  const avg = sqlite.prepare('select avg(length(data)) d, avg(length(id)+length(ts)+length(type)+length(session_id)+length(cart_id)+length(app_version)+length(received_at)) c from till_events').get();
  out('worker: avg data json / other text cols (chars)', avg.d.toFixed(0) + ' / ' + avg.c.toFixed(0));

  // Query plans for what the worker and a reader issue.
  const plan = (sql) => sqlite.prepare('explain query plan ' + sql).all(...['storeA', 'x', 'y'].slice(0, (sql.match(/\?/g) || []).length)).map((r) => r.detail).join(' | ');
  out('plan: GET ?since', plan('select * from till_events where store_id = ? and ts > ? order by ts'));
  out('plan: GET list', plan('select * from till_events where store_id = ? order by ts desc limit 5000'));
  out('plan: GET /:id', plan('select * from till_events where store_id = ? and id = ?'));
  out('plan: type over a range', plan('select count(*) from till_events where store_id = ? and type = ? and ts > ?'));
  out('plan: by cart (no index)', plan("select * from till_events where store_id = ? and cart_id = ? and ts > ?"));

  const get = async (path, store = 'A') => { const t0 = now(); const r = await call('GET', path, undefined, store); const txt = await r.text(); return { ms: ms(t0), bytes: txt.length, n: r.status === 200 ? JSON.parse(txt).length : r.status }; };
  const tsAt = (i) => new Date(base + i * 15000).toISOString();
  const nA = count('storeA');
  let g = await get('/tillEvents?since=' + tsAt(nA - 1000));
  out('GET ?since (last ~1k rows)', g.n + ' rows, ' + g.ms.toFixed(0) + 'ms, ' + mb(g.bytes));
  g = await get('/tillEvents?since=' + tsAt(nA - 50_000));
  out('GET ?since (last ~50k rows)', g.n + ' rows, ' + g.ms.toFixed(0) + 'ms, ' + mb(g.bytes));
  const hb = process.memoryUsage().heapUsed;
  g = await get('/tillEvents?since=2000-01-01');
  out('GET ?since=2000 (whole store, no LIMIT)', g.n.toLocaleString() + ' rows, ' + (g.ms / 1000).toFixed(1) + 's, ' + mb(g.bytes) + ' body, heap +' + mb(process.memoryUsage().heapUsed - hb));
  g = await get('/tillEvents');
  out('GET list (limit 5000)', g.n + ' rows, ' + g.ms.toFixed(0) + 'ms');
  let t0 = now(); const c = sqlite.prepare('select count(*) c from till_events where store_id=? and type=? and ts>?').get('storeA', 'sale_complete', tsAt(nA - 100_000)).c;
  out('SQL: count sale_complete in last 100k', c + ' in ' + ms(t0).toFixed(1) + 'ms');

  // Retry storm: 50k already-uploaded ids re-sent (response lost, tablet retries).
  const before = count('storeA') + count('storeB');
  t0 = now();
  for (let b = 0; b < 50; b++) {
    const store = b % 2 ? 'B' : 'A';
    const slice = ids[store].slice((b >> 1) * 1000, (b >> 1) * 1000 + 1000).map((id, k) => ({ ...row(store, k), id }));
    assert.equal((await call('POST', '/tillEvents', slice, store)).status, 201);
  }
  const after = count('storeA') + count('storeB');
  out('retry storm: 50k duplicate ids', 'rows before ' + before.toLocaleString() + ' after ' + after.toLocaleString() + ' in ' + (ms(t0) / 1000).toFixed(1) + 's');
  assert.equal(after, before, 'no duplicates');

  // Cross-store: B reads A's id, B lists, B uploads rows carrying A's ids.
  const aId = ids.A[0];
  out('cross-store: B GET A id', (await call('GET', '/tillEvents/' + aId, undefined, 'B')).status);
  const clash = ids.A.slice(0, 1000).map((id, k) => ({ ...row('B', k), id, data: { mine: 'B' } }));
  const cr = await call('POST', '/tillEvents', clash, 'B');
  const landed = sqlite.prepare("select count(*) c from till_events where store_id='storeB' and json_extract(data,'$.mine')='B'").get().c;
  out("cross-store: B POSTs 1000 rows with A's ids", 'status ' + cr.status + ' body ' + (await cr.text()) + ', rows stored for B: ' + landed + ", A's rows untouched: " + (sqlite.prepare('select store_id s from till_events where id=?').get(aId).s === 'storeA'));

  // Malformed rows.
  const beforeNull = sqlite.prepare('select count(*) c from till_events where id is null').get().c;
  await call('POST', '/tillEvents', [{ ts: tsAt(1), type: 'scan', data: {} }]);
  await call('POST', '/tillEvents', [{ ts: tsAt(1), type: 'scan', data: {} }]);
  out('malformed: row without id POSTed twice', 'rows with id NULL: ' + (sqlite.prepare('select count(*) c from till_events where id is null').get().c - beforeNull));
  const poison = Array.from({ length: 1000 }, (_, k) => row('A', 900_000 + k)); delete poison[999].type;
  const pr = await call('POST', '/tillEvents', poison);
  out('malformed: 999 good rows + 1 without type', 'status ' + pr.status + ', good rows stored: ' + sqlite.prepare('select count(*) c from till_events where id in (' + poison.slice(0, 999).map(() => '?').join(',') + ')').get(...poison.slice(0, 999).map((r) => r.id)).c);
  const noTs = { ...row('A', 1), id: 'no-ts-row' }; delete noTs.ts;
  await call('POST', '/tillEvents', [noTs]);
  const nt = sqlite.prepare("select ts, received_at from till_events where id='no-ts-row'").get();
  out('malformed: row without ts', 'stored ts=' + nt.ts + ' (server clock, looks like a real tap time)');
  sqlite.close();
  process.exit(0);
}

await (mode === 'worker' ? stressWorker() : stressStore());
