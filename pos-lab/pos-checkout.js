// Till › Checkout: payment, the order record, stock moves, success, printing, saved receipts,
// account credit, the manager PIN / sign-in, and completeSale.

// ---------- Payment (full-page Checkout view) ----------
function openPaymentModal() {
  if (state.cart.length === 0) return;
  state.prevView = state.view;
  state.paymentMethodChosen = false;
  track('checkout_open', { lines: state.cart.length, subtotal: cartTotals().subtotal });
  switchView('checkout');
  renderCheckout();
}
function renderCheckout() {
  const t = cartTotals();
  const total = t.total;

  const cartList = $('#checkoutCartList');
  if (cartList) {
    cartList.innerHTML = state.cart.map(item => `
      <div class="co-row">
        <span class="co-nm">${escapeHtml(item.name)}<small class="num">${item.qty} × ${peso(item.price)}</small></span>
        <span class="co-amt num">${peso(normalizeOrderItem(item).lineGross)}</span>
      </div>`).join('');
  }
  const discRow = $('#checkoutDiscountRow');
  if (discRow) discRow.hidden = !(t.discount > 0);
  const discEl = $('#checkoutDiscount');
  if (discEl) discEl.textContent = peso(-t.discount);
  const discLabel = $('#checkoutDiscountLabel');
  if (discLabel) discLabel.textContent = 'Discount';
  const totalEl = $('#checkoutTotal');
  if (totalEl) totalEl.textContent = peso(total);
  $('#checkoutCount').textContent = $('#railCount').textContent;
  const totalDue = $('#checkoutTotalDue');
  if (totalDue) totalDue.textContent = peso(total);

  setCheckoutError('');
  if (!canCharge() && (state.paymentMethod === 'credit' || state.paymentMethod === 'split')) {
    state.paymentMethod = 'cash';
  }
  // You can only charge a named account with credit on, so the two credit tiles appear with it.
  applyPayMethods(canCharge());
  renderQuickCashOptions(total);
  if (!state.paymentMethodChosen) state.paymentMethod = 'cash';
  $('#checkoutApp')?.classList.remove('is-done');
  const steps = $('#checkoutSteps'); if (steps) steps.hidden = false;
  const done = $('#checkoutDone'); if (done) done.hidden = true;
  const tender = $('#checkoutTender'); if (tender) tender.value = '';
  showPayStep();
  renderCheckoutSub();
}

