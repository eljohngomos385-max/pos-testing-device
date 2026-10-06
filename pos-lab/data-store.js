/* ==========================================================
   Hardware POS — Data-store abstraction
   ----------------------------------------------------------
   Thin wrapper over the persistence layer so the UI can stay
   storage-agnostic. Today: localStorage (sync). Tomorrow:
   swap `localStore` for `remoteStore` (Supabase / Firestore /
   custom REST) without touching the app code.

   Usage (from app.js or backoffice.js):
     const store = window.HWPOS_STORE;
     const products = await store.products.list();
     await store.orders.add(orderObj);
     store.events.on('orders:changed', cb);
   ========================================================== */
(function () {
  'use strict';

  // ---- Pub-sub for cross-tab + in-page change notifications ----
  const listeners = new Map();
  function on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt)?.delete(fn);
  }
  function emit(evt, payload) {
    listeners.get(evt)?.forEach(fn => { try { fn(payload); } catch (_) {} });
  }

  // ---- LocalStorage adapter (current default) ----
  const KEYS = {
    folders:   'hwpos.folders.v2',
    products:  'hwpos.products.v2',
    groups:    'hwpos.groups.v1',
    orders:    'hwpos.orders.v1',
    orderSeq:  'hwpos.orderSeq.v1',
    customers: 'hwpos.customers.v1',
    customerLedger: 'hwpos.customerLedger.v1',
    // No drawerCloseouts: the cash drawer closeout was removed on purpose (owner); nothing writes it.
    settings:  'hwpos.settings.v1',
    role:      'hwpos.role.v1',
    // Back office (bo-model.js / backoffice.js own the writes). Field meanings: docs/data-dictionary.md.
    stockMovements: 'hwpos.stockMovements.v1',
    // When this device's saved counts became opening rows (seedOpening, once). In the backup: an old
    // one has none, so restoring it seeds again from the counts it carries.
    stockAnchored: 'hwpos.stockAnchored.v1',
    purchaseOrders: 'hwpos.purchaseOrders.v1',
    suppliers: 'hwpos.suppliers.v1',
    modifiers: 'hwpos.modifiers.v1',
    staff:     'hwpos.staff.v1',
    tillPerms: 'hwpos.tillPerms.v1',
    adjustments: 'hwpos.adjustments.v1',
    // Saved carts and quotes (pos-checkout.js): drafts, not orders -- no number, no stock, no money; deletable.
    savedCarts: 'hwpos.savedCarts.v1',
    // Event logs, append-only (bo-model.js EVENT_LOGS).
    priceLog:  'hwpos.priceLog.v1',
    lostDemand: 'hwpos.lostDemand.v1',
    deliveryEvents: 'hwpos.deliveryEvents.v1',
    supplierMessages: 'hwpos.supplierMessages.v1',
    decisions: 'hwpos.decisions.v1',
    pinLockouts: 'hwpos.pinLockouts.v1',
    // The till's shift, append-only (pos-shift.js): shift_open, cash_move, shift_close rows.
    shifts:    'hwpos.shifts.v1',
    // Till event stream lives in IndexedDB 'hwpos-events'; these two only catch it when IDB can't.
    tillEventsFallback: 'hwpos.tillEvents.fallback.v1',
    tillEventsDropped: 'hwpos.tillEvents.dropped.v1',
    // The pages each role may open (bo-staff), and the tile and theme choices both apps read.
    access:    'hwpos.access.v1',
    tileSize:  'hwpos.tileSize',
    showPrice: 'hwpos.showPrice',
    theme:     'hwpos.theme',
  };
  // ---- Sheets: the three lists that grow with every sale ----
  // localStorage holds ~5M characters per site and a 3-line sale plus its stock rows is ~2,000,
  // so a till filled it after ~2,600 sales and then stopped saving (measured 2026-10-02). These
  // keys live in IndexedDB instead, read from a copy in memory so every caller stays synchronous;
  // everything else stays in localStorage. `kv` has the Storage interface, so app.js, backoffice.js
  // and readKey/writeKey swap one identifier. Apps call `ready()` before their first read.
  // ponytail: one record per list, rewritten per save -- the same O(history) per sale localStorage
  // was. Row-per-record once the till prunes synced history (Phase 3).
  const SHEET_KEYS = [KEYS.orders, KEYS.stockMovements, KEYS.customerLedger];
  const SHEET_DB = 'hwpos-sheets';
  const sheets = new Map();          // the copy every read comes from, once `sheetsOn`
  let sheetsOn = false;              // routing: set once, for the whole page life
  let sheetDb = null;                // the connection: null while lost (iPad sleep, versionchange)
  let sheetReady = null;
  let sheetChannel = null;
  let sheetFails = 0;
  let reopening = false;
  let sheetPending = false;          // the database is still opening; reads come from localStorage
  const dirty = new Set();           // keys whose copy is newer than IndexedDB
  const fellBack = new Set();        // keys with rows parked in localStorage (refused, or page closing)
  const committed = new Map();       // what IndexedDB holds, as far as this page knows
  const isSheet = (key) => sheetsOn && SHEET_KEYS.includes(key);

  function sheetOpen(ms = 0) {
    const open = new Promise((resolve, reject) => {
      const req = indexedDB.open(SHEET_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sheets');
      req.onsuccess = () => {
        const db = req.result;
        const lost = () => { if (sheetDb === db) sheetDb = null; };
        db.onversionchange = () => { lost(); try { db.close(); } catch (_) {} };
        db.onclose = lost;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    return ms ? Promise.race([open, new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB open timeout')), ms))]) : open;
  }
  // Writes the copy of every dirty key in one transaction; its latest value, so saves coalesce.
  // A lost connection reopens once; a second failure in a row keeps the copy in localStorage
  // (merged back on the next start) and tells the cashier.
  function sheetFlush() {
    if (!dirty.size) return;
    if (!sheetDb) {
      if (reopening) return;
      reopening = true;
      sheetOpen(5000).then((db) => { reopening = false; sheetDb = db; sheetFlush(); },
        (e) => { reopening = false; sheetFailed(e); });
      return;
    }
    const keys = [...dirty];
    const vals = keys.map((k) => sheets.get(k));
    dirty.clear();
    try {
      const tx = sheetDb.transaction('sheets', 'readwrite');
      const os = tx.objectStore('sheets');
      keys.forEach((k, i) => (vals[i] != null ? os.put(vals[i], k) : os.delete(k)));
      tx.oncomplete = () => {
        sheetFails = 0;
        // IndexedDB now has everything: drop the parked rows, or the next start merges a delete back.
        keys.forEach((k, i) => {
          if (vals[i] != null) committed.set(k, vals[i]); else committed.delete(k);
          if (vals[i] === sheets.get(k) && fellBack.delete(k)) { try { localStorage.removeItem(k); } catch (_) {} }
        });
      };
      tx.onabort = () => { keys.forEach((k) => dirty.add(k)); sheetFailed(tx.error); };
    } catch (e) { keys.forEach((k) => dirty.add(k)); sheetFailed(e); }
  }
  function sheetFailed(err) {
    sheetDb = null;
    if (++sheetFails < 2) return sheetFlush();
    sheetFails = 0;
    try { console.error('[HWPOS] could not save sales to IndexedDB', err); } catch (_) {}
    sheetStash([...dirty]);
    emit('save:failed', { keys: [...dirty] });
  }
  // Rows the copy has and IndexedDB does not yet, parked in localStorage. Sync, so it lands even as
  // the page closes (an IndexedDB write started then never commits). Only the new rows: the whole
  // list would not fit -- that is why it moved. The next start merges them back by id.
  function sheetStash(keys) {
    keys.forEach((k) => {
      const now = sheets.get(k);
      if (now == null || now === committed.get(k)) return;
      try {
        const known = new Set((JSON.parse(committed.get(k) || '[]') || []).map((r) => r && r.id));
        const fresh = JSON.parse(now).filter((r) => !(r && known.has(r.id)));
        if (fresh.length) { localStorage.setItem(k, JSON.stringify(fresh)); fellBack.add(k); }
      } catch (_) {}
    });
  }
  try {
    const park = () => { if (sheetsOn) sheetStash(SHEET_KEYS); };
    window.addEventListener('pagehide', park);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') park(); });
  } catch (_) {}
  // One flush and one message per key per task, with its latest value. A sale saves orders, then
  // stock; a loop of sales (math-audit, an import) saved each list once per row, and every save
  // was a transaction holding a full copy that could not commit until the loop ended: memory and
  // time grew with the square of the history. IndexedDB commits only after the task anyway, and
  // the microtask runs before any pagehide, so waiting for it loses nothing.
  // A key removed in the task (a restore: removeItem, then setItem) is sent as `reset`: the other
  // tabs REPLACE their copy with it. Sent as a plain value it was merged into their old rows and
  // the union came back, undoing the restore.
  const unsent = new Set(), removed = new Set();
  function sheetWrite(key) {
    dirty.add(key);
    if (unsent.size) return unsent.add(key);
    unsent.add(key);
    Promise.resolve().then(() => {
      const keys = [...unsent], reset = new Set(removed);
      unsent.clear(); removed.clear();
      sheetFlush();
      keys.forEach((k) => { try { sheetChannel && sheetChannel.postMessage({ key: k, value: sheets.has(k) ? sheets.get(k) : null, reset: reset.has(k) }); } catch (_) {} });
    });
  }
  const kv = {
    getItem: (key) => (isSheet(key) ? (sheets.has(key) ? sheets.get(key) : null) : localStorage.getItem(key)),
    setItem(key, value) {
      if (!isSheet(key)) return localStorage.setItem(key, value);
      sheets.set(key, String(value));
      sheetWrite(key);
    },
    removeItem(key) {
      if (!isSheet(key)) return localStorage.removeItem(key);
      sheets.delete(key);
      removed.add(key);
      sheetWrite(key);
    },
  };
  // A list found in localStorage (a build before this one, a save IndexedDB refused, a start that
  // ran without IndexedDB) joins the IndexedDB list: union by id, localStorage's copy of a row wins,
  // then by time -- orders and the ledger newest first, stock changes oldest first. Not by
  // position: a refused save leaves an older full copy, not only newer rows.
  const rowTime = (r) => {
    const t = r && (typeof r.ts === 'number' ? r.ts : Date.parse(r.ts));
    return Number.isFinite(t) ? t : 0;
  };
  function mergeSheet(key, fromLs, fromDb) {
    let a, b;
    try { a = JSON.parse(fromLs); } catch (_) { a = null; }
    if (!Array.isArray(a)) return null;               // unreadable: keep IndexedDB's, leave it be
    try { b = fromDb == null ? [] : JSON.parse(fromDb); } catch (_) { b = []; }
    if (!Array.isArray(b)) b = [];
    const idOf = (r) => (r && r.id != null ? 'id:' + r.id : 'row:' + JSON.stringify(r));
    const seen = new Set(a.map(idOf));
    const rows = a.concat(b.filter((r) => !seen.has(idOf(r))));
    const dir = key === KEYS.stockMovements ? 1 : -1;
    rows.sort((x, y) => dir * (rowTime(x) - rowTime(y)));   // stable: equal times keep their order
    return JSON.stringify(rows);
  }
  // Reads every list into the copy, folding in localStorage's. Runs in one transaction; anything
  // localStorage gained meanwhile (a till that started without waiting) is folded in afterwards.
  function sheetLoad(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sheets', 'readwrite');
      const os = tx.objectStore('sheets');
      const loaded = new Map();
      const seenLs = new Map();
      for (const key of SHEET_KEYS) {
        const req = os.get(key);
        req.onsuccess = () => {
          const fromLs = localStorage.getItem(key);
          const merged = fromLs == null ? null : mergeSheet(key, fromLs, req.result);
          if (merged != null) { os.put(merged, key); seenLs.set(key, fromLs); }
          const value = merged != null ? merged : req.result;
          if (value != null) loaded.set(key, value);
        };
      }
      tx.oncomplete = () => resolve({ loaded, seenLs });
      tx.onabort = () => reject(tx.error);
    });
  }
  function sheetAdopt(db, { loaded, seenLs }, late) {
    loaded.forEach((v, k) => { sheets.set(k, v); committed.set(k, v); });
    sheetDb = db;
    sheetsOn = true;
    sheetPending = false;
    for (const key of SHEET_KEYS) {
      const now = localStorage.getItem(key);
      if (now == null) continue;
      if (now !== seenLs.get(key)) {
        const merged = mergeSheet(key, now, sheets.get(key));
        if (merged == null) continue;
        sheets.set(key, merged);
        dirty.add(key);
      }
      try { localStorage.removeItem(key); } catch (_) {}
    }
    sheetFlush();
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (_) {}
    // Another tab's save joins this copy, then the storage event every page already listens to.
    // Merged by id, not replaced: two tabs saving at once each send a list missing the other's
    // row, and replacing lost one of them for good (a payment, a sale). The tab holding rows the
    // message lacked saves and sends the union back, so both end on it. The lists only grow.
    const told = (key, value) => window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
    const count = (s) => { try { return JSON.parse(s).length || 0; } catch (_) { return 0; } };
    try {
      sheetChannel = new BroadcastChannel(SHEET_DB);
      sheetChannel.onmessage = ({ data }) => {
        if (!data || !SHEET_KEYS.includes(data.key)) return;
        const { key, value } = data;
        if (value == null) { sheets.delete(key); return told(key, null); }
        if (data.reset) { sheets.set(key, value); return told(key, value); }   // a restore: replace, never merge
        const merged = mergeSheet(key, value, sheets.get(key));
        if (merged == null) return;
        if (count(merged) > count(value)) { sheets.set(key, merged); sheetWrite(key); }
        else sheets.set(key, value);
        told(key, sheets.get(key));
      };
    } catch (_) {}
    seedOpening();
    // Opened after the till had already started on localStorage: the screens re-read.
    if (late) SHEET_KEYS.forEach((k) => told(k, sheets.has(k) ? sheets.get(k) : null));
  }
  // Opening rows, once per device, once the log is readable (the stock rule: bo-model stockOnHand).
  function seedOpening() {
    if (sheetPending || typeof openingRows !== 'function' || safeGetItem(KEYS.stockAnchored)) return;
    try {
      const moves = readKey(KEYS.stockMovements, []) || [];
      const rows = openingRows(readArrayWithSeed(KEYS.products, 'products'), moves).map(stamp);
      if (!rows.length || writeKey(KEYS.stockMovements, rows.concat(moves))) safeSetItem(KEYS.stockAnchored, new Date().toISOString());
    } catch (e) { try { console.warn('[HWPOS] opening stock rows not written:', e); } catch (_) {} }
  }
  function ready() {
    if (sheetReady) return sheetReady;
    // The /demo build swaps localStorage for memory; its data must never reach the real database.
    if (typeof indexedDB === 'undefined' || window.HWPOS_MEMORY_ONLY) { seedOpening(); return (sheetReady = Promise.resolve()); }
    // The till waits at most 5 s (Safari has hung on a first open after launch). Past that it
    // starts on localStorage, and the database is adopted whenever it does open: its rows plus
    // whatever was rung meanwhile, merged by id.
    let late = false;
    sheetPending = true;
    const opened = sheetOpen()
      .then((db) => sheetLoad(db).then((r) => sheetAdopt(db, r, late)))
      .catch((e) => { sheetPending = false; try { console.warn('[HWPOS] IndexedDB unavailable, sales stay in localStorage:', e); } catch (_) {} seedOpening(); });
    sheetReady = Promise.race([opened, new Promise((r) => setTimeout(r, 5000))]).then(() => { late = true; });
    return sheetReady;
  }

  function safeGetItem(key, fallback = null) {
    try {
      const value = kv.getItem(key);
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }
  function safeSetItem(key, value) {
    try {
      kv.setItem(key, value);
      return true;
    } catch (_) { return false; }
  }
  function readKey(key, fallback) {
    try {
      const raw = safeGetItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeKey(key, value) {
    return safeSetItem(key, JSON.stringify(value));
  }

  function makeCollection(storageKey, evtName) {
    return {
      list: async () => readKey(storageKey, []),
      get: async (id) => (readKey(storageKey, []) || []).find(x => x.id === id) || null,
      put: async (id, patch) => {
        const list = readKey(storageKey, []) || [];
        const i = list.findIndex(x => x.id === id);
        if (i >= 0) list[i] = { ...list[i], ...patch };
        else list.push({ id, ...patch });
        writeKey(storageKey, list);
        emit(evtName, list);
        return list[i >= 0 ? i : list.length - 1];
      },
      add: async (item) => {
        const list = readKey(storageKey, []) || [];
        list.unshift(item);
        writeKey(storageKey, list);
        emit(evtName, list);
        return item;
      },
      remove: async (id) => {
        const list = (readKey(storageKey, []) || []).filter(x => x.id !== id);
        writeKey(storageKey, list);
        emit(evtName, list);
      },
      replaceAll: async (list) => {
        writeKey(storageKey, list);
        emit(evtName, list);
      },
    };
  }

  // ---- Till event stream (docs/data-dictionary.md, "Till event stream") ----
  // append() is sync and never throws; rows buffer in memory and land in IndexedDB in one
  // transaction per flush. If IDB is missing/blocked/full, rows go to a capped localStorage key
  // and move into IDB on the next flush that succeeds.
  const EVT_DB = 'hwpos-events';
  const EVT_STORE = 'tillEvents';
  const EVT_FALLBACK_CAP = 2000;
  // The fallback shares the till's ~5MB origin with orders, so it is capped in chars too (~1.2MB UTF-16).
  const EVT_FALLBACK_CHARS = 600000;
  const EVT_DATA_CHARS = 8000;   // a bigger `data` is stored as { truncated: <chars> }
  const EVT_PAGE = 5000;         // rows per readonly transaction when listing
  const evtUuid = () => {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  };
  const evtSessionId = evtUuid();
  const evtContext = {};   // app.js: HWPOS_STORE.events.setContext({ cartId, cashier, terminal })
  let evtBuffer = [];
  let evtTimer = null;
  let evtChain = Promise.resolve();
  let evtDb = null;
  let evtWarned = false;
  let evtAppVersion = '';
  let evtDroppedPending = 0;   // drops the dropped key itself could not record (origin full)
  let evtStashQueued = false;
  let evtPersistAsked = false;

  function evtWarn(e) {
    if (evtWarned) return;
    evtWarned = true;
    try { console.warn('[HWPOS events] IndexedDB unavailable, using localStorage fallback:', e); } catch (_) {}
  }
  function evtVersion() {
    if (evtAppVersion) return evtAppVersion;
    try {   // data-store.js loads before app.js, so this is read lazily on first append
      const s = document.querySelector('script[src*="app.js"], script[src*="backoffice.js"]');
      const src = s && s.getAttribute('src');
      if (src) evtAppVersion = src.split('/').pop();
    } catch (_) {}
    return evtAppVersion;
  }
  function evtOpen() {
    if (!evtDb) evtDb = Promise.race([
      new Promise((resolve, reject) => {
        const req = indexedDB.open(EVT_DB, 1);
        req.onupgradeneeded = () => {
          const os = req.result.createObjectStore(EVT_STORE, { keyPath: 'id' });
          ['ts', 'type', 'synced'].forEach((name) => os.createIndex(name, name));
        };
        req.onsuccess = () => {
          const db = req.result;
          // A later build upgrading the DB in another tab must not stay blocked by this one.
          db.onversionchange = () => { try { db.close(); } catch (_) {} evtDb = null; };
          // Ask once, best-effort: a persisted origin survives storage pressure eviction.
          if (!evtPersistAsked) {
            evtPersistAsked = true;
            try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (_) {}
          }
          resolve(db);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('IndexedDB open timeout')), 5000)),
    ]).catch((e) => { evtDb = null; throw e; });
    return evtDb;
  }
  function evtTx(mode, fn) {
    return evtOpen().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(EVT_STORE, mode);
      let result;
      const fail = (e) => { clearTimeout(timer); try { t.abort(); } catch (_) {} reject(e); };
      // A transaction that never completes nor errors would stall every later flush and read.
      const timer = setTimeout(() => { evtDb = null; fail(new Error('IndexedDB transaction timeout')); }, mode === 'readwrite' ? 15000 : 5000);
      t.oncomplete = () => { clearTimeout(timer); resolve(result); };
      t.onerror = t.onabort = () => { clearTimeout(timer); reject(t.error || new Error('IndexedDB transaction aborted')); };
      try { fn(t.objectStore(EVT_STORE), (r) => { result = r; }); } catch (e) { fail(e); }
    }));
  }
  // A corrupt or hand-edited key must not poison later flushes: put() of a row without an id throws.
  const evtFallbackRows = () => {
    const rows = readKey(KEYS.tillEventsFallback, []);
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r.id === 'string' && r.id && typeof r.ts === 'string') : [];
  };
  const evtDropped = () => toNumber(safeGetItem(KEYS.tillEventsDropped, 0), 0) + evtDroppedPending;
  function evtAddDropped(n) {
    if (!n) return;
    if (safeSetItem(KEYS.tillEventsDropped, String(evtDropped() + n))) evtDroppedPending = 0;
    else evtDroppedPending += n;
  }
  // Oldest rows go first, past 2000 rows or EVT_FALLBACK_CHARS; if the origin is still full, halve.
  // lossless (the pagehide stash): write everything or nothing and report which.
  function evtFallbackWrite(rows, lossless) {
    const parts = [];
    let lost = 0;
    for (const row of evtFallbackRows().concat(rows)) { try { parts.push(JSON.stringify(row)); } catch (_) { lost++; } }
    let chars = parts.reduce((n, s) => n + s.length + 1, 1);
    let start = 0;
    while (start < parts.length && (parts.length - start > EVT_FALLBACK_CAP || chars > EVT_FALLBACK_CHARS)) chars -= parts[start++].length + 1;
    if (lossless && (lost || start)) return false;
    for (;;) {
      const kept = parts.slice(start);
      if (!kept.length) { try { localStorage.removeItem(KEYS.tillEventsFallback); } catch (_) {} break; }
      if (safeSetItem(KEYS.tillEventsFallback, '[' + kept.join(',') + ']')) break;
      if (lossless) return false;
      start += Math.ceil(kept.length / 2);
    }
    evtAddDropped(lost + start);
    return true;
  }
  // Sync: an IndexedDB write started on pagehide never commits once the page is gone; localStorage does.
  function evtStash() {
    if (evtBuffer.length && evtFallbackWrite(evtBuffer, true)) evtBuffer = [];
  }
  function evtFallbackForget(ids) {   // only the rows this flush moved: a stash may have landed meanwhile
    const left = evtFallbackRows().filter((r) => !ids.has(r.id));
    if (left.length) writeKey(KEYS.tillEventsFallback, left);
    else { try { localStorage.removeItem(KEYS.tillEventsFallback); } catch (_) {} }
  }
  async function evtFlushNow() {
    if (evtTimer) { try { clearTimeout(evtTimer); } catch (_) {} evtTimer = null; }
    const hadFallback = safeGetItem(KEYS.tillEventsFallback) != null;
    if (!evtBuffer.length && !hadFallback) return;
    const rows = evtBuffer;
    evtBuffer = [];
    const fallback = hadFallback ? evtFallbackRows() : [];
    const batch = fallback.concat(rows);
    try {
      if (batch.length) await evtTx('readwrite', (os) => { batch.forEach((row) => os.put(row)); });
      if (hadFallback) evtFallbackForget(new Set(fallback.map((r) => r.id)));
    } catch (e) {
      evtWarn(e);
      if (rows.length) evtFallbackWrite(rows);
    }
  }
  function flushEvents() {
    evtChain = evtChain.then(evtFlushNow).catch(evtWarn);
    return evtChain;
  }
  const evtCtxStr = (v) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
  function appendEvent(type, fields) {
    try {
      let data = {};
      try {
        if (fields && typeof fields === 'object') {
          // One JSON round trip: the row is plain data that IDB and localStorage can always store.
          const raw = JSON.stringify(fields);
          const parsed = !raw ? null : raw.length > EVT_DATA_CHARS ? { truncated: raw.length } : JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
        }
      } catch (_) {}
      let store = {};
      try { store = readSettingsForApi().store || {}; } catch (_) {}
      const pickCtx = (k, fallback) => evtCtxStr(evtContext[k] != null ? evtContext[k] : fallback);
      evtBuffer.push({
        id: evtUuid(),
        ts: new Date().toISOString(),
        type: typeof type === 'string' && type ? type.slice(0, 64) : 'unknown',
        sessionId: evtSessionId,
        terminal: pickCtx('terminal', store.registerNo),
        cashier: pickCtx('cashier', store.cashier),
        cartId: pickCtx('cartId', ''),
        online: typeof navigator === 'undefined' || navigator.onLine !== false,
        appVersion: pickCtx('appVersion', evtVersion()),
        synced: 0,
        storeId: pickCtx('storeId', ''),
        data,
      });
      let hidden = false;
      try { hidden = document.visibilityState === 'hidden'; } catch (_) {}
      if (hidden) {   // app_hidden etc.: stash once this task ends, then flush; no timer may ever fire
        if (!evtStashQueued) { evtStashQueued = true; Promise.resolve().then(() => { evtStashQueued = false; evtStash(); flushEvents(); }); }
      } else if (!evtTimer) evtTimer = setTimeout(flushEvents, 2000);
    } catch (e) { evtWarn(e); evtAddDropped(1); }
  }
  // Read side merges IDB with any fallback rows, after flushing, so nothing appended is invisible.
  async function listEvents(opts = {}) {
    await flushEvents();
    const since = opts.since != null ? String(opts.since) : null;
    const synced = opts.synced != null ? Number(opts.synced) : null;
    const limit = opts.limit > 0 ? Math.floor(opts.limit) : 0;
    const keep = (r) => (since == null || r.ts >= since) && (!opts.type || r.type === opts.type) && (synced == null || r.synced === synced);
    const byId = new Map();
    const read = (index, query, count) => evtTx('readonly', (os, done) => {
      const req = os.index(index).getAll(query, count);
      req.onsuccess = () => done(req.result || []);
    });
    try {
      if (synced != null) {
        // ponytail: the upload backlog is read in one go; with only `limit`, it is `limit` backlog rows, not the oldest.
        (await read('synced', synced, since == null && !opts.type && limit ? limit : undefined)).forEach((r) => byId.set(r.id, r));
      } else {
        // Keyset pages on the ts index, one short transaction each: a 1M-row export holds no long transaction.
        // ponytail: `type` still walks every row; add a [type, ts] index if type reads get slow.
        let from = since, size = EVT_PAGE;
        for (;;) {
          const rows = await read('ts', from == null ? undefined : IDBKeyRange.lowerBound(from), size);
          for (const r of rows) if (keep(r)) byId.set(r.id, r);
          if (rows.length < size || (limit && byId.size >= limit)) break;
          const last = rows[rows.length - 1].ts;
          if (last === from) size *= 2;   // a whole page on one timestamp: widen instead of looping
          else from = last;               // inclusive: rows sharing `last` are re-read, byId dedupes
        }
      }
    } catch (e) { evtWarn(e); }
    for (const row of evtFallbackRows()) byId.set(row.id, row);
    const out = [...byId.values()].filter(keep).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return limit ? out.slice(0, limit) : out;
  }
  async function countEvents() {
    await flushEvents();
    let n = 0;
    try { n = await evtTx('readonly', (os, done) => { const req = os.count(); req.onsuccess = () => done(req.result); }); }
    catch (e) { evtWarn(e); }
    return (n || 0) + evtFallbackRows().length;
  }
  // Resolves true only when every id is marked where it lives. Runs on the flush chain, so a flush
  // migrating an unsynced fallback copy cannot land on top of the mark.
  // Rejects (rather than resolving false) on a transaction or write failure, so a caller's sync
  // loop retries the mark instead of believing it landed.
  function markEventsSynced(ids) {
    const set = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'));
    if (!set.size) return Promise.resolve(true);
    const p = evtChain.then(evtFlushNow).then(async () => {
      await evtTx('readwrite', (os) => set.forEach((id) => {
        const req = os.get(id);
        req.onsuccess = () => { if (req.result) { req.result.synced = 1; os.put(req.result); } };
      }));
      const fb = evtFallbackRows();
      const inFb = fb.filter((r) => set.has(r.id)).length;
      if (inFb && !writeKey(KEYS.tillEventsFallback, fb.map((r) => (set.has(r.id) ? { ...r, synced: 1 } : r)))) {
        throw new Error('fallback mark write failed');
      }
      return true;
    });
    evtChain = p.catch((e) => { evtWarn(e); });   // keep the flush chain alive even if this mark failed
    return p;
  }
  const tillEvents = {
    append: appendEvent,
    flush: flushEvents,
    count: countEvents,
    list: listEvents,
    // ponytail: paged reads, but one array in memory; window it (since) if exports outgrow a tablet.
    exportAll: () => listEvents(),
    markSynced: markEventsSynced,
    setContext: (patch) => { try { Object.assign(evtContext, patch); } catch (_) {} },
    dropped: evtDropped,
  };
  try {
    const evtHide = () => { evtStash(); flushEvents(); };
    window.addEventListener('pagehide', evtHide);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') evtHide(); });
  } catch (_) {}

  const localStore = {
    products:  makeCollection(KEYS.products,  'products:changed'),
    folders:   makeCollection(KEYS.folders,   'folders:changed'),
    groups:    makeCollection(KEYS.groups,    'groups:changed'),
    orders:    makeCollection(KEYS.orders,    'orders:changed'),
    customers: makeCollection(KEYS.customers, 'customers:changed'),
    customerLedger: makeCollection(KEYS.customerLedger, 'customerLedger:changed'),
    savedCarts: makeCollection(KEYS.savedCarts, 'savedCarts:changed'),
    shifts:    makeCollection(KEYS.shifts,    'shifts:changed'),
    settings: {
      get: async () => readKey(KEYS.settings, {}),
      set: async (patch) => {
        const cur = readKey(KEYS.settings, {}) || {};
        const next = { ...cur, ...patch };
        writeKey(KEYS.settings, next);
        emit('settings:changed', next);
        return next;
      },
    },
    role: {
      get: async () => safeGetItem(KEYS.role, 'manager') || 'manager',
      set: async (role) => {
        safeSetItem(KEYS.role, role);
        emit('role:changed', role);
      },
    },
    // Per-device UI prefs (sidebar width). Never synced, so sync on purpose: read before first paint.
    ui: {
      get: (key, fallback = null) => safeGetItem(`hwpos.ui.${key}`, fallback),
      set: (key, value) => safeSetItem(`hwpos.ui.${key}`, String(value)),
    },
    events: { on, emit, ...tillEvents },
    kv,
    ready,
    pending: () => sheetPending,
    // The movement log can be summed into stock: readable, and anchored by seedOpening on this device.
    stockReady: () => !sheetPending && !!safeGetItem(KEYS.stockAnchored),
    stamp,
    readSettings,
    defaults: () => clone(DEFAULT_SETTINGS),
    health: async () => ({ ok: true, adapter: sheetsOn ? 'indexedDB' : 'localStorage', online: navigator.onLine }),
  };

  // Bridge native storage events → in-page event bus.
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    const map = {
      [KEYS.products]:  'products:changed',
      [KEYS.folders]:   'folders:changed',
      [KEYS.groups]:    'groups:changed',
      [KEYS.orders]:    'orders:changed',
      [KEYS.customers]: 'customers:changed',
      [KEYS.customerLedger]: 'customerLedger:changed',
      [KEYS.settings]:  'settings:changed',
      [KEYS.role]:      'role:changed',
    };
    const evt = map[e.key];
    if (evt) {
      try { emit(evt, e.newValue ? JSON.parse(e.newValue) : null); }
      catch (_) { emit(evt, null); }
    }
  });

  // ---- Remote-store placeholder (future) ----
  // Drop-in replacement signature for swapping in Supabase / Firestore /
  // a custom REST backend. Implement the same `products / folders / orders
  // / customers / settings / role / events / health` surface.
  //
  //   const remoteStore = createRemoteStore({ url, apiKey });
  //   window.HWPOS_STORE = remoteStore;
  //
  // Example skeleton:
  // function createRemoteStore(cfg) {
  //   const base = cfg.url.replace(/\/$/, '');
  //   async function req(path, init) {
  //     const r = await fetch(`${base}${path}`, {
  //       ...init,
  //       headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...(init?.headers||{}) },
  //     });
  //     if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  //     return r.status === 204 ? null : r.json();
  //   }
  //   const collection = (path, evt) => ({
  //     list: () => req(`/${path}`),
  //     get: (id) => req(`/${path}/${encodeURIComponent(id)}`),
  //     add: (item) => req(`/${path}`, { method: 'POST', body: JSON.stringify(item) }),
  //     put: (id, patch) => req(`/${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  //     remove: (id) => req(`/${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  //     replaceAll: (list) => req(`/${path}`, { method: 'PUT', body: JSON.stringify(list) }),
  //   });
  //   return {
  //     products: collection('products', 'products:changed'),
  //     folders:  collection('folders',  'folders:changed'),
  //     orders:   collection('orders',   'orders:changed'),
  //     customers:collection('customers','customers:changed'),
  //     groups:   collection('groups',   'groups:changed'),
  //     settings: {
  //       get: () => req('/settings'),
  //       set: (patch) => req('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  //     },
  //     role: { get: () => req('/me/role'), set: (r) => req('/me/role', { method: 'PUT', body: JSON.stringify({ role: r }) }) },
  //     events: { on, emit },
  //     health: () => req('/health'),
  //   };
  // }

  // ---- Read-only AI/data API ----
  const DICTIONARY_URL = 'docs/data-dictionary.md';
  // Array collections read straight from storage.
  const LIST_COLLECTIONS = ['stockMovements', 'purchaseOrders', 'suppliers', 'modifiers', 'staff', 'adjustments',
    'priceLog', 'lostDemand', 'deliveryEvents', 'supplierMessages', 'decisions', 'shifts'];
  const COLLECTIONS = ['products', 'folders', 'groups', 'orders', 'customers', 'customerLedger',
    'settings', ...LIST_COLLECTIONS];
  const pick = (snapshot) => Object.fromEntries(COLLECTIONS.map((name) => [name, snapshot[name]]));
  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }
  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function seedArray(name) {
    try {
      if (name === 'products' && typeof PRODUCTS !== 'undefined') return PRODUCTS;
      if (name === 'folders' && typeof SEED_FOLDERS !== 'undefined') return SEED_FOLDERS;
      if (name === 'groups' && typeof SEED_GROUPS !== 'undefined') return SEED_GROUPS;
      if (name === 'customers' && typeof CUSTOMERS !== 'undefined') return CUSTOMERS;
      if (name === 'staff' && typeof SEED_STAFF !== 'undefined') return SEED_STAFF;
    } catch (_) {}
    return [];
  }
  function readArrayWithSeed(key, seedName) {
    const stored = readKey(key, null);
    return Array.isArray(stored) ? stored : clone(seedArray(seedName));
  }
  // THE settings: the stored object over these defaults, one level deep. The till, the back office
  // and the AI export all read this one copy (HWPOS_STORE.readSettings / .defaults); before 2026-10-03
  // each page kept its own, and they disagreed on the receipt width (the till's 80mm is kept).
  // store.id is the store_id every record carries (stamp); '' until the hosted store assigns one.
  const DEFAULT_SETTINGS = {
    vatRate: 0.12,           // PH standard VAT, inclusive
    vatInclusive: true,
    // 2 = 2026-10-03: 'walkin' is the counter sale (SalesMath.ORDER_VERSION). Every save writes this whole
    // object, so a store that saves after today is v2 and its 'pickup' really means Pickup (readSettings).
    schemaVersion: 2,
    defaultFulfilment: 'walkin', // a FULFIL_BUILTINS key (bo-model): walkin | pickup | delivery
    // Which fulfilment pills the checkout shows. { hidden: [builtin key], custom: [name] }
    fulfilment: { hidden: [], custom: [] },
    store: {
      id: '',
      name: 'EJ Hardware',
      address: 'Main Store, Laguna',
      phone: '0917-000-0000',
      tin: '000-000-000-000',
      registerNo: '1',
      cashier: 'El John',
      currency: 'PHP (₱)',
    },
    sync: {
      backendUrl: '',
      interval: 'Every 30 seconds',
      allowOfflineSales: true,
    },
    printing: {
      width: '80mm',
      printOnSale: true,
      logoOnReceipt: false,
      driver: 'browser',   // browser (pop-up) | network (Epson ePOS over Wi-Fi) | bluetooth (ESC/POS over BLE)
      netUrl: '',          // printer IP, e.g. 192.168.1.50
      btName: '',          // remembered Bluetooth printer
      btId: '',
      cut: true,
      mapOnReceipt: true,
    },
    churnThresholdDays: 30,
  };
  function readSettings(saved = readKey(KEYS.settings, {}) || {}) {
    const base = clone(DEFAULT_SETTINGS), out = { ...base, ...saved };
    for (const k of ['fulfilment', 'store', 'sync', 'printing']) out[k] = { ...base[k], ...(saved[k] || {}) };
    // Settings from before v2: their 'pickup' default was the counter sale, and the Pickup pill they had was
    // that counter sale too -- the new Pickup (bought ahead) starts hidden until the owner turns it on.
    if (!(Number(saved.schemaVersion) >= 2) && Object.keys(saved).length) {
      if (out.defaultFulfilment === 'pickup') out.defaultFulfilment = 'walkin';
      out.fulfilment.hidden = [...new Set([...(out.fulfilment.hidden || []), 'pickup'])];
    }
    return out;
  }
  const readSettingsForApi = () => readSettings();
  // THE record stamp (CLAUDE.md: every record carries a UUID, updated_at and store_id): this store's
  // id and the time it was written. Mutates and returns the row; a row that already names a store keeps it.
  function stamp(row) {
    if (!row) return row;
    if (!row.storeId) row.storeId = readSettings().store.id || '';
    row.updatedAt = new Date().toISOString();
    return row;
  }
  // bo-model's list, with the balance worked out from the ledger (features/customers). A page
  // without bo-model (a lab) has no customers.
  const allCustomersForApi = () => (typeof allCustomerRecords === 'function' ? allCustomerRecords().map(clone) : []);
  // The metrics are the screens' own formulas (SalesMath, bo-model) under the screens' words:
  // netSales, orders, averageSale, unitsSold (features/sales-terms.md). 'all' | 'today' | '7d' | '30d'.
  const RANGE_DAYS = { today: 1, '7d': 7, '30d': 30 };
  function buildMetrics(snapshot, options = {}) {
    const range = options.range || 'all';
    const SM = window.SalesMath;
    const win = range === 'all' ? {} : SM.rangeWindow(RANGE_DAYS[range] || 1, Date.now(), SM.storeZone(snapshot.settings));
    const inWin = (order) => { const t = SM.tsOf(order); return !(t < win.from || t >= win.to); };
    const rev = SM.reversals(snapshot.orders);
    const productTotals = new Map();
    const keyOf = (order, item) => {
      const key = SM.itemKey(item);
      if (!productTotals.has(key)) productTotals.set(key, { id: item.productId || item.id, sku: item.sku, name: item.name });
      return key;
    };
    const ladder = SM.summarize(snapshot.orders, { ...win, by: keyOf });
    const paymentTotals = {};
    for (const [method, amount] of SM.tenders(snapshot.orders, win)) if (method !== 'unpaid') paymentTotals[method] = amount;
    const saved = snapshot.orders.filter(order => order.status === 'saved' && inWin(order));
    // Stock value, retail value and the stock counts are bo-model's (the Items and dashboard tiles).
    const live = snapshot.products.filter(product => !product.archived);
    const zone = SM.storeZone(snapshot.settings);
    const clock = saleClock(snapshot.stockMovements, zone, snapshot.orders);
    const counts = stockCounts(live, clock, Date.now(), zone);
    // One row per item (a family once), the same out/low as the counts above (bo-model familyRows).
    // id is the group's for a variant family; productIds names its products, sku is a family of one's.
    const outOrLow = familyRows(live, snapshot.groups, clock, Date.now(), zone);
    // bo-model creditPool: what the Customers strip shows. Money held for a customer is not credit out.
    const pool = creditPool(snapshot.customers);
    return {
      range,
      generatedAt: new Date().toISOString(),
      sales: {
        netSales: ladder.netSales,
        orders: ladder.orders,
        savedReceipts: saved.length,
        averageSale: ladder.averageSale,
        unitsSold: ladder.unitsSold,
        itemsSold: SM.itemsSold(ladder.groups),
        discounts: ladder.discounts,
        deliveryCount: snapshot.orders.filter(order => inWin(order) && order.fulfilment === 'delivery' && SM.rowState(order, rev) === 'sale').length,
        paymentTotals,
        topProducts: Array.from(ladder.groups, ([key, g]) => ({ ...productTotals.get(key), unitsSold: g.unitsSold, netSales: g.netSales }))
          .filter(p => p.unitsSold > 0)   // an item fully refunded sold nothing
          .sort((a, b) => b.unitsSold - a.unitsSold || b.netSales - a.netSales)
          .slice(0, 10),
      },
      inventory: {
        totalProducts: live.length,
        // One per item (a family counts once), as the stock tiles count. Out or low = needs buying.
        outOfStockCount: counts.out,
        lowStockCount: counts.low,
        stockValue: stockValueOf(live),
        retailValue: stockValueOf(live.map(product => ({ ...product, cost: product.price }))),
        outOrLow,
      },
      customers: {
        totalCustomers: snapshot.customers.length,
        activeCreditAccounts: pool.active,
        outstandingBalance: pool.owed,
        creditLimitTotal: pool.limit,
        topBalances: snapshot.customers
          .filter(customer => toNumber(customer.currentBalance) > 0)
          .map(customer => ({
            id: customer.id,
            name: customer.name,
            currentBalance: SM.round2(toNumber(customer.currentBalance)),
            creditLimit: SM.round2(toNumber(customer.creditLimit)),
          }))
          .sort((a, b) => b.currentBalance - a.currentBalance)
          .slice(0, 10),
      },
    };
  }
  function getAiSnapshot(options = {}) {
    const products = readArrayWithSeed(KEYS.products, 'products').map(product => clone(product));
    const folders = readArrayWithSeed(KEYS.folders, 'folders').map(folder => clone(folder));
    const groups = readArrayWithSeed(KEYS.groups, 'groups').map(group => clone(group));
    const settings = readSettingsForApi();
    const SM = window.SalesMath;
    const orders = SM.upgradeOrders((readKey(KEYS.orders, []) || []).map((r) => SM.readOrder(r, { rate: SM.taxOpts(settings).rate })).filter(Boolean), SM.storeZone(settings));
    const customers = allCustomersForApi();
    const customerLedger = readKey(KEYS.customerLedger, []) || [];
    const snapshot = {
      apiVersion: 1,
      generatedAt: new Date().toISOString(),
      source: sheetsOn ? 'indexedDB+localStorage' : 'localStorage',
      dictionaryUrl: DICTIONARY_URL,
      schema: {},
      products,
      folders,
      groups,
      orders,
      customers,
      customerLedger,
      settings,
    };
    // Back-office collections and event logs: raw rows, exactly as stored.
    for (const name of LIST_COLLECTIONS) {
      const rows = readKey(KEYS[name], null);
      snapshot[name] = Array.isArray(rows) ? rows : (name === 'staff' ? clone(seedArray('staff')) : []);
    }
    // A PIN is a credential, not a data point.
    snapshot.staff = snapshot.staff.map(({ pin, ...u }) => u);
    // On hand from the log (bo-model withStock), never the saved snapshot. Without bo-model: as saved.
    if (typeof withStock === 'function') withStock(snapshot.products, snapshot.stockMovements);
    COLLECTIONS.forEach((name) => { snapshot.schema[name] = KEYS[name]; });
    if (options.includeMetrics !== false) snapshot.metrics = buildMetrics(snapshot, { range: options.range || 'all' });
    if (options.includeInsights !== false) {
      try {
        const insights = window.HWPOS_INSIGHTS;
        if (insights && typeof insights.buildInsights === 'function') {
          const data = insights.dataFromDump(pick(snapshot));
          snapshot.insights = insights.buildInsights(data, { now: options.now || Date.now() });
        }
      } catch (e) {
        snapshot.insights = { error: String((e && e.message) || e) };   // never takes the snapshot down
      }
    }
    return snapshot;
  }
  const aiApi = {
    version: 1,
    snapshot: getAiSnapshot,
    metrics: (options = {}) => buildMetrics(getAiSnapshot({ includeMetrics: false, includeInsights: false }), options),
    collections: () => pick(getAiSnapshot({ includeMetrics: false, includeInsights: false })),
    schema: () => clone(KEYS),
    dictionaryUrl: DICTIONARY_URL,
    // Till event stream is async (IndexedDB), so it is not in snapshot(); read it here.
    tillEvents: (opts) => listEvents(opts),
    health: () => ({
      ok: true,
      adapter: sheetsOn ? 'indexedDB+localStorage' : 'localStorage',
      readableCollections: COLLECTIONS.slice(),
      tillEvents: { indexedDB: `${EVT_DB}/${EVT_STORE}`, read: 'HWPOS_AI.tillEvents({since, type, limit}) -> Promise<rows>',
        fallbackKey: KEYS.tillEventsFallback, fallbackRows: evtFallbackRows().length, droppedRows: evtDropped() },
      dictionaryUrl: DICTIONARY_URL,
      generatedAt: new Date().toISOString(),
    }),
  };

  // Expose globally. App.js can keep using its own localStorage helpers
  // (this is additive — the store is here for new code + future migration).
  window.HWPOS_STORE = localStore;
  window.HWPOS_STORAGE_KEYS = KEYS;
  window.HWPOS_AI = aiApi;
})();
