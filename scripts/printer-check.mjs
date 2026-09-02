// Smallest check that fails if the receipt layout or either encoder breaks.
// Run: node scripts/printer-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../printer.js');

const vm = {
  store: { name: 'EJ Hardware', address: 'Main Store, Laguna', phone: '0917-000-0000', tin: '000-000-000-000' },
  number: '0001', dateText: '01/09/2026 3:04 PM', cashier: 'El John', register: '1',
  fulfilmentLabel: 'PICKUP', status: 'completed',
  items: [
    { name: 'Portland Cement 40kg', qty: 2, unit: 'bag', price: 285, lineTotal: 570 },
    { name: 'Extremely Long Product Name That Must Wrap Across Lines', qty: 1, unit: 'pc', price: 1234.5, lineTotal: 1234.5 },
  ],
  totals: { subtotal: 1804.5, discount: 0, total: 1804.5, vatRate: 0.12, vatAmount: 193.34, vatableSales: 1611.16 },
  payments: [{ method: 'cash', amount: 1804.5, tendered: 2000, change: 195.5 }],
};

// --- columns ---
assert.equal(P.colsFor('58mm'), 32);
assert.equal(P.colsFor('80mm'), 48);

// --- money ---
assert.equal(P.money(1234.5), '1,234.50');
assert.equal(P.money(0), '0.00');
assert.equal(P.money(1234567.891), '1,234,567.89');

// --- ascii folding: peso sign must never reach the printer ---
assert.equal(P.ascii('₱100 × 2'), 'P100 x 2');

// --- pad: label left, value right, exactly cols wide ---
assert.equal(P.pad('TOTAL', '1,804.50', 32).length, 32);
assert.match(P.pad('TOTAL', '1,804.50', 32), /^TOTAL {19}1,804\.50$/);
// overflow drops the value to its own right-aligned line
const over = P.pad('A'.repeat(28), '1,804.50', 32);
assert.ok(over.includes('\n'), 'long label must wrap the value onto its own line');
assert.equal(over.split('\n')[1].length, 32);

// --- wrap: never exceeds cols, loses no words ---
for (const cols of [32, 48]) {
  const lines = P.wrap(vm.items[1].name, cols);
  lines.forEach(l => assert.ok(l.length <= cols, `wrapped line over ${cols}: ${l}`));
  assert.equal(lines.join(' '), vm.items[1].name);
}
assert.deepEqual(P.wrap('', 32), ['']);
// a single word longer than the paper is hard-split, not dropped
assert.deepEqual(P.wrap('X'.repeat(70), 32).join(''), 'X'.repeat(70));

// --- layout ---
const ops = P.layout(vm, { width: '58mm' });
const text = P.preview(vm, { width: '58mm' });
assert.ok(text.includes('EJ Hardware'));
assert.ok(text.includes('P0001') || text.includes('0001'));
assert.match(text, /TOTAL {19}1,804\.50/);
assert.match(text, /CASH {20}2,000\.00/);
assert.match(text, /CHANGE {20}195\.50/);
assert.match(text, /VAT \(12%\)/);
assert.ok(text.includes('Goods sold are not returnable.'));
text.split('\n').forEach(l => assert.ok(l.length <= 32, `receipt line over 32 cols: "${l}"`));
assert.ok(ops.some(o => o.op === 'cut'), 'cut expected by default');
assert.ok(!P.layout(vm, { cut: false }).some(o => o.op === 'cut'), 'cut must be suppressible');

// saved (unpaid) receipts show status instead of payments
assert.ok(P.preview({ ...vm, status: 'saved' }, {}).includes('NOT COMPLETED'));

// --- ESC/POS encoder ---
const bytes = P.escpos(ops);
assert.ok(bytes instanceof Uint8Array && bytes.length > 200);
assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40], 'must start with ESC @ init');
assert.deepEqual([...bytes.slice(-4)], [0x1d, 0x56, 0x42, 0x00], 'must end with the cut command');
bytes.forEach(b => assert.ok(b <= 0xff));

// --- ePOS-Print XML encoder ---
const xml = P.eposXml(ops);
assert.ok(xml.startsWith('<?xml'));
assert.ok(xml.includes('www.epson-pos.com/schemas/2011/03/epos-print'));
assert.ok(xml.includes('<cut type="feed"/>'));
assert.ok(xml.includes('<text align="center"/>'));
// XML must be escaped, not injectable
const evil = P.eposXml(P.layout({ ...vm, store: { name: 'A<b>&"' } }, {}));
assert.ok(!/<b>/.test(evil) && evil.includes('&lt;b&gt;&amp;&quot;'), 'store name must be XML-escaped');

// --- URL building ---
const tail = '/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000';
assert.equal(P.eposUrl('192.168.1.50'), 'http://192.168.1.50' + tail);
assert.equal(P.eposUrl('192.168.1.50:8008'), 'http://192.168.1.50:8008' + tail);
assert.equal(P.eposUrl('https://printer.local'), 'https://printer.local' + tail);
assert.equal(P.eposUrl('http://1.2.3.4' + tail), 'http://1.2.3.4' + tail);
assert.throws(() => P.eposUrl(''), /No printer address/);

