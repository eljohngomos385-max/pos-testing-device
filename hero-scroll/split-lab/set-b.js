// designer b -- "Any amount": no Split tile. Any method can take less than the total; the rest goes on a second method.
// (b1 "Short cash" and b2 "Part cash" were cut: both were this flow with the split hidden inside Cash.)
(() => {
const F = '.f-b3';
const style = document.createElement('style');
style.textContent = `
${F} .b-scr { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; justify-items: center; }
${F} .b-w { width: 100%; max-width: calc(3 * var(--co-tw) + 2 * var(--co-gap)); display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
${F} .co-tiles { --cols: 3; }
${F} .co-tile small { font-size: 12px; }
${F} .b-fig { display: grid; justify-items: center; gap: 2px; }
${F} .b-note { min-height: 20px; color: var(--ok); font-size: 15px; font-weight: 560; text-align: center; }
${F} .b-rest { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; }
${F} .b-rest .co-tile { height: 72px; gap: 4px; font-size: 14px; }
${F} .b-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; }
${F} .b-row .co-btn { padding: 0 8px; }
${F} .b-row .co-btn.on { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
${F} .b-leg { display: flex; justify-content: space-between; padding: 12px 2px; border-top: 1px solid var(--line); font-size: 17px; font-weight: 600; }
`;
document.head.appendChild(style);

// quick cash amounts above c: the next round notes (as the POS Cash step). Always above c, also for round parts (10,000 -> 10,100 / 10,500 / 11,000).
const above = c => [...new Set([100, 500, 1000].map(s => (Math.floor(c / s) + 1) * s))];
console.assert(above(10000).join() === '10100,10500,11000' && above(500).join() === '600,1000', 'above');

addFlow({ id: 'b3', name: 'Any amount', idea: 'Any method can take less than the total; the rest goes on a second method.', mount(ctx) {
  const { total, peso, money, esc } = ctx, el = ctx.el;
  const all = ctx.methods, cash = all.find(m => m.id === 'cash');
  const fits = (m, amt) => m.id !== 'credit' || amt <= ctx.room;   // the account only takes what it has room for
  const s = { raw: '', first: null, part: 0, second: null };

  // a tiny screen stack: Back = one step back
  const stack = [];
  const show = () => { ctx.setBack(stack.length > 1 ? 'Back' : 'Cancel'); stack[stack.length - 1](); };
  const go = f => { stack.push(f); show(); };
  ctx.onBack = () => { if (stack.length < 2) return false; stack.pop(); show(); return true; };
  const paint = html => { el.innerHTML = `<div class="b-scr co-in">${html}</div>`; };
  const $ = q => el.querySelector(q);
  const each = (q, f) => el.querySelectorAll(q).forEach(f);
  const byId = id => all.find(m => m.id === id);
  const btn = (text, on = true) => `<div class="b-w"><button type="button" class="co-btn primary" id="bGo"${on ? '' : ' disabled'}>${text}</button></div>`;

  // 1. the methods, as the POS: Cash -> quick amounts; the rest -> how much (blank = all)
  function methods() {
    paint(`${ctx.hero()}<div class="co-tiles">${all.map(m => `<button type="button" class="co-tile" data-m="${m.id}"${fits(m, 0.01) ? '' : ' disabled'}>${m.icon}${esc(m.label)}</button>`).join('')}</div>`);
    each('[data-m]', b => b.onclick = () => {
      const m = byId(b.dataset.m);
      if (m === cash) return go(cashStep);
      s.first = m; s.raw = ''; go(amount);
    });
  }

  // 2. Cash: quick amounts, as the POS; Custom types it (less than the total = a split)
  function cashStep() {
    let given = 0;
    paint(`${ctx.hero()}<div class="co-tiles">${[total, ...above(total)].map((v, i) => `<button type="button" class="co-tile" data-v="${v}"><span class="co-big num">${i ? peso(v) : 'Exact'}</span></button>`).join('')}
      <button type="button" class="co-tile" data-k="custom"><span class="co-big">Custom</span></button></div>
      <div class="b-note num" id="bNote"></div>${btn('Complete sale', false)}`);
    each('[data-v]', b => b.onclick = () => {
      given = +b.dataset.v;
      each('[data-v]', x => x.classList.toggle('on', x === b));
      $('#bNote').textContent = given > total ? `Change ${peso(given - total)}` : '';
      $('#bGo').disabled = false;
    });
    $('[data-k]').onclick = () => { s.first = cash; s.raw = ''; go(amount); };
    $('#bGo').onclick = () => ctx.done([{ method: 'cash', amount: total, given, change: money(given - total) }]);
  }

  // 3. the keypad: the whole total (or more, for cash) completes; less shows the other methods for the rest
  function amount() {
    const m = s.first, isCash = m === cash;
    paint(`${ctx.hero()}<div class="b-w">
        <div class="b-fig"><span class="co-lbl">${esc(m.label)}</span><span class="co-fig num" id="bFig"></span><div class="b-note num" id="bNote"></div></div>
        <div id="bKp"></div>
        <div class="b-rest" id="bRest" hidden>${all.filter(x => x !== m).map(x => `<button type="button" class="co-tile" data-m="${x.id}">${x.icon}${esc(x.label)}</button>`).join('')}</div>
        <button type="button" class="co-btn primary" id="bGo">Complete sale</button></div>`);
    const draw = () => {
      const v = money(+s.raw || 0), less = v > 0 && v < total, left = money(total - v), ok = fits(m, s.raw ? v : total);
      // blank = the whole total (grey), so a plain GCash sale is still one tap
      $('#bFig').className = 'co-fig num' + (s.raw ? (ok ? '' : ' down') : ' ph');
      $('#bFig').innerHTML = esc(s.raw ? ctx.typedPeso(s.raw) : (isCash ? '₱0' : peso(total))) + '<i class="co-caret"></i>';
      $('#bNote').textContent = isCash && v > total ? `Change ${peso(v - total)}` : '';
      $('#bRest').hidden = !less; $('#bGo').hidden = less;
      each('#bRest [data-m]', b => { b.disabled = !ok || !fits(byId(b.dataset.m), left); });
      $('#bGo').disabled = !ok || (isCash ? v < total : s.raw && v !== total);
    };
    $('#bGo').onclick = () => {
      const v = money(+s.raw || 0);
      ctx.done(isCash ? [{ method: 'cash', amount: total, given: v, change: money(v - total) }] : [{ method: m.id, amount: total }]);
    };
    each('#bRest [data-m]', b => b.onclick = () => { s.part = money(+s.raw); s.second = byId(b.dataset.m); go(finish); });
    $('#bKp').replaceWith(ctx.keypad(k => { s.raw = ctx.keyInto(s.raw, k); draw(); }));
    draw();
  }

  // 4. confirm: the two parts; under the cash part, what was handed (Exact first)
  function finish() {
    const legs = [[s.first, s.part], [s.second, money(total - s.part)]];
    if (legs[0][0] === cash) legs.reverse();   // cash last, so its notes sit under it
    const c = legs.find(([m]) => m === cash)?.[1] || 0;
    let given = c;
    paint(`${ctx.hero()}<div class="b-w"><div>${legs.map(([m, a]) => `<div class="b-leg"><span>${esc(m.label)}</span><span class="num">${peso(a)}</span></div>`).join('')}</div>
      <div id="bGiven"></div></div>${btn('Complete sale')}`);
    const draw = () => {
      if (!c) return;
      $('#bGiven').innerHTML = `<div class="b-row">${[c, ...above(c)].map((v, i) => `<button type="button" class="co-btn num${v === given ? ' on' : ''}" data-g="${v}">${i ? peso(v) : 'Exact'}</button>`).join('')}</div>
        <div class="b-note num">${given > c ? `Change ${peso(given - c)}` : ''}</div>`;
      each('[data-g]', b => b.onclick = () => { given = +b.dataset.g; draw(); });
    };
    draw();
    $('#bGo').onclick = () => ctx.done(legs.map(([m, a]) => m === cash ? { method: 'cash', amount: a, given, change: money(given - a) } : { method: m.id, amount: a }));
  }

  go(methods);
} });
})();
