// Till › Sell: the item grid, variant picker, cart and barcode scanner, the cart sidebar (line and
// cart discounts, fulfilment, delivery map, customer) and the lost-sale pop-up.

// ---------- Sell view ----------
function renderSellHeader() {
  const folder = state.folders.find(f => f.id === 'all');
  const t = $('#sellTitle'); if (t) t.textContent = folder ? folder.name : 'All items';
  const c = $('#sellCount');
  if (c) {
    const count = getFilteredSellProducts().length;
    c.textContent = SalesMath.plural(count, 'item');
  }
}

function getFilteredSellProducts() {
  let list = state.products.filter(onTill);
  if (state.query.trim()) {
    // The index holds copies made at load; map each hit to the live row so stock (tile marks) is current.
    list = state.fuse.search(state.query.trim()).map(r => state.products.find(p => p.id === r.item.id)).filter(Boolean);
  }
  if (searchIntent && state.query.trim()) searchIntent.results = list.length;   // the count the cashier saw
  return list;
}

// What the Sell grid actually renders: group tiles + loose products.
// Returns an array of "cells" — each cell is { kind: 'group'|'product', ... }
function getSellCells() {
  const baseProducts = getFilteredSellProducts();
  const cells = [];
  const seenGroups = new Set();
  // Determine which groups have at least one product in the filtered set.
  baseProducts.forEach(p => { if (p.groupId) seenGroups.add(p.groupId); });
  // Render group tiles in the order they appear in state.groups.
  state.groups.forEach(g => {
    if (!seenGroups.has(g.id)) return;
    const memberCount = baseProducts.filter(p => p.groupId === g.id).length;
    cells.push({ kind: 'group', group: g, memberCount });
  });
  // Then ungrouped products from the filtered set, in original order.
  baseProducts.forEach(p => {
    if (!p.groupId) cells.push({ kind: 'product', product: p });
  });
  return cells;
}

function getSellGridProfile() {
  const catalog = $('.catalog');
  const width = catalog?.clientWidth || window.innerWidth || 1200;
  const viewport = window.innerWidth || width;
  if (viewport > 720) {   // Loyverse-style fixed grid per size, the panel takes the rest
    const row = $('.content-row'), rs = getComputedStyle(row), cs = getComputedStyle(catalog), gap = 8, catX = parseFloat(cs.paddingLeft);
    const h = catalog.clientHeight - $('#catalogSearchRow').offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.rowGap);
    const w = row.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight) - parseFloat(rs.columnGap) - 2 * catX;   // tiles + panel
    const grids = { sm: [6, 5], md: [5, 4], lg: [4, 3] }, [cols, landRows] = grids[state.tileSize] || grids.md;   // = ITEMS_PER_PAGE 30 / 20 / 12
    const portrait = innerHeight > innerWidth, columns = portrait ? cols - 2 : cols;   // portrait is too narrow for 5 across
    const panel = Math.max(340, innerWidth * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-vw')) || 26.5) / 100);   // 26.5%: Android 11" (1280) lands on 340
    const widest = (w - panel - gap * (columns - 1)) / columns;
    const rows = Math.max(portrait ? 2 : landRows, Math.round((h + gap) / (widest + gap)));   // the rows fill the height, as many as keep tiles nearest square: squarer screens (4:3 iPads) get 5x5
    const size = portrait || rows > landRows ? widest : Math.min(widest, (h - gap * (rows - 1)) / rows);   // wide screens: square, the panel takes the rest. Extra rows keep the panel, so a switch moves nothing but the row count
    row.style.setProperty('--cat-w', `${columns * size + (columns - 1) * gap + 2 * catX}px`);
    return { columns, rows };
  }
  // phone: Loyverse-style square tiles, 3 across (S 4, L 2); as many rows as keep them nearest square
  const columns = { sm: 4, md: 3, lg: 2 }[state.tileSize] || 3, gap = 8, cs = getComputedStyle(catalog);
  const h = catalog.clientHeight - $('#catalogSearchRow').offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.rowGap);
  const size = (width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (columns - 1)) / columns;
  return { columns, rows: Math.max(2, Math.round((h + gap) / (size + gap))) };
}

function sellPageSize(profile = getSellGridProfile()) {
  return Math.max(1, profile.columns * profile.rows);
}

function totalPages(cells = getSellCells()) {
  return Math.max(1, Math.ceil(cells.length / sellPageSize()));
}

function clampPage(cells = getSellCells()) {
  const max = totalPages(cells);
  if (state.page > max) state.page = max;
  if (state.page < 1) state.page = 1;
}

function renderSellCellHtml(cell) {
  if (cell.kind === 'group') {
    const g = cell.group;
    return `
      <div class="product-card pc-group" data-group-id="${g.id}" title="${escapeHtml(g.name)}">
        <div class="pc-group-badge">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
          <span>${cell.memberCount}</span>
        </div>
        <div class="pc-name">${escapeHtml(g.name)}</div>${tileLine(groupMembers(g.id))}
      </div>`;
  }
  const p = cell.product;
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="pc-name">${escapeHtml(p.name)}</div>${tileLine([p])}
    </div>`;
}
// Settings › Tiles show is the two keys there already were: showPrice (shared with the back office's switch) and this
// till's tileStock. Stock wins when both are on, so the back office turning price on can't hide this till's counts.
function setTileShow(v) {
  if (v !== 'stock') {   // Stock wins anyway: picking it leaves the shared price key alone for the back office and the other tills
    state.showPrice = v === 'price';
    storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
  }
  state.tileStock = v === 'stock';
  HWPOS_STORE.ui.set('tileStock', state.tileStock ? '1' : '0');
  renderProducts();
}
// Settings › Tiles show (owner 2026-10-08): the one small line under the name, the same for an item and a variant
// group. Price: the price, a group its range. Stock: the count (a group's total, the variant sheet splits it), in
// the warn colour when low (familyLevel, Items' own words), "Out" when out; nothing when untracked.
const tileUnit = (n, u = 'pc') => /^(pc|bag|roll|pair|box|set|pack)$/.test(u) ? SalesMath.pluralWord(n, u, u === 'box' ? 'boxes' : u + 's') : u;
function tileLine(ps) {
  if (state.tileStock) {
    const counted = ps.filter(m => m.trackStock !== false);
    if (!counted.length) return '';
    const lv = familyLevel(counted), n = counted.reduce((s, m) => s + Math.max(0, toNumber(m.stock, 0)), 0);
    const u = counted.every(m => (m.unit || 'pc') === (counted[0].unit || 'pc')) ? ' ' + tileUnit(n, counted[0].unit || 'pc') : '';
    return `<div class="pc-price-mini${lv === 'out' || lv === 'low' ? ' ' + lv : ''}">${lv === 'out' ? 'Out' : SalesMath.qtyText(n) + u}</div>`;
  }
  if (!state.showPrice || !ps.length) return '';
  const lo = Math.min(...ps.map(m => toNumber(m.price, 0))), hi = Math.max(...ps.map(m => toNumber(m.price, 0)));
  return `<div class="pc-price-mini">${lo === hi ? peso(lo) : `<span class="from">from </span>${peso(lo)}<span class="hi">–${peso(hi)}</span>`}</div>`;   // the Items list's range (itemPriceText)
}

function updateProductTrackPosition() {
  const track = $('#productTrack');
  if (track) {
    const grid = $('#productGrid');
    const gap = grid ? (parseFloat(getComputedStyle(track).gap) || 0) : 0;
    const step = (grid ? grid.clientWidth : 0) + gap;
    track.style.transform = `translate3d(-${(state.page - 1) * step}px, 0, 0)`;
  }
  renderSellHeader();
}

function renderProducts() {
  const grid = $('#productGrid');
  const cells = getSellCells();
  const profile = getSellGridProfile();

  // Set size + price-display attrs on the grid
  grid.dataset.size = state.tileSize;
  grid.dataset.text = state.tileText;
  grid.style.setProperty('--grid-cols', profile.columns);
  grid.style.setProperty('--grid-rows', profile.rows);

  if (cells.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <svg class="nr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/>
        </svg>
        <div class="nr-title">No items found</div>
        <div class="nr-sub">Try a different keyword or pick another category</div>
        ${state.query.trim() ? `<button class="text-btn nr-lost" type="button" data-act="lost-sale">Log “${escapeHtml(state.query.trim())}” as a lost sale</button>` : ''}
      </div>`;
    renderSellHeader();
    requestAnimationFrame(syncSellGridMetrics);
    return;
  }

  clampPage(cells);
  const pageSize = sellPageSize(profile);
  const pages = [];
  for (let i = 0; i < cells.length; i += pageSize) {
    pages.push(cells.slice(i, i + pageSize));
  }

  grid.innerHTML = `
    <div class="product-page-track" id="productTrack">
      ${pages.map((pageCells, index) => `
        <div class="product-page" data-page="${index + 1}">
          ${pageCells.map(renderSellCellHtml).join('')}
        </div>`).join('')}
    </div>`;

  renderSellHeader();
  requestAnimationFrame(() => {
    syncSellGridMetrics();
    updateProductTrackPosition();
  });
}

function syncSellGridMetrics() {
  const catalog = $('.catalog');
  const grid = $('#productGrid');
  const search = $('#catalogSearchRow');
  if (!catalog || !grid || !search || state.view !== 'sell') return;

  const profile = getSellGridProfile();
  const gap = parseFloat(getComputedStyle(grid).getPropertyValue('--grid-gap')) || 6;   // the gap lives on .product-page; the grid only carries the variable
  const styles = getComputedStyle(catalog);
  const catalogRect = catalog.getBoundingClientRect();
  const searchRect = search.getBoundingClientRect();
  const paddingBottom = parseFloat(styles.paddingBottom || 0);
  const rowGap = parseFloat(styles.gap || 0);
  const measuredHeight = catalogRect.bottom - paddingBottom - searchRect.bottom - rowGap;
  const fallbackHeight = catalog.clientHeight - search.offsetHeight - parseFloat(styles.paddingTop || 0) - paddingBottom - rowGap;
  const rows = profile.rows;
  const columns = profile.columns;
  const available = Math.max(120, Math.floor(measuredHeight || fallbackHeight));
  const tileHeight = Math.max(1, (available - gap * (rows - 1)) / rows);
  // Tiles always fill the full column width so they align to the catalog edges
  const tileWidth = Math.max(1, (grid.clientWidth - gap * (columns - 1)) / columns);
  grid.style.setProperty('--grid-cols', profile.columns);
  grid.style.setProperty('--grid-rows', rows);
  grid.style.setProperty('--grid-h', `${available}px`);
  grid.style.setProperty('--tile-h', `${tileHeight.toFixed(2)}px`);
  grid.style.setProperty('--tile-w', `${tileWidth.toFixed(2)}px`);
  grid.style.setProperty('--visible-rows', rows);
}

