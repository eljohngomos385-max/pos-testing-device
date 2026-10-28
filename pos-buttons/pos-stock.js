// Adjust stock (Items + -> Adjust stock; "Quick stock" until 2026-10-27, the code keeps qs*): tap items on the list, type the amounts, Save. On a tablet the page sits beside
// the list (or full screen, from the title's menu); on the phone it's its own page behind Review. Ported from the
// quick-stock lab, flow C (owner 2026-10-13). Saves real movements (makeMovement -> applyMovement -> appendMovements),
// one batch per Save, so the back office's history shows them.
// The page is the item editor's (owner 2026-10-13): ‹ / title / Save on top, Settings blocks under it, one block per
// item with its name above, the device's own keyboard (no keypad of ours), − / + for small changes.
// ponytail: it borrows .lv .editor / .card.fc / .fr from styles.css instead of new card styles.
// Adjust price (Items + -> Adjust price, owner 2026-10-17; "Change price" until 2026-10-27): the same page and flow, the number is the new price. Its Save
// writes the products' price (no movement); Undo puts the old prices back.

const QS_KEY = 'hwpos.quickStock';
// mode -> [title, sign, movement reason]; count has no sign: it saves counted - expected
const QS_REASONS = {
  add: ['Add stock', 1, 'adjustment'],
  remove: ['Remove stock', -1, 'adjustment'],
  damaged: ['Damaged', -1, 'damage'],
  count: ['Count stock', 0, 'count'],
  price: ['Adjust price', 0, ''],   // not a stock reason: qsPrice() branches
};

// full: on a tablet, one page over the list (the phone's way) instead of docked beside it
let QS = { on: false, reason: 'add', lines: [], full: false, stock: 'add' };   // stock: the last stock mode, for Quick stock after Change price
let qsMode = '', qsSaved = null;   // qsMode: '' (the Items list) | 'dock' | 'page'

const qsKeep = () => writeJsonStorage(QS_KEY, { on: QS.on, reason: QS.reason, lines: QS.lines, full: QS.full, stock: QS.stock });
const qsProd = id => state.products.find(p => p.id === id);
const qsLine = id => QS.lines.find(l => l.id === id);
const qsQty = n => SalesMath.qtyText(n);
const qsPrice = () => QS.reason === 'price';
const qsDec = p => qsPrice() || p.soldBy === 'measure';
const qsMoney = v => (v == null || v === '' ? 'Asked at sale' : peso(v));
// a line is saved once it has a number; 0 only counts for a count (0 on the shelf is a real count)
const qsLive = () => QS.lines.filter(l => !isNaN(parseFloat(l.n)) && (QS.reason === 'count' || (qsPrice() ? Number(l.n) !== qsProd(l.id)?.price : Number(l.n) > 0)) && qsProd(l.id));   // a price typed the same is no change
const qsAfter = (p, n) => (QS.reason === 'count' ? n : (Number(p.stock) || 0) + QS_REASONS[QS.reason][1] * n);
const qsFamily = p => (p.groupId && groupById(p.groupId)) || null;
const qsVarName = p => { const g = qsFamily(p); return g && p.name.startsWith(g.name) ? p.name.slice(g.name.length).trim() || p.name : p.name; };
const qsOnHand = p => Math.max(0, Number(p.stock) || 0);

// ---------- adding lines ----------
// every variant of an item, amounts blank; returns the first one's id
function qsAddFamily(itemId) {
  const it = catalogItems().find(x => x.id === itemId);
  if (!it) return '';
  const ps = it.members.filter(p => qsPrice() || (p.trackStock !== false && !p.madeFrom?.length));   // a made item's stock is its parts'
  if (!ps.length) { showToast(it.members.some(p => p.madeFrom?.length) ? `Count what ${it.name} is made from` : `${it.name} doesn't track stock`); return ''; }
  ps.forEach(p => { if (!qsLine(p.id)) QS.lines.push({ id: p.id, n: '' }); });
  return ps[0].id;
}
// Remove and Damaged can't take more than is on the shelf
function qsCap(p, n) {
  if (QS.reason !== 'remove' && QS.reason !== 'damaged') return n;
  if (n > qsOnHand(p)) { showToast(`Only ${qsQty(qsOnHand(p))} on hand`); return qsOnHand(p); }
  return n;
}

