// Quick stock lab (quick-stock.html): the real POS lab app plus one stock page, reached two ways so the owner can
// try each flow. Lab only -- index.html never loads this. Saves real movements (makeMovement -> applyMovement ->
// appendMovements), one batch per Save, so the back office's history shows them.
// The page is the item editor's (owner 2026-10-13): ‹ / title / Save on top, Settings blocks under it, one block per
// item with its name above, the device's own keyboard (no keypad of ours), − / + for small changes.
// ponytail: it borrows .lv .editor / .card.fc / .fr from styles.css instead of new card styles.

const QS_KEY = 'hwpos.quickStock';
const QS_FLOWS = {
  b: 'B · Tick, then fill',
  c: 'C · One screen',
};
// mode -> [title, sign, movement reason]; count has no sign: it saves counted - expected
const QS_REASONS = {
  add: ['Add stock', 1, 'adjustment'],
  remove: ['Remove stock', -1, 'adjustment'],
  damaged: ['Damaged', -1, 'damage'],
  count: ['Count stock', 0, 'count'],
};

// full: C on a tablet as one page over the list (the phone's way) instead of docked beside it
const QS = Object.assign({ flow: 'c', on: false, reason: 'add', lines: [], full: false }, readJsonStorage(QS_KEY, {}));
if (!QS_FLOWS[QS.flow]) QS.flow = 'c';   // A, D and E are gone (owner 2026-10-13)
let qsMode = '', qsSaved = null;   // qsMode: '' (the Items list) | 'dock' | 'page'

const qsKeep = () => writeJsonStorage(QS_KEY, { flow: QS.flow, on: QS.on, reason: QS.reason, lines: QS.lines, full: QS.full });
const qsProd = id => state.products.find(p => p.id === id);
const qsLine = id => QS.lines.find(l => l.id === id);
const qsQty = n => SalesMath.qtyText(n);
const qsDec = p => p.soldBy === 'measure';
// a line is saved once it has a number; 0 only counts for a count (0 on the shelf is a real count)
const qsLive = () => QS.lines.filter(l => l.n !== '' && (QS.reason === 'count' || Number(l.n) > 0) && qsProd(l.id));
const qsAfter = (p, n) => (QS.reason === 'count' ? n : (Number(p.stock) || 0) + QS_REASONS[QS.reason][1] * n);
const qsFamily = p => (p.groupId && groupById(p.groupId)) || null;
const qsVarName = p => { const g = qsFamily(p); return g && p.name.startsWith(g.name) ? p.name.slice(g.name.length).trim() || p.name : p.name; };
const qsOnHand = p => Math.max(0, Number(p.stock) || 0);

// ---------- adding lines ----------
function qsAdd(id) {
  const p = qsProd(id);
  if (!p) return;
  if (p.trackStock === false) { showToast(`${p.name} doesn't track stock`); return; }
  const l = qsLine(id);
  if (l) l.n = String(qsCap(p, (Number(l.n) || 0) + 1));   // the same item again (a second scan) = one more
  else QS.lines.push({ id, n: QS.reason === 'count' ? '' : '1' });
  qsRender();
  qsShow(id);
}
// every variant of an item, amounts blank (B and C); returns the first one's id
function qsAddFamily(itemId) {
  const it = catalogItems().find(x => x.id === itemId);
  if (!it) return '';
  const ps = it.members.filter(p => p.trackStock !== false);
  if (!ps.length) { showToast(`${it.name} doesn't track stock`); return ''; }
  ps.forEach(p => { if (!qsLine(p.id)) QS.lines.push({ id: p.id, n: '' }); });
  return ps[0].id;
}
const qsDropFamily = itemId => {
  const ids = new Set((catalogItems().find(x => x.id === itemId)?.members || []).map(p => p.id));
  QS.lines = QS.lines.filter(l => !ids.has(l.id));
};
// Remove and Damaged can't take more than is on the shelf
function qsCap(p, n) {
  if (QS.reason !== 'remove' && QS.reason !== 'damaged') return n;
  if (n > qsOnHand(p)) { showToast(`Only ${qsQty(qsOnHand(p))} on hand`); return qsOnHand(p); }
  return n;
}

