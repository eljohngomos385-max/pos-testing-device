/* ==========================================================
   Hardware POS — Back Office
   Vanilla JS dashboard. Reads same localStorage as POS app
   (hwpos.folders.v2 / hwpos.products.v2) so changes stay in sync.
   ========================================================== */

const STORAGE_FOLDERS  = 'hwpos.folders.v2';
const STORAGE_PRODUCTS = 'hwpos.products.v2';
const STORAGE_ORDERS   = 'hwpos.orders.v1';
const STORAGE_GROUPS   = 'hwpos.groups.v1';
const STORAGE_ORDER_SEQ = 'hwpos.orderSeq.v1';
const STORAGE_CUSTOMERS = 'hwpos.customers.v1';
const STORAGE_CUSTOMER_LEDGER = 'hwpos.customerLedger.v1';
const STORAGE_DRAWER_CLOSEOUTS = 'hwpos.drawerCloseouts.v1';
const STORAGE_SETTINGS = 'hwpos.settings.v1';
const STORAGE_ROLE = 'hwpos.role.v1';
const STORAGE_TILE_SIZE  = 'hwpos.tileSize';
const STORAGE_SHOW_PRICE = 'hwpos.showPrice';
const STORAGE_THEME = 'hwpos.theme';
const BACKUP_FORMAT_KEY = 'hwpos.backup.v1';
const BACKUP_KEYS = [
  STORAGE_FOLDERS,
  STORAGE_PRODUCTS,
  STORAGE_GROUPS,
  STORAGE_ORDERS,
  STORAGE_ORDER_SEQ,
  STORAGE_CUSTOMERS,
  STORAGE_CUSTOMER_LEDGER,
  STORAGE_DRAWER_CLOSEOUTS,
  STORAGE_SETTINGS,
  STORAGE_ROLE,
  STORAGE_TILE_SIZE,
  STORAGE_SHOW_PRICE,
  STORAGE_THEME,
];

const DEFAULT_SETTINGS = {
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

const state = {
  view: 'dashboard',
  range: 'today',
  folders: [],
  products: [],
  orders: [],
  customers: [],
  settings: { ...DEFAULT_SETTINGS },
  invQuery: '',
  custQuery: '',
};

// ---------- Helpers ----------
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesoShort = (n) => '₱' + Math.round(Number(n || 0)).toLocaleString('en-PH');
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function storageGet(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (_) {
    return false;
  }
}

function readJsonStorage(key, fallback) {
  const raw = storageGet(key, null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, 2000);
}

// ---------- Persistence (read same data POS app writes) ----------
function loadFolders() {
  try {
    const raw = storageGet(STORAGE_FOLDERS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return SEED_FOLDERS.map(f => ({ ...f }));
}
function loadProducts() {
  try {
    const raw = storageGet(STORAGE_PRODUCTS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return PRODUCTS.map(p => ({ ...p }));
}
function saveProducts() {
  return storageSet(STORAGE_PRODUCTS, JSON.stringify(state.products));
}
function loadOrders() {
  const raw = readJsonStorage(STORAGE_ORDERS, []);
  return Array.isArray(raw) ? raw.map(normalizeOrder).filter(Boolean) : [];
}
function loadSavedCustomers() {
  const raw = readJsonStorage(STORAGE_CUSTOMERS, []);
  return Array.isArray(raw) ? raw : [];
}
function loadSettings() {
  const saved = readJsonStorage(STORAGE_SETTINGS, {}) || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    store: { ...DEFAULT_SETTINGS.store, ...(saved.store || {}) },
    sync: { ...DEFAULT_SETTINGS.sync, ...(saved.sync || {}) },
    printing: { ...DEFAULT_SETTINGS.printing, ...(saved.printing || {}) },
  };
}
function saveSettings() {
  return storageSet(STORAGE_SETTINGS, JSON.stringify(state.settings));
}

function folderName(id) {
  const f = state.folders.find(x => x.id === id);
  return f ? f.name : 'Uncategorized';
}

function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const body = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildFullBackup() {
  const storage = {};
  BACKUP_KEYS.forEach(key => {
    const value = storageGet(key, null);
    if (value != null) storage[key] = value;
  });
  return {
    formatKey: BACKUP_FORMAT_KEY,
    exportedAt: new Date().toISOString(),
    app: 'Hardware POS',
    storage,
    summary: {
      products: readJsonStorage(STORAGE_PRODUCTS, []).length || 0,
      orders: readJsonStorage(STORAGE_ORDERS, []).length || 0,
      customers: readJsonStorage(STORAGE_CUSTOMERS, []).length || 0,
      ledgerEntries: readJsonStorage(STORAGE_CUSTOMER_LEDGER, []).length || 0,
      drawerCloseouts: readJsonStorage(STORAGE_DRAWER_CLOSEOUTS, []).length || 0,
      folders: readJsonStorage(STORAGE_FOLDERS, []).length || 0,
    },
  };
}

function exportFullBackup() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadJson(`hardware-pos-backup-${stamp}.json`, buildFullBackup());
  showToast('Backup exported');
}

function validateBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Backup file is not valid JSON.');
  if (payload.formatKey !== BACKUP_FORMAT_KEY) throw new Error('This is not a Hardware POS backup file.');
  if (!payload.storage || typeof payload.storage !== 'object') throw new Error('Backup is missing storage data.');
  const valid = {};
  BACKUP_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(payload.storage, key)) {
      valid[key] = String(payload.storage[key]);
    }
  });
  if (!Object.keys(valid).length) throw new Error('Backup has no restorable data.');
  [
    STORAGE_FOLDERS,
    STORAGE_PRODUCTS,
    STORAGE_GROUPS,
    STORAGE_ORDERS,
    STORAGE_CUSTOMERS,
    STORAGE_SETTINGS,
  ].forEach(key => {
    if (valid[key] != null) JSON.parse(valid[key]);
  });
  return valid;
}