console.log('printer-check: all assertions passed');
console.log('\n--- 58mm preview ---\n' + text);

// ---------- delivery map raster ----------

// packMono: 0 = black -> bit set. Solid black row of 8 = 0xFF, solid white = 0x00.
{
  const black = P.packMono(new Float32Array(8 * 2).fill(0), 8, 2);
  assert.deepEqual([...black], [0xFF, 0xFF], 'all-black packs to set bits');
  const white = P.packMono(new Float32Array(8 * 2).fill(255), 8, 2);
  assert.deepEqual([...white], [0x00, 0x00], 'all-white packs to clear bits');
}

// Row padding: 12 px wide -> 2 bytes per row, trailing 4 bits unused.
{
  const bits = P.packMono(new Float32Array(12 * 3).fill(255), 12, 3);
  assert.equal(bits.length, 2 * 3, '12px rows pad to 2 bytes');
}

// Dithering must preserve mid-grey density: 50% grey over a big field lands near half the dots.
{
  const w = 64, h = 64;
  const bits = P.packMono(new Float32Array(w * h).fill(128), w, h);
  let on = 0;
  for (const b of bits) on += b.toString(2).split('1').length - 1;
  const ratio = on / (w * h);
  assert.ok(ratio > 0.35 && ratio < 0.65, `mid-grey dithers to ~50% dots, got ${(ratio * 100).toFixed(1)}%`);
}

// The image op reaches both encoders.
{
  const img = { w: 16, h: 4, bits: P.packMono(new Float32Array(16 * 4).fill(0), 16, 4) };
  const vm = {
    store: { name: 'S' }, number: '1', dateText: 'x', cashier: 'c', register: '1',
    fulfilmentLabel: 'DELIVERY', deliveryAddress: 'Somewhere',
    items: [{ name: 'Nail', qty: 1, unit: 'pc', price: 10, lineTotal: 10 }],
    totals: { subtotal: 10, total: 10 }, payments: [{ method: 'cash', tendered: 10, change: 0 }],
  };
  img.caption = 'Delivery location';
  const ops = P.layout(vm, { width: '80mm', mapImage: img });
  const at = ops.findIndex(o => o.op === 'image');
  assert.deepEqual(ops[at + 1], { op: 'text', v: 'Delivery location' }, 'caption prints directly under the map');
  assert.ok(ops.findIndex(o => o.op === 'image') < ops.findIndex(o => o.op === 'text' && o.v === 'Thank you!'),
    'map sits before the thank-you block');
  assert.equal(ops.filter(o => o.op === 'image').length, 1, 'delivery layout emits exactly one map');

  const xml = P.eposXml(ops);
  // 16x4 all black = 8 bytes of 0xFF -> base64 "//////////8=".
  assert.ok(xml.includes('<image width="16" height="4" color="color_1" mode="mono">//////////8=</image>'),
    'ePOS image element carries the packed raster');

  const bytes = P.escpos(ops);
  const gs = [...bytes].findIndex((b, i) =>
    b === 0x1D && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00);
  assert.ok(gs > 0, 'ESC/POS emits GS v 0');
  assert.deepEqual([...bytes.slice(gs + 4, gs + 8)], [2, 0, 4, 0], 'GS v 0 header = 2 bytes/row, 4 rows');

  // Pickup orders never carry a map, even if one is passed in.
  const pickup = P.layout({ ...vm, fulfilmentLabel: 'PICKUP' }, { width: '80mm', mapImage: img });
  assert.equal(pickup.filter(o => o.op === 'image').length, 0, 'pickup receipts print no map');
}

// A tall raster is split into <=128-row bands.
{
  const img = { w: 8, h: 300, bits: P.packMono(new Float32Array(8 * 300).fill(0), 8, 300) };
  const bytes = P.escpos([{ op: 'image', v: img }]);
  let bands = 0;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x1D && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30 && bytes[i + 3] === 0x00) bands++;
  }
  assert.equal(bands, 3, '300 rows -> 3 bands of <=128');
}

// 'sharp' mode thresholds instead of dithering: a flat mid-grey field goes entirely one way,
// where the dither would have stippled it ~50/50.
{
  const sharp = P.packMono(new Float32Array(64 * 64).fill(230), 64, 64, 'sharp');
  assert.ok(sharp.every(b => b === 0), 'sharp mode leaves a near-white field blank');
  const dark = P.packMono(new Float32Array(64 * 64).fill(100), 64, 64, 'sharp');
  assert.ok(dark.every(b => b === 0xFF), 'sharp mode fills a dark field solid');

  // Dilation: one dark pixel must burn as a 5-dot plus, or thin map lines break up on paper.
  const dot = new Float32Array(9 * 9).fill(255);
  dot[4 * 9 + 4] = 0;
  const grown = P.packMono(dot, 9, 9, 'sharp');
  let lit = 0;
  for (const b of grown) lit += b.toString(2).split('1').length - 1;
  assert.equal(lit, 5, 'a single dark pixel dilates to 5 dots');
}
