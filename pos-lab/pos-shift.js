// Till › Shift: the till's cash from open to close. One shift per register (cashiers swap by PIN
// inside it); the cash is counted once, at close. Rows are append-only in HWPOS_STORE 'shifts':
//   shift_open  { amount: start cash }
//   cash_move   { amount: + cash in / − cash out, note }
//   shift_close { amount: counted, summary: the figures at close, so a closed shift replays from its row }
// Every row: id, type, shiftId, register, staff, staffId, amount, note, ts, storeId, updatedAt.
// The open shift is derived: this register's last shift_open with no shift_close for it.
// ponytail: Sell is not gated on an open shift; add a gate when the owner asks for one.

const STORAGE_SHIFTS = storeKey('shifts');
const shiftDraft = { start: '', amt: '', note: '', counted: '', q: '' };   // what is typed survives a re-render; q = the head's search

const shiftRows = () => loadList(STORAGE_SHIFTS);
const shiftRegister = () => String(currentStoreInfo().registerNo);

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

// { open, moves, close } for this register's current shift (close null), or its last closed one (last: true).
function shiftOf(last = false) {
  const reg = shiftRegister(), rows = shiftRows().filter(r => String(r.register) === reg);
  const closed = new Map(rows.filter(r => r.type === 'shift_close').map(r => [r.shiftId, r]));
  const opens = rows.filter(r => r.type === 'shift_open' && !!closed.get(r.id) === last).sort((a, b) => a.ts - b.ts);
  const open = opens[opens.length - 1];
  return open ? { open, moves: rows.filter(r => r.type === 'cash_move' && r.shiftId === open.id).sort((a, b) => a.ts - b.ts), close: closed.get(open.id) || null } : null;
}

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
const overShortText = diff => (diff > 0 ? '+' : '') + peso(diff);

// The printed summary: rows for HWPOS_PRINTER.slipLayout (a number prints as money).
function shiftSlip(s) {
  const f = s.close.summary, diff = shiftDiff(s.close.amount, f.expected), when = ts => tillDate(ts, 'slip');
  const rows = [
    ['Register', s.open.register], ['Opened', when(s.open.ts)], ['By', s.open.staff], ['Closed', when(s.close.ts)], ['By', s.close.staff], '-',
    ['Start cash', f.start], ['Cash sales', f.sales],
    ...(f.back ? [['Cash refunds', -f.back]] : []), ...(f.onAccount ? [['Paid on account', f.onAccount]] : []),
    ['Cash in', f.cashIn], ['Cash out', -f.cashOut], '-',
    ['Expected', f.expected, true], ['Counted', s.close.amount, true], ['Over / short', diff, true],
  ];
  // a move: its note wrapped on its own line(s) (notes run to 80 chars, paper is 32 / 48), then time + amount
  if (s.moves.length) rows.push('-', ...s.moves.flatMap(m => [[m.note], [tillDate(m.ts, 'time'), m.amount]]));
  return { store: currentStoreInfo(), title: 'SHIFT CLOSE', rows };
}

