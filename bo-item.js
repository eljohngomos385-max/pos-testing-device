/* Back office - one item's page, /admin/products/<id>. Read-only: it answers "how is this
   item doing" and every card points at the page that acts on it (Adjust, Edit, Inventory's
   movement and price logs). `id` is a product id or a family (group) id; a family shows its
   variants summed, with Adjust per variant. Renders into the Products view root, which
   bo-products.js dispatches here from window.renderProducts. */
(function () {
  const root = () => document.querySelector('.view[data-view="products"]');
  const PERIODS = [7, 30, 90];
  const DAY = 864e5;

  const loadGroups = () => readJsonStorage(STORAGE_GROUPS, null)
    || (typeof SEED_GROUPS !== 'undefined' ? SEED_GROUPS.map((g) => ({ ...g })) : []);
  const qty = (n) => (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const signedQty = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + qty(Math.abs(n));
  const pct = (n) => `${n.toFixed(1)}%`;
  const ago = (ms) => {
    if (ms == null) return 'Never';
    const d = Math.round((dayStart(Date.now()) - dayStart(ms)) / DAY);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
  };
  const pill = ([tone, label]) => `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
  const levelOf = (p, clock) => (p.archived ? ['muted', 'Archived'] : STOCK_LEVEL[stockLevel(p, clock.get(p.id))]);
  // A family is Out only when every variant is; one short variant makes it Low, like the list row.
  function familyLevel(members, clock) {
    const lv = members.map((m) => stockLevel(m, clock.get(m.id)));
    const key = !lv.length || lv.every((l) => l === 'out') ? 'out'
      : lv.some((l) => l === 'out' || l === 'low') ? 'low' : lv.every((l) => l === 'dead') ? 'dead' : 'ok';
    return STOCK_LEVEL[key];
  }

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
        <a class="link-btn" href="${escapeHtml(Router.href('products', ''))}">← Products</a>
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
    const since = Date.now() - period * DAY;

    // The movement log is the stock truth: last sold and units sold read it, like Inventory's Sold 30d.
    const movements = loadMovements();
    const clock = saleClock(movements);
    const mine = movements.filter((m) => ids.has(m.productId));
    const sold = mine.reduce((n, m) => n + (m.reason === 'sale' && Date.parse(m.ts) >= since ? Math.abs(Number(m.qty) || 0) : 0), 0);
    const lastSale = (pid) => (clock.get(pid) || {}).lastSale ?? null;
    const lastSold = members.reduce((t, m) => Math.max(t, lastSale(m.id) ?? -1), -1);

    const onHand = members.reduce((n, m) => n + (Number(m.stock) || 0), 0);
    const value = members.reduce((n, m) => n + stockValue(m), 0);
    // ponytail: a family's margin is the plain average of its variants, not revenue-weighted.
    const margins = members.map((m) => marginSummary(m.cost, m.price).margin);
    const margin = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0;
    const level = g ? familyLevel(members, clock) : levelOf(p, clock);

    const periodHref = (n) => Router.href('products', id, { ...params, period: n === 30 ? '' : n });
    const periodSeg = `<div class="seg item-period">${PERIODS.map((n) =>
      `<a class="seg-btn${n === period ? ' active' : ''}" href="${escapeHtml(periodHref(n))}">${n} days</a>`).join('')}</div>`;

    const head = `
      <header class="view-head">
        <div class="view-title-wrap">
          <a class="link-btn" href="${escapeHtml(Router.href('products', ''))}">← Products</a>
          <h1>${escapeHtml(name)}</h1>
          <span class="muted">${escapeHtml(folderName(g ? g.folder || (members[0] || {}).folder : p.folder))} · ${
            g ? `${members.length} variant${members.length === 1 ? '' : 's'}` : escapeHtml(p.sku || 'No SKU')}</span>
          ${pill(level)}
        </div>
        <div class="view-actions">
          ${periodSeg}
          ${g ? '' : `<button class="secondary-btn small" data-adjust-open="${escapeHtml(p.id)}">Adjust stock</button>`}
          <a class="primary-btn small" href="${escapeHtml(Router.href('products', id + '/edit'))}">Edit</a>
        </div>
      </header>`;

    const kpis = `<div class="kpi-row">
      ${statCell({ label: 'On hand', value: qty(onHand), unit })}
      ${kpi('Stock value', pesoShort(value), 'at cost')}
      ${kpi('Margin', pct(margin), g ? `avg of ${members.length} variants` : `${peso(marginSummary(p.cost, p.price).profit)} a unit`)}
      ${kpi('Last sold', ago(lastSold < 0 ? null : lastSold), lastSold < 0 ? '' : shortDate(lastSold))}
      ${kpi('Units sold', qty(sold), `last ${period} days`)}
    </div>`;

    const variants = g ? tableCard('Variants', `${members.length} in this family`, '',
      '<th>Variant</th><th class="num">On hand</th><th class="num">Price</th><th class="num">Margin</th>'
        + '<th>Last sold</th><th>Status</th><th class="num">Adjust</th>',
      members.map((m) => `
        <tr>
          <td><a class="link-btn" href="${escapeHtml(Router.href('products', m.id))}">${escapeHtml(m.name)}</a></td>
          <td class="num">${qty(m.stock)} ${escapeHtml(m.unit)}</td>
          <td class="num">${peso(m.price)}</td>
          <td class="num">${pct(marginSummary(m.cost, m.price).margin)}</td>
          <td>${ago(lastSale(m.id))}</td>
          <td>${pill(levelOf(m, clock))}</td>
          <td class="num"><button class="secondary-btn small" data-adjust-open="${escapeHtml(m.id)}">Adjust</button></td>
        </tr>`), 'No active variants') : '';

    const variantCol = (pid) => (g ? `<td>${escapeHtml((byId.get(pid) || {}).name || pid)}</td>` : '');
    const variantTh = g ? '<th>Variant</th>' : '';

    // Balance after each row, walked back from today's on-hand like Inventory's runningBalances,
    // so rows written before applyMovement stamped balanceAfter still get one.
    const run = new Map(members.map((m) => [m.id, Number(m.stock) || 0]));
    const after = new Map();
    for (let i = mine.length - 1; i >= 0; i--) {
      const m = mine[i];
      after.set(m, run.get(m.productId));
      run.set(m.productId, round2(run.get(m.productId) - (Number(m.qty) || 0)));
    }
    const moves = mine.slice(-10).reverse().map((m) => `
      <tr>
        <td class="tx-time">${escapeHtml(txTime(m.ts))}</td>${variantCol(m.productId)}
        <td>${escapeHtml(STOCK_REASONS[m.reason] || m.reason)}</td>
        <td class="num">${signedQty(Number(m.qty) || 0)}</td>
        <td class="num">${qty(after.get(m))}</td>
        <td class="item-note">${escapeHtml(m.note || '—')}</td>
      </tr>`);
    const movesCard = tableCard('Stock movements', '', Router.href('inventory', '', { tab: 'movements', q: name }),
      `<th>When</th>${variantTh}<th>Reason</th><th class="num">Qty</th><th class="num">Balance</th><th>Note</th>`,
      moves, 'No stock movements yet');

    const prices = loadEvents('priceLog').filter((e) => ids.has(e.productId))
      .sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 10).map((e) => `
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
      if (saleSign(o) <= 0 || o.ts < since) return;
      const basket = new Set(o.items.map((i) => i.id).filter(Boolean));
      if (![...basket].some((x) => ids.has(x))) return;
      basket.forEach((x) => { if (!ids.has(x)) withIt.set(x, (withIt.get(x) || 0) + 1); });
    });
    const often = [...withIt].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const oftenCard = often.length ? card('Often bought with', `last ${period} days`, '', `
      <div class="bo-card-inset"><div class="mini-list">${often.map(([pid, n]) => `
        <a class="mini-list-row" href="${escapeHtml(Router.href('products', pid))}">
          <div class="ml-left"><span class="ml-name">${escapeHtml((byId.get(pid) || {}).name || pid)}</span></div>
          <span class="ml-value">${n} order${n === 1 ? '' : 's'}</span>
        </a>`).join('')}</div></div>`, 'blk-list') : '';

    root().innerHTML = `${head}
      <div class="item-page">
        ${kpis}
        <div class="item-grid">
          <div class="item-col">${variants}${movesCard}</div>
          <div class="item-col">${pricesCard}${oftenCard}</div>
        </div>
      </div>`;
  };
})();
