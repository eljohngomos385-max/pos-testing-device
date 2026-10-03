// The ladder, proven on hand-worked orders. Fails if any money rule in sales-math.js breaks.
// Run: node scripts/sales-math-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../sales-math.js');

const DAY = 864e5, d1 = Date.UTC(2026, 9, 1, 2), d2 = d1 + DAY;
const line = (id, qty, price, cost, extra = {}) => ({ id, productId: id, name: id, qty, price, cost,
  lineGross: price * qty, lineDiscount: 0, lineTotal: price * qty, ...extra });
// A PH sale: VAT 12% inside the price, rounded once per order.
const sale = (id, ts, items, { cartOff = 0, ...extra } = {}) => {
  const t = M.orderTotals(items.map(i => ({ price: i.price, qty: i.qty, discount: i.discount })),
    cartOff ? { type: 'amount', value: cartOff } : null, { rate: 0.12, included: true });
  return { id, number: id, ts, status: 'completed', items, subtotal: t.subtotal, discount: t.discount,
    total: t.total, vatAmount: t.tax, payments: [{ method: 'cash', amount: t.total }], ...extra };
};
const reverse = (o, status, ts) => ({ ...o, id: `${o.id}-${status}`, ts, status, originalOrderId: o.id });

/* ---- orderTotals: the till's cart ---- */
{
  const t = M.orderTotals([{ price: 112, qty: 1 }], null, { rate: 0.12 });
  assert.deepEqual([t.subtotal, t.discount, t.total, t.tax, t.salesBeforeTax], [112, 0, 112, 12, 100]);
  const top = M.orderTotals([{ price: 100, qty: 1 }], null, { rate: 0.08, included: false });   // US
  assert.deepEqual([top.netSales, top.tax, top.total, top.salesBeforeTax], [100, 8, 108, 100]);
  const none = M.orderTotals([{ price: 99.99, qty: 3 }], null, { rate: 0 });                    // non-VAT store
  assert.deepEqual([none.total, none.tax], [299.97, 0]);
  // 5% off a 1219.30 cart: subtotal − discount = total to the cent (the old cartTotals bug).
  const tier = M.orderTotals([{ price: 1219.3, qty: 1 }], { type: 'percent', value: 5 }, { rate: 0.12 });
  assert.equal(Math.round((tier.subtotal - tier.discount) * 100), Math.round(tier.total * 100));
  assert.deepEqual([tier.discount, tier.total], [60.97, 1158.33]);   // 60.965 off rounds half up, once
  // A discount never goes past what it is taken off.
  assert.equal(M.orderTotals([{ price: 10, qty: 1, discount: { type: 'amount', value: 50 } }], { type: 'percent', value: 50 }).total, 0);
  // 2.5 m of wire is 2.5 m.
  assert.equal(M.orderTotals([{ price: 38.5, qty: 2.5 }]).total, 96.25);
}

/* ---- split: whole cents that add back exactly ---- */
assert.deepEqual(M.split(100, [1, 1, 1]), [34, 33, 33]);
assert.deepEqual(M.split(5, [0, 0]), [3, 2]);
assert.equal(M.split(99999, [3, 7, 11, 13]).reduce((a, b) => a + b, 0), 99999);

/* ---- The ladder on one day: sales, a line discount, a cart discount, a void ---- */
const a = sale('A', d1, [line('nail', 10, 5, 3), line('saw', 1, 450, 300)], { cartOff: 50 });   // gross 500, disc 50, net 450
const b = sale('B', d1 + 1000, [line('saw', 1, 450, 300, { discount: { type: 'amount', value: 50 }, lineDiscount: 50, lineTotal: 400 })]);
const c = sale('C', d1 + 2000, [line('nail', 4, 5, 3)]);
const cVoid = reverse(c, 'void', d1 + 3000);
const day1 = [a, b, c, cVoid];
const s1 = M.summarize(day1, { from: d1 - 1, to: d1 + DAY });
assert.equal(s1.grossSales, 500 + 450 + 20);
assert.equal(s1.voids, 20);
assert.equal(s1.refunds, 0);
assert.equal(s1.discounts, 50 + 50);
assert.equal(s1.netSales, 450 + 400);
assert.equal(s1.grossSales - s1.voids - s1.refunds - s1.discounts, s1.netSales, 'the ladder adds up');
assert.equal(s1.netSales, s1.collected, 'VAT inside: net sales is the drawer');
assert.equal(s1.tax, a.vatAmount + b.vatAmount);
assert.equal(s1.salesBeforeTax, +(s1.netSales - s1.tax).toFixed(2));
assert.equal(s1.costOfGoods, 30 + 300 + 300);
assert.equal(s1.grossProfit, +(s1.salesBeforeTax - s1.costOfGoods).toFixed(2));
assert.ok(Math.abs(s1.margin - s1.grossProfit / s1.salesBeforeTax) < 1e-9);
assert.equal(s1.orders, 2, 'a voided sale is not an order');
assert.equal(s1.voidCount, 1);
assert.equal(s1.unitsSold, 11 + 1);
assert.equal(s1.averageSale, 425);

/* ---- A refund counts on its own day, never back-dated ---- */
const aRefund = reverse(a, 'refund', d2 + 5000);
const all = [...day1, aRefund];
assert.equal(M.summarize(all, { from: d1 - 1, to: d1 + DAY }).netSales, 850, 'yesterday is untouched');
const s2 = M.summarize(all, { from: d1 + DAY, to: d2 + DAY });
assert.equal(s2.refunds, 500);
assert.equal(s2.discounts, -50, 'the refunded sale hands its discount back');
assert.equal(s2.netSales, -450);
assert.equal(s2.grossSales - s2.voids - s2.refunds - s2.discounts, s2.netSales);
assert.equal(s2.orders, 0, 'a refund is not a negative order');
assert.equal(s2.refundCount, 1);
assert.equal(s2.costOfGoods, -330, 'the goods came back');
// Over both days a sale and its refund net to zero.
const both = M.summarize(all);
assert.equal(both.netSales, 400);
assert.equal(M.summarize([a, aRefund]).netSales, 0);
assert.equal(M.summarize([a, aRefund]).grossProfit, 0);

