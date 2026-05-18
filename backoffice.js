/* ==========================================================
   Hardware POS — Back Office
   Vanilla JS dashboard. Reads same localStorage as POS app
   (hwpos.folders.v2 / hwpos.products.v2) so changes stay in sync.
   ========================================================== */

const STORAGE_FOLDERS  = 'hwpos.folders.v2';
const STORAGE_PRODUCTS = 'hwpos.products.v2';
const STORAGE_TILE_SIZE  = 'hwpos.tileSize';
const STORAGE_SHOW_PRICE = 'hwpos.showPrice';

const state = {
  view: 'dashboard',
  range: 'today',
  folders: [],
  products: [],
  invQuery: '',
  custQuery: '',
};

// ---------- Helpers ----------
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pesoShort = (n) => '₱' + Math.round(Number(n || 0)).toLocaleString('en-PH');
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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
    const raw = localStorage.getItem(STORAGE_FOLDERS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return SEED_FOLDERS.map(f => ({ ...f }));
}
function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_PRODUCTS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return PRODUCTS.map(p => ({ ...p }));
}

function folderName(id) {
  const f = state.folders.find(x => x.id === id);
  return f ? f.name : 'Uncategorized';
}

// ---------- Fake derived data for mockup ----------
// Range-aware numbers so segmented control feels live.
function rangeMultiplier(range) {
  return range === 'today' ? 1 : range === '7d' ? 6.4 : 27.2;
}

function computeTodayTotals() {
  const m = rangeMultiplier(state.range);
  const revenue = 14059 * m;
  const txns    = Math.round(7 * m);
  const items   = Math.round(32 * m);
  const avg     = txns > 0 ? revenue / txns : 0;
  return { revenue, txns, items, avg };
}

function salesByDay() {
  // last 7 days — Mon..Sun roughly; weekend slightly slower
  return [
    { label: 'Wed', value: 11250 },
    { label: 'Thu', value: 14820 },
    { label: 'Fri', value: 18960 },
    { label: 'Sat', value: 21340 },
    { label: 'Sun', value: 9870 },
    { label: 'Mon', value: 16450 },
    { label: 'Tue', value: 14059 },
  ];
}

// Mock cashier + customer fields on RECENT_SALES
function enrichedSales() {
  const cashiers = ['El John', 'Maricel', 'Aldrin', 'Joy', 'El John', 'Maricel', 'El John'];
  return RECENT_SALES.map((s, i) => ({
    ...s,
    cashier: cashiers[i] || 'El John',
    items: Math.max(1, Math.round(s.amount / 280)),
    date: 'Today',
  }));
}

// Mock top SKUs (units sold today)
function topSkus() {
  const ids = ['p001', 'p006', 'e001', 'p003', 'f001'];
  return ids
    .map(id => {
      const p = state.products.find(x => x.id === id);
      if (!p) return null;
      const sold = { p001: 48, p006: 32, e001: 26, p003: 24, f001: 22 }[id] || 0;
      return { ...p, sold };
    })
    .filter(Boolean);
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
  renderCurrentView();
}

function renderCurrentView() {
  if (state.view === 'dashboard') renderDashboard();
  else if (state.view === 'sales')      renderSales();
  else if (state.view === 'inventory')  renderInventory();
  else if (state.view === 'customers')  renderCustomers();
  else if (state.view === 'suppliers')  renderSuppliers();
  else if (state.view === 'staff')      renderStaff();
}