function restoreFullBackup(payload) {
  const values = validateBackupPayload(payload);
  BACKUP_KEYS.forEach(key => localStorage.removeItem(key));
  Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
  refreshSharedState();
  renderCurrentView();
  showToast('Backup restored');
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  if (row.some(v => v !== '') || rows.length === 0) rows.push(row);
  return rows;
}

function importProductsCsv(text) {
  const rows = parseCsv(text).filter(r => r.some(Boolean));
  if (rows.length < 2) return 0;
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const index = name => headers.indexOf(name);
  const get = (row, name) => {
    const i = index(name);
    return i >= 0 ? String(row[i] || '').trim() : '';
  };
  let changed = 0;
  rows.slice(1).forEach(row => {
    const sku = get(row, 'sku');
    const name = get(row, 'name');
    if (!sku || !name) return;
    const folder = get(row, 'category') || get(row, 'folder') || '';
    const data = {
      sku,
      barcode: get(row, 'barcode'),
      name,
      brand: get(row, 'brand') || 'Generic',
      folder,
      unit: get(row, 'unit') || 'pc',
      cost: parseFloat(get(row, 'cost')) || 0,
      price: parseFloat(get(row, 'price')) || 0,
      stock: parseInt(get(row, 'stock'), 10) || 0,
      reorderPoint: parseInt(get(row, 'reorder_point') || get(row, 'reorderpoint'), 10) || 0,
      aliases: get(row, 'aliases').split('|').map(s => s.trim()).filter(Boolean),
    };
    let product = state.products.find(p => p.sku === sku);
    if (product) Object.assign(product, data);
    else state.products.push({ id: 'imp_' + sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), ...data });
    if (folder && !state.folders.some(f => f.id === folder)) {
      state.folders.push({ id: folder, name: folder.charAt(0).toUpperCase() + folder.slice(1), builtin: false });
    }
    changed++;
  });
  if (changed) {
    storageSet(STORAGE_FOLDERS, JSON.stringify(state.folders));
    saveProducts();
  }
  return changed;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOrder(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const total = toNumber(raw.total, items.reduce((sum, i) => sum + toNumber(i.price) * toNumber(i.qty, 1), 0));
  return {
    id: String(raw.id || raw.number || ''),
    number: String(raw.number || raw.id || ''),
    ts: toNumber(raw.ts, Date.now()),
    status: ['saved', 'completed', 'voided', 'refunded', 'return'].includes(raw.status) ? raw.status : 'completed',
    cashier: String(raw.cashier || 'El John'),
    customer: raw.customer ? { ...raw.customer, name: String(raw.customer.name || '') } : null,
    paymentMethod: raw.paymentMethod || 'cash',
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    items: items.map(i => ({
      id: String(i.productId || i.id || ''),
      name: String(i.name || 'Item'),
      sku: String(i.sku || ''),
      unit: String(i.unit || 'pc'),
      qty: Math.max(1, toNumber(i.qty, 1)),
      price: toNumber(i.price, 0),
    })),
    total,
  };
}

