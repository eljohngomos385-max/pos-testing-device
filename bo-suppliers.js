/* ==========================================================
   Back office — Suppliers + purchase orders.
   Renders .view[data-view="suppliers"] whole; see CONTRACT.md.

   A purchase order is stock coming IN from a supplier. It is not
   orders.delivery, which is a customer's order going out. This page owns only
   the first, and receiving one is the only thing here that touches stock —
   always through receivePo() so the movement log keeps its reason.
   ========================================================== */

// The rules this page decides by, outside the view so scripts/suppliers-check.mjs can load them.
// They read bo-model.js globals (PO_INCOMING) at call time.
const SUP_RULES = {
  // The supplier's word beats our own guess once they have given one.
  dueDate: (po) => po.promisedAt || po.expectedAt || '',
  isOverdue: (po, today) => {
    const due = SUP_RULES.dueDate(po);
    return !!due && due < today && PO_INCOMING.indexOf(po.status) >= 0;
  },
  // Receiving fewer than are still to come is a short ship, and only then is a reason asked for.
  isShort: (line, now) =>
    (Number(now) || 0) < Math.max(0, (Number(line.qty) || 0) - (Number(line.receivedQty) || 0)),
  // Local calendar day of a 'YYYY-MM-DD' or an ISO stamp, so a receipt at 7am Manila is not yesterday.
  dayKey: (v) => {
    const s = String(v || '');
    if (s.length === 10) return s;
    const d = new Date(s);
    return isNaN(d) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
  // What the supplier actually takes, sent (or drafted, before sentAt existed) to fully received.
  // ponytail: a plain average over received POs; spread and fill rate live in bo-insights.js.
  realLead: (pos, supplierId) => {
    const days = pos.filter((o) => o.supplierId === supplierId && o.status === 'received' && o.receivedAt)
      .map((o) => {
        const from = SUP_RULES.dayKey(o.sentAt || o.orderedAt), to = SUP_RULES.dayKey(o.receivedAt);
        return from && to ? (Date.parse(to + 'T00:00Z') - Date.parse(from + 'T00:00Z')) / 864e5 : NaN;
      })
      .filter((d) => d >= 0);
    return { n: days.length, avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length * 10) / 10 : 0 };
  },
};
if (typeof module !== 'undefined') module.exports = SUP_RULES;

