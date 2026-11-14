// designer a -- "Pay in parts": pay some with one method, the big number drops to what's left, pick the next method.
// (a2 "Pay part link" was cut: it was a1 with the Split tile hidden as a link on every page.)
(() => {
const F = ':is(.f-a1, .f-a3)';
const style = document.createElement('style');
style.textContent = `
${F} .a-scr { display: grid; gap: 16px; justify-items: center; }
${F} .a-scr > :not(.co-tiles) { width: 100%; max-width: 440px; }
${F} .co-tiles { --cols: 3; }
.phone ${F} .co-tiles { --cols: 2; }
${F} .a-left { margin-top: -8px; display: flex; justify-content: center; gap: 14px; color: var(--ink-tertiary); font-size: 14px; font-weight: 500; }
${F} .a-left span { display: inline-flex; align-items: center; gap: 6px; }
${F} .a-left .a-ok { width: 16px; height: 16px; color: var(--ok); stroke-width: 2.2; }
${F} .a-fig { display: grid; justify-items: center; gap: 2px; }
${F} .a-lbl { display: inline-flex; align-items: center; gap: 6px; }
${F} .a-lbl .co-ic { width: 16px; height: 16px; }
${F} .co-hero.ph { color: var(--ink-quaternary); }
${F} .co-hero.a-bad, ${F} .co-fig.a-bad { color: var(--danger); }
${F} .a-chg:empty { display: none; }
${F} .a-chg { color: var(--ok); font-size: 15px; font-weight: 560; text-align: center; }
${F} .a-quick { --cols: var(--n); }
${F} .a-quick .co-tile { height: 72px; gap: 2px; }
.phone ${F} .a-quick { --cols: 2; }
.phone ${F} .a-quick .co-tile { height: 60px; }
.phone ${F} .co-hero { padding-bottom: 20px; }
`;
document.head.appendChild(style);

// Quick cash, as the POS: Exact, then the next ₱100 / ₱500 / ₱1,000 above (pos-lab/pos-checkout.js quickTenders)
const quickCash = v => { const c = Math.round(v * 100), above = m => (Math.floor(c / (m * 100)) + 1) * m; return [c / 100, ...new Set([100, 500, 1000].map(above))]; };
console.assert(quickCash(1250).join() === '1250,1300,1500,2000' && quickCash(500).join() === '500,600,1000', 'quickCash');
const OK = '<svg class="co-ic a-ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SPLIT = '<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/></svg>';

// mode: 'tile' = a Split tile; 'ask' = every method asks how much, all of it filled in
function make(id, name, idea, mode) {
  addFlow({ id, name, idea, mount(ctx) {
    const { total, peso, money, esc } = ctx, el = ctx.el;
    const fits = (m, amt) => m !== 'credit' || amt <= ctx.room;   // the account only takes what it has room for
    let legs = [];
    const left = () => money(total - legs.reduce((s, l) => s + l.amount, 0));
    const name = id => ctx.methods.find(m => m.id === id).label;

    // a screen stack: Back = one step back, with the parts paid at that step
    const hist = [];
    const go = view => { hist.push({ view, legs: legs.slice() }); show(); };
    const show = () => { const h = hist[hist.length - 1]; legs = h.legs.slice(); ctx.setBack(hist.length > 1 ? 'Back' : 'Cancel'); el.innerHTML = ''; h.view(); };
    ctx.onBack = () => { if (hist.length < 2) return false; hist.pop(); show(); return true; };
    const pay = leg => { legs.push(leg); if (left() > 0) return go(methods); ctx.done(legs); };

    // the big number: what's left; the parts already paid ticked under it
    const paidLine = () => legs.length ? `<div class="a-left">${legs.map(l => `<span>${esc(name(l.method))} ${peso(l.amount)}${OK}</span>`).join('')}</div>` : '';
    const head = (n = left()) => ctx.hero(peso(n)) + paidLine();
    const screen = html => { el.innerHTML = `<div class="a-scr co-in">${html}</div>`; return el.firstChild; };
    const lbl = m => `<span class="co-lbl a-lbl">${m.icon}${esc(m.label)}</span>`;
    const quick = amt => quickCash(amt).map((v, i) => `<button type="button" class="co-tile" data-v="${v}"><span class="co-big${i ? ' num' : ''}">${i ? peso(v) : 'Exact'}</span></button>`).join('');
    const tiles = (list, need) => `<div class="co-tiles">${list.map(m =>
      `<button type="button" class="co-tile" data-m="${m.id}" ${fits(m.id, need) ? '' : 'disabled'}>${m.icon}${esc(m.label)}</button>`).join('')}`;

    // the methods: the whole of what's left on one (a3: any part of it), or Split
    function methods() {
      const used = new Set(legs.map(l => l.method)), L = left(), split = mode === 'tile' && !legs.length;
      const s = screen(head() + tiles(ctx.methods.filter(m => !used.has(m.id)), mode === 'ask' ? 0.01 : L)
        + (split ? `<button type="button" class="co-tile" data-split>${SPLIT}Split</button>` : '') + '</div>');
      s.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.split != null) return go(splitPick);
        const m = ctx.methods.find(x => x.id === b.dataset.m);
        if (mode === 'ask') go(() => ask(m));
        else go(() => m.id === 'cash' ? cash(L) : other(m));
      };
    }
    // Split: which way pays the first part
    function splitPick() {
      const s = screen(head() + tiles(ctx.methods, 0.01) + '</div>');
      s.onclick = e => { const b = e.target.closest('[data-m]'); if (b) go(() => part(ctx.methods.find(x => x.id === b.dataset.m))); };
    }

    // Cash = quick amounts + Custom (a tap pays it); the rest = one confirm
    function cash(due, after = v => pay({ method: 'cash', amount: due, given: v, change: money(v - due) })) {
      const s = screen(head(due) + `<div class="co-tiles a-quick" style="--n:${quickCash(due).length + 1}">${quick(due)}
        <button type="button" class="co-tile" data-custom><span class="co-big">Custom</span></button></div>`);
      s.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.v) after(+b.dataset.v);
        else if (b.dataset.custom != null) go(() => custom(due, after));
      };
    }
    function custom(due, after) {
      let raw = '';
      const s = screen(head(due) + `<div class="a-fig">${lbl(ctx.methods[0])}<span class="co-fig num" data-f></span></div><div class="a-chg num" data-c></div>
        <span data-kp></span><button type="button" class="co-btn primary" data-go>${due === left() ? 'Complete sale' : 'Next'}</button>`);
      const draw = () => {
        const v = money(raw || 0);
        s.querySelector('[data-f]').innerHTML = raw ? ctx.typedPeso(raw) + '<span class="co-caret"></span>' : peso(due);
        s.querySelector('[data-f]').classList.toggle('ph', !raw);
        s.querySelector('[data-c]').textContent = v > due ? peso(v - due) : '';
        s.querySelector('[data-go]').disabled = !(v >= due);
      };
      s.querySelector('[data-kp]').replaceWith(ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }));
      s.querySelector('[data-go]').onclick = () => after(money(raw));
      draw();
    }
    function other(m) {
      const L = left();
      const s = screen(head() + `<div class="a-fig">${lbl(m)}</div><button type="button" class="co-btn primary" data-go>Complete sale</button>`);
      s.querySelector('[data-go]').onclick = () => pay({ method: m.id, amount: L });
    }

    // a part: the typed amount is the one big number (less than what's left). Cash then asks what they handed.
    function part(m) {
      const L = left(); let raw = '';
      const s = screen(`<div class="co-hero num" data-f></div><div class="a-fig">${lbl(m)}</div>
        <span data-kp></span><button type="button" class="co-btn primary" data-go>Next</button>`);
      const draw = () => {
        const v = money(raw || 0), f = s.querySelector('[data-f]');
        f.innerHTML = ctx.typedPeso(raw || '0') + '<span class="co-caret"></span>';
        f.classList.toggle('ph', !raw);
        f.classList.toggle('a-bad', v >= L || !fits(m.id, v));
        s.querySelector('[data-go]').disabled = !(v > 0 && v < L && fits(m.id, v));
      };
      s.querySelector('[data-kp]').replaceWith(ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }));
      s.querySelector('[data-go]').onclick = () => { const v = money(raw); m.id === 'cash' ? go(() => cash(v)) : pay({ method: m.id, amount: v }); };
      draw();
    }

    // 'ask': every method opens with all that's left filled in; type less to pay part. Cash: the quick amounts finish it.
    function ask(m) {
      const L = left(), isCash = m.id === 'cash'; let raw = '';
      const s = screen(head() + `<div class="a-fig">${lbl(m)}<span class="co-fig num" data-f></span></div><div class="a-chg num" data-c></div><span data-kp></span><div data-act></div>`);
      const fig = s.querySelector('[data-f]'), act = s.querySelector('[data-act]'), c = s.querySelector('[data-c]');
      const draw = () => {
        const v = raw ? money(raw) : L, over = v > L, ok = v > 0 && fits(m.id, v) && (isCash || !over);
        fig.innerHTML = (raw ? ctx.typedPeso(raw) : peso(L)) + '<span class="co-caret"></span>';
        fig.classList.toggle('ph', !raw); fig.classList.toggle('a-bad', !ok);
        c.textContent = isCash && over ? 'Change ' + peso(v - L) : '';
        if (isCash && !over && v > 0) {
          act.className = 'co-tiles a-quick'; act.style.setProperty('--n', quickCash(v).length);
          act.innerHTML = quick(v);
        } else {
          act.className = ''; act.innerHTML = `<button type="button" class="co-btn primary" data-go ${ok ? '' : 'disabled'}>Pay</button>`;
        }
      };
      act.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        const v = raw ? money(raw) : L;
        if (b.dataset.v) pay({ method: 'cash', amount: v, given: +b.dataset.v, change: money(+b.dataset.v - v) });
        else if (isCash) pay({ method: 'cash', amount: L, given: v, change: money(v - L) });
        else pay({ method: m.id, amount: v });
      };
      s.querySelector('[data-kp]').replaceWith(ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }));
      draw();
    }

    go(methods);
  } });
}

make('a1', 'Split tile, pay a part', 'Tap Split, pick how they pay, type the part; what is left becomes the big number.', 'tile');
make('a3', 'Every method asks how much', 'Each method opens with the whole amount filled in; type less and the rest stays to pay.', 'ask');
})();
