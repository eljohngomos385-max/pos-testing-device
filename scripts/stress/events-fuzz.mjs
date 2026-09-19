/* Seeded fuzz: the till event stream (data-store.js HWPOS_STORE.events), balanceAfter
   (bo-model.js makeMovement/applyMovement) and the Worker's event batch insert (worker/index.js).
   Report-only: prints every property violation with its smallest reproducing input, plus
   measurements. Exit code 1 when a property fails.
   node scripts/stress/events-fuzz.mjs [seed] [cases]                                        */
import { readFileSync } from 'node:fs';
import { Script, createContext, runInContext } from 'node:vm';
import { webcrypto, createHmac, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const SEED = Number(process.argv[2] || 20260914) >>> 0;
const CASES = Number(process.argv[3] || 100000);
const ROOT = new URL('../../', import.meta.url);
const FALLBACK = 'hwpos.tillEvents.fallback.v1';
const ORDERS = 'hwpos.orders.v1';
const SHAPE = ['id', 'ts', 'type', 'sessionId', 'terminal', 'cashier', 'cartId', 'online', 'appVersion', 'synced', 'storeId', 'data'];

// ---- seeded PRNG (mulberry32) ----
let a = SEED;
const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[int(arr.length)];
const pickW = (cat) => { const tot = cat.reduce((s, c) => s + (c[2] ?? 1), 0); let r = rnd() * tot; for (const c of cat) { r -= c[2] ?? 1; if (r <= 0) return c; } return cat[0]; };
const tick = () => new Promise((r) => setImmediate(r));
const hash = (s) => createHash('sha1').update(s).digest('hex');

const failures = new Map();
function violation(prop, label, minimal, detail = '') {
  const k = prop + ' | ' + label;
  const f = failures.get(k) || { prop, label, count: 0, minimal, detail };
  f.count++;
  failures.set(k, f);
}
const measure = (s) => console.log('  measure: ' + s);
const protoSig = (ctx) => (ctx ? runInContext('Object.getOwnPropertyNames(Object.prototype).join()+"|"+Object.getOwnPropertyNames(Array.prototype).length+"|"+({}).polluted', ctx)
  : Object.getOwnPropertyNames(Object.prototype).join() + '|' + Object.getOwnPropertyNames(Array.prototype).length + '|' + ({}).polluted);
const MAIN_PROTO = protoSig();

const BIG = 'x'.repeat(1 << 20);
const deep = (n) => { let o = { leaf: 1 }; for (let i = 0; i < n; i++) o = { a: o }; return o; };

/* ================= 1. Event store ================= */
const dsScript = new Script(readFileSync(new URL('data-store.js', ROOT), 'utf8'), { filename: 'data-store.js' });

// localStorage with a byte-ish quota: key.length + value.length UTF-16 units, as browsers count.
function fakeLocalStorage(quota = Infinity) {
  const m = new Map(); let used = 0;
  const size = (k, v) => k.length + v.length;
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      v = String(v);
      const next = used - (m.has(k) ? size(k, m.get(k)) : 0) + size(k, v);
      if (next > quota) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      m.set(k, v); used = next;
    },
    removeItem(k) { if (m.has(k)) { used -= size(k, m.get(k)); m.delete(k); } },
    rows(k) { try { return JSON.parse(m.get(k) || '[]'); } catch (_) { return []; } },
    used: () => used,
  };
}

