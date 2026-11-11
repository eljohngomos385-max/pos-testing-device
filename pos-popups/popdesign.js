/* Pop-up designs to try (owner 2026-11-11: "copy the POS lab ... put the toggle at the sidebar so I can switch between
   the different designs and compare"). Lab copy only. Picked in ☰; with "Now" every pop-up is the app's own.
   Under a design:
   - every action list (Sale ⋯, Order ⋯, Markup, Status ...) is a box that grows out of its button, phone and iPad
   - Customer is a box under the customer button with a search on top
   (sold by measure stays the app's own: owner 2026-11-11, never asked for a pop-up there)
   ponytail: loads after app.js and rebinds the app's global openMenu / openActionSheet / openCustomerModal;
   to port one design, its markup + CSS go into pos-sell.js / styles.css and the rebinding goes away. */
(() => {
  // round 4 (owner: the iPhone glass "looks really weird", redesign from scratch): three new boxes from the app's own
  // rules; still on its button, no icons, nothing behind dimmed (round 2)
  const DESIGNS = [['now', 'Now (as it is)'], ['card', 'Card'], ['list', 'List'], ['ink', 'Ink']];
  let design = HWPOS_STORE.ui.get('popDesign', 'now');
  if (!DESIGNS.some(([k]) => k === design)) design = 'card';   // an older round's pick opens on the new one
  const on = () => design !== 'now';
  const apply = () => { for (const [k] of DESIGNS) document.body.classList.toggle('pd-' + k, k === design && on()); };
  apply();

  // the picker, over the side menu's footer
  const pick = document.createElement('label');
  pick.className = 'pd-pick';
  pick.innerHTML = `<span>Pop-ups</span><select>${DESIGNS.map(([k, t]) => `<option value="${k}"${k === design ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  document.querySelector('.sidebar .side-footer').before(pick);
  pick.querySelector('select').addEventListener('change', (e) => { design = e.target.value; HWPOS_STORE.ui.set('popDesign', design); apply(); });

  // the only mark left: a tick on the row that is on now
  const tick = '<svg class="ok" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5.2 7.1L19.8 4.4"/></svg>';

  // One box over a clear layer that only catches the closing tap. It sits on its trigger r (its top and its near side
  // on r's), or ends on r's bottom when there is no room below, and grows from that corner. Returns { box, close }.
  let open = null;
  function popBox(r, html, cls = '', width) {
    open?.close(true);
    const veil = document.createElement('div'), box = document.createElement('div');
    veil.className = 'pd-veil';
    box.className = 'pd-box ' + cls;
    if (width) box.style.width = width + 'px';
    box.setAttribute('role', 'dialog');
    box.tabIndex = -1;
    box.innerHTML = html;
    document.body.append(veil, box);
    const w = box.offsetWidth, h = box.offsetHeight, W = innerWidth, H = innerHeight, edge = 8;
    const right = r.left + r.width / 2 > W / 2;
    const up = r.top + h > H - edge;   // no room below: it ends on the button's bottom instead
    const left = Math.max(edge, Math.min(W - w - edge, right ? r.right - w : r.left));
    const top = Math.max(edge, Math.min(H - h - edge, up ? r.bottom - h : r.top));
    const o = { x: right ? left + w : left, y: up ? top + h : top };   // the pinned corner
    box.style.left = left + 'px'; box.style.top = top + 'px';
    box.style.transformOrigin = `${o.x - left}px ${o.y - top}px`;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: calm ? 0 : 300, easing: 'cubic-bezier(.25,1.15,.45,1)' });
    const close = (now) => {
      if (open !== me) return;
      open = null;
      removeEventListener('keydown', key, true);
      if (now) return veil.remove(), box.remove();
      veil.style.pointerEvents = box.style.pointerEvents = 'none';
      box.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: calm ? 0 : 140, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
        .onfinish = () => { veil.remove(); box.remove(); };
    };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const me = { box, close };
    addEventListener('keydown', key, true);
    veil.addEventListener('click', () => close());
    open = me;
    return me;
  }

  // ---------- Action lists ----------
  function menuBox(trigger, items) {
    const rows = items.map((it, i) => it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="pd-row${it.red ? ' red' : ''}${it.cur ? ' cur' : ''}"${it.off ? ' disabled' : ''}>`
      + `<span>${escapeHtml(it.label)}</span>${it.cur ? tick : ''}</button>`).join('');
    const { box, close } = popBox(trigger.getBoundingClientRect(), `<div class="pd-list" role="menu">${rows}</div>`);
    trigger.setAttribute('aria-expanded', 'true');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      close(); trigger.setAttribute('aria-expanded', 'false');
      items[b.dataset.i].run();
    });
    // a keyboard starts on the first row; a finger starts on nothing (else that row shows pressed, owner shot 2026-11-11)
    if (!matchMedia('(pointer: coarse)').matches) (box.querySelector('.pd-row:not(:disabled)') || box).focus({ preventScroll: true });
  }
  const appMenu = window.openMenu, appSheet = window.openActionSheet;
  window.openMenu = (trigger, items, opts) => (on() ? menuBox(trigger, items) : appMenu(trigger, items, opts));
  window.openActionSheet = (btn, title, items, cls) => (on() ? menuBox(btn, items) : appSheet(btn, title, items, cls));

  // ---------- Customer ----------
  const appCust = window.openCustomerModal;
  window.openCustomerModal = () => {
    if (!on() || state.exchange || state.view !== 'sell') return appCust();
    closeEditSheet();
    const r = document.getElementById('customerBtn').getBoundingClientRect();
    const me = popBox(r, `<label class="pd-find"><input type="search" placeholder="Search" autocomplete="off" aria-label="Search customers"></label><div class="pd-list"></div>`, 'pd-cust', Math.min(Math.max(r.width, 260), 340, innerWidth - 24));   // as wide as the bar it covers
    const list = me.box.querySelector('.pd-list'), input = me.box.querySelector('input');
    const row = (id, name, sub) => `<button type="button" class="pd-row${(state.customer?.id || 'walk-in') === id ? ' cur' : ''}" data-id="${escapeHtml(id)}"><span>${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span>${(state.customer?.id || 'walk-in') === id ? tick : ''}</button>`;
    const draw = () => {
      const q = input.value.trim().toLowerCase(), all = allCustomerRecords();
      const shown = all.filter(c => !q || [c.name, c.phone, c.address].some(s => String(s || '').toLowerCase().includes(q)));
      list.innerHTML = '<button type="button" class="pd-row" data-new><span>New customer</span></button>'
        + (q ? '' : row('walk-in', 'Walk-in customer', ''))
        + shown.map(c => row(c.id, c.name, [c.phone, c.address].filter(Boolean).join(' · '))).join('')
        + (q && !shown.length ? `<p class="pd-none">No one called “${escapeHtml(input.value.trim())}”</p>` : '');
    };
    draw();
    input.addEventListener('input', draw);
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.pd-row');
      if (!b) return;
      me.close();
      if (b.hasAttribute('data-new')) document.getElementById('custNewBar').click();   // the app's own New customer (addCustomerFromSale)
      else selectCustomer(b.dataset.id);
    });
    if (!matchMedia('(pointer: coarse)').matches) input.focus({ preventScroll: true });   // a finger opens it without the keyboard jumping up
  };
})();
