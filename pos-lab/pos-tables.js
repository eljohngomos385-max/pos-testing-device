// Tables (owner 2026-11-13; F picked 2026-11-15 from the pos-lab-tables try-out): dine-in bills kept on tables.
// A bill is a saved cart of kind 'table' (HWPOS_STORE.savedCarts) named after its table ('' = a QR order with none yet); lines
// sent to the kitchen carry `sent`. While one is open on the cart, state.bill = { table, qr } and state.savedId is its row.
// A bill gets its order number on the first send, keeps it as more is added or merged, and the paid order uses the same number.
const tbPhone = () => matchMedia('(max-width: 720px)').matches;
const tbBills = () => loadSavedCarts().filter(d => d.kind === 'table');
const tbNum = (name) => Number(String(name).replace(/\D/g, '')) || 1e9;   // no number: last
const tbTotal = (d) => cartTotals(d.items || [], d.cartDiscount, d.scPwd).total;
const tbNew = () => state.cart.filter(i => !i.sent).length;
const TB_DOT = '<i class="tb-dot" aria-label="QR order"></i>';

// A tile of the picker (the checkout's pay tiles): Pay now, then a table
const tbTile = (attr, pt, inner, name, small = '', cur) =>
  `<button type="button" class="co-tile${cur ? ' pick' : ''}" ${attr}><span class="pt-tile" style="--pt: var(--pt-${pt})">${inner}</span><span>${name}</span><small class="num">${small}</small></button>`;
const tbPayTile = (total) => `<button type="button" class="co-tile" data-tb="pay">${payTile('cash')}<span>Pay now</span><small class="num">${peso(total)}</small></button>`;
// A bill's card on Tables: "Table 1 · #1-830" (number grey), a QR order with no table is its number; under it "QR · 2 items · 3:33 PM"
const tbTitle = (d) => `${d.qr ? TB_DOT : ''}${d.name ? `${escapeHtml(d.name)}${d.number ? ` <span class="tb-no num">· #${escapeHtml(d.number)}</span>` : ''}` : d.number ? `<span class="num">#${escapeHtml(d.number)}</span>` : 'No table'}`;
const tbSub = (d) => [d.qr && 'QR', SalesMath.plural((d.items || []).length, 'item'), tillDate(d.ts, 'time')].filter(Boolean).join(' · ');

// Every table: the store's own (Settings › Tables, stTables in pos-settings.js) and any other with a bill on it, by number.
// Busy = a bill that isn't this one. Not the QR codes page's list: tables and QR codes are separate (owner 2026-11-15).
function tbChoices() {
  const bills = tbBills();
  const names = [...new Set([...stTables().map(t => t.name), ...bills.map(b => b.name).filter(Boolean)])].sort((a, b) => tbNum(a) - tbNum(b));
  return names.map(name => {
    const b = bills.find(x => x.name === name && x.id !== state.savedId);
    return { name, amt: b ? tbTotal(b) : null, cur: state.bill?.table === name };
  });
}

// Check out on a dine-in cart, or a bill with new items, or a QR order: choose a table first. false = pay as always.
function tbCheckout() {
  if (state.bill ? !(tbNew() || state.bill.qr) : state.fulfilment !== 'dinein') return false;
  tbPick();
  return true;
}

// The picker, always titled "Choice": Pay now, then every table; no New table (owner 2026-11-15: a typed "Table 8" next to
// the list only confuses). The iPad: a page of the Dine-in sheet over the items, the cart beside it (pos-sell.js drawEditSheet).
// The phone: the checkout page, its pay tiles swapped for these (renderCheckout puts them back). Moving a bill opens the same.
const tbPickTiles = () => `${tbPayTile(cartTotals().total)}${tbChoices().length ? '' : '<p class="fc-n">No tables yet. Add them in Settings › Store › Tables.</p>'}${tbChoices().map(c => tbTile(`data-tb="${escapeHtml(c.name)}"`, c.amt == null ? 'grey' : 'blue',
  `<b class="tb-n">${tbNum(c.name) < 1e9 ? tbNum(c.name) : ''}</b>`, escapeHtml(c.name), c.amt == null ? '' : peso(c.amt), c.cur)).join('')}`;
