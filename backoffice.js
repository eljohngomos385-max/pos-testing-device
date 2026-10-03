/* ==========================================================
   Hardware POS — Back Office
   Vanilla JS dashboard. Reads same localStorage as POS app
   (hwpos.folders.v2 / hwpos.products.v2) so changes stay in sync.
   ========================================================== */

// The key names live once, in data-store.js (HWPOS_STORAGE_KEYS); these globals are what bo-*.js read.
const STORAGE_FOLDERS  = HWPOS_STORAGE_KEYS.folders;
const STORAGE_PRODUCTS = HWPOS_STORAGE_KEYS.products;
const STORAGE_ORDERS   = HWPOS_STORAGE_KEYS.orders;
const STORAGE_GROUPS   = HWPOS_STORAGE_KEYS.groups;
const STORAGE_CUSTOMERS = HWPOS_STORAGE_KEYS.customers;
const STORAGE_CUSTOMER_LEDGER = HWPOS_STORAGE_KEYS.customerLedger;
const STORAGE_SETTINGS = HWPOS_STORAGE_KEYS.settings;
// Who an event row names. ponytail: the store's cashier setting until the back office has a login.
function actor() { return state.settings?.store?.cashier || ''; }
const STORAGE_TILE_SIZE  = HWPOS_STORAGE_KEYS.tileSize;
// How tall a list row is. A display preference belonging to the person reading the
// screen, not to the store — it stays on this device and never syncs.
const STORAGE_DENSITY = 'hwpos.bo.density';
const STORAGE_SHOW_PRICE = HWPOS_STORAGE_KEYS.showPrice;
const STORAGE_THEME = HWPOS_STORAGE_KEYS.theme;
const BACKUP_FORMAT_KEY = 'hwpos.backup.v1';
// Every store list data-store knows (suppliers, purchase orders, the event logs...), so a list added
// there is backed up without a second edit here. Restore clears all of them first: an old backup
// never sits next to today's suppliers or purchase orders. Left out: `role` (who is signed in on
// this device) and the till-event fallback (the stream lives in IndexedDB, not in a backup yet).
// ponytail: till events not in the backup; add an async export/import when data-store has one.
const BACKUP_KEYS = [...new Set([
  ...Object.entries(HWPOS_STORAGE_KEYS)
    .filter(([name]) => !['role', 'tillEventsFallback', 'tillEventsDropped'].includes(name)).map(([, key]) => key),
  STORAGE_CUSTOMERS_MIGRATED, // travels with the data: an old backup has none, so restoring it migrates again
])]; // access, tileSize, showPrice and theme are in HWPOS_STORAGE_KEYS, so they ride along above

// The settings defaults live once, in data-store.js (HWPOS_STORE.defaults / readSettings): the till
// and the back office used to keep a copy each and disagreed on the receipt width.
const state = {
  view: 'dashboard',
  range: 'today',
  // ponytail: one anchor for the whole back office — every range ends on this day, so the
  // date picker and the range dropdown are the same control expressed twice.
  // 0 until applyRoute sets it (it always runs before the first paint); dayStart reads the
  // store's zone from state.settings, which isn't there yet while this literal is built.
  anchor: 0,
  folders: [],
  products: [],
  orders: [],
  customers: [],
  settings: HWPOS_STORE.defaults(),
  detailId: '',
  invQuery: '',
  custQuery: '',
  txQuery: '',
};

// ---------- Helpers ----------
// The minus goes in front of the sign, not between it and the digits: money out of the till
// reads "−₱972.32", never "₱-972.32". Returns and down deltas are the only negatives here.
// The store's currency (Settings › Store), so a US or Japan store reads $ or ¥ with its own decimals.
const storeCurrency = () => state.settings?.store?.currency;
const peso = (n, opts) => SalesMath.formatMoney(n, storeCurrency(), opts);
const pesoShort = (n) => SalesMath.formatMoney(n, storeCurrency(), { whole: true });
// v as a share of `of` (12.3%; '—' when there is nothing to be a share of): every share on every page.
const pctOf = (v, of, dp) => SalesMath.pctText(SalesMath.share(v, of), of, dp);
// Min–max of a family's column, one value when they agree: ₱120.00–₱185.00.
const rangeText = (vals, fmt = peso) => (Math.min(...vals) === Math.max(...vals)
  ? fmt(vals[0]) : `${fmt(Math.min(...vals))}&ndash;${fmt(Math.max(...vals))}`);
