// Till › Checkout: payment, the order record, stock moves, success, printing, saved receipts,
// account credit, the manager PIN / sign-in, and completeSale.

// ---------- Payment (full-page Checkout view) ----------
function openPaymentModal() {
  if (state.cart.length === 0) return;
  state.prevView = state.view;
  state.paymentMethodChosen = false;
  SP = null; spOff();   // a new checkout starts out of split
  track('checkout_open', { lines: state.cart.length, subtotal: cartTotals().subtotal });
  switchView('checkout');
  renderCheckout();
}
// What the checkout collects: the cart's total, or in an exchange only the difference (confirmExchange sends it here
// when the customer pays more). The account part is already settled by exchangeMoney, so Account and Split stay off.
const dueNow = () => (state.exchange ? Math.max(0, exchangeNow()?.net || 0) : cartTotals().total);
function renderCheckout() {
  const t = cartTotals();
  const total = dueNow(), x = state.exchange && exchangeNow();

  const cartList = $('#checkoutCartList');
  if (cartList) {
    cartList.innerHTML = (x ? `<div class="co-row"><span class="co-nm">Coming back · #${escapeHtml(x.o.number)}</span><span class="co-amt num">${peso(-x.part.total)}</span></div>` : '')
      + state.cart.map(item => `
      <div class="co-row">
        ${linePic(item)}<span class="co-nm">${escapeHtml(item.name)}<small class="num">${item.qty} × ${peso(item.price)}</small>${
          SalesMath.answerLines(item, peso).map(a => `<small>${escapeHtml(a)}</small>`).join('')}</span>
        <span class="co-amt num">${peso(normalizeOrderItem(item).lineGross)}</span>
      </div>`).join('');
  }
  const discRow = $('#checkoutDiscountRow');
  if (discRow) discRow.hidden = !(t.discount > 0);
  const discEl = $('#checkoutDiscount');
  if (discEl) discEl.textContent = peso(-t.discount);
  const discLabel = $('#checkoutDiscountLabel');
  if (discLabel) discLabel.textContent = SalesMath.discountName({ cartDiscount: t.scPwd ? null : state.cartDiscount, items: state.cart }) || 'Discount';   // the receipt's word
  const totalEl = $('#checkoutTotal');
  if (totalEl) totalEl.textContent = peso(total);
  $('#checkoutCount').textContent = $('#railCount').textContent;
  const totalDue = $('#checkoutTotalDue');
  if (totalDue) totalDue.textContent = peso(total);

  setCheckoutError('');
  const charge = canCharge() && !state.exchange;
  if (!charge && state.paymentMethod === 'credit') Object.assign(state, { paymentMethod: 'cash', paymentMethodChosen: false });
  // You can only charge a named account with credit on, so the two credit tiles appear with it.
  applyPayMethods(charge);
  renderQuickCashOptions(total);
  if (!state.paymentMethodChosen) state.paymentMethod = 'cash';
  $('#checkoutApp')?.classList.remove('is-done');
  $('.co-items')?.classList.remove('open');   // phone: the receipt sheet
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
  // Split is one part per method, Account (pay later) one of them; an exchange offers neither.
  const shown = PAY_TILES.filter(([m]) => m === 'cash' || (!off.has(m) && (m === 'split' ? !state.exchange : canCharge || m !== 'credit')));
  const custom = payCustomOn().map(name => ['other', name, CUSTOM_PAY_ICON, name]);
  const at = shown.findIndex(([m]) => needsAccount(m));
  const tiles = at < 0 ? [...shown, ...custom] : [...shown.slice(0, at), ...custom, ...shown.slice(at)];
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
  if (SP) return spRender();   // split: its own steps (a customer change re-renders the checkout)
  cashOk = false;
  const m = state.paymentMethod;
  const step = !state.paymentMethodChosen ? 'method' : m === 'cash' ? 'cash' : 'paid';
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== step; });
  // How many across the count wants: 4 -> 2x2, 6 -> 3x2, 8 -> 4x2. One tile size at any count.
  const n = $$('#checkoutMethods .co-tile').length;
  $('#checkoutMethods')?.style.setProperty('--cols', n <= 4 ? 2 : n <= 6 ? 3 : 4);
  const backText = $('#checkoutBackText'); if (backText) backText.textContent = step === 'method' ? 'Cancel' : 'Back';
  showCashKeys(false);
  const typing = m === 'other' && !state.paymentLabel;
  const other = $('#otherMethodInput'); if (other) other.hidden = !typing;
  // Settings › Payment types › Ask for; an exchange has none: payment.ref there marks the swap rows (sales-math paidOf)
  $('#payRefInput').hidden = step !== 'paid' || !!state.exchange || !payRefOn(state.paymentLabel || m);
  const ask = $('#checkoutAsk');
  if (ask) ask.textContent = m === 'credit' ? `Charge to ${state.customer?.name || 'account'}`
    : typing ? 'Paid with' : `Paid with ${state.paymentLabel || KNOWN_METHOD_LABELS[m] || m}`;
  updateChange();
  // A type with a picture (Settings › Payment types › Picture): the total slides up, its QR under it; Done -> the step above
  if (!state.paymentMethodChosen) qrDone = '';
  const paid = $('#checkoutSteps [data-step="paid"]'), pic = payTypes().qrCodes[keyNow()];
  const qr = state.paymentMethodChosen && !paid.hidden && !!pic && qrDone !== keyNow();
  $('#checkoutApp').classList.toggle('qr-up', qr);
  $('#qrStep').hidden = !qr;
  if (qr) {
    paid.hidden = true;
    $('#qrImg').src = pic;
    $('#qrCap').textContent = `Scan with ${state.paymentLabel || KNOWN_METHOD_LABELS[m] || m}`;
  }
  askBox();
}

