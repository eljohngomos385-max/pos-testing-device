/* The till sold 2 metres of the 2.5 a customer asked for, because every quantity input
   parsed with parseInt. This is the smallest thing that fails if that comes back.
   node scripts/qty-check.mjs                                                        */
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { roundQty, stepFor } from '../bo-model.js';
import { POS_SCRIPTS } from './lib/till.mjs';

// Every till script, each line tagged with its file:line for the messages below.
const tagged = POS_SCRIPTS.flatMap((f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
  .split(/\r?\n/).map((l, i) => [`${f}:${i + 1}`, l]));
const app = tagged.map(([, l]) => l).join('\n');
const data = readFileSync(new URL('../data.js', import.meta.url), 'utf8');

// The real qtyFrom, lifted out of the till's scripts so this file cannot drift from the app.
const src = app.match(/function qtyFrom\(product, value, fallback = 1\) \{[\s\S]*?\n\}/)[0];
const qtyFrom = new Function('roundQty', `${src}; return qtyFrom;`)(roundQty);

const wire = { id: 'e001', soldBy: 'measure' };
const bag = { id: 'c001', soldBy: 'each' };

assert.equal(qtyFrom(wire, '2.5'), 2.5, 'the whole bug: 2.5 m must stay 2.5 m');
assert.equal(qtyFrom(wire, '0.75'), 0.75);
assert.equal(qtyFrom(wire, '2.516'), 2.52, 'hundredths, because stock is a sum');
assert.equal(qtyFrom(bag, '2.5'), 3, 'you cannot buy half a bag of cement');
assert.equal(qtyFrom(wire, ''), 1, 'an empty field is one, not NaN');
assert.equal(qtyFrom(wire, '-4'), 1, 'a negative quantity is not a refund');
assert.equal(qtyFrom(wire, '0', stepFor(wire)), 0.01, 'the stepper floors at one step');

// No quantity may be read with parseInt again -- that is the bug, not a style preference.
const bad = tagged.filter(([, l]) => /parseInt/.test(l) && /qty|Qty/i.test(l));
assert.equal(bad.length, 0, 'parseInt on a quantity at ' + bad.map(([n]) => n).join(','));

// Wire, nails and sand are cut, weighed and shovelled. If data.js forgets, stepFor lies.
for (const id of ['e001', 'e002', 'f001', 'f002', 'c002', 'c003']) {
  const row = data.match(new RegExp(`\\{ id: '${id}',[\\s\\S]*?\\n`))[0];
  assert.ok(/soldBy: 'measure'/.test(row), `${id} is sold by measure and data.js does not say so`);
}
// ...and a 1L can of paint is still one can.
assert.ok(!/soldBy: 'measure'/.test(data.match(/\{ id: 'pt001',[\s\S]*?\n/)[0]));

// Stock may only move through the log. A bare `product.stock = ...` on the till is how the
// movement history silently stopped containing the sales that caused it.
const writes = tagged.filter(([, l]) => /(?<!ROLE_ALLOWED)\.stock\s*=[^=]/.test(l));   // ROLE_ALLOWED.stock is the stock-clerk role
assert.equal(writes.length, 0, 'stock assigned outside moveStock at ' + writes.map(([n]) => n).join(','));
assert.ok(/moveStock\(order\.items, \{ reason: 'sale', refId: order\.id \}\)/.test(app),
  'completeSale must write the movement that explains the sale');

console.log('qty: ok');
