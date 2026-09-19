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
    drawerCloseouts: 'hwpos.drawerCloseouts.v1',
    settings:  'hwpos.settings.v1',
    role:      'hwpos.role.v1',
    // Back office (bo-model.js / backoffice.js own the writes). Field meanings: docs/data-dictionary.md.
    stockMovements: 'hwpos.stockMovements.v1',
    purchaseOrders: 'hwpos.purchaseOrders.v1',
    suppliers: 'hwpos.suppliers.v1',
    staff:     'hwpos.staff.v1',
    attendance: 'hwpos.attendance.v1',
    advances:  'hwpos.advances.v1',
    adjustments: 'hwpos.adjustments.v1',
    days:      'hwpos.days.v1',
    // Event logs, append-only (bo-model.js EVENT_LOGS).
    priceLog:  'hwpos.priceLog.v1',
    lostDemand: 'hwpos.lostDemand.v1',
    deliveryEvents: 'hwpos.deliveryEvents.v1',
    clock:     'hwpos.clock.v1',
    supplierMessages: 'hwpos.supplierMessages.v1',
    decisions: 'hwpos.decisions.v1',
    // Till event stream lives in IndexedDB 'hwpos-events'; these two only catch it when IDB can't.
    tillEventsFallback: 'hwpos.tillEvents.fallback.v1',
    tillEventsDropped: 'hwpos.tillEvents.dropped.v1',
  };
  function safeGetItem(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }
  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
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
    drawerCloseouts: makeCollection(KEYS.drawerCloseouts, 'drawerCloseouts:changed'),
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
    health: async () => ({ ok: true, adapter: 'localStorage', online: navigator.onLine }),
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
      [KEYS.drawerCloseouts]: 'drawerCloseouts:changed',
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
  // Array collections read straight from storage. attendance is the one object blob.
  const LIST_COLLECTIONS = ['stockMovements', 'purchaseOrders', 'suppliers', 'staff', 'advances', 'adjustments', 'days',
    'priceLog', 'lostDemand', 'deliveryEvents', 'clock', 'supplierMessages', 'decisions'];
  const COLLECTIONS = ['products', 'folders', 'groups', 'orders', 'customers', 'customerLedger', 'drawerCloseouts',
    'settings', 'attendance', ...LIST_COLLECTIONS];
  const pick = (snapshot) => Object.fromEntries(COLLECTIONS.map((name) => [name, snapshot[name]]));
  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }
  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function money(value) {
    return Math.round(toNumber(value, 0) * 100) / 100;
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
  function readSettingsForApi() {
    const fallback = {
      vatRate: 0.12,
      vatInclusive: true,
      defaultFulfilment: 'pickup',
      store: {
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
        width: '58mm',
        printOnSale: true,
        logoOnReceipt: false,
      },
      pricingTiers: {
        contractor: 0.05,
        wholesale: 0.10,
        retail: 0,
        residential: 0,
      },
      churnThresholdDays: 30,
    };
    const saved = readKey(KEYS.settings, {}) || {};
    return {
      ...fallback,
      ...saved,
      store: { ...fallback.store, ...(saved.store || {}) },
      sync: { ...fallback.sync, ...(saved.sync || {}) },
      printing: { ...fallback.printing, ...(saved.printing || {}) },
      pricingTiers: { ...fallback.pricingTiers, ...(saved.pricingTiers || {}) },
      churnThresholdDays: saved.churnThresholdDays ?? fallback.churnThresholdDays,
    };
  }
  function normalizeAiItem(item = {}) {
    const qty = Math.max(1, toNumber(item.qty, 1));
    const price = money(item.price);
    const lineGross = money(item.lineGross ?? price * qty);
    const lineDiscount = money(item.lineDiscount ?? 0);
    return {
      id: String(item.id || item.productId || ''),
      productId: String(item.productId || item.id || ''),
      sku: String(item.sku || ''),
      name: String(item.name || 'Item'),
      unit: String(item.unit || 'pc'),
      qty,
      price,
      discount: item.discount ? clone(item.discount) : null,
      lineGross,
      lineDiscount,
      lineTotal: money(item.lineTotal ?? Math.max(0, lineGross - lineDiscount)),
    };
  }
  function normalizeAiPayment(payment = {}) {
    const method = ['cash', 'credit', 'split', 'other', 'unpaid'].includes(payment.method)
      ? payment.method
      : 'other';
    return {
      method,
      label: String(payment.label || method),
      amount: money(payment.amount),
      tendered: money(payment.tendered ?? payment.amount),
      change: money(payment.change),
      ref: payment.ref ? String(payment.ref) : '',
    };
  }
  function normalizeAiOrder(raw = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const items = Array.isArray(raw.items) ? raw.items.map(normalizeAiItem) : [];
    const itemGross = money(items.reduce((sum, item) => sum + item.lineGross, 0));
    const itemDiscount = money(items.reduce((sum, item) => sum + item.lineDiscount, 0));
    const status = ['saved', 'completed', 'voided', 'refunded', 'return'].includes(raw.status)
      ? raw.status
      : 'completed';
    const paymentMethod = ['cash', 'credit', 'split', 'unpaid'].includes(raw.paymentMethod)
      ? raw.paymentMethod
      : (status === 'saved' ? 'unpaid' : 'cash');
    const total = money(raw.total ?? Math.max(0, itemGross - itemDiscount));
    const payments = Array.isArray(raw.payments) && raw.payments.length
      ? raw.payments.map(normalizeAiPayment)
      : [{
          method: status === 'saved' ? 'unpaid' : paymentMethod,
          label: status === 'saved' ? 'Not completed' : paymentMethod,
          amount: status === 'saved' ? 0 : total,
          tendered: paymentMethod === 'cash' ? total : 0,
          change: 0,
          ref: '',
        }].map(normalizeAiPayment);
    const vatRate = toNumber(raw.vatRate, readSettingsForApi().vatRate);
    const vatAmount = money(raw.vatAmount ?? (vatRate > 0 ? total * (vatRate / (1 + vatRate)) : 0));
    return {
      schemaVersion: toNumber(raw.schemaVersion, 1),
      formatKey: String(raw.formatKey || 'hwpos.order.v1'),
      id: String(raw.id || raw.number || ''),
      number: String(raw.number || raw.id || ''),
      ts: toNumber(raw.ts, Date.now()),
      status,
      cashier: String(raw.cashier || ''),
      register: String(raw.register || '1'),
      customer: raw.customer
        ? {
            id: String(raw.customer.id || ''),
            name: String(raw.customer.name || ''),
            phone: String(raw.customer.phone || ''),
            address: String(raw.customer.address || ''),
          }
        : null,
      paymentMethod,
      payments,
      items,
      subtotal: money(raw.subtotal ?? itemGross),
      discount: money(raw.discount ?? itemDiscount),
      cartDiscount: raw.cartDiscount ? clone(raw.cartDiscount) : null,
      total,
      tendered: money(raw.tendered ?? payments.find(p => p.method === 'cash')?.tendered ?? 0),
      change: money(raw.change ?? payments.find(p => p.method === 'cash')?.change ?? 0),
      vatRate,
      vatAmount,
      vatableSales: money(raw.vatableSales ?? total - vatAmount),
      fulfilment: raw.fulfilment === 'delivery' ? 'delivery' : 'pickup',
      deliveryAddress: raw.fulfilment === 'delivery' ? String(raw.deliveryAddress || '') : '',
    };
  }
  function allCustomersForApi() {
    const seen = new Set();
    const out = [];
    for (const customer of [...readArrayWithSeed(KEYS.customers, 'customers'), ...seedArray('customers')]) {
      if (!customer?.id || seen.has(customer.id)) continue;
      seen.add(customer.id);
      out.push(clone(customer));
    }
    return out;
  }
  function rangeStart(range, now = new Date()) {
    if (range === 'all') return 0;
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    if (range === '7d') d.setDate(d.getDate() - 6);
    if (range === '30d') d.setDate(d.getDate() - 29);
    return d.getTime();
  }
  function buildMetrics(snapshot, options = {}) {
    const range = options.range || 'all';
    const start = rangeStart(range);
    const completed = snapshot.orders.filter(order => (order.status || 'completed') === 'completed' && order.ts >= start);
    const saved = snapshot.orders.filter(order => order.status === 'saved' && order.ts >= start);
    const paymentTotals = {};
    const productTotals = new Map();
    let itemsSold = 0;
    let discountTotal = 0;
    let deliveryCount = 0;

    for (const order of completed) {
      itemsSold += order.items.reduce((sum, item) => sum + item.qty, 0);
      discountTotal += order.discount || 0;
      if (order.fulfilment === 'delivery') deliveryCount += 1;
      for (const payment of order.payments || []) {
        if (payment.method === 'unpaid') continue;
        paymentTotals[payment.method] = money((paymentTotals[payment.method] || 0) + payment.amount);
      }
      for (const item of order.items) {
        const key = item.productId || item.id || item.sku || item.name;
        const current = productTotals.get(key) || {
          id: item.productId || item.id,
          sku: item.sku,
          name: item.name,
          qty: 0,
          revenue: 0,
        };
        current.qty += item.qty;
        current.revenue = money(current.revenue + item.lineTotal);
        productTotals.set(key, current);
      }
    }

    const revenue = money(completed.reduce((sum, order) => sum + order.total, 0));
    const inventoryValueCost = money(snapshot.products.reduce((sum, product) => sum + toNumber(product.cost) * toNumber(product.stock), 0));
    const inventoryValueRetail = money(snapshot.products.reduce((sum, product) => sum + toNumber(product.price) * toNumber(product.stock), 0));
    const lowStock = snapshot.products
      .filter(product => toNumber(product.stock) <= toNumber(product.reorderPoint))
      .map(product => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        stock: toNumber(product.stock),
        reorderPoint: toNumber(product.reorderPoint),
      }));
    const outstanding = money(snapshot.customers.reduce((sum, customer) => sum + toNumber(customer.currentBalance), 0));
    return {
      range,
      generatedAt: new Date().toISOString(),
      sales: {
        revenue,
        completedTransactions: completed.length,
        savedReceipts: saved.length,
        averageTicket: completed.length ? money(revenue / completed.length) : 0,
        itemsSold,
        discountTotal: money(discountTotal),
        deliveryCount,
        paymentTotals,
        topProducts: Array.from(productTotals.values())
          .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
          .slice(0, 10),
      },
      inventory: {
        totalProducts: snapshot.products.length,
        lowStockCount: lowStock.length,
        outOfStockCount: snapshot.products.filter(product => toNumber(product.stock) <= 0).length,
        inventoryValueCost,
        inventoryValueRetail,
        lowStock,
      },
      customers: {
        totalCustomers: snapshot.customers.length,
        activeCreditAccounts: snapshot.customers.filter(customer => toNumber(customer.currentBalance) > 0).length,
        outstandingBalance: outstanding,
        creditLimitTotal: money(snapshot.customers.reduce((sum, customer) => sum + toNumber(customer.creditLimit), 0)),
        topBalances: snapshot.customers
          .filter(customer => toNumber(customer.currentBalance) > 0)
          .map(customer => ({
            id: customer.id,
            name: customer.name,
            currentBalance: money(customer.currentBalance),
            creditLimit: money(customer.creditLimit),
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
    const orders = (readKey(KEYS.orders, []) || []).map(normalizeAiOrder).filter(Boolean);
    const customers = allCustomersForApi();
    const customerLedger = readKey(KEYS.customerLedger, []) || [];
    const drawerCloseouts = readKey(KEYS.drawerCloseouts, []) || [];
    const settings = readSettingsForApi();
    const snapshot = {
      apiVersion: 1,
      generatedAt: new Date().toISOString(),
      source: 'localStorage',
      dictionaryUrl: DICTIONARY_URL,
      schema: {},
      products,
      folders,
      groups,
      orders,
      customers,
      customerLedger,
      drawerCloseouts,
      settings,
    };
    // Back-office collections and event logs: raw rows, exactly as stored.
    for (const name of LIST_COLLECTIONS) {
      const rows = readKey(KEYS[name], null);
      snapshot[name] = Array.isArray(rows) ? rows : (name === 'staff' ? clone(seedArray('staff')) : []);
    }
    // A PIN is a credential, not a data point.
    snapshot.staff = snapshot.staff.map(({ pin, ...u }) => u);
    snapshot.attendance = readKey(KEYS.attendance, {}) || {};
    COLLECTIONS.forEach((name) => { snapshot.schema[name] = KEYS[name]; });
    if (options.includeMetrics !== false) snapshot.metrics = buildMetrics(snapshot, { range: options.range || 'all' });
    if (options.includeInsights !== false) {
      try {
        const insights = window.HWPOS_INSIGHTS;
        if (insights && typeof insights.buildInsights === 'function') {
          // Raw orders: normalizeAiOrder drops deliveryLocation and originalOrderId, which insights read.
          const data = insights.dataFromDump({ ...pick(snapshot), orders: readKey(KEYS.orders, []) || [] });
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
      adapter: 'localStorage',
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
