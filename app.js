/* ==========================================================
   Hardware POS — UI logic
   - Folders on the page (Sell + Inventory)
   - Shopify-style inventory backend: products CRUD, folder CRUD,
     bulk move/delete, folder filtering
   - Persisted to localStorage
   ========================================================== */

const STORAGE_FOLDERS = 'hwpos.folders.v2';
const STORAGE_PRODUCTS = 'hwpos.products.v2';
const STORAGE_GROUPS = 'hwpos.groups.v1';
const STORAGE_ORDERS = 'hwpos.orders.v1';
const STORAGE_ORDER_SEQ = 'hwpos.orderSeq.v1';
const STORAGE_CUSTOMERS = 'hwpos.customers.v1';
const STORAGE_CUSTOMER_LEDGER = 'hwpos.customerLedger.v1';
const STORAGE_DRAWER_CLOSEOUTS = 'hwpos.drawerCloseouts.v1';
const STORAGE_SETTINGS = 'hwpos.settings.v1';
const STORAGE_ROLE = 'hwpos.role.v1';

const DEFAULT_SETTINGS = {
  vatRate: 0.12,           // PH standard VAT, inclusive
  vatInclusive: true,
  defaultFulfilment: 'pickup', // 'pickup' | 'delivery'
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
const STORE_INFO = {
  name: 'EJ Hardware',
  address: 'Main Store, Laguna',
  phone: '0917-000-0000',
  tin: '000-000-000-000',
  registerNo: '1',
  cashier: 'El John',
};

const STORAGE_TILE_SIZE = 'hwpos.tileSize';
const STORAGE_SHOW_PRICE = 'hwpos.showPrice';
const STORAGE_THEME = 'hwpos.theme';

const ITEMS_PER_PAGE = { sm: 30, md: 20, lg: 12 };
const ORDER_SCHEMA_VERSION = 1;
const ORDER_FORMAT_KEY = 'hwpos.order.v1';

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
  } catch (err) {
    console.warn(`Unable to save ${key}`, err);
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

function writeJsonStorage(key, value) {
  return storageSet(key, JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneyValue(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function orderUid() {
  return 'ord_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// ---------- State ----------

const state = {
  view: 'sell',
  folderId: 'all',          // active folder on Sell
  query: '',
  folders: [],
  products: [],
  groups: [],
  activeGroupId: null,    // when set, sub-grid shows that group's items
  orders: [],
  selectedOrderId: null,
  ordersQuery: '',
  customerLedger: [],
  drawerCloseouts: [],
  variantModal: { groupId: null, selectedId: null, qty: 1, comment: '' },
  cartItemModal: { id: null },
  cart: [],
  cartDiscount: null,           // {type:'amount'|'percent', value:number}
  fulfilment: 'pickup',         // 'pickup' | 'delivery'
  deliveryAddress: '',
  deliveryLocation: null,
  deliveryMap: {
    centerLat: 14.2691,
    centerLng: 121.4113,
    zoom: 17,
    pinLat: null,
    pinLng: null,
    drag: null,
    pinch: null,
  },
  customer: null,
  customers: [],                // saved customers (separate from seeded credit accounts)
  paymentMethod: 'cash',
  vatRate: 0.12,
  role: 'manager',              // 'cashier' | 'manager'
  settings: { ...DEFAULT_SETTINGS },
  folderModal: { mode: 'create', editId: null },
  productModal: { mode: 'create', editId: null },
  fuse: null,
  page: 1,
  tileSize: (storageGet(STORAGE_TILE_SIZE, 'md') || 'md'),
  showPrice: storageGet(STORAGE_SHOW_PRICE, '0') === '1',
  theme: (storageGet(STORAGE_THEME, 'dark') || 'dark'),
};

const barcodeScanner = {
  stream: null,
  detector: null,
  zxingReader: null,
  zxingControls: null,
  timer: 0,
  active: false,
  lastValue: '',
  lastSeenAt: 0,
  recent: new Map(),
  cooldownMs: 1400,
};

// ---------- Helpers ----------
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const uid = () => 'p_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const DELIVERY_MAP_DEFAULT = { lat: 14.2691, lng: 121.4113, zoom: 17 };
const DELIVERY_MAP_MIN_ZOOM = 12;
const DELIVERY_MAP_MAX_ZOOM = 20;

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

function flashControl(el) {
  if (!el) return;
  el.classList.remove('control-flash');
  // Force reflow so repeated clicks replay the flash.
  void el.offsetWidth;
  el.classList.add('control-flash');
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => el.classList.remove('control-flash'), 520);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function wrapTileX(x, zoom) {
  const size = 2 ** zoom;
  return ((x % size) + size) % size;
}

function lonToWorldX(lng, zoom) {
  return ((lng + 180) / 360) * 256 * (2 ** zoom);
}

function latToWorldY(lat, zoom) {
  const safeLat = clamp(lat, -85.05112878, 85.05112878);
  const rad = safeLat * Math.PI / 180;
  return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 256 * (2 ** zoom);
}

function worldXToLng(x, zoom) {
  return x / (256 * (2 ** zoom)) * 360 - 180;
}

function worldYToLat(y, zoom) {
  const n = Math.PI - 2 * Math.PI * y / (256 * (2 ** zoom));
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function osmTileUrl(x, y, zoom) {
  return `https://tile.openstreetmap.org/${zoom}/${wrapTileX(x, zoom)}/${y}.png`;
}

function setAppViewportHeight() {
  const measuredHeight = Math.floor(
    window.visualViewport?.height ||
    window.innerHeight ||
    document.documentElement.clientHeight ||
    0
  );
  const measuredWidth = Math.floor(
    window.visualViewport?.width ||
    window.innerWidth ||
    document.documentElement.clientWidth ||
    0
  );
  if (measuredHeight <= 0) return;

  const activeTag = document.activeElement?.tagName;
  const editingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
  const previousWidth = setAppViewportHeight._width || measuredWidth;
  if (Math.abs(measuredWidth - previousWidth) > 80) {
    setAppViewportHeight._height = 0;
  }
  const stableHeight = setAppViewportHeight._height || measuredHeight;
  const keyboardShrink = editingText && measuredHeight < stableHeight - 80;
  const nextHeight = keyboardShrink ? stableHeight : Math.max(stableHeight, measuredHeight);

  setAppViewportHeight._height = nextHeight;
  setAppViewportHeight._width = measuredWidth;
  document.documentElement.style.setProperty('--app-height', `${nextHeight}px`);
}

function setCheckoutError(message = '') {
  const el = $('#checkoutError');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.hidden = false;
  flashControl(el);
}

function showConfirm({ title = 'Are you sure?', message = '', okText = 'Confirm', cancelText = 'Cancel', danger = true, onConfirm } = {}) {
  const modal = $('#confirmModal');
  if (!modal) return;
  const titleEl = $('#confirmTitle');
  const msgEl = $('#confirmMessage');
  const okBtn = $('#confirmOkBtn');
  const cancelBtn = modal.querySelector('.secondary-btn[data-close-modal]');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (okBtn) {
    okBtn.textContent = okText;
    okBtn.classList.toggle('danger', !!danger);
  }
  if (cancelBtn) cancelBtn.textContent = cancelText;

  // Replace the OK button to drop any prior click handlers
  if (okBtn) {
    const fresh = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(fresh, okBtn);
    fresh.addEventListener('click', () => {
      modal.hidden = true;
      if (typeof onConfirm === 'function') onConfirm();
    });
  }
  modal.hidden = false;
}

const FOLDER_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ALL_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/></svg>`;

// ---------- Persistence ----------
function loadFolders() {
  return readJsonStorage(STORAGE_FOLDERS, null) || SEED_FOLDERS.map(f => ({ ...f }));
}
function loadProducts() {
  return readJsonStorage(STORAGE_PRODUCTS, null) || PRODUCTS.map(p => ({ ...p }));
}
function saveFolders() {
  return writeJsonStorage(STORAGE_FOLDERS, state.folders);
}
function saveProducts() {
  return writeJsonStorage(STORAGE_PRODUCTS, state.products);
}
function loadGroups() {
  return readJsonStorage(STORAGE_GROUPS, null)
    || ((typeof SEED_GROUPS !== 'undefined') ? SEED_GROUPS.map(g => ({ ...g })) : []);
}
function saveGroups() {
  return writeJsonStorage(STORAGE_GROUPS, state.groups);
}
function groupById(id) { return state.groups.find(g => g.id === id) || null; }
function groupMembers(groupId) {
  return state.products.filter(p => p.groupId === groupId);
}

// ---------- Orders persistence ----------
function loadOrders() {
  const raw = readJsonStorage(STORAGE_ORDERS, []);
  return Array.isArray(raw) ? raw.map(normalizeOrderRecord).filter(Boolean) : [];
}
function saveOrdersList(orders) {
  return writeJsonStorage(STORAGE_ORDERS, (orders || []).map(normalizeOrderRecord).filter(Boolean));
}
function saveOrders() {
  return saveOrdersList(state.orders);
}
function nextOrderNumber() {
  // Format: <register>-<seq3>, e.g. "1-001". Sequence persists across sessions.
  const registerNo = currentStoreInfo().registerNo || STORE_INFO.registerNo;
  const orders = readJsonStorage(STORAGE_ORDERS, []);
  const orderSeq = Array.isArray(orders)
    ? orders.reduce((max, o) => {
        const number = String(o?.number || '');
        const parts = number.split('-');
        const reg = parts[0];
        const seq = parseInt(parts[1] || '', 10);
        return reg === registerNo && Number.isFinite(seq) ? Math.max(max, seq) : max;
      }, 0)
    : 0;
  let seq = parseInt(storageGet(STORAGE_ORDER_SEQ, '0') || '0', 10) || 0;
  seq = Math.max(seq, orderSeq);
  seq += 1;
  storageSet(STORAGE_ORDER_SEQ, String(seq));
  return `${registerNo}-${String(seq).padStart(3, '0')}`;
}

// ---------- Settings / customers / role persistence ----------
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
  return writeJsonStorage(STORAGE_SETTINGS, state.settings);
}
function loadSavedCustomers() {
  return readJsonStorage(STORAGE_CUSTOMERS, []) || [];
}
function saveSavedCustomers() {
  return writeJsonStorage(STORAGE_CUSTOMERS, state.customers);
}
function loadCustomerLedger() {
  const raw = readJsonStorage(STORAGE_CUSTOMER_LEDGER, []);
  return Array.isArray(raw) ? raw : [];
}
function saveCustomerLedger() {
  return writeJsonStorage(STORAGE_CUSTOMER_LEDGER, state.customerLedger);
}
function loadDrawerCloseouts() {
  const raw = readJsonStorage(STORAGE_DRAWER_CLOSEOUTS, []);
  return Array.isArray(raw) ? raw : [];
}
function saveDrawerCloseouts() {
  return writeJsonStorage(STORAGE_DRAWER_CLOSEOUTS, state.drawerCloseouts);
}
function loadRole() {
  return storageGet(STORAGE_ROLE, 'manager') || 'manager';
}
function saveRole(role) {
  return storageSet(STORAGE_ROLE, role);
}

function currentStoreInfo() {
  return { ...STORE_INFO, ...(state.settings?.store || {}) };
}

// ---------- Order format layer ----------
function normalizeOrderItem(item = {}) {
  const qty = Math.max(1, toNumber(item.qty, 1));
  const price = moneyValue(item.price);
  const gross = moneyValue(price * qty);
  const disc = item.discount && item.discount.value
    ? { type: item.discount.type === 'percent' ? 'percent' : 'amount', value: toNumber(item.discount.value, 0) }
    : null;
  const discounted = applyDiscount(gross, disc);
  return {
    id: String(item.id || item.productId || ''),
    productId: String(item.productId || item.id || ''),
    sku: String(item.sku || ''),
    name: String(item.name || 'Item'),
    unit: String(item.unit || 'pc'),
    qty,
    price,
    discount: disc,
    lineGross: gross,
    lineDiscount: moneyValue(discounted.off),
    lineTotal: moneyValue(discounted.net),
  };
}

function normalizePayment(payment = {}) {
  const method = ['cash', 'credit', 'split', 'other', 'unpaid'].includes(payment.method)
    ? payment.method
    : 'other';
  return {
    method,
    label: String(payment.label || method),
    amount: moneyValue(payment.amount),
    tendered: moneyValue(payment.tendered ?? payment.amount),
    change: moneyValue(payment.change),
    ref: payment.ref ? String(payment.ref) : '',
  };
}

function buildOrderPayments({ status, paymentMethod, total, tendered = 0, change = 0 }) {
  if (status === 'saved' || paymentMethod === 'unpaid') {
    return [{ method: 'unpaid', label: 'Not completed', amount: 0, tendered: 0, change: 0, ref: '' }];
  }
  if (paymentMethod === 'credit') {
    return [{ method: 'credit', label: 'Charge to account', amount: moneyValue(total), tendered: 0, change: 0, ref: '' }];
  }
  if (paymentMethod === 'split') {
    const cashApplied = Math.min(moneyValue(tendered), moneyValue(total));
    const balance = moneyValue(total - cashApplied);
    return [
      { method: 'cash', label: 'Cash', amount: cashApplied, tendered: moneyValue(tendered), change: moneyValue(change), ref: '' },
      ...(balance > 0 ? [{ method: 'credit', label: 'Charge balance', amount: balance, tendered: 0, change: 0, ref: '' }] : []),
    ];
  }
  return [{ method: 'cash', label: 'Cash', amount: moneyValue(total), tendered: moneyValue(tendered), change: moneyValue(change), ref: '' }];
}

function normalizeDeliveryLocation(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: clamp(lat, -85.05112878, 85.05112878),
    lng: clamp(lng, -180, 180),
    zoom: clamp(Math.round(Number(raw.zoom) || DELIVERY_MAP_DEFAULT.zoom), DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM),
    provider: String(raw.provider || 'openstreetmap'),
    attribution: String(raw.attribution || '© OpenStreetMap contributors'),
  };
}

function normalizeOrderRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeOrderItem) : [];
  const itemGross = moneyValue(items.reduce((sum, item) => sum + item.lineGross, 0));
  const itemDiscount = moneyValue(items.reduce((sum, item) => sum + item.lineDiscount, 0));
  const status = ['saved', 'completed', 'voided', 'refunded', 'return'].includes(raw.status) ? raw.status : 'completed';
  const paymentMethod = ['cash', 'credit', 'split', 'unpaid'].includes(raw.paymentMethod)
    ? raw.paymentMethod
    : (status === 'saved' ? 'unpaid' : 'cash');
  const subtotal = moneyValue(raw.subtotal ?? itemGross);
  const discount = moneyValue(raw.discount ?? itemDiscount);
  const total = moneyValue(raw.total ?? Math.max(0, subtotal - discount));
  const vatRate = toNumber(raw.vatRate, DEFAULT_SETTINGS.vatRate);
  const vatAmount = moneyValue(raw.vatAmount ?? (vatRate > 0 ? total * (vatRate / (1 + vatRate)) : 0));
  const vatableSales = moneyValue(raw.vatableSales ?? (total - vatAmount));
  const payments = Array.isArray(raw.payments) && raw.payments.length
    ? raw.payments.map(normalizePayment)
    : buildOrderPayments({
        status,
        paymentMethod,
        total,
        tendered: toNumber(raw.tendered, paymentMethod === 'cash' ? total : 0),
        change: toNumber(raw.change, 0),
      });
  const firstCash = payments.find(p => p.method === 'cash');
  const store = currentStoreInfo();
  const id = String(raw.id || orderUid());
  const number = String(raw.number || raw.receiptNumber || raw.orderNumber || id);
  const fulfilment = raw.fulfilment === 'delivery' ? 'delivery' : 'pickup';
  return {
    schemaVersion: ORDER_SCHEMA_VERSION,
    formatKey: ORDER_FORMAT_KEY,
    id,
    number,
    ts: toNumber(raw.ts, Date.now()),
    status,
    cashier: String(raw.cashier || store.cashier),
    register: String(raw.register || store.registerNo),
    items,
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
    subtotal,
    discount,
    cartDiscount: raw.cartDiscount ? { ...raw.cartDiscount } : null,
    originalOrderId: raw.originalOrderId ? String(raw.originalOrderId) : '',
    reason: raw.reason ? String(raw.reason) : '',
    voidedAt: raw.voidedAt ? toNumber(raw.voidedAt, 0) : 0,
    refundedAt: raw.refundedAt ? toNumber(raw.refundedAt, 0) : 0,
    returnedAt: raw.returnedAt ? toNumber(raw.returnedAt, 0) : 0,
    total,
    tendered: moneyValue(raw.tendered ?? firstCash?.tendered ?? (paymentMethod === 'cash' ? total : 0)),
    change: moneyValue(raw.change ?? firstCash?.change ?? 0),
    vatRate,
    vatAmount,
    vatableSales,
    fulfilment,
    deliveryAddress: fulfilment === 'delivery' ? String(raw.deliveryAddress || '') : '',
    deliveryLocation: fulfilment === 'delivery' ? normalizeDeliveryLocation(raw.deliveryLocation) : null,
    meta: {
      source: raw.meta?.source || 'pos-app',
      replaceableFormat: true,
    },
  };
}

function toReceiptViewModel(order) {
  const o = normalizeOrderRecord(order);
  const fulfilmentLabel = o.fulfilment === 'delivery'
    ? `DELIVERY${o.deliveryAddress ? ' · ' + o.deliveryAddress : ''}`
    : 'PICKUP';
  return {
    store: currentStoreInfo(),
    number: o.number,
    ts: o.ts,
    dateText: fmtReceiptTime(o.ts),
    cashier: o.cashier,
    register: o.register,
    customer: o.customer,
    deliveryAddress: o.deliveryAddress,
    deliveryLocation: o.deliveryLocation,
    fulfilmentLabel,
    items: o.items,
    totals: {
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      vatRate: o.vatRate,
      vatAmount: o.vatAmount,
      vatableSales: o.vatableSales,
    },
    status: o.status,
    paymentMethod: o.paymentMethod,
    payments: o.payments,
  };
}

window.HWPOS_ORDER_FORMAT = {
  schemaVersion: ORDER_SCHEMA_VERSION,
  formatKey: ORDER_FORMAT_KEY,
  normalizeOrder: normalizeOrderRecord,
  toReceiptViewModel,
  buildPayments: buildOrderPayments,
};

// ---------- Fuse rebuild ----------
function rebuildFuse() {
  const indexed = state.products.map(p => ({
    ...p,
    searchBlob: [p.name, p.sku, p.barcode, p.brand, ...(p.aliases || [])].join(' ').toLowerCase(),
  }));
  if (typeof Fuse !== 'function') {
    state.fuse = {
      search(query) {
        const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return indexed.map(item => ({ item, score: 0 }));
        return indexed
          .map(item => {
            const hay = item.searchBlob || '';
            const matches = terms.filter(term => hay.includes(term)).length;
            const starts = terms.filter(term => hay.startsWith(term) || String(item.sku || '').toLowerCase().startsWith(term)).length;
            return { item, score: matches === terms.length ? (0 - starts) : 999 };
          })
          .filter(r => r.score < 999)
          .sort((a, b) => a.score - b.score);
      },
    };
    return;
  }
  state.fuse = new Fuse(indexed, {
    keys: [
      { name: 'name',       weight: 0.45 },
      { name: 'sku',        weight: 0.30 },
      { name: 'barcode',    weight: 0.05 },
      { name: 'brand',      weight: 0.10 },
      { name: 'aliases',    weight: 0.35 },
      { name: 'searchBlob', weight: 0.20 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
  });
}

// ---------- Folder helpers ----------
function folderCount(folderId) {
  if (folderId === 'all') return state.products.length;
  return state.products.filter(p => p.folder === folderId).length;
}
function folderName(id) {
  const f = state.folders.find(x => x.id === id);
  return f ? f.name : 'Uncategorized';
}

// ---------- Folder strips (Sell + Inventory share) ----------
function renderFolderStrip(containerId, activeId, onClickFolderId) {
  const el = $('#' + containerId);
  if (!el) return;
  el.innerHTML = state.folders.map(f => {
    const active = f.id === activeId;
    const icon = f.id === 'all' ? ALL_ICON : FOLDER_ICON;
    return `
      <button class="folder-pill ${active ? 'active' : ''}" data-folder-id="${f.id}">
        ${icon}
        <span>${escapeHtml(f.name)}</span>
        <span class="folder-pill-count">${folderCount(f.id)}</span>
      </button>`;
  }).join('');
}

function renderSellFolderStrip() {
  renderFolderStrip('folderStrip', state.folderId);
}
function selectFolder(id) {
  state.folderId = id;
  state.page = 1;
  state.activeGroupId = null;   // exit any drilled-in group when changing folder
  renderSellFolderStrip();
  renderSellHeader();
  renderProducts();
}
// ---------- Folder modal ----------
function openFolderModal(mode, editId = null) {
  state.folderModal = { mode, editId };
  $('#folderModalTitle').textContent = mode === 'create' ? 'New Folder' : 'Rename Folder';
  const input = $('#folderNameInput');
  input.value = (mode === 'edit' && editId)
    ? (state.folders.find(x => x.id === editId)?.name || '')
    : '';
  $('#folderModal').hidden = false;
  setTimeout(() => input.focus(), 50);
}

function saveFolder() {
  const name = $('#folderNameInput').value.trim();
  if (!name) { showToast('Enter a folder name'); return; }
  const { mode, editId } = state.folderModal;
  if (mode === 'create') {
    let id = slug(name) || ('folder-' + Date.now());
    let unique = id, i = 2;
    while (state.folders.some(f => f.id === unique)) unique = `${id}-${i++}`;
    state.folders.push({ id: unique, name, builtin: false });
    saveFolders();
    showToast(`Created “${name}”`);
    renderAllFolderUis();
  } else if (mode === 'edit' && editId) {
    const f = state.folders.find(x => x.id === editId);
    if (f) { f.name = name; saveFolders(); showToast('Renamed'); }
    renderAllFolderUis();
  }
  $('#folderModal').hidden = true;
}

function deleteFolder(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f || f.builtin) return;
  const count = folderCount(id);
  const msg = count > 0
    ? `Delete folder “${f.name}”?\n${count} item${count === 1 ? '' : 's'} will become uncategorized.`
    : `Delete folder “${f.name}”?`;
  if (!confirm(msg)) return;
  state.folders = state.folders.filter(x => x.id !== id);
  state.products.forEach(p => { if (p.folder === id) p.folder = ''; });
  saveFolders(); saveProducts();
  if (state.folderId === id) state.folderId = 'all';
  renderAllFolderUis();
  showToast('Folder deleted');
}

function renderAllFolderUis() {
  renderSellFolderStrip();
  renderSellHeader();
  renderProducts();
  populateFolderSelect();
}

// ---------- Roles ----------
const ROLE_ALLOWED = {
  cashier: new Set(['sell', 'orders', 'settings', 'checkout', 'checkout-success']),
  manager: new Set(['sell', 'orders', 'customers', 'reports', 'back-office', 'settings', 'checkout', 'checkout-success']),
};
function canAccess(view) {
  const allowed = ROLE_ALLOWED[state.role] || ROLE_ALLOWED.manager;
  return allowed.has(view);
}
function applyRoleGating() {
  $$('.side-link').forEach(t => {
    t.hidden = !canAccess(t.dataset.view);
  });
  // If a cashier somehow lands on a manager view, kick them back to Sell.
  if (!canAccess(state.view)) {
    state.view = 'sell';
    $$('.side-link').forEach(t => t.classList.toggle('active', t.dataset.view === 'sell'));
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === 'sell'));
  }
}
function renderRoleSwitcher() {
  const userMeta = document.querySelector('.user-meta');
  if (!userMeta) return;
  const sub = userMeta.querySelector('.user-sub');
  if (!sub) return;
  sub.textContent = `${state.role === 'manager' ? 'Manager' : 'Cashier'} · Main Store`;
}

// ---------- View switching ----------
function switchView(view) {
  if (!canAccess(view)) {
    showToast('You do not have permission for that page');
    return;
  }
  state.view = view;
  $$('.side-link').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'back-office') { window.location.href = 'backoffice.html'; return; }
  if (view === 'settings') { renderPosSettings(); return; }
  if (view === 'orders') {
    // Always pull the latest from localStorage so a sale made in another tab
    // (or any state drift) shows up immediately.
    state.orders = loadOrders();
    renderOrders();
  }
  if (view === 'customers') renderCustomers();
  if (view === 'reports') renderReports();
  if (view === 'checkout') renderCheckout();
}

// ---------- Sell view ----------
function renderSellHeader() {
  const folder = state.folders.find(f => f.id === state.folderId);
  const t = $('#sellTitle'); if (t) t.textContent = folder ? folder.name : 'All Items';
  const c = $('#sellCount');
  if (c) {
    const count = getFilteredSellProducts().length;
    c.textContent = `${count} item${count === 1 ? '' : 's'}`;
  }
  // Pager label is owned by renderPager() — do not write it here.
}

function getFilteredSellProducts() {
  let list = state.products;
  if (state.query.trim()) {
    list = state.fuse.search(state.query.trim()).map(r => r.item);
  }
  if (state.folderId !== 'all') {
    list = list.filter(p => p.folder === state.folderId);
  }
  return list;
}

// What the Sell grid actually renders: either group tiles + loose products
// (when at top level), or a group's members (when drilled in).
// Returns an array of "cells" — each cell is { kind: 'group'|'product'|'back', ... }
function getSellCells() {
  // Drilled into a group → its members only (+ back tile up front)
  if (state.activeGroupId) {
    const g = groupById(state.activeGroupId);
    if (!g) { state.activeGroupId = null; }
    else {
      let members = groupMembers(g.id);
      // Honour search even inside a group
      if (state.query.trim() && state.fuse) {
        const matchIds = new Set(state.fuse.search(state.query.trim()).map(r => r.item.id));
        members = members.filter(p => matchIds.has(p.id));
      }
      const cells = [{ kind: 'back', groupName: g.name }];
      members.forEach(p => cells.push({ kind: 'product', product: p }));
      return cells;
    }
  }

  // Top level — show groups (whose members live in this folder) + ungrouped products.
  const baseProducts = getFilteredSellProducts();
  const cells = [];
  const seenGroups = new Set();
  // Determine which groups have at least one product in the filtered set.
  baseProducts.forEach(p => { if (p.groupId) seenGroups.add(p.groupId); });
  // Render group tiles in the order they appear in state.groups.
  state.groups.forEach(g => {
    if (!seenGroups.has(g.id)) return;
    const memberCount = baseProducts.filter(p => p.groupId === g.id).length;
    cells.push({ kind: 'group', group: g, memberCount });
  });
  // Then ungrouped products from the filtered set, in original order.
  baseProducts.forEach(p => {
    if (!p.groupId) cells.push({ kind: 'product', product: p });
  });
  return cells;
}

function stockMeta(p) {
  if (p.stock <= 0) return { cls: 'out', label: 'Out of stock' };
  if (p.stock <= p.reorderPoint) return { cls: 'low', label: `Low · ${p.stock} ${p.unit}` };
  return { cls: '', label: `${p.stock} ${p.unit}` };
}

function getSellGridProfile() {
  const catalog = $('.catalog');
  const width = catalog?.clientWidth || window.innerWidth || 1200;
  const viewport = window.innerWidth || width;
  const presets = (viewport <= 720 || width <= 520)
    ? {
        sm: { columns: 2, rows: 5 },
        md: { columns: 2, rows: 4 },
        lg: { columns: 1, rows: 4 },
      }
    : width <= 1100
      ? {
          sm: { columns: 5, rows: 6 },
          md: { columns: 4, rows: 5 },
          lg: { columns: 3, rows: 4 },
        }
      : {
          sm: { columns: 6, rows: 5 },
          md: { columns: 5, rows: 4 },
          lg: { columns: 4, rows: 4 },
        };
  return presets[state.tileSize] || presets.md;
}

function sellPageSize(profile = getSellGridProfile()) {
  return Math.max(1, profile.columns * profile.rows);
}

function totalPages(cells = getSellCells()) {
  return Math.max(1, Math.ceil(cells.length / sellPageSize()));
}

function clampPage(cells = getSellCells()) {
  const max = totalPages(cells);
  if (state.page > max) state.page = max;
  if (state.page < 1) state.page = 1;
}

function renderSellCellHtml(cell) {
  if (cell.kind === 'back') {
    return `
      <div class="product-card pc-back" data-act="back" title="Back">
        <div class="pc-back-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 6 9 12 15 18"/>
          </svg>
        </div>
        <div class="pc-name">Back</div>
      </div>`;
  }
  if (cell.kind === 'group') {
    const g = cell.group;
    return `
      <div class="product-card pc-group" data-group-id="${g.id}" title="${escapeHtml(g.name)}">
        <div class="pc-group-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
          <span>${cell.memberCount}</span>
        </div>
        <div class="pc-name">${escapeHtml(g.name)}</div>
      </div>`;
  }
  const p = cell.product;
  const disabled = p.stock <= 0 ? 'data-disabled="true"' : '';
  return `
    <div class="product-card" data-id="${p.id}" ${disabled}>
      <div class="pc-name">${escapeHtml(p.name)}</div>
      <div class="pc-price-mini">${peso(p.price)}</div>
    </div>`;
}

function updateProductTrackPosition() {
  const track = $('#productTrack');
  if (track) {
    track.style.transform = `translate3d(-${(state.page - 1) * 100}%, 0, 0)`;
  }
  renderPager();
  renderSellHeader();
}

function renderProducts() {
  const grid = $('#productGrid');
  const cells = getSellCells();
  const profile = getSellGridProfile();

  // Set size + price-display attrs on the grid
  grid.dataset.size = state.tileSize;
  grid.classList.toggle('show-price', state.showPrice);
  grid.style.setProperty('--grid-cols', profile.columns);
  grid.style.setProperty('--grid-rows', profile.rows);

  if (cells.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <svg class="nr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/>
        </svg>
        <div class="nr-title">No items found</div>
        <div class="nr-sub">Try a different keyword or pick another folder</div>
      </div>`;
    renderPager();
    renderSellHeader();
    requestAnimationFrame(syncSellGridMetrics);
    return;
  }

  clampPage(cells);
  const pageSize = sellPageSize(profile);
  const pages = [];
  for (let i = 0; i < cells.length; i += pageSize) {
    pages.push(cells.slice(i, i + pageSize));
  }

  grid.innerHTML = `
    <div class="product-page-track" id="productTrack">
      ${pages.map((pageCells, index) => `
        <div class="product-page" data-page="${index + 1}">
          ${pageCells.map(renderSellCellHtml).join('')}
        </div>`).join('')}
    </div>`;

  renderPager();
  renderSellHeader();
  requestAnimationFrame(() => {
    syncSellGridMetrics();
    updateProductTrackPosition();
  });
}

function syncSellGridMetrics() {
  const catalog = $('.catalog');
  const grid = $('#productGrid');
  const search = $('#catalogSearchRow');
  if (!catalog || !grid || !search || state.view !== 'sell') return;

  const profile = getSellGridProfile();
  const gap = parseFloat(getComputedStyle(grid).gap) || 6;
  const styles = getComputedStyle(catalog);
  const catalogRect = catalog.getBoundingClientRect();
  const searchRect = search.getBoundingClientRect();
  const paddingBottom = parseFloat(styles.paddingBottom || 0);
  const rowGap = parseFloat(styles.gap || 0);
  const measuredHeight = catalogRect.bottom - paddingBottom - searchRect.bottom - rowGap;
  const fallbackHeight = catalog.clientHeight - search.offsetHeight - parseFloat(styles.paddingTop || 0) - paddingBottom - rowGap;
  const available = Math.max(120, Math.floor(measuredHeight || fallbackHeight));
  const rows = profile.rows;
  const columns = profile.columns;
  const tileHeight = Math.max(1, (available - gap * (rows - 1)) / rows);
  const fullTileWidth = Math.max(1, (grid.clientWidth - gap * (columns - 1)) / columns);
  const tileWidth = Math.min(fullTileWidth, tileHeight * 1.12);
  grid.style.setProperty('--grid-cols', profile.columns);
  grid.style.setProperty('--grid-rows', rows);
  grid.style.setProperty('--grid-h', `${available}px`);
  grid.style.setProperty('--tile-h', `${tileHeight.toFixed(2)}px`);
  grid.style.setProperty('--tile-w', `${tileWidth.toFixed(2)}px`);
  grid.style.setProperty('--visible-rows', rows);
}

function openGroup(groupId) {
  if (!groupById(groupId)) return;
  state.activeGroupId = groupId;
  state.page = 1;
  renderProducts();
  renderSellHeader();
}
function closeGroup() {
  state.activeGroupId = null;
  state.page = 1;
  renderProducts();
  renderSellHeader();
}

// ---------- Variant picker modal ----------
function openVariantModal(groupId) {
  const g = groupById(groupId);
  if (!g) return;
  const members = groupMembers(g.id);
  if (members.length === 0) { showToast('No variants in this group'); return; }

  // Preselect the first in-stock variant (or first if none in stock)
  const firstAvail = members.find(p => p.stock > 0) || members[0];

  state.variantModal = {
    groupId: g.id,
    selectedId: firstAvail.id,
    qty: 1,
    comment: '',
  };

  $('#variantTitle').textContent = g.name;
  $('#variantBasePrice').textContent = peso(firstAvail.price);
  $('#variantQtyInput').value = '1';
  $('#variantCommentInput').value = '';

  renderVariantGrid();
  $('#variantModal').hidden = false;
}

function renderVariantGrid() {
  const grid = $('#variantGrid');
  if (!grid) return;
  const members = groupMembers(state.variantModal.groupId);
  grid.innerHTML = members.map(p => {
    const sel = state.variantModal.selectedId === p.id ? 'selected' : '';
    const out = p.stock <= 0 ? 'out' : '';
    const priceLabel = p.stock <= 0 ? 'Out of stock' : peso(p.price);
    return `
      <button class="variant-tile ${sel} ${out}" data-variant-id="${p.id}" ${p.stock <= 0 ? 'data-disabled="true"' : ''}>
        <span class="vt-name">${escapeHtml(p.name)}</span>
        <span class="vt-price">${priceLabel}</span>
      </button>`;
  }).join('');
}

function selectVariant(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  state.variantModal.selectedId = id;
  $('#variantBasePrice').textContent = peso(p.price);
  renderVariantGrid();
}

function changeVariantQty(delta) {
  const input = $('#variantQtyInput');
  let q = parseInt(input.value, 10) || 1;
  q = Math.max(1, q + delta);
  input.value = q;
  state.variantModal.qty = q;
}

function addVariantToCart() {
  const vm = state.variantModal;
  if (!vm.selectedId) { showToast('Pick a variant first'); return; }
  const p = state.products.find(x => x.id === vm.selectedId);
  if (!p) return;
  if (p.stock <= 0) { showToast('Variant is out of stock'); return; }

  const qty = Math.max(1, parseInt($('#variantQtyInput').value, 10) || 1);
  const comment = $('#variantCommentInput').value.trim();

  const existing = state.cart.find(i => i.id === p.id && (i.comment || '') === comment);
  if (existing) existing.qty += qty;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty,
    comment: comment || undefined,
  });

  renderCart();
  showToast(`Added · ${qty} × ${p.name}`);
  $('#variantModal').hidden = true;
}

function renderPager() {
  const total = totalPages();
  const label = $('#bbPageLabel');
  if (label) label.textContent = `PAGE ${state.page} / ${total}`;
  const prev = $('#bbPrevBtn');
  const next = $('#bbNextBtn');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= total;

  // Page dots (cap at 7 visible)
  const dots = $('#bbPageDots');
  if (dots) {
    const maxDots = Math.min(total, 7);
    let html = '';
    for (let i = 1; i <= maxDots; i++) {
      html += `<span class="bb-pagedot ${i === Math.min(state.page, maxDots) ? 'active' : ''}"></span>`;
    }
    dots.innerHTML = html;
  }
}

function changePage(delta) {
  const t = totalPages();
  const prev = state.page;
  state.page = Math.min(t, Math.max(1, state.page + delta));
  if (state.page !== prev) updateProductTrackPosition();
  else flashControl($('#productGrid'));
}

function setTileSize(size) {
  if (!ITEMS_PER_PAGE[size]) return;
  state.tileSize = size;
  state.page = 1;
  storageSet(STORAGE_TILE_SIZE, size);
  $$('.bb-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  renderProducts();
}

function toggleShowPrice() {
  state.showPrice = !state.showPrice;
  storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);
  renderProducts();
}

// ---------- Cart ----------
function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  if (p.stock <= 0) { showToast('Item is out of stock'); return; }
  const existing = state.cart.find(i => i.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty: 1,
  });
  renderCart();
  showToast(`Added · ${p.name}`);
}

function findProductByCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const byBarcode = state.products.find(p => p.barcode && String(p.barcode).trim() === code);
  if (byBarcode) return byBarcode;
  const lower = code.toLowerCase();
  return state.products.find(p => p.sku && String(p.sku).toLowerCase() === lower) || null;
}

function addProductByCode(rawCode, { source = 'barcode' } = {}) {
  const code = String(rawCode || '').trim();
  if (!code) return false;
  const product = findProductByCode(code);
  if (!product) {
    const message = source === 'camera'
      ? `No item found for ${code}`
      : 'No item found for that barcode or SKU';
    showBarcodeStatus(message);
    showToast(message);
    return false;
  }
  if (product.stock <= 0) {
    showBarcodeStatus('Item is out of stock');
    showToast('Item is out of stock');
    return false;
  }
  addToCart(product.id);
  const search = $('#searchInput');
  const clear = $('#searchClear');
  if (search) {
    search.value = '';
    state.query = '';
  }
  clear?.classList.remove('visible');
  renderProducts();
  if (source === 'camera') showBarcodeStatus(`Added ${product.name}`);
  return true;
}

function changeQty(id, delta) {
  const i = state.cart.find(x => x.id === id);
  if (!i) return;
  i.qty += delta;
  if (i.qty <= 0) state.cart = state.cart.filter(x => x.id !== id);
  renderCart();
}
function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
}
function clearCart() {
  state.cart = [];
  state.customer = null;
  state.cartDiscount = null;
  state.paymentMethod = 'cash';
  state.fulfilment = (state.settings && state.settings.defaultFulfilment) || 'pickup';
  state.deliveryAddress = '';
  state.deliveryLocation = null;
  renderCart();
  updateCustomerButton();
}

