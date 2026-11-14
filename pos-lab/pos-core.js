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
const defaultTileSize = () => (matchMedia('(max-width: 720px)').matches ? 'wide' : 'md');   // until this POS picks one: Wide on a phone, Medium wider (owner 2026-11-15)
const STORAGE_SHOW_PRICE = storeKey('showPrice');
const STORAGE_TILE_TEXT = 'hwpos.tileText';   // this till's own text size; not synced, not in the shared list
const STORAGE_CART = 'hwpos.cart';   // this till's open sale (keepCart, pos-sell); not synced either
const TILE_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'];
const STORAGE_THEME = storeKey('theme');

const ITEMS_PER_PAGE = { sm: 30, md: 20, wide: 20, lg: 12 };   // wide: the phone's 2 across at Medium's height; a tablet shows it as Medium
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
  state.discountOk = null;   // ...nor a manager's yes to the last one's discount (discountOk)
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
  pickupTime: null,   // "2026-11-06T14:00" (the wheel's local value): the fulfilment sheet shows it; not on the order yet
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
  sellPage: window.HWPOS_STORE?.ui.get('sellPage', 'all') === 'mine' ? 'mine' : 'all',   // Sell's page: My page | All items (pos-sell.js setSellPage)
  tileSize: (storageGet(STORAGE_TILE_SIZE, '') || defaultTileSize()),
  tileText: (storageGet(STORAGE_TILE_TEXT, 'md') || 'md'),
  showPrice: storageGet(STORAGE_SHOW_PRICE, '0') === '1',
  theme: (storageGet(STORAGE_THEME, 'dark') || 'dark'),
  tileStock: window.HWPOS_STORE?.ui.get('tileStock', '0') === '1',             // Settings › Tiles show: Stock, or both with showPrice (tileShowNow)
  sellLayout: ['list', 'rows'].includes(window.HWPOS_STORE?.ui.get('sellLayout')) ? window.HWPOS_STORE.ui.get('sellLayout') : 'grid',   // Settings › View: grid | list | rows (pos-sell.js sellAsList)
  tilePics: (v => v === 'top' ? 'fill' : v || 'off')(window.HWPOS_STORE?.ui.get('tilePics', 'off')),   // Settings › Tile pictures: off | fill (tileArt); 'top' was Photo top, gone (owner 2026-10-29)
  cartPics: (v => v === 'on' ? 'sm' : v || 'off')(window.HWPOS_STORE?.ui.get('cartPics', 'off')),   // Settings › Cart pictures: off | sm | md | lg (linePic); 'on' was Small
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
// A big number typed on keys (owner 2026-11-11, hero-pop-lab.html "Typing: Smooth" + "Opening: Grow"): only one marked
// data-ht="<what's typed>", never a total. Each key redraws its sheet, so heroSnap reads the number on screen first and
// heroPlay carries the new one on from it: the rest glide to their place, a new character grows from its foot, a gone one
// shrinks back where it was. A new page (data-ht or owner changed) grows in, left to right. Plain transform: any phone.
const HT = { ms: 380, ease: 'cubic-bezier(.32, .72, 0, 1)', scale: .5, blur: 4, fadeIn: 160, fadeOut: 110 };   // iOS's sheet curve; a fade on the glide's long landing lingered, so its own, short
function heroSnap(root) {
  const h = root.querySelector('[data-ht]');
  const at = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e.firstChild);
    return { e, k: e.dataset.k, x: (r.left + r.right) / 2, op: +cs.opacity, sc: cs.transform === 'none' ? 1 : new DOMMatrix(cs.transform).a }; };
  return h && { id: h.dataset.ht, owner: root._ht, chars: [...h.querySelectorAll('.ch:not(.ht-gone)')].map(at), gone: [...h.querySelectorAll('.ht-gone')].map(at) };
}
// each character in its own box (.ch slides) holding the letter (i grows and fades), keyed so a 5 stays the 5 as more are
// typed: a digit by its place from the left, a comma by the digits to its right, so 5,000 -> 50,000 slides the comma over
function heroSplit(h) {
  const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT), ts = [], chs = [];
  while (w.nextNode()) ts.push(w.currentNode);
  for (const t of ts) t.replaceWith(...[...t.data].map((c) => {
    if (/\s/.test(c)) return c;   // a space in a box of its own has no width ("1.5 kg")
    const e = document.createElement('span'), l = document.createElement('i');
    e.className = 'ch'; l.textContent = c; e.append(l); chs.push({ e, c });
    return e;
  }));
  const isD = (c) => c >= '0' && c <= '9', dec = peso(0).match(/0(\D)0/)?.[1] || '.';
  let first = -1, last = -1;
  chs.forEach((x, i) => { if (isD(x.c)) { if (first < 0) first = i; last = i; } });
  const p = chs.findIndex((x, i) => i > first && x.c === dec), end = p < 0 ? chs.length : p;
  let di = 0, fi = 0;
  chs.forEach((x, i) => {
    x.k = (i === p ? 'p' : isD(x.c) ? (i < end ? 'd' + di++ : 'f' + fi++) : first < 0 || i < first ? 'a' + i
      : i < end && i < last ? 'c' + di : 'z' + (i - Math.max(last, p))) + x.c;
    x.e.dataset.k = x.k;
  });
  return chs;
}
function heroPlay(root, snap, owner) {
  const h = root.querySelector('[data-ht]');
  root._ht = owner;
  if (!h || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const chs = heroSplit(h), T = HT, move = { duration: T.ms, easing: T.ease };
  const slide = (e, a, b, o) => e.animate({ transform: [`translateX(${a}px)`, `translateX(${b}px)`] }, { ...move, ...o });
  const grow = (e, a, b, o) => e.animate({ transform: [`scale(${a})`, `scale(${b})`] }, { ...move, ...o });
  const look = (op) => ({ opacity: op, filter: `blur(${(1 - op) * T.blur}px)` });
  const fade = (e, a, b, o) => e.animate([look(a), look(b)], { duration: b ? T.fadeIn : T.fadeOut * a, easing: 'ease-out', ...o });
  if (!snap?.chars.length || snap.id !== h.dataset.ht || snap.owner !== owner) {   // a total written over it since (split) has none
    return chs.forEach((c, i) => { const o = { duration: 500, delay: i * 18, fill: 'backwards' }; grow(c.e.firstChild, T.scale, 1, o); fade(c.e.firstChild, 0, 1, o); });
  }
  const mid = (e) => { const r = e.getBoundingClientRect(); return (r.left + r.right) / 2; };
  const was = new Map(snap.chars.map((c) => [c.k, c]));
  const dx = new Map(chs.filter((c) => was.has(c.k)).map((c) => [c.k, mid(c.e) - was.get(c.k).x]));
  // a new or gone one rides halfway between the kept ones either side; a comma never travels (keyed by the digits
  // before it): the old one fades where it was, the new one grows where it lands, as Phantom does (owner 2026-11-11)
  const ride = (ks, i) => {
    let a, b;
    for (let j = i - 1; j >= 0 && a === undefined; j--) a = dx.get(ks[j]);
    for (let j = i + 1; j < ks.length && b === undefined; j++) b = dx.get(ks[j]);
    return a !== undefined && b !== undefined ? (a + b) / 2 : a ?? b ?? 0;
  };
  const ks = chs.map((c) => c.k);
  // the old comma and the new one cross-fade on one even curve and one clock, so together they only ever brighten:
  // a gap, or one side running faster when a key lands mid-fade, flickers (owner 2026-11-11)
  const comma = { duration: T.ms * .7, easing: 'ease-in-out' };
  chs.forEach((c, i) => {
    const o = was.get(c.k), l = c.e.firstChild;
    if (!o) {
      if (c.k[0] !== 'c') return slide(c.e, -ride(ks, i), 0), grow(l, T.scale, 1), fade(l, 0, 1);
      return grow(l, T.scale, 1, comma), fade(l, 0, 1, comma);
    }
    if (Math.abs(dx.get(c.k)) > .5) slide(c.e, -dx.get(c.k), 0);
    const w = c.k[0] === 'c' ? comma : {};
    if (o.sc < .99) grow(l, o.sc, 1, w);   // still growing when the key came: it carries on from there
    if (o.op < .99) fade(l, o.op, 1, w);
  });
  const box = h.getBoundingClientRect(), ghost = (c, by) => {   // shrinks away where it was, gone in fadeOut
    const g = c.e.cloneNode(true);
    g.className = 'ch ht-gone';
    g.setAttribute('aria-hidden', 'true');
    h.append(g);
    g.style.left = `${c.x - box.left - g.offsetWidth / 2}px`;
    slide(g, 0, by, { fill: 'forwards' });
    const o = c.k[0] === 'c' ? comma : {};
    grow(g.firstChild, c.sc, T.scale, { fill: 'forwards', ...o });
    fade(g.firstChild, c.op, 0, { fill: 'forwards', ...o }).onfinish = () => g.remove();
  };
  const keep = new Set(ks), oks = snap.chars.map((c) => c.k);
  snap.chars.forEach((c, i) => { if (!keep.has(c.k)) ghost(c, c.k[0] === 'c' ? 0 : ride(oks, i)); });
  snap.gone.forEach((c) => ghost(c, 0));   // one still going when the sheet redrew
}
// The store's own payment names that are on: Settings › Payment types switches one off by putting its name in hidden, as a built-in's kind
const payCustomOn = () => { const p = state.settings.payments || {}, off = new Set(p.hidden || []); return (p.custom || []).filter(n => !off.has(n)); };
// A payment type's tile (owner 2026-11-08, iOS Shortcuts' icon sheet): a colour + a symbol, kept by name in settings.payments.opts[k]
// so they sync with the type and the back office can draw its own shade (--pt-<colour> here). Built-ins start on PAY_LOOK.
const PAY_COLORS = ['red', 'coral', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'lavender', 'pink', 'grey', 'sage', 'brown'];
const PAY_LOOK = { cash: ['green', 'cash'], gcash: ['blue', 'phone'], qr: ['teal', 'qr'], other: ['grey', 'dots'], credit: ['orange', 'person'], split: ['purple', 'split'] };
// [word, glyph, optical size] on a 24 grid, white on the colour - the size evens out how big each one looks; split is Split's own, not in the picker (PAY_PICKS)
const PAY_SYMBOLS = {
  cash: ['Cash', '<path fill-rule="evenodd" d="M3 6.5h18A1.5 1.5 0 0 1 22.5 8v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 16V8A1.5 1.5 0 0 1 3 6.5zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z"/>', .94],
  coins: ['Coins', '<rect x="4" y="15" width="16" height="4.5" rx="2.25"/><rect x="4" y="9.75" width="16" height="4.5" rx="2.25"/><rect x="4" y="4.5" width="16" height="4.5" rx="2.25"/>', 1.06],
  card: ['Card', '<path fill-rule="evenodd" d="M4 4.5h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM2 8.5V11h20V8.5zM5 14.5V16h5v-1.5z"/>', .94],
  phone: ['Phone', '<path fill-rule="evenodd" d="M8 1.5h8A2.5 2.5 0 0 1 18.5 4v16a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 20V4A2.5 2.5 0 0 1 8 1.5zM10 3.5v1h4v-1z"/>', .94],
  qr: ['QR code', '<path fill-rule="evenodd" d="M5.2 3h3.6a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-3.6a2.2 2.2 0 0 1-2.2-2.2v-3.6a2.2 2.2 0 0 1 2.2-2.2zM5.8 5h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1-0.8 0.8h-2.4a0.8 0.8 0 0 1-0.8-0.8v-2.4a0.8 0.8 0 0 1 0.8-0.8zM15.2 3h3.6a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-3.6a2.2 2.2 0 0 1-2.2-2.2v-3.6a2.2 2.2 0 0 1 2.2-2.2zM15.8 5h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1-0.8 0.8h-2.4a0.8 0.8 0 0 1-0.8-0.8v-2.4a0.8 0.8 0 0 1 0.8-0.8zM5.2 13h3.6a2.2 2.2 0 0 1 2.2 2.2v3.6a2.2 2.2 0 0 1-2.2 2.2h-3.6a2.2 2.2 0 0 1-2.2-2.2v-3.6a2.2 2.2 0 0 1 2.2-2.2zM5.8 15h2.4a0.8 0.8 0 0 1 0.8 0.8v2.4a0.8 0.8 0 0 1-0.8 0.8h-2.4a0.8 0.8 0 0 1-0.8-0.8v-2.4a0.8 0.8 0 0 1 0.8-0.8z"/><path d="M6.5 6h1a0.5 0.5 0 0 1 0.5 0.5v1a0.5 0.5 0 0 1-0.5 0.5h-1a0.5 0.5 0 0 1-0.5-0.5v-1a0.5 0.5 0 0 1 0.5-0.5zM16.5 6h1a0.5 0.5 0 0 1 0.5 0.5v1a0.5 0.5 0 0 1-0.5 0.5h-1a0.5 0.5 0 0 1-0.5-0.5v-1a0.5 0.5 0 0 1 0.5-0.5zM6.5 16h1a0.5 0.5 0 0 1 0.5 0.5v1a0.5 0.5 0 0 1-0.5 0.5h-1a0.5 0.5 0 0 1-0.5-0.5v-1a0.5 0.5 0 0 1 0.5-0.5zM13.7 13h2.1a0.7 0.7 0 0 1 0.7 0.7v2.1a0.7 0.7 0 0 1-0.7 0.7h-2.1a0.7 0.7 0 0 1-0.7-0.7v-2.1a0.7 0.7 0 0 1 0.7-0.7zM18.2 17.5h2.1a0.7 0.7 0 0 1 0.7 0.7v2.1a0.7 0.7 0 0 1-0.7 0.7h-2.1a0.7 0.7 0 0 1-0.7-0.7v-2.1a0.7 0.7 0 0 1 0.7-0.7zM19.2 13h1.1a0.7 0.7 0 0 1 0.7 0.7v1.1a0.7 0.7 0 0 1-0.7 0.7h-1.1a0.7 0.7 0 0 1-0.7-0.7v-1.1a0.7 0.7 0 0 1 0.7-0.7zM13.7 18.5h1.1a0.7 0.7 0 0 1 0.7 0.7v1.1a0.7 0.7 0 0 1-0.7 0.7h-1.1a0.7 0.7 0 0 1-0.7-0.7v-1.1a0.7 0.7 0 0 1 0.7-0.7z"/>', 1],
  wallet: ['Wallet', '<path d="M5.5 3.5H17a1 1 0 0 1 1 1V6H5.5a1.25 1.25 0 0 1 0-2.5z"/><path fill-rule="evenodd" d="M3 6.5v11A2.5 2.5 0 0 0 5.5 20h13a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 18.5 7h-13A2.5 2.5 0 0 1 3 6.5zM16.5 11.75a1.75 1.75 0 1 0 0 3.5a1.75 1.75 0 1 0 0-3.5z"/>', .95],
  bank: ['Bank', '<path d="M12 2.5l9.5 5v2h-19v-2zM4.5 11H7v7H4.5zM10.75 11h2.5v7h-2.5zM17 11h2.5v7H17zM2.5 19.5h19v2h-19z"/>', .94],
  transfer: ['Transfer', '<path d="M3 6.5h12v-3l6 4.5-6 4.5v-3H3zM21 14.5H9v-3l-6 4.5 6 4.5v-3h12z"/>', 1.06],
  cheque: ['Cheque', '<path fill-rule="evenodd" d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM7.5 12v1.5h9V12zM7.5 16v1.5h6V16z"/>', .93],
  gift: ['Gift', '<path d="M3 8h8v4H3zM13 8h8v4h-8zM4.5 13.5H11V21H6a1.5 1.5 0 0 1-1.5-1.5zM13 13.5h6.5v6A1.5 1.5 0 0 1 18 21h-5zM12 7.5C10.5 4 6.5 3.5 6.5 5.75 6.5 7 8.5 7.5 12 7.5zm0 0c1.5-3.5 5.5-4 5.5-1.75 0 1.25-2 1.75-5.5 1.75z"/>', 1],
  person: ['Account', '<circle cx="12" cy="7.5" r="4"/><path d="M4 20.5c0-4.1 3.6-7 8-7s8 2.9 8 7z"/>', 1.08],
  dots: ['Other', '<circle cx="5.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18.5" cy="12" r="2"/>', 1.15],
  split: ['Split', '<path d="M11 3a9 9 0 0 0 0 18zM13 3a9 9 0 0 1 0 18z"/>', .9],
};
const PAY_PICKS = Object.keys(PAY_SYMBOLS).filter(s => s !== 'split');
// your own type with nothing picked yet: grey + Card (savePayTypeAdd gives a new one the next free colour)
const payLook = (k) => { const o = state.settings.payments?.opts?.[k] || {}, [color, icon] = PAY_LOOK[k] || ['grey', 'card'];
  return { color: PAY_COLORS.includes(o.color) ? o.color : color, icon: PAY_SYMBOLS[o.icon] ? o.icon : icon }; };
const paySym = (s) => `<svg viewBox="0 0 24 24" style="--g: ${PAY_SYMBOLS[s][2]}" aria-hidden="true">${PAY_SYMBOLS[s][1]}</svg>`;
const payTile = (k) => { const { color, icon } = payLook(k); return `<span class="pt-tile" style="--pt: var(--pt-${color})">${paySym(icon)}</span>`; };
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

// Every empty page and search (owner's C1 from empty-lab, 2026-11-06): the silhouette -- the page's thing drawn in white
// in a blurred blue haze, one size everywhere -- and one plain line under it. An action rides in the line as a blue word
// (emptyAct); where the page has its own +, the line says "Tap +" instead. emptyAct's tap is a selector the word clicks
// (app.js), so it is always a button already on the page. `more`: buttons under the line (Sell search). `pic`: a
// picture name; each is baked by scripts/bake-empty-pics.mjs (its drawings live there) into img/empty/<pic>.png, the haze, and
// <pic>-obj.png, the soft white shape: two masks, no live filter, so swipes stay smooth on the iPhone (owner 2026-11-06).
// They are fetched once at start and kept in memory (blob: URLs): a page shows its picture the moment it opens, never
// after a trip to the server, which may say no-store (owner 2026-11-06: "it takes a while for it to load").
const EMPTY_PICS = {};
for (const f of ['grain', ...'search box folder folders tags receipt people cash clock sliders addon'.split(' ').flatMap(p => [p, p + '-obj'])])
  fetch(`img/empty/${f}.png`).then(r => r.blob()).then(b => { EMPTY_PICS[f] = URL.createObjectURL(b); }).catch(() => {});
const emptyPic = f => `url(${EMPTY_PICS[f] || `img/empty/${f}.png`})`;
function emptyState(pic, line, more = '') {
  return `<div class="empty"><div class="sil" style="--pic: ${emptyPic(pic)}; --obj: ${emptyPic(pic + '-obj')}; --grain: ${emptyPic('grain')}" aria-hidden="true"></div>`
    + `<span class="e-line">${line}</span>${more}</div>`;
}
const emptyAct = (text, tap) => `<button type="button" class="e-act" data-tap='${tap}'>${text}</button>`;
const noResults = q => emptyState('search', `No results for “${escapeHtml(q)}”`);

// Every toast is the "Added" chip (owner's pick from toast-lab.html, 2026-10-19; all toasts 2026-10-19): a small white
// pill that rises in like a notification. `done`: the filled tick, for something that worked (showDone); without it, a
// notice. `undo`: an Undo button, which then stays up longer; it runs once. `note`: a quiet tail that never gets cut ("16 left").
// Up for 1.2s + 40ms a letter, so a long warning stays long enough to read.
function showToast(msg, undo, done, note) {
  const el = $('#toast');
  el.className = 'toast' + (done ? ' done' : '');
  el.innerHTML = (done ? '<span class="mk"><svg viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' : '')
    + `<em>${escapeHtml(msg)}</em>` + (note ? `<i>${escapeHtml(note)}</i>` : '');
  if (undo) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-undo'; b.textContent = 'Undo';
    b.onclick = () => { b.onclick = null; hideToast(); undo(); };
    el.append(b);
  }
  el.hidden = false;
  el.classList.add('show');
  // the rise, played from script: iPhone Safari kept the CSS one that was already done and skipped it when a toast
  // replaced one still up (owner 2026-10-19); el.animate starts over every time
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
    el.animate([{ transform: 'translateY(8px) scale(.94)', opacity: 0 }, { opacity: 1, offset: .3 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.3, 1.35, .45, 1)' });
  clearTimeout(showToast._t);
  showToast._t = setTimeout(hideToast, undo ? 5000 : 1200 + (msg.length + (note || '').length) * 40);
}
const showDone = (msg, undo, note) => showToast(msg, undo, true, note);
function hideToast() {
  const el = $('#toast');
  clearTimeout(showToast._t);
  el.classList.remove('show');
  setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 220);
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
  let measuredHeight = Math.floor(
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
  // iPhone Home Screen app drawn under the clock (black-translucent): iOS reports the height minus the status bar, so the
  // app stopped a band short of the bottom (addon/push-menu, 2026-10-07). There the app is always the whole screen; iOS keeps
  // screen.width/height in portrait terms, so take the side that matches the window
  const fullScreen = navigator.standalone ? (measuredWidth < measuredHeight ? screen.height : screen.width) : 0;
  if (fullScreen > measuredHeight && !document.activeElement?.matches?.('input, textarea, select')) measuredHeight = fullScreen;

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
// line, Cancel and OK, in the middle of the screen (centreSheet). `danger`: OK in the tinted red, for a delete only;
// everything else is the till's normal primary.
// `html`: markup for the message (the refund line picker, which reads #confirmMessage), built with escapeHtml.
// Enter = OK, Esc / a tap outside / Cancel = cancel, Tab stays inside. `onCancel` runs on every close that isn't OK
// (stockOnAdd puts the edit sheet's quantity back), but not when a new ask replaces this one.
// Every pop-up card sits in the middle of the screen, never at the button that opened it (owner 2026-10-10): f, already
// in its veil, is centred and fades up. Returns shrink(done), which fades it out. Menus (openMenu) still drop from their button.
function centreSheet(f) {
  f.style.left = Math.max(12, (innerWidth - f.offsetWidth) / 2) + 'px';
  f.style.top = Math.max(8, (innerHeight - f.offsetHeight) / 2) + 'px';
  popFace(f);
  f.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: calmMs(220), easing: 'cubic-bezier(.2, .8, .2, 1)' });   // --rl-ease
  return (done) => { f.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], { duration: calmMs(90) }).onfinish = done; };
}
// A pop-up card's face (owner 2026-10-27, popups-picks.html row D): Apple's continuous corner, not CSS's quarter circle.
// Safari has no corner-shape, so the shape is drawn as the card's background (--face-img, styles.css) and repainted when
// it resizes. figma-squircle's path, smoothing .6 (≈ iOS); r is clamped to half the short side.
function squircle(x, y, w, h, r, s = .6) {
  const max = Math.min(w, h) / 2; r = Math.min(r, max); s = Math.min(s, max / r - 1);
  const p = (1 + s) * r, rad = a => a * Math.PI / 180, arcM = 90 * (1 - s), arc = Math.sin(rad(arcM / 2)) * r * Math.SQRT2;
  const p34 = r * Math.tan(rad((90 - arcM) / 4)), c = p34 * Math.cos(rad(45 * s)), d = c * Math.tan(rad(45 * s));
  const b = (p - arc - c - d) / 3, a = 2 * b, A = a + b + c;
  return `M${x + w - p} ${y}c${a} 0 ${a + b} 0 ${A} ${d}a${r} ${r} 0 0 1 ${arc} ${arc}c${d} ${c} ${d} ${b + c} ${d} ${A}`
    + `L${x + w} ${y + h - p}c0 ${a} 0 ${a + b} ${-d} ${A}a${r} ${r} 0 0 1 ${-arc} ${arc}c${-c} ${d} ${-(b + c)} ${d} ${-A} ${d}`
    + `L${x + p} ${y + h}c${-a} 0 ${-(a + b)} 0 ${-A} ${-d}a${r} ${r} 0 0 1 ${-arc} ${-arc}c${-d} ${-c} ${-d} ${-(b + c)} ${-d} ${-A}`
    + `L${x} ${y + p}c0 ${-a} 0 ${-(a + b)} ${d} ${-A}a${r} ${r} 0 0 1 ${arc} ${-arc}c${c} ${-d} ${b + c} ${-d} ${A} ${-d}Z`;
}
const popFaces = new ResizeObserver(es => es.forEach(e => paintFace(e.target)));
function paintFace(f) {
  if (!f.isConnected) return popFaces.unobserve(f);
  const w = f.offsetWidth, h = f.offsetHeight, cs = getComputedStyle(f);
  if (!w || !h) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${squircle(.5, .5, w - 1, h - 1, parseFloat(cs.borderTopLeftRadius))}" style="fill:${cs.getPropertyValue('--face').trim()};stroke:${cs.getPropertyValue('--line').trim()}"/></svg>`;
  f.style.setProperty('--face-img', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
}
function popFace(f) { paintFace(f); popFaces.observe(f); }
$$('.modal, #pinModal .pin-pad').forEach(popFace);   // the static cards: painted when they first show (0 → their size)
new MutationObserver(() => $$('.modal, .pin-pad, .pay-sheet').forEach(paintFace)).observe(document.body, { attributeFilter: ['class'] });   // a theme change repaints the faces
// Leaving a form with changes not saved asks first, in quick stock's words (owner 2026-10-22); no changes leaves at once.
function askLeave(changed, leave) {
  if (!changed) return leave();
  showConfirm({ title: 'Leave without saving?', message: 'Your changes aren’t saved yet.', okText: 'Leave', cancelText: 'Keep editing', onConfirm: leave });
}
// a sheet's way out: asks only when a field differs from when the form opened
function leaveForm(f, close) { const snap = () => JSON.stringify([...new FormData(f)]), was = snap(); return () => askLeave(snap() !== was, close); }
let confirmSheet = null;
function showConfirm({ title = 'Are you sure?', message = '', html = '', okText = 'Confirm', cancelText = 'Cancel', danger = false, onConfirm, onCancel } = {}) {
  confirmSheet?.(true);   // one at a time
  $$('.cf-sheet [id]').forEach(el => el.removeAttribute('id'));   // one still shrinking away: #confirmMessage is the new one's
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<form class="pay-sheet cf-sheet" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMessage" novalidate>
    <div class="ph"><b id="confirmTitle"></b><div class="cf-msg" id="confirmMessage"></div></div>
    <div class="pb"><button type="button" class="secondary-btn small cta-2" data-cancel></button><button type="submit" class="primary-btn small${danger ? ' danger' : ' cta'}"></button></div>
  </form>`;
  const f = veil.firstChild, msg = f.querySelector('#confirmMessage'), ok = f.querySelector('[type="submit"]');
  f.querySelector('#confirmTitle').textContent = title;
  if (html) msg.innerHTML = html; else msg.textContent = message;
  msg.hidden = !html && !message;
  ok.textContent = okText;
  f.querySelector('[data-cancel]').textContent = cancelText;
  f.style.width = Math.min(340, innerWidth - 24) + 'px';
  document.body.append(veil);
  const shrink = centreSheet(f);
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
  // A double tap's second tap lands on the new card (an ask opened from the last one's OK, or over its trigger): ignored
  const born = performance.now(), early = () => performance.now() - born < 350;
  ok.addEventListener('click', (e) => { if (early()) e.preventDefault(); });
  veil.addEventListener('click', (e) => { if (!early() && (e.target === veil || e.target.closest('[data-cancel]'))) close(); });
  (msg.querySelector('input') || ok).focus({ preventScroll: true });
}

// ---------- Persistence ----------
function loadFolders() {
  return readJsonStorage(STORAGE_FOLDERS, null) || SEED_FOLDERS.map(f => ({ ...f }));
}
// On hand = the movement log's sum (bo-model withStock).
function loadProducts() {
  const saved = readJsonStorage(STORAGE_PRODUCTS, null);
  // ponytail: lab only -- the seed's no-price item on a POS whose catalog was saved before it (2026-10-13); drop with the seed
  if (saved && !saved.some(p => p.id === 'p900')) saved.unshift({ ...PRODUCTS[0] });
  return withStock(seedLooks(saved, PRODUCTS, STORAGE_PRODUCTS) || PRODUCTS.map(p => ({ ...p })));
}
// ponytail: lab only -- the seed's photos and tile colours onto a catalog saved before them (2026-10-14). Once a device,
// so a photo cleared afterwards stays cleared; drop with the seed.
function seedLooks(saved, seed, key) {
  if (!saved || HWPOS_STORE.ui.get('seedLooks.' + key)) return saved;
  const bySeed = new Map(seed.map(s => [s.id, s]));
  saved.forEach(r => {
    const s = bySeed.get(r.id);
    if (s?.imageUrl && !r.imageUrl) r.imageUrl = s.imageUrl;
    if (s?.color && !r.color) r.color = s.color;
  });
  writeJsonStorage(key, saved);
  HWPOS_STORE.ui.set('seedLooks.' + key, 1);
  return saved;
}
// The one catalog write both apps share (bo-model saveCatalog), so price history logs the same way.
// Every catalog write recounts the made items first (bo-model withMade): a sale, a quick stock or a new cost moves a burger with its patties.
function saveProducts() {
  withMade(state.products);
  rebuildFuse();   // Sell's search reads its own index: a saved name or SKU has to be findable at once
  return saveCatalog(state.products, { source: 'pos', staff: currentStoreInfo().cashier });
}
function loadGroups() {
  return seedLooks(readJsonStorage(STORAGE_GROUPS, null), SEED_GROUPS, STORAGE_GROUPS)
    || ((typeof SEED_GROUPS !== 'undefined') ? SEED_GROUPS.map(g => ({ ...g })) : []);
}
function saveGroups() {
  return writeJsonStorage(STORAGE_GROUPS, state.groups);
}
function groupById(id) { return state.groups.find(g => g.id === id) || null; }
// An item's photo and tile colour: its own, else its variant group's (bo-model imageFor). A group row passes itself.
function itemLook(row) {
  const g = row.groupId ? groupById(row.groupId) : null;
  return { img: imageFor(row, state.groups), hue: TILE_COLORS[row.color || (g && g.color)] };
}
// On the till = a tile and a search hit. Archived is gone; hidden is kept in the back office but
// off the till (owner, 2026-10-01) -- a scan still finds both and asks (addProductByCode).
const onTill = p => !p.archived && !p.hidden && !p.component;
// Settings › Business type (owner 2026-10-20): a food store's part is an Ingredient, any other store's a Component. One
// flag in the data (product.component); only this word reads the type. Onboarding will ask the same question.
const partWord = () => (state.settings.store?.businessType === 'food' ? 'Ingredient' : 'Component');
const offWhy = p => (p.archived ? 'archived' : p.component ? (partWord() === 'Ingredient' ? 'an ingredient' : 'a component') : 'hidden');   // "… is hidden. Sell anyway?"
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

// A blank Price (Items) means the price is asked at sale (owner 2026-10-09): null, never 0 -- a ₱0 typed on
// purpose is a real ₱0. The sale's line carries the typed price (addToCart).
const askedPrice = (p) => p.price == null || p.price === '';

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
    ...(item.custom ? { custom: true } : {}),   // a custom item: a typed name and price, no item behind it (addCustomLine)
    ...(item.noVat ? { noVat: true } : {}),   // sold without VAT (the Custom item sheet's switch); SalesMath leaves it out of the tax
    ...(item.note ? { note: String(item.note) } : {}),   // the line's note (the cart line's Note), on the slip under it
    // the line's modifier answers, a snapshot taken at the sale (plans/modifiers-build.md): kept as sold, so Reports'
    // Modifiers part, the receipt and a refund read the words and prices it was rung with
    ...(Array.isArray(item.modifiers) && item.modifiers.length ? { modifiers: item.modifiers.filter(a => a && typeof a === 'object').map(a => ({ ...a })) } : {}),
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
    ...(payment.ref && payment.refLabel ? { refLabel: String(payment.refLabel) } : {}),   // the word it was asked as (receipt: LAST 4 DIGITS)
    ...(typeof payment.drawer === 'boolean' ? { drawer: payment.drawer } : {}),   // Opens cash drawer at the sale (drawerOf)
  };
}

const KNOWN_METHOD_LABELS = { cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', split: 'Split payment', unpaid: 'Not completed' };

// `split` { legs: [{ key, amount, given?, change?, ref? }] }: one row per part (owner 2026-10-10), each built as a
// one-method sale (GCash stays 'other' + 'GCash'); a cash part carries what was handed over, the others their ref no.
// No `split` = the old call: cash now (tendered), the rest on account -- old rows rebuild exactly as they were.
// The ref's word (Settings › Payment types › Ask for), printed over it; a typed Other name counts as Other (typeKey).
const refWord = (m, ref) => (ref ? { ref: String(ref), refLabel: opt(typeKey(m)).ask } : {});
// Opens cash drawer as it was at the sale (owner 2026-10-23): its refund or void opens the drawer the same way, renamed or deleted since
const drawerOf = (m) => ({ drawer: !!opt(typeKey(m)).drawer });
function buildOrderPayments({ status, paymentMethod, total, tendered = 0, change = 0, split = null, ref = '' }) {
  if (status === 'saved' || paymentMethod === 'unpaid') {
    return [{ method: 'unpaid', label: 'Not completed', amount: 0, tendered: 0, change: 0, ref: '' }];
  }
  if (paymentMethod === 'credit') {
    return [{ method: 'credit', label: 'Account', amount: moneyValue(total), tendered: 0, change: 0, ref: '', ...refWord('credit', ref), ...drawerOf('credit') }];
  }
  if (paymentMethod === 'split') {
    const leg = (m, amount, x) => buildOrderPayments({ status, paymentMethod: m, total: amount, tendered: amount, ...x })[0];
    if (split?.legs) return split.legs.map(l => ({ ...leg(l.key, l.amount, { tendered: l.given ?? l.amount, change: l.change || 0 }), ref: l.ref || '', ...refWord(l.key, l.ref) }));
    const fa = Math.min(moneyValue(tendered), moneyValue(total));
    return [leg('cash', fa, { tendered, change }), leg('credit', moneyValue(total - fa))].filter((p, i) => !i || p.amount > 0);
  }
  // Only cash lands in the drawer. GCash, QR and custom names ("Maya") arrive here as their own
  // method string and used to fall through to a cash row -- so every one of them printed CASH on
  // the receipt and `buildCashDrawerSummary` expected money that never went in the till.
  if (paymentMethod && paymentMethod !== 'cash') {
    return [{ method: 'other', label: KNOWN_METHOD_LABELS[paymentMethod] || String(paymentMethod),
              amount: moneyValue(total), tendered: moneyValue(tendered), change: moneyValue(change), ref: String(ref), ...refWord(paymentMethod, ref), ...drawerOf(paymentMethod) }];   // ref: the customer's, when its type asks
  }
  return [{ method: 'cash', label: 'Cash', amount: moneyValue(total), tendered: moneyValue(tendered), change: moneyValue(change), ref: '', ...refWord('cash', ref), ...drawerOf('cash') }];
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
  // a ₱0 refund / void moved no money: no legs (rebuilt, a split one became a "Cash ₱0" leg)
  const payments = o.payments.length || (!total && (status === 'refund' || status === 'void'))
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
    discountApprovedBy: String(raw.discountApprovedBy || ''),   // the one who let a big discount through (discountOk)
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
    ...(raw.note ? { note: String(raw.note) } : {}),   // the order's note (cart ⋯ Add note)
    meta: {
      source: raw.meta?.source || 'pos-app',
      replaceableFormat: true,
    },
  };
}

// Settings › Receipt (owner 2026-11-06): the style (Classic = the lab's T1, Modern = G2.2), the logo, the lines under the store's name and under the items, a footer picture
// (a QR code, say), and whether the name, address and phone print. Defaults: Classic, 'Thank you!', name, address, phone and TIN on.
// says: the last line (SalesMath SAYS): 'not' an invoice (the default, not BIR registered yet), 'invoice', or 'none'.
// logoFit / footerImgFit: a picture's box on the receipt (pos-settings.js openPics): { src: the original, w, h: shares of the
// paper's width, zoom, cx, cy }; logo / footerImg is that box, baked at 80mm's dots in black and white.
// ponytail: pictures ride in settings as data URLs, like Payment types' QR pictures; R2 with Supabase.
// ponytail: a reprint shows today's look, not the one it was printed with (as Store details); keep a copy per sale if BIR asks.
const receiptLook = () => ({ style: 't1', says: 'not', logo: '', logoFit: null, header: '', footer: 'Thank you!\nKeep for returns and exchanges.', footerImg: '', footerImgFit: null, showName: true, showAddress: true, showPhone: true, showTin: true, ...state.settings.receipt });
const lookLines = (t) => String(t || '').split('\n').map(l => l.trim()).filter(Boolean);
function toReceiptViewModel(order) {
  const o = normalizeOrderRecord(order);
  const fulfilmentLabel = orderFulfilLabel(o).toUpperCase()
    + (o.fulfilment === 'delivery' && o.deliveryAddress ? ' · ' + o.deliveryAddress : '');
  // The slip's words come from the row's state, one place for the screen, the pop-up and the printer:
  // mark, Paid / Given back, Cashier / Voided by / Refunded by, the tenders by name, the footer, SC/PWD.
  const orders = Array.isArray(state.orders) ? state.orders : [];
  // A saved cart or quote (draftAsOrder) has no receipt number; a quote's slip is headed QUOTATION.
  const parts = SalesMath.receiptParts({ ...o, draft: order.draft }, orders.find(x => x.id === o.originalOrderId) || null, orderReversals(), receiptLook().says);
  const look = receiptLook();
  // the plain 'Thank you!' greets a named customer by first name, as the lab's receipts (owner 2026-11-06)
  const footer = lookLines(look.footer), first = String(o.customer?.name || '').trim().split(/\s+/)[0];
  if (footer[0] === 'Thank you!' && first) footer[0] = `Thank you, ${first}!`;
  return {
    store: { ...currentStoreInfo(), ...(look.showAddress ? {} : { address: '' }), ...(look.showPhone ? {} : { phone: '' }), ...(look.showTin ? {} : { tin: '' }) },
    look: {
      style: look.style === 'g2' ? 'g2' : 't1', logo: look.logo, footerImg: look.footerImg, header: lookLines(look.header), footer,
      showName: look.showName, numWord: look.says === 'invoice' ? 'Invoice' : 'Receipt',   // Receipt # or Invoice #
      logoW: look.logo && look.logoFit?.w, footW: look.footerImg && look.footerImgFit?.w,   // a fitted picture's width; none = the old box
    },
    number: order.draft ? '' : o.number,
    ts: o.ts,
    dateText: tillDate(o.ts, 'slip'),
    cashier: o.cashier,
    register: o.register,
    customer: o.customer,
    deliveryAddress: o.deliveryAddress,
    deliveryLocation: o.deliveryLocation,
    note: o.note || '',
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
      [p.name, p.sku, ...barcodesOf(p), p.brand, ...(p.aliases || [])].join(' ').toLowerCase()),
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
  cashier: new Set(['sell', 'orders', 'tables', 'chat', 'qr', 'items', 'settings', 'checkout']),
  manager: new Set(['sell', 'orders', 'tables', 'chat', 'qr', 'items', 'customers', 'back-office', 'settings', 'checkout']),
};
ROLE_ALLOWED.owner = ROLE_ALLOWED.manager;   // the till's pages; the back office has its own page access
ROLE_ALLOWED.stock = ROLE_ALLOWED.cashier;
const VIEW_SWITCH = { reports: 'dayTotals', shift: 'shift', cash: 'shift' };   // pages a Staff & access switch opens
function canAccess(view) {
  if (view === 'tables' && state.settings.store?.businessType !== 'food') return false;   // the one page only food stores get (owner 2026-11-09)
  if (VIEW_SWITCH[view]) return roleCan(state.role, VIEW_SWITCH[view]);
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
  const store = currentStoreInfo();
  sub.textContent = STAFF_ROLES[state.role] || 'Staff';
  $('.user-store').textContent = `· POS ${store.registerNo || '1'}`;
  if (state.user) userMeta.querySelector('.user-name').textContent = state.user.name;
  $('.user-avatar').textContent = (state.user?.name || 'E')[0];
  $('.side-ttl').textContent = store.name;
}

// ---------- View switching ----------
function switchView(view) {
  if (!canAccess(view)) {
    showToast('You do not have permission for that page');
    return;
  }
  // An exchange holds Sell and the checkout until it is rung or ✕'d (startExchange / leaveExchange).
  if (state.exchange && view !== 'sell' && view !== 'checkout') { showToast('Finish or cancel the exchange first'); return; }
  closeShiftSheet();   // leaving mid-count throws the count away
  const fromCheckout = state.view === 'checkout';
  if (view !== 'orders' && state.ordersCustomer) ordersFor('');
  if (state.view === 'reports' && view !== 'reports') $('.view-reports .c-scroll').scrollTop = 0;   // while still shown: Safari puts a hidden scroller's place back on show, over the reset below (owner 2026-10-19)
  if (state.view === 'checkout' && view !== 'checkout') $$('.view-checkout :is(.co-stage, .co-step)').forEach(e => { e.scrollTop = 0; });   // the same rule for the checkout's scrollers: the step under the total, the stage on Sale complete (owner 2026-10-29)
  state.view = view;
  if (view !== 'items') addPickOff();   // Add tile's list ends with the page
  if (!$(`.view[data-view="${view}"]`)?.contains($('#scanSheet'))) closeBarcodeScanner();   // it scans for the page it sits on (Sell's, or Adjust stock's on Items); the tablet's ☰ and Check out stay in reach
  $$('.side-link').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'checkout') railCheckout(true);
  else if (fromCheckout) railCheckout(false, view === 'sell');
  if (view === 'back-office') { window.open('backoffice.html', '_blank', 'noopener'); return; }
  if (view === 'settings') { showStPage('settingsPage'); openSec(''); renderPosSettings(); return; }
  if (view === 'orders') {
    // Always pull the latest from localStorage so a sale made in another tab
    // (or any state drift) shows up immediately.
    state.orders = loadOrders();
    renderOrders();
  }
  if (view === 'sell') renderProducts();   // stock may have moved elsewhere (void, refund) — tile marks read it
  if (view === 'items') renderItems();
  if (view === 'qr') renderQr();
  if (view === 'customers') renderCustomers();
  if (view === 'shift') shiftPast(false);   // opens on the drawer, not Past shifts
  if (view === 'cash') renderShift();
  if (view === 'tables') renderTables();
  if (view === 'reports') { $('.view-reports .c-scroll').scrollTop = reportsView.y = 0; renderReports(); }   // opens at the top; Day | Week | Month keeps the place (reportsGo)
  // every visit opens at the top: the stage kept the last visit's place (owner 2026-10-29). The rAF is for Safari,
  // which can put a hidden scroller's place back on its own layout pass after this line has already run.
  if (view === 'checkout') {
    renderCheckout();
    const top = () => $$('.view-checkout :is(.co-stage, .co-step)').forEach(e => { e.scrollTop = 0; });
    top();
    requestAnimationFrame(top);
  }
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

