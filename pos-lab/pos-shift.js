// Till › Shift: the till's cash from open to close. One shift per register (cashiers swap by PIN
// inside it); the cash is counted once, at close, blind. Rows are append-only in HWPOS_STORE 'shifts':
//   shift_open  { amount: start cash }
//   cash_move   { amount: + cash in / − cash out, note }
//   shift_close { amount: counted, counts: every count typed, note, summary: the figures at close (cash + reading) }
//   day_close   { amount: the day's net, day, summary: its reading, grandBefore, grandAfter, zNo } -- the Z, made by closeDays
// Every row: id, type, shiftId, register, staff, staffId, amount, note, ts, storeId, updatedAt.
// The open shift is derived: this register's last shift_open with no shift_close for it.
// Checkout asks for the start cash when no shift is open (needShift, from openPaymentModal).
// ponytail: an exchange that hands money back (or swaps even) and an Orders refund skip openPaymentModal, so they
// run with no shift; gate them too if the owner wants every drawer move inside a shift.

const STORAGE_SHIFTS = storeKey('shifts');
const shiftDraft = { amt: '', note: '', q: '', countFor: null, counts: [] };   // typed text survives a re-render; q = the head's search
// ponytail: the counts of a close in progress live in memory; a reload starts the blind count again.

const shiftRows = () => loadList(STORAGE_SHIFTS);
const shiftRegister = () => String(currentStoreInfo().registerNo);
const registerRows = (reg = shiftRegister()) => shiftRows().filter(r => String(r.register) === reg).sort((a, b) => a.ts - b.ts);

function addShiftRow(type, shiftId, amount, extra) {
  const id = newId(), list = shiftRows();
  const row = stampRow({
    id, type, shiftId: shiftId || id, register: shiftRegister(),
    staff: state.user?.name || currentStoreInfo().cashier || '', staffId: state.user?.id || '',
    amount: moneyValue(amount), note: '', ts: Date.now(), ...extra,
  });
  list.push(row);
  saveList(STORAGE_SHIFTS, list);
  return row;
}

// Every shift of this register, oldest first: { open, moves, close (null while open) }.
// ponytail: moves found by a scan per shift; index by shiftId if a register piles up thousands of rows.
function registerShifts(rows = registerRows()) {
  const closed = new Map(rows.filter(r => r.type === 'shift_close').map(r => [r.shiftId, r]));
  return rows.filter(r => r.type === 'shift_open')
    .map(open => ({ open, moves: rows.filter(r => r.type === 'cash_move' && r.shiftId === open.id), close: closed.get(open.id) || null }));
}
// The open shift, or the last closed one (last: true).
const shiftOf = (last = false) => registerShifts().filter(s => !!s.close === last).pop() || null;

// The drawer since open: start + cash sales − cash handed back + cash paid on account ± petty cash.
// Cash sales / back / on account are drawerCash's (pos-settings.js), the same sum the day count reads.
function shiftFigures(s, to = Infinity) {
  const d = drawerCash(s.open.ts, to);
  const sum = sign => unc(s.moves.reduce((n, m) => n + (Math.sign(m.amount) === sign ? cent(Math.abs(m.amount)) : 0), 0));
  const f = { start: moneyValue(s.open.amount), sales: d.sales, back: d.back, onAccount: d.onAccount, cashIn: sum(1), cashOut: sum(-1) };
  f.expected = unc(cent(f.start) + cent(f.sales) - cent(f.back) + cent(f.onAccount) + cent(f.cashIn) - cent(f.cashOut));
  return f;
}
const shiftDiff = (counted, expected) => unc(cent(counted) - cent(expected));
const overShortText = diff => (diff ? (diff > 0 ? '+' : '') + peso(diff) : 'Even');

