// Till › Orders: the rail and receipt preview, filters, order details, the delivery trip,
// the 80mm receipt, and void / refund / exchange.

// ---------- Orders view ----------
function fmtOrderTime(ts) {
  const ago = daysAgo(ts), time = tillDate(ts, 'time');
  if (ago === 0) return `Today, ${time}`;
  if (ago === 1) return `Yesterday, ${time}`;
  return tillDate(ts, 'dayTime');
}

// What a row is (sale · voided · refunded · void · refund · saved), never stored on the sale.
// The sale → its void/refund map is built once per orders list, not once per row.
let orderReversalsOf = null, orderReversalsMap = null;
function orderReversals() {
  if (orderReversalsOf !== state.orders) {
    orderReversalsOf = state.orders;
    orderReversalsMap = SalesMath.reversals(state.orders);
  }
  return orderReversalsMap;
}
function orderState(o) {
  return SalesMath.rowState(o, orderReversals());
}
// What the row SHOWS (label, flag, Status filter): orderState, with 'part' for a partly refunded sale.
// A saved cart or quote (draftAsOrder) reads as its draft kind: 'saved' (the old saved orders' status too) or 'quote'.
const orderStatus = o => o.draft || SalesMath.statusOf(o, orderReversals());
const DRAFT_LABEL = { saved: 'Saved', quote: 'Quote' };
// A listed sale's figure (one row per sale): Voided / Refunded show the full amount struck (it no longer counts),
// Partly refunded what is left -- so a day's rows add up to its band. `back` = the sale's void / refund rows.
const orderStruck = o => ['voided', 'refunded'].includes(orderState(o));
const orderRowAmt = (o, back) => orderStatus(o) === 'part' ? SalesMath.summarize([o, ...back]).collected : SalesMath.rowAmount(o);
function isSavedOrder(o) {
  return orderState(o) === 'saved';
}
// A sale not voided or wholly refunded: one partly refunded still stands, with the rest to give back.
function isCompletedSale(o) {
  return orderState(o) === 'sale';
}
// A void cancels a whole sale rung today, nothing refunded yet; anything else is a refund (reverseSale refuses the rest).
const canVoid = o => isCompletedSale(o) && daysAgo(o.ts) === 0 && !reversalsOf(o).length;

// An exchange says so (owner 2026-10-09): the sale goods came back from reads Exchanged / Partly exchanged, the new
// sale Exchange. The Status filter's Exchanged finds all three, and Refunded / Completed no longer do (owner 2026-10-09).
function orderXchg(o) {
  const s = orderStatus(o);
  if (s === 'sale') return SalesMath.isExchange(o) ? 'Exchange' : '';
  return (orderReversals().swap.has(o.id) && { part: 'Partly exchanged', refunded: 'Exchanged' }[s]) || '';
}
function orderStatusLabel(o) {
  return (o.draft && DRAFT_LABEL[o.draft]) || orderXchg(o) || SalesMath.ROW_LABEL[orderStatus(o)];
}

function buildMapThumb(location, className = 'rp-map-thumb') {
  const loc = normalizeDeliveryLocation(location);
  if (!loc) return '';
  const zoom = loc.zoom || DELIVERY_MAP_DEFAULT.zoom;
  const centerX = lonToWorldX(loc.lng, zoom);
  const centerY = latToWorldY(loc.lat, zoom);
  const tileCenterX = Math.floor(centerX / 256);
  const tileCenterY = Math.floor(centerY / 256);
  const imgs = [];
  for (let y = tileCenterY - 1; y <= tileCenterY + 1; y += 1) {
    if (y < 0 || y >= 2 ** zoom) continue;
    for (let x = tileCenterX - 1; x <= tileCenterX + 1; x += 1) {
      const left = Math.round(x * 256 - centerX);
      const top = Math.round(y * 256 - centerY);
      imgs.push(`<img src="${osmTileUrl(x, y, zoom)}" alt="" style="left:calc(50% + ${left}px);top:calc(50% + ${top}px)" />`);
    }
  }
  return `
    <div class="${className}">
      ${imgs.join('')}
      <div class="map-pin"></div>
      <div class="map-attrib">© OSM</div>
    </div>`;
}

