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
    list = state.fuse.search(state.query.trim()).map(r => r.item);
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
  const presets = (viewport <= 720 || width <= 520)
    ? {
        sm: { columns: 2, rows: 5 },
        md: { columns: 2, rows: 4 },
        lg: { columns: 1, rows: 4 },
      }
    : width <= 1100
      ? {
          sm: { columns: 5, rows: 6 },
          md: { columns: 4, rows: 5 },
          lg: { columns: 3, rows: 4 },
        }
      : {
          sm: { columns: 6, rows: 5 },
          md: { columns: 5, rows: 4 },
          lg: { columns: 4, rows: 4 },
        };
  return presets[state.tileSize] || presets.md;
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
        <div class="pc-name">${escapeHtml(g.name)}</div>
      </div>`;
  }
  const p = cell.product;
  return `
    <div class="product-card" data-id="${p.id}">
      <div class="pc-name">${escapeHtml(p.name)}</div>
      <div class="pc-price-mini">${peso(p.price)}</div>
    </div>`;
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
  grid.classList.toggle('show-price', state.showPrice);
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
  const gap = parseFloat(getComputedStyle(grid).gap) || 6;
  const styles = getComputedStyle(catalog);
  const catalogRect = catalog.getBoundingClientRect();
  const searchRect = search.getBoundingClientRect();
  const paddingBottom = parseFloat(styles.paddingBottom || 0);
  const rowGap = parseFloat(styles.gap || 0);
  const measuredHeight = catalogRect.bottom - paddingBottom - searchRect.bottom - rowGap;
  const fallbackHeight = catalog.clientHeight - search.offsetHeight - parseFloat(styles.paddingTop || 0) - paddingBottom - rowGap;
  const available = Math.max(120, Math.floor(measuredHeight || fallbackHeight));
  const rows = profile.rows;
  const columns = profile.columns;
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

// ---------- Variant picker modal ----------
function openVariantModal(groupId) {
  const g = groupById(groupId);
  if (!g) return;
  const members = groupMembers(g.id);
  if (members.length === 0) { showToast('No variants in this group'); return; }

  // Preselect the first in-stock variant (or first if none in stock)
  const firstAvail = members.find(p => p.stock > 0) || members[0];

  state.variantModal = {
    groupId: g.id,
    selectedId: firstAvail.id,
    qty: 1,
    comment: '',
  };

  $('#variantTitle').textContent = g.name;
  $('#variantBasePrice').textContent = peso(firstAvail.price);
  $('#variantQtyInput').value = '1';
  $('#variantCommentInput').value = '';

  renderVariantGrid();
  $('#variantModal').hidden = false;
}

function renderVariantGrid() {
  const grid = $('#variantGrid');
  if (!grid) return;
  const members = groupMembers(state.variantModal.groupId);
  grid.innerHTML = members.map(p => {
    const sel = state.variantModal.selectedId === p.id ? 'selected' : '';
    return `
      <button class="variant-tile ${sel}" data-variant-id="${p.id}">
        <span class="vt-name">${escapeHtml(p.name)}</span>
        <span class="vt-price">${peso(p.price)}</span>
      </button>`;
  }).join('');
}

function selectVariant(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  state.variantModal.selectedId = id;
  $('#variantBasePrice').textContent = peso(p.price);
  renderVariantGrid();
}

function changeVariantQty(delta) {
  const input = $('#variantQtyInput');
  const p = state.products.find(x => x.id === state.variantModal.selectedId);
  // The buttons still step by a whole unit even for wire -- nobody taps + a hundred times
  // to buy a metre. The typed field is what carries the fraction.
  const q = qtyFrom(p, parseFloat(input.value) + delta, stepFor(p));
  input.value = q;
  state.variantModal.qty = q;
}

function addVariantToCart() {
  const vm = state.variantModal;
  if (!vm.selectedId) { showToast('Pick a variant first'); return; }
  const p = state.products.find(x => x.id === vm.selectedId);
  if (!p) return;

  const qty = qtyFrom(p, $('#variantQtyInput').value);
  const comment = $('#variantCommentInput').value.trim();

  beginCart();
  const existing = state.cart.find(i => i.id === p.id && (i.comment || '') === comment);
  if (existing) existing.qty += qty;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty,
    comment: comment || undefined,
  });

  trackItemAdd(p, qty, 'variant');
  renderCart();
  showToast(`Added · ${qty} × ${p.name}`);
  $('#variantModal').hidden = true;
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
  $$('.bb-size-btn[data-size]').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  renderProducts();
}

function setTileText(size) {
  if (!TILE_TEXT_SIZES.includes(size)) return;
  state.tileText = size;
  storageSet(STORAGE_TILE_TEXT, size);
  renderProducts();
}

function toggleShowPrice() {
  state.showPrice = !state.showPrice;
  storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);
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

function addToCart(productId, via = 'other') {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  beginCart();
  const existing = state.cart.find(i => i.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty: 1,
  });
  trackItemAdd(p, 1, via);
  renderCart();
  showToast(`Added · ${p.name}`);
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
    const message = source === 'camera'
      ? `No item found for ${code}`
      : 'No item found for that barcode or SKU';
    showBarcodeStatus(message);
    showToast(message);
    return false;
  }
  // Staff forget to unhide, so a hidden item asks rather than blocks -- like out of stock does.
  if (!onTill(product) && !window.confirm(
    `${product.name}