function showBarcodeStatus(message) {
  const el = $('#barcodeStatus');
  if (el) el.textContent = message;
}

function resetBarcodeDuplicateGuard() {
  barcodeScanner.lastValue = '';
  barcodeScanner.lastSeenAt = 0;
  barcodeScanner.recent.clear();
}

function handleScannedBarcode(rawCode, { source = 'camera', requireVisibleReset = false } = {}) {
  const code = String(rawCode || '').trim();
  if (!code) return false;

  const now = Date.now();
  if (requireVisibleReset && code === barcodeScanner.lastValue) {
    barcodeScanner.lastSeenAt = now;
    return false;
  }

  const previousScanAt = barcodeScanner.recent.get(code) || 0;
  if (now - previousScanAt < barcodeScanner.cooldownMs) {
    barcodeScanner.lastValue = code;
    barcodeScanner.lastSeenAt = now;
    return false;
  }

  barcodeScanner.lastValue = code;
  barcodeScanner.lastSeenAt = now;
  barcodeScanner.recent.set(code, now);
  for (const [recentCode, scannedAt] of barcodeScanner.recent) {
    if (now - scannedAt > barcodeScanner.cooldownMs * 4) {
      barcodeScanner.recent.delete(recentCode);
    }
  }

  const product = findProductByCode(code);
  const added = addProductByCode(code, { source });
  if (added && source === 'camera') {
    showBarcodeStatus(`Added ${product?.name || code}. Scan next item.`);
  }
  return added;
}

function stopBarcodeScanner() {
  barcodeScanner.active = false;
  barcodeScanner.detector = null;
  resetBarcodeDuplicateGuard();
  clearTimeout(barcodeScanner.timer);
  barcodeScanner.timer = 0;
  if (barcodeScanner.zxingControls && typeof barcodeScanner.zxingControls.stop === 'function') {
    try { barcodeScanner.zxingControls.stop(); } catch (_) {}
  }
  barcodeScanner.zxingControls = null;
  barcodeScanner.zxingReader = null;
  if (barcodeScanner.stream) {
    barcodeScanner.stream.getTracks().forEach(track => track.stop());
    barcodeScanner.stream = null;
  }
  const video = $('#barcodeVideo');
  if (video) video.srcObject = null;
}

async function createBarcodeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  const preferred = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
  try {
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = preferred.filter(format => supported.includes(format));
      return new window.BarcodeDetector(formats.length ? { formats } : undefined);
    }
    return new window.BarcodeDetector({ formats: preferred });
  } catch (_) {
    try { return new window.BarcodeDetector(); }
    catch (_) { return null; }
  }
}

function scheduleBarcodeScan(video) {
  if (!barcodeScanner.active || !barcodeScanner.detector) return;
  clearTimeout(barcodeScanner.timer);
  barcodeScanner.timer = setTimeout(async () => {
    if (!barcodeScanner.active || !barcodeScanner.detector) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await barcodeScanner.detector.detect(video);
        const value = codes && codes[0] && codes[0].rawValue;
        if (value) {
          handleScannedBarcode(value, { source: 'camera', requireVisibleReset: true });
        } else if (barcodeScanner.lastValue && Date.now() - barcodeScanner.lastSeenAt > 450) {
          barcodeScanner.lastValue = '';
        }
      }
    } catch (err) {
      console.warn('Barcode scan failed', err);
      showBarcodeStatus('Camera is open, but barcode decoding failed. Type the code below.');
    }
    scheduleBarcodeScan(video);
  }, 180);
}

function barcodeValueFromZxingResult(result) {
  if (!result) return '';
  if (typeof result.getText === 'function') return String(result.getText() || '').trim();
  return String(result.text || result.rawValue || result.value || '').trim();
}

function startZxingBarcodeScan(video) {
  const ZXing = window.ZXingBrowser;
  if (!ZXing || typeof ZXing.BrowserMultiFormatReader !== 'function') return false;
  try {
    const reader = new ZXing.BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 500,
    });
    barcodeScanner.zxingReader = reader;
    barcodeScanner.active = true;
    barcodeScanner.zxingControls = reader.scan(video, (result, err, controls) => {
      if (!barcodeScanner.active) return;
      const value = barcodeValueFromZxingResult(result);
      if (value) {
        handleScannedBarcode(value, { source: 'camera', requireVisibleReset: true });
      } else if (err && barcodeScanner.lastValue && Date.now() - barcodeScanner.lastSeenAt > 450) {
        barcodeScanner.lastValue = '';
      }
    });
    showBarcodeStatus('Scanning...');
    return true;
  } catch (err) {
    console.warn('ZXing barcode scan failed to start', err);
    barcodeScanner.zxingReader = null;
    barcodeScanner.zxingControls = null;
    return false;
  }
}

async function startBarcodeCamera() {
  const video = $('#barcodeVideo');
  if (!video) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showBarcodeStatus('Camera scanning needs HTTPS. Type the barcode or SKU below.');
    return;
  }
  try {
    showBarcodeStatus('Allow camera access, then point at the barcode.');
    const detector = await createBarcodeDetector();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    barcodeScanner.stream = stream;
    barcodeScanner.detector = detector;
    barcodeScanner.active = true;
    video.srcObject = stream;
    await video.play();
    if (detector) {
      showBarcodeStatus('Scanning...');
      scheduleBarcodeScan(video);
    } else if (startZxingBarcodeScan(video)) {
      showBarcodeStatus('Scanning...');
    } else {
      showBarcodeStatus('Camera is open. Barcode decoder unavailable, so type the barcode below.');
    }
  } catch (err) {
    console.warn('Camera unavailable', err);
    showBarcodeStatus('Camera was blocked or unavailable. Type the barcode or SKU below.');
    stopBarcodeScanner();
  }
}

function isCapacitorNativeRuntime() {
  const cap = window.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return ['ios', 'android'].includes(cap.getPlatform());
  } catch (_) {}
  return !!cap.Plugins;
}

function barcodeValueFromNativeResult(result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.ScanResult === 'string') return result.ScanResult;
  if (typeof result.scanResult === 'string') return result.scanResult;
  if (typeof result.content === 'string') return result.content;
  if (typeof result.value === 'string') return result.value;
  const first = Array.isArray(result.barcodes) ? result.barcodes[0] : null;
  return first?.rawValue || first?.displayValue || first?.value || '';
}

async function scanWithCapacitorBarcodePlugin() {
  if (!isCapacitorNativeRuntime()) return false;
  const plugins = window.Capacitor?.Plugins || {};
  const scanner = plugins.BarcodeScanner || window.BarcodeScanner;
  if (!scanner) return false;

  try {
    let result = null;
    if (typeof scanner.scanBarcode === 'function') {
      result = await scanner.scanBarcode({
        hint: 17,
        scanInstructions: 'Point the camera at the barcode',
        scanButton: false,
        scanText: 'Scan',
        cameraDirection: 1,
        scanOrientation: 3,
        android: { scanningLibrary: 'mlkit' },
        web: { showCameraSelection: false, scannerFPS: 12 },
      });
    } else if (typeof scanner.startScan === 'function') {
      if (typeof scanner.checkPermission === 'function') {
        const permission = await scanner.checkPermission({ force: true });
        if (permission?.granted === false) throw new Error('Camera permission was not granted.');
      }
      if (typeof scanner.hideBackground === 'function') scanner.hideBackground();
      try {
        result = await scanner.startScan();
      } finally {
        if (typeof scanner.showBackground === 'function') scanner.showBackground();
      }
    } else if (typeof scanner.scan === 'function') {
      result = await scanner.scan();
    } else {
      return false;
    }

    const value = barcodeValueFromNativeResult(result);
    if (!value) {
      showToast('Scan cancelled');
      return true;
    }
    addProductByCode(value, { source: 'camera' });
    return true;
  } catch (err) {
    console.warn('Native barcode scan failed', err);
    showToast('Barcode scanner unavailable. Use manual entry.');
    return false;
  }
}

async function openBarcodeScanner() {
  if (await scanWithCapacitorBarcodePlugin()) return;
  const modal = $('#barcodeModal');
  const input = $('#barcodeManualInput');
  if (!modal) return;
  stopBarcodeScanner();
  if (input) input.value = '';
  showBarcodeStatus('Starting camera...');
  modal.hidden = false;
  startBarcodeCamera();
  flashControl($('#scanBtn'));
}

function submitManualBarcode() {
  const input = $('#barcodeManualInput');
  const code = input?.value || '';
  if (addProductByCode(code, { source: 'manual' })) {
    const product = findProductByCode(code);
    showBarcodeStatus(`Added ${product?.name || 'item'}. Scan or type next item.`);
    if (input) {
      input.value = '';
      input.focus({ preventScroll: true });
    }
  } else {
    input?.focus({ preventScroll: true });
    input?.select();
  }
}

// ---------- Cart item edit modal ----------
function openCartItemModal(id) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  state.cartItemModal.id = id;
  $('#cimTitle').textContent = item.name;
  $('#cimSub').textContent = `${item.sku} · ${peso(item.price)} / ${item.unit}`;
  $('#cimQtyInput').value = item.qty;
  // Discount: prefill from existing item.discount
  const disc = item.discount || { type: 'amount', value: 0 };
  $$('#cartItemModal [data-cim-disc-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.cimDiscType === (disc.type || 'amount')));
  $('#cimDiscInput').value = disc.value ? String(disc.value) : '';
  updateCartItemModalLineTotal();
  $('#cartItemModal').hidden = false;
}
function changeCartItemModalQty(delta) {
  const input = $('#cimQtyInput');
  let q = parseInt(input.value, 10) || 1;
  q = Math.max(1, q + delta);
  input.value = q;
  updateCartItemModalLineTotal();
}
function getCartItemModalDiscount() {
  const typeBtn = document.querySelector('#cartItemModal [data-cim-disc-type].active');
  const type = typeBtn ? typeBtn.dataset.cimDiscType : 'amount';
  const value = parseFloat($('#cimDiscInput').value) || 0;
  return value > 0 ? { type, value } : null;
}
function updateCartItemModalLineTotal() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = Math.max(1, parseInt($('#cimQtyInput').value, 10) || 1);
  const gross = item.price * q;
  const disc = getCartItemModalDiscount();
  const { net } = applyDiscount(gross, disc);
  $('#cimLineTotal').textContent = peso(net);
}
function saveCartItemEdit() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = Math.max(1, parseInt($('#cimQtyInput').value, 10) || 1);
  item.qty = q;
  const disc = getCartItemModalDiscount();
  if (disc) item.discount = disc; else delete item.discount;
  renderCart();
  $('#cartItemModal').hidden = true;
}
function removeCartItemFromModal() {
  const id = state.cartItemModal.id;
  if (!id) return;
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
  $('#cartItemModal').hidden = true;
  showToast('Item removed');
}

