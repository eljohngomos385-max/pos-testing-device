/* Back office - one item's page, /admin/products/<id>. Read-only: it answers "how is this
   item doing" and every card points at the page that acts on it (Adjust, Edit, Inventory's
   movement and price logs). `id` is a product id or a family (group) id; a family shows its
   variants summed, with Adjust per variant. Renders into the Products view root, which
   bo-products.js dispatches here from window.renderProducts. */
(function () {
  const root = () => document.querySelector('.view[data-view="products"]');
  const PERIODS = [7, 30, 90];

  const qty = SalesMath.qtyText;
  const signedQty = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + qty(Math.abs(n));
  const pct = (n) => SalesMath.pctText(n / 100);   // unitMargin gives percent points
  const ago = (ms) => SalesMath.agoText(ms, Date.now(), boZone());
  const pill = ([tone, label]) => `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
  const levelOf = (p, clock) => (p.archived ? ['muted', 'Archived'] : STOCK_LEVEL[stockLevel(p, clock.get(p.id), Date.now(), boZone())]);
  // One unit's money the ladder's way (tax out of the price first), and markup on the shelf price.
  const marginOf = (cost, price) => SalesMath.unitMargin(cost, price, state.settings);

  const card = (label, sub, link, body, blk) => `
    <section class="bo-card ${blk}">
      <div class="bo-card-head"><span class="bo-card-label">${escapeHtml(label)}</span>${
        sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : ''}${
        link ? `<a class="link-btn view-all" href="${escapeHtml(link)}">View all ›</a>` : ''}</div>
      ${body}
    </section>`;
  const tableCard = (label, sub, link, head, rows, emptyMsg) => (rows.length
    ? card(label, sub, link, `<div class="bo-card-inset flush"><div class="table-wrap"><table class="data-table">
        <thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div></div>`, 'blk-table')
    : card(label, '', '', `<div class="bo-card-inset"><div class="bo-empty">${escapeHtml(emptyMsg)}</div></div>`, 'blk-empty'));

  function notFound() {
    root().innerHTML = `
      <header class="view-head"><div class="view-title-wrap">
        <a class="link-btn" href="${escapeHtml(Router.href('products', ''))}">← Items</a>
        <h1>Item not found</h1><span class="muted">It may have been removed.</span>
      </div></header>`;
  }

  window.renderProductPage = function (id) {
    const products = state.products.map(normalizeProduct);
    const byId = new Map(products.map((p) => [p.id, p]));
    const g = loadGroups().find((x) => x.id === id);
    const p = g ? null : byId.get(id);
    if (!g && !p) { notFound(); return; }
    const members = g ? variantsOf(g.id, products) : [p];
    const ids = new Set(members.map((m) => m.id));
    const name = g ? g.name : p.name;
    const unit = (members[0] && members[0].unit) || '';

    const params = Router.route().params;
    const period = PERIODS.includes(Number(params.period)) ? Number(params.period) : 30;
    // Pick a day (?date=): that one whole day instead of the last N days.
    const day = params.date ? state.anchor : 0;
    const since = day || SalesMath.rangeWindow(period, Date.now(), boZone()).from, until = day ? shiftDays(day, 1) : Infinity;
    const span = day ? `on ${dayLabel(day)}` : `last ${period} days`;

    // Last sold reads the movement log; units sold is the ladder's (voids and refunds take theirs back).
    const movements = loadMovements();
    const clock = saleClock(movements, boZone(), state.orders);
    const mine = movements.filter((m) => ids.has(m.productId));
    const sold = (ladder(state.orders, { from: since, to: until, by: (o, i) => (ids.has(productFor(i)?.id) ? 'it' : null) }).groups.get('it') || {}).unitsSold || 0;
    const lastSale = (pid) => (clock.get(pid) || {}).lastSale ?? null;
    const lastSold = members.reduce((t, m) => Math.max(t, lastSale(m.id) ?? -1), -1);

    const onHand = onHandOf(members);
    const value = stockValueOf(members);
    // A family's margin is the margin of its summed money (one of each variant), never an average of percents.
    const sum = (k) => unc(members.reduce((n, m) => n + cent(m[k]), 0));
    const margin = marginOf(sum('cost'), sum('price')).margin;
    const level = g ? STOCK_LEVEL[familyLevel(members, clock, Date.now(), boZone())] : levelOf(p, clock);

    // The Dashboard's range dropdown (.pick + popover .menu, a ✓ on the one in use); the click
    // and placement are wired once at the bottom of this file.
    const periodPick = `<button class="pick" popovertarget="itemPeriod" aria-label="Period: ${span}">${day ? dayLabel(day) : `Last ${period} days`}</button>
      <div class="menu" id="itemPeriod" popover role="menu">${PERIODS.map((n) =>
        `<button role="menuitemradio" data-period="${n}" aria-checked="${!day && n === period}">Last ${n} days</button>`).join('')}${dayPickRow(day)}</div>`;

    // Its own head, not .view-head: the one-line v34 slot has no room for the back line over the
    // title and the meta line under it (owner, 2026-09-26). Back to the list as it was left; the
    // name … period, Adjust, Edit; then category · SKU. The status rides on the In stock tile.
    const head = `
      <header class="item-head">
        <a class="item-back" href="${escapeHtml(listHref || Router.href('products', ''))}" aria-label="Back to Items">Items</a>
        <h1>${escapeHtml(name)}</h1>
        <div class="item-acts">
          ${periodPick}
          ${g ? '' : `<button class="secondary-btn small" data-adjust-open="${escapeHtml(p.id)}">Adjust stock</button>`}
          <a class="primary-btn small" href="${escapeHtml(Router.href('products', id + '/edit'))}">Edit</a>
        </div>
        <p class="item-meta">${escapeHtml(folderName(g ? g.folder || (members[0] || {}).folder : p.folder))} · ${
          g ? SalesMath.plural(members.length, 'variant') : escapeHtml(p.sku || 'No SKU')}</p>
      </header>`;

    // One joined bar (bo-calm.css .kpi-row.joined, the customer page's strip). In stock is statCell's
    // markup with the status pill where its trend chip goes: beside the number, never under it.
    const kpis = `<div class="kpi-row joined">
      <div class="bo-card blk-kpi">
        <div class="kpi-label">In stock</div>
        <div class="kpi-line">
          <div class="kpi-value">${qty(onHand)}${unit ? ` <span class="kpi-note">${escapeHtml(unit)}</span>` : ''}</div>
          ${pill(level)}
        </div>
      </div>
      ${kpi('Stock value', pesoShort(value), 'at cost')}
      ${kpi('Margin', pct(margin), g ? `across ${SalesMath.plural(members.length, 'variant')}` : `${peso(marginOf(p.cost, p.price).profit)} gross profit on each`)}
      ${kpi('Last sold', ago(lastSold < 0 ? null : lastSold))}
      ${kpi('Units sold', qty(sold), span)}
    </div>`;

    const variants = g ? tableCard('Variants', `${members.length} in this family`, '',
      '<th>Variant</th><th class="num">In stock</th><th class="num">Price</th><th class="num">Margin</th>'
        + '<th>Last sold</th><th>Status</th><th class="num">Adjust</th>',
      members.map((m) => `
        <tr>
          <td><a class="link-btn" href="${escapeHtml(Router.href('products', m.id))}">${escapeHtml(m.name)}</a></td>
          <td class="num">${qty(m.stock)} ${escapeHtml(m.unit)}</td>
          <td class="num">${peso(m.price)}</td>
          <td class="num">${pct(marginOf(m.cost, m.price).margin)}</td>
          <td>${ago(lastSale(m.id))}</td>
          <td>${pill(levelOf(m, clock))}</td>
          <td class="num"><button class="secondary-btn small" data-adjust-open="${escapeHtml(m.id)}">Adjust</button></td>
        </tr>`), 'No active variants') : '';

    const variantCol = (pid) => (g ? `<td>${escapeHtml((byId.get(pid) || {}).name || pid)}</td>` : '');
    const variantTh = g ? '<th>Variant</th>' : '';

    // Balance after each row: bo-model's runningBalances, the same column Inventory shows.
    const after = runningBalances(mine).balance;
    const word = window.reasonWords ? window.reasonWords(state.orders) : (m) => STOCK_REASONS[m.reason] || m.reason;
    const moves = mine.slice(-10).reverse().map((m) => `
      <tr>
        <td class="tx-time">${escapeHtml(txTime(m.ts))}</td>${variantCol(m.productId)}
        <td>${escapeHtml(word(m))}</td>
        <td class="num">${signedQty(Number(m.qty) || 0)}</td>
        <td class="num">${qty(after.get(m.id))}</td>
        <td class="item-note">${escapeHtml(m.note || '—')}</td>
      </tr>`);
    const movesCard = tableCard('Stock movements', '', Router.href('inventory', '', { tab: 'movements', q: name }),
      `<th>When</th>${variantTh}<th>Reason</th><th class="num">Qty</th><th class="num">Balance</th><th>Note</th>`,
      moves, 'No stock movements yet');

    const prices = loadEvents('priceLog').filter((e) => ids.has(e.productId))
      .sort(SalesMath.newestFirst).slice(0, 10).map((e) => `
      <tr>
        <td class="tx-time">${escapeHtml(txTime(e.ts))}</td>${variantCol(e.productId)}
        <td>${e.field === 'cost' ? 'Cost' : 'Price'}</td>
        <td class="num">${e.old == null ? '—' : peso(e.old)}</td>
        <td class="num"><strong>${peso(e.new)}</strong></td>
      </tr>`);
    const pricesCard = tableCard('Price & cost changes', '', Router.href('inventory', '', { tab: 'prices', q: name }),
      `<th>When</th>${variantTh}<th>What</th><th class="num">From</th><th class="num">To</th>`,
      prices, 'No price or cost changes yet');

    // Baskets in the period that held this item (any variant of it): count the other products in them.
    // ponytail: own loop, not HWPOS_INSIGHTS.basketAffinity - that pairs every product with every
    // other, and summing its pairs over a family double-counts a basket holding two variants.
    const withIt = new Map();
    state.orders.forEach((o) => {
      const ts = SalesMath.tsOf(o);
      if (rowState(o) !== 'sale' || ts < since || ts >= until) return;   // a voided or refunded basket did not leave
      const basket = new Set(o.items.map((i) => i.id).filter(Boolean));
      if (![...basket].some((x) => ids.has(x))) return;
      basket.forEach((x) => { if (!ids.has(x)) withIt.set(x, (withIt.get(x) || 0) + 1); });
    });
    const often = [...withIt].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const oftenCard = often.length ? card('Often bought with', span, '', `
      <div class="bo-card-inset"><div class="mini-list">${often.map(([pid, n]) => `
        <a class="mini-list-row" href="${escapeHtml(Router.href('products', pid))}">
          <div class="ml-left"><span class="ml-name">${escapeHtml((byId.get(pid) || {}).name || pid)}</span></div>
          <span class="ml-value">${SalesMath.plural(n, 'order')}</span>
        </a>`).join('')}</div></div>`, 'blk-list') : '';

    // One column, every card full width (owner, 2026-09-26): what it is, then what happened to it.
    root().innerHTML = `
      <div class="item-page">
        ${head}${kpis}${variants}${movesCard}${pricesCard}${oftenCard}
      </div>`;
  };

  // Back returns to the list as it was left: any click on the list (a row, a link) notes its URL first,
  // filters and all. Capture phase, so it lands before the row navigates. Opened cold, it is plain Products.
  let listHref = '';
  document.addEventListener('click', () => {
    const r = Router.route();
    if (r.view === 'products' && !r.id) listHref = Router.href('products', '', r.params);
  }, true);

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.item-page .menu [data-period]');
    if (!b) return;
    b.closest('.menu').hidePopover();
    Router.setParams({ period: b.dataset.period === '30' ? '' : b.dataset.period, date: '' });
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.matches || !el.matches('.item-page .menu [data-day-pick]')) return;
    el.closest('.menu').hidePopover();
    Router.setParams({ period: '', date: el.value }, { replace: false });
  });
  // The menu hangs under its button from the left edge. `toggle` does not bubble, so capture it.
  document.addEventListener('toggle', (e) => {
    const m = e.target;
    if (e.newState !== 'open' || !m.matches || !m.matches('.item-page .menu')) return;
    const r = root().querySelector(`[popovertarget="${m.id}"]`).getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.left = Math.max(16, Math.min(r.left, innerWidth - m.offsetWidth - 16)) + 'px';
  }, true);
})();
