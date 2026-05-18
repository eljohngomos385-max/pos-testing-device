/* ==========================================================
   Hardware POS — UI logic
   - Folders on the page (Sell + Inventory)
   - Shopify-style inventory backend: products CRUD, folder CRUD,
     bulk move/delete, folder filtering
   - Persisted to localStorage
   ========================================================== */

const STORAGE_FOLDERS = 'hwpos.folders.v2';
const STORAGE_PRODUCTS = 'hwpos.products.v2';
const STORAGE_GROUPS = 'hwpos.groups.v1';
const STORAGE_ORDERS = 'hwpos.orders.v1';
const STORAGE_ORDER_SEQ = 'hwpos.orderSeq.v1';
const STORE_INFO = {
  name: 'EJ Hardware',
  address: 'Main Store, Laguna',
  phone: '0917-000-0000',
  tin: '000-000-000-000',
  registerNo: '1',
  cashier: 'El John',
};

// ---------- State ----------
const STORAGE_TILE_SIZE = 'hwpos.tileSize';
const STORAGE_SHOW_PRICE = 'hwpos.showPrice';

const ITEMS_PER_PAGE = { sm: 30, md: 20, lg: 12 };

const state = {
  view: 'sell',
  invTab: 'products',
  folderId: 'all',          // active folder on Sell
  invFolderId: 'all',       // active folder on Inventory
  query: '',
  invQuery: '',
  folders: [],
  products: [],
  groups: [],
  activeGroupId: null,    // when set, sub-grid shows that group's items
  orders: [],
  selectedOrderId: null,
  ordersQuery: '',
  variantModal: { groupId: null, selectedId: null, qty: 1, comment: '' },
  cartItemModal: { id: null },
  cart: [],
  customer: null,
  paymentMethod: 'cash',
  selectedIds: new Set(),
  folderModal: { mode: 'create', editId: null },
  productModal: { mode: 'create', editId: null },
  fuse: null,
  page: 1,
  tileSize: (localStorage.getItem(STORAGE_TILE_SIZE) || 'md'),
  showPrice: localStorage.getItem(STORAGE_SHOW_PRICE) === '1',
};

// ---------- Helpers ----------
const peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const uid = () => 'p_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, 2000);
}

function showConfirm({ title = 'Are you sure?', message = '', okText = 'Confirm', cancelText = 'Cancel', danger = true, onConfirm } = {}) {
  const modal = $('#confirmModal');
  if (!modal) return;
  const titleEl = $('#confirmTitle');
  const msgEl = $('#confirmMessage');
  const okBtn = $('#confirmOkBtn');
  const cancelBtn = modal.querySelector('.secondary-btn[data-close-modal]');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (okBtn) {
    okBtn.textContent = okText;
    okBtn.classList.toggle('danger', !!danger);
  }
  if (cancelBtn) cancelBtn.textContent = cancelText;

  // Replace the OK button to drop any prior click handlers
  if (okBtn) {
    const fresh = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(fresh, okBtn);
    fresh.addEventListener('click', () => {
      modal.hidden = true;
      if (typeof onConfirm === 'function') onConfirm();
    });
  }
  modal.hidden = false;
}

