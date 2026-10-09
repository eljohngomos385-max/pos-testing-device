/* ==========================================================
   Hardware POS — UI logic
   - Persisted through HWPOS_STORE.kv (data-store.js): sales in IndexedDB, the rest localStorage
   ========================================================== */

// The till is one classic script per screen; index.html sets the load order (one global scope).
// Only const initialisers run at load; everything else waits for init() on DOMContentLoaded.

// Storage keys and default settings live once, in data-store.js (HWPOS_STORAGE_KEYS, HWPOS_STORE.defaults);
// bo-model's storeKey reads that list.
const STORAGE_FOLDERS = storeKey('folders');
const STORAGE_PRODUCTS = storeKey('products');
const STORAGE_GROUPS = storeKey('groups');
const STORAGE_ORDERS = storeKey('orders');
const STORAGE_ORDER_SEQ = storeKey('orderSeq');
const STORAGE_CUSTOMERS = storeKey('customers');
const STORAGE_CUSTOMER_LEDGER = storeKey('customerLedger');
const STORAGE_SETTINGS = storeKey('settings');

// ponytail: a node check that loads app.js without data-store.js gets the till's register '1' and nothing else.
const DEFAULT_SETTINGS = (globalThis.HWPOS_STORE && HWPOS_STORE.defaults)
  ? HWPOS_STORE.defaults() : { store: { registerNo: '1' }, sync: {}, printing: {}, fulfilment: { hidden: [], custom: [] } };

const STORAGE_TILE_SIZE = storeKey('tileSize');
const STORAGE_SHOW_PRICE = storeKey('showPrice');
const STORAGE_TILE_TEXT = 'hwpos.tileText';   // this till's own text size; not synced, not in the shared list
const TILE_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'];
const STORAGE_THEME = storeKey('theme');

const ITEMS_PER_PAGE = { sm: 30, md: 20, lg: 12 };
const ORDER_SCHEMA_VERSION = SalesMath.ORDER_VERSION;   // 2: 'walkin' is the counter sale (SalesMath.readOrder)
const ORDER_FORMAT_KEY = 'hwpos.order.v1';

