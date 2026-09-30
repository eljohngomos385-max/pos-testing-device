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
  // Which fulfilment pills the checkout shows. { hidden: [builtin key], custom: [name] }
  fulfilment: { hidden: [], custom: [] },
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
  pricingTiers: {
    contractor: 0.05,
    wholesale: 0.10,
    retail: 0,
    residential: 0,
  },
  churnThresholdDays: 30,
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
const STORAGE_TILE_TEXT = 'hwpos.tileText';
const TILE_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'];
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

// ---------- Till event stream (HWPOS_STORE.events; fields in docs/data-dictionary.md) ----------
// Raw facts only, fire-and-forget: an event can never throw into, or wait on, a sale.
// cartId rides the store's context so every row says which cart it happened in.
function track(type, data) {
  try {
    const ev = window.HWPOS_STORE && window.HWPOS_STORE.events;
    if (!ev || !ev.append) return;
    if (ev.setContext) ev.setContext({ cartId: state.cartId || '' });
    ev.append(type, data || {});
  } catch (_) {}
}

// A cart is born when its first line lands and keeps its id until the sale or the clear.
function beginCart() {
  if (state.cart.length) return;
  state.cartId = newId('cart');
  state.cartStartedAt = Date.now();
  track('cart_start');
}

// One search row per intent, never per keystroke: a pick logs it with the product; clearing the
// box, a scan over it, or leaving the app logs it unpicked -- "looked for it, didn't take it".
let searchIntent = null;   // { query, results, picked }
function endSearch(keep = false) {
  const s = searchIntent;
  if (!keep) searchIntent = null;
  if (!s || s.picked) return;
  s.picked = true;
  track('search', { query: s.query, results: s.results || 0, chosenProductId: '' });
}

