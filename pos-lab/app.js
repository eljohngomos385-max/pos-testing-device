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

  // ---- Bottom bar: tile size toggle (S / M / L) ----
  $$('.bb-size-btn').forEach(btn => {
    btn.addEventListener('click', () => setTileSize(btn.dataset.size));
  });

  // ---- Bottom bar: toggle price display on tiles ----
  $('#bbViewBtn')?.addEventListener('click', toggleShowPrice);

  // ---- Save receipt (the cart's ⋯ menu): creates a not-completed saved receipt ----
  $('#saveReceiptConfirmBtn')?.addEventListener('click', saveReceiptFromModal);
  $('#saveReceiptNameInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveReceiptFromModal();
    }
  });

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
    if (e.key === 'Enter') {
      const raw = search.value.trim();
      if (!raw) return;
      if (findProductByCode(raw)) {
        searchIntent = null;   // the box held a scanned code, not a search -- its scan row records it
        addProductByCode(raw, { source: 'keyboard' });
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
        return;
      }
      // 3. Fall back to single fuzzy match
      const products = getFilteredSellProducts();
      if (products.length === 1) {
        addToCart(products[0].id, 'search');
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
        search.focus();
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
    if (document.querySelector('.modal-backdrop:not([hidden])')) return;
    if (e.key === 'Enter') return;
    search.focus({ preventScroll: true });
  });
  $('#scanBtn').addEventListener('click', openBarcodeScanner);
  $('#barcodeManualBtn')?.addEventListener('click', submitManualBarcode);
  $('#barcodeManualInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitManualBarcode();
    }
  });

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

  // ---- Variant picker modal ----
  $('#variantGrid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.variant-tile');
    if (!tile) return;
    selectVariant(tile.dataset.variantId);
  });
  $$('#variantModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeVariantQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#variantQtyInput')?.addEventListener('input', (e) => {
    // Don't rewrite the field while it is being typed -- "2." and "2.5" are both mid-entry.
    state.variantModal.qty = qtyFrom(state.products.find(x => x.id === state.variantModal.selectedId), e.target.value);
  });
  $('#variantQtyInput')?.addEventListener('blur', (e) => {
    e.target.value = qtyFrom(state.products.find(x => x.id === state.variantModal.selectedId), e.target.value);
  });
  $('#variantAddBtn')?.addEventListener('click', addVariantToCart);

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
  const shownOrder = () => state.orders.find(x => x.id === state.selectedOrderId);
  $('#orderPrint')?.addEventListener('click', () => { const o = shownOrder(); if (o) printOrder(o); });
  // Refund and Void always ask first, from the rail or the order's details.
  const askRefund = (o) => {
    // What is still left on it: a partly refunded sale gives back only the rest.
    const left = o && SalesMath.qtyLeft(o, reversalsOf(o)).map((qty, lineNo) => ({ lineNo, qty }));
    const back = o && SalesMath.refundPart(o, reversalsOf(o), left);
    if (back) showConfirm({ title: `Refund #${o.number}?`, message: `${peso(back.total)} goes back to the customer.`, okText: 'Refund', onConfirm: () => refundOrder(o.id, 'Refund') });
  };
  const askVoid = (o) => showConfirm({ title: `Void #${o.number}?`, message: 'The sale stays on record, marked voided.', okText: 'Void sale', onConfirm: () => voidOrder(o.id, 'Void') });
  $('#orderRefund')?.addEventListener('click', () => askRefund(shownOrder()));
  // Refund items / Exchange: the customer's lines first (pickReturnLines), then the refund or the cart.
  const refundItems = (o) => pickReturnLines(o, { title: `Refund items on #${o.number}`, okText: 'Refund', onPick: (picks) => recordReturn(o.id, 'Refund', picks) });
  const exchangeItems = (o) => pickReturnLines(o, { title: `What comes back on #${o.number}?`, okText: 'Next', onPick: (picks) => startExchange(o.id, picks) });
  $('#orderMore')?.addEventListener('click', (e) => {
    const o = shownOrder();
    if (!o) return;
    const done = isCompletedSale(o);
    openMenu(e.currentTarget, [
      { label: 'Order details', run: () => openOrderDetailModal(o.id) },
      { label: 'Refund items', off: !done, run: () => refundItems(o) },
      { label: 'Exchange', off: !done, run: () => exchangeItems(o) },
      '-',
      { label: 'Void sale', red: true, off: !canVoid(o), run: () => askVoid(o) },
    ], { w: 200, right: true });
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
    ['Status', 'status', [['', 'Any'], ...['sale', 'saved', 'part', 'refunded', 'voided', 'refund', 'void'].map(k => [k, SalesMath.ROW_LABEL[k]])]],
    // Each type a row can read (orderFulfilLabel), the owner's own ones included, so a 'Tricycle' row is found as itself.
    ['Fulfilment', 'fulfil', [['', 'Any'], ...[...new Set([...FULFIL_BUILTINS.map(([k]) => k), ...state.orders.map(o => o.fulfilment)])]
      .map(k => [k, orderFulfilLabel({ fulfilment: k })])]],
  ], state.ordersFilter, ORDERS_FILTER_DEF, renderOrders));

  // ---- Items (list + editor; Save is not connected yet) ----
  $('#itemsRows')?.addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) openItemEditor(row.dataset.id); });
  $('#itemsAdd')?.addEventListener('click', () => openItemEditor(null));
  $('#itemBack')?.addEventListener('click', closeItemEditor);
  $('#itemSave')?.addEventListener('click', saveItem);
  const notYet = what => () => showToast(`${what} isn't connected yet`);
  $('#itemMore')?.addEventListener('click', (e) => openMenu(e.currentTarget, itemIsNew
    ? [{ label: 'Discard', red: true, run: closeItemEditor }]
    : [{ label: 'Print labels', run: notYet('Printing labels') }, { label: 'Duplicate', run: notYet('Duplicate') }, '-', { label: 'Archive', red: true, run: notYet('Archive') }],
    { w: 200, right: true }));
  wireFind('#itemsFind', '#itemsSearch', '#itemsSearchX', (q) => { itemsFilter.q = q; renderItems(); });
  $('#itemsFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['Category', 'cat', [['', 'All'], ...itemCategories().map(c => [c, c])]],
    ['Stock', 'stock', [['', 'Any'], ['low', 'Low'], ['out', 'Out']]],
  ], itemsFilter, ITEMS_FILTER_DEF, renderItems));
  const itemForm = $('#itemForm');
  itemForm?.addEventListener('input', (e) => {
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
    const E = itemEdit, b = e.target.closest('button');
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

  // ---- Cart row click → open edit modal ----
  $('#cartList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    openCartItemModal(row.dataset.id);
  });

  // ---- Cart item edit modal ----
  $$('#cartItemModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeCartItemModalQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#cimQtyInput')?.addEventListener('input', updateCartItemModalLineTotal);
  $('#cimQtyInput')?.addEventListener('blur', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    e.target.value = q;
    updateCartItemModalLineTotal();
  });
  $('#cimSaveBtn')?.addEventListener('click', saveCartItemEdit);
  $('#cimDeleteBtn')?.addEventListener('click', removeCartItemFromModal);
  // Cart item modal: discount segment + input
  $$('#cartItemModal [data-cim-disc-type]').forEach(b => {
    b.addEventListener('click', () => {
      $$('#cartItemModal [data-cim-disc-type]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      updateCartItemModalLineTotal();
    });
  });
  $('#cimDiscInput')?.addEventListener('input', updateCartItemModalLineTotal);

  // Cart-level discount: open + apply + remove
  $('#cartDiscountBtn')?.addEventListener('click', openCartDiscountModal);
  $$('#cartDiscountModal [data-cd-type]').forEach(b => {
    b.addEventListener('click', () => {
      $$('#cartDiscountModal [data-cd-type]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });
  $('#cdApplyBtn')?.addEventListener('click', applyCartDiscount);
  $('#cdRemoveBtn')?.addEventListener('click', clearCartDiscount);

  // Fulfilment -- delegated, the row is rebuilt on every cart render. The picker opens into the list, the current
  // type bold in its own place.
  $('#fulRow').addEventListener('click', (e) => {
    const pick = e.target.closest('#fulPick');
    if (pick) openMenu(pick, fulfilMethods(state.settings).map(m => ({ label: m.label, cur: m.key === state.fulfilment, run: () => setFulfilment(m.key) })));
  });
  // Delivery modal save
  $('#deliverySaveBtn')?.addEventListener('click', saveDeliveryAddress);
  $('#deliveryPinBtn')?.addEventListener('click', openDeliveryMap);
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
  $('#pickerAddCustomerBtn')?.addEventListener('click', () => {
    state.customerEditFromSale = true;
    $('#customerModal').hidden = true;
    openCustomerEditModal();
  });
  $('#customersList')?.addEventListener('click', (e) => {
    const detailBtn = e.target.closest('[data-act="view-customer-detail"]');
    if (detailBtn) {
      e.stopPropagation();
      openCustomerDetail(detailBtn.dataset.customerId);
      return;
    }
    const row = e.target.closest('[data-customer-id]');
    if (!row) return;
    state.selectedCustomerId = row.dataset.customerId;
    renderCustomers();
  });
  $('#customerDetail')?.addEventListener('click', (e) => {
    const historyBtn = e.target.closest('[data-customer-detail]');
    if (historyBtn) {
      openCustomerDetail(historyBtn.dataset.customerDetail);
      return;
    }
    const payBtn = e.target.closest('[data-customer-pay]');
    if (payBtn) {
      // ponytail: a prompt until the till has a payment screen. "1,000" and "₱ 1,000" read as 1000.
      const c = allCustomerRecords().find(x => x.id === payBtn.dataset.customerPay);
      if (!c) return;
      const amount = moneyValue(parseFloat(String(prompt(`Payment amount — ${c.name} ${owedText(c.currentBalance, peso)}`) || '').replace(/[^\d.]/g, '')) || 0);
      if (amount > 0 && c && window.confirm(`Record ${peso(amount)} cash from ${c.name}?`)) recordCreditPayment(c.id, amount);
      return;
    }
    const orderRow = e.target.closest('.cd-order-row');
    if (orderRow?.dataset.orderId) {
      openOrderDetailModal(orderRow.dataset.orderId);
    }
  });
  $('#customersSearch')?.addEventListener('input', (e) => {
    state.customersQuery = e.target.value;
    state.selectedCustomerId = null;
    renderCustomers();
  });
  $('#customerDetailModal')?.addEventListener('click', (e) => {
    const row = e.target.closest('.cust-order-row');
    if (row?.dataset.orderId) {
      $('#customerDetailModal').hidden = true;
      openOrderDetailModal(row.dataset.orderId);
    }
  });
  $('#custSaveBtn')?.addEventListener('click', () => saveSavedCustomerFromModal());
  // "Open Ana" on the duplicate-phone note: mid-sale she goes on the receipt, else her page opens.
  $('#custFields')?.addEventListener('click', (e) => {
    const id = e.target.closest('[data-open-cust]')?.dataset.openCust;
    if (!id) return;
    $('#customerEditModal').hidden = true;
    if (state.customerEditFromSale) { state.customerEditFromSale = false; selectCustomer(id); } else openCustomerDetail(id);
  });

  // Total opens its breakdown (Subtotal, Discount, VAT) above it
  $('#totalRow').addEventListener('click', () => {
    $('#totalRow').setAttribute('aria-expanded', $('#totalsDetail').classList.toggle('open'));
  });

  // ⋯ opens the sale actions, the menu covering the ⋯ itself
  function confirmClearCart() {
    if (state.cart.length === 0) return;
    showConfirm({
      title: 'Clear receipt?',
      message: 'All items in the current receipt will be removed. This cannot be undone.',
      okText: 'Yes, clear',
      cancelText: 'Cancel',
      danger: true,
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
      { label: 'Save receipt', run: openSaveReceiptModal, off: empty }, { label: 'Lost sale', run: () => openLostSale() }, '-',
      { label: 'Clear sale', run: confirmClearCart, red: true, off: empty },
    ], { w: 200, right: true });
  });

  // ---- Customer ----
  $('#customerBtn').addEventListener('click', () => {
    if (state.view === 'checkout' && $('#checkoutApp').classList.contains('is-done')) return;   // the sale is done
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
      if (b.closest('#barcodeModal')) stopBarcodeScanner();
      closeModals();
    });
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd || (bd.id === 'pinModal' && pinAsk?.signIn)) return;
      if (bd.id === 'barcodeModal') stopBarcodeScanner();
      bd.hidden = true;
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopBarcodeScanner();
      closeModals();
    }
  });

  // ---- Pay ----
  // An exchange in the cart (startExchange) finishes here; anything else goes to the checkout.
  $('#payBtn').addEventListener('click', () => (state.exchange ? confirmExchange() : openPaymentModal()));

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
    // No autofocus on cash: a tablet keyboard would cover the amounts.
    if (method === 'split') setTimeout(() => $('#checkoutTender')?.focus(), 60);
    else if (method === 'other' && !label) setTimeout(() => $('#otherMethodInput')?.focus(), 60);
  }
  // Delegated: the tiles are rebuilt from settings on every checkout render.
  $('#checkoutMethods')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-co-method]');
    if (card) selectPayMethod(card.dataset.method, card.dataset.label || '');
  });

  // Back: a method's detail -> the method tiles; the tiles -> the cart.
  $('#checkoutCancelBtn')?.addEventListener('click', () => {
    if ($('#checkoutApp').classList.contains('is-done')) return;
    if (state.paymentMethodChosen) {
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
  $('#checkoutTender')?.addEventListener('input', (e) => {
    // Digits and one point, two decimals.
    const v = e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*$/, '$1');
    if (v !== e.target.value) e.target.value = v;
    updateChange();
  });
  $('#checkoutTender')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#checkoutCompleteBtn').disabled) completeSale();
  });
  $('#otherMethodInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') completeSale(); });
  // A cash amount is the decision: the tap finishes the sale.
  $('#checkoutQuick')?.addEventListener('click', (e) => {
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
  $('#pinOkBtn')?.addEventListener('click', approveWithPin);
  // Switch person: the name in the sidebar locks the till for the next one (only once PINs exist).
  $('.user-row')?.addEventListener('click', () => { if (tillPins()) lockTill(); });
  $('#pinInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') approveWithPin(); });

  // ---- POS Settings ----
  $$('#posSizeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      setTileSize(b.dataset.size);
      renderPosSettings();
    });
  });
  $$('#posTextToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      setTileText(b.dataset.text);
      renderPosSettings();
    });
  });
  $('#posShowPrice')?.addEventListener('change', (e) => {
    state.showPrice = e.target.checked;
    storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
    renderPosSettings();
    renderProducts();
  });
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      applyTheme(b.dataset.theme);
    });
  });
  $('#posCartHead')?.addEventListener('change', (e) => {
    HWPOS_STORE.ui.set('cartHead', e.target.checked ? '1' : '0');
    applyCartHead(e.target.checked);
  });
  $('#posPrintOnSale')?.addEventListener('change', persistPosSettings);
  $$('#posWidthToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.settings.printing = { ...printerConfig(), width: b.dataset.width };
      saveSettings();
      renderPosSettings();
    });
  });
  $('#posPrintCut')?.addEventListener('change', persistPosSettings);
  $('#posPrintMap')?.addEventListener('change', persistPosSettings);
  $('#posPrinterIp')?.addEventListener('change', persistPosSettings);
  $$('#posDriverToggle .bb-size-btn').forEach(b => {
    b.addEventListener('click', () => {
      state.settings.printing = { ...printerConfig(), driver: b.dataset.driver };
      saveSettings();
      renderPosSettings();
    });
  });
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
      btn.textContent = 'Scan for printers';
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
  attachEvents();
  track('app_open');
  if (tillPins()) lockTill();
  const openHashView = () => {
    const hash = (location.hash || '').replace('#', '').trim();
    const target = hash.split(/[/?&:]/)[0];
    const valid = ['sell', 'orders', 'inventory', 'customers', 'reports'];
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

  // Sync persisted UI state on first paint
  $$('.bb-size-btn[data-size]').forEach(b => b.classList.toggle('active', b.dataset.size === state.tileSize));
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);

  // Pick up appearance changes pushed from the back-office tab.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_TILE_SIZE && e.newValue && ITEMS_PER_PAGE[e.newValue]) {
      state.tileSize = e.newValue;
      state.page = 1;
      renderProducts();
    }
    if (e.key === STORAGE_SHOW_PRICE) {
      state.showPrice = e.newValue === '1';
      renderProducts();
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
    const newShow = storageGet(STORAGE_SHOW_PRICE, '0') === '1';
    let changed = false;
    if (newSize !== state.tileSize && ITEMS_PER_PAGE[newSize]) { state.tileSize = newSize; state.page = 1; changed = true; }
    if (newShow !== state.showPrice) { state.showPrice = newShow; changed = true; }
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
}
// Sales live in IndexedDB: open it before the first read (data-store.js ready()).
document.addEventListener('DOMContentLoaded', () => (window.HWPOS_STORE?.ready?.() || Promise.resolve()).then(init));