// ₱ is a double-barred P. Set at the digits' own size and weight it out-weighs them —
// on a small value like "₱0" the symbol is physically wider than the number it labels,
// so the eye lands on the currency instead of the amount. Demote it: the amount reads
// first and the unit stays legible. Swapping typeface does not help; every face we
// tried (Inter, Plex, Source Sans, Figtree, Segoe, Arial) draws the same crammed glyph.
// ponytail: big values only (.kpi-value). At 13px the symbol already behaves, and
// wrapping the ~150 money sites wholesale would print literal tags at the 29 that
// assign via textContent. Widen by moving a site to innerHTML + curHtml, one at a time.
const curHtml = (s) => {
  const t = String(s), sym = SalesMath.currencySymbol(storeCurrency()), at = t.indexOf(sym);
  return at === 0 || (at === 1 && t[0] === '−')
    ? escapeHtml(t.slice(0, at)) + `<span class="cur">${escapeHtml(sym)}</span>` + escapeHtml(t.slice(at + sym.length)) : escapeHtml(t);
};
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function storageGet(key, fallback = null) {
  try {
    const value = HWPOS_STORE.kv.getItem(key);
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    HWPOS_STORE.kv.setItem(key, value);
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
// The Export CSV button's icon (Sales › Items, Orders).
const DOWNLOAD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 20h16"/></svg>';

// A redraw where the table slides to its new width while the widgets fade in where they stand (owner
// 2026-09-26: no fly-in, and no gap between the two). The table sits above the rail while it narrows over
// that column, so the fade shows through as the table clears it; both land together. Rail cards
// (`data-rail`) that stay glide to their new place; new ones fade in.
function slideRender(render) {
  const dash = () => [...document.querySelectorAll('.dash')].find(d => d.offsetParent);
  // The table column. Transactions lays it out with display: contents (filters and table in the grid), so
  // there it is the children: a contents box has no width to measure or animate.
  const main = d => { const f = d?.firstElementChild; return !f ? [] : getComputedStyle(f).display === 'contents' ? [...f.children] : [f]; };
  const width = ms => Math.max(0, ...ms.map(m => m.offsetWidth));
  const cards = d => new Map([...(d ? d.querySelectorAll('[data-rail]') : [])].map(c => [c.dataset.rail, c.getBoundingClientRect()]));
  const d0 = dash(), from = width(main(d0)), was = cards(d0);
  render();
  const d = dash();
  if (!d || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t = { duration: 260, easing: 'cubic-bezier(.2, 0, 0, 1)' };
  const ms = main(d), to = width(ms);
  if (from && to && from !== to) for (const m of ms) {
    m.style.position = 'relative'; m.style.zIndex = 1;
    m.animate([{ width: from + 'px' }, { width: to + 'px' }], t)
      .finished.finally(() => { m.style.position = m.style.zIndex = ''; });
  }
  for (const c of d.querySelectorAll('[data-rail]')) {
    const r = was.get(c.dataset.rail), now = c.getBoundingClientRect();
    if (!r) c.animate([{ opacity: 0 }, { opacity: 1 }], { ...t, delay: 40, easing: 'ease-out', fill: 'backwards' });
    else if (r.left !== now.left || r.top !== now.top) c.animate([{ transform: `translate(${r.left - now.left}px, ${r.top - now.top}px)` }, { transform: 'none' }], t);
  }
}

// Catalog | Stock and Summary | Items (.pd-switch, owner 2026-09-28): a click routes and re-renders the page, so
// the switch is rebuilt. The click keeps where the thumb was; after the render (paint) the new thumb glides from
// there and what sits below the head fades in. The head itself doesn't move.
let switchFrom = null;
document.addEventListener('click', (e) => {
  const a = !e.button && !(e.ctrlKey || e.metaKey || e.shiftKey) && e.target.closest('.pd-switch .seg-btn:not(.active)');
  const on = a && a.parentNode.querySelector('.active');
  switchFrom = on ? { left: on.offsetLeft, width: on.offsetWidth } : null;
}, true);
function switchSettle() {
  const from = switchFrom; switchFrom = null;
  const sw = from && $('.view.active .pd-switch'), on = sw && sw.querySelector('.active');
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const thumb = document.createElement('span');
  thumb.className = 'pd-glide';
  sw.classList.add('gliding'); sw.prepend(thumb);
  thumb.animate([{ left: from.left + 'px', width: from.width + 'px' }, { left: on.offsetLeft + 'px', width: on.offsetWidth + 'px' }],
    { duration: 200, easing: 'cubic-bezier(.2, 0, 0, 1)', fill: 'forwards' })
    .finished.finally(() => { thumb.remove(); sw.classList.remove('gliding'); });
  const head = sw.closest('.bar, .view-head');
  for (const el of head.parentElement.children) if (el !== head) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
}

// ---------- Widgets menus ----------
// Dashboard, Customers and Sales › Transactions each tick rail cards on and off from a Widgets menu. The rail
// shows them in tick order (owner 2026-09-28): a tick puts the card last, Show all adds the rest in menu order.
// The menu keeps its fixed order so ticks don't jump. Which are on, in order, is this device's choice
// (HWPOS_STORE.ui `<page>Show`); until the first tick the old hide list `<page>Hide` sets it, in menu order.
function widgetsOn(page, W) {
  const ids = Object.keys(W), saved = HWPOS_STORE.ui.get(page + 'Show', null);
  if (saved == null) { const off = String(HWPOS_STORE.ui.get(page + 'Hide', '') || '').split(','); return ids.filter(id => !off.includes(id)); }
  return String(saved).split(',').filter(id => ids.includes(id));
}
const widgetsMenu = (W, on) => `<div class="all"><button data-w-all="on">Show all</button><button data-w-all="off">Hide all</button></div><hr>${Object.entries(W).map(([id, n]) => `<button role="menuitemcheckbox" data-w="${id}" aria-checked="${on.includes(id)}">${n}</button>`).join('')}`;
// A tick on `el` in a Widgets menu: store the new order, then redraw through slideRender().
function widgetsTick(page, W, el, render) {
  const on = widgetsOn(page, W), id = el.dataset.w, all = el.dataset.wAll;
  HWPOS_STORE.ui.set(page + 'Show', (all ? (all === 'on' ? [...on, ...Object.keys(W).filter(x => !on.includes(x))] : [])
    : on.includes(id) ? on.filter(x => x !== id) : [...on, id]).join(','));
  slideRender(render);
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
function pagerHtml(p, key = 'page') {
  if (p.pages < 2) return '';
  const btn = (label, page, cls, off) =>
    `<button class="bo-page-btn${cls}" data-page="${page}"${off ? ' disabled' : ''}>${label}</button>`;
  const nums = pageNumbers(p.page, p.pages).map((n) =>
    (typeof n === 'number' ? btn(n, n, n === p.page ? ' on' : '', false)
                           : '<span class="bo-page-gap">…</span>')).join('');
  return `<div class="bo-pager"${key === 'page' ? '' : ` data-key="${key}"`}>
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

// ---------- Columns menu ----------
// Products' and Suppliers' Columns: tick which columns show. Which are on is this device's choice (a
// storage key per list), not the URL. Cells carry data-col and the table a hide-<key> class per hidden
// column, so CSS does the hiding and a tick never rebuilds a row. `cols` is [[key, label], ...].
function loadColPrefs(key, cols, defaults) {
  const raw = readJsonStorage(key, null);
  return new Set(Array.isArray(raw) ? raw.filter((k) => cols.some(([c]) => c === k)) : defaults);
}
const saveColPrefs = (key, cols, on) => storageSet(key, JSON.stringify(cols.map(([k]) => k).filter((k) => on.has(k))));
const hideColsClass = (cols, on) => cols.filter(([k]) => !on.has(k)).map(([k]) => 'hide-' + k).join(' ');
// `first` is markup for rows above the columns (Products' Show pictures).
function colsMenu(cols, on, first = '') {
  return `
        <details class="pd-cols">
          <summary class="secondary-btn small">Columns</summary>
          <div class="pd-cols-menu check-menu">${first}
            ${cols.map(([k, label]) =>
              `<label class="bo-check"><input type="checkbox" data-col-toggle="${k}"${on.has(k) ? ' checked' : ''}> ${label}</label>`).join('')}
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
// On hand = the movement log's sum (bo-model withStock).
function loadProducts() {
  return withStock(readJsonStorage(STORAGE_PRODUCTS, null) || PRODUCTS.map(p => ({ ...p })));
}
// The one catalog write both apps share (bo-model saveCatalog), which logs every price and cost
// change. `reason` is optional context from the caller.
function saveProducts(reason = '') {
  buildProductIndex();
  return saveCatalog(state.products, { source: 'backoffice', reason, staff: actor() });
}
// Categories are created from two places (the product editor and CSV import) and read from
// four, so the write lives here with the other loaders rather than in a page module.
function saveFolders(list) {
  state.folders = list;
  return storageSet(STORAGE_FOLDERS, JSON.stringify(list));
}
const loadGroups = () => readJsonStorage(STORAGE_GROUPS, null)
  || (typeof SEED_GROUPS !== 'undefined' ? SEED_GROUPS.map((g) => ({ ...g })) : []);
const saveGroups = (list) => storageSet(STORAGE_GROUPS, JSON.stringify(list));
// A readable id while the name is free (cat_paint), a random one when it is not. "Free" includes
// archived products: a deleted category's id stays on them, and a namesake must not inherit them.
function addFolder(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const held = (id) => state.folders.some((f) => f.id === id)
    || state.products.some((p) => p.folder === id || (p.folders || []).includes(id));
  const id = base && !held('cat_' + base) ? 'cat_' + base : newId('cat');
  saveFolders(state.folders.concat(stampRow({ id, name: String(name).trim(), builtin: false })));   // store id + updatedAt
  return id;
}
function loadOrders() {
  const raw = readJsonStorage(STORAGE_ORDERS, []);
  return Array.isArray(raw) ? SalesMath.upgradeOrders(raw.map(r => SalesMath.readOrder(r, { rate: SalesMath.taxOpts(state.settings).rate })).filter(Boolean), boZone()) : [];
}
const loadSettings = () => HWPOS_STORE.readSettings(readJsonStorage(STORAGE_SETTINGS, {}) || {});
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
      folders: readJsonStorage(STORAGE_FOLDERS, []).length || 0,
    },
  };
}

function exportFullBackup() {
  // The file name reads on the store clock, like every date in the back office.
  const now = Date.now(), d = SalesMath.dateParts(now, boZone()), two = (n) => String(n).padStart(2, '0');
  const stamp = `${isoDate(now)}-${two(d.hour)}-${two(d.minute)}-${two(new Date(now).getSeconds())}`;
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
  BACKUP_KEYS.forEach(key => HWPOS_STORE.kv.removeItem(key));
  Object.entries(values).forEach(([key, value]) => HWPOS_STORE.kv.setItem(key, value));
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

// The store's clock (SalesMath): every day boundary, date and time on these pages is the STORE'S,
// never the browser's. These names stay because the bo-*.js pages call them; each is one line over
// SalesMath. `boZone()` reads state.settings at call time, so a Settings change applies at once.
const boZone = () => SalesMath.storeZone(state.settings);
const dayStart = (ts) => SalesMath.dayStartMs(SalesMath.dayKey(+new Date(ts), boZone()), boZone());
const isoDate = (ts) => SalesMath.dayKey(+new Date(ts), boZone());
// n store days later, same time of day (a day start stays a day start across a clock change).
const shiftDays = (ts, n) => { ts = +new Date(ts); return SalesMath.dayStartMs(SalesMath.addDays(isoDate(ts), n), boZone()) + (ts - dayStart(ts)); };
const rangeStart = (range = state.range) => SalesMath.rangeWindow(RANGE_DAYS[range] || 1, state.anchor, boZone()).from;
// exclusive: the day after the anchor
const rangeEnd = () => SalesMath.rangeWindow(1, state.anchor, boZone()).to;

// An order's payment in one word: its tender, 'Split payment', or the store's own method name.
// SalesMath.payWord is the one namer (the till's Orders rail uses it too); bo-sales and
// bo-transactions call this name.
const orderPaymentLabel = (o) => SalesMath.payWord(o);


// ---------- Routing ----------
// The nav, the <title>, and what counts as a valid URL hash — one list.
// One list: the label the nav and <title> use, and the function that paints the view.
// Adding a view is an entry here plus the .side-link / .view markup -- never a second list.
const VIEWS = {
  dashboard: { label: 'Dashboard', render: () => renderDashboard() },
  sales:     { label: 'Sales',     render: () => renderSales() },
  transactions: { label: 'Orders', render: () => renderTransactions() },
  products:  { label: 'Items',  render: () => renderProducts() },
  inventory: { label: 'Stock history', render: () => renderInventory() },
  categories: { label: 'Categories', render: () => renderCategories() },
  modifiers: { label: 'Modifiers', render: () => renderModifiers() },
  customers: { label: 'Customers', render: () => renderCustomers() },
  suppliers: { label: 'Suppliers', render: () => renderSuppliers() },
  insights:  { label: 'Analytics',  render: () => renderInsights() },
  payments:  { label: 'Payments',  render: () => renderPayments() },
  settings:  { label: 'Settings',  render: () => renderSettingsForm() },
};
// A page with sub-pages registers them here ({ param, def, items: [[key, label]] }) and they
// render as a tree under its sidebar link -- the page itself carries no tab strip.
const SUBNAV = globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {};
const viewLabel = (v) => (VIEWS[v] ? VIEWS[v].label : 'Back office');

// The URL is the state. `applyRoute` is the only thing that writes state.view /
// state.range / state.anchor / the search boxes — every control navigates instead
// of mutating, so a pasted link reproduces the screen exactly and back/forward walk
// the filters. Router lives in router.js.
const Router = window.HWPOS_ROUTER;

function applyRoute() {
  const { view, id, params } = Router.route();
  // Staff moved into Settings › Staff & access (2026-09-26); old links land there.
  if (view === 'staff') return Router.go('settings', 'staff', { ...params, person: id }, { replace: true });
  const was = state.view;
  state.view = VIEWS[view] ? view : 'dashboard';
  if (state.view !== was) state.visit = (state.visit || 0) + 1;   // editors drop a draft from an earlier visit
  state.detailId = id || '';
  state.range = RANGE_DAYS[params.range] ? params.range : 'today';
  // A date that doesn't parse is the same as no date: today.
  // The date is a STORE day, so it starts at the store's midnight, not the browser's.
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? SalesMath.dayStartMs(params.date, boZone()) : NaN;
  state.anchor = Number.isFinite(picked) ? dayStart(picked) : dayStart(Date.now());
  // Only one view is on screen, so the three search boxes share one param.
  state.invQuery = state.custQuery = state.txQuery = params.q || '';
  // Each page keeps its own scroll (owner 2026-09-26). .bo-main is one scroller for every page, so
  // one page's offset used to leak into the next. A filter on the same page keeps the place;
  // coming back to a page, by the sidebar or Back, lands where it was left.
  const sub = SUBNAV[state.view], key = `${state.view}/${id}/${sub ? params[sub.param] || '' : ''}`;
  const main = $('.bo-main'), moved = key !== scrollKey;
  if (moved && scrollKey) scrollAt.set(scrollKey, main.scrollTop);
  paint();
  if (moved) { main.scrollTop = scrollAt.get(key) || 0; scrollKey = key; }
}
const scrollAt = new Map();
let scrollKey = '';

// The last page outside Settings: the settings nav's Back returns to it.
let mainRoute = null;
function paint() {
  const view = state.view;
  document.title = `${viewLabel(view)} · EJ Hardware`;
  // A sub-page with its own link lights that link; any other lights the view's plain link.
  const sub = SUBNAV[view];
  const p = sub && Router.route().params[sub.param];
  const cur = sub ? (sub.items.some(([k]) => k === p) ? p : sub.def) : '';
  const deep = !!$(`.side-link[data-view="${view}"][data-sub~="${cur}"]`);
  // Stock history sits in Products' tree, so Products stays lit (tree open) on it.
  const lit = ['inventory', 'categories', 'modifiers'].includes(view) ? 'products' : view;
  const was = $('.side-link.active');
  $$('.side-link').forEach(b => b.classList.toggle('active',
    b.dataset.view === lit && (b.dataset.sub ? b.dataset.sub.split(' ').includes(cur) : !deep)));
  // Back/forward and in-page links move pages without a sidebar click, so they shut stray trees too.
  if ($('.side-link.active') !== was) shutTrees();
  // Settings (and Payments, one of its sections) swap the main nav for the settings nav.
  const inSet = view === 'settings' || view === 'payments';
  if (!inSet) mainRoute = Router.route();
  // Read before the toggles: hiding the focused button blurs it on the spot.
  const wasSet = !$('.side-setnav').hidden, navFocus = $('.bo-sidebar').contains(document.activeElement);
  $('.side-nav:not(.side-setnav)').hidden = inSet;
  $('.side-setnav').hidden = !inSet;
  // ← Back takes the store switcher's slot; the footer's Settings row goes (owner, 2026-09-27).
  $('#locBtn').hidden = inSet;
  $('[data-set-back]').hidden = !inSet;
  $('.side-footer [data-view="settings"]').hidden = inSet;
  const pane = view === 'payments' ? 'payments' : settingsPane();
  $$('.side-setnav [data-set]').forEach(b => b.classList.toggle('active', inSet && b.dataset.set === pane));
  // The button you pressed just hid: focus follows into, or back out of, the settings list.
  if (inSet !== wasSet && navFocus && matchMedia('(min-width: 1024px)').matches)
    (inSet ? $('.side-setnav .side-link.active') : $('.side-footer [data-view="settings"]'))?.focus();
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
    // Categories and Modifiers are views of their own, so their leaves name the view, not a sub.
    const on = b.dataset.view ? b.dataset.view === view
      : !!sub && b.closest('.side-sub').dataset.view === view && b.dataset.sub === cur;
    b.classList.toggle('active', on);
    if (on) b.closest('.side-group')?.querySelector('.side-grouphead').setAttribute('aria-expanded', 'true');
  });
  renderCurrentView();
  switchSettle();
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
    if (b.dataset.view) setView(b.dataset.view); else goSub(b.closest('.side-sub').dataset.view, b.dataset.sub);
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
  state.settings = loadSettings();   // first: upgrading old orders reads the store's day from it
  state.folders  = loadFolders();
  state.products = loadProducts();   // on hand derived from the log, once per refresh
  state.orders = loadOrders();
  state.reversals = SalesMath.reversals(state.orders);   // sale id → its void / refund row
  migrateCustomers();   // once: stored balances become opening rows (bo-model)
  buildProductIndex();
}

// ---------- Dashboard ----------
const RANGE_DAYS  = { today: 1, '7d': 7, '15d': 15, '30d': 30 };
const RANGE_LABEL = { today: 'Today', '7d': 'Last 7 days', '15d': 'Last 15 days', '30d': 'Last 30 days' };

// Dates as people read them, on the store's clock (SalesMath.dateText).
const shortDate = (ts) => SalesMath.dateText(ts, boZone(), 'dayYear');

// "Thu, Oct 1": one picked day, on every date menu's button.
const dayLabel = (ts) => SalesMath.dateText(ts, boZone(), 'weekdayDay');
// The anchor can sit in the past, and "Today" would then be a lie.
function rangeLabel(range = state.range) {
  if (state.anchor === dayStart(Date.now())) return range === 'today' ? 'Today' : RANGE_LABEL[range];
  return range === 'today' ? dayLabel(state.anchor) : `${RANGE_DAYS[range]} days to ${shortDate(state.anchor)}`;
}
// The last row of every date menu (owner 2026-10-02): one day, any day. It sets the shared ?date=;
// each page's change handler also switches its own period to one day, and its presets clear ?date=.
// The picked value as a ?date=: today is no date, so a tab left open still rolls over at midnight.
const dayParam = (v) => (v === isoDate(Date.now()) ? '' : v);
function dayPickRow(ts) {
  const today = dayStart(Date.now());
  return `<hr data-app-only><label class="ends" data-app-only>Pick a day<input type="date" data-day-pick value="${ts && ts !== today ? isoDate(ts) : ''}" max="${isoDate(today)}" /></label>`;
}

// Cost lookup: orders store the sale price, products store the cost.
// ponytail: one Map, rebuilt whenever products change, instead of three linear scans per
// line item. costOf runs this for every item of every order in the range -- over a year
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
  return productIndex.get('i:' + (item.productId || item.id))
    || (item.sku && productIndex.get('s:' + item.sku))
    || productIndex.get('n:' + item.name)
    || null;
}
// The cost the line was sold at, not the cost it would be bought at today. Old receipts
// (and every sale made before app.js started stamping it) fall back to the product.
const costOf = (item) => (item.cost != null ? item.cost : (productFor(item)?.cost || 0));
// A receipt line's amount, as printed. Display only: every SUM goes through ladder() below.
// A receipt line before discounts: the lines add up to the receipt's Subtotal, the discount sits below.
const lineGross = (item) => (item.lineGross != null ? item.lineGross : SalesMath.lineMoney(item.price, item.qty).lineGross);

