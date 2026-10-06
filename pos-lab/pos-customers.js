// Till › Customers, and the hidden Reports page.

// ---------- Customers / Reports ----------
// One customer's money rows, newest first (sales, voids, refunds; SalesMath.customerOrders, the back
// office's), and their header from summarize over THE SAME rows, so the list and the numbers above it
// never disagree: Total spent = netSales, Orders, Last purchase = the newest sale a void didn't cancel.
const customerOrders = customerId => SalesMath.customerOrders(state.orders, customerId);
function customerMetrics(customerId) {
  const m = SalesMath.summarize(customerOrders(customerId));
  if (m.orders <= 0) return { lifetimeValue: 0, avgOrderValue: 0, orderCount: 0, lastPurchaseTs: 0, daysSinceLastPurchase: null };
  const daysSinceLastPurchase = daysAgo(m.lastSale);   // store days, the store's clock
  return { lifetimeValue: m.netSales, avgOrderValue: m.averageSale, orderCount: m.orders, lastPurchaseTs: m.lastSale, daysSinceLastPurchase };
}

// Last purchase: the one 'N days ago' wording (SalesMath.agoText, as the back office), store days.
const relativeTime = ts => SalesMath.agoText(ts, Date.now(), tillZone());


function customerAging(customerId) {
  // What each sale still owes, the same split the back office shows (bo-model accountDebts).
  const debts = accountDebts(accountRows(customerId));
  const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const d of debts) {
    if (d.left <= 0) continue;
    const days = daysAgo(SalesMath.tsOf(d));   // any time format (ms or ISO), store days
    const amt = d.left;
    if (days <= 30) buckets['0-30'] += amt;
    else if (days <= 60) buckets['31-60'] += amt;
    else if (days <= 90) buckets['61-90'] += amt;
    else buckets['90+'] += amt;
  }
  // ponytail: the sum only says whether there is anything to age; the Balance heading is the ledger's (c.currentBalance).
  const total = moneyValue(Object.values(buckets).reduce((s, v) => s + v, 0));
  return { buckets, total };
}