/* ---- Groups sum to the total ---- */
const byItem = M.summarize(all, { by: (o, l) => l.id });
const sumOf = (g, k) => +[...g.values()].reduce((x, r) => x + r[k], 0).toFixed(2);
for (const k of ['grossSales', 'voids', 'refunds', 'discounts', 'netSales', 'tax', 'salesBeforeTax', 'costOfGoods', 'grossProfit', 'unitsSold'])
  assert.equal(sumOf(byItem.groups, k), both[k], `items add up: ${k}`);
assert.equal(byItem.groups.get('saw').orders, 2, 'saw: in A and B; a refund does not un-count an order');
const byStaff = M.summarize(all, { by: (o) => o.cashier || '—' });
assert.equal(byStaff.groups.get('—').netSales, both.netSales);
// An item in two categories counts in both; then the groups may add past the total.
const twoCats = M.summarize([a], { by: (o, l) => (l.id === 'saw' ? ['tools', 'cutting'] : 'fasteners') });
assert.equal(twoCats.groups.get('tools').netSales, twoCats.groups.get('cutting').netSales);
// A cart discount is shared over the lines by what each line was worth.
const aLines = M.orderLines(a);
assert.equal(aLines.reduce((x, l) => x + l.net, 0), 45000);
assert.equal(aLines.reduce((x, l) => x + l.tax, 0), Math.round(a.vatAmount * 100));
assert.deepEqual(aLines.map(l => l.discount), [500, 4500]);

/* ---- Tax on top (US) ---- */
{
  const t = M.orderTotals([{ price: 100, qty: 2 }], null, { rate: 0.0825, included: false });
  const o = { id: 'U', ts: d1, status: 'completed', taxIncluded: false, items: [line('x', 2, 100, 60)],
    subtotal: t.subtotal, discount: t.discount, total: t.total, vatAmount: t.tax };
  const s = M.summarize([o]);
  assert.deepEqual([s.grossSales, s.netSales, s.tax, s.salesBeforeTax, s.collected, s.grossProfit], [200, 200, 16.5, 200, 216.5, 80]);
  assert.equal(s.margin, 0.4);
}

/* ---- Non-VAT store ---- */
{
  const t = M.orderTotals([{ price: 50, qty: 1 }], null, { rate: 0 });
  const s = M.summarize([{ id: 'N', ts: d1, status: 'completed', items: [line('x', 1, 50, 20)], subtotal: 50, discount: 0, total: t.total, vatAmount: 0 }]);
  assert.deepEqual([s.tax, s.salesBeforeTax, s.grossProfit], [0, 50, 30]);
}

/* ---- Parked carts and empty windows ---- */
assert.equal(M.summarize([{ ...a, status: 'saved' }]).orders, 0);
assert.deepEqual([M.summarize([]).margin, M.summarize([]).averageSale], [0, 0]);

/* ---- Tenders: cash in the drawer ---- */
{
  const card = { ...b, payments: [{ method: 'cash', amount: 100 }, { method: 'gcash', amount: 300 }] };
  const tz = M.tenders([a, card, c, cVoid, aRefund]);
  assert.equal(tz.get('cash'), 100);   // A 450 in, A 450 out; B 100; C 20 in and out
  assert.equal(tz.get('gcash'), 300);
}

/* ---- Old rows upgrade to the new shape, once ---- */
{
  const old = [
    { ...a, status: 'voided', voidedAt: d1 + 9 },
    { ...b, status: 'refunded', refundedAt: d2 },
    { ...c, id: 'R1', status: 'return', originalOrderId: 'C' },
    { ...c, status: 'completed' },
  ];
  const up = M.upgradeOrders(old);
  assert.deepEqual(up.map(o => o.status), ['completed', 'void', 'completed', 'refund', 'refund', 'completed']);
  assert.equal(up[1].originalOrderId, 'A');
  assert.equal(up[1].ts, d1 + 9);
  assert.equal(up[3].ts, d2, 'a refund upgrades onto the day it happened');
  assert.deepEqual(M.upgradeOrders(up), up, 'upgrading twice changes nothing');
  assert.equal(M.reversalOf(up, 'A').status, 'void');
  assert.equal(M.reversalOf(up, 'C').id, 'R1');
  assert.equal(M.reversalOf(up, 'nope'), null);
  // The old maths said a voided sale is worth 0 and a refunded one 0; the upgrade agrees.
  assert.equal(M.summarize(up.slice(0, 2)).netSales, 0);
}

/* ---- Money on screen ---- */
assert.equal(M.formatMoney(1234.5, 'PHP (₱)'), '₱1,234.50');
assert.equal(M.formatMoney(-972.32, 'PHP'), '−₱972.32');
assert.equal(M.formatMoney(-0.001, 'PHP'), '₱0.00', 'no minus on zero');
assert.equal(M.formatMoney(12, 'USD'), '$12.00');
assert.equal(M.formatMoney(1234.5, 'JPY'), '¥1,235', 'yen has no decimals');
assert.equal(M.formatMoney(1234.5, 'PHP', { whole: true }), '₱1,235');
assert.equal(M.formatMoney(12345, 'PHP', { compact: true }), '₱12.3k');
assert.equal(M.formatMoney(-1234567, 'USD', { compact: true }), '−$1.23M');
assert.equal(M.formatMoney(5, ''), '₱5.00', 'no currency set reads as pesos');
assert.equal(M.currencySymbol('JPY'), '¥');

/* ---- Row states: derived from the rows, never stored ---- */
{
  const rev = M.reversals(all);
  assert.deepEqual([a, b, c, cVoid, aRefund, { ...a, status: 'saved' }].map(o => M.rowState(o, rev)),
    ['refunded', 'sale', 'voided', 'void', 'refund', 'saved']);
}