// stockOnHand is the shelf at the tap -- the cart does not decrement stock until the sale.
function trackItemAdd(p, qty, via) {
  const stockOnHand = Number(p.stock) || 0;
  if (stockOnHand <= 0) track('oos_tap', { productId: p.id, stockOnHand });
  track('item_add', { productId: p.id, qty, unitPrice: p.price, stockOnHand, via });
  if (via !== 'scan' && searchIntent && state.query.trim()) {
    searchIntent.picked = true;
    track('search', { query: searchIntent.query, results: searchIntent.results || 0, chosenProductId: p.id });
  }
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
  ordersFilter: { range: 'week', staff: '', pay: '', status: '', fulfil: '' },   // ORDERS_FILTER_DEF
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
  tileText: (storageGet(STORAGE_TILE_TEXT, 'md') || 'md'),
  showPrice: storageGet(STORAGE_SHOW_PRICE, '0') === '1',
  theme: (storageGet(STORAGE_THEME, 'dark') || 'dark'),
  cartHead: window.HWPOS_STORE?.ui.get('cartHead', '1') !== '0',               // the Item / Amount band
  custTypeFilter: 'all',
  tierDiscountDismissed: false,
  customersQuery: '',
  selectedCustomerId: null,
  lostSale: { productId: '', reason: 'out-of-stock' },
  cartId: '',                   // till event stream only; never written to the order
  cartStartedAt: 0,
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
// Everything that reaches here came out of `loadOrders` or was normalized by its writer, so
// normalizing the whole history again on every save is a second full pass over every receipt
// ever rung -- for one appended row. `loadOrders` is the trust boundary; this is not.
function saveOrdersList(orders) {
  return writeJsonStorage(STORAGE_ORDERS, (orders || []).filter(Boolean));
}
// Highest receipt sequence found in stored orders. Scanned once per session, not per sale:
// `hwpos.orderSeq` is the counter, and this scan only exists to recover if that counter is
// wiped or lags -- which cannot happen halfway through a session. Rescanning per receipt
// meant parsing the entire order history to hand out one number.
let scannedOrderSeq = null;
function nextOrderNumber() {
  // Format: <register>-<seq3>, e.g. "1-001". Sequence persists across sessions.
  const registerNo = currentStoreInfo().registerNo || STORE_INFO.registerNo;
  if (scannedOrderSeq == null) {
    const orders = readJsonStorage(STORAGE_ORDERS, []);
    scannedOrderSeq = Array.isArray(orders)
      ? orders.reduce((max, o) => {
          const number = String(o?.number || '');
          const parts = number.split('-');
          const reg = parts[0];
          const seq = parseInt(parts[1] || '', 10);
          return reg === registerNo && Number.isFinite(seq) ? Math.max(max, seq) : max;
        }, 0)
      : 0;
  }
  let seq = parseInt(storageGet(STORAGE_ORDER_SEQ, '0') || '0', 10) || 0;
  seq = Math.max(seq, scannedOrderSeq);
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
    pricingTiers: { ...DEFAULT_SETTINGS.pricingTiers, ...(saved.pricingTiers || {}) },
    churnThresholdDays: saved.churnThresholdDays ?? DEFAULT_SETTINGS.churnThresholdDays,
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
  // Floor at 0, not 1: a hardware store sells 2.5 m of wire and 0.75 kg of nails,
  // and clamping that up to 1 invents both stock and revenue.
  const qty = Math.max(0, toNumber(item.qty, 1));
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
    // What this cost US, stamped at the moment of sale. Suppliers re-price; without this,
    // every past margin in the back office silently rewrites itself the next time cost moves.
    cost: moneyValue(toNumber(item.cost, state.products.find(p => p.id === (item.productId || item.id))?.cost || 0)),
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

const KNOWN_METHOD_LABELS = { cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', split: 'Split payment', unpaid: 'Not completed' };

function buildOrderPayments({ status, paymentMethod, total, tendered = 0, change = 0 }) {
  if (status === 'saved' || paymentMethod === 'unpaid') {
    return [{ method: 'unpaid', label: 'Not completed', amount: 0, tendered: 0, change: 0, ref: '' }];
  }
  if (paymentMethod === 'credit') {
    return [{ method: 'credit', label: 'Account', amount: moneyValue(total), tendered: 0, change: 0, ref: '' }];
  }
  if (paymentMethod === 'split') {
    const cashApplied = Math.min(moneyValue(tendered), moneyValue(total));
    const balance = moneyValue(total - cashApplied);
    return [
      { method: 'cash', label: 'Cash', amount: cashApplied, tendered: moneyValue(tendered), change: moneyValue(change), ref: '' },
      ...(balance > 0 ? [{ method: 'credit', label: 'Charge balance', amount: balance, tendered: 0, change: 0, ref: '' }] : []),
    ];
  }
  // Only cash lands in the drawer. GCash, QR and custom names ("Maya") arrive here as their own
  // method string and used to fall through to a cash row -- so every one of them printed CASH on
  // the receipt and `buildCashDrawerSummary` expected money that never went in the till.
  if (paymentMethod && paymentMethod !== 'cash') {
    return [{ method: 'other', label: KNOWN_METHOD_LABELS[paymentMethod] || String(paymentMethod),
              amount: moneyValue(total), tendered: moneyValue(tendered), change: moneyValue(change), ref: '' }];
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
  // The legacy paymentMethod stays coerced to cash/credit/split/unpaid so drawer
  // math and credit logic keep working. The real tendered method (GCash, QR, or a
  // custom name like "Maya") is preserved separately in paymentKind/paymentMethodLabel.
  const rawMethodStr = (typeof raw.paymentMethod === 'string' ? raw.paymentMethod : '').trim();
  const rawMethodLower = rawMethodStr.toLowerCase();
  const paymentMethod = ['cash', 'credit', 'split', 'unpaid'].includes(rawMethodLower)
    ? rawMethodLower
    : (status === 'saved' ? 'unpaid' : 'cash');
  let paymentKind, paymentMethodLabel;
  if (raw.paymentKind && raw.paymentMethodLabel) {
    paymentKind = String(raw.paymentKind);
    paymentMethodLabel = String(raw.paymentMethodLabel);
  } else if (status === 'saved') {
    paymentKind = 'unpaid'; paymentMethodLabel = 'Not completed';
  } else if (['cash', 'gcash', 'qr', 'credit', 'split'].includes(rawMethodLower)) {
    paymentKind = rawMethodLower; paymentMethodLabel = KNOWN_METHOD_LABELS[rawMethodLower];
  } else if (rawMethodStr) {
    paymentKind = 'other'; paymentMethodLabel = rawMethodStr;
  } else {
    paymentKind = 'cash'; paymentMethodLabel = 'Cash';
  }
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
        // The true tender, not the drawer-facing coercion -- `paymentMethod` is already flattened
        // to cash for GCash/QR/custom, and rebuilding payments from that loses the method.
        paymentMethod: paymentKind === 'other' ? paymentMethodLabel : paymentKind,
        total,
        tendered: toNumber(raw.tendered, paymentMethod === 'cash' ? total : 0),
        change: toNumber(raw.change, 0),
      });
  const firstCash = payments.find(p => p.method === 'cash');
  const store = currentStoreInfo();
  const id = String(raw.id || orderUid());
  const number = String(raw.number || raw.receiptNumber || raw.orderNumber || id);
  // Any non-empty name is a type the owner added; it is stored as itself so the order
  // keeps its label after the type is removed. Only 'delivery' carries an address.
  const fulfilment = String(raw.fulfilment || 'pickup').trim() || 'pickup';
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
    paymentKind,
    paymentMethodLabel,
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
  const fulfilmentLabel = orderFulfilLabel(o, 'Pickup').toUpperCase()
    + (o.fulfilment === 'delivery' && o.deliveryAddress ? ' · ' + o.deliveryAddress : '');
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
// Nobody asks for "one nail". The catalog is written singular and the counter is asked in
// plural, so both forms go in the index -- searching "nails" for "Common Wire Nail" found
// nothing at all, and a POS search that returns an empty grid loses the sale.
function withPlurals(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const extra = words.map(w => (/[a-z]s$/.test(w) ? w.slice(0, -1) : (/[a-z]$/.test(w) ? w + 's' : '')));
  return [...words, ...extra.filter(Boolean)].join(' ');
}

function rebuildFuse() {
  const indexed = state.products.map(p => ({
    ...p,
    searchBlob: withPlurals(
      [p.name, p.sku, p.barcode, p.brand, ...(p.aliases || [])].join(' ').toLowerCase()),
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
  cashier: new Set(['sell', 'orders', 'items', 'settings', 'checkout']),
  manager: new Set(['sell', 'orders', 'items', 'customers', 'back-office', 'settings', 'checkout']),   // ponytail: Reports hidden for now; add 'reports' back to bring it back
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
  const fromCheckout = state.view === 'checkout';
  state.view = view;
  $$('.side-link').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'checkout') railCheckout(true);
  else if (fromCheckout) railCheckout(false, view === 'sell');
  if (view === 'back-office') { window.open('backoffice.html', '_blank', 'noopener'); return; }
  if (view === 'settings') { renderPosSettings(); return; }
  if (view === 'orders') {
    // Always pull the latest from localStorage so a sale made in another tab
    // (or any state drift) shows up immediately.
    state.orders = loadOrders();
    renderOrders();
  }
  if (view === 'items') renderItems();
  if (view === 'customers') renderCustomers();
  if (view === 'reports') renderReports();
  if (view === 'checkout') renderCheckout();
}

// Checkout keeps the sale's sidebar on screen (Simplified 2, cart-lab-checkout-2.js). The pane covers only what is
// left of it; the sidebar tucks away in place what paying doesn't need (fulfilment, the ⋯, Discount, Check out), the
// fulfilment shows on the customer row and the Total stays put. Nothing flies: the pane fades in and out. Under
// 721px the sidebar sits below the products, so styles.css keeps the full-screen checkout there.
function tuckRail(on) {
  const side = $('#side');
  clearTimeout(tuckRail._t); side.classList.add('co-anim');
  side.classList.toggle('co-mode', on);
  tuckRail._t = setTimeout(() => side.classList.remove('co-anim'), 300);
}
function fitCheckout() {
  const side = $('#side');
  if (!$('#app').classList.contains('co-side') || !side.offsetWidth) return;
  $('.view-checkout').style.setProperty('--co-right', `${$('.main').getBoundingClientRect().right - side.getBoundingClientRect().left}px`);
}
function railCheckout(on, fade) {
  const app = $('#app'), side = $('#side'), pane = $('.view-checkout');
  const end = () => {
    $('.rail-rcpt', side)?.remove(); $('.co-meta', side)?.remove();
    pane.classList.remove('co-leaving'); pane.getAnimations().forEach(a => a.cancel());
    app.classList.remove('co-side');
  };
  clearTimeout(railCheckout._t);
  if (pane.classList.contains('co-leaving')) end();          // Check out tapped again mid fade-out
  if (on) {
    if (app.classList.contains('co-side')) return;
    app.classList.add('co-side');
    fitCheckout();
    const meta = document.createElement('span'); meta.className = 'co-meta'; meta.textContent = fulfilLabel();
    $('#customerBtn').insertBefore(meta, $('#customerBtn .chev'));
    tuckRail(true);
    pane.animate({ opacity: [0, 1] }, { duration: calmMs(200), easing: 'ease-out' });
    return;
  }
  if (!app.classList.contains('co-side')) return;
  tuckRail(false);
  if (!fade) return end();
  pane.classList.add('co-leaving');
  [pane, $('.rail-rcpt', side), $('.co-meta', side)].forEach(el => el?.animate({ opacity: [1, 0] }, { duration: calmMs(140), fill: 'forwards' }));
  railCheckout._t = setTimeout(end, calmMs(150));
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
}

function getFilteredSellProducts() {
  let list = state.products;
  if (state.query.trim()) {
    list = state.fuse.search(state.query.trim()).map(r => r.item);
  }
  if (state.folderId !== 'all') {
    list = list.filter(p => p.folder === state.folderId);
  }
  if (searchIntent && state.query.trim()) searchIntent.results = list.length;   // the count the cashier saw
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
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="pc-name">${escapeHtml(p.name)}</div>
      <div class="pc-price-mini">${peso(p.price)}</div>
    </div>`;
}

function updateProductTrackPosition() {
  const track = $('#productTrack');
  if (track) {
    const grid = $('#productGrid');
    const gap = grid ? (parseFloat(getComputedStyle(track).gap) || 0) : 0;
    const step = (grid ? grid.clientWidth : 0) + gap;
    track.style.transform = `translate3d(-${(state.page - 1) * step}px, 0, 0)`;
  }
  renderSellHeader();
}

function renderProducts() {
  const grid = $('#productGrid');
  const cells = getSellCells();
  const profile = getSellGridProfile();

  // Set size + price-display attrs on the grid
  grid.dataset.size = state.tileSize;
  grid.dataset.text = state.tileText;
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
        ${state.query.trim() ? `<button class="text-btn nr-lost" type="button" data-act="lost-sale">Log “${escapeHtml(state.query.trim())}” as a lost sale</button>` : ''}
      </div>`;
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
  // Tiles always fill the full column width so they align to the catalog edges
  const tileWidth = Math.max(1, (grid.clientWidth - gap * (columns - 1)) / columns);
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
    return `
      <button class="variant-tile ${sel}" data-variant-id="${p.id}">
        <span class="vt-name">${escapeHtml(p.name)}</span>
        <span class="vt-price">${peso(p.price)}</span>
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
  const p = state.products.find(x => x.id === state.variantModal.selectedId);
  // The buttons still step by a whole unit even for wire -- nobody taps + a hundred times
  // to buy a metre. The typed field is what carries the fraction.
  const q = qtyFrom(p, parseFloat(input.value) + delta, stepFor(p));
  input.value = q;
  state.variantModal.qty = q;
}

function addVariantToCart() {
  const vm = state.variantModal;
  if (!vm.selectedId) { showToast('Pick a variant first'); return; }
  const p = state.products.find(x => x.id === vm.selectedId);
  if (!p) return;

  const qty = qtyFrom(p, $('#variantQtyInput').value);
  const comment = $('#variantCommentInput').value.trim();

  beginCart();
  const existing = state.cart.find(i => i.id === p.id && (i.comment || '') === comment);
  if (existing) existing.qty += qty;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty,
    comment: comment || undefined,
  });

  trackItemAdd(p, qty, 'variant');
  renderCart();
  showToast(`Added · ${qty} × ${p.name}`);
  $('#variantModal').hidden = true;
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
  $$('.bb-size-btn[data-size]').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  renderProducts();
}

function setTileText(size) {
  if (!TILE_TEXT_SIZES.includes(size)) return;
  state.tileText = size;
  storageSet(STORAGE_TILE_TEXT, size);
  renderProducts();
}

function toggleShowPrice() {
  state.showPrice = !state.showPrice;
  storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);
  renderProducts();
}

// ---------- Cart ----------
// Every quantity typed anywhere in the POS comes through here. `parseInt` used to live at
// each of these inputs, which sold 2 metres of the 2.5 the customer asked for; `roundQty`
// (bo-model.js) is the one definition of what a quantity may be for a given product, so the
// till and the back office can never disagree about it.
const productOf = (item) => state.products.find(p => p.id === (item.productId || item.id));

function qtyFrom(product, value, fallback = 1) {
  const n = roundQty(product, parseFloat(value));
  return n > 0 ? n : fallback;
}

function addToCart(productId, via = 'other') {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  beginCart();
  const existing = state.cart.find(i => i.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty: 1,
  });
  trackItemAdd(p, 1, via);
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
  track('scan', { code, found: !!product, productId: product ? product.id : '' });
  if (!product) {
    const message = source === 'camera'
      ? `No item found for ${code}`
      : 'No item found for that barcode or SKU';
    showBarcodeStatus(message);
    showToast(message);
    return false;
  }
  addToCart(product.id, 'scan');
  const search = $('#searchInput');
  const clear = $('#searchClear');
  if (search) {
    search.value = '';
    state.query = '';
  }
  endSearch();
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
  state.cartId = '';
  state.cartStartedAt = 0;
  state.customer = null;
  state.cartDiscount = null;
  state.tierDiscountDismissed = false;
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
  const p = productOf(state.cart.find(i => i.id === state.cartItemModal.id) || {});
  const q = qtyFrom(p, (parseFloat(input.value) || 0) + delta, stepFor(p));
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
  const q = qtyFrom(productOf(item), $('#cimQtyInput').value);
  const gross = item.price * q;
  const disc = getCartItemModalDiscount();
  const { net } = applyDiscount(gross, disc);
  $('#cimLineTotal').textContent = peso(net);
}
function saveCartItemEdit() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = qtyFrom(productOf(item), $('#cimQtyInput').value);
  if (q !== item.qty) track('item_qty', { productId: item.id, from: item.qty, to: q });
  item.qty = q;
  const disc = getCartItemModalDiscount();
  const was = item.discount || null;
  if (JSON.stringify(disc) !== JSON.stringify(was)) {
    track('discount', { scope: 'line', kind: (disc || was).type, value: disc ? disc.value : 0, productId: item.id });
  }
  if (disc) item.discount = disc; else delete item.discount;
  renderCart();
  $('#cartItemModal').hidden = true;
}
function removeCartItemFromModal() {
  const id = state.cartItemModal.id;
  if (!id) return;
  const gone = state.cart.find(i => i.id === id);
  if (gone) track('item_remove', { productId: gone.id, qty: gone.qty, unitPrice: gone.price });
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
  $('#cartItemModal').hidden = true;
  showToast('Item removed');
}

// ---------- Cart-level discount modal ----------
function openCartDiscountModal() {
  if (state.cart.length === 0) {
    flashControl($('#cartDiscountBtn'));
    flashControl($('#side'));
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
  track('discount', { scope: 'cart', kind: type, value: value > 0 ? value : 0 });
  renderCart();
  $('#cartDiscountModal').hidden = true;
}
function clearCartDiscount() {
  if (state.cartDiscount) track('discount', { scope: 'cart', kind: state.cartDiscount.type, value: 0 });
  state.cartDiscount = null;
  state.tierDiscountDismissed = true;
  renderCart();
  $('#cartDiscountModal').hidden = true;
  flashControl($('#cartDiscountBtn'));
}

// ---------- Fulfilment (Pickup / Delivery / whatever the owner added) ----------
function setFulfilment(mode) {
  if (!fulfilMethods(state.settings).some(m => m.key === mode)) return;
  if (mode === 'delivery') {
    // Address is optional; prefill it when we already know one.
    const addr = state.deliveryAddress || (state.customer && state.customer.address) || '';
    $('#deliveryAddrInput').value = addr;
    updateDeliveryPinStatus();
    $('#deliveryModal').hidden = false;
    return;
  }
  state.fulfilment = mode;
  state.deliveryAddress = '';
  state.deliveryLocation = null;
  renderCart();
}

// The types the owner configured (Pickup can't be removed): one picker that opens into the list -- half a row has
// no room for a toggle.
const RAIL_UPDOWN = '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';
function renderFulRow() {
  const row = $('#fulRow');
  if (!row) return;
  const methods = fulfilMethods(state.settings);
  // A hidden or deleted type must not stay selected on the cart in front of the cashier.
  if (!methods.some(m => m.key === state.fulfilment)) state.fulfilment = 'pickup';
  const cur = methods.find(m => m.key === state.fulfilment) || methods[0];
  row.innerHTML = `<button type="button" class="pick" id="fulPick" aria-haspopup="menu" aria-expanded="false"><span>${escapeHtml(cur.label)}</span>${RAIL_UPDOWN}</button>`;
}
const fulfilLabel = () => (fulfilMethods(state.settings).find(m => m.key === state.fulfilment) || { label: 'Pickup' }).label;

// Settings -> Item / Amount header. Off: the rows explain themselves and the count moves beside Total.
function applyCartHead(on) {
  state.cartHead = on;
  document.body.classList.toggle('rail-nohead', !on);
  const cb = $('#posCartHead'); if (cb) cb.checked = on;
}

// ---------- The morph menu (cart-lab-stack-c.html) ----------
// The menu grows out of its trigger's own box, each item the trigger's height, always in the same order (the hand
// learns where each choice is); the current one is only bold. A pick, a tap outside or Esc shrinks it back.
// items: [{label, run, cur, red, off}] or '-' for a divider. opts.w: width (default the trigger's), opts.right: right-align.
const calmMs = ms => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
let railMenu = null;
function openMenu(trigger, items, opts = {}) {
  const r = trigger.getBoundingClientRect(), cs = getComputedStyle(trigger);
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<div class="rail-menu" role="menu">${items.map((it, i) => it === '-' ? '<hr>'
    : `<button type="button" role="menuitem" data-i="${i}" class="${it.cur ? 'cur' : ''}${it.red ? ' red' : ''}" style="height:${r.height}px"${it.off ? ' disabled' : ''}><span>${escapeHtml(it.label)}</span></button>`).join('')}</div>`;
  const m = veil.firstChild, pad = 4, w = opts.w || r.width;
  m.style.cssText = `width:${w}px;--pl:${Math.max(12, parseFloat(cs.paddingLeft) - pad)}px;--pr:${Math.max(8, parseFloat(cs.paddingRight) - pad)}px`;
  document.body.append(veil);
  const anchor = m.querySelector('button'), H = m.offsetHeight;
  const left = Math.max(0, Math.min(innerWidth - w, opts.right ? r.right - w : r.left));
  const top = Math.max(8, Math.min(innerHeight - H - 8, r.top - anchor.offsetTop));
  m.style.left = left + 'px'; m.style.top = top + 'px';
  const t = r.top - top, l = r.left - left;
  const from = `inset(${t}px ${w - l - r.width}px ${H - t - r.height}px ${l}px round 10px)`, to = 'inset(-24px round 34px)';
  m.style.transformOrigin = `${l + r.width / 2}px ${t + r.height / 2}px`;
  m.animate([{ clipPath: from, transform: 'scale(.94)', boxShadow: 'none' }, { clipPath: to, transform: 'none' }], { duration: calmMs(180), easing: 'cubic-bezier(.3,1.45,.55,1)' });
  trigger.setAttribute('aria-expanded', 'true');
  railMenu = { veil, m, from, to, trigger };
  (m.querySelector('button:not(:disabled)') || anchor).focus({ preventScroll: true });
  veil.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b || e.target === veil) closeMenu();
    if (b) items[b.dataset.i].run();
  });
  veil.addEventListener('keydown', e => {
    const bs = [...m.querySelectorAll('button:not(:disabled)')], i = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); trigger.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus(); }
  });
}
function closeMenu() {
  if (!railMenu) return;
  const { veil, m, from, to, trigger } = railMenu; railMenu = null;
  trigger.setAttribute('aria-expanded', 'false');
  veil.style.pointerEvents = 'none';
  m.animate([{ clipPath: to }, { clipPath: from, opacity: 0, transform: 'scale(.96)' }], { duration: calmMs(90), easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = () => veil.remove();
}

function saveDeliveryAddress() {
  const addr = $('#deliveryAddrInput').value.trim();
  state.fulfilment = 'delivery';
  state.deliveryAddress = addr;
  $('#deliveryModal').hidden = true;
  renderCart();
  flashControl($('#fulRow'));
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
  $('#custType').value = 'retail';
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
    type: $('#custType').value || 'retail',
    creditLimit: 0,
    currentBalance: 0,
  };
  state.customers.push(c);
  saveSavedCustomers();
  track('customer_create', { customerId: c.id });
  $('#customerEditModal').hidden = true;
  if (state.view === 'customers') renderCustomers();
  showToast(`Added “${name}”`);
  // When created mid-sale from the Sell-page picker, attach the new customer to
  // the current receipt straight away (selectCustomer closes the picker too).
  if (state.customerEditFromSale) {
    state.customerEditFromSale = false;
    selectCustomer(c.id);
  }
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
  const cartDisc = applyDiscount(lineGross - lineDiscount, state.cartDiscount);
  // Round ONCE, here, then derive the rest from the rounded pair. Rounding the subtotal, the
  // discount and the total independently put a 5% tier at sub 1219.30 - disc 60.97 = 1158.33
  // against a total of 1158.34, and a receipt whose lines don't add up is a BIR problem, not
  // a cosmetic one. Same for VAT: vatable + vat must equal the total exactly.
  const subtotal = moneyValue(lineGross);
  const total = moneyValue(cartDisc.net);
  const vatRate = (typeof state.vatRate === 'number') ? state.vatRate : 0.12;
  // VAT-inclusive (Philippine 12%): the displayed prices already include VAT.
  const vatAmount = vatRate > 0 ? moneyValue(total * (vatRate / (1 + vatRate))) : 0;
  return {
    subtotal,
    discount: moneyValue(subtotal - total),
    // ponytail: the two components still round on their own, so they can each sit a centavo
    // off the derived total when a line AND a receipt discount are both in play. They are a
    // breakdown, not the money -- `discount` above is what the receipt and the order carry.
    cartDiscountOff: moneyValue(cartDisc.off),
    lineDiscountOff: moneyValue(lineDiscount),
    total,
    vatRate,
    vatAmount,
    vatableSales: moneyValue(total - vatAmount),
  };
}

function renderCart() {
  const list = $('#cartList');
  const t = cartTotals();
  const n = state.cart.length;
  if (n === 0) {
    list.innerHTML = '<div class="empty"><b>No items yet</b><span>Tap a product to add it.</span></div>';
  } else {
    list.innerHTML = state.cart.map(item => `
      <div class="line"><button type="button" class="row" data-id="${item.id}" title="Edit item">
        <span class="nm"><span>${escapeHtml(item.name)}</span><small class="num">${item.qty} × ${peso(item.price)}</small></span>
        <span class="amt num">${peso(item.price * item.qty)}</span>
      </button></div>`).join('');
    list.scrollTop = list.scrollHeight;
  }

  const count = n ? `${n} item${n === 1 ? '' : 's'}` : '';
  $('#cartCount').textContent = count || 'Item';
  $('#railCount').textContent = count;          // beside Total when the band is off
  $('#subtotal').textContent = peso(t.subtotal);
  $('#discount').textContent = '-' + peso(t.discount);
  $('#discountRow').style.display = t.discount > 0 ? '' : 'none';
  $('#vatAmount').textContent = peso(t.vatAmount);
  $('#total').textContent = peso(t.total);
  $('#payBtn').disabled = n === 0;
  $('#side').classList.toggle('empty-cart', n === 0);

  renderFulRow();
  const cd = state.cartDiscount && state.cartDiscount.value ? state.cartDiscount : null;
  const discBtn = $('#cartDiscountBtn');
  discBtn.disabled = n === 0;
  discBtn.classList.toggle('on', !!cd);
  $('#cartDiscountLabel').textContent = cd && cd.type === 'percent' ? `Discount ${cd.value}%` : 'Discount';
  $('#cartDiscountAmt').textContent = t.discount > 0 ? '−' + peso(t.discount) : '';
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
  const prev = state.customer;
  if (id === 'walk-in') {
    state.customer = null;
  } else {
    state.customer = allCustomerRecords().find(c => c.id === id) || null;
    if (state.customer && state.customer.address && state.fulfilment === 'delivery') {
      state.deliveryAddress = state.customer.address;
    }
  }
  const next = state.customer;
  if (prev && prev.id !== (next && next.id)) track('customer_detach', { customerId: prev.id });
  if (next && next.id !== (prev && prev.id)) track('customer_attach', { customerId: next.id, tier: next.type || '' });
  state.cartDiscount = null;
  state.tierDiscountDismissed = false;
  updateCustomerButton();
  $('#customerModal').hidden = true;
  renderCart();
  if (state.view === 'checkout') renderCheckout();
}

// ---------- Payment (full-page Checkout view) ----------
function openPaymentModal() {
  if (state.cart.length === 0) return;
  state.prevView = state.view;
  state.paymentMethodChosen = false;
  const tierRate = getTierDiscount(state.customer);
  if (tierRate > 0 && !state.cartDiscount && !state.tierDiscountDismissed) {
    state.cartDiscount = { type: 'percent', value: tierRate * 100, tierType: state.customer.type };
    track('discount', { scope: 'cart', kind: 'percent', value: tierRate * 100, tier: state.customer.type });
  }
  track('checkout_open', { lines: state.cart.length, subtotal: cartTotals().subtotal });
  switchView('checkout');
  renderCheckout();
}
function renderCheckout() {
  const t = cartTotals();
  const total = t.total;

  const cartList = $('#checkoutCartList');
  if (cartList) {
    cartList.innerHTML = state.cart.map(item => `
      <div class="co-row">
        <span class="co-nm">${escapeHtml(item.name)}<small class="num">${item.qty} × ${peso(item.price)}</small></span>
        <span class="co-amt num">${peso(item.price * item.qty)}</span>
      </div>`).join('');
  }
  const discRow = $('#checkoutDiscountRow');
  if (discRow) discRow.hidden = !(t.discount > 0);
  const discEl = $('#checkoutDiscount');
  if (discEl) discEl.textContent = '−' + peso(t.discount);
  const discLabel = $('#checkoutDiscountLabel');
  if (discLabel) {
    if (state.cartDiscount?.tierType) {
      const tierName = state.customer?.type || state.cartDiscount.tierType || 'Customer';
      discLabel.textContent = `${tierName.charAt(0).toUpperCase() + tierName.slice(1)} discount (${state.cartDiscount.value}%)`;
    } else {
      discLabel.textContent = 'Discount';
    }
  }
  const totalEl = $('#checkoutTotal');
  if (totalEl) totalEl.textContent = peso(total);
  $('#checkoutCount').textContent = $('#railCount').textContent;
  const totalDue = $('#checkoutTotalDue');
  if (totalDue) totalDue.textContent = peso(total);

  setCheckoutError('');
  if (!state.customer && (state.paymentMethod === 'credit' || state.paymentMethod === 'split')) {
    state.paymentMethod = 'cash';
  }
  // You can only charge a named account, so the two credit tiles appear with the customer.
  applyPayMethods(!!state.customer);
  renderQuickCashOptions(total);
  if (!state.paymentMethodChosen) state.paymentMethod = 'cash';
  $('#checkoutApp')?.classList.remove('is-done');
  const steps = $('#checkoutSteps'); if (steps) steps.hidden = false;
  const done = $('#checkoutDone'); if (done) done.hidden = true;
  const tender = $('#checkoutTender'); if (tender) tender.value = '';
  showPayStep();
  renderCheckoutSub();
}

// Which cards the checkout shows is the back office's call (Manage -> Payments):
// settings.payments = { hidden: [kind], custom: [name] }. Cash can't be hidden -- the drawer
// is cash. A custom name records exactly like typing it into Other (paymentKind 'other').
const coIcon = d => `<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const PAY_TILES = [
  ['cash', 'Cash', coIcon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7"/><circle cx="12" cy="14" r="3"/>')],
  ['gcash', 'GCash', coIcon('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01" stroke-width="2.4"/>')],
  ['qr', 'QR', coIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2v2h2M18 14h3M18 18h1v1h1v2M21 14v2M14 18v3h2"/>')],
  ['other', 'Other', coIcon('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>')],
  ['credit', 'Account', coIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>')],
  ['split', 'Split', coIcon('<path d="M12 3v18M4 7h5M4 12h5M15 9h5M15 15h5"/>')],
];
const CUSTOM_PAY_ICON = coIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="2.5"/>');
function applyPayMethods(canCharge) {
  const grid = $('#checkoutMethods');
  if (!grid) return;
  const pay = state.settings.payments || {};
  const off = new Set(pay.hidden || []);
  const needsAccount = m => m === 'credit' || m === 'split';
  const shown = PAY_TILES.filter(([m]) => m === 'cash' || (!off.has(m) && (canCharge || !needsAccount(m))));
  const custom = (pay.custom || []).map(name => ['other', name, CUSTOM_PAY_ICON, name]);
  const at = shown.findIndex(([m]) => needsAccount(m));
  const tiles = at < 0 ? [...shown, ...custom] : [...shown.slice(0, at), ...custom, ...shown.slice(at)];
  // How many across the count wants: 4 -> 2x2, 6 -> 3x2, 8 -> 4x2. One tile size at any count.
  grid.style.setProperty('--cols', tiles.length <= 4 ? 2 : tiles.length <= 6 ? 3 : 4);
  grid.innerHTML = tiles.map(([m, label, icon, name]) =>
    `<button type="button" class="co-tile" data-co-method data-method="${m}"${name ? ` data-label="${escapeHtml(name)}"` : ''}>${icon}<span>${escapeHtml(label)}</span></button>`).join('');
}

// Who this sale is for, on top of the list it belongs to.
function renderCheckoutSub() {
  const sub = $('#checkoutSub');
  if (sub) sub.textContent = state.customer ? state.customer.name : 'Walk-in customer';
}

// Under the fixed total: the method tiles, or the chosen method's one detail.
function showPayStep() {
  const m = state.paymentMethod;
  const step = !state.paymentMethodChosen ? 'method' : (m === 'cash' || m === 'split') ? 'cash' : 'paid';
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== step; });
  const backText = $('#checkoutBackText'); if (backText) backText.textContent = step === 'method' ? 'Cancel' : 'Back';
  // On a split the field means the opposite thing: what they pay now, the rest goes on the account.
  const quick = $('#checkoutQuick'); if (quick) quick.hidden = m === 'split';
  const tender = $('#checkoutTender');
  if (tender) tender.placeholder = m === 'split' ? 'Cash now' : 'Other amount';
  const typing = m === 'other' && !state.paymentLabel;
  const other = $('#otherMethodInput'); if (other) other.hidden = !typing;
  const ask = $('#checkoutAsk');
  if (ask) ask.textContent = m === 'credit' ? `Charge to ${state.customer?.name || 'account'}`
    : typing ? 'Paid with' : `Paid with ${state.paymentLabel || KNOWN_METHOD_LABELS[m] || m}`;
  updateChange();
  if (step === 'method') centreCheckout();
}

// Centre what you see -- the top of the total's digits to the bottom of the method tiles -- 3% above
// the middle of the payment column (dead centre reads low). Set from the method step only, so later
// steps grow downward and the total never moves.
function centreCheckout() {
  const steps = $('#checkoutSteps'), hero = $('#checkoutTotalDue');
  const method = $('#checkoutSteps [data-step="method"]'), col = $('.co-pay');
  if (!steps || !hero || !method || method.hidden || state.view !== 'checkout') return;
  steps.style.setProperty('--lift', '0px');
  const cs = getComputedStyle(hero);
  const inkTop = hero.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.fontSize) * 0.14; // Inter digits start ~.14em into a line-height:1 box
  const box = col.getBoundingClientRect();
  const lift = box.top + box.height * 0.47 - (inkTop + method.getBoundingClientRect().bottom) / 2;
  steps.style.setProperty('--lift', `${Math.max(0, Math.round(lift))}px`);
}

function updateChange() {
  const { total } = cartTotals();
  const raw = ($('#checkoutTender')?.value || '').trim();
  const tender = moneyValue(parseFloat(raw) || 0);
  const split = state.paymentMethod === 'split';
  const d = moneyValue(tender - total);
  const ok = split ? tender > 0 && d < 0 : d >= 0;
  const el = $('#checkoutChange');
  if (el) {
    el.textContent = !raw ? ''
      : split ? (d < 0 ? `On account ${peso(-d)}` : 'Use Cash for the full amount')
      : d < 0 ? `Short ${peso(-d)}` : d > 0 ? `Change ${peso(d)}` : 'No change';
    el.className = 'co-change num' + (!raw ? '' : !ok ? ' down' : split ? '' : ' up');
  }
  const go = $('#checkoutCompleteBtn'); if (go) go.disabled = !raw || !ok;
  setCheckoutError('');
}

// Quick cash: Exact, then the next ₱500 / ₱1,000 / ₱5,000 / ₱10,000 above the total -- three of them, never below it.
function quickTenders(total) {
  const c = Math.round(total * 100);
  const above = m => (Math.floor(c / m) + 1) * m / 100;
  return [c / 100, ...new Set([50000, 100000, 500000, 1000000].map(above))].slice(0, 4);
}
console.assert(quickTenders(437.5).join() === '437.5,500,1000,5000' && quickTenders(24318.75).join() === '24318.75,24500,25000,30000'
  && quickTenders(500).join() === '500,1000,5000,10000', 'quickTenders');

function renderQuickCashOptions(total) {
  const wrap = $('#checkoutQuick');
  if (!wrap) return;
  const q = quickTenders(total);
  const short = v => peso(v).replace(/\.00$/, '');
  wrap.parentElement.style.setProperty('--cols', q.length); // the tiles and the cash row below share one width
  wrap.innerHTML = q.map((v, i) => `<button type="button" class="co-tile" data-co-cash="${v}">${i === 0
    ? '<span class="co-big">Exact</span><small>No change</small>'
    : `<span class="co-big num">${short(v)}</span><small class="up num">Change ${peso(moneyValue(v - total))}</small>`}</button>`).join('');
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

// Stock is the sum of the movement log, not a number three code paths overwrite. Every
// sale, void and exchange writes the row that explains it and lets `applyMovement` update
// the cached `product.stock`, so the shelf, the receipt and Inventory can never disagree.
// `unitCost` is the cost stamped on the line, not today's, for the same reason margins are.
function moveStock(items, { reason, refId = '', note = '', sign = -1 }) {
  const rows = [];
  (items || []).forEach((item) => {
    const p = productOf(item);
    if (!p) return;
    const qty = sign * toNumber(item.qty, 0);
    if (!qty) return;
    const mv = makeMovement({
      productId: p.id, qty, reason, refId, note,
      unitCost: item.cost != null ? item.cost : p.cost,
      staff: currentStoreInfo().cashier,
    });
    applyMovement(p, mv);
    rows.push(mv);
  });
  if (!rows.length) return;
  appendMovements(rows);
  saveProducts();
}

function restoreOrderStock(order, note = '') {
  moveStock(order.items, { reason: 'return', refId: order.id, note, sign: 1 });
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
  if (state.view !== 'checkout') switchView('checkout');
  // The only big number is the change to hand back; method, cash and total are on the receipt.
  const change = moneyValue(order.change || 0);
  const changeBlock = $('#successChangeBlock');
  if (changeBlock) changeBlock.hidden = !(change > 0);
  const changeEl = $('#successChange');
  $('#checkoutSteps').hidden = true;
  $('#checkoutDone').hidden = false; // un-hiding replays the check and the rise
  $('#checkoutApp').classList.add('is-done');
  const receipt = $('#checkoutReceipt');
  if (receipt) { receipt.innerHTML = buildReceiptPreview(order); receipt.scrollTop = 0; }
  if (receipt && $('#app').classList.contains('co-side')) {   // the receipt prints inside the sidebar's items card
    const rc = document.createElement('div'); rc.className = 'rail-rcpt'; rc.innerHTML = receipt.innerHTML;
    $('#side .rail-rcpt')?.remove(); $('#side .items').append(rc);
    // the cart is already cleared; the Total keeps showing the sale until New sale
    const n = (order.items || []).length;
    $('#total').textContent = peso(order.total);
    $('#railCount').textContent = `${n} item${n === 1 ? '' : 's'}`;
    $('#side').classList.remove('empty-cart');
  }
  if (changeEl && change > 0) {
    changeEl.classList.remove('settled');
    changeEl.textContent = peso(0);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(showCheckoutSuccess._t);
    showCheckoutSuccess._t = setTimeout(() => {
      const t0 = performance.now();
      const step = (now) => {
        const k = still ? 1 : Math.min(1, (now - t0) / 700);
        changeEl.textContent = peso(change * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(step); else changeEl.classList.add('settled');
      };
      requestAnimationFrame(step);
    }, still ? 0 : 280);
  }
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
  printOrder(order);
}

// ---------- Printing ----------

function printerConfig() {
  return { ...DEFAULT_SETTINGS.printing, ...(state.settings.printing || {}) };
}

// Subnets worth sweeping: whatever the typed IP or the page's own LAN address implies, then the common defaults.
function printerScanSubnets() {
  const out = [];
  const add = (ip) => {
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip || '').trim());
    if (m && !out.includes(m[1])) out.push(m[1]);
  };
  add($('#posPrinterIp')?.value);
  add(location.hostname);
  ['192.168.1', '192.168.0'].forEach(n => { if (!out.includes(n)) out.push(n); });
  return out;
}

// Printers found by the last scan. A hit can only be identified by IP: the ePOS probe
// answers with an empty job result (no model name) and the printer's own web page is
// CORS-blocked, so there is nothing else to read.
// ponytail: the probe reply also carries a status="" ASB bitfield — decode it here if
// paper-out / cover-open ever needs to show on the row.
let printerFound = [];

// The trailing element of a printer row. Every state swaps this one slot, so the
// feedback lands on the row the finger actually touched.
function printerRowState(kind, label) {
  if (kind === 'connected') return '<span class="status-pill ok"><span class="dot"></span>Connected</span>';
  if (kind === 'offline') return '<span class="status-pill out"><span class="dot"></span>' + escapeHtml(label || 'Offline') + '</span>';
  if (kind === 'busy') return '<span class="prn-item-action"><span class="prn-spin"></span>' + escapeHtml(label || 'Connecting…') + '</span>';
  return '<span class="prn-item-action">Connect</span>';
}

function printerRow(ip) {
  return [...($('#posPrinterList')?.querySelectorAll('.prn-item') || [])]
    .find(el => el.dataset.ip === ip) || null;
}

function setPrinterRowState(ip, kind, label) {
  const slot = printerRow(ip)?.querySelector('.prn-item-state');
  if (slot) slot.innerHTML = printerRowState(kind, label);
}

function renderPrinterList() {
  const wrap = $('#posPrinterList');
  if (!wrap) return;
  const saved = (printerConfig().netUrl || '').trim();
  const ips = [...new Set([...(saved ? [saved] : []), ...printerFound])];
  if (!ips.length) {
    wrap.innerHTML = '<div class="prn-empty">No printer connected. Tap Scan to search your Wi-Fi.</div>';
    return;
  }
  wrap.innerHTML = ips.map(ip => `
    <button class="prn-item${ip === saved ? ' connected' : ''}" data-ip="${escapeHtml(ip)}">
      <div>
        <div class="prn-item-name">Epson ePOS printer</div>
        <div class="prn-item-ip">${escapeHtml(ip)}</div>
      </div>
      <span class="prn-item-state">${printerRowState(ip === saved ? 'connected' : 'idle')}</span>
    </button>`).join('');
}

function setScanStatus(text) {
  const el = $('#posScanStatus');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

// Connecting is a real round-trip (up to 4s), not just saving a string — the row
// spins while it waits and only says "Connected" once the printer has answered.
let printerBusy = false;
async function connectPrinter(ip) {
  if (printerBusy) return false;
  printerBusy = true;
  const list = $('#posPrinterList');
  const row = printerRow(ip);
  list?.classList.add('busy');
  row?.classList.add('busy-row');
  setPrinterRowState(ip, 'busy', 'Connecting…');
  setScanStatus('Connecting to ' + ip + '…');
  try {
    if (!await window.HWPOS_PRINTER.probe(ip, 4000)) {
      setPrinterRowState(ip, 'offline', 'No answer');
      setScanStatus(ip + ' did not answer. Check it is powered on and on this Wi-Fi.');
      showToast('Could not reach ' + ip);
      setTimeout(() => { if (!printerBusy) setPrinterRowState(ip, 'idle'); }, 2500);
      return false;
    }
    const input = $('#posPrinterIp');
    if (input) input.value = ip;
    persistPosSettings();
    if (!printerFound.includes(ip)) printerFound.push(ip);
    renderPrinterList();
    setScanStatus('Connected to ' + ip);
    showToast('Printer connected');
    return true;
  } finally {
    printerBusy = false;
    list?.classList.remove('busy');
    row?.classList.remove('busy-row');
  }
}

// Re-check the saved printer whenever Settings opens, so a printer that was
// unplugged since last time shows Offline instead of a stale "Connected".
async function refreshPrinterStatus() {
  const cfg = printerConfig();
  const saved = (cfg.netUrl || '').trim();
  if (!saved || cfg.driver !== 'network') return;
  setPrinterRowState(saved, 'busy', 'Checking…');
  if (await window.HWPOS_PRINTER.probe(saved, 3000)) {
    setPrinterRowState(saved, 'connected');
    return;
  }
  setPrinterRowState(saved, 'offline', 'Offline');
  printerRow(saved)?.classList.remove('connected');
}

function sampleTestOrder() {
  const store = currentStoreInfo();
  return {
    id: 'test', number: 'TEST-0001', ts: Date.now(),
    cashier: store.cashier, register: store.registerNo,
    fulfilment: 'pickup', status: 'completed', paymentMethod: 'cash',
    items: [
      { id: 't1', name: 'Portland Cement 40kg', qty: 2, unit: 'bag', price: 285, lineTotal: 570 },
      { id: 't2', name: 'Common Wire Nail 3in', qty: 1, unit: 'kg', price: 95.5, lineTotal: 95.5 },
    ],
    subtotal: 665.5, discount: 0, total: 665.5,
    payments: [{ method: 'cash', amount: 665.5, tendered: 1000, change: 334.5 }],
  };
}

// Single entry point for every receipt. Only the 'browser' driver opens the pop-up.
// ponytail: a hardware driver that fails must say why and stop. It used to fall back to
// the pop-up, whose auto window.print() reads as "the app printed to the browser instead
// of the printer" and buries the real error toast under a new tab.
async function printOrder(order, opts = {}) {
  const cfg = printerConfig();
  if (cfg.driver !== 'network' && cfg.driver !== 'bluetooth') {
    openReceipt(order);
    track('receipt_print', { orderId: order.id, ok: true });   // browser driver: ok = pop-up opened
    return true;
  }
  try {
    await window.HWPOS_PRINTER.print(toReceiptViewModel(order), cfg);
    track('receipt_print', { orderId: order.id, ok: true });
    if (!opts.silent) showToast('Receipt printed');
    return true;
  } catch (e) {
    track('receipt_print', { orderId: order.id, ok: false });
    showToast(e.message || 'Print failed');
    return false;
  }
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
    track('cart_hold', { lines: order.items.length });
    showOrderAfterCartClears(order);
  } catch (err) {
    console.error(err);
    showToast('Receipt was not saved. Check browser storage.');
    flashControl($('#cartMoreBtn'));
  }
}

// How far past the customer's limit this sale would push them, in pesos. 0 = fine.
// `buildOrderPayments` is the definition of what actually goes on account, so this
// splits the tender the same way it does and can't drift from what gets charged.
function creditOverLimit(tendered = 0) {
  const c = state.customer;
  const limit = toNumber(c && c.creditLimit, 0);
  if (!c || limit <= 0) return 0;
  const { total } = cartTotals();
  const charge = buildOrderPayments({ status: 'completed', paymentMethod: state.paymentMethod, total, tendered })
    .filter(p => p.method === 'credit')
    .reduce((sum, p) => sum + p.amount, 0);
  if (charge <= 0) return 0;
  return Math.max(0, moneyValue(toNumber(c.currentBalance, 0) + charge - limit));
}

// What the cart is asking for that the shelf does not have. `sellOutOfStock` was stored on
// every product, shown in the editor, mapped in the CSV and in schema.sql -- and read by no
// code path, so a cart could drive Portland Cement to -218 bags and Inventory to a negative
// value at cost. Checked once here because every way of adding to the cart ends at checkout;
// a guard per entry point is four guards and three of them go stale.
// A manager can still override: on a shop floor the count is usually what is wrong, and
// refusing the sale outright would send a paying customer away over a bookkeeping error.
function stockShortfall(cart = state.cart) {
  return (cart || []).map((item) => {
    const p = productOf(item);
    if (!p || p.sellOutOfStock) return null;
    const short = roundQty(p, toNumber(item.qty, 0) - toNumber(p.stock, 0));
    return short > 0 ? { id: p.id, name: p.name, short, unit: p.unit || 'pc' } : null;
  }).filter(Boolean);
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
  restoreOrderStock(order, reason);
  reverseOrderCredit(order, reason);
  const updated = saveOrderMutation({
    ...order,
    status: 'voided',
    reason,
    voidedAt: Date.now(),
  });
  track('void', { orderId, reason });
  renderOrders();
  renderReports();
  return updated;
}

function refundOrder(orderId, reason = 'Refunded by manager') {
  if (!requireManagerAction('Refund sale')) return null;
  const order = loadOrders().find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  restoreOrderStock(order, reason);
  reverseOrderCredit(order, reason);
  const updated = saveOrderMutation({
    ...order,
    status: 'refunded',
    reason,
    refundedAt: Date.now(),
  });
  track('refund', { orderId, amount: order.total, reason });
  renderOrders();
  renderReports();
  return updated;
}

function recordReturn(orderId, reason = 'Returned items') {
  if (!requireManagerAction('Return sale')) return null;
  const all = loadOrders();
  const order = all.find(o => o.id === orderId);
  if (!order || !isCompletedSale(order)) return null;
  // Void, refund and exchange flip the original's status, so a second attempt fails the check
  // above. A return deliberately leaves the original `completed` -- SALE_SIGN.return = -1 on
  // the separate return row is what cancels it -- so nothing stopped the same receipt being
  // returned twice: the goods went back on the shelf twice and the money went out twice.
  if (all.some(o => o.status === 'return' && o.originalOrderId === order.id)) {
    showToast(`${order.number} has already been returned`);
    return null;
  }
  restoreOrderStock(order, reason);
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
    // The money goes back the way it came in. Forcing a cash leg here paid ₱185 out of the
    // drawer for a sale that was charged to an account -- `reverseOrderCredit` above had
    // already taken it off the account, so a day with one account return closed short by
    // exactly the returned amount and nothing on the receipt said why.
    paymentMethod: order.paymentMethod,
    payments: (order.payments || []).map(p => ({
      ...p, label: 'Return', tendered: 0, change: 0, ref: order.number,
    })),
  });
  track('refund', { orderId, amount: order.total, reason });
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
      if (!product) return null;
      const qty = qtyFrom(product, item.qty);
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

  restoreOrderStock(order, reason);
  reverseOrderCredit(order, reason);
  const original = saveOrderMutation({
    ...order,
    status: 'refunded',
    reason,
    refundedAt: Date.now(),
  });
  track('refund', { orderId, amount: order.total, reason });

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
  // After the sale exists, so the movement can point at the receipt that caused it.
  moveStock(replacements, { reason: 'sale', refId: exchangeSale.id, note: 'Exchange' });
  track('sale_complete', {
    orderId: exchangeSale.id, total: exchangeSale.total, lines: exchangeSale.items.length,
    fulfilment: exchangeSale.fulfilment, customerId: exchangeSale.customer ? exchangeSale.customer.id : '',
    msSinceCartStart: null,
  });
  renderOrders();
  renderReports();
  return { original, exchangeSale };
}

function completeSale() {
  const totals = cartTotals();
  const total = moneyValue(totals.total);
  let tendered = total, change = 0;
  const isSplit = state.paymentMethod === 'split';
  const cashLike = ['cash', 'gcash', 'qr', 'other', 'split'].includes(state.paymentMethod);
  if (cashLike) {
    const tenderRaw = ($('#checkoutTender')?.value || $('#tenderInput')?.value || '').trim();
    tendered = tenderRaw ? moneyValue(parseFloat(tenderRaw) || 0) : total;
    // A short tender is the whole point of a split -- the rest goes on the account.
    // Demanding the full amount here made "Split" mean "cash", so it never left a balance.
    if (tendered < total && !isSplit) {
      setCheckoutError('Tendered amount is below the total.');
      $('#checkoutTender')?.focus();
      return;
    }
    change = moneyValue(Math.max(0, tendered - total));
  }
  if (isSplit && tendered >= total) {
    setCheckoutError('A split needs a cash amount below the total. Use Cash for the full amount.');
    $('#checkoutTender')?.focus();
    return;
  }
  if (state.paymentMethod === 'other') {
    const otherName = $('#otherMethodInput')?.value?.trim();
    if (!otherName) {
      setCheckoutError('Please enter the payment method name.');
      $('#otherMethodInput')?.focus();
      return;
    }
  }
  if (state.paymentMethod === 'credit' && !state.customer) {
    setCheckoutError('Select a customer before charging to account.');
    return;
  }
  // The limit was stored, shown on the customer card, and enforced nowhere -- a ₱5,000
  // account would take a ₱50,000 charge. A manager can still override it on the spot.
  const overBy = creditOverLimit(tendered);
  if (overBy > 0 && !window.confirm(
    `${state.customer.name} would go ₱${overBy.toFixed(2)} over their ₱${toNumber(state.customer.creditLimit, 0).toFixed(2)} credit limit.\n\nCharge anyway?`)) {
    setCheckoutError('Charge would exceed the credit limit.');
    return;
  }
  const short = stockShortfall();
  if (short.length && !window.confirm(
    `Not enough stock on hand:\n\n${short.map(s => `${s.name} — short ${s.short} ${s.unit}`).join('\n')}\n\nSell anyway?`)) {
    setCheckoutError(`Not enough ${short[0].name} in stock.`);
    // The customer walks out without it -- the exact moment demand used to leave no record.
    openLostSale({ product: state.products.find(p => p.id === short[0].id), qty: short[0].short });
    return;
  }
  const actualMethod = state.paymentMethod === 'other'
    ? ($('#otherMethodInput')?.value?.trim() || 'Other')
    : state.paymentMethod;
  let order;
  try {
    order = persistOrder(buildOrderRecord({
      status: 'completed',
      paymentMethod: actualMethod,
      tendered,
      change,
    }));
  } catch (err) {
    console.error(err);
    setCheckoutError('Receipt could not be saved. Sale was not completed.');
    return;
  }

  moveStock(order.items, { reason: 'sale', refId: order.id });
  applyCreditBalance(order);
  track('sale_complete', {
    orderId: order.id, total: order.total, lines: order.items.length, fulfilment: order.fulfilment,
    customerId: order.customer ? order.customer.id : '',
    msSinceCartStart: state.cartStartedAt ? Date.now() - state.cartStartedAt : null,
  });

  showCheckoutSuccess(order);
  // ponytail: auto-print only for real printers. The browser driver would fire a pop-up on every sale.
  const pcfg = printerConfig();
  if (pcfg.printOnSale && (pcfg.driver === 'network' || pcfg.driver === 'bluetooth')) {
    printOrder(order, { silent: true });
  }
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

// Lines, not the sum of the quantities: 2.5 m of wire plus a bag of cement is two items,
// not "3.5 items". Once anything is sold by measure, a qty sum stops being a count.
function orderItemCount(o) {
  return (o.items || []).length;
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
  if (o.paymentMethodLabel) return o.paymentMethodLabel;
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
        <div class="rp-center rp-thanks">Thank you!</div>
      </div>
    </div>`;
}

