/* Back office — Sales. Renders the whole #view section; see CONTRACT.
   Pure read: this page never writes storage. Every money figure is a ladder() (the shell's
   SalesMath.summarize), so a figure here and the same figure on the dashboard cannot drift apart. */
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
    const { week, page, all, q, ...keep } = Router.route().params;   // ?day= carries: the pop-up's day is Items' day
    return `<div class="seg pd-switch" aria-label="Sales view">${TABS.map(([k, label]) =>
      `<a class="seg-btn${k === tab ? ' active' : ''}" href="${escapeHtml(Router.href(VIEW, '', { ...keep, by: k === 'summary' ? '' : k }))}">${label}</a>`).join('')}</div>`;
  };

  const qtyText = SalesMath.qtyText;   // THE quantity on screen
  const money = SalesMath.round2; // CSV: plain number, no currency sign

  // ---------- Items and categories: one ladder ----------
  // Each line keys its item and its FIRST category (categoryOf, owner 2026-10-02), so category rows
  // add up to Net sales like item rows do; a cut (?ct=) is that same category, so it adds up to its row. Rows are
  // ladder groups: netSales, grossProfit, margin (0..1), unitsSold, costOfGoods, plus their share.
  function agg(rows) {
    const meta = new Map();
    const t = ladder(rows, { by: (o, i) => {
      if (!(o.items || []).length) return null;
      const p = productFor(i), ik = (p && p.id) || SalesMath.itemKey(i);
      if (!meta.has(ik)) meta.set(ik, {
        key: ik,
        name: (p && p.name) || i.name,
        sku: (p && p.sku) || i.sku || '—',
        brand: (p && p.brand) || '',
        ck: categoryOf(p),   // the one category its money counts under; '' is uncategorized
        cat: folderName(categoryOf(p)),
        unit: i.unit || '',
      });
      return ['i:' + ik, 'c:' + meta.get(ik).ck];
    } });
    const items = [], cats = [];
    for (const [k, g] of t.groups) {
      const id = k.slice(2), r = { ...g, share: SalesMath.share(g.netSales, t.netSales) };
      if (k[0] === 'i') items.push({ ...r, ...meta.get(id) }); else cats.push({ ...r, key: id, name: folderName(id) });
    }
    // A category's Items sold: SalesMath.itemsSold of its items, the one count Top categories and Items both show.
    for (const c of cats) c.itemsSold = SalesMath.itemsSold(items.filter(x => x.ck === c.key));
    return { totals: t, items, cats };
  }
  // Two products can share a name (a Local and a Generic Hollow Block 4"): the brand tells them apart,
  // on every list, even one where only one of them sold.
  const apart = (xs) => { const n = new Map(); for (const p of state.products) n.set(p.name, (n.get(p.name) || 0) + 1);
    for (const x of xs) if (n.get(x.name) > 1 && x.brand) x.name += ' · ' + x.brand; return xs; };
  // The items sold (SalesMath.itemsSold: a unit or more), biggest first: the day/week pop-ups here and on
  // the dashboard. Its length is the "items sold" beside them.
  const topItems = (rows) => apart(agg(rows).items).filter(r => r.unitsSold > 0).sort((x, y) => y.netSales - x.netSales);

  // ---------- Columns: what the CSV exports ----------
  // Items' CSV: every item in the period (the category picked, if one is), in the table's order.
  const COLUMNS = [
    { label: 'Item', csv: r => r.name },
    { label: 'SKU', csv: r => r.sku },
    { label: 'Category', csv: r => r.cat },
    { label: 'Units sold', csv: r => money(r.unitsSold) },
    { label: 'Net sales', csv: r => money(r.netSales) },
    { label: 'Cost of goods', csv: r => money(r.costOfGoods) },
    { label: 'Gross profit', csv: r => money(r.grossProfit) },
    // pctText's rule, as a plain number: blank where the screen says '—' (nothing to be a margin or share of)
    { label: 'Margin %', csv: r => (r.salesBeforeTax > 0 ? money(r.margin * 100) : '') },
    { label: 'Share', csv: r => (D.totals.netSales > 0 ? money(r.share * 100) : '') },
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
      // Net sales desc is the answer to "what makes us money"; everything else is a click away.
      sort: { key: p.sort in ITEM_K ? p.sort : 'revenue', dir: p.dir === 'asc' ? 'asc' : 'desc' },
    };
  }

  // ---------- Summary: the month calendar (sales-calendar-lab.html, ported as is) ----------
  // Its own window, not the range picker's: a month or a year. The URL holds it all --
  // ?view=year, ?month=YYYY-MM, ?day= / ?week= for the side panel, ?top= for the Top 10 --
  // so every click is a setParams and a re-render, and Back walks it.
  // Every date here is on the STORE'S clock (boZone, SalesMath.dateParts), never the browser's.
  const fmt = (t, o) => dashDate(t, o);   // the shell's store-day text
  const clock = (t) => SalesMath.dateParts(t, boZone());   // { year, month 1-12, day, hour, weekday 0 = Sun }
  const fromIso = (s) => SalesMath.dayStartMs(s, boZone());
  // The store midnight that starts month m (1-12) of year y; m may run past either end (0 = December before).
  const monthStart = (y, m) => fromIso(new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10));
  const monthEnd = (t) => { const p = clock(t); return monthStart(p.year, p.month + 1); };
  const weekEnd = (t) => Math.min(shiftDays(t, 7 - ((clock(t).weekday + 6) % 7)), monthEnd(t));   // exclusive, clipped to the month
  const daysIn = (t) => { const p = clock(t); return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate(); };
  // Every daily average divides by this (SalesMath.daysOpen); only the target spreads over daysIn.
  const daysOpen = (rows) => SalesMath.daysOpen(rows, { zone: boZone() });
  // Every share and margin on the page: SalesMath.pctText ('—' when there is nothing to be a share of), a true minus.
  const pct = SalesMath.pctText;
  const plural = SalesMath.plural;
  // The hour a row is charted in, the Dashboard's rule (SalesMath.chartTime): a void on its sale's own day sits in
  // the sale's hour, so it cancels that hour instead of pushing its own below zero. Build once per chart, from
  // its rows: every window is whole store days, so a same-day void's sale is always among them.
  const hourOf = (rows) => { const at = new Map(rows.map(o => [o.id, o.ts])); return (o) => clock(SalesMath.chartTime(o, at, boZone())).hour; };
  // A trend in words (SalesMath.changeText, the Dashboard's chip text) and its tone for the class.
  const tone = SalesMath.changeTone;   // the Dashboard chip's up/down rule, one copy
  const calRow = (nm, amt, cmp = '', cls = '') => `<div class="row ${cls}"><span class="nm">${nm}</span><span class="amt">${amt}</span>${cmp !== null ? `<span class="cmp">${cmp}</span>` : ''}</div>`;
  // The ladder (sales-terms): Gross sales − Voids − Refunds − Discounts = Net sales; less the tax inside it,
  // Sales before VAT. To the centavo: whole pesos would round each row apart and stop adding up.
  // Tax inside the prices (PH) comes off Net sales; tax on top (US) was never in it, so it is only shown;
  // no tax (a non-VAT store) shows no tax rows. Which one is the ladder's taxIncluded (a window mixing both reads as "included").
  const nOf = (c) => (c ? ` (${c})` : '');
  const taxRows = (m) => { const t = escapeHtml(SalesMath.taxName(state.settings));
    return !m.tax ? '' : m.taxIncluded
      ? calRow(`${t} included`, peso(m.tax), null) + calRow(`Sales before ${t}`, peso(m.salesBeforeTax), null)
      : calRow(`${t} on top`, peso(m.tax), null); };
  const breakdownRows = (m) => `<div class="rows">
      ${calRow('Gross sales', peso(m.grossSales), null)}
      ${calRow('Voids' + nOf(m.voidCount), peso(-m.voids), null)}
      ${calRow('Refunds' + nOf(m.refundCount), peso(-m.refunds), null)}
      ${calRow('Discounts', peso(-m.discounts, { signed: true }), null)}
      ${calRow('Net sales', peso(m.netSales), null, 'total')}
      ${taxRows(m)}</div>`;
  // Groups of a ladder, biggest net sales first: [key, ladder].
  const ranked = (rows, by) => [...ladder(rows, { by }).groups].sort((x, y) => y[1].netSales - x[1].netSales);
  // Staff: [name, ladder] by SELLER (SalesMath.sellerOf, owner 2026-10-02): a void or refund is the minus of
  // whoever made the sale, not whoever pressed it; grouped by staff id, named by the sale's cashier.
  const byStaff = (rows) => { const seller = SalesMath.sellerOf(state.orders), names = new Map();
    return ranked(rows, o => { const s = seller(o); if (!names.has(s.key)) names.set(s.key, s.name || '—'); return s.key; })
      .map(([k, g]) => [names.get(k), g]); };
  // Payment methods: byPayment (the shell's, SalesMath.tenders). Account is "on account", not "unpaid":
  // whether it is still owed is the customer's statement (accountDebts), so no pill here.
  const payRows = (rows, of) => byPayment(rows).map(([k, v]) => calRow(escapeHtml(k), pesoShort(v), of(v))).join('');

  // The month the page opens on: the last sale's (SalesMath.lastSale: a voided sale, a parked cart or a refund never moves it).
  const lastSale = () => SalesMath.lastSale(state.orders) || Date.now();
  function calState(p, last) {
    const month = /^\d{4}-\d{2}$/.test(p.month || '') ? fromIso(p.month + '-01')
      : (d => monthStart(d.year, d.month))(clock(Math.min(last, Date.now())));
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
  // Items on a picked day (?day=): that day, against the same weekday a week before, like the pop-up's chip.
  function dayCompare(S) {
    const a = S.sel.at, b = shiftDays(a, 1);
    return { a, b, title: '', ...(S.vs ? { prevA: shiftDays(a, -7), prevB: shiftDays(b, -7), label: `vs ${dayLabel(shiftDays(a, -7))}` } : { label: '' }) };
  }
  function calCompare(S, TODAY) {
    const d0 = clock(S.month), y = d0.year, isYear = S.view === 'year';
    const a = isYear ? monthStart(y, 1) : S.month, b = isYear ? monthStart(y + 1, 1) : monthEnd(a);
    if (!S.vs) return { a, b, title: '', label: '' };
    const prevA = isYear ? monthStart(y - 1, 1) : monthStart(y, d0.month - (S.vs === 'year' ? 12 : 1));
    const prevEnd = isYear ? a : monthEnd(prevA), cutoff = Math.min(b, shiftDays(TODAY, 1));
    const prevB = cutoff >= b ? prevEnd : Math.min(prevEnd, shiftDays(prevA, Math.round((cutoff - a) / 864e5)));
    const whole = prevB === prevEnd, py = clock(prevA).year;
    const label = isYear ? `vs ${py}` : `vs ${fmt(prevA, { month: 'long' })}${S.vs === 'year' ? ` ${py}` : ''}`;
    const title = whole ? label : isYear ? `vs the same days of ${py}`
      : `vs ${fmt(prevA, { month: 'short', day: 'numeric' })} – ${fmt(prevB - 1, { day: 'numeric' })}${S.vs === 'year' ? `, ${py}` : ''}`;
    return { a, b, prevA, prevB, title, label };
  }

  // The strip is the card's folder tabs (sales-calendar-tabs-lab.html): the picked tab is what every calendar cell shows.
  // m is a ladder(). The ?chart= keys stay as they were so old links still open.
  const mgOf = (x) => x.margin * 100;
  const count = (v) => (+v.toFixed(1)).toLocaleString('en-PH');
  const pct1 = (v) => pct(v / 100);   // a margin already in points (mgOf): the calendar's bar and how far a cell is over or short of it
  const mgText = (m, dp) => pct(m.margin, m.salesBeforeTax, dp);   // a ladder's (or an Items row's) margin: '—' with nothing sold
  const orders = (m) => plural(m.orders, 'order');   // the ladder floors orders at 0
  // `txt` is what a cell prints for its ladder, when it isn't fmt(of(m)): a margin with nothing sold is '—', as on the tab.
  const MEAS = {
    rev: { lbl: 'Net sales', of: m => m.netSales, fmt: pesoShort, sm: pesoK, sub: m => orders(m) },
    gp: { lbl: 'Gross profit', of: m => m.grossProfit, fmt: pesoShort, sm: pesoK, sub: m => `${mgText(m)} margin` },
    n: { lbl: 'Orders', of: m => m.orders, fmt: count, sm: count, sub: m => (m.orders > 0 ? `${pesoShort(m.averageSale)} average` : '') },
    mg: { lbl: 'Margin', of: mgOf, fmt: pct1, sm: pct1, txt: mgText, sub: m => `${pesoK(m.grossProfit)} gross profit` },
  };
  // A cell's figure for ladder m under measure k, in fmt (or sm, the phone's short form).
  const cellTxt = (k, m, f = MEAS[k].fmt) => (MEAS[k].txt ? MEAS[k].txt(m) : f(MEAS[k].of(m)));
  // A day (month) that moved money: a sale, a void or a refund. A parked cart alone is not a sale day (SalesMath.daysOpen's rule).
  const moved = (m) => m.orders || m.voidCount || m.refundCount;
  // days = days that had sales, the same average an untargeted calendar greens against.
  function calStrip(S, cur, prev, prevTitle, days, target) {
    const tab = (k, val, side, sub, tip = '') =>
      `<button class="stat" role="tab" data-chart="${k}" aria-selected="${S.chart === k}"${tip ? ` title="${escapeHtml(tip)}"` : ''}><div class="lbl">${MEAS[k].lbl}</div><div class="line"><span class="val">${val}</span>${side || ''}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</button>`;
    const perDay = (v) => (days ? v / days : 0);
    let html = tab('rev', pesoK(cur.netSales), calmChip(cur.netSales, prev.netSales, prevTitle), days ? pesoShort(perDay(cur.netSales)) + ' daily average' : '')
      + tab('gp', pesoK(cur.grossProfit), calmChip(cur.grossProfit, prev.grossProfit, prevTitle), days ? pesoShort(perDay(cur.grossProfit)) + ' daily average' : '')
      + tab('n', count(cur.orders), calmChip(cur.orders, prev.orders, prevTitle),
        days ? count(perDay(cur.orders)) + ' daily average' : '', cur.orders > 0 ? pesoShort(cur.averageSale) + ' average sale' : '')
      + tab('mg', mgText(cur), marginChip(cur, prev, prevTitle), '');   // backoffice.js marginChip: the one margin chip
    // no Best stat (owner 2026-09-26): the best day (month) is tagged on the calendar instead
    if (target == null) return html;                                   // year view: four stats
    return html + `<button class="stat act" data-act="cal-target" title="${target ? `${pesoShort(cur.netSales)} of ${pesoShort(target)} · click to change` : 'Set a monthly target'}">`
      + `<div class="lbl">Target</div><div class="line">${target
        ? `<span class="val">${pesoK(cur.netSales)}</span><b class="pct">${pctOf(cur.netSales, target, 0)}</b></div><div class="sub">of ${pesoK(target)}</div>`
        : '<span class="val">—</span><span class="set">Set</span></div>'}</button>`;
  }

  // Top 10: items, categories, weekdays or hours, each a ladder group, so a discount can't make the
  // items add up to more than the receipt.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // "9 – 10 AM", "11 AM – 12 PM": the shell's hourLong, the AM/PM said once when both ends share it.
  const hourSpan = (h) => { const a = hourLong(h), b = hourLong(h + 1);
    return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`; };
  // Items and categories are agg()'s rows, the same ones the Items page ranks, keyed by product and folder.
  // Only what sold ranks (SalesMath.itemsSold's rule): an item with a unit or more, a category with an item sold.
  // A fully refunded item is not a top seller; a category stays while any of its items sold (its count column).
  function tops(rows, by) {
    if (by === 'item' || by === 'cat') {
      const a = agg(rows), xs = by === 'item' ? apart(a.items).filter(r => r.unitsSold > 0) : a.cats.filter(r => r.itemsSold > 0);
      return new Map(xs.map(r => [r.key, { ...r, qty: r.unitsSold, items: r.itemsSold || 0 }]));
    }
    const hour = hourOf(rows), keyOf = by === 'day' ? (o) => DAYS[(clock(o.ts).weekday + 6) % 7] : (o) => hourSpan(hour(o));
    // a weekday averages over the days it was open; an hour over every open day in the window (daysOpen, the one day count)
    const open = daysOpen(rows), byDay = by === 'day' && SalesMath.daysOpenBy(rows, keyOf, { zone: boZone() });
    const per = (k) => (byDay ? byDay.get(k) : open) || 1;
    return new Map([...ladder(rows, { by: keyOf }).groups].map(([k, x]) => [k, { key: k, name: k, qty: x.unitsSold, netSales: x.netSales,
      avg: x.netSales / per(k) }]));
  }
  const TOP_BY = [['item', 'Top items', 'Units sold'], ['cat', 'Top categories', 'Items sold'],
    ['day', 'Busiest days', 'Daily average'], ['hour', 'Busiest hours', 'Daily average']];
  function calTop(T, by) {
    const [, , qtyHead] = TOP_BY.find(x => x[0] === by), cur = tops(T.rows, by), before = T.prev && T.prev.some(o => saleSign(o) > 0) && tops(T.prev, by);   // nothing sold back then: no Trend column of "New"
    // weekdays rank and share by their average: a month can hold five Wednesdays and four Saturdays
    // items and categories share the period's Net sales (SalesMath.share); weekdays and hours their own sum
    const val = (b) => (by === 'day' ? b.avg : b.netSales);
    const total = by === 'item' || by === 'cat' ? ladder(T.rows).netSales : [...cur.values()].reduce((x, b) => x + val(b), 0);
    const list = [...cur.values()].sort((x, y) => val(y) - val(x)).slice(0, 10), max = list.length ? val(list[0]) : 1;
    const sw = pickMenu('calTop', 'top', TOP_BY, by, 'Rank by');
    const qty = (b) => (by === 'day' || by === 'hour' ? pesoShort(b.avg) : by === 'cat' ? plural(b.items, 'item')
      : qtyText(b.qty) + (b.unit && !/^pcs?$/.test(b.unit) ? ' ' + escapeHtml(b.unit) : ''));
    // the Trend of what the row ranks by: a weekday's average against its average then, so a fifth Wednesday is not growth
    const vs = (b) => {
      if (!before) return '';
      const w = before.get(b.key), t = SalesMath.changeText(val(b), w ? val(w) : 0);
      return `<td class="n cmp ${tone(t)}">${t}</td>`;
    };
    return list.length ? `<div class="flush"><table${by === 'day' || by === 'hour' ? ' class="avg"' : ''}>
      <tr><th class="sw">${sw}</th><th class="n qty">${qtyHead}</th><th class="n amt">Net sales</th><th class="sh">Share</th>${before ? `<th class="n cmp" title="${escapeHtml(T.sub)}">Trend</th>` : ''}</tr>
      ${list.map(b => `<tr><td class="nm">${escapeHtml(b.name)}${by !== 'item' || b.cat === 'Uncategorized' ? '' : `<small>${escapeHtml(b.cat)}</small>`}</td>
        <td class="n qty">${qty(b)}</td><td class="n amt">${pesoShort(b.netSales)}</td>
        <td class="sh"><span><i style="width:${Math.max(0, val(b) / max * 100)}%"></i></span>${pctOf(val(b), total)}</td>${vs(b)}</tr>`).join('')}
    </table>${by === 'item' || by === 'cat' ? `<a class="all" href="${Router.href(VIEW, '', { by: 'items', month: T.month, view: T.view })}">See all in Items →</a>` : ''}</div>`
      : '<p class="note empty">No sales in this period yet.</p>';
  }

  // Payment methods, breakdown and staff: the panel's lists, for the whole period.
  function calMix(rows) {
    const m = ladder(rows);
    const w = (title, body, side = '') => `<div class="w"><div class="band">${title}<span>${side}</span></div>${body}</div>`;
    if (!rows.some(saleSign)) {
      const none = '<p class="note empty">No sales in this period yet.</p>';
      return w('Payment methods', none) + w('Breakdown', none) + w('Staff', none);
    }
    // What By staff used to add (owner 2026-09-26): each cashier's voids and refunds, quiet after the name.
    const note = (x) => { const t = [x.voidCount && plural(x.voidCount, 'void'), x.refundCount && plural(x.refundCount, 'refund')].filter(Boolean);
      return t.length ? `<small>${t.join(' · ')}</small>` : ''; };
    return w('Payment methods', `<div class="rows">${payRows(rows, v => pctOf(v, m.collected))}
      ${calRow('Total', pesoShort(m.collected), '', 'total')}</div>`)
      + w('Breakdown', breakdownRows(m))
      + w('Staff', `<div class="rows">${byStaff(rows).map(([k, x]) => calRow(escapeHtml(k) + note(x), pesoShort(x.netSales), pctOf(x.netSales, m.netSales))).join('')}</div>`);
  }

  // the best and slowest day (month) name themselves in the cell's top right corner
  const calTag = (top, slow) => (top ? '<b class="tag">Best</b>' : slow ? '<b class="tag slow">Slowest</b>' : '');

  function calMonth(S, rowsIn, byDay, TODAY, monthTarget) {
    const C = calCompare(S, TODAY), { a, b } = C;
    const prevRows = S.vs ? rowsIn(C.prevA, C.prevB) : null;
    const cur = ladder(rowsIn(a, b)), prev = ladder(prevRows || []);
    const days = [];
    for (let t = a; t < b; t = shiftDays(t, 1)) { const rows = byDay.get(isoDate(t)) || []; if (rows.length) days.push({ t, m: ladder(rows) }); }
    const open = days.filter(d => moved(d.m)), done = open.filter(d => d.t < TODAY);   // today isn't over yet
    const { of, fmt: mf, sm, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? SalesMath.bestDay(done.map(d => [d.t, of(d.m)]), TODAY) : null;   // [t, value]
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    const nOpen = daysOpen(rowsIn(a, b));   // the one "per day" divisor: days with a sale, void or refund
    const strip = calStrip(S, cur, prev, C.title, nOpen, monthTarget);

    // ponytail: a flat share of the monthly target per calendar day. The live target spreads what's
    // left over the days left; that's a "today" promise, and a past day needs a fixed bar to be judged by.
    // net sales keeps the daily target; the others, the month's own per-day average (margin: the month's margin)
    const bar = isRev && monthTarget ? monthTarget / daysIn(a) : S.chart === 'mg' ? mgOf(cur) : (nOpen ? of(cur) / nOpen : 0);
    const lead = (clock(a).weekday + 6) % 7;                               // Monday-first, a hardware shop's week
    let anyLoss = false, anySlow = false;
    const barName = S.chart === 'mg' ? `the month's ${mgText(cur)} margin`
      : `the ${mf(bar)}${S.chart === 'n' ? ' orders' : ''} daily ${isRev && monthTarget ? 'target' : 'average'}`;
    // a missed day stays white; a day over the bar goes green, deeper the further over, up to the month's best day
    const hi = Math.max(0, ...open.map(d => of(d.m)));
    const heat = (v) => `color-mix(in srgb, var(--b-heat) ${Math.round(12 + 43 * (hi > bar ? (v - bar) / (hi - bar) : 1))}%, white)`;
    let html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('') + '<div class="dow wk">Week</div>';
    for (let w = shiftDays(a, -lead); w < b; w = shiftDays(w, 7)) {
      for (let i = 0; i < 7; i++) {
        const t = shiftDays(w, i);
        if (t < a || t >= b) { html += '<div class="cell pad"></div>'; continue; }
        const dn = clock(t).day, rows = byDay.get(isoDate(t)) || [];
        const sel = S.sel && S.sel.kind === 'day' && S.sel.at === t ? ' sel' : '', today = t === TODAY ? ' today' : '';
        if (t > TODAY) { html += `<div class="cell future${today}"><span class="d">${dn}</span></div>`; continue; }
        const m = ladder(rows), v = of(m);
        if (!moved(m)) { html += `<div class="cell shut${today}"><span class="d">${dn}</span><span class="m">No sales</span></div>`; continue; }
        let cls = '', style = '', tip = '';
        if (m.netSales < 0) { cls = ' loss'; tip = 'More refunds than sales'; anyLoss = true; }
        else if (bar && v >= bar) { cls = ' heat'; style = ` style="--heat:${heat(v)}"`; tip = `${mf(v - bar)} over ${barName}`; }
        else if (bar) tip = `${mf(bar - v)} short of ${barName}`;
        const slow = worst && worst.t === t && cls !== ' heat';
        if (slow) { cls = ' loss'; tip = 'Slowest day of the month' + (tip ? ' · ' + tip : ''); anySlow = true; }
        const top = best && best[0] === t;
        if (top) { cls += ' best'; tip = 'Best day of the month' + (tip ? ' · ' + tip : ''); }
        // the refunds ride in the tip (and the day's panel): each line refund is its own row, so the cell ran out of room
        if (m.refundCount) tip = (tip ? tip + ' · ' : '') + plural(m.refundCount, 'refund');
        html += `<button class="cell${cls}${today}${sel}" data-day="${isoDate(t)}"${style}${tip ? ` title="${tip}"` : ''}><span class="d">${dn}</span>${calTag(top, slow)}`
          + `<span class="v"><span class="full">${cellTxt(S.chart, m)}</span><span class="sm">${cellTxt(S.chart, m, sm)}</span></span><span class="m">${sub(m)}</span></button>`;
      }
      const ws = Math.max(w, a), we = Math.min(shiftDays(w, 7), b, shiftDays(TODAY, 1));
      if (ws >= we) { html += '<div class="cell week wk pad"></div>'; continue; }
      const wr = rowsIn(ws, we), wm = ladder(wr), wdays = daysOpen(wr);
      const sel = S.sel && S.sel.kind === 'week' && S.sel.at === ws ? ' sel' : '';
      html += `<button class="cell week wk${sel}" data-week="${isoDate(ws)}"><span class="d">${fmt(ws, { month: 'short', day: 'numeric' })} – ${fmt(we - 1, { day: 'numeric' })}</span>`
        + `<span class="v">${cellTxt(S.chart, wm)}</span><span class="m">${plural(wdays, 'day')} · ${sub(wm)}</span></button>`;
    }
    const grid = `<div class="cal">${html}</div><div class="legend"><span><i></i>Below ${barName}</span><span>Above<i class="scale"></i></span>`
      + (anySlow || anyLoss ? `<span><i class="r"></i>${[anySlow && 'Slowest day', anyLoss && 'Lost money'].filter(Boolean).join(' · ')}</span>` : '') + '</div>';
    return { strip, cols: 5, grid, period: fmt(a, { month: 'long', year: 'numeric' }), vsLabel: C.label, last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: prevRows, month: isoDate(a).slice(0, 7), sub:fmt(a, { month: 'long' }) + (b > TODAY ? ' so far' : '') + ' · ' + C.title } };
  }

  function calYear(S, rowsIn, byDay, TODAY, monthTarget) {
    const C = calCompare(S, TODAY), { a, b } = C, y = clock(a).year;
    const prevRows = S.vs ? rowsIn(C.prevA, C.prevB) : null;
    const cur = ladder(rowsIn(a, b)), prev = ladder(prevRows || []);
    const months = Array.from({ length: 12 }, (_, i) => { const t = monthStart(y, i + 1); return { t, m: ladder(rowsIn(t, monthEnd(t))) }; });
    const open = months.filter(x => moved(x.m)), done = open.filter(x => monthEnd(x.t) <= TODAY);   // nor is this month
    const { of, fmt: mf, sub } = MEAS[S.chart], isRev = S.chart === 'rev';
    const best = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) > of(x.m) ? d : x), null) : null;
    const worst = done.length > 1 ? done.reduce((x, d) => (!x || of(d.m) < of(x.m) ? d : x), null) : null;
    const strip = calStrip(S, cur, prev, C.title, daysOpen(rowsIn(a, b)));
    const avg = S.chart === 'mg' ? mgOf(cur) : open.length ? of(cur) / open.length : 0;
    const goal = (isRev && monthTarget) || avg;
    const goalName = isRev && monthTarget ? 'Hit the monthly target' : S.chart === 'mg' ? 'Above the year’s margin' : 'Above the monthly average';
    const grid = '<div class="months">' + months.map(({ t, m }) => {
      const name = fmt(t, { month: 'long' });
      if (t > TODAY) return `<div class="cell future"><span class="d">${name}</span></div>`;
      if (!moved(m)) return `<div class="cell shut"><span class="d">${name}</span><span class="m">No sales</span></div>`;
      const hit = of(m) >= goal, slow = !hit && worst && worst.t === t, top = best && best.t === t;
      const tip = [top && 'Best month of the year', hit && `${goalName} (${mf(goal)})`, slow && 'Slowest month of the year'].filter(Boolean).join(' · ');
      return `<button class="cell${hit ? ' good' : slow ? ' loss' : ''}${top ? ' best' : ''}" data-month="${isoDate(t).slice(0, 7)}"${tip ? ` title="${tip}"` : ''}><span class="d">${name}</span>${calTag(top, slow)}`
        + `<span class="v">${cellTxt(S.chart, m)}</span><span class="m">${isRev ? `${orders(m)} · ${mgText(m)} margin` : sub(m)}</span></button>`;
    }).join('') + `</div><div class="legend"><span><i class="g"></i>${goalName} (${mf(goal)})</span>${worst && of(worst.m) < goal ? '<span><i class="r"></i>Slowest month</span>' : ''}<span>Click a month to open its calendar</span></div>`;
    return { strip, cols: 4, grid, period: String(y), vsLabel: C.label, last: b > TODAY,
      T: { rows: rowsIn(a, b), prev: prevRows, month: y + '-01', view: 'year', sub: y +(b > TODAY ? ' so far' : '') + ' · ' + C.title } };
  }

  // The side panel: everything the old Summary charted, for one day or one week. Two columns of cards;
  // its receipts are links into Transactions, which owns the full list (owner 2026-10-02).
  function calPanel(S, rowsIn, TODAY) {
    const { kind, at } = S.sel, isDay = kind === 'day';
    const end = isDay ? shiftDays(at, 1) : weekEnd(at);
    const rows = rowsIn(at, end).sort(SalesMath.newestFirst), m = ladder(rows);
    // the week you're in against the same days of the one before, never half against whole (calCompare's cutoff)
    const span = Math.round((Math.min(end, shiftDays(TODAY, 1)) - at) / 864e5), pm =ladder(rowsIn(shiftDays(at, -7), shiftDays(at, -7 + span)));
    const title = isDay ? fmt(at, { weekday: 'long', month: 'long', day: 'numeric' })
      : `${fmt(at, { month: 'short', day: 'numeric' })} – ${fmt(end - 1, { month: 'short', day: 'numeric' })}`;
    const share = (v, of = m.netSales) => pctOf(v, of);
    const sec = (lbl, body, side = '', wide = false) => `<div class="p-sec${wide ? ' wide' : ''}"><div class="lbl">${lbl}<span>${side}</span></div>${body}</div>`;

    let html = `<div class="p-top"><h2>${title}</h2>
      <button class="icon-btn" data-step="-1" aria-label="Previous ${kind}">‹</button>
      <button class="icon-btn" data-step="1" aria-label="Next ${kind}" ${end > TODAY ? 'disabled' : ''}>›</button>
      <button class="icon-btn" data-close aria-label="Close">✕</button></div>`;
    html += `<div class="p-head"><span class="val">${pesoShort(m.netSales)}</span>${!S.vs ? '' : calmChip(m.netSales, pm.netSales, isDay ? 'vs the same day last week' : 'vs the week before')}</div>`
      + `<p class="p-sub">${orders(m)} · ${pesoShort(m.grossProfit)} gross profit · ${pesoShort(m.averageSale)} average</p>`;
    if (!rows.length) return html + '<p class="p-sub" style="margin-top:20px">No sales.</p>';

    // hours: the ones that sold, one either side; a same-day void in its sale's hour (hourOf, the Dashboard's bars)
    const hr = Array(24).fill(0);
    for (const [h, g] of ladder(rows, { by: hourOf(rows) }).groups) hr[h] = g.netSales;
    const sold = hr.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    const h0 = sold.length ? Math.max(0, sold[0] - 1) : 7, h1 = sold.length ? Math.min(23, sold[sold.length - 1] + 1) : 18;
    const hi = Math.max(...hr), top = Math.max(...hr.slice(h0, h1 + 1), 1), peak = hi > 0 ? hr.indexOf(hi) : -1;   // only refunds: no busiest hour
    let bars = '', xs = '';
    for (let i = h0; i <= h1; i++) {
      bars += `<div title="${hourShort(i)} · ${pesoShort(hr[i])}"><i class="${i === peak ? 'top' : ''}" style="height:${Math.max(0, hr[i]) / top * 100}%"></i></div>`;
      xs += `<span>${(i - h0) % 3 ? '' : hourShort(i)}</span>`;
    }
    let grid = sec('By hour', `<div class="hours">${bars}</div><div class="hours-x">${xs}</div>`, peak < 0 ? '' : `busiest ${hourShort(peak)}`, true);
    grid += sec('Breakdown', breakdownRows(m));

    grid += sec('Payment methods', `<div class="rows">${payRows(rows, v => share(v, m.collected))}</div>`);
    const its = topItems(rows);
    grid += sec('Top items', `<div class="rows">${its.slice(0, 5).map(r => calRow(escapeHtml(r.name), pesoShort(r.netSales), share(r.netSales))).join('')}</div>`, `${plural(its.length, 'item')} sold`);
    grid += sec('Staff', `<div class="rows">${byStaff(rows).map(([k, g]) => calRow(escapeHtml(k), pesoShort(g.netSales), share(g.netSales))).join('')}</div>`);

    // voids and refunds stay in the list, struck through, never filtered out
    const rc = (o) => {
      const when = SalesMath.dateText(o.ts, boZone(), isDay ? 'time' : 'day');
      return `<a class="row ${rowDim(o)}" href="${escapeHtml(Router.href('transactions', '', { ...txWin, receipt: o.id }))}"><span class="t">${when}</span><span class="nm">${escapeHtml(o.number || o.id || '')} · ${escapeHtml(orderPaymentLabel(o))}${statusPill(o)}</span><span class="amt">${txTotal(o, pesoShort)}</span></a>`;
    };
    // ponytail: Transactions ranges are 1/7/15/30 days, so a week cut by the month edge opens as its whole
    // Mon-Sun week, and "See all" drops the count it would not match. A from/to range there if that bites.
    const txWin = isDay ? { date: isoDate(at) } : { range: '7d', date: isoDate(shiftDays(at, 6 - ((clock(at).weekday + 6) % 7))) };
    const list = rows.filter(o => o.status !== 'saved');
    grid += sec('Orders', `<div class="rows">${list.slice(0, 12).map(rc).join('')}</div>`,
      `<a class="all" href="${escapeHtml(Router.href('transactions', '', txWin))}">See all${isDay || span === 7 ? ' ' + rows.length : ''} →</a>`, true);   // Transactions lists parked sales too
    return html + `<div class="p-grid">${grid}</div>`;
  }

  // One control (owner 2026-09-26): ‹ [period ▾] ›, its menu the presets and, on the Summary, Compare to, like
  // the Dashboard's. Items shares it: the same month, told in more depth. P: { period, vsLabel, last }.
  function periodNav(S, P, compare) {
    const now = clock(Date.now()), cy = now.year, cm = now.month, ym = (y, m) => isoDate(monthStart(y, m)).slice(0, 7);
    const isDay = S.sel?.kind === 'day';
    const on = (view, m) => !isDay && S.view === view && (view === 'year' ? clock(S.month).year === +m.slice(0, 4) : isoDate(S.month).startsWith(m));
    const opt = (attr, v, lbl, checked) => `<button role="menuitemradio" ${attr}="${v}" aria-checked="${checked}">${lbl}</button>`;
    const menu = [['This month', 'month', ym(cy, cm)], ['Last month', 'month', ym(cy, cm - 1)], ['This year', 'year', cy + '-01'], ['Last year', 'year', cy - 1 + '-01']]
      .map(([l, view, m]) => opt('data-go', `${view}|${m}`, l, on(view, m))).join('')
      + (!compare ? '' : '<hr><h3>Compare to</h3>' + (isDay ? [['prev', 'Same day last week']] : S.view === 'year' ? [['prev', 'Previous year']] : [['prev', 'Previous month'], ['year', 'Same month last year']])
        .concat([['', 'No comparison']]).map(([k, l]) => opt('data-vs', k, l, S.vs === k || (isDay && k === 'prev' && !!S.vs))).join(''))
      + dayPickRow(isDay && S.sel.at);
    return `<div class="nav">
        <button class="icon-btn" data-shift="-1" aria-label="Previous ${isDay ? 'day' : S.view}">‹</button>
        <button class="pick" popovertarget="calRange">${P.period}${P.vsLabel ? `<span class="vs">${P.vsLabel}</span>` : ''}</button>
        <button class="icon-btn" data-shift="1" aria-label="Next ${isDay ? 'day' : S.view}"${P.last ? ' disabled' : ''}>›</button>
      </div>
      <div class="menu" id="calRange" popover role="menu">${menu}</div>`;
  }

  function calendar(params) {
    const TODAY = dayStart(new Date());
    const byDay = SalesMath.groupByDay(state.orders, boZone());
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
        <label>Net sales to aim for each month<input name="month" type="number" min="0" step="1000" inputmode="numeric" autocomplete="off" value="${monthTarget || ''}"></label>
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
    if ('vs' in hit.dataset) return set({ view: p.view, day: p.day || '', vs: hit.dataset.vs });
    if (hit.dataset.shift && S.sel?.kind === 'day') { const day = shiftDays(S.sel.at, +hit.dataset.shift); return set({ month: isoDate(day).slice(0, 7), day: isoDate(day) }); }
    if (hit.dataset.shift) {
      const d = clock(S.month), n = +hit.dataset.shift;
      const m = S.view === 'year' ? monthStart(d.year + n, d.month) : monthStart(d.year, d.month + n);
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
      const day = kind === 'day' ? shiftDays(at, n) : n > 0 ? weekEnd(at) : shiftDays(at, -1), d = clock(day);
      const first = monthStart(d.year, d.month);
      return set({ month: isoDate(first).slice(0, 7), [kind]: isoDate(kind === 'day' ? day : Math.max(first, shiftDays(day, -((d.weekday + 6) % 7)))) });
    }
  }

  // ---------- Items: the Summary's month in charts (sales-items-lab-3.html, owner 2026-09-30) ----------
  // A strip of item facts, then the categories, the top 10 items, what moved and what sells together. Each card
  // picks its view from a dropdown on its band (?cats= ?list= ?moved= ?pairs=): the app's .pick menu, never a
  // native select (owner 2026-09-30). The comparison is the Summary's Compare to (?vs=) in the period menu, shared.
  // Off, the page is plain facts: no Trend, no chips, no Rank, no What moved -- nothing stands in for a comparison.
  // Show all, and the strip's counts, open their own page: ?all=categories|items|new|unsold|pairs.
  const TOP_N = 10;

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

  // The period (the Summary's ?month= / ?view=year), the one before it, and both periods' receipts.
  function itemsWindow(p) {
    const TODAY = dayStart(new Date()), S = calState(p, lastSale()), C = S.sel?.kind === 'day' ? dayCompare(S) : calCompare(S, TODAY);
    const rows = [], prev = [];
    for (const o of state.orders) {
      const t = SalesMath.tsOf(o);
      if (t >= C.a && t < C.b) rows.push(o);
      else if (t >= C.prevA && t < C.prevB) prev.push(o);
    }
    // Same month last year names both with their year: "September 2025" against "September 2026"
    const yr = S.view === 'year', day = S.sel?.kind === 'day';
    const name = (t) => (day ? dayLabel(t) : yr ? String(clock(t).year) : fmt(t, S.vs === 'year' ? { month: 'long', year: 'numeric' } : { month: 'long' }));
    return { S, C, rows, prev, yr, day, today: isoDate(TODAY), end: Math.min(C.b, shiftDays(TODAY, 1)), now:name(C.a), was: S.vs ? name(C.prevA) : '' };
  }

  // One render's data (D) and view (V), held here so the lab's card functions port as they were.
  // ponytail: one Items page renders at a time; pass them in if a second view ever shares this file.
  let D = null, V = null;
  // THE change (SalesMath.change) as a sort and colour key: nothing before but something now ('New') sorts and tints above every rise.
  const chg = (cur, was) => SalesMath.change(cur, was) ?? (cur > 0 ? Infinity : 0);
  const cmpNum = (p, q) => (typeof p === 'string' ? p.localeCompare(q) : (p > q) - (p < q));   // Infinity-safe
  // Every Trend on Items is SalesMath.changeText, the Summary's Top 10 and the Dashboard's text: New, —, 0.0% read quiet.
  const trendTxt = (cur, was) => { const t = SalesMath.changeText(cur, was); return t === '—' ? t : `<span class="${tone(t) || 'new'}">${t}</span>`; };
  // A chip: the percent change (changeText), shares included -- no points chips (owner 2026-10-03); a margin's is backoffice.js marginChip.
  const chipOf = (t) => `<span class="chip ${tone(t) || 'flat'}">${t}</span>`;
  const chip = (cur, was) => chipOf(SalesMath.changeText(cur, was));
  // A hover tip's HTML, escaped once more to ride in a data-tip attribute.
  const tip = (title, rows) => escapeHtml(`<b>${escapeHtml(title)}</b>` + rows.filter(Boolean).map(([l, v]) => `<div>${escapeHtml(l)}<em>${v}</em></div>`).join(''));
  const vsRow = (x) => (V.cmp ? ['vs ' + D.was, SalesMath.changeText(x.rev, x.prev)] : null);
  const ord = (n) => n + (n % 100 - n % 10 === 10 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const allLink = (n, to) => `<a class="link" href="${escapeHtml(itemsHref({ all: to }))}">Show all ${n} →</a>`;
  const toCats = 'data-act="go" data-to="categories"';

  // Every item in the catalogue and every item sold, this period against the one before; the categories that sold;
  // the best day; and the pairs bought together (every receipt ever, not the period: three baskets make a pair).
  function itemsData(W) {
    const a = agg(W.rows), pa = agg(W.prev), prods = new Map(state.products.map(p => [p.id, p]));
    const was = new Map(pa.items.map(r => [r.key, r.netSales])), wasQ = new Map(pa.items.map(r => [r.key, r.unitsSold])), cwas = new Map(pa.cats.map(r => [catKey(r.key), r.netSales]));
    // ck: the one category an item's money counts under (categoryOf); a cut (?ct=) is that category too, so the
    // items it lists add up to the category row that was clicked. salesBeforeTax: what a margin is of (mgText).
    const items = a.items.map(r => ({ key: r.key, name: r.name, brand: r.brand, cat: r.cat, ck: catKey(r.ck), rev: r.netSales, prev: was.get(r.key) || 0, pq: wasQ.get(r.key) || 0,
      profit: r.grossProfit, margin: r.margin, salesBeforeTax: r.salesBeforeTax, qty: r.unitsSold, p: prods.get(r.key), row: r }));
    const seen = new Set(items.map(x => x.key));
    for (const p of state.products) if (!p.archived && !seen.has(p.id)) items.push({ key: p.id, name: p.name, brand: p.brand || '', cat: folderName(categoryOf(p)),
      ck: catKey(categoryOf(p)), rev: 0, prev: was.get(p.id) || 0, pq: wasQ.get(p.id) || 0, profit: 0, margin: 0, salesBeforeTax: 0, qty: 0, p });
    // sold only the period before and archived or deleted now: kept for the before figures (Items sold's chip, Top 10
    // share, What moved), out of "of N" (listed), All items (no row) and Didn't sell (didntSell)
    const listed = items.length, keys = new Set(items.map(x => x.key));
    for (const r of pa.items) if (!keys.has(r.key)) items.push({ key: r.key, name: r.name, brand: r.brand, cat: r.cat, ck: catKey(r.ck),
      rev: 0, prev: r.netSales, pq: r.unitsSold, profit: 0, margin: 0, salesBeforeTax: 0, qty: 0, p: prods.get(r.key) });
    apart(items);
    // Every category that moved money, even one at zero or below, so the rows add up to Net sales
    const cats = a.cats.sort((x, y) => y.netSales - x.netSales).map(r => { const key = catKey(r.key);
      return { key, name: r.name, rev: r.netSales, prev: cwas.get(key) || 0, profit: r.grossProfit, margin: r.margin, salesBeforeTax: r.salesBeforeTax, n: r.itemsSold }; });
    const hour = hourOf(W.rows), days = ladder(W.rows, { by: o => (W.day ? hour(o) : isoDate(o.ts)) }).groups;
    // a day: SalesMath.bestDay, the calendar's Best tag (finished days only); an hour: the most of the day
    const sold = [...days].map(([k, g]) => [k, g.netSales]).filter(d => d[1] > 0);
    const [bk, bv] = (W.day ? sold.reduce((m, d) => (d[1] > m[1] ? d : m), ['', 0]) : SalesMath.bestDay(sold, W.today)) || ['', 0], bt = W.day || bk === '' ? 0 : fromIso(bk);
    const best = bk === '' ? null : [W.day ? hourShort(bk) : W.yr ? fmt(bt, { month: 'short', day: 'numeric' }) : `${fmt(bt, { weekday: 'short' })} ${clock(bt).day}`, bv];
    const label = new Map(items.map(x => [x.key, x.name])), NM = {}, RC = {};
    const pairs = HWPOS_INSIGHTS.basketAffinity(state.orders, { products: state.products, top: Infinity }).products.map(r => {
      NM[r.a] = label.get(r.a) || r.aName; NM[r.b] = label.get(r.b) || r.bName; RC[r.a] = r.countA; RC[r.b] = r.countB;
      // A is the rarer of the two, so the % is how often the rarer one leaves with the other
      const [x, y, of] = r.countA <= r.countB ? [r.a, r.b, r.countA] : [r.b, r.a, r.countB];
      return { a: x, b: y, n: r.count, of, f: r.count / of, pct: pctOf(r.count, of, 0) };
    }).sort((p, q) => q.n - p.n || q.f - p.f).slice(0, 50);   // ponytail: past 50 a pair is a handful of receipts, noise more than a lead
    // The charts draw the top 20. Items joined by pairs fall into groups, roughly the jobs people shop for: biggest first,
    // in each the item with the most pair receipts leads.
    const top = pairs.slice(0, 20), par = {}, f = (x) => (par[x] === x ? x : (par[x] = f(par[x])));
    for (const p of top) { par[p.a] ??= p.a; par[p.b] ??= p.b; par[f(p.a)] = f(p.b); }
    const g = new Map(); for (const x in par) { const r = f(x); (g.get(r) || g.set(r, []).get(r)).push(x); }
    const w = (x) => top.reduce((s, p) => s + (p.a === x || p.b === x ? p.n : 0), 0);
    const groups = [...g.values()].map(xs => xs.sort((p, q) => w(q) - w(p))).sort((p, q) => q.length - p.length || w(q[0]) - w(p[0]));
    return { items, listed, cats, best, pairs, top, groups, nodes: groups.flat(), NM, RC, maxN: Math.max(1, ...top.map(p => p.n)),
      totals: a.totals, ptotals: pa.totals, prevData: pa.totals.orders > 0, now: W.now, was: W.was, unit: W.day ? 'day' : W.yr ? 'year' : 'month' };
  }

  // Didn't sell: a catalogue product (not archived, not a deleted one) with no unit sold this period. An archived
  // product's refund still moves the period's money (All items), but it is not stock sitting still.
  const didntSell = (x) => !(x.qty > 0) && x.p && !x.p.archived;
  // ---- the strip: each count a link to the list behind it
  function strip() {
    // sold = SalesMath.itemsSold's rule (a unit or more); a top-10 share is of the period's Net sales
    const it = D.items, sold = it.filter(x => x.qty > 0), wasSold = it.filter(x => x.pq > 0);
    const top10 = (xs, f, tot) => SalesMath.share([...xs].sort((p, q) => f(q) - f(p)).slice(0, 10).reduce((s, x) => s + f(x), 0), tot);
    const t10 = top10(sold, x => x.rev, D.totals.netSales), t10p = top10(wasSold, x => x.prev, D.ptotals.netSales), mg = D.totals.margin;
    const fresh = sold.filter(x => !(x.pq > 0)).length, dead = it.filter(didntSell).length;
    const cell = (l, v, extra = '', title = '', to = '') => { const inner = `<div class="l">${l}</div><div class="v">${v}${extra}</div>`;
      return to ? `<a href="${escapeHtml(itemsHref({ all: to }))}" title="${title}">${inner}</a>` : `<div title="${title}">${inner}</div>`; };
    // Without the period before there is nothing to be new against, so that tile shows the best day instead.
    return `<section class="card strip">
      ${cell('Items sold', `${sold.length}<small>of ${D.listed}</small>`, V.cmp && wasSold.length ? chip(sold.length, wasSold.length) : '', 'Different items with at least one sale', 'items')}
      ${cell('Top 10 share', pct(t10, D.totals.netSales, 0), V.cmp && D.totals.netSales > 0 && D.ptotals.netSales > 0 ? chip(t10, t10p) : '', 'How much of net sales your 10 best items bring in')}
      ${cell('Margin', pct(mg, D.totals.salesBeforeTax), V.cmp ? marginChip(D.totals, D.ptotals, 'vs ' + D.was) : '')}
      ${V.cmp ? cell('New sellers', fresh, '', `Sold this ${D.unit}, nothing in ${D.was}`, 'new')
        : cell(D.unit === 'day' ? 'Best hour' : 'Best day', D.best ? `${D.best[0]}<small>${pesoK(D.best[1])}</small>` : '—', '', `The ${D.unit === 'day' ? 'hour' : 'day'} with the most sales this ${D.unit}`)}
      ${cell('Didn\'t sell', dead, '', `In the catalogue, no sale this ${D.unit}`, 'unsold')}
    </section>`;
  }

  // ---- categories
  // Share is of the period's Net sales (SalesMath.share). Each sale sits under one category, so they add to 100%.
  const catShare = (c, dp) => pctOf(c.rev, D.totals.netSales, dp);
  // A chart can't draw a slice at zero or below: those categories stay in the table, out of the donut and map.
  const drawn = () => D.cats.filter(c => c.rev > 0);
  // The donut's and the map's one Other slice: the categories past the top, their money added to the centavo (round2).
  const otherOf = (rest, name) => ({ key: '', name, rev: money(rest.reduce((s, c) => s + c.rev, 0)), prev: money(rest.reduce((s, c) => s + c.prev, 0)), other: true });
  const catTip = (c) => tip(c.name, [['Net sales', pesoShort(c.rev)], ['Share', catShare(c)], ['Gross profit', pesoShort(c.profit)], vsRow(c), ['Items sold', c.n]]);
  const catName = (k) => (D.cats.find(c => c.key === k) || {}).name || k;
  const cutBtn = () => (V.ct ? `<button class="cut" data-act="uncut">${escapeHtml(catName(V.ct))} ✕</button>` : '');
  const ctAttr = (c) => `tabindex="0" data-ct="${escapeHtml(c.key)}"`;

  function catTable(full) {
    const list = D.cats, lead = Math.max(1, list[0].rev), shown = full ? list : list.slice(0, 5);
    return `<section class="card"><table class="ct"><thead><tr><th>Category</th><th class="n">Net sales</th><th class="n">Share</th><th class="n">Gross profit</th>${V.cmp ? '<th class="n">Trend</th>' : ''}</tr></thead><tbody>
      ${shown.map(c => `<tr ${ctAttr(c)}${c.key === V.ct ? ' class="on"' : ''} data-tip="${catTip(c)}"><td>${escapeHtml(c.name)}</td><td class="n"><span class="ib"><i style="width:${Math.max(0, c.rev) / lead * 100}%"></i></span><b>${pesoShort(c.rev)}</b></td>`
        + `<td class="n">${catShare(c)}</td><td class="n">${pesoShort(c.profit)}</td>${V.cmp ? `<td class="n">${trendTxt(c.rev, c.prev)}</td>` : ''}</tr>`).join('')}
      </tbody></table>${full ? '' : `<div class="foot">${allLink(D.cats.length, 'categories')}</div>`}</section>`;
  }

  // Donut: five slices and Other, whatever the store -- 7 categories or 60 look the same.
  function catDonut() {
    const list = drawn(), tot = list.reduce((s, c) => s + c.rev, 0), top = list.slice(0, 5), rest = list.slice(5);
    const other = rest.length ? otherOf(rest, `Other · ${rest.length} categories`) : null;
    const parts = [...top, ...(other ? [other] : [])], col = (i, p) => (p.other ? 'var(--s-other)' : `var(--s${i + 1})`);
    const R = 86, r0 = 58, cx = 100, cy = 100; let a = -Math.PI / 2;
    const arc = (a0, a1) => { const L = a1 - a0 > Math.PI ? 1 : 0, pt = (rr, t) => `${(cx + rr * Math.cos(t)).toFixed(2)},${(cy + rr * Math.sin(t)).toFixed(2)}`;
      return `M${pt(R, a0)}A${R},${R} 0 ${L} 1 ${pt(R, a1)}L${pt(r0, a1)}A${r0},${r0} 0 ${L} 0 ${pt(r0, a0)}Z`; };
    const paths = parts.map((p, i) => { const a1 = a + p.rev / tot * Math.PI * 2, d = arc(a, Math.min(a1, a + Math.PI * 2 - 1e-4)); a = a1;
      return `<path d="${d}" fill="${col(i, p)}" data-i="${i}" ${p.other ? toCats : `data-ct="${escapeHtml(p.key)}"`} data-tip="${p.other ? tip(p.name, [['Net sales', pesoShort(p.rev)], ['Share', catShare(p)]]) : catTip(p)}"${V.ct && p.key === V.ct ? ' class="hot"' : ''}/>`; }).join('');
    const rows = parts.map((p, i) => `<tr data-i="${i}" ${p.other ? `class="other" tabindex="0" ${toCats}` : `${ctAttr(p)}${p.key === V.ct ? ' class="on"' : ''}`}><td><i class="sw" style="background:${col(i, p)}"></i></td><td>${escapeHtml(p.name)}</td>`
      + `<td class="n"><b>${pesoShort(p.rev)}</b></td><td class="n">${catShare(p)}</td>${V.cmp ? `<td class="n">${trendTxt(p.rev, p.prev)}</td>` : ''}</tr>`).join('');
    return `<section class="card"><div class="band">Categories<span class="r">Share of net sales</span></div><div class="donut${V.ct ? ' hl' : ''}"><div class="pie"><svg width="200" height="200" viewBox="0 0 200 200">${paths}</svg>
        <div class="mid"><b>${pesoK(D.totals.netSales)}</b></div></div>
      <table><thead><tr><th></th><th>Category</th><th class="n">Net sales</th><th class="n">Share</th>${V.cmp ? '<th class="n">Trend</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="foot">${allLink(D.cats.length, 'categories')}</div></section>`;
  }

  // Map: size is net sales; colour the change on the period before, or with the comparison off the margin, one hue.
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
    const list = drawn(), top = list.slice(0, N), rest = list.slice(N);
    const parts = rest.length ? [...top, otherOf(rest, `Other · ${rest.length}`)] : top;
    const H = phone ? 520 : 440, g = 3, rects = squarify(parts.map(p => p.rev), 0, 0, W, H);
    const ms = parts.filter(p => !p.other).map(p => p.margin), m0 = Math.min(...ms), m1 = Math.max(...ms);
    const tint = (p) => { if (p.other) return '#F3F3F3'; if (!V.cmp) return `color-mix(in srgb, var(--b-data-1) ${Math.round(15 + (p.margin - m0) / (m1 - m0 || 1) * 85)}%, #F7F7F7)`;
      const c = chg(p.rev, p.prev); if (c === Infinity) return 'var(--b-data-tint)';
      const k = Math.min(1, Math.abs(c) / .4); return `color-mix(in srgb, ${c >= 0 ? '#9FD6B9' : '#F2B4A5'} ${Math.round(20 + k * 80)}%, #F3F3F3)`; };
    const tiles = parts.map((p, i) => { const q = rects[i], sz = q.w < 90 || q.h < 58 ? (q.w < 60 || q.h < 30 ? 'xs' : 'sm') : '';
      return `<button class="${sz}${p.key && p.key === V.ct ? ' on' : ''}" style="left:${q.x / W * 100}%;top:${q.y}px;width:calc(${q.w / W * 100}% - ${g}px);height:${q.h - g}px;background:${tint(p)}" ${p.other ? toCats : `data-ct="${escapeHtml(p.key)}"`} data-tip="${p.other ? tip(p.name + ' categories', [['Net sales', pesoShort(p.rev)], ['Share', catShare(p)]]) : catTip(p)}">`
        + `<b>${escapeHtml(p.name)}</b><span>${pesoK(p.rev)} · ${catShare(p, 0)}</span><em>${V.cmp ? trendTxt(p.rev, p.prev) : p.other ? '' : mgText(p, 0) + ' margin'}</em></button>`; }).join('');
    return `<section class="card"><div class="band">Categories<span class="r"><span>Size = net sales</span>${V.cmp ? `<span class="scale">Down<i></i>Up vs ${D.was}</span>` : '<span class="scale m">Thin<i></i>Better margin</span>'}</span></div>
      <div class="tmap" style="height:${H}px">${tiles}</div><div class="foot">${allLink(D.cats.length, 'categories')}</div></section>`;
  }

  // Bars, shared by categories and items: one pesos axis, net sales the light bar and gross profit the deep part inside it.
  function barsCard(title, head, list, nameOf, tipOf, attrOf, foot) {
    const lead = Math.max(1, list[0]?.rev || 0), w = (v) => Math.max(0, v) / lead * 100;
    const rows = list.map((x, i) => `<div class="row${x.key && x.key === V.ct ? ' on' : ''}" ${attrOf(x)} data-tip="${tipOf(x)}"><span class="rk">${i + 1}</span><span class="nm">${nameOf(x)}</span>`
      + `<span class="trk"><i class="rev" style="width:${w(x.rev)}%"></i><i class="pf" style="width:${w(x.profit)}%"></i></span>`
      + `<span class="n v">${pesoShort(x.rev)}</span><span class="n">${mgText(x)}</span>${V.cmp ? `<span class="n">${trendTxt(x.rev, x.prev)}</span>` : ''}</div>`).join('');
    return `<section class="card bars${V.cmp ? '' : ' flat'}"><div class="band">${title}<span class="r"><span class="key"><i style="background:var(--b-data)"></i>Gross profit</span><span class="key"><i style="background:var(--b-data-1)"></i>Net sales</span></span></div>
      <div class="row hd"><span></span><span>${head}</span><span></span><span class="n">Net sales</span><span class="n">Margin</span>${V.cmp ? '<span class="n">Trend</span>' : ''}</div>${rows}
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
      return `<g data-ct="${escapeHtml(c.key)}" data-tip="${tip(c.name, [...cols.map(([l], j) => ['Rank, ' + l, rs[j] === Infinity ? '—' : rs[j]]), ['Net sales', pesoShort(c.rev)], vsRow(c)])}">`
        + `<path class="ln ${k}" d="${d}" fill="none"/><path class="hit" d="${d}" fill="none"/><circle class="was" cx="${xl}" cy="${y(a)}" r="4"/><circle class="${k === 'same' ? 'was' : k}" cx="${xr}" cy="${y(b)}" r="5"/>`
        + `<text x="${xr + 14}" y="${y(b) + 4}">${b}. ${escapeHtml(c.name)} <tspan class="muted">${pesoK(c.rev)}${was ? ' · ' + escapeHtml(was) : ''}</tspan></text></g>`; }).join('');
    return `<section class="card slope rank"><div class="band">Top 10 categories<span class="r">Where each ranked in ${escapeHtml(D.was)}, and where it ranks now</span></div>
      <div class="pad"><svg viewBox="0 0 ${W} ${H}">${g}</svg></div><div class="foot">${allLink(D.cats.length, 'categories')}</div></section>`;
  }

  // ---- items
  const inCut = () => D.items.filter(x => x.row && (!V.ct || x.ck === V.ct));   // every item the period touched, net at zero or below too: the rows add up to Net sales
  const itemTip = (x) => tip(x.name, [['Net sales', pesoShort(x.rev)], ['Gross profit', pesoShort(x.profit)], ['Margin', mgText(x)], ['Units sold', qtyText(x.qty)], vsRow(x)]);
  const hit = (x) => !V.q || (x.name + ' ' + x.cat).toLowerCase().includes(V.q.toLowerCase());
  const search = () => `<div class="filters"><input class="q-input search" type="search" placeholder="Search items" value="${escapeHtml(V.q)}" autocomplete="off" aria-label="Search items"></div>`;
  const ITEM_K = { name: x => x.name, qty: x => x.qty, revenue: x => x.rev, profit: x => x.profit, margin: x => x.margin, trend: x => chg(x.rev, x.prev) };

  // The table, sortable (?sort= ?dir=). On its own page (full) it is searched and paged, 50 rows a page.
  // The table's rows in its order; the CSV exports this same list.
  const tableRows = (full, rows = inCut()) => { const s = V.sort, m = s.dir === 'asc' ? 1 : -1;
    return rows.filter(x => !full || hit(x)).sort((p, q) => cmpNum(ITEM_K[s.key](p), ITEM_K[s.key](q)) * m); };
  function itemTable(full, rows = inCut()) {
    const s = V.sort, K = ITEM_K;
    const all = tableRows(full, rows);
    // the Top 10 card ranks only what sold a unit or more; Show all lists the rest
    const pg = full ? paginate(all, V.page) : null, shown = full ? pg.rows : all.filter(x => x.qty > 0).slice(0, TOP_N);
    const bk = ['qty', 'revenue', 'profit'].includes(s.key) ? s.key : 'revenue', lead = all.reduce((mx, x) => Math.max(mx, K[bk](x)), 1);
    const th = (k, l, n) => `<th class="${n ? 'n' : ''}" tabindex="0" data-act="sort" data-key="${k}"${s.key === k ? ` aria-sort="${s.dir}ending"` : ''}>${l}${s.key === k ? (s.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
    const cell = (k, txt, x) => `<td class="n">${k === bk ? `<span class="ib"><i style="width:${Math.max(0, K[k](x)) / lead * 100}%"></i></span>` : ''}${k === 'revenue' ? `<b>${txt}</b>` : txt}</td>`;
    const foot = full ? '' : all.length > shown.length ? allLink(all.length, 'items') : '';
    const body = shown.length ? shown.map(x => `<tr data-tip="${itemTip(x)}"><td class="nm">${escapeHtml(x.name)}${V.ct ? '' : `<small>${escapeHtml(x.cat)}</small>`}</td>${cell('qty', qtyText(x.qty), x)}`
      + `${cell('revenue', pesoShort(x.rev), x)}${cell('profit', pesoShort(x.profit), x)}<td class="n">${mgText(x)}</td>${V.cmp ? `<td class="n">${trendTxt(x.rev, x.prev)}</td>` : ''}</tr>`).join('')
      : `<tr><td colspan="6" class="empty">${V.q ? `No item matches “${escapeHtml(V.q)}”.` : 'Nothing here this period.'}</td></tr>`;
    return `<section class="card">${full ? '' : `<div class="band">Top 10 items ${cutBtn()}</div>`}<table class="it"><thead><tr>${th('name', 'Item')}${th('qty', 'Units sold', 1)}${th('revenue', 'Net sales', 1)}${th('profit', 'Gross profit', 1)}${th('margin', 'Margin', 1)}${V.cmp ? th('trend', 'Trend', 1) : ''}</tr></thead><tbody>
      ${body}</tbody></table>${full ? pagerHtml(pg) : foot ? `<div class="foot">${foot}</div>` : ''}</section>`;
  }
  function itemBars() {
    const all = inCut().sort((p, q) => q.rev - p.rev);
    return barsCard(`Top 10 items ${cutBtn()}`, 'Item', all.filter(x => x.qty > 0).slice(0, TOP_N), x => escapeHtml(x.name) + (V.ct ? '' : `<small> ${escapeHtml(x.cat)}</small>`), itemTip, () => '', allLink(all.length, 'items'));
  }

  // ---- what moved: this period against the one before, so it only shows while the comparison is on
  function movers() {
    const A = D.was, B = D.now, d = D.items.map(x => ({ ...x, d: money(x.rev - x.prev) }));
    const up = d.filter(x => x.d >= 1).sort((p, q) => q.d - p.d).slice(0, 5), dn = d.filter(x => x.d <= -1).sort((p, q) => p.d - q.d).slice(0, 5);
    if (!up.length && !dn.length) return `<section class="card"><div class="band">What moved</div><p class="empty">Nothing sold more or less than in ${escapeHtml(A)}.</p></section>`;
    const c = (x) => SalesMath.changeText(x.rev, x.prev);
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
  const pairTip = (p) => tip(D.NM[p.a] + ' → ' + D.NM[p.b], [['Together', p.n + ' orders'], ['Orders with ' + D.NM[p.a], p.of], ['How often', p.pct]]);
  const nodeTip = (x) => tip(D.NM[x], [['Orders', D.RC[x]], ['Bought with', D.top.filter(p => p.a === x || p.b === x).length + ' items']]);
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
    const pctL = ps.map(p => { const [x1, y1] = pos[p.a], [x2, y2] = pos[p.b]; return `<text class="el" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 + 4}" text-anchor="middle" data-hk="p${D.top.indexOf(p)}">${p.pct}</text>`; }).join('');
    const nodes = Object.entries(pos).map(([x, [cx, cy]]) => { const t = tops.has(x);
      return `<g data-hk="${nodeHk(x)}" data-tip="${nodeTip(x)}"><circle cx="${cx}" cy="${cy}" r="${rad(x)}"/><text class="nl${hubs.has(x) ? ' hb' : ''}" x="${cx}" y="${t ? cy - rad(x) - 7 : cy + rad(x) + 14}" text-anchor="middle">${escapeHtml(D.NM[x])}</text></g>`; }).join('');
    return `<section class="card"><div class="band">Bought together<span class="r">Dot = an item, sized by orders · Line = bought together</span></div>
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
      + `<td class="n"><span class="ib"><i style="width:${p.f * 100}%"></i></span>${p.pct} of the time</td><td class="n muted">${p.n} of ${p.of} orders</td></tr>`).join('')}</tbody></table>${foot ? `<div class="foot">${foot}</div>` : ''}`;
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
    // every item the period touched; the strip's Items sold counts only those that sold a unit, so say both when they differ
    items: () => { const n = inCut().length, s = inCut().filter(x => x.qty > 0).length;
      return ['All items', V.ct ? cutBtn() : n === s ? `${n}` : `${n} · ${s} sold`, search() + itemTable(true)]; },
    new: () => { const xs = D.items.filter(x => x.qty > 0 && !(x.pq > 0)); return ['New sellers', `${xs.length} · sold in ${escapeHtml(D.now)}, nothing in ${escapeHtml(D.was)}`, search() + itemTable(true, xs)]; },
    unsold: () => {
      // What didn't sell, and the stock it leaves on the shelf. With the comparison on, what sold in the period before
      // comes first: those are the ones that stopped selling.
      // Stock value is bo-model's stockValueOf, per row and for the total, so the rows add up to it.
      const xs = D.items.filter(didntSell).map(x => ({ ...x, onHand: Number(x.p.stock) || 0, val: stockValueOf([x.p]) }))
        .sort((p, q) => (V.cmp ? q.prev - p.prev : 0) || q.val - p.val);
      const tied = stockValueOf(xs.map(x => x.p)), found = xs.filter(hit), pg = paginate(found, V.page);
      const trs = pg.rows.map(x => `<tr><td class="nm">${escapeHtml(x.name)}<small>${escapeHtml(x.cat)}</small></td><td class="n">${qtyText(x.onHand)}</td><td class="n">${pesoShort(x.val)}</td>`
        + `${V.cmp ? `<td class="n">${x.prev > 0 ? pesoShort(x.prev) : '<span class="new">—</span>'}</td>` : ''}</tr>`).join('')
        || `<tr><td colspan="4" class="empty">${V.q ? `No item matches “${escapeHtml(V.q)}”.` : `Everything sold this ${D.unit}.`}</td></tr>`;
      return ['Didn\'t sell', `${xs.length} · ${pesoShort(tied)} of stock sitting still`, search() + `<section class="card"><table class="us"><thead><tr><th>Item</th><th class="n">In stock</th><th class="n">Stock value</th>`
        + `${V.cmp ? `<th class="n">Sold in ${escapeHtml(D.was)}</th>` : ''}</tr></thead><tbody>${trs}</tbody></table>${pagerHtml(pg)}</section>`];
    },
    pairs: () => ['Bought together', `${D.pairs.length} pairs · every order, not only this ${D.unit}`, D.pairs.length ? `<section class="card pairs">${pairsTable(D.pairs)}</section>` : pairs()],
  };

  // Sets D and V for one render (or the CSV) and returns the window.
  function itemsView(p, v) {
    const W = itemsWindow(p);
    D = itemsData(W);
    V = { ...v, cmp: v.cmp && D.prevData, ct: D.cats.some(c => c.key === v.ct) ? v.ct : '' };
    if (!V.cmp) { if (V.cats === 'rank') V.cats = 'donut'; if (V.sort.key === 'trend') V.sort = { key: 'revenue', dir: 'desc' }; }
    // Nothing to draw (only voids, or every category at zero or below): the donut and map have no slice, so Bars,
    // and the view picker says so.
    if (!drawn().length && (V.cats === 'donut' || V.cats === 'map')) V.cats = 'bars';
    return W;
  }
  function itemsPage(p, v) {
    const W = itemsView(p, v), { S, C } = W;
    // The Summary's period menu, Compare to and all: one comparison for both tabs.
    const P = { period: W.yr || W.day ? W.now : fmt(C.a, { month: 'long', year: 'numeric' }), vsLabel: C.label, last: C.b > dayStart(new Date()) };
    const tools = `<button class="btn" data-act="export">${DOWNLOAD_ICON}Export CSV</button>${periodNav(S, P, true)}`;
    const page = PAGES[V.all];
    let head, body;
    if (page) {
      const [title, meta, html] = page();
      head = `<h1><a class="crumb" href="${escapeHtml(backToItems())}">Items</a><span class="sl">›</span>${title}${meta ? `<small>${meta}</small>` : ''}</h1>${tools}`;
      body = html;
    } else {
      const cards = D.cats.some(c => c.rev)
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
  window.renderSales.tops = tops;
  window.renderSales.topItems = topItems;
  window.renderSales.calCompare = calCompare;
  window.renderSales.calState = calState;
  window.renderSales.taxRows = taxRows;

  // ---------- CSV: Items' table, whole -- every item in the period (the picked category's), in its sort ----------
  function exportCsv() {
    const W = itemsView(Router.route().params, readView());
    const data = tableRows(false).map(x => ({ ...x.row, name: x.name }));
    const name = `sales-by-item-${isoDate(W.C.a).slice(0, W.day ? 10 : W.yr ? 4 : 7)}.csv`;
    downloadCsv(name, [COLUMNS.map(c => c.label)].concat(data.map(r => COLUMNS.map(c => c.csv(r)))));
    showToast(`Exported ${plural(data.length, 'row')}`);
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
    if (act === 'uncut') { Router.setParams({ ct: '', page: '' }); return; }
    if (act === 'go') { Router.setParams({ all: hit.dataset.to, page: '' }, { replace: false }); return; }
    if (act === 'sort') {
      const key = hit.dataset.key, cur = readView().sort;
      // Re-sorting deals the rows again, so page 3 of the old order means nothing. Names start A-Z, figures high first.
      const dir = cur.key === key ? (cur.dir === 'desc' ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc';
      Router.setParams({ sort: key, dir, page: '' });
    }
  });

  // Pick a day (dayPickRow): the Summary opens that day's pop-up; Items shows that one day.
  document.addEventListener('change', (e) => {
    const el = root(), t = e.target;
    if (!el || !el.contains(t) || !t.matches('[data-day-pick]') || !t.value) return;
    t.closest('[popover]').hidePopover();
    Router.setParams({ view: '', month: t.value.slice(0, 7), day: t.value, week: '', page: '' }, { replace: false });
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
    if (el.querySelector('.shell.open')) Router.setParams({ day: '', week: '' });   // on Items ?day= is the window, not a pop-up
  });
})();
