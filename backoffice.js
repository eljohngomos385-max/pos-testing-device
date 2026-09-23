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
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return { tone, text: `${sign}${Math.abs(pct).toFixed(1)}%`, cmp: `vs ${cmp}` };
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

// The chart block's plot (bo-blocks.css → CHART), ported from the blocks-v2 lab.
// Drawn in real pixels at the box's width, so text never stretches; redrawn on resize.
// Straight segments between the real points: the curve read as decoration, not data (owner, 2026-09-22).
// ponytail: profit is always <= revenue, so both series share one axis. No second scale.
const SERIES = [['revenue', 'Revenue'], ['profit', 'Gross profit']];
const chartCurve = (P) => P.map((q, i) => `${i ? 'L' : 'M'}${q[0]} ${q[1]}`).join('');
let chartSeq = 0;
function renderLineChart(el, cur) {
  el._cur = cur;
  el._id = el._id || ++chartSeq;
  if (!el._ro) { el._ro = new ResizeObserver(() => el._cur && drawLineChart(el)); el._ro.observe(el); }
  // Keys under the head number double as the switch; the last line showing can't be hidden.
  const keys = el.closest('.bo-card')?.querySelector('.blk-keys');
  if (keys) {
    keys.onclick = (e) => {
      const k = e.target.closest('.blk-key');
      if (!k) return;
      const i = [...keys.children].indexOf(k), off = el.dataset.off;
      if (off === String(i)) delete el.dataset.off;
      else if (off === undefined) el.dataset.off = i;
      else return;
      [...keys.children].forEach((b, j) => b.setAttribute('aria-pressed', String(el.dataset.off !== String(j))));
      drawLineChart(el);
    };
    SERIES.forEach(([key], i) => {
      const b = keys.children[i]?.querySelector('b');
      if (b) b.innerHTML = curHtml(pesoShort(cur.reduce((a, d) => a + d[key], 0)));
    });
  }
  drawLineChart(el);
}
function drawLineChart(el) {
  const cur = el._cur, n = cur.length, NS = 'http://www.w3.org/2000/svg';
  const W = el.clientWidth, H = el.clientHeight, L = 44, B = 22, T = 6;
  if (!W || !H || !n) return;
  const on = SERIES.map((_, i) => String(i) !== el.dataset.off);
  const top = Math.max(4, niceMax(Math.max(...cur.flatMap(d => SERIES.filter((_, i) => on[i]).map(([k]) => d[k])))));
  const x = i => (n <= 1 ? L + (W - L) / 2 : L + (W - L) * i / (n - 1));
  const y = v => T + (H - T - B) * (1 - Math.max(0, v) / top);
  const mk = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return parent.appendChild(e);
  };
  el.innerHTML = '';
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, el);
  for (const v of [0, top / 2, top]) {
    mk('line', { class: 'grid', x1: L, x2: W, y1: y(v), y2: y(v) }, svg);
    mk('text', { class: 'axis', x: 0, y: y(v) + 4 }, svg).textContent = pesoAxis(v);
  }
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 70))));   // a label every ~70px
  cur.forEach((d, i) => {                                             // counted back from the last, so it always shows
    if ((n - 1 - i) % step) return;
    const anchor = n > 1 && i === n - 1 ? 'end' : 'middle';
    mk('text', { class: 'axis', x: x(i), y: H - 4, 'text-anchor': anchor }, svg).textContent = d.label;
  });
  const cross = mk('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' }, svg);
  const dots = [];
  let filled = false;                                                 // only the front line gets the fade: two muddy
  SERIES.forEach(([key], i) => {
    if (!on[i]) return;
    const g = mk('g', { class: 's' + i }, svg);
    const d = chartCurve(cur.map((b, h) => [x(h), y(b[key])]));
    if (!filled && n > 1) {
      filled = true;
      const grad = mk('linearGradient', { id: `fade${el._id}-${i}`, x1: 0, y1: 0, x2: 0, y2: 1 }, mk('defs', {}, g));
      mk('stop', { class: 'fade-top', offset: 0 }, grad); mk('stop', { class: 'fade-bot', offset: 1 }, grad);
      mk('path', { d: d + `L${x(n - 1)} ${y(0)}L${x(0)} ${y(0)}Z`, fill: `url(#fade${el._id}-${i})` }, g);
    }
    mk('path', { class: 'line', d }, g);
    if (!el.hasAttribute('data-still')) for (const [c, r] of [['halo', 10], ['end', 5]])   // marks "now"; a profile has no now
      mk('circle', { class: c, r, cx: x(n - 1), cy: y(cur[n - 1][key]) }, g);
    dots[i] = mk('circle', { class: 'dot', r: 4.5, visibility: 'hidden' }, g);
  });
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.hidden = true; el.appendChild(tip);
  el.onpointermove = (e) => {
    const box = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(n - 1, Math.round((e.clientX - box.left - L) / (W - L) * (n - 1))));
    const d = cur[h];
    cross.setAttribute('x1', x(h)); cross.setAttribute('x2', x(h)); cross.setAttribute('visibility', 'visible');
    dots.forEach((dot, i) => { if (!dot) return;
      dot.setAttribute('cx', x(h)); dot.setAttribute('cy', y(d[SERIES[i][0]])); dot.setAttribute('visibility', 'visible'); });
    tip.innerHTML = `${escapeHtml(d.title)} · ${d.txns} receipt${d.txns === 1 ? '' : 's'}`
      + SERIES.map(([k, name], i) => on[i] ? ` · ${name} <b>${escapeHtml(pesoShort(d[k]))}</b>` : '').join('');
    tip.hidden = false;
    const right = x(h) + 10 + tip.offsetWidth < W;                    // flip left near the right edge
    tip.style.left = (right ? x(h) + 10 : x(h) - 10 - tip.offsetWidth) + 'px';
  };
  el.onpointerleave = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach(dot => dot && dot.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  };
}

