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
    if ($('#variantSheet').classList.contains('open')) return backVariantSheet();   // it is the variant sheet's X while that is open (a category's variant list steps back)
    if (state.exchange) return leaveExchange();   // and the exchange's (startExchange)
    $('#app').classList.toggle('sidebar-collapsed');
  });
  // Per-view hamburger buttons (one in each view's header)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="open-sidebar"]');
    if (!btn) return;
    e.stopPropagation();
    if (QS.on && btn.closest('.view-items')) return qsAskLeave();   // quick stock's ✕ (pos-stock.js)
    if (addPick && btn.closest('.view-items')) return switchView('sell');   // Add tile's ✕ (pos-sell.js)
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
    if (e.pointerType === 'touch') { tapClose = e.pointerId; return true; }   // a finger shuts it as it lifts: a swipe there drives the menu (the edge swipe below), one slide, not shut-then-dragged (owner 2026-10-29: "a two-step stutter")
    shutSidebar();
    return true;
  }
  let tapClose = null;
  function shutSidebar() {
    $('#app').classList.add('sidebar-collapsed');
    swallowSidebarBackdropClick = true;
    clearTimeout(closeSidebarFromBackdrop._t);
    closeSidebarFromBackdrop._t = setTimeout(() => { swallowSidebarBackdropClick = false; }, 350);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!closeSidebarFromBackdrop(e)) return;
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.addEventListener('pointerup', (e) => { if (tapClose === e.pointerId) { tapClose = null; shutSidebar(); } }, true);   // a swipe's pointerup stops at the edge swipe's
  document.addEventListener('pointercancel', (e) => { if (tapClose === e.pointerId) tapClose = null; }, true);
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
  // phone: the full-page drawer's ✕, and a swipe left closes it (owner 2026-10-17), under the finger (the edge swipe below)
  $('.side-x').addEventListener('click', () => $('#app').classList.add('sidebar-collapsed'));
  // Sell's My page / All items switch (owner 2026-10-21): flips the page, says where you landed, and shows Sell
  $('#sellSwitch').addEventListener('click', () => {
    if (state.view === 'sell') $('#app').classList.add('sidebar-collapsed'); else switchView('sell');
    // the name sits mid-grid (the iPad's cart sits right): measured from the page, which may still be sliding home
    const r = $('#productGrid').getBoundingClientRect(), x = $('.main').getBoundingClientRect().left, t = $('#toast');
    setSellPage(state.sellPage === 'mine' ? 'all' : 'mine');
    showToast(state.sellPage === 'mine' ? 'My page' : 'All items');
    clearTimeout(showToast._t); showToast._t = setTimeout(hideToast, 700);   // the name runs on the page's blur clock (sp-swap), so they clear as one
    t.getAnimations().forEach(a => a.cancel()); void t.offsetWidth;   // no rise of its own; the reflow restarts sp-name on a quick second tap
    t.style.setProperty('--mid-l', r.left - x + 'px'); t.style.setProperty('--mid-r', innerWidth - r.right + x + 'px'); t.classList.add('mid');   // the next toast resets .mid
  });
  // The menu rides the finger, as the tabs do (owner 2026-10-30: control it, peek and put it back): the menu and the page
  // follow it out and back; let go past a quarter of the way, or flicked, and it slides the rest, else it slides home.
  // One piece for every swipe that moves it: left on the open menu, right from the screen's left edge, from a page's first
  // tab or from Sell's first page. at(x) while the finger moves, end(lifted) as it lets go.
  const app = $('#app'), sideEl = $('.sidebar'), mainEl = $('.main');
  const drawer = {
    w: () => sideEl.offsetWidth,
    live: false,
    at(x) {   // x: how far out the finger has the menu, 0 to its width
      const w = drawer.w();
      x = Math.min(w, Math.max(0, x));
      if (!drawer.live) Object.assign(drawer, { live: true, open: !app.classList.contains('sidebar-collapsed'), x0: x, pts: null });
      app.classList.add('drawer-drag');   // no slide while it rides; the page's edge shows (styles.css)
      sideEl.style.transition = mainEl.style.transition = '';   // a finger on a slide still going takes it
      noteMove(drawer, x - drawer.x0, performance.now());
      drawer.x = x;
      sideEl.style.transform = `translate3d(${x - w}px, 0, 0)`;
      mainEl.style.transform = `translate3d(${x}px, 0, 0)`;
    },
    end(lifted) {   // the one slide from where the finger left it, at the finger's speed (no brake, then crawl); a cancel goes home
      if (!drawer.live) return;
      drawer.live = false;
      if (lifted && swipeGo(drawer, drawer.w()) && drawer.dx > 0 !== drawer.open) app.classList.toggle('sidebar-collapsed', drawer.open);
      const left = Math.abs((app.classList.contains('sidebar-collapsed') ? 0 : drawer.w()) - drawer.x);
      const ms = Math.round(Math.min(450, Math.max(150, 2.25 * left / (Math.abs(speed(drawer)) || .01))));   // 2.25: the curve's start slope (.72 / .32)
      void sideEl.offsetWidth;   // the finger's spot is the slide's start
      sideEl.style.transition = mainEl.style.transition = `transform ${ms}ms cubic-bezier(.32, .72, 0, 1)`;
      app.classList.remove('drawer-drag');
      sideEl.style.transform = mainEl.style.transform = '';
      clearTimeout(drawer.t); drawer.t = setTimeout(() => { if (!drawer.live) sideEl.style.transition = mainEl.style.transition = ''; }, ms + 50);
    },
  };
  // a swipe's speed as it ends, px/ms over its last 100ms; a flick goes its way (back, if flicked back), else past a quarter lands it
  const noteMove = (s, dx, t) => { s.dx = dx; s.pts = [...(s.pts || []).filter(p => t - p.t < 100), { dx, t }]; };
  const speed = (s) => { const a = s.pts?.[0], b = s.pts?.at(-1); return a && b.t > a.t ? (b.dx - a.dx) / (b.t - a.t) : 0; };
  const swipeGo = (s, w) => { const v = speed(s); return Math.abs(v) > .3 ? v * s.dx > 0 : Math.abs(s.dx) > w / 4; };
  // From the screen's left edge a swipe right does what the top-left button does (owner 2026-10-29): ☰ pulls the menu out
  // under the finger; ‹ Back slides its page off and presses Back, the same path, so an editor with changes still asks.
  // On the open menu a swipe left pushes it back. The first 4px pick it; then it owns the finger and whatever the touch
  // started under lets go (a pointercancel). ponytail: iPhone Safari's own back swipe starts at the very edge and a page
  // can't stop it; a home-screen app has none
  const cornerBtn = () => [...document.querySelectorAll('button')].find(b => {   // the top-left one showing, nothing over it
    const r = b.getBoundingClientRect();
    return r.width && r.left < 40 && r.top < 160 && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === b;
  });
  const isMenu = b => (b.matches('#sidebarToggle') ? !$('#variantSheet').classList.contains('open') && !state.exchange   // ☰, unless it is a sheet's back (line 13)
    : !((QS.on || addPick) && b.closest('.view-items')));   // or the ✕ of Quick stock / the Add tile (line 22)
  // a touch on something that moves sideways itself (tabs, the Sell grid, a cart line, a chart, a sideways scroller) is its own
  const sideways = (t) => {
    if (t.closest('[data-swipes], #productGrid, #cartList, .kinds, .rp-chart, #deliveryMapStage, input, textarea, select')) return true;
    for (let el = t; el && el !== document.body; el = el.parentElement)
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    return false;
  };
  let edge = null;
  addEventListener('pointerdown', (e) => {
    edge = null;
    const open = !app.classList.contains('sidebar-collapsed');
    if (e.pointerType !== 'touch' || !e.isPrimary || lifted || (open && !e.target.closest('.sidebar, .main'))) return;   // open: the menu or the page peeking beside it
    const b = !open && cornerBtn(), menu = !!b && b.matches('#sidebarToggle, [data-act="open-sidebar"]');
    if (!open && !b) return;
    if (!open && e.clientX > 24 && !(menu && isMenu(b) && !sideways(e.target))) return;   // past the edge only ☰ pages swipe, anywhere on them (owner 2026-10-29)
    let pg = !menu && b;   // the page Back leaves: the button's first full-height box
    while (pg && pg.getBoundingClientRect().height < innerHeight * .8) pg = pg.parentElement;
    edge = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.target, open, b, menu: menu && isMenu(b), pg: pg && !pg.contains(mainEl) ? pg : null };
  }, true);
  addEventListener('pointermove', (e) => {
    const g = edge;
    if (g?.id !== e.pointerId) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.on) {
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx > 0 === g.open) return (edge = null);   // a scroll, or the wrong way
      g.at.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: g.id, pointerType: 'touch', isPrimary: true }));
      g.on = true;   // after: that cancel passes this file's own listeners too
      if (g.pg) g.pg.style.transition = 'none';
    }
    e.stopPropagation();
    noteMove(g, dx, e.timeStamp);
    if (g.pg) g.pg.style.transform = `translate3d(${Math.max(0, dx)}px, 0, 0)`;
    else if (g.open || g.menu) drawer.at((g.open ? drawer.w() : 0) + dx);
  }, true);
  addEventListener('touchmove', (e) => { if (edge?.on) { e.preventDefault(); e.stopPropagation(); } }, { capture: true, passive: false });   // the page holds still
  const edgeEnd = (e) => {
    const g = edge;
    if (g?.id !== e.pointerId || !g.on) return;
    edge = null;
    e.stopPropagation();
    if (g.open || g.menu) return drawer.end(e.type === 'pointerup');
    const go = e.type === 'pointerup' && swipeGo(g, g.pg ? g.pg.offsetWidth : drawer.w());
    if (!go) { if (g.pg) Object.assign(g.pg.style, { transition: 'transform .28s var(--rl-ease)', transform: '' }); return; }
    if (!g.pg) return g.b.click();
    const pg = g.pg;   // off to the right, then Back; it asked (an editor's changes): the page comes back under the ask
    Object.assign(pg.style, { transition: 'transform .2s var(--rl-ease)', transform: `translate3d(${innerWidth - pg.getBoundingClientRect().left + g.dx}px, 0, 0)` });
    setTimeout(() => {
      g.b.click();
      Object.assign(pg.style, confirmSheet ? { transition: 'transform .28s var(--rl-ease)', transform: '' } : { transition: 'none', transform: '' });
      setTimeout(() => { pg.style.transition = ''; }, 300);
    }, 200);
  };
  addEventListener('pointerup', edgeEnd, true);
  addEventListener('pointercancel', edgeEnd, true);
  // A page's tabs under the finger (owner 2026-10-29), the Sell grid's way: `live` rides a sideways drag with the tab beside
  // it peeking (a copy, drawn by o.fill(el, tab) a frame in, so the page moves at once); a quarter of the way or a flick lands
  // on it, pressed through its tab (or o.go). Right of the first tab the ☰ menu comes out instead. A touch on a slide
  // still going lands it at once. o.box: the .kinds switch, o.attr its data- key, o.ok(e): may this touch swipe.
  const tabSwipe = (host, live, o) => {
    let s = null, landing = null;
    const area = host.closest('.c-scroll') || host;   // the whole scroller hears it, the space under a short tab too
    area.dataset.swipes = '';   // the ☰ swipe anywhere leaves it be: its first tab opens the menu itself
    const parts =() => [live, ...host.querySelectorAll(':scope > .tab-peek')];
    const pill = (to, f) => {   // the switch's pill follows, f of the way from the current tab to `to`'s
      const box = o.box, a = box.querySelector('.cur'), b = box.querySelector(`[data-${o.attr}="${to}"]`) || a;
      box.classList.add('slid');
      box.style.setProperty('--x', `${a.offsetLeft + (b.offsetLeft - a.offsetLeft) * f}px`);
      box.style.setProperty('--w', `${a.offsetWidth + (b.offsetWidth - a.offsetWidth) * f}px`);
    };
    const at = (g, x) => parts().forEach(p => { p.style.transform = `translate3d(${x + (+p.dataset.at || 0) * g.step}px, 0, 0)`; });
    const land = () => {
      if (!landing) return;
      const { to } = landing;
      clearTimeout(landing.t); landing = null;
      if (to) (o.go || (t => o.box.querySelector(`[data-${o.attr}="${t}"]`).click()))(to);   // the live page takes the peek's place
      parts().forEach(p => (p === live ? Object.assign(p.style, { transition: '', transform: '' }) : p.remove()));
      host.classList.remove('swiping');
    };
    area.addEventListener('pointerdown', (e) => {
      land();
      s = e.pointerType === 'touch' && e.isPrimary && o.ok(e) ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    });
    area.addEventListener('pointermove', (e) => {
      if (s?.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.on) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        if (Math.abs(dy) >= Math.abs(dx)) return (s = null);   // a scroll: the page's
        const ks = [...o.box.querySelectorAll(`[data-${o.attr}]`)].map(b => b.dataset[o.attr]), i = ks.indexOf(o.box.querySelector('.cur')?.dataset[o.attr]);
        const b = cornerBtn(), r = live.getBoundingClientRect();
        Object.assign(s, { on: true, prev: ks[i - 1], next: ks[i + 1], step: r.width + 2 * (r.left - mainEl.getBoundingClientRect().left),   // a page + its margins
          menu: !ks[i - 1] && !!b?.matches('#sidebarToggle, [data-act="open-sidebar"]') && isMenu(b) });
        try { area.setPointerCapture(e.pointerId); } catch {}   // a redraw under the finger can't drop the swipe (a made-up test touch can't be held)
        host.classList.add('swiping'); o.box.classList.add('held');
        const g = s;
        requestAnimationFrame(() => setTimeout(() => {
          if (s !== g) return;
          [[g.prev, -1], [g.next, 1]].forEach(([t, k]) => {
            if (!t) return;
            const p = live.cloneNode(false);
            p.removeAttribute('id'); p.classList.add('tab-peek'); p.dataset.at = k;
            Object.assign(p.style, { left: live.offsetLeft + 'px', top: live.offsetTop + 'px', width: live.offsetWidth + 'px',
              height: getComputedStyle(live).overflowY === 'visible' ? '' : live.offsetHeight + 'px' });   // a scroller keeps its height
            host.append(p); o.fill(p, t);
          });
          at(g, g.x0);
        }));
      }
      noteMove(s, dx, e.timeStamp);
      const to = dx < 0 ? s.next : s.prev;
      if (s.menu && (dx > 0 || drawer.live)) drawer.at(dx);
      at(s, s.x0 = to ? dx : s.menu && dx > 0 ? 0 : dx * .25);   // nothing that way: it gives, the grid's rubber band
      pill(to, to ? Math.min(1, Math.abs(dx) / s.step) : 0);
    });
    area.addEventListener('touchmove', (e) => { if (s?.on) e.preventDefault(); }, { passive: false });   // the page holds still
    const end = (e) => {
      if (s?.id !== e.pointerId) return;
      const g = s, go = e.type === 'pointerup' && swipeGo(g, g.step);
      s = null;
      if (!g.on) return;
      o.box.classList.remove('held');
      drawer.end(e.type === 'pointerup');
      const to = go ? (g.dx < 0 ? g.next : g.prev) : null;
      pill(to, 1);   // the pill finishes with the page, both .28s
      parts().forEach(p => { p.style.transition = 'transform .28s var(--rl-ease)'; });
      at(g, to ? (g.dx < 0 ? -g.step : g.step) : 0);
      landing = { to, t: setTimeout(land, 290) };   // ponytail: the slide's length, not transitionend (none when nothing moves)
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
  };

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
    if (document.querySelector('.modal-backdrop:not([hidden]), .rail-veil, .pk-dim, .esheet.open')) return;   // a sheet, menu, confirm or peek is up
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
    suppressGridClick = false;   // the last swipe's own click has been and gone: a new touch is a tap again, no wait
    const at = new DOMMatrix(getComputedStyle(track).transform).m41;   // a page still sliding stops under the finger (owner 2026-10-29)
    track.classList.add('dragging');
    track.style.transform = `translate3d(${at}px, 0, 0)`;
    swipeStart = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      at,
      dragging: false,
    };
  });

  productGrid.addEventListener('pointermove', (e) => {
    if (!swipeStart || swipeStart.id !== e.pointerId) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;

    // Only start dragging if horizontal movement exceeds vertical
    if (!swipeStart.dragging && Math.abs(dx) >= 4 && Math.abs(dx) > Math.abs(dy)) {   // the 4px every swipe here picks its way in
      swipeStart.dragging = true;
    }
    if (!swipeStart.dragging) return;

    const track = $('#productTrack');
    if (!track) return;
    const gap = parseFloat(getComputedStyle(track).gap) || 0;
    const step = productGrid.clientWidth + gap;
    const total = totalPages();
    let offset = swipeStart.at + dx;
    noteMove(swipeStart, dx, e.timeStamp);

    // right of the first page is the menu, pulled out under the finger (owner 2026-10-29); editing My page it gives as before
    swipeStart.menu = offset > 0 && !myEditing;
    if (swipeStart.menu || drawer.live && !myEditing) drawer.at(offset);
    if (swipeStart.menu) offset = 0;
    // Rubber-band at boundaries
    else if (offset > 0) {
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

    drawer.end(true);
    if (swipeStart.dragging) {
      // where it lies, in pages; past an eighth of a page (or flicked) it goes on the finger's way, else the nearest page
      const step = productGrid.clientWidth + (parseFloat(getComputedStyle(track).gap) || 0), dx = swipeStart.dx || 0;
      const pos = 1 - (swipeStart.at + dx) / step, go = Math.abs(dx) > step * .12 || swipeGo(swipeStart, Infinity);
      const to = Math.min(totalPages(), Math.max(1, go ? (dx < 0 ? Math.ceil(pos) : Math.floor(pos)) : Math.round(pos)));
      if (to !== state.page) changePage(to - state.page);
      else updateProductTrackPosition();
      suppressGridClick = true;
    } else updateProductTrackPosition();   // a tap: a page caught sliding carries on

    swipeStart = null;
  });

  productGrid.addEventListener('pointercancel', (e) => {
    const track = $('#productTrack');
    if (track) track.classList.remove('dragging');
    if (swipeStart) updateProductTrackPosition();   // home, or on with a slide it caught
    drawer.end();
    swipeStart = null;
  });

  // ---- My page: hold a tile to lift it and drag it anywhere; held at the grid's edge it turns the page, past the last page it
  // starts a new one. The order stays packed, so a page never has a gap (owner 2026-10-21). While editing, a tile drags at once ----
  // Not editing, a still hold peeks instead (pos-sell.js openPeek, any tile); on My page the peek then moved = editing with the tile
  // in hand, and a hold on an empty spot = editing at once (owner 2026-10-22)
  let hold = null, lifted = false;
  productGrid.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.product-card, .vs-row');   // .vs-row: All items as a list (pos-sell.js renderSellList)
    if (e.button > 0 || hold || peekOpen() || e.target.closest('[data-remove]')) return;   // one finger at a time: a second would lift a copy no finger drops
    if (myEditing ? !card?.matches('[data-at]') : card ? card.matches('.pc-add, .mp-ghost') : !productGrid.querySelector('[data-at]')) return;   // All items: an empty spot does nothing
    hold = { card, at: card ? +card.dataset.at : -1, x: e.clientX, y: e.clientY, id: e.pointerId, t: setTimeout(myEditing ? lift : card ? peekHold : wiggle, myEditing ? 150 : 380) };   // editing: a short still hold, so a flick still turns the page; 380 beats the old 400 ms lift
  });
  addEventListener('pointermove', (e) => {   // anywhere: once the peek is up the finger is over its dim
    if (!hold || lifted || hold.id !== e.pointerId || Math.hypot(e.clientX - hold.x, e.clientY - hold.y) < 8) return;
    if (!hold.peek) { clearTimeout(hold.t); hold = null; return; }   // moved before the hold: a swipe
    if (peekOpen() && hold.card?.dataset.at != null) { closePeek(true); lift(); }   // My page, held then moved: the tile follows the finger
  });
  const still = () => { swipeStart = null; $('#productTrack')?.classList.remove('dragging'); updateProductTrackPosition(); hold.peek = true; };   // the hold took the finger: no page swipe, the release is no tap
  function peekHold() { still(); if (!openPeek(hold.card)) hold.card.dataset.at != null ? lift() : hold = null; }
  function wiggle() { still(); myEdit(true); }
  const unhold = (e) => {
    if (!hold || lifted || hold.id !== e.pointerId) return;
    clearTimeout(hold.t);
    if (hold.peek) {   // the release is no tap - its click lands on the peek now over the tile (a row there would add), so eat it anywhere
      const eat = (c) => { c.stopImmediatePropagation(); c.preventDefault(); };
      addEventListener('click', eat, { capture: true, once: true }); setTimeout(() => removeEventListener('click', eat, true), 300);
    }
    hold = null;
  };
  productGrid.addEventListener('contextmenu', (e) => e.preventDefault());   // a long press is the peek, not the browser's menu
  addEventListener('pointerup', unhold);   // anywhere: a mouse let go off the grid lifts nothing
  addEventListener('pointercancel', unhold);
  const noScroll = (e) => e.preventDefault();
  function lift() {
    if (lifted || !hold) return;
    let i = hold.at, edge = 0, flip = 0, settle = 0, again = 0, at = null;
    const { x: x0, y: y0, id } = hold, card = productGrid.querySelector(`[data-at="${i}"]`), r = card.getBoundingClientRect();
    lifted = true;
    swipeStart = null; $('#productTrack')?.classList.remove('dragging'); updateProductTrackPosition();
    myEdit(true);
    pinMyPages();
    const snap = HWPOS_STORE.ui.get('myPage', '[]'), i0 = i;   // the pages at lift: each new spot replays one move on them,
    const ghost = card.cloneNode(true);
    ghost.classList.add('mp-ghost');
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    productGrid.append(ghost);   // inside the grid, so its size and picture rules still apply
    const place = (to) => {   // so a page the tile only passed over gets its tiles back
      const was = HWPOS_STORE.ui.get('myPage', '[]'), o = j => { const k = j - (j > i ? 1 : 0); return k + (k >= i0 ? 1 : 0); };   // index now -> at lift
      HWPOS_STORE.ui.set('myPage', snap);
      myLifted = i = moveMyTile(i0, to === 'new' ? to : 'after' in to ? { after: o(to.after) } : { before: o(to.before) });
      if (HWPOS_STORE.ui.get('myPage', '[]') !== was) renderProducts();
    };
    myLifted = i; renderProducts();
    const turn = () => {   // held at an edge: the next / previous page; past the last, alone on a new one
      if (edge > 0 && state.page >= totalPages()) { place('new'); state.page = totalPages(); updateProductTrackPosition(); return; }
      changePage(edge); flip = setTimeout(turn, 800); settle = Date.now() + 350;   // the page under the finger is still sliding in: place once it is there
      clearTimeout(again); again = setTimeout(() => at && move(at), 360);
    };
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      at = ev;
      ghost.style.translate = `${ev.clientX - x0}px ${ev.clientY - y0}px`;
      const g = productGrid.getBoundingClientRect(), side = ev.clientX < g.left + 28 ? -1 : ev.clientX > g.right - 28 ? 1 : 0;
      if (side !== edge) { edge = side; clearTimeout(flip); if (side) flip = setTimeout(turn, 500); }
      if (side || Date.now() < settle) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY), over = el?.closest('#productGrid .product-card:not(.mp-ghost)');
      if (over?.dataset.at != null) { const j = +over.dataset.at; if (j !== i) place(j > i ? { after: j } : { before: j }); return; }
      toEnd(over?.hasAttribute('data-add') ? over.parentElement : el?.closest('#productGrid .product-page'));   // a page's empty end: last on it
    };
    const toEnd = (pg) => {
      const last = pg && [...pg.querySelectorAll('[data-at]')].at(-1);
      if (last && +last.dataset.at !== i) place({ after: +last.dataset.at });
      else if (pg && !last) place('new');   // a page with only Add tile on it: alone there
    };
    const drop = (ev) => {
      if (ev?.pointerId != null && ev.pointerId !== id) return;
      if (ev?.type === 'pointerup' && Date.now() < settle) toEnd(productGrid.querySelectorAll('.product-page')[state.page - 1]);   // let go as the page slid in: onto it
      clearTimeout(flip); clearTimeout(again); ghost.remove(); myLifted = myDrop = null; renderProducts();
      removeEventListener('pointermove', move); removeEventListener('pointerup', drop); removeEventListener('pointercancel', drop);
      removeEventListener('touchmove', noScroll); removeEventListener('resize', drop);
      hold = null; lifted = false;
      suppressGridClick = true;   // the release is no tap
      clearTimeout(productGrid._swipeClickTimer);
      productGrid._swipeClickTimer = setTimeout(() => { suppressGridClick = false; }, 260);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', drop); addEventListener('pointercancel', drop);
    addEventListener('resize', drop); myDrop = drop;   // a turned screen drops it where it is: the lifted copy was the old size
    addEventListener('touchmove', noScroll, { passive: false });   // the drag owns the finger
  }
  document.addEventListener('click', (e) => {   // a tap off the grid ends editing; Done (Check out's button) does only that
    if (!myEditing || e.target.closest('#productGrid')) return;
    if (e.target.closest('#cartBar, #payBtn')) { e.preventDefault(); e.stopPropagation(); }
    myEdit(false);
  }, true);
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
    if (myEditing) {   // editing My page: × takes a tile off, any other tap ends it
      const x = e.target.closest('[data-remove]');
      if (x) removeMyTile(+x.closest('[data-at]').dataset.at); else myEdit(false);
      return;
    }
    const card = e.target.closest('.product-card, .vs-row');
    if (!card) return;
    if (card.hasAttribute('data-add')) return openAddTile(card);
    if (card.dataset.cat) return openCatSheet(card.dataset.cat);
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
    if (row.dataset.openGroup) return openVariantModal(row.dataset.openGroup, state.variantModal);   // a category's item with variants: its list, X steps back
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
    if (!picking(o)) { orderPicks(o); Object.assign(orderPick, { on: true, mode: 'refund' }); return morph(renderOrderDetail); }
    const picks = orderPicks(o), part = picks.length && SalesMath.refundPart(o, reversalsOf(o), picks);
    if (part && orderPick.mode === 'exchange') return startExchange(o.id, picks);
    if (part) showConfirm({ title: `Refund ${SalesMath.plural(picks.length, 'item')} on #${o.number}?`, message: `${moneyBackSaid(o, part)}.`,
      okText: 'Refund', onConfirm: () => morph(() => recordReturn(o.id, 'Refund', picks)) });
  };
  const askVoid = (o) => showConfirm({ title: `Void #${o.number}?`, message: 'The sale stays on record, marked voided.', okText: 'Void sale', onConfirm: () => voidOrder(o.id, 'Void') });
  $('#orderRefund')?.addEventListener('click', () => { const o = shownOrder(); if (o) refundTicked(o); });
  $('#orderCancel')?.addEventListener('click', () => morph(() => { Object.assign(orderPick, { on: false, lines: {} }); renderOrderDetail(); }));
  // Exchange ticks what comes back the way Refund does (owner 2026-10-09); the bar's button then reads Exchange ₱X.
  const exchangeItems = (o) => {
    if (state.view !== 'orders') { switchView('orders'); $('#ordersView').classList.add('reading'); }   // the details pop-up opens from Reports too
    orderPicks(o); Object.assign(orderPick, { on: true, mode: 'exchange' }); state.selectedOrderId = o.id; morph(renderOrderDetail); };
  // ⋯: the ticks are the lines refunds and exchanges use, so "Refund items" is the list itself now.
  const orderMenu = (btn, o) => openMenu(btn, [
    { label: 'Order details', run: () => openOrderDetailModal(o.id) },
    { label: 'Exchange', off: !isCompletedSale(o), run: () => exchangeItems(o) },
    '-',
    o.draft ? { label: 'Delete', red: true, run: () => showConfirm({ title: `Delete “${o.name || orderStatusLabel(o)}”?`, okText: 'Delete', danger: true,
      onConfirm: () => { HWPOS_STORE.savedCarts.remove(o.id); if (state.savedId === o.id) state.savedId = ''; renderOrders(); showDone('Deleted'); } }) }
      : { label: 'Void sale', red: true, off: !canVoid(o), run: () => askVoid(o) },
  ], { w: 200, right: true });
  // phone: the bar keeps ‹ and ⋯ only, so ⋯'s sheet carries Print receipt and Refund too (owner 2026-10-19).
  // A draft hides ⋯ (refundAct), so the sheet only ever sees a sale.
  $('#orderMore')?.addEventListener('click', (e) => { const o = shownOrder(); if (!o) return;
    if ($('#orderPrint').offsetParent) return orderMenu(e.currentTarget, o);   // Print on the bar: the layout's own phone test (styles.css)
    openActionSheet(e.currentTarget, `#${o.number}`, [
      { label: 'Print receipt', run: () => printOrder(o) },
      { label: 'Refund', off: !isCompletedSale(o), run: () => refundTicked(o) },
      { label: 'Exchange', off: !isCompletedSale(o), run: () => exchangeItems(o) },
      ...(o.fulfilment === 'delivery' ? [{ label: 'Order details', run: () => openOrderDetailModal(o.id) }] : []),
      '-',
      { label: 'Void sale', red: true, off: !canVoid(o), run: () => askVoid(o) },
    ]); });
  // A tick, tick-all or − / + on the lines: the same pick, whichever page shows the order.
  $('#orderDetail')?.addEventListener('click', (e) => {
    const back = e.target.closest('[data-print-back]');
    if (back) { const r = state.orders.find(x => x.id === back.dataset.printBack); if (r) printOrder(r); return; }
    const el = e.target.closest('[data-line], [data-all]'), o = shownOrder();
    if (el && o && pickOrderLine(o, el)) renderOrderDetail();
  });
  $('#orderDetailModal')?.addEventListener('click', (e) => {
    const trip = e.target.closest('[data-delivery-event]');
    if (trip) recordDeliveryEvent(trip.dataset.orderId, trip.dataset.deliveryEvent);
  });
  wireFind('#ordersFind', '#ordersSearch', '#ordersSearchX', (q) => { state.ordersQuery = q; renderOrders(); });
  $('#ordersFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['When', 'range', ORDER_RANGES.map(([v, l]) => [v, l])],
    ['Staff', 'staff', [['', 'Anyone'], ...[...new Set(state.orders.map(orderSeller).filter(Boolean))].sort().map(c => [c, c])]],
    ['Payment', 'pay', [['', 'Any'], ...PAY_KEYS.map(k => [k, SalesMath.tenderLabel(k)])]],
    ['Status', 'status', [['', 'Any'], ...['sale', 'saved', 'quote', 'part', 'refunded', 'voided'].map(k => [k, DRAFT_LABEL[k] || SalesMath.ROW_LABEL[k]]), ['xchg', 'Exchanged']]],
    // Each type a row can read (orderFulfilLabel), the owner's own ones included, so a 'Tricycle' row is found as itself.
    ['Fulfilment', 'fulfil', [['', 'Any'], ...[...new Set([...FULFIL_BUILTINS.map(([k]) => k), ...state.orders.map(o => o.fulfilment)])]
      .map(k => [k, orderFulfilLabel({ fulfilment: k })])]],
  ], state.ordersFilter, ordersDef(), renderOrders));

  // ---- Items (list + editor; Save is not connected yet) ----
  // The switch picks the list (items, categories, modifiers); a row and + open that kind's editor.
  const openKind = (id, k = itemsKind) => (k === 'items' ? openItemEditor(id) : openKindEditor(k, id));
  $('#itemsKinds')?.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) setItemsKind(b.dataset.kind); });
  const kb = $('#itemsKinds'), kbFade = () => {   // fade an edge only while more words hide past it, as Safari's tab groups
    kb.classList.toggle('fade-l', kb.scrollLeft > 1); kb.classList.toggle('fade-r', kb.scrollLeft + kb.clientWidth < kb.scrollWidth - 1);
  };
  kb.addEventListener('scroll', kbFade, { passive: true });
  const kbRO = new ResizeObserver(() => { kb.classList.remove('slid'); kbFade(); });   // tabs moved: the pill re-places on the next switch
  [kb, ...kb.children].forEach(el => kbRO.observe(el));   // the words too: a late font or another language widens them
  wireSegDrag($('#itemsKinds'), 'kind');
  [['#itemsView', '#itemsView .head'], ['.view-reports .iv', '.view-reports .head']].forEach(([v, h]) =>   // Items, Reports: the page starts under the head, the frost covers it
    new ResizeObserver(([e]) => $(v).style.setProperty('--head-h', e.target.offsetHeight + 'px')).observe($(h), { box: 'border-box' }));
  // Liquid glass press (owner 2026-10-18): the button swells and shines under the finger, leans and stretches toward a drag, springs back on release
  const LG = '.lv .head > :is(.sq[data-act="open-sidebar"], #itemsBack), :is(.lv :is(#itemsAdd, #newCustomerBtn, #shiftFab, #orderRefund.primary), .esheet .sh-fab), #catalogSearchRow > #sidebarToggle, #catalogSearchRow > .search-wrap:not(.vs-search), .side-top > #sellSwitch, #app .side-link[data-view="settings"]';
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest(LG);
    if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const x0 = e.clientX, y0 = e.clientY, pull = (d, c, k) => c * d / (d + k);   // rubber band: follows, then resists
    const all = b.matches('.search-wrap') ? [b, $('#scanBtn')] : [b], k = Math.min(1, (all[1] ? 20 : 44) / b.offsetWidth), cap = all[1] ? 3 : 10;   // Sell's search: scan moves with it; it moves 3px and stretches 4, as Messages' (owner 2026-10-18 photos)
    if (all[1]) { const w = b.getBoundingClientRect(), s = all[1].getBoundingClientRect(); all[1].style.transformOrigin = `${w.left + w.width / 2 - s.left}px ${w.top + w.height / 2 - s.top}px`; }   // scan turns about the bar's middle
    const set = (v, x) => all.forEach(t => t.style.setProperty(v, x));
    const shine = (ev) => { const r = b.getBoundingClientRect(), at = (v, n) => Math.min(Math.max(v, 0), n) / n * 100 + '%';   // the light stays on the glass
      b.style.setProperty('--lg-px', at(ev.clientX - r.left, r.width)); b.style.setProperty('--lg-py', at(ev.clientY - r.top, r.height)); };
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0, d = Math.hypot(dx, dy), m = pull(d, cap, 40) / (d || 1);
      set('--lg-x', dx * m + 'px'); set('--lg-y', dy * m + 'px');
      set('--lg-a', Math.atan2(dy, dx) + 'rad'); set('--lg-s', pull(d, .2, 60) * k);
      shine(ev);
    };
    const end = () => { all.forEach(t => { t.classList.remove('lg-on'); ['--lg-x', '--lg-y', '--lg-s'].forEach(v => t.style.removeProperty(v)); });   /* --lg-a stays: the spring wobbles along the pull */ removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); };
    shine(e); all.forEach(t => t.classList.add('lg-on'));
    addEventListener('pointermove', move); addEventListener('pointerup', end); addEventListener('pointercancel', end);
  });
  // swipe the list left / right for the next / previous tab (owner 2026-10-16); not in Quick stock, which hides the tabs
  tabSwipe($('.view-items .list'), $('#itemsLines'), { box: $('#itemsKinds'), attr: 'kind', ok: () => !QS.on && $('#itemsKinds').offsetWidth,
    fill: (p, kind) => { p.innerHTML = '<div class="band cols"></div><div></div>'; fillItemsPane(kind, p.firstChild, p.lastChild); p.scrollTop = itemsTop[kind] || 0; } });
  $('#itemsRows')?.addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) row.dataset.hub ? setItemsKind(row.dataset.hub) : addPick ? addPickTap(row.dataset.id) : QS.on ? qsPickRow(row.dataset.id) : openKind(row.dataset.id); });
  $('#itemsBack')?.addEventListener('click', () => setItemsKind('hub'));
  // Items +: the blurred stack, Change price / Quick stock (pos-stock.js) / Add item; the other kinds add straight away
  const fabIc = d => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;
  $('#itemsAdd')?.addEventListener('click', (e) => (itemsKind === 'addons' ? showToast("Add-ons aren't connected yet") : itemsKind !== 'items' ? openKind(null) : openFabMenu(e.currentTarget, [
    { label: 'Adjust price', ic: fabIc('<path d="M3.4 13.4l7.2 7.2a2 2 0 0 0 2.8 0L21 13V3H11L3.4 10.6a2 2 0 0 0 0 2.8z"/><circle cx="16.5" cy="7.5" r="1.3"/>'), run: () => qsStart('price') },
    { label: 'Adjust stock', ic: fabIc('<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>'), run: () => qsStart() },
    { label: 'Add item', ic: fabIc('<path d="M12 5v14M5 12h14"/>'), run: () => openItemEditor(null) },
  ])));
  $('#itemSave')?.addEventListener('click', () => (kindEdit ? saveKind() : saveItem()));
  const notYet = what => () => showToast(`${what} isn't connected yet`);
  wireFind('#itemsFind', '#itemsSearch', '#itemsSearchX', (q) => { itemsFilter.q = q; renderItems(); });
  $('#itemsFilter')?.addEventListener('click', (e) => openFilterSheet(e.currentTarget, () => [
    ['Category', 'cat', [['', 'All'], ...itemCategories().map(c => [c, c])]],
    ['Stock', 'stock', [['', 'Any'], ['low', 'Low'], ['out', 'Out']]],
  ], itemsFilter, ITEMS_FILTER_DEF, renderItems));
  const itemForm = $('#itemForm');
  wireFind('#itemFind', '#itemFindQ', '#itemFindX', filterPicks);
  $('#itemFindFilter')?.addEventListener('click', (e) => pickFilter(e.currentTarget));   // a category's Items / Asked on (pos-items)
  $('#kindPickGo')?.addEventListener('click', saveKind);
  itemForm?.addEventListener('scroll', () => itemForm.previousElementSibling.classList.toggle('tuck', itemForm.scrollTop > 24), { passive: true });   // Apple's: search tucks, the title shows
  // back from a subpage first (pos-items itemGo), then out of the editor
  $('#itemBack')?.addEventListener('click', () => (kindEdit?.sub ? kindBack() : itemEdit && itemSub ? itemBackSub()
    : askLeave(editorDirty(), closeItemEditor)));   // a variant's Made from goes back to the variant, a modifier's choices to Modifiers; out of the editor with changes asks first
  itemForm?.addEventListener('click', (e) => { const b = e.target.closest('[data-look]'); if (b) lookClick(b); });   // Tile appearance, both editors
  // the category / modifier editor's fields (pos-items kindInput); the item editor's below
  itemForm?.addEventListener('click', (e) => { const b = kindEdit && e.target.closest('[data-ka], [data-sub]'); if (b) kindClick(b); });
  itemForm?.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.k === 'q') return filterPicks(t.value);   // a tick list's search, both editors
    if (kindEdit) return kindInput(t);
    if (t.dataset.mq) return itemMadeSet(t);   // a Made from amount
    const E = itemEdit, f = t.dataset.f, head = $('#itemTitle');
    // a blank Price stays blank (asked at sale), not 0, and so does the Markup that follows it
    const num = () => (t.value === '' && ['price', 'marginValue'].includes(f || t.dataset.v) ? null : Number(t.value) || 0);
    if (t.dataset.alt) { const v = altsOf(); if (t.dataset.alt === 'main') v.sku = t.value; else v.alts[t.dataset.alt] = t.value; return; }   // the SKU page (pos-items itemSkuPage)
    if (t.dataset.v) {   // the variant's page
      const v = E.variants.find(x => x.id === itemSub);
      v[t.dataset.v] = t.type === 'number' ? num() : t.value;
      if (t.dataset.v === 'cost' || t.dataset.v === 'price') $('#itemMarginNote').innerHTML = imarginNote(v);
      return;
    }
    if (!f || t.type === 'checkbox') return;
    if (['cost', 'price', 'stock', 'sku', 'barcode'].includes(f)) E.variants[0][f] = t.type === 'number' ? num() : t.value;
    else E[f] = f === 'marginValue' || f === 'reorder' ? num() : t.value;
    if (f === 'cost' || f === 'marginValue') itemReprice('cost');
    if (f === 'price') itemReprice('price');
    if (f === 'name') head.textContent = E.name || 'New item';
  });
  itemForm?.addEventListener('change', (e) => {
    const t = e.target, E = itemEdit, k = t.dataset.tick;
    if (t.id === 'lookImg' && t.files[0]) return lookPhoto(t.files[0]);
    if (kindEdit || !E) return;
    if (t.dataset.f === 'sellOut') E.sellOut = t.checked;
    if (t.dataset.f === 'track') { E.track = t.checked; renderItemForm(); }   // Low stock and Sell when out come and go with it
    if (t.dataset.f === 'component') { E.component = t.checked; renderItemForm(); }   // the short page or the full one
    if (t.dataset.made) itemMadeSet(t);
    if (t.dataset.ch) return itemChoiceSet(t);   // a modifier's choice on this item
    if (k) {   // a tick on a subpage; unticking the main supplier leaves none
      E[k] = t.checked ? [...E[k], t.value] : E[k].filter(x => x !== t.value);
      if (k === 'sups' && !E.sups.includes(E.main)) { E.main = ''; itemForm.querySelector('[data-act=main] span').textContent = 'None'; }
      if (k === 'mods') itemModTick(t);
    }
  });
  itemForm?.addEventListener('pointerdown', modGrip);   // ≡ on the item's Modifiers page: drag to change the asking order
  itemForm?.addEventListener('click', (e) => {
    const E = itemEdit, b = !kindEdit && e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.sub) itemGo(b.dataset.sub);
    else if (act === 'add-variant') { const v = blankVariant(); E.variants.push(v); itemGo(v.id); itemForm.querySelector('[data-v=name]').focus({ preventScroll: true }); }
    else if (act === 'add-alt') { altsOf().alts.push(''); renderItemForm(); [...itemForm.querySelectorAll('[data-alt]')].pop().focus(); }
    else if (act === 'del-variant') {
      E.variants = E.variants.filter(v => v.id !== itemSub);
      E.marginValue = itemMarkupOf(E.variants[0], E.marginMode);   // Markup is back when one is left
      itemGo('');
    }
    else if (act === 'stock') { if (itemIsNew) showToast('Save the item first'); else askLeave(editorDirty(), () => qsAdjust(E.id)); }   // Quick stock (pos-stock.js)
    else if (act === 'archive') notYet('Archiving')();   // ponytail: as Save, design only until the back office owns catalog writes
    else if (act) itemPick(b);   // status, markup kind, sold per, main supplier
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
  document.addEventListener('keydown', editKey);
  $('#editSheet').addEventListener('keydown', (e) => {   // Enter in the SC/PWD ID or Name, or a line's note, is its Apply
    if (e.key !== 'Enter' || !e.target.closest('[data-scf], #esNote')) return;
    e.preventDefault();
    editSheetClick({ target: $('#editSheet :is([data-apply], [data-done])') });
  });
  $('#editSheet').addEventListener('input', (e) => {   // the address, and a line's note, land on the cart as they're typed
    const line = e.target.id === 'esNote' && esItem();
    if (line) {
      line.note = e.target.value.replace(/\s+/g, ' ').trim();   // one line on the slip
      $('#editSheet [data-sf="n"] .ad').textContent = line.note;
      return keepCart();   // kept as typed: a reload before the sheet closes keeps it
    }
    if (e.target.id !== 'esAddr') return;
    state.deliveryAddress = e.target.value;
    keepCart();
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
  $('#custNewBar').addEventListener('click', addCustomerFromSale);
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
  $('#shiftView')?.addEventListener('click', onShiftEvent);   // pos-shift.js: both its pages
  new ResizeObserver(([e]) => e.target.classList.remove('slid')).observe($('#shiftTabs'));   // as Reports' pill
  wireSegDrag($('#shiftTabs'), 'shtab');
  tabSwipe($('#shiftPage .c-body'), $('#shiftBody'), { box: $('#shiftTabs'), attr: 'shtab', ok: e => !e.target.closest('.kinds'), fill: (p, tab) => renderShift({ el: p, tab }) });
  tabSwipe($('.view-reports .c-body'), $('#reportsBody'), { box: $('#reportsUnits'), attr: 'unit', ok: e => !e.target.closest('.kinds, .rp-chart'),
    fill: (p, unit) => { renderReports('still', { el: p, unit }); p.classList.remove('slide-l', 'slide-r'); }, go: unit => reportsGo(unit, 0, 'still') });
  $('#shiftSheet').addEventListener('click', shiftSheetClick);
  document.addEventListener('keydown', shiftKey);
  $('#custSaveBtn')?.addEventListener('click', () => saveSavedCustomerFromModal());
  $('#customerEditModal [data-cust-close]').addEventListener('click', () => leaveCustomerEdit());   // asks when changed
  // "Open Ana" on the duplicate-phone note: mid-sale she goes on the receipt, else her page opens.
  $('#custFields')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-cust-del]')) return deleteCustomer();
    const id = e.target.closest('[data-open-cust]')?.dataset.openCust;
    if (!id) return;
    leaveCustomerEdit(() => {
      closeCustomerEditModal();
      if (state.customerEditFromSale) { state.customerEditFromSale = false; selectCustomer(id); } else { state.selectedCustomerId = id; switchView('customers'); }
    });
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
      onConfirm: () => {
        track('cart_clear', { lines: state.cart.length, subtotal: cartTotals().subtotal });
        if (state.exchange) { state.cart = []; renderCart(); return showDone('Cart cleared'); }   // the exchange stays; ✕ leaves it
        clearCart();
        showDone('Cart cleared');
      }
    });
  }
  $('#cartMoreBtn').addEventListener('click', (e) => {
    const empty = state.cart.length === 0;
    // phone: the order ⋯'s half sheet (openActionSheet) in place of the pop-up, which sat over the lines (owner 2026-10-26)
    const show = matchMedia('(max-width: 720px)').matches ? (b, items) => openActionSheet(b, 'Sale', items) : (b, items) => openMenu(b, items, { w: 200, right: true });
    show(e.currentTarget, [
      { label: state.orderNote ? 'Edit note' : 'Add note', run: openOrderNote, off: empty },
      // A saved cart / quote is a draft beside the orders (pos-checkout saveDraft); an exchange can't be parked.
      { label: 'Save cart', run: () => openSaveReceiptModal('saved'), off: empty || !!state.exchange },
      { label: 'Print quote', run: () => openSaveReceiptModal('quote'), off: empty || !!state.exchange },
      { label: 'Lost sale', run: () => openLostSale(), off: !!state.exchange }, '-',
      { label: 'Clear sale', run: confirmClearCart, red: true, off: empty },
    ]);
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
      askLeave(lostSaleChanged(), closeModals);   // only Lost sale asks (owner 2026-10-22); it is shut for the rest
    });
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => {
      if (e.target !== bd || (bd.id === 'pinModal' && pinAsk?.signIn)) return;
      askLeave(bd.id === 'lostSaleModal' && lostSaleChanged(), () => { bd.hidden = true; });
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (peekOpen()) return closePeek();
      if (againId && !es) return closeAgain();   // the shaded cart (openAgain)
      if (!$('#pinModal').hidden) { if (!pinAsk?.signIn) $('#pinModal').hidden = true; return; }
      // a form with changes only asks; the rest stays until Leave (owner 2026-10-22)
      if (customerEditChanged()) return leaveCustomerEdit();
      if (lostSaleChanged()) return askLeave(true, closeModals);
      const map = !$('#deliveryMapModal').hidden;   // Esc over the map closes the map, the sheet stays
      const list = $('#variantSheet').classList.contains('open');   // Esc over the customer list closes the list, the cart page stays
      const cust = $('#customerEditModal').classList.contains('open');   // and over New customer, the same
      closeBarcodeScanner();
      closeCustomerEditModal();
      closeModals();
      closeVariantSheet();
      closeShiftSheet();
      if (!map && !es && !list && !cust) $('#app').classList.remove('ph-cart');   // phone: Esc with nothing over the cart closes it
      if (!map) closeEditSheet();
    }
  });

  // ---- Pay ----
  // An exchange in the cart (startExchange) finishes here; anything else goes to the checkout.
  const phCart = (on) => { on ? (closeVariantSheet(), hideToast()) : closeEditSheet(); $('#app').classList.toggle('ph-cart', on); };   // phone: the cart page; the variant sheet sits over it (z 98), so it closes on the way in
  $('#cartBar').addEventListener('click', () => { closeBarcodeScanner(); phCart(true); });   // also the scanner's summary: the camera goes, the cart comes
  $('#cartBack').addEventListener('click', () => phCart(false));
  // A big discount the sheet didn't ask about (items taken off since, a saved cart continued) is asked here (discountOk).
  const toPay = () => (state.exchange ? confirmExchange() : openPaymentModal());
  $('#payBtn').addEventListener('click', () => { if (againId) return againMake(); if (closeEditSheet() !== false && !confirmSheet && discountOk(null, toPay)) toPay(); });

  // Payment-method selection
  function selectPayMethod(method, label = '') {
    state.paymentMethod = method;
    state.paymentLabel = label;
    state.paymentMethodChosen = true;
    // A custom card fills the Other name itself, so completeSale records it unchanged.
    $('#otherMethodInput').value = method === 'other' ? label : '';
    $('#payRefInput').value = '';
    $('#checkoutTender').value = '';
    track('payment_method', { method });
    showPayStep();
    if (method === 'other' && !label) setTimeout(() => $('#otherMethodInput')?.focus(), 60);
  }
  // Delegated: the tiles are rebuilt from settings on every checkout render.
  $('#checkoutMethods')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-co-method]');
    if (!card) return;
    if (SP) { const key = spKeyOf(card); SP.leg = SP.legs.find(l => l.key === key) || { key, label: card.querySelector('span').textContent.trim() }; return spAmt(); }   // split: this method's how-much page
    if (card.dataset.method === 'split') return spOpen();
    selectPayMethod(card.dataset.method, card.dataset.label || '');
  });

  // Back: a method's detail -> the method tiles; the tiles -> the cart.
  $('#checkoutCancelBtn')?.addEventListener('click', () => {
    if ($('#checkoutApp').classList.contains('is-done')) return;
    if (SP) spBack();   // split: one page back
    else if (cashOk) showPayStep();   // Cash's ask step -> the amounts
    else if (qrDone && qrDone === keyNow()) { qrDone = ''; showPayStep(); }   // the step after a picture -> the picture
    else if (state.paymentMethod === 'cash' && !$('#checkoutKeyIn').hidden) showCashKeys(false);   // the keys -> the quick amounts
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
  const cashKey = (k) => {
    if (SP) return spKey(k);
    const t = $('#checkoutTender');
    t.value = esPress(t.value, k, true, CASH_MAX);
    updateChange();
  };
  $('#checkoutKeys')?.addEventListener('click', (e) => { const b = e.target.closest('[data-sk]'); if (b) cashKey(b.dataset.sk); });
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'checkout' || $('#checkoutKeyIn').hidden || $('[data-step="cash"]').hidden || $('#checkoutApp').classList.contains('is-done') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[\d.]$|^Backspace$|^Enter$/.test(e.key)) return;
    e.preventDefault();   // Enter on a focused key would press it again
    if (e.key === 'Enter') { if (!$('#checkoutCompleteBtn').disabled) (SP ? spNext : completeSale)(); }
    else cashKey(e.key === 'Backspace' ? 'del' : e.key);
  });
  // Complete sale / Done, by tap or Enter: Must fill in with the box empty says what's missing and focuses it
  const finish = () => {
    if (mustWait()) { showToast(`Enter the ${askLow()} first`); return $('#payRefInput').focus(); }
    (SP ? spNext : completeSale)();
  };
  $('#otherMethodInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
  $('#payRefInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) finish(); });
  $('#payRefInput').addEventListener('input', (e) => { if (!e.target.value.trim()) e.target.value = ''; mustBtn(); });   // spaces alone: the box stays empty, "(required)" stays
  $('#qrDoneBtn').addEventListener('click', () => { if (SP) return spAsk(SP.leg); qrDone = keyNow(); showPayStep(); });
  // A cash amount is the decision: the tap finishes the sale.
  $('#checkoutQuick')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-co-custom]')) return SP ? spGo('typed') : showCashKeys(true);
    const b = e.target.closest('[data-co-cash]');
    if (!b) return;
    if (SP) { Object.assign(SP.leg, { given: moneyValue(+b.dataset.coCash), change: moneyValue(+b.dataset.coCash - SP.leg.amount) }); return completeSale(); }   // split: the cash part, handed over
    $('#checkoutTender').value = b.dataset.coCash;
    updateChange();
    completeSale();
  });
  $('#checkoutSteps')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-complete]')) finish();
  });
  window.addEventListener('resize', fitCheckout);
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
  $('#settingsView')?.addEventListener('click', (e) => {   // a choice row opens its page of ticks
    const b = e.target.closest('[data-pick]');
    if (b) openPick(b.dataset.pick);
  });
  $('#posPrintOnSale')?.addEventListener('change', persistPosSettings);
  $('#posPrintCut')?.addEventListener('change', persistPosSettings);
  $('#sellRows').addEventListener('change', (e) => setSellLayout(e.target.checked ? 'rows' : 'list'));
  $('#posPrintMap')?.addEventListener('change', persistPosSettings);
  $('#posPrinterIp')?.addEventListener('change', () => { persistPosSettings(); renderPrinterList(); refreshPrinterStatus(); });   // the list above shows the typed printer
  $('#posTimeZone')?.addEventListener('change', persistPosSettings);
  $('#posBtPairBtn')?.addEventListener('click', async () => {
    try {
      const dev = await window.HWPOS_PRINTER.pairBluetooth();
      state.settings.printing = { ...printerConfig(), btName: dev.name, btId: dev.id };
      saveSettings();
      renderPosSettings();
      showDone('Paired ' + dev.name);
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
  bindPayTypes();   // Settings › Payment types (pos-settings.js)
  bindFulTypes();   // Settings › Fulfilment types (pos-settings.js)
  bindQr();   // QR codes (pos-qr.js)
  bindPick();   // Settings › one choice's page
  $('#posLogOutBtn')?.addEventListener('click', logOut);
  $('#signInForm')?.addEventListener('submit', (e) => { e.preventDefault(); signInCover(false); if (tillPins()) lockTill(); });
  $('#posTestPrintBtn')?.addEventListener('click', () => {
    persistPosSettings();
    printOrder(sampleTestOrder());
  });
  $('#posTestDrawerBtn')?.addEventListener('click', () => {
    persistPosSettings();
    Promise.resolve().then(() => HWPOS_DRAWER.open(printerConfig())).then(showDone, (e) => showToast(e.message));
  });

  window.addEventListener('online', () => track('online'));
  window.addEventListener('offline', () => track('offline'));
}

// ---------- Init ----------
function init() {
  setAppViewportHeight();
  // A sale that IndexedDB refused is kept in localStorage instead (data-store.js); say so once.
  window.HWPOS_STORE?.events.on('save:failed', () => showToast('Sales did not save on this POS. Call support before closing.'));
  state.folders = loadFolders();
  // Ensure "all" exists
  if (!state.folders.find(f => f.id === 'all')) {
    state.folders.unshift({ id: 'all', name: 'All items', builtin: true });
  }
  state.settings = loadSettings();
  // A brand-new store (nothing saved yet) is asked its type on first open (askBizType); a store with data keeps Retail.
  if (!state.settings.store?.businessType && ![STORAGE_SETTINGS, STORAGE_PRODUCTS, STORAGE_ORDERS].some(k => storageGet(k) != null)) HWPOS_STORE.ui.set('askBiz', 1);
  state.products = loadProducts();
  state.groups = loadGroups();
  state.orders = loadOrders();
  document.querySelectorAll('.cur-sym').forEach(e => { e.textContent = SalesMath.currencySymbol(state.settings.store?.currency); });
  migrateCustomers();   // once: stored balances become opening rows (bo-model)
  seedLabExtras();
  if (state.settings.store?.businessType === 'food') seedFoodDemo();   // lab only: the milk tea demo, once
  state.fulfilment = state.settings.defaultFulfilment || 'walkin';
  seedLabDays();   // lab only: a new device opens on two months of days
  restoreCart();   // the sale that was open when the POS reloaded
  // Apply saved theme
  paintTheme();
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
  renderSellSwitch();
  renderProducts();
  renderCart();
  updateCustomerButton();
  applyRoleGating();
  renderRoleSwitcher();
  closeDays();   // a new day's first load makes the past days' Z (pos-shift.js)
  renderSyncMark();
  setInterval(renderSyncMark, 30000);   // "2 min ago" keeps moving while the ☰ is open
  $('#syncMark')?.addEventListener('click', (e) => { e.stopPropagation(); showToast(e.currentTarget.title); });   // not the row's lock
  attachEvents();
  track('app_open');
  // ponytail: lab only. ?pins gives the demo staff real PINs (1111 owner, 2222 manager, 3333 and 4444 cashiers)
  if (new URLSearchParams(location.search).has('pins')) saveStaff(loadStaff().map((u, i) => ({ ...u, pin: String(i + 1).repeat(4) })));
  initQuickStock();   // before the lock, so a resumed draft is under it
  if (tillPins()) lockTill();
  const openHashView = () => {
    const hash = (location.hash || '').replace('#', '').trim();
    const target = hash.split(/[/?&:]/)[0];
    const valid = ['sell', 'orders', 'items', 'customers', 'shift', 'reports'];
    if (valid.includes(target) && canAccess(target)) switchView(target);
  };
  openHashView();
  window.addEventListener('hashchange', openHashView);
  if (HWPOS_STORE.ui.get('askBiz') === '1' && !state.settings.store?.businessType) askBizType();
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
      paintTheme();
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
  setInterval(() => { reportsLive(); shiftLive(); }, 4000);

  // Reports (pos-customers.js): Day | Week | Month picks the period; the pinned bar's ‹ › and a swipe on the chart step through
  // it (a swipe right goes back, like turning a page back), a date or Show Today comes back to now. Tap or drag along the
  // bars for a number; a day's tip, a second tap on its bar, or a calendar day opens that day.
  $('#reportsUnits')?.addEventListener('click', (e) => { const b = e.target.closest('[data-unit]'); if (b && b.dataset.unit !== reportsView.unit) reportsGo(b.dataset.unit, 0); });
  new ResizeObserver(([e]) => e.target.classList.remove('slid')).observe($('#reportsUnits'));   // tabs moved: the pill re-places on the next switch
  wireSegDrag($('#reportsUnits'), 'unit');   // press the pill and slide it, as iOS's
  const rpBody = $('#reportsBody'), rpDay = () => reportsView.bars[reportsView.pick]?.day;
  // rpWas = the pick before this touch: a day opens only on a finished tap (a scroll never clicks) on a bar already
  // picked or its tip -- a first tap whose click lands on the new tip doesn't
  let rpScrub = false, rpWas = null, rpSw = null;
  $('.view-reports .c-scroll')?.addEventListener('scroll', reportsPin, { passive: true });
  rpBody?.closest('.page').addEventListener('click', (e) => {   // the page, so the header's pinned bar and Show Today come here too
    const s = e.target.closest('[data-rp]:not(:disabled)'), cc = e.target.closest('.rp-cc:not(:disabled)'), hit = e.target.closest('.rp-tip.go, .rp-bars [data-i]');
    if (s) reportsGo(reportsView.unit, reportsView.back - s.dataset.rp, +s.dataset.rp);
    else if (e.target.closest('.rp-pl, .rp-now')) { if (reportsView.back) reportsGo(reportsView.unit, 0, 1); }
    else if (cc) reportsOpenDay(reportsView.bars[cc.dataset.i].day);
    else if (hit && rpWas != null && rpWas === reportsView.pick && rpDay() && (hit.matches('.rp-tip') || +hit.dataset.i === rpWas)) reportsOpenDay(rpDay());
    else if (!e.target.closest('.rp-bars')) reportsPick(null);   // a mouse drag along the bars ends in a click on them
  });
  // A finger on the chart swipes (Screen Time's, owner 2026-10-16): only the chart follows it, the next period's chart
  // beside it; let go past ~50px (or flicked) and it snaps there, then the rest of the page changes. The chart is the
  // swipe's zone: the first few px decide -- steeper than 60° is the page's scroll, anything flatter (a diagonal too) is
  // the swipe and the page holds still. A finger held still on a bar for a moment drags along the bars; a mouse always does.
  const RP_GAP = 20, RP_SNAP = 50;   // between the two charts mid-swipe; how far a drag must go to snap over
  rpBody?.addEventListener('pointerdown', (e) => {
    if (rpSw?.end) rpSw.settle();   // a touch on a chart still sliding lands it now (owner 2026-10-29: no wait)
    rpWas = reportsView.pick;
    const b = e.target.closest('.rp-bars [data-i]'), bar = b && !b.disabled;
    if (bar) reportsPick(+b.dataset.i);
    if (e.pointerType === 'mouse') { rpScrub = bar; return; }
    if (!e.isPrimary || !e.target.closest('.rp-chart')) return;
    rpSw = { x: e.clientX, y: e.clientY, dx: 0, pts: [{ t: e.timeStamp, dx: 0 }], hold: bar && setTimeout(() => { if (rpSw && !rpSw.on) { rpScrub = true; rpSw = null; } }, 250) };
  });
  // the first 4px of a move: the page's (steep) or the swipe's (lock); touchmove and pointermove both ask, whichever is first
  const rpLock = (dx, dy) => {
    if (rpSw.lock != null || Math.abs(dx) + Math.abs(dy) < 4) return;
    rpSw.lock = Math.abs(dy) <= Math.abs(dx) * 1.73;
    if (!rpSw.lock) { clearTimeout(rpSw.hold); rpSw = null; }
  };
  rpBody?.addEventListener('touchmove', (e) => {
    if (rpSw && !rpSw.end) rpLock(e.touches[0].clientX - rpSw.x, e.touches[0].clientY - rpSw.y);
    if (rpScrub || rpSw?.lock) e.preventDefault();   // the page stays put under a swipe or a drag along the bars
  }, { passive: false });
  const rpSwipeStart = () => {
    const ch = rpBody.querySelector('.rp-chart'), sl = ch.firstElementChild, near = d => `<div class="rp-near" style="left:calc(${d * 100}% + ${d * RP_GAP}px)">${reportsNear(d)}</div>`;
    reportsPick(null);
    ch.classList.add('swiping');
    sl.insertAdjacentHTML('beforeend', near(-1) + (reportsView.back ? near(1) : ''));
    Object.assign(rpSw, { on: true, sl, w: ch.clientWidth + RP_GAP });
  };
  const rpSwipeEnd = (go) => {
    const s = rpSw, dir = go && (s.dx > 0 ? -1 : 1);   // −1 earlier, +1 later
    s.end = true;
    s.sl.style.transition = 'transform .3s var(--rl-ease)';
    s.sl.style.transform = `translateX(${-dir * s.w}px)`;
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      rpSw = null;
      if (dir) reportsGo(reportsView.unit, reportsView.back - dir, 'still');
      else { s.sl.removeAttribute('style'); s.sl.ontransitionend = null; s.sl.querySelectorAll('.rp-near').forEach(n => n.remove()); s.sl.parentNode.classList.remove('swiping'); }
    };
    s.settle = settle;
    s.sl.ontransitionend = (e) => e.target === s.sl && settle();   // its own slide only: the bars' fade back (a tip was up) bubbles here too and cut the glide short
    setTimeout(settle, 360);   // no transitionend when it was already there
  };
  // the bar under the finger by x alone: the tip and the day names sit over and under the bars
  addEventListener('pointermove', (e) => {
    const b = rpScrub && [...rpBody.querySelectorAll('.rp-bars [data-i]')].find(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; });
    if (b && !b.disabled && +b.dataset.i !== reportsView.pick) reportsPick(+b.dataset.i);
    if (!rpSw || rpSw.end || !e.isPrimary) return;
    const dx = e.clientX - rpSw.x;
    rpLock(dx, e.clientY - rpSw.y);
    if (!rpSw?.lock) return;
    if (!rpSw.on) {
      if (Math.abs(dx) < 6) return;   // a held finger's wobble stays a hold
      clearTimeout(rpSw.hold);
      rpSwipeStart();
    }
    rpSw.dx = dx;
    rpSw.pts = [...rpSw.pts.filter(p => e.timeStamp - p.t < 100), { t: e.timeStamp, dx }];   // the flick's speed: the last 100ms
    rpSw.sl.style.transform = `translateX(${dx < 0 && !reportsView.back ? 0 : dx}px)`;   // nothing later than now: the chart stays put (owner 2026-10-16: no blank gap)
  });
  addEventListener('pointerup', (e) => {
    rpScrub = false;
    if (!rpSw || rpSw.end || !e.isPrimary) return;
    clearTimeout(rpSw.hold);
    if (!rpSw.on) { rpSw = null; return; }
    const { dx, pts } = rpSw, p = pts[0], v = p && e.timeStamp > p.t ? (dx - p.dx) / (e.timeStamp - p.t) : 0;   // px/ms
    rpSwipeEnd((dx > 0 || reportsView.back) && (Math.abs(dx) > RP_SNAP || (Math.abs(v) > .2 && Math.sign(v) === Math.sign(dx))));
  });
  addEventListener('pointercancel', () => { rpScrub = false; if (rpSw?.on && !rpSw.end) rpSwipeEnd(false); else if (rpSw && !rpSw.end) { clearTimeout(rpSw.hold); rpSw = null; } });
  // ponytail: lab only. ?price-ask opens the ask-the-price screen on the first item to look at it; nothing is saved
  if (new URLSearchParams(location.search).has('price-ask')) openEditSheet('price', state.products[0].id);
}

