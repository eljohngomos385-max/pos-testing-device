// Customers: the balance is the ledger (features/customers, step 3). Each block failed before its
// fix; the bug numbers are the note's "Wrong today" list. Drives the real app.js + bo-model.js.
// Run: node scripts/customer-ledger-check.mjs
import assert from 'node:assert/strict';
import { boot } from './lib/till.mjs';

const till = boot({ now: new Date(2026, 9, 1, 10, 0).getTime() });
// Values copied out of the app realm, so deepEqual compares data, not prototypes.
const run = (code) => { const v = till.run(code); return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; };
run('state.role = "manager"');
const r2 = (n) => Math.round(n * 100) / 100;
const acct = (id) => run(`allCustomerRecords().find(c => c.id === ${JSON.stringify(id)})`);
const rows = (id) => till.ledger(id);

// Bug 4: the seeded balances are opening rows, so balance = SUM(ledger) from the first boot,
// and migrating again (a second till, a reload) writes nothing.
assert.equal(acct('c-001').currentBalance, 8450);
assert.deepEqual(rows('c-001').map(r => [r.id, r.type, r.amount]), [['opening:c-001', 'opening', 8450]]);
const n0 = rows().length;
run('migrateCustomers()');
assert.equal(rows().length, n0, 'migration runs once');
// Bug 5, 12: one record shape, no type; credit on came over from isCreditCustomer.
assert.deepEqual([acct('c-001').creditOn, 'type' in acct('c-001')], [true, false]);