const FOLDER_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ALL_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="6" rx="1.5"/><rect x="14" y="14" width="7" height="6" rx="1.5"/></svg>`;

// ---------- Persistence ----------
function loadFolders() {
  try {
    const raw = localStorage.getItem(STORAGE_FOLDERS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return SEED_FOLDERS.map(f => ({ ...f }));
}
function loadProducts() {
  try {
    const raw = localStorage.getItem(STORAGE_PRODUCTS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return PRODUCTS.map(p => ({ ...p }));
}
function saveFolders() {
  try { localStorage.setItem(STORAGE_FOLDERS, JSON.stringify(state.folders)); } catch (_) {}
}
function saveProducts() {
  try { localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(state.products)); } catch (_) {}
}
function loadGroups() {
  try {
    const raw = localStorage.getItem(STORAGE_GROUPS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return (typeof SEED_GROUPS !== 'undefined') ? SEED_GROUPS.map(g => ({ ...g })) : [];
}
function saveGroups() {
  try { localStorage.setItem(STORAGE_GROUPS, JSON.stringify(state.groups)); } catch (_) {}
}
function groupById(id) { return state.groups.find(g => g.id === id) || null; }
function groupMembers(groupId) {
  return state.products.filter(p => p.groupId === groupId);
}

// ---------- Orders persistence ----------
function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_ORDERS);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}
function saveOrders() {
  try { localStorage.setItem(STORAGE_ORDERS, JSON.stringify(state.orders)); } catch (_) {}
}
function nextOrderNumber() {
  // Format: <register>-<seq3>, e.g. "1-001". Sequence persists across sessions.
  let seq = 0;
  try { seq = parseInt(localStorage.getItem(STORAGE_ORDER_SEQ) || '0', 10) || 0; } catch (_) {}
  seq += 1;
  try { localStorage.setItem(STORAGE_ORDER_SEQ, String(seq)); } catch (_) {}
  return `${STORE_INFO.registerNo}-${String(seq).padStart(3, '0')}`;
}

// ---------- Fuse rebuild ----------
function rebuildFuse() {
  const indexed = state.products.map(p => ({
    ...p,
    searchBlob: [p.name, p.sku, p.barcode, p.brand, ...(p.aliases || [])].join(' ').toLowerCase(),
  }));
  state.fuse = new Fuse(indexed, {
    keys: [
      { name: 'name',       weight: 0.45 },
      { name: 'sku',        weight: 0.30 },
      { name: 'barcode',    weight: 0.05 },
      { name: 'brand',      weight: 0.10 },
      { name: 'aliases',    weight: 0.35 },
      { name: 'searchBlob', weight: 0.20 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
  });
}

// ---------- Folder helpers ----------
function folderCount(folderId) {
  if (folderId === 'all') return state.products.length;
  return state.products.filter(p => p.folder === folderId).length;
}
function folderName(id) {
  const f = state.folders.find(x => x.id === id);
  return f ? f.name : 'Uncategorized';
}

// ---------- Folder strips (Sell + Inventory share) ----------
function renderFolderStrip(containerId, activeId, onClickFolderId) {
  const el = $('#' + containerId);
  if (!el) return;
  el.innerHTML = state.folders.map(f => {
    const active = f.id === activeId;
    const icon = f.id === 'all' ? ALL_ICON : FOLDER_ICON;
    return `
      <button class="folder-pill ${active ? 'active' : ''}" data-folder-id="${f.id}">
        ${icon}
        <span>${escapeHtml(f.name)}</span>
        <span class="folder-pill-count">${folderCount(f.id)}</span>
      </button>`;
  }).join('');
}

function renderSellFolderStrip() {
  // Top-bar dropdown replaces the inline strip on Sell.
  renderFolderDdMenu();
  renderFolderStrip('folderStrip', state.folderId); // safe no-op if removed
}
function renderInvFolderStrip() {
  renderFolderStrip('invFolderStrip', state.invFolderId);
}

// Top-bar folder dropdown
function renderFolderDdMenu() {
  const menu = $('#folderDdMenu');
  if (!menu) return;
  menu.innerHTML = state.folders.map(f => {
    const active = f.id === state.folderId;
    return `
      <button class="ddm-item ${active ? 'active' : ''}" data-folder-id="${f.id}">
        <span>${escapeHtml(f.name)}</span>
        <span class="count">${folderCount(f.id)}</span>
      </button>`;
  }).join('');
  const label = $('#folderDdLabel');
  if (label) {
    const f = state.folders.find(x => x.id === state.folderId);
    label.textContent = f ? f.name : 'All items';
  }
}
function toggleFolderDdMenu(force) {
  const menu = $('#folderDdMenu');
  if (!menu) return;
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
}

function selectFolder(id) {
  state.folderId = id;
  state.page = 1;
  state.activeGroupId = null;   // exit any drilled-in group when changing folder
  renderSellFolderStrip();
  renderSellHeader();
  renderProducts();
}
function selectInvFolder(id) {
  state.invFolderId = id;
  renderInvFolderStrip();
  renderInventory();
}

// ---------- Folder modal ----------
function openFolderModal(mode, editId = null) {
  state.folderModal = { mode, editId };
  $('#folderModalTitle').textContent = mode === 'create' ? 'New Folder' : 'Rename Folder';
  const input = $('#folderNameInput');
  input.value = (mode === 'edit' && editId)
    ? (state.folders.find(x => x.id === editId)?.name || '')
    : '';
  $('#folderModal').hidden = false;
  setTimeout(() => input.focus(), 50);
}

function saveFolder() {
  const name = $('#folderNameInput').value.trim();
  if (!name) { showToast('Enter a folder name'); return; }
  const { mode, editId } = state.folderModal;
  if (mode === 'create') {
    let id = slug(name) || ('folder-' + Date.now());
    let unique = id, i = 2;
    while (state.folders.some(f => f.id === unique)) unique = `${id}-${i++}`;
    state.folders.push({ id: unique, name, builtin: false });
    saveFolders();
    showToast(`Created “${name}”`);
    renderAllFolderUis();
  } else if (mode === 'edit' && editId) {
    const f = state.folders.find(x => x.id === editId);
    if (f) { f.name = name; saveFolders(); showToast('Renamed'); }
    renderAllFolderUis();
  }
  $('#folderModal').hidden = true;
}

function deleteFolder(id) {
  const f = state.folders.find(x => x.id === id);
  if (!f || f.builtin) return;
  const count = folderCount(id);
  const msg = count > 0
    ? `Delete folder “${f.name}”?\n${count} item${count === 1 ? '' : 's'} will become uncategorized.`
    : `Delete folder “${f.name}”?`;
  if (!confirm(msg)) return;
  state.folders = state.folders.filter(x => x.id !== id);
  state.products.forEach(p => { if (p.folder === id) p.folder = ''; });
  saveFolders(); saveProducts();
  if (state.folderId === id) state.folderId = 'all';
  if (state.invFolderId === id) state.invFolderId = 'all';
  renderAllFolderUis();
  showToast('Folder deleted');
}

function renderAllFolderUis() {
  renderSellFolderStrip();
  renderInvFolderStrip();
  renderSellHeader();
  renderProducts();
  renderInventory();
  renderFolderCards();
  populateFolderSelect();
}

// ---------- View switching ----------
function switchView(view) {
  state.view = view;
  $$('.side-link').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  if (view === 'inventory') {
    renderInvFolderStrip();
    renderInventory();
    renderFolderCards();
  }
  if (view === 'orders') {
    // Always pull the latest from localStorage so a sale made in another tab
    // (or any state drift) shows up immediately.
    state.orders = loadOrders();
    renderOrders();
  }
  if (view === 'customers') renderCustomers();
  if (view === 'reports') renderReports();

  // Close any open folder dropdown when leaving the Sell view.
  if (view !== 'sell') {
    const m = $('#folderDdMenu'); if (m) m.hidden = true;
  }
}

function switchInvTab(tab) {
  state.invTab = tab;
  $$('.inv-tab').forEach(t => t.classList.toggle('active', t.dataset.invTab === tab));
  $$('.inv-pane').forEach(p => p.classList.toggle('active', p.dataset.invPane === tab));
  if (tab === 'folders') renderFolderCards();
}

// ---------- Sell view ----------
function renderSellHeader() {
  // Title now lives in the top-bar dropdown — keep this fn for back-compat.
  const folder = state.folders.find(f => f.id === state.folderId);
  const label = $('#folderDdLabel');
  if (label) {
    if (state.activeGroupId) {
      const g = groupById(state.activeGroupId);
      label.textContent = g ? g.name : (folder ? folder.name : 'All items');
    } else {
      label.textContent = folder ? folder.name : 'All items';
    }
  }
  const t = $('#sellTitle'); if (t) t.textContent = folder ? folder.name : 'All Items';
  const c = $('#sellCount');
  if (c) {
    const count = getFilteredSellProducts().length;
    c.textContent = `${count} item${count === 1 ? '' : 's'}`;
  }
  // Pager label is owned by renderPager() — do not write it here.
}

function getFilteredSellProducts() {
  let list = state.products;
  if (state.query.trim()) {
    list = state.fuse.search(state.query.trim()).map(r => r.item);
  }
  if (state.folderId !== 'all') {
    list = list.filter(p => p.folder === state.folderId);
  }
  return list;
}

// What the Sell grid actually renders: either group tiles + loose products
// (when at top level), or a group's members (when drilled in).
// Returns an array of "cells" — each cell is { kind: 'group'|'product'|'back', ... }
function getSellCells() {
  // Drilled into a group → its members only (+ back tile up front)
  if (state.activeGroupId) {
    const g = groupById(state.activeGroupId);
    if (!g) { state.activeGroupId = null; }
    else {
      let members = groupMembers(g.id);
      // Honour search even inside a group
      if (state.query.trim() && state.fuse) {
        const matchIds = new Set(state.fuse.search(state.query.trim()).map(r => r.item.id));
        members = members.filter(p => matchIds.has(p.id));
      }
      const cells = [{ kind: 'back', groupName: g.name }];
      members.forEach(p => cells.push({ kind: 'product', product: p }));
      return cells;
    }
  }

  // Top level — show groups (whose members live in this folder) + ungrouped products.
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

function stockMeta(p) {
  if (p.stock <= 0) return { cls: 'out', label: 'Out of stock' };
  if (p.stock <= p.reorderPoint) return { cls: 'low', label: `Low · ${p.stock} ${p.unit}` };
  return { cls: '', label: `${p.stock} ${p.unit}` };
}

function totalPages() {
  const cells = getSellCells();
  const per = ITEMS_PER_PAGE[state.tileSize] || 20;
  return Math.max(1, Math.ceil(cells.length / per));
}

function clampPage() {
  const max = totalPages();
  if (state.page > max) state.page = max;
  if (state.page < 1) state.page = 1;
}

function renderProducts() {
  const grid = $('#productGrid');
  const cells = getSellCells();

  // Set size + price-display attrs on the grid
  grid.dataset.size = state.tileSize;
  grid.classList.toggle('show-price', state.showPrice);

  if (cells.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <svg class="nr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/>
        </svg>
        <div class="nr-title">No items found</div>
        <div class="nr-sub">Try a different keyword or pick another folder</div>
      </div>`;
    renderPager();
    renderSellHeader();
    return;
  }

  // Slice for current page
  clampPage();
  const per = ITEMS_PER_PAGE[state.tileSize] || 20;
  const start = (state.page - 1) * per;
  const pageCells = cells.slice(start, start + per);

  grid.innerHTML = pageCells.map(cell => {
    if (cell.kind === 'back') {
      return `
        <div class="product-card pc-back" data-act="back" title="Back">
          <div class="pc-back-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 6 9 12 15 18"/>
            </svg>
          </div>
          <div class="pc-name">Back</div>
        </div>`;
    }
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
    const disabled = p.stock <= 0 ? 'data-disabled="true"' : '';
    return `
      <div class="product-card" data-id="${p.id}" ${disabled}>
        <div class="pc-name">${escapeHtml(p.name)}</div>
        <div class="pc-price-mini">${peso(p.price)}</div>
      </div>`;
  }).join('');

  renderPager();
  renderSellHeader();
}