function tbPick() {
  if (!tbPhone()) return openEditSheet('tb');
  openPaymentModal();
  $('#checkoutApp').classList.add('tb-pick', 'tb-c');
  $('#checkoutMethods').innerHTML = tbPickTiles();
  $('#tbTtl').textContent = 'Choice';
}
function tbPickOff() {
  $('#checkoutApp')?.classList.remove('tb-pick', 'tb-c');
}

// Send: the new lines go to the kitchen (sent) and the bill is saved on `table`. A table that already has a bill takes
// these lines onto it. Moving a bill is the same.
function tbSend(table) {
  const prev = state.savedId, other = tbBills().find(d => d.name === table && d.id !== prev);
  // a plain item's line is keyed by the item (addToCart adds to it): a sent one gets its own id, so a new one starts a line
  state.cart = state.cart.map(i => i.sent ? i : { ...i, sent: true, ...(!i.custom && !i.productId && { id: newId(), productId: i.id }) });
  if (other) { state.cart = [...other.items, ...state.cart]; state.savedId = other.id; }
  state.fulfilment = 'dinein';
  try {
    const row = saveDraft('table', table);
    if (prev && prev !== row.id) HWPOS_STORE.savedCarts.remove(prev);   // a continued saved cart, or the bill merged into another
  } catch (err) {
    console.error(err);
    return showToast('Ticket was not saved. Check browser storage.');
  }
  clearCart();
  if (state.view === 'checkout') switchView('sell');
  showDone(`Sent to ${table}`);
}

// A bill from Tables, on the cart as it was saved (its prices stay: it was ordered at them)
function tbOpen(id) {
  const d = loadSavedCarts().find(x => x.id === id);
  if (!d) return;
  clearCart();
  beginCart();
  Object.assign(state, {
    cart: (d.items || []).map(i => ({ ...i })),
    cartDiscount: d.cartDiscount ? { ...d.cartDiscount } : null,
    scPwd: d.scPwd ? { ...d.scPwd } : null,
    customer: (d.customer && allCustomerRecords().find(c => c.id === d.customer.id)) || null,
    fulfilment: 'dinein', orderNote: d.note || '', savedId: d.id, bill: { table: d.name || '', qr: !!d.qr },
  });
  switchView('sell');
  renderCart();
  updateCustomerButton();
  if (tbPhone()) $('#app').classList.add('ph-cart');
}

// ✕ / ‹ on an open bill: back to Tables, where it came from (owner 2026-11-15). New items ask Save (send) or Discard first;
// only the Discard button discards (a tap beside keeps the bill open)
function tbBack() {
  // a customer picked (or cleared) on the bill stays on it; its lines, number and time as they were (owner 2026-11-15: "Table 5 · Maria")
  const d = loadSavedCarts().find(x => x.id === state.savedId), c = state.customer;
  const had = d && allCustomerRecords().find(x => x.id === d.customer?.id);   // an old bill's made-up "Table 5" customer counts as none
  if (d && (had?.id || null) !== (c?.id || null))
    HWPOS_STORE.savedCarts.put(d.id, stampRow({ ...d, customer: c ? { id: c.id, name: c.name, phone: c.phone || '', address: c.address || '' } : null }));
  clearCart(); $('#app').classList.remove('ph-cart'); switchView('tables');
}
function tbLeave() {
  if (!tbNew()) return tbBack();
  let discard = false;
  showConfirm({ title: state.bill.table || 'QR order', message: 'Save the new items on this ticket?', okText: 'Save', cancelText: 'Discard',
    onConfirm: () => (state.bill.table ? (tbSend(state.bill.table), switchView('tables')) : tbPick()),
    onCancel: () => { if (discard) tbBack(); } });
  $$('.cf-sheet [data-cancel]').at(-1).addEventListener('click', () => { discard = true; });
}