if (typeof document !== 'undefined') (function () {
  const VIEW = 'suppliers';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  // Reloaded at the top of every render; handlers mutate these and save them back.
  let suppliers = [];
  let pos = [];
  let prodById = new Map();
  let labelIndex = new Map();   // "SKU — Name" -> product, for the datalist picker

  const PO_TONE = { draft: 'muted', ordered: 'ok', partial: 'warn', received: 'muted', cancelled: 'danger' };
  const isIncoming = (o) => PO_INCOMING.indexOf(o.status) >= 0;
  const todayIso = () => isoDate(Date.now());
  const esc = (v) => escapeHtml(v == null ? '' : v);
  const dash = (v) => (v ? esc(v) : '—');

  // poOutstanding counts units; the tables want the money still to arrive.
  const poOutValue = (po) => unc((po.items || []).reduce(
    (s, l) => s + cent(l.cost) * Math.max(0, (Number(l.qty) || 0) - (Number(l.receivedQty) || 0)), 0));
  const lineOut = (l) => Math.max(0, (Number(l.qty) || 0) - (Number(l.receivedQty) || 0));
  const lineTotal = (l) => unc(cent(l.cost) * (Number(l.qty) || 0));

  // Codes are what gets stored; the labels are only what the select prints.
  const SHORT_REASONS = { 'supplier-out-of-stock': 'Out of stock at supplier', damaged: 'Damaged',
    'wrong-item': 'Wrong item', 'partial-ship': 'Partial ship', other: 'Other' };
  // Monday first — a shop's week does not start on Sunday. The stored value is still 0 = Sunday.
  const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

  const statusPill = (s) => `<span class="status-pill ${PO_TONE[s] || 'muted'}">${esc(PO_STATUS[s] || s)}</span>`;
  const productLabel = (p) => (p.sku ? p.sku + ' — ' : '') + (p.name || '');

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(String(iso).slice(0, 10) + 'T00:00');
    return isNaN(d) ? esc(iso) : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ---------- One pass over products and POs, reused by every table ---------- */
  function aggregate() {
    const byId = new Map(suppliers.map((s) => [s.id, s]));
    prodById = new Map();
    const prod = new Map();   // supplierId -> { n, value, items }
    for (const p of state.products) {
      if (p.id) prodById.set(p.id, p);
      if (p.archived) continue;
      // One product, several suppliers: it appears in each of their lists. The counts
      // and values then overlap between suppliers, which is the point - each line reads
      // "what this supplier can sell us", not a slice of the warehouse.
      const ids = supplierIdsOf(p);
      for (const k of (ids.length ? ids : [''])) {
        let a = prod.get(k);
        if (!a) prod.set(k, (a = { n: 0, value: 0, items: [] }));
        a.n += 1;
        a.value += stockValue(p);
        a.items.push(p);
      }
    }
    const po = new Map();     // supplierId -> { open, outstanding, list }
    for (const o of pos) {
      const k = o.supplierId || '';
      let a = po.get(k);
      if (!a) po.set(k, (a = { open: 0, outstanding: 0, list: [] }));
      a.list.push(o);
      if (isIncoming(o)) { a.open += 1; a.outstanding += poOutValue(o); }
    }
    // Measured from received POs (bo-insights.js); was the Supplier lead times tab until 2026-09-23.
    const lead = new Map(HWPOS_INSIGHTS.supplierLeadTimes(pos, suppliers).map((r) => [r.supplierId, r]));
    return { byId, prod, po, lead };
  }

  const EMPTY_P = { n: 0, value: 0, items: [] };
  const EMPTY_O = { open: 0, outstanding: 0, list: [] };

  /* ---------- Shared chrome ---------- */
  const head = (title, actions) => `
    <header class="view-head">
      <div class="view-title-wrap"><h1>${title}</h1></div>
      <div class="view-actions">${actions}</div>
    </header>`;

  const searchBox = (ph) =>
    `<input class="search-input small q-input" data-keep="q" type="search" placeholder="${ph}" value="${esc(state.invQuery)}">`;

  // A flush card is always a table card here, so flush tags it blk-table.
  const card = (label, sub, body, flush, pager = '') => `
    <div class="bo-card${flush ? ' blk-table' : ''}">
      <div class="bo-card-head"><span class="bo-card-label">${label}</span>${sub ? `<span class="bo-card-sub">${sub}</span>` : ''}</div>
      <div class="bo-card-inset${flush ? ' flush' : ''}">${body}${pager}</div>
    </div>`;

  const table = (heads, rows, cols, empty) => `
    <table class="data-table">
      <thead><tr>${heads}</tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols}" class="bo-empty">${empty}</td></tr>`}</tbody>
    </table>`;

  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).suppliers = { param: 'tab', def: 'suppliers', items: [['suppliers', 'Suppliers'], ['orders', 'Purchase orders']] };

  /* ---------- Tab 1: suppliers ---------- */
  function supplierList(agg, params) {
    const q = (state.invQuery || '').trim().toLowerCase();
    const list = q
      ? suppliers.filter((s) => [s.name, s.contact, s.phone, s.email].join(' ').toLowerCase().includes(q))
      : suppliers;

    const pg = paginate(list, params.page);
    const rows = pg.rows.map((s) => {
      const p = agg.prod.get(s.id) || EMPTY_P;
      const o = agg.po.get(s.id) || EMPTY_O;
      const l = agg.lead.get(s.id) || {};
      const days = l.leadDaysMean == null ? null : Math.round(l.leadDaysMean);
      return `
        <tr data-go="${esc(s.id)}">
          <td><strong>${dash(s.name)}</strong>${s.contact ? `<span class="row-sub">${esc(s.contact)}</span>` : ''}</td>
          <td>${dash(s.phone)}</td>
          <td>${dash(s.email)}</td>
          <td class="num">${p.n}</td>
          <td class="num">${pesoShort(p.value)}</td>
          <td class="num">${o.open || '—'}</td>
          <td class="num">${o.outstanding ? pesoShort(o.outstanding) : '—'}</td>
          <td class="num">${days == null ? '—' : `${days} day${days === 1 ? '' : 's'}`}</td>
          <td class="num">${l.onTimeRate == null ? '—' : Math.round(l.onTimeRate * 100) + '%'}</td>
          <td class="sup-note muted-sub">${dash(s.note)}</td>
        </tr>`;
    }).join('');

    return head(
      'Suppliers',
      `<button class="secondary-btn small" data-act="export-suppliers">Export CSV</button>
       <button class="primary-btn small" data-act="new-supplier">Add supplier</button>`
    ) + `
    <div class="list-filters">${searchBox('Search suppliers')}</div>
    <div class="dash-stack">${card('All suppliers', `${list.length} shown`, table(
      `<th>Supplier</th><th>Phone</th><th>Email</th><th class="num">Products</th><th class="num">On hand at cost</th>
       <th class="num">Open POs</th><th class="num">Outstanding</th>
       <th class="num" title="Average days from sending a PO to receiving it">Delivers in</th>
       <th class="num" title="Received on or before the promised date">On time</th><th>Note</th>`,
      rows, 10, q ? 'No supplier matches that search.' : 'No suppliers yet. Add one to start raising purchase orders.'
    ), true, pagerHtml(pg))}</div>`;
  }

  /* ---------- Tab 2: purchase orders ---------- */
  const STATUS_FILTERS = [['', 'All statuses'], ['incoming', 'Incoming']]
    .concat(Object.keys(PO_STATUS).map((k) => [k, PO_STATUS[k]]));

  function poList(agg, params) {
    const q = (state.invQuery || '').trim().toLowerCase();
    const st = params.status || '';
    const sup = params.supplier || '';

    const list = pos.filter((o) => {
      if (sup && o.supplierId !== sup) return false;
      if (st === 'incoming' ? !isIncoming(o) : st && o.status !== st) return false;
      if (!q) return true;
      const s = agg.byId.get(o.supplierId);
      return [o.number, s && s.name, o.note].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    // The lineup first — what is coming, soonest expected at the top.
    const rank = (o) => (isIncoming(o) ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0
      ? (SUP_RULES.dueDate(a) || '9999').localeCompare(SUP_RULES.dueDate(b) || '9999')
      : String(b.orderedAt || '').localeCompare(String(a.orderedAt || ''))));

    const today = todayIso();
    const pg = paginate(list, params.page);
    const rows = pg.rows.map((o) => {
      const s = agg.byId.get(o.supplierId);
      const late = SUP_RULES.isOverdue(o, today);
      const out = poOutValue(o);
      return `
        <tr data-go="${esc(o.id)}">
          <td><strong>${dash(o.number)}</strong></td>
          <td>${s ? esc(s.name) : '<span class="muted-sub">Unassigned</span>'}</td>
          <td>${statusPill(o.status)}</td>
          <td>${fmtDate(o.orderedAt)}</td>
          <td class="${late ? 'sup-overdue' : ''}">${fmtDate(SUP_RULES.dueDate(o))}${late ? ' · overdue' : ''}</td>
          <td class="num">${(o.items || []).length}</td>
          <td class="num">${peso(poTotal(o))}</td>
          <td class="num">${out ? peso(out) : '—'}</td>
        </tr>`;
    }).join('');

    const opts = (sel, pairs) => pairs.map(([v, l]) =>
      `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');

    return head(
      'Purchase orders',
      `<button class="primary-btn small" data-act="new-po">New purchase order</button>`
    ) + `<div class="list-filters">
      ${searchBox('Search purchase orders')}
      <select class="bo-select" data-filter="status">${opts(st, STATUS_FILTERS)}</select>
      <select class="bo-select" data-filter="supplier">${opts(sup, [['', 'All suppliers']].concat(suppliers.map((s) => [s.id, s.name || 'Unnamed'])))}</select>
    </div>
    <div class="dash-stack">${card('Purchase orders', `${list.length} shown`, table(
      `<th>PO</th><th>Supplier</th><th>Status</th><th>Ordered</th><th>Due</th>
       <th class="num">Lines</th><th class="num">Total</th><th class="num">Outstanding</th>`,
      rows, 8, pos.length ? 'No purchase order matches these filters.' : 'No purchase orders yet.'
    ), true, pagerHtml(pg))}</div>`;
  }

  /* ---------- Supplier detail ---------- */
  const field = (label, key, value, type) =>
    `<div class="setting-row"><label>${label}</label>
      <input class="text-input" type="${type || 'text'}"${type === 'number' ? ' min="0"' : ''} data-field="${key}" value="${esc(value)}"></div>`;

  function supplierDetail(s, agg) {
    const p = agg.prod.get(s.id) || EMPTY_P;
    const o = agg.po.get(s.id) || EMPTY_O;
    const lead = SUP_RULES.realLead(pos, s.id);
    const days = (s.orderDays || []).map(Number);

    const products = p.items.map((x) => `
      <tr data-product="${esc(x.id)}">
        <td><strong>${esc(x.name)}</strong><span class="row-sub">${esc(x.sku || '')}</span></td>
        <td class="num">${x.stock} ${esc(x.unit || '')}</td>
        <td class="num">${peso(x.cost)}</td>
        <td class="num">${peso(stockValue(x))}</td>
      </tr>`).join('');

    const orders = o.list.slice().sort((a, b) =>
      String(b.orderedAt || '').localeCompare(String(a.orderedAt || ''))).map((x) => `
      <tr data-go="${esc(x.id)}">
        <td><strong>${dash(x.number)}</strong></td>
        <td>${statusPill(x.status)}</td>
        <td>${fmtDate(SUP_RULES.dueDate(x))}</td>
        <td class="num">${peso(poTotal(x))}</td>
      </tr>`).join('');

    return `
      <div class="view-head">
        <div class="view-title-wrap">
          <button class="link-btn" data-act="back-suppliers">← Suppliers</button>
          <h1 data-live="name">${dash(s.name)}</h1>
          <span class="muted">${p.n} product${p.n === 1 ? '' : 's'} · ${pesoShort(p.value)} on hand at cost · ${o.open} incoming</span>
        </div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="new-po">New purchase order</button>
        </div>
      </div>
      <div class="dash-stack">
        ${card('Details', 'Saved as you leave each field', `<div class="settings-grid">
          ${field('Name', 'name', s.name)}
          ${field('Contact person', 'contact', s.contact)}
          ${field('Phone', 'phone', s.phone, 'tel')}
          ${field('Email', 'email', s.email, 'email')}
          ${field('Address', 'address', s.address)}
          ${field('Note', 'note', s.note)}
          <div class="setting-row"><label>Order days</label>
            <div class="seg">${WEEK.map(([d, l]) =>
              `<button class="seg-btn${days.indexOf(d) >= 0 ? ' active' : ''}" data-act="order-day" data-day="${d}">${l}</button>`).join('')}</div></div>
          ${field('Minimum order (₱)', 'minOrder', s.minOrder, 'number')}
          <div class="setting-row"><label>Quoted lead days${lead.n
            ? `<span class="sup-hint">actually ${lead.avgDays} day${lead.avgDays === 1 ? '' : 's'} · ${lead.n} received PO${lead.n === 1 ? '' : 's'}</span>` : ''}</label>
            <input class="text-input" type="number" min="0" data-field="quotedLeadDays" value="${esc(s.quotedLeadDays)}"></div>
        </div>`)}
        ${card('Products from this supplier', `${p.n}`, table(
          '<th>Product</th><th class="num">On hand</th><th class="num">Cost</th><th class="num">Value</th>',
          products, 4, 'No product is assigned to this supplier yet.'), true)}
        ${card('Purchase orders', `${o.list.length}`, table(
          '<th>PO</th><th>Status</th><th>Due</th><th class="num">Total</th>',
          orders, 4, 'No purchase orders for this supplier yet.'), true)}
      </div>`;
  }

  /* ---------- PO editor ---------- */
  function poEditor(po, agg) {
    const s = agg.byId.get(po.supplierId);
    const items = po.items || [];
    // Once anything has landed the quantities are history — a correction is a
    // new PO or another receipt, never a rewrite of what was ordered.
    const canEdit = (po.status === 'draft' || po.status === 'ordered') && !items.some((l) => Number(l.receivedQty) > 0);
    const receiving = isIncoming(po);

    labelIndex = new Map();
    const options = state.products.filter((p) => !p.archived).map((p) => {
      const label = productLabel(p);
      if (!labelIndex.has(label)) labelIndex.set(label, p);
      return `<option value="${esc(label)}"></option>`;
    }).join('');

    const lineRow = (l) => {
      const p = prodById.get(l.productId);
      const step = stepFor(p);
      return `<tr data-line="${esc(l.id)}">
        <td>${canEdit
          ? `<input class="text-input" list="supProducts" data-line-field="productId" value="${esc(p ? productLabel(p) : l.productId)}">`
          : `<strong>${esc(p ? p.name : l.productId)}</strong>${p && p.sku ? `<span class="row-sub">${esc(p.sku)}</span>` : ''}`}</td>
        <td class="num">${canEdit
          ? `<input class="text-input mini" type="number" min="0" step="${step}" data-line-field="qty" value="${l.qty}">`
          : l.qty}</td>
        <td class="num">${canEdit
          ? `<input class="text-input mini" type="number" min="0" step="0.01" data-line-field="cost" value="${l.cost}">`
          : peso(l.cost)}</td>
        <td class="num" data-line-total>${peso(lineTotal(l))}</td>
        <td class="num">${l.receivedQty || 0}</td>
        <td class="num">${canEdit ? '<button class="link-btn" data-act="remove-line">Remove</button>' : ''}</td>
      </tr>`;
    };

    const lines = items.map(lineRow).join('') + (canEdit ? `
      <tr class="sup-add"><td colspan="6">
        <input class="text-input" list="supProducts" data-act="add-line" placeholder="Add a product…">
      </td></tr>` : '');

    const recvRow = (l) => {
      const p = prodById.get(l.productId);
      const out = lineOut(l);
      return `<tr data-line="${esc(l.id)}">
        <td><strong>${esc(p ? p.name : l.productId)}</strong></td>
        <td class="num">${l.qty}</td>
        <td class="num">${l.receivedQty || 0}</td>
        <td class="num" data-out="${esc(l.id)}">${out}</td>
        <td class="num">
          <input class="text-input mini" type="number" min="0" step="${stepFor(p)}" data-recv="${esc(l.id)}" value="${out}">
          <div class="sup-warn" hidden>more than ordered</div>
        </td>
        <td class="num"><input class="text-input mini" type="number" min="0" step="0.01" data-invoice
          placeholder="${esc(l.cost)}" title="What the supplier billed per unit. Blank = the quoted cost."></td>
        <td><select class="bo-select" data-short hidden><option value="">Why short?</option>${Object.keys(SHORT_REASONS)
          .map((k) => `<option value="${k}">${SHORT_REASONS[k]}</option>`).join('')}</select></td>
      </tr>`;
    };

    const actions = [
      canEdit && po.supplierId ? '<button class="secondary-btn small" data-act="add-low">Add low stock items</button>' : '',
      po.status === 'draft' ? '<button class="primary-btn small" data-act="mark-ordered">Mark ordered</button>' : '',
      receiving ? '<button class="primary-btn small" data-act="receive">Receive delivery</button>' : '',
      po.status !== 'received' && po.status !== 'cancelled' ? '<button class="secondary-btn small danger" data-act="cancel-po">Cancel PO</button>' : '',
      '<button class="secondary-btn small" data-act="export-po">Export CSV</button>',
    ].join('');

    const supOptions = [['', 'Unassigned']].concat(suppliers.map((x) => [x.id, x.name || 'Unnamed']))
      .map(([v, l]) => `<option value="${esc(v)}"${v === po.supplierId ? ' selected' : ''}>${esc(l)}</option>`).join('');

    return `
      <datalist id="supProducts">${options}</datalist>
      <div class="view-head">
        <div class="view-title-wrap">
          <button class="link-btn" data-act="back-orders">← Purchase orders</button>
          <h1 data-live="number">${dash(po.number)}</h1>
          <span class="muted"><span data-live="supplier">${s ? esc(s.name) : 'Unassigned'}</span> · ${statusPill(po.status)}
            ${po.sentAt ? ` · sent ${fmtDate(SUP_RULES.dayKey(po.sentAt))}` : ''}
            ${po.receivedAt ? ` · received ${fmtDate(SUP_RULES.dayKey(po.receivedAt))}` : ''}</span>
        </div>
        <div class="view-actions">${actions}</div>
      </div>
      <div class="dash-stack">
        ${card('Details', canEdit ? 'Saved as you leave each field' : 'Locked — this order has started arriving', `<div class="settings-grid">
          <div class="setting-row"><label>Supplier</label>
            <select class="bo-select" data-field="supplierId">${supOptions}</select></div>
          ${field('PO number', 'number', po.number)}
          <div class="setting-row"><label>Ordered</label>
            <input class="bo-date" type="date" data-field="orderedAt" value="${esc(po.orderedAt)}"></div>
          <div class="setting-row"><label>Expected</label>
            <input class="bo-date" type="date" data-field="expectedAt" value="${esc(po.expectedAt)}"></div>
          <div class="setting-row"><label>Supplier promised</label>
            <input class="bo-date" type="date" data-field="promisedAt" value="${esc(po.promisedAt)}"></div>
          <div class="setting-row"><label>Sent on</label>
            <input class="bo-date" type="date" data-sent-on max="${esc(todayIso())}"
              value="${esc(po.sentAt ? isoDate(po.sentAt) : todayIso())}"></div>
          ${field('Note', 'note', po.note)}
        </div>`)}
        ${card('Lines', `${items.length} line${items.length === 1 ? '' : 's'}`, `
          <table class="data-table">
            <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th>
              <th class="num">Line total</th><th class="num">Received</th><th class="num"></th></tr></thead>
            <tbody>${lines || `<tr><td colspan="6" class="bo-empty">No lines yet.</td></tr>`}</tbody>
            <tfoot><tr><td colspan="3">Total</td><td class="num" data-po-total>${peso(poTotal(po))}</td><td colspan="2"></td></tr></tfoot>
          </table>`, true)}
        ${receiving ? card('Receiving', 'Writes a delivery movement per line', `
          <table class="data-table">
            <thead><tr><th>Product</th><th class="num">Ordered</th><th class="num">Received</th>
              <th class="num">Still to come</th><th class="num">Receiving now</th><th class="num">Invoice cost</th><th>Short reason</th></tr></thead>
            <tbody>${items.map(recvRow).join('') || `<tr><td colspan="7" class="bo-empty">No lines to receive.</td></tr>`}</tbody>
          </table>
          <div class="sup-recv-foot">
            <label class="adj-field sup-arrived"><span>Arrived on</span>
              <input class="bo-date" type="date" id="supArrivedOn" value="${esc(isoDate(Date.now()))}" max="${esc(isoDate(Date.now()))}"></label>
            <button class="secondary-btn small" data-act="fill-all">Fill all lines</button></div>`, true) : ''}
      </div>`;
  }

  /* ---------- Render ---------- */
  // Typing in the search box rewrites the URL, which re-renders this whole view;
  // without this the input would lose focus after every keystroke.
  function focusKey(el) {
    const a = document.activeElement;
    if (!a || !el.contains(a) || !a.dataset.keep) return null;
    let pos = null;
    try { pos = a.selectionStart; } catch (_) {}
    return { key: a.dataset.keep, pos };
  }
  function restoreFocus(el, k) {
    if (!k) return;
    const next = el.querySelector(`[data-keep="${k.key}"]`);
    if (!next) return;
    next.focus();
    if (k.pos != null) { try { next.setSelectionRange(k.pos, k.pos); } catch (_) {} }
  }

  window.renderSuppliers = function () {
    const el = root();
    if (!el) return;
    suppliers = loadSuppliers();
    pos = loadPurchaseOrders();
    const agg = aggregate();
    const { params } = Router.route();
    const keep = focusKey(el);

    const id = state.detailId;
    if (id) {
      const po = pos.find((o) => o.id === id);
      const sup = po ? null : suppliers.find((s) => s.id === id);
      el.innerHTML = po ? poEditor(po, agg)
        : sup ? supplierDetail(sup, agg)
        : `<div class="bo-card blk-empty"><div class="bo-empty">That record no longer exists. <button class="link-btn" data-act="back-suppliers">Back to suppliers</button></div></div>`;
    } else {
      el.innerHTML = params.tab === 'orders' ? poList(agg, params) : supplierList(agg, params);
    }
    restoreFocus(el, keep);
  };

  /* ---------- Writes ---------- */
  const currentPo = () => pos.find((o) => o.id === state.detailId) || null;
  const currentSupplier = () => suppliers.find((s) => s.id === state.detailId) || null;

  function saveAndRepaint(po) {
    if (po) po.updatedAt = new Date().toISOString();
    savePurchaseOrders(pos);
    refreshSharedState();
    renderCurrentView();
  }

  function nextPoNumber() {
    let max = 0;
    for (const o of pos) {
      const m = /(\d+)\s*$/.exec(o.number || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    return 'PO-' + String(max + 1).padStart(4, '0');
  }

  function newPo(supplierId) {
    if (!suppliers.length) return showToast('Add a supplier first');
    const po = {
      ...PO_DEFAULTS,
      id: newId('po'),
      supplierId: supplierId || suppliers[0].id,
      number: nextPoNumber(),
      status: 'draft',
      orderedAt: todayIso(),
      items: [],
      updatedAt: new Date().toISOString(),
    };
    pos.push(po);
    savePurchaseOrders(pos);
    Router.go(VIEW, po.id, {}, { replace: false });
  }

  // The one path that moves stock. receivePo stamps reason/refId/unitCost; we only
  // apply what it returns to the cached product.stock and append the log.
  function receive(po, map, notes, arrivedOn) {
    const movements = receivePo(po, map, arrivedOn);
    if (!movements.length) return showToast('Nothing to receive');
    // receivePo writes one movement per line with qty > 0, in line order, so they pair back up.
    const got = (po.items || []).filter((l) => (Number(map[l.id]) || 0) > 0);
    (po.items || []).forEach((l) => { if ((notes[l.id] || {}).shortReason) l.shortReason = notes[l.id].shortReason; });
    got.forEach((l, i) => {
      const inv = (notes[l.id] || {}).invoiceCost;
      if (inv == null) return;
      // ponytail: the line keeps the latest bill; each delivery's own bill is its movement's unitCost,
      // which is what was actually paid, so Inventory → Cost changes sees the invoice, not the quote.
      l.invoiceCost = inv;
      movements[i].unitCost = inv;
    });
    let units = 0;
    movements.forEach((m) => {
      const p = prodById.get(m.productId);
      if (p) applyMovement(p, m);
      units += m.qty;
    });
    appendMovements(movements);
    saveProducts();
    saveAndRepaint(po);
    showToast(`Received ${units} unit${units === 1 ? '' : 's'} on ${po.number || 'this PO'}`);
  }

  // Read before receivePo runs: shortness is judged against what was still to come.
  function collectReceipt(el, po) {
    const map = {}, notes = {};
    let bad = '';
    el.querySelectorAll('[data-recv]').forEach((input) => {
      const id = input.dataset.recv;
      const row = input.closest('[data-line]');
      const raw = input.value.trim();
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) { bad = 'Receive quantity cannot be negative'; return; }
      if (n > 0) map[id] = n;
      const invRaw = row.querySelector('[data-invoice]').value.trim();
      const inv = invRaw === '' ? null : Number(invRaw);
      if (inv != null && (!Number.isFinite(inv) || inv < 0)) { bad = 'Invoice cost cannot be negative'; return; }
      const line = (po.items || []).find((l) => l.id === id);
      notes[id] = {
        invoiceCost: inv == null ? null : round2(inv),
        shortReason: line && SUP_RULES.isShort(line, n) ? row.querySelector('[data-short]').value : '',
      };
    });
    if (bad) { showToast(bad); return null; }
    return { map, notes };
  }

  /* ---------- CSV ---------- */
  function exportSuppliers(agg) {
    const rows = [['name', 'contact', 'phone', 'email', 'address', 'note', 'products', 'stock_value', 'open_pos', 'outstanding']];
    suppliers.forEach((s) => {
      const p = agg.prod.get(s.id) || EMPTY_P;
      const o = agg.po.get(s.id) || EMPTY_O;
      rows.push([s.name, s.contact, s.phone, s.email, s.address, s.note, p.n, round2(p.value), o.open, round2(o.outstanding)]);
    });
    downloadCsv('suppliers.csv', rows);
  }

  function exportPo(po) {
    const s = suppliers.find((x) => x.id === po.supplierId);
    const rows = [['po_number', 'supplier', 'status', 'ordered_at', 'expected_at', 'sku', 'product', 'qty', 'unit_cost', 'line_total', 'received_qty',
      'sent_at', 'promised_at', 'invoice_unit_cost', 'short_reason']];
    (po.items || []).forEach((l) => {
      const p = prodById.get(l.productId);
      rows.push([po.number, s ? s.name : '', po.status, po.orderedAt, po.expectedAt,
        p ? p.sku : '', p ? p.name : l.productId, l.qty, l.cost, lineTotal(l), l.receivedQty || 0,
        po.sentAt || '', po.promisedAt || '', l.invoiceCost == null ? '' : l.invoiceCost, l.shortReason || '']);
    });
    downloadCsv(`${po.number || 'purchase-order'}.csv`, rows);
  }

  /* ---------- Events: one delegated listener per type ---------- */
  document.addEventListener('click', (e) => {
    const el = root();
    if (!el || el.hidden) return;
    const hit = e.target.closest('[data-act], [data-go], [data-product]');
    if (!hit || !el.contains(hit)) return;

    if (hit.dataset.go) return Router.go(VIEW, hit.dataset.go, {}, { replace: false });
    if (hit.dataset.product) return Router.go('products', hit.dataset.product, {}, { replace: false });

    const po = currentPo();
    switch (hit.dataset.act) {
      case 'back-suppliers': return Router.go(VIEW, '', {});
      case 'back-orders': return Router.go(VIEW, '', { tab: 'orders' });
      case 'export-suppliers': return exportSuppliers(aggregate());
      case 'export-po': return po && exportPo(po);
      case 'new-supplier': {
        const s = { ...SUPPLIER_DEFAULTS, id: newId('sup'), name: 'New supplier' };
        suppliers.push(s);
        saveSuppliers(suppliers);
        return Router.go(VIEW, s.id, {}, { replace: false });
      }
      case 'new-po': return newPo(currentSupplier()?.id || Router.route().params.supplier);
      case 'add-low': {
        if (!po) return;
        const have = new Set((po.items || []).map((l) => l.productId));
        const add = lowStockLines(po.supplierId).filter(({ p }) => !have.has(p.id));
        if (!add.length) return showToast('No low stock items from this supplier to add');
        po.items = (po.items || []).concat(add.map(({ p, qty }) => poLine(p.id, qty, p.cost)));
        saveAndRepaint(po);
        return showToast(`Added ${add.length} low stock item${add.length === 1 ? '' : 's'}`);
      }
      case 'remove-line': {
        const row = hit.closest('[data-line]');
        if (!po || !row) return;
        po.items = po.items.filter((l) => l.id !== row.dataset.line);
        return saveAndRepaint(po);
      }
      case 'mark-ordered': {
        if (!po) return;
        if (!(po.items || []).length) return showToast('Add at least one line first');
        po.status = 'ordered';
        po.orderedAt = po.orderedAt || todayIso();
        if (!po.sentAt) {                                    // orderedAt is the draft's date; this is the send
          const day = el.querySelector('[data-sent-on]')?.value || todayIso();
          po.sentAt = day === todayIso() ? new Date().toISOString() : new Date(day + 'T12:00:00').toISOString();
        }
        return saveAndRepaint(po);
      }
      case 'order-day': {
        const s = currentSupplier();
        if (!s) return;
        hit.classList.toggle('active');   // in place, so focus and scroll stay put
        s.orderDays = [...hit.parentNode.querySelectorAll('.seg-btn.active')].map((b) => Number(b.dataset.day)).sort();
        s.updatedAt = new Date().toISOString();
        return saveSuppliers(suppliers);
      }
      case 'cancel-po': {
        if (!po || !confirm(`Cancel ${po.number || 'this purchase order'}?`)) return;
        po.status = 'cancelled';
        saveAndRepaint(po);
        return showToast('Purchase order cancelled');
      }
      case 'fill-all':
        return el.querySelectorAll('[data-recv]').forEach((input) => {
          const line = (po && (po.items || []).find((l) => l.id === input.dataset.recv));
          input.value = line ? lineOut(line) : 0;
          input.closest('td').querySelector('.sup-warn').hidden = true;
          input.closest('tr').querySelector('[data-short]').hidden = true;
        });
      case 'receive': {
        if (!po) return;
        const got = collectReceipt(el, po);
        const arrivedOn = el.querySelector('#supArrivedOn')?.value || isoDate(Date.now());
        if (got) receive(po, got.map, got.notes, arrivedOn);
        return;
      }
    }
  });

  document.addEventListener('change', (e) => {
    const el = root();
    if (!el || el.hidden || !el.contains(e.target)) return;
    const t = e.target;

    if (t.dataset.filter) return Router.setParams({ [t.dataset.filter]: t.value, page: '' });

    // When it actually shipped, corrected after the fact — local noon of the chosen day
    // (now, if today), so lead time (sentAt -> receivedAt) reads off the real day, not
    // whatever moment someone happened to tap "Mark ordered".
    if (t.dataset.sentOn !== undefined) {
      const po = currentPo();
      if (!po) return;
      const day = t.value || todayIso();
      po.sentAt = day === todayIso() ? new Date().toISOString() : new Date(day + 'T12:00:00').toISOString();
      saveAndRepaint(po);
      return;
    }

    // Field edits save straight through without a re-render — `change` fires as
    // focus leaves, and repainting here would steal it from the next field.
    if (t.dataset.field) {
      const po = currentPo();
      const rec = po || currentSupplier();
      if (!rec) return;
      // minOrder (pesos) and quotedLeadDays are the only number fields; neither is ever negative.
      if (t.type === 'number') t.value = round2(Math.max(0, Number(t.value) || 0));
      rec[t.dataset.field] = t.type === 'number' ? Number(t.value) : t.value;
      rec.updatedAt = new Date().toISOString();
      if (po) savePurchaseOrders(pos); else saveSuppliers(suppliers);
      const live = el.querySelector(`[data-live="${t.dataset.field === 'supplierId' ? 'supplier' : t.dataset.field}"]`);
      if (live) live.textContent = t.dataset.field === 'supplierId'
        ? ((suppliers.find((s) => s.id === t.value) || {}).name || 'Unassigned')
        : (t.value || '—');
      return;
    }

    if (t.dataset.act === 'add-line') {
      const po = currentPo();
      const p = labelIndex.get(t.value.trim());
      if (!po) return;
      if (!p) { t.value = ''; return showToast('Pick a product from the list'); }
      po.items = (po.items || []).concat([poLine(p.id, 1, p.cost)]);
      return saveAndRepaint(po);
    }

    if (t.dataset.lineField) {
      const po = currentPo();
      const row = t.closest('[data-line]');
      const line = po && (po.items || []).find((l) => l.id === row.dataset.line);
      if (!line) return;
      if (t.dataset.lineField === 'productId') {
        const p = labelIndex.get(t.value.trim());
        if (!p) return showToast('Pick a product from the list');
        line.productId = p.id;
        if (!line.cost) line.cost = p.cost;
        return saveAndRepaint(po);
      }
      const n = Math.max(0, Number(t.value) || 0);
      line[t.dataset.lineField] = t.dataset.lineField === 'qty' ? roundQty(prodById.get(line.productId), n) : round2(n);
      t.value = line[t.dataset.lineField];
      po.updatedAt = new Date().toISOString();
      savePurchaseOrders(pos);
      // Patch the derived cells in place rather than repaint, to keep focus flowing.
      row.querySelector('[data-line-total]').textContent = peso(lineTotal(line));
      el.querySelector('[data-po-total]').textContent = peso(poTotal(po));
      const out = el.querySelector(`[data-out="${line.id}"]`);
      if (out) {
        out.textContent = lineOut(line);
        const input = el.querySelector(`[data-recv="${line.id}"]`);
        if (input) input.value = lineOut(line);
      }
      return;
    }
  });

  // Over-receiving is allowed (suppliers over-ship) but never silent.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.dataset || !t.dataset.recv) return;
    const el = root();
    if (!el || !el.contains(t)) return;
    const po = currentPo();
    const line = po && (po.items || []).find((l) => l.id === t.dataset.recv);
    const warn = t.closest('td').querySelector('.sup-warn');
    if (line && warn) warn.hidden = !(Number(t.value) > lineOut(line));
    const short = t.closest('tr').querySelector('[data-short]');
    if (line && short) short.hidden = !SUP_RULES.isShort(line, t.value);
  });
})();
