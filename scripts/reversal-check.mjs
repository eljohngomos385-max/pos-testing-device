// Voids and refunds on the till: each one failed before its fix (review of 2026-10-02).
// Run: node scripts/reversal-check.mjs
import assert from 'node:assert/strict';
import { boot } from './lib/till.mjs';

const till = boot({ now: new Date(2026, 9, 1, 10, 0).getTime() });   // no PINs yet: the owner

// A partly paid account sale, refunded: the account takes back only what is still owed and the
// rest goes back in cash. The ledger used to log the whole charge and sit at −₱400.
till.run(`saveCustomer({ id: 'cz', name: 'Zero Co', creditOn: true, creditLimit: 5000 })`);
const bal = () => till.run(`allCustomerRecords().find(c => c.id === 'cz').currentBalance`);
const sale = till.ring({ items: [['c001', 2]], method: 'credit', customer: 'Zero Co' });
till.payCredit('Zero Co', 400, 'part');
const owed = Math.round((sale.total - 400) * 100) / 100;
assert.equal(bal(), owed);
till.clock(new Date(2026, 9, 5, 9, 0).getTime());
till.run(`state.settings.store = { ...state.settings.store, cashier: 'Manager Ana', registerNo: '2' };`);
const refund = till.refund(sale.number);
assert.equal(bal(), 0);
assert.equal(Math.round(till.balance('Zero Co') * 100) / 100, 0, 'ledger agrees with the balance');
assert.deepEqual(refund.payments.map(p => [p.method, p.amount]), [['credit', owed], ['cash', 400]]);

// A sale is reversed once: a second refund (or a void after it) adds no row and moves no stock.
const rows = () => till.run('loadOrders().length');
const shelf = () => till.run(`state.products.find(p => p.id === 'c001').stock`);
const [n0, s0] = [rows(), shelf()];
assert.equal(till.run(`refundOrder('${sale.id}', 'again')`), null);
assert.equal(till.run(`voidOrder('${sale.id}', 'again')`), null);
assert.deepEqual([rows(), shelf()], [n0, s0]);

// Paying more than is owed keeps the money: the balance goes below zero (the store owes them,
// owner 2026-10-02) and the ledger says the same. It used to stop at 0 and log the whole ₱100.
till.payCredit('Zero Co', 100, 'over');
assert.equal(bal(), -100);
assert.equal(Math.round(till.balance('Zero Co') * 100) / 100, -100);

// The refund row is the manager's, on their register, with nothing tendered.
assert.deepEqual([refund.tendered, refund.change], [0, 0]);
assert.deepEqual([refund.cashier, refund.register], ['Manager Ana', '2']);