// ---------- Cart-level discount modal ----------
function openCartDiscountModal() {
  if (state.cart.length === 0) {
    flashControl($('#cartDiscountBtn'));
    flashControl($('.cart'));
    return;
  }
  const cd = state.cartDiscount || { type: 'amount', value: 0 };
  $$('#cartDiscountModal [data-cd-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.cdType === (cd.type || 'amount')));
  $('#cdInput').value = cd.value ? String(cd.value) : '';
  $('#cartDiscountModal').hidden = false;
  setTimeout(() => $('#cdInput').focus(), 50);
}
function applyCartDiscount() {
  const typeBtn = document.querySelector('#cartDiscountModal [data-cd-type].active');
  const type = typeBtn ? typeBtn.dataset.cdType : 'amount';
  const value = parseFloat($('#cdInput').value) || 0;
  state.cartDiscount = value > 0 ? { type, value } : null;
  renderCart();
  $('#cartDiscountModal').hidden = true;
}
function clearCartDiscount() {
  state.cartDiscount = null;
  renderCart();
  $('#cartDiscountModal').hidden = true;
  flashControl($('#cartDiscountBtn'));
}

// ---------- Fulfilment (Pickup / Delivery) ----------
function setFulfilment(mode) {
  if (mode !== 'pickup' && mode !== 'delivery') return;
  if (mode === 'delivery') {
    // Address is optional; prefill it when we already know one.
    const addr = state.deliveryAddress || (state.customer && state.customer.address) || '';
    $('#deliveryAddrInput').value = addr;
    updateDeliveryPinStatus();
    $('#deliveryModal').hidden = false;
    return;
  }
  state.fulfilment = 'pickup';
  state.deliveryAddress = '';
  state.deliveryLocation = null;
  renderCart();
}
function saveDeliveryAddress() {
  const addr = $('#deliveryAddrInput').value.trim();
  state.fulfilment = 'delivery';
  state.deliveryAddress = addr;
  $('#deliveryModal').hidden = true;
  renderCart();
  flashControl(document.querySelector('.fulfil-pill[data-fulfil="delivery"]'));
}

function deliveryPinLabel(location = state.deliveryLocation) {
  const loc = normalizeDeliveryLocation(location);
  if (!loc) return 'No pin set';
  return `Pinned map location (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`;
}

function updateDeliveryPinStatus() {
  const el = $('#deliveryPinStatus');
  if (el) el.textContent = deliveryPinLabel();
}

function setDeliveryMapFromLocation(location = state.deliveryLocation) {
  const loc = normalizeDeliveryLocation(location);
  const base = loc || DELIVERY_MAP_DEFAULT;
  state.deliveryMap.centerLat = base.lat;
  state.deliveryMap.centerLng = base.lng;
  state.deliveryMap.zoom = loc?.zoom || DELIVERY_MAP_DEFAULT.zoom;
  state.deliveryMap.pinLat = loc?.lat ?? null;
  state.deliveryMap.pinLng = loc?.lng ?? null;
}

function deliveryMapWorldCenter() {
  return {
    x: lonToWorldX(state.deliveryMap.centerLng, state.deliveryMap.zoom),
    y: latToWorldY(state.deliveryMap.centerLat, state.deliveryMap.zoom),
  };
}

function setDeliveryMapCenterFromWorld(x, y) {
  state.deliveryMap.centerLng = worldXToLng(x, state.deliveryMap.zoom);
  state.deliveryMap.centerLat = worldYToLat(y, state.deliveryMap.zoom);
}

function renderDeliveryMap() {
  const stage = $('#deliveryMapStage');
  const tiles = $('#deliveryMapTiles');
  if (!stage || !tiles) return;
  const rect = stage.getBoundingClientRect();
  const width = Math.max(320, rect.width || 640);
  const height = Math.max(260, rect.height || 360);
  const zoom = state.deliveryMap.zoom;
  const center = deliveryMapWorldCenter();
  const minX = Math.floor((center.x - width / 2) / 256) - 1;
  const maxX = Math.floor((center.x + width / 2) / 256) + 1;
  const minY = Math.max(0, Math.floor((center.y - height / 2) / 256) - 1);
  const maxY = Math.min((2 ** zoom) - 1, Math.floor((center.y + height / 2) / 256) + 1);
  const imgs = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const left = Math.round(width / 2 + (x * 256 - center.x));
      const top = Math.round(height / 2 + (y * 256 - center.y));
      imgs.push(`<img src="${osmTileUrl(x, y, zoom)}" alt="" draggable="false" style="left:${left}px;top:${top}px" />`);
    }
  }
  tiles.innerHTML = imgs.join('');
  const pin = $('#deliveryMapPin');
  if (pin) pin.classList.toggle('is-hidden', state.deliveryMap.pinLat == null || state.deliveryMap.pinLng == null);
  const coords = $('#deliveryMapCoords');
  if (coords) coords.textContent = state.deliveryMap.pinLat == null
    ? 'No pin selected'
    : `Pinned road map location for receipt`;
}

function deliveryMapPointToLatLng(clientX, clientY) {
  const stage = $('#deliveryMapStage');
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const center = deliveryMapWorldCenter();
  const x = center.x + (clientX - rect.left - rect.width / 2);
  const y = center.y + (clientY - rect.top - rect.height / 2);
  return {
    lat: worldYToLat(y, state.deliveryMap.zoom),
    lng: worldXToLng(x, state.deliveryMap.zoom),
  };
}

function openDeliveryMap() {
  setDeliveryMapFromLocation(state.deliveryLocation);
  $('#deliveryMapModal').hidden = false;
  requestAnimationFrame(renderDeliveryMap);
  if (!state.deliveryLocation) tryUseDeviceDeliveryLocation({ quiet: true });
}

function setDeliveryMapPinAt(clientX, clientY) {
  const loc = deliveryMapPointToLatLng(clientX, clientY);
  if (!loc) return;
  state.deliveryMap.pinLat = clamp(loc.lat, -85.05112878, 85.05112878);
  state.deliveryMap.pinLng = clamp(loc.lng, -180, 180);
  state.deliveryMap.centerLat = state.deliveryMap.pinLat;
  state.deliveryMap.centerLng = state.deliveryMap.pinLng;
  renderDeliveryMap();
}