// The cart's bits for a bill: sent lines on top ("· Sent"), the pill, Accept for a QR order (renderCart)
function tbSentHtml() {
  const sent = state.cart.filter(i => i.sent);
  return sent.length ? `<div class="xb sent">${sent.map(i => `<div class="row"><span class="nm"><span>${escapeHtml(i.name)}</span><small class="num">${lineQty(i)} × ${peso(i.price)} · Sent</small></span>
    <span class="amt num">${peso(normalizeOrderItem(i).lineGross)}</span></div>`).join('')}</div>` : '';
}
function tbCartBits(t) {
  const n = tbNew(), bar = $('#cartBar');
  bar.innerHTML = `<span>${escapeHtml(state.bill.table || 'QR order')}${n ? ` · ${n} new` : ''}</span><span class="num">${peso(t.total)}</span>`;
  bar._last = null;
  if (state.bill.qr) $('#payBtn').innerHTML = `<span>Accept</span><span class="num">${peso(t.total)}</span>`;
}

// Open tickets (the menu's page; named by the owner 2026-11-15, as Loyverse and Square; the tables themselves are Settings › Tables): only the open bills, each its own card (Orders' row with the table's number square). QR orders first, then by
// table number, then the ones with no table.
function renderTables() {
  const box = $('.view-tables .c-scroll');
  if (!box) return;
  const bills = tbBills().sort((a, b) => (!!b.qr - !!a.qr) || (tbNum(a.name) - tbNum(b.name)));
  if (!bills.length) return void (box.innerHTML = emptyState('receipt', 'No open tickets'));
  box.innerHTML = `<div class="c-body"><div class="o-days tb-sep">${bills.map(d => `<button type="button" class="row" data-tb-bill="${d.id}"><span class="pt-tile" style="--pt: var(--pt-blue)"><b class="tb-n">${d.name ? tbNum(d.name) : 'QR'}</b></span>
    <div class="nm"><span>${tbTitle(d)}</span><small class="num">${tbSub(d)}</small></div>
    <div class="rt"><span class="amt num">${peso(tbTotal(d))}</span></div></button>`).join('')}</div></div>`;
}

// Once on load: a sample QR order (seeded once), numbers on any bill without one, and the clicks.
function tbInit() {
  if (!state.settings.tbQrSeeded) {   // shortcut: a sample until QR ordering makes real ones (pos-qr.js); drop it then
    const items = state.products.filter(p => onTill(p) && !askedPrice(p) && p.soldBy !== 'measure' && !itemModifiers(p).length).slice(0, 2)
      .map((p, k) => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit, price: p.price, qty: k + 1 }));
    const store = currentStoreInfo(), r = stampRow({ id: newId(), kind: 'table', name: '', qr: true, customer: null, items, cartDiscount: null, scPwd: null,
      fulfilment: 'dinein', note: '', ts: Date.now(), cashier: store.cashier, staffId: '', register: store.registerNo });
    if (items.length) HWPOS_STORE.savedCarts.put(r.id, r);
    state.settings.tbQrSeeded = true;
    saveSettings();
  }
  for (const d of tbBills()) if (!d.number) HWPOS_STORE.savedCarts.put(d.id, stampRow({ ...d, number: nextOrderNumber() }));   // the QR sample, and any bill from before numbers
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-tb]'), bill = e.target.closest('[data-tb-bill]');
    if (pick) {
      const k = pick.dataset.tb;
      if (es?.kind === 'tb') closeEditSheet();   // the iPad's picker (pos-sell.js drawEditSheet)
      if (k === 'pay') return state.view === 'checkout' ? renderCheckout() : openPaymentModal();
      return tbSend(k);
    }
    if (bill) return tbOpen(bill.dataset.tbBill);
    if (e.target.closest('#tbAdd')) { closeEditSheet(); $('#app').classList.remove('ph-cart'); return; }   // phone: back to the grid for more
    if (e.target.closest('#tbMove')) return tbPick();   // the iPad's table row under the cart: the same Choice
  });
}