// The X / Z reading of some order rows (BIR RMO 24-2023 Annex D-1 / D-2), pesos, net of voids and refunds:
// net = gross − SC − PWD − other discounts − refunds − voids − VAT adjustment. An SC/PWD sale's discount is its 20%
// (scPwdOff) plus the VAT it drops (the rest of subtotal − total); every other discount is "other".
// ponytail: an SC/PWD sale with a cart discount on top reads that discount as VAT adjustment (the till doesn't stack them).
// ponytail: lives here while only the POS prints it; move into SalesMath when the back office reads it.
function readingOf(rows) {
  const t = SalesMath.summarize(rows), sc = rows.filter(o => SalesMath.sign(o) && cent(o.scPwdOff));
  const off = kind => unc(sc.filter(o => (o.scPwd?.kind === 'pwd') === (kind === 'pwd')).reduce((n, o) => n + SalesMath.sign(o) * cent(o.scPwdOff), 0));
  const scOff = SalesMath.summarize(sc).discounts, senior = off('senior'), pwd = off('pwd');
  const nos = rows.filter(o => SalesMath.sign(o) && o.number).sort((a, b) => SalesMath.tsOf(a) - SalesMath.tsOf(b)).map(o => o.number);
  return {
    gross: t.grossSales, senior, pwd, otherOff: unc(cent(t.discounts) - cent(scOff)), refunds: t.refunds, voids: t.voids,
    vatOff: unc(cent(scOff) - cent(senior) - cent(pwd)), net: t.netSales,
    vatable: unc(cent(t.salesBeforeTax) - cent(t.vatExempt)), vat: t.tax, exempt: t.vatExempt,
    byMethod: [...SalesMath.tenders(rows)], refundCount: t.refundCount, voidCount: t.voidCount,
    first: nos[0] || '', last: nos[nos.length - 1] || '',
  };
}
{ // the check: a senior sale (₱112 shelf, 20% off ₱100 ex-VAT, VAT dropped) and a GCash sale with ₱10 off
  const r = readingOf([
    { number: '1-001', ts: 1, subtotal: 112, total: 80, vatAmount: 0, vatExempt: 80, scPwdOff: 20, scPwd: { kind: 'senior' }, payments: [{ method: 'cash', amount: 80 }] },
    { number: '1-002', ts: 2, subtotal: 100, total: 90, vatAmount: 9.64, payments: [{ method: 'gcash', amount: 90 }] },
  ]);
  console.assert(r.gross === 212 && r.senior === 20 && r.pwd === 0 && r.vatOff === 12 && r.otherOff === 10 && r.net === 170
    && r.vatable === 80.36 && r.exempt === 80 && r.first === '1-001' && r.last === '1-002' && r.byMethod.length === 2, 'readingOf', r);
}

// The reading's lines on paper. A number prints as money.
// ponytail: no zero-rated sales on this POS (always 0); MIN / serial no. / PTU wait for BIR registration fields in Settings.
function readingRows(r) {
  const less = n => (n ? -n : 0);
  return [
    ['Beg. SI #', r.first || '-'], ['End. SI #', r.last || '-'], '-',
    ['Gross sales', r.gross], ['Less SC discount', less(r.senior)], ['Less PWD discount', less(r.pwd)],
    ['Less other discounts', less(r.otherOff)], ['Less refunds', less(r.refunds)], ['Less voids', less(r.voids)],
    ['Less VAT adjustment', less(r.vatOff)], ['Net sales', r.net, true], '-',
    ['VATable sales', r.vatable], ['VAT', r.vat], ['VAT-exempt sales', r.exempt], ['Zero-rated sales', 0], '-',
    ...(r.byMethod.length ? r.byMethod.map(([k, n]) => [SalesMath.tenderLabel(k), n]) : [['Payments', 0]]),
  ];
}

