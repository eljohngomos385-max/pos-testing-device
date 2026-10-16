/* Back office — Insights. Tier 0 of docs/data-roadmap.md: reads, not captures.

   Everything above the seam is a pure function over plain arrays -- products, the movement
   log, purchase orders, suppliers, orders, customers and the event logs --
   with an explicit `now`. Nothing here reads storage; the caller loads and passes. Every
   return is plain JSON with the unit in the field name (leadDays, idleDays,
   pesos, pct 0..100, rate 0..1), so an AI can read `buildInsights()` without this file.

   Orders follow the sales-math.js row model (a void or refund is its own row pointing at the
   sale); money is added up there, never here. Uses the SalesMath global and bo-model.js globals:
   cent, round2, normalizeProduct, SUPPLIER_DEFAULTS, PO_DEFAULTS, EVENT_LOGS, saleClock, stockLevel, familyLevel, STOCK_LEVEL, DEAD_DAYS, stockFlow, lotWalk, latestEvents, groupOf. */
(function () {
  /* ================= pure logic (exported for scripts/insights-check.mjs) ============= */

  // The store's clock (SalesMath.storeZone/dayKey/dayStartMs), the one every page cuts days on.
  // Node has no settings: storeZone(null) is Manila.
  const zone = () => SalesMath.storeZone(typeof state !== 'undefined' ? state.settings : null);
  const DAY_MS = 864e5;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  const r2 = SalesMath.round2;
  const r3 = (n) => SalesMath.milli(n) / 1000;
  // A ...Pct field (0..100) off SalesMath.change, the one "% vs before"; null when there is no before.
  const pctVs = (now, was) => { const c = SalesMath.change(now, was); return c == null ? null : r2(c * 100); };
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const sd = (a) => {                                   // sample sd; one point has no spread
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  };

  // Orders carry epoch ms, movements ISO strings, purchase orders sometimes a bare date.
  // A bare date is store-local midnight; anything else reads through SalesMath.tsOf (ms, ISO, or ms
  // as text), the one reading. No readable time: NaN, so hasTs skips it.
  const toMs = (ts) => (DATE_ONLY.test(ts || '') ? SalesMath.dayStartMs(ts, zone()) : SalesMath.tsOf({ ts }) || NaN);
  const dayKey = (ts) => SalesMath.dayKey(ts, zone());
  const isoOf = (ts) => new Date(toMs(ts)).toISOString();
  // A row with no readable ts has no date to join on; skipped rather than thrown on.
  const hasTs = (x) => Number.isFinite(toMs(x && x.ts));

  // When a movement happened, in ms: bo-model movedAt, the one reading Inventory uses too
  // (happenedOn at store noon when it isn't the typed day, else ts). No readable ts: NaN, skipped.
  const when = (m) => movedAt(m, zone()) || NaN;

  // The movement log per product, oldest first. Rows without a readable ts are skipped.
  function movesByProduct(movements) {
    const by = new Map();
    (movements || []).filter((m) => Number.isFinite(toMs(when(m))))
      .sort((a, b) => toMs(when(a)) - toMs(when(b)))
      .forEach((m) => { const l = by.get(m.productId); if (l) l.push(m); else by.set(m.productId, [m]); });
    return by;
  }

  /* ---- 1. Stockout intervals: replayed from today's stock back through the log ---- */
  function stockoutIntervals(products, movements, now) {
    const by = movesByProduct(movements), nowMs = toMs(now);
    const span = (start, end) => ({ start: isoOf(start), end: end ? isoOf(end) : null,
      days: r2(((end ? toMs(end) : nowMs) - toMs(start)) / DAY_MS) });
    const rows = [];
    for (const p of products || []) {
      const list = by.get(p.id) || [];
      // Balance before the first logged row. ponytail: if that is already <= 0 the stockout
      // started before the log did and its start is unknown, so it is not reported.
      let bal = r2((Number(p.stock) || 0) - sum(list.map((m) => Number(m.qty) || 0)));
      const intervals = [];
      let open = null;
      for (const m of list) {
        const before = bal;
        bal = r2(bal + (Number(m.qty) || 0));
        if (before > 0 && bal <= 0) open = when(m);
        else if (before <= 0 && bal > 0 && open) { intervals.push(span(open, when(m))); open = null; }
      }
      if (open) intervals.push(span(open, null));
      const outNow = (Number(p.stock) || 0) <= 0;
      if (!intervals.length && !outNow) continue;
      rows.push({ productId: p.id, name: p.name || '', outNow, stockouts: intervals.length,
        daysOut: r2(sum(intervals.map((i) => i.days))), intervals });
    }
    return { rows, totalDaysOut: r2(sum(rows.map((r) => r.daysOut))) };
  }

  /* ---- 2. Supplier lead time and reliability ---- */
  // A buying list mixes suppliers, so each supplier is judged on its own lines of a PO: the PO
  // counts once per supplier on it, and its lead runs from the send to that supplier's last arrival.
  function supplierLeadTimes(purchaseOrders, suppliers) {
    const by = new Map((suppliers || []).map((s) => [s.id, { s, pos: [] }]));
    for (const po of purchaseOrders || []) {
      const slices = new Map();
      for (const l of po.items || []) {
        const k = lineSupplier(po, l);
        slices.set(k, (slices.get(k) || []).concat([l]));
      }
      if (!slices.size) slices.set(lineSupplier(po, {}), []);
      slices.forEach((lines, k) => {
        if (!by.has(k)) by.set(k, { s: { id: k }, pos: [] });
        by.get(k).pos.push({ po, lines });
      });
    }
    return [...by.values()].map(({ s, pos }) => {
      const leads = [], shortReasons = {};
      let ordered = 0, received = 0, quotedC = 0, invoiceC = 0, invoiceLines = 0;
      for (const { po, lines } of pos) {
        const sent = po.sentAt || po.orderedAt;
        const arrived = lines.map((l) => l.receivedOn || '').sort().pop() || po.receivedAt;
        if (arrived && sent) {
          const lead = SalesMath.daysAgo(sent, arrived, zone());   // store days, sent to arrived
          if (lead >= 0) leads.push(lead);
        }
        // Fill counts once something of theirs arrived -- a cancelled PO included, or cancelling
        // the rest of a short ship would hide it. Nothing arrived yet is still coming, not short.
        if (!lines.some((l) => Number(l.receivedQty) > 0)) continue;
        for (const l of lines) {
          const q = Number(l.qty) || 0, got = Number(l.receivedQty) || 0;
          ordered += q; received += Math.min(got, q);   // an over-ship is not a better fill
          if (got < q && l.shortReason) shortReasons[l.shortReason] = (shortReasons[l.shortReason] || 0) + 1;
          if (l.invoiceCost != null && l.invoiceCost !== '') {
            const units = got || q;
            quotedC += cent(l.cost) * units; invoiceC += cent(l.invoiceCost) * units; invoiceLines++;
          }
        }
      }
      return {
        supplierId: s.id, name: s.name || '',
        purchaseOrders: pos.length, n: leads.length,
        leadDaysMean: leads.length ? r2(mean(leads)) : null, leadDaysSd: leads.length ? r2(sd(leads)) : null,
        leadDaysMin: leads.length ? Math.min(...leads) : null, leadDaysMax: leads.length ? Math.max(...leads) : null,
        fillRate: ordered ? r3(received / ordered) : null,
        invoiceLines, invoiceGapPct: pctVs(invoiceC, quotedC), shortReasons,
      };
    });
  }

  // 3 & 4, the demand rate and the reorder forecast (reorderPlan), were removed 2026-09-27 by
  // the owner: "build it from the ground up again". Facts only until then.

  /* ---- 5 & 7. Cash asleep and dead stock ---- */
  // Last sold = bo-model saleClock, THE "last sold" of an item (the latest sale not cancelled by a
  // void; a refunded sale still counts), the same clock as the Dead pill. Idle days are store days
  // (SalesMath.daysAgo), the days "Last sold 3 days ago" and stockLevel count.
  function cashAsleep(products, movements, now, orders) {
    const nowMs = toMs(now), idx = saleClock(movements, zone(), orders);
    return (products || []).filter((p) => !p.archived && Number(p.stock) > 0).map((p) => {
      const h = idx.get(p.id), since = h ? (h.lastSale ?? h.first) : null;
      const stockPesos = stockValue(p);   // bo-model: the one stock value (untracked = 0)
      const idleDays = since == null ? null : Math.max(0, SalesMath.daysAgo(since, nowMs, zone()));
      return { productId: p.id, name: p.name || '', qty: Number(p.stock), costPesos: round2(p.cost), stockPesos,
        lastSaleAt: h && h.lastSale != null ? isoOf(h.lastSale) : null, idleDays,
        pesoDays: Math.round(stockPesos * (idleDays || 0)) };
    }).sort((a, b) => b.pesoDays - a.pesoDays || b.stockPesos - a.stockPesos);
  }

  // Dead = bo-model stockLevel, the word the Items tile and pill use: tracked, in stock, not Low (Low
  // ranks first there too) and DEAD_DAYS store days idle. One row per variant (the tile counts families).
  function deadStock(products, movements, now, { orders } = {}) {
    const clock = saleClock(movements, zone(), orders), nowMs = toMs(now);
    const dead = new Set((products || []).filter((p) => stockLevel(p, clock.get(p.id), nowMs, zone()) === 'dead').map((p) => p.id));
    const rows = cashAsleep(products, movements, now, orders).filter((r) => dead.has(r.productId))
      .sort((a, b) => b.stockPesos - a.stockPesos);
    return { days: DEAD_DAYS, totalPesos: r2(sum(rows.map((r) => r.stockPesos))), rows };
  }

  /* ---- Per product: the Items page's rule, a family of variants is ONE item (owner 2026-10-03) ---- */
  // Folds rows keyed by productId into one row per family (groupId, else the product: the key bo-model
  // stockCounts/familyRows count by), so "N items" here is the Items tiles' N. Each keeps its variant
  // rows (the item page opens them) and sums `add`'s fields. `members`: the family's live products,
  // what familyLevel reads. The sections stay per variant for the AI export.
  function perProduct(rows, products, groups, add = []) {
    const byId = new Map((products || []).map((p) => [p.id, p]));
    const fam = (id) => { const p = byId.get(id); return p ? p.groupId || p.id : id; };
    const live = new Map(), by = new Map();
    for (const p of products || []) if (!p.archived) { const k = p.groupId || p.id; (live.get(k) || live.set(k, []).get(k)).push(p); }
    for (const r of rows || []) { const k = fam(r.productId); (by.get(k) || by.set(k, []).get(k)).push(r); }
    return [...by].map(([productId, variants]) => {
      const p = byId.get(variants[0].productId), g = groupOf(p, groups || []), members = live.get(productId) || [];
      return { productId, name: (g && g.name) || (p && p.name) || variants[0].name || '', family: !!g, members, variants,
        ...Object.fromEntries(add.map((f) => [f, r2(sum(variants.map((v) => Number(v[f]) || 0)))])) };
    });
  }
  // Dead per item: a family is dead only when every live variant has a dead row.
  const deadItems = (rows, products, groups, add) => perProduct(rows, products, groups, add)
    .filter((f) => f.members.every((m) => f.variants.some((v) => v.productId === m.id)));

  /* ---- 5b. Cash tied up: stock at cost by how long it has sat, and money in and out per window ---- */
  // Ages are bo-model lotWalk, the one FIFO walk sell-through reads too: what is left on the shelf
  // is what the oldest-first drain has not reached, each unit as old as the lot it came in on. A
  // return (void or refund) goes back to the lot its sale drained, so it never makes old stock
  // fresh; an opening row and stock the log doesn't reach predate the log (beforeLogQty, oldest
  // bucket). Sold at cost and Lost are bo-model stockFlow, Inventory's numbers: sales net of
  // returns, and isLoss (a short count too). Stock value is stockValue: untracked items hold none.
  const AGE_BUCKETS = [['0-15', 0, 15], ['16-30', 16, 30], ['31-60', 31, 60], ['61-90', 61, 90], ['90+', 91, Infinity]];
  function cashTiedUp(products, movements, now, { windows = [15, 30] } = {}) {
    const nowMs = toMs(now), z = zone();
    const bucketOf = (age) => AGE_BUCKETS.findIndex(([, lo, hi]) => age >= lo && age <= hi);
    const total = AGE_BUCKETS.map(() => 0), over = windows.map(() => 0);           // centavos
    const costOf = new Map((products || []).map((p) => [p.id, Number(p.cost) || 0]));
    // The window is the last N store days, today included (and anything dated after now).
    const flow = windows.map((days) => {
      const from = SalesMath.rangeWindow(days, nowMs, z).from;
      const cost = (id) => costOf.get(id) ?? 0;
      const f = stockFlow(movements, cost, [from, Infinity], undefined, z);
      // Bought = stockFlow's Came in over deliveries only (a hand change up is not a purchase).
      const boughtC = SalesMath.cent(stockFlow((movements || []).filter((m) => m.reason === 'delivery'), cost, [from, Infinity], undefined, z).in);
      const otherOut = sum(f.why.filter((w) => w.reason !== 'sale').map((w) => w.value));
      return { days, boughtC, soldC: SalesMath.cent(f.out - otherOut), lostC: SalesMath.cent(f.lost) };
    });
    const live = (products || []).filter((p) => !p.archived && p.trackStock !== false && Number(p.stock) > 0);
    const lots = lotWalk(movements, live, z);
    const rows = [];
    for (const p of live) {
      const stock = Number(p.stock), costC = cent(p.cost);
      const byAge = AGE_BUCKETS.map(() => 0), overQty = windows.map(() => 0);
      const dated = (lots.get(p.id) || []).filter((l) => l.at != null && l.left > 1e-9);
      let left = stock, oldestDays = 0;
      for (let i = dated.length - 1; i >= 0 && left > 1e-9; i--) {   // newest lot first, capped at the shelf
        const take = Math.min(dated[i].left, left), age = Math.max(0, SalesMath.daysAgo(dated[i].at, nowMs, z));
        byAge[bucketOf(age)] += take; left = r3(left - take); oldestDays = age;
        windows.forEach((days, w) => { if (age > days) overQty[w] += take; });
      }
      const beforeLogQty = r3(Math.max(0, left));             // has sat longer than any window
      byAge[AGE_BUCKETS.length - 1] += beforeLogQty;
      byAge.forEach((q, b) => { total[b] += Math.round(q * costC); });
      overQty.forEach((q, w) => { over[w] += Math.round((q + beforeLogQty) * costC); });
      rows.push({ productId: p.id, name: p.name || '', qty: stock, costPesos: round2(p.cost),
        stockPesos: stockValue(p), oldestDays: beforeLogQty > 0 ? null : oldestDays, beforeLogQty,
        pesosByAge: Object.fromEntries(AGE_BUCKETS.map(([label], b) => [label, r2((byAge[b] * costC) / 100)])) });
    }
    return {
      totalPesos: stockValueOf(live),   // bo-model: the Items page's Stock value
      ageBuckets: AGE_BUCKETS.map(([label, fromDays, toDays], b) =>
        ({ label, fromDays, toDays: toDays === Infinity ? null : toDays, pesos: r2(total[b] / 100) })),
      windows: flow.map((f, w) => ({ days: f.days, boughtPesos: r2(f.boughtC / 100), soldAtCostPesos: r2(f.soldC / 100),
        lostPesos: r2(f.lostC / 100), sittingOverPesos: r2(over[w] / 100) })),
      rows: rows.sort((a, b) => (b.oldestDays ?? Infinity) - (a.oldestDays ?? Infinity) || b.stockPesos - a.stockPesos),
    };
  }

  /* ---- 6. Sell-through per delivery, FIFO ---- */
  // One row per delivery lot of bo-model lotWalk, the one FIFO walk: stock that predates the log
  // sells first, and a void or refund puts its units back in the lot its sale drained (a refunded
  // sale is not "sold"), so sell-through and the age chart tell one story.
  function sellThrough(movements, purchaseOrders = [], products = []) {
    const poBy = new Map((purchaseOrders || []).map((po) => [po.id, po]));
    const rows = [];
    for (const [productId, lots] of lotWalk(movements, products, zone())) {
      for (const l of lots) {
        if (!l.m || l.m.reason !== 'delivery') continue;
        const m = l.m, po = poBy.get(m.refId), cleared = l.clearedAt != null;
        rows.push({ movementId: m.id, productId, poId: m.refId || '', poNumber: po ? po.number : '',
          supplierId: deliverySupplier(po, m), receivedAt: isoOf(l.at), qtyReceived: l.qty,
          soldQty: l.sold, otherOutQty: l.otherOut, remainingQty: l.left,
          clearedAt: cleared ? isoOf(l.clearedAt) : null, daysToClear: cleared ? r2((l.clearedAt - l.at) / DAY_MS) : null });
      }
    }
    return rows;
  }

  /* ---- 8. Customer totals ---- */
  // Facts only: no next-order guess (owner, 2026-09-27: "this feels like a guess").
  // Orders, Net sales and the last order are the ladder's, the till's and the customer page's too:
  // summarize grouped by SalesMath.customerIdOf (a voided sale drops out, a refund takes its money
  // back, lastSale skips a voided sale). The days are the sales that still stand, voided ones aside.
  function customerTotals(orders, customers = [], now) {
    const nowMs = toMs(now), info = new Map((customers || []).map((c) => [c.id, c])), by = new Map();
    const idOf = SalesMath.customerIdOf;
    const money = SalesMath.summarize(orders, { by: idOf }).groups, rev = SalesMath.reversals(orders);
    for (const o of orders || []) {
      const id = idOf(o);
      if (!id || !SalesMath.isSale(o) || SalesMath.rowState(o, rev) === 'voided' || !hasTs(o)) continue;
      const r = by.get(id) || { days: new Set(), name: (o.customer && o.customer.name) || '' };
      r.days.add(dayKey(o.ts));   // YYYY-MM-DD sorts as text
      by.set(id, r);
    }
    return [...by].map(([id, r]) => {
      const d = [...r.days].sort(), c = info.get(id) || {}, m = money.get(id);
      return { customerId: id, name: c.name || r.name, phone: c.phone || '', orders: m.orders, orderDays: d.length,
        netSales: m.netSales, firstOrderDate: d[0], lastOrderDate: dayKey(m.lastSale),
        daysSinceLast: SalesMath.daysAgo(m.lastSale, nowMs, zone()) };
    }).sort((a, b) => a.daysSinceLast - b.daysSinceLast);
  }

  /* ---- 9. Basket affinity ---- */
  function pairStats(sets, nameOf, { minSupport, minCount, top }) {
    const N = sets.length, single = new Map(), pair = new Map();
    for (const s of sets) {
      s.forEach((a) => single.set(a, (single.get(a) || 0) + 1));
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
        const k = s[i] < s[j] ? s[i] + '\u0000' + s[j] : s[j] + '\u0000' + s[i];
        pair.set(k, (pair.get(k) || 0) + 1);
      }
    }
    const rows = [];
    for (const [k, c] of pair) {
      if (c < minCount || c / N < minSupport) continue;
      const [a, b] = k.split('\u0000'), ca = single.get(a), cb = single.get(b);
      rows.push({ a, b, aName: nameOf.get(a) || a, bName: nameOf.get(b) || b, count: c, countA: ca, countB: cb,
        support: r3(c / N), confidenceAtoB: r3(c / ca), confidenceBtoA: r3(c / cb), lift: r2((c * N) / (ca * cb)) });
    }
    return rows.sort((x, y) => y.lift - x.lift || y.count - x.count).slice(0, top);
  }

  function basketAffinity(orders, { minSupport = 0, minCount = 3, top = 50, products = [] } = {}) {
    const folderOf = new Map((products || []).map((p) => [p.id, p.folder || '']));
    const nameOf = new Map((products || []).map((p) => [p.id, p.name]));
    // A voided or refunded sale: the basket did not really leave the shop.
    const reversed = SalesMath.reversals(orders);
    const baskets = [];
    for (const o of orders || []) {
      if (!SalesMath.isSale(o) || reversed.has(o.id)) continue;
      const ids = [...new Set((o.items || []).map((i) => {
        const id = String(i.productId || i.id || '');
        if (id && !nameOf.has(id)) nameOf.set(id, i.name);
        return id;
      }).filter(Boolean))];
      if (ids.length) baskets.push(ids);
    }
    const opts = { minSupport, minCount, top };
    const cats = baskets.map((ids) => [...new Set(ids.map((id) => folderOf.get(id)).filter(Boolean))]);
    return { baskets: baskets.length, products: pairStats(baskets, nameOf, opts), categories: pairStats(cats, new Map(), opts) };
  }

  /* ---- 10. Delivery points ---- */
  function deliveryPoints(orders, deliveryEvents = []) {
    // Last event = bo-model latestEvents, the trip state Transactions shows.
    const ev = new Map(), rev = SalesMath.reversals(orders), latest = latestEvents((deliveryEvents || []).filter(hasTs));
    (deliveryEvents || []).filter(hasTs).sort((a, b) => toMs(a.ts) - toMs(b.ts)).forEach((e) => {
      const l = ev.get(e.orderId); if (l) l.push(e); else ev.set(e.orderId, [e]);
    });
    return (orders || []).filter((o) => hasTs(o) && o.fulfilment === 'delivery' && o.deliveryLocation
      && Number.isFinite(Number(o.deliveryLocation.lat)) && Number.isFinite(Number(o.deliveryLocation.lng))
      && ['sale', 'refunded'].includes(SalesMath.rowState(o, rev)))
      .map((o) => {
        const list = ev.get(o.id) || [];
        const sent = list.find((e) => e.event === 'dispatched');
        const arrived = list.find((e) => e.event === 'arrived' && (!sent || toMs(e.ts) >= toMs(sent.ts)));
        const last = latest.get(o.id);
        return { orderId: o.id, number: o.number || '', ts: isoOf(o.ts), date: dayKey(o.ts),
          lat: Number(o.deliveryLocation.lat), lng: Number(o.deliveryLocation.lng), totalPesos: round2(o.total),
          customerId: (o.customer && o.customer.id) || '', driver: ((sent || last) && (sent || last).driver) || '',
          dispatchedAt: sent ? isoOf(sent.ts) : null, arrivedAt: arrived ? isoOf(arrived.ts) : null,
          minutesToArrive: sent && arrived ? Math.round((toMs(arrived.ts) - toMs(sent.ts)) / 6000) / 10 : null,
          lastEvent: last ? last.event : '' };
      });
  }

  /* ---- 12. Count accuracy ---- */
  // Facts only: expected, counted and the miss per count. The confidence score was removed
  // 2026-09-27 by the owner (a made-up score).
  function countAccuracy(movements) {
    const by = new Map();
    for (const [productId, list] of movesByProduct(movements)) {
      for (const m of list) {
        if (m.reason !== 'count' || m.expected == null || m.counted == null) continue;
        const expected = Number(m.expected) || 0, counted = Number(m.counted) || 0, variance = r2(counted - expected);
        const h = by.get(productId) || [];
        h.push({ ts: isoOf(when(m)), expected, counted, variance, variancePct: pctVs(counted, expected),
          staff: m.staff || '' });
        by.set(productId, h);
      }
    }
    return [...by].map(([productId, history]) => ({ productId, counts: history.length,
      lastCountedAt: history[history.length - 1].ts,
      meanAbsVariance: r2(mean(history.map((h) => Math.abs(h.variance)))), history }))
      .sort((a, b) => b.meanAbsVariance - a.meanAbsVariance);
  }

  /* ---- 13. Roll-ups of the Tier 1 logs ---- */
  function lostDemandSummary(lostDemand) {
    const by = new Map();
    for (const e of lostDemand || []) {
      const text = String(e.text || '').trim();
      const k = e.productId || 'text:' + text.toLowerCase();
      if (k === 'text:') continue;
      const r = by.get(k) || { productId: e.productId || '', text, requests: 0, qty: 0, reasons: {}, substitutes: {}, firstAt: null, lastAt: null };
      r.requests++; r.qty = r2(r.qty + (Number(e.qty) || 0));
      if (e.reason) r.reasons[e.reason] = (r.reasons[e.reason] || 0) + 1;
      if (e.substituteProductId) r.substitutes[e.substituteProductId] = (r.substitutes[e.substituteProductId] || 0) + 1;
      if (Number.isFinite(toMs(e.ts))) {
        const at = isoOf(e.ts);
        if (!r.firstAt || at < r.firstAt) r.firstAt = at;
        if (!r.lastAt || at > r.lastAt) r.lastAt = at;
      }
      by.set(k, r);
    }
    return [...by.values()].sort((a, b) => b.requests - a.requests || b.qty - a.qty);
  }

  function priceHistory(priceLog) {
    const by = new Map();
    (priceLog || []).filter(hasTs).sort((a, b) => toMs(a.ts) - toMs(b.ts)).forEach((e) => {
      const l = by.get(e.productId) || [];
      l.push({ ts: isoOf(e.ts), date: dayKey(e.ts), field: e.field, old: e.old, new: e.new,
        changePct: pctVs(e.new, e.old), reason: e.reason || '', source: e.source || '', staff: e.staff || '' });
      by.set(e.productId, l);
    });
    return [...by].map(([productId, changes]) => ({ productId,
      priceChanges: changes.filter((c) => c.field === 'price').length, costChanges: changes.filter((c) => c.field === 'cost').length,
      lastChangeAt: changes[changes.length - 1].ts, changes }))
      .sort((a, b) => b.lastChangeAt.localeCompare(a.lastChangeAt));
  }

  /* ---- 14. Everything, in one AI-readable object ---- */
  // Accepts HWPOS_AI.snapshot()-style names or a raw localStorage dump with hwpos.* keys
  // (values may still be JSON strings). Same keys as data-store.js KEYS and bo-model.js.
  const DUMP_KEYS = {
    products: 'hwpos.products.v2', orders: 'hwpos.orders.v1', customers: 'hwpos.customers.v1',
    movements: 'hwpos.stockMovements.v1', purchaseOrders: 'hwpos.purchaseOrders.v1', suppliers: 'hwpos.suppliers.v1',
    ...EVENT_LOGS,
  };
  function dataFromDump(dump = {}) {
    const out = {};
    for (const [name, key] of Object.entries(DUMP_KEYS)) {
      // HWPOS_AI.snapshot() calls the movement log `stockMovements`.
      let v = dump[name] !== undefined ? dump[name]
        : name === 'movements' && dump.stockMovements !== undefined ? dump.stockMovements : dump[key];
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = undefined; } }
      out[name] = v == null ? [] : v;
    }
    return out;
  }

  const FIELD_NOTES = {
    _conventions: 'Money fields end in Pesos (2dp). Rates 0..1 end in Rate; percentages 0..100 end in Pct. Quantities are product units (pieces, or metres/kg for soldBy=measure). ts fields are ISO UTC; date fields are YYYY-MM-DD in the store\'s time zone (Asia/Manila unless set).',
    stockouts: 'Per product, intervals where replayed stock was <= 0. start/end ISO, end null = still out; days fractional. A stockout that began before the movement log is not reported.',
    supplierLeadTimes: 'Per supplier, by the supplier on each PO line. lead days = latest line receivedOn (else receivedAt) date - (sentAt || orderedAt) date, n = POs with both. fillRate = receivedQty/qty over every PO where some of theirs arrived, cancelled ones included. invoiceGapPct = billed vs quoted cost on lines with invoiceCost.',
    cashAsleep: 'Per product in stock. idleDays = store days since the last sale not cancelled by a void (a refunded sale still counts), or since first movement when never sold (lastSaleAt null). pesoDays = stockPesos * idleDays, worst first.',
    sellThrough: 'Per delivery movement, FIFO against later outflows; stock that predates the log sells first. soldQty by sales net of voids and refunds (their units go back to the lot), otherOutQty by counts/damage/shrinkage. daysToClear null = not cleared yet.',
    deadStock: 'cashAsleep rows the Items page calls Dead: stock tracked, above its reorder point, idleDays >= days (90). One row per product (variant). totalPesos at cost.',
    cashTiedUp: 'Tracked stock on hand at cost (product cost; untracked items hold no stock value). Units are aged with the same oldest-sells-first walk as sellThrough: what is left of each stock-in lot, dated by happenedOn when set and different from the day it was typed, else ts, in store-local days. A void or refund return goes back to the lot its sale took from; opening stock and units the log does not reach are beforeLogQty, counted in 90+ and in every sittingOverPesos. oldestDays null when some stock predates the log. windows: last N store days incl. today. boughtPesos = delivery movements, soldAtCostPesos = sales minus returns, lostPesos = shrinkage/damage/writeoff and stock counts that came up short (the Inventory page numbers); each at the movement unitCost, else product cost. sittingOverPesos = stock value that has sat more than N days.',
    customerTotals: 'Per customer: orders (sales less voided ones), distinct order days, netSales (less voids and refunds), first and last order date (a voided sale is not an order; a refunded one is), days since last. Most recent first.',
    basketAffinity: 'Completed, unreturned orders. support = share of baskets with both; confidenceAtoB = P(b|a); countA/countB = baskets holding each; lift > 1 means bought together more than chance. categories uses product folder.',
    deliveryPoints: 'Completed/refunded delivery orders with a map pin. minutesToArrive = first dispatched to next arrived event (null without deliveryEvents).',
    countAccuracy: 'Per product with counts that kept expected and counted. meanAbsVariance = average |counted - expected| in units, biggest first. history = every count: expected, counted, variance, variancePct.',
    lostDemand: 'Unfilled requests grouped by productId (or typed text). qty = units asked. reasons and substitutes are counts.',
    priceHistory: 'Price and cost changes per product, oldest change first. changePct vs old value.',
  };

  function buildInsights(data = {}, { now = new Date().toISOString(), days = 90 } = {}) {
    const products = (data.products || []).map(normalizeProduct);
    const movements = data.movements || [];
    const purchaseOrders = (data.purchaseOrders || []).map((po) => ({ ...PO_DEFAULTS, ...po }));
    const suppliers = (data.suppliers || []).map((s) => ({ ...SUPPLIER_DEFAULTS, ...s }));
    const orders = SalesMath.upgradeOrders(data.orders);   // a raw dump may still hold old rows

    return {
      generatedAt: isoOf(now), apiVersion: 1, windowDays: days,
      sections: {
        stockouts: stockoutIntervals(products, movements, now),
        supplierLeadTimes: supplierLeadTimes(purchaseOrders, suppliers),
        cashAsleep: cashAsleep(products, movements, now, orders),
        cashTiedUp: cashTiedUp(products, movements, now),
        sellThrough: sellThrough(movements, purchaseOrders, products),
        deadStock: deadStock(products, movements, now, { orders }),
        customerTotals: customerTotals(orders, data.customers || [], now),
        basketAffinity: basketAffinity(orders, { products }),
        deliveryPoints: deliveryPoints(orders, data.deliveryEvents || []),
        countAccuracy: countAccuracy(movements),
        lostDemand: lostDemandSummary(data.lostDemand || []),
        priceHistory: priceHistory(data.priceLog || []),
      },
      fieldNotes: FIELD_NOTES,
    };
  }

  const API = { dayKey, dataFromDump,
    stockoutIntervals, supplierLeadTimes, cashAsleep, cashTiedUp, sellThrough, deadStock, perProduct, deadItems,
    customerTotals, basketAffinity, deliveryPoints, countAccuracy,
    lostDemandSummary, priceHistory, buildInsights };
  if (typeof module === 'object' && module.exports) { module.exports = API; return; }
  window.HWPOS_INSIGHTS = API;

  /* ================================ page renderer ====================================== */
  // Reads storage through the bo-model / backoffice.js loaders, passes the arrays to
  // buildInsights, renders plain tables. Nothing above this line may touch the DOM or storage.
  // It never writes.
  const VIEW = 'insights';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);
  // No Reorder plan, Supplier lead times or Price history tabs (owner, 2026-09-23): a forecast
  // needs context a POS doesn't have, lead times are columns on Suppliers, and the price log is
  // already on the item page and Stock history. The reorder forecast itself was removed 2026-09-27.
  const TABS = { cash: 'Stock value', stockouts: 'Stockouts', dead: 'Dead stock',
    sell: 'Sell-through',
    counts: 'Count accuracy', lost: 'Lost demand' };
  // Days & staff removed (owner, 2026-09-24): no weather log, no attendance join. Customer
  // cycles moved onto Customers the same day; Deliveries removed (Transactions has Fulfilment);
  // Basket affinity is Sales -> Bought together.
  const MOVED = { staff: ['staff', {}], days: ['staff', {}], cycles: ['customers', {}], basket: ['sales', { by: 'basket' }], deliveries: ['transactions', {}], reorder: ['products', { view: 'stock', level: 'out,low' }], leads: ['suppliers', {}],
    prices: ['inventory', { tab: 'prices' }] };
  const DEFAULT_TAB = 'cash';
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).insights = { param: 'tab', def: DEFAULT_TAB, items: Object.entries(TABS), groups: [
    ['Stock', ['cash', 'stockouts', 'dead', 'sell', 'counts', 'lost']],
  ] };

  function gather() {
    return {
      products: loadProducts(), groups: loadGroups(), folders: state.folders, orders: loadOrders(), customers: allCustomerRecords(),
      movements: loadMovements(), purchaseOrders: loadPurchaseOrders(), suppliers: loadSuppliers(),
      staff: loadStaff().map(({ pin, ...u }) => u),
      ...Object.fromEntries(Object.keys(EVENT_LOGS).map((k) => [k, loadEvents(k)])),
    };
  }

  /* ---- cells ---- */
  const DASH = '<span class="muted">—</span>';
  const txt = (v) => (v == null || v === '' ? DASH : escapeHtml(String(v)));
  const num = (v, unit = '') => (v == null ? DASH : `${v}${unit}`);
  const qty = (v) => (v == null ? DASH : SalesMath.qtyText(v));
  const pct = (rate) => (rate == null ? DASH : escapeHtml(SalesMath.pctText(rate, 1, 0)));
  const money = (v) => (v == null ? DASH : peso(v));
  // With the year: dead stock and old deliveries run past twelve months, and "Oct 1" can't say which.
  const day = (iso) => (iso ? escapeHtml(shortDate(iso)) : DASH);
  const sub = (main, second) => `${main}${second ? ` <span class="row-sub">${second}</span>` : ''}`;
  const pill = (tone, label) => `<span class="status-pill ${tone}">${escapeHtml(label)}</span>`;
  const counts = (obj, nameOf = (k) => k) => txt(Object.entries(obj || {}).map(([k, n]) => `${nameOf(k)} ×${n}`).join(', '));

  // cols: [label, cell(row) -> html, isNumber]
  function table(cols, rows, emptyMsg) {
    const td = (n) => (n ? ' class="num"' : '');
    const body = rows.length
      ? rows.map((r) => `<tr>${cols.map(([, cell, n]) => `<td${td(n)}>${cell(r)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" class="bo-empty">${escapeHtml(emptyMsg)}</td></tr>`;
    return `<table class="data-table"><thead><tr>${cols.map(([l, , n]) => `<th${td(n)}>${l}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function card(label, subText, cols, rows, emptyMsg, right = '') {
    const pg = paginate(rows, Router.route().params.page);
    const head = `
        <div class="bo-card-head">
          <span class="bo-card-label">${escapeHtml(label)}</span>
          <span class="bo-card-sub">${escapeHtml(subText)}</span>
          ${right}
        </div>`;
    // Nothing to show: the empty block (label + one centred line), not a table of headers.
    if (!rows.length) return `<section class="bo-card blk-empty">${head}<div class="bo-empty">${escapeHtml(emptyMsg)}</div></section>`;
    return `
      <section class="bo-card blk-table">${head}
        <div class="bo-card-inset flush"><div class="table-wrap">${table(cols, pg.rows, emptyMsg)}</div>${pagerHtml(pg)}</div>
      </section>`;
  }

  /* ---- one card per tab ---- */
  function tabCard(tab, ins, data, params) {
    const s = ins.sections;
    const nameOf = new Map(data.products.map((p) => [p.id, p.name]));
    const supOf = new Map(data.suppliers.map((x) => [x.id, x.name]));
    const product = (id) => txt(nameOf.get(id) || id);
    // Per product, as Items counts (perProduct); the name opens the item page, which lists the variants.
    const fams = (rows, add) => perProduct(rows, data.products, data.groups, add);
    const item = (r) => sub(`<a class="link-btn" href="${escapeHtml(Router.href('products', r.productId))}">${escapeHtml(r.name)}</a>`,
      r.family ? SalesMath.plural(r.members.length, 'variant') : '');
    const latest = (xs) => xs.filter(Boolean).sort().pop() || null;          // ISO text sorts as time
    const idleCols = [
      ['Item', item], ['Qty', (r) => qty(r.qty), 1], ['Cost', (r) => rangeText(r.variants.map((v) => v.costPesos), money), 1],
      ['Stock value', (r) => money(r.stockPesos), 1], ['Last sold', (r) => day(r.lastSaleAt), 1],
      ['Idle days', (r) => num(r.idleDays), 1], ['Stock value × days', (r) => num(r.pesoDays), 1]];

    switch (tab) {
      case 'stockouts': {
        // Now = bo-model familyLevel over the live variants, the Items pill: Out, Low (one out or at its
        // reorder point), else In stock. An archived variant is history: its stockouts count, not its stock.
        const NOW = { out: 0, low: 1, ok: 2 };   // sort order only; the pill is bo-model STOCK_LEVEL's
        // ponytail: no sale clock -- it only tells Dead from ok, and both read In stock here (backoffice.js does the same).
        const rows = fams(s.stockouts.rows, ['stockouts', 'daysOut']).map((f) => {
          const lv = f.members.length ? familyLevel(f.members, null) : 'ok', all = f.variants.flatMap((v) => v.intervals);
          return { ...f, now: lv, intervals: all.sort((a, b) => (a.start < b.start ? -1 : 1)) };
        }).filter((f) => f.stockouts || f.now !== 'ok').sort((a, b) => NOW[a.now] - NOW[b.now] || b.daysOut - a.daysOut);
        const last = (r) => r.intervals[r.intervals.length - 1] || {};
        return card('Stockouts', `${s.stockouts.totalDaysOut} item-days out, replayed from the movement log`, [
          ['Item', item], ['Now', (r) => pill(...STOCK_LEVEL[r.now])],
          ['Stockouts', (r) => num(r.stockouts), 1], ['Days out', (r) => num(r.daysOut), 1],
          ['Last ran out', (r) => day(last(r).start), 1], ['Back in', (r) => (last(r).start ? day(last(r).end) : DASH), 1],
        ], rows, 'Nothing has run out.');
      }
      case 'cash': {
        const c = s.cashTiedUp, win = new Map(c.windows.map((w) => [w.days, w]));
        const lastSale = new Map(s.cashAsleep.map((r) => [r.productId, r.lastSaleAt]));
        // The oldest stock of a family is its oldest variant's; any variant older than the log makes it "Before log".
        const rows = fams(c.rows, ['qty', 'stockPesos']).map((f) => ({ ...f,
          pesosByAge: Object.fromEntries(c.ageBuckets.map(({ label }) => [label, r2(sum(f.variants.map((v) => v.pesosByAge[label])))])),
          oldestDays: f.variants.some((v) => v.oldestDays == null) ? null : Math.max(...f.variants.map((v) => v.oldestDays)),
          lastSaleAt: latest(f.variants.map((v) => lastSale.get(v.productId))) }))
          .sort((a, b) => (b.oldestDays ?? Infinity) - (a.oldestDays ?? Infinity) || b.stockPesos - a.stockPesos);
        const note = (text) => ({ tone: 'flat', text, cmp: '' });
        const stat = (label, value, text) => statCell({ label, value: pesoShort(value), delta: note(text) });
        // A stat is its own card now (v34), so these are two grids under a plain head
        // rather than two inset bars inside one card. statCell is shared with the
        // dashboard and Sales; leaving this one wrapped would have nested card in card.
        const bar = (cells) => `<div class="stat-grid show-delta">${cells.join('')}</div>`;
        const w15 = win.get(15), w30 = win.get(30);
        const summary = `
            ${bar([stat('Stock value now', c.totalPesos, SalesMath.plural(rows.length, 'item')),
              stat('Sitting over 15 days', w15.sittingOverPesos, `${pctOf(w15.sittingOverPesos, c.totalPesos, 0)} of stock`),
              stat('Sitting over 30 days', w30.sittingOverPesos, `${pctOf(w30.sittingOverPesos, c.totalPesos, 0)} of stock`)])}
            ${bar([stat('Bought, last 15 days', w15.boughtPesos, `${peso(w15.soldAtCostPesos)} sold at cost`),
              stat('Bought, last 30 days', w30.boughtPesos, `${peso(w30.soldAtCostPesos)} sold at cost`),
              stat('Lost, last 30 days', w30.lostPesos, 'stolen, broken, written off or counted short')])}`;
        return summary + card('By item', c.ageBuckets.map((b) => `${b.label}d ${peso(b.pesos)}`).join(' · '), [
          ['Item', item], ['Qty', (r) => qty(r.qty), 1], ['Stock value', (r) => money(r.stockPesos), 1],
          ...c.ageBuckets.map((b) => [`${b.label} days`, (r) => (r.pesosByAge[b.label] ? money(r.pesosByAge[b.label]) : DASH), 1]),
          ['Oldest', (r) => (r.oldestDays == null ? 'Before log' : num(r.oldestDays, 'd')), 1], ['Last sold', (r) => day(r.lastSaleAt), 1],
        ], rows, 'No stock on hand.');
      }
      case 'dead': {
        // Dead when every variant is (familyLevel), so the count is the Items Dead tile's.
        const rows = deadItems(s.deadStock.rows, data.products, data.groups, ['qty', 'stockPesos', 'pesoDays']).map((f) => ({ ...f,
          lastSaleAt: latest(f.variants.map((v) => v.lastSaleAt)), idleDays: Math.min(...f.variants.map((v) => v.idleDays)) }))
          .sort((a, b) => b.stockPesos - a.stockPesos);   // a Dead variant always has a clock, so idleDays
        return card('Dead stock', `${SalesMath.plural(rows.length, 'item')} unsold ${s.deadStock.days}+ days · ${peso(r2(sum(rows.map((r) => r.stockPesos))))} at cost`,
          idleCols, rows, `Nothing has sat unsold for ${s.deadStock.days} days.`);
      }
      case 'sell': {
        const rows = [...s.sellThrough].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        return card('Sell-through', 'Each delivery, drained oldest first', [
          ['Received', (r) => sub(day(r.receivedAt), escapeHtml(r.poNumber))], ['Item', (r) => product(r.productId)],
          ['Supplier', (r) => txt(supOf.get(r.supplierId))], ['Qty in', (r) => qty(r.qtyReceived), 1],
          ['Units sold', (r) => qty(r.soldQty), 1], ['Other out', (r) => qty(r.otherOutQty), 1], ['Left', (r) => qty(r.remainingQty), 1],
          ['Cleared', (r) => day(r.clearedAt), 1], ['Days to clear', (r) => num(r.daysToClear), 1],
        ], rows, 'No deliveries logged.');
      }
      case 'basket': {
        const by = params.pairs === 'categories' ? 'categories' : 'products';
        const label = (id, name) => txt(by === 'categories' ? folderName(id) : name);
        const toggle = `<div class="seg">${[['products', 'Items'], ['categories', 'Categories']].map(([k, l]) =>
          `<button class="seg-btn${k === by ? ' active' : ''}" data-pairs="${k}">${l}</button>`).join('')}</div>`;
        return card('Bought together', `${s.basketAffinity.baskets} baskets · pairs seen 3+ times, highest lift first`, [
          ['Item A', (r) => label(r.a, r.aName)], ['Item B', (r) => label(r.b, r.bName)], ['Baskets', (r) => num(r.count), 1],
          ['Support', (r) => pct(r.support), 1], ['A then B', (r) => pct(r.confidenceAtoB), 1],
          ['B then A', (r) => pct(r.confidenceBtoA), 1], ['Lift', (r) => num(r.lift), 1],
        ], s.basketAffinity[by], 'No pair bought together often enough yet.', toggle);
      }
      case 'counts': {
        // A family's mean miss is over every count of its variants, not an average of averages.
        const rows = fams(s.countAccuracy, ['counts']).map((f) => ({ ...f, lastCountedAt: latest(f.variants.map((v) => v.lastCountedAt)),
          meanAbsVariance: r2(mean(f.variants.flatMap((v) => v.history.map((h) => Math.abs(h.variance))))) }))
          .sort((a, b) => b.meanAbsVariance - a.meanAbsVariance);
        return card('Count accuracy', 'Biggest average miss first', [
          ['Item', item], ['Counts', (r) => num(r.counts), 1], ['Last counted', (r) => day(r.lastCountedAt), 1],
          ['Mean miss', (r) => num(r.meanAbsVariance), 1],
        ], rows, 'No stock counts with an expected quantity yet.');
      }
      case 'lost': {
        // Asked-for items per product; a typed request with no item stays its own row.
        const add = (objs) => objs.reduce((o, x) => { Object.entries(x || {}).forEach(([k, n]) => { o[k] = (o[k] || 0) + n; }); return o; }, {});
        const first = (xs) => xs.filter(Boolean).sort()[0] || null;
        const rows = [...fams(s.lostDemand.filter((r) => r.productId), ['requests', 'qty']).map((f) => ({ ...f,
          reasons: add(f.variants.map((v) => v.reasons)), substitutes: add(f.variants.map((v) => v.substitutes)),
          firstAt: first(f.variants.map((v) => v.firstAt)), lastAt: latest(f.variants.map((v) => v.lastAt)) })),
        ...s.lostDemand.filter((r) => !r.productId)].sort((a, b) => b.requests - a.requests || b.qty - a.qty);
        return card('Lost demand', 'What customers asked for and did not get', [
          ['Item', (r) => (r.productId ? item(r) : txt(r.text))], ['Requests', (r) => num(r.requests), 1],
          ['Qty asked', (r) => qty(r.qty), 1], ['Reasons', (r) => counts(r.reasons)],
          ['Took instead', (r) => counts(r.substitutes, (id) => nameOf.get(id) || id)],
          ['First', (r) => day(r.firstAt), 1], ['Last', (r) => day(r.lastAt), 1],
        ], rows, 'No lost sales logged.');
      }
    }
    return '';
  }

  // One tab's card as an HTML string, for pages outside Analytics (Stock history renders
  // lost and counts). Plain markup: its pager is the global one, no hook to run after.
  API.card = (tab, params = Router.route().params) => {
    const data = gather();
    return tabCard(tab, buildInsights(data, { now: new Date().toISOString() }), data, params);
  };

  function render() {
    const el = root();
    if (!el) return;
    refreshSharedState();
    const params = Router.route().params;
    if (MOVED[params.tab]) return Router.go(MOVED[params.tab][0], '', MOVED[params.tab][1], { replace: true });   // old Buying links
    const tab = TABS[params.tab] ? params.tab : DEFAULT_TAB;
    const data = gather();
    // ponytail: rebuilt on every paint. Cache on a storage version once a year of movements
    // makes tab switching feel slow.
    const inner = tabCard(tab, buildInsights(data, { now: new Date().toISOString() }), data, params);
    el.innerHTML = `
      <div class="view-head">
        <div class="view-title-wrap">
          <h1>${TABS[tab]}</h1>
        </div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="export-ai">Export for AI</button>
        </div>
      </div>
      <div class="dash-stack">${inner}</div>`;
  }

  /* ---- the one action ---- */
  async function exportForAi() {
    refreshSharedState();
    const data = gather(), now = new Date().toISOString();
    let snap = null, tillEvents = [];
    try { snap = window.HWPOS_AI && typeof HWPOS_AI.snapshot === 'function' ? HWPOS_AI.snapshot() : null; } catch (_) { snap = null; }
    // IndexedDB on this browser only: a tablet's taps reach here once sync exists.
    try { if (window.HWPOS_AI && typeof HWPOS_AI.tillEvents === 'function') tillEvents = await HWPOS_AI.tillEvents(); } catch (_) {}
    // Rebuilt from gather() so the export matches the tab on screen; the snapshot builds the same from raw orders.
    downloadJson(`hwpos-ai-${dayKey(now)}.json`,
      { ...(snap || data), tillEvents, insights: buildInsights(data, { now }), dictionary: 'docs/data-dictionary.md', exportedAt: now });
    showToast('AI export downloaded');
  }

  /* ---- one listener per event type ---- */
  const mine = (e) => { const r = root(); return r && r.contains(e.target) ? r : null; };

  document.addEventListener('click', (e) => {
    // The Bought together toggle, wherever the card is drawn (Sales).
    const p = e.target.closest && e.target.closest('[data-pairs]');
    if (p) return Router.setParams({ pairs: p.dataset.pairs === 'products' ? '' : p.dataset.pairs, page: '' });
    if (!mine(e)) return;
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.act === 'export-ai') return exportForAi();
  });

  window.renderInsights = render;
})();