function openGroup(groupId) {
  if (!groupById(groupId)) return;
  state.activeGroupId = groupId;
  state.page = 1;
  renderProducts();
  renderSellHeader();
}
function closeGroup() {
  state.activeGroupId = null;
  state.page = 1;
  renderProducts();
  renderSellHeader();
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
    const out = p.stock <= 0 ? 'out' : '';
    const priceLabel = p.stock <= 0 ? 'Out of stock' : peso(p.price);
    return `
      <button class="variant-tile ${sel} ${out}" data-variant-id="${p.id}" ${p.stock <= 0 ? 'data-disabled="true"' : ''}>
        <span class="vt-name">${escapeHtml(p.name)}</span>
        <span class="vt-price">${priceLabel}</span>
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
  let q = parseInt(input.value, 10) || 1;
  q = Math.max(1, q + delta);
  input.value = q;
  state.variantModal.qty = q;
}

function addVariantToCart() {
  const vm = state.variantModal;
  if (!vm.selectedId) { showToast('Pick a variant first'); return; }
  const p = state.products.find(x => x.id === vm.selectedId);
  if (!p) return;
  if (p.stock <= 0) { showToast('Variant is out of stock'); return; }

  const qty = Math.max(1, parseInt($('#variantQtyInput').value, 10) || 1);
  const comment = $('#variantCommentInput').value.trim();

  const existing = state.cart.find(i => i.id === p.id && (i.comment || '') === comment);
  if (existing) existing.qty += qty;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty,
    comment: comment || undefined,
  });

  renderCart();
  showToast(`Added · ${qty} × ${p.name}`);
  $('#variantModal').hidden = true;
}

function renderPager() {
  const total = totalPages();
  const label = $('#bbPageLabel');
  if (label) label.textContent = `PAGE ${state.page} / ${total}`;
  const prev = $('#bbPrevBtn');
  const next = $('#bbNextBtn');
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= total;

  // Page dots (cap at 7 visible)
  const dots = $('#bbPageDots');
  if (dots) {
    const maxDots = Math.min(total, 7);
    let html = '';
    for (let i = 1; i <= maxDots; i++) {
      html += `<span class="bb-pagedot ${i === Math.min(state.page, maxDots) ? 'active' : ''}"></span>`;
    }
    dots.innerHTML = html;
  }
}

function changePage(delta) {
  const t = totalPages();
  state.page = Math.min(t, Math.max(1, state.page + delta));
  renderProducts();
}

function setTileSize(size) {
  if (!ITEMS_PER_PAGE[size]) return;
  state.tileSize = size;
  state.page = 1;
  try { localStorage.setItem(STORAGE_TILE_SIZE, size); } catch (_) {}
  $$('.bb-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === size));
  renderProducts();
}

function toggleShowPrice() {
  state.showPrice = !state.showPrice;
  try { localStorage.setItem(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0'); } catch (_) {}
  $('#bbViewBtn')?.classList.toggle('active', state.showPrice);
  renderProducts();
}

// ---------- Cart ----------
function addToCart(productId) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  if (p.stock <= 0) { showToast('Item is out of stock'); return; }
  const existing = state.cart.find(i => i.id === productId);
  if (existing) existing.qty += 1;
  else state.cart.push({
    id: p.id, name: p.name, sku: p.sku, brand: p.brand,
    unit: p.unit, price: p.price, qty: 1,
  });
  renderCart();
  showToast(`Added · ${p.name}`);
}

function changeQty(id, delta) {
  const i = state.cart.find(x => x.id === id);
  if (!i) return;
  i.qty += delta;
  if (i.qty <= 0) state.cart = state.cart.filter(x => x.id !== id);
  renderCart();
}
function removeFromCart(id) {
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
}
function clearCart() {
  state.cart = [];
  state.customer = null;
  renderCart();
  updateCustomerButton();
}

// ---------- Cart item edit modal ----------
function openCartItemModal(id) {
  const item = state.cart.find(i => i.id === id);
  if (!item) return;
  state.cartItemModal.id = id;
  $('#cimTitle').textContent = item.name;
  $('#cimSub').textContent = `${item.sku} · ${peso(item.price)} / ${item.unit}`;
  $('#cimQtyInput').value = item.qty;
  updateCartItemModalLineTotal();
  $('#cartItemModal').hidden = false;
}
function changeCartItemModalQty(delta) {
  const input = $('#cimQtyInput');
  let q = parseInt(input.value, 10) || 1;
  q = Math.max(1, q + delta);
  input.value = q;
  updateCartItemModalLineTotal();
}
function updateCartItemModalLineTotal() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = Math.max(1, parseInt($('#cimQtyInput').value, 10) || 1);
  $('#cimLineTotal').textContent = peso(item.price * q);
}
function saveCartItemEdit() {
  const item = state.cart.find(i => i.id === state.cartItemModal.id);
  if (!item) return;
  const q = Math.max(1, parseInt($('#cimQtyInput').value, 10) || 1);
  item.qty = q;
  renderCart();
  $('#cartItemModal').hidden = true;
}
function removeCartItemFromModal() {
  const id = state.cartItemModal.id;
  if (!id) return;
  state.cart = state.cart.filter(i => i.id !== id);
  renderCart();
  $('#cartItemModal').hidden = true;
  showToast('Item removed');
}
function cartTotals() {
  const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
  return { subtotal, discount: 0, total: subtotal };
}

function renderCart() {
  const list = $('#cartList');
  const t = cartTotals();
  if (state.cart.length === 0) {
    list.innerHTML = '';
  } else {
    list.innerHTML = state.cart.map(item => `
      <button class="cart-item" data-id="${item.id}" title="Edit item">
        <div class="ci-main">
          <div class="ci-name">${escapeHtml(item.name)}</div>
          <div class="ci-sub">${escapeHtml(item.sku)} · ${peso(item.price)}${item.qty > 1 ? ` × ${item.qty}` : ''}</div>
        </div>
        <div class="ci-right">${peso(item.price * item.qty)}</div>
      </button>
    `).join('');
  }

  $('#cartCount').textContent = `${state.cart.reduce((s, i) => s + i.qty, 0)} items`;
  $('#subtotal').textContent = peso(t.subtotal);
  $('#discount').textContent = peso(t.discount);
  $('#total').textContent = peso(t.total);
  const pa = $('#payAmount'); if (pa) pa.textContent = peso(t.total);
  $('#payBtn').disabled = state.cart.length === 0;
  const sb = $('#saveBtn'); if (sb) sb.disabled = state.cart.length === 0;
}

// ---------- Customer ----------
function updateCustomerButton() {
  const btn = $('#customerBtn');
  const label = $('#customerLabel');
  if (state.customer) {
    btn.classList.add('has-customer');
    label.textContent = `${state.customer.name} · ${peso(state.customer.currentBalance)}`;
  } else {
    btn.classList.remove('has-customer');
    label.textContent = 'Walk-in customer';
  }
}
function renderCustomerPicker() {
  const list = $('#customerList');
  list.innerHTML = CUSTOMERS.map(c => `
    <button class="customer-row-btn" data-customer-id="${c.id}">
      <div class="cust-avatar">${escapeHtml(c.name.split(' ').map(w => w[0]).slice(0, 2).join(''))}</div>
      <div class="cust-meta">
        <div class="cust-name">${escapeHtml(c.name)}</div>
        <div class="cust-sub">${escapeHtml(c.phone)} · Limit ${peso(c.creditLimit)}</div>
      </div>
      <div class="cust-balance ${c.currentBalance > 0 ? 'has' : ''}">${peso(c.currentBalance)}</div>
    </button>
  `).join('');
}
function openCustomerModal() { renderCustomerPicker(); $('#customerModal').hidden = false; }
function selectCustomer(id) {
  state.customer = id === 'walk-in' ? null : (CUSTOMERS.find(c => c.id === id) || null);
  updateCustomerButton();
  $('#customerModal').hidden = true;
}

// ---------- Payment ----------
function openPaymentModal() {
  if (state.cart.length === 0) return;
  const { total } = cartTotals();
  $('#payTotalValue').textContent = peso(total);
  $('#payCustomerLine').textContent = state.customer
    ? `Charge to ${state.customer.name}`
    : 'Walk-in customer';
  state.paymentMethod = state.customer ? 'credit' : 'cash';
  $$('.seg').forEach(s => s.classList.toggle('active', s.dataset.method === state.paymentMethod));
  syncPayFields();
  $('#tenderInput').value = '';
  $('#changeValue').textContent = peso(0);
  $('#paymentModal').hidden = false;
  if (state.paymentMethod === 'cash') setTimeout(() => $('#tenderInput').focus(), 60);
}
function syncPayFields() {
  $('#payFields').style.display = state.paymentMethod === 'credit' ? 'none' : '';
}
function updateChange() {
  const { total } = cartTotals();
  const tender = parseFloat($('#tenderInput').value) || 0;
  $('#changeValue').textContent = peso(Math.max(0, tender - total));
}
function completeSale() {
  const totals = cartTotals();
  const total = totals.total;
  let tendered = total, change = 0;
  if (state.paymentMethod === 'cash') {
    tendered = parseFloat($('#tenderInput').value) || 0;
    if (tendered < total) { showToast('Insufficient cash tendered'); return; }
    change = tendered - total;
  }
  if (state.paymentMethod === 'credit' && !state.customer) {
    showToast('Select a credit customer first'); return;
  }

  // Build + persist the order record
  const order = {
    id: 'ord_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3),
    number: nextOrderNumber(),
    ts: Date.now(),
    cashier: STORE_INFO.cashier,
    register: STORE_INFO.registerNo,
    items: state.cart.map(i => ({ ...i })),
    customer: state.customer ? { id: state.customer.id, name: state.customer.name, phone: state.customer.phone } : null,
    paymentMethod: state.paymentMethod,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total,
    tendered,
    change,
  };
  state.orders.unshift(order);
  saveOrders();

  // Decrement stock for sold items (mockup-level)
  order.items.forEach(it => {
    const p = state.products.find(x => x.id === it.id);
    if (p) p.stock = Math.max(0, p.stock - it.qty);
  });
  saveProducts();

  const msg = state.customer
    ? `Charged ${peso(total)} to ${state.customer.name} · ${order.number}`
    : `Sale complete · ${order.number} · ${peso(total)}`;
  showToast(msg);
  clearCart();
  $('#paymentModal').hidden = true;

  // Refresh the orders list if it's visible
  if (state.view === 'orders') renderOrders();

  // Print the 80mm receipt
  openReceipt(order);
}

// ---------- Orders view ----------
function fmtOrderTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  if (sameDay(d, today)) return `Today, ${time}`;
  if (sameDay(d, yest)) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ', ' + time;
}

function fmtReceiptTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: '2-digit', day: '2-digit' })
    + ' ' + d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function orderItemCount(o) {
  return o.items.reduce((s, i) => s + i.qty, 0);
}

function renderOrders() {
  const list = $('#ordersList');
  const count = $('#ordersCount');
  if (!list) return;

  // Defensive: make sure state.orders is an array (and refresh from storage).
  if (!Array.isArray(state.orders)) state.orders = loadOrders();

  if (state.orders.length === 0) {
    if (count) count.textContent = 'No orders yet';
    list.innerHTML = `
      <div class="orders-empty">
        <div class="empty-glyph">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div class="empty-title">No sales yet</div>
        <div class="empty-sub">Completed sales will appear here</div>
      </div>`;
    renderOrderDetail();
    return;
  }

  if (count) {
    const n = state.orders.length;
    count.textContent = `${n} order${n === 1 ? '' : 's'}`;
  }

  // Apply search filter (number or customer name)
  const q = (state.ordersQuery || '').trim().toLowerCase();
  const filtered = q
    ? state.orders.filter(o =>
        o.number.toLowerCase().includes(q) ||
        (o.customer && o.customer.name.toLowerCase().includes(q)))
    : state.orders;

  // Auto-select the most recent matching order if nothing's selected yet
  if (filtered.length > 0 && !filtered.find(o => o.id === state.selectedOrderId)) {
    state.selectedOrderId = filtered[0].id;
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="orders-empty">
        <div class="empty-title">No matches</div>
        <div class="empty-sub">Try a different order number or name</div>
      </div>`;
    renderOrderDetail();
    return;
  }

  list.innerHTML = filtered.map(o => {
    const active = state.selectedOrderId === o.id ? 'active' : '';
    const cust = o.customer ? o.customer.name : 'Walk-in';
    const method = o.paymentMethod === 'credit' ? 'Charged' : 'Cash';
    return `
      <div class="order-row ${active}" data-order-id="${o.id}">
        <div class="or-body">
          <div class="or-head">
            <span class="or-number">#${escapeHtml(o.number)}</span>
            <span class="or-total">${peso(o.total)}</span>
          </div>
          <div class="or-meta">
            <span class="or-cust">${escapeHtml(cust)}</span>
            <span class="or-sep">·</span>
            <span class="or-method">${method}</span>
          </div>
          <div class="or-foot">
            <span>${fmtOrderTime(o.ts)}</span>
            <span>${orderItemCount(o)} item${orderItemCount(o) === 1 ? '' : 's'}</span>
          </div>
        </div>
        <button class="or-receipt-btn" data-act="view-receipt" data-order-id="${o.id}" title="View receipt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2z"/>
            <line x1="8" y1="9" x2="14" y2="9"/>
            <line x1="8" y1="13" x2="14" y2="13"/>
            <line x1="8" y1="17" x2="12" y2="17"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  renderOrderDetail();
}

function renderOrderDetail() {
  const detail = $('#orderDetail');
  if (!detail) return;
  const o = state.orders.find(x => x.id === state.selectedOrderId);
  if (!o) {
    detail.innerHTML = `
      <div class="order-detail-empty">
        <div class="empty-title">Select an order</div>
        <div class="empty-sub">Pick one from the list to view items and reprint the receipt</div>
      </div>`;
    return;
  }

  const itemsHtml = o.items.map(i => `
    <div class="od-item">
      <div class="od-item-main">
        <div class="od-item-name">${escapeHtml(i.name)}</div>
        <div class="od-item-sub">${escapeHtml(i.sku || '')} · ${peso(i.price)} × ${i.qty} ${escapeHtml(i.unit || '')}</div>
      </div>
      <div class="od-item-amt">${peso(i.price * i.qty)}</div>
    </div>`).join('');

  const cust = o.customer ? o.customer.name : 'Walk-in customer';
  const method = o.paymentMethod === 'credit' ? 'Charged to account' : 'Cash';

  detail.innerHTML = `
    <div class="od-head">
      <div>
        <div class="od-number">Order #${escapeHtml(o.number)}</div>
        <div class="od-time">${fmtReceiptTime(o.ts)} · ${escapeHtml(o.cashier || '')}</div>
      </div>
      <button class="primary-btn small" id="reprintBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2z"/>
          <line x1="8" y1="9" x2="14" y2="9"/>
          <line x1="8" y1="13" x2="14" y2="13"/>
          <line x1="8" y1="17" x2="12" y2="17"/>
        </svg>
        <span>View receipt</span>
      </button>
    </div>
    <div class="od-meta-row">
      <div><span class="muted">Customer</span><strong>${escapeHtml(cust)}</strong></div>
      <div><span class="muted">Payment</span><strong>${method}</strong></div>
      <div><span class="muted">Register</span><strong>${escapeHtml(o.register || '1')}</strong></div>
    </div>
    <div class="od-items">${itemsHtml}</div>
    <div class="od-totals">
      <div class="row"><span>Subtotal</span><span>${peso(o.subtotal)}</span></div>
      <div class="row"><span>Discount</span><span>${peso(o.discount)}</span></div>
      <div class="row total"><span>Total</span><span>${peso(o.total)}</span></div>
      ${o.paymentMethod === 'cash' ? `
        <div class="row"><span>Tendered</span><span>${peso(o.tendered)}</span></div>
        <div class="row"><span>Change</span><span>${peso(o.change)}</span></div>` : ''}
    </div>`;

  $('#reprintBtn')?.addEventListener('click', () => openReceipt(o));
}

function selectOrder(id) {
  state.selectedOrderId = id;
  renderOrders();
}

// ---------- 80mm thermal receipt ----------
function buildReceiptHtml(order) {
  const lines = order.items.map(i => `
    <div class="r-item">
      <div class="r-item-name">${escapeHtml(i.name)}</div>
      <div class="r-item-row">
        <span>${i.qty} ${escapeHtml(i.unit || '')} × ${peso(i.price)}</span>
        <span>${peso(i.price * i.qty)}</span>
      </div>
    </div>`).join('');

  const cust = order.customer
    ? `<div class="r-cust">Customer: ${escapeHtml(order.customer.name)}</div>`
    : '';
  const payRows = order.paymentMethod === 'cash'
    ? `
      <div class="r-row"><span>CASH</span><span>${peso(order.tendered)}</span></div>
      <div class="r-row"><span>CHANGE</span><span>${peso(order.change)}</span></div>`
    : `<div class="r-row"><span>CHARGED TO ACCOUNT</span><span>${peso(order.total)}</span></div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${escapeHtml(order.number)}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    font-family: "SF Mono", "Menlo", "Consolas", "Courier New", monospace;
    font-size: 12px;
    line-height: 1.35;
    width: 80mm;
    padding: 4mm 4mm 6mm;
  }
  .r-center { text-align: center; }
  .r-store { font-size: 15px; font-weight: 700; letter-spacing: 0.5px; }
  .r-store-sub { font-size: 11px; }
  .r-rule { border-top: 1px dashed #000; margin: 6px 0; }
  .r-double { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; }
  .r-meta { font-size: 11px; }
  .r-meta div { display: flex; justify-content: space-between; }
  .r-item { margin: 4px 0; }
  .r-item-name { font-weight: 700; }
  .r-item-row { display: flex; justify-content: space-between; font-size: 11px; }
  .r-row { display: flex; justify-content: space-between; }
  .r-total { font-size: 14px; font-weight: 700; }
  .r-foot { font-size: 11px; margin-top: 6px; }
  .r-cust { font-size: 11px; margin: 2px 0; }
  .r-thanks { margin-top: 8px; font-weight: 700; }
  .r-actions { margin-top: 12px; display: flex; gap: 6px; }
  .r-actions button {
    flex: 1; font-family: inherit; font-size: 12px; padding: 8px;
    border: 1px solid #000; background: #fff; cursor: pointer;
  }
  .r-actions button.primary { background: #000; color: #fff; }
  @media print {
    .r-actions { display: none; }
    body { padding: 2mm 4mm 4mm; }
  }
</style>
</head>
<body>
  <div class="r-center r-store">${escapeHtml(STORE_INFO.name)}</div>
  <div class="r-center r-store-sub">${escapeHtml(STORE_INFO.address)}</div>
  <div class="r-center r-store-sub">Tel: ${escapeHtml(STORE_INFO.phone)}</div>
  <div class="r-center r-store-sub">TIN: ${escapeHtml(STORE_INFO.tin)}</div>

  <div class="r-rule"></div>

  <div class="r-meta">
    <div><span>Receipt #</span><span>${escapeHtml(order.number)}</span></div>
    <div><span>Date</span><span>${fmtReceiptTime(order.ts)}</span></div>
    <div><span>Cashier</span><span>${escapeHtml(order.cashier || '')}</span></div>
    <div><span>Register</span><span>${escapeHtml(order.register || '1')}</span></div>
  </div>
  ${cust}

  <div class="r-rule"></div>

  ${lines}

  <div class="r-rule"></div>

  <div class="r-row"><span>Subtotal</span><span>${peso(order.subtotal)}</span></div>
  <div class="r-row"><span>Discount</span><span>${peso(order.discount)}</span></div>
  <div class="r-double r-row r-total"><span>TOTAL</span><span>${peso(order.total)}</span></div>
  ${payRows}

  <div class="r-rule"></div>

  <div class="r-center r-thanks">Salamat po!</div>
  <div class="r-center r-foot">This serves as your official receipt.</div>
  <div class="r-center r-foot">Goods sold are not returnable.</div>

  <div class="r-actions">
    <button onclick="window.close()">Close</button>
    <button class="primary" onclick="window.print()">Print</button>
  </div>

  <script>
    // Auto-trigger the print dialog once rendered.
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 200);
    });
  </script>