/* ---- Found by review (2026-10-02): each one failed before its fix ---- */
{
  // 1. A till that has not upgraded syncs the old flipped sale back: still one void.
  const up = M.upgradeOrders([{ ...a, status: 'voided', voidedAt: d1 + 9 }]);
  const again = M.upgradeOrders([{ ...a, status: 'voided', voidedAt: d1 + 9 }, up[1]]);
  assert.deepEqual(again.map(o => o.id), ['A', 'A:void']);
  assert.deepEqual([M.summarize(again).netSales, M.summarize(again).orders], [0, 0]);
  // ...and a sale returned, then flipped to voided, keeps its one reversal.
  const twice = M.upgradeOrders([{ ...c, status: 'voided' }, { ...c, id: 'R1', status: 'return', originalOrderId: 'C' }]);
  assert.equal(twice.filter(M.isReversal).length, 1);
  assert.equal(M.summarize(twice).netSales, 0);
  // An old row with no id gets one from its number and time: a sale plus its void, worth nothing,
  // the same ids on every load (never an 'undefined:void' twin, never a plain sale).
  const nid = M.upgradeOrders([{ ...a, id: undefined, number: '1-009', status: 'voided' }]);
  assert.deepEqual(nid.map(o => [o.id, o.status]), [[`legacy:1-009:${d1}`, 'completed'], [`legacy:1-009:${d1}:void`, 'void']]);
  assert.deepEqual(M.upgradeOrders(nid).map(o => o.id), nid.map(o => o.id));
  assert.equal(M.summarize(nid).netSales, 0);
  // An old void done on a later day is a refund on that day: the sale's day keeps its order.
  const late = M.upgradeOrders([{ ...a, status: 'voided', voidedAt: d2 }]);
  assert.equal(late[1].status, 'refund');
  assert.equal(M.summarize(late, { from: d1, to: d2 - 1 }).orders, 1);
  // "VAT registered" off = no tax; on top only with its own switch.
  assert.deepEqual(M.taxOpts({ vatInclusive: false, vatRate: 0.12 }), { rate: 0, included: true, currency: undefined });
  assert.deepEqual(M.taxOpts({ vatRate: 0.08, taxOnTop: true, store: { currency: 'USD' } }), { rate: 0.08, included: false, currency: 'USD' });
  assert.equal(M.taxOpts({}).rate, 0.12);
  // 2. Yen rounds to the yen.
  const y = M.orderTotals([{ price: 1234, qty: 1 }], null, { rate: 0.08, currency: 'JPY' });
  assert.deepEqual([y.tax, y.salesBeforeTax], [91, 1143]);
  const y2 = M.orderTotals([{ price: 999, qty: 1 }], { type: 'percent', value: 5 }, { rate: 0.1, currency: 'JPY' });
  assert.deepEqual([y2.discount, y2.total], [50, 949]);
  assert.equal(M.coin('PHP (₱)'), 1);
  assert.equal(M.coin('JPY'), 100);
  // 3. VAT exactly on half a centavo rounds up: 100.38 × 12/112 = 10.755.
  assert.equal(M.orderTotals([{ price: 100.38, qty: 1 }], null, { rate: 0.12 }).tax, 10.76);
  assert.equal(M.orderTotals([{ price: 100.66, qty: 1 }], null, { rate: 0.12 }).tax, 10.79);
  // 4. Half a unit of an odd price: 0.575 → 0.58.
  assert.equal(M.lineMoney(1.15, 0.5).lineGross, 0.58);
  assert.equal(M.lineMoney(0.29, 0.5).lineGross, 0.15);
  // 5. Compact steps up a unit instead of printing 1000k.
  assert.equal(M.formatMoney(999999.99, 'PHP', { compact: true }), '₱1M');
  assert.equal(M.formatMoney(1e9, 'PHP', { compact: true }), '₱1B');
  assert.equal(M.formatMoney(Infinity, 'PHP'), '₱0.00');
  // 6. A day of refunds only has no margin, not a positive one.
  assert.equal(M.summarize([aRefund]).margin, 0);
  // 7. Old ISO times count; a missing time counts in all-time, never in a dated window.
  assert.equal(M.summarize([{ ...c, ts: new Date(d1).toISOString() }], { from: d1 - 1, to: d1 + DAY }).netSales, 20);
  assert.equal(M.summarize([{ ...c, ts: undefined }]).netSales, 20);
  assert.equal(M.summarize([{ ...c, ts: undefined }], { from: d1 - 1, to: d1 + DAY }).netSales, 0);
  // 8. Tax on top with no subtotal: no made-up discount.
  const ns = M.summarize([{ id: 'T', ts: d1, status: 'completed', taxIncluded: false, total: 108, vatAmount: 8, items: [] }]);
  assert.deepEqual([ns.grossSales, ns.discounts, ns.netSales], [100, 0, 100]);
  // A key given twice counts the line once.
  assert.equal(M.summarize([c], { by: () => ['x', 'x'] }).groups.get('x').netSales, 20);
  assert.deepEqual(M.split(NaN, [1, 1]), [0, 0]);
}

// readOrder: the one reader of a stored row (back office, AI export). It invents nothing. The three
// copies it replaced floored 0.75 kg to 1, moved text-dated sales to "now" on every read, named a
// default cashier, and recomputed a missing tax from today's rate.
{
  const r = M.readOrder({ id: 'r1', ts: '2026-01-05T10:00:00+08:00', status: 'voided', total: '75',
    items: [{ productId: 'nails', qty: '0.75', price: 100 }], deliveryLocation: { lat: 1, lng: 2 } });
  assert.equal(r.ts, Date.parse('2026-01-05T10:00:00+08:00'));
  assert.equal(r.items[0].qty, 0.75);
  assert.equal(r.items[0].cost, null);
  assert.equal(r.items[0].id, 'nails');
  assert.equal(r.total, 75);
  assert.equal(r.vatAmount, 0);
  assert.equal(r.cashier, '');
  assert.equal(r.status, 'voided');                     // left for upgradeOrders
  assert.deepEqual(r.deliveryLocation, { lat: 1, lng: 2 });   // kept as stored
  assert.equal(M.readOrder({ items: [{ price: 10, qty: 2 }] }).subtotal, 20);
  assert.equal(M.readOrder(null), null);
}