function allCustomerRecords() {
  const seen = new Set();
  const out = [];
  for (const c of state.customers || []) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  for (const c of (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : [])) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

function rangeStart(range) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (range === '7d') d.setDate(d.getDate() - 6);
  if (range === '30d') d.setDate(d.getDate() - 29);
  return d.getTime();
}

function completedSales(range = state.range) {
  const start = rangeStart(range);
  return state.orders
    .filter(o => (o.status || 'completed') === 'completed' && o.ts >= start)
    .sort((a, b) => b.ts - a.ts);
}

function computeSalesTotals(sales) {
  const revenue = sales.reduce((sum, s) => sum + s.total, 0);
  const txns = sales.length;
  const items = sales.reduce((sum, s) => sum + s.items.reduce((n, item) => n + item.qty, 0), 0);
  const avg = txns > 0 ? revenue / txns : 0;
  const cashTotal = sales
    .filter(s => s.paymentMethod === 'cash' || s.payments.some(p => p.method === 'cash'))
    .reduce((sum, s) => sum + (s.payments.find(p => p.method === 'cash')?.amount || (s.paymentMethod === 'cash' ? s.total : 0)), 0);
  const creditTotal = sales
    .filter(s => s.paymentMethod === 'credit' || s.payments.some(p => p.method === 'credit'))
    .reduce((sum, s) => sum + (s.payments.find(p => p.method === 'credit')?.amount || (s.paymentMethod === 'credit' ? s.total : 0)), 0);
  return { revenue, txns, items, avg, cashTotal, creditTotal };
}

function orderPaymentLabel(order) {
  if (order.paymentMethod === 'split') return 'split';
  if (order.paymentMethod === 'credit') return 'credit';
  return 'cash';
}

function salesByDay(sales = completedSales('7d')) {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push({ date: d, label: d.toLocaleDateString('en-PH', { weekday: 'short' }), value: 0 });
  }
  sales.forEach(order => {
    const d = new Date(order.ts);
    d.setHours(0, 0, 0, 0);
    const bucket = days.find(day => day.date.getTime() === d.getTime());
    if (bucket) bucket.value += order.total;
  });
  return days;
}

function enrichedSales(range = state.range) {
  return completedSales(range).map(order => {
    const d = new Date(order.ts);
    return {
      id: '#' + order.number,
      ts: order.ts,
      date: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }),
      cashier: order.cashier,
      customer: order.customer?.name || 'Walk-in',
      method: orderPaymentLabel(order),
      amount: order.total,
      items: order.items.reduce((sum, item) => sum + item.qty, 0),
    };
  });
}

function topSkus(sales = completedSales(state.range)) {
  const qtyById = new Map();
  sales.forEach(order => {
    order.items.forEach(item => {
      const id = item.id || item.sku || item.name;
      const cur = qtyById.get(id) || { ...item, sold: 0 };
      cur.sold += item.qty;
      qtyById.set(id, cur);
    });
  });
  return Array.from(qtyById.values())
    .map(item => ({ ...(state.products.find(p => p.id === item.id || p.sku === item.sku) || item), sold: item.sold }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);
}

// ---------- Routing ----------
function setView(view) {
  state.view = view;
  $$('.side-link').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => {
    const on = v.dataset.view === view;
    v.classList.toggle('active', on);
    v.hidden = !on;
  });
  const title = $('#boTopbarTitle');
  if (title) {
    const labels = {
      dashboard: 'Dashboard',
      sales: 'Sales',
      inventory: 'Inventory',
      customers: 'Customers',
      suppliers: 'Suppliers',
      staff: 'Staff',
      settings: 'Settings',
    };
    title.textContent = labels[view] || 'Back Office';
  }
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'sales')      renderSales();
  else if (state.view === 'inventory')  renderInventory();
  else if (state.view === 'customers')  renderCustomers();
  else if (state.view === 'suppliers')  renderSuppliers();
  else if (state.view === 'staff')      renderStaff();
  else if (state.view === 'settings')   renderSettingsForm();
}

function refreshSharedState() {
  state.folders  = loadFolders();
  state.products = loadProducts();
  state.orders = loadOrders();
  state.customers = loadSavedCustomers();
  state.settings = loadSettings();
}

