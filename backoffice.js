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
// Who an event row names. ponytail: the store's cashier setting until the back office has a login.
function actor() { return state.settings?.store?.cashier || ''; }
const STORAGE_TILE_SIZE  = 'hwpos.tileSize';
// How tall a list row is. A display preference belonging to the person reading the
// screen, not to the store — it stays on this device and never syncs.
const STORAGE_DENSITY = 'hwpos.bo.density';
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
    width: '58mm',
    printOnSale: true,
    logoOnReceipt: false,
  },
};

const state = {
  view: 'dashboard',
  range: 'today',
  // ponytail: one anchor for the whole back office — every range ends on this day, so the
  // date picker and the range dropdown are the same control expressed twice.
  anchor: dayStart(new Date()),
  folders: [],
  products: [],
  orders: [],
  customers: [],
  settings: { ...DEFAULT_SETTINGS },
  detailId: '',
  invQuery: '',
  custQuery: '',
  txQuery: '',
};

// ---------- Helpers ----------
// The minus goes in front of the sign, not between it and the digits: money out of the till
// reads "−₱972.32", never "₱-972.32". Returns and down deltas are the only negatives here.
const signed = (s, n) => (n < 0 ? '−₱' : '₱') + s;
const peso = (n) => signed(Math.abs(Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), n);
const pesoShort = (n) => signed(Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-PH'), n);
// ₱ is a double-barred P. Set at the digits' own size and weight it out-weighs them —
// on a small value like "₱0" the symbol is physically wider than the number it labels,
// so the eye lands on the currency instead of the amount. Demote it: the amount reads
// first and the unit stays legible. Swapping typeface does not help; every face we
// tried (Inter, Plex, Source Sans, Figtree, Segoe, Arial) draws the same crammed glyph.
// ponytail: big values only (.kpi-value). At 13px the symbol already behaves, and
// wrapping the ~150 money sites wholesale would print literal tags at the 29 that
// assign via textContent. Widen by moving a site to innerHTML + curHtml, one at a time.
const curHtml = (s) => escapeHtml(String(s)).replace(/^(−?)₱/, '$1<span class="cur">₱</span>');
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

// A redraw where the table slides to its new width while the widgets fade in where they stand (owner
// 2026-09-26: no fly-in, and no gap between the two). The table sits above the rail while it narrows over
// that column, so the fade shows through as the table clears it; both land together.
function slideRender(render) {
  const main = () => [...document.querySelectorAll('.dash')].find(d => d.offsetParent)?.firstElementChild;
  const from = main()?.offsetWidth;
  render();
  const m = main(), to = m?.offsetWidth, rail = m?.nextElementSibling;
  if (!m || !from || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t = { duration: 260, easing: 'cubic-bezier(.2, 0, 0, 1)' };
  m.style.position = 'relative'; m.style.zIndex = 1;
  m.animate([{ width: from + 'px' }, { width: to + 'px' }], t)
    .finished.finally(() => { m.style.position = m.style.zIndex = ''; });
  if (to < from && rail) rail.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, delay: 40, easing: 'ease-out', fill: 'backwards' });
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

// ---------- Paging ----------
// paginate() / pageNumbers() / PAGE_ROWS live in bo-model.js so `node bo-model.js` can
// check them; this is only the markup they get drawn as.
// Nothing to page through, nothing to draw — one page of rows needs no chrome.
function pagerHtml(p) {
  if (p.pages < 2) return '';
  const btn = (label, page, cls, off) =>
    `<button class="bo-page-btn${cls}" data-page="${page}"${off ? ' disabled' : ''}>${label}</button>`;
  const nums = pageNumbers(p.page, p.pages).map((n) =>
    (typeof n === 'number' ? btn(n, n, n === p.page ? ' on' : '', false)
                           : '<span class="bo-page-gap">…</span>')).join('');
  return `<div class="bo-pager">
      <span class="bo-pager-count">${p.from + 1}–${p.from + p.rows.length} of ${p.total}</span>
      ${btn('Previous', p.page - 1, '', p.page <= 1)}${nums}${btn('Next', p.page + 1, '', p.page >= p.pages)}
    </div>`;
}

// ---------- Multi-pick filter ----------
// A checkbox menu per filter (the Products "Columns" pattern): tick several, none ticked = all.
// Sales and Inventory both draw it; `?key=` is a comma list.
function multiPick(key, all, one, many, opts, picked) {
  const names = opts.filter(([val]) => picked.includes(val)).map(([, label]) => label);
  const text = !picked.length ? all : picked.length === 1 ? (names[0] || picked[0]) : `${picked.length} ${many}`;
  return `
        <details class="ms-pick" data-ms="${key}">
          <summary class="bo-select">${escapeHtml(text)}</summary>
          <div class="ms-menu check-menu">
            ${opts.length ? opts.map(([val, label]) => `<label class="bo-check"><input type="checkbox" data-multi="${key}" value="${escapeHtml(val)}"${picked.includes(val) ? ' checked' : ''}> ${escapeHtml(label)}</label>`).join('')
              : `<span class="ms-empty">${escapeHtml(one)}</span>`}
            ${picked.length ? `<button type="button" class="ms-clear" data-act="ms-clear" data-key="${key}">Clear</button>` : ''}
          </div>
        </details>`;
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
// Every price and cost change is logged here, at the one write, by diffing against what was
// stored -- see priceChanges in bo-model.js. `reason` is optional context from the caller.
function saveProducts(reason = '') {
  buildProductIndex();
  const before = readJsonStorage(STORAGE_PRODUCTS, null);
  const ok = storageSet(STORAGE_PRODUCTS, JSON.stringify(state.products));
  if (ok && Array.isArray(before)) {
    appendEvents('priceLog', priceChanges(before, state.products, { source: 'backoffice', reason, staff: actor() }));
  }
  return ok;
}
// Categories are created from two places (the product editor and CSV import) and read from
// four, so the write lives here with the other loaders rather than in a page module.
function saveFolders(list) {
  state.folders = list;
  return storageSet(STORAGE_FOLDERS, JSON.stringify(list));
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

const CSV_EOL = '\r\n';
function csvEscape(value) {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One download path; CSV and JSON differ only by body and mime type.
function downloadBlob(filename, body, type) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const downloadCsv = (filename, rows) =>
  downloadBlob(filename, rows.map(row => row.map(csvEscape).join(',')).join(CSV_EOL), 'text/csv;charset=utf-8');

const downloadJson = (filename, data) =>
  downloadBlob(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');

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

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const PAY_LABELS = { cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', split: 'Split payment', unpaid: 'Not completed', other: 'Other' };

function normalizeOrder(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const total = toNumber(raw.total, items.reduce((sum, i) => sum + toNumber(i.price) * toNumber(i.qty, 1), 0));
  // The POS coerces paymentMethod to cash/credit/split/unpaid for drawer + credit
  // math and keeps the real tendered method in paymentKind/paymentMethodLabel.
  // Carry both through, or GCash/QR/Maya all read as "Cash" in here.
  const kind = String(raw.paymentKind || raw.paymentMethod || 'cash');
  return {
    paymentKind: kind,
    // ponytail: credit always reads "Account" (the POS wrote "Charge to account" before
    // 2026-09-25). Every other kind honours the stored label (custom names like "Maya").
    paymentMethodLabel: kind === 'credit' ? PAY_LABELS.credit : String(raw.paymentMethodLabel || PAY_LABELS[kind] || kind),
    vatAmount: toNumber(raw.vatAmount, 0),
    discount: toNumber(raw.discount, 0),
    // Only the order dialog reads these four; the tables never did, which is why they
    // were dropped here and the receipt had nothing to show.
    subtotal: toNumber(raw.subtotal, items.reduce((sum, i) => sum + toNumber(i.price) * toNumber(i.qty, 1), 0)),
    tendered: toNumber(raw.tendered, 0),
    change: toNumber(raw.change, 0),
    deliveryAddress: String(raw.deliveryAddress || ''),
    id: String(raw.id || raw.number || ''),
    number: String(raw.number || raw.id || ''),
    ts: toNumber(raw.ts, Date.now()),
    status: ['saved', 'completed', 'voided', 'refunded', 'return'].includes(raw.status) ? raw.status : 'completed',
    cashier: String(raw.cashier || 'El John'),
    customer: raw.customer ? { ...raw.customer, name: String(raw.customer.name || '') } : null,
    paymentMethod: raw.paymentMethod || 'cash',
    fulfilment: String(raw.fulfilment || 'pickup').trim() || 'pickup',
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    items: items.map(i => ({
      id: String(i.productId || i.id || ''),
      name: String(i.name || 'Item'),
      sku: String(i.sku || ''),
      unit: String(i.unit || 'pc'),
      // Floor at 0, not 1: a hardware store sells 2.5 m of wire and 0.75 kg of nails,
      // and clamping that up to 1 silently invents stock and revenue.
      qty: Math.max(0, toNumber(i.qty, 1)),
      price: toNumber(i.price, 0),
      cost: i.cost != null ? toNumber(i.cost, 0) : null,
      lineTotal: i.lineTotal != null ? toNumber(i.lineTotal, 0) : null,
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

function dayStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDays(ts, n) {
  const d = new Date(ts);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

function rangeStart(range = state.range) {
  return shiftDays(state.anchor, -((RANGE_DAYS[range] || 1) - 1));
}

// exclusive: the day after the anchor
function rangeEnd() {
  return shiftDays(state.anchor, 1);
}

function orderPaymentLabel(order) {
  return order.paymentMethodLabel || PAY_LABELS[order.paymentKind] || 'Cash';
}


// ---------- Routing ----------
// The nav, the <title>, and what counts as a valid URL hash — one list.
// One list: the label the nav and <title> use, and the function that paints the view.
// Adding a view is an entry here plus the .side-link / .view markup -- never a second list.
const VIEWS = {
  dashboard: { label: 'Dashboard', render: () => renderDashboard() },
  sales:     { label: 'Sales',     render: () => renderSales() },
  transactions: { label: 'Transactions', render: () => renderTransactions() },
  products:  { label: 'Products',  render: () => renderProducts() },
  inventory: { label: 'Stock history', render: () => renderInventory() },
  customers: { label: 'Customers', render: () => renderCustomers() },
  suppliers: { label: 'Suppliers', render: () => renderSuppliers() },
  staff:     { label: 'Staff',     render: () => renderStaff() },
  insights:  { label: 'Analytics',  render: () => renderInsights() },
  payments:  { label: 'Payments',  render: () => renderPayments() },
  settings:  { label: 'Settings',  render: () => renderSettingsForm() },
};
// A page with sub-pages registers them here ({ param, def, items: [[key, label]] }) and they
// render as a tree under its sidebar link -- the page itself carries no tab strip.
const SUBNAV = globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {};
const viewLabel = (v) => (VIEWS[v] ? VIEWS[v].label : 'Back Office');

// The URL is the state. `applyRoute` is the only thing that writes state.view /
// state.range / state.anchor / the search boxes — every control navigates instead
// of mutating, so a pasted link reproduces the screen exactly and back/forward walk
// the filters. Router lives in router.js.
const Router = window.HWPOS_ROUTER;

function applyRoute() {
  const { view, id, params } = Router.route();
  state.view = VIEWS[view] ? view : 'dashboard';
  state.detailId = id || '';
  state.range = RANGE_DAYS[params.range] ? params.range : 'today';
  // A date that doesn't parse is the same as no date: today.
  const picked = params.date ? new Date(`${params.date}T00:00`) : null;
  state.anchor = picked && !isNaN(picked) ? dayStart(picked) : dayStart(new Date());
  // Only one view is on screen, so the three search boxes share one param.
  state.invQuery = state.custQuery = state.txQuery = params.q || '';
  paint();
}

function paint() {
  const view = state.view;
  document.title = `${viewLabel(view)} · EJ Hardware`;
  // A sub-page with its own link lights that link; any other lights the view's plain link.
  const sub = SUBNAV[view];
  const p = sub && Router.route().params[sub.param];
  const cur = sub ? (sub.items.some(([k]) => k === p) ? p : sub.def) : '';
  const deep = !!$(`.side-link[data-view="${view}"][data-sub~="${cur}"]`);
  // Stock history sits in Products' tree, so Products stays lit (tree open) on it.
  const lit = view === 'inventory' ? 'products' : view;
  const was = $('.side-link.active');
  $$('.side-link').forEach(b => b.classList.toggle('active',
    b.dataset.view === lit && (b.dataset.sub ? b.dataset.sub.split(' ').includes(cur) : !deep)));
  // Back/forward and in-page links move pages without a sidebar click, so they shut stray trees too.
  if ($('.side-link.active') !== was) shutTrees();
  $$('.view').forEach(v => {
    const on = v.dataset.view === view;
    v.classList.toggle('active', on);
    v.hidden = !on;
  });
  const title = $('#boTopbarTitle');
  if (title) title.textContent = viewLabel(view);
  // Every control that mirrors the URL is synced here, not in a per-view render,
  // so a control on a view that isn't rendering can't drift out of date.
  const q = state.invQuery;
  $$('.q-input').forEach(el => { if (el.value !== q) el.value = q; });
  $$('.range-select').forEach(sel => { sel.value = state.range; });
  renderSwitchers();
  // Every tree's leaves, not just this view's, so a leaf left behind doesn't stay lit in a peeked tree.
  $$('.side-sublink').forEach(b => {
    const on = !!sub && b.closest('.side-sub').dataset.view === view && b.dataset.sub === cur;
    b.classList.toggle('active', on);
    if (on) b.closest('.side-group')?.querySelector('.side-grouphead').setAttribute('aria-expanded', 'true');
  });
  renderCurrentView();
}

// ---------- Sidebar switchers ----------
// ponytail: one location until a stores table exists -- it is the first part of the store
// address, and the menu says more appear with sync. Switching accounts sets the same
// cashier field Settings edits (what actor() reads); a PIN belongs here once there is a login.
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
function renderSwitchers() {
  const store = state.settings.store;
  const loc = String(store.address || '').split(',')[0].trim() || 'Main Store';
  $('#locBiz').textContent = store.name;
  $('#locName').textContent = loc;
  $('#locMenu').innerHTML = `
    <div class="sm-head">Locations</div>
    <button class="sm-opt on" type="button" role="menuitem"><span class="sm-text">${escapeHtml(loc)}</span>${CHECK_SVG}</button>
    <div class="sm-note">Other locations show here once their terminals sync.</div>`;

  const staff = loadStaff().filter(u => u.active !== false);
  const me = staff.find(u => u.name === store.cashier);
  $('#acctName').textContent = store.cashier || 'Signed out';
  $('#acctRole').textContent = me ? STAFF_ROLES[me.role] || me.role : 'Owner';
  $('#acctMenu').innerHTML = `<div class="sm-head">Switch account</div>` + staff.map(u => `
    <button class="sm-opt${u === me ? ' on' : ''}" type="button" role="menuitem" data-staff="${escapeHtml(u.name)}">
      <span class="sm-text">${escapeHtml(u.name)}<span class="sm-sub">${escapeHtml(STAFF_ROLES[u.role] || u.role)}</span></span>${u === me ? CHECK_SVG : ''}
    </button>`).join('');
}
// Accordion tree: a page's sub-pages open under it while it is active, and clicking the
// active page again folds them. A page may group its sub-pages ({ groups: [[label, keys]] });
// each group is its own fold and opening one closes its siblings.
// One tree open at a time: opening `keep`'s tree (or navigating, no `keep`) shuts every other,
// the active page's included, and they slide shut on the same SIDEBAR FOLDS transition.
function shutTrees(keep) {
  $$('.side-link.has-sub').forEach(x => {
    if (x === keep) return;
    x.classList.remove('open');
    x.classList.toggle('folded', !!keep && x.classList.contains('active'));
  });
}
const CHEVRON_SVG = '<svg class="side-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
// Sub-pages that have their own sidebar link (data-sub) are left out of the tree. A link may
// own several (data-sub="a b c"): it opens the first and carries the rest as its tree,
// which is how one view's sub-pages split across several short sidebar entries.
function goSub(view, key) {
  const sub = SUBNAV[view], { params } = Router.route();
  const value = key === sub.def ? '' : key;
  // Same page, no record open: keep the filters (q, cat, level…), swap only the sub-page.
  if (view === state.view && !state.detailId) return Router.setParams({ [sub.param]: value, page: '' }, { replace: false });
  Router.go(view, '', { range: params.range, date: params.date, [sub.param]: value });
}
function buildSubnav() {
  Object.entries(SUBNAV).forEach(([view, sub]) => {
    const label = Object.fromEntries(sub.items);
    const btn = (k) => `<button class="side-sublink" type="button" data-sub="${k}">${escapeHtml(label[k])}</button>`;
    const tree = (link, body) => {
      link.classList.add('has-sub');
      link.insertAdjacentHTML('beforeend', CHEVRON_SVG);
      link.insertAdjacentHTML('afterend', `<div class="side-sub" data-view="${view}"><div class="side-fold-in">${body}</div></div>`);
    };
    const deepLinks = $$(`.side-link[data-view="${view}"][data-sub]`);
    deepLinks.forEach(l => { const keys = l.dataset.sub.split(' '); if (keys.length > 1) tree(l, keys.slice(1).map(btn).join('')); });
    const link = $(`.side-link[data-view="${view}"]:not([data-sub])`);
    const own = new Set(deepLinks.flatMap(l => l.dataset.sub.split(' ')));
    const left = (keys) => keys.filter(k => !own.has(k));
    if (!link || !left(sub.items.map(([k]) => k)).length) return;
    const body = sub.groups
      ? sub.groups.filter(([, keys]) => left(keys).length).map(([g, keys]) => `<div class="side-group">
          <button class="side-grouphead" type="button" aria-expanded="false">${escapeHtml(g)}${CHEVRON_SVG}</button>
          <div class="side-groupbody">${left(keys).map(btn).join('')}</div></div>`).join('')
      : left(sub.items.map(([k]) => k)).map(btn).join('');
    tree(link, body);
  });
  // Section labels fold their links; which ones are folded is a per-device pref.
  const shut = new Set(String(HWPOS_STORE.ui.get('sideFolded', '') || '').split(',').filter(Boolean));
  const setFold = (lab, open) => lab.setAttribute('aria-expanded', String(open));
  $$('.side-label[data-fold]').forEach(l => setFold(l, !shut.has(l.dataset.fold)));
  $('.side-nav').addEventListener('click', (e) => {
    const lab = e.target.closest('.side-label[data-fold]');
    if (lab) {
      const open = lab.getAttribute('aria-expanded') !== 'true';
      setFold(lab, open);
      shut[open ? 'delete' : 'add'](lab.dataset.fold);
      HWPOS_STORE.ui.set('sideFolded', [...shut].join(','));
      return;
    }
    const head = e.target.closest('.side-grouphead');
    if (head) {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.closest('.side-sub').querySelectorAll('.side-grouphead').forEach(h => h.setAttribute('aria-expanded', 'false'));
      head.setAttribute('aria-expanded', String(open));
      return;
    }
    const b = e.target.closest('.side-sublink');
    if (!b) return;
    shutTrees();
    goSub(b.closest('.side-sub').dataset.view, b.dataset.sub);
    if (!window.matchMedia('(min-width: 1024px)').matches) $('#app').classList.add('sidebar-collapsed');
  });
}
function closeSideMenus() {
  $$('.side-menu').forEach(m => { m.hidden = true; });
  $$('.side-switch').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function wireSwitchers() {
  $$('.side-switch').forEach(btn => btn.addEventListener('click', () => {
    const menu = btn.nextElementSibling;
    const open = menu.hidden;
    closeSideMenus();
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.side-switch-wrap')) closeSideMenus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSideMenus(); });
  $('#acctMenu').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-staff]');
    if (!pick) return;
    state.settings.store.cashier = pick.dataset.staff;
    saveSettings();
    closeSideMenus();
    paint();
  });
}

// Keep the range/date on the URL when only the view changes.
function setView(view) {
  const { params } = Router.route();
  Router.go(view, '', { range: params.range, date: params.date });
}

function renderCurrentView() {
  VIEWS[state.view]?.render();
}

function refreshSharedState() {
  state.folders  = loadFolders();
  state.products = loadProducts();
  state.orders = loadOrders();
  state.customers = loadSavedCustomers();
  state.settings = loadSettings();
  buildProductIndex();
}

// ---------- Dashboard ----------
const RANGE_DAYS  = { today: 1, '7d': 7, '15d': 15, '30d': 30 };
const RANGE_LABEL = { today: 'Today', '7d': 'Last 7 days', '15d': 'Last 15 days', '30d': 'Last 30 days' };

function shortDate(ts) {
  return new Date(ts).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });
}

// The anchor can sit in the past, and "Today" would then be a lie.
function rangeLabel(range = state.range) {
  if (state.anchor === dayStart(new Date())) return range === 'today' ? 'Today' : RANGE_LABEL[range];
  return range === 'today' ? shortDate(state.anchor) : `${RANGE_DAYS[range]} days to ${shortDate(state.anchor)}`;
}
const STATUS_TONE = {
  completed: ['ok', 'Completed'],
  voided:    ['danger', 'Voided'],
  refunded:  ['warn', 'Refunded'],
  return:    ['warn', 'Return'],
  saved:     ['muted', 'Saved'],
};

// Cost lookup: orders store the sale price, products store the cost.
// ponytail: one Map, rebuilt whenever products change, instead of three linear scans per
// line item. orderProfit runs this for every item of every order in the range -- over a year
// of sales that was millions of passes across the catalog.
let productIndex = new Map();
function buildProductIndex() {
  const m = new Map();
  // First match wins per key, mirroring the .find() chain this replaced. ids are unique.
  for (const p of state.products) {
    if (p.name && !m.has('n:' + p.name)) m.set('n:' + p.name, p);
    if (p.sku && !m.has('s:' + p.sku)) m.set('s:' + p.sku, p);
  }
  for (const p of state.products) if (p.id) m.set('i:' + p.id, p);
  productIndex = m;
}
function productFor(item) {
  return productIndex.get('i:' + item.id)
    || (item.sku && productIndex.get('s:' + item.sku))
    || productIndex.get('n:' + item.name)
    || null;
}
// The cost the line was sold at, not the cost it would be bought at today. Old receipts
// (and every sale made before app.js started stamping it) fall back to the product.
const costOf = (item) => (item.cost != null ? item.cost : (productFor(item)?.cost || 0));
const itemNet = (item) => (item.lineTotal != null ? item.lineTotal : item.price * item.qty);

// ponytail: gross profit = revenue ex-VAT minus cost of goods. Ignores order-level
// discounts already folded into total; good enough to steer buying, not for BIR.
function orderProfit(order) {
  const cogs = order.items.reduce((sum, i) => sum + costOf(i) * i.qty, 0);
  return (order.total - (order.vatAmount || 0)) - cogs;
}

// A sale's contribution to revenue. The two shapes `app.js` writes, and why the signs differ:
// a void, a refund and an exchange flip the ORIGINAL in place (voided/refunded, sign 0) and an
// exchange adds its own completed sale; a RETURN leaves the original completed and appends a
// separate `return` row, which is why that one is -1 -- it has to cancel a +1 that is still
// there. Nothing is ever filtered out of a cut; the sign is what keeps them visible while they
// stop counting.
const SALE_SIGN = { completed: 1, return: -1, refunded: 0, voided: 0, saved: 0 };
const saleSign = (o) => SALE_SIGN[o.status || 'completed'] ?? 0;

// What a ledger ROW shows in its money column. A return handed the money back, so it prints
// negative -- printing +₱972.32 next to a "Return" pill reads as a second sale and it took
// hand-adding the column against the summary to notice. A void or a refund keeps its face
// value: the row is showing what was voided, and the status pill already says it counts zero.
const txTotal = (o) => (saleSign(o) < 0 ? -o.total : o.total);

function salesIn(start, end) {
  return state.orders.filter(o => saleSign(o) !== 0 && o.ts >= start && o.ts < end);
}

function rangeWindows(range = state.range) {
  const start = rangeStart(range), end = rangeEnd();
  return { start, end, prevStart: shiftDays(start, -(RANGE_DAYS[range] || 1)), prevEnd: start };
}

function metricsOf(sales) {
  let revenue = 0, items = 0, profit = 0;
  sales.forEach(o => {
    const sign = saleSign(o);
    revenue += o.total * sign;
    profit += orderProfit(o) * sign;
    o.items.forEach(i => { items += i.qty * sign; });
  });
  return { revenue, profit, items, txns: sales.length, avg: sales.length ? revenue / sales.length : 0 };
}

function deltaOf(cur, prev, cmp) {
  if (!prev) return { tone: 'flat', text: cur ? 'new' : '—', cmp: `vs ${cmp}` };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const tone = pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat';
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return { tone, text: `${sign}${Math.abs(pct).toFixed(1)}%`, cmp: `vs ${cmp}` };
}

// ---------- The calm pages (Dashboard, Sales › Summary) ----------
// Ported from dashboard-calm-lab.html / sales-calendar-lab.html; both read these.
// ₱12.3k / ₱1.23M for headline figures, whole pesos under ₱10k.
const pesoK = (n) => {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return a >= 1e6 ? `${s}₱${+(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${s}₱${+(a / 1e3).toFixed(1)}k` : pesoShort(n);
};
const hourShort = (h) => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
// One pass: revenue and profit signed, sales/discounts on the +1 rows, returns on the −1 rows.
function calmMetrics(list) {
  const m = { rev: 0, gp: 0, n: 0, sales: 0, ret: 0, retN: 0, disc: 0, vat: 0, voids: 0 };
  for (const o of list) {
    const s = saleSign(o);
    if (!s) { if (o.status === 'voided' || o.status === 'refunded') m.voids++; continue; }
    m.rev += o.total * s; m.gp += orderProfit(o) * s; m.vat += (+o.vatAmount || 0) * s;
    if (s > 0) { m.n++; m.sales += +o.total; m.disc += +o.discount || 0; } else { m.ret += +o.total; m.retN++; }
  }
  return m;
}
// "+4.2%" beside a number; nothing when there is nothing to compare with.
const calmChip = (cur, prev, title) => {
  if (!prev) return '';
  const r = Math.round((cur - prev) / Math.abs(prev) * 1000) / 10;
  return `<span class="chip ${r > 0 ? 'up' : r < 0 ? 'down' : ''}" title="${escapeHtml(title)}">${r > 0 ? '+' : ''}${r.toFixed(1)}%</span>`;
};

// The KPI block (bo-blocks.css → KPI). Every KPI on every page is built by one of these
// two, so the markup can only drift in one place. Label on top; the number left and the
// trend chip RIGHT on the same line — never a trend under the number.
// `kpi` is for a number with a plain note beside it ("12 active debtors"); a down tone
// reds the note. `statCell` is for a number with a real comparison: a chip, and the
// comparison basis ("vs the day before") in its title.
function kpi(label, value, sub, tone = 'flat', title = '') {
  return `
    <div class="bo-card blk-kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-line">
        <div class="kpi-value">${curHtml(value)}</div>
        ${sub ? `<span class="kpi-note ${tone === 'down' ? 'down' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(sub)}</span>` : ''}
      </div>
    </div>`;
}

function statCell({ label, value, unit, delta }) {
  const trend = !delta ? ''
    : delta.cmp ? `<span class="trend ${delta.tone}" title="${escapeHtml(delta.cmp)}">${escapeHtml(delta.text)}</span>`
    : `<span class="kpi-note">${escapeHtml(delta.text)}</span>`;   // a note, not a comparison: no chip
  return `
    <div class="bo-card blk-kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-line">
        <div class="kpi-value">${curHtml(value)}${unit ? ` <span class="kpi-note">${escapeHtml(unit)}</span>` : ''}</div>
        ${trend}
      </div>
    </div>`;
}

// Breakdown rows and a label-over-number head for rail cards (Inventory, Staff).
const bdRow = (nm, amt = '', cmp = '', tone = '') =>
  `<div class="bd-row"><span class="nm">${nm}</span>${amt !== '' ? `<span class="amt">${amt}</span>` : ''}${cmp !== '' ? `<span class="cmp ${tone}">${cmp}</span>` : ''}</div>`;
const railHead = (label, value, side = '') =>
  `<div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-line"><div class="kpi-value">${value}</div>${side}</div>`;

// Targets are always today and this month, whatever the range says: a target is a promise
// about the calendar, not about the window you happen to be looking at.
// The owner sets the month; today's share is what is left spread over the days left, today
// included, rounded to ₱10. An override replaces it for that one date only.
function dashTargets(now = Date.now()) {
  const t = state.settings.targets || {};
  const d = new Date(now), today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const before = metricsOf(salesIn(monthStart, today)).revenue;
  const done = metricsOf(salesIn(today, today + 864e5)).revenue;
  const month = Number(t.month) || 0;
  const left = days - d.getDate() + 1;   // ponytail: every day counts as open; skip closed days once store hours exist
  const auto = month ? Math.max(0, Math.round((month - before) / left / 10) * 10) : 0;
  const override = t.override && t.override.date === isoDate(now) ? Number(t.override.amount) || 0 : 0;
  const elapsed = d.getDate() - 1 + (d.getHours() + d.getMinutes() / 60) / 24;
  return { month, before, done, days, left, auto, override, daily: override || auto,
    pace: elapsed > 0 ? (before + done) / elapsed * days : 0 };
}
function openTargetDialog() {
  const dlg = $('#targetDlg'), t = dashTargets();
  dlg.innerHTML = `
    <div class="bod-head">
      <div class="bod-title"><h2>Sales targets</h2></div>
      <button type="button" class="bod-close" aria-label="Close">&times;</button>
    </div>
    <div class="adj-body">
      <form class="adj-form" id="targetForm">
        <div class="adj-grid">
          <label class="adj-field"><span>Monthly target</span>
            <input name="month" type="number" min="0" step="100" value="${t.month || ''}" autocomplete="off" required></label>
          <label class="adj-field"><span>Today only (blank = worked out)</span>
            <input name="override" type="number" min="0" step="10" value="${t.override || ''}" placeholder="${t.auto || ''}" autocomplete="off"></label>
        </div>
        <div class="adj-foot">
          <span class="adj-last">Today's target is what's left of the month over the ${t.left} day${t.left === 1 ? '' : 's'} left, today included.</span>
          <button type="button" class="secondary-btn small" data-act="targetCancel">Cancel</button>
          <button type="submit" class="primary-btn small">Save</button>
        </div>
      </form>
    </div>`;
  dlg.showModal();
  dlg.querySelector('input[name="month"]').focus();
}

// ponytail: the 7d/30d ranges span days, so a bare clock time is ambiguous — prefix the
// date unless the sale happened today.
function txTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}, ${time}`;
}

// ---------- Dashboard (dashboard-calm-lab.html, bo-calm.css) ----------
// The view lives in the URL: ?range= (applyRoute → state.range), ?vs= the comparison, ?chart= the
// KPI the bars show, ?at= an hour ("10") or a day ("2026-09-20"), ?receipt= an order id.
// ponytail: always ends now, like the lab; the old "Ends on" date went with the old picker.
const hourLong = (h) => (h % 12 || 12) + (h % 24 < 12 ? ' AM' : ' PM');
const dashDate = (t, o) => new Date(t).toLocaleDateString('en-PH', o);
// The window, and the one it's compared with: today against the same weekday last week up to
// this minute; N days against the N days before, also up to this minute. Never a half day vs a whole one.
// ?vs= picks another: '' is that default, 'day' is yesterday (today only), 'none' turns the chips off.
function dashCompares(range, today) {   // [key, menu label, days back, chip tooltip]
  const n = RANGE_DAYS[range], wd = dashDate(shiftDays(today, -7), { weekday: 'long' });
  return (range === 'today'
    ? [['', `Last ${wd}`, 7, `vs last ${wd} at this time`], ['day', 'Yesterday', 1, 'vs yesterday at this time']]
    : [['', `Previous ${n} days`, n, `vs the ${n} days before`]]).concat([['none', 'No comparison', 0, '']]);
}
function dashWindow(range, vs) {
  const now = Date.now(), today = dayStart(now);
  const all = state.orders.filter(o => o.ts < now).sort((a, b) => a.ts - b.ts);
  const between = (a, b) => all.filter(o => o.ts >= a && o.ts < b);
  const cs = dashCompares(range, today), [vsKey, vsLbl, back, vsTitle] = cs.find(c => c[0] === vs) || cs[0];
  const n = RANGE_DAYS[range], start = shiftDays(today, 1 - n);
  const w = { range, now, today, between, compares: cs, vsKey, vs: vsTitle, vsLbl: back ? vsLbl : '',
    rows: between(start, now), prev: back ? between(shiftDays(start, -back), shiftDays(now, -back)) : [] };
  if (range === 'today') {
    // store hours: whatever hours sold in the last four weeks
    const seen = between(shiftDays(today, -28), now).map(o => new Date(o.ts).getHours());
    const h0 = seen.length ? Math.min(...seen) : 7, h1 = seen.length ? Math.max(...seen) : 18;
    const lastWd = dashDate(shiftDays(today, -7), { weekday: 'long' });
    w.buckets = [];
    for (let h = h0; h <= h1; h++) w.buckets.push({ key: String(h), x: hourShort(h), title: `${hourLong(h)} – ${hourLong(h + 1)}`,
      start: today + h * 36e5, end: today + (h + 1) * 36e5, backName: `the same hour last ${lastWd}` });
  } else {
    w.buckets = Array.from({ length: n }, (_, i) => { const t = shiftDays(start, i);
      return { key: isoDate(t), x: n > 7 ? String(new Date(t).getDate()) : dashDate(t, { weekday: 'short' }),
        title: dashDate(t, { weekday: 'long', month: 'long', day: 'numeric' }), start: t, end: shiftDays(t, 1),
        backName: dashDate(shiftDays(t, -7), { weekday: 'long', month: 'short', day: 'numeric' }) }; });
  }
  for (const b of w.buckets) { b.future = b.start >= now; b.now = !b.future && now < b.end; b.m = calmMetrics(w.rows.filter(o => o.ts >= b.start && o.ts < b.end)); }
  return w;
}

// The same four KPIs as before; each is also what the bars can show. of() reads calmMetrics().
const dashMargin = (x) => (x.rev ? x.gp / x.rev * 100 : 0);
const DASH_KPI = {
  rev: { lbl: 'Revenue',      of: x => x.rev,  fmt: pesoShort,                        axis: pesoK,              floor: 100 },
  gp:  { lbl: 'Profit',       of: x => x.gp,   fmt: pesoShort,                        axis: pesoK,              floor: 100 },
  n:   { lbl: 'Transactions', of: x => x.n,    fmt: v => v.toLocaleString('en-PH'),   axis: v => +v.toFixed(1), floor: 5 },
  mg:  { lbl: 'Margin',       of: dashMargin,  fmt: v => v.toFixed(1) + '%',          axis: v => v + '%',       floor: 10 },
};
function dashStrip(W, chart) {
  const m = calmMetrics(W.rows), p = calmMetrics(W.prev);
  const stat = (k, val, side) =>
    `<button class="stat" role="tab" data-chart="${k}" aria-selected="${chart === k}"><div class="lbl">${DASH_KPI[k].lbl}</div><div class="line"><span class="val">${val}</span>${side}</div></button>`;
  return stat('rev', pesoShort(m.rev), calmChip(m.rev, p.rev, W.vs))
    + stat('gp', pesoShort(m.gp), calmChip(m.gp, p.gp, W.vs))
    + stat('n', m.n.toLocaleString('en-PH'), calmChip(m.n, p.n, W.vs))
    + stat('mg', m.rev ? dashMargin(m).toFixed(1) + '%' : '—', m.rev && p.rev ? calmChip(dashMargin(m), dashMargin(p), W.vs) : '');
}

// The bars: the picked KPI per hour (today) or per day.
function niceStep(v) { const e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }
function dashPlot(W, chart) {
  const K = DASH_KPI[chart], val = b => K.of(b.m);
  const bs = W.buckets, peak = Math.max(K.floor, ...bs.map(val));
  const step = niceStep(peak / 3), top = Math.ceil(peak * 1.1 / step) * step;   // ≥10% headroom: the tallest bar never touches the top line
  const every = Math.ceil(bs.length / 12);                                   // a label every few bars on 30 days, counted back from today
  let grid = '';
  for (let v = 0; v <= top + 1e-6; v += step) grid += `<div class="gl${v ? '' : ' zero'}" style="bottom:${v / top * 100}%"><span>${K.axis(v)}</span></div>`;
  const cols = bs.map((b, i) => b.future
    ? `<div class="b future"><span class="x">${(bs.length - 1 - i) % every ? '' : b.x}</span></div>`
    : `<button class="b" data-at="${b.key}" aria-label="${escapeHtml(b.title)}: ${K.fmt(val(b))}">`
      + `<i style="height:${Math.max(0, val(b)) / top * 100}%"><span class="tip"><b>${escapeHtml(b.title)}</b>`
      + Object.entries(DASH_KPI).map(([k, x]) => `<span class="${k === chart ? 'on' : ''}">${x.lbl}<em>${b.m.rev || k !== 'mg' ? x.fmt(x.of(b.m)) : '—'}</em></span>`).join('')
      + `</span></i>`
      + `<span class="x${b.now ? ' now' : ''}">${(bs.length - 1 - i) % every && !b.now ? '' : b.x}</span></button>`).join('');
  return `<div class="grid">${grid}</div>`
    + `<div class="cols${bs.length > 8 ? ' many' : ''}" style="grid-template-columns:repeat(${bs.length},minmax(0,1fr))">${cols}</div>`;
}

// Recent transactions: the latest 20 in the range, every status, so voids and refunds show.
// Sales › Transactions is the one that pages past this.
const RECENT_TX = 20;
const PAY_TONE = { cash: 'up', gcash: 'data', qr: 'data', credit: 'warn' };
const statusName = (o) => { const st = o.status || 'completed'; return st[0].toUpperCase() + st.slice(1); };
function dashTx(W) {
  const shown = W.rows.slice().reverse().slice(0, RECENT_TX);
  return shown.length ? `<div class="flush"><table class="tx">
    <tr><th>Receipt</th><th>Time</th><th class="opt">Customer</th><th class="opt">Staff</th><th class="opt">Fulfilment</th><th>Payment</th><th class="opt">Status</th><th class="n">Total</th></tr>
    ${shown.map(o => `<tr data-receipt="${escapeHtml(o.id)}" class="${saleSign(o) ? '' : 'dim'}">
      <td class="id">#${escapeHtml(o.number || o.id)}</td><td class="t">${escapeHtml(txTime(o.ts))}</td>
      <td class="opt cust">${o.customer?.name ? escapeHtml(o.customer.name) : '<span class="mut">—</span>'}</td>
      <td class="opt">${escapeHtml(o.cashier || '—')}</td><td class="opt">${escapeHtml(orderFulfilLabel(o))}</td>
      <td><span class="pill ${PAY_TONE[o.paymentKind] || ''}">${escapeHtml(orderPaymentLabel(o))}</span></td>
      <td class="opt"><span class="pill ${{ completed: 'up', voided: 'down', return: 'warn', refunded: 'warn' }[o.status || 'completed'] || ''}">${statusName(o)}</span></td>
      <td class="n amt">${peso(txTotal(o))}</td></tr>`).join('')}
  </table></div>` : `<p class="note" style="margin:6px 0 16px">No transactions ${W.range === 'today' ? 'yet today' : 'in this range'}.</p>`;
}

// The rail: targets (always today and this month, whatever the range says), low stock, payment methods.
const calmRow = (nm, amt, cmp = null, cls = '') => `<div class="row ${cls}"><span class="nm">${nm}</span><span class="amt">${amt}</span>${cmp !== null ? `<span class="cmp ${cls}">${cmp}</span>` : ''}</div>`;
// The rail's cards. The Widgets menu shows and hides them, like Sales › Transactions; which are off is this
// device's choice (HWPOS_STORE.ui 'dashHide').
const DASH_W = { daily: 'Daily sales target', monthly: 'Monthly sales target', low: 'Low stock', pay: 'Payment methods' };
const dashHidden = () => String(HWPOS_STORE.ui.get('dashHide', '') || '').split(',').filter(Boolean);

function dashRail(W, on) {
  const t = dashTargets(W.now);
  const head = (lbl, val, side = '', link = '') => `<div class="top"><span>${lbl}</span>${link}</div><div class="line"><span class="val">${val}</span>${side}</div>`;
  const pctSide = pct => `<span class="pct ${pct >= 100 ? 'up' : ''}">${pct}%</span>`;
  const empty = lbl => head(lbl, '—') + `<button class="set">Set target</button><div class="rows foot">${calmRow('No monthly target yet', '')}</div>`;
  const out = {};
  out.daily = () => {
    if (!t.daily) return empty('Daily sales target');
    const pct = Math.round(t.done / t.daily * 100), left = t.daily - t.done;
    return head('Daily sales target', `${pesoShort(t.done)}<span class="of">/${pesoShort(t.daily)}</span>`, pctSide(pct))
      + `<div class="rows foot">${left > 0 ? calmRow('Left to sell today', pesoShort(left)) : calmRow('Target hit, over by', pesoShort(-left))}</div>`;
  };
  out.monthly = () => {
    if (!t.month) return empty('Monthly sales target');
    const sold = t.before + t.done, pct = Math.round(sold / t.month * 100), left = t.month - sold;
    return head('Monthly sales target', `${pesoK(sold)}<span class="of">/${pesoK(t.month)}</span>`, pctSide(pct))
      + `<div class="rows foot">${left > 0 ? calmRow('Left to sell this month', pesoK(left)) : calmRow('Target hit, over by', pesoK(-left))}</div>`;
  };

  // Low stock: the five that run out first by the last 30 days' selling.
  out.low = () => {
    const sold = new Map();
    for (const o of W.between(W.today - 30 * 864e5, W.now)) if (saleSign(o) > 0) for (const i of o.items || []) { const p = productFor(i); if (p) sold.set(p.id, (sold.get(p.id) || 0) + (+i.qty || 0)); }
    const daysLeft = p => { const r = (sold.get(p.id) || 0) / 30; return p.stock <= 0 ? 0 : r ? p.stock / r : Infinity; };
    const low = state.products.filter(isLow).sort((a, b) => daysLeft(a) - daysLeft(b) || a.stock - b.stock);
    return head('Low stock', low.length ? String(low.length) : `0<span class="of"> all stocked</span>`, '',
        low.length ? `<a href="${Router.href('products', '', { view: 'stock', level: 'out,low' })}">View all ›</a>` : '')
      + (low.length ? `<div class="rows">${low.slice(0, 5).map(p => `<div class="row"><span class="nm">${escapeHtml(p.name)}</span>`
        + `<span class="pill ${p.stock <= 0 ? 'down' : 'warn'}" style="margin:0">${p.stock <= 0 ? 'Out' : 'Low'}</span></div>`).join('')}</div>` : '');
  };

  // Payment methods, for the range: the only rail card that follows it.
  out.pay = () => {
    const pays = new Map();
    for (const o of W.rows) { const s = saleSign(o); if (s) pays.set(orderPaymentLabel(o), (pays.get(orderPaymentLabel(o)) || 0) + o.total * s); }
    const payRows = [...pays].filter(p => p[1]).sort((x, y) => y[1] - x[1]);
    return `<div class="top band"><span>Payment methods</span></div>` + (payRows.length
      ? `<div class="rows">${payRows.map(([k, v]) => calmRow(escapeHtml(k), pesoShort(v))).join('')}${calmRow('Total', pesoShort(payRows.reduce((s, p) => s + p[1], 0)), null, 'total')}</div>`
      : '<p class="note" style="margin:10px 0 0">No sales in this range.</p>');
  };
  return on.map(id => `<section class="card w">${out[id]()}</section>`).join('');
}

// The pop-up: one bar (hour or day), or one receipt. ‹ › step through the live bars or the range's receipts.
const popSec = (lbl, body, side = '') => `<div class="p-sec"><div class="lbl">${lbl}<span>${side}</span></div>${body}</div>`;
const popTop = (title, prev, next) => `<div class="p-top"><h2>${title}</h2>
  <button class="icon-btn" data-step="-1" aria-label="Previous" ${prev ? '' : 'disabled'}>‹</button>
  <button class="icon-btn" data-step="1" aria-label="Next" ${next ? '' : 'disabled'}>›</button>
  <button class="icon-btn" data-close aria-label="Close">✕</button></div>`;
const statusPill = (o) => { const st = o.status || 'completed'; return st === 'completed' ? '' : `<span class="pill ${st === 'voided' ? 'down' : 'warn'}">${statusName(o)}</span>`; };
const clockOf = (t) => new Date(t).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
const liveBars = (W) => W.buckets.filter(b => !b.future);
function barPop(W, b) {
  const rows = W.rows.filter(o => o.ts >= b.start && o.ts < b.end), m = b.m;
  const p = calmMetrics(W.between(shiftDays(b.start, -7), Math.min(shiftDays(b.end, -7), shiftDays(W.now, -7))));
  const share = v => m.rev ? (v / m.rev * 100).toFixed(1) + '%' : '';
  const group = key => { const g = new Map(); for (const o of rows) { const s = saleSign(o); if (s) for (const [k, v] of key(o, s)) g.set(k, (g.get(k) || 0) + v); } return [...g].sort((x, y) => y[1] - x[1]); };
  const L = liveBars(W), i = L.indexOf(b);
  let html = popTop(b.title, i > 0, i < L.length - 1)
    + `<div class="p-head"><span class="val">${pesoShort(m.rev)}</span>${calmChip(m.rev, p.rev, 'vs ' + b.backName + (b.now ? ' at this time' : ''))}</div>`
    + `<p class="p-sub">${m.n} transaction${m.n === 1 ? '' : 's'} · ${pesoShort(m.gp)} profit${b.now ? ' · so far' : ''}</p>`;
  if (!rows.length) return html + '<p class="p-sub" style="margin-top:20px">No sales.</p>';
  html += popSec('Payment methods', `<div class="rows">${group((o, s) => [[orderPaymentLabel(o), o.total * s]]).map(([k, v]) => calmRow(escapeHtml(k), pesoShort(v), share(v))).join('')}</div>`);
  const its = group((o, s) => (o.items || []).map(i => [productFor(i)?.name || i.name, itemNet(i) * s]));
  html += popSec('Top items', `<div class="rows">${its.slice(0, 5).map(([k, v]) => calmRow(escapeHtml(k), pesoShort(v), share(v))).join('')}</div>`, `${its.length} items sold`);
  html += popSec('Transactions', `<div class="rows">${rows.slice().reverse().map(o => `<button class="row ${saleSign(o) ? '' : 'dim'}" data-receipt="${escapeHtml(o.id)}"><span class="t">${clockOf(o.ts)}</span>`
    + `<span class="nm">#${escapeHtml(o.number || o.id)} · ${escapeHtml(orderPaymentLabel(o))}${statusPill(o)}</span><span class="amt">${pesoShort(txTotal(o))}</span></button>`).join('')}</div>`, `${rows.length} total`);
  return html;
}
function receiptPop(W, o) {
  const i = W.rows.indexOf(o), s = saleSign(o), its = o.items || [];
  const sub = its.reduce((x, it) => x + itemNet(it), 0);
  let html = popTop(`Receipt #${escapeHtml(o.number || o.id)}`, i > 0, i >= 0 && i < W.rows.length - 1)
    + `<div class="p-head"><span class="val">${peso(txTotal(o))}</span>${statusPill(o)}</div>`
    + `<p class="p-sub">${escapeHtml(txTime(o.ts))} · ${escapeHtml(o.cashier || '—')} · ${escapeHtml(orderFulfilLabel(o))} · ${escapeHtml(orderPaymentLabel(o))}${o.customer?.name ? ' · ' + escapeHtml(o.customer.name) : ''}</p>`;
  html += popSec('Items', `<div class="rows">${its.map(it => calmRow(`${escapeHtml(productFor(it)?.name || it.name)}<small>${+it.qty} × ${peso(+it.price || itemNet(it) / (+it.qty || 1))}</small>`, peso(itemNet(it)))).join('')}</div>`, `${its.length} line${its.length === 1 ? '' : 's'}`);
  html += popSec('Totals', `<div class="rows">
    ${calmRow('Subtotal', peso(sub))}
    ${+o.discount ? calmRow('Discount', peso(-o.discount)) : ''}
    ${calmRow('VAT included', peso(+o.vatAmount || 0))}
    ${calmRow('Total', peso(+o.total), null, 'total')}</div>`,
    s ? '' : 'Books no revenue');
  if (o.paymentKind === 'credit' && s > 0) html += '<p class="p-sub" style="margin-top:10px"><span class="pill warn" style="margin:0">Not collected</span> On the customer’s account.</p>';
  return html;
}

let dashW = null;   // the window last painted; the click wiring steps through it
function renderDashboard() {
  refreshSharedState();
  const P = Router.route().params, W = dashW = dashWindow(state.range, P.vs || '');
  const chart = DASH_KPI[P.chart] ? P.chart : 'rev';
  const opt = (attr, v, lbl, on) => `<button role="menuitemradio" ${attr}="${v}" aria-checked="${on}">${lbl}</button>`;
  $('#dashGreeting').textContent = `Welcome back, ${state.settings.store?.cashier || 'there'}`;
  $('#dashPick').innerHTML = RANGE_LABEL[W.range] + (W.vsLbl ? `<span class="vs">vs ${W.vsLbl[0].toLowerCase() + W.vsLbl.slice(1)}</span>` : '');
  $('#dashRange').innerHTML = Object.keys(RANGE_DAYS).map(r => opt('data-range', r, RANGE_LABEL[r], r === W.range)).join('')
    + '<hr><h3>Compare to</h3>' + W.compares.map(c => opt('data-vs', c[0], c[1], c[0] === W.vsKey)).join('');
  $('#dashStrip').innerHTML = dashStrip(W, chart);
  $('#dashPlot').innerHTML = dashPlot(W, chart);
  $('#dashTx').innerHTML = dashTx(W);
  $('#dashTxAll').href = Router.href('transactions', '');
  const on = Object.keys(DASH_W).filter(id => !dashHidden().includes(id));
  $('#dashW').innerHTML = `<div class="all"><button data-w-all="on">Show all</button><button data-w-all="off">Hide all</button></div><hr>${Object.entries(DASH_W).map(([id, n]) => `<button role="menuitemcheckbox" data-w="${id}" aria-checked="${on.includes(id)}">${n}</button>`).join('')}`;
  $('#dashGrid').classList.toggle('solo', !on.length);
  $('#dashRail').innerHTML = dashRail(W, on);

  const dlg = $('#dashPop');
  const b = P.at ? W.buckets.find(x => x.key === P.at && !x.future) : null;
  const o = P.receipt ? W.rows.find(x => x.id === P.receipt) : null;
  if (!b && !o) {   // nothing to show; a stale ?at= or ?receipt= leaves the URL, like the lab
    if (dlg.open) dlg.close();
    else if (P.at || P.receipt) Router.setParams({ at: '', receipt: '' });
    return;
  }
  $('#dashPopIn').innerHTML = o ? receiptPop(W, o) : barPop(W, b);
  if (!dlg.open) dlg.showModal();
}

function initDashboard() {
  const menu = $('#dashRange'), dlg = $('#dashPop');
  const open = (p) => Router.setParams({ at: '', receipt: '', ...p });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range],[data-vs]');
    if (!b) return;
    menu.hidePopover();
    if (b.dataset.range) {
      const r = b.dataset.range, vs = Router.route().params.vs || '';
      Router.setParams({ range: r === 'today' ? '' : r, vs: dashCompares(r, dayStart(Date.now())).some(c => c[0] === vs) ? vs : '', at: '', receipt: '' });
    } else open({ vs: b.dataset.vs });
  });
  menu.addEventListener('toggle', (e) => {   // hang it under the button, right edges flush
    if (e.newState !== 'open') return;
    const r = $('#dashPick').getBoundingClientRect();
    menu.style.top = r.bottom + 6 + 'px';
    menu.style.left = Math.max(16, r.right - menu.offsetWidth) + 'px';
  });
  $('#dashStrip').addEventListener('click', (e) => { const c = e.target.closest('[data-chart]'); if (c) Router.setParams({ chart: c.dataset.chart === 'rev' ? '' : c.dataset.chart }); });
  $('#dashPlot').addEventListener('click', (e) => { const c = e.target.closest('[data-at]'); if (c) open({ at: c.dataset.at }); });
  $('#dashTx').addEventListener('click', (e) => { const r = e.target.closest('[data-receipt]'); if (r) open({ receipt: r.dataset.receipt }); });
  $('#dashRail').addEventListener('click', (e) => { if (e.target.closest('.set')) openTargetDialog(); });
  // Widgets: a menu tick — the main column glides to its new width (slideRender).
  $('#dashW').addEventListener('click', (e) => {
    const w = e.target.closest('[data-w], [data-w-all]');
    if (!w) return;
    const id = w.dataset.w, off = dashHidden();
    HWPOS_STORE.ui.set('dashHide', w.dataset.wAll ? (w.dataset.wAll === 'on' ? '' : Object.keys(DASH_W).join(','))
      : (off.includes(id) ? off.filter(x => x !== id) : [...off, id]).join(','));
    slideRender(renderDashboard);
  });
  $('#dashW').addEventListener('toggle', (e) => {   // hang it under its button, right edges flush
    if (e.newState !== 'open') return;
    const m = e.currentTarget, r = $('#dashWBtn').getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.left = Math.max(16, r.right - m.offsetWidth) + 'px';
  });
  // Esc, the backdrop (the global dialog handler) and ✕ all just close it; closing clears the URL.
  dlg.addEventListener('close', () => { const P = Router.route().params; if (P.at || P.receipt) open({}); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    const r = e.target.closest('[data-receipt]');
    if (r) return open({ receipt: r.dataset.receipt });
    const st = e.target.closest('[data-step]');
    if (!st || !dashW) return;
    const n = +st.dataset.step, P = Router.route().params;
    if (P.at) { const L = liveBars(dashW); open({ at: L[L.findIndex(b => b.key === P.at) + n].key }); }
    else open({ receipt: dashW.rows[dashW.rows.findIndex(x => x.id === P.receipt) + n].id });
  });

  const tdlg = $('#targetDlg');
  tdlg.addEventListener('click', (e) => { if (e.target.closest('[data-act="targetCancel"]')) tdlg.close(); });
  tdlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target), over = round2(f.get('override'));
    state.settings.targets = {
      month: round2(f.get('month')),
      override: over > 0 ? { date: isoDate(Date.now()), amount: over } : null,
    };
    saveSettings();
    tdlg.close();
    showToast('Targets saved');
    renderCurrentView();
  });
}

// ---------- Order dialog ----------
// Clicking a transaction row anywhere (dashboard or Sales) opens the receipt behind it.
// ponytail: native <dialog>.showModal() — backdrop, Escape and focus trapping for free,
// and no route of its own, so the peek never costs you your place in the list.
function orderDialogHtml(o) {
  const status = STATUS_TONE[o.status || 'completed'] || STATUS_TONE.completed;
  const row = (label, value) => (value
    ? `<div class="bod-meta-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>` : '');
  const total = (label, value, strong) =>
    `<div class="bod-total-row${strong ? ' strong' : ''}"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
  const cash = o.paymentKind === 'cash' || o.paymentKind === 'split';
  return `
    <div class="bod-head">
      <div class="bod-title">
        <h2>#${escapeHtml(o.number)}</h2>
        <span class="status-pill ${status[0]}">${status[1]}</span>
      </div>
      <button class="bod-close" value="close" aria-label="Close">&times;</button>
    </div>
    <div class="bod-body">
      <div class="bod-meta">
        ${row('Date', escapeHtml(new Date(o.ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })))}
        ${row('Staff', escapeHtml(o.cashier || '—'))}
        ${row('Customer', escapeHtml(o.customer?.name || '—') + (o.customer?.phone ? ` <span class="bod-sub">${escapeHtml(o.customer.phone)}</span>` : ''))}
        ${row('Fulfilment', escapeHtml(orderFulfilLabel(o)))}
        ${row('Deliver to', escapeHtml(o.deliveryAddress))}
        ${row('Payment', `<span class="pay-pill ${escapeHtml(o.paymentKind || 'cash')}">${escapeHtml(orderPaymentLabel(o))}</span>`)}
      </div>
      <div class="table-wrap">
        <table class="data-table bod-items">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${o.items.map(i => `
              <tr>
                <td>${escapeHtml(i.name)}${i.sku ? `<div class="bod-sub">${escapeHtml(i.sku)}</div>` : ''}</td>
                <td class="num">${i.qty} ${escapeHtml(i.unit || 'pc')}</td>
                <td class="num">${peso(i.price)}</td>
                <td class="num">${peso(itemNet(i))}</td>
              </tr>`).join('') || '<tr><td colspan="4" class="bo-empty">No items on this order.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="bod-totals">
        ${total('Subtotal', peso(o.subtotal))}
        ${o.discount ? total('Discount', '−' + peso(o.discount)) : ''}
        ${o.vatAmount ? total('VAT included', peso(o.vatAmount)) : ''}
        ${total('Total', peso(txTotal(o)), true)}
        ${cash && o.tendered ? total('Tendered', peso(o.tendered)) : ''}
        ${cash && o.tendered ? total('Change', peso(o.change)) : ''}
      </div>
    </div>`;
}

function openOrderDialog(id) {
  const o = state.orders.find(x => x.id === id);
  const dlg = $('#orderDlg');
  if (!o || !dlg) return;
  dlg.innerHTML = orderDialogHtml(o);
  dlg.showModal();
}

// ---------- Customers ----------
// One view, two screens: the list, and one account's history. /admin/customers/c-001
// is the history — the id is on the URL, so a link to a customer is shareable.
function renderCustomers() {
  const customer = state.detailId
    ? allCustomerRecords().find(c => c.id === state.detailId)
    : null;
  const detail = $('#custDetail');
  const list = $('#custList');
  const back = $('#custBack');
  if (list) list.hidden = !!customer;
  if (detail) detail.hidden = !customer;
  // The account screen keeps its KPI row; the list has the widget rail and its Widgets menu instead.
  $('#custKpis').style.display = customer ? '' : 'none';
  $('#custWBtn').style.display = customer ? 'none' : '';
  if (back) {
    back.hidden = !customer;
    back.innerHTML = customer
      ? `<a class="link-btn" href="${Router.href('customers', '')}">← All customers</a>` : '';
  }
  return customer ? renderCustomerDetail(customer) : renderCustomerList();
}

/* ---------- Adding and editing an account ----------
   `allCustomerRecords()` reads the stored list ahead of the seeded one, so saving a
   record under an existing id overrides the seed instead of duplicating it. The balance
   is never a field here: it is the sum of what was charged and paid, and typing over it
   would make the ledger and the account disagree. */
function saveCustomerRecord(rec) {
  const list = loadSavedCustomers();
  const i = list.findIndex(c => c.id === rec.id);
  if (i >= 0) list[i] = { ...list[i], ...rec };
  else list.push(rec);
  storageSet(STORAGE_CUSTOMERS, JSON.stringify(list));
  state.customers = list;
}

function openCustomerDialog(id) {
  const dlg = $('#custDlg');
  if (!dlg) return;
  const c = id ? allCustomerRecords().find(x => x.id === id) : null;
  const f = (label, name, value, type = 'text', extra = '') =>
    `<label class="adj-field"><span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeHtml(String(value ?? ''))}" ${extra} autocomplete="off"></label>`;
  dlg.innerHTML = `
    <div class="bod-head">
      <div class="bod-title"><h2>${c ? 'Edit ' + escapeHtml(c.name) : 'New customer'}</h2></div>
      <button type="button" class="bod-close" aria-label="Close">&times;</button>
    </div>
    <div class="adj-body">
      <form class="adj-form" id="custForm" data-id="${escapeHtml(c ? c.id : '')}">
        <div class="adj-grid">
          ${f('Name', 'name', c ? c.name : '', 'text', 'required')}
          ${f('Phone', 'phone', c ? c.phone : '', 'tel')}
          <label class="adj-field adj-note"><span>Address</span>
            <input name="address" type="text" value="${escapeHtml(c ? c.address || '' : '')}" autocomplete="off"></label>
          ${f('Credit limit', 'creditLimit', c ? c.creditLimit || 0 : 0, 'number', 'min="0" step="0.01"')}
        </div>
        <div class="adj-foot">
          <span class="adj-last">0 means no limit: the account can run as far as you let it.</span>
          <button type="button" class="secondary-btn small" data-act="custCancel">Cancel</button>
          <button type="submit" class="primary-btn small">${c ? 'Save' : 'Add customer'}</button>
        </div>
      </form>
    </div>`;
  dlg.showModal();
  dlg.querySelector('input[name="name"]').focus();
}

function custStatus(c) {
  const pct = c.creditLimit > 0 ? c.currentBalance / c.creditLimit : 0;
  return pct === 0 ? ['ok', 'Clear']
       : pct > 0.75 ? ['danger', 'Near limit']
       : pct > 0.4 ? ['warn', 'In use']
       : ['muted', 'Active'];
}

// How often each customer buys (bo-insights.js customerCycles), keyed by id. Lives on Customers,
// not Reports (owner, 2026-09-24): it is a fact about the customer.
const CYCLE_PILL = { overdue: ['danger', 'Overdue'], due: ['warn', 'Due'], ok: ['ok', 'On track'] };
function customerCycleMap() {
  return new Map(HWPOS_INSIGHTS.customerCycles(state.orders, [], Date.now()).map(r => [r.customerId, r]));
}
const cycleEvery = (r) => (r && r.medianGapDays != null ? `~${Math.round(r.medianGapDays)} days` : '—');
const cyclePill = (r) => {
  const p = r && CYCLE_PILL[r.status];
  return p ? `<span class="status-pill ${p[0]}">${p[1]}</span>` : '<span class="muted">—</span>';
};

// The list's figures: a 288px rail beside the table, Sales › Transactions' blocks (bo-calm.css, .calm-cust).
// The Widgets menu shows and hides them; which are off is this device's choice (HWPOS_STORE.ui 'custHide').
const CUST_W = { owed: 'Outstanding credit', pool: 'Credit limit pool', use: 'Utilization', near: 'Near limit' };
const custHidden = () => String(HWPOS_STORE.ui.get('custHide', '') || '').split(',').filter(Boolean);

function renderCustomerList() {
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

  $('#custTitle').textContent = 'Customers';
  const on = Object.keys(CUST_W).filter(id => !custHidden().includes(id));
  const w = {   // [number, note, note class]
    owed: [pesoShort(totalOutstanding), `${active} active debtors`],
    pool: [pesoShort(totalLimit), 'total approved'],
    use: [utilization + '%', 'of total pool'],
    near: [overLimit, '> 75% utilized', overLimit > 0 ? ' down' : ''],
  };
  $('#custW').innerHTML = `<div class="all"><button data-w-all="on">Show all</button><button data-w-all="off">Hide all</button></div><hr>${Object.entries(CUST_W).map(([id, n]) => `<button role="menuitemcheckbox" data-w="${id}" aria-checked="${on.includes(id)}">${n}</button>`).join('')}`;
  $('#custDash').classList.toggle('solo', !on.length);
  $('#custRail').innerHTML = on.map(id => `<section class="card w one"><div class="top band one" title="${escapeHtml(w[id][1])}"><span>${CUST_W[id]}</span>
    <span class="acts"><span class="cnt${w[id][2] || ''}">${escapeHtml(w[id][1])}</span><span class="nv">${w[id][0]}</span></span></div></section>`).join('');

  const pg = paginate(list, Router.route().params.page);
  const cycles = customerCycleMap();
  $('#custPager').innerHTML = pagerHtml(pg);
  $('#custTable tbody').innerHTML = pg.rows.map(c => {
    const status = custStatus(c);
    const cy = cycles.get(c.id);
    return `
      <tr data-customer="${escapeHtml(c.id)}">
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td class="num">${cy ? cy.orders : 0}</td>
        <td class="num">${pesoShort(cy ? cy.revenuePesos : 0)}</td>
        <td>${cy ? escapeHtml(shortDate(cy.lastOrderDate + 'T00:00')) : '—'}</td>
        <td class="num">${cycleEvery(cy)}</td>
        <td>${cyclePill(cy)}</td>
        <td class="num"><strong>${peso(c.currentBalance)}</strong></td>
        <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
      </tr>`;
  }).join('') || `<tr><td colspan="9" class="bo-empty">No customers match.</td></tr>`;
}

const ORDER_STATUS = {
  completed: ['ok', 'Completed'], saved: ['warn', 'Saved'],
  voided: ['danger', 'Voided'], refunded: ['danger', 'Refunded'], return: ['danger', 'Return'],
};

// Every order this account is named on, newest first. Voided and refunded orders stay
// in the list — they are part of what happened — but they don't count toward spend.
function customerOrders(id) {
  return state.orders
    .filter(o => o.customer && o.customer.id === id)
    .sort((a, b) => b.ts - a.ts);
}

/* ---------- The statement ----------
   The workflow this replaces: keep every receipt in a pile, add them up by hand when the
   customer finally pays. A charge is an order with a `credit` payment on it, which the POS
   already writes, so nothing new is recorded - the range is read off the URL and totalled. */
const creditOn = (o) => (o.payments || [])
  .filter(p => p.method === 'credit')
  .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

function statementRows(orders, { from, to, chargesOnly }) {
  // A date input gives a day, and `to` has to include that whole day.
  const lo = from ? new Date(from + 'T00:00').getTime() : -Infinity;
  const hi = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
  return orders.filter(o => {
    if (o.status === 'voided' || o.status === 'refunded') return false;   // never happened, for money
    if (o.ts < lo || o.ts > hi) return false;
    return chargesOnly ? creditOn(o) > 0 : true;
  });
}

function renderCustomerDetail(c) {
  const orders = customerOrders(c.id);
  const counted = orders.filter(o => o.status === 'completed' || o.status === 'saved');
  const spent = counted.reduce((a, o) => a + (o.total || 0), 0);
  const last = orders[0];
  const status = custStatus(c);
  const cy = customerCycleMap().get(c.id);

  $('#custTitle').textContent = c.name;
  $('#custKpis').innerHTML = [
    kpi('Total spent', pesoShort(spent), `${counted.length} order${counted.length === 1 ? '' : 's'}`, 'flat'),
    kpi('Balance', peso(c.currentBalance || 0), `of ${pesoShort(c.creditLimit || 0)} limit`, 'flat'),
    kpi('Average order', pesoShort(counted.length ? spent / counted.length : 0), 'per completed order', 'flat'),
    kpi('Last purchase', last ? shortDate(last.ts) : '—', last ? peso(last.total) : 'no orders yet', 'flat'),
  ].join('');

  // One line per product across every order — what they actually keep buying.
  const byItem = new Map();
  for (const o of counted) {
    for (const i of o.items) {
      const key = i.id || i.name;
      const row = byItem.get(key) || { name: i.name, unit: i.unit, qty: 0, times: 0, spent: 0 };
      row.qty += i.qty;
      row.times += 1;
      row.spent += i.lineTotal != null ? i.lineTotal : i.price * i.qty;
      byItem.set(key, row);
    }
  }
  const items = [...byItem.values()].sort((a, b) => b.spent - a.spent);

  // The statement reads its range off the URL, like every other filter in the back office.
  const p = Router.route().params;
  const stRows = statementRows(orders, { from: p.from, to: p.to, chargesOnly: !p.all });
  const stTotal = stRows.reduce((a, o) => a + (p.all ? (o.total || 0) : creditOn(o)), 0);
  const stBody = stRows.map(o => `
    <tr data-order="${escapeHtml(o.id)}">
      <td>${escapeHtml(shortDate(o.ts))}</td>
      <td><strong>#${escapeHtml(o.number)}</strong></td>
      <td class="num">${o.items.length}</td>
      <td class="num">${creditOn(o) ? peso(creditOn(o)) : '<span class="muted">—</span>'}</td>
      <td class="num"><strong>${peso(o.total)}</strong></td>
    </tr>`).join('') || `<tr><td colspan="5" class="bo-empty">Nothing in this range.</td></tr>`;

  const pg = paginate(orders, Router.route().params.page);
  const txRows = pg.rows.map(o => {
    const st = ORDER_STATUS[o.status] || ['muted', o.status];
    return `
    <tr data-order="${escapeHtml(o.id)}">
      <td>${escapeHtml(shortDate(o.ts))}</td>
      <td><strong>#${escapeHtml(o.number)}</strong></td>
      <td class="num">${o.items.length}</td>
      <td>${escapeHtml(o.paymentMethodLabel || o.paymentMethod || 'cash')}</td>
      <td><span class="status-pill ${st[0]}">${escapeHtml(st[1])}</span></td>
      <td class="num"><strong>${peso(o.total)}</strong></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="bo-empty">No transactions yet.</td></tr>`;

  const itemRows = items.map(i => `
    <tr>
      <td><strong>${escapeHtml(i.name)}</strong></td>
      <td class="num">${i.qty % 1 ? i.qty.toFixed(2) : i.qty} ${escapeHtml(i.unit || '')}</td>
      <td class="num">${i.times}</td>
      <td class="num"><strong>${peso(i.spent)}</strong></td>
    </tr>`).join('') || `<tr><td colspan="4" class="bo-empty">Nothing bought yet.</td></tr>`;

  $('#custDetail').innerHTML = `
    <section class="bo-card">
      <div class="bo-card-head">
        <span class="bo-card-label">${escapeHtml(c.name)}</span>
        <span class="bo-card-sub"><span class="status-pill ${status[0]}">${status[1]}</span></span>
        <button class="secondary-btn small" data-act="custEdit" data-id="${escapeHtml(c.id)}">Edit</button>
      </div>
      <div class="bo-card-inset cust-facts">
        <div><span>Phone</span><b>${escapeHtml(c.phone || '—')}</b></div>
        <div><span>Address</span><b>${escapeHtml(c.address || '—')}</b></div>
        <div><span>Account</span><b>${escapeHtml(c.id)}</b></div>
        <div><span>Available credit</span><b>${peso((c.creditLimit || 0) - (c.currentBalance || 0))}</b></div>
        <div><span>Buys every</span><b>${cycleEvery(cy)}</b></div>
        <div><span>Next order due</span><b>${cy && cy.dueDate ? escapeHtml(shortDate(cy.dueDate + 'T00:00')) + ' ' + cyclePill(cy) : '—'}</b></div>
      </div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head">
        <span class="bo-card-label">Statement</span>
        <input type="date" class="bo-date" data-act="stFrom" value="${escapeHtml(p.from || '')}" />
        <input type="date" class="bo-date" data-act="stTo" value="${escapeHtml(p.to || '')}" />
        <label class="bo-check"><input type="checkbox" data-act="stAll" ${p.all ? 'checked' : ''} /> Include cash sales</label>
        <span class="bo-card-sub">${stRows.length} receipt${stRows.length === 1 ? '' : 's'} · <strong>${peso(stTotal)}</strong></span>
        <button class="secondary-btn small" data-act="stExport">Export CSV</button>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-tx">
          <thead><tr>
            <th>Date</th><th>Receipt</th><th class="num">Items</th>
            <th class="num">Charged</th><th class="num">Receipt total</th>
          </tr></thead>
          <tbody>${stBody}</tbody>
          <tfoot><tr><td colspan="3"><strong>Total</strong></td>
            <td class="num"><strong>${peso(stTotal)}</strong></td>
            <td class="num"><strong>${peso(stRows.reduce((a, o) => a + (o.total || 0), 0))}</strong></td></tr></tfoot>
        </table>
      </div></div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head">
        <span class="bo-card-label">Transactions</span>
        <span class="bo-card-sub">${orders.length} order${orders.length === 1 ? '' : 's'}</span>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-tx">
          <thead><tr>
            <th>Date</th><th>Receipt</th><th class="num">Items</th>
            <th>Payment</th><th>Status</th><th class="num">Total</th>
          </tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>${pagerHtml(pg)}</div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head">
        <span class="bo-card-label">Items bought</span>
        <span class="bo-card-sub">${items.length} product${items.length === 1 ? '' : 's'}</span>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-items">
          <thead><tr>
            <th>Item</th><th class="num">Qty</th><th class="num">Orders</th><th class="num">Spent</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div></div>
    </section>`;
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
  setValue('setPrinterWidth', s.printing.width);
  setChecked('setPrintOnSale', s.printing.printOnSale);
  setChecked('setLogoOnReceipt', s.printing.logoOnReceipt);
}

// ---------- Payments: which cards and fulfilment pills the POS checkout shows ----------
// settings.payments = { hidden: [kind], custom: [name] }, read by applyPayMethods() in app.js;
// settings.fulfilment the same shape, read by applyFulfilMethods(). A custom name is saved on
// the order as its own label, so removing one never touches past sales -- they keep their label.
const PAY_BUILTINS = [
  ['cash', 'Cash', 'Always on. The cash drawer counts it.'],
  ['gcash', 'GCash', ''],
  ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'The cashier types the name at checkout'],
  ['credit', 'Account', 'Charge to a customer. Shows only once a customer is picked.'],
  ['split', 'Split', 'Part cash, the rest on account. Shows only with a customer.'],
];
// Payment methods and fulfilment types are the same card twice: built-ins you switch off,
// your own names you add, one locked entry that can never go. Both write { hidden, custom }.
const METHOD_CARDS = {
  payments: {
    title: 'Payment methods', col: 'Method', locked: 'cash', builtins: PAY_BUILTINS,
    sub: 'The POS picks changes up the next time checkout opens',
    placeholder: 'Add a method, e.g. Maya or Card', saved: 'Payment methods saved',
  },
  fulfilment: {
    title: 'Fulfilment types', col: 'Type', locked: 'pickup', builtins: FULFIL_BUILTINS,
    sub: 'The pills above Check out in the POS cart',
    placeholder: 'Add a type, e.g. Tricycle or Ship-out', saved: 'Fulfilment types saved',
  },
};
const methodConfig = (key) => ({ hidden: [], custom: [], ...(state.settings[key] || {}) });
// Edits go to a draft; nothing reaches the POS until Save. Opening the page drops an unsaved draft.
let methodDraft = {};

function renderPayments() {
  methodDraft = Object.fromEntries(Object.keys(METHOD_CARDS).map((k) => [k, methodConfig(k)]));
  drawPayments();
}

function saveMethodCard(key) {
  state.settings = { ...state.settings, [key]: methodDraft[key] };
  saveSettings();
  drawPayments();
  showToast(METHOD_CARDS[key].saved);
}

function methodCardHtml(key) {
  const card = METHOD_CARDS[key];
  const draft = methodDraft[key];
  const dirty = JSON.stringify(draft) !== JSON.stringify(methodConfig(key));
  const off = new Set(draft.hidden);
  const builtins = card.builtins.map(([k, label, note]) => `
    <tr>
      <td><strong>${escapeHtml(label)}</strong></td>
      <td class="muted">${escapeHtml(note)}</td>
      <td class="num"><input type="checkbox" data-m-kind="${escapeHtml(k)}"${off.has(k) ? '' : ' checked'}${k === card.locked ? ' disabled' : ''}></td>
    </tr>`).join('');
  const custom = draft.custom.map((name, i) => `
    <tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td class="muted">Added by you</td>
      <td class="num"><button class="secondary-btn small" data-m-del="${i}">Remove</button></td>
    </tr>`).join('');
  return `
    <section class="bo-card blk-table full" data-m-card="${key}">
      <div class="bo-card-head"><span class="bo-card-label">${escapeHtml(card.title)}</span>
        <span class="bo-card-sub">${escapeHtml(card.sub)}</span></div>
      <div class="bo-card-inset flush"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>${escapeHtml(card.col)}</th><th>Notes</th><th class="num">Show at checkout</th></tr></thead>
        <tbody>${builtins}${custom}</tbody>
      </table></div></div>
      <div class="bo-card-inset">
        <form class="pay-add" data-m-add style="display:flex;gap:8px;align-items:center">
          <input class="text-input" name="name" maxlength="24" placeholder="${escapeHtml(card.placeholder)}" autocomplete="off" style="max-width:280px">
          <button class="primary-btn small" type="submit">Add</button>
          <span class="muted" data-m-err></span>
        </form>
      </div>
      <div class="bo-card-inset" style="display:flex;gap:12px;align-items:center;justify-content:flex-end">
        <span class="muted">${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button class="primary-btn" data-m-save${dirty ? '' : ' disabled'}>Save</button>
      </div>
    </section>`;
}

function drawPayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  root.innerHTML = `
    <header class="view-head">
      <div class="view-title-wrap"><h1>Payments</h1></div>
    </header>
    <div class="blk-grid">${methodCardHtml('payments')}${methodCardHtml('fulfilment')}</div>`;
}

// One listener per event for both cards; data-m-card says which draft an edit belongs to.
function cardKey(el) {
  return el.closest('[data-m-card]')?.dataset.mCard || '';
}

function wirePayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.mKind;
    const key = cardKey(e.target);
    if (!k || !key || k === METHOD_CARDS[key].locked) return;
    const hidden = new Set(methodDraft[key].hidden);
    if (e.target.checked) hidden.delete(k); else hidden.add(k);
    // Keep built-in order so toggling back and forth reads as "no changes".
    methodDraft[key] = { ...methodDraft[key], hidden: METHOD_CARDS[key].builtins.map(([b]) => b).filter((b) => hidden.has(b)) };
    drawPayments();
  });
  root.addEventListener('click', (e) => {
    const save = e.target.closest('[data-m-save]');
    if (save) { saveMethodCard(cardKey(save)); return; }
    const del = e.target.closest('[data-m-del]');
    if (!del) return;
    const key = cardKey(del);
    methodDraft[key] = { ...methodDraft[key], custom: methodDraft[key].custom.filter((_, i) => i !== Number(del.dataset.mDel)) };
    drawPayments();
  });
  root.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-m-add]')) return;
    e.preventDefault();
    const key = cardKey(e.target);
    const name = e.target.elements.name.value.trim();
    const taken = METHOD_CARDS[key].builtins.map(([, l]) => l).concat(methodDraft[key].custom).some((n) => n.toLowerCase() === name.toLowerCase());
    const err = !name ? 'Type a name first.' : taken ? `${name} is already on the list.` : '';
    if (err) { e.target.querySelector('[data-m-err]').textContent = err; return; }
    methodDraft[key] = { ...methodDraft[key], custom: methodDraft[key].custom.concat(name) };
    drawPayments();
    root.querySelector(`[data-m-card="${key}"] [data-m-add] input`)?.focus();
  });
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
  wirePayments();
  // Sidebar navigation
  // Clicking the page you are on folds or unfolds its tree instead of reloading it; the
  // chevron on any other page peeks its tree open (.open) without leaving this one.
  $$('.side-link[data-view]').forEach(b => {
    b.addEventListener('click', (e) => {
      // On the icon rail there is no tree to fold, so the link just navigates.
      const rail = $('#app').classList.contains('side-rail') && window.matchMedia('(min-width: 1024px)').matches;
      // Only on the page itself: from one of its leaves (By item, Stock history…) the name goes back to it.
      const onLeaf = !!b.nextElementSibling?.querySelector('.side-sublink.active');
      // The chevron always folds its own tree, leaf or not.
      if (b.classList.contains('has-sub') && b.classList.contains('active') && !rail && (!onLeaf || e.target.closest('.side-chev'))) {
        b.classList.remove('open');
        if (b.classList.toggle('folded')) return;
        return shutTrees(b);
      }
      if (e.target.closest('.side-chev')) {
        if (b.classList.toggle('open')) shutTrees(b);
        return;
      }
      shutTrees();
      if (b.dataset.sub) goSub(b.dataset.view, b.dataset.sub.split(' ')[0]); else setView(b.dataset.view);
    });
  });

  // Sales keeps a plain dropdown for the same state.
  $$('.range-select').forEach(sel => sel.addEventListener('change', () => {
    Router.setParams({ range: sel.value === 'today' ? '' : sel.value }, { replace: false });
  }));

  // Any [data-adjust-open] on any page opens the stock adjust dialog (bo-inventory.js).
  // Capture phase: the rows it sits in navigate on click from their own document-level
  // listeners, and stopping it here is the only way to beat those.
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-adjust-open]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    window.openAdjustDialog?.(b.dataset.adjustOpen);
  }, true);

  // Any transaction row, on any page, opens its receipt. Delegated so a page module
  // re-rendering its own table keeps the wiring.
  document.addEventListener('click', (e) => {
    // Closing is the same gesture in every back office dialog, so it is wired once
    // against whichever dialog the click landed in — not against one id.
    const inDlg = e.target.closest('dialog');
    if (inDlg && e.target.closest('.bod-close')) return inDlg.close();
    // Clicking the backdrop lands on the dialog element itself, never on its content.
    if (e.target.tagName === 'DIALOG') return e.target.close();
    const tr = e.target.closest('tr[data-order]');
    if (tr) return openOrderDialog(tr.dataset.order);
    // A customer row is a link to that account's history.
    const cust = e.target.closest('tr[data-customer]');
    if (cust) Router.go('customers', cust.dataset.customer);
  });

  // ----- Customers: add, edit, statement -----
  $('#custAddBtn')?.addEventListener('click', () => openCustomerDialog(''));
  // Widgets: a menu tick — the table glides to its new width (slideRender).
  document.addEventListener('click', (e) => {
    const w = e.target.closest('#custW [data-w], #custW [data-w-all]');
    if (!w) return;
    const id = w.dataset.w, off = custHidden();
    HWPOS_STORE.ui.set('custHide', w.dataset.wAll ? (w.dataset.wAll === 'on' ? '' : Object.keys(CUST_W).join(','))
      : (off.includes(id) ? off.filter(x => x !== id) : [...off, id]).join(','));
    slideRender(renderCustomerList);
  });
  $('#custW')?.addEventListener('toggle', (e) => {   // hang it under its button, right edges flush
    if (e.newState !== 'open') return;
    const m = e.currentTarget, r = $('#custWBtn').getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.left = Math.max(16, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 16)) + 'px';
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !e.target.closest('.view-customers')) return;
    const act = el.dataset.act;
    if (act === 'custEdit') return openCustomerDialog(el.dataset.id);
    if (act === 'custCancel') return $('#custDlg')?.close();
    if (act === 'stExport') {
      const c = allCustomerRecords().find(x => x.id === state.detailId);
      const p = Router.route().params;
      const rows = [['date', 'receipt', 'items', 'charged_to_account', 'receipt_total']];
      statementRows(customerOrders(state.detailId), { from: p.from, to: p.to, chargesOnly: !p.all })
        .forEach(o => rows.push([isoDate(o.ts), o.number, o.items.length, creditOn(o), o.total]));
      const span = [p.from || 'start', p.to || isoDate(Date.now())].join('-to-');
      return downloadCsv(`statement-${(c ? c.name : state.detailId).replace(/\W+/g, '-').toLowerCase()}-${span}.csv`, rows);
    }
  });

  document.addEventListener('change', (e) => {
    if (!e.target.closest('.view-customers')) return;
    const act = e.target.dataset.act;
    if (act === 'stFrom') Router.setParams({ from: e.target.value });
    else if (act === 'stTo') Router.setParams({ to: e.target.value });
    else if (act === 'stAll') Router.setParams({ all: e.target.checked ? '1' : '' });
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'custForm') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const name = String(f.get('name') || '').trim();
    if (!name) return showToast('Name is required');
    const id = e.target.dataset.id;
    const existing = id ? allCustomerRecords().find(c => c.id === id) : null;
    saveCustomerRecord({
      ...(existing || { currentBalance: 0 }),
      id: id || newId('cust'),
      name,
      phone: String(f.get('phone') || '').trim(),
      address: String(f.get('address') || '').trim(),
      creditLimit: round2(f.get('creditLimit')),
    });
    $('#custDlg')?.close();
    showToast(id ? 'Customer saved' : `${name} added`);
    renderCurrentView();
  });

  // "View all →" jumps inside dashboard
  document.addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (!j) return;
    e.preventDefault();
    if (j.dataset.sub) goSub(j.dataset.jump, j.dataset.sub); else setView(j.dataset.jump);
  });

  // Every pager on every page is the same control: it writes ?page= and the route writes
  // it back. Delegated here so no page module has to own paging of its own.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.bo-page-btn');
    if (!b || b.disabled) return;
    Router.setParams({ page: b.dataset.page === '1' ? '' : b.dataset.page });
  });

  // Every search box on every page is the same control: it writes ?q= and the
  // route writes it back. Delegated, so a page module re-rendering its own markup
  // does not lose the wiring.
  // Every keystroke was a route change, and a route change reloads every collection from
  // localStorage and rebuilds the view. With a year of orders that is a multi-megabyte
  // JSON.parse per letter typed, which is why Sales has to put the caret back afterwards.
  // A short pause costs nothing a person notices and collapses a typed word into one render.
  let qTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('q-input')) return;
    const q = e.target.value;
    clearTimeout(qTimer);
    // A narrower search has fewer pages, so page 3 of the old result is meaningless.
    qTimer = setTimeout(() => Router.setParams({ q, page: '' }), 150);
  });

  initDashboard();

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
  $$('#settingsSizeToggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const currentShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
  const showCb = $('#settingsShowPrice');
  if (showCb) showCb.checked = currentShow;

  $$('#settingsSizeToggle .seg-btn').forEach(b => {
    b.addEventListener('click', () => {
      const size = b.dataset.size;
      storageSet(STORAGE_TILE_SIZE, size);
      $$('#settingsSizeToggle .seg-btn').forEach(x => x.classList.toggle('active', x === b));
      showToast(`Tile size set to ${size.toUpperCase()} — Sell screen will update`);
    });
  });
  showCb?.addEventListener('change', (e) => {
    storageSet(STORAGE_SHOW_PRICE, e.target.checked ? '1' : '0');
    showToast(e.target.checked ? 'Prices will show on tiles' : 'Prices hidden on tiles');
  });

  // ----- Settings → Appearance (chart colours) -----
  $$('#settingsChartHue .seg-btn').forEach(b => {
    b.addEventListener('click', () => HWPOS_STORE.ui.set('chartHue', applyChartHue(b.dataset.hue)));
  });

  $$('#settingsChartStyle .seg-btn').forEach(b => {
    b.addEventListener('click', () => HWPOS_STORE.ui.set('chartStyle', applyChartStyle(b.dataset.style)));
  });

  // ----- Settings → Appearance (back office row size) -----
  $$('#settingsDensityToggle .seg-btn').forEach(b => {
    b.addEventListener('click', () => {
      storageSet(STORAGE_DENSITY, applyDensity(b.dataset.density));
    });
  });

  [
    'setStoreName', 'setStoreAddress', 'setStorePhone', 'setCurrency', 'setVatRate', 'setTin',
    'setPrinterWidth',
  ].forEach(id => $('#' + id)?.addEventListener('change', persistSettingsFromForm));
  [
    'setVatRegistered', 'setPrintOnSale', 'setLogoOnReceipt',
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
      $$('#settingsSizeToggle .seg-btn').forEach(b => {
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

// ---------- Row size ----------
// One attribute on <body>; the CSS tokens under it do the rest, so changing size never
// re-renders a table. Applied before the first paint so nothing resizes on screen.
const DENSITIES = ['sm', 'md', 'lg'];

function applyDensity(size) {
  const d = DENSITIES.includes(size) ? size : 'md';
  document.body.dataset.density = d;
  $$('#settingsDensityToggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.density === d));
  return d;
}

// ---------- Chart colours ----------
// Profit's line: violet (default) or the deeper blue. One class on <body>; bo-blocks.css
// re-points --chart-2 under it, so the lines, fades, dots and keys all follow.
function applyChartHue(hue) {
  const h = hue === 'blues' ? 'blues' : 'violet';
  document.body.classList.toggle('chart-blues', h === 'blues');
  $$('#settingsChartHue .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.hue === h));
  return h;
}

// Line (default) or bars. One class on <body>; the calm Dashboard and Sales always draw bars, so nothing reads it now.
function applyChartStyle(style) {
  const v = style === 'bars' ? 'bars' : 'line';
  document.body.classList.toggle('chart-bars', v === 'bars');
  $$('#settingsChartStyle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.style === v));
  return v;
}

// ---------- Init ----------
function init() {
  applyDensity(storageGet(STORAGE_DENSITY, 'md'));
  applyChartHue(HWPOS_STORE.ui.get('chartHue', 'violet'));
  applyChartStyle(HWPOS_STORE.ui.get('chartStyle', 'line'));
  refreshSharedState();
  wireEvents();
  wireSwitchers();
  buildSubnav();
  Router.start(applyRoute);
}

document.addEventListener('DOMContentLoaded', init);
