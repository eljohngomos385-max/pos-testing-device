/* Dev only. Thins the demo data (scripts/demo-fill.js, in memory) so the Dashboard can be judged
   at its emptiest. serve.py injects this right after demo-fill.js when this port's
   hwpos_sparse_<port> cookie is set; window.HW_SPARSE is the list of states, '.'-joined:

     pay3      only 3 payment methods (QR and Maya paid by GCash)
     low2      2 items out or low       low0  nothing out or low
     top4      only 4 products ever sold
     short     no voids, refunds, discounts or VAT
     notarget  no sales target set
     new       a new store: a handful of today's sales, nothing before

   Set by URL: /sparse/<states> (e.g. /sparse/top4+short), /sparse/off ends it. home-labs/compare.html loads these.
   ponytail: ledger, movements and customer balances are left as generated; Home never reads them. */
(() => {
  const K = 'hwpos.', get = (k) => JSON.parse(localStorage.getItem(K + k) || 'null'), put = (k, v) => localStorage.setItem(K + k, JSON.stringify(v));
  const r2 = (n) => Math.round(n * 100) / 100;
  const KEYS = ['orders.v1', 'products.v2', 'settings.v1'], full = Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(K + k)]));

  // Totals, VAT and payment legs again after items or discounts changed, so every row still adds up.
  const retotal = (o) => {
    const was = o.total;
    o.subtotal = r2(o.items.reduce((s, i) => s + i.lineGross, 0));
    const lineOff = r2(o.items.reduce((s, i) => s + i.lineDiscount, 0)), c = o.cartDiscount;
    const cartOff = !c ? 0 : c.type === 'percent' ? r2((o.subtotal - lineOff) * c.value / 100) : Math.min(c.value, o.subtotal - lineOff);
    o.discount = r2(lineOff + cartOff); o.total = r2(o.subtotal - o.discount);
    o.vatAmount = o.vatRate ? r2(o.total * o.vatRate / (1 + o.vatRate)) : 0; o.vatableSales = r2(o.total - o.vatAmount);
    const f = was ? o.total / was : 1;
    o.payments.forEach((p, i, a) => { p.amount = i === a.length - 1 ? r2(o.total - a.slice(0, -1).reduce((s, x) => s + x.amount, 0)) : r2(p.amount * f);
      if (p.method === 'cash' && p.tendered) { p.tendered = Math.max(p.amount, Math.ceil(p.amount / 50) * 50); p.change = r2(p.tendered - p.amount); } });
    if (o.paymentKind === 'cash' && o.tendered) { o.tendered = o.payments[0].tendered; o.change = o.payments[0].change; }
  };

  function thin(states) {
    KEYS.forEach((k) => (full[k] == null ? localStorage.removeItem(K + k) : localStorage.setItem(K + k, full[k])));
    const on = new Set(String(states || '').split('.').filter(Boolean));
    if (on.has('all')) ['pay3', 'low2', 'top4', 'short', 'notarget', 'new'].forEach((s) => on.add(s));
    if (!on.size) return;
    let orders = get('orders.v1') || [], products = get('products.v2') || [];
    if (on.has('new')) {
      // The last 5 sales, moved into today (before now), so there are some even before opening time.
      const now = Date.now(), t0 = new Date(now).setHours(0, 0, 0, 0);
      orders = orders.filter((o) => o.status === 'completed').slice(-5);
      orders.forEach((o, i) => { o.ts = Math.round(t0 + (now - t0) * (i + 1) / 6); });
    }
    if (on.has('short')) {
      orders = orders.filter((o) => o.status !== 'void' && o.status !== 'refund');
      orders.forEach((o) => { o.items.forEach((i) => { i.discount = null; i.lineDiscount = 0; i.lineTotal = i.lineGross; });
        o.cartDiscount = null; o.vatRate = 0; retotal(o); });
    }
    if (on.has('top4')) {
      const sold = new Map();
      orders.forEach((o) => o.status === 'completed' && o.items.forEach((i) => sold.set(i.productId, (sold.get(i.productId) || 0) + i.lineTotal)));
      const keep = new Set([...sold].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id));
      orders = orders.filter((o) => { o.items = o.items.filter((i) => keep.has(i.productId)); return o.items.length; });
      orders.forEach(retotal);
    }
    if (on.has('pay3')) orders.forEach((o) => { if (o.paymentKind !== 'other' && o.paymentKind !== 'qr') return;
      o.paymentKind = 'gcash'; o.paymentMethodLabel = 'GCash'; o.payments.forEach((p) => { if (p.label !== 'Void' && p.label !== 'Refund') p.label = 'GCash'; }); });

    if (on.has('low2') || on.has('low0')) {
      // Stock is the movements log's sum (bo-model withStock), so counts can't be set here: stop counting
      // every item, then (low2) count two single items again with a reorder point nothing reaches.
      const keep = on.has('low0') ? [] : products.filter((p) => !p.archived && p.trackStock !== false && !p.groupId).slice(0, 2);
      products.forEach((p) => { if (!keep.includes(p)) p.trackStock = false; });
      keep.forEach((p) => { p.reorderPoint = 1e6; });
    }
    if (on.has('notarget')) { const s = get('settings.v1') || {}; delete s.targets; put('settings.v1', s); }

    put('orders.v1', orders); put('products.v2', products);
    console.log('[sparse]', [...on].join(' '), orders.length, 'orders');
  }
  thin(window.HW_SPARSE);
})();
