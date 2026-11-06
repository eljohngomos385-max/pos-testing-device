/* printer.js — direct receipt printing.
 * One layout, two encoders:
 *   Wi-Fi  : Epson ePOS-Print XML  -> POST to the printer's built-in web service (TM-m30III, TM-m30II, TM-T88VI/VII...)
 *   BT     : raw ESC/POS bytes     -> Web Bluetooth GATT write
 * Falls back to the existing pop-up (window.print) via app.js.
 * No SDK, no dependency — ePOS-Print is plain XML over HTTP, ESC/POS is plain bytes.
 */
(function (g) {
  'use strict';

  // ---------- text helpers ----------

  // ponytail: thermal printers run a legacy code page; peso/multiply/curly quotes garble. Fold to ASCII.
  const ASCII_MAP = { '₱': 'P', '×': 'x', '·': '-', '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...' };
  function ascii(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents come off, the letter stays: Año -> Ano
      .replace(/[₱×·–—“”‘’…]/g, ch => ASCII_MAP[ch])
      .replace(/[^\x20-\x7E\n]/g, '');
  }

  // The receipt maths is SalesMath's (one formula per number); in Node the check script loads it beside us.
  // ponytail: resolved per call, so script order on the page doesn't matter.
  const SM = () => g.SalesMath || require('./sales-math.js');

  // The store's currency decides the decimals (P 2, Y 0); the symbol stays off the slip.
  function money(n, currency) {
    const v = Number(n) || 0;
    const s = SM().formatMoney(Math.abs(v), currency).replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, '');
    return (v < 0 && /[1-9]/.test(s) ? '-' : '') + s;
  }

  function wrap(s, cols) {
    const out = [];
    let line = '';
    for (const w of ascii(s).split(/\s+/)) {
      if (!w) continue;
      if (!line) line = w;
      else if (line.length + 1 + w.length <= cols) line += ' ' + w;
      else { out.push(line); line = w; }
      while (line.length > cols) { out.push(line.slice(0, cols)); line = line.slice(cols); }
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  // label left, value right — the receipt's repeating unit. Overflow drops the value to its own right-aligned line(s).
  function pad(l, r, cols) {
    const a = ascii(l), b = ascii(r);
    const gap = cols - a.length - b.length;
    if (gap >= 1) return a + ' '.repeat(gap) + b;
    return [...(a.length > cols ? wrap(a, cols) : [a]), ...(b ? wrap(b, cols) : []).map(x => ' '.repeat(cols - x.length) + x)].join('\n');   // a value wider than the paper (a long ref no.) wraps
  }

  function colsFor(width) {
    return /80/.test(String(width || '')) ? 48 : 32;
  }

  // The money lines under TOTAL, from the receipt view model (app.js toReceiptViewModel), as [label, amount],
  // unsigned. Used by this layout and by the till's on-screen slips, so paper and screen say the same.
  // A sale names each tender (vm.legs, SalesMath.paymentsOf: 'GCash', never 'Refund'); CASH is what was
  // handed over, then CHANGE. A void or refund is money going back: GIVEN BACK and the tender, never
  // 'CASH 237.86' as if it came in. A parked cart has none.
  // An exchange (vm.swapped, SalesMath.receiptParts) prints its swap once as EXCHANGE; only the money that changed
  // hands follows it.
  // `plain`: the words as written (Modern: 'Cash', 'GCash'), not in capitals (Classic).
  function payRows(vm, plain) {
    if (!vm || vm.status === 'saved') return [];
    const U = s => (plain ? String(s) : String(s).toUpperCase());
    const legs = vm.legs || [];
    const name = (p, i) => U((legs[i] && legs[i].label) || p.label || p.method);
    const swap = Number(vm.swapped) > 0 ? [[U('Exchange'), Number(vm.swapped)]] : [];
    const money = (vm.payments || []).map((p, i) => [p, i]).filter(([p]) => !(swap.length && p.ref));
    if (vm.paidWord === 'Given back') return swap.concat(money.map(([p, i]) => [U('Given back · ') + name(p, i), Number(p.amount) || 0]));
    // a sale's reference no. (Settings > Payment types) under its tender, as text; an exchange's or refund's ref is a marker, never printed
    // printed as the word it was asked as (refLabel: LAST 4 DIGITS); a cash ref comes after its change
    const ref = p => (!swap.length && p.ref ? [[U(p.refLabel || 'Ref no.'), String(p.ref)]] : []);
    return swap.concat(money.flatMap(([p, i]) => (p.method === 'cash'
      ? [[U('Cash'), SM().tenderedOf(p)], ...(p.change > 0 ? [[U('Change'), p.change]] : []), ...ref(p)]
      : [[name(p, i), Number(p.amount) || 0], ...ref(p)])));
  }

  // The totals block above TOTAL is SalesMath.totalRows, the one list every slip, the paper and the
  // back office receipt share.
  // A saved discount's name the paper can't print at all (all CJK) prints as the plain word.
  const totalRows = vm => SM().totalRows(vm && vm.discountName && !ascii(vm.discountName).trim() ? { ...vm, discountName: '' } : vm);

  // ---------- layout: receipt view model -> op list ----------

  // The receipt's two styles (Settings › Receipt › Style, owner 2026-11-06, receipt-look-lab): Classic (T1, the default) and
  // Modern (G2.2). Screen, pop-up and paper read these two, so all three say the same lines.
  // The address, then 'Tel' and the store's numbers, side by side with ' · ' while they fit the line (owner 2026-11-06:
  // full lines, never a number a line); a number never splits.
  function headLines(st, cols) {
    const nums = String(st.phone || '').split(' / ').filter(Boolean).map((n, i) => (i ? n : 'Tel ' + n));
    return [st.address, ...nums].filter(Boolean).reduce((out, t) => {
      const l = out.length && out[out.length - 1] + ' · ' + t;
      if (l && l.length <= cols) out[out.length - 1] = l; else out.push(t);
      return out;
    }, []);
  }
  // The customer's lines as [word, value]: who, where it goes, the SC/PWD cardholder, the order's note. A walk-in has none.
  function custLines(vm) {
    const c = vm.customer || {}, out = [];
    if (c.name) out.push(['Customer', c.name + (c.phone ? ' · ' + c.phone : '')]);
    if (String(vm.fulfilmentLabel || '').startsWith('DELIVERY') && vm.deliveryAddress) out.push(['Deliver to', vm.deliveryAddress]);
    if (vm.scPwdId) out.push(vm.scPwdId);
    if (vm.note) out.push(['Note', vm.note]);
    return out;
  }

  // The top of a plain slip (the shift summary): the store's name (double width = half the columns), address, phone, TIN, a rule.
  function storeHead(st, cols, ops) {
    const text = s => ops.push({ op: 'text', v: ascii(s) });
    ops.push({ op: 'align', v: 'center' }, { op: 'bold', v: true }, { op: 'big', v: true });
    wrap(st.name || '', Math.floor(cols / 2)).forEach(text);
    ops.push({ op: 'big', v: false }, { op: 'bold', v: false });
    if (st.address) wrap(st.address, cols).forEach(text);
    // Two or three numbers ("a / b", pos-settings.js) that run past one line print one number a line, never cut in half
    if (st.phone) ('Tel: ' + st.phone).length <= cols ? text('Tel: ' + st.phone) : st.phone.split(' / ').forEach((n, i) => text((i ? '' : 'Tel: ') + n));
    if (st.tin) text('TIN: ' + st.tin);
    ops.push({ op: 'align', v: 'left' }, { op: 'text', v: '-'.repeat(cols) });
  }

  // A plain slip that is not a sale (the shift summary, pos-shift.js): the store's head, a bold
  // title, then rows. A row is [label, value, bold?] -- a number prints as money, a string as is --
  // or '-' / '=' for a rule, or [text] for a wrapped line.
  function slipLayout(s, opts) {
    const o = opts || {}, cols = colsFor(o.width), ops = [], st = s.store || {};
    storeHead(st, cols, ops);
    if (s.title) ops.push({ op: 'align', v: 'center' }, { op: 'bold', v: true }, { op: 'text', v: ascii(s.title) }, { op: 'bold', v: false }, { op: 'align', v: 'left' });
    for (const r of s.rows || []) {
      if (r === '-' || r === '=') { ops.push({ op: 'text', v: r.repeat(cols) }); continue; }
      if (r.length === 1) { wrap(r[0], cols).forEach(t => ops.push({ op: 'text', v: t })); continue; }
      const v = typeof r[1] === 'number' ? money(r[1], st.currency) : String(r[1] == null ? '' : r[1]);
      if (r[2]) ops.push({ op: 'bold', v: true });
      ops.push({ op: 'text', v: pad(r[0], v, cols) });
      if (r[2]) ops.push({ op: 'bold', v: false });
    }
    ops.push({ op: 'feed', v: 4 });
    if (o.cut !== false) ops.push({ op: 'cut' });
    return ops;
  }

  function layout(vm, opts) {
    const o = opts || {};
    const cols = colsFor(o.width);
    const ops = [];
    const align = a => ops.push({ op: 'align', v: a });
    const bold = v => ops.push({ op: 'bold', v: !!v });
    const big = v => ops.push({ op: 'big', v: !!v });
    const text = s => ops.push({ op: 'text', v: ascii(s) });
    const rule = (ch) => ops.push({ op: 'text', v: (ch || '-').repeat(cols) });
    const row = (l, r) => ops.push({ op: 'text', v: pad(l, r, cols) });
    // The delivery map + its caption, centered, printed once near the bottom by the thank-you.
    const mapBlock = (m) => {
      if (!m) return;
      align('center');
      ops.push({ op: 'image', v: m });
      if (m.caption) wrap(m.caption, cols).forEach(text);
      align('left');
    };

    const st = vm.store || {};
    const cash = n => money(n, st.currency);
    const look = vm.look || {};

    const t1 = look.style !== 'g2';   // Classic; paper prints both in its own font, so only the layout differs
    const up = s => (t1 ? String(s).toUpperCase() : String(s));
    const half = Math.floor(cols / 2);   // big = double width
    const num = look.numWord || 'Receipt';   // Settings › Receipt › Receipt says: Invoice # when the store is BIR registered

    if (o.logoImage) ops.push({ op: 'image', v: o.logoImage });   // already centred on the full head (picRaster)
    align('center'); bold(true); big(true);
    if (look.showName !== false) wrap(st.name || '', half).forEach(text);   // off when the logo already says it
    big(false); bold(false);
    (look.header || []).forEach(l => wrap(l, cols).forEach(text));   // the store's own line (Settings › Receipt), under the name
    headLines(st, cols).forEach(l => wrap(l, cols).forEach(text));
    align('left'); rule();

    if (vm.mark) { align('center'); bold(true); text(vm.mark); bold(false); align('left'); }
    // The word is the till's (bo-model orderFulfilLabel, upper-cased): Walk-in, Pickup, Delivery or a store's own type.
    const fulfil = String(vm.fulfilmentLabel || '').split(' · ')[0];
    const delivery = fulfil === 'DELIVERY';
    if (t1) {
      if (vm.number) text(num.toUpperCase() + ' #' + vm.number);   // a saved cart or quote has none: it is not a receipt
      text(vm.dateText || '');
      text(up((vm.whoWord || 'Cashier') + ' ' + (vm.cashier || '')));   // a void or refund names who pressed it
      text('POS ' + (vm.register || '1') + (fulfil ? ' · ' + fulfil : ''));
    } else {
      if (vm.number) row(num + ' #', vm.number);
      row('Date', vm.dateText || '');
      row(vm.whoWord || 'Cashier', vm.cashier || '');
      row('POS', vm.register || '1');
    }
    const cust = custLines(vm);
    if (cust.length) rule();
    if (!t1 && fulfil) { bold(true); text(fulfil); bold(false); }
    cust.forEach(([k, v]) => wrap(t1 ? k.toUpperCase() + ': ' + v : k === 'Customer' ? v : k + ': ' + v, cols).forEach(text));

    rule();

    const t = vm.totals || {};
    // Classic's items are a QTY / ITEM / PRICE / AMOUNT table where 48 columns fit one; on 58mm, in Modern, or for a line
    // too wide for the table: the name, then its qty x price and amount.
    const table = t1 && cols >= 40, qw = 4, pw = 10, aw = 11, nw = cols - qw - pw - aw;
    const cells = (q, n, p, a) => q.padEnd(qw) + n.padEnd(nw) + p.padStart(pw) + a.padStart(aw);
    if (table) { bold(true); text(cells('QTY', 'ITEM', 'PRICE', 'AMOUNT')); bold(false); rule(); }
    const under = s => (table ? ' '.repeat(qw) : '  ') + s;
    // Each line at price x qty before discount, fitted to the Subtotal; the discount prints once, below.
    SM().receiptLines({ ...t, items: vm.items || [] }).forEach(({ item: i, amount }) => {
      const q = SM().qtyText(i.qty), names = wrap(i.name, nw - 1), line = table ? cells(q, names[0], cash(i.price), cash(amount)) : '';
      if (line && line.length <= cols) {
        text(line);
        names.slice(1).forEach(s => text(under(s)));
      } else {
        wrap(i.name, cols).forEach(text);
        row(('  ' + q + ' ' + (i.unit || '')).replace(/\s+$/, '') + ' x ' + cash(i.price), cash(amount));
      }
      // its modifier answers ('Sweetness: 50%'), then its note, under it like its qty
      SM().answerLines(i, cash).forEach(a => wrap(a, cols - 4).forEach(s => text(under(s))));
      if (i.note) wrap(i.note, cols - 4).forEach(s => text(under(s)));
    });

    rule();

    totalRows(vm).forEach(([l, n]) => row(up(l), cash(n)));
    if (vm.status === 'saved') {
      if (!vm.mark) row(up('Status'), up('Not completed'));   // a quote says QUOTATION at the top instead
    } else {
      payRows(vm, !t1).forEach(([l, n]) => typeof n !== 'string' ? row(l, cash(n)) : ascii(n).trim() && row(l, n));   // REF NO. is text; one the paper can't spell (all CJK / emoji) stays on screen only
    }
    bold(true); big(true);
    row('TOTAL', cash(t.total));   // last, under what was paid (the lab's T1 and G2.2)
    big(false); bold(false);

    rule();
    if (delivery) mapBlock(o.mapImage);
    align('center');
    // Settings › Receipt's footer lines: the first is the big thank-you (it starts as 'Thank you!'), then its picture
    const [ty, ...more] = look.footer || ['Thank you!'];
    if (ty) { bold(true); big(t1); wrap(up(ty), t1 ? half : cols).forEach(text); big(false); bold(false); }
    more.forEach(l => wrap(l, cols).forEach(text));
    if (o.footImage) ops.push({ op: 'image', v: o.footImage });
    if (vm.number) { text(''); text(num.toUpperCase() + ' NO.'); bold(true); big(true); wrap(vm.number, half).forEach(text); big(false); bold(false); text(''); }
    // SalesMath.receiptParts' footer: what the slip is, then Settings › Receipt › Receipt says' line.
    (vm.footer || SM().receiptParts(vm).footer).forEach(l => wrap(l, cols).forEach(text));
    if (st.tin) text('TIN ' + st.tin);
    align('left');

    ops.push({ op: 'feed', v: 4 });
    if (o.cut !== false) ops.push({ op: 'cut' });
    return ops;
  }

  // ---------- delivery map -> 1-bit raster ----------

  const MAP_ASPECT = 0.62;
  // ponytail: OSM raster tiles at street zoom occupy a sliver of the grey range - measured
  // 197..239 on a Laguna tile, median 236 - so any fixed contrast curve prints either a blank
  // box or a black one, and the right curve differs per location. Auto-levels stretches
  // whatever range the tile actually has. Below MAP_FLAT_RANGE there is nothing mapped there
  // and stretching would only amplify JPEG noise, so leave it pale.
  const MAP_FLAT_RANGE = 12;
  // ponytail: thermal calibration knobs, both found on paper and not on screen.
  // MAP_INK: must stay BELOW where auto-levels parks the background, or the map inverts and
  // prints as a black slab - 170 does exactly that. Thin labels are fixed by the dilation in
  // packMono, not by grabbing more grey here.
  // MAP_ZOOM_BOOST: tiles draw at a fixed 256px, so a wider raster buys more *area*, not bigger
  // labels. One zoom level up doubles the label size for 3/4 of the coverage.
  const MAP_INK = 128;
  const MAP_ZOOM_BOOST = 1;

  // 2nd/98th percentile of a grayscale buffer.
  function levels(gray) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i] | 0]++;
    const cut = Math.floor(gray.length * 0.02);
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    return { lo, hi };
  }

  function stretch(gray, lo, hi) {
    if (hi - lo < MAP_FLAT_RANGE) return gray;
    const k = 255 / (hi - lo);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, (gray[i] - lo) * k));
    return gray;
  }

  // ponytail: 2-line Web Mercator duplicated from app.js on purpose - printer.js stays
  // dependency-free so it also loads in Node for scripts/printer-check.mjs.
  function lonX(lng, z) { return ((lng + 180) / 360) * 256 * (2 ** z); }
  function latY(lat, z) {
    const r = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * (2 ** z);
  }
  function tileUrl(x, y, z) { return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png'; }

  // gray: 0..255 per pixel (0 = black). Returns packed 1bpp rows, 1 = print a dot.
  // mode 'sharp' = hard threshold, 'shaded' = Floyd-Steinberg.
  // ponytail: a map is line art - road casings, glyphs, footprint outlines. Dithering shatters
  // those into stipple and the labels stop being readable; a threshold keeps them solid black on
  // clean white. Shaded only wins where the tile is flat landuse with nothing drawn on it.
  function packMono(gray, w, h, mode) {
    const rowBytes = Math.ceil(w / 8);
    const out = new Uint8Array(rowBytes * h);
    if (mode === 'sharp') {
      const on = new Uint8Array(w * h);
      for (let i = 0; i < on.length; i++) on[i] = gray[i] < MAP_INK ? 1 : 0;
      // Grow every dark feature by one pixel. A print head under-burns isolated single dots, so
      // 1px map lines come out broken and faint however clean the threshold is; 2px burns solid.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (on[i] || (x && on[i - 1]) || (x + 1 < w && on[i + 1]) || (y && on[i - w]) || (y + 1 < h && on[i + w])) {
            out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
          }
        }
      }
      return out;
    }
    const buf = Float32Array.from(gray);
    const spill = (i, e) => { if (i >= 0 && i < buf.length) buf[i] += e; };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const black = buf[i] < 128;
        const err = buf[i] - (black ? 0 : 255);
        if (black) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
        if (x + 1 < w) spill(i + 1, err * 7 / 16);
        if (y + 1 < h) {
          if (x > 0) spill(i + w - 1, err * 3 / 16);
          spill(i + w, err * 5 / 16);
          if (x + 1 < w) spill(i + w + 1, err * 1 / 16);
        }
      }
    }
    return out;
  }

  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return g.btoa ? g.btoa(s) : Buffer.from(s, 'binary').toString('base64');
  }

  function loadTile(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // tile.openstreetmap.org sends Access-Control-Allow-Origin:* - without this getImageData throws
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('tile'));
      img.src = url;
    });
  }

  function drawPin(ctx, x, y) {
    const path = () => {
      ctx.beginPath();
      ctx.arc(x, y - 9, 8, Math.PI, 0);
      ctx.lineTo(x, y + 9);
      ctx.closePath();
    };
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; path(); ctx.stroke();
    ctx.fillStyle = '#000'; path(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - 9, 3, 0, Math.PI * 2); ctx.fill();
  }

  // Composites the OSM tiles under `loc` onto a canvas and returns { w, h, bits } for the image op.
  // Browser only - there is no canvas in Node.
  async function mapRaster(loc, dots, mode) {
    if (typeof document === 'undefined') throw new Error('Map printing needs a browser');
    const z = Math.min(19, (loc.zoom || 17) + (mode === 'sharp' ? MAP_ZOOM_BOOST : 0));
    const w = dots - (dots % 8);
    const h = Math.round(w * MAP_ASPECT);
    const cx = lonX(loc.lng, z);
    const cy = latY(loc.lat, z);
    const n = 2 ** z;

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);

    let drawn = 0;
    const jobs = [];
    for (let ty = Math.floor((cy - h / 2) / 256); ty <= Math.floor((cy + h / 2) / 256); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor((cx - w / 2) / 256); tx <= Math.floor((cx + w / 2) / 256); tx++) {
        const dx = Math.round(tx * 256 - cx + w / 2);
        const dy = Math.round(ty * 256 - cy + h / 2);
        jobs.push(loadTile(tileUrl(((tx % n) + n) % n, ty, z))
          .then(img => { ctx.drawImage(img, dx, dy); drawn++; })
          .catch(() => {})); // one dead tile is a white patch, not a failed receipt
      }
    }
    await Promise.all(jobs);
    if (!drawn) throw new Error('No map tiles loaded - the device has no internet');

    const readGray = () => {
      const px = ctx.getImageData(0, 0, w, h).data;
      const gray = new Float32Array(w * h);
      for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      return gray;
    };

    // Levels come from the tiles alone: the pin and frame are pure black and white, and drawing
    // them first would peg the range to 0..255 and undo the stretch.
    const { lo, hi } = levels(readGray());

    drawPin(ctx, w / 2, h / 2);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);

    return { w, h, bits: packMono(stretch(readGray(), lo, hi), w, h, mode) };
  }

  // Settings › Receipt's pictures, as a share of the head's width: the box each one fits in. The screen's .rcpt .pic uses
  // the same box (receipt.css), so the paper and the preview match. A boxed picture (Settings › Receipt's two boxes) is [its width, 1]
  // instead: its box, never taller than the paper is wide.
  const RECEIPT_PICS = { logo: [0.6, 0.3], foot: [0.6, 0.6] };
  // A picture (a data URL) -> { w, h, bits } for the image op, centred on the full head width with white either side,
  // so no printer's own centring is relied on. Browser only, like mapRaster.
  // ponytail: dithered (packMono 'shaded'); a boxed picture (Settings › Receipt) is already one ink, so it prints as it is.
  async function picRaster(src, dots, box, name) {
    if (typeof document === 'undefined') throw new Error('Pictures need a browser');
    const img = typeof src !== 'string' ? src : await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('picture')); i.src = src; });
    const k = Math.min(dots * box[0] / img.width, dots * box[1] / img.height);
    const w = dots - (dots % 8), pw = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = k < 1;   // a small QR blown up keeps square, sharp dots
    ctx.drawImage(img, Math.round((w - pw) / 2), 0, pw, h);
    const px = ctx.getImageData(0, 0, w, h).data, gray = new Float32Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const { lo, hi } = levels(gray);   // a near-black logo (#111) prints solid, not sprinkled with white dots, as the map
    return { w, h, bits: packMono(stretch(gray, lo, hi), w, h, 'shaded'), name };
  }

  // ---------- encoder: ESC/POS bytes (Bluetooth) ----------

  function escpos(ops) {
    const out = [0x1B, 0x40, 0x1B, 0x74, 0x00]; // init + code page PC437
    const push = arr => { for (const b of arr) out.push(b); };
    for (const o of ops) {
      switch (o.op) {
        case 'align': push([0x1B, 0x61, o.v === 'center' ? 1 : o.v === 'right' ? 2 : 0]); break;
        case 'bold': push([0x1B, 0x45, o.v ? 1 : 0]); break;
        case 'big': push([0x1D, 0x21, o.v ? 0x11 : 0x00]); break;
        case 'text':
          for (let i = 0; i < o.v.length; i++) out.push(o.v.charCodeAt(i) & 0xFF);
          out.push(0x0A);
          break;
        case 'feed': push([0x1B, 0x64, o.v & 0xFF]); break;
        case 'cut': push([0x1D, 0x56, 0x42, 0x00]); break;
        case 'raw': push(o.bytes); break;   // a device command as is: drawer.js's kick
        case 'image': {
          const { w, h, bits } = o.v;
          const rowBytes = Math.ceil(w / 8);
          // ponytail: 128-row bands. One GS v 0 for a whole map overruns some cheap print buffers.
          for (let y0 = 0; y0 < h; y0 += 128) {
            const rows = Math.min(128, h - y0);
            push([0x1D, 0x76, 0x30, 0x00, rowBytes & 0xFF, rowBytes >> 8, rows & 0xFF, rows >> 8]);
            push(bits.subarray(y0 * rowBytes, (y0 + rows) * rowBytes));
          }
          break;
        }
      }
    }
    return new Uint8Array(out);
  }

  // ---------- encoder: Epson ePOS-Print XML (Wi-Fi) ----------

  function xmlEsc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function eposXml(ops) {
    let body = '';
    for (const o of ops) {
      switch (o.op) {
        case 'align': body += '<text align="' + o.v + '"/>'; break;
        case 'bold': body += '<text em="' + o.v + '"/>'; break;
        case 'big': body += '<text dw="' + o.v + '" dh="' + o.v + '"/>'; break;
        case 'text': body += '<text>' + xmlEsc(o.v) + '&#10;</text>'; break;
        case 'feed': body += '<feed line="' + o.v + '"/>'; break;
        case 'cut': body += '<cut type="feed"/>'; break;
        case 'raw': body += o.xml; break;
        case 'image':
          body += '<image width="' + o.v.w + '" height="' + o.v.h + '" color="color_1" mode="mono">'
            + b64(o.v.bits) + '</image>';
          break;
      }
    }
    return '<?xml version="1.0" encoding="utf-8"?>'
      + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
      + '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">'
      + body
      + '</epos-print></s:Body></s:Envelope>';
  }

  // ---------- transport: Wi-Fi (Epson ePOS-Print) ----------

  // Accepts "192.168.1.50", "192.168.1.50:8008", or a full http(s):// URL.
  function eposUrl(host) {
    const h = String(host || '').trim().replace(/\/+$/, '');
    if (!h) throw new Error('No printer address set');
    const tail = '/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000';
    if (/^https?:\/\//i.test(h)) return /service\.cgi/i.test(h) ? h : h + tail;
    return 'http://' + h + tail;
  }

  async function printNetwork(ops, cfg) {
    const url = eposUrl(cfg.netUrl);
    if (g.location && location.protocol === 'https:' && url.indexOf('http:') === 0) {
      throw new Error('Page is HTTPS - the browser blocks plain HTTP to the printer. Serve the POS over http:// on the LAN.');
    }
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
        body: eposXml(ops),
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) {
      throw new Error('Cannot reach printer at ' + cfg.netUrl + ' - check it is on the same Wi-Fi and the IP is right.');
    }
    const txt = await res.text();
    if (/success="true"/.test(txt)) return 'Printed';
    const code = (txt.match(/code="([^"]*)"/) || [])[1] || res.status;
    const status = (txt.match(/status="([^"]*)"/) || [])[1];
    throw new Error('Printer refused the job (' + code + (status ? ', status ' + status : '') + ')');
  }

  // Empty job: the printer answers success="true" and prints nothing. Used to probe the LAN.
  const PROBE_XML = '<?xml version="1.0" encoding="utf-8"?>'
    + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
    + '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/>'
    + '</s:Body></s:Envelope>';

  async function probe(ip, ms) {
    try {
      const res = await fetch(eposUrl(ip), {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: PROBE_XML,
        signal: AbortSignal.timeout(ms || 1500),
      });
      const txt = await res.text();
      return /epos-print|success=/.test(txt) ? ip : null;
    } catch (e) {
      return null; // unreachable host, or something that isn't an Epson
    }
  }

  // Sweep a /24 for ePOS-Print printers. Browsers can't enumerate the LAN, so this is
  // the only discovery available: 254 short POSTs, 32 in flight.
  async function scanNetwork(prefix, onProgress) {
    const base = String(prefix || '').trim().replace(/\.$/, '');
    if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error('Scan needs a subnet like 192.168.1');
    const hosts = [];
    for (let i = 1; i <= 254; i++) hosts.push(base + '.' + i);
    const found = [];
    let next = 0, done = 0;
    async function worker() {
      while (next < hosts.length) {
        const ip = hosts[next++];
        const hit = await probe(ip, 1500);
        if (hit) found.push(hit);
        if (onProgress) onProgress(++done, hosts.length, found);
      }
    }
    await Promise.all(Array.from({ length: 32 }, worker));
    return found;
  }

  // ---------- transport: Bluetooth (Web Bluetooth + ESC/POS) ----------

  // Serial-over-BLE services used by ESC/POS printers. Listed so getPrimaryServices() can see them.
  const BT_SERVICES = [
    0x18F0, 0xFF00, 0xFFE0, 0xFF80, 0xAE30,
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip/ISSC transparent UART
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  ];
  let btDevice = null;
  let btChar = null;

  async function btWriteChar(dev) {
    const server = await dev.gatt.connect();
    const services = await server.getPrimaryServices();
    for (const s of services) {
      for (const c of await s.getCharacteristics()) {
        if (c.properties.write || c.properties.writeWithoutResponse) return c;
      }
    }
    throw new Error('Paired device has no writable characteristic - it may be a Bluetooth Classic (SPP) printer, which browsers cannot reach.');
  }

  function assertBt() {
    if (g.navigator && navigator.bluetooth) return;
    // Web Bluetooth is secure-context only, so a plain http:// LAN page never exposes it —
    // the same page the Wi-Fi driver needs. Wrapping the app (Capacitor) resolves the conflict.
    if (g.isSecureContext === false) {
      throw new Error('Bluetooth needs a secure page — this one is plain http://. Use the Wi-Fi printer here, or open the app over https / as the wrapped app.');
    }
    throw new Error('Web Bluetooth unavailable. Use Chrome/Edge on Windows or Android (iOS has none, in any browser).');
  }

  async function pairBluetooth() {
    assertBt();
    // requestDevice needs a user gesture — only call this from a button.
    btDevice = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BT_SERVICES });
    btChar = await btWriteChar(btDevice);
    return { id: btDevice.id, name: btDevice.name || 'Bluetooth printer' };
  }

  async function btReady(cfg) {
    assertBt();
    if (btChar && btDevice && btDevice.gatt.connected) return btChar;
    if (!btDevice && navigator.bluetooth.getDevices) {
      // Re-attach to an already-permitted device so reprints need no gesture.
      const known = await navigator.bluetooth.getDevices();
      btDevice = known.find(d => d.id === cfg.btId) || known.find(d => d.name === cfg.btName) || null;
    }
    if (!btDevice) throw new Error('No Bluetooth printer paired - tap Pair in Settings > Printing.');
    btChar = await btWriteChar(btDevice);
    return btChar;
  }

  async function printBluetooth(ops, cfg) {
    const ch = await btReady(cfg);
    const bytes = escpos(ops);
    // ponytail: fixed 120-byte chunks + 12ms gap. Web Bluetooth exposes no MTU; drop to 20 if a printer garbles.
    const CHUNK = 120;
    const noAck = ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.slice(i, i + CHUNK);
      if (noAck) await ch.writeValueWithoutResponse(slice);
      else await ch.writeValue(slice);
      await new Promise(r => setTimeout(r, 12));
    }
    return 'Printed';
  }

  // ---------- public ----------

  async function print(vm, cfg) {
    const c = cfg || {};
    let mapImage = null;
    if (c.mapOnReceipt !== false && vm.deliveryLocation) {
      // ponytail: no map is never a reason to lose the receipt - fall through to text-only.
      try {
        // ponytail: shaded at cols*12 - the original dither, at the full print head (576 dots at
        // 80mm). 'sharp' is crisper on screen and worse on paper: thresholding drops the grey that
        // was carrying the map, and it reads faint however much the strokes are thickened.
        mapImage = await mapRaster(vm.deliveryLocation, colsFor(c.width) * 12, c.mapStyle || 'shaded');
        mapImage.caption = vm.deliveryMapCaption || 'Delivery location';
      } catch (e) { mapImage = null; }
    }
    // ponytail: a picture that won't load prints the receipt without it, like the map
    const dots = colsFor(c.width) * 12, look = vm.look || {};
    const pic = (src, box, name) => (src ? picRaster(src, dots, box, name).catch(() => null) : null);
    const [logoImage, footImage] = await Promise.all([
      pic(look.logo, look.logoW ? [look.logoW, 1] : RECEIPT_PICS.logo, 'logo'), pic(look.footerImg, look.footW ? [look.footW, 1] : RECEIPT_PICS.foot, 'picture')]);
    return send(layout(vm, { width: c.width, cut: c.cut, mapImage, logoImage, footImage }), c);
  }
  // Laid-out ops to the paired printer: the one transport switch every slip goes through.
  function send(ops, c) {
    if (c.driver === 'network') return printNetwork(ops, c);
    if (c.driver === 'bluetooth') return printBluetooth(ops, c);
    throw new Error('Printer driver is set to Browser');
  }
  const printSlip = (s, cfg) => { const c = cfg || {}; return send(slipLayout(s, { width: c.width, cut: c.cut }), c); };
  // The slip as plain text: the screen and the browser pop-up show exactly what the paper prints.
  const slipText = (s, cfg) => {
    const cols = colsFor((cfg || {}).width), out = [];
    let mid = false;   // the head and title print centred
    for (const o of slipLayout(s, { width: (cfg || {}).width })) {
      if (o.op === 'align') mid = o.v === 'center';
      else if (o.op === 'text') out.push(mid ? ' '.repeat(Math.max(0, (cols - o.v.length) >> 1)) + o.v : o.v);
    }
    return out.join('\n');
  };

  // Plain-text render of the same layout — used by the Test print preview.
  function preview(vm, cfg) {
    const c = cfg || {};
    return layout(vm, { width: c.width, cut: c.cut, mapImage: c.mapImage, logoImage: c.logoImage, footImage: c.footImage })
      .filter(o => o.op === 'text' || o.op === 'image')
      .map(o => o.op === 'image' ? '[ ' + (o.v.name || 'delivery map') + ' ' + o.v.w + 'x' + o.v.h + ' ]' : o.v)
      .join('\n');
  }

  const API = { print, send, preview, printSlip, slipText, slipLayout, pairBluetooth, scanNetwork, probe, layout, escpos, eposXml, eposUrl, mapRaster, picRaster, packMono, levels, stretch, colsFor, pad, wrap, money, ascii, payRows, totalRows, headLines, custLines };
  g.HWPOS_PRINTER = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
