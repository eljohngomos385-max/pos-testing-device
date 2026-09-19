/* Back office — Inventory. Renders the whole #view section; see CONTRACT.

   Products creates items; Inventory only moves stock. Nothing in this file
   creates a product: it writes stock_movements and reads them back, which is
   also the only way `product.stock` is ever allowed to change.               */
(function () {
  const VIEW = 'inventory';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);
  const TABS = { stock: 'On hand', movements: 'Movement history', reorder: 'Needs buying', cost: 'Cost changes' };
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).inventory = { param: 'tab', def: 'stock', items: Object.entries(TABS) };

  /* ================= pure logic (exported for scripts/inventory-check.mjs) ============= */

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

  // Round a wanted quantity UP to something the product can actually be ordered in.
  const ceilStep = (n, step) => (step === 1 ? Math.ceil(n) : r2(Math.ceil(n / step - 1e-9) * step));

  // "Set to count" records the count, not the answer: what gets logged is the difference.
  const countDelta = (onHand, counted) => r2(Number(counted || 0) - Number(onHand || 0));

  // ponytail: placeholder heuristic — top the shelf up to twice the danger level. Real
  // systems carry a min AND a max stock level; we only have the min (reorderPoint), so
  // this stands in until Products grows a max. Swap for (maxLevel - onHand) then.
  function suggestQty(p) {
    const on = Number(p.stock) || 0;
    const min = Number(p.reorderPoint) || 0;
    const step = stepFor(p);
    const want = Math.max(min * 2 - on, min - on);
    return ceilStep(want > 0 ? want : step, step);
  }

  // The interesting column: read down it and every row explains the next. The log starts
  // after the seeded stock, so balances are anchored to today's cached on-hand and walked
  // backwards — that way the column and the On hand tab can never disagree.
  // `movements` must be in append order (it is; the log is append-only).
  function runningBalances(movements, stockOf) {
    const byProduct = new Map();
    for (const m of movements) {
      const list = byProduct.get(m.productId);
      if (list) list.push(m); else byProduct.set(m.productId, [m]);
    }
    const balance = new Map();
    byProduct.forEach((list, pid) => {
      let running = Number(stockOf(pid)) || 0;
      for (let i = list.length - 1; i >= 0; i--) {
        balance.set(list[i].id, running);
        running = r2(running - (Number(list[i].qty) || 0));
      }
    });
    return { byProduct, balance };
  }

  // Most urgent first: out of stock, then below the danger level, then everything else.
  const urgency = (p) => (Number(p.stock) <= 0 ? 0 : isLow(p) ? 1 : 2);

  // ONE place builds a stock movement, so a row entered inline on a product and a row
  // entered in an adjustment document are indistinguishable in the history.
  // Cost moves over time; a movement without the cost of the day makes every past margin
  // wrong, so it rides along with the quantity and falls back to the product's cost.
  // `expected`/`counted` ride along on anything that was counted, so the variance survives
  // the qty (countAccuracy in bo-insights.js reads them).
  function stockMovement({ product, delta, reason, note, unitCost, staff, refId, expected, counted, happenedOn }) {
    const typed = unitCost === '' || unitCost == null ? NaN : Number(unitCost);
    return makeMovement({
      productId: product.id, qty: delta, reason,
      refId: refId || '', note: note || '', staff: staff || '',
      unitCost: Number.isFinite(typed) ? typed : (Number(product.cost) || 0),
      expected, counted, happenedOn,
    });
  }

  // An adjustment document: one reason and one person, many counted lines. Every line
  // that actually moved becomes a movement sharing the document id as `refId`, so the
  // history can group them back into "Sept 8 count, 14 items, Maricel R.".
  // A line counted and found correct writes nothing — that is not a stock movement.
  function documentMovements(doc, productOf) {
    const out = [];
    (doc.lines || []).forEach((line) => {
      const p = productOf(line.productId);
      if (!p || line.counted === '' || line.counted == null) return;
      const counted = roundQty(p, line.counted);
      const delta = countDelta(p.stock, counted);
      if (!delta) return;
      out.push(stockMovement({
        product: p, delta, reason: doc.reason, note: doc.note,
        unitCost: line.unitCost, staff: doc.staff, refId: doc.id,
        expected: r2(Number(p.stock) || 0), counted, happenedOn: doc.date,
      }));
    });
    return out;
  }

  /* ---- What we last paid, against what the books still think we pay ----------------
     receivePo stamps the delivery's real cost onto the movement (bo-model.js), and then
     nothing writes it back to product.cost. So a supplier's price rise lands silently:
     the shelf price does not move, Sales keeps subtracting the old cost and reports a
     gross profit that was never earned, and the margin the owner set shrinks without
     anyone deciding to shrink it. The log has known all along. This is the comparison. */
  const DRIFT_MIN = 1;                          // percent; nobody reprints a label for less

  // Keyed by productId (latest from anyone) AND by `productId|supplierId` (latest from that
  // supplier), so a product bought from two suppliers is compared against the right one.
  // The supplier comes off the PO the delivery's refId points at.
  function lastPaid(movements, purchaseOrders = []) {
    const supplierOf = new Map(purchaseOrders.map((po) => [po.id, po.supplierId || '']));
    const out = new Map();
    for (const m of movements) {
      if (m.reason !== 'delivery') continue;    // only a purchase tells you a price
      const cost = Number(m.unitCost);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      const supplierId = supplierOf.get(m.refId) || '';
      const row = { cost: r2(cost), ts: m.ts, refId: m.refId || '', supplierId };
      for (const key of supplierId ? [m.productId, m.productId + '|' + supplierId] : [m.productId]) {
        const seen = out.get(key);
        if (!seen || m.ts > seen.ts) out.set(key, row);
      }
    }
    return out;
  }

  /* The price that keeps the margin this product is actually selling at today.
     Read off cost and price rather than the stored marginValue: that field is only as
     fresh as the last time somebody opened the editor, and a stale 0 in it would price
     the product at cost. A product with no cost or no price has no margin to hold. */
  function heldPrice(p, paid) {
    const mode = p.marginMode === 'flat' ? 'flat' : 'percent';
    if (!(Number(p.cost) > 0) || !(Number(p.price) > 0)) return null;
    return priceFromMargin(paid, mode, marginFromPrice(p.cost, p.price, mode));
  }

  // Against the preferred supplier's last price when they have delivered, else the last
  // delivery. Alternating two suppliers at two prices used to read as drift on every delivery.
  function costDrift(products, movements, purchaseOrders = []) {
    const paidBy = lastPaid(movements, purchaseOrders);
    const rows = [];
    for (const p of products) {
      const paid = (p.supplierId && paidBy.get(p.id + '|' + p.supplierId)) || paidBy.get(p.id);
      if (!paid) continue;                      // never delivered: nothing to compare
      const book = r2(Number(p.cost) || 0);
      const gap = r2(paid.cost - book);
      // No cost on file at all is the worst row on the page, not a 0% change: every sale
      // of it has been booking the whole price as profit. It has no old margin to hold,
      // so it gets no suggested price -- the product editor is where that gets decided.
      if (book > 0 && Math.abs(gap / book) * 100 < DRIFT_MIN) continue;
      rows.push({
        p, paid: paid.cost, at: paid.ts, refId: paid.refId, book, gap,
        gapPct: book ? r2((gap / book) * 100) : null,
        suggested: heldPrice(p, paid.cost),
        // What today's shelf price really earns, against what the reports still claim.
        nowMarkup: marginSummary(paid.cost, p.price).markup,
        bookMarkup: marginSummary(book, p.price).markup,
      });
    }
    // Percent, not pesos: a ₱20 rise on a ₱1,200 item is noise, the same rise on a
    // ₱60 item is the whole margin.
    const mag = (r) => (r.gapPct == null ? Infinity : Math.abs(r.gapPct));
    return rows.sort((a, b) => mag(b) - mag(a));
  }

  /* ---- Needs buying: the typed danger level and suggestQty ----
     ponytail: reorderPlan (bo-insights.js) is parked until the till event stream has real
     demand data under it. Every product at or below its reorderPoint, grouped by supplier,
     most urgent first. */
  function reorderGroups(products) {
    const groups = new Map();
    products.filter(isLow)
      .sort((a, b) => (a.stock / (a.reorderPoint || 1)) - (b.stock / (b.reorderPoint || 1)))
      .forEach((p) => {
        const key = p.supplierId || '';
        const g = groups.get(key);
        if (g) g.push(p); else groups.set(key, [p]);
      });
    return groups;
  }

  // Decision log: what the rule saw, what it said, what the person actually ordered.
  function reorderDecisions(lines, byId, poId, actor) {
    return lines.map((l) => {
      const p = byId.get(l.productId) || {};
      const suggested = suggestQty(p);
      return makeEvent({
        kind: 'reorder', subjectId: l.productId,
        inputs: { onHand: Number(p.stock) || 0, reorderPoint: Number(p.reorderPoint) || 0 },
        rule: 'suggestQty v0',
        choice: { suggestQty: suggested, orderedQty: l.qty, poId },
        accepted: l.qty === suggested, actor,
      }, actor);
    });
  }

  const API = { r2, ceilStep, countDelta, suggestQty, runningBalances, urgency,
    stockMovement, documentMovements, lastPaid, heldPrice, costDrift,
    reorderGroups, reorderDecisions };
  if (typeof module === 'object' && module.exports) { module.exports = API; return; }

  /* ================================ formatting ======================================== */

  const REASON_TONE = {
    sale: 'muted', return: 'warn', delivery: 'ok',
    adjustment: 'warn', count: 'muted', transfer: 'muted',
    shrinkage: 'warn', damage: 'warn', writeoff: 'warn',
  };

  const fmtQty = (p, n) => roundQty(p, n).toLocaleString('en-PH',
    p && p.soldBy === 'measure' ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});

  const fmtSigned = (p, n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtQty(p, Math.abs(n));

  const hay = (p) => `${p.name} ${p.sku || ''} ${p.barcode || ''} ${folderName(p.folder)}`.toLowerCase();

  const statusOf = (p) => (Number(p.stock) <= 0 ? ['danger', 'Out of stock']
    : isLow(p) ? ['warn', 'Low'] : ['ok', 'In stock']);

  /* ---- How fast it leaves the shelf ----
     "47 on hand" is not an answer on its own — 47 of something that sells 40 a week is
     nearly out, 47 of something that sells one a month is nine months of dead money.
     Sold in the last 30 days is the rate, and it comes out of the movement log that is
     already loaded. Days of cover was dropped: it is this number divided by itself, blank
     on everything that has not sold in a month, and Needs buying is where that decision
     actually gets made. */
  const SOLD_WINDOW = 30;

  function sold30(moves) {
    const from = Date.now() - SOLD_WINDOW * 86400000;
    let n = 0;
    for (const m of moves || []) {
      if (m.reason === 'sale' && Date.parse(m.ts) >= from) n += Math.abs(Number(m.qty) || 0);
    }
    return n;
  }

  /* Reason and Mode asked the same question twice - "Adjustment" plus "Set to count"
     could disagree with each other, and most of the 15 combinations were nonsense. One
     control now: what happened. Each answer carries its own sign and its own log label.
     Nothing adds stock blindly except a delivery; any other upward correction is a count,
     which is what a shop actually does. Sales are not here on purpose - the POS writes
     those against a receipt, and a hand-typed one would move stock with nothing behind it. */
  const ADJ_EVENTS = [
    ['delivery:add', 'Received new stock'],
    ['return:add', 'Customer return'],
    ['transfer:add', 'Transferred in'],
    ['transfer:remove', 'Transferred out'],
    // Losses split by why: theft, breakage and expiry each have a different fix, and a
    // generic "adjustment" hides which one the shop is paying for.
    ['shrinkage:remove', 'Lost or stolen'],
    ['damage:remove', 'Broken or damaged'],
    ['writeoff:remove', 'Written off (expired, unsellable)'],
    ['adjustment:remove', 'Used or other (note required)'],
    ['count:set', 'Counted the shelf'],
  ];
  const adjEvent = (form) => String(form.elements.event.value || 'delivery:add').split(':');
  const qtyLabel = (mode) => (mode === 'set' ? 'Counted quantity' : `Quantity to ${mode}`);
  // Stock adds are often typed late — the shelf held it before anyone opened this dialog.
  // Removals happen the day they happen, so the date is just "when".
  const dateLabel = (mode) => (mode === 'remove' ? 'Happened on' : 'In store since');

  /* ============================ saved adjustment documents ============================ */

  const STORAGE_ADJ = 'hwpos.adjustments.v1';
  const loadAdjustments = () => readJsonStorage(STORAGE_ADJ, []) || [];
  const saveAdjustments = (list) => storageSet(STORAGE_ADJ, JSON.stringify(list));

  const pickerLabel = (p) => (p.sku ? `${p.name} · ${p.sku}` : p.name);

  /* ================================ page state ======================================== */

  // Not filters — a transient panel and per-row overrides the URL has no business carrying.
  const orderQty = new Map();
  // ponytail: the unsaved document lives in memory only, so navigating away loses it.
  // Persist it to hwpos.adjustments.v1 as a `draft` status if that ever bites.
  let draft = null;

  function collect() {
    const params = Router.route().params;
    const tab = TABS[params.tab] ? params.tab : 'stock';
    const byId = new Map(state.products.map((p) => [p.id, p]));
    const movements = loadMovements();
    const { byProduct, balance } = runningBalances(movements, (pid) => (byId.get(pid) || {}).stock || 0);
    // state.detailId is the segment after the view: '' | 'adjust/new' | 'adjust/<id>'.
    const detail = state.detailId || '';
    return {
      params, tab, movements, byId, byProduct, balance,
      docId: detail === 'adjust' ? 'new' : detail.startsWith('adjust/') ? detail.slice(7) : '',
      q: (state.invQuery || '').trim().toLowerCase(),
      cat: params.cat || '',
    };
  }

  const visible = (d) => state.products.filter((p) =>
    !p.archived && (!d.cat || p.folder === d.cat) && (!d.q || hay(p).includes(d.q)));

  /* ================================== shell =========================================== */

  function shell(d) {
    // 'all' is the built-in catch-all folder; as an option it reads as a second
    // "All categories" and filters to almost nothing. It is not a category.
    const cats = ['<option value="">All categories</option>'].concat(
      state.folders.filter((f) => f.id !== 'all')
        .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`)).join('');
    const reasons = ['<option value="">All reasons</option>'].concat(
      Object.entries(STOCK_REASONS).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)).join('');

    const filters = d.tab === 'movements'
      ? `<select class="bo-select" id="invReason">${reasons}</select>
         <input type="date" class="bo-date" id="invFrom" aria-label="From date">
         <input type="date" class="bo-date" id="invTo" aria-label="To date">
         <button class="secondary-btn small" data-act="export">Export CSV</button>`
      : `<select class="bo-select" id="invCat">${cats}</select>`;

    return `
      <div class="view-head">
        <div class="view-title-wrap">
          <h1>Inventory</h1>
          <span class="muted" id="invSub"></span>
        </div>
        <div class="view-actions">
          <input class="search-input small q-input" id="invSearch" type="search"
                 placeholder="Search products…" autocomplete="off">
          ${filters}
          <button class="secondary-btn small" data-act="receive">Receive stock</button>
          <button class="primary-btn small" data-act="doc-new">New adjustment</button>
        </div>
      </div>
      <div class="dash-stack" id="invBody"></div>
      <dialog id="adjustDlg" class="bo-dialog adj-dlg"></dialog>`;
  }

  function card(label, sub, inner, right = '', pager = '') {
    return `
      <section class="bo-card">
        <div class="bo-card-head">
          <span class="bo-card-label">${escapeHtml(label)}</span>
          ${sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : '<span class="bo-card-sub"></span>'}
          ${right}
        </div>
        <div class="bo-card-inset flush"><div class="table-wrap">${inner}</div>${pager}</div>
      </section>`;
  }

  const empty = (msg) => `<tr><td colspan="12" class="bo-empty">${escapeHtml(msg)}</td></tr>`;

  /* ================================ tab 1 — on hand =================================== */

  function stockTab(d) {
    const list = visible(d).sort((a, b) =>
      urgency(a) - urgency(b) ||
      (a.stock / (a.reorderPoint || 1)) - (b.stock / (b.reorderPoint || 1)));

    let units = 0, value = 0, low = 0, out = 0;
    list.forEach((p) => {
      units += Number(p.stock) || 0;
      value += stockValue(p);
      if (Number(p.stock) <= 0) out++; else if (isLow(p)) low++;
    });

    const kpis = `<div class="kpi-row">
      ${kpi('SKUs tracked', list.length.toLocaleString('en-PH'), d.q || d.cat ? 'matching filter' : 'active items')}
      ${kpi('Total units', Math.round(units).toLocaleString('en-PH'), 'on the shelf')}
      ${kpi('Stock value at cost', pesoShort(value), 'what it cost us')}
      ${kpi('Low stock', String(low), 'at or below danger level', low ? 'down' : 'flat')}
      ${kpi('Out of stock', String(out), 'nothing on hand', out ? 'down' : 'flat')}
    </div>`;

    const pg = paginate(list, d.params.page);
    const rows = pg.rows.map((p) => {
      const [tone, label] = statusOf(p);
      const sold = sold30(d.byProduct.get(p.id));
      return `
        <tr>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td class="inv-cat">${escapeHtml(folderName(p.folder))}</td>
          <td class="num"><strong>${fmtQty(p, p.stock)}</strong> ${escapeHtml(p.unit || '')}</td>
          <td class="num inv-soft">${sold ? fmtQty(p, sold) : '—'}</td>
          <td><span class="status-pill ${tone}">${label}</span></td>
          <td class="num"><button class="secondary-btn small" data-adjust-open="${escapeHtml(p.id)}">Adjust</button></td>
        </tr>
`;
    }).join('') || empty(d.q || d.cat ? 'No products match those filters.' : 'No products yet — add them in Products.');

    // What it is, where it belongs, how many, how fast it goes, is that a problem, fix
    // it. SKU, danger level and value at cost stayed off — the rest lives in Needs
    // buying and Movement history.
    return kpis + card('On hand', `${list.length} item${list.length === 1 ? '' : 's'}`, `
      <table class="data-table inv-stock">
        <thead><tr>
          <th>Product</th><th class="inv-cat">Category</th>
          <th class="num">On hand</th><th class="num">Sold 30d</th>
          <th>Status</th><th class="num">Adjust</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`, '', pagerHtml(pg));
  }

  function adjustPanel(p, last) {
    const events = ADJ_EVENTS.map(([v, label]) =>
      `<option value="${v}">${escapeHtml(label)}</option>`).join('');
    const who = state.settings.store?.cashier || '';
    const staff = loadStaff().filter((u) => u.active).map((u) =>
      `<option value="${escapeHtml(u.name)}" ${u.name === who ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
    const step = stepFor(p);
    return `
      <div class="bod-head">
        <div class="bod-title"><h2>${escapeHtml(p.name)}</h2></div>
        <button type="button" class="bod-close" aria-label="Close">&times;</button>
      </div>
      <div class="adj-body">
        <form class="adj-form" data-adjust="${escapeHtml(p.id)}">
          <div class="adj-grid">
            <label class="adj-field"><span>What happened</span>
              <select name="event">${events}</select></label>
            <label class="adj-field"><span class="adj-qty-label">Quantity to add</span>
              <input name="qty" type="number" min="0" step="${step}" value="" inputmode="decimal" autocomplete="off"></label>
            <label class="adj-field"><span class="adj-date-label">${dateLabel('add')}</span>
              <input name="date" type="date" value="${isoDate(Date.now())}" max="${isoDate(Date.now())}"></label>
            <label class="adj-field"><span>Staff</span>
              <select name="staff">${staff || '<option value="">—</option>'}</select></label>
            <label class="adj-field adj-note"><span>Note</span>
              <input name="note" type="text" placeholder="Why did the stock move?" autocomplete="off"></label>
          </div>
          <div class="adj-foot">
            <span class="adj-preview">On hand ${fmtQty(p, p.stock)} ${escapeHtml(p.unit || '')}</span>
            <span class="adj-last">Last movement ${last ? escapeHtml(txTime(last.ts)) : '—'}</span>
            <button type="button" class="secondary-btn small" data-act="adjust-cancel">Cancel</button>
            <button type="submit" class="primary-btn small">Save movement</button>
          </div>
        </form>
      </div>`;
  }

  // The form is the whole point of the popup, so it is built and shown in one step.
  function openAdjustDialog(id) {
    const d = collect();
    const p = d.byId.get(id);
    const dlg = root().querySelector('#adjustDlg');
    if (!p || !dlg) return;
    dlg.innerHTML = adjustPanel(p, (d.byProduct.get(id) || []).slice(-1)[0]);
    dlg.showModal();
    const first = dlg.querySelector('select, input');
    if (first) first.focus();
  }

  const closeAdjustDialog = () => root()?.querySelector('#adjustDlg')?.close();

  /* ============================ tab 2 — movement history ============================== */

  function filteredMovements(d) {
    const reason = d.params.reason || '';
    const from = d.params.from || '';
    const to = d.params.to || '';
    const out = [];
    for (let i = d.movements.length - 1; i >= 0; i--) {   // newest first, one pass
      const m = d.movements[i];
      if (reason && m.reason !== reason) continue;
      const day = isoDate(m.ts);          // local day — UTC slice put early-morning rows on the wrong day
      if (from && day < from) continue;
      if (to && day > to) continue;
      const p = d.byId.get(m.productId);
      if (d.cat && (!p || p.folder !== d.cat)) continue;
      if (d.q) {
        const text = `${p ? hay(p) : m.productId} ${m.note || ''} ${m.refId || ''} ${m.staff || ''}`.toLowerCase();
        if (!text.includes(d.q)) continue;
      }
      out.push(m);
    }
    return out;
  }

  // A movement's refId is the internal order/PO id -- unreadable, and it is the one column
  // that ties a stock change back to a piece of paper on the counter. Map it to the receipt
  // or PO number people actually quote. Built here, not in collect(), so the other two tabs
  // do not pay for a pass over a year of orders.
  function refNumbers() {
    const m = new Map();
    loadOrders().forEach((o) => m.set(o.id, o.number));
    loadPurchaseOrders().forEach((po) => m.set(po.id, po.number));
    return m;
  }

  function movementsTab(d) {
    const all = filteredMovements(d);
    const pg = paginate(all, d.params.page);
    const refNo = refNumbers();

    const rows = pg.rows.map((m) => {
      const p = d.byId.get(m.productId);
      const bal = d.balance.get(m.id);
      const tone = m.qty >= 0 ? 'ok' : 'danger';
      return `
        <tr>
          <td class="tx-time">${escapeHtml(txTime(m.ts))}</td>
          <td>${escapeHtml(p ? p.name : m.productId || '—')}</td>
          <td><span class="status-pill ${REASON_TONE[m.reason] || 'muted'}">${escapeHtml(STOCK_REASONS[m.reason] || m.reason)}</span></td>
          <td class="num ${tone}">${fmtSigned(p, m.qty)}</td>
          <td class="num">${m.unitCost == null ? '—' : peso(m.unitCost)}</td>
          <td class="num">${bal == null ? '—' : fmtQty(p, bal)}</td>
          <td class="mono">${escapeHtml(refNo.get(m.refId) || m.refId || '—')}</td>
          <td>${escapeHtml(m.note || '—')}</td>
          <td>${escapeHtml(m.staff || '—')}</td>
        </tr>`;
    }).join('') || empty('No stock movements match those filters.');

    return card('Movement history', `showing ${pg.rows.length} of ${all.length}`, `
      <table class="data-table">
        <thead><tr>
          <th>When</th><th>Product</th><th>Reason</th><th class="num">Qty</th><th class="num">Unit cost</th>
          <th class="num">Balance</th><th>Ref</th><th>Note</th><th>Staff</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`, '', pagerHtml(pg));
  }

  function exportMovements(d) {
    const rows = [['when', 'product', 'sku', 'reason', 'qty', 'unit_cost', 'balance', 'ref', 'note', 'staff']];
    const refNo = refNumbers();
    filteredMovements(d).forEach((m) => {
      const p = d.byId.get(m.productId);
      rows.push([m.ts, p ? p.name : m.productId, p ? p.sku : '', STOCK_REASONS[m.reason] || m.reason,
        m.qty, m.unitCost == null ? '' : m.unitCost, d.balance.get(m.id) ?? '', refNo.get(m.refId) || m.refId || '', m.note || '', m.staff || '']);
    });
    downloadCsv(`stock-movements-${isoDate(Date.now())}.csv`, rows);
  }

  /* ============================== tab 3 — needs buying ================================ */

  /* One button per row, and no "apply all". Repricing is a decision per product -- some
     rises get absorbed to hold a customer, some get passed on the same day -- and a bulk
     button would make that decision for all of them at once, silently. The row is a link
     into the product editor for anything that needs more thought than this. */
  function costTab(d) {
    const rows = costDrift(visible(d), d.movements, loadPurchaseOrders());
    if (!rows.length) {
      return `<section class="bo-card"><div class="bo-card-head"><span class="bo-card-label">Cost changes</span></div>
        <div class="bo-card-inset"><div class="bo-empty">${d.q || d.cat
          ? 'No products match those filters.'
          : 'Every product is priced off what it last cost. Nothing to review.'}</div></div></section>`;
    }
    const up = rows.filter((r) => r.gap > 0).length;
    const body = rows.map((r) => {
      const p = r.p;
      const canReprice = r.suggested != null && r2(r.suggested) !== r2(p.price);
      return `
        <tr>
          <td><a class="link-btn" href="${Router.href('products', p.id)}"><strong>${escapeHtml(p.name)}</strong></a></td>
          <td class="inv-cat">${escapeHtml(folderName(p.folder))}</td>
          <td class="num inv-soft">${peso(r.book)}</td>
          <td class="num"><strong>${peso(r.paid)}</strong></td>
          <td class="num"><span class="kpi-delta ${r.gap > 0 ? 'down' : 'up'}">${r.gapPct == null
            ? 'no cost on file'
            : `${r.gap > 0 ? '+' : '−'}${Math.abs(r.gapPct).toFixed(1)}%`}</span></td>
          <td class="num inv-soft">${escapeHtml(shortDate(r.at))}</td>
          <td class="num">${peso(p.price)}</td>
          <td class="num">${r.suggested == null ? '—' : `<strong>${peso(r.suggested)}</strong>`}</td>
          <td class="num inv-soft">${r.bookMarkup.toFixed(1)}% → ${r.nowMarkup.toFixed(1)}%</td>
          <td class="num">${canReprice
            ? `<button class="secondary-btn small" data-act="reprice" data-reprice="${escapeHtml(p.id)}">Apply</button>`
            : '—'}</td>
        </tr>`;
    }).join('');

    const note = `<div class="sales-note">Gross profit on Sales is worked out from the Cost column, not from what
      the last delivery actually charged. While these disagree, ${up ? 'profit is being reported higher than it was earned' : 'profit is being reported lower than it was earned'}.</div>`;

    return note + card('Cost changes', `${rows.length} product${rows.length === 1 ? '' : 's'} · ${up} went up`, `
      <table class="data-table inv-cost">
        <thead><tr>
          <th>Product</th><th class="inv-cat">Category</th>
          <th class="num">Cost on file</th><th class="num">Last paid</th><th class="num">Change</th>
          <th class="num">Delivered</th><th class="num">Price now</th><th class="num">Holds margin at</th>
          <th class="num">Markup</th><th class="num">Apply</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>`);
  }

  function reorderTab(d) {
    const groups = reorderGroups(visible(d));
    if (!groups.size) {
      return `<section class="bo-card"><div class="bo-card-head"><span class="bo-card-label">Needs buying</span></div>
        <div class="bo-card-inset"><div class="bo-empty">Nothing is at or below its reorder point.</div></div></section>`;
    }
    const names = new Map(loadSuppliers().map((s) => [s.id, s.name]));
    let grand = 0;

    const cards = Array.from(groups, ([supplierId, items]) => {
      let total = 0;
      const rows = items.map((p) => {
        const qty = orderQty.has(p.id) ? orderQty.get(p.id) : suggestQty(p);
        const line = r2((Number(p.cost) || 0) * qty);
        total = r2(total + line);
        return `
          <tr>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td class="inv-cat">${escapeHtml(folderName(p.folder))}</td>
            <td class="num">${fmtQty(p, p.stock)}</td>
            <td class="num">${fmtQty(p, p.reorderPoint)}</td>
            <td class="num inv-soft">${fmtQty(p, suggestQty(p))}</td>
            <td class="num"><input class="inv-qty" type="number" min="0" step="${stepFor(p)}"
                 value="${qty}" data-qty="${escapeHtml(p.id)}" aria-label="Order quantity"></td>
            <td class="num">${peso(p.cost)}</td>
            <td class="num"><strong>${peso(line)}</strong></td>
          </tr>`;
      }).join('');
      grand = r2(grand + total);

      return card(names.get(supplierId) || 'No supplier',
        `${items.length} item${items.length === 1 ? '' : 's'} · ${peso(total)}`, `
        <table class="data-table inv-buy">
          <thead><tr>
            <th>Product</th><th class="inv-cat">Category</th>
            <th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Suggested</th>
            <th class="num">Order qty</th><th class="num">Cost</th><th class="num">Line cost</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="7">Total to buy</td><td class="num"><strong>${peso(total)}</strong></td></tr></tfoot>
        </table>`,
        `<button class="primary-btn small" data-act="po" data-supplier="${escapeHtml(supplierId)}">Create purchase order</button>`);
    }).join('');

    // One supplier already has its total in the card foot; only a split list needs a sum.
    return cards + (groups.size > 1
      ? `<div class="inv-grand"><span>Total to buy, all suppliers</span><strong class="num">${peso(grand)}</strong></div>`
      : '');
  }

  /* ======================= the adjustment document (its own URL) ====================== */

  function newDraft() {
    const who = (state.settings.store && state.settings.store.cashier) || '';
    const people = loadStaff().filter((u) => u.active);
    return {
      id: newId('adj'), reason: 'count',
      staff: people.some((u) => u.name === who) ? who : (people[0] ? people[0].name : ''),
      date: isoDate(Date.now()), note: '', lines: [{ productId: '', counted: '' }],
    };
  }

  const docHead = (title, sub, actions) => `
    <div class="view-head">
      <div class="view-title-wrap">
        <a class="link-btn" href="${Router.href(VIEW, '', {})}">&larr; Inventory</a>
        <h1>${escapeHtml(title)}</h1>
        <span class="muted">${escapeHtml(sub)}</span>
      </div>
      <div class="view-actions">${actions}</div>
    </div>`;

  function deltaText(p, line) {
    if (!p || line.counted === '' || line.counted == null) return '\u2014';
    const counted = roundQty(p, line.counted);
    return `${fmtQty(p, p.stock)} \u2192 ${fmtQty(p, counted)} = ${fmtSigned(p, countDelta(p.stock, counted))}`;
  }

  function docFootText(byId) {
    const mv = documentMovements(draft, (id) => byId.get(id));
    const net = mv.reduce((n, m) => r2(n + m.qty), 0);
    const sign = net > 0 ? '+' : net < 0 ? '\u2212' : '';
    return `${mv.length} item${mv.length === 1 ? '' : 's'} moving \u00b7 net ${sign}${Math.abs(net).toLocaleString('en-PH')}`;
  }

  function draftRows(byId) {
    return draft.lines.map((ln, i) => {
      const p = byId.get(ln.productId);
      return `
        <tr data-line="${i}">
          <td><input class="text-input doc-pick" list="invPickList" data-field="product"
               value="${escapeHtml(p ? pickerLabel(p) : '')}" placeholder="Search product\u2026" autocomplete="off"></td>
          <td class="num">${p ? `${fmtQty(p, p.stock)} ${escapeHtml(p.unit || '')}` : '\u2014'}</td>
          <td class="num"><input class="inv-qty" type="number" min="0" step="${p ? stepFor(p) : 1}"
               data-field="counted" value="${escapeHtml(String(ln.counted))}" ${p ? '' : 'disabled'}
               inputmode="decimal" autocomplete="off" aria-label="Counted quantity"></td>
          <td class="num doc-delta">${deltaText(p, ln)}</td>
          <td class="num"><button type="button" class="secondary-btn small" data-act="line-del"
               aria-label="Remove line">Remove</button></td>
        </tr>`;
    }).join('');
  }

  function draftView(byId) {
    const reasons = Object.entries(STOCK_REASONS).map(([k, v]) =>
      `<option value="${k}" ${k === draft.reason ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    const people = loadStaff().filter((u) => u.active).map((u) =>
      `<option value="${escapeHtml(u.name)}" ${u.name === draft.staff ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
    // One datalist for the whole document \u2014 the picker is native, no dropdown library.
    const options = state.products.filter((p) => !p.archived)
      .map((p) => `<option value="${escapeHtml(pickerLabel(p))}"></option>`).join('');

    return docHead('New adjustment', 'One reason, one person, many lines',
      `<button class="secondary-btn small" data-act="doc-cancel">Cancel</button>
       <button class="primary-btn small" data-act="doc-save">Save adjustment</button>`) + `
      <datalist id="invPickList">${options}</datalist>
      <div class="dash-stack">
        <section class="bo-card">
          <div class="bo-card-head"><span class="bo-card-label">Document</span>
            <span class="bo-card-sub">applies to every line below</span></div>
          <div class="bo-card-inset">
            <div class="adj-grid">
              <label class="adj-field"><span>Reason</span>
                <select class="bo-select" data-doc="reason">${reasons}</select></label>
              <label class="adj-field"><span>Staff</span>
                <select class="bo-select" data-doc="staff">${people || '<option value="">\u2014</option>'}</select></label>
              <label class="adj-field"><span>Date</span>
                <input type="date" class="bo-date" data-doc="date" value="${escapeHtml(draft.date)}" max="${isoDate(Date.now())}"></label>
              <label class="adj-field adj-note"><span>Note</span>
                <input type="text" class="text-input" data-doc="note" value="${escapeHtml(draft.note)}"
                       placeholder="Why is this being counted?" autocomplete="off"></label>
            </div>
          </div>
        </section>
        <section class="bo-card">
          <div class="bo-card-head"><span class="bo-card-label">Items</span>
            <span class="bo-card-sub" id="docFoot">${escapeHtml(docFootText(byId))}</span></div>
          <div class="bo-card-inset flush"><div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Product</th><th class="num">On hand now</th><th class="num">Counted</th>
                <th class="num">Change</th><th class="num"></th></tr></thead>
              <tbody id="docLines">${draftRows(byId)}</tbody>
            </table>
            <div class="inv-more"><button class="secondary-btn small" data-act="line-add">Add item</button></div>
          </div></div>
        </section>
      </div>`;
  }

  function savedView(doc) {
    const lines = doc.lines || [];
    const rows = lines.map((ln) => `
      <tr>
        <td>${escapeHtml(ln.name || ln.productId)}</td>
        <td class="num">${ln.before}</td>
        <td class="num">${ln.counted}</td>
        <td class="num ${ln.delta >= 0 ? 'ok' : 'danger'}">${ln.delta > 0 ? '+' : ln.delta < 0 ? '\u2212' : ''}${Math.abs(ln.delta)}</td>
        <td class="num">${ln.unitCost == null ? '\u2014' : peso(ln.unitCost)}</td>
      </tr>`).join('') || empty('This adjustment moved nothing.');

    return docHead(STOCK_REASONS[doc.reason] || 'Adjustment',
      `${doc.date} \u00b7 ${doc.staff || '\u2014'} \u00b7 ${lines.length} item${lines.length === 1 ? '' : 's'}`,
      '<button class="secondary-btn small" data-act="doc-new">New adjustment</button>') + `
      <div class="dash-stack">
        ${card('Items moved', doc.note || 'No note', `
          <table class="data-table">
            <thead><tr><th>Product</th><th class="num">Was</th><th class="num">Counted</th>
              <th class="num">Change</th><th class="num">Unit cost</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`)}
        <div class="inv-grand"><span>Adjustments are append-only \u2014 a correction is a new
          adjustment, never an edit of this one.</span></div>
      </div>`;
  }

  // `/admin/inventory/adjust/new` and `/admin/inventory/adjust/<id>`.
  function documentView(docId, byId) {
    if (docId === 'new') {
      if (!draft) draft = newDraft();
      return draftView(byId);
    }
    const doc = loadAdjustments().find((a) => a.id === docId);
    return doc ? savedView(doc)
      : docHead('Adjustment not found', docId, '') + '<div class="bo-empty">No saved adjustment with that id.</div>';
  }

  function saveDraft(byId) {
    const movements = documentMovements(draft, (id) => byId.get(id));
    if (!movements.length) { showToast('Nothing counted differently \u2014 no movement to save'); return; }
    // Snapshot the figures onto the document: read back next year it has to show what was
    // counted then, not what the shelf holds today.
    const lines = movements.map((m) => {
      const p = byId.get(m.productId);
      const before = r2(Number(p.stock) || 0);
      return { productId: p.id, name: p.name, before, counted: r2(before + m.qty),
        delta: m.qty, unitCost: m.unitCost };
    });
    movements.forEach((m) => applyMovement(byId.get(m.productId), m));  // stamps balanceAfter, so before the append
    appendMovements(movements);
    saveProducts();
    saveAdjustments(loadAdjustments().concat({
      id: draft.id, reason: draft.reason, staff: draft.staff, date: draft.date,
      note: draft.note, lines, createdAt: new Date().toISOString(),
    }));
    const id = draft.id;
    draft = null;
    refreshSharedState();
    showToast(`Adjustment saved \u00b7 ${movements.length} item${movements.length === 1 ? '' : 's'} moved`);
    Router.go(VIEW, 'adjust/' + id, {}, { replace: true });
  }

  /* ================================== rendering ======================================= */

  function render() {
    const r = root();
    if (!r) return;
    const d = collect();
    // A record has its own URL — clicking through never opens a modal.
    if (d.docId) {
      r.dataset.tab = '';
      r.innerHTML = documentView(d.docId, d.byId);
      return;
    }
    // Rebuild the shell only when the tab changes — a keystroke must not blow away the
    // search box the user is typing into.
    if (r.dataset.tab !== d.tab) {
      r.innerHTML = shell(d);
      r.dataset.tab = d.tab;
    }
    syncControls(d);
    r.querySelector('#invBody').innerHTML =
      d.tab === 'movements' ? movementsTab(d) : d.tab === 'reorder' ? reorderTab(d)
      : d.tab === 'cost' ? costTab(d) : stockTab(d);
  }

  function syncControls(d) {
    const r = root();
    const set = (sel, value) => {
      const el = r.querySelector(sel);
      if (el && el !== document.activeElement && el.value !== value) el.value = value;
    };
    set('#invSearch', state.invQuery || '');
    set('#invCat', d.cat);
    set('#invReason', d.params.reason || '');
    set('#invFrom', d.params.from || '');
    set('#invTo', d.params.to || '');
    r.querySelector('#invSub').textContent = TABS[d.tab] + (d.tab === 'stock'
      ? ' · stock only changes by writing a movement' : '');
  }

  const renderBody = () => render();

  /* ================================ the write path ==================================== */

  function commit(form) {
    const p = state.products.find((x) => x.id === form.dataset.adjust);
    if (!p) return;
    const [reason, mode] = adjEvent(form);
    const typed = Number(form.elements.qty.value);
    if (!Number.isFinite(typed) || (mode !== 'set' && typed <= 0)) {
      showToast('Enter a quantity');
      form.elements.qty.focus();
      return;
    }
    const on = Number(p.stock) || 0;
    const qty = roundQty(p, typed);
    const delta = mode === 'set' ? countDelta(on, qty) : mode === 'remove' ? -qty : qty;
    if (!delta) { showToast('That is no change at all'); return; }

    const note = form.elements.note.value.trim();
    // An unexplained adjustment is exactly the thing nobody can audit later.
    if (reason === 'adjustment' && !note) {
      showToast('An adjustment needs a note');
      form.elements.note.focus();
      return;
    }
    const mv = stockMovement({
      product: p, delta, reason, note, staff: form.elements.staff.value,
      expected: mode === 'set' ? on : null, counted: mode === 'set' ? qty : null,
      happenedOn: form.elements.date.value,
    });   // no cost typed here - the movement takes the product's cost
    applyMovement(p, mv);          // never assign stock bare; stamps balanceAfter, so before the append
    appendMovements([mv]);
    saveProducts();
    closeAdjustDialog();
    refreshSharedState();
    renderCurrentView();
    showToast(`${p.name}: ${fmtSigned(p, delta)} ${p.unit || ''} → ${fmtQty(p, p.stock)} on hand`);
  }

  /* Cost and price move together or the fix is only half done: writing the new cost alone
     would correct the reports and quietly leave the shelf price earning less than it was
     set to earn. Both are one decision, so they are one button. */
  function reprice(productId, d) {
    const row = costDrift(visible(d), d.movements, loadPurchaseOrders()).find((r) => r.p.id === productId);
    if (!row || row.suggested == null) return;
    const p = row.p;
    const was = p.price;
    p.cost = row.paid;
    p.price = r2(row.suggested);
    p.marginValue = marginFromPrice(p.cost, p.price, p.marginMode === 'flat' ? 'flat' : 'percent');
    p.updatedAt = new Date().toISOString();
    const who = actor();
    // Apply takes the suggested price as-is, so the choice is always the suggestion.
    appendEvents('decisions', [makeEvent({
      kind: 'reprice', subjectId: p.id,
      inputs: { bookCost: row.book, paidCost: row.paid, gapPct: row.gapPct, price: was,
        marginMode: p.marginMode === 'flat' ? 'flat' : 'percent', deliveryRefId: row.refId },
      rule: 'costDrift heldPrice v1',
      choice: { cost: p.cost, price: p.price }, accepted: true, actor: who,
    }, who)]);
    saveProducts('reprice from cost changes');
    refreshSharedState();
    renderCurrentView();
    showToast(`${p.name}: cost ${peso(row.book)} → ${peso(p.cost)}, price ${peso(was)} → ${peso(p.price)}`);
  }

  // Who pressed the button, for the decision log. Same fallback saveProducts uses for priceLog.
  // actor() lives in backoffice.js: every event log names the same person.

  function createPo(supplierId, d) {
    const items = (reorderGroups(visible(d)).get(supplierId) || []).map((p) =>
      poLine(p.id, orderQty.has(p.id) ? orderQty.get(p.id) : suggestQty(p), p.cost));
    if (!items.length) return;
    const all = loadPurchaseOrders();
    const po = {
      ...PO_DEFAULTS, id: newId('po'), supplierId, status: 'draft',
      number: 'PO-' + String(all.length + 1).padStart(4, '0'),
      items, updatedAt: new Date().toISOString(),
    };
    savePurchaseOrders(all.concat(po));
    appendEvents('decisions', reorderDecisions(items, d.byId, po.id, actor()));
    showToast(`Draft ${po.number} created with ${items.length} line${items.length === 1 ? '' : 's'}`);
    Router.go('suppliers', po.id);
  }

  /* =========================== one listener per event type ============================ */

  const mine = (e) => {
    const r = root();
    return r && r.contains(e.target) ? r : null;
  };

  function updatePreview(form) {
    const p = state.products.find((x) => x.id === form.dataset.adjust);
    if (!p) return;
    const [, mode] = adjEvent(form);
    const on = Number(p.stock) || 0;
    const typed = Number(form.elements.qty.value);
    const unit = p.unit || '';
    const out = form.querySelector('.adj-preview');
    if (!Number.isFinite(typed) || form.elements.qty.value === '') {
      out.textContent = `On hand ${fmtQty(p, on)} ${unit}`;
      return;
    }
    const qty = roundQty(p, typed);
    const delta = mode === 'set' ? countDelta(on, qty) : mode === 'remove' ? -qty : qty;
    out.textContent = mode === 'set'
      ? `On hand ${fmtQty(p, on)}, counted ${fmtQty(p, qty)} → ${fmtSigned(p, delta)}`
      : `On hand ${fmtQty(p, on)} → ${fmtQty(p, on + delta)} ${unit}`;
  }

  const productMap = () => new Map(state.products.map((p) => [p.id, p]));

  // Typed text back to a product: the datalist option, then a bare name, then a SKU.
  function resolveProduct(label) {
    const want = String(label || '').trim().toLowerCase();
    if (!want) return '';
    const live = state.products.filter((x) => !x.archived);
    const p = live.find((x) => pickerLabel(x).toLowerCase() === want)
      || live.find((x) => String(x.name).toLowerCase() === want)
      || live.find((x) => String(x.sku || '').toLowerCase() === want);
    return p ? p.id : '';
  }

  // Only the line rows and the footer — retyping the whole document would eat the caret.
  function renderLines(focusLine) {
    const r = root();
    const byId = productMap();
    r.querySelector('#docLines').innerHTML = draftRows(byId);
    r.querySelector('#docFoot').textContent = docFootText(byId);
    if (focusLine != null) {
      const el = r.querySelector(`tr[data-line="${focusLine}"] .doc-pick`);
      if (el) el.focus();
    }
  }

  const lineOf = (el) => draft && draft.lines[Number(el.closest('tr').dataset.line)];

  document.addEventListener('click', (e) => {
    if (!mine(e)) return;
    const el = e.target.closest('button');
    if (!el) return;

    if (el.dataset.adjustOpen) return openAdjustDialog(el.dataset.adjustOpen);
    switch (el.dataset.act) {
      case 'receive': return Router.go('suppliers', '');   // receiving is a PO action, and Suppliers owns it
      case 'export': return exportMovements(collect());
      case 'adjust-cancel': return closeAdjustDialog();
      case 'po': return createPo(el.dataset.supplier, collect());
      case 'reprice': return reprice(el.dataset.reprice, collect());
      case 'doc-new': return Router.go(VIEW, 'adjust/new');
      case 'doc-cancel': draft = null; return Router.go(VIEW, '');
      case 'doc-save': return saveDraft(productMap());
      case 'line-add':
        draft.lines.push({ productId: '', counted: '' });
        return renderLines(draft.lines.length - 1);
      case 'line-del':
        draft.lines.splice(Number(el.closest('tr').dataset.line), 1);
        if (!draft.lines.length) draft.lines.push({ productId: '', counted: '' });
        return renderLines();
    }
  });

  document.addEventListener('submit', (e) => {
    if (!mine(e) || !e.target.dataset.adjust) return;
    e.preventDefault();
    commit(e.target);
  });

  document.addEventListener('input', (e) => {
    if (!mine(e)) return;
    const el = e.target;
    if (el.name === 'qty') return updatePreview(el.closest('form'));
    if (el.dataset.field === 'counted' && draft) {          // live delta, no re-render
      const ln = lineOf(el);
      ln.counted = el.value;
      el.closest('tr').querySelector('.doc-delta').textContent =
        deltaText(productMap().get(ln.productId), ln);
      root().querySelector('#docFoot').textContent = docFootText(productMap());
    }
  });

  document.addEventListener('change', (e) => {
    if (!mine(e)) return;
    const el = e.target;
    if (el.name === 'event') {
      const form = el.closest('form');
      form.querySelector('.adj-qty-label').textContent = qtyLabel(adjEvent(form)[1]);
      form.querySelector('.adj-date-label').textContent = dateLabel(adjEvent(form)[1]);
      return updatePreview(form);
    }
    if (el.id === 'invCat') return Router.setParams({ cat: el.value, page: '' });
    if (el.id === 'invReason') return Router.setParams({ reason: el.value, page: '' });
    if (el.id === 'invFrom') return Router.setParams({ from: el.value, page: '' });
    if (el.id === 'invTo') return Router.setParams({ to: el.value, page: '' });
    if (el.dataset.doc && draft) { draft[el.dataset.doc] = el.value; return; }
    if (el.dataset.field === 'product' && draft) {
      lineOf(el).productId = resolveProduct(el.value);      // step + on-hand depend on it
      return renderLines();
    }
    if (el.dataset.qty) {                                  // reorder override — page state, not the URL
      const n = Number(el.value);
      orderQty.set(el.dataset.qty, Number.isFinite(n) && n > 0 ? n : 0);
      renderBody();
    }
  });

  window.renderInventory = render;
})();
