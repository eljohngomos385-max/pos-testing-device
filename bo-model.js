/* ==========================================================
   Hardware POS — Back Office data model
   ----------------------------------------------------------
   The shapes and the money maths every back-office page shares. Loaded before
   backoffice.js, so page modules can use it without importing anything.

   Two rules everything here obeys:
   - Money is a peso number in the client and INTEGER CENTAVOS in the database.
     The Worker converts (see CLAUDE.md). Every derived price is computed in
     centavos and rounded once, so 0.1 + 0.2 never reaches a receipt.
   - Stock is the sum of stock movements. `product.stock` is a cache that exists
     so the product grid stays one read; nothing may write it without also
     writing the movement that explains it.
   ========================================================== */

/* ---------- Money ---------- */
// ponytail: the whole app works in pesos; these three exist so margin maths is
// exact. Do the sums in centavos, come back to pesos once, at the end.
const cent = (pesos) => Math.round(Number(pesos || 0) * 100);
const unc = (centavos) => Math.round(Number(centavos || 0)) / 100;
const round2 = (pesos) => unc(cent(pesos));

/* ---------- Margin: cost, margin, price — any two drive the third ----------

   `marginMode` is 'flat' or 'percent'.
     flat    → marginValue is PESOS of profit per unit.   price = cost + margin
     percent → marginValue is a MARKUP ON COST, in percent. price = cost × (1 + p/100)

   Markup on cost, not margin on price: a store owner prices from the supplier's
   invoice ("cost 100, put 25 on it" → 125), which is the number they actually
   type. The accountant's margin (profit ÷ price) is shown alongside so the two
   are never confused — `marginSummary` prints both.                          */

function priceFromMargin(cost, mode, value) {
  const c = cent(cost);
  if (mode === 'percent') return unc(Math.round(c * (1 + Number(value || 0) / 100)));
  return unc(c + cent(value));
}

// The inverse: the user typed a price, so the margin has to follow.
function marginFromPrice(cost, price, mode) {
  const c = cent(cost), p = cent(price);
  if (mode === 'percent') return c ? round2(((p - c) / c) * 100) : 0;
  return unc(p - c);
}

// Both readings of the same two numbers, so it is never a mystery which one won.
function marginSummary(cost, price) {
  const c = cent(cost), p = cent(price);
  const profit = unc(p - c);
  const markup = c ? ((p - c) / c) * 100 : 0;   // on cost — what the owner typed
  const margin = p ? ((p - c) / p) * 100 : 0;   // on price — what the books say
  return { profit, markup: round2(markup), margin: round2(margin) };
}

/* ---------- Products ---------- */

const SOLD_BY = { each: 'Each', measure: 'By measure' };
const MARGIN_MODES = { percent: 'Percent', flat: 'Flat' };

// The client shape is camelCase; the database is snake_case. `data-store.js` is
// the one place that translates (PRODUCT_COLUMNS below). Fields already read by
// app.js keep their names — `folder` is the category, `reorderPoint` is the
// danger level — because renaming them means touching the POS for no gain.
const PRODUCT_DEFAULTS = {
  id: '', sku: '', barcode: '', name: '', brand: 'Generic',
  folder: '', unit: 'pc', soldBy: 'each',
  cost: 0, price: 0, marginMode: 'percent', marginValue: 0,
  stock: 0, reorderPoint: 0, sellOutOfStock: false,
  supplierId: '', altSupplierIds: [], groupId: '', imageUrl: '',
  weight: '', size: '', length: '',
  aliases: [], archived: false, updatedAt: '',
};

function normalizeProduct(raw) {
  const p = { ...PRODUCT_DEFAULTS, ...(raw || {}) };
  p.cost = round2(p.cost);
  p.price = round2(p.price);
  p.stock = Number(p.stock) || 0;
  p.reorderPoint = Number(p.reorderPoint) || 0;
  p.sellOutOfStock = !!p.sellOutOfStock;
  p.archived = !!p.archived;
  p.aliases = Array.isArray(p.aliases) ? p.aliases : [];
  // Backup suppliers. `supplierId` stays the primary because a purchase order and a
  // reorder list each need one answer to "who do we buy this from"; the rest are who
  // else stocks it when that one cannot deliver. Never repeats the primary.
  p.altSupplierIds = [...new Set((Array.isArray(p.altSupplierIds) ? p.altSupplierIds : [])
    .map(String).filter((x) => x && x !== p.supplierId))];
  if (!MARGIN_MODES[p.marginMode]) p.marginMode = 'percent';
  if (!SOLD_BY[p.soldBy]) p.soldBy = 'each';
  // A product saved before margins existed still has a cost and a price, and
  // those two already imply the margin. Derive it rather than showing zero.
  if (!Number(p.marginValue) && p.price !== p.cost) {
    p.marginValue = marginFromPrice(p.cost, p.price, p.marginMode);
  }
  return p;
}