// A shift's paper (the X): open shift = the figures now (Print report), closed = the figures it closed on.
// Expected prints on a closed shift, or now only for a role that sees the day's totals (the count stays blind).
function xPaper(s) {
  const c = s.close, f = c ? c.summary : { ...shiftFigures(s), ...readingOf(drawerCash(s.open.ts).rows) }, when = ts => tillDate(ts, 'slip');
  const rows = [
    ['POS', s.open.register], ['Cashier', s.open.staff], ['Start', when(s.open.ts)], ['End', when(c ? c.ts : Date.now())],
    ...(c && c.staff !== s.open.staff ? [['Closed by', c.staff]] : []), '-',
    ...(f.gross !== undefined ? [...readingRows(f), '-'] : []),   // a shift closed before readings: cash only
    ['Start cash', f.start], ['Cash sales', f.sales], ['Cash refunds', f.back ? -f.back : 0],
    ...(f.onAccount ? [['Paid on account', f.onAccount]] : []), ['Cash in', f.cashIn], ['Cash out', f.cashOut ? -f.cashOut : 0],
    ...(c || roleCan(state.role, 'dayTotals') ? ['-', ['Expected', f.expected, true]] : []),
    ...(c ? [['Counted', c.amount, true], ['Over / short', shiftDiff(c.amount, f.expected), true],
      ...(c.counts?.length > 1 ? [['First count', c.counts[0]]] : []), ...(c.note ? [[`Note: ${c.note}`]] : [])] : []),
  ];
  // a move: its note wrapped on its own line(s) (notes run to 80 chars, paper is 32 / 48), then time + amount
  if (s.moves.length) rows.push('-', ...s.moves.flatMap(m => [[m.note], [tillDate(m.ts, 'time'), m.amount]]));
  return { store: currentStoreInfo(), title: 'X-READING', rows };
}

// A day's paper (the Z), from its day_close row.
const zPaper = d => ({ store: currentStoreInfo(), title: 'Z-READING', rows: [
  ['POS', d.register], ['Business day', tillDate(d.day, 'dayYear')], ['Made', tillDate(d.ts, 'slip')], ['Made by', d.staff],
  ['Z counter', String(d.zNo)], ['Reset counter', '0'], ['Beg. grand total', d.grandBefore], ['End. grand total', d.grandAfter], '-',
  ...readingRows(d.summary),
] });

// The Z, made on its own: every past business day of this register with a sale or a shift and no day_close yet
// gets one, oldest first. The grand total never resets: the last Z's + the day's net. Runs when the app loads,
// when a shift opens and when the Shift page draws, so a day closes itself the first time the POS wakes on a later one.
// ponytail: two tabs of one register opening on a new day at once could both write a Z; dedupe on sync.
function closeDays() {
  const rows = registerRows(), zone = tillZone(), today = tillDay(Date.now()), reg = shiftRegister();
  const zs = rows.filter(r => r.type === 'day_close');
  const lastZ = zs.reduce((m, r) => (!m || r.day > m.day ? r : m), null);
  const byDay = SalesMath.groupByDay(loadOrders().filter(o => String(o.register) === reg && SalesMath.sign(o)), zone);
  const days = new Set([...byDay.keys(), ...rows.filter(r => r.type !== 'day_close').map(r => tillDay(r.ts))]);
  let grand = lastZ ? lastZ.grandAfter : 0, zNo = zs.length;
  for (const day of [...days].filter(d => d < today && (!lastZ || d > lastZ.day)).sort()) {
    const summary = readingOf(byDay.get(day) || []);
    const grandAfter = unc(cent(grand) + cent(summary.net));
    addShiftRow('day_close', null, summary.net, { day, summary, grandBefore: grand, grandAfter, zNo: ++zNo });
    grand = grandAfter;
  }
}

// One amount on the POS's keypad (the edit sheet's), in the app's confirm card: the start cash, a count.
// OK waits for a key; 0 is an amount. The keyboard types too.
function askCash({ title, okText, from, onOk, onCancel }) {
  let v = '';
  showConfirm({ title, okText, from, onCancel, onConfirm: () => onOk(moneyValue(v)),
    html: `<input class="text-input num sh-amt" readonly placeholder="${escapeHtml(peso(0))}" aria-label="${escapeHtml(title)}">${esKeys(true)}` });
  const f = $('#confirmMessage').closest('form'), shown = f.querySelector('.sh-amt'), ok = f.querySelector('[type="submit"]');
  const press = k => { v = esPress(v, k, true, 9999999); shown.value = v ? typedCash(v) : ''; ok.disabled = !v; };
  press('del');
  f.addEventListener('click', e => { const k = e.target.closest('[data-sk]'); if (k) press(k.dataset.sk); });
  f.addEventListener('keydown', e => {
    if (/^[\d.]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); else if (e.key !== 'Enter') return;
    e.preventDefault();
    if (e.key === 'Enter' && !ok.disabled) f.requestSubmit();
  });
}