// ---------- Variant sheet (Shopify POS): slides up over the grid, the cart stays in view ----------
function openVariantModal(groupId) {
  const g = groupById(groupId);
  if (!g) return;
  if (!groupMembers(g.id).length) { showToast('No variants in this group'); return; }
  state.variantModal = { groupId: g.id, query: '', available: false };
  openListSheet(g.name, 'Search variants', 'Price');
}
// The variant sheet is also the customer picker (openCustomerModal): same top row, same list
function openListSheet(title, placeholder, col) {
  $('#variantTitle').textContent = title;
  $('#variantCol').textContent = col;
  $('#variantSearch').value = '';
  $('#variantSearch').placeholder = placeholder;
  $('#variantSheet').setAttribute('aria-label', title);
  renderVariantList();
  $('#variantList').scrollTop = 0;
  $('#variantSheet').classList.add('open');
  $('#sidebarToggle').setAttribute('aria-label', 'Close');   // the menu button turns into the sheet's X (styles.css)
}

function closeVariantSheet() {
  $('#variantSheet')?.classList.remove('open');
  $('#sidebarToggle')?.setAttribute('aria-label', 'Menu');
}

function renderVariantList() {
  const vm = state.variantModal;
  if (vm.kind === 'cust') return renderCustomerSheet(vm);
  const members = groupMembers(vm.groupId);
  const q = vm.query.trim().toLowerCase();
  const words = members.map(p => p.name.split(' '));   // rows drop the words every variant shares: "White 1L", not "Latex Paint White 1L"
  let cut = 0;
  while (words.length > 1 && words.every(w => w.length > cut + 1 && w[cut] === words[0][cut])) cut++;
  const shown = members.filter(p => (!vm.available || p.stock > 0)
    && (!q || [p.name, p.sku, p.barcode].some(s => String(s || '').toLowerCase().includes(q))));
  $('#variantCount').textContent = `${shown.length} of ${members.length}`;
  const avail = $('#variantAvail');
  avail.hidden = members.every(p => p.stock > 0);   // nothing sold out = nothing to filter
  avail.classList.toggle('active', vm.available);
  avail.setAttribute('aria-pressed', String(vm.available));
  $('#variantList').innerHTML = shown.length ? shown.map(p => `
    <button type="button" class="vs-row" data-variant-id="${p.id}">
      <span class="nm">${escapeHtml(p.name.split(' ').slice(cut).join(' '))}<small>${p.stock > 0 ? `${roundQty(p, p.stock)} available` : '<b>Sold out</b>'}</small></span>
      <span class="amt num">${peso(p.price)}</span>
    </button>`).join('') : '<div class="vs-empty">No variants match</div>';
}

function changePage(delta) {
  const t = totalPages();
  const prev = state.page;
  state.page = Math.min(t, Math.max(1, state.page + delta));
  if (state.page !== prev) updateProductTrackPosition();
  else flashControl($('#productGrid'));
}

function setTileSize(size) {
  if (!ITEMS_PER_PAGE[size]) return;
  state.tileSize = size;
  state.page = 1;
  storageSet(STORAGE_TILE_SIZE, size);
  renderProducts();
}

function setTileText(size) {
  if (!TILE_TEXT_SIZES.includes(size)) return;
  state.tileText = size;
  storageSet(STORAGE_TILE_TEXT, size);
  renderProducts();
}

// ---------- Cart ----------
// Every quantity typed anywhere in the POS comes through here. `parseInt` used to live at
// each of these inputs, which sold 2 metres of the 2.5 the customer asked for; `roundQty`
// (bo-model.js) is the one definition of what a quantity may be for a given product, so the
// till and the back office can never disagree about it.
function productOf(item) { return state.products.find(p => p.id === (item.productId || item.id)); }

function qtyFrom(product, value, fallback = 1) {
  const n = roundQty(product, parseFloat(value));
  return n > 0 ? n : fallback;
}

// Stock on add (owner, 2026-10-07): every add -- tile, scan, search, variant (addToCart) and the edit sheet's quantity
// (esWrite) -- comes through here. `want`: what the cart holds of p after the add, all its lines. Past the shelf asks
// "Out of stock" first, once per item per cart; into the low line (bo-model stockLevel) says so in the toast. Untracked
// and sell-out-of-stock items never ask. add(later): later = it ran after the question. The question
// opens centred, whatever was tapped (owner 2026-10-08: a tile's grew from its edge, a variant's from the middle).
// Checkout no longer asks.
const oosAsked = { cart: '', ids: new Set() };
const cartWant = (p) => state.cart.reduce((n, i) => (productOf(i) === p ? n + toNumber(i.qty, 0) : n), 0);
function stockOnAdd(p, want, add, { cancel } = {}) {
  const left = roundQty(p, toNumber(p.stock, 0) - want), tracked = p.trackStock !== false;
  const asked = state.cart.length && oosAsked.cart === state.cartId && oosAsked.ids.has(p.id);
  if (tracked && left < 0 && !p.sellOutOfStock && !asked) {
    return showConfirm({ title: 'Out of stock', message: p.name, okText: 'Sell anyway',
      onConfirm: () => {
        add(true);
        if (oosAsked.cart !== state.cartId) Object.assign(oosAsked, { cart: state.cartId, ids: new Set() });
        oosAsked.ids.add(p.id);
      },
      // ponytail: Cancel logs the tap as demand (oos_tap, as trackItemAdd does), not a Lost sale -- the old checkout
      // "Don't sell" opened that form; a cancel here is often just the cashier checking. Lost sale stays on search.
      onCancel: () => { if (!(p.stock > 0)) track('oos_tap', { productId: p.id, stockOnHand: toNumber(p.stock, 0) }); if (cancel) cancel(); } });
  }
  add(false);
  if (tracked && left === 0) showToast(want === 1 ? 'Last one' : `Last ${SalesMath.qtyText(want)}`);   // the cart took what's left: never "0 left"
  else if (tracked && left > 0 && stockLevel({ ...p, stock: left }) === 'low') showToast(`Only ${SalesMath.qtyText(left)} left`);
}

function addToCart(productId, via = 'other', fromScanCard = false) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  stockOnAdd(p, cartWant(p) + 1, () => {
    beginCart();
    const existing = state.cart.find(i => i.id === productId);
    if (existing) existing.qty += 1;
    else state.cart.push({
      id: p.id, name: p.name, sku: p.sku, brand: p.brand,
      unit: p.unit, price: p.price, qty: 1,
    });
    trackItemAdd(p, 1, via);
    renderCart();
    if (scanOpen()) scanHit(p.id, fromScanCard);   // the scanner's card says it: camera, search or a USB scanner
    else showToast(`Added · ${p.name}`);
  });
}

function findProductByCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const lower = code.toLowerCase();
  const hit = p => (p.barcode && String(p.barcode).trim() === code);
  const sku = p => (p.sku && String(p.sku).toLowerCase() === lower);
  // A removed variant keeps its barcode; the live row that took it over wins.
  return state.products.find(p => onTill(p) && hit(p)) || state.products.find(p => !p.archived && hit(p))
    || state.products.find(hit) || state.products.find(p => onTill(p) && sku(p))
    || state.products.find(p => !p.archived && sku(p)) || state.products.find(sku) || null;
}

function addProductByCode(rawCode, { source = 'barcode' } = {}) {
  const code = String(rawCode || '').trim();
  if (!code) return false;
  const product = findProductByCode(code);
  track('scan', { code, found: !!product, productId: product ? product.id : '' });
  if (!product) {
    if (source === 'camera' && scanOpen()) { scanMiss(); return false; }
    const message = source === 'camera'
      ? `No item found for ${code}`
      : 'No item found for that barcode or SKU';
    showBarcodeStatus(message);
    showToast(message);
    return false;
  }
  // Staff forget to unhide, so a hidden item asks rather than blocks -- like out of stock does.
  const add = () => {
    addToCart(product.id, 'scan');
    const search = $('#searchInput');
    const clear = $('#searchClear');
    if (search) {
      search.value = '';
      state.query = '';
    }
    endSearch();
    clear?.classList.remove('visible');
    renderProducts();
    return true;
  };
  if (onTill(product)) return add();
  showConfirm({ title: product.name, message: `This item is ${product.archived ? 'archived' : 'hidden'}. Sell anyway?`,
    okText: 'Sell anyway', danger: false, onConfirm: add });
  return false;
}

function clearCart() {
  closeEditSheet();   // first, so its events are the sheet's own changes
  state.exchange = null;   // clearing the cart calls an exchange off (startExchange)
  state.savedId = '';      // ...and lets go of the saved cart it was continuing (continueDraft); the draft stays
  state.cart = [];
  state.cartId = '';
  state.cartStartedAt = 0;
  state.customer = null;
  state.cartDiscount = null;
  state.scPwd = null;
  state.paymentMethod = 'cash';
  state.fulfilment = (state.settings && state.settings.defaultFulfilment) || 'walkin';
  state.deliveryAddress = '';
  state.deliveryLocation = null;
  state.pickupTime = null;
  renderCart();
  updateCustomerButton();
}

function showBarcodeStatus(message) {
  const el = $('#barcodeStatus');
  if (el) el.textContent = message;
}

function resetBarcodeDuplicateGuard() {
  barcodeScanner.lastValue = '';
  barcodeScanner.lastSeenAt = 0;
  barcodeScanner.recent.clear();
}