// Every supplier that stocks this product, primary first. Suppliers overlap on
// purpose - one product listed under three of them is three places to buy it.
const supplierIdsOf = (p) => [p.supplierId, ...(p.altSupplierIds || [])].filter(Boolean);

// A whole number of pieces, or a decimal length/weight — this is what the POS
// keypad and every stock count key off, so it is a real switch, not a label.
const stepFor = (product) => (product && product.soldBy === 'measure' ? 0.01 : 1);
const roundQty = (product, qty) =>
  product && product.soldBy === 'measure' ? Math.round(Number(qty || 0) * 100) / 100
                                          : Math.round(Number(qty || 0));

const newId = (prefix) =>
  prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- Variants are groups, and groups already exist ----------

   The POS Sell grid already renders a parent tile that opens a sub-grid of
   members (`SEED_GROUPS` + `product.groupId`, app.js `openVariantModal`). That
   IS the variant model the back office needs: "Boysen Paint" is the group,
   "Boysen Paint Red" is a product in it with its own price, SKU, barcode, cost
   and stock. A separate `product_variants` table would be a second, weaker copy
   — a variant has to be sellable, countable and orderable, which is to say it
   has to be a product. The group carries the shared picture and category.     */

const GROUP_DEFAULTS = { id: '', name: '', folder: '', imageUrl: '' };

const groupOf = (product, groups) =>
  (product && product.groupId && groups.find((g) => g.id === product.groupId)) || null;

const variantsOf = (groupId, products) =>
  groupId ? products.filter((p) => p.groupId === groupId && !p.archived) : [];

// A variant carries its own picture; the group's is the family fallback for the
// ones that don't. (Decided 2026-09-11 -- variants used to share one image.)
const imageFor = (product, groups) => {
  const g = groupOf(product, groups);
  return product.imageUrl || (g && g.imageUrl) || '';
};


/* ---------- Stock movements: the log the number comes from ---------- */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const STOCK_REASONS = {
  sale: 'Sale', return: 'Return', delivery: 'Delivery',
  adjustment: 'Adjustment', count: 'Stock count', transfer: 'Transfer',
  // Stock that left without a sale, split by why. A generic "adjustment" hides whether the
  // shop is losing money to theft, to breakage or to expiry, and each has a different fix.
  shrinkage: 'Shrinkage', damage: 'Breakage', writeoff: 'Write-off',
};

// `qty` is signed: what actually happened to the shelf. `refId` points at the
// order or the purchase order when there was one, so "why does this say 12?"
// has an answer that is not a guess.
// `expected`/`counted` are kept on a count so the variance survives: qty alone says the shelf
// moved by -3, not that the system believed 40 and the shelf held 37.
function makeMovement({ productId, qty, reason, refId = '', note = '', unitCost = null, staff = '',
  expected = null, counted = null, happenedOn = '' }) {
  const mv = {
    id: newId('mv'),
    ts: new Date().toISOString(),
    productId, qty: Number(qty) || 0,
    reason: STOCK_REASONS[reason] ? reason : 'adjustment',
    refId, note, unitCost: unitCost == null ? null : round2(unitCost), staff,
  };
  if (expected != null) mv.expected = Number(expected) || 0;
  if (counted != null) mv.counted = Number(counted) || 0;
  // The store-local date the stock actually moved, when it isn't the day this was typed in.
  // Omitted otherwise, so an ordinary same-day row stays the old shape.
  if (DATE_ONLY.test(happenedOn)) mv.happenedOn = happenedOn;
  return mv;
}

// The cache and the log move together or not at all. `balanceAfter` stamps the shelf this row
// left behind, so how long stock sat at a level is readable without replaying the log -- which
// means a caller must apply BEFORE it appends, or the saved row goes out without it.
// balanceAfter lands in ENTRY order (when the row was typed), not happenedOn order -- a
// back-dated delivery still stamps the shelf as it stood the moment it was applied.
function applyMovement(product, movement) {
  // The movement's own qty must match what actually landed on the shelf, at the product's
  // precision, or the ledger (qty) and the cache (balanceAfter) disagree (fuzz-found: a
  // 7.9 on an each-product rounds the stock to 8 but left qty at 7.9; a string qty added
  // by string concatenation instead of arithmetic).
  movement.qty = roundQty(product, Number(movement.qty) || 0);
  product.stock = roundQty(product, (Number(product.stock) || 0) + movement.qty);
  movement.balanceAfter = product.stock;
  product.updatedAt = movement.ts;
  return product;
}