// ---------- Sales money: one ladder (sales-math.js) behind every figure ----------
// Gross sales − Voids − Refunds − Discounts = Net sales − VAT = Sales before VAT − Cost of goods
// = Gross profit. ladder(orders, { from, to, by }) is the only place the back office adds money up.
const ladder = (orders, opts = {}) => SalesMath.summarize(orders, { costOf, ...opts });
// Units sold per product in the last 30 store days up to the real now: Map id → ladder row
// (.unitsSold). Stock is always today's, so its selling rate is too, whatever day the page picked.
// The Dashboard's Out or low and Items › Sold 30d both read this.
const soldLast30 = (now = Date.now()) => ladder(state.orders, { from: SalesMath.rangeWindow(30, now, boZone()).from, by: (o, i) => productFor(i)?.id || null }).groups;
const saleSign = SalesMath.sign;   // sale +1 · void / refund −1 · parked 0
// A row's state, derived: a sale a void row cancels reads Voided; the void row itself reads Void.
const rowState = (o) => SalesMath.rowState(o, state.reversals);
// What a list ROW shows in its money column: SalesMath.rowAmount (a void or refund handed money back,
// so it prints negative). A parked cart is not money (rowAmount null): '—' on its greyed row (rowDim),
// as on the till's Orders rail and Sales › Orders, and never in a sum.
const txTotal = (o, fmt = peso) => SalesMath.rowAmount(o) == null ? '<span class="mut">—</span>' : fmt(SalesMath.rowAmount(o));

function rangeWindows(range = state.range) {
  const start = rangeStart(range), end = rangeEnd();
  return { start, end, prevStart: shiftDays(start, -(RANGE_DAYS[range] || 1)), prevEnd: start };
}

// ---------- The calm pages (Dashboard, Sales › Summary) ----------
// Ported from dashboard-calm-lab.html / sales-calendar-lab.html; both read these.
// ₱12.3k / ₱1.23M for headline figures, whole pesos under ₱10k.
const pesoK = (n) => SalesMath.formatMoney(n, storeCurrency(), { compact: true });
const hourShort = (h) => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
// "+4.2%" beside a number (SalesMath.changeText); nothing when there is nothing to compare with.
const calmChip = (cur, prev, title) => {
  if (!prev) return '';
  const t = SalesMath.changeText(cur, prev);
  return `<span class="chip ${SalesMath.changeTone(t) || 'flat'}" title="${escapeHtml(title)}">${t}</span>`;
};
// THE margin chip (Dashboard, Sales Summary, Sales › Items): the margin's percent change like every chip, never points
// (owner 2026-10-03). cur/prev are ladders; only when both sold something, '—' beside a −100% chip would claim a drop in nothing.
const marginChip = (cur, prev, title) => (cur.salesBeforeTax > 0 && prev.salesBeforeTax > 0 ? calmChip(cur.margin, prev.margin, title) : '');

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

function statCell({ label, value, unit, delta, note }) {
  const trend = !delta ? ''
    : delta.cmp ? `<span class="trend ${delta.tone}" title="${escapeHtml(delta.cmp)}">${escapeHtml(delta.text)}</span>`
    : `<span class="kpi-note">${escapeHtml(delta.text)}</span>`;   // a note, not a comparison: no chip
  return `
    <div class="bo-card blk-kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-line">
        <div class="kpi-value">${curHtml(value)}${unit ? ` <span class="kpi-note">${escapeHtml(unit)}</span>` : ''}</div>
        ${trend}
      </div>${note ? `
      <div class="kpi-note">${escapeHtml(note)}</div>` : ''}
    </div>`;
}

// Targets are always today and this month, whatever the range says: a target is a promise
// about the calendar, not about the window you happen to be looking at.
// The owner sets the month; today's share is what is left spread over the days left, today
// included, rounded to ₱10. An override replaces it for that one date only.
function dashTargets(now = Date.now()) {
  const t = state.settings.targets || {}, z = boZone();
  // The store's today and month, never the browser's.
  const d = SalesMath.dateParts(now, z), key = isoDate(now), today = dayStart(now);
  const monthStart = SalesMath.dayStartMs(key.slice(0, 8) + '01', z);
  const days = new Date(Date.UTC(d.year, d.month, 0)).getUTCDate();
  const before = ladder(state.orders, { from: monthStart, to: today }).netSales;
  const done = ladder(state.orders, { from: today, to: shiftDays(today, 1) }).netSales;
  const month = Number(t.month) || 0;
  const left = days - d.day + 1;   // ponytail: every day counts as open; skip closed days once store hours exist
  const auto = month ? Math.max(0, Math.round((month - before) / left / 10) * 10) : 0;
  const override = t.override && t.override.date === key ? Number(t.override.amount) || 0 : 0;
  const elapsed = d.day - 1 + (d.hour + d.minute / 60) / 24;
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
          <span class="adj-last">Today's target is what's left of the month over the ${SalesMath.plural(t.left, 'day')} left, today included.</span>
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
const isToday = (ts) => isoDate(ts) === isoDate(Date.now());   // the store's today
const txTime = (ts) => SalesMath.dateText(ts, boZone(), isToday(ts) ? 'time' : 'dayTime');

// ---------- Dashboard (dashboard-calm-lab.html, bo-calm.css) ----------
// The view lives in the URL: ?range= (applyRoute → state.range), ?vs= the comparison, ?chart= the
// KPI the bars show, ?at= an hour ("10") or a day ("2026-09-20"), ?receipt= an order id.
// ?date= (Pick a day) moves the window's end to that day; a past day is read whole, with no "at this time".
const hourLong = (h) => (h % 12 || 12) + (h % 24 < 12 ? ' AM' : ' PM');
const dashDate = (t, o) => new Date(t).toLocaleDateString('en-PH', { ...o, timeZone: boZone() });   // the store's day
// The window, and the one it's compared with: today against the same weekday last week up to
// this minute; N days against the N days before, also up to this minute. Never a half day vs a whole one.
// ?vs= picks another: '' is that default, 'day' is yesterday (today only), 'none' turns the chips off.
function dashCompares(range, today) {   // [key, menu label, days back, chip tooltip]
  const n = RANGE_DAYS[range], wd = dashDate(shiftDays(today, -7), { weekday: 'long' });
  if (range === 'today' && today !== dayStart(Date.now())) {   // a picked past day: whole days, named by date
    const last = dashDate(shiftDays(today, -7), { weekday: 'short', month: 'short', day: 'numeric' });
    return [['', 'Same day last week', 7, `vs ${last}`], ['day', 'The day before', 1, 'vs the day before'], ['none', 'No comparison', 0, '']];
  }
  return (range === 'today'
    ? [['', `Last ${wd}`, 7, `vs last ${wd} at this time`], ['day', 'Yesterday', 1, 'vs yesterday at this time']]
    : [['', `Previous ${n} days`, n, `vs the ${n} days before`]]).concat([['none', 'No comparison', 0, '']]);
}
function dashWindow(range, vs) {
  const today = state.anchor, now = Math.min(Date.now(), shiftDays(today, 1));
  const all = state.orders.filter(o => o.ts < now).sort((a, b) => a.ts - b.ts);
  const between = (a, b) => all.filter(o => o.ts >= a && o.ts < b);
  const cs = dashCompares(range, today), [vsKey, vsLbl, back, vsTitle] = cs.find(c => c[0] === vs) || cs[0];
  const n = RANGE_DAYS[range], start = shiftDays(today, 1 - n);
  const w = { range, now, today, between, compares: cs, vsKey, vs: vsTitle, vsLbl: back ? vsLbl : '',
    rows: between(start, now), prev: back ? between(shiftDays(start, -back), shiftDays(now, -back)) : [] };
  if (range === 'today') {
    // store hours: whatever hours sold in the last four weeks
    const seen = between(shiftDays(today, -28), now).map(o => SalesMath.dateParts(o.ts, boZone()).hour);
    const h0 = seen.length ? Math.min(...seen) : 7, h1 = seen.length ? Math.max(...seen) : 18;
    const lastWd = dashDate(shiftDays(today, -7), { weekday: 'long' });
    w.buckets = [];
    for (let h = h0; h <= h1; h++) w.buckets.push({ key: String(h), x: hourShort(h), title: `${hourLong(h)} – ${hourLong(h + 1)}`,
      start: today + h * 36e5, end: today + (h + 1) * 36e5, backName: `the same hour last ${lastWd}` });
  } else {
    w.buckets = Array.from({ length: n }, (_, i) => { const t = shiftDays(start, i);
      return { key: isoDate(t), x: n > 7 ? String(SalesMath.dateParts(t, boZone()).day) : dashDate(t, { weekday: 'short' }),
        title: dashDate(t, { weekday: 'long', month: 'long', day: 'numeric' }), start: t, end: shiftDays(t, 1),
        backName: dashDate(shiftDays(t, -7), { weekday: 'long', month: 'short', day: 'numeric' }) }; });
  }
  // A same-day void sits in its sale's hour on the bars (SalesMath.chartTime): a 9 am sale voided at
  // 2 pm cancels the 9 am bar instead of pushing 2 pm below zero. Day totals do not move.
  // ponytail: each row's chart time is worked out once per render, then every bar is a plain number scan.
  const saleAt = new Map(state.orders.map(o => [o.id, o.ts]));
  const placed = all.map(o => [o, SalesMath.chartTime(o, saleAt, boZone())]), at = new Map(placed);
  w.at = (o) => at.get(o) ?? SalesMath.chartTime(o, saleAt, boZone());
  w.within = (a, b) => placed.filter(([, t]) => t >= a && t < b).map(([o, t]) => (t === o.ts ? o : { ...o, ts: t }));
  for (const b of w.buckets) { b.future = b.start >= now; b.now = !b.future && now < b.end; b.m = ladder(w.within(b.start, b.end)); }
  return w;
}

// The four headline KPIs (sales-terms: Net sales · Gross profit · Orders · Margin); each is also what
// the bars can show. of() reads a ladder(). The ?chart= keys stay as they were so old links still open.
const dashMargin = (x) => x.margin * 100;
const DASH_KPI = {
  rev: { lbl: 'Net sales',    of: x => x.netSales,    fmt: pesoShort,                      axis: pesoK,              floor: 100 },
  gp:  { lbl: 'Gross profit', of: x => x.grossProfit, fmt: pesoShort,                      axis: pesoK,              floor: 100 },
  n:   { lbl: 'Orders',       of: x => x.orders,      fmt: v => v.toLocaleString('en-PH'), axis: v => +v.toFixed(1), floor: 5 },
  mg:  { lbl: 'Margin',       of: dashMargin,         fmt: v => SalesMath.pctText(v / 100),       axis: v => v + '%',       floor: 10 },
};
function dashStrip(W, chart) {
  const m = ladder(W.rows), p = ladder(W.prev);
  const stat = (k, val, side) =>
    `<button class="stat" role="tab" data-chart="${k}" aria-selected="${chart === k}"><div class="lbl">${DASH_KPI[k].lbl}</div><div class="line"><span class="val">${val}</span>${side}</div></button>`;
  return stat('rev', pesoShort(m.netSales), calmChip(m.netSales, p.netSales, W.vs))
    + stat('gp', pesoShort(m.grossProfit), calmChip(m.grossProfit, p.grossProfit, W.vs))
    + stat('n', m.orders.toLocaleString('en-PH'), calmChip(m.orders, p.orders, W.vs))
    + stat('mg', SalesMath.pctText(m.margin, m.salesBeforeTax), marginChip(m, p, W.vs));
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
      + Object.entries(DASH_KPI).map(([k, x]) => `<span class="${k === chart ? 'on' : ''}">${x.lbl}<em>${b.m.salesBeforeTax || k !== 'mg' ? x.fmt(x.of(b.m)) : '—'}</em></span>`).join('')
      + `</span></i>`
      + `<span class="x${b.now ? ' now' : ''}">${(bs.length - 1 - i) % every && !b.now ? '' : b.x}</span></button>`).join('');
  return `<div class="grid">${grid}</div>`
    + `<div class="cols${bs.length > 8 ? ' many' : ''}" style="grid-template-columns:repeat(${bs.length},minmax(0,1fr))">${cols}</div>`;
}

