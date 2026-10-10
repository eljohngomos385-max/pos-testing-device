/* ==========================================================
   Hardware POS — Back Office data model
   ----------------------------------------------------------
   The shapes and the money maths every back-office page shares. Loaded before
   backoffice.js, so page modules can use it without importing anything.

   Two rules everything here obeys:
   - Money is a peso number in the client and INTEGER CENTAVOS in the database.
     The Worker converts (see CLAUDE.md). Every derived price is computed in
     centavos and rounded once, so 0.1 + 0.2 never reaches a receipt.
   - Stock is the sum of stock movements (stockOnHand). `product.stock` is that sum,
     set on load by withStock so the product grid stays one read; nothing writes it
     as a number of its own, only a movement moves it.
   ========================================================== */

/* ---------- Money ---------- */
// SalesMath from bo-model: a global in both pages (loaded first), a require in node.
const salesMath = () => (typeof SalesMath !== 'undefined' ? SalesMath
  : typeof window !== 'undefined' && window.SalesMath) || require('./sales-math.js');
// The whole app works in pesos; these three keep the sums exact: work in centavos, come back to
// pesos once, at the end. SalesMath's own, never a second copy (the page globals keep their names).
const { cent, unc, round2 } = salesMath();

/* ---------- Margin: cost, margin, price — any two drive the third ----------

   `marginMode` is 'flat' or 'percent'.
     flat    → marginValue is PESOS of profit per unit.   price = cost + margin
     percent → marginValue is a MARKUP ON COST, in percent. price = cost × (1 + p/100)

   Markup on cost, not margin on price: a store owner prices from the supplier's
   invoice ("cost 100, put 25 on it" → 125), which is the number they actually
   type. The accountant's margin (profit ÷ price before tax) is shown alongside so
   the two are never confused — SalesMath.unitMargin prints both, the one margin. */

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

/* ---------- Products ---------- */

const SOLD_BY = { each: 'Each', measure: 'By measure' };
const MARGIN_MODES = { percent: 'Percent', flat: 'Flat' };

// The client shape is camelCase; the database is snake_case. `data-store.js` is
// the one place that translates (PRODUCT_COLUMNS below). Fields already read by
// app.js keep their names — `folder` is the category, `reorderPoint` is the
// danger level — because renaming them means touching the POS for no gain.
const PRODUCT_DEFAULTS = {
  id: '', sku: '', barcode: '', name: '', brand: 'Generic',
  folder: '', folders: [], unit: 'pc', soldBy: 'each',
  cost: 0, price: 0, marginMode: 'percent', marginValue: 0,
  stock: 0, reorderPoint: 0, sellOutOfStock: false,
  supplierId: '', altSupplierIds: [], groupId: '', imageUrl: '',
  weight: '', size: '', length: '', description: '',
  // hidden: kept and listed here, but off the till's tiles and search (owner, 2026-10-01).
  // trackStock false: no counts and never an out-of-stock prompt (a service, a cut).
  hidden: false, trackStock: true, modifierIds: [],
  aliases: [], archived: false, updatedAt: '',
};

// Several categories per item (owner, 2026-10-01). `folder` stays the first of them, so
// everything that shows ONE category (tiles, item page, insights) reads it unchanged;
// anything that filters or counts by category asks foldersOf(). A row from before the
// list existed has only `folder`.
const foldersOf = (p) => [...new Set([p && p.folder, ...((p && Array.isArray(p.folders)) ? p.folders : [])]
  .map((x) => String(x || '')).filter((x) => x && x !== 'all'))];

function normalizeProduct(raw) {
  const p = { ...PRODUCT_DEFAULTS, ...(raw || {}) };
  p.cost = round2(p.cost);
  p.price = p.price == null || p.price === '' ? null : round2(p.price);   // blank = asked at sale (the POS's askedPrice), never 0
  p.stock = Number(p.stock) || 0;
  p.reorderPoint = Number(p.reorderPoint) || 0;
  p.sellOutOfStock = !!p.sellOutOfStock;
  p.archived = !!p.archived;
  p.aliases = Array.isArray(p.aliases) ? p.aliases : [];
  p.folders = foldersOf(p);
  p.folder = p.folders[0] || '';
  p.hidden = !!p.hidden;
  p.trackStock = p.trackStock !== false;
  p.modifierIds = [...new Set((Array.isArray(p.modifierIds) ? p.modifierIds : []).map(String).filter(Boolean))];
  // Backup suppliers. `supplierId` stays the primary because a purchase order and a
  // reorder list each need one answer to "who do we buy this from"; the rest are who
  // else stocks it when that one cannot deliver. Never repeats the primary.
  p.altSupplierIds = [...new Set((Array.isArray(p.altSupplierIds) ? p.altSupplierIds : [])
    .map(String).filter((x) => x && x !== p.supplierId))];
  if (!MARGIN_MODES[p.marginMode]) p.marginMode = 'percent';
  if (!SOLD_BY[p.soldBy]) p.soldBy = 'each';
  // A product saved before margins existed still has a cost and a price, and
  // those two already imply the margin. Derive it rather than showing zero.
  if (!Number(p.marginValue) && p.price != null && p.price !== p.cost) {
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

// Every new record, on every till and back office: a v4 UUID, so rows from two tills never clash
// when they sync. randomUUID needs https; a till on plain http (a LAN IP) builds the same thing from
// getRandomValues. Old ids (p_…, ord_…) stay as they are. The prefix argument is ignored.
const newId = () => {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = c && c.getRandomValues ? c.getRandomValues(new Uint8Array(16))
    : Uint8Array.from({ length: 16 }, () => Math.random() * 256);
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
// Every appended row gets the data store's stamp (store id + updatedAt, data-store.js stamp). In node
// (the checks) there is no data store: only updatedAt.
const stampRow = (row) => (globalThis.HWPOS_STORE && HWPOS_STORE.stamp ? HWPOS_STORE.stamp(row)
  : Object.assign(row, { updatedAt: new Date().toISOString() }));

/* ---------- Variants are groups, and groups already exist ----------

   The POS Sell grid already renders a parent tile that opens a sub-grid of
   members (`SEED_GROUPS` + `product.groupId`, app.js `openVariantModal`). That
   IS the variant model the back office needs: "Boysen Paint" is the group,
   "Boysen Paint Red" is a product in it with its own price, SKU, barcode, cost
   and stock. A separate `product_variants` table would be a second, weaker copy
   — a variant has to be sellable, countable and orderable, which is to say it
   has to be a product. The group carries the shared picture and category.     */

const GROUP_DEFAULTS = { id: '', name: '', folder: '', imageUrl: '', description: '' };

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
  // Where a product's log starts (openingRows): the stock it had before its first logged move.
  // Written only by openingRows, never picked as an adjustment reason.
  opening: 'Opening stock',
};

// `qty` is signed: what actually happened to the shelf. `refId` points at the
// order or the purchase order when there was one, so "why does this say 12?"
// has an answer that is not a guess.
// `expected`/`counted` are kept on a count so the variance survives: qty alone says the shelf
// moved by -3, not that the system believed 40 and the shelf held 37.
// ts is epoch ms like an order's (2026-10-03; older rows hold ISO text, read every ts through
// SalesMath.tsOf / movedAt). staffId is who did it, the record's link; `staff` is the name at the
// time, kept for display when the person is gone.
function makeMovement({ productId, qty, reason, refId = '', note = '', unitCost = null, staff = '', staffId = '',
  expected = null, counted = null, happenedOn = '' }) {
  const mv = {
    id: newId('mv'),
    ts: Date.now(),
    productId, qty: Number(qty) || 0,
    reason: STOCK_REASONS[reason] ? reason : 'adjustment',
    refId, note, unitCost: unitCost == null ? null : round2(unitCost), staff, staffId: String(staffId || ''),
  };
  if (expected != null) mv.expected = Number(expected) || 0;
  if (counted != null) mv.counted = Number(counted) || 0;
  // The store-local date the stock actually moved, when it isn't the day this was typed in.
  // Omitted otherwise, so an ordinary same-day row stays the old shape.
  if (DATE_ONLY.test(happenedOn)) mv.happenedOn = happenedOn;
  return mv;
}

// A row being appended steps this page's loaded sum (withStock) by its qty, so the screen needn't
// re-read the whole log; the next load derives the same number. `balanceAfter` stamps the shelf this row
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
  product.updatedAt = new Date(salesMath().tsOf(movement)).toISOString();   // a product's updatedAt stays ISO text
  return product;
}

// "Needs buying": at or below its danger level, OUT INCLUDED. The Low pill/filter is stockLevel's
// 'low' (out excluded); a tile counting isLow says "Out or low".
const isLow = (p) => !p.archived && p.trackStock !== false && Number(p.stock) <= Number(p.reorderPoint);
// What the shelf is worth at cost. Negative stock is a counting error, not negative money (0);
// an untracked item has no shelf (0).
const stockValue = (p) => (p.trackStock === false ? 0 : round2(cent(p.cost) * Math.max(0, Number(p.stock) || 0) / 100));
// THE Stock value: every live product's stockValue (archived left out). Per family = pass its members.
const stockValueOf = (products) =>
  unc((products || []).reduce((s, p) => s + (p.archived ? 0 : cent(stockValue(p))), 0));
// THE family's on hand: its members' stock added up (the Items list, item page, supplier page and till).
const onHandOf = (members) => round2((members || []).reduce((n, m) => n + (Number(m.stock) || 0), 0));

/* The stock rule (owner 2026-10-03: stock = the sum of its movements). On hand is Σ qty of the
   product's movements, every reason alike: opening, sale, return, delivery, adjustment, loss and
   count. A count is stored as its difference (qty = counted − on hand, with expected/counted kept
   beside it), so it sums like the rest and two tills' rows merged still add up. stockOnHand is
   THE formula; withStock puts it on product.stock once per load or change, and every screen reads
   that. The `stock` a saved product carries is a stale snapshot nobody reads, except openingRows,
   once per device (data-store seedOpening): one 'opening' row per product for the stock it had
   before the log, fixed id ('opening:' + productId) so two tills seeding one catalog write it once. */
const stockOnHand = (movements) => {
  const out = new Map();
  for (const m of movements || []) out.set(m.productId, round2((out.get(m.productId) || 0) + (Number(m.qty) || 0)));
  return out;
};
// Sets every product's stock from the log (one pass, not per tile). The only writer of
// product.stock besides applyMovement's step for a row the page is appending right now.
// Until the log is readable and anchored here (data-store stockReady: the database still opening on a
// first start), the saved snapshot is the best there is and stays as it is.
function withStock(products, movements) {
  if (globalThis.HWPOS_STORE?.stockReady?.() === false) return products;
  const sum = stockOnHand(movements || loadMovements());
  for (const p of products || []) p.stock = roundQty(p, sum.get(p.id) || 0);
  return products;
}
// The missing opening rows: saved count − Σ log, per product that still lacks one. They are the START
// of the log (ts 0, 1970): put them before every other movement, never edit one.
// Untracked items too, so their numbers carry over unchanged as well.
function openingRows(products, movements) {
  const sum = stockOnHand(movements), has = new Set((movements || []).filter((m) => m.reason === 'opening').map((m) => m.productId));
  const out = [];
  for (const p of products || []) {
    if (has.has(p.id)) continue;
    const qty = roundQty(p, (Number(p.stock) || 0) - (sum.get(p.id) || 0));
    if (qty) out.push({ id: 'opening:' + p.id, ts: 0, productId: p.id, qty, reason: 'opening', refId: '', note: '', unitCost: null, staff: '' });
  }
  return out;
}
// Balance after each movement (id → qty), walked back from the cache so the column and On hand
// agree even before opening rows exist. `movements` in append order. One copy for Inventory and
// the item page.
function runningBalances(movements, stockOf) {
  const byProduct = new Map();
  for (const m of movements || []) (byProduct.get(m.productId) || byProduct.set(m.productId, []).get(m.productId)).push(m);
  const balance = new Map();
  byProduct.forEach((list, pid) => {
    let running = Number(stockOf(pid)) || 0;
    for (let i = list.length - 1; i >= 0; i--) { balance.set(list[i].id, running); running = round2(running - (Number(list[i].qty) || 0)); }
  });
  return { byProduct, balance };
}

// Stock that left without a sale: stolen, broken, written off, or a count that came up short.
// An opening row is where the log starts, never a loss.
const LOSS_REASON = new Set(['shrinkage', 'damage', 'writeoff']);
const isLoss = (m) => !!m && (LOSS_REASON.has(m.reason) || (m.reason === 'count' && Number(m.qty) < 0));
// When a movement happened, in ms: its happenedOn day (store-local noon) when that is not the day it
// was typed, else ts. One reading for Inventory, Insights and the dead clock.
function movedAt(m, zone = 'Asia/Manila') {
  const SM = salesMath(), ts = SM.tsOf(m);
  if (!DATE_ONLY.test(m.happenedOn || '') || m.happenedOn === SM.dayKey(ts, zone)) return ts;
  return SM.dayStartMs(m.happenedOn, zone) + 12 * 3600000;
}
// The first category: the one a share, a chart slice or a CSV "Category" uses, so shares sum to
// 100% (owner 2026-10-02). Filters still match every category (foldersOf).
const categoryOf = (p) => (p ? foldersOf(p)[0] || '' : '');

/* One stock level for every filter, tile and pill: out, low, dead or ok. Dead = on the shelf
   and nothing sold for DEAD_DAYS, the same 90 days as the Insights dead-stock list. The clock
   starts at the last sale, or at the first movement for something that never sold; no
   movements at all means we cannot tell, so it is not called dead. */
const DEAD_DAYS = 90;
const STOCK_LEVEL = { out: ['danger', 'Out of stock'], low: ['warn', 'Low'], dead: ['muted', 'Dead'], ok: ['ok', 'In stock'] };

// productId -> { lastSale, first } in ms (movedAt, store time), one pass over the movement log.
// THE "last sold" of an item = the latest sale not cancelled by a VOID (lead default 2026-10-03, an
// owner question): a refunded sale still happened, as SalesMath's lastSale says. Both a void and a
// refund write a 'return' with the SALE's id as refId, so telling them apart needs the orders.
// ponytail: without `orders` every returned sale is dropped (the old rule) -- pass them.
function saleClock(movements, zone, orders = null) {
  const voided = orders && new Set(orders.filter((o) => o.status === 'void' && o.originalOrderId).map((o) => String(o.originalOrderId)));
  const back = new Set((movements || []).filter((m) => m.reason === 'return' && m.refId && (!voided || voided.has(String(m.refId))))
    .map((m) => m.refId + '|' + m.productId));
  const idx = new Map();
  for (const m of movements || []) {
    const ms = movedAt(m, zone);
    if (!ms) continue;
    const r = idx.get(m.productId) || { lastSale: null, first: ms };
    if (ms < r.first) r.first = ms;
    if (m.reason === 'sale' && !back.has(m.refId + '|' + m.productId) && (r.lastSale == null || ms > r.lastSale)) r.lastSale = ms;
    idx.set(m.productId, r);
  }
  return idx;
}

// Dead counts STORE days (SalesMath.daysAgo), the days "Last sold 90 days ago" says -- not 24-hour blocks.
// ponytail: zone is Manila until Settings has a time zone (SalesMath.storeZone); then pass it down.
function stockLevel(p, clock, now = Date.now(), zone = 'Asia/Manila') {
  if (p.trackStock === false) return 'ok';   // a service or a cut: no count to run out of
  if (Number(p.stock) <= 0) return 'out';
  if (isLow(p)) return 'low';
  const since = clock ? (clock.lastSale ?? clock.first) : null;
  return since != null && salesMath().daysAgo(since, now, zone) >= DEAD_DAYS ? 'dead' : 'ok';
}
// One level for a family of variants (Items list, item page, till): Out only when every variant
// is; one out or low variant makes it Low; Dead when all are; else ok. A product with no group is
// a family of one. Returns the key; STOCK_LEVEL[key] is its pill.
function familyLevel(members, clock, now = Date.now(), zone = 'Asia/Manila') {
  const lv = (members || []).map((m) => stockLevel(m, clock && clock.get(m.id), now, zone));
  return !lv.length || lv.every((l) => l === 'out') ? 'out'
    : lv.some((l) => l === 'out' || l === 'low') ? 'low' : lv.every((l) => l === 'dead') ? 'dead' : 'ok';
}
// The stock tiles' counts, one per ITEM (a family counts once, by familyLevel), live products only.
// { out, low, dead, ok }. "Needs buying" = out + low.
function stockCounts(products, clock, now = Date.now(), zone = 'Asia/Manila') {
  const fams = new Map();
  for (const p of products || []) if (!p.archived) {
    const k = p.groupId || p.id;
    (fams.get(k) || fams.set(k, []).get(k)).push(p);
  }
  const n = { out: 0, low: 0, dead: 0, ok: 0 };
  for (const ms of fams.values()) n[familyLevel(ms, clock, now, zone)]++;
  return n;
}
// The out-or-low LIST behind those counts: one row per family whose familyLevel is out or low, live
// products only. { id (group or product id), productIds (the live members), sku (a family of one's,
// else ''), name (the group's, else the product's), level, stock (the family's, summed), reorderPoint
// (summed) }, out first, then lowest stock.
function familyRows(products, groups, clock, now = Date.now(), zone = 'Asia/Manila') {
  const fams = new Map();
  for (const p of products || []) if (!p.archived) {
    const k = p.groupId || p.id;
    (fams.get(k) || fams.set(k, []).get(k)).push(p);
  }
  const rows = [];
  for (const [id, ms] of fams) {
    const level = familyLevel(ms, clock, now, zone);
    if (level !== 'out' && level !== 'low') continue;
    const g = groupOf(ms[0], groups || []);
    const add = (f) => unc(ms.reduce((s, p) => s + cent(p[f]), 0));
    rows.push({ id, productIds: ms.map((p) => p.id), sku: ms.length === 1 ? ms[0].sku || '' : '',
      name: (ms[0].groupId && g && g.name) || ms[0].name || '', level, stock: add('stock'), reorderPoint: add('reorderPoint') });
  }
  return rows.sort((a, b) => (a.level === b.level ? 0 : a.level === 'out' ? -1 : 1) || a.stock - b.stock);
}

/* THE stock flow for one window [a, b) of ms: Inventory's Stock history and Insights' sold at cost.
   Total and per bucket (bucketOf(ms) -> a day or an hour key), money at cost in pesos:
     in   -- what arrived: deliveries, a hand change up. A return (void or refund) is NOT stock
             arriving: it nets against out and against its 'sale' reason, so a voided sale reads as
             nothing happened, and "sold at cost" = sales - returns everywhere.
     out  -- what left, net of returns.   lost -- isLoss.   adj -- how many hand changes were typed.
   A shelf count is in neither in nor out (the number was corrected); an opening row starts the log.
   A return on its sale's own store day sits in the SALE's bucket (SalesMath.chartTime, the sales
   charts' rule): a 9 AM sale voided at 2 PM empties the 9 AM bar, it does not push 2 PM below 0.
   `why` splits out by reason, biggest first; each share is of the reasons shown, so they add to 100%.
   ponytail: a return in the window for a sale before it can leave out (or a bucket) below 0 -- that
   is what happened in the window. */
const MANUAL_REASON = new Set(['count', 'adjustment', 'shrinkage', 'damage', 'writeoff']);
function stockFlow(movements, costOf, [a, b], bucketOf = () => '', zone = 'Asia/Manila') {
  const zero = () => ({ in: 0, out: 0, lost: 0, adj: 0 });
  const t = zero(), buckets = new Map(), why = new Map(), SM = salesMath();
  const tally = (r, c) => why.set(r, (why.get(r) || 0) + c);
  const saleAt = new Map((movements || []).filter((m) => m.reason === 'sale' && m.refId).map((m) => [m.refId + '|' + m.productId, movedAt(m, zone)]));
  for (const m of movements || []) {
    const ms = movedAt(m, zone), q = Number(m.qty) || 0;
    if (!(ms >= a && ms < b) || !q) continue;
    const c = movementCents(q, m.unitCost ?? costOf(m.productId));
    const s = m.reason === 'return' ? saleAt.get(m.refId + '|' + m.productId) : null;
    const k = bucketOf(s != null && SM.dayKey(s, zone) === SM.dayKey(ms, zone) ? s : ms), bk = buckets.get(k) || zero();
    const add = (f, v) => { t[f] += v; bk[f] += v; };
    if (MANUAL_REASON.has(m.reason)) add('adj', 1);
    if (isLoss(m)) add('lost', c);
    if (m.reason === 'return') { add('out', -c); tally('sale', -c); }
    else if (m.reason !== 'count' && m.reason !== 'opening') {
      if (q > 0) add('in', c);
      else { add('out', c); tally(m.reason, c); }
    }
    buckets.set(k, bk);
  }
  const p = (x) => ({ in: x.in / 100, out: x.out / 100, lost: x.lost / 100, adj: x.adj });
  const shown = [...why].filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1]);
  const all = shown.reduce((s, [, c]) => s + c, 0);
  return { ...p(t), buckets: new Map([...buckets].map(([k, v]) => [k, p(v)])),
    why: shown.map(([reason, c]) => ({ reason, value: c / 100, share: c / all })) };
}

