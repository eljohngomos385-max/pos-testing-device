// Smallest check that fails if the per-person sales rollup on the Staff page breaks.
// Run: node scripts/staff-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { salesByName } = require('../bo-staff.js');

const NOW = Date.UTC(2026, 8, 24, 4);
const ago = (d) => NOW - d * 864e5;
const by = salesByName([
  { cashier: 'Joy P.', status: 'completed', total: 500, ts: ago(1) },
  { cashier: 'Joy P.', status: 'completed', total: 250.5, ts: ago(3) },
  { cashier: 'Joy P.', status: 'voided', total: 900, ts: ago(0.5) },      // not money, not the last sale
  { cashier: 'Joy P.', status: 'refunded', total: 100, ts: ago(2) },
  { cashier: 'Joy P.', status: 'return', total: -40, ts: ago(2) },
  { cashier: 'Joy P.', status: 'completed', total: 9999, ts: ago(31) },   // outside 30 days
  { cashier: 'Aldrin S.', status: 'saved', total: 70, ts: ago(1) },        // a parked cart is not a sale
], NOW);

assert.deepEqual(by.get('Joy P.'), { revenue: 750.5, sales: 2, voids: 1, refunds: 2, last: ago(1) });
assert.deepEqual(by.get('Aldrin S.'), { revenue: 0, sales: 0, voids: 0, refunds: 0, last: 0 });
assert.equal(salesByName([], NOW).size, 0);
assert.equal(salesByName(null, NOW).size, 0);

console.log('staff-check: ok');