// The IndexedDB fake from scripts/events-check.mjs, plus `unavailable` (open errors) and `hang`, and
// with transactions run one after another as real IDB does for overlapping readwrite scopes (the
// original snapshots at creation and replaces the store on commit, so two live transactions clobber).
function fakeIndexedDB({ unavailable = false } = {}) {
  const data = new Map();
  const stats = { writeTx: 0, failPut: false, hang: false, data };
  let created = false, lastTx = Promise.resolve();
  const db = {
    createObjectStore() { created = true; return { createIndex() {} }; },
    transaction(_n, mode) {
      if (mode === 'readwrite') stats.writeTx++;
      let staged = null;
      const queue = [], t = { error: null };
      const op = (fn) => { const r = {}; queue.push(() => { r.result = fn(); r.onsuccess && r.onsuccess(); }); return r; };
      const all = () => [...staged.values()].map((v) => structuredClone(v));
      const os = {
        put: (v) => op(() => { if (stats.failPut) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); staged.set(v.id, structuredClone(v)); return v.id; }),
        get: (id) => op(() => (staged.has(id) ? structuredClone(staged.get(id)) : undefined)),
        getAll: () => op(all),
        count: () => op(() => staged.size),
        index: (name) => ({ getAll: (q, count) => op(() => { const rows = all().filter((v) => (q == null ? true : typeof q === 'object' ? q.includes(v[name]) : v[name] === q)).sort((a, b) => (a[name] < b[name] ? -1 : a[name] > b[name] ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); return count ? rows.slice(0, count) : rows; }) }),   // index-key order and count, as real IDB
      };
      t.objectStore = () => os;
      if (stats.hang) { lastTx = new Promise(() => {}); return t; }
      lastTx = lastTx.then(() => new Promise((done) => setImmediate(() => {
        staged = new Map(data);
        try { while (queue.length) queue.shift()(); } catch (e) { t.error = e; t.onerror && t.onerror(); return done(); }
        if (mode === 'readwrite') { data.clear(); staged.forEach((v, k) => data.set(k, v)); }
        t.oncomplete && t.oncomplete();
        done();
      })));
      return t;
    },
  };
  return {
    stats,
    open() {
      const r = { result: db };
      setImmediate(() => {
        if (unavailable) { r.error = new Error('open failed'); return r.onerror && r.onerror(); }
        if (!created) r.onupgradeneeded && r.onupgradeneeded();
        r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
}

function boot({ idb = fakeIndexedDB(), quota = Infinity, ls = fakeLocalStorage(quota) } = {}) {
  const timers = new Map(); let tid = 0;
  const pagehide = [], visibility = [], warns = [];
  const sb = {
    localStorage: ls, navigator: { onLine: true },
    document: { visibilityState: 'visible', addEventListener: (t, fn) => { if (t === 'visibilitychange') visibility.push(fn); }, querySelector: () => ({ getAttribute: () => 'app.js?v=53' }) },
    console: { warn: (...w) => warns.push(w), log() {}, error() {} },
    setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: (t, fn) => { if (t === 'pagehide') pagehide.push(fn); },
    crypto: webcrypto,
  };
  if (idb) { sb.indexedDB = idb; sb.IDBKeyRange = { lowerBound: (v) => ({ includes: (x) => x >= v }) }; }
  sb.window = sb;
  createContext(sb);
  dsScript.runInContext(sb);
  const fireTimers = (ok) => { for (const [id, t] of [...timers]) if (ok(t.ms)) { timers.delete(id); t.fn(); } };
  return { sb, ev: sb.HWPOS_STORE.events, ls, idb, pagehide, visibility, warns, fireTimers };
}

const TYPES = [
  ['"item_add"', () => 'item_add', 30], ['undefined', () => undefined], ['null', () => null], ['0', () => 0], ['NaN', () => NaN],
  ['""', () => ''], ['1MB string', () => BIG, 0.002], ['Symbol("t")', () => Symbol('t')], ['1n', () => 1n], ['{}', () => ({})],
  ['[]', () => []], ['() => 1', () => () => 1], ['new Date(0)', () => new Date(0)], ['"__proto__"', () => '__proto__'],
  ['"constructor"', () => 'constructor'], ['Object.create(null)', () => Object.create(null)],
  ['{ toString() { throw } }', () => ({ toString() { throw new Error('boom'); } })],
];
const DATA = [
  ['undefined', () => undefined], ['null', () => null], ['0', () => 0], ['NaN', () => NaN], ['"str"', () => 'str'], ['true', () => true],
  ['{ productId, qty, unitPrice, stockOnHand, via }', () => ({ productId: 'p' + int(500), qty: 1 + int(5), unitPrice: 12.5, stockOnHand: int(40) - 5, via: 'tile' }), 30],
  ['{}', () => ({})], ['{ query: 1MB string }', () => ({ query: BIG }), 0.002], ['1MB string', () => BIG, 0.002],
  ['circular { self }', () => { const o = { a: 1 }; o.self = o; return o; }], ['function', () => function f() {}],
  ['{ a: 1, f: () => 1 }', () => ({ a: 1, f: () => 1 })], ['Symbol("s")', () => Symbol('s')], ['{ a: 1, s: Symbol() }', () => ({ a: 1, s: Symbol('s') })],
  ['1n', () => 1n], ['{ orderId, total: 10n }', () => ({ orderId: 'o1', total: 10n })], ['new Date(0)', () => new Date(0)],
  ['{ at: new Date(0) }', () => ({ at: new Date(0) })], ['nested 1000 deep', () => deep(1000)], ['nested 200000 deep', () => deep(200000), 0.01],
  ['JSON.parse(\'{"__proto__":{"polluted":1}}\')', () => JSON.parse('{"__proto__":{"polluted":1},"a":1}')],
  ['{ constructor: { prototype: { polluted: 1 } } }', () => ({ constructor: { prototype: { polluted: 1 } } })],
  ['[1, 2, 3]', () => [1, 2, 3]], ['new Number(5)', () => new Number(5)], ['new String("ab")', () => new String('ab')],
  ['{ toJSON: () => "x" }', () => ({ toJSON: () => 'x' })], ['{ toJSON: () => [1] }', () => ({ toJSON: () => [1] })],
  ['{ get a() { throw } }', () => ({ get a() { throw new Error('boom'); } })], ['Proxy throwing ownKeys', () => new Proxy({}, { ownKeys() { throw new Error('boom'); } })],
  ['Object.create(null) + a', () => Object.assign(Object.create(null), { a: 1 })], ['new Map([[1, 2]])', () => new Map([[1, 2]])],
  ['new Uint8Array(3)', () => new Uint8Array(3)], ['{ q: "\\uD800x" }', () => ({ q: '\uD800x' })], ['{ z: -0 }', () => ({ z: -0 })],
];

function shapeErr(r) {
  const keys = Object.keys(r);
  if (keys.join() !== SHAPE.join()) return 'keys are ' + keys.join();
  for (const k of ['id', 'ts', 'type', 'sessionId', 'terminal', 'cashier', 'cartId', 'appVersion', 'storeId']) if (typeof r[k] !== 'string') return k + ' is ' + typeof r[k];
  if (typeof r.online !== 'boolean') return 'online is ' + typeof r.online;
  if (r.synced !== 0 && r.synced !== 1) return 'synced is ' + r.synced;
  if (Number.isNaN(Date.parse(r.ts))) return 'ts not a date';
  if (r.data === null || typeof r.data !== 'object' || Array.isArray(r.data)) return 'data is ' + (Array.isArray(r.data) ? 'an array' : r.data === null ? 'null' : typeof r.data);
  try { const j = JSON.stringify(r); if (JSON.stringify(JSON.parse(j)) !== j) return 'JSON round trip changes the row'; } catch (e) { return 'not JSON-serializable: ' + e.message; }
  return '';
}
const rowKey = (r) => hash(JSON.stringify({ ...r, synced: 0 }));

// One append alone, in a fresh page: the smallest repro for anything the fuzz rounds see.
const singles = new Map();
async function single(tl, tf, dl, df) {
  const k = tl + ' ' + dl;
  if (singles.has(k)) return singles.get(k);
  const h = boot();
  let threw = '';
  try { h.ev.append(tf(), df()); } catch (e) { threw = String(e); }
  await h.ev.flush();
  const rows = [...h.idb.stats.data.values()];
  const out = { threw, lost: rows.length !== 1, shape: rows[0] ? shapeErr(rows[0]) : '', warn: h.warns.length ? String(h.warns[0][1]) : '' };
  singles.set(k, out);
  return out;
}

async function fuzzEvents(nAppends) {
  const h = boot();
  const { ev, idb } = h;
  const protoBefore = protoSig(h.sb);
  const seen = new Map();          // id -> hash of the row as first stored
  const marked = new Set(), tried = new Set();   // marked: a markSynced that resolved; tried: any call
  let appended = 0, round = 0, lostSoFar = 0, droppedSeen = 0;
  const pending = [];
  while (appended < nAppends) {
    round++;
    const ops = [];
    const n = 50 + int(250);
    for (let i = 0; i < n && appended < nAppends; i++) {
      const r = rnd();
      if (r < 0.80) {
        const [tl, tf] = pickW(TYPES), [dl, df] = pickW(DATA);
        const t = tf(), d = df();
        try { ev.append(t, d); } catch (e) { violation('append never throws', `type ${tl}, data ${dl}`, `HWPOS_STORE.events.append(${tl}, ${dl})`, String(e)); }
        appended++;
        ops.push([tl, tf, dl, df]);
      } else if (r < 0.85) pending.push(ev.flush());                                  // flush during flush
      else if (r < 0.87) { for (let k = 0; k < 200; k++) h.pagehide.forEach((fn) => fn()); }   // pagehide storm
      else if (r < 0.89) { h.sb.document.visibilityState = h.sb.document.visibilityState === 'hidden' ? 'visible' : 'hidden'; h.visibility.forEach((fn) => fn()); }
      else if (r < 0.93) h.fireTimers((ms) => ms === 2000);
      else if (r < 0.95) idb.stats.failPut = !idb.stats.failPut;
      else if (r < 0.97) {
        const ids = [...seen.keys()].slice(-int(40));
        const arg = pick([ids, ids, null, 'abc', [{}], [undefined], 42]);
        if (arg === ids) ids.forEach((id) => tried.add(id));
        // markSynced rejects when its write fails, so the uploader retries; only a resolved mark has to stick.
        pending.push(ev.markSynced(arg).then(() => { if (arg === ids) ids.forEach((id) => marked.add(id)); }, () => {}));
      } else await tick();
    }
    if (rnd() < 0.8) idb.stats.failPut = false;
    for (const p of pending.splice(0)) await p.then(() => {}, (e) => violation('flush promise never rejects', 'round op', 'see round', String(e)));
    await ev.flush(); await ev.flush();
    const stored = new Map(idb.stats.data);
    for (const row of h.ls.rows(FALLBACK)) if (!stored.has(row.id)) stored.set(row.id, row);
    const dropped = ev.dropped();
    // every append lands, or is counted as dropped
    const lost = appended - stored.size - dropped;
    if (lost > lostSoFar) {
      let found = false;
      const [okTl, okTf, okDl, okDf] = [TYPES[0][0], TYPES[0][1], DATA[6][0], DATA[6][1]];
      for (const [tl, tf, dl, df] of ops) {
        const s = await single(tl, tf, dl, df);
        if (!s.lost) continue;
        found = true;
        // attribute: the type alone (with normal data) or the data alone (with a normal type)
        const byType = (await single(tl, tf, okDl, okDf)).lost, byData = (await single(okTl, okTf, dl, df)).lost;
        const label = byType ? `type ${tl}` : byData ? `data ${dl}` : `type ${tl} + data ${dl}`;
        const repro = byType ? `append(${tl}, ${okDl})` : byData ? `append(${okTl}, ${dl})` : `append(${tl}, ${dl})`;
        violation('every append is stored or counted in dropped()', label, `HWPOS_STORE.events.append -> ${repro}; await flush() -> 0 rows, dropped() 0`, `only console.warn: ${s.warn}`);
      }
      if (!found) violation('every append is stored or counted in dropped()', 'interleaving', `round ${round} (seed ${SEED})`, `${lost - lostSoFar} rows missing`);
      lostSoFar = lost;
    }
    // shape of new rows
    let badShape = 0;
    for (const [id, row] of stored) if (!seen.has(id)) { if (shapeErr(row)) badShape++; seen.set(id, rowKey(row)); }
    if (badShape) for (const [tl, tf, dl, df] of ops) {
      const s = await single(tl, tf, dl, df);
      if (s.shape) violation('stored row has the fixed shape and plain-object data', `data ${dl}`, `HWPOS_STORE.events.append('x', ${dl})`, s.shape);
    }
    // previously stored rows never change (synced 0 -> 1 only for marked ids) or vanish uncounted
    const full = round % 25 === 0 || appended >= nAppends;
    let vanished = 0;
    for (const [id, key] of seen) {
      if (!full && rnd() > 0.01) continue;
      const row = stored.get(id);
      if (!row) { vanished++; continue; }
      if (rowKey(row) !== key) violation('previously stored rows never change', 'content', `row ${id}`, JSON.stringify(row).slice(0, 200));
      if (row.synced === 1 && !tried.has(id)) violation('previously stored rows never change', 'synced without markSynced', `row ${id}`);
    }
    if (full) {
      if (vanished > dropped) violation('previously stored rows never vanish uncounted', 'vanished', `round ${round}`, `${vanished} vanished, dropped() ${dropped}`);
      const unmarked = [...marked].filter((id) => stored.has(id) && stored.get(id).synced !== 1).length;
      if (unmarked) violation('markSynced sticks', 'lost', `round ${round}`, `${unmarked} of ${marked.size} marked ids read back synced 0 (markSynced resolved but the mark did not land -- see scratch diag case A)`);
      for (const id of [...seen.keys()]) if (!stored.has(id)) seen.delete(id);
    }
    droppedSeen = dropped;
    if (protoSig(h.sb) !== protoBefore || protoSig() !== MAIN_PROTO) violation('no prototype pollution', 'event store', `round ${round}`);
  }
  const all = await ev.list();
  if (all.length !== idb.stats.data.size + h.ls.rows(FALLBACK).length - [...h.ls.rows(FALLBACK)].filter((r) => idb.stats.data.has(r.id)).length)
    violation('list() sees every stored row', 'count', `after ${appended} appends`, `${all.length} listed`);
  measure(`event store: ${appended} hostile appends in ${round} rounds, ${idb.stats.data.size} rows in IDB, ${h.ls.rows(FALLBACK).length} in fallback, dropped() ${droppedSeen}, ${idb.stats.writeTx} write transactions, lost ${lostSoFar}`);
}

// Deterministic storage scenarios: the fallback's cap is 2000 ROWS, not bytes.
async function storageScenarios() {
  const QUOTA = 5_000_000;   // assumption: ~5MB of UTF-16 units per origin
  const row = () => ({ productId: 'p' + int(500), qty: 1, unitPrice: 245.5, stockOnHand: 12, via: 'search' });

  // S1: IDB unavailable, 2000 realistic rows in the fallback, then the till saves an order.
  {
    const ls = fakeLocalStorage(QUOTA);
    ls.setItem(ORDERS, 'o'.repeat(4_300_000));
    const h = boot({ idb: fakeIndexedDB({ unavailable: true }), ls });
    const before = ls.used();
    let saved = true;
    try { ls.setItem(ORDERS, 'o'.repeat(4_320_000)); ls.setItem(ORDERS, 'o'.repeat(4_300_000)); } catch (_) { saved = false; }
    for (let i = 0; i < 2000; i++) h.ev.append('item_add', row());
    await h.ev.flush();
    const fb = ls.getItem(FALLBACK) || '';
    let savedAfter = true;
    try { ls.setItem(ORDERS, 'o'.repeat(4_320_000)); } catch (_) { savedAfter = false; }
    measure(`S1 fallback at cap: ${h.ls.rows(FALLBACK).length} realistic item_add rows = ${fb.length} chars (${(fb.length / 2000).toFixed(0)}/row); localStorage used ${before} -> ${ls.used()} of ${QUOTA}`);
    if (saved && !savedAfter) violation('events can never fill the till\'s localStorage', 'order save fails after fallback fills', 'IDB unavailable; localStorage 5,000,000 units with 4.3M of orders; 2000 item_add events; then a 20KB-larger orders write',
      `orders write OK before (${saved}), QuotaExceededError after the fallback took ${fb.length} chars`);
    const perRow = Math.ceil(QUOTA / 2000);
    measure(`S1 a data field of ~${perRow - 250} chars per row lets 2000 fallback rows fill a 5,000,000-unit origin on their own`);
  }

  // S2: fallback near full; one flush carries 9 normal rows and one 1MB row.
  {
    const ls = fakeLocalStorage(QUOTA);
    const h = boot({ idb: fakeIndexedDB({ unavailable: true }), ls });
    for (let i = 0; i < 1990; i++) h.ev.append('item_add', row());
    await h.ev.flush();
    ls.setItem(ORDERS, 'o'.repeat(QUOTA - ls.used() - 400_000));   // 400K left
    const oldest = h.ls.rows(FALLBACK)[0].id;
    for (let i = 0; i < 9; i++) h.ev.append('scan', { code: 'NORMAL' + i, found: true });
    h.ev.append('search', { query: BIG });
    await h.ev.flush();
    const rows = h.ls.rows(FALLBACK);
    const normalKept = rows.filter((r) => String(r.data.code || '').startsWith('NORMAL')).length;
    measure(`S2 after the mixed flush: fallback ${rows.length} rows, normal rows kept ${normalKept}/9, oldest row kept ${rows.some((r) => r.id === oldest)}, dropped() ${h.ev.dropped()}`);
    if (normalKept < 9 && rows.some((r) => r.id === oldest))
      violation('fallback drops oldest, not newest', 'one oversized row in a flush', 'IDB unavailable; fallback 1990 rows with 400K units free; append 9 scan rows + append("search", { query: 1MB }); flush',
        `all ${9 - normalKept + 1} new rows dropped while the 1990 old rows stay (writeKey fails -> lost = rows.length)`);
    // S3: now the origin is completely full: the dropped counter cannot be written either
    ls.setItem(ORDERS, 'o'.repeat(QUOTA - ls.used() + (ls.getItem(ORDERS) || '').length));
    const d0 = h.ev.dropped(), n0 = rows.length;
    for (let i = 0; i < 5; i++) h.ev.append('scan', { code: 'FULL' + i, found: true });
    await h.ev.flush();
    const d1 = h.ev.dropped(), n1 = h.ls.rows(FALLBACK).length;
    measure(`S3 origin full: fallback rows ${n0} -> ${n1}, dropped() ${d0} -> ${d1} after 5 appends`);
    if (n1 - n0 + d1 - d0 < 5) violation('every append is stored or counted in dropped()', 'origin completely full', 'IDB unavailable; localStorage at quota; append 5 events; flush', `${5 - (n1 - n0) - (d1 - d0)} rows gone with no dropped count (safeSetItem on the dropped key fails too)`);
  }

  // S4: fallback flush cost at the cap (main thread, every 2s while IDB is down).
  {
    const h = boot({ idb: fakeIndexedDB({ unavailable: true }) });
    for (let i = 0; i < 2000; i++) h.ev.append('item_add', row());
    await h.ev.flush();
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { h.ev.append('scan', { code: 'x' }); await h.ev.flush(); }
    measure(`S4 one fallback flush with 2000 rows stored: ${((performance.now() - t0) / 20).toFixed(1)} ms (desktop node; includes the failing IDB open)`);
  }

  // S5: append cost on the happy path.
  {
    const h = boot();
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) h.ev.append('item_add', row());
    const ms = performance.now() - t0;
    await h.ev.flush();
    measure(`S5 append: ${(ms / 20000 * 1000).toFixed(1)} us per call (sync part), 20000 rows -> ${h.idb.stats.writeTx} transaction(s)`);
  }

  // S6: a hung IDB transaction (already listed OPEN): append still never throws; nothing lands.
  {
    const h = boot();
    h.idb.stats.hang = true;
    h.ev.append('item_add', row());
    let settled = false;
    h.ev.flush().then(() => { settled = true; });
    for (let i = 0; i < 20; i++) await tick();
    let threw = false;
    try { for (let i = 0; i < 5000; i++) h.ev.append('item_add', row()); h.pagehide.forEach((fn) => fn()); h.fireTimers(() => true); } catch (_) { threw = true; }
    for (let i = 0; i < 20; i++) await tick();
    measure(`S6 hung transaction: flush settled ${settled}, append threw ${threw}, rows in IDB ${h.idb.stats.data.size}, fallback ${h.ls.rows(FALLBACK).length} (5001 appends held in memory only)`);
  }

  // S7: hostile setContext value poisons every later append (not reachable from app.js track(): cartId is always a string).
  {
    const h = boot();
    h.ev.setContext({ cashier: Object.create(null) });
    for (let i = 0; i < 5; i++) h.ev.append('item_add', row());
    await h.ev.flush();
    measure(`S7 setContext({ cashier: Object.create(null) }) then 5 appends: ${h.idb.stats.data.size} stored, dropped() ${h.ev.dropped()}, warn text "${h.warns[0] && h.warns[0][0]}"`);
  }
}

/* ================= 2. balanceAfter ================= */
function fuzzMovements(n) {
  const require = createRequire(import.meta.url);
  const { makeMovement, applyMovement } = require('../../bo-model.js');
  const STOCKS = [0, 10, -5, 2.555, 1e15, NaN, 'abc', '12', null, undefined, Infinity, -0, 0.07];
  const QTYS = [1, -1, 3, -3, 2.5, -0.5, 0.4, 0.005, -0.005, 0.01, 1.005, 0.07, 1e-9, NaN, 'abc', '5', null, Infinity, -Infinity, 1e308, {}, true];
  const cent = (x) => Math.round(x * 100);
  const kind = (q) => (typeof q !== 'number' ? 'non-number' : !Number.isFinite(q) ? 'non-finite' : Number.isInteger(q) ? 'integer' : Number.isInteger(Math.round(q * 1e6) / 1e4) ? '2-decimal' : 'finer than 0.01');
  const smallest = new Map();
  let nonFinite = 0, healed = 0, rows = 0, bigStock = 0;
  for (let c = 0; c < n; c++) {
    const p = { id: 'p', soldBy: pick(['each', 'measure']), stock: pick(STOCKS) };
    if (typeof p.stock !== 'number' || Number.isNaN(p.stock)) healed++;
    let prev = null;
    const len = 1 + int(8);
    for (let i = 0; i < len; i++) {
      const qty = rnd() < 0.5 ? pick(QTYS) : Math.round((rnd() * 20 - 10) * 1000) / 1000;
      let mv;
      try { mv = makeMovement({ productId: 'p', qty, reason: pick(['sale', 'delivery', 'count', 'bogus']) }); applyMovement(p, mv); }
      catch (e) { violation('applyMovement never throws', kind(qty), `applyMovement(${JSON.stringify(p)}, makeMovement({ qty: ${String(qty)} }))`, String(e)); break; }
      rows++;
      if (!Object.is(mv.balanceAfter, p.stock)) violation('balanceAfter === product.stock', kind(qty), `qty ${qty}`);
      const back = JSON.parse(JSON.stringify(mv)).balanceAfter;
      if (!Number.isFinite(mv.balanceAfter)) { nonFinite++; prev = null; continue; }
      if (back !== mv.balanceAfter && !(back === 0 && Object.is(mv.balanceAfter, -0))) violation('balanceAfter survives JSON', kind(qty), `balanceAfter ${mv.balanceAfter}`);
      // What the Worker stores (qty and balance_after both * 100): the previous balance plus this row's
      // qty must equal this row's balance, or the log and the stamp disagree.
      // ponytail: |stock| >= 1e9 is outside any shelf and loses float precision in *100; counted, not reported.
      if (prev != null && Math.abs(prev) >= 1e9) { bigStock++; prev = mv.balanceAfter; continue; }
      if (prev != null && Number.isFinite(mv.qty) && cent(prev) + cent(mv.qty) !== cent(mv.balanceAfter)) {
        const label = `${p.soldBy}, qty ${kind(mv.qty)}`;
        const repro = `p = { soldBy: '${p.soldBy}', stock: ${prev} }; mv = makeMovement({ productId: 'p', qty: ${mv.qty}, reason: 'delivery' }); applyMovement(p, mv)`;
        const cur = smallest.get(label);
        if (!cur || repro.length < cur.repro.length) smallest.set(label, { repro, detail: `balanceAfter ${mv.balanceAfter}; Worker stores balance_after ${cent(mv.balanceAfter)} but ${cent(prev)} + qty ${cent(mv.qty)} = ${cent(prev) + cent(mv.qty)}` });
        violation('prev balance + qty === balanceAfter (in stored hundredths)', label, '', '');
      }
      prev = mv.balanceAfter;
    }
  }
  for (const [label, s] of smallest) { const f = failures.get('prev balance + qty === balanceAfter (in stored hundredths) | ' + label); f.minimal = s.repro; f.detail = s.detail; }
  measure(`movements: ${n} products, ${rows} movements; ${nonFinite} non-finite balanceAfter (serialise to null); ${healed} products started with NaN/string/null stock (read as 0, not logged); ${bigStock} rows past |stock| 1e9 skipped`);
  // Not reachable through makeMovement (every caller uses it): a raw string qty concatenates.
  const rawMv = { qty: '5', ts: '' };
  applyMovement({ soldBy: 'each', stock: 3 }, rawMv);
  measure(`movements: applyMovement({ stock: 3 }, { qty: '5' }) without makeMovement -> balanceAfter ${rawMv.balanceAfter} (makeMovement coerces, so callers are safe)`);
}

/* ================= 3. Worker batch insert ================= */
async function fuzzWorker(nBatches) {
  const worker = (await import(new URL('worker/index.js', ROOT))).default;
  const SECRET = 'fuzz-secret';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ email: 'a@b.c', exp: Math.floor(Date.now() / 1e3) + 36000 });
  const JWT = `${head}.${body}.${createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url')}`;
  const schema = readFileSync(new URL('schema.sql', ROOT), 'utf8');
  // D1 shim. Real D1 batch() is one transaction: a failing statement rolls the batch back. It returns one
  // result per statement; the worker sums their meta.changes.
  function makeEnv(transactional = true) {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(schema);
    const DB = {
      prepare(sql) {
        const stmt = sqlite.prepare(sql);
        const mk = (args) => ({ bind: (...x) => mk(x), first: async () => stmt.get(...args) ?? null, all: async () => ({ results: stmt.all(...args) }), run: async () => stmt.run(...args), _exec: () => stmt.run(...args) });
        return mk([]);
      },
      async batch(stmts) {
        if (!transactional) return stmts.map((s) => ({ meta: s._exec() }));
        sqlite.exec('BEGIN');
        try { const out = stmts.map((s) => ({ meta: s._exec() })); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      },
    };
    return { sqlite, env: { DB, SUPABASE_JWT_SECRET: SECRET, DEFAULT_STORE: 'main' } };
  }
  const post = async (e, text, method = 'POST', path = '/tillEvents') => {
    const res = await worker.fetch(new Request('https://api.test' + path, { method, headers: { authorization: 'Bearer ' + JWT, 'content-type': 'application/json' }, body: text }), e.env);
    return { status: res.status, body: await res.text() };
  };
  const count = (e) => e.sqlite.prepare('select count(*) n from till_events').get().n;
  const rejectedIdx = (body) => { try { return new Set(JSON.parse(body).rejected.map((x) => x.index)); } catch (_) { return new Set(); } };
  let seq = 0;
  const valid = () => ({ id: 'ev-' + SEED + '-' + (++seq), ts: new Date(Date.UTC(2026, 8, 1) + int(1e9)).toISOString(), type: pick(['item_add', 'scan', 'search']), sessionId: 's1', terminal: '1', cashier: 'Ana', cartId: 'cart_' + int(50), online: rnd() < 0.9, appVersion: 'app.js?v=53', synced: 0, storeId: '', data: { productId: 'p' + int(99), qty: 1 } });
  const w = (f) => () => { const r = valid(); f(r); return r; };
  const ROWS = [
    ['valid', valid, 40],
    ['missing id', w((r) => delete r.id)], ['id null', w((r) => { r.id = null; })], ['id ""', w((r) => { r.id = ''; })],
    ['id 123', w((r) => { r.id = 100000 + int(1e9); })], ['id {}', w((r) => { r.id = {}; })], ['id [1]', w((r) => { r.id = [1]; })], ['id true', w((r) => { r.id = true; })],
    ['duplicate id in batch', 'DUP'],
    ['missing type', w((r) => delete r.type)], ['type null', w((r) => { r.type = null; })], ['type 7', w((r) => { r.type = 7; })], ['type {}', w((r) => { r.type = {}; })],
    ['missing ts', w((r) => delete r.ts)], ['ts "garbage"', w((r) => { r.ts = 'garbage'; })], ['ts 12345', w((r) => { r.ts = 12345; })], ['ts {}', w((r) => { r.ts = {}; })],
    ['data "not json"', w((r) => { r.data = 'not json'; })], ['data null', w((r) => { r.data = null; })], ['data [1,2]', w((r) => { r.data = [1, 2]; })],
    ['data 1MB', w((r) => { r.data = { q: BIG }; }), 0.01], ['data __proto__ key', w((r) => { r.data = JSON.parse('{"__proto__":{"polluted":1}}'); })],
    ['online "yes"', w((r) => { r.online = 'yes'; })], ['cashier {}', w((r) => { r.cashier = { name: 'x' }; })],
    ['store_id spoof', w((r) => { r.store_id = 'other'; r.storeId = 'other'; })], ['session_id null + sessionId', w((r) => { r.session_id = null; })],
    ['extra keys', w((r) => { r.received_at = '1999'; r.bogus = 1; })],
    ['row null', () => null], ['row 5', () => 5], ['row "str"', () => 'str'], ['row []', () => []], ['row {}', () => ({})],
  ];
  const gen = (label, batch) => {
    const entry = ROWS.find((r) => r[0] === label);
    if (entry[1] === 'DUP') { const b = batch.find((x) => x && typeof x.id === 'string' && x.id.startsWith('ev-')); return b ? { ...b, cartId: 'dup' } : valid(); }
    return entry[1]();
  };

  // What happens to each row kind, alone behind one valid row, on a fresh DB, sent twice.
  const outcome = new Map();
  for (const [label] of ROWS) {
    const e = makeEnv();
    const b = [valid()]; b.push(gen(label, b));
    const text = JSON.stringify(b);
    const r1 = await post(e, text), n1 = count(e), r2 = await post(e, text), n2 = count(e);
    outcome.set(label, { status: r1.status, rejected: rejectedIdx(r1.body).has(1), inserted: n1, replayInserted: n2 - n1, body: r1.body.slice(0, 90) });
  }
  console.log('\n  Worker: [valid row, <kind>] on a fresh DB, then the same body re-sent');
  for (const [label, o] of outcome) console.log(`    ${label.padEnd(30)} ${o.status}  inserted ${o.inserted}/2  replay inserted ${o.replayInserted}  ${o.status !== 201 || o.rejected ? o.body : ''}`);
  for (const [label, o] of outcome) if (o.replayInserted) violation('re-sending a batch books nothing twice', label, `POST /tillEvents [validRow, { ...validRow2, ${label} }] twice`, `replay inserted ${o.replayInserted} more row(s): till_events.id is "text primary key" without NOT NULL, so SQLite keeps NULL ids and on conflict(id) never fires`);
  { const o = outcome.get('duplicate id in batch'); if (o.status === 201 && o.inserted === 1 && !o.rejected) measure(`worker: a batch with 2 rows sharing an id returns ${o.body} but stores 1 row (second copy silently dropped)`); }

  // Random mixed batches: each row is accepted or rejected exactly as it was alone; 400 only when all are bad.
  const e = makeEnv();
  const sample = new Map();
  let rowsSent = 0, ok = 0, rejected = 0;
  for (let bi = 0; bi < nBatches; bi++) {
    const size = int(40);
    const batch = [], labels = [];
    for (let i = 0; i < size; i++) { const [label] = rnd() < 0.98 ? ROWS[0] : pickW(ROWS.slice(1)); labels.push(label); batch.push(gen(label, batch)); }
    rowsSent += size;
    const text = JSON.stringify(batch);
    const n0 = count(e);
    const r = await post(e, text);
    const n1 = count(e);
    const got = rejectedIdx(r.body);
    const expectRejected = labels.map((l, i) => (l === 'duplicate id in batch' ? batch.slice(0, i).some((x) => x && x.id === batch[i].id) : outcome.get(l).rejected));
    const expectFail = size > 0 && expectRejected.every(Boolean);
    expectRejected.forEach((want, i) => { if (got.has(i) !== want) violation('a row is rejected in a batch exactly when it is rejected alone', labels[i], `index ${i}`, r.body.slice(0, 120)); });
    if (![201, 400, 413].includes(r.status)) violation('batch status is 201/400/413 (500 = a row passed rowError but failed in SQL)', String(r.status), [...new Set(labels)].join(', '), r.body.slice(0, 120));
    if (r.status !== 201 && n1 !== n0) violation('a rejected batch stores nothing', 'partial', `labels ${[...new Set(labels)].join(', ')}`, `${n1 - n0} rows stored with status ${r.status}`);
    if ((r.status !== 201) !== expectFail) violation('batch is 400 only when every row is bad', r.status + '', `labels ${[...new Set(labels)].join(', ')}`, r.body.slice(0, 120));
    if (r.status === 201) {
      ok++;
      for (const [i, row] of batch.entries()) if (!got.has(i) && !e.sqlite.prepare('select 1 from till_events where id = ?').get(row.id)) violation('201 stores every row it did not reject', 'missing', `id ${JSON.stringify(row.id)}`);
      const r2 = await post(e, text);
      if (r2.status !== 201) violation('replay gives the same status', String(r2.status), [...new Set(labels)].join(', '));
      const extra = count(e) - n1;
      if (extra) {
        const culprit = [...new Set(labels)].filter((l) => outcome.get(l).replayInserted).join(', ') || 'unknown';
        violation('re-sending a batch books nothing twice', culprit, 'see the single-kind table above', `random batch replay stored ${extra} extra row(s)`);
      }
      if (sample.size < 300) for (const row of e.sqlite.prepare('select rowid, * from till_events order by random() limit 5').all()) sample.set(row.rowid, JSON.stringify(row));
    } else rejected++;
    if (bi % 200 === 0) for (const [rowid, j] of sample) { const now = e.sqlite.prepare('select rowid, * from till_events where rowid = ?').get(rowid); if (JSON.stringify(now) !== j) violation('previously stored rows never change', 'worker', `rowid ${rowid}`); }
    if (protoSig() !== MAIN_PROTO) violation('no prototype pollution', 'worker', `batch ${bi}`);
  }
  measure(`worker: ${nBatches} random batches, ${rowsSent} rows, ${ok} accepted, ${rejected} rejected whole, ${count(e)} rows stored`);

  // Edges.
  const f = makeEnv();
  const edge = async (label, text, method, path) => { const t0 = performance.now(); const r = await post(f, text, method, path); measure(`worker edge ${label}: ${r.status} ${r.body.slice(0, 80)} (${(performance.now() - t0).toFixed(0)} ms, rows now ${count(f)})`); return r; };
  await edge('[]', '[]');
  await edge('1001 rows', JSON.stringify(Array.from({ length: 1001 }, valid)));
  await edge('100000 rows', JSON.stringify(Array.from({ length: 100000 }, valid)));
  await edge('1000 valid rows', JSON.stringify(Array.from({ length: 1000 }, valid)));
  const bad = await edge('body "not json"', 'not json');
  if (bad.status === 500) measure('worker: a non-JSON body is a 500 with the parser message, not a 400');
  await edge('body null', 'null');
  await edge('body {} (single-row path)', '{}');
  await edge('PATCH /tillEvents/x', '{"type":"y"}', 'PATCH', '/tillEvents/x');
  await edge('DELETE /tillEvents/x', undefined, 'DELETE', '/tillEvents/x');
  await edge('PUT /tillEvents', '[]', 'PUT');
  const g = makeEnv();
  await post(g, JSON.stringify([{ ...valid(), ts: 'garbage' }]));
  const since = await post(g, undefined, 'GET', '/tillEvents?since=2099-01-01T00:00:00.000Z');
  const sinceRows = JSON.parse(since.body);
  measure(`worker: a row sent with ts "garbage", then GET ?since=2099-01-01 returns ${sinceRows.length} row(s)`);
  // The non-transactional shim in scripts/worker-check.mjs cannot see a rollback.
  const h = makeEnv(false);
  const mixed = JSON.stringify([valid(), { ...valid(), type: null }]);
  const hr = await post(h, mixed);
  const tx = makeEnv(); const tr = await post(tx, mixed);
  measure(`worker: [valid, type null] -> ${hr.status} with ${count(h)} row left in a loop-style batch shim (worker-check.mjs), ${tr.status} with ${count(tx)} in a transactional one (D1)`);
}

/* ================= run ================= */
const t0 = performance.now();
const nEvents = Math.round(CASES * 0.8), nMoves = Math.round(CASES * 0.17), nBatches = Math.max(50, Math.round(CASES * 0.03 / 1.5));
console.log(`events-fuzz seed ${SEED}, ${CASES} cases (${nEvents} appends, ${nMoves} movement sequences, ${nBatches} worker batches)`);
await fuzzEvents(nEvents);
await storageScenarios();
fuzzMovements(nMoves);
await fuzzWorker(nBatches);
if (protoSig() !== MAIN_PROTO) violation('no prototype pollution', 'end of run', 'whole run');

console.log(`\n${failures.size ? failures.size + ' property violation(s)' : 'no property violations'} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
for (const f of failures.values()) {
  console.log(`\nFAIL ${f.prop} [${f.label}] x${f.count}`);
  if (f.minimal) console.log(`  minimal: ${f.minimal}`);
  if (f.detail) console.log(`  detail:  ${f.detail}`);
}
process.exitCode = failures.size ? 1 : 0;
