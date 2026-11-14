// Tables try-out (owner 2026-11-13): seven ways a dine-in bill goes to a table, A–G in the side menu. E = C with each bill's details, F = A's rows apart, G = F flat.
// A bill is a saved cart of kind 'table' (HWPOS_STORE.savedCarts) named after its table ('' = none yet); lines sent
// to the kitchen carry `sent`. While one is open on the cart, state.bill = { table, qr } and state.savedId is its row.
const tbTry = () => state.settings.tablesTry || 'a';
const tbPhone = () => matchMedia('(max-width: 720px)').matches;
const tbBills = () => loadSavedCarts().filter(d => d.kind === 'table');
const tbNum = (name) => Number(String(name).replace(/\D/g, '')) || 1e9;   // no number: last
const tbTotal = (d) => cartTotals(d.items || [], d.cartDiscount, d.scPwd).total;
const tbNew = () => state.cart.filter(i => !i.sent).length;
const tbName = (d) => d.name || 'No table';
const TB_DOT = '<i class="tb-dot" aria-label="QR order"></i>';
let tbSheet = null;

// A row of the sheet (A) and a tile of the checkout's list (B, C): Pay now, a table, Add table
const tbRow = (key, name, amt, cur) => `<button type="button" data-tb="${escapeHtml(key)}"${cur ? ' class="cur"' : ''}><span>${escapeHtml(name)}</span>${amt == null ? '' : `<span class="v num">${peso(amt)}</span>`}</button>`;
const tbTile = (attr, pt, inner, name, small = '', cur) =>
  `<button type="button" class="co-tile${cur ? ' pick' : ''}" ${attr}><span class="pt-tile" style="--pt: var(--pt-${pt})">${inner}</span><span>${name}</span><small class="num">${small}</small></button>`;
const tbPayTile = (total) => `<button type="button" class="co-tile" data-tb="pay">${payTile('cash')}<span>Pay now</span><small class="num">${peso(total)}</small></button>`;
const tbAddTile = () => tbTile('data-tb="+"', 'grey', '<b class="tb-n">+</b>', 'New table');
const tbSub = (d) => [d.number && `#${escapeHtml(d.number)}`, d.qr && 'QR',SalesMath.plural((d.items || []).length, 'item'), tillDate(d.ts, 'time')].filter(Boolean).join(' · ');   // A's row line
const tbBillTile = (d, more) => tbTile(`data-tb-bill="${d.id}"`, 'blue',`<b class="tb-n">${d.name ? tbNum(d.name) : 'QR'}</b>`,
  `${d.qr ? TB_DOT : ''}${escapeHtml(tbName(d))}${more ? `<em class="tb-sub num">${tbSub(d)}</em>` : ''}`, peso(tbTotal(d)));

