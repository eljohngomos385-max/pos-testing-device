/* node scripts/products-check.mjs
   The two things on the Products page that are maths, not wiring:
   the CSV round trip, and the cost/margin/price three-way binding. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../bo-model.js');
const {
  PRODUCT_COLUMNS, productToCsvRow, productFromCsvRow, normalizeProduct,
  priceFromMargin, marginFromPrice, marginSummary, supplierIdsOf,
} = model;

// bo-products.js is a browser IIFE: give it just enough of a page to load.
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, querySelector: () => null };
Object.assign(globalThis, model);
const { planImport } = require('../bo-products.js');

/* ---------- 1. CSV round trip: export then import loses nothing ---------- */
const heads = PRODUCT_COLUMNS.map((c) => c.head);
const source = normalizeProduct({
  id: 'p_rt', sku: 'SKU-1', barcode: '4800001', name: 'Boysen Paint Red',
  title: 'Boysen Red', brand: 'Boysen', folder: 'cat_paint', unit: 'L',
  soldBy: 'measure', cost: 100, price: 125, marginMode: 'percent', marginValue: 25,
  stock: 12, reorderPoint: 3, sellOutOfStock: true, supplierId: 'sup_1',
  groupId: 'grp_boysen', imageUrl: 'https://x.test/a.png',
  weight: '4 kg', size: '4L', length: '', aliases: ['pintura', 'red paint'],
  altSupplierIds: ['sup_2', 'sup_3'],
});
const back = productFromCsvRow(productToCsvRow(source), heads);
assert.deepEqual(back.errors, [], 'a row we exported must re-import cleanly');
for (const c of PRODUCT_COLUMNS) {
  const was = source[c.key];
  if (was === '' || was === false || (Array.isArray(was) && !was.length)) continue; // empty is not written
  assert.deepEqual(back.product[c.key], was, `${c.head} survived the round trip`);
}

/* ---------- 2. Cost / margin / price: any two drive the third ---------- */
assert.equal(priceFromMargin(100, 'percent', 25), 125);          // the stated case
assert.equal(marginFromPrice(100, 125, 'percent'), 25);          // ...and back again
assert.equal(priceFromMargin(100, 'flat', 25), 125);
assert.equal(marginFromPrice(100, 125, 'flat'), 25);
assert.equal(priceFromMargin(0, 'percent', 25), 0);              // no cost, no markup
assert.equal(marginFromPrice(0, 125, 'percent'), 0);             // never divides by zero
const s = marginSummary(100, 125);
assert.deepEqual([s.profit, s.markup, s.margin], [25, 25, 20]);  // both readings, always
// Editing cost with the margin held recomputes price, which recomputes the same margin.
const repriced = priceFromMargin(200, 'percent', 25);
assert.equal(repriced, 250);
assert.equal(marginFromPrice(200, repriced, 'percent'), 25);

/* ---------- 3. Import matching: SKU, then barcode, then name ---------- */
const existing = [
  normalizeProduct({ id: 'p1', sku: 'A-1', barcode: '111', name: 'Hammer' }),
  normalizeProduct({ id: 'p2', sku: 'B-2', barcode: '222', name: 'Chisel' }),
  normalizeProduct({ id: 'p3', sku: '', barcode: '', name: 'Trowel' }),
];
const folders = [{ id: 'all', name: 'All Items' }, { id: 'cat_tools', name: 'Tools' }];
const rows = [
  ['sku', 'barcode', 'name', 'category', 'cost', 'price', 'stock'],
  ['A-1', '999', 'Renamed Hammer', 'Tools', '50', '65', '4'],   // by sku, ignores name/barcode
  ['', '222', 'Also Renamed', 'cat_tools', '10', '12', '0'],    // by barcode
  ['', '', 'Trowel', 'Tools', '30', '40', '2'],                 // by name
  ['C-9', '333', 'Pipe Wrench', 'Plumbing', '80', '99', '6'],   // new, new category
  ['D-1', '', 'Bad Cost', 'Tools', 'nope', '10', '0'],          // rejected, not coerced
  ['E-1', '', '', 'Tools', '1', '2', '0'],                      // rejected, no name
  ['', '', '', '', '', '', ''],                                 // blank line, skipped
];
const plan = planImport(rows, existing, folders);
assert.deepEqual(plan.update.map((u) => u.match.id), ['p1', 'p2', 'p3']);
assert.deepEqual(plan.create.map((c) => c.product.name), ['Pipe Wrench']);
assert.equal(plan.failed.length, 2);
assert.deepEqual(plan.failed.map((f) => f.line), [6, 7]);
assert.match(plan.failed[0].errors[0], /cost/);
// A category the file names but we do not have is created, once, and by name or by id.
assert.deepEqual(plan.folders, [{ id: 'cat_plumbing', name: 'Plumbing', builtin: false }]);
assert.equal(plan.create[0].product.folder, 'cat_plumbing');
assert.equal(plan.update[0].product.folder, 'cat_tools');   // matched by name
assert.equal(plan.update[1].product.folder, 'cat_tools');   // matched by id

/* ---------- 3b. Stock with no cost is refused, not imported at cost 0 ---------- */
const rows2 = [
  ['sku', 'name', 'cost', 'price', 'stock'],
  ['F-1', 'No cost, has stock', '', '10', '5'],
  ['F-2', 'Zero cost, has stock', '0', '10', '5'],
  ['F-3', 'No cost, no stock', '', '10', '0'],
];
const plan2 = planImport(rows2, [], folders);
assert.deepEqual(plan2.create.map((c) => c.product.name), ['No cost, no stock']);
assert.equal(plan2.failed.length, 2);
// An existing product keeps Inventory's stock, so the file's stock is ignored and the row updates.
const plan2b = planImport(rows2.slice(0, 2), [normalizeProduct({ id: 'pf', sku: 'F-1', name: 'Had cost' })], folders);
assert.deepEqual([plan2b.update.length, plan2b.failed.length], [1, 0]);
assert.ok(plan2.failed.every((f) => /cost 0|needs a cost/.test(f.errors.join(';'))));

/* ---------- 3c. "in_store_since" column carries as the opening movement's happenedOn ---------- */
const rows3 = [
  ['name', 'cost', 'price', 'stock', 'in_store_since'],
  ['Backdated', '10', '15', '5', '2026-08-01'],
  ['Garbage date ignored', '10', '15', '5', 'not-a-date'],
];
const plan3 = planImport(rows3, [], folders);
assert.equal(plan3.create[0].product.openingSince, '2026-08-01');
assert.equal('openingSince' in plan3.create[1].product, false);

/* ---------- 4. One product, several suppliers ---------- */
// The primary leads, the backups follow, and the primary never repeats itself.
assert.deepEqual(supplierIdsOf(source), ['sup_1', 'sup_2', 'sup_3']);
assert.deepEqual(supplierIdsOf(normalizeProduct({ supplierId: 'a', altSupplierIds: ['a', 'b', 'b'] })),
  ['a', 'b']);
// No supplier at all is still no supplier, not an empty string in the list.
assert.deepEqual(supplierIdsOf(normalizeProduct({})), []);
assert.deepEqual(supplierIdsOf(normalizeProduct({ altSupplierIds: ['b'] })), ['b']);
// Junk in storage does not become a supplier id.
assert.deepEqual(normalizeProduct({ altSupplierIds: 'sup_2' }).altSupplierIds, []);
// The backups survive the CSV round trip, so an export can be edited and re-imported.
assert.deepEqual(back.product.altSupplierIds, ['sup_2', 'sup_3']);

console.log('products-check: ok');