function handleScannedBarcode(rawCode, { source = 'camera', requireVisibleReset = false } = {}) {
  const code = String(rawCode || '').trim();
  if (!code) return false;

  const now = Date.now();
  if (requireVisibleReset && code === barcodeScanner.lastValue) {
    barcodeScanner.lastSeenAt = now;
    return false;
  }

  const previousScanAt = barcodeScanner.recent.get(code) || 0;
  if (now - previousScanAt < barcodeScanner.cooldownMs) {
    barcodeScanner.lastValue = code;
    barcodeScanner.lastSeenAt = now;
    return false;
  }

  barcodeScanner.lastValue = code;
  barcodeScanner.lastSeenAt = now;
  barcodeScanner.recent.set(code, now);
  for (const [recentCode, scannedAt] of barcodeScanner.recent) {
    if (now - scannedAt > barcodeScanner.cooldownMs * 4) {
      barcodeScanner.recent.delete(recentCode);
    }
  }

  return addProductByCode(code, { source });
}

function stopBarcodeScanner() {
  barcodeScanner.run++;
  barcodeScanner.active = false;
  barcodeScanner.detector = null;
  resetBarcodeDuplicateGuard();
  clearTimeout(barcodeScanner.timer);
  barcodeScanner.timer = 0;
  if (barcodeScanner.zxingControls && typeof barcodeScanner.zxingControls.stop === 'function') {
    try { barcodeScanner.zxingControls.stop(); } catch (_) {}
  }
  barcodeScanner.zxingControls = null;
  barcodeScanner.zxingReader = null;
  if (barcodeScanner.stream) {
    barcodeScanner.stream.getTracks().forEach(track => track.stop());
    barcodeScanner.stream = null;
  }
  const video = $('#barcodeVideo');
  if (video) video.srcObject = null;
}

async function createBarcodeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  const preferred = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
  try {
    if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = preferred.filter(format => supported.includes(format));
      return new window.BarcodeDetector(formats.length ? { formats } : undefined);
    }
    return new window.BarcodeDetector({ formats: preferred });
  } catch (_) {
    try { return new window.BarcodeDetector(); }
    catch (_) { return null; }
  }
}

function scheduleBarcodeScan(video) {
  if (!barcodeScanner.active || !barcodeScanner.detector) return;
  clearTimeout(barcodeScanner.timer);
  barcodeScanner.timer = setTimeout(async () => {
    if (!barcodeScanner.active || !barcodeScanner.detector) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await barcodeScanner.detector.detect(video);
        const value = codes && codes[0] && codes[0].rawValue;
        if (value) {
          handleScannedBarcode(value, { source: 'camera', requireVisibleReset: true });
        } else if (barcodeScanner.lastValue && Date.now() - barcodeScanner.lastSeenAt > 450) {
          barcodeScanner.lastValue = '';
        }
      }
    } catch (err) {
      console.warn('Barcode scan failed', err);
      showBarcodeStatus("Can't read barcodes here. Type the code in search.");
    }
    scheduleBarcodeScan(video);
  }, 180);
}

function barcodeValueFromZxingResult(result) {
  if (!result) return '';
  if (typeof result.getText === 'function') return String(result.getText() || '').trim();
  return String(result.text || result.rawValue || result.value || '').trim();
}

function startZxingBarcodeScan(video) {
  const ZXing = window.ZXingBrowser;
  if (!ZXing || typeof ZXing.BrowserMultiFormatReader !== 'function') return false;
  try {
    const reader = new ZXing.BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 500,
    });
    barcodeScanner.zxingReader = reader;
    barcodeScanner.active = true;
    barcodeScanner.zxingControls = reader.scan(video, (result, err, controls) => {
      if (!barcodeScanner.active) return;
      const value = barcodeValueFromZxingResult(result);
      if (value) {
        handleScannedBarcode(value, { source: 'camera', requireVisibleReset: true });
      } else if (err && barcodeScanner.lastValue && Date.now() - barcodeScanner.lastSeenAt > 450) {
        barcodeScanner.lastValue = '';
      }
    });
    return true;
  } catch (err) {
    console.warn('ZXing barcode scan failed to start', err);
    barcodeScanner.zxingReader = null;
    barcodeScanner.zxingControls = null;
    return false;
  }
}

async function startBarcodeCamera() {
  const video = $('#barcodeVideo');
  if (!video) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showBarcodeStatus('Camera needs HTTPS. Type the code in search.');
    return;
  }
  const run = barcodeScanner.run;
  try {
    showBarcodeStatus('Starting camera...');
    const detector = await createBarcodeDetector();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: barcodeScanner.facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    if (run !== barcodeScanner.run) { stream.getTracks().forEach(t => t.stop()); return; }   // closed or flipped while it was asked for
    barcodeScanner.stream = stream;
    barcodeScanner.detector = detector;
    barcodeScanner.active = true;
    video.srcObject = stream;
    await video.play();
    if (run !== barcodeScanner.run) return;
    navigator.mediaDevices.enumerateDevices?.().then(d => { $('#scanFlip').hidden = d.filter(x => x.kind === 'videoinput').length < 2; }).catch(() => {});
    if (detector) scheduleBarcodeScan(video);
    else if (!startZxingBarcodeScan(video)) return showBarcodeStatus("Can't read barcodes here. Type the code in search.");
    showBarcodeStatus('');
  } catch (err) {
    if (run !== barcodeScanner.run) return;   // its play() was cut off by a close or a flip: the new start owns the camera
    console.warn('Camera unavailable', err);
    showBarcodeStatus('Camera blocked. Type the code in search.');
    stopBarcodeScanner();
  }
}

function isCapacitorNativeRuntime() {
  const cap = window.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
    if (typeof cap.getPlatform === 'function') return ['ios', 'android'].includes(cap.getPlatform());
  } catch (_) {}
  return !!cap.Plugins;
}

function barcodeValueFromNativeResult(result) {
  if (!result || typeof result !== 'object') return '';
  if (typeof result.ScanResult === 'string') return result.ScanResult;
  if (typeof result.scanResult === 'string') return result.scanResult;
  if (typeof result.content === 'string') return result.content;
  if (typeof result.value === 'string') return result.value;
  const first = Array.isArray(result.barcodes) ? result.barcodes[0] : null;
  return first?.rawValue || first?.displayValue || first?.value || '';
}

async function scanWithCapacitorBarcodePlugin() {
  if (!isCapacitorNativeRuntime()) return false;
  const plugins = window.Capacitor?.Plugins || {};
  const scanner = plugins.BarcodeScanner || window.BarcodeScanner;
  if (!scanner) return false;

  try {
    let result = null;
    if (typeof scanner.scanBarcode === 'function') {
      result = await scanner.scanBarcode({
        hint: 17,
        scanInstructions: 'Point the camera at the barcode',
        scanButton: false,
        scanText: 'Scan',
        cameraDirection: 1,
        scanOrientation: 3,
        android: { scanningLibrary: 'mlkit' },
        web: { showCameraSelection: false, scannerFPS: 12 },
      });
    } else if (typeof scanner.startScan === 'function') {
      if (typeof scanner.checkPermission === 'function') {
        const permission = await scanner.checkPermission({ force: true });
        if (permission?.granted === false) throw new Error('Camera permission was not granted.');
      }
      if (typeof scanner.hideBackground === 'function') scanner.hideBackground();
      try {
        result = await scanner.startScan();
      } finally {
        if (typeof scanner.showBackground === 'function') scanner.showBackground();
      }
    } else if (typeof scanner.scan === 'function') {
      result = await scanner.scan();
    } else {
      return false;
    }

    const value = barcodeValueFromNativeResult(result);
    if (!value) {
      showToast('Scan cancelled');
      return true;
    }
    addProductByCode(value, { source: 'camera' });
    return true;
  } catch (err) {
    console.warn('Native barcode scan failed', err);
    showToast('Barcode scanner unavailable. Type the code in search.');
    return false;
  }
}

async function openBarcodeScanner() {
  if (await scanWithCapacitorBarcodePlugin()) return;
  closeBarcodeScanner();   // a clean start: no camera, card or flash left over
  $('#scanSheet').classList.add('open');
  startBarcodeCamera();
  flashControl($('#scanBtn'));
}

function closeBarcodeScanner() {
  stopBarcodeScanner();
  clearTimeout(scanFlashTimer);
  $('#scanSheet').classList.remove('open', 'miss', 'hit');
  scanCardId = '';
  drawScanCard();
}

function flipBarcodeCamera() {
  barcodeScanner.facing = barcodeScanner.facing === 'user' ? 'environment' : 'user';
  stopBarcodeScanner();
  startBarcodeCamera();
}

// The scanner's card (owner 2026-10-08): the line the last read added -- bin or -, qty, + -- until the next read or a
// swipe down. + goes through addToCart, so the stock ask still holds. A line that left the cart takes the card with it.
let scanCardId = '', scanFlashTimer = 0;
const scanOpen = () => $('#scanSheet').classList.contains('open');
function drawScanCard() {
  const card = $('#scanCard'), item = scanCardId && state.cart.find(i => i.id === scanCardId);
  card.hidden = !item;
  card.style.transform = card.style.opacity = '';
  card.innerHTML = item ? `<div class="sc-txt"><b>${escapeHtml(item.name)}</b><span class="num">${peso(item.price)}</span></div>
    <div class="sc-q"><button type="button" data-sq="-1" aria-label="${item.qty > 1 ? 'Less' : 'Remove'}">${esSvg(item.qty > 1 ? 'less' : 'trash')}</button><span class="num">${SalesMath.qtyText(item.qty)}</span><button type="button" data-sq="1" aria-label="More">${esSvg('more')}</button></div>` : '';
}
function scanHit(id, fromScanCard) {
  scanCardId = id;
  drawScanCard();
  if (fromScanCard) return;   // its own + only changes the number
  scanFlash('hit', 300, '');   // a quick green flash (owner 2026-10-08); the buzz comes with Capacitor
  const card = $('#scanCard');
  card.classList.remove('pop');
  void card.offsetWidth;   // restart: a second read of the same item comes in again
  card.classList.add('pop');
}
const scanMiss = () => scanFlash('miss', 1500, 'Item not found');
function scanFlash(kind, ms, words) {
  const sheet = $('#scanSheet');
  clearTimeout(scanFlashTimer);
  sheet.classList.remove('hit', 'miss');
  sheet.classList.add(kind);
  showBarcodeStatus(words);
  scanFlashTimer = setTimeout(() => {
    sheet.classList.remove(kind);
    if (words && $('#barcodeStatus').textContent === words) showBarcodeStatus('');   // only its own words: not a later "Camera blocked"
  }, ms);
}