const isLow = (p) => !p.archived && Number(p.stock) <= Number(p.reorderPoint);
const stockValue = (p) => round2(cent(p.cost) * (Number(p.stock) || 0) / 100);

/* One stock level for every filter, tile and pill: out, low, dead or ok. Dead = on the shelf
   and nothing sold for DEAD_DAYS, the same 90 days as the Insights dead-stock list. The clock
   starts at the last sale, or at the first movement for something that never sold; no
   movements at all means we cannot tell, so it is not called dead. */
const DEAD_DAYS = 90;
const STOCK_LEVEL = { out: ['danger', 'Out of stock'], low: ['warn', 'Low'], dead: ['muted', 'Dead'], ok: ['ok', 'In stock'] };

// productId -> { lastSale, first } in ms, one pass over the movement log.
function saleClock(movements) {
  const idx = new Map();
  for (const m of movements || []) {
    const ms = Date.parse(m.happenedOn || m.ts);
    if (!Number.isFinite(ms)) continue;
    const r = idx.get(m.productId) || { lastSale: null, first: ms };
    if (ms < r.first) r.first = ms;
    if (m.reason === 'sale' && (r.lastSale == null || ms > r.lastSale)) r.lastSale = ms;
    idx.set(m.productId, r);
  }
  return idx;
}

function stockLevel(p, clock, now = Date.now()) {
  if (Number(p.stock) <= 0) return 'out';
  if (isLow(p)) return 'low';
  const since = clock ? (clock.lastSale ?? clock.first) : null;
  return since != null && now - since >= DEAD_DAYS * 86400000 ? 'dead' : 'ok';
}

/* ---------- Suppliers and purchase orders ---------- */

const PO_STATUS = {
  draft: 'Draft', ordered: 'Ordered', partial: 'Partial',
  received: 'Received', cancelled: 'Cancelled',
};
// The dashboard's "Deliveries coming" card. NOT orders.delivery — that is a
// customer's order going out; this is stock coming in.
const PO_INCOMING = ['ordered', 'partial'];

// orderDays: weekdays the supplier takes orders (0 = Sunday). minOrder: pesos. quotedLeadDays:
// what they SAY; the real lead time is derived from orderedAt → receivedAt, never typed.
const SUPPLIER_DEFAULTS = { id: '', name: '', contact: '', phone: '', email: '', address: '', note: '',
  orderDays: [], minOrder: 0, quotedLeadDays: 0 };
// sentAt: when it actually left for the supplier (orderedAt was being set on the status flip;
// sentAt is the send). promisedAt: the date the SUPPLIER gave, kept apart from expectedAt, which
// is our own guess and gets edited.
const PO_DEFAULTS = {
  id: '', supplierId: '', number: '', status: 'draft',
  orderedAt: '', sentAt: '', promisedAt: '', expectedAt: '', receivedAt: '', note: '', items: [], updatedAt: '',
};
// Lines live on the PO client-side (one read, one write); the Worker splits them
// into purchase_order_items. `data-store.js` owns that translation.
// invoiceCost: what the supplier BILLED per unit, against `cost`, what was quoted. shortReason:
// why fewer arrived than ordered, so fill rate has a cause and not just a number.
const poLine = (productId, qty, cost) =>
  ({ id: newId('pol'), productId, qty: Number(qty) || 0, cost: round2(cost), receivedQty: 0,
     invoiceCost: null, shortReason: '' });

const poTotal = (po) =>
  unc((po.items || []).reduce((sum, l) => sum + cent(l.cost) * (Number(l.qty) || 0), 0));

const poOutstanding = (po) =>
  (po.items || []).reduce((n, l) => n + Math.max(0, (Number(l.qty) || 0) - (Number(l.receivedQty) || 0)), 0);