</body>
</html>`;
}

function openReceipt(order) {
  const html = buildReceiptHtml(order);
  // Open a slim window sized roughly for the 80mm preview.
  const w = window.open('', 'hwpos_receipt_' + order.id,
    'width=360,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!w) {
    showToast('Pop-up blocked — allow pop-ups to print receipts');
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ============================================================
// INVENTORY BACKEND
// ============================================================

function getFilteredInvProducts() {
  let list = state.products;
  if (state.invQuery.trim()) {
    list = state.fuse.search(state.invQuery.trim()).map(r => r.item);
  }
  if (state.invFolderId !== 'all') {
    list = list.filter(p => p.folder === state.invFolderId);
  }
  return list;
}

function renderInventory() {
  const tbody = $('#inventoryTable tbody');
  const list = getFilteredInvProducts();
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:48px 16px;color:var(--ink-tertiary)">
      <div style="font-size:13px;font-weight:510;color:var(--ink-secondary);margin-bottom:4px">No products</div>
      <div style="font-size:12px">Add a product or pick a different folder</div>
    </td></tr>`;
  } else {
    tbody.innerHTML = list.map(p => {
      const initial = (p.brand?.[0] || p.name?.[0] || '?').toUpperCase();
      let status = 'ok', label = 'In stock';
      if (p.stock <= 0) { status = 'out'; label = 'Out of stock'; }
      else if (p.stock <= p.reorderPoint) { status = 'low'; label = 'Low stock'; }
      const checked = state.selectedIds.has(p.id) ? 'checked' : '';
      const selectedCls = state.selectedIds.has(p.id) ? 'selected' : '';
      return `
        <tr class="${selectedCls}" data-id="${p.id}">
          <td class="check-col" data-noedit><input type="checkbox" class="row-check" data-id="${p.id}" ${checked}/></td>
          <td>
            <div class="item-cell">
              <div class="item-glyph">${escapeHtml(initial)}</div>
              <div>
                <div class="item-name">${escapeHtml(p.name)}</div>
                <div class="item-aliases">${escapeHtml((p.aliases || []).slice(0, 3).join(' · '))}</div>
              </div>
            </div>
          </td>
          <td><span class="code-chip">${escapeHtml(p.sku)}</span></td>
          <td>${escapeHtml(p.brand)}</td>
          <td>${escapeHtml(folderName(p.folder))}</td>
          <td class="num">${p.stock} ${escapeHtml(p.unit || '')}</td>
          <td class="num">${peso(p.cost)}</td>
          <td class="num"><strong>${peso(p.price)}</strong></td>
          <td><span class="status-pill ${status}"><span class="dot"></span>${label}</span></td>
          <td class="action-col" data-noedit>
            <div class="row-actions">
              <button title="Edit" data-act="edit-product" data-id="${p.id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6L8 22H2v-6z"/></svg>
              </button>
              <button class="danger" title="Delete" data-act="delete-product" data-id="${p.id}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Sync select-all checkbox state
  const all = $('#selectAll');
  if (all) {
    const ids = list.map(p => p.id);
    const selectedInList = ids.filter(id => state.selectedIds.has(id)).length;
    all.checked = ids.length > 0 && selectedInList === ids.length;
    all.indeterminate = selectedInList > 0 && selectedInList < ids.length;
  }
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $('#bulkBar');
  const n = state.selectedIds.size;
  if (n === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  $('#bulkCount').textContent = `${n} selected`;
}

function renderBulkMoveMenu() {
  const menu = $('#bulkMoveMenu');
  menu.innerHTML = state.folders.filter(f => f.id !== 'all').map(f => `
    <button class="dropdown-item" data-move-to="${f.id}">
      <span>${escapeHtml(f.name)}</span>
      <span class="count">${folderCount(f.id)}</span>
    </button>
  `).join('');
  if (state.folders.filter(f => f.id !== 'all').length === 0) {
    menu.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--ink-tertiary)">No folders yet. Create one first.</div>`;
  }
}

function toggleSelect(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id);
  else state.selectedIds.add(id);
  renderInventory();
}
function clearSelection() {
  state.selectedIds.clear();
  renderInventory();
}

