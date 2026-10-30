// designer d -- "one question per screen": a split is just a few plain questions, one at a time.
(() => {
const X = ':is(.f-d1, .f-d2, .f-d3)';
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
${X} .co-ask { margin-bottom: var(--co-gap); }
${X} .d-fig { text-align: center; }
${X} .d-sub { min-height: 1.5em; text-align: center; color: var(--ink-tertiary); }
${X} .d-chg { margin: 0; text-align: center; color: var(--ok); font-weight: 560; }
${X} .d-pad, ${X} .d-go { justify-self: center; width: 100%; max-width: calc(2 * var(--co-tw) + var(--co-gap)); display: grid; gap: var(--co-gap); margin-top: var(--co-gap); }
${X} .d-dim { color: var(--ink-quaternary); }
${X} .d-scrim { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; background: color-mix(in srgb, var(--bg) 70%, transparent); }
${X} .d-card { width: min(calc(100% - 2 * var(--co-m)), calc(2 * var(--co-tw) + var(--co-gap) + 2 * var(--co-m))); display: grid; padding: var(--co-m);
  border-radius: var(--es-r); background: var(--surface-2); box-shadow: var(--shadow-modal); animation: d-morph .28s var(--co-ease) both; }
${X} .d-card .d-pad { margin-top: var(--co-gap); }
@keyframes d-morph { from { opacity: 0; transform: scale(.3); } }
` }));

const SPLIT = '<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M4 9h5M4 15h5M15 9h5M15 15h5"/></svg>';
// Quick cash as the POS: Exact, then the next ₱100 / ₱500 / ₱1,000 above (500 -> 600, 1,000)
const quick = p => { const c = Math.round(p * 100), up = m => (Math.floor(c / m) + 1) * m / 100;
  return [p, ...new Set([10000, 50000, 100000].map(up))]; };

// Back = one step back; the first step's Back is Cancel (the shell restarts).
function steps(ctx) {
  const hist = [];
  const paint = () => { ctx.setBack(hist.length > 1 ? 'Back' : 'Cancel'); ctx.el.innerHTML = ''; hist.at(-1)(); };
  ctx.onBack = () => hist.length > 1 && (hist.pop(), paint(), true);
  return fn => { hist.push(fn); paint(); };
}

// A row of tiles: list [{ html, off, ... }] -> pick(item, button). A .d-go slot below for a confirm.
function tiles(ctx, { top, ask, list, pick }) {
  const cols = ctx.device === 'phone' ? 2 : list.length === 4 ? 4 : Math.min(list.length, 3);
  ctx.el.innerHTML = `${top}${ask ? `<p class="co-ask">${ask}</p>` : ''}<div class="co-tiles co-in" style="--cols:${cols}">${list.map((t, i) =>
    `<button type="button" class="co-tile" data-i="${i}"${t.off ? ' disabled' : ''}>${t.html}</button>`).join('')}</div><div class="d-go"></div>`;
  ctx.el.querySelector('.co-tiles').onclick = e => { const b = e.target.closest('[data-i]'); if (b) pick(list[b.dataset.i], b); };
}
// Mark the picked tile and show one confirm under the tiles (with a note over it, e.g. the change).
function confirmUnder(ctx, b, text, go, note = '') {
  ctx.el.querySelectorAll('.co-tile.on').forEach(t => t.classList.remove('on'));
  b.classList.add('on');
  ctx.el.querySelector('.d-go').innerHTML = `${note ? `<p class="d-chg num">${note}</p>` : ''}<button type="button" class="co-btn primary">${text}</button>`;
  ctx.el.querySelector('.d-go button').onclick = go;
}

// One amount: big figure, keypad, one button that stays off until ok(v). Enter presses it.
function amount(ctx, { into = ctx.el, top = '', ask, raw = '', ok, sub, btn, next }) {
  into.insertAdjacentHTML('beforeend', `${top}${ask ? `<p class="co-ask">${ask}</p>` : ''}<div class="d-fig"><span class="co-fig num"></span></div><div class="d-sub num"></div><div class="d-pad"></div>`);
  const [fig, subEl, pad] = [...into.querySelectorAll('.co-fig, .d-sub, .d-pad')].slice(-3);
  const go = Object.assign(document.createElement('button'), { type: 'button', className: 'co-btn primary', textContent: btn });
  const val = () => ctx.money(parseFloat(raw) || 0);
  const draw = () => {
    fig.className = 'co-fig num' + (!raw ? ' ph' : val() > 0 && !ok(val()) ? ' down' : '');   // red only when it can't be right
    fig.innerHTML = ctx.typedPeso(raw || '0') + '<span class="co-caret"></span>';
    subEl.textContent = raw && sub ? sub(val()) : '';
    go.disabled = !ok(val());
  };
  const kp = ctx.keypad(k => { raw = ctx.keyInto(raw, k); draw(); }), key = kp._key;
  kp._key = e => (e.key === 'Enter' ? !go.disabled && go.click() : key(e));
  go.onclick = () => next(val(), raw);
  pad.append(kp, go);
  draw();
}

const methodTile = m => ({ id: m.id, m, html: `${m.icon}<span>${m.label}</span>` });
const leg = (method, amount, given) => given == null ? { method, amount } : { method, amount, given, change: Math.round((given - amount) * 100) / 100 };
// Cash handed over for a cash part p: Exact already on, the next bills, the keypad icon for any other amount; then one confirm.
function givenTiles(ctx, show, { top, p, then, btn = 'Next' }) {
  const list = quick(p).map((g, i) => ({ g, html: `<span class="co-big num">${i ? ctx.peso(g) : 'Exact'}</span>` }));
  list.push({ html: ctx.icon('keypad') });
  const pick = (t, b) => t.g == null ? show(() => amount(ctx, { top, ask: 'Cash given', ok: g => g >= p, sub: g => g > p ? `Change ${ctx.peso(g - p)}` : '', btn, next: then }))
    : confirmUnder(ctx, b, btn, () => then(t.g), t.g > p ? `Change ${ctx.peso(t.g - p)}` : '');
  tiles(ctx, { top, ask: 'Cash given', list, pick });
  pick(list[0], ctx.el.querySelector('.co-tile'));
}
const credit = ctx => ctx.room;
// lab only: the plain one-method tiles just pay it all (the real POS does its own steps there).
const single = (ctx, id) => ctx.done([leg(id, ctx.total, id === 'cash' ? ctx.total : null)]);
// the home tiles: the methods (the account only when the whole total fits) + Split
const startTiles = ctx => [...ctx.methods.map(methodTile).map(t => ({ ...t, off: t.id === 'credit' && ctx.total > credit(ctx) })), { split: true, html: `${SPLIT}<span>Split</span>` }];

// d1: method, then how much, then the rest -- each its own page.
addFlow({ id: 'd1', name: 'One question a page', idea: 'Pick the first way to pay, type how much, then pick how the rest is paid.', mount(ctx) {
  const show = steps(ctx), T = ctx.total, st = {}, avail = credit(ctx);
  const fits = (id, v) => id !== 'credit' || v <= avail;
  const home = () => tiles(ctx, { top: ctx.hero(), list: startTiles(ctx), pick: t => t.split ? show(first) : single(ctx, t.id) });
  const first = () => tiles(ctx, { top: ctx.hero(), list: ctx.methods.map(methodTile).map(t => ({ ...t, off: !fits(t.id, 0.01) })), pick: t => { st.a = t.m; show(howMuch); } });
  const howMuch = () => amount(ctx, { top: ctx.hero(), ask: `${st.a.label}`, raw: st.raw,
    ok: v => v > 0 && v < T && fits(st.a.id, v), btn: 'Next',
    next: (v, raw) => { Object.assign(st, { v, raw, given: null }); show(st.a.id === 'cash' ? given : rest); } });
  const given = () => givenTiles(ctx, show, { top: ctx.hero(ctx.peso(st.v)), p: st.v, then: g => { st.given = g; show(rest); } });
  const rest = () => {
    const r = ctx.money(T - st.v), top = ctx.hero(ctx.peso(r));
    const finish = (id, g) => ctx.done([leg(st.a.id, st.v, st.given), leg(id, r, g)]);
    tiles(ctx, { top, list: ctx.methods.filter(m => m.id !== st.a.id).map(methodTile).map(t => ({ ...t, off: !fits(t.id, r) })),
      pick: (t, b) => t.id === 'cash' ? show(() => givenTiles(ctx, show, { top, p: r, btn: 'Complete sale', then: g => finish('cash', g) }))
        : confirmUnder(ctx, b, 'Complete sale', () => finish(t.id)) });
  };
  show(home);
} });

// d2: Split opens a centred card with a keypad -- how much now. Then each part is the normal checkout.
addFlow({ id: 'd2', name: 'How much now?', idea: 'Type how much they pay first; then pay that, then the rest, the usual way.', mount(ctx) {
  const show = steps(ctx), T = ctx.total, avail = credit(ctx);
  let parts = [], card = null, raw = '';
  const close = () => { card?.remove(); card = null; };
  const back = ctx.onBack;
  ctx.onBack = () => (card ? (close(), true) : back());
  const open = b => {
    card = document.createElement('div');
    card.className = 'd-scrim';
    card.innerHTML = '<div class="d-card"></div>';
    card.onclick = e => e.target === card && close();
    ctx.el.append(card);
    const c = card.firstChild;
    amount(ctx, { into: c, raw, ok: v => v > 0 && v < T, sub: v => v < T ? `then ${ctx.peso(T - v)}` : '', btn: 'Next',
      next: (v, rw) => { raw = rw; close(); parts = [{ amount: v }, { amount: ctx.money(T - v) }]; show(() => part(0)); } });
    const t = b.getBoundingClientRect(), k = c.getBoundingClientRect();
    c.style.transformOrigin = `${t.left + t.width / 2 - k.left}px ${t.top + t.height / 2 - k.top}px`;
  };
  const home = () => tiles(ctx, { top: ctx.hero(), list: startTiles(ctx), pick: (t, b) => t.split ? open(b) : single(ctx, t.id) });
  // A part: its amount is the big number; the parts line under it keeps the whole sale in view.
  const line = i => `<p class="co-ask num">${parts.map((p, j) => j === i ? ctx.peso(p.amount) : `<span class="d-dim">${ctx.peso(p.amount)}</span>`).join(' + ')}</p>`;
  const part = i => {
    const p = parts[i], last = i === parts.length - 1, top = ctx.hero(ctx.peso(p.amount)) + line(i);
    const used = parts.slice(0, i).map(q => q.method);
    const next = (method, given) => { parts[i] = { ...p, method, given }; last ? ctx.done(parts.map(q => leg(q.method, q.amount, q.given))) : show(() => part(i + 1)); };
    tiles(ctx, { top, list: ctx.methods.filter(m => !used.includes(m.id)).map(methodTile).map(t => ({ ...t, off: t.id === 'credit' && p.amount > avail })),
      pick: (t, b) => t.id === 'cash' ? show(() => givenTiles(ctx, show, { top, p: p.amount, btn: last ? 'Complete sale' : 'Next', then: g => next('cash', g) }))
        : last ? confirmUnder(ctx, b, 'Complete sale', () => next(t.id)) : next(t.id) });   // only the last part needs a confirm
  };
  show(home);
} });

// d3: tap the two ways to pay, type the first one's part; the second takes the rest.
addFlow({ id: 'd3', name: 'Tap two, type one', idea: 'Tap the two ways they pay, type how much goes on the first; the second gets the rest.', mount(ctx) {
  const show = steps(ctx), T = ctx.total, avail = credit(ctx), st = { pick: [] };
  const fits = (id, v) => id !== 'credit' || v <= avail;
  const home = () => tiles(ctx, { top: ctx.hero(), list: startTiles(ctx), pick: t => t.split ? show(two) : single(ctx, t.id) });
  const two = () => (st.pick = [], tiles(ctx, { top: ctx.hero(), list: ctx.methods.map(methodTile).map(t => ({ ...t, off: !fits(t.id, 0.01) })), pick: (t, b) => {
    if (st.pick[0] === t.m) return;
    b.classList.add('on'); st.pick.push(t.m);
    if (st.pick.length === 2) { st.raw = ''; setTimeout(() => show(howMuch), 120); }
  } }));
  const howMuch = () => {
    const [a, z] = st.pick;
    amount(ctx, { top: ctx.hero(), ask: a.label, raw: st.raw, ok: v => v > 0 && v < T && fits(a.id, v) && fits(z.id, T - v),
      sub: v => v < T ? `${z.label} ${ctx.peso(T - v)}` : '', btn: a.id === 'cash' || z.id === 'cash' ? 'Next' : 'Complete sale',
      next: (v, raw) => {
        st.raw = raw;
        const r = ctx.money(T - v), cashP = a.id === 'cash' ? v : z.id === 'cash' ? r : 0;
        const finish = g => ctx.done([leg(a.id, v, a.id === 'cash' ? g : null), leg(z.id, r, z.id === 'cash' ? g : null)]);
        cashP ? show(() => givenTiles(ctx, show, { top: ctx.hero(ctx.peso(cashP)), p: cashP, btn: 'Complete sale', then: finish })) : finish();
      } });
  };
  show(home);
} });
})();