// ---------- drawing ----------
const QS_IC = {
  back: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  x: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  updown: '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>',
};
function qsBuild() {
  document.body.insertAdjacentHTML('beforeend', `<section class="lv qs-pg" id="qs" aria-label="Quick stock" hidden><div class="iv editing">
      <section class="editor"><div class="e-top">
        <button class="sq back" id="qsBack" aria-label="Back">${QS_IC.back}</button>
        <h2 class="fm-h"><button type="button" class="qs-mode" id="qsReason" aria-haspopup="menu" aria-expanded="false"><span></span>${QS_IC.updown}</button></h2>
        <div class="acts"><button class="act primary" id="qsSave" disabled>Save</button></div>
      </div>
      <div class="form-scroll"><div class="form" id="qsForm">
        <div class="qs-list" id="qsList"></div>
      </div></div></section>
    </div></section>
    <button type="button" class="qs-flow" id="qsFlow" aria-haspopup="menu" aria-expanded="false"></button>
    <div class="qs-tickbar" id="qsTickbar" hidden>
      <button type="button" class="qs-all" id="qsTickAll" hidden>Tick all</button><button type="button" class="qs-next" id="qsTickNext" disabled></button></div>`);
  // picking: the list's ☰ becomes × (close quick stock), the one way out
  document.querySelector('.view-items .head [data-act="open-sidebar"]').insertAdjacentHTML('afterend',
    `<button type="button" class="sq qs-close" id="qsListX" aria-label="Close quick stock" title="Close quick stock">${QS_IC.x}</button>`);
}

function qsRender() {
  qsKeep();
  $('#qsFlow').textContent = `Flow ${QS_FLOWS[QS.flow]} ▾`;
  document.body.classList.toggle('qs-on', QS.on);
  ['b', 'c'].forEach(f => document.body.classList.toggle('qs-' + f, QS.on && QS.flow === f));
  const pg = $('#qs');
  pg.hidden = !QS.on || !qsMode;
  pg.classList.toggle('dock', qsMode === 'dock');
  qsTickbar();
  if (!QS.on) return;
  if (qsSaved) return qsRenderSaved();
  $('#qsReason').disabled = false;
  $('#qsReason span').textContent = QS_REASONS[QS.reason][0];
  $('#qsSave').textContent = 'Save';
  qsSaveState();
  const sc = $('#qsForm').closest('.form-scroll'), y = sc.scrollTop;
  $('#qsList').innerHTML = qsRows() || qsEmpty();
  sc.scrollTop = y;
}
const qsEmpty = () => '<p class="qs-empty">Tap the items on the left to add them.</p>';
const qsSaveState = () => { $('#qsSave').disabled = !qsLive().length; };

// one block per item: its name above (Settings' section title), a row per variant; a plain item is one row, and plain
// items next to each other share a block
function qsRows() {
  const fams = [];
  QS.lines.forEach(l => {
    const p = qsProd(l.id);
    if (!p) return;
    const g = qsFamily(p), last = fams[fams.length - 1];
    if (last && (g ? last.id === g.id : !last.id)) last.ls.push([l, p]);
    else fams.push({ id: g ? g.id : '', name: g ? g.name : '', ls: [[l, p]] });
  });
  return fams.map(f => icard(f.name ? escapeHtml(f.name) : '', f.ls.map(([l, p]) => `<div class="fr wide qs-ln" data-qs="${escapeHtml(l.id)}">
      <span class="lb"><span class="qs-nm">${escapeHtml(f.name ? qsVarName(p) : p.name)}</span><small class="num" data-qs-sub>${qsSub(l, p)}</small></span>
      <span class="ctl end"><button type="button" class="qs-pm" data-qs-m aria-label="One less">−</button>
        <input class="in num qs-amt" data-qs-n value="${escapeHtml(String(l.n))}" type="text" inputmode="${qsDec(p) ? 'decimal' : 'numeric'}" enterkeyhint="next" placeholder="0" autocomplete="off" aria-label="Amount">
        <button type="button" class="qs-pm" data-qs-p aria-label="One more">+</button></span></div>`).join(''))).join('');
}
function qsSub(l, p) {
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
  s = String(s).replace(qsDec(p) ? /[^0-9.]/g : /[^0-9]/g, '').replace(/(\..*)\./g, '$1').slice(0, 7);
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
  $('#qsList').innerHTML = icard(`${QS_REASONS[done[0].reason][0]} · ${SalesMath.plural(done.length, 'item')}`, done.map(d => `<div class="fr wide qs-ln">
      <span class="lb"><span class="qs-nm">${escapeHtml(d.name)}</span>${d.reason === 'count' ? `<small class="num">${d.delta ? (d.delta > 0 ? '+' : '−') + qsQty(Math.abs(d.delta)) : 'matches'}</small>` : ''}</span>
      <span class="ctl end"><span class="qs-to num">${undone ? qsQty(d.now) : `${qsQty(d.was)} → <b>${qsQty(d.now)}</b>`}</span></span></div>`).join(''))
    + (undone ? '' : icard('', '<button type="button" class="fr add" id="qsUndo">Undo</button>'));
}

