/* Back office — Sales. Renders the whole #view section; see CONTRACT.
   Pure read: this page never writes storage. Every number comes from the shell's
   helpers (rangeWindows / orderPaymentLabel / costOf / itemNet / productFor), so a
   figure here and the same figure on the dashboard cannot drift apart. */
(function () {
  const VIEW = 'sales';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  // Patterns, By employee and By payment are cards on the Summary now (owner, 2026-09-22).
  // Transactions is its own sidebar link (data-sub="tx"), so it stays a tab here but
  // never shows in Sales' own tree.
  const TABS = [['summary', 'Summary'], ['item', 'By item'], ['category', 'By category'], ['tx', 'Transactions'], ['basket', 'Bought together']];
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).sales = { param: 'by', def: 'summary', items: TABS };

  // How each status moves money. This is the single easiest thing to get wrong here:
  //   completed → the sale counted.
  //   voided / refunded → the ORIGINAL row, flipped in place by app.js. Its revenue was
  //     never booked separately, so it contributes 0 — subtracting would double-reverse it.
  //     It still counts as a transaction and still shows with its status pill.
  //   return → a NEW row app.js appends when money goes back out. That is the negative event.
  // Nothing is ever filtered out of the ledger; the sign is what keeps voids and refunds
  // visible without letting them inflate revenue.
  // SALE_SIGN / saleSign live in backoffice.js so the dashboard and this page cannot disagree.
  const isReversal = (s) => s === 'refunded' || s === 'return';

  const pct = (n) => (n * 100).toFixed(1) + '%';
  const int = (n) => Math.round(Number(n) || 0).toLocaleString('en-PH');
  const qtyText = (n) => (Math.abs(n % 1) > 0.001 ? Number(n).toFixed(2) : int(n));
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100; // CSV: plain number, no ₱
  const longDate = (ts) => new Date(ts).toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' });

  const blank = (extra) => ({ qty: 0, revenue: 0, net: 0, cost: 0, txns: 0, sales: 0, voids: 0, refunds: 0, ...extra });
  function bucket(map, key, seed) {
    let b = map.get(key);
    if (!b) { b = seed(); map.set(key, b); }
    return b;
  }

  // ---------- The one pass ----------
  // Every cut is built here, in a single walk of the window. Adding a tab must not add a pass.
  function agg(rows) {
    const items = new Map(), cats = new Map(), staff = new Map(), pays = new Map(), fuls = new Map();
    const t = blank();
    for (const o of rows) {
      const sign = saleSign(o);
      const rev = o.total * sign;
      const net = (o.total - (o.vatAmount || 0)) * sign;
      const voided = o.status === 'voided' ? 1 : 0;
      const back = isReversal(o.status) ? 1 : 0;

      t.revenue += rev; t.net += net; t.txns += 1; t.voids += voided; t.refunds += back;
      if (sign) t.sales += 1;

      const st = bucket(staff, o.cashier || '—', () => blank({ key: o.cashier || '—', name: o.cashier || '—' }));
      st.revenue += rev; st.net += net; st.txns += 1; st.voids += voided; st.refunds += back;
      if (sign) st.sales += 1;

      const kind = o.paymentKind || o.paymentMethod || 'cash';
      const pb = bucket(pays, kind, () => blank({ key: kind, kind, name: orderPaymentLabel(o) }));
      pb.revenue += rev; pb.net += net; pb.txns += 1; pb.voids += voided; pb.refunds += back;
      if (sign) pb.sales += 1;

      // Walk-in or delivery. `top` collects what that side of the shop actually buys --
      // "delivery is 40% of revenue" is half an answer without "and it is mostly cement".
      // One row per fulfilment type in use, including the owner's own -- an order with no
      // fulfilment field is a walk-in, never a third row.
      const fk = o.fulfilment || 'pickup';
      const fb = bucket(fuls, fk, () => blank({ key: fk, name: orderFulfilLabel(o), top: new Map() }));
      fb.revenue += rev; fb.net += net; fb.txns += 1; fb.voids += voided; fb.refunds += back;
      if (sign) fb.sales += 1;

      // Split the order's money across its lines by each line's share of the line totals.
      // Using itemNet() directly would drift from o.total whenever an order-level discount
      // was applied; allocating keeps by-item and by-category summing back to the summary.
      const gross = o.items.reduce((sum, i) => sum + itemNet(i), 0);
      const even = o.items.length ? 1 / o.items.length : 0;
      for (const i of o.items) {
        const share = gross > 0 ? itemNet(i) / gross : even;
        const p = productFor(i);
        const qty = i.qty * sign;
        const cost = costOf(i) * i.qty * sign;
        const iRev = rev * share, iNet = net * share;

        t.qty += qty; t.cost += cost;
        st.qty += qty; st.cost += cost;
        fb.qty += qty; fb.cost += cost;

        const ik = (p && p.id) || i.id || 'n:' + i.name;
        const ib = bucket(items, ik, () => blank({
          key: ik,
          name: (p && p.name) || i.name,
          sku: (p && p.sku) || i.sku || '—',
          cat: folderName(p ? p.folder : ''),
        }));
        ib.qty += qty; ib.revenue += iRev; ib.net += iNet; ib.cost += cost;

        const ft = bucket(fb.top, ik, () => ({ name: (p && p.name) || i.name, qty: 0 }));
        ft.qty += qty;

        const ck = (p && p.folder) || '';
        const cb = bucket(cats, ck, () => blank({ key: ck, name: folderName(ck) }));
        cb.qty += qty; cb.revenue += iRev; cb.net += iNet; cb.cost += cost;
      }
    }
    const finish = (map) => Array.from(map.values()).map(r => ({
      ...r,
      profit: r.net - r.cost,
      margin: r.net ? (r.net - r.cost) / r.net : 0,
      share: t.revenue ? r.revenue / t.revenue : 0,
      avg: r.sales ? r.revenue / r.sales : 0,
      perSale: r.sales ? r.qty / r.sales : 0,
    }));
    t.profit = t.net - t.cost;
    t.margin = t.net ? t.profit / t.net : 0;
    t.avg = t.sales ? t.revenue / t.sales : 0;
    return { totals: t, items: finish(items), cats: finish(cats), staff: finish(staff), pays: finish(pays), fuls: finish(fuls) };
  }

  // A column's `csv` is already the row reduced to one plain scalar -- the customer's name,
  // the ISO timestamp, the SIGNED total. Sorting on that means the table sorts by exactly
  // what it prints, and there is no second list of accessors to drift out of step. Without
  // it, sorting the ledger by Customer compares two objects and quietly does nothing.
  const sortRows = (rows, key, dir, cols) => {
    const col = cols && cols.find(c => c.key === key);
    const val = col ? col.csv : (r) => r[key];
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y)) : (x || 0) - (y || 0);
      return dir === 'asc' ? c : -c;
    });
  };

  // ---------- Columns: one spec drives the table and the CSV ----------
  const cName = { key: 'name', label: 'Product', cell: r => escapeHtml(r.name), csv: r => r.name };
  const cQty = { key: 'qty', label: 'Qty sold', num: 1, cell: r => qtyText(r.qty), csv: r => money(r.qty) };
  const cRev = { key: 'revenue', label: 'Revenue', num: 1, cell: r => `<strong>${peso(r.revenue)}</strong>`, csv: r => money(r.revenue) };
  const cCost = { key: 'cost', label: 'Cost', num: 1, cell: r => peso(r.cost), csv: r => money(r.cost) };
  const cProfit = { key: 'profit', label: 'Gross profit', num: 1, cell: r => peso(r.profit), csv: r => money(r.profit) };
  const cMargin = { key: 'margin', label: 'Margin %', num: 1, cell: r => (r.net ? pct(r.margin) : '—'), csv: r => (r.net ? money(r.margin * 100) : '') };
  const cShare = { key: 'share', label: 'Share', num: 1, cell: r => pct(r.share), csv: r => money(r.share * 100) };
  const shareBar = {
    key: 'share', label: 'Share', num: 1,
    cell: r => `<span class="share-cell">${pct(r.share)}<i class="share-bar"><i style="width:${Math.max(0, Math.min(100, r.share * 100)).toFixed(1)}%"></i></i></span>`,
    csv: r => money(r.share * 100),
  };

  const COLUMNS = {
    item: [
      cName,
      { key: 'sku', label: 'SKU', cell: r => `<span class="mono">${escapeHtml(r.sku)}</span>`, csv: r => r.sku },
      { key: 'cat', label: 'Category', cell: r => escapeHtml(r.cat), csv: r => r.cat },
      cQty, cRev, cCost, cProfit, cMargin, cShare,
    ],
    category: [{ ...cName, label: 'Category' }, cQty, cRev, cCost, cProfit, cMargin, shareBar],
  };

  const TX_COLUMNS = [
    { key: 'number', label: 'Receipt', cell: o => `#${escapeHtml(o.number)}`, csv: o => '#' + o.number },
    { key: 'ts', label: 'Time', cell: o => `<span class="tx-time">${escapeHtml(txTime(o.ts))}</span>`, csv: o => new Date(o.ts).toISOString() },
    { key: 'customer', label: 'Customer', cell: o => escapeHtml((o.customer && o.customer.name) || '—'), csv: o => (o.customer && o.customer.name) || '' },
    { key: 'cashier', label: 'Staff', cell: o => `<span class="tx-staff">${escapeHtml(o.cashier || '—')}</span>`, csv: o => o.cashier || '' },
    { key: 'fulfilment', label: 'Fulfilment', cell: o => `<span class="tx-fulfil">${escapeHtml(orderFulfilLabel(o))}</span>`, csv: o => orderFulfilLabel(o) },
    { key: 'paymentKind', label: 'Payment', cell: o => `<span class="pay-pill ${escapeHtml(o.paymentKind || 'cash')}">${escapeHtml(orderPaymentLabel(o))}</span>`, csv: o => orderPaymentLabel(o) },
    { key: 'status', label: 'Status', cell: o => { const s = STATUS_TONE[o.status] || STATUS_TONE.completed; return `<span class="status-pill ${s[0]}">${s[1]}</span>`; }, csv: o => o.status },
    { key: 'total', label: 'Total', num: 1, cell: o => `<strong>${peso(txTotal(o))}</strong>`, csv: o => money(txTotal(o)) },
  ];

  function table(cols, rows, sort, empty, sortable = true) {
    const head = cols.map(c =>
      `<th class="${c.num ? 'num' : ''}"${sortable ? ` data-act="sort" data-key="${c.key}"` : ''}>${escapeHtml(c.label)}${sortable && sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('');
    // Only the ledger's rows are orders; every other cut is an aggregate with nothing to open.
    const attr = cols === TX_COLUMNS ? (r => ` class="tx-row" data-order="${escapeHtml(r.id)}"`) : (() => '');
    const body = rows.length
      ? rows.map(r => `<tr${attr(r)}>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="bo-empty">${escapeHtml(empty)}</td></tr>`;
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const card = (label, sub, body, flush) =>
    `<section class="bo-card blk-table"><div class="bo-card-head"><span class="bo-card-label">${escapeHtml(label)}</span>${sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : ''}</div><div class="bo-card-inset${flush ? ' flush' : ''}">${body}</div></section>`;

  // ---------- Profiles: the shell's chart, on this page's rows ----------
  /* backoffice.js already draws revenue against gross profit (renderLineChart) and already
     knows how to bucket a range. What it cannot do is respect this page's payment and staff
     filters, because it walks state.orders directly. So the buckets get built here, out of
     the same filtered rows every other number on the page comes from, and handed to the same
     renderer. No second chart, no chart library.
     A profile is not a timeline: 24 hours, or 7 weekdays, with every day in the range folded
     on top of each other. "What time do we get busy" is a different question from "what
     happened on Tuesday", and only the folded version answers it. */
  function series(slots, rows, slotOf) {
    const out = slots.map(s => ({ ...s, revenue: 0, profit: 0, items: 0, txns: 0 }));
    for (const o of rows) {
      const sign = saleSign(o);
      if (!sign) continue;             // a void books no money and belongs to no hour
      const b = out[slotOf(o)];
      if (!b) continue;
      b.revenue += o.total * sign;
      b.profit += orderProfit(o) * sign;
      b.txns += 1;
      for (const i of o.items) b.items += i.qty * sign;
    }
    return out;
  }

  const hourText = (h) => new Date(2024, 0, 1, h).toLocaleTimeString('en-PH', { hour: 'numeric' });
  // 1 Jan 2024 was a Monday. A hardware shop's week starts there, not on Sunday.
  const dayText = (i, long) => new Date(2024, 0, 1 + i).toLocaleDateString('en-PH', { weekday: long ? 'long' : 'short' });

  const hourSeries = (rows) => series(
    Array.from({ length: 24 }, (_, h) => ({ label: hourText(h), title: hourText(h) })),
    rows, o => new Date(o.ts).getHours());

  const weekdaySeries = (rows) => series(
    Array.from({ length: 7 }, (_, i) => ({ label: dayText(i), title: dayText(i, true) })),
    rows, o => (new Date(o.ts).getDay() + 6) % 7);

  // The range day by day -- what the dashboard plots, filtered. One day of range has no
  // days to plot, so Today draws its own hours instead of a single dot.
  function trendSeries(rows) {
    if (state.range === 'today') return hourSeries(rows);
    const days = RANGE_DAYS[state.range] || 7;
    const base = new Date(state.anchor);
    base.setHours(0, 0, 0, 0);
    const slots = [], idx = new Map();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(base);
      d.setDate(base.getDate() - i);
      idx.set(d.getTime(), slots.length);
      slots.push({
        label: d.toLocaleDateString('en-PH', days > 14 ? { month: 'short', day: 'numeric' } : { weekday: 'short' }),
        title: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
      });
    }
    return series(slots, rows, (o) => {
      const d = new Date(o.ts);
      d.setHours(0, 0, 0, 0);
      return idx.get(d.getTime());
    });
  }

  // A chart is drawn, not stringified: the body builder leaves a placeholder and the
  // renderer runs once the markup is in the document. Same chart-block markup as the
  // dashboard card (bo-blocks.css → CHART); renderLineChart fills the key totals.
  // `head` is the number line; `keys` adds the Revenue / Gross profit switch; `still` drops
  // the "now" dot, which means nothing on an hour or weekday profile.
  let charts = [];
  function chartCard(label, data, { head, keys, still, cls = '' }) {
    const id = `chart${charts.length}`;
    charts.push([id, data]);
    return `
      <section class="bo-card blk-chart ${cls}">
        <span class="bo-card-label">${escapeHtml(label)}</span>
        <div class="blk-head">${head}</div>
        ${keys ? `<div class="blk-keys">
          <button class="blk-key s0" aria-pressed="true"><i></i>Revenue <b></b></button>
          <button class="blk-key s1" aria-pressed="true"><i></i>Gross profit <b></b></button>
        </div>` : ''}
        <div class="blk-plot" id="${id}"${still ? ' data-still' : ''}></div>
      </section>`;
  }

  // "Busiest at 10 AM" is the whole reason to plot a profile. Say it, rather than leave it
  // to be eyeballed off the line.
  function peakHead(data, short) {
    const top = data.reduce((a, b) => (b.revenue > a.revenue ? b : a), data[0]);
    return top && top.revenue > 0
      ? `<div class="blk-head-value kpi-value">${escapeHtml(short(top))}<span class="of"> busiest</span></div><span class="kpi-note">${escapeHtml(pesoShort(top.revenue))}</span>`
      : '<div class="blk-head-value kpi-value">—</div>';
  }

  // 24 hours flattens a shop that opens at 7 and shuts at 6: plot the hours that sold, one
  // either side, and 6 AM to 8 PM when nothing did.
  function openHours(hours) {
    const sold = hours.map((h, i) => (h.txns ? i : -1)).filter(i => i >= 0);
    if (!sold.length) return hours.slice(6, 21);
    return hours.slice(Math.max(0, sold[0] - 1), Math.min(24, sold[sold.length - 1] + 2));
  }

  // ---------- What the URL says ----------
  function readView() {
    const p = Router.route().params;
    const tab = TABS.some(t => t[0] === p.by) ? p.by : 'summary';
    return {
      tab,
      // Multi-pick filters ride the URL as comma lists; empty means all.
      // ponytail: a staff name with a comma in it would split, switch to ids if that ever happens.
      pay: (p.pay || '').split(',').filter(Boolean),
      staff: (p.staff || '').split(',').filter(Boolean),
      ful: (p.ful || '').split(',').filter(Boolean),
      // Revenue desc is the answer to "what makes us money"; everything else is a click away.
      // The ledger is a ledger, so it opens newest-first instead.
      sort: { key: p.sort || (tab === 'tx' ? 'ts' : 'revenue'), dir: p.dir === 'asc' ? 'asc' : 'desc' },
      page: Math.max(1, parseInt(p.page, 10) || 1),
    };
  }

  // Window rows plus the filter option lists, in one walk. Options come from the unfiltered
  // window so picking a staff member cannot empty the payment dropdown.
  function windowRows(v) {
    const win = rangeWindows();
    const payOpts = new Map(), staffOpts = new Set(), fulOpts = new Map();
    const rows = [];
    for (const o of state.orders) {
      if (o.ts < win.start || o.ts >= win.end) continue;
      const kind = o.paymentKind || o.paymentMethod || 'cash';
      if (!payOpts.has(kind)) payOpts.set(kind, orderPaymentLabel(o));
      if (o.cashier) staffOpts.add(o.cashier);
      const ful = o.fulfilment || 'pickup';
      if (!fulOpts.has(ful)) fulOpts.set(ful, orderFulfilLabel(o));
      if (v.pay.length && !v.pay.includes(kind)) continue;
      if (v.staff.length && !v.staff.includes(o.cashier)) continue;
      if (v.ful.length && !v.ful.includes(ful)) continue;
      rows.push(o);
    }
    rows.sort((a, b) => b.ts - a.ts);
    return { rows, win, payOpts, fulOpts, staffOpts: Array.from(staffOpts).sort() };
  }

  function prevRows(v) {
    const win = rangeWindows();
    return state.orders.filter(o => {
      if (o.ts < win.prevStart || o.ts >= win.prevEnd) return false;
      if (v.pay.length && !v.pay.includes(o.paymentKind || o.paymentMethod || 'cash')) return false;
      if (v.staff.length && !v.staff.includes(o.cashier)) return false;
      if (v.ful.length && !v.ful.includes(o.fulfilment || 'pickup')) return false;
      return true;
    });
  }

  // ---------- Render ----------
  function filterSelects(v, payOpts, staffOpts, fulOpts) {
    return multiPick('pay', 'All payment types', 'No payments in this range', 'payment types', Array.from(payOpts), v.pay)
      + multiPick('staff', 'All employees', 'No staff in this range', 'employees', staffOpts.map(s => [s, s]), v.staff)
      + multiPick('ful', 'All fulfilment', 'No orders in this range', 'fulfilment types', Array.from(fulOpts), v.ful);
  }

  function head(v, payOpts, staffOpts, fulOpts) {
    const rangeOpts = ['today', '7d', '15d', '30d']
      .map(r => `<button class="rp-opt${state.range === r ? ' on' : ''}" data-act="range" data-range="${r}">${escapeHtml(RANGE_LABEL[r])}</button>`).join('');
    return `
      <header class="view-head">
        <div class="view-title-wrap">
          <h1>${v.tab === 'summary' ? 'Sales' : escapeHtml(TABS.find(t => t[0] === v.tab)[1])}</h1>
        </div>
        <div class="view-actions">
          ${v.tab === 'tx' ? '' : filterSelects(v, payOpts, staffOpts, fulOpts)}
          <div class="range-picker" data-rp>
            <button class="range-btn" data-act="rp-toggle" aria-haspopup="true">
              <span>${escapeHtml(RANGE_LABEL[state.range])}</span>
              <span class="rp-date">${escapeHtml(longDate(state.anchor))}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="rp-menu" data-rp-menu hidden>
              ${rangeOpts}
              <label class="rp-date-row">Ends on<input type="date" class="bo-date" data-filter="date" value="${isoDate(state.anchor)}" max="${isoDate(Date.now())}" /></label>
            </div>
          </div>
          <button class="primary-btn small" data-act="export">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 20h16"/></svg>
            Export CSV
          </button>
        </div>
      </header>`;
  }

  // What came off the top before revenue: discounts on sales, and the money returns
  // handed back. Gross is worked back from revenue so the card always adds up to it.
  function offTop(rows) {
    let disc = 0, ret = 0, retN = 0;
    for (const o of rows) {
      const sign = saleSign(o);
      if (sign > 0) disc += o.discount || 0;
      if (sign < 0) { ret += o.total; retN += 1; }
    }
    return { disc, ret, retN };
  }
  // More discount or more returns is the bad direction: same chip maths, tone flipped.
  const worse = (dl) => ({ ...dl, tone: dl.tone === 'up' ? 'down' : dl.tone === 'down' ? 'up' : 'flat' });
  const cmpCell = (dl) => [escapeHtml(dl.text), dl.tone === 'flat' ? '' : dl.tone];

  const nameBtn = (name) => `<button type="button" class="nm" data-act="staff" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
  const listCard = (label, body, foot = '', cls = '') =>
    `<section class="bo-card blk-kpi ${cls}"><div class="kpi-label">${escapeHtml(label)}</div>${body}${foot && `<div class="sales-foot">${foot}</div>`}</section>`;
  const emptyRows = '<div class="bo-empty">Nothing sold in this range.</div>';

  // The Shopify-style grid (owner, 2026-09-22): six KPIs across, then three rows of three
  // blocks -- the trend over two columns beside the breakdown; hour, weekday and payment;
  // staff, top items and the targets. Every block is the same height, so the grid never
  // leaves a hole. Patterns, By employee and By payment live here now, as blocks.
  function summary(a, prev, rows, pRows) {
    const cmp = state.range === 'today' ? 'the day before' : 'prev period';
    const d = (cur, was) => deltaOf(cur, was, cmp);
    const t = a.totals, p = prev.totals;

    const stats = `
      <div class="stat-grid show-delta sales-kpis">
        ${[
          statCell({ label: 'Revenue', value: pesoShort(t.revenue), delta: d(t.revenue, p.revenue) }),
          statCell({ label: 'Gross profit', value: pesoShort(t.profit), delta: d(t.profit, p.profit) }),
          statCell({ label: 'Margin', value: t.net ? pct(t.margin) : '—', delta: d(t.margin, p.margin) }),
          statCell({ label: 'Transactions', value: int(t.txns), delta: d(t.txns, p.txns) }),
          statCell({ label: 'Average basket', value: pesoShort(t.avg), delta: d(t.avg, p.avg) }),
          statCell({ label: 'Items sold', value: qtyText(t.qty), delta: d(t.qty, p.qty) }),
        ].join('')}
      </div>`;

    // Row 1: the trend, and where revenue came from.
    const rev = d(t.revenue, p.revenue);
    const trend = chartCard('Sales over time', trendSeries(rows), {
      keys: true, cls: 'w2',
      head: `<div class="blk-head-value">${curHtml(pesoShort(t.revenue))}</div><span class="trend ${rev.tone}" title="${escapeHtml(rev.cmp)}">${escapeHtml(rev.text)}</span>`,
    });
    const o = offTop(rows), po = offTop(pRows);
    const gross = t.revenue + o.disc + o.ret, pGross = p.revenue + po.disc + po.ret;
    const vat = t.revenue - t.net, pVat = p.revenue - p.net;
    const [revText, revTone] = cmpCell(rev);
    const breakdown = listCard('Sales breakdown', `<div class="bd-rows">
      ${bdRow('Gross sales', pesoShort(gross), ...cmpCell(d(gross, pGross)))}
      ${bdRow('Discounts', pesoShort(-o.disc), ...cmpCell(worse(d(o.disc, po.disc))))}
      ${bdRow(`Returns${o.retN ? ` (${int(o.retN)})` : ''}`, pesoShort(-o.ret), ...cmpCell(worse(d(o.ret, po.ret))))}
      ${bdRow('VAT included', pesoShort(vat), ...cmpCell(d(vat, pVat)))}
      ${bdRow('Before VAT', pesoShort(t.net), ...cmpCell(d(t.net, p.net)))}
      <div class="bd-row total"><span class="nm">Net sales</span><span class="amt">${pesoShort(t.revenue)}</span><span class="cmp ${revTone}">${revText}</span></div>
    </div>`, t.voids ? `${int(t.voids)} voided, no revenue` : '');

    // Row 2: when the shop sells, and how it gets paid. Lines, not bars -- there is one
    // chart in the product (docs/backoffice.md → Sales-trend chart).
    const hours = openHours(hourSeries(rows)), days = weekdaySeries(rows);
    const hourCard = chartCard('Sales by hour of day', hours, { still: true, head: peakHead(hours, h => h.title) });
    const dayCard = chartCard('Sales by day of week', days, { still: true, head: peakHead(days, x => x.label) });
    const pays = sortRows(a.pays.filter(r => r.sales), 'revenue', 'desc');
    const payCard = listCard('Payment methods', pays.length ? `<div class="bd-rows">
      ${pays.slice(0, 6).map(r => bdRow(escapeHtml(r.name) + (r.kind === 'credit' ? ' <span class="status-pill warn">Not yet collected</span>' : ''),
        pesoShort(r.revenue), pct(r.share))).join('')}
      <div class="bd-row total"><span class="nm">Total</span><span class="amt">${pesoShort(t.revenue)}</span><span class="cmp">100%</span></div>
    </div>` : emptyRows);

    // Row 3: who sold, what sold, and the goal. A name opens that person's numbers.
    const staff = sortRows(a.staff.filter(r => r.txns), 'revenue', 'desc');
    const staffCard = listCard('Sales by staff', staff.length
      ? `<div class="bd-rows">${staff.slice(0, 6).map(r => bdRow(nameBtn(r.name), pesoShort(r.revenue), pct(r.share))).join('')}</div>` : emptyRows,
      staff.length ? 'Tap a name for their numbers' : '');
    const items = sortRows(a.items, 'revenue', 'desc').slice(0, 5);
    const itemCard = listCard('Top items', items.length
      ? `<div class="bd-rows">${items.map(r => bdRow(escapeHtml(r.name), pesoShort(r.revenue), pct(r.share))).join('')}</div>` : emptyRows,
      '<button type="button" class="link-btn" data-act="tab" data-by="item">All items and categories →</button>');
    // The dashboard's two target widgets, stacked in one block. Calendar, not range: they
    // ignore the filters on purpose (backoffice.js → dashTargets).
    const tg = dashTargets();
    const targetCard = `<section class="bo-card blk-kpi sales-targets">${DASH_WIDGETS.monthly[1](tg)}${tg.month
      ? `<div class="sales-tgt">${DASH_WIDGETS.daily[1](tg).replace(DOTS, '')}</div>` : ''}</section>`;

    return stats + `<div class="sales-grid">${trend}${breakdown}${hourCard}${dayCard}${payCard}${staffCard}${itemCard}${targetCard}</div>`;
  }

  // One person's numbers, on the page's own rows: the same agg(), narrowed to them.
  function openStaff(name) {
    const { rows } = windowRows(readView());
    const t = agg(rows.filter(o => (o.cashier || '—') === name));
    const dlg = document.getElementById('staffDlg');
    const top = sortRows(t.items, 'revenue', 'desc').slice(0, 5);
    const n = t.totals;
    dlg.dataset.name = name;
    dlg.innerHTML = `
      <div class="bod-head">
        <div class="bod-title"><h2>${escapeHtml(name)}</h2></div>
        <button class="bod-close" value="close" aria-label="Close">&times;</button>
      </div>
      <div class="bod-body staff-pop">
        <div class="bo-card-sub">${escapeHtml(rangeLabel())} · same filters as the page</div>
        <div class="bd-rows">
          ${bdRow('Revenue', pesoShort(n.revenue))}${bdRow('Gross profit', pesoShort(n.profit))}
          ${bdRow('Transactions', int(n.txns))}${bdRow('Average basket', pesoShort(n.avg))}
          ${bdRow('Voids', int(n.voids))}
        </div>
        <div class="kpi-label">Top items</div>
        ${top.length ? `<div class="bd-rows">${top.map(r => bdRow(escapeHtml(r.name), pesoShort(r.revenue), qtyText(r.qty) + ' sold')).join('')}</div>` : emptyRows}
        <div class="staff-pop-foot"><button type="button" class="secondary-btn small" data-act="staff-tx">View their transactions</button></div>
      </div>`;
    dlg.showModal();
  }

  // Transactions carries the Products toolbar: search and filters on one row under the head.
  function txTab(rows, v, payOpts, staffOpts, fulOpts) {
    const q = (state.txQuery || '').trim().toLowerCase();
    const hits = sortRows(q
      ? rows.filter(o => [o.number, o.customer && o.customer.name, o.cashier].filter(Boolean).join(' ').toLowerCase().includes(q))
      : rows, v.sort.key, v.sort.dir, TX_COLUMNS);
    const pg = paginate(hits, v.page);
    const search = `<input class="search-input small q-input" placeholder="Search receipt, customer or staff…" autocomplete="off" value="${escapeHtml(state.txQuery || '')}" />`;
    return `
      <div class="tx-filters">${search}${filterSelects(v, payOpts, staffOpts, fulOpts)}</div>
      <section class="bo-card blk-table">
        <div class="bo-card-head"><span class="bo-card-label">All transactions</span><span class="bo-card-sub">${int(hits.length)} shown</span></div>
        <div class="bo-card-inset flush">
          ${table(TX_COLUMNS, pg.rows, v.sort, q ? 'No transactions match that search.' : 'No transactions in this range.')}
          ${pagerHtml(pg)}
        </div>
      </section>`;
  }

  const CUT_ROWS = { item: a => a.items, category: a => a.cats };
  const CUT_LABEL = { item: 'By item', category: 'By category' };

  function cutTab(a, v) {
    const cols = COLUMNS[v.tab];
    const rows = sortRows(CUT_ROWS[v.tab](a), v.sort.key, v.sort.dir);
    return card(CUT_LABEL[v.tab], `${rows.length} row${rows.length === 1 ? '' : 's'}`,
      table(cols, rows, v.sort, 'Nothing sold in this range.'), true);
  }

  window.renderSales = function () {
    refreshSharedState();
    const v = readView();
    // Bought together counts every receipt ever, not the range: no filters, range or CSV.
    if (v.tab === 'basket') {
      root().innerHTML = `<header class="view-head"><div class="view-title-wrap"><h1>Bought together</h1></div></header>
        <div class="dash-stack">${HWPOS_INSIGHTS.card('basket')}</div>`;
      return;
    }
    const { rows, payOpts, staffOpts, fulOpts } = windowRows(v);
    const a = agg(rows);
    const el = root();
    // Restore the caret: the shell's ?q= listener re-runs this render on every keystroke.
    const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.classList.contains('q-input');
    const caret = focused ? document.activeElement.selectionStart : 0;

    // The render rebuilds the menu, so a tick would snap it shut: reopen whichever was open.
    const openMs = el.querySelector('.ms-pick[open]');
    const reopen = openMs && openMs.dataset.ms;

    charts = [];
    const pRows = v.tab === 'summary' ? prevRows(v) : [];
    const body = v.tab === 'summary' ? summary(a, agg(pRows), rows, pRows)
      : v.tab === 'tx' ? txTab(rows, v, payOpts, staffOpts, fulOpts)
      : cutTab(a, v);
    el.innerHTML = head(v, payOpts, staffOpts, fulOpts) + `<div class="dash-stack">${body}</div>`;
    charts.forEach(([id, data]) => renderLineChart(el.querySelector('#' + id), data));
    if (reopen) { const d = el.querySelector(`.ms-pick[data-ms="${reopen}"]`); if (d) d.open = true; }

    if (focused) {
      const input = el.querySelector('.q-input');
      if (input) { input.focus(); input.setSelectionRange(caret, caret); }
    }
  };

  // The maths, hung off the one global so scripts/sales-check.mjs can run it without
  // a DOM. Not a second global, and nothing in the page reads it.
  window.renderSales.agg = agg;

  // ---------- CSV: whatever cut is on screen ----------
  function exportCsv() {
    const v = readView();
    const { rows } = windowRows(v);
    const a = agg(rows);
    let cols, data;
    if (v.tab === 'tx' || v.tab === 'summary') {
      cols = TX_COLUMNS;
      // The CSV is what is on screen, in the order it is on screen.
      data = sortRows(rows, v.sort.key, v.sort.dir, TX_COLUMNS);
    } else {
      cols = COLUMNS[v.tab];
      data = sortRows(CUT_ROWS[v.tab](a), v.sort.key, v.sort.dir);
    }
    const cut = v.tab === 'summary' || v.tab === 'tx' ? 'transactions' : 'by-' + v.tab;
    const name = `sales-${cut}-${state.range}-${isoDate(state.anchor)}.csv`;
    downloadCsv(name, [cols.map(c => c.label)].concat(data.map(r => cols.map(c => c.csv(r)))));
    showToast(`Exported ${data.length} row${data.length === 1 ? '' : 's'}`);
  }

  // ---------- Events: one delegated listener per type ----------
  document.addEventListener('click', (e) => {
    // The staff pop-up sits outside the view: a dialog inside a hidden section never shows.
    const toTx = e.target.closest && e.target.closest('#staffDlg [data-act="staff-tx"]');
    if (toTx) {
      const dlg = toTx.closest('dialog'), { params } = Router.route();
      dlg.close();
      Router.go(VIEW, '', { range: params.range, date: params.date, pay: params.pay, by: 'tx', staff: dlg.dataset.name });
      return;
    }
    const el = root();
    if (!el || !e.target.closest) return;
    // Close the range menu on any click outside it, including one landing off this view.
    const menu = el.querySelector('[data-rp-menu]');
    if (menu && !menu.hidden && !e.target.closest('[data-rp]')) menu.hidden = true;
    el.querySelectorAll('.ms-pick[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    if (!el.contains(e.target)) return;
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'rp-toggle') { if (menu) menu.hidden = !menu.hidden; return; }
    if (act === 'range') { Router.setParams({ range: hit.dataset.range === 'today' ? '' : hit.dataset.range, page: '' }, { replace: false }); return; }
    if (act === 'export') { exportCsv(); return; }
    if (act === 'ms-clear') { Router.setParams({ [hit.dataset.key]: '', page: '' }); return; }
    if (act === 'staff') { openStaff(hit.dataset.name); return; }
    if (act === 'targets') { openTargetDialog(); return; }
    if (act === 'tab') { goSub(VIEW, hit.dataset.by); return; }
    if (act === 'sort') {
      const key = hit.dataset.key;
      const cur = readView().sort;
      // Re-sorting deals the rows again, so page 3 of the old order means nothing.
      Router.setParams({ sort: key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc', page: '' });
    }
  });

  document.addEventListener('change', (e) => {
    const el = root();
    if (!el || !el.contains(e.target)) return;
    const m = e.target.dataset.multi;
    if (m) {
      const picked = [...el.querySelectorAll(`input[data-multi="${m}"]:checked`)].map(i => i.value);
      Router.setParams({ [m]: picked.join(','), page: '' });
      return;
    }
    const f = e.target.dataset.filter;
    if (!f) return;
    if (f === 'date') Router.setParams({ date: e.target.value || '' }, { replace: false });
    else Router.setParams({ [f]: e.target.value, page: '' });
  });
})();