// The picture's type once its Done was tapped (Back on the next step = the picture again); Cash's ask step is up (cashAsk)
let qrDone = '', cashOk = false;
const keyNow = () => state.paymentLabel || state.paymentMethod;
// The box asks the type's word (Settings › Payment types › Ask for); Must fill in holds Complete sale (or a split part's Done)
const askKey = () => (SP ? SP.leg?.key : keyNow());
const mustWait = () => !$('#payRefInput').hidden && opt(askKey()).must && !$('#payRefInput').value.trim();
const askLow = () => opt(askKey()).ask.replace(/^\w/, c => c.toLowerCase());   // "Last 4 digits" -> "last 4 digits"
function askBox() {
  const o = opt(askKey()), box = $('#payRefInput');
  box.placeholder = `${o.ask} (${o.must ? 'required' : 'optional'})`;
  box.setAttribute('aria-label', box.placeholder);
  mustBtn();
}
// Must fill in with the box empty: the button reads what's missing and stays tappable (app.js says it again), else Complete sale / a split part's Done
function mustBtn() {
  const btn = $('[data-step="paid"] [data-complete]'), wait = mustWait();
  btn.textContent = wait ? `Enter ${askLow()}` : SP ? 'Done' : 'Complete sale';
  btn.classList.toggle('wait', wait);
}
// Cash with Ask for on (owner 2026-10-22): the amount is in -> "Got ₱200.00 · Change ₱55.00", the box under it -> Complete sale
function cashAsk(got, total) {
  cashOk = true;
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== 'paid'; });
  $('#otherMethodInput').hidden = true;
  $('#payRefInput').hidden = false; $('#payRefInput').value = '';
  $('#checkoutAsk').textContent = `Got ${peso(got)} · Change ${peso(got - total)}`;
  askBox();
  setTimeout(() => $('#payRefInput').focus(), 60);
}

function updateChange() {
  if (SP) return;   // split's figures are spRender's
  const total = dueNow();
  const raw = ($('#checkoutTender')?.value || '').trim();
  const tender = moneyValue(parseFloat(raw) || 0);
  const d = moneyValue(tender - total);
  // Label above, figure under it, the figure shrinks to its row (--n = its length): ₫ millions and long words never squeeze.
  const fig = (el, html, cls) => { if (!el) return; el.innerHTML = html; el.style.setProperty('--n', el.textContent.length); el.className = 'co-fig num ' + cls; };
  const zero = SalesMath.formatMoney(0, state.settings?.store?.currency, { whole: true });
  const caret = html => html.replace(/(\d[.,]?)(?!.*\d)/, '$1<span class="co-caret"></span>');
  const typed = r => caret(r ? typedCash(r) : zero);
  const lbl = $('#checkoutChangeLbl'), lbl0 = $('#checkoutCashLbl'), go = $('#checkoutCompleteBtn');
  setCheckoutError('');
  const ok = d >= 0;
  if (lbl0) lbl0.textContent = 'Cash received';
  fig($('#checkoutCash'), typed(raw), raw ? '' : 'ph');
  // Custom (owner 2026-10-28, cash-custom-picks.html F): the big number is what's typed, "Cash received" the title; no total, no change
  const keys = !$('#checkoutKeyIn').hidden, hero = $('#checkoutTotalDue');
  $('#checkoutApp').classList.toggle('co-typed', keys);
  hero.innerHTML = keys ? typed(raw) : peso(total);
  hero.classList.toggle('ph', keys && !raw);
  if (lbl) lbl.textContent = raw && d < 0 ? 'Short' : 'Change';
  fig($('#checkoutChange'), !raw ? zero : peso(Math.abs(d)), !raw ? 'ph' : !ok ? 'down' : 'up');
  if (go) go.disabled = !raw || !ok;
}

// Split (owner 2026-10-17, split-carry-lab.html): two pages. The Split page is the checkout's own method tiles (no Split,
// no typed Other); tap one -> its "how much" page (the figure + keypad) -> Done -> back, that tile now carrying its amount
// (nothing typed = that method off the split). The big number counts down once money is in, the total moving to the small
// line under it. Complete sale when nothing is left; a cash part then asks what was handed over (quick cash). The tiles,
// quick cash, figures, keypad and buttons are the checkout's own; app.js sends their taps here while SP is set.
// The sale records one payment row per part (buildOrderPayments).
let SP = null;   // { legs: [{ key, label, amount, given?, change?, ref? }], leg, k: 'pick' | 'amt' | 'ref' | 'given' | 'typed', raw, fresh }

// what's left to pay; `but` = the part being typed, so its own amount doesn't count against it
const spLeft = (but) => moneyValue(dueNow() - SP.legs.reduce((s, l) => s + (l === but ? 0 : l.amount), 0));

