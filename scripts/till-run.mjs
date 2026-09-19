/* A trading day, rung headless against the real till, then reconciled.

   The POS is driven here the way a cashier drives it -- fill the cart, pick a payment method,
   check out -- but from Node, so a whole day of sales, credit, splits, voids, refunds, returns
   and an exchange takes a second instead of an afternoon of clicking. Then the books are added
   up a second time, independently, from what the harness KNOWS it rang, and the two are
   compared. Anything the till gets wrong shows up as a mismatch, not as a plausible number.

   node scripts/till-run.mjs [--verbose]
*/
import assert from 'node:assert/strict';
import { boot } from './lib/till.mjs';

const verbose = process.argv.includes('--verbose');
const till = boot();
const money = (n) => '₱' + (Math.round(n * 100) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 });
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: got ${a}, expected ${b}`);

// ---- The harness's own books -------------------------------------------------
// Kept by hand as the day is rung, so the reconciliation below compares two independent
// stories about the same day rather than asking app.js to agree with itself.
const sold = new Map();          // productId -> net units off the shelf
const live = [];                 // orders that still count as revenue
let cashIn = 0, credited = 0, paidOut = 0;

const take = (items, sign = 1) => items.forEach(([sku, qty]) => {
  const id = till.bySku(sku).id;
  sold.set(id, round((sold.get(id) || 0) + sign * qty));
});

/** Ring a sale and book it in the harness's ledger too. */
function sell(label, opts) {
  const o = till.ring(opts);
  assert.ok(o, `${label} should have gone through -- till said: ${till.error() || '(nothing)'}`);
  // Every receipt has to hold together on its own before it can hold together with the day.
  near(o.total, round(o.subtotal - o.discount), `${label} total = subtotal - discount`);
  near(o.vatableSales + o.vatAmount, o.total, `${label} VAT splits the total exactly`);
  near(o.payments.reduce((n, p) => n + p.amount, 0), o.total, `${label} payments cover the total`);
  take(opts.items, -1);
  live.push(o);
  cashIn += o.payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0);
  credited += o.payments.filter(p => p.method === 'credit').reduce((n, p) => n + p.amount, 0);
  if (verbose) console.log(`  ${o.number}  ${label.padEnd(28)} ${money(o.total).padStart(12)}  ${o.paymentMethodLabel || o.paymentMethod}`);
  return o;
}

/** Reverse one, whichever way. All of them put the stock back and cancel the money. */
function reverse(how, o, label, swapFor) {
  const back = swapFor ? till.exchange(o.number, swapFor) : till[how](o.number);
  assert.ok(back, `${label} should have been ${how}ed`);
  take(o.items.map(i => [i.id, i.qty]), 1);
  live.splice(live.indexOf(o), 1);
  cashIn -= o.payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0);
  credited -= o.payments.filter(p => p.method === 'credit').reduce((n, p) => n + p.amount, 0);
  paidOut += o.payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0);
  if (verbose) console.log(`  ${o.number}  ${label.padEnd(28)} ${money(-o.total).padStart(12)}  ${how}`);
  return back;
}

const openingBalance = (name) => till.run('allCustomerRecords()')
  .find(c => c.name === name).currentBalance;
const marieOpening = openingBalance('Marie Variety Store');
const ricardoOpening = openingBalance('Ricardo Construction');

// ---- The day -----------------------------------------------------------------
if (verbose) console.log('\nSales');

const walkIn = sell('walk-in, cash', {
  items: [['p001', 6], ['p006', 2]], method: 'cash', tendered: 200,
});
const gcash = sell('gcash', { items: [['e004', 1], ['e005', 3]], method: 'gcash' });
const maya = sell('e-wallet, custom name', { items: [['a001', 1]], method: 'other', otherName: 'Maya' });
// An e-wallet is not cash. Booking it as one printed CASH on the receipt and left the drawer
// expecting money that never went in it -- so the payment leg has to carry its own name.
assert.notEqual(gcash.payments[0].method, 'cash', 'a GCash sale is not a cash payment leg');
assert.equal(gcash.payments[0].label, 'GCash', 'and the receipt line says GCash');
assert.equal(maya.payments[0].label, 'Maya', 'a custom method keeps the name that was typed');

// Sold by measure: 12.5 m of wire is one line, not 13.
const wire = sell('cut wire, by measure', {
  items: [['e001', 12.5]], method: 'cash', tendered: 500,
});
assert.equal(wire.items[0].qty, 12.5, 'a measure product keeps its fraction');

// A contractor's 5% comes off by itself at checkout -- nobody types it. The back office sees
// it as an ordinary receipt discount, which is why gross profit stays right without a
// price-tier column anywhere in the reports.
const trade = sell('contractor, on account', {
  items: [['c001', 20], ['f001', 5]], method: 'credit', customer: 'Ricardo Construction',
});
assert.equal(trade.cartDiscount?.tierType, 'contractor', 'the contractor tier is stamped on the receipt');
near(trade.discount, round(trade.subtotal * 0.05), 'and it is 5% off, applied without anyone asking');

const split = sell('split: part cash, rest on account', {
  items: [['p004', 4]], method: 'split', customer: 'Ricardo Construction', tendered: 200,
});
assert.equal(split.payments.length, 2, 'a split writes two payment legs');
near(split.payments[0].amount, 200, 'the cash leg is what was handed over');
near(split.payments[1].amount, split.total - 200, 'the rest goes on the account');

const discounted = sell('receipt discount, 10%', {
  items: [['p005', 2], ['p003', 4]], method: 'cash', tendered: 1000,
  discount: { type: 'percent', value: 10 },
});
near(discounted.discount, round(discounted.subtotal * 0.10), 'a 10% receipt discount');

const delivery = sell('delivery', {
  items: [['c001', 40]], method: 'cash', tendered: 12000,
  fulfilment: 'delivery', address: 'Blk 7 Lot 12, San Pedro',
});
assert.equal(delivery.fulfilment, 'delivery');
assert.equal(delivery.deliveryAddress, 'Blk 7 Lot 12, San Pedro');

// ---- The four ways a sale comes back -----------------------------------------
if (verbose) console.log('\nReversals');

const toVoid = sell('rung in error', { items: [['p002', 3]], method: 'cash', tendered: 100 });
reverse('void', toVoid, 'voided');

const toRefund = sell('to be refunded', { items: [['e003', 2]], method: 'cash', tendered: 500 });
reverse('refund', toRefund, 'refunded');

const toReturn = sell('to be returned', {
  items: [['p005', 1]], method: 'credit', customer: 'Marie Variety Store',
});
const returnRow = reverse('return', toReturn, 'returned');

// The same thing again, paid in cash: the money goes back over the counter, so the drawer
// has to lose it even though the original receipt stays `completed`.
const cashReturn = sell('to be returned, cash', {
  items: [['p006', 2]], method: 'cash', tendered: 500,
});
reverse('return', cashReturn, 'returned, cash');
assert.equal(returnRow.status, 'return', 'a return is its own row');
assert.equal(returnRow.originalOrderId, toReturn.id, 'and it points at what it reverses');
assert.equal(till.orders().find(o => o.id === toReturn.id).status, 'completed',
  'the original stays completed -- SALE_SIGN.return = -1 is what cancels it');

// Which is exactly why it has to be stopped from being returned again: nothing about the
// original says it has been. Twice through put the goods back twice and paid out twice.
const shelfAfterReturn = till.stock('p005').cached;
assert.equal(till.return(toReturn.number), null, 'a receipt can only be returned once');
near(till.stock('p005').cached, shelfAfterReturn, 'and the second attempt moves no stock');
assert.equal(till.orders().filter(o => o.originalOrderId === toReturn.id).length, 1,
  'one return row, not two');

// An exchange is a reversal and a new sale in one gesture.
const toSwap = sell('to be exchanged', { items: [['t002', 1]], method: 'cash', tendered: 500 });
const { exchangeSale: swapped } = reverse('exchange', toSwap, 'exchanged', [['t004', 1]]);
assert.equal(swapped.status, 'completed', 'the exchange books a fresh sale');
assert.equal(till.orders().find(o => o.id === toSwap.id).status, 'refunded',
  'the exchanged original is flipped in place, so only the replacement books revenue');
take([['t004', 1]], -1);
live.push(swapped);
cashIn += swapped.payments.filter(p => p.method === 'cash').reduce((n, p) => n + p.amount, 0);

// ---- Paying down an account --------------------------------------------------
till.payCredit('Ricardo Construction', 5000, 'Cash payment on account');

// ---- Reconciliation ----------------------------------------------------------
// 1. Stock. Three numbers per SKU that must all be the same: the cached field on the product,
//    opening plus the movement log, and opening minus what the harness knows it sold.
for (const [id, qty] of sold) {
  const s = till.stock(id);
  near(s.cached, s.expected, `${s.product.name}: cached stock vs the movement log`);
  near(s.cached, round(s.opening + qty), `${s.product.name}: stock left vs what was rung`);
}

// Every movement points at the receipt that caused it, and the pair nets to zero on a reversal.
const byRef = new Map();
for (const m of till.movements()) {
  if (!m.refId) continue;
  byRef.set(m.refId, round((byRef.get(m.refId) || 0) + m.qty));
}
for (const o of [toVoid, toRefund, toReturn, toSwap]) {
  near(byRef.get(o.id) || 0, 0, `reversed ${o.number}: sale and restore movements cancel`);
}
near(byRef.get(walkIn.id), -8, 'a plain sale moves exactly what it sold');

// 2. Revenue, the way the back office reads it: signed by status, nothing filtered out.
const SALE_SIGN = { completed: 1, return: -1, refunded: 0, voided: 0, saved: 0 };
const booked = till.orders().reduce((n, o) => n + (SALE_SIGN[o.status || 'completed'] ?? 0) * o.total, 0);
near(booked, live.reduce((n, o) => n + o.total, 0), 'revenue: the signed ledger vs the live sales');

// 3. Receivables. The stored balance, the ledger it is supposed to summarise, and the credit
//    legs of the sales that still count all have to land on the same peso.
const ledgerBalance = (name) => {
  const c = till.run('allCustomerRecords()').find(x => x.name === name);
  return round(till.ledger(c.id).reduce((n, e) => n + (e.type === 'payment' ? -e.amount : e.amount), 0));
};
near(openingBalance('Ricardo Construction'), ricardoOpening + credited - 5000,
  'Ricardo: charged, then paid 5,000 down');
near(ledgerBalance('Ricardo Construction'), openingBalance('Ricardo Construction') - ricardoOpening,
  'Ricardo: the ledger explains every peso of the movement in the balance');
near(openingBalance('Marie Variety Store'), marieOpening,
  'Marie: the returned charge came back off her account');

// 4. The drawer. Cash in, minus cash handed back over the counter.
const drawer = till.orders().reduce((n, o) => {
  const sign = SALE_SIGN[o.status || 'completed'] ?? 0;
  return n + sign * o.payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
}, 0);
near(drawer, cashIn, 'drawer: cash taken vs cash booked');
// And the till's own end-of-day count has to be the same number. A return leaves the original
// receipt `completed`, so the cash handed back has to come off here or the drawer reads long.
near(till.run('buildCashDrawerSummary()').expectedCash, cashIn, 'drawer: the app own count vs cash booked');

// 5. Selling what is not there. A shelf cannot go negative unless the product says it may,
//    or unless a manager says so out loud.
const onHand = till.stock('c001').cached;
assert.ok(!till.bySku('c001').sellOutOfStock, 'cement is not a sell-out-of-stock product');
const refused = till.ring({ items: [['c001', onHand + 50]], method: 'cash', tendered: 999999, approve: false });
assert.equal(refused, null, `the till sold ${onHand + 50} bags of cement when it had ${onHand}`);
assert.match(till.error(), /Not enough/, 'and it says why');
near(till.stock('c001').cached, onHand, 'a refused sale moves no stock');

const overridden = till.ring({ items: [['c001', onHand + 50]], method: 'cash', tendered: 999999, approve: true });
assert.ok(overridden, 'a manager can still override a bad count and make the sale');
near(till.stock('c001').cached, -50, 'and the shelf goes negative on purpose, with a movement to explain it');
till.void(overridden.number);
near(till.stock('c001').cached, onHand, 'voiding the override puts it back');

// ---- Report ------------------------------------------------------------------
const cut = (key, label) => {
  const m = new Map();
  for (const o of till.orders()) {
    const sign = SALE_SIGN[o.status || 'completed'] ?? 0;
    const k = key(o);
    m.set(k, round((m.get(k) || 0) + sign * o.total));
  }
  console.log(`\n  ${label}`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padEnd(24)} ${money(v).padStart(12)}`);
  }
};

console.log(`\nDay closed: ${till.orders().length} receipts`);
console.log(`  revenue   ${money(booked).padStart(12)}`);
console.log(`  drawer    ${money(drawer).padStart(12)}`);
console.log(`  on account${money(credited - 5000).padStart(12)}`);
cut(o => o.paymentMethodLabel || o.paymentMethod, 'By payment');
cut(o => o.status || 'completed', 'By status');

console.log('\n  Stock left');
for (const [id] of sold) {
  const s = till.stock(id);
  const low = s.cached <= (s.product.reorderPoint || 0) ? '  <- reorder' : '';
  console.log(`    ${s.product.name.slice(0, 30).padEnd(32)} ${String(s.opening).padStart(7)} -> ${String(s.cached).padStart(7)} ${s.product.unit}${low}`);
}

console.log('\ntill-run: the day reconciles.');
