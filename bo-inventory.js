/* Back office — Inventory. Renders the whole #view section; see CONTRACT.

   Products creates items; Inventory only moves stock. Nothing in this file
   creates a product: it writes stock_movements and reads them back, which is
   also the only way `product.stock` is ever allowed to change.               */
(function () {
  const VIEW = 'inventory';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);
  // Stock history is one page (owner, 2026-09-23): KPIs, the latest movements and price changes,
  // and a rail of lost demand and shelf checks. Each block's View all opens its full page here,
  // not in the sidebar. The two insight pages come from bo-insights.js.
  const TABS = { overview: 'Stock history', movements: 'Movements', prices: 'Price changes',
    lost: 'Lost demand', counts: 'Shelf check' };
  const INSIGHT_TABS = ['lost', 'counts'];
  const FULL_PAGES = ['movements', 'prices', 'lost', 'counts'];   // these get "← Stock history"
  // One sidebar entry; a full page falls back to def, so Stock history stays lit.
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).inventory =
    { param: 'tab', def: 'overview', items: [['overview', TABS.overview]] };

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

  /* ---- Low stock by supplier, for "Add low stock items" on a purchase order ----
     Every product at or below its reorderPoint, grouped by supplier, most urgent first.
     No forecast on purpose (owner, 2026-09-23): the POS knows sales and stock, not promos,
     seasons or cash, so the owner's reorder point is the rule and suggestQty tops it up. */
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

  const API = { r2, ceilStep, countDelta, suggestQty, runningBalances, urgency,
    stockMovement, documentMovements, lastPaid, heldPrice, costDrift,
    reorderGroups };
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

  // ponytail: the unsaved document lives in memory only, so navigating away loses it.
  // Persist it to hwpos.adjustments.v1 as a `draft` status if that ever bites.
  let draft = null;

  function collect() {
    const params = Router.route().params;
    const tab = TABS[params.tab] ? params.tab : 'overview';
    const byId = new Map(state.products.map((p) => [p.id, p]));
    const movements = loadMovements();
    const { byProduct, balance } = runningBalances(movements, (pid) => (byId.get(pid) || {}).stock || 0);
    // state.detailId is the segment after the view: '' | 'adjust/new' | 'adjust/<id>'.
    const detail = state.detailId || '';
    return {
      params, tab, movements, byId, byProduct, balance,
      docId: detail === 'adjust' ? 'new' : detail.startsWith('adjust/') ? detail.slice(7) : '',
      q: (state.invQuery || '').trim().toLowerCase(),
      // ?cat= is a comma list (Products' multi-pick writes one); the select here sends one.
      cats: (params.cat || '').split(',').filter(Boolean),
    };
  }

  const visible = (d) => state.products.filter((p) =>
    !p.archived && (!d.cats.length || d.cats.includes(p.folder)) && (!d.q || hay(p).includes(d.q)));

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
    // The insight cards (lost, counts) read no search or category, so they get neither.
    const search = `<input class="search-input small q-input" id="invSearch" type="search"
                 placeholder="Search products…" autocomplete="off">`;
    const insight = INSIGHT_TABS.includes(d.tab);
    const back = FULL_PAGES.includes(d.tab)
      ? `<a class="link-btn" href="${Router.href(VIEW, '', {})}">&larr; Stock history</a>` : '';
    const periods = `<div class="seg sh-period">${PERIOD_LIST.map(([k, label]) =>
      `<a class="seg-btn" data-p="${k}" href="${Router.href(VIEW, '', { period: k === PERIOD_DEF ? '' : k })}">${label}</a>`).join('')}</div>`;

    return `
      <div class="view-head">
        <div class="view-title-wrap">
          ${back}
          <h1 id="invTitle"></h1>
        </div>
        <div class="view-actions">
          ${d.tab === 'overview' ? periods : insight ? '' : search + filters}
          <button class="secondary-btn small" data-act="receive">Receive stock</button>
          <button class="primary-btn small" data-act="doc-new">New adjustment</button>
        </div>
      </div>
      <div class="dash-stack" id="invBody"></div>`;
  }

  function card(label, sub, inner, right = '', pager = '') {
    return `
      <section class="bo-card blk-table">
        <div class="bo-card-head">
          <span class="bo-card-label">${escapeHtml(label)}</span>
          ${sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : '<span class="bo-card-sub"></span>'}
          ${right}
        </div>
        <div class="bo-card-inset flush"><div class="table-wrap">${inner}</div>${pager}</div>
      </section>`;
  }

  const empty = (msg) => `<tr><td colspan="12" class="bo-empty">${escapeHtml(msg)}</td></tr>`;

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
  // #adjustDlg sits at body level so any page can open it: backoffice.js wires every
  // [data-adjust-open] in the document to this.
  function openAdjustDialog(id) {
    const p = state.products.find((x) => x.id === id);
    const dlg = document.getElementById('adjustDlg');
    if (!p || !dlg) return;
    dlg.innerHTML = adjustPanel(p, loadMovements().findLast((m) => m.productId === id));
    dlg.showModal();
    const first = dlg.querySelector('select, input');
    if (first) first.focus();
  }

  const closeAdjustDialog = () => document.getElementById('adjustDlg')?.close();

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
      if (d.cats.length && (!p || !d.cats.includes(p.folder))) continue;
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

  /* ============================== cost changes ========================================= */

  /* One button per row, and no "apply all". Repricing is a decision per product -- some
     rises get absorbed to hold a customer, some get passed on the same day -- and a bulk
     button would make that decision for all of them at once, silently. The row is a link
     into the product editor for anything that needs more thought than this. */
  function costTab(d, rows) {
    if (!rows.length) {
      return `<section class="bo-card blk-empty"><div class="bo-card-head"><span class="bo-card-label">Cost changes</span></div>
        <div class="bo-card-inset"><div class="bo-empty">${d.q || d.cats.length
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
          <td class="num"><span class="trend-plain ${r.gap > 0 ? 'down' : 'up'}">${r.gapPct == null
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
        <a class="link-btn" href="${Router.href(VIEW, '', {})}">&larr; Stock history</a>
        <h1>${escapeHtml(title)}</h1>
        ${sub ? `<span class="muted">${escapeHtml(sub)}</span>` : ''}
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

    return docHead('New adjustment', '',
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
        <section class="bo-card blk-table">
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
        <div class="bo-card inv-grand"><span>Adjustments are append-only \u2014 a correction is a new
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

  /* Every price and cost change, newest first. Green = good for margin (price up, cost down). Read-only: saveProducts (back office) and the
     POS already diff each save into priceLog, so this page records nothing. */
  const SOURCE_LABEL = { pos: 'POS', backoffice: 'Back office' };
  // Price changes = the price log plus Cost changes (with its Apply). The cost card leads
  // while it has something to act on, else it sits under the log.
  function pricesTab(d) {
    const drift = costDrift(visible(d), d.movements, loadPurchaseOrders());
    const cost = costTab(d, drift), log = priceLogCard(d);
    return drift.length ? cost + log : log + cost;
  }

  function priceLogCard(d) {
    const shown = new Set(visible(d).map((p) => p.id));
    const all = loadEvents('priceLog').filter((e) => shown.has(e.productId))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    const pg = paginate(all, d.params.page);
    const rows = pg.rows.map((e) => {
      const p = d.byId.get(e.productId);
      const pct = e.old ? ((e.new - e.old) / e.old) * 100 : null;
      return `
        <tr>
          <td class="tx-time">${escapeHtml(txTime(e.ts))}</td>
          <td><a class="link-btn" href="${Router.href('products', e.productId)}"><strong>${escapeHtml(p ? p.name : e.productId)}</strong></a></td>
          <td>${e.field === 'cost' ? 'Cost' : 'Price'}</td>
          <td class="num inv-soft">${e.old == null ? '—' : peso(e.old)}</td>
          <td class="num"><strong>${peso(e.new)}</strong></td>
          <td class="num">${pct == null ? '—' : `<span class="trend-plain ${(pct > 0) === (e.field !== 'cost') ? 'up' : 'down'}">${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%</span>`}</td>
          <td>${escapeHtml(e.staff || '—')}</td>
          <td class="inv-soft">${escapeHtml(SOURCE_LABEL[e.source] || e.source || '—')}</td>
        </tr>`;
    }).join('') || empty(d.q || d.cats.length ? 'No price changes match those filters.'
      : 'No price or cost changes yet. Every change from here on is logged.');
    return card('Price history', `showing ${pg.rows.length} of ${all.length}`, `
      <table class="data-table">
        <thead><tr>
          <th>When</th><th>Product</th><th>What</th><th class="num">From</th><th class="num">To</th>
          <th class="num">Change</th><th>Changed by</th><th>Where</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`, '', pagerHtml(pg));
  }

  /* ============================ Stock history — the overview ========================== */

  // Today runs from midnight and compares with all of yesterday; 7 and 30 are rolling windows
  // against the same length before them.
  // An array, not an object: numeric keys would sort ahead of 'today'.
  const PERIOD_LIST = [['today', 'Today', 'yesterday'], ['7', '7 days', 'previous 7 days'], ['30', '30 days', 'previous 30 days']];
  const PERIODS = Object.fromEntries(PERIOD_LIST.map(([k, ...rest]) => [k, rest]));
  const PERIOD_DEF = '7';
  const periodOf = (params) => (PERIODS[params.period] ? String(params.period) : PERIOD_DEF);
  function periodWindows(key, now = Date.now()) {
    if (key === 'today') {
      const mid = new Date(now).setHours(0, 0, 0, 0);
      return { cur: [mid, now + 1], prev: [mid - 864e5, mid] };
    }
    const span = Number(key) * 864e5;
    return { cur: [now - span, now + 1], prev: [now - 2 * span, now - span] };
  }
  const inWin = (t, [a, b]) => { const ms = new Date(t).getTime(); return ms >= a && ms < b; };

  // Stock in / out at cost, in centavos while adding. Counts stay out: a shelf check corrects
  // the number, it is not stock arriving or leaving.
  function flow(movements, byId, win) {
    let inC = 0, outC = 0, checks = 0;
    for (const m of movements) {
      if (!inWin(m.happenedOn || m.ts, win)) continue;
      if (m.reason === 'count') { if (Number(m.qty)) checks++; continue; }
      const cost = m.unitCost ?? (byId.get(m.productId) || {}).cost ?? 0;
      const c = Math.round(Math.abs(Number(m.qty) || 0) * Number(cost) * 100);
      if (m.qty > 0) inC += c; else outC += c;
    }
    return { in: inC / 100, out: outC / 100, checks };
  }

  const viewAll = (tab) => `<a class="link-btn view-all" href="${Router.href(VIEW, '', { tab })}">View all ›</a>`;
  const railMore = (tab) => `<a class="rail-more" href="${Router.href(VIEW, '', { tab })}">View all ›</a>`;
  const productLink = (d, id, text = '') => {
    const p = d.byId.get(id);
    return p ? `<a class="link-btn" href="${Router.href('products', id)}">${escapeHtml(p.name)}</a>` : escapeHtml(text || id || '—');
  };

  function overviewTab(d) {
    const key = periodOf(d.params), cmp = PERIODS[key][1], w = periodWindows(key);
    const priceLog = loadEvents('priceLog'), lost = loadEvents('lostDemand');
    const cur = flow(d.movements, d.byId, w.cur), prev = flow(d.movements, d.byId, w.prev);
    const n = (list, win) => list.filter((e) => inWin(e.ts, win)).length;
    // More lost requests or more shelf corrections is bad news, so those chips read the other way.
    const flip = (x) => ({ ...x, tone: x.tone === 'up' ? 'down' : x.tone === 'down' ? 'up' : x.tone });
    const cell = (label, value, c, p, bad) =>
      statCell({ label, value, delta: bad ? flip(deltaOf(c, p, cmp)) : deltaOf(c, p, cmp) });
    const lostNow = n(lost, w.cur), pricesNow = n(priceLog, w.cur);
    const kpis = `<section class="bo-card sh-kpi-card"><div class="stat-grid show-delta sh-kpis">${[
      cell('Stock added', pesoShort(cur.in), cur.in, prev.in),
      cell('Stock out', pesoShort(cur.out), cur.out, prev.out),
      cell('Price changes', pricesNow.toLocaleString('en-PH'), pricesNow, n(priceLog, w.prev)),
      cell('Lost requests', lostNow.toLocaleString('en-PH'), lostNow, n(lost, w.prev), true),
      cell('Shelf changes', cur.checks.toLocaleString('en-PH'), cur.checks, prev.checks, true),
    ].join('')}</div></section>`;

    // The latest 10 of each, whatever the period: the KPIs say how much, these say what.
    const moves = d.movements.slice(-10).reverse().map((m) => {
      const p = d.byId.get(m.productId), bal = d.balance.get(m.id);
      return `<tr>
        <td class="tx-time">${escapeHtml(txTime(m.ts))}</td>
        <td>${productLink(d, m.productId)}</td>
        <td><span class="status-pill ${REASON_TONE[m.reason] || 'muted'}">${escapeHtml(STOCK_REASONS[m.reason] || m.reason)}</span></td>
        <td class="num ${m.qty >= 0 ? 'ok' : 'danger'}">${fmtSigned(p, m.qty)}</td>
        <td class="num">${bal == null ? '—' : fmtQty(p, bal)}</td></tr>`;
    }).join('') || empty('No stock movements yet.');
    const moveCard = card('Movements', 'latest 10', `<table class="data-table">
      <thead><tr><th>When</th><th>Product</th><th>Reason</th><th class="num">Qty</th><th class="num">Balance</th></tr></thead>
      <tbody>${moves}</tbody></table>`, viewAll('movements'));

    const drift = costDrift(visible(d), d.movements, loadPurchaseOrders()).length;
    const prices = priceLog.slice().sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 10).map((e) => {
      const pct = e.old ? ((e.new - e.old) / e.old) * 100 : null;
      return `<tr>
        <td class="tx-time">${escapeHtml(txTime(e.ts))}</td>
        <td>${productLink(d, e.productId)}</td>
        <td>${e.field === 'cost' ? 'Cost' : 'Price'}</td>
        <td class="num"><span class="inv-soft">${e.old == null ? '—' : peso(e.old)} →</span> <strong>${peso(e.new)}</strong></td>
        <td class="num">${pct == null ? '—' : `<span class="trend-plain ${(pct > 0) === (e.field !== 'cost') ? 'up' : 'down'}">${pct > 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}%</span>`}</td></tr>`;
    }).join('') || empty('No price or cost changes yet.');
    const review = drift ? `<a class="link-btn sh-review" href="${Router.href(VIEW, '', { tab: 'prices' })}">${drift} cost${drift === 1 ? '' : 's'} to review</a>` : '';
    const priceCard = card('Price changes', 'latest 10', `<table class="data-table">
      <thead><tr><th>When</th><th>Product</th><th>What</th><th class="num">From → to</th><th class="num">Change</th></tr></thead>
      <tbody>${prices}</tbody></table>`, review + viewAll('prices'));

    // Rail: the dashboard's breakdown lists. Lost demand ranks what was asked for in the period.
    const asked = HWPOS_INSIGHTS.lostDemandSummary(lost.filter((e) => inWin(e.ts, w.cur)));
    const lostCard = `<section class="bo-card blk-kpi">${railMore('lost')}
      ${railHead('Lost demand', lostNow.toLocaleString('en-PH'), '<span class="kpi-note">requests</span>')}
      <div class="bd-rows">${asked.slice(0, 5).map((r) => bdRow(productLink(d, r.productId, r.text), `asked ${r.requests}×`)).join('')
        || bdRow('Nobody asked for anything you were out of')}</div></section>`;

    // Shelf check: the five latest counts that changed the number, "system → shelf".
    const counts = d.movements.filter((m) => m.reason === 'count' && Number(m.qty)).slice(-5).reverse();
    const shelfCard = `<section class="bo-card blk-kpi">${railMore('counts')}
      ${railHead('Shelf check', cur.checks.toLocaleString('en-PH'), '<span class="kpi-note">changes</span>')}
      <div class="bd-rows">${counts.map((m) => {
        const p = d.byId.get(m.productId);
        const was = m.expected == null ? '' : `${fmtQty(p, m.expected)} → ${fmtQty(p, m.counted)}`;
        return bdRow(productLink(d, m.productId), was, fmtSigned(p, m.qty), m.qty < 0 ? 'down' : 'up');
      }).join('') || bdRow('No shelf counts changed the number')}</div></section>`;

    return `${kpis}<div class="sh-grid"><div class="dash-main">${moveCard}${priceCard}</div>
      <div class="dash-rail">${lostCard}${shelfCard}</div></div>`;
  }

  function render() {
    const r = root();
    if (!r) return;
    const d = collect();
    // Old links: On hand is Products' stock view now, Cost changes lives on Price changes.
    if (!d.docId && d.params.tab === 'stock') {
      const { q, cat, level } = d.params;
      return Router.go('products', '', { view: 'stock', q, cat, level }, { replace: true });
    }
    if (!d.docId && d.params.tab === 'cost') return Router.setParams({ tab: 'prices' });
    // Needs buying was folded away: what is low lives in Products' stock view.
    if (!d.docId && d.params.tab === 'reorder') return Router.go('products', '', { view: 'stock', level: 'out,low' }, { replace: true });
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
      d.tab === 'overview' ? overviewTab(d) : d.tab === 'movements' ? movementsTab(d)
      : d.tab === 'prices' ? pricesTab(d) : HWPOS_INSIGHTS.card(d.tab, d.params);
  }

  function syncControls(d) {
    const r = root();
    const set = (sel, value) => {
      const el = r.querySelector(sel);
      if (el && el !== document.activeElement && el.value !== value) el.value = value;
    };
    set('#invSearch', state.invQuery || '');
    set('#invCat', d.cats[0] || '');
    set('#invReason', d.params.reason || '');
    set('#invFrom', d.params.from || '');
    set('#invTo', d.params.to || '');
    r.querySelector('#invTitle').textContent = TABS[d.tab];
    const p = periodOf(d.params);
    r.querySelectorAll('.sh-period .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.p === p));
  }


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

  // The adjust dialog lives at body level, outside the view root, so its events are gated
  // on the dialog rather than on mine().
  const inAdjust = (e) => !!(e.target.closest && e.target.closest('#adjustDlg'));

  document.addEventListener('click', (e) => {
    if (inAdjust(e) && e.target.closest('[data-act="adjust-cancel"]')) return closeAdjustDialog();
    if (!mine(e)) return;
    const el = e.target.closest('button');
    if (!el) return;

    switch (el.dataset.act) {
      case 'receive': return Router.go('suppliers', '');   // receiving is a PO action, and Suppliers owns it
      case 'export': return exportMovements(collect());
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
    if (!inAdjust(e) || !e.target.dataset.adjust) return;
    e.preventDefault();
    commit(e.target);
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (inAdjust(e) && el.name === 'qty') return updatePreview(el.closest('form'));
    if (!mine(e)) return;
    if (el.dataset.field === 'counted' && draft) {          // live delta, no re-render
      const ln = lineOf(el);
      ln.counted = el.value;
      el.closest('tr').querySelector('.doc-delta').textContent =
        deltaText(productMap().get(ln.productId), ln);
      root().querySelector('#docFoot').textContent = docFootText(productMap());
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (inAdjust(e) && el.name === 'event') {
      const form = el.closest('form');
      form.querySelector('.adj-qty-label').textContent = qtyLabel(adjEvent(form)[1]);
      form.querySelector('.adj-date-label').textContent = dateLabel(adjEvent(form)[1]);
      return updatePreview(form);
    }
    if (!mine(e)) return;
    if (el.id === 'invCat') return Router.setParams({ cat: el.value, page: '' });
    if (el.id === 'invReason') return Router.setParams({ reason: el.value, page: '' });
    if (el.id === 'invFrom') return Router.setParams({ from: el.value, page: '' });
    if (el.id === 'invTo') return Router.setParams({ to: el.value, page: '' });
    if (el.dataset.doc && draft) { draft[el.dataset.doc] = el.value; return; }
    if (el.dataset.field === 'product' && draft) {
      lineOf(el).productId = resolveProduct(el.value);      // step + on-hand depend on it
      return renderLines();
    }
  });

  window.renderInventory = render;
  window.openAdjustDialog = openAdjustDialog;
  // The PO editor's "Add low stock items": this supplier's low and out items at the suggested qty.
  window.lowStockLines = (supplierId) =>
    (reorderGroups(state.products.filter((p) => !p.archived)).get(supplierId) || []).map((p) => ({ p, qty: suggestQty(p) }));
})();