/* ---- SC/PWD: 20% off the price without VAT, VAT-exempt (step 2.4) ---- */
{
  // The law's own example: ₱112 shelf → ₱100 without VAT → ₱20 off → pays ₱80, VAT 0.
  const t = M.orderTotals([{ price: 112, qty: 1 }], null, { rate: 0.12, scPwd: true });
  assert.deepEqual([t.subtotal, t.scPwdOff, t.discount, t.netSales, t.tax, t.vatExempt, t.salesBeforeTax, t.total],
    [112, 20, 32, 80, 0, 80, 80, 80]);
  // It replaces other discounts, never stacks: same ₱80 with a line and a cart discount on.
  const both = M.orderTotals([{ price: 112, qty: 1, discount: { type: 'amount', value: 10 } }], { type: 'percent', value: 5 }, { rate: 0.12, scPwd: true });
  assert.deepEqual([both.total, both.lineDiscountOff, both.cartDiscountOff, both.scPwd], [80, 0, 0, true]);
  // Whichever is higher (RA 9994, lead 2026-10-02): ₱1,000 at a 30% promo stays ₱700 — SC/PWD
  // would make it ₱714.29, so the promo wins, VAT stays, nothing is VAT-exempt.
  const promo = M.orderTotals([{ price: 1000, qty: 1, discount: { type: 'percent', value: 30 } }], null, { rate: 0.12, scPwd: true });
  assert.deepEqual([promo.total, promo.scPwd, promo.scPwdOff, promo.vatExempt, promo.tax, promo.lineDiscountOff], [700, false, 0, 0, 75, 300]);
  // The tax's one name: the store's own, else VAT inside the price, Tax on top.
  assert.deepEqual([M.taxName({}), M.taxName({ taxOnTop: true }), M.taxName({ taxName: ' GST ' })], ['VAT', 'Tax', 'GST']);
  // 3 × ₱56 + 2.5 m × ₱44.80 = ₱280 → ₱250 without VAT → ₱50 off → ₱200.
  const many = M.orderTotals([{ price: 56, qty: 3 }, { price: 44.8, qty: 2.5 }], null, { rate: 0.12, scPwd: true });
  assert.deepEqual([many.subtotal, many.scPwdOff, many.total, many.vatExempt], [280, 50, 200, 200]);
  // Non-VAT store: 20% off the shelf price, nothing VAT-exempt (there is no VAT to exempt).
  const nv = M.orderTotals([{ price: 100, qty: 1 }], null, { rate: 0, scPwd: true });
  assert.deepEqual([nv.total, nv.tax, nv.vatExempt], [80, 0, 0]);
  // Off = an ordinary sale, unchanged.
  assert.deepEqual([M.orderTotals([{ price: 112, qty: 1 }], null, { rate: 0.12 }).vatExempt], [0]);

  // On the ladder: Gross 112 − Discounts 32 = Net 80; VAT 0; VAT-exempt 80 inside Sales before VAT 80.
  const items = [line('drill', 1, 112, 60)];
  const sc = { id: 'sc1', number: 'sc1', ts: d1, status: 'completed', items, subtotal: t.subtotal, discount: t.discount,
    total: t.total, vatAmount: t.tax, vatExempt: t.vatExempt, scPwdOff: t.scPwdOff, payments: [{ method: 'cash', amount: 80 }] };
  const s = M.summarize([M.readOrder(sc)]);
  assert.deepEqual([s.grossSales, s.discounts, s.netSales, s.tax, s.salesBeforeTax, s.vatExempt, s.costOfGoods, s.grossProfit],
    [112, 32, 80, 0, 80, 80, 60, 20]);
  // Its refund on another day nets every rung to zero, VAT-exempt included.
  const both2 = M.summarize([sc, reverse(sc, 'refund', d2)].map(M.readOrder));
  for (const k of ['netSales', 'discounts', 'tax', 'salesBeforeTax', 'vatExempt', 'costOfGoods', 'grossProfit', 'collected'])
    assert.equal(both2[k], 0, k);
  // An ordinary VAT sale has no VAT-exempt part.
  assert.equal(M.summarize([sale('v1', d1, [line('a', 1, 112, 50)])]).vatExempt, 0);
}