// Every table: the QR tables (Settings › QR tables) and any other with a bill on it, by number. Busy = a bill that isn't this one.
function tbChoices() {
  const bills = tbBills();
  const names = [...new Set([...qrTables().map(t => t.name), ...bills.map(b => b.name).filter(Boolean)])].sort((a, b) => tbNum(a) - tbNum(b));
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

// The picker. move: the bill's table row (iPad) -- no Pay now.
function tbPick(move = false) {
  const t = 'efg'.includes(tbTry()) ? 'c' : tbTry(), list = tbChoices(), table = state.bill?.table, total = cartTotals().total;   // E, F, G pick as C
  const title = move ? 'Move to' : t === 'c' && table && tbNew() ? table : 'Save or pay';
  const tiles = `${move ? '' : tbPayTile(total)}${list.map(c => tbTile(`data-tb="${escapeHtml(c.name)}"`, c.amt == null ? 'grey' : 'blue',
    `<b class="tb-n">${tbNum(c.name) < 1e9 ? tbNum(c.name) : ''}</b>`, escapeHtml(c.name), c.amt == null ? '' : peso(c.amt), c.cur)).join('')}${tbAddTile()}`;
  if (t === 'a' || t === 'd' || (t === 'c' && !tbPhone())) {
    const body = t === 'a'
      ? `${move ? '' : `<div class="fs-rows">${tbRow('pay', 'Pay now', total)}</div>`}<div class="fs-rows">${list.map(c => tbRow(c.name, c.name, c.amt, c.cur)).join('')}</div><div class="fs-rows">${tbRow('+', 'New table')}</div>`
      : `<div class="co-tiles tb-tiles">${tiles}</div>`;
    tbSheet = openSheet(move ? $('#tbMove') : $('#payBtn'), `<div class="fs-top">
      <button type="button" class="fs-x cta-2" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg></button>
      <h2 id="fsTitle">${escapeHtml(title)}</h2><i></i></div><div class="fs-body">${body}</div>`, t === 'c' ? 'half' : '');   // A, D: the tall sheet, up to the top
    return;
  }
  // B, and C on the phone: the checkout page itself, its pay tiles swapped for the tables (renderCheckout puts them back)
  openPaymentModal();
  $('#checkoutApp').classList.add('tb-pick', `tb-${t}`);
  $('#checkoutMethods').innerHTML = tiles;
  $('#tbTtl').textContent = title;
  const said = $('#spPaid');
  said.hidden = t !== 'b';
  said.textContent = table && tbNew() ? `Send to ${table}, or pay` : 'Save or pay';
}
function tbPickOff() {
  $('#checkoutApp')?.classList.remove('tb-pick', 'tb-b', 'tb-c');
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
    return showToast('Bill was not saved. Check browser storage.');
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

// ✕ on an open bill: new items ask Save (send) or Discard; only the Discard button discards (a tap beside keeps the bill open)
function tbLeave() {
  if (!tbNew()) return clearCart();
  let discard = false;
  showConfirm({ title: state.bill.table || 'QR order', message: 'Save the new items on this bill?', okText: 'Save', cancelText: 'Discard',
    onConfirm: () => (state.bill.table ? tbSend(state.bill.table) : tbPick()),
    onCancel: () => { if (discard) clearCart(); } });
  $$('.cf-sheet [data-cancel]').at(-1).addEventListener('click', () => { discard = true; });
}

// The cart's bits for a bill: sent lines grey on top, the pill, Accept for a QR order (renderCart)
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

function tbHeroY() {   // the checkout total's line (--hero-y)
  const p = document.createElement('i');
  p.style.cssText = 'position:fixed;top:0;height:var(--hero-y)';
  document.body.append(p);
  const y = p.offsetHeight;
  p.remove();
  return y;
}

// Tables: only the open bills. A = Orders' list, B = how many + what they add up to on the total's line + tiles,
// C, D = one tile list. QR orders first, then by table number, then the ones with no table.
function renderTables() {
  const box = $('.view-tables .c-scroll');
  if (!box) return;
  const t = tbTry(), bills = tbBills().sort((a, b) => (!!b.qr - !!a.qr) || (tbNum(a.name) - tbNum(b.name)));
  if (!bills.length) return void (box.innerHTML = emptyState('receipt', 'No open tables'));
  const sum = moneyValue(bills.reduce((s, d) => s + tbTotal(d), 0));
  if ('afg'.includes(t)) {   // F: A's rows, each its own card with E's number; G: F flat, no outline
    const sep = t !== 'a';
    box.innerHTML = `<div class="c-body"><div class="o-days${sep ? ' tb-sep' : ''}${t === 'g' ? ' tb-flat' : ''}">${sep ? '' : `<div class="band"><span>Open <span class="num">· ${bills.length}</span></span><span class="num">${peso(sum)}</span></div>`}${
      bills.map(d => `<button type="button" class="row" data-tb-bill="${d.id}">${sep ? `<span class="pt-tile" style="--pt: var(--pt-blue)"><b class="tb-n">${d.name ? tbNum(d.name) : 'QR'}</b></span>` : ''}<div class="nm"><span>${d.qr ? TB_DOT : ''}${escapeHtml(tbName(d))}</span>
        <small class="num">${tbSub(d)}</small></div>
        <div class="rt"><span class="amt num">${peso(tbTotal(d))}</span></div></button>`).join('')}</div></div>`;
  } else if (t === 'b') {
    box.innerHTML = `<div class="tb-page"><p class="sp-paid">${bills.length} open</p><div class="co-hero num">${peso(sum)}</div><div class="co-tiles tb-tiles">${bills.map(tbBillTile).join('')}</div></div>`;
    const page = box.firstChild;   // the total on the hero line, set before the first paint (ponytail: not again on a resize)
    box.parentNode.style.setProperty('--head-h', box.previousElementSibling.offsetHeight + 'px');   // FROST_HEADS' observer sets it only after this paint
    page.style.marginTop = tbHeroY() - page.querySelector('.co-hero').getBoundingClientRect().top + 'px';
  } else {
    box.innerHTML = `<div class="c-body"><div class="co-tiles tb-tiles">${bills.map(d => tbBillTile(d, t === 'e')).join('')}</div></div>`;
  }
}

// Once on load: Dine-in on, a sample QR order (seeded once), the side switch on the saved pick, and the clicks.
function tbInit() {
  const f = state.settings.fulfilment || (state.settings.fulfilment = {});
  if ((f.hidden || []).includes('dinein')) { f.hidden = f.hidden.filter(k => k !== 'dinein'); saveSettings(); renderCart(); }
  if (!state.settings.tbQrSeeded) {
    const items = state.products.filter(p => onTill(p) && !askedPrice(p) && p.soldBy !== 'measure' && !itemModifiers(p).length).slice(0, 2)
      .map((p, k) => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit, price: p.price, qty: k + 1 }));
    const store = currentStoreInfo(), r = stampRow({ id: newId(), kind: 'table', name: '', qr: true, customer: null, items, cartDiscount: null, scPwd: null,
      fulfilment: 'dinein', note: '', ts: Date.now(), cashier: store.cashier, staffId: '', register: store.registerNo });
    if (items.length) HWPOS_STORE.savedCarts.put(r.id, r);
    state.settings.tbQrSeeded = true;
    saveSettings();
  }
  for (const d of tbBills()) if (!d.number) HWPOS_STORE.savedCarts.put(d.id, stampRow({ ...d, number: nextOrderNumber() }));   // bills from before numbers, and the QR sample
  $$('[data-try]').forEach(b => b.classList.toggle('active', b.dataset.try === tbTry()));
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-tb]'), bill = e.target.closest('[data-tb-bill]'), tr = e.target.closest('[data-try]');
    if (pick) {
      const k = pick.dataset.tb;
      tbSheet?.close();
      tbSheet = null;
      if (k === 'pay') return state.view === 'checkout' ? renderCheckout() : openPaymentModal();
      if (k !== '+') return tbSend(k);
      return openCartForm('Add table', '<label class="pf"><span class="lb">Table number</span><input class="text-input" name="n" type="text" inputmode="numeric" maxlength="3" autocomplete="off"></label>',
        'Send', fm => { const n = Number(fm.n.value.replace(/\D/g, '')); if (n) tbSend(`Table ${n}`); });
    }
    if (bill) return tbOpen(bill.dataset.tbBill);
    if (e.target.closest('#tbAdd')) { closeEditSheet(); $('#app').classList.remove('ph-cart'); return; }   // phone: back to the grid for more
    if (e.target.closest('#tbMove')) return tbPick(true);
    if (tr) {
      state.settings.tablesTry = tr.dataset.try;
      saveSettings();
      $$('[data-try]').forEach(b => b.classList.toggle('active', b === tr));
      if (state.view === 'tables') renderTables();
    }
  });
}
