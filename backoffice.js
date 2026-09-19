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
const STORAGE_ATTENDANCE = 'hwpos.attendance.v1';
// Cash handed to staff before payday. Append-only money rows, so they belong in a backup
// the same way orders do - and so does the attendance they are netted against.
const STORAGE_ADVANCES = 'hwpos.advances.v1';
const STORAGE_STAT_DELTAS = 'hwpos.bo.statDeltas';
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
  STORAGE_ATTENDANCE,
  STORAGE_ADVANCES,
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
    // ponytail: the POS writes "Charge to account"; this table is narrow, so credit keeps our
    // own wording. Every other kind honours the stored label (custom names like "Maya").
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
    fulfilment: raw.fulfilment === 'delivery' ? 'delivery' : 'pickup',
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
  products:  { label: 'Products',  render: () => renderProducts() },
  inventory: { label: 'Inventory', render: () => renderInventory() },
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
  $$('.side-link').forEach(b => b.classList.toggle('active',
    b.dataset.view === view && (b.dataset.sub ? b.dataset.sub.split(' ').includes(cur) : !deep)));
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
  if (sub) {
    $$(`.side-sub[data-view="${view}"] .side-sublink`).forEach(b => {
      b.classList.toggle('active', b.dataset.sub === cur);
      if (b.dataset.sub === cur) b.closest('.side-group')?.querySelector('.side-grouphead').setAttribute('aria-expanded', 'true');
    });
  }
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
  $('#locMark').textContent = store.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
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
const CHEVRON_SVG = '<svg class="side-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
// Sub-pages that have their own sidebar link (data-sub) are left out of the tree. A link may
// own several (data-sub="a b c"): it opens the first and carries all of them as its own tree,
// which is how one view's sub-pages split across several short sidebar entries.
function goSub(view, key) {
  const sub = SUBNAV[view], { params } = Router.route();
  Router.go(view, '', { range: params.range, date: params.date, [sub.param]: key === sub.def ? '' : key });
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
    deepLinks.forEach(l => { const keys = l.dataset.sub.split(' '); if (keys.length > 1) tree(l, keys.map(btn).join('')); });
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
const RANGE_PREV  = { today: 'the day before', '7d': 'prev 7d', '15d': 'prev 15d', '30d': 'prev 30d' };
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
  const arrow = tone === 'up' ? '↑' : tone === 'down' ? '↓' : '';
  return { tone, text: `${arrow}${Math.abs(pct).toFixed(1)}%`, cmp: `vs ${cmp}` };
}

// Per-day buckets ending `offset` days before today.
// ponytail: one range control for everything. Today plots the day hour by hour; 7d/30d plot
// days. Buckets carry their own axis label + tooltip title so the chart stays range-agnostic.
function trendBuckets(range) {
  if (range === 'today') return hourBuckets();
  const days = RANGE_DAYS[range] || 7;
  return dayBuckets(days).map(b => ({
    ...b,
    label: b.date.toLocaleDateString('en-PH', days > 14 ? { month: 'short', day: 'numeric' } : { weekday: 'short' }),
    title: b.date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
  }));
}

function hourBuckets() {
  const base = new Date(state.anchor);
  const out = [];
  for (let h = 0; h < 24; h++) {
    const d = new Date(base);
    d.setHours(h);
    const label = d.toLocaleTimeString('en-PH', { hour: 'numeric' });
    out.push({ date: d, ts: d.getTime(), revenue: 0, profit: 0, items: 0, txns: 0, label, title: label });
  }
  state.orders.forEach(o => {
    const sign = saleSign(o);
    if (!sign) return;
    const d = new Date(o.ts);
    if (d.toDateString() !== base.toDateString()) return;
    const b = out[d.getHours()];
    b.revenue += o.total * sign;
    b.profit += orderProfit(o) * sign;
    b.txns += 1;
    o.items.forEach(it => { b.items += it.qty * sign; });
  });
  return out;
}