function spOpen() {
  SP = { legs: [], leg: null, k: 'pick', raw: '', fresh: false };
  Object.assign(state, { paymentMethod: 'split', paymentLabel: '', paymentMethodChosen: true });
  $('#checkoutApp').classList.add('sp');
  spRender();
  const m = $('#checkoutSteps [data-step="method"]');   // the tiles come in again, so the tap reads as a new mode
  m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
}
function spClose() {   // back to the plain method tiles
  SP = null;
  Object.assign(state, { paymentMethod: 'cash', paymentLabel: '', paymentMethodChosen: false });
  spOff();
  $('#checkoutTotalDue').textContent = peso(dueNow());
  renderQuickCashOptions(dueNow());
  showPayStep();
}
function spOff() {   // what split adds comes off (also when a sale ends or a new checkout opens)
  $('#checkoutApp').classList.remove('sp', 'sp-cash', 'qr-up');
  $('#spPaid').hidden = $('#spDone').hidden = true;
  $$('#checkoutMethods .co-tile').forEach(t => { t.hidden = false; t.classList.remove('pick'); t.querySelector('small')?.remove(); });
  $('#checkoutCompleteBtn').textContent = 'Complete sale';
  $('#checkoutChangeLbl').parentElement.hidden = false;
}
const spKeyOf = t => t.dataset.label || t.dataset.method;
const spCan = t => !(t.dataset.method === 'split' || (t.dataset.method === 'other' && !t.dataset.label));
function spGo(k, raw = '', fresh = false) { Object.assign(SP, { k, raw, fresh }); spRender(); }
const spRaw = v => v.toFixed(2).replace(/\.00$/, '');   // 21.5 -> "21.50", 750 -> "750", as it would be typed
// a method's page opens with its amount, or with what's left, the first part too (owner 2026-10-17): grey till the first key replaces it
function spAmt() { const v = SP.leg.amount || spLeft(SP.leg); spGo('amt', v ? spRaw(v) : '', !!v); }

function spRender() {
  // a part whose tile went (customer changed, credit off, a method hidden) comes off: no tile, no way to change it
  const shown = new Set($$('#checkoutMethods .co-tile').map(spKeyOf));
  SP.legs = SP.legs.filter(l => shown.has(l.key));
  if (SP.leg && !shown.has(SP.leg.key)) Object.assign(SP, { leg: null, k: 'pick', raw: '', fresh: false });
  const { k, leg, legs } = SP, due = moneyValue(dueNow()), left = spLeft(k === 'pick' || k === 'ref' ? null : leg);   // the ref page: that part is in
  setCheckoutError('');
  const cash = k === 'given' || k === 'typed';   // the cash part's change: its own title, no countdown line (owner 2026-10-17)
  const full = !cash && left === 0 && left !== due;   // nothing left: the words take the number's place, no line under (owner 2026-10-17)
  $('#checkoutTotalDue').textContent = full ? 'Paid in full' : peso(left);
  $('#checkoutApp').classList.toggle('sp-cash', cash);
  const paid = $('#spPaid');   // the countdown's small line: the total it counts down from
  paid.hidden = cash || full || left === due;
  paid.textContent = `left of ${peso(due)}`;
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== (k === 'pick' ? 'method' : k === 'ref' ? 'paid' : k === 'qr' ? 'qr' : 'cash'); });
  $('#checkoutApp').classList.toggle('qr-up', k === 'qr');
  $('#checkoutBackText').textContent = 'Back';
  $('#otherMethodInput').hidden = true;
  $('#payRefInput').hidden = k !== 'ref';
  if (k === 'qr') {   // a part whose type has a picture: that part's amount over its QR, Done -> its box or the Split page
    $('#checkoutTotalDue').textContent = peso(leg.amount);
    paid.hidden = true;
    $('#qrImg').src = payTypes().qrCodes[leg.key];
    $('#qrCap').textContent = `Scan with ${leg.label}`;
    return;
  }
  if (k === 'ref') {   // a part whose type asks: the plain checkout's own box, Done back to the Split page
    $('#checkoutAsk').textContent = `Paid with ${leg.label}`;
    return askBox();
  }

  if (k === 'pick') {   // the Split page: a part's tile carries its amount; Complete sale once nothing is left
    $$('#checkoutMethods .co-tile').forEach(t => {
      const l = legs.find(x => x.key === spKeyOf(t));
      t.hidden = !spCan(t);
      t.classList.toggle('pick', !!l);
      t.querySelector('small')?.remove();
      if (l) t.insertAdjacentHTML('beforeend', `<small class="num">${peso(l.amount)}</small>`);
    });
    const done = $('#spDone');
    done.hidden = false;
    done.disabled = !legs.length || left !== 0;
    return;
  }
  const keys = k !== 'given';
  $('#checkoutQuick').hidden = keys; $('#checkoutKeyIn').hidden = !keys;
  if (!keys) return renderQuickCashOptions(leg.amount);   // Exact / the notes / Custom, for the cash part
  const btn = $('#checkoutCompleteBtn');

  // One figure (two for a typed Cash given: Given and the change), the keypad, Done or Complete sale
  const fig = (el, html, cls) => { el.innerHTML = html; el.style.setProperty('--n', el.textContent.length); el.className = 'co-fig num ' + cls; };
  const caret = '<span class="co-caret"></span>', v = moneyValue(parseFloat(SP.raw) || 0), raw = SP.raw;
  const money = r => (r ? typedCash(r) : peso(0));
  $('#checkoutChangeLbl').parentElement.hidden = k !== 'typed';
  let ok = true;
  fig($('#checkoutCash'), money(raw) + caret, raw && !SP.fresh ? '' : 'ph');
  if (k === 'typed') {
    ok = !!raw && v >= leg.amount;
    $('#checkoutChangeLbl').textContent = raw && v < leg.amount ? 'Short' : 'Change';
    fig($('#checkoutChange'), peso(raw ? Math.abs(v - leg.amount) : 0), !raw ? 'ph' : v >= leg.amount ? 'up' : 'down');
    btn.textContent = 'Complete sale';
  } else btn.textContent = 'Done';   // amt: the method's name and the number; the keys never go past what's left (spKey)
  $('#checkoutCashLbl').textContent = k === 'typed' ? 'Cash given' : leg.label;
  btn.disabled = !ok;
}