// The totals block and the payment lines are listed once, in printer.js (totalRows, payRows), so paper and
// both on-screen slips show the same rows. Every page loads printer.js before app.js; the node till
// harness does not, and gets no rows (ponytail: nothing there reads a slip).
const slipRows = (fn, vm) => (globalThis.HWPOS_PRINTER ? HWPOS_PRINTER[fn](vm) : []);
// `back`: how much of each line came back (Orders); all of it = struck through, part = a small line under it,
// worded by `said` (backSaid).
function buildReceiptPreview(order, back = [], said = []) {
  const receipt = toReceiptViewModel(order);
  const lines = receipt.items.map((i, k) => `
    <div class="rp-item${back[k] >= i.qty ? ' out' : ''}">
      <div class="rp-item-name">${escapeHtml(i.name)}</div>
      <div class="rp-row rp-item-line">
        <span>${i.qty} ${escapeHtml(i.unit || '')} × ${peso(i.price)}</span>
        <span>${peso(i.amount)}</span>
      </div>
      ${back[k] > 0 && back[k] < i.qty ? `<div class="rp-small">${escapeHtml(said[k] || '')}</div>` : ''}
    </div>`).join('');
  const payRows = receipt.status === 'saved'
    ? (receipt.mark ? '' : `<div class="rp-status saved">NOT COMPLETED</div>`)   // a quote: QUOTATION at the top says it
    : slipRows('payRows', receipt).map(([k, v]) => `<div class="rp-row"><span>${escapeHtml(k)}</span><span>${peso(v)}</span></div>`).join('');
  return `
    <div class="receipt-preview">
      <div class="rp-paper">
        <div class="rp-center rp-store">${escapeHtml(receipt.store.name)}</div>
        <div class="rp-center rp-small">${escapeHtml(receipt.store.address)}</div>
        <div class="rp-center rp-small">Tel: ${escapeHtml(receipt.store.phone)}</div>
        ${receipt.store.tin ? `<div class="rp-center rp-small">TIN: ${escapeHtml(receipt.store.tin)}</div>` : ''}
        <div class="rp-rule"></div>
        ${receipt.mark ? `<div class="rp-status saved">${escapeHtml(receipt.mark)}</div>` : ''}
        ${receipt.number ? `<div class="rp-row"><span>Receipt #</span><span>${escapeHtml(receipt.number)}</span></div>` : ''}
        <div class="rp-row"><span>Date</span><span>${receipt.dateText}</span></div>
        <div class="rp-row"><span>${receipt.whoWord}</span><span>${escapeHtml(receipt.cashier || '')}</span></div>
        <div class="rp-row"><span>Register</span><span>${escapeHtml(receipt.register || '1')}</span></div>
        ${receipt.customer ? `<div class="rp-small">Customer: ${escapeHtml(receipt.customer.name)}</div>` : ''}
        ${receipt.scPwdId ? `<div class="rp-small">${escapeHtml(receipt.scPwdId.join(': '))}</div>` : ''}
        <div class="rp-small"><strong>${escapeHtml(receipt.fulfilmentLabel)}</strong></div>
        ${buildMapThumb(receipt.deliveryLocation)}
        <div class="rp-rule"></div>
        ${lines}
        <div class="rp-rule"></div>
        ${slipRows('totalRows', receipt).map(([k, v, small]) => `<div class="rp-row${small ? ' rp-small' : ''}"><span>${escapeHtml(k)}</span><span>${peso(v)}</span></div>`).join('')}
        <div class="rp-row rp-total"><span>TOTAL</span><span>${peso(receipt.totals.total)}</span></div>
        ${payRows}
        <div class="rp-rule"></div>
        <div class="rp-center rp-thanks">Thank you!</div>
        ${receipt.footer.map(l => `<div class="rp-center rp-small">${l}</div>`).join('')}
      </div>
    </div>`;
}

// pos-orders-rail-lab.html: the orders in a rail under ☰, grouped under day bands; the receipt beside it.
const ORDER_RANGES = [['today', 'Today', 0], ['yday', 'Yesterday', 1], ['week', 'Last 7 days', 6], ['all', 'All orders', Infinity]];
const ORDERS_FILTER_DEF = { range: 'week', staff: '', pay: '', status: '', fulfil: '' };
// Every day boundary on the till is the STORE'S day (SalesMath.storeZone), the back office's clock,
// never the browser's: a 7 AM Manila sale is that day on every screen.
const tillZone = () => SalesMath.storeZone(state.settings);
const tillDay = ts => SalesMath.dayKey(ts, tillZone());
const daysAgo = ts => SalesMath.daysAgo(ts, Date.now(), tillZone());
const tillDate = (ts, kind) => SalesMath.dateText(ts, tillZone(), kind);
const orderDayName = ts => tillDate(ts, 'dayYear');   // every band the same: Oct 6, 2026 (owner: no Today / weekday words)
function orderPayText(o) {
  return isSavedOrder(o) ? '' : SalesMath.payWord(o);
}
// Who a row counts for: the SELLER (SalesMath.sellerOf; a void or refund is the sale's seller's, owner
// 2026-10-02). Built once per orders list. ponytail: a staff rename shows after the next sale reloads the list.
let sellerFor = null, sellerOrders = null;
function orderSeller(o) {
  if (sellerOrders !== state.orders) { sellerOrders = state.orders; sellerFor = SalesMath.sellerOf(state.orders); }
  return sellerFor(o).name;
}
// A row's state rides its title, muted, the way a draft reads "Saved · Nice" (owner 2026-10-07):
// "#1-023 · Refunded" / "· Partly refunded" (SalesMath.statusOf). A plain sale says nothing.
function orderFlag(o) {
  const s = orderStatus(o), x = orderXchg(o);   // the word takes its state's colour (styles.css span.st[data-s])
  return s === 'sale' && !x ? '' : `<span class="st" data-s="${x ? 'xchg' : s}"> · ${escapeHtml(orderStatusLabel(o))}</span>`;
}
const orderTitleHtml = o => o.draft
  ? `<span>${escapeHtml([orderStatusLabel(o), o.name].filter(Boolean).join(' · '))}</span>`
  : `<span><span class="num">#${escapeHtml(o.number)}</span>${orderFlag(o)}</span>`;
// Every row the Orders page lists: the sales, then the saved carts and quotes (pos-checkout draftOrders).
const orderRows = () => state.orders.concat(draftOrders());
const findOrderRow = id => orderRows().find(x => x.id === id);
const ordersFiltered = () => Object.keys(ORDERS_FILTER_DEF).some(k => state.ordersFilter[k] !== ORDERS_FILTER_DEF[k]);

function ordersShown() {
  const F = state.ordersFilter;
  const q = (state.ordersQuery || '').trim().toLowerCase().replace(/^#/, '');
  const maxAgo = ORDER_RANGES.find(r => r[0] === F.range)[2];
  // A void / refund row isn't listed (renderOrders), so its number finds the sale it belongs to.
  const backNums = new Map();
  if (q) for (const r of state.orders) if (SalesMath.isReversal(r)) backNums.set(r.originalOrderId, (backNums.get(r.originalOrderId) || []).concat(r.number));
  return orderRows().filter(o => {
    const ago = daysAgo(o.ts), hitBack = (backNums.get(o.id) || []).some(n => String(n).toLowerCase().includes(q));
    if (!hitBack && (F.range === 'yday' ? ago !== 1 : ago > maxAgo)) return false;
    if (F.staff && orderSeller(o) !== F.staff) return false;
    if (F.pay && !orderTenderKeys(o).some(k => payBucket(k) === F.pay)) return false;
    if (F.status && (F.status === 'xchg' ? !orderXchg(o) : orderStatus(o) !== F.status || orderXchg(o))) return false;
    if (F.fulfil && o.fulfilment !== F.fulfil) return false;
    if (state.ordersCustomer && SalesMath.customerIdOf(o) !== state.ordersCustomer) return false;
    return !q || [o.number, ...(backNums.get(o.id) || []), o.name, o.customer ? o.customer.name : 'walk-in', SalesMath.payWord(o), orderStatusLabel(o), tillDate(o.ts, 'slip'),
      ...(o.items || []).flatMap(i => [i.name, i.sku])].some(v => String(v || '').toLowerCase().includes(q));
  }).sort(SalesMath.newestFirst);
}

// A customer's "See all" (owner 2026-10-07): the Orders page itself, only their orders, every date, and ☰ turns
// into a back to the customer. '' = the whole store again. Leaving the page any other way ends it (switchView).
function ordersFor(customerId, orderId = '') {
  state.ordersCustomer = customerId;
  state.ordersFilter = { ...ORDERS_FILTER_DEF, range: customerId ? 'all' : ORDERS_FILTER_DEF.range };
  state.ordersQuery = '';
  $('#ordersSearch').value = '';
  $('#ordersFind').classList.remove('typed');
  $('#ordersSearch').placeholder = customerId ? 'Search # or item' : 'Search # or customer';
  $('#ordersView').classList.toggle('for-cust', !!customerId);
  $('#ordersView').classList.toggle('reading', !!orderId);   // phone: a tapped order opens on its receipt
  if (orderId) state.selectedOrderId = orderId;
}

function renderOrders() {
  const list = $('#ordersList');
  if (!list) return;
  // Defensive: make sure state.orders is an array (and refresh from storage).
  if (!Array.isArray(state.orders)) state.orders = loadOrders();
  // One row per sale (owner 2026-10-07): a void or refund stays its own record (BIR, the drawer, sync) but isn't
  // listed -- its sale reads Voided / Refunded / Partly refunded, and shows it inside (orderBackHtml).
  const shown = ordersShown().filter(o => !SalesMath.isReversal(o));
  const sel = state.orders.find(o => o.id === state.selectedOrderId);
  if (sel && SalesMath.isReversal(sel)) state.selectedOrderId = sel.originalOrderId;   // a link to a refund opens its sale
  if (!shown.some(o => o.id === state.selectedOrderId)) state.selectedOrderId = shown[0] ? shown[0].id : null;

  // One pass into store days (SalesMath.groupByDay). The band is its rows: how many are listed and what
  // they add up to (summarize().collected = each row's signed total; a parked cart is not money), so a
  // Status filter never reads a negative or zero count. Summing the whole list per band froze the till.
  let html = '';
  const totals = roleCan(state.role, 'dayTotals');   // the role's switch (Staff & access); off = count only
  // A band adds up what its sales are worth now: each with the money that went back on it, whatever day that was.
  // The drawer's day (money out today for an older sale) is the Shift page's and Reports', not this list's.
  const backOf = new Map();
  for (const r of state.orders) if (SalesMath.isReversal(r)) backOf.set(r.originalOrderId, (backOf.get(r.originalOrderId) || []).concat(r));
  for (const [day, rows] of SalesMath.groupByDay(shown, tillZone())) {
    const worth = rows.flatMap(o => [o, ...(backOf.get(o.id) || [])]);
    html += `<div class="band"><span>${orderDayName(day)} <span class="num">· ${rows.length}</span></span>${totals ? `<span class="num">${peso(SalesMath.summarize(worth).collected)}</span>` : ''}</div>`;
    for (const o of rows) {
      const time = tillDate(o.ts, 'time'), amt = o.draft ? o.total : orderRowAmt(o, backOf.get(o.id) || []);   // a draft shows what it adds up to; the band still leaves it out
      html += `<button type="button" class="row${orderStruck(o) ? ' void' : ''}${o.id === state.selectedOrderId ? ' cur' : ''}" data-order-id="${o.id}">
        <div class="nm">${orderTitleHtml(o)}
          <small class="num">${escapeHtml(orderFulfilLabel(o))} · ${time} · ${escapeHtml(orderSeller(o) || '—')}</small></div>
        <div class="rt"><span class="amt num">${amt == null ? '—' : peso(amt)}</span><small>${escapeHtml(orderPayText(o))}</small></div></button>`;
    }
  }
  list.innerHTML = html || (state.orders.length
    ? '<div class="empty"><b>No orders</b><span>Nothing matches these filters.</span></div>'
    : '<div class="empty"><b>No orders yet</b><span>Completed sales and saved receipts show up here.</span></div>');
  $('#ordersFilter')?.classList.toggle('on', ordersFiltered());
  renderOrderDetail();
}

function renderOrderDetail() {
  const detail = $('#orderDetail'), ttl = $('#orderTtl');
  if (!detail || !ttl) return;
  const o = findOrderRow(state.selectedOrderId);
  $('#orderPrint').disabled = $('#orderMore').disabled = $('#orderContinue').disabled = !o;
  $('#orderRefund').disabled = !o || !isCompletedSale(o);
  if (!o) {
    ttl.innerHTML = '';
    detail.innerHTML = '<div class="empty"><b>No order selected</b><span>Pick one from the list to see its receipt.</span></div>';
    return;
  }
  ttl.innerHTML = `<b class="${o.customer ? '' : 'walk'}">${escapeHtml(o.customer ? o.customer.name : 'Walk-in customer')}</b>${orderFlag(o)}`;
  detail.innerHTML = orderBodyHtml(o);
  refundAct($('#orderRefund'), o);
}

// An order shows as its receipt, refunded lines struck through. Refund turns the receipt into its lines with
// a tick each (the sale sidebar's rows); Refund ₱X gives them back and the receipt returns (owner 2026-10-07).
// Orders and the customer's "See all" show the same thing.
// One pick at a time: the order on screen, whether it is picking, and its lines { lineNo: qty }.
// `mode`: what the ticks are for -- 'refund', or 'exchange' (⋯ Exchange; the bar's button then reads Exchange ₱X).
const orderPick = { id: '', on: false, lines: {}, mode: 'refund' };
const picking = o => orderPick.on && orderPick.id === o.id;
// The money that went back on a sale, oldest first, above its receipt: when, how much, how, and the slip's number.
// Each prints its own slip (the refund or void receipt the customer and BIR keep).
function orderBackHtml(o) {
  const rows = SalesMath.isSale(o) ? reversalsOf(o).sort((a, b) => SalesMath.newestFirst(b, a)) : [];
  const swap = state.orders.find(x => SalesMath.isSale(x) && x.originalOrderId === o.id);   // the exchange's new sale
  return rows.length ? `<section class="o-back">${rows.map(r => `<div class="fr">
    <span class="lb">${r.status === 'void' ? 'Voided' : r.reason === 'Exchange' ? 'Exchanged' : 'Refunded'} <small class="num">${tillDate(r.ts, 'dayTime')} · ${escapeHtml(SalesMath.payWord(r))} · #${escapeHtml(r.number)}${r.reason === 'Exchange' && swap ? ` · for #${escapeHtml(swap.number)}` : ''}</small></span>
    <span class="v num">${peso(SalesMath.rowAmount(r))}</span>
    <button type="button" class="link" data-print-back="${escapeHtml(r.id)}">Print</button></div>`).join('')}</section>` : '';
}
// What came back of each line, by how (owner 2026-10-09): "1 exchanged", "2 refunded", or both. `left` = SalesMath.qtyLeft.
function backSaid(o, left) {
  const x = {};
  for (const r of reversalsOf(o)) if (r.reason === 'Exchange') for (const i of r.items || []) x[i.lineNo] = (x[i.lineNo] || 0) + i.qty;
  return o.items.map((i, k) => {
    const back = i.qty - left[k], sw = Math.min(back, x[k] || 0), rf = Math.round((back - sw) * 1000) / 1000;
    return [sw > 0 && `${SalesMath.qtyText(sw)} exchanged`, rf > 0 && `${SalesMath.qtyText(rf)} refunded`].filter(Boolean).join(' · ');
  });
}
function orderBodyHtml(o) {
  if (picking(o)) return orderLinesHtml(o);
  const left = SalesMath.isSale(o) && orderState(o) !== 'voided' ? SalesMath.qtyLeft(o, reversalsOf(o)) : null;
  const html = orderBackHtml(o) + buildReceiptPreview(o, left ? o.items.map((i, k) => i.qty - left[k]) : [], left ? backSaid(o, left) : []);
  return orderState(o) === 'voided' ? html.replace('<div class="rp-paper">', '<div class="rp-paper void"><div class="stamp">VOIDED</div>') : html;
}
function orderPicks(o) {
  if (orderPick.id !== o.id) Object.assign(orderPick, { id: o.id, on: false, lines: {} });
  return Object.entries(orderPick.lines).map(([k, qty]) => ({ lineNo: Number(k), qty }));
}
const TICK = '<span class="box"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';
function orderLinesHtml(o) {
  const r = toReceiptViewModel(o), sale = isCompletedSale(o);
  const left = SalesMath.isSale(o) ? SalesMath.qtyLeft(o, reversalsOf(o)) : [];
  orderPicks(o);
  const L = orderPick.lines, can = k => sale && left[k] > 0, open = r.items.map((_, k) => k).filter(can), said = SalesMath.isSale(o) ? backSaid(o, left) : [];
  const all = open.length && open.every(k => L[k] === left[k]);
  const lines = r.items.map((i, k) => {
    const back = SalesMath.isSale(o) && orderState(o) !== 'voided' ? i.qty - left[k] : 0;
    return `<div class="line${can(k) || !sale ? '' : ' done'}">
      <button type="button" class="row" ${can(k) ? `role="checkbox" aria-checked="${k in L}" data-line="${k}"` : 'disabled'}>${sale ? TICK : ''}
        <span class="nm"><span>${escapeHtml(i.name)}</span><small class="num">${SalesMath.qtyText(i.qty)} × ${peso(i.price)}${back > 0 ? ` · ${escapeHtml(said[k])}` : ''}</small></span>
        <span class="amt num">${peso(i.amount)}</span></button>
      ${k in L && left[k] > 1 ? `<div class="step"><span>Coming back</span>
        <button type="button" data-step="-1" data-line="${k}" aria-label="One less">−</button><b class="num">${SalesMath.qtyText(L[k])}</b>
        <button type="button" data-step="1" data-line="${k}" aria-label="One more">+</button><small class="num">of ${SalesMath.qtyText(left[k])}</small></div>` : ''}</div>`;
  }).join('');
  return `<div class="c-body oi">
    <p class="meta">Tick what comes back.</p>
    <section class="card ol">
      <div class="band">${sale ? `<button type="button" class="all" role="checkbox" aria-checked="${!!all}" aria-label="Tick every item" data-all${open.length ? '' : ' disabled'}>${TICK}</button>` : ''}
        <span>${SalesMath.plural(r.items.length, 'item')}</span><span>Amount</span></div>${lines}</section>
  </div>`;
}
// A tick, the band's tick-all, or a − / + on a ticked line. True when the pick changed.
function pickOrderLine(o, el) {
  const left = SalesMath.qtyLeft(o, reversalsOf(o)), k = el.dataset.line;
  orderPicks(o);
  const L = orderPick.lines;
  if ('all' in el.dataset) {
    const on = el.getAttribute('aria-checked') !== 'true';
    orderPick.lines = {};
    if (on) left.forEach((q, n) => { if (q > 0) orderPick.lines[n] = q; });
  } else if (el.dataset.step) L[k] = Math.min(left[k], Math.max(Math.min(1, left[k]), Math.round((L[k] + Number(el.dataset.step)) * 1000) / 1000));
  else if (k != null) { if (k in L) delete L[k]; else L[k] = left[k]; }
  else return false;
  return true;
}
// The bar: Print receipt, Refund, ⋯ — or, while picking, Cancel and Refund ₱X (live once something is ticked).
// A saved cart or quote: Print and Continue, where a sale has Refund (owner 2026-10-07).
function refundAct(btn, o) {
  const picks = orderPicks(o), part = picks.length && SalesMath.refundPart(o, reversalsOf(o), picks), on = picking(o), dr = !!o.draft;
  btn.disabled = !isCompletedSale(o) || (on && !part);
  btn.hidden = dr;
  btn.classList.toggle('primary', on);
  const verb = on && orderPick.mode === 'exchange' ? 'Exchange' : 'Refund';
  btn.querySelector('span').textContent = part ? `${verb} ${peso(part.total)}` : verb;
  const pr = $('#orderPrint'), word = dr ? 'Print' : 'Print receipt';   // a draft's slip is not a receipt
  if (pr) { pr.title = word; pr.querySelector('span').textContent = word; }
  btn.parentElement.querySelectorAll('.act').forEach(b => {
    if (b !== btn) b.hidden = b.id === 'orderContinue' ? !dr : (dr && b.id === 'orderMore') || on !== b.classList.contains('cancel');
  });
}

// The filter sheet (both labs): every choice on one sheet; a tap applies at once and the sheet stays open.
// groups() -> [[heading, key, [[value, label, dotColour?]]]]; cur is the live filter object, def its defaults.
function openFilterSheet(btn, groups, cur, def, apply) {
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = '<div class="rail-menu fp" role="dialog" aria-label="Filters"></div>';
  const m = veil.firstChild;
  const draw = () => {
    m.innerHTML = groups().map(([h, key, opts]) => `<h6>${h}</h6><div class="fp-seg">${opts.map(([v, l, dot]) =>
      `<button type="button" class="${cur[key] === v ? 'cur' : ''}" data-k="${key}" data-v="${escapeHtml(v)}">${dot ? `<i class="pm" style="background:${dot}"></i>` : ''}${escapeHtml(l)}</button>`).join('')}</div>`).join('')
      + `<button type="button" class="reset"${Object.keys(def).some(k => cur[k] !== def[k]) ? '' : ' disabled'}>Reset filters</button>`;
  };
  draw();
  document.body.append(veil);
  const r = btn.getBoundingClientRect();
  m.style.top = Math.max(12, Math.min(r.bottom + 6, innerHeight - m.offsetHeight - 12)) + 'px';
  m.style.left = Math.max(12, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 12)) + 'px';
  btn.setAttribute('aria-expanded', 'true');
  const close = () => { veil.remove(); btn.setAttribute('aria-expanded', 'false'); };
  veil.addEventListener('click', e => {
    if (e.target === veil) { close(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    Object.assign(cur, b.classList.contains('reset') ? def : { [b.dataset.k]: b.dataset.v });
    apply();
    draw();
  });
  veil.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); btn.focus(); } });
  m.querySelector('button')?.focus({ preventScroll: true });
}