// ---------- Dashboard ----------
function renderDashboard() {
  refreshSharedState();
  const sales = completedSales(state.range);
  const totals = computeSalesTotals(sales);

  // KPI row
  $('#kpiRow').innerHTML = [
    kpi('Revenue', pesoShort(totals.revenue), `${state.range === 'today' ? 'today' : state.range}`, 'flat'),
    kpi('Transactions', totals.txns, 'completed receipts', 'flat'),
    kpi('Items sold', totals.items, 'units across receipts', 'flat'),
    kpi('Avg basket', pesoShort(totals.avg), totals.txns ? 'per receipt' : 'no sales yet', 'flat'),
  ].join('');

  // Today label
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#todayLabel').textContent = today;

  // Sales chart
  const series = salesByDay();
  const max = Math.max(1, ...series.map(s => s.value));
  $('#salesChart').innerHTML = series.map(s => {
    const pct = s.value > 0 ? Math.max(4, (s.value / max) * 100) : 0;
    return `
      <div class="chart-bar" title="${s.label}: ${peso(s.value)}">
        <div class="chart-bar-fill" style="height:${pct}%"></div>
        <div class="chart-bar-label">${s.label}</div>
      </div>`;
  }).join('');
  $('#chartTotal').textContent = pesoShort(series.reduce((a, b) => a + b.value, 0)) + ' total';

  // Recent sales
  const recentSales = enrichedSales();
  $('#recentSales').innerHTML = recentSales.length ? recentSales.slice(0, 8).map(s => `
    <div class="mini-row">
      <div class="mr-id">${escapeHtml(s.id)}</div>
      <div class="mr-time">${escapeHtml(s.time)}</div>
      <div class="mr-meta">${escapeHtml(s.customer || 'Walk-in')}</div>
      <div class="mr-amt">
        <span class="pay-pill ${s.method}">${s.method}</span>
        &nbsp;${peso(s.amount)}
      </div>
    </div>
  `).join('') : `<div class="mini-row"><div class="mr-meta">No completed sales yet</div></div>`;

  // Low stock (top 5)
  const lows = state.products
    .filter(p => p.stock <= p.reorderPoint)
    .sort((a, b) => (a.stock / a.reorderPoint) - (b.stock / b.reorderPoint))
    .slice(0, 5);
  $('#lowCount').textContent = `${state.products.filter(p => p.stock <= p.reorderPoint).length} item(s)`;
  $('#lowStockList').innerHTML = lows.length === 0
    ? `<div class="mini-list-row"><div class="ml-left"><span class="ml-name">All items above reorder point</span></div></div>`
    : lows.map(p => {
        const danger = p.stock <= p.reorderPoint * 0.25;
        return `
          <div class="mini-list-row ${danger ? 'danger' : 'warn'}">
            <div class="ml-left">
              <span class="ml-name">${escapeHtml(p.name)}</span>
              <span class="ml-sub">${escapeHtml(p.sku)} · reorder at ${p.reorderPoint}</span>
            </div>
            <span class="ml-value">${p.stock} ${escapeHtml(p.unit)}</span>
          </div>`;
      }).join('');

  // Utang
  const debtors = allCustomerRecords().filter(c => (c.currentBalance || 0) > 0)
    .sort((a, b) => b.currentBalance - a.currentBalance);
  const utangSum = debtors.reduce((a, c) => a + c.currentBalance, 0);
  $('#utangTotal').textContent = peso(utangSum);
  $('#utangList').innerHTML = debtors.length === 0
    ? `<div class="mini-list-row"><div class="ml-left"><span class="ml-name">No outstanding credit</span></div></div>`
    : debtors.slice(0, 5).map(c => {
        const pctOfLimit = c.creditLimit > 0 ? c.currentBalance / c.creditLimit : 0;
        const tone = pctOfLimit > 0.75 ? 'danger' : pctOfLimit > 0.4 ? 'warn' : '';
        return `
          <div class="mini-list-row ${tone}">
            <div class="ml-left">
              <span class="ml-name">${escapeHtml(c.name)}</span>
              <span class="ml-sub">limit ${pesoShort(c.creditLimit)} · ${Math.round(pctOfLimit * 100)}% used</span>
            </div>
            <span class="ml-value">${peso(c.currentBalance)}</span>
          </div>`;
      }).join('');

  // Top SKUs
  const skuRows = topSkus(sales);
  $('#topSkus').innerHTML = skuRows.length ? skuRows.map(p => `
    <div class="mini-list-row">
      <div class="ml-left">
        <span class="ml-name">${escapeHtml(p.name)}</span>
        <span class="ml-sub">${escapeHtml(p.sku)} · ${peso(p.price)}</span>
      </div>
      <span class="ml-value">${p.sold} ${escapeHtml(p.unit)}</span>
    </div>
  `).join('') : `<div class="mini-list-row"><div class="ml-left"><span class="ml-name">No completed sales yet</span></div></div>`;
}