// ---------- drawing ----------
const QS_IC = {
  back: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  updown: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>',
};
function qsBuild() {
  // inside #app: the PIN lock's inert covers it (pinCover)
  $('#app').insertAdjacentHTML('beforeend', `<section class="lv qs-pg" id="qs" aria-label="Adjust stock" hidden><div class="iv editing">
      <section class="editor"><div class="e-top">
        <button class="sq back" id="qsBack" aria-label="Back">${QS_IC.back}</button>
        <h2 class="fm-h"><button type="button" class="qs-mode" id="qsReason" aria-haspopup="menu" aria-expanded="false"><span></span>${QS_IC.updown}</button></h2>
        <div class="acts"><button class="act primary" id="qsSave" disabled>Save</button></div>
      </div>
      <div class="form-scroll"><div class="form" id="qsForm">
        <div class="qs-list" id="qsList"></div>
      </div></div></section>
    </div></section>
    <div class="qs-tickbar" id="qsTickbar" hidden><button type="button" class="qs-next" id="qsTickNext" disabled></button></div>`);
}

function qsRender() {
  qsKeep();
  document.body.classList.toggle('qs-on', QS.on);
  document.body.classList.toggle('qs-price', QS.on && qsPrice());
  const menu = $('.view-items .head [data-act="open-sidebar"]');   // picking: the ☰ is ✕ (app.js), the one way out
  menu.title = menu.ariaLabel = QS.on ? (qsPrice() ? 'Close change price' : 'Close quick stock') : addPick ? 'Close' : 'Menu';   // and Add tile's (pos-sell.js)
  const pg = $('#qs');
  pg.hidden = !QS.on || !qsMode;
  pg.classList.toggle('dock', qsMode === 'dock');
  pg.classList.toggle('price', qsPrice());
  qsTickbar();
  if (!QS.on) return;
  if (qsSaved) return qsRenderSaved();
  $('#qsReason').disabled = qsPrice() && innerWidth <= 720;   // a price has no other mode; the tablet keeps the layout pick
  $('#qsReason span').textContent = QS_REASONS[QS.reason][0];
  $('#qsSave').textContent = 'Save';
  qsSaveState();
  const sc = $('#qsForm').closest('.form-scroll'), y = sc.scrollTop;
  $('#qsList').innerHTML = qsRows() || qsEmpty();
  sc.scrollTop = y;
}
const qsEmpty = () => '<p class="qs-empty">Tap the items on the left to add them.</p>';   // ponytail: the dock's words; the phone shows its Review bar
const qsSaveState = () => { $('#qsSave').disabled = !qsLive().length; };

