/* ==========================================================
   Hardware POS — Sales maths. The ONE place money is added up.
   ----------------------------------------------------------
   Loaded first by both index.html and backoffice.html (window.SalesMath) and
   required by node checks (scripts/sales-math-check.mjs). Pure: no DOM, no
   storage, no clock — callers pass orders, windows and settings in.

   The ladder (pos-vault features/sales-terms, owner 2026-10-02):

     Gross sales − Voids − Refunds − Discounts = Net sales
     Net sales − Tax (when prices include it)  = Sales before tax
     Sales before tax − Cost of goods          = Gross profit
     Margin = Gross profit ÷ Sales before tax

   Prices include tax (PH VAT) or tax is added on top (US sales tax); the order
   says which (`taxIncluded`, default true), so a store can switch without
   rewriting its past. Net sales is what the price tags add up to after
   discounts; `collected` is what reached the drawer (Net sales + tax on top).

   Orders, as rows (every row is append-only):
     status 'completed'  a sale.
     status 'void'       cancels a sale the same day. Points at it (originalOrderId).
     status 'refund'     money handed back later (return, exchange). Same pointer.
     status 'saved'      a parked cart, not money. Ignored.
   A void or refund counts on ITS OWN day, never back-dated onto the sale's.
   Rows from before 2026-10-02 (sale flipped to voided/refunded, 'return' rows)
   are rewritten into this shape by upgradeOrders() on load.

   All sums run in whole cents and come back to currency units once.
   ========================================================== */
