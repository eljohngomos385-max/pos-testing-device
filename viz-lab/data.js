// Viz lab — one shared demo data set, numbers taken from the live back office screenshots
// (2026-10-18, Last 7 days unless named). Every component reads VIZ; none invents its own figures.
(function () {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const VIZ = {
    peso: (n, d = 0) => (n < 0 ? '−' : '') + '₱' + Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d }),
    pesoK: n => '₱' + (Math.abs(n) >= 1000 ? (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : Math.round(n)),
    pct: (n, d = 1) => n.toFixed(d) + '%',

    // Home KPI strip (this 7 days vs the 7 before)
    kpis: [
      { id: 'net', label: 'Net sales', value: 338080, money: true, change: -13.3 },
      { id: 'gp', label: 'Gross profit', value: 55779, money: true, change: -16.5 },
      { id: 'orders', label: 'Orders', value: 317, change: -16.6 },
      { id: 'margin', label: 'Margin', value: 18.5, pct: true, change: -3.7 },
    ],
    // Net sales per day, this week (Sun = today, not started) and last week
    week: [
      { d: 'Mon', net: 69800, prev: 74200, orders: 64 },
      { d: 'Tue', net: 49900, prev: 58100, orders: 47 },
      { d: 'Wed', net: 49300, prev: 61400, orders: 46 },
      { d: 'Thu', net: 62100, prev: 66900, orders: 58 },
      { d: 'Fri', net: 68700, prev: 79300, orders: 63 },
      { d: 'Sat', net: 38280, prev: 50100, orders: 39 },
      { d: 'Sun', net: 0, prev: 0, orders: 0, now: true },
    ],
    dailyTarget: 60000,
    monthTarget: { goal: 1500000, done: 985308 },

    // Payment methods (count, net) — 7 days, and the 30-day Summary set
    payments: [
      { m: 'Cash', key: 'cash', n: 180, amt: 163145 },
      { m: 'Account', key: 'acct', n: 17, amt: 69684 },
      { m: 'GCash', key: 'gcash', n: 77, amt: 67372 },
      { m: 'QR', key: 'qr', n: 28, amt: 24115 },
      { m: 'Maya', key: 'maya', n: 18, amt: 13763 },
    ],
    payments30: [
      { m: 'Cash', amt: 462457, prev: 431200 }, { m: 'Account', amt: 221119, prev: 240300 },
      { m: 'GCash', amt: 176515, prev: 150100 }, { m: 'QR', amt: 81902, prev: 70400 }, { m: 'Maya', amt: 43315, prev: 47900 },
    ],
    fulfilment: [{ m: 'Walk-in', n: 280, amt: 227332 }, { m: 'Delivery', n: 37, amt: 110748 }],
    staff: [
      { name: 'Aldrin S.', n: 71, amt: 101740, voids: 1, refunds: 2 },
      { name: 'Maricel R.', n: 97, amt: 97525, voids: 3, refunds: 3 },
      { name: 'Joy P.', n: 101, amt: 93320, voids: 2, refunds: 3 },
      { name: 'Liza M.', n: 48, amt: 45494, voids: 4, refunds: 3 },
    ],
    // The ladder (Sales › Summary, 30 days) — words from sales-terms
    ladder: { gross: 1003113.01, voids: -6232.71, voidsN: 9, refunds: -7526.27, refundsN: 9, discounts: -4046.43, net: 985307.60, vat: 105568.80, beforeVat: 879738.80, cost: 802110.40, gp: 183197.20 },

    // Top items (30 days)
    topItems: [
      { name: 'Deformed Bar Grade 33 12mm × 6m', cat: 'Fasteners', units: 332, unit: '', amt: 87181, margin: 14.2, prev: 79100 },
      { name: 'Deformed Bar Grade 33 16mm × 6m', cat: 'Fasteners', units: 131, unit: '', amt: 63348, margin: 13.1, prev: 66200 },
      { name: 'Hollow Block 5"', cat: 'Cement', units: 2607, unit: '', amt: 47574, margin: 22.5, prev: 41800 },
      { name: 'Portland Cement 40kg', cat: 'Cement', units: 109, unit: 'bag', amt: 31015, margin: 9.8, prev: 33900 },
      { name: 'Deformed Bar Grade 33 10mm × 6m', cat: 'Fasteners', units: 157, unit: '', amt: 26835, margin: 15.0, prev: 22100 },
      { name: 'Hollow Block 4" · Local', cat: 'Cement', units: 1781, unit: '', amt: 23153, margin: 24.1, prev: 25000 },
      { name: 'Hollow Block 4" · Generic', cat: 'Cement', units: 1599, unit: '', amt: 22268, margin: 21.7, prev: 19300 },
      { name: 'Gravel 3/4" (per cu.m)', cat: 'Cement', units: 14, unit: 'cu.m', amt: 20025, margin: 18.4, prev: 21900 },
      { name: 'Holcim Excel Cement 40kg', cat: 'Cement', units: 74, unit: 'bag', amt: 19872, margin: 10.6, prev: 15800 },
      { name: 'Washed Sand (per cu.m)', cat: 'Cement', units: 12, unit: 'cu.m', amt: 19295, margin: 19.9, prev: 18700 },
    ],
    allItemsNet: 985308,
    categories: [
      { c: 'Cement', amt: 312400, prev: 290100, items: 38 }, { c: 'Fasteners', amt: 241700, prev: 236900, items: 112 },
      { c: 'Electrical', amt: 118300, prev: 131000, items: 164 }, { c: 'Plumbing', amt: 96200, prev: 88400, items: 141 },
      { c: 'Paint', amt: 71800, prev: 80200, items: 96 }, { c: 'Lumber', amt: 58900, prev: 51300, items: 44 },
      { c: 'Tools', amt: 46100, prev: 49800, items: 210 }, { c: 'Roofing', amt: 39908, prev: 33100, items: 27 },
    ],
    boughtTogether: [
      { a: 'Portland Cement 40kg', b: 'Washed Sand (per cu.m)', n: 41, lift: 3.2 },
      { a: 'Hollow Block 4" · Local', b: 'Portland Cement 40kg', n: 37, lift: 2.6 },
      { a: 'Deformed Bar 10mm', b: 'Tie Wire #16', n: 29, lift: 4.1 },
      { a: 'PVC Pipe 1/2"', b: 'PVC Elbow 1/2"', n: 26, lift: 5.4 },
      { a: 'THHN Stranded #12', b: 'Electrical Tape', n: 22, lift: 2.9 },
      { a: 'Paint Brush 3"', b: 'Boysen Latex White 4L', n: 18, lift: 3.7 },
      { a: 'Gravel 3/4"', b: 'Washed Sand (per cu.m)', n: 16, lift: 4.8 },
      { a: 'Wood Screw #8', b: 'Marine plywood 3/4"', n: 12, lift: 2.2 },
    ],

    // Stock history (7 days)
    lostDemand: [
      { name: 'Fiber cement board', n: 2, last: 'Sat' }, { name: 'Welding rod 6013', n: 2, last: 'Fri' },
      { name: 'Paint Brush 3"', n: 2, last: 'Fri' }, { name: 'Marine plywood 3/4"', n: 2, last: 'Wed' },
      { name: 'THHN Stranded #8', n: 1, last: 'Tue' },
    ],
    countMismatch: [
      { name: 'Gate Valve Brass 3/4"', expected: 15, counted: 16, unit: '', cost: 486.00 },
      { name: 'Gravel 3/4 (per cu.m)', expected: 9.50, counted: 8.62, unit: 'cu.m', cost: 1050.00 },
      { name: 'Tox Plug #8', expected: 400, counted: 372, unit: '', cost: 1.37 },
      { name: 'Hollow Block 4" · Local', expected: 620, counted: 611, unit: '', cost: 9.80 },
    ],
    costChanges: [
      { name: 'Wood Screw #8 × 1 1/2"', from: 2.71, to: 2.45, supplier: 'Asia Fasteners' },
      { name: 'Wheelbarrow Heavy Duty', from: 1272.19, to: 1150.92, supplier: 'Ace Tools PH' },
      { name: 'Hex Bolt M10 × 100mm', from: 10.64, to: 9.63, supplier: 'Asia Fasteners' },
      { name: 'Tox Plug #8', from: 1.51, to: 1.37, supplier: 'Asia Fasteners' },
      { name: 'Gravel 3/4" (per cu.m)', from: 1143.63, to: 1050.00, supplier: 'Rizal Aggregates' },
      { name: 'Portland Cement 40kg', from: 268.00, to: 279.50, supplier: 'Holcim Dealer' },
    ],
    // Where stock went (units by reason, value at cost) — 7 days
    whereItWent: [
      { r: 'Sold', value: 281400 }, { r: 'Refunded back in', value: -6100 }, { r: 'Damaged', value: 3200 },
      { r: 'Count fix', value: 1860 },
    ],
    stockFlow: { opening: 1842300, received: 312600, sold: 281400, refundsIn: 6100, damaged: 3200, countFix: -1860, closing: 1874540 },
    // Stock history tables (round 3). movements = the newest 10 of 62 non-sale moves in 7 days, as the real page shows them.
    movements: [
      { when: 'Oct 16, 4:10 PM', item: 'Flexible Hose 16"', note: 'Wrong item rung up', r: 'Void', qty: 4, bal: 23 },
      { when: 'Oct 16, 1:47 PM', item: 'LED Bulb Daylight 9W', note: 'Returned items', r: 'Refund', qty: 3, bal: 25 },
      { when: 'Oct 16, 11:51 AM', item: 'Deformed Bar Grade 33 12mm × 6m', note: 'Returned items', r: 'Refund', qty: 6, bal: 223 },
      { when: 'Oct 16, 11:51 AM', item: 'Hex Bolt M10 × 100mm', r: 'Delivery', qty: 101, bal: 345 },
      { when: 'Oct 16, 11:47 AM', item: 'PVC Solvent Cement 400mL', r: 'Delivery', qty: 30, bal: 44 },
      { when: 'Oct 16, 11:47 AM', item: 'Sandpaper #120', r: 'Delivery', qty: 410, bal: 653 },
      { when: 'Oct 16, 11:47 AM', item: 'PVC Solvent Cement 200mL', r: 'Delivery', qty: 120, bal: 170 },
      { when: 'Oct 16, 11:47 AM', item: 'Fine Sand (per cu.m)', r: 'Delivery', qty: 16, bal: 24.64 },
      { when: 'Oct 16, 9:01 AM', item: 'PVC Elbow 3/4"', r: 'Delivery', qty: 240, bal: 361 },
      { when: 'Oct 15, 2:50 PM', item: 'Floor Drain Stainless 3" × 3"', r: 'Delivery', qty: 15, bal: 20 },
    ],
    movesTotal: 62,
    // all 62 non-sale moves by reason, 7 days: count and value at cost (demo split, sums to 62)
    movesByReason: [
      { r: 'Delivery', n: 38, value: 312600 }, { r: 'Refund', n: 9, value: 6100 }, { r: 'Void', n: 9, value: 4870 },
      { r: 'Count', n: 4, value: 1860 }, { r: 'Damaged', n: 2, value: 3200 },
    ],
    // price changes, 30 days (newest first); only the first is inside the 7-day window
    priceChanges: [
      { when: 'Oct 15, 6:46 PM', item: 'THHN Wire #14 (per meter)', what: 'Price', from: 22.00, to: 23.75 },
      { when: 'Oct 9, 10:12 AM', item: 'Portland Cement 40kg', what: 'Price', from: 285.00, to: 295.00 },
      { when: 'Oct 3, 4:30 PM', item: 'Boysen Latex White 4L', what: 'Price', from: 640.00, to: 615.00 },
      { when: 'Sep 28, 9:05 AM', item: 'Hollow Block 4" · Local', what: 'Price', from: 13.00, to: 13.50 },
      { when: 'Sep 24, 2:18 PM', item: 'PVC Pipe 1/2"', what: 'Price', from: 98.00, to: 92.00 },
    ],
    stockByDay: [ // value moved per day: in (received) and out (sold + losses)
      { d: 'Mon', in: 84200, out: 58100 }, { d: 'Tue', in: 0, out: 41300 }, { d: 'Wed', in: 126400, out: 40900 },
      { d: 'Thu', in: 0, out: 51600 }, { d: 'Fri', in: 102000, out: 57200 }, { d: 'Sat', in: 0, out: 31260 }, { d: 'Sun', in: 0, out: 0, now: true },
    ],

    // Customers (round 7, 30 days). The five account customers are the app's seed (data.js CUSTOMERS: names, type, limit, balance);
    // their spend is demo. Walk-in = everything not rung up to a named customer, so named + walk-in = ladder.net.
    customers: [
      { name: 'Lopez Hardware', type: 'Wholesale', orders: 14, amt: 96800, prev: 88200, last: 'Sat', limit: 100000, balance: 0, oldest: 0 },
      { name: 'Ricardo Construction', type: 'Contractor', orders: 22, amt: 78450, prev: 91300, last: 'Fri', limit: 30000, balance: 8450, oldest: 12 },
      { name: 'Engr. Cruz', type: 'Residential', orders: 9, amt: 52300, prev: 21400, last: 'Thu', limit: 50000, balance: 22450, oldest: 34 },
      { name: 'Rivera Plumbing', type: 'Contractor', orders: 18, amt: 34900, prev: 36100, last: 'Sat', limit: 20000, balance: 0, oldest: 0 },
      { name: 'Marie Variety Store', type: 'Retail', orders: 31, amt: 23950, prev: 25800, last: 'Wed', limit: 5000, balance: 1280.50, oldest: 5 },
    ],
    walkIn: 698908, // ladder.net 985,308 − the five above (286,400)
    // Account money, 30 days: opening owed + charged to account (= payments30 Account) − paid back = owed now (= sum of balances)
    accounts: { opening: 9661.50, charged: 221119, paid: 198600, closing: 32180.50, overdueDays: 30 },

    // Suppliers (round 7). Received at cost; the 7-day split matches stockByDay (Mon 84.2k, Wed 126.4k, Fri 102k = 312,600).
    suppliers: [
      { name: 'Holcim Dealer', cat: 'Cement', items: 8, pos: 6, onTime: 5, lead: 2, amt30: 412500, prev30: 389000, amt7: 126400, day7: 'Wed', owed: 82500, due: 'Oct 24' },
      { name: 'Asia Fasteners', cat: 'Fasteners', items: 74, pos: 8, onTime: 8, lead: 4, amt30: 298300, prev30: 311200, amt7: 84200, day7: 'Mon', owed: 41200, due: 'Oct 20' },
      { name: 'Rizal Aggregates', cat: 'Cement', items: 5, pos: 5, onTime: 3, lead: 1, amt30: 186400, prev30: 172900, amt7: 58300, day7: 'Fri', owed: 58300, due: 'Oct 31' },
      { name: 'Pacific Electrical', cat: 'Electrical', items: 96, pos: 4, onTime: 4, lead: 6, amt30: 154200, prev30: 166000, amt7: 43700, day7: 'Fri', owed: 0, due: '' },
      { name: 'Ace Tools PH', cat: 'Tools', items: 61, pos: 3, onTime: 2, lead: 9, amt30: 98700, prev30: 82300, amt7: 0, day7: '', owed: 12400, due: 'Oct 12', overdue: true },
      { name: 'Boysen Paints', cat: 'Paint', items: 38, pos: 2, onTime: 2, lead: 5, amt30: 64700, prev30: 71500, amt7: 0, day7: '', owed: 0, due: '' },
    ],
    // Purchase orders still coming (Suppliers › Incoming)
    incoming: [
      { po: 'PO-0141', supplier: 'Boysen Paints', amt: 22800, due: 'Oct 20', lines: 9 },
      { po: 'PO-0139', supplier: 'Asia Fasteners', amt: 38900, due: 'Oct 21', lines: 14 },
      { po: 'PO-0140', supplier: 'Pacific Electrical', amt: 51600, due: 'Oct 23', lines: 22 },
    ],
  };

  // Orders by weekday × hour (7 AM – 6 PM), 7 days
  VIZ.hours = ['7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p'];
  const shape = [2, 5, 7, 8, 6, 4, 5, 7, 6, 5, 3, 1];
  VIZ.heat = VIZ.week.slice(0, 6).map(w => ({ d: w.d, v: shape.map(s => Math.max(0, Math.round(s * (w.orders / 60) * (0.6 + rnd() * 0.8)))) }));
  VIZ.heat.push({ d: 'Sun', v: shape.map(() => 0) });
  // Net sales per day for the last 26 weeks (GitHub-style calendar). Sundays closed.
  VIZ.days = [];
  const end = new Date(2026, 9, 18);
  for (let i = 181; i >= 0; i--) {
    const dt = new Date(end); dt.setDate(end.getDate() - i);
    const dow = dt.getDay();
    const v = i === 0 ? 0 : dow === 0 ? Math.round(rnd() * 8000) : Math.round(32000 + rnd() * 48000 + (dow === 5 ? 9000 : 0));
    VIZ.days.push({ date: dt.toISOString().slice(0, 10), dow, net: v });
  }
  window.VIZ = VIZ;
})();