// The four KPIs on top. Fixed: the same four in every store, so staff always know where to look.
function renderDashKpis(cur, prev, cmp) {
  $('#dashKpis').innerHTML = [
    statCell({ label: 'Revenue', value: pesoShort(cur.revenue), delta: deltaOf(cur.revenue, prev.revenue, cmp) }),
    statCell({ label: 'Profit', value: pesoShort(cur.profit), delta: deltaOf(cur.profit, prev.profit, cmp) }),
    statCell({ label: 'Transactions', value: cur.txns.toLocaleString('en-PH'), delta: deltaOf(cur.txns, prev.txns, cmp) }),
    statCell({ label: 'Average basket', value: pesoShort(cur.avg), delta: deltaOf(cur.avg, prev.avg, cmp) }),
  ].join('');
}

// ---------- Dashboard rail ----------
// The owner's widgets, one card wide, stacked: every widget is the same width, so nothing can
// misalign. Which ones show, and in what order, is one list in HWPOS_STORE.ui 'dashRail'.
// ponytail: per device like the old dashHidden; per store once settings sync to D1.
const RAIL_DEFAULT = ['daily', 'monthly', 'low', 'pay'];
const bdRow = (nm, amt = '', cmp = '', tone = '') =>
  `<div class="bd-row"><span class="nm">${nm}</span>${amt !== '' ? `<span class="amt">${amt}</span>` : ''}${cmp !== '' ? `<span class="cmp ${tone}">${cmp}</span>` : ''}</div>`;
const railHead = (label, value, side = '') =>
  `<div class="kpi-label">${escapeHtml(label)}</div><div class="kpi-line"><div class="kpi-value">${value}</div>${side}</div>`;
const pctOf = (a, b) => (b > 0 ? Math.round(a / b * 100) : 0);
const meterHtml = (pct, tone = '') =>
  `<div class="meter" role="img" aria-label="${pct}%"><i class="${tone}" style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>`;
const targetSide = (pct) => `<span class="target-pct ${pct >= 100 ? 'up' : ''}">${pct}%</span>`;

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
function targetEmpty(label) {
  return railHead(label, '—') + `<div class="bd-rows">${bdRow('No monthly target yet')}</div>`
    + '<button type="button" class="secondary-btn small rail-set" data-act="targets">Set target</button>';
}
const DOTS = '<button type="button" class="rail-dots" data-act="targets" title="Set targets">···</button>';

