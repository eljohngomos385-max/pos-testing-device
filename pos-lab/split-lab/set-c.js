// designer c -- "One screen, two boxes": both parts on screen at once; type one, the other fills itself.
// The cash handed (Exact already on) shows on the same screen once both parts are set: no Next.
(() => {
const F = ':is(.f-c1, .f-c3)';
document.head.insertAdjacentHTML('beforeend', `<style>
${F} > .co-tiles { --cols: 3; }
.phone ${F} > .co-tiles { --cols: 2; }
${F} .co-tile small { color: var(--ink-tertiary); }
${F} .c-one { margin-top: 20px; max-width: 334px; justify-self: center; }
${F} .c-col { display: grid; gap: 14px; width: 100%; max-width: 420px; justify-self: center; }
${F} .c-sp { display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: auto auto 1fr;
             grid-template-areas: "a k" "q k" "g k"; gap: 12px 32px; }
.phone ${F} .c-sp { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "a" "k" "q" "g"; gap: 14px; }
${F} .c-a { grid-area: a; display: grid; gap: 10px; align-content: start; }
${F} .c-sp > .c-kp { grid-area: k; }
${F} .c-sp > .c-bills { grid-area: q; }
${F} .c-sp > .c-go { grid-area: g; align-self: end; }
${F} .c-box { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px; padding: 12px 16px 14px;
              border: 2px solid transparent; border-radius: 14px; background: var(--tile); cursor: pointer; transition: border-color .12s, background-color .12s; }
${F} .c-box .co-fig { grid-column: 1 / -1; }
${F} .c-box.on { border-color: var(--accent); background: var(--surface-2); }
${F} .c-box:not(.on) .co-fig:not(.down) { color: var(--ink-secondary); }
${F} .c-m { display: inline-flex; align-items: center; gap: 6px; justify-self: start; height: 32px; margin: -4px -8px 0; padding: 0 8px;
            border-radius: var(--r-input); color: var(--ink-secondary); font-weight: 560; }
${F} button.c-m:hover { background: var(--surface-hover); }
${F} .c-m .co-ic { width: 18px; height: 18px; }
${F} .c-ph { color: var(--ink-quaternary); }
${F} .c-ch { color: var(--ok); font-size: 13px; font-weight: 560; }
${F} .c-q { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; }
${F} .c-q .co-tile { height: 64px; padding: 0 4px; font-size: 16px; }
${F} .c-due { display: flex; justify-content: space-between; align-items: baseline; padding: 0 2px; }
${F} .c-due .co-fig { font-size: 30px; }
${F} .c-chg .co-fig { color: var(--ok); }
/* c3: two tiles side by side, one column */
.f-c3 .c-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.f-c3 .c-pair .c-box { grid-template-columns: minmax(0, 1fr); min-height: 112px; align-content: center; justify-items: center; text-align: center; }
.f-c3 .c-pair .c-m { justify-self: center; margin: 0; }
.f-c3 .c-pair .co-fig { font-size: 26px; }
.f-c3 .c-pair .c-ch { order: 1; min-height: 18px; }
</style>`);

const SPLIT = '<svg class="co-ic" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14"/></svg>';
const CARET = '<span class="co-caret"></span>';
const num = raw => Math.round((parseFloat(raw) || 0) * 100) / 100;
// two bills above the part, the nearest and the big one: 500 -> 600, 1,000 ; 250 -> 300, 1,000 ; 1,250 -> 1,300, 2,000
const quick = p => { const v = [...new Set([100, 500, 1000].map(b => (Math.floor(p / b) + 1) * b))]; return [...new Set([v[0], v.at(-1)])]; };
const fits = (ctx, m, v) => m !== 'credit' || v <= ctx.room;   // the account only takes what it has room for

// ---- the checkout as today: method tiles + Split; Cash -> cash handed; the rest -> Complete sale
function start(ctx, split) {
  ctx.setBack('Cancel'); ctx.onBack = null;
  ctx.el.innerHTML = ctx.hero() + `<div class="co-tiles">${ctx.methods.map(m => `<button type="button" class="co-tile" data-m="${m.id}"${fits(ctx, m.id, ctx.total) ? '' : ' disabled'}>${m.icon}${ctx.esc(m.label)}</button>`).join('')
    }<button type="button" class="co-tile" data-m="split">${SPLIT}Split</button></div><button type="button" class="co-btn primary c-one" hidden>Complete sale</button>`;
  const go = ctx.el.querySelector('.c-one');
  const home = () => start(ctx, split);
  ctx.el.querySelector('.co-tiles').onclick = e => {
    const t = e.target.closest('[data-m]'); if (!t) return;
    const m = t.dataset.m;
    if (m === 'split') return split();
    if (m === 'cash') return cashStep(ctx, home, (given, change) => ctx.done([{ method: 'cash', amount: ctx.total, given, change }]));
    ctx.el.querySelector('.co-tile.on')?.classList.remove('on'); t.classList.add('on');
    go.hidden = false; go.onclick = () => ctx.done([{ method: m, amount: ctx.total }]);
  };
}

// cash handed: Exact (on), two bills, the keypad icon for any other amount
function bills(ctx, part, pick, other) {
  const el = document.createElement('div');
  el.className = 'c-q co-in';
  el.innerHTML = [part, ...quick(part)].map((v, i) => `<button type="button" class="co-tile${i ? '' : ' on'}" data-v="${v}">${i ? ctx.peso(v) : 'Exact'}</button>`).join('')
    + `<button type="button" class="co-tile" data-v="" aria-label="Other amount">${ctx.icon('keypad')}</button>`;
  el.onclick = e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (!b.dataset.v) return other();
    el.querySelector('.on').classList.remove('on'); b.classList.add('on'); pick(+b.dataset.v);
  };
  return el;
}

const CHG = '<div class="c-due c-chg" style="visibility:hidden"><span class="co-lbl">Change</span><span class="co-fig num"></span></div>';
const showChg = (ctx, el, g, part) => { el.style.visibility = g > part ? '' : 'hidden'; el.lastChild.textContent = ctx.peso(g - part); };
// the one-method Cash page: bills row, change, Complete sale
function cashStep(ctx, back, finish) {
  const part = ctx.total, self = () => cashStep(ctx, back, finish);
  ctx.setBack('Back'); ctx.onBack = () => (back(), true);
  ctx.el.innerHTML = ctx.hero() + `<div class="c-col co-in"><div class="c-bills"></div>${CHG}<button type="button" class="co-btn primary c-go">Complete sale</button></div>`;
  const chg = ctx.el.querySelector('.c-chg');
  let given = part;
  ctx.el.querySelector('.c-bills').append(bills(ctx, part, g => { given = g; showChg(ctx, chg, g, part); }, () => typedStep(ctx, part, self, finish)));
  ctx.el.querySelector('.c-go').onclick = () => finish(given, ctx.money(given - part));
}
// any other amount handed: typed
function typedStep(ctx, part, back, finish) {
  ctx.setBack('Back'); ctx.onBack = () => (back(), true);
  ctx.el.innerHTML = ctx.hero() + `<div class="c-sp co-in"><div class="c-a">${part < ctx.total
    ? `<div class="c-due"><span class="c-m">${ctx.icon('cash')}Cash</span><span class="co-fig num">${ctx.peso(part)}</span></div>` : ''}
    <div class="c-due"><span class="co-lbl">Cash given</span><span class="co-fig num c-g"></span></div>${CHG}</div>
    <div class="c-kp"></div><button type="button" class="co-btn primary c-go">Complete sale</button></div>`;
  const go = ctx.el.querySelector('.c-go'), fig = ctx.el.querySelector('.c-g'), chg = ctx.el.querySelector('.c-chg');
  let raw = '';
  const paint = () => {
    const g = num(raw);
    fig.className = 'co-fig num c-g' + (raw ? '' : ' ph');
    fig.innerHTML = ctx.typedPeso(raw || '0') + CARET;
    showChg(ctx, chg, g, part); go.disabled = !(g >= part);
  };
  ctx.el.querySelector('.c-kp').append(ctx.keypad(k => { raw = ctx.keyInto(raw, k); paint(); }));
  go.onclick = () => finish(num(raw), ctx.money(num(raw) - part));
  paint();
}

// ---- the pair: S = { pair: [method, method], act: box being typed, raw: its keypad string, fresh: next key replaces }
const amounts = (S, total) => { const a = Math.min(num(S.raw), total), r = Math.round((total - a) * 100) / 100; return S.act ? [r, a] : [a, r]; };
const ok = a => a[0] > 0 && a[1] > 0;
function activate(S, total, i) {   // tap the other box: it keeps its amount, the next key replaces it
  if (i === S.act) return;
  const a = amounts(S, total);
  S.act = i; S.raw = ok(a) ? String(a[i]) : ''; S.fresh = !!S.raw;
}
function cycle(ctx, S, i) {   // tap a box's method name: the next method (never the other box's)
  const ids = ctx.methods.map(m => m.id);
  let j = ids.indexOf(S.pair[i]);
  do j = (j + 1) % ids.length; while (ids[j] === S.pair[1 - i]);
  S.pair[i] = ids[j];
}

const boxHTML = i => `<div class="c-box" data-i="${i}"><button type="button" class="c-m"></button><span class="c-ch num"></span><span class="co-fig num"></span></div>`;
function paintBoxes(ctx, S) {
  const a = amounts(S, ctx.total);
  ctx.el.querySelectorAll('.c-box[data-i]').forEach(box => {
    const i = +box.dataset.i, m = ctx.methods.find(x => x.id === S.pair[i]), fig = box.querySelector('.co-fig');
    box.classList.toggle('on', i === S.act);
    box.querySelector('.c-m').innerHTML = m.icon + ctx.esc(m.label);
    // red only when it can't be right: the whole total (or more) typed, or more than the account can take
    fig.classList.toggle('down', (i === S.act && num(S.raw) >= ctx.total) || !fits(ctx, m.id, a[i]));
    fig.innerHTML = i === S.act
      ? (S.fresh ? ctx.peso(num(S.raw)) : S.raw ? ctx.typedPeso(S.raw) : `<span class="c-ph">${ctx.typedPeso('0')}</span>`) + CARET
      : `<span class="${S.raw && a[i] > 0 ? '' : 'c-ph'}">${ctx.peso(S.raw ? a[i] : 0)}</span>`;   // nothing typed: both ₱0, no jump
  });
  return a;
}

// the two-box screen: keypad types the ringed box; once both parts are set, the cash handed row; the button stays off till then
function pairScreen(ctx, S, home, self, html) {
  ctx.setBack('Back'); ctx.onBack = () => (home(), true);
  ctx.el.innerHTML = ctx.hero() + html;
  const go = ctx.el.querySelector('.c-go'), row = ctx.el.querySelector('.c-bills');
  let part = null, given = 0, a = [0, 0];
  const legs = () => S.pair.map((method, i) => method === 'cash' ? { method, amount: a[i], given, change: ctx.money(given - a[i]) } : { method, amount: a[i] });
  const change = () => {
    const ci = S.pair.indexOf('cash');
    ctx.el.querySelectorAll('.c-ch').forEach((c, i) => { c.textContent = i === ci && given > part ? 'Change ' + ctx.peso(given - part) : ''; });
  };
  const paint = () => {
    a = paintBoxes(ctx, S);
    const set = ok(a) && S.pair.every((m, i) => fits(ctx, m, a[i])), ci = S.pair.indexOf('cash'), p = set && ci >= 0 ? a[ci] : 0;
    go.disabled = !set;
    if (p !== part) {   // the cash part changed: Exact again
      part = given = p;
      row.replaceChildren(...(p ? [bills(ctx, p, g => { given = g; change(); },
        () => typedStep(ctx, p, () => self(ctx, S, home), (g, c) => { given = g; ctx.done(legs()); }))] : []));
    }
    change();
  };
  ctx.el.querySelector('.c-kp').append(ctx.keypad(k => { S.raw = ctx.keyInto(S.fresh ? '' : S.raw, k); S.fresh = false; paint(); }));
  ctx.el.querySelectorAll('.c-box[data-i]').forEach(box => box.onclick = e => {
    const i = +box.dataset.i;
    if (e.target.closest('.c-m')) cycle(ctx, S, i); else activate(S, ctx.total, i);
    paint();
  });
  go.onclick = () => ctx.done(legs());
  paint();
}

// c1: two stacked boxes (tablet: keypad on the right)
const c1 = (ctx, S, home) => pairScreen(ctx, S, home, c1,
  `<div class="c-sp co-in"><div class="c-a">${boxHTML(0)}${boxHTML(1)}</div><div class="c-kp"></div><div class="c-bills"></div><button type="button" class="co-btn primary c-go">Complete sale</button></div>`);
// c3: two tiles side by side, one column; the change shows in the cash tile
const c3 = (ctx, S, home) => pairScreen(ctx, S, home, c3,
  `<div class="c-col co-in"><div class="c-pair">${boxHTML(0)}${boxHTML(1)}</div><div class="c-kp"></div><div class="c-bills"></div><button type="button" class="co-btn primary c-go">Complete sale</button></div>`);

const flow = (id, name, idea, screen) => addFlow({ id, name, idea, mount(ctx) {
  const S = { pair: ['cash', 'gcash'], act: 0, raw: '', fresh: false };
  const home = () => start(ctx, () => screen(ctx, S, home));
  home();
} });
flow('c1', 'Two boxes', 'Type one part; the other box fills itself; tap what they handed; done.', c1);
flow('c3', 'Two tiles', 'Type one part; the cash tile shows the change.', c3);
})();