// pos-orders-rail-lab.html: the orders in a rail under ☰, grouped under day bands; the receipt beside it.
const ORDER_RANGES = [['today', 'Today', 0], ['yday', 'Yesterday', 1], ['week', 'Last 7 days', 6], ['all', 'All orders', Infinity]];
const ORDERS_FILTER_DEF = { range: 'week', staff: '', pay: '', status: '', fulfil: '' };
const dayStart = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const daysAgo = ts => Math.round((dayStart(Date.now()) - dayStart(ts)) / 864e5);
function orderDayName(ts) {
  const ago = daysAgo(ts);
  return ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : new Date(ts).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}
// What an order adds to its day's band: a return takes back, voided / refunded / saved add nothing.
function orderNet(o) {
  if (o.status === 'return') return -o.total;
  return isCompletedSale(o) ? o.total : 0;
}
function orderPayText(o) {
  return isSavedOrder(o) ? '' : (o.paymentMethodLabel || reportMethodMeta(reportMethodKind(o)).label);
}
const ORDER_FLAG = { voided: ['Voided', ''], refunded: ['Refunded', 'warn'], return: ['Return', 'warn'], saved: ['Not completed', 'warn'] };
function orderFlag(o, cls) {
  const f = ORDER_FLAG[isSavedOrder(o) ? 'saved' : o.status];
  return f ? `<span class="${cls} ${f[1]}">${f[0]}</span>` : '';
}
const ordersFiltered = () => Object.keys(ORDERS_FILTER_DEF).some(k => state.ordersFilter[k] !== ORDERS_FILTER_DEF[k]);