// ---------- Dashboard ----------
function renderDashboard() {
  const totals = computeTodayTotals();

  // KPI row
  $('#kpiRow').innerHTML = [
    kpi('Revenue', pesoShort(totals.revenue), '+12%', 'up'),
    kpi('Transactions', totals.txns, '+3 vs yesterday', 'up'),
    kpi('Items sold', totals.items, '+5 vs yesterday', 'up'),
    kpi('Avg basket', pesoShort(totals.avg), '−2% vs yesterday', 'down'),
  ].join('');

  // Today label
  const today = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#todayLabel').textContent = today;

  // Sales chart
  const series = salesByDay();
  const max = Math.max(...series.map(s => s.value));
  $('#salesChart').innerHTML = series.map(s => {
    const pct = Math.max(4, (s.value / max) * 100);
    return `
      <div class="chart-bar" title="${s.label}: ${peso(s.value)}">
        <div class="chart-bar-fill" style="height:${pct}%"></div>
        <div class="chart-bar-label">${s.label}</div>
      </div>`;
  }).join('');
  $('#chartTotal').textContent = pesoShort(series.reduce((a, b) => a + b.value, 0)) + ' total';

  // Recent sales
  const sales = enrichedSales();
  $('#recentSales').innerHTML = sales.map(s => `
    <div class="mini-row">
      <div class="mr-id">${escapeHtml(s.id)}</div>
      <div class="mr-time">${escapeHtml(s.time)}</div>
      <div class="mr-meta">${escapeHtml(s.customer || 'Walk-in')}</div>
      <div class="mr-amt">
        <span class="pay-pill ${s.method}">${s.method}</span>
        &nbsp;${peso(s.amount)}
      </div>
    </div>
  `).join('');

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
  const debtors = CUSTOMERS.filter(c => (c.currentBalance || 0) > 0)
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
  $('#topSkus').innerHTML = topSkus().map(p => `
    <div class="mini-list-row">
      <div class="ml-left">
        <span class="ml-name">${escapeHtml(p.name)}</span>
        <span class="ml-sub">${escapeHtml(p.sku)} · ${peso(p.price)}</span>
      </div>
      <span class="ml-value">${p.sold} ${escapeHtml(p.unit)}</span>
    </div>
  `).join('');
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
  const sales = enrichedSales();
  $('#salesCount').textContent = `${sales.length} transaction${sales.length === 1 ? '' : 's'}`;

  const total = sales.reduce((a, s) => a + s.amount, 0);
  const itemsSold = sales.reduce((a, s) => a + s.items, 0);
  const cashTotal = sales.filter(s => s.method === 'cash').reduce((a, s) => a + s.amount, 0);
  const creditTotal = sales.filter(s => s.method === 'credit').reduce((a, s) => a + s.amount, 0);

  $('#salesKpis').innerHTML = [
    kpi('Total', pesoShort(total), 'all transactions', 'flat'),
    kpi('Cash', pesoShort(cashTotal), `${Math.round((cashTotal / total) * 100)}% of total`, 'flat'),
    kpi('Credit (utang)', pesoShort(creditTotal), `${Math.round((creditTotal / total) * 100)}% of total`, 'flat'),
    kpi('Items', itemsSold, 'units across receipts', 'flat'),
  ].join('');

  $('#salesTable tbody').innerHTML = sales.map(s => `
    <tr>
      <td><strong>${escapeHtml(s.id)}</strong></td>
      <td>${escapeHtml(s.date)} · ${escapeHtml(s.time)}</td>
      <td>${escapeHtml(s.cashier)}</td>
      <td>${escapeHtml(s.customer || 'Walk-in')}</td>
      <td><span class="pay-pill ${s.method}">${s.method}</span></td>
      <td class="num">${s.items}</td>
      <td class="num"><strong>${peso(s.amount)}</strong></td>
      <td><button class="link-btn">View →</button></td>
    </tr>
  `).join('');
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
  const list = q
    ? CUSTOMERS.filter(c => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q))
    : CUSTOMERS;

  const totalOutstanding = CUSTOMERS.reduce((a, c) => a + (c.currentBalance || 0), 0);
  const totalLimit = CUSTOMERS.reduce((a, c) => a + (c.creditLimit || 0), 0);
  const overLimit = CUSTOMERS.filter(c => c.currentBalance > c.creditLimit * 0.75).length;
  const active = CUSTOMERS.filter(c => c.currentBalance > 0).length;

  $('#custSummary').textContent = `${list.length} customer${list.length === 1 ? '' : 's'}`;
  $('#custKpis').innerHTML = [
    kpi('Outstanding utang', pesoShort(totalOutstanding), `${active} active debtors`, 'flat'),
    kpi('Credit limit pool', pesoShort(totalLimit), 'total approved', 'flat'),
    kpi('Utilization', Math.round(totalOutstanding / totalLimit * 100) + '%', 'of total pool', 'flat'),
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

  // ----- Settings → Appearance (S/M/L tile size + price toggle) -----
  // Sync initial state from localStorage
  const currentSize = localStorage.getItem(STORAGE_TILE_SIZE) || 'md';
  $$('#settingsSizeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const currentShow = localStorage.getItem(STORAGE_SHOW_PRICE) === '1';
  const showCb = $('#settingsShowPrice');
  if (showCb) showCb.checked = currentShow;

  $$('#settingsSizeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      const size = b.dataset.size;
      try { localStorage.setItem(STORAGE_TILE_SIZE, size); } catch (_) {}
      $$('#settingsSizeToggle .bb-size-btn').forEach(x => x.classList.toggle('active', x === b));
      showToast(`Tile size set to ${size.toUpperCase()} — Sell screen will update`);
    });
  });
  showCb?.addEventListener('change', (e) => {
    try { localStorage.setItem(STORAGE_SHOW_PRICE, e.target.checked ? '1' : '0'); } catch (_) {}
    showToast(e.target.checked ? 'Prices will show on tiles' : 'Prices hidden on tiles');
  });

  // Re-pull localStorage when switching back to the tab (POS app might have edited it)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      state.folders  = loadFolders();
      state.products = loadProducts();
      renderCurrentView();
    }
  });
}

// ---------- Init ----------
function init() {
  state.folders  = loadFolders();
  state.products = loadProducts();
  wireEvents();
  // Honour a #settings (or any view) URL hash so deep links from the POS work.
  const hash = (location.hash || '').replace('#', '').trim();
  const validViews = ['dashboard', 'sales', 'inventory', 'customers', 'suppliers', 'staff', 'settings'];
  setView(validViews.includes(hash) ? hash : 'dashboard');
}

document.addEventListener('DOMContentLoaded', init);
