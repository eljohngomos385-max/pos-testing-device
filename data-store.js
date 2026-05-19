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
    settings:  'hwpos.settings.v1',
    role:      'hwpos.role.v1',
  };
  function readKey(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }
  function writeKey(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
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

  const localStore = {
    products:  makeCollection(KEYS.products,  'products:changed'),
    folders:   makeCollection(KEYS.folders,   'folders:changed'),
    groups:    makeCollection(KEYS.groups,    'groups:changed'),
    orders:    makeCollection(KEYS.orders,    'orders:changed'),
    customers: makeCollection(KEYS.customers, 'customers:changed'),
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
      get: async () => localStorage.getItem(KEYS.role) || 'manager',
      set: async (role) => {
        try { localStorage.setItem(KEYS.role, role); } catch (_) {}
        emit('role:changed', role);
      },
    },
    events: { on, emit },
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

  // Expose globally. App.js can keep using its own localStorage helpers
  // (this is additive — the store is here for new code + future migration).
  window.HWPOS_STORE = localStore;
  window.HWPOS_STORAGE_KEYS = KEYS;
})();