// Recent transactions: the latest 20 in the range, every status, so voids and refunds show.
// Sales › Transactions is the one that pages past this.
const RECENT_TX = 20;
// What a row SHOWS (SalesMath.statusOf): rowState, with 'part' for a sale partly refunded.
const rowStatus = (o) => SalesMath.statusOf(o, state.reversals);
const statusName = (o) => SalesMath.ROW_LABEL[rowStatus(o)];
// Pill tone per row status; a plain sale has none. Dim = a row that adds nothing (a parked cart, a voided sale).
const ROW_TONE = { voided: 'down', void: 'down', part: 'warn', refunded: 'warn', refund: 'warn', saved: '' };
const rowDim = (o) => (['voided', 'saved'].includes(rowState(o)) ? 'dim' : '');
// Payment pills: one hue per method so cash reads apart from GCash at a glance (owner, 2026-09-26).
// A custom method ('other') takes the tone its name says ("Maya", "Credit card"); anything else is grey.
const PAY_TONES = ['cash', 'gcash', 'maya', 'qr', 'card', 'credit', 'split'];
const payTone = (o) => PAY_TONES.includes(o.paymentKind) ? o.paymentKind
  : PAY_TONES.find(k => orderPaymentLabel(o).toLowerCase().includes(k)) || 'other';
// The Dashboard's Time cell: today's clock, or just the day for an older sale (the full time is its
// title), so eight columns still fit the card at 1280 wide.
const dashTime = (ts) => (isToday(ts) ? txTime(ts) : SalesMath.dateText(ts, boZone(), 'day'));
const payPill = (o) => `<span class="pill pay-${payTone(o)}">${escapeHtml(orderPaymentLabel(o))}</span>`;
// Payment and Status cells, shared with Sales › Transactions and a customer's Transactions. Completed is
// muted text; the exceptions (voided, refunded, saved) are pills.
const txPayStatus = (o) => `<td>${payPill(o)}</td><td class="opt">${statusPill(o) || '<span class="mut">Completed</span>'}</td>`;
// Staff on a list = the SELLER (SalesMath.sellerOf): a void or refund names the original sale's
// seller, the person it counts against (owner 2026-10-02). Who pressed it shows on the receipt.
function dashTx(W) {
  const shown = W.rows.slice().sort(SalesMath.newestFirst).slice(0, RECENT_TX);
  const seller = SalesMath.sellerOf(state.orders, loadStaff());
  return shown.length ? `<div class="flush"><table class="tx">
    <tr><th>Order</th><th>Time</th><th class="opt cust">Customer</th><th class="opt">Staff</th><th class="opt">Fulfilment</th><th>Payment</th><th class="opt">Status</th><th class="n">Total</th></tr>
    ${shown.map(o => `<tr data-receipt="${escapeHtml(o.id)}" class="${rowDim(o)}">
      <td class="id">#${escapeHtml(o.number || o.id)}</td><td class="t" title="${escapeHtml(txTime(o.ts))}">${escapeHtml(dashTime(o.ts))}</td>
      <td class="opt cust"${o.customer?.name ? ` title="${escapeHtml(o.customer.name)}">${escapeHtml(o.customer.name)}` : '><span class="mut">—</span>'}</td>
      <td class="opt">${escapeHtml(seller(o).name || '—')}</td><td class="opt">${escapeHtml(orderFulfilLabel(o))}</td>${txPayStatus(o)}
      <td class="n amt">${txTotal(o)}</td></tr>`).join('')}
  </table></div>` : `<p class="note" style="margin:6px 0 16px">No orders ${W.range !== 'today' ? 'in this range' : W.now === shiftDays(W.today, 1) ? 'on this day' : 'yet today'}.</p>`;
}

// The rail: targets (always today and this month, whatever the range says), low stock, payment methods.
const calmRow = (nm, amt, cmp = null, cls = '') => `<div class="row ${cls}"><span class="nm">${nm}</span><span class="amt">${amt}</span>${cmp !== null ? `<span class="cmp ${cls}">${cmp}</span>` : ''}</div>`;
// The rail's cards. The Widgets menu shows and hides them, like Sales › Transactions; which are off is this
// device's choice, in tick order (widgetsOn 'dash').
const DASH_W = { daily: 'Daily sales target', monthly: 'Monthly sales target', low: 'Out or low stock', pay: 'Payment methods' };

function dashRail(W, on) {
  const t = dashTargets();   // the real today, not a picked day
  const head = (lbl, val, side = '', link = '') => `<div class="top"><span>${lbl}</span>${link}</div><div class="line"><span class="val">${val}</span>${side}</div>`;
  const pctSide = (sold, target) => { const r = SalesMath.share(sold, target);
    return `<span class="pct ${r >= 1 ? 'up' : ''}">${SalesMath.pctText(r, target, 0)}</span>`; };
  const empty = lbl => head(lbl, '—') + `<button class="set">Set target</button><div class="rows foot">${calmRow('No monthly target yet', '')}</div>`;
  const out = {};
  out.daily = () => {
    if (!t.daily) return empty('Daily sales target');
    const left = t.daily - t.done;
    return head('Daily sales target', `${pesoShort(t.done)}<span class="of">/${pesoShort(t.daily)}</span>`, pctSide(t.done, t.daily))
      + `<div class="rows foot">${left > 0 ? calmRow('Left to sell today', pesoShort(left)) : calmRow('Target hit, over by', pesoShort(-left))}</div>`;
  };
  out.monthly = () => {
    if (!t.month) return empty('Monthly sales target');
    const sold = t.before + t.done, left = t.month - sold;
    return head('Monthly sales target', `${pesoK(sold)}<span class="of">/${pesoK(t.month)}</span>`, pctSide(sold, t.month))
      + `<div class="rows foot">${left > 0 ? calmRow('Left to sell this month', pesoK(left)) : calmRow('Target hit, over by', pesoK(-left))}</div>`;
  };

  // Out or low: the items that need buying -- bo-model stockCounts, one per family, the same count as
  // the Items page's Out + Low filter -- the five that run out first by the last 30 days' selling. A
  // family shows once, by its variant that runs out first, with the family's level.
  out.low = () => {
    const sold = soldLast30();
    const daysLeft = p => { const r = (sold.get(p.id)?.unitsSold || 0) / 30; return p.stock <= 0 ? 0 : r ? p.stock / r : Infinity; };
    const live = state.products.filter(p => !p.archived), fam = p => p.groupId || p.id, seen = new Set();
    const n = stockCounts(live, null, Date.now(), boZone()), count = n.out + n.low;
    const low = live.filter(p => ['out', 'low'].includes(stockLevel(p, null, Date.now(), boZone()))).sort((a, b) => daysLeft(a) - daysLeft(b) || a.stock - b.stock)
      .filter(p => !seen.has(fam(p)) && seen.add(fam(p)));
    const level = p => familyLevel(live.filter(x => fam(x) === fam(p)), null, Date.now(), boZone());
    return head('Out or low stock', count ? String(count) : `0<span class="of"> all stocked</span>`, '',
        count ? `<a href="${Router.href('products', '', { view: 'stock', level: 'out,low' })}">View all ›</a>` : '')
      + (low.length ? `<div class="rows">${low.slice(0, 5).map(p => `<div class="row"><span class="nm">${escapeHtml(p.name)}</span>`
        + `<span class="pill ${level(p) === 'out' ? 'down' : 'warn'}" style="margin:0">${level(p) === 'out' ? 'Out' : 'Low'}</span></div>`).join('')}</div>` : '');
  };

  // Payment methods, for the range: the only rail card that follows it.
  out.pay = () => {
    const payRows = byPayment(W.rows);
    return `<div class="top band"><span>Payment methods</span></div>` + (payRows.length
      ? `<div class="rows">${payRows.map(([k, v]) => calmRow(escapeHtml(k), pesoShort(v))).join('')}${calmRow('Total', pesoShort(payRows.reduce((s, p) => s + p[1], 0)), null, 'total')}</div>`
      : '<p class="note" style="margin:10px 0 0">No sales in this range.</p>');
  };
  return on.map(id => `<section class="card w" data-rail="${id}">${out[id]()}</section>`).join('');
}

// The pop-up: one bar (hour or day), or one receipt. ‹ › step through the live bars or the range's receipts.
const popSec = (lbl, body, side = '') => `<div class="p-sec"><div class="lbl">${lbl}<span>${side}</span></div>${body}</div>`;
const popTop = (title, prev, next) => `<div class="p-top"><h2>${title}</h2>
  <button class="icon-btn" data-step="-1" aria-label="Previous" ${prev ? '' : 'disabled'}>‹</button>
  <button class="icon-btn" data-step="1" aria-label="Next" ${next ? '' : 'disabled'}>›</button>
  <button class="icon-btn" data-close aria-label="Close">✕</button></div>`;
// Money in per payment method (what reached the drawer, refunds out), biggest first. SalesMath.tenders
// is the one count: a split sale is its legs (cash + account), never a "Split" bucket.
const byPayment = (rows) => [...SalesMath.tenders(rows)]
  .map(([k, v]) => [SalesMath.tenderLabel(k), v]).filter(p => p[1]).sort((x, y) => y[1] - x[1]);