// B's bar under the list (N picked · Next); C's on the phone, where the panel is its own page (N lines · Review)
function qsTickbar() {
  const b = QS.flow === 'b' && !qsMode, c = QS.flow === 'c' && !qsMode;
  $('#qsTickbar').hidden = !(QS.on && (b || c));
  if (!QS.on || !(b || c)) return;
  const n = b ? new Set(QS.lines.map(l => { const p = qsProd(l.id); return p && (p.groupId || p.id); })).size : QS.lines.length;
  $('#qsTickNext').disabled = !n;
  $('#qsTickNext').innerHTML = !n ? `<span>${b ? 'Tick the items to stock' : 'Tap the items to stock'}</span>`
    : b ? `<span>${n} picked</span><span>Next</span>` : `<span>${SalesMath.plural(n, 'line')}</span><span>Review</span>`;
  $('#qsTickAll').hidden = !b || !(itemsFilter.q.trim() || itemsFilter.cat || itemsFilter.stock);   // only a narrowed list can be ticked whole
}
// the Items list rows: ticked (B) or in the list (C)
function qsMarkRows() {
  if (!QS.on || !(QS.flow === 'b' || QS.flow === 'c') || itemsKind !== 'items') return;
  const inList = new Set(QS.lines.map(l => { const p = qsProd(l.id); return p && (p.groupId || p.id); }));
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
  const [, sign, reason] = QS_REASONS[QS.reason], batch = newId(), who = currentStoreInfo().cashier, staffId = state.user?.id || '';
  const rows = [], done = [];
  live.forEach(l => {
    const p = qsProd(l.id), was = Number(p.stock) || 0, n = Number(l.n) || 0;
    const qty = QS.reason === 'count' ? n - was : sign * n;
    const mv = makeMovement({ productId: p.id, qty, reason, refId: batch, note: 'Quick stock', unitCost: p.cost, staff: who, staffId,
      ...(QS.reason === 'count' && { expected: was, counted: n }) });
    applyMovement(p, mv);
    rows.push(mv);
    done.push({ id: p.id, name: p.name, was, now: p.stock, delta: mv.qty, reason: QS.reason });
  });
  appendMovements(rows);
  saveProducts();
  qsSaved = { rows, done, batch };
  QS.lines = [];
  if (qsMode !== 'dock') qsMode = 'page';
  qsRefresh();
  qsRender();
}
// reversing rows, never an edit: the log keeps both
function qsUndo() {
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
  qsSaved.undone = true;
  qsRefresh();
  qsRender();
  showToast('Undone');
}
const qsRefresh = () => { if (state.view === 'items') renderItems(); };

