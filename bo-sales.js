/* Back office — Sales. Renders the whole #view section; see CONTRACT.
   Pure read: this page never writes storage. Every number comes from the shell's
   helpers (rangeWindows / orderPaymentLabel / costOf / itemNet / productFor), so a
   figure here and the same figure on the dashboard cannot drift apart. */
(function () {
  const VIEW = 'sales';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  // Patterns, By employee and By payment are cards on the Summary now (owner, 2026-09-22).
  // Transactions is its own page (bo-transactions.js); renderSales forwards old ?by=tx links.
  // Items folds By item, By category and Bought together into one tab (owner, 2026-09-26): the Summary's
  // month, told in more depth. By staff folded into the Summary's Staff card the same day.
  const TABS = [['summary', 'Summary'], ['items', 'Items']];
  const OLD_TABS = ['item', 'category', 'basket'];   // old ?by= links land on Items; ?by=staff on the Summary
  // Summary | Items is a switch inside the page (owner, 2026-09-27), Products' Catalog | Stock (.pd-switch), not
  // sidebar links: the same month seen two ways, so no HWPOS_SUBNAV tree. It sits in the bar before ‹ period ›,
  // so the title and the picker hold still. The period (?month= ?view= ?vs=) and Items' table state ride along;
  // the day/week pop-up and the page don't.
  const tabSwitch = (tab) => {
    const { day, week, page, all, ...keep } = Router.route().params;
    return `<div class="seg pd-switch">${TABS.map(([k, label]) =>
      `<a class="seg-btn${k === tab ? ' active' : ''}" href="${escapeHtml(Router.href(VIEW, '', { ...keep, by: k === 'summary' ? '' : k }))}">${label}</a>`).join('')}</div>`;
  };

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
  const qtyText = (n) => (Math.abs(n % 1) > 0.001 ? Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : int(n));
  const money = (n) => Math.round((Number(n) || 0) * 100) / 100; // CSV: plain number, no ₱

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

      const st = bucket(staff, o.cashier || '—', () => blank({ key: o.cashier || '—', name: o.cashier || '—', last: 0 }));
      st.revenue += rev; st.net += net; st.txns += 1; st.voids += voided; st.refunds += back;
      if (sign) st.sales += 1;
      if (sign > 0) st.last = Math.max(st.last, o.ts);

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
          brand: (p && p.brand) || '',
          cat: folderName(p ? p.folder : ''),
          folder: (p && p.folder) || '',   // the category's key: By category's "Top in" list
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

  // ---------- Columns: what the CSV exports ----------
  const cName = { key: 'name', label: 'Product', cell: r => escapeHtml(r.name), csv: r => r.name };
  const cQty = { key: 'qty', label: 'Qty sold', num: 1, cell: r => qtyText(r.qty), csv: r => money(r.qty) };
  const cRev = { key: 'revenue', label: 'Revenue', num: 1, cell: r => `<strong>${peso(r.revenue)}</strong>`, csv: r => money(r.revenue) };
  const cCost = { key: 'cost', label: 'Cost', num: 1, cell: r => peso(r.cost), csv: r => money(r.cost) };
  const cProfit = { key: 'profit', label: 'Gross profit', num: 1, cell: r => peso(r.profit), csv: r => money(r.profit) };
  const cMargin = { key: 'margin', label: 'Margin %', num: 1, cell: r => (r.net ? pct(r.margin) : '—'), csv: r => (r.net ? money(r.margin * 100) : '') };
  const cShare = { key: 'share', label: 'Share', num: 1, cell: r => pct(r.share), csv: r => money(r.share * 100) };

  // Items' CSV: every item in the period (the category picked, if one is), in the table's order.
  const COLUMNS = [
    cName,
    { key: 'sku', label: 'SKU', cell: r => `<span class="mono">${escapeHtml(r.sku)}</span>`, csv: r => r.sku },
    { key: 'cat', label: 'Category', cell: r => escapeHtml(r.cat), csv: r => r.cat },
    cQty, cRev, cCost, cProfit, cMargin, cShare,
  ];

  // ---------- What the URL says ----------
  function readView() {
    const p = Router.route().params;
    const tab = TABS.some(t => t[0] === p.by) ? p.by : 'summary';
    // ?x= is Items' Show all: that card grown in place. ?all=basket is Bought together's own page.
    const x = tab === 'items' && ['item', 'category', 'basket'].includes(p.x) ? p.x : '';
    const all = tab === 'items' && p.all === 'basket' ? 'basket' : '';
    return {
      tab, all, x,
      it: p.it || '',   // the item row that's open; none = all closed
      ct: p.ct || '',   // the category the table is cut to; none = every item
      // Revenue desc is the answer to "what makes us money"; everything else is a click away.
      sort: { key: p.sort || 'revenue', dir: p.dir === 'asc' ? 'asc' : 'desc' },
    };
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
      // a year has no "same month last year": both mean the year before
      vs: p.vs === 'prev' || p.vs === 'year' ? (view === 'year' ? 'prev' : p.vs) : '',
      top: ['cat', 'day', 'hour'].includes(p.top) ? p.top : 'item',
      chart: ['gp', 'n', 'mg'].includes(p.chart) ? p.chart : 'rev',
      sel: view === 'year' ? null : p.day ? { kind: 'day', at: fromIso(p.day) } : p.week ? { kind: 'week', at: fromIso(p.week) } : null,
    };
  }

  // The window, and what it's compared with (?vs=). Off unless asked (owner 2026-09-26): '' none,
  // 'prev' the month (year) before, 'year' the same month last year. A finished period against the
  // whole one before it; the one you're in against the same days so far, never half against whole.
  function calCompare(S, TODAY) {
    const d0 = new Date(S.month), y = d0.getFullYear(), isYear = S.view === 'year';
    const a = isYear ? new Date(y, 0, 1).getTime() : S.month, b = isYear ? new Date(y + 1, 0, 1).getTime() : monthEnd(a);
    if (!S.vs) return { a, b, title: '', label: '' };
    const prevA = isYear ? new Date(y - 1, 0, 1).getTime() : new Date(y, d0.getMonth() - (S.vs === 'year' ? 12 : 1), 1).getTime();
    const prevEnd = isYear ? a : monthEnd(prevA), cutoff = Math.min(b, shiftDays(TODAY, 1));
    const prevB = cutoff >= b ? prevEnd : Math.min(prevEnd, shiftDays(prevA, Math.round((cutoff - a) / 864e5)));
    const whole = prevB === prevEnd, py = new Date(prevA).getFullYear();
    const label = isYear ? `vs ${py}` : `vs ${fmt(prevA, { month: 'long' })}${S.vs === 'year' ? ` ${py}` : ''}`;
    const title = whole ? label : isYear ? `vs the same days of ${py}`
      : `vs ${fmt(prevA, { month: 'short', day: 'numeric' })} – ${fmt(prevB - 1, { day: 'numeric' })}${S.vs === 'year' ? `, ${py}` : ''}`;
    return { a, b, prevA, prevB, title, label };
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
    const [, , qtyHead] = TOP_BY.find(x => x[0] === by), cur = tops(T.rows, by), before = T.prev && T.prev.some(saleSign) && tops(T.prev, by);   // nothing sold back then: no Trend column of "New"
    // weekdays rank and share by their average: a month can hold five Wednesdays and four Saturdays
    const val = (b) => (by === 'day' ? b.avg : b.rev);
    const total = [...cur.values()].reduce((x, b) => x + val(b), 0);
    const list = [...cur.values()].sort((x, y) => val(y) - val(x)).slice(0, 10), max = list.length ? val(list[0]) : 1;
    const sw = pickMenu('calTop', 'top', TOP_BY, by, 'Rank by');
    const qty = (b) => (by === 'day' || by === 'hour' ? pesoShort(b.avg) : by === 'cat' ? b.items.size + (b.items.size === 1 ? ' item' : ' items')
      : +b.qty.toFixed(2) + (b.unit && !/^pcs?$/.test(b.unit) ? ' ' + escapeHtml(b.unit) : ''));
    const vs = (b) => {
      if (!before) return '';
      const p = before.get(b.name)?.rev;
      if (!p) return '<td class="n cmp">New</td>';
      const r = Math.round((b.rev - p) / Math.abs(p) * 1000) / 10;
      return `<td class="n cmp ${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${r > 0 ? '+' : ''}${r.toFixed(1)}%</td>`;
    };
    return list.length ? `<div class="flush"><table${by === 'day' || by === 'hour' ? ' class="avg"' : ''}>
      <tr><th class="sw">${sw}</th><th class="n qty">${qtyHead}</th><th class="n amt">Revenue</th><th class="sh">Share</th>${before ? `<th class="n cmp" title="${escapeHtml(T.sub)}">Trend</th>` : ''}</tr>
      ${list.map(b => `<tr><td class="nm">${escapeHtml(b.name)}${by !== 'item' || b.cat === 'Uncategorized' ? '' : `<small>${escapeHtml(b.cat)}</small>`}</td>
        <td class="n qty">${qty(b)}</td><td class="n amt">${pesoShort(b.rev)}</td>
        <td class="sh"><span><i style="width:${Math.max(0, val(b) / max * 100)}%"></i></span>${total ? (val(b) / total * 100).toFixed(1) : 0}%</td>${vs(b)}</tr>`).join('')}
    </table>${by === 'item' || by === 'cat' ? `<a class="all" href="${Router.href(VIEW, '', { by: 'items', month: T.month, view: T.view })}">See all in Items →</a>` : ''}</div>`
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
    // What By staff used to add (owner 2026-09-26): each cashier's voids and refunds, quiet after the name.
    const oops = new Map();
    for (const o of rows) {
      const k = o.cashier || '—', x = oops.get(k) || oops.set(k, { v: 0, r: 0 }).get(k);
      if (o.status === 'voided') x.v++; else if (isReversal(o.status)) x.r++;
    }
    const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
    const note = (k) => { const x = oops.get(k), t = x ? [x.v && plural(x.v, 'void'), x.r && plural(x.r, 'refund')].filter(Boolean) : [];
      return t.length ? `<small>${t.join(' · ')}</small>` : ''; };
    return w('Payment methods', `<div class="rows">${group(orderPaymentLabel).map(([k, v]) => calRow(escapeHtml(k) + (k === 'Account' ? '<span class="pill warn">Unpaid</span>' : ''), pesoShort(v), share(v))).join('')}
      ${calRow('Total', pesoShort(m.rev), '', 'total')}</div>`)
      + w('Breakdown', breakdownRows(m), m.voids ? `${m.voids} voided, no revenue` : '')
      + w('Staff', `<div class="rows">${group(o => o.cashier || '—').map(([k, v]) => calRow(escapeHtml(k) + note(k), pesoShort(v), share(v))).join('')}</div>`);
  }

  // the best and slowest day (month) name themselves in the cell's top right corner
  const calTag = (top, slow) => (top ? '<b class="tag">Best</b>' : slow ? '<b class="tag slow">Slowest</b>' : '');

  function calMonth(S, rowsIn, byDay, TODAY, monthTarget) {
    const C = calCompare(S, TODAY), { a, b } = C, d0 = new Date(a);
    const prevRows = S.vs ? rowsIn(C.prevA, C.prevB) : null;
    const cur = calmMetrics(rowsIn(a, b)), prev = calmMetrics(prevRows || []);
    const days = [];
    for (let t = a; t < b; t = shiftDays(t, 1)) { const rows = byDay.get(isoDate(t)) || []; if (rows.length) days.push({ t, m: calmMetrics(rows) }); }
    const open = days.filter(d => d.m.n || d.m.retN), done = open.filter(d => d.t < TODAY);   // today isn't over yet
    const { of, fmt: mf, sm, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) > of(x.m) ? d : x), null) : null;
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    const strip = calStrip(S, cur, prev, C.title, open.length, monthTarget);

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
    return { strip, cols: 5, grid, period: fmt(a, { month: 'long', year: 'numeric' }), vsLabel: C.label, last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: prevRows, month: isoDate(a).slice(0, 7), sub:fmt(a, { month: 'long' }) + (b > TODAY ? ' so far' : '') + ' · ' + C.title } };
  }

  function calYear(S, rowsIn, byDay, TODAY, monthTarget) {
    const C = calCompare(S, TODAY), { a, b } = C, y = new Date(a).getFullYear();
    const prevRows = S.vs ? rowsIn(C.prevA, C.prevB) : null;
    const cur = calmMetrics(rowsIn(a, b)), prev = calmMetrics(prevRows || []);
    const months = Array.from({ length: 12 }, (_, i) => { const t = new Date(y, i, 1).getTime(); return { t, m: calmMetrics(rowsIn(t, monthEnd(t))) }; });
    const open = months.filter(x => x.m.n), done = open.filter(x => monthEnd(x.t) <= TODAY);   // nor is this month
    const { of, fmt: mf, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) > of(x.m) ? d : x), null) : null;
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    let days = 0;
    for (let t = a; t < b; t = shiftDays(t, 1)) if (byDay.has(isoDate(t))) days++;
    const strip = calStrip(S, cur, prev, C.title, days);
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
    return { strip, cols: 4, grid, period: String(y), vsLabel: C.label, last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: prevRows, month: y + '-01', view: 'year', sub: y +(b > TODAY ? ' so far' : '') + ' · ' + C.title } };
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
    html += `<div class="p-head"><span class="val">${pesoShort(m.rev)}</span>${!S.vs ? '' : calmChip(m.rev, pm.rev, isDay ? 'vs the same day last week' : 'vs the week before')}</div>`
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
    calMore = list.slice(0, 50).map(rc).join('');   // 50 at most; Transactions pages the rest
    return html + sec('Receipts', `<div class="rows" data-rc>${list.slice(0, 12).map(rc).join('')}</div>${list.length > 12 ? `<button class="more" data-act="cal-more">Show ${Math.min(list.length, 50)}</button>` : ''}`, `${list.length} total`);
  }

  // One control (owner 2026-09-26): ‹ [period ▾] ›, its menu the presets and, on the Summary, Compare to, like
  // the Dashboard's. Items shares it: the same month, told in more depth. P: { period, vsLabel, last }.
  function periodNav(S, P, compare) {
    const now = new Date(), cy = now.getFullYear(), cm = now.getMonth(), ym = (y, m) => isoDate(new Date(y, m, 1)).slice(0, 7);
    const on = (view, m) => S.view === view && (view === 'year' ? new Date(S.month).getFullYear() === +m.slice(0, 4) : isoDate(S.month).startsWith(m));
    const opt = (attr, v, lbl, checked) => `<button role="menuitemradio" ${attr}="${v}" aria-checked="${checked}">${lbl}</button>`;
    const menu = [['This month', 'month', ym(cy, cm)], ['Last month', 'month', ym(cy, cm - 1)], ['This year', 'year', cy + '-01'], ['Last year', 'year', cy - 1 + '-01']]
      .map(([l, view, m]) => opt('data-go', `${view}|${m}`, l, on(view, m))).join('')
      + (!compare ? '' : '<hr><h3>Compare to</h3>' + (S.view === 'year' ? [['prev', 'Previous year']] : [['prev', 'Previous month'], ['year', 'Same month last year']])
        .concat([['', 'No comparison']]).map(([k, l]) => opt('data-vs', k, l, S.vs === k)).join(''));
    return `<div class="nav">
        <button class="icon-btn" data-shift="-1" aria-label="Previous ${S.view}">‹</button>
        <button class="pick" popovertarget="calRange">${P.period}${P.vsLabel ? `<span class="vs">${P.vsLabel}</span>` : ''}</button>
        <button class="icon-btn" data-shift="1" aria-label="Next ${S.view}"${P.last ? ' disabled' : ''}>›</button>
      </div>
      <div class="menu" id="calRange" popover role="menu">${menu}</div>`;
  }

  function calendar(params) {
    const TODAY = dayStart(new Date());
    const byDay = new Map();
    for (const o of state.orders) { const k = isoDate(o.ts); (byDay.get(k) || byDay.set(k, []).get(k)).push(o); }
    const rowsIn = (a, b) => { const out = []; for (let t = a; t < b; t = shiftDays(t, 1)) out.push(...(byDay.get(isoDate(t)) || [])); return out; };
    const S = calState(params, lastSale());
    const monthTarget = +(state.settings.targets && state.settings.targets.month) || 0;
    const P = (S.view === 'year' ? calYear : calMonth)(S, rowsIn, byDay, TODAY, monthTarget);
    return `<div class="shell${S.sel ? ' open' : ''}">
      <div class="c-main">
        <div class="bar">
          <h1>Sales</h1>${tabSwitch('summary')}
          ${periodNav(S, P, true)}
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
    const set = (patch) => Router.setParams({ view: '', month: isoDate(S.month).slice(0, 7), day: '', week: '', page: '', ...patch });   // page: Items' table
    if (hit.dataset.chart) return Router.setParams({ chart: hit.dataset.chart === 'rev' ? '' : hit.dataset.chart });
    if (hit.dataset.go) { const [view, m] = hit.dataset.go.split('|'); return set({ view: view === 'year' ? 'year' : '', month: m }); }
    if ('vs' in hit.dataset) return set({ view: p.view, vs: hit.dataset.vs });
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

  // ---------- Items: the Summary's month, told in more depth (owner 2026-09-26, round 4) ----------
  // The same ‹ [period ▾] › as the Summary, always against the period before -- the month so far against the
  // same days of the last. Top to bottom: the categories as one bar, what rose and what fell, every item in one
  // sortable table (Top 10, Show all behind it), what sells together. No filters: the Summary's cards cut those.
  const METRIC = {
    revenue: ['Revenue', r => r.revenue, r => pesoShort(r.revenue)],
    profit: ['Gross profit', r => r.profit, r => pesoShort(r.profit)],
    cost: ['Cost', r => r.cost, r => pesoShort(r.cost)],
    qty: ['Qty sold', r => r.qty, r => qtyText(r.qty)],
  };
  const TOP_N = 10, PAIRS_N = 5, MOVERS_N = 5, CATS_N = 5;

  // The head of a ranking by one metric. Share is of the whole cut's total (null when that is
  // nothing to share out), the bar is against the leader so the top row always fills.
  function rankTop(rows, key, n = TOP_N) {
    const of = METRIC[key][1];
    const list = rows.slice().sort((x, y) => of(y) - of(x)).slice(0, n);
    const total = rows.reduce((s, r) => s + of(r), 0), max = list.length ? Math.max(0, of(list[0])) : 0;
    return list.map(r => ({ r, share: total > 0 ? of(r) / total : null, bar: max > 0 ? Math.max(0, of(r)) / max : 0 }));
  }

  // Links inside Items keep the period and sort; the page belongs to the table being left.
  const itemsHref = (patch) => { const { page, all, ...keep } = Router.route().params; return Router.href(VIEW, '', { ...keep, ...patch }); };
  const backToItems = () => itemsHref({});
  // The Dashboard's dropdown (bo-calm.css .pick / .menu): a button, its popover menu, a ✓ on the one in
  // use. A choice sets ?<param>=, the default clears it. Summary's Top 10 uses it.
  const PICK_DEF = { top: 'item' };
  const pickMenu = (id, param, opts, on, aria) => {
    const cur = (opts.find(o => o[0] === on) || opts[0])[1];
    return `<button class="pick" popovertarget="${id}" aria-label="${aria}: ${cur}">${cur}</button><div class="menu" id="${id}" popover role="menu">`
      + opts.map(([k, l]) => `<button role="menuitemradio" data-set="${param}" data-v="${k}" aria-checked="${k === on}">${l}</button>`).join('') + '</div>';
  };
  const barCell = (f) => `<td class="bar"><span><i style="width:${(f * 100).toFixed(1)}%"></i></span></td>`;
  // A card: the title, no subtitle and no switch (owner 2026-09-26: the title says what it counts).
  const cutCard = (title, body, foot = '') =>
    `<section class="cut"><div class="cut-head"><span class="lbl">${title}</span></div>${body}${foot}</section>`;
  // Show all grows the card in place (?x=), Show less shrinks it; sort and page go with the table.
  const more = (n, x, limit, open) => (open ? `<a class="all" href="${itemsHref({ x: '' })}">Show less ↑</a>`
    : n > limit ? `<a class="all" href="${itemsHref({ x })}">Show all ${n} ↓</a>` : '');
  const none = (msg) => `<p class="empty">${msg}</p>`;
  // A row's change on the period before: plain coloured text, as the Summary's Trend column (a pill is
  // for a headline number). Blank when the period before sold nothing at all.
  const trendTd = (cur, prev, any) => {
    if (!any || (!prev && !cur)) return '<td class="n tr"></td>';
    if (!prev) return '<td class="n tr">New</td>';
    const r = Math.round((cur - prev) / Math.abs(prev) * 1000) / 10;
    return `<td class="n tr ${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${r > 0 ? '+' : ''}${r.toFixed(1)}%</td>`;
  };
  // ?ct= cuts the table (and the CSV) to one category. Uncategorized is folder '', which the URL can't hold: '-'.
  const catKey = (k) => k || '-';
  const inCat = (items, ct) => (ct ? items.filter(r => catKey(r.folder) === ct) : items);
  // A ?ct= the period has no row for (it sold nothing this month; the month moved on) cuts nothing: an empty
  // table with no lit row to click off would be a dead end.
  const liveCat = (cats, ct) => (cats.some(r => r.revenue > 0 && catKey(r.key) === ct) ? ct : '');

  // The period (the Summary's ?month= / ?view=year), the one before it, and both periods' receipts.
  function itemsWindow(p) {
    const TODAY = dayStart(new Date()), S = { ...calState(p, lastSale()), vs: 'prev' }, C = calCompare(S, TODAY);
    const rows = [], prev = [];
    for (const o of state.orders) {
      if (o.ts >= C.a && o.ts < C.b) rows.push(o);
      else if (o.ts >= C.prevA && o.ts < C.prevB) prev.push(o);
    }
    const yr = S.view === 'year', name = (t) => (yr ? String(new Date(t).getFullYear()) : fmt(t, { month: 'long' }));
    return { S, C, rows, prev, yr, end: Math.min(C.b, shiftDays(TODAY, 1)), now: name(C.a), was: name(C.prevA) };
  }

  // An item's figure per day (a year: per month), this period and the one before, index for index.
  // agg() per bucket, so the split of a discounted receipt is the table's own.
  // ponytail: day buckets are 24h steps, fine in PH (no DST); use shiftDays() indexes if a DST store ever syncs in.
  function series(W, key, of) {
    const { a, prevA } = W.C, yr = W.yr;
    const n = W.end <= a ? 0 : yr ? new Date(W.end - 1).getMonth() + 1 : Math.round((W.end - a) / 864e5);
    const at = (t0, i) => (yr ? new Date(new Date(t0).getFullYear(), i, 1).getTime() : shiftDays(t0, i));
    const cut = (list, t0) => {
      const g = Array.from({ length: n }, () => []);
      for (const o of list) { const i = yr ? new Date(o.ts).getMonth() : Math.floor((o.ts - t0) / 864e5); if (g[i]) g[i].push(o); }
      return g.map(os => { const x = os.length && agg(os).items.find(r => r.key === key); return x ? of(x) : 0; });
    };
    const cur = cut(W.rows, a), was = cut(W.prev, prevA), pm = new Date(prevA).getMonth();
    const long = yr ? { month: 'long', year: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' };
    return cur.map((v, i) => {
      const t = at(a, i), p = at(prevA, i), had = yr || new Date(p).getMonth() === pm;   // a 31st has no 31st of September to compare
      return { cur: v, prev: had ? was[i] : null, x: yr ? fmt(t, { month: 'short' }) : String(i + 1), title: fmt(t, long),
        was: had ? fmt(p, yr ? long : { weekday: 'short', month: 'short', day: 'numeric' }) : '' };
    });
  }

  // The Dashboard's bars (dashPlot() in backoffice.js), one metric, the period before a dashed line over them.
  function plot(bs, key, any) {
    const [lbl, , ] = METRIC[key], qty = key === 'qty';
    const fv = qty ? qtyText : pesoShort, axis = qty ? (v => +v.toFixed(1)) : pesoK;
    const peak = Math.max(qty ? 5 : 100, ...bs.map(b => Math.max(b.cur, any ? b.prev || 0 : 0)));
    const step = niceStep(peak / 3), top = Math.ceil(peak * 1.1 / step) * step, every = Math.ceil(bs.length / 12);
    const h = (v) => Math.max(0, v) / top * 100;
    let grid = '';
    for (let v = 0; v <= top + 1e-6; v += step) grid += `<div class="gl${v ? '' : ' zero'}" style="bottom:${h(v)}%"><span>${axis(v)}</span></div>`;
    const cols = bs.map((b, i) => `<div class="b"><i style="height:${h(b.cur)}%"><span class="tip"><b>${escapeHtml(b.title)}</b>`
      + `<span class="on">${lbl}<em>${fv(b.cur)}</em></span>${any && b.was ? `<span>${escapeHtml(b.was)}<em>${fv(b.prev)}</em></span>` : ''}</span></i>`
      + `<span class="x">${(bs.length - 1 - i) % every ? '' : b.x}</span></div>`).join('');
    const pts = bs.map((b, i) => (b.prev == null ? '' : `${i + 0.5},${(100 - h(b.prev)).toFixed(2)}`)).filter(Boolean).join(' ');
    const line = any ? `<svg class="was" viewBox="0 0 ${bs.length} 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>` : '';
    return `<div class="plot"><div class="grid">${grid}</div><div class="cols" style="grid-template-columns:repeat(${bs.length},minmax(0,1fr))">${cols}</div>${line}</div>`;
  }

  // Every item (owner 2026-09-26, round 2: "the most efficient way"): one table, every figure side by side. A
  // header sorts (?sort=): by Profit or Margin is what makes money, by Trend the movers. A row opens its chart
  // under it (?it=, again to close). Top 10, then Show all (?x=item) pages the rest, 50 at a time.
  const COLS = [['name', 'nm', 'Item'], ['qty', 'qt', 'Qty sold'], ['revenue', 'rv', 'Revenue'], ['profit', 'pf', 'Profit'], ['margin', 'mg', 'Margin'], ['trend', 'tr', 'Trend']];
  const BARRED = ['qty', 'revenue', 'profit'];   // the bar rides the sorted column when it's an amount, else Revenue
  const inBar = (f, txt) => `<span class="bv"><span class="ib"><i style="width:${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%"></i></span>${txt}</span>`;
  // Trend is revenue on the period before; a row that sold nothing then is New and sorts first. The CSV sorts by it too.
  const withTrend = (rows, prevRows, any) => { const before = new Map(prevRows.map(r => [r.key, r.revenue]));
    return rows.map(r => { const was = before.get(r.key) || 0;
      return { ...r, was, trend: !any ? 0 : was ? (r.revenue - was) / Math.abs(was) : r.revenue > 0 ? Infinity : 0 }; }); };
  function rankCard(rows, prevRows, selKey, any, nameOf, detail, v, p) {
    if (!rows.length) return `<section class="cut">${none('No sales in this period yet.')}</section>`;
    const s = v.sort, kOf = (r) => r.key || '-';
    const all = sortRows(withTrend(rows, prevRows, any), s.key, s.dir);
    const bk = BARRED.includes(s.key) ? s.key : 'revenue', base = all.reduce((m, r) => Math.max(m, r[bk]), 0);   // against the leader
    const cell = (k, cls, txt, r) => `<td class="n ${cls}">${k === bk && base > 0 ? inBar(r[k] / base, txt) : txt}</td>`;
    const th = COLS.map(([k, c, l]) => `<th class="${k === 'name' ? '' : 'n '}${c}" tabindex="0" data-act="sort" data-key="${k}"${s.key === k ? ` aria-sort="${s.dir}ending"` : ''}>`
      + `${l}${s.key === k ? (s.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`).join('');
    const tr = (r) => {
      const on = kOf(r) === selKey;
      return `<tr tabindex="0" data-sel="it" data-key="${escapeHtml(kOf(r))}" aria-expanded="${on}"${on ? ' class="on"' : ''}>`
        + `<td class="nm" title="${escapeHtml(r.name)}">${nameOf(r)}</td>${cell('qty', 'qt', qtyText(r.qty), r)}${cell('revenue', 'rv', pesoShort(r.revenue), r)}`
        + `${cell('profit', 'pf', pesoShort(r.profit), r)}<td class="n mg">${r.net ? pct(r.margin) : '—'}</td>${trendTd(r.revenue, r.was, any)}</tr>`
        + (on ? detail(r) : '');
    };
    const open = v.x === 'item', pg = open ? paginate(all, p.page) : null;
    let shown = open ? pg.rows : all.slice(0, TOP_N);
    const sel = !open && selKey && all.find(r => kOf(r) === selKey);
    if (sel && !shown.includes(sel)) shown = [...shown, sel];   // opened from past the ten: under them
    return `<section class="cut"><table><tr>${th}</tr>${shown.map(tr).join('')}</table>${open ? pagerHtml(pg) : ''}${more(all.length, 'item', TOP_N, open)}</section>`;
  }

  // The categories as a table (owner 2026-09-26: a store can have 50 of them, a bar can't): revenue with its bar
  // against the leader, share of the period, trend. Revenue desc, fixed -- ?sort= is the items table's. The top 5,
  // Show all (?x=category) the rest. A row cuts the items table below to that category (?ct=); again undoes it.
  function catCard(cats, prevCats, ct, any, v, p) {
    const list = cats.filter(r => r.revenue > 0).sort((x, y) => y.revenue - x.revenue);
    if (!list.length) return `<section class="cut">${none('No sales in this period yet.')}</section>`;
    const before = new Map(prevCats.map(r => [r.key, r.revenue]));
    const total = list.reduce((s, r) => s + r.revenue, 0), lead = list[0].revenue;
    const tr = (r) => {
      const k = catKey(r.key), on = k === ct;
      return `<tr tabindex="0" data-sel="ct" data-key="${escapeHtml(k)}" aria-current="${on}"${on ? ' class="on"' : ''}>`
        + `<td class="nm" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td><td class="n rv">${inBar(r.revenue / lead, pesoShort(r.revenue))}</td>`
        + `<td class="n sh">${(r.revenue / total * 100).toFixed(1)}%</td>${trendTd(r.revenue, before.get(r.key) || 0, any)}</tr>`;
    };
    const open = v.x === 'category', pg = open ? paginate(list, p.page) : null;
    let shown = open ? pg.rows : list.slice(0, CATS_N);
    const sel = !open && ct && list.find(r => catKey(r.key) === ct);
    if (sel && !shown.includes(sel)) shown = [...shown, sel];   // picked from past the five: under them
    return `<section class="cut"><table><tr><th>Category</th><th class="n rv">Revenue</th><th class="n sh">Share</th><th class="n tr">Trend</th></tr>`
      + `${shown.map(tr).join('')}</table>${open ? pagerHtml(pg) : ''}${more(list.length, 'category', CATS_N, open)}</section>`;
  }

  // What moved (owner 2026-09-26): the items up most on the period before, in pesos, and the ones down most.
  // An item that sold nothing back then is New; one that sold nothing now has fallen its whole amount.
  function movers(a, pa, W, any) {
    const w = (title, body) => `<div class="w"><div class="band">${title}<span>${any ? escapeHtml(W.C.title) : ''}</span></div>${body}</div>`;
    const note = (t) => `<p class="note empty">${t}</p>`;
    if (!any) return w('Rising', note(`Nothing sold in ${W.was} to compare with.`)) + w('Falling', note(`Nothing sold in ${W.was} to compare with.`));
    const m = new Map();
    for (const r of pa.items) m.set(r.key, { name: r.name, cur: 0, was: r.revenue });
    for (const r of a.items) (m.get(r.key) || m.set(r.key, { name: r.name, cur: 0, was: 0 }).get(r.key)).cur = r.revenue;
    const d = [...m.values()].map(x => ({ ...x, d: x.cur - x.was }));
    const row = (x) => calRow(escapeHtml(x.name), (x.d > 0 ? '+' : '') + pesoShort(x.d),
      x.was > 0 ? `${x.d > 0 ? '+' : '−'}${Math.round(Math.abs(x.d / x.was) * 100)}%` : 'New', x.d > 0 ? 'up' : 'down');
    const list = (xs, empty) => (xs.length ? `<div class="rows">${xs.slice(0, MOVERS_N).map(row).join('')}</div>` : note(empty));
    return w('Rising', list(d.filter(x => x.d >= 1).sort((x, y) => y.d - x.d), 'Nothing sold more.'))
      + w('Falling', list(d.filter(x => x.d <= -1).sort((x, y) => x.d - y.d), 'Nothing sold less.'));
  }

  // Bought together counts every receipt ever, not the period: three baskets make a pair. Read as "when they buy
  // A, they also buy B" (owner 2026-09-26: make it actionable). A is the rarer of the two, so the % is the
  // direction worth acting on: how often the rarer one leaves with the other. Items only -- a category pair
  // rarely tells anyone what to shelve beside what. Most often first, the % breaks a tie.
  function basketCard(x) {
    const products = loadProducts();
    const ba = HWPOS_INSIGHTS.basketAffinity(loadList(STORAGE_ORDERS), { products, top: Infinity });
    // ponytail: the 50 most frequent; past that a pair is a handful of receipts, noise more than a lead
    const pairs = ba.products.map(r => {
      const [a, b, of] = r.countA <= r.countB ? [r.a, r.b, r.countA] : [r.b, r.a, r.countB];
      return { a, b, of, n: r.count, f: r.count / of, name: { [r.a]: r.aName, [r.b]: r.bName } };
    }).sort((r, s) => s.n - r.n || s.f - r.f).slice(0, 50);
    if (!pairs.length) return cutCard('Bought together', none('No pair bought together often enough yet.'));
    // two products can share a name (PVC Solvent Cement 200mL, two brands): the brand tells them apart
    const dup = new Map(); for (const x of products) dup.set(x.name, (dup.get(x.name) || 0) + 1);
    const brand = new Map(products.filter(x => x.brand && dup.get(x.name) > 1).map(x => [x.id, x.brand]));
    const nm = (r, id) => escapeHtml(r.name[id]) + (brand.has(id) ? `<small>${escapeHtml(brand.get(id))}</small>` : '');
    const open = x === 'basket';
    const trs = (open ? pairs : pairs.slice(0, PAIRS_N)).map(r => `<tr><td class="nm">${nm(r, r.a)}<span class="to">→</span>${nm(r, r.b)}</td>`
      + `${barCell(r.f)}<td class="n pt">${Math.round(r.f * 100)}% of the time</td><td class="n rc">${int(r.n)} of ${int(r.of)} receipts</td></tr>`).join('');
    return cutCard('Bought together', `<table>${trs}</table>`, more(pairs.length, 'basket', PAIRS_N, open));
  }

  const DOWNLOAD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 20h16"/></svg>';
  function itemsPage(p, v) {
    const W = itemsWindow(p), { S, C } = W, a = agg(W.rows), pa = agg(W.prev), any = pa.totals.sales > 0, ct = liveCat(a.cats, v.ct);
    // Two products can share a name (a Local and a Generic Hollow Block 4"): the brand tells them apart.
    const seen = new Map(); for (const r of a.items) seen.set(r.name, (seen.get(r.name) || 0) + 1);
    const item = (r) => escapeHtml(r.name) + (seen.get(r.name) > 1 && r.brand ? `<small>${escapeHtml(r.brand)}</small>` : '');
    const key = any ? `<span class="key"><i></i>${W.now}<i class="was"></i>${W.was}</span>` : '';
    // An item's detail: one line of figures, then its revenue per day against the period before (dashed).
    const chart = (r) => `<tr class="det"><td colspan="6"><div class="chart"><div class="dh"><b>${escapeHtml(r.name)}</b>`
      + `<span>${pesoShort(r.revenue)} revenue · ${pesoShort(r.profit)} profit · ${qtyText(r.qty)} sold</span>${any ? calmChip(r.revenue, r.was, C.title) : ''}${key}</div>`
      + plot(series(W, r.key, METRIC.revenue[1]), 'revenue', any) + '</div></td></tr>';
    // No "vs" of its own (Rising / Falling say it) -- only when the Summary's Compare to is on, so the picker keeps
    // its width across the switch; it names Items' own comparison, always the period before.
    const P = { period: W.yr ? W.now : fmt(C.a, { month: 'long', year: 'numeric' }), vsLabel: p.vs ? C.label : '', last: C.b > dayStart(new Date()) };
    return `<div class="shell"><div class="c-main">
        <div class="bar"><h1>Sales</h1>${tabSwitch('items')}<button class="btn" data-act="export">${DOWNLOAD_ICON}Export CSV</button>${periodNav(S, P, false)}</div>
        <div class="sales-cuts">${catCard(a.cats, pa.cats, ct, any, v, p)}${rankCard(inCat(a.items, ct), pa.items, v.it, any, item, chart, v, p)}
          <div class="duo">${movers(a, pa, W, any)}</div>${basketCard(v.x)}</div>
      </div></div>`;
  }

  window.renderSales = function () {
    const p = Router.route().params;
    // Transactions moved to its own page (2026-09-26): old ?by=tx links land there, filters kept.
    if (p.by === 'tx') { const { by, ...rest } = p; Router.go('transactions', '', rest, { replace: true }); return; }
    if (OLD_TABS.includes(p.by)) { Router.setParams({ by: 'items', sort: '', dir: '', page: '' }); return; }
    // By staff is the Summary's Staff card now (owner 2026-09-26).
    if (p.by === 'staff') { Router.setParams({ by: '', sort: '', dir: '', page: '' }); return; }
    // The old See all pages are Show all now: ?all=item / category grows that table in place.
    if (p.all === 'item' || p.all === 'category') { Router.setParams({ all: '', x: p.all }); return; }
    refreshSharedState();
    const v = readView();
    const el = root();
    // Bought together's full list counts every receipt ever, not the period: no picker or CSV.
    if (v.all === 'basket') {
      el.classList.remove('calm-sales');
      el.innerHTML = `<header class="view-head"><div class="view-title-wrap"><h1><a class="crumb" href="${backToItems()}">Items</a> › Bought together</h1></div></header>
        <div class="dash-stack">${HWPOS_INSIGHTS.card('basket')}</div>`;
      return;
    }
    // Both pages are calm (bo-calm.css): the Summary's calendar, and Items on the same month.
    el.classList.add('calm-sales');
    el.innerHTML = v.tab === 'summary' ? calendar(p) : itemsPage(p, v);
  };

  // The maths, hung off the one global so scripts/sales-check.mjs can run it without
  // a DOM. Not a second global, and nothing in the page reads it.
  window.renderSales.agg = agg;
  window.renderSales.calCompare = calCompare;
  window.renderSales.calState = calState;
  window.renderSales.rankTop = rankTop;

  // ---------- CSV: Items' table, whole -- every item in the period (the picked category's), in its sort ----------
  function exportCsv() {
    const v = readView(), W = itemsWindow(Router.route().params);
    const a = agg(W.rows), pa = agg(W.prev);
    const data = sortRows(withTrend(inCat(a.items, liveCat(a.cats, v.ct)), pa.items, pa.totals.sales > 0), v.sort.key, v.sort.dir);
    const name = `sales-by-item-${isoDate(W.C.a).slice(0, W.yr ? 4 : 7)}.csv`;
    downloadCsv(name, [COLUMNS.map(c => c.label)].concat(data.map(r => COLUMNS.map(c => c.csv(r)))));
    showToast(`Exported ${data.length} row${data.length === 1 ? '' : 's'}`);
  }

  // ---------- Events: one delegated listener per type ----------
  document.addEventListener('click', (e) => {
    const el = root();
    if (!el || !e.target.closest || !el.contains(e.target)) return;
    // A picker menu's choice (Summary's Top), an Items row to open, or a Categories row to cut the items table to:
    // the picked row again undoes either. A cut restarts the items table's pages, not the categories' own.
    const pk = e.target.closest('.menu [data-set], [data-sel]');
    if (pk) {
      const { set, v, sel, key } = pk.dataset;
      Router.setParams(set ? { [set]: v === PICK_DEF[set] ? '' : v }
        : { [sel]: readView()[sel] === key ? '' : key, ...(sel === 'ct' && readView().x === 'item' ? { page: '' } : {}) });
      if (sel === 'it') { const d = root().querySelector('tr.det'); if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      return;
    }
    if (e.target.matches('.shell.open')) { Router.setParams({ day: '', week: '' }); return; }   // the pop-up's backdrop
    const c = e.target.closest('.menu [data-go], .menu [data-vs], [data-shift], [data-chart], button.cell, .c-aside [data-close], .c-aside [data-step]');
    if (c) { calClick(c); return; }
    const hit = e.target.closest('[data-act]');
    if (!hit) return;
    const act = hit.dataset.act;
    if (act === 'export') { exportCsv(); return; }
    if (act === 'cal-target') { el.querySelector('dialog.tdlg').showModal(); return; }
    if (act === 'cal-cancel') { hit.closest('dialog').close(); return; }
    if (act === 'cal-more') { el.querySelector('[data-rc]').innerHTML = calMore; hit.remove(); return; }
    if (act === 'sort') {
      const key = hit.dataset.key, cur = readView().sort;
      // Re-sorting deals the rows again, so page 3 of the old order means nothing. Names start A-Z, figures high first.
      const dir = cur.key === key ? (cur.dir === 'desc' ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc';
      Router.setParams({ sort: key, dir, ...(readView().x === 'item' ? { page: '' } : {}) });   // ?page= may be the categories'
    }
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

  // A menu hangs under its button.
  // `toggle` does not bubble, so capture it.
  document.addEventListener('toggle', (e) => {
    const m = e.target;
    if (e.newState !== 'open' || !m.matches || !m.matches('.calm-sales .menu')) return;
    const r = root().querySelector(`[popovertarget="${m.id}"]`).getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    m.style.left = Math.max(16, Math.min(r.left, innerWidth - m.offsetWidth - 16)) + 'px';
  }, true);

  // Esc closes the day/week pop-up, unless a dialog is taking the key.
  document.addEventListener('keydown', (e) => {
    // Items: Enter opens a row / sorts a header as a click does (neither has key activation of its own); the
    // re-render replaces them, so focus goes back to the same row or header.
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.sales-cuts :is(tr[data-sel], th[data-act])')) {
      const t = e.target, sel = t.dataset.sel ? `tr[data-sel="${t.dataset.sel}"]` : 'th[data-act]';
      t.click();
      root().querySelector(`.sales-cuts ${sel}[data-key="${CSS.escape(t.dataset.key)}"]`)?.focus();
      return;
    }
    const el = root();
    if (e.key !== 'Escape' || !el || el.hidden || !el.classList.contains('calm-sales') || document.querySelector('dialog[open]')) return;
    const p = Router.route().params;
    if (p.day || p.week) Router.setParams({ day: '', week: '' });
  });
})();
