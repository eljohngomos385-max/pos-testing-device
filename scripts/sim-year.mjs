/* A full trading year against the real money model.
   ----------------------------------------------------------------------------
   The unit checks prove one sum at a time. This proves the sums still hold after
   365 days of deliveries, sales, returns, counts and price changes -- which is
   where float drift, a lost centavo or a stock cache that stopped matching its
   log actually show up.

   Everything money is verified TWICE: once through bo-model.js (the code that
   ships) and once through an independent integer-centavo accumulator kept here.
   If those two ever disagree, the shipping code is wrong -- that is the whole
   design of this file.

   node scripts/sim-year.mjs                                                  */
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../bo-model.js');

const {
  cent, unc, round2, priceFromMargin, marginFromPrice, marginSummary,
  normalizeProduct, productToCsvRow, productFromCsvRow, PRODUCT_COLUMNS,
  makeMovement, applyMovement, isLow, stockValue, roundQty, stepFor,
  PO_DEFAULTS, poLine, poTotal, poOutstanding, receivePo,
} = M;

/* ---------- Deterministic randomness ----------
   Seeded so a failure reproduces exactly. A sim you cannot re-run is an anecdote. */
let seed = 20260908;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/* ---------- The catalog ----------
   Deliberately awkward costs. 0.10 at 25% is 12.5 centavos, which no till can
   pay -- the model has to land on a real price and stay there. */
const COSTS = [100, 0.1, 19.2, 1234.56, 85.5, 7.35, 999.99, 0.05, 250, 12.5];
const CATS = ['fasteners', 'plumbing', 'paint', 'electrical', 'cement'];

const products = [];
for (let i = 0; i < 40; i++) {
  const cost = COSTS[i % COSTS.length];
  const percent = i % 2 === 0;
  const marginValue = percent ? pick([10, 15, 20, 25, 33.5]) : pick([5, 12.5, 45, 100]);
  const p = normalizeProduct({
    id: 'p' + i,
    sku: 'SKU-' + String(i).padStart(3, '0'),
    name: 'Item ' + i,
    folder: CATS[i % CATS.length],
    soldBy: i % 5 === 0 ? 'measure' : 'each',
    unit: i % 5 === 0 ? 'm' : 'pc',
    cost,
    marginMode: percent ? 'percent' : 'flat',
    marginValue,
    price: priceFromMargin(cost, percent ? 'percent' : 'flat', marginValue),
    stock: 0,
    reorderPoint: between(5, 30),
  });
  products.push(p);
}
const byId = new Map(products.map((p) => [p.id, p]));

/* ---------- The independent books, in integer centavos ----------
   Never touches bo-model. This is the second opinion. */
const book = new Map(products.map((p) => [p.id, { qty: 0, revenue: 0, cogs: 0, sold: 0 }]));
let movements = [];
const log = (mv) => { movements.push(mv); applyMovement(byId.get(mv.productId), mv); };

/* The one named case from the brief, tracked separately end to end:
   cost 100, percent mode, 25% -> price 125, profit 25 a unit, all year. */
const NAMED = normalizeProduct({
  id: 'named', sku: 'NAMED', name: 'Boysen Paint Red', folder: 'paint',
  cost: 100, marginMode: 'percent', marginValue: 25,
  price: priceFromMargin(100, 'percent', 25), stock: 0, reorderPoint: 10,
});
assert.equal(NAMED.price, 125, 'cost 100 at 25% must price at 125');
products.push(NAMED); byId.set(NAMED.id, NAMED);
book.set(NAMED.id, { qty: 0, revenue: 0, cogs: 0, sold: 0 });
let namedUnits = 0;

/* ---------- 365 days ---------- */
const DAY = 864e5;
const start = Date.parse('2026-01-01T08:00:00.000Z');
let posReceived = 0;
let salesCount = 0;