function zoomDeliveryMap(delta) {
  state.deliveryMap.zoom = clamp(state.deliveryMap.zoom + delta, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  renderDeliveryMap();
}

function zoomDeliveryMapAt(delta, clientX, clientY) {
  const stage = $('#deliveryMapStage');
  if (!stage || !delta) return;
  const before = deliveryMapPointToLatLng(clientX, clientY);
  if (!before) return;
  state.deliveryMap.zoom = clamp(state.deliveryMap.zoom + delta, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  const rect = stage.getBoundingClientRect();
  const afterX = lonToWorldX(before.lng, state.deliveryMap.zoom);
  const afterY = latToWorldY(before.lat, state.deliveryMap.zoom);
  setDeliveryMapCenterFromWorld(
    afterX - (clientX - rect.left - rect.width / 2),
    afterY - (clientY - rect.top - rect.height / 2)
  );
  renderDeliveryMap();
}

function deliveryTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function deliveryTouchMidpoint(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function beginDeliveryPinch(e) {
  if (!e.touches || e.touches.length !== 2) return;
  const mid = deliveryTouchMidpoint(e.touches);
  const focus = deliveryMapPointToLatLng(mid.x, mid.y);
  state.deliveryMap.drag = null;
  state.deliveryMap.pinch = {
    distance: deliveryTouchDistance(e.touches),
    zoom: state.deliveryMap.zoom,
    focusLat: focus?.lat ?? state.deliveryMap.centerLat,
    focusLng: focus?.lng ?? state.deliveryMap.centerLng,
    midX: mid.x,
    midY: mid.y,
  };
}

function updateDeliveryPinch(e) {
  const pinch = state.deliveryMap.pinch;
  if (!pinch || !e.touches || e.touches.length !== 2) return;
  e.preventDefault();
  const ratio = deliveryTouchDistance(e.touches) / Math.max(1, pinch.distance);
  const steps = Math.round(Math.log2(Math.max(0.25, Math.min(4, ratio))));
  const nextZoom = clamp(pinch.zoom + steps, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  if (nextZoom === state.deliveryMap.zoom) return;
  state.deliveryMap.zoom = nextZoom;
  const stage = $('#deliveryMapStage');
  const rect = stage.getBoundingClientRect();
  const mid = deliveryTouchMidpoint(e.touches);
  const focusX = lonToWorldX(pinch.focusLng, state.deliveryMap.zoom);
  const focusY = latToWorldY(pinch.focusLat, state.deliveryMap.zoom);
  setDeliveryMapCenterFromWorld(
    focusX - (mid.x - rect.left - rect.width / 2),
    focusY - (mid.y - rect.top - rect.height / 2)
  );
  renderDeliveryMap();
}

function endDeliveryPinch(e) {
  if (!state.deliveryMap.pinch) return;
  if (!e.touches || e.touches.length < 2) state.deliveryMap.pinch = null;
}

function saveDeliveryMapPin() {
  if (state.deliveryMap.pinLat == null || state.deliveryMap.pinLng == null) {
    showToast('Tap the map to set a pin');
    return;
  }
  state.deliveryLocation = normalizeDeliveryLocation({
    lat: state.deliveryMap.pinLat,
    lng: state.deliveryMap.pinLng,
    zoom: state.deliveryMap.zoom,
    provider: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
  });
  $('#deliveryMapModal').hidden = true;
  updateDeliveryPinStatus();
  renderCart();
}

function clearDeliveryMapPin() {
  state.deliveryMap.pinLat = null;
  state.deliveryMap.pinLng = null;
  state.deliveryLocation = null;
  updateDeliveryPinStatus();
  renderDeliveryMap();
  renderCart();
}

function tryUseDeviceDeliveryLocation({ quiet = false } = {}) {
  if (!navigator.geolocation) {
    if (!quiet) showToast('Device location is unavailable');
    return;
  }
  if (!quiet) showToast('Getting location...');
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    state.deliveryMap.centerLat = lat;
    state.deliveryMap.centerLng = lng;
    state.deliveryMap.pinLat = lat;
    state.deliveryMap.pinLng = lng;
    state.deliveryMap.zoom = Math.max(state.deliveryMap.zoom, 18);
    renderDeliveryMap();
  }, () => {
    if (!quiet) showToast('Location permission was blocked');
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

function useDeviceDeliveryLocation() {
  tryUseDeviceDeliveryLocation({ quiet: false });
}

// ---------- Saved customer modal ----------
function openCustomerEditModal() {
  $('#customerEditTitle').textContent = 'New customer';
  $('#custName').value = '';
  $('#custPhone').value = '';
  $('#custAddress').value = '';
  $('#customerEditModal').hidden = false;
  setTimeout(() => $('#custName').focus(), 50);
}
function saveSavedCustomerFromModal() {
  const name = $('#custName').value.trim();
  const phone = $('#custPhone').value.trim();
  const address = $('#custAddress').value.trim();
  if (!name) { showToast('Name is required'); $('#custName').focus(); return; }
  const c = {
    id: 'cust_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3),
    name, phone, address,
    creditLimit: 0,
    currentBalance: 0,
  };
  state.customers.push(c);
  saveSavedCustomers();
  $('#customerEditModal').hidden = true;
  if (state.view === 'customers') renderCustomers();
  showToast(`Added “${name}”`);
}
// Apply a discount {type:'amount'|'percent', value:number} to a gross amount.
function applyDiscount(gross, disc) {
  if (!disc || !disc.value) return { net: gross, off: 0 };
  if (disc.type === 'percent') {
    const off = Math.min(gross, gross * (Number(disc.value) / 100));
    return { net: gross - off, off };
  }
  const off = Math.min(gross, Number(disc.value) || 0);
  return { net: gross - off, off };
}

function cartTotals() {
  let lineGross = 0;
  let lineDiscount = 0;
  for (const i of state.cart) {
    const g = i.price * i.qty;
    const { off } = applyDiscount(g, i.discount);
    lineGross += g;
    lineDiscount += off;
  }
  const subtotal = lineGross - lineDiscount;
  const cartDisc = applyDiscount(subtotal, state.cartDiscount);
  const grandTotal = cartDisc.net;
  const totalDiscount = lineDiscount + cartDisc.off;
  // VAT-inclusive (Philippine 12%): the displayed prices already include VAT.
  const vatRate = (typeof state.vatRate === 'number') ? state.vatRate : 0.12;
  const vatAmount = vatRate > 0 ? grandTotal * (vatRate / (1 + vatRate)) : 0;
  const vatableSales = grandTotal - vatAmount;
  return {
    subtotal: lineGross,
    discount: totalDiscount,
    cartDiscountOff: cartDisc.off,
    lineDiscountOff: lineDiscount,
    total: grandTotal,
    vatRate,
    vatAmount,
    vatableSales,
  };
}

function renderCart() {
  const list = $('#cartList');
  const t = cartTotals();
  if (state.cart.length === 0) {
    list.innerHTML = '';
  } else {
    list.innerHTML = state.cart.map(item => `
      <button class="cart-item" data-id="${item.id}" title="Edit item">
        <div class="ci-main">
          <div class="ci-name">${escapeHtml(item.name)}</div>
          <div class="ci-sub">${escapeHtml(item.sku)} · ${peso(item.price)}${item.qty > 1 ? ` × ${item.qty}` : ''}</div>
        </div>
        <div class="ci-right">${peso(item.price * item.qty)}</div>
      </button>
    `).join('');
  }

  $('#cartCount').textContent = `${state.cart.reduce((s, i) => s + i.qty, 0)} items`;
  $('#subtotal').textContent = peso(t.subtotal);
  $('#discount').textContent = '-' + peso(t.discount);
  const discRow = $('#discountRow'); if (discRow) discRow.style.display = t.discount > 0 ? '' : 'none';
  const vatEl = $('#vatAmount'); if (vatEl) vatEl.textContent = peso(t.vatAmount);
  $('#total').textContent = peso(t.total);
  const pa = $('#payAmount'); if (pa) pa.textContent = peso(t.total);
  const payBtn = $('#payBtn');
  if (payBtn) {
    payBtn.disabled = state.cart.length === 0;
    payBtn.textContent = 'Check out';
  }
  const sb = $('#saveBtn'); if (sb) sb.disabled = state.cart.length === 0;

  // Fulfilment pills + discount label
  $$('.fulfil-pill').forEach(b => b.classList.toggle('active', b.dataset.fulfil === state.fulfilment));
  const deliveryBtn = document.querySelector('.fulfil-pill[data-fulfil="delivery"] span');
  if (deliveryBtn) deliveryBtn.textContent = 'Delivery';
  $('#cartDiscountBtn')?.classList.toggle('active', !!(state.cartDiscount && state.cartDiscount.value));
  const cdLabel = $('#cartDiscountLabel');
  if (cdLabel) {
    if (state.cartDiscount && state.cartDiscount.value) {
      cdLabel.textContent = state.cartDiscount.type === 'percent'
        ? `${state.cartDiscount.value}% off`
        : `${peso(state.cartDiscount.value)} off`;
    } else {
      cdLabel.textContent = 'Discount';
    }
  }
}

// ---------- Customer ----------
function updateCustomerButton() {
  const btn = $('#customerBtn');
  const label = $('#customerLabel');
  if (state.customer) {
    btn.classList.add('has-customer');
    label.textContent = `${state.customer.name} · ${peso(state.customer.currentBalance)}`;
  } else {
    btn.classList.remove('has-customer');
    label.textContent = 'Walk-in customer';
  }
}
function allCustomerRecords() {
  // Saved customers first, then seeded credit accounts (de-duped by id).
  const seen = new Set();
  const out = [];
  for (const c of state.customers || []) { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  for (const c of (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : [])) { if (!seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  return out;
}
function renderCustomerPicker() {
  const list = $('#customerList');
  const all = allCustomerRecords();
  list.innerHTML = all.map(c => `
    <button class="customer-row-btn" data-customer-id="${c.id}">
      <div class="cust-avatar">${escapeHtml(c.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
      <div class="cust-meta">
        <div class="cust-name">${escapeHtml(c.name)}</div>
        <div class="cust-sub">${escapeHtml(c.phone || '')}${c.address ? ' · ' + escapeHtml(c.address) : ''}</div>
      </div>
      <div class="cust-balance ${c.currentBalance > 0 ? 'has' : ''}">${peso(c.currentBalance || 0)}</div>
    </button>
  `).join('');
}
function openCustomerModal() { renderCustomerPicker(); $('#customerModal').hidden = false; }
function selectCustomer(id) {
  if (id === 'walk-in') {
    state.customer = null;
  } else {
    state.customer = allCustomerRecords().find(c => c.id === id) || null;
    // If the customer has an address and we're set to delivery, prefill.
    if (state.customer && state.customer.address && state.fulfilment === 'delivery') {
      state.deliveryAddress = state.customer.address;
    }
  }
  updateCustomerButton();
  $('#customerModal').hidden = true;
  renderCart();
  if (state.view === 'checkout') renderCheckout();
}

// ---------- Payment (full-page Checkout view) ----------
function openPaymentModal() {
  if (state.cart.length === 0) return;
  state.prevView = state.view;
  switchView('checkout');
  renderCheckout();
  if (state.paymentMethod === 'cash') setTimeout(() => $('#checkoutTender')?.focus(), 60);
}
function renderCheckout() {
  const { total } = cartTotals();
  $('#checkoutTotal').textContent = peso(total);
  setCheckoutError('');
  renderQuickCashOptions(total);
  if (!state.customer && (state.paymentMethod === 'credit' || state.paymentMethod === 'split')) {
    state.paymentMethod = 'cash';
  }
  state.paymentMethod = state.paymentMethod || 'cash';
  $$('[data-co-method]').forEach(s => s.classList.toggle('active', s.dataset.method === state.paymentMethod));
  $$('.seg[data-method]').forEach(s => s.classList.toggle('active', s.dataset.method === state.paymentMethod));
  syncPayFields();
  $('#checkoutTender').value = '';
  $('#checkoutChange').textContent = peso(0);
  const sub = $('#checkoutSub');
  if (sub) {
    if (state.paymentMethod === 'split' && state.customer) sub.textContent = `Cash + charge to ${state.customer.name}`;
    else if (state.paymentMethod === 'credit' && state.customer) sub.textContent = `Charge to ${state.customer.name}`;
    else sub.textContent = 'Walk-in customer';
  }
  const fl = $('#checkoutFulfilLine');
  if (fl) {
    if (state.fulfilment === 'delivery') {
      fl.textContent = state.deliveryAddress ? `Delivery · ${state.deliveryAddress}` : 'Delivery';
    } else {
      fl.textContent = 'Pickup';
    }
  }
}
function syncPayFields() {
  const cash = $('#checkoutCashFields');
  if (cash) cash.style.display = state.paymentMethod === 'credit' ? 'none' : '';
  const tenderLabel = $('#checkoutCashFields .checkout-section-label');
  if (tenderLabel) tenderLabel.textContent = state.paymentMethod === 'split' ? 'Cash amount' : 'Amount tendered';
  const changeLabel = $('.checkout-change-row span:first-child');
  if (changeLabel) changeLabel.textContent = state.paymentMethod === 'split' ? 'Balance' : 'Change';
  // Legacy modal fields (kept for back-compat) — hide block if it exists
  const payFields = $('#payFields');
  if (payFields) payFields.style.display = state.paymentMethod === 'credit' ? 'none' : '';
}
function updateChange() {
  const { total } = cartTotals();
  const tender = parseFloat($('#checkoutTender')?.value || $('#tenderInput')?.value || 0) || 0;
  const out = state.paymentMethod === 'split'
    ? Math.max(0, total - tender)
    : Math.max(0, tender - total);
  const co = $('#checkoutChange'); if (co) co.textContent = peso(out);
  const legacy = $('#changeValue'); if (legacy) legacy.textContent = peso(out);
  setCheckoutError('');
}

function roundedTenderOptions(total) {
  const due = Math.max(0, Number(total) || 0);
  if (due <= 0) return [];
  let first;
  if (due <= 500) first = Math.ceil(due / 50) * 50;
  else if (due <= 1000) first = Math.ceil(due / 100) * 100;
  else if (due <= 5000) first = Math.ceil(due / 500) * 500;
  else first = Math.ceil(due / 1000) * 1000;
  const bills = [50, 100, 200, 500, 1000, 2000, 5000, 10000].filter(v => v >= due);
  return Array.from(new Set([first, ...bills])).filter(v => v >= due && v > 0).slice(0, 3);
}

function renderQuickCashOptions(total) {
  const wrap = $('.checkout-quick');
  if (!wrap) return;
  const options = roundedTenderOptions(total);
  wrap.innerHTML = [
    '<button data-co-cash="exact">Exact</button>',
    ...options.map(v => `<button data-co-cash="${v}">${peso(v)}</button>`),
  ].join('');
}

function buildOrderRecord({ status = 'completed', paymentMethod = state.paymentMethod, tendered = 0, change = 0, customerOverride } = {}) {
  const totals = cartTotals();
  const store = currentStoreInfo();
  const customer = customerOverride === undefined ? state.customer : customerOverride;
  return normalizeOrderRecord({
    id: orderUid(),
    number: nextOrderNumber(),
    ts: Date.now(),
    status,
    cashier: store.cashier,
    register: store.registerNo,
    items: state.cart.map(i => ({ ...i })),
    customer: customer
      ? { id: customer.id, name: customer.name, phone: customer.phone || '', address: customer.address || '' }
      : null,
    paymentMethod,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cartDiscount: state.cartDiscount ? { ...state.cartDiscount } : null,
    total: totals.total,
    tendered,
    change,
    payments: buildOrderPayments({ status, paymentMethod, total: totals.total, tendered, change }),
    vatRate: totals.vatRate,
    vatAmount: totals.vatAmount,
    vatableSales: totals.vatableSales,
    fulfilment: state.fulfilment || 'pickup',
    deliveryAddress: state.fulfilment === 'delivery' ? state.deliveryAddress : '',
    deliveryLocation: state.fulfilment === 'delivery' ? state.deliveryLocation : null,
  });
}

function persistOrder(order) {
  let normalized = normalizeOrderRecord(order);
  const latest = loadOrders();
  if (latest.some(o => o.number === normalized.number && o.id !== normalized.id)) {
    normalized = normalizeOrderRecord({ ...normalized, number: nextOrderNumber() });
  }
  const nextOrders = [normalized, ...latest.filter(o => o.id !== normalized.id)];
  if (!saveOrdersList(nextOrders)) {
    throw new Error('Receipt could not be saved.');
  }
  state.orders = nextOrders;
  state.selectedOrderId = normalized.id;
  return normalized;
}

function saveOrderMutation(order) {
  const normalized = normalizeOrderRecord(order);
  const latest = loadOrders();
  const nextOrders = latest.map(o => o.id === normalized.id ? normalized : o);
  if (!nextOrders.some(o => o.id === normalized.id)) nextOrders.unshift(normalized);
  if (!saveOrdersList(nextOrders)) throw new Error('Order update could not be saved.');
  state.orders = nextOrders;
  return normalized;
}

function restoreOrderStock(order) {
  (order.items || []).forEach(item => {
    const p = state.products.find(product => product.id === item.id || product.id === item.productId);
    if (p) p.stock = toNumber(p.stock, 0) + toNumber(item.qty, 0);
  });
  saveProducts();
}

function addCustomerLedgerEntry(entry) {
  const record = {
    id: entry.id || `led_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ts: toNumber(entry.ts, Date.now()),
    customerId: String(entry.customerId || ''),
    customerName: String(entry.customerName || ''),
    type: entry.type === 'payment' ? 'payment' : 'charge',
    amount: moneyValue(entry.amount),
    orderId: entry.orderId ? String(entry.orderId) : '',
    note: entry.note ? String(entry.note) : '',
  };
  if (!record.customerId || record.amount <= 0) return null;
  state.customerLedger = [record, ...loadCustomerLedger()];
  saveCustomerLedger();
  return record;
}

function showOrderAfterCartClears(order) {
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  state.selectedOrderId = order.id;
  switchView('orders');
  renderOrders();
}

function showCheckoutSuccess(order) {
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  const total = $('#successTotal');
  const sub = $('#successSub');
  const preview = $('#successReceiptPreview');
  if (total) total.textContent = peso(order.total);
  if (sub) sub.textContent = `Receipt #${order.number} saved`;
  if (preview) preview.innerHTML = buildReceiptPreview(order);
  switchView('checkout-success');
  clearTimeout(showCheckoutSuccess._t);
  showCheckoutSuccess._orderId = order.id;
}

function currentSuccessOrder() {
  const id = showCheckoutSuccess._orderId;
  if (!id) return null;
  state.orders = loadOrders();
  return state.orders.find(order => order.id === id) || null;
}

function printSuccessReceipt() {
  const order = currentSuccessOrder();
  if (!order) {
    showToast('No receipt to print');
    return;
  }
  openReceipt(order);
}

function startNewSaleFromSuccess() {
  clearTimeout(showCheckoutSuccess._t);
  showCheckoutSuccess._orderId = null;
  switchView('sell');
  renderProducts();
}

function draftReceiptCustomerFromName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = allCustomerRecords().find(c => c.name && c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      phone: existing.phone || '',
      address: existing.address || '',
    };
  }
  return {
    id: 'draft_' + Date.now().toString(36),
    name: trimmed,
    phone: '',
    address: '',
  };
}

function openSaveReceiptModal() {
  if (state.cart.length === 0) return;
  const input = $('#saveReceiptNameInput');
  if (input) {
    input.value = state.customer?.name || '';
  }
  const modal = $('#saveReceiptModal');
  if (modal) modal.hidden = false;
}

function saveReceiptFromModal() {
  const input = $('#saveReceiptNameInput');
  const customerOverride = draftReceiptCustomerFromName(input?.value || '');
  const modal = $('#saveReceiptModal');
  if (modal) modal.hidden = true;
  saveCurrentReceipt(customerOverride);
}

function saveCurrentReceipt(customerOverride = null) {
  if (state.cart.length === 0) return;
  try {
    const order = persistOrder(buildOrderRecord({
      status: 'saved',
      paymentMethod: 'unpaid',
      tendered: 0,
      change: 0,
      customerOverride,
    }));
    showOrderAfterCartClears(order);
  } catch (err) {
    console.error(err);
    showToast('Receipt was not saved. Check browser storage.');
    flashControl($('#saveBtn'));
  }
}

function applyCreditBalance(order) {
  const creditAmount = (order.payments || [])
    .filter(p => p.method === 'credit')
    .reduce((sum, p) => sum + p.amount, 0);
  if (creditAmount <= 0 || !order.customer) return;
  const id = order.customer.id;
  const all = allCustomerRecords();
  const existing = state.customers.find(c => c.id === id);
  const base = existing || all.find(c => c.id === id) || order.customer;
  const next = {
    ...base,
    id,
    name: base.name || order.customer.name,
    phone: base.phone || order.customer.phone || '',
    address: base.address || order.customer.address || '',
    creditLimit: toNumber(base.creditLimit, 0),
    currentBalance: moneyValue(toNumber(base.currentBalance, 0) + creditAmount),
  };
  const i = state.customers.findIndex(c => c.id === id);
  if (i >= 0) state.customers[i] = next;
  else state.customers.push(next);
  saveSavedCustomers();
  addCustomerLedgerEntry({
    customerId: next.id,
    customerName: next.name,
    type: 'charge',
    amount: creditAmount,
    orderId: order.id,
    note: `Charge from receipt ${order.number}`,
  });
}

function adjustCustomerBalance(customer, delta) {
  if (!customer || !customer.id || !delta) return null;
  const all = allCustomerRecords();
  const existing = state.customers.find(c => c.id === customer.id);
  const base = existing || all.find(c => c.id === customer.id) || customer;
  const next = {
    ...base,
    id: customer.id,
    name: base.name || customer.name || 'Customer',
    phone: base.phone || customer.phone || '',
    address: base.address || customer.address || '',
    creditLimit: toNumber(base.creditLimit, 0),
    currentBalance: Math.max(0, moneyValue(toNumber(base.currentBalance, 0) + delta)),
  };
  const i = state.customers.findIndex(c => c.id === next.id);
  if (i >= 0) state.customers[i] = next;
  else state.customers.push(next);
  saveSavedCustomers();
  return next;
}

function recordCreditPayment(customerId, amount, note = '') {
  const customer = allCustomerRecords().find(c => c.id === customerId);
  const value = moneyValue(amount);
  if (!customer || value <= 0) return null;
  const next = adjustCustomerBalance(customer, -value);
  addCustomerLedgerEntry({
    customerId,
    customerName: next.name,
    type: 'payment',
    amount: value,
    note: note || 'Customer payment',
  });
  renderCustomers();
  updateCustomerButton();
  return next;
}

function reverseOrderCredit(order, reason) {
  const creditAmount = (order.payments || [])
    .filter(p => p.method === 'credit')
    .reduce((sum, p) => sum + toNumber(p.amount, 0), 0);
  if (creditAmount <= 0 || !order.customer) return;
  const next = adjustCustomerBalance(order.customer, -creditAmount);
  addCustomerLedgerEntry({
    customerId: next.id,
    customerName: next.name,
    type: 'payment',
    amount: creditAmount,
    orderId: order.id,
    note: reason || `Reversal for receipt ${order.number}`,
  });
}

function requireManagerAction(actionLabel = 'This action') {
  if (state.role === 'manager') return true;
  showToast(`${actionLabel} needs manager role`);
  return false;
}

function voidOrder(orderId, reason = 'Voided by manager') {
  if (!requireManagerAction('Void sale')) return null;
  const order = loadOrders().find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  restoreOrderStock(order);
  reverseOrderCredit(order, reason);
  const updated = saveOrderMutation({
    ...order,
    status: 'voided',
    reason,
    voidedAt: Date.now(),
  });
  renderOrders();
  renderReports();
  return updated;
}

function refundOrder(orderId, reason = 'Refunded by manager') {
  if (!requireManagerAction('Refund sale')) return null;
  const order = loadOrders().find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  restoreOrderStock(order);
  reverseOrderCredit(order, reason);
  const updated = saveOrderMutation({
    ...order,
    status: 'refunded',
    reason,
    refundedAt: Date.now(),
  });
  renderOrders();
  renderReports();
  return updated;
}

function recordReturn(orderId, reason = 'Returned items') {
  if (!requireManagerAction('Return sale')) return null;
  const order = loadOrders().find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  restoreOrderStock(order);
  reverseOrderCredit(order, reason);
  const returnOrder = persistOrder({
    ...order,
    id: orderUid(),
    number: nextOrderNumber(),
    ts: Date.now(),
    status: 'return',
    originalOrderId: order.id,
    reason,
    returnedAt: Date.now(),
    paymentMethod: 'cash',
    payments: [{ method: 'cash', label: 'Return', amount: moneyValue(order.total), tendered: 0, change: 0, ref: order.number }],
  });
  renderOrders();
  renderReports();
  return returnOrder;
}

function exchangeOrder(orderId, replacementItems = [], reason = 'Exchange') {
  if (!requireManagerAction('Exchange sale')) return null;
  const order = loadOrders().find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  const replacements = (replacementItems || [])
    .map(item => {
      const product = state.products.find(p => p.id === item.id || p.id === item.productId);
      const qty = Math.max(1, parseInt(item.qty, 10) || 1);
      if (!product || product.stock < qty) return null;
      return {
        id: product.id,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit || 'pc',
        qty,
        price: moneyValue(item.price ?? product.price),
      };
    })
    .filter(Boolean);
  if (!replacements.length) return null;

  restoreOrderStock(order);
  reverseOrderCredit(order, reason);
  const original = saveOrderMutation({
    ...order,
    status: 'refunded',
    reason,
    refundedAt: Date.now(),
  });

  replacements.forEach(item => {
    const product = state.products.find(p => p.id === item.id);
    if (product) product.stock = Math.max(0, toNumber(product.stock, 0) - item.qty);
  });
  saveProducts();
  const subtotal = moneyValue(replacements.reduce((sum, item) => sum + item.price * item.qty, 0));
  const exchangeSale = persistOrder({
    id: orderUid(),
    number: nextOrderNumber(),
    ts: Date.now(),
    status: 'completed',
    cashier: currentStoreInfo().cashier,
    register: currentStoreInfo().registerNo,
    items: replacements,
    customer: order.customer,
    paymentMethod: 'cash',
    subtotal,
    discount: 0,
    total: subtotal,
    tendered: subtotal,
    change: 0,
    payments: [{ method: 'cash', label: 'Exchange sale', amount: subtotal, tendered: subtotal, change: 0, ref: order.number }],
    fulfilment: order.fulfilment,
    deliveryAddress: order.deliveryAddress || '',
    deliveryLocation: order.deliveryLocation || null,
    originalOrderId: order.id,
    reason,
  });
  renderOrders();
  renderReports();
  return { original, exchangeSale };
}

function completeSale() {
  const totals = cartTotals();
  const total = moneyValue(totals.total);
  let tendered = total, change = 0;
  if (state.paymentMethod === 'cash' || state.paymentMethod === 'split') {
    const tenderRaw = ($('#checkoutTender')?.value || $('#tenderInput')?.value || '').trim();
    tendered = tenderRaw ? moneyValue(parseFloat(tenderRaw) || 0) : total;
    if (state.paymentMethod === 'cash' && tendered < total) {
      setCheckoutError('Tendered amount is below the total.');
      $('#checkoutTender')?.focus();
      return;
    }
    if (state.paymentMethod === 'split' && (!tenderRaw || tendered <= 0)) {
      setCheckoutError('Enter the cash amount for the split payment.');
      $('#checkoutTender')?.focus();
      return;
    }
    if (state.paymentMethod === 'split' && tendered >= total) {
      setCheckoutError('Use Cash for full payment, or enter a smaller cash amount.');
      $('#checkoutTender')?.focus();
      return;
    }
    if (state.paymentMethod === 'split' && !state.customer) {
      setCheckoutError('Select a customer for the remaining account balance.');
      openCustomerModal();
      return;
    }
    change = state.paymentMethod === 'cash'
      ? moneyValue(tendered - total)
      : moneyValue(Math.max(0, tendered - total));
  }
  if (state.paymentMethod === 'credit' && !state.customer) {
    setCheckoutError('Select a customer before charging to account.');
    return;
  }
  let order;
  try {
    order = persistOrder(buildOrderRecord({
      status: 'completed',
      paymentMethod: state.paymentMethod,
      tendered,
      change,
    }));
  } catch (err) {
    console.error(err);
    setCheckoutError('Receipt could not be saved. Sale was not completed.');
    return;
  }

  // Decrement stock for sold items (mockup-level)
  order.items.forEach(it => {
    const p = state.products.find(x => x.id === it.id);
    if (p) p.stock = Math.max(0, p.stock - it.qty);
  });
  saveProducts();
  applyCreditBalance(order);

  showCheckoutSuccess(order);
}

// ---------- Orders view ----------
function fmtOrderTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, today)) return `Today, ${time}`;
  if (sameDay(d, yest)) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ', ' + time;
}

function fmtReceiptTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function orderItemCount(o) {
  return (o.items || []).reduce((s, i) => s + i.qty, 0);
}

function isSavedOrder(o) {
  return (o.status || 'completed') === 'saved';
}
function isCompletedSale(o) {
  return (o.status || 'completed') === 'completed';
}

function orderStatusLabel(o) {
  if (isSavedOrder(o)) return 'Not completed';
  if (o.status === 'voided') return 'Voided';
  if (o.status === 'refunded') return 'Refunded';
  if (o.status === 'return') return 'Return';
  return 'Completed';
}

function orderPaymentLabel(o) {
  if (isSavedOrder(o)) return 'Not completed transaction';
  if (o.status === 'voided') return 'Voided sale';
  if (o.status === 'refunded') return 'Refunded sale';
  if (o.status === 'return') return 'Returned items';
  if (o.paymentMethod === 'credit') return 'Charged to account';
  if (o.paymentMethod === 'split') return 'Split payment';
  return 'Cash';
}

function buildMapThumb(location, className = 'rp-map-thumb') {
  const loc = normalizeDeliveryLocation(location);
  if (!loc) return '';
  const zoom = loc.zoom || DELIVERY_MAP_DEFAULT.zoom;
  const centerX = lonToWorldX(loc.lng, zoom);
  const centerY = latToWorldY(loc.lat, zoom);
  const tileCenterX = Math.floor(centerX / 256);
  const tileCenterY = Math.floor(centerY / 256);
  const imgs = [];
  for (let y = tileCenterY - 1; y <= tileCenterY + 1; y += 1) {
    if (y < 0 || y >= 2 ** zoom) continue;
    for (let x = tileCenterX - 1; x <= tileCenterX + 1; x += 1) {
      const left = Math.round(x * 256 - centerX);
      const top = Math.round(y * 256 - centerY);
      imgs.push(`<img src="${osmTileUrl(x, y, zoom)}" alt="" style="left:calc(50% + ${left}px);top:calc(50% + ${top}px)" />`);
    }
  }
  return `
    <div class="${className}">
      ${imgs.join('')}
      <div class="map-pin"></div>
      <div class="map-attrib">© OSM</div>
    </div>`;
}

function buildReceiptPreview(order) {
  const receipt = toReceiptViewModel(order);
  const lines = receipt.items.map(i => `
    <div class="rp-item">
      <div class="rp-item-name">${escapeHtml(i.name)}</div>
      <div class="rp-row rp-item-line">
        <span>${i.qty} ${escapeHtml(i.unit || '')} × ${peso(i.price)}</span>
        <span>${peso(i.lineTotal ?? (i.price * i.qty))}</span>
      </div>
    </div>`).join('');
  const payRows = receipt.status === 'saved'
    ? `<div class="rp-status saved">NOT COMPLETED TRANSACTION</div>`
    : receipt.payments.map(p => {
        if (p.method === 'cash') {
          return `
            <div class="rp-row"><span>CASH</span><span>${peso(p.tendered || p.amount)}</span></div>
            ${p.change > 0 ? `<div class="rp-row"><span>CHANGE</span><span>${peso(p.change)}</span></div>` : ''}`;
        }
        return `<div class="rp-row"><span>${escapeHtml(String(p.label || p.method).toUpperCase())}</span><span>${peso(p.amount)}</span></div>`;
      }).join('');
  return `
    <div class="receipt-preview">
      <div class="rp-paper">
        <div class="rp-center rp-store">${escapeHtml(receipt.store.name)}</div>
        <div class="rp-center rp-small">${escapeHtml(receipt.store.address)}</div>
        <div class="rp-center rp-small">Tel: ${escapeHtml(receipt.store.phone)}</div>
        <div class="rp-rule"></div>
        <div class="rp-row"><span>Receipt #</span><span>${escapeHtml(receipt.number)}</span></div>
        <div class="rp-row"><span>Date</span><span>${receipt.dateText}</span></div>
        <div class="rp-row"><span>Cashier</span><span>${escapeHtml(receipt.cashier || '')}</span></div>
        ${receipt.customer ? `<div class="rp-small">Customer: ${escapeHtml(receipt.customer.name)}</div>` : ''}
        <div class="rp-small"><strong>${escapeHtml(receipt.fulfilmentLabel)}</strong></div>
        ${buildMapThumb(receipt.deliveryLocation)}
        <div class="rp-rule"></div>
        ${lines}
        <div class="rp-rule"></div>
        <div class="rp-row"><span>Subtotal</span><span>${peso(receipt.totals.subtotal)}</span></div>
        ${receipt.totals.discount > 0 ? `<div class="rp-row"><span>Discount</span><span>-${peso(receipt.totals.discount)}</span></div>` : ''}
        ${receipt.totals.vatAmount ? `<div class="rp-row rp-small"><span>VAT (${Math.round((receipt.totals.vatRate || 0.12) * 100)}%)</span><span>${peso(receipt.totals.vatAmount)}</span></div>` : ''}
        <div class="rp-row rp-total"><span>TOTAL</span><span>${peso(receipt.totals.total)}</span></div>
        ${payRows}
        <div class="rp-rule"></div>
        <div class="rp-center rp-thanks">Salamat po!</div>
      </div>
    </div>`;
}

function renderOrders() {
  const list = $('#ordersList');
  const count = $('#ordersCount');
  if (!list) return;

  // Defensive: make sure state.orders is an array (and refresh from storage).
  if (!Array.isArray(state.orders)) state.orders = loadOrders();

  if (state.orders.length === 0) {
    if (count) count.textContent = 'No orders yet';
    list.innerHTML = `
      <div class="orders-empty">
        <div class="empty-glyph">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div class="empty-title">No receipts yet</div>
        <div class="empty-sub">Saved receipts and completed sales will appear here</div>
      </div>`;
    renderOrderDetail();
    return;
  }

  if (count) {
    const n = state.orders.length;
    count.textContent = `${n} order${n === 1 ? '' : 's'}`;
  }

  // Apply search filter (number or customer name)
  const q = (state.ordersQuery || '').trim().toLowerCase();
  const filtered = q
    ? state.orders.filter(o =>
        o.number.toLowerCase().includes(q) ||
        (o.customer && o.customer.name.toLowerCase().includes(q)) ||
        (o.items || []).some(i => [i.name, i.sku].some(v => String(v || '').toLowerCase().includes(q))) ||
        orderPaymentLabel(o).toLowerCase().includes(q) ||
        orderStatusLabel(o).toLowerCase().includes(q) ||
        fmtReceiptTime(o.ts).toLowerCase().includes(q))
    : state.orders;

  // Auto-select the most recent matching order if nothing's selected yet
  if (filtered.length > 0 && !filtered.find(o => o.id === state.selectedOrderId)) {
    state.selectedOrderId = filtered[0].id;
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="orders-empty">
        <div class="empty-title">No matches</div>
        <div class="empty-sub">Try a different order number or name</div>
      </div>`;
    renderOrderDetail();
    return;
  }

  list.innerHTML = filtered.map(o => {
    const active = state.selectedOrderId === o.id ? 'active' : '';
    const cust = o.customer ? o.customer.name : 'Walk-in';
    const method = isSavedOrder(o) ? 'Saved receipt' : orderPaymentLabel(o);
    const statusCls = isSavedOrder(o) ? 'saved' : (isCompletedSale(o) ? 'done' : 'saved');
    return `
      <div class="order-row ${active}" data-order-id="${o.id}">
        <div class="or-body">
          <div class="or-head">
            <span class="or-number">#${escapeHtml(o.number)}</span>
            <span class="or-total">${peso(o.total)}</span>
          </div>
          <div class="or-meta">
            <span class="or-cust">${escapeHtml(cust)}</span>
            <span class="or-sep">·</span>
            <span class="or-method">${method}</span>
          </div>
          <div class="or-foot">
            <span>${fmtOrderTime(o.ts)}</span>
            <span class="or-status ${statusCls}">${orderStatusLabel(o)}</span>
            <span>${orderItemCount(o)} item${orderItemCount(o) === 1 ? '' : 's'}</span>
          </div>
        </div>
        <button class="or-receipt-btn" data-act="view-receipt" data-order-id="${o.id}" title="View receipt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2z"/>
            <line x1="8" y1="9" x2="14" y2="9"/>
            <line x1="8" y1="13" x2="14" y2="13"/>
            <line x1="8" y1="17" x2="12" y2="17"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  renderOrderDetail();
}

function renderOrderDetail() {
  const detail = $('#orderDetail');
  if (!detail) return;
  const o = state.orders.find(x => x.id === state.selectedOrderId);
  if (!o) {
    detail.innerHTML = `
      <div class="order-detail-empty">
        <div class="empty-title">Select an order</div>
        <div class="empty-sub">Pick one from the list to view the receipt</div>
      </div>`;
    return;
  }

  const actions = isCompletedSale(o) && state.role === 'manager'
    ? `<div class="order-ops">
        <button class="secondary-btn small" data-order-op="void" data-order-id="${o.id}">Void</button>
        <button class="secondary-btn small" data-order-op="refund" data-order-id="${o.id}">Refund</button>
        <button class="secondary-btn small" data-order-op="return" data-order-id="${o.id}">Return</button>
        <button class="secondary-btn small" data-order-op="exchange" data-order-id="${o.id}">Exchange</button>
      </div>`
    : '';
  detail.innerHTML = `${actions}${buildReceiptPreview(o)}`;
}

function selectOrder(id) {
  state.selectedOrderId = id;
  renderOrders();
}

// ---------- 80mm thermal receipt ----------
function buildReceiptHtml(order) {
  const receipt = toReceiptViewModel(order);
  const lines = receipt.items.map(i => `
    <div class="r-item">
      <div class="r-item-name">${escapeHtml(i.name)}</div>
      <div class="r-item-row">
        <span>${i.qty} ${escapeHtml(i.unit || '')} × ${peso(i.price)}</span>
        <span>${peso(i.lineTotal ?? (i.price * i.qty))}</span>
      </div>
    </div>`).join('');

  const cust = receipt.customer
    ? `<div class="r-cust">Customer: ${escapeHtml(receipt.customer.name)}</div>`
    : '';
  const fulfilParts = receipt.fulfilmentLabel.split(' · ');
  const fulfil = fulfilParts[0] === 'DELIVERY'
    ? `
      <div class="r-cust"><strong>DELIVERY</strong></div>
      ${fulfilParts[1] ? `<div class="r-cust">${escapeHtml(fulfilParts.slice(1).join(' · '))}</div>` : ''}`
    : `<div class="r-cust"><strong>PICKUP</strong></div>`;
  const deliveryMap = receipt.deliveryLocation ? buildMapThumb(receipt.deliveryLocation, 'r-map-thumb') : '';
  const discRow = (receipt.totals.discount && receipt.totals.discount > 0)
    ? `<div class="r-row"><span>Discount</span><span>-${peso(receipt.totals.discount)}</span></div>` : '';
  const vatRows = (receipt.totals.vatAmount && receipt.totals.vatAmount > 0) ? `
      <div class="r-row"><span>VATable sales</span><span>${peso(receipt.totals.vatableSales)}</span></div>
      <div class="r-row"><span>VAT (${Math.round((receipt.totals.vatRate || 0.12) * 100)}%)</span><span>${peso(receipt.totals.vatAmount)}</span></div>` : '';
  const payRows = receipt.status === 'saved'
    ? `<div class="r-row"><span>STATUS</span><span>NOT COMPLETED</span></div>`
    : receipt.payments.map(p => {
        if (p.method === 'cash') {
          return `
            <div class="r-row"><span>CASH</span><span>${peso(p.tendered || p.amount)}</span></div>
            ${p.change > 0 ? `<div class="r-row"><span>CHANGE</span><span>${peso(p.change)}</span></div>` : ''}`;
        }
        return `<div class="r-row"><span>${escapeHtml(String(p.label || p.method).toUpperCase())}</span><span>${peso(p.amount)}</span></div>`;
      }).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(receipt.number)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "SF Mono", "Menlo", "Consolas", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.35;
    width: 80mm;
    padding: 4mm 4mm 6mm;
  }
  .r-center { text-align: center; }
  .r-store { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
  .r-store-sub { font-size: 11px; }
  .r-rule { border-top: 1px dashed #000; margin: 6px 0; }
  .r-double { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; }
  .r-meta { font-size: 11px; }
  .r-meta div { display: flex; justify-content: space-between; }
  .r-item { margin: 4px 0; }
  .r-item-name { font-weight: 700; }
  .r-item-row { display: flex; justify-content: space-between; font-size: 11px; }
  .r-row { display: flex; justify-content: space-between; }
  .r-total { font-size: 14px; font-weight: 700; }
  .r-foot { font-size: 11px; margin-top: 6px; }
  .r-cust { font-size: 11px; margin: 2px 0; }
  .r-map-thumb {
    position: relative; height: 82px; overflow: hidden; margin: 5px 0 2px;
    border: 1px solid #000; background: #f3f3f3; filter: grayscale(1) contrast(1.2);
  }
  .r-map-thumb img { position: absolute; width: 256px; height: 256px; max-width: none; }
  .r-map-thumb .map-pin {
    position: absolute; left: 50%; top: 50%; width: 14px; height: 14px;
    transform: translate(-50%, -100%) rotate(-45deg); background: #000;
    border: 2px solid #fff; border-radius: 50% 50% 50% 0;
  }
  .r-map-thumb .map-attrib {
    position: absolute; right: 3px; bottom: 2px; background: rgba(255,255,255,0.85);
    color: #000; font-size: 8px; padding: 0 2px;
  }
  .r-thanks { margin-top: 8px; font-weight: 700; }
  .r-actions { margin-top: 12px; display: flex; gap: 6px; }
  .r-actions button {
    flex: 1; font-family: inherit; font-size: 12px; padding: 8px;
    border: 1px solid #000; background: #fff; cursor: pointer;
  }
  .r-actions button.primary { background: #000; color: #fff; }
  @media print {
    .r-actions { display: none; }
    body { padding: 2mm 4mm 4mm; }
  }
</style>
</head>
<body>
  <div class="r-center r-store">${escapeHtml(receipt.store.name)}</div>
  <div class="r-center r-store-sub">${escapeHtml(receipt.store.address)}</div>
  <div class="r-center r-store-sub">Tel: ${escapeHtml(receipt.store.phone)}</div>
  <div class="r-center r-store-sub">TIN: ${escapeHtml(receipt.store.tin)}</div>

  <div class="r-rule"></div>

  <div class="r-meta">
    <div><span>Receipt #</span><span>${escapeHtml(receipt.number)}</span></div>
    <div><span>Date</span><span>${receipt.dateText}</span></div>
    <div><span>Cashier</span><span>${escapeHtml(receipt.cashier || '')}</span></div>
    <div><span>Register</span><span>${escapeHtml(receipt.register || '1')}</span></div>
  </div>
  ${cust}
  ${fulfil}
  ${deliveryMap}

  <div class="r-rule"></div>

  ${lines}

  <div class="r-rule"></div>

  <div class="r-row"><span>Subtotal</span><span>${peso(receipt.totals.subtotal)}</span></div>
  ${discRow}
  ${vatRows}
  <div class="r-double r-row r-total"><span>TOTAL</span><span>${peso(receipt.totals.total)}</span></div>
  ${payRows}

  <div class="r-rule"></div>

  <div class="r-center r-thanks">Salamat po!</div>
  <div class="r-center r-foot">This serves as your official receipt.</div>
  <div class="r-center r-foot">Goods sold are not returnable.</div>

  <div class="r-actions">
    <button onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print</button>
  </div>

  <script>
    // Auto-trigger the print dialog once rendered.
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 200);
    });
  </script>
</body>
</html>`;
}

function openReceipt(order) {
  const html = buildReceiptHtml(order);
  // Open a slim window sized roughly for the 80mm preview.
  const w = window.open('', 'hwpos_receipt_' + order.id,
    'width=360,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!w) {
    showToast('Pop-up blocked — allow pop-ups to print receipts');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Delete “${p.name}”?`)) return;
  state.products = state.products.filter(x => x.id !== id);
  saveProducts();
  rebuildFuse();
  renderAllFolderUis();
  showToast('Product deleted');
}

// ---------- Product modal ----------
function populateFolderSelect() {
  const sel = $('#pf_folder');
  if (!sel) return;
  const current = sel.value;
  const opts = ['<option value="">— Uncategorized —</option>']
    .concat(state.folders.filter(f => f.id !== 'all').map(f =>
      `<option value="${f.id}">${escapeHtml(f.name)}</option>`));
  sel.innerHTML = opts.join('');
  if (current) sel.value = current;
}

function openProductModal(mode, editId = null) {
  state.productModal = { mode, editId };
  $('#productModalTitle').textContent = mode === 'create' ? 'Add Product' : 'Edit Product';
  populateFolderSelect();

  const fields = {
    pf_name: '', pf_sku: '', pf_barcode: '', pf_brand: '',
    pf_folder: '',
    pf_unit: 'pc', pf_cost: '', pf_price: '', pf_stock: '0', pf_reorder: '0', pf_aliases: ''
  };
  if (mode === 'edit' && editId) {
    const p = state.products.find(x => x.id === editId);
    if (p) {
      Object.assign(fields, {
        pf_name: p.name, pf_sku: p.sku, pf_barcode: p.barcode || '',
        pf_brand: p.brand || '', pf_folder: p.folder || '',
        pf_unit: p.unit || 'pc', pf_cost: p.cost ?? '', pf_price: p.price ?? '',
        pf_stock: p.stock ?? 0, pf_reorder: p.reorderPoint ?? 0,
        pf_aliases: (p.aliases || []).join(', '),
      });
    }
  }
  Object.entries(fields).forEach(([id, val]) => { $('#' + id).value = val; });
  $('#productModal').hidden = false;
  setTimeout(() => $('#pf_name').focus(), 50);
}

function saveProduct() {
  const name = $('#pf_name').value.trim();
  const sku = $('#pf_sku').value.trim();
  if (!name) { showToast('Name is required'); $('#pf_name').focus(); return; }
  if (!sku) { showToast('SKU is required'); $('#pf_sku').focus(); return; }

  const data = {
    name,
    sku,
    barcode: $('#pf_barcode').value.trim(),
    brand: $('#pf_brand').value.trim() || 'Generic',
    folder: $('#pf_folder').value || '',
    unit: $('#pf_unit').value.trim() || 'pc',
    cost: parseFloat($('#pf_cost').value) || 0,
    price: parseFloat($('#pf_price').value) || 0,
    stock: parseInt($('#pf_stock').value, 10) || 0,
    reorderPoint: parseInt($('#pf_reorder').value, 10) || 0,
    aliases: $('#pf_aliases').value.split(',').map(s => s.trim()).filter(Boolean),
  };

  const { mode, editId } = state.productModal;
  if (mode === 'create') {
    state.products.push({ id: uid(), ...data });
    showToast(`Added “${data.name}”`);
  } else if (mode === 'edit' && editId) {
    const p = state.products.find(x => x.id === editId);
    if (p) Object.assign(p, data);
    showToast('Product updated');
  }
  saveProducts();
  rebuildFuse();
  renderAllFolderUis();
  $('#productModal').hidden = true;
}

// ---------- Customers / Reports ----------
function renderCustomers() {
  const grid = $('#customersGrid');
  const all = allCustomerRecords();
  grid.innerHTML = all.map(c => {
    const limit = c.creditLimit || 0;
    const bal = c.currentBalance || 0;
    const cls = bal === 0 ? '' : (limit > 0 && bal >= limit ? 'over' : 'has');
    const initials = c.name.split(' ').map(w => w[0]).slice(0, 2).join('');
    return `
      <div class="cust-card">
        <div class="cust-card-head">
          <div class="cust-card-avatar">${escapeHtml(initials)}</div>
          <div>
            <div class="cust-card-name">${escapeHtml(c.name)}</div>
            <div class="cust-card-phone">${escapeHtml(c.phone || '')}</div>
          </div>
        </div>
        <div class="cust-card-meta">
          <div class="row"><span class="label">Address</span><span>${escapeHtml(c.address || '—')}</span></div>
          <div class="row"><span class="label">Credit limit</span><span>${peso(limit)}</span></div>
        </div>
        <div class="cust-card-balance">
          <span class="cust-card-balance-label">Current Utang</span>
          <span class="cust-card-balance-value ${cls}">${peso(bal)}</span>
        </div>
        <button class="secondary-btn small cust-pay-btn" data-customer-pay="${escapeHtml(c.id)}" ${bal <= 0 ? 'disabled' : ''}>Record payment</button>
      </div>`;
  }).join('');
}

function sameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function renderReports() {
  state.orders = loadOrders();
  const today = new Date();
  const sales = state.orders
    .filter(o => isCompletedSale(o) && sameLocalDate(new Date(o.ts), today))
    .sort((a, b) => b.ts - a.ts);
  const revenue = sales.reduce((s, x) => s + x.total, 0);
  const txns = sales.length;
  const avg = txns > 0 ? revenue / txns : 0;
  const low = state.products.filter(p => p.stock <= p.reorderPoint).length;
  $('#statRevenue').textContent = peso(revenue);
  $('#statTxns').textContent = txns;
  $('#statAvg').textContent = peso(avg);
  $('#statLow').textContent = low;
  $('#recentList').innerHTML = sales.length
    ? sales.slice(0, 8).map(s => `
      <div class="recent-row">
        <div>
          <div class="r-id">#${escapeHtml(s.number)}${s.customer ? ' · ' + escapeHtml(s.customer.name) : ''}</div>
          <div class="r-time">${fmtOrderTime(s.ts)}</div>
        </div>
        <span class="r-method">${escapeHtml(orderPaymentLabel(s))}</span>
        <span class="r-amt">${peso(s.total)}</span>
      </div>
    `).join('')
    : `<div class="recent-empty">No completed sales yet</div>`;
  const drawer = buildCashDrawerSummary();
  const drawerEl = $('#drawerSummary');
  if (drawerEl) {
    drawerEl.innerHTML = `
      <div class="recent-row"><span>Expected cash</span><span class="r-amt">${peso(drawer.expectedCash)}</span></div>
      <div class="recent-row"><span>Cash sales</span><span>${drawer.cashSales}</span></div>
      <div class="recent-row"><span>Adjustments</span><span>${drawer.adjustments}</span></div>`;
  }
}

function renderPosSettings() {
  const currentSize = state.tileSize || 'md';
  $$('#posSizeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const showCb = $('#posShowPrice');
  if (showCb) showCb.checked = state.showPrice;
  const currentTheme = state.theme || 'dark';
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === currentTheme);
  });
  const p = state.settings.printing || {};
  const pw = $('#posPrinterWidth');
  if (pw) pw.value = p.width || '58mm';
  const po = $('#posPrintOnSale');
  if (po) po.checked = !!p.printOnSale;
}