/* ---- One formula per number (number map 2026-10-02) ---- */
{
  // tenders: one key per leg. GCash/QR/custom legs are stored as 'other' and a reversal relabels
  // every leg 'Void'/'Refund' — the order's paymentKind names them; a split is its legs.
  const g = sale('g1', d1, [line('a', 1, 100, 50)], { paymentKind: 'gcash', payments: [{ method: 'other', label: 'GCash', amount: 100 }] });
  const maya = sale('m1', d1, [line('a', 1, 50, 20)], { paymentKind: 'other', paymentMethodLabel: 'Maya', payments: [{ method: 'other', label: 'Maya', amount: 50 }] });
  const sp = sale('s1', d1, [line('a', 1, 300, 100)], { paymentKind: 'split',
    payments: [{ method: 'cash', amount: 100 }, { method: 'credit', label: 'Charge balance', amount: 200 }] });
  const gv = { ...reverse(g, 'void', d1), payments: [{ method: 'other', label: 'Void', amount: 100 }] };
  const tz = M.tenders([g, maya, sp, gv]);
  // GCash sold and voided nets to ₱0: left out, like every list's empty tender.
  assert.deepEqual([tz.has('gcash'), tz.get('Maya'), tz.get('cash'), tz.get('credit'), tz.has('split'), tz.has('Void')], [false, 50, 100, 200, false, false]);
  // payWord: the tender in one word; a split is 'Split payment'; a void names the sale's tender.
  assert.deepEqual([M.payWord(g), M.payWord(sp), M.payWord(gv), M.payWord(sale('pw', d1, [line('a', 1, 1, 1)]))], ['GCash', 'Split payment', 'GCash', 'Cash']);
  assert.equal(M.TENDER_LABEL.split, 'Split payment');
  assert.deepEqual([M.tenderLabel('credit'), M.tenderLabel('gcash'), M.tenderLabel('Maya'), M.tenderLabel('other')], ['Account', 'GCash', 'Maya', 'Other']);
  assert.deepEqual(M.paymentsOf({ paymentKind: 'qr', total: 40, payments: [] }), [{ key: 'qr', label: 'QR', amount: 40 }]);
  assert.deepEqual([M.tenderedOf({ tendered: 0, amount: 85 }), M.tenderedOf({ tendered: 100, amount: 85 })], [85, 100]);

  // lastSale skips a sale a void cancelled; a refunded sale still was a purchase.
  const s1 = sale('ls1', d1, [line('a', 1, 10, 5)]), s2 = sale('ls2', d2, [line('a', 1, 10, 5)]);
  assert.equal(M.summarize([s1, s2, reverse(s2, 'void', d2)]).lastSale, d1);
  assert.equal(M.summarize([s1, s2, reverse(s2, 'refund', d2 + 1)]).lastSale, d2);

  // customer: one matcher, whichever field the row uses; parked carts are not orders.
  const c1 = sale('c1', d1, [line('a', 1, 10, 5)], { customer: { id: 'k' } }), c2 = sale('c2', d2, [line('a', 1, 10, 5)], { customerId: 'k' });
  const parked = { ...sale('c3', d2, [line('a', 1, 10, 5)], { customerId: 'k' }), status: 'saved' };
  assert.deepEqual(M.customerOrders([c1, c2, parked, sale('x', d1, [line('a', 1, 1, 1)])], 'k').map((o) => o.id), ['c2', 'c1']);
  assert.equal(M.customerIdOf(c2), 'k');

  // seller: a refund pressed by the manager is the original seller's minus.
  const sold = sale('st1', d1, [line('a', 1, 50, 20)], { cashier: 'Ana', staffId: 'u-ana' });
  const back = { ...reverse(sold, 'refund', d2), cashier: 'Boss', staffId: 'u-boss' };
  const seller = M.sellerOf([sold, back]);
  assert.deepEqual([seller(sold).key, seller(back).key, seller(back).name], ['u-ana', 'u-ana', 'Ana']);
  const staff = M.summarize([sold, back], { by: (o) => seller(o).key });
  assert.deepEqual([...staff.groups.keys()], ['u-ana']);
  assert.equal(staff.groups.get('u-ana').netSales, 0);

  // items sold = different items with units > 0, net of reversals; share over the period's net.
  const a = sale('i1', d1, [line('a', 2, 10, 5), line('b', 1, 30, 10)]), b = sale('i2', d1, [line('c', 1, 60, 10)]);
  const it = M.summarize([a, b, reverse(b, 'void', d1)], { by: (o, l) => M.itemKey(l) });
  assert.equal(M.itemsSold(it.groups), 2);
  const shares = [...it.groups.values()].map((x) => M.share(x.netSales, it.netSales));
  assert.equal(Math.round(shares.reduce((s, x) => s + x, 0) * 1e9), 1e9);   // sums to 100%
  assert.equal(M.share(5, 0), 0);

  // unit margin: tax out first (₱112 → ₱100), margin on that; markup on cost, on the shelf price.
  assert.deepEqual(M.unitMargin(80, 112, {}), { profit: 20, margin: 20, markup: 40 });
  assert.deepEqual(M.unitMargin(80, 112, { vatInclusive: false }), { profit: 32, margin: 28.57, markup: 40 });
  assert.deepEqual([M.ratePct(0.0875), M.ratePct(0.12), M.ratePct(0)], ['8.75%', '12%', '0%']);

  // receipt lines add up to the Subtotal (gross, before the line discount shown below).
  const rd = sale('r1', d1, [line('a', 1, 100, 50, { discount: { type: 'amount', value: 10 }, lineDiscount: 10, lineTotal: 90 }), line('b', 3, 33.33, 10)]);
  const rl = M.receiptLines(M.readOrder(rd));
  assert.equal(Math.round(rl.reduce((s, l) => s + l.amount, 0) * 100), Math.round(rd.subtotal * 100));
  assert.equal(rl[0].amount, 100);

  // the store's day: a 7 AM Manila sale is that Manila day, not yesterday's UTC.
  const seven = Date.UTC(2026, 9, 1, 23);   // 2 Oct 07:00 Manila
  assert.equal(M.dayKey(seven), '2026-10-02');
  assert.equal(M.dayKey('2026-10-02'), '2026-10-02');
  assert.equal(M.dayStartMs('2026-10-02'), Date.UTC(2026, 9, 1, 16));
  assert.equal(M.dayStartMs('2026-03-08', 'America/New_York'), Date.UTC(2026, 2, 8, 5));   // DST day
  assert.equal(M.addDays('2026-10-31', 1), '2026-11-01');
  assert.deepEqual(M.rangeWindow(7, seven), { from: M.dayStartMs('2026-09-26'), to: M.dayStartMs('2026-10-03') });
  assert.equal(M.storeZone({ store: { timeZone: 'Asia/Tokyo' } }), 'Asia/Tokyo');
  // averages divide by days open: two sale days and a refund-only day = 3; a shut day isn't counted.
  const w = M.rangeWindow(7, seven);
  assert.equal(M.daysOpen([sale('o1', seven, [line('a', 1, 1, 1)]), sale('o2', seven - DAY, [line('a', 1, 1, 1)]),
    sale('o3', seven - DAY, [line('a', 1, 1, 1)]), reverse(sale('o4', 0, []), 'refund', seven - 3 * DAY),
    { ...sale('o5', seven - 4 * DAY, []), status: 'saved' }], w), 3);
}