function spNext() {   // Complete sale on the Split page, Done / Complete sale on a keypad page
  const { k, leg, legs } = SP, v = moneyValue(parseFloat(SP.raw) || 0);
  if (k === 'pick') {   // a part's box left by Back first, then a cash part asks what was handed over; no cash, the sale is done
    const need = legs.find(l => payRefOn(l.key) && opt(l.key).must && !l.ref);
    if (need) { SP.leg = need; $('#payRefInput').value = ''; spGo('ref'); return setTimeout(() => $('#payRefInput').focus(), 60); }
    const cash = legs.find(l => l.key === 'cash');
    if (!cash) return completeSale();
    SP.leg = cash;
    return spGo('given');
  }
  if (k === 'typed') { Object.assign(leg, { given: v, change: moneyValue(v - leg.amount) }); return completeSale(); }
  if (k === 'ref') { leg.ref = $('#payRefInput').value.trim(); SP.leg = null; return spGo('pick'); }
  // amt -> Done: this method's part in its place on the Split page, or off it when nothing was typed
  const i = legs.indexOf(leg);
  if (i >= 0) legs.splice(i, 1);
  delete leg.given; delete leg.change;
  if (v > 0) legs.splice(i >= 0 ? i : legs.length, 0, Object.assign(leg, { amount: v }));
  if (v > 0 && leg.key !== 'cash' && payTypes().qrCodes[leg.key]) return spGo('qr');   // its picture first; Cash has none
  if (v > 0) return spAsk(leg);
  SP.leg = null;
  spGo('pick');
}
function spAsk(leg) {   // its type asks (Ask for): that page next, else the Split page
  if (!payRefOn(leg.key)) { SP.leg = null; return spGo('pick'); }
  $('#payRefInput').value = leg.ref || '';
  spGo('ref');
  setTimeout(() => $('#payRefInput').focus(), 60);
}

function spKey(key) {
  const amt = SP.k === 'amt', max = amt ? spLeft(SP.leg) : CASH_MAX;
  if (amt && key === 'del' && SP.fresh) return;   // the grey amount stays (owner 2026-10-17); 0 then Done takes this method off
  const base = SP.fresh && key !== 'del' ? '' : SP.raw, raw = esPress(base, key, true, max);
  const over = amt && raw === base && /\d/.test(key) && !/\.\d\d$/.test(base) && !(base === '0' && key === '0');   // 0 on a 0 is a no-op, not too much; 5 on a 0 with ₱0.50 left is
  if (amt && !raw && base) return spAmt();   // deleted back to nothing: what's left comes back, grey
  if (!over) { Object.assign(SP, { raw, fresh: false }); spRender(); }   // refused: the grey amount stays grey; '' kept here dropped the part on Done (review 2026-10-19)
  else {   // a key past what's left: the number shakes (co-shake), never a dead key (owner 2026-10-17)
    const el = $('#checkoutCash');
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'co-shake .4s ease';
    const off = () => { el.style.animation = ''; };   // left on, the next page would shake as it shows
    el.addEventListener('animationend', off, { once: true }); el.addEventListener('animationcancel', off, { once: true });   // cancel: Done / Back mid-shake hides the step
  }
}

function spBack() {   // typed cash -> the notes; a keypad page or the notes -> the Split page as it was; the Split page -> the tiles
  if (SP.k === 'typed') return spGo('given');
  if (SP.k === 'pick') return spClose();
  if (SP.k === 'qr') SP.legs.splice(SP.legs.indexOf(SP.leg), 1);   // its picture, not scanned: the part comes off
  SP.leg = null;
  spGo('pick');
}

// What's typed, in the store's format, decimals as typed: "1250.5" -> "₱1,250.5"
function typedCash(raw) {
  const [i, d] = raw.split('.'), s = SalesMath.formatMoney(+i || 0, state.settings?.store?.currency, { whole: true });
  return d === undefined ? s : s.replace(/(\d)(?!.*\d)/, `$1${peso(0).match(/0(\D)0/)?.[1] || '.'}${d}`);
}

// Quick cash: Exact, then the next of each step above the total (the notes people hand over), never below it.
// ponytail: three markets; add a currency here when a store uses it, PHP's steps otherwise
const CASH_STEPS = { PHP: [100, 500, 1000], USD: [5, 10, 20], JPY: [1000, 5000, 10000] };
function quickTenders(total, currency) {
  const c = Math.round(total * 100);
  const above = m => (Math.floor(c / (m * 100)) + 1) * m;
  return [c / 100, ...new Set((CASH_STEPS[currency] || CASH_STEPS.PHP).map(above))];
}
console.assert(quickTenders(245).join() === '245,300,500,1000' && quickTenders(950).join() === '950,1000'
  && quickTenders(24318.75).join() === '24318.75,24400,24500,25000' && quickTenders(7.43, 'USD').join() === '7.43,10,20', 'quickTenders');

// The quick row and the keypad take turns: Custom opens the keys, Back closes them.
function showCashKeys(on) {
  const quick = $('#checkoutQuick'), keys = $('#checkoutKeyIn');
  if (!quick || !keys) return;
  quick.hidden = on; keys.hidden = !on;
  $('#checkoutTender').value = '';
  updateChange();
}

function renderQuickCashOptions(total) {
  const wrap = $('#checkoutQuick');
  if (!wrap) return;
  const q = quickTenders(total, state.settings?.store?.currency);
  const short = v => peso(v).replace(/\.00$/, '');
  wrap.style.setProperty('--cols', q.length + 1);   // one line: the amounts + Custom
  wrap.innerHTML = q.map((v, i) => `<button type="button" class="co-tile" data-co-cash="${v}">${i === 0
    ? '<span class="co-big">Exact</span><small>No change</small>'
    : `<span class="co-big num">${short(v)}</span><small class="up num">Change ${peso(moneyValue(v - total))}</small>`}</button>`).join('')
    + '<button type="button" class="co-tile" data-co-custom><span class="co-big">Custom</span><small>Any amount</small></button>';
  $('#checkoutKeys').innerHTML ||= esKeys(true);   // the edit sheet's keys (pos-sell)
}