// The search card both pages share: typing shows the ×, the × clears and keeps focus.
function wireFind(findSel, inputSel, clearSel, apply) {
  const find = $(findSel), input = $(inputSel);
  if (!find || !input) return;
  input.addEventListener('input', () => { find.classList.toggle('typed', !!input.value); apply(input.value); });
  $(clearSel).addEventListener('click', (e) => { e.preventDefault(); input.value = ''; find.classList.remove('typed'); apply(''); input.focus(); });
}

function openOrderDetailModal(orderId) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o) return;
  const r = toReceiptViewModel(o);
  const dateStr = tillDate(o.ts, 'dayYear');   // the store's clock; no weekday, like the bands
  const timeStr = tillDate(o.ts, 'time');

  const numEl = $('#odmNumber');
  if (numEl) numEl.textContent = `Order #${o.number}`;
  const statusEl = $('#odmStatus');   // same state word as the Orders title (orderFlag); a plain sale says nothing
  if (statusEl) statusEl.textContent = orderStatus(o) === 'sale' && !orderXchg(o) ? '' : `· ${orderStatusLabel(o)}`;

  const metaRows = [
    ['Date', dateStr],
    ['Time', timeStr],
    ['Staff', orderSeller(o) || '—'],   // the seller; a void or refund also names who pressed it
    ...(r.mark ? [[r.whoWord, o.cashier || '—']] : []),
    ['Customer', o.customer ? o.customer.name : 'Walk-in'],
    ...(r.scPwdId ? [r.scPwdId] : []),
    ['Payment', SalesMath.payWord(o)],
    ['Fulfilment', o.fulfilment === 'delivery' ? (o.deliveryAddress || orderFulfilLabel(o)) : orderFulfilLabel(o)],
  ].map(([k, v]) => `<div class="odm-meta-row"><span>${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');

  const itemRows = r.items.map(i => `
    <div class="odm-item">
      <div class="odm-item-info">
        <div class="odm-item-name">${escapeHtml(i.name)}</div>
        <div class="odm-item-sub">${i.qty} ${escapeHtml(i.unit || 'pc')} × ${peso(i.price)}</div>
      </div>
      <div class="odm-item-amt">${peso(i.amount)}</div>
    </div>`).join('');

  const t = r.totals;
  // Paid / Given back and Change are SalesMath.paidOf (null for a parked cart: no Paid row, like the
  // slips). What is still owed on an account sale is the customer's ledger's word (bo-model debtStatusOf).
  const pay = SalesMath.paidOf(o);
  const owedId = orderState(o) === 'sale' && SalesMath.customerIdOf(o);
  const owed = owedId ? debtStatusOf(o.id, accountRows(owedId)) : '';
  // The same totals block as both slips and the paper (printer.js totalRows).
  const subtotalRows = slipRows('totalRows', r).map(([k, v]) => `<div class="odm-total-row"><span>${escapeHtml(k)}</span><span>${peso(v)}</span></div>`).join('');
  const totalRows = `
    <div class="odm-subtotals-detail" id="odmSubtotalsDetail">
      <div class="odm-subtotals-inner">${subtotalRows}</div>
    </div>
    <button class="odm-total-row grand odm-total-toggle" id="odmTotalToggle" type="button">
      <span>Total</span>
      <div class="odm-total-right">
        <span>${peso(t.total)}</span>
        <svg class="odm-total-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </button>
    ${pay ? `<div class="odm-total-row"><span>${r.paidWord} (${escapeHtml(SalesMath.payWord(o))})</span><span>${peso(pay.paid)}</span></div>` : ''}
    ${owed === 'Unpaid' || owed === 'Part paid' ? `<div class="odm-total-row"><span>On account</span><span>${owed}</span></div>` : ''}
    ${pay && pay.change > 0 ? `<div class="odm-total-row"><span>Change</span><span>${peso(pay.change)}</span></div>` : ''}`;

  const actions = isCompletedSale(o) ? `
    <div class="odm-actions">
      ${canVoid(o) ? `<button class="secondary-btn danger" data-order-op="void" data-order-id="${o.id}">Void</button>` : ''}
      <button class="secondary-btn" data-order-op="refund" data-order-id="${o.id}">Refund</button>
      <button class="secondary-btn" data-order-op="return" data-order-id="${o.id}">Refund items</button>
      <button class="secondary-btn" data-order-op="exchange" data-order-id="${o.id}">Exchange</button>
    </div>` : '';

  const itemCount = (o.items || []).length;
  const body = $('#orderDetailModalBody');
  if (body) {
    body.innerHTML = `
      <div class="odm-meta">${metaRows}</div>
      ${o.fulfilment === 'delivery' && !isSavedOrder(o) ? deliveryTripHtml(o) : ''}
      <button class="odm-items-toggle" id="odmItemsToggle" type="button">
        <span>Items (${itemCount})</span>
        <svg class="odm-items-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="odm-items-detail" id="odmItemsDetail">
        <div class="odm-items-inner">${itemRows}</div>
      </div>
      <div class="odm-totals">${totalRows}</div>
      ${actions}`;

    const toggle = body.querySelector('#odmItemsToggle');
    const detail = body.querySelector('#odmItemsDetail');
    const inner = body.querySelector('.odm-items-inner');
    if (toggle && detail && inner) {
      toggle.addEventListener('click', () => {
        const isOpen = toggle.classList.contains('open');
        if (isOpen) {
          detail.style.height = detail.getBoundingClientRect().height + 'px';
          requestAnimationFrame(() => { detail.style.height = '0'; });
          toggle.classList.remove('open');
        } else {
          const h = inner.getBoundingClientRect().height;
          detail.style.height = h + 'px';
          const onEnd = () => { detail.style.height = 'auto'; detail.removeEventListener('transitionend', onEnd); };
          detail.addEventListener('transitionend', onEnd);
          toggle.classList.add('open');
        }
      });
    }

    const totalToggle = body.querySelector('#odmTotalToggle');
    const subtotalsDetail = body.querySelector('#odmSubtotalsDetail');
    const subtotalsInner = body.querySelector('.odm-subtotals-inner');
    if (totalToggle && subtotalsDetail && subtotalsInner) {
      totalToggle.addEventListener('click', () => {
        const isOpen = totalToggle.classList.contains('open');
        if (isOpen) {
          subtotalsDetail.style.height = subtotalsDetail.getBoundingClientRect().height + 'px';
          requestAnimationFrame(() => { subtotalsDetail.style.height = '0'; });
          totalToggle.classList.remove('open');
        } else {
          const h = subtotalsInner.getBoundingClientRect().height;
          subtotalsDetail.style.height = h + 'px';
          const onEnd = () => { subtotalsDetail.style.height = 'auto'; subtotalsDetail.removeEventListener('transitionend', onEnd); };
          subtotalsDetail.addEventListener('transitionend', onEnd);
          totalToggle.classList.add('open');
        }
      });
    }
  }
  const modal = $('#orderDetailModal');
  if (modal) modal.hidden = false;
}

// ---------- Delivery trip ----------
// The order record never changes; its trip is rows in the deliveryEvents log, latest wins.
const DELIVERY_EVENT_META = {
  dispatched: { label: 'Dispatched', cls: 'saved' },
  arrived:    { label: 'Arrived',    cls: 'ok' },
  returned:   { label: 'Returned',   cls: 'done' },
  failed:     { label: 'Failed',     cls: 'danger' },
};

function deliveryChip(last, withDetail = false) {
  if (!last) return '<span class="or-status done">To dispatch</span>';
  const m = DELIVERY_EVENT_META[last.event] || { label: last.event, cls: 'done' };
  const detail = withDetail ? ` · ${fmtOrderTime(last.ts)}${last.driver ? ' · ' + last.driver : ''}` : '';
  return `<span class="or-status ${m.cls}">${escapeHtml(m.label + detail)}</span>`;
}

function deliveryTripHtml(o) {
  const events = loadEvents('deliveryEvents');
  const last = latestEvents(events).get(o.id);
  // ponytail: "remembered driver" is just the newest row's driver -- no extra setting to keep.
  const driver = last ? last.driver : ((events[events.length - 1] || {}).driver || '');
  return `
    <div class="odm-delivery">
      <div class="odm-delivery-head">
        <span class="odm-section-label">Delivery</span>
        ${deliveryChip(last, true)}
      </div>
      <input type="text" class="text-input" id="odmDriverInput" placeholder="Driver name" autocomplete="off" value="${escapeHtml(driver)}" />
      <div class="odm-actions">
        ${Object.entries(DELIVERY_EVENT_META).map(([ev, m]) =>
          `<button class="secondary-btn${ev === 'failed' ? ' danger' : ''}" type="button" data-delivery-event="${ev}" data-order-id="${o.id}">${m.label}</button>`).join('')}
      </div>
    </div>`;
}

function recordDeliveryEvent(orderId, event) {
  const input = $('#odmDriverInput');
  const driver = (input?.value || '').trim();
  if (!driver) { showToast('Enter the driver name'); input?.focus(); return; }
  const store = currentStoreInfo();
  // ponytail: lat/lng stay null -- the till sits in the store, not with the driver. GPS on the run is Tier 2.
  const saved = appendEvents('deliveryEvents', [makeEvent({
    orderId, event, driver, lat: null, lng: null, note: '', terminal: String(store.registerNo || ''),
  }, store.cashier)]);
  showToast(saved ? `${DELIVERY_EVENT_META[event].label} · ${driver}` : 'Could not save: storage is full');
  openOrderDetailModal(orderId);
  renderOrders();
}

// ---------- 80mm thermal receipt ----------
function buildReceiptHtml(order) {
  const receipt = toReceiptViewModel(order);
  const paper = printerConfig().width === '58mm' ? '58mm' : '80mm';   // Settings › Printing › Paper width
  const lines = receipt.items.map(i => `
    <div class="r-item">
      <div class="r-item-name">${escapeHtml(i.name)}</div>
      <div class="r-item-row">
        <span>${i.qty} ${escapeHtml(i.unit || '')} × ${peso(i.price)}</span>
        <span>${peso(i.amount)}</span>
      </div>
    </div>`).join('');

  const cust = receipt.customer
    ? `<div class="r-cust">Customer: ${escapeHtml(receipt.customer.name)}</div>`
    : '';
  const scId = receipt.scPwdId ? `<div class="r-cust">${escapeHtml(receipt.scPwdId.join(': '))}</div>` : '';
  const fulfilParts = receipt.fulfilmentLabel.split(' · ');
  const fulfil = fulfilParts[0] === 'DELIVERY'
    ? `
      <div class="r-cust"><strong>DELIVERY</strong></div>
      ${fulfilParts[1] ? `<div class="r-cust">${escapeHtml(fulfilParts.slice(1).join(' · '))}</div>` : ''}`
    : `<div class="r-cust"><strong>${escapeHtml(fulfilParts[0])}</strong></div>`;
  const deliveryMap = receipt.deliveryLocation ? buildMapThumb(receipt.deliveryLocation, 'r-map-thumb') : '';
  const totalRows = slipRows('totalRows', receipt).map(([k, v]) => `<div class="r-row"><span>${escapeHtml(k)}</span><span>${peso(v)}</span></div>`).join('');
  const payRows = receipt.status === 'saved'
    ? (receipt.mark ? '' : `<div class="r-row"><span>STATUS</span><span>NOT COMPLETED</span></div>`)
    : slipRows('payRows', receipt).map(([k, v]) => `<div class="r-row"><span>${escapeHtml(k)}</span><span>${peso(v)}</span></div>`).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(receipt.number ? `Receipt ${receipt.number}` : (receipt.mark ? 'Quotation' : 'Saved cart'))}</title>
<style>
  @page { size: ${paper} auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "SF Mono", "Menlo", "Consolas", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.35;
  }
  .r-paper {
    width: ${paper};
    padding: 4mm 4mm 6mm;
    background: #fff;
  }
  /* On-screen preview: center the receipt on a neutral surface */
  @media screen {
    body {
      background: #1a1a1a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      padding: 40px 16px;
    }
    .r-paper {
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3);
      padding: 8mm 6mm 10mm;
    }
    .r-actions { width: ${paper}; }
  }
  .r-center { text-align: center; }
  .r-store { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
  .r-store-sub { font-size: 11px; }
  .r-rule { border-top: 1px dashed #000; margin: 6px 0; }
  .r-double { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; }
  .r-meta { font-size: 11px; }
  .r-meta div { display: flex; justify-content: space-between; }
  .r-item { margin: 4px 0; }
  .r-item-name { font-weight: 700; }
  .r-item-row { display: flex; justify-content: space-between; font-size: 11px; }
  .r-row { display: flex; justify-content: space-between; }
  .r-total { font-size: 14px; font-weight: 700; }
  .r-foot { font-size: 11px; margin-top: 6px; }
  .r-cust { font-size: 11px; margin: 2px 0; }
  .r-map-thumb {
    position: relative; height: 82px; overflow: hidden; margin: 5px 0 2px;
    border: 1px solid #000; background: #f3f3f3; filter: grayscale(1) contrast(1.2);
  }
  .r-map-thumb img { position: absolute; width: 256px; height: 256px; max-width: none; }
  .r-map-thumb .map-pin {
    position: absolute; left: 50%; top: 50%; width: 14px; height: 14px;
    transform: translate(-50%, -100%) rotate(-45deg); background: #000;
    border: 2px solid #fff; border-radius: 50% 50% 50% 0;
  }
  .r-map-thumb .map-attrib {
    position: absolute; right: 3px; bottom: 2px; background: rgba(255,255,255,0.85);
    color: #000; font-size: 8px; padding: 0 2px;
  }
  .r-thanks { margin-top: 8px; font-weight: 700; }
  .r-actions { margin-top: 16px; display: flex; gap: 8px; }
  .r-actions button {
    flex: 1; font-family: inherit; font-size: 13px; font-weight: 600; padding: 12px;
    border: none; border-radius: 10px; background: #333; color: #fff; cursor: pointer;
  }
  .r-actions button.primary { background: #fff; color: #121212; }
  @media print {
    .r-actions { display: none; }
    body { padding: 0; background: #fff; }
    .r-paper { padding: 2mm 4mm 4mm; box-shadow: none; border-radius: 0; }
  }
</style>
</head>
<body>
  <div class="r-paper">
  <div class="r-center r-store">${escapeHtml(receipt.store.name)}</div>
  <div class="r-center r-store-sub">${escapeHtml(receipt.store.address)}</div>
  <div class="r-center r-store-sub">Tel: ${escapeHtml(receipt.store.phone)}</div>
  ${receipt.store.tin ? `<div class="r-center r-store-sub">TIN: ${escapeHtml(receipt.store.tin)}</div>` : ''}

  <div class="r-rule"></div>

  ${receipt.mark ? `<div class="r-center"><strong>${escapeHtml(receipt.mark)}</strong></div>` : ''}
  <div class="r-meta">
    ${receipt.number ? `<div><span>Receipt #</span><span>${escapeHtml(receipt.number)}</span></div>` : ''}
    <div><span>Date</span><span>${receipt.dateText}</span></div>
    <div><span>${receipt.whoWord}</span><span>${escapeHtml(receipt.cashier || '')}</span></div>
    <div><span>Register</span><span>${escapeHtml(receipt.register || '1')}</span></div>
  </div>
  ${cust}${scId}
  ${fulfil}
  ${deliveryMap}

  <div class="r-rule"></div>

  ${lines}

  <div class="r-rule"></div>

  ${totalRows}
  <div class="r-double r-row r-total"><span>TOTAL</span><span>${peso(receipt.totals.total)}</span></div>
  ${payRows}

  <div class="r-rule"></div>

  <div class="r-center r-thanks">Thank you!</div>
  ${receipt.footer.map(l => `<div class="r-center r-foot">${l}</div>`).join('')}
  </div>

  <div class="r-actions">
    <button onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print</button>
  </div>

  <script>
    // Auto-trigger the print dialog once rendered.
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 200);
    });
  </script>
