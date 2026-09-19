// Replay a year of history against two ordering rules and see what each would have cost.
// Run: node scripts/backtest.mjs [dump.json] [--json]
//   dump.json: HWPOS_AI.snapshot() plus the back-office lists, or a localStorage dump with
//   hwpos.* keys. With no file, a deterministic synthetic year is generated so this always runs.
//
// Each simulated day, per product: arrivals land, that day's demand is served from the
// simulated shelf, and the rule decides whether to order. Demand is that day's real sales; on
// a day the real shop was OUT, sales were censored, so demand is the in-stock daily rate.
//   placeholder -- bo-inventory.js suggestQty: at or below the typed danger level, top up to 2x.
//   reorderPlan -- bo-insights.js, demand re-read weekly from the history BEFORE that day.
// ponytail: both rules see stock + on-order (the real Needs-buying list does not, which only
// makes the placeholder look better than it is). Lead is the supplier's mean, no spread, the
// same for both rules. The out-day demand rate uses the whole year (mild lookahead).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../bo-model.js');
Object.assign(globalThis, model);
const I = require('../bo-insights.js');
const { suggestQty } = require('../bo-inventory.js');
const { round2, normalizeProduct } = model;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
const dayOf = (ts) => I.dayNum(I.dayKey(ts));

/* ---------- a synthetic year: five products, five demand shapes ---------- */
function synthetic() {
  let seed = 20260914;
  const rnd = () => {                                   // mulberry32, same as seed-year.js
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const END = I.dayNum('2026-09-13'), START = END - 364;
  const suppliers = [
    { id: 'sup_fast', name: 'Fast Supply', quotedLeadDays: 2, orderDays: [1, 4], lead: [2, 4] },
    { id: 'sup_slow', name: 'Slow Supply', quotedLeadDays: 5, orderDays: [2], lead: [5, 9] },
  ];
  // Danger levels typed the way owners type them: round, generous, never revisited.
  const specs = [
    { id: 'p_cement', name: 'Cement 40kg', cost: 240, reorderPoint: 60, supplierId: 'sup_fast', want: () => between(4, 12) },
    { id: 'p_paint', name: 'Paint 4L', cost: 520, reorderPoint: 20, supplierId: 'sup_slow',
      want: () => (rnd() < 0.5 ? 0 : rnd() < 0.8 ? between(1, 3) : between(6, 14)) },
    { id: 'p_elbow', name: 'PVC elbow 1/2in', cost: 18, reorderPoint: 40, supplierId: 'sup_slow', want: () => (rnd() < 0.25 ? between(1, 3) : 0) },
    { id: 'p_tile', name: 'Floor tile 60x60', cost: 45, reorderPoint: 80, supplierId: 'sup_fast', want: () => (rnd() < 0.08 ? between(10, 40) : 0) },
    { id: 'p_wire', name: 'THHN wire 2.0', cost: 12, reorderPoint: 50, supplierId: 'sup_slow', soldBy: 'measure', unit: 'm',
      want: () => Math.round(rnd() * 700) / 100 },
  ];
  const movements = [], purchaseOrders = [], stock = new Map(), pending = [];
  let n = 0;
  const ts = (d, h) => new Date(Date.parse(I.dayStartIso(d)) + h * 36e5).toISOString();
  const move = (d, h, p, qty, reason, refId = '') => {
    movements.push({ id: 'mv' + ++n, ts: ts(d, h), productId: p.id, qty, reason, refId, unitCost: p.cost, note: '', staff: '' });
    stock.set(p.id, round2((stock.get(p.id) || 0) + qty));
  };
  specs.forEach((p) => move(START, 8, p, p.reorderPoint * 2, 'count'));
  for (let d = START; d <= END; d++) {
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].day !== d) continue;
      const { p, po } = pending.splice(i, 1)[0];
      move(d, 9, p, po.items[0].qty, 'delivery', po.id);
      Object.assign(po, { status: 'received', receivedAt: ts(d, 9) });
      po.items[0].receivedQty = po.items[0].qty;
    }
    for (const p of specs) {
      const sold = Math.min(p.want(), Math.max(0, stock.get(p.id)));   // the till cannot sell air
      if (sold > 0) move(d, 10, p, -sold, 'sale');
      // The habit this whole exercise is about: when low, buy three times the danger level.
      if (stock.get(p.id) <= p.reorderPoint && !pending.some((x) => x.p === p)) {
        const s = suppliers.find((x) => x.id === p.supplierId);
        const po = { id: 'po' + purchaseOrders.length, number: 'PO-' + purchaseOrders.length, supplierId: s.id, status: 'ordered',
          orderedAt: I.dayKey(ts(d, 17)), expectedAt: '', receivedAt: '',
          items: [{ productId: p.id, qty: round2(p.reorderPoint * 3 - stock.get(p.id)), cost: p.cost, receivedQty: 0 }] };
        purchaseOrders.push(po);
        pending.push({ p, po, day: d + between(...s.lead) });
      }
    }
  }
  const products = specs.map(({ want, ...p }) => ({ ...p, price: round2(p.cost * 1.3), stock: stock.get(p.id) }));
  return { products, movements, purchaseOrders, suppliers: suppliers.map(({ lead, ...s }) => s) };
}