function ordersShown() {
  const F = state.ordersFilter;
  const q = (state.ordersQuery || '').trim().toLowerCase().replace(/^#/, '');
  const maxAgo = ORDER_RANGES.find(r => r[0] === F.range)[2];
  return state.orders.filter(o => {
    const ago = daysAgo(o.ts);
    if (F.range === 'yday' ? ago !== 1 : ago > maxAgo) return false;
    if (F.staff && o.cashier !== F.staff) return false;
    if (F.pay && reportMethodKind(o) !== F.pay) return false;
    if (F.status && (o.status || 'completed') !== F.status) return false;
    if (F.fulfil && (o.fulfilment === 'delivery' ? 'delivery' : 'pickup') !== F.fulfil) return false;
    return !q || [o.number, o.customer ? o.customer.name : 'walk-in', orderPaymentLabel(o), orderStatusLabel(o), fmtReceiptTime(o.ts),
      ...(o.items || []).flatMap(i => [i.name, i.sku])].some(v => String(v || '').toLowerCase().includes(q));
  }).sort((a, b) => b.ts - a.ts);
}

function renderOrders() {
  const list = $('#ordersList');
  if (!list) return;
  // Defensive: make sure state.orders is an array (and refresh from storage).
  if (!Array.isArray(state.orders)) state.orders = loadOrders();
  const shown = ordersShown();
  if (!shown.some(o => o.id === state.selectedOrderId)) state.selectedOrderId = shown[0] ? shown[0].id : null;

  let html = '', key = null;
  shown.forEach(o => {
    const k = dayStart(o.ts);
    if (k !== key) {
      key = k;
      const day = shown.filter(x => dayStart(x.ts) === k);
      html += `<div class="band"><span>${orderDayName(o.ts)} <span class="num">· ${day.length}</span></span><span class="num">${peso(day.reduce((s, x) => s + orderNet(x), 0))}</span></div>`;
    }
    const time = new Date(o.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    html += `<button type="button" class="row${o.status === 'voided' ? ' void' : ''}${o.id === state.selectedOrderId ? ' cur' : ''}" data-order-id="${o.id}">
      <div class="nm"><span class="num">#${escapeHtml(o.number)}</span>
        <small class="num">${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · ${time} · ${escapeHtml(o.cashier || '—')}</small></div>
      <div class="rt"><span class="amt num">${peso(o.total)}</span><small>${orderFlag(o, 'st')}${escapeHtml(orderPayText(o))}</small></div></button>`;
  });
  list.innerHTML = html || (state.orders.length
    ? '<div class="empty"><b>No orders</b><span>Nothing matches these filters.</span></div>'
    : '<div class="empty"><b>No orders yet</b><span>Completed sales and saved receipts show up here.</span></div>');
  $('#ordersFilter')?.classList.toggle('on', ordersFiltered());
  renderOrderDetail();
}

function renderOrderDetail() {
  const detail = $('#orderDetail'), ttl = $('#orderTtl');
  if (!detail || !ttl) return;
  const o = state.orders.find(x => x.id === state.selectedOrderId);
  $('#orderPrint').disabled = $('#orderMore').disabled = !o;
  $('#orderRefund').disabled = !o || !isCompletedSale(o);
  if (!o) {
    ttl.innerHTML = '';
    detail.innerHTML = '<div class="empty"><b>No order selected</b><span>Pick one from the list to see its receipt.</span></div>';
    return;
  }
  ttl.innerHTML = `<b class="${o.customer ? '' : 'walk'}">${escapeHtml(o.customer ? o.customer.name : 'Walk-in customer')}</b>${orderFlag(o, 'flag')}`;
  detail.innerHTML = buildReceiptPreview(o);
  if (o.status === 'voided') {
    const paper = detail.querySelector('.rp-paper');
    paper.classList.add('void');
    paper.insertAdjacentHTML('afterbegin', '<div class="stamp">VOIDED</div>');
  }
}

// The filter sheet (both labs): every choice on one sheet; a tap applies at once and the sheet stays open.
// groups() -> [[heading, key, [[value, label, dotColour?]]]]; cur is the live filter object, def its defaults.
function openFilterSheet(btn, groups, cur, def, apply) {
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = '<div class="rail-menu fp" role="dialog" aria-label="Filters"></div>';
  const m = veil.firstChild;
  const draw = () => {
    m.innerHTML = groups().map(([h, key, opts]) => `<h6>${h}</h6><div class="fp-seg">${opts.map(([v, l, dot]) =>
      `<button type="button" class="${cur[key] === v ? 'cur' : ''}" data-k="${key}" data-v="${escapeHtml(v)}">${dot ? `<i class="pm" style="background:${dot}"></i>` : ''}${escapeHtml(l)}</button>`).join('')}</div>`).join('')
      + `<button type="button" class="reset"${Object.keys(def).some(k => cur[k] !== def[k]) ? '' : ' disabled'}>Reset filters</button>`;
  };
  draw();
  document.body.append(veil);
  const r = btn.getBoundingClientRect();
  m.style.top = Math.max(12, Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 12)) + 'px';
  m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 12)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  const close = () => { veil.remove(); btn.setAttribute('aria-expanded', 'false'); };
  veil.addEventListener('click', e => {
    if (e.target === veil) { close(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    Object.assign(cur, b.classList.contains('reset') ? def : { [b.dataset.k]: b.dataset.v });
    apply();
    draw();
  });
  veil.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); btn.focus(); } });
  m.querySelector('button')?.focus({ preventScroll: true });
}

// The search card both pages share: typing shows the ×, the × clears and keeps focus.
function wireFind(findSel, inputSel, clearSel, apply) {
  const find = $(findSel), input = $(inputSel);
  if (!find || !input) return;
  input.addEventListener('input', () => { find.classList.toggle('typed', !!input.value); apply(input.value); });
  $(clearSel).addEventListener('click', (e) => { e.preventDefault(); input.value = ''; find.classList.remove('typed'); apply(''); input.focus(); });
}

