/* ==========================================================
   Back office — Suppliers + purchase orders.
   Renders .view[data-view="suppliers"] whole; see CONTRACT.md.

   A purchase order is stock coming IN: one buying list for the whole run, each
   line with its own supplier (owner, 2026-10-02). It is not orders.delivery,
   which is a customer's order going out. Receiving a line is the only thing here
   that touches stock — always through receivePo() so the movement log keeps its reason.
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
  isShort: (line, now) => (Number(now) || 0) < lineOut(line),
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

  const supName = (id) => (suppliers.find((s) => s.id === id) || {}).name || 'Unnamed';
  // A list of one supplier reads as that supplier; a mixed run as how many.
  const poSuppliers = (o) => [...new Set((o.items || []).map((l) => lineSupplier(o, l)))];
  const supCell = (id) => (id ? esc(supName(id)) : '<span class="muted-sub">Unassigned</span>');
  const supplierText = (o) => (poSuppliers(o).length > 1 ? `${poSuppliers(o).length} suppliers` : supCell(poSuppliers(o)[0]));

  // Codes are what gets stored; the labels are only what the select prints.
  const SHORT_REASONS = { 'supplier-out-of-stock': 'Out of stock at supplier', damaged: 'Damaged',
    'wrong-item': 'Wrong item', 'partial-ship': 'Partial ship', other: 'Other' };

  // Received is where every PO ends up: muted text like a Completed sale, so the open and odd ones are the only pills.
  const statusPill = (s) => (s === 'received' ? `<span class="muted">${esc(PO_STATUS[s])}</span>` :`<span class="status-pill ${PO_TONE[s] || 'muted'}">${esc(PO_STATUS[s] || s)}</span>`);
  const productLabel = (p) => (p.sku ? p.sku + ' — ' : '') + (p.name || '');

  // A 'YYYY-MM-DD' or a stamp as Oct 2, 2026, on the store's clock (a 7am Manila receipt is not yesterday).
  const fmtDate = (v) => (v ? esc(shortDate(v)) : '—');
  // A picked send day as a stamp: now when it is today, else the store's noon that day.
  const sentStamp = (day) => new Date(day === todayIso() ? Date.now() : SalesMath.dayStartMs(day, boZone()) + 12 * 36e5).toISOString();

  /* ---------- One pass over products and POs, reused by every table ---------- */
  function aggregate() {
    prodById = new Map(state.products.map((p) => [p.id, p]));
    const prod = new Map();   // supplierId -> { n, value, items: [{ key, name, members, main, value }] }
    // A family is one item, as on Categories. One item, several suppliers: it appears in each of
    // their lists, so values overlap between suppliers -- each reads "what this supplier can sell us".
    for (const it of familyItems()) {
      const ids = new Set(it.members.flatMap(supplierIdsOf));
      for (const k of (ids.size ? ids : [''])) {
        const members = k ? it.members.filter((m) => supplierIdsOf(m).includes(k)) : it.members;
        let a = prod.get(k);
        if (!a) prod.set(k, (a = { n: 0, value: 0, items: [] }));
        const row = { key: it.key, name: it.name, members, main: members.some((m) => m.supplierId === k), value: stockValueOf(members) };
        a.n += 1;
        a.items.push(row);
      }
    }
    // The supplier's total is the same stockValueOf over every item it can sell us.
    prod.forEach((a) => { a.value = stockValueOf(a.items.flatMap((r) => r.members)); });
    // Per LINE supplier: a mixed buying list books each line to whoever it is bought from.
    const po = new Map();     // supplierId -> { open, outC, lines: [{ o, l }] }
    for (const o of pos) {
      const bySup = new Map();
      for (const l of o.items || []) {
        const k = lineSupplier(o, l);
        (bySup.get(k) || bySup.set(k, []).get(k)).push(l);
      }
      bySup.forEach((items, k) => {
        let a = po.get(k);
        if (!a) po.set(k, (a = { open: 0, outC: 0, lines: [] }));
        items.forEach((l) => a.lines.push({ o, l }));
        if (!isIncoming(o) || !items.some(lineOut)) return;
        a.outC += cent(poOpenValue({ ...o, items }));   // this supplier's part of the list
        a.open += 1;
      });
    }
    // Measured from received lines (bo-insights.js); was the Supplier lead times tab until 2026-09-23.
    const lead = new Map(HWPOS_INSIGHTS.supplierLeadTimes(pos, suppliers).map((r) => [r.supplierId, r]));
    return { prod, po, lead };
  }

  const EMPTY_P = { n: 0, value: 0, items: [] };
  const EMPTY_O = { open: 0, outC: 0, lines: [] };
  const daysText = (d) => (d == null ? '—' : d > 0 ? SalesMath.plural(d, 'day') : 'Same day');   // never "Delivers in 0 days"

  /* ---------- Shared chrome ---------- */
  // A record's page takes Categories' header (bo-item.css): the way back above the name, a meta line under it.
  const head = (title, actions, back, meta = '') => (back ? `
    <header class="item-head"><a class="item-back" href="${esc(back[1])}">${esc(back[0])}</a>
      <h1>${title}</h1><div class="view-actions">${actions}</div>${meta && `<div class="item-meta muted">${meta}</div>`}</header>` : `
    <header class="view-head">
      <div class="view-title-wrap"><h1>${title}</h1></div>
      <div class="view-actions">${actions}</div>
    </header>`);

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

  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).suppliers = { param: 'tab', def: 'suppliers',
    items: [['suppliers', 'Suppliers'], ['orders', 'Purchase orders'], ['incoming', 'Incoming']] };

  /* ---------- Tab 1: suppliers ---------- */
  // Columns menu (owner, 2026-09-26), Items' mechanism in backoffice.js; Supplier (the name) always shows.
  const STORAGE_COLS = 'hwpos.bo.supCols';
  const COLUMNS = [['phone', 'Phone'], ['email', 'Email'], ['products', 'Items'], ['value', 'Stock value'],
    ['open', 'Open POs'], ['outstanding', 'Incoming'], ['lead', 'Delivers in']];
  const loadCols = () => loadColPrefs(STORAGE_COLS, COLUMNS, COLUMNS.map(([k]) => k));
  // ?show=: the two reasons to open a supplier -- something to reorder, or something on its way.
  // Archived ones keep their history and drop out of every list but their own.
  const SHOW_FILTERS = [['', 'All suppliers'], ['low', 'Has out or low stock'], ['open', 'Has open POs'], ['archived', 'Archived']];

  function supplierList(agg, params) {
    const q = (state.invQuery || '').trim().toLowerCase();
    const show = params.show || '';
    const list = suppliers.filter((s) => {
      if (!!s.archived !== (show === 'archived')) return false;
      if (show === 'low' && !(agg.prod.get(s.id) || EMPTY_P).items.some((it) => it.members.some(isLow))) return false;
      if (show === 'open' && !(agg.po.get(s.id) || EMPTY_O).open) return false;
      return !q || [s.name, s.contact, s.phone, s.email].join(' ').toLowerCase().includes(q);
    });

    const pg = paginate(list, params.page);
    const rows = pg.rows.map((s) => {
      const p = agg.prod.get(s.id) || EMPTY_P;
      const o = agg.po.get(s.id) || EMPTY_O;
      const l = agg.lead.get(s.id) || {};
      const days = l.leadDaysMean == null ? null : Math.round(l.leadDaysMean);
      return `
        <tr data-go="${esc(s.id)}">
          <td><strong>${dash(s.name)}</strong>${s.contact ? `<span class="row-sub">${esc(s.contact)}</span>` : ''}</td>
          <td data-col="phone">${dash(s.phone)}</td>
          <td data-col="email">${dash(s.email)}</td>
          <td class="num" data-col="products">${p.n}</td>
          <td class="num" data-col="value">${pesoShort(p.value)}</td>
          <td class="num" data-col="open">${o.open || '—'}</td>
          <td class="num" data-col="outstanding">${o.outC ? pesoShort(unc(o.outC)) : '—'}</td>
          <td class="num" data-col="lead">${daysText(days)}</td>
        </tr>`;
    }).join('');

    // Search and a filter always, like Purchase orders and Products (owner 2026-09-26; was: search past ten only).
    const on = loadCols();
    return head(
      'Suppliers',
      `<button class="secondary-btn small" data-act="export-suppliers">Export CSV</button>
       <button class="primary-btn small" data-act="new-supplier">Add supplier</button>`
    ) + `
    <div class="list-filters">${searchBox('Search suppliers')}
      <select class="bo-select" data-filter="show">${SHOW_FILTERS.map(([v, l]) => `<option value="${v}"${v === show ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${colsMenu(COLUMNS, on)}</div>
    <div class="dash-stack sup-list ${hideColsClass(COLUMNS, on)}">${card('All suppliers', `${list.length} shown`, table(
      `<th>Supplier</th><th data-col="phone">Phone</th><th data-col="email">Email</th><th class="num" data-col="products">Items</th>
       <th class="num" data-col="value">Stock value</th><th class="num" data-col="open">Open POs</th><th class="num" data-col="outstanding">Incoming</th>
       <th class="num" data-col="lead" title="Average days from sending a PO to receiving it">Delivers in</th>`,
      rows, 8, suppliers.length ? 'No supplier matches these filters.' : 'No suppliers yet. Add one to start raising purchase orders.'
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
      if (sup && !poSuppliers(o).includes(sup)) return false;
      if (st === 'incoming' ? !isIncoming(o) : st && o.status !== st) return false;
      if (!q) return true;
      return [o.number, ...poSuppliers(o).map((id) => id && supName(id)), o.note].filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    // The lineup first — what is coming, soonest expected at the top.
    const rank = (o) => (isIncoming(o) ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0
      ? (SUP_RULES.dueDate(a) || '9999').localeCompare(SUP_RULES.dueDate(b) || '9999')
      : String(b.orderedAt || '').localeCompare(String(a.orderedAt || ''))));

    const today = todayIso();
    const pg = paginate(list, params.page);
    const rows = pg.rows.map((o) => {
      const late = SUP_RULES.isOverdue(o, today);
      const out = poOpenValue(o);
      return `
        <tr data-go="${esc(o.id)}">
          <td><strong>${dash(o.number)}</strong></td>
          <td>${supplierText(o)}</td>
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
      <select class="bo-select" data-filter="supplier">${opts(sup, [['', 'All suppliers']].concat(suppliers.filter((s) => !s.archived || s.id === sup).map((s) => [s.id, s.name || 'Unnamed'])))}</select>
    </div>
    <div class="dash-stack">${card('Purchase orders', `${list.length} shown`, table(
      `<th>PO</th><th>Supplier</th><th>Status</th><th>Ordered</th><th>Due</th>
       <th class="num">Lines</th><th class="num">Total</th><th class="num">Incoming</th>`,
      rows, 8, pos.length ? 'No purchase order matches these filters.' : 'No purchase orders yet.'
    ), true, pagerHtml(pg))}</div>`;
  }

  /* ---------- Supplier detail ---------- */
  // Read-only facts under the name; Edit opens a dialog (owner, 2026-09-26: the old page was a
  // wall of inputs). Order days, minimum order and quoted lead days were removed the same day.
  const SUP_FIELDS = [['name', 'Name', 'text'], ['contact', 'Contact person', 'text'], ['phone', 'Phone', 'tel'],
    ['email', 'Email', 'email'], ['address', 'Address', 'text'], ['note', 'Note', 'text']];
  let editOnOpen = false;   // a new supplier lands on its page with the dialog already up

  function supplierDialog(s) {
    return `<dialog id="supDlg" class="bo-dialog adj-dlg">
      <div class="bod-head">
        <div class="bod-title"><h2>Edit supplier</h2></div>
        <button type="button" class="bod-close" aria-label="Close">&times;</button>
      </div>
      <div class="adj-body">
        <form class="adj-form" id="supForm">
          <div class="adj-grid">${SUP_FIELDS.map(([k, l, t]) => `<label class="adj-field${k === 'address' || k === 'note' ? ' adj-note' : ''}"><span>${l}</span>
            <input name="${k}" type="${t}" value="${esc(s[k])}"${k === 'name' ? ' required' : ''} autocomplete="off"></label>`).join('')}</div>
          <div class="adj-foot">
            <button type="button" class="secondary-btn small" data-act="sup-edit-cancel">Cancel</button>
            <button type="submit" class="primary-btn small">Save</button>
          </div>
        </form>
      </div>
    </dialog>`;
  }

  function supplierDetail(s, agg, params) {
    const p = agg.prod.get(s.id) || EMPTY_P;
    const o = agg.po.get(s.id) || EMPTY_O;
    const lead = agg.lead.get(s.id) || {};
    const days = lead.leadDaysMean == null ? null : Math.round(lead.leadDaysMean);

    // Biggest money first; value | bar | % like Sales' Top items. The % is each item's share of
    // what this supplier has on our shelf; the bar is scaled to the biggest, so the tail still reads.
    const ranked = p.items.slice().sort((a, b) => b.value - a.value);
    const top = (ranked[0] || {}).value || 1;
    const pg = paginate(ranked, params.page, DETAIL_ROWS);
    const products = pg.rows.map((it) => {
      const one = it.members.length === 1 ? it.members[0] : null;
      const sub = [it.main ? 'Main' : 'Other', one ? one.sku : `${it.members.length} variants`].filter(Boolean).join(' · ');
      return `
      <tr data-product="${esc(it.key)}">
        <td>${esc(it.name)}<span class="row-sub">${esc(sub)}</span></td>
        <td class="num">${SalesMath.qtyText(onHandOf(it.members))} ${esc(it.members[0].unit || '')}</td>
        <td class="num">${rangeText(it.members.map((m) => Number(m.cost) || 0))}</td>
        <td class="num">${peso(it.value)}</td>
        <td class="share-td"><i class="share-bar">${it.value > 0 ? `<i style="width:${(it.value / top * 100).toFixed(1)}%"></i>` : ''}</i></td>
        <td class="share-pct">${it.value > 0 ? esc(pctOf(it.value, p.value, 0)) : '—'}</td>
        <td class="num"><button class="link-btn" data-act="sup-out" data-key="${esc(it.key)}">Remove</button></td>
      </tr>`;
    }).join('');

    // What was ordered from them: every PO line bought here, newest first.
    const allLines = o.lines.slice().sort((a, b) => String(b.o.orderedAt || '').localeCompare(String(a.o.orderedAt || '')));
    const orders = allLines.slice(0, DETAIL_ROWS).map(({ o: x, l }) => {
      const item = prodById.get(l.productId);
      const got = Number(l.receivedQty) || 0;
      return `
      <tr data-go="${esc(x.id)}">
        <td>${esc(item ? item.name : l.productId)}<span class="row-sub">${esc(x.number || '')}</span></td>
        <td>${statusPill(got > 0 && !lineOut(l) ? 'received' : x.status)}</td>
        <td>${fmtDate(x.orderedAt)}</td>
        <td class="num">${SalesMath.qtyText(got)} of ${SalesMath.qtyText(l.qty)}</td>
        <td class="num">${peso(poLineTotal(l))}</td>
      </tr>`;
    }).join('');
    const moreOrders = allLines.length > DETAIL_ROWS
      ? `<div class="sup-more"><button class="link-btn" data-act="sup-all-pos">All in Purchase orders ›</button></div>` : '';

    const join = (parts) => parts.filter(Boolean).join('<span class="sep">·</span>');
    const line1 = join([s.contact && esc(s.contact), s.phone && `<a href="tel:${esc(s.phone.replace(/\s+/g, ''))}">${esc(s.phone)}</a>`,
      s.email && `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`]);
    const line2 = join([s.address && esc(s.address), s.note && `<span class="sup-quote">${esc(s.note)}</span>`]);

    return `${head(dash(s.name), `
          <button class="secondary-btn small" data-act="sup-archive">${s.archived ? 'Restore' : 'Archive'}</button>
          <button class="secondary-btn small" data-act="sup-edit">Edit</button>
          ${s.archived ? '' : `<a class="secondary-btn small" href="${esc(Router.href(VIEW, s.id + '/add'))}">Add items</a>
          <button class="primary-btn small" data-act="new-po">New purchase order</button>`}`, ['Suppliers', Router.href(VIEW)])}
      <div class="sup-contact">${line1 || line2
        ? `${line1 ? `<div>${line1}</div>` : ''}${line2 ? `<div>${line2}</div>` : ''}`
        : '<div>No contact details yet. <button class="link-btn" data-act="sup-edit">Add them</button></div>'}</div>
      <div class="kpi-row joined">
        ${kpi('Stock value', pesoShort(p.value), 'at cost')}
        ${kpi('Incoming', o.open ? pesoShort(unc(o.outC)) : '—', SalesMath.plural(o.open, 'open PO'))}
        ${kpi('Delivers in', daysText(days), days == null ? 'none received' : `avg of ${SalesMath.plural(lead.n, 'PO')}`)}
      </div>
      <div class="dash-stack">
        ${card('Items from this supplier', `${p.n} · biggest value first`, table(
          '<th>Item</th><th class="num">In stock</th><th class="num">Cost</th><th class="num">Value</th><th></th><th class="share-pct">Share</th><th class="num"></th>',
          products, 7, 'No item is linked to this supplier yet.'), true, pagerHtml(pg))}
        ${card('What was ordered', `${SalesMath.plural(o.lines.length, 'line')}`, table(
          '<th>Item</th><th>Status</th><th>Ordered</th><th class="num">Received</th><th class="num">Total</th>',
          orders, 5, 'Nothing ordered from this supplier yet.') + moreOrders, true)}
      </div>
      ${supplierDialog(s)}`;
  }

  // Every item not linked yet, ticks on the left, Add top right: Categories' Add items page.
  function supplierAdd(s) {
    const rest = familyItems().filter((it) => !it.members.some((m) => supplierIdsOf(m).includes(s.id)));
    const rows = rest.map((it) => `<tr data-find-row="${esc(it.name.toLowerCase())}">
        <td class="pd-sel"><input type="checkbox" data-tick="${esc(it.key)}" aria-label="${esc(it.name)}"></td>
        <td>${esc(it.name)}</td><td>${it.members.length > 1 ? `${it.members.length} variants` : esc(it.members[0].sku || '')}</td>
        <td>${esc([...new Set(it.members.flatMap(supplierIdsOf))].map(supName).join(', ')) || '—'}</td></tr>`).join('');
    return `${head(`Add items to ${esc(s.name || 'this supplier')}`, '<button class="primary-btn small" data-act="sup-add" disabled>Add</button>',
      [s.name || 'Supplier', Router.href(VIEW, s.id)])}
      <div class="list-filters"><input class="search-input small" data-find placeholder="Search items" autocomplete="off"></div>
      <div class="dash-stack">${card('Items', `${rest.length}`, table('<th class="pd-sel"></th><th>Item</th><th>SKU</th><th>Suppliers</th>',
        rows, 4, 'Every item comes from this supplier already.'), true)}</div>`;
  }

  /* ---------- Tab 3: incoming ---------- */
  // Every line still to come on an ordered PO, soonest due first. Each is received on its own:
  // the suppliers on one buying list arrive on different days (owner, 2026-10-02).
  function incomingList(params) {
    const q = (state.invQuery || '').trim().toLowerCase();
    const today = todayIso();
    const list = [];
    for (const o of pos.filter(isIncoming)) {
      for (const l of o.items || []) {
        const p = prodById.get(l.productId), sid = lineSupplier(o, l);
        if (!lineOut(l)) continue;
        if (q && ![p && p.name, p && p.sku, o.number, sid && supName(sid)].filter(Boolean).join(' ').toLowerCase().includes(q)) continue;
        list.push({ o, l, p });
      }
    }
    list.sort((a, b) => (SUP_RULES.dueDate(a.o) || '9999').localeCompare(SUP_RULES.dueDate(b.o) || '9999'));
    const pg = paginate(list, params.page);
    const rows = pg.rows.map(({ o, l, p }) => {
      const late = SUP_RULES.isOverdue(o, today);
      return `
        <tr data-line="${esc(l.id)}" data-po="${esc(o.id)}">
          <td><strong>${esc(p ? p.name : l.productId)}</strong>${p && p.sku ? `<span class="row-sub">${esc(p.sku)}</span>` : ''}</td>
          <td>${supCell(lineSupplier(o, l))}</td>
          <td><button class="link-btn" data-go="${esc(o.id)}">${dash(o.number)}</button></td>
          <td class="${late ? 'sup-overdue' : ''}">${fmtDate(SUP_RULES.dueDate(o))}${late ? ' · overdue' : ''}</td>
          <td class="num">${SalesMath.qtyText(lineOut(l))} ${esc((p && p.unit) || '')}</td>
          <td class="num"><input class="text-input mini" type="number" min="0" step="${stepFor(p)}" data-recv-one value="${lineOut(l)}" aria-label="Receiving now"></td>
          <td class="num"><button class="secondary-btn small" data-act="receive-line">Receive</button></td>
        </tr>`;
    }).join('');
    return head('Incoming', '') + `<div class="list-filters">${searchBox('Search incoming')}</div>
      <div class="dash-stack">${card('Still to come', `${SalesMath.plural(list.length, 'line')}`, table(
        '<th>Item</th><th>Supplier</th><th>PO</th><th>Due</th><th class="num">Still to come</th><th class="num">Receiving now</th><th class="num"></th>',
        rows, 7, 'Nothing on its way. A line shows here once its purchase order is marked ordered.'), true, pagerHtml(pg))}</div>`;
  }

  function openSupplierDialog() {
    const dlg = root().querySelector('#supDlg');
    if (!dlg) return;
    dlg.showModal();
    dlg.querySelector('input[name="name"]').select();
  }

  /* ---------- PO editor ---------- */
  const field = (label, key, value, type, dis = '') =>
    `<div class="setting-row"><label>${label}</label>
      <input class="text-input" type="${type || 'text'}" data-field="${key}" value="${esc(value)}"${dis}></div>`;

  function poEditor(po) {
    const items = po.items || [];
    // Open until received or cancelled; after that it is history and nothing on it changes. A line
    // that has started arriving is history too: a correction is another receipt, never a rewrite.
    const open = po.status !== 'received' && po.status !== 'cancelled';
    const canEdit = (l) => open && !(Number(l.receivedQty) > 0);
    const dis = open ? '' : ' disabled';
    const receiving = isIncoming(po);

    labelIndex = new Map();
    const options = state.products.filter((p) => !p.archived).map((p) => {
      const label = productLabel(p);
      if (!labelIndex.has(label)) labelIndex.set(label, p);
      return `<option value="${esc(label)}"></option>`;
    }).join('');

    // Where to buy it: the item's own suppliers first; picking one it is not linked to links it.
    const supSelect = (l, p) => {
      const cur = lineSupplier(po, l), mine = p ? supplierIdsOf(p) : [];
      const opt = (id, label) => `<option value="${esc(id)}"${id === cur ? ' selected' : ''}>${esc(label)}</option>`;
      const rest = suppliers.filter((x) => !mine.includes(x.id) && (!x.archived || x.id === cur));
      return `<select class="bo-select" data-line-field="supplierId">${opt('', 'Unassigned')}${mine.map((id) => opt(id, supName(id))).join('')}${
        rest.length ? `<optgroup label="Not linked yet">${rest.map((x) => opt(x.id, x.name || 'Unnamed')).join('')}</optgroup>` : ''}</select>`;
    };

    const lineRow = (l) => {
      const p = prodById.get(l.productId);
      const ed = canEdit(l);
      return `<tr data-line="${esc(l.id)}">
        <td>${ed
          ? `<input class="text-input" list="supProducts" data-line-field="productId" value="${esc(p ? productLabel(p) : l.productId)}">`
          : `<strong>${esc(p ? p.name : l.productId)}</strong>${p && p.sku ? `<span class="row-sub">${esc(p.sku)}</span>` : ''}`}</td>
        <td>${ed ? supSelect(l, p) : supCell(lineSupplier(po, l))}</td>
        <td class="num">${ed
          ? `<input class="text-input mini" type="number" min="0" step="${stepFor(p)}" data-line-field="qty" value="${l.qty}">`
          : SalesMath.qtyText(poLineQty(l))}</td>
        <td class="num">${ed
          ? `<input class="text-input mini" type="number" min="0" step="0.01" data-line-field="cost" value="${l.cost}">`
          : peso(poLineUnit(l))}</td>
        <td class="num" data-line-total>${peso(poLineTotal(l))}</td>
        <td class="num">${po.status === 'draft' ? '' : SalesMath.qtyText(Number(l.receivedQty) || 0)}</td>
        <td class="num">${ed ? '<button class="link-btn" data-act="remove-line">Remove</button>' : ''}</td>
      </tr>`;
    };

    const lines = items.map(lineRow).join('') + (open ? `
      <tr class="sup-add"><td colspan="7">
        <input class="text-input" list="supProducts" data-act="add-line" placeholder="Add an item…">
      </td></tr>` : '');

    // Ordered and received are in Lines above; this card is only what came today. Blank until typed
    // or filled, so a stray second click on Receive takes nothing.
    const recvRow = (l) => {
      const p = prodById.get(l.productId);
      return `<tr data-line="${esc(l.id)}">
        <td><strong>${esc(p ? p.name : l.productId)}</strong></td>
        <td class="num" data-out="${esc(l.id)}">${SalesMath.qtyText(lineOut(l))}</td>
        <td class="num">
          <input class="text-input mini" type="number" min="0" step="${stepFor(p)}" data-recv="${esc(l.id)}" placeholder="0">
          <div class="sup-warn" hidden>more than ordered</div>
        </td>
        <td class="num"><input class="text-input mini" type="number" min="0" step="0.01" data-invoice
          placeholder="${esc(l.cost)}" title="What the supplier billed per unit. Blank = the quoted cost."></td>
        <td><select class="bo-select" data-short hidden><option value="">Why short?</option>${Object.keys(SHORT_REASONS)
          .map((k) => `<option value="${k}">${SHORT_REASONS[k]}</option>`).join('')}</select></td>
      </tr>`;
    };

    const actions = [
      po.status === 'draft' ? '<button class="primary-btn small" data-act="mark-ordered">Mark ordered</button>' : '',
      receiving ? '<button class="primary-btn small" data-act="receive">Receive delivery</button>' : '',
      open ? '<button class="secondary-btn small danger" data-act="cancel-po">Cancel PO</button>' : '',
      '<button class="secondary-btn small" data-act="export-po">Export CSV</button>',
    ].join('');

    return `
      <datalist id="supProducts">${options}</datalist>
      ${head(`<span data-live="number">${dash(po.number)}</span>`, actions, ['Purchase orders', Router.href(VIEW, '', { tab: 'orders' })],
        `${supplierText(po)} · ${statusPill(po.status)}${po.sentAt ? ` · sent ${fmtDate(po.sentAt)}` : ''}${
          po.receivedAt ? ` · received ${fmtDate(po.receivedAt)}` : ''}`)}
      <div class="dash-stack">
        ${card('Details', open ? 'Saved as you leave each field' : 'Locked — this order is closed', `<div class="settings-grid">
          ${field('PO number', 'number', po.number, 'text', dis)}
          <div class="setting-row"><label>Ordered</label>
            <input class="bo-date" type="date" data-field="orderedAt" value="${esc(po.orderedAt)}"${dis}></div>
          <div class="setting-row"><label>Expected</label>
            <input class="bo-date" type="date" data-field="expectedAt" value="${esc(po.expectedAt)}"${dis}></div>
          <div class="setting-row"><label>Supplier promised</label>
            <input class="bo-date" type="date" data-field="promisedAt" value="${esc(po.promisedAt)}"${dis}></div>
          <div class="setting-row"><label>Sent on</label>
            <input class="bo-date" type="date" data-sent-on max="${esc(todayIso())}"
              value="${esc(po.sentAt ? isoDate(po.sentAt) : todayIso())}"${dis}
              ${po.status === 'draft' ? 'title="Used when you mark it ordered"' : ''}></div>
          ${field('Note', 'note', po.note, 'text', dis)}
        </div>`)}
        ${card('Lines', `${SalesMath.plural(items.length, 'line')}`, `
          <table class="data-table">
            <thead><tr><th>Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Unit cost</th>
              <th class="num">Line total</th><th class="num">${po.status === 'draft' ? '' : 'Received'}</th><th class="num"></th></tr></thead>
            <tbody>${lines || `<tr><td colspan="7" class="bo-empty">No lines yet.</td></tr>`}</tbody>
            <tfoot><tr><td colspan="4">Total</td><td class="num" data-po-total>${peso(poTotal(po))}</td><td colspan="2"></td></tr></tfoot>
          </table>`, true)}
        ${receiving ? card('Receiving', 'What arrives is added to stock', `
          <table class="data-table">
            <thead><tr><th>Item</th>
              <th class="num">Still to come</th><th class="num">Receiving now</th><th class="num">Invoice cost</th><th>Short reason</th></tr></thead>
            <tbody>${items.filter((l) => lineOut(l) > 0).map(recvRow).join('') || `<tr><td colspan="5" class="bo-empty">No lines to receive.</td></tr>`}</tbody>
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

    const [id, sub] = state.detailId.split('/');
    if (id) {
      const po = pos.find((o) => o.id === id);
      const sup = po ? null : suppliers.find((s) => s.id === id);
      el.innerHTML = po ? poEditor(po)
        : sup ? (sub === 'add' ? supplierAdd(sup) : supplierDetail(sup, agg, params))
        : `<div class="bo-card blk-empty"><div class="bo-empty">That record no longer exists. <button class="link-btn" data-act="back-suppliers">Back to suppliers</button></div></div>`;
    } else {
      el.innerHTML = params.tab === 'orders' ? poList(agg, params)
        : params.tab === 'incoming' ? incomingList(params) : supplierList(agg, params);
    }
    restoreFocus(el, keep);
    if (editOnOpen) { editOnOpen = false; openSupplierDialog(); }
  };

  /* ---------- Writes ---------- */
  const currentPo = () => pos.find((o) => o.id === state.detailId) || null;
  const currentSupplier = () => suppliers.find((s) => s.id === state.detailId.split('/')[0]) || null;

  function saveAndRepaint(po) {
    if (po) po.updatedAt = new Date().toISOString();
    savePurchaseOrders(pos);
    refreshSharedState();
    renderCurrentView();
  }

  // Numbered per device, so two offline devices never both make PO-0012: a short code made once and
  // kept on this device, then a count within it.
  // ponytail: 3 random base-36 characters, 1 in 46,656 that two devices match; a store-given device
  // name replaces it once devices are registered.
  function nextPoNumber() {
    let dev = HWPOS_STORE.ui.get('poDevice');
    if (!dev) HWPOS_STORE.ui.set('poDevice', (dev = Math.random().toString(36).slice(2, 5).toUpperCase()));
    const mine = new RegExp(`^PO-${dev}-(\\d+)$`);
    let max = 0;
    for (const o of pos) {
      const m = mine.exec(o.number || '');
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `PO-${dev}-${String(max + 1).padStart(4, '0')}`;
  }

  // A new list fills itself (owner, 2026-10-02): every low or out item, need minus what is already
  // on order, each bought from its main supplier. From a supplier's page, only what they sell.
  // What this supplier last billed for the item, when they have (Inventory's lastPaid); else undefined.
  const paidCost = (productId, sid, paid) => (sid ? (paid.get(productId + '|' + sid) || {}).cost : undefined);
  const paidNow = () => lastPaid(loadMovements(), pos);

  function newPo(supplierId) {
    const fill = buyingList(state.products, pos, supplierId || '');
    const paid = paidNow();
    const po = {
      ...PO_DEFAULTS,
      id: newId('po'),
      number: fill.length ? nextPoNumber() : '',   // an empty draft takes a number with its first line
      orderedAt: todayIso(),
      items: fill.map(({ p, qty, supplierId: sid }) => poLine(p.id, qty, paidCost(p.id, sid, paid) ?? p.cost, sid)),
      updatedAt: new Date().toISOString(),
    };
    pos.push(po);
    savePurchaseOrders(pos);
    Router.go(VIEW, po.id, {}, { replace: false });
    showToast(fill.length ? `Filled with ${SalesMath.plural(fill.length, 'out or low item')}` : 'Nothing is out or low. Add items below.');
  }

  // Link or unlink, the way Categories files items: the first supplier an item gets is its main
  // one, and removing the main one promotes the next.
  function setSup(productIds, sid, add) {
    const ids = new Set(productIds), at = new Date().toISOString();
    state.products = state.products.map((p) => {
      if (!ids.has(p.id)) return p;
      const have = supplierIdsOf(p);
      const next = add ? [...new Set(have.concat(sid))] : have.filter((x) => x !== sid);
      return next.join() === have.join() ? p : { ...p, supplierId: next[0] || '', altSupplierIds: next.slice(1), updatedAt: at };
    });
    saveProducts();
  }
  const familyIds = (keys) => familyItems().filter((it) => keys.has(it.key)).flatMap((it) => it.members.map((m) => m.id));

  // The one path that moves stock. receivePo rounds each qty to the item, stamps reason, PO, line,
  // supplier and what was billed; we apply what it returns to product.stock and append the log.
  // map: { lineId: qty | { qty, unitCost } }; short: { lineId: reason }.
  function receive(po, map, arrivedOn, short = {}) {
    // Another window received on this PO since this one loaded it: show that, receive nothing twice.
    const fresh = loadPurchaseOrders().find((o) => o.id === po.id);
    if (fresh && String(fresh.updatedAt || '') > String(po.updatedAt || '')) {
      renderCurrentView();
      return showToast('This purchase order changed in another window. Check it and receive again.');
    }
    (po.items || []).forEach((l) => { if (short[l.id]) l.shortReason = short[l.id]; });
    // Who received it: the back office's signed-in name (actor), linked to its staff id like Inventory's dialogs.
    const staff = actor(), staffId = staffIdOf(staff);
    const movements = receivePo(po, map, arrivedOn, (id) => prodById.get(id), { staffId, staff, zone: boZone() });
    if (!movements.length) return showToast('Nothing to receive');
    movements.forEach((m) => { const p = prodById.get(m.productId); if (p) applyMovement(p, m); });
    // Log, list, then shelf -- all saved before anything is asked, so a tab closed at the question
    // below loses no delivery.
    appendMovements(movements);
    savePurchaseOrders(pos);
    saveProducts(`received on ${po.number || 'a purchase order'}`);
    // What was paid against what the item says it costs, per line (one item can come from two
    // suppliers at two prices): offered, never forced (owner, 2026-10-02). Cost only, not price.
    const paid = movements.map((m) => [prodById.get(m.productId), round2(m.unitCost), m.supplierId])
      .filter(([p, c]) => p && c > 0 && c !== round2(p.cost));
    if (paid.length && confirm(`Update the item cost to what you paid?\n\n${paid.map(([p, c, sid]) =>
      `${p.name}${sid ? ` (${supName(sid)})` : ''}: ${peso(p.cost)} → ${peso(c)}`).join('\n')}`)) {
      paid.forEach(([p, c]) => { p.cost = c; p.updatedAt = new Date().toISOString(); });
      saveProducts(`cost from ${po.number || 'a purchase order'}`);
    }
    refreshSharedState();
    renderCurrentView();
    showToast(`Received ${SalesMath.plural(movements.length, 'line')} on ${po.number || 'this PO'}`);
  }

  // Read before receivePo runs: shortness is judged against what was still to come.
  function collectReceipt(el, po) {
    const map = {}, short = {};
    let bad = '';
    el.querySelectorAll('[data-recv]').forEach((input) => {
      const id = input.dataset.recv;
      const row = input.closest('[data-line]');
      const raw = input.value.trim();
      const n = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(n) || n < 0) { bad = 'Receive quantity cannot be negative'; return; }
      const invRaw = row.querySelector('[data-invoice]').value.trim();
      const inv = invRaw === '' ? null : Number(invRaw);
      if (inv != null && (!Number.isFinite(inv) || inv < 0)) { bad = 'Invoice cost cannot be negative'; return; }
      if (n > 0) map[id] = { qty: n, unitCost: inv };
      const line = (po.items || []).find((l) => l.id === id);
      if (line && SUP_RULES.isShort(line, n)) short[id] = row.querySelector('[data-short]').value;
    });
    if (bad) { showToast(bad); return null; }
    return { map, short };
  }

  /* ---------- CSV ---------- */
  function exportSuppliers(agg) {
    const rows = [['name', 'contact', 'phone', 'email', 'address', 'note', 'items', 'stock_value', 'open_pos', 'incoming']];
    suppliers.forEach((s) => {
      const p = agg.prod.get(s.id) || EMPTY_P;
      const o = agg.po.get(s.id) || EMPTY_O;
      rows.push([s.name, s.contact, s.phone, s.email, s.address, s.note, p.n, round2(p.value), o.open, unc(o.outC)]);
    });
    downloadCsv('suppliers.csv', rows);
  }

  function exportPo(po) {
    const rows = [['po_number', 'supplier', 'status', 'ordered_at', 'expected_at', 'sku', 'item', 'qty', 'unit_cost', 'line_total', 'received_qty',
      'sent_at', 'promised_at', 'invoice_unit_cost', 'short_reason']];
    (po.items || []).forEach((l) => {
      const p = prodById.get(l.productId), sid = lineSupplier(po, l);
      rows.push([po.number, sid ? supName(sid) : '', po.status, po.orderedAt, po.expectedAt,
        p ? p.sku : '', p ? p.name : l.productId, poLineQty(l), poLineUnit(l), poLineTotal(l), l.receivedQty || 0,
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
      case 'export-suppliers': return exportSuppliers(aggregate());
      case 'export-po': return po && exportPo(po);
      case 'new-supplier': {
        const s = { ...SUPPLIER_DEFAULTS, id: newId('sup'), name: 'New supplier', updatedAt: new Date().toISOString() };
        suppliers.push(s);
        saveSuppliers(suppliers);
        editOnOpen = true;
        return Router.go(VIEW, s.id, {}, { replace: false });
      }
      case 'new-po': return newPo(currentSupplier()?.id || Router.route().params.supplier);
      case 'sup-archive': {
        const s = currentSupplier();
        if (!s) return;
        s.archived = !s.archived;
        s.updatedAt = new Date().toISOString();
        saveSuppliers(suppliers);
        renderCurrentView();
        return showToast(s.archived ? 'Supplier archived' : 'Supplier restored');
      }
      case 'sup-out': {
        const s = currentSupplier();
        if (!s) return;
        setSup(familyIds(new Set([hit.dataset.key])), s.id, false);
        return renderCurrentView();
      }
      case 'sup-add': {
        const s = currentSupplier();
        const keys = new Set([...el.querySelectorAll('[data-tick]:checked')].map((x) => x.dataset.tick));
        if (!s || !keys.size) return;
        setSup(familyIds(keys), s.id, true);
        showToast(`Added ${SalesMath.plural(keys.size, 'item')}`);
        return Router.go(VIEW, s.id, {}, { replace: true });
      }
      case 'receive-line': {
        if (e.detail > 1) return;   // a double click is one receive
        const row = hit.closest('[data-line]');
        const o = row && pos.find((x) => x.id === row.dataset.po);
        const n = Number(row && row.querySelector('[data-recv-one]').value) || 0;
        if (!o || n <= 0) return showToast('Nothing to receive');
        return receive(o, { [row.dataset.line]: n }, todayIso());
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
        po.orderedAt = po.orderedAt || todayIso();
        if (!po.sentAt) {                                    // orderedAt is the draft's date; this is the send
          const day = el.querySelector('[data-sent-on]')?.value || todayIso();
          po.sentAt = sentStamp(day);
        }
        return saveAndRepaint(po);
      }
      case 'sup-edit': return openSupplierDialog();
      case 'sup-edit-cancel': return hit.closest('dialog').close();
      case 'sup-all-pos': return Router.go(VIEW, '', { tab: 'orders', supplier: currentSupplier()?.id || '' });
      case 'cancel-po': {
        if (!po || !confirm(`Cancel ${po.number || 'this purchase order'}?`)) return;
        po.cancelledAt = new Date().toISOString();
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
        if (!po || e.detail > 1) return;
        const got = collectReceipt(el, po);
        const arrivedOn = el.querySelector('#supArrivedOn')?.value || isoDate(Date.now());
        if (got) receive(po, got.map, arrivedOn, got.short);
        return;
      }
    }
  });

  document.addEventListener('change', (e) => {
    const el = root();
    if (!el || el.hidden || !el.contains(e.target)) return;
    const t = e.target;

    if (t.dataset.filter) return Router.setParams({ [t.dataset.filter]: t.value, page: '' });
    if (t.dataset.tick !== undefined) {   // Add items: the button counts what is ticked, as on Categories
      const n = el.querySelectorAll('[data-tick]:checked').length;
      const b = el.querySelector('[data-act="sup-add"]');
      b.disabled = !n;
      b.textContent = n ? `Add ${n}` : 'Add';
      return;
    }
    if (t.dataset.colToggle) {   // CSS hides the cells; the menu stays open, nothing re-renders
      const on = loadCols();
      if (t.checked) on.add(t.dataset.colToggle); else on.delete(t.dataset.colToggle);
      saveColPrefs(STORAGE_COLS, COLUMNS, on);
      el.querySelector('.sup-list')?.classList.toggle('hide-' + t.dataset.colToggle, !t.checked);
      return;
    }

    // When it actually shipped, corrected after the fact — local noon of the chosen day
    // (now, if today), so lead time (sentAt -> receivedAt) reads off the real day, not
    // whatever moment someone happened to tap "Mark ordered".
    if (t.dataset.sentOn !== undefined) {
      const po = currentPo();
      if (!po || po.status === 'draft') return;   // a draft's date is read by Mark ordered, not saved as sent
      const day = t.value || todayIso();
      po.sentAt = sentStamp(day);
      saveAndRepaint(po);
      return;
    }

    // Field edits save straight through without a re-render — `change` fires as
    // focus leaves, and repainting here would steal it from the next field.
    if (t.dataset.field) {
      const po = currentPo();
      const rec = po || currentSupplier();
      if (!rec) return;
      rec[t.dataset.field] = t.value;
      rec.updatedAt = new Date().toISOString();
      if (po) savePurchaseOrders(pos); else saveSuppliers(suppliers);
      const live = el.querySelector(`[data-live="${t.dataset.field}"]`);
      if (live) live.textContent = t.value || '—';
      return;
    }

    if (t.dataset.act === 'add-line') {
      const po = currentPo();
      const p = labelIndex.get(t.value.trim());
      if (!po) return;
      if (!p) { t.value = ''; return showToast('Pick an item from the list'); }
      if (!po.number) po.number = nextPoNumber();
      po.items = (po.items || []).concat([poLine(p.id, 1, paidCost(p.id, p.supplierId, paidNow()) ?? p.cost, p.supplierId || '')]);
      return saveAndRepaint(po);
    }

    if (t.dataset.lineField) {
      const po = currentPo();
      const row = t.closest('[data-line]');
      const line = po && (po.items || []).find((l) => l.id === row.dataset.line);
      if (!line) return;
      line.updatedAt = new Date().toISOString();
      if (t.dataset.lineField === 'productId') {   // a different item brings its own cost and supplier
        const p = labelIndex.get(t.value.trim());
        if (!p) return showToast('Pick an item from the list');
        const sid = p.supplierId || '';
        Object.assign(line, { productId: p.id, cost: round2(paidCost(p.id, sid, paidNow()) ?? p.cost), supplierId: sid });
        return saveAndRepaint(po);
      }
      if (t.dataset.lineField === 'supplierId') {
        const p = prodById.get(line.productId);
        line.supplierId = t.value;
        const c = paidCost(line.productId, t.value, paidNow());   // their last bill, when there is one
        if (c != null) line.cost = c;
        if (p && t.value && !supplierIdsOf(p).includes(t.value)) {
          setSup([p.id], t.value, true);
          showToast(`${p.name} is now linked to ${supName(t.value)}`);
        }
        return saveAndRepaint(po);
      }
      const n = Math.max(0, Number(t.value) || 0);
      line[t.dataset.lineField] = t.dataset.lineField === 'qty' ? roundQty(prodById.get(line.productId), n) : round2(n);
      t.value = line[t.dataset.lineField];
      po.updatedAt = new Date().toISOString();
      savePurchaseOrders(pos);
      // Patch the derived cells in place rather than repaint, to keep focus flowing.
      row.querySelector('[data-line-total]').textContent = peso(poLineTotal(line));
      el.querySelector('[data-po-total]').textContent = peso(poTotal(po));
      const out = el.querySelector(`[data-out="${line.id}"]`);
      if (out) out.textContent = SalesMath.qtyText(lineOut(line));
      return;
    }
  });

  // The Edit dialog: one save for all six fields, then a repaint so the header and facts match.
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'supForm') return;
    e.preventDefault();
    const s = currentSupplier();
    if (!s) return;
    const f = new FormData(e.target);
    if (!String(f.get('name') || '').trim()) return showToast('A supplier needs a name');
    SUP_FIELDS.forEach(([k]) => { s[k] = String(f.get(k) || '').trim(); });
    s.updatedAt = new Date().toISOString();
    saveSuppliers(suppliers);
    e.target.closest('dialog').close();
    renderCurrentView();
    showToast('Supplier saved');
  });

  // Over-receiving is allowed (suppliers over-ship) but never silent.
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.find !== undefined && root()?.contains(t)) {   // Add items: filter rows in place
      const q = t.value.trim().toLowerCase();
      root().querySelectorAll('[data-find-row]').forEach((tr) => { tr.hidden = !!q && !tr.dataset.findRow.includes(q); });
      return;
    }
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