// blocks in the order tapped: a family is one block, where its first variant was tapped, with its name above (Settings'
// section title), a row per variant; plain items (no variants) tapped one after another share an untitled block. Owner 2026-10-13: tap order wins -- a block per
// plain item was noisy, and plain items gathered at the top lost the order.
function qsRows() {
  const fams = [];
  QS.lines.forEach(l => {
    const p = qsProd(l.id);
    if (!p) return;
    const g = qsFamily(p), last = fams[fams.length - 1], f = g ? fams.find(x => x.id === g.id) : last && !last.id && last;
    if (f) f.ls.push([l, p]);
    else fams.push({ id: g ? g.id : '', name: g ? g.name : '', ls: [[l, p]] });
  });
  return fams.map(f => icard(f.name ? escapeHtml(f.name) : '', f.ls.map(([l, p]) => `<div class="fr wide qs-ln" data-qs="${escapeHtml(l.id)}">
      <span class="lb"><span class="qs-nm">${escapeHtml(f.name ? qsVarName(p) : p.name)}</span><small class="num" data-qs-sub>${qsSub(l, p)}</small></span>
      <span class="ctl end"><button type="button" class="qs-pm" data-qs-m aria-label="One less">−</button>
        <input class="in num qs-amt" data-qs-n value="${escapeHtml(String(l.n))}" type="text" inputmode="${qsDec(p) ? 'decimal' : 'numeric'}" enterkeyhint="next" placeholder="${qsPrice() && !askedPrice(p) ? escapeHtml(String(p.price)) : 0}" autocomplete="off" aria-label="Amount">
        <button type="button" class="qs-pm" data-qs-p aria-label="One more">+</button></span></div>`).join(''))).join('');
}
function qsSub(l, p) {
  if (qsPrice()) return !isNaN(parseFloat(l.n)) ? `${qsMoney(p.price)} → ${peso(Number(l.n))}` : qsMoney(p.price);
  const has = l.n !== '', n = Number(l.n) || 0, was = Number(p.stock) || 0, unit = escapeHtml(p.unit || 'pc');
  if (QS.reason === 'count') {
    const d = n - was;
    return `Expected ${qsQty(was)} ${unit}${has ? ` · ${d ? (d > 0 ? '+' : '−') + qsQty(Math.abs(d)) : 'matches'}` : ''}`;
  }
  return has && n ? `${qsQty(was)} → ${qsQty(qsAfter(p, n))} ${unit}` : `${qsQty(was)} ${unit} on hand`;
}
// a typed amount or a − / +: only that row's words and Save change, so the keyboard stays up
function qsSet(row, s) {
  const l = qsLine(row.dataset.qs), p = l && qsProd(l.id);
  if (!p) return;
  if (qsPrice()) s = /^\d{0,7}(\.\d{0,2})?$/.test(s = String(s).trim()) ? s : l.n;   // a price: up to 9,999,999.99; a typo keeps the last good price
  else s = String(s).replace(qsDec(p) ? /[^0-9.]/g : /[^0-9]/g, '').replace(/(\..*)\./g, '$1').slice(0, 7);
  if (s !== '' && !s.endsWith('.')) { const n = Number(s), c = qsCap(p, n); if (c !== n) s = String(c); }
  l.n = s;
  const inp = row.querySelector('[data-qs-n]');
  if (inp.value !== s) inp.value = s;
  row.querySelector('[data-qs-sub]').innerHTML = qsSub(l, p);
  qsSaveState();
  qsKeep();
}
function qsShow(id) {
  requestAnimationFrame(() => document.querySelector(`.qs-ln[data-qs="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

function qsRenderSaved() {
  const { done, undone } = qsSaved;
  $('#qsReason span').textContent = undone ? 'Undone' : 'Saved';
  $('#qsReason').disabled = true;
  $('#qsSave').textContent = 'Done';
  $('#qsSave').disabled = false;
  // the new value on the right; under the name, a price shows what it was and stock what moved, "+50 from 120"
  // (owner 2026-10-27: old → new on the right crowded the edge, worst in big currencies)
  const sub = d => {
    if (d.reason === 'price') return `was ${qsMoney(d.was)}`;
    const x = d.now - d.was;
    return x ? `${x > 0 ? '+' : '−'}${qsQty(Math.abs(x))} from ${qsQty(d.was)}` : 'matches';
  };
  $('#qsList').innerHTML = icard(`${QS_REASONS[done[0].reason][0]} · ${SalesMath.plural(done.length, 'item')}`, done.map(d => `<div class="fr wide qs-ln">
      <span class="lb"><span class="qs-nm">${escapeHtml(d.name)}</span>${undone ? '' : `<small class="num">${sub(d)}</small>`}</span>
      <span class="ctl end"><span class="qs-to num"><b>${qsShow2(d.now)}</b></span></span></div>`).join(''))
    + (undone ? '' : icard('', '<button type="button" class="fr add" id="qsUndo">Undo</button>'));
}

const qsShow2 = v => (qsPrice() ? qsMoney(v) : qsQty(v));

// the bar under the list on the phone, where the page is its own (N lines · Review)
function qsTickbar() {
  const bar = $('#qsTickbar');
  if (!bar) return;
  bar.hidden = !QS.on || !!qsMode;
  if (bar.hidden) return;
  const n = QS.lines.length;
  $('#qsTickNext').disabled = !n;
  $('#qsTickNext').innerHTML = n ? `<span>${SalesMath.plural(n, 'line')}</span><span>Review</span>` : `<span>Tap the items to ${qsPrice() ? 'price' : 'stock'}</span>`;
}
// the Items list rows: a dot when the item is in the list
function qsMarkRows() {
  if (!QS.on || itemsKind !== 'items') return;
  const inList = new Set(QS.lines.map(l => { const p = qsProd(l.id); return p && (qsFamily(p)?.id || p.id); }));
  $$('#itemsRows .row[data-id]').forEach(r => {
    r.classList.add('qs-tick');
    r.classList.toggle('qs-in', inList.has(r.dataset.id));
  });
}

// ---------- the mode (the title) ----------
function qsPickReason(r) {
  if (r === QS.reason) return;
  const go = () => {
    if ((r === 'count') !== (QS.reason === 'count')) QS.lines.forEach(l => { l.n = ''; });   // a count's number means something else
    QS.reason = r;
    if (r === 'remove' || r === 'damaged') QS.lines.forEach(l => { const p = qsProd(l.id); if (p && l.n !== '' && Number(l.n) > qsOnHand(p)) l.n = String(qsOnHand(p)); });
    qsRender();
  };
  const typed = QS.lines.some(l => l.n !== '');
  if (typed && ((r === 'count') !== (QS.reason === 'count'))) {
    showConfirm({ title: `Switch to ${QS_REASONS[r][0]}?`, message: 'The amounts you typed are cleared.', okText: 'Switch', onConfirm: go });
  } else go();
}

// ---------- save + undo ----------
function qsSave() {
  const live = qsLive();
  if (!live.length) return;
  if (qsPrice()) return qsSavePrices(live);
  const [, sign, reason] = QS_REASONS[QS.reason], batch = newId(), who = currentStoreInfo().cashier, staffId = state.user?.id || '';
  const rows = [], done = [];
  live.forEach(l => {
    const p = qsProd(l.id), was = Number(p.stock) || 0, n = Number(l.n) || 0;
    const qty = QS.reason === 'count' ? n - was : sign * n;
    const mv = makeMovement({ productId: p.id, qty, reason, refId: batch, note: 'Adjust stock', unitCost: p.cost, staff: who, staffId,
      ...(QS.reason === 'count' && { expected: was, counted: n }) });
    applyMovement(p, mv);
    rows.push(mv);
    done.push({ id: p.id, name: p.name, was, now: p.stock, delta: mv.qty, reason: QS.reason });
  });
  appendMovements(rows);
  qsDone(done, rows, batch);
}
// Change price: the new prices onto the products, the old ones kept for Undo
// saveProducts -> saveCatalog logs each change in priceLog (bo-model.js)
function qsSavePrices(live) {
  const at = new Date().toISOString();
  const done = live.map(l => {
    const p = qsProd(l.id), was = askedPrice(p) ? null : p.price;
    Object.assign(p, { price: round2(Number(l.n)), updatedAt: at });
    return { id: p.id, name: p.name, was, now: p.price, reason: 'price' };
  });
  qsDone(done, []);
}
function qsDone(done, rows, batch = '') {
  saveProducts();
  qsSaved = { rows, done, batch };
  QS.lines = [];
  if (qsMode !== 'dock') qsMode = 'page';
  qsRefresh();
  qsRender();
}
// reversing rows, never an edit: the log keeps both
function qsUndo() {
  if (qsPrice()) return qsUndoPrices();
  const { rows, done, batch } = qsSaved, who = currentStoreInfo().cashier, staffId = state.user?.id || '';
  const back = rows.map(r => {
    const p = qsProd(r.productId);
    if (!p) return null;
    const mv = makeMovement({ productId: p.id, qty: -r.qty, reason: 'adjustment', refId: batch, note: 'Undo quick stock', unitCost: p.cost, staff: who, staffId });
    applyMovement(p, mv);
    const d = done.find(x => x.id === p.id);
    if (d) d.now = p.stock;
    return mv;
  }).filter(Boolean);
  appendMovements(back);
  saveProducts();
  qsUndone();
}
function qsUndoPrices() {
  const at = new Date().toISOString();
  qsSaved.done.forEach(d => { const p = qsProd(d.id); if (p) { Object.assign(p, { price: d.was, updatedAt: at }); d.now = d.was; } });
  saveProducts();
  qsUndone();
}
function qsUndone() {
  qsSaved.undone = true;
  qsRefresh();
  qsRender();
  showDone('Undone');
}
// the Sell tiles show the price; the open cart takes the new one too (owner 2026-10-17: change it and everything
// changes -- finished sales keep theirs, priceLog keeps the old). In place: discount undo holds the line objects.
function qsRefresh() {
  if (state.view === 'items') renderItems();
  renderProducts();
  if (!state.cart.length) return;
  const { lines } = todayLines(state.cart);
  state.cart.forEach(i => { i.price = lines.find(l => l.id === i.id)?.price ?? i.price; });
  renderCart();
}

// ---------- start, leave ----------
const qsListMode = () => (innerWidth > 720 && !QS.full ? 'dock' : '');
// reason: 'price' for Change price; Quick stock keeps its last stock mode
function qsStart(reason) {
  if (reason === 'price' && !qsPrice()) QS.stock = QS.reason;
  if (reason) QS.reason = reason; else if (qsPrice()) QS.reason = QS.stock || 'add';
  QS.on = true; qsSaved = null;
  switchView('items');
  if (itemsKind !== 'items') setItemsKind('items');
  $('#itemsView').classList.remove('editing');
  qsMode = qsListMode();
  qsRender();
  renderItems();
}
function qsLeave() {
  QS.on = false; qsMode = ''; qsSaved = null; QS.lines = [];
  qsRender();
  if (state.view !== 'items') switchView('items'); else renderItems();
}
function qsAskLeave() {
  const n = qsLive().length;
  if (!n || qsSaved) return qsLeave();
  showConfirm({ title: 'Leave without saving?', message: `${SalesMath.plural(n, qsPrice() ? 'price' : 'amount')} not saved yet.`, okText: 'Leave', cancelText: 'Keep editing', onConfirm: qsLeave });   // askLeave's words
}
// ‹: the page goes back to the list (the amounts stay); after a save it leaves (the dock has no ‹: the list's × closes)
function qsBack() {
  if (qsMode === 'page' && !qsSaved) { qsMode = qsListMode(); qsRender(); renderItems(); return; }
  qsAskLeave();
}
function qsToggleFull() {
  QS.full = qsMode === 'dock'; qsMode = QS.full ? 'page' : 'dock';
  qsRender(); renderItems();
}
// Done after a save: carry on with the list
function qsDoneSaved() {
  qsSaved = null; qsMode = qsListMode();
  qsRender(); renderItems();
}

// the item editor's Adjust: quick stock with this item on the list, its amounts open
function qsAdjust(itemId) {
  if (!QS.on) qsStart();
  const first = qsAddFamily(itemId);
  if (!qsMode) qsMode = 'page';
  qsRender(); renderItems();
  if (first) qsShow(first);
}

// ---------- wiring ----------
// a row tapped on the Items list while quick stock is on (app.js): the item's variants join the list; tapped again
// (the ticked dot), they leave it -- asking first if an amount was typed
function qsPickRow(itemId) {
  const ids = new Set((catalogItems().find(x => x.id === itemId)?.members || []).map(p => p.id)), mine = QS.lines.filter(l => ids.has(l.id));
  if (mine.length) {
    const drop = () => { QS.lines = QS.lines.filter(l => !ids.has(l.id)); qsRender(); qsMarkRows(); };
    if (!mine.some(l => l.n !== '')) return drop();
    return showConfirm({ title: 'Take it off the list?', message: 'The amount you typed is cleared.', okText: 'Take off', onConfirm: drop });
  }
  qsSaved = null;   // a new item after a save: the saved summary gives way to the list
  const first = qsAddFamily(itemId);
  qsRender(); qsMarkRows();
  if (first && qsMode === 'dock') qsShow(first);
}

// app.js init calls this once; a draft survives the app closing
function initQuickStock() {
  QS = Object.assign(QS, readJsonStorage(QS_KEY, {}));
  qsBuild();
  qsWire();
  if (QS.on) qsStart(QS.reason); else qsRender();   // the draft's own mode: a price draft must not come back as stock
}
function qsWire() {
  $('#qsTickNext').addEventListener('click', () => { qsMode = 'page'; qsRender(); });

  $('#qsBack').addEventListener('click', qsBack);
  // the title's menu: the mode, and on a tablet the page's place (beside the list or full screen); the phone gets
  // the cart ⋯'s half sheet (owner 2026-10-27)
  $('#qsReason').addEventListener('click', e => {
    const modes = Object.keys(QS_REASONS).filter(r => (r === 'price') === qsPrice()).map(r => ({ label: QS_REASONS[r][0], cur: r === QS.reason, run: () => qsPickReason(r) }));
    if (innerWidth <= 720) return openActionSheet(e.currentTarget, 'Adjust stock', modes);
    openMenu(e.currentTarget, [...modes, '-', { label: qsMode === 'dock' ? 'Full screen' : 'Beside the list', run: qsToggleFull }], { w: 200 });
  });
  $('#qsSave').addEventListener('click', () => (qsSaved ? qsDoneSaved() : qsSave()));

  const list = $('#qsList');
  list.addEventListener('click', e => {
    if (e.target.closest('#qsUndo')) return qsUndo();
    const row = e.target.closest('.qs-ln[data-qs]'), l = row && qsLine(row.dataset.qs);
    if (!l) return;
    const from = isNaN(parseFloat(l.n)) && qsPrice() && !askedPrice(qsProd(l.id)) ? qsProd(l.id).price : Number(l.n) || 0;   // a price steps from the one it has
    const step = d => qsSet(row, Math.max(0, Math.round((Number(from) + d) * 1000) / 1000));
    if (e.target.closest('[data-qs-p]')) step(1);
    else if (e.target.closest('[data-qs-m]')) step(-1);
  });
  list.addEventListener('input', e => { const row = e.target.closest('.qs-ln[data-qs]'); if (row && e.target.matches('[data-qs-n]')) qsSet(row, e.target.value); });
  // the keyboard's Next / Enter: the next amount down
  list.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('[data-qs-n]')) return;
    e.preventDefault();
    const all = $$('#qsList [data-qs-n]'), nx = all[all.indexOf(e.target) + 1];
    if (nx) nx.focus(); else e.target.blur();
  });
  list.addEventListener('focusin', e => { if (e.target.matches('[data-qs-n]')) e.target.select(); });

  addEventListener('resize', () => { const m = qsListMode(); if (QS.on && qsMode !== 'page' && m !== qsMode) { qsMode = m; qsRender(); } });
}