// ---------- Edit sheet (popups-lab.html, Sheet C) ----------
// The cart line, the receipt discount and the fulfilment open over the whole left side, the cart stays in view and
// follows every tap. Numbers are typed on our keys, never the tablet's. es = the open sheet: kind 'line' | 'rd' | 'ful';
// q / d = the typed quantity / discount (strings, as typed), pct = Percent or Amount, f = what the keys (or a panel)
// are open for, fresh = the first key replaces the number, anim = how the body moves on this draw.
// The saved discounts (Items › Discounts, bo-model liveDiscounts) minus Senior / PWD, which keep their own rows below.
const esPresets = () => liveDiscounts().filter(d => !d.builtin && d.value > 0);
const esScRow = k => loadDiscounts().find(d => d.builtin === k) || { type: 'percent', value: 20 };
const ES_PANEL = { pickup: 't', delivery: 'a' };          // the types that ask for something: Pickup a time, Delivery an address
// Senior citizen / PWD (RA 9994 / RA 10754): SalesMath.orderTotals' scPwd, 20% (the built-in row's) off + VAT-exempt. Each asks for the card's
// ID number and the name, both printed on the slip; it replaces any receipt discount (never both, the law's rule).
const ES_SC = { senior: 'Senior', pwd: 'PWD' };
const ES_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17].map(h => `${(h + 11) % 12 + 1}:00 ${h < 12 ? 'AM' : 'PM'}`);   // ponytail: fixed; the store's hours would set them
const ES_IC = {
  x: 'M6 6l12 12M18 6L6 18', trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12', back: 'M15 5l-7 7 7 7', less: 'M6 12h12', more: 'M12 6v12M6 12h12', chev: 'M9 6l6 6-6 6',
  del: 'M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7zM13 10l4 4M17 10l-4 4',
  pin: 'M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10zM12 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
};
const esSvg = (k, c = '') => `<svg${c ? ` class="${c}"` : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="${ES_IC[k]}"/></svg>`;
let es = null;

const esItem = () => es && state.cart.find(i => i.id === es.id);
const esDisc = (o) => (+o.d > 0 ? { type: o.pct ? 'percent' : 'amount', value: +o.d } : null);
const esTyped = (o) => (o.pct ? `${o.d || 0}%` : SalesMath.currencySymbol(state.settings.store?.currency) + (o.d || 0));
const esShown = (d) => (!d ? 'None' : d.type === 'percent' ? `${d.value}%` : peso(d.value));

function openEditSheet(kind, id) {
  if (kind !== 'ful' && !state.cart.length) { flashControl($('#cartDiscountBtn')); flashControl($('#side')); return; }
  const was = !!es;
  closeEditSheet(true);
  closeVariantSheet();
  if (kind === 'line') {
    const item = state.cart.find(i => i.id === id);
    if (!item) return;
    const d = item.discount || null;
    es = { kind, id, q: String(item.qty), d: d ? String(d.value) : '', pct: d ? d.type === 'percent' : true, before: { qty: item.qty, discount: d } };
  } else if (kind === 'rd') {
    let cd = state.cartDiscount && state.cartDiscount.value ? state.cartDiscount : null;
    const saved = cd && cd.id && esPresets().some(d => d.id === cd.id && d.type === cd.type && d.value === cd.value);
    // its saved row was edited or archived since (a restored saved cart, continueDraft): the sale keeps what it was given, as Custom
    if (cd && cd.id && !saved) { cd = state.cartDiscount = { type: cd.type, value: cd.value }; renderCart(); }
    const sc = state.scPwd, pick = sc ? sc.kind : saved ? cd.id : cd ? 'c' : null;
    es = { kind, pick, d: pick === 'c' ? String(cd.value) : '', pct: cd ? cd.type === 'percent' : true, before: cd,
      beforeSc: sc, sc: { idNo: sc ? sc.idNo : '', name: sc ? sc.name : '' } };
  } else {
    es = { kind, day: (state.pickupTime && state.pickupTime.day) || 'Today' };
  }
  Object.assign(es, { f: null, anim: false, opened: true });
  drawEditSheet();
  if (!was) $('#editSheet').classList.add('open');
}

// The one way a cart line leaves: the editor's Remove item and the swiped line's Delete (owner 2026-10-08).
function removeLine(item) {
  if (es && es.kind === 'line' && es.id === item.id) { es = null; $('#editSheet').classList.remove('open'); }   // the tablet's sheet can be open on it
  track('item_remove', { productId: item.id, qty: item.qty, unitPrice: item.price });
  state.cart = state.cart.filter(i => i !== item);
  const list = $('#cartList'), top = list.scrollTop;
  renderCart();
  list.scrollTop = top;   // renderCart jumps to the newest line; a removal keeps the cashier's place
  if (es) state.cart.length ? drawEditSheet() : closeEditSheet();   // Discount / Walk-in open beside the rail: its totals follow
  showToast('Item removed');
}

// Closing keeps what's on the cart (it followed every tap) and sends the events the old Save sent, once per open.
function closeEditSheet(swap) {
  if (!es) return;
  const typing = es.f === 'q';
  if (es.f) esSettle(es);
  if (typing) esWrite();   // a typed count is asked about as the sheet goes
  const o = es; es = null;
  const item = o.kind === 'line' && state.cart.find(i => i.id === o.id);
  if (item) {
    if (item.qty !== o.before.qty) track('item_qty', { productId: item.id, from: o.before.qty, to: item.qty });
    const d = item.discount || null;
    if (JSON.stringify(d) !== JSON.stringify(o.before.discount)) track('discount', { scope: 'line', kind: (d || o.before.discount).type, value: d ? d.value : 0, productId: item.id });
  } else if (o.kind === 'rd' && JSON.stringify([state.cartDiscount, state.scPwd]) !== JSON.stringify([o.before, o.beforeSc])) {
    const sc = state.scPwd || (!state.cartDiscount && o.beforeSc);   // an SC/PWD put on, or taken off with nothing in its place
    track('discount', sc ? { scope: 'cart', kind: sc.kind, value: state.scPwd ? esScRow(sc.kind).value : 0 }
      : { scope: 'cart', kind: (state.cartDiscount || o.before).type, value: state.cartDiscount ? state.cartDiscount.value : 0 });
  } else if (o.kind === 'ful') {
    state.deliveryAddress = (state.deliveryAddress || '').trim();
  }
  if (!swap) $('#editSheet').classList.remove('open');
  renderCart();
}

// Every tap lands on the cart at once; a 0 quantity keeps the last count until the keys go away.
function esWrite() {
  const item = esItem();
  if (es.kind === 'line' && item) {
    const o = es, p = productOf(item), qty = qtyFrom(p, es.q, item.qty);
    if (o.f === 'q') { o.qAt ??= item.qty; item.qty = qty; }   // typing lands at once; the stock question waits for the keys to close
    else {
      const was = o.qAt ?? item.qty;   // the count before the keys opened
      o.qAt = null;
      if (p && qty > was) {   // more of it: the stock question / low toast (stockOnAdd); Cancel puts the count back
        item.qty = was;
        stockOnAdd(p, cartWant(p) - was + qty, (later) => {
          item.qty = qty;
          if (later) { renderCart(); if (es === o) drawEditSheet(); }
        }, {
          cancel: () => { Object.assign(o, { q: String(was), fresh: true }); renderCart(); if (es === o) drawEditSheet(); } });
      } else item.qty = qty;
    }
    const d = esDisc(es);
    if (d) item.discount = d; else delete item.discount;
  } else if (es.kind === 'rd') {
    // A saved one carries its name (the receipt's Discount word, SalesMath.receiptParts) and id; ₱ ones come off as a fixed amount.
    const P = esPresets().find(d => d.id === es.pick);
    state.cartDiscount = P ? { type: P.type, value: P.value, name: P.name, id: P.id } : es.pick === 'c' ? esDisc(es) : null;
    if (!ES_SC[es.pick]) state.scPwd = null;   // set by its panel's Apply (esScApply), dropped by any other pick
  }
  renderCart();
}

// The keys go away: an emptied count goes back to the cart's, an emptied custom is no discount.
function esSettle(o) {
  const item = esItem();
  if (o.kind === 'line' && item && !(+o.q > 0)) o.q = String(item.qty);
  if (o.pick === 'c' && !(+o.d > 0)) o.pick = null;
  Object.assign(o, { f: null, anim: 'out' });
}

// One key into a typed number: '.' once, two decimals, nothing over max, a lone 0 gives way.
function esPress(v, k, dec, max) {
  if (k === 'del') return v.slice(0, -1);
  if (k === '.') return dec && !v.includes('.') ? (v || '0') + '.' : v;
  if (/\.\d\d$/.test(v)) return v;
  const n = (v === '0' ? '' : v) + k;
  return +n > max ? v : n;
}