function kpi(label, value, delta, tone) {
  const arrow = tone === 'up' ? '↑' : tone === 'down' ? '↓' : '·';
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(String(value))}</div>
      <div class="kpi-delta ${tone}">${arrow} ${escapeHtml(delta)}</div>
    </div>`;
}

// ---------- Sales ----------
function renderSales() {
  refreshSharedState();
  const sales = enrichedSales();
  $('#salesCount').textContent = `${sales.length} transaction${sales.length === 1 ? '' : 's'}`;

  const totals = computeSalesTotals(completedSales(state.range));
  const total = totals.revenue;
  const cashPct = total > 0 ? Math.round((totals.cashTotal / total) * 100) : 0;
  const creditPct = total > 0 ? Math.round((totals.creditTotal / total) * 100) : 0;

  $('#salesKpis').innerHTML = [
    kpi('Total', pesoShort(total), 'all transactions', 'flat'),
    kpi('Cash', pesoShort(totals.cashTotal), `${cashPct}% of total`, 'flat'),
    kpi('Credit (utang)', pesoShort(totals.creditTotal), `${creditPct}% of total`, 'flat'),
    kpi('Items', totals.items, 'units across receipts', 'flat'),
  ].join('');

  $('#salesTable tbody').innerHTML = sales.length ? sales.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.id)}</strong></td>
      <td>${escapeHtml(s.date)} · ${escapeHtml(s.time)}</td>
      <td>${escapeHtml(s.cashier)}</td>
      <td>${escapeHtml(s.customer || 'Walk-in')}</td>
      <td><span class="pay-pill ${s.method}">${s.method}</span></td>
      <td class="num">${s.items}</td>
      <td class="num"><strong>${peso(s.amount)}</strong></td>
      <td><a class="link-btn" href="index.html#orders">View →</a></td>
    </tr>
  `).join('') : `<tr><td colspan="8" class="bo-empty">No completed sales in this range.</td></tr>`;
}

// ---------- Inventory (back-office view, costs visible) ----------
function renderInventory() {
  const products = state.products;
  const q = state.invQuery.trim().toLowerCase();
  const filtered = q
    ? products.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.aliases || []).some(a => a.toLowerCase().includes(q))
      )
    : products;

  // KPIs
  const totalSkus  = products.length;
  const stockValue = products.reduce((a, p) => a + p.cost * p.stock, 0);
  const retailValue = products.reduce((a, p) => a + p.price * p.stock, 0);
  const lows = products.filter(p => p.stock <= p.reorderPoint).length;
  $('#invKpis').innerHTML = [
    kpi('Total SKUs', totalSkus, `${state.folders.length - 1} folders`, 'flat'),
    kpi('Stock value (cost)', pesoShort(stockValue), 'at supplier cost', 'flat'),
    kpi('Stock value (retail)', pesoShort(retailValue), 'at selling price', 'flat'),
    kpi('Low stock', lows, lows === 0 ? 'all healthy' : 'needs reorder', lows === 0 ? 'flat' : 'down'),
  ].join('');

  $('#invSummary').textContent = `${filtered.length} of ${totalSkus} products`;

  $('#invTable tbody').innerHTML = filtered.map(p => {
    const margin = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0;
    const status = p.stock === 0 ? ['danger', 'Out of stock']
                 : p.stock <= p.reorderPoint * 0.5 ? ['danger', 'Critical']
                 : p.stock <= p.reorderPoint ? ['warn', 'Low']
                 : ['ok', 'In stock'];
    return `
      <tr>
        <td><strong>${escapeHtml(p.sku)}</strong></td>
        <td>
          ${escapeHtml(p.name)}
          <div class="muted-sub">${escapeHtml(p.brand || '')}</div>
        </td>
        <td>${escapeHtml(folderName(p.folder))}</td>
        <td class="num">${p.stock} ${escapeHtml(p.unit)}</td>
        <td class="num">${peso(p.cost)}</td>
        <td class="num">${peso(p.price)}</td>
        <td class="num">${margin.toFixed(0)}%</td>
        <td class="num">${pesoShort(p.cost * p.stock)}</td>
        <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
      </tr>`;
  }).join('') || `<tr><td colspan="9" class="bo-empty">No products match "${escapeHtml(q)}"</td></tr>`;
}