</body>
</html>`;
}

function openReceipt(order) {
  const html = buildReceiptHtml(order);
  // Open a slim window sized roughly for the 80mm preview.
  const w = window.open('', 'hwpos_receipt_' + order.id,
    'width=360,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!w) {
    showToast('Pop-up blocked — allow pop-ups to print receipts');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// The void and refund rows already pointing at a sale.
const reversalsOf = (o, all = state.orders) => all.filter(r => r.originalOrderId === o.id && SalesMath.isReversal(r));

// What a refund of `picks` ([{ lineNo, qty }]) gives back on a sale: { prior, part } (SalesMath.refundPart),
// or null with the reason on a toast. No picks = everything still left on it. A sale can be refunded a
// line, or part of one, at a time (owner 2026-10-03), never more than was sold over all its refunds.
function refundPlan(order, picks, all = loadOrders()) {
  const prior = reversalsOf(order, all);
  const left = SalesMath.qtyLeft(order, prior);
  if (!left.some(q => q > 0)) {
    showToast(`#${order.number} is already ${prior.some(r => r.status === 'void') ? 'voided' : 'refunded'}`);
    return null;
  }
  const part = SalesMath.refundPart(order, prior, picks || left.map((qty, lineNo) => ({ lineNo, qty })));
  if (!part) showToast((picks || []).some(p => p.qty > 0) ? `That is more than is left to refund on #${order.number}` : 'Pick what is coming back');
  return part && { prior, part };
}