function drawEditSheet() {
  const o = es, card = $('#editSheetCard');
  if (!o) return;
  const n = (f, text, cls) => `<span class="es-n${cls}${o.f === f ? ' on' + (o.fresh ? ' fresh' : '') : ''}"><span>${text}</span></span>`;
  const stp = (s, dis) => `<button type="button" class="es-stp" data-sstep="${s}"${dis ? ' disabled' : ''} aria-label="${s < 0 ? 'Less' : 'More'}">${esSvg(s < 0 ? 'less' : 'more')}</button>`;
  const seg = (on, off, cls = '') => `<span class="es-seg${cls}">${on}${off}</span>`;
  const segBtn = (label, on, data) => `<button type="button"${on ? ' class="on"' : ''} ${data}>${label}</button>`;
  const cv = (open) => (open ? '' : esSvg('chev', 'cv'));
  let head, rows, side = '';
  const kin = o.anim === true || o.anim === 'swap' ? ' in' : '';
  if (o.kind === 'line') {
    const item = esItem();
    if (!item) return closeEditSheet();
    const p = productOf(item), step = stepFor(p);
    // SC/PWD replaces line discounts (never stacked), so under it the line shows gross and says why.
    const sc = cartTotals().scPwd && state.scPwd;
    const m = SalesMath.lineMoney(item.price, item.qty, sc ? null : item.discount, state.settings.store?.currency);
    head = `<p>${escapeHtml(item.name)}</p><div class="es-hero">${peso(m.lineTotal)}</div>
      <p>${item.qty} × ${peso(item.price)}${m.lineDiscount ? ` · ${peso(-m.lineDiscount)}` : sc && item.discount ? ` · ${ES_SC[sc.kind]} applies` : ''}</p>`;
    rows = `<div class="es-row${o.f === 'q' ? ' on' : ''}"><span>Quantity</span>${stp(-1, item.qty <= step)}<button type="button" data-sf="q">${n('q', o.f === 'q' ? o.q || '0' : item.qty, ' q')}</button>${stp(1)}</div>
      <div class="es-row${o.f === 'd' ? ' on' : ''}" data-sf="d"><span>Discount</span>${n('d', o.f === 'd' ? esTyped(o) : esShown(item.discount), ' v')}${cv(o.f === 'd')}</div>`;
    if (o.f) side = `<div class="es-keys${kin}">${seg(segBtn('Percent', o.pct, 'data-pct'), segBtn('Amount', !o.pct, 'data-amt'), o.f === 'd' ? '' : ' off')}${esKeys(o.f === 'd' || step < 1)}</div>`;
  } else if (o.kind === 'rd') {
    const t = cartTotals();
    head = `<p>Sale total</p><div class="es-hero">${peso(t.total)}</div><p>${t.discount ? `${peso(t.subtotal)} · ${peso(-t.discount)}` : 'No discount'}</p>`;
    // Senior / PWD, then the saved ones, scroll under the total (any number of them); Custom stays put below.
    rows = `<div class="es-scroll">${Object.entries(ES_SC).map(([k, name]) => `<button type="button" class="es-row${o.f === k ? ' on' : o.pick === k ? ' pick' : ''}" data-sc="${k}"><span>${name}</span><small class="ad">${
        o.pick !== k || !state.scPwd ? esShown(esScRow(k)) : t.scPwd ? escapeHtml(state.scPwd.name) : 'Promo is bigger'}</small>${cv(o.f === k)}</button>`).join('')
      + esPresets().map(d => `<button type="button" class="es-row${o.pick === d.id ? ' pick' : ''}" data-pick="${escapeHtml(d.id)}"><span>${escapeHtml(d.name)}</span><small>${esShown(d)}</small></button>`).join('')}</div>`
      + `<div class="es-row${o.f === 'd' ? ' on' : o.pick === 'c' ? ' pick' : ''}" data-sf="d"><span>Custom</span>${n('d', o.pick === 'c' ? esTyped(o) : '', ' v')}${cv(o.f === 'd')}</div>`;
    const field = (f, label) => `<input class="es-ta${o.bad === f ? ' bad' : ''}" data-scf="${f}" value="${escapeHtml(o.sc[f])}" placeholder="${label}" aria-label="${label}" autocomplete="off"${o.bad === f ? ' aria-invalid="true"' : ''}>`;
    if (ES_SC[o.f]) side = `<div class="es-keys es-addr${kin}"><div class="es-ah">${o.f === 'pwd' ? 'PWD' : 'Senior citizen'}</div>${field('idNo', 'ID number')}${field('name', 'Name')}</div>`;
    else if (o.f) side = `<div class="es-keys${kin}">${seg(segBtn('Percent', o.pct, 'data-pct'), segBtn('Amount', !o.pct, 'data-amt'))}${esKeys(true)}</div>`;
  } else {
    const methods = fulfilMethods(state.settings), pt = state.pickupTime;
    const say = { pickup: pt ? `${pt.day}, ${pt.time}` : '', delivery: state.deliveryAddress };
    head = `<div class="es-hero">${escapeHtml((methods.find(m => m.key === state.fulfilment) || methods[0]).label)}</div>`;
    rows = methods.map(m => `<button type="button" class="es-row${o.f && ES_PANEL[m.key] === o.f ? ' on' : state.fulfilment === m.key ? ' pick' : ''}" data-ful="${escapeHtml(m.key)}"><span>${escapeHtml(m.label)}</span>${
      ES_PANEL[m.key] && !m.custom ? `<small class="ad">${escapeHtml(say[m.key] || '')}</small>${cv(ES_PANEL[m.key] === o.f)}` : ''}</button>`).join('');
    if (o.f === 'a') side = `<div class="es-keys es-addr${kin}"><div class="es-ah">Deliver to<button type="button" class="es-chip" data-map>${esSvg('pin')}${state.deliveryLocation ? 'Pinned' : 'Map'}</button></div>
      <textarea class="es-ta" id="esAddr" rows="6" placeholder="House #, street, barangay, city" aria-label="Address">${escapeHtml(state.deliveryAddress || '')}</textarea></div>`;
    else if (o.f === 't') side = `<div class="es-keys es-addr${kin}"><div class="es-ah">Pick up${seg(...['Today', 'Tomorrow'].map(d => segBtn(d, o.day === d, `data-day="${d}"`)))}</div>
      <div class="es-times">${ES_HOURS.map(h => `<button type="button" class="es-row${pt && pt.day === o.day && pt.time === h ? ' pick' : ''}" data-time="${h}">${h}</button>`).join('')}</div></div>`;
  }
  // bottom left follows what's being edited: the discount's keys -> clear it; nothing open -> remove the line
  const left = o.kind === 'ful' ? ''
    : o.f === 'd' ? (+o.d ? `<button type="button" class="es-q" data-sclr>${o.kind === 'line' ? 'Clear discount' : 'Clear'}</button>` : '')
    : o.f ? '' : o.kind === 'line' ? '<button type="button" class="es-q rm" data-remove>Remove item</button>' : o.pick !== null ? '<button type="button" class="es-q" data-sclr>Clear</button>' : '';
  const top = card.querySelector('.es-scroll')?.scrollTop || 0;   // a tap redraws the sheet; the list stays where it was scrolled
  card.innerHTML = `<button type="button" class="es-x" data-close aria-label="Close">${esSvg('x', 'ix')}${esSvg('back', 'ib')}<span class="xl">Back</span></button>
    <div class="es-body${o.kind === 'rd' ? ' fill' : ''}${o.anim === true ? ' in' : o.anim === 'out' ? ' out' : ''}"><div class="es-col"><div class="es-head">${head}</div><div class="es-list">${rows}</div></div>${side}</div>
    <div class="es-ft">${left}${o.f ? '<button type="button" class="es-ink" data-apply>Apply</button>' : '<button type="button" class="es-ink" data-close>Done</button>'}</div>`;
  const list = card.querySelector('.es-scroll');
  if (list && o.opened) list.querySelector('.pick')?.scrollIntoView({ block: 'nearest' });   // just opened: the one on the sale in view
  else if (list) list.scrollTop = top;
  o.anim = o.opened = false;
}
const esKeys = (dec) => `<div class="es-kp">${[...'123456789', dec ? '.' : '', '0', 'del'].map(k => !k ? '<span></span>'
  : `<button type="button" data-sk="${k}"${k === 'del' ? ' aria-label="Delete"' : ''}>${k === 'del' ? esSvg('del') : k}</button>`).join('')}</div>`;

function editSheetClick(e) {
  const o = es, el = (q) => e.target.closest(q);
  if (!o) return;
  if (el('[data-close]')) return closeEditSheet();
  if (o.kind === 'ful') return esFulClick(el);
  if (ES_SC[o.f]) $$('#editSheet [data-scf]').forEach(i => { o.sc[i.dataset.scf] = i.value; });   // the typed ID and name survive the redraw
  if (el('[data-remove]')) {
    const gone = esItem();
    es = null;
    $('#editSheet').classList.remove('open');
    return gone ? removeLine(gone) : renderCart();
  }
  const item = esItem(), step = item ? stepFor(productOf(item)) : 1;
  if (el('[data-sk]')) {
    const qty = o.f === 'q';
    o[o.f] = esPress(o.fresh ? '' : o[o.f], el('[data-sk]').dataset.sk, !qty || step < 1, qty ? 9999 : o.pct ? 100 : 99999);
    o.fresh = false;
  } else if (el('.es-seg button')) {
    o.pct = 'pct' in el('.es-seg button').dataset;
    if (o.pct && +o.d > 100) o.d = '100';
  } else if (el('[data-sstep]')) {
    if (o.f) esSettle(o);   // − + puts the keys away, keeping what was typed
    o.q = String(roundQty(productOf(item), Math.max(step, item.qty + +el('[data-sstep]').dataset.sstep * step)));
  } else if (el('[data-pick]')) {
    if (o.f) esSettle(o);
    const i = el('[data-pick]').dataset.pick;   // the saved discount's id
    o.pick = o.pick === i ? null : i;
  } else if (el('[data-sf]')) {
    const f = el('[data-sf]').dataset.sf;
    if (o.f === f) esSettle(o);
    else {
      Object.assign(o, { f, fresh: true, anim: !o.f });
      if (o.kind === 'rd') o.pick = 'c';
    }
  } else if (el('[data-sc]')) {   // Senior / PWD: its panel opens beside the list, the same row again puts it away
    const k = el('[data-sc]').dataset.sc, was = o.f;
    if (was === 'd') esSettle(o);
    Object.assign(o, was === k ? { f: null, anim: 'out' } : { f: k, bad: null, anim: was ? 'swap' : true });
  } else if (el('[data-apply]')) {
    if (ES_SC[o.f] && !esScApply(o)) return;
    esSettle(o);
  } else if (el('[data-sclr]')) {
    o.d = '';
    if (o.kind === 'rd') o.pick = null;
    if (o.f) esSettle(o);
  } else return;
  esWrite();
  drawEditSheet();
  if (ES_SC[o.f]) ($$('#editSheet [data-scf]').find(i => !i.value.trim()) || $('#editSheet [data-scf]')).focus();
}

// The SC/PWD panel's Apply: the ID number and the name, both, or nothing is applied; the first empty one is
// ringed and takes the cursor. Applied, it is the sale's only receipt discount (esWrite drops the others).
function esScApply(o) {
  const sc = { idNo: o.sc.idNo.trim(), name: o.sc.name.trim() };
  o.bad = !sc.idNo ? 'idNo' : !sc.name ? 'name' : null;
  if (o.bad) {
    drawEditSheet();
    $(`#editSheet [data-scf="${o.bad}"]`).focus();
    return false;
  }
  state.scPwd = { kind: o.f, ...sc };
  o.pick = o.f;
  return true;
}

