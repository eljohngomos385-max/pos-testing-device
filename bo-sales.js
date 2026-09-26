/* Back office — Sales. Renders the whole #view section; see CONTRACT.
   Pure read: this page never writes storage. Every number comes from the shell's
   helpers (rangeWindows / orderPaymentLabel / costOf / itemNet / productFor), so a
   figure here and the same figure on the dashboard cannot drift apart. */
(function () {
  const VIEW = 'sales';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  // Patterns, By employee and By payment are cards on the Summary now (owner, 2026-09-22).
  // Transactions is its own page (bo-transactions.js); renderSales forwards old ?by=tx links.
  const TABS = [['summary', 'Summary'], ['item', 'By item'], ['category', 'By category'], ['basket', 'Bought together']];
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

  const sortRows = (rows, key, dir) => {
    return rows.slice().sort((a, b) => {
      const x = a[key], y = b[key];
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

  function table(cols, rows, sort, empty, sortable = true) {
    const head = cols.map(c =>
      `<th class="${c.num ? 'num' : ''}"${sortable ? ` data-act="sort" data-key="${c.key}"` : ''}>${escapeHtml(c.label)}${sortable && sort.key === c.key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('');
    const body = rows.length
      ? rows.map(r => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.cell(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="bo-empty">${escapeHtml(empty)}</td></tr>`;
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const card = (label, sub, body, flush) =>
    `<section class="bo-card blk-table"><div class="bo-card-head"><span class="bo-card-label">${escapeHtml(label)}</span>${sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : ''}</div><div class="bo-card-inset${flush ? ' flush' : ''}">${body}</div></section>`;

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
      sort: { key: p.sort || 'revenue', dir: p.dir === 'asc' ? 'asc' : 'desc' },
    };
  }

  // A row's value for each filter, and its test.
  const TX_KEY = { pay: o => o.paymentKind || o.paymentMethod || 'cash', staff: o => o.cashier, ful: o => o.fulfilment || 'pickup' };
  const txPass = (o, v) => Object.keys(TX_KEY).every(f => !v[f].length || v[f].includes(TX_KEY[f](o)));

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
      if (txPass(o, v)) rows.push(o);
    }
    rows.sort((a, b) => b.ts - a.ts);
    return { rows, win, payOpts, fulOpts, staffOpts: Array.from(staffOpts).sort() };
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
          ${filterSelects(v, payOpts, staffOpts, fulOpts)}
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

  // ---------- Summary: the month calendar (sales-calendar-lab.html, ported as is) ----------
  // Its own window, not the range picker's: a month or a year. The URL holds it all --
  // ?view=year, ?month=YYYY-MM, ?day= / ?week= for the side panel, ?top= for the Top 10 --
  // so every click is a setParams and a re-render, and Back walks it.
  const fmt = (t, o) => new Date(t).toLocaleDateString('en-PH', o);
  const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1).getTime(); };
  const monthEnd = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };
  const weekEnd = (t) => Math.min(shiftDays(t, 7 - ((new Date(t).getDay() + 6) % 7)), monthEnd(t));   // exclusive, clipped to the month
  const daysIn = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); };
  const itemOf = (i) => productFor(i)?.name || i.name;
  const catOf = (i) => folderName(productFor(i)?.folder);
  const calRow = (nm, amt, cmp = '', cls = '') => `<div class="row ${cls}"><span class="nm">${nm}</span><span class="amt">${amt}</span>${cmp !== null ? `<span class="cmp">${cmp}</span>` : ''}</div>`;
  const breakdownRows = (m) => `<div class="rows">
      ${calRow('Gross sales', pesoShort(m.sales + m.disc), null)}
      ${calRow('Discounts', m.disc ? pesoShort(-m.disc) : '₱0', null)}
      ${calRow(`Returns${m.retN ? ` (${m.retN})` : ''}`, m.ret ? pesoShort(-m.ret) : '₱0', null)}
      ${calRow('VAT included', pesoShort(m.vat), null)}
      ${calRow('Net sales', pesoShort(m.rev), null, 'total')}</div>`;

  const lastSale = () => state.orders.reduce((a, o) => Math.max(a, o.ts), 0) || Date.now();
  function calState(p, last) {
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? fromIso(p.month + '-01')
      : (d => new Date(d.getFullYear(), d.getMonth(), 1).getTime())(new Date(Math.min(last, Date.now())));
    const view = p.view === 'year' ? 'year' : 'month';
    return {
      view, month,
      top: ['cat', 'day', 'hour'].includes(p.top) ? p.top : 'item',
      chart: ['gp', 'n', 'mg'].includes(p.chart) ? p.chart : 'rev',
      sel: view === 'year' ? null : p.day ? { kind: 'day', at: fromIso(p.day) } : p.week ? { kind: 'week', at: fromIso(p.week) } : null,
    };
  }

  // The strip is the card's folder tabs (sales-calendar-tabs-lab.html): the picked tab is what every calendar cell shows.
  const mgOf = (x) => (x.rev ? x.gp / x.rev * 100 : 0);
  const count = (v) => (+v.toFixed(1)).toLocaleString('en-PH');
  const pct1 = (v) => v.toFixed(1) + '%';
  const MEAS = {
    rev: { lbl: 'Revenue', of: m => m.rev, fmt: pesoShort, sm: pesoK, sub: m => `${m.n} receipts` },
    gp: { lbl: 'Gross profit', of: m => m.gp, fmt: pesoShort, sm: pesoK, sub: m => `${pct1(mgOf(m))} margin` },
    n: { lbl: 'Receipts', of: m => m.n, fmt: count, sm: count, sub: m => (m.n ? `${pesoShort(m.rev / m.n)} average` : '') },
    mg: { lbl: 'Margin', of: mgOf, fmt: pct1, sm: pct1, sub: m => `${pesoK(m.gp)} profit` },
  };
  // days = days that had sales, the same average an untargeted calendar greens against.
  function calStrip(S, cur, prev, prevTitle, days, target) {
    const tab = (k, val, side, sub, tip = '') =>
      `<button class="stat" role="tab" data-chart="${k}" aria-selected="${S.chart === k}"${tip ? ` title="${escapeHtml(tip)}"` : ''}><div class="lbl">${MEAS[k].lbl}</div><div class="line"><span class="val">${val}</span>${side || ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</button>`;
    const perDay = (v) => (days ? v / days : 0);
    let html = tab('rev', pesoK(cur.rev), calmChip(cur.rev, prev.rev, prevTitle), days ? pesoShort(perDay(cur.rev)) + ' daily avg' : '')
      + tab('gp', pesoK(cur.gp), calmChip(cur.gp, prev.gp, prevTitle), days ? pesoShort(perDay(cur.gp)) + ' daily avg' : '')
      + tab('n', cur.n.toLocaleString(), calmChip(cur.n, prev.n, prevTitle),
        days ? count(perDay(cur.n)) + ' daily avg' : '', cur.n ? pesoShort(cur.rev / cur.n) + ' average receipt' : '')
      + tab('mg', cur.rev ? pct1(mgOf(cur)) : '—', calmChip(mgOf(cur), mgOf(prev), prevTitle), '');
    // no Best stat (owner 2026-09-26): the best day (month) is tagged on the calendar instead
    if (target == null) return html;                                   // year view: four stats
    const pc = target ? Math.round(cur.rev / target * 100) : 0;
    return html + `<button class="stat act" data-act="cal-target" title="${target ? `${pesoShort(cur.rev)} of ${pesoShort(target)} · click to change` : 'Set a monthly target'}">`
      + `<div class="lbl">Target</div><div class="line">${target
        ? `<span class="val">${pesoK(cur.rev)}</span><b class="pct">${pc}%</b></div><div class="sub">of ${pesoK(target)}</div>`
        : '<span class="val">—</span><span class="set">Set</span></div>'}</button>`;
  }

  // Top 10: items, categories, weekdays or hours. Items split the order's total by line share,
  // as agg() does, so a discount can't make the items add up to more than the receipt.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const hourSpan = (h) => { const ap = x => (x % 24 < 12 ? 'AM' : 'PM'), hh = x => x % 12 || 12;
    return ap(h) === ap(h + 1) ? `${hh(h)} – ${hh(h + 1)} ${ap(h)}` : `${hh(h)} ${ap(h)} – ${hh(h + 1)} ${ap(h + 1)}`; };
  function tops(rows, by) {
    const g = new Map(), open = new Set();
    const put = (k, init) => g.get(k) || g.set(k, { name: k, qty: 0, rev: 0, items: new Set(), days: new Set(), ...init }).get(k);
    for (const o of rows) {
      const s = saleSign(o), its = o.items || [];
      if (!s) continue;
      open.add(isoDate(o.ts));
      if (by === 'day' || by === 'hour') {
        const d = new Date(o.ts), b = put(by === 'day' ? DAYS[(d.getDay() + 6) % 7] : hourSpan(d.getHours()));
        b.rev += o.total * s; b.days.add(isoDate(o.ts));
        continue;
      }
      if (!its.length) continue;
      const gross = its.reduce((x, i) => x + itemNet(i), 0);
      for (const i of its) {
        const b = put((by === 'cat' ? catOf : itemOf)(i), { cat: catOf(i), unit: i.unit || '' });
        b.qty += (+i.qty || 0) * s; b.items.add(itemOf(i));
        b.rev += o.total * s * (gross > 0 ? itemNet(i) / gross : 1 / its.length);
      }
    }
    // a weekday averages over the days it was open; an hour over every open day in the window
    for (const b of g.values()) b.avg = b.rev / ((by === 'day' ? b.days.size : open.size) || 1);
    return g;
  }
  const TOP_BY = [['item', 'Top items', 'Sold'], ['cat', 'Top categories', 'Range'],
    ['day', 'Busiest days', 'Avg / day'], ['hour', 'Busiest hours', 'Avg / day']];
  function calTop(T, by) {
    const [, , qtyHead] = TOP_BY.find(x => x[0] === by), cur = tops(T.rows, by), before = tops(T.prev, by);
    // weekdays rank and share by their average: a month can hold five Wednesdays and four Saturdays
    const val = (b) => (by === 'day' ? b.avg : b.rev);
    const total = [...cur.values()].reduce((x, b) => x + val(b), 0);
    const list = [...cur.values()].sort((x, y) => val(y) - val(x)).slice(0, 10), max = list.length ? val(list[0]) : 1;
    const sw = `<select aria-label="Rank by" data-cal="top">${TOP_BY.map(([k, l]) => `<option value="${k}"${by === k ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const qty = (b) => (by === 'day' || by === 'hour' ? pesoShort(b.avg) : by === 'cat' ? b.items.size + (b.items.size === 1 ? ' item' : ' items')
      : +b.qty.toFixed(2) + (b.unit && !/^pcs?$/.test(b.unit) ? ' ' + escapeHtml(b.unit) : ''));
    const vs = (b) => {
      const p = before.get(b.name)?.rev;
      if (!p) return '<td class="n cmp">New</td>';
      const r = Math.round((b.rev - p) / Math.abs(p) * 1000) / 10;
      return `<td class="n cmp ${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${r > 0 ? '+' : ''}${r.toFixed(1)}%</td>`;
    };
    return list.length ? `<div class="flush"><table${by === 'day' || by === 'hour' ? ' class="avg"' : ''}>
      <tr><th class="sw">${sw}</th><th class="n qty">${qtyHead}</th><th class="n amt">Revenue</th><th class="sh">Share</th><th class="n cmp" title="${escapeHtml(T.sub)}">Trend</th></tr>
      ${list.map(b => `<tr><td class="nm">${escapeHtml(b.name)}${by !== 'item' || b.cat === 'Uncategorized' ? '' : `<small>${escapeHtml(b.cat)}</small>`}</td>
        <td class="n qty">${qty(b)}</td><td class="n amt">${pesoShort(b.rev)}</td>
        <td class="sh"><span><i style="width:${Math.max(0, val(b) / max * 100)}%"></i></span>${total ? (val(b) / total * 100).toFixed(1) : 0}%</td>${vs(b)}</tr>`).join('')}
    </table>${by === 'item' || by === 'cat' ? `<a class="all" href="${Router.href(VIEW, '', { by: by === 'cat' ? 'category' : 'item' })}">See all ${cur.size} ${by === 'cat' ? 'categories' : 'items'} →</a>` : ''}</div>`
      : '<p class="note empty">No sales in this period yet.</p>';
  }

  // Payment methods, breakdown and staff: the panel's lists, for the whole period.
  function calMix(rows) {
    const m = calmMetrics(rows);
    const w = (title, body, side = '') => `<div class="w"><div class="band">${title}<span>${side}</span></div>${body}</div>`;
    if (!rows.some(saleSign)) {
      const none = '<p class="note empty">No sales in this period yet.</p>';
      return w('Payment methods', none) + w('Breakdown', none) + w('Staff', none);
    }
    const group = (key) => { const g = new Map(); for (const o of rows) { const s = saleSign(o); if (s) g.set(key(o), (g.get(key(o)) || 0) + o.total * s); } return [...g].sort((x, y) => y[1] - x[1]); };
    const share = (v) => (m.rev ? (v / m.rev * 100).toFixed(1) + '%' : '');
    return w('Payment methods', `<div class="rows">${group(orderPaymentLabel).map(([k, v]) => calRow(escapeHtml(k) + (k === 'Account' ? '<span class="pill warn">Unpaid</span>' : ''), pesoShort(v), share(v))).join('')}
      ${calRow('Total', pesoShort(m.rev), '', 'total')}</div>`)
      + w('Breakdown', breakdownRows(m), m.voids ? `${m.voids} voided, no revenue` : '')
      + w('Staff', `<div class="rows">${group(o => o.cashier || '—').map(([k, v]) => calRow(escapeHtml(k), pesoShort(v), share(v))).join('')}</div>`);
  }

  // the best and slowest day (month) name themselves in the cell's top right corner
  const calTag = (top, slow) => (top ? '<b class="tag">Best</b>' : slow ? '<b class="tag slow">Slowest</b>' : '');

  function calMonth(S, rowsIn, byDay, TODAY, monthTarget) {
    const a = S.month, b = monthEnd(a), d0 = new Date(a);
    const cutoff = Math.min(b, shiftDays(TODAY, 1));                    // "so far" for the month you're in
    const prevA = new Date(d0.getFullYear(), d0.getMonth() - 1, 1).getTime();
    const prevB = Math.min(monthEnd(prevA), shiftDays(prevA, Math.round((cutoff - a) / 864e5)));
    const cur = calmMetrics(rowsIn(a, b)), prev = calmMetrics(rowsIn(prevA, prevB));
    const days = [];
    for (let t = a; t < b; t = shiftDays(t, 1)) { const rows = byDay.get(isoDate(t)) || []; if (rows.length) days.push({ t, m: calmMetrics(rows) }); }
    const open = days.filter(d => d.m.n || d.m.retN), done = open.filter(d => d.t < TODAY);   // today isn't over yet
    const { of, fmt: mf, sm, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) > of(x.m) ? d : x), null) : null;
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    const prevTitle = `vs ${fmt(prevA, { month: 'short', day: 'numeric' })} – ${fmt(prevB - 1, { day: 'numeric' })}`;
    const strip = calStrip(S, cur, prev, prevTitle, open.length, monthTarget);

    // ponytail: a flat share of the monthly target per calendar day. The live target spreads what's
    // left over the days left; that's a "today" promise, and a past day needs a fixed bar to be judged by.
    // revenue keeps the daily target; the others, the month's own per-day average (margin: the month's margin)
    const bar = isRev && monthTarget ? monthTarget / daysIn(a) : S.chart === 'mg' ? mgOf(cur) : (open.length ? of(cur) / open.length : 0);
    const lead = (d0.getDay() + 6) % 7;                                // Monday-first, a hardware shop's week
    let anyLoss = false, anySlow = false;
    const barName = S.chart === 'mg' ? `the month's ${mf(bar)} margin`
      : `the ${mf(bar)}${S.chart === 'n' ? ' receipts' : ''} daily ${isRev && monthTarget ? 'target' : 'average'}`;
    // a missed day stays white; a day over the bar goes green, deeper the further over, up to the month's best day
    const hi = Math.max(0, ...open.map(d => of(d.m)));
    const heat = (v) => `color-mix(in srgb, var(--b-heat) ${Math.round(12 + 43 * (hi > bar ? (v - bar) / (hi - bar) : 1))}%, white)`;
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('') + '<div class="dow wk">Week</div>';
    for (let w = shiftDays(a, -lead); w < b; w = shiftDays(w, 7)) {
      for (let i = 0; i < 7; i++) {
        const t = shiftDays(w, i);
        if (t < a || t >= b) { html += '<div class="cell pad"></div>'; continue; }
        const dn = new Date(t).getDate(), rows = byDay.get(isoDate(t)) || [];
        const sel = S.sel && S.sel.kind === 'day' && S.sel.at === t ? ' sel' : '', today = t === TODAY ? ' today' : '';
        if (t > TODAY) { html += `<div class="cell future${today}"><span class="d">${dn}</span></div>`; continue; }
        if (!rows.length) { html += `<div class="cell shut${today}"><span class="d">${dn}</span><span class="m">No sales</span></div>`; continue; }
        const m = calmMetrics(rows), v = of(m);
        let cls = '', style = '', tip = '';
        if (m.rev < 0) { cls = ' loss'; tip = 'More returns than sales'; anyLoss = true; }
        else if (bar && v >= bar) { cls = ' heat'; style = ` style="--heat:${heat(v)}"`; tip = `${mf(v - bar)} over ${barName}`; }
        else if (bar) tip = `${mf(bar - v)} short of ${barName}`;
        const slow = worst && worst.t === t && cls !== ' heat';
        if (slow) { cls = ' loss'; tip = 'Slowest day of the month' + (tip ? ' · ' + tip : ''); anySlow = true; }
        const top = best && best.t === t;
        if (top) { cls += ' best'; tip = 'Best day of the month' + (tip ? ' · ' + tip : ''); }
        html += `<button class="cell${cls}${today}${sel}" data-day="${isoDate(t)}"${style}${tip ? ` title="${tip}"` : ''}><span class="d">${dn}</span>${calTag(top, slow)}`
          + `<span class="v"><span class="full">${mf(v)}</span><span class="sm">${sm(v)}</span></span><span class="m">${sub(m)}${m.retN ? ` · ${m.retN} ret` : ''}</span></button>`;
      }
      const ws = Math.max(w, a), we = Math.min(shiftDays(w, 7), b, shiftDays(TODAY, 1));
      if (ws >= we) { html += '<div class="cell week wk pad"></div>'; continue; }
      const wr = rowsIn(ws, we), wm = calmMetrics(wr), wdays = new Set(wr.map(o => isoDate(o.ts))).size;
      const sel = S.sel && S.sel.kind === 'week' && S.sel.at === ws ? ' sel' : '';
      html += `<button class="cell week wk${sel}" data-week="${isoDate(ws)}"><span class="d">${fmt(ws, { month: 'short', day: 'numeric' })} – ${fmt(we - 1, { day: 'numeric' })}</span>`
        + `<span class="v">${mf(of(wm))}</span><span class="m">${wdays} days · ${sub(wm)}</span></button>`;
    }
    const grid = `<div class="cal">${html}</div><div class="legend"><span><i></i>Below ${barName}</span><span>Above<i class="scale"></i></span>`
      + (anySlow || anyLoss ? `<span><i class="r"></i>${[anySlow && 'Slowest day', anyLoss && 'Lost money'].filter(Boolean).join(' · ')}</span>` : '') + '</div>';
    return { strip, cols: 5, grid, period: fmt(a, { month: 'long', year: 'numeric' }), last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: rowsIn(prevA, prevB), sub: fmt(a, { month: 'long' }) + (b > TODAY ? ' so far' : '') + ' · ' + prevTitle } };
  }

  function calYear(S, rowsIn, byDay, TODAY, monthTarget) {
    const y = new Date(S.month).getFullYear(), a = new Date(y, 0, 1).getTime(), b = new Date(y + 1, 0, 1).getTime();
    const cutoff = Math.min(b, shiftDays(TODAY, 1)), prevA = new Date(y - 1, 0, 1).getTime();
    const prevB = shiftDays(prevA, Math.round((cutoff - a) / 864e5));
    const cur = calmMetrics(rowsIn(a, b)), prev = calmMetrics(rowsIn(prevA, prevB));
    const months = Array.from({ length: 12 }, (_, i) => { const t = new Date(y, i, 1).getTime(); return { t, m: calmMetrics(rowsIn(t, monthEnd(t))) }; });
    const open = months.filter(x => x.m.n), done = open.filter(x => monthEnd(x.t) <= TODAY);   // nor is this month
    const { of, fmt: mf, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) > of(x.m) ? d : x), null) : null;
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    let days = 0;
    for (let t = a; t < b; t = shiftDays(t, 1)) if (byDay.has(isoDate(t))) days++;
    const strip = calStrip(S, cur, prev, `vs the same days of ${y - 1}`, days);
    const avg = S.chart === 'mg' ? mgOf(cur) : open.length ? of(cur) / open.length : 0;
    const goal = (isRev && monthTarget) || avg;
    const goalName = isRev && monthTarget ? 'Hit the monthly target' : S.chart === 'mg' ? 'Above the year’s margin' : 'Above the monthly average';
    const grid = '<div class="months">' + months.map(({ t, m }) => {
      const name = fmt(t, { month: 'long' });
      if (t > TODAY) return `<div class="cell future"><span class="d">${name}</span></div>`;
      if (!m.n) return `<div class="cell shut"><span class="d">${name}</span><span class="m">No sales</span></div>`;
      const hit = of(m) >= goal, slow = !hit && worst && worst.t === t, top = best && best.t === t;
      const tip = [top && 'Best month of the year', hit && `${goalName} (${mf(goal)})`, slow && 'Slowest month of the year'].filter(Boolean).join(' · ');
      return `<button class="cell${hit ? ' good' : slow ? ' loss' : ''}${top ? ' best' : ''}" data-month="${isoDate(t).slice(0, 7)}"${tip ? ` title="${tip}"` : ''}><span class="d">${name}</span>${calTag(top, slow)}`
        + `<span class="v">${mf(of(m))}</span><span class="m">${isRev ? `${m.n.toLocaleString()} receipts · ${pct1(mgOf(m))} margin` : sub(m)}</span></button>`;
    }).join('') + `</div><div class="legend"><span><i class="g"></i>${goalName} (${mf(goal)})</span>${worst && of(worst.m) < goal ? '<span><i class="r"></i>Slowest month</span>' : ''}<span>Click a month to open its calendar</span></div>`;
    return { strip, cols: 4, grid, period: String(y), last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: rowsIn(prevA, prevB), sub: y + (b > TODAY ? ' so far' : '') + ` · vs the same days of ${y - 1}` } };
  }

  // The side panel: everything the old Summary charted, for one day or one week.
  let calMore = '';   // the receipts past the first 12, for "Show all"
  function calPanel(S, rowsIn, TODAY) {
    const { kind, at } = S.sel, isDay = kind === 'day';
    const end = isDay ? shiftDays(at, 1) : weekEnd(at);
    const rows = rowsIn(at, end).sort((x, y) => y.ts - x.ts), m = calmMetrics(rows);
    const span = Math.round((end - at) / 864e5), pm = calmMetrics(rowsIn(shiftDays(at, -7), shiftDays(at, -7 + span)));
    const title = isDay ? fmt(at, { weekday: 'long', month: 'long', day: 'numeric' })
      : `${fmt(at, { month: 'short', day: 'numeric' })} – ${fmt(end - 1, { month: 'short', day: 'numeric' })}`;
    const share = (v) => (m.rev ? (v / m.rev * 100).toFixed(1) + '%' : '');
    const sec = (lbl, body, side = '') => `<div class="p-sec"><div class="lbl">${lbl}<span>${side}</span></div>${body}</div>`;

    let html = `<div class="p-top"><h2>${title}</h2>
      <button class="icon-btn" data-step="-1" aria-label="Previous ${kind}">‹</button>
      <button class="icon-btn" data-step="1" aria-label="Next ${kind}" ${end > TODAY ? 'disabled' : ''}>›</button>
      <button class="icon-btn" data-close aria-label="Close">✕</button></div>`;
    html += `<div class="p-head"><span class="val">${pesoShort(m.rev)}</span>${calmChip(m.rev, pm.rev, isDay ? 'vs the same day last week' : 'vs the week before')}</div>`
      + `<p class="p-sub">${m.n} receipts · ${pesoShort(m.gp)} gross profit · ${m.n ? pesoShort(m.rev / m.n) : '₱0'} average</p>`;
    if (!rows.length) return html + '<p class="p-sub" style="margin-top:20px">No sales.</p>';

    // hours: the ones that sold, one either side
    const hr = Array(24).fill(0);
    for (const o of rows) if (saleSign(o)) hr[new Date(o.ts).getHours()] += o.total * saleSign(o);
    const sold = hr.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    const h0 = sold.length ? Math.max(0, sold[0] - 1) : 7, h1 = sold.length ? Math.min(23, sold[sold.length - 1] + 1) : 18;
    const top = Math.max(...hr.slice(h0, h1 + 1), 1), peak = hr.indexOf(Math.max(...hr));
    let bars = '', xs = '';
    for (let i = h0; i <= h1; i++) {
      bars += `<div title="${hourShort(i)} · ${pesoShort(hr[i])}"><i class="${i === peak ? 'top' : ''}" style="height:${Math.max(0, hr[i]) / top * 100}%"></i></div>`;
      xs += `<span>${(i - h0) % 3 ? '' : hourShort(i)}</span>`;
    }
    html += sec('By hour', `<div class="hours">${bars}</div><div class="hours-x">${xs}</div>`, `busiest ${hourShort(peak)}`);
    html += sec('Breakdown', breakdownRows(m), m.voids ? `${m.voids} voided, no revenue` : '');

    const group = (key) => { const g = new Map(); for (const o of rows) { const s = saleSign(o); if (s) for (const [k, v] of key(o, s)) g.set(k, (g.get(k) || 0) + v); } return [...g].sort((x, y) => y[1] - x[1]); };
    html += sec('Payment methods', `<div class="rows">${group((o, s) => [[orderPaymentLabel(o), o.total * s]]).map(([k, v]) => calRow(escapeHtml(k) + (k === 'Account' ? '<span class="pill warn">Not collected</span>' : ''), pesoShort(v), share(v))).join('')}</div>`);
    const its = group((o, s) => (o.items || []).map(i => [i.name, itemNet(i) * s]));
    html += sec('Top items', `<div class="rows">${its.slice(0, 5).map(([k, v]) => calRow(escapeHtml(k), pesoShort(v), share(v))).join('')}</div>`, `${its.length} items sold`);
    html += sec('Staff', `<div class="rows">${group((o, s) => [[o.cashier || '—', o.total * s]]).map(([k, v]) => calRow(escapeHtml(k), pesoShort(v), share(v))).join('')}</div>`);

    // voids and refunds stay in the list, struck through, never filtered out
    const rc = (o) => {
      const s = saleSign(o), st = o.status || 'completed';
      const pill = st === 'completed' ? '' : `<span class="pill ${st === 'return' ? 'down' : ''}">${st[0].toUpperCase() + st.slice(1)}</span>`;
      const when = isDay ? new Date(o.ts).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : fmt(o.ts, { month: 'short', day: 'numeric' });
      return `<div class="row ${s ? '' : 'dim'}"><span class="t">${when}</span><span class="nm">${escapeHtml(o.number || o.id || '')} · ${escapeHtml(orderPaymentLabel(o))}${pill}</span><span class="amt">${pesoShort(s < 0 ? -o.total : +o.total)}</span></div>`;
    };
    const list = rows.filter(o => o.status !== 'saved');
    calMore = list.map(rc).join('');
    return html + sec('Receipts', `<div class="rows" data-rc>${list.slice(0, 12).map(rc).join('')}</div>${list.length > 12 ? `<button class="more" data-act="cal-more">Show all ${list.length}</button>` : ''}`, `${list.length} total`);
  }

  function calendar(params) {
    const TODAY = dayStart(new Date());
    const byDay = new Map();
    for (const o of state.orders) { const k = isoDate(o.ts); (byDay.get(k) || byDay.set(k, []).get(k)).push(o); }
    const rowsIn = (a, b) => { const out = []; for (let t = a; t < b; t = shiftDays(t, 1)) out.push(...(byDay.get(isoDate(t)) || [])); return out; };
    const S = calState(params, lastSale());
    const monthTarget = +(state.settings.targets && state.settings.targets.month) || 0;
    const P = (S.view === 'year' ? calYear : calMonth)(S, rowsIn, byDay, TODAY, monthTarget);
    const seg = (k, l) => `<button data-view="${k}" aria-pressed="${S.view === k}">${l}</button>`;
    return `<div class="shell${S.sel ? ' open' : ''}">
      <div class="c-main">
        <div class="bar">
          <h1>Sales</h1>
          <div class="seg">${seg('month', 'Month')}${seg('year', 'Year')}</div>
          <div class="nav">
            <button class="icon-btn" data-shift="-1" aria-label="Previous">‹</button>
            <b>${P.period}</b>
            <button class="icon-btn" data-shift="1" aria-label="Next"${P.last ? ' disabled' : ''}>›</button>
          </div>
        </div>
        <section class="card">
          <div class="strip n${P.cols}" role="tablist" aria-label="Calendar shows" style="--cols:${P.cols}">${P.strip}</div>
          <div class="panel">${P.grid}</div>
        </section>
        <section class="top"><div>${calTop(P.T, S.top)}</div></section>
        <section class="trio">${calMix(P.T.rows)}</section>
      </div>
      <dialog class="tdlg"><form method="dialog" data-cal="target">
        <h2>Monthly target</h2>
        <label>Revenue to aim for each month<input name="month" type="number" min="0" step="1000" inputmode="numeric" autocomplete="off" value="${monthTarget || ''}"></label>
        <p>Days that make a share of it turn green. Leave blank to judge days by the month's average.</p>
        <div class="acts"><button type="button" data-act="cal-cancel">Cancel</button><button type="submit" value="save">Save</button></div>
      </form></dialog>
      <aside class="c-aside"${S.sel ? '' : ' hidden'}>${S.sel ? calPanel(S, rowsIn, TODAY) : ''}</aside>
    </div>`;
  }

  // Clicks on the calendar page. Each one moves the URL; the router re-renders.
  function calClick(hit) {
    const p = Router.route().params, S = calState(p, lastSale());   // the same month calendar() drew
    const set = (patch) => Router.setParams({ view: '', month: isoDate(S.month).slice(0, 7), day: '', week: '', ...patch });
    if (hit.dataset.chart) return Router.setParams({ chart: hit.dataset.chart === 'rev' ? '' : hit.dataset.chart });
    if (hit.dataset.view) return set({ view: hit.dataset.view === 'year' ? 'year' : '' });
    if (hit.dataset.shift) {
      const d = new Date(S.month), n = +hit.dataset.shift;
      const m = S.view === 'year' ? new Date(d.getFullYear() + n, d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() + n, 1);
      return set({ view: p.view, month: isoDate(m).slice(0, 7) });
    }
    if (hit.dataset.month) return set({ month: hit.dataset.month });
    if (hit.dataset.day || hit.dataset.week) {
      const kind = hit.dataset.day ? 'day' : 'week', at = hit.dataset[kind];
      return set({ [kind]: p[kind] === at ? '' : at });   // click again to close
    }
    if (hit.hasAttribute('data-close')) return set({});
    if (hit.dataset.step) {
      const n = +hit.dataset.step, { kind, at } = S.sel;
      // a week cell is its Monday, or the 1st when the week straddles a month: step to the cell holding the next/previous day
      const day = kind === 'day' ? shiftDays(at, n) : n > 0 ? weekEnd(at) : shiftDays(at, -1), d = new Date(day);
      const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      return set({ month: isoDate(first).slice(0, 7), [kind]: isoDate(kind === 'day' ? day : Math.max(first, shiftDays(day, -((d.getDay() + 6) % 7)))) });
    }
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
    const p = Router.route().params;
    // Transactions moved to its own page (2026-09-26): old ?by=tx links land there, filters kept.
    if (p.by === 'tx') { const { by, ...rest } = p; Router.go('transactions', '', rest, { replace: true }); return; }
    refreshSharedState();
    const v = readView();
    const el = root();
    // Summary is the calm calendar page: its own window and its own look (bo-calm.css).
    el.classList.toggle('calm-sales', v.tab === 'summary');
    // Bought together counts every receipt ever, not the range: no filters, range or CSV.
    if (v.tab === 'basket') {
      el.innerHTML = `<header class="view-head"><div class="view-title-wrap"><h1>Bought together</h1></div></header>
        <div class="dash-stack">${HWPOS_INSIGHTS.card('basket')}</div>`;
      return;
    }
    if (v.tab === 'summary') { el.innerHTML = calendar(p); return; }
    const { rows, payOpts, staffOpts, fulOpts } = windowRows(v);
    const a = agg(rows);
    // The render rebuilds the menu, so a tick would snap it shut: reopen whichever was open.
    const openMs = el.querySelector('.ms-pick[open]');
    const reopen = openMs && openMs.dataset.ms;
    el.innerHTML = head(v, payOpts, staffOpts, fulOpts) + `<div class="dash-stack">${cutTab(a, v)}</div>`;
    if (reopen) { const d = el.querySelector(`.ms-pick[data-ms="${reopen}"]`); if (d) d.open = true; }
  };

  // The maths, hung off the one global so scripts/sales-check.mjs can run it without
  // a DOM. Not a second global, and nothing in the page reads it.
  window.renderSales.agg = agg;

  // ---------- CSV: whatever cut is on screen ----------
  function exportCsv() {
    const v = readView();
    const { rows } = windowRows(v);
    const a = agg(rows);
    const cols = COLUMNS[v.tab];
    const data = sortRows(CUT_ROWS[v.tab](a), v.sort.key, v.sort.dir);
    const name = `sales-by-${v.tab}-${state.range}-${isoDate(state.anchor)}.csv`;
    downloadCsv(name, [cols.map(c => c.label)].concat(data.map(r => cols.map(c => c.csv(r)))));
    showToast(`Exported ${data.length} row${data.length === 1 ? '' : 's'}`);
  }

  // ---------- Events: one delegated listener per type ----------
  document.addEventListener('click', (e) => {
    const el = root();
    if (!el || !e.target.closest) return;
    // Close the range menu on any click outside it, including one landing off this view.
    const menu = el.querySelector('[data-rp-menu]');
    if (menu && !menu.hidden && !e.target.closest('[data-rp]')) menu.hidden = true;
    el.querySelectorAll('.ms-pick[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    if (!el.contains(e.target)) return;
    if (el.classList.contains('calm-sales')) {
      if (e.target.matches('.shell.open')) { Router.setParams({ day: '', week: '' }); return; }   // the pop-up's backdrop
      const c = e.target.closest('.seg [data-view], [data-shift], [data-chart], button.cell, .c-aside [data-close], .c-aside [data-step]');
      if (c) { calClick(c); return; }
    }
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'rp-toggle') { if (menu) menu.hidden = !menu.hidden; return; }
    if (act === 'range') { Router.setParams({ range: hit.dataset.range === 'today' ? '' : hit.dataset.range, page: '' }, { replace: false }); return; }
    if (act === 'export') { exportCsv(); return; }
    if (act === 'ms-clear') { Router.setParams({ [hit.dataset.key]: '', page: '' }); return; }
    if (act === 'cal-target') { el.querySelector('dialog.tdlg').showModal(); return; }
    if (act === 'cal-cancel') { hit.closest('dialog').close(); return; }
    if (act === 'cal-more') { el.querySelector('[data-rc]').innerHTML = calMore; hit.remove(); return; }
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
    if (e.target.dataset.cal === 'top') { Router.setParams({ top: e.target.value === 'item' ? '' : e.target.value }); return; }
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

  // The calendar's target: the month figure only, the same setting the dashboard's Set target writes.
  document.addEventListener('submit', (e) => {
    if (e.target.dataset.cal !== 'target') return;
    e.preventDefault();
    const v = Math.max(0, Math.round(+e.target.elements.month.value || 0));
    state.settings.targets = { ...(state.settings.targets || {}), month: v };
    saveSettings();
    e.target.closest('dialog').close();
    renderCurrentView();
  });

  // Esc closes the day/week pop-up, unless a dialog is taking the key.
  document.addEventListener('keydown', (e) => {
    const el = root();
    if (e.key !== 'Escape' || !el || el.hidden || !el.classList.contains('calm-sales') || document.querySelector('dialog[open]')) return;
    const p = Router.route().params;
    if (p.day || p.week) Router.setParams({ day: '', week: '' });
  });
})();