// A void or a refund is a NEW row pointing at the sale; the sale itself is never edited. A refund
// carries only the lines (and units) that came back; refunds of one sale never add up past what it
// sold (refundPlan), so the goods go back on the shelf and the money goes back once.
// A void cancels a whole sale rung today; anything older is a refund, counted on the day it happens.
// `by` = the approving manager's staff id once a PIN has approved it; `again(by)` re-runs the caller.
// `backVia` { method, amount }: an exchange's hand back (exchangeOrder). That much comes off the money legs, in
// order, and goes out on `method` as a leg without a ref; the legs that keep the ref are the swap (SalesMath.isExchange).
function reverseSale(orderId, kind, reason, { by = '', again, whole = false, picks = null, backVia = null } = {}) {
  const all = loadOrders();
  const order = all.find(o => o.id === orderId);
  if (!order || !SalesMath.isSale(order)) return null;
  const plan = refundPlan(order, kind === 'void' ? null : picks, all);
  if (!plan) return null;
  if (kind === 'void' && plan.prior.length) {
    showToast(`#${order.number} is partly refunded. Refund the rest instead.`);
    return null;
  }
  if (kind === 'void' && daysAgo(order.ts) !== 0) {
    showToast(`#${order.number} is from an earlier day. Refund it instead.`);
    return null;
  }
  if (!by && !gate(kind, again, { orderId })) return null;
  const { part } = plan;
  restoreOrderStock({ ...order, items: part.items }, reason);
  // The money goes back the way it came in. Forcing a cash leg here paid ₱185 out of the
  // drawer for a sale that was charged to an account -- `reverseOrderCredit` had already
  // taken it off the account. Only what the customer already paid off the charge is cash.
  const cashBack = reverseOrderCredit(order, reason, whole, SalesMath.creditPart(part));
  let left = cashBack;
  const payments = part.payments.map(p => {
    if (p.method !== 'credit' || !left) return p;
    const off = Math.min(left, toNumber(p.amount, 0));
    left = moneyValue(left - off);
    return { ...p, amount: moneyValue(toNumber(p.amount, 0) - off) };
  }).filter(p => p.method !== 'credit' || p.amount > 0);
  let legs = [...payments, ...(cashBack ? [{ method: 'cash', amount: cashBack }] : [])]
    .map(p => ({ ...p, tendered: 0, change: 0, ref: order.number }));   // each leg keeps its tender's name
  if (backVia) {
    let h = backVia.amount;
    legs = legs.map(p => {
      if (p.method === 'credit' || !h) return p;
      const off = Math.min(h, toNumber(p.amount, 0));
      h = moneyValue(h - off);
      return { ...p, amount: moneyValue(toNumber(p.amount, 0) - off) };
    }).filter(p => p.amount > 0)
      .concat(buildOrderPayments({ paymentMethod: backVia.method, total: backVia.amount }).map(p => ({ ...p, tendered: 0, change: 0 })));
  }
  const store = currentStoreInfo();
  const row = persistOrder({
    ...order,
    ...part,                 // just the lines that came back, and their money
    cartDiscount: null,      // its share is on each line (refundPart)
    id: newId(),
    number: nextOrderNumber(),
    ts: Date.now(),
    status: kind,
    originalOrderId: order.id,
    reason,
    // The row is whoever pressed it, with the manager whose PIN approved it ('' = their own role may).
    // It still counts against whoever made the sale (owner 2026-10-02): SalesMath.sellerOf follows
    // originalOrderId back to the sale, so no total reads the reversal's own cashier.
    // The register is this one: the money goes back out of this drawer. Nothing tendered.
    cashier: store.cashier,
    staffId: state.user?.id || '',
    approvedBy: by,
    register: store.registerNo,
    tendered: 0,
    change: 0,
    payments: legs,
  });
  state.selectedOrderId = order.id;   // the sale stays on screen, now stamped
  if (orderPick.id === order.id) Object.assign(orderPick, { on: false, lines: {} });   // back to the receipt, now struck
  track(kind, kind === 'void' ? { orderId, reason } : { orderId, amount: row.total, reason });
  return row;
}