// Fulfilment: the types are the rows; leaving a type drops what it asked for, the same row again puts its panel away.
function esFulClick(el) {
  const o = es, k = el('[data-ful]')?.dataset.ful;
  if (k) {
    if (k !== state.fulfilment) {
      state.fulfilment = k;
      state.pickupTime = null;
      state.deliveryAddress = k === 'delivery' ? (state.customer && state.customer.address) || '' : '';
      state.deliveryLocation = null;
    }
    const f = ES_PANEL[k] && o.f !== ES_PANEL[k] ? ES_PANEL[k] : null;
    Object.assign(o, { f, anim: f ? (o.f ? 'swap' : true) : o.f ? 'out' : false });
  } else if (el('[data-day]')) o.day = el('[data-day]').dataset.day;
  else if (el('[data-time]')) state.pickupTime = { day: o.day, time: el('[data-time]').dataset.time };   // shown only, not on the order yet
  else if (el('[data-map]')) return openDeliveryMap();
  else if (el('[data-apply]')) Object.assign(o, { f: null, anim: 'out' });
  else return;
  renderCart();
  drawEditSheet();
  if (o.f === 'a') { const a = $('#esAddr'); a.focus(); a.selectionStart = a.value.length; }
}

// The types the owner configured (Walk-in can't be removed): one picker that opens into the list -- half a row has
// no room for a toggle.
const RAIL_UPDOWN = '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';
function renderFulRow() {
  const row = $('#fulRow');
  if (!row) return;
  const methods = fulfilMethods(state.settings);
  // A hidden or deleted type must not stay selected on the cart in front of the cashier.
  if (!methods.some(m => m.key === state.fulfilment)) state.fulfilment = 'walkin';
  const cur = methods.find(m => m.key === state.fulfilment) || methods[0];
  row.innerHTML = `<button type="button" class="pick" id="fulPick" aria-haspopup="dialog"><span>${escapeHtml(cur.label)}</span>${RAIL_UPDOWN}</button>`;
}
const fulfilLabel = () => orderFulfilLabel({ fulfilment: state.fulfilment });

// Settings -> Item / Amount header. Off: the rows explain themselves and the count moves beside Total.
function applyCartHead(on) {
  state.cartHead = on;
  document.body.classList.toggle('rail-nohead', !on);
  const cb = $('#posCartHead'); if (cb) cb.checked = on;
}

// ---------- The morph menu (cart-lab-stack-c.html) ----------
// The menu grows out of its trigger's own box, each item the trigger's height, always in the same order (the hand
// learns where each choice is); the current one is only bold. A pick, a tap outside or Esc shrinks it back.
// items: [{label, run, cur, red, off}] or '-' for a divider. opts.w: width (default the trigger's), opts.right: right-align.
const calmMs = ms => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ms;
let railMenu = null;
function openMenu(trigger, items, opts = {}) {
  const r = trigger.getBoundingClientRect(), cs = getComputedStyle(trigger);
  const veil = document.createElement('div');
  veil.className = 'rail-veil';
  veil.innerHTML = `<div class="rail-menu" role="menu">${items.map((it, i) => it === '-' ? '<hr>'
    : `<button type="button" role="menuitem" data-i="${i}" class="${it.cur ? 'cur' : ''}${it.red ? ' red' : ''}" style="height:${r.height}px"${it.off ? ' disabled' : ''}><span>${escapeHtml(it.label)}</span></button>`).join('')}</div>`;
  const m = veil.firstChild, pad = 4, w = opts.w || r.width;
  m.style.cssText = `width:${w}px;--pl:${Math.max(12, parseFloat(cs.paddingLeft) - pad)}px;--pr:${Math.max(8, parseFloat(cs.paddingRight) - pad)}px`;
  document.body.append(veil);
  const anchor = m.querySelector('button'), H = m.offsetHeight;
  const left = Math.max(0, Math.min(innerWidth - w, opts.right ? r.right - w : r.left));
  const top = Math.max(8, Math.min(innerHeight - H - 8, r.top - anchor.offsetTop));
  m.style.left = left + 'px'; m.style.top = top + 'px';
  const shrink = growFrom(m, r);
  trigger.setAttribute('aria-expanded', 'true');
  railMenu = { veil, shrink, trigger };
  (m.querySelector('button:not(:disabled)') || anchor).focus({ preventScroll: true });
  veil.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b || e.target === veil) closeMenu();
    if (b) items[b.dataset.i].run();
  });
  veil.addEventListener('keydown', e => {
    const bs = [...m.querySelectorAll('button:not(:disabled)')], i = bs.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); trigger.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus(); }
  });
}
function closeMenu() {
  if (!railMenu) return;
  const { veil, shrink, trigger } = railMenu; railMenu = null;
  trigger.setAttribute('aria-expanded', 'false');
  veil.style.pointerEvents = 'none';
  shrink(() => veil.remove());
}
// The morph (the ⋯ menu, the payment sheet): m, already placed, grows out of the trigger's box r with a little
// overshoot. Returns shrink(done), which puts it back into that box.
function growFrom(m, r) {
  const w = m.offsetWidth, H = m.offsetHeight, t = r.top - m.offsetTop, l = r.left - m.offsetLeft;
  const from = `inset(${t}px ${w - l - r.width}px ${H - t - r.height}px ${l}px round 10px)`, to = 'inset(-24px round 34px)';
  m.style.transformOrigin = `${l + r.width / 2}px ${t + r.height / 2}px`;
  m.animate([{ clipPath: from, transform: 'scale(.94)', boxShadow: 'none' }, { clipPath: to, transform: 'none' }], { duration: calmMs(180), easing: 'cubic-bezier(.3,1.45,.55,1)' });
  return (done) => { m.animate([{ clipPath: to }, { clipPath: from, opacity: 0, transform: 'scale(.96)' }], { duration: calmMs(90), easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = done; };
}

function updateDeliveryPinStatus() {   // the fulfilment sheet's Map chip reads Pinned
  if (es && es.kind === 'ful') drawEditSheet();
}

function setDeliveryMapFromLocation(location = state.deliveryLocation) {
  const loc = normalizeDeliveryLocation(location);
  const base = loc || DELIVERY_MAP_DEFAULT;
  state.deliveryMap.centerLat = base.lat;
  state.deliveryMap.centerLng = base.lng;
  state.deliveryMap.zoom = loc?.zoom || DELIVERY_MAP_DEFAULT.zoom;
  state.deliveryMap.pinLat = loc?.lat ?? null;
  state.deliveryMap.pinLng = loc?.lng ?? null;
}

function deliveryMapWorldCenter() {
  return {
    x: lonToWorldX(state.deliveryMap.centerLng, state.deliveryMap.zoom),
    y: latToWorldY(state.deliveryMap.centerLat, state.deliveryMap.zoom),
  };
}

function setDeliveryMapCenterFromWorld(x, y) {
  state.deliveryMap.centerLng = worldXToLng(x, state.deliveryMap.zoom);
  state.deliveryMap.centerLat = worldYToLat(y, state.deliveryMap.zoom);
}

function renderDeliveryMap() {
  const stage = $('#deliveryMapStage');
  const tiles = $('#deliveryMapTiles');
  if (!stage || !tiles) return;
  const rect = stage.getBoundingClientRect();
  const width = Math.max(320, rect.width || 640);
  const height = Math.max(260, rect.height || 360);
  const zoom = state.deliveryMap.zoom;
  const center = deliveryMapWorldCenter();
  const minX = Math.floor((center.x - width / 2) / 256) - 1;
  const maxX = Math.floor((center.x + width / 2) / 256) + 1;
  const minY = Math.max(0, Math.floor((center.y - height / 2) / 256) - 1);
  const maxY = Math.min((2 ** zoom) - 1, Math.floor((center.y + height / 2) / 256) + 1);
  const imgs = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const left = Math.round(width / 2 + (x * 256 - center.x));
      const top = Math.round(height / 2 + (y * 256 - center.y));
      imgs.push(`<img src="${osmTileUrl(x, y, zoom)}" alt="" draggable="false" style="left:${left}px;top:${top}px" />`);
    }
  }
  tiles.innerHTML = imgs.join('');
  const pin = $('#deliveryMapPin');
  if (pin) pin.classList.toggle('is-hidden', state.deliveryMap.pinLat == null || state.deliveryMap.pinLng == null);
  const coords = $('#deliveryMapCoords');
  if (coords) coords.textContent = state.deliveryMap.pinLat == null
    ? 'No pin selected'
    : `Pinned road map location for receipt`;
}

function deliveryMapPointToLatLng(clientX, clientY) {
  const stage = $('#deliveryMapStage');
  if (!stage) return null;
  const rect = stage.getBoundingClientRect();
  const center = deliveryMapWorldCenter();
  const x = center.x + (clientX - rect.left - rect.width / 2);
  const y = center.y + (clientY - rect.top - rect.height / 2);
  return {
    lat: worldYToLat(y, state.deliveryMap.zoom),
    lng: worldXToLng(x, state.deliveryMap.zoom),
  };
}

function openDeliveryMap() {
  setDeliveryMapFromLocation(state.deliveryLocation);
  $('#deliveryMapModal').hidden = false;
  requestAnimationFrame(renderDeliveryMap);
  if (!state.deliveryLocation) tryUseDeviceDeliveryLocation({ quiet: true });
}

function setDeliveryMapPinAt(clientX, clientY) {
  const loc = deliveryMapPointToLatLng(clientX, clientY);
  if (!loc) return;
  state.deliveryMap.pinLat = clamp(loc.lat, -85.05112878, 85.05112878);
  state.deliveryMap.pinLng = clamp(loc.lng, -180, 180);
  state.deliveryMap.centerLat = state.deliveryMap.pinLat;
  state.deliveryMap.centerLng = state.deliveryMap.pinLng;
  renderDeliveryMap();
}