// Bug 5: credit off means no account sale, Account or Split.
run(`saveCustomer({ id: 'off', name: 'Cash Only', creditOn: false })`);
assert.equal(till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Cash Only' }), null);
assert.match(till.error(), /credit off/);
assert.equal(till.ring({ items: [['c001', 1]], method: 'split', customer: 'Cash Only', tendered: 10 }), null);

// Bug 6: credit on with no limit has no cap; the one form refuses a limit of 0.
run(`saveCustomer({ id: 'nl', name: 'No Limit Co', creditOn: true, creditLimit: null })`);
const big = till.ring({ items: [['c001', 400]], method: 'credit', customer: 'No Limit Co' });
assert.ok(big && big.total > 100000, 'no limit, no cap');
assert.equal(run(`customerFromForm({ name: 'X', creditOn: 'on', creditLimit: '0' })`).field, 'creditLimit');
assert.equal(run(`accountStatus(allCustomerRecords().find(c => c.id === 'nl'))[1]`), 'Active');
assert.equal(run(`limitText(allCustomerRecords().find(c => c.id === 'nl'))`), 'No limit');   // bug 11: never a negative Available credit

// Over limit is a status, past the limit (not at it).
run(`saveCustomer({ id: 'ol', name: 'Over Co', creditOn: true, creditLimit: 1000 })`);
run(`postToAccount({ id: 'ol', name: 'Over Co' }, 'opening', 1000)`);
assert.equal(run(`accountStatus(allCustomerRecords().find(c => c.id === 'ol'))[1]`), 'Near limit');
run(`postToAccount({ id: 'ol', name: 'Over Co' }, 'adjustment', 0.01, { note: 'Rounding' })`);
assert.equal(run(`accountStatus(allCustomerRecords().find(c => c.id === 'ol'))[1]`), 'Over limit');
assert.equal(run(`postToAccount({ id: 'ol', name: 'Over Co' }, 'adjustment', 5)`), null, 'an adjustment says why');

// Bug 2: a till sale never writes the customer list back, so a back-office edit made since
// (here: the limit lowered) survives the next account sale and payment.
run(`saveCustomer({ ...allCustomerRecords().find(c => c.id === 'c-002'), creditLimit: 9000 })`);
const listText = run(`storageGet(STORAGE_CUSTOMERS, '')`);
till.ring({ items: [['c001', 1]], method: 'credit', customer: 'c-002' });
till.payCredit('c-002', 50);
assert.equal(run(`storageGet(STORAGE_CUSTOMERS, '')`), listText, 'the till wrote no customer record');

// Bug 8 + 3: a return of an account sale is a reversal row on the paid side, never a payment
// and never a second charge.
run(`saveCustomer({ id: 'rv', name: 'Return Co', creditOn: true, creditLimit: 50000 })`);
const s1 = till.ring({ items: [['c001', 2]], method: 'credit', customer: 'Return Co' });
till.refund(s1.number);
assert.deepEqual(rows('rv').map(r => [run('kindOf')(r), r.amount]), [['charge', s1.total], ['reversal', s1.total]]);
assert.equal(acct('rv').currentBalance, 0);
// Bug 1: the same sale cannot be reversed twice.
assert.equal(run(`voidOrder(${JSON.stringify(s1.id)}, 'again')`), null);
assert.equal(rows('rv').length, 2);

// Bug 4: paid in full, then refunded: the store owes them -- below zero, not floored at 0.
const s2 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Return Co' });
till.payCredit('Return Co', s2.total);
till.refund(s2.number);
assert.equal(acct('rv').currentBalance, 0, 'paid then refunded on account: what was paid comes back in cash');
run(`postToAccount({ id: 'rv', name: 'Return Co' }, 'payment', 300)`);
assert.equal(acct('rv').currentBalance, -300, 'an overpayment is money held for them');

// Bug 10: exchanging an account sale books the new sale on account, not as cash -- up to what
// came off the account; anything above it is paid in cash.
run(`saveCustomer({ id: 'ex', name: 'Swap Co', creditOn: true, creditLimit: 50000 })`);
const s3 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Swap Co' });
const drawer0 = run('buildCashDrawerSummary()').expectedCash;
const swap = till.exchange(s3.number, [['c002', 1]]).exchangeSale;
const onAcct = Math.min(s3.total, swap.total);
assert.equal(swap.payments.filter(p => p.method === 'credit').reduce((a, p) => a + p.amount, 0), onAcct, 'the replacement is on account');
assert.equal(run('buildCashDrawerSummary()').expectedCash, r2(drawer0 + swap.total - onAcct), 'the drawer expects only what is above it');
assert.equal(acct('ex').currentBalance, r2(onAcct), 'the account owes its part of the replacement');

// Bug 9: a cash payment at the till is in the drawer, with its method, register and staff.
const d0 = run('buildCashDrawerSummary()').expectedCash;
const pay = till.payCredit('Ricardo Construction', 1000, 'Cash payment');
assert.deepEqual([pay.type, pay.method, !!pay.register], ['payment', 'cash', true]);
assert.equal(run('buildCashDrawerSummary()').expectedCash, r2(d0 + 1000));
// Undone: a reversal row names it, the account owes it again and the drawer drops it.
const undo = run(`undoPayment(loadCustomerLedger().find(r => r.id === ${JSON.stringify(pay.id)}))`);
assert.deepEqual([undo.type, undo.reverses], ['reversal', pay.id]);
assert.equal(run(`undoPayment(loadCustomerLedger().find(r => r.id === ${JSON.stringify(pay.id)}))`), null, 'once');
assert.equal(acct('c-001').currentBalance, 8450);
assert.equal(run(`accountDebts(loadCustomerLedger().filter(r => r.customerId === 'c-001'))`)[0].status, 'Unpaid', 'an undone payment pays nothing');
assert.equal(run('buildCashDrawerSummary()').expectedCash, d0);

// 3.3 Record payment, four ways, each one ledger row. Three sales on one account, oldest first.
run(`saveCustomer({ id: 'pw', name: 'Pay Co', creditOn: true, creditLimit: 50000 })`);
const [a, b, c] = [1, 2, 3].map((q, i) => { till.clock(new Date(2026, 9, 2, 9 + i).getTime());
  return till.ring({ items: [['c001', q]], method: 'credit', customer: 'Pay Co' }); });
const debts = () => run(`accountDebts(loadCustomerLedger().filter(r => r.customerId === 'pw'))`).map(d => [d.left, d.status]);
const pw = () => acct('pw');
const paid = (amount, orderIds = []) => run(`recordPayment(allCustomerRecords().find(c => c.id === 'pw'), ${amount}, { method: 'gcash', orderIds: ${JSON.stringify(orderIds)} })`);
// Part of one order: the newest, 100 off it.
const p1 = paid(100, [c.id]);
assert.deepEqual(p1.allocations, [{ orderId: c.id, amount: 100 }]);
assert.deepEqual(debts(), [[a.total, 'Unpaid'], [b.total, 'Unpaid'], [r2(c.total - 100), 'Part paid']]);
// Chosen orders in full: the middle one.
paid(b.total, [b.id]);
assert.deepEqual(debts().map(d => d[1]), ['Unpaid', 'Paid', 'Part paid']);
// Any amount: nothing ticked pays the oldest first.
paid(a.total + 50);
assert.deepEqual(debts(), [[0, 'Paid'], [0, 'Paid'], [r2(c.total - 150), 'Part paid']]);
// The full balance.
paid(pw().currentBalance);
assert.equal(pw().currentBalance, 0);
assert.ok(debts().every(d => d[1] === 'Paid'));
assert.equal(rows('pw').filter(r => r.type === 'payment').length, 4, 'one row each');
assert.ok(rows('pw').every(r => r.id && r.updatedAt && r.customerId === 'pw'), 'every row has an id and a time');
// A payment taken in the back office has no register: it is not in a till's drawer.
assert.ok(rows('pw').filter(r => r.type === 'payment').every(r => !r.register));

// Bug 13: a parked cart is not spend.
const sm = run('SalesMath.summarize')([{ id: 'h', status: 'saved', total: 999, items: [{ price: 999, qty: 1 }], ts: Date.now() }]);
assert.equal(sm.netSales, 0);

/* ---------- Review fixes (2026-10-02). Each case failed before its fix (scratchpad repro R-numbers). ---------- */
const drawer = () => run('buildCashDrawerSummary()').expectedCash;
const bal = (id) => acct(id).currentBalance;

// R1: a like-for-like exchange of a paid account sale moves neither the drawer nor the balance.
run(`saveCustomer({ id: 'x1', name: 'Swap Paid', creditOn: true, creditLimit: 50000 })`);
const e1 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Swap Paid' });
run(`recordPayment(allCustomerRecords().find(c => c.id === 'x1'), ${e1.total}, { method: 'gcash' })`);
let [dr, bl] = [drawer(), bal('x1')];
const ex1 = run(`exchangeOrder(${JSON.stringify(e1.id)}, [{ id: 'c001', qty: 1 }], 'Exchange', 'm-approver')`);
assert.deepEqual([drawer(), bal('x1')], [dr, bl], 'R1: paid account sale, same item');
// Built by buildOrderRecord like any sale: the same VAT split as ringing it fresh, and the approver.
assert.deepEqual([ex1.exchangeSale.vatableSales, ex1.exchangeSale.vatAmount, 'vatExempt' in ex1.exchangeSale],
  [e1.vatableSales, e1.vatAmount, true]);
assert.equal(ex1.exchangeSale.approvedBy, 'm-approver');
assert.equal(rows('x1').find(r => r.orderId === ex1.exchangeSale.id).approvedBy, 'm-approver', 'the charge names the approver');

// R1b: a split sale (cash + account) exchanged for the same goods: same drawer, same balance.
run(`saveCustomer({ id: 'x2', name: 'Swap Split', creditOn: true, creditLimit: 50000 })`);
const e2 = till.ring({ items: [['c001', 2]], method: 'split', customer: 'Swap Split', tendered: 100 });
[dr, bl] = [drawer(), bal('x2')];
till.exchange(e2.number, [['c001', 2]]);
assert.deepEqual([drawer(), bal('x2')], [dr, bl], 'R1b: split sale, same items');

// An account sale cannot be exchanged onto an account whose credit is now off; nothing is written.
run(`saveCustomer({ id: 'x3', name: 'Swap Off', creditOn: true, creditLimit: 50000 })`);
const e3 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Swap Off' });
run(`saveCustomer({ ...allCustomerRecords().find(c => c.id === 'x3'), creditOn: false })`);
const nOrders = till.orders().length;
assert.equal(till.exchange(e3.number, [['c001', 1]]), null);
assert.equal(till.orders().length, nOrders, 'no refund row either');
// Past the limit, a cashier's exchange waits for a manager's PIN (gate 'overLimit').
run(`saveCustomer({ id: 'x4', name: 'Swap Tight', creditOn: true, creditLimit: 50000 })`);
const e4 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Swap Tight' });
run(`saveCustomer({ ...allCustomerRecords().find(c => c.id === 'x4'), creditLimit: 1 }); state.role = 'cashier'`);
assert.equal(till.exchange(e4.number, [['c001', 3]]), null);
assert.equal(run('pinAsk && pinAsk.action'), 'overLimit');
run(`pinAsk = null; state.role = 'manager'`);

// R3: two tills undoing one payment at once still undo it once.
run(`saveCustomer({ id: 'u2', name: 'Undo Twice', creditOn: true })`);
const e5 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Undo Twice' });
const p5 = run(`recordPayment(allCustomerRecords().find(c => c.id === 'u2'), 100, { method: 'cash' })`);
for (let i = 0; i < 2; i++) run(`postToAccount({ id: 'u2', name: 'Undo Twice' }, 'reversal', 100, { reverses: ${JSON.stringify(p5.id)}, note: 'Payment undone' })`);
assert.equal(bal('u2'), e5.total, 'R3: the balance');
assert.equal(run(`accountDebts(accountRows('u2'))`).reduce((a, d) => a + d.left, 0), e5.total, 'R3: the debts agree');

// R4: once migrated, a stale tab writing back an old record shape adds no second opening.
run(`saveCustomer({ id: 'st', name: 'Stale Co', creditOn: true })`);
const e6 = till.ring({ items: [['c001', 3]], method: 'credit', customer: 'Stale Co' });
run(`recordPayment(allCustomerRecords().find(c => c.id === 'st'), ${e6.total}, { method: 'cash' })`);
run(`saveList(STORAGE_CUSTOMERS, loadList(STORAGE_CUSTOMERS).map(c => c.id === 'st' ? { id: 'st', name: 'Stale Co', currentBalance: ${e6.total} } : c))`);
run('migrateCustomers()');
assert.equal(bal('st'), 0, 'R4: no phantom opening');
// While the sales database is still opening the migration waits; after it, it runs once, and
// the opening is dated when the record was made.
run(`localStorage.removeItem(STORAGE_CUSTOMERS_MIGRATED); globalThis.HWPOS_STORE = { pending: () => true };
     saveList(STORAGE_CUSTOMERS, loadList(STORAGE_CUSTOMERS).concat({ id: 'lg', name: 'Legacy', currentBalance: 500, createdAt: '2026-01-05T00:00:00Z' }))`);
run('migrateCustomers()');
assert.equal(rows('lg').length, 0, 'not against a ledger still loading');
run('delete globalThis.HWPOS_STORE; migrateCustomers()');
assert.deepEqual(rows('lg').map(r => [r.type, r.amount, r.ts]), [['opening', 500, Date.parse('2026-01-05T00:00:00Z') - 1]]);

// R16: a refund whose charge row has not synced to this till takes it off the account, not the drawer.
run(`saveCustomer({ id: 'ms', name: 'Missing Co', creditOn: true })`);
const e7 = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Missing Co' });
run(`saveList(STORAGE_CUSTOMER_LEDGER, loadList(STORAGE_CUSTOMER_LEDGER).filter(r => r.orderId !== ${JSON.stringify(e7.id)}))`);
dr = drawer();
const rf7 = till.refund(e7.number);
assert.equal(drawer(), dr, 'R16: nothing out of the drawer');
assert.ok(rf7.payments.every(p => p.method === 'credit'));
run(`postToAccount({ id: 'ms', name: 'Missing Co' }, 'charge', ${e7.total}, { orderId: ${JSON.stringify(e7.id)} })`);
assert.equal(bal('ms'), 0, 'R16: once the charge syncs, it nets to 0');

// R6: the over-limit check reads the customer fresh, not the copy picked onto the sale.
run(`saveCustomer({ id: 'lm', name: 'Limit Co', creditOn: true, creditLimit: 50000 })`);
run(`state.customer = allCustomerRecords().find(c => c.id === 'lm');
     saveCustomer({ ...allCustomerRecords().find(c => c.id === 'lm'), creditLimit: 100 });
     state.cart = [{ id: 'p', name: 'x', sku: 'x', price: 5000, qty: 1, unit: 'pc' }]; state.paymentMethod = 'credit';`);
assert.ok(run('creditOverLimit(0)') > 0, 'R6');
run('clearCart(); state.customer = null');

// R8: a cash payment taken at register 2 is not in register 1's drawer.
dr = drawer();
run(`postToAccount({ id: 'lm', name: 'Limit Co' }, 'payment', 700, { method: 'cash', register: '2' })`);
assert.equal(drawer(), dr, 'R8');

// R10: credit off carries no limit, so it is never Over limit.
assert.equal(run(`customerFromForm({ name: 'A', creditOn: '', creditLimit: '500' })`).customer.creditLimit, null);
assert.equal(run(`accountStatus({ ...normalizeCustomer({ name: 'A', creditOn: false, creditLimit: 500 }), currentBalance: 600 })`)[1], 'Active');

// Turning credit on at the till is a manager's call (TILL_ACTIONS.credit): a cashier gets the PIN pad.
run(`globalThis.__cf = customerFromForm;
     customerFromForm = () => ({ customer: normalizeCustomer({ name: 'Gate Co', creditOn: true, creditLimit: 500 }) });
     state.role = 'cashier'; saveSavedCustomerFromModal();`);
assert.equal(run(`allCustomerRecords().some(c => c.name === 'Gate Co')`), false, 'a cashier cannot');
assert.equal(run('pinAsk && pinAsk.action'), 'credit');
run(`pinAsk.again('m-approver'); pinAsk = null; state.role = 'manager'; customerFromForm = __cf;`);
assert.equal(run(`allCustomerRecords().some(c => c.name === 'Gate Co')`), true, 'after a PIN');
assert.deepEqual([run(`roleCan('manager', 'credit')`), run(`roleCan('cashier', 'credit')`)], [true, false]);

// Number map #14: the statement nets a voided account sale on the Charged side, never in Paid.
run(`saveCustomer({ id: 'vd', name: 'Void Co', creditOn: true, creditLimit: 50000 })`);
const sv = till.ring({ items: [['c001', 1]], method: 'credit', customer: 'Void Co' });
assert.ok(run(`voidOrder(${JSON.stringify(sv.id)}, 'Void')`), 'voided');
const stv = Object.fromEntries(run(`accountStatement(accountRows('vd'))`).map(x => [x.kind, [x.charged, x.paid]]));
assert.deepEqual(stv, { charge: [sv.total, 0], reversal: [-sv.total, 0] });

console.log('customer-ledger-check: ok');