function voidOrder(orderId, reason = 'Voided by manager', by = '') {
  const row = reverseSale(orderId, 'void', reason, { by, again: (b) => voidOrder(orderId, reason, b) });
  if (row) { renderOrders(); renderReports(); }
  return row;
}

// `picks` = [{ lineNo, qty }] for a line refund; none = everything still left on the sale.
function refundOrder(orderId, reason = 'Refunded by manager', by = '', picks = null) {
  const row = reverseSale(orderId, 'refund', reason, { by, picks, again: (b) => refundOrder(orderId, reason, b, picks) });
  if (row) { renderOrders(); renderReports(); showToast(`Refunded · ${peso(row.total)} back to the customer`); }
  return row;
}

// A return is a refund with the reason the goods came back.
function recordReturn(orderId, reason = 'Refunded items', picks = null) {
  return refundOrder(orderId, reason, '', picks);
}

// Which lines come back, and how many: one row per line with something left, a number to type
// (0 = not this one), and under them what that gives back (SalesMath.refundPart, the refund's own
// figure, discounts and all). onPick gets [{ lineNo, qty }].
// ponytail: reuses the order pop-up's .odm-item row and the qty field's .vq-input; .tier-input is the one
// existing narrow-input width until the till restyle gives the picker its own class.
function pickReturnLines(o, { title, okText, onPick }) {
  const prior = reversalsOf(o), left = SalesMath.qtyLeft(o, prior);
  const rows = (o.items || []).map((i, k) => (left[k] > 0 ? `
    <div class="odm-item">
      <div class="odm-item-info">
        <div class="odm-item-name">${escapeHtml(i.name)}</div>
        <div class="odm-item-sub">${SalesMath.qtyText(left[k])} ${escapeHtml(i.unit || 'pc')} left · ${peso(i.price)} each</div>
      </div>
      <input type="number" class="vq-input tier-input" data-line="${k}" value="0" min="0" max="${left[k]}" step="any" inputmode="decimal" aria-label="${escapeHtml(i.name)} coming back" />
    </div>` : '')).join('');
  const picked = () => $$('#confirmMessage [data-line]').map(el => ({ lineNo: Number(el.dataset.line), qty: toNumber(el.value, 0) }));
  showConfirm({ title, okText, danger: false, onConfirm: () => onPick(picked()),
    html: `${rows}<div class="odm-total-row"><span>Coming back</span><span class="odm-item-amt" id="pickBack">${peso(0)}</span></div>` });
  $('#confirmMessage').oninput = () => {
    const part = SalesMath.refundPart(o, prior, picked());
    $('#pickBack').textContent = part ? peso(part.total) : picked().some(p => p.qty > 0) ? 'More than is left' : peso(0);
  };
}