const DASH_WIDGETS = {
  daily: ['Daily sales target', (t) => {
    if (!t.daily) return targetEmpty('Daily sales target');
    const pct = pctOf(t.done, t.daily), left = t.daily - t.done;
    return DOTS + railHead('Daily sales target', `${curHtml(pesoShort(t.done))}<span class="of">/${pesoShort(t.daily)}</span>`, targetSide(pct))
      + meterHtml(pct, pct >= 100 ? 'up' : '')
      + `<div class="bd-rows">${left > 0 ? bdRow('Left to sell today', pesoShort(left)) : bdRow('Target hit, over by', pesoShort(-left))}</div>`;
  }],
  monthly: ['Monthly sales target', (t) => {
    if (!t.month) return targetEmpty('Monthly sales target');
    const sold = t.before + t.done, pct = pctOf(sold, t.month), ahead = t.pace >= t.month;
    return DOTS + railHead('Monthly sales target', `${curHtml(pesoShort(sold))}<span class="of">/${pesoShort(t.month)}</span>`, targetSide(pct))
      + meterHtml(pct, pct >= 100 ? 'up' : '')
      + `<div class="bd-rows">${bdRow('On pace for', pesoShort(t.pace), ahead ? 'ahead' : 'behind', ahead ? 'up' : 'down')}</div>`;
  }],
  // The five that run out soonest, by the last 30 days' selling rate; the rest are in Needs buying.
  low: ['Low stock', () => {
    const since = Date.now() - 30 * 864e5, sold = new Map();
    state.orders.forEach(o => {
      if (saleSign(o) > 0 && o.ts >= since) o.items.forEach(i => sold.set(i.id, (sold.get(i.id) || 0) + i.qty));
    });
    const daysLeft = (p) => { const r = (sold.get(p.id) || 0) / 30; return p.stock <= 0 ? 0 : r ? p.stock / r : Infinity; };
    // isLow() is the one definition of low, shared with Products and Inventory.
    const low = state.products.filter(isLow).sort((a, b) => daysLeft(a) - daysLeft(b) || a.stock - b.stock);
    const rows = low.slice(0, 5).map(p => {
      const dl = daysLeft(p), n = Math.max(1, Math.round(dl));
      return bdRow(escapeHtml(p.name), `${Number(p.stock).toLocaleString('en-PH')} ${escapeHtml(p.unit || 'pc')}`,
        dl === 0 ? 'Out' : dl === Infinity ? '—' : `${n} day${n > 1 ? 's' : ''}`, dl <= 3 ? 'down' : '');
    }).join('');
    const more = low.length > 5
      ? `<div class="bd-row total"><span class="nm"><a href="#" data-jump="inventory" data-sub="reorder">+${low.length - 5} more in Needs buying →</a></span></div>` : '';
    return railHead('Low stock', `${low.length.toLocaleString('en-PH')}<span class="of"> ${low.length ? 'below reorder point' : 'all stocked'}</span>`)
      + (low.length ? `<div class="bd-rows">${rows}${more}</div>` : '');
  }],
  // Leads with what was collected, not revenue: revenue is already the first KPI. No label or
  // "on account" note beside it — the Account row below already says both (owner, 2026-09-22).
  // Sums come from the Sales page's own agg(), so they match Sales → Payment methods.
  pay: ['Payment methods', (t, win) => {
    const cur = window.renderSales.agg(state.orders.filter(o => o.ts >= win.start && o.ts < win.end));
    const rows = cur.pays.filter(r => r.sales).sort((x, y) => y.revenue - x.revenue);
    const total = cur.totals.revenue, credit = rows.filter(r => r.kind === 'credit').reduce((a, r) => a + r.revenue, 0);
    return '<a class="blk-cover" href="#" data-jump="sales" aria-label="Open sales"></a>'
      + railHead('Payment methods', curHtml(pesoShort(total - credit)))
      + `<div class="bd-rows">${rows.length
        ? rows.map(r => bdRow(escapeHtml(r.name), pesoShort(r.revenue), pctOf(r.revenue, total) + '%')).join('')
          + `<div class="bd-row total"><span class="nm">Total</span><span class="amt">${pesoShort(total)}</span><span class="cmp">100%</span></div>`
        : '<div class="bo-empty">No sales in this range.</div>'}</div>`;
  }],
  // Purchase orders due today or already late: stock coming in, not the POS's deliveries going out.
  deliveries: ['Deliveries today', () => {
    const today = isoDate(Date.now()), sup = new Map(loadSuppliers().map(s => [s.id, s.name]));
    const dueOn = (po) => SUP_RULES.dayKey(SUP_RULES.dueDate(po));
    const due = loadPurchaseOrders().filter(po => PO_INCOMING.includes(po.status) && dueOn(po) && dueOn(po) <= today);
    const late = due.filter(po => dueOn(po) < today).length;
    return '<a class="blk-cover" href="#" data-jump="suppliers" data-sub="orders" aria-label="Open purchase orders"></a>'
      + railHead('Deliveries today', `${due.length}<span class="of"> arriving</span>`, late ? `<span class="kpi-note down">${late} late</span>` : '')
      + (due.length ? `<div class="bd-rows">${due.slice(0, 5).map(po => {
        const isLate = dueOn(po) < today, n = po.items.length;
        return bdRow(`${escapeHtml(sup.get(po.supplierId) || 'Supplier')} · ${n} item${n === 1 ? '' : 's'}`, '', isLate ? 'Late' : 'Today', isLate ? 'down' : '');
      }).join('')}</div>` : '');
  }],
  stock: ['Stock value', () => {
    const on = state.products.filter(p => !p.archived && p.stock > 0);
    const cost = on.reduce((a, p) => a + p.stock * (Number(p.cost) || 0), 0);
    const retail = on.reduce((a, p) => a + p.stock * (Number(p.price) || 0), 0);
    return railHead('Stock value', `${curHtml(pesoShort(cost))}<span class="of"> at cost</span>`)
      + `<div class="bd-rows">${bdRow('At retail', pesoShort(retail))}${bdRow('Margin on the shelf', pesoShort(retail - cost), pctOf(retail - cost, retail) + '%')}`
      + `${bdRow('Products in stock', on.length.toLocaleString('en-PH'))}</div>`;
  }],
  channel: ['Sales by channel', (t, win) => {
    const fuls = window.renderSales.agg(state.orders.filter(o => o.ts >= win.start && o.ts < win.end)).fuls
      .filter(r => r.revenue > 0).sort((x, y) => y.revenue - x.revenue);
    const total = fuls.reduce((a, r) => a + r.revenue, 0);
    if (!total) return railHead('Sales by channel', '—') + '<div class="bo-empty">No sales in this range.</div>';
    return railHead('Sales by channel', `${pctOf(fuls[0].revenue, total)}%<span class="of"> ${escapeHtml(fuls[0].name.toLowerCase())}</span>`)
      + `<div class="meter split" role="img">${fuls.map((r, i) => `<i class="d${i % 3}" style="width:${r.revenue / total * 100}%"></i>`).join('')}</div>`
      + `<div class="bd-rows">${fuls.map((r, i) => bdRow(`<i class="sw d${i % 3}"></i>${escapeHtml(r.name)}`, pesoShort(r.revenue), pctOf(r.revenue, total) + '%')).join('')}</div>`;
  }],
  // What customers owe on account against the limits the store gave them.
  credit: ['Credit used', () => {
    const cs = allCustomerRecords();
    const owed = cs.reduce((a, c) => a + (c.currentBalance || 0), 0), limit = cs.reduce((a, c) => a + (c.creditLimit || 0), 0);
    const pct = pctOf(owed, limit);
    return '<a class="blk-cover" href="#" data-jump="customers" aria-label="Open customers"></a>'
      + railHead('Credit used', `${curHtml(pesoShort(owed))}<span class="of">/${pesoShort(limit)}</span>`,
        `<span class="target-pct ${pct > 75 ? 'down' : ''}">${pct}%</span>`)
      + meterHtml(pct, pct > 75 ? 'down' : '')
      + `<div class="bd-rows">${bdRow('Available', pesoShort(Math.max(0, limit - owed)))}</div>`;
  }],
};

