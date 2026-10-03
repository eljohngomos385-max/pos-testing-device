/* Back office — Orders, the page once called Transactions (transactions-compact-lab.html, ported as is; styles in bo-calm.css).
   Its own page since 2026-09-26 (it was Sales' `?by=tx` tab; bo-sales.js forwards old links here).
   Pure read: this page never writes storage.
   List | Breakdown switch · Export CSV (List only) · range; search + the three filters over the table, or over the
   breakdown blocks (?view=breakdown, owner 2026-09-28: they were widgets beside the table).
   The URL holds it all: ?view=, ?pay= ?staff= ?ful= (comma lists), ?q=, ?sort=&dir=, ?page=, ?receipt= for the
   pop-up. The range menu ends with Pick a day (?date=), so any older day is one pick away. */
(function () {
  const VIEW = 'transactions';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  const TX_PAGE = 50;
  const money = SalesMath.round2; // CSV: plain number, no ₱
  // A row's money is SalesMath.rowAmount (− for a void or refund). A parked cart is not money: '—' on screen, as on the
  // till's Orders rail, blank in the CSV, and never in the header's sum, so the rows add up to it.
  // Orders are sales less voids, floored at 0 by the ladder: a search that keeps only a void row is 0 orders, never −1.
  const count = SalesMath.qtyText;   // the one count/quantity format
  const itemOf = (i) => productFor(i)?.name || i.name;
  // 'YYYY-MM-DD HH:MM:SS' on the store's clock (SalesMath.dayKey's zone). Sorts as text.
  // ponytail: an hour that repeats at a DST fall-back sorts by text; Manila has none.
  const storeTime = (o) => { const zone = SalesMath.storeZone(state.settings);
    return SalesMath.dayKey(o.ts, zone) + ' ' + new Date(SalesMath.tsOf(o)).toLocaleTimeString('en-GB', { timeZone: zone, hourCycle: 'h23' }); };

  // One spec drives the sort and the CSV. A column's `csv` is the row reduced to one plain scalar,
  // so the table sorts by exactly what it prints; `by` sorts Time on the clock itself (the same order,
  // without formatting a time twice per comparison). Ties: SalesMath.newestFirst, the Dashboard's order.
  // Staff = the SELLER, the one the filter and the Breakdown count (who pressed it is on the receipt).
  const TX_COLUMNS = [
    { key: 'number', label: 'Order', csv: o => '#' + o.number },
    { key: 'ts', label: 'Time', csv: o => storeTime(o), by: SalesMath.tsOf },
    { key: 'customer', label: 'Customer', csv: o => (o.customer && o.customer.name) || '' },
    { key: 'cashier', label: 'Staff', csv: o => seller(o).name || '' },
    { key: 'fulfilment', label: 'Fulfilment', csv: o => orderFulfilLabel(o) },
    { key: 'paymentKind', label: 'Payment', csv: o => orderPaymentLabel(o) },
    { key: 'status', label: 'Status', csv: o => statusName(o) },
    { key: 'total', label: 'Total', csv: o => (SalesMath.rowAmount(o) == null ? '' : money(SalesMath.rowAmount(o))), by: o => SalesMath.rowAmount(o) ?? 0 },
  ];
  const sortRows = (rows, key, dir) => {
    const col = TX_COLUMNS.find(c => c.key === key) || TX_COLUMNS[1], val = col.by || col.csv;
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x || 0) - (y || 0);
      return (dir === 'asc' ? c : -c) || SalesMath.newestFirst(a, b);
    });
  };

  // ---------- What the URL says ----------
  function readView() {
    const p = Router.route().params;
    return {
      // Multi-pick filters ride the URL as comma lists; empty means all.
      // ponytail: a staff name with a comma in it would split, switch to ids if that ever happens.
      pay: (p.pay || '').split(',').filter(Boolean),
      staff: (p.staff || '').split(',').filter(Boolean),
      ful: (p.ful || '').split(',').filter(Boolean),
      // The ledger is a ledger, so it opens newest-first.
      sort: { key: p.sort || 'ts', dir: p.dir === 'asc' ? 'asc' : 'desc' },
      page: Math.max(1, parseInt(p.page, 10) || 1),
      bd: p.view === 'breakdown',
    };
  }

  // A row's values for each filter, and its test. skip: the block that ignores its own filter.
  // pay: the row's tender keys (SalesMath.paymentsOf): a split sale is its legs, cash and account, never "Split".
  // staff: the SELLER (SalesMath.sellerOf, owner 2026-10-02): a void or refund is the original sale's staff member's.
  // Set from every order and the staff list on each render: the sale may sit outside the range, and an old
  // name-only row files under its person's id (one person, one row).
  let seller = SalesMath.sellerOf([], []);
  const TX_KEY = { pay: o => SalesMath.paymentsOf(o).map(x => x.key), staff: o => seller(o).key, ful: o => o.fulfilment || 'walkin' };
  const TX_NAME = { pay: (o, k) => SalesMath.tenderLabel(k), staff: o => seller(o).name || '—', ful: o => orderFulfilLabel(o) };   // a key's words
  const txPass = (o, v, skip) => Object.keys(TX_KEY).every(f => f === skip || !v[f].length || [].concat(TX_KEY[f](o)).some(k => v[f].includes(k)));

  // Window rows plus the filter option lists, in one walk. Options come from the unfiltered
  // window so picking a staff member cannot empty the payment dropdown.
  function windowRows(v) {
    const win = rangeWindows();
    seller = SalesMath.sellerOf(state.orders);
    const payOpts = new Map(), staffOpts = new Map(), fulOpts = new Map();
    const rows = [], all = [];
    for (const o of state.orders) {
      const t = SalesMath.tsOf(o);
      if (t < win.start || t >= win.end) continue;
      for (const k of TX_KEY.pay(o)) if (!payOpts.has(k)) payOpts.set(k, TX_NAME.pay(o, k));
      const sk = TX_KEY.staff(o);
      if (sk !== '—' && !staffOpts.has(sk)) staffOpts.set(sk, TX_NAME.staff(o));
      const ful = TX_KEY.ful(o);
      if (!fulOpts.has(ful)) fulOpts.set(ful, TX_NAME.ful(o));
      all.push(o);
      if (txPass(o, v)) rows.push(o);
    }
    rows.sort(SalesMath.newestFirst);
    return { rows, all, payOpts, fulOpts, staffOpts };
  }

  // What the table shows, in its order: the window's filtered rows, searched, sorted. The CSV and ‹ › use it too.
  function txSearch(rows) {
    const q = (state.txQuery || '').trim().toLowerCase();
    const hay = o => [o.number, o.id, o.customer && o.customer.name, seller(o).name, ...(o.items || []).map(itemOf)].join(' ').toLowerCase();
    return q ? rows.filter(o => hay(o).includes(q)) : rows;
  }
  const txHits = (rows, v) => sortRows(txSearch(rows), v.sort.key, v.sort.dir);

  // ---------- Render ----------
  // The Breakdown view (?view=breakdown, owner 2026-09-28; the widgets beside the table before, transactions-compact-lab.html):
  // Net sales, then Payment and Staff led by pesos, Fulfilment by count, the other number beside it. They follow the
  // range, search and filters, the same as the list; a row is a filter, and each block ignores its own filter so its
  // other values stay in view.
  const TX_W = { net: 'Net sales', pay: 'Payment', ful: 'Fulfilment', staff: 'Staff' };   // ponytail: Channels, Stores join here
  function txRail(v, all) {
    const base = txSearch(all), sum = ladder(base.filter(o => txPass(o, v))), plural = SalesMath.plural, nOrders = plural(sum.orders, 'order');
    const wrow = (nm, cnt, amt, attrs, cls) => `<div class="row ${cls}"${attrs}><span class="nm">${nm}</span><span class="cnt">${cnt}</span><span class="amt">${amt}</span></div>`;
    const facet = (f, top = 0, byCount = false) => {   // byCount: the count is the number, pesos on hover
      // Orders and money per value, off the ladder: Payment is what each tender took in (SalesMath.tenders, a split
      // sale's legs apart), the rest Net sales. A split sale is one order under each of its tenders.
      const names = new Map(), rows = base.filter(o => txPass(o, v, f)), paid = f === 'pay' ? SalesMath.tenders(rows) : null;
      const g = ladder(rows, { by: o => { const k = TX_KEY[f](o); for (const x of [].concat(k)) names.set(x, TX_NAME[f](o, x)); return k; } }).groups;
      // A tender that nets to ₱0 (a sale and its void) is not a row, as on the Dashboard (tenders() drops it), unless it is picked.
      const m = new Map([...g].filter(([k]) => !paid || paid.has(k) || v[f].includes(k))
        .map(([k, s]) => [k, { name: names.get(k), n: s.orders, v: paid ? paid.get(k) || 0 : s.netSales }]));
      const list = [...m].sort((a, b) => b[1].v - a[1].v).slice(0, top || undefined);
      return `<div class="top band"><span>${TX_W[f]}</span><span class="acts">${v[f].length ? `<a data-f="${f}" data-v="">Show all</a>` : ''}</span></div>` + (list.length
        ? `<div class="rows">${list.map(([k, e]) => wrow(escapeHtml(e.name), ...(byCount ? [pesoShort(e.v), count(e.n)] : [count(e.n), pesoShort(e.v)]), ` data-f="${f}" data-v="${escapeHtml(k)}"`, v[f].includes(k) ? 'on' : '')).join('')}</div>`
        : '<p class="note" style="margin:10px 0 0">No sales here.</p>');
    };
    const html = {
      net: () => `<div class="top band one" title="${nOrders}${sum.voidCount ? ` · ${plural(sum.voidCount, 'void')}` : ''}${sum.refundCount ? ` · ${plural(sum.refundCount, 'refund')}` : ''}"><span>Net sales</span>
        <span class="acts"><span class="cnt">${nOrders}</span><span class="nv">${pesoShort(sum.netSales)}</span></span></div>`,
      pay: () => facet('pay'), ful: () => facet('ful', 0, true), staff: () => facet('staff'),
    };
    return Object.keys(TX_W).map(id => `<section class="card w${id === 'net' ? ' one' : ''}" data-rail="${id}">${html[id]()}</section>`).join('');
  }
  // List | Breakdown, the Sales and Products switch: search, filters, range and sort ride along.
  const txSwitch = (bd) => `<div class="seg pd-switch" aria-label="Orders view">${[['', 'List'], ['breakdown', 'Breakdown']].map(([k, label]) =>
    `<a class="seg-btn${(k === 'breakdown') === bd ? ' active' : ''}" href="${escapeHtml(Router.href(VIEW, '', { ...Router.route().params, view: k, page: '', receipt: '' }))}">${label}</a>`).join('')}</div>`;
  function txPage(v, rows, all, payOpts, staffOpts, fulOpts) {
    const L = txHits(rows, v), pages = Math.max(1, Math.ceil(L.length / TX_PAGE));
    const page = Math.min(v.page, pages) - 1, shown = L.slice(page * TX_PAGE, page * TX_PAGE + TX_PAGE);
    const any = v.pay.length || v.staff.length || v.ful.length || state.txQuery;
    const pick = (f, all, many, have) => {   // what this range has, plus anything already picked
      // a pick outside this range is named the way its rows would name it: a person, never their raw id
      const m = new Map(have);
      for (const x of v[f]) if (!m.has(x)) { const o = state.orders.find(r => [].concat(TX_KEY[f](r)).includes(x));
        m.set(x, o ? TX_NAME[f](o, x) : f === 'staff' ? staffNameOf(x) || '—' : x); }
      const opts = [...m].sort((a, b) => String(a[1]).localeCompare(String(b[1]))), picked = opts.filter(([k]) => v[f].includes(k));
      return `<button class="pick${picked.length ? ' on' : ''}" popovertarget="txm-${f}">${escapeHtml(!picked.length ? all : picked.length === 1 ? picked[0][1] : `${picked.length} ${many}`)}</button>`
        + `<div class="menu" id="txm-${f}" popover role="menu" data-f="${f}">${opts.length
          ? opts.map(([k, n]) => `<button role="menuitemcheckbox" data-v="${escapeHtml(k)}" aria-checked="${v[f].includes(k)}">${escapeHtml(n)}</button>`).join('')
          : '<div class="none">Nothing in this range</div>'}${v[f].length ? '<hr><button class="clear" data-v="">Show all</button>' : ''}</div>`;
    };
    // Click to sort; no arrow on the header (owner, 2026-09-26).
    const sortTh = (lbl, key, cls = '') => `<th class="${cls}"><button class="sort" data-act="sort" data-key="${key}">${lbl}</button></th>`;
    const table = shown.length ? `<div class="flush"><table class="tx">
      <tr><th>Order</th>${sortTh('Time', 'ts')}<th class="opt">Customer</th><th class="opt">Staff</th><th class="opt">Fulfilment</th><th>Payment</th><th class="opt">Status</th>${sortTh('Total', 'total', 'n')}</tr>
      ${shown.map(o => `<tr data-receipt="${escapeHtml(o.id)}" class="${rowDim(o)}">
        <td class="id">#${escapeHtml(o.number || o.id)}</td><td class="t">${escapeHtml(txTime(o.ts))}</td>
        <td class="opt cust">${o.customer?.name ? escapeHtml(o.customer.name) : '<span class="mut">—</span>'}</td>
        <td class="opt">${escapeHtml(seller(o).name || '—')}</td><td class="opt">${escapeHtml(orderFulfilLabel(o))}</td>
        ${txPayStatus(o)}
        <td class="n amt">${txTotal(o)}</td></tr>`).join('')}
    </table></div>
    ${pages > 1 ? `<div class="pager"><span>${page * TX_PAGE + 1}–${page * TX_PAGE + shown.length} of ${count(L.length)}</span>
      <button class="icon-btn" data-act="tx-page" data-to="${page}" aria-label="Previous page" ${page ? '' : 'disabled'}>‹</button>
      <button class="icon-btn" data-act="tx-page" data-to="${page + 2}" aria-label="Next page" ${page < pages - 1 ? '' : 'disabled'}>›</button></div>` : ''}`
      : `<p class="note">No orders ${any ? 'match these filters' : state.range === 'today' ? 'yet today' : 'in this range'}.</p>`;
    return `<div class="c-main">
      <div class="bar">
        ${txSwitch(v.bd)}
        ${v.bd ? '' : `<button class="btn" data-act="export">${DOWNLOAD_ICON}Export CSV</button>`}
        <button class="pick" popovertarget="txRange">${escapeHtml(rangeLabel())}</button>
        <div class="menu" id="txRange" popover role="menu">
          ${Object.keys(RANGE_DAYS).map(r => `<button role="menuitemradio" data-act="range" data-range="${r}" aria-checked="${r === state.range}">${RANGE_LABEL[r]}</button>`).join('')}
          ${dayPickRow(state.range === 'today' && state.anchor)}
        </div>
      </div>
      <div class="filters">
        <input class="q q-input" type="search" placeholder="Search receipt, customer, staff or item" aria-label="Search orders" autocomplete="off" value="${escapeHtml(state.txQuery || '')}" />
        ${pick('pay', 'All payment types', 'payment types', payOpts)}${pick('staff', 'All staff', 'staff', staffOpts)}${pick('ful', 'All fulfilment', 'fulfilment types', fulOpts)}
      </div>
      ${v.bd ? `<div class="rail bd">${txRail(v, all)}</div>` : `<section class="card">
        <div class="head"><span class="lbl">All orders<span class="sum">${pesoShort(ladder(L).collected)}</span></span><a data-act="tx-clear"${any ? '' : ' hidden'}>Clear filters</a></div>
        ${table}
      </section>`}
    </div>
    <dialog><div class="pop"></div></dialog>`;
  }
  // The receipt pop-up, drawn after the page: ‹ › walk the table as it is filtered and sorted.
  function txPop(el, v, rows) {
    const id = Router.route().params.receipt;
    if (!id) return;
    const L = txHits(rows, v), o = L.find(x => x.id === id) || rows.find(x => x.id === id);
    if (!o) { Router.setParams({ receipt: '' }); return; }   // a stale ?receipt= leaves the URL, like the Dashboard
    const dlg = el.querySelector('dialog');
    dlg.querySelector('.pop').innerHTML = receiptPop({ rows: L }, o);
    // Esc, the backdrop (the global dialog handler) and ✕ all just close it; closing clears the URL.
    // A re-render drops this dialog for a new one: that is not a close.
    dlg.addEventListener('close', () => { if (dlg.isConnected) Router.setParams({ receipt: '' }); });
    dlg.showModal();
  }

  window.renderTransactions = function () {
    refreshSharedState();
    const v = readView();
    const el = root();
    const { rows, all, payOpts, staffOpts, fulOpts } = windowRows(v);
    // Restore the caret: the shell's ?q= listener re-runs this render on every keystroke.
    const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.classList.contains('q-input');
    const caret = focused ? document.activeElement.selectionStart : 0;
    // The render rebuilds the menus, so a tick would snap one shut: reopen whichever was open.
    const openMenu = el.querySelector('.menu[data-f]:popover-open');
    el.innerHTML = txPage(v, rows, all, payOpts, staffOpts, fulOpts);
    if (openMenu) document.getElementById(openMenu.id)?.showPopover();
    txPop(el, v, rows);
    if (focused) {
      const input = el.querySelector('.q-input');
      if (input) { input.focus(); input.setSelectionRange(caret, caret); }
    }
  };

  // ---------- CSV: the filtered, searched, sorted rows, in the order on screen ----------
  function exportCsv() {
    const v = readView(), data = txHits(windowRows(v).rows, v);
    downloadCsv(`sales-orders-${state.range}-${isoDate(state.anchor)}.csv`,
      [TX_COLUMNS.map(c => c.label)].concat(data.map(r => TX_COLUMNS.map(c => c.csv(r)))));
    showToast(`Exported ${SalesMath.plural(data.length, 'row')}`);
  }

  // ---------- Events: filter ticks, rows, the pop-up's ‹ › ✕, then the page's buttons ----------
  function txClick(t) {
    const mv = t.closest('.menu[data-f] [data-v], .rail [data-f]');
    if (mv) {
      const f = mv.dataset.f || mv.closest('.menu').dataset.f, x = mv.dataset.v, cur = readView()[f];
      Router.setParams({ [f]: (!x ? [] : cur.includes(x) ? cur.filter(y => y !== x) : [...cur, x]).join(','), page: '' });
      return true;
    }
    const r = t.closest('tr[data-receipt]');
    if (r) { Router.setParams({ receipt: r.dataset.receipt }); return true; }
    if (t.closest('dialog [data-close]')) { t.closest('dialog').close(); return true; }
    const st = t.closest('dialog [data-step]');
    if (!st) return false;
    const v = readView(), L = txHits(windowRows(v).rows, v), i = L.findIndex(x => x.id === Router.route().params.receipt) + +st.dataset.step;
    if (L[i]) Router.setParams({ receipt: L[i].id, page: i < TX_PAGE ? '' : String(Math.floor(i / TX_PAGE) + 1) });   // the table pages along
    return true;
  }
  // Menus hang under their button: the range right-aligned, the filters left. `toggle` does not bubble, so capture it.
  document.addEventListener('toggle', (e) => {
    const m = e.target;
    if (e.newState !== 'open' || !m.matches || !m.matches('.calm-tx .menu')) return;
    const r = root().querySelector(`[popovertarget="${m.id}"]`).getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.left = Math.max(16, Math.min(m.id === 'txRange' ? r.right - m.offsetWidth : r.left, innerWidth - m.offsetWidth - 16)) + 'px';
  }, true);

  document.addEventListener('click', (e) => {
    const el = root();
    if (!el || !e.target.closest || !el.contains(e.target)) return;
    if (txClick(e.target)) return;
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'range') { Router.setParams({ range: hit.dataset.range === 'today' ? '' : hit.dataset.range, date: '', page: '' }, { replace: false }); return; }
    if (act === 'export') { exportCsv(); return; }
    if (act === 'tx-page') { Router.setParams({ page: hit.dataset.to === '1' ? '' : hit.dataset.to }); return; }
    if (act === 'tx-clear') { Router.setParams({ pay: '', staff: '', ful: '', q: '', page: '' }); return; }
    if (act === 'sort') {
      const key = hit.dataset.key, cur = readView().sort;
      // Re-sorting deals the rows again, so page 3 of the old order means nothing.
      Router.setParams({ sort: key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc', page: '' });
    }
  });

  document.addEventListener('change', (e) => {
    const el = root();
    if (!el || !el.contains(e.target) || !e.target.matches('[data-day-pick]')) return;
    Router.setParams({ range: '', date: dayParam(e.target.value), page: '', receipt: '' }, { replace: false });
  });
})();