// An exchange rings the customer's own picks (owner 2026-10-03) in the sell screen's cart: what comes
// back is ticked in Orders like a refund, then Sell is locked to it (owner 2026-10-09): ☰ is ✕ (leaveExchange),
// the cart shows what comes back above the new items, and the pay button says the difference (confirmExchange).
// The new sale is the presser's; the refund still counts against the original seller (SalesMath.sellerOf).
function startExchange(orderId, picks) {
  const o = state.orders.find(x => x.id === orderId);
  if (!o || !refundPlan(o, picks)) return;
  if (state.cart.length) { showToast('Finish or clear the sale in progress first'); return; }
  clearCart();
  state.customer = o.customer ? (allCustomerRecords().find(c => c.id === o.customer.id) || o.customer) : null;
  state.exchange = { orderId, picks };
  state.fulfilment = 'walkin';   // a swap at the counter: Walk-in is hidden in an exchange (owner 2026-10-09)
  Object.assign(orderPick, { on: false, lines: {}, mode: 'refund' });
  $('#app').classList.add('sidebar-collapsed');   // the ✕ shows only where the ☰ does
  switchView('sell');
  renderCart();
  updateCustomerButton();
}

// The exchange as the cart stands: the sale, what comes back (part), the new items' total and exchangeMoney's
// split -- net > 0 the cashier collects it, < 0 hands it back. null when there is no exchange.
function exchangeNow() {
  const x = state.exchange, o = x && state.orders.find(r => r.id === x.orderId);
  const part = o && SalesMath.refundPart(o, reversalsOf(o), x.picks);
  if (!part) return null;
  const total = cartTotals().total;
  return { o, part, total, ...exchangeMoney(o, part, total) };
}

// The ✕ that stands in for ☰ in an exchange: back to the sale in Orders, nothing saved. Asks only when new items
// would come off the cart.
function leaveExchange() {
  const id = state.exchange?.orderId;
  const go = () => { clearCart(); state.selectedOrderId = id; switchView('orders'); renderOrders(); };
  if (!state.cart.length) return go();
  showConfirm({ title: 'Cancel exchange?', message: 'The new items come off the cart. Nothing is saved.',
    okText: 'Cancel exchange', cancelText: 'Keep going', danger: false, onConfirm: go });   // centred: it leaves the whole exchange (owner 2026-10-09)
}

// The money of an exchange before it is rung: what the customer's account takes (onAccount, credit) and
// `net`, what changes hands at the till -- above 0 the cashier collects it, below 0 hands it back. The
// refund pays back what came back on its tenders less the account part; the new sale takes its total less
// what goes on the account, on the original's tender (SalesMath.saleTender), so the drawer moves by `net`.
function exchangeMoney(order, part, total) {
  const credit = order.customer ? SalesMath.creditPart(part) : 0;
  const onAccount = moneyValue(Math.min(credit, total));
  return { credit, onAccount, net: moneyValue(total - onAccount - (part.total - credit)) };
}