/* THE lot walk (FIFO), one list per product, for Insights' age chart AND sell-through, so they tell
   one story. Every stock-in row (delivery, opening, a hand change up) is a lot; every row out drains
   the oldest lot first. A return (void or refund, refId = the sale) is NOT a new lot: its units go
   back to the lots that sale drained, last drained first, so a refunded sale is not "sold" and its
   units keep their age. A return the walk can't match goes to the before-the-log lot. Stock the
   cache holds beyond the log (no opening row yet) is that oldest lot too.
   productId -> [{ m (the movement; null before the log), at (ms; null for before the log or an
   opening row: older than any window), qty, left, sold (by sales, net of returns), otherOut,
   clearedAt (ms, or null while any is left) }], oldest first.
   ponytail: drains scan from the oldest lot, O(rows x lots) per product -- fine for a shop's log. */
function lotWalk(movements, products = [], zone = 'Asia/Manila') {
  const stockOf = new Map((products || []).map((p) => [p.id, Number(p.stock) || 0]));
  const by = new Map();
  (movements || []).map((m) => ({ m, ms: movedAt(m, zone) })).filter((x) => Number.isFinite(x.ms))
    .sort((x, y) => x.ms - y.ms)
    .forEach((x) => (by.get(x.m.productId) || by.set(x.m.productId, []).get(x.m.productId)).push(x));
  const lot = (m, at, qty) => ({ m, at, qty, left: qty, sold: 0, otherOut: 0, clearedAt: null });
  const out = new Map();
  for (const [pid, list] of by) {
    const before = stockOf.has(pid) ? round2(stockOf.get(pid) - list.reduce((s, x) => s + (Number(x.m.qty) || 0), 0)) : 0;
    const lots = before > 0 ? [lot(null, null, before)] : [];
    const took = new Map();   // sale id -> [[lot, qty]] in drain order
    for (const { m, ms } of list) {
      let q = Number(m.qty) || 0;
      if (q > 0 && m.reason === 'return') {
        const back = took.get(m.refId) || [];
        while (q > 1e-9 && back.length) {
          const e = back[back.length - 1], n = Math.min(q, e[1]);
          e[0].left = round2(e[0].left + n); e[0].sold = round2(e[0].sold - n); e[0].clearedAt = null;
          e[1] = round2(e[1] - n); q = round2(q - n);
          if (e[1] <= 1e-9) back.pop();
        }
        if (q > 1e-9) {
          if (!lots.length || lots[0].m) lots.unshift(lot(null, null, 0));
          lots[0].qty = round2(lots[0].qty + q); lots[0].left = round2(lots[0].left + q); lots[0].clearedAt = null;
        }
        continue;
      }
      if (q > 0) { lots.push(lot(m, m.reason === 'opening' ? null : ms, q)); continue; }
      let need = -q;
      for (const l of lots) {
        if (need <= 1e-9) break;
        if (l.left <= 1e-9) continue;
        const n = Math.min(l.left, need);
        l.left = round2(l.left - n); need = round2(need - n);
        if (m.reason === 'sale') {
          l.sold = round2(l.sold + n);
          if (m.refId) (took.get(m.refId) || took.set(m.refId, []).get(m.refId)).push([l, n]);
        } else l.otherOut = round2(l.otherOut + n);
        if (l.left <= 1e-9) l.clearedAt = ms;
      }
    }
    out.set(pid, lots);
  }
  for (const [pid, stock] of stockOf) if (!out.has(pid) && stock > 0) out.set(pid, [lot(null, null, stock)]);
  return out;
}

/* ---------- Suppliers and purchase orders ---------- */

const PO_STATUS = {
  draft: 'Draft', ordered: 'Ordered', partial: 'Partial',
  received: 'Received', cancelled: 'Cancelled',
};
// The dashboard's "Deliveries coming" card. NOT orders.delivery — that is a
// customer's order going out; this is stock coming in.
const PO_INCOMING = ['ordered', 'partial'];