for (let day = 0; day < 365; day++) {
  const ts = new Date(start + day * DAY).toISOString();

  // --- Deliveries: a purchase order arrives most weeks, received through the
  // real receivePo() so the sim exercises the same path Suppliers will.
  if (day % 7 === 3) {
    const lines = [];
    for (let k = 0; k < 4; k++) {
      const p = pick(products);
      lines.push(poLine(p.id, between(20, 120), p.cost));
    }
    const po = Object.assign({}, PO_DEFAULTS, {
      id: 'po' + day, number: 'PO-' + day, status: 'ordered', items: lines,
    });
    const wanted = {};
    lines.forEach((l) => { wanted[l.id] = l.qty; });
    const mvs = receivePo(po, wanted);
    assert.equal(po.status, 'received', 'a fully received PO is received');
    assert.equal(poOutstanding(po), 0, 'nothing outstanding after a full receive');
    mvs.forEach((mv) => {
      mv.ts = ts;
      log(mv);
      const b = book.get(mv.productId);
      b.qty += mv.qty;
      b.cogs += 0; // buying is not a cost of goods SOLD; it moves value, not profit
    });
    posReceived++;
  }

  // --- Sales
  const nSales = between(4, 14);
  for (let s = 0; s < nSales; s++) {
    const p = pick(products);
    const b = book.get(p.id);
    const want = roundQty(p, p.soldBy === 'measure' ? between(1, 8) + 0.5 : between(1, 6));
    if (!p.sellOutOfStock && b.qty < want) continue;   // nothing to sell

    const mv = makeMovement({
      productId: p.id, qty: -want, reason: 'sale', refId: 'o' + day + '-' + s,
      unitCost: p.cost, note: '',
    });
    mv.ts = ts;
    log(mv);
    b.qty -= want;
    b.sold += want;
    // Integer centavos, multiplied not accumulated -- the whole point of the check.
    b.revenue += Math.round(cent(p.price) * want);
    b.cogs += Math.round(cent(p.cost) * want);
    salesCount++;
    if (p.id === 'named') namedUnits += want;
  }

  // --- Returns: a few a month, and they must restock
  if (day % 11 === 0) {
    const p = pick(products);
    const b = book.get(p.id);
    if (b.sold > 2) {
      const qty = roundQty(p, 1);
      const mv = makeMovement({ productId: p.id, qty, reason: 'return', refId: 'r' + day, unitCost: p.cost });
      mv.ts = ts;
      log(mv);
      b.qty += qty;
      b.sold -= qty;
      b.revenue -= Math.round(cent(p.price) * qty);
      b.cogs -= Math.round(cent(p.cost) * qty);
      if (p.id === 'named') namedUnits -= qty;
    }
  }

  // --- Physical count: the delta is what gets written, never the answer
  if (day % 30 === 17) {
    const p = pick(products);
    const b = book.get(p.id);
    const counted = roundQty(p, Math.max(0, b.qty - between(0, 3)));
    const delta = round2(counted - b.qty);
    if (delta !== 0) {
      const mv = makeMovement({ productId: p.id, qty: delta, reason: 'count', note: 'Year sim count' });
      mv.ts = ts;
      log(mv);
      b.qty = counted;
    }
  }

  // --- A supplier raises a price. Margin is what recomputes the price.
  if (day % 45 === 20) {
    const p = pick(products);
    if (p.id === 'named') continue;   // the brief's example stays at cost 100 all year
    const newCost = round2(p.cost * 1.07);
    const before = marginFromPrice(p.cost, p.price, p.marginMode);
    p.cost = newCost;
    p.price = priceFromMargin(newCost, p.marginMode, p.marginValue);
    assert.ok(p.price >= newCost || p.marginValue < 0, 'a raised cost must not price below cost');
    void before;
  }
}

/* ---------- Verification ---------- */
const fail = [];
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { fail.push(name); console.log('  FAIL ' + name + '\n       ' + e.message); } };

check('the stock cache equals the sum of its movement log, for every product', () => {
  const summed = new Map();
  for (const mv of movements) summed.set(mv.productId, round2((summed.get(mv.productId) || 0) + mv.qty));
  for (const p of products) {
    const fromLog = summed.get(p.id) || 0;
    assert.equal(p.stock, fromLog, p.id + ': cache ' + p.stock + ' vs log ' + fromLog);
    assert.equal(p.stock, book.get(p.id).qty, p.id + ': cache vs independent books');
  }
});

check('no product ended on a fractional centavo or a fractional unit it cannot sell', () => {
  for (const p of products) {
    assert.equal(cent(p.price), Math.round(cent(p.price)), p.id + ' price is not whole centavos');
    assert.equal(cent(p.cost), Math.round(cent(p.cost)), p.id + ' cost is not whole centavos');
    if (p.soldBy === 'each') {
      assert.equal(p.stock, Math.round(p.stock), p.id + ' sells each but holds ' + p.stock);
    }
  }
});

check('price survives a full margin round trip for every product', () => {
  for (const p of products) {
    const back = priceFromMargin(p.cost, p.marginMode, marginFromPrice(p.cost, p.price, p.marginMode));
    assert.equal(back, p.price, p.id + ': ' + back + ' != ' + p.price);
  }
});

check('percent means markup on cost, and margin-on-price is reported alongside it', () => {
  const s = marginSummary(100, 125);
  assert.equal(s.profit, 25);
  assert.equal(s.markup, 25);    // what the owner typed off the invoice
  assert.equal(s.margin, 20);    // what the books will say
  // and flat mode is a straight addition
  assert.equal(priceFromMargin(100, 'flat', 45), 145);
  assert.equal(marginFromPrice(100, 145, 'flat'), 45);
});

check('a year of the named case rolls up to exactly units x 25, no drift', () => {
  const b = book.get('named');
  assert.ok(namedUnits > 0, 'the named product never sold; the sim proved nothing');
  const profit = b.revenue - b.cogs;
  assert.equal(profit, Math.round(namedUnits * 2500), 'profit ' + profit + ' vs ' + namedUnits * 2500);
  assert.equal(unc(profit), round2(namedUnits * 25));
});