const statusPill = (o) => { const s = rowStatus(o); return s === 'sale' ? '' : `<span class="pill ${ROW_TONE[s]}">${SalesMath.ROW_LABEL[s]}</span>`; };
const clockOf = (t) => SalesMath.dateText(t, boZone(), 'time');   // the store clock, not this browser's
const liveBars = (W) => W.buckets.filter(b => !b.future);
function barPop(W, b) {
  const rows = W.rows.filter(o => W.at(o) >= b.start && W.at(o) < b.end), m = b.m;   // the bar's rows, voids in their sale's hour
  const p = ladder(W.within(shiftDays(b.start, -7), Math.min(shiftDays(b.end, -7), shiftDays(W.now, -7))));
  const L = liveBars(W), i = L.indexOf(b);
  let html = popTop(b.title, i > 0, i < L.length - 1)
    + `<div class="p-head"><span class="val">${pesoShort(m.netSales)}</span>${calmChip(m.netSales, p.netSales, 'vs ' + b.backName + (b.now ? ' at this time' : ''))}</div>`
    + `<p class="p-sub">${SalesMath.plural(m.orders, 'order')} · ${pesoShort(m.grossProfit)} gross profit${b.now ? ' · so far' : ''}</p>`;
  if (!rows.length) return html + '<p class="p-sub" style="margin-top:20px">No sales.</p>';
  html += popSec('Payment methods', `<div class="rows">${byPayment(rows).map(([k, v]) => calmRow(escapeHtml(k), pesoShort(v), pctOf(v, m.collected))).join('')}</div>`);
  const its = renderSales.topItems(rows);
  html += popSec('Top items', `<div class="rows">${its.slice(0, 5).map(r => calmRow(escapeHtml(r.name), pesoShort(r.netSales), pctOf(r.netSales, m.netSales))).join('')}</div>`, `${SalesMath.plural(SalesMath.itemsSold(its), 'item')} sold`);
  // The list holds every receipt (sales, voids, refunds, parked carts); "Orders" above counts sales only
  // (sales-terms), so the side note counts receipts, the customer page's word for the same list.
  html += popSec('Orders', `<div class="rows">${rows.slice().sort(SalesMath.newestFirst).slice(0, PAGE_ROWS).map(o => `<button class="row ${rowDim(o)}" data-receipt="${escapeHtml(o.id)}"><span class="t">${clockOf(o.ts)}</span>`
    + `<span class="nm">#${escapeHtml(o.number || o.id)} · ${escapeHtml(orderPaymentLabel(o))}${statusPill(o)}</span><span class="amt">${txTotal(o, pesoShort)}</span></button>`).join('')}</div>`, SalesMath.plural(rows.length, 'receipt'));
  return html;
}
// A void or refund shows like the slip it reverses, every figure as printed; its pill says Void or
// Refund. The list row it opens from carries the minus (txTotal), never half the pop-up.
// What both receipt views say beyond the lines, from SalesMath.receiptParts (the slip's own words):
// the VOID / REFUND of #… mark, the SC/PWD lines, the seller (who the row counts for, as on every
// list) and, on a reversal, who pressed it ("Voided by Mara").
function slipOf(o) {
  const sale = o.originalOrderId ? state.orders.find(x => x.id === o.originalOrderId) : null;
  const parts = SalesMath.receiptParts(o, sale, state.reversals);
  const seller = SalesMath.sellerOf(state.orders, loadStaff())(o).name;
  const presser = parts.mark && o.cashier ? `${parts.whoWord} ${o.cashier}` : '';
  // The totals block, row for row the till's pop-up and the paper slip (SalesMath.totalRows).
  const totals = SalesMath.totalRows({ totals: o, scPwd: parts.scPwd, taxName: SalesMath.taxName({ ...state.settings, taxOnTop: !o.taxIncluded }) });
  // Under Total: Paid / Given back and Change, SalesMath.paidOf as on the till's pop-up (none for a parked cart).
  const pay = SalesMath.paidOf(o);
  const paid = pay ? [[`${parts.paidWord} (${SalesMath.payWord(o)})`, pay.paid], ...(pay.change > 0 ? [['Change', pay.change]] : [])] : [];
  return { ...parts, seller, presser, totals, paid };
}
// What is still owed on a sale today, from the customer's ledger (bo-model debtStatusOf): an account
// sale paid off since says nothing. Both receipt views read this.
function owedWord(o) {
  const id = rowState(o) === 'sale' && SalesMath.customerIdOf(o);
  const s = id && debtStatusOf(o.id, accountRows(id));
  return s === 'Unpaid' || s === 'Part paid' ? s : '';
}
function receiptPop(W, o) {
  const i = W.rows.indexOf(o), its = o.items || [], slip = slipOf(o);
  let html = popTop(`Order #${escapeHtml(o.number || o.id)}`, i > 0, i >= 0 && i < W.rows.length - 1)
    + `<div class="p-head"><span class="val">${peso(o.total)}</span>${statusPill(o)}</div>`
    + `<p class="p-sub">${[slip.mark, txTime(o.ts), slip.seller || '—', slip.presser, orderFulfilLabel(o), orderPaymentLabel(o), o.customer?.name]
      .filter(Boolean).map(escapeHtml).join(' · ')}</p>`;
  html += popSec('Items', `<div class="rows">${its.map(it => calmRow(`${escapeHtml(it.name)}<small>${SalesMath.qtyText(it.qty)} × ${peso(it.price)}</small>`, peso(lineGross(it)))).join('')}</div>`, SalesMath.plural(its.length, 'line'));
  html += popSec('Totals', `<div class="rows">
    ${slip.totals.map(([label, amount]) => calmRow(escapeHtml(label), peso(amount))).join('')}
    ${calmRow('Total', peso(o.total), null, 'total')}
    ${slip.paid.map(([label, amount]) => calmRow(escapeHtml(label), peso(amount))).join('')}</div>`,
    saleSign(o) ? '' : 'Not counted in sales');
  const owed = owedWord(o);
  if (owed) html += `<p class="p-sub" style="margin-top:10px"><span class="pill warn" style="margin:0">${owed}</span> On the customer’s account.</p>`;
  return html;
}

let dashW = null;   // the window last painted; the click wiring steps through it
function renderDashboard() {
  refreshSharedState();
  const P = Router.route().params, W = dashW = dashWindow(state.range, P.vs || '');
  const chart = DASH_KPI[P.chart] ? P.chart : 'rev';
  const opt = (attr, v, lbl, on) => `<button role="menuitemradio" ${attr}="${v}" aria-checked="${on}">${lbl}</button>`;
  $('#dashGreeting').textContent = `Welcome back, ${state.settings.store?.cashier || 'there'}`;
  $('#dashPick').innerHTML = escapeHtml(rangeLabel(W.range)) + (W.vsLbl ? `<span class="vs">vs ${W.vsLbl[0].toLowerCase() + W.vsLbl.slice(1)}</span>` : '');
  $('#dashRange').innerHTML = Object.keys(RANGE_DAYS).map(r => opt('data-range', r, RANGE_LABEL[r], r === W.range)).join('')
    + '<hr><h3>Compare to</h3>' + W.compares.map(c => opt('data-vs', c[0], c[1], c[0] === W.vsKey)).join('')
    + dayPickRow(W.range === 'today' && W.today);
  $('#dashStrip').innerHTML = dashStrip(W, chart);
  $('#dashPlot').innerHTML = dashPlot(W, chart);
  $('#dashTx').innerHTML = dashTx(W);
  $('#dashTxAll').href = Router.href('transactions', '', { range: P.range || '', date: P.date || '' });
  const on = widgetsOn('dash', DASH_W);
  $('#dashW').innerHTML = widgetsMenu(DASH_W, on);
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
      Router.setParams({ range: r === 'today' ? '' : r, vs: dashCompares(r, dayStart(Date.now())).some(c => c[0] === vs) ? vs : '', date: '', at: '', receipt: '' });
    } else open({ vs: b.dataset.vs });
  });
  menu.addEventListener('change', (e) => {
    if (!e.target.matches('[data-day-pick]')) return;
    menu.hidePopover();
    Router.setParams({ range: '', date: dayParam(e.target.value), at: '', receipt: '' }, { replace: false });
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
    if (w) widgetsTick('dash', DASH_W, w, renderDashboard);
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
  const tone = { sale: 'ok', voided: 'danger', void: 'danger', part: 'warn', refunded: 'warn', refund: 'warn', saved: 'muted' }[rowStatus(o)];
  const row = (label, value) => (value
    ? `<div class="bod-meta-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>` : '');
  const total = (label, value, strong) =>
    `<div class="bod-total-row${strong ? ' strong' : ''}"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
  const slip = slipOf(o), owed = owedWord(o);   // the receipt pop-up's own words and pill
  return `
    <div class="bod-head">
      <div class="bod-title">
        <h2>#${escapeHtml(o.number)}</h2>
        <span class="status-pill ${tone}">${statusName(o)}</span>
        ${owed ? `<span class="status-pill warn">${owed}</span>` : ''}
        ${slip.mark ? `<span class="bod-sub">${escapeHtml(slip.mark)}</span>` : ''}
      </div>
      <button class="bod-close" value="close" aria-label="Close">&times;</button>
    </div>
    <div class="bod-body">
      <div class="bod-meta">
        ${row('Date', escapeHtml(`${shortDate(o.ts)}, ${clockOf(o.ts)}`))}
        ${row('Staff', escapeHtml(slip.seller || '—'))}
        ${slip.mark ? row(slip.whoWord, escapeHtml(o.cashier)) : ''}
        ${row('Approved by', escapeHtml(staffNameOf(o.approvedBy) || o.approvedBy))}
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
                <td class="num">${SalesMath.qtyText(i.qty)} ${escapeHtml(i.unit || 'pc')}</td>
                <td class="num">${peso(i.price)}</td>
                <td class="num">${peso(lineGross(i))}</td>
              </tr>`).join('') || '<tr><td colspan="4" class="bo-empty">No items on this order.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="bod-totals">
        ${slip.totals.map(([label, amount]) => total(label, peso(amount))).join('')}
        ${total('Total', peso(o.total), true)}
        ${slip.paid.map(([label, amount]) => total(label, peso(amount))).join('')}
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
  // The account screen has its figures in its first card; the list has them in its strip.
  $('#custAddBtn').style.display = customer ? 'none' : '';   // the account page edits; adding is the list's
  if (back) {
    back.hidden = !customer;
    back.innerHTML = customer
      ? `<a class="link-btn" href="${Router.href('customers', '')}">← All customers</a>` : '';
  }
  return customer ? renderCustomerDetail(customer) : renderCustomerList();
}

/* ---------- Adding and editing an account ----------
   The fields, the words and the check are bo-model's CUSTOMER_FIELDS / customerFromForm, the
   same form the POS shows. The balance is never a field: it is the sum of the ledger. */
function openCustomerDialog(id) {
  const dlg = $('#custDlg');
  if (!dlg) return;
  const c = id ? allCustomerRecords().find(x => x.id === id) : null;
  const wrap = (f, control) => `<label class="adj-field${f.wide ? ' adj-note' : ''}"><span>${f.label}</span>${control}</label>`;
  dlg.innerHTML = `
    <div class="bod-head">
      <div class="bod-title"><h2>${c ? 'Edit ' + escapeHtml(c.name) : 'New customer'}</h2></div>
      <button type="button" class="bod-close" aria-label="Close">&times;</button>
    </div>
    <div class="adj-body">
      <form class="adj-form" id="custForm" data-id="${escapeHtml(c ? c.id : '')}" novalidate>
        <div class="adj-grid">${customerFieldsHtml(c || {}, { wrap })}</div>
        <div class="adj-foot">
          <span class="adj-last" id="custErr"></span>
          <button type="button" class="secondary-btn small" data-act="custCancel">Cancel</button>
          <button type="submit" class="primary-btn small">${c ? 'Save' : 'Add customer'}</button>
        </div>
      </form>
    </div>`;
  dlg.showModal();
  dlg.querySelector('[name="name"]').focus();
}

/* Record payment (owner 2026-10-02): an amount and a method, one ledger row (bo-model
   recordPayment). The four ways: Full balance fills the amount; ticking orders fills it with what
   they owe; lowering it pays part of the one ticked; nothing ticked pays the oldest first. */
const PAY_METHODS = ['cash', 'gcash', 'qr'];   // the built-in ones; the store's own names follow, then Other
function openPaymentDialog(c) {
  const dlg = $('#custDlg');
  if (!dlg || !c) return;
  const open = accountDebts(accountRows(c.id)).filter(d => d.orderId && d.left > 0);
  const number = new Map(state.orders.map(o => [o.id, o.number]));
  const pay = state.settings.payments || {}, off = new Set(pay.hidden || []);
  const methods = PAY_METHODS.filter(m => m === 'cash' || !off.has(m)).map(m => [m, SalesMath.tenderLabel(m)])
    .concat((pay.custom || []).map(n => [n, n]), [['other', SalesMath.tenderLabel('other')]]);
  dlg.innerHTML = `
    <div class="bod-head">
      <div class="bod-title"><h2>Record payment</h2><span class="bod-sub">${escapeHtml(c.name)} ${owedText(c.currentBalance, peso)}</span></div>
      <button type="button" class="bod-close" aria-label="Close">&times;</button>
    </div>
    <div class="adj-body">
      <form class="adj-form" id="payForm" data-id="${escapeHtml(c.id)}" novalidate>
        <div class="adj-grid">
          <label class="adj-field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" autocomplete="off"></label>
          <label class="adj-field"><span>Method</span><select name="method">${methods.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select></label>
          ${open.length ? `<div class="adj-field adj-note"><span>For orders · none ticked pays the oldest first</span>
            ${open.map(d => `<label class="bo-check"><input type="checkbox" name="order" value="${escapeHtml(d.orderId)}" data-left="${d.left}">
              #${escapeHtml(number.get(d.orderId) || d.orderId)} · ${escapeHtml(shortDate(d.ts))} · ${peso(d.left)} owed</label>`).join('')}</div>` : ''}
          <label class="adj-field adj-note"><span>Note</span><input name="note" type="text" autocomplete="off"></label>
        </div>
        <div class="adj-foot">
          <span class="adj-last"><button type="button" class="link-btn" data-act="payFull">Full balance</button></span>
          <button type="button" class="secondary-btn small" data-act="custCancel">Cancel</button>
          <button type="submit" class="primary-btn small">Record payment</button>
        </div>
      </form>
    </div>`;
  dlg.showModal();
  dlg.querySelector('[name="amount"]').focus();
}

// Each customer's ladder (orders, netSales = Total spent, lastSale), keyed by id: the same summarize
// over SalesMath.customerOrders that the account page reads, grouped in one pass. Facts only: the
// Next order / Due / Overdue guess was removed (owner, 2026-09-27).
const customerTotalsMap = () => ladder(state.orders, { by: (o) => SalesMath.customerIdOf(o) }).groups;
// Clear, the settled state, is muted text like Completed; every other state is a pill (owner, 2026-09-26).
// The status itself is bo-model's accountStatus, the POS's word too.
const custPill = ([tone, label]) => tone === 'muted'
  ? `<span class="muted">${label}</span>` : `<span class="status-pill ${tone}">${label}</span>`;

// The list's figures: a 288px rail beside the table, Sales › Transactions' blocks (bo-calm.css, .calm-cust).
// The Widgets menu shows and hides them; which are on, in tick order, is this device's choice (widgetsOn 'cust').

function renderCustomerList() {
  const q = state.custQuery.trim().toLowerCase();
  const customers = allCustomerRecords();
  const cycles = customerTotalsMap();
  // Filters read off the URL (?status=, ?last=): last = N days bought within, -N = nothing in N days.
  const prm = Router.route().params, last = Number(prm.last) || 0;
  // The status menu is every word accountStatus can give (bo-model ACCOUNT_STATUSES), so it never misses one.
  const statusSel = $('.view-customers [data-cust="status"]');
  if (statusSel) statusSel.innerHTML = '<option value="">Any balance</option>'
    + ACCOUNT_STATUSES.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  $$('.view-customers [data-cust]').forEach(el => { el.value = prm[el.dataset.cust] || ''; });
  // Whole store days, the "days ago" every screen uses (SalesMath.daysAgo, 0 = today): "last 7 days" is
  // today and the 6 before, the same days as SalesMath.rangeWindow(7); "No order in 90+ days" is the rest.
  const now = Date.now(), ago = (c) => { const t = cycles.get(c.id)?.lastSale; return t ? SalesMath.daysAgo(t, now, boZone()) : Infinity; };
  const list = customers.filter(c => (!q || c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    && (!prm.status || accountStatus(c)[1] === prm.status)
    && (!last || (last > 0 ? ago(c) < last : ago(c) >= -last)));

  // bo-model creditPool: money held for a customer is not credit out; Over limit is the status filter's own
  // test; Utilization is what is owed on accounts WITH a limit over the limits (a no-limit debt uses none).
  const { owed: totalOutstanding, used, limit: totalLimit, over: overLimit, active } = creditPool(customers);
  const utilization = pctOf(used, totalLimit, 0);

  $('#custTitle').textContent = 'Customers';
  // One thin strip over the filters (owner 2026-09-28; a Widgets rail before): always on, the note when you point
  // at a figure. Over limit is a button for the status filter.
  const near = prm.status === 'Over limit';
  const cell = (tag, lbl, num, note, extra = '') => `<${tag} class="top one"${extra} title="${escapeHtml(note)}"><span>${lbl}</span>
    <span class="acts"><span class="cnt${tag === 'button' && overLimit ? ' down' : ''}">${escapeHtml(note)}</span><span class="nv">${num}</span></span></${tag}>`;
  $('#custStrip').innerHTML = cell('div', 'Balance', pesoShort(totalOutstanding), `${SalesMath.plural(active, 'customer')} ${active === 1 ? 'owes' : 'owe'}`)
    + cell('div', 'Credit limit pool', pesoShort(totalLimit), 'total approved')
    + cell('div', 'Utilization', utilization, 'of total pool')
    + cell('button', 'Over limit', overLimit, 'owing past their limit', ` type="button" data-act="custNear" aria-pressed="${near}"`);

  const pg = paginate(list, prm.page);
  $('#custPager').innerHTML = pagerHtml(pg);
  $('#custTable tbody').innerHTML = pg.rows.map(c => {
    const status = accountStatus(c);
    const cy = cycles.get(c.id);
    return `
      <tr data-customer="${escapeHtml(c.id)}">
        <td title="${escapeHtml(c.name)}"><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td class="num">${cy ? cy.orders : 0}</td>
        <td class="num">${pesoShort(cy ? cy.netSales : 0)}</td>
        <td>${cy?.lastSale ? escapeHtml(shortDate(cy.lastSale)) : '—'}</td>
        <td class="num">${c.currentBalance ? peso(c.currentBalance) : '<span class="muted">—</span>'}</td>
        <td>${custPill(status)}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="7" class="bo-empty">No customers match.</td></tr>`;
}

/* ---------- The statement ----------
   The account's ledger, newest first: every charge, payment, reversal, opening balance and
   adjustment, with the balance after each. A return is a reversal on the paid side, never a
   second charge (bug 3). Each debt says Paid / Part paid / Unpaid (bo-model accountDebts); a
   payment can be undone, which writes a reversal, never a delete. An undone payment stays,
   marked Undone, and counts for nothing; the rows undoing it are bookkeeping and are not shown
   (bo-model undoneIds, so two undos of one payment still read once). The range is on the URL. */
// bo-model accountStatement: store-clock days, and a Brought forward row when From cuts history off, so
// brought forward + Charged − Paid = the closing balance on the page. Its own payment word
// (methodLabel, else SalesMath.tenderLabel) names each payment.
function statementRows(customerId, { from, to }) {
  const number = new Map(state.orders.map(o => [o.id, o.number]));
  return accountStatement(accountRows(customerId), { from, to, zone: boZone(), numberOf: id => number.get(id) });
}

function renderCustomerDetail(c) {
  const orders = SalesMath.customerOrders(state.orders, c.id);
  // What they bought, on the ladder: refunds come back off, parked carts never count. lastSale is
  // the newest sale still standing (a voided one never happened, a refunded one did).
  const m = ladder(orders);
  const last = m.lastSale ? orders.find(o => saleSign(o) > 0 && SalesMath.tsOf(o) === m.lastSale) : null;
  const status = accountStatus(c);

  $('#custTitle').textContent = c.name;
  const kpis = [
    kpi('Total spent', pesoShort(m.netSales), SalesMath.plural(m.orders, 'order'), 'flat'),
    kpi('Balance', peso(c.currentBalance || 0), limitText(c) || `of ${pesoShort(c.creditLimit)} limit`, 'flat'),
    kpi('Average sale', pesoShort(m.averageSale), 'per order', 'flat'),
    kpi('Last purchase', last ? shortDate(last.ts) : '—', last ? peso(last.total) : 'no orders yet', 'flat'),
  ].join('');

  // One line per item across every order — what they actually keep buying. Sales › Items' own list
  // (renderSales.topItems): same item key, same "Name · brand" for two items sharing a name.
  const items = renderSales.topItems(orders)
    .map(r => ({ name: r.name, unit: r.unit, qty: r.unitsSold, times: r.orders, spent: r.netSales }));

  // The statement reads its range off the URL, like every other filter in the back office.
  const p = Router.route().params;
  const stRows = statementRows(c.id, { from: p.from, to: p.to });
  const sum = (k) => round2(stRows.reduce((a, x) => a + x[k], 0));
  // 25 a page on its own ?stpage=, so it walks apart from Transactions; the totals are the whole range.
  const stPg = paginate(stRows, p.stpage, DETAIL_ROWS);
  const money = (n) => n ? peso(n) : '<span class="muted">—</span>';
  const stBody = stPg.rows.map(x => `
    <tr${x.r.orderId && x.kind === 'charge' ? ` data-order="${escapeHtml(x.r.orderId)}"` : ''}>
      <td>${escapeHtml(shortDate(x.r.ts))}</td>
      <td>${escapeHtml(x.entry)}</td>
      <td>${['Paid', 'Undone', 'Reversed'].includes(x.status) ? `<span class="muted">${x.status}</span>` : x.status ? custPill(['warn', x.status]) : ''}</td>
      <td class="num">${money(x.charged)}</td>
      <td class="num">${x.status === 'Undone' ? `<s class="muted">${peso(x.r.amount)}</s>` : money(x.paid)}</td>
      <td class="num"><strong>${peso(x.balance)}</strong></td>
      <td class="num">${x.kind === 'payment' && !x.status
        ? `<button class="secondary-btn small" data-act="payUndo" data-id="${escapeHtml(x.r.id)}">Undo</button>` : ''}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="bo-empty">Nothing in this range.</td></tr>`;

  const pg = paginate(orders, Router.route().params.page, DETAIL_ROWS);
  const txRows = pg.rows.map(o => `
    <tr data-order="${escapeHtml(o.id)}">
      <td>${escapeHtml(shortDate(o.ts))}</td>
      <td><strong>#${escapeHtml(o.number)}</strong></td>
      <td class="num">${o.items.length}</td>
      ${txPayStatus(o)}
      <td class="num"><strong>${txTotal(o)}</strong></td>
    </tr>`).join('') || `<tr><td colspan="6" class="bo-empty">No orders yet.</td></tr>`;

  // Top 25 by spend; the count in the header is the full number.
  const itemRows = items.slice(0, DETAIL_ROWS).map(i => `
    <tr>
      <td><strong>${escapeHtml(i.name)}</strong></td>
      <td class="num">${SalesMath.qtyText(i.qty)} ${escapeHtml(i.unit || '')}</td>
      <td class="num">${i.times}</td>
      <td class="num"><strong>${peso(i.spent)}</strong></td>
    </tr>`).join('') || `<tr><td colspan="4" class="bo-empty">Nothing bought yet.</td></tr>`;

  // One account card (owner 2026-09-26): status + Edit in the head band, the figures, then the facts.
  $('#custDetail').innerHTML = `
    <section class="cust-sum">
      <div class="bo-card-head">
        <span class="bo-card-label">Account</span>
        <span class="bo-card-sub">${custPill(status)}</span>
        <button class="secondary-btn small" data-act="custEdit" data-id="${escapeHtml(c.id)}">Edit</button>
        ${canRecordPayment(c) ? '<button class="primary-btn small" data-act="payNew">Record payment</button>' : ''}
      </div>
      <div class="kpi-row joined">${kpis}</div>
      <div class="bo-card-inset cust-facts">
        <div><span>Phone</span><b>${escapeHtml(c.phone || '—')}</b></div>
        <div><span>Address</span><b>${escapeHtml(c.address || '—')}</b></div>
        <div><span>Available credit</span><b>${limitText(c) || peso(creditRoom(c))}</b></div>
      </div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head st-head">
        <span class="bo-card-label">Statement</span>
        <span class="bo-card-sub">${SalesMath.plural(stRows.filter(x => x.kind !== 'forward').length, 'entry', 'entries')}</span>
        <input type="date" class="bo-date" data-act="stFrom" value="${escapeHtml(p.from || '')}" aria-label="From" />
        <span class="bo-card-sub">to</span>
        <input type="date" class="bo-date" data-act="stTo" value="${escapeHtml(p.to || '')}" aria-label="To" />
        <button class="secondary-btn small" data-act="stExport">Export CSV</button>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-tx">
          <thead><tr>
            <th>Date</th><th>Entry</th><th>Status</th>
            <th class="num">Charged</th><th class="num">Paid</th><th class="num">Balance</th><th></th>
          </tr></thead>
          <tbody>${stBody}</tbody>
          <tfoot><tr><td colspan="3"><strong>Total</strong></td>
            <td class="num"><strong>${peso(sum('charged'))}</strong></td>
            <td class="num"><strong>${peso(sum('paid'))}</strong></td>
            <td class="num"><strong>${peso(stRows[0]?.balance || 0)}</strong></td><td></td></tr></tfoot>
        </table>
      </div>${pagerHtml(stPg, 'stpage')}</div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head">
        <span class="bo-card-label">Orders</span>
        <span class="bo-card-sub">${SalesMath.plural(orders.length, 'receipt')}</span>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-tx">
          <thead><tr>
            <th>Date</th><th>Order</th><th class="num">Items</th>
            <th>Payment</th><th class="opt">Status</th><th class="num">Total</th>
          </tr></thead>
          <tbody>${txRows}</tbody>
        </table>
      </div>${pagerHtml(pg)}</div>
    </section>
    <section class="bo-card blk-table">
      <div class="bo-card-head">
        <span class="bo-card-label">Items bought</span>
        <span class="bo-card-sub">${SalesMath.plural(items.length, 'item')}</span>
      </div>
      <div class="bo-card-inset flush"><div class="table-wrap">
        <table class="data-table cust-items">
          <thead><tr>
            <th>Item</th><th class="num">Units sold</th><th class="num">Orders</th><th class="num">Total spent</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
      </div></div>
    </section>`;
}

// Settings is one section per URL (/admin/settings/<section>); a bare /admin/settings is Store.
// Payments is a section too but keeps its own view and URL, so saved links still work.
const SETTINGS_PANES = { store: 'Store', tax: 'Tax', receipt: 'Receipt & printing', staff: 'Staff & access', appearance: 'Appearance', data: 'Data' };
function settingsPane() { return SETTINGS_PANES[state.detailId] ? state.detailId : 'store'; }

// #setDlg: the one small form every settings card opens (Store details, VAT, a role, a new method).
// onSave(form) returns an error to show, or nothing to close; no onSave means changes save as they happen.
let setDlgSave = null;
function openSetDialog(title, fields, onSave, saveLabel = 'Save') {
  const dlg = $('#setDlg');
  setDlgSave = onSave;
  dlg.innerHTML = `
    <div class="bod-head">
      <div class="bod-title"><h2>${title}</h2></div>
      <button type="button" class="bod-close" aria-label="Close">&times;</button>
    </div>
    <div class="adj-body">
      <form class="adj-form">
        <div class="adj-grid">${fields}</div>
        <div class="adj-foot">
          <span class="adj-last" data-set-err></span>
          ${onSave ? `<button type="button" class="secondary-btn small" data-set-cancel>Cancel</button>
            <button type="submit" class="primary-btn small">${saveLabel}</button>`
          : '<button type="button" class="primary-btn small" data-set-cancel>Done</button>'}
        </div>
      </form>
    </div>`;
  dlg.showModal();
  return dlg;
}

// Typed values read as rows -- label, what is saved, › -- and a row opens its card's fields
// (Shopify-like, owner 2026-09-26: no input box until you click). A blank falls back to the default.
const SET_EDIT = {
  store: { title: 'Store details', fields: [['Store name', 'name'], ['Address', 'address'], ['Phone', 'phone'], ['Currency', 'currency']] },
  tax: { title: 'VAT', fields: [['VAT rate', 'vatRate'], ['Tax name', 'taxName'], ['TIN', 'tin']] },
};
// vatRate and taxName are store-wide settings; the rest sit under settings.store. The tax name is
// what the receipt prints (SalesMath.taxName), shown as the till uses it when none is typed.
const setShown = (key) => key === 'vatRate' ? SalesMath.ratePct(state.settings.vatRate || 0)
  : key === 'taxName' ? SalesMath.taxName(state.settings) : state.settings.store[key] || '';
// The dialog leaves Tax name blank while it is the default (shown as the placeholder), so turning
// "Tax added on top" on later still reads Tax, not a VAT someone saved without typing it.
const taxDefault = () => SalesMath.taxName({ taxOnTop: state.settings.taxOnTop });
const setRowsHtml = (card) => SET_EDIT[card].fields.map(([label, key]) => `
  <button type="button" class="setting-row" data-set-edit="${card}" data-key="${key}">
    <span class="set-lbl">${label}</span><span class="set-val">${escapeHtml(setShown(key)) || '<span class="muted">Not set</span>'}</span>
    <span class="set-chev" aria-hidden="true">›</span></button>`).join('');

function openSetEdit(card, focus) {
  const c = SET_EDIT[card];
  const dlg = openSetDialog(c.title, c.fields.map(([label, key]) => `<label class="adj-field"><span>${label}</span>
      <input class="text-input" name="${key}" type="text" value="${escapeHtml(key === 'taxName' ? state.settings.taxName || '' : setShown(key))}"${key === 'taxName' ? ` placeholder="${escapeHtml(taxDefault())}"` : ''} autocomplete="off"></label>`).join(''), (form) => {
    const v = (k) => (form.elements[k]?.value || '').trim();
    const s = state.settings, store = { ...s.store };
    let vatRate = s.vatRate, taxName = s.taxName;
    for (const [, k] of c.fields) {
      if (k === 'taxName') { taxName = v(k) === taxDefault() ? '' : v(k); continue; }
      if (k !== 'vatRate') { store[k] = v(k) || HWPOS_STORE.defaults().store[k]; continue; }
      const n = parseFloat(v(k).replace('%', ''));
      if (!(n >= 0 && n <= 100)) return 'VAT rate is a percent, like 12%.';
      vatRate = n / 100;
    }
    state.settings = { ...s, vatRate, taxName, store };
    saveSettings();
    showToast(`${c.title} saved`);
    renderSettingsForm();
    renderSwitchers();   // the store name and location sit in the sidebar
  });
  dlg.querySelector(`[name="${focus}"]`)?.select();
}

// On/off and pick-one settings save the moment they change, like Appearance and Staff & access.
const SET_NOW = {
  setVatRegistered: (s, el) => ({ vatInclusive: el.checked }),
  // Read by SalesMath.taxOpts: on = the shelf price is before tax and tax is added at checkout (US).
  setTaxOnTop: (s, el) => ({ taxOnTop: el.checked }),
  // SC/PWD (owner, 2026-10-02): the switch comes first; the till's SC/PWD checkout step reads it later.
  setScPwd: (s, el) => ({ scPwdOn: el.checked }),
  setPrinterWidth: (s, el) => ({ printing: { ...s.printing, width: el.value } }),
  setPrintOnSale: (s, el) => ({ printing: { ...s.printing, printOnSale: el.checked } }),
  setLogoOnReceipt: (s, el) => ({ printing: { ...s.printing, logoOnReceipt: el.checked } }),
};

function renderSettingsForm() {
  const pane = settingsPane();
  document.title = `${SETTINGS_PANES[pane]} · Settings · EJ Hardware`;
  $$('.set-pane').forEach(p => { p.hidden = p.dataset.pane !== pane; });
  if (pane === 'staff') return renderStaff();
  const s = state.settings;
  $$('[data-set-rows]').forEach(el => { el.innerHTML = setRowsHtml(el.dataset.setRows); });
  $('#setVatRegistered').checked = !!s.vatInclusive;
  $('#setTaxOnTop').checked = !!s.taxOnTop;
  $('#setScPwd').checked = !!s.scPwdOn;
  $('#setPrinterWidth').value = s.printing.width === '80mm' ? '80mm' : '58mm';
  $('#setPrintOnSale').checked = !!s.printing.printOnSale;
  $('#setLogoOnReceipt').checked = !!s.printing.logoOnReceipt;
}

// ---------- Payments: which cards and fulfilment pills the POS checkout shows ----------
// settings.payments = { hidden: [kind], custom: [name] }, read by applyPayMethods() in app.js;
// settings.fulfilment the same shape, read by applyFulfilMethods(). A custom name is saved on
// the order as its own label, so removing one never touches past sales -- they keep their label.
const PAY_BUILTINS = [
  ['cash', 'Cash', 'Always on. The cash drawer counts it.'],
  ['gcash', 'GCash', ''],
  ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'Staff type the name at checkout'],
  ['credit', 'Account', 'Charge to a customer. Shows only once a customer is picked.'],
  ['split', 'Split', 'Part cash, the rest on account. Shows only with a customer.'],
];
// Payment methods and fulfilment types are the same card twice: built-ins you switch off,
// your own names you add, one locked entry that can never go. Both write { hidden, custom }.
const METHOD_CARDS = {
  payments: {
    title: 'Payment methods', col: 'Method', locked: 'cash', builtins: PAY_BUILTINS,
    sub: 'Ticked ones show at checkout',
    placeholder: 'Add a method, e.g. Maya or Card', saved: 'Payment methods saved',
  },
  fulfilment: {
    title: 'Fulfilment types', col: 'Type', locked: 'walkin', builtins: FULFIL_BUILTINS,
    sub: 'Ticked ones show above Check out',
    placeholder: 'Add a type, e.g. Tricycle or Ship-out', saved: 'Fulfilment types saved',
  },
};
const methodConfig = (key) => ({ hidden: [], custom: [], ...(state.settings[key] || {}) });
// Every change saves at once, like the rest of Settings (owner, 2026-09-26: no Save bar, no input
// box until you click Add).
function renderPayments() { drawPayments(); }

function saveMethodCard(key, next) {
  state.settings = { ...state.settings, [key]: { ...methodConfig(key), ...next } };
  saveSettings();
  drawPayments();
  showToast(METHOD_CARDS[key].saved);
}

function methodCardHtml(key) {
  const card = METHOD_CARDS[key];
  const cfg = methodConfig(key);
  const off = new Set(cfg.hidden);
  const row = (label, note, control) => `<div class="setting-row"><label>${escapeHtml(label)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</label>${control}</div>`;
  const builtins = card.builtins.map(([k, label, note]) => row(label, note,
    `<input type="checkbox" data-m-kind="${escapeHtml(k)}" aria-label="Show ${escapeHtml(label)} at checkout"${off.has(k) ? '' : ' checked'}${k === card.locked ? ' disabled' : ''}>`)).join('');
  const custom = cfg.custom.map((name, i) => row(name, 'Added by you', `<button class="link-btn" data-m-del="${i}">Remove</button>`)).join('');
  return `
    <section class="bo-card blk-table" data-m-card="${key}">
      <div class="bo-card-head"><span class="bo-card-label">${escapeHtml(card.title)}</span>
        <span class="bo-card-sub">${escapeHtml(card.sub)}</span>
        <button class="link-btn" data-m-add>Add ${escapeHtml(card.col.toLowerCase())}</button></div>
      <div class="bo-card-inset flush set-rows">${builtins}${custom}</div>
    </section>`;
}

function drawPayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  root.innerHTML = `
    <header class="view-head">
      <div class="view-title-wrap"><h1>Payments</h1></div>
    </header>
    <div class="set-col">${methodCardHtml('payments')}${methodCardHtml('fulfilment')}</div>`;
}

// One listener per event for both cards; data-m-card says which card an edit belongs to.
function cardKey(el) {
  return el.closest('[data-m-card]')?.dataset.mCard || '';
}

function openMethodAdd(key) {
  const card = METHOD_CARDS[key];
  const dlg = openSetDialog(`Add a ${card.col.toLowerCase()}`, `<label class="adj-field adj-note"><span>Name</span>
      <input class="text-input" name="name" maxlength="24" placeholder="${escapeHtml(card.placeholder)}" autocomplete="off"></label>`, (form) => {
    const name = form.elements.name.value.trim();
    const cfg = methodConfig(key);
    const taken = card.builtins.map(([, l]) => l).concat(cfg.custom).some((n) => n.toLowerCase() === name.toLowerCase());
    if (!name) return 'Type a name first.';
    if (taken) return `${name} is already on the list.`;
    saveMethodCard(key, { custom: cfg.custom.concat(name) });
  }, 'Add');
  dlg.querySelector('[name="name"]').focus();
}

function wirePayments() {
  const root = $('.view[data-view="payments"]');
  if (!root) return;
  root.addEventListener('change', (e) => {
    const k = e.target.dataset.mKind;
    const key = cardKey(e.target);
    if (!k || !key || k === METHOD_CARDS[key].locked) return;
    const hidden = new Set(methodConfig(key).hidden);
    if (e.target.checked) hidden.delete(k); else hidden.add(k);
    // Keep built-in order so the saved list reads the same however it was toggled.
    saveMethodCard(key, { hidden: METHOD_CARDS[key].builtins.map(([b]) => b).filter((b) => hidden.has(b)) });
  });
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-m-add]');
    if (add) return openMethodAdd(cardKey(add));
    const del = e.target.closest('[data-m-del]');
    if (!del) return;
    const key = cardKey(del);
    saveMethodCard(key, { custom: methodConfig(key).custom.filter((_, i) => i !== Number(del.dataset.mDel)) });
  });
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
  $('.bo-sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-set], [data-set-back]');
    if (!b) return;
    if (b.hasAttribute('data-set-back')) return mainRoute ? Router.go(mainRoute.view, mainRoute.id, mainRoute.params) : Router.go('dashboard', '');
    Router.go(b.dataset.set === 'payments' ? 'payments' : 'settings', b.dataset.set === 'payments' ? '' : b.dataset.set);
  });

  // Settings: a value row opens its card's dialog; a checkbox or pick-one saves as it changes.
  const setPage = $('.view-settings');
  setPage.addEventListener('click', (e) => {
    const row = e.target.closest('[data-set-edit]');
    if (row) openSetEdit(row.dataset.setEdit, row.dataset.key);
  });
  setPage.addEventListener('change', (e) => {
    const f = SET_NOW[e.target.id];
    if (!f) return;
    state.settings = { ...state.settings, ...f(state.settings, e.target) };
    saveSettings();
    showToast('Settings saved');
  });
  const setDlg = $('#setDlg');
  setDlg.addEventListener('click', (e) => { if (e.target.closest('[data-set-cancel]')) setDlg.close(); });
  setDlg.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = setDlgSave?.(e.target);
    if (err) e.target.querySelector('[data-set-err]').textContent = err; else setDlg.close();
  });

  // Sales keeps a plain dropdown for the same state.
  $$('.range-select').forEach(sel => sel.addEventListener('change', () => {
    Router.setParams({ range: sel.value === 'today' ? '' : sel.value }, { replace: false });
  }));

  // <details> menus (multiPick, Products' Columns) behave like the popover ones: a click outside or Esc
  // closes them, and one hangs from its button's right edge (.flip) when the left would run off the page.
  // `toggle` does not bubble, so capture it.
  const openDetails = () => document.querySelectorAll('details:is(.ms-pick, .pd-cols)[open]');
  document.addEventListener('click', (e) => openDetails().forEach(d => { if (!d.contains(e.target)) d.open = false; }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openDetails().forEach(d => { d.open = false; }); });
  document.addEventListener('toggle', (e) => {
    const m = e.target.open && e.target.matches?.('.ms-pick, .pd-cols') && e.target.querySelector('.ms-menu, .pd-cols-menu');
    if (!m) return;
    m.classList.remove('flip');
    m.classList.toggle('flip', m.getBoundingClientRect().right > innerWidth - 16);
  }, true);

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
  document.addEventListener('change', (e) => {
    const el = e.target.closest('.view-customers [data-cust]');
    if (el) Router.setParams({ [el.dataset.cust]: el.value, page: '' });
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !e.target.closest('.view-customers')) return;
    const act = el.dataset.act;
    if (act === 'custEdit') return openCustomerDialog(el.dataset.id);
    if (act === 'custNear') return Router.setParams({ status: Router.route().params.status === 'Over limit' ? '' : 'Over limit', page: '' });
    if (act === 'custCancel') return $('#custDlg')?.close();
    if (act === 'payNew') return openPaymentDialog(allCustomerRecords().find(x => x.id === state.detailId));
    if (act === 'payFull') {
      const f = $('#payForm');
      f.querySelectorAll('[name="order"]').forEach(b => { b.checked = false; });
      f.amount.value = Math.max(0, allCustomerRecords().find(x => x.id === f.dataset.id)?.currentBalance || 0) || '';
      return;
    }
    if (act === 'payUndo') {
      if (!window.confirm('Undo this payment? It stays on the statement, marked Undone.')) return;
      if (undoPayment(loadCustomerLedger().find(r => r.id === el.dataset.id), { staff: actor() })) showToast('Payment undone');
      return renderCurrentView();
    }
    if (act === 'stExport') {
      const c = allCustomerRecords().find(x => x.id === state.detailId);
      const p = Router.route().params;
      const rows = [['date', 'entry', 'status', 'charged', 'paid', 'balance']];
      statementRows(state.detailId, { from: p.from, to: p.to }).reverse()
        .forEach(x => rows.push([isoDate(x.r.ts), x.entry, x.status, x.charged, x.paid, x.balance]));
      const span = [p.from || 'start', p.to || isoDate(Date.now())].join('-to-');
      return downloadCsv(`statement-${(c ? c.name : state.detailId).replace(/\W+/g, '-').toLowerCase()}-${span}.csv`, rows);
    }
  });

  document.addEventListener('change', (e) => {
    if (!e.target.closest('.view-customers')) return;
    const act = e.target.dataset.act;
    if (act === 'stFrom') Router.setParams({ from: e.target.value });
    else if (act === 'stTo') Router.setParams({ to: e.target.value });
    else if (e.target.name === 'order') {   // ticking orders fills the amount with what they owe
      const f = e.target.form, n = [...f.querySelectorAll('[name="order"]:checked')].reduce((a, b) => a + Number(b.dataset.left), 0);
      f.amount.value = n ? round2(n) : '';
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'payForm') {
      e.preventDefault();
      const f = e.target, c = allCustomerRecords().find(x => x.id === f.dataset.id);
      const amount = round2(f.amount.value), m = f.method.value;
      if (!(amount > 0)) { showToast('Enter an amount above 0'); return f.amount.focus(); }
      const [method, methodLabel] = PAY_METHODS.includes(m) || m === 'other' ? [m, ''] : ['other', m];   // a custom name is saved as its own label
      recordPayment(c, amount, { method, ...(methodLabel && { methodLabel }), note: f.note.value.trim(), staff: actor(),
        orderIds: [...f.querySelectorAll('[name="order"]:checked')].map(b => b.value) });
      $('#custDlg')?.close();
      showToast(`${peso(amount)} recorded`);
      return renderCurrentView();
    }
    if (e.target.id !== 'custForm') return;
    e.preventDefault();
    const id = e.target.dataset.id;
    const values = Object.fromEntries(new FormData(e.target));
    const res = customerFromForm(values, id ? allCustomerRecords().find(c => c.id === id) : null);
    if (res.error) {
      $('#custErr').textContent = res.error;
      return e.target.querySelector(`[name="${res.field}"]`).focus();
    }
    // Someone else has this phone (bo-model phoneOwner): say so once and offer them; saving again adds anyway.
    const dup = phoneOwner(res.customer.phone, id);
    if (dup && e.target.dataset.phone !== res.customer.phone) {
      e.target.dataset.phone = res.customer.phone;
      $('#custErr').innerHTML = phoneOwnerNote(dup, `<a class="link-btn" href="${escapeHtml(Router.href('customers', dup.id))}" data-act="custCancel">Open ${escapeHtml(dup.name)}</a>`);
      return;
    }
    saveCustomer(res.customer);
    $('#custDlg')?.close();
    showToast(id ? 'Customer saved' : `${res.customer.name} added`);
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
  // it back. Delegated here so no page module has to own paging of its own. A second table on
  // one page (the customer's Statement) names its own key in data-key.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.bo-page-btn');
    if (!b || b.disabled) return;
    Router.setParams({ [b.closest('.bo-pager')?.dataset.key || 'page']: b.dataset.page === '1' ? '' : b.dataset.page });
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

  // ----- Settings → Appearance: per-device, applied as picked (no Save bar) -----
  const syncTiles = () => {
    const size = $('#settingsSizeToggle'), show = $('#settingsShowPrice');
    if (size) size.value = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
    if (show) show.checked = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
  };
  syncTiles();
  $('#settingsSizeToggle')?.addEventListener('change', (e) => {
    storageSet(STORAGE_TILE_SIZE, e.target.value);
    showToast('Tile size saved. The Sell screen will update');
  });
  $('#settingsShowPrice')?.addEventListener('change', (e) => {
    storageSet(STORAGE_SHOW_PRICE, e.target.checked ? '1' : '0');
    showToast(e.target.checked ? 'Prices will show on tiles' : 'Prices hidden on tiles');
  });
  $('#settingsChartHue')?.addEventListener('change', (e) => HWPOS_STORE.ui.set('chartHue', applyChartHue(e.target.value)));
  $('#settingsChartStyle')?.addEventListener('change', (e) => HWPOS_STORE.ui.set('chartStyle', applyChartStyle(e.target.value)));
  $('#settingsDensityToggle')?.addEventListener('change', (e) => storageSet(STORAGE_DENSITY, applyDensity(e.target.value)));

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
      STORAGE_CUSTOMER_LEDGER,
      STORAGE_PURCHASE_ORDERS,   // a receipt in another window repaints this one
      STORAGE_STOCK_MOVEMENTS,   // a sale or count on another till: on hand re-derives
      STORAGE_SETTINGS,
      STORAGE_TILE_SIZE,
      STORAGE_SHOW_PRICE,
      STORAGE_THEME,
    ]);
    if (!watched.has(e.key)) return;
    if (e.key === STORAGE_TILE_SIZE || e.key === STORAGE_SHOW_PRICE || e.key === STORAGE_THEME) {
      syncTiles();   // an Appearance change made in the POS
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
  const sel = $('#settingsDensityToggle'); if (sel) sel.value = d;
  return d;
}

// ---------- Chart colours ----------
// Profit's line: violet (default) or the deeper blue. One class on <body>; bo-blocks.css
// re-points --chart-2 under it, so the lines, fades, dots and keys all follow.
function applyChartHue(hue) {
  const h = hue === 'blues' ? 'blues' : 'violet';
  document.body.classList.toggle('chart-blues', h === 'blues');
  const sel = $('#settingsChartHue'); if (sel) sel.value = h;
  return h;
}

// Line (default) or bars. One class on <body>; the calm Dashboard and Sales always draw bars, so nothing reads it now.
function applyChartStyle(style) {
  const v = style === 'bars' ? 'bars' : 'line';
  document.body.classList.toggle('chart-bars', v === 'bars');
  const sel = $('#settingsChartStyle'); if (sel) sel.value = v;
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

document.addEventListener('DOMContentLoaded', () => HWPOS_STORE.ready().then(init));
