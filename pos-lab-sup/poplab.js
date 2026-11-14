/* Pop-ups, redone (popups.html injects this + poplab.css into the POS lab; the lab's own files stay as committed).
   One design each:
   - Cart line: a small card grows out of the tapped line and covers it. − qty +, Discount, Remove. Changes show
     in the cart as you go; Enter or a tap outside keeps them, Esc puts them back.
   - Receipt discount, delivery address, "how much?" (items sold by measure): small pop-ups in the middle, the app's
     own .modal. The app's open/apply/save code runs unchanged; only the markup inside is new.
   Keyboard first: the number is selected when a pop-up opens, so you type and press Enter. On a touch till the
   fields ask the tablet for its own number pad (inputmode="decimal"), so there is no on-screen pad of ours.
   ponytail: lab only. To port: the markup below goes into index.html, openLine/askHowMuch into pos-sell.js, the CSS
   into styles.css; the rebinding at the bottom only exists because this file loads after app.js. */
(() => {
  const $ = (s) => document.querySelector(s);
  const sym = () => SalesMath.currencySymbol(state.settings.store?.currency);
  const MINUS = '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>';
  // An amount field with its ₱ | % switch inside the right end. attr is what the app's code looks for.
  const field = (id, attr, cur = 'amount') => `<div class="pl-field">
      <input id="${id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0">
      <span class="pl-seg">${['amount', 'percent'].map(t => `<button type="button" tabindex="-1" class="${t === cur ? 'active' : ''}" data-${attr}="${t}">${t === 'amount' ? sym() : '%'}</button>`).join('')}</span>
    </div>`;
  const pickSeg = (b) => { for (const x of b.parentNode.children) x.classList.toggle('active', x === b); };
  // a mouse tap on these must not pull the cursor out of the field you're typing in
  const keepFocus = (root) => root.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });

  // A finger tapping a line shouldn't summon the tablet's keyboard; a mouse or a keyboard goes straight to the number.
  let touch = false;
  addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch'; }, true);

  // ---------- Cart line ----------
  function openLine(id) {
    const row = document.querySelector(`#cartList .row[data-id="${CSS.escape(id)}"]`);
    const item = state.cart.find(i => i.id === id);
    if (!row || !item) return;
    const p = productOf(item), d = item.discount || { type: 'amount', value: 0 };
    const before = { qty: item.qty, discount: item.discount };
    const veil = document.createElement('div');
    veil.className = 'pl-veil';
    veil.innerHTML = `<div class="pl-line" role="dialog" aria-label="${escapeHtml(item.name)}">
        <div class="pl-head"></div>
        <div class="pl-opt"><span>Quantity</span>
          <button type="button" class="pl-b" tabindex="-1" data-d="-1" aria-label="Less">${MINUS}</button>
          <input class="pl-qty" type="text" inputmode="decimal" autocomplete="off" aria-label="Quantity">
          <button type="button" class="pl-b" tabindex="-1" data-d="1" aria-label="More">${PLUS}</button></div>
        <div class="pl-opt"><span>Discount</span>${field('plDisc', 't', d.type)}</div>
        <button type="button" class="pl-remove">Remove</button>
      </div>`;
    const card = veil.firstChild, head = card.firstElementChild, qty = card.querySelector('.pl-qty'), disc = card.querySelector('#plDisc');
    const it = () => state.cart.find(i => i.id === id);
    const sync = (writeQty = true) => {
      renderCart();
      head.innerHTML = document.querySelector(`#cartList .row[data-id="${CSS.escape(id)}"]`)?.innerHTML || '';
      if (writeQty) qty.value = it().qty;
    };
    const setQty = (q, writeQty) => { q = roundQty(p, q); if (q > 0) it().qty = q; sync(writeQty); };
    const setDisc = () => {
      const v = parseFloat(disc.value) || 0, type = card.querySelector('.pl-seg .active').dataset.t;
      if (v > 0) it().discount = { type, value: v }; else delete it().discount;
      sync();
    };
    disc.value = d.value || '';
    // Sit on the line (the head is the line itself); slide up only as far as the screen needs. Measured before
    // sync(): renderCart redraws the rows, and a detached row has no box.
    const r = row.getBoundingClientRect();
    card.style.cssText = `left:${r.left}px;width:${r.width}px`;
    document.body.append(veil);
    sync();
    const H = card.offsetHeight, top = Math.max(8, Math.min(r.top, innerHeight - 8 - H)), t = r.top - top;
    card.style.top = top + 'px';
    // the ⋯ menu's morph (openMenu): grow out of the line, a little overshoot
    const from = `inset(${t}px 0 ${H - t - r.height}px 0 round 10px)`, to = 'inset(-24px round 34px)';
    card.animate([{ clipPath: from, transform: 'scale(.97)' }, { clipPath: to, transform: 'none' }], { duration: calmMs(180), easing: 'cubic-bezier(.3,1.45,.55,1)' });
    if (!touch) { qty.focus(); qty.select(); }

    keepFocus(card);
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b?.dataset.d) setQty(it().qty + +b.dataset.d);
      else if (b?.dataset.t) { pickSeg(b); setDisc(); }
      else if (b?.classList.contains('pl-remove')) close('remove');
    });
    qty.addEventListener('input', () => setQty(parseFloat(qty.value), false));
    qty.addEventListener('blur', () => { qty.value = it()?.qty ?? ''; });
    disc.addEventListener('input', setDisc);
    veil.addEventListener('click', (e) => { if (e.target === veil) close('keep'); });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close('undo'); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); close('keep'); }
      else if (e.target === qty && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); setQty(it().qty + (e.key === 'ArrowUp' ? 1 : -1)); }
      else if (e.target === disc && e.key === '%') { e.preventDefault(); pickSeg(card.querySelector('[data-t="percent"]')); setDisc(); }
      // opened by a finger, then typed on a keyboard: the digits go to the quantity, not the catalog search
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT') { qty.focus(); qty.select(); }
    };
    document.addEventListener('keydown', onKey, true);

    function close(how) {
      document.removeEventListener('keydown', onKey, true);
      veil.style.pointerEvents = 'none';
      const now = it();
      if (how === 'remove') {
        track('item_remove', { productId: id, qty: now.qty, unitPrice: now.price });
        state.cart = state.cart.filter(i => i.id !== id);
        renderCart();
        showToast('Item removed');
      } else if (how === 'undo') {
        now.qty = before.qty;
        if (before.discount) now.discount = before.discount; else delete now.discount;
        renderCart();
      } else {
        // the same events the old Save sent (saveCartItemEdit), once per open, not per tap
        if (now.qty !== before.qty) track('item_qty', { productId: id, from: before.qty, to: now.qty });
        const a = now.discount || null, b = before.discount || null;
        if (JSON.stringify(a) !== JSON.stringify(b)) track('discount', { scope: 'line', kind: (a || b).type, value: a ? a.value : 0, productId: id });
      }
      const gone = how === 'remove' ? [{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }]
        : [{ clipPath: to }, { clipPath: from, opacity: 0, transform: 'scale(.98)' }];
      card.animate(gone, { duration: calmMs(90), easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = () => veil.remove();
    }
  }
  openCartItemModal = openLine;

  // ---------- Receipt discount (the app's openCartDiscountModal / applyCartDiscount / clearCartDiscount) ----------
  const cdm = $('#cartDiscountModal');
  cdm.innerHTML = `<div class="modal pl-pop">
      <h2>Receipt discount</h2>
      ${field('cdInput', 'cd-type')}
      <div class="pl-acts"><button type="button" class="secondary-btn" id="cdRemoveBtn">Remove</button><button type="button" class="primary-btn" id="cdApplyBtn">Apply</button></div>
    </div>`;

  // ---------- Delivery address (setFulfilment('delivery') / saveDeliveryAddress / openDeliveryMap) ----------
  const dm = $('#deliveryModal');
  dm.innerHTML = `<div class="modal pl-pop pl-wide">
      <h2>Delivery address</h2>
      <textarea id="deliveryAddrInput" rows="3" placeholder="House #, Street, District, City"></textarea>
      <div class="pl-acts"><button type="button" class="secondary-btn" id="deliveryPinBtn"><span id="deliveryPinStatus"></span></button><button type="button" class="primary-btn" id="deliverySaveBtn">Save</button></div>
    </div>`;
  // the pin's state is the button's own label now, not a sentence beside it
  deliveryPinLabel = (loc = state.deliveryLocation) => (normalizeDeliveryLocation(loc) ? 'Pin set' : 'Pin on map');

  // ---------- How much? Items sold by measure ask before they go in the cart ----------
  const hm = document.createElement('div');
  hm.className = 'modal-backdrop'; hm.id = 'howMuchModal'; hm.hidden = true;
  hm.innerHTML = `<div class="modal pl-pop">
      <h2 id="hmName"></h2>
      <div class="pl-field"><input id="hmInput" type="text" inputmode="decimal" autocomplete="off" placeholder="0"><span class="pl-unit" id="hmUnit"></span></div>
      <div class="pl-acts"><button type="button" class="primary-btn" id="hmAdd">Add</button></div>
    </div>`;
  dm.after(hm);
  let ask = null;   // { p, via }
  const hmQty = () => roundQty(ask.p, parseFloat($('#hmInput').value) || 0);
  function askHowMuch(p, via) {
    ask = { p, via };
    $('#hmName').textContent = p.name;
    $('#hmUnit').textContent = p.unit || '';
    $('#hmInput').value = '';
    hmPrice();
    hm.hidden = false;
    setTimeout(() => $('#hmInput').focus(), 50);   // after the variant sheet / tile tap lets go of focus
  }
  function hmPrice() {
    const q = hmQty();
    $('#hmAdd').disabled = !(q > 0);
    $('#hmAdd').textContent = q > 0 ? `Add ${peso(SalesMath.lineMoney(ask.p.price, q, null, state.settings.store?.currency).lineTotal)}` : 'Add';
  }
  function addMeasured() {
    const q = hmQty(), { p, via } = ask;
    if (!(q > 0)) return;
    // addToCart with a quantity (pos-sell.js:277); the port gives addToCart a qty argument instead
    beginCart();
    const have = state.cart.find(i => i.id === p.id);
    if (have) have.qty = roundQty(p, have.qty + q);
    else state.cart.push({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit, price: p.price, qty: q });
    trackItemAdd(p, q, via);
    hm.hidden = true;
    renderCart();
    showToast(`Added · ${p.name}`);
  }
  const plainAdd = addToCart;
  addToCart = (productId, via) => {
    const p = state.products.find(x => x.id === productId);
    return p?.soldBy === 'measure' ? askHowMuch(p, via) : plainAdd(productId, via);
  };

  // ---------- Lab glue: app.js bound its listeners before this file swapped the markup ----------
  // ponytail: in the port the markup is in index.html when app.js runs, and all of this but the new keys goes.
  for (const m of [cdm, hm]) keepFocus(m);
  cdm.addEventListener('click', (e) => { const b = e.target.closest('[data-cd-type]'); if (b) pickSeg(b); });
  $('#cdApplyBtn').addEventListener('click', applyCartDiscount);
  $('#cdRemoveBtn').addEventListener('click', clearCartDiscount);
  $('#deliverySaveBtn').addEventListener('click', saveDeliveryAddress);
  $('#deliveryPinBtn').addEventListener('click', openDeliveryMap);
  $('#hmAdd').addEventListener('click', addMeasured);
  hm.addEventListener('click', (e) => { if (e.target === hm) hm.hidden = true; });
  // Remove only when there is a discount to remove
  document.addEventListener('click', (e) => { if (e.target.closest('#cartDiscountBtn')) $('#cdRemoveBtn').hidden = !state.cartDiscount; }, true);
  // Delivery opens with the cursor at the end of the address
  const plainFulfil = setFulfilment;
  setFulfilment = (mode) => {
    plainFulfil(mode);
    if (mode === 'delivery') setTimeout(() => { const a = $('#deliveryAddrInput'); a.focus(); a.selectionStart = a.value.length; }, 50);
  };

  // New keys: Enter does the main button everywhere; "%" switches a discount to percent.
  $('#cdInput').addEventListener('focus', (e) => e.target.select());
  $('#cdInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyCartDiscount(); }
    else if (e.key === '%') { e.preventDefault(); pickSeg(cdm.querySelector('[data-cd-type="percent"]')); }
  });
  $('#deliveryAddrInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDeliveryAddress(); }   // Shift+Enter for a second line
  });
  $('#hmInput').addEventListener('input', hmPrice);
  $('#hmInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addMeasured(); } });
})();
