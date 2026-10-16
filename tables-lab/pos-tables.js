// POS › Tables (Tables lab, owner 2026-10-16). Sell → Dine-in → tap the table: the cart goes on it and clears.
// ☰ Tables: the same floor plan; tap a busy table → its order → Add items · Print bill · Check out (the sale frees it).
// A table's order is a saved cart of kind 'table' named after the table (pos-checkout saveDraft); Saved never lists it.
// The floor plan is a store setting (state.settings.tables): tables on a 600×400 room, line drawn, moved in Arrange.
// Tables only: no counter, kitchen or door (owner 2026-10-16: not needed to find a table).
// ponytail: one room scaled to the screen, no zoom; a big place gets areas (Inside / Terrace) as tabs when one asks.
// ponytail: per device, like saved carts; two POS on one table needs sync (the Supabase step). The layout syncs as a setting.
const ROOM = [600, 400];
const T = (name, seats, x, y) => ({ id: 't' + name, name, seats, x, y, rot: 0 });
const DEFAULT_TABLES = [
  T('1', 2, 70, 70), T('2', 2, 170, 70), T('3', 4, 300, 70), T('4', 4, 460, 70), T('5', 4, 110, 200), T('6', 6, 290, 200),
  T('7', 2, 470, 200), T('8', 8, 160, 330), T('9', 2, 340, 330), T('10', 4, 480, 330),
];
const floor = () => (state.settings.tables ||= DEFAULT_TABLES.map(p => ({ ...p })));
// A table is square for 2 and gets longer as seats are added: half the chairs on each long side.
const tableW = p => Math.ceil(p.seats / 2) * 36 + 14;
let floorEdit = false, floorSel = '';