/* ---- Fix round 1 (2026-10-03): shared helpers the screens call ---- */
{
  // upgradeOrders judges "same day" on the STORE's clock, whatever the browser's.
  const at = (h) => Date.UTC(2026, 9, 1, h, 30);   // UTC hour → Manila is +8
  const flip = (ts, voidedAt) => ({ id: 'F', number: '1-1', ts, status: 'voided', voidedAt, total: 10, items: [] });
  assert.equal(M.upgradeOrders([flip(at(15), at(16))])[1].status, 'refund');   // 23:30 → 00:30 Manila: next day
  assert.equal(M.upgradeOrders([flip(at(23), at(25))])[1].status, 'void');     // 07:30 → 09:30 Manila: same day
  assert.equal(M.upgradeOrders([flip(at(15), at(16))], 'UTC')[1].status, 'void');
  // An old id-less flipped sale gets the same id from readOrder (back office) and upgradeOrders (till).
  const old = { number: '1-0042', ts: d1, status: 'refunded', total: 10, items: [] };
  assert.equal(M.readOrder(old).id, `legacy:1-0042:${d1}`);
  assert.equal(M.upgradeOrders([old])[0].id, M.upgradeOrders([M.readOrder(old)])[0].id);
  assert.equal(M.readOrder({ number: '1-7', ts: d1, total: 1 }).id, '1-7');   // a plain old sale keeps its number
  // vatRate comes back from the row's own tax when it was never stored; a stored 0 stays 0.
  assert.equal(M.readOrder({ total: 112, vatAmount: 12 }).vatRate, 0.12);
  assert.equal(M.readOrder({ total: 108.88, vatAmount: 8.88, taxIncluded: false }).vatRate, 0.08875);
  assert.equal(M.readOrder({ total: 112, vatAmount: 12, vatRate: 0 }).vatRate, 0);
  assert.equal(M.readOrder({ total: 50 }).vatRate, 0);
  // receiptLines: no lines → none (orderLines keeps its blank line for summarize).
  assert.deepEqual(M.receiptLines({ total: 50, items: [] }), []);
  assert.equal(M.orderLines({ total: 50, items: [] }).length, 1);
  // sellerOf + staff: an old name-only row files under the person's id; a shared name stays a name.
  const team = [{ id: 'u-ana', name: 'Ana' }, { id: 'u-jo', name: 'Jo' }, { id: 'u-jo2', name: 'Jo' }];
  const sel = M.sellerOf([], team);
  assert.deepEqual([sel({ cashier: 'ana ' }).key, sel({ cashier: 'Jo' }).key, sel({ staffId: 'u-ana', cashier: 'Old name' }).name], ['u-ana', 'Jo', 'Ana']);
  // dates on the store's clock
  const seven = Date.UTC(2026, 9, 1, 23, 5);   // Fri 2 Oct 07:05 Manila
  assert.deepEqual(M.dateParts(seven), { year: 2026, month: 10, day: 2, hour: 7, minute: 5, weekday: 5 });
  assert.equal(M.dateParts('2026-10-02').weekday, 5);
  assert.deepEqual(['day', 'dayYear', 'time', 'weekday'].map((k) => M.dateText(seven, 'Asia/Manila', k)), ['Oct 2', 'Oct 2, 2026', '7:05 AM', 'Fri']);
  assert.equal(M.dateText('2026-10-02', 'America/Los_Angeles'), 'Oct 2');
  const days = M.groupByDay([{ ts: seven }, { ts: seven + 3600e3 }, { ts: seven - DAY }]);
  assert.deepEqual([...days].map(([k, r]) => [k, r.length]), [['2026-10-02', 2], ['2026-10-01', 1]]);
  // days ago counts store days: 23:30 yesterday is "Yesterday" an hour later, not "Today".
  const late = Date.UTC(2026, 9, 1, 15, 30), soon = late + 3600e3;
  assert.deepEqual([M.daysAgo(late, soon), M.agoText(late, soon), M.agoText(seven, seven), M.agoText(null), M.agoText(seven - 3 * DAY, seven)],
    [1, 'Yesterday', 'Today', 'Never', '3 days ago']);
  // order lists: signed row amounts, a parked cart is no amount; one sort, ties by number.
  const s = sale('L1', d1, [line('a', 1, 84, 1)]);
  assert.deepEqual([M.rowAmount(s), M.rowAmount(reverse(s, 'refund', d2)), M.rowAmount({ ...s, status: 'saved' })], [84, -84, null]);
  const tie = [{ ts: d1, number: '1-9' }, { ts: d1, number: '1-10' }, { ts: d2, number: '1-2' }].sort(M.newestFirst);
  assert.deepEqual(tie.map((o) => o.number), ['1-2', '1-10', '1-9']);
  // words
  assert.deepEqual([M.plural(1, 'day'), M.plural(3, 'order'), M.plural(2, 'box', 'boxes'), M.plural(1200, 'item')], ['1 day', '3 orders', '2 boxes', '1,200 items']);
  assert.deepEqual([M.pctText(0.1234), M.pctText(0.5, 0), M.pctText(NaN), M.pctText(0.2, 100, 0)], ['12.3%', '—', '—', '20%']);
  assert.deepEqual([M.formatMoney(20, 'PHP', { signed: true }), M.formatMoney(-20, 'PHP', { signed: true }), M.formatMoney(0, 'PHP', { signed: true }), M.formatMoney(20)],
    ['+₱20.00', '−₱20.00', '₱0.00', '₱20.00']);
  // a slip's words come from the row's state: a void is not an official receipt and gives money back.
  const gs = sale('G9', d1, [line('a', 1, 100, 1)], { number: '1-0042', paymentKind: 'gcash', payments: [{ method: 'other', amount: 100 }] });
  const gr = { ...reverse(gs, 'refund', d2), payments: [{ method: 'other', label: 'Refund', amount: 100 }] };
  const rp = M.receiptParts(gr, gs);
  assert.deepEqual([rp.kind, rp.mark, rp.paidWord, rp.whoWord, rp.legs[0].label], ['refund', 'REFUND of #1-0042', 'Given back', 'Refunded by', 'GCash']);
  assert.ok(!rp.footer.join(' ').includes('not returnable') && !rp.footer.join(' ').includes('serves as your official'));
  const sp = M.receiptParts(gs, null, M.reversals([gs, gr]));
  assert.deepEqual([sp.kind, sp.mark, sp.paidWord, sp.whoWord, sp.footer[0], sp.scPwd.length], ['refunded', '', 'Paid', 'Cashier', 'This serves as your official receipt.', 0]);
  assert.deepEqual(M.receiptParts({ ...gs, scPwdOff: 20, vatExempt: 80 }).scPwd.map((r) => r.amount), [20, 80]);
}