// Check out with no shift open: "Start cash?" first, then on into checkout (owner 2026-10-09: every role, no PIN).
function needShift(then, from) {
  if (shiftOf()) return false;
  askCash({ title: 'Start cash?', okText: 'Open shift', from, onOk: n => { if (!shiftOf()) openShift(n); then(); } });
  return true;
}

function openShift(start) {
  closeDays();
  addShiftRow('shift_open', null, start);
  showToast(`Shift open · ${peso(start)}`);
}

// Close shift, blind: count first (the expected cash stays hidden), then Expected / Counted / Over or short, a note,
// one Recount, Close shift. Cancel on the summary and Close shift again comes back to it, not to a fresh count.
function closeShift(btn) {
  const s = shiftOf();
  if (!s) return renderShift();
  if (shiftDraft.countFor !== s.open.id) Object.assign(shiftDraft, { countFor: s.open.id, counts: [] });
  const counts = shiftDraft.counts, count = then => askCash({ title: 'Count the cash in the drawer', okText: 'Next', from: btn, onCancel: then,
    onOk: n => { counts.push(n); closeShift(btn); } });
  if (!counts.length) return count();
  const f = shiftFigures(s), counted = counts[counts.length - 1], diff = shiftDiff(counted, f.expected);
  const row = (lb, v, x = '') => `<div class="sh-fr"><span>${lb}</span>${x}<b class="num">${v}</b></div>`;
  showConfirm({ title: 'Close shift?', okText: 'Close shift', from: btn,
    html: row('Expected', peso(f.expected)) + row('Counted', peso(counted), counts.length < 2 ? '<button type="button" class="link-btn" data-recount>Recount</button>' : '')
      + row('Over / short', overShortText(diff)) + '<input class="text-input sh-note" maxlength="80" placeholder="Add a note" autocomplete="off" aria-label="Note">',
    onConfirm: () => {
      const now = shiftOf(), to = Date.now();
      if (!now || now.open.id !== s.open.id) return renderShift();   // closed meanwhile (another tab)
      addShiftRow('shift_close', s.open.id, counted, { note: note.value.trim(), counts: [...counts],
        summary: { ...shiftFigures(now, to), ...readingOf(drawerCash(now.open.ts, to).rows) } });
      shiftDraft.countFor = null;
      renderShift();
      printPaper(xPaper(shiftOf(true)));
    } });
  const m = $('#confirmMessage'), note = m.querySelector('.sh-note');
  m.querySelector('[data-recount]')?.addEventListener('click', () => count(() => closeShift(btn)));
  m.closest('form').querySelector('[type="submit"]').focus({ preventScroll: true });   // no keyboard popping up for the note
}