// The slip says what it is.
assert.match(till.run(`toReceiptViewModel(loadOrders().find(o => o.id === '${refund.id}')).mark`), /^REFUND of #/);

// A store that is not VAT registered charges the shelf price.
till.run('state.settings.vatInclusive = false;');
const plain = till.ring({ items: [['c001', 1]], method: 'cash' });
assert.equal(plain.vatAmount, 0);
assert.equal(plain.total, till.run(`state.products.find(p => p.id === 'c001').price`));

// Saving a sale appends one row; the rows already stored stay exactly as written. It used to
// re-save the normalized history, stamping today's cost onto an old line that had none.
till.run(`writeJsonStorage(STORAGE_ORDERS, [{ id: 'old1', number: '1-900', ts: 1, status: 'completed', total: 50,
  items: [{ productId: 'c001', name: 'Old', qty: 1, price: 50 }], payments: [{ method: 'cash', amount: 50 }] },
  ...readJsonStorage(STORAGE_ORDERS, [])])`);
const before = till.run(`JSON.stringify(readJsonStorage(STORAGE_ORDERS, []))`);
till.ring({ items: [['c001', 1]], method: 'cash' });
const after = till.run(`readJsonStorage(STORAGE_ORDERS, [])`);
assert.equal(JSON.stringify(after.slice(1)), before, 'stored rows untouched');
assert.equal('cost' in after.find(o => o.id === 'old1').items[0], false);

// Step 2.2: a sale and its refund net to zero on every rung, by tender and on the shelf. A real
// till sale with a cart discount, paid part cash part on account, refunded on a later day.
till.run('state.settings.vatInclusive = true;');
till.run(`saveCustomer({ id: 'cn', name: 'Net Co', creditOn: true, creditLimit: 50000 })`);
const stock0 = [shelf(), till.onHand('c002')];
const mixed = till.ring({ items: [['c001', 3], ['c002', 1.5]], method: 'split', customer: 'Net Co', tendered: 500,
  discount: { type: 'percent', value: 5 } });
assert.deepEqual(mixed.payments.map(p => p.method), ['cash', 'credit'], 'a split is one row per payment');
till.clock(new Date(2026, 9, 8, 15, 0).getTime());
const back = till.refund(mixed.number);
const net = JSON.parse(till.run(`(() => { const rows = loadOrders().filter(o => ['${mixed.id}', '${back.id}'].includes(o.id));
  return JSON.stringify({ ladder: SalesMath.summarize(rows), tenders: [...SalesMath.tenders(rows)] }); })()`));
for (const k of ['netSales', 'discounts', 'tax', 'salesBeforeTax', 'vatExempt', 'collected', 'costOfGoods', 'grossProfit', 'unitsSold'])
  assert.equal(net.ladder[k], 0, `sale + refund: ${k} nets to zero`);
assert.equal(net.ladder.grossSales, net.ladder.refunds, 'the refund takes back exactly the gross');
assert.ok(net.ladder.costOfGoods === 0 && mixed.items.every(i => i.cost > 0), 'lines carried their cost');
assert.deepEqual(net.tenders, [], 'cash and account each net to zero, and a tender at zero is not listed (SalesMath.tenders)');
assert.deepEqual([shelf(), till.onHand('c002')], stock0, 'the goods are back on the shelf');

// Step 2.3: a cashier can't void, refund or charge past a limit alone (owner, 2026-10-02). The PIN
// pop-up opens and nothing is written; a manager's PIN does it and the approval is logged with
// their staff id. A cashier's own PIN, an archived manager's, or a non-PIN approves nothing.
const events = [];
till.context.HWPOS_STORE = { events: { append: (type, data) => events.push({ type, ...data }) } };
till.run(`saveStaff([{ id: 'm1', name: 'Mara', role: 'manager', pin: '4321', active: true },
  { id: 'k1', name: 'Cy', role: 'cashier', pin: '1111', active: true },
  { id: 'm2', name: 'Gone', role: 'manager', pin: '9999', active: false }])`);
const pinModal = till.el('#pinModal');
const pin = (p) => { till.el('#pinInput').value = p; till.run('approveWithPin()'); };
// C1: with PINs set the till locks (what boot and Switch person both call); only a PIN opens it,
// and the person who signed in is the cashier on every row.
till.run('lockTill()');
assert.deepEqual([pinModal.hidden, till.run('state.user')], [false, null], 'the till is locked');
pin('0000');
assert.equal(pinModal.hidden, false, 'a wrong PIN opens nothing');
pin('1111');
assert.deepEqual(JSON.parse(till.run('JSON.stringify([state.user, state.role])')),
  [{ id: 'k1', name: 'Cy', role: 'cashier' }, 'cashier']);
assert.equal(pinModal.hidden, true, 'signed in');
const tryVoid = till.ring({ items: [['c001', 1]], method: 'cash' });
assert.deepEqual([tryVoid.staffId, tryVoid.cashier, tryVoid.approvedBy], ['k1', 'Cy', ''], 'the sale is the signed-in person\'s');
const n2 = rows();
assert.equal(till.void(tryVoid.number), null);
assert.equal(pinModal.hidden, false, 'the PIN pop-up opens');
for (const p of ['1111', '9999', '12', '']) pin(p);
assert.deepEqual([rows(), pinModal.hidden], [n2, false], 'no row until a manager approves');
pin('4321');
assert.deepEqual([rows(), pinModal.hidden], [n2 + 1, true]);
assert.deepEqual([till.orders()[0].status, till.orders()[0].originalOrderId], ['void', tryVoid.id]);
// M1: the void row names who rang it and who approved it.
assert.deepEqual([till.orders()[0].staffId, till.orders()[0].cashier, till.orders()[0].approvedBy], ['k1', 'Cy', 'm1']);
assert.deepEqual(events.filter(e => e.type === 'approval').map(e => [e.action, e.staffId, e.orderId]), [['void', 'm1', tryVoid.id]]);
// Refund: same gate. Over the limit: the PIN carries straight on with the sale.
assert.equal(till.refund(mixed.number), null, 'already refunded: refused before any PIN');
till.run(`saveCustomer({ id: 'cl', name: 'Low Co', creditOn: true, creditLimit: 100 })`);
const n3 = rows();
assert.equal(till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Low Co' }), null);
assert.equal(pinModal.hidden, false);
pin('4321');
assert.equal(rows(), n3 + 1, 'approved: the over-limit sale goes through');
assert.equal(events.filter(e => e.type === 'approval').at(-1).action, 'overLimit');
assert.deepEqual([till.orders()[0].staffId, till.orders()[0].approvedBy], ['k1', 'm1'], 'over-limit sale carries its approver');
// m1: the pop-up says how far over, and the limit, in money.
assert.match(till.el('#pinMessage').textContent, /Low Co would go ₱[\d,.]+ over their ₱100\.00 credit limit\./);
// The role switch: a cashier role given Refund in the back office does it without a PIN.
till.run(`saveTillPerms({ cashier: ['refund'] })`);
const own = till.ring({ items: [['c001', 1]], method: 'cash' });
const ownBack = till.refund(own.number);
assert.deepEqual([ownBack.status, ownBack.staffId, ownBack.approvedBy], ['refund', 'k1', ''], 'no PIN, no approver');
// C2: a PIN two active people share names nobody -- it neither signs in nor approves.
till.run(`saveStaff([...loadStaff(), { id: 'm3', name: 'Twin', role: 'manager', pin: '4321', active: true }])`);
assert.deepEqual([till.run(`staffByPin('4321')`), till.run(`approverFor('4321', 'void')`)], [null, null]);
till.run('lockTill()');
pin('4321');
assert.deepEqual([pinModal.hidden, till.run('state.user')], [false, null], 'a shared PIN signs no one in');
pin('1111');
delete till.context.HWPOS_STORE;

// M3: an old row is read, never re-priced -- no VAT it didn't record, no cost it didn't stamp.
const legacy = JSON.parse(till.run(`JSON.stringify(normalizeOrderRecord({ id: 'L1', number: '1-1', ts: 5, status: 'completed',
  total: 112, items: [{ productId: 'c001', name: 'x', qty: 1, price: 112 }] }))`));
assert.deepEqual([legacy.vatAmount, legacy.vatExempt, legacy.items[0].cost, legacy.payments[0].amount], [0, 0, null, 112]);

// m4: an SC/PWD sale (forced, as the checkout step will) keeps no discount it didn't give -- the
// 20% beat the 10% cart discount and the line's 5%, so the row stores neither.
till.run(`(() => { const o = SalesMath.orderTotals; globalThis.__ot = o; SalesMath.orderTotals = (l, c, x) => o(l, c, { ...x, scPwd: true }); })()`);
// The harness rings plain lines; give the first one a 5% line discount as the checkout opens.
till.run(`globalThis.__op = openPaymentModal; openPaymentModal = () => { state.cart[0].discount = { type: 'percent', value: 5 }; __op(); }`);
const sc = till.ring({ items: [['c001', 2]], method: 'cash', discount: { type: 'percent', value: 10 } });
till.run('SalesMath.orderTotals = globalThis.__ot; openPaymentModal = globalThis.__op;');
assert.ok(sc.scPwdOff > 0 && sc.vatExempt > 0, 'the SC/PWD discount was given');
assert.deepEqual([sc.cartDiscount, sc.items[0].discount, sc.items[0].lineDiscount], [null, null, 0], 'no store discount stored beside it');
assert.equal(Math.round((sc.subtotal - sc.discount) * 100) / 100, sc.total, 'the row agrees with itself');

// Line refunds (owner 2026-10-03): one line, or part of one, a new row each time; never more than was
// sold over all of them, and refunds that add up to the whole sale give back exactly its money.
const as = (id, name, role) => till.run(`state.user = { id: '${id}', name: '${name}', role: '${role}' }`);
const find = (id) => `state.orders.find(o => o.id === '${id}')`;
const pick = (o, picks) => JSON.parse(till.run(`JSON.stringify(recordReturn('${o.id}', 'Refund', ${JSON.stringify(picks)}))`) ?? 'null');
as('m1', 'Mara', 'manager');
const lr = till.ring({ items: [['c001', 3], ['c002', 2]], method: 'cash', discount: { type: 'percent', value: 5 } });
as('k1', 'Cy', 'cashier');
const s1 = shelf(), n4 = rows();
const r1 = pick(lr, [{ lineNo: 0, qty: 1 }]);
assert.deepEqual(r1.items.map(i => [i.lineNo, i.qty]), [[0, 1]], 'one unit of one line');
assert.ok(r1.total > 0 && r1.total < lr.total && r1.vatAmount > 0);
assert.equal(Math.round((r1.subtotal - r1.discount) * 100) / 100, r1.total, 'the refund row agrees with itself');
assert.equal(shelf(), s1 + 1, 'one unit back on the shelf');
assert.equal(till.run(`orderState(${find(lr.id)})`), 'sale', 'a partly refunded sale still stands');
assert.equal(till.run(`orderStatusLabel(${find(lr.id)})`), 'Part refunded', 'and reads Part refunded (owner 2026-10-03)');
assert.equal(till.run(`canVoid(${find(lr.id)})`), false, 'and can no longer be voided');
assert.equal(till.run(`voidOrder('${lr.id}', 'Void')`), null);
assert.equal(pick(lr, [{ lineNo: 0, qty: 3 }]), null, 'only 2 of line 0 are left');
assert.equal(rows(), n4 + 1);
const r2 = pick(lr, [{ lineNo: 0, qty: 2 }, { lineNo: 1, qty: 2 }]);
assert.deepEqual(r2.items.map(i => [i.lineNo, i.qty]), [[0, 2], [1, 2]]);
assert.equal(till.run(`orderState(${find(lr.id)})`), 'refunded', 'every unit back: refunded');
assert.equal(till.run(`orderStatusLabel(${find(lr.id)})`), 'Refunded', 'fully refunded stays Refunded');
const lnet = JSON.parse(till.run(`(() => { const rows = loadOrders().filter(o => ['${lr.id}', '${r1.id}', '${r2.id}'].includes(o.id));
  return JSON.stringify({ ladder: SalesMath.summarize(rows), tenders: [...SalesMath.tenders(rows)] }); })()`));
for (const k of ['netSales', 'discounts', 'tax', 'salesBeforeTax', 'collected', 'costOfGoods', 'unitsSold'])
  assert.equal(lnet.ladder[k], 0, `sale + two line refunds: ${k} nets to zero`);
assert.equal(lnet.ladder.grossSales, lnet.ladder.refunds);
assert.deepEqual(lnet.tenders, [], 'the drawer gave back exactly what came in');
const [n5, s5] = [rows(), shelf()];
assert.equal(pick(lr, [{ lineNo: 1, qty: 1 }]), null, 'a third refund is refused');
assert.equal(till.refund(lr.number), null);
assert.deepEqual([rows(), shelf()], [n5, s5], 'nothing written, nothing moved');
// An account sale: the part that comes back comes off the account, none out of the drawer.
const ac = till.ring({ items: [['c001', 2]], method: 'credit', customer: 'Net Co' });
const b0 = till.balance('Net Co');
const ar = pick(ac, [{ lineNo: 0, qty: 1 }]);
assert.deepEqual(ar.payments.map(p => p.method), ['credit']);
assert.equal(Math.round((b0 - till.balance('Net Co')) * 100) / 100, ar.total);

// Exchange (owner 2026-10-03): the customer's own pick, rung in the cart. The new sale is the
// presser's; the part that came back still counts against the original seller.
as('m1', 'Mara', 'manager');
const ex = till.ring({ items: [['c001', 2], ['c002', 1]], method: 'cash' });
as('k1', 'Cy', 'cashier');
till.run(`startExchange('${ex.id}', [{ lineNo: 0, qty: 1 }])`);
assert.equal(till.run('!!state.exchange && state.cart.length'), 0, 'the cart opens empty for the pick');
till.run(`state.cart = ${JSON.stringify(till.lines([['c002', 1]]))}`);
const swap = JSON.parse(till.run(`JSON.stringify(exchangeOrder(state.exchange.orderId, state.cart, 'Exchange', '', state.exchange.picks))`));
assert.deepEqual(swap.refund.items.map(i => [i.lineNo, i.qty]), [[0, 1]], 'only what came back is refunded');
assert.deepEqual(swap.exchangeSale.items.map(i => [i.id, i.qty]), [[till.bySku('c002').id, 1]], 'the customer\'s pick');
assert.equal(till.run('state.exchange === null && state.cart.length === 0'), true, 'the cart is clear again');
const who = JSON.parse(till.run(`JSON.stringify((() => { const s = SalesMath.sellerOf(loadOrders(), loadStaff());
  return [s(${find(swap.refund.id)}).key, s(${find(swap.exchangeSale.id)}).key]; })())`));
assert.deepEqual(who, ['m1', 'k1'], 'the refund is the seller\'s, the replacement the presser\'s');
assert.equal(till.run(`orderState(${find(ex.id)})`), 'sale', 'the rest of the sale stands');
// The cart as it stands is the new sale, its cart discount too, and the confirm's difference is what the drawer moves.
till.run(`startExchange('${ex.id}', [{ lineNo: 1, qty: 1 }])`);
till.run(`state.cart = ${JSON.stringify(till.lines([['c001', 3]]))}; state.cartDiscount = { type: 'percent', value: 20 }`);
const shown = till.run('cartTotals().total');
const due = till.run(`(() => { const o = ${find(ex.id)}; return exchangeMoney(o, refundPlan(o, state.exchange.picks).part, cartTotals().total).net; })()`);
const sw2 = JSON.parse(till.run(`JSON.stringify(exchangeOrder(state.exchange.orderId, state.cart, 'Exchange', '', state.exchange.picks))`));
assert.equal(sw2.exchangeSale.total, shown, 'saved at the total the cart showed');
assert.equal(sw2.exchangeSale.cartDiscount?.value, 20, 'the cart discount is kept');
assert.ok(sw2.exchangeSale.discount > 0);
const drawer = till.run(`SalesMath.summarize(loadOrders().filter(o => ['${sw2.refund.id}', '${sw2.exchangeSale.id}'].includes(o.id))).collected`);
assert.ok(due !== 0 && Math.abs(drawer - due) < 0.005, `hand back ${-due}, the drawer moved ${drawer}`);

console.log('reversal-check: ok');
