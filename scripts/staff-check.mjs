// Smallest check that fails if the Staff page's PIN rule breaks. Staff sales are Sales › By staff
// (summarize grouped by SalesMath.sellerOf), checked in sales-math-check.
// Run: node scripts/staff-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.isPin = require('../bo-model.js').isPin;
const { pinClash } = require('../bo-staff.js');

// One PIN, one person (C2): judged on the record they will have, active or not.
const team = [{ id: 'a', pin: '1234', active: true }, { id: 'b', pin: '1234', active: false }, { id: 'c', pin: '5555', active: true }];
assert.equal(pinClash(team, 1, { ...team[1], active: true }), true, 'restoring someone whose PIN was taken since');
assert.equal(pinClash(team, 2, { ...team[2], pin: '1234' }), true, 'taking a PIN someone active has');
assert.equal(pinClash(team, 2, { ...team[2] }), false, 'keeping your own PIN');
assert.equal(pinClash(team, 0, { ...team[0], active: false }), false, 'archiving frees it');
assert.equal(pinClash(team, -1, { pin: '1234', active: false }), false, 'an archived person may share it');

console.log('staff-check: ok');