function dayBuckets(days, offset = 0) {
  const base = new Date(state.anchor);
  base.setDate(base.getDate() - offset);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push({ date: d, ts: d.getTime(), revenue: 0, profit: 0, items: 0, txns: 0 });
  }
  const idx = new Map(out.map((b, i) => [b.ts, i]));
  state.orders.forEach(o => {
    const sign = saleSign(o);
    if (!sign) return;
    const d = new Date(o.ts);
    d.setHours(0, 0, 0, 0);
    const i = idx.get(d.getTime());
    if (i == null) return;
    const b = out[i];
    b.revenue += o.total * sign;
    b.profit += orderProfit(o) * sign;
    b.txns += 1;
    o.items.forEach(it => { b.items += it.qty * sign; });
  });
  return out;
}

function niceMax(v) {
  if (!(v > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function pesoAxis(n) {
  n = Math.round(n);
  if (n >= 1000000) return '₱' + (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'm';
  if (n >= 1000) return '₱' + (n / 1000).toFixed(n < 10000 && n % 1000 ? 1 : 0) + 'k';
  return '₱' + n;
}

// ponytail: one long bar of cells, not four separate cards — the dashboard is a
// glance, and three numbers side by side read faster than three trays.
// ponytail: the four-up cards on Sales/Inventory/Customers. Same markup the .kpi CSS already
// describes; tone only colours the sub line. Fold into statCell if the two ever want one look.
// `title` carries the comparison ("vs the day before") the way statCell does — spelled out in the
// foot it wrapped onto a second line in every Sales card and pushed the row taller than the value.
function kpi(label, value, sub, tone = 'flat', title = '') {
  return `
    <div class="kpi">
      <div class="kpi-body">
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="kpi-main"><div class="kpi-value">${escapeHtml(String(value))}</div></div>
      </div>
      <div class="kpi-foot">
        <span class="kpi-foot-dot"></span>
        <span class="kpi-delta ${escapeHtml(tone)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(sub)}</span>
      </div>
    </div>`;
}

function statCell({ label, value, unit, delta }) {
  return `
    <div class="stat">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-main">
        <div class="kpi-value">${escapeHtml(String(value))}${unit ? `<span class="kpi-unit">${escapeHtml(unit)}</span>` : ''}</div>
        <span class="kpi-delta ${delta.tone}" title="${escapeHtml(delta.cmp)}">${escapeHtml(delta.text)}</span>
      </div>
    </div>`;
}

// ponytail: profit is always <= revenue, so both series share one axis. No second scale.
function renderLineChart(el, cur) {
  const W = 600, H = 230, n = cur.length;
  const top = niceMax(Math.max(...cur.map(d => d.revenue)));
  const xPct = i => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const X = i => (xPct(i) / 100) * W;
  const Y = v => H - (Math.max(0, v) / top) * H;
  const path = key => cur.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d[key]).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const grid = ticks.map(t => `<line class="lc-grid" x1="0" y1="${(H * t).toFixed(1)}" x2="${W}" y2="${(H * t).toFixed(1)}"/>`).join('');
  const yLabels = ticks.map(t => `<span style="top:${t * 100}%">${pesoAxis(top * (1 - t))}</span>`).join('');
  const bands = cur.map((d, i) => `<div class="lc-band" data-i="${i}" style="left:${xPct(i)}%;width:${100 / n}%"></div>`).join('');
  const step = n > 14 ? Math.ceil(n / 7) : 1;
  const xLabels = cur.map((d, i) => {
    const show = i === n - 1 || i % step === 0;
    return `<span class="${i === n - 1 ? 'on' : ''}" style="left:${xPct(i)}%">${show ? escapeHtml(d.label) : ''}</span>`;
  }).join('');

  el.innerHTML = `
    <div class="lc">
      <div class="lc-y" style="height:${H}px">${yLabels}</div>
      <div class="lc-plot" style="height:${H}px">
        <svg class="lc-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          ${grid}
          <path class="lc-area" d="${path('revenue')} L ${W} ${H} L 0 ${H} Z"/>
          <path class="lc-alt" d="${path('profit')}"/>
          <path class="lc-cur" d="${path('revenue')}"/>
        </svg>
        <div class="lc-guide" hidden></div>
        <div class="lc-dot" hidden></div>
        <div class="lc-tip" hidden></div>
        <div class="lc-bands">${bands}</div>
      </div>
    </div>
    <div class="lc-x">${xLabels}</div>`;

  const plot = el.querySelector('.lc-plot');
  const guide = el.querySelector('.lc-guide');
  const dot = el.querySelector('.lc-dot');
  const tip = el.querySelector('.lc-tip');
  const hide = () => { guide.hidden = dot.hidden = tip.hidden = true; };

  el.querySelector('.lc-bands').addEventListener('mouseover', (e) => {
    const band = e.target.closest('.lc-band');
    if (!band) return;
    const i = Number(band.dataset.i);
    const d = cur[i];
    const x = xPct(i), y = (Y(d.revenue) / H) * 100;
    guide.hidden = dot.hidden = tip.hidden = false;
    guide.style.left = x + '%';
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    tip.style.left = x + '%';
    tip.style.top = y + '%';
    tip.className = 'lc-tip' + (x < 18 ? ' at-left' : x > 82 ? ' at-right' : '');
    tip.innerHTML = `
      <div class="lc-tip-title">${escapeHtml(d.title)} · ${d.txns} receipt${d.txns === 1 ? '' : 's'}</div>
      <div class="lc-tip-row">Revenue <b>${pesoShort(d.revenue)}</b></div>
      <div class="lc-tip-row ghost">Gross profit <b>${pesoShort(d.profit)}</b></div>`;
  });
  plot.addEventListener('mouseleave', hide);
}

function renderDashboard() {
  refreshSharedState();

  const win = rangeWindows();
  const sales = salesIn(win.start, win.end);
  const prevSales = salesIn(win.prevStart, win.prevEnd);
  const cur = metricsOf(sales);
  const prev = metricsOf(prevSales);
  const cmp = state.range === 'today' ? 'the day before' : (RANGE_PREV[state.range] || 'prev period');

  $('#dashGreeting').textContent = `Welcome back, ${state.settings.store?.cashier || 'there'}`;

  $('#rangeBtnLabel').textContent = RANGE_LABEL[state.range] || '';
  $('#rangeBtnDate').textContent = shortDate(state.anchor);
  $('#dashDate').max = isoDate(Date.now());
  $('#dashDate').value = isoDate(state.anchor);
  $$('.rp-opt').forEach(b => b.classList.toggle('on', b.dataset.range === state.range));
  $$('.range-select').forEach(sel => { sel.value = state.range; });

  $('#statRangeLabel').textContent = rangeLabel();
  $('#kpiRow').innerHTML = [
    statCell({
      label: 'Revenue', value: pesoShort(cur.revenue),
      delta: deltaOf(cur.revenue, prev.revenue, cmp),
    }),
    statCell({
      label: 'Gross profit', value: pesoShort(cur.profit),
      delta: deltaOf(cur.profit, prev.profit, cmp),
    }),
    statCell({
      label: 'Transactions', value: cur.txns.toLocaleString('en-PH'),
      delta: deltaOf(cur.txns, prev.txns, cmp),
    }),
  ].join('');

  // Sales trend — revenue against the profit it actually earned, over the selected range
  const trend = trendBuckets(state.range);
  $('#trendRangeLabel').textContent = `revenue vs gross profit`;
  $('.trend-total-label').textContent = rangeLabel();
  $('#trendTotal').textContent = pesoShort(trend.reduce((a, d) => a + d.revenue, 0));
  renderLineChart($('#salesChart'), trend);

  // Low stock
  // isLow() is the one definition of low, shared with Products and Inventory (it also
  // skips archived items, which the card was still listing).
  const belowReorder = state.products.filter(isLow);
  const lows = belowReorder
    .slice()
    .sort((a, b) => (a.stock / (a.reorderPoint || 1)) - (b.stock / (b.reorderPoint || 1)))
    .slice(0, 5);
  $('#lowCount').textContent = `${belowReorder.length} item${belowReorder.length === 1 ? '' : 's'}`;
  $('#lowStockList').innerHTML = lows.length === 0
    ? `<div class="bo-empty">All items above reorder point</div>`
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

  // Deliveries coming — purchase orders still on their way in from a supplier.
  // ponytail: derived, never stored. A PO is "coming" while its status is in PO_INCOMING.
  // This is NOT orders.delivery, which is a customer's order going out.
  const supName = new Map(loadSuppliers().map(x => [x.id, x.name]));
  const incoming = loadPurchaseOrders()
    .filter(po => PO_INCOMING.includes(po.status))
    // Due = the supplier's promised date over our own guess; same rule as the Suppliers page.
    .sort((a, b) => (SUP_RULES.dueDate(a) || '9999').localeCompare(SUP_RULES.dueDate(b) || '9999'));
  const today = isoDate(Date.now());
  $('#deliveryCount').textContent = incoming.length ? `${incoming.length} incoming` : '';
  $('#deliveryList').innerHTML = incoming.length === 0
    ? `<div class="bo-empty">No deliveries scheduled</div>`
    : incoming.slice(0, 5).map(po => {
        const due = SUP_RULES.dueDate(po), late = SUP_RULES.isOverdue(po, today);
        return `
          <a class="mini-list-row${late ? ' danger' : ''}" href="${Router.href('suppliers', po.id)}">
            <div class="ml-left">
              <span class="ml-name">${escapeHtml(supName.get(po.supplierId) || 'Unknown supplier')}</span>
              <span class="ml-sub">${escapeHtml(po.number || po.id)} · ${poOutstanding(po)} to come</span>
            </div>
            <span class="ml-value">${due ? escapeHtml(due) : '—'}${late ? ' · overdue' : ''}</span>
          </a>`;
      }).join('');

  renderAttendance();
  renderTxTable(win);
}

// ponytail: the 7d/30d ranges span days, so a bare clock time is ambiguous — prefix the
// date unless the sale happened today.
function txTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  const today = new Date().toDateString() === d.toDateString();
  return today ? time : `${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}, ${time}`;
}

// The dashboard's Export CSV. Same rows as the table, but unpaged and unsearched: the
// export describes the range in the URL, not the rows that happened to be on screen.
function exportSalesCsv(win = rangeWindows()) {
  const rows = state.orders.filter(o => o.ts >= win.start && o.ts < win.end).sort((a, b) => b.ts - a.ts);
  if (!rows.length) return showToast('Nothing to export in this range.');
  downloadCsv(`sales-${isoDate(win.start)}-to-${isoDate(win.end - 1)}.csv`, [
    ['Receipt', 'Date', 'Customer', 'Cashier', 'Fulfilment', 'Payment', 'Status', 'Items', 'Total'],
    ...rows.map(o => ['#' + o.number, new Date(o.ts).toISOString(), o.customer?.name || '',
      o.cashier || '', o.fulfilment === 'delivery' ? 'Delivery' : 'Walk-in',
      orderPaymentLabel(o), o.status || 'completed',
      o.items.length, Number(o.total || 0).toFixed(2)]),
  ]);
}

// Recent transactions — every status, so voids and refunds are visible.
// Twelve was half a screen and stopped mid-morning on a busy day. The Sales summary
// carries the same list; the Sales > Transactions tab is the one that pages past this.
const RECENT_TX = 25;
function renderTxTable(win = rangeWindows()) {
  const q = (state.txQuery || '').trim().toLowerCase();
  const rows = state.orders
    .filter(o => o.ts >= win.start && o.ts < win.end)
    .sort((a, b) => b.ts - a.ts)
    .filter(o => {
      if (!q) return true;
      const hay = [o.number, o.customer?.name, o.cashier, o.paymentMethodLabel, ...o.items.map(i => i.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    })
    .slice(0, RECENT_TX);

  $('#txTable tbody').innerHTML = rows.length ? rows.map(o => {
    const status = STATUS_TONE[o.status || 'completed'] || STATUS_TONE.completed;
    return `
      <tr class="tx-row ${o.status === 'completed' ? '' : 'dim'}" data-order="${escapeHtml(o.id)}">
        <td class="tx-id">#${escapeHtml(o.number)}</td>
        <td class="tx-time">${escapeHtml(txTime(o.ts))}</td>
        <td>${escapeHtml(o.customer?.name || '—')}</td>
        <td class="tx-staff">${escapeHtml(o.cashier || '—')}</td>
        <td class="tx-fulfil">${o.fulfilment === 'delivery' ? 'Delivery' : 'Walk-in'}</td>
        <td><span class="pay-pill ${escapeHtml(o.paymentKind || 'cash')}">${escapeHtml(o.paymentMethodLabel || 'Cash')}</span></td>
        <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
        <td class="num"><strong>${peso(txTotal(o))}</strong></td>
      </tr>`;
  }).join('') : `<tr><td colspan="8" class="bo-empty">${q ? 'No transactions match that search.' : 'No transactions in this range.'}</td></tr>`;
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
        ${row('Fulfilment', o.fulfilment === 'delivery' ? 'Delivery' : 'Walk-in')}
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

  $('#custSummary').textContent = `${list.length} customer${list.length === 1 ? '' : 's'}`;
  $('#custKpis').innerHTML = [
    kpi('Outstanding credit', pesoShort(totalOutstanding), `${active} active debtors`, 'flat'),
    kpi('Credit limit pool', pesoShort(totalLimit), 'total approved', 'flat'),
    kpi('Utilization', utilization + '%', 'of total pool', 'flat'),
    kpi('Near limit', overLimit, '> 75% utilized', overLimit > 0 ? 'down' : 'flat'),
  ].join('');

  const pg = paginate(list, Router.route().params.page);
  $('#custPager').innerHTML = pagerHtml(pg);
  $('#custTable tbody').innerHTML = pg.rows.map(c => {
    const avail = (c.creditLimit || 0) - (c.currentBalance || 0);
    const status = custStatus(c);
    return `
      <tr data-customer="${escapeHtml(c.id)}">
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td>${escapeHtml(c.address || '—')}</td>
        <td class="num">${pesoShort(c.creditLimit)}</td>
        <td class="num"><strong>${peso(c.currentBalance)}</strong></td>
        <td class="num">${pesoShort(avail)}</td>
        <td><span class="status-pill ${status[0]}">${status[1]}</span></td>
      </tr>`;
  }).join('') || `<tr><td colspan="7" class="bo-empty">No customers match.</td></tr>`;
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

  $('#custSummary').textContent = c.name;
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
      </div>
    </section>
    <section class="bo-card">
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
    <section class="bo-card">
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
    <section class="bo-card">
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

// ---------- Attendance (the dashboard card; the Staff page is bo-staff.js) ----------
const ATTEND_LABEL = {
  present: ['ok', 'Present'], late: ['warn', 'Late'], halfday: ['warn', 'Half day'],
  dayoff: ['muted', 'Day off'], absent: ['danger', 'Absent'],
};

// ponytail: today's marks only, keyed by date in one localStorage blob. No history, no
// timestamps — the staff page can grow a real log when someone needs to look backwards.
function attendanceKey() {
  return isoDate(Date.now());
}

function readAttendance() {
  const all = readJsonStorage(STORAGE_ATTENDANCE, {}) || {};
  return all[attendanceKey()] || {};
}

function renderAttendance() {
  const marks = readAttendance();
  const roster = loadStaff().filter(u => u.active)
    .map(u => ({ ...u, mark: marks[u.name] || u.attendance || 'absent' }));
  const inToday = roster.filter(u => u.mark === 'present' || u.mark === 'late' || u.mark === 'halfday').length;
  $('#attendSummary').textContent = `${inToday} of ${roster.length} in`;
  $('#attendList').innerHTML = roster.map(u => {
    const [tone, label] = ATTEND_LABEL[u.mark] || ATTEND_LABEL.absent;
    return `
      <div class="mini-list-row">
        <div class="ml-left">
          <span class="ml-name">${escapeHtml(u.name)}</span>
          <span class="ml-sub">${escapeHtml(u.role)}</span>
        </div>
        <span class="status-pill ${tone}">${label}</span>
      </div>`;
  }).join('');
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

// ---------- Payments: which cards the POS checkout shows ----------
// settings.payments = { hidden: [kind], custom: [name] }, read by applyPayMethods() in app.js.
// A custom name is saved on the order as a typed "Other" would be, so removing one never
// touches past sales -- they keep their label.
const PAY_BUILTINS = [
  ['cash', 'Cash', 'Always on. The cash drawer counts it.'],
  ['gcash', 'GCash', ''],
  ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'The cashier types the name at checkout'],
  ['credit', 'Account', 'Charge to a customer. Shows only once a customer is picked.'],
  ['split', 'Split', 'Part cash, the rest on account. Shows only with a customer.'],
];
const payConfig = () => ({ hidden: [], custom: [], ...(state.settings.payments || {}) });
// Edits go to a draft; nothing reaches the POS until Save. Opening the page drops an unsaved draft.
let payDraft = null;
function savePayConfig() {
  state.settings = { ...state.settings, payments: payDraft };
  saveSettings();
  drawPayments();
  showToast('Payment methods saved');
}

function renderPayments() {
  payDraft = payConfig();
  drawPayments();
}

function drawPayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  const pay = payDraft;
  const dirty = JSON.stringify(pay) !== JSON.stringify(payConfig());
  const off = new Set(pay.hidden);
  const builtins = PAY_BUILTINS.map(([k, label, note]) => `
    <tr>
      <td><strong>${escapeHtml(label)}</strong></td>
      <td class="muted">${escapeHtml(note)}</td>
      <td class="num"><input type="checkbox" data-pay-kind="${k}"${off.has(k) ? '' : ' checked'}${k === 'cash' ? ' disabled' : ''}></td>
    </tr>`).join('');
  const custom = pay.custom.map((name, i) => `
    <tr>
      <td><strong>${escapeHtml(name)}</strong></td>
      <td class="muted">Added by you</td>
      <td class="num"><button class="secondary-btn small" data-pay-del="${i}">Remove</button></td>
    </tr>`).join('');
  root.innerHTML = `
    <header class="view-head">
      <div class="view-title-wrap"><h1>Payments</h1><span class="muted">What the POS checkout offers</span></div>
    </header>
    <section class="bo-card">
      <div class="bo-card-head"><span class="bo-card-label">Payment methods</span>
        <span class="bo-card-sub">The POS picks changes up the next time checkout opens</span></div>
      <div class="bo-card-inset flush"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Method</th><th>Notes</th><th class="num">Show at checkout</th></tr></thead>
        <tbody>${builtins}${custom}</tbody>
      </table></div></div>
      <div class="bo-card-inset">
        <form class="pay-add" data-pay-add style="display:flex;gap:8px;align-items:center">
          <input class="text-input" name="name" maxlength="24" placeholder="Add a method, e.g. Maya or Card" autocomplete="off" style="max-width:280px">
          <button class="primary-btn small" type="submit">Add</button>
          <span class="muted" data-pay-err></span>
        </form>
      </div>
      <div class="bo-card-inset" style="display:flex;gap:12px;align-items:center;justify-content:flex-end">
        <span class="muted">${dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button class="primary-btn" data-pay-save${dirty ? '' : ' disabled'}>Save</button>
      </div>
    </section>`;
}

function wirePayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.payKind;
    if (!k || k === 'cash') return;
    const hidden = new Set(payDraft.hidden);
    if (e.target.checked) hidden.delete(k); else hidden.add(k);
    // Keep built-in order so toggling back and forth reads as "no changes".
    payDraft = { ...payDraft, hidden: PAY_BUILTINS.map(([b]) => b).filter((b) => hidden.has(b)) };
    drawPayments();
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-pay-save]')) { savePayConfig(); return; }
    const del = e.target.closest('[data-pay-del]');
    if (!del) return;
    payDraft = { ...payDraft, custom: payDraft.custom.filter((_, i) => i !== Number(del.dataset.payDel)) };
    drawPayments();
  });
  root.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-pay-add]')) return;
    e.preventDefault();
    const name = e.target.elements.name.value.trim();
    const taken = PAY_BUILTINS.map(([, l]) => l).concat(payDraft.custom).some((n) => n.toLowerCase() === name.toLowerCase());
    const err = !name ? 'Type a name first.' : taken ? `${name} is already on the list.` : '';
    if (err) { root.querySelector('[data-pay-err]').textContent = err; return; }
    payDraft = { ...payDraft, custom: payDraft.custom.concat(name) };
    drawPayments();
    root.querySelector('[data-pay-add] input')?.focus();
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
  wirePayments();
  // Sidebar navigation
  // Clicking the page you are on folds or unfolds its tree instead of reloading it; the
  // chevron on any other page peeks its tree open (.open) without leaving this one.
  $$('.side-link[data-view]').forEach(b => {
    b.addEventListener('click', (e) => {
      if (b.classList.contains('has-sub') && b.classList.contains('active')) { b.classList.remove('open'); return b.classList.toggle('folded'); }
      if (e.target.closest('.side-chev')) return b.classList.toggle('open');
      $$('.side-link.folded').forEach(x => x.classList.remove('folded'));
      if (b.dataset.sub) goSub(b.dataset.view, b.dataset.sub.split(' ')[0]); else setView(b.dataset.view);
    });
  });

  // Range picker — the span and the day it ends on live in one control.
  // ponytail: the date field inside the menu is native; only the menu itself is ours.
  const rangeMenu = $('#rangeMenu');
  const openRangeMenu = (on) => {
    rangeMenu.hidden = !on;
    $('#rangeBtn').setAttribute('aria-expanded', String(on));
  };
  $('#rangeBtn')?.addEventListener('click', () => openRangeMenu(rangeMenu.hidden));
  $$('.rp-opt').forEach(b => b.addEventListener('click', () => {
    openRangeMenu(false);
    Router.setParams({ range: b.dataset.range === 'today' ? '' : b.dataset.range }, { replace: false });
  }));
  $('#dashDate')?.addEventListener('change', (e) => {
    Router.setParams({ date: e.target.value || '' }, { replace: false });
  });
  document.addEventListener('click', (e) => {
    if (rangeMenu && !rangeMenu.hidden && !e.target.closest('#rangePicker')) openRangeMenu(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openRangeMenu(false); });

  // Sales keeps a plain dropdown for the same state.
  $$('.range-select').forEach(sel => sel.addEventListener('change', () => {
    Router.setParams({ range: sel.value === 'today' ? '' : sel.value }, { replace: false });
  }));

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
    setView(j.dataset.jump);
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

  // ponytail: a view preference, not app state — one key, no re-render needed.
  const deltaBtn = $('#statDeltaToggle');
  const showDeltas = (on) => {
    $('#kpiRow').classList.toggle('show-delta', on);
    deltaBtn.classList.toggle('active', on);
    localStorage.setItem(STORAGE_STAT_DELTAS, on ? '1' : '0');
  };
  if (deltaBtn) {
    deltaBtn.addEventListener('click', () => showDeltas(!deltaBtn.classList.contains('active')));
    showDeltas(localStorage.getItem(STORAGE_STAT_DELTAS) !== '0');
  }

  $('#dashExportBtn')?.addEventListener('click', () => exportSalesCsv());

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

  // ----- Settings → Appearance (back office row size) -----
  $$('#settingsDensityToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      storageSet(STORAGE_DENSITY, applyDensity(b.dataset.density));
    });
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

// ---------- Row size ----------
// One attribute on <body>; the CSS tokens under it do the rest, so changing size never
// re-renders a table. Applied before the first paint so nothing resizes on screen.
const DENSITIES = ['sm', 'md', 'lg'];

function applyDensity(size) {
  const d = DENSITIES.includes(size) ? size : 'md';
  document.body.dataset.density = d;
  $$('#settingsDensityToggle .bb-size-btn').forEach(b => b.classList.toggle('active', b.dataset.density === d));
  return d;
}

// ---------- Init ----------
function init() {
  applyDensity(storageGet(STORAGE_DENSITY, 'md'));
  refreshSharedState();
  wireEvents();
  wireSwitchers();
  buildSubnav();
  Router.start(applyRoute);
}

document.addEventListener('DOMContentLoaded', init);