// ---------- Items view (pos-items-rail-lab.html) ----------
// The catalog as items: a group's products are one item's variants. The editor works on a copy and Save is not
// connected yet -- the catalog's writes wait for the back office + sync (ROADMAP.md), so Save only checks the form.
const ITEMS_FILTER_DEF = { cat: '', stock: '' };
const itemsFilter = { q: '', ...ITEMS_FILTER_DEF };
const itemHue = s => [...String(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const itemQty = v => v.toLocaleString('en-PH', { maximumFractionDigits: 2 });
const itemInitials = s => s.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '+';
const itemThumb = (it, big) => `<span class="thumb${big ? ' big' : ''}" style="--h:${it.hue}" aria-hidden="true">${it.img ? `<img src="${it.img}" alt="">` : itemInitials(it.name)}</span>`;
const itemStock = it => it.variants.reduce((s, v) => s + v.stock, 0);
const itemStk = it => { const t = itemStock(it); return t <= 0 ? 'stk-out' : t <= it.reorder ? 'stk-low' : ''; };   // bo-model isLow: at or below the danger level
const itemMarkup = (cost, price) => cost > 0 ? (price - cost) / cost * 100 : 0;
function itemPriceText(it) {
  const ps = it.variants.map(v => v.price), lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? peso(lo) : `<small class="from">from </small>${peso(lo)}<span class="hi">–${peso(hi)}</span>`;
}

function catalogItems() {
  const byKey = new Map();
  state.products.forEach(p => {
    const g = p.groupId ? groupById(p.groupId) : null, key = g ? g.id : p.id;
    let it = byKey.get(key);
    if (!it) {
      const folder = (g && g.folder) || p.folder;
      it = { id: key, name: g ? g.name : p.name, cat: folderName(folder), hue: itemHue(folder), unit: p.unit || 'pc',
        soldBy: p.soldBy === 'measure' ? 'measure' : 'each', brand: p.brand || '', img: '', marginMode: 'percent',
        reorder: p.reorderPoint || 0, sellOut: false, supplier: p.supplier || '', alt: [], weight: '', size: '', length: '', variants: [] };
      byKey.set(key, it);
    }
    const vn = g && p.name.startsWith(g.name) ? p.name.slice(g.name.length).trim() : p.name;   // 'Common Wire Nails 2"' -> '2"'
    it.variants.push({ id: p.id, name: g ? vn : '', sku: p.sku || '', barcode: p.barcode || '', cost: p.cost || 0, price: p.price || 0, stock: p.stock || 0 });
  });
  return [...byKey.values()];
}
const itemCategories = () => state.folders.filter(f => f.id !== 'all').map(f => f.name);
const itemSuppliers = () => [...new Set(state.products.map(p => p.supplier).filter(Boolean))].sort();

function renderItems() {
  const rows = $('#itemsRows');
  if (!rows) return;
  const q = itemsFilter.q.trim().toLowerCase();
  const list = catalogItems().filter(it => {
    if (itemsFilter.cat && it.cat !== itemsFilter.cat) return false;
    if (itemsFilter.stock === 'low' && itemStk(it) !== 'stk-low') return false;
    if (itemsFilter.stock === 'out' && itemStk(it) !== 'stk-out') return false;
    return !q || it.name.toLowerCase().includes(q) || it.variants.some(v => [v.name, v.sku, v.barcode].some(x => x.toLowerCase().includes(q)));
  }).sort((a, b) => a.name.localeCompare(b.name));
  $('#itemsBand').innerHTML = `<span>Item <span class="num">· ${list.length}</span></span><span>Category</span><span>Price</span><span>In stock</span>`;
  rows.innerHTML = list.map(it => {
    const vn = it.variants.length;
    return `<button type="button" class="row cols" data-id="${escapeHtml(it.id)}">
      <span class="nm">${itemThumb(it)}<span class="tx"><b>${escapeHtml(it.name)}</b>${vn > 1 ? `<small>${vn} variants</small>` : ''}</span></span>
      <span class="cat">${escapeHtml(it.cat)}</span>
      <span class="pr num">${itemPriceText(it)}</span>
      <span class="num ${itemStk(it)}">${itemQty(itemStock(it))} ${escapeHtml(it.unit)}</span></button>`;
  }).join('') || '<div class="empty"><b>No items</b><span>Nothing matches this search or filter.</span></div>';
  $('#itemsFilter')?.classList.toggle('on', Object.keys(ITEMS_FILTER_DEF).some(k => itemsFilter[k] !== ITEMS_FILTER_DEF[k]));
}

// The editor: a working copy E of the item. Nothing here writes to the catalog.
let itemEdit = null, itemIsNew = false;
const blankVariant = () => ({ id: uid(), name: '', sku: '', barcode: '', cost: 0, price: 0, stock: 0, fresh: true });

function openItemEditor(id) {
  const it = id ? catalogItems().find(x => x.id === id) : null;
  itemIsNew = !it;
  itemEdit = it || { id: uid(), name: '', cat: '', hue: 220, unit: 'pc', soldBy: 'each', brand: '', img: '', marginMode: 'percent', reorder: 0, sellOut: false,
    supplier: '', alt: [], weight: '', size: '', length: '', variants: [blankVariant()], since: new Date().toISOString().slice(0, 10) };
  const v0 = itemEdit.variants[0];
  itemEdit.marginValue = moneyValue(itemEdit.marginMode === 'percent' ? itemMarkup(v0.cost, v0.price) : v0.price - v0.cost);
  renderItemForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
}
const closeItemEditor = () => $('#itemsView').classList.remove('editing');

const ifr = (label, ctl) => `<div class="fr"><span class="lb">${label}</span><div class="ctl">${ctl}</div></div>`;
const iinp = (f, v, attrs = '') => `<input class="in" data-f="${f}" value="${escapeHtml(v)}" ${attrs}>`;
const IMONEY = 'type="number" step="0.01" min="0" inputmode="decimal"';
const ipills = (f, cur, opts) => `<div class="pills" data-pills="${f}">${opts.map(([k, l]) => `<button type="button" class="${cur === k ? 'cur' : ''}" data-v="${escapeHtml(k)}">${l}</button>`).join('')}</div>`;
const icard = (title, body, sub = '') => `<section class="card fc"><h3>${title}${sub ? `<span>${sub}</span>` : ''}</h3>${body}</section>`;
const imarginNote = v => `You make <b>${peso(v.price - v.cost)}</b> · <b>${itemMarkup(v.cost, v.price).toFixed(1)}%</b> markup on cost · <b>${(v.price > 0 ? (v.price - v.cost) / v.price * 100 : 0).toFixed(1)}%</b> margin on price`;

function itemVariantRow(v) {
  const E = itemEdit;
  return `<div class="vt" data-vid="${escapeHtml(v.id)}">
    <input class="in" data-v="name" value="${escapeHtml(v.name)}" placeholder="e.g. Red, 2 inch">
    <input class="in" data-v="sku" value="${escapeHtml(v.sku)}">
    <input class="in" data-v="barcode" value="${escapeHtml(v.barcode)}" inputmode="numeric">
    <input class="in n" data-v="cost" value="${v.cost || ''}" ${IMONEY}>
    <input class="in n" data-v="price" value="${v.price || ''}" ${IMONEY}>
    <span class="mg num">${itemMarkup(v.cost, v.price).toFixed(0)}%</span>
    ${v.fresh ? `<input class="in n" data-v="stock" value="${v.stock || ''}" type="number" step="${E.soldBy === 'measure' ? .01 : 1}" min="0" placeholder="0">`
      : `<span class="st num ${v.stock <= 0 ? 'stk-out' : ''}">${itemQty(v.stock)} ${escapeHtml(E.unit)}</span>`}
    <button type="button" class="del" data-act="del-variant" aria-label="Remove variant" title="Remove variant"><svg class="ic" viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>`;
}

function renderItemForm() {
  const E = itemEdit, fam = E.variants.length > 1, v0 = E.variants[0], shared = fam ? 'Shared by every variant' : '';
  const sups = itemSuppliers();
  const details = icard('Details', [
    ifr('Name', iinp('name', E.name, 'placeholder="Portland Cement 40kg"')),
    ifr('Brand', iinp('brand', E.brand)),
    ifr('Image', `${itemThumb(E, true)}<label class="act">Upload<input type="file" accept="image/*" id="itemImg" hidden></label>${E.img ? '<button type="button" class="link" data-act="img-clear">Remove</button>' : ''}`),
  ].join(''), shared);
  const soldAs = icard('Sold as', [
    ifr('How it is sold', ipills('soldBy', E.soldBy, [['each', 'Each'], ['measure', 'By measure']])),
    ifr('Unit', iinp('unit', E.unit, 'placeholder="pc" style="width:150px"')),
  ].join(''), shared);
  const pricing = fam ? '' : icard('Pricing', [
    ifr('Cost', `<input class="in short num" data-f="cost" value="${v0.cost || ''}" ${IMONEY}>`),
    ifr('Margin', ipills('marginMode', E.marginMode, [['flat', 'Flat'], ['percent', 'Percent']])),
    ifr(E.marginMode === 'percent' ? 'Markup on cost (%)' : 'Profit per unit', `<input class="in short num" data-f="marginValue" value="${E.marginValue || ''}" type="number" step="0.01" inputmode="decimal">`),
    ifr('Price', `<input class="in short num" data-f="price" value="${v0.price || ''}" ${IMONEY}>`),
  ].join('') + `<div class="note num" id="itemMarginNote">${imarginNote(v0)}</div>`);
  const inventory = icard('Inventory', [
    fam ? '' : itemIsNew ? ifr('Opening quantity', `<input class="in short num" data-f="stock" value="${v0.stock || ''}" type="number" step="${E.soldBy === 'measure' ? .01 : 1}" min="0" placeholder="0">`)
      : ifr('On hand', `<input class="in short num" value="${itemQty(v0.stock)} ${escapeHtml(E.unit)}" disabled><button type="button" class="link" data-act="stock">Adjust stock</button>`),
    itemIsNew ? ifr('In store since', `<input class="in short" type="date" data-f="since" value="${E.since}">`) : '',
    ifr('Danger level', `<input class="in short num" data-f="reorder" value="${E.reorder}" type="number" step="1" min="0" inputmode="numeric">`),
    ifr('Sell when out of stock', `<input type="checkbox" class="sw" data-f="sellOut" ${E.sellOut ? 'checked' : ''} aria-label="Sell when out of stock">`),
    fam ? '' : ifr('SKU', iinp('sku', v0.sku)),
    fam ? '' : ifr('Barcode', iinp('barcode', v0.barcode, 'inputmode="numeric"')),
  ].join(''), shared);
  const variants = fam
    ? icard('Variants', `<div class="vt-wrap"><div class="vt th"><span>Variant</span><span>SKU</span><span>Barcode</span><span>Cost</span><span>Price</span><span>Margin</span><span>Stock</span><span></span></div>
        <div>${E.variants.map(itemVariantRow).join('')}</div></div>
        <div class="foot"><span>Stock on a variant that exists is moved with Adjust stock.</span><button type="button" class="act" data-act="add-variant">Add variant</button></div>`,
        `${E.variants.length} in this item`)
    : icard('Variants', `<div class="blurb">Sold in sizes or colours? Add a variant. Each one gets its own SKU, barcode, price and stock.</div>
        <div class="foot" style="justify-content:flex-end"><button type="button" class="act" data-act="add-variant">Add variant</button></div>`);
  const org = icard('Organization', [
    ifr('Category', `<input class="in" data-f="cat" value="${escapeHtml(E.cat)}" list="itemCatList" placeholder="Uncategorized">`),
    ifr('Supplier', `<input class="in" data-f="supplier" value="${escapeHtml(E.supplier)}" list="itemSupList" placeholder="No supplier">`),
    sups.length ? ifr('Also stocked by', `<div class="pills" data-multi="alt">${sups.filter(s => s !== E.supplier).map(s => `<button type="button" class="${E.alt.includes(s) ? 'cur' : ''}" data-v="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`) : '',
  ].join(''));
  const specs = icard('Specs', [
    ifr('Weight', iinp('weight', E.weight, 'placeholder="2.5 kg"')),
    ifr('Size', iinp('size', E.size, 'placeholder="3/4 in"')),
    ifr('Length', iinp('length', E.length, 'placeholder="8 ft"')),
  ].join(''), 'Free text');
  $('#itemForm').innerHTML = `<div class="form">
    ${details}${soldAs}${pricing}${inventory}${variants}${org}${specs}
    <datalist id="itemCatList">${itemCategories().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
    <datalist id="itemSupList">${sups.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
  </div>`;
}

// cost / margin / price: any two drive the third (the back office's three-way binding)
function itemReprice(from) {
  const E = itemEdit, v0 = E.variants[0], pct = E.marginMode === 'percent', f = $('#itemForm');
  if (from === 'price') {
    E.marginValue = moneyValue(pct ? itemMarkup(v0.cost, v0.price) : v0.price - v0.cost);
    f.querySelector('[data-f=marginValue]').value = E.marginValue || '';
  } else {
    v0.price = moneyValue(pct ? v0.cost * (1 + E.marginValue / 100) : v0.cost + E.marginValue);
    f.querySelector('[data-f=price]').value = v0.price || '';
  }
  $('#itemMarginNote').innerHTML = imarginNote(v0);
}

function saveItem() {
  const E = itemEdit;
  if (!E.name.trim()) { showToast('Give the item a name'); $('#itemForm').querySelector('[data-f=name]').focus(); return; }
  if (E.variants.length > 1 && E.variants.some(v => !v.name.trim())) { showToast('Name every variant'); return; }
  showToast("Saving isn't connected yet");   // ponytail: design only until the back office owns catalog writes
}

function openOrderDetailModal(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  const r = toReceiptViewModel(o);
  const d = new Date(o.ts);
  const dateStr = d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true });
  const statusCls = isSavedOrder(o) ? 'saved' : (isCompletedSale(o) ? 'done' : 'voided');

  const numEl = $('#odmNumber');
  if (numEl) numEl.textContent = `Order #${o.number}`;
  const statusEl = $('#odmStatus');
  if (statusEl) {
    statusEl.textContent = orderStatusLabel(o);
    statusEl.className = `odm-status ${statusCls}`;
  }

  const metaRows = [
    ['Date', dateStr],
    ['Time', timeStr],
    ['Staff', o.cashier || '—'],
    ['Customer', o.customer ? o.customer.name : 'Walk-in'],
    ['Payment', orderPaymentLabel(o)],
    ['Fulfilment', o.fulfilment === 'delivery' ? (o.deliveryAddress || 'Delivery') : 'Pickup'],
  ].map(([k, v]) => `<div class="odm-meta-row"><span>${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');

  const itemRows = (o.items || []).map(i => `
    <div class="odm-item">
      <div class="odm-item-info">
        <div class="odm-item-name">${escapeHtml(i.name)}</div>
        <div class="odm-item-sub">${i.qty} ${escapeHtml(i.unit || 'pc')} × ${peso(i.price)}</div>
      </div>
      <div class="odm-item-amt">${peso(i.lineTotal ?? i.price * i.qty)}</div>
    </div>`).join('');

  const t = r.totals;
  const pay = (o.payments && o.payments[0]) || null;
  const paidAmt = pay ? (pay.tendered || pay.amount || o.total) : o.total;
  const change = moneyValue(o.change || (pay ? pay.change : 0) || 0);
  const subtotalRows = `
    <div class="odm-total-row"><span>Subtotal</span><span>${peso(t.subtotal)}</span></div>
    ${t.discount > 0 ? `<div class="odm-total-row"><span>Discount</span><span>-${peso(t.discount)}</span></div>` : ''}
    ${t.vatAmount ? `<div class="odm-total-row"><span>VAT (${Math.round((t.vatRate || 0.12) * 100)}% incl.)</span><span>${peso(t.vatAmount)}</span></div>` : ''}`;
  const totalRows = `
    <div class="odm-subtotals-detail" id="odmSubtotalsDetail">
      <div class="odm-subtotals-inner">${subtotalRows}</div>
    </div>
    <button class="odm-total-row grand odm-total-toggle" id="odmTotalToggle" type="button">
      <span>Total</span>
      <div class="odm-total-right">
        <span>${peso(t.total)}</span>
        <svg class="odm-total-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>
    <div class="odm-total-row"><span>Paid (${escapeHtml(orderPaymentLabel(o))})</span><span>${peso(paidAmt)}</span></div>
    ${change > 0 ? `<div class="odm-total-row"><span>Change</span><span>${peso(change)}</span></div>` : ''}`;

  const actions = isCompletedSale(o) && state.role === 'manager' ? `
    <div class="odm-actions">
      <button class="secondary-btn danger" data-order-op="void" data-order-id="${o.id}">Void</button>
      <button class="secondary-btn" data-order-op="refund" data-order-id="${o.id}">Refund</button>
      <button class="secondary-btn" data-order-op="return" data-order-id="${o.id}">Return</button>
      <button class="secondary-btn" data-order-op="exchange" data-order-id="${o.id}">Exchange</button>
    </div>` : '';

  const itemCount = (o.items || []).length;
  const body = $('#orderDetailModalBody');
  if (body) {
    body.innerHTML = `
      <div class="odm-meta">${metaRows}</div>
      ${o.fulfilment === 'delivery' && !isSavedOrder(o) ? deliveryTripHtml(o) : ''}
      <button class="odm-items-toggle" id="odmItemsToggle" type="button">
        <span>Items (${itemCount})</span>
        <svg class="odm-items-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="odm-items-detail" id="odmItemsDetail">
        <div class="odm-items-inner">${itemRows}</div>
      </div>
      <div class="odm-totals">${totalRows}</div>
      ${actions}`;

    const toggle = body.querySelector('#odmItemsToggle');
    const detail = body.querySelector('#odmItemsDetail');
    const inner = body.querySelector('.odm-items-inner');
    if (toggle && detail && inner) {
      toggle.addEventListener('click', () => {
        const isOpen = toggle.classList.contains('open');
        if (isOpen) {
          detail.style.height = detail.getBoundingClientRect().height + 'px';
          requestAnimationFrame(() => { detail.style.height = '0'; });
          toggle.classList.remove('open');
        } else {
          const h = inner.getBoundingClientRect().height;
          detail.style.height = h + 'px';
          const onEnd = () => { detail.style.height = 'auto'; detail.removeEventListener('transitionend', onEnd); };
          detail.addEventListener('transitionend', onEnd);
          toggle.classList.add('open');
        }
      });
    }

    const totalToggle = body.querySelector('#odmTotalToggle');
    const subtotalsDetail = body.querySelector('#odmSubtotalsDetail');
    const subtotalsInner = body.querySelector('.odm-subtotals-inner');
    if (totalToggle && subtotalsDetail && subtotalsInner) {
      totalToggle.addEventListener('click', () => {
        const isOpen = totalToggle.classList.contains('open');
        if (isOpen) {
          subtotalsDetail.style.height = subtotalsDetail.getBoundingClientRect().height + 'px';
          requestAnimationFrame(() => { subtotalsDetail.style.height = '0'; });
          totalToggle.classList.remove('open');
        } else {
          const h = subtotalsInner.getBoundingClientRect().height;
          subtotalsDetail.style.height = h + 'px';
          const onEnd = () => { subtotalsDetail.style.height = 'auto'; subtotalsDetail.removeEventListener('transitionend', onEnd); };
          subtotalsDetail.addEventListener('transitionend', onEnd);
          totalToggle.classList.add('open');
        }
      });
    }
  }
  const modal = $('#orderDetailModal');
  if (modal) modal.hidden = false;
}

// ---------- Delivery trip ----------
// The order record never changes; its trip is rows in the deliveryEvents log, latest wins.
const DELIVERY_EVENT_META = {
  dispatched: { label: 'Dispatched', cls: 'saved' },
  arrived:    { label: 'Arrived',    cls: 'ok' },
  returned:   { label: 'Returned',   cls: 'done' },
  failed:     { label: 'Failed',     cls: 'danger' },
};

function latestDeliveryEvents(rows) {
  const latest = new Map();
  (rows || []).forEach(r => {
    const cur = latest.get(r.orderId);
    if (!cur || String(r.ts) >= String(cur.ts)) latest.set(r.orderId, r);
  });
  return latest;
}

function deliveryChip(last, withDetail = false) {
  if (!last) return '<span class="or-status done">To dispatch</span>';
  const m = DELIVERY_EVENT_META[last.event] || { label: last.event, cls: 'done' };
  const detail = withDetail ? ` · ${fmtOrderTime(last.ts)}${last.driver ? ' · ' + last.driver : ''}` : '';
  return `<span class="or-status ${m.cls}">${escapeHtml(m.label + detail)}</span>`;
}

function deliveryTripHtml(o) {
  const events = loadEvents('deliveryEvents');
  const last = latestDeliveryEvents(events).get(o.id);
  // ponytail: "remembered driver" is just the newest row's driver -- no extra setting to keep.
  const driver = last ? last.driver : ((events[events.length - 1] || {}).driver || '');
  return `
    <div class="odm-delivery">
      <div class="odm-delivery-head">
        <span class="odm-section-label">Delivery</span>
        ${deliveryChip(last, true)}
      </div>
      <input type="text" class="text-input" id="odmDriverInput" placeholder="Driver name" autocomplete="off" value="${escapeHtml(driver)}" />
      <div class="odm-actions">
        ${Object.entries(DELIVERY_EVENT_META).map(([ev, m]) =>
          `<button class="secondary-btn${ev === 'failed' ? ' danger' : ''}" type="button" data-delivery-event="${ev}" data-order-id="${o.id}">${m.label}</button>`).join('')}
      </div>
    </div>`;
}

function recordDeliveryEvent(orderId, event) {
  const input = $('#odmDriverInput');
  const driver = (input?.value || '').trim();
  if (!driver) { showToast('Enter the driver name'); input?.focus(); return; }
  const store = currentStoreInfo();
  // ponytail: lat/lng stay null -- the till sits in the store, not with the driver. GPS on the run is Tier 2.
  const saved = appendEvents('deliveryEvents', [makeEvent({
    orderId, event, driver, lat: null, lng: null, note: '', terminal: String(store.registerNo || ''),
  }, store.cashier)]);
  showToast(saved ? `${DELIVERY_EVENT_META[event].label} · ${driver}` : 'Could not save: storage is full');
  openOrderDetailModal(orderId);
  renderOrders();
}

// ---------- Lost sale (unfilled request + substitution) ----------
const LOST_DEMAND_REASONS = ['out-of-stock', 'not-carried', 'too-expensive', 'other'];

// One lostDemand row, or null when there is nothing to record. A catalog pick keeps its id and
// name; free text is kept as typed -- that text IS the "not carried" signal a buyer reads.
function lostDemandFields({ product = null, text = '', qty = 1, reason = 'other', substituteProductId = '' } = {}) {
  const name = product ? product.name : String(text || '').trim();
  const n = product ? roundQty(product, toNumber(qty, 0)) : Math.round(toNumber(qty, 0) * 100) / 100;
  if (!name || !(n > 0)) return null;
  return {
    productId: product ? product.id : '',
    text: name,
    qty: n,
    reason: LOST_DEMAND_REASONS.includes(reason) ? reason : 'other',
    substituteProductId: substituteProductId || '',
    terminal: String(currentStoreInfo().registerNo || ''),
  };
}

function openLostSale({ product = null, text = '', qty = 1, reason = 'out-of-stock' } = {}) {
  state.lostSale = { productId: product ? product.id : '', reason };
  $('#lsItemInput').value = product ? product.name : text;
  $('#lsQtyInput').value = qty;
  // ponytail: "bought instead" offers only what is already in the cart -- the cashier suggests B,
  // rings it up, then logs A. A catalog-wide picker here if substitutes turn out to be rung up later.
  $('#lsSubSelect').innerHTML = '<option value="">Nothing</option>' + state.cart
    .filter(i => !product || i.id !== product.id)
    .map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join('');
  renderLostSale();
  $('#lostSaleModal').hidden = false;
  if (!product && !text) $('#lsItemInput').focus();
}

function renderLostSale() {
  $$('[data-ls-reason]').forEach(b => b.classList.toggle('active', b.dataset.lsReason === state.lostSale.reason));
  const picked = state.products.find(p => p.id === state.lostSale.productId);
  const q = $('#lsItemInput').value.trim();
  const matches = !picked && q && state.fuse
    ? state.fuse.search(q).slice(0, 4).map(r => state.products.find(p => p.id === r.item.id)).filter(Boolean)
    : [];
  $('#lsMatches').innerHTML = picked
    ? `<div class="ls-picked">In catalog · ${picked.stock} ${escapeHtml(picked.unit || '')} on hand</div>`
    : matches.map(p => `
      <button type="button" class="ls-match" data-ls-product="${p.id}">
        <span>${escapeHtml(p.name)}</span><span>${p.stock} ${escapeHtml(p.unit || '')}</span>
      </button>`).join('');
}

function saveLostSale() {
  const fields = lostDemandFields({
    product: state.products.find(p => p.id === state.lostSale.productId) || null,
    text: $('#lsItemInput').value,
    qty: $('#lsQtyInput').value,
    reason: state.lostSale.reason,
    substituteProductId: $('#lsSubSelect').value,
  });
  if (!fields) { showToast('Enter what they asked for and a qty'); return; }
  if (!appendEvents('lostDemand', [makeEvent(fields, currentStoreInfo().cashier)])) {
    showToast('Could not save: storage is full'); return;
  }
  $('#lostSaleModal').hidden = true;
  showToast(`Lost sale logged · ${fields.text}`);
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
  }
  .r-paper {
    width: 80mm;
    padding: 4mm 4mm 6mm;
    background: #fff;
  }
  /* On-screen preview: center the receipt on a neutral surface */
  @media screen {
    body {
      background: #1a1a1a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 40px 16px;
    }
    .r-paper {
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3);
      padding: 8mm 6mm 10mm;
    }
    .r-actions { width: 80mm; }
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
  .r-actions { margin-top: 16px; display: flex; gap: 8px; }
  .r-actions button {
    flex: 1; font-family: inherit; font-size: 13px; font-weight: 600; padding: 12px;
    border: none; border-radius: 10px; background: #333; color: #fff; cursor: pointer;
  }
  .r-actions button.primary { background: #fff; color: #121212; }
  @media print {
    .r-actions { display: none; }
    body { padding: 0; background: #fff; }
    .r-paper { padding: 2mm 4mm 4mm; box-shadow: none; border-radius: 0; }
  }
</style>
</head>
<body>
  <div class="r-paper">
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

  <div class="r-center r-thanks">Thank you!</div>
  <div class="r-center r-foot">This serves as your official receipt.</div>
  <div class="r-center r-foot">Goods sold are not returnable.</div>
  </div>

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

  // Stock never lands straight on the product (see bo-model.js's header) -- it goes through a
  // movement below, so it stays out of `data`. parseFloat, not parseInt: a by-measure product
  // typed as 2.5 must not get truncated to 2; applyMovement rounds to the product's own step.
  const typedStock = parseFloat($('#pf_stock').value) || 0;
  const data = {
    name,
    sku,
    barcode: $('#pf_barcode').value.trim(),
    brand: $('#pf_brand').value.trim() || 'Generic',
    folder: $('#pf_folder').value || '',
    unit: $('#pf_unit').value.trim() || 'pc',
    cost: parseFloat($('#pf_cost').value) || 0,
    price: parseFloat($('#pf_price').value) || 0,
    reorderPoint: parseInt($('#pf_reorder').value, 10) || 0,
    aliases: $('#pf_aliases').value.split(',').map(s => s.trim()).filter(Boolean),
  };

  const { mode, editId } = state.productModal;
  const before = state.products.map(p => ({ id: p.id, price: p.price, cost: p.cost }));
  const movements = [];
  if (mode === 'create') {
    const p = { id: uid(), stock: 0, ...data };
    state.products.push(p);
    if (typedStock > 0) {
      const mv = makeMovement({ productId: p.id, qty: typedStock, reason: 'count', note: 'Opening stock', staff: currentStoreInfo().cashier });
      applyMovement(p, mv);
      movements.push(mv);
    }
    showToast(`Added “${data.name}”`);
  } else if (mode === 'edit' && editId) {
    const p = state.products.find(x => x.id === editId);
    if (p) {
      const oldStock = Number(p.stock) || 0;
      Object.assign(p, data);
      if (typedStock !== oldStock) {
        const mv = makeMovement({ productId: p.id, qty: typedStock - oldStock, reason: 'count',
          expected: oldStock, counted: typedStock, staff: currentStoreInfo().cashier });
        applyMovement(p, mv);
        movements.push(mv);
      }
    }
    showToast('Product updated');
  }
  // Only the editor logs: saveProducts also runs on every sale, where price and cost never change.
  if (saveProducts()) appendEvents('priceLog', priceChanges(before, state.products, { source: 'pos', staff: currentStoreInfo().cashier }));
  appendMovements(movements);
  rebuildFuse();
  renderAllFolderUis();
  $('#productModal').hidden = true;
}

// ---------- Customers / Reports ----------
function customerOrders(customerId) {
  return state.orders
    .filter(o => o.customer && o.customer.id === customerId && isCompletedSale(o))
    .sort((a, b) => b.ts - a.ts);
}

function customerMetrics(customerId) {
  const orders = customerOrders(customerId);
  if (orders.length === 0) return { lifetimeValue: 0, avgOrderValue: 0, orderCount: 0, lastPurchaseTs: 0, daysSinceLastPurchase: null };
  const lifetimeValue = moneyValue(orders.reduce((sum, o) => sum + o.total, 0));
  const avgOrderValue = moneyValue(lifetimeValue / orders.length);
  const lastPurchaseTs = orders[0].ts;
  const daysSinceLastPurchase = Math.floor((Date.now() - lastPurchaseTs) / 86400000);
  return { lifetimeValue, avgOrderValue, orderCount: orders.length, lastPurchaseTs, daysSinceLastPurchase };
}

function relativeTime(ts) {
  if (!ts) return 'Never';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m > 1 ? 's' : ''} ago`; }
  const y = Math.floor(days / 365);
  return `${y} year${y > 1 ? 's' : ''} ago`;
}

function customerAging(customerId) {
  const now = Date.now();
  const entries = state.customerLedger
    .filter(e => e.customerId === customerId)
    .sort((a, b) => a.ts - b.ts);
  const charges = [];
  for (const e of entries) {
    if (e.type === 'charge') {
      charges.push({ ts: e.ts, remaining: e.amount });
    } else if (e.type === 'payment') {
      let toApply = e.amount;
      while (toApply > 0 && charges.length > 0) {
        const first = charges[0];
        const applied = Math.min(toApply, first.remaining);
        first.remaining -= applied;
        toApply -= applied;
        if (first.remaining <= 0) charges.shift();
      }
    }
  }
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const charge of charges) {
    if (charge.remaining <= 0) continue;
    const days = Math.floor((now - charge.ts) / 86400000);
    const amt = charge.remaining;
    if (days <= 30) buckets['0-30'] += amt;
    else if (days <= 60) buckets['31-60'] += amt;
    else if (days <= 90) buckets['61-90'] += amt;
    else buckets['90+'] += amt;
  }
  const total = moneyValue(Object.values(buckets).reduce((s, v) => s + v, 0));
  return { buckets, total };
}

