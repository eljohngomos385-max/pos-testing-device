// POS › Shift: the store's cash drawer (owner 2026-10-10). One shift per STORE, one drawer: any POS whose role has
// "Start and close shifts" (Staff & access) starts or closes it; everyone sells, and every sale counts. Nobody is
// asked anything while selling. The cash is counted once, at close, blind. Rows are append-only in HWPOS_STORE 'shifts':
//   shift_open  { amount: start cash, cutoff: the auto-close hour it opened under, float: true when left at the last close }
//   cash_move   { amount: + cash in / − cash out, note } -- with or without a shift open
//   shift_close { amount: counted (0 = not counted), counts: every count typed, note }
//   day_close   { amount: the day's net, day, summary: its reading, grandBefore, grandAfter, zNo } -- the Z, per register, made by closeDays
// Every row: id, type, shiftId, register, staff, staffId, amount, note, ts, storeId, updatedAt.
// Shifts are derived (storeShifts), never written: walked in time, an open inside a running shift joins it (the earlier
// counts), each close ends it, else the auto end does. Moves and sales belong by TIME, and a
// shift's figures are always counted live from the rows: a sale synced late updates a closed shift's Expected.

const STORAGE_SHIFTS = storeKey('shifts');
const shiftDraft = { amt: '', note: '' };   // the page's cash in / out: typed text survives a re-render
// ponytail: the counts of a close live in the sheet (shSheet); a reload starts the blind count again.

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

const storeRows = () => shiftRows().filter(r => r.type !== 'day_close').sort((a, b) => a.ts - b.ts);   // the store's drawer rows, every POS
const movesIn = (rows, from, to) => rows.filter(m => m.type === 'cash_move' && m.ts >= from && m.ts < to);
// The auto-close turn (Settings › Shift › Auto-close at, store clock): the last at or before ts, and the first after.
// A wall-clock hour in the store's zone: on a DST-change day it is still 4 AM.
const cutAt = (day, h) => SalesMath.dayStartMs(day, tillZone(), h);
function cutBefore(ts = Date.now(), h = state.settings.autoClose) {
  const day = tillDay(ts), t = cutAt(day, h);
  return t <= ts ? t : cutAt(SalesMath.addDays(day, -1), h);
}
const cutAfter = (ts, h = state.settings.autoClose) => cutAt(SalesMath.addDays(tillDay(cutBefore(ts, h)), 1), h);
// When an open nobody closes ends: the next turn after it began, under the hour it opened with. A float (left in the
// drawer at the night's close) begins its day at its first sale or cash move after that turn, and ends at the turn
// after: the turn before its day can't close it (my reading of owner #7, no auto-close on a float); untouched, it waits.
// ponytail: a float left at a mid-day handover and never closed runs on into the next day; one drawer, so Expected stays right.
function autoEndOf(open, rows, orders) {
  const h = open.cutoff ?? state.settings.autoClose, turn = cutAfter(open.ts, h);
  if (!open.float) return turn;
  const first = [...movesIn(rows, turn, Infinity), ...orders].reduce((m, r) => (r.ts >= turn && r.ts < m ? r.ts : m), Infinity);
  return first === Infinity ? Infinity : cutAfter(first, h);
}
// Every shift of the store, oldest first: { id, open, ids (every open joined), close (null: open, or closed by itself), end, moves }.
// One drawer, one shift, walked in time: an open while one runs (two POSes offline) joins it, the earlier counts. A
// close of any open in it ends it; else its auto end does, and a close after that (an old offline count) is dropped.
// Sales after a close and before the next Start belong to no shift (the page counts them from that close).
// ponytail: derived, never written; the back office must run the same. A scan per shift: index at thousands of rows.
function storeShifts(rows = storeRows(), orders = loadOrders()) {
  const opens = new Map(rows.filter(r => r.type === 'shift_open').map(r => [r.id, r])), out = [];
  // a close sorts before an open at its ms (the float left at it), after its own open (a clock stepped back)
  const ev = rows.flatMap(r => {
    const o = r.type === 'shift_open' ? r : r.type === 'shift_close' && opens.get(r.shiftId);
    return o ? [{ r, t: Math.max(r.ts, o.ts), k: r === o ? 1 : r.ts > o.ts ? 0 : 2 }] : [];
  });
  let cur = null;   // the running shift: its first open, every open joined, its auto end
  const end = (close, t) => { out.push({ id: cur.open.id, open: cur.open, ids: cur.ids, close, end: t }); cur = null; };
  for (const { r, t } of ev.sort((x, y) => x.t - y.t || x.k - y.k)) {
    if (cur && t >= cur.auto) end(null, cur.auto);
    if (r.type === 'shift_close') { if (cur?.ids.has(r.shiftId)) end(r, t); }
    else if (cur) cur.ids.add(r.id);
    else cur = { open: r, ids: new Set([r.id]), auto: autoEndOf(r, rows, orders) };
  }
  if (cur) end(null, cur.auto);
  return out.map(x => ({ ...x, moves: movesIn(rows, x.open.ts, x.end) }));
}
// Closed: counted (a written close is final, whatever the clock says after it), or past its auto end.
const shiftDone = (s, now = Date.now()) => !!s.close || s.end <= now;
const shiftOf = (all = storeShifts(), now = Date.now()) => all.filter(s => !shiftDone(s, now)).pop() || null;   // the open shift