// Store-local 'YYYY-MM-DD' for right now.
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Receiving is never "set the stock to X" — it appends deliveries and lets the
// status fall out of what is still outstanding. `happenedOn` is when the delivery truck
// actually showed up, when that's not today (typed late from the invoice date).
function receivePo(po, received /* { lineId: qty } */, happenedOn = '') {
  const movements = [];
  (po.items || []).forEach((line) => {
    const qty = Number(received[line.id]) || 0;
    if (qty <= 0) return;
    line.receivedQty = (Number(line.receivedQty) || 0) + qty;
    movements.push(makeMovement({
      productId: line.productId, qty, reason: 'delivery',
      // No note: refId already resolves to the PO number in the movement table, and
      // "PO-0082" beside "PO PO-0082" reads as a bug.
      refId: po.id, unitCost: line.cost, note: '', happenedOn,
    }));
  });
  po.status = poOutstanding(po) > 0 ? 'partial' : 'received';
  if (po.status === 'received') {
    po.receivedAt = DATE_ONLY.test(happenedOn) && happenedOn !== localToday()
      ? new Date(happenedOn + 'T12:00:00').toISOString()
      : new Date().toISOString();
  }
  po.updatedAt = new Date().toISOString();
  return movements;
}

/* ---------- Staff ---------- */

const STAFF_DEFAULTS = {
  id: '', name: '', role: 'cashier', email: '', pin: '', active: true,
};
const STAFF_ROLES = { owner: 'Owner', manager: 'Manager', cashier: 'Cashier', stock: 'Stock clerk' };

/* ---------- Persistence for the collections the back office owns ----------
   The POS writes products / folders / groups / orders; these four are ours. Same
   localStorage seam as everything else, so `data-store.js` swaps them all at once.
   Uses backoffice.js's readJsonStorage/storageSet, which load first at runtime.  */

const STORAGE_SUPPLIERS = 'hwpos.suppliers.v1';
const STORAGE_PURCHASE_ORDERS = 'hwpos.purchaseOrders.v1';
const STORAGE_STOCK_MOVEMENTS = 'hwpos.stockMovements.v1';
const STORAGE_STAFF = 'hwpos.staff.v1';

/* ---------- Paging ----------
   Every list in the back office stops at PAGE_ROWS and walks with real page numbers on
   the URL, so ?page=3 reproduces the screen like every other filter does. One helper,
   because a list that invents its own paging is a list that disagrees with the next one. */
const PAGE_ROWS = 50;

// The page is clamped to what actually exists, so a stale ?page= left over from a wider
// filter lands on the last real page instead of an empty table.
function paginate(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  const at = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  const from = (at - 1) * PAGE_ROWS;
  return { rows: rows.slice(from, from + PAGE_ROWS), page: at, pages, from, total: rows.length };
}

// 1 … 4 5 6 … 12 — the ends plus the current neighbourhood. Anything else is a wall of
// buttons nobody aims at.
function pageNumbers(at, pages) {
  const keep = new Set([1, pages, at - 1, at, at + 1]);
  const out = [];
  for (let i = 1; i <= pages; i++) {
    if (keep.has(i)) out.push(i);
    else if (out[out.length - 1] !== '…') out.push('…');
  }
  return out;
}

const SEED_STAFF = [
  { id: 'u1', name: 'El John',    role: 'owner',   email: 'eljohngomos385@gmail.com', pin: '••••', active: true },
  { id: 'u2', name: 'Maricel R.', role: 'manager', email: 'maricel@ejhardware.ph',    pin: '••••', active: true },
  { id: 'u3', name: 'Aldrin S.',  role: 'cashier', email: '',                         pin: '••••', active: true },
  { id: 'u4', name: 'Joy P.',     role: 'cashier', email: '',                         pin: '••••', active: true },
];

const loadList = (key, seed) => {
  const raw = readJsonStorage(key, null);
  return Array.isArray(raw) ? raw : (seed || []).map((x) => ({ ...x }));
};
const saveList = (key, list) => storageSet(key, JSON.stringify(list));

const loadSuppliers = () => loadList(STORAGE_SUPPLIERS).map((s) => ({ ...SUPPLIER_DEFAULTS, ...s }));
const saveSuppliers = (list) => saveList(STORAGE_SUPPLIERS, list);
const loadPurchaseOrders = () => loadList(STORAGE_PURCHASE_ORDERS).map((o) => ({ ...PO_DEFAULTS, ...o }));
const savePurchaseOrders = (list) => saveList(STORAGE_PURCHASE_ORDERS, list);
const loadMovements = () => loadList(STORAGE_STOCK_MOVEMENTS);
const saveMovements = (list) => saveList(STORAGE_STOCK_MOVEMENTS, list);
const loadStaff = () => loadList(STORAGE_STAFF, SEED_STAFF).map((u) => ({ ...STAFF_DEFAULTS, ...u }));
const saveStaff = (list) => saveList(STORAGE_STAFF, list);