function railList() {
  const saved = HWPOS_STORE.ui.get('dashRail', null);
  return (saved == null ? RAIL_DEFAULT : String(saved).split(',')).filter(k => DASH_WIDGETS[k]);
}
function renderDashRail(win = rangeWindows()) {
  const rail = $('#dashRail');
  if (!rail) return;
  const list = railList(), t = dashTargets();
  const off = Object.keys(DASH_WIDGETS).filter(k => !list.includes(k));
  rail.innerHTML = list.map((k, i) => `
    <section class="bo-card blk-kpi" data-w="${k}">
      <div class="w-ctl">
        <button type="button" data-move="-1" aria-label="Move up"${i ? '' : ' disabled'}>↑</button>
        <button type="button" data-move="1" aria-label="Move down"${i < list.length - 1 ? '' : ' disabled'}>↓</button>
        <button type="button" data-move="x" aria-label="Remove">×</button>
      </div>
      ${DASH_WIDGETS[k][1](t, win)}
    </section>`).join('') + `
    <section class="bo-card rail-add">
      <div class="kpi-label">Add widget</div>
      ${off.length ? `<div class="rail-add-list">${off.map(k => `<button type="button" class="pbtn" data-add="${k}">+ ${escapeHtml(DASH_WIDGETS[k][0])}</button>`).join('')}</div>`
        : '<div class="kpi-note">Every widget is on the page.</div>'}
    </section>`;
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

// Edit: the main column is fixed; only the rail changes. ↑ ↓ × on each widget, Add widget at the foot.
function initDashEdit() {
  const stack = $('#dashStack'), rail = $('#dashRail'), btn = $('#dashEditBtn'), dlg = $('#targetDlg');
  if (!stack || !rail || !btn || !dlg) return;
  const save = (list) => { HWPOS_STORE.ui.set('dashRail', list.join(',')); renderDashRail(); };
  btn.addEventListener('click', () => {
    const on = stack.classList.toggle('editing');
    btn.textContent = on ? 'Done' : 'Edit';
    btn.setAttribute('aria-pressed', String(on));
  });
  rail.addEventListener('click', (e) => {
    if (e.target.closest('[data-act="targets"]')) return openTargetDialog();
    const list = railList(), add = e.target.closest('[data-add]'), mv = e.target.closest('[data-move]');
    if (add) return save([...list, add.dataset.add]);
    if (!mv) return;
    const i = list.indexOf(mv.closest('[data-w]').dataset.w);
    if (mv.dataset.move === 'x') list.splice(i, 1);
    else { const j = i + Number(mv.dataset.move); [list[i], list[j]] = [list[j], list[i]]; }
    save(list);
  });
  dlg.addEventListener('click', (e) => { if (e.target.closest('[data-act="targetCancel"]')) dlg.close(); });
  dlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target), over = round2(f.get('override'));
    state.settings.targets = {
      month: round2(f.get('month')),
      override: over > 0 ? { date: isoDate(Date.now()), amount: over } : null,
    };
    saveSettings();
    dlg.close();
    showToast('Targets saved');
    renderCurrentView();   // the dashboard rail or the Sales targets block, whichever opened it
  });
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

  renderDashKpis(cur, prev, cmp);

  // Sales trend — revenue against the profit it actually earned, over the selected range
  const trend = trendBuckets(state.range);
  renderLineChart($('#salesChart'), trend);
  renderDashRail(win);

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
      o.cashier || '', orderFulfilLabel(o),
      orderPaymentLabel(o), o.status || 'completed',
      o.items.length, Number(o.total || 0).toFixed(2)]),
  ]);
}