(function (root) {
  // Pesos → whole cents and back. THE copies: bo-model's cent / unc / round2 are these (SalesMath.cent,
  // .unc, .round2). Junk (undefined, 'abc') reads as 0, never NaN.
  const C = (n) => Math.round((Number(n) || 0) * 100);
  const U = (c) => Math.round(Number(c) || 0) / 100;
  // Money to the centavo: THE round for a stored or shown amount (one Math.round of the cents,
  // so -1.555 → -1.55; amounts arrive at 2 dp, where that never decides).
  const round2 = (n) => U(C(n));
  // a ÷ b rounded half up (away from zero), in integers: no float ever decides a centavo.
  const div = (a, b) => Math.sign(a) * Math.floor((2 * Math.abs(a) + b) / (2 * b));
  // a ÷ b rounded once, straight to a whole number of `step`-cent coins.
  const roundTo = (a, b, step = 1) => div(a, b * step) * step;
  // Quantities carry up to 3 decimals (2.5 m, 0.125 kg): qty in thousandths, so price × qty is exact.
  const milli = (qty) => Math.round((Number(qty) || 0) * 1000);
  // A row's time in epoch ms. Old rows may hold an ISO string; a missing time reads as 0, so
  // the row still counts in all-time totals and never in a dated window.
  const tsOf = (o) => (Number.isFinite(+o.ts) ? +o.ts : Date.parse(o.ts) || 0);

  /* ---------------- Rows ---------------- */

  const SIGN = { completed: 1, void: -1, refund: -1 };
  const sign = (o) => SIGN[(o && o.status) || 'completed'] || 0;
  const isSale = (o) => sign(o) > 0;
  const isReversal = (o) => sign(o) < 0;
  // An old (pre-2026-10-02) sale flipped in place to voided/refunded, and the id it gets when it
  // has none. upgradeOrders and readOrder both use it, so the till and the back office agree.
  const isFlipped = (o) => o.status === 'voided' || o.status === 'refunded';
  const legacyId = (o) => `legacy:${o.number}:${o.ts}`;
  // The stored order shape's version (the till stamps it as schemaVersion). 2 = 2026-10-03: 'walkin' is
  // the counter sale; before it, 'pickup' meant the counter sale, so a v1 'pickup' reads as 'walkin'.
  const ORDER_VERSION = 2;
  const fulfilOf = (o) => {
    const f = String(o.fulfilment || '').trim() || 'walkin';
    return f === 'pickup' && !(Number(o.schemaVersion) >= 2) ? 'walkin' : f;
  };

  // Old rows → the row shape above. Idempotent: the new rows' ids are derived from the
  // sale's, so the POS and the back office upgrading the same storage agree on every id, and
  // a till that has not upgraded yet syncing the old flipped sale back adds nothing twice.
  // A sale gets at most one reversal. An old row with no id gets one from its number and time, so
  // it still upgrades the same way everywhere instead of being read as a plain sale. A void only
  // cancels a sale on its own day: an old void done on a later day becomes a refund on that day.
  // `zone` = the store's (storeZone(settings)): "the same day" is the store's day, never the browser's.
  function upgradeOrders(list, zone = 'Asia/Manila') {
    const rows = (list || []).filter((o) => o && typeof o === 'object')
      .map((o) => (!o.id && isFlipped(o) ? { ...o, id: legacyId(o) } : o))
      .map((o) => (o.fulfilment === 'pickup' && fulfilOf(o) === 'walkin' ? { ...o, fulfilment: 'walkin' } : o));
    const cancelled = new Set(rows.filter((o) => o.status === 'void' || o.status === 'refund' || o.status === 'return').map((o) => o.originalOrderId));
    const out = [], seen = new Set();
    const push = (o) => { if (o.id == null || !seen.has(o.id)) { seen.add(o.id); out.push(o); } };
    for (const o of rows) {
      if (o.status === 'return') { push({ ...o, status: 'refund' }); continue; }
      if (o.status !== 'voided' && o.status !== 'refunded') { push(o); continue; }
      push({ ...o, status: 'completed', reason: '', voidedAt: 0, refundedAt: 0 });
      if (cancelled.has(o.id)) continue;
      cancelled.add(o.id);
      const at = Number(o.status === 'voided' ? o.voidedAt : o.refundedAt) || o.ts;
      const kind = o.status === 'voided' && dayKey(at, zone) === dayKey(o.ts, zone) ? 'void' : 'refund';
      push({ ...o, id: `${o.id}:${kind}`, number: `${o.number}-${kind === 'void' ? 'V' : 'R'}`,
        ts: at, status: kind, originalOrderId: o.id, reason: o.reason || '', voidedAt: 0, refundedAt: 0 });
    }
    return out;
  }

  // The one reader of a stored order row, for every screen that did not write it (the back
  // office, the AI snapshot; the till's writer is app.js normalizeOrderRecord). It coerces the
  // fields the maths reads and keeps everything else as stored. It invents nothing: a line with no
  // cost stays null (costOf fills it), a row with no tax keeps 0 rather than today's rate, a text
  // date keeps its day, 0.75 kg stays 0.75. Legacy statuses pass through for upgradeOrders.
  const STATUSES = ['saved', 'completed', 'void', 'refund', 'voided', 'refunded', 'return'];
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const numOrNull = (v) => (v != null ? num(v) : null);
  // `rate` = the store's rate (taxOpts(settings).rate): a row saved without its rate reads as it when
  // that rate gives the row's own tax. Default 12 % (PH, the first market); `.map(readOrder)` passes an
  // index here, which reads as no option.
  function readOrder(raw, opts) {
    if (!raw || typeof raw !== 'object') return null;
    const rate = opts && typeof opts === 'object' && opts.rate != null ? Number(opts.rate) || 0 : 0.12;
    const items = (Array.isArray(raw.items) ? raw.items : []).filter((i) => i && typeof i === 'object').map((i) => ({
      ...i,
      id: String(i.id || i.productId || ''),
      productId: String(i.productId || i.id || ''),
      name: String(i.name || 'Item'),
      sku: String(i.sku || ''),
      unit: String(i.unit || 'pc'),
      qty: Math.max(0, num(i.qty, 1)),
      price: num(i.price),
      cost: numOrNull(i.cost),
      lineGross: numOrNull(i.lineGross),
      lineTotal: numOrNull(i.lineTotal),
    }));
    const gross = U(items.reduce((t, i) => t + C(i.lineGross != null ? i.lineGross : i.price * i.qty), 0));
    const kind = String(raw.paymentKind || raw.paymentMethod || 'cash');
    const total = num(raw.total, gross), vatAmount = num(raw.vatAmount), vatExempt = num(raw.vatExempt);
    const vatable = C(total) - C(vatAmount) - C(vatExempt);
    const vatRate = raw.vatRate != null ? num(raw.vatRate)
      : vatAmount > 0 && vatable > 0 ? rateOf(C(vatAmount), vatable, raw.taxIncluded !== false, rate) : 0;
    return {
      ...raw,
      id: raw.id ? String(raw.id) : isFlipped(raw) ? legacyId(raw) : String(raw.number || ''),
      number: String(raw.number || raw.id || ''),
      ts: tsOf(raw),
      status: STATUSES.includes(raw.status) ? raw.status : 'completed',
      voidedAt: num(raw.voidedAt),
      refundedAt: num(raw.refundedAt),
      originalOrderId: String(raw.originalOrderId || ''),
      reason: String(raw.reason || ''),
      cashier: String(raw.cashier || ''),
      register: String(raw.register || ''),
      customer: raw.customer && typeof raw.customer === 'object'
        ? { ...raw.customer, id: String(raw.customer.id || ''), name: String(raw.customer.name || '') } : null,
      paymentMethod: String(raw.paymentMethod || 'cash'),
      paymentKind: kind,
      paymentMethodLabel: String(raw.paymentMethodLabel || ''),
      payments: (Array.isArray(raw.payments) ? raw.payments : []).filter((p) => p && typeof p === 'object')
        .map((p) => ({ ...p, method: String(p.method || 'other'), amount: num(p.amount) })),
      items,
      subtotal: num(raw.subtotal, gross),
      discount: num(raw.discount),
      // The receipt-wide discount as rung up ({ type, value, name, id }): its name is the slip's Discount word (receiptParts).
      cartDiscount: raw.cartDiscount && typeof raw.cartDiscount === 'object' ? { ...raw.cartDiscount } : null,
      total,
      vatRate,
      vatAmount,
      vatExempt,
      vatableSales: num(raw.vatableSales, U(vatable)),   // the receipt's VATable sales
      scPwdOff: num(raw.scPwdOff),
      // The SC/PWD cardholder the sale was given it for: { kind: 'senior' | 'pwd', idNo, name }, else null.
      scPwd: raw.scPwd && typeof raw.scPwd === 'object'
        ? { kind: raw.scPwd.kind === 'pwd' ? 'pwd' : 'senior', idNo: String(raw.scPwd.idNo || ''), name: String(raw.scPwd.name || '') } : null,
      taxIncluded: raw.taxIncluded !== false,
      tendered: num(raw.tendered),
      change: num(raw.change),
      fulfilment: fulfilOf(raw),
      deliveryAddress: String(raw.deliveryAddress || ''),
    };
  }

  // A row saved without its rate: the rate whose tax (orderTotals' rounding) IS the row's own, on the
  // coarsest grid that has one -- whole %, then 1/4 %, then 1/8 % -- nearest tax ÷ taxed sales. A ₱1
  // sale at 12 % (11¢ on 89¢) reads 12 %, not 12.375 %. The store's own rate (`hint`) wins whenever it
  // fits: ₱1.07 with 11¢ tax fits 11 % and 12 % alike, and a 12 % store sold at 12 %. ponytail: a tiny
  // sale that fits more than one rate and not the store's ($1 at 8.875 % taxes 9¢, as 9 % does) takes
  // the coarser; rows that stamp vatRate never come here.
  function rateOf(taxC, vatableC, included, hint = 0) {
    const net = included ? vatableC + taxC : vatableC;
    const fits = (r) => { const bp = Math.round(r * 10000); return roundTo(net * bp, included ? 10000 + bp : 10000) === taxC; };
    if (hint > 0 && fits(hint)) return hint;
    const at = (x) => (included ? x / (net - x) : x / net);   // the rate whose exact tax is x cents
    const lo = at(taxC - 0.5), hi = at(taxC + 0.5), ratio = taxC / vatableC;
    for (const d of [100, 400, 800]) {
      let best = null;
      for (let k = Math.max(1, Math.floor(lo * d)); k <= Math.min(d, Math.ceil(hi * d)); k++)
        if (fits(k / d) && (best == null || Math.abs(k / d - ratio) < Math.abs(best - ratio))) best = k / d;
      if (best != null) return best;
    }
    return Math.round(ratio * 800) / 800;
  }

  // A refund can take back some lines, or part of one (owner 2026-10-03): its lines carry `lineNo`, their
  // place on the sale. A void, or a refund with no lineNo (a whole-sale refund from before), took it all.
  const isWhole = (r) => r.status === 'void' || !(r.items || []).some((i) => i && i.lineNo != null);
  // What is still left to give back on each of a sale's lines, in thousandths, after `prior` (the void
  // and refund rows pointing at it). A line never goes below 0.
  function leftMilli(sale, prior) {
    const left = ((sale && sale.items) || []).map((i) => milli(i.qty));
    for (const r of prior || []) {
      if (!isReversal(r)) continue;
      if (isWhole(r)) return left.map(() => 0);
      for (const i of r.items || []) { const k = Number(i.lineNo); if (k in left) left[k] = Math.max(0, left[k] - milli(i.qty)); }
    }
    return left;
  }
  // The same in units, for the till's picker: [2, 0, 0.5] = 2 of line 0 and half of line 2 can still come back.
  const qtyLeft = (sale, prior) => leftMilli(sale, prior).map((m) => m / 1000);

  // Sale id → the void or refund that cancels it: a void, or refunds that between them took back every
  // unit. A sale only partly refunded is not in here -- it still stands (its refund rows are their own
  // money). Build once per load.
  function reversals(orders) {
    const back = new Map(), sales = new Map();
    for (const o of orders || []) {
      if (isReversal(o)) (back.get(o.originalOrderId) || back.set(o.originalOrderId, []).get(o.originalOrderId)).push(o);
      else if (isSale(o)) sales.set(o.id, o);
    }
    const out = new Map(), part = new Set();
    for (const [id, rows] of back) {
      const whole = rows.find(isWhole), sale = sales.get(id);
      if (whole || (sale && leftMilli(sale, rows).every((m) => m <= 0))) out.set(id, whole || rows[0]);
      else part.add(id);
    }
    out.part = part;   // the partly refunded sales; ponytail: rides on the Map so every `rev` passed around carries it (statusOf)
    return out;
  }
  const reversalOf = (orders, saleId) => reversals(orders).get(saleId) || null;

  // The money of a refund of some of a sale's units. picks = [{ lineNo, qty }]; prior = the void and
  // refund rows already pointing at the sale. Each line's money (orderLines, fitted to the receipt)
  // comes back by its units, counted over ALL the sale's refunds so far: refunds that add up to the
  // whole sale give back exactly its money, to the centavo. The payment legs come back the same way,
  // by the share of the total. → the row's lines (with lineNo) and money, or null when nothing is
  // picked or a pick is more than is left on its line.
  // ponytail: a leg's largest-remainder cent can move between refunds, so one leg of a later refund
  // may read a cent off; the legs still add up to the row's total.
  function refundPart(sale, prior, picks) {
    const lines = orderLines(sale), left = leftMilli(sale, prior), m = orderCents(sale);
    const sc = split(C(sale.scPwdOff), lines.map((l) => l.gross));
    const items = [];
    let g = 0, n = 0, t = 0, x = 0, s = 0;
    for (const p of picks || []) {
      const k = Number(p.lineNo), l = lines[k], want = milli(p.qty);
      if (!(want > 0)) continue;
      if (!l || !(k in left) || want > left[k]) return null;
      const sold = milli(l.qty), done = sold - left[k];
      left[k] -= want;
      const part = (c) => div(c * (done + want), sold) - div(c * done, sold);
      const pg = part(l.gross), pn = part(l.net);
      g += pg; n += pn; t += part(l.tax); x += part(l.exempt); s += part(sc[k]);
      // The line's share of every discount rides on it as an amount, so the row's lines weigh true.
      items.push({ ...l.item, qty: want / 1000, lineNo: k, discount: pg > pn ? { type: 'amount', value: U(pg - pn) } : null });
    }
    if (!items.length) return null;
    const total = m.included ? n : n + t, saleC = C(sale.total);
    const before = (prior || []).filter(isReversal).reduce((a, r) => a + C(r.total), 0);
    const legs = (sale.payments || []).filter((p) => p && typeof p === 'object');
    const at = (T) => split(T, legs.map((p) => C(p.amount)));
    const now = saleC ? at(Math.min(saleC, before + total)) : legs.map(() => 0), was = saleC ? at(Math.min(saleC, before)) : now;
    return {
      items, subtotal: U(g), discount: U(g - n), total: U(total), vatAmount: U(t), vatExempt: U(x),
      vatableSales: U((m.included ? n - t : n) - x), scPwdOff: U(s),
      payments: legs.map((p, j) => ({ ...p, amount: U(now[j] - was[j]) })).filter((p) => p.amount),
    };
  }

  // What a row IS, for its pill and its filter: derived, never stored on the sale.
  //   sale · voided (a sale a void row cancels) · refunded · void · refund · saved
  function rowState(o, rev) {
    const st = (o && o.status) || 'completed';
    if (st === 'saved' || st === 'void' || st === 'refund') return st;
    const r = rev && rev.get(o.id);
    return r ? (r.status === 'void' ? 'voided' : 'refunded') : 'sale';
  }
  // The status a screen SHOWS (pill, label, Status filter): rowState, except a sale some but not all of which
  // came back reads 'part' (owner 2026-10-03; worded "Partly refunded" 2026-10-07). rowState keeps calling it 'sale' -- it still
  // stands, so the money, stock and account rules that ask "is it a sale?" do not move.
  const statusOf = (o, rev) => { const s = rowState(o, rev); return s === 'sale' && rev && rev.part && rev.part.has(o.id) ? 'part' : s; };
  const ROW_LABEL = { sale: 'Completed', part: 'Partly refunded', voided: 'Voided', refunded: 'Refunded', void: 'Void', refund: 'Refund', saved: 'Not completed' };

  /* ---------------- Building an order (the till) ---------------- */

  // The smallest coin, in cents: 1 for ₱ / $, 100 for ¥. Every amount the till makes is a
  // whole number of them, so a receipt never asks for half a yen.
  const coin = (currency) => 10 ** (2 - fmt(currencyCode(currency), false).resolvedOptions().maximumFractionDigits);

  // A line or cart discount: { type: 'percent' | 'amount', value }. Never more than the base.
  // A percent is taken half up, once.
  function discountCents(baseC, disc, step = 1) {
    if (!disc || !Number(disc.value)) return 0;
    const off = disc.type === 'percent' ? roundTo(baseC * Math.round(Number(disc.value) * 100), 10000, step) : C(disc.value);
    return Math.max(0, Math.min(baseC, off));
  }

  function lineMoney(price, qty, disc, currency) {
    const step = coin(currency);
    const g = roundTo(C(price) * milli(qty), 1000, step);
    const d = discountCents(g, disc, step);
    return { lineGross: U(g), lineDiscount: U(d), lineTotal: U(g - d) };
  }

  // The cart's money, rounded once per order to the currency's coin. `rate` is a fraction
  // (0.12); 0 = a non-VAT store.
  // The store's settings → orderTotals options, read the same way by the till and the back office.
  // `vatInclusive` is the back office's "VAT registered" box (old name): off = no tax at all.
  // `taxOnTop` is Settings › Tax "Tax added on top of prices" (US sales tax); off = inside the price.
  const taxOpts = (s = {}) => ({ rate: s.vatInclusive === false ? 0 : Number(s.vatRate ?? 0.12) || 0,
    included: s.taxOnTop !== true, currency: s.store?.currency ?? s.currency });
  //
  // `scPwd` (a senior citizen / PWD sale, RA 9994 / RA 10754): 20% off the price without VAT, and
  // no VAT. ₱112 on the shelf → ₱100 without VAT → ₱20 off → pays ₱80, VAT 0. Discounts = 32 (the
  // VAT taken out + the 20%), Net sales = 80, all of it VAT-exempt (a sub-breakdown of Sales before
  // VAT). The law allows no double discount: the customer gets whichever is higher — SC/PWD or the
  // store's own discounts — never both (lead 2026-10-02). `scPwd: true` on the result = SC/PWD won.
  // `scRate`: the SC/PWD rate as a fraction, the store's built-in Senior / PWD discount (bo-model scRateOf); the law's 0.2 by default.
  function orderTotals(lines, cartDiscount, { rate = 0, included = true, currency, scPwd = false, scRate = 0.2 } = {}) {
    const step = coin(currency);
    let g = 0, ld = 0;
    for (const l of lines || []) {
      const m = lineMoney(l.price, l.qty, l.discount, currency);
      g += C(m.lineGross); ld += C(m.lineDiscount);
    }
    const cd = discountCents(g - ld, cartDiscount, step);
    const r = Number(rate) || 0, bp = Math.round(r * 10000);   // the rate in basis points: 12% = 1200
    const pack = (net, tax, ld, cd, scOff, sc) => ({
      subtotal: U(g), lineDiscountOff: U(ld), cartDiscountOff: U(cd), discount: U(g - net),
      scPwdOff: U(scOff), vatExempt: U(sc && bp > 0 ? net : 0), scPwd: sc,
      netSales: U(net), tax: U(tax), salesBeforeTax: U(included ? net - tax : net),
      total: U(included ? net : net + tax),   // what the customer pays
      taxRate: r, taxIncluded: !!included,
    });
    const net = g - ld - cd;
    const plain = pack(net, bp > 0 ? roundTo(net * bp, included ? 10000 + bp : 10000, step) : 0, ld, cd, 0, false);
    if (!scPwd) return plain;
    const exVat = included && bp > 0 ? roundTo(g * 10000, 10000 + bp, step) : g;
    const scOff = roundTo(exVat * Math.round((Number(scRate) || 0) * 10000), 10000, step);
    const sc = pack(exVat - scOff, 0, 0, 0, scOff, true);
    return sc.total < plain.total ? sc : plain;
  }

  // The tax's name on screens and receipts: the store's own, else VAT (inside the price) or Tax (on top).
  const taxName = (s = {}) => String(s.taxName || '').trim() || (s.taxOnTop === true ? 'Tax' : 'VAT');

  /* ---------------- Reading an order ---------------- */

  // Split `total` cents over `weights` so the parts are whole cents and add up exactly
  // (largest remainder). All-zero weights split evenly.
  function split(total, weights) {
    const n = weights.length;
    if (!n) return [];
    total = Math.round(Number(total) || 0);
    const w = weights.map((x) => Math.max(0, Number(x) || 0));
    const sum = w.reduce((a, b) => a + b, 0);
    const raw = w.map((x) => (sum ? total * x / sum : total / n));
    const out = raw.map(Math.floor);
    let left = total - out.reduce((a, b) => a + b, 0);
    raw.map((x, i) => [x - out[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
    return out;
  }

  // One order's money, in cents, unsigned. The order's own figures are the truth (they are
  // what was printed); lines are fitted to them, so every breakdown sums back to the receipt.
  function orderCents(o) {
    const included = o.taxIncluded !== false;
    const total = C(o.total);
    const tax = C(o.vatAmount != null ? o.vatAmount : o.tax);
    const net = included ? total : total - tax;
    const gross = Math.max(net, o.subtotal != null ? C(o.subtotal) : net);
    return { gross, net, discount: gross - net, tax, included, exempt: C(o.vatExempt) };
  }

  // Each line with its share of the order's gross, discount (cart discount included) and tax,
  // plus cost at sale. `costOf(line)` fills cost for lines sold before it was stamped.
  function orderLines(o, costOf) {
    const m = orderCents(o);
    const items = Array.isArray(o.items) && o.items.length ? o.items : [{ name: '', qty: 0, price: 0 }];
    const lineG = items.map((i) => C(i.lineGross != null ? i.lineGross : Number(i.price) * Number(i.qty)));
    const lineN = items.map((i, k) => (i.lineTotal != null ? C(i.lineTotal) : lineG[k]));
    const gross = split(m.gross, lineG);
    const net = split(m.net, lineN.some((x) => x > 0) ? lineN : lineG);
    const tax = split(m.tax, net);
    const exempt = split(m.exempt, net);
    return items.map((item, k) => {
      const qty = Number(item.qty) || 0;
      const unitCost = item.cost != null ? Number(item.cost) || 0 : (costOf ? Number(costOf(item)) || 0 : 0);
      return {
        item, qty, gross: gross[k], discount: gross[k] - net[k], net: net[k], tax: tax[k], exempt: exempt[k],
        exTax: m.included ? net[k] - tax[k] : net[k],
        collected: m.included ? net[k] : net[k] + tax[k], cost: div(C(unitCost) * milli(qty), 1000),
      };
    });
  }

  /* ---------------- The ladder ---------------- */

  function blank() {
    return { grossSales: 0, voids: 0, refunds: 0, discounts: 0, netSales: 0, tax: 0, salesBeforeTax: 0, vatExempt: 0,
      collected: 0, costOfGoods: 0, orders: 0, voidCount: 0, refundCount: 0, unitsSold: 0, lastSale: 0 };
  }

  // Add one line's money to a bucket. Sales add; a void or refund takes the sale's gross
  // out on its own line and hands its discount back, so Net = Gross − Voids − Refunds − Discounts.
  function addLine(b, kind, l) {
    const s = kind === 'sale' ? 1 : -1;
    b.grossSales += kind === 'sale' ? l.gross : 0;
    if (kind === 'void') b.voids += l.gross;
    if (kind === 'refund') b.refunds += l.gross;
    b.discounts += s * l.discount;
    b.netSales += s * l.net;
    b.tax += s * l.tax;
    b.salesBeforeTax += s * l.exTax;
    b.vatExempt += s * l.exempt;
    b.collected += s * l.collected;
    b.costOfGoods += s * l.cost;
    b.unitsSold += s * l.qty;
  }

  // An order touches a bucket once, however many of its lines landed there.
  function addOrder(b, kind, ts) {
    if (kind === 'sale') { b.orders++; b.lastSale = Math.max(b.lastSale, ts); }
    else if (kind === 'void') { b.orders--; b.voidCount++; }
    else b.refundCount++;
  }

  function finish(b) {
    const out = {};
    for (const k of Object.keys(b)) out[k] = (k === 'voidCount' || k === 'refundCount' || k === 'lastSale') ? b[k]
      : k === 'unitsSold' ? Math.round(b[k] * 1000) / 1000 : U(b[k]);
    // A count of orders (sales less voids) never reads below zero: a window holding only the void of
    // an earlier sale is 0 orders, on every screen. Its money still goes negative (it happened there).
    out.orders = Math.max(0, b.orders);
    out.grossProfit = U(b.salesBeforeTax - b.costOfGoods);
    // 0..1 of what was sold. A window that gave back more than it sold has no margin: 0, not a
    // positive ratio of two negatives.
    out.margin = b.salesBeforeTax > 0 ? (b.salesBeforeTax - b.costOfGoods) / b.salesBeforeTax : 0;
    out.averageSale = b.orders > 0 ? U(b.netSales / b.orders) : 0;
    return out;
  }

  /*
    summarize(orders, { from, to, by, costOf }) → the ladder for the window, plus
    `groups` (Map key → ladder) when `by` is given.
      from / to   epoch ms, [from, to). Omit for everything.
      by(order, line) → a key, or an array of keys (an item in two categories counts in
                  both — then the groups add past the total; with one key they sum to it).
                  `line` is the order line; order-level keys just ignore it.
      costOf(line) → unit cost for lines sold before cost was stamped on them.
    A key that returns null/undefined is skipped for that line.
  */
  // The sale ids a void row cancels. THE "last sale" rule (lead default 2026-10-03, an owner question):
  // the newest sale not cancelled by a void; a refunded sale still counts (the customer bought).
  // To flip it, change only this set. summarize's lastSale and lastSale() both read it.
  const voidedIds = (orders) => new Set((orders || []).filter((o) => o && o.status === 'void').map((o) => o.originalOrderId));
  // The newest sale still standing over ALL rows, in ms (0 = none): summarize(orders).lastSale without
  // the money walk, for a screen that only wants the date.
  function lastSale(orders) {
    const voided = voidedIds(orders);
    let t = 0;
    for (const o of orders || []) if (isSale(o) && !voided.has(o.id)) t = Math.max(t, tsOf(o));
    return t;
  }
  function summarize(orders, { from = -Infinity, to = Infinity, by = null, costOf = null } = {}) {
    const total = blank(), groups = by ? new Map() : null;
    const bucket = (k) => groups.get(k) || groups.set(k, blank()).get(k);
    // lastSale = the newest sale still standing: a voided one never happened (a refunded one did,
    // the customer bought). Only a void in `orders` is seen, so pass the void rows along.
    const voided = voidedIds(orders);
    let inside = false, onTop = false;
    for (const o of orders || []) {
      const s = sign(o), ts = tsOf(o);
      if (!s || !(ts >= from && ts < to)) continue;
      if (C(o.vatAmount != null ? o.vatAmount : o.tax)) { if (o.taxIncluded === false) onTop = true; else inside = true; }
      const kind = s > 0 ? 'sale' : o.status;
      const at = voided.has(o.id) ? 0 : ts;
      addOrder(total, kind, at);
      const touched = new Set();
      for (const l of orderLines(o, costOf)) {
        addLine(total, kind, l);
        if (!by) continue;
        const keys = by(o, l.item);
        for (const k of Array.isArray(keys) ? new Set(keys) : [keys]) {
          if (k == null) continue;
          addLine(bucket(k), kind, l);
          touched.add(k);
        }
      }
      for (const k of touched) addOrder(bucket(k), kind, at);
    }
    // Whether the tax sat inside the prices, read off the rows, never off the sign of a total (a day
    // that gave back more than it sold has netSales < salesBeforeTax and is still "included").
    // ponytail: a window mixing both modes reads as included; groups carry the window's answer.
    const taxIncluded = inside || !onTop;
    const out = { ...finish(total), taxIncluded };
    if (groups) out.groups = new Map([...groups].map(([k, b]) => [k, { ...finish(b), taxIncluded }]));
    return out;
  }

  /* ---------------- Tenders: what paid for it ---------------- */

  // The one tender key of a payment leg: cash · gcash · qr · credit · unpaid, or the store's own
  // method name ("Maya"). The till stores GCash/QR/custom legs as method 'other' and reversal rows
  // relabel every leg 'Void'/'Refund', so the order's paymentKind/paymentMethodLabel name it, never
  // the leg's label. A split sale is its legs (cash + credit), never a 'split' bucket.
  // `split` is never a key: it is payWord's name for an order paid more than one way.
  const TENDER_LABEL = { cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', unpaid: 'Not completed', other: 'Other', split: 'Split payment' };
  function tenderKey(o, p) {
    const m = p && p.method;
    if (m && m !== 'other') return m;
    const k = o && o.paymentKind;
    if (k === 'gcash' || k === 'qr') return k;
    return (o && k === 'other' && o.paymentMethodLabel) || 'other';
  }
  const tenderLabel = (key) => TENDER_LABEL[key] || String(key || 'Other');
  // An order's legs as [{ key, label, amount }], unsigned. A row saved with no legs paid its total
  // by its paymentKind (a split with no legs reads as one 'other' leg: nothing says how it split).
  function paymentsOf(o) {
    let legs = (o && o.payments) || [];
    if (!legs.length && o) {
      const k = o.paymentKind || o.paymentMethod || 'cash';
      legs = [{ method: ['cash', 'credit', 'gcash', 'qr', 'unpaid'].includes(k) ? k : 'other', amount: o.total }];
    }
    return legs.map((p) => { const key = tenderKey(o, p); return { key, label: tenderLabel(key), amount: U(C(p.amount)) }; });
  }
  // The tender a sale's money came in on (its account part aside): its first leg that isn't 'credit',
  // as a tenderKey ('cash', 'gcash', 'qr', 'Maya'); 'cash' when every leg was the account. An exchange
  // rings its replacement on this, so a GCash swap stays GCash and the drawer gains nothing.
  const saleTender = (o) => (paymentsOf(o).find((p) => p.key !== 'credit') || { key: 'cash' }).key;
  // An order's payment in one word: its tender, or 'Split payment' when the legs differ. A void or
  // refund names the sale's tender (its legs keep their method), never 'Void' / 'Refund'.
  function payWord(o) {
    const keys = new Set(paymentsOf(o).map((p) => p.key));
    return tenderLabel(keys.size > 1 ? 'split' : [...keys][0]);
  }
  // Money by tender for a window: what each method took in, less what went back out the same
  // way. Cash here is what the drawer should hold beyond the float. Keys are tenderKey's. A tender
  // that nets to ₱0 (a sale and its void) is left out, so every list shows the same rows; read a
  // key with `.get(k) || 0`.
  function tenders(orders, { from = -Infinity, to = Infinity } = {}) {
    const by = new Map();
    for (const o of orders || []) {
      const s = sign(o), ts = tsOf(o);
      if (!s || !(ts >= from && ts < to)) continue;
      for (const p of paymentsOf(o)) by.set(p.key, (by.get(p.key) || 0) + s * C(p.amount));
    }
    return new Map([...by].filter(([, c]) => c).map(([k, c]) => [k, U(c)]));
  }
  // What the customer handed over for a leg: tendered when typed, else the leg's amount (a void
  // or refund slip stores tendered 0 and must still print what went back).
  const tenderedOf = (p) => Number(p && p.tendered) || Number(p && p.amount) || 0;
  // What a sale put on the customer's account: its 'credit' legs, unsigned, in pesos. Only the legs
  // the sale stored count -- paymentsOf's stand-in leg for an old legless row is a guess, and a
  // charge is never posted on a guess.
  const creditPart = (o) => U(((o && o.payments) || []).filter((p) => p && tenderKey(o, p) === 'credit')
    .reduce((s, p) => s + C(p.amount), 0));

  /* ---------------- Who and what ---------------- */

  // A row's customer id, whichever field the row carries it in.
  const customerIdOf = (o) => (o && ((o.customer && o.customer.id) || o.customerId)) || null;
  // Every money row of one customer (sales, voids, refunds; not parked carts), newest first.
  // Its summarize() gives the header's orders/spent/lastSale. The list shows MORE rows than `orders`
  // counts (a void row and the sale it cancels are two rows and zero orders): label the list by its
  // own length (plural(rows.length, 'receipt')), never by the header's order count.
  const customerOrders = (orders, id) => (id ? (orders || []).filter((o) => sign(o) && customerIdOf(o) === id)
    .sort((a, b) => tsOf(b) - tsOf(a)) : []);
  // Who a row counts for on staff reports: the SELLER. A void or refund is the original sale's
  // seller's minus (owner 2026-10-02), not whoever pressed it. Pass ALL orders (the sale may sit
  // outside the window). Returns (o) => { key, staffId, name }; key = staffId, else the typed name.
  // Pass the staff list too: an old row that stored only a name gets that person's id (when exactly
  // one person has the name), so it files under the same key as their newer rows, and `name` is
  // the person's current name. Left out, the staff list is the app's own (bo-model loadStaff, both
  // pages load it): a caller that forgot it split one person into an id row and a name row.
  function sellerOf(orders, staff = typeof loadStaff === 'function' ? loadStaff() : []) {
    const byId = new Map((orders || []).map((o) => [o.id, o]));
    const people = new Map((staff || []).map((u) => [String(u.id), u]));
    const named = new Map();
    for (const u of staff || []) { const n = String(u.name || '').trim().toLowerCase(); named.set(n, named.has(n) ? null : u); }
    return (o) => {
      const s = (isReversal(o) && byId.get(o.originalOrderId)) || o || {};
      const typed = String(s.cashier || '');
      const u = people.get(String(s.staffId || '')) || (!s.staffId && named.get(typed.trim().toLowerCase())) || null;
      const staffId = String(s.staffId || (u && u.id) || ''), name = (u && u.name) || typed;
      return { key: staffId || name || '—', staffId, name };
    };
  }
  // One item's key on a line: its product, else the line's own id/sku/name.
  const itemKey = (line) => (line && (line.productId || line.id || line.sku || 'n:' + line.name)) || null;
  // "Items sold": how many different items sold at least one unit (net of voids/refunds), over
  // summarize groups keyed by itemKey. Total units is the ladder's unitsSold, a different word.
  const itemsSold = (groups) => [...(groups && groups.values ? groups.values() : groups || [])].filter((g) => g.unitsSold > 0).length;
  // Any share (an item's, a category's): part ÷ the PERIOD'S netSales, 0..1. A part that lost
  // money has a negative share; the parts sum to 1 when each line has one key.
  const share = (part, whole) => (Number(whole) > 0 ? (Number(part) || 0) / Number(whole) : 0);

  // One unit's money on its price tag, the ladder's way: the tax comes out of the price first
  // (taxOpts(settings)), so margin = profit ÷ price before tax. Markup is on cost, on the shelf
  // price, what the owner typed in the editor. Percentages, 2 dp.
  function unitMargin(cost, price, settings) {
    const ex = C(orderTotals([{ price, qty: 1 }], null, taxOpts(settings || {})).salesBeforeTax), c = C(cost), p = C(price);
    return { profit: U(ex - c), margin: ex > 0 ? round2((ex - c) / ex * 100) : 0, markup: c > 0 ? round2((p - c) / c * 100) : 0 };
  }
  // A tax rate (0.0875) as people read it: 8.75%, 12%. Never rounded to a whole percent.
  const ratePct = (rate) => +((Number(rate) || 0) * 100).toFixed(2) + '%';

  // A receipt's lines: each shows its price × qty BEFORE discount (like the cart), fitted to the
  // order so they add up to the Subtotal to the cent; discounts show once, below. Unsigned.
  // An order with no lines has none ([]); orderLines' blank line is only there so summarize counts its money.
  const receiptLines = (o) => (o && Array.isArray(o.items) && o.items.length
    ? orderLines(o).map((l) => ({ item: l.item, qty: l.qty, amount: U(l.gross) })) : []);

  /* ---------------- A slip's words (till slip, printer, back office receipt) ---------------- */

  // What a slip says beyond its lines and totals, chosen by the row's state, never by the screen.
  // `sale` = the sale a void or refund cancels (for its number); `rev` = reversals(orders), so a sale
  // that was later voided says so. Returns:
  //   kind     rowState: sale · voided · refunded · void · refund · saved
  //   mark     'VOID of #1-0042' / 'REFUND of #1-0042' on a reversal, else ''
  //   paidWord 'Paid', or 'Given back' on a reversal (money went out, not in)
  //   whoWord  'Cashier', 'Voided by', 'Refunded by' -- a reversal's cashier is who pressed it
  //   legs     [{ key, label, amount }]: the tenders, by name ('GCash', never 'Refund')
  //   footer   the closing lines: a sale is the official receipt; a reversal is not, and never
  //            says goods cannot come back on the slip that took them back
  //   scPwd    the SC/PWD lines when the order carries them: [{ label, amount }]
  //   scPwdId  the cardholder's [label, 'ID no. · Name'], or null
  const FOOTER = {
    // Lines can come back now (owner 2026-10-03: line refunds, exchanges), so the slip no longer says they can't.
    sale: ['This serves as your official receipt.', 'Keep for returns and exchanges.'],
    void: ['This sale is cancelled.', 'This is not an official receipt.'],
    refund: ['Money given back.', 'This is not an official receipt.'],
    saved: ['Not completed. This is not a receipt.'],
    // A quote (the till's saved list, draft 'quote'): no number, no valid-until (owner 2026-10-07).
    quote: ['This is not an official receipt.'],
  };
  function receiptParts(o, sale = null, rev = null) {
    const kind = rowState(o, rev), back = isReversal(o), quote = o.draft === 'quote';
    return {
      kind,
      mark: quote ? 'QUOTATION' : back ? `${o.status === 'void' ? 'VOID' : 'REFUND'} of #${(sale && sale.number) || '—'}` : '',
      paidWord: back ? 'Given back' : 'Paid',
      whoWord: o.status === 'void' ? 'Voided by' : o.status === 'refund' ? 'Refunded by' : 'Cashier',
      legs: paymentsOf(o),
      footer: FOOTER[quote ? 'quote' : o.status] || FOOTER.sale,
      // The SC/PWD 20% is already inside Discount: 'Incl.' so the slip never reads as a second discount.
      scPwd: Number(o.scPwdOff) > 0
        ? [{ label: 'Incl. SC/PWD discount', amount: U(C(o.scPwdOff)) }, ...(C(o.vatExempt) > 0 ? [{ label: 'VAT-exempt sales', amount: U(C(o.vatExempt)) }] : [])] : [],
      // Who it was given to, printed under Customer: ['Senior citizen ID' | 'PWD ID', 'ID no. · Name'], or null.
      scPwdId: Number(o.scPwdOff) > 0 && o.scPwd && o.scPwd.idNo
        ? [`${o.scPwd.kind === 'pwd' ? 'PWD' : 'Senior citizen'} ID`, `${o.scPwd.idNo} · ${o.scPwd.name}`] : null,
      discountName: discountName(o),
    };
  }
  // The Discount row's word: the saved discount's name ('Summer sale') when it is the sale's whole discount, else ''
  // (a line discount beside it makes the row a mix, so it stays 'Discount'). An order, or the cart { cartDiscount, items }.
  const discountName = (o) => {
    const name = String((o && o.cartDiscount && o.cartDiscount.name) || '').trim();
    return name && !((o.items || []).some((l) => l && l.discount && Number(l.discount.value) > 0)) ? name : '';
  };
  // The totals block above TOTAL, as [label, amount, small]: every slip, the paper, the till's order
  // pop-up and the back office's receipt list the same rows. `vm` = { totals, scPwd, taxName, discountName }: the
  // till's receipt view model, or from a read order { totals: o, scPwd: receiptParts(o).scPwd,
  // taxName: taxName({ ...settings, taxOnTop: !o.taxIncluded }) }. Only Discount comes off (signed);
  // SC/PWD, VATable sales and VAT are information lines, unsigned (`small` on screen). VATable sales
  // is the part of a VAT-inclusive total that carries VAT; tax on top has no such line.
  function totalRows(vm) {
    const t = (vm && vm.totals) || {};
    return [['Subtotal', t.subtotal],
      ...(t.discount > 0 ? [[(vm && vm.discountName) || 'Discount', -t.discount]] : []),
      ...((vm && vm.scPwd) || []).map((r) => [r.label, r.amount, true]),
      ...(t.vatAmount > 0 ? [
        ...(t.taxIncluded !== false ? [['VATable sales', t.vatableSales, true]] : []),
        [(vm.taxName || 'VAT') + ' (' + ratePct(t.vatRate) + ')', t.vatAmount, true]] : [])];
  }
  // A row's Paid line: { paid, change } in currency units, or null for a parked cart (nothing was paid,
  // and no slip prints a Paid row). A sale's paid = the money legs, cash as handed over, never the
  // account part (that is owed, the ledger's word); a void or refund = every leg, the account part too
  // (it went back onto the account) -- the legs printer.js payRows lists. change = the cash legs' change.
  function paidOf(o) {
    if (!sign(o)) return null;
    const back = isReversal(o);
    let paid = 0, change = 0;
    for (const p of (o && o.payments) || []) {
      if (!back && tenderKey(o, p) === 'credit') continue;
      paid += C(!back && p.method === 'cash' ? tenderedOf(p) : p.amount);
      if (p.method === 'cash') change += C(p.change);
    }
    return { paid: U(paid), change: U(change) };
  }

  /* ---------------- The store's clock ---------------- */

  // Every day boundary is the STORE'S day, never the browser's or UTC (a 7 AM Manila sale is
  // that day everywhere). ponytail: Settings has no time-zone field yet; settings.store.timeZone
  // wins the day a store outside Manila exists.
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  const storeZone = (s) => (s && s.store && s.store.timeZone) || 'Asia/Manila';
  const zf = new Map();
  const zoneFmt = (zone, kind) => {
    const k = zone + kind;
    if (!zf.has(k)) zf.set(k, new Intl.DateTimeFormat(kind === 'd' ? 'en-CA' : 'en-US', kind === 'd'
      ? { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }
      : { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    return zf.get(k);
  };
  // 'YYYY-MM-DD' of a time (ms, ISO, or a row's ts) in the store's zone. A bare date is already one.
  const dayKey = (ts, zone = 'Asia/Manila') => (typeof ts === 'string' && DATE_ONLY.test(ts) ? ts
    : zoneFmt(zone, 'd').format(tsOf({ ts })));
  const offsetAt = (ms, zone) => {
    const p = {}; for (const x of zoneFmt(zone, 't').formatToParts(ms)) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  // Epoch ms of the store-local midnight that starts `key`. Twice round the offset: DST-safe.
  // Remembered per zone and day: a list cut into day bands asks for the same few days thousands of times.
  // ponytail: one entry per day ever asked (~365 a year), never cleared.
  const dsm = new Map();
  function dayStartMs(key, zone = 'Asia/Manila') {
    const k = zone + '|' + key;
    if (dsm.has(k)) return dsm.get(k);
    const [y, m, d] = String(key).split('-').map(Number), wall = Date.UTC(y, m - 1, d);
    const ms = wall - offsetAt(wall - offsetAt(wall, zone), zone);
    dsm.set(k, ms);
    return ms;
  }
  const addDays = (key, n) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  // The last `days` store days ending on the anchor's day, as [from, to) epoch ms. The one range.
  function rangeWindow(days, anchor, zone = 'Asia/Manila') {
    const k = dayKey(anchor, zone);
    return { from: dayStartMs(addDays(k, -(Math.max(1, days) - 1)), zone), to: dayStartMs(addDays(k, 1), zone) };
  }
  // The day count every "per day" average divides by: store days in [from, to) with at least
  // one money row (a sale, void or refund). A shut day isn't a slow day. A TARGET is spread over
  // calendar days instead (it is a promise, not an average).
  // daysOpenBy: the same count per group in ONE pass, Map key → open days, keyOf(order) → a key (a
  // weekday: "Busiest days" divides each weekday by the days it was open). A null key is skipped.
  function daysOpenBy(orders, keyOf, { from = -Infinity, to = Infinity, zone = 'Asia/Manila' } = {}) {
    const days = new Map();
    for (const o of orders || []) {
      const ts = tsOf(o);
      if (!sign(o) || !(ts >= from && ts < to)) continue;
      const k = keyOf(o);
      if (k != null) (days.get(k) || days.set(k, new Set()).get(k)).add(dayKey(ts, zone));
    }
    return new Map([...days].map(([k, s]) => [k, s.size]));
  }
  const daysOpen = (orders, opts) => daysOpenBy(orders, () => 1, opts).get(1) || 0;

  // A time's parts on the store's clock: { year, month 1-12, day, hour 0-23, minute, weekday 0 = Sun }.
  // A bare 'YYYY-MM-DD' is that day at midnight. The calendar and the hour charts read these, never getHours().
  function dateParts(ts, zone = 'Asia/Manila') {
    const p = { hour: 0, minute: 0 };
    if (typeof ts === 'string' && DATE_ONLY.test(ts)) [p.year, p.month, p.day] = ts.split('-').map(Number);
    else for (const x of zoneFmt(zone, 't').formatToParts(tsOf({ ts }))) p[x.type] = +x.value;
    return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute,
      weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() };
  }
  // A time as people read it, on the store's clock. kind: 'day' Oct 2 · 'dayYear' Oct 2, 2026 ·
  // 'time' 3:05 PM · 'dayTime' Oct 2, 3:05 PM · 'weekday' Fri · 'weekdayDay' Fri, Oct 2 ·
  // 'weekdayDayYear' Fri, Oct 2, 2026. Formatters are built once per zone. No time (missing, junk, or
  // an opening row's 0 -- "before the log") is '—', never Jan 1, 1970.
  const TEXT = { day: { month: 'short', day: 'numeric' }, dayYear: { month: 'short', day: 'numeric', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' }, dayTime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    weekday: { weekday: 'short' }, weekdayDay: { weekday: 'short', month: 'short', day: 'numeric' },
    weekdayDayYear: { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
    slipDate: { year: 'numeric', month: '2-digit', day: '2-digit' }, slipTime: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } };
  const tf = new Map();
  // 'slip' = the receipt's Date line, 10/03/2026 15:05 (the paper's 24-hour clock).
  function dateText(ts, zone = 'Asia/Manila', kind = 'day') {
    if (kind === 'slip') { const d = dateText(ts, zone, 'slipDate'); return d === '—' ? d : d + ' ' + dateText(ts, zone, 'slipTime'); }
    const k = zone + kind;
    if (!tf.has(k)) tf.set(k, new Intl.DateTimeFormat('en-US', { timeZone: zone, ...(TEXT[kind] || TEXT.day) }));
    const ms = typeof ts === 'string' && DATE_ONLY.test(ts) ? dayStartMs(ts, zone) : tsOf({ ts });
    return ms > 0 ? tf.get(k).format(ms) : '—';
  }
  // Rows by store day: Map 'YYYY-MM-DD' → rows, in the order given (sort first for newest-first days).
  function groupByDay(rows, zone = 'Asia/Manila') {
    const out = new Map();
    for (const r of rows || []) { const k = dayKey(tsOf(r), zone); (out.get(k) || out.set(k, []).get(k)).push(r); }
    return out;
  }
  // Where a row sits on an hour or day chart: a void on its sale's own store day sits at the SALE's
  // time, so a 9 AM sale voided at 2 PM cancels the 9 AM bar instead of pushing 2 PM below zero. A
  // refund, and a void on a later day, keep their own time (day totals never move). saleTs: Map sale
  // id → its ts (one per list: new Map(orders.map((o) => [o.id, o.ts]))).
  function chartTime(o, saleTs, zone = 'Asia/Manila') {
    const t = tsOf(o), s = o.status === 'void' && saleTs ? saleTs.get(o.originalOrderId) : null;
    return s != null && dayKey(tsOf({ ts: s }), zone) === dayKey(t, zone) ? tsOf({ ts: s }) : t;
  }
  // Whole store days between a time and now: 0 today, 1 yesterday (calendar days, not 24-hour blocks).
  const dayNo = (key) => Date.parse(key + 'T00:00:00Z') / 864e5;
  const daysAgo = (ts, now = Date.now(), zone = 'Asia/Manila') => dayNo(dayKey(now, zone)) - dayNo(dayKey(ts, zone));
  // The same in words: Never · Today · Yesterday · 3 days ago. No time (null, 0, junk) = never.
  const agoText = (ts, now = Date.now(), zone = 'Asia/Manila') => {
    if (!(tsOf({ ts }) > 0)) return 'Never';
    const d = daysAgo(ts, now, zone);
    return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
  };

  /* ---------------- Order lists (the till's Orders rail, the back office's Orders) ---------------- */

  // A row's amount in a list: + for a sale, − for a void or refund, null for a parked cart (it is
  // not money: show it greyed or '—', and it is never in the total above the list). The total
  // over a list is summarize(rows).collected -- what the rows add up to.
  const rowAmount = (o) => (sign(o) ? U(sign(o) * C(o.total)) : null);
  // The one list order: newest first; same time (a refund and its exchange sale) → higher number first.
  const newestFirst = (a, b) => tsOf(b) - tsOf(a)
    || String(b.number || '').localeCompare(String(a.number || ''), 'en', { numeric: true });

  /* ---------------- Words ---------------- */

  // 1 order · 2 orders · 1 day · 3 days. `many` for an odd plural ('boxes').
  // pluralWord: the word alone, for a count shown apart (<strong>3</strong> new categories).
  const pluralWord = (n, word, many = word + 's') => (Number(n) === 1 ? word : many);
  const plural = (n, word, many) => `${Number(n).toLocaleString('en-PH')} ${pluralWord(n, word, many)}`;
  // THE quantity on screen: 1,253 · 1,234.50 (en-PH grouping; a fraction to 2 dp). Quantities carry 3
  // decimals, so float noise under half a thousandth (1.0000001) is a whole 1.
  const qtyText = (n) => {
    const q = Math.round((Number(n) || 0) * 1000) / 1000 || 0;   // || 0: never '-0'
    return q.toLocaleString('en-PH', Number.isInteger(q) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  // A share or margin (0.123) as 12.3%. '—' when there is nothing to be a share of (`base` ≤ 0:
  // no sales, no cost), never 0.0% or NaN%. A true minus. A share that is there but rounds away
  // says so: <0.1% (not 0.0%), and one short of all of it >99.9% (not 100.0%).
  function pctText(ratio, base = 1, dp = 1) {
    if (!(Number(base) > 0) || !Number.isFinite(+ratio)) return '—';
    const v = +ratio * 100, s = Math.abs(v).toFixed(dp), step = (10 ** -dp).toFixed(dp);
    if (v > 0 && +s === 0) return '<' + step + '%';
    if (v < 0 && +s === 0) return '>−' + step + '%';
    if (v > 0 && v < 100 && +s === 100) return '>' + (100 - 10 ** -dp).toFixed(dp) + '%';
    return (v < 0 ? '−' : '') + s + '%';
  }
  // THE change between two periods, as a fraction of the earlier one: (now − was) ÷ |was|. null when
  // there was nothing before (no base to be a change of).
  const change = (now, was) => (Number(was) ? ((Number(now) || 0) - was) / Math.abs(was) : null);
  // ...in words, for every trend chip and Compare-to cell: +12.3% · −4.0% · 0.0% · New (nothing before,
  // something now) · — (nothing either side). dp 0 for whole percents.
  function changeText(now, was, dp = 1) {
    const c = change(now, was);
    if (c == null) return Number(now) ? 'New' : '—';
    const s = Math.abs(c * 100).toFixed(dp);
    return (+s ? (c > 0 ? '+' : '−') : '') + s + '%';
  }
  // A changeText's tone, for its chip's class: 'up' · 'down' · '' (0.0%, New, —). Read off the sign
  // changeText wrote, so the words and the colour can never disagree.
  const changeTone = (t) => (String(t)[0] === '+' ? 'up' : String(t)[0] === '−' ? 'down' : '');
  // THE "Best day" pick (the Summary calendar's Best tag, the Items "Best day" tile): the most of a
  // measure among days that are over -- today isn't, so a half day is never judged. entries =
  // [[day, value]], `day` a 'YYYY-MM-DD' or ms; `today` the same kind. A tie keeps the earlier entry.
  // → [day, value], or null when no day is over yet.
  function bestDay(entries, today) {
    let best = null;
    for (const e of entries || []) if (e[0] < today && (!best || e[1] > best[1])) best = e;
    return best;
  }

  /* ---------------- Money on screen ---------------- */

  // 'PHP (₱)' (the old setting) or 'PHP' → 'PHP'.
  const currencyCode = (v) => (/^[A-Za-z]{3}/.exec(String(v || '')) || ['PHP'])[0].toUpperCase();
  const fmts = new Map();
  const fmt = (code, whole) => {
    const key = code + (whole ? ':0' : '');
    if (!fmts.has(key)) {
      const base = { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' };
      let f;
      try { f = new Intl.NumberFormat('en-PH', whole ? { ...base, minimumFractionDigits: 0, maximumFractionDigits: 0 } : base); }
      catch (_) { f = new Intl.NumberFormat('en-PH', { ...base, currency: 'PHP' }); }
      fmts.set(key, f);
    }
    return fmts.get(key);
  };
  // "₱1,234.50", "−₱3.00", "$12.00", "¥1,235". The minus goes before the symbol, as a real minus.
  // { whole: true } drops the decimals (headline figures); { compact: true } gives ₱12.3k / ₱1.23M from 10k;
  // { signed: true } puts a + on money that comes back (a discount handed back reads +₱20.00).
  function formatMoney(n, currency, { whole = false, compact = false, signed = false } = {}) {
    const v = Number.isFinite(+n) ? +n : 0, a = Math.abs(v), code = currencyCode(currency);
    let s;
    if (compact && a >= 1e4) {
      const sym = fmt(code, true).formatToParts(0).find((p) => p.type === 'currency').value;
      // Step up a unit when rounding would print 1000k or 1000M.
      const units = [[1e3, 'k', 1], [1e6, 'M', 2], [1e9, 'B', 2]];
      let i = a >= 1e9 ? 2 : a >= 1e6 ? 1 : 0;
      while (i < 2 && +(a / units[i][0]).toFixed(units[i][2]) >= 1000) i++;
      s = sym + +(a / units[i][0]).toFixed(units[i][2]) + units[i][1];
    } else {
      s = fmt(code, whole || compact).format(a);
    }
    const shown = s.replace(/[^1-9]/g, '');   // a value that prints as 0 carries no sign
    return (v < 0 && shown ? '−' : signed && v > 0 && shown ? '+' : '') + s;
  }
  const currencySymbol = (currency) => fmt(currencyCode(currency), true).formatToParts(0).find((p) => p.type === 'currency').value;

  const api = {
    sign, isSale, isReversal, ORDER_VERSION, upgradeOrders, readOrder, reversals, reversalOf, qtyLeft, refundPart, rowState, statusOf, ROW_LABEL,
    coin, discountCents, lineMoney, taxOpts, taxName, orderTotals, split, orderLines, discountName,
    summarize, tenders, currencyCode, formatMoney, currencySymbol,
    tsOf, TENDER_LABEL, tenderKey, tenderLabel, paymentsOf, saleTender, payWord, tenderedOf, creditPart, customerIdOf, customerOrders, sellerOf,
    itemKey, itemsSold, share, unitMargin, ratePct, receiptLines, receiptParts, totalRows, paidOf, lastSale,
    storeZone, dayKey, dayStartMs, addDays, rangeWindow, daysOpen, daysOpenBy, dateParts, dateText, groupByDay, chartTime, daysAgo, agoText,
    rowAmount, newestFirst, plural, pluralWord, qtyText, pctText, change, changeText, changeTone, bestDay,
    round2, cent: C, unc: U,
  };
  root.SalesMath = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
