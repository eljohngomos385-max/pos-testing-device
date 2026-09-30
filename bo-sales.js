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
  // sidebar links: the same month seen two ways, so no HWPOS_SUBNAV tree. It leads the bar, with no title beside
  // it (owner 2026-09-28), before ‹ period ›, so the picker holds still. The period (?month= ?view= ?vs=) and Items' table state ride along;
  // the day/week pop-up and the page don't.
  const tabSwitch = (tab) => {
    const { day, week, page, all, q, ...keep } = Router.route().params;
    return `<div class="seg pd-switch" aria-label="Sales view">${TABS.map(([k, label]) =>
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
    // ?all= is a Show all page of Items; each card's view (?cats= ?list= ?moved= ?pairs=) falls back to its default.
    const all = tab === 'items' && ALL_PAGES.includes(p.all) ? p.all : '';
    const view = (k) => (VIEWS[k].some(o => o[0] === p[k]) ? p[k] : PICK_DEF[k]);
    return {
      tab, all,
      ct: p.ct || '',   // the category the items are cut to; none = every item
      cmp: p.vs === 'prev' || p.vs === 'year',   // the Summary's Compare to (?vs=), shared
      cats: view('cats'), list: view('list'), moved: view('moved'), pairs: view('pairs'),
      q: p.q || '', page: p.page,
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
          ${tabSwitch('summary')}
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

  // ---------- Items: the Summary's month in charts (sales-items-lab-3.html, owner 2026-09-30) ----------
  // A strip of item facts, then the categories, the top 10 items, what moved and what sells together. Each card
  // picks its view from a dropdown on its band (?cats= ?list= ?moved= ?pairs=): the app's .pick menu, never a
  // native select (owner 2026-09-30). The comparison is the Summary's Compare to (?vs=) in the period menu, shared.
  // Off, the page is plain facts: no Trend, no chips, no Rank, no What moved -- nothing stands in for a comparison.
  // Show all, and the strip's counts, open their own page: ?all=categories|items|new|unsold|pairs.
  const METRIC = {
    revenue: ['Revenue', r => r.revenue, r => pesoShort(r.revenue)],
    profit: ['Gross profit', r => r.profit, r => pesoShort(r.profit)],
    cost: ['Cost', r => r.cost, r => pesoShort(r.cost)],
    qty: ['Qty sold', r => r.qty, r => qtyText(r.qty)],
  };
  const TOP_N = 10;

  // The head of a ranking by one metric. Share is of the whole cut's total (null when that is
  // nothing to share out), the bar is against the leader so the top row always fills.
  function rankTop(rows, key, n = TOP_N) {
    const of = METRIC[key][1];
    const list = rows.slice().sort((x, y) => of(y) - of(x)).slice(0, n);
    const total = rows.reduce((s, r) => s + of(r), 0), max = list.length ? Math.max(0, of(list[0])) : 0;
    return list.map(r => ({ r, share: total > 0 ? of(r) / total : null, bar: max > 0 ? Math.max(0, of(r)) / max : 0 }));
  }

  // Links inside Items keep the period, the sort and the views; the page, the search and the Show all page stay behind.
  const itemsHref = (patch) => { const { page, all, q, ...keep } = Router.route().params; return Router.href(VIEW, '', { ...keep, ...patch }); };
  const backToItems = () => itemsHref({});
  // The Dashboard's dropdown (bo-calm.css .pick / .menu): a button, its popover menu, a ✓ on the one in
  // use. A choice sets ?<param>=, the default clears it. Summary's Top 10 and every Items card use it.
  const PICK_DEF = { top: 'item', cats: 'donut', list: 'bars', moved: 'slope', pairs: 'net' };
  const pickMenu = (id, param, opts, on, aria) => {
    const cur = (opts.find(o => o[0] === on) || opts[0])[1];
    return `<button class="pick" popovertarget="${id}" aria-label="${aria}: ${cur}">${cur}</button><div class="menu" id="${id}" popover role="menu">`
      + opts.map(([k, l]) => `<button role="menuitemradio" data-set="${param}" data-v="${k}" aria-checked="${k === on}">${l}</button>`).join('') + '</div>';
  };
  const VIEWS = { cats: [['donut', 'Donut'], ['map', 'Map'], ['bars', 'Bars'], ['rank', 'Rank']], list: [['bars', 'Bars'], ['table', 'Table']],
    moved: [['slope', 'Slope'], ['slope2', 'Split'], ['lists', 'Lists']], pairs: [['net', 'Network'], ['ring', 'Ring'], ['table', 'Table']] };
  const ALL_PAGES = ['categories', 'items', 'new', 'unsold', 'pairs'];
  // ?ct= cuts the items to one category. Uncategorized is folder '', which the URL can't hold: '-'.
  const catKey = (k) => k || '-';
  const inCat = (items, ct) => (ct ? items.filter(r => catKey(r.folder) === ct) : items);
  // A ?ct= the period has no row for (it sold nothing this month; the month moved on) cuts nothing: an empty
  // list with no lit row to click off would be a dead end.
  const liveCat = (cats, ct) => (cats.some(r => r.revenue > 0 && catKey(r.key) === ct) ? ct : '');

  // The period (the Summary's ?month= / ?view=year), the one before it, and both periods' receipts.
  function itemsWindow(p) {
    const TODAY = dayStart(new Date()), S = calState(p, lastSale()), C = calCompare(S, TODAY);
    const rows = [], prev = [];
    for (const o of state.orders) {
      if (o.ts >= C.a && o.ts < C.b) rows.push(o);
      else if (o.ts >= C.prevA && o.ts < C.prevB) prev.push(o);
    }
    // Same month last year names both with their year: "September 2025" against "September 2026"
    const yr = S.view === 'year', name = (t) => (yr ? String(new Date(t).getFullYear()) : fmt(t, S.vs === 'year' ? { month: 'long', year: 'numeric' } : { month: 'long' }));
    return { S, C, rows, prev, yr, end: Math.min(C.b, shiftDays(TODAY, 1)), now: name(C.a), was: S.vs ? name(C.prevA) : '' };
  }

  // Trend is revenue on the period before; a row that sold nothing then is New and sorts first. The CSV sorts by it.
  const withTrend = (rows, prevRows, any) => { const before = new Map(prevRows.map(r => [r.key, r.revenue]));
    return rows.map(r => { const was = before.get(r.key) || 0;
      return { ...r, was, trend: !any ? 0 : was ? (r.revenue - was) / Math.abs(was) : r.revenue > 0 ? Infinity : 0 }; }); };

  // One render's data (D) and view (V), held here so the lab's card functions port as they were.
  // ponytail: one Items page renders at a time; pass them in if a second view ever shares this file.
  let D = null, V = null;
  const pc = (f, d = 1) => (f * 100).toFixed(d) + '%';
  const chg = (cur, was) => (was > 0 ? (cur - was) / was : cur > 0 ? Infinity : 0);
  const cmpNum = (p, q) => (typeof p === 'string' ? p.localeCompare(q) : (p > q) - (p < q));   // Infinity-safe
  const trendTxt = (cur, was) => { const c = chg(cur, was);
    return c === Infinity ? '<span class="new">New</span>' : !cur && !was ? '—' : Math.round(Math.abs(c) * 100) === 0 ? '<span class="new">0%</span>'
      : `<span class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '+' : '−'}${Math.round(Math.abs(c) * 100)}%</span>`; };
  const chip = (c, pts) => { const v = pts ? c : Math.round(c * 100), k = Math.abs(v) < (pts ? .05 : .5) ? 'flat' : v > 0 ? 'up' : 'down';
    return `<span class="chip ${k}">${k === 'up' ? '+' : k === 'down' ? '−' : ''}${pts ? Math.abs(v).toFixed(1) + ' pts' : Math.abs(v) + '%'}</span>`; };
  // A hover tip's HTML, escaped once more to ride in a data-tip attribute.
  const tip = (title, rows) => escapeHtml(`<b>${escapeHtml(title)}</b>` + rows.filter(Boolean).map(([l, v]) => `<div>${escapeHtml(l)}<em>${v}</em></div>`).join(''));
  const vsRow = (x) => (V.cmp ? ['vs ' + D.was, x.prev ? `${chg(x.rev, x.prev) >= 0 ? '+' : '−'}${Math.round(Math.abs(chg(x.rev, x.prev)) * 100)}%` : 'New'] : null);
  const ord = (n) => n + (n % 100 - n % 10 === 10 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const allLink = (n, to) => `<a class="link" href="${escapeHtml(itemsHref({ all: to }))}">Show all ${n} →</a>`;
  const toCats = 'data-act="go" data-to="categories"';

  // Every item in the catalogue and every item sold, this period against the one before; the categories that sold;
  // the best day; and the pairs bought together (every receipt ever, not the period: three baskets make a pair).
  function itemsData(W) {
    const a = agg(W.rows), pa = agg(W.prev), prods = new Map(state.products.map(p => [p.id, p]));
    const was = new Map(pa.items.map(r => [r.key, r.revenue])), cwas = new Map(pa.cats.map(r => [catKey(r.key), r.revenue]));
    const items = a.items.map(r => ({ key: r.key, name: r.name, brand: r.brand, cat: r.cat, ck: catKey(r.folder), rev: r.revenue, prev: was.get(r.key) || 0,
      profit: r.profit, margin: r.margin, qty: r.qty, p: prods.get(r.key) }));
    const seen = new Set(items.map(x => x.key));
    for (const p of state.products) if (!p.archived && !seen.has(p.id)) items.push({ key: p.id, name: p.name, brand: p.brand || '', cat: folderName(p.folder),
      ck: catKey(p.folder), rev: 0, prev: was.get(p.id) || 0, profit: 0, margin: 0, qty: 0, p });
    // two products can share a name (a Local and a Generic Hollow Block 4"): the brand tells them apart
    const dup = new Map(); for (const x of items) dup.set(x.name, (dup.get(x.name) || 0) + 1);
    for (const x of items) if (dup.get(x.name) > 1 && x.brand) x.name += ' · ' + x.brand;
    const cats = a.cats.filter(r => r.revenue > 0).sort((x, y) => y.revenue - x.revenue).map(r => { const key = catKey(r.key);
      return { key, name: r.name, rev: r.revenue, prev: cwas.get(key) || 0, profit: r.profit, margin: r.margin, n: items.filter(x => x.ck === key && x.rev > 0).length }; });
    const days = new Map(); for (const o of W.rows) { const k = isoDate(o.ts); days.set(k, (days.get(k) || 0) + o.total * saleSign(o)); }
    const [bk, bv] = [...days].reduce((m, d) => (d[1] > m[1] ? d : m), ['', 0]), bt = bk && fromIso(bk);
    const best = bk ? [W.yr ? fmt(bt, { month: 'short', day: 'numeric' }) : `${fmt(bt, { weekday: 'short' })} ${new Date(bt).getDate()}`, bv] : null;
    const label = new Map(items.map(x => [x.key, x.name])), NM = {}, RC = {};
    const pairs = HWPOS_INSIGHTS.basketAffinity(loadList(STORAGE_ORDERS), { products: state.products, top: Infinity }).products.map(r => {
      NM[r.a] = label.get(r.a) || r.aName; NM[r.b] = label.get(r.b) || r.bName; RC[r.a] = r.countA; RC[r.b] = r.countB;
      // A is the rarer of the two, so the % is how often the rarer one leaves with the other
      const [x, y, of] = r.countA <= r.countB ? [r.a, r.b, r.countA] : [r.b, r.a, r.countB];
      return { a: x, b: y, n: r.count, of, f: r.count / of };
    }).sort((p, q) => q.n - p.n || q.f - p.f).slice(0, 50);   // ponytail: past 50 a pair is a handful of receipts, noise more than a lead
    // The charts draw the top 20. Items joined by pairs fall into groups, roughly the jobs people shop for: biggest first,
    // in each the item with the most pair receipts leads.
    const top = pairs.slice(0, 20), par = {}, f = (x) => (par[x] === x ? x : (par[x] = f(par[x])));
    for (const p of top) { par[p.a] ??= p.a; par[p.b] ??= p.b; par[f(p.a)] = f(p.b); }
    const g = new Map(); for (const x in par) { const r = f(x); (g.get(r) || g.set(r, []).get(r)).push(x); }
    const w = (x) => top.reduce((s, p) => s + (p.a === x || p.b === x ? p.n : 0), 0);
    const groups = [...g.values()].map(xs => xs.sort((p, q) => w(q) - w(p))).sort((p, q) => q.length - p.length || w(q[0]) - w(p[0]));
    return { items, cats, best, pairs, top, groups, nodes: groups.flat(), NM, RC, maxN: Math.max(1, ...top.map(p => p.n)),
      totals: a.totals, ptotals: pa.totals, prevData: pa.totals.sales > 0, now: W.now, was: W.was, unit: W.yr ? 'year' : 'month' };
  }

  // ---- the strip: each count a link to the list behind it
  function strip() {
    const it = D.items, sold = it.filter(x => x.rev > 0), wasSold = it.filter(x => x.prev > 0);
    const rev = sold.reduce((s, x) => s + x.rev, 0), prevRev = wasSold.reduce((s, x) => s + x.prev, 0);
    const top10 = (xs, f, tot) => (tot > 0 ? [...xs].sort((p, q) => f(q) - f(p)).slice(0, 10).reduce((s, x) => s + f(x), 0) / tot : 0);
    const t10 = top10(sold, x => x.rev, rev), t10p = top10(wasSold, x => x.prev, prevRev), mg = D.totals.margin, mgp = D.ptotals.margin;
    const fresh = sold.filter(x => !x.prev).length, dead = it.length - sold.length;
    const cell = (l, v, extra = '', title = '', to = '') => { const inner = `<div class="l">${l}</div><div class="v">${v}${extra}</div>`;
      return to ? `<a href="${escapeHtml(itemsHref({ all: to }))}" title="${title}">${inner}</a>` : `<div title="${title}">${inner}</div>`; };
    // Without the period before there is nothing to be new against, so that tile shows the best day instead.
    return `<section class="card strip">
      ${cell('Items sold', `${sold.length}<small>of ${it.length}</small>`, V.cmp && wasSold.length ? chip(chg(sold.length, wasSold.length)) : '', 'Different items with at least one sale', 'items')}
      ${cell('Top 10 share', pc(t10, 0), V.cmp ? chip((t10 - t10p) * 100, true) : '', 'How much of revenue your 10 best items bring in')}
      ${cell('Margin', pc(mg), V.cmp ? chip((mg - mgp) * 100, true) : '')}
      ${V.cmp ? cell('New sellers', fresh, '', `Sold this ${D.unit}, nothing in ${D.was}`, 'new')
        : cell('Best day', D.best ? `${D.best[0]}<small>${pesoK(D.best[1])}</small>` : '—', '', `The day with the most sales this ${D.unit}`)}
      ${cell('Didn\'t sell', dead, '', `In the catalogue, no sale this ${D.unit}`, 'unsold')}
    </section>`;
  }

  // ---- categories
  const catTotal = () => D.cats.reduce((s, c) => s + c.rev, 0);
  const catTip = (c) => tip(c.name, [['Revenue', pesoShort(c.rev)], ['Share', pc(c.rev / catTotal())], ['Profit', pesoShort(c.profit)], vsRow(c), ['Items sold', c.n]]);
  const catName = (k) => (D.cats.find(c => c.key === k) || {}).name || k;
  const cutBtn = () => (V.ct ? `<button class="cut" data-act="uncut">${escapeHtml(catName(V.ct))} ✕</button>` : '');
  const ctAttr = (c) => `tabindex="0" data-ct="${escapeHtml(c.key)}"`;

  function catTable(full) {
    const list = D.cats, tot = catTotal(), lead = list[0].rev, shown = full ? list : list.slice(0, 5);
    return `<section class="card"><table class="ct"><thead><tr><th>Category</th><th class="n">Revenue</th><th class="n">Share</th><th class="n">Profit</th>${V.cmp ? '<th class="n">Trend</th>' : ''}</tr></thead><tbody>
      ${shown.map(c => `<tr ${ctAttr(c)}${c.key === V.ct ? ' class="on"' : ''} data-tip="${catTip(c)}"><td>${escapeHtml(c.name)}</td><td class="n"><span class="ib"><i style="width:${c.rev / lead * 100}%"></i></span><b>${pesoShort(c.rev)}</b></td>`
        + `<td class="n">${pc(c.rev / tot)}</td><td class="n">${pesoShort(c.profit)}</td>${V.cmp ? `<td class="n">${trendTxt(c.rev, c.prev)}</td>` : ''}</tr>`).join('')}
      </tbody></table>${full ? '' : `<div class="foot">${allLink(list.length, 'categories')}</div>`}</section>`;
  }

  // Donut: five slices and Other, whatever the store -- 7 categories or 60 look the same.
  function catDonut() {
    const list = D.cats, tot = catTotal(), top = list.slice(0, 5), rest = list.slice(5);
    const other = rest.length ? { key: '', name: `Other · ${rest.length} categories`, rev: rest.reduce((s, c) => s + c.rev, 0), prev: rest.reduce((s, c) => s + c.prev, 0), other: true } : null;
    const parts = [...top, ...(other ? [other] : [])], col = (i, p) => (p.other ? 'var(--s-other)' : `var(--s${i + 1})`);
    const R = 86, r0 = 58, cx = 100, cy = 100; let a = -Math.PI / 2;
    const arc = (a0, a1) => { const L = a1 - a0 > Math.PI ? 1 : 0, pt = (rr, t) => `${(cx + rr * Math.cos(t)).toFixed(2)},${(cy + rr * Math.sin(t)).toFixed(2)}`;
      return `M${pt(R, a0)}A${R},${R} 0 ${L} 1 ${pt(R, a1)}L${pt(r0, a1)}A${r0},${r0} 0 ${L} 0 ${pt(r0, a0)}Z`; };
    const paths = parts.map((p, i) => { const a1 = a + p.rev / tot * Math.PI * 2, d = arc(a, Math.min(a1, a + Math.PI * 2 - 1e-4)); a = a1;
      return `<path d="${d}" fill="${col(i, p)}" data-i="${i}" ${p.other ? toCats : `data-ct="${escapeHtml(p.key)}"`} data-tip="${p.other ? tip(p.name, [['Revenue', pesoShort(p.rev)], ['Share', pc(p.rev / tot)]]) : catTip(p)}"${V.ct && p.key === V.ct ? ' class="hot"' : ''}/>`; }).join('');
    const rows = parts.map((p, i) => `<tr data-i="${i}" ${p.other ? `class="other" tabindex="0" ${toCats}` : `${ctAttr(p)}${p.key === V.ct ? ' class="on"' : ''}`}><td><i class="sw" style="background:${col(i, p)}"></i></td><td>${escapeHtml(p.name)}</td>`
      + `<td class="n"><b>${pesoShort(p.rev)}</b></td><td class="n">${pc(p.rev / tot)}</td>${V.cmp ? `<td class="n">${trendTxt(p.rev, p.prev)}</td>` : ''}</tr>`).join('');
    return `<section class="card"><div class="band">Categories<span class="r">Share of revenue</span></div><div class="donut${V.ct ? ' hl' : ''}"><div class="pie"><svg width="200" height="200" viewBox="0 0 200 200">${paths}</svg>
        <div class="mid"><b>${pesoK(tot)}</b></div></div>
      <table><thead><tr><th></th><th>Category</th><th class="n">Revenue</th><th class="n">Share</th>${V.cmp ? '<th class="n">Trend</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="foot">${allLink(list.length, 'categories')}</div></section>`;
  }

  // Map: size is revenue; colour the change on the period before, or with the comparison off the margin, one hue.
  // The top 14 (7 on a phone) get a tile, the rest are one Other.
  function squarify(vals, x, y, w, h) {
    const out = [], tot = vals.reduce((s, v) => s + v, 0); let rest = vals.map((v, i) => ({ i, a: v / tot * w * h }));
    while (rest.length) {
      const side = Math.min(w, h); let row = [], best = Infinity;
      for (const it of rest) { const t = [...row, it], s = t.reduce((q, z) => q + z.a, 0), mx = Math.max(...t.map(z => z.a)), mn = Math.min(...t.map(z => z.a));
        const worst = Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn)); if (worst > best) break; best = worst; row = t; }
      const s = row.reduce((q, z) => q + z.a, 0), th = s / side; let off = 0;
      for (const z of row) { const len = z.a / th; out[z.i] = w >= h ? { x, y: y + off, w: th, h: len } : { x: x + off, y, w: len, h: th }; off += len; }
      if (w >= h) { x += th; w -= th; } else { y += th; h -= th; }
      rest = rest.slice(row.length);
    }
    return out;
  }
  function catMap() {
    // the card's width, from the view's: the page is at most 1180 wide, less its padding, the card's border and the map's margin
    const W = Math.min(1180, root().clientWidth || 1180) - 70, phone = W < 700, N = phone ? 7 : 14;
    const list = D.cats, tot = catTotal(), top = list.slice(0, N), rest = list.slice(N);
    const parts = rest.length ? [...top, { key: '', name: `Other · ${rest.length}`, rev: rest.reduce((s, c) => s + c.rev, 0), prev: rest.reduce((s, c) => s + c.prev, 0), other: true }] : top;
    const H = phone ? 520 : 440, g = 3, rects = squarify(parts.map(p => p.rev), 0, 0, W, H);
    const ms = parts.filter(p => !p.other).map(p => p.margin), m0 = Math.min(...ms), m1 = Math.max(...ms);
    const tint = (p) => { if (p.other) return '#F3F3F3'; if (!V.cmp) return `color-mix(in srgb, var(--b-data-1) ${Math.round(15 + (p.margin - m0) / (m1 - m0 || 1) * 85)}%, #F7F7F7)`;
      const c = chg(p.rev, p.prev); if (c === Infinity) return 'var(--b-data-tint)';
      const k = Math.min(1, Math.abs(c) / .4); return `color-mix(in srgb, ${c >= 0 ? '#9FD6B9' : '#F2B4A5'} ${Math.round(20 + k * 80)}%, #F3F3F3)`; };
    const tiles = parts.map((p, i) => { const q = rects[i], sz = q.w < 90 || q.h < 58 ? (q.w < 60 || q.h < 30 ? 'xs' : 'sm') : '';
      return `<button class="${sz}${p.key && p.key === V.ct ? ' on' : ''}" style="left:${q.x / W * 100}%;top:${q.y}px;width:calc(${q.w / W * 100}% - ${g}px);height:${q.h - g}px;background:${tint(p)}" ${p.other ? toCats : `data-ct="${escapeHtml(p.key)}"`} data-tip="${p.other ? tip(p.name + ' categories', [['Revenue', pesoShort(p.rev)], ['Share', pc(p.rev / tot)]]) : catTip(p)}">`
        + `<b>${escapeHtml(p.name)}</b><span>${pesoK(p.rev)} · ${pc(p.rev / tot, 0)}</span><em>${V.cmp ? trendTxt(p.rev, p.prev) : p.other ? '' : pc(p.margin, 0) + ' margin'}</em></button>`; }).join('');
    return `<section class="card"><div class="band">Categories<span class="r"><span>Size = revenue</span>${V.cmp ? `<span class="scale">Down<i></i>Up vs ${D.was}</span>` : '<span class="scale m">Thin<i></i>Better margin</span>'}</span></div>
      <div class="tmap" style="height:${H}px">${tiles}</div><div class="foot">${allLink(list.length, 'categories')}</div></section>`;
  }

  // Bars, shared by categories and items: one pesos axis, revenue the light bar and profit the deep part inside it.
  function barsCard(title, head, list, nameOf, tipOf, attrOf, foot) {
    const lead = Math.max(1, list[0]?.rev || 0), w = (v) => Math.max(0, v) / lead * 100;
    const rows = list.map((x, i) => `<div class="row${x.key && x.key === V.ct ? ' on' : ''}" ${attrOf(x)} data-tip="${tipOf(x)}"><span class="rk">${i + 1}</span><span class="nm">${nameOf(x)}</span>`
      + `<span class="trk"><i class="rev" style="width:${w(x.rev)}%"></i><i class="pf" style="width:${w(x.profit)}%"></i></span>`
      + `<span class="n v">${pesoShort(x.rev)}</span><span class="n">${pc(x.margin)}</span>${V.cmp ? `<span class="n">${trendTxt(x.rev, x.prev)}</span>` : ''}</div>`).join('');
    return `<section class="card bars${V.cmp ? '' : ' flat'}"><div class="band">${title}<span class="r"><span class="key"><i style="background:var(--b-data)"></i>Profit</span><span class="key"><i style="background:var(--b-data-1)"></i>Revenue</span></span></div>
      <div class="row hd"><span></span><span>${head}</span><span></span><span class="n">Revenue</span><span class="n">Margin</span>${V.cmp ? '<span class="n">Trend</span>' : ''}</div>${rows}
      <div class="foot">${foot}</div></section>`;
  }
  const catBars = () => barsCard('Top 10 categories', 'Category', D.cats.slice(0, 10), c => escapeHtml(c.name), catTip, ctAttr, allLink(D.cats.length, 'categories'));

  // Rank: where each of the top 10 ranked in the period before, and where it ranks now. Comparison only.
  function catRank() {
    const N = 10, cols = [[D.was, c => c.prev], [D.now, c => c.rev]];
    const rankIn = (f) => { const s = D.cats.filter(c => f(c) > 0).sort((p, q) => f(q) - f(p)); return (c) => s.indexOf(c) + 1 || Infinity; };
    const R = cols.map(([, f]) => rankIn(f)), top = D.cats.slice(0, N);
    const W = 1130, RH = 34, T = 34, H = T + (N + 1) * RH + 6, xl = 250, xr = 720, xs = [xl, xr], y = (r) => T + (Math.min(r, N + 1) - .5) * RH;
    let g = cols.map(([l], i) => `<text class="ax" x="${xs[i]}" y="16" text-anchor="middle">${escapeHtml(l)}</text><line class="axl" x1="${xs[i]}" x2="${xs[i]}" y1="${T - 6}" y2="${H - 6}"/>`).join('')
      + `<text class="muted" x="${xl - 14}" y="${y(N + 1) + 4}" text-anchor="end">11th or lower</text>`;
    for (let r = 1; r <= N; r++) g += `<text class="muted" x="${xl - 14}" y="${y(r) + 4}" text-anchor="end">${r}</text>`;
    g += top.map((c, i) => { const rs = R.map(f => f(c)), a = rs[0], b = i + 1, k = a > b ? 'up' : a < b ? 'down' : 'same';
      const d = `M${xs[0]},${y(rs[0])} C${(xl + xr) / 2},${y(rs[0])} ${(xl + xr) / 2},${y(b)} ${xr},${y(b)}`;
      const was = a === Infinity ? 'New' : a > N ? `${ord(a)} in ${D.was}` : '';
      return `<g data-ct="${escapeHtml(c.key)}" data-tip="${tip(c.name, [...cols.map(([l], j) => ['Rank, ' + l, rs[j] === Infinity ? '—' : rs[j]]), ['Revenue', pesoShort(c.rev)], vsRow(c)])}">`
        + `<path class="ln ${k}" d="${d}" fill="none"/><path class="hit" d="${d}" fill="none"/><circle class="was" cx="${xl}" cy="${y(a)}" r="4"/><circle class="${k === 'same' ? 'was' : k}" cx="${xr}" cy="${y(b)}" r="5"/>`
        + `<text x="${xr + 14}" y="${y(b) + 4}">${b}. ${escapeHtml(c.name)} <tspan class="muted">${pesoK(c.rev)}${was ? ' · ' + escapeHtml(was) : ''}</tspan></text></g>`; }).join('');
    return `<section class="card slope rank"><div class="band">Top 10 categories<span class="r">Where each ranked in ${escapeHtml(D.was)}, and where it ranks now</span></div>
      <div class="pad"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div><div class="foot">${allLink(D.cats.length, 'categories')}</div></section>`;
  }

  // ---- items
  const inCut = () => D.items.filter(x => x.rev > 0 && (!V.ct || x.ck === V.ct));
  const itemTip = (x) => tip(x.name, [['Revenue', pesoShort(x.rev)], ['Profit', pesoShort(x.profit)], ['Margin', pc(x.margin)], ['Sold', qtyText(x.qty)], vsRow(x)]);
  const hit = (x) => !V.q || (x.name + ' ' + x.cat).toLowerCase().includes(V.q.toLowerCase());
  const search = () => `<div class="filters"><input class="q-input search" type="search" placeholder="Search items" value="${escapeHtml(V.q)}" autocomplete="off" aria-label="Search items"></div>`;
  const ITEM_K = { name: x => x.name, qty: x => x.qty, revenue: x => x.rev, profit: x => x.profit, margin: x => x.margin, trend: x => chg(x.rev, x.prev) };

  // The table, sortable (?sort= ?dir=). On its own page (full) it is searched and paged, 50 rows a page.
  function itemTable(full, rows = inCut()) {
    const s = V.sort, K = ITEM_K, m = s.dir === 'asc' ? 1 : -1;
    const all = rows.filter(x => !full || hit(x)).sort((p, q) => cmpNum(K[s.key](p), K[s.key](q)) * m);
    const pg = full ? paginate(all, V.page) : null, shown = full ? pg.rows : all.slice(0, TOP_N);
    const bk = ['qty', 'revenue', 'profit'].includes(s.key) ? s.key : 'revenue', lead = all.reduce((mx, x) => Math.max(mx, K[bk](x)), 1);
    const th = (k, l, n) => `<th class="${n ? 'n' : ''}" tabindex="0" data-act="sort" data-key="${k}"${s.key === k ? ` aria-sort="${s.dir}ending"` : ''}>${l}${s.key === k ? (s.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
    const cell = (k, txt, x) => `<td class="n">${k === bk ? `<span class="ib"><i style="width:${Math.max(0, K[k](x)) / lead * 100}%"></i></span>` : ''}${k === 'revenue' ? `<b>${txt}</b>` : txt}</td>`;
    const foot = full ? '' : all.length > TOP_N ? allLink(all.length, 'items') : '';
    const body = shown.length ? shown.map(x => `<tr data-tip="${itemTip(x)}"><td class="nm">${escapeHtml(x.name)}${V.ct ? '' : `<small>${escapeHtml(x.cat)}</small>`}</td>${cell('qty', qtyText(x.qty), x)}`
      + `${cell('revenue', pesoShort(x.rev), x)}${cell('profit', pesoShort(x.profit), x)}<td class="n">${pc(x.margin)}</td>${V.cmp ? `<td class="n">${trendTxt(x.rev, x.prev)}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="6" class="empty">${V.q ? `No item matches “${escapeHtml(V.q)}”.` : 'Nothing here this period.'}</td></tr>`;
    return `<section class="card">${full ? '' : `<div class="band">Top 10 items ${cutBtn()}</div>`}<table class="it"><thead><tr>${th('name', 'Item')}${th('qty', 'Qty sold', 1)}${th('revenue', 'Revenue', 1)}${th('profit', 'Profit', 1)}${th('margin', 'Margin', 1)}${V.cmp ? th('trend', 'Trend', 1) : ''}</tr></thead><tbody>
      ${body}</tbody></table>${full ? pagerHtml(pg) : foot ? `<div class="foot">${foot}</div>` : ''}</section>`;
  }
  function itemBars() {
    const all = inCut().sort((p, q) => q.rev - p.rev);
    return barsCard(`Top 10 items ${cutBtn()}`, 'Item', all.slice(0, TOP_N), x => escapeHtml(x.name) + (V.ct ? '' : `<small> ${escapeHtml(x.cat)}</small>`), itemTip, () => '', allLink(all.length, 'items'));
  }

  // ---- what moved: this period against the one before, so it only shows while the comparison is on
  function movers() {
    const A = D.was, B = D.now, d = D.items.map(x => ({ ...x, d: x.rev - x.prev }));
    const up = d.filter(x => x.d >= 1).sort((p, q) => q.d - p.d).slice(0, 5), dn = d.filter(x => x.d <= -1).sort((p, q) => p.d - q.d).slice(0, 5);
    if (!up.length && !dn.length) return `<section class="card"><div class="band">What moved</div><p class="empty">Nothing sold more or less than in ${escapeHtml(A)}.</p></section>`;
    const c = (x) => (x.prev > 0 ? `${x.d > 0 ? '+' : '−'}${Math.round(Math.abs(x.d / x.prev) * 100)}%` : 'New');
    const k = (x) => (x.d > 0 ? 'up' : 'down'), lbl = (x) => `${x.d > 0 ? '+' : '−'}${pesoK(Math.abs(x.d))}`;
    const mtip = (x) => tip(x.name, [[B, pesoShort(x.rev)], [A, pesoShort(x.prev)], ['Change', lbl(x)]]);
    if (V.moved === 'lists') {
      const col = (t, xs, k) => `<div><h4 class="${k}">${t}</h4>${xs.map(x => `<div class="mv" data-tip="${mtip(x)}"><span class="nm">${escapeHtml(x.name)}</span><span class="n ${k}">${x.d > 0 ? '+' : '−'}${pesoShort(Math.abs(x.d))}</span><span class="cmp n ${k}">${c(x)}</span></div>`).join('') || '<p class="empty">Nothing.</p>'}</div>`;
      return `<section class="card"><div class="band">What moved<span class="r">${escapeHtml(B)} against ${escapeHtml(A)}</span></div><div class="mvs">${col('Rising', up, 'up')}${col('Falling', dn, 'down')}</div></section>`;
    }
    // Slope: the period before on the left, this one on the right, one line per item. The scale is square root, so one
    // big item doesn't flatten the rest. Split puts rising in one panel and falling in the other, on one scale.
    const top = Math.sqrt(Math.max(1, ...[...up, ...dn].flatMap(x => [x.rev, x.prev].map(v => Math.max(0, v)))));
    const slope = (ms, W, H, x1, x2, both) => {
      const T = 34, B2 = 14, Y = (v) => T + (1 - Math.sqrt(Math.max(0, v)) / top) * (H - T - B2);
      const spread = (pts) => { let last = -99; return pts.sort((p, q) => p.y - q.y).map(p => ({ ...p, ly: last = Math.max(p.y, last + 20) })); };
      const L = spread(ms.map(x => ({ x, y: Y(x.prev) }))), R = spread(ms.map(x => ({ x, y: Y(x.rev) })));
      const lines = ms.map(x => `<g data-tip="${mtip(x)}"><line class="ln ${k(x)}" x1="${x1}" y1="${Y(x.prev)}" x2="${x2}" y2="${Y(x.rev)}"/><line class="hit" x1="${x1}" y1="${Y(x.prev)}" x2="${x2}" y2="${Y(x.rev)}"/>`
        + `<circle class="was" cx="${x1}" cy="${Y(x.prev)}" r="4"/><circle class="${k(x)}" cx="${x2}" cy="${Y(x.rev)}" r="4.5"/></g>`).join('');
      const lt = L.map(p => `<text class="muted" x="${x1 - 12}" y="${p.ly + 4}" text-anchor="end">${escapeHtml(p.x.name)} · ${pesoK(p.x.prev)}</text>`).join('');
      const rt = R.map(p => `<text x="${x2 + 12}" y="${p.ly + 4}">${pesoK(p.x.rev)} <tspan class="${k(p.x)}">${c(p.x)}</tspan>${both ? ` <tspan class="muted">${escapeHtml(p.x.name)}</tspan>` : ''}</text>`).join('');
      const h = Math.max(H, ...L.map(p => p.ly + 14), ...R.map(p => p.ly + 14));
      return `<svg viewBox="0 0 ${W} ${h}"><text class="ax" x="${x1}" y="14" text-anchor="middle">${escapeHtml(A)}</text><text class="ax" x="${x2}" y="14" text-anchor="middle">${escapeHtml(B)}</text>
        <line class="axl" x1="${x1}" x2="${x1}" y1="${T - 8}" y2="${h - B2}"/><line class="axl" x1="${x2}" x2="${x2}" y1="${T - 8}" y2="${h - B2}"/>${lines}${lt}${rt}</svg>`;
    };
    if (V.moved === 'slope2') return `<section class="card slope"><div class="band">What moved<span class="r">${escapeHtml(B)} against ${escapeHtml(A)}, one scale</span></div><div class="pad two">
      <div><h4 class="up">Rising</h4>${slope(up, 540, 420, 250, 420)}</div><div><h4 class="down">Falling</h4>${slope(dn, 540, 420, 250, 420)}</div></div></section>`;
    return `<section class="card slope"><div class="band">What moved<span class="r">${up.length} up, ${dn.length} down</span></div><div class="pad">${slope([...up, ...dn], 1130, 560, 330, 740, true)}</div></section>`;
  }

  // ---- bought together. A pair's % is taken from whichever of the two is on fewer receipts.
  // Hover keys: a pair is "p3", an item carries its own key plus every pair it's in; hovering lights all that share one.
  const nodeHk = (x) => ['n' + D.nodes.indexOf(x), ...D.top.flatMap((p, i) => (p.a === x || p.b === x ? ['p' + i] : []))].join(' ');
  const pairTip = (p) => tip(D.NM[p.a] + ' → ' + D.NM[p.b], [['Together', p.n + ' receipts'], ['Receipts with ' + D.NM[p.a], p.of], ['How often', Math.round(p.f * 100) + '%']]);
  const nodeTip = (x) => tip(D.NM[x], [['Receipts', D.RC[x]], ['Bought with', D.top.filter(p => p.a === x || p.b === x).length + ' items']]);
  const edgeW = (p) => 1.5 + p.n / D.maxN * 7;

  // Network: each group its own little constellation. Dot = an item (size = receipts), line = a pair (thickness = receipts together).
  function pairsNet(foot) {
    // The two biggest groups get half the width each; the row below packs the rest left to right, a quarter each,
    // or a half for a group of four or more (its ring needs the room). A group's top label sits above it.
    const W = 1130, H = D.groups.length > 2 ? 560 : 300, pos = {}, maxR = Math.max(...D.nodes.map(x => D.RC[x])), rad = (x) => 5 + Math.sqrt(D.RC[x] / maxR) * 10, hubs = new Set(), tops = new Set();
    let fill = 0;
    const cells = D.groups.slice(0, 6).map((xs, gi) => {
      if (gi < 2) return [(gi * 2 + 1) * W / 4, 170, W / 2];
      const w = xs.length > 3 ? W / 2 : W / 4;
      if (fill + w > W) return null;   // ponytail: one row below; what doesn't fit is in the table behind Show all
      fill += w; return [fill - w / 2, 440, w];
    });
    D.groups.slice(0, 6).forEach((xs, gi) => {
      if (!cells[gi]) return;
      const [cx, cy, cw] = cells[gi];
      if (xs.length > 3) {
        hubs.add(xs[0]); if (xs.length % 2 === 0) tops.add(xs[1]); pos[xs[0]] = [cx, cy];
        const ring = xs.slice(1), rx = Math.min(170, cw / 2 - 100), n = ring.length, off = n % 2 ? 0 : .5;
        ring.forEach((x, i) => { const t = -Math.PI / 2 + (i + off) / n * Math.PI * 2; pos[x] = [cx + rx * Math.cos(t), cy + 100 * Math.sin(t)]; });
      } else if (xs.length === 3) { tops.add(xs[0]); pos[xs[0]] = [cx, cy - 45]; pos[xs[1]] = [cx - 70, cy + 35]; pos[xs[2]] = [cx + 70, cy + 35]; }
      else xs.forEach((x, i) => { pos[x] = [cx + (i ? 70 : -70), cy]; });
    });
    const ps = D.top.filter(p => pos[p.a] && pos[p.b]);
    const edges = ps.map(p => { const i = D.top.indexOf(p), [x1, y1] = pos[p.a], [x2, y2] = pos[p.b];
      return `<g data-hk="p${i}" data-tip="${pairTip(p)}"><line class="eg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${edgeW(p)}" stroke-opacity="${.25 + .55 * p.f}"/><line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/></g>`; }).join('');
    const pctL = ps.map(p => { const [x1, y1] = pos[p.a], [x2, y2] = pos[p.b]; return `<text class="el" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 4}" text-anchor="middle" data-hk="p${D.top.indexOf(p)}">${Math.round(p.f * 100)}%</text>`; }).join('');
    const nodes = Object.entries(pos).map(([x, [cx, cy]]) => { const t = tops.has(x);
      return `<g data-hk="${nodeHk(x)}" data-tip="${nodeTip(x)}"><circle cx="${cx}" cy="${cy}" r="${rad(x)}"/><text class="nl${hubs.has(x) ? ' hb' : ''}" x="${cx}" y="${t ? cy - rad(x) - 7 : cy + rad(x) + 14}" text-anchor="middle">${escapeHtml(D.NM[x])}</text></g>`; }).join('');
    return `<section class="card"><div class="band">Bought together<span class="r">Dot = an item, sized by receipts · Line = bought together</span></div>
      <div class="net"><svg viewBox="0 0 ${W} ${H}">${edges}${nodes}${pctL}</svg></div><div class="foot">${foot}</div></section>`;
  }

  // Ring: every item around one circle, grouped, a chord for each pair. The top pairs sit beside it; hovering either side lights the other.
  function pairsRing(foot) {
    const Z = 580, c = Z / 2, R = 136, slots = D.nodes.length + D.groups.length, ang = {}, maxR = Math.max(...D.nodes.map(x => D.RC[x])); let s = 0;
    D.groups.forEach(xs => { xs.forEach(x => { ang[x] = -Math.PI / 2 + (s++ + .5) / slots * Math.PI * 2; }); s++; });
    const at = (x, r) => [c + r * Math.cos(ang[x]), c + r * Math.sin(ang[x])].map(v => v.toFixed(1));
    const chords = D.top.map((p, i) => { const [x1, y1] = at(p.a, R - 7), [x2, y2] = at(p.b, R - 7);
      return `<path class="ch" data-hk="p${i}" data-tip="${pairTip(p)}" d="M${x1},${y1} Q${c},${c} ${x2},${y2}" stroke-width="${edgeW(p)}" stroke-opacity="${.25 + .55 * p.f}"/>`; }).join('');
    const nodes = D.nodes.map(x => { const [x1, y1] = at(x, R), [tx, ty] = at(x, R + 14), deg = ang[x] * 180 / Math.PI, flip = Math.cos(ang[x]) < 0;
      return `<g data-hk="${nodeHk(x)}" data-tip="${nodeTip(x)}"><circle cx="${x1}" cy="${y1}" r="${3 + Math.sqrt(D.RC[x] / maxR) * 5}"/><text transform="translate(${tx},${ty}) rotate(${(flip ? deg + 180 : deg).toFixed(1)})" text-anchor="${flip ? 'end' : 'start'}" dy="4">${escapeHtml(D.NM[x])}</text></g>`; }).join('');
    return `<section class="card"><div class="band">Bought together<span class="r">Hover an item or a line</span></div>
      <div class="ring"><div class="pic"><svg viewBox="-70 0 ${Z + 140} ${Z}">${chords}${nodes}</svg></div><div>${pairsTable(D.top.slice(0, 10))}</div></div><div class="foot">${foot}</div></section>`;
  }
  function pairsTable(list, foot) {
    return `<table><tbody>${list.map(p => `<tr data-hk="p${D.pairs.indexOf(p)}" data-tip="${pairTip(p)}"><td>${escapeHtml(D.NM[p.a])}<span class="to">→</span>${escapeHtml(D.NM[p.b])}</td>`
      + `<td class="n"><span class="ib"><i style="width:${p.f * 100}%"></i></span>${Math.round(p.f * 100)}% of the time</td><td class="n muted">${p.n} of ${p.of} receipts</td></tr>`).join('')}</tbody></table>${foot ? `<div class="foot">${foot}</div>` : ''}`;
  }
  function pairs() {
    if (!D.pairs.length) return `<section class="card"><div class="band">Bought together</div><p class="empty">No pair bought together often enough yet.</p></section>`;
    const foot = allLink(D.pairs.length, 'pairs');
    if (V.pairs === 'ring') return pairsRing(foot);
    if (V.pairs === 'table') return `<section class="card pairs"><div class="band">Bought together</div>${pairsTable(D.pairs.slice(0, 5), foot)}</section>`;
    return pairsNet(foot);
  }

  // Each card's view dropdown sits at the right of its band. ponytail: spliced into the card's first band, so the
  // view functions stay as the lab has them.
  const withPick = (k, html) => html.replace(/(<div class="band">[\s\S]*?)<\/div>/, (m, a) =>
    a + pickMenu('si-' + k, k, VIEWS[k].filter(([x]) => V.cmp || x !== 'rank'), V[k], 'View') + '</div>');

  // ---- the pages behind Show all and the strip: [title, meta, body]
  const PAGES = {
    categories: () => ['Categories', `${D.cats.length}`, D.cats.length ? catTable(true) : '<section class="card"><p class="empty">No sales in this period yet.</p></section>'],
    items: () => ['All items', V.ct ? cutBtn() : `${inCut().length}`, search() + itemTable(true)],
    new: () => { const xs = D.items.filter(x => x.rev > 0 && !x.prev); return ['New sellers', `${xs.length} · sold in ${escapeHtml(D.now)}, nothing in ${escapeHtml(D.was)}`, search() + itemTable(true, xs)]; },
    unsold: () => {
      // What didn't sell, and the stock it leaves on the shelf. With the comparison on, what sold in the period before
      // comes first: those are the ones that stopped selling.
      const xs = D.items.filter(x => !(x.rev > 0)).map(x => ({ ...x, onHand: Number(x.p?.stock) || 0, val: x.p ? stockValue(x.p) : 0 }))
        .sort((p, q) => (V.cmp ? q.prev - p.prev : 0) || q.val - p.val);
      const tied = xs.reduce((s, x) => s + x.val, 0), found = xs.filter(hit), pg = paginate(found, V.page);
      const trs = pg.rows.map(x => `<tr><td class="nm">${escapeHtml(x.name)}<small>${escapeHtml(x.cat)}</small></td><td class="n">${qtyText(x.onHand)}</td><td class="n">${pesoShort(x.val)}</td>`
        + `${V.cmp ? `<td class="n">${x.prev > 0 ? pesoShort(x.prev) : '<span class="new">—</span>'}</td>` : ''}</tr>`).join('')
        || `<tr><td colspan="4" class="empty">${V.q ? `No item matches “${escapeHtml(V.q)}”.` : `Everything sold this ${D.unit}.`}</td></tr>`;
      return ['Didn\'t sell', `${xs.length} · ${pesoShort(tied)} of stock sitting still`, search() + `<section class="card"><table class="us"><thead><tr><th>Item</th><th class="n">On hand</th><th class="n">Stock value</th>`
        + `${V.cmp ? `<th class="n">Sold in ${escapeHtml(D.was)}</th>` : ''}</tr></thead><tbody>${trs}</tbody></table>${pagerHtml(pg)}</section>`];
    },
    pairs: () => ['Bought together', `${D.pairs.length} pairs · every receipt, not only this ${D.unit}`, D.pairs.length ? `<section class="card pairs">${pairsTable(D.pairs)}</section>` : pairs()],
  };

  const DOWNLOAD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4 20h16"/></svg>';
  function itemsPage(p, v) {
    const W = itemsWindow(p), { S, C } = W;
    D = itemsData(W);
    V = { ...v, cmp: v.cmp && D.prevData, ct: D.cats.some(c => c.key === v.ct) ? v.ct : '' };
    if (!V.cmp) { if (V.cats === 'rank') V.cats = 'donut'; if (V.sort.key === 'trend') V.sort = { key: 'revenue', dir: 'desc' }; }
    // The Summary's period menu, Compare to and all: one comparison for both tabs.
    const P = { period: W.yr ? W.now : fmt(C.a, { month: 'long', year: 'numeric' }), vsLabel: C.label, last: C.b > dayStart(new Date()) };
    const tools = `<button class="btn" data-act="export">${DOWNLOAD_ICON}Export CSV</button>${periodNav(S, P, true)}`;
    const page = PAGES[V.all];
    let head, body;
    if (page) {
      const [title, meta, html] = page();
      head = `<h1><a class="crumb" href="${escapeHtml(backToItems())}">Items</a><span class="sl">›</span>${title}${meta ? `<small>${meta}</small>` : ''}</h1>${tools}`;
      body = html;
    } else {
      const cards = D.cats.length
        ? withPick('cats', { donut: catDonut, map: catMap, bars: catBars, rank: catRank }[V.cats]())
          + withPick('list', V.list === 'table' ? itemTable(false) : itemBars())
          + (V.cmp ? withPick('moved', movers()) : '')
        : '<section class="card"><p class="empty">No sales in this period yet.</p></section>';
      head = tabSwitch('items') + tools;
      body = `<div class="stack">${strip()}${cards}${withPick('pairs', pairs())}</div>`;
    }
    return `<div class="shell"><div class="c-main si"><div class="bar">${head}</div>${body}</div><div class="si-tip"></div></div>`;
  }

  window.renderSales = function () {
    const p = Router.route().params;
    // Transactions moved to its own page (2026-09-26): old ?by=tx links land there, filters kept.
    if (p.by === 'tx') { const { by, ...rest } = p; Router.go('transactions', '', rest, { replace: true }); return; }
    if (OLD_TABS.includes(p.by)) { Router.setParams({ by: 'items', sort: '', dir: '', page: '' }); return; }
    // By staff is the Summary's Staff card now (owner 2026-09-26).
    if (p.by === 'staff') { Router.setParams({ by: '', sort: '', dir: '', page: '' }); return; }
    // The old Show all links (?x=item, ?all=category, ?all=basket ...) land on their own page now.
    const OLD_ALL = { item: 'items', category: 'categories', basket: 'pairs' };
    if (OLD_ALL[p.x] || OLD_ALL[p.all]) { Router.setParams({ x: '', it: '', all: OLD_ALL[p.x] || OLD_ALL[p.all] }); return; }
    refreshSharedState();
    const v = readView();
    const el = root();
    // Both pages are calm (bo-calm.css): the Summary's calendar, and Items on the same month.
    // The shell's ?q= listener re-renders on every keystroke: put the caret back.
    const q = el.contains(document.activeElement) && document.activeElement.matches('.q-input') ? document.activeElement.selectionStart : -1;
    el.classList.add('calm-sales');
    el.innerHTML = v.tab === 'summary' ? calendar(p) : itemsPage(p, v);
    if (q >= 0) { const i = el.querySelector('.q-input'); if (i) { i.focus(); i.setSelectionRange(q, q); } }
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
    // A picker menu's choice (Summary's Top, a card's view): the default clears the param.
    const pk = e.target.closest('.menu [data-set]');
    if (pk) { const { set, v } = pk.dataset; Router.setParams({ [set]: v === PICK_DEF[set] ? '' : v }); return; }
    // A category cuts the items to it; the same one again undoes it. On the Categories page it opens its items.
    const ct = e.target.closest('[data-ct]');
    if (ct) {
      const k = ct.dataset.ct, v = readView();
      if (v.all === 'categories') Router.setParams({ ct: k, all: 'items', page: '' }, { replace: false });
      else Router.setParams({ ct: v.ct === k ? '' : k, page: '' });
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
    if (act === 'uncut') { Router.setParams({ ct: '', page: '' }); return; }
    if (act === 'go') { Router.setParams({ all: hit.dataset.to, page: '' }, { replace: false }); return; }
    if (act === 'sort') {
      const key = hit.dataset.key, cur = readView().sort;
      // Re-sorting deals the rows again, so page 3 of the old order means nothing. Names start A-Z, figures high first.
      const dir = cur.key === key ? (cur.dir === 'desc' ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc';
      Router.setParams({ sort: key, dir, page: '' });
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
    const b = root().querySelector(`[popovertarget="${m.id}"]`), r = b.getBoundingClientRect();
    m.style.top = r.bottom + 6 + 'px';
    // a card's view menu sits at the band's right edge: it opens right-aligned to its button
    const x = b.closest('.band') ? r.right - m.offsetWidth : r.left;
    m.style.left = Math.max(16, Math.min(x, innerWidth - m.offsetWidth - 16)) + 'px';
  }, true);

  // Items' hover tip: every mark carries its numbers in data-tip. Hovering a donut slice or row lights its partner;
  // hovering an item or a pair lights every line, dot and row that shares one of its keys (data-hk).
  document.addEventListener('mousemove', (e) => {
    const el = root(), tipEl = el && el.querySelector('.si-tip');
    if (!tipEl || !e.target.closest) return;
    const t = e.target.closest('.si [data-tip]'), card = e.target.closest('.si .card');
    el.querySelectorAll('.si .lit').forEach(x => x.classList.remove('lit'));
    el.querySelectorAll('.si .hkhl, .si .donut.hov').forEach(x => x.classList.remove('hkhl', 'hov'));
    if (!t) { tipEl.style.opacity = 0; return; }
    const i = t.dataset.i, hk = t.dataset.hk;
    if (i != null && card) { card.querySelector('.donut')?.classList.add('hov'); card.querySelectorAll(`.donut [data-i="${i}"]`).forEach(x => x.classList.add('lit')); }
    if (hk && card) {
      const keys = hk.split(' ');
      card.classList.add('hkhl');
      card.querySelectorAll('[data-hk]').forEach(x => { if (x.dataset.hk.split(' ').some(k => keys.includes(k))) x.classList.add('lit'); });
    }
    tipEl.innerHTML = t.dataset.tip;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(e.clientX + 14, innerWidth - w - 8) + 'px';
    tipEl.style.top = (e.clientY + 16 + h > innerHeight ? e.clientY - h - 12 : e.clientY + 16) + 'px';
    tipEl.style.opacity = 1;
  });

  // Esc closes the day/week pop-up, unless a dialog is taking the key.
  document.addEventListener('keydown', (e) => {
    // Items: Enter sorts a header / cuts to a category as a click does (neither has key activation of its own);
    // the re-render replaces them, so focus goes back to the same one.
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.si :is(th[data-act], [data-ct][tabindex])')) {
      const t = e.target, sel = t.dataset.ct != null ? `[data-ct="${CSS.escape(t.dataset.ct)}"][tabindex]` : `th[data-key="${CSS.escape(t.dataset.key)}"]`;
      t.click();
      root().querySelector(`.si ${sel}`)?.focus();
      return;
    }
    const el = root();
    if (e.key !== 'Escape' || !el || el.hidden || !el.classList.contains('calm-sales') || document.querySelector('dialog[open]')) return;
    const p = Router.route().params;
    if (p.day || p.week) Router.setParams({ day: '', week: '' });
  });
})();