/* ---- Fix round 1b (2026-10-03): the shared answers the screens were working out themselves ---- */
{
  // taxIncluded is read off the rows: a PH day that refunded more than it sold is still "VAT included"
  // (its netSales < salesBeforeTax, which the screen used to read as tax on top).
  const big = sale('T1', d1 - DAY, [line('a', 1, 1120, 1)]), small = sale('T2', d1, [line('a', 1, 112, 1)]);
  const day = M.summarize([big, small, reverse(big, 'refund', d1 + 3600e3)], { from: d1 - 2 * 3600e3, to: d1 + DAY });
  assert.ok(day.netSales < 0 && day.salesBeforeTax > day.netSales);
  assert.equal(day.taxIncluded, true);
  const us = { ...sale('U1', d1, [line('a', 1, 100, 1)]), taxIncluded: false, total: 108, vatAmount: 8 };
  assert.deepEqual([M.summarize([us]).taxIncluded, M.summarize([us, small]).taxIncluded, M.summarize([]).taxIncluded], [false, true, true]);
  assert.equal(M.summarize([us], { by: () => 'x' }).groups.get('x').taxIncluded, false);
  // creditPart: the sale's stored account legs only, never the stand-in leg of a legless row.
  assert.deepEqual([M.creditPart({ payments: [{ method: 'cash', amount: 50 }, { method: 'credit', amount: 70.1 }, { method: 'credit', amount: 0.2 }] }),
    M.creditPart({ paymentKind: 'credit', total: 90 }), M.creditPart(null)], [70.3, 0, 0]);
  // sellerOf without a staff list reads the app's own (bo-model loadStaff), so one person is one key.
  globalThis.loadStaff = () => [{ id: 'u6', name: 'Liza M.' }];
  try { assert.deepEqual([M.sellerOf([])({ cashier: 'Liza M.' }).key, M.sellerOf([], [])({ cashier: 'Liza M.' }).key], ['u6', 'Liza M.']); }
  finally { delete globalThis.loadStaff; }
  // dayStartMs is remembered, and the same answer twice (DST zone included).
  assert.equal(M.dayStartMs('2026-03-08', 'America/New_York'), Date.UTC(2026, 2, 8, 5));
  assert.equal(M.dayStartMs('2026-03-09', 'America/New_York'), Date.UTC(2026, 2, 9, 4));
  assert.equal(M.dayStartMs('2026-03-09', 'America/New_York'), Date.UTC(2026, 2, 9, 4));
}

/* ---- Fix round 2 (2026-10-03) ---- */
{
  // A rate recovered from a small sale's own tax: P1, P2, P5 at 12% inside the price read 12%, not 12.375%.
  // (₱0.50's 5¢ fits 11% as well: below ₱1 a rate cannot be told -- rateOf's ponytail.)
  for (const p of [1, 2, 5, 13.37, 999.99]) {
    const t = M.orderTotals([{ price: p, qty: 1 }], null, { rate: 0.12, included: true });
    assert.equal(M.readOrder({ total: t.total, vatAmount: t.tax }).vatRate, 0.12, `₱${p}`);
  }
  for (const [rate, p] of [[0.08875, 100], [0.0725, 40], [0.06, 1]]) {
    const t = M.orderTotals([{ price: p, qty: 1 }], null, { rate, included: false });
    assert.equal(M.readOrder({ total: t.total, vatAmount: t.tax, taxIncluded: false }).vatRate, rate, `${rate} on ${p}`);
  }
  // pctText: a true minus; a share that is there never prints 0.0% or 100.0%.
  assert.deepEqual([M.pctText(-0.0412), M.pctText(0.0004), M.pctText(-0.0004), M.pctText(0.9996), M.pctText(1), M.pctText(0.003, 1, 0), M.pctText(0), M.pctText(1.25)],
    ['−4.1%', '<0.1%', '>−0.1%', '>99.9%', '100.0%', '<1%', '0.0%', '125.0%']);
  // change / changeText: one formula for every trend chip and Compare-to cell.
  assert.deepEqual([M.change(120, 100), M.change(50, -100), M.change(5, 0)], [0.2, 1.5, null]);
  assert.deepEqual([M.changeText(112.34, 100), M.changeText(96, 100), M.changeText(100.04, 100), M.changeText(5, 0), M.changeText(0, 0), M.changeText(150, 100, 0)],
    ['+12.3%', '−4.0%', '0.0%', 'New', '—', '+50%']);
  // dateText: weekday kinds; no time is '—' (an opening row's ts 0), never Jan 1, 1970. agoText(0) = Never.
  const seven = Date.UTC(2026, 9, 1, 23, 5);
  assert.deepEqual([M.dateText(seven, 'Asia/Manila', 'weekdayDay'), M.dateText(seven, 'Asia/Manila', 'weekdayDayYear'), M.dateText(0), M.dateText(null, 'Asia/Manila', 'time'), M.dateText('junk')],
    ['Fri, Oct 2', 'Fri, Oct 2, 2026', '—', '—', '—']);
  assert.deepEqual([M.agoText(0, seven), M.agoText(undefined, seven), M.agoText(String(seven), seven)], ['Never', 'Never', 'Today']);
  // chartTime: a same-day void sits at its sale's time; a refund, and a void another day, keep their own.
  const at = new Map([['s1', Date.UTC(2026, 9, 1, 1)], ['s2', Date.UTC(2026, 8, 30, 1)]]);
  const voidAt = Date.UTC(2026, 9, 1, 6);
  assert.deepEqual([M.chartTime({ status: 'void', originalOrderId: 's1', ts: voidAt }, at), M.chartTime({ status: 'refund', originalOrderId: 's1', ts: voidAt }, at),
    M.chartTime({ status: 'void', originalOrderId: 's2', ts: voidAt }, at), M.chartTime({ status: 'completed', ts: voidAt }, at)],
    [Date.UTC(2026, 9, 1, 1), voidAt, voidAt, voidAt]);
  // round2: the one centavo round, bo-model's to the digit.
  const B = createRequire(import.meta.url)('../bo-model.js');
  for (const v of [2.675, '12.344', null, -1.555, 0.1 + 0.2, 1e6 / 3]) assert.equal(M.round2(v), B.round2(v), String(v));
  assert.deepEqual([M.round2(2.675), M.round2('12.344'), M.round2(0.1 + 0.2)], [2.68, 12.34, 0.3]);
  // The SC/PWD row reads as part of Discount.
  assert.equal(M.receiptParts({ total: 80, scPwdOff: 20, vatExempt: 80 }).scPwd[0].label, 'Incl. SC/PWD discount');
}