// The drawer over the shift: start + cash sales − cash handed back + cash paid on account ± petty cash, every POS.
// Cash sales / back / on account are drawerCash's (pos-settings.js), the same sum the day count reads. diff: over /
// short against the saved count, live (a late sale moves it); null when not counted (0 typed, or closed by itself).
function shiftFigures(s) {
  const d = drawerCash(s.open.ts, s.end, null);
  const sum = sign => unc(s.moves.reduce((n, m) => n + (Math.sign(m.amount) === sign ? cent(Math.abs(m.amount)) : 0), 0));
  const f = { start: moneyValue(s.open.amount), sales: d.sales, back: d.back, onAccount: d.onAccount, cashIn: sum(1), cashOut: sum(-1), rows: d.rows };
  f.expected = unc(cent(f.start) + cent(f.sales) - cent(f.back) + cent(f.onAccount) + cent(f.cashIn) - cent(f.cashOut));
  f.diff = s.close?.amount ? shiftDiff(s.close.amount, f.expected) : null;
  return f;
}
const shiftDiff = (counted, expected) => unc(cent(counted) - cent(expected));
const minus = n => (n ? -n : 0);   // a figure taken off, never −0
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
{ // the check: storeShifts on made-up rows, around today's 4 AM turn (T), in any zone
  const T = cutBefore(Date.now(), 4), H = 3600e3, op = (id, ts, x) => ({ id, type: 'shift_open', ts, cutoff: 4, register: '1', ...x });
  const cl = (shiftId, ts, amount = 0, register = '1') => ({ id: 'c' + ts, type: 'shift_close', shiftId, ts, amount, register }), mv = ts => ({ id: 'm' + ts, type: 'cash_move', ts, amount: 5 });
  const run = (...rows) => storeShifts(rows.sort((a, b) => a.ts - b.ts), []), fl = { float: true };
  const a = run(op('a', T - 10 * H), op('b', T - 10 * H + 6e4, { register: '2' }), cl('b', T - 5 * H, 0, '2'), cl('a', T - 4 * H));   // two POSes: one shift, the first close ends it
  const b = run(op('a', T - 18 * H));   // nobody closed it: the next turn
  const c = run(op('a', T - 5 * H, fl)), c2 = run(op('a', T - 5 * H, fl), mv(T + 5 * H)), c3 = run(op('a', T - 5 * H, fl), mv(T - 4 * H));   // a float waits for its day
  const d = run(op('a', T - 10 * H), cl('a', T - 9 * H), mv(T - 8 * H), op('b', T - 7 * H));   // a move between two shifts: neither's
  const e = run(op('a', T - 10 * H), cl('a', T - 11 * H));   // a close dated before its open
  const k = run(op('a', T - 20 * H), cl('a', T - 15 * H, 600), op('f', T - 15 * H, { amount: 300, float: true }));   // a float left at the close
  const g = run(op('a', T - 30 * H), cl('a', T - 20 * H));   // a close after the auto end: dropped
  console.assert(a.length === 1 && a[0].id === 'a' && a[0].end === T - 5 * H && a[0].close.shiftId === 'b'
    && b[0].end === T && !b[0].close && !shiftOf(b, Date.now())
    && c[0].end === Infinity && c2[0].end === T + 864e5 && c3[0].end === Infinity
    && d.length === 2 && !d[0].moves.length && !d[1].moves.length && !shiftOf([d[0]], T - 9.5 * H)
    && e[0].end === T - 10 * H
    && k.length === 2 && k[0].close.amount === 600 && k[1].open.amount === 300 && k[1].end === Infinity
    && g.length === 1 && !g[0].close && g[0].end === T - 24 * H, 'storeShifts', a, b, c, d, e, k, g);
  console.assert(SalesMath.dayStartMs('2026-11-01', 'America/New_York', 4) === Date.UTC(2026, 10, 1, 9)
    && SalesMath.dayStartMs('2026-03-08', 'America/New_York', 4) === Date.UTC(2026, 2, 8, 8), 'cutoff across DST');
}