// First open (owner 2026-10-24): "What do you sell?", the Settings › Business type choices, nothing else on the card.
// A pick runs Settings' own setter (Food loads its demo) and the card never comes back; Settings changes it later.
function askBizType() {
  const pk = SETTING_PICKS.bizType, veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<div class="pay-sheet cf-sheet" role="dialog" aria-modal="true" aria-labelledby="bizAskTitle">
    <div class="ph"><b id="bizAskTitle">What do you sell?</b><div class="cf-msg">You can change this later in Settings.</div></div>
    <div class="pb even">${pk.opts.map(([v, label]) => `<button type="button" class="secondary-btn small cta-2" data-v="${v}">${escapeHtml(label)}</button>`).join('')}</div>
  </div>`;
  const f = veil.firstChild;
  f.style.width = Math.min(340, innerWidth - 24) + 'px';
  document.body.append(veil);
  const shrink = centreSheet(f);
  $('#app').inert = true;   // like the PIN screen's cover: no Tab or tap reaches the POS behind until they pick
  f.tabIndex = -1;   // the card takes focus, not a choice: neither is picked for them
  f.focus({ preventScroll: true });
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    HWPOS_STORE.ui.set('askBiz', 0);
    $('#app').inert = false;
    pk.set(b.dataset.v);
    veil.style.pointerEvents = 'none';
    shrink(() => veil.remove());
  });
}
// ponytail: lab only. A new device opens on two months of a store's days (owner 2026-10-15: the link on a phone showed
// nothing): sales through the real order builder (some to the customers), a few refunds and voids, a shift a day with
// petty cash, counted at close; closeDays then makes the Zs. Once per device; the sales don't move stock.
// ponytail: lab only -- the long paint list (pt106+) and the extra customers (data.js) onto a POS that saved its data
// before them (2026-10-20); once a device, so ones deleted afterwards stay deleted. Drop with the seed.
function seedLabExtras() {
  if (HWPOS_STORE.ui.get('labExtras') || HWPOS_STORE.pending?.()) return;
  HWPOS_STORE.ui.set('labExtras', 1);
  const have = new Set(state.products.map(p => p.id));
  const add = PRODUCTS.filter(p => /^pt\d+$/.test(p.id) && +p.id.slice(2) >= 106 && !have.has(p.id)).map(p => ({ ...p }));
  if (add.length) {
    appendMovements(openingRows(add, loadMovements()));   // stock is the log's sum: give them their opening count
    state.products.push(...add);
    saveProducts();
    withStock(state.products);
  }
  const cs = loadList(STORAGE_CUSTOMERS), ids = new Set(cs.map(c => c.id));
  const newC = CUSTOMERS.filter(c => !ids.has(c.id));
  if (cs.length && newC.length) saveList(STORAGE_CUSTOMERS, cs.concat(newC.map(c => stampRow(normalizeCustomer(c)))));
}
// ponytail: lab only -- Business type Food gets a milk tea demo, once a device (plans/modifiers-build.md): five teas in
// Medium / Large asking Sweetness, Ice and Toppings. Deleted afterwards stays deleted. Drop with the seed.
function seedFoodDemo() {
  if (HWPOS_STORE.ui.get('seedFood')) return;
  HWPOS_STORE.ui.set('seedFood', 1);
  const opts = list => list.map(([name, price = 0]) => ({ id: newId(), name, price }));
  const mods = [['Sweetness', 'one', opts([['0%'], ['25%'], ['50%'], ['75%'], ['100%']])], ['Ice', 'one', opts([['No ice'], ['Less'], ['Normal']])],
    ['Toppings', 'upto3', opts([['Pearls', 15], ['Nata', 15], ['Pudding', 20]])]].map(([name, picks, options]) => stampRow(normalizeModifier({ id: newId(), name, picks, options })));
  saveModifiers(loadModifiers().concat(mods));
  let cat = state.folders.find(f => f.name === 'Milk tea');
  if (!cat) { cat = stampRow({ id: newId(), name: 'Milk tea', builtin: false }); state.folders.push(cat); writeJsonStorage(STORAGE_FOLDERS, state.folders); }
  [['Brown Sugar Milk Tea', 140], ['Matcha Latte', 150], ['Okinawa Milk Tea', 140], ['Wintermelon Milk Tea', 130], ['Taro Milk Tea', 140]].forEach(([name, price]) => {
    const g = stampRow({ id: newId(), name, folder: cat.id });
    state.groups.push(g);
    [['Medium', price], ['Large', price + 20]].forEach(([size, pr]) => state.products.push(stampRow(normalizeProduct({ id: newId(), name: `${name} ${size}`,
      price: pr, cost: round2(pr * 0.35), unit: 'pc', groupId: g.id, folder: cat.id, folders: [cat.id], trackStock: false, modifierIds: mods.map(m => m.id) }))));
  });
  saveGroups(); saveProducts();
}
function seedLabDays() {
  if (HWPOS_STORE.ui.get('labSeed')) return;
  HWPOS_STORE.ui.set('labSeed', 1);
  const goods = state.products.filter(p => onTill(p) && p.price > 0), staff = loadStaff().filter(u => u.active);
  if (!goods.length || !staff.length) return;
  const custs = allCustomerRecords().slice(0, 6), now = Date.now(), today = tillDay(now), hr = 36e5, min = 6e4;
  const r = n => Math.floor(Math.random() * n), pick = a => a[r(a.length)];
  const was = { cart: state.cart, customer: state.customer }, ev = [], shifts = [];
  for (let back = 59; back >= 0; back--) {
    const day = SalesMath.addDays(today, -back), at = SalesMath.dayStartMs(day, tillZone(), 0);
    if (at + 8.5 * hr > now) break;
    const who = staff[back % staff.length], who2 = staff[(back + 1) % staff.length], last = Math.min(at + 19.75 * hr, now - 5 * min);
    shifts.push({ day, at, who });
    const wd = new Date(at + 12 * hr).getUTCDay(), n = 10 + r(8) + (wd === 6 ? 5 : wd === 0 ? -4 : 0);
    for (let i = 0; i < n; i++) {
      const ts = at + 8.25 * hr + r(last - at - 8.25 * hr), sale = { ts, by: ts < at + 14 * hr ? who : who2 };
      ev.push(sale);
      if (!r(70) && back > 1) ev.push({ ts: ts + (1 + r(2)) * 24 * hr, by: who, back: sale, kind: 'refund', reason: pick(['Damaged item', 'Wrong size', 'Changed mind']) });
      else if (!r(80)) ev.push({ ts: ts + (2 + r(8)) * min, by: sale.by, back: sale, kind: 'void', reason: 'Wrong item rung' });
    }
  }
  const orders = [];
  for (const e of ev.filter(e => e.ts < now).sort((a, b) => a.ts - b.ts)) {
    const extra = { ts: e.ts, cashier: e.by.name, staffId: e.by.id };
    if (e.back) {   // as reverseSale writes it: the lines that came back, the money back the way it came
      const o = e.back.o, { part } = refundPlan(o, null, []);
      orders.push(normalizeOrderRecord({ ...o, ...part, ...extra, cartDiscount: null, id: newId(), number: nextOrderNumber(), status: e.kind,
        originalOrderId: o.id, reason: e.reason, register: o.register, tendered: 0, change: 0, payments: part.payments.map(p => ({ ...p, tendered: 0, change: 0, ref: o.number })) }));
      continue;
    }
    state.cart = [...new Set(Array.from({ length: 1 + r(4) }, () => pick(goods)))]
      .map(p => ({ id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit, price: p.price, qty: 1 + (r(4) ? r(3) : r(10)) }));
    state.customer = custs.length && !r(5) ? pick(custs) : null;
    const total = cartTotals().total, method = pick(['cash', 'cash', 'cash', 'cash', 'gcash', 'gcash', 'qr']);
    const tendered = method === 'cash' ? Math.ceil(total / 100) * 100 : total;
    e.o = normalizeOrderRecord({ ...buildOrderRecord({ paymentMethod: method, tendered, change: moneyValue(tendered - total) }), ...extra });
    orders.push(e.o);
  }
  Object.assign(state, was);
  orders.forEach(stampRow);
  saveOrdersList([...readJsonStorage(STORAGE_ORDERS, []), ...orders.reverse()]);   // newest first, under the device's own
  state.orders = loadOrders();
  // A shift a day: 2,000 to start, some petty cash, counted at 8 PM (mostly even); today's stays open.
  const as = (who, ts) => ({ staff: who.name, staffId: who.id, ts });
  for (const { at, who } of shifts) {
    addShiftRow('shift_open', null, 2000, { cutoff: state.settings.autoClose, ...as(who, at + 8 * hr - r(15) * min) });
    if (!r(3)) addShiftRow('cash_move', null, -pick([50, 80, 120, 150, 200, 350]), { note: pick(['Ice', 'Lunch', 'Delivery fee', 'Cleaning supplies']), ...as(who, at + (10 + r(8)) * hr) });
    if (!r(10)) addShiftRow('cash_move', null, 1000, { note: 'Change from bank', ...as(who, at + 9 * hr) });
  }
  for (const s of storeShifts()) {
    const day = shifts.find(x => x.at <= s.open.ts && s.open.ts < x.at + 24 * hr);
    if (!day || day.day === today || s.close) continue;
    const counted = unc(cent(shiftFigures(s).expected) + cent(pick([0, 0, 0, 0, 0, 0, -20, 10, -5, -50])));
    addShiftRow('shift_close', s.open.id, counted, { counts: [counted], ...as(day.who, day.at + 20 * hr + r(20) * min) });
  }
}
// The phone browser's strip behind the clock takes the colour of the page under it, as devices-all.html's frame does: Safari
// tints it from theme-color or the root's background. ponytail: polled, as the frame does; every page and sheet changes it
const themeMeta = document.querySelector('meta[name=theme-color]');
setInterval(() => {
  let e = document.elementFromPoint(innerWidth / 2, 1), bg = '';
  for (; e && !bg; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)$|transparent/.test(c)) bg = c; }
  if (bg && themeMeta.content !== bg) { themeMeta.content = bg; document.documentElement.style.backgroundColor = bg; }
}, 300);
// Sales live in IndexedDB: open it before the first read (data-store.js ready()).
document.addEventListener('DOMContentLoaded', () => (window.HWPOS_STORE?.ready?.() || Promise.resolve()).then(init));
