// designer e -- "fastest for the common case": tap an amount, not type one.
// e1 Pick two: Split, tap two methods, tap an amount for the first one, done.
// e2 Then the rest: Split, tap a method, tap its amount, the rest becomes the big number, tap how it's paid.
// e3 Cash + GCash: the pair most splits use is its own tile (the POS would learn it); Split still covers the rest.
(() => {
const F = ':is(.f-e1, .f-e2, .f-e3)';
document.head.insertAdjacentHTML('beforeend', `<style>
${F} .e-scr { display: grid; gap: 16px; justify-items: center; }
${F} .e-scr > * { width: 100%; max-width: calc(3 * var(--co-tw) + 2 * var(--co-gap)); }
${F} .e-scr > .co-hero { max-width: none; padding-bottom: 8px; }
${F} .e-scr > .co-tiles { max-width: calc(var(--cols) * var(--co-tw) + (var(--cols) - 1) * var(--co-gap)); }
${F} .e-scr > .co-tiles.e-amts { max-width: calc(3 * var(--co-tw) + 2 * var(--co-gap)); grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); }
.phone ${F} .e-amts:has(> :nth-child(4)) { grid-auto-flow: row; grid-template-columns: 1fr 1fr; }
.phone ${F} .e-amts .co-big { font-size: 17px; }
${F} .e-pills { display: flex; gap: 10px; }
${F} .e-pill { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; height: 52px; border-radius: var(--r-input);
  background: var(--tile); font-weight: 560; }
${F} .e-pill.on { background: var(--accent); color: var(--accent-ink); }
${F} .e-pill.on .co-ic { color: var(--accent-ink); }
${F} .e-one { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--ink-secondary); font-weight: 560; }
${F} .e-parts { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); border: 1px solid var(--line); border-radius: var(--es-r); }
${F} .e-part { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0 8px; padding: 12px; font-weight: 560; }
${F} .e-part + .e-part { border-left: 1px solid var(--line); }
${F} .co-tiles.e-amts .co-tile { height: 76px; }
${F} .e-mid { display: grid; justify-items: center; }
${F} .e-mid .co-fig.up { font-size: 28px; }
${F} .e-two { display: flex; gap: 6px; }
</style>`);
const SPLIT = '<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4 8h5M4 16h5M15 8h5M15 16h5"/></svg>';
const ROUND = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
// cash handed over: the next round bills above the cash part, the first two
const bills = x => [...new Set((x < 100 ? [50, 100] : [100, 500, 1000]).map(b => Math.floor(x / b) * b + b))].slice(0, 2);

function mount(kind) { return ctx => {
  const T = ctx.total, M = ctx.methods, P = ctx.peso, esc = ctx.esc;
  const lbl = id => esc(M.find(m => m.id === id).label);
  const fits = (id, v) => id !== 'credit' || v <= ctx.room;   // the account only takes what it has room for
  const st = {};   // a: method that gets the amount, b: method that takes the rest, amt, given
  const stack = [];
  const show = () => { ctx.setBack(stack.length > 1 ? 'Back' : 'Cancel'); stack[stack.length - 1](); };
  const go = fn => { stack.push(fn); show(); };
  ctx.onBack = () => { if (stack.length < 2) return false; stack.pop(); show(); return true; };
  const put = html => { ctx.el.innerHTML = `<div class="e-scr co-in">${html}</div>`; };
  const on = (sel, fn) => ctx.el.querySelectorAll(sel).forEach(b => { b.onclick = () => fn(b.dataset.v); });
  const tiles = (cols, html, cls = '') => `<div class="co-tiles ${cls}" style="--cols:${cols}">${html}</div>`;
  const tile = (v, inner, isOn, off) => `<button type="button" class="co-tile${isOn ? ' on' : ''}" data-v="${v}"${off ? ' disabled' : ''}>${inner}</button>`;
  const other = tile('c', ctx.icon('keypad'));   // type another amount
  const cols = n => ctx.device === 'phone' ? 2 : Math.min(n, 3);
  const methodTile = (m, amt, isOn) => tile(m.id, m.icon + esc(m.label), isOn, !fits(m.id, amt));

  // 1. the normal checkout: methods + Split (+ the Cash + GCash pair in e3)
  function start() {
    const list = M.map(m => methodTile(m, T));
    if (kind === 'e3') list.push(tile('pair', `<span class="e-two">${ctx.icon('cash')}${ctx.icon('gcash')}</span>Cash + GCash`));
    list.push(tile('split', SPLIT + 'Split'));
    put(ctx.hero() + tiles(cols(list.length), list.join('')));
    on('.co-tile', v => {
      if (v === 'split') return go(pick);
      if (v === 'pair') { Object.assign(st, { a: 'cash', b: 'gcash' }); return go(amount); }
      Object.assign(st, { a: v, b: null, amt: T }); go(final);
    });
  }
  // Split: tap the two ways they pay (e2: the first one only); the first stays lit
  function pick() {
    let picks = [];
    const draw = () => {
      put(ctx.hero() + tiles(cols(M.length), M.map(m => methodTile(m, 0.01, picks.includes(m.id))).join('')));
      on('.co-tile', v => {
        if (kind === 'e2') { Object.assign(st, { a: v, b: null }); return go(amount); }
        picks = picks.includes(v) ? [] : [...picks, v];
        if (picks.length < 2) return draw();
        Object.assign(st, { a: picks[0], b: picks[1] }); go(amount);
      });
    };
    draw();
  }

  // the method being set. e3: both as pills, tapping the other swaps; e1/e2: a plain label.
  const pills = () => kind !== 'e3' ? `<div class="e-one">${ctx.icon(st.a)}${lbl(st.a)}</div>` : `<div class="e-pills">${[st.a, st.b].map((id, i) =>
    `<button type="button" class="e-pill${i ? '' : ' on'}" data-v="${id}">${ctx.icon(id)}${lbl(id)}</button>`).join('')}</div>`;
  const swap = () => on('.e-pill', v => { if (v !== st.a) { [st.a, st.b] = [st.b, st.a]; show(); } });
  const next = () => go(kind === 'e2' ? left : final);
  const partOk = x => x > 0 && x < T && fits(st.a, x) && (!st.b || fits(st.b, ctx.money(T - x)));

  // 2. how much on the first method: the two round amounts under the total, or type one
  function amount() {
    const list = ROUND.filter(partOk).slice(-2).map(n => tile(n, `<span class="co-big num">${P(n)}</span>`));
    put(ctx.hero() + pills() + tiles(3, [...list, other].join(''), 'e-amts'));
    swap();
    on('.co-tile', v => { if (v === 'c') return go(custom); st.amt = +v; next(); });
  }
  function custom() {
    let raw = '';
    const draw = () => {
      const x = ctx.money(+raw), ok = partOk(x);
      ctx.el.querySelector('.e-mid').innerHTML = `<span class="co-fig num ${raw ? (ok ? '' : 'down') : 'ph'}">${ctx.typedPeso(raw)}<span class="co-caret"></span></span>`;
      const b = ctx.el.querySelector('.co-btn');
      b.disabled = !ok;
      b.textContent = ok && st.b ? `${lbl(st.b)} ${P(T - x)}` : 'Next';
    };
    put(ctx.hero() + pills() + '<div class="e-mid"></div><div class="e-kp"></div><button type="button" class="co-btn primary">Next</button>');
    swap();
    ctx.el.querySelector('.e-kp').replaceWith(ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }));
    ctx.el.querySelector('.co-btn').onclick = () => { st.amt = ctx.money(+raw); next(); };
    draw();
  }

  // e2: what's left is the big number; tap how it's paid
  function left() {
    const r = ctx.money(T - st.amt);
    put(ctx.hero(P(r)) + tiles(cols(M.length - 1), M.filter(m => m.id !== st.a).map(m => methodTile(m, r)).join('')));
    on('.co-tile', v => { st.b = v; go(final); });
  }

  // 3. the parts, the cash handed over (Exact already on), Complete sale
  const parts = () => st.b ? [{ method: st.a, amount: st.amt }, { method: st.b, amount: ctx.money(T - st.amt) }] : [{ method: st.a, amount: T }];
  const partsRow = () => st.b ? `<div class="e-parts">${parts().map(p =>
    `<div class="e-part">${lbl(p.method)} <span class="num">${P(p.amount)}</span></div>`).join('')}</div>` : '';
  const change = (c, g) => g > c.amount ? `<span class="co-lbl">Change</span><span class="co-fig up num">${P(g - c.amount)}</span>` : '';
  const complete = g => ctx.done(parts().map(p => p.method === 'cash' ? { ...p, given: g, change: ctx.money(g - p.amount) } : p));
  function final() {
    const c = parts().find(p => p.method === 'cash');
    if (c) st.given = c.amount;
    const draw = () => {
      put(ctx.hero() + partsRow() + (c ? tiles(3, [tile(c.amount, 'Exact', st.given === c.amount),
        ...bills(c.amount).map(v => tile(v, `<span class="co-big num">${P(v)}</span>`, st.given === v)), other].join(''), 'e-amts')
        + `<div class="e-mid">${change(c, st.given)}</div>` : '') + '<button type="button" class="co-btn primary">Complete sale</button>');
      on('.co-tile', v => { if (v === 'c') return go(handed); st.given = +v; draw(); });
      ctx.el.querySelector('.co-btn').onclick = () => complete(st.given);
    };
    draw();
  }
  function handed() {
    const c = parts().find(p => p.method === 'cash');
    let raw = '';
    const draw = () => {
      const g = ctx.money(+raw);
      ctx.el.querySelector('.e-fig').innerHTML = `<span class="co-lbl">Cash given</span><span class="co-fig num ${raw ? (g < c.amount ? 'down' : '') : 'ph'}">${ctx.typedPeso(raw)}<span class="co-caret"></span></span>`;
      ctx.el.querySelector('.e-chg').innerHTML = change(c, g);
      ctx.el.querySelector('.co-btn').disabled = g < c.amount;
    };
    put(ctx.hero() + partsRow() + '<div class="e-mid e-fig"></div><div class="e-mid e-chg"></div><div class="e-kp"></div><button type="button" class="co-btn primary">Complete sale</button>');
    ctx.el.querySelector('.e-kp').replaceWith(ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }));
    ctx.el.querySelector('.co-btn').onclick = () => complete(ctx.money(+raw));
    draw();
  }

  go(start);
}; }

addFlow({ id: 'e1', name: 'e1 Pick two, tap an amount', idea: 'Tap Split, tap the two ways they pay, tap how much the first one is.', mount: mount('e1') });
addFlow({ id: 'e2', name: 'e2 Then the rest', idea: 'Take part of it one way, then tap how they pay what is left.', mount: mount('e2') });
addFlow({ id: 'e3', name: 'e3 Cash + GCash tile', idea: 'The usual pair is one tile, so a split is the same as a normal sale.', mount: mount('e3') });
})();
