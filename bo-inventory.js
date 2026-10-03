/* Back office — Inventory. Renders the whole #view section; see CONTRACT.

   Products creates items; Inventory only moves stock. Nothing in this file
   creates a product: it writes stock_movements and reads them back, which is
   also the only way `product.stock` is ever allowed to change.               */
(function () {
  const VIEW = 'inventory';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);
  // Stock history is one page (owner, 2026-09-23; a Dashboard page 2026-09-26): KPI tabs over one
  // series of bars, the period's movements and price changes, and a rail of what to act on. Each block's View all opens its full page here,
  // not in the sidebar. The two insight pages come from bo-insights.js.
  const TABS = { overview: 'Stock history', movements: 'Movements', prices: 'Price changes',
    lost: 'Lost demand', counts: 'Shelf check' };
  const INSIGHT_TABS = ['lost', 'counts'];
  const FULL_PAGES = ['movements', 'prices', 'lost', 'counts'];   // these get "← Stock history"
  // One sidebar entry; a full page falls back to def, so Stock history stays lit.
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).inventory =
    { param: 'tab', def: 'overview', items: [['overview', TABS.overview]] };

  /* ================= pure logic (exported for scripts/inventory-check.mjs) ============= */

  const r2 = SalesMath.round2;

  // The store's clock (SalesMath.storeZone): every day and hour on this page is the store's, never
  // the browser's. undefined in node (no settings) = movedAt's default, Manila.
  const zone = () => (typeof SalesMath !== 'undefined' && typeof state !== 'undefined' ? SalesMath.storeZone(state.settings) : undefined);
  const settings = () => (typeof state !== 'undefined' ? state.settings : {});
  // SalesMath: a global in the page, a require in node (the checks).
  const SM = () => (typeof SalesMath !== 'undefined' ? SalesMath : require('./sales-math.js'));
  const tsOf = (row) => SM().tsOf(row);
  // When a movement happened: bo-model movedAt, the one reading Insights and the dead clock use too.
  const when = (m) => movedAt(m, zone());

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

  // The Balance column is bo-model's runningBalances (the running sum of the movements), shared
  // with the item page.

  // Most urgent first: out of stock, then below the danger level, then everything else.
  const urgency = (p) => (Number(p.stock) <= 0 ? 0 : isLow(p) ? 1 : 2);

  // ONE place builds a stock movement, so a row entered inline on a product and a row
  // entered in an adjustment document are indistinguishable in the history.
  // Cost moves over time; a movement without the cost of the day makes every past margin
  // wrong, so it rides along with the quantity and falls back to the product's cost.
  // `expected`/`counted` ride along on anything that was counted, so the variance survives
  // the qty (countAccuracy in bo-insights.js reads them).
  // Who did it: the dialogs pick staff by name and look the id up (bo-model staffIdOf) before calling --
  // this stays pure, no storage read.
  function stockMovement({ product, delta, reason, note, unitCost, staff, staffId, refId, expected, counted, happenedOn }) {
    const typed = unitCost === '' || unitCost == null ? NaN : Number(unitCost);
    return makeMovement({
      productId: product.id, qty: delta, reason,
      refId: refId || '', note: note || '', staff: staff || '', staffId: staffId || '',
      unitCost: Number.isFinite(typed) ? typed : (Number(product.cost) || 0),
      expected, counted, happenedOn,
    });
  }

  // An adjustment document: one reason and one person, many counted lines. Every line
  // that actually moved becomes a movement sharing the document id as `refId`, so the
  // history can group them back into "Sept 8 count, 14 items, Maricel R.".
  // A line counted and found correct writes nothing — that is not a stock movement.
  // One item on two lines is ONE count, the last one typed: each line works its change out from
  // the same on-hand, so applying both moved the shelf twice (counted 37 from 40 ended at 34).
  function documentMovements(doc, productOf) {
    const out = [], last = new Map();
    (doc.lines || []).forEach((line) => {
      if (line.counted !== '' && line.counted != null) last.set(line.productId, line);
    });
    last.forEach((line) => {
      const p = productOf(line.productId);
      if (!p) return;
      const counted = roundQty(p, line.counted);
      const delta = countDelta(p.stock, counted);
      if (!delta) return;
      out.push(stockMovement({
        product: p, delta, reason: doc.reason, note: doc.note, staffId: doc.staffId,
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
  // The supplier comes off the PO line the delivery's refId points at (a line carries its own).
  function lastPaid(movements, purchaseOrders = []) {
    const poOf = new Map(purchaseOrders.map((po) => [po.id, po]));
    const out = new Map();
    for (const m of movements) {
      if (m.reason !== 'delivery') continue;    // only a purchase tells you a price
      const cost = Number(m.unitCost);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      const supplierId = deliverySupplier(poOf.get(m.refId), m);
      // ts is epoch ms on new rows, ISO text on old ones: compare through tsOf, never raw.
      const row = { cost: r2(cost), ts: tsOf(m), refId: m.refId || '', supplierId };
      for (const key of supplierId ? [m.productId, m.productId + '|' + supplierId] : [m.productId]) {
        const seen = out.get(key);
        if (!seen || row.ts > seen.ts) out.set(key, row);
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
      const rate = SM().change(paid.cost, book);   // null when no cost on file
      if (rate != null && Math.abs(rate) * 100 < DRIFT_MIN) continue;
      rows.push({
        p, paid: paid.cost, at: paid.ts, refId: paid.refId, book, gap,
        gapPct: rate == null ? null : r2(rate * 100),
        suggested: heldPrice(p, paid.cost),
        // What today's shelf price really earns, against what the reports still claim.
        nowMarkup: SM().unitMargin(paid.cost, p.price, settings()).markup,
        bookMarkup: SM().unitMargin(book, p.price, settings()).markup,
      });
    }
    // Percent, not pesos: a ₱20 rise on a ₱1,200 item is noise, the same rise on a
    // ₱60 item is the whole margin.
    const mag = (r) => (r.gapPct == null ? Infinity : Math.abs(r.gapPct));
    return rows.sort((a, b) => mag(b) - mag(a));
  }

  /* ---- The buying list: what a new purchase order fills itself with (owner, 2026-10-02) ----
     Every item at or below its reorderPoint, most urgent first, at the suggested top-up minus
     what is already on a list, bought from its main supplier ('' when it has none: still listed).
     supplierId narrows it to what that supplier sells, main or other, and buys it there.
     No forecast on purpose (owner, 2026-09-23): the POS knows sales and stock, not promos,
     seasons or cash, so the owner's reorder point is the rule and suggestQty tops it up. */
  function buyingList(products, purchaseOrders = [], supplierId = '') {
    const onOrder = onOrderQty(purchaseOrders);
    return products.filter((p) => isLow(p) && (!supplierId || supplierIdsOf(p).includes(supplierId)))
      .sort((a, b) => (a.stock / (a.reorderPoint || 1)) - (b.stock / (b.reorderPoint || 1)))
      .map((p) => ({ p, qty: ceilStep(suggestQty(p) - (onOrder.get(p.id) || 0), stepFor(p)),
        supplierId: supplierId || p.supplierId || '' }))
      .filter((x) => x.qty > 0);
  }

  // Stock history's numbers (in / out / lost / adj, by bucket and by reason) are bo-model stockFlow,
  // the one Insights' sold at cost reads too: a return (void or refund) nets against Went out, never
  // Came in. The movement list's types below test rows the same way.
  const cameIn = (m) => m.qty > 0 && !['return', 'count', 'opening'].includes(m.reason);

  // A movement's reason in the till's words: stock back from a receipt says Void, Refund or Exchange,
  // read off the order rows that point at it (an exchange is a refund plus a sale with the same
  // originalOrderId). A return typed by hand has no receipt and keeps "Return". Item page uses it too.
  function reasonWords(orders) {
    const rev = new Map(), swap = new Set();
    for (const o of orders || []) {
      if (!o || !o.originalOrderId) continue;
      const k = String(o.originalOrderId);
      if (o.status === 'void' || o.status === 'refund') rev.set(k, o.status);
      else if (o.status === 'completed' || !o.status) swap.add(k);
    }
    return (m) => {
      const k = String(m.refId || '');
      if (m.reason !== 'return' || !rev.has(k)) return STOCK_REASONS[m.reason] || m.reason;
      return swap.has(k) ? 'Exchange' : rev.get(k) === 'void' ? 'Void' : 'Refund';
    };
  }

  // stockFlow re-exported for scripts/inventory-check.mjs: it is bo-model's, on the store clock.
  const API = { r2, ceilStep, countDelta, suggestQty, runningBalances, urgency,
    stockMovement, documentMovements, lastPaid, heldPrice, costDrift,
    buyingList, stockFlow, reasonWords };
  if (typeof module === 'object' && module.exports) { module.exports = API; return; }

  /* ================================ formatting ======================================== */

  // Every reason is a pill, one colour per kind, so a list scans (owner, 2026-09-26): green came in,
  // amber a hand fix or a return, blue a shelf count, red a loss. Sales and transfers stay grey.
  // The calm overview uses .pill tones; the full pages the back office's .status-pill ones.
  const REASON_TONE = { delivery: 'up', return: 'warn', adjustment: 'warn', count: 'data',
    shrinkage: 'down', damage: 'down', writeoff: 'down' };
  const STATUS_TONE = { up: 'ok', warn: 'warn', data: 'info', down: 'danger' };
  const reasonLabel = (r) => escapeHtml(STOCK_REASONS[r] || r);
  // A movement's pill: tone by reason, words by reasonWords (`word`, built once per render).
  const reasonPill = (m, word) => `<span class="pill ${REASON_TONE[m.reason] || ''}">${escapeHtml(word(m))}</span>`;
  const reasonCell = (m, word) => `<span class="status-pill ${STATUS_TONE[REASON_TONE[m.reason]] || 'muted'}">${escapeHtml(word(m))}</span>`;

  const fmtQty = (p, n) => SalesMath.qtyText(roundQty(p, n));   // what the product sells in, shown the one way

  const fmtSigned = (p, n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtQty(p, Math.abs(n));

  const hay = (p) => `${p.name} ${p.sku || ''} ${p.barcode || ''} ${foldersOf(p).map(folderName).join(' ')}`.toLowerCase();

  /* Reason and Mode asked the same question twice - "Adjustment" plus "Set to count"
     could disagree with each other, and most of the 15 combinations were nonsense. One
     control now: what happened. Each answer carries its own sign and its own log label.
     Nothing adds stock blindly; an upward correction is a count, which is what a shop actually
     does. Sales are not here on purpose - the POS writes those against a receipt, and a hand-typed
     one would move stock with nothing behind it. Deliveries neither (2026-10-02): bought stock comes
     in by receiving its purchase order line, or it gets counted in twice. */
  const ADJ_EVENTS = [
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
  const adjEvent = (form) => String(form.elements.event.value || ADJ_EVENTS[0][0]).split(':');
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
    const { byProduct, balance } = runningBalances(movements);
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
    !p.archived && (!d.cats.length || foldersOf(p).some((c) => d.cats.includes(c))) && (!d.q || hay(p).includes(d.q)));

  /* ================================== shell =========================================== */

  function shell(d) {
    // The overview draws its own header (the Dashboard's bar), so it is only the frame.
    if (d.tab === 'overview') return '<div class="c-main" id="invBody"></div>';
    // 'all' is the built-in catch-all folder; as an option it reads as a second
    // "All categories" and filters to almost nothing. It is not a category.
    const cats = ['<option value="">All categories</option>'].concat(
      state.folders.filter((f) => f.id !== 'all')
        .map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`)).join('');
    // One control for what to show: a kind (the overview's type pick) or one reason.
    const reasons = `<optgroup label="Show">${MOVE_TYPES.map(([k, v]) => `<option value="t:${k}">${v}</option>`).join('')}</optgroup>
      <optgroup label="One reason">${Object.entries(STOCK_REASONS).map(([k, v]) => `<option value="r:${k}">${escapeHtml(v)}</option>`).join('')}</optgroup>`;

    const filters = d.tab === 'movements'
      ? `<select class="bo-select" id="invReason">${reasons}</select>
         <input type="date" class="bo-date" id="invFrom" aria-label="From date">
         <input type="date" class="bo-date" id="invTo" aria-label="To date">
         <button class="secondary-btn small" data-act="export">Export CSV</button>`
      : `<select class="bo-select" id="invCat">${cats}</select>`;
    // The insight cards (lost, counts) read no search or category, so they get neither.
    const search = `<input class="search-input small q-input" id="invSearch" type="search"
                 placeholder="Search items…" autocomplete="off">`;
    const insight = INSIGHT_TABS.includes(d.tab);
    const back = FULL_PAGES.includes(d.tab)
      ? `<a class="link-btn" href="${Router.href(VIEW, '', {})}">&larr; Stock history</a>` : '';

    return `
      <div class="view-head">
        <div class="view-title-wrap">
          ${back}
          <h1 id="invTitle"></h1>
        </div>
        <div class="view-actions">
          ${insight ? '' : search + filters}
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
              <input name="date" type="date" value="${storeDay(Date.now())}" max="${storeDay(Date.now())}"></label>
            <label class="adj-field"><span>Staff</span>
              <select name="staff">${staff || '<option value="">—</option>'}</select></label>
            <label class="adj-field adj-note"><span>Note</span>
              <input name="note" type="text" placeholder="Why did the stock move?" autocomplete="off"></label>
          </div>
          <div class="adj-foot">
            <span class="adj-preview">In stock ${fmtQty(p, p.stock)} ${escapeHtml(p.unit || '')}</span>
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

  // What kind of change, wider than one reason: [?type=, label, test, empty text]. The default
  // hides sales -- the POS writes hundreds, and they bury the deliveries, fixes and losses.
  // Came in, Lost and Adjustments match the KPIs of the same name (stockFlow).
  const MOVE_TYPES = [
    ['', 'All but sales', (m) => m.reason !== 'sale', 'Nothing but sales moved stock'],
    ['all', 'All', () => true, 'No stock moved'],
    ['in', 'Came in', cameIn, 'Nothing came in'],
    ['sale', 'Sold', (m) => m.reason === 'sale', 'Nothing sold'],
    ['lost', 'Lost', isLoss, 'Nothing lost'],
    ['adj', 'Adjustments', (m) => MANUAL_REASON.has(m.reason), 'Nothing adjusted'],
  ];
  const moveType = (k) => MOVE_TYPES.find((t) => t[0] === (k || '')) || MOVE_TYPES[0];

  function filteredMovements(d) {
    // One reason (the old ?reason= links) wins over a type.
    const reason = d.params.reason || '', type = moveType(d.params.type)[2];
    const from = d.params.from || '';
    const to = d.params.to || '';
    const out = [];
    for (let i = d.movements.length - 1; i >= 0; i--) {   // newest first, one pass
      const m = d.movements[i];
      if (reason ? m.reason !== reason : !type(m)) continue;
      const day = storeDay(whenOf(m));    // the store's day it moved, as the overview reads it
      if (from && day < from) continue;
      if (to && day > to) continue;
      const p = d.byId.get(m.productId);
      if (d.cats.length && (!p || !foldersOf(p).some((c) => d.cats.includes(c)))) continue;
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
    const refNo = refNumbers(), word = reasonWords(state.orders);

    const rows = pg.rows.map((m) => {
      const p = d.byId.get(m.productId);
      const bal = d.balance.get(m.id);
      const tone = m.qty >= 0 ? 'ok' : 'danger';
      return `
        <tr>
          <td class="tx-time">${escapeHtml(txTime(m.ts))}</td>
          <td>${escapeHtml(p ? p.name : m.productId || '—')}</td>
          <td>${reasonCell(m, word)}</td>
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
          <th>When</th><th>Item</th><th>Reason</th><th class="num">Qty</th><th class="num">Unit cost</th>
          <th class="num">Balance</th><th>Ref</th><th>Note</th><th>Staff</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`, '', pagerHtml(pg));
  }

  function exportMovements(d) {
    const rows = [['when', 'item', 'sku', 'reason', 'qty', 'unit_cost', 'balance', 'ref', 'note', 'staff']];
    const refNo = refNumbers(), word = reasonWords(state.orders);
    // When on the store's clock, as the screen reads it (an ISO stamp is UTC: a 7am Manila move read as yesterday).
    const at = (m) => `${storeDay(tsOf(m))} ${SalesMath.dateText(tsOf(m), zone(), 'time')}`;
    filteredMovements(d).forEach((m) => {
      const p = d.byId.get(m.productId);
      rows.push([at(m), p ? p.name : m.productId, p ? p.sku : '', word(m),
        m.qty, m.unitCost == null ? '' : m.unitCost, d.balance.get(m.id) ?? '', refNo.get(m.refId) || m.refId || '', m.note || '', m.staff || '']);
    });
    downloadCsv(`stock-movements-${storeDay(Date.now())}.csv`, rows);
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
          ? 'No items match those filters.'
          : 'Every item is priced off what it last cost. Nothing to review.'}</div></div></section>`;
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
            : SalesMath.changeText(r.paid, r.book)}</span></td>
          <td class="num inv-soft">${escapeHtml(shortDate(r.at))}</td>
          <td class="num">${peso(p.price)}</td>
          <td class="num">${r.suggested == null ? '—' : `<strong>${peso(r.suggested)}</strong>`}</td>
          <td class="num inv-soft">${SalesMath.pctText(r.bookMarkup / 100, r.book)} → ${SalesMath.pctText(r.nowMarkup / 100, r.paid)}</td>
          <td class="num">${canReprice
            ? `<button class="secondary-btn small" data-act="reprice" data-reprice="${escapeHtml(p.id)}">Apply</button>`
            : '—'}</td>
        </tr>`;
    }).join('');

    const note = `<div class="sales-note">Gross profit on Sales is worked out from the Cost column, not from what
      the last delivery actually charged. While these disagree, ${up ? 'gross profit is being reported higher than it was earned' : 'gross profit is being reported lower than it was earned'}.</div>`;

    return note + card('Cost changes', `${SalesMath.plural(rows.length, 'item')} · ${up} went up`, `
      <table class="data-table inv-cost">
        <thead><tr>
          <th>Item</th><th class="inv-cat">Category</th>
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
      date: storeDay(Date.now()), note: '', lines: [{ productId: '', counted: '' }],
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
    return `${SalesMath.plural(mv.length, 'item')} moving \u00b7 net ${sign}${SalesMath.qtyText(Math.abs(net))}`;
  }

  function draftRows(byId) {
    return draft.lines.map((ln, i) => {
      const p = byId.get(ln.productId);
      return `
        <tr data-line="${i}">
          <td><input class="text-input doc-pick" list="invPickList" data-field="product"
               value="${escapeHtml(p ? pickerLabel(p) : '')}" placeholder="Search items\u2026" autocomplete="off"></td>
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
    const reasons = Object.entries(STOCK_REASONS).filter(([k]) => k !== 'delivery' && k !== 'opening').map(([k, v]) =>
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
                <input type="date" class="bo-date" data-doc="date" value="${escapeHtml(draft.date)}" max="${storeDay(Date.now())}"></label>
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
              <thead><tr><th>Item</th><th class="num">In stock now</th><th class="num">Counted</th>
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
      `${doc.date} \u00b7 ${doc.staff || '\u2014'} \u00b7 ${SalesMath.plural(lines.length, 'item')}`,
      '<button class="secondary-btn small" data-act="doc-new">New adjustment</button>') + `
      <div class="dash-stack">
        ${card('Items moved', doc.note || 'No note', `
          <table class="data-table">
            <thead><tr><th>Item</th><th class="num">Was</th><th class="num">Counted</th>
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
    const staffId = staffIdOf(draft.staff);
    const movements = documentMovements({ ...draft, staffId }, (id) => byId.get(id));
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
    // stampRow: the document carries store_id and updated_at like every record (bo-model).
    saveAdjustments(loadAdjustments().concat(stampRow({
      id: draft.id, reason: draft.reason, staff: draft.staff, staffId, date: draft.date,
      note: draft.note, lines, createdAt: new Date().toISOString(),
    })));
    const id = draft.id;
    draft = null;
    refreshSharedState();
    showToast(`Adjustment saved \u00b7 ${SalesMath.plural(movements.length, 'item')} moved`);
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

  // A price or cost edit's change, the trend chips' one rule (SalesMath.changeText). good: a price going
  // up, or a cost going down. No old value: nothing to be a change of (null).
  const editChange = (e) => (e.old ? { good: (e.new > e.old) === (e.field !== 'cost'), text: SalesMath.changeText(e.new, e.old) } : null);

  function priceLogCard(d) {
    const shown = new Set(visible(d).map((p) => p.id));
    const all = loadEvents('priceLog').filter((e) => shown.has(e.productId))
      .sort((a, b) => tsOf(b) - tsOf(a));
    const pg = paginate(all, d.params.page);
    const rows = pg.rows.map((e) => {
      const p = d.byId.get(e.productId);
      const ch = editChange(e);
      return `
        <tr>
          <td class="tx-time">${escapeHtml(txTime(e.ts))}</td>
          <td><a class="link-btn" href="${Router.href('products', e.productId)}"><strong>${escapeHtml(p ? p.name : e.productId)}</strong></a></td>
          <td>${e.field === 'cost' ? 'Cost' : 'Price'}</td>
          <td class="num inv-soft">${e.old == null ? '—' : peso(e.old)}</td>
          <td class="num"><strong>${peso(e.new)}</strong></td>
          <td class="num">${ch == null ? '—' : `<span class="trend-plain ${ch.good ? 'up' : 'down'}">${ch.text}</span>`}</td>
          <td>${escapeHtml(e.staff || '—')}</td>
          <td class="inv-soft">${escapeHtml(SOURCE_LABEL[e.source] || e.source || '—')}</td>
        </tr>`;
    }).join('') || empty(d.q || d.cats.length ? 'No price changes match those filters.'
      : 'No price or cost changes yet. Every change from here on is logged.');
    return card('Price history', `showing ${pg.rows.length} of ${all.length}`, `
      <table class="data-table">
        <thead><tr>
          <th>When</th><th>Item</th><th>What</th><th class="num">From</th><th class="num">To</th>
          <th class="num">Change</th><th>Changed by</th><th>Where</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`, '', pagerHtml(pg));
  }

  /* ============================ Stock history — the overview ========================== */

  // The overview is the Dashboard's page (bo-calm.css .calm-dash): a range pick, four KPIs as
  // folder tabs over the bars, a Movements table, a rail of what to act on (owner, 2026-09-26:
  // "what came in, what went out, what went missing or was fixed, and what to do about it").
  // Today runs from midnight and compares with yesterday up to this time -- a morning against a
  // whole day always read as a drop. 7 and 30 are calendar days, today included, each against
  // the same stretch just before it. An array: numeric keys would sort ahead of 'today'.
  const PERIOD_LIST = [['today', 'Today', 'yesterday at this time'],
    ['7', 'Last 7 days', 'the previous 7 days'], ['30', 'Last 30 days', 'the previous 30 days']];
  const PERIODS = Object.fromEntries(PERIOD_LIST.map(([k, ...rest]) => [k, rest]));
  const PERIOD_DEF = '7';
  const periodOf = (params) => (PERIODS[params.period] ? String(params.period) : PERIOD_DEF);
  const periodText = (key) => (key === 'today' ? 'today' : `in the last ${key} days`);
  // Store days (SalesMath.rangeWindow), not the browser's.
  function periodWindows(key, now = Date.now()) {
    const start = SalesMath.rangeWindow(key === 'today' ? 1 : Number(key), now, zone()).from;
    if (key === 'today') return { cur: [start, now + 1], prev: [start - 864e5, now + 1 - 864e5] };
    const span = now + 1 - start;
    return { cur: [start, now + 1], prev: [start - span, start] };
  }
  const inWin = (t, [a, b]) => { const ms = tsOf({ ts: t }); return ms >= a && ms < b; };
  const whenOf = when;
  const storeDay = (t) => SalesMath.dayKey(t, zone());
  const storeHour = (ms) => Math.floor((ms - SalesMath.dayStartMs(storeDay(ms), zone())) / 36e5);

  // The chart's bars: one per hour today (7a–6p, widened to any hour that moved stock), one per day otherwise.
  function flowBuckets(key, [a, b], movements) {
    if (key === 'today') {
      const hrs = movements.filter((m) => inWin(whenOf(m), [a, b])).map((m) => storeHour(whenOf(m)));
      const h0 = Math.min(7, ...hrs), h1 = Math.max(18, ...hrs), now = storeHour(b - 1);
      return { of: storeHour, list: Array.from({ length: h1 - h0 + 1 }, (_, i) =>
        ({ key: h0 + i, x: hourShort(h0 + i), title: `${hourLong(h0 + i)} – ${hourLong(h0 + i + 1)}`, future: h0 + i > now })) };
    }
    const n = Number(key);
    return { of: storeDay, list: Array.from({ length: n }, (_, i) => {
      const k = SalesMath.addDays(storeDay(a), i), t = SalesMath.dayStartMs(k, zone()) + 12 * 36e5;   // noon labels the right date
      return { key: k, x: n > 7 ? String(Number(k.slice(8))) : dashDate(t, { weekday: 'short' }),
        title: dashDate(t, { weekday: 'long', month: 'long', day: 'numeric' }) };
    }) };
  }

  // The four KPIs; the picked one is what the bars show. Money is at cost. `tone` is what a rise
  // means: Lost going up is bad news, so its chip reads red. Came in, Went out and Adjustments have
  // no good direction -- a quiet week sells less and buys less -- so their chips stay grey.
  // Words say what each adds (received-word, 2026-10-02): "Received" read as deliveries but counted
  // returns and transfers too; "Adjusted" sat as a count next to money; a short count is Lost but
  // never Went out (nothing left the shop, the number was corrected).
  const count = SalesMath.qtyText;
  const money = (v) => (v >= 1e6 ? pesoK(v) : pesoShort(v));   // ₱1.25M: seven digits and a chip overran a tab
  const SH_KPI = {
    in:   { lbl: 'Came in', fmt: money, axis: pesoK, floor: 100,
      tip: 'Stock that came in: deliveries and transfers in. At cost.' },
    out:  { lbl: 'Went out', fmt: money, axis: pesoK, floor: 100,
      tip: 'Stock that left: sold (less what came back on a void, a refund or a customer return), used, transferred out, stolen, broken or written off. At cost.' },
    lost: { lbl: 'Lost', fmt: money, axis: pesoK, floor: 100, bad: true,
      tip: 'Stolen, broken, written off, or short on a shelf count. At cost.' },
    adj:  { lbl: 'Adjustments', fmt: count, axis: (v) => +v.toFixed(1), floor: 3,
      tip: 'How many changes were typed in by hand: shelf counts, adjustments and losses. A count, not money.' },
  };
  const shChip = (k, cur, prev, title) => calmChip(cur, prev, title)
    .replace(/chip (up|down)/, (_, t) => (SH_KPI[k].bad ? `chip ${t === 'up' ? 'down' : 'up'}` : 'chip'));

  function shStrip(cur, prev, chart, vs) {
    return Object.entries(SH_KPI).map(([k, K]) =>
      `<button class="stat" role="tab" data-chart="${k}" aria-selected="${chart === k}" title="${escapeHtml(K.tip)}">`
      + `<div class="lbl">${K.lbl}</div><div class="line"><span class="val">${K.fmt(cur[k])}</span>${shChip(k, cur[k], prev[k], vs)}</div></button>`).join('');
  }

  // The Dashboard's bars (dashPlot): the picked KPI, one series, from zero up.
  function shPlot(bs, f, chart) {
    const K = SH_KPI[chart], at = (b) => f.buckets.get(b.key) || { in: 0, out: 0, lost: 0, adj: 0 };
    const peak = Math.max(K.floor, ...bs.map((b) => at(b)[chart]));
    const step = niceStep(peak / 3), top = Math.ceil(peak * 1.1 / step) * step;
    const every = Math.ceil(bs.length / 12);   // a label every few bars on 30 days, counted back from today
    let grid = '';
    for (let v = 0; v <= top + 1e-6; v += step) grid += `<div class="gl${v ? '' : ' zero'}" style="bottom:${v / top * 100}%"><span>${K.axis(v)}</span></div>`;
    const cols = bs.map((b, i) => {
      const x = `<span class="x">${(bs.length - 1 - i) % every ? '' : b.x}</span>`;
      if (b.future) return `<div class="b future">${x}</div>`;
      const v = at(b);
      return `<div class="b" tabindex="0" aria-label="${escapeHtml(b.title)}: ${K.lbl} ${K.fmt(v[chart])}">`
        // A bar starts at zero: a bucket that took back more than it sold (a refund of an earlier
        // day's sale, bo-model stockFlow) is net negative -- its tip says so, the bar stays empty.
        + `<i style="height:${Math.max(0, v[chart]) / top * 100}%"><span class="tip"><b>${escapeHtml(b.title)}</b>`
        + Object.entries(SH_KPI).map(([k, X]) => `<span class="${k === chart ? 'on' : ''}">${X.lbl}<em>${X.fmt(v[k])}</em></span>`).join('')
        + `</span></i>${x}</div>`;
    }).join('');
    return `<div class="grid">${grid}</div>`
      + `<div class="cols${bs.length > 8 ? ' many' : ''}" style="grid-template-columns:repeat(${bs.length},minmax(0,1fr))">${cols}</div>`;
  }

  const viewAll = (tab, params = {}) => `<a href="${Router.href(VIEW, '', { tab, ...params })}">View all ›</a>`;
  const productLink = (d, id, text = '') => {
    const p = d.byId.get(id);
    return p ? `<a href="${Router.href('products', id)}">${escapeHtml(p.name)}</a>` : escapeHtml(text || id || '—');
  };
  const menuItem = (attr, v, lbl, on) => `<button role="menuitemradio" ${attr}="${v}" aria-checked="${on}">${escapeHtml(lbl)}</button>`;
  // A card with nothing in it is one line: its name, why it is empty, and the way to the full list.
  const quietCard = (lbl, why, more) => `<section class="card txcard"><div class="head"><span class="lbl">${lbl}<span class="sub">${escapeHtml(why)}</span></span>${more}</div></section>`;

  function overviewTab(d) {
    // Pick a day (?date=): that one whole STORE day, against the day before. Read off the key in the
    // store's zone, not the browser-midnight anchor (a picked day read the wrong window off Manila).
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(d.params.date || '') && d.params.date !== storeDay(Date.now()) ? d.params.date : '';
    const dayEnd = dateKey ? SalesMath.dayStartMs(SalesMath.addDays(dateKey, 1), zone()) - 1 : 0;
    // backoffice.js's dayLabel / dayPickRow read the browser's clock: store noon names the right date.
    const day = dateKey ? SalesMath.dayStartMs(dateKey, zone()) + 12 * 36e5 : 0;
    const key = day ? 'today' : periodOf(d.params), w = periodWindows(key, day ? dayEnd : Date.now());
    const vs = day ? 'vs the day before' : `vs ${PERIODS[key][1]}`, when = day ? `on ${dayLabel(day)}` : periodText(key);
    const chart = SH_KPI[d.params.chart] ? d.params.chart : 'in';
    const costOf = (id) => (d.byId.get(id) || {}).cost;
    const bs = flowBuckets(key, w.cur, d.movements);
    const cur = stockFlow(d.movements, costOf, w.cur, bs.of, zone()), prev = stockFlow(d.movements, costOf, w.prev, undefined, zone());

    const bar = `<div class="bar"><h1 id="invTitle"></h1>
      <button class="pick" popovertarget="invRange">${day ? dayLabel(day) : PERIODS[key][0]}</button>
      <div class="menu" id="invRange" popover role="menu">${PERIOD_LIST.map(([k, lbl]) => menuItem('data-period', k, lbl, !day && k === key)).join('')}${dayPickRow(day)}</div>
      <button class="secondary-btn small" data-act="receive">Receive stock</button>
      <button class="primary-btn small" data-act="doc-new">New adjustment</button></div>`;

    const trend = `<section class="card trend"><div class="strip" role="tablist" aria-label="Chart shows">${shStrip(cur, prev, chart, vs)}</div>
      <div class="panel"><div class="plot">${cur[chart] ? shPlot(bs.list, cur, chart)
        : `<p class="none">${chart === 'adj' ? 'Nothing adjusted' : `No stock ${{ in: 'came in', out: 'went out', lost: 'lost' }[chart]}`} ${when}.</p>`}</div></div></section>`;

    // Movements in the period, newest first. Sales are hidden until asked for: the POS writes
    // hundreds, and they bury the deliveries, fixes and losses this list is for.
    const type = moveType(d.params.type), word = reasonWords(state.orders);
    const moves = d.movements.filter((m) => Number(m.qty) && inWin(whenOf(m), w.cur) && type[2](m)).reverse();
    const typePick = `<button class="pick" popovertarget="invType">${type[1]}</button>
      <div class="menu" id="invType" popover role="menu">${MOVE_TYPES.map(([k, lbl]) => menuItem('data-type', k, lbl, k === type[0])).join('')}</div>`;
    const movesAll = viewAll('movements', { type: type[0], from: storeDay(w.cur[0]), to: dateKey });
    const moveCard = !moves.length ? quietCard('Movements', `${type[3]} ${when}`, typePick + movesAll)
      : `<section class="card txcard"><div class="head"><span class="lbl">Movements<span class="sub">${moves.length > 10 ? `latest 10 of ${count(moves.length)}` : count(moves.length)}</span></span>${typePick}${movesAll}</div>
      <div class="flush"><table class="tx">
        <tr><th>When</th><th>Item</th><th>Reason</th><th class="n">Qty</th><th class="n opt">Balance</th></tr>
        ${moves.slice(0, 10).map((m) => {
          const p = d.byId.get(m.productId), bal = d.balance.get(m.id);
          return `<tr><td class="t">${escapeHtml(txTime(m.ts))}</td>
            <td class="prod">${productLink(d, m.productId)}${m.note ? `<span class="mut"> · ${escapeHtml(m.note)}</span>` : ''}</td>
            <td>${reasonPill(m, word)}</td><td class="n">${fmtSigned(p, m.qty)}</td>
            <td class="n opt">${bal == null ? '<span class="mut">—</span>' : fmtQty(p, bal)}</td></tr>`;
        }).join('')}</table></div></section>`;

    // Price and cost edits in the period. A cost going up is the bad direction, a price going up the good one.
    const edits = loadEvents('priceLog').filter((e) => inWin(e.ts, w.cur)).sort((a, b) => tsOf(b) - tsOf(a));
    const priceCard = !edits.length ? quietCard('Price changes', `None ${when}`, viewAll('prices'))
      : `<section class="card txcard"><div class="head"><span class="lbl">Price changes<span class="sub">${edits.length > 5 ? `latest 5 of ${edits.length}` : edits.length}</span></span>${viewAll('prices')}</div>
      <div class="flush"><table class="tx">
        <tr><th>When</th><th>Item</th><th>What</th><th class="n">From → to</th><th class="n">Change</th></tr>
        ${edits.slice(0, 5).map((e) => {
          const ch = editChange(e);
          return `<tr><td class="t">${escapeHtml(txTime(e.ts))}</td><td class="prod">${productLink(d, e.productId)}</td>
            <td>${e.field === 'cost' ? 'Cost' : 'Price'}</td>
            <td class="n"><span class="mut">${e.old == null ? '—' : peso(e.old)} →</span> ${peso(e.new)}</td>
            <td class="n">${ch == null ? '<span class="mut">—</span>'
              : `<span class="${ch.good ? 'good' : 'bad'}">${ch.text}</span>`}</td></tr>`;
        }).join('')}</table></div></section>`;

    // The rail: what to act on. A card with nothing to say is not drawn -- except Lost demand, which the
    // owner always wants to see (2026-09-26): an empty list there is news too.
    const railCard = (lbl, more, rows, empty = '') => (rows.length || empty
      ? `<section class="card w"><div class="top band"><span>${lbl}</span>${more}</div><div class="rows">${rows.length ? rows.join('') : calmRow(`<span class="mut">${empty}</span>`, '')}</div></section>` : '');
    const asked = HWPOS_INSIGHTS.lostDemandSummary(loadEvents('lostDemand').filter((e) => inWin(e.ts, w.cur)));
    const counts = d.movements.filter((m) => m.reason === 'count' && Number(m.qty) && inWin(whenOf(m), w.cur)).reverse();
    const drift = costDrift(visible(d), d.movements, loadPurchaseOrders());
    const rail = [
      railCard('Lost demand', viewAll('lost'), asked.slice(0, 5).map((r) =>
        calmRow(productLink(d, r.productId, r.text), `${r.requests}×`)), `Nobody asked for anything you were out of ${when}`),
      // "system → shelf": short is red, over is plain -- extra on the shelf costs nothing.
      railCard('Counts that didn’t match', viewAll('counts'), counts.slice(0, 5).map((m) => {
        const p = d.byId.get(m.productId);
        return calmRow(productLink(d, m.productId), m.expected == null ? '' : `${fmtQty(p, m.expected)} → ${fmtQty(p, m.counted)}`,
          fmtSigned(p, m.qty), m.qty < 0 ? 'down' : '');
      })),
      railCard('Supplier costs changed', viewAll('prices'), drift.slice(0, 5).map((r) =>
        calmRow(productLink(d, r.p.id), `${peso(r.book)} → ${peso(r.paid)}`,
          r.gapPct == null ? 'no cost' : SalesMath.changeText(r.paid, r.book, 0), r.gap > 0 || r.gapPct == null ? 'down' : 'up'))),
      // One reason is 100% of one bar: that says nothing Went out doesn't, so the card waits for two.
      cur.why.length < 2 ? '' : railCard('Where it went', '', cur.why.map((r) =>
        calmRow(reasonLabel(r.reason), pesoShort(r.value), SalesMath.pctText(r.share, 1, 0)))),
    ].join('');

    return `${bar}<div class="dash${rail ? '' : ' solo'}"><div class="col">${trend}${moveCard}${priceCard}</div>
      ${rail ? `<div class="rail">${rail}</div>` : ''}</div>`;
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
      r.classList.remove('calm-dash');
      r.innerHTML = documentView(d.docId, d.byId);
      return;
    }
    // Rebuild the shell only when the tab changes — a keystroke must not blow away the
    // search box the user is typing into.
    r.classList.toggle('calm-dash', d.tab === 'overview');   // the overview is a Dashboard page (bo-calm.css)
    if (r.dataset.tab !== d.tab) {
      r.innerHTML = shell(d);
      r.dataset.tab = d.tab;
    }
    r.querySelector('#invBody').innerHTML =
      d.tab === 'overview' ? overviewTab(d) : d.tab === 'movements' ? movementsTab(d)
      : d.tab === 'prices' ? pricesTab(d) : HWPOS_INSIGHTS.card(d.tab, d.params);
    syncControls(d);
  }

  function syncControls(d) {
    const r = root();
    const set = (sel, value) => {
      const el = r.querySelector(sel);
      if (el && el !== document.activeElement && el.value !== value) el.value = value;
    };
    set('#invSearch', state.invQuery || '');
    set('#invCat', d.cats[0] || '');
    set('#invReason', d.params.reason ? `r:${d.params.reason}` : `t:${moveType(d.params.type)[0]}`);
    set('#invFrom', d.params.from || '');
    set('#invTo', d.params.to || '');
    r.querySelector('#invTitle').textContent = TABS[d.tab];
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
      product: p, delta, reason, note, staff: form.elements.staff.value, staffId: staffIdOf(form.elements.staff.value),
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
      out.textContent = `In stock ${fmtQty(p, on)} ${unit}`;
      return;
    }
    const qty = roundQty(p, typed);
    const delta = mode === 'set' ? countDelta(on, qty) : mode === 'remove' ? -qty : qty;
    out.textContent = mode === 'set'
      ? `In stock ${fmtQty(p, on)}, counted ${fmtQty(p, qty)} → ${fmtSigned(p, delta)}`
      : `In stock ${fmtQty(p, on)} → ${fmtQty(p, on + delta)} ${unit}`;
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
    // The overview's picks: the range and type menus, and the KPI tabs over the chart.
    const menu = el.closest('[popover]');
    if (menu) menu.hidePopover();
    if (el.dataset.period) return Router.setParams({ period: el.dataset.period === PERIOD_DEF ? '' : el.dataset.period, date: '' });
    if ('type' in el.dataset) return Router.setParams({ type: el.dataset.type });
    if (el.dataset.chart) return Router.setParams({ chart: el.dataset.chart === 'in' ? '' : el.dataset.chart });

    switch (el.dataset.act) {
      case 'receive': return Router.go('suppliers', '', { tab: 'incoming' });   // receiving is a PO line action, and Suppliers owns it
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
    if (mine(e) && el.matches('[data-day-pick]')) {
      el.closest('[popover]').hidePopover();
      return Router.setParams({ period: 'today', date: dayParam(el.value) }, { replace: false });
    }
    if (inAdjust(e) && el.name === 'event') {
      const form = el.closest('form');
      form.querySelector('.adj-qty-label').textContent = qtyLabel(adjEvent(form)[1]);
      form.querySelector('.adj-date-label').textContent = dateLabel(adjEvent(form)[1]);
      return updatePreview(form);
    }
    if (!mine(e)) return;
    if (el.id === 'invCat') return Router.setParams({ cat: el.value, page: '' });
    if (el.id === 'invReason') {
      const [k, v] = el.value.split(':');
      return Router.setParams({ type: k === 't' ? v : '', reason: k === 'r' ? v : '', page: '' });
    }
    if (el.id === 'invFrom') return Router.setParams({ from: el.value, page: '' });
    if (el.id === 'invTo') return Router.setParams({ to: el.value, page: '' });
    if (el.dataset.doc && draft) { draft[el.dataset.doc] = el.value; return; }
    if (el.dataset.field === 'product' && draft) {
      lineOf(el).productId = resolveProduct(el.value);      // step + on-hand depend on it
      return renderLines();
    }
  });

  // A menu hangs under its button, right edges flush (the Dashboard's range pick). toggle does not bubble.
  document.addEventListener('toggle', (e) => {
    const m = e.target;
    if (e.newState !== 'open' || !m.matches || !m.matches('.view-inv .menu')) return;
    const b = root().querySelector(`[popovertarget="${m.id}"]`).getBoundingClientRect();
    m.style.top = b.bottom + 6 + 'px';
    m.style.left = Math.max(16, b.right - m.offsetWidth) + 'px';
  }, true);

  window.renderInventory = render;
  window.openAdjustDialog = openAdjustDialog;
  window.buyingList = buyingList;   // a new purchase order fills itself from it (bo-suppliers.js)
  window.reasonWords = reasonWords; // the item page's Stock movements say Void / Refund / Exchange too
  window.lastPaid = lastPaid;       // and prices a line at what its supplier last billed
})();
