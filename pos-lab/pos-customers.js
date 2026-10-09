// Till › Customers, and Reports.

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

  // The Orders rail with no head (owner 2026-10-09): name + phone, the balance only when owed.
  if (list) {
    list.innerHTML = !filtered.length
      ? `<div class="empty"><b>${q ? 'No matches' : 'No customers yet'}</b><span>${q ? 'Try a different name or phone.' : 'Tap + to add your first customer.'}</span></div>`
      : filtered.map(c => `<button type="button" class="row${c.id === state.selectedCustomerId ? ' cur' : ''}" data-customer-id="${escapeHtml(c.id)}">
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
  ttl.innerHTML = '';   // the name is the card's first row (owner 2026-10-09): the top bar keeps only Back and the actions
  const row = (lb, v, cls = '') => `<div class="fr"><span class="lb">${lb}</span><span class="v ${cls}">${v}</span></div>`;
  const lim = over ? ' <span class="lim">Over limit</span>' : status === 'Near limit' ? ' <span class="lim warn">Near limit</span>' : '';
  const contact = row('Name', escapeHtml(c.name) + lim) + [['Phone', c.phone, 'num'], ['Email', c.email], ['Address', c.address]]
    .filter(f => f[1]).map(([lb, v, cls]) => row(lb, escapeHtml(v), cls)).join('');   // an empty one is left out, not "—"
  const orders = customerOrders(c.id).filter(o => !SalesMath.isReversal(o));   // one row per sale, as in Orders
  const orderRow = o => {
    const amt = orderRowAmt(o, reversalsOf(o));   // as Orders shows it
    return `<button type="button" class="row${orderStruck(o) ? ' void' : ''}" data-order-id="${escapeHtml(o.id)}">
      <div class="nm">${orderTitleHtml(o)}<small class="num">${fmtOrderDate(o.ts)} · ${SalesMath.plural((o.items || []).length, 'item')}</small></div>
      <div class="rt"><span class="amt num">${amt == null ? '—' : peso(amt)}</span><small>${escapeHtml(orderPayText(o))}</small></div></button>`;
  };
  body.innerHTML = `<div class="c-body">
    <section class="card fc r">${contact}</section>
    <section class="card fc r">
      ${row('Balance', peso(c.currentBalance || 0), over ? 'num over' : 'num')}
      ${row('Available credit', limitText(c) || `${peso(creditRoom(c))} <small>of ${peso(c.creditLimit)}</small>`, 'num')}</section>
    <h3 class="fc-t">Recent orders${orders.length > 10 ? `<button type="button" class="link" data-customer-detail>See all ${orders.length}</button>` : ''}</h3><section class="card fc c-ord">
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
// Colours are the --pm-* tokens (the Orders Payment filter; a deliberate data-viz exception to the
// monochrome theme); a store's own method wears Other's. payRank: the one order methods are listed in.
const PAY_KEYS = ['cash', 'gcash', 'qr', 'credit', 'other'];
const payBucket = k => (PAY_KEYS.includes(k) ? k : 'other');
const payColor = k => `var(--pm-${payBucket(k)})`;
const payRank = k => PAY_KEYS.indexOf(payBucket(k));
const orderTenderKeys = o => SalesMath.paymentsOf(o).map(p => p.key);

// Reports (owner 2026-10-09): how the store is doing over a day, week or month; ‹ › (or a swipe) steps
// back. Only for whoever may "See the day's totals" (canAccess). Every figure is SalesMath's, the back
// office's: summarize (net of voids and refunds), topItems, tenders, on the store's days (tillDay).
const REPORT_UNITS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const reportsView = { unit: 'day', back: 0, q: '' };   // back = periods before the current one; q = the head's search

// The period `back` steps before this one: [a, b) as store days, and its words. A week starts on Monday,
// as the back office's calendar does.
function reportsPeriod() {
  const { unit, back } = reportsView, today = tillDay(Date.now()), add = SalesMath.addDays;
  const [y, m] = today.split('-').map(Number), iso = (yy, mm) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const a = unit === 'day' ? add(today, -back)
    : unit === 'week' ? add(today, -((SalesMath.dateParts(today).weekday + 6) % 7) - 7 * back)
    : iso(y, m - 1 - back);
  const b = unit === 'day' ? add(a, 1) : unit === 'week' ? add(a, 7) : iso(+a.slice(0, 4), +a.slice(5, 7));
  const last = add(b, -1), yr = a.slice(0, 4) !== today.slice(0, 4);   // another year says so
  const label = unit === 'day' ? (back === 0 ? `Today, ${tillDate(a, 'day')}` : back === 1 ? 'Yesterday' : tillDate(a, yr ? 'weekdayDayYear' : 'weekdayDay'))
    : unit === 'week' ? (back === 0 ? 'This week' : `${tillDate(a, 'day')} – ${a.slice(5, 7) === last.slice(5, 7) ? +last.slice(8) : tillDate(last, 'day')}${yr ? ', ' + a.slice(0, 4) : ''}`)
    : back === 0 ? 'This month' : new Date(a + 'T00:00:00Z').toLocaleString('en-US', { month: 'long', timeZone: 'UTC', ...(yr && { year: 'numeric' }) });
  return { from: SalesMath.dayStartMs(a, tillZone()), to: SalesMath.dayStartMs(b, tillZone()), label };
}

function renderReports() {
  const body = $('#reportsBody');
  if (!body) return;
  state.orders = loadOrders();
  reportsLive._sig = reportsSignature();
  reportsLive._day = tillDay(Date.now());
  const p = reportsPeriod(), win = { from: p.from, to: p.to };
  const costOf = i => productOf(i)?.cost;   // a line sold before cost was stamped on it: the item's cost now (the BO's costOf)
  const m = SalesMath.summarize(state.orders, { ...win, costOf });
  const q = reportsView.q.trim().toLowerCase();
  const top = SalesMath.topItems(state.orders, { ...win, costOf }).filter(r => !q || String(r.name).toLowerCase().includes(q)).slice(0, 5);
  const by = [...SalesMath.tenders(state.orders, win)].sort((x, y) => payRank(x[0]) - payRank(y[0]));
  // No cost on file for anything sold: profit would read as the whole sale, so it says '—', as margin
  // does with nothing sold (pctText). ponytail: a period where only some items have a cost still counts the rest at ₱0.
  const known = m.costOfGoods !== 0;
  const row = (lb, v) => `<div class="fr"><span class="lb">${lb}</span><span class="v num">${v}</span></div>`;
  const none = words => `<div class="fr"><span class="lb ph">${words}</span></div>`;
  const stat = (lb, v) => `<div><span>${lb}</span><b class="num">${v}</b></div>`;
  const step = (d, words, path, off) => `<button type="button" data-rp="${d}" aria-label="${words}"${off ? ' disabled' : ''}><svg class="ic" viewBox="0 0 24 24"><path d="${path}"/></svg></button>`;
  $('#reportsPeriod span').textContent = REPORT_UNITS.find(u => u[0] === reportsView.unit)[1];
  body.innerHTML = `<div class="c-body">
    <div class="rp-step">${step(-1, 'Earlier', 'M15 6l-6 6 6 6')}<b>${escapeHtml(p.label)}</b>${step(1, 'Later', 'M9 6l6 6-6 6', !reportsView.back)}</div>
    ${icard('', `<div class="rp-stats">${stat('Sales', peso(m.netSales))}${stat('Profit', known ? peso(m.grossProfit) : '—')}
      ${stat('Margin', known ? SalesMath.pctText(m.margin, m.salesBeforeTax, 0) : '—')}${stat('Orders', SalesMath.qtyText(m.orders))}</div>`)}
    ${icard('Top items', top.map(r => row(escapeHtml(r.name), peso(r.netSales))).join('') || none(q ? 'No items match' : 'No sales'), '', ' rp-list')}
    ${icard('By method', by.map(([k, n]) => row(escapeHtml(SalesMath.tenderLabel(k)), peso(n))).join('') || none('No sales'), '', ' rp-list')}
  </div>`;
}

// ‹ (d −1, earlier) / › (d +1, later); a unit picked from Day ▾ starts at the current period.
function reportsStep(d, unit) {
  if (unit) { reportsView.unit = unit; reportsView.back = 0; } else reportsView.back = Math.max(0, reportsView.back - d);
  renderReports();
}

// Live updates while Reports is open: the orders changed (another tab, a sync), or the store's day turned over.
function reportsLive() {
  if (state.view !== 'reports') return;
  if (reportsSignature() !== reportsLive._sig || tillDay(Date.now()) !== reportsLive._day) renderReports();
}
reportsLive._sig = '';