// ---------- start, leave ----------
const qsListMode = () => (QS.flow === 'c' && innerWidth > 720 && !QS.full ? 'dock' : '');
function qsStart(flow) {
  QS.flow = flow; QS.on = true; qsSaved = null;
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
  showConfirm({ title: 'Leave quick stock?', message: `${SalesMath.plural(n, 'amount')} not saved yet.`, okText: 'Leave', cancelText: 'Keep going', onConfirm: qsLeave });
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
// Done after a save: C carries on beside its list; the rest are finished
function qsDoneSaved() {
  if (QS.flow !== 'c') return qsLeave();
  qsSaved = null; qsMode = qsListMode();
  qsRender(); renderItems();
}

// ---------- wiring ----------
function qsWire() {
  const listDraw = renderItems;
  renderItems = function () { listDraw.apply(this, arguments); qsMarkRows(); qsTickbar(); };   // eslint-disable-line no-global-assign

  // Items +: Add item / Quick stock
  $('#itemsAdd').addEventListener('click', e => {
    if (itemsKind !== 'items') return;
    e.stopImmediatePropagation();
    openMenu(e.currentTarget, [
      { label: 'Add item', run: () => openItemEditor(null) },
      { label: 'Quick stock', run: () => qsStart(QS.flow) },
    ], { w: 180, right: true });
  }, true);
  $('#qsFlow').addEventListener('click', e => openMenu(e.currentTarget, Object.entries(QS_FLOWS).map(([k, label]) => ({
    label, cur: k === QS.flow, run: () => { if (k !== QS.flow) QS.lines = []; qsStart(k); },
  })), { w: 220 }));

  // the Items list: B ticks a whole item, C adds it beside the list
  $('#itemsRows').addEventListener('click', e => {
    const row = e.target.closest('.row[data-id]');
    if (!row || !QS.on || !(QS.flow === 'b' || QS.flow === 'c') || itemsKind !== 'items') return;
    e.stopImmediatePropagation();
    const id = row.dataset.id, first = QS.flow === 'b' && row.classList.contains('qs-in') ? qsDropFamily(id) : qsAddFamily(id);
    qsRender(); qsMarkRows();
    if (first && qsMode === 'dock') qsShow(first);
  }, true);
  $('#qsTickNext').addEventListener('click', () => { qsMode = 'page'; qsRender(); });
  $('#qsListX').addEventListener('click', qsAskLeave);
  $('#qsTickAll').addEventListener('click', () => { $$('#itemsRows .row[data-id]:not(.qs-in)').forEach(r => r.click()); });

  $('#qsBack').addEventListener('click', qsBack);
  // the title's menu: the mode, and on a tablet C's place (beside the list or full screen)
  $('#qsReason').addEventListener('click', e => openMenu(e.currentTarget, [
    ...Object.keys(QS_REASONS).map(r => ({ label: QS_REASONS[r][0], cur: r === QS.reason, run: () => qsPickReason(r) })),
    ...(QS.flow === 'c' && innerWidth > 720 ? ['-', { label: qsMode === 'dock' ? 'Full screen' : 'Beside the list', run: qsToggleFull }] : []),
  ], { w: 200 }));
  $('#qsSave').addEventListener('click', () => (qsSaved ? qsDoneSaved() : qsSave()));

  const list = $('#qsList');
  list.addEventListener('click', e => {
    if (e.target.closest('#qsUndo')) return qsUndo();
    const row = e.target.closest('.qs-ln[data-qs]'), l = row && qsLine(row.dataset.qs);
    if (!l) return;
    if (e.target.closest('[data-qs-p]')) qsSet(row, (Number(l.n) || 0) + 1);
    else if (e.target.closest('[data-qs-m]')) qsSet(row, Math.max(0, (Number(l.n) || 0) - 1));
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

  addEventListener('resize', () => { if (QS.on && QS.flow === 'c' && qsMode !== 'page') { qsMode = qsListMode(); qsRender(); } });
}

// after app.js init (DOMContentLoaded -> store ready -> init)
document.addEventListener('DOMContentLoaded', () => (window.HWPOS_STORE?.ready?.() || Promise.resolve()).then(() => setTimeout(() => {
  qsBuild();
  qsWire();
  if (QS.on) qsStart(QS.flow); else qsRender();   // a draft survives the app closing
})));