/* ---------- replay ---------- */
const data = file ? I.dataFromDump(JSON.parse(readFileSync(file, 'utf8'))) : synthetic();
const products = data.products.map(normalizeProduct).filter((p) => !p.archived);
const movements = (data.movements || []).filter((m) => Number.isFinite(Date.parse(m.ts)));
if (!movements.length) {
  console.error(`No stock movements in ${file} (hwpos.stockMovements.v1) -- nothing to replay.`);
  process.exit(1);
}
const firstDay = Math.min(...movements.map((m) => dayOf(m.ts)));
const lastDay = Math.max(...movements.map((m) => dayOf(m.ts)));
const endIso = I.dayStartIso(lastDay + 1);

const sales = new Map(), after = new Map();
for (const m of movements) {
  const d = dayOf(m.ts);
  if (m.reason === 'sale') {
    const by = sales.get(m.productId) || new Map();
    by.set(d, round2((by.get(d) || 0) - m.qty));
    sales.set(m.productId, by);
  }
  if (d > firstDay) after.set(m.productId, round2((after.get(m.productId) || 0) + m.qty));
}
const startStock = new Map(products.map((p) => [p.id, round2(p.stock - (after.get(p.id) || 0))]));
const stockouts = I.stockoutIntervals(products, movements, endIso);
const outBy = new Map(stockouts.rows.map((r) => [r.productId, I.outDayNums(r.intervals, Date.parse(endIso))]));
const rateBy = new Map(I.demandStats(products, movements, endIso, { days: lastDay - firstDay + 1, stockouts })
  .map((r) => [r.productId, r.dailyRate]));
const suppliers = (data.suppliers || []).map((s) => ({ ...model.SUPPLIER_DEFAULTS, ...s }));
const supBy = new Map(suppliers.map((s) => [s.id, s]));
const leadBy = new Map(I.supplierLeadTimes(data.purchaseOrders || [], suppliers).map((r) => [r.supplierId, r]));
const leadOf = (p) => Math.max(1, Math.round(leadBy.get(p.supplierId)?.leadDaysMean
  || supBy.get(p.supplierId)?.quotedLeadDays || 7));

const RULES = {
  placeholder: (p, stock, onOrder) => {
    const position = round2(stock + onOrder);
    return position <= p.reorderPoint ? suggestQty({ ...p, stock: position }) : 0;
  },
  reorderPlan: (p, stock, onOrder, demandBy) => I.reorderPlan({ ...p, stock }, {
    demand: demandBy.get(p.id), lead: leadBy.get(p.supplierId), supplier: supBy.get(p.supplierId), onOrder }).suggestQty,
};