// The reading's lines on paper. A number prints as money.
// ponytail: no zero-rated sales on this POS (always 0); MIN / serial no. / PTU wait for BIR registration fields in Settings.
function readingRows(r) {
  return [
    ['Beg. SI #', r.first || '-'], ['End. SI #', r.last || '-'], '-',
    ['Gross sales', r.gross], ['Less SC discount', minus(r.senior)], ['Less PWD discount', minus(r.pwd)],
    ['Less other discounts', minus(r.otherOff)], ['Less refunds', minus(r.refunds)], ['Less voids', minus(r.voids)],
    ['Less VAT adjustment', minus(r.vatOff)], ['Net sales', r.net, true], '-',
    ['VATable sales', r.vatable], ['VAT', r.vat], ['VAT-exempt sales', r.exempt], ['Zero-rated sales', 0], '-',
    ...(r.byMethod.length ? r.byMethod.map(([k, n]) => [SalesMath.tenderLabel(k), n]) : [['Payments', 0]]),
  ];
}

// A shift's paper (the X), counted from the rows now: a sale synced late shows on a closed shift's paper too. The cash
// is the store's (one drawer); the reading is this POS's (BIR's X is per machine). Whoever can close a shift sees
// all of it, Expected too (owner 2026-10-10: closing is a manager's job).
function xPaper(s) {
  const closed = shiftDone(s), c = s.close, when = ts => tillDate(ts, 'slip'), x = shiftFigures(s);
  const f = { ...x, ...readingOf(x.rows.filter(o => String(o.register) === shiftRegister())) };
  const by = c ? (c.staff !== s.open.staff ? c.staff : '') : closed ? 'Auto-close' : '';
  const rows = [
    ['POS', s.open.register], ['Cashier', s.open.staff], ['Start', when(s.open.ts)], ['End', when(closed ? s.end : Date.now())],
    ...(by ? [['Closed by', by]] : []), '-',
    ...readingRows(f), '-',
    ['Start cash', f.start], ['Cash sales', f.sales], ['Cash refunds', minus(f.back)],
    ...(f.onAccount ? [['Paid on account', f.onAccount]] : []), ['Cash in', f.cashIn], ['Cash out', minus(f.cashOut)],
    '-', ['Expected', f.expected, true],
    ...(f.diff !== null ? [['Counted', c.amount, true], f.diff ? [f.diff > 0 ? 'Over' : 'Short', Math.abs(f.diff), true] : ['Over / short', 'Even', true]] : closed ? [['Counted', 'Not counted']] : []),
    ...(c?.counts?.length > 1 ? [['First count', c.counts[0]]] : []), ...(c?.note ? [[`Note: ${c.note}`]] : []),
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
// gets one, oldest first. The grand total never resets: the last Z's + the day's net. Runs when the app loads and
// when the Shift page draws, so a day closes itself the first time the POS wakes on a later one.
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

function openShift(start, extra) {
  addShiftRow('shift_open', null, start, { cutoff: state.settings.autoClose, ...extra });
  showToast(`Shift started · ${peso(start)}`);
}

// Start / Close shift: a full panel in the edit sheet's frame (its keys, hero and foot), 0 typed so one tap goes on.
// Start asks the start cash. Close counts blind (no Expected while counting), then Expected / Counted / Over or short,
// a note, one Recount; in float mode (Settings › Shift › Starting cash) what stays in the drawer starts the next
// shift. A count of 0 is Not counted. ✕ / Back / Esc / leaving the page at any step: nothing saved (owner 2026-10-10).
let shSheet = null;   // { step: 'start' | 'count' | 'result' | 'leave', v: typed, counts, shiftId, note, born }
function openShiftSheet(step) {
  shSheet = { step, v: '0', counts: [], shiftId: shiftOf()?.id || null, note: '', born: performance.now() };
  drawShiftSheet();
  $('#shiftSheet').classList.add('open');
}
function closeShiftSheet() { if (!shSheet) return; shSheet = null; $('#shiftSheet').classList.remove('open'); }
const SH_ASK = { start: ['Starting cash?', 'Start shift'], count: ['Count the cash in the drawer', 'Next'], leave: ['Leave in drawer?', 'Close shift'] };
const shCounted = () => shSheet.counts[shSheet.counts.length - 1];
const shLeave = () => state.settings.startCash === 'float' && shCounted();   // a float only from a counted drawer
function drawShiftSheet() {
  const o = shSheet, ask = SH_ASK[o.step];
  let head, rows = '', left = '', ink;
  if (ask) [head, ink] = [`<p>${ask[0]}</p><div class="es-hero">${typedCash(o.v)}</div>`, ask[1]];
  else {   // the figures as this draws (the close stores none: a sale after it moves them on the paper and the list)
    const f = shiftFigures(storeShifts().find(x => x.ids.has(o.shiftId))), counted = shCounted();
    const row = (lb, v) => `<div class="es-row"><span>${lb}</span><small class="num">${v}</small></div>`;
    head = `<p>Over / short</p><div class="es-hero">${counted ? overShortText(shiftDiff(counted, f.expected)) : 'Not counted'}</div>`;
    rows = row('Expected', peso(f.expected)) + row('Counted', counted ? peso(counted) : 'Not counted')
      + `<textarea class="es-ta" id="shNote" rows="2" maxlength="80" placeholder="Add a note" aria-label="Note">${escapeHtml(o.note)}</textarea>`;
    if (o.counts.length < 2) left = '<button type="button" class="es-q" data-recount>Recount</button>';
    ink = shLeave() ? 'Next' : 'Close shift';
  }
  $('#shiftSheetCard').innerHTML = esFrame(head, rows, ask ? `<div class="es-keys">${esKeys(true)}</div>` : '', `${left}<button type="button" class="es-ink" data-apply>${ink}</button>`);
  if (ask) $('#shiftSheet .es-ink').focus({ preventScroll: true });   // off the page's button: a key can't fire it again
}
const shStep = step => { Object.assign(shSheet, { step, v: '0', born: performance.now() }); drawShiftSheet(); };
function shiftSheetClick(e) {
  const o = shSheet, el = q => e.target.closest(q);
  if (!o || !e.target) return;   // a desk key with no key for it on this step
  const k = el('[data-sk]');
  if (el('[data-close]')) return closeShiftSheet();
  if (k) { o.v = esPress(o.v, k.dataset.sk, true, CASH_MAX); return drawShiftSheet(); }
  if (el('[data-recount]') && !shEarly()) { o.note = $('#shNote').value; return shStep('count'); }
  if (el('[data-apply]') && !shEarly()) shiftApply();
}
// A double tap: Start shift / Close shift on the page and the panel's button sit in one spot (as showConfirm's early()).
const shEarly = () => performance.now() - shSheet.born < 350;
function shiftApply() {
  const o = shSheet, n = moneyValue(o.v);
  if (!canAccess('shift')) return closeShiftSheet();   // every write comes through here: the console too
  if (o.step === 'start') {
    if (shiftOf()) showToast('A shift is already open'); else openShift(n);
    closeShiftSheet();
    return renderShift();
  }
  if (o.step === 'count') { o.counts.push(n); return shStep('result'); }
  if (o.step === 'result') { o.note = $('#shNote').value; return shLeave() ? shStep('leave') : finishClose(0); }
  if (n > shCounted()) return showToast('More than counted');
  finishClose(n);
}
function finishClose(leave) {
  const s = shiftOf(), o = shSheet;
  closeShiftSheet();
  if (!s?.ids.has(o.shiftId)) { showToast('The shift was already closed'); return renderShift(); }   // another POS / tab, or the cutoff passed
  const c = addShiftRow('shift_close', s.open.id, o.counts[o.counts.length - 1], { note: o.note.trim(), counts: [...o.counts] });
  if (leave > 0) openShift(leave, { float: true, ts: c.ts });   // the same ms: no sale falls between the two
  renderShift();
  printPaper(xPaper(storeShifts().find(x => x.id === s.id)));
}
// The desk keyboard on the panel: digits, Backspace, Enter, as taps on its keys (not on the result: the note is there,
// and a bounce must not close unseen). Handled keys are kept from the page, so a focused page button can't fire again.
function shiftKey(e) {
  if (!shSheet || !SH_ASK[shSheet.step] || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input, textarea')) return;
  const k = e.key === 'Backspace' ? 'del' : e.key, q = k === 'Enter' ? '[data-apply]' : /^([\d.]|del)$/.test(k) && `[data-sk="${k}"]`;
  if (!q) return;
  e.preventDefault();
  shiftSheetClick({ target: $(`#shiftSheet ${q}`) });
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

// The store's closed shifts and this POS's Z days, newest first; a shift sits at its end, a day at its end.
// ponytail: the last 60; page it when someone needs older papers on the POS (the back office keeps them all).
function pastPapers(all = storeShifts()) {
  const zone = tillZone(), now = Date.now();
  return [
    ...all.filter(s => shiftDone(s, now)).map(s => ({ id: s.id, at: s.end, s })),
    ...registerRows().filter(r => r.type === 'day_close').map(d => ({ id: d.id, at: SalesMath.dayStartMs(SalesMath.addDays(d.day, 1), zone) - 1, d })),
  ].sort((a, b) => b.at - a.at).slice(0, 60);
}
function openPast(id) {
  const p = pastPapers().find(x => x.id === id);
  if (!p) return;
  const slip = p.s ? xPaper(p.s) : zPaper(p.d);
  showConfirm({ title: p.s ? `Shift · ${fmtOrderTime(p.at)}` : `Day · ${tillDate(p.d.day, 'dayYear')}`, okText: 'Print', cancelText: 'Close',
    html: `<pre class="rp-paper sh-slip">${escapeHtml(HWPOS_PRINTER.slipText(slip, printerConfig()))}</pre>`, onConfirm: () => printPaper(slip) });
}

// Live like Reports (owner 2026-10-09): a sale, a cash move or a close (another tab, a sync), the role, the day turning,
// the auto-close turn. Not while an amount or note is being typed on the page or a card is up over it (a clicked button
// keeps focus: not that). The Start / Close panel is its own element: a redraw under it is harmless.
const shiftSig = () => [tillDay(Date.now()), cutBefore(), reportsSignature(), storageGet(STORAGE_SHIFTS, ''), storageGet(STORAGE_CUSTOMER_LEDGER, '')].join('|');
function shiftLive() {
  if (state.view !== 'shift') return;
  if (!canAccess('shift')) { closeShiftSheet(); return applyRoleGating(); }   // the switch was taken away
  if (confirmSheet || document.activeElement?.matches('#shiftBody input')) return;
  if (shiftSig() !== shiftLive._sig) renderShift();
}

// Apple Settings blocks like the item editor (owner 2026-10-08): the drawer, the sales, cash in / out, Start or
// Print report + Close, then the past papers. With no shift open the drawer counts from today's auto-close turn
// (owner 2026-10-10 #3), or from today's last close (its cash was counted then): the same page, start cash 0, and Start shift the only button.
function renderShift() {
  const body = $('#shiftBody');
  if (!body) return;
  closeDays();   // a POS left on overnight makes yesterday's Z when the page draws
  shiftLive._sig = shiftSig();
  const all = storeShifts(), s = shiftOf(all), now = Date.now();
  const from = Math.max(cutBefore(now), ...all.filter(x => shiftDone(x, now)).map(x => x.end));   // none open: since the turn, or today's last close
  const d = s || { open: { ts: from, amount: 0 }, close: null, end: Infinity, moves: movesIn(storeRows(), from, Infinity) }, f = shiftFigures(d);
  const row = (lb, v) => `<div class="fr"><span class="lb">${lb}</span><span class="v num">${v}</span></div>`;
  const field = (lb, ctl) => `<label class="fr"><span class="lb">${lb}</span><span class="v">${ctl}</span></label>`;
  // a past shift: when it ended, who started it, over / short or Not counted; a day: its date and net
  const past = pastPapers(all).map(p => {
    const diff = p.s && shiftFigures(p.s).diff;   // live: a late sale moves it
    return `<button type="button" class="sh-move" data-past="${escapeHtml(p.id)}">${p.s
      ? `<span class="nm">${escapeHtml(fmtOrderTime(p.at))}<small>Shift · ${escapeHtml(p.s.open.staff)}</small></span><span class="num${diff < 0 ? ' out' : ''}">${diff === null ? 'Not counted' : overShortText(diff)}</span>`
      : `<span class="nm">${escapeHtml(tillDate(p.d.day, 'dayYear'))}<small>Day</small></span><span class="num">${peso(p.d.amount)}</span>`}</button>`;
  }).join('');
  const pastCard = past ? icard('Past shifts and days', past) : '';
  const moves = d.moves.slice().reverse().map(m => `<div class="sh-move"><span class="nm">${escapeHtml(m.note)}<small>${escapeHtml(fmtOrderTime(m.ts))} · ${escapeHtml(m.staff)}</small></span>
    <span class="num${m.amount < 0 ? ' out' : ''}">${overShortText(m.amount)}</span></div>`).join('');
  // the cash sales and Expected only for a role that sees the day's totals: the close is a blind count
  body.innerHTML = `<div class="c-body">
    ${icard('Cash drawer', [
      s ? row('Started', `${escapeHtml(fmtOrderTime(s.open.ts))} <small>· ${escapeHtml(s.open.staff)}</small>`) + row('Start cash', peso(f.start))
        : row('Since', escapeHtml(fmtOrderTime(from))),
      row('Cash sales', peso(f.sales)),
      f.back ? row('Cash refunds', peso(minus(f.back))) : '',
      f.onAccount ? row('Paid on account', peso(f.onAccount)) : '',
      row('Cash in', peso(f.cashIn)),
      row('Cash out', peso(minus(f.cashOut))),
      row('<b>Expected</b>', `<b>${peso(f.expected)}</b>`),
    ].join(''), '', ' r')}
    ${shiftSalesCard(f.rows, row, s ? 'Since the shift started.' : `Since ${fmtOrderTime(from)}.`)}
    ${icard('Cash in / out', field('Amount', `<input class="in num" data-f="amt" value="${escapeHtml(shiftDraft.amt)}" ${IMONEY} placeholder="0.00">`) + field('Note', `<input class="in" data-f="note" value="${escapeHtml(shiftDraft.note)}" placeholder="Add a note" maxlength="80" autocomplete="off">`)
      + '<button type="button" class="fr add" data-sh="in">Cash in</button><button type="button" class="fr add" data-sh="out">Cash out</button>', '', ' r')}
    ${moves ? icard('', moves) : ''}
    ${icard('', s ? '<button type="button" class="fr add" data-sh="report">Print report</button><button type="button" class="fr add" data-sh="close">Close shift</button>'
      : '<button type="button" class="fr add" data-sh="open">Start shift</button>')}
    ${pastCard}
  </div>`;
}

// What the store sold over the shift (or since the turn with none open), by how it was paid, and what came off it.
// Net of voids and refunds.
function shiftSalesCard(rows, row, since) {
  const t = SalesMath.summarize(rows), by = SalesMath.tenders(rows);
  const neg = n => peso(minus(n)), count = n => (n ? ` <small>· ${n}</small>` : '');
  return icard('Sales', [
    ...[...by].map(([k, n]) => row(escapeHtml(SalesMath.tenderLabel(k)), peso(n))),
    by.size ? '' : row('By method', '—'),
    row(`Refunds${count(t.refundCount)}`, neg(t.refunds)),
    row(`Voids${count(t.voidCount)}`, neg(t.voids)),
    row('Discounts', neg(t.discounts)),
  ].join(''), since, ' r');
}

function shiftAction(act) {
  if (!canAccess('shift')) return;   // the page is hidden without the switch; this keeps the console out too
  const s = shiftOf();
  if (act === 'open' && !s) return openShiftSheet('start');
  if (act === 'close' && s) return openShiftSheet('count');
  if (act === 'report' && s) return printPaper(xPaper(s));   // changes nothing
  if (act === 'in' || act === 'out') {   // with or without a shift open (owner 2026-10-10 #3)
    const amt = moneyValue(shiftDraft.amt), note = shiftDraft.note.trim();
    if (!(amt > 0 && amt <= CASH_MAX)) return showToast('Type an amount');
    if (!note) return showToast('Add a note');
    addShiftRow('cash_move', s?.open.id, act === 'in' ? amt : -amt, { note });
    shiftDraft.amt = shiftDraft.note = '';
  }
  renderShift();
}

function onShiftEvent(e) {
  const inp = e.target.closest('[data-f]');
  if (e.type === 'input' && inp) { shiftDraft[inp.dataset.f] = inp.value; return; }
  if (e.type !== 'click') return;
  const btn = e.target.closest('[data-sh]'), past = e.target.closest('[data-past]');
  if (btn) shiftAction(btn.dataset.sh);
  else if (past) openPast(past.dataset.past);
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