// Movements are append-only: a correction is another row, never an edit.
// ponytail: newest first and capped at `limit` at the call site, because the log is
// the one collection that grows without bound.
function appendMovements(rows) {
  if (!rows.length) return;
  saveMovements(loadMovements().concat(rows));
}

/* ---------- Event logs: what happened and vanished, now kept ----------
   Every one is append-only and every row is { id, ts, staff, ...fields }. A correction is a
   new row. The field list per log is in docs/data-dictionary.md -- that file is what an AI
   reads, so a field added here without a line there is a field nobody can use.

   DAYS is the one STATE log: one row per date (id = 'YYYY-MM-DD'), the spine everything joins
   to by date. It is upserted, because the weather for a day gets filled in after the day.   */
const EVENT_LOGS = {
  priceLog:         'hwpos.priceLog.v1',         // productId, field, old, new, reason, source
  lostDemand:       'hwpos.lostDemand.v1',       // productId|text, qty, reason, substituteProductId
  deliveryEvents:   'hwpos.deliveryEvents.v1',   // orderId, event, driver, lat, lng
  supplierMessages: 'hwpos.supplierMessages.v1', // supplierId, poId, direction, channel, text
  decisions:        'hwpos.decisions.v1',        // kind, subjectId, inputs, rule, choice, actor
};

const makeEvent = (fields, staff = '') =>
  ({ id: newId('ev'), ts: new Date().toISOString(), staff, ...fields });

const loadEvents = (log) => loadList(EVENT_LOGS[log]);
// Returns false when storage refused the write (full or blocked), so a caller can say so.
function appendEvents(log, rows) {
  if (!EVENT_LOGS[log]) throw new Error('unknown event log: ' + log);
  if (!rows.length) return true;
  return saveList(EVENT_LOGS[log], loadEvents(log).concat(rows)) !== false;
}

// Price and cost overwrite in place on the product, so the change is logged by diffing the
// catalog before and after a save. One diff at the one write catches every editor, the CSV
// import and Inventory's reprice without any of them having to remember.
function priceChanges(before, after, { source = '', reason = '', staff = '' } = {}) {
  const old = new Map((before || []).map((p) => [p.id, p]));
  const rows = [];
  (after || []).forEach((p) => {
    const was = old.get(p.id);
    ['price', 'cost'].forEach((field) => {
      const from = was ? round2(was[field]) : null;
      const to = round2(p[field]);
      if (from === to || (from == null && !to)) return;
      rows.push(makeEvent({ productId: p.id, field, old: from, new: to, reason, source }, staff));
    });
  });
  return rows;
}

/* ---------- Fulfilment ----------
   Two built-ins; anything else is a type the owner added in Settings and is stored in the
   same `fulfilment` column as its own name. That is why a removed type never rewrites past
   sales -- the order already carries its label, exactly like a custom payment method.
   Only 'delivery' means an address; every custom type is a counter sale with a different word. */
const FULFIL_BUILTINS = [
  ['pickup', 'Pickup', 'Always on. The counter sale.'],
  ['delivery', 'Delivery', 'Asks for an address and a map pin.'],
];
// The back office has always called a pickup "Walk-in"; the POS pill says "Pickup". One
// helper, one caller-chosen word for that single key -- nothing else differs.
function orderFulfilLabel(order, pickup = 'Walk-in') {
  const f = String((order && order.fulfilment) || 'pickup');
  return f === 'delivery' ? 'Delivery' : f === 'pickup' ? pickup : f;
}
// The POS pill list: built-ins the owner kept, then the ones they added.
function fulfilMethods(settings) {
  const cfg = (settings && settings.fulfilment) || {};
  const off = new Set(cfg.hidden || []);
  return FULFIL_BUILTINS
    .filter(([k]) => k === 'pickup' || !off.has(k))
    .map(([key, label]) => ({ key, label, custom: false }))
    .concat((cfg.custom || []).map((name) => ({ key: name, label: name, custom: true })));
}

/* ---------- CSV: one column table, used for both directions ----------
   Import and export read the same list, so a file exported here re-imports
   without losing a field — which is the only reason a two-way CSV is worth
   having. `alt` names are what other systems call the column.               */