function getTierDiscount(customer) {
  if (!customer || !customer.type) return 0;
  const tiers = state.settings.pricingTiers || {};
  return tiers[customer.type] || 0;
}

function fmtOrderDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function openCustomerDetail(customerId) {
  const c = allCustomerRecords().find(x => x.id === customerId);
  if (!c) return;
  const orders = customerOrders(customerId);
  const m = customerMetrics(customerId);
  const aging = customerAging(customerId);
  $('#custDetailTitle').textContent = c.name;

  const kpisEl = $('#custDetailKpis');
  kpisEl.innerHTML = `
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Lifetime Value</div>
      <div class="cust-kpi-value">${peso(m.lifetimeValue)}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Orders</div>
      <div class="cust-kpi-value">${m.orderCount}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Avg Order</div>
      <div class="cust-kpi-value">${peso(m.avgOrderValue)}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Last Purchase</div>
      <div class="cust-kpi-value cust-kpi-value-sm">${relativeTime(m.lastPurchaseTs)}</div>
    </div>`;

  const agingEl = $('#custDetailAging');
  if (aging.total > 0) {
    const b = aging.buckets;
    agingEl.innerHTML = `
      <div class="cust-aging-title">Outstanding Balance · ${peso(aging.total)}</div>
      <div class="cust-aging-buckets">
        ${b['0-30'] > 0 ? `<div class="cust-aging-bucket"><span class="cust-aging-bucket-label">0–30 days</span><span class="cust-aging-bucket-value">${peso(b['0-30'])}</span></div>` : ''}
        ${b['31-60'] > 0 ? `<div class="cust-aging-bucket"><span class="cust-aging-bucket-label">31–60 days</span><span class="cust-aging-bucket-value warn">${peso(b['31-60'])}</span></div>` : ''}
        ${b['61-90'] > 0 ? `<div class="cust-aging-bucket"><span class="cust-aging-bucket-label">61–90 days</span><span class="cust-aging-bucket-value warn">${peso(b['61-90'])}</span></div>` : ''}
        ${b['90+'] > 0 ? `<div class="cust-aging-bucket"><span class="cust-aging-bucket-label">90+ days</span><span class="cust-aging-bucket-value danger">${peso(b['90+'])}</span></div>` : ''}
      </div>`;
    agingEl.style.display = '';
  } else {
    agingEl.style.display = 'none';
  }

  const ordersEl = $('#custDetailOrders');
  if (orders.length === 0) {
    ordersEl.innerHTML = `<div class="cust-detail-empty">No completed orders yet</div>`;
  } else {
    ordersEl.innerHTML = orders.map(o => {
      const itemCount = o.items.length;
      const firstItems = o.items.slice(0, 2).map(i => i.name).join(', ');
      const moreItems = o.items.length > 2 ? ` +${o.items.length - 2} more` : '';
      return `
        <button class="cust-order-row" data-order-id="${escapeHtml(o.id)}">
          <div class="cust-order-date">${fmtOrderDate(o.ts)}</div>
          <div class="cust-order-items">
            <div class="cust-order-items-main">#${escapeHtml(o.number)} · ${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
            <div class="cust-order-items-sub">${escapeHtml(firstItems)}${moreItems}</div>
          </div>
          <span class="cust-order-method">
            <span class="rl-dot" style="background:${reportMethodMeta(reportMethodKind(o)).color}"></span>
            ${escapeHtml(orderPaymentLabel(o))}
          </span>
          <div class="cust-order-total">${peso(o.total)}</div>
        </button>`;
    }).join('');
  }
  $('#customerDetailModal').hidden = false;
}

