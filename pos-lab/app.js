// Till boot: every click handler (attachEvents) and init(). Loads last; the screens are in
// pos-*.js, in the order index.html loads them.

// ============================================================
// EVENTS
// ============================================================
function attachEvents() {
  // Sidebar nav
  $$('.side-link').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  // ---- Top bar: sidebar toggle ----
  $('#sidebarToggle')?.addEventListener('click', () => {
    if ($('#variantSheet').classList.contains('open')) return closeVariantSheet();   // it is the variant sheet's X while that is open
    $('#app').classList.toggle('sidebar-collapsed');
  });
  // Per-view hamburger buttons (one in each view's header)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="open-sidebar"]');
    if (!btn) return;
    e.stopPropagation();
    $('#app').classList.toggle('sidebar-collapsed');
  });

  // Close the sidebar before the underlying Sell surface sees the press.
  let swallowSidebarBackdropClick = false;
  function closeSidebarFromBackdrop(e) {
    const app = $('#app');
    if (!app || app.classList.contains('sidebar-collapsed')) return false;
    if (e.target.closest('.sidebar')) return false;
    if (e.target.closest('#sidebarToggle')) return false;
    if (e.target.closest('[data-act="open-sidebar"]')) return false;
    app.classList.add('sidebar-collapsed');
    swallowSidebarBackdropClick = true;
    clearTimeout(closeSidebarFromBackdrop._t);
    closeSidebarFromBackdrop._t = setTimeout(() => { swallowSidebarBackdropClick = false; }, 350);
    return true;
  }
  document.addEventListener('pointerdown', (e) => {
    if (!closeSidebarFromBackdrop(e)) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('click', (e) => {
    if (!swallowSidebarBackdropClick) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    swallowSidebarBackdropClick = false;
  }, true);

  // Tap anywhere outside the sidebar (backdrop or main content) to close it.
  // The capture handlers above prevent the same tap from reaching product tiles.
  document.addEventListener('click', (e) => {
    const app = $('#app');
    if (app.classList.contains('sidebar-collapsed')) return;
    if (e.target.closest('.sidebar')) return;
    if (e.target.closest('#sidebarToggle')) return;
    if (e.target.closest('[data-act="open-sidebar"]')) return;
    app.classList.add('sidebar-collapsed');
  });
  // Close the sidebar automatically after picking a nav item
  $$('.side-link').forEach(t => t.addEventListener('click', () => {
    $('#app').classList.add('sidebar-collapsed');
  }));

  // ---- Bottom bar: pagination ----

  // ---- Sell search ----
  const search = $('#searchInput'), clear = $('#searchClear');
  search.addEventListener('input', (e) => {
    state.query = e.target.value;
    const q = state.query.trim();
    if (!q) endSearch();
    else if (!searchIntent || searchIntent.query !== q) searchIntent = { query: q, results: 0, picked: false };
    state.page = 1;
    clear.classList.toggle('visible', !!state.query);
    renderProducts();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !confirmSheet) {   // an "Out of stock" ask is up: nothing lands behind it
      e.preventDefault();   // this Enter must not also press the ask's Sell anyway once it takes the focus
      const raw = search.value.trim();
      if (!raw) return;
      if (findProductByCode(raw)) {
        searchIntent = null;   // the box held a scanned code, not a search -- its scan row records it
        addProductByCode(raw, { source: 'keyboard' });
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        if (!confirmSheet) search.focus();   // the ask keeps the keys (Enter = Sell anyway); it hands them back on close
        return;
      }
      // 3. Fall back to single fuzzy match
      const products = getFilteredSellProducts();
      if (products.length === 1) {
        addToCart(products[0].id, 'search');
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        if (!confirmSheet) search.focus();
      }
    }
  });
  clear.addEventListener('click', () => {
    endSearch();
    search.value = ''; state.query = '';
    clear.classList.remove('visible');
    renderProducts(); search.focus();
  });
  // Global key-route: if user is on Sell view and starts typing while not focused on an input,
  // capture into the search input — this lets HID barcode scanners hit anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'sell') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 && e.key !== 'Enter') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Don't hijack modal context
    if (document.querySelector('.modal-backdrop:not([hidden]), .rail-veil')) return;   // a sheet, menu or confirm is up
    if (e.key === 'Enter') return;
    search.focus({ preventScroll: true });
  });
  $('#scanBtn').addEventListener('click', openBarcodeScanner);
  $('#scanClose').addEventListener('click', closeBarcodeScanner);
  $('#scanFlip').addEventListener('click', flipBarcodeCamera);
  // The scanner's card: - / bin / +, and a swipe down puts it away (owner 2026-10-08). Touch only, as the line swipe.
  const scanCard = $('#scanCard');
  let cardSwipe = null;
  scanCard.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sq]'), item = state.cart.find(i => i.id === scanCardId);
    if (!b || !item) return;
    if (+b.dataset.sq > 0) addToCart(item.id, 'scan', true);
    else if (item.qty > 1) { item.qty = roundQty(productOf(item), item.qty - 1); renderCart(); }
    else removeLine(item);
  });
  scanCard.addEventListener('pointerdown', (e) => { cardSwipe = e.pointerType === 'touch' && !e.target.closest('button') ? { y: e.clientY, id: e.pointerId, dy: 0, v: 0, t: e.timeStamp } : null; if (cardSwipe) scanCard.classList.remove('pop'); });   // the finger beats the entrance
  scanCard.addEventListener('pointermove', (e) => {
    const s = cardSwipe;
    if (!s || s.id !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - s.y);
    s.v = (dy - s.dy) / Math.max(1, e.timeStamp - s.t);   // px/ms, for a flick
    s.t = e.timeStamp;
    s.dy = dy;
    scanCard.style.transition = 'none';
    scanCard.style.transform = `translate3d(0, ${s.dy}px, 0)`;
  });
  const endCardSwipe = (e) => {
    const s = cardSwipe;
    if (!s || s.id !== e.pointerId) return;
    cardSwipe = null;
    scanCard.style.transition = '';
    const flick = s.v > .5 && e.timeStamp - s.t < 100;
    if (e.type !== 'pointerup' || (s.dy < 40 && !flick)) { scanCard.style.transform = ''; return; }
    // carries on from the finger, a full card further, and fades: no jump back, no pop
    scanCardId = '';   // let go now, so a renderCart meanwhile can't bring it back
    scanCard.style.transform = `translate3d(0, ${s.dy + scanCard.offsetHeight}px, 0)`;
    scanCard.style.opacity = '0';
    setTimeout(() => { if (!scanCardId) drawScanCard(); }, 200);   // a read in between keeps its card
  };
  scanCard.addEventListener('pointerup', endCardSwipe);
  scanCard.addEventListener('pointercancel', endCardSwipe);

  // ---- Product grid (Sell) — real swipe gestures ----
  const productGrid = $('#productGrid');
  let swipeStart = null;
  let suppressGridClick = false;

  productGrid.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const track = $('#productTrack');
    if (!track) return;
    track.classList.add('dragging');
    swipeStart = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      startX: e.clientX,
      startT: Date.now(),
      dragging: false,
    };
  });

  productGrid.addEventListener('pointermove', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;

    // Only start dragging if horizontal movement exceeds vertical
    if (!swipeStart.dragging && Math.abs(dx) > 4 && Math.abs(dx) > Math.abs(dy)) {
      swipeStart.dragging = true;
    }
    if (!swipeStart.dragging) return;

    const track = $('#productTrack');
    if (!track) return;
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    const step = productGrid.clientWidth + gap;
    const total = totalPages();
    const baseOffset = -(state.page - 1) * step;
    let offset = baseOffset + dx;

    // Rubber-band at boundaries
    if (offset > 0) {
      offset = offset * 0.25;
    } else if (offset < -(total - 1) * step) {
      const overscroll = offset + (total - 1) * step;
      offset = -(total - 1) * step + overscroll * 0.25;
    }

    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  });

  productGrid.addEventListener('pointerup', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const track = $('#productTrack');
    if (track) track.classList.remove('dragging');

    if (swipeStart.dragging) {
      const dx = e.clientX - swipeStart.startX;
      const pageWidth = productGrid.clientWidth;
      const threshold = pageWidth * 0.12;
      // Flick: a quick short swipe still flips the page
      const elapsed = Date.now() - swipeStart.startT;
      const velocity = Math.abs(dx) / Math.max(elapsed, 1); // px per ms
      const flick = elapsed < 300 && Math.abs(dx) > 30 && velocity > 0.25;

      if ((dx < -threshold || (flick && dx < 0)) && state.page < totalPages()) {
        changePage(1);
      } else if ((dx > threshold || (flick && dx > 0)) && state.page > 1) {
        changePage(-1);
      } else {
        updateProductTrackPosition();
      }

      suppressGridClick = true;
      clearTimeout(productGrid._swipeClickTimer);
      productGrid._swipeClickTimer = setTimeout(() => { suppressGridClick = false; }, 260);
    }

    swipeStart = null;
  });

  productGrid.addEventListener('pointercancel', (e) => {
    const track = $('#productTrack');
    if (track) track.classList.remove('dragging');
    if (swipeStart && swipeStart.dragging) updateProductTrackPosition();
    swipeStart = null;
  });

  productGrid.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return;
    e.preventDefault();
    changePage(e.deltaX > 0 ? 1 : -1);
  }, { passive: false });
  productGrid.addEventListener('click', (e) => {
    if (suppressGridClick) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('[data-act="lost-sale"]')) {
      openLostSale({ text: state.query.trim(), reason: 'not-carried' });
      return;
    }
    const card = e.target.closest('.product-card');
    if (!card) return;
    // Group parent tile → open the variant picker modal
    if (card.dataset.groupId) { openVariantModal(card.dataset.groupId); return; }
    // Regular product
    addToCart(card.dataset.id, 'tile');
  });

  // ---- Variant sheet ----
  $('#variantList').addEventListener('click', (e) => {
    const row = e.target.closest('.vs-row');
    if (!row) return;
    if (row.hasAttribute('data-cust-new')) return addCustomerFromSale();
    if (row.dataset.customerId) return selectCustomer(row.dataset.customerId);   // the customer picker (it closes the sheet)
    addToCart(row.dataset.variantId, 'variant');
    closeVariantSheet();
  });
  $('#variantSearch').addEventListener('input', (e) => { state.variantModal.query = e.target.value; renderVariantList(); });
  $('#variantAvail').addEventListener('click', () => { state.variantModal.available = !state.variantModal.available; renderVariantList(); });

  // ---- Orders (rail list + receipt) ----
  $('#ordersList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    state.selectedOrderId = row.dataset.orderId;
    renderOrders();
    $('#orderDetail').scrollTop = 0;
    $('#ordersView').classList.add('reading');
  });
  $('#ordersBack')?.addEventListener('click', () => $('#ordersView').classList.remove('reading'));
  $('#ordersCustBack')?.addEventListener('click', () => switchView('customers'));
  const shownOrder = () => findOrderRow(state.selectedOrderId);   // a sale, or a saved cart / quote
  $('#orderPrint')?.addEventListener('click', () => { const o = shownOrder(); if (o) printOrder(o); });
  $('#orderContinue')?.addEventListener('click', () => { const o = shownOrder(); if (o?.draft) continueDraft(o.id); });
  // Refund: the first press turns the receipt into ticks; the second gives the ticked lines back (asks once).
  // The receipt and the tick list morph into each other (the browser's view transition; a plain swap without one).
  const morph = (fn) => (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches ? document.startViewTransition(fn) : fn());
  const refundTicked = (o) => {
    if (!picking(o)) { orderPicks(o); orderPick.on = true; return morph(renderOrderDetail); }
    const picks = orderPicks(o), part = picks.length && SalesMath.refundPart(o, reversalsOf(o), picks);
    if (part) showConfirm({ title: `Refund ${SalesMath.plural(picks.length, 'item')} on #${o.number}?`, message: `${peso(part.total)} goes back to the customer.`,
      okText: 'Refund', from: $('#orderRefund'), onConfirm: () => morph(() => recordReturn(o.id, 'Refund', picks)) });
  };
  // Refund and Void always ask first, from the rail or the order's details.
  const askRefund = (o) => {
    // What is still left on it: a partly refunded sale gives back only the rest.
    const left = o && SalesMath.qtyLeft(o, reversalsOf(o)).map((qty, lineNo) => ({ lineNo, qty }));
    const back = o && SalesMath.refundPart(o, reversalsOf(o), left);
    if (back) showConfirm({ title: `Refund #${o.number}?`, message: `${peso(back.total)} goes back to the customer.`, okText: 'Refund', onConfirm: () => refundOrder(o.id, 'Refund') });
  };
  const askVoid = (o, from) => showConfirm({ title: `Void #${o.number}?`, message: 'The sale stays on record, marked voided.', okText: 'Void sale', from, onConfirm: () => voidOrder(o.id, 'Void') });
  $('#orderRefund')?.addEventListener('click', () => { const o = shownOrder(); if (o) refundTicked(o); });
  $('#orderCancel')?.addEventListener('click', () => morph(() => { Object.assign(orderPick, { on: false, lines: {} }); renderOrderDetail(); }));
  // Refund items / Exchange: the customer's lines first (pickReturnLines), then the refund or the cart.
  const refundItems = (o) => pickReturnLines(o, { title: `Refund items on #${o.number}`, okText: 'Refund', onPick: (picks) => recordReturn(o.id, 'Refund', picks) });
  const exchangeItems = (o) => pickReturnLines(o, { title: `What comes back on #${o.number}?`, okText: 'Next', onPick: (picks) => startExchange(o.id, picks) });
  // ⋯: the ticks are the lines refunds and exchanges use, so "Refund items" is the list itself now.
  const orderMenu = (btn, o) => openMenu(btn, [
    { label: 'Order details', run: () => openOrderDetailModal(o.id) },
    { label: 'Exchange', off: !isCompletedSale(o), run: () => { const picks = orderPicks(o); if (picks.length) startExchange(o.id, picks); else exchangeItems(o); } },
    '-',
    { label: 'Void sale', red: true, off: !canVoid(o), run: () => askVoid(o, btn) },
  ], { w: 200, right: true });
  $('#orderMore')?.addEventListener('click', (e) => { const o = shownOrder(); if (o) orderMenu(e.currentTarget, o); });
  // A tick, tick-all or − / + on the lines: the same pick, whichever page shows the order.
  $('#orderDetail')?.addEventListener('click', (e) => {
    const back = e.target.closest('[data-print-back]');
    if (back) { const r = state.orders.find(x => x.id === back.dataset.printBack); if (r) printOrder(r); return; }
    const el = e.target.closest('[data-line], [data-all]'), o = shownOrder();
    if (el && o && pickOrderLine(o, el)) renderOrderDetail();
  });
  $('#orderDetailModal')?.addEventListener('click', (e) => {
    const trip = e.target.closest('[data-delivery-event]');
    if (trip) { recordDeliveryEvent(trip.dataset.orderId, trip.dataset.deliveryEvent); return; }
    const btn = e.target.closest('[data-order-op]');
    if (!btn) return;
    const o = state.orders.find(x => x.id === btn.dataset.orderId);
    $('#orderDetailModal').hidden = true;
    if (o && btn.dataset.orderOp === 'void') askVoid(o);
    if (o && btn.dataset.orderOp === 'refund') askRefund(o);
    if (o && btn.dataset.orderOp === 'return') refundItems(o);
    if (o && btn.dataset.orderOp === 'exchange') exchangeItems(o);
    renderOrders();
  });
  wireFind('#ordersFind', '#ordersSearch', '#ordersSearchX', (q) => { state.ordersQuery = q; renderOrders(); });
  $('#ordersFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['When', 'range', ORDER_RANGES.map(([v, l]) => [v, l])],
    ['Staff', 'staff', [['', 'Anyone'], ...[...new Set(state.orders.map(orderSeller).filter(Boolean))].sort().map(c => [c, c])]],
    ['Payment', 'pay', [['', 'Any'], ...PAY_KEYS.map(k => [k, SalesMath.tenderLabel(k), payColor(k)])]],
    ['Status', 'status', [['', 'Any'], ...['sale', 'saved', 'quote', 'part', 'refunded', 'voided'].map(k => [k, DRAFT_LABEL[k] || SalesMath.ROW_LABEL[k]])]],
    // Each type a row can read (orderFulfilLabel), the owner's own ones included, so a 'Tricycle' row is found as itself.
    ['Fulfilment', 'fulfil', [['', 'Any'], ...[...new Set([...FULFIL_BUILTINS.map(([k]) => k), ...state.orders.map(o => o.fulfilment)])]
      .map(k => [k, orderFulfilLabel({ fulfilment: k })])]],
  ], state.ordersFilter, ORDERS_FILTER_DEF, renderOrders));

  // ---- Items (list + editor; Save is not connected yet) ----
  // The switch picks the list (items, categories, modifiers); a row and + open that kind's editor.
  const openKind = id => (itemsKind === 'items' ? openItemEditor(id) : openKindEditor(itemsKind, id));
  $('#itemsKinds')?.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) setItemsKind(b.dataset.kind); });
  new ResizeObserver(([e]) => e.target.classList.remove('slid')).observe($('#itemsKinds'));   // tabs moved: the pill re-places on the next switch
  $('#itemsRows')?.addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) openKind(row.dataset.id); });
  $('#itemsAdd')?.addEventListener('click', () => openKind(null));
  $('#itemBack')?.addEventListener('click', closeItemEditor);
  $('#itemSave')?.addEventListener('click', () => (kindEdit ? saveKind() : saveItem()));
  const notYet = what => () => showToast(`${what} isn't connected yet`);
  $('#itemMore')?.addEventListener('click', (e) => openMenu(e.currentTarget, kindEdit
    ? [kindEdit.id ? { label: kindEdit.kind === 'mods' ? 'Archive' : 'Delete', red: true, off: !!kindEdit.builtin, run: dropKind } : { label: 'Discard', red: true, run: closeItemEditor }]
    : itemIsNew
    ? [{ label: 'Discard', red: true, run: closeItemEditor }]
    : [{ label: 'Print labels', run: notYet('Printing labels') }, { label: 'Duplicate', run: notYet('Duplicate') }, '-', { label: 'Archive', red: true, run: notYet('Archive') }],
    { w: 200, right: true }));
  wireFind('#itemsFind', '#itemsSearch', '#itemsSearchX', (q) => { itemsFilter.q = q; renderItems(); });
  $('#itemsFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['Category', 'cat', [['', 'All'], ...itemCategories().map(c => [c, c])]],
    ['Stock', 'stock', [['', 'Any'], ['low', 'Low'], ['out', 'Out']]],
  ], itemsFilter, ITEMS_FILTER_DEF, renderItems));
  const itemForm = $('#itemForm');
  // the category / modifier editor's fields (pos-items kindInput); the item editor's handlers below skip it
  itemForm?.addEventListener('input', (e) => { if (kindEdit) kindInput(e.target); });
  itemForm?.addEventListener('click', (e) => { const b = kindEdit && e.target.closest('[data-ka]'); if (b) kindClick(b); });
  itemForm?.addEventListener('input', (e) => {
    if (kindEdit) return;
    const E = itemEdit, t = e.target, f = t.dataset.f, num = () => Number(t.value) || 0;
    if (t.dataset.v) {   // a variant row
      const v = E.variants.find(x => x.id === t.closest('.vt').dataset.vid);
      v[t.dataset.v] = t.type === 'number' ? num() : t.value;
      if (t.dataset.v === 'cost' || t.dataset.v === 'price') t.closest('.vt').querySelector('.mg').textContent = itemMarkupText(v.cost, v.price);
      return;
    }
    if (!f || t.type === 'checkbox') return;
    if (['cost', 'price', 'stock', 'sku', 'barcode'].includes(f)) E.variants[0][f] = t.type === 'number' ? num() : t.value;
    else E[f] = f === 'marginValue' || f === 'reorder' ? num() : t.value;
    if (f === 'cost' || f === 'marginValue') itemReprice('cost');
    if (f === 'price') itemReprice('price');
    if (f === 'name') itemForm.querySelector('.thumb.big').outerHTML = itemThumb(E, true);
  });
  itemForm?.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f === 'sellOut') itemEdit.sellOut = t.checked;
    if (t.id === 'itemImg' && t.files[0]) { itemEdit.img = URL.createObjectURL(t.files[0]); renderItemForm(); }
  });
  itemForm?.addEventListener('click', (e) => {
    const E = itemEdit, b = !kindEdit && e.target.closest('button');
    if (!b) return;
    const pills = b.closest('[data-pills]'), multi = b.closest('[data-multi]'), act = b.dataset.act;
    if (pills) {
      E[pills.dataset.pills] = b.dataset.v;
      if (pills.dataset.pills === 'marginMode') { const v0 = E.variants[0]; E.marginValue = marginFromPrice(v0.cost, v0.price, b.dataset.v); }
      renderItemForm();
    } else if (multi) {
      E.alt = E.alt.includes(b.dataset.v) ? E.alt.filter(s => s !== b.dataset.v) : [...E.alt, b.dataset.v];
      b.classList.toggle('cur');
    } else if (act === 'add-variant') {
      E.variants.push(blankVariant());
      renderItemForm();
      itemForm.querySelector('.vt:last-child [data-v=name]')?.focus();
    } else if (act === 'del-variant') {
      E.variants = E.variants.filter(v => v.id !== b.closest('.vt').dataset.vid);
      renderItemForm();
    } else if (act === 'img-clear') { E.img = ''; renderItemForm(); }
    else if (act === 'stock') showToast("Adjusting stock isn't connected yet");
  });

  // ---- The edit sheet (pos-sell.js): a cart line, Discount and the fulfilment pill open it over the items ----
  // Swipe a line left and Delete waits under it (owner 2026-10-08). Touch only: a mouse still just opens the editor.
  // A tap, or swiping another line, closes it; a tap on a line while one is open only closes, like iOS Mail.
  const cartList = $('#cartList'), DEL_W = 88;
  let lineSwipe = null, swipedLine = null, suppressCartClick = false;
  const shutLine = () => { const was = swipedLine?.isConnected; swipedLine?.classList.remove('open'); swipedLine = null; return was; };
  cartList.addEventListener('pointerdown', (e) => {
    const line = e.pointerType === 'touch' && !e.target.closest('.sw-del') && e.target.closest('.line');
    lineSwipe = line ? { line, row: line.querySelector('.row'), x: e.clientX, y: e.clientY, id: e.pointerId, base: line.classList.contains('open') ? -DEL_W : 0, dx: 0, on: false } : null;
  });
  cartList.addEventListener('pointermove', (e) => {
    const s = lineSwipe;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { lineSwipe = null; return; }   // it's a scroll
      if (Math.abs(dx) <= 4 || Math.abs(dx) <= Math.abs(dy)) return;
      s.on = true;
      if (swipedLine !== s.line) shutLine();
      s.line.classList.add('swiping');
    }
    s.dx = Math.min(0, Math.max(-DEL_W * 1.25, s.base + dx));
    s.row.style.transform = `translate3d(${s.dx}px, 0, 0)`;
  });
  const endLineSwipe = (e) => {
    const s = lineSwipe;
    if (!s || s.id !== e.pointerId) return;
    lineSwipe = null;
    if (!s.on) return;
    const open = e.type === 'pointerup' ? s.dx < -DEL_W / 2 : s.base < 0;
    s.line.classList.remove('swiping');
    s.row.style.transform = '';
    s.line.classList.toggle('open', open);
    swipedLine = open ? s.line : null;
    suppressCartClick = true;
    setTimeout(() => { suppressCartClick = false; }, 260);
  };
  cartList.addEventListener('pointerup', endLineSwipe);
  cartList.addEventListener('pointercancel', endLineSwipe);
  document.addEventListener('pointerdown', (e) => { if (swipedLine && !cartList.contains(e.target)) shutLine(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') shutLine(); });
  cartList.addEventListener('click', (e) => {
    if (suppressCartClick) return;
    const del = e.target.closest('[data-del]');
    const item = del && state.cart.find(i => i.id === del.dataset.del);
    if (item) { swipedLine = null; return removeLine(item); }
    if (shutLine()) return;
    const row = e.target.closest('[data-id]');
    if (row) openEditSheet('line', row.dataset.id);
  });
  $('#cartDiscountBtn')?.addEventListener('click', () => openEditSheet('rd'));
  $('#fulRow').addEventListener('click', (e) => { if (e.target.closest('#fulPick')) openEditSheet('ful'); });   // delegated: the row is rebuilt on every cart render
  $('#editSheet').addEventListener('click', editSheetClick);
  $('#editSheet').addEventListener('keydown', (e) => {   // Enter in the SC/PWD ID or Name is its Apply
    if (e.key !== 'Enter' || !e.target.closest('[data-scf]')) return;
    e.preventDefault();
    editSheetClick({ target: $('#editSheet [data-apply]') });
  });
  $('#editSheet').addEventListener('input', (e) => {   // the address lands on the cart as it's typed
    if (e.target.id !== 'esAddr') return;
    state.deliveryAddress = e.target.value;
    const ad = $('#editSheet [data-ful="delivery"] .ad');
    if (ad) ad.textContent = e.target.value;
  });
  $('#deliveryMapZoomOut')?.addEventListener('click', () => zoomDeliveryMap(-1));
  $('#deliveryMapZoomIn')?.addEventListener('click', () => zoomDeliveryMap(1));
  $('#deliveryMapUseGps')?.addEventListener('click', useDeviceDeliveryLocation);
  $('#deliveryMapSave')?.addEventListener('click', saveDeliveryMapPin);
  $('#deliveryMapClear')?.addEventListener('click', clearDeliveryMapPin);
  $('#deliveryMapStage')?.addEventListener('pointerdown', (e) => {
    if (state.deliveryMap.pinch) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const center = deliveryMapWorldCenter();
    state.deliveryMap.drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      centerX: center.x,
      centerY: center.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  });
  $('#deliveryMapStage')?.addEventListener('pointermove', (e) => {
    if (state.deliveryMap.pinch) return;
    const drag = state.deliveryMap.drag;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    setDeliveryMapCenterFromWorld(drag.centerX - dx, drag.centerY - dy);
    renderDeliveryMap();
  });
  $('#deliveryMapStage')?.addEventListener('pointerup', (e) => {
    const drag = state.deliveryMap.drag;
    if (!drag || drag.id !== e.pointerId) return;
    state.deliveryMap.drag = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!drag.moved) setDeliveryMapPinAt(e.clientX, e.clientY);
  });
  $('#deliveryMapStage')?.addEventListener('pointercancel', () => { state.deliveryMap.drag = null; });
  $('#deliveryMapStage')?.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomDeliveryMapAt(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
  }, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      beginDeliveryPinch(e);
    }
  }, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchmove', updateDeliveryPinch, { passive: false });
  $('#deliveryMapStage')?.addEventListener('touchend', endDeliveryPinch);
  $('#deliveryMapStage')?.addEventListener('touchcancel', endDeliveryPinch);

  // New customer (Customers view) + saved customer save
  $('#newCustomerBtn')?.addEventListener('click', () => {
    state.customerEditFromSale = false;
    openCustomerEditModal();
  });
  // "Add new customer" inside the Sell-page customer picker — reuse the same
  // create form, then auto-select the new customer for the current sale.
  function addCustomerFromSale() {   // the old pop-up's row, the sheet's first row
    state.customerEditFromSale = true;
    $('#customerModal').hidden = true;
    closeVariantSheet();
    openCustomerEditModal();
  }
  $('#pickerAddCustomerBtn')?.addEventListener('click', addCustomerFromSale);
  $('#customersList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer-id]');
    if (!row) return;
    state.selectedCustomerId = row.dataset.customerId;
    renderCustomers();
    $('#customerBody').scrollTop = 0;
    $('#customersView').classList.add('reading');   // phone: the customer slides over the list, as an order does
  });
  const shownCustomer = () => allCustomerRecords().find(x => x.id === state.selectedCustomerId);
  $('#customersBack')?.addEventListener('click', () => $('#customersView').classList.remove('reading'));
  $('#customerEdit')?.addEventListener('click', () => { const c = shownCustomer(); if (c) { state.customerEditFromSale = false; openCustomerEditModal(c); } });
  $('#customerPay')?.addEventListener('click', (e) => openPaySheet(e.currentTarget, shownCustomer()));   // pos-customers.js
  $('#customerBody')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-order-id]')?.dataset.orderId;
    if (id || e.target.closest('[data-customer-detail]')) { ordersFor(state.selectedCustomerId, id); switchView('orders'); }
  });
  wireFind('#customersFind', '#customersSearch', '#customersSearchX', (q) => { state.customersQuery = q; state.selectedCustomerId = null; renderCustomers(); });
  ['click', 'input', 'keydown'].forEach(t => $('#shiftBody')?.addEventListener(t, onShiftEvent));   // pos-shift.js
  wireFind('#shiftFind', '#shiftSearch', '#shiftSearchX', (q) => { shiftDraft.q = q; renderShift(); });
  $('#custSaveBtn')?.addEventListener('click', () => saveSavedCustomerFromModal());
  // "Open Ana" on the duplicate-phone note: mid-sale she goes on the receipt, else her page opens.
  $('#custFields')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-open-cust]')?.dataset.openCust;
    if (!id) return;
    $('#customerEditModal').hidden = true;
    if (state.customerEditFromSale) { state.customerEditFromSale = false; selectCustomer(id); } else { state.selectedCustomerId = id; switchView('customers'); }
  });

  // Total opens its breakdown (Subtotal, Discount, VAT) above it
  $('#totalRow').addEventListener('click', () => {
    $('#totalRow').setAttribute('aria-expanded', $('#totalsDetail').classList.toggle('open'));
  });

  // ⋯ opens the sale actions, the menu covering the ⋯ itself
  function confirmClearCart() {
    if (state.cart.length === 0) return;
    showConfirm({
      title: 'Clear the sale?',
      message: 'Every item comes off the cart.',
      okText: 'Clear',
      cancelText: 'Cancel',
      danger: true,
      from: $('#cartMoreBtn'),
      onConfirm: () => {
        track('cart_clear', { lines: state.cart.length, subtotal: cartTotals().subtotal });
        clearCart();
        showToast('Cart cleared');
      }
    });
  }
  $('#cartMoreBtn').addEventListener('click', (e) => {
    const empty = state.cart.length === 0;
    openMenu(e.currentTarget, [
      // A saved cart / quote is a draft beside the orders (pos-checkout saveDraft); an exchange can't be parked.
      { label: 'Save cart', run: () => openSaveReceiptModal('saved'), off: empty || !!state.exchange },
      { label: 'Print quote', run: () => openSaveReceiptModal('quote'), off: empty || !!state.exchange },
      { label: 'Lost sale', run: () => openLostSale() }, '-',
      { label: 'Clear sale', run: confirmClearCart, red: true, off: empty },
    ], { w: 200, right: true });
  });

  // ---- Customer ----
  $('#customerBtn').addEventListener('click', () => {
    if (state.view === 'checkout') return;   // the customer is set before Check out; at the checkout the bar only shows who
    openCustomerModal();
  });
  $('#customerModal').addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer-id]');
    if (row) selectCustomer(row.dataset.customerId);
  });

  // ---- Lost sale ----
  $('#lsItemInput')?.addEventListener('input', () => { state.lostSale.productId = ''; renderLostSale(); });
  $('#lsMatches')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ls-product]');
    const p = b && state.products.find(x => x.id === b.dataset.lsProduct);
    if (!p) return;
    state.lostSale.productId = p.id;
    $('#lsItemInput').value = p.name;
    renderLostSale();
  });
  $('#lsReasons')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ls-reason]');
    if (!b) return;
    state.lostSale.reason = b.dataset.lsReason;
    renderLostSale();
  });
  $('#lsSaveBtn')?.addEventListener('click', saveLostSale);

  // ---- Modals ----
  // The sign-in (pinAsk.signIn) stays up through all three: the till is locked until a PIN opens it.
  const closeModals = () => $$('.modal-backdrop').forEach(m => { if (!(m.id === 'pinModal' && pinAsk?.signIn)) m.hidden = true; });
  $$('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => {
      closeModals();
    });
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd || (bd.id === 'pinModal' && pinAsk?.signIn)) return;
      bd.hidden = true;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const map = !$('#deliveryMapModal').hidden;   // Esc over the map closes the map, the sheet stays
      const list = $('#variantSheet').classList.contains('open');   // Esc over the customer list closes the list, the cart page stays
      closeBarcodeScanner();
      closeModals();
      closeVariantSheet();
      if (!map && !es && !list) $('#app').classList.remove('ph-cart');   // phone: Esc with nothing over the cart closes it
      if (!map) closeEditSheet();
    }
  });

  // ---- Pay ----
  // An exchange in the cart (startExchange) finishes here; anything else goes to the checkout.
  const phCart = (on) => { on ? closeVariantSheet() : closeEditSheet(); $('#app').classList.toggle('ph-cart', on); };   // phone: the cart page; the variant sheet sits over it (z 98), so it closes on the way in
  $('#cartBar').addEventListener('click', () => { closeBarcodeScanner(); phCart(true); });   // also the scanner's summary: the camera goes, the cart comes
  $('#cartBack').addEventListener('click', () => phCart(false));
  $('#payBtn').addEventListener('click', () => { closeEditSheet(); state.exchange ? confirmExchange() : openPaymentModal(); });

  // Payment-method selection
  function selectPayMethod(method, label = '') {
    state.paymentMethod = method;
    state.paymentLabel = label;
    state.paymentMethodChosen = true;
    // A custom card fills the Other name itself, so completeSale records it unchanged.
    $('#otherMethodInput').value = method === 'other' ? label : '';
    $('#checkoutTender').value = '';
    track('payment_method', { method });
    showPayStep();
    if (method === 'other' && !label) setTimeout(() => $('#otherMethodInput')?.focus(), 60);
  }
  // Delegated: the tiles are rebuilt from settings on every checkout render.
  $('#checkoutMethods')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-co-method]');
    if (card) selectPayMethod(card.dataset.method, card.dataset.label || '');
  });

  // Back: a method's detail -> the method tiles; the tiles -> the cart.
  $('#checkoutCancelBtn')?.addEventListener('click', () => {
    if ($('#checkoutApp').classList.contains('is-done')) return;
    if (state.paymentMethod === 'cash' && !$('#checkoutKeyIn').hidden) showCashKeys(false);   // the keys -> the quick amounts
    else if (state.paymentMethodChosen) {
      state.paymentMethodChosen = false;
      state.paymentMethod = 'cash';
      state.paymentLabel = '';
      $('#checkoutTender').value = '';
      showPayStep();
    } else {
      track('checkout_cancel');
      switchView(state.prevView && state.prevView !== 'checkout' ? state.prevView : 'sell');
    }
  });
  $('#checkoutCustBtn')?.addEventListener('click', openCustomerModal);
  // Our keypad, never the tablet's: taps, or a desk keyboard's digits / . / Backspace / Enter.
  const cashKey = (k) => { const t = $('#checkoutTender'); t.value = esPress(t.value, k, true, 9999999); updateChange(); };
  $('#checkoutKeys')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sk]'); if (b) cashKey(b.dataset.sk); });
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'checkout' || $('#checkoutKeyIn').hidden || $('[data-step="cash"]').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[\d.]$|^Backspace$|^Enter$/.test(e.key)) return;
    e.preventDefault();   // Enter on a focused key would press it again
    if (e.key === 'Enter') { if (!$('#checkoutCompleteBtn').disabled) completeSale(); }
    else cashKey(e.key === 'Backspace' ? 'del' : e.key);
  });
  $('#otherMethodInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') completeSale(); });
  // A cash amount is the decision: the tap finishes the sale.
  $('#checkoutQuick')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-co-custom]')) return showCashKeys(true);
    const b = e.target.closest('[data-co-cash]');
    if (!b) return;
    $('#checkoutTender').value = b.dataset.coCash;
    updateChange();
    completeSale();
  });
  $('#checkoutSteps')?.addEventListener('click', (e) => { if (e.target.closest('[data-complete]')) completeSale(); });
  window.addEventListener('resize', () => { fitCheckout(); centreCheckout(); });
  $('#successPrintBtn')?.addEventListener('click', printSuccessReceipt);
  $('#successNewSaleBtn')?.addEventListener('click', startNewSaleFromSuccess);
  // Phone: the receipt sheet; the paper prints in again each time it comes up
  $('#checkoutRcptBtn')?.addEventListener('click', () => {
    const paper = $('#checkoutReceipt .rp-paper');
    if (paper) { paper.style.animation = 'none'; paper.offsetWidth; paper.style.animation = ''; }
    $('#checkoutReceipt').scrollTop = 0;
    $('.co-items').classList.add('open');
  });
  $('#checkoutRcptClose')?.addEventListener('click', () => $('.co-items').classList.remove('open'));

  // Legacy modal (kept for back-compat if anything still triggers it)
  $('#tenderInput')?.addEventListener('input', updateChange);
  $$('.quick-cash button').forEach(b => {
    b.addEventListener('click', () => {
      const { total } = cartTotals();
      $('#tenderInput').value = b.dataset.cash === 'exact' ? total.toFixed(2) : b.dataset.cash;
      updateChange();
    });
  });
  $('#completeSaleBtn')?.addEventListener('click', () => completeSale());
  bindPinPad();   // the sign-in and the manager's PIN (pos-pin.js)

  // ---- POS Settings ----
  $('#settingsView')?.addEventListener('click', (e) => {   // tile size, text size, theme, printer, paper width
    const b = e.target.closest('[data-pick]');
    if (b) openSettingMenu(b);
  });
  $('#posCartHead')?.addEventListener('change', (e) => {
    HWPOS_STORE.ui.set('cartHead', e.target.checked ? '1' : '0');
    applyCartHead(e.target.checked);
  });
  $('#posPrintOnSale')?.addEventListener('change', persistPosSettings);
  $('#posPrintCut')?.addEventListener('change', persistPosSettings);
  $('#posPrintMap')?.addEventListener('change', persistPosSettings);
  $('#posPrinterIp')?.addEventListener('change', () => { persistPosSettings(); renderPrinterList(); refreshPrinterStatus(); });   // the list above shows the typed printer
  $('#posTimeZone')?.addEventListener('change', persistPosSettings);
  $('#posBtPairBtn')?.addEventListener('click', async () => {
    try {
      const dev = await window.HWPOS_PRINTER.pairBluetooth();
      state.settings.printing = { ...printerConfig(), btName: dev.name, btId: dev.id };
      saveSettings();
      renderPosSettings();
      showToast('Paired ' + dev.name);
    } catch (e) {
      if (e.name !== 'NotFoundError') showToast(e.message || 'Pairing failed');
    }
  });
  $('#posScanBtn')?.addEventListener('click', async () => {
    const btn = $('#posScanBtn');
    const subnets = printerScanSubnets();
    btn.disabled = true;
    btn.innerHTML = '<span class="prn-spin"></span>Scanning…';
    try {
      const hits = [];
      for (const net of subnets) {
        setScanStatus('Scanning ' + net + '.1-254…');
        const found = await window.HWPOS_PRINTER.scanNetwork(net, (done, total) => {
          setScanStatus('Scanning ' + net + '.x — ' + done + '/' + total);
        });
        hits.push(...found);
        if (found.length) break;   // first subnet with printers wins; don't sweep the rest
      }
      printerFound = [...new Set(hits)];
      renderPrinterList();
      if (!printerFound.length) {
        setScanStatus('No printer found on ' + subnets.join(', ') + '. Check it is on the same Wi-Fi, or enter the IP below.');
      } else if (printerFound.length === 1 && !(printerConfig().netUrl || '').trim()) {
        await connectPrinter(printerFound[0]);   // exactly one, nothing connected yet — just connect it
      } else {
        setScanStatus('Found ' + SalesMath.plural(printerFound.length, 'printer') + '. Tap one to connect.');
      }
    } catch (e) {
      setScanStatus(e.message || 'Scan failed');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Scan';
    }
  });
  $('#posPrinterList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.prn-item');
    if (item) connectPrinter(item.dataset.ip);
  });
  $('#posTestPrintBtn')?.addEventListener('click', () => {
    persistPosSettings();
    printOrder(sampleTestOrder());
  });

  window.addEventListener('online', () => track('online'));
  window.addEventListener('offline', () => track('offline'));
}