const PRODUCT_COLUMNS = [
  { key: 'sku', head: 'sku' },
  { key: 'barcode', head: 'barcode' },
  { key: 'name', head: 'name' },
  { key: 'brand', head: 'brand' },
  { key: 'folder', head: 'category', alt: ['folder'] },
  { key: 'unit', head: 'unit' },
  { key: 'soldBy', head: 'sold_by', alt: ['soldby'] },
  { key: 'cost', head: 'cost', num: true },
  { key: 'price', head: 'price', num: true },
  { key: 'marginMode', head: 'margin_mode', alt: ['marginmode'] },
  { key: 'marginValue', head: 'margin_value', alt: ['marginvalue'], num: true },
  { key: 'stock', head: 'stock', num: true },
  { key: 'reorderPoint', head: 'danger_level', alt: ['reorder_point', 'reorderpoint'], num: true },
  { key: 'sellOutOfStock', head: 'sell_out_of_stock', alt: ['selloutofstock'], bool: true },
  { key: 'supplierId', head: 'supplier_id', alt: ['supplierid'] },
  { key: 'altSupplierIds', head: 'alt_supplier_ids', alt: ['alt_suppliers'], list: true },
  { key: 'groupId', head: 'variant_group', alt: ['group_id', 'groupid'] },
  { key: 'imageUrl', head: 'image_url', alt: ['imageurl', 'image'] },
  { key: 'weight', head: 'weight' },
  { key: 'size', head: 'size' },
  { key: 'length', head: 'length' },
  { key: 'aliases', head: 'aliases', list: true },
];

const csvBool = (v) => /^(1|true|yes|y)$/i.test(String(v).trim());

function productToCsvRow(p) {
  return PRODUCT_COLUMNS.map((c) => {
    const v = p[c.key];
    if (c.list) return (v || []).join('|');
    if (c.bool) return v ? '1' : '0';
    return v == null ? '' : v;
  });
}

// Returns { product, errors } — a bad row is reported, never silently coerced
// into a ₱0 product that someone finds three months later.
function productFromCsvRow(row, headers) {
  const at = (col) => {
    let i = headers.indexOf(col.head);
    if (i < 0 && col.alt) for (const a of col.alt) { i = headers.indexOf(a); if (i >= 0) break; }
    return i < 0 ? undefined : String(row[i] == null ? '' : row[i]).trim();
  };
  const out = {}, errors = [];
  PRODUCT_COLUMNS.forEach((c) => {
    const raw = at(c);
    if (raw === undefined || raw === '') return;
    if (c.num) {
      const n = Number(raw);
      if (!Number.isFinite(n)) { errors.push(`${c.head}: "${raw}" is not a number`); return; }
      out[c.key] = n;
    } else if (c.bool) out[c.key] = csvBool(raw);
    else if (c.list) out[c.key] = raw.split('|').map((s) => s.trim()).filter(Boolean);
    else out[c.key] = raw;
  });
  if (!out.name) errors.push('name is required');
  return { product: out, errors };
}