function printShiftSlip(s) {
  const p = printerConfig(), slip = shiftSlip(s);
  if (p.driver === 'network' || p.driver === 'bluetooth') {
    return Promise.resolve().then(() => HWPOS_PRINTER.printSlip(slip, p)).catch(e => showToast('Printer: ' + (e?.message || e)));
  }
  const w = window.open('', 'hwpos_shift_' + s.open.id, 'width=360,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!w) { showToast('Pop-up blocked — allow pop-ups to print receipts'); return; }
  w.document.open();
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Shift close</title>
<style>body{margin:0;padding:12px}pre{margin:0;font:12px/1.4 "Consolas","Courier New",monospace}@page{margin:4mm}</style></head>
<body><pre>${escapeHtml(HWPOS_PRINTER.slipText(slip, p))}</pre><script>addEventListener('load',function(){setTimeout(function(){print()},200)})<\/script></body></html>`);
  w.document.close();
}

// Apple Settings blocks like the item editor (owner 2026-10-08): the drawer, the shift's sales, cash in / out, the close.
function renderShift() {
  const body = $('#shiftBody');
  if (!body) return;
  const s = shiftOf(), num = (f, ph = '0.00') => `<input class="in num" data-f="${f}" value="${escapeHtml(shiftDraft[f])}" ${IMONEY} placeholder="${ph}">`;
  const row = (lb, v, cls = '') => `<div class="fr"><span class="lb">${lb}</span><span class="v num ${cls}">${v}</span></div>`;
  const field = (lb, ctl) => `<label class="fr"><span class="lb">${lb}</span><span class="v">${ctl}</span></label>`;
  // the head's search looks through this shift's cash in / out; with no shift open there is nothing to search
  const find = $('#shiftSearch');
  if (find && !s && find.value) { find.value = shiftDraft.q = ''; $('#shiftFind').classList.remove('typed'); }
  if (find) find.disabled = !s;
  if (!s) {
    const last = shiftOf(true);
    body.innerHTML = `<div class="c-body">
      ${icard('', field('Start cash', num('start')), 'The cash in the drawer before the first sale.', ' r')}
      ${icard('', '<button type="button" class="fr add" data-sh="open">Open shift</button>')}
      ${last ? `<div class="sh-last"><span>Last close · ${escapeHtml(fmtOrderTime(last.close.ts))}</span><button type="button" class="act" data-sh="reprint">Print again</button></div>
        <div class="paper-scroll"><pre class="rp-paper sh-slip">${escapeHtml(HWPOS_PRINTER.slipText(shiftSlip(last), printerConfig()))}</pre></div>` : ''}
    </div>`;
    return;
  }
  const f = shiftFigures(s);
  const q = shiftDraft.q.trim().toLowerCase();
  const moves = s.moves.filter(m => !q || `${m.note} ${m.staff} ${peso(Math.abs(m.amount))}`.toLowerCase().includes(q)).reverse().map(m => `<div class="sh-move"><span class="nm">${escapeHtml(m.note)}<small>${escapeHtml(fmtOrderTime(m.ts))} · ${escapeHtml(m.staff)}</small></span>
    <span class="num${m.amount < 0 ? ' out' : ''}">${overShortText(m.amount)}</span></div>`).join('');
  body.innerHTML = `<div class="c-body">
    ${icard('Cash drawer', [
      row('Opened', `${escapeHtml(fmtOrderTime(s.open.ts))} <small>· ${escapeHtml(s.open.staff)}</small>`),
      row('Start cash', peso(f.start)),
      row('Cash sales', peso(f.sales)),
      f.back ? row('Cash refunds', peso(-f.back)) : '',
      f.onAccount ? row('Paid on account', peso(f.onAccount)) : '',
      f.cashIn ? row('Cash in', peso(f.cashIn)) : '',
      f.cashOut ? row('Cash out', peso(-f.cashOut)) : '',
      row('<b>Expected</b>', `<b>${peso(f.expected)}</b>`),
    ].join(''), '', ' r')}
    ${roleCan(state.role, 'dayTotals') ? shiftSalesCard(s, row) : ''}
    ${icard('Cash in / out', field('Amount', num('amt')) + field('Note', `<input class="in" data-f="note" value="${escapeHtml(shiftDraft.note)}" placeholder="Add a note" maxlength="80" autocomplete="off">`)
      + '<button type="button" class="fr add" data-sh="in">Cash in</button><button type="button" class="fr add" data-sh="out">Cash out</button>', '', ' r')}
    ${moves ? icard('', moves) : ''}
    ${icard('Close', field('Counted', num('counted')) + '<div class="fr"><span class="lb">Over / short</span><span class="v num" id="shiftDiff"></span></div>' + '<button type="button" class="fr add" data-sh="close">Close shift</button>', '', ' r')}
  </div>`;
  paintShiftDiff(f.expected);
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
  ].join(''), 'This till since the shift opened.', ' r');
}

// The live Over / short under Counted: empty until a count (0 or more) is typed; short in red.
// Close shift stays live: tapped with no count, it says so (shiftAction).
const shiftCounted = () => shiftDraft.counted !== '' && moneyValue(shiftDraft.counted) >= 0;
function paintShiftDiff(expected) {
  const el = $('#shiftDiff');
  if (!el) return;
  if (expected === undefined) expected = +el.dataset.exp; else el.dataset.exp = expected;   // typing re-reads no orders
  const typed = shiftCounted(), diff = typed ? shiftDiff(moneyValue(shiftDraft.counted), expected) : 0;
  el.textContent = typed ? overShortText(diff) : '—';
  el.classList.toggle('over', typed && diff < 0);
}

// Close shift?: a small card that grows out of the Close shift button (the pay sheet's veil + card, growFrom).
function openCloseSheet(btn, message, onOk) {
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<div class="pay-sheet" role="dialog" aria-label="Close shift">
    <div class="ph"><b>Close shift?</b><small>${escapeHtml(message)}</small></div>
    <div class="pb"><button type="button" class="secondary-btn small" data-cancel>Cancel</button><button type="button" class="primary-btn small" data-ok>Close and print</button></div>
  </div>`;
  const f = veil.firstChild, r = btn.getBoundingClientRect();
  f.style.width = Math.min(340, innerWidth - 24) + 'px';
  document.body.append(veil);
  f.style.left = Math.max(12, Math.min(innerWidth - f.offsetWidth - 12, r.right - f.offsetWidth)) + 'px';
  f.style.top = Math.max(8, Math.min(innerHeight - f.offsetHeight - 8, r.bottom - f.offsetHeight)) + 'px';
  const shrink = growFrom(f, r);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => {
    if (veil.style.pointerEvents) return;   // closing already: a second tap must not close the shift twice
    document.removeEventListener('keydown', onKey, true);
    veil.style.pointerEvents = 'none';
    shrink(() => veil.remove());
    btn.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', onKey, true);
  veil.addEventListener('click', (e) => {
    const ok = e.target.closest('[data-ok]');
    if (ok && !veil.style.pointerEvents) onOk();
    if (ok || e.target === veil || e.target.closest('[data-cancel]')) close();
  });
  f.querySelector('[data-ok]').focus({ preventScroll: true });
}

function shiftAction(act, btn) {
  const s = shiftOf();
  if (act === 'open' && !s) {
    const start = moneyValue(shiftDraft.start);
    if (start < 0 || shiftDraft.start === '') return showToast('Type the start cash');
    addShiftRow('shift_open', null, start);
    shiftDraft.start = '';
    showToast(`Shift open · ${peso(start)}`);
  } else if ((act === 'in' || act === 'out') && s) {
    const amt = moneyValue(shiftDraft.amt), note = shiftDraft.note.trim();
    if (!(amt > 0)) return showToast('Type an amount');
    if (!note) return showToast('Add a note');
    addShiftRow('cash_move', s.open.id, act === 'in' ? amt : -amt, { note });
    shiftDraft.amt = shiftDraft.note = '';
  } else if (act === 'close' && s) {
    if (!shiftCounted()) { showToast('Type the counted cash'); return $('#shiftBody [data-f="counted"]')?.focus(); }
    const counted = moneyValue(shiftDraft.counted), f = shiftFigures(s), diff = shiftDiff(counted, f.expected);
    return openCloseSheet(btn || $('#shiftBody [data-sh="close"]'),
      `Expected ${peso(f.expected)} · counted ${peso(counted)} · ${diff ? `${diff < 0 ? 'short' : 'over'} ${peso(Math.abs(diff))}` : 'even'}`,
      () => {
        const now = shiftOf();
        if (!now || now.open.id !== s.open.id) return renderShift();   // closed meanwhile (another tab)
        addShiftRow('shift_close', s.open.id, counted, { summary: shiftFigures(now) });
        shiftDraft.counted = '';
        renderShift();
        printShiftSlip(shiftOf(true));
      });
  } else if (act === 'reprint') {
    const last = shiftOf(true);
    if (last) printShiftSlip(last);
    return;
  }
  renderShift();
}

function onShiftEvent(e) {
  const inp = e.target.closest('[data-f]');
  if (e.type === 'input' && inp) {
    shiftDraft[inp.dataset.f] = inp.value;
    if (inp.dataset.f === 'counted') paintShiftDiff();
    return;
  }
  if (e.type === 'keydown') {
    if (e.key !== 'Enter' || !inp) return;
    const act = { start: 'open', counted: 'close' }[inp.dataset.f];
    if (act) { e.preventDefault(); shiftAction(act); }
    return;
  }
  const btn = e.type === 'click' && e.target.closest('[data-sh]');
  if (btn) shiftAction(btn.dataset.sh, btn);
}

// The quiet line under the signed-in person in the ☰ drawer. Nothing syncs yet, so it says so.
function renderSyncMark() {
  const el = $('#syncMark');
  if (!el) return;
  const raw = HWPOS_STORE.ui.get('lastSync'), ts = /^\d+$/.test(raw || '') ? +raw : Date.parse(raw || '');
  if (!(ts > 0)) { el.textContent = 'Saved on this till · not synced yet'; return; }
  const min = Math.floor((Date.now() - ts) / 60000);
  el.textContent = 'Synced · ' + (min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 24 * 60 ? `${Math.floor(min / 60)} h ago` : SalesMath.agoText(ts, Date.now(), tillZone()).toLowerCase());
}
