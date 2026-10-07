// Till › Customers, and the hidden Reports page.

// ---------- Customers / Reports ----------
// One customer's money rows, newest first (sales, voids, refunds; SalesMath.customerOrders, the back office's).
// The till shows the last few; totals, averages and the balance by age are the back office's (owner 2026-10-06).
const customerOrders = customerId => SalesMath.customerOrders(state.orders, customerId);

function fmtOrderDate(ts) {
  return tillDate(ts, 'dayYear');
}

function renderCustomers() {
  state.orders = loadOrders();
  const list = $('#customersList');
  const all = allCustomerRecords();

  const q = (state.customersQuery || '').trim().toLowerCase();
  let filtered = q
    ? all.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q))
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

  renderCustomerDetail();
}

// One customer, the Orders shape: the name (and Over limit) on top with Record payment and Edit beside it,
// then who they are, their account, and the last 5 orders in the Orders rail's rows; See all opens the rest.
function renderCustomerDetail() {
  const body = $('#customerBody'), ttl = $('#customerTtl');
  if (!body || !ttl) return;
  const c = allCustomerRecords().find(x => x.id === state.selectedCustomerId);
  $('#customerEdit').disabled = !c;
  $('#customerPay').disabled = !canRecordPayment(c);
  if (!c) {
    ttl.innerHTML = '';
    body.innerHTML = '<div class="empty"><b>No customer selected</b><span>Pick one from the list to see their details.</span></div>';
    return;
  }
  const status = accountStatus(c)[1], over = status === 'Over limit';
  ttl.innerHTML = `<b>${escapeHtml(c.name)}</b>${over ? '<span>Over limit</span>' : status === 'Near limit' ? '<span class="warn">Near limit</span>' : ''}`;
  const row = (lb, v, cls = '') => `<div class="fr"><span class="lb">${lb}</span><span class="v ${cls}">${v}</span></div>`;
  const contact = [['Phone', c.phone, 'num'], ['Email', c.email], ['Address', c.address]]
    .filter(f => f[1]).map(([lb, v, cls]) => row(lb, escapeHtml(v), cls)).join('');   // an empty one is left out, not "—"
  const orders = customerOrders(c.id).filter(o => !SalesMath.isReversal(o));   // one row per sale, as in Orders
  const orderRow = o => {
    const amt = orderRowAmt(o, reversalsOf(o));   // as Orders shows it
    return `<button type="button" class="row${orderStruck(o) ? ' void' : ''}" data-order-id="${escapeHtml(o.id)}">
      <div class="nm">${orderTitleHtml(o)}<small class="num">${fmtOrderDate(o.ts)} · ${SalesMath.plural((o.items || []).length, 'item')}</small></div>
      <div class="rt"><span class="amt num">${amt == null ? '—' : peso(amt)}</span><small>${escapeHtml(orderPayText(o))}</small></div></button>`;
  };
  body.innerHTML = `<div class="c-body">
    ${contact ? `<section class="card fc">${contact}</section>` : ''}
    <section class="card fc">
      ${row('Balance', peso(c.currentBalance || 0), over ? 'num over' : 'num')}
      ${row('Available credit', limitText(c) || `${peso(creditRoom(c))} <small>of ${peso(c.creditLimit)}</small>`, 'num')}</section>
    <section class="card fc c-ord"><h3>Recent orders${orders.length > 10 ? `<button type="button" class="link" data-customer-detail>See all ${orders.length}</button>` : ''}</h3>
      ${orders.length ? orders.slice(0, 10).map(orderRow).join('') : '<div class="note">No orders yet</div>'}</section>
  </div>`;
}