function applyTheme(theme) {
  state.theme = theme;
  storageSet(STORAGE_THEME, theme);
  document.body.classList.toggle('light-theme', theme === 'light');
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

function persistPosSettings() {
  state.settings.printing = {
    ...state.settings.printing,
    width: ($('#posPrinterWidth')?.value || '58mm').trim(),
    printOnSale: !!$('#posPrintOnSale')?.checked,
  };
  saveSettings();
}

function buildCashDrawerSummary(date = new Date()) {
  const orders = loadOrders().filter(o => sameLocalDate(new Date(o.ts), date));
  let expectedCash = 0;
  let cashSales = 0;
  let adjustments = 0;
  orders.forEach(order => {
    const cashAmount = (order.payments || [])
      .filter(p => p.method === 'cash')
      .reduce((sum, p) => sum + toNumber(p.amount, 0), 0);
    if (isCompletedSale(order)) {
      expectedCash += cashAmount;
      if (cashAmount > 0) cashSales += 1;
    } else if (order.status === 'voided' || order.status === 'refunded' || order.status === 'return') {
      adjustments += 1;
    }
  });
  return { date: date.toISOString().slice(0, 10), expectedCash: moneyValue(expectedCash), cashSales, adjustments };
}

function closeCashDrawer({ countedCash = 0, notes = '' } = {}) {
  if (!requireManagerAction('Close drawer')) return null;
  const summary = buildCashDrawerSummary();
  const closeout = {
    id: `drawer_${Date.now().toString(36)}`,
    ts: Date.now(),
    ...summary,
    countedCash: moneyValue(countedCash),
    difference: moneyValue(toNumber(countedCash, 0) - summary.expectedCash),
    notes: String(notes || ''),
    cashier: currentStoreInfo().cashier,
  };
  state.drawerCloseouts = [closeout, ...loadDrawerCloseouts().filter(x => x.date !== closeout.date)];
  saveDrawerCloseouts();
  return closeout;
}

function buildReorderList() {
  return state.products
    .filter(p => toNumber(p.stock, 0) <= toNumber(p.reorderPoint, 0))
    .map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      stock: toNumber(p.stock, 0),
      reorderPoint: toNumber(p.reorderPoint, 0),
      suggestedQty: Math.max(1, toNumber(p.reorderPoint, 0) * 2 - toNumber(p.stock, 0)),
    }))
    .sort((a, b) => (a.stock / Math.max(1, a.reorderPoint)) - (b.stock / Math.max(1, b.reorderPoint)));
}