// Lead time is derived from sentAt/orderedAt → receivedAt, never typed. orderDays, minOrder and
// quotedLeadDays were dropped 2026-09-26; an old record may still carry them and nothing reads them.
const SUPPLIER_DEFAULTS = { id: '', name: '', contact: '', phone: '', email: '', address: '', note: '', archived: false };
// sentAt: when it actually left for the supplier (orderedAt was being set on the status flip;
// sentAt is the send). promisedAt: the date the SUPPLIER gave, kept apart from expectedAt, which
// is our own guess and gets edited.
// One buying list for the whole run (owner, 2026-10-02): the supplier lives on each LINE, the PO has
// none. A record from before still carries po.supplierId; lineSupplier falls back to it.
// status is derived (poStatus) and only cached on the record for the readers that filter on it.
const PO_DEFAULTS = {
  id: '', number: '', status: 'draft', cancelledAt: '',
  orderedAt: '', sentAt: '', promisedAt: '', expectedAt: '', receivedAt: '', note: '', items: [], updatedAt: '',
};
// Lines live on the PO client-side (one read, one write); the Worker splits them
// into purchase_order_items. `data-store.js` owns that translation.
// invoiceCost: what the supplier BILLED per unit, against `cost`, what was quoted. shortReason:
// why fewer arrived than ordered, so fill rate has a cause and not just a number.
// supplierId: where to buy it ('' = anywhere, a market run). receivedOn: the day it last arrived.
const poLine = (productId, qty, cost, supplierId = '') =>
  ({ id: newId('pol'), productId, qty: Number(qty) || 0, cost: round2(cost), supplierId, receivedQty: 0,
     receivedOn: '', invoiceCost: null, shortReason: '', updatedAt: new Date().toISOString() });
const lineSupplier = (po, l) => (l.supplierId !== undefined ? l.supplierId : po.supplierId) || '';
const lineOut = (l) => Math.max(0, round2((Number(l.qty) || 0) - (Number(l.receivedQty) || 0)));
// Who a delivery movement came from: receivePo stamps the line's supplier on it. A movement from
// before that reads its PO's old one-supplier field.
const deliverySupplier = (po, m) =>
  (m && m.supplierId !== undefined ? m.supplierId : po ? lineSupplier(po, {}) : '');

// The unit cost the supplier BILLED on the latest bill (receiving stores invoiceCost), else the quote.
const billedCost = (l) => (l.invoiceCost != null && l.invoiceCost !== '' ? l.invoiceCost : l.cost);
// A line's money (lead default 2026-10-03, an owner question): what arrived at ITS delivery's cost, what
// is still to come at the QUOTE -- a bill only covers what it billed. 10 @ 100, 4 came billed 120:
// 4 x 120 + 6 x 100 = 1,080; still to come 600; billed so far 480. Then 3 more with the bill blank (= the
// quote): 480 + 300 + 300 = 1,080 again. What arrived is line.receivedCost, the sum receivePo adds of each
// delivery's qty x unitCost -- the same cents its movement puts into stock value (stockFlow), so the PO,
// stock value and Insights' Bought agree. A line received before 2026-10-03 has none: its received units
// at its one bill, which is what it had.
const lineInCents = (l) => (l.receivedCost != null ? cent(l.receivedCost) : cent(billedCost(l)) * (Number(l.receivedQty) || 0));
// A movement's money at cost, in cents: THE one rounding stockFlow and a PO line's received cost share.
const movementCents = (qty, unitCost) => Math.round(Math.abs(Number(qty) || 0) * (Number(unitCost) || 0) * 100);
const poLineTotal = (l) => unc(lineInCents(l) + cent(l.cost) * lineOut(l));
const poTotal = (po) => unc((po.items || []).reduce((sum, l) => sum + cent(poLineTotal(l)), 0));
// The units a line's money counts: what arrived plus what is still to come -- the ordered qty, or what
// arrived when more came than ordered (an over-ship). Show it beside poLineUnit so the row multiplies out.
const poLineQty = (l) => round2((Number(l.receivedQty) || 0) + lineOut(l));
// The unit cost a PO line SHOWS beside its total, so poLineQty × unit reads as the line total: the quote
// until a bill is in, then the line's blend (4 @ 120 + 6 @ 100 → 108). No units: its billed cost.
// ponytail: a blend that doesn't divide shows to the centavo.
const poLineUnit = (l) => {
  const n = poLineQty(l);
  return n > 0 ? round2(poLineTotal(l) / n) : round2(billedCost(l));
};

const poOutstanding = (po) => (po.items || []).reduce((n, l) => n + lineOut(l), 0);

// Read off the lines, never typed: cancelled wins, then what has arrived, then whether it was sent.
// A record from before cancelledAt/sentAt keeps the status it was saved with.
function poStatus(po) {
  if (po.cancelledAt || po.status === 'cancelled') return 'cancelled';
  if ((po.items || []).some((l) => Number(l.receivedQty) > 0)) return poOutstanding(po) > 0 ? 'partial' : 'received';
  return po.sentAt || (po.status && po.status !== 'draft') ? 'ordered' : 'draft';
}
// Money still to come, at the quote, only on a PO that is actually coming: a draft or a cancelled
// one owes nothing.
const poOpenValue = (po) => (PO_INCOMING.includes(poStatus(po))
  ? unc((po.items || []).reduce((s, l) => s + cent(l.cost) * lineOut(l), 0)) : 0);
// productId -> units still to come on every list actually SENT (ordered or partial). A draft is
// not on order (owner 2026-10-02), so On order and Incoming (poOpenValue) count the same lists.
function onOrderQty(purchaseOrders) {
  const out = new Map();
  for (const po of purchaseOrders || []) {
    if (!PO_INCOMING.includes(poStatus(po))) continue;
    for (const l of po.items || []) if (lineOut(l)) out.set(l.productId, (out.get(l.productId) || 0) + lineOut(l));
  }
  return out;
}

// The store's 'YYYY-MM-DD' for right now (the store's clock, not the laptop's).
const localToday = (zone) => salesMath().dayKey(Date.now(), zone);