function renderCustomers() {
  state.orders = loadOrders();
  const list = $('#customersList');
  const all = allCustomerRecords();

  const metricsCache = new Map();
  const agingCache = new Map();
  for (const c of all) {
    metricsCache.set(c.id, customerMetrics(c.id));
    agingCache.set(c.id, customerAging(c.id));
  }

  const q = (state.customersQuery || '').trim().toLowerCase();
  let filtered = q
    ? all.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.type || '').toLowerCase().includes(q))
    : all;

  if (filtered.length > 0 && !filtered.find(c => c.id === state.selectedCustomerId)) {
    state.selectedCustomerId = filtered[0].id;
  }

  if (list) {
    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="orders-empty">
          <div class="empty-glyph">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div class="empty-title">${q ? 'No matches' : 'No customers yet'}</div>
          <div class="empty-sub">${q ? 'Try a different name or phone' : 'Add your first customer to get started'}</div>
        </div>`;
    } else {
      list.innerHTML = filtered.map(c => {
        const active = state.selectedCustomerId === c.id ? 'active' : '';
        const m = metricsCache.get(c.id);
        const aging = agingCache.get(c.id);
        const bal = c.currentBalance || 0;
        const balCls = bal > 0 ? 'cust-bal-has' : '';
        const typeBadge = c.type && c.type !== 'retail' ? `<span class="cust-type-badge cust-type-${escapeHtml(c.type)}">${escapeHtml(c.type.charAt(0).toUpperCase() + c.type.slice(1))}</span>` : '';
        const threshold = state.settings.churnThresholdDays || 30;
        let churnBadge = '';
        if (m.daysSinceLastPurchase !== null && m.daysSinceLastPurchase >= threshold) {
          const churnCls = m.daysSinceLastPurchase >= 90 ? 'danger' : 'warn';
          churnBadge = `<span class="cust-churn-badge churn-${churnCls}">${m.daysSinceLastPurchase}d</span>`;
        }
        const lastOrder = m.lastPurchaseTs ? fmtOrderDate(m.lastPurchaseTs) : 'Never';
        return `
          <div class="order-row ${active}" data-customer-id="${escapeHtml(c.id)}">
            <div class="or-body">
              <div class="or-head">
                <span class="or-number">${escapeHtml(c.name)}</span>
                <span class="or-total ${balCls}">${peso(bal)}</span>
              </div>
              <div class="or-sub">
                <span class="or-sub-time">${escapeHtml(c.phone || 'No phone')} · ${m.orderCount} orders · Last ${lastOrder}</span>
                <span class="or-status cust-badges">${typeBadge}${churnBadge}</span>
              </div>
            </div>
            <button class="or-receipt-btn" data-act="view-customer-detail" data-customer-id="${escapeHtml(c.id)}" title="View details">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>`;
      }).join('');
    }
  }

  renderCustomerDetail(metricsCache, agingCache);
}

function renderCustomerDetail(metricsCache, agingCache) {
  const detail = $('#customerDetail');
  if (!detail) return;
  const c = allCustomerRecords().find(x => x.id === state.selectedCustomerId);
  if (!c) {
    detail.innerHTML = `
      <div class="order-detail-empty">
        <div class="empty-title">Select a customer</div>
        <div class="empty-sub">Pick one from the list to view their details</div>
      </div>`;
    return;
  }

  const m = (metricsCache || new Map()).get(c.id) || customerMetrics(c.id);
  const aging = (agingCache || new Map()).get(c.id) || customerAging(c.id);
  const orders = customerOrders(c.id);
  const bal = c.currentBalance || 0;
  const limit = c.creditLimit || 0;
  const balCls = bal === 0 ? '' : (limit > 0 && bal >= limit ? 'over' : 'has');

  const agingParts = [];
  if (aging.buckets['0-30'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">0–30d</span><span class="cd-aging-value">${peso(aging.buckets['0-30'])}</span></div>`);
  if (aging.buckets['31-60'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">31–60d</span><span class="cd-aging-value aging-warn">${peso(aging.buckets['31-60'])}</span></div>`);
  if (aging.buckets['61-90'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">61–90d</span><span class="cd-aging-value aging-warn">${peso(aging.buckets['61-90'])}</span></div>`);
  if (aging.buckets['90+'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">90+d</span><span class="cd-aging-value aging-danger">${peso(aging.buckets['90+'])}</span></div>`);

  const agingHtml = aging.total > 0 ? `
    <div class="cd-section-label">Outstanding Aging</div>
    <div class="cd-aging-row">${agingParts.join('')}</div>` : '';

  const orderRows = orders.length
    ? orders.slice(0, 20).map(o => {
        const itemCount = o.items.length;
        const firstItems = o.items.slice(0, 2).map(i => i.name).join(', ');
        const moreItems = o.items.length > 2 ? ` +${o.items.length - 2}` : '';
        return `
          <button class="cd-order-row" data-order-id="${escapeHtml(o.id)}">
            <div class="cd-order-date">${fmtOrderDate(o.ts)}</div>
            <div class="cd-order-info">
              <div class="cd-order-name">#${escapeHtml(o.number)} · ${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
              <div class="cd-order-sub">${escapeHtml(firstItems)}${moreItems}</div>
            </div>
            <span class="cd-order-method">
              <span class="rl-dot" style="background:${reportMethodMeta(reportMethodKind(o)).color}"></span>
              ${escapeHtml(orderPaymentLabel(o))}
            </span>
            <div class="cd-order-total">${peso(o.total)}</div>
          </button>`;
      }).join('')
    : `<div class="cd-empty">No completed orders yet</div>`;

  const moreOrders = orders.length > 20 ? `<div class="cd-more-orders">${orders.length - 20} more orders — open full history for all</div>` : '';

  detail.innerHTML = `
    <div class="od-scroll">
      <div class="od-inner cd-inner">
        <div class="cd-header">
          <div class="cd-avatar">${escapeHtml(c.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
          <div class="cd-header-info">
            <div class="cd-name">${escapeHtml(c.name)}</div>
            <div class="cd-phone">${escapeHtml(c.phone || 'No phone')}</div>
          </div>
        </div>
        <div class="cd-meta">
          <div class="odm-meta-row"><span>Address</span><span>${escapeHtml(c.address || '—')}</span></div>
          <div class="odm-meta-row"><span>Type</span><span>${escapeHtml((c.type || 'retail').charAt(0).toUpperCase() + (c.type || 'retail').slice(1))}</span></div>
          <div class="odm-meta-row"><span>Credit limit</span><span>${peso(limit)}</span></div>
          <div class="odm-meta-row"><span>Current balance</span><span class="cust-card-balance-value ${balCls}">${peso(bal)}</span></div>
        </div>
        <div class="cd-kpis">
          <div class="cd-kpi-box"><div class="cd-kpi-label">Lifetime Value</div><div class="cd-kpi-value">${peso(m.lifetimeValue)}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Orders</div><div class="cd-kpi-value">${m.orderCount}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Avg Order</div><div class="cd-kpi-value">${peso(m.avgOrderValue)}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Last Purchase</div><div class="cd-kpi-value cd-kpi-value-sm">${relativeTime(m.lastPurchaseTs)}</div></div>
        </div>
        ${agingHtml}
        <div class="cd-section-label">Recent Orders</div>
        <div class="cd-orders-list">${orderRows}</div>
        ${moreOrders}
      </div>
    </div>
    <div class="od-foot">
      <button class="od-details-btn cd-details-btn" type="button" data-customer-detail="${escapeHtml(c.id)}">View full history</button>
      ${bal > 0 ? `<button class="od-details-btn cd-pay-btn" type="button" data-customer-pay="${escapeHtml(c.id)}">Record payment</button>` : ''}
    </div>`;
}

function sameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// Cheap change-detector so the live poll only re-renders when orders actually change.
// The stored string IS the signature. The old version parsed and normalized every order ever
// rung and then built a key by concatenating a field from each of them -- every four seconds,
// on the one screen a shop owner leaves open all day. That was more work than the render it
// existed to avoid, and it missed edits to any field it did not list.
function reportsSignature() {
  return storageGet(STORAGE_ORDERS, '');
}

// Payment-method categories for the chart/legend. Categorical colors are a
// deliberate data-viz exception to the monochrome theme — kept muted.
const REPORT_METHOD_META = {
  cash:   { label: 'Cash',   color: '#E6E6E6' },
  gcash:  { label: 'GCash',  color: '#4C8DFF' },
  qr:     { label: 'QR',     color: '#3FB6A8' },
  credit: { label: 'Credit', color: '#FFB74D' },
  split:  { label: 'Split',  color: '#9B8CFF' },
  other:  { label: 'Other',  color: '#8A8A8A' },
};
const REPORT_METHOD_ORDER = ['cash', 'gcash', 'qr', 'credit', 'split', 'other'];
function reportMethodMeta(kind) { return REPORT_METHOD_META[kind] || REPORT_METHOD_META.other; }
function reportMethodKind(o) { return REPORT_METHOD_META[o.paymentKind] ? o.paymentKind : 'other'; }

function renderReports() {
  state.orders = loadOrders();
  reportsLive._sig = reportsSignature();
  const today = new Date();
  const completed = state.orders.filter(o => isCompletedSale(o));
  const sales = completed
    .filter(o => sameLocalDate(new Date(o.ts), today))
    .sort((a, b) => b.ts - a.ts);
  const revenue = sales.reduce((s, x) => s + x.total, 0);
  const txns = sales.length;
  $('#statRevenue').textContent = peso(revenue);
  $('#statTxns').textContent = txns;

  // ---- Last-7-days revenue, stacked by payment method (real order data) ----
  const DAYS = 7;
  const series = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    series.push({ date: d, label: d.toLocaleDateString('en-PH', { weekday: 'short' }), byKind: {}, total: 0, count: 0, isToday: i === 0 });
  }
  const rangeByKind = {};
  const rangeCountByKind = {};
  let rangeTotal = 0;
  completed.forEach(o => {
    const slot = series.find(s => sameLocalDate(s.date, new Date(o.ts)));
    if (!slot) return;
    const kind = reportMethodKind(o);
    slot.byKind[kind] = (slot.byKind[kind] || 0) + o.total;
    slot.total += o.total;
    slot.count += 1;
    rangeByKind[kind] = (rangeByKind[kind] || 0) + o.total;
    rangeCountByKind[kind] = (rangeCountByKind[kind] || 0) + 1;
    rangeTotal += o.total;
  });
  const maxDay = Math.max(1, ...series.map(s => s.total));
  const chartEl = $('#reportsChart');
  if (chartEl) {
    chartEl.innerHTML = series.map(s => {
      const barH = (s.total / maxDay) * 100;
      const segs = REPORT_METHOD_ORDER
        .filter(k => s.byKind[k])
        .map(k => `<div class="rc-seg" style="flex-grow:${s.byKind[k]};background:${reportMethodMeta(k).color}" title="${reportMethodMeta(k).label}: ${peso(s.byKind[k])}"></div>`)
        .join('');
      return `
        <div class="rc-col${s.isToday ? ' today' : ''}">
          <div class="rc-bar-area">
            <div class="rc-bar" style="height:${barH}%">${segs}</div>
          </div>
          <div class="rc-x">${escapeHtml(s.label)}</div>
          <div class="rc-count">${s.count}</div>
        </div>`;
    }).join('');
  }
  const rangeTotalEl = $('#reportsRangeTotal');
  if (rangeTotalEl) rangeTotalEl.textContent = peso(rangeTotal);

  // ---- Legend: each method's total + transaction count over the range ----
  const legendEl = $('#reportsLegend');
  if (legendEl) {
    const used = REPORT_METHOD_ORDER.filter(k => rangeByKind[k]);
    legendEl.innerHTML = used.map(k => {
      const m = reportMethodMeta(k);
      const c = rangeCountByKind[k] || 0;
      return `<div class="rl-item">
        <span class="rl-dot" style="background:${m.color}"></span>
        <span class="rl-label">${m.label}</span>
        <span class="rl-amt">${peso(rangeByKind[k])}</span>
        <span class="rl-count">· ${c} ${c === 1 ? 'transaction' : 'transactions'}</span>
      </div>`;
    }).join('');
  }

  // ---- Full transaction list — every completed sale today, newest first ----
  const txCount = $('#reportsTxCount');
  if (txCount) txCount.textContent = `${txns} ${txns === 1 ? 'transaction' : 'transactions'}`;
  const txEl = $('#reportsTxList');
  if (txEl) {
    txEl.innerHTML = sales.length
      ? sales.map(s => `
        <button class="report-tx" data-order-id="${escapeHtml(s.id)}">
          <div class="report-tx-main">
            <div class="report-tx-id">#${escapeHtml(s.number)}${s.customer ? ' · ' + escapeHtml(s.customer.name) : ''}</div>
            <div class="report-tx-sub">${fmtOrderTime(s.ts)} · ${escapeHtml(s.cashier || '—')}</div>
          </div>
          <span class="report-tx-method">
            <span class="rl-dot" style="background:${reportMethodMeta(reportMethodKind(s)).color}"></span>
            ${escapeHtml(orderPaymentLabel(s))}
          </span>
          <div class="report-tx-amt">${peso(s.total)}</div>
        </button>`).join('')
      : `<div class="reports-empty">No completed sales yet today</div>`;
  }
}

// Live updates: re-pull orders and re-render whenever they change while the
// Reports view is open. Storage events cover other tabs on this device; the poll
// is the seam a future backend sync can push through for multi-device cashiers.
function reportsLive() {
  if (state.view !== 'reports') return;
  if (reportsSignature() !== reportsLive._sig) renderReports();
}
reportsLive._sig = '';

function renderPosSettings() {
  const currentSize = state.tileSize || 'md';
  $$('#posSizeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const currentText = state.tileText || 'md';
  $$('#posTextToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.text === currentText);
  });
  const showCb = $('#posShowPrice');
  if (showCb) showCb.checked = state.showPrice;
  const currentTheme = state.theme || 'dark';
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === currentTheme);
  });
  const headCb = $('#posCartHead');
  if (headCb) headCb.checked = state.cartHead;
  const p = printerConfig();
  $$('#posWidthToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.width === (p.width || '80mm'));
  });
  const po = $('#posPrintOnSale');
  if (po) po.checked = !!p.printOnSale;
  const pc = $('#posPrintCut');
  if (pc) pc.checked = p.cut !== false;
  const pm = $('#posPrintMap');
  if (pm) pm.checked = p.mapOnReceipt !== false;
  const ip = $('#posPrinterIp');
  if (ip) ip.value = p.netUrl || '';
  $$('#posDriverToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.driver === (p.driver || 'browser'));
  });
  const netRow = $('#posNetRow');
  if (netRow) netRow.hidden = p.driver !== 'network';
  const scanRow = $('#posScanRow');
  if (scanRow) scanRow.hidden = p.driver !== 'network';
  const listRow = $('#posPrinterListRow');
  if (listRow) listRow.hidden = p.driver !== 'network';
  renderPrinterList();
  setScanStatus('');
  refreshPrinterStatus();
  const btRow = $('#posBtRow');
  if (btRow) btRow.hidden = p.driver !== 'bluetooth';
  const btStatus = $('#posBtStatus');
  if (btStatus) btStatus.textContent = p.btName ? 'Paired: ' + p.btName : 'Not paired';
  const tiers = state.settings.pricingTiers || {};
  const tierContractor = $('#posTierContractor');
  if (tierContractor) tierContractor.value = ((tiers.contractor || 0) * 100).toFixed(1);
  const tierWholesale = $('#posTierWholesale');
  if (tierWholesale) tierWholesale.value = ((tiers.wholesale || 0) * 100).toFixed(1);
  const tierRetail = $('#posTierRetail');
  if (tierRetail) tierRetail.value = ((tiers.retail || 0) * 100).toFixed(1);
  const tierResidential = $('#posTierResidential');
  if (tierResidential) tierResidential.value = ((tiers.residential || 0) * 100).toFixed(1);
  const churnInput = $('#posChurnDays');
  if (churnInput) churnInput.value = state.settings.churnThresholdDays || 30;
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
    ...printerConfig(),
    printOnSale: !!$('#posPrintOnSale')?.checked,
    cut: !!$('#posPrintCut')?.checked,
    mapOnReceipt: !!$('#posPrintMap')?.checked,
    netUrl: ($('#posPrinterIp')?.value || '').trim(),
  };
  state.settings.pricingTiers = {
    contractor: Math.max(0, parseFloat($('#posTierContractor')?.value || '0') || 0) / 100,
    wholesale: Math.max(0, parseFloat($('#posTierWholesale')?.value || '0') || 0) / 100,
    retail: Math.max(0, parseFloat($('#posTierRetail')?.value || '0') || 0) / 100,
    residential: Math.max(0, parseFloat($('#posTierResidential')?.value || '0') || 0) / 100,
  };
  state.settings.churnThresholdDays = Math.max(1, parseInt($('#posChurnDays')?.value || '30', 10) || 30);
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
      // A return leaves the original `completed` on purpose (the return row is what cancels it,
      // SALE_SIGN.return = -1), so its cash is still in `expectedCash` above -- and the cash to
      // hand it back came out of this drawer. Counting it as an adjustment and nothing else left
      // the till short by every return of the day.
      if (order.status === 'return') expectedCash -= cashAmount;
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

  // ---- Bottom bar: tile size toggle (S / M / L) ----
  $$('.bb-size-btn').forEach(btn => {
    btn.addEventListener('click', () => setTileSize(btn.dataset.size));
  });

  // ---- Bottom bar: toggle price display on tiles ----
  $('#bbViewBtn')?.addEventListener('click', toggleShowPrice);

  // ---- Save receipt (the cart's ⋯ menu): creates a not-completed saved receipt ----
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
    const q = state.query.trim();
    if (!q) endSearch();
    else if (!searchIntent || searchIntent.query !== q) searchIntent = { query: q, results: 0, picked: false };
    state.page = 1;
    clear.classList.toggle('visible', !!state.query);
    renderProducts();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = search.value.trim();
      if (!raw) return;
      if (findProductByCode(raw)) {
        searchIntent = null;   // the box held a scanned code, not a search -- its scan row records it
        addProductByCode(raw, { source: 'keyboard' });
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
        return;
      }
      // 3. Fall back to single fuzzy match
      const products = getFilteredSellProducts();
      if (products.length === 1) {
        addToCart(products[0].id, 'search');
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
      }
    }
  });
  clear.addEventListener('click', () => {
    endSearch();
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

  // ---- Product grid (Sell) — real swipe gestures ----
  const productGrid = $('#productGrid');
  let swipeStart = null;
  let suppressGridClick = false;

  productGrid.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const track = $('#productTrack');
    if (!track) return;
    track.classList.add('dragging');
    swipeStart = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      startX: e.clientX,
      startT: Date.now(),
      dragging: false,
    };
  });

  productGrid.addEventListener('pointermove', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;

    // Only start dragging if horizontal movement exceeds vertical
    if (!swipeStart.dragging && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
      swipeStart.dragging = true;
    }
    if (!swipeStart.dragging) return;

    const track = $('#productTrack');
    if (!track) return;
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    const step = productGrid.clientWidth + gap;
    const total = totalPages();
    const baseOffset = -(state.page - 1) * step;
    let offset = baseOffset + dx;

    // Rubber-band at boundaries
    if (offset > 0) {
      offset = offset * 0.25;
    } else if (offset < -(total - 1) * step) {
      const overscroll = offset + (total - 1) * step;
      offset = -(total - 1) * step + overscroll * 0.25;
    }

    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  });

  productGrid.addEventListener('pointerup', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const track = $('#productTrack');
    if (track) track.classList.remove('dragging');

    if (swipeStart.dragging) {
      const dx = e.clientX - swipeStart.startX;
      const pageWidth = productGrid.clientWidth;
      const threshold = pageWidth * 0.12;
      // Flick: a quick short swipe still flips the page
      const elapsed = Date.now() - swipeStart.startT;
      const velocity = Math.abs(dx) / Math.max(elapsed, 1); // px per ms
      const flick = elapsed < 300 && Math.abs(dx) > 30 && velocity > 0.25;

      if ((dx < -threshold || (flick && dx < 0)) && state.page < totalPages()) {
        changePage(1);
      } else if ((dx > threshold || (flick && dx > 0)) && state.page > 1) {
        changePage(-1);
      } else {
        updateProductTrackPosition();
      }

      suppressGridClick = true;
      clearTimeout(productGrid._swipeClickTimer);
      productGrid._swipeClickTimer = setTimeout(() => { suppressGridClick = false; }, 260);
    }

    swipeStart = null;
  });

  productGrid.addEventListener('pointercancel', (e) => {
    const track = $('#productTrack');
    if (track) track.classList.remove('dragging');
    if (swipeStart && swipeStart.dragging) updateProductTrackPosition();
    swipeStart = null;
  });

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
    if (e.target.closest('[data-act="lost-sale"]')) {
      openLostSale({ text: state.query.trim(), reason: 'not-carried' });
      return;
    }
    const card = e.target.closest('.product-card');
    if (!card) return;
    // Back tile inside a group (only when drilled in — left for back-compat)
    if (card.dataset.act === 'back') { closeGroup(); return; }
    // Group parent tile → open the variant picker modal
    if (card.dataset.groupId) { openVariantModal(card.dataset.groupId); return; }
    // Regular product
    addToCart(card.dataset.id, 'tile');
  });

  // ---- Variant picker modal ----
  $('#variantGrid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.variant-tile');
    if (!tile) return;
    selectVariant(tile.dataset.variantId);
  });
  $$('#variantModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeVariantQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#variantQtyInput')?.addEventListener('input', (e) => {
    // Don't rewrite the field while it is being typed -- "2." and "2.5" are both mid-entry.
    state.variantModal.qty = qtyFrom(state.products.find(x => x.id === state.variantModal.selectedId), e.target.value);
  });
  $('#variantQtyInput')?.addEventListener('blur', (e) => {
    e.target.value = qtyFrom(state.products.find(x => x.id === state.variantModal.selectedId), e.target.value);
  });
  $('#variantAddBtn')?.addEventListener('click', addVariantToCart);

  // ---- Orders (rail list + receipt) ----
  $('#ordersList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    state.selectedOrderId = row.dataset.orderId;
    renderOrders();
    $('#orderDetail').scrollTop = 0;
    $('#ordersView').classList.add('reading');
  });
  $('#ordersBack')?.addEventListener('click', () => $('#ordersView').classList.remove('reading'));
  const shownOrder = () => state.orders.find(x => x.id === state.selectedOrderId);
  $('#orderPrint')?.addEventListener('click', () => { const o = shownOrder(); if (o) printOrder(o); });
  $('#orderRefund')?.addEventListener('click', () => {
    const o = shownOrder();
    if (o) showConfirm({ title: `Refund #${o.number}?`, message: `${peso(o.total)} goes back to the customer.`, okText: 'Refund', onConfirm: () => refundOrder(o.id, 'Refunded from Orders') });
  });
  $('#orderMore')?.addEventListener('click', (e) => {
    const o = shownOrder();
    if (!o) return;
    const done = isCompletedSale(o);
    openMenu(e.currentTarget, [
      { label: 'Order details', run: () => openOrderDetailModal(o.id) },
      { label: 'Return items', off: !done, run: () => showConfirm({ title: `Return items on #${o.number}?`, okText: 'Record return', onConfirm: () => recordReturn(o.id, 'Returned from Orders') }) },
      { label: 'Exchange', off: !done, run: () => exchangeFirstInStock(o.id) },
      '-',
      { label: 'Void sale', red: true, off: o.status === 'voided', run: () => showConfirm({ title: `Void #${o.number}?`, message: 'The sale stays on record, marked voided.', okText: 'Void sale', onConfirm: () => voidOrder(o.id, 'Voided from Orders') }) },
    ], { w: 200, right: true });
  });
  // ponytail: exchange swaps in the first product in stock -- the demo behaviour until an exchange picker exists
  function exchangeFirstInStock(id) {
    const replacement = state.products.find(p => p.stock > 0 && p.price > 0);
    if (replacement) exchangeOrder(id, [{ id: replacement.id, qty: 1 }], 'Exchange from Orders');
  }
  $('#orderDetailModal')?.addEventListener('click', (e) => {
    const trip = e.target.closest('[data-delivery-event]');
    if (trip) { recordDeliveryEvent(trip.dataset.orderId, trip.dataset.deliveryEvent); return; }
    const btn = e.target.closest('[data-order-op]');
    if (!btn) return;
    const id = btn.dataset.orderId;
    if (btn.dataset.orderOp === 'void') voidOrder(id, 'Voided from Orders');
    if (btn.dataset.orderOp === 'refund') refundOrder(id, 'Refunded from Orders');
    if (btn.dataset.orderOp === 'return') recordReturn(id, 'Returned from Orders');
    if (btn.dataset.orderOp === 'exchange') exchangeFirstInStock(id);
    $('#orderDetailModal').hidden = true;
    renderOrders();
  });
  wireFind('#ordersFind', '#ordersSearch', '#ordersSearchX', (q) => { state.ordersQuery = q; renderOrders(); });
  $('#ordersFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['When', 'range', ORDER_RANGES.map(([v, l]) => [v, l])],
    ['Staff', 'staff', [['', 'Anyone'], ...[...new Set(state.orders.map(o => o.cashier).filter(Boolean))].sort().map(c => [c, c])]],
    ['Payment', 'pay', [['', 'Any'], ...REPORT_METHOD_ORDER.map(k => [k, reportMethodMeta(k).label, `var(--pm-${k})`])]],
    ['Status', 'status', [['', 'Any'], ['completed', 'Completed'], ['saved', 'Not completed'], ['refunded', 'Refunded'], ['voided', 'Voided'], ['return', 'Return']]],
    ['Fulfilment', 'fulfil', [['', 'Any'], ['pickup', 'Pickup'], ['delivery', 'Delivery']]],
  ], state.ordersFilter, ORDERS_FILTER_DEF, renderOrders));

  // ---- Items (list + editor; Save is not connected yet) ----
  $('#itemsRows')?.addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) openItemEditor(row.dataset.id); });
  $('#itemsAdd')?.addEventListener('click', () => openItemEditor(null));
  $('#itemBack')?.addEventListener('click', closeItemEditor);
  $('#itemSave')?.addEventListener('click', saveItem);
  const notYet = what => () => showToast(`${what} isn't connected yet`);
  $('#itemMore')?.addEventListener('click', (e) => openMenu(e.currentTarget, itemIsNew
    ? [{ label: 'Discard', red: true, run: closeItemEditor }]
    : [{ label: 'Print labels', run: notYet('Printing labels') }, { label: 'Duplicate', run: notYet('Duplicate') }, '-', { label: 'Archive', red: true, run: notYet('Archive') }],
    { w: 200, right: true }));
  wireFind('#itemsFind', '#itemsSearch', '#itemsSearchX', (q) => { itemsFilter.q = q; renderItems(); });
  $('#itemsFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['Category', 'cat', [['', 'All'], ...itemCategories().map(c => [c, c])]],
    ['Stock', 'stock', [['', 'Any'], ['low', 'Low'], ['out', 'Out']]],
  ], itemsFilter, ITEMS_FILTER_DEF, renderItems));
  const itemForm = $('#itemForm');
  itemForm?.addEventListener('input', (e) => {
    const E = itemEdit, t = e.target, f = t.dataset.f, num = () => Number(t.value) || 0;
    if (t.dataset.v) {   // a variant row
      const v = E.variants.find(x => x.id === t.closest('.vt').dataset.vid);
      v[t.dataset.v] = t.type === 'number' ? num() : t.value;
      if (t.dataset.v === 'cost' || t.dataset.v === 'price') t.closest('.vt').querySelector('.mg').textContent = itemMarkup(v.cost, v.price).toFixed(0) + '%';
      return;
    }
    if (!f || t.type === 'checkbox') return;
    if (['cost', 'price', 'stock', 'sku', 'barcode'].includes(f)) E.variants[0][f] = t.type === 'number' ? num() : t.value;
    else E[f] = f === 'marginValue' || f === 'reorder' ? num() : t.value;
    if (f === 'cost' || f === 'marginValue') itemReprice('cost');
    if (f === 'price') itemReprice('price');
    if (f === 'name') itemForm.querySelector('.thumb.big').outerHTML = itemThumb(E, true);
  });
  itemForm?.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f === 'sellOut') itemEdit.sellOut = t.checked;
    if (t.id === 'itemImg' && t.files[0]) { itemEdit.img = URL.createObjectURL(t.files[0]); renderItemForm(); }
  });
  itemForm?.addEventListener('click', (e) => {
    const E = itemEdit, b = e.target.closest('button');
    if (!b) return;
    const pills = b.closest('[data-pills]'), multi = b.closest('[data-multi]'), act = b.dataset.act;
    if (pills) {
      E[pills.dataset.pills] = b.dataset.v;
      if (pills.dataset.pills === 'marginMode') { const v0 = E.variants[0]; E.marginValue = moneyValue(b.dataset.v === 'percent' ? itemMarkup(v0.cost, v0.price) : v0.price - v0.cost); }
      renderItemForm();
    } else if (multi) {
      E.alt = E.alt.includes(b.dataset.v) ? E.alt.filter(s => s !== b.dataset.v) : [...E.alt, b.dataset.v];
      b.classList.toggle('cur');
    } else if (act === 'add-variant') {
      E.variants.push(blankVariant());
      renderItemForm();
      itemForm.querySelector('.vt:last-child [data-v=name]')?.focus();
    } else if (act === 'del-variant') {
      E.variants = E.variants.filter(v => v.id !== b.closest('.vt').dataset.vid);
      renderItemForm();
    } else if (act === 'img-clear') { E.img = ''; renderItemForm(); }
    else if (act === 'stock') showToast("Adjusting stock isn't connected yet");
  });

  // ---- Cart row click → open edit modal ----
  $('#cartList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
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

  // Fulfilment -- delegated, the row is rebuilt on every cart render. The picker opens into the list, the current
  // type bold in its own place.
  $('#fulRow').addEventListener('click', (e) => {
    const pick = e.target.closest('#fulPick');
    if (pick) openMenu(pick, fulfilMethods(state.settings).map(m => ({ label: m.label, cur: m.key === state.fulfilment, run: () => setFulfilment(m.key) })));
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
  $('#newCustomerBtn')?.addEventListener('click', () => {
    state.customerEditFromSale = false;
    openCustomerEditModal();
  });
  // "Add new customer" inside the Sell-page customer picker — reuse the same
  // create form, then auto-select the new customer for the current sale.
  $('#pickerAddCustomerBtn')?.addEventListener('click', () => {
    state.customerEditFromSale = true;
    $('#customerModal').hidden = true;
    openCustomerEditModal();
  });
  $('#customersList')?.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('[data-act="view-customer-detail"]');
    if (detailBtn) {
      e.stopPropagation();
      openCustomerDetail(detailBtn.dataset.customerId);
      return;
    }
    const row = e.target.closest('[data-customer-id]');
    if (!row) return;
    state.selectedCustomerId = row.dataset.customerId;
    renderCustomers();
  });
  $('#customerDetail')?.addEventListener('click', (e) => {
    const historyBtn = e.target.closest('[data-customer-detail]');
    if (historyBtn) {
      openCustomerDetail(historyBtn.dataset.customerDetail);
      return;
    }
    const payBtn = e.target.closest('[data-customer-pay]');
    if (payBtn) {
      const amount = parseFloat(prompt('Payment amount') || '0');
      if (amount > 0) recordCreditPayment(payBtn.dataset.customerPay, amount);
      return;
    }
    const orderRow = e.target.closest('.cd-order-row');
    if (orderRow?.dataset.orderId) {
      openOrderDetailModal(orderRow.dataset.orderId);
    }
  });
  $('#customersSearch')?.addEventListener('input', (e) => {
    state.customersQuery = e.target.value;
    state.selectedCustomerId = null;
    renderCustomers();
  });
  $('#customerDetailModal')?.addEventListener('click', (e) => {
    const row = e.target.closest('.cust-order-row');
    if (row?.dataset.orderId) {
      $('#customerDetailModal').hidden = true;
      openOrderDetailModal(row.dataset.orderId);
    }
  });
  $('#custSaveBtn')?.addEventListener('click', saveSavedCustomerFromModal);

  // Total opens its breakdown (Subtotal, Discount, VAT) above it
  $('#totalRow').addEventListener('click', () => {
    $('#totalRow').setAttribute('aria-expanded', $('#totalsDetail').classList.toggle('open'));
  });

  // ⋯ opens the sale actions, the menu covering the ⋯ itself
  function confirmClearCart() {
    if (state.cart.length === 0) return;
    showConfirm({
      title: 'Clear receipt?',
      message: 'All items in the current receipt will be removed. This cannot be undone.',
      okText: 'Yes, clear',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: () => {
        track('cart_clear', { lines: state.cart.length, subtotal: cartTotals().subtotal });
        clearCart();
        showToast('Cart cleared');
      }
    });
  }
  $('#cartMoreBtn').addEventListener('click', (e) => {
    const empty = state.cart.length === 0;
    openMenu(e.currentTarget, [
      { label: 'Save receipt', run: openSaveReceiptModal, off: empty }, { label: 'Lost sale', run: () => openLostSale() }, '-',
      { label: 'Clear sale', run: confirmClearCart, red: true, off: empty },
    ], { w: 200, right: true });
  });

  // ---- Customer ----
  $('#customerBtn').addEventListener('click', () => {
    if (state.view === 'checkout' && $('#checkoutApp').classList.contains('is-done')) return;   // the sale is done
    openCustomerModal();
  });
  $('#customerModal').addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer-id]');
    if (row) selectCustomer(row.dataset.customerId);
  });

  // ---- Lost sale ----
  $('#lsItemInput')?.addEventListener('input', () => { state.lostSale.productId = ''; renderLostSale(); });
  $('#lsMatches')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ls-product]');
    const p = b && state.products.find(x => x.id === b.dataset.lsProduct);
    if (!p) return;
    state.lostSale.productId = p.id;
    $('#lsItemInput').value = p.name;
    renderLostSale();
  });
  $('#lsReasons')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ls-reason]');
    if (!b) return;
    state.lostSale.reason = b.dataset.lsReason;
    renderLostSale();
  });
  $('#lsSaveBtn')?.addEventListener('click', saveLostSale);

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

  // Payment-method selection
  function selectPayMethod(method, label = '') {
    state.paymentMethod = method;
    state.paymentLabel = label;
    state.paymentMethodChosen = true;
    // A custom card fills the Other name itself, so completeSale records it unchanged.
    $('#otherMethodInput').value = method === 'other' ? label : '';
    $('#checkoutTender').value = '';
    track('payment_method', { method });
    showPayStep();
    // No autofocus on cash: a tablet keyboard would cover the amounts.
    if (method === 'split') setTimeout(() => $('#checkoutTender')?.focus(), 60);
    else if (method === 'other' && !label) setTimeout(() => $('#otherMethodInput')?.focus(), 60);
  }
  // Delegated: the tiles are rebuilt from settings on every checkout render.
  $('#checkoutMethods')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-co-method]');
    if (card) selectPayMethod(card.dataset.method, card.dataset.label || '');
  });

  // Back: a method's detail -> the method tiles; the tiles -> the cart.
  $('#checkoutCancelBtn')?.addEventListener('click', () => {
    if ($('#checkoutApp').classList.contains('is-done')) return;
    if (state.paymentMethodChosen) {
      state.paymentMethodChosen = false;
      state.paymentMethod = 'cash';
      state.paymentLabel = '';
      $('#checkoutTender').value = '';
      showPayStep();
    } else {
      track('checkout_cancel');
      switchView(state.prevView && state.prevView !== 'checkout' ? state.prevView : 'sell');
    }
  });
  $('#checkoutCustBtn')?.addEventListener('click', openCustomerModal);
  $('#checkoutTender')?.addEventListener('input', (e) => {
    // Digits and one point, two decimals.
    const v = e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*$/, '$1');
    if (v !== e.target.value) e.target.value = v;
    updateChange();
  });
  $('#checkoutTender')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#checkoutCompleteBtn').disabled) completeSale();
  });
  $('#otherMethodInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') completeSale(); });
  // A cash amount is the decision: the tap finishes the sale.
  $('#checkoutQuick')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-co-cash]');
    if (!b) return;
    $('#checkoutTender').value = b.dataset.coCash;
    updateChange();
    completeSale();
  });
  $('#checkoutSteps')?.addEventListener('click', (e) => { if (e.target.closest('[data-complete]')) completeSale(); });
  window.addEventListener('resize', () => { fitCheckout(); centreCheckout(); });
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
  $$('#posTextToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      setTileText(b.dataset.text);
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
  $('#posCartHead')?.addEventListener('change', (e) => {
    HWPOS_STORE.ui.set('cartHead', e.target.checked ? '1' : '0');
    applyCartHead(e.target.checked);
  });
  $('#posPrintOnSale')?.addEventListener('change', persistPosSettings);
  $$('#posWidthToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.settings.printing = { ...printerConfig(), width: b.dataset.width };
      saveSettings();
      renderPosSettings();
    });
  });
  $('#posPrintCut')?.addEventListener('change', persistPosSettings);
  $('#posPrintMap')?.addEventListener('change', persistPosSettings);
  $('#posPrinterIp')?.addEventListener('change', persistPosSettings);
  $$('#posDriverToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.settings.printing = { ...printerConfig(), driver: b.dataset.driver };
      saveSettings();
      renderPosSettings();
    });
  });
  $('#posBtPairBtn')?.addEventListener('click', async () => {
    try {
      const dev = await window.HWPOS_PRINTER.pairBluetooth();
      state.settings.printing = { ...printerConfig(), btName: dev.name, btId: dev.id };
      saveSettings();
      renderPosSettings();
      showToast('Paired ' + dev.name);
    } catch (e) {
      if (e.name !== 'NotFoundError') showToast(e.message || 'Pairing failed');
    }
  });
  $('#posScanBtn')?.addEventListener('click', async () => {
    const btn = $('#posScanBtn');
    const subnets = printerScanSubnets();
    btn.disabled = true;
    btn.innerHTML = '<span class="prn-spin"></span>Scanning…';
    try {
      const hits = [];
      for (const net of subnets) {
        setScanStatus('Scanning ' + net + '.1-254…');
        const found = await window.HWPOS_PRINTER.scanNetwork(net, (done, total) => {
          setScanStatus('Scanning ' + net + '.x — ' + done + '/' + total);
        });
        hits.push(...found);
        if (found.length) break;   // first subnet with printers wins; don't sweep the rest
      }
      printerFound = [...new Set(hits)];
      renderPrinterList();
      if (!printerFound.length) {
        setScanStatus('No printer found on ' + subnets.join(', ') + '. Check it is on the same Wi-Fi, or enter the IP below.');
      } else if (printerFound.length === 1 && !(printerConfig().netUrl || '').trim()) {
        await connectPrinter(printerFound[0]);   // exactly one, nothing connected yet — just connect it
      } else {
        setScanStatus('Found ' + printerFound.length + ' printer' + (printerFound.length === 1 ? '' : 's') + '. Tap one to connect.');
      }
    } catch (e) {
      setScanStatus(e.message || 'Scan failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan for printers';
    }
  });
  $('#posPrinterList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.prn-item');
    if (item) connectPrinter(item.dataset.ip);
  });
  $('#posTestPrintBtn')?.addEventListener('click', () => {
    persistPosSettings();
    printOrder(sampleTestOrder());
  });

  // Product modal save
  $('#saveProductBtn').addEventListener('click', saveProduct);

  // Folder modal save
  $('#saveFolderBtn').addEventListener('click', saveFolder);
  $('#folderNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolder();
  });

  window.addEventListener('online', () => track('online'));
  window.addEventListener('offline', () => track('offline'));
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
  applyCartHead(state.cartHead);
  renderCart();
  updateCustomerButton();
  populateFolderSelect();
  applyRoleGating();
  renderRoleSwitcher();
  attachEvents();
  track('app_open');
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
  $$('.bb-size-btn[data-size]').forEach(b => b.classList.toggle('active', b.dataset.size === state.tileSize));
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
      if (state.view === 'reports') renderReports();
      if (state.view === 'customers') renderCustomers();
    }
    if (e.key === STORAGE_CUSTOMER_LEDGER) {
      state.customerLedger = loadCustomerLedger();
      if (state.view === 'customers') renderCustomers();
    }
    // Stock changes from another tab — refresh product tiles.
    if (e.key === STORAGE_PRODUCTS) {
      state.products = loadProducts();
      rebuildFuse();
      if (state.view === 'sell') renderProducts();
    }
    if (e.key === STORAGE_SETTINGS) {
      const was = currentStoreInfo().cashier;
      state.settings = loadSettings();
      if (currentStoreInfo().cashier !== was) track('cashier_switch', { from: was, to: currentStoreInfo().cashier });
      state.vatRate = state.settings.vatRate ?? DEFAULT_SETTINGS.vatRate;
      renderCart();
      if (state.view === 'checkout') renderCheckout();
    }
  });
  // Also refresh when the user returns to the POS tab in case they changed it
  // in the back office on another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { endSearch(true); track('app_hidden'); return; }
    track('app_visible');
    const newSize = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
    const newShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
    let changed = false;
    if (newSize !== state.tileSize && ITEMS_PER_PAGE[newSize]) { state.tileSize = newSize; state.page = 1; changed = true; }
    if (newShow !== state.showPrice) { state.showPrice = newShow; changed = true; }
    const was = currentStoreInfo().cashier;
    state.settings = loadSettings();
    if (currentStoreInfo().cashier !== was) track('cashier_switch', { from: was, to: currentStoreInfo().cashier });
    state.vatRate = state.settings.vatRate ?? DEFAULT_SETTINGS.vatRate;
    if (changed) renderProducts();
    // Always re-pull orders so the list is up to date.
    state.orders = loadOrders();
    state.customerLedger = loadCustomerLedger();
    if (state.view === 'orders') renderOrders();
    if (state.view === 'reports') renderReports();
    if (state.view === 'customers') renderCustomers();
  });

  // Live transaction feed for the Reports page (multi-cashier real-time).
  setInterval(reportsLive, 4000);

  // Tap a transaction row to open its full order details.
  $('#reportsTxList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.report-tx');
    if (row?.dataset.orderId) openOrderDetailModal(row.dataset.orderId);
  });
}
document.addEventListener('DOMContentLoaded', init);
