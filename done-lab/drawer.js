/* The cash drawer controller: everything that opens the drawer lives in this one file.
 *
 * The drawer plugs into the receipt printer's DK port (the RJ11/RJ12 phone-style socket), and the
 * printer fires the pulse that springs it. So the drawer goes wherever the printer goes: Wi-Fi
 * (Epson ePOS-Print XML) or Bluetooth (ESC/POS bytes), through printer.js's send().
 *
 * Drawer doesn't open? Change the knobs below, then Settings › Printing › Test drawer:
 *   PIN    0 = pin 2 (most drawers), 1 = pin 5 (some two-drawer setups)
 *   ON_MS  how long the pulse holds, 100-500 in steps of 100 (a weak latch wants longer)
 *   OFF_MS the rest after it (ESC/POS only, max 510)
 * Another brand that ignores both? Its command goes in ESCPOS / EPOS, nothing else changes.
 *
 * Run `node pos-lab/drawer.js` for the self-check.
 */
(function (g) {
  const PIN = 0;
  const ON_MS = 100, OFF_MS = 500;

  // ESC p m t1 t2 (times in 2 ms steps): 1B 70 00 32 FA
  const ESCPOS = [0x1B, 0x70, PIN, ON_MS / 2, OFF_MS / 2];
  // Epson ePOS-Print: drawer_1 = pin 2, drawer_2 = pin 5
  const EPOS = '<pulse drawer="drawer_' + (PIN + 1) + '" time="pulse_' + ON_MS + '"/>';

  // Opens the drawer on the paired printer. cfg = printerConfig(). Throws a plain sentence on failure.
  function open(cfg) {
    const c = cfg || {};
    if (c.driver !== 'network' && c.driver !== 'bluetooth') throw new Error('Pick a Wi-Fi or Bluetooth printer first: the drawer opens through it');
    return g.HWPOS_PRINTER.send([{ op: 'raw', bytes: ESCPOS, xml: EPOS }], c).then(() => 'Drawer opened');
  }

  const API = { open, ESCPOS, EPOS };
  g.HWPOS_DRAWER = API;
  if (typeof module === 'object' && module.exports) module.exports = API;

  // ponytail: the self-check rides along; it fails if a knob makes a byte the printer can't take.
  if (typeof require === 'function' && typeof module === 'object' && require.main === module) {
    const assert = require('node:assert/strict'), P = require('./printer.js');
    assert.deepEqual(ESCPOS, [0x1B, 0x70, 0, 50, 250]);
    assert.ok(ESCPOS.every(b => Number.isInteger(b) && b >= 0 && b <= 255), 'every ESC/POS byte fits');
    assert.ok(/^pulse_[1-5]00$/.test(EPOS.match(/time="([^"]+)"/)[1]), 'ePOS time is pulse_100..pulse_500');
    const bytes = Array.from(P.escpos([{ op: 'raw', bytes: ESCPOS, xml: EPOS }]));
    assert.deepEqual(bytes.slice(-5), ESCPOS, 'Bluetooth sends the kick after the init');
    assert.ok(P.eposXml([{ op: 'raw', bytes: ESCPOS, xml: EPOS }]).includes('<pulse drawer="drawer_1" time="pulse_100"/>'), 'Wi-Fi sends the pulse');
    assert.throws(() => open({ driver: 'browser' }), /Pick a Wi-Fi or Bluetooth printer/);
    console.log('drawer-check: ok');
  }
})(typeof window !== 'undefined' ? window : globalThis);
