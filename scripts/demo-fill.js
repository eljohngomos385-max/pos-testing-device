/* Dev only. Six months of a busy store, ~50 receipts a day, every collection filled, built in
   memory on each page load. Nothing touches the real localStorage: ~9,000 orders is past the
   ~5 MB a browser gives one origin, and a demo must never wipe a real store's data.

     http://127.0.0.1:8080/demo       turn it on (a cookie; scripts/serve.py injects this file)
     http://127.0.0.1:8080/demo/off   back to the real data

   serve.py loads it right after bo-model.js, so data.js (PRODUCTS, CUSTOMERS, SEED_GROUPS…) and
   SEED_STAFF exist and backoffice.js has not read storage yet. Anything changed while in the demo
   is gone on reload -- it regenerates. Seeded PRNG anchored to today: same day, same shop.

   ponytail: the till event stream (IndexedDB) is not generated; only Export for AI reads it.
   The shapes follow docs/data-dictionary.md; if the app disagrees, the app wins. */
(() => {
  const mem = new Map();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
      setItem: (k, v) => { mem.set(String(k), String(v)); },
      removeItem: (k) => { mem.delete(String(k)); },
      clear: () => mem.clear(),
      key: (i) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    },
  });
  const put = (k, v) => mem.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  const t0 = performance.now();

  // ---- dice ------------------------------------------------------------------
  let seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chance = (p) => rnd() < p;
  const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const r2 = (n) => Math.round(n * 100) / 100;
  const weighted = (items, w) => {           // w: item -> weight; returns a picker
    const cum = []; let sum = 0;
    items.forEach((x) => { sum += w(x); cum.push(sum); });
    return () => { const r = rnd() * sum; let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
      return items[lo]; };
  };
  let n36 = 0;
  const uid = (p) => `${p}_demo${(n36++).toString(36)}`;

  // ---- calendar --------------------------------------------------------------
  const DAYS = 183;
  const NOW = new Date();
  const day0 = new Date(NOW); day0.setHours(0, 0, 0, 0); day0.setDate(day0.getDate() - (DAYS - 1));
  const dayAt = (d) => { const x = new Date(day0); x.setDate(x.getDate() + d); return x; };
  const at = (day, h, m = between(0, 59)) => { const x = new Date(day); x.setHours(h, m, between(0, 59), 0); return x; };
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const plusDays = (x, n) => { const y = new Date(x); y.setDate(y.getDate() + n); return y; };

  // ---- staff -----------------------------------------------------------------
  const staff = [...SEED_STAFF.map((s) => ({ ...s })),
    { id: 'u5', name: 'Ramon D.', role: 'stock', email: '', pin: '••••', active: true },
    { id: 'u6', name: 'Liza M.', role: 'cashier', email: '', pin: '••••', active: true },
  ];
  const OFFDAY = { u2: 3, u3: 2, u4: 4, u5: 1, u6: 5 };      // each person's weekday off; Sunday is split
  const OWNER = 'El John';

  // ---- suppliers ---------------------------------------------------------------
  // lead: what actually happens (mean days), late: chance it slips 2-4 more, short: chance a line comes short.
  const SUP = [
    { id: 'sup_ace', name: 'Ace Steel & Hardware', contact: 'Rowena Cruz', phone: '0917 555 0142', email: 'orders@acesteel.ph', address: 'Km 12 Maharlika Hwy, Cabanatuan', note: 'Rebar, nails, tie wire. Delivers Tuesdays.', orderDays: [1, 4], minOrder: 15000, quotedLeadDays: 3, lead: 3, late: 0.25, short: 0.12 },
    { id: 'sup_boy', name: 'Boysen Depot Central', contact: 'Mark Villanueva', phone: '0918 555 0777', email: 'central@boysendepot.ph', address: '88 Quezon Ave, Cabanatuan', note: 'Paint. 30-day terms.', orderDays: [2], minOrder: 10000, quotedLeadDays: 2, lead: 2, late: 0.05, short: 0.05 },
    { id: 'sup_pvc', name: 'Atlanta Plastics', contact: 'Jing Robles', phone: '0920 555 0311', email: 'sales@atlantaplastics.ph', address: 'Bgy. Sumacab, Cabanatuan', note: 'PVC pipe and fittings.', orderDays: [1, 3, 5], minOrder: 5000, quotedLeadDays: 2, lead: 2, late: 0.1, short: 0.08 },
    { id: 'sup_hol', name: 'Holcim Dealer Nueva Ecija', contact: 'Arnel Tan', phone: '0998 555 0620', email: 'ne.dealer@holcim-partner.ph', address: 'Talavera, Nueva Ecija', note: 'Cement by the truck. Cash on delivery.', orderDays: [1, 4], minOrder: 20000, quotedLeadDays: 1, lead: 1, late: 0.15, short: 0.03 },
    { id: 'sup_ele', name: 'Firefly Electric Trading', contact: 'Cathy Lim', phone: '0915 555 0833', email: 'trade@fireflyelectric.ph', address: 'Rizal Ave, San Jose City', note: 'Wire, breakers, lighting.', orderDays: [3], minOrder: 8000, quotedLeadDays: 4, lead: 5, late: 0.35, short: 0.15 },
    { id: 'sup_gen', name: 'Metro Builders Supply', contact: 'Danny Ong', phone: '0905 555 0980', email: 'metrobuilders@gmail.com', address: 'Maharlika Hwy, San Leonardo', note: 'Tools, safety, adhesives. Everything else.', orderDays: [2, 5], minOrder: 3000, quotedLeadDays: 3, lead: 3, late: 0.12, short: 0.1 },
  ];
  const supById = new Map(SUP.map((s) => [s.id, s]));
  const SUP_OF_FOLDER = { plumbing: 'sup_pvc', paint: 'sup_boy', cement: 'sup_hol', electrical: 'sup_ele', fasteners: 'sup_ace', tools: 'sup_gen', safety: 'sup_gen', adhesive: 'sup_gen' };

  // ---- catalog: data.js's ~40 plus families, each family a variant group ------------------
  // [folder, unit, brand, family, sizes, base price, price step per size, soldBy, popularity]
  const FAMILIES = [
    ['plumbing', 'pc', 'Atlanta', 'PVC Tee', ['1/2"', '3/4"', '1"', '2"', '3"', '4"'], 18, 0.55, 'each', 3],
    ['plumbing', 'pc', 'Atlanta', 'PVC Coupling', ['1/2"', '3/4"', '1"', '2"'], 9, 0.5, 'each', 3],
    ['plumbing', 'pc', 'Atlanta', 'PVC Pipe Orange', ['2" × 3m', '3" × 3m', '4" × 3m'], 210, 0.6, 'each', 2],
    ['plumbing', 'pc', 'Omega', 'Gate Valve Brass', ['1/2"', '3/4"', '1"'], 320, 0.45, 'each', 1],
    ['plumbing', 'pc', 'HCG', 'Flexible Hose', ['12"', '16"', '20"'], 95, 0.2, 'each', 2],
    ['plumbing', 'pc', 'HCG', 'Floor Drain Stainless', ['3" × 3"', '4" × 4"'], 150, 0.4, 'each', 1],
    ['plumbing', 'pc', 'HCG', 'P-Trap', ['1 1/4"', '1 1/2"'], 140, 0.25, 'each', 1],
    ['plumbing', 'roll', 'Generic', 'Teflon Tape', ['1/2"', '3/4"'], 15, 0.3, 'each', 4],
    ['electrical', 'm', 'Phelps Dodge', 'THHN Stranded', ['#14', '#12', '#10', '#8'], 22, 0.45, 'measure', 3],
    ['electrical', 'pc', 'Firefly', 'LED Bulb Daylight', ['5W', '9W', '12W', '15W', '20W'], 85, 0.3, 'each', 3],
    ['electrical', 'pc', 'Firefly', 'LED Tube T8', ['9W', '18W'], 160, 0.4, 'each', 1.5],
    ['electrical', 'pc', 'Panasonic', 'Convenience Outlet', ['1-Gang', '2-Gang', '3-Gang', 'Universal'], 110, 0.3, 'each', 2],
    ['electrical', 'pc', 'Panasonic', 'Wall Switch', ['1-Gang', '2-Gang', '3-Gang', '3-Way'], 95, 0.3, 'each', 2],
    ['electrical', 'pc', 'GE', 'Circuit Breaker', ['15A', '20A', '30A', '40A', '60A'], 360, 0.25, 'each', 1],
    ['electrical', 'pc', 'Royu', 'Extension Cord', ['3m 3-Outlet', '5m 4-Outlet', '10m 4-Outlet'], 280, 0.5, 'each', 1.5],
    ['electrical', 'pc', 'Royu', 'Utility Box', ['2" × 4"', '4" × 4"'], 22, 0.4, 'each', 2],
    ['electrical', 'pc', 'Neltex', 'PVC Conduit × 3m', ['1/2"', '3/4"', '1"'], 75, 0.4, 'each', 2],
    ['electrical', 'roll', 'Armak', 'Electrical Tape', ['Black', 'Red', 'Blue'], 28, 0, 'each', 4],
    ['fasteners', 'kg', 'Generic', 'Concrete Nail', ['1"', '2"', '3"'], 140, 0.1, 'measure', 3],
    ['fasteners', 'kg', 'Generic', 'Umbrella Nail', ['2"', '2 1/2"'], 120, 0.08, 'measure', 2],
    ['fasteners', 'pc', 'Generic', 'Wood Screw #8', ['× 1"', '× 1 1/2"', '× 2"', '× 3"'], 2.5, 0.3, 'each', 3],
    ['fasteners', 'pc', 'Generic', 'Tek Screw', ['× 1"', '× 2"', '× 3"'], 3.5, 0.35, 'each', 3],
    ['fasteners', 'pc', 'Generic', 'Hex Bolt', ['M6 × 50mm', 'M8 × 75mm', 'M10 × 100mm', 'M12 × 150mm'], 7, 0.6, 'each', 2],
    ['fasteners', 'pc', 'Generic', 'Hex Nut', ['M6', 'M8', 'M10', 'M12'], 1.5, 0.4, 'each', 2],
    ['fasteners', 'pc', 'Fischer', 'Tox Plug', ['#6', '#8', '#10'], 1.5, 0.3, 'each', 3],
    ['fasteners', 'pc', 'Ace', 'Deformed Bar Grade 33', ['10mm × 6m', '12mm × 6m', '16mm × 6m'], 180, 0.55, 'each', 4],
    ['fasteners', 'kg', 'Ace', 'Tie Wire #16', ['(per kg)'], 95, 0, 'measure', 4],
    ['tools', 'pc', 'Stanley', 'Claw Hammer', ['8oz', '16oz', '20oz'], 280, 0.3, 'each', 1],
    ['tools', 'pc', 'Stanley', 'Screwdriver Flat', ['3"', '4"', '6"'], 75, 0.2, 'each', 1],
    ['tools', 'pc', 'Stanley', 'Screwdriver Phillips', ['#1', '#2', '#3'], 80, 0.2, 'each', 1],
    ['tools', 'pc', 'Tolsen', 'Adjustable Wrench', ['8"', '10"', '12"'], 240, 0.3, 'each', 0.7],
    ['tools', 'pc', 'Stanley', 'Tape Measure', ['3m', '5m', '7.5m', '10m'], 120, 0.4, 'each', 1.5],
    ['tools', 'pc', 'Lotus', 'Hacksaw Blade', ['18T', '24T', '32T'], 45, 0.05, 'each', 1.5],
    ['tools', 'pc', 'Makita', 'Masonry Drill Bit', ['1/4"', '5/16"', '3/8"', '1/2"'], 65, 0.4, 'each', 1.5],
    ['tools', 'pc', 'Makita', 'Cutting Disc 4"', ['Metal', 'Stainless', 'Masonry'], 35, 0.1, 'each', 3],
    ['tools', 'pc', 'Tolsen', 'Wheelbarrow', ['Heavy Duty', 'Standard'], 2450, -0.25, 'each', 0.2],
    ['paint', 'can', 'Boysen', 'Latex Paint', ['White 1L', 'Cream 1L', 'Blue 1L', 'White 4L', 'Cream 4L'], 290, 0.35, 'each', 2],
    ['paint', 'can', 'Davies', 'Quick-Dry Enamel', ['White 1L', 'Red 1L', 'Gray 1L', 'Black 1L'], 330, 0.05, 'each', 1.5],
    ['paint', 'can', 'Boysen', 'Red Oxide Primer', ['1L', '4L'], 260, 2.2, 'each', 1],
    ['paint', 'pc', 'Boysen', 'Acrylic Paint Tint', ['Black', 'Blue', 'Red', 'Yellow', 'Green'], 95, 0, 'each', 1],
    ['paint', 'can', 'Boysen', 'Lacquer Thinner', ['1L', '4L'], 140, 2.4, 'each', 2],
    ['paint', 'pc', 'Tolsen', 'Paint Brush', ['1"', '2"', '3"', '4"'], 35, 0.4, 'each', 2],
    ['paint', 'pc', 'Tolsen', 'Paint Roller', ['4"', '7"', '9"'], 85, 0.35, 'each', 1],
    ['paint', 'pc', 'Generic', 'Sandpaper', ['#80', '#120', '#240', '#400'], 18, 0, 'each', 3],
    ['cement', 'bag', 'Holcim', 'Holcim Excel Cement', ['40kg'], 275, 0, 'each', 6],
    ['cement', 'bag', 'Generic', 'Tile Adhesive', ['5kg', '25kg'], 120, 2.8, 'each', 1.5],
    ['cement', 'bag', 'Generic', 'Tile Grout', ['2kg White', '2kg Gray', '2kg Beige'], 75, 0, 'each', 1],
    ['cement', 'pc', 'Generic', 'Hollow Block', ['4"', '5"', '6"'], 14, 0.2, 'each', 5],
    ['cement', 'cu.m', 'Generic', 'Washed Sand', ['(per cu.m)'], 1350, 0, 'measure', 2],
    ['cement', 'cu.m', 'Generic', 'Gravel 3/4', ['(per cu.m)'], 1550, 0, 'measure', 1.5],
    ['safety', 'pair', 'Generic', 'Cotton Gloves', ['Small', 'Medium', 'Large'], 25, 0, 'each', 3],
    ['safety', 'pair', 'Generic', 'Rubber Boots', ['Size 8', 'Size 9', 'Size 10', 'Size 11'], 390, 0.05, 'each', 0.6],
    ['safety', 'pc', 'Generic', 'Hard Hat', ['White', 'Yellow', 'Blue'], 220, 0, 'each', 0.5],
    ['safety', 'pc', 'Generic', 'Safety Goggles', ['Clear', 'Tinted'], 85, 0.2, 'each', 0.7],
    ['adhesive', 'pc', 'Pioneer', 'Epoxy', ['Clear 1/4 pint', 'Clear 1/2 pint', 'Gray 1/4 pint'], 190, 0.5, 'each', 1.5],
    ['adhesive', 'pc', 'Rugby', 'Contact Cement', ['100mL', '250mL', '1L'], 70, 1.4, 'each', 1.5],
    ['adhesive', 'pc', 'Neltex', 'PVC Solvent Cement', ['100mL', '200mL', '400mL'], 60, 0.7, 'each', 3],
    ['adhesive', 'pc', 'Dow', 'Silicone Sealant', ['Clear', 'White', 'Black'], 185, 0, 'each', 1.5],
  ];
  const folders = SEED_FOLDERS.map((f) => ({ ...f }));
  const groups = SEED_GROUPS.map((g) => ({ ...g }));
  const products = PRODUCTS.map((p) => ({ ...p, pop: /cement|nail|hollow|bar|wire/i.test(p.name) ? 4 : 1.5 }));
  let xn = 0;
  for (const [folder, unit, brand, fam, sizes, price, step, soldBy, pop] of FAMILIES) {
    const gid = 'grp_demo_' + fam.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (sizes.length > 1) groups.push({ id: gid, name: fam, folder, imageUrl: '' });
    sizes.forEach((size, k) => {
      xn++;
      const pr = r2(Math.max(1, price * (1 + step * k)));
      products.push({
        id: 'd' + String(xn).padStart(3, '0'),
        sku: `${fam.replace(/[^A-Za-z]/g, '').slice(0, 5)}-${size.replace(/[^A-Za-z0-9]/g, '').slice(0, 5) || 'STD'}`.toUpperCase() + '-' + xn,
        barcode: '4809' + String(100000000 + xn * 7919).slice(0, 9),
        name: size.startsWith('(') ? `${fam} ${size}` : `${fam} ${size}`, brand, folder, unit, soldBy,
        groupId: sizes.length > 1 ? gid : '', price: pr, aliases: [],
        // Middle sizes sell most, the way a real shelf does.
        pop: pop * (k === 0 || k === sizes.length - 1 ? 0.6 : 1) * (0.6 + rnd() * 0.8),
      });
    });
  }
  products.forEach((p, i) => {
    p.cost = r2(p.cost || p.price * (0.6 + rnd() * 0.18));
    if (i % 2 === 0) { p.marginMode = 'percent'; p.marginValue = Math.round(((p.price - p.cost) / p.cost) * 100); }
    else { p.marginMode = 'flat'; p.marginValue = r2(p.price - p.cost); }
    p.reorderPoint = 5;                  // set from real demand below, once qtyFor exists
    p.supplierId = /cement|sand|gravel|hollow/i.test(p.name) ? 'sup_hol' : /bar|nail|wire/i.test(p.name) ? 'sup_ace' : SUP_OF_FOLDER[p.folder] || 'sup_gen';
    p.altSupplierIds = p.folder === 'plumbing' || p.folder === 'tools' ? ['sup_gen'].filter((s) => s !== p.supplierId) : [];
    p.sellOutOfStock = false;
    p.archived = false;
    p.stock = 0;
    p.updatedAt = day0.toISOString();
  });
  // Dead stock: a few lines that stop selling after the first month. Archived: discontinued ones.
  const deadIds = new Set(products.filter((_, i) => i % 29 === 7).map((p) => p.id));
  products.filter((_, i) => i % 61 === 13).forEach((p) => { p.archived = true; });
  const byId = new Map(products.map((p) => [p.id, p]));
  const live = products.filter((p) => !p.archived);

  // ---- customers ---------------------------------------------------------------
  const FIRST = ['Mario', 'Jun', 'Rodel', 'Lito', 'Ben', 'Nestor', 'Arnold', 'Ramil', 'Joel', 'Edwin', 'Cora', 'Lorna', 'Grace', 'Marites', 'Fe', 'Ana', 'Rey', 'Dante', 'Nonoy', 'Boyet'];
  const LAST = ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Villanueva', 'Ramos', 'Aquino', 'Castillo', 'Dela Cruz', 'Navarro', 'Pascual'];
  const PLACES = ['Bgy. Aduas', 'Bgy. Bitas', 'Bgy. Sumacab Este', 'Bgy. Kapitan Pepe', 'Bgy. Mabini', 'Bgy. San Isidro', 'Bgy. Caalibangbangan', 'Bgy. Zulueta', 'Bgy. Bangad', 'Bgy. Valdefuente'];
  const customers = CUSTOMERS.map((c) => ({ ...c, every: between(3, 8), big: true }));
  for (let i = 0; i < 55; i++) {
    const type = i < 8 ? 'contractor' : i < 12 ? 'wholesale' : i < 30 ? 'residential' : 'retail';
    const name = type === 'contractor' ? `${pick(LAST)} ${pick(['Builders', 'Construction', 'Electrical Works', 'Plumbing'])}`
      : type === 'wholesale' ? `${pick(FIRST)}'s ${pick(['Hardware', 'Trading', 'Store'])}` : `${pick(FIRST)} ${pick(LAST)}`;
    customers.push({
      id: 'cust_demo' + String(i + 1).padStart(2, '0'), name, phone: `09${between(15, 99)}-${between(100, 999)}-${between(1000, 9999)}`,
      address: `${pick(PLACES)}, Cabanatuan City`, type,
      isCreditCustomer: type === 'contractor' || type === 'wholesale' || (type === 'residential' && i % 5 === 0),
      creditLimit: type === 'wholesale' ? 50000 : type === 'contractor' ? 30000 : 5000, currentBalance: 0,
      // How often they come in (days). A few stop coming mid-way -- that is what churn looks like.
      every: type === 'retail' ? between(12, 40) : type === 'residential' ? between(7, 25) : between(2, 7),
      big: type === 'contractor' || type === 'wholesale',
      stopsAt: i % 11 === 4 ? between(60, 140) : Infinity,
    });
  }

  // ---- a calendar (weather, holidays, paydays) that shapes each day's sales; not stored ------------------------------
  const lastMonday = (y, m) => { const d = new Date(y, m + 1, 0); while (d.getDay() !== 1) d.setDate(d.getDate() - 1); return d.getDate(); };
  const HOLIDAYS = { '01-01': "New Year's Day", '04-09': 'Araw ng Kagitingan', '05-01': 'Labor Day', '06-12': 'Independence Day',
    '08-21': 'Ninoy Aquino Day', '11-01': "All Saints' Day", '11-30': 'Bonifacio Day', '12-08': 'Immaculate Conception',
    '12-25': 'Christmas Day', '12-30': 'Rizal Day' };
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const day = dayAt(d), m = day.getMonth(), dom = day.getDate();
    const wet = m >= 5 && m <= 9;
    const rain = chance(wet ? 0.55 : 0.15) ? r2(rnd() ** 2 * (wet ? 60 : 15)) : 0;
    const md = ymd(day).slice(5);
    const holidayName = HOLIDAYS[md] || (m === 7 && dom === lastMonday(day.getFullYear(), 7) ? 'National Heroes Day' : '');
    days.push({
      id: ymd(day), date: ymd(day), rainMm: rain, rainHoursOpen: rain ? Math.min(11, Math.ceil(rain / 6)) : 0,
      tempMaxC: r2(wet ? 30 + rnd() * 3 : 31 + rnd() * 4), weatherCode: rain > 20 ? 65 : rain > 5 ? 63 : rain ? 61 : pick([0, 1, 2, 3]),
      holidayName, isPayday: dom === 15 || dom === new Date(day.getFullYear(), m + 1, 0).getDate(),
      events: dom === 22 && m === 8 ? 'Town fiesta' : '', roadClosure: '', note: '',
      source: d >= DAYS - 1 ? 'open-meteo-forecast' : 'open-meteo', updatedAt: at(day, 6, 0).toISOString(),
    });
  }

  // ---- ledgers the loop writes into -----------------------------------------
  const orders = [], movements = [], ledger = [], pos = [], adjustments = [], closeouts = [];
  const ev = { priceLog: [], lostDemand: [], deliveryEvents: [], supplierMessages: [], decisions: [] };
  const event = (log, ts, staffName, fields) => ev[log].push({ id: uid('ev'), ts: ts.toISOString(), staff: staffName, ...fields });
  const onOrder = new Map();                        // productId -> qty still coming
  const inbound = [];                               // { on: dayIndex, po, lines:[lineId] , part }
  const seq = { 1: 0, 2: 0 };
  let poNum = 0;

  const move = (ts, p, qty, reason, refId, staffName, extra = {}) => {
    qty = p.soldBy === 'measure' ? r2(qty) : Math.round(qty);
    p.stock = r2(p.stock + qty);
    movements.push({ id: uid('mv'), ts: ts.toISOString(), productId: p.id, qty, reason, refId, note: extra.note || '',
      unitCost: extra.unitCost ?? p.cost, staff: staffName, ...(extra.more || {}), balanceAfter: p.stock });
  };
  const logPrice = (ts, p, field, oldV, newV, reason, who = 'Maricel R.') =>
    event('priceLog', ts, who, { productId: p.id, field, old: oldV, new: newV, reason, source: 'backoffice' });
  const priceFrom = (p) => r2(p.marginMode === 'percent' ? p.cost * (1 + p.marginValue / 100) : p.cost + p.marginValue);

  // ---- buying ----------------------------------------------------------------
  function raisePo(d, day, sup) {
    const low = live.filter((p) => p.supplierId === sup.id && !deadIds.has(p.id)
      && p.stock + (onOrder.get(p.id) || 0) < p.reorderPoint * 1.6);
    if (!low.length) return;
    const orderedAt = at(day, 8), sentAt = new Date(orderedAt.getTime() + between(10, 90) * 6e4);
    const po = {
      id: uid('po'), number: 'PO-' + String(++poNum).padStart(4, '0'), supplierId: sup.id, status: 'ordered',
      orderedAt: orderedAt.toISOString(), sentAt: sentAt.toISOString(),
      promisedAt: ymd(plusDays(day, sup.quotedLeadDays)), expectedAt: ymd(plusDays(day, sup.quotedLeadDays)), receivedAt: '',
      note: '', updatedAt: sentAt.toISOString(),
      items: low.map((p) => {
        const want = p.reorderPoint * 4 - p.stock - (onOrder.get(p.id) || 0);
        const qty = p.soldBy === 'measure' ? Math.ceil(want) : Math.ceil(want / 5) * 5;
        onOrder.set(p.id, (onOrder.get(p.id) || 0) + qty);
        return { id: uid('pol'), productId: p.id, qty, cost: p.cost, receivedQty: 0, invoiceCost: null, shortReason: '' };
      }),
    };
    pos.push(po);
    const late = chance(sup.late) ? between(2, 4) : 0;
    inbound.push({ on: d + Math.max(1, sup.lead + between(-1, 1) + late), po, late });
  }

  function landPo(d, day, job) {
    const { po } = job, sup = supById.get(po.supplierId);
    const ts = at(day, between(9, 15));
    const hike = !job.part && chance(0.14) ? 1 + 0.03 + rnd() * 0.09 : 1;
    po.items.forEach((l, k) => {
      const owed = l.qty - l.receivedQty;
      if (owed <= 0) return;
      const short = !job.part && k === 0 && chance(sup.short);
      const qty = short ? Math.floor(owed * (0.4 + rnd() * 0.3)) : owed;
      if (short) l.shortReason = pick(['Out of stock at supplier', 'Backorder', 'Damaged in transit']);
      const p = byId.get(l.productId);
      if (l.invoiceCost == null) l.invoiceCost = r2(l.cost * hike);
      l.receivedQty += qty;
      onOrder.set(p.id, Math.max(0, (onOrder.get(p.id) || 0) - qty));
      if (qty > 0) move(ts, p, qty, 'delivery', po.id, 'Ramon D.', { unitCost: l.cost, more: { happenedOn: ymd(day) } });
      if (hike > 1 && l.invoiceCost !== p.cost) {
        // Supplier raised the price. Percent-margin lines follow it; flat ones hold their shelf price
        // half the time, which is what the Cost changes list is there to catch.
        const oldCost = p.cost; p.cost = l.invoiceCost;
        logPrice(ts, p, 'cost', oldCost, p.cost, 'supplier increase');
        if (p.marginMode === 'percent' || chance(0.5)) {
          const oldPrice = p.price; p.price = priceFrom(p);
          if (p.price !== oldPrice) {
            logPrice(ts, p, 'price', oldPrice, p.price, 'cost went up');
            ev.decisions.push({ id: uid('ev'), ts: ts.toISOString(), staff: 'Maricel R.', kind: 'reprice', subjectId: p.id,
              inputs: { bookCost: oldCost, paidCost: p.cost, gapPct: r2((p.cost / oldCost - 1) * 100), price: oldPrice, marginMode: p.marginMode, deliveryRefId: po.id },
              rule: 'costDrift heldPrice v1', choice: { cost: p.cost, price: p.price }, accepted: true, actor: 'Maricel R.' });
          }
        }
        p.updatedAt = ts.toISOString();
      }
    });
    const owedAll = po.items.some((l) => l.receivedQty < l.qty);
    po.status = owedAll ? 'partial' : 'received';
    po.receivedAt = owedAll ? '' : ts.toISOString();
    po.updatedAt = ts.toISOString();
    if (owedAll) {
      inbound.push({ on: d + between(2, 5), po, part: true });
    }
  }

  // ---- selling ----------------------------------------------------------------
  const pickProduct = weighted(live, (p) => p.pop);
  const byFolder = {};
  live.forEach((p) => { (byFolder[p.folder] ||= []).push(p); });
  const pickIn = Object.fromEntries(Object.entries(byFolder).map(([f, list]) => [f, weighted(list, (p) => p.pop)]));
  const HOURS = weighted([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], (h) => ({ 7: 3, 8: 8, 9: 10, 10: 9, 11: 7, 12: 4, 13: 6, 14: 8, 15: 9, 16: 8, 17: 5 })[h]);
  const NOT_CARRIED = ['Marine plywood 3/4"', 'Blue tarpaulin 10×12', 'GI sheet gauge 26', 'Roof paint red 4L', 'Welding rod 6013',
    'Cyclone wire 6ft', 'Water tank 500L', 'Bamboo pole', 'Fiber cement board', 'Door knob keyed', 'Garden hose 20m', 'Solar flood light'];
  const DRIVERS = ['Ramon D.', 'Kuya Ben'];

  const qtyFor = (p, big) => {
    if (p.soldBy === 'measure') return p.unit === 'cu.m' ? r2(between(1, big ? 8 : 3) * 0.5) : r2(between(1, big ? 40 : 12) * (p.unit === 'kg' ? 0.5 : 1));
    if (p.unit === 'bag') return big ? between(5, 40) : between(1, 6);
    if (/Hollow Block/.test(p.name)) return big ? between(50, 300) : between(10, 60);
    if (/Deformed Bar/.test(p.name)) return big ? between(10, 60) : between(1, 8);
    if (p.price < 20) return between(2, big ? 100 : 24);
    if (p.price < 150) return between(1, big ? 12 : 4);
    return between(1, big ? 3 : 1);
  };

  function sell(d, day, ts, cashier, register, cust) {
    const big = !!(cust && cust.big);
    const want = [];
    const n = big ? between(2, 8) : pick([1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5]);
    for (let i = 0; i < n; i++) {
      // Baskets hang together: after the first line, often something from the same aisle.
      const p = want.length && chance(0.45) ? pickIn[pick(want).p.folder]() : pickProduct();
      if (want.some((w) => w.p.id === p.id) || (deadIds.has(p.id) && d > 30)) continue;
      want.push({ p, qty: qtyFor(p, big) });
    }
    const items = [];
    for (const { p, qty: q } of want) {
      let qty = q;
      if (p.stock < qty) {
        event('lostDemand', ts, cashier, { productId: p.id, text: p.name, qty: r2(qty - Math.max(0, p.stock)), reason: 'out-of-stock',
          substituteProductId: '', terminal: register });
        if (p.stock <= 0 || chance(0.5)) continue;
        qty = p.soldBy === 'measure' ? r2(p.stock) : Math.floor(p.stock);
        if (qty <= 0) continue;
      }
      const lineGross = r2(p.price * qty);
      const disc = big && chance(0.1) ? { type: 'percent', value: 5 } : null;
      const lineDiscount = disc ? r2(lineGross * 0.05) : 0;
      items.push({ id: p.id, productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty, price: p.price, discount: disc,
        lineGross, lineDiscount, lineTotal: r2(lineGross - lineDiscount), cost: p.cost });
    }
    if (!items.length) return null;
    const subtotal = r2(items.reduce((s, i) => s + i.lineGross, 0));
    const lineOff = r2(items.reduce((s, i) => s + i.lineDiscount, 0));
    const cartDiscount = cust && cust.type === 'contractor' && chance(0.25) ? { type: 'percent', value: 3 }
      : chance(0.03) ? { type: 'amount', value: pick([10, 20, 50]) } : null;
    const cartOff = !cartDiscount ? 0 : cartDiscount.type === 'percent' ? r2((subtotal - lineOff) * cartDiscount.value / 100) : Math.min(cartDiscount.value, subtotal - lineOff);
    const discount = r2(lineOff + cartOff), total = r2(subtotal - discount);

    const canCredit = cust && cust.isCreditCustomer;
    const kind = canCredit && chance(big ? 0.55 : 0.3) ? (chance(0.15) ? 'split' : 'credit')
      : weighted(['cash', 'gcash', 'qr', 'Maya'], (k) => ({ cash: 62, gcash: 22, qr: 10, Maya: 6 })[k])();
    let payments, tendered = 0, change = 0;
    if (kind === 'cash') {
      tendered = [20, 50, 100, 500, 1000].map((b) => Math.ceil(total / b) * b).filter((x) => x - total < 500)[chance(0.3) ? 0 : 1] || total;
      if (chance(0.25)) tendered = total;
      change = r2(tendered - total);
      payments = [{ method: 'cash', label: 'Cash', amount: total, tendered, change, ref: '' }];
    } else if (kind === 'credit') {
      payments = [{ method: 'credit', label: 'Account', amount: total, tendered: 0, change: 0, ref: '' }];
    } else if (kind === 'split') {
      tendered = Math.min(total, Math.round(total * (0.3 + rnd() * 0.4) / 100) * 100 || 100);
      payments = [{ method: 'cash', label: 'Cash', amount: tendered, tendered, change: 0, ref: '' },
        { method: 'credit', label: 'Charge balance', amount: r2(total - tendered), tendered: 0, change: 0, ref: '' }];
    } else {
      payments = [{ method: 'other', label: kind === 'gcash' ? 'GCash' : kind === 'qr' ? 'QR' : 'Maya', amount: total, tendered: total, change: 0,
        ref: String(between(1000000, 9999999)) }];
    }
    const delivery = (big && chance(0.4)) || items.some((i) => /cu\.m|bag/.test(i.unit) && i.qty >= 5) || chance(0.04);
    seq[register]++;
    const order = {
      schemaVersion: 1, formatKey: 'hwpos.order.v1', id: uid('ord'), number: `${register}-${String(seq[register]).padStart(3, '0')}`,
      ts: ts.getTime(), status: 'completed', cashier, register: String(register), items,
      customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone, address: cust.address } : null,
      paymentMethod: kind === 'credit' || kind === 'split' ? kind : 'cash',
      paymentKind: ['cash', 'gcash', 'qr', 'credit', 'split'].includes(kind) ? kind : 'other',
      paymentMethodLabel: { cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', split: 'Split payment' }[kind] || kind,
      payments, subtotal, discount, cartDiscount, originalOrderId: '', reason: '', voidedAt: 0, refundedAt: 0, returnedAt: 0,
      total, tendered, change, vatRate: 0.12, vatAmount: r2(total * 0.12 / 1.12), vatableSales: r2(total - total * 0.12 / 1.12),
      fulfilment: delivery ? 'delivery' : 'pickup', deliveryAddress: delivery ? (cust ? cust.address : `${pick(PLACES)}, Cabanatuan City`) : '',
      deliveryLocation: null, meta: { source: 'pos-app', replaceableFormat: true },
    };
    items.forEach((i) => move(ts, byId.get(i.productId), -i.qty, 'sale', order.id, cashier, { unitCost: i.cost }));
    const charged = payments.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amount, 0);
    if (charged) {
      ledger.push({ id: uid('led'), ts: ts.getTime(), customerId: cust.id, customerName: cust.name, type: 'charge', amount: r2(charged), orderId: order.id, note: '' });
      cust.balance = r2((cust.balance || 0) + charged);
    }
    orders.push(order);

    // After the fact: voids (same few minutes), refunds and returns (days later). Credit sales are left alone.
    const roll = rnd();
    const back = (o) => o.items.forEach((i) => move(new Date(o.back), byId.get(i.productId), i.qty, 'return', o.id, OWNER, { unitCost: i.cost, note: o.reason }));
    if (!charged && roll < 0.012) {
      order.status = 'voided'; order.reason = pick(['Wrong item rung up', 'Customer cancelled', 'Duplicate sale']);
      order.voidedAt = order.back = ts.getTime() + between(1, 15) * 6e4; back(order); delete order.back;
    } else if (!charged && roll < 0.017 && d < DAYS - 5) {
      order.status = 'refunded'; order.reason = pick(['Defective', 'Wrong size', 'Not needed']);
      order.refundedAt = order.back = at(plusDays(day, between(1, 4)), between(9, 16)).getTime(); back(order); delete order.back;
    } else if (!charged && roll < 0.025 && d < DAYS - 5) {
      const when = at(plusDays(day, between(1, 5)), between(9, 16));
      seq[register]++;
      const ret = { ...order, id: uid('ord'), number: `${register}-${String(seq[register]).padStart(3, '0')}`, ts: when.getTime(), status: 'return',
        originalOrderId: order.id, reason: 'Returned items', returnedAt: when.getTime(), cashier: OWNER,
        payments: order.payments.map((p) => ({ ...p, label: 'Return', tendered: 0, change: 0, ref: order.number })) };
      later.push(ret);
    }
    if (delivery && order.status === 'completed') {
      const out = new Date(ts.getTime() + between(20, 150) * 6e4);
      if (out < NOW) {
        const driver = pick(DRIVERS);
        event('deliveryEvents', out, cashier, { orderId: order.id, event: 'dispatched', driver, lat: null, lng: null, note: '', terminal: String(register) });
        const arrive = new Date(out.getTime() + between(15, 70) * 6e4);
        if (arrive < NOW) {
          const fail = chance(0.04);
          event('deliveryEvents', arrive, cashier, { orderId: order.id, event: fail ? 'failed' : 'arrived', driver, lat: null, lng: null,
            note: fail ? pick(['Nobody home', 'Wrong address', 'Road flooded']) : '', terminal: String(register) });
          if (fail) event('deliveryEvents', at(plusDays(day, 1), 9), cashier, { orderId: order.id, event: 'arrived', driver, lat: null, lng: null, note: 'Second try', terminal: String(register) });
        }
      }
    }
    return order;
  }
  const later = [];                                  // return rows land on a later day, in order

  // Reorder point = about a week of what the line really sells (~140 lines a day across the
  // catalog), so hollow blocks sold by the hundred don't run dry every afternoon.
  const popSum = live.reduce((s, p) => s + p.pop, 0);
  live.forEach((p) => {
    let q = 0; for (let i = 0; i < 20; i++) q += qtyFor(p, i % 5 === 0);
    const week = 140 * (p.pop / popSum) * (q / 20) * 7;
    p.reorderPoint = p.soldBy === 'measure' ? Math.max(3, Math.ceil(week)) : Math.max(3, Math.ceil(week / 5) * 5);
  });
  // Opening stock, the day the store started using the app.
  live.forEach((p) => move(at(day0, 6, 30), p, p.reorderPoint * (2.5 + rnd() * 3), 'adjustment', '', OWNER,
    { note: 'Opening stock', more: { happenedOn: ymd(day0) } }));

  // ---- the six months --------------------------------------------------------
  for (let d = 0; d < DAYS; d++) {
    const day = dayAt(d), dow = day.getDay(), key = ymd(day), info = days[d];
    const closed = /Christmas|New Year/.test(info.holidayName);

    // Who is on the till today: cashiers and the manager, less their day off.
    const onDuty = [];
    staff.forEach((s) => {
      const off = dow === 0 ? ['u2', 'u4', 'u6'].includes(s.id) === (Math.floor(d / 7) % 2 === 0) : OFFDAY[s.id] === dow;
      if (!closed && !off && rnd() < 0.95 && (s.role === 'cashier' || s.role === 'manager')) onDuty.push(s.name);
    });
    if (!onDuty.length) onDuty.push(OWNER);
    if (closed) continue;

    // Deliveries that land today, and the POs raised this morning.
    for (let i = inbound.length - 1; i >= 0; i--) if (inbound[i].on === d && at(day, 10) < NOW) landPo(d, day, inbound.splice(i, 1)[0]);
    if (d >= 3 && d < DAYS - 1) SUP.filter((s) => s.orderDays.includes(dow)).forEach((s) => raisePo(d, day, s));

    // How busy: weekday ~50, Saturday more, Sunday half; paydays up, heavy rain and holidays down,
    // and a slow climb over the six months so the trend chips have something to say.
    let count = dow === 0 ? 30 : dow === 6 ? 66 : 56;
    if (info.isPayday) count *= 1.3;
    if (info.rainMm > 20) count *= 0.7;
    if (info.holidayName) count *= 0.55;
    if (info.events) count *= 1.4;
    count = Math.round(count * (0.9 + 0.2 * d / DAYS) * (0.85 + rnd() * 0.3));

    // Regulars due today, then walk-ins.
    const due = customers.filter((c) => d < (c.stopsAt || Infinity) && d >= (c.next ??= between(0, c.every)));
    const slots = [];
    due.forEach((c) => { c.next = d + Math.max(1, Math.round(c.every * (0.7 + rnd() * 0.6))); slots.push(c); });
    while (slots.length < count) slots.push(chance(0.06) ? pick(customers) : null);
    const stamps = slots.map((c) => ({ c, ts: at(day, HOURS()) })).sort((a, b) => a.ts - b.ts);
    for (const { c, ts } of stamps) {
      if (ts >= NOW) break;
      sell(d, day, ts, pick(onDuty), chance(0.7) ? 1 : 2, c);
    }
    // Parked receipts: a couple today only.
    if (d === DAYS - 1) for (let i = 0; i < 2; i++) {
      const p = pickProduct();
      orders.push({ schemaVersion: 1, formatKey: 'hwpos.order.v1', id: uid('ord'), number: `1-${String(++seq[1]).padStart(3, '0')}`,
        ts: NOW.getTime() - between(5, 90) * 6e4, status: 'saved', cashier: pick(onDuty), register: '1',
        items: [{ id: p.id, productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: 2, price: p.price, discount: null, lineGross: r2(p.price * 2), lineDiscount: 0, lineTotal: r2(p.price * 2), cost: p.cost }],
        customer: null, paymentMethod: 'unpaid', paymentKind: 'unpaid', paymentMethodLabel: 'Not completed',
        payments: [{ method: 'unpaid', label: 'Not completed', amount: 0, tendered: 0, change: 0, ref: '' }],
        subtotal: r2(p.price * 2), discount: 0, cartDiscount: null, originalOrderId: '', reason: '', voidedAt: 0, refundedAt: 0, returnedAt: 0,
        total: r2(p.price * 2), tendered: 0, change: 0, vatRate: 0.12, vatAmount: r2(p.price * 2 * 0.12 / 1.12), vatableSales: r2(p.price * 2 / 1.12),
        fulfilment: 'pickup', deliveryAddress: '', deliveryLocation: null, meta: { source: 'pos-app', replaceableFormat: true } });
    }
    // Returns whose day has come.
    for (let i = later.length - 1; i >= 0; i--) {
      const r = later[i];
      if (ymd(new Date(r.ts)) !== key || r.ts >= NOW.getTime()) continue;
      later.splice(i, 1);
      r.items.forEach((it) => move(new Date(r.ts), byId.get(it.productId), it.qty, 'return', r.originalOrderId, r.cashier, { unitCost: it.cost, note: 'Customer return' }));
      orders.push(r);
    }

    // Walk-in asks for things the store doesn't carry, and the odd "too expensive".
    for (let i = between(0, 3); i > 0; i--) {
      const ts = at(day, HOURS());
      if (ts < NOW) event('lostDemand', ts, pick(onDuty), { productId: '', text: pick(NOT_CARRIED), qty: between(1, 10), reason: 'not-carried', substituteProductId: '', terminal: '1' });
    }
    if (chance(0.2)) { const p = pickProduct(), ts = at(day, HOURS());
      if (ts < NOW) event('lostDemand', ts, pick(onDuty), { productId: p.id, text: p.name, qty: 1, reason: 'too-expensive', substituteProductId: '', terminal: '1' }); }

    // Shelf check every Monday, and losses now and then -- both as saved documents with their movements.
    const doc = (reason, note, lines, who) => {
      const ts = at(day, 17, 40);
      if (ts >= NOW || !lines.length) return;
      const adj = { id: uid('adj'), reason, staff: who, date: key, note, createdAt: ts.toISOString(), lines: [] };
      lines.forEach(({ p, counted }) => {
        const before = p.stock, delta = r2(counted - before);
        if (!delta) return;
        adj.lines.push({ productId: p.id, name: p.name, before, counted, delta, unitCost: p.cost });
        move(ts, p, delta, reason, adj.id, who, reason === 'count' ? { note, more: { expected: before, counted } } : { note });
      });
      if (adj.lines.length) adjustments.push(adj);
    };
    if (dow === 1) doc('count', 'Weekly shelf check', Array.from({ length: 8 }, pickProduct).filter((p, i, a) => a.indexOf(p) === i && p.stock > 0)
      .map((p) => ({ p, counted: Math.max(0, chance(0.55) ? p.stock : p.soldBy === 'measure' ? r2(p.stock - rnd() * 2) : p.stock + pick([-3, -2, -1, -1, -1, 1])) })), 'Ramon D.');
    if (chance(0.18)) {
      const p = pickProduct(), reason = pick(['shrinkage', 'damage', 'damage', 'writeoff']);
      if (p.stock > 2) doc(reason, { shrinkage: 'Missing from shelf', damage: pick(['Bag burst', 'Dropped, cracked', 'Water damage']), writeoff: pick(['Expired', 'Rusted, unsellable']) }[reason],
        [{ p, counted: p.stock - (p.soldBy === 'measure' ? 1 : between(1, 3)) }], 'Maricel R.');
    }
    // Owner nudges a price now and then.
    if (chance(0.25)) { const p = pickProduct(), ts = at(day, 18), old = p.price;
      p.price = r2(Math.round(p.price * (1 + pick([-0.05, 0.03, 0.05, 0.08])) * 4) / 4);
      if (p.soldBy !== 'measure' && p.price >= 20) p.price = Math.round(p.price);
      if (ts < NOW && p.price !== old) { logPrice(ts, p, 'price', old, p.price, pick(['rounding', 'competitor price', 'slow mover']), OWNER);
        p.marginValue = p.marginMode === 'percent' ? Math.round((p.price / p.cost - 1) * 100) : r2(p.price - p.cost); } else p.price = old; }

    // Credit customers settle up every couple of weeks.
    customers.forEach((c) => {
      if (!(c.balance > 0) || !chance(c.big ? 0.12 : 0.06)) return;
      const ts = at(day, between(9, 17));
      if (ts >= NOW) return;
      const amount = Math.min(c.balance, Math.max(100, Math.round(c.balance * (0.5 + rnd() * 0.5) / 100) * 100));
      ledger.push({ id: uid('led'), ts: ts.getTime(), customerId: c.id, customerName: c.name, type: 'payment', amount: r2(amount), orderId: '', note: pick(['Cash', 'GCash', 'Check']) });
      c.balance = r2(c.balance - amount);
    });

    // The drawer at close, if the day is over.
    const close = at(day, 18, 30);
    if (close < NOW) {
      const todays = orders.filter((o) => ymd(new Date(o.ts)) === key);
      let expectedCash = 0, cashSales = 0, adj = 0;
      todays.forEach((o) => {
        const cash = o.payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
        if (o.status === 'completed') { expectedCash += cash; if (cash) cashSales++; } else if (o.status !== 'saved') { if (o.status === 'return') expectedCash -= cash; adj++; }
      });
      expectedCash = r2(expectedCash);
      const diff = chance(0.8) ? 0 : pick([-150, -50, -20, -5, 5, 10, 20]);
      closeouts.unshift({ id: 'drawer_demo' + d, ts: close.getTime(), date: key, expectedCash, cashSales, adjustments: adj,
        countedCash: r2(expectedCash + diff), difference: diff, notes: diff ? (diff < 0 ? 'Short, recounted twice' : 'Over, change not given?') : '', cashier: pick(onDuty) });
    }
  }

  // A draft being built and one cancelled order, so every PO status shows up.
  const draftSup = SUP[5];
  pos.push({ id: uid('po'), number: 'PO-' + String(++poNum).padStart(4, '0'), supplierId: draftSup.id, status: 'draft', orderedAt: '', sentAt: '', promisedAt: '', expectedAt: '',
    receivedAt: '', note: 'Add the gloves before sending', updatedAt: NOW.toISOString(),
    items: live.filter((p) => p.supplierId === draftSup.id).slice(0, 3).map((p) => ({ id: uid('pol'), productId: p.id, qty: 10, cost: p.cost, receivedQty: 0, invoiceCost: null, shortReason: '' })) });
  const cxl = pos.find((p) => p.status === 'ordered');
  if (cxl) { cxl.status = 'cancelled'; cxl.note = 'Supplier out of stock, ordered elsewhere'; }

  orders.sort((a, b) => a.ts - b.ts);
  movements.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  Object.values(ev).forEach((rows) => rows.sort((a, b) => (a.ts < b.ts ? -1 : 1)));
  customers.forEach((c) => { c.currentBalance = r2(c.balance || 0); delete c.balance; delete c.every; delete c.big; delete c.next; delete c.stopsAt; });
  products.forEach((p) => { delete p.pop; });

  const K = 'hwpos.';
  put(K + 'folders.v2', folders);
  put(K + 'groups.v1', groups);
  put(K + 'products.v2', products);
  put(K + 'orders.v1', orders);
  put(K + 'orderSeq.v1', String(seq[1]));
  put(K + 'customers.v1', customers);
  put(K + 'customerLedger.v1', ledger);
  put(K + 'drawerCloseouts.v1', closeouts);
  put(K + 'stockMovements.v1', movements);
  put(K + 'purchaseOrders.v1', pos);
  put(K + 'suppliers.v1', SUP.map(({ lead, late, short, ...s }) => s));
  put(K + 'staff.v1', staff);
  put(K + 'adjustments.v1', adjustments);
  // A monthly target a little above the last 90 days' pace, so the target cards have numbers.
  const last90 = orders.filter((o) => o.status === 'completed' && o.ts > NOW - 90 * 864e5).reduce((t, o) => t + o.total, 0);
  put(K + 'settings.v1', { targets: { month: Math.round(last90 / 3 * 1.05 / 10000) * 10000 } });
  Object.entries(ev).forEach(([log, rows]) => put(K + log + '.v1', rows));

  const mb = [...mem.values()].reduce((n, v) => n + v.length, 0) / 1048576;
  window.HWPOS_DEMO = { days: DAYS, orders: orders.length, perDay: Math.round(orders.length / DAYS), movements: movements.length,
    products: products.length, customers: customers.length, purchaseOrders: pos.length, priceChanges: ev.priceLog.length,
    lostDemand: ev.lostDemand.length, deliveries: ev.deliveryEvents.length, mb: r2(mb), ms: Math.round(performance.now() - t0) };
  console.log('[demo]', window.HWPOS_DEMO);

  // No on-screen pill (owner, 2026-09-25): the demo is dev-only. Turn it off at /demo/off.
})();