// Recent transactions — every status, so voids and refunds are visible.
// Twelve was half a screen and stopped mid-morning on a busy day. The Sales summary
// carries the same list; the Sales > Transactions tab is the one that pages past this.
const RECENT_TX = 20;
function renderTxTable(win = rangeWindows()) {
  const q = (state.txQuery || '').trim().toLowerCase();
  const all = state.orders
    .filter(o => o.ts >= win.start && o.ts < win.end)
    .sort((a, b) => b.ts - a.ts)
    .filter(o => {
      if (!q) return true;
      const hay = [o.number, o.customer?.name, o.cashier, o.paymentMethodLabel, ...o.items.map(i => i.name)]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  const rows = all.slice(0, RECENT_TX);
  $('#txCount').textContent = all.length ? `${rows.length} of ${all.length}` : '';

  $('#txTable tbody').innerHTML = rows.length ? rows.map(o => {
    const status = STATUS_TONE[o.status || 'completed'] || STATUS_TONE.completed;
    return `
      <tr class="tx-row ${o.status === 'completed' ? '' : 'dim'}" data-order="${escapeHtml(o.id)}">
        <td class="tx-id">#${escapeHtml(o.number)}</td>
        <td class="tx-time">${escapeHtml(txTime(o.ts))}</td>
        <td class="tx-cust" title="${escapeHtml(o.customer?.name || '')}">${escapeHtml(o.customer?.name || '—')}</td>
        <td class="tx-staff">${escapeHtml(o.cashier || '—')}</td>
        <td class="tx-fulfil">${escapeHtml(orderFulfilLabel(o))}</td>
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

  $('#custTitle').textContent = 'Customers';
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
    if (!j || j.closest('#dashStack.editing')) return;
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

  // ponytail: a view preference, not app state — one key, no re-render needed.
  const deltaBtn = $('#statDeltaToggle');
  const showDeltas = (on) => {
    $('#dashStack').classList.toggle('show-delta', on);
    deltaBtn.classList.toggle('active', on);
    localStorage.setItem(STORAGE_STAT_DELTAS, on ? '1' : '0');
  };
  if (deltaBtn) {
    deltaBtn.addEventListener('click', () => showDeltas(!deltaBtn.classList.contains('active')));
    showDeltas(localStorage.getItem(STORAGE_STAT_DELTAS) !== '0');
  }

  $('#dashExportBtn')?.addEventListener('click', () => exportSalesCsv());
  initDashEdit();

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

  // ----- Settings → Appearance (back office row size) -----
  $$('#settingsDensityToggle .seg-btn').forEach(b => {
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

// ---------- Init ----------
function init() {
  applyDensity(storageGet(STORAGE_DENSITY, 'md'));
  applyChartHue(HWPOS_STORE.ui.get('chartHue', 'violet'));
  refreshSharedState();
  wireEvents();
  wireSwitchers();
  buildSubnav();
  Router.start(applyRoute);
}

document.addEventListener('DOMContentLoaded', init);