This item is ${product.archived ? 'archived' : 'hidden'}. Sell anyway?`)) return false;
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
  if (source === 'camera') showBarcodeStatus(`Added ${product.name}`);
  return true;
}

function clearCart() {
  state.exchange = null;   // clearing the cart calls an exchange off (startExchange)
  state.cart = [];
  state.cartId = '';
  state.cartStartedAt = 0;
  state.customer = null;
  state.cartDiscount = null;
  state.paymentMethod = 'cash';
  state.fulfilment = (state.settings && state.settings.defaultFulfilment) || 'walkin';
  state.deliveryAddress = '';
  state.deliveryLocation = null;
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

  const product = findProductByCode(code);
  const added = addProductByCode(code, { source });
  if (added && source === 'camera') {
    showBarcodeStatus(`Added ${product?.name || code}. Scan next item.`);
  }
  return added;
}

function stopBarcodeScanner() {
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
      showBarcodeStatus('Camera is open, but barcode decoding failed. Type the code below.');
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
    showBarcodeStatus('Scanning...');
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
    showBarcodeStatus('Camera scanning needs HTTPS. Type the barcode or SKU below.');
    return;
  }
  try {
    showBarcodeStatus('Allow camera access, then point at the barcode.');
    const detector = await createBarcodeDetector();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    barcodeScanner.stream = stream;
    barcodeScanner.detector = detector;
    barcodeScanner.active = true;
    video.srcObject = stream;
    await video.play();
    if (detector) {
      showBarcodeStatus('Scanning...');
      scheduleBarcodeScan(video);
    } else if (startZxingBarcodeScan(video)) {
      showBarcodeStatus('Scanning...');
    } else {
      showBarcodeStatus('Camera is open. Barcode decoder unavailable, so type the barcode below.');
    }
  } catch (err) {
    console.warn('Camera unavailable', err);
    showBarcodeStatus('Camera was blocked or unavailable. Type the barcode or SKU below.');
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
    showToast('Barcode scanner unavailable. Use manual entry.');
    return false;
  }
}

async function openBarcodeScanner() {
  if (await scanWithCapacitorBarcodePlugin()) return;
  const modal = $('#barcodeModal');
  const input = $('#barcodeManualInput');
  if (!modal) return;
  stopBarcodeScanner();
  if (input) input.value = '';
  showBarcodeStatus('Starting camera...');
  modal.hidden = false;
  startBarcodeCamera();
  flashControl($('#scanBtn'));
}

function submitManualBarcode() {
  const input = $('#barcodeManualInput');
  const code = input?.value || '';
  if (addProductByCode(code, { source: 'manual' })) {
    const product = findProductByCode(code);
    showBarcodeStatus(`Added ${product?.name || 'item'}. Scan or type next item.`);
    if (input) {
      input.value = '';
      input.focus({ preventScroll: true });
    }
  } else {
    input?.focus({ preventScroll: true });
    input?.select();
  }
}

// ---------- Cart item edit modal ----------
function openCartItemModal(id) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  state.cartItemModal.id = id;
  $('#cimTitle').textContent = item.name;
  $('#cimSub').textContent = `${item.sku} · ${peso(item.price)} / ${item.unit}`;
  $('#cimQtyInput').value = item.qty;
  // Discount: prefill from existing item.discount
  const disc = item.discount || { type: 'amount', value: 0 };
  $$('#cartItemModal [data-cim-disc-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.cimDiscType === (disc.type || 'amount')));
  $('#cimDiscInput').value = disc.value ? String(disc.value) : '';
  updateCartItemModalLineTotal();
  $('#cartItemModal').hidden = false;
}
function changeCartItemModalQty(delta) {
  const input = $('#cimQtyInput');
  const p = productOf(state.cart.find(i => i.id === state.cartItemModal.id) || {});
  const q = qtyFrom(p, (parseFloat(input.value) || 0) + delta, stepFor(p));
  input.value = q;
  updateCartItemModalLineTotal();
}
function getCartItemModalDiscount() {
  const typeBtn = document.querySelector('#cartItemModal [data-cim-disc-type].active');
  const type = typeBtn ? typeBtn.dataset.cimDiscType : 'amount';
  const value = parseFloat($('#cimDiscInput').value) || 0;
  return value > 0 ? { type, value } : null;
}
function updateCartItemModalLineTotal() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = qtyFrom(productOf(item), $('#cimQtyInput').value);
  $('#cimLineTotal').textContent = peso(SalesMath.lineMoney(item.price, q, getCartItemModalDiscount(), state.settings.store?.currency).lineTotal);
}
function saveCartItemEdit() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = qtyFrom(productOf(item), $('#cimQtyInput').value);
  if (q !== item.qty) track('item_qty', { productId: item.id, from: item.qty, to: q });
  item.qty = q;
  const disc = getCartItemModalDiscount();
  const was = item.discount || null;
  if (JSON.stringify(disc) !== JSON.stringify(was)) {
    track('discount', { scope: 'line', kind: (disc || was).type, value: disc ? disc.value : 0, productId: item.id });
  }
  if (disc) item.discount = disc; else delete item.discount;
  renderCart();
  $('#cartItemModal').hidden = true;
}
function removeCartItemFromModal() {
  const id = state.cartItemModal.id;
  if (!id) return;
  const gone = state.cart.find(i => i.id === id);
  if (gone) track('item_remove', { productId: gone.id, qty: gone.qty, unitPrice: gone.price });
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
  $('#cartItemModal').hidden = true;
  showToast('Item removed');
}

// ---------- Cart-level discount modal ----------
function openCartDiscountModal() {
  if (state.cart.length === 0) {
    flashControl($('#cartDiscountBtn'));
    flashControl($('#side'));
    return;
  }
  const cd = state.cartDiscount || { type: 'amount', value: 0 };
  $$('#cartDiscountModal [data-cd-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.cdType === (cd.type || 'amount')));
  $('#cdInput').value = cd.value ? String(cd.value) : '';
  $('#cartDiscountModal').hidden = false;
  setTimeout(() => $('#cdInput').focus(), 50);
}
function applyCartDiscount() {
  const typeBtn = document.querySelector('#cartDiscountModal [data-cd-type].active');
  const type = typeBtn ? typeBtn.dataset.cdType : 'amount';
  const value = parseFloat($('#cdInput').value) || 0;
  state.cartDiscount = value > 0 ? { type, value } : null;
  track('discount', { scope: 'cart', kind: type, value: value > 0 ? value : 0 });
  renderCart();
  $('#cartDiscountModal').hidden = true;
}
function clearCartDiscount() {
  if (state.cartDiscount) track('discount', { scope: 'cart', kind: state.cartDiscount.type, value: 0 });
  state.cartDiscount = null;
  renderCart();
  $('#cartDiscountModal').hidden = true;
  flashControl($('#cartDiscountBtn'));
}

// ---------- Fulfilment (Walk-in / Pickup / Delivery / whatever the owner added) ----------
function setFulfilment(mode) {
  if (!fulfilMethods(state.settings).some(m => m.key === mode)) return;
  if (mode === 'delivery') {
    // Address is optional; prefill it when we already know one.
    const addr = state.deliveryAddress || (state.customer && state.customer.address) || '';
    $('#deliveryAddrInput').value = addr;
    updateDeliveryPinStatus();
    $('#deliveryModal').hidden = false;
    return;
  }
  state.fulfilment = mode;
  state.deliveryAddress = '';
  state.deliveryLocation = null;
  renderCart();
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
  row.innerHTML = `<button type="button" class="pick" id="fulPick" aria-haspopup="menu" aria-expanded="false"><span>${escapeHtml(cur.label)}</span>${RAIL_UPDOWN}</button>`;
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
  const t = r.top - top, l = r.left - left;
  const from = `inset(${t}px ${w - l - r.width}px ${H - t - r.height}px ${l}px round 10px)`, to = 'inset(-24px round 34px)';
  m.style.transformOrigin = `${l + r.width / 2}px ${t + r.height / 2}px`;
  m.animate([{ clipPath: from, transform: 'scale(.94)', boxShadow: 'none' }, { clipPath: to, transform: 'none' }], { duration: calmMs(180), easing: 'cubic-bezier(.3,1.45,.55,1)' });
  trigger.setAttribute('aria-expanded', 'true');
  railMenu = { veil, m, from, to, trigger };
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
  const { veil, m, from, to, trigger } = railMenu; railMenu = null;
  trigger.setAttribute('aria-expanded', 'false');
  veil.style.pointerEvents = 'none';
  m.animate([{ clipPath: to }, { clipPath: from, opacity: 0, transform: 'scale(.96)' }], { duration: calmMs(90), easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = () => veil.remove();
}

function saveDeliveryAddress() {
  const addr = $('#deliveryAddrInput').value.trim();
  state.fulfilment = 'delivery';
  state.deliveryAddress = addr;
  $('#deliveryModal').hidden = true;
  renderCart();
  flashControl($('#fulRow'));
}

function deliveryPinLabel(location = state.deliveryLocation) {
  const loc = normalizeDeliveryLocation(location);
  if (!loc) return 'No pin set';
  return `Pinned map location (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`;
}

function updateDeliveryPinStatus() {
  const el = $('#deliveryPinStatus');
  if (el) el.textContent = deliveryPinLabel();
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
// The same fields, words and check as the back office's dialog (bo-model CUSTOMER_FIELDS).
function openCustomerEditModal() {
  $('#customerEditTitle').textContent = 'New customer';
  $('#custFields').innerHTML = customerFieldsHtml({}, { cls: 'text-input', wrap: (f, control, i) =>
    `<label class="pay-label"${i ? ' style="margin-top:10px"' : ''}>${f.label}</label>${control}` })
    + '<div class="co-error" id="custDup" hidden></div>';
  $('#customerEditModal').hidden = false;
  setTimeout(() => $('#custFields [name="name"]').focus(), 50);
}
// Turning credit on at the till is a manager's call (TILL_ACTIONS.credit); `by` = who approved it.
function saveSavedCustomerFromModal(by = '') {
  const values = Object.fromEntries($$('#custFields [name]').map(el => [el.name, el.value]));
  const { customer, error, field } = customerFromForm(values);
  if (error) { showToast(error); $(`#custFields [name="${field}"]`).focus(); return; }
  // Someone else has this phone (bo-model phoneOwner): say so once and offer them; saving again adds anyway.
  const dup = phoneOwner(customer.phone), warn = $('#custDup');
  if (dup && warn.dataset.phone !== customer.phone) {
    warn.dataset.phone = customer.phone;
    warn.innerHTML = phoneOwnerNote(dup, `<button type="button" class="link-btn" data-open-cust="${escapeHtml(dup.id)}">Open ${escapeHtml(dup.name)}</button>`);
    warn.hidden = false;
    return;
  }
  if (customer.creditOn && !by && !gate('credit', (b) => saveSavedCustomerFromModal(b))) return;
  const c = saveCustomer(customer);
  const name = c.name;
  track('customer_create', { customerId: c.id });
  $('#customerEditModal').hidden = true;
  if (state.view === 'customers') renderCustomers();
  showToast(`Added “${name}”`);
  // When created mid-sale from the Sell-page picker, attach the new customer to
  // the current receipt straight away (selectCustomer closes the picker too).
  if (state.customerEditFromSale) {
    state.customerEditFromSale = false;
    selectCustomer(c.id);
  }
}
// The cart's money, from the one money module. The order and the receipts still name the tax VAT.
function cartTotals() {
  const t = SalesMath.orderTotals(state.cart, state.cartDiscount, taxOpts());
  return { ...t, vatRate: t.taxRate, vatAmount: t.tax, vatableSales: moneyValue(t.salesBeforeTax - t.vatExempt) };
}