function fmtOrderDate(ts) {
  return tillDate(ts, 'dayYear');
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
      <div class="cust-kpi-label">Total spent</div>
      <div class="cust-kpi-value">${peso(m.lifetimeValue)}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Orders</div>
      <div class="cust-kpi-value">${m.orderCount}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Average sale</div>
      <div class="cust-kpi-value">${peso(m.avgOrderValue)}</div>
    </div>
    <div class="cust-kpi-box">
      <div class="cust-kpi-label">Last purchase</div>
      <div class="cust-kpi-value cust-kpi-value-sm">${relativeTime(m.lastPurchaseTs)}</div>
    </div>`;

  const agingEl = $('#custDetailAging');
  if (aging.total > 0) {
    const b = aging.buckets;
    agingEl.innerHTML = `
      <div class="cust-aging-title">Balance · ${peso(c.currentBalance)}</div>
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
    ordersEl.innerHTML = `<div class="cust-detail-empty">No orders yet</div>`;
  } else {
    ordersEl.innerHTML = orders.map(o => {
      const itemCount = o.items.length;
      const firstItems = o.items.slice(0, 2).map(i => i.name).join(', ');
      const moreItems = o.items.length > 2 ? ` +${o.items.length - 2} more` : '';
      return `
        <button class="cust-order-row" data-order-id="${escapeHtml(o.id)}">
          <div class="cust-order-date">${fmtOrderDate(o.ts)}</div>
          <div class="cust-order-items">
            <div class="cust-order-items-main">#${escapeHtml(o.number)} · ${SalesMath.plural(itemCount, 'item')}</div>
            <div class="cust-order-items-sub">${escapeHtml(firstItems)}${moreItems}</div>
          </div>
          <span class="cust-order-method">
            ${orderFlag(o, 'st')}<span class="rl-dot" style="background:${orderDot(o)}"></span>
            ${escapeHtml(SalesMath.payWord(o))}
          </span>
          <div class="cust-order-total">${peso(SalesMath.rowAmount(o))}</div>
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
        (c.phone || '').toLowerCase().includes(q))
    : all;

  if (filtered.length > 0 && !filtered.find(c => c.id === state.selectedCustomerId)) {
    state.selectedCustomerId = filtered[0].id;
  }

  // The Orders rail: a band (how many, what they owe), then name + phone, the balance only when owed.
  if (list) {
    const owed = moneyValue(filtered.reduce((t, c) => t + Math.max(0, c.currentBalance || 0), 0));
    list.innerHTML = !filtered.length
      ? `<div class="empty"><b>${q ? 'No matches' : 'No customers yet'}</b><span>${q ? 'Try a different name or phone.' : 'Tap + to add your first customer.'}</span></div>`
      : `<div class="band"><span class="num">${SalesMath.plural(filtered.length, 'customer')}</span>${owed > 0 ? `<span class="num">${peso(owed)} owed</span>` : ''}</div>`
        + filtered.map(c => `<button type="button" class="row${c.id === state.selectedCustomerId ? ' cur' : ''}" data-customer-id="${escapeHtml(c.id)}">
        <div class="nm"><span>${escapeHtml(c.name)}</span><small class="num">${escapeHtml(c.phone || 'No phone')}</small></div>
        ${(c.currentBalance || 0) > 0 ? `<div class="rt"><span class="amt num">${peso(c.currentBalance)}</span></div>` : ''}</button>`).join('');
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
  const status = accountStatus(c)[1];
  const balCls = !(bal > 0) ? '' : status === 'Over limit' ? 'over' : 'has';

  const agingParts = [];
  if (aging.buckets['0-30'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">0–30d</span><span class="cd-aging-value">${peso(aging.buckets['0-30'])}</span></div>`);
  if (aging.buckets['31-60'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">31–60d</span><span class="cd-aging-value aging-warn">${peso(aging.buckets['31-60'])}</span></div>`);
  if (aging.buckets['61-90'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">61–90d</span><span class="cd-aging-value aging-warn">${peso(aging.buckets['61-90'])}</span></div>`);
  if (aging.buckets['90+'] > 0) agingParts.push(`<div class="cd-aging-item"><span class="cd-aging-label">90+d</span><span class="cd-aging-value aging-danger">${peso(aging.buckets['90+'])}</span></div>`);

  const agingHtml = aging.total > 0 ? `
    <div class="cd-section-label">Balance by age</div>
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
              <div class="cd-order-name">#${escapeHtml(o.number)} · ${SalesMath.plural(itemCount, 'item')}</div>
              <div class="cd-order-sub">${escapeHtml(firstItems)}${moreItems}</div>
            </div>
            <span class="cd-order-method">
              ${orderFlag(o, 'st')}<span class="rl-dot" style="background:${orderDot(o)}"></span>
              ${escapeHtml(SalesMath.payWord(o))}
            </span>
            <div class="cd-order-total">${peso(SalesMath.rowAmount(o))}</div>
          </button>`;
      }).join('')
    : `<div class="cd-empty">No orders yet</div>`;

  const moreOrders = orders.length > 20 ? `<div class="cd-more-orders">${SalesMath.plural(orders.length - 20, 'more receipt')} — open full history for all</div>` : '';

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
          <div class="odm-meta-row"><span>Credit limit</span><span>${limitText(c) || peso(c.creditLimit)}</span></div>
          <div class="odm-meta-row"><span>Balance</span><span class="cust-card-balance-value ${balCls}">${peso(bal)}${status === 'Over limit' ? ' · Over limit' : ''}</span></div>
        </div>
        <div class="cd-kpis">
          <div class="cd-kpi-box"><div class="cd-kpi-label">Total spent</div><div class="cd-kpi-value">${peso(m.lifetimeValue)}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Orders</div><div class="cd-kpi-value">${m.orderCount}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Average sale</div><div class="cd-kpi-value">${peso(m.avgOrderValue)}</div></div>
          <div class="cd-kpi-box"><div class="cd-kpi-label">Last purchase</div><div class="cd-kpi-value cd-kpi-value-sm">${relativeTime(m.lastPurchaseTs)}</div></div>
        </div>
        ${agingHtml}
        <div class="cd-section-label">Recent orders</div>
        <div class="cd-orders-list">${orderRows}</div>
        ${moreOrders}
      </div>
    </div>
    <div class="od-foot">
      <button class="od-details-btn cd-details-btn" type="button" data-customer-detail="${escapeHtml(c.id)}">View full history</button>
      ${canRecordPayment(c) ? `<button class="od-details-btn cd-pay-btn" type="button" data-customer-pay="${escapeHtml(c.id)}">Record payment</button>` : ''}
    </div>`;
}

// Cheap change-detector so the live poll only re-renders when orders actually change.
// The stored string IS the signature. The old version parsed and normalized every order ever
// rung and then built a key by concatenating a field from each of them -- every four seconds,
// on the one screen a shop owner leaves open all day. That was more work than the render it
// existed to avoid, and it missed edits to any field it did not list.
function reportsSignature() {
  return storageGet(STORAGE_ORDERS, '');
}

// Payments by method are SalesMath's tenders (the back office's): a split sale is its legs (cash +
// account), GCash/QR/a store's own method ("Maya") are named from the order, words from tenderLabel.
// Colours are the --pm-* tokens (a deliberate data-viz exception to the monochrome theme); a store's
// own method wears Other's.
const PAY_KEYS = ['cash', 'gcash', 'qr', 'credit', 'other'];
const payBucket = k => (PAY_KEYS.includes(k) ? k : 'other');
const payColor = k => `var(--pm-${payBucket(k)})`;
const payRank = k => PAY_KEYS.indexOf(payBucket(k));
const orderTenderKeys = o => SalesMath.paymentsOf(o).map(p => p.key);
const orderDot = o => payColor(orderTenderKeys(o)[0]);   // the first leg's colour

function renderReports() {
  state.orders = loadOrders();
  reportsLive._sig = reportsSignature();
  const z = tillZone(), todayKey = tillDay(Date.now());
  const win = (fromKey, toKey = fromKey) => ({ from: SalesMath.dayStartMs(fromKey, z), to: SalesMath.dayStartMs(SalesMath.addDays(toKey, 1), z) });
  const todayMoney = SalesMath.summarize(state.orders, win(todayKey));
  // Today's sales still standing (a voided one is cancelled; a refund is its own row, later).
  const sales = state.orders
    .filter(o => tillDay(o.ts) === todayKey && ['sale', 'refunded'].includes(orderState(o)))
    .sort((a, b) => b.ts - a.ts);
  $('#statRevenue').textContent = peso(todayMoney.netSales);
  $('#statTxns').textContent = todayMoney.orders;

  // ---- Last-7-days money by payment method (SalesMath.tenders: what each method took in, less what went back) ----
  const DAYS = 7;
  const series = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const key = SalesMath.addDays(todayKey, -i), w = win(key);
    const byKind = {};
    SalesMath.tenders(state.orders, w).forEach((amt, k) => { if (amt > 0) byKind[k] = amt; });   // a bar can't draw below zero
    series.push({ label: tillDate(key, 'weekday'), byKind,
      total: Object.values(byKind).reduce((t, a) => t + a, 0), count: SalesMath.summarize(state.orders, w).orders, isToday: i === 0 });
  }
  const rangeWin = win(SalesMath.addDays(todayKey, -(DAYS - 1)), todayKey);
  const rangeTenders = SalesMath.tenders(state.orders, rangeWin);
  const rangeOrders = SalesMath.summarize(state.orders, { ...rangeWin, by: orderTenderKeys }).groups;
  const maxDay = Math.max(1, ...series.map(s => s.total));
  const chartEl = $('#reportsChart');
  if (chartEl) {
    chartEl.innerHTML = series.map(s => {
      const barH = (s.total / maxDay) * 100;
      const segs = Object.keys(s.byKind).sort((a, b) => payRank(a) - payRank(b))
        .map(k => `<div class="rc-seg" style="flex-grow:${s.byKind[k]};background:${payColor(k)}" title="${escapeHtml(SalesMath.tenderLabel(k))}: ${peso(s.byKind[k])}"></div>`)
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
  if (rangeTotalEl) rangeTotalEl.textContent = peso([...rangeTenders.values()].reduce((t, a) => t + a, 0));

  // ---- Legend: each method's money + orders over the range ----
  const legendEl = $('#reportsLegend');
  if (legendEl) {
    const used = [...rangeTenders.keys()].sort((a, b) => payRank(a) - payRank(b));
    legendEl.innerHTML = used.map(k => {
      const n = (rangeOrders.get(k) || { orders: 0 }).orders;
      return `<div class="rl-item">
        <span class="rl-dot" style="background:${payColor(k)}"></span>
        <span class="rl-label">${escapeHtml(SalesMath.tenderLabel(k))}</span>
        <span class="rl-amt">${peso(rangeTenders.get(k))}</span>
        <span class="rl-count">· ${SalesMath.plural(n, 'order')}</span>
      </div>`;
    }).join('');
  }

  // ---- Every sale today that still stands, newest first ----
  const txCount = $('#reportsTxCount');
  if (txCount) txCount.textContent = SalesMath.plural(todayMoney.orders, 'order');
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
            <span class="rl-dot" style="background:${orderDot(s)}"></span>
            ${escapeHtml(SalesMath.payWord(s))}
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

