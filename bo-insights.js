/* Back office — Insights. Tier 0 of docs/data-roadmap.md: reads, not captures.

   Everything above the seam is a pure function over plain arrays -- products, the movement
   log, purchase orders, suppliers, orders, customers and the event logs --
   with an explicit `now`. Nothing here reads storage; the caller loads and passes. Every
   return is plain JSON with the unit in the field name (dailyRate is units/day, leadDays,
   pesos, pct 0..100, rate 0..1), so an AI can read `buildInsights()` without this file.

   Order status rules are the ones backoffice.js SALE_SIGN encodes: completed +1, return -1,
   voided/refunded/saved 0 (the original was flipped in place, so it contributes nothing).
   Uses bo-model.js globals: cent, round2, stepFor, normalizeProduct, SUPPLIER_DEFAULTS,
   PO_DEFAULTS, EVENT_LOGS. */
(function () {
  /* ================= pure logic (exported for scripts/insights-check.mjs) ============= */

  // ponytail: one fixed store clock, Manila (UTC+8). Make it a per-store setting the day a
  // store outside UTC+8 exists. Every date key below comes out of dayKey, so it is one edit.
  const TZ_MIN = 480;
  const DAY_MS = 864e5;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const sd = (a) => {                                   // sample sd; one point has no spread
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  };
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), h = Math.floor(s.length / 2);
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };

  // Orders carry epoch ms, movements ISO strings, purchase orders sometimes a bare date.
  // A bare date is store-local midnight.
  const toMs = (ts) => (typeof ts === 'number' ? ts
    : DATE_ONLY.test(ts || '') ? Date.parse(ts + 'T00:00:00Z') - TZ_MIN * 60000 : Date.parse(ts));
  const dayKey = (ts) => (DATE_ONLY.test(typeof ts === 'string' ? ts : '') ? ts
    : new Date(toMs(ts) + TZ_MIN * 60000).toISOString().slice(0, 10));
  const dayNum = (key) => Math.round(Date.parse(key + 'T00:00:00Z') / DAY_MS);
  const keyOfDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
  const dayOpenMs = (n) => n * DAY_MS - TZ_MIN * 60000;          // store-local 00:00 of day n
  const dayStartIso = (n) => new Date(dayOpenMs(n)).toISOString();
  const isoOf = (ts) => new Date(toMs(ts)).toISOString();
  // A row with no readable ts has no date to join on; skipped rather than thrown on.
  const hasTs = (x) => Number.isFinite(toMs(x && x.ts));

  // A movement's real date: happenedOn when it's a valid date AND differs from the day it was
  // typed in (so an ordinary same-day row is untouched); otherwise ts, as always. toMs/dayKey/
  // isoOf all already accept a date-only string as store-local midnight, so `when(m)` drops
  // straight into every place below that used to read `m.ts`.
  const when = (m) => (DATE_ONLY.test((m && m.happenedOn) || '') && m.happenedOn !== dayKey(m.ts) ? m.happenedOn : m.ts);

  // Same table as backoffice.js SALE_SIGN; copied because the POS and node load this without it.
  const SIGN = { completed: 1, return: -1, refunded: 0, voided: 0, saved: 0 };
  const saleSign = (o) => SIGN[o.status || 'completed'] ?? 0;

  // Copy of bo-inventory.js ceilStep (not a browser global there).
  const ceilStep = (n, step) => (step === 1 ? Math.ceil(n - 1e-9) : r2(Math.ceil(n / step - 1e-9) * step));

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

  // Day numbers the product OPENED empty (out at store-local midnight).
  // ponytail: day granularity -- the sell-out day stays in, its sales were real. Hourly
  // censoring when trading hours are known.
  function outDayNums(intervals, nowMs) {
    const set = new Set();
    for (const iv of intervals || []) {
      const s = toMs(iv.start), e = iv.end ? toMs(iv.end) : nowMs;
      for (let d = dayNum(dayKey(iv.start)); dayOpenMs(d) < e; d++) if (dayOpenMs(d) >= s) set.add(d);
    }
    return set;
  }

  /* ---- 2. Supplier lead time and reliability ---- */
  function supplierLeadTimes(purchaseOrders, suppliers) {
    const by = new Map((suppliers || []).map((s) => [s.id, { s, pos: [] }]));
    for (const po of purchaseOrders || []) {
      if (!by.has(po.supplierId)) by.set(po.supplierId, { s: { id: po.supplierId }, pos: [] });
      by.get(po.supplierId).pos.push(po);
    }
    return [...by.values()].map(({ s, pos }) => {
      const leads = [], onTime = [], shortReasons = {};
      let ordered = 0, received = 0, quotedC = 0, invoiceC = 0, invoiceLines = 0;
      for (const po of pos) {
        const sent = po.sentAt || po.orderedAt, promise = po.promisedAt || po.expectedAt;
        if (po.receivedAt && sent) {
          const lead = dayNum(dayKey(po.receivedAt)) - dayNum(dayKey(sent));
          if (lead >= 0) leads.push(lead);
        }
        if (po.receivedAt && promise) onTime.push(dayKey(po.receivedAt) <= dayKey(promise));
        // A 'received' PO is full by definition (receivePo); the short ships live in 'partial'.
        if (po.status !== 'received' && po.status !== 'partial') continue;
        for (const l of po.items || []) {
          const q = Number(l.qty) || 0, got = Number(l.receivedQty) || 0;
          ordered += q; received += got;
          if (got < q && l.shortReason) shortReasons[l.shortReason] = (shortReasons[l.shortReason] || 0) + 1;
          if (l.invoiceCost != null && l.invoiceCost !== '') {
            const units = got || q;
            quotedC += cent(l.cost) * units; invoiceC += cent(l.invoiceCost) * units; invoiceLines++;
          }
        }
      }
      return {
        supplierId: s.id, name: s.name || '', quotedLeadDays: Number(s.quotedLeadDays) || 0,
        orderDays: s.orderDays || [], minOrderPesos: Number(s.minOrder) || 0,
        purchaseOrders: pos.length, n: leads.length,
        leadDaysMean: leads.length ? r2(mean(leads)) : null, leadDaysSd: leads.length ? r2(sd(leads)) : null,
        leadDaysMin: leads.length ? Math.min(...leads) : null, leadDaysMax: leads.length ? Math.max(...leads) : null,
        onTimeRate: onTime.length ? r3(onTime.filter(Boolean).length / onTime.length) : null,
        fillRate: ordered ? r3(received / ordered) : null,
        invoiceLines, invoiceGapPct: quotedC ? r2(((invoiceC - quotedC) / quotedC) * 100) : null, shortReasons,
      };
    });
  }

  /* ---- 3. Demand rate over IN-STOCK days only ---- */
  // Sales are demand minus what could not be served. A day that opened empty is dropped, not
  // counted as zero, or every stockout teaches the next order to be smaller.
  function demandStats(products, movements, now, { days = 90, stockouts } = {}) {
    const nowMs = toMs(now), today = dayNum(dayKey(now));
    const so = stockouts || stockoutIntervals(products, movements, now);
    const outBy = new Map(so.rows.map((r) => [r.productId, outDayNums(r.intervals, nowMs)]));
    const by = movesByProduct(movements);
    return (products || []).map((p) => {
      const list = (by.get(p.id) || []).filter((m) => toMs(when(m)) < nowMs);
      // A product first stocked 20 days ago has 20 days of history, not 70 zero days.
      const from = Math.max(today - days, list.length ? dayNum(dayKey(when(list[0]))) : today);
      const sold = new Map();
      // ponytail: returns are not netted; they land days after the sale and go back on the shelf.
      for (const m of list) {
        if (m.reason !== 'sale') continue;
        const d = dayNum(dayKey(when(m)));
        if (d >= from && d < today) sold.set(d, (sold.get(d) || 0) - (Number(m.qty) || 0));
      }
      const out = outBy.get(p.id) || new Set(), all = [], series = [];
      for (let d = from; d < today; d++) {             // complete days only; today is half a day
        const q = r2(sold.get(d) || 0);
        all.push(q);
        if (!out.has(d)) series.push(q);
      }
      const nz = series.filter((q) => q > 0);
      const sizeMean = mean(nz);
      const adi = nz.length ? series.length / nz.length : null;
      const cv2 = nz.length ? mean(nz.map((q) => (q - sizeMean) ** 2)) / (sizeMean * sizeMean) : null;
      // Syntetos-Boylan cut-offs: how often it sells (ADI) against how much the size swings (CV²).
      const pattern = !nz.length ? 'none' : adi < 1.32 ? (cv2 < 0.49 ? 'smooth' : 'erratic')
        : (cv2 < 0.49 ? 'intermittent' : 'lumpy');
      return {
        productId: p.id, name: p.name || '', windowDays: all.length, inStockDays: series.length,
        daysOut: all.length - series.length, unitsSold: r2(sum(all)), demandDays: nz.length,
        dailyRate: r3(mean(series)), sdDaily: r3(sd(series)), uncensoredDailyRate: r3(mean(all)),
        adi: adi == null ? null : r2(adi), cv2: cv2 == null ? null : r2(cv2), pattern,
      };
    });
  }

  /* ---- 4. A real reorder point ---- */
  const Z = [[0.8, 0.842], [0.85, 1.036], [0.9, 1.282], [0.95, 1.645], [0.975, 1.96], [0.98, 2.054], [0.99, 2.326], [0.995, 2.576]];
  const zFor = (sl) => Z.reduce((best, row) => (Math.abs(row[0] - sl) < Math.abs(best[0] - sl) ? row : best))[1];
  // ponytail: thresholds, not a fitted model. Tune against scripts/backtest.mjs.
  const MIN_HISTORY_DAYS = 14;
  const DEFAULT_LEAD_DAYS = 7;

  // Longest gap between the weekdays a supplier takes orders (0 = Sunday). Longest, not
  // average: stock has to last until the next chance to order, whichever gap that is.
  function reviewDaysFor(orderDays) {
    const d = [...new Set((orderDays || []).map(Number).filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b);
    if (!d.length) return 7;
    return Math.max(...d.map((x, i) => ((d[(i + 1) % d.length] - x + 6) % 7) + 1));
  }

  // (s, S) with lead-time variance: safety = z·√((L+R)·σd² + d²·σL²), reorder at d·L + safety,
  // top up to d·(L+R) + safety. Replaces bo-inventory.js suggestQty (2× a typed danger level).
  function reorderPlan(product, ctx = {}) {
    const p = product, step = stepFor(p);
    const { demand, lead, supplier, serviceLevel = 0.95 } = ctx;
    const onOrder = Number(ctx.onOrder) || 0, stock = Number(p.stock) || 0, position = r2(stock + onOrder);
    const reviewDays = Number(ctx.reviewDays) || reviewDaysFor((supplier || lead || {}).orderDays);
    const quoted = Number((supplier || lead || {}).quotedLeadDays) || 0;
    const measured = !!(lead && lead.n > 0);
    const leadDays = measured ? lead.leadDaysMean : quoted || DEFAULT_LEAD_DAYS;
    const sdLead = measured ? lead.leadDaysSd || 0 : 0;
    const base = { productId: p.id, name: p.name || '', supplierId: p.supplierId || '', stock, onOrder, position,
      leadDays, leadDaysSd: sdLead, leadBasis: measured ? 'measured' : quoted ? 'quoted' : 'default', reviewDays, serviceLevel };
    const done = (o) => ({ ...base, ...o, cashPesos: r2((cent(p.cost) * o.suggestQty) / 100) });

    if (!demand || demand.inStockDays < MIN_HISTORY_DAYS) {
      const rp = Number(p.reorderPoint) || 0;
      const q = position <= rp ? ceilStep(Math.max(rp * 2 - position, step), step) : 0;
      return done({ dailyRate: null, sdDaily: null, safetyStock: null, reorderPoint: rp, orderUpTo: rp * 2,
        suggestQty: q, basis: 'fallback', confidence: 'low',
        reason: `Only ${demand ? demand.inStockDays : 0} in-stock days of sales, so this tops up to twice the danger level of ${rp}.` });
    }
    const d = demand.dailyRate, sdD = demand.sdDaily, L = leadDays, R = reviewDays;
    const safety = zFor(serviceLevel) * Math.sqrt((L + R) * sdD * sdD + d * d * sdLead * sdLead);
    const rop = r2(d * L + safety), upTo = r2(d * (L + R) + safety);
    const q = position <= rop && upTo > position ? ceilStep(upTo - position, step) : 0;
    const confidence = demand.inStockDays >= 60 && demand.demandDays >= 10 && lead && lead.n >= 3 ? 'high'
      : demand.inStockDays >= 30 && demand.demandDays >= 3 ? 'medium' : 'low';
    const unit = p.unit || 'pc';
    const reason = q > 0
      ? `Sells ${d} ${unit}/day over ${demand.inStockDays} in-stock days; a ${L}-day lead plus ${R} days to the next order needs ${upTo}, ${position} on hand or coming, so order ${q}.`
      : `${position} on hand or coming is above the reorder point of ${rop} (${d} ${unit}/day, ${L}-day lead), so nothing to order.`;
    return done({ dailyRate: d, sdDaily: sdD, safetyStock: r2(safety), reorderPoint: rop, orderUpTo: upTo,
      suggestQty: q, basis: 'history', confidence, reason });
  }

  // Units already ordered and not yet in, per product. Counted so nothing is bought twice.
  function onOrderBy(purchaseOrders) {
    const m = new Map();
    for (const po of purchaseOrders || []) {
      if (po.status !== 'ordered' && po.status !== 'partial') continue;
      for (const l of po.items || []) {
        const left = Math.max(0, (Number(l.qty) || 0) - (Number(l.receivedQty) || 0));
        if (left) m.set(l.productId, r2((m.get(l.productId) || 0) + left));
      }
    }
    return m;
  }

  /* ---- 5 & 7. Cash asleep and dead stock ---- */
  function cashAsleep(products, movements, now) {
    const nowMs = toMs(now), idx = new Map();
    for (const m of movements || []) {
      const ms = toMs(when(m));
      if (!Number.isFinite(ms)) continue;
      const r = idx.get(m.productId) || { firstMs: ms, lastSaleMs: null };
      if (ms < r.firstMs) r.firstMs = ms;
      if (m.reason === 'sale' && (r.lastSaleMs == null || ms > r.lastSaleMs)) r.lastSaleMs = ms;
      idx.set(m.productId, r);
    }
    return (products || []).filter((p) => !p.archived && Number(p.stock) > 0).map((p) => {
      const h = idx.get(p.id), since = h ? (h.lastSaleMs ?? h.firstMs) : null;
      const stockPesos = r2((cent(p.cost) * Number(p.stock)) / 100);
      const idleDays = since == null ? null : Math.max(0, Math.floor((nowMs - since) / DAY_MS));
      return { productId: p.id, name: p.name || '', qty: Number(p.stock), costPesos: round2(p.cost), stockPesos,
        lastSaleAt: h && h.lastSaleMs != null ? isoOf(h.lastSaleMs) : null, idleDays,
        pesoDays: Math.round(stockPesos * (idleDays || 0)) };
    }).sort((a, b) => b.pesoDays - a.pesoDays || b.stockPesos - a.stockPesos);
  }

  function deadStock(products, movements, now, { days = 90 } = {}) {
    const rows = cashAsleep(products, movements, now).filter((r) => r.idleDays != null && r.idleDays >= days)
      .sort((a, b) => b.stockPesos - a.stockPesos);
    return { days, totalPesos: r2(sum(rows.map((r) => r.stockPesos))), rows };
  }

  /* ---- 5b. Cash tied up: stock at cost by how long it has sat, and money in and out per window ---- */
  // Oldest sells first, so what is on the shelf is the newest stock: walk the stock-in rows
  // newest first until today's stock is covered, and each unit is as old as the row it came in on.
  // Stock the log doesn't reach predates it and goes in the oldest bucket.
  // A return is old stock going back on the shelf (app.js restoreOrderStock, voids/refunds),
  // not fresh stock arriving -- it must not start a new age layer, or a customer return makes
  // 90-day-old stock read as 0 days old. Every other positive row (delivery, opening stock,
  // counts) still starts a layer dated `when(m)`.
  const AGE_BUCKETS = [['0-15', 0, 15], ['16-30', 16, 30], ['31-60', 31, 60], ['61-90', 61, 90], ['90+', 91, Infinity]];
  const LOSS_REASONS = new Set(['shrinkage', 'damage', 'writeoff']);
  function cashTiedUp(products, movements, now, { windows = [15, 30] } = {}) {
    const today = dayNum(dayKey(now)), moves = movesByProduct(movements);
    const bucketOf = (age) => AGE_BUCKETS.findIndex(([, lo, hi]) => age >= lo && age <= hi);
    const total = AGE_BUCKETS.map(() => 0), over = windows.map(() => 0);           // centavos
    const flow = windows.map((days) => ({ days, boughtC: 0, soldC: 0, lostC: 0 }));
    const rows = [];
    for (const p of products || []) {
      const list = moves.get(p.id) || [], costC = cent(p.cost);
      const at = (m) => (m.unitCost != null ? cent(m.unitCost) : costC) * Math.abs(Number(m.qty) || 0);
      for (const m of list) {
        const age = today - dayNum(dayKey(when(m)));
        flow.forEach((f) => {
          if (age >= f.days) return;                    // the window is the last N store days, today included
          if (m.reason === 'delivery') f.boughtC += at(m);
          else if (m.reason === 'sale') f.soldC += Number(m.qty) < 0 ? at(m) : -at(m);
          else if (m.reason === 'return') f.soldC -= at(m);
          else if (LOSS_REASONS.has(m.reason)) f.lostC += at(m);
        });
      }
      const stock = Number(p.stock) || 0;
      if (p.archived || stock <= 0) continue;
      const byAge = AGE_BUCKETS.map(() => 0), overQty = windows.map(() => 0);
      let left = stock, oldestDays = 0;
      for (let i = list.length - 1; i >= 0 && left > 1e-9; i--) {
        const q = Number(list[i].qty) || 0;
        if (q <= 0 || list[i].reason === 'return') continue;
        const take = Math.min(q, left), age = Math.max(0, today - dayNum(dayKey(when(list[i]))));
        byAge[bucketOf(age)] += take; left = r3(left - take); oldestDays = age;
        windows.forEach((days, w) => { if (age > days) overQty[w] += take; });
      }
      const beforeLogQty = r3(Math.max(0, left));             // has sat longer than any window
      byAge[AGE_BUCKETS.length - 1] += beforeLogQty;
      byAge.forEach((q, b) => { total[b] += Math.round(q * costC); });
      overQty.forEach((q, w) => { over[w] += Math.round((q + beforeLogQty) * costC); });
      rows.push({ productId: p.id, name: p.name || '', qty: stock, costPesos: round2(p.cost),
        stockPesos: r2((costC * stock) / 100), oldestDays: beforeLogQty > 0 ? null : oldestDays, beforeLogQty,
        pesosByAge: Object.fromEntries(AGE_BUCKETS.map(([label], b) => [label, r2((byAge[b] * costC) / 100)])) });
    }
    return {
      totalPesos: r2(sum(total) / 100),
      ageBuckets: AGE_BUCKETS.map(([label, fromDays, toDays], b) =>
        ({ label, fromDays, toDays: toDays === Infinity ? null : toDays, pesos: r2(total[b] / 100) })),
      windows: flow.map((f, w) => ({ days: f.days, boughtPesos: r2(f.boughtC / 100), soldAtCostPesos: r2(f.soldC / 100),
        lostPesos: r2(f.lostC / 100), sittingOverPesos: r2(over[w] / 100) })),
      rows: rows.sort((a, b) => (b.oldestDays ?? Infinity) - (a.oldestDays ?? Infinity) || b.stockPesos - a.stockPesos),
    };
  }

  /* ---- 6. Sell-through per delivery, FIFO ---- */
  // Every positive movement is a lot (the opening count too, or the first delivery would be
  // blamed for selling stock that was already there); every negative one drains the oldest.
  // ponytail: assumes the log starts from an empty shelf, as the seed and a new store do.
  // Stock on hand before the first logged movement (stock minus every logged qty) is the oldest lot.
  function sellThrough(movements, purchaseOrders = [], products = []) {
    const poBy = new Map((purchaseOrders || []).map((po) => [po.id, po]));
    const stockOf = new Map((products || []).map((p) => [p.id, Number(p.stock) || 0]));
    const rows = [];
    for (const [productId, list] of movesByProduct(movements)) {
      const opening = stockOf.has(productId) ? r2(stockOf.get(productId) - sum(list.map((m) => Number(m.qty) || 0))) : 0;
      const lots = opening > 0 ? [{ row: null, left: opening }] : [];
      for (const m of list) {
        const q = Number(m.qty) || 0;
        if (q > 0) {
          let row = null;
          if (m.reason === 'delivery') {
            const po = poBy.get(m.refId);
            row = { movementId: m.id, productId, poId: m.refId || '', poNumber: po ? po.number : '',
              supplierId: po ? po.supplierId : '', receivedAt: isoOf(when(m)), qtyReceived: q,
              soldQty: 0, otherOutQty: 0, remainingQty: q, clearedAt: null, daysToClear: null };
            rows.push(row);
          }
          lots.push({ row, left: q });
          continue;
        }
        let need = -q;
        while (need > 1e-9 && lots.length) {
          const lot = lots[0], take = Math.min(lot.left, need);
          lot.left = r2(lot.left - take); need = r2(need - take);
          if (lot.row) {
            if (m.reason === 'sale') lot.row.soldQty = r2(lot.row.soldQty + take);
            else lot.row.otherOutQty = r2(lot.row.otherOutQty + take);
            lot.row.remainingQty = lot.left;
            if (lot.left <= 0) { lot.row.clearedAt = isoOf(when(m)); lot.row.daysToClear = r2((toMs(when(m)) - toMs(lot.row.receivedAt)) / DAY_MS); }
          }
          if (lot.left <= 0) lots.shift();
        }
      }
    }
    return rows;
  }

  /* ---- 8. Customer reorder cycles ---- */
  function customerCycles(orders, customers = [], now) {
    const today = dayNum(dayKey(now)), info = new Map((customers || []).map((c) => [c.id, c])), by = new Map();
    for (const o of orders || []) {
      const id = (o.customer && o.customer.id) || o.customerId;
      if (!id || saleSign(o) !== 1 || !hasTs(o)) continue;
      const r = by.get(id) || { days: new Set(), orders: 0, c: 0, name: (o.customer && o.customer.name) || '' };
      r.days.add(dayNum(dayKey(o.ts))); r.orders++; r.c += cent(o.total);
      by.set(id, r);
    }
    const RANK = { overdue: 0, due: 1, ok: 2, unknown: 3 };
    return [...by].map(([id, r]) => {
      const d = [...r.days].sort((a, b) => a - b), last = d[d.length - 1];
      const gaps = d.slice(1).map((x, i) => x - d[i]), med = median(gaps), since = today - last;
      // ponytail: two gaps is the least that says "cycle"; fewer is a guess, not a due date.
      const status = gaps.length < 2 ? 'unknown' : since > med * 1.5 ? 'overdue' : since >= med ? 'due' : 'ok';
      const c = info.get(id) || {};
      return { customerId: id, name: c.name || r.name, phone: c.phone || '', orders: r.orders, orderDays: d.length,
        revenuePesos: r2(r.c / 100), firstOrderDate: keyOfDay(d[0]), lastOrderDate: keyOfDay(last),
        medianGapDays: med, daysSinceLast: since, dueDate: med == null ? null : keyOfDay(last + Math.round(med)), status };
    }).sort((a, b) => RANK[a.status] - RANK[b.status] || b.daysSinceLast - a.daysSinceLast);
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
      rows.push({ a, b, aName: nameOf.get(a) || a, bName: nameOf.get(b) || b, count: c,
        support: r3(c / N), confidenceAtoB: r3(c / ca), confidenceBtoA: r3(c / cb), lift: r2((c * N) / (ca * cb)) });
    }
    return rows.sort((x, y) => y.lift - x.lift || y.count - x.count).slice(0, top);
  }

  function basketAffinity(orders, { minSupport = 0, minCount = 3, top = 50, products = [] } = {}) {
    const folderOf = new Map((products || []).map((p) => [p.id, p.folder || '']));
    const nameOf = new Map((products || []).map((p) => [p.id, p.name]));
    // A return leaves the original 'completed'; the basket did not really leave the shop.
    const returned = new Set((orders || []).filter((o) => o.status === 'return').map((o) => o.originalOrderId));
    const baskets = [];
    for (const o of orders || []) {
      if (saleSign(o) !== 1 || returned.has(o.id)) continue;
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
    const ev = new Map();
    (deliveryEvents || []).filter(hasTs).sort((a, b) => toMs(a.ts) - toMs(b.ts)).forEach((e) => {
      const l = ev.get(e.orderId); if (l) l.push(e); else ev.set(e.orderId, [e]);
    });
    return (orders || []).filter((o) => hasTs(o) && o.fulfilment === 'delivery' && o.deliveryLocation
      && Number.isFinite(Number(o.deliveryLocation.lat)) && Number.isFinite(Number(o.deliveryLocation.lng))
      && ['completed', 'refunded'].includes(o.status || 'completed'))
      .map((o) => {
        const list = ev.get(o.id) || [];
        const sent = list.find((e) => e.event === 'dispatched');
        const arrived = list.find((e) => e.event === 'arrived' && (!sent || toMs(e.ts) >= toMs(sent.ts)));
        const last = list[list.length - 1];
        return { orderId: o.id, number: o.number || '', ts: isoOf(o.ts), date: dayKey(o.ts),
          lat: Number(o.deliveryLocation.lat), lng: Number(o.deliveryLocation.lng), totalPesos: round2(o.total),
          customerId: (o.customer && o.customer.id) || '', driver: ((sent || last) && (sent || last).driver) || '',
          dispatchedAt: sent ? isoOf(sent.ts) : null, arrivedAt: arrived ? isoOf(arrived.ts) : null,
          minutesToArrive: sent && arrived ? Math.round((toMs(arrived.ts) - toMs(sent.ts)) / 6000) / 10 : null,
          lastEvent: last ? last.event : '' };
      });
  }

  /* ---- 12. Count accuracy ---- */
  // Each count scores 1 - |counted - expected| / max(expected, counted, 1). Confidence is the
  // mean of the last five, shrunk by n/(n+1): one perfect count is 0.5, not certainty.
  function countAccuracy(movements) {
    const by = new Map();
    for (const [productId, list] of movesByProduct(movements)) {
      for (const m of list) {
        if (m.reason !== 'count' || m.expected == null || m.counted == null) continue;
        const expected = Number(m.expected) || 0, counted = Number(m.counted) || 0, variance = r2(counted - expected);
        const h = by.get(productId) || [];
        h.push({ ts: isoOf(when(m)), expected, counted, variance, variancePct: expected ? r2((variance / expected) * 100) : null,
          accuracy: 1 - Math.min(1, Math.abs(variance) / Math.max(Math.abs(expected), Math.abs(counted), 1)), staff: m.staff || '' });
        by.set(productId, h);
      }
    }
    return [...by].map(([productId, history]) => {
      const recent = history.slice(-5);
      return { productId, counts: history.length, lastCountedAt: history[history.length - 1].ts,
        meanAbsVariance: r2(mean(history.map((h) => Math.abs(h.variance)))),
        confidence: r2((mean(recent.map((h) => h.accuracy)) * recent.length) / (recent.length + 1)),
        history: history.map((h) => ({ ...h, accuracy: r3(h.accuracy) })) };
    }).sort((a, b) => a.confidence - b.confidence);
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
        changePct: e.old ? r2(((e.new - e.old) / e.old) * 100) : null, reason: e.reason || '', source: e.source || '', staff: e.staff || '' });
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
    _conventions: 'Money fields end in Pesos (2dp). Rates 0..1 end in Rate; percentages 0..100 end in Pct. dailyRate is product units per day (pieces, or metres/kg for soldBy=measure). ts fields are ISO UTC; date fields are store-local YYYY-MM-DD (UTC+8).',
    stockouts: 'Per product, intervals where replayed stock was <= 0. start/end ISO, end null = still out; days fractional. A stockout that began before the movement log is not reported.',
    supplierLeadTimes: 'Per supplier. lead days = receivedAt date - (sentAt || orderedAt) date, n = POs with both. onTimeRate vs promisedAt || expectedAt. fillRate = receivedQty/qty over received+partial POs. invoiceGapPct = billed vs quoted cost on lines with invoiceCost.',
    demand: 'Per product over the last windowDays complete days. dailyRate/sdDaily use only inStockDays (days that opened with stock); uncensoredDailyRate counts every day and understates demand. pattern from adi (days per selling day) and cv2 (squared variation of selling-day size): smooth/erratic/intermittent/lumpy/none.',
    reorder: 'Per active product. basis history: safetyStock = z*sqrt((leadDays+reviewDays)*sdDaily^2 + dailyRate^2*leadDaysSd^2); reorderPoint = dailyRate*leadDays + safetyStock; orderUpTo = dailyRate*(leadDays+reviewDays) + safetyStock; suggestQty = orderUpTo - position rounded up to the product step when position <= reorderPoint. position = stock + onOrder. basis fallback: under 14 in-stock days, 2x the typed danger level. cashPesos = suggestQty * cost.',
    reorderBySupplier: 'Suggested lines summed per supplier. belowMinimum is a flag only; quantities are never inflated to reach minOrderPesos.',
    cashAsleep: 'Per product in stock. idleDays = days since last sale, or since first movement when never sold (lastSaleAt null). pesoDays = stockPesos * idleDays, worst first.',
    sellThrough: 'Per delivery movement, FIFO against later outflows; stock that predates the log sells first. soldQty by sales, otherOutQty by counts/damage/shrinkage. daysToClear null = not cleared yet.',
    deadStock: 'cashAsleep rows with idleDays >= days. totalPesos at cost.',
    cashTiedUp: 'Stock on hand at cost (product cost). Units are aged newest-in first (oldest sells first) from the positive movement they came in on -- happenedOn when set and different from the day it was typed, else ts -- in store-local days; returns do not start a layer (old stock going back on the shelf, not new stock in) and are absorbed by older layers or beforeLogQty. beforeLogQty = units older than the log, counted in 90+ and in every sittingOverPesos. oldestDays null when some stock predates the log. windows: last N store days incl. today. boughtPesos = delivery movements, soldAtCostPesos = sales minus returns, lostPesos = shrinkage/damage/writeoff; each at the movement unitCost, else product cost. sittingOverPesos = stock value that has sat more than N days.',
    customerCycles: 'Per customer on completed sales. medianGapDays between distinct order dates. status overdue (> 1.5x median since last), due (>= median), ok, unknown (< 3 order dates).',
    basketAffinity: 'Completed, unreturned orders. support = share of baskets with both; confidenceAtoB = P(b|a); lift > 1 means bought together more than chance. categories uses product folder.',
    deliveryPoints: 'Completed/refunded delivery orders with a map pin. minutesToArrive = first dispatched to next arrived event (null without deliveryEvents).',
    countAccuracy: 'Per product with counts that kept expected and counted. confidence 0..1, lowest first = count these next.',
    lostDemand: 'Unfilled requests grouped by productId (or typed text). qty = units asked. reasons and substitutes are counts.',
    priceHistory: 'Price and cost changes per product, oldest change first. changePct vs old value.',
  };

  function buildInsights(data = {}, { now = new Date().toISOString(), days = 90, serviceLevel = 0.95 } = {}) {
    const products = (data.products || []).map(normalizeProduct);
    const movements = data.movements || [];
    const purchaseOrders = (data.purchaseOrders || []).map((po) => ({ ...PO_DEFAULTS, ...po }));
    const suppliers = (data.suppliers || []).map((s) => ({ ...SUPPLIER_DEFAULTS, ...s }));
    const orders = data.orders || [];

    const stockouts = stockoutIntervals(products, movements, now);
    const demand = demandStats(products, movements, now, { days, stockouts });
    const leads = supplierLeadTimes(purchaseOrders, suppliers);
    const demandBy = new Map(demand.map((r) => [r.productId, r]));
    const leadBy = new Map(leads.map((r) => [r.supplierId, r]));
    const supBy = new Map(suppliers.map((s) => [s.id, s]));
    const onOrder = onOrderBy(purchaseOrders);
    const reorder = products.filter((p) => !p.archived).map((p) => reorderPlan(p, {
      demand: demandBy.get(p.id), lead: leadBy.get(p.supplierId), supplier: supBy.get(p.supplierId),
      onOrder: onOrder.get(p.id) || 0, serviceLevel, now }));

    const bySup = new Map();
    reorder.filter((r) => r.suggestQty > 0).forEach((r) => {
      const s = supBy.get(r.supplierId) || {};
      const g = bySup.get(r.supplierId) || { supplierId: r.supplierId, name: s.name || '', lines: 0, c: 0, minOrderPesos: Number(s.minOrder) || 0 };
      g.lines++; g.c += cent(r.cashPesos);
      bySup.set(r.supplierId, g);
    });
    const reorderBySupplier = [...bySup.values()].map(({ c, ...g }) =>
      ({ ...g, cashPesos: r2(c / 100), belowMinimum: g.minOrderPesos > 0 && c < cent(g.minOrderPesos) }));

    return {
      generatedAt: isoOf(now), apiVersion: 1, windowDays: days, serviceLevel,
      sections: {
        stockouts, supplierLeadTimes: leads, demand, reorder, reorderBySupplier,
        cashAsleep: cashAsleep(products, movements, now),
        cashTiedUp: cashTiedUp(products, movements, now),
        sellThrough: sellThrough(movements, purchaseOrders, products),
        deadStock: deadStock(products, movements, now, { days }),
        customerCycles: customerCycles(orders, data.customers || [], now),
        basketAffinity: basketAffinity(orders, { products }),
        deliveryPoints: deliveryPoints(orders, data.deliveryEvents || []),
        countAccuracy: countAccuracy(movements),
        lostDemand: lostDemandSummary(data.lostDemand || []),
        priceHistory: priceHistory(data.priceLog || []),
      },
      fieldNotes: FIELD_NOTES,
    };
  }

  const API = { TZ_MIN, dayKey, dayNum, dayStartIso, outDayNums, reviewDaysFor, zFor, onOrderBy, dataFromDump,
    stockoutIntervals, supplierLeadTimes, demandStats, reorderPlan, cashAsleep, cashTiedUp, sellThrough, deadStock,
    customerCycles, basketAffinity, deliveryPoints, countAccuracy,
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
  // already on the item page and Stock history. The pure functions stay for buildInsights.
  const TABS = { cash: 'Cash tied up', stockouts: 'Stockouts', dead: 'Dead stock',
    sell: 'Sell-through',
    counts: 'Count accuracy', lost: 'Lost demand' };
  // Days & staff removed (owner, 2026-09-24): no weather log, no attendance join. Customer
  // cycles moved onto Customers the same day; Deliveries removed (Transactions has Fulfilment);
  // Basket affinity is Sales -> Bought together.
  const MOVED = { staff: ['staff', {}], days: ['staff', {}], cycles: ['customers', {}], basket: ['sales', { by: 'basket' }], deliveries: ['sales', { by: 'tx' }], reorder: ['products', { view: 'stock', level: 'out,low' }], leads: ['suppliers', {}],
    prices: ['inventory', { tab: 'prices' }] };
  const DEFAULT_TAB = 'cash';
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).insights = { param: 'tab', def: DEFAULT_TAB, items: Object.entries(TABS), groups: [
    ['Stock', ['cash', 'stockouts', 'dead', 'sell', 'counts', 'lost']],
  ] };

  // Raw orders, not state.orders: normalizeOrder drops deliveryLocation and originalOrderId.
  function gather() {
    return {
      products: loadProducts(), folders: state.folders, orders: loadList(STORAGE_ORDERS), customers: allCustomerRecords(),
      movements: loadMovements(), purchaseOrders: loadPurchaseOrders(), suppliers: loadSuppliers(),
      staff: loadStaff().map(({ pin, ...u }) => u),
      ...Object.fromEntries(Object.keys(EVENT_LOGS).map((k) => [k, loadEvents(k)])),
    };
  }

  /* ---- cells ---- */
  const DASH = '<span class="muted">—</span>';
  const txt = (v) => (v == null || v === '' ? DASH : escapeHtml(String(v)));
  const num = (v, unit = '') => (v == null ? DASH : `${v}${unit}`);
  const pct = (rate) => (rate == null ? DASH : `${Math.round(rate * 100)}%`);
  const money = (v) => (v == null ? DASH : peso(v));
  const day = (iso) => (iso ? dayKey(iso) : DASH);
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
    const idleCols = [
      ['Product', (r) => escapeHtml(r.name)], ['Qty', (r) => num(r.qty), 1], ['Cost', (r) => money(r.costPesos), 1],
      ['Stock value', (r) => money(r.stockPesos), 1], ['Last sale', (r) => day(r.lastSaleAt), 1],
      ['Idle days', (r) => num(r.idleDays), 1], ['Peso-days', (r) => num(r.pesoDays), 1]];

    switch (tab) {
      case 'stockouts': {
        const rows = [...s.stockouts.rows].sort((a, b) => b.outNow - a.outNow || b.daysOut - a.daysOut);
        const last = (r) => r.intervals[r.intervals.length - 1] || {};
        return card('Stockouts', `${s.stockouts.totalDaysOut} product-days out, replayed from the movement log`, [
          ['Product', (r) => escapeHtml(r.name)], ['Now', (r) => (r.outNow ? pill('danger', 'Out') : pill('ok', 'In stock'))],
          ['Stockouts', (r) => num(r.stockouts), 1], ['Days out', (r) => num(r.daysOut), 1],
          ['Last ran out', (r) => day(last(r).start), 1], ['Back in', (r) => (last(r).start ? day(last(r).end) : DASH), 1],
        ], rows, 'Nothing has run out.');
      }
      case 'cash': {
        const c = s.cashTiedUp, win = new Map(c.windows.map((w) => [w.days, w]));
        const lastSale = new Map(s.cashAsleep.map((r) => [r.productId, r.lastSaleAt]));
        const note = (text) => ({ tone: 'flat', text, cmp: '' });
        const stat = (label, value, text) => statCell({ label, value: pesoShort(value), delta: note(text) });
        // A stat is its own card now (v34), so these are two grids under a plain head
        // rather than two inset bars inside one card. statCell is shared with the
        // dashboard and Sales; leaving this one wrapped would have nested card in card.
        const bar = (cells) => `<div class="stat-grid show-delta">${cells.join('')}</div>`;
        const w15 = win.get(15), w30 = win.get(30);
        const summary = `
            ${bar([stat('Tied up now', c.totalPesos, `${c.rows.length} products`),
              stat('Sitting over 15 days', w15.sittingOverPesos, `${Math.round((w15.sittingOverPesos / (c.totalPesos || 1)) * 100)}% of stock`),
              stat('Sitting over 30 days', w30.sittingOverPesos, `${Math.round((w30.sittingOverPesos / (c.totalPesos || 1)) * 100)}% of stock`)])}
            ${bar([stat('Bought, last 15 days', w15.boughtPesos, `${peso(w15.soldAtCostPesos)} sold at cost`),
              stat('Bought, last 30 days', w30.boughtPesos, `${peso(w30.soldAtCostPesos)} sold at cost`),
              stat('Lost, last 30 days', w30.lostPesos, 'shrinkage, breakage, write-off')])}`;
        return summary + card('By product', c.ageBuckets.map((b) => `${b.label}d ${peso(b.pesos)}`).join(' · '), [
          ['Product', (r) => escapeHtml(r.name)], ['Qty', (r) => num(r.qty), 1], ['Stock value', (r) => money(r.stockPesos), 1],
          ...c.ageBuckets.map((b) => [`${b.label} days`, (r) => (r.pesosByAge[b.label] ? money(r.pesosByAge[b.label]) : DASH), 1]),
          ['Oldest', (r) => (r.oldestDays == null ? 'Before log' : num(r.oldestDays, 'd')), 1], ['Last sale', (r) => day(lastSale.get(r.productId)), 1],
        ], c.rows, 'No stock on hand.');
      }
      case 'dead':
        return card('Dead stock', `${s.deadStock.rows.length} products unsold ${s.deadStock.days}+ days · ${peso(s.deadStock.totalPesos)} at cost`,
          idleCols, s.deadStock.rows, `Nothing has sat unsold for ${s.deadStock.days} days.`);
      case 'sell': {
        const rows = [...s.sellThrough].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        return card('Sell-through', 'Each delivery, drained oldest first', [
          ['Received', (r) => sub(day(r.receivedAt), escapeHtml(r.poNumber))], ['Product', (r) => product(r.productId)],
          ['Supplier', (r) => txt(supOf.get(r.supplierId))], ['Qty in', (r) => num(r.qtyReceived), 1],
          ['Sold', (r) => num(r.soldQty), 1], ['Other out', (r) => num(r.otherOutQty), 1], ['Left', (r) => num(r.remainingQty), 1],
          ['Cleared', (r) => day(r.clearedAt), 1], ['Days to clear', (r) => num(r.daysToClear), 1],
        ], rows, 'No deliveries logged.');
      }
      case 'basket': {
        const by = params.pairs === 'categories' ? 'categories' : 'products';
        const label = (id, name) => txt(by === 'categories' ? folderName(id) : name);
        const toggle = `<div class="seg">${[['products', 'Products'], ['categories', 'Categories']].map(([k, l]) =>
          `<button class="seg-btn${k === by ? ' active' : ''}" data-pairs="${k}">${l}</button>`).join('')}</div>`;
        return card('Bought together', `${s.basketAffinity.baskets} baskets · pairs seen 3+ times, highest lift first`, [
          ['Item A', (r) => label(r.a, r.aName)], ['Item B', (r) => label(r.b, r.bName)], ['Baskets', (r) => num(r.count), 1],
          ['Support', (r) => pct(r.support), 1], ['A then B', (r) => pct(r.confidenceAtoB), 1],
          ['B then A', (r) => pct(r.confidenceBtoA), 1], ['Lift', (r) => num(r.lift), 1],
        ], s.basketAffinity[by], 'No pair bought together often enough yet.', toggle);
      }
      case 'counts':
        return card('Count accuracy', 'Least trusted counts first: count these next', [
          ['Product', (r) => product(r.productId)], ['Counts', (r) => num(r.counts), 1], ['Last counted', (r) => day(r.lastCountedAt), 1],
          ['Mean miss', (r) => num(r.meanAbsVariance), 1], ['Confidence', (r) => pct(r.confidence), 1],
        ], s.countAccuracy, 'No stock counts with an expected quantity yet.');
      case 'lost':
        return card('Lost demand', 'What customers asked for and did not get', [
          ['Item', (r) => (r.productId ? product(r.productId) : txt(r.text))], ['Requests', (r) => num(r.requests), 1],
          ['Qty asked', (r) => num(r.qty), 1], ['Reasons', (r) => counts(r.reasons)],
          ['Took instead', (r) => counts(r.substitutes, (id) => nameOf.get(id) || id)],
          ['First', (r) => day(r.firstAt), 1], ['Last', (r) => day(r.lastAt), 1],
        ], s.lostDemand, 'No lost sales logged.');
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