function renderCart() {
  const list = $('#cartList');
  const t = cartTotals();
  const n = state.cart.length;
  if (n === 0) {
    list.innerHTML = '<div class="empty"><b>No items yet</b><span>Tap an item to add it.</span></div>';
  } else {
    list.innerHTML = state.cart.map(item => `
      <div class="line"><button type="button" class="row" data-id="${item.id}" title="Edit item">
        <span class="nm"><span>${escapeHtml(item.name)}</span><small class="num">${item.qty} × ${peso(item.price)}</small></span>
        <span class="amt num">${peso(normalizeOrderItem(item).lineGross)}</span>
      </button></div>`).join('');
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
  $('#total').textContent = peso(t.total);
  $('#payBtn').disabled = n === 0;
  $('#payBtn').textContent = state.exchange ? 'Exchange' : 'Check out';   // startExchange
  $('#side').classList.toggle('empty-cart', n === 0);

  renderFulRow();
  const cd = state.cartDiscount && state.cartDiscount.value ? state.cartDiscount : null;
  const discBtn = $('#cartDiscountBtn');
  discBtn.disabled = n === 0;
  discBtn.classList.toggle('on', !!cd);
  $('#cartDiscountLabel').textContent = cd && cd.type === 'percent' ? `Discount ${cd.value}%` : 'Discount';
  $('#cartDiscountAmt').textContent = t.discount > 0 ? peso(-t.discount) : '';
}

// ---------- Customer ----------
function updateCustomerButton() {
  const btn = $('#customerBtn');
  const label = $('#customerLabel');
  if (state.customer) {
    btn.classList.add('has-customer');
    label.textContent = `${state.customer.name} · ${peso(accountBalance(state.customer.id))}`;
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
  renderCustomerPicker(); $('#customerModal').hidden = false;
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