function zoomDeliveryMap(delta) {
  state.deliveryMap.zoom = clamp(state.deliveryMap.zoom + delta, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  renderDeliveryMap();
}

function zoomDeliveryMapAt(delta, clientX, clientY) {
  const stage = $('#deliveryMapStage');
  if (!stage || !delta) return;
  const before = deliveryMapPointToLatLng(clientX, clientY);
  if (!before) return;
  state.deliveryMap.zoom = clamp(state.deliveryMap.zoom + delta, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  const rect = stage.getBoundingClientRect();
  const afterX = lonToWorldX(before.lng, state.deliveryMap.zoom);
  const afterY = latToWorldY(before.lat, state.deliveryMap.zoom);
  setDeliveryMapCenterFromWorld(
    afterX - (clientX - rect.left - rect.width / 2),
    afterY - (clientY - rect.top - rect.height / 2)
  );
  renderDeliveryMap();
}

function deliveryTouchDistance(touches) {
  if (!touches || touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function deliveryTouchMidpoint(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function beginDeliveryPinch(e) {
  if (!e.touches || e.touches.length !== 2) return;
  const mid = deliveryTouchMidpoint(e.touches);
  const focus = deliveryMapPointToLatLng(mid.x, mid.y);
  state.deliveryMap.drag = null;
  state.deliveryMap.pinch = {
    distance: deliveryTouchDistance(e.touches),
    zoom: state.deliveryMap.zoom,
    focusLat: focus?.lat ?? state.deliveryMap.centerLat,
    focusLng: focus?.lng ?? state.deliveryMap.centerLng,
    midX: mid.x,
    midY: mid.y,
  };
}

function updateDeliveryPinch(e) {
  const pinch = state.deliveryMap.pinch;
  if (!pinch || !e.touches || e.touches.length !== 2) return;
  e.preventDefault();
  const ratio = deliveryTouchDistance(e.touches) / Math.max(1, pinch.distance);
  const steps = Math.round(Math.log2(Math.max(0.25, Math.min(4, ratio))));
  const nextZoom = clamp(pinch.zoom + steps, DELIVERY_MAP_MIN_ZOOM, DELIVERY_MAP_MAX_ZOOM);
  if (nextZoom === state.deliveryMap.zoom) return;
  state.deliveryMap.zoom = nextZoom;
  const stage = $('#deliveryMapStage');
  const rect = stage.getBoundingClientRect();
  const mid = deliveryTouchMidpoint(e.touches);
  const focusX = lonToWorldX(pinch.focusLng, state.deliveryMap.zoom);
  const focusY = latToWorldY(pinch.focusLat, state.deliveryMap.zoom);
  setDeliveryMapCenterFromWorld(
    focusX - (mid.x - rect.left - rect.width / 2),
    focusY - (mid.y - rect.top - rect.height / 2)
  );
  renderDeliveryMap();
}

function endDeliveryPinch(e) {
  if (!state.deliveryMap.pinch) return;
  if (!e.touches || e.touches.length < 2) state.deliveryMap.pinch = null;
}

function saveDeliveryMapPin() {
  if (state.deliveryMap.pinLat == null || state.deliveryMap.pinLng == null) {
    showToast('Tap the map to set a pin');
    return;
  }
  state.deliveryLocation = normalizeDeliveryLocation({
    lat: state.deliveryMap.pinLat,
    lng: state.deliveryMap.pinLng,
    zoom: state.deliveryMap.zoom,
    provider: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
  });
  $('#deliveryMapModal').hidden = true;
  updateDeliveryPinStatus();
  renderCart();
}

function clearDeliveryMapPin() {
  state.deliveryMap.pinLat = null;
  state.deliveryMap.pinLng = null;
  state.deliveryLocation = null;
  updateDeliveryPinStatus();
  renderDeliveryMap();
  renderCart();
}

function tryUseDeviceDeliveryLocation({ quiet = false } = {}) {
  if (!navigator.geolocation) {
    if (!quiet) showToast('Device location is unavailable');
    return;
  }
  if (!quiet) showToast('Getting location...');
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    state.deliveryMap.centerLat = lat;
    state.deliveryMap.centerLng = lng;
    state.deliveryMap.pinLat = lat;
    state.deliveryMap.pinLng = lng;
    state.deliveryMap.zoom = Math.max(state.deliveryMap.zoom, 18);
    renderDeliveryMap();
  }, () => {
    if (!quiet) showToast('Location permission was blocked');
  }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

function useDeviceDeliveryLocation() {
  tryUseDeviceDeliveryLocation({ quiet: false });
}

// ---------- Saved customer modal ----------
// The same fields, words and check as the back office's dialog (bo-model CUSTOMER_FIELDS). `c` = edit that one.
function openCustomerEditModal(c = null) {
  state.customerEditing = c;
  // blocks of fields, each word at the side of its box (owner 2026-10-08); credit a switch whose limit shows when on
  const F = {};
  customerFieldsHtml(c || {}, { cls: 'cs-i', wrap: (f, control) => { F[f.name] = `<label class="cs-row${f.name === 'creditLimit' ? ' cs-lim' : ''}"><span>${f.label}</span>${f.name === 'creditLimit' ? control : control.replace('<input ', `<input placeholder="Add ${f.label.toLowerCase()}" `)}</label>`; return ''; } });
  $('#custFields').innerHTML = `<div class="cs-grp">${F.name}${F.phone}${F.email}</div><div class="cs-grp">${F.address}</div>
    <div class="cs-grp"><label class="cs-row"><span>Credit</span><input type="checkbox" class="sw" name="creditOn"${normalizeCustomer(c || {}).creditOn ? ' checked' : ''}></label>
    ${F.creditLimit}</div><div class="co-error" id="custDup" hidden></div>`;
  const name = $('#custFields [name="name"]');
  $('#customerEditTitle').textContent = c ? 'Edit customer' : 'New customer';   // a fixed title in the bar (owner 2026-10-09), the Name row shows the name
  // the tablet: over the page's main pane, as the edit sheet is on Sell; the phone: a full page wherever it sits
  // ponytail: Sell (its picker) and Customers are the only ways in
  const sh = $('#customerEditModal'), frame = state.view === 'customers' ? $('#customersView') : $('.catalog-wrap');
  if (sh.parentNode !== frame) { frame.append(sh); void sh.offsetWidth; }   // moved: settle first, so it still slides up
  sh.classList.add('open');
  setTimeout(() => name.focus(), 50);
}
function closeCustomerEditModal() { $('#customerEditModal').classList.remove('open'); }
// Credit on/off and the limit are a manager's call (TILL_ACTIONS.credit, owner 2026-10-06); `by` = who approved it.
// Only a change to them asks: fixing a phone number never needs a PIN.
function saveSavedCustomerFromModal(by = '') {
  const was = state.customerEditing;
  const values = Object.fromEntries($$('#custFields [name]').map(el => [el.name, el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value]));
  if (!values.creditOn) values.creditLimit = '';   // credit off hides the limit: a stale one there can't block Save
  const { customer, error, field } = customerFromForm(values, was);
  if (error) { showToast(error); $(`#custFields [name="${field}"]`).focus(); return; }
  // Someone else has this phone (bo-model phoneOwner): say so once and offer them; saving again adds anyway.
  const dup = phoneOwner(customer.phone, was?.id), warn = $('#custDup');
  if (dup && warn.dataset.phone !== customer.phone) {
    warn.dataset.phone = customer.phone;
    warn.innerHTML = phoneOwnerNote(dup, `<button type="button" class="link-btn" data-open-cust="${escapeHtml(dup.id)}">Open ${escapeHtml(dup.name)}</button>`);
    warn.hidden = false;
    return;
  }
  const credit = was ? was.creditOn !== customer.creditOn || was.creditLimit !== customer.creditLimit : customer.creditOn;
  if (credit && !by && !gate('credit', (b) => saveSavedCustomerFromModal(b))) return;
  const c = saveCustomer(customer);
  if (!was) track('customer_create', { customerId: c.id });
  closeCustomerEditModal();
  if (state.view === 'customers') renderCustomers();
  showToast(`${was ? 'Saved' : 'Added'} “${c.name}”`);
  // When created mid-sale from the Sell-page picker, attach the new customer to
  // the current receipt straight away (selectCustomer closes the picker too).
  if (state.customerEditFromSale) {
    state.customerEditFromSale = false;
    selectCustomer(c.id);
  }
}
// The cart's money, from the one money module. The order and the receipts still name the tax VAT.
// `cart`/`cartDiscount`: another list's money the same way (a saved cart or quote, draftAsOrder).
// `scPwd`: the cart's SC/PWD cardholder (the edit sheet), never borrowed by another list.
function cartTotals(cart = state.cart, cartDiscount = state.cartDiscount, scPwd = cart === state.cart ? state.scPwd : null) {
  const t = SalesMath.orderTotals(cart, cartDiscount, { ...taxOpts(), scPwd: !!scPwd, scRate: scPwd ? scRateOf(scPwd.kind) : 0.2 });
  return { ...t, vatRate: t.taxRate, vatAmount: t.tax, vatableSales: moneyValue(t.salesBeforeTax - t.vatExempt) };
}

const XCHG_ICON = '<svg class="ic xi" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h15l-4-4M20 16H5l4 4"/></svg>';   // ⇄
function renderCart() {
  const list = $('#cartList');
  const t = cartTotals();
  const n = state.cart.length;
  // An exchange (startExchange): what comes back sits above the new items in the exchange colour (--xchg, the pay
  // button's), minus amounts, its sale's number; the money words say the difference.
  const x = state.exchange && exchangeNow();
  $('#app').classList.toggle('xchg', !!state.exchange);
  const back = x ? `<div class="xb">${x.part.items.map(i => `<div class="row"><span class="nm"><span>${escapeHtml(i.name)}</span><small class="num">${SalesMath.qtyText(i.qty)} × ${peso(i.price)} · #${escapeHtml(x.o.number)}</small></span>
      <span class="amt num">${peso(-normalizeOrderItem(i).lineTotal)}</span></div>`).join('')}</div>` : '';
  if (n === 0) {
    list.innerHTML = back + (x ? '<div class="empty"><b>Add what they take instead</b><span>Tap an item to add it.</span></div>'
      : '<div class="empty"><b>No items yet</b><span>Tap an item to add it.</span></div>');
  } else {
    list.innerHTML = back + state.cart.map(item => `
      <div class="line"><button type="button" class="row" data-id="${item.id}" title="Edit item">
        <span class="nm"><span>${escapeHtml(item.name)}</span><small class="num">${item.qty} × ${peso(item.price)}</small></span>
        <span class="amt num">${peso(normalizeOrderItem(item).lineGross)}</span>
      </button><button type="button" class="sw-del" data-del="${item.id}" tabindex="-1" aria-label="Delete">${esSvg('trash')}</button></div>`).join('');
    list.scrollTop = list.scrollHeight;
  }

  const count = n ? SalesMath.plural(n, 'item') : '';
  $('#cartCount').textContent = count || 'Item';
  $('#railCount').textContent = count;          // beside Total when the band is off
  $('#subtotal').textContent = peso(t.subtotal);
  $('#discount').textContent = peso(-t.discount);   // one minus sign: peso's
  $('#discountRow').style.display = t.discount > 0 ? '' : 'none';
  $('#vatAmount').textContent = peso(t.vatAmount);
  $('#vatLabel').textContent = taxLabel(t.vatRate, t.taxIncluded);
  $('#vatLabel').parentElement.style.display = t.vatRate && !t.scPwd ? '' : 'none';   // a non-VAT store, or a VAT-exempt (SC/PWD) sale, has no tax row: the slips' rule (totalRows)
  // [word, amount]: Collect ₱12 / Hand back ₱8 / Swap; the Total row says it the customer's way.
  // `off`: an account sale's swap for less -- no cash moves, the difference comes off the account (exchangeMoney).
  const off = x && !x.net ? moneyValue(x.credit - x.onAccount) : 0;
  const owe = x && (x.net > 0 ? ['Collect', 'Customer pays', x.net] : x.net < 0 ? ['Hand back', 'Hand back', -x.net] : ['Swap', off ? 'Off account' : 'Even swap', 0]);
  $('#total').textContent = owe ? (owe[2] ? peso(owe[2]) : off ? peso(off) : '') : peso(t.total);
  $('#totalRow .l').firstChild.nodeValue = owe ? owe[1] : 'Total';
  $('#backRow').style.display = x ? '' : 'none';
  if (x) $('#backAmt').textContent = peso(-x.part.total);
  $('#payBtn').disabled = n === 0;
  $('#payBtn').innerHTML = owe ? (n ? `<span>${owe[0]}</span>${owe[2] ? `<span class="num">${peso(owe[2])}</span>` : ''}` : '<span>Exchange</span>')
    : `<span>Check out</span>${n ? `<span class="num">${peso(t.total)}</span>` : ''}`;   // the total rides in the button, the Total row is the checkout's
  $('#side').classList.toggle('empty-cart', n === 0 && !x);
  $('#cartBar').disabled = n === 0 && !x;   // phone: what is in the cart, not Check out; an exchange opens it to see what comes back
  $('#cartBar').innerHTML = x ? `<span>${XCHG_ICON}Exchange</span><span class="num">${n ? (owe[2] ? `${owe[0]} ${peso(owe[2])}` : off ? `${peso(off)} off account` : 'Even swap') : `#${escapeHtml(x.o.number)}`}</span>`
    : n ? `<span>${SalesMath.plural(n, 'item')}</span><span class="num">${peso(t.total)}</span>` : '<span>No items</span>';
  if (!n && !x) $('#app').classList.remove('ph-cart');
  if (scanCardId) drawScanCard();

  renderFulRow();
  const cd = state.cartDiscount && state.cartDiscount.value ? state.cartDiscount : null;
  const discBtn = $('#cartDiscountBtn');
  discBtn.disabled = n === 0;
  discBtn.classList.toggle('on', !!cd || t.scPwd);
  // t.scPwd, not state.scPwd: a bigger line promo wins over SC/PWD (orderTotals), and then no ID goes on the sale
  $('#cartDiscountLabel').textContent = t.scPwd ? ES_SC[state.scPwd.kind] : cd && cd.name ? cd.name : cd && cd.type === 'percent' ? `Discount ${cd.value}%` : 'Discount';
  $('#discountRow > span').textContent = SalesMath.discountName({ cartDiscount: cd, items: state.cart }) || 'Discount';   // the receipt's word (receiptParts)
  $('#cartDiscountAmt').textContent = t.discount > 0 ? peso(-t.discount) : '';
}

// ---------- Customer ----------
function updateCustomerButton() {
  const btn = $('#customerBtn');
  const label = $('#customerLabel');
  if (state.customer) {
    btn.classList.add('has-customer');
    label.textContent = state.customer.name;   // no balance on the bar (owner, 2026-10-05)
  } else {
    btn.classList.remove('has-customer');
    label.textContent = 'Walk-in customer';
  }
}
function renderCustomerPicker() {
  const list = $('#customerList');
  const all = allCustomerRecords();
  list.innerHTML = all.map(c => `
    <button class="customer-row-btn" data-customer-id="${c.id}">
      <div class="cust-avatar">${escapeHtml(c.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
      <div class="cust-meta">
        <div class="cust-name">${escapeHtml(c.name)}</div>
        <div class="cust-sub">${escapeHtml(c.phone || '')}${c.address ? ' · ' + escapeHtml(c.address) : ''}</div>
      </div>
      <div class="cust-balance ${c.currentBalance > 0 ? 'has' : ''}">${peso(c.currentBalance || 0)}</div>
    </button>
  `).join('');
}
function openCustomerModal() {
  if (state.exchange) { showToast('An exchange stays with the original sale’s customer'); return; }   // exchangeOrder
  if (state.view !== 'sell') { renderCustomerPicker(); $('#customerModal').hidden = false; return; }   // ponytail: the checkout pane covers the sheet, so it keeps the old pop-up
  closeEditSheet();
  state.variantModal = { kind: 'cust', query: '' };
  openListSheet('Customers', 'Search name, phone or address', '');
}
// Rows like the variant list: the name, phone and address under it. No balance here (owner, 2026-10-05).
function renderCustomerSheet(vm) {
  const q = vm.query.trim().toLowerCase();
  const all = allCustomerRecords();
  const shown = all.filter(c => !q || [c.name, c.phone, c.address].some(s => String(s || '').toLowerCase().includes(q)));
  const row = (id, name, sub) => `<button type="button" class="vs-row" data-customer-id="${escapeHtml(id)}"><span class="nm">${escapeHtml(name)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span></button>`;
  $('#variantAvail').hidden = true;
  $('#variantCount').textContent = `${shown.length} of ${all.length}`;
  $('#variantList').innerHTML = '<button type="button" class="vs-row vs-new" data-cust-new><span class="vs-plus"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><span class="nm">New customer</span></button>'   // first, searching too: a name that isn't there is the moment to add it
    + (q ? '' : row('walk-in', 'Walk-in customer', ''))
    + shown.map(c => row(c.id, c.name, [c.phone, c.address].filter(Boolean).join(' · '))).join('')
    + (q && !shown.length ? '<div class="vs-empty">No customers match</div>' : '');
}
function selectCustomer(id) {
  const prev = state.customer;
  if (id === 'walk-in') {
    state.customer = null;
  } else {
    state.customer = allCustomerRecords().find(c => c.id === id) || null;
    if (state.customer && state.customer.address && state.fulfilment === 'delivery') {
      state.deliveryAddress = state.customer.address;
    }
  }
  const next = state.customer;
  if (prev && prev.id !== (next && next.id)) track('customer_detach', { customerId: prev.id });
  if (next && next.id !== (prev && prev.id)) track('customer_attach', { customerId: next.id });
  state.cartDiscount = null;
  updateCustomerButton();
  $('#customerModal').hidden = true;
  closeVariantSheet();
  renderCart();
  if (state.view === 'checkout') renderCheckout();
}

// ---------- Lost sale (unfilled request + substitution) ----------
const LOST_DEMAND_REASONS = ['out-of-stock', 'not-carried', 'too-expensive', 'other'];

// One lostDemand row, or null when there is nothing to record. A catalog pick keeps its id and
// name; free text is kept as typed -- that text IS the "not carried" signal a buyer reads.
function lostDemandFields({ product = null, text = '', qty = 1, reason = 'other', substituteProductId = '' } = {}) {
  const name = product ? product.name : String(text || '').trim();
  const n = product ? roundQty(product, toNumber(qty, 0)) : Math.round(toNumber(qty, 0) * 100) / 100;
  if (!name || !(n > 0)) return null;
  return {
    productId: product ? product.id : '',
    text: name,
    qty: n,
    reason: LOST_DEMAND_REASONS.includes(reason) ? reason : 'other',
    substituteProductId: substituteProductId || '',
    terminal: String(currentStoreInfo().registerNo || ''),
  };
}

function openLostSale({ product = null, text = '', qty = 1, reason = 'out-of-stock' } = {}) {
  state.lostSale = { productId: product ? product.id : '', reason };
  $('#lsItemInput').value = product ? product.name : text;
  $('#lsQtyInput').value = qty;
  // ponytail: "bought instead" offers only what is already in the cart -- the cashier suggests B,
  // rings it up, then logs A. A catalog-wide picker here if substitutes turn out to be rung up later.
  $('#lsSubSelect').innerHTML = '<option value="">Nothing</option>' + state.cart
    .filter(i => !product || i.id !== product.id)
    .map(i => `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join('');
  renderLostSale();
  $('#lostSaleModal').hidden = false;
  if (!product && !text) $('#lsItemInput').focus();
}

function renderLostSale() {
  $$('[data-ls-reason]').forEach(b => b.classList.toggle('active', b.dataset.lsReason === state.lostSale.reason));
  const picked = state.products.find(p => p.id === state.lostSale.productId);
  const q = $('#lsItemInput').value.trim();
  const matches = !picked && q && state.fuse
    ? state.fuse.search(q).slice(0, 4).map(r => state.products.find(p => p.id === r.item.id)).filter(Boolean)
    : [];
  $('#lsMatches').innerHTML = picked
    ? `<div class="ls-picked">In catalog · ${picked.stock} ${escapeHtml(picked.unit || '')} on hand</div>`
    : matches.map(p => `
      <button type="button" class="ls-match" data-ls-product="${p.id}">
        <span>${escapeHtml(p.name)}</span><span>${p.stock} ${escapeHtml(p.unit || '')}</span>
      </button>`).join('');
}

function saveLostSale() {
  const fields = lostDemandFields({
    product: state.products.find(p => p.id === state.lostSale.productId) || null,
    text: $('#lsItemInput').value,
    qty: $('#lsQtyInput').value,
    reason: state.lostSale.reason,
    substituteProductId: $('#lsSubSelect').value,
  });
  if (!fields) { showToast('Enter what they asked for and a qty'); return; }
  if (!appendEvents('lostDemand', [makeEvent(fields, currentStoreInfo().cashier)])) {
    showToast('Could not save: storage is full'); return;
  }
  $('#lostSaleModal').hidden = true;
  showToast(`Lost sale logged · ${fields.text}`);
}