// `approvedBy`: the manager whose PIN let this sale past a gate (the credit limit), else ''.
function buildOrderRecord({ status = 'completed', paymentMethod = state.paymentMethod, tendered = 0, change = 0, customerOverride, approvedBy = '', split = null, ref = '' } = {}) {
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
    approvedBy: approvedBy || state.discountOk?.by || '',   // else the manager who let a big discount through (discountOk)
    discountApprovedBy: state.discountOk?.by || '',          // kept on its own: a credit-limit yes above takes approvedBy
    register: store.registerNo,
    // Each line keeps what it cost us now (step 2.2); reading an order never fills it in later.
    // A made item's line keeps its recipe as sold (parts), so a refund after the recipe changed returns what was used.
    items: state.cart.map(i => { const p = productOf(i); return { ...i, cost: i.cost ?? p?.cost ?? null, ...(p?.madeFrom?.length ? { parts: p.madeFrom.map(m => ({ ...m })) } : {}), ...(sc ? { discount: null } : {}) }; }),
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
    payments: buildOrderPayments({ status, paymentMethod, total: totals.total, tendered, change, split, ref }),
    vatRate: totals.vatRate,
    vatAmount: totals.vatAmount,
    vatableSales: totals.vatableSales,
    vatExempt: totals.vatExempt,
    scPwdOff: totals.scPwdOff,
    scPwd: sc && state.scPwd ? { ...state.scPwd } : null,   // the cardholder, for the slip (receiptParts.scPwdId)
    taxIncluded: totals.taxIncluded,
    fulfilment: state.fulfilment || 'walkin',
    deliveryAddress: state.fulfilment === 'delivery' ? state.deliveryAddress : '',
    deliveryLocation: state.fulfilment === 'delivery' ? state.deliveryLocation : null,
    note: state.orderNote || '',
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
// A made item moves its parts, never itself (bo-model withMade): 2 burgers take 2 patties and 2 buns, a refund puts them back.
// The line's own recipe (parts, stamped at the sale); an order from before that falls back to today's.
const partsOf = item => (item.parts?.length ? item.parts : productOf(item)?.madeFrom) || [];
const stockLines = items => (items || []).flatMap((item) => {
  const p = productOf(item), parts = partsOf(item);
  return parts.length ? parts.map(m => ({ productId: m.id, qty: toNumber(item.qty, 0) * (Number(m.qty) || 0), madeInto: p?.name || item.name || '' })) : [item];
});
function moveStock(items, { reason, refId = '', note = '', sign = -1 }) {
  const rows = [];
  stockLines(items).forEach((item) => {
    const p = productOf(item);
    if (!p) return;
    const qty = roundQty(p, sign * toNumber(item.qty, 0));   // at the part's step first: 0.4 of a piece writes no row
    if (!qty) return;
    const mv = makeMovement({
      productId: p.id, qty, reason, refId, note: note || item.madeInto || '',
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

// eaten (owner 2026-10-20): a Food store's refunded dish was made, so its ingredients stay used; a void (nothing was
// made) and every Retail refund put the parts back. A plain item (a can of Coke) comes back either way.
function restoreOrderStock(order, note = '', eaten = false) {
  moveStock(eaten ? order.items.filter(i => !partsOf(i).length) : order.items, { reason: 'return', refId: order.id, note, sign: 1 });
}

function showOrderAfterCartClears(order) {
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  state.selectedOrderId = order.id;
  switchView('orders');
  renderOrders();
}

// `handBack`: an exchange's money going back (exchangeOrder) -- the big number then reads Hand back, not Change.
function showCheckoutSuccess(order, handBack = 0) {
  SP = null; spOff();
  clearCart();
  const back = $('#paymentModal'); if (back) back.hidden = true;
  if (state.view !== 'checkout') switchView('checkout');
  // The only big number is the change to hand back; method, cash and total are on the receipt.
  const change = moneyValue(handBack || order.change || 0);
  const changeBlock = $('#successChangeBlock');
  if (changeBlock) changeBlock.hidden = !(change > 0);
  if (changeBlock) changeBlock.firstElementChild.textContent = handBack ? 'Hand back' : 'Change';
  $('#checkoutDone .co-done-h').textContent = SalesMath.isExchange(order) ? 'Exchange complete' : 'Sale complete';
  const changeEl = $('#successChange');
  $('#checkoutSteps').hidden = true;
  $('#checkoutDone').hidden = false; // un-hiding replays the check and the rise
  $('#checkoutApp').classList.add('is-done');
  hideToast();   // an "Enter the … first" from the step before is over (blind test 2026-10-23)
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
    // a big change shrinks to the column, sized on the final figure so the count-up doesn't jump
    // ponytail: sized once; a tablet turned mid-moment keeps it
    changeEl.style.removeProperty('--fit');
    changeEl.textContent = peso(change);
    const room = $('#checkoutDone').clientWidth, w = changeBlock.scrollWidth;
    if (w > room) changeEl.style.setProperty('--fit', `${Math.floor(64 * room / w)}px`);
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
    showDone('Printer connected');
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
    if (!opts.silent) showDone('Receipt printed');
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

// ---------- Saved carts and quotes (owner 2026-10-07) ----------
// A saved cart is a draft, not an order: no receipt number, no stock, no money. It lives in its own list
// (HWPOS_STORE.savedCarts) and Orders lists it beside the sales. A quote is a saved list that printed a
// QUOTATION slip. Continue loads it back at TODAY's prices; the sale that completes it deletes it.
// Old lab orders saved with status 'saved' stay as they are.
const STORAGE_SAVED_CARTS = storeKey('savedCarts');
function loadSavedCarts() {
  const list = readJsonStorage(STORAGE_SAVED_CARTS, []);
  return Array.isArray(list) ? list.filter(d => d && d.id) : [];
}
// One draft read as an order, so the Orders rail, its slip and the printer show it like any row:
// status 'saved' (no money, no stock: SalesMath.rowState), no number, `draft` = its kind.
function draftAsOrder(d) {
  const t = cartTotals(d.items || [], d.cartDiscount, d.scPwd);
  const money = Object.fromEntries(['subtotal', 'discount', 'total', 'vatRate', 'vatAmount', 'vatableSales', 'vatExempt', 'scPwdOff', 'taxIncluded'].map(k => [k, t[k]]));
  return { ...normalizeOrderRecord({ ...d, ...money, status: 'saved', paymentMethod: 'unpaid' }), number: '', draft: d.kind === 'quote' ? 'quote' : 'saved', name: d.name || '' };
}
const draftOrders = () => loadSavedCarts().map(draftAsOrder);

// The cart as a draft. Saving again (after Continue) updates the same entry of the same kind; a continued quote
// saved as a cart (or the reverse) is a new entry, so the quote stays as printed. Throws when it did not land.
function saveDraft(kind, name) {
  const store = currentStoreInfo(), prev = state.savedId && loadSavedCarts().find(d => d.id === state.savedId && d.kind === kind);
  // The customer on the cart, else the typed name as one (draftReceiptCustomerFromName) so the slip names them.
  const c = state.customer || draftReceiptCustomerFromName(name);
  const row = stampRow({
    id: prev ? prev.id : newId(),
    kind,
    name: String(name || '').trim(),
    customer: c ? { id: c.id, name: c.name, phone: c.phone || '', address: c.address || '' } : null,
    items: state.cart.map(i => ({ ...i })),
    cartDiscount: state.cartDiscount ? { ...state.cartDiscount } : null,
    scPwd: state.scPwd ? { ...state.scPwd } : null,   // the SC/PWD cardholder: the quote prints the SC price, Continue brings it back
    fulfilment: state.fulfilment || 'walkin',
    deliveryAddress: state.fulfilment === 'delivery' ? state.deliveryAddress : '',
    deliveryLocation: state.fulfilment === 'delivery' ? state.deliveryLocation : null,
    note: state.orderNote || '',
    ts: Date.now(),
    cashier: store.cashier,
    staffId: state.user?.id || '',
    register: store.registerNo,
  });
  HWPOS_STORE.savedCarts.put(row.id, row);   // runs to the write before its promise; read back to know it landed
  if (!loadSavedCarts().some(d => d.id === row.id && d.updatedAt === row.updatedAt)) throw new Error('Saved cart could not be saved.');
  return row;
}
// The sale that completes a continued draft, or a draft nobody needs: gone (a draft is not a ledger).
function dropDraft(id) {
  if (id) HWPOS_STORE.savedCarts.remove(id);
  state.savedId = '';
}

// "Save cart" and "Print quote" (the cart ⋯): one name sheet (openCartForm).
function openSaveReceiptModal(kind = 'saved') {
  if (state.cart.length === 0) return;
  const word = kind === 'quote' ? 'Print quote' : 'Save cart';
  const name = (state.savedId && loadSavedCarts().find(d => d.id === state.savedId)?.name) || state.customer?.name || '';
  openCartForm(word, `<label class="pf"><span class="lb">Customer name</span><input class="text-input" name="who" type="text" autocomplete="off" placeholder="Optional" value="${escapeHtml(name)}"></label>`,
    word, f => saveCurrentReceipt(f.who.value, kind));
}
// The order's note (owner 2026-10-09): under who it's for on the cart, on the order, its slip and Orders. Empty = none.
function openOrderNote() {
  openCartForm(state.orderNote ? 'Edit note' : 'Add note', `<label class="pf"><span class="lb">Note</span><input class="text-input" name="note" type="text" maxlength="120" autocomplete="off" placeholder="For this order" value="${escapeHtml(state.orderNote || '')}"></label>`,
    'Save', f => { state.orderNote = f.note.value.replace(/\s+/g, ' ').trim(); renderCart(); });
}
// The cart ⋯'s small form, in the middle of the screen (the pay sheet's veil + card, centreSheet).
// `field`: its one labelled input; onSubmit(form) runs in the tap's gesture (a quote's print pop-up needs it).
function openCartForm(title, field, ok, onSubmit) {
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<form class="pay-sheet" role="dialog" aria-label="${title}" novalidate>
    <div class="ph"><b>${title}</b></div>
    ${field}
    <div class="pb"><button type="button" class="secondary-btn small" data-cancel>Cancel</button><button type="submit" class="primary-btn small">${ok}</button></div>
  </form>`;
  const f = veil.firstChild;
  f.style.width = Math.min(340, innerWidth - 24) + 'px';
  document.body.append(veil);
  const shrink = centreSheet(f);
  // Cancel, the veil and Esc ask first when the field changed (askLeave, owner 2026-10-22); its ask's own Esc wins.
  const onKey = (e) => { if (e.key === 'Escape' && !confirmSheet) { e.stopPropagation(); leave(); } };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    veil.style.pointerEvents = 'none';
    shrink(() => veil.remove());
  };
  document.addEventListener('keydown', onKey, true);
  const leave = leaveForm(f, close);   // after close: leaveForm reads it now
  veil.addEventListener('click', (e) => { if (e.target === veil || e.target.closest('[data-cancel]')) leave(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (veil.style.pointerEvents) return;   // closing already: a second Enter must not save twice
    close();
    onSubmit(f);
  });
  f.querySelector('input').focus({ preventScroll: true });
}

function saveCurrentReceipt(name = '', kind = 'saved') {
  if (state.cart.length === 0) return;
  try {
    const order = draftAsOrder(saveDraft(kind, name));
    track('cart_hold', { lines: order.items.length, kind });
    if (kind === 'quote') printOrder(order);   // first: the browser pop-up needs the tap's gesture
    showOrderAfterCartClears(order);
  } catch (err) {
    console.error(err);
    showToast('Cart was not saved. Check browser storage.');
    flashControl($('#cartMoreBtn'));
  }
}

// Continue (Orders): the draft's lines back in the cart at today's prices, by product id. Qty and the line and
// cart discounts stay (a price-match is a discount). A deleted item is skipped, with a toast; with nothing left to
// sell the cart stays as it is. A hidden or archived one asks "Sell anyway?" first, like a scan does (addProductByCode).
// Kept lines at today's prices (a saved cart, the cart kept over a reload): { lines, gone, off }. Anything not a line
// of an item still on file is gone.
function todayLines(items) {
  const gone = [], off = [], lines = [];
  for (const i of Array.isArray(items) ? items : []) {
    const p = i && typeof i === 'object' && state.products.find(x => x.id === (i.productId || i.id));
    if (!p) { if (i?.name) gone.push(i.name); continue; }
    if (!onTill(p)) off.push(`${p.name} is ${offWhy(p)}.`);
    // a price asked at sale (askedPrice) keeps the line's own id and the price it was given
    // a line with modifiers: its answers at today's prices (freshAnswers drops one no longer offered) on top of the base
    const typed = i.productId && i.id !== i.productId, mods = Array.isArray(i.modifiers) ? freshAnswers(p, i.modifiers) : null;
    const base = askedPrice(p) || (typed && !mods) ? moneyValue(i.price - SalesMath.answersPrice(i)) : p.price;
    lines.push({ ...i, id: typed ? i.id : p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit,
      ...(mods && { modifiers: mods }), price: mods ? moneyValue(base + SalesMath.answersPrice({ modifiers: mods })) : base });
  }
  return { lines, gone, off };
}
function continueDraft(id) {
  const d = loadSavedCarts().find(x => x.id === id);
  if (!d) return;
  const { lines, gone, off } = todayLines(d.items);
  if (!lines.length) return showToast(`Nothing to continue · ${gone.join(', ')} no longer sold`);
  const load = () => {
    clearCart();
    beginCart();
    state.cart = lines;
    state.cartDiscount = d.cartDiscount ? { ...d.cartDiscount } : null;
    state.scPwd = d.scPwd ? { ...d.scPwd } : null;
    state.customer = (d.customer && allCustomerRecords().find(c => c.id === d.customer.id)) || null;
    state.fulfilment = d.fulfilment || state.fulfilment;
    state.deliveryAddress = d.deliveryAddress || '';
    state.deliveryLocation = d.deliveryLocation || null;
    state.orderNote = d.note || '';
    state.savedId = d.id;
    renderCart();
    updateCustomerButton();
    switchView('sell');
    renderProducts();
    if (gone.length) showToast(`Skipped ${gone.join(', ')} · no longer sold`);
  };
  const replace = () => state.cart.length
    ? showConfirm({ title: 'Replace the cart?', message: 'The items in the cart now are removed.', okText: 'Replace', onConfirm: load })
    : load();
  if (!off.length) return replace();
  showConfirm({ title: 'Sell anyway?', message: off.join(' '), okText: 'Sell anyway', onConfirm: replace });
}

// Credit off = Account and Split are not offered (owner 2026-10-02). Read fresh: the back office
// may have switched it since the customer was picked.
const canCharge = () => !!state.customer && !!allCustomerRecords().find(c => c.id === state.customer.id)?.creditOn;

// How far past the customer's limit this sale would push them, in pesos. 0 = fine. The limit is
// read fresh too: one lowered in the back office after the pick still holds. `buildOrderPayments`
// is what actually goes on account, so the tender is split the same way it is charged.
function creditOverLimit(tendered = 0, split = null) {
  const c = state.customer && allCustomerRecords().find(x => x.id === state.customer.id);
  if (!c) return 0;
  const { total } = cartTotals();
  const charge = SalesMath.creditPart({ payments: buildOrderPayments({ status: 'completed', paymentMethod: state.paymentMethod, total, tendered, split }) });
  return creditOverBy(c, charge);   // bo-model: the balance after the charge vs the limit, the Over limit test
}

// Out of stock is asked when the item goes into the cart (stockOnAdd, pos-sell.js), not here.

// postToAccount, the one writer for an account, is in bo-model.js so the back office uses it too.
// A cash payment at the till goes into this register's drawer (buildCashDrawerSummary counts it).
// opts: { method (cash by default), methodLabel, note, orderIds } -- openPaySheet's, the back office's recordPayment
// call; a plain string is the note (the scripts' old call).
function recordCreditPayment(customerId, amount, opts = {}) {
  const { note = '', ...pay } = typeof opts === 'string' ? { note: opts } : opts;
  const store = currentStoreInfo();
  const c = allCustomerRecords().find(x => x.id === customerId);
  const row = c && recordPayment(c, amount,
    { method: 'cash', ...pay, note: note || 'Customer payment', register: store.registerNo, staff: store.cashier });
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

// The manager's approval (gate), the sign-in (lockTill / signIn) and the PIN pad live in pos-pin.js.

// `approvedBy`: the manager whose PIN let this charge go past the credit limit (gate re-runs it).
// `ok`: questions already answered Yes in the app's own pop-up ({ limit }), so the re-run skips them.
function completeSale(approvedBy = '', ok = {}) {
  if (!state.cart.length && !state.exchange) return;   // Sale complete is up (the cart is spent): an Enter or a scan there rang ₱0 orders
  const total = moneyValue(dueNow());
  if (!SP && mustWait()) return $('#payRefInput').focus();   // Must fill in (Settings › Payment types): the box first
  let tendered = total, change = 0, split = null;
  if (SP) {   // split: the parts as paid; tendered / change are the cash parts' (what went in and out of the drawer)
    const legs = SP.legs, cash = legs.filter(l => l.key === 'cash'), sum = f => moneyValue(cash.reduce((s, l) => s + (l[f] || 0), 0));
    if (moneyValue(legs.reduce((s, l) => s + l.amount, 0)) !== total) return setCheckoutError("The parts don't add up to the total.");
    if (cash.some(l => (l.given ?? 0) < l.amount)) return setCheckoutError('The cash given is below the cash part.');
    tendered = sum('given'); change = sum('change');
    split = { legs };
  } else if (['cash', 'gcash', 'qr', 'other'].includes(state.paymentMethod)) {
    const tenderRaw = ($('#checkoutTender')?.value || $('#tenderInput')?.value || '').trim();
    tendered = tenderRaw ? moneyValue(parseFloat(tenderRaw) || 0) : total;
    if (tendered < total) {
      setCheckoutError('Tendered amount is below the total.');
      $('#checkoutTender')?.focus();
      return;
    }
    change = moneyValue(Math.max(0, tendered - total));
  }
  if (!SP && !cashOk && !state.exchange && state.paymentMethod === 'cash' && payRefOn('cash')) return cashAsk(tendered, total);
  if (state.paymentMethod === 'other') {
    const otherName = $('#otherMethodInput')?.value?.trim();
    if (!otherName) {
      setCheckoutError('Please enter the payment method name.');
      $('#otherMethodInput')?.focus();
      return;
    }
  }
  if ((state.paymentMethod === 'credit' || split?.legs.some(l => l.key === 'credit')) && !canCharge()) {
    setCheckoutError(state.customer ? `${state.customer.name} has credit off.` : 'Select a customer before charging to account.');
    return;
  }
  const actualMethod = state.paymentMethod === 'other'
    ? ($('#otherMethodInput')?.value?.trim() || 'Other')
    : state.paymentMethod;
  // An exchange collects only the difference here; exchangeOrder rings both rows and shows this page's done step.
  if (state.exchange) {
    const { orderId, picks } = state.exchange;
    return void exchangeOrder(orderId, state.cart, 'Exchange', '', picks, false, { method: actualMethod, tendered, change });
  }
  // The limit was stored, shown on the customer card, and enforced nowhere -- a ₱5,000
  // account would take a ₱50,000 charge. A role allowed past it confirms; anyone else needs a
  // manager's PIN, which carries straight on with the sale.
  const overBy = creditOverLimit(tendered, split);
  const acct = state.customer && allCustomerRecords().find(x => x.id === state.customer.id);   // fresh, as creditOverLimit reads it
  const overMsg = `${acct?.name} would go ${peso(overBy)} over their ${peso(toNumber(acct?.creditLimit, 0))} credit limit.`;
  if (overBy > 0 && !approvedBy && !ok.limit) {
    if (!gate('overLimit', (by) => completeSale(by, ok), { customerId: state.customer.id, overBy }, overMsg)) {
      setCheckoutError('Charge would exceed the credit limit.');
    } else showConfirm({ title: 'Over the credit limit', message: overMsg, okText: 'Charge anyway',
      onConfirm: () => completeSale(approvedBy, { ...ok, limit: true }) });
    return;
  }
  let order;
  try {
    order = persistOrder(buildOrderRecord({
      status: 'completed',
      paymentMethod: actualMethod,
      tendered,
      change,
      approvedBy,
      split,
      ref: $('#payRefInput').hidden ? '' : $('#payRefInput').value.trim(),
    }));
  } catch (err) {
    console.error(err);
    setCheckoutError('Receipt could not be saved. Sale was not completed.');
    return;
  }

  dropDraft(state.savedId);   // a continued saved cart or quote is now this sale
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

// A sale prints itself when the store says so (checkout, exchange); the drawer opens first, Print on sale or not.
// ponytail: auto-print only for real printers. The browser driver would fire a pop-up on every sale.
function autoPrint(order, moved = order.payments) {
  const pcfg = printerConfig();
  kickFor(moved).then(() => {
    if (pcfg.printOnSale && (pcfg.driver === 'network' || pcfg.driver === 'bluetooth')) printOrder(order, { silent: true });
  });
}
// Settings › Payment types › Opens cash drawer (drawer.js): money in or out on such a type opens it. One rule for a sale,
// a refund or void (voidOrder, refundOrder), an exchange (exchangeOrder) and Cash in / out (shiftMove). One job at a time: Bluetooth can't take two writes at once.
let drawerJob = Promise.resolve();
function kickFor(payments = []) {
  const c = printerConfig();
  // p.drawer: what the sale recorded (drawerOf); older rows have none and read the type's switch now
  if ((c.driver !== 'network' && c.driver !== 'bluetooth') || !payments.some(p => moneyValue(p.amount) !== 0 && (p.drawer ?? opt(payKey(p)).drawer))) return drawerJob;
  // ponytail: 10 s cap, Wi-Fi has its own 8 s; a hung Bluetooth connect would hold every later receipt behind it
  const cap = new Promise((_, no) => setTimeout(() => no(new Error('the printer did not answer')), 10000));
  return (drawerJob = drawerJob.then(() => Promise.race([HWPOS_DRAWER.open(c), cap])).catch(e => showToast('Drawer: ' + e.message)));
}