function storageGet(key, fallback = null) {
  try {
    const value = (window.HWPOS_STORE?.kv || localStorage).getItem(key);
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    (window.HWPOS_STORE?.kv || localStorage).setItem(key, value);
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
  return SalesMath.round2(toNumber(value, 0));
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
  state.scPwd = null;   // a fresh cart never carries the last cardholder (lines removed one by one, not cleared)
  state.savedId = '';   // ...nor the saved cart the emptied one was continuing (continueDraft sets it after this)
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
  if (p.trackStock !== false && stockOnHand <= 0) track('oos_tap', { productId: p.id, stockOnHand });
  track('item_add', { productId: p.id, qty, unitPrice: p.price, stockOnHand, via });
  if (via !== 'scan' && searchIntent && state.query.trim()) {
    searchIntent.picked = true;
    track('search', { query: searchIntent.query, results: searchIntent.results || 0, chosenProductId: p.id });
  }
}

// ---------- State ----------

const state = {
  view: 'sell',
  query: '',
  folders: [],
  products: [],
  groups: [],
  orders: [],
  selectedOrderId: null,
  ordersQuery: '',
  ordersCustomer: '',   // a customer's "See all": Orders shows only theirs (ordersFor)
  ordersFilter: { range: 'week', staff: '', pay: '', status: '', fulfil: '' },   // ORDERS_FILTER_DEF
  variantModal: { groupId: null, query: '', available: false },
  cart: [],
  cartDiscount: null,           // {type:'amount'|'percent', value:number}
  scPwd: null,                  // {kind:'senior'|'pwd', idNo, name}: the cart's SC/PWD discount (edit sheet); replaces cartDiscount
  fulfilment: 'walkin',         // a FULFIL_BUILTINS key (bo-model) or the owner's own type
  deliveryAddress: '',
  pickupTime: null,   // { day, time }: the fulfilment sheet shows it; not on the order yet
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
  paymentMethod: 'cash',
  role: 'owner',                // the signed-in person's role (bo-model STAFF_ROLES); owner while no one has a PIN
  user: null,                   // the signed-in person { id, name, role }; null = no sign-in (no PINs yet)
  settings: { ...DEFAULT_SETTINGS },
  fuse: null,
  page: 1,
  tileSize: (storageGet(STORAGE_TILE_SIZE, 'md') || 'md'),
  tileText: (storageGet(STORAGE_TILE_TEXT, 'md') || 'md'),
  showPrice: storageGet(STORAGE_SHOW_PRICE, '0') === '1',
  theme: (storageGet(STORAGE_THEME, 'dark') || 'dark'),
  cartHead: window.HWPOS_STORE?.ui.get('cartHead', '1') !== '0',               // the Item / Amount band
  tileStock: window.HWPOS_STORE?.ui.get('tileStock', '0') === '1',             // Settings › Tiles show = Stock (tileLine)
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
  facing: 'environment',   // the flip button swaps it
  run: 0,                  // every stop bumps it: a camera asked for before a close or a flip is let go when it arrives
};

// ---------- Helpers ----------
const peso = (n) => SalesMath.formatMoney(n, state.settings?.store?.currency);
// The till's tax setup, for SalesMath.orderTotals ("VAT registered" off = no tax). The cart's SC/PWD: cartTotals.
const taxOpts = () => SalesMath.taxOpts(state.settings);
// "VAT (12% incl.)" / "Tax (8%)": the store's tax name and rate.
const taxLabel = (rate, included) => `${SalesMath.taxName({ ...state.settings, taxOnTop: !included })} (${SalesMath.ratePct(rate)}${included ? ' incl.' : ''})`;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
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
  const nextHeight = keyboardShrink ? stableHeight : measuredHeight;   // only the keyboard is held; a smaller window (Stage Manager) shrinks the app

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

// The app's own "are you sure?": a small card like Record payment (.pay-sheet) in a .rail-veil -- a title, one quiet
// line, Cancel and OK. `from`: the button that asked; the card grows out of it (growFrom). None, or one not on
// screen = centred. `danger`: OK in the tinted red, for a delete only; everything else is the till's normal primary.
// `html`: markup for the message (the refund line picker, which reads #confirmMessage), built with escapeHtml.
// Enter = OK, Esc / a tap outside / Cancel = cancel, Tab stays inside. `onCancel` runs on every close that isn't OK
// (stockOnAdd puts the edit sheet's quantity back), but not when a new ask replaces this one.
let confirmSheet = null;
function showConfirm({ title = 'Are you sure?', message = '', html = '', okText = 'Confirm', cancelText = 'Cancel', danger = false, from = null, onConfirm, onCancel } = {}) {
  confirmSheet?.(true);   // one at a time
  $$('.cf-sheet [id]').forEach(el => el.removeAttribute('id'));   // one still shrinking away: #confirmMessage is the new one's
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<form class="pay-sheet cf-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage" novalidate>
    <div class="ph"><b id="confirmTitle"></b><div class="cf-msg" id="confirmMessage"></div></div>
    <div class="pb"><button type="button" class="secondary-btn small" data-cancel></button><button type="submit" class="primary-btn small${danger ? ' danger' : ''}"></button></div>
  </form>`;
  const f = veil.firstChild, msg = f.querySelector('#confirmMessage'), ok = f.querySelector('[type="submit"]');
  f.querySelector('#confirmTitle').textContent = title;
  if (html) msg.innerHTML = html; else msg.textContent = message;
  msg.hidden = !html && !message;
  ok.textContent = okText;
  f.querySelector('[data-cancel]').textContent = cancelText;
  f.style.width = Math.min(340, innerWidth - 24) + 'px';
  document.body.append(veil);
  const r = from?.isConnected && from.getBoundingClientRect();
  const W = f.offsetWidth, H = f.offsetHeight, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  f.style.left = clamp(r?.width ? r.right - W : (innerWidth - W) / 2, 12, innerWidth - W - 12) + 'px';
  f.style.top = clamp(r?.width ? r.top : (innerHeight - H) / 2, 8, innerHeight - H - 8) + 'px';
  const shrink = r?.width ? growFrom(f, r)
    : (f.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: calmMs(140), easing: 'ease-out' }),
      (done) => { f.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: calmMs(90) }).onfinish = done; });
  const back = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); return close(); }
    if (e.key !== 'Tab') return;
    const els = [...f.querySelectorAll('input, select, textarea, button')].filter(x => !x.disabled), i = els.indexOf(document.activeElement);
    if (i < 0 || i === (e.shiftKey ? 0 : els.length - 1)) { e.preventDefault(); els[e.shiftKey ? els.length - 1 : 0].focus(); }
  };
  // Closes first, then the answer runs (its own pop-up or focus wins); the card keeps its ids while it shrinks, so
  // onConfirm can still read #confirmMessage. `how`: true = replaced by a new ask before any answer, 'ok' = OK.
  const close = (how) => {
    if (confirmSheet !== close) return;
    confirmSheet = null;
    document.removeEventListener('keydown', onKey, true);
    if (how === true) return veil.remove();
    veil.style.pointerEvents = 'none';
    shrink(() => veil.remove());
    if (back?.isConnected) back.focus({ preventScroll: true });
    if (how !== 'ok' && typeof onCancel === 'function') onCancel();
  };
  confirmSheet = close;
  document.addEventListener('keydown', onKey, true);
  f.addEventListener('submit', (e) => { e.preventDefault(); close('ok'); if (typeof onConfirm === 'function') onConfirm(); });
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-cancel]')) close(); });
  (msg.querySelector('input') || ok).focus({ preventScroll: true });
}

// ---------- Persistence ----------
function loadFolders() {
  return readJsonStorage(STORAGE_FOLDERS, null) || SEED_FOLDERS.map(f => ({ ...f }));
}
// On hand = the movement log's sum (bo-model withStock).
function loadProducts() {
  return withStock(readJsonStorage(STORAGE_PRODUCTS, null) || PRODUCTS.map(p => ({ ...p })));
}
// The one catalog write both apps share (bo-model saveCatalog), so price history logs the same way.
function saveProducts() {
  return saveCatalog(state.products, { source: 'pos', staff: currentStoreInfo().cashier });
}
function loadGroups() {
  return readJsonStorage(STORAGE_GROUPS, null)
    || ((typeof SEED_GROUPS !== 'undefined') ? SEED_GROUPS.map(g => ({ ...g })) : []);
}
function saveGroups() {
  return writeJsonStorage(STORAGE_GROUPS, state.groups);
}
function groupById(id) { return state.groups.find(g => g.id === id) || null; }
// On the till = a tile and a search hit. Archived is gone; hidden is kept in the back office but
// off the till (owner, 2026-10-01) -- a scan still finds both and asks (addProductByCode).
const onTill = p => !p.archived && !p.hidden;
function groupMembers(groupId) {
  return state.products.filter(p => p.groupId === groupId && onTill(p));
}

// ---------- Orders persistence ----------
// ponytail: memoized on the stored string -- normalizing every row on every read made each sale
// cost O(orders) (30 ms at 1,000). Callers never edit a loaded row (append-only), so the rows are
// shared and only the array is copied. One row per record (architecture Phase 3) retires this.
let ordersMemo = { text: null, list: [] };
function loadOrders() {
  const text = storageGet(STORAGE_ORDERS, null);
  if (text && text === ordersMemo.text) return ordersMemo.list.slice();
  const raw = readJsonStorage(STORAGE_ORDERS, []);
  if (!Array.isArray(raw)) return [];
  // Rows from before 2026-10-02 (a sale flipped to voided/refunded, 'return' rows) become a sale
  // plus its own void/refund row. A row with no id or no numeric time would get a fresh one on
  // every read. Both are written back once, so the next load finds nothing to do.
  const up = SalesMath.upgradeOrders(raw);
  const orders = up.map(normalizeOrderRecord).filter(Boolean);
  if (up.length !== raw.length || up.some((o, i) => o !== raw[i] || o.id == null || typeof o.ts !== 'number')) saveOrdersList(orders);
  else ordersMemo = { text, list: orders };
  return orders.slice();
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
  const registerNo = currentStoreInfo().registerNo || DEFAULT_SETTINGS.store.registerNo;
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
  if (globalThis.HWPOS_STORE && HWPOS_STORE.readSettings) return HWPOS_STORE.readSettings(saved);
  const out = { ...DEFAULT_SETTINGS, ...saved };
  for (const k of ['fulfilment', 'store', 'sync', 'printing']) out[k] = { ...DEFAULT_SETTINGS[k], ...(saved[k] || {}) };
  return out;
}
function saveSettings() {
  return writeJsonStorage(STORAGE_SETTINGS, state.settings);
}

function currentStoreInfo() {
  // The signed-in person is the cashier on every order, stock movement and receipt.
  return { ...DEFAULT_SETTINGS.store, ...(state.settings?.store || {}), ...(state.user ? { cashier: state.user.name } : {}) };
}

// ---------- Order format layer ----------
function normalizeOrderItem(item = {}) {
  // Floor at 0, not 1: a hardware store sells 2.5 m of wire and 0.75 kg of nails,
  // and clamping that up to 1 invents both stock and revenue.
  const qty = Math.max(0, toNumber(item.qty, 1));
  const price = moneyValue(item.price);
  const disc = item.discount && item.discount.value
    ? { type: item.discount.type === 'percent' ? 'percent' : 'amount', value: toNumber(item.discount.value, 0) }
    : null;
  const m = SalesMath.lineMoney(price, qty, disc, state.settings.store?.currency);
  const cost = item.cost != null ? toNumber(item.cost, NaN) : NaN;   // buildOrderRecord stamps it; reading never does
  return {
    id: String(item.id || item.productId || ''),
    productId: String(item.productId || item.id || ''),
    sku: String(item.sku || ''),
    name: String(item.name || 'Item'),
    unit: String(item.unit || 'pc'),
    qty,
    price,
    discount: disc,
    lineGross: m.lineGross,
    lineDiscount: m.lineDiscount,
    lineTotal: m.lineTotal,
    // What this cost US, stamped at the moment of sale. Suppliers re-price; without this,
    // every past margin in the back office silently rewrites itself the next time cost moves.
    // Unknown (an old line, or no product to read it from) stays null, not 0 and never today's
    // cost: a free item would read 100% margin.
    cost: Number.isFinite(cost) ? moneyValue(cost) : null,
    // A refund's line: its place on the sale (SalesMath.refundPart), so later refunds know what is left.
    ...(item.lineNo != null ? { lineNo: Math.max(0, Math.floor(toNumber(item.lineNo, 0))) } : {}),
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
      ...(balance > 0 ? [{ method: 'credit', label: 'Account', amount: balance, tendered: 0, change: 0, ref: '' }] : []),
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

// The till's order on top of SalesMath.readOrder, the one reader both apps share: every money
// field comes from there, so the till and the back office can't read one row two ways. A row with
// no VAT stamped reads VAT 0 (never today's rate); a line with no cost stays null (never today's
// cost). Only till things are added here: payment labels, payments for old rows, delivery.
function normalizeOrderRecord(raw = {}) {
  const o = SalesMath.readOrder(raw, { rate: taxOpts().rate });
  if (!o) return null;
  const items = o.items.map(normalizeOrderItem);
  // Legacy voided/refunded/return rows never get here: loadOrders runs SalesMath.upgradeOrders first.
  const status = ['saved', 'completed', 'void', 'refund'].includes(raw.status) ? raw.status : 'completed';
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
  const total = moneyValue(o.total);
  const payments = o.payments.length
    ? o.payments.map(normalizePayment)
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
  const id = String(raw.id || newId());
  const number = String(raw.number || raw.receiptNumber || raw.orderNumber || id);
  // Any non-empty name is a type the owner added; it is stored as itself so the order
  // keeps its label after the type is removed. Only 'delivery' carries an address.
  const fulfilment = o.fulfilment;
  return {
    schemaVersion: ORDER_SCHEMA_VERSION,
    formatKey: ORDER_FORMAT_KEY,
    id,
    number,
    // readOrder's ts (an old text date keeps its day). A row with no time stays 0, as the back office
    // reads it: stamping the load time here moved an old sale into today on every report.
    ts: o.ts,
    status,
    cashier: String(raw.cashier || store.cashier),
    staffId: String(raw.staffId || ''),         // who rang it (the till's sign-in)
    approvedBy: String(raw.approvedBy || ''),   // the manager whose PIN let it through, if one had to
    register: String(raw.register || store.registerNo),
    storeId: String(raw.storeId || ''),         // the sync fields ride along (persistOrder stamps new rows)
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
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
    subtotal: moneyValue(o.subtotal),
    discount: moneyValue(o.discount),
    cartDiscount: raw.cartDiscount ? { ...raw.cartDiscount } : null,
    originalOrderId: raw.originalOrderId ? String(raw.originalOrderId) : '',
    reason: raw.reason ? String(raw.reason) : '',
    total,
    tendered: moneyValue(o.tendered || firstCash?.tendered || 0),
    change: moneyValue(o.change || firstCash?.change || 0),
    vatRate: o.vatRate,
    vatAmount: moneyValue(o.vatAmount),
    vatableSales: moneyValue(o.vatableSales),
    vatExempt: moneyValue(o.vatExempt),
    scPwdOff: moneyValue(o.scPwdOff),
    scPwd: o.scPwd,   // the SC/PWD cardholder (readOrder), or null
    taxIncluded: o.taxIncluded,
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
  const fulfilmentLabel = orderFulfilLabel(o).toUpperCase()
    + (o.fulfilment === 'delivery' && o.deliveryAddress ? ' · ' + o.deliveryAddress : '');
  // The slip's words come from the row's state, one place for the screen, the pop-up and the printer:
  // mark, Paid / Given back, Cashier / Voided by / Refunded by, the tenders by name, the footer, SC/PWD.
  const orders = Array.isArray(state.orders) ? state.orders : [];
  // A saved cart or quote (draftAsOrder) has no receipt number; a quote's slip is headed QUOTATION.
  const parts = SalesMath.receiptParts({ ...o, draft: order.draft }, orders.find(x => x.id === o.originalOrderId) || null, orderReversals());
  return {
    store: currentStoreInfo(),
    number: order.draft ? '' : o.number,
    ts: o.ts,
    dateText: tillDate(o.ts, 'slip'),
    cashier: o.cashier,
    register: o.register,
    customer: o.customer,
    deliveryAddress: o.deliveryAddress,
    deliveryLocation: o.deliveryLocation,
    fulfilmentLabel,
    // Each line's `amount` is its price × qty before discount, fitted to the Subtotal (SalesMath.receiptLines):
    // the lines add up to the Subtotal, the discount shows once below it, like the cart.
    items: o.items.length ? SalesMath.receiptLines(o).map(l => ({ ...l.item, amount: l.amount })) : [],
    totals: {
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      vatRate: o.vatRate,
      vatAmount: o.vatAmount,
      vatableSales: o.vatableSales,
      taxIncluded: o.taxIncluded,
    },
    status: o.status,
    ...parts,   // kind, mark, paidWord, whoWord, legs, footer, scPwd
    taxName: SalesMath.taxName({ ...state.settings, taxOnTop: !o.taxIncluded }),
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
  const indexed = state.products.filter(onTill).map(p => ({
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

// ---------- Category name ----------
function folderName(id) {
  const f = state.folders.find(x => x.id === id);
  return f ? f.name : 'Uncategorized';
}

// ---------- Roles ----------
const ROLE_ALLOWED = {
  cashier: new Set(['sell', 'orders', 'items', 'shift', 'settings', 'checkout']),
  manager: new Set(['sell', 'orders', 'items', 'customers', 'shift', 'back-office', 'settings', 'checkout']),   // ponytail: Reports hidden for now; add 'reports' back to bring it back
};
ROLE_ALLOWED.owner = ROLE_ALLOWED.manager;   // the till's pages; the back office has its own page access
ROLE_ALLOWED.stock = ROLE_ALLOWED.cashier;
function canAccess(view) {
  const allowed = ROLE_ALLOWED[state.role] || ROLE_ALLOWED.cashier;   // an unknown role gets the least
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
  sub.textContent = `${STAFF_ROLES[state.role] || 'Staff'} · Main store`;
  if (state.user) userMeta.querySelector('.user-name').textContent = state.user.name;
}

// ---------- View switching ----------
function switchView(view) {
  if (!canAccess(view)) {
    showToast('You do not have permission for that page');
    return;
  }
  // An exchange holds Sell and the checkout until it is rung or ✕'d (startExchange / leaveExchange).
  if (state.exchange && view !== 'sell' && view !== 'checkout') { showToast('Finish or cancel the exchange first'); return; }
  const fromCheckout = state.view === 'checkout';
  if (view !== 'orders' && state.ordersCustomer) ordersFor('');
  state.view = view;
  if (view !== 'sell') closeBarcodeScanner();   // the tablet's ☰ and Check out stay in reach while it scans
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
  if (view === 'sell') renderProducts();   // stock may have moved elsewhere (void, refund) — tile marks read it
  if (view === 'items') renderItems();
  if (view === 'customers') renderCustomers();
  if (view === 'shift') renderShift();
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