/* ---- Fix round 3 (2026-10-03): the shared helpers the screens wire ---- */
{
  // A tiny 12% row reads as 12% (it fit 11% too); the store's rate is the hint, so tax on top keeps 8.875%.
  const tiny = (total, vat) => M.readOrder({ id: 't', ts: d1, status: 'completed', total, subtotal: total, vatAmount: vat, items: [] });
  assert.deepEqual([tiny(1.07, 0.11).vatRate, tiny(0.30, 0.03).vatRate], [0.12, 0.12]);
  const ny = M.readOrder({ id: 'n', ts: d1, status: 'completed', subtotal: 100, total: 108.88, vatAmount: 8.88, taxIncluded: false, items: [] }, { rate: 0.08875 });
  assert.equal(ny.vatRate, 0.08875);
  // .map(readOrder) passes the index as the 2nd argument: no throw, the 12% default.
  assert.equal([{ id: 'm', ts: d1, status: 'completed', total: 112, subtotal: 112, vatAmount: 12, items: [] }].map(M.readOrder)[0].vatRate, 0.12);
  // Orders never go negative: a window holding only another day's sale's void.
  const s1 = sale('s1', d1, [line('a', 1, 112, 50)]);
  assert.equal(M.summarize([reverse(s1, 'void', d2)], { from: d2, to: d2 + DAY }).orders, 0);
  // lastSale: a voided sale is not the last sale; a refunded one still is. Same as summarize's.
  const s2 = sale('s2', d2, [line('a', 1, 112, 50)]), s3 = sale('s3', d2 + 3600e3, [line('a', 1, 112, 50)]);
  const rows = [s1, s2, s3, reverse(s3, 'void', d2 + 7200e3), reverse(s2, 'refund', d2 + 7200e3)];
  assert.deepEqual([M.lastSale(rows), M.summarize(rows).lastSale, M.lastSale([])], [d2, d2, 0]);
  // daysOpenBy in one pass equals daysOpen of each group.
  const wk = (o) => M.dateParts(M.tsOf(o)).weekday;
  const many = [s1, s2, s3, sale('s4', d1 + 7 * DAY, [line('a', 1, 112, 50)]), { ...s1, id: 'p', status: 'saved' }];
  const by = M.daysOpenBy(many, wk);
  for (const k of new Set(many.map(wk))) assert.equal(by.get(k) || 0, M.daysOpen(many.filter((o) => wk(o) === k)), String(k));
  assert.equal(M.daysOpen(many), 3);
  // qtyText: whole numbers bare, a measure to 2 dp, float dust gone.
  assert.deepEqual([M.qtyText(1253), M.qtyText(1234.5), M.qtyText(1.0000001), M.qtyText(null), M.qtyText(-2)], ['1,253', '1,234.50', '1', '0', '-2']);
  assert.deepEqual([M.pluralWord(1, 'item'), M.pluralWord(0, 'item'), M.pluralWord(2, 'box', 'boxes'), M.plural(1200, 'sale')], ['item', 'items', 'boxes', '1,200 sales']);
  // The slip's Date line: MM/DD/YYYY HH:mm on the store's clock; no time is '—', never 01/01/1970.
  assert.deepEqual([M.dateText(Date.UTC(2026, 9, 2, 16, 5), 'Asia/Manila', 'slip'), M.dateText(0, 'Asia/Manila', 'slip'), M.dateText(undefined, 'Asia/Manila', 'slip')],
    ['10/03/2026 00:05', '—', '—']);
  // paidOf: a parked cart has no Paid row; an account sale paid nothing; cash reads as handed over.
  const cash = { ...s1, payments: [{ method: 'cash', amount: 285, tendered: 300, change: 15 }] };
  const acct = { ...s1, payments: [{ method: 'credit', amount: 112 }] };
  const split = { ...s1, payments: [{ method: 'credit', amount: 62 }, { method: 'gcash', amount: 50 }] };
  assert.deepEqual([M.paidOf({ ...s1, status: 'saved' }), M.paidOf(acct), M.paidOf(cash), M.paidOf(split), M.paidOf(reverse(split, 'refund', d2))],
    [null, { paid: 0, change: 0 }, { paid: 300, change: 15 }, { paid: 50, change: 0 }, { paid: 112, change: 0 }]);
  // totalRows: the back office's receipt and printer.js are the same rows.
  const P = createRequire(import.meta.url)('../printer.js');
  const o = M.readOrder(sale('tr', d1, [line('a', 2, 112, 50)], { cartOff: 24 }));
  const vm = { totals: o, scPwd: M.receiptParts(o).scPwd, taxName: 'VAT' };
  assert.deepEqual(M.totalRows(vm), P.totalRows(vm));
  assert.deepEqual(M.totalRows(vm).map((r) => r[0]), ['Subtotal', 'Discount', 'VATable sales', 'VAT (12%)']);
}

/* ---- Final round (2026-10-03): one copy of each money helper and rule ---- */
{
  // bo-model's cent / unc / round2 ARE SalesMath's (no second rounding); junk reads 0, never NaN.
  const B = createRequire(import.meta.url)('../bo-model.js');
  assert.ok(B.round2 === M.round2 && B.cent === M.cent && B.unc === M.unc);
  assert.deepEqual([M.cent('abc'), M.unc(undefined), M.round2('abc'), M.cent(4.7), M.unc(541)], [0, 0, 0, 470, 5.41]);
  // The till's markup→price is bo-model's (centavos, half up): 4.70 at 15% = 5.41, not the float's 5.40.
  assert.deepEqual([B.priceFromMargin(4.70, 'percent', 15), B.priceFromMargin(3.58, 'percent', 25), B.priceFromMargin(6.52, 'percent', 12.5)],
    [5.41, 4.48, 7.34]);
  // changeTone reads changeText's sign: up · down · nothing for 0.0%, New and —.
  assert.deepEqual([M.changeText(110, 100), M.changeText(90, 100), M.changeText(100, 100), M.changeText(5, 0), M.changeText(0, 0)].map(M.changeTone),
    ['up', 'down', '', '', '']);
  // bestDay: today never wins (it isn't over); a tie keeps the earlier day; nothing over → null.
  const days = [['2026-10-01', 500], ['2026-10-02', 300], ['2026-10-03', 2000], ['2026-09-30', 500]];
  assert.deepEqual([M.bestDay(days, '2026-10-03'), M.bestDay([['2026-10-03', 9]], '2026-10-03'), M.bestDay([[d1, 1], [d2, 2]], d2)],
    [['2026-10-01', 500], null, [d1, 1]]);
  // saleTender (app.js exchangeOrder rings the replacement on it): the money leg's key, never the account.
  const legKey = M.saleTender;
  assert.deepEqual([legKey({ paymentKind: 'gcash', payments: [{ method: 'other', amount: 285 }] }),
    legKey({ paymentKind: 'other', paymentMethodLabel: 'Maya', payments: [{ method: 'other', amount: 9 }] }),
    legKey({ payments: [{ method: 'credit', amount: 9 }] }), legKey({ paymentKind: 'qr', total: 5 })], ['gcash', 'Maya', 'cash', 'qr']);
}

console.log('sales-math: ok');
