/* Dev only. Six months of trading over a 200+ item catalog, written straight into the same
   localStorage the app reads. Open the back office, paste this in the DevTools console (F12),
   then reload the page:

     fetch('/scripts/seed-year.js').then(r => r.text()).then(eval).then(() => console.log(seedYear()));

   seedYear(365) still writes a full year. It REPLACES products, sales, stock and POs
   in this browser -- there is no undo.

   It is not a test — the tests are scripts/*-check.mjs and scripts/sim-year.mjs. This exists
   so the pages can be USED: a year of sales to filter, stock that actually moved, purchase
   orders that were half received, and staff who turned up late. Deterministic (seeded PRNG),
   so a bug found on this data can be found again.

   ponytail: it leans on the globals bo-model.js and backoffice.js already define rather than
   re-deriving money, movements or PO maths. If it disagrees with the app, the app wins. */
// `busy` scales the daily order count. A full year at busy=1 is ~4,200 orders, which is
// ~4 MB of localStorage -- past what Chrome gives one origin, so the till then refuses to
// record the next sale. Keep the year, turn the volume down, until the D1 store lands.
function seedYear(days = 182, busy = 0.8) {
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

  // ---- Catalog: the seed list, topped up to 200+ lines ----------------------
  // Families x sizes, the way a real hardware shelf grows; price climbs with the size.
  // [folder, unit, brand, name, sizes, base price, step per size, soldBy]
  const FAMILIES = [
    ['plumbing', 'pc', 'Atlanta', 'PVC Elbow', ['1"', '1 1/2"', '2"', '3"', '4"'], 22, 0.55],
    ['plumbing', 'pc', 'Atlanta', 'PVC Tee', ['3/4"', '1"', '2"', '3"', '4"'], 20, 0.6],
    ['plumbing', 'pc', 'Atlanta', 'PVC Pipe', ['3/4" × 3m', '1" × 3m', '2" × 3m', '3" × 3m', '4" × 3m'], 180, 0.7],
    ['plumbing', 'pc', 'Atlanta', 'PVC Coupling', ['1/2"', '3/4"', '1"', '2"'], 9, 0.5],
    ['plumbing', 'pc', 'Atlanta', 'PVC Clean-out', ['2"', '3"', '4"'], 65, 0.4],
    ['plumbing', 'pc', 'Omega', 'Gate Valve Brass', ['1/2"', '3/4"', '1"'], 320, 0.45],
    ['plumbing', 'pc', 'Omega', 'Hose Bibb', ['1/2"', '3/4"'], 210, 0.3],
    ['plumbing', 'pc', 'HCG', 'Flexible Hose', ['12"', '16"', '20"'], 95, 0.2],
    ['plumbing', 'pc', 'HCG', 'Floor Drain Stainless', ['3" × 3"', '4" × 4"'], 150, 0.4],
    ['plumbing', 'pc', 'HCG', 'P-Trap', ['1 1/4"', '1 1/2"'], 140, 0.25],
    ['electrical', 'm', 'Phelps Dodge', 'THHN Wire', ['#10 (per meter)', '#8 (per meter)', '#16 (per meter)'], 38, 0.35, 'measure'],
    ['electrical', 'pc', 'Firefly', 'LED Bulb Daylight', ['5W', '12W', '15W', '20W'], 85, 0.3],
    ['electrical', 'pc', 'Firefly', 'LED Tube T8', ['9W', '18W'], 160, 0.4],
    ['electrical', 'pc', 'Panasonic', 'Convenience Outlet', ['1-Gang', '3-Gang', 'Universal'], 110, 0.3],
    ['electrical', 'pc', 'Panasonic', 'Switch', ['2-Gang', '3-Gang', '3-Way'], 120, 0.3],
    ['electrical', 'pc', 'GE', 'Circuit Breaker', ['15A', '20A', '40A', '60A'], 360, 0.25],
    ['electrical', 'pc', 'Royu', 'Extension Cord', ['3m 3-Outlet', '5m 4-Outlet', '10m 4-Outlet'], 280, 0.5],
    ['electrical', 'pc', 'Royu', 'Junction Box', ['2" × 4"', '4" × 4"'], 22, 0.4],
    ['electrical', 'pc', 'Neltex', 'PVC Conduit × 3m', ['1/2"', '3/4"', '1"'], 75, 0.4],
    ['electrical', 'pc', 'Royu', 'Lamp Holder', ['Receptacle', 'Pendant'], 35, 0.3],
    ['fasteners', 'kg', 'Generic', 'Common Wire Nail', ['1"', '1 1/2"', '4"', '5"'], 85, 0.05],
    ['fasteners', 'kg', 'Generic', 'Concrete Nail', ['1"', '2"', '3"'], 140, 0.1],
    ['fasteners', 'kg', 'Generic', 'Umbrella Nail', ['2"', '2 1/2"'], 120, 0.08],
    ['fasteners', 'pc', 'Generic', 'Wood Screw #8', ['× 1 1/2"', '× 2"', '× 3"'], 2.5, 0.3],
    ['fasteners', 'pc', 'Generic', 'Tek Screw', ['× 1"', '× 2"', '× 3"'], 3.5, 0.35],
    ['fasteners', 'pc', 'Generic', 'Hex Bolt', ['M6 × 50mm', 'M8 × 75mm', 'M12 × 150mm'], 7, 0.6],
    ['fasteners', 'pc', 'Generic', 'Hex Nut', ['M6', 'M8', 'M10', 'M12'], 1.5, 0.4],
    ['fasteners', 'pc', 'Generic', 'Flat Washer', ['M6', 'M8', 'M12'], 1, 0.4],
    ['fasteners', 'pc', 'Fischer', 'Tox Plug', ['#6', '#8', '#10'], 1.5, 0.3],
    ['fasteners', 'pc', 'Generic', 'Anchor Bolt', ['3/8"', '1/2"'], 28, 0.5],
    ['fasteners', 'kg', 'Ace', 'Tie Wire #16', ['(per kg)'], 95, 0],
    ['fasteners', 'pc', 'Ace', 'Deformed Bar Grade 33', ['10mm × 6m', '12mm × 6m', '16mm × 6m'], 180, 0.55],
    ['tools', 'pc', 'Stanley', 'Claw Hammer', ['8oz', '20oz'], 280, 0.4],
    ['tools', 'pc', 'Stanley', 'Flat Screwdriver', ['3"', '4"', '6"'], 75, 0.2],
    ['tools', 'pc', 'Stanley', 'Phillips Screwdriver', ['#1', '#3'], 80, 0.2],
    ['tools', 'pc', 'Tolsen', 'Long Nose Pliers', ['6"', '8"'], 190, 0.2],
    ['tools', 'pc', 'Tolsen', 'Adjustable Wrench', ['8"', '10"', '12"'], 240, 0.3],
    ['tools', 'pc', 'Stanley', 'Tape Measure', ['3m', '7.5m', '10m'], 120, 0.5],
    ['tools', 'pc', 'Lotus', 'Hand Saw', ['18"', '22"'], 260, 0.2],
    ['tools', 'pc', 'Lotus', 'Hacksaw Blade', ['18T', '24T', '32T'], 45, 0.05],
    ['tools', 'pc', 'Lotus', 'Masonry Trowel', ['6"', '8"'], 110, 0.2],
    ['tools', 'pc', 'Lotus', 'Shovel', ['Round Point', 'Square Point'], 390, 0.05],
    ['tools', 'pc', 'Makita', 'Masonry Drill Bit', ['1/4"', '3/8"', '1/2"'], 65, 0.4],
    ['tools', 'pc', 'Makita', 'Cutting Disc 4"', ['Metal', 'Stainless', 'Masonry'], 35, 0.1],
    ['tools', 'pc', 'Makita', 'Grinding Disc 4"', ['Metal'], 55, 0],
    ['tools', 'pc', 'Tolsen', 'Utility Cutter', ['Small', 'Large'], 55, 0.5],
    ['tools', 'pc', 'Tolsen', 'Wheelbarrow', ['Heavy Duty'], 2450, 0],
    ['paint', 'L', 'Boysen', 'Latex Paint', ['Blue 1L', 'Cream 1L', 'Green 1L', 'White 4L', 'Cream 4L'], 290, 0.35],
    ['paint', 'L', 'Davies', 'Quick-Dry Enamel', ['White 1L', 'Red 1L', 'Gray 1L', 'Black 4L'], 330, 0.3],
    ['paint', 'L', 'Boysen', 'Flat Wall Enamel', ['White 1L', 'White 4L'], 310, 1.6],
    ['paint', 'L', 'Boysen', 'Red Oxide Primer', ['1L', '4L'], 260, 2.2],
    ['paint', 'L', 'Boysen', 'Acrylic Paint Tint', ['Black', 'Blue', 'Red', 'Yellow'], 95, 0],
    ['paint', 'L', 'Boysen', 'Lacquer Thinner', ['1L', '4L'], 140, 2.4],
    ['paint', 'pc', 'Tolsen', 'Paint Brush', ['1"', '2"', '4"'], 35, 0.45],
    ['paint', 'pc', 'Tolsen', 'Paint Roller', ['4"', '7"'], 85, 0.4],
    ['paint', 'pc', 'Generic', 'Sandpaper', ['#80', '#120', '#240', '#400'], 18, 0],
    ['paint', 'pc', 'Generic', 'Masking Tape', ['1"', '2"'], 45, 0.6],
    ['cement', 'bag', 'Republic', 'Portland Cement', ['Type 1P 40kg'], 265, 0],
    ['cement', 'bag', 'Holcim', 'Holcim Excel Cement', ['40kg'], 275, 0],
    ['cement', 'bag', 'Generic', 'Tile Adhesive', ['5kg', '25kg'], 120, 2.8],
    ['cement', 'bag', 'Generic', 'Tile Grout', ['2kg White', '2kg Gray'], 75, 0],
    ['cement', 'pc', 'Generic', 'Hollow Block', ['5"', '6"'], 16, 0.25],
    ['cement', 'cu.m', 'Generic', 'Washed Sand', ['(per cu.m)'], 1350, 0, 'measure'],
    ['cement', 'bag', 'Generic', 'Lime', ['25kg'], 210, 0],
    ['safety', 'pair', 'Generic', 'Rubber Gloves', ['Medium', 'Large'], 55, 0.1],
    ['safety', 'pair', 'Generic', 'Leather Welding Gloves', ['Standard'], 180, 0],
    ['safety', 'pair', 'Generic', 'Rubber Boots', ['Size 8', 'Size 9', 'Size 10'], 390, 0.05],
    ['safety', 'pc', '3M', 'Ear Plugs', ['Corded'], 45, 0],
    ['safety', 'pc', 'Generic', 'Reflective Vest', ['Orange', 'Lime'], 150, 0],
    ['safety', 'pc', 'Generic', 'Hard Hat', ['White', 'Blue'], 220, 0],
    ['safety', 'pc', 'Generic', 'Face Shield', ['Clear'], 95, 0],
    ['adhesive', 'pc', 'Pioneer', 'Epoxy Clear', ['1/4 pint', '1/2 pint'], 190, 0.8],
    ['adhesive', 'pc', 'Rugby', 'Contact Cement', ['100mL', '1L'], 70, 3.5],
    ['adhesive', 'pc', 'Neltex', 'PVC Solvent Cement', ['100mL', '400mL'], 60, 1.4],
    ['adhesive', 'pc', 'Dow', 'Silicone Sealant', ['Clear', 'Black'], 185, 0],
    ['adhesive', 'pc', 'Elmers', 'Wood Glue', ['250g', '1kg'], 95, 2.2],
    ['adhesive', 'pc', 'Bostik', 'Construction Adhesive', ['300mL'], 260, 0],
  ];
  // The generated lines (x001...) are dropped and rebuilt, so a re-run never keeps stale ones.
  const seeded = loadProducts().filter((p) => !/^x\d{3}$/.test(p.id));
  // Keyed on name, so running the seed again does not stack a second copy of the extras.
  const taken = new Set(seeded.map((p) => p.name.toLowerCase()));
  const extra = [];
  for (const [folder, unit, brand, base, sizes, price, step, soldBy] of FAMILIES) {
    sizes.forEach((size, k) => {
      const name = `${base} ${size}`;
      if (taken.has(name.toLowerCase())) return;
      taken.add(name.toLowerCase());
      const n = extra.length + 1;
      const pr = round2(price * (1 + step * k));
      extra.push({
        id: 'x' + String(n).padStart(3, '0'),
        sku: `${base.replace(/[^A-Za-z]/g, '').slice(0, 6)}-${size.replace(/[^A-Za-z0-9]/g, '').slice(0, 6)}-${n}`.toUpperCase(),
        barcode: '4809' + String(n).padStart(9, '0'),
        name, brand, folder, unit, soldBy: soldBy || 'each',
        price: pr, cost: round2(pr * (0.6 + rnd() * 0.2)),
        reorderPoint: pr > 1000 ? between(2, 5) : pr > 200 ? between(5, 15) : between(15, 60),
        aliases: [],
      });
    });
  }

  // ---- Products: give every line cost, margin and a supplier ---------------
  const products = [...seeded, ...extra].map((raw, i) => {
    const p = normalizeProduct(raw);
    p.supplierId = /paint|boysen|enamel|primer|thinner/i.test(p.name) ? 'sup_boy'
      : /pvc|pipe|elbow|tee/i.test(p.name) ? 'sup_pvc'
      : /rebar|wire|steel|nail|deformed bar/i.test(p.name) ? 'sup_ace' : 'sup_gen';
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
  products.forEach((p) => move(open, p.id, between(p.reorderPoint * 2, p.reorderPoint * 6), 'count', '', 'Opening count', 'El John'));

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
      const low = products.filter((p) => p.supplierId === sup.id && stockOf(p.id) < p.reorderPoint);
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
  const LABEL = { cash: 'Cash', gcash: 'GCash', qr: 'QR Ph', credit: 'Account', other: 'Maya' };

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

  orders.sort((a, b) => a.ts - b.ts);
  localStorage.setItem('hwpos.products.v2', JSON.stringify(products));
  localStorage.setItem('hwpos.orders.v1', JSON.stringify(orders));
  localStorage.setItem('hwpos.orderSeq.v1', String(num));
  localStorage.setItem('hwpos.customerLedger.v1', JSON.stringify(ledger));
  saveSuppliers(suppliers);
  savePurchaseOrders(pos);
  saveMovements(movements);
  saveStaff(staff);

  const bytes = Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
  return { days, orders: orders.length, movements: movements.length, purchaseOrders: pos.length,
           products: products.length, suppliers: suppliers.length,
           kb: Math.round(bytes / 1024) };
}