// ---------- Init ----------
function init() {
  setAppViewportHeight();
  // A sale that IndexedDB refused is kept in localStorage instead (data-store.js); say so once.
  window.HWPOS_STORE?.events.on('save:failed', () => showToast('This device had a problem saving sales. Call support before closing the till.'));
  state.folders = loadFolders();
  // Ensure "all" exists
  if (!state.folders.find(f => f.id === 'all')) {
    state.folders.unshift({ id: 'all', name: 'All items', builtin: true });
  }
  state.settings = loadSettings();
  state.products = loadProducts();
  state.groups = loadGroups();
  state.orders = loadOrders();
  document.querySelectorAll('.cur-sym').forEach(e => { e.textContent = SalesMath.currencySymbol(state.settings.store?.currency); });
  migrateCustomers();   // once: stored balances become opening rows (bo-model)
  state.fulfilment = state.settings.defaultFulfilment || 'walkin';
  // Apply saved theme
  if (state.theme === 'light') document.body.classList.add('light-theme');
  // Back-fill groupId on products coming from older localStorage that predates groups.
  if (typeof _GROUP_MEMBERSHIP !== 'undefined') {
    let touched = false;
    state.products.forEach(p => {
      if (!p.groupId && _GROUP_MEMBERSHIP[p.id]) {
        p.groupId = _GROUP_MEMBERSHIP[p.id];
        touched = true;
      }
    });
    if (touched) saveProducts();
  }
  rebuildFuse();

  renderSellHeader();
  renderProducts();
  applyCartHead(state.cartHead);
  renderCart();
  updateCustomerButton();
  applyRoleGating();
  renderRoleSwitcher();
  renderSyncMark();
  setInterval(renderSyncMark, 30000);   // "2 min ago" keeps moving while the ☰ is open
  attachEvents();
  track('app_open');
  // ponytail: lab only. ?pins gives the demo staff real PINs (1111 owner, 2222 manager, 3333 and 4444 cashiers)
  if (new URLSearchParams(location.search).has('pins')) saveStaff(loadStaff().map((u, i) => ({ ...u, pin: String(i + 1).repeat(4) })));
  if (tillPins()) lockTill();
  const openHashView = () => {
    const hash = (location.hash || '').replace('#', '').trim();
    const target = hash.split(/[/?&:]/)[0];
    const valid = ['sell', 'orders', 'inventory', 'customers', 'shift', 'reports'];
    if (valid.includes(target) && canAccess(target)) switchView(target);
  };
  openHashView();
  window.addEventListener('hashchange', openHashView);
  requestAnimationFrame(syncSellGridMetrics);
  let resizeFrame = 0;
  const refitSellSurface = ({ resetPage = false } = {}) => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      setAppViewportHeight();
      if (state.view === 'sell') {
        if (resetPage) state.page = 1;
        renderProducts();
      }
    });
  };
  window.addEventListener('resize', () => refitSellSurface({ resetPage: true }));
  window.visualViewport?.addEventListener('resize', () => refitSellSurface());
  window.visualViewport?.addEventListener('scroll', () => refitSellSurface());
  new ResizeObserver(() => refitSellSurface()).observe($('.catalog'));   // iPhone Safari: hiding the toolbar moves the safe area (the bar's gap) with no resize event; the tiles were cut off by 10pt

  // Pick up appearance changes pushed from the back-office tab.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_TILE_SIZE && e.newValue && ITEMS_PER_PAGE[e.newValue]) {
      state.tileSize = e.newValue;
      state.page = 1;
      renderProducts();
    }
    if (e.key === STORAGE_SHOW_PRICE || e.key === 'hwpos.ui.tileStock') {   // Tiles show, picked in another tab
      state.showPrice = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
      state.tileStock = HWPOS_STORE.ui.get('tileStock', '0') === '1';
      renderProducts();
      renderPosSettings(false);
    }
    if (e.key === STORAGE_THEME && e.newValue) {
      state.theme = e.newValue;
      document.body.classList.toggle('light-theme', e.newValue === 'light');
    }
    // Sales made in another tab (e.g. second POS instance) — refresh orders list.
    if (e.key === STORAGE_ORDERS) {
      state.orders = loadOrders();
      if (state.view === 'orders') renderOrders();
      if (state.view === 'reports') renderReports();
      if (state.view === 'customers') renderCustomers();
    }
    if (e.key === STORAGE_CUSTOMER_LEDGER || e.key === STORAGE_CUSTOMERS) {
      migrateCustomers();   // the sales database opened late: its ledger is here now (a no-op after once)
      if (state.view === 'customers') renderCustomers();
    }
    // Catalog or stock moved in another tab (a sale there appends to the log) — re-derive the tiles.
    if (e.key === STORAGE_PRODUCTS || e.key === STORAGE_STOCK_MOVEMENTS) {
      state.products = loadProducts();
      rebuildFuse();
      if (state.view === 'sell') renderProducts();
    }
    if (e.key === STORAGE_SETTINGS) {
      const was = currentStoreInfo().cashier;
      state.settings = loadSettings();
      if (currentStoreInfo().cashier !== was) track('cashier_switch', { from: was, to: currentStoreInfo().cashier });
      renderCart();
      if (state.view === 'checkout') renderCheckout();
    }
  });
  // Also refresh when the user returns to the POS tab in case they changed it
  // in the back office on another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { endSearch(true); track('app_hidden'); return; }
    track('app_visible');
    const newSize = storageGet(STORAGE_TILE_SIZE, 'md') || 'md';
    const newShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1', newStock = HWPOS_STORE.ui.get('tileStock', '0') === '1';
    let changed = false;
    if (newSize !== state.tileSize && ITEMS_PER_PAGE[newSize]) { state.tileSize = newSize; state.page = 1; changed = true; }
    if (newShow !== state.showPrice || newStock !== state.tileStock) { state.showPrice = newShow; state.tileStock = newStock; changed = true; }
    const was = currentStoreInfo().cashier;
    state.settings = loadSettings();
    if (currentStoreInfo().cashier !== was) track('cashier_switch', { from: was, to: currentStoreInfo().cashier });
    if (changed) renderProducts();
    // Always re-pull orders so the list is up to date.
    state.orders = loadOrders();
    if (state.view === 'orders') renderOrders();
    if (state.view === 'reports') renderReports();
    if (state.view === 'customers') renderCustomers();
  });

  // Live transaction feed for the Reports page (multi-cashier real-time).
  setInterval(reportsLive, 4000);

  // Tap a transaction row to open its full order details.
  $('#reportsTxList')?.addEventListener('click', (e) => {
    const row = e.target.closest('.report-tx');
    if (row?.dataset.orderId) openOrderDetailModal(row.dataset.orderId);
  });
  if (new URLSearchParams(location.search).has('demo-orders')) seedDemoOrders();
}

