// Lab copy only (backoffice-shopify.html): markup changes the shared modules can't take without
// changing the real back office. Each one re-applies after every render (owner 2026-10-19).
(function () {
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ‹ Customers / Name: the older "← Back" links (Customer, Stock history's full pages, Staff) become the path, like Categories.
  function crumbs() {
    document.querySelectorAll('.view-title-wrap .link-btn:not(.item-back)').forEach(function (a) {
      var t = a.textContent.trim();
      if (t.charAt(0) !== '←') return;
      a.textContent = t.slice(1).trim().replace(/^All /, '').replace(/^\w/, function (c) { return c.toUpperCase(); });
      a.classList.add('item-back');
    });
  }

  // Stock history's Movements / Price changes: search and picks leave the title row for Items' floating bar.
  // bo-inventory.js listens on document by id, so the moved controls keep working.
  function stockBar() {
    var q = document.querySelector('.view-inv .view-head #invSearch');
    if (!q) return;
    var head = q.closest('.view-head'), bar = document.createElement('div');
    bar.className = 'list-filters';
    head.querySelectorAll('#invSearch, .bo-select, .bo-date').forEach(function (el) { bar.appendChild(el); });
    head.after(bar);
  }

  // A supplier's contact details: one Items-style table instead of two loose lines under the name.
  function supplierInfo() {
    var c = document.querySelector('.view-suppliers .sup-contact');
    if (!c || c.querySelector('.link-btn')) return;   // the empty state keeps its "Add them"
    var id = (location.hash.match(/^#\/suppliers\/([^/?]+)/) || [])[1];
    var s = id && loadSuppliers().find(function (x) { return x.id === id; });
    if (!s) return;
    var cell = function (v, html) { return v ? (html || esc(v)) : '<span class="muted">—</span>'; };
    var t = document.createElement('section');
    t.className = 'bo-card blk-table sup-info';
    t.innerHTML = '<div class="bo-card-head"><span class="bo-card-label">Contact</span></div>' +
      '<div class="bo-card-inset flush"><table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Notes</th></tr></thead>' +
      '<tbody><tr><td>' + cell(s.contact) + '</td>' +
      '<td>' + cell(s.phone, s.phone && '<a href="tel:' + esc(s.phone.replace(/\s+/g, '')) + '">' + esc(s.phone) + '</a>') + '</td>' +
      '<td>' + cell(s.email, s.email && '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>') + '</td>' +
      '<td>' + cell(s.address) + '</td><td>' + cell(s.note) + '</td></tr></tbody></table></div>';
    c.replaceWith(t);
  }

  // Pages with a view switch (Sales, Orders, Items): the page's name first, the switch beside it (owner 2026-10-19).
  // The name is the sidebar's, so the two always match.
  function switchTitle() {
    var seg = document.querySelector('.view.active .pd-switch'), nav = document.querySelector('.side-link.active');
    if (!seg || !nav || seg.previousElementSibling) return;
    var h = document.createElement('h1');
    h.textContent = nav.textContent.trim();
    seg.before(h);
  }
  // Customers and Suppliers: List | Breakdown like Orders. Their Breakdown cards are customersBreakdown / suppliersBreakdown below.
  // Customers keeps one header for list and record, so the switch comes off on a customer's page.
  function breakdownSwitch() {
    ['customers', 'suppliers'].forEach(function (name) {
      var v = document.querySelector('.view-' + name + '.active'), m = location.hash.match('^#/' + name + '(\\?.*)?$');
      if (!v) return;
      var seg = v.querySelector('.copy-switch'), bd = !!m && /[?&]view=breakdown\b/.test(m[1] || '');
      v.classList.toggle('is-breakdown', bd);
      if (!m) { if (seg) seg.remove(); return; }
      if (!seg) {
        var h = v.querySelector('.view-head .view-title-wrap h1');
        if (!h) return;
        seg = document.createElement('div');
        seg.className = 'seg pd-switch copy-switch';
        seg.setAttribute('aria-label', h.textContent.trim() + ' view');
        seg.innerHTML = '<a class="seg-btn" href="#/' + name + '">List</a><a class="seg-btn" href="#/' + name + '?view=breakdown">Breakdown</a>';
        h.after(seg);
      }
      seg.children[0].classList.toggle('active', !bd);
      seg.children[1].classList.toggle('active', bd);
      // The breakdown's cards sit in the Orders breakdown's frame (calm-tx view-tx), built once per visit.
      var old = v.querySelector('.copy-bd');
      if (!bd) { if (old) old.remove(); return; }
      var head = v.querySelector('.view-head');
      if (old || !head) return;
      head.insertAdjacentHTML('afterend', '<div class="copy-bd calm-tx view-tx"><div class="rail bd ob">' + (name === 'customers' ? customersBreakdown() : suppliersBreakdown()) + '</div></div>');
    });
  }
  // Customers › Breakdown (owner 2026-10-20): where the credit money is. All time, every customer.
  function customersBreakdown() {
    var cs = allCustomerRecords(), pool = creditPool(cs), byId = new Map(cs.map(function (c) { return [c.id, c]; })), html = '';
    var nameOf = function (id) { return (byId.get(id) || {}).name || 'Unnamed'; };
    // Credit pool: every customer's credit limit added up; what is owed on those accounts against what is left (the list's Utilization).
    // Round 8 tried a donut; the owner kept the line ("the line one was better"), with plainer words.
    var left = Math.max(0, pool.limit - pool.used);
    html += card('pool', 'Credit pool', pool.over ? pill('bad', SalesMath.plural(pool.over, 'customer') + ' over limit') : '', pool.limit
      ? '<div class="ob-split"><div class="ob-lead"><p><b>' + pctOf(pool.used, pool.limit, 0) + '</b> of all credit limits is owed</p>' + split([[pool.used, 4], [left, 7]]) + '</div><div class="rows">' +
        row(pill(4, 'Owed'), peso(pool.used), pctOf(pool.used, pool.limit, 0)) + row(pill(7, 'Still available'), peso(left), pctOf(left, pool.limit, 0)) +
        row('All credit limits', peso(pool.limit), '', 'tot') + '</div></div>' : '<p class="note ob-none">No customer has a credit limit yet.</p>');
    // Nearly full (owner round 7: full width, every account using credit): fullest first, a bar each, red past the limit
    // and amber near it (accountStatus' words). Seven rows tall; more scroll inside, so the card never grows.
    // Then what (owner round 8): collect - each row's Record payment opens the customer page's own payment dialog here.
    var full = cs.filter(function (c) { return c.creditOn && +c.creditLimit > 0 && c.currentBalance > 0; })
      .sort(function (a, b) { return b.currentBalance / b.creditLimit - a.currentBalance / a.creditLimit; });
    var tone = { 'Over limit': 'bad', 'Near limit': 'warn' }, toneOf = function (c) { return tone[accountStatus(c)[1]]; };
    var near = full.filter(function (c) { return toneOf(c) === 'warn'; }).length;
    html += card('full', 'Nearly full', (pool.over ? pill('bad', pool.over + ' over') : '') + (near ? pill('warn', near + ' near') : ''), slots(full.map(function (c) {
      return '<div class="row" data-cust="' + esc(c.id) + '"><span class="nm">' + esc(c.name) + '</span>' + meter([[Math.min(c.currentBalance, c.creditLimit), toneOf(c) || 4]], c.creditLimit) +
        '<span class="cnt">' + pctOf(c.currentBalance, c.creditLimit, 0) + '</span><span class="amt">' + pesoShort(c.currentBalance) + ' of ' + pesoShort(c.creditLimit) + '</span>' +
        '<button class="secondary-btn small" data-pay="' + esc(c.id) + '">Record payment</button></div>'; }).join('') || '<p class="note ob-none">No account is using its credit.</p>'));
    // Most orders: who comes back most (the list's Orders column), the top seven, share of every customer order.
    var orders = new Map();
    customerTotalsMap().forEach(function (g, id) { if (byId.has(id)) orders.set(id, g.orders); });
    html += card('most', 'Most orders', '', board(orders, nameOf, function (x) { return SalesMath.plural(x, 'order'); }, 'data-cust'));
    // Coming back (round 8, a funnel): every customer → bought once → came back → regulars (10+ orders). One tint: it is one group narrowing.
    var steps = [['All customers', cs.length], ['Bought', 1], ['Came back · 2+', 2], ['Regulars · 10+', 10]].map(function (s, i) {
      return i ? [s[0], Array.from(orders.values()).filter(function (x) { return x >= s[1]; }).length] : s; });
    html += card('back', 'Coming back', '', cs.length ? slots(steps.map(function (s) {
      return row(s[0], SalesMath.qtyText(s[1]), pctOf(s[1], cs.length, 0), '', '<span class="ob-fn"><i style="width:' + (s[1] / cs.length * 100) + '%"></i></span>'); }).join('')) : slots(''));
    // Paid and owed: every peso put on account, paid back or still owed, as one line like Credit pool (round 8's sankey
    // went back with the donut - the owner reads the line). Money held for a customer is not on account, so it is its own row.
    var led = loadCustomerLedger(), undone = undoneIds(led), held = 0, paid = 0;
    led.forEach(function (r) { if (r.type === 'payment' && !undone.has(r.id)) paid += cent(r.amount); });
    cs.forEach(function (c) { if (c.currentBalance < 0) held -= cent(c.currentBalance); });
    paid = unc(paid); held = unc(held);
    var whole = paid + pool.owed;
    html += card('acct', 'Paid and owed', 'All time', whole ? '<div class="ob-split"><div class="ob-lead"><p><b>' + pctOf(paid, whole, 0) + '</b> of what went on account is paid back</p>' +
      split([[paid, 3], [pool.owed, 4]]) + '</div><div class="rows">' + row(pill(3, 'Paid back'), peso(paid), pctOf(paid, whole, 0)) + row(pill(4, 'Still owed'), peso(pool.owed), pctOf(pool.owed, whole, 0)) +
      (held ? row('Held for customers', peso(held), '') : '') + '</div></div>' : '<p class="note ob-none">No sales on account yet.</p>');
    return html;
  }
  // Suppliers › Breakdown (owner 2026-10-20): who matters most. Live suppliers only; an item two suppliers sell counts
  // under both, as on the list. Bought = what arrived, at the billed cost, else the quote.
  function suppliersBreakdown() {
    var sups = loadSuppliers().filter(function (s) { return !s.archived; }), name = new Map(sups.map(function (s) { return [s.id, s.name || 'Unnamed']; }));
    var nameOf = function (id) { return name.get(id); }, items = new Map(), out = new Map(), low = new Map(), members = new Map(), bought = new Map(), value = new Map();
    var fam = familyItems(), add = function (m, k) { m.set(k, (m.get(k) || 0) + 1); };
    // ponytail: out = every tracked variant at 0, else low = one at its reorder point; the Items page's level filter (familyLevel) can differ on a mixed family.
    var isOut = function (ms) { ms = ms.filter(function (m) { return !m.archived && m.trackStock !== false; }); return ms.length && ms.every(function (m) { return Number(m.stock) <= 0; }); };
    fam.forEach(function (it) {
      new Set([].concat.apply([], it.members.map(supplierIdsOf))).forEach(function (k) {
        if (!name.has(k)) return;
        var ms = it.members.filter(function (m) { return supplierIdsOf(m).includes(k); });
        add(items, k);
        if (isOut(ms)) add(out, k); else if (ms.some(isLow)) add(low, k);
        members.set(k, (members.get(k) || []).concat(ms));
      });
    });
    members.forEach(function (ms, k) { value.set(k, stockValueOf(ms)); });
    // Bought: what arrived at its billed cost (lineInCents) plus what is still to come on a sent list at the quote (poOpenValue), per supplier.
    var coming = new Map(), put = function (m, k, c) { if (c) m.set(k, (m.get(k) || 0) + c); };
    loadPurchaseOrders().forEach(function (po) { (po.items || []).forEach(function (l) {
      var k = lineSupplier(po, l);
      if (!name.has(k)) return;
      put(bought, k, lineInCents(l));
      put(coming, k, cent(poOpenValue(Object.assign({}, po, { items: [l] }))));
    }); });
    bought.forEach(function (c, k) { bought.set(k, unc(c)); });
    coming.forEach(function (c, k) { coming.set(k, unc(c)); });
    var money = function (x) { return pesoShort(x); }, item = function (x) { return SalesMath.plural(x, 'item'); };
    // Totals are the store's own (stock at cost, every item), so an item two suppliers sell is counted once there.
    var held = stockValueOf([].concat.apply([], fam.map(function (it) { return it.members; })));
    // Low or out of stock: the counts per supplier in the void/refund pills over one red-then-amber bar; a row opens Items › Stock filtered to it.
    // Then what (owner round 8): Reorder = Suppliers' own New purchase order (data-act="new-po", bo-suppliers.js), filled with that supplier's out and low items.
    var short = ranked(new Map(Array.from(name.keys()).map(function (k) { return [k, (out.get(k) || 0) + (low.get(k) || 0)]; }))).filter(function (x) { return x[1]; });
    var n = function (m, k, tone) { var c = m.get(k) || 0; return c ? pill(tone, String(c)) : ''; };
    // Bought from most (round 8, a sankey): every peso on a list → arrived or still to come → the top five suppliers and the rest.
    // Suppliers get no colour of their own (grey bars); a band keeps arrived's or to-come's tint.
    var spend = new Map(); bought.forEach(function (x, k) { spend.set(k, x); }); coming.forEach(function (x, k) { spend.set(k, (spend.get(k) || 0) + x); });
    var top5 = ranked(spend).filter(function (x) { return x[1] > 0; }).slice(0, 5).map(function (x) { return x[0]; }), who = function (k) { return top5.includes(k) ? k : 'rest'; };
    var flow = new Map(), links = [];
    [[bought, 'in', 3], [coming, 'out', 4]].forEach(function (s) {
      var by = new Map(); s[0].forEach(function (x, k) { by.set(who(k), (by.get(who(k)) || 0) + x); flow.set(who(k), (flow.get(who(k)) || 0) + x); });
      top5.concat('rest').forEach(function (k) { if (by.get(k)) links.push([s[1], 's' + k, by.get(k), s[2]]); });
    });
    var inAll = sum(bought), outAll = sum(coming);
    return card('buy', 'Bought from most', inAll + outAll ? pesoShort(inAll + outAll) + ' · All time' : 'All time', inAll + outAll ? sankey([[{ key: 'all', name: 'Bought', n: inAll + outAll, k: 7 }],
      [{ key: 'in', name: 'Arrived', n: inAll, k: 3 }, { key: 'out', name: 'Still to come', n: outAll, k: 4 }].filter(function (d) { return d.n; }),
      top5.concat('rest').filter(function (k) { return flow.get(k); }).map(function (k) { return { key: 's' + k, name: k === 'rest' ? 'Other suppliers' : nameOf(k), n: flow.get(k), k: 7 }; })],
      [['all', 'in', inAll, 3], ['all', 'out', outAll, 4]].concat(links), money) : '<p class="note ob-none">Nothing bought yet.</p>') +
      card('val', 'Stock held', 'At cost', board(value, nameOf, money, 'data-go', held)) +
      card('items', 'Most items', '', board(items, nameOf, item, 'data-go', fam.length)) +
      card('low', 'Low or out of stock', (sum(out) ? pill('bad', sum(out) + ' out') : '') + (sum(low) ? pill('warn', sum(low) + ' low') : ''),
        slots(short.map(function (x) { return '<div class="row" data-low="' + esc(x[0]) + '"><span class="nm">' + esc(nameOf(x[0])) + '</span>' + meter([[out.get(x[0]) || 0, 'bad'], [low.get(x[0]) || 0, 'warn']], short[0][1]) + '<span class="cnt">' + n(out, x[0], 'bad') + '</span><span class="amt">' + n(low, x[0], 'warn') + '</span><button class="secondary-btn small" data-act="new-po" data-sup="' + esc(x[0]) + '">Reorder</button></div>'; }).join('')
          || '<p class="note ob-none">Nothing is low.</p>'));
  }
  // Text chevrons ‹ › (View all, Settings rows, Sales' period arrows) become one drawn chevron at the text's
  // cap height (owner 2026-10-19, "C"); Sales › Items' hover chevron is the same shape in the css.
  var CHEV = '<svg class="chev" viewBox="0 0 6 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.25 1 4.75 4.5 1.25 8"/></svg>';
  function chevrons() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), hits = [];
    for (var n; (n = w.nextNode());) if (/[‹›]/.test(n.data) && n.parentElement.closest('a, button, .set-chev')) hits.push(n);
    hits.forEach(function (n) {
      var t = document.createElement('template');
      t.innerHTML = esc(n.data).replace(/[‹›]/g, function (c) { return c === '‹' ? CHEV.replace('chev"', 'chev back"') : CHEV; });
      n.replaceWith(t.content);
    });
  }
  // Sales' Summary | Items reads Summary | Breakdown (owner 2026-10-20): what sold and when, not only items, and
  // "Items" is already the sidebar's page. The link (?by=items) stays.
  function salesTabs() {
    var a = document.querySelector('.view-sales .pd-switch a[href*="by=items"]');
    if (a && a.textContent !== 'Breakdown') a.textContent = 'Breakdown';
  }
  // Orders › Breakdown: counts and timing (owner 2026-10-20: Sales is the pesos, Orders the action). Owner round 2: less empty
  // space; round 5: busy times (By day / By hour dropdown) and order size kept, then Top orders, Fulfilment as one split
  // bar, voids and refunds by whose sale (the POS asks no reason yet); round 6 makes Fulfilment one plain sankey with the outcome.
  // Same range, search and filters as the list. An order = a sale not voided; a refunded sale still counts.
  var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var BANDS = [['Morning · 7–10', 10], ['Midday · 10–1', 13], ['Afternoon · 1–4', 16], ['Late · 4–7', 99]];   // [name, ends before hour]
  var hr = function (h) { return (h % 12 || 12) + (h < 12 ? 'a' : 'p'); };
  // The breakdown cards' parts, shared by Orders, Customers and Suppliers.
  var tally = function (rows, by) { var m = new Map(); rows.forEach(function (o) { var k = by(o); m.set(k, (m.get(k) || 0) + 1); }); return m; };
  var ranked = function (m) { return Array.from(m).sort(function (a, b) { return b[1] - a[1]; }); };
  var card = function (id, title, meta, body) { return '<section class="card w" data-rail="' + id + '"><div class="top band"><span>' + title + '</span><span class="acts">' + meta + '</span></div>' + body + '</section>'; };
  var row = function (nm, cnt, share, cls, bar) { return '<div class="row' + (cls ? ' ' + cls : '') + '"><span class="nm">' + nm + '</span>' + (bar || '') + '<span class="cnt">' + cnt + '</span><span class="amt">' + share + '</span></div>'; };
  var pill = function (k, name) { return '<span class="pl k' + k + '">' + esc(name) + '</span>'; };
  var sum = function (m) { var t = 0; m.forEach(function (x) { t += x; }); return t; };
  // A row's side bar: [amount, tint] parts laid end to end against top (the biggest row, or a limit).
  var meter = function (parts, top) { return '<span class="ob-m">' + parts.map(function (x) { return x[0] > 0 ? '<i class="k' + x[1] + '" style="width:' + x[0] / (top || 1) * 100 + '%"></i>' : ''; }).join('') + '</span>'; };
  // One bar split into [amount, tint] parts.
  var split = function (parts) { return '<span class="ob-bar">' + parts.map(function (x) { return x[0] > 0 ? '<i class="k' + x[1] + '" style="flex:' + x[0] + '"></i>' : ''; }).join('') + '</span>'; };
  // A ranked list: the top seven of a Map(id -> amount), each with a plain bar against the biggest and its share
  // of all. go = the attribute a row's click reads ('data-go' opens a supplier, 'data-cust' a customer).
  // The card keeps seven rows' height whatever the data (fixed card sizes); all = the Total row's amount, else the sum.
  var slots = function (inner) { return '<div class="rows ob-fix">' + (inner || '<p class="note ob-none">Nothing here yet.</p>') + '</div>'; };
  var board = function (m, nameOf, fmt, go, all) {
    var e = ranked(m).filter(function (x) { return x[1] > 0; }).slice(0, 7), top = e.length ? e[0][1] : 1;
    if (all == null) all = sum(m);
    return slots(e.map(function (x) {
      return '<button class="row" ' + go + '="' + esc(x[0]) + '"><span class="nm">' + esc(nameOf(x[0])) + '</span>' + meter([[x[1], 4]], top) +
        '<span class="cnt">' + fmt(x[1]) + '</span><span class="amt">' + pctOf(x[1], all, 0) + '</span></button>'; }).join('')) +
      '<div class="rows">' + row('Total', fmt(all), '', 'tot') + '</div>';
  };
  // Sankey: columns of nodes { key, name, n, k }, links [from, to, n, tint]. The bars and words are HTML; the bands
  // are one SVG stretched to the card's width, so nothing is measured or redrawn. fmt = a node's number (counts unless given);
  // a column with more nodes gets taller so each keeps room; an empty column drops out.
  function sankey(cols, links, fmt) {
    cols = cols.filter(function (c) { return c.length; });
    var GAP = 18, H = Math.max(176, 36 * Math.max.apply(null, cols.map(function (c) { return c.length; }))), at = {}, nodes = '', bands = '';
    var s = Math.min.apply(null, cols.map(function (c) { return (H - GAP * (c.length - 1)) / Math.max(1, c.reduce(function (t, x) { return t + x.n; }, 0)); }));
    cols.forEach(function (c, ci) {
      var x = ci / (cols.length - 1) * 100, y = (H - GAP * (c.length - 1) - c.reduce(function (t, d) { return t + d.n * s; }, 0)) / 2;
      c.forEach(function (d) {
        at[d.key] = { x: x, o: y, i: y };
        nodes += '<div class="nd k' + d.k + '" style="left:' + x + '%;top:' + y + 'px;height:' + d.n * s + 'px;translate:-' + x + '%"><span>' + esc(d.name) + ' <b>' + (fmt || SalesMath.qtyText)(d.n) + '</b></span></div>';
        y += d.n * s + GAP;
      });
    });
    links.forEach(function (l) {
      var h = l[2] * s;
      if (!h) return;
      var a = at[l[0]], b = at[l[1]], m = (a.x + b.x) / 2;
      bands += '<path class="k' + l[3] + '" d="M' + a.x + ' ' + a.o + 'C' + m + ' ' + a.o + ' ' + m + ' ' + b.i + ' ' + b.x + ' ' + b.i + 'V' + (b.i + h) +
        'C' + m + ' ' + (b.i + h) + ' ' + m + ' ' + (a.o + h) + ' ' + a.x + ' ' + (a.o + h) + 'Z"/>';
      a.o += h; b.i += h;
    });
    return '<div class="ob-sk" style="height:' + H + 'px"><svg viewBox="0 0 100 ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + bands + '</svg>' + nodes + '</div>';
  }
  function ordersBreakdown() {
    var rail = document.querySelector('.view-tx.active .rail.bd:not(.ob)');
    if (!rail) return;
    var p = Router.route().params, v = {}, zone = SalesMath.storeZone(state.settings), win = rangeWindows();
    var seller = SalesMath.sellerOf(state.orders), q = (state.txQuery || '').trim().toLowerCase();
    var key = { pay: function (o) { return SalesMath.paymentsOf(o).map(function (x) { return x.key; }); },
      staff: function (o) { return seller(o).key; }, ful: function (o) { return o.fulfilment || 'walkin'; } };
    Object.keys(key).forEach(function (f) { v[f] = (p[f] || '').split(',').filter(Boolean); });
    var pass = function (o) { return Object.keys(key).every(function (f) { return !v[f].length || [].concat(key[f](o)).some(function (k) { return v[f].includes(k); }); }); };
    var hay = function (o) { return [o.number, o.id, o.customer && o.customer.name, seller(o).name].concat((o.items || []).map(function (i) { return (productFor(i) || i).name; })).join(' ').toLowerCase(); };
    var voided = new Set(state.orders.filter(function (o) { return o.status === 'void'; }).map(function (o) { return o.originalOrderId; }));
    var base = state.orders.filter(function (o) { var t = SalesMath.tsOf(o); return t >= win.start && t < win.end && SalesMath.sign(o) && (!q || hay(o).includes(q)) && pass(o); });
    var all = base.filter(function (o) { return SalesMath.isSale(o) && !voided.has(o.id); }), n = all.length;
    var pct = function (x, of) { return SalesMath.pctText(SalesMath.share(x, of === undefined ? n : of)); };
    var none = '<p class="note ob-none">No orders here.</p>';
    // Columns, each split by `parts` (an index into the pill tints, or one tint `k` for all).
    var columns = function (cols, k) {
      var top = Math.max.apply(null, cols.map(function (c) { return c.n; }).concat(1));
      return '<div class="ob-cols">' + cols.map(function (c) {
        return '<div class="ob-col"><b>' + (c.n ? SalesMath.qtyText(c.n) : '') + '</b><span class="st" style="height:' + Math.round(c.n / top * 150) + 'px">' +
          c.parts.map(function (x, i) { return x ? '<i class="k' + (k || i + 1) + '" style="flex:' + x + '"></i>' : ''; }).join('') + '</span><small>' + c.label + '</small></div>';
      }).join('') + '</div>';
    };

    var html = '';
    // Busy times: when the orders come in. By day = weekdays split by time band; by hour = hours split by weekday.
    var at = all.map(function (o) { var d = SalesMath.dateParts(o.ts, zone); return { wd: (d.weekday + 6) % 7, h: d.hour, band: BANDS.findIndex(function (b) { return d.hour < b[1]; }) }; });
    var byDay = WD.map(function (w, i) { var c = at.filter(function (x) { return x.wd === i; });
      return { n: c.length, label: w, parts: BANDS.map(function (b, j) { return c.filter(function (x) { return x.band === j; }).length; }) }; });
    var hours = at.map(function (x) { return x.h; }), h0 = Math.min.apply(null, hours.concat(7)), h1 = Math.max.apply(null, hours.concat(18)), byHour = [];
    for (var h = h0; h <= h1; h++) byHour.push({ n: 0, label: hr(h), parts: WD.map(function () { return 0; }) });
    at.forEach(function (x) { var c = byHour[x.h - h0]; c.n++; c.parts[x.wd]++; });
    var hourly = p.busy === 'hour', cols = hourly ? byHour : byDay, best = cols.reduce(function (a, c) { return c.n > a.n ? c : a; });
    var names = hourly ? WD : BANDS.map(function (b) { return b[0]; });
    var counts = hourly ? byDay.map(function (d) { return d.n; }) : BANDS.map(function (b, j) { return at.filter(function (x) { return x.band === j; }).length; });
    var pick = '<button class="pick" popovertarget="obBusy">' + (hourly ? 'By hour' : 'By day') + '</button><div class="menu" id="obBusy" popover role="menu">' +
      [['', 'By day'], ['hour', 'By hour']].map(function (o) { return '<button role="menuitemradio" data-busy="' + o[0] + '" aria-checked="' + (o[0] === (p.busy || '')) + '">' + o[1] + '</button>'; }).join('') + '</div>';
    html += card('busy', 'Busy times', (best.n ? 'Busiest: ' + best.label : '') + pick, n ? '<div class="ob-split">' + columns(cols) + '<div class="rows">' +
      names.map(function (nm, i) { return row(pill(i + 1, nm), SalesMath.qtyText(counts[i]), pct(counts[i])); }).join('') + row('Total', SalesMath.qtyText(n), '', 'tot') + '</div></div>' : none);

    // Order size: how many different items in a basket; the typical order is the middle one.
    var SIZES = [['1 item', 1], ['2 items', 2], ['3 items', 3], ['4–5 items', 5], ['6 or more', Infinity]];
    var lines = all.map(function (o) { return (o.items || []).length; }), size = tally(lines, function (c) { return SIZES.findIndex(function (s) { return c <= s[1]; }); });
    var mid = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor((a.length - 1) / 2)]; };
    html += card('size', 'Order size', n ? 'Typical: ' + SalesMath.plural(mid(lines), 'item') + ' · ' + pesoShort(mid(all.map(function (o) { return +o.total || 0; }))) : '',
      n ? columns(SIZES.map(function (s, i) { var c = size.get(i) || 0; return { n: c, label: s[0] + '<br>' + pct(c), parts: [c] }; }), 3) : none);

    // Top orders: the seven biggest baskets (fills Order size's height), a side bar against the biggest; a row opens the receipt like the list does.
    var top7 = all.slice().sort(function (a, b) { return (+b.total || 0) - (+a.total || 0); }).slice(0, 7);
    html += card('top', 'Top orders', '', n ? '<div class="rows">' + top7.map(function (o) {
      return '<button class="row" data-receipt="' + esc(o.id) + '"><span class="nm">#' + esc(o.number || o.id) + '<span class="mut">' + esc(o.customer && o.customer.name || '') + '</span></span>' + meter([[+o.total || 0, 4]], +top7[0].total || 0) + '<span class="cnt">' + SalesMath.plural((o.items || []).length, 'item') + '</span><span class="amt">' + peso(+o.total || 0) + '</span></button>'; }).join('') + '</div>' : none);

    // Fulfilment (owner round 6, a sankey): every order → walk-in / delivery → completed, refunded or voided.
    // Orders here counts voided sales too, so it can be more than Busy times' total. A band keeps its fulfilment's tint.
    var rung = base.filter(SalesMath.isSale), refunded = new Set(state.orders.filter(function (o) { return SalesMath.isReversal(o) && o.status !== 'void'; }).map(function (o) { return o.originalOrderId; }));
    var fate = function (o) { return voided.has(o.id) ? 'void' : refunded.has(o.id) ? 'refund' : 'done'; };
    var ful = ranked(tally(rung, key.ful)), fulName = new Map(), ends = [['done', 'Completed', 7], ['refund', 'Refunded', 'warn'], ['void', 'Voided', 'bad']], links = [];
    rung.forEach(function (o) { fulName.set(key.ful(o), orderFulfilLabel(o)); });
    var flows = tally(rung, function (o) { return key.ful(o) + '|' + fate(o); });
    ful.forEach(function (e, i) { links.push(['rung', 'f' + e[0], e[1], i % 6 + 1]); ends.forEach(function (d) { links.push(['f' + e[0], d[0], flows.get(e[0] + '|' + d[0]) || 0, i % 6 + 1]); }); });
    html += card('flow', 'Fulfilment', '', rung.length ? sankey([[{ key: 'rung', name: 'Orders', n: rung.length, k: 7 }],
      ful.map(function (e, i) { return { key: 'f' + e[0], name: fulName.get(e[0]), n: e[1], k: i % 6 + 1 }; }),
      ends.map(function (d) { return { key: d[0], name: d[1], n: rung.filter(function (o) { return fate(o) === d[0]; }).length, k: d[2] }; }).filter(function (d) { return d.n; })], links) : none);

    // Voids and refunds: whose sales they were (the POS doesn't ask why yet). People get no colour; the counts wear the void/refund pills
    // over one red-then-amber bar against the person with most.
    var back = base.filter(function (o) { return SalesMath.isReversal(o); }), vc = back.filter(function (o) { return o.status === 'void'; }).length;
    // Then what (owner round 8): a row opens the list filtered to that person, to look at the orders themselves.
    var by = ranked(tally(back, key.staff)), who = new Map(back.map(function (o) { return [key.staff(o), seller(o).name || 'Unknown']; }));
    var num = function (k, st) { return back.filter(function (o) { return key.staff(o) === k && (o.status === 'void') === (st === 'void'); }).length; };
    var cnt = function (who, st, k) { var c = num(who, st); return c ? pill(k, String(c)) : ''; };
    html += card('void', 'Voids and refunds', back.length ? (vc ? pill('bad', SalesMath.plural(vc, 'void')) : '') + (back.length - vc ? pill('warn', SalesMath.plural(back.length - vc, 'refund')) : '') : '',
      back.length ? '<div class="rows">' + by.map(function (e) { return '<button class="row" data-who="' + esc(e[0]) + '"><span class="nm">' + esc(who.get(e[0])) + '</span>' + meter([[num(e[0], 'void'), 'bad'], [num(e[0], 'refund'), 'warn']], by[0][1]) +
        '<span class="cnt">' + cnt(e[0], 'void', 'bad') + '</span><span class="amt">' + cnt(e[0], 'refund', 'warn') + '</span></button>'; }).join('') + '</div>'
        : '<p class="note ob-none">No voids or refunds.</p>');

    rail.classList.add('ob');
    rail.innerHTML = html;
  }
  // The busy-times dropdown sets ?busy=; a Top orders row opens its receipt (?receipt=, as the list).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.rail.ob [data-busy]');
    if (b) Router.setParams({ busy: b.dataset.busy });
    var r = e.target.closest && e.target.closest('.rail.ob [data-receipt]');
    if (r) Router.setParams({ receipt: r.dataset.receipt });
    var s = e.target.closest && e.target.closest('.rail.ob [data-who]');   // a Voids row opens the list for that person
    if (s) Router.setParams({ view: '', staff: s.dataset.who }, { replace: false });
    var pay = e.target.closest && e.target.closest('.copy-bd [data-pay]');   // Record payment: the customer page's dialog, here
    if (pay) return openPaymentDialog(allCustomerRecords().find(function (x) { return x.id === pay.dataset.pay; }));
    if (e.target.closest && e.target.closest('.copy-bd [data-act]')) return;   // Reorder: bo-suppliers.js runs it (see the capture listener)
    var c = e.target.closest && e.target.closest('.copy-bd [data-cust]');   // a Customers breakdown row opens the customer
    if (c) Router.go('customers', c.dataset.cust);
    var l = e.target.closest && e.target.closest('.copy-bd [data-low]');     // a Low or out of stock row opens Items › Stock for that supplier
    if (l) Router.go('products', '', { view: 'stock', supplier: l.dataset.low, level: 'out,low' });
  });
  // Reorder: New purchase order reads the supplier from the address (?supplier=) when no supplier page is open,
  // so put it there before bo-suppliers.js's own click listener runs. No hashchange, so nothing re-renders.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.copy-bd [data-sup]');
    if (b) history.replaceState(null, '', '#/suppliers?view=breakdown&supplier=' + encodeURIComponent(b.dataset.sup));
  }, true);
  function run() { crumbs(); stockBar(); supplierInfo(); switchTitle(); breakdownSwitch(); salesTabs(); ordersBreakdown(); chevrons(); }
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  addEventListener('hashchange', run);
  run();
})();