// ============================================================
// EVENTS
// ============================================================
function attachEvents() {
  // Sidebar nav
  $$('.side-link').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  // ---- Top bar: sidebar toggle ----
  $('#sidebarToggle')?.addEventListener('click', () => {
    $('#app').classList.toggle('sidebar-collapsed');
  });
  // Per-view hamburger buttons (one in each view's header)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="open-sidebar"]');
    if (!btn) return;
    e.stopPropagation();
    $('#app').classList.toggle('sidebar-collapsed');
  });

  // Close the sidebar before the underlying Sell surface sees the press.
  let swallowSidebarBackdropClick = false;
  function closeSidebarFromBackdrop(e) {
    const app = $('#app');
    if (!app || app.classList.contains('sidebar-collapsed')) return false;
    if (e.target.closest('.sidebar')) return false;
    if (e.target.closest('#sidebarToggle')) return false;
    if (e.target.closest('[data-act="open-sidebar"]')) return false;
    app.classList.add('sidebar-collapsed');
    swallowSidebarBackdropClick = true;
    clearTimeout(closeSidebarFromBackdrop._t);
    closeSidebarFromBackdrop._t = setTimeout(() => { swallowSidebarBackdropClick = false; }, 350);
    return true;
  }
  document.addEventListener('pointerdown', (e) => {
    if (!closeSidebarFromBackdrop(e)) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', (e) => {
    if (!swallowSidebarBackdropClick) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    swallowSidebarBackdropClick = false;
  }, true);

  // Tap anywhere outside the sidebar (backdrop or main content) to close it.
  // The capture handlers above prevent the same tap from reaching product tiles.
  document.addEventListener('click', (e) => {
    const app = $('#app');
    if (app.classList.contains('sidebar-collapsed')) return;
    if (e.target.closest('.sidebar')) return;
    if (e.target.closest('#sidebarToggle')) return;
    if (e.target.closest('[data-act="open-sidebar"]')) return;
    app.classList.add('sidebar-collapsed');
  });
  // Close the sidebar automatically after picking a nav item
  $$('.side-link').forEach(t => t.addEventListener('click', () => {
    $('#app').classList.add('sidebar-collapsed');
  }));

  // ---- Bottom bar: pagination ----
  $('#bbPrevBtn')?.addEventListener('click', () => changePage(-1));
  $('#bbNextBtn')?.addEventListener('click', () => changePage(1));

  // ---- Bottom bar: tile size toggle (S / M / L) ----
  $$('.bb-size-btn').forEach(btn => {
    btn.addEventListener('click', () => setTileSize(btn.dataset.size));
  });

  // ---- Bottom bar: toggle price display on tiles ----
  $('#bbViewBtn')?.addEventListener('click', toggleShowPrice);

  // ---- Save button on cart: creates a not-completed saved receipt ----
  $('#saveBtn')?.addEventListener('click', openSaveReceiptModal);
  $('#saveReceiptConfirmBtn')?.addEventListener('click', saveReceiptFromModal);
  $('#saveReceiptNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveReceiptFromModal();
    }
  });

  // ---- Sell folder strip (legacy, no-op if removed) ----
  $('#folderStrip')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.folder-pill');
    if (pill) selectFolder(pill.dataset.folderId);
  });

  // ---- Sell search ----
  const search = $('#searchInput'), clear = $('#searchClear');
  search.addEventListener('input', (e) => {
    state.query = e.target.value;
    state.page = 1;
    clear.classList.toggle('visible', !!state.query);
    renderProducts();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = search.value.trim();
      if (!raw) return;
      if (findProductByCode(raw) && addProductByCode(raw, { source: 'keyboard' })) {
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
        return;
      }
      // 3. Fall back to single fuzzy match
      const products = getFilteredSellProducts();
      if (products.length === 1) {
        addToCart(products[0].id);
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
      }
    }
  });
  clear.addEventListener('click', () => {
    search.value = ''; state.query = '';
    clear.classList.remove('visible');
    renderProducts(); search.focus();
  });
  // Auto-focus search on Sell view so HID barcode scanners "just work"
  function focusSellSearchIfActive() {
    if (state.view === 'sell' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
      search?.focus({ preventScroll: true });
    }
  }
  // Global key-route: if user is on Sell view and starts typing while not focused on an input,
  // capture into the search input — this lets HID barcode scanners hit anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'sell') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 && e.key !== 'Enter') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Don't hijack modal context
    if (document.querySelector('.modal-backdrop:not([hidden])')) return;
    if (e.key === 'Enter') return;
    search.focus({ preventScroll: true });
  });
  $('#scanBtn').addEventListener('click', openBarcodeScanner);
  $('#barcodeManualBtn')?.addEventListener('click', submitManualBarcode);
  $('#barcodeManualInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManualBarcode();
    }
  });

  // ---- Product grid (Sell) ----
  const productGrid = $('#productGrid');
  let swipeStart = null;
  let suppressGridClick = false;
  productGrid.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  productGrid.addEventListener('pointerup', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.35) {
      suppressGridClick = true;
      changePage(dx < 0 ? 1 : -1);
      clearTimeout(productGrid._swipeClickTimer);
      productGrid._swipeClickTimer = setTimeout(() => { suppressGridClick = false; }, 260);
    }
  });
  productGrid.addEventListener('pointercancel', () => { swipeStart = null; });
  productGrid.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return;
    e.preventDefault();
    changePage(e.deltaX > 0 ? 1 : -1);
  }, { passive: false });
  productGrid.addEventListener('click', (e) => {
    if (suppressGridClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const card = e.target.closest('.product-card');
    if (!card) return;
    // Back tile inside a group (only when drilled in — left for back-compat)
    if (card.dataset.act === 'back') { closeGroup(); return; }
    // Group parent tile → open the variant picker modal
    if (card.dataset.groupId) { openVariantModal(card.dataset.groupId); return; }
    // Regular product
    if (card.dataset.disabled === 'true') { showToast('Item is out of stock'); return; }
    addToCart(card.dataset.id);
  });

  // ---- Variant picker modal ----
  $('#variantGrid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.variant-tile');
    if (!tile) return;
    if (tile.dataset.disabled === 'true') { showToast('Variant is out of stock'); return; }
    selectVariant(tile.dataset.variantId);
  });
  $$('#variantModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeVariantQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#variantQtyInput')?.addEventListener('input', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    state.variantModal.qty = q;
  });
  $('#variantQtyInput')?.addEventListener('blur', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    e.target.value = q;
  });
  $('#variantAddBtn')?.addEventListener('click', addVariantToCart);

  // ---- Orders list (sidebar view) ----
  $('#ordersList')?.addEventListener('click', (e) => {
    // Quick-view receipt icon (don't bubble to row-select)
    const recBtn = e.target.closest('[data-act="view-receipt"]');
    if (recBtn) {
      e.stopPropagation();
      const o = state.orders.find(x => x.id === recBtn.dataset.orderId);
      if (o) openReceipt(o);
      return;
    }
    const row = e.target.closest('.order-row');
    if (!row) return;
    selectOrder(row.dataset.orderId);
  });
  $('#orderDetail')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-order-op]');
    if (!btn) return;
    const id = btn.dataset.orderId;
    if (btn.dataset.orderOp === 'void') voidOrder(id, 'Voided from Orders');
    if (btn.dataset.orderOp === 'refund') refundOrder(id, 'Refunded from Orders');
    if (btn.dataset.orderOp === 'return') recordReturn(id, 'Returned from Orders');
    if (btn.dataset.orderOp === 'exchange') {
      const replacement = state.products.find(p => p.stock > 0 && p.price > 0);
      if (replacement) exchangeOrder(id, [{ id: replacement.id, qty: 1 }], 'Exchange from Orders');
    }
  });
  // Orders search
  $('#ordersSearch')?.addEventListener('input', (e) => {
    state.ordersQuery = e.target.value;
    renderOrders();
  });

  // ---- Cart row click → open edit modal ----
  $('#cartList').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-item');
    if (!row) return;
    openCartItemModal(row.dataset.id);
  });

  // ---- Cart item edit modal ----
  $$('#cartItemModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeCartItemModalQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#cimQtyInput')?.addEventListener('input', updateCartItemModalLineTotal);
  $('#cimQtyInput')?.addEventListener('blur', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    e.target.value = q;
    updateCartItemModalLineTotal();
  });
  $('#cimSaveBtn')?.addEventListener('click', saveCartItemEdit);
  $('#cimDeleteBtn')?.addEventListener('click', removeCartItemFromModal);
  // Cart item modal: discount segment + input
  $$('#cartItemModal [data-cim-disc-type]').forEach(b => {
    b.addEventListener('click', () => {
      $$('#cartItemModal [data-cim-disc-type]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updateCartItemModalLineTotal();
    });
  });
  $('#cimDiscInput')?.addEventListener('input', updateCartItemModalLineTotal);

  // Cart-level discount: open + apply + remove
  $('#cartDiscountBtn')?.addEventListener('click', openCartDiscountModal);
  $$('#cartDiscountModal [data-cd-type]').forEach(b => {
    b.addEventListener('click', () => {
      $$('#cartDiscountModal [data-cd-type]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  $('#cdApplyBtn')?.addEventListener('click', applyCartDiscount);
  $('#cdRemoveBtn')?.addEventListener('click', clearCartDiscount);

  // Fulfilment pills
  $$('.fulfil-pill').forEach(b => {
    b.addEventListener('click', () => setFulfilment(b.dataset.fulfil));
  });
  // Delivery modal save
  $('#deliverySaveBtn')?.addEventListener('click', saveDeliveryAddress);
  $('#deliveryPinBtn')?.addEventListener('click', openDeliveryMap);
  $('#deliveryMapZoomOut')?.addEventListener('click', () => zoomDeliveryMap(-1));
  $('#deliveryMapZoomIn')?.addEventListener('click', () => zoomDeliveryMap(1));
  $('#deliveryMapUseGps')?.addEventListener('click', useDeviceDeliveryLocation);
  $('#deliveryMapSave')?.addEventListener('click', saveDeliveryMapPin);
  $('#deliveryMapClear')?.addEventListener('click', clearDeliveryMapPin);
  $('#deliveryMapStage')?.addEventListener('pointerdown', (e) => {
    if (state.deliveryMap.pinch) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const center = deliveryMapWorldCenter();
    state.deliveryMap.drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      centerX: center.x,
      centerY: center.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  });
  $('#deliveryMapStage')?.addEventListener('pointermove', (e) => {
    if (state.deliveryMap.pinch) return;
    const drag = state.deliveryMap.drag;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    setDeliveryMapCenterFromWorld(drag.centerX - dx, drag.centerY - dy);
    renderDeliveryMap();
  });
  $('#deliveryMapStage')?.addEventListener('pointerup', (e) => {
    const drag = state.deliveryMap.drag;
    if (!drag || drag.id !== e.pointerId) return;
    state.deliveryMap.drag = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!drag.moved) setDeliveryMapPinAt(e.clientX, e.clientY);
  });
  $('#deliveryMapStage')?.addEventListener('pointercancel', () => { state.deliveryMap.drag = null; });
  $('#deliveryMapStage')?.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomDeliveryMapAt(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
  }, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      beginDeliveryPinch(e);
    }
  }, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchmove', updateDeliveryPinch, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchend', endDeliveryPinch);
  $('#deliveryMapStage')?.addEventListener('touchcancel', endDeliveryPinch);

  // New customer (Customers view) + saved customer save
  $('#newCustomerBtn')?.addEventListener('click', openCustomerEditModal);
  $('#customersGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-customer-pay]');
    if (!btn) return;
    const amount = parseFloat(prompt('Payment amount') || '0');
    if (amount > 0) recordCreditPayment(btn.dataset.customerPay, amount);
  });
  $('#custSaveBtn')?.addEventListener('click', saveSavedCustomerFromModal);
  $('#clearCartBtn').addEventListener('click', () => {
    if (state.cart.length === 0) return;
    showConfirm({
      title: 'Clear receipt?',
      message: 'All items in the current receipt will be removed. This cannot be undone.',
      okText: 'Yes, clear',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: () => {
        clearCart();
        showToast('Cart cleared');
      }
    });
  });

  // ---- Customer ----
  $('#customerBtn').addEventListener('click', openCustomerModal);
  $('#customerModal').addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer-id]');
    if (row) selectCustomer(row.dataset.customerId);
  });

  // ---- Modals ----
  $$('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.closest('#barcodeModal')) stopBarcodeScanner();
      $$('.modal-backdrop').forEach(m => m.hidden = true);
    });
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd) return;
      if (bd.id === 'barcodeModal') stopBarcodeScanner();
      bd.hidden = true;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopBarcodeScanner();
      $$('.modal-backdrop').forEach(m => m.hidden = true);
    }
  });

  // ---- Pay ----
  $('#payBtn').addEventListener('click', openPaymentModal);

  // Payment-method segment (both legacy modal segs and new checkout segs)
  function selectPayMethod(method) {
    state.paymentMethod = method;
    $$('.seg[data-method]').forEach(s =>
      s.classList.toggle('active', s.dataset.method === method));
    syncPayFields();
    if ((method === 'credit' || method === 'split') && !state.customer) {
      openCustomerModal();
      showToast(method === 'split' ? 'Pick a customer for the balance' : 'Pick a credit customer');
    }
  }
  $$('.seg[data-method]').forEach(seg => {
    seg.addEventListener('click', () => selectPayMethod(seg.dataset.method));
  });

  // Checkout view: back, tender input, quick-cash, complete
  document.addEventListener('click', (e) => {
    const back = e.target.closest('[data-act="checkout-back"]');
    if (back) { switchView(state.prevView && state.prevView !== 'checkout' ? state.prevView : 'sell'); }
  });
  $('#checkoutTender')?.addEventListener('input', updateChange);
  $('.checkout-quick')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-co-cash]');
    if (!b) return;
    const { total } = cartTotals();
    $('#checkoutTender').value = b.dataset.coCash === 'exact' ? total.toFixed(2) : b.dataset.coCash;
    updateChange();
  });
  $('#checkoutCompleteBtn')?.addEventListener('click', completeSale);
  $('#successPrintBtn')?.addEventListener('click', printSuccessReceipt);
  $('#successNewSaleBtn')?.addEventListener('click', startNewSaleFromSuccess);

  // Legacy modal (kept for back-compat if anything still triggers it)
  $('#tenderInput')?.addEventListener('input', updateChange);
  $$('.quick-cash button').forEach(b => {
    b.addEventListener('click', () => {
      const { total } = cartTotals();
      $('#tenderInput').value = b.dataset.cash === 'exact' ? total.toFixed(2) : b.dataset.cash;
      updateChange();
    });
  });
  $('#completeSaleBtn')?.addEventListener('click', completeSale);

  // ---- POS Settings ----
  $$('#posSizeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      setTileSize(b.dataset.size);
      renderPosSettings();
    });
  });
  $('#posShowPrice')?.addEventListener('change', (e) => {
    state.showPrice = e.target.checked;
    storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
    renderPosSettings();
    renderProducts();
  });
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      applyTheme(b.dataset.theme);
    });
  });
  $('#posPrinterWidth')?.addEventListener('change', persistPosSettings);
  $('#posPrintOnSale')?.addEventListener('change', persistPosSettings);

  // Product modal save
  $('#saveProductBtn').addEventListener('click', saveProduct);

  // Folder modal save
  $('#saveFolderBtn').addEventListener('click', saveFolder);
  $('#folderNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolder();
  });

  const renderSyncStatus = async () => {
    const el = $('#syncPill');
    if (!el) return;
    let online = navigator.onLine !== false;
    try {
      const health = await window.HWPOS_STORE?.health?.();
      if (health && typeof health.online === 'boolean') online = health.online;
    } catch (_) {}
  };
  window.addEventListener('online', renderSyncStatus);
  window.addEventListener('offline', renderSyncStatus);
  renderSyncStatus();
}