const tableOrder = n => loadSavedCarts().find(d => d.kind === 'table' && d.name === n);
// The table the cart came from (Add items / Check out), else ''.
const cartTable = () => (state.savedId && loadSavedCarts().find(d => d.id === state.savedId && d.kind === 'table')?.name) || '';
const tableTotal = d => cartTotals(d.items || [], d.cartDiscount, d.scPwd).total;
function seatedFor(d) {
  const m = Math.max(0, Math.round((Date.now() - (d.seatedAt || d.ts)) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// One table: an outline, a short line per chair. Open = filled, with its total on the Tables page.
function tableSvg(p, page, on) {
  const w = tableW(p), d = tableOrder(p.name), top = Math.ceil(p.seats / 2), bot = p.seats - top;
  const chairs = (n, y) => Array.from({ length: n }, (_, i) => { const x = -w / 2 + 15 + (top - n) * 18 + i * 36; return `<line class="fp-chair" x1="${x}" x2="${x + 20}" y1="${y}" y2="${y}"/>`; }).join('');
  const ring = floorEdit && page ? `<rect class="fp-ring" x="${-w / 2 - 8}" y="-44" width="${w + 16}" height="88" rx="10"/>` : '';
  const text = d && page ? `<text class="fp-name" y="-2">${escapeHtml(p.name)}</text><text class="fp-amt" y="14">${peso(tableTotal(d))}</text>`
    : `<text class="fp-name" y="6">${escapeHtml(p.name)}</text>`;
  return `<g class="fp${d ? ' busy' : ''}${p.name === on ? ' on' : ''}${ring && p.id === floorSel ? ' sel' : ''}" data-pid="${p.id}" data-table="${escapeHtml(p.name)}" transform="translate(${p.x} ${p.y})"><g transform="rotate(${p.rot || 0})">${
    ring}${chairs(top, -33)}${chairs(bot, 33)}<rect class="fp-top" x="${-w / 2}" y="-25" width="${w}" height="50" rx="8"/></g>${text}</g>`;
}

// The floor plan. On the Tables page (`page`) busy tables show their total and Arrange moves them;
// in Sell's Dine-in panel it is only for tapping a table.
function tableMapHtml(page) {
  const on = cartTable(), [W, H] = ROOM;
  return `<div class="tb-map tb-floor"><svg class="fp-room${floorEdit && page ? ' editing' : ''}" viewBox="-4 -4 ${W + 8} ${H + 8}" role="img" aria-label="Floor plan"><rect class="fp-wall" width="${W}" height="${H}" rx="14"/>${
    floor().map(p => tableSvg(p, page, on)).join('')}</svg></div>`;
}

function renderTables() {
  const busy = floor().map(t => tableOrder(t.name)).filter(Boolean);
  $('#tablesArrange').textContent = floorEdit ? 'Done' : 'Arrange';
  $('#tablesSum').textContent = floorEdit ? 'Drag a table to move it. Tap one to change it.'
    : busy.length ? `${busy.length} open · ${peso(busy.reduce((s, d) => s + tableTotal(d), 0))}` : 'All tables free';
  $('#tablesMap').innerHTML = tableMapHtml(true);
  renderFloorTools();
}

// Arrange's bar: Add table, and for the picked table its seats, Turn and Remove.
function renderFloorTools() {
  const t = $('#tablesTools'), p = floorEdit && floor().find(x => x.id === floorSel);
  t.hidden = !floorEdit;
  if (!floorEdit) return;
  const b = (act, label, aria = '') => `<button type="button" class="secondary-btn small" data-fp="${act}"${aria && ` aria-label="${aria}"`}>${label}</button>`;
  t.innerHTML = b('add', 'Add table') + (p ? `<span class="tb-pick">Table ${escapeHtml(p.name)}</span>${b('less', '−', 'Fewer seats')}<span class="tb-seats">${
    p.seats} seats</span>${b('more', '+', 'More seats')}${b('turn', 'Turn')}${b('remove', 'Remove')}` : '');
}

function arrangeTables() { floorEdit = !floorEdit; floorSel = ''; renderTables(); }
function saveFloor() { saveSettings(); renderTables(); }

function addTable(seats) {
  const p = { id: crypto.randomUUID(), name: String(Math.max(0, ...floor().map(t => +t.name || 0)) + 1), seats, x: ROOM[0] / 2, y: ROOM[1] / 2, rot: 0 };
  placeFree(p);
  floor().push(p);
  floorSel = p.id;
  saveFloor();
}

function floorTool(e) {
  const b = e.target.closest('[data-fp]'), act = b?.dataset.fp, fl = floor(), p = fl.find(x => x.id === floorSel);
  if (act === 'add') return openMenu(b, [2, 4, 6, 8].map(s => ({ label: `${s} seats`, run: () => addTable(s) })));
  if (!act || !p) return;
  if (act === 'less' || act === 'more') p.seats = Math.min(12, Math.max(1, p.seats + (act === 'more' ? 1 : -1)));
  if (act === 'turn') p.rot = ((p.rot || 0) + 90) % 180;
  if (act === 'remove') {
    if (tableOrder(p.name)) return showToast(`Table ${p.name} has an order`);
    fl.splice(fl.indexOf(p), 1); floorSel = '';
  }
  keepIn(p);
  saveFloor();
}

// Half a table's footprint with its chairs (76 deep), turned or not.
const half = p => (p.rot || 0) % 180 ? [38, tableW(p) / 2] : [tableW(p) / 2, 38];
function keepIn(p) {
  const [hw, hh] = half(p);
  p.x = Math.min(ROOM[0] - hw, Math.max(hw, p.x));
  p.y = Math.min(ROOM[1] - hh, Math.max(hh, p.y));
}
// A new table goes in the first gap (top-left first), else the middle.
function placeFree(p) {
  const [hw, hh] = half(p), others = floor().map(o => [o, half(o)]);
  for (let y = hh + 10; y <= ROOM[1] - hh - 10; y += 10) for (let x = hw + 10; x <= ROOM[0] - hw - 10; x += 10)
    if (others.every(([o, [ow, oh]]) => Math.abs(o.x - x) >= hw + ow + 10 || Math.abs(o.y - y) >= hh + oh + 10)) return Object.assign(p, { x, y });
}

// Arrange: press a table to pick it, drag to move it (snaps to 10, stays in the room). Saved when let go.
function floorDown(e) {
  const svg = e.target.closest('svg.editing');
  if (!svg) return;
  const g = e.target.closest('[data-pid]'), p = g && floor().find(x => x.id === g.dataset.pid);
  floorSel = p?.id || '';
  svg.querySelectorAll('.fp').forEach(x => x.classList.toggle('sel', x === g));
  renderFloorTools();
  if (!p) return;
  e.preventDefault();
  const at = ev => new DOMPoint(ev.clientX, ev.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const s = at(e), x0 = p.x, y0 = p.y, snap = v => Math.round(v / 10) * 10;
  let moved = false;
  svg.setPointerCapture(e.pointerId);
  const move = ev => {
    const c = at(ev);
    p.x = snap(x0 + c.x - s.x); p.y = snap(y0 + c.y - s.y);
    keepIn(p);
    moved ||= p.x !== x0 || p.y !== y0;
    g.setAttribute('transform', `translate(${p.x} ${p.y})`);
  };
  const up = () => {
    svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
    if (moved) saveSettings();
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
}

// A table tapped. In Sell's Dine-in panel (`sheet`): a cart goes on it; an empty cart opens its order to add to.
// On the Tables page: a busy table shows its order (not while arranging).
function tableTap(n, sheet) {
  if (floorEdit && !sheet) return;
  const d = tableOrder(n);
  if (sheet && state.cart.length) return putOnTable(n);
  if (sheet && d) { closeEditSheet(); return continueDraft(d.id); }
  if (d) return openTableOrder(n);
  showToast(sheet ? 'Add items first' : `Table ${n} is free`);
}

// The cart onto table n, then a clean cart. A busy table keeps its order and gets these lines too (the same plain
// item adds up); the cart's own table (Add items) is just updated. Coming from another table = it moves.
function putOnTable(n) {
  const here = tableOrder(n), was = state.savedId;
  if (here && here.id !== was) {
    const lines = todayLines(here.items).lines.map(l => ({ ...l })), plain = i => !i.discount && !i.note;
    for (const i of state.cart) {
      const same = plain(i) && lines.find(l => l.id === i.id && plain(l));
      if (same) same.qty += i.qty; else lines.push(i);
    }
    state.cart = lines;
    state.savedId = here.id;   // saveDraft updates it, keeping when they sat
  }
  state.fulfilment = 'dinein';
  try {
    const row = saveDraft('table', n), total = tableTotal(row);
    if (was && was !== row.id) dropDraft(was);   // the saved cart or table it came from is now this table
    track('table_send', { table: n, lines: row.items.length });
    clearCart();
    if (state.view === 'tables') renderTables();
    showToast(`Table ${n} · ${peso(total)}`);
  } catch (err) {
    console.error(err);
    showToast('Order was not put on the table. Check browser storage.');
  }
}

// A busy table's order, centred like the cart ⋯'s forms (openCartForm): the lines, the total, three actions.
function openTableOrder(n) {
  const d = tableOrder(n), cur = state.settings.store?.currency;
  if (!d) return;
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<div class="pay-sheet tb-sheet" role="dialog" aria-label="Table ${n}">
    <div class="ph"><b>Table ${n}</b><small>Seated ${seatedFor(d)}${d.customer ? ` · ${escapeHtml(d.customer.name)}` : ''}</small></div>
    <div class="tb-lines">${(d.items || []).map(i => `<div><span>${i.qty} × ${escapeHtml(i.name)}</span><span class="num">${
      peso(SalesMath.lineMoney(i.price, i.qty, i.discount, cur).lineTotal)}</span></div>`).join('')}</div>
    <div class="tb-tot"><span>Total</span><b class="num">${peso(tableTotal(d))}</b></div>
    <div class="pb"><button type="button" class="secondary-btn small" data-add>Add items</button><button type="button" class="secondary-btn small" data-bill>Print bill</button><button type="button" class="primary-btn small" data-pay>Check out</button></div>
  </div>`;
  const f = veil.firstChild;
  f.style.width = Math.min(360, innerWidth - 24) + 'px';
  document.body.append(veil);
  const shrink = centreSheet(f);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { document.removeEventListener('keydown', onKey, true); veil.style.pointerEvents = 'none'; shrink(() => veil.remove()); };
  document.addEventListener('keydown', onKey, true);
  veil.addEventListener('click', (e) => {
    const el = q => e.target.closest(q);
    if (e.target === veil) return close();
    if (el('[data-bill]')) return printOrder(draftAsOrder(d));   // the draft's slip: no number, not a receipt
    if (el('[data-add]')) { close(); return continueDraft(d.id); }
    if (el('[data-pay]')) { close(); return continueDraft(d.id, openPaymentModal); }
  });
}