function bulkMoveTo(folderId) {
  const ids = Array.from(state.selectedIds);
  ids.forEach(id => {
    const p = state.products.find(x => x.id === id);
    if (p) p.folder = folderId;
  });
  saveProducts();
  showToast(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to ${folderName(folderId)}`);
  state.selectedIds.clear();
  renderAllFolderUis();
}

function bulkDelete() {
  const n = state.selectedIds.size;
  if (n === 0) return;
  if (!confirm(`Delete ${n} product${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
  state.products = state.products.filter(p => !state.selectedIds.has(p.id));
  state.selectedIds.clear();
  saveProducts();
  rebuildFuse();
  renderAllFolderUis();
  showToast(`Deleted ${n} product${n === 1 ? '' : 's'}`);
}

function deleteProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Delete “${p.name}”?`)) return;
  state.products = state.products.filter(x => x.id !== id);
  state.selectedIds.delete(id);
  saveProducts();
  rebuildFuse();
  renderAllFolderUis();
  showToast('Product deleted');
}

// ---------- Product modal ----------
function populateFolderSelect() {
  const sel = $('#pf_folder');
  if (!sel) return;
  const current = sel.value;
  const opts = ['<option value="">— Uncategorized —</option>']
    .concat(state.folders.filter(f => f.id !== 'all').map(f =>
      `<option value="${f.id}">${escapeHtml(f.name)}</option>`));
  sel.innerHTML = opts.join('');
  if (current) sel.value = current;
}

function openProductModal(mode, editId = null) {
  state.productModal = { mode, editId };
  $('#productModalTitle').textContent = mode === 'create' ? 'Add Product' : 'Edit Product';
  populateFolderSelect();

  const fields = {
    pf_name: '', pf_sku: '', pf_barcode: '', pf_brand: '',
    pf_folder: state.invFolderId !== 'all' ? state.invFolderId : '',
    pf_unit: 'pc', pf_cost: '', pf_price: '', pf_stock: '0', pf_reorder: '0', pf_aliases: ''
  };
  if (mode === 'edit' && editId) {
    const p = state.products.find(x => x.id === editId);
    if (p) {
      Object.assign(fields, {
        pf_name: p.name, pf_sku: p.sku, pf_barcode: p.barcode || '',
        pf_brand: p.brand || '', pf_folder: p.folder || '',
        pf_unit: p.unit || 'pc', pf_cost: p.cost ?? '', pf_price: p.price ?? '',
        pf_stock: p.stock ?? 0, pf_reorder: p.reorderPoint ?? 0,
        pf_aliases: (p.aliases || []).join(', '),
      });
    }
  }
  Object.entries(fields).forEach(([id, val]) => { $('#' + id).value = val; });
  $('#productModal').hidden = false;
  setTimeout(() => $('#pf_name').focus(), 50);
}

function saveProduct() {
  const name = $('#pf_name').value.trim();
  const sku = $('#pf_sku').value.trim();
  if (!name) { showToast('Name is required'); $('#pf_name').focus(); return; }
  if (!sku) { showToast('SKU is required'); $('#pf_sku').focus(); return; }

  const data = {
    name,
    sku,
    barcode: $('#pf_barcode').value.trim(),
    brand: $('#pf_brand').value.trim() || 'Generic',
    folder: $('#pf_folder').value || '',
    unit: $('#pf_unit').value.trim() || 'pc',
    cost: parseFloat($('#pf_cost').value) || 0,
    price: parseFloat($('#pf_price').value) || 0,
    stock: parseInt($('#pf_stock').value, 10) || 0,
    reorderPoint: parseInt($('#pf_reorder').value, 10) || 0,
    aliases: $('#pf_aliases').value.split(',').map(s => s.trim()).filter(Boolean),
  };

  const { mode, editId } = state.productModal;
  if (mode === 'create') {
    state.products.push({ id: uid(), ...data });
    showToast(`Added “${data.name}”`);
  } else if (mode === 'edit' && editId) {
    const p = state.products.find(x => x.id === editId);
    if (p) Object.assign(p, data);
    showToast('Product updated');
  }
  saveProducts();
  rebuildFuse();
  renderAllFolderUis();
  $('#productModal').hidden = true;
}

// ---------- Folder cards (Inventory > Folders) ----------
function renderFolderCards() {
  const grid = $('#folderCards');
  if (!grid) return;
  const cards = state.folders.filter(f => f.id !== 'all').map(f => {
    const builtinClass = f.builtin ? '' : '';
    return `
      <div class="folder-card" data-folder-id="${f.id}">
        <div class="fc-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          </svg>
        </div>
        <div class="fc-name">${escapeHtml(f.name)}</div>
        <div class="fc-count">${folderCount(f.id)} item${folderCount(f.id) === 1 ? '' : 's'}</div>
        <div class="fc-menu">
          <button data-act="rename-folder" data-id="${f.id}" title="Rename">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4l6 6L8 22H2v-6z"/></svg>
          </button>
          <button class="danger" data-act="delete-folder" data-id="${f.id}" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
  grid.innerHTML = cards + `
    <button class="folder-card add-card" id="addFolderCard">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>New folder</span>
    </button>`;
}

// ---------- Customers / Reports ----------
function renderCustomers() {
  const grid = $('#customersGrid');
  grid.innerHTML = CUSTOMERS.map(c => {
    const cls = c.currentBalance === 0 ? '' : (c.currentBalance >= c.creditLimit ? 'over' : 'has');
    const initials = c.name.split(' ').map(w => w[0]).slice(0, 2).join('');
    return `
      <div class="cust-card">
        <div class="cust-card-head">
          <div class="cust-card-avatar">${escapeHtml(initials)}</div>
          <div>
            <div class="cust-card-name">${escapeHtml(c.name)}</div>
            <div class="cust-card-phone">${escapeHtml(c.phone)}</div>
          </div>
        </div>
        <div class="cust-card-meta">
          <div class="row"><span class="label">Address</span><span>${escapeHtml(c.address)}</span></div>
          <div class="row"><span class="label">Credit limit</span><span>${peso(c.creditLimit)}</span></div>
        </div>
        <div class="cust-card-balance">
          <span class="cust-card-balance-label">Current Utang</span>
          <span class="cust-card-balance-value ${cls}">${peso(c.currentBalance)}</span>
        </div>
      </div>`;
  }).join('');
}

function renderReports() {
  const revenue = RECENT_SALES.reduce((s, x) => s + x.amount, 0);
  const txns = RECENT_SALES.length;
  const avg = txns > 0 ? revenue / txns : 0;
  const low = state.products.filter(p => p.stock <= p.reorderPoint).length;
  $('#statRevenue').textContent = peso(revenue);
  $('#statTxns').textContent = txns;
  $('#statAvg').textContent = peso(avg);
  $('#statLow').textContent = low;
  $('#recentList').innerHTML = RECENT_SALES.map(s => `
    <div class="recent-row">
      <div>
        <div class="r-id">${escapeHtml(s.id)}${s.customer ? ' · ' + escapeHtml(s.customer) : ''}</div>
        <div class="r-time">Today, ${escapeHtml(s.time)}</div>
      </div>
      <span class="r-method">${escapeHtml(s.method)}</span>
      <span class="r-amt">${peso(s.amount)}</span>
    </div>
  `).join('');
}

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
  // Tap anywhere outside the sidebar (backdrop or main content) to close it
  document.addEventListener('click', (e) => {
    const app = $('#app');
    if (app.classList.contains('sidebar-collapsed')) return;
    if (e.target.closest('.sidebar')) return;
    if (e.target.closest('#sidebarToggle')) return;
    app.classList.add('sidebar-collapsed');
  });
  // Close the sidebar automatically after picking a nav item
  $$('.side-link').forEach(t => t.addEventListener('click', () => {
    $('#app').classList.add('sidebar-collapsed');
  }));

  // ---- Top bar: folder dropdown ----
  $('#folderDdBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFolderDdMenu();
  });
  $('#folderDdMenu')?.addEventListener('click', (e) => {
    const item = e.target.closest('.ddm-item');
    if (!item) return;
    selectFolder(item.dataset.folderId);
    toggleFolderDdMenu(false);
  });
  document.addEventListener('click', (e) => {
    const menu = $('#folderDdMenu');
    if (!menu || menu.hidden) return;
    if (!e.target.closest('#folderDdMenu') && !e.target.closest('#folderDdBtn')) {
      toggleFolderDdMenu(false);
    }
  });

  // ---- Bell (notifications) — surfaces low-stock / out-of-stock alerts ----
  $('#notifBtn')?.addEventListener('click', () => {
    const out = state.products.filter(p => p.stock <= 0).length;
    const low = state.products.filter(p => p.stock > 0 && p.stock <= p.reorderPoint).length;
    if (out === 0 && low === 0) { showToast('All stock levels healthy'); return; }
    const parts = [];
    if (out) parts.push(`${out} out of stock`);
    if (low) parts.push(`${low} low stock`);
    showToast(parts.join(' · '));
  });
  // Hide/show the red dot based on whether there's actually anything to alert about.
  function refreshNotifDot() {
    const dot = $('#notifDot');
    if (!dot) return;
    const hasAlert = state.products.some(p => p.stock <= p.reorderPoint);
    dot.style.display = hasAlert ? '' : 'none';
  }
  refreshNotifDot();

  // ---- Bottom bar: pagination ----
  $('#bbPrevBtn')?.addEventListener('click', () => changePage(-1));
  $('#bbNextBtn')?.addEventListener('click', () => changePage(1));

  // ---- Bottom bar: tile size toggle (S / M / L) ----
  $$('.bb-size-btn').forEach(btn => {
    btn.addEventListener('click', () => setTileSize(btn.dataset.size));
  });

  // ---- Bottom bar: toggle price display on tiles ----
  $('#bbViewBtn')?.addEventListener('click', toggleShowPrice);

  // ---- Save button on cart (decorative for now) ----
  $('#saveBtn')?.addEventListener('click', () => {
    if (state.cart.length === 0) return;
    showToast('Ticket saved');
  });

  // ---- Sell folder strip (legacy, no-op if removed) ----
  $('#folderStrip')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.folder-pill');
    if (pill) selectFolder(pill.dataset.folderId);
  });

  // ---- Sell search ----
  const search = $('#searchInput'), clear = $('#searchClear');
  search.addEventListener('input', (e) => {
    state.query = e.target.value;
    state.page = 1;
    clear.classList.toggle('visible', !!state.query);
    renderProducts();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const products = getFilteredSellProducts();
      if (products.length === 1) {
        addToCart(products[0].id);
        search.value = ''; state.query = '';
        clear.classList.remove('visible');
        renderProducts();
      }
    }
  });
  clear.addEventListener('click', () => {
    search.value = ''; state.query = '';
    clear.classList.remove('visible');
    renderProducts(); search.focus();
  });
  $('#scanBtn').addEventListener('click', () => showToast('Camera scanner — connect on device'));

  // ---- Product grid (Sell) ----
  $('#productGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    if (!card) return;
    // Back tile inside a group (only when drilled in — left for back-compat)
    if (card.dataset.act === 'back') { closeGroup(); return; }
    // Group parent tile → open the variant picker modal
    if (card.dataset.groupId) { openVariantModal(card.dataset.groupId); return; }
    // Regular product
    if (card.dataset.disabled === 'true') { showToast('Item is out of stock'); return; }
    addToCart(card.dataset.id);
  });

  // ---- Variant picker modal ----
  $('#variantGrid')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.variant-tile');
    if (!tile) return;
    if (tile.dataset.disabled === 'true') { showToast('Variant is out of stock'); return; }
    selectVariant(tile.dataset.variantId);
  });
  $$('#variantModal .vq-btn').forEach(b => {
    b.addEventListener('click', () => {
      changeVariantQty(b.dataset.act === 'inc' ? 1 : -1);
    });
  });
  $('#variantQtyInput')?.addEventListener('input', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    state.variantModal.qty = q;
  });
  $('#variantQtyInput')?.addEventListener('blur', (e) => {
    const q = Math.max(1, parseInt(e.target.value, 10) || 1);
    e.target.value = q;
  });
  $('#variantAddBtn')?.addEventListener('click', addVariantToCart);

  // ---- Orders list (sidebar view) ----
  $('#ordersList')?.addEventListener('click', (e) => {
    // Quick-view receipt icon (don't bubble to row-select)
    const recBtn = e.target.closest('[data-act="view-receipt"]');
    if (recBtn) {
      e.stopPropagation();
      const o = state.orders.find(x => x.id === recBtn.dataset.orderId);
      if (o) openReceipt(o);
      return;
    }
    const row = e.target.closest('.order-row');
    if (!row) return;
    selectOrder(row.dataset.orderId);
  });
  // Orders search
  $('#ordersSearch')?.addEventListener('input', (e) => {
    state.ordersQuery = e.target.value;
    renderOrders();
  });

  // ---- Cart row click → open edit modal ----
  $('#cartList').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-item');
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
  $('#clearCartBtn').addEventListener('click', () => {
    if (state.cart.length === 0) return;
    showConfirm({
      title: 'Clear receipt?',
      message: 'All items in the current receipt will be removed. This cannot be undone.',
      okText: 'Yes, clear',
      cancelText: 'Cancel',
      danger: true,
      onConfirm: () => {
        clearCart();
        showToast('Cart cleared');
      }
    });
  });

  // ---- Customer ----
  $('#customerBtn').addEventListener('click', openCustomerModal);
  $('#customerModal').addEventListener('click', (e) => {
    const row = e.target.closest('[data-customer-id]');
    if (row) selectCustomer(row.dataset.customerId);
  });

  // ---- Modals ----
  $$('[data-close-modal]').forEach(b => {
    b.addEventListener('click', () => $$('.modal-backdrop').forEach(m => m.hidden = true));
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal-backdrop').forEach(m => m.hidden = true);
  });

  // ---- Pay ----
  $('#payBtn').addEventListener('click', openPaymentModal);
  $$('.seg').forEach(seg => {
    seg.addEventListener('click', () => {
      $$('.seg').forEach(s => s.classList.remove('active'));
      seg.classList.add('active');
      state.paymentMethod = seg.dataset.method;
      syncPayFields();
      if (state.paymentMethod === 'credit' && !state.customer) {
        $('#paymentModal').hidden = true;
        openCustomerModal();
        showToast('Pick a credit customer');
      }
    });
  });
  $('#tenderInput').addEventListener('input', updateChange);
  $$('.quick-cash button').forEach(b => {
    b.addEventListener('click', () => {
      const { total } = cartTotals();
      $('#tenderInput').value = b.dataset.cash === 'exact' ? total.toFixed(2) : b.dataset.cash;
      updateChange();
    });
  });
  $('#completeSaleBtn').addEventListener('click', completeSale);

  // ============================================================
  // INVENTORY
  // ============================================================

  // Tab switching
  $$('.inv-tab').forEach(t => t.addEventListener('click', () => switchInvTab(t.dataset.invTab)));

  // Inventory folder strip
  $('#invFolderStrip').addEventListener('click', (e) => {
    const pill = e.target.closest('.folder-pill');
    if (pill) selectInvFolder(pill.dataset.folderId);
  });

  // Inventory search
  $('#invSearchInput').addEventListener('input', (e) => {
    state.invQuery = e.target.value;
    renderInventory();
  });

  // Select all
  $('#selectAll').addEventListener('change', (e) => {
    const ids = getFilteredInvProducts().map(p => p.id);
    if (e.target.checked) ids.forEach(id => state.selectedIds.add(id));
    else ids.forEach(id => state.selectedIds.delete(id));
    renderInventory();
  });

  // Inventory table — row clicks, checkboxes, action buttons
  $('#inventoryTable tbody').addEventListener('click', (e) => {
    // Action button
    const actBtn = e.target.closest('button[data-act]');
    if (actBtn) {
      e.stopPropagation();
      if (actBtn.dataset.act === 'edit-product') openProductModal('edit', actBtn.dataset.id);
      if (actBtn.dataset.act === 'delete-product') deleteProduct(actBtn.dataset.id);
      return;
    }
    // Checkbox
    const check = e.target.closest('input.row-check');
    if (check) {
      toggleSelect(check.dataset.id);
      return;
    }
    // Row body click → edit
    const noedit = e.target.closest('[data-noedit]');
    if (noedit) return;
    const row = e.target.closest('tr[data-id]');
    if (row) openProductModal('edit', row.dataset.id);
  });

  // Bulk actions
  $('#bulkClear').addEventListener('click', clearSelection);
  $('#bulkDeleteBtn').addEventListener('click', bulkDelete);
  $('#bulkMoveBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    renderBulkMoveMenu();
    const menu = $('#bulkMoveMenu');
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => {
    const menu = $('#bulkMoveMenu');
    if (!menu || menu.hidden) return;
    if (!e.target.closest('#bulkMoveDropdown')) menu.hidden = true;
  });
  $('#bulkMoveMenu').addEventListener('click', (e) => {
    const item = e.target.closest('[data-move-to]');
    if (item) {
      bulkMoveTo(item.dataset.moveTo);
      $('#bulkMoveMenu').hidden = true;
    }
  });

  // Header buttons
  $('#newProductBtn').addEventListener('click', () => openProductModal('create'));
  $('#newFolderBtn').addEventListener('click', () => openFolderModal('create'));

  // Product modal save
  $('#saveProductBtn').addEventListener('click', saveProduct);

  // Folder modal save
  $('#saveFolderBtn').addEventListener('click', saveFolder);
  $('#folderNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveFolder();
  });

  // Folder cards events (delegated on body since rerendered)
  document.addEventListener('click', (e) => {
    if (e.target.closest('#addFolderCard')) { openFolderModal('create'); return; }
    const renameBtn = e.target.closest('[data-act="rename-folder"]');
    if (renameBtn) { e.stopPropagation(); openFolderModal('edit', renameBtn.dataset.id); return; }
    const delBtn = e.target.closest('[data-act="delete-folder"]');
    if (delBtn) { e.stopPropagation(); deleteFolder(delBtn.dataset.id); return; }
    const card = e.target.closest('.folder-card:not(.add-card)');
    if (card) {
      switchInvTab('products');
      selectInvFolder(card.dataset.folderId);
    }
  });

  // Sync flicker
  let online = true;
  setInterval(() => {
    if (Math.random() < 0.03) {
      online = !online;
      const pill = $('#syncPill');
      pill.innerHTML = online
        ? '<span class="dot dot-ok"></span><span>Synced</span>'
        : '<span class="dot dot-warn"></span><span>Offline</span>';
    }
  }, 4000);
}