// A paper to the printer: a network / Bluetooth printer prints it, else a browser window with the text.
function printPaper(slip) {
  const p = printerConfig();
  if (p.driver === 'network' || p.driver === 'bluetooth') {
    return Promise.resolve().then(() => HWPOS_PRINTER.printSlip(slip, p)).catch(e => showToast('Printer: ' + (e?.message || e)));
  }
  const w = window.open('', 'hwpos_paper', 'width=360,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!w) { showToast('Pop-up blocked — allow pop-ups to print receipts'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(slip.title)}</title>
<style>body{margin:0;padding:12px}pre{margin:0;font:12px/1.4 "Consolas","Courier New",monospace}@page{margin:4mm}</style></head>
<body><pre>${escapeHtml(HWPOS_PRINTER.slipText(slip, p))}</pre><script>addEventListener('load',function(){setTimeout(function(){print()},200)})<\/script></body></html>`);
  w.document.close();
}

// Closed shifts and Z days, newest first; a day sits at its end.
// ponytail: the last 60; page it when someone needs older papers on the POS (the back office keeps them all).
function pastPapers() {
  const rows = registerRows(), zone = tillZone();
  return [
    ...registerShifts(rows).filter(s => s.close).map(s => ({ id: s.open.id, at: s.close.ts, s })),
    ...rows.filter(r => r.type === 'day_close').map(d => ({ id: d.id, at: SalesMath.dayStartMs(SalesMath.addDays(d.day, 1), zone) - 1, d })),
  ].sort((a, b) => b.at - a.at).slice(0, 60);
}
function openPast(id, btn) {
  const p = pastPapers().find(x => x.id === id);
  if (!p) return;
  const slip = p.s ? xPaper(p.s) : zPaper(p.d);
  showConfirm({ title: p.s ? `Shift · ${fmtOrderTime(p.at)}` : `Day · ${tillDate(p.d.day, 'dayYear')}`, okText: 'Print', cancelText: 'Close', from: btn,
    html: `<pre class="rp-paper sh-slip">${escapeHtml(HWPOS_PRINTER.slipText(slip, printerConfig()))}</pre>`, onConfirm: () => printPaper(slip) });
}

// Apple Settings blocks like the item editor (owner 2026-10-08): the drawer, the shift's sales, cash in / out, the
// report and close, then the past papers.
function renderShift() {
  const body = $('#shiftBody');
  if (!body) return;
  closeDays();   // a POS left on overnight makes yesterday's Z when the page draws
  const s = shiftOf(), boss = roleCan(state.role, 'dayTotals');
  const num = f => `<input class="in num" data-f="${f}" value="${escapeHtml(shiftDraft[f])}" ${IMONEY} placeholder="0.00">`;
  const row = (lb, v, cls = '') => `<div class="fr"><span class="lb">${lb}</span><span class="v num ${cls}">${v}</span></div>`;
  const field = (lb, ctl) => `<label class="fr"><span class="lb">${lb}</span><span class="v">${ctl}</span></label>`;
  // a past shift: when it closed, who, over / short; a day: its date and net
  const past = pastPapers().map(p => {
    const diff = p.s && shiftDiff(p.s.close.amount, p.s.close.summary.expected);
    return `<button type="button" class="sh-move" data-past="${escapeHtml(p.id)}">${p.s
      ? `<span class="nm">${escapeHtml(fmtOrderTime(p.at))}<small>Shift · ${escapeHtml(p.s.open.staff)}</small></span><span class="num${diff < 0 ? ' out' : ''}">${overShortText(diff)}</span>`
      : `<span class="nm">${escapeHtml(tillDate(p.d.day, 'dayYear'))}<small>Day</small></span><span class="num">${peso(p.d.amount)}</span>`}</button>`;
  }).join('');
  const pastCard = past ? icard('Past shifts and days', past) : '';
  // the head's search looks through this shift's cash in / out; with no shift open there is nothing to search
  const find = $('#shiftSearch');
  if (find && !s && find.value) { find.value = shiftDraft.q = ''; $('#shiftFind').classList.remove('typed'); }
  if (find) find.disabled = !s;
  if (!s) {
    body.innerHTML = `<div class="c-body">${icard('', '<button type="button" class="fr add" data-sh="open">Open shift</button>', 'Count the cash in the drawer before the first sale.')}${pastCard}</div>`;
    return;
  }
  const f = shiftFigures(s);
  const q = shiftDraft.q.trim().toLowerCase();
  const moves = s.moves.filter(m => !q || `${m.note} ${m.staff} ${peso(Math.abs(m.amount))}`.toLowerCase().includes(q)).reverse().map(m => `<div class="sh-move"><span class="nm">${escapeHtml(m.note)}<small>${escapeHtml(fmtOrderTime(m.ts))} · ${escapeHtml(m.staff)}</small></span>
    <span class="num${m.amount < 0 ? ' out' : ''}">${overShortText(m.amount)}</span></div>`).join('');
  // the cash sales and Expected only for a role that sees the day's totals: the close is a blind count
  body.innerHTML = `<div class="c-body">
    ${icard('Cash drawer', [
      row('Opened', `${escapeHtml(fmtOrderTime(s.open.ts))} <small>· ${escapeHtml(s.open.staff)}</small>`),
      row('Start cash', peso(f.start)),
      boss ? row('Cash sales', peso(f.sales)) : '',
      boss && f.back ? row('Cash refunds', peso(-f.back)) : '',
      boss && f.onAccount ? row('Paid on account', peso(f.onAccount)) : '',
      f.cashIn ? row('Cash in', peso(f.cashIn)) : '',
      f.cashOut ? row('Cash out', peso(-f.cashOut)) : '',
      boss ? row('<b>Expected</b>', `<b>${peso(f.expected)}</b>`) : '',
    ].join(''), '', ' r')}
    ${boss ? shiftSalesCard(s, row) : ''}
    ${icard('Cash in / out', field('Amount', num('amt')) + field('Note', `<input class="in" data-f="note" value="${escapeHtml(shiftDraft.note)}" placeholder="Add a note" maxlength="80" autocomplete="off">`)
      + '<button type="button" class="fr add" data-sh="in">Cash in</button><button type="button" class="fr add" data-sh="out">Cash out</button>', '', ' r')}
    ${moves ? icard('', moves) : ''}
    ${icard('', '<button type="button" class="fr add" data-sh="report">Print report</button><button type="button" class="fr add" data-sh="close">Close shift</button>')}
    ${pastCard}
  </div>`;
}

// What this till sold since open, by how it was paid, and what came off it. Only for a role that sees the
// day's totals (Staff & access, TILL_ACTIONS.dayTotals), as Orders' day bands. Net of voids and refunds.
function shiftSalesCard(s, row) {
  const rows = drawerCash(s.open.ts).rows, t = SalesMath.summarize(rows), by = SalesMath.tenders(rows);
  const neg = n => peso(n ? -n : 0), count = n => (n ? ` <small>· ${n}</small>` : '');
  return icard('Sales', [
    ...[...by].map(([k, n]) => row(escapeHtml(SalesMath.tenderLabel(k)), peso(n))),
    by.size ? '' : row('By method', '—'),
    row(`Refunds${count(t.refundCount)}`, neg(t.refunds)),
    row(`Voids${count(t.voidCount)}`, neg(t.voids)),
    row('Discounts', neg(t.discounts)),
  ].join(''), 'This POS since the shift opened.', ' r');
}

function shiftAction(act, btn) {
  const s = shiftOf();
  if (act === 'open' && !s) return askCash({ title: 'Start cash?', okText: 'Open shift', from: btn, onOk: n => { if (!shiftOf()) openShift(n); renderShift(); } });
  if (act === 'report' && s) return printPaper(xPaper(s));   // changes nothing
  if (act === 'close' && s) return closeShift(btn);
  if ((act === 'in' || act === 'out') && s) {
    const amt = moneyValue(shiftDraft.amt), note = shiftDraft.note.trim();
    if (!(amt > 0)) return showToast('Type an amount');
    if (!note) return showToast('Add a note');
    addShiftRow('cash_move', s.open.id, act === 'in' ? amt : -amt, { note });
    shiftDraft.amt = shiftDraft.note = '';
  }
  renderShift();
}

function onShiftEvent(e) {
  const inp = e.target.closest('[data-f]');
  if (e.type === 'input' && inp) { shiftDraft[inp.dataset.f] = inp.value; return; }
  if (e.type !== 'click') return;
  const btn = e.target.closest('[data-sh]'), past = e.target.closest('[data-past]');
  if (btn) shiftAction(btn.dataset.sh, btn);
  else if (past) openPast(past.dataset.past, past);
}

// The cloud beside the signed-in person in the ☰ drawer: ticked once synced, struck through until then
// (nothing syncs yet), amber when the last sync is over an hour old. The words ride on its label; a tap says them.
const SYNC_ICON = {
  on: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9.5 14.5 2 2 3.5-3.5"/>',
  off: '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
};
function renderSyncMark() {
  const el = $('#syncMark');
  if (!el) return;
  const raw = HWPOS_STORE.ui.get('lastSync'), ts = /^\d+$/.test(raw || '') ? +raw : Date.parse(raw || '');
  const min = Math.floor((Date.now() - ts) / 60000);
  const words = !(ts > 0) ? 'Saved on this POS · not synced yet'
    : (min >= 60 ? 'Last synced · ' : 'Synced · ') + (min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 24 * 60 ? `${Math.floor(min / 60)} h ago` : SalesMath.agoText(ts, Date.now(), tillZone()).toLowerCase());
  el.title = words;
  el.setAttribute('aria-label', words);
  el.classList.toggle('stale', min >= 60);   // synced once, but over an hour ago: worth a look
  el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${SYNC_ICON[ts > 0 ? 'on' : 'off']}</svg>`;
}
