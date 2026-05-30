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
    };
    const saved = readKey(KEYS.settings, {}) || {};
    return {
      ...fallback,
      ...saved,
      store: { ...fallback.store, ...(saved.store || {}) },
      sync: { ...fallback.sync, ...(saved.sync || {}) },
      printing: { ...fallback.printing, ...(saved.printing || {}) },
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
      schema: {
        products: KEYS.products,
        folders: KEYS.folders,
        groups: KEYS.groups,
        orders: KEYS.orders,
        customers: KEYS.customers,
        customerLedger: KEYS.customerLedger,
        drawerCloseouts: KEYS.drawerCloseouts,
        settings: KEYS.settings,
      },
      products,
      folders,
      groups,
      orders,
      customers,
      customerLedger,
      drawerCloseouts,
      settings,
    };
    if (options.includeMetrics !== false) snapshot.metrics = buildMetrics(snapshot, { range: options.range || 'all' });
    return snapshot;
  }
  const aiApi = {
    version: 1,
    snapshot: getAiSnapshot,
    metrics: (options = {}) => buildMetrics(getAiSnapshot({ includeMetrics: false }), options),
    collections: () => {
      const snapshot = getAiSnapshot({ includeMetrics: false });
      return {
        products: snapshot.products,
        folders: snapshot.folders,
        groups: snapshot.groups,
        orders: snapshot.orders,
        customers: snapshot.customers,
        customerLedger: snapshot.customerLedger,
        drawerCloseouts: snapshot.drawerCloseouts,
        settings: snapshot.settings,
      };
    },
    schema: () => clone(KEYS),
    health: () => ({
      ok: true,
      adapter: 'localStorage',
      readableCollections: ['products', 'folders', 'groups', 'orders', 'customers', 'customerLedger', 'drawerCloseouts', 'settings'],
      generatedAt: new Date().toISOString(),
    }),
  };

  // Expose globally. App.js can keep using its own localStorage helpers
  // (this is additive — the store is here for new code + future migration).
  window.HWPOS_STORE = localStore;
  window.HWPOS_STORAGE_KEYS = KEYS;
  window.HWPOS_AI = aiApi;
})();
