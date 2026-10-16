// f1 "Choose two, one question each" (owner's idea 2026-10-10): Split -> choose two -> each asks "how much?" in turn
// (the second comes filled with what is left; type less and it says so) -> cash asks what was handed over, GCash / QR / Maya
// its reference (optional) -> Complete sale.
(() => {
  const css = document.createElement('style');
  css.textContent = `
  :is(.f-f1, .f-f2) .f-q { display: grid; justify-items: center; gap: 4px; margin: 4px 0 18px; text-align: center; }
  :is(.f-f1, .f-f2) .f-q .co-lbl { font-size: 15px; color: var(--ink-secondary); }
  :is(.f-f1, .f-f2) .f-q .co-fig { font-size: 44px; }
  :is(.f-f1, .f-f2) .f-q .f-hint { min-height: 20px; color: var(--ink-tertiary); font-size: 13px; font-weight: 500; }
  :is(.f-f1, .f-f2) .f-q .f-hint.down { color: var(--danger); }
  :is(.f-f1, .f-f2) .f-pad { display: grid; gap: 12px; width: 100%; max-width: 360px; justify-self: center; }
  :is(.f-f1, .f-f2) .f-pad .co-btn { margin-top: 4px; }
  :is(.f-f1, .f-f2) .f-done { display: flex; justify-content: center; gap: 18px; margin: -8px 0 16px; color: var(--ink-tertiary); font-size: 13px; }
  :is(.f-f1, .f-f2) .f-done b { color: var(--ink); font-weight: 600; }
  :is(.f-f1, .f-f2) .co-tile .f-n { position: absolute; top: 8px; right: 10px; font-size: 12px; font-weight: 700; }
  :is(.f-f1, .f-f2) .co-tile { position: relative; }
  .f-f2 .f-paid { margin: 8px 0 -8px; text-align: center; color: var(--ink-tertiary); font-size: 14px; }
  .f-f2 .f-paid b { color: var(--ink-secondary); font-weight: 600; }
  `;
  document.head.append(css);

  // Quick cash: Exact, then the next 100 / 500 / 1000 above (as the POS's Cash step)
  const quick = c => [c, ...new Set([100, 500, 1000].map(m => (Math.floor(Math.round(c * 100) / (m * 100)) + 1) * m))];

  addFlow({ id: 'f1', name: 'Choose two, one question each', idea: 'Tap Split, choose two, then each asks how much (the second is filled with what is left).', mount(ctx) {
    const { peso, money, esc } = ctx, total = money(ctx.total);
    const label = id => ctx.methods.find(m => m.id === id).label;
    let picks = [], steps = [], at = -1, raw = '', fresh = false;
    const legs = [];   // [{ method, amount, given?, change?, ref? }]

    const paid = () => money(legs.reduce((s, l) => s + (l.amount || 0), 0));
    const plan = () => {   // amount, then Given (cash) or Reference (GCash / QR / Maya), per method
      steps = picks.flatMap((m, i) => [{ k: 'amt', i }, ...(m === 'cash' ? [{ k: 'given', i }] : m === 'credit' ? [] : [{ k: 'ref', i }])]);
    };
    const go = n => {
      at = n;
      if (at < 0) return pick();
      const s = steps[at], m = picks[s.i];
      legs[s.i] ||= { method: m };
      if (s.k === 'amt') { const left = money(total - paid() + (legs[s.i].amount || 0)); raw = s.i === 1 ? String(left) : legs[s.i].amount ? String(legs[s.i].amount) : ''; fresh = s.i === 1; }
      if (s.k === 'ref') { raw = legs[s.i].ref || ''; fresh = false; }
      if (s.k === 'given') delete legs[s.i].typing;
      draw();
    };
    const last = () => at === steps.length - 1;
    const next = () => (last() ? ctx.done(legs.map(({ ref, typing, ...l }) => l)) : go(at + 1));
    ctx.onBack = () => { if (at < 0 && !picks.length) return false; if (at < 0) { picks = []; pick(); return true; } go(at - 1); return true; };

    function pick() {
      ctx.setBack(picks.length ? 'Back' : 'Cancel');
      const tiles = ctx.methods.map(m => {
        const n = picks.indexOf(m.id) + 1;
        return `<button type="button" class="co-tile${n ? ' on' : ''}" data-m="${m.id}">${n ? `<span class="f-n">${n}</span>` : ''}${m.icon}<span>${esc(m.label)}</span></button>`;
      }).join('');
      ctx.el.innerHTML = `${ctx.hero()}<p class="co-ask">Choose two</p><div class="co-tiles co-in" style="--cols:${ctx.methods.length > 4 ? 3 : 2}">${tiles}</div>`;
      ctx.el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
        const m = b.dataset.m;
        picks = picks.includes(m) ? picks.filter(x => x !== m) : [...picks, m];
        if (picks.length === 2) { legs.length = 0; plan(); go(0); } else pick();
      });
    }

    function draw() {
      ctx.setBack('Back');
      const s = steps[at], m = picks[s.i], name = label(m), leg = legs[s.i];
      const doneRow = legs.filter((l, i) => i !== s.i && l.amount).map(l => `<span>${esc(label(l.method))} <b>${peso(l.amount)}</b></span>`).join('');
      const head = `${ctx.hero()}${doneRow ? `<div class="f-done">${doneRow}</div>` : ''}`;
      const btn = last() ? 'Complete sale' : 'Next';

      if (s.k === 'given' && !leg.typing) {   // what the customer handed over for the cash part; Other amount types it
        const c = leg.amount, q = quick(c).slice(0, 3);
        ctx.el.innerHTML = `${head}<div class="f-q"><span class="co-lbl">Cash given?</span></div>
          <div class="co-tiles co-in" style="--cols:2">${q.map((v, i) => `<button type="button" class="co-tile" data-v="${v}">${i ? `<span class="co-big num">${peso(v).replace(/\.00$/, '')}</span><small>Change ${peso(v - c)}</small>` : `<span class="co-big">Exact</span><small>${peso(c)}</small>`}</button>`).join('')}<button type="button" class="co-tile" data-other><span class="co-big">Other</span><small>Type it</small></button></div>`;
        ctx.el.querySelector('[data-other]').onclick = () => { leg.typing = true; raw = ''; fresh = false; draw(); };
        ctx.el.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { leg.given = money(+b.dataset.v); leg.change = money(leg.given - c); next(); });
        return;
      }

      let fig, hint = '', cls = '', ok = true;
      if (s.k === 'ref') {
        fig = raw ? esc(raw) : 'Optional'; cls = raw ? '' : 'ph';
      } else if (s.k === 'given') {
        const v = money(parseFloat(raw) || 0);
        fig = raw ? ctx.typedPeso(raw) : peso(0); cls = raw ? '' : 'ph'; ok = v >= leg.amount;
        hint = !raw ? '' : ok ? `Change ${peso(v - leg.amount)}` : `${peso(leg.amount - v)} short`;
      } else {
        const v = money(parseFloat(raw) || 0), left = money(total - paid() + (leg.amount || 0)), short = money(left - v);
        fig = raw ? ctx.typedPeso(raw) : peso(0); cls = raw ? '' : 'ph';
        if (s.i === 0) { ok = v > 0 && v < total; hint = v >= total && raw ? `Less than ${peso(total)}` : ''; cls = v >= total && raw ? 'down' : cls; }
        else { ok = short === 0; hint = !raw ? '' : short > 0 ? `${peso(short)} left to pay` : short < 0 ? `${peso(-short)} too much` : ''; }
      }
      ctx.el.innerHTML = `${head}<div class="f-q co-in"><span class="co-lbl">${esc(name)} · ${s.k === 'ref' ? 'reference no.' : s.k === 'given' ? 'given' : 'how much?'}</span>
        <b class="co-fig num ${cls}">${fig}${s.k === 'ref' && !raw ? '' : '<span class="co-caret"></span>'}</b>
        <span class="f-hint${hint && !ok ? ' down' : ''}">${hint}</span></div>
        <div class="f-pad co-in"></div>`;
      const pad = ctx.el.querySelector('.f-pad');
      pad.append(ctx.keypad(k => {
        if (s.k === 'ref') { raw = k === 'del' ? raw.slice(0, -1) : k === '.' || raw.length >= 20 ? raw : raw + k; }
        else { raw = ctx.keyInto(fresh && k !== 'del' ? '' : raw, k); fresh = false; }
        draw();
      }));
      pad.insertAdjacentHTML('beforeend', `<button type="button" class="co-btn primary"${ok ? '' : ' disabled'}>${btn}</button>`);
      pad.lastElementChild.onclick = () => {
        if (s.k === 'ref') leg.ref = raw;
        else if (s.k === 'given') { leg.given = money(parseFloat(raw)); leg.change = money(leg.given - leg.amount); }
        else { leg.amount = money(parseFloat(raw)); if (s.i === 0) delete legs[1]?.amount; }
        next();
      };
    }

    pick();
  } });

  // f2 "Part, then the rest" (2026-10-10, redone after the owner found a 3rd round): the customer says "GCash 500, the
  // rest cash" -> tap GCash -> type 500 -> its reference -> "PHP 750" + the other methods -> tap Cash -> Cash given? -> done.
  // Only the first part is typed; the second always takes the rest, so it is always exactly two.
  addFlow({ id: 'f2', name: 'Part, then the rest', idea: 'Type how much the first method pays; the second method takes the rest.', mount(ctx) {
    const { peso, money, esc } = ctx, total = money(ctx.total);
    const label = id => ctx.methods.find(m => m.id === id).label;
    const a = {};   // the first part
    let b = {};     // the rest
    const hist = [];
    const go = fn => { hist.push(fn); fn(); };
    ctx.onBack = () => { if (hist.length < 2) return false; hist.pop(); hist.at(-1)(); return true; };
    const done = () => ctx.done([a, b].map(({ ref, ...l }) => l));
    const paid = () => `<p class="f-paid">✓ ${esc(label(a.method))} <b>${peso(a.amount)}</b></p>`;

    function tiles(top, ask, list, tap) {
      ctx.setBack(hist.length > 1 ? 'Back' : 'Cancel');
      ctx.el.innerHTML = `${top}<p class="co-ask">${ask}</p><div class="co-tiles co-in" style="--cols:${list.length > 4 ? 3 : 2}">${list.join('')}</div>`;
      ctx.el.querySelectorAll('[data-t]').forEach(el => el.onclick = () => tap(el.dataset.t));
    }
    const mTile = m => `<button type="button" class="co-tile" data-t="${m.id}">${m.icon}<span>${esc(m.label)}</span></button>`;

    function ask(o) {   // one box on a keypad: o.title, o.ref (digits, optional), o.check(v) -> [ok, hint], o.btn, o.next
      let raw = o.raw || '';
      const paint = () => {
        ctx.setBack('Back');
        const v = money(parseFloat(raw) || 0), [ok, hint] = o.ref ? [true, ''] : o.check(v), bad = !ok && hint;
        const fig = o.ref ? (raw ? esc(raw) : 'Optional') : raw ? ctx.typedPeso(raw) : peso(0);
        ctx.el.innerHTML = `${o.top || ''}<div class="f-q co-in"><span class="co-lbl">${esc(o.title)}</span>
          <b class="co-fig num${raw ? '' : ' ph'}${bad ? ' down' : ''}">${fig}${o.ref && !raw ? '' : '<span class="co-caret"></span>'}</b>
          <span class="f-hint${bad ? ' down' : ''}">${hint}</span></div><div class="f-pad co-in"></div>`;
        const pad = ctx.el.querySelector('.f-pad');
        pad.append(ctx.keypad(k => { raw = !o.ref ? ctx.keyInto(raw, k) : k === 'del' ? raw.slice(0, -1) : k === '.' || raw.length >= 20 ? raw : raw + k; paint(); }));
        pad.insertAdjacentHTML('beforeend', `<button type="button" class="co-btn primary"${ok ? '' : ' disabled'}>${o.btn || 'Next'}</button>`);
        pad.lastElementChild.onclick = () => o.next(o.ref ? raw : v);
      };
      paint();
    }

    const ref = (leg, after) => () => ask({ title: `${label(leg.method)} reference no.`, ref: true, raw: leg.ref, top: leg === b ? paid() : '',
      btn: leg === b ? 'Complete sale' : 'Next', next: r => { leg.ref = r; after(); } });

    const first = () => tiles(ctx.hero(), 'Pay first with', ctx.methods.map(mTile), m => { if (a.method !== m) delete a.amount; a.method = m; go(amount); });

    const amount = () => ask({ title: `${label(a.method)} pays`, raw: a.amount ? String(a.amount) : '',
      check: v => v >= total ? [false, `Less than ${peso(total)}`] : [v > 0, v > 0 ? `${peso(total - v)} left` : ''],
      next: v => { a.amount = v; go(a.method === 'cash' || a.method === 'credit' ? second : ref(a, () => go(second))); } });

    const second = () => tiles(`${paid()}${ctx.hero(peso(money(total - a.amount)))}`, 'Pay the rest with',
      ctx.methods.filter(m => m.id !== a.method).map(mTile), m => {
        b = { method: m, amount: money(total - a.amount) };
        if (m === 'credit') return done();
        go(m === 'cash' ? given : ref(b, done));
      });

    const given = () => {   // only the rest asks what was handed over; a typed cash part is handed over as typed
      const c = b.amount;
      tiles(`${paid()}${ctx.hero(peso(c))}`, 'Cash given?', [
        ...quick(c).slice(0, 3).map((v, i) => `<button type="button" class="co-tile" data-t="${v}">${i ? `<span class="co-big num">${peso(v).replace(/\.00$/, '')}</span><small>Change ${peso(v - c)}</small>` : '<span class="co-big">Exact</span>'}</button>`),
        '<button type="button" class="co-tile" data-t="other"><span class="co-big">Other</span></button>'], t => {
        if (t === 'other') return go(typed);
        b.given = money(+t); b.change = money(b.given - c); done();
      });
    };
    const typed = () => ask({ title: 'Cash given', top: paid(), btn: 'Complete sale',
      check: v => !v ? [false, ''] : v < b.amount ? [false, `${peso(b.amount - v)} short`] : [true, `Change ${peso(v - b.amount)}`],
      next: v => { b.given = v; b.change = money(v - b.amount); done(); } });

    go(first);
  } });

})();