// Receiving is never "set the stock to X" — it appends deliveries and lets the
// status fall out of what is still outstanding. `happenedOn` is when the delivery truck
// actually showed up, when that's not today (typed late from the invoice date).
// received: { lineId: qty } or { lineId: { qty, unitCost } }, unitCost being what the supplier billed.
// productOf(id) rounds each qty the way the shelf will (applyMovement), so the line and the shelf
// agree: half a piece is no piece, and 0.7 + 0.1 m is 0.8. Without it, quantities round to cents.
// who: { staffId, staff, zone } -- who received it (every movement carries a staff id) and the store's
// clock for "today" and the back-dated noon.
function receivePo(po, received /* { lineId: qty | { qty, unitCost } } */, happenedOn = '', productOf = null,
  { staffId = '', staff = '', zone = 'Asia/Manila' } = {}) {
  const movements = [];
  const on = DATE_ONLY.test(happenedOn) ? happenedOn : localToday(zone);
  (po.items || []).forEach((line) => {
    const r = received[line.id];
    const raw = Number(r && typeof r === 'object' ? r.qty : r) || 0;
    const qty = productOf ? roundQty(productOf(line.productId), raw) : round2(raw);
    if (qty <= 0) return;
    const billed = r && typeof r === 'object' && r.unitCost != null ? round2(r.unitCost) : null;
    // invoiceCost = the latest bill (Insights' billed-vs-quoted); the line's money is receivedCost, every
    // delivery at its own cost (its movement's unitCost), added before receivedQty moves.
    const unitCost = billed != null ? billed : line.cost;
    line.receivedCost = unc(lineInCents(line) + movementCents(qty, unitCost));
    if (billed != null) line.invoiceCost = billed;
    line.receivedQty = round2((Number(line.receivedQty) || 0) + qty);
    line.receivedOn = on;
    line.updatedAt = new Date().toISOString();
    const mv = makeMovement({
      productId: line.productId, qty, reason: 'delivery',
      // No note: refId already resolves to the PO number in the movement table, and
      // "PO-0082" beside "PO PO-0082" reads as a bug.
      refId: po.id, unitCost, note: '', happenedOn, staffId, staff,
    });
    // Which line, and so which supplier: one item can be on two lines from two suppliers.
    mv.supplierId = lineSupplier(po, line);
    mv.lineId = line.id;
    movements.push(mv);
  });
  if (!movements.length) return movements;   // an all-zero receive changes nothing
  po.status = poStatus(po);
  if (po.status === 'received') {
    po.receivedAt = DATE_ONLY.test(happenedOn) && happenedOn !== localToday(zone)
      ? new Date(salesMath().dayStartMs(happenedOn, zone) + 12 * 3600000).toISOString()   // store noon, as movedAt
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

// The keys are data-store.js's (HWPOS_STORAGE_KEYS), the one list. ponytail: a node check that loads
// bo-model without the data store gets the same 'hwpos.<name>.v1' every key here follows.
const storeKey = (name) => ((globalThis.HWPOS_STORAGE_KEYS || (globalThis.window && window.HWPOS_STORAGE_KEYS) || {})[name]
  || `hwpos.${name}.v1`);
const STORAGE_SUPPLIERS = storeKey('suppliers');
const STORAGE_PURCHASE_ORDERS = storeKey('purchaseOrders');
const STORAGE_STOCK_MOVEMENTS = storeKey('stockMovements');
const STORAGE_STAFF = storeKey('staff');
// Modifier lists (owner, 2026-10-01): a named list of options, each a name and a price, switched
// on per item (product.modifierIds). No stock. Back office only for now; the POS reads it later.
const STORAGE_MODIFIERS = storeKey('modifiers');
// Saved discounts (owner, 2026-10-07): a name and how much (% or a fixed amount), picked from the cart's
// Discount sheet; the name rides on the sale's cartDiscount to the receipt. Senior / PWD are built in (`builtin`
// = the SC/PWD kind): never deleted or renamed, still ask for the ID, their % is SalesMath.orderTotals' scRate.
const STORAGE_DISCOUNTS = storeKey('discounts');

/* ---------- Paging ----------
   Every list in the back office stops at PAGE_ROWS and walks with real page numbers on
   the URL, so ?page=3 reproduces the screen like every other filter does. One helper,
   because a list that invents its own paging is a list that disagrees with the next one.
   A single record's page (a customer, a supplier) pages at DETAIL_ROWS: its tables sit
   under the record's facts, and 50 rows buries them. */
const PAGE_ROWS = 50;
const DETAIL_ROWS = 25;

// The page is clamped to what actually exists, so a stale ?page= left over from a wider
// filter lands on the last real page instead of an empty table.
function paginate(rows, page, size = PAGE_ROWS) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  const from = (at - 1) * size;
  return { rows: rows.slice(from, from + size), page: at, pages, from, total: rows.length };
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
// Every record a list saves carries the store it belongs to (J13): one the editor never stamped gets
// the store's id here, once ('' until the store is hosted). updatedAt is the editor's to set -- a save
// that bumped every row's would make the newest-wins merge (savePurchaseOrders) keep stale rows.
const saveList = (key, list) => {
  const sid = globalThis.HWPOS_STORE && HWPOS_STORE.readSettings ? HWPOS_STORE.readSettings().store.id || '' : null;
  if (sid != null) for (const r of list) if (r && typeof r === 'object' && !('storeId' in r)) r.storeId = sid;
  return storageSet(key, JSON.stringify(list));
};

const loadSuppliers = () => loadList(STORAGE_SUPPLIERS).map((s) => ({ ...SUPPLIER_DEFAULTS, ...s }));
const saveSuppliers = (list) => saveList(STORAGE_SUPPLIERS, list);
const loadPurchaseOrders = () => loadList(STORAGE_PURCHASE_ORDERS).map((o) => ({ ...PO_DEFAULTS, ...o, status: poStatus(o) }));
// Merged into what is stored now, by id, the newer updatedAt winning: a second window saving the list
// it loaded an hour ago must not wipe a receipt (or a new PO) the first one saved since.
// ponytail: no delete path for POs exists; a delete needs a tombstone here, not a missing row.
const savePurchaseOrders = (list) => {
  const mine = new Map(list.map((o) => [o.id, o]));
  const out = loadList(STORAGE_PURCHASE_ORDERS).map((o) => {
    const m = mine.get(o.id);
    mine.delete(o.id);
    return m && !(String(o.updatedAt || '') > String(m.updatedAt || '')) ? m : o;
  }).concat([...mine.values()]);
  out.forEach((o) => { o.status = poStatus(o); });
  return saveList(STORAGE_PURCHASE_ORDERS, out);
};
const loadMovements = () => loadList(STORAGE_STOCK_MOVEMENTS);
const saveMovements = (list) => saveList(STORAGE_STOCK_MOVEMENTS, list);
const loadStaff = () => loadList(STORAGE_STAFF, SEED_STAFF).map((u) => ({ ...STAFF_DEFAULTS, ...u }));
const saveStaff = (list) => saveList(STORAGE_STAFF, list);
// A person's name from the id a row carries (approvedBy, staffId), '' when nobody has it -- never the raw
// id on screen. And back: the id for the name a screen holds (the signed-in actor), '' when none.
const staffNameOf = (id, staff = loadStaff()) => (id && (staff.find((u) => u.id === id) || {}).name) || '';
const staffIdOf = (name, staff = loadStaff()) => (name && (staff.find((u) => u.name === name) || {}).id) || '';

/* ---------- What a role does at the till without a manager (features/staff-permissions) ----------
   Owner, 2026-10-02: a switch per role for these three; with it off, a manager's PIN approves it
   on the spot. Set in Back office › Staff & access › Roles, read by the till (app.js `gate`).
   Owner is always on, like page access. */
// `credit`: turning credit on for a customer made at the till (lead default 2026-10-02, customers).
// dayTotals isn't PIN-gated: off just hides the day's total on the Orders bands (owner 2026-10-06: a cashier shouldn't see it).
// `discount` (owner 2026-10-09): a sale's discounts past `discountLimit` % (pos-sell discountOk); SC/PWD never counts.
// `shift` (owner 2026-10-10): who sees the Shift page and starts / closes it. Anyone sells.
const TILL_ACTIONS = { void: 'Void a sale', refund: 'Refund a sale', overLimit: 'Sell past a credit limit', credit: 'Turn on credit for a customer', dayTotals: "See the day's totals", discount: 'Give big discounts', shift: 'Start and close shifts' };
const STORAGE_TILL_PERMS = storeKey('tillPerms');
const TILL_PERMS_DEFAULT = { manager: Object.keys(TILL_ACTIONS), cashier: [], stock: [] };
const TILL_ACTIONS_V1 = ['void', 'refund', 'overLimit', 'credit', 'dayTotals'];   // what a map saved with no `known` list knew
// The map also carries `discountLimit`: "Ask a manager for discounts over N%", one value shown in POS › Settings and
// Back office › Staff & access. 20 by default; null = Never ask. `known` lists the switches the map was saved with:
// a switch it didn't know yet gets the role's default (on for a manager), not off. A map with no `known` knew
// TILL_ACTIONS_V1, plus `discount` if it carries `discountLimit`.
function loadTillPerms(raw = readJsonStorage(STORAGE_TILL_PERMS, null) || {}) {
  const out = {}, knew = 'discountLimit' in raw, known = raw.known || TILL_ACTIONS_V1.concat(knew ? ['discount'] : []);
  for (const role of Object.keys(STAFF_ROLES)) {
    const def = TILL_PERMS_DEFAULT[role] || [];
    out[role] = role === 'owner' ? Object.keys(TILL_ACTIONS)
      : (Array.isArray(raw[role]) ? raw[role].concat(def.filter((a) => !known.includes(a))) : def).filter((a) => a in TILL_ACTIONS);
  }
  out.discountLimit = !knew ? 20 : raw.discountLimit > 0 ? Number(raw.discountLimit) : null;
  return out;
}
const saveTillPerms = (map) => storageSet(STORAGE_TILL_PERMS, JSON.stringify({ ...map, known: Object.keys(TILL_ACTIONS) }));
const roleCan = (role, action, perms = loadTillPerms()) => (perms[role] || []).includes(action);
// A PIN is 4–6 digits. The seed's '••••' is a placeholder, not a PIN.
const isPin = (pin) => /^\d{4,6}$/.test(String(pin || ''));
// The one active person this PIN belongs to, else null. Two active people on one PIN (an old
// duplicate, or two tills' staff lists synced together) is nobody: a PIN names one person or none.
// Works with no internet: staff and PINs are on the till. ponytail: PINs stored as typed -- hashing
// 10,000 possible PINs on the same device adds nothing; pin_hash when staff sync (features/database).
function staffByPin(pin, staff = loadStaff()) {
  const hits = isPin(pin) ? staff.filter((u) => u.active && u.pin === String(pin)) : [];
  return hits.length === 1 ? hits[0] : null;
}
// The till's sign-in (C1) and the manager PIN both read people through staffByPin.
const approverFor = (pin, action, staff = loadStaff(), perms = loadTillPerms()) => {
  const u = staffByPin(pin, staff);
  return u && roleCan(u.role, action, perms) ? u : null;
};
const MODIFIER_DEFAULTS = { id: '', name: '', options: [], archived: false, updatedAt: '' };
const loadModifiers = () => loadList(STORAGE_MODIFIERS).map((m) => ({ ...MODIFIER_DEFAULTS, ...m,
  options: (Array.isArray(m.options) ? m.options : []).map((o) => ({ id: String(o.id || ''), name: String(o.name || ''), price: round2(o.price) })) }));
const saveModifiers = (list) => saveList(STORAGE_MODIFIERS, list);
const DISCOUNT_DEFAULTS = { id: '', name: '', type: 'percent', value: 0, builtin: '', archived: false, updatedAt: '' };
// Fixed ids and one fixed stamp, not fresh ones: every till seeds the same four, so syncing two tills never doubles
// them, and any edit (stampRow) is newer than the seed.
const SEED_DISCOUNTS = [
  { id: 'disc-staff', name: 'Staff', value: 15 }, { id: 'disc-contractor', name: 'Contractor', value: 10 },
  { id: 'senior', name: 'Senior', value: 20, builtin: 'senior' }, { id: 'pwd', name: 'PWD', value: 20, builtin: 'pwd' },
].map((d) => ({ ...d, updatedAt: '2026-01-01T00:00:00.000Z' }));   // in the past, so a till's first edit always wins
const loadDiscounts = () => loadList(STORAGE_DISCOUNTS, SEED_DISCOUNTS).map((d) => ({ ...DISCOUNT_DEFAULTS, ...d,
  type: d.type === 'amount' && !d.builtin ? 'amount' : 'percent', value: round2(d.value) }));
const saveDiscounts = (list) => saveList(STORAGE_DISCOUNTS, list);
// The list as both till screens show it (Items › Discounts, the cart's sheet): Senior / PWD first, then A–Z.
const liveDiscounts = (list = loadDiscounts()) => list.filter((d) => !d.archived)
  .sort((a, b) => b.builtin.localeCompare(a.builtin) || a.name.localeCompare(b.name, undefined, { numeric: true }));   // 'senior' > 'pwd' > ''
// The SC/PWD rate as a fraction (0.2) for orderTotals' scRate: the built-in row's %, else the law's 20%.
const scRateOf = (kind, list = loadDiscounts()) => ((list.find((d) => d.builtin === kind) || {}).value ?? 20) / 100;

// Movements are append-only: a correction is another row, never an edit.
// ponytail: newest first and capped at `limit` at the call site, because the log is
// the one collection that grows without bound.
function appendMovements(rows) {
  if (!rows.length) return;
  saveMovements(loadMovements().concat(rows.map(stampRow)));
}

/* ---------- Event logs: what happened and vanished, now kept ----------
   Every one is append-only and every row is { id, ts, staff, ...fields }. A correction is a
   new row. The field list per log is in docs/data-dictionary.md -- that file is what an AI
   reads, so a field added here without a line there is a field nobody can use.

   DAYS is the one STATE log: one row per date (id = 'YYYY-MM-DD'), the spine everything joins
   to by date. It is upserted, because the weather for a day gets filled in after the day.   */
const EVENT_LOGS = {
  priceLog:         storeKey('priceLog'),         // productId, field, old, new, reason, source
  lostDemand:       storeKey('lostDemand'),       // productId|text, qty, reason, substituteProductId
  deliveryEvents:   storeKey('deliveryEvents'),   // orderId, event, driver, lat, lng
  supplierMessages: storeKey('supplierMessages'), // supplierId, poId, direction, channel, text
  decisions:        storeKey('decisions'),        // kind, subjectId, inputs, rule, choice, actor
  pinLockouts:      storeKey('pinLockouts'),      // kind (signIn | the gated action), tries, strike, waitSec, register (pos-pin.js)
};

// ts epoch ms like every other row (2026-10-03; older rows hold ISO text -- read through SalesMath.tsOf).
const makeEvent = (fields, staff = '') =>
  ({ id: newId('ev'), ts: Date.now(), staff, ...fields });

const loadEvents = (log) => loadList(EVENT_LOGS[log]);
// Returns false when storage refused the write (full or blocked), so a caller can say so.
function appendEvents(log, rows) {
  if (!EVENT_LOGS[log]) throw new Error('unknown event log: ' + log);
  if (!rows.length) return true;
  return saveList(EVENT_LOGS[log], loadEvents(log).concat(rows.map(stampRow))) !== false;
}
// THE newest row per key (a delivery's trip state: per orderId). Times through tsOf: compared as
// text, a new ms row ('17…') sorts below an old ISO one ('2026-…') and never wins. A tie goes to the later row.
function latestEvents(rows, key = 'orderId') {
  const at = salesMath().tsOf, out = new Map();
  for (const r of rows || []) { const cur = out.get(r[key]); if (!cur || at(r) >= at(cur)) out.set(r[key], r); }
  return out;
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
// THE catalog write for both apps: store the list, then log what moved in price or cost.
function saveCatalog(list, meta) {
  const before = readJsonStorage(STORAGE_PRODUCTS, null);
  const ok = storageSet(STORAGE_PRODUCTS, JSON.stringify(list));
  if (ok && Array.isArray(before)) appendEvents('priceLog', priceChanges(before, list, meta));
  return ok;
}

/* ---------- Customers and their account (features/customers, owner 2026-10-02) ----------
   One form in both apps: the fields, the words and the check live here, and the POS and the
   back office only wrap the inputs in their own classes. The balance is never a stored field:
   it is the sum of the account's ledger, so a till and the back office cannot disagree on it.
   STORAGE_CUSTOMERS / STORAGE_CUSTOMER_LEDGER are declared by each app and read at call time. */
const CUSTOMER_FIELDS = [
  { name: 'name', label: 'Name', type: 'text', attrs: ' required' },
  { name: 'phone', label: 'Phone', type: 'tel' },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'text', wide: true },
  { name: 'creditOn', label: 'Credit', type: 'select', options: [['', 'Off'], ['on', 'On']] },
  { name: 'creditLimit', label: 'Credit limit', type: 'number', attrs: ' min="0" step="0.01" placeholder="No limit"' },
];

// Old records carried a type, a stored balance and isCreditCustomer; a till-made one had limit 0,
// which meant no limit (bug 6). A record that never had credit on/off gets it from those.
function normalizeCustomer(raw) {
  const { currentBalance, type, isCreditCustomer, ...c } = raw || {};
  const limit = Number(c.creditLimit) > 0 ? round2(c.creditLimit) : null;
  const on = 'creditOn' in c ? !!c.creditOn
    : isCreditCustomer != null ? !!isCreditCustomer : limit != null || Number(currentBalance) > 0;
  return {
    ...c,
    id: String(c.id || ''),
    name: String(c.name || '').trim(),
    phone: String(c.phone || '').trim(),
    email: String(c.email || '').trim(),
    address: String(c.address || '').trim(),
    creditOn: on,
    creditLimit: on ? limit : null,   // null = no limit; credit off carries none, so it is never Over limit
  };
}

// `wrap(field, control, index)` is the app's own label markup; `cls` its input class.
function customerFieldsHtml(raw, { cls = '', wrap }) {
  const c = normalizeCustomer(raw);
  return CUSTOMER_FIELDS.map((f, i) => {
    const v = f.name === 'creditOn' ? (c.creditOn ? 'on' : '') : (c[f.name] ?? '');
    const at = `name="${f.name}"${cls ? ` class="${cls}"` : ''}`;
    const control = f.options
      ? `<select ${at}>${f.options.map(([o, l]) => `<option value="${o}"${o === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`
      : `<input ${at} type="${f.type}" value="${escapeHtml(String(v))}"${f.attrs || ''} autocomplete="off">`;
    return wrap(f, control, i);
  }).join('');
}

// The one check, for both forms: { customer } or { error, field }.
function customerFromForm(values, existing) {
  const limit = String(values.creditLimit ?? '').trim();
  if (!String(values.name || '').trim()) return { error: 'Name is required', field: 'name' };
  if (limit && !(Number(limit) > 0)) return { error: 'Credit limit is an amount above 0, or blank for no limit', field: 'creditLimit' };
  return { customer: normalizeCustomer({ ...(existing || {}), ...values, creditOn: values.creditOn === 'on', creditLimit: limit || null }) };
}

// Duplicate phone (owner 2026-10-03): families share one, so both forms warn and offer the other
// customer, never block. One number however it is typed: digits only, +63 and the leading 0 the same.
// ponytail: PH prefixes only; the US / Japan add theirs when those markets open.
const phoneKey = (p) => String(p || '').replace(/\D/g, '').replace(/^(63|0)/, '');
// Another customer (not `selfId`) who already has this phone, or null.
function phoneOwner(phone, selfId = '') {
  const k = phoneKey(phone);
  return (k && freshList(STORAGE_CUSTOMERS).map(normalizeCustomer).find((c) => c.id !== selfId && phoneKey(c.phone) === k)) || null;
}
// The one sentence both forms show for it; each app passes its own link to `dup` (button or anchor).
const phoneOwnerNote = (dup, open) => `${escapeHtml(dup.name)} already has this number. ${open} or save again to add anyway.`;

// Each list is read fresh on every use and parsed only when the stored text changed, so a till
// never writes back a stale copy (bug 2: the POS overwrote back-office edits from its own cache).
const listMemo = new Map();
function freshList(key) {
  const raw = storageGet(key, '');
  const hit = listMemo.get(key);
  if (hit && hit.raw === raw) return hit.list;
  let list = null;
  try { list = raw ? JSON.parse(raw) : []; } catch (_) {}
  listMemo.set(key, { raw, list: Array.isArray(list) ? list : [] });
  return listMemo.get(key).list;
}
function loadCustomerLedger() { return freshList(STORAGE_CUSTOMER_LEDGER); }
const accountRows = (id) => loadCustomerLedger().filter((r) => r.customerId === id);   // one account's ledger

function saveCustomer(c) {
  const rec = stampRow({ ...normalizeCustomer(c), id: c.id || newId() });
  const list = loadList(STORAGE_CUSTOMERS).filter((x) => x.id !== rec.id);
  saveList(STORAGE_CUSTOMERS, list.concat(rec));
  return rec;
}

/* The ledger: five kinds, every row positive except an opening or an adjustment, which carry
   their own sign. A reversal with `reverses` undoes a payment (a wrong payment is never deleted);
   one with an orderId takes a voided or refunded sale's charge back. Before this, a reversal
   was logged as a payment with an orderId (bug 8), so such a row reads as a reversal. */
const LEDGER_SIGN = { charge: 1, opening: 1, adjustment: 1, payment: -1, reversal: -1 };
const LEDGER_LABEL = { charge: 'Charge', opening: 'Opening balance', adjustment: 'Adjustment', payment: 'Payment', reversal: 'Reversal' };
const kindOf = (r) => (r.type === 'payment' && r.orderId ? 'reversal' : r.type);
const ledgerCents = (r) => (r.reverses ? 1 : LEDGER_SIGN[kindOf(r)] || 0) * cent(r.amount);
const ledgerDelta = (r) => unc(ledgerCents(r));

// The payments undone so far. An undone payment and every row undoing it count for nothing, so
// two tills undoing the same payment at once still undo it once.
const undoneIds = (rows) => new Set(rows.filter((r) => r.reverses).map((r) => r.reverses));
const counts = (r, undone) => !r.reverses && !undone.has(r.id);

const balanceMemo = new WeakMap();
function balancesOf(ledger) {
  if (balanceMemo.has(ledger)) return balanceMemo.get(ledger);
  const cents = new Map(), undone = undoneIds(ledger);
  for (const r of ledger) if (counts(r, undone)) cents.set(r.customerId, (cents.get(r.customerId) || 0) + ledgerCents(r));
  const out = new Map([...cents].map(([id, n]) => [id, unc(n)]));
  balanceMemo.set(ledger, out);
  return out;
}
const accountBalance = (id) => balancesOf(loadCustomerLedger()).get(id) || 0;

// Every customer, with `currentBalance` worked out from the ledger on the way out -- never stored.
function allCustomerRecords() {
  const bal = balancesOf(loadCustomerLedger());
  return freshList(STORAGE_CUSTOMERS).map((c) => ({ ...normalizeCustomer(c), currentBalance: bal.get(c.id) || 0 }));
}

// Clear, the settled state, is muted; past the limit is Over limit (owner 2026-10-02). A negative
// balance is money the store holds for them (a cheaper exchange): In credit (lead default 2026-10-03).
function accountStatus(c) {
  const bal = c.currentBalance || 0, pct = c.creditOn && c.creditLimit ? bal / c.creditLimit : 0;
  return bal < 0 ? ['info', 'In credit']
       : !(bal > 0) ? ['muted', 'Clear']
       : pct > 1 ? ['danger', 'Over limit']
       : pct > 0.75 ? ['warn', 'Near limit']
       : pct > 0.4 ? ['info', 'In use']
       : ['info', 'Active'];
}
// Every word accountStatus can give, lowest balance first: the Customers status filter's options.
const ACCOUNT_STATUSES = ['In credit', 'Clear', 'Active', 'In use', 'Near limit', 'Over limit'];
// Record payment is offered on every account, at ₱0 or in credit too: money paid ahead of a charge
// goes on account (accountDebts pays the next charge with it). Lead default 2026-10-03, owner question:
// to offer it only while they owe, make this (c) => c.currentBalance > 0.
const canRecordPayment = (c) => !!(c && c.id);
// The balance in words after a name, e.g. "Ana owes ₱120.00": owes ₱X · has ₱X in credit · owes nothing.
// money = the app's peso().
const owedText = (balance, money) => {
  const b = round2(balance);
  return b > 0 ? `owes ${money(b)}` : b < 0 ? `has ${money(-b)} in credit` : 'owes nothing';
};
// The limit in words: what the form's blank and the Credit switch mean, said the same way twice.
const limitText = (c) => (!c.creditOn ? 'Credit off' : c.creditLimit ? null : 'No limit');
// THE headroom Available credit shows: 0 with credit off, Infinity with no limit, and never more than
// the limit (money held for them is not shown as extra credit). The gates read creditOverBy, which does
// let money held for them cover a charge (it is theirs).
function creditRoom(c) {
  if (!c || !c.creditOn) return 0;
  const limit = Number(c.creditLimit) || 0;
  return limit ? round2(Math.max(0, Math.min(limit, limit - (Number(c.currentBalance) || 0)))) : Infinity;
}
// THE sale and exchange gate: how far over the limit the account WOULD BE after the charge, in pesos
// (0 = fine) -- the till's "would be ₱X over their limit". The balance after the charge against the
// limit, accountStatus' Over limit test, so money held for them (a negative balance) counts first and
// an account already over reads its whole overage, not just this charge. Credit off: all of the charge.
// No limit: none. creditRoom stays what Available credit SHOWS.
function creditOverBy(c, charge) {
  const n = cent(charge);
  if (!(n > 0)) return 0;
  if (!c || !c.creditOn) return unc(n);
  const limit = cent(c.creditLimit);
  return limit > 0 ? unc(Math.max(0, cent(c.currentBalance) + n - limit)) : 0;
}
// The Customers strip, one pass: owed = what customers owe (money held for one is not credit out),
// limit = every limit added, used = what is owed on accounts that HAVE a limit (Utilization = used ÷
// limit; a no-limit account's debt is not using any limit), over = how many are Over limit (the status
// filter's own test), active = how many owe something.
function creditPool(customers) {
  let owed = 0, used = 0, limit = 0, over = 0, active = 0;
  for (const c of customers || []) {
    const bal = Number(c.currentBalance) || 0;
    if (bal > 0) { owed += cent(bal); active++; if (cent(c.creditLimit) > 0) used += cent(bal); }
    limit += cent(c.creditLimit);
    if (accountStatus(c)[1] === 'Over limit') over++;
  }
  return { owed: unc(owed), used: unc(used), limit: unc(limit), over, active };
}

/* What each debt still owes. Charges, the opening balance and an upward adjustment are debts; a
   void or refund takes its own sale's charge back; a payment pays the orders it names first and
   the rest pays the oldest debt first. An undone payment counts for nothing. Order-independent,
   so a payment made before a charge (money on account) still pays it. */
function accountDebts(rows) {
  const undone = undoneIds(rows);
  const debts = new Map();
  let pool = 0;
  const pay = (d, n) => { const off = Math.min(n, d.left); d.left -= off; return n - off; };
  const at = salesMath().tsOf;   // a row may carry an ISO time: ms - string is NaN, a scrambled sort
  for (const r of [...rows].sort((a, b) => at(a) - at(b))) {
    if (!counts(r, undone)) continue;
    const k = kindOf(r), n = cent(r.amount);
    const d = debts.get(r.orderId);
    if (k === 'charge' || (LEDGER_SIGN[k] > 0 && n > 0)) {
      const key = r.orderId || r.id;
      const e = debts.get(key) || debts.set(key, { orderId: r.orderId || '', rowId: r.id, kind: k, ts: r.ts, charged: 0, left: 0 }).get(key);
      e.charged += n; e.left += n;
    } else if (k === 'reversal' && d) {
      const back = Math.min(n, d.charged);
      d.charged -= back; d.left -= back;
      if (d.left < 0) { pool -= d.left; d.left = 0; }
      pool += n - back;
    } else {
      let left = Math.abs(n);
      for (const a of r.allocations || []) {
        const want = Math.min(cent(a.amount), left);
        if (debts.has(a.orderId)) left -= want - pay(debts.get(a.orderId), want);
      }
      pool += left;
    }
  }
  const out = [...debts.values()].sort((a, b) => at(a) - at(b));
  for (const d of out) pool = pay(d, pool);
  return out.map((d) => ({ ...d, charged: unc(d.charged), left: unc(d.left),
    status: !d.charged ? 'Reversed' : !d.left ? 'Paid' : d.left < d.charged ? 'Part paid' : 'Unpaid' }));
}
// THE word for a sale on account: what is still owed on it today (Unpaid · Part paid · Paid ·
// Reversed), from that customer's ledger rows; '' when the order was never charged. A receipt
// pill shows it only when it is Unpaid or Part paid. Pass the debts list to look up many orders.
const debtStatusOf = (orderId, rowsOrDebts) => {
  const list = rowsOrDebts || [];
  const debts = list.length && 'left' in list[0] ? list : accountDebts(list);
  return (orderId && (debts.find((d) => d.orderId === orderId) || {}).status) || '';
};

/* THE statement of one account (rows = its ledger rows), newest first: every charge, payment,
   reversal, opening balance and adjustment with the balance after it. from/to are store days
   ('YYYY-MM-DD', `to` included) on the store clock. With a `from`, the balance before it comes
   first as a Brought forward row, so brought forward + Charged - Paid = the last Balance.
   Paid is money received only; a reversal and a downward adjustment net against Charged. An undone
   payment stays, marked Undone, at 0; the rows undoing it are not shown (undoneIds).
   numberOf(orderId) -> receipt number; payWord(row) -> the payment's word. */
function accountStatement(rows, { from = '', to = '', zone = 'Asia/Manila', numberOf = () => '',
  payWord = (r) => r.methodLabel || (r.method ? salesMath().tenderLabel(r.method) : '') } = {}) {
  const SM = salesMath(), at = SM.tsOf;   // a row may carry an ISO time
  const list = [...(rows || [])].sort((a, b) => at(a) - at(b));
  const debts = new Map(accountDebts(list).map((d) => [d.orderId || d.rowId, d]));
  const undone = undoneIds(list);
  const lo = from ? SM.dayStartMs(from, zone) : -Infinity;
  const hi = to ? SM.dayStartMs(SM.addDays(to, 1), zone) : Infinity;
  let bal = 0, before = null;
  const out = [];
  for (const r of list) {
    if (r.reverses) continue;
    const kind = kindOf(r), off = undone.has(r.id), d = off ? 0 : ledgerDelta(r), rec = numberOf(r.orderId);
    bal = round2(bal + d);
    const t = at(r);
    if (t < lo) { before = bal; continue; }
    if (t >= hi) continue;
    const entry = [LEDGER_LABEL[kind], rec ? '#' + rec : '', kind === 'payment' ? payWord(r) : '', kind === 'adjustment' ? r.note : ''].filter(Boolean).join(' · ');
    const debt = d > 0 ? debts.get(r.orderId || r.id) : null;
    out.push({ r, kind, entry, charged: kind === 'payment' ? 0 : d, paid: kind === 'payment' ? -d : 0, balance: bal,
      status: off ? 'Undone' : debt ? debt.status : '' });
  }
  if (before != null) out.unshift({ r: { id: 'forward:' + from, ts: lo - 1 }, kind: 'forward', entry: 'Brought forward',
    charged: 0, paid: 0, balance: before, status: '' });
  return out.reverse();
}

// The one writer for an account (features/customers): every change is a new row, nothing is
// edited. Returns the row, or null when it would not be a real entry.
function postToAccount(customer, type, amount, extra = {}) {
  amount = round2(amount);
  if (!customer || !customer.id || !LEDGER_SIGN[type] || !amount) return null;
  if (amount < 0 && type !== 'opening' && type !== 'adjustment') return null;
  if (type === 'adjustment' && !String(extra.note || '').trim()) return null;   // a correction says why
  const row = stampRow({ id: newId(), ts: Date.now(), orderId: '', note: '', ...extra,
    customerId: customer.id, customerName: customer.name || '', type, amount });
  saveList(STORAGE_CUSTOMER_LEDGER, loadList(STORAGE_CUSTOMER_LEDGER).concat(row));
  return row;
}

// Record payment, four ways in one row (owner 2026-10-02): the full balance or any amount (no
// orders ticked), chosen orders, or part of one. Ticked orders are paid oldest first, each up to
// what it still owes; the rest pays the oldest debts (accountDebts).
function recordPayment(customer, amount, { orderIds = [], ...extra } = {}) {
  const want = new Set(orderIds);
  let left = cent(amount);
  const allocations = [];
  for (const d of accountDebts(accountRows(customer.id))) {
    const n = want.has(d.orderId) ? Math.min(left, cent(d.left)) : 0;
    if (n > 0) { allocations.push({ orderId: d.orderId, amount: unc(n) }); left -= n; }
  }
  return postToAccount(customer, 'payment', amount, allocations.length ? { ...extra, allocations } : extra);
}
// A wrong payment is never deleted: a reversal row names it, and it counts for nothing after.
function undoPayment(row, extra = {}) {
  if (!row || kindOf(row) !== 'payment' || undoneIds(loadCustomerLedger()).has(row.id)) return null;
  return postToAccount({ id: row.customerId, name: row.customerName }, 'reversal', row.amount, { ...extra, reverses: row.id, note: 'Payment undone' });
}

/* Once per device: the stored balances (and the seeded accounts in data.js) become `opening`
   rows, so balance = SUM(ledger) from then on (bug 4: seeded balances had no row and drifted).
   The row id is fixed per customer, so two tills migrating the same account write one row.
   After the marker a stored currentBalance is never read again: a stale tab writing back an old
   record shape would otherwise add its balance a second time. Not while the sales database is
   still opening either: against an empty ledger every balance would count twice. The apps run
   this again when the database is adopted (its storage event). */
const STORAGE_CUSTOMERS_MIGRATED = 'hwpos.customersMigrated.v1';
function migrateCustomers() {
  if (storageGet(STORAGE_CUSTOMERS_MIGRATED, '') || globalThis.HWPOS_STORE?.pending?.()) return;
  const stored = loadList(STORAGE_CUSTOMERS);
  // Demo accounts only on an empty list: never beside a store's real customers (a restored backup).
  const seeds = stored.length || typeof CUSTOMERS === 'undefined' ? [] : CUSTOMERS;
  const todo = stored.filter((c) => !('creditOn' in c)).concat(seeds);
  storageSet(STORAGE_CUSTOMERS_MIGRATED, new Date().toISOString());
  if (!todo.length) return;
  const ledger = loadList(STORAGE_CUSTOMER_LEDGER);
  const bal = balancesOf(ledger), ids = new Set(ledger.map((r) => r.id));
  for (const c of todo) {
    const id = 'opening:' + c.id, open = round2(Number(c.currentBalance || 0) - (bal.get(c.id) || 0));
    // Dated when the record was, and before its first row, so it is the oldest debt.
    const first = Math.min(Date.parse(c.createdAt || c.updatedAt) || Date.now(), ...ledger.filter((r) => r.customerId === c.id).map(salesMath().tsOf));
    if (open && !ids.has(id)) postToAccount(c, 'opening', open, { id, ts: first - 1, note: 'Balance before the app' });
  }
  const fixed = new Map(todo.map((c) => [c.id, normalizeCustomer(c)]));
  saveList(STORAGE_CUSTOMERS, stored.map((c) => fixed.get(c.id) || c).concat(seeds.map((c) => fixed.get(c.id))));
}

/* ---------- Fulfilment ----------
   Three built-ins (owner 2026-10-03): Walk-in is the counter sale and the default; Pickup and
   Delivery are ways of handing over goods bought ahead. Anything else is a type the owner added in
   Settings and is stored in the same `fulfilment` column as its own name. That is why a removed type
   never rewrites past sales -- the order already carries its label, exactly like a custom payment method.
   Only 'delivery' means an address. Rows from before v2 said 'pickup' for the counter sale:
   SalesMath.readOrder / upgradeOrders read those as 'walkin'. */
const FULFIL_BUILTINS = [
  ['walkin', 'Walk-in', 'Always on. The counter sale.'],
  ['pickup', 'Pickup', 'Bought ahead, collected later.'],
  ['delivery', 'Delivery', 'Asks for an address and a map pin.'],
];
// THE word for a row's fulfilment, on every screen, filter, slip and export.
function orderFulfilLabel(order) {
  const f = String((order && order.fulfilment) || 'walkin');
  const b = FULFIL_BUILTINS.find(([k]) => k === f);
  return b ? b[1] : f;
}
// The POS pill list: built-ins the owner kept, then the ones they added.
function fulfilMethods(settings) {
  const cfg = (settings && settings.fulfilment) || {};
  const off = new Set(cfg.hidden || []);
  return FULFIL_BUILTINS
    .filter(([k]) => k === 'walkin' || !off.has(k))
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
  { key: 'folders', head: 'category', alt: ['categories', 'folder'], list: true },   // one or several, | between
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
  { key: 'description', head: 'description' },
  { key: 'hidden', head: 'hidden', bool: true },
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

  // Several categories: the old single `folder` is folded in and stays the first.
  const mc = normalizeProduct({ folder: 'cat_a', folders: ['cat_b', 'cat_a', ''] });
  assert.deepEqual(mc.folders, ['cat_a', 'cat_b']);
  assert.equal(mc.folder, 'cat_a');
  assert.deepEqual(normalizeProduct({ folders: ['cat_b'] }).folder, 'cat_b');
  assert.deepEqual(foldersOf({ folder: 'all' }), []);
  // A blank price is asked at sale: it stays blank (no markup from it); a ₱0 typed on purpose stays 0.
  assert.equal(normalizeProduct({ cost: 50, price: null }).price, null);
  assert.equal(normalizeProduct({ cost: 50, price: '' }).marginValue, 0);
  assert.equal(normalizeProduct({ cost: 50, price: 0 }).price, 0);
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

  // New ids are v4 UUIDs, with or without crypto.randomUUID (a till on plain http has none).
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(newId(), V4);
  const real = globalThis.crypto;
  for (const c of [{ getRandomValues: (b) => real.getRandomValues(b) }, undefined]) {
    Object.defineProperty(globalThis, 'crypto', { value: c, configurable: true });
    assert.match(newId(), V4);
    assert.notEqual(newId(), newId());
  }
  Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });

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
  assert.deepEqual([paginate(nums, 5, DETAIL_ROWS).pages, paginate(nums, 5, DETAIL_ROWS).from], [5, 100]);   // detail pages: 25 a page
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(pageNumbers(2, 12), [1, 2, 3, '…', 12]);   // no gap of one page

  // A save logs only what moved: an unchanged product writes nothing, a new one its first price.
  const logged = priceChanges([{ id: 'a', price: 300, cost: 250 }], [{ id: 'a', price: 325, cost: 250 }, { id: 'n', price: 5, cost: 0 }]);
  assert.deepEqual(logged.map((r) => [r.productId, r.field, r.old, r.new]), [['a', 'price', 300, 325], ['n', 'price', null, 5]]);
  assert.equal(makeMovement({ productId: 'p', qty: -3, reason: 'count', expected: 40, counted: 37 }).counted, 37);

  // A custom type is its own label, and an order keeps that label after the type is removed.
  assert.equal(orderFulfilLabel({}), 'Walk-in');
  assert.equal(orderFulfilLabel({ fulfilment: 'walkin' }), 'Walk-in');
  assert.equal(orderFulfilLabel({ fulfilment: 'pickup' }), 'Pickup');
  assert.equal(orderFulfilLabel({ fulfilment: 'delivery' }), 'Delivery');
  assert.equal(orderFulfilLabel({ fulfilment: 'Tricycle' }), 'Tricycle');
  assert.deepEqual(fulfilMethods({ fulfilment: { hidden: ['delivery'], custom: ['Tricycle'] } }).map((m) => m.key),
    ['walkin', 'pickup', 'Tricycle']);
  assert.deepEqual(fulfilMethods({ fulfilment: { hidden: ['walkin', 'pickup'] } }).map((m) => m.key), ['walkin', 'delivery']);

  // Dead is 90 days since the last sale, or since the first movement when it never sold.
  const day = 86400000, t0 = Date.parse('2026-01-01T00:00:00Z');
  const clk = saleClock([{ productId: 'd', reason: 'delivery', ts: '2026-01-01T00:00:00Z' },
    { productId: 's', reason: 'delivery', ts: '2026-01-01T00:00:00Z' }, { productId: 's', reason: 'sale', ts: '2026-03-01T00:00:00Z' }]);
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'dead');
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, clk.get('s'), t0 + 90 * day), 'ok');
  assert.equal(stockLevel({ stock: 5, reorderPoint: 1 }, undefined, t0), 'ok');   // no history, no verdict
  assert.equal(stockLevel({ stock: 0, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'out');
  assert.equal(stockLevel({ stock: 1, reorderPoint: 1 }, clk.get('d'), t0 + 90 * day), 'low');

  // An account: the balance is the ledger; a payment pays the order it names, the rest the oldest.
  const acct = [
    { id: 'o', ts: 1, customerId: 'k', type: 'opening', amount: 100 },
    { id: 'c1', ts: 2, customerId: 'k', type: 'charge', amount: 300, orderId: 's1' },
    { id: 'c2', ts: 3, customerId: 'k', type: 'charge', amount: 200, orderId: 's2' },
    { id: 'p1', ts: 4, customerId: 'k', type: 'payment', amount: 150, allocations: [{ orderId: 's2', amount: 150 }] },
    { id: 'p2', ts: 5, customerId: 'k', type: 'payment', amount: 120 },
    { id: 'old', ts: 6, customerId: 'k', type: 'payment', amount: 50, orderId: 's1' },   // a legacy reversal
  ];
  assert.equal(balancesOf(acct).get('k'), 280);
  assert.deepEqual(accountDebts(acct).map((d) => [d.orderId, d.left, d.status]),
    [['', 0, 'Paid'], ['s1', 230, 'Part paid'], ['s2', 50, 'Part paid']]);
  const undo = acct.concat({ id: 'u', ts: 7, customerId: 'k', type: 'reversal', amount: 120, reverses: 'p2' });
  assert.equal(balancesOf(undo).get('k'), 400);
  assert.deepEqual(accountDebts(undo).map((d) => d.left), [100, 250, 50]);
  assert.equal(normalizeCustomer({ creditLimit: 0, currentBalance: 0 }).creditOn, false);   // a till-made record
  assert.deepEqual([normalizeCustomer({ creditLimit: 0, currentBalance: 5 }).creditOn, normalizeCustomer({ creditLimit: 0 }).creditLimit], [true, null]);
  assert.equal(customerFromForm({ name: ' ', creditLimit: '' }).field, 'name');
  assert.equal(customerFromForm({ name: 'A', creditLimit: '0' }).field, 'creditLimit');
  assert.deepEqual(customerFromForm({ name: 'A', creditOn: 'on', creditLimit: '' }).customer.creditLimit, null);
  assert.deepEqual(['+63 917 555 0142', '0917-555-0142', '9175550142'].map(phoneKey), Array(3).fill('9175550142'));   // one number
  assert.equal(accountStatus({ currentBalance: 600, creditOn: true, creditLimit: 500 })[1], 'Over limit');
  assert.equal(accountStatus({ ...normalizeCustomer({ creditOn: false, creditLimit: 500 }), currentBalance: 600 })[1], 'Active');   // credit off: no limit to be over
  const twice = undo.concat({ id: 'u2', ts: 8, customerId: 'k', type: 'reversal', amount: 120, reverses: 'p2' });   // two tills undid it
  assert.equal(balancesOf(twice).get('k'), 400);
  assert.equal(accountStatus({ currentBalance: 600, creditLimit: null })[1], 'Active');

  // One formula per number (number map 2026-10-02).
  // Stock value: negative stock is 0, untracked and archived are out.
  const shelf = [{ id: 'a', cost: 10, stock: 5 }, { id: 'b', cost: 10, stock: -3 }, { id: 'c', cost: 10, stock: 9, archived: true },
    { id: 'd', cost: 10, stock: 4, trackStock: false }];
  assert.deepEqual([stockValue(shelf[1]), stockValue(shelf[3]), stockValueOf(shelf)], [0, 0, 50]);
  // The family: one size out, one with 50 → Low on every screen; all out → Out. Counted once per item.
  const fam = [{ id: 'v1', groupId: 'g', stock: 0, reorderPoint: 2 }, { id: 'v2', groupId: 'g', stock: 50, reorderPoint: 2 }];
  assert.deepEqual([familyLevel(fam, new Map()), familyLevel([fam[0]], new Map()), familyLevel([], new Map())], ['low', 'out', 'out']);
  assert.deepEqual(stockCounts([...fam, { id: 'x', stock: 0, reorderPoint: 1 }, { id: 'y', stock: 0, archived: true }], new Map()),
    { out: 1, low: 1, dead: 0, ok: 0 });
  // Loss: short counts are lost too; an over count and an opening row are not.
  assert.deepEqual([{ reason: 'damage', qty: -1 }, { reason: 'count', qty: -2 }, { reason: 'count', qty: 2 }, { reason: 'opening', qty: 5 }].map(isLoss),
    [true, true, false, false]);
  // movedAt: a back-dated delivery lands at store-local noon of its day; a same-day row keeps its time.
  assert.equal(movedAt({ ts: '2026-10-02T02:00:00Z', happenedOn: '2026-09-30' }), Date.UTC(2026, 8, 30, 4));
  assert.equal(movedAt({ ts: '2026-10-01T23:00:00Z', happenedOn: '2026-10-02' }), Date.UTC(2026, 9, 1, 23));   // 7 AM Manila, same day
  // Last sold skips a sale whose goods came back.
  const sc = saleClock([{ productId: 'p', reason: 'sale', refId: 'o1', ts: '2026-01-01T00:00:00Z' },
    { productId: 'p', reason: 'sale', refId: 'o2', ts: '2026-03-01T00:00:00Z' },
    { productId: 'p', reason: 'return', refId: 'o2', ts: '2026-03-01T01:00:00Z' }]);
  assert.equal(sc.get('p').lastSale, Date.parse('2026-01-01T00:00:00Z'));
  // On order: sent lists only, like Incoming.
  const pos = [{ status: 'draft', items: [{ productId: 'p', qty: 5, receivedQty: 0 }] },
    { status: 'ordered', sentAt: 'x', items: [{ productId: 'p', qty: 3, receivedQty: 1 }] }];
  assert.equal(onOrderQty(pos).get('p'), 2);
  // The stock rule: opening rows make the log add up to the cache, once.
  const log = [{ id: 'm1', productId: 'a', qty: -2, reason: 'sale' }];
  const open = openingRows([{ id: 'a', stock: 5 }, { id: 'z', stock: 0 }], log);
  assert.deepEqual(open.map((r) => [r.id, r.qty, r.reason]), [['opening:a', 7, 'opening']]);
  assert.equal(stockOnHand(log.concat(open)).get('a'), 5);
  assert.equal(openingRows([{ id: 'a', stock: 5 }], log.concat(open)).length, 0);
  // withStock: a stale saved count is ignored, the log decides (and z, never moved, is 0).
  assert.deepEqual(withStock([{ id: 'a', stock: 99 }, { id: 'z', stock: 3 }], log.concat(open)).map((p) => p.stock), [5, 0]);
  const rb =runningBalances(open.concat(log), () => 5).balance;   // opening rows go FIRST: the log starts there
  assert.deepEqual([rb.get('opening:a'), rb.get('m1')], [7, 5]);
  assert.equal(categoryOf({ folder: 'Plumbing', folders: ['Plumbing', 'Tools'] }), 'Plumbing');
  // Debt word: the ledger's, and ISO times sort like ms.
  const led = [{ id: 'c', ts: '2026-10-01T00:00:00Z', customerId: 'k', type: 'charge', orderId: 'o9', amount: 100 },
    { id: 'p', ts: Date.parse('2026-10-02T00:00:00Z'), customerId: 'k', type: 'payment', amount: 40 }];
  assert.deepEqual([debtStatusOf('o9', led), debtStatusOf('o9', accountDebts(led)), debtStatusOf('nope', led)], ['Part paid', 'Part paid', '']);

  // Fix round 1 (2026-10-03).
  // PO money: what came at the bill, what is still to come at the quote; billed so far apart.
  const bill = { status: 'partial', sentAt: 'x', items: [{ productId: 'p', qty: 10, cost: 100, receivedQty: 4, invoiceCost: 120 }] };
  assert.deepEqual([poTotal(bill), poOpenValue(bill)], [1080, 600]);
  assert.equal(poTotal({ items: [{ qty: 3, cost: 50, receivedQty: 0, invoiceCost: null }] }), 150);
  // Movements: epoch ts, a staff id; the product's updatedAt stays ISO.
  const mvS = makeMovement({ productId: 'p', qty: 1, reason: 'count', staffId: 'u1', staff: 'Ana' });
  assert.ok(typeof mvS.ts === 'number' && mvS.staffId === 'u1' && mvS.staff === 'Ana');
  assert.equal(typeof applyMovement({ id: 'p', stock: 0 }, mvS).updatedAt, 'string');
  // receivePo stamps who received it; a back-dated receive is store noon of that day.
  const rcv = { id: 'po', status: 'ordered', sentAt: 'x', items: [{ id: 'l1', productId: 'p', qty: 2, cost: 5, receivedQty: 0 }] };
  const rmv = receivePo(rcv, { l1: 2 }, '2026-08-01', null, { staffId: 'u2', zone: 'Asia/Manila' });
  assert.deepEqual([rmv[0].staffId, rcv.receivedAt], ['u2', '2026-08-01T04:00:00.000Z']);
  // Last sold: a refunded sale still sold (orders given); a voided one did not.
  const clockMv = [{ productId: 'p', reason: 'sale', refId: 'o1', ts: Date.UTC(2026, 0, 1) },
    { productId: 'p', reason: 'sale', refId: 'o2', ts: Date.UTC(2026, 2, 1) },
    { productId: 'p', reason: 'return', refId: 'o2', ts: Date.UTC(2026, 2, 1, 1) },
    { productId: 'p', reason: 'sale', refId: 'o3', ts: Date.UTC(2026, 3, 1) },
    { productId: 'p', reason: 'return', refId: 'o3', ts: Date.UTC(2026, 3, 1, 1) }];
  const clockOrders = [{ id: 'r2', status: 'refund', originalOrderId: 'o2' }, { id: 'v3', status: 'void', originalOrderId: 'o3' }];
  assert.equal(saleClock(clockMv, 'Asia/Manila', clockOrders).get('p').lastSale, Date.UTC(2026, 2, 1));
  // familyRows: one row per out/low family, the group's name, the family's stock.
  const famRows = familyRows([...fam, { id: 'x', name: 'Nail', stock: 0, reorderPoint: 1 }, { id: 'ok', stock: 9, reorderPoint: 1 }],
    [{ id: 'g', name: 'Paint' }], new Map());
  assert.deepEqual(famRows.map((r) => [r.id, r.name, r.level, r.stock]), [['x', 'Nail', 'out', 0], ['g', 'Paint', 'low', 50]]);
  // Credit: In credit below zero; room capped at the limit; the strip in one pass.
  assert.deepEqual(accountStatus({ currentBalance: -15, creditOn: true, creditLimit: 3000 }), ['info', 'In credit']);
  assert.deepEqual([creditRoom({ creditOn: true, creditLimit: 3000, currentBalance: -15 }), creditRoom({ creditOn: true, creditLimit: 3000, currentBalance: 3500 }),
    creditRoom({ creditOn: true, creditLimit: 0 }), creditRoom({ creditOn: false, creditLimit: 3000 }), creditRoom({ creditOn: true, creditLimit: 1000, currentBalance: 250.5 })],
    [3000, 0, Infinity, 0, 749.5]);
  assert.deepEqual(creditPool([{ currentBalance: 0.1, creditLimit: 1, creditOn: true }, { currentBalance: 0.2, creditLimit: 0.2 }, { currentBalance: -5 }]),
    { owed: 0.3, used: 0.3, limit: 1.2, over: 0, active: 2 });
  // Statement: a From date brings the earlier balance forward, so forward + charged - paid = balance.
  const stLed = [{ id: 's1', ts: Date.UTC(2026, 8, 20, 2), type: 'charge', orderId: 'o1', amount: 1000 },
    { id: 's2', ts: Date.UTC(2026, 8, 30, 2), type: 'payment', amount: 400, method: 'cash' }];
  const st = accountStatement(stLed, { from: '2026-09-30', numberOf: (id) => (id === 'o1' ? '1-001' : '') });
  assert.deepEqual(st.map((x) => [x.kind, x.charged, x.paid, x.balance, x.entry]),
    [['payment', 0, 400, 600, 'Payment · Cash'], ['forward', 0, 0, 1000, 'Brought forward']]);
  assert.deepEqual(accountStatement(stLed, { to: '2026-09-29' }).map((x) => x.balance), [1000]);
  assert.equal(accountStatement(stLed)[1].entry, 'Charge');
  assert.equal(accountStatement(stLed, { from: '2026-09-20' }).length, 2, 'nothing before: no forward row');
  // Stock flow: a void's return nets against Went out and against Sale.
  const flowMv = [{ productId: 'a', qty: 10, reason: 'delivery', unitCost: 50, ts: Date.UTC(2026, 8, 20, 2) },
    { productId: 'a', qty: -3, reason: 'sale', refId: 's', unitCost: 50, ts: Date.UTC(2026, 8, 20, 3) },
    { productId: 'a', qty: 3, reason: 'return', refId: 's', unitCost: 50, ts: Date.UTC(2026, 8, 20, 4) },
    { productId: 'a', qty: -1, reason: 'damage', ts: Date.UTC(2026, 8, 20, 5) }];
  const flow = stockFlow(flowMv, () => 40, [Date.UTC(2026, 8, 19), Date.UTC(2026, 8, 21)]);
  assert.deepEqual([flow.in, flow.out, flow.lost, flow.why.map((w) => w.reason)], [500, 40, 40, ['damage']]);
  // Lot walk: a refund puts units back in the lot they left; the opening lot is older than the log.
  const lw = lotWalk([{ id: 'op', productId: 'a', qty: 2, reason: 'opening', ts: 0 },
    { id: 'd1', productId: 'a', qty: 4, reason: 'delivery', ts: Date.UTC(2026, 8, 1) },
    { productId: 'a', qty: -3, reason: 'sale', refId: 's1', ts: Date.UTC(2026, 8, 2) },
    { productId: 'a', qty: 3, reason: 'return', refId: 's1', ts: Date.UTC(2026, 8, 3) },
    { productId: 'a', qty: -1, reason: 'damage', ts: Date.UTC(2026, 8, 4) }], [{ id: 'a', stock: 5 }, { id: 'b', stock: 3 }]).get('a');
  assert.deepEqual(lw.map((l) => [l.m.id, l.at, l.left, l.sold, l.otherOut]), [['op', null, 1, 0, 1], ['d1', Date.UTC(2026, 8, 1), 4, 0, 0]]);
  assert.deepEqual(lotWalk([], [{ id: 'b', stock: 3 }]).get('b').map((l) => [l.m, l.left]), [[null, 3]]);

  // Fix round 1b: every key here is data-store's (KEYS), name for name.
  const dsText = require('fs').readFileSync(require('path').join(__dirname, 'data-store.js'), 'utf8');
  for (const [name, key] of Object.entries({ suppliers: STORAGE_SUPPLIERS, purchaseOrders: STORAGE_PURCHASE_ORDERS,
    stockMovements: STORAGE_STOCK_MOVEMENTS, staff: STORAGE_STAFF, modifiers: STORAGE_MODIFIERS, discounts: STORAGE_DISCOUNTS, tillPerms: STORAGE_TILL_PERMS, ...EVENT_LOGS })) {
    assert.ok(new RegExp(`\\b${name}:\\s*'${key.replace(/\./g, '\\.')}'`).test(dsText), `data-store KEYS.${name} is ${key}`);
  }
  // Big discounts (2026-10-09): a map saved before `discount` gives a manager its default (on), 20%; a map saved since keeps what it says.
  const tp = (raw) => { const p = loadTillPerms(raw); return [p.manager.includes('discount'), p.cashier.includes('discount'), p.discountLimit]; };
  assert.deepEqual([tp({}), tp({ manager: ['void'], cashier: [] }), tp({ manager: ['void'], cashier: [], discountLimit: null }), tp({ cashier: ['discount'], discountLimit: 30 })],
    [[true, false, 20], [true, false, 20], [false, false, null], [true, true, 30]]);
  // Shifts (2026-10-10): a map with no `known` list gives a manager `shift`; one saved since keeps what it says.
  const sp = (raw) => { const p = loadTillPerms(raw); return [p.manager.includes('shift'), p.cashier.includes('shift')]; };
  assert.deepEqual([sp({}), sp({ manager: ['void'], cashier: [], discountLimit: 20 }),
    sp({ manager: ['void'], cashier: [], discountLimit: 20, known: Object.keys(TILL_ACTIONS) }), sp({ ...loadTillPerms({}), cashier: ['shift'], known: Object.keys(TILL_ACTIONS) })],
    [[true, false], [true, false], [false, false], [true, true]]);
  // saveList gives a record without one the store's id, and leaves updatedAt alone.
  const saved = new Map();
  globalThis.storageSet = (k, v) => saved.set(k, v);
  globalThis.HWPOS_STORE = { readSettings: () => ({ store: { id: 'st1' } }) };
  saveList('k', [{ id: 'a', updatedAt: 'x' }, { id: 'b', storeId: 'other' }]);
  assert.deepEqual(JSON.parse(saved.get('k')), [{ id: 'a', updatedAt: 'x', storeId: 'st1' }, { id: 'b', storeId: 'other' }]);
  delete globalThis.HWPOS_STORE; delete globalThis.storageSet;

  // Fix round 2 (2026-10-03).
  // Dead counts store days: 11 PM Manila 90 days before is dead at 1 AM, though only 89 days and 2 hours passed.
  const dz = Date.UTC(2026, 0, 1, 15), dnow = Date.UTC(2026, 3, 1, 17);   // Jan 1 23:00 → Apr 2 01:00 Manila
  assert.equal(salesMath().daysAgo(dz, dnow), 91);
  assert.deepEqual([stockLevel({ stock: 5, reorderPoint: 1 }, { first: dz }, dnow - 86400000), stockLevel({ stock: 5, reorderPoint: 1 }, { first: dz }, dnow - 2 * 86400000)], ['dead', 'ok']);
  // Stock flow: a same-day void's return sits in its sale's hour; shares are of what is shown, so they add to 1.
  const hr = (h) => Date.UTC(2026, 8, 20, h - 8);   // h o'clock Manila
  const hourMv = [{ productId: 'a', qty: -2, reason: 'sale', refId: 'v', unitCost: 10, ts: hr(9) },
    { productId: 'a', qty: 2, reason: 'return', refId: 'v', unitCost: 10, ts: hr(14) },
    { productId: 'a', qty: -1, reason: 'sale', refId: 'k', unitCost: 10, ts: hr(10) },
    { productId: 'a', qty: -1, reason: 'damage', unitCost: 10, ts: hr(11) }];
  const hf = stockFlow(hourMv, () => 0, [hr(0), hr(24)], (ms) => salesMath().dateParts(ms).hour);
  assert.deepEqual([hf.buckets.get(9).out, hf.buckets.has(14), hf.out], [0, false, 20]);
  // A return whose sale is before the window: Sale nets below 0 and is not shown; Damage was 200% of out.
  const early = [{ productId: 'a', qty: 2, reason: 'return', refId: 'x', unitCost: 10, ts: hr(9) }, hourMv[2], { ...hourMv[3], qty: -2 }];
  const ef = stockFlow(early, () => 0, [hr(0), hr(24)]);
  assert.deepEqual([ef.out, ef.why.map((w) => [w.reason, w.share])], [10, [['damage', 1]]]);
  // PO line unit: the quote, then the blend; units × unit reads as the line total.
  assert.deepEqual([poLineUnit({ qty: 10, cost: 100, receivedQty: 4, invoiceCost: 120 }), poLineUnit({ qty: 3, cost: 50, receivedQty: 0 }),
    poLineUnit({ qty: 0, cost: 50, invoiceCost: 60 })], [108, 50, 60]);
  // Credit gate: money held for them covers a charge; an account already over has all of it past.
  const gate = (bal, charge, extra = {}) => creditOverBy({ creditOn: true, creditLimit: 3000, currentBalance: bal, ...extra }, charge);
  assert.deepEqual([gate(-15, 3010), gate(-15, 3020), gate(3500, 100), gate(2900, 250.5), gate(0, 0), gate(0, 50, { creditOn: false }), gate(9e9, 50, { creditLimit: null })],
    [0, 5, 600, 150.5, 0, 50, 0]);
  assert.deepEqual(creditPool([{ currentBalance: 500, creditLimit: 1000, creditOn: true }, { currentBalance: 700, creditOn: true, creditLimit: null }]),
    { owed: 1200, used: 500, limit: 1000, over: 0, active: 2 });
  // Staff: an id reads as a name, never as itself; a name back to its id.
  const crew = [{ id: 'u1', name: 'Ana' }, { id: 'u2', name: 'Ben' }];
  assert.deepEqual([staffNameOf('u2', crew), staffNameOf('gone', crew), staffNameOf('', crew), staffIdOf('Ana', crew), staffIdOf('Zed', crew)],
    ['Ben', '', '', 'u1', '']);

  // Fix round 2b (2026-10-03).
  // Latest event: an old ISO row loses to a newer ms row (as text it won); a tie goes to the later row.
  const trip = latestEvents([{ orderId: 'o1', event: 'dispatched', ts: '2026-09-30T02:00:00.000Z' },
    { orderId: 'o1', event: 'arrived', ts: Date.parse('2026-10-01T00:00:00Z') }, { orderId: 'o2', event: 'a', ts: 5 }, { orderId: 'o2', event: 'b', ts: 5 }]);
  assert.deepEqual([trip.get('o1').event, trip.get('o2').event], ['arrived', 'b']);
  // familyRows keeps the members' ids, and the sku of a family of one.
  const skuRows = familyRows([...fam, { id: 'x', sku: 'N1', stock: 0, reorderPoint: 1 }], [{ id: 'g', name: 'Paint' }], new Map());
  assert.deepEqual(skuRows.map((r) => [r.id, r.sku, r.productIds]), [['x', 'N1', ['x']], ['g', '', ['v1', 'v2']]]);
  // The status filter lists every word accountStatus gives.
  for (const bal of [-1, 0, 10, 50, 80, 120]) assert.ok(ACCOUNT_STATUSES.includes(accountStatus({ currentBalance: bal, creditOn: true, creditLimit: 100 })[1]), String(bal));
  assert.deepEqual([canRecordPayment({ id: 'k', currentBalance: 0 }), canRecordPayment(null)], [true, false]);
  const pm = (n) => 'P' + n.toFixed(2);
  assert.deepEqual([owedText(120, pm), owedText(-15, pm), owedText(0.001, pm), owedText(undefined, pm)],
    ['owes P120.00', 'has P15.00 in credit', 'owes nothing', 'owes nothing']);

  // Fix round 3 (2026-10-03).
  // A PO line prices each delivery at its own bill: 4 @ 120, then 3 with the bill blank (= the quote),
  // 3 still to come at the quote -- 480 + 300 + 300, the movements' 780 plus the 300 to come.
  const tl = { id: 'l', productId: 'p', qty: 10, cost: 100, receivedQty: 0 }, tpo = { id: 'po', items: [tl] };
  const tmv = [...receivePo(tpo, { l: { qty: 4, unitCost: 120 } }), ...receivePo(tpo, { l: 3 })];
  assert.deepEqual([poLineTotal(tl), tmv.reduce((s, m) => s + movementCents(m.qty, m.unitCost), 0), tl.invoiceCost], [1080, 78000, 120]);
  // Two bills, two prices: 4 @ 120 + 3 @ 130 + 3 @ 100 -- not all seven at the latest 130.
  const t2 = { id: 'l', productId: 'p', qty: 10, cost: 100, receivedQty: 0 };
  receivePo({ items: [t2] }, { l: { qty: 4, unitCost: 120 } }); receivePo({ items: [t2] }, { l: { qty: 3, unitCost: 130 } });
  assert.deepEqual([poLineTotal(t2), poLineQty(t2), poLineUnit(t2)], [1170, 10, 117]);
  // Over-shipped: 12 came on an order of 10, so the row reads 12 × 120 = 1,440.
  const t3 = { id: 'l', productId: 'p', qty: 10, cost: 100, receivedQty: 0 };
  receivePo({ items: [t3] }, { l: { qty: 12, unitCost: 120 } });
  assert.deepEqual([poLineQty(t3), poLineUnit(t3), poLineTotal(t3), round2(poLineQty(t3) * poLineUnit(t3))], [12, 120, 1440, 1440]);
  // A line received before receivedCost existed keeps its old money (received at its bill) and builds on it.
  const t4 = { id: 'l', productId: 'p', qty: 10, cost: 100, receivedQty: 4, invoiceCost: 120 };
  assert.equal(poLineTotal(t4), 1080);
  receivePo({ items: [t4] }, { l: { qty: 2, unitCost: 130 } });
  assert.deepEqual([t4.receivedCost, poLineTotal(t4)], [740, 1140]);
  // Credit gate: the whole amount over, not capped at the charge (570 owed, 100 limit, +50 → 520 over).
  assert.equal(creditOverBy({ creditOn: true, creditLimit: 100, currentBalance: 570 }, 50), 520);
  // Dead in the store's zone: 90 store days in Manila, 89 in Los Angeles, through the family and the tiles.
  const zp = [{ id: 'z', stock: 5, reorderPoint: 1 }], zc = new Map([['z', { first: dz }]]), zn = dnow - 86400000;
  assert.deepEqual([familyLevel(zp, zc, zn), familyLevel(zp, zc, zn, 'America/Los_Angeles'),
    stockCounts(zp, zc, zn).dead, stockCounts(zp, zc, zn, 'America/Los_Angeles').dead], ['dead', 'ok', 1, 0]);

  console.log('bo-model: ok');
}

if (typeof module !== 'undefined') {
  module.exports = {
    cent, unc, round2, priceFromMargin, marginFromPrice,
    normalizeProduct, PRODUCT_DEFAULTS, PRODUCT_COLUMNS, productToCsvRow, productFromCsvRow,
    supplierIdsOf, foldersOf,
    makeMovement, applyMovement, isLow, stockValue, roundQty, stepFor, newId,
    DEAD_DAYS, STOCK_LEVEL, saleClock, stockLevel,
    stockValueOf, onHandOf, stockOnHand, withStock, openingRows, runningBalances, isLoss, movedAt, categoryOf, familyLevel, stockCounts, debtStatusOf,
    groupOf, variantsOf, imageFor,
    PO_DEFAULTS, PO_STATUS, PO_INCOMING, poLine, poTotal, poLineTotal, billedCost, poOutstanding, receivePo,
    lineSupplier, lineOut, deliverySupplier, poStatus, poOpenValue, onOrderQty, loadPurchaseOrders, savePurchaseOrders,
    SUPPLIER_DEFAULTS, STAFF_DEFAULTS, STAFF_ROLES, STOCK_REASONS, SOLD_BY, MARGIN_MODES,
    GROUP_DEFAULTS, SEED_STAFF, TILL_ACTIONS, loadTillPerms, roleCan, isPin, staffByPin, approverFor, PAGE_ROWS, DETAIL_ROWS, paginate, pageNumbers,
    EVENT_LOGS, makeEvent, priceChanges, latestEvents,
    FULFIL_BUILTINS, orderFulfilLabel, fulfilMethods,
    CUSTOMER_FIELDS, normalizeCustomer, customerFromForm, phoneKey, phoneOwnerNote, LEDGER_SIGN, LEDGER_LABEL, kindOf, ledgerDelta, undoneIds,
    balancesOf, accountDebts, accountStatus, ACCOUNT_STATUSES, canRecordPayment, owedText, recordPayment, undoPayment,
    poLineUnit, poLineQty, movementCents, familyRows, creditRoom, creditOverBy, creditPool, accountStatement, stockFlow, lotWalk, limitText,
    staffNameOf, staffIdOf,
  };
}