// ---------- Init ----------
function init() {
  state.folders = loadFolders();
  // Ensure "all" exists
  if (!state.folders.find(f => f.id === 'all')) {
    state.folders.unshift({ id: 'all', name: 'All Items', builtin: true });
  }
  state.products = loadProducts();
  state.groups = loadGroups();
  state.orders = loadOrders();
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

  renderSellFolderStrip();
  renderSellHeader();
  renderProducts();
  renderCart();
  updateCustomerButton();
  populateFolderSelect();
  attachEvents();

  // Sync persisted UI state on first paint
  $$('.bb-size-btn').forEach(b => b.classList.toggle('active', b.dataset.size === state.tileSize));
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
    // Sales made in another tab (e.g. second POS instance) — refresh orders list.
    if (e.key === STORAGE_ORDERS) {
      state.orders = loadOrders();
      if (state.view === 'orders') renderOrders();
    }
    // Stock changes from another tab — refresh product tiles.
    if (e.key === STORAGE_PRODUCTS) {
      state.products = loadProducts();
      rebuildFuse();
      if (state.view === 'sell') renderProducts();
    }
  });
  // Also refresh when the user returns to the POS tab in case they changed it
  // in the back office on another tab.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const newSize = localStorage.getItem(STORAGE_TILE_SIZE) || 'md';
    const newShow = localStorage.getItem(STORAGE_SHOW_PRICE) === '1';
    let changed = false;
    if (newSize !== state.tileSize && ITEMS_PER_PAGE[newSize]) { state.tileSize = newSize; state.page = 1; changed = true; }
    if (newShow !== state.showPrice) { state.showPrice = newShow; changed = true; }
    if (changed) renderProducts();
    // Always re-pull orders so the list is up to date.
    state.orders = loadOrders();
    if (state.view === 'orders') renderOrders();
  });
}
document.addEventListener('DOMContentLoaded', init);
