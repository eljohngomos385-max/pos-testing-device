/* Dev only. A year of trading, written straight into the same localStorage the app reads.
   Load it in the back office (or the POS) and call seedYear().

     fetch('/scripts/seed-year.js').then(r => r.text()).then(eval); seedYear();

   It is not a test — the tests are scripts/*-check.mjs and scripts/sim-year.mjs. This exists
   so the pages can be USED: a year of sales to filter, stock that actually moved, purchase
   orders that were half received, and staff who turned up late. Deterministic (seeded PRNG),
   so a bug found on this data can be found again.

   ponytail: it leans on the globals bo-model.js and backoffice.js already define rather than
   re-deriving money, movements or PO maths. If it disagrees with the app, the app wins. */
// `busy` scales the daily order count. A full year at busy=1 is ~4,200 orders, which is
// ~4 MB of localStorage -- past what Chrome gives one origin, so the till then refuses to
// record the next sale. Keep the year, turn the volume down, until the D1 store lands.
function seedYear(days = 365, busy = 0.55) {
  let seed = 20260908;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const round2 = (n) => Math.round(n * 100) / 100;

  const END = new Date(); END.setHours(0, 0, 0, 0);
  const dayTs = (i) => { const d = new Date(END); d.setDate(d.getDate() - (days - 1 - i)); return d; };
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ---- Suppliers -----------------------------------------------------------
  const suppliers = [
    { id: 'sup_ace', name: 'Ace Steel & Hardware', contact: 'Rowena Cruz', phone: '0917 555 0142', email: 'orders@acesteel.ph', address: 'Km 12 Maharlika Hwy, Cabanatuan', note: 'Rebar and tie wire. Delivers Tuesdays.' },
    { id: 'sup_boy', name: 'Boysen Depot Central', contact: 'Mark Villanueva', phone: '0918 555 0777', email: 'central@boysendepot.ph', address: '88 Quezon Ave, Cabanatuan', note: 'Paint. 30-day terms.' },
    { id: 'sup_pvc', name: 'Atlanta Plastics', contact: 'Jing Robles', phone: '0920 555 0311', email: 'sales@atlantaplastics.ph', address: 'Bgy. Sumacab, Cabanatuan', note: 'PVC pipe and fittings.' },
    { id: 'sup_gen', name: 'Metro Builders Supply', contact: 'Danny Ong', phone: '0905 555 0980', email: 'metrobuilders@gmail.com', address: 'Maharlika Hwy, San Leonardo', note: 'Everything else. Cash on delivery.' },
  ].map((s) => ({ ...SUPPLIER_DEFAULTS, ...s }));

  // ---- Products: keep the seed catalog, give it cost, margin and a supplier --
  const products = loadProducts().map((raw, i) => {
    const p = normalizeProduct(raw);
    p.supplierId = /paint|boysen/i.test(p.name) ? 'sup_boy'
      : /pvc|pipe|elbow|tee/i.test(p.name) ? 'sup_pvc'
      : /rebar|wire|steel|nail/i.test(p.name) ? 'sup_ace' : 'sup_gen';
    if (!p.cost) p.cost = round2(p.price * (0.62 + rnd() * 0.18));
    // Half the catalog is priced off a percentage, half off a flat peso margin. Both have to
    // survive a year of cost changes, so both need to exist in the data.
    if (i % 2 === 0) { p.marginMode = 'percent'; p.marginValue = round2(20 + rnd() * 25); }
    else { p.marginMode = 'flat'; p.marginValue = round2(p.price - p.cost); }
    p.price = priceFromMargin(p.cost, p.marginMode, p.marginValue);
    if (!p.reorderPoint) p.reorderPoint = between(5, 30);
    p.stock = 0;                       // rebuilt below from the movement log
    return p;
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const staff = loadStaff();
  const cashiers = staff.filter((u) => u.active !== false).map((u) => u.name);
  const customers = (typeof CUSTOMERS !== 'undefined' ? CUSTOMERS : []).slice(0, 8);

  const movements = [];
  // The shelf, carried forward as the year is written. Nothing may be sold that is not on it:
  // every product here has `sellOutOfStock: false`, so a real till would refuse, and a seed
  // that ignores that produces a shop the app itself could never have reached.
  const onHand = new Map();
  const stockOf = (id) => onHand.get(id) || 0;
  const move = (ts, productId, qty, reason, refId, note, who) => {
    const m = makeMovement({ productId, qty, reason, refId, note, unitCost: byId.get(productId)?.cost || 0, staff: who });
    m.ts = ts.toISOString();
    m.id = newId('mv');
    movements.push(m);
    onHand.set(productId, round2(stockOf(productId) + qty));
  };

  // ---- Opening stock: one count, a year ago -------------------------------
  const open = dayTs(0);
  products.forEach((p) => move(open, p.id, between(40, 260), 'count', '', 'Opening count', 'El John'));

  // ---- Buying, driven by the shelf ----------------------------------------
  // Weekly, per supplier, and only the lines that are actually low -- the old version bought
  // the first few lines of one rotating supplier, so two thirds of the catalog never got
  // restocked at all and sold hundreds of units into negative. Ordering up to `reorderPoint * 6`
  // is the same rule the year harness uses, so the two agree about what "low" means.
  // Receipt numbers must be in the format app.js actually emits (`<register>-<seq3>`), or the
  // first real sale after a seed cannot recover the sequence from history and the back office
  // shows two different number formats in one column.
  const receiptNo = () => '1-' + String(num++).padStart(3, '0');

  const pos = [];
  const arriving = [];              // deliveries in transit, landed on the day they arrive
  let poNum = 1;

  function orderStock(d, day) {
    for (const sup of suppliers) {
      const low = products.filter((p) => p.supplierId === sup.id && stockOf(p.id) < p.reorderPoint * 2);
      if (!low.length) continue;
      const chosen = low.slice(0, 6);
      const po = {
        ...PO_DEFAULTS,
        id: newId('po'), supplierId: sup.id,
        number: 'PO-' + String(poNum++).padStart(4, '0'),
        orderedAt: iso(day),
        expectedAt: iso(new Date(day.getTime() + 5 * 864e5)),
        note: '',
        status: 'ordered',
        items: chosen.map((p) => poLine(p.id, Math.max(40, p.reorderPoint * 6) - stockOf(p.id), p.cost)),
        updatedAt: day.toISOString(),
      };
      pos.push(po);
      // Anything ordered in the last ten days is still on its way -- that is what fills the
      // dashboard's "Deliveries coming" card.
      if (days - d > 10) arriving.push({ on: d + between(3, 9), po, short: rnd() < 0.15, chosen });
    }
  }

  function landDeliveries(d, day) {
    for (let i = arriving.length - 1; i >= 0; i--) {
      if (arriving[i].on !== d) continue;
      const { po, short, chosen } = arriving.splice(i, 1)[0];
      const arrive = new Date(day); arrive.setHours(between(9, 15), between(0, 59), 0, 0);
      const recv = {};
      // Every so often a supplier short-ships, which is what leaves a PO `partial`.
      po.items.forEach((l, n) => {
        const owed = l.qty - (Number(l.receivedQty) || 0);
        recv[l.id] = short && n === 0 ? Math.floor(owed * 0.6) : owed;
      });
      receivePo(po, recv).forEach((m) => {
        m.staff = pick(cashiers);
        move(arrive, m.productId, m.qty, m.reason, m.refId, m.note, m.staff);
      });
      po.receivedAt = po.status === 'received' ? iso(arrive) : '';
      // A short-ship is a backorder, not an abandoned PO -- the supplier sends the rest a few days
      // later. Without this every `partial` stayed open for the rest of the year and the dashboard's
      // "Deliveries coming" filled with year-old overdue lines instead of what is actually arriving.
      if (po.status === 'partial' && d + 4 < days) arriving.push({ on: d + between(2, 4), po, short: false, chosen });
      // A supplier re-prices now and then. The movement above already banked the OLD cost,
      // which is the whole reason unit_cost lives on the movement.
      if (rnd() < 0.2) chosen.forEach((p) => {
        p.cost = round2(p.cost * (1 + rnd() * 0.12));
        p.price = priceFromMargin(p.cost, p.marginMode, p.marginValue);
      });
    }
  }

  // ---- Sales ---------------------------------------------------------------
  const orders = [];
  const ledger = [];
  let num = 1000;
  const KINDS = ['cash', 'cash', 'cash', 'cash', 'gcash', 'gcash', 'qr', 'credit', 'other'];
  const LABEL = { cash: 'Cash', gcash: 'GCash', qr: 'QR Ph', credit: 'Charge to account', other: 'Maya' };

  for (let d = 0; d < days; d++) {
    const day = dayTs(d);
    landDeliveries(d, day);
    if (d >= 7 && d % 7 === 0) orderStock(d, day);
    const dow = day.getDay();
    // Sundays are quiet, paydays (15th/30th) are not. A flat rate would hide every seasonal bug.
    const dom = day.getDate();
    let count = dow === 0 ? between(2, 6) : between(6, 16);
    if (dom === 15 || dom === 30) count += between(4, 9);
    if (day.getMonth() >= 4 && day.getMonth() <= 8) count += 2;   // rainy-season repairs
    count = Math.max(1, Math.round(count * busy));

    for (let n = 0; n < count; n++) {
      const at = new Date(day);
      at.setHours(between(7, 18), between(0, 59), between(0, 59), 0);
      const cashier = pick(cashiers);
      const lines = [];
      const howMany = rnd() < 0.55 ? 1 : between(2, 4);
      for (let l = 0; l < howMany; l++) {
        const p = pick(products);
        if (lines.some((x) => x.id === p.id)) continue;
        const step = stepFor(p);
        const qty = step < 1 ? round2(between(1, 12) * 0.25) : between(1, 6);
        if (qty > stockOf(p.id)) continue;      // the till would refuse; so does the seed
        // cost stamped at the moment of sale, exactly as app.js now does it -- the whole
        // point of the year is that costs rise mid-year and old margins must not move.
        lines.push({ id: p.id, productId: p.id, name: p.name, sku: p.sku, unit: p.unit,
                     qty, price: p.price, cost: p.cost, lineTotal: round2(p.price * qty) });
      }
      if (!lines.length) continue;
      const gross = round2(lines.reduce((s, i) => s + i.lineTotal, 0));
      const discount = rnd() < 0.08 ? round2(gross * 0.05) : 0;
      const total = round2(gross - discount);
      const kind = pick(KINDS);
      const cust = kind === 'credit' ? pick(customers) : (rnd() < 0.25 ? pick(customers) : null);
      const order = {
        id: newId('ord'), number: receiptNo(), ts: at.getTime(), status: 'completed',
        cashier, customer: cust ? { id: cust.id, name: cust.name } : null,
        paymentMethod: kind === 'credit' ? 'credit' : 'cash',
        paymentKind: kind, paymentMethodLabel: LABEL[kind],
        fulfilment: rnd() < 0.12 ? 'delivery' : 'pickup',
        vatAmount: round2(total - total / 1.12),
        discount, total, items: lines,
        // Only cash belongs in the drawer -- GCash/QR/custom are `other`, same rule as buildOrderPayments.
        payments: [{ method: kind === 'credit' || kind === 'cash' ? kind : 'other', label: LABEL[kind], amount: total }],
      };

      // ~1.5% get voided the same day, ~1% come back as a return a few days later.
      const roll = rnd();
      if (roll < 0.015) {
        order.status = 'voided';
      } else {
        lines.forEach((i) => move(at, i.id, -i.qty, 'sale', order.id, '', cashier));
        if (kind === 'credit' && cust) {
          ledger.push({ id: newId('led'), ts: at.getTime(), customerId: cust.id, type: 'charge',
                        amount: total, ref: order.number });
        }
        if (roll > 0.99 && d < days - 4) {
          const back = new Date(at.getTime() + between(1, 4) * 864e5);
          back.setHours(between(9, 17), between(0, 59), 0, 0);
          order.status = 'refunded';
          orders.push({ ...order, id: newId('ord'), number: receiptNo(), ts: back.getTime(),
                        status: 'return', originalOrderId: order.id, reason: 'Returned items',
                        paymentKind: 'cash', paymentMethodLabel: 'Cash',
                        payments: [{ method: 'cash', label: 'Return', amount: total }] });
          lines.forEach((i) => move(back, i.id, i.qty, 'return', order.id, 'Customer return', cashier));
        }
      }
      orders.push(order);
    }

    // A shrinkage/damage adjustment about once a fortnight.
    if (rnd() < 0.07) {
      const p = pick(products);
      const at = new Date(day); at.setHours(17, 30, 0, 0);
      const loss = Math.min(between(1, 4), stockOf(p.id));
      if (loss > 0) move(at, p.id, -loss, 'adjustment', '', pick(['Damaged in store', 'Broken on delivery', 'Miscount corrected']), pick(cashiers));
    }
  }

  // ---- Stock is the sum of the log, never a number someone typed -----------
  movements.sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const stock = new Map();
  movements.forEach((m) => stock.set(m.productId, round2((stock.get(m.productId) || 0) + m.qty)));
  products.forEach((p) => { p.stock = stock.get(p.id) || 0; });

  // ---- Attendance ----------------------------------------------------------
  const marks = {};
  for (let d = Math.max(0, days - 60); d < days; d++) {
    const day = dayTs(d);
    if (day.getDay() === 0) continue;
    const key = iso(day);
    marks[key] = {};
    staff.forEach((u) => {
      const r = rnd();
      marks[key][u.name] = r < 0.82 ? 'present' : r < 0.9 ? 'late' : r < 0.95 ? 'half' : r < 0.98 ? 'off' : 'absent';
    });
  }

  orders.sort((a, b) => a.ts - b.ts);
  localStorage.setItem('hwpos.products.v2', JSON.stringify(products));
  localStorage.setItem('hwpos.orders.v1', JSON.stringify(orders));
  localStorage.setItem('hwpos.orderSeq.v1', String(num));
  localStorage.setItem('hwpos.customerLedger.v1', JSON.stringify(ledger));
  localStorage.setItem('hwpos.attendance.v1', JSON.stringify(marks));
  saveSuppliers(suppliers);
  savePurchaseOrders(pos);
  saveMovements(movements);
  saveStaff(staff);

  const bytes = Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
  return { days, orders: orders.length, movements: movements.length, purchaseOrders: pos.length,
           products: products.length, suppliers: suppliers.length,
           kb: Math.round(bytes / 1024) };
}