// ---------- Customers ----------
function renderCustomers() {
  const q = state.custQuery.trim().toLowerCase();
  const customers = allCustomerRecords();
  const list = q
    ? customers.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    : customers;

  const totalOutstanding = customers.reduce((a, c) => a + (c.currentBalance || 0), 0);
  const totalLimit = customers.reduce((a, c) => a + (c.creditLimit || 0), 0);
  const overLimit = customers.filter(c => c.currentBalance > c.creditLimit * 0.75).length;
  const active = customers.filter(c => c.currentBalance > 0).length;
  const utilization = totalLimit > 0 ? Math.round(totalOutstanding / totalLimit * 100) : 0;

  $('#custSummary').textContent = `${list.length} customer${list.length === 1 ? '' : 's'}`;
  $('#custKpis').innerHTML = [
    kpi('Outstanding utang', pesoShort(totalOutstanding), `${active} active debtors`, 'flat'),
    kpi('Credit limit pool', pesoShort(totalLimit), 'total approved', 'flat'),
    kpi('Utilization', utilization + '%', 'of total pool', 'flat'),
    kpi('Near limit', overLimit, '> 75% utilized', overLimit > 0 ? 'down' : 'flat'),
  ].join('');

  $('#custTable tbody').innerHTML = list.map(c => {
    const avail = (c.creditLimit || 0) - (c.currentBalance || 0);
    const pct = c.creditLimit > 0 ? c.currentBalance / c.creditLimit : 0;
    const status = pct === 0 ? ['ok', 'Clear']
                 : pct > 0.75 ? ['danger', 'Near limit']
                 : pct > 0.4 ? ['warn', 'In use']
                 : ['muted', 'Active'];
    return `
      <tr>
        <td>
          <strong>${escapeHtml(c.name)}</strong>
          <div class="muted-sub">${escapeHtml(c.id)}</div>
        </td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td>${escapeHtml(c.address || '—')}</td>
        <td class="num">${pesoShort(c.creditLimit)}</td>
        <td class="num"><strong>${peso(c.currentBalance)}</strong></td>
        <td class="num">${pesoShort(avail)}</td>
        <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
      </tr>`;
  }).join('') || `<tr><td colspan="7" class="bo-empty">No customers match.</td></tr>`;
}