check('percent margin stays exact through a supplier price rise', () => {
  // The real invariant behind "cost 100, 25% -> 125": profit is always that
  // percentage of cost, whatever the cost became. A rounding bug shows here first.
  for (const p of products) {
    if (p.marginMode !== 'percent') continue;
    const s = marginSummary(p.cost, p.price);
    assert.equal(cent(s.profit), Math.round(cent(p.cost) * p.marginValue / 100),
      p.id + ' at cost ' + p.cost + ' / ' + p.marginValue + '%: profit ' + s.profit);
    // The markup read BACK off the price is not always the number that was typed:
    // 19.20 at 33.5% is 25.632, and no till pays a third of a centavo, so the price
    // is 25.63 and reads back as 33.49%. That is why price is the authoritative
    // field and margin only recomputes it -- the guarantee is stability, not that
    // an unrepresentable percentage survives a round trip.
    assert.equal(priceFromMargin(p.cost, 'percent', s.markup), p.price,
      p.id + ' price moved when its own margin was fed back in');
  }
});

check('gross profit computed per line equals revenue minus COGS in total', () => {
  let revenue = 0, cogs = 0;
  for (const b of book.values()) { revenue += b.revenue; cogs += b.cogs; }
  assert.equal(Number.isInteger(revenue), true, 'revenue left integer centavos');
  assert.equal(Number.isInteger(cogs), true, 'cogs left integer centavos');
  const perProduct = [...book.values()].reduce((n, b) => n + (b.revenue - b.cogs), 0);
  assert.equal(perProduct, revenue - cogs);
  assert.ok(revenue > 0 && cogs > 0 && revenue > cogs, 'a year that made no money is not a test');
});

check('stock value at cost matches the books', () => {
  for (const p of products) {
    assert.equal(cent(stockValue(p)), Math.round(cent(p.cost) * p.stock), p.id + ' stock value');
  }
});

check('the low-stock list is a query, never a flag', () => {
  const low = products.filter(isLow).map((p) => p.id).sort();
  const expect = products.filter((p) => p.stock <= p.reorderPoint).map((p) => p.id).sort();
  assert.deepEqual(low, expect);
});

check('every movement carries a reason, and sales are the only ones that are negative by rule', () => {
  const reasons = new Set(movements.map((m) => m.reason));
  for (const mv of movements) {
    assert.ok(mv.reason, 'a movement with no reason cannot answer "why does this say 12?"');
    assert.ok(mv.id && mv.ts, 'a movement needs an id and a timestamp to be replayable');
    if (mv.reason === 'sale') assert.ok(mv.qty < 0, 'a sale that adds stock is a bug');
    if (mv.reason === 'delivery') assert.ok(mv.qty > 0, 'a delivery that removes stock is a bug');
  }
  assert.ok(reasons.has('sale') && reasons.has('delivery') && reasons.has('return') && reasons.has('count'),
    'the year did not exercise every reason: ' + [...reasons].join(','));
});

check('the whole catalog survives a CSV round trip after a year of trading', () => {
  const heads = PRODUCT_COLUMNS.map((c) => c.head);
  for (const p of products) {
    const { product: parsed, errors } = productFromCsvRow(productToCsvRow(p), heads);
    const product = normalizeProduct(parsed);
    assert.deepEqual(errors, [], p.id + ': ' + errors.join('; '));
    for (const c of PRODUCT_COLUMNS) {
      assert.deepEqual(product[c.key], p[c.key], p.id + ' lost ' + c.key + ': ' + product[c.key] + ' != ' + p[c.key]);
    }
  }
});

check('a partly received PO stays partial and its outstanding is never negative', () => {
  const lines = [poLine('p1', 10, 50), poLine('p2', 4, 20)];
  const po = Object.assign({}, PO_DEFAULTS, { id: 'poX', status: 'ordered', items: lines });
  assert.equal(poTotal(po), 580);
  const first = receivePo(po, { [lines[0].id]: 6 });
  assert.equal(po.status, 'partial');
  assert.equal(poOutstanding(po), 8);
  assert.equal(first.length, 1);
  assert.equal(first[0].reason, 'delivery');
  assert.equal(first[0].unitCost, 50);
  receivePo(po, { [lines[0].id]: 99, [lines[1].id]: 4 });   // supplier over-ships
  assert.equal(po.status, 'received');
  assert.equal(poOutstanding(po), 0, 'outstanding must floor at zero, not go negative');
});

console.log('\n' + salesCount + ' sales, ' + posReceived + ' deliveries, ' + movements.length + ' movements over 365 days');
console.log(fail.length ? fail.length + ' FAILED' : 'sim-year: all good');
process.exit(fail.length ? 1 : 0);