// Record payment, the back office's (openPaymentDialog) on the till: a card that grows out of the button. The amount
// (Full balance fills it), how they paid, the open receipts to tick (ticking fills the amount with what they owe),
// a note. Nothing ticked, or money left over, pays the oldest debts first (bo-model recordPayment). More than the
// balance is allowed, as in the back office: it waits on the account for the next charge.
const PAY_BUILTINS = ['cash', 'gcash', 'qr'];   // the store's own names follow, then Other (the checkout's order)
function openPaySheet(btn, c) {
  if (!btn || !c) return;
  const open = accountDebts(accountRows(c.id)).filter(d => d.orderId && d.left > 0);
  const number = new Map(state.orders.map(o => [o.id, o.number]));
  const pay = state.settings.payments || {}, off = new Set(pay.hidden || []);
  const methods = PAY_BUILTINS.filter(m => m === 'cash' || !off.has(m)).map(m => [m, SalesMath.tenderLabel(m)])
    .concat((pay.custom || []).map(n => [n, n]), [['other', SalesMath.tenderLabel('other')]]);
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<form class="pay-sheet" role="dialog" aria-label="Record payment" novalidate>
    <div class="ph"><b>Record payment</b><small>${escapeHtml(c.name)} ${owedText(c.currentBalance, peso)}</small></div>
    <label class="pf"><span class="lb">Amount</span><span class="pa"><input class="text-input num" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00">${
      c.currentBalance > 0 ? '<button type="button" data-full>Full balance</button>' : ''}</span></label>
    <label class="pf"><span class="lb">Method</span><select class="text-input" name="method">${methods.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select></label>
    ${open.length ? `<fieldset class="pf"><legend class="lb">Receipts · none ticked pays the oldest first</legend>${open.map(d => `<label class="pr">
      <input type="checkbox" name="order" value="${escapeHtml(d.orderId)}" data-left="${d.left}"><span class="num">#${escapeHtml(number.get(d.orderId) || d.orderId)}</span>
      <small class="num">${fmtOrderDate(d.ts)}</small><span class="num">${peso(d.left)}</span></label>`).join('')}</fieldset>` : ''}
    <label class="pf"><span class="lb">Note</span><input class="text-input" name="note" type="text" autocomplete="off"></label>
    <div class="pb"><button type="button" class="secondary-btn small" data-cancel>Cancel</button><button type="submit" class="primary-btn small">Record payment</button></div>
  </form>`;
  const f = veil.firstChild, r = btn.getBoundingClientRect();
  f.style.width = Math.min(380, innerWidth - 24) + 'px';
  document.body.append(veil);
  f.style.left = Math.max(12, Math.min(innerWidth - f.offsetWidth - 12, r.right - f.offsetWidth)) + 'px';
  f.style.top = Math.max(8, Math.min(innerHeight - f.offsetHeight - 8, r.top)) + 'px';
  const shrink = growFrom(f, r);
  btn.setAttribute('aria-expanded', 'true');
  // "1,000" and "₱ 1,000" read as 1000; "-50", "1e3" or "1.2.3" read as nothing. The button says what will be recorded
  const amount = () => {
    const s = f.amount.value.replace(/[,\s₱]/g, '');
    return /^(\d+\.?\d*|\.\d+)$/.test(s) ? moneyValue(s) : 0;
  };
  const sync = () => {
    const a = amount(), ok = f.querySelector('[type="submit"]');
    ok.disabled = !(a > 0);
    ok.textContent = a > 0 ? `Record ${peso(a)}` : 'Record payment';
  };
  // Keys go through the document while the sheet is open: Tab wraps inside it (focus can't reach the page under
  // the veil) and Esc closes it wherever focus sits.
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); return close(); }
    if (e.key !== 'Tab') return;
    const els = [...f.elements].filter(x => x.tagName !== 'FIELDSET' && !x.disabled), i = els.indexOf(document.activeElement);
    if (i < 0 || i === (e.shiftKey ? 0 : els.length - 1)) { e.preventDefault(); els[e.shiftKey ? els.length - 1 : 0].focus(); }
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    btn.setAttribute('aria-expanded', 'false');
    veil.style.pointerEvents = 'none';
    shrink(() => veil.remove());
    btn.focus({ preventScroll: true });
  };
  sync();
  f.amount.focus({ preventScroll: true });
  f.addEventListener('input', sync);
  f.addEventListener('change', (e) => {   // ticking receipts fills the amount with what they owe
    if (e.target.name !== 'order') return;
    const n = [...f.querySelectorAll('[name="order"]:checked')].reduce((a, b) => a + Number(b.dataset.left), 0);
    f.amount.value = n ? moneyValue(n).toFixed(2) : '';
    sync();
  });
  veil.addEventListener('click', (e) => {
    if (e.target === veil || e.target.closest('[data-cancel]')) return close();
    if (e.target.closest('[data-full]')) {
      f.querySelectorAll('[name="order"]').forEach(b => { b.checked = false; });
      f.amount.value = moneyValue(Math.max(0, c.currentBalance || 0)).toFixed(2);
      sync();
    }
  });
  document.addEventListener('keydown', onKey, true);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (veil.style.pointerEvents) return;   // closing already: a second Enter must not write a second payment
    const a = amount(), m = f.method.value;
    if (!(a > 0)) { showToast('Enter an amount above 0'); return f.amount.focus(); }
    const [method, methodLabel] = PAY_BUILTINS.includes(m) || m === 'other' ? [m, ''] : ['other', m];   // a custom name is saved as its own label
    if (!recordCreditPayment(c.id, a, { method, ...(methodLabel && { methodLabel }), note: f.note.value.trim(),
      orderIds: [...f.querySelectorAll('[name="order"]:checked')].map(b => b.value) })) return;
    close();
    showToast(`${peso(a)} recorded`);
  });
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