// ---------- Suppliers (mock) ----------
const SUPPLIERS = [
  { name: 'Atlanta Trading', contact: 'Mr. Reyes · 0917-300-1100', lead: '2 days', items: 12, lastPo: '2026-05-10' },
  { name: 'Phelps Dodge PH',  contact: 'Lyn Tan · 0918-200-3344',  lead: '3 days', items: 6,  lastPo: '2026-05-04' },
  { name: 'Holcim Distribute',contact: 'Mark D. · 0922-114-7708',  lead: '1 day',  items: 3,  lastPo: '2026-05-12' },
  { name: 'Boysen Paints',    contact: 'Showroom · 0917-555-9000', lead: '2 days', items: 8,  lastPo: '2026-05-08' },
  { name: 'Royu Electrical',  contact: 'Direct · 0918-770-2211',   lead: '4 days', items: 9,  lastPo: '2026-04-29' },
];
function renderSuppliers() {
  $('#supTable tbody').innerHTML = SUPPLIERS.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.contact)}</td>
      <td>${escapeHtml(s.lead)}</td>
      <td class="num">${s.items}</td>
      <td class="num">${escapeHtml(s.lastPo)}</td>
      <td><span class="status-pill ok">Active</span></td>
    </tr>
  `).join('');
}

// ---------- Staff ----------
const STAFF = [
  { name: 'El John',   role: 'owner',   email: 'eljohngomos385@gmail.com', pin: '••••', last: '2 min ago',  status: ['ok', 'Online'] },
  { name: 'Maricel R.', role: 'manager', email: 'maricel@ejhardware.ph',    pin: '••••', last: '12 min ago', status: ['ok', 'Online'] },
  { name: 'Aldrin S.',  role: 'cashier', email: '—',                        pin: '••••', last: '1 hr ago',   status: ['muted', 'Idle'] },
  { name: 'Joy P.',     role: 'cashier', email: '—',                        pin: '••••', last: 'Yesterday',  status: ['muted', 'Offline'] },
];
function renderStaff() {
  $('#staffTable tbody').innerHTML = STAFF.map(u => `
    <tr>
      <td><strong>${escapeHtml(u.name)}</strong></td>
      <td><span class="role-pill ${u.role}">${u.role.charAt(0).toUpperCase()}${u.role.slice(1)}</span></td>
      <td>${escapeHtml(u.email)}</td>
      <td>${escapeHtml(u.pin)}</td>
      <td>${escapeHtml(u.last)}</td>
      <td><span class="status-pill ${u.status[0]}">${u.status[1]}</span></td>
    </tr>
  `).join('');
}

function renderSettingsForm() {
  const s = state.settings;
  const setValue = (id, value) => { const el = $('#' + id); if (el) el.value = value ?? ''; };
  const setChecked = (id, value) => { const el = $('#' + id); if (el) el.checked = !!value; };
  setValue('setStoreName', s.store.name);
  setValue('setStoreAddress', s.store.address);
  setValue('setStorePhone', s.store.phone);
  setValue('setCurrency', s.store.currency);
  setValue('setTin', s.store.tin);
  setChecked('setVatRegistered', s.vatInclusive);
  setValue('setVatRate', `${Math.round((s.vatRate || 0) * 100)}%`);
  setValue('setBackendUrl', s.sync.backendUrl);
  setValue('setSyncInterval', s.sync.interval);
  setChecked('setAllowOffline', s.sync.allowOfflineSales);
  setValue('setPrinterWidth', s.printing.width);
  setChecked('setPrintOnSale', s.printing.printOnSale);
  setChecked('setLogoOnReceipt', s.printing.logoOnReceipt);
}

function persistSettingsFromForm() {
  const val = id => ($('#' + id)?.value || '').trim();
  const checked = id => !!$('#' + id)?.checked;
  const vatRateRaw = val('setVatRate').replace('%', '');
  const vatRate = parseFloat(vatRateRaw);
  state.settings = {
    ...state.settings,
    vatInclusive: checked('setVatRegistered'),
    vatRate: Number.isFinite(vatRate) ? vatRate / 100 : state.settings.vatRate,
    store: {
      ...state.settings.store,
      name: val('setStoreName') || DEFAULT_SETTINGS.store.name,
      address: val('setStoreAddress') || DEFAULT_SETTINGS.store.address,
      phone: val('setStorePhone') || DEFAULT_SETTINGS.store.phone,
      currency: val('setCurrency') || DEFAULT_SETTINGS.store.currency,
      tin: val('setTin') || DEFAULT_SETTINGS.store.tin,
    },
    sync: {
      ...state.settings.sync,
      backendUrl: val('setBackendUrl'),
      interval: val('setSyncInterval') || DEFAULT_SETTINGS.sync.interval,
      allowOfflineSales: checked('setAllowOffline'),
    },
    printing: {
      ...state.settings.printing,
      width: val('setPrinterWidth') || DEFAULT_SETTINGS.printing.width,
      printOnSale: checked('setPrintOnSale'),
      logoOnReceipt: checked('setLogoOnReceipt'),
    },
  };
  saveSettings();
}

// ---------- Event wiring ----------
function wireEvents() {
  // Sidebar navigation
  $$('.side-link').forEach(b => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  // Segmented range (dashboard + sales)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const wrap = btn.parentElement;
    $$('.seg-btn', wrap).forEach(b => b.classList.toggle('active', b === btn));
    state.range = btn.dataset.range;
    renderCurrentView();
  });

  // "View all →" jumps inside dashboard
  document.addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (!j) return;
    setView(j.dataset.jump);
  });

  // Inventory search
  $('#invSearch')?.addEventListener('input', (e) => {
    state.invQuery = e.target.value;
    renderInventory();
  });

  // Customer search
  $('#custSearch')?.addEventListener('input', (e) => {
    state.custQuery = e.target.value;
    renderCustomers();
  });

  $('#salesExportBtn')?.addEventListener('click', () => {
    const rows = [
      ['receipt', 'date', 'time', 'cashier', 'customer', 'payment', 'items', 'total'],
      ...enrichedSales().map(s => [s.id, s.date, s.time, s.cashier, s.customer, s.method, s.items, s.amount]),
    ];
    downloadCsv('sales.csv', rows);
  });

  $('#invExportBtn')?.addEventListener('click', () => {
    const rows = [
      ['sku', 'barcode', 'name', 'brand', 'category', 'unit', 'cost', 'price', 'stock', 'reorder_point', 'aliases'],
      ...state.products.map(p => [
        p.sku, p.barcode || '', p.name, p.brand || '', p.folder || '', p.unit || 'pc',
        p.cost || 0, p.price || 0, p.stock || 0, p.reorderPoint || 0, (p.aliases || []).join('|'),
      ]),
    ];
    downloadCsv('inventory.csv', rows);
  });

  $('#invImportBtn')?.addEventListener('click', () => $('#invImportFile')?.click());
  $('#invImportFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const count = importProductsCsv(await file.text());
    renderCurrentView();
    showToast(count ? `Imported ${count} product${count === 1 ? '' : 's'}` : 'No products imported');
    e.target.value = '';
  });

  $('#backupExportBtn')?.addEventListener('click', exportFullBackup);
  $('#backupImportBtn')?.addEventListener('click', () => $('#backupImportFile')?.click());
  $('#backupImportFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      restoreFullBackup(JSON.parse(await file.text()));
    } catch (err) {
      showToast(err?.message || 'Backup restore failed');
    } finally {
      e.target.value = '';
    }
  });

  // ----- Settings → Appearance (S/M/L tile size + price toggle) -----
  // Sync initial state from localStorage
  const currentSize = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
  $$('#settingsSizeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const currentShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
  const showCb = $('#settingsShowPrice');
  if (showCb) showCb.checked = currentShow;

  $$('#settingsSizeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      const size = b.dataset.size;
      storageSet(STORAGE_TILE_SIZE, size);
      $$('#settingsSizeToggle .bb-size-btn').forEach(x => x.classList.toggle('active', x === b));
      showToast(`Tile size set to ${size.toUpperCase()} — Sell screen will update`);
    });
  });
  showCb?.addEventListener('change', (e) => {
    storageSet(STORAGE_SHOW_PRICE, e.target.checked ? '1' : '0');
    showToast(e.target.checked ? 'Prices will show on tiles' : 'Prices hidden on tiles');
  });

  [
    'setStoreName', 'setStoreAddress', 'setStorePhone', 'setCurrency', 'setVatRate', 'setTin',
    'setBackendUrl', 'setSyncInterval', 'setPrinterWidth',
  ].forEach(id => $('#' + id)?.addEventListener('change', persistSettingsFromForm));
  [
    'setVatRegistered', 'setAllowOffline', 'setPrintOnSale', 'setLogoOnReceipt',
  ].forEach(id => $('#' + id)?.addEventListener('change', persistSettingsFromForm));

  // Re-pull localStorage when switching back to the tab (POS app might have edited it)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshSharedState();
      renderCurrentView();
    }
  });

  window.addEventListener('storage', (e) => {
    const watched = new Set([
      STORAGE_FOLDERS,
      STORAGE_PRODUCTS,
      STORAGE_ORDERS,
      STORAGE_CUSTOMERS,
      STORAGE_SETTINGS,
      STORAGE_TILE_SIZE,
      STORAGE_SHOW_PRICE,
      STORAGE_THEME,
    ]);
    if (!watched.has(e.key)) return;
    if (e.key === STORAGE_TILE_SIZE || e.key === STORAGE_SHOW_PRICE || e.key === STORAGE_THEME) {
      // Appearance change from POS app — re-sync the Appearance panel UI
      const currentSize = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
      $$('#settingsSizeToggle .bb-size-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.size === currentSize);
      });
      const currentShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
      const showCb = $('#settingsShowPrice');
      if (showCb) showCb.checked = currentShow;
      return;
    }
    refreshSharedState();
    renderCurrentView();
  });
}

// ---------- Init ----------
function init() {
  refreshSharedState();
  wireEvents();
  // Honour a #settings (or any view) URL hash so deep links from the POS work.
  const hash = (location.hash || '').replace('#', '').trim();
  const validViews = ['dashboard', 'sales', 'inventory', 'customers', 'suppliers', 'staff', 'settings'];
  setView(validViews.includes(hash) ? hash : 'dashboard');
}

document.addEventListener('DOMContentLoaded', init);