/* ---------- Node self-check: node bo-model.js ---------- */
if (typeof module !== 'undefined' && require.main === module) {
  const assert = require('assert');

  // The example from the spec: cost 100, percent mode, 25%.
  assert.equal(priceFromMargin(100, 'percent', 25), 125);
  const s = marginSummary(100, 125);
  assert.equal(s.profit, 25);
  assert.equal(s.markup, 25);      // on cost, what was typed
  assert.equal(s.margin, 20);      // on price, what the books say
  assert.equal(marginFromPrice(100, 125, 'percent'), 25);
  assert.equal(marginFromPrice(100, 125, 'flat'), 25);
  assert.equal(priceFromMargin(100, 'flat', 25), 125);

  // Round trips at prices that break naive float maths. The property that has to
  // hold is that the PRICE is stable -- percent cannot always round-trip, because
  // a 25% markup on a 10-centavo cost is 12.5 centavos and the till has no such
  // coin. Price is authoritative; margin is what recomputes it.
  for (const [cost, pct] of [[0.1, 25], [19.99, 33.3], [1234.56, 12.5], [0.03, 200], [845, 7.5]]) {
    const price = priceFromMargin(cost, 'percent', pct);
    assert.equal(price, round2(price), 'price stays at 2dp');
    const back = priceFromMargin(cost, 'percent', marginFromPrice(cost, price, 'percent'));
    assert.equal(back, price, `price is stable through margin: ${cost} @ ${pct}%`);
    const flat = priceFromMargin(cost, 'flat', marginFromPrice(cost, price, 'flat'));
    assert.equal(flat, price, `flat margin is exact: ${cost} @ ${pct}%`);
  }
  // Whenever the price IS representable, the percent comes back exactly.
  for (const [cost, pct] of [[100, 25], [80, 12.5], [19.2, 25], [1000, 33]]) {
    const price = priceFromMargin(cost, 'percent', pct);
    assert.equal(marginFromPrice(cost, price, 'percent'), pct, `${cost} @ ${pct}%`);
  }
  assert.equal(priceFromMargin(0, 'percent', 25), 0);        // free stays free
  assert.equal(marginFromPrice(0, 50, 'percent'), 0);        // no divide by zero
  assert.equal(marginSummary(0, 0).margin, 0);

  // Stock is the sum of the log, and the cache follows it.
  const p = normalizeProduct({ id: 'p1', name: 'Cement', cost: 100, price: 125, stock: 0, reorderPoint: 5 });
  assert.equal(p.marginValue, 25);                            // derived, not zero
  [10, -3, -5].forEach((q) => applyMovement(p, makeMovement({ productId: 'p1', qty: q, reason: 'adjustment' })));
  assert.equal(p.stock, 2);
  assert.ok(isLow(p));
  assert.equal(stockValue(p), 200);

  // Measure products may hold 2.5 metres; each-products may not.
  const wire = normalizeProduct({ id: 'w', name: 'Wire', soldBy: 'measure' });
  assert.equal(roundQty(wire, 2.512), 2.51);
  assert.equal(roundQty(p, 2.6), 3);
  // Every applied movement carries the stock it left, at the product's own precision.
  const cut = makeMovement({ productId: 'w', qty: 2.5, reason: 'count' });
  applyMovement(wire, cut);
  assert.equal(cut.balanceAfter, 2.5);

  // A partial delivery stays partial and writes one movement per line received.
  const po = { ...PO_DEFAULTS, id: 'po1', number: 'PO-1', status: 'ordered',
               items: [poLine('p1', 10, 90), poLine('w', 5, 20)] };
  assert.equal(poTotal(po), 1000);
  let mv = receivePo(po, { [po.items[0].id]: 4 });
  assert.equal(po.status, 'partial');
  assert.equal(mv.length, 1);
  assert.equal(mv[0].reason, 'delivery');
  mv = receivePo(po, { [po.items[0].id]: 6, [po.items[1].id]: 5 });
  assert.equal(po.status, 'received');
  assert.equal(poOutstanding(po), 0);

  // happenedOn: kept only when it's a real date, dropped otherwise (old-shaped rows stay lean).
  assert.equal(makeMovement({ productId: 'p', qty: 1, reason: 'count', happenedOn: '2026-08-01' }).happenedOn, '2026-08-01');
  assert.equal('happenedOn' in makeMovement({ productId: 'p', qty: 1, reason: 'count' }), false);
  assert.equal('happenedOn' in makeMovement({ productId: 'p', qty: 1, reason: 'count', happenedOn: 'garbage' }), false);

  // applyMovement rounds the movement's own qty to the product's precision before it lands,
  // so the ledger and the cache never disagree (the fuzz-found bug).
  const each = normalizeProduct({ id: 'e', name: 'Screw', soldBy: 'each', stock: 5 });
  const fuzzy = makeMovement({ productId: 'e', qty: 7.9, reason: 'count' });
  applyMovement(each, fuzzy);
  assert.equal(fuzzy.qty, 8);
  assert.equal(each.stock, 13);
  assert.equal(5 + fuzzy.qty, fuzzy.balanceAfter);
  const strQty = makeMovement({ productId: 'e', qty: '5', reason: 'count' });
  applyMovement(each, strQty);
  assert.equal(strQty.qty, 5);
  assert.equal(each.stock, 18);

  // receivePo with a past happenedOn stamps every delivery movement and, once fully received,
  // receivedAt's local date -- compared by date part, so the test doesn't care about timezone.
  const po2 = { ...PO_DEFAULTS, id: 'po2', number: 'PO-2', status: 'ordered', items: [poLine('p1', 5, 90)] };
  const mv2 = receivePo(po2, { [po2.items[0].id]: 5 }, '2026-08-01');
  assert.equal(mv2[0].happenedOn, '2026-08-01');
  assert.equal(po2.status, 'received');
  assert.equal(po2.receivedAt.slice(0, 10), '2026-08-01');

  // CSV survives the round trip, including the fields other systems rename.
  const heads = PRODUCT_COLUMNS.map((c) => c.head);
  const back = productFromCsvRow(productToCsvRow(p), heads);
  assert.equal(back.errors.length, 0);
  assert.equal(back.product.name, 'Cement');
  assert.equal(back.product.cost, 100);
  assert.equal(back.product.reorderPoint, 5);
  // ...and under another system's column names.
  const alt = productFromCsvRow(['Nail', '12.5', '7'], ['name', 'price', 'reorder_point']);
  assert.equal(alt.product.reorderPoint, 7);
  assert.equal(productFromCsvRow(['Nail', 'abc'], ['name', 'price']).errors.length, 1);
  assert.equal(productFromCsvRow(['', '1'], ['name', 'price']).errors.length, 1);

  // Paging clamps to what exists: a stale ?page= from a wider filter lands on the last
  // real page, never on an empty table.
  const nums = Array.from({ length: 120 }, (_, i) => i);
  assert.equal(paginate(nums, 1).rows.length, PAGE_ROWS);
  assert.equal(paginate(nums, 3).from, 100);
  assert.equal(paginate(nums, 3).rows.length, 20);
  assert.equal(paginate(nums, 99).page, 3);          // past the end -> last page
  assert.equal(paginate(nums, 'x').page, 1);         // junk -> first page
  assert.equal(paginate([], 4).pages, 1);            // empty list still has one page
  assert.deepEqual(paginate(nums, 2).rows[0], 50);   // no row is skipped or repeated
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(pageNumbers(2, 12), [1, 2, 3, '…', 12]);   // no gap of one page

  // A save logs only what moved: an unchanged product writes nothing, a new one its first price.
  const logged = priceChanges([{ id: 'a', price: 300, cost: 250 }], [{ id: 'a', price: 325, cost: 250 }, { id: 'n', price: 5, cost: 0 }]);
  assert.deepEqual(logged.map((r) => [r.productId, r.field, r.old, r.new]), [['a', 'price', 300, 325], ['n', 'price', null, 5]]);
  assert.equal(makeMovement({ productId: 'p', qty: -3, reason: 'count', expected: 40, counted: 37 }).counted, 37);

  // A custom type is its own label, and an order keeps that label after the type is removed.
  assert.equal(orderFulfilLabel({}), 'Walk-in');
  assert.equal(orderFulfilLabel({ fulfilment: 'pickup' }, 'Pickup'), 'Pickup');
  assert.equal(orderFulfilLabel({ fulfilment: 'delivery' }), 'Delivery');
  assert.equal(orderFulfilLabel({ fulfilment: 'Tricycle' }), 'Tricycle');
  assert.deepEqual(fulfilMethods({ fulfilment: { hidden: ['delivery'], custom: ['Tricycle'] } }).map((m) => m.key),
    ['pickup', 'Tricycle']);
  assert.deepEqual(fulfilMethods({ fulfilment: { hidden: ['pickup'] } }).map((m) => m.key), ['pickup', 'delivery']);

  // Dead is 90 days since the last sale, or since the first movement when it never sold.
  const day = 86400000, t0 = Date.parse('2026-01-01T00:00:00Z');
  const clk = saleClock([{ productId: 'd', reason: 'delivery', ts: '2026-01-01T00:00:00Z' },
    { productId: 's', reason: 'delivery', ts: '2026-01-01T00:00:00Z' }, { productId: 's', reason: 'sale', ts: '2026-03-01T00:00:00Z' }]);
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'dead');
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, clk.get('s'), t0 + 90 * day), 'ok');
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, undefined, t0), 'ok');   // no history, no verdict
  assert.equal(stockLevel({ stock: 0, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'out');
  assert.equal(stockLevel({ stock: 1, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'low');

  console.log('bo-model: ok');
}

if (typeof module !== 'undefined') {
  module.exports = {
    cent, unc, round2, priceFromMargin, marginFromPrice, marginSummary,
    normalizeProduct, PRODUCT_DEFAULTS, PRODUCT_COLUMNS, productToCsvRow, productFromCsvRow,
    supplierIdsOf,
    makeMovement, applyMovement, isLow, stockValue, roundQty, stepFor, newId,
    DEAD_DAYS, STOCK_LEVEL, saleClock, stockLevel,
    groupOf, variantsOf, imageFor,
    PO_DEFAULTS, PO_STATUS, PO_INCOMING, poLine, poTotal, poOutstanding, receivePo,
    SUPPLIER_DEFAULTS, STAFF_DEFAULTS, STAFF_ROLES, STOCK_REASONS, SOLD_BY, MARGIN_MODES,
    GROUP_DEFAULTS, SEED_STAFF, PAGE_ROWS, paginate, pageNumbers,
    EVENT_LOGS, makeEvent, priceChanges,
    FULFIL_BUILTINS, orderFulfilLabel, fulfilMethods,
  };
}