// ponytail: lab only. ?demo-orders rings example sales to the seeded customers through the real
// order builder, oldest first, then drops the flag so a refresh doesn't ring them again.
function seedDemoOrders() {
  history.replaceState(null, '', location.pathname);
  if (allCustomerRecords().slice(0, 4).some(c => customerOrders(c.id).length)) return;   // once: the link opened again adds nothing
  const counts = [23, 12, 6, 3], methods = ['cash', 'cash', 'gcash', 'qr'], day = 864e5;
  const goods = state.products.filter(p => onTill(p) && p.price > 0);
  allCustomerRecords().slice(0, counts.length).forEach((c, ci) => {
    for (let i = counts[ci] - 1; i >= 0; i--) {
      const lines = 1 + (i * 7 + ci) % 4;
      state.cart = Array.from({ length: lines }, (_, k) => goods[(i * 5 + k * 11 + ci * 3) % goods.length])
        .filter((p, k, a) => a.indexOf(p) === k)
        .map((p, k) => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit, price: p.price, qty: 1 + (i + k) % 5 }));
      state.customer = c;
      const o = buildOrderRecord({ paymentMethod: methods[(i + ci) % 4], tendered: cartTotals().total });
      persistOrder({ ...o, ts: Date.now() - (i * 2.5 + ci * 0.3) * day - 3600e3 });
    }
  });
  clearCart();
  renderCustomers();
  showToast('Example orders added');
}
// Sales live in IndexedDB: open it before the first read (data-store.js ready()).
document.addEventListener('DOMContentLoaded', () => (window.HWPOS_STORE?.ready?.() || Promise.resolve()).then(init));