// The cart's pay button in an exchange (renderCart words it): Collect = the real checkout for just the difference
// (completeSale rings it); Hand back = which way the money goes out, starting on how they paid; even = one Swap.
// The cart is the new sale as it stands -- its discounts and sale type.
function confirmExchange() {
  if (!state.cart.length) return;
  const x = exchangeNow();
  if (!x) { const o = state.orders.find(r => r.id === state.exchange?.orderId); if (o) refundPlan(o, state.exchange.picks); return; }   // its toast says why
  const { orderId, picks } = state.exchange;
  if (x.net > 0) return openPaymentModal();
  const from = $('#payBtn')?.offsetParent ? $('#payBtn') : $('#cartBar');
  const acct = moneyValue(x.credit - x.onAccount);   // an account sale's swap for less: that much comes off the account
  if (!x.net) return showConfirm({ title: `${acct ? 'Swap' : 'Even swap'} on #${x.o.number}`, okText: 'Swap',
    message: acct ? `${peso(acct)} comes off ${x.o.customer?.name || 'the customer'}’s account. No cash changes hands.` : 'No money changes hands.',
    danger: false, from, onConfirm: () => exchangeOrder(orderId, state.cart, 'Exchange', '', picks) });
  // The tenders the checkout shows (Manage -> Payments), with the one they paid on even if hidden since.
  const pay = state.settings.payments || {}, off = new Set(pay.hidden || []), was = SalesMath.saleTender(x.o);
  const keys = [...new Set([...PAY_BUILTINS.filter(m => m === 'cash' || !off.has(m)), ...(pay.custom || []), was])];
  showConfirm({ title: `Hand back ${peso(-x.net)}`, okText: `Hand back ${peso(-x.net)}`, danger: false, from,
    html: `<label class="pf"><span class="lb">Hand back with</span><select class="text-input" id="xbMethod">${keys.map(k =>
      `<option value="${escapeHtml(k)}"${k === was ? ' selected' : ''}>${escapeHtml(SalesMath.tenderLabel(k))}</option>`).join('')}</select></label>`,
    onConfirm: () => { const method = $('#xbMethod')?.value || was; exchangeOrder(orderId, state.cart, 'Exchange', '', picks, false, { method }); } });
}

// `picks`: what comes back, as refundOrder; none = the whole sale. `replacementItems` = state.cart rings
// the cart as it stands (startExchange); any other list is a plain cart of those items.
// `pay` { method, tendered, change }: how the difference changed hands (completeSale collects it, confirmExchange
// hands it back); none = on the original's tender.
function exchangeOrder(orderId, replacementItems = [], reason = 'Exchange', by = '', picks = null, okOver = false, pay = null) {
  const fromCart = replacementItems === state.cart;
  const replacements = fromCart ? state.cart : (replacementItems || [])
    .map(item => {
      const product = productOf(item);
      if (!product) return null;
      const qty = qtyFrom(product, item.qty);
      return {
        id: product.id,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        unit: product.unit || 'pc',
        qty,
        price: moneyValue(item.price ?? product.price),
      };
    })
    .filter(Boolean);
  if (!replacements.length) return null;

  const order = state.orders.find(o => o.id === orderId);
  if (!order) return null;
  const plan = refundPlan(order, picks);
  if (!plan) return null;
  const again = (b) => exchangeOrder(orderId, replacementItems, reason, b, picks, okOver, pay);
  // An account sale's exchange stays on the account (customers bug 10): the refund takes the whole
  // account part of what came back with no cash out, the new sale charges up to that much, anything
  // above is cash. A like-for-like swap then leaves the drawer and the balance as they were, paid or not.
  // The new sale is built like any other (buildOrderRecord: the same VAT, SC/PWD and payments) from a
  // cart. From the cart it is the cart as the cashier set it up (line and cart discounts, sale type); the
  // customer stays the original's either way (openCustomerModal refuses a change mid-exchange).
  const swap = fromCart ? { customer: order.customer } : { cart: replacements, customer: order.customer, cartDiscount: null, scPwd: null,
    fulfilment: order.fulfilment, deliveryAddress: order.deliveryAddress || '', deliveryLocation: order.deliveryLocation || null };
  const kept = Object.fromEntries(Object.keys(swap).map(k => [k, state[k]]));
  Object.assign(state, swap);
  const total = cartTotals().total;
  Object.assign(state, kept);
  const { credit, onAccount, net } = exchangeMoney(order, plan.part, total);
  if (onAccount > 0) {
    const c = allCustomerRecords().find(x => x.id === order.customer.id);
    if (!c?.creditOn) { showToast(`${order.customer.name} has credit off. Refund the sale instead.`); return null; }
    // The refund takes `credit` off the balance first; the replacement charges onAccount against what is left.
    const overBy = creditOverBy({ ...c, currentBalance: moneyValue(c.currentBalance - credit) }, onAccount);
    // ponytail: one approval covers the exchange; the refund's own gate is skipped once `by` is set.
    // `okOver`: answered Yes in the app's own pop-up, so the re-run goes past the limit.
    if (overBy > 0 && !by && !okOver) {
      if (gate('overLimit', again, { customerId: c.id, overBy })) showConfirm({ title: 'Over the credit limit',
        message: `${c.name} would be ${peso(overBy)} over their ${peso(c.creditLimit)} credit limit.`, okText: 'Exchange anyway',
        onConfirm: () => exchangeOrder(orderId, replacementItems, reason, '', picks, true, pay) });
      return null;
    }
  }

  // The exchange is a refund row for what came back, then a fresh sale for what goes out.
  // A hand back goes out on `pay.method`; the rest of what came back is the swap.
  const tender = SalesMath.saleTender(order), via = pay?.method || tender;
  const refund = reverseSale(orderId, 'refund', reason, { by, again, picks, whole: onAccount > 0,
    backVia: net < 0 ? { method: via, amount: -net } : null });
  if (!refund) return null;
  // The new sale's legs: the account part and the swap on the original's tender (a GCash sale stays GCash), both
  // with the ref, so they cancel the refund's; what was collected is a leg of its own, without one.
  const collect = Math.max(0, net), swapPart = moneyValue(total - onAccount - collect);
  // The swap rides the tenders the refund gave back on, in the same shares (a GCash + cash sale swaps on both),
  // so each one evens out; all on the first tender moved the cash part into GCash.
  const back = refund.payments.filter(p => p.ref && p.method !== 'credit');
  const swapLegs = !(swapPart > 0) ? [] : back.length
    ? SalesMath.split(cent(swapPart), back.map(p => cent(p.amount))).map((c, i) => ({ ...back[i], amount: unc(c), tendered: unc(c), change: 0 })).filter(p => p.amount)
    : buildOrderPayments({ paymentMethod: tender, total: swapPart, tendered: swapPart });
  const payments = [
    ...(onAccount > 0 ? buildOrderPayments({ paymentMethod: 'credit', total: onAccount }) : []),
    ...swapLegs,
  ].map(p => ({ ...p, ref: order.number }))
    .concat(collect > 0 ? buildOrderPayments({ paymentMethod: via, total: collect, tendered: pay?.tendered || collect, change: pay?.change || 0 }) : []);
  // Whatever the cashier had in the cart is put back after.
  let exchangeSale;
  try {
    Object.assign(state, swap);
    const rec = buildOrderRecord({
      paymentMethod: onAccount >= total ? 'credit' : onAccount > 0 ? 'split' : tender,
      tendered: pay?.tendered || collect, change: pay?.change || 0,
    });
    exchangeSale = persistOrder({ ...rec, originalOrderId: order.id, reason, ...(by ? { approvedBy: by } : {}), payments });
  } finally {
    Object.assign(state, kept);
  }
  // After the sale exists, so the movement can point at the receipt that caused it.
  moveStock(exchangeSale.items, { reason: 'sale', refId: exchangeSale.id, note: 'Exchange' });
  postToAccount(order.customer, 'charge', SalesMath.creditPart(exchangeSale), { orderId: exchangeSale.id, note: `Charge from receipt ${exchangeSale.number}`, ...(by ? { approvedBy: by } : {}) });
  track('sale_complete', {
    orderId: exchangeSale.id, total: exchangeSale.total, lines: exchangeSale.items.length,
    fulfilment: exchangeSale.fulfilment, customerId: exchangeSale.customer ? exchangeSale.customer.id : '',
    msSinceCartStart: null,
  });
  if (fromCart) {   // rung from the cart (startExchange): the checkout's done page and the slip, like any sale
    showCheckoutSuccess(exchangeSale, Math.max(0, -net));
    autoPrint(exchangeSale);
  }
  renderOrders();
  renderReports();
  return { refund, exchangeSale };
}

