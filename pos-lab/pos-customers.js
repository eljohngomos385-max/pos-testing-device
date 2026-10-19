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
      ${row('Balance', peso(c.currentBalance || 0), over ? 'num amt over' : 'num amt')}
      ${row('Available credit', limitText(c) || `${peso(creditRoom(c))} <small>of ${peso(c.creditLimit)}</small>`, 'num amt')}</section>
    <h3 class="fc-t">Recent orders${orders.length > 10 ? `<button type="button" class="link" data-customer-detail>See all ${orders.length}</button>` : ''}</h3><section class="card fc fc-rows">
      ${orders.length ? orders.slice(0, 10).map(orderRow).join('') : '<div class="note">No orders yet</div>'}</section>
  </div>`;
}

// Record payment, the back office's (openPaymentDialog) on the till: a card in the middle of the screen. The amount
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
    .concat(payCustomOn().map(n => [n, n]), [['other', SalesMath.tenderLabel('other')]]);
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
  const f = veil.firstChild;
  f.style.width = Math.min(380, innerWidth - 24) + 'px';
  document.body.append(veil);
  const shrink = centreSheet(f);
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
    const row = recordCreditPayment(c.id, a, { method, ...(methodLabel && { methodLabel }), note: f.note.value.trim(),
      orderIds: [...f.querySelectorAll('[name="order"]:checked')].map(b => b.value) });
    if (!row) return;
    close();
    showDone(`${peso(a)} recorded`, () => {
      const store = currentStoreInfo();
      undoPayment(row, { register: store.registerNo, staff: store.cashier });
      renderCustomers(); updateCustomerButton(); showDone('Payment undone');
    });
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
// monochrome theme); a store's own method wears Other's.
const PAY_KEYS = ['cash', 'gcash', 'qr', 'credit', 'other'];
const payBucket = k => (PAY_KEYS.includes(k) ? k : 'other');
const payColor = k => `var(--pm-${payBucket(k)})`;
const orderTenderKeys = o => SalesMath.paymentsOf(o).map(p => p.key);

// Reports (owner 2026-10-09; the look and layout = reports-lab.html v5, owner 2026-10-15): how the store is doing over a
// day, week or month -- the sales with a chart, Profit · Orders · Margin, the five best items and categories, the methods,
// the breakdown; no comparing, that is the back office's (owner 2026-10-15). The date sits over the number, a ‹ date › bar
// pins under the title once it scrolls away, a past period has Show Today top-right ("Apple v3", owner 2026-10-15); a swipe steps.
// Only for whoever may "See the day's totals" (canAccess). Every figure is SalesMath's, the back office's: summarize (net
// of voids and refunds), topItems, tenders, on the store's days (tillDay).
const reportsView = { unit: 'day', back: 0, bars: [], pick: null };   // back = periods before the current one; bars = the chart's

// The period `back` steps before the current one: [a, b) as store days, in ms, and its words (Screen Time's: "Today,
// October 15", "Last week", "September 2026"). A week starts on Monday, as the back office's calendar does.
function reportsPeriod(unit = reportsView.unit, back = reportsView.back) {
  const today = tillDay(Date.now()), add = SalesMath.addDays;
  const [y, m] = today.split('-').map(Number), iso = (yy, mm) => new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10);
  const a = unit === 'day' ? add(today, -back)
    : unit === 'week' ? add(today, -((SalesMath.dateParts(today).weekday + 6) % 7) - 7 * back)
    : iso(y, m - 1 - back);
  const b = unit === 'day' ? add(a, 1) : unit === 'week' ? add(a, 7) : iso(+a.slice(0, 4), +a.slice(5, 7));
  const last = add(b, -1), yr = a.slice(0, 4) !== today.slice(0, 4);   // another year says so (a week: the year it ends in)
  const long = o => new Date(a + 'T00:00:00Z').toLocaleString('en-US', { timeZone: 'UTC', ...o });
  const label = unit === 'day' ? `${back === 0 ? 'Today' : back === 1 ? 'Yesterday' : long({ weekday: 'long' })}, ${long({ month: 'long', day: 'numeric', ...(yr && { year: 'numeric' }) })}`
    : unit === 'week' ? (back === 0 ? 'This week' : back === 1 ? 'Last week' : `${tillDate(a, 'day')}${a.slice(0, 4) !== last.slice(0, 4) ? ', ' + a.slice(0, 4) : ''} – ${a.slice(5, 7) === last.slice(5, 7) ? +last.slice(8) : tillDate(last, 'day')}${yr || last.slice(0, 4) !== today.slice(0, 4) ? ', ' + last.slice(0, 4) : ''}`)
    : long({ month: 'long', year: 'numeric' });
  return { a, b, from: SalesMath.dayStartMs(a, tillZone()), to: SalesMath.dayStartMs(b, tillZone()), label };
}

// A period's figures: the summary (m), its groups (g) and the chart's bars -- the page's, and a swipe's neighbour chart.
function reportsFigures(unit = reportsView.unit, back = reportsView.back) {
  const today = tillDay(Date.now()), p = reportsPeriod(unit, back), win = { from: p.from, to: p.to }, live = !back, zone = tillZone();
  const costOf = i => productOf(i)?.cost;   // a line sold before cost was stamped on it: the item's cost now (the BO's costOf)
  // One pass, four keys a line (owner 2026-10-09): 'c' = the lines with a cost on file (a cost of ₱0 is on file), so profit
  // and margin leave out what has no cost rather than count it at ₱0; 'n' = the orders, an exchange's new sale (and its
  // void) not one -- the customer swapped, they didn't buy again; the chart's bar: the hour (a number) or the day; 'g:' =
  // the item's first category (categoryOf), the back office's Top categories, so the rows add up to Net sales.
  const swaps = new Set(state.orders.filter(SalesMath.isExchange).map(o => o.id));
  // an hour: the back office's rule (chartTime) -- a void on its sale's day sits in the sale's hour, so the two cancel there
  const saleTs = new Map(state.orders.map(o => [o.id, o.ts]));
  const barOf = unit === 'day' ? o => SalesMath.dateParts(SalesMath.chartTime(o, saleTs, zone), zone).hour : o => tillDay(o.ts);
  const m = SalesMath.summarize(state.orders, { ...win, costOf, by: (o, i) => [(i.cost ?? costOf(i)) != null ? 'c' : null,
    swaps.has(o.id) || (o.status === 'void' && swaps.has(o.originalOrderId)) ? null : 'n', barOf(o), 'g:' + categoryOf(productOf(i))] });
  const g = m.groups, c = g.get('c'), orders = g.get('n')?.orders || 0;
  // The bars: the store's hours (7 AM to 8 PM, wider when a sale fell outside), the week's days, the month's days
  const bars = [];
  if (unit === 'day') {
    const hrs = [...g.keys()].filter(k => typeof k === 'number'), hNow = live ? SalesMath.dateParts(Date.now(), zone).hour : 24;
    for (let h = Math.min(7, ...hrs); h <= Math.max(20, ...hrs); h++) {
      const h12 = h % 12 || 12, am = h < 12;
      bars.push({ k: h, x: h % 3 === 1 ? `${h12} ${am ? 'AM' : 'PM'}` : '', tip: `${h12} ${am ? 'AM' : 'PM'}`, fut: h > hNow, cur: h === hNow });
    }
  } else for (let d = p.a; d < p.b; d = SalesMath.addDays(d, 1)) bars.push({ k: d, day: d, x: unit === 'week' ? tillDate(d, 'weekday') : +d.slice(8) % 7 === 1 ? +d.slice(8) : '', tip: tillDate(d, 'weekdayDay'), fut: d > today, cur: d === today });   // a month: the 1st, 8th, 15th, 22nd, 29th
  for (const b of bars) b.v = g.get(b.k)?.netSales || 0;
  return { today, p, win, live, zone, costOf, m, g, c, orders, bars };
}
// The chart a swipe pulls in: `dir` +1 the later period, −1 the earlier one
const reportsNear = dir => { const f = reportsFigures(reportsView.unit, reportsView.back - dir); return reportsChart(f.bars, reportsView.unit, f.live); };

// slide: +1 the figures come in from the right (a later period), −1 from the left; 'still' = a swipe already brought the
// chart in, so nothing slides or grows
function renderReports(slide) {
  const body = $('#reportsBody');
  if (!body) return;
  state.orders = loadOrders();
  reportsLive._sig = reportsSignature();
  reportsLive._day = tillDay(Date.now());
  const { unit, back } = reportsView, { today, p, win, live, zone, costOf, m, g, c, orders, bars } = reportsFigures();
  body.classList.toggle('rp-still', slide === 'still');
  Object.assign(reportsView, { bars, pick: null });
  const chart = reportsChart(bars, unit, live), cur = state.settings?.store?.currency, short = n => SalesMath.formatMoney(n, cur, { compact: true });
  // Target (the back office's block, owner 2026-10-15): today on Day, this month on Month; a past period or a week has none
  const tg = live && unit !== 'week' && reportsTarget(today, zone), goal = tg && (unit === 'day' ? tg.day : tg.month);
  const whole = n => (Math.abs(n) < 1e6 ? peso(Math.round(n)).replace(/\.0+$/, '') : short(n));   // ₱25,946 / ₱30,000; a million on, ₱1.2M
  const sold = whole(m.netSales), of = whole(goal), pct = goal && SalesMath.pctText(SalesMath.share(m.netSales, goal), goal, 0), up = m.netSales >= goal;
  const target = !goal ? '' : `<section class="card fc"><div class="rp-tg"><div class="rp-ttl"><b>Target</b></div>
      <div class="rp-tl"><span class="num" style="--n:${(sold + of + pct).length + 4}">${sold}<small>/ ${of}</small></span><b class="num${up ? ' up' : ''}">${pct}</b></div>
      <div class="rp-meter"><i class="${up ? 'up' : ''}" style="width:${Math.min(1, m.netSales / goal) * 100}%"></i></div>
      <div class="rp-left"><span>${up ? 'Target hit, over by' : `Left to sell ${unit === 'day' ? 'today' : 'this month'}`}</span><b class="num">${peso(Math.abs(goal - m.netSales))}</b></div></div></section>`;
  // a row, the Items page's: the picture, the name over a grey line, the amount
  const li = (thumb, name, sub, v) => `<div class="rp-li">${thumb}<div class="rp-tm"><div class="rp-tn">${escapeHtml(name)}</div><div class="rp-ts num">${sub}</div></div><b class="rp-tv num">${peso(v)}</b></div>`;
  // The five best (the full lists are the back office's job); a renamed item: its name now
  const tops = SalesMath.topItems(state.orders, { ...win, costOf }).slice(0, 5).map(r => {
    const it = productOf({ id: r.key }), name = it?.name || r.name || '', look = it ? itemLook(it) : {};
    return li(itemThumb({ name, img: look.img, hue: look.hue ?? itemHue(it?.folder) }), name, `${SalesMath.qtyText(r.unitsSold)} sold`, r.netSales);
  }).join('');
  // categories as the back office ranks them (Top categories): by Net sales, each its share of the period's
  // ponytail: kept when the category sold a unit net; the BO's when one of its items did -- they differ only when returns
  // outnumber sales in a category; add per-item keys if that ever shows
  const cats = [...g].filter(([k, x]) => String(k).startsWith('g:') && x.unitsSold > 0).sort((x, y) => y[1].netSales - x[1].netSales).slice(0, 5).map(([k, x]) => {
    const id = k.slice(2), name = folderName(id);
    return li(itemThumb({ name, hue: itemHue(id) }), name, `${SalesMath.pctText(SalesMath.share(x.netSales, m.netSales), m.netSales, 0)} of sales`, x.netSales);
  }).join('');
  // By method, biggest first: four rows at most -- past four, the top three and the rest as Other (the full split is the BO's)
  let pays = [...SalesMath.tenders(state.orders, win)].map(([k, v]) => ({ k, v })).sort((x, y) => y.v - x.v);
  if (pays.length > 4) { const keep = pays.filter(r => r.k !== 'other').slice(0, 3); pays = [...keep, { k: 'other', v: pays.filter(r => !keep.includes(r)).reduce((n, r) => n + r.v, 0) }]; }
  const all = pays.reduce((n, r) => n + r.v, 0), none = '<div class="rp-none">No sales</div>';
  // By method + Breakdown: Shift's rows (owner 2026-10-17) -- the word grey, the money dark; every line, ₱0.00 too
  const fr = (lb, v) => `<div class="fr"><span class="lb">${lb}</span><span class="v num amt">${v}</span></div>`;
  // Breakdown: the back office's ladder (sales-terms) -- Gross sales less voids, refunds and discounts is Net sales
  const nOf = n => (n ? ` <small>· ${n}</small>` : '');
  const ladder = m.grossSales || m.voids || m.refunds ? fr('Gross sales', peso(m.grossSales)) + fr('Voids' + nOf(m.voidCount), peso(-m.voids))
    + fr('Refunds' + nOf(m.refundCount), peso(-m.refunds)) + fr('Discounts', peso(-m.discounts)) + fr('<b>Net sales</b>', `<b>${peso(m.netSales)}</b>`) : none;
  const arw = (s, label, path, off) => `<button type="button" class="rp-arw" data-rp="${s}" aria-label="${label}"${off ? ' disabled' : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></button>`;
  // ponytail: a third of a phone fits ₱999,999.99; a profit of a million or more reads ₱1.23M (the Sales number stays exact)
  const stat = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  // "Sales" inside the card, the date on its right (reports-top-lab option 1, owner 2026-10-15); a tap on the date comes back
  // to now. The number keeps 32px and steps down only when its characters would run past the card (--n).
  body.innerHTML = `<section class="card fc"><div class="rp-ov"><div class="rp-per rp-ttl"><b>Sales</b><button type="button" class="rp-pl">${p.label}</button></div>
      <div class="rp-big"><b class="num" style="--n:${peso(m.netSales).length}">${peso(m.netSales)}</b></div>
      <div class="rp-chart"><div class="rp-slide">${chart}</div></div>
      <div class="rp-stats num">${stat('Profit', !c ? '—' : Math.abs(c.grossProfit) < 1e6 ? peso(c.grossProfit) : short(c.grossProfit))}${stat('Orders', SalesMath.qtyText(orders))}${stat('Margin', c ? SalesMath.pctText(c.margin, c.salesBeforeTax, 0) : '—')}</div></div></section>`
    + target
    + icard('Top items', tops || none)
    + icard('Top categories', cats || none)
    // a plain ranking: the method, its money, its share -- no bar, no colours (owner 2026-10-15)
    + icard('By method', pays.length ? pays.map(r => fr(escapeHtml(SalesMath.tenderLabel(r.k)), `${peso(r.v)} <small class="rp-tp">${SalesMath.pctText(SalesMath.share(r.v, all), all, 0)}</small>`)).join('') : none, '', ' r')
    + icard('Breakdown', ladder, '', ' r');
  // the header: Show Today on a past period; the ‹ date › bar that pins under it once the date scrolls away (reportsPin)
  const now = $('.view-reports .rp-now');
  now.hidden = live;
  now.textContent = `Show ${{ day: 'Today', week: 'This Week', month: 'This Month' }[unit]}`;
  $('#reportsPin').innerHTML = `${arw(-1, 'Earlier', 'M15 18l-6-6 6-6')}<button type="button" class="rp-pl">${p.label}</button>${arw(1, 'Later', 'M9 18l6-6-6-6', live)}`;
  reportsPin();
  body.classList.remove('slide-l', 'slide-r');
  if (slide === 1 || slide === -1) { void body.offsetWidth; body.classList.add(slide > 0 ? 'slide-l' : 'slide-r'); }   // restart the slide
}

// The Sales chart, Screen Time's (owner 2026-10-15): lines at 0 and three round steps (1, 2, 5 × 10ⁿ, never under 1), short
// labels right of the plot; a dotted line up from each labelled hour or day, its label just right of it (a week labels every
// day: no lines). bars = [{ v, x, tip, fut, cur }]. chart-labels-lab.html draws it in every currency.
function reportsChart(bars, unit, live) {
  if (!bars.some(b => b.v)) return `<div class="rp-cols"><div class="rp-msg">${live ? 'No sales yet' : 'No sales'}</div></div>`;
  const cur = state.settings?.store?.currency, short = n => SalesMath.formatMoney(n, cur, { compact: true });
  const top = Math.max(0, ...bars.map(b => b.v)), mag = 10 ** Math.max(0, Math.floor(Math.log10(top / 3)));
  // 3, 4, 6, 8 too (owner 2026-10-17): with only 1-2-5 a ₱85k peak topped out at ₱150k, half the chart empty.
  const step = [1, 2, 3, 4, 5, 6, 8, 10].map(s => s * mag).find(s => s * 3 >= top), max = 3 * step;
  // compact money starts at 10k; 1k-9.5k are ours, so ₱1,500 reads ₱1.5k (not ₱2k). No spaces: "Rp 500" would sit over "Rp1k"
  const ax = n => (n >= 1e3 && n < 1e4 ? SalesMath.currencySymbol(cur) + n / 1e3 + 'k' : short(n)).replace(/\s/g, '');
  const tk = b => (b.x !== '' && unit !== 'week' ? ' tk' : '');
  // the labels' gutter: the longest one's real width (₱, $, ¥, RM, AED all differ) + the 5px gap
  const yl = ['0', ax(step), ax(2 * step), ax(max)], yw = Math.max(...yl.map(rpTextW)) + 5;
  return `<div class="rp-bars" style="--yw:${yw}px"><div class="rp-cols">${yl.map((l, j) => `<div class="rp-gl" style="bottom:${j / 3 * 100}%"><span class="num">${l}</span></div>`).join('')}${bars.map((b, i) => `<button type="button" class="rp-col${tk(b)}" data-i="${i}"${b.fut ? ' disabled' : ''} aria-label="${b.tip}"><i style="height:${Math.max(0, b.v) / max * 100}%;animation-delay:${i * 18}ms"></i></button>`).join('')}</div>
       <div class="rp-xax">${bars.map(b => `<span class="${tk(b)}${b.cur ? ' cur' : ''}">${b.x}</span>`).join('')}</div></div>`;
}
// a label's width in the chart's 11px type; +2 for tabular digits, which canvas can't set. ponytail: measured in the page's
// font, so a web font still loading on the very first draw measures a hair off
function rpTextW(t) {
  const c = rpTextW.c ||= document.createElement('canvas').getContext('2d');
  c.font = `11px ${getComputedStyle(document.body).fontFamily}`;
  return Math.ceil(c.measureText(t).width) + 2;
}

// Today's target, the back office's (dashTargets): the owner's month target; today's share is what is left of it spread over
// the days left, today included, rounded to ₱10 -- unless an override names today. null with no month target.
function reportsTarget(today, zone) {
  const t = state.settings?.targets || {}, month = Number(t.month) || 0;
  if (!month) return null;
  const d = SalesMath.dateParts(Date.now(), zone), days = new Date(Date.UTC(d.year, d.month, 0)).getUTCDate();
  const before = SalesMath.summarize(state.orders, { from: SalesMath.dayStartMs(today.slice(0, 8) + '01', zone), to: SalesMath.dayStartMs(today, zone) }).netSales;
  const auto = Math.max(0, Math.round((month - before) / (days - d.day + 1) / 10) * 10);
  return { month, day: (t.override?.date === today && Number(t.override.amount)) || auto };
}

// The ‹ date › bar under the title (Screen Time's): on once the date over the number has scrolled under it
function reportsPin() {
  const pin = $('#reportsPin'), per = $('#reportsBody .rp-per');
  pin.classList.toggle('on', !!per && per.getBoundingClientRect().bottom < pin.getBoundingClientRect().bottom);
}

// Month as a calendar (reports-lab v5): not drawn -- Month shows daily bars for now; the owner said keep it (2026-10-15).
// ponytail: dead code on purpose; renderReports' chart takes `reportsCalendar(bars, p.a)` to bring it back.
function reportsCalendar(bars, a) {
  const short = n => SalesMath.formatMoney(n, state.settings?.store?.currency, { compact: true });
  return `<div class="rp-cw">${[...'MTWTFSS'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="rp-cg">${'<span></span>'.repeat((SalesMath.dateParts(a).weekday + 6) % 7)}${bars.map((b, i) => `<button type="button" class="rp-cc${b.cur ? ' now' : ''}" data-i="${i}"${b.fut ? ' disabled' : ''} aria-label="${b.tip}"><b>${+b.day.slice(8)}</b><span class="num">${b.v ? short(b.v) : '&nbsp;'}</span></button>`).join('')}</div>`;
}

// A tapped (or dragged-to) bar: the others dim, its number in a tip over it; a day's tip has a › and opens that day.
function reportsPick(i) {
  const host = $('#reportsBody .rp-bars');
  if (!host) return;
  reportsView.pick = i;
  host.classList.toggle('picked', i != null);
  host.querySelector('.rp-tip')?.remove();
  host.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('on', +el.dataset.i === i));
  if (i == null) return;
  const b = reportsView.bars[i], bar = host.querySelector(`[data-i="${i}"] i`), tip = document.createElement('div');
  tip.className = 'rp-tip' + (b.day ? ' go' : '');
  tip.innerHTML = `<span>${b.tip}</span><b class="num">${peso(b.v)}</b>${b.day ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>' : ''}`;
  host.append(tip);
  const pr = host.getBoundingClientRect(), r = bar.getBoundingClientRect();
  tip.style.left = Math.max(0, Math.min(pr.width - tip.offsetWidth, r.left - pr.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
  tip.style.top = (r.top - pr.top - tip.offsetHeight - 6) + 'px';   // .rp-cols' top padding keeps the tallest bar's tip inside
}

// Day | Week | Month starts at the current period, ‹ › step one, a day on the chart opens as its own Day.
// The page keeps its place (owner 2026-10-15): a shorter period clamps the scroll, so `y` keeps where the reader was and
// the next longer one comes back to it -- Today › Yesterday › Today lands where it started.
function reportsGo(unit, back, slide) {
  if (unit !== reportsView.unit) slidePill($('#reportsUnits'), 'unit', unit);
  const sc = $('.view-reports .c-scroll');
  if (sc.scrollTop < sc.scrollHeight - sc.clientHeight - 1 || !(reportsView.y > sc.scrollTop)) reportsView.y = sc.scrollTop;   // not clamped: the reader's own place
  Object.assign(reportsView, { unit, back: Math.max(0, back) });
  renderReports(slide);
  sc.scrollTop = reportsView.y;
  reportsPin();
}
const reportsOpenDay = day => reportsGo('day', Math.round((Date.parse(tillDay(Date.now())) - Date.parse(day)) / 864e5), 1);

// Live updates while Reports is open: the orders changed (another tab, a sync), or the store's day turned over.
function reportsLive() {
  if (state.view !== 'reports') return;
  if (!canAccess('reports')) return applyRoleGating();   // "See the day's totals" taken away meanwhile: back to Sell
  if ($('#reportsBody .swiping')) return;   // mid-swipe: the next tick redraws
  if (reportsSignature() !== reportsLive._sig || tillDay(Date.now()) !== reportsLive._day) renderReports();
}
reportsLive._sig = '';