function run(rule) {
  const stock = new Map(startStock), pipe = [];
  const per = new Map(products.map((p) => [p.id, { productId: p.id, name: p.name, cashPesosDays: 0, stockoutDays: 0, lostUnits: 0, orderLines: 0, unitsOrdered: 0 }]));
  let demandBy = new Map();
  for (let d = firstDay + 1; d <= lastDay; d++) {
    for (let i = pipe.length - 1; i >= 0; i--) {
      if (pipe[i].day > d) continue;
      const x = pipe.splice(i, 1)[0];
      stock.set(x.id, round2(stock.get(x.id) + x.qty));
    }
    if (rule === 'reorderPlan' && (d - firstDay - 1) % 7 === 0) {
      demandBy = new Map(I.demandStats(products, movements, I.dayStartIso(d), { days: 90, stockouts }).map((r) => [r.productId, r]));
    }
    for (const p of products) {
      const r = per.get(p.id), have = Math.max(0, stock.get(p.id));
      const hist = sales.get(p.id)?.get(d) || 0;
      const want = outBy.get(p.id)?.has(d) ? Math.max(hist, rateBy.get(p.id) || 0) : hist;
      const sold = Math.min(have, want);
      if (have <= 0 || want - sold > 1e-9) r.stockoutDays++;
      r.lostUnits += want - sold;
      stock.set(p.id, round2(have - sold));
      const onOrder = round2(pipe.filter((x) => x.id === p.id).reduce((s, x) => s + x.qty, 0));
      const q = RULES[rule](p, stock.get(p.id), onOrder, demandBy);
      if (q > 0) { pipe.push({ id: p.id, qty: q, day: d + leadOf(p) }); r.orderLines++; r.unitsOrdered += q; }
      r.cashPesosDays += p.cost * stock.get(p.id);
    }
  }
  const days = lastDay - firstDay;
  const perProduct = [...per.values()].map(({ cashPesosDays, ...r }) =>
    ({ ...r, avgCashPesos: round2(cashPesosDays / days), lostUnits: round2(r.lostUnits), unitsOrdered: round2(r.unitsOrdered) }));
  const total = (k) => round2(perProduct.reduce((s, r) => s + r[k], 0));
  return { rule, avgCashPesos: total('avgCashPesos'), stockoutDays: total('stockoutDays'), lostUnits: total('lostUnits'),
    orderLines: total('orderLines'), unitsOrdered: total('unitsOrdered'), perProduct };
}

const result = { source: file || 'synthetic', from: I.dayStartIso(firstDay + 1), to: endIso, days: lastDay - firstDay,
  products: products.length, rules: Object.keys(RULES).map(run) };

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const peso = (n) => '₱' + Math.round(n).toLocaleString('en-PH');
  const cols = [['rule', 14], ['avg cash tied up', 18], ['stockout days', 15], ['lost units', 12], ['order lines', 13], ['units ordered', 15]];
  const line = (cells) => cells.map((c, i) => (i ? String(c).padStart(cols[i][1]) : String(c).padEnd(cols[i][1]))).join('');
  console.log(`Backtest: ${result.source}, ${result.days} days, ${result.products} products\n`);
  console.log(line(cols.map((c) => c[0])));
  result.rules.forEach((r) => console.log(line([r.rule, peso(r.avgCashPesos), r.stockoutDays, r.lostUnits, r.orderLines, r.unitsOrdered])));
  console.log('\nPer product (placeholder -> reorderPlan): avg cash, stockout days, lost units');
  products.forEach((p, i) => {
    const [a, b] = result.rules.map((r) => r.perProduct[i]);
    console.log(`  ${p.name.padEnd(28)} ${peso(a.avgCashPesos).padStart(9)} -> ${peso(b.avgCashPesos).padEnd(9)}`
      + `${String(a.stockoutDays).padStart(5)} -> ${String(b.stockoutDays).padEnd(5)}${String(a.lostUnits).padStart(8)} -> ${b.lostUnits}`);
  });
}
