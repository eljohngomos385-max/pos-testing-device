// Smallest check that fails if the staff pay maths breaks.
// Run: node scripts/staff-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// In the browser these are script globals; in Node bo-staff.js resolves them the same way.
Object.assign(globalThis, require('../bo-model.js'));
const S = require('../bo-staff.js');

const { dailyFromMonthly, monthlyCost, totalPayroll, attendanceTotals, payEstimate,
  unpaidDays, absenceCut, netPay } = S;

// --- monthly -> daily, at every working-days option the page offers ---
assert.equal(dailyFromMonthly(18000, 26), 692.31);   // the six-day PH week
assert.equal(dailyFromMonthly(18000, 22), 818.18);
assert.equal(dailyFromMonthly(18000, 30), 600);
assert.equal(dailyFromMonthly(13000, 26), 500);
assert.equal(dailyFromMonthly(0, 26), 0);
assert.equal(dailyFromMonthly(18000, 0), 692.31);    // missing days falls back to 26

// Always 2dp — a rate with a third decimal cannot be paid.
for (const days of S.WORK_DAY_OPTIONS) {
  for (const monthly of [18000, 13000, 9999.99, 7500.5, 1]) {
    const daily = dailyFromMonthly(monthly, days);
    assert.equal(daily, round2(daily), `${monthly}/${days} stays at 2dp`);
    // Multiplying back cannot drift further than the rounding of one day's rate.
    assert.ok(Math.abs(daily * days - monthly) <= days / 100, `${monthly}/${days} drift`);
  }
}

// --- the drift that matters: what payroll shows is what the owner typed ---
// 692.31 x 26 = 18,000.06, so a monthly salary must never be recomputed from the rate.
assert.equal(monthlyCost({ salary: 18000, salaryPerDay: 692.31, workDays: 26 }), 18000);
// Only a day-rate-only person gets multiplied up.
assert.equal(monthlyCost({ salary: 0, salaryPerDay: 700, workDays: 26 }), 18200);
assert.equal(monthlyCost({ salary: 0, salaryPerDay: 692.31 }), 18000.06);
assert.equal(monthlyCost({ salary: 0, salaryPerDay: 0 }), 0);
assert.equal(totalPayroll([
  { salary: 18000, salaryPerDay: 692.31 },
  { salary: 13000, salaryPerDay: 500 },
  { salary: 0, salaryPerDay: 700, workDays: 26 },
]), 49200);

// --- attendance -> days worked -> estimated pay ---
const t = attendanceTotals(['present', 'present', 'late', 'halfday', 'dayoff', 'absent', 'present']);
assert.equal(t.present, 3);
assert.equal(t.late, 1);
assert.equal(t.halfday, 1);
assert.equal(t.dayoff, 1);
assert.equal(t.absent, 1);
assert.equal(t.days, 4.5);                       // late is worked, half is 0.5, off/absent are 0
assert.equal(attendanceTotals([]).days, 0);
assert.equal(attendanceTotals(['nonsense', 'dayoff']).days, 0);   // junk is ignored, not counted
assert.equal(attendanceTotals(['dayoff', 'dayoff', 'absent']).days, 0);

assert.equal(payEstimate(t.days, 692.31), 3115.4);   // 4.5 x 692.31
assert.equal(payEstimate(0.5, 692.31), 346.16);      // one half day, rounded once
assert.equal(payEstimate(26, 692.31), 18000.06);
assert.equal(payEstimate(4.5, 0), 0);

// --- what is left on payday: salary, less days not worked, less cash already drawn ---
// A day off costs nothing, an absence costs a full day, a half day costs half of one.
assert.equal(unpaidDays(t), 1.5);                              // 1 absent + 1 half
assert.equal(unpaidDays(attendanceTotals(['dayoff', 'dayoff'])), 0);
assert.equal(unpaidDays(attendanceTotals(['present', 'late'])), 0);
assert.equal(unpaidDays(attendanceTotals([])), 0);

assert.equal(absenceCut(1.5, 500), 750);
assert.equal(absenceCut(0, 500), 0);
assert.equal(absenceCut(1, 692.31), 692.31);
assert.equal(absenceCut(0.5, 692.31), 346.16);                 // rounded once, at the end

// The worked example: 13,000/mo at 500/day, two days missed, 1,700 already drawn.
assert.equal(netPay(13000, absenceCut(2, 500), 1700), 10300);
assert.equal(netPay(13000, 0, 0), 13000);
// Drawing more than is left is not hidden - it carries as a negative.
assert.equal(netPay(2500, 0, 4000), -1500);
// Centavos survive the three-way subtraction.
assert.equal(netPay(18000, 346.16, 0.01), 17653.83);

// --- clock in / out -> hours worked ---
const at = (d, h, m = 0) => new Date(2026, 8, d, h, m).toISOString();   // local time, like the page
const ev = (staffId, event, ts) => ({ id: ts + staffId + event, ts, staff: '', staffId, event });
const now = new Date(2026, 8, 14, 15, 0).getTime();                       // 3pm on the 14th

// Two shifts, given out of order: 8-12 and 1-5:30 = 8.5h.
const split = [ev('u1', 'out', at(14, 17, 30)), ev('u1', 'in', at(14, 8)), ev('u1', 'out', at(14, 12)),
  ev('u1', 'in', at(14, 13)), ev('u2', 'in', at(14, 6)), ev('u1', 'in', at(13, 8))];
let h = S.hoursWorked(split, 'u1', '2026-09-14', now);
assert.equal(h.hours, 8.5);
assert.equal(h.shifts.length, 2);
assert.equal(h.open, false);
assert.equal(h.strayOuts, 0);

// Unmatched in, today: counts until now (9am -> 3pm = 6h) and stays open.
h = S.hoursWorked([ev('u1', 'in', at(14, 9))], 'u1', '2026-09-14', now);
assert.equal(h.hours, 6);
assert.equal(h.open, true);
assert.equal(h.shifts[0].out, null);

// Unmatched in on a past day: flagged open, only the closed shift counts.
h = S.hoursWorked([ev('u1', 'in', at(13, 8)), ev('u1', 'out', at(13, 10)), ev('u1', 'in', at(13, 11))],
  'u1', '2026-09-13', now);
assert.equal(h.hours, 2);
assert.equal(h.open, true);

// Out without an in pairs with nothing; a double-tapped in keeps the first.
h = S.hoursWorked([ev('u1', 'out', at(14, 7)), ev('u1', 'in', at(14, 8)), ev('u1', 'in', at(14, 8, 5)),
  ev('u1', 'out', at(14, 9, 15))], 'u1', '2026-09-14', now);
assert.equal(h.hours, 1.25);
assert.equal(h.strayOuts, 1);
assert.equal(h.open, false);

// Someone else's rows and nothing at all.
assert.equal(S.hoursWorked(split, 'u2', '2026-09-14', now).hours, 9);   // 6am in, open until 3pm today
assert.deepEqual(S.hoursWorked([], 'u1', '2026-09-14', now), { hours: 0, shifts: [], open: false, strayOuts: 0 });

console.log('staff: ok');