// ---------- Init ----------
function init() {
  setAppViewportHeight();
  state.folders = loadFolders();
  // Ensure "all" exists
  if (!state.folders.find(f => f.id === 'all')) {
    state.folders.unshift({ id: 'all', name: 'All Items', builtin: true });
  }
  state.products = loadProducts();
  state.groups = loadGroups();
  state.orders = loadOrders();
  state.settings = loadSettings();
  state.vatRate = state.settings.vatRate ?? 0.12;
  state.customers = loadSavedCustomers();
  state.customerLedger = loadCustomerLedger();
  state.drawerCloseouts = loadDrawerCloseouts();
  state.role = loadRole();
  state.fulfilment = state.settings.defaultFulfilment || 'pickup';
  // Apply saved theme
  if (state.theme === 'light') document.body.classList.add('light-theme');
  // Back-fill groupId on products coming from older localStorage that predates groups.
  if (typeof _GROUP_MEMBERSHIP !== 'undefined') {
    let touched = false;
    state.products.forEach(p => {
      if (!p.groupId && _GROUP_MEMBERSHIP[p.id]) {
        p.groupId = _GROUP_MEMBERSHIP[p.id];
        touched = true;
      }
    });
    if (touched) saveProducts();
  }
  rebuildFuse();

  renderSellFolderStrip();
  renderSellHeader();
  renderProducts();
  renderCart();
  updateCustomerButton();
  populateFolderSelect();
  applyRoleGating();
  renderRoleSwitcher();
  attachEvents();
  const openHashView = () => {
    const hash = (location.hash || '').replace('#', '').trim();
    const target = hash.split(/[/?&:]/)[0];
    const valid = ['sell', 'orders', 'inventory', 'customers', 'reports'];
    if (valid.includes(target) && canAccess(target)) switchView(target);
  };
  openHashView();
  window.addEventListener('hashchange', openHashView);
  requestAnimationFrame(syncSellGridMetrics);
  let resizeFrame = 0;
  const refitSellSurface = ({ resetPage = false } = {}) => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      setAppViewportHeight();
      if (state.view === 'sell') {
        if (resetPage) state.page = 1;
        renderProducts();
      }
    });
  };
  window.addEventListener('resize', () => refitSellSurface({ resetPage: true }));
  window.visualViewport?.addEventListener('resize', () => refitSellSurface());
  window.visualViewport?.addEventListener('scroll', () => refitSellSurface());

  // Sync persisted UI state on first paint
  $$('.bb-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === state.tileSize));
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);

  // Pick up appearance changes pushed from the back-office tab.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_TILE_SIZE && e.newValue && ITEMS_PER_PAGE[e.newValue]) {
      state.tileSize = e.newValue;
      state.page = 1;
      renderProducts();
    }
    if (e.key === STORAGE_SHOW_PRICE) {
      state.showPrice = e.newValue === '1';
      renderProducts();
    }
    if (e.key === STORAGE_THEME && e.newValue) {
      state.theme = e.newValue;
      document.body.classList.toggle('light-theme', e.newValue === 'light');
    }
    // Sales made in another tab (e.g. second POS instance) — refresh orders list.
    if (e.key === STORAGE_ORDERS) {
      state.orders = loadOrders();
      if (state.view === 'orders') renderOrders();
    }
    // Stock changes from another tab — refresh product tiles.
    if (e.key === STORAGE_PRODUCTS) {
      state.products = loadProducts();
      rebuildFuse();
      if (state.view === 'sell') renderProducts();
    }
    if (e.key === STORAGE_SETTINGS) {
      state.settings = loadSettings();
      state.vatRate = state.settings.vatRate ?? DEFAULT_SETTINGS.vatRate;
      renderCart();
      if (state.view === 'checkout') renderCheckout();
    }
  });
  // Also refresh when the user returns to the POS tab in case they changed it
  // in the back office on another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const newSize = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
    const newShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
    let changed = false;
    if (newSize !== state.tileSize && ITEMS_PER_PAGE[newSize]) { state.tileSize = newSize; state.page = 1; changed = true; }
    if (newShow !== state.showPrice) { state.showPrice = newShow; changed = true; }
    state.settings = loadSettings();
    state.vatRate = state.settings.vatRate ?? DEFAULT_SETTINGS.vatRate;
    if (changed) renderProducts();
    // Always re-pull orders so the list is up to date.
    state.orders = loadOrders();
    if (state.view === 'orders') renderOrders();
  });
}
document.addEventListener('DOMContentLoaded', init);