// Which cards the checkout shows is the back office's call (Manage -> Payments):
// settings.payments = { hidden: [kind], custom: [name] }. Cash can't be hidden -- the drawer
// is cash. A custom name records exactly like typing it into Other (paymentKind 'other').
const coIcon = d => `<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const PAY_TILES = [
  ['cash', 'Cash', coIcon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7"/><circle cx="12" cy="14" r="3"/>')],
  ['gcash', 'GCash', coIcon('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01" stroke-width="2.4"/>')],
  ['qr', 'QR', coIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2v2h2M18 14h3M18 18h1v1h1v2M21 14v2M14 18v3h2"/>')],
  ['other', 'Other', coIcon('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>')],
  ['credit', 'Account', coIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>')],
  ['split', 'Split', coIcon('<path d="M12 3v18M4 7h5M4 12h5M15 9h5M15 15h5"/>')],
];
const CUSTOM_PAY_ICON = coIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="2.5"/>');
function applyPayMethods(canCharge) {
  const grid = $('#checkoutMethods');
  if (!grid) return;
  const pay = state.settings.payments || {};
  const off = new Set(pay.hidden || []);
  const needsAccount = m => m === 'credit' || m === 'split';
  const shown = PAY_TILES.filter(([m]) => m === 'cash' || (!off.has(m) && (canCharge || !needsAccount(m))));
  const custom = (pay.custom || []).map(name => ['other', name, CUSTOM_PAY_ICON, name]);
  const at = shown.findIndex(([m]) => needsAccount(m));
  const tiles = at < 0 ? [...shown, ...custom] : [...shown.slice(0, at), ...custom, ...shown.slice(at)];
  // How many across the count wants: 4 -> 2x2, 6 -> 3x2, 8 -> 4x2. One tile size at any count.
  grid.style.setProperty('--cols', tiles.length <= 4 ? 2 : tiles.length <= 6 ? 3 : 4);
  grid.innerHTML = tiles.map(([m, label, icon, name]) =>
    `<button type="button" class="co-tile" data-co-method data-method="${m}"${name ? ` data-label="${escapeHtml(name)}"` : ''}>${icon}<span>${escapeHtml(label)}</span></button>`).join('');
}

// Who this sale is for, on top of the list it belongs to.
function renderCheckoutSub() {
  const sub = $('#checkoutSub');
  if (sub) sub.textContent = state.customer ? state.customer.name : 'Walk-in customer';
}

// Under the fixed total: the method tiles, or the chosen method's one detail.
function showPayStep() {
  const m = state.paymentMethod;
  const step = !state.paymentMethodChosen ? 'method' : (m === 'cash' || m === 'split') ? 'cash' : 'paid';
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== step; });
  const backText = $('#checkoutBackText'); if (backText) backText.textContent = step === 'method' ? 'Cancel' : 'Back';
  // On a split the field means the opposite thing: what they pay now, the rest goes on the account.
  const quick = $('#checkoutQuick'); if (quick) quick.hidden = m === 'split';
  const tender = $('#checkoutTender');
  if (tender) tender.placeholder = m === 'split' ? 'Cash now' : 'Other amount';
  const typing = m === 'other' && !state.paymentLabel;
  const other = $('#otherMethodInput'); if (other) other.hidden = !typing;
  const ask = $('#checkoutAsk');
  if (ask) ask.textContent = m === 'credit' ? `Charge to ${state.customer?.name || 'account'}`
    : typing ? 'Paid with' : `Paid with ${state.paymentLabel || KNOWN_METHOD_LABELS[m] || m}`;
  updateChange();
  if (step === 'method') centreCheckout();
}

// Centre what you see -- the top of the total's digits to the bottom of the method tiles -- 3% above
// the middle of the payment column (dead centre reads low). Set from the method step only, so later
// steps grow downward and the total never moves.
function centreCheckout() {
  const steps = $('#checkoutSteps'), hero = $('#checkoutTotalDue');
  const method = $('#checkoutSteps [data-step="method"]'), col = $('.co-pay');
  if (!steps || !hero || !method || method.hidden || state.view !== 'checkout') return;
  steps.style.setProperty('--lift', '0px');
  const cs = getComputedStyle(hero);
  const inkTop = hero.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.fontSize) * 0.14; // Inter digits start ~.14em into a line-height:1 box
  const box = col.getBoundingClientRect();
  const lift = box.top + box.height * 0.47 - (inkTop + method.getBoundingClientRect().bottom) / 2;
  steps.style.setProperty('--lift', `${Math.max(0, Math.round(lift))}px`);
}

function updateChange() {
  const { total } = cartTotals();
  const raw = ($('#checkoutTender')?.value || '').trim();
  const tender = moneyValue(parseFloat(raw) || 0);
  const split = state.paymentMethod === 'split';
  const d = moneyValue(tender - total);
  const ok = split ? tender > 0 && d < 0 : d >= 0;
  const el = $('#checkoutChange');
  if (el) {
    el.textContent = !raw ? ''
      : split ? (d < 0 ? `On account ${peso(-d)}` : 'Use Cash for the full amount')
      : d < 0 ? `Short ${peso(-d)}` : d > 0 ? `Change ${peso(d)}` : 'No change';
    el.className = 'co-change num' + (!raw ? '' : !ok ? ' down' : split ? '' : ' up');
  }
  const go = $('#checkoutCompleteBtn'); if (go) go.disabled = !raw || !ok;
  setCheckoutError('');
}

// Quick cash: Exact, then the next ₱500 / ₱1,000 / ₱5,000 / ₱10,000 above the total -- three of them, never below it.
function quickTenders(total) {
  const c = Math.round(total * 100);
  const above = m => (Math.floor(c / m) + 1) * m / 100;
  return [c / 100, ...new Set([50000, 100000, 500000, 1000000].map(above))].slice(0, 4);
}
console.assert(quickTenders(437.5).join() === '437.5,500,1000,5000' && quickTenders(24318.75).join() === '24318.75,24500,25000,30000'
  && quickTenders(500).join() === '500,1000,5000,10000', 'quickTenders');

function renderQuickCashOptions(total) {
  const wrap = $('#checkoutQuick');
  if (!wrap) return;
  const q = quickTenders(total);
  const short = v => peso(v).replace(/\.00$/, '');
  wrap.parentElement.style.setProperty('--cols', q.length); // the tiles and the cash row below share one width
  wrap.innerHTML = q.map((v, i) => `<button type="button" class="co-tile" data-co-cash="${v}">${i === 0
    ? '<span class="co-big">Exact</span><small>No change</small>'
    : `<span class="co-big num">${short(v)}</span><small class="up num">Change ${peso(moneyValue(v - total))}</small>`}</button>`).join('');
}

// `approvedBy`: the manager whose PIN let this sale past a gate (the credit limit), else ''.
function buildOrderRecord({ status = 'completed', paymentMethod = state.paymentMethod, tendered = 0, change = 0, customerOverride, approvedBy = '' } = {}) {
  const totals = cartTotals();
  const store = currentStoreInfo();
  const customer = customerOverride === undefined ? state.customer : customerOverride;
  // SC/PWD won (whichever is higher): the line and cart discounts were not given, so they aren't stored.
  const sc = !!totals.scPwd;
  return normalizeOrderRecord({
    id: newId(),
    number: nextOrderNumber(),
    ts: Date.now(),
    status,
    cashier: store.cashier,
    staffId: state.user?.id || '',
    approvedBy,
    register: store.registerNo,
    // Each line keeps what it cost us now (step 2.2); reading an order never fills it in later.
    items: state.cart.map(i => ({ ...i, cost: i.cost ?? productOf(i)?.cost ?? null, ...(sc ? { discount: null } : {}) })),
    customer: customer
      ? { id: customer.id, name: customer.name, phone: customer.phone || '', address: customer.address || '' }
      : null,
    paymentMethod,
    subtotal: totals.subtotal,
    discount: totals.discount,
    cartDiscount: state.cartDiscount && !sc ? { ...state.cartDiscount } : null,
    total: totals.total,
    tendered,
    change,
    payments: buildOrderPayments({ status, paymentMethod, total: totals.total, tendered, change }),
    vatRate: totals.vatRate,
    vatAmount: totals.vatAmount,
    vatableSales: totals.vatableSales,
    vatExempt: totals.vatExempt,
    scPwdOff: totals.scPwdOff,
    taxIncluded: totals.taxIncluded,
    fulfilment: state.fulfilment || 'walkin',
    deliveryAddress: state.fulfilment === 'delivery' ? state.deliveryAddress : '',
    deliveryLocation: state.fulfilment === 'delivery' ? state.deliveryLocation : null,
  });
}

function persistOrder(order) {
  let normalized = normalizeOrderRecord(order);
  const latest = loadOrders();
  if (latest.some(o => o.number === normalized.number && o.id !== normalized.id)) {
    normalized = normalizeOrderRecord({ ...normalized, number: nextOrderNumber() });
  }
  // Append: the new row goes on top and every stored row stays exactly as it was written. Saving
  // the normalized history instead re-stamped old cost-less lines with today's cost on every sale.
  // Every caller hands in a fresh id; the filter only stops a double save from adding it twice.
  stampRow(normalized);   // store_id + updated_at, like every record (bo-model stampRow)
  const raw = readJsonStorage(STORAGE_ORDERS, []);
  if (!saveOrdersList([normalized, ...raw.filter(o => o && o.id !== normalized.id)])) {
    throw new Error('Receipt could not be saved.');
  }
  state.orders = [normalized, ...latest.filter(o => o.id !== normalized.id)];
  state.selectedOrderId = normalized.id;
  return normalized;
}

// Every stock change is a movement row; on hand = its sum (bo-model withStock).
// `unitCost` is the cost stamped on the line, not today's, for the same reason margins are.
function moveStock(items, { reason, refId = '', note = '', sign = -1 }) {
  const rows = [];
  (items || []).forEach((item) => {
    const p = productOf(item);
    if (!p) return;
    const qty = sign * toNumber(item.qty, 0);
    if (!qty) return;
    const mv = makeMovement({
      productId: p.id, qty, reason, refId, note,
      unitCost: item.cost != null ? item.cost : p.cost,
      staff: currentStoreInfo().cashier, staffId: state.user?.id || '',
    });
    applyMovement(p, mv);
    rows.push(mv);
  });
  if (!rows.length) return;
  appendMovements(rows);
  saveProducts();
}

function restoreOrderStock(order, note = '') {
  moveStock(order.items, { reason: 'return', refId: order.id, note, sign: 1 });
}

function showOrderAfterCartClears(order) {
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  state.selectedOrderId = order.id;
  switchView('orders');
  renderOrders();
}

function showCheckoutSuccess(order) {
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  if (state.view !== 'checkout') switchView('checkout');
  // The only big number is the change to hand back; method, cash and total are on the receipt.
  const change = moneyValue(order.change || 0);
  const changeBlock = $('#successChangeBlock');
  if (changeBlock) changeBlock.hidden = !(change > 0);
  const changeEl = $('#successChange');
  $('#checkoutSteps').hidden = true;
  $('#checkoutDone').hidden = false; // un-hiding replays the check and the rise
  $('#checkoutApp').classList.add('is-done');
  const receipt = $('#checkoutReceipt');
  if (receipt) { receipt.innerHTML = buildReceiptPreview(order); receipt.scrollTop = 0; }
  if (receipt && $('#app').classList.contains('co-side')) {   // the receipt prints inside the sidebar's items card
    const rc = document.createElement('div'); rc.className = 'rail-rcpt'; rc.innerHTML = receipt.innerHTML;
    $('#side .rail-rcpt')?.remove(); $('#side .items').append(rc);
    // the cart is already cleared; the Total keeps showing the sale until New sale
    const n = (order.items || []).length;
    $('#total').textContent = peso(order.total);
    $('#railCount').textContent = SalesMath.plural(n, 'item');
    $('#side').classList.remove('empty-cart');
  }
  if (changeEl && change > 0) {
    changeEl.classList.remove('settled');
    changeEl.textContent = peso(0);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(showCheckoutSuccess._t);
    showCheckoutSuccess._t = setTimeout(() => {
      const t0 = performance.now();
      const step = (now) => {
        const k = still ? 1 : Math.min(1, (now - t0) / 700);
        changeEl.textContent = peso(change * (1 - (1 - k) ** 3));
        if (k < 1) requestAnimationFrame(step); else changeEl.classList.add('settled');
      };
      requestAnimationFrame(step);
    }, still ? 0 : 280);
  }
  showCheckoutSuccess._orderId = order.id;
}

function currentSuccessOrder() {
  const id = showCheckoutSuccess._orderId;
  if (!id) return null;
  state.orders = loadOrders();
  return state.orders.find(order => order.id === id) || null;
}

function printSuccessReceipt() {
  const order = currentSuccessOrder();
  if (!order) {
    showToast('No receipt to print');
    return;
  }
  printOrder(order);
}

// ---------- Printing ----------

function printerConfig() {
  return { ...DEFAULT_SETTINGS.printing, ...(state.settings.printing || {}) };
}

// Subnets worth sweeping: whatever the typed IP or the page's own LAN address implies, then the common defaults.
function printerScanSubnets() {
  const out = [];
  const add = (ip) => {
    const m = /^(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip || '').trim());
    if (m && !out.includes(m[1])) out.push(m[1]);
  };
  add($('#posPrinterIp')?.value);
  add(location.hostname);
  ['192.168.1', '192.168.0'].forEach(n => { if (!out.includes(n)) out.push(n); });
  return out;
}

// Printers found by the last scan. A hit can only be identified by IP: the ePOS probe
// answers with an empty job result (no model name) and the printer's own web page is
// CORS-blocked, so there is nothing else to read.
// ponytail: the probe reply also carries a status="" ASB bitfield — decode it here if
// paper-out / cover-open ever needs to show on the row.
let printerFound = [];

// The trailing element of a printer row. Every state swaps this one slot, so the
// feedback lands on the row the finger actually touched.
function printerRowState(kind, label) {
  if (kind === 'connected') return '<span class="status-pill ok"><span class="dot"></span>Connected</span>';
  if (kind === 'offline') return '<span class="status-pill out"><span class="dot"></span>' + escapeHtml(label || 'Offline') + '</span>';
  if (kind === 'busy') return '<span class="prn-item-action"><span class="prn-spin"></span>' + escapeHtml(label || 'Connecting…') + '</span>';
  return '<span class="prn-item-action">Connect</span>';
}

function printerRow(ip) {
  return [...($('#posPrinterList')?.querySelectorAll('.prn-item') || [])]
    .find(el => el.dataset.ip === ip) || null;
}

function setPrinterRowState(ip, kind, label) {
  const slot = printerRow(ip)?.querySelector('.prn-item-state');
  if (slot) slot.innerHTML = printerRowState(kind, label);
}

function renderPrinterList() {
  const wrap = $('#posPrinterList');
  if (!wrap) return;
  const saved = (printerConfig().netUrl || '').trim();
  const ips = [...new Set([...(saved ? [saved] : []), ...printerFound])];
  if (!ips.length) {
    wrap.innerHTML = '<div class="prn-empty">No printer connected. Tap Scan to search your Wi-Fi.</div>';
    return;
  }
  wrap.innerHTML = ips.map(ip => `
    <button class="prn-item${ip === saved ? ' connected' : ''}" data-ip="${escapeHtml(ip)}">
      <div>
        <div class="prn-item-name">Epson ePOS printer</div>
        <div class="prn-item-ip">${escapeHtml(ip)}</div>
      </div>
      <span class="prn-item-state">${printerRowState(ip === saved ? 'connected' : 'idle')}</span>
    </button>`).join('');
}

function setScanStatus(text) {
  const el = $('#posScanStatus');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

// Connecting is a real round-trip (up to 4s), not just saving a string — the row
// spins while it waits and only says "Connected" once the printer has answered.
let printerBusy = false;
async function connectPrinter(ip) {
  if (printerBusy) return false;
  printerBusy = true;
  const list = $('#posPrinterList');
  const row = printerRow(ip);
  list?.classList.add('busy');
  row?.classList.add('busy-row');
  setPrinterRowState(ip, 'busy', 'Connecting…');
  setScanStatus('Connecting to ' + ip + '…');
  try {
    if (!await window.HWPOS_PRINTER.probe(ip, 4000)) {
      setPrinterRowState(ip, 'offline', 'No answer');
      setScanStatus(ip + ' did not answer. Check it is powered on and on this Wi-Fi.');
      showToast('Could not reach ' + ip);
      setTimeout(() => { if (!printerBusy) setPrinterRowState(ip, 'idle'); }, 2500);
      return false;
    }
    const input = $('#posPrinterIp');
    if (input) input.value = ip;
    persistPosSettings();
    if (!printerFound.includes(ip)) printerFound.push(ip);
    renderPrinterList();
    setScanStatus('Connected to ' + ip);
    showToast('Printer connected');
    return true;
  } finally {
    printerBusy = false;
    list?.classList.remove('busy');
    row?.classList.remove('busy-row');
  }
}

// Re-check the saved printer whenever Settings opens, so a printer that was
// unplugged since last time shows Offline instead of a stale "Connected".
async function refreshPrinterStatus() {
  const cfg = printerConfig();
  const saved = (cfg.netUrl || '').trim();
  if (!saved || cfg.driver !== 'network') return;
  setPrinterRowState(saved, 'busy', 'Checking…');
  if (await window.HWPOS_PRINTER.probe(saved, 3000)) {
    setPrinterRowState(saved, 'connected');
    return;
  }
  setPrinterRowState(saved, 'offline', 'Offline');
  printerRow(saved)?.classList.remove('connected');
}

function sampleTestOrder() {
  const store = currentStoreInfo();
  return {
    id: 'test', number: 'TEST-0001', ts: Date.now(),
    cashier: store.cashier, register: store.registerNo,
    fulfilment: 'walkin', status: 'completed', paymentMethod: 'cash',
    items: [
      { id: 't1', name: 'Portland Cement 40kg', qty: 2, unit: 'bag', price: 285, lineTotal: 570 },
      { id: 't2', name: 'Common Wire Nail 3in', qty: 1, unit: 'kg', price: 95.5, lineTotal: 95.5 },
    ],
    subtotal: 665.5, discount: 0, total: 665.5,
    payments: [{ method: 'cash', amount: 665.5, tendered: 1000, change: 334.5 }],
  };
}

// Single entry point for every receipt. Only the 'browser' driver opens the pop-up.
// ponytail: a hardware driver that fails must say why and stop. It used to fall back to
// the pop-up, whose auto window.print() reads as "the app printed to the browser instead
// of the printer" and buries the real error toast under a new tab.
async function printOrder(order, opts = {}) {
  const cfg = printerConfig();
  if (cfg.driver !== 'network' && cfg.driver !== 'bluetooth') {
    openReceipt(order);
    track('receipt_print', { orderId: order.id, ok: true });   // browser driver: ok = pop-up opened
    return true;
  }
  try {
    await window.HWPOS_PRINTER.print(toReceiptViewModel(order), cfg);
    track('receipt_print', { orderId: order.id, ok: true });
    if (!opts.silent) showToast('Receipt printed');
    return true;
  } catch (e) {
    track('receipt_print', { orderId: order.id, ok: false });
    showToast(e.message || 'Print failed');
    return false;
  }
}

function startNewSaleFromSuccess() {
  clearTimeout(showCheckoutSuccess._t);
  showCheckoutSuccess._orderId = null;
  switchView('sell');
  renderProducts();
}

function draftReceiptCustomerFromName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = allCustomerRecords().find(c => c.name && c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      phone: existing.phone || '',
      address: existing.address || '',
    };
  }
  return {
    id: 'draft_' + Date.now().toString(36),
    name: trimmed,
    phone: '',
    address: '',
  };
}

function openSaveReceiptModal() {
  if (state.cart.length === 0) return;
  const input = $('#saveReceiptNameInput');
  if (input) {
    input.value = state.customer?.name || '';
  }
  const modal = $('#saveReceiptModal');
  if (modal) modal.hidden = false;
}

function saveReceiptFromModal() {
  const input = $('#saveReceiptNameInput');
  const customerOverride = draftReceiptCustomerFromName(input?.value || '');
  const modal = $('#saveReceiptModal');
  if (modal) modal.hidden = true;
  saveCurrentReceipt(customerOverride);
}

function saveCurrentReceipt(customerOverride = null) {
  if (state.cart.length === 0) return;
  try {
    const order = persistOrder(buildOrderRecord({
      status: 'saved',
      paymentMethod: 'unpaid',
      tendered: 0,
      change: 0,
      customerOverride,
    }));
    track('cart_hold', { lines: order.items.length });
    showOrderAfterCartClears(order);
  } catch (err) {
    console.error(err);
    showToast('Receipt was not saved. Check browser storage.');
    flashControl($('#cartMoreBtn'));
  }
}

// Credit off = Account and Split are not offered (owner 2026-10-02). Read fresh: the back office
// may have switched it since the customer was picked.
const canCharge = () => !!state.customer && !!allCustomerRecords().find(c => c.id === state.customer.id)?.creditOn;

// How far past the customer's limit this sale would push them, in pesos. 0 = fine. The limit is
// read fresh too: one lowered in the back office after the pick still holds. `buildOrderPayments`
// is what actually goes on account, so the tender is split the same way it is charged.
function creditOverLimit(tendered = 0) {
  const c = state.customer && allCustomerRecords().find(x => x.id === state.customer.id);
  if (!c) return 0;
  const { total } = cartTotals();
  const charge = SalesMath.creditPart({ payments: buildOrderPayments({ status: 'completed', paymentMethod: state.paymentMethod, total, tendered }) });
  return creditOverBy(c, charge);   // bo-model: the balance after the charge vs the limit, the Over limit test
}

// What the cart is asking for that the shelf does not have. `sellOutOfStock` was stored on
// every product, shown in the editor, mapped in the CSV and in schema.sql -- and read by no
// code path, so a cart could drive Portland Cement to -218 bags and Inventory to a negative
// value at cost. Checked once here because every way of adding to the cart ends at checkout;
// a guard per entry point is four guards and three of them go stale.
// A manager can still override: on a shop floor the count is usually what is wrong, and
// refusing the sale outright would send a paying customer away over a bookkeeping error.
// Per item, not per line: two lines of the same item (a different note) draw on one shelf.
function stockShortfall(cart = state.cart) {
  const want = new Map();
  for (const item of cart || []) {
    const p = productOf(item);
    if (!p || p.sellOutOfStock || p.trackStock === false) continue;
    want.set(p, (want.get(p) || 0) + toNumber(item.qty, 0));
  }
  return [...want].map(([p, qty]) => {
    const short = roundQty(p, qty - toNumber(p.stock, 0));
    return short > 0 ? { id: p.id, name: p.name, short, unit: p.unit || 'pc' } : null;
  }).filter(Boolean);
}

// postToAccount, the one writer for an account, is in bo-model.js so the back office uses it too.
// A payment at the till is cash into this register's drawer (buildCashDrawerSummary counts it).
function recordCreditPayment(customerId, amount, note = '') {
  const store = currentStoreInfo();
  const c = allCustomerRecords().find(x => x.id === customerId);
  const row = c && recordPayment(c, amount,
    { note: note || 'Customer payment', method: 'cash', register: store.registerNo, staff: store.cashier });
  if (!row) return null;
  renderCustomers();
  updateCustomerButton();
  return row;
}

// Takes a sale's account charge back off the customer. Only what is still owed on THIS sale comes
// off the account (accountDebts); the part already paid goes back as cash, returned here. Taking
// the whole charge off left a ₱570 charge with ₱400 paid at −₱400; taking "what the account owes"
// took an older sale's debt off with it. A charge row not on this device yet (it syncs later)
// comes off whole: off the account, never out of the drawer. `whole`: an exchange, where the
// replacement goes back on the account instead (exchangeOrder). `credit`: the account part of what
// comes back (a line refund's share, SalesMath.refundPart); the whole sale's by default.
function reverseOrderCredit(order, reason, whole = false, credit = SalesMath.creditPart(order)) {
  if (credit <= 0 || !order.customer) return 0;
  const debt = accountDebts(accountRows(order.customer.id))
    .find(d => d.orderId === order.id);
  const take = moneyValue(whole || !debt ? credit : Math.min(credit, debt.left));
  postToAccount(order.customer, 'reversal', take, { orderId: order.id, note: reason || `Reversal for receipt ${order.number}` });
  return moneyValue(credit - take);
}

// Void, refund and selling past a credit limit (owner, 2026-10-02, features/staff-permissions). A
// role whose switch is on (bo-model TILL_ACTIONS, set in the back office) goes ahead: true. Anyone
// else gets the PIN pop-up and false; a manager's PIN, checked on this till with no internet, logs
// the approval with their staff id and runs `again(staffId)` -- the same action, approved.
// `note`: what the manager is approving, said first ("Mara would go ₱300.00 over …").
let pinAsk = null;
function gate(action, again, data = {}, note = '') {
  if (roleCan(state.role, action)) return true;
  pinAsk = { action, again, data };
  showPin('Manager PIN', `${note ? note + ' ' : ''}To ${TILL_ACTIONS[action].toLowerCase()}, a manager enters their PIN.`, 'Approve');
  pinError(loadStaff().some(u => u.active && isPin(u.pin) && roleCan(u.role, action)) ? ''
    : 'No one who can approve this has a PIN yet. Set one in the back office, Staff & access.');
  return false;
}
// One pop-up for both: a manager's approval (Cancel, close) and the sign-in (`lock`: nothing closes it).
function showPin(title, msg, ok, lock = false) {
  $('#pinModal h2').textContent = title;
  $('#pinMessage').textContent = msg;
  $('#pinOkBtn').textContent = ok;
  $$('#pinModal [data-close-modal]').forEach(b => { b.style.display = lock ? 'none' : ''; });
  $('#pinModal').classList.toggle('pin-lock', lock);
  $('#pinInput').value = '';
  pinError('');
  $('#pinModal').hidden = false;
  $('#pinInput').focus();
}
function pinError(msg) { const e = $('#pinError'); e.textContent = msg; e.hidden = !msg; }

// Who is at the till (lead default 2026-10-02, features/staff-permissions). Once anyone active has
// a till PIN the till opens on the sign-in and runs as that person: their role picks the pages and
// the PIN gates, their name and id go on every order. No PINs yet = the owner, as before.
// ponytail: the person lives in memory -- a reload asks for the PIN again, which a till can afford.
const tillPins = () => loadStaff().some(u => u.active && isPin(u.pin));
function lockTill() {
  state.user = null;
  pinAsk = { signIn: true };
  showPin('Sign in', 'Enter your PIN.', 'Sign in', true);
}
function signIn(u) {
  state.user = { id: u.id, name: u.name, role: u.role };
  state.role = u.role;
  applyRoleGating();
  renderRoleSwitcher();
  track('sign_in', { staffId: u.id });
}

function approveWithPin() {
  if (!pinAsk) return;
  if (pinAsk.signIn) {
    const who = staffByPin($('#pinInput').value.trim());
    if (!who) { $('#pinInput').value = ''; $('#pinInput').focus(); return pinError('Wrong PIN.'); }
    pinAsk = null;
    $('#pinModal').hidden = true;
    return signIn(who);
  }
  const u = approverFor($('#pinInput').value.trim(), pinAsk.action);
  if (!u) { $('#pinInput').value = ''; $('#pinInput').focus(); return pinError('Wrong PIN, or that person can’t approve this.'); }
  const { action, again, data } = pinAsk;
  pinAsk = null;
  $('#pinModal').hidden = true;
  track('approval', { action, staffId: u.id, ...data });
  again(u.id);
}

// `approvedBy`: the manager whose PIN let this charge go past the credit limit (gate re-runs it).
function completeSale(approvedBy = '') {
  const totals = cartTotals();
  const total = moneyValue(totals.total);
  let tendered = total, change = 0;
  const isSplit = state.paymentMethod === 'split';
  const cashLike = ['cash', 'gcash', 'qr', 'other', 'split'].includes(state.paymentMethod);
  if (cashLike) {
    const tenderRaw = ($('#checkoutTender')?.value || $('#tenderInput')?.value || '').trim();
    tendered = tenderRaw ? moneyValue(parseFloat(tenderRaw) || 0) : total;
    // A short tender is the whole point of a split -- the rest goes on the account.
    // Demanding the full amount here made "Split" mean "cash", so it never left a balance.
    if (tendered < total && !isSplit) {
      setCheckoutError('Tendered amount is below the total.');
      $('#checkoutTender')?.focus();
      return;
    }
    change = moneyValue(Math.max(0, tendered - total));
  }
  if (isSplit && tendered >= total) {
    setCheckoutError('A split needs a cash amount below the total. Use Cash for the full amount.');
    $('#checkoutTender')?.focus();
    return;
  }
  if (state.paymentMethod === 'other') {
    const otherName = $('#otherMethodInput')?.value?.trim();
    if (!otherName) {
      setCheckoutError('Please enter the payment method name.');
      $('#otherMethodInput')?.focus();
      return;
    }
  }
  if ((state.paymentMethod === 'credit' || isSplit) && !canCharge()) {
    setCheckoutError(state.customer ? `${state.customer.name} has credit off.` : 'Select a customer before charging to account.');
    return;
  }
  // The limit was stored, shown on the customer card, and enforced nowhere -- a ₱5,000
  // account would take a ₱50,000 charge. A role allowed past it confirms; anyone else needs a
  // manager's PIN, which carries straight on with the sale.
  const overBy = creditOverLimit(tendered);
  const acct = state.customer && allCustomerRecords().find(x => x.id === state.customer.id);   // fresh, as creditOverLimit reads it
  const overMsg = `${acct?.name} would go ${peso(overBy)} over their ${peso(toNumber(acct?.creditLimit, 0))} credit limit.`;
  if (overBy > 0 && !approvedBy && (!gate('overLimit', (by) => completeSale(by), { customerId: state.customer.id, overBy }, overMsg)
    || !window.confirm(`${overMsg}\n\nCharge anyway?`))) {
    setCheckoutError('Charge would exceed the credit limit.');
    return;
  }
  const short = stockShortfall();
  if (short.length && !window.confirm(
    `Not enough stock on hand:\n\n${short.map(s => `${s.name} — short ${s.short} ${s.unit}`).join('\n')}\n\nSell anyway?`)) {
    setCheckoutError(`Not enough ${short[0].name} in stock.`);
    // The customer walks out without it -- the exact moment demand used to leave no record.
    openLostSale({ product: state.products.find(p => p.id === short[0].id), qty: short[0].short });
    return;
  }
  const actualMethod = state.paymentMethod === 'other'
    ? ($('#otherMethodInput')?.value?.trim() || 'Other')
    : state.paymentMethod;
  let order;
  try {
    order = persistOrder(buildOrderRecord({
      status: 'completed',
      paymentMethod: actualMethod,
      tendered,
      change,
      approvedBy,
    }));
  } catch (err) {
    console.error(err);
    setCheckoutError('Receipt could not be saved. Sale was not completed.');
    return;
  }

  moveStock(order.items, { reason: 'sale', refId: order.id });
  postToAccount(order.customer, 'charge', SalesMath.creditPart(order), { orderId: order.id, note: `Charge from receipt ${order.number}` });
  track('sale_complete', {
    orderId: order.id, total: order.total, lines: order.items.length, fulfilment: order.fulfilment,
    customerId: order.customer ? order.customer.id : '',
    msSinceCartStart: state.cartStartedAt ? Date.now() - state.cartStartedAt : null,
  });

  showCheckoutSuccess(order);
  autoPrint(order);
}

// A sale prints itself when the store says so (checkout, exchange).
// ponytail: auto-print only for real printers. The browser driver would fire a pop-up on every sale.
function autoPrint(order) {
  const pcfg = printerConfig();
  if (pcfg.printOnSale && (pcfg.driver === 'network' || pcfg.driver === 'bluetooth')) {
    printOrder(order, { silent: true });
  }
}

