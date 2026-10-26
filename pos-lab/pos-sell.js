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

// What the Sell grid actually renders: My page's tiles, or (All items, or anything searched) group tiles + loose products.
// Returns an array of "cells" — each cell is { kind: 'group'|'product'|'cat'|'add', ... }
function getSellCells() {
  if (state.sellPage === 'mine' && !state.query.trim()) { spillMyPages(); return myPageCells(); }   // a tile back on show (unarchived) pushes on, never alone
  return toCells(getFilteredSellProducts());
}
// Group tiles in state.groups' order, then the loose products in theirs.
function toCells(products) {
  const cells = [], seen = new Set(products.map(p => p.groupId).filter(Boolean));
  state.groups.forEach(g => { if (seen.has(g.id)) cells.push({ kind: 'group', group: g, memberCount: products.filter(p => p.groupId === g.id).length }); });
  products.forEach(p => { if (!p.groupId) cells.push({ kind: 'product', product: p }); });
  return cells;
}

// ---------- My page (owner 2026-10-21): this POS's own tiles - items, variant items, categories - then Add tile ----------
// One list in order; a tile marked br starts a new page (moved there on its own). So a page never has a gap, and any tile
// size repacks the same order into its own pages. This POS's own, like Tile size. A move or a remove first marks every page's
// first tile br, so a tile leaving a page closes the gap on that page only - the next page keeps its first tile (owner 2026-10-21).
// The marks hold at the page size they were made at (myPageSize); another size (Tile size, a turned iPad) repacks by order.
const myTiles = () => { try { const v = JSON.parse(HWPOS_STORE.ui.get('myPage', '[]')); return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []; } catch { return []; } };
const saveMyTiles = t => HWPOS_STORE.ui.set('myPage', JSON.stringify(t));
const tileKey = t => t.cat ? 'c' + t.cat : t.g ? 'g' + t.g : 'p' + t.id;
const liveFolders = () => state.folders.filter(f => f.id !== 'all' && !f.archived);
const catProducts = id => state.products.filter(p => onTill(p) && (foldersOf(p).includes(id) || groupById(p.groupId)?.folder === id));
function myPageCells() {
  const keep = HWPOS_STORE.ui.get('myPageSize', '') === String(sellPageSize());   // page marks made at this size
  let carry = false;   // a hidden tile's page mark goes to the next one on show: its page stays a page
  const cells = myTiles().map((t, at) => {
    let c = null;
    if (t.cat) { const f = liveFolders().find(x => x.id === t.cat), n = f && toCells(catProducts(f.id)).length; if (n) c = { kind: 'cat', folder: f, n }; }
    else if (t.g) { const g = groupById(t.g), n = g ? groupMembers(g.id).length : 0; if (n) c = { kind: 'group', group: g, memberCount: n }; }
    else { const p = state.products.find(x => x.id === t.id); if (p && onTill(p)) c = { kind: 'product', product: p }; }
    const br = keep && (!!t.br || carry);
    carry = !c && br;
    return c && Object.assign(c, { at, br });
  }).filter(Boolean);
  return [...cells, { kind: 'add' }];
}
// The pages: a new one when the last is full or a tile starts its own
function sellPages(cells, size = sellPageSize()) {
  const pages = [];
  cells.forEach(c => { if (!pages.length || pages.at(-1).length >= size || c.br) pages.push([]); pages.at(-1).push(c); });
  return pages;
}
const pageOfTile = at => sellPages(getSellCells()).findIndex(pg => pg.some(c => c.at === at)) + 1;
function setSellPage(m) {
  state.sellPage = m; HWPOS_STORE.ui.set('sellPage', m);
  state.page = 1; myEdit(false);
  renderSellSwitch(); renderProducts();
  const g = $('.view-sell'); g.classList.remove('sp-swap'); void g.offsetWidth; g.classList.add('sp-swap');   // the whole Sell page blurs in, so a switch reads as a change
  g.onanimationend = g.onanimationcancel = e => e.target === g && g.classList.remove('sp-swap');   // off once played: a class left on replays each time Sell shows again
}
const TRAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';   // My page (owner 2026-10-21)
const LAYERS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';   // All items
// The sidebar's switch: its icon is the page you are on
function renderSellSwitch() {
  const b = $('#sellSwitch'); if (!b) return;
  const mine = state.sellPage === 'mine';
  b.innerHTML = mine ? TRAY : LAYERS;
  b.setAttribute('aria-label', mine ? 'My page, tap for All items' : 'All items, tap for My page');
}
// Move tile i to { before: j } or { after: j } (j = a tile's index now), or 'new': alone onto a new last page. Returns its new index.
function moveMyTile(i, to) {
  const t = pinMyPages(), it = t[i], r = t[to.before ?? to.after], nx = t[myPageCells().find(c => c.at > i)?.at];
  if (r === it) return i;
  t.splice(i, 1);
  if (it.br && nx) nx.br = true;   // the next tile on show keeps its page (a hidden one in between holds none)   // the tile after it keeps its page
  it.br = to === 'new';
  if (to === 'new') t.push(it);
  else if ('after' in to) t.splice(t.indexOf(r) + 1, 0, it);
  else { if (r.br) { r.br = false; it.br = true; } t.splice(t.indexOf(r), 0, it); }   // it takes r's place, r's page too
  saveMyTiles(t);
  spillMyPages();
  return t.indexOf(it);
}
// My page's tiles with every page's first marked br: the pages as they are now stay put
function pinMyPages() {   // only those: a hidden tile holds no mark; saved with the page size they hold at
  spillMyPages();   // a tile back on show that overfilled its page first pushes onto the next one
  const t = myTiles();
  t.forEach(x => delete x.br);
  sellPages(myPageCells()).forEach((pg, n) => { if (n && pg[0].at != null) t[pg[0].at].br = true; });
  saveMyTiles(t); HWPOS_STORE.ui.set('myPageSize', String(sellPageSize()));
  return t;
}
// A full page that took one more pushes its last tile onto the front of the next page (iPhone home screen), not onto a page alone
function spillMyPages() {
  for (let n = 1, pages = sellPages(myPageCells()); n < pages.length - 1; n++) {
    if (pages[n][0].br || !pages[n + 1][0].br) continue;   // a page started by a spill, then a pinned page: join them
    const t = myTiles(); t[pages[n][0].at].br = true; t[pages[n + 1][0].at].br = false; saveMyTiles(t);
    pages = sellPages(myPageCells()); n--;
  }
}
function removeMyTile(i) {
  const t = pinMyPages(), nx = t[myPageCells().find(c => c.at > i)?.at], [it] = t.splice(i, 1);
  if (it?.br && nx) nx.br = true;
  saveMyTiles(t); renderProducts();
}
// Long-press = edit: the tiles wiggle and wear an ×; Check out reads Done (owner 2026-10-21: a clear way out), a tap anywhere else ends it too
let myEditing = false, myLifted = null, myDrop = null;   // myDrop: ends a drag in progress   // myLifted: the dragged tile's index, its slot drawn empty on every redraw
function myEdit(on) {
  if (myEditing === on) return;
  myEditing = on;
  $('#productGrid')?.classList.toggle('mp-edit', on);
  if (!on) { myDrop?.(); myLifted = null; $$('#productGrid .mp-ghost').forEach(g => g.remove()); }   // fail-safe: a lifted copy never outlives editing
  renderCart();
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
  // phone: Loyverse-style square tiles, 3 across (S 4, L 2); as many rows as keep them nearest square.
  // Wide: 2 across, rows as Medium's, so the tiles are Medium's height and wider (owner 2026-10-13)
  const columns = { sm: 4, md: 3, wide: 2, lg: 2 }[state.tileSize] || 3, gap = 8, cs = getComputedStyle(catalog);
  const sq = state.tileSize === 'wide' ? 3 : columns;
  const h = catalog.clientHeight - $('#catalogSearchRow').offsetHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.rowGap);
  const size = (width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - gap * (sq - 1)) / sq;
  const show = tileShowNow(), lines = show === 'name' ? 0 : show === 'both' ? 2 : 1;   // rows beside the name
  const tall = state.tilePics === 'top' ? 1 + 0.2 * lines : 1;   // ponytail: each line needs ~20% more height so the photo keeps its size; measure if a size clips
  return { columns, rows: Math.max(2, Math.round((h + gap) / (size * tall + gap))) };
}

function sellPageSize(profile = getSellGridProfile()) {
  return Math.max(1, profile.columns * profile.rows);
}

function totalPages(cells = getSellCells()) {
  return Math.max(1, sellPages(cells).length);
}

function clampPage(cells = getSellCells()) {
  const max = totalPages(cells);
  if (state.page > max) state.page = max;
  if (state.page < 1) state.page = 1;
}

function renderSellCellHtml(cell) {
  if (cell.kind === 'add') return '<button type="button" class="product-card pc-add" data-add><b aria-hidden="true">+</b>Add tile</button>';
  const at = cell.at == null ? '' : ` data-at="${cell.at}"${cell.at === myLifted ? ' data-lifted' : ''}`, x = at && '<button type="button" class="pc-x" data-remove aria-label="Remove from My page"></button>';
  if (cell.kind === 'cat') {   // a category: its items open in the variant sheet (openCatSheet)
    const f = cell.folder, art = tileArt(f);
    return `
      <div class="product-card pc-group pc-cat${art.cls}" data-cat="${f.id}"${at}${art.style}>${art.html}${x}
        <span class="pc-top"><span>${SalesMath.plural(cell.n, 'item')}</span></span><div class="pc-name">${escapeHtml(f.name)}</div>
      </div>`;
  }
  if (cell.kind === 'group') {
    const g = cell.group, art = tileArt(g);
    return `
      <div class="product-card pc-group${art.cls}" data-group-id="${g.id}"${at} title="${escapeHtml(g.name)}"${art.style}>${art.html}${x}
        <div class="pc-name">${escapeHtml(g.name)}</div>${tileMeta(groupMembers(g.id), cell.memberCount)}
      </div>`;
  }
  const p = cell.product, art = tileArt(p);
  return `
    <div class="product-card${art.cls}" data-id="${p.id}"${at}${art.style}>${art.html}${x}
      <div class="pc-name">${escapeHtml(p.name)}</div>${tileMeta([p], 1)}
    </div>`;
}
// Settings › Tiles show is the two keys there already were: showPrice (shared with the back office's switch) and this
// till's tileStock. Both on = Price and stock, so the back office turning price on never hides this till's counts.
const tileShowNow = () => state.tileStock && state.showPrice ? 'both' : state.tileStock ? 'stock' : state.showPrice ? 'price' : 'name';
function setTileShow(v) {
  state.showPrice = v === 'price' || v === 'both';
  storageSet(STORAGE_SHOW_PRICE, state.showPrice ? '1' : '0');
  state.tileStock = v === 'stock' || v === 'both';
  HWPOS_STORE.ui.set('tileStock', state.tileStock ? '1' : '0');
  renderProducts();
}
// The tile (owner 2026-10-17, the Items list's phone row in a square): stock top-left ("420 pcs", warn when low,
// "Out"), the variant count badge always top-right, the name low, the price (a group's range) right under it.
function tileMeta(ps, vn) {
  const show = tileShowNow(), top = [];
  let pr = '';
  if (show === 'stock' || show === 'both') {
    const counted = ps.filter(m => m.trackStock !== false);
    if (counted.length) {
      const lv = familyLevel(counted), n = counted.reduce((s, m) => s + Math.max(0, toNumber(m.stock, 0)), 0);
      const u = counted.every(m => (m.unit || 'pc') === (counted[0].unit || 'pc')) ? ' ' + tileUnit(n, counted[0].unit || 'pc') : '';
      top.push(`<span class="pc-stk ${lv}">${lv === 'out' ? 'Out' : SalesMath.qtyText(n) + u}</span>`);
    }
  }
  if (vn > 1) top.push(`<span class="pc-var" aria-label="${vn} variants">${vn}</span>`);
  if (show === 'price' || show === 'both') pr = `<span class="pc-pr">${priceRange(ps)}</span>`;
  return (top.length ? `<span class="pc-top">${top.join('')}</span>` : '') + pr;
}
const tileUnit = (n, u = 'pc') => /^(pc|bag|roll|pair|box|set|pack)$/.test(u) ? SalesMath.pluralWord(n, u, u === 'box' ? 'boxes' : u + 's') : u;
// Settings › Tile pictures (owner 2026-10-14): Photo top / Photo fills draws the item's photo; with no photo (or pictures
// off) the tile colour set in the item editor paints the tile, else it is the plain tile.
function tileArt(row) {
  const { img, hue } = itemLook(row);
  if (img && state.tilePics !== 'off') return { cls: ' pc-pic', style: '', html: `<span class="pc-img"><img src="${escapeHtml(img)}" alt="" draggable="false"></span>` };
  return hue == null ? { cls: '', style: '', html: '' } : { cls: ' pc-tc', style: ` style="--tc:${hue}"`, html: '' };
}
// Settings › Cart pictures: the photo before a line's name (the cart and the checkout's list), Small / Medium / Large
// (owner 2026-10-14, Grab's order summary for Large); no photo = the tile colour or a blank square, so the names still line up.
function linePic(item) {
  if (state.cartPics === 'off') return '';
  const p = productOf(item), { img, hue } = p ? itemLook(p) : {};
  return `<span class="pic" data-s="${state.cartPics}"${hue == null || img ? '' : ` style="--tc:${hue}"`}>${img ? `<img src="${escapeHtml(img)}" alt="">` : itemInitials(p?.name || item.name)}</span>`;   // no photo: its letters, as the Sell list
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
  grid.dataset.pics = state.tilePics;
  grid.style.setProperty('--grid-cols', profile.columns);
  grid.style.setProperty('--grid-rows', profile.rows);
  if (grid.classList.contains('sl') !== sellAsList())   // tiles <-> list (a search starts or ends): fade the new one in, not a cut
    grid.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: calmMs(200), easing: 'ease-out' });
  if (!sellAsList()) { grid.classList.remove('sl'); delete grid.dataset.sl; delete grid.dataset.q; }

  if (cells.length === 0) {
    grid.innerHTML = `
      <div class="no-results">
        <svg class="nr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/>
        </svg>
        <div class="nr-title">No items found</div>
        <div class="nr-sub">Try a different word or scan it</div>
        ${state.query.trim() ? `<button class="text-btn nr-lost" type="button" data-act="lost-sale">Log “${escapeHtml(state.query.trim())}” as a lost sale</button>` : ''}
      </div>`;
    renderSellHeader();
    requestAnimationFrame(syncSellGridMetrics);
    return;
  }

  if (sellAsList()) { renderSellList(grid, cells); return; }
  clampPage(cells);
  const pages = sellPages(cells, sellPageSize(profile));
  grid.classList.toggle('mp-edit', myEditing && cells.at(-1).kind === 'add');

  // The track stays: a redraw on page 2 doesn't slide in from page 1, and My page's lifted tile (a sibling) survives it
  if (!$('#productTrack')) grid.innerHTML = '<div class="product-page-track" id="productTrack"></div>';
  $('#productTrack').innerHTML = pages.map((pageCells, index) => `
        <div class="product-page" data-page="${index + 1}">
          ${pageCells.map(renderSellCellHtml).join('')}
        </div>`).join('');

  renderSellHeader();
  requestAnimationFrame(() => {
    syncSellGridMetrics();
    updateProductTrackPosition();
  });
}

// ---------- Sell as a list (owner 2026-10-23, pos-list's "Thin list V3, amount 510"): All items - and any search - as rows, A to Z;
// My page stays tiles. Settings › View: grid | list | rows (each item its own card). The row is the category sheet's (.vs-row);
// a tap adds, a hold peeks, as a tile. Tile pictures and Tile text size work on it too ----------
const sellAsList = () => !!state.query.trim() || (state.sellLayout !== 'grid' && state.sellPage !== 'mine');   // a search is always a list, Grid too (owner 2026-10-25)
function setSellLayout(v) {
  if (state.sellLayout === 'grid' && v !== 'grid' && state.tilePics === 'off') { state.tilePics = 'top'; HWPOS_STORE.ui.set('tilePics', 'top'); }   // List on turns the pictures on; they can go off again
  state.sellLayout = v; HWPOS_STORE.ui.set('sellLayout', v); renderProducts();
}
function sellListRow(c) {
  const g = c.kind === 'group' ? c.group : null, r = g || c.product, ps = g ? groupMembers(g.id) : [r], { img, hue } = itemLook(r);
  const counted = ps.filter(m => m.trackStock !== false), lv = counted.length ? familyLevel(counted) : '';
  const n = counted.reduce((s, m) => s + Math.max(0, toNumber(m.stock, 0)), 0), u = counted.every(m => (m.unit || 'pc') === (counted[0].unit || 'pc')) ? ' ' + escapeHtml(counted[0]?.unit || 'pc') : '';   // mixed units: no unit
  const stk = !counted.length ? '' : lv === 'out' ? '<b>Out of stock</b>' : `<span class="${lv}">${SalesMath.qtyText(n)}${u} in stock</span>`;
  const sub = [stk, g ? `${c.memberCount} variants` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="vs-row" ${g ? `data-group-id="${g.id}"` : `data-id="${r.id}"`}><span class="pic"${hue == null || img ? '' : ` style="--tc:${hue}"`}>${img ? `<img src="${escapeHtml(img)}" alt="" draggable="false">` : itemInitials(r.name)}</span>
    <span class="nm">${escapeHtml(r.name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="amt num">${priceRange(ps)}</span></button>`;
}
let slHtml = '', slCard = null;   // the list last drawn
function renderSellList(grid, cells) {
  const name = c => (c.group || c.product).name;
  if (!state.query.trim()) cells = [...cells].sort((a, b) => name(a).localeCompare(name(b)));   // a search keeps its best-match order
  const html = `<div class="sl-card">${cells.map(sellListRow).join('')}</div>`;   // one A-Z list, never by category (owner 2026-10-22)
  const shown = grid.firstElementChild === slCard, keep = shown && grid.dataset.q === state.query ? grid.scrollTop : 0;   // a redraw (a sale, stock) keeps the place; a new search starts at the top
  grid.classList.add('sl'); grid.dataset.sl = state.sellLayout; grid.dataset.q = state.query;
  if (!shown || slHtml !== html) { slHtml = html; grid.innerHTML = html; slCard = grid.firstElementChild; grid.scrollTop = keep; }   // a refit with nothing new: no rebuild, a flick keeps going
  renderSellHeader();
  requestAnimationFrame(syncSellGridMetrics);
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

// ---------- Peek (owner 2026-10-22, from try-peek.html): hold a tile = a card fades in in the middle - name, count, description, every
// variant (or item) with its stock and price; tap a row = add it. The screen dims, no blur. A fade, not a morph (owner: the morph lagged):
// opacity + scale only, which the GPU plays, so it stays smooth at Low Power Mode's 30 fps.
// My page: the bottom button reads Edit page meanwhile. The hold and the hold-then-move into editing are app.js's ----------
let peek = null;
const peekOpen = () => !!peek;
function peekRow(p, name) {
  const out = p.trackStock !== false && !(toNumber(p.stock, 0) > 0);
  const stock = p.trackStock === false ? 'Not counted' : out ? 'Out of stock' : `${SalesMath.qtyText(p.stock)} ${escapeHtml(p.unit || 'pc')} in stock`;
  return `<button type="button" class="vs-row" data-add="${p.id}">
    <span class="nm">${name == null ? stock : `${escapeHtml(name)}<small>${out ? '<b>Out of stock</b>' : stock}</small>`}</span><span class="amt num">${askedPrice(p) ? '—' : peso(p.price)}</span></button>`;
}
function openPeek(card) {
  const g = card.dataset.groupId && groupById(card.dataset.groupId), p = card.dataset.id && state.products.find(x => x.id === card.dataset.id);
  const f = card.dataset.cat && liveFolders().find(x => x.id === card.dataset.cat);
  const x = g || p || f; if (!x) return false;
  let n = 1, rows;
  if (g) {
    const ms = groupMembers(g.id);   // rows show each variant's name as typed, as the variant sheet does
    n = ms.length;
    rows = ms.map(m => peekRow(m, m.name)).join('');
  } else if (p) rows = peekRow(p);   // one item: the row is its stock and price
  else { const ps = catProducts(f.id); n = toCells(ps).length; rows = ps.map(m => peekRow(m, m.name)).join(''); }
  const desc = (g || p)?.description;
  const el = peek = document.createElement('div');
  el.innerHTML = `<div class="pk-dim"></div>
    <div class="pk-card" role="dialog" aria-label="${escapeHtml(x.name)}"><div class="vs-card">
      <div class="vs-head"><span class="vs-title"><span>${escapeHtml(x.name)}</span></span>${n > 1 ? `<span class="vs-count num">${SalesMath.plural(n, f ? 'item' : 'variant')}</span>` : ''}
        ${desc ? `<p class="pk-desc clip">${escapeHtml(desc)}</p><button type="button" class="pk-more" data-more hidden>More</button>` : ''}</div>
      <div class="vs-list">${rows}</div></div></div>`;
  if (card.dataset.at != null) for (const b of [$('#cartBar'), $('#payBtn')]) {   // My page: the bottom button reads Edit page
    const br = b.getBoundingClientRect(); if (!br.width) continue;
    const e = b.cloneNode(false); e.removeAttribute('id'); e.disabled = false; e.classList.add('pk-btn'); e.dataset.edit = '';
    e.innerHTML = '<span>Edit page</span>';
    b.style.transition = 'none'; const cs = getComputedStyle(b);   // its settled look: the tablet's Check out takes it from its id, which a copy drops
    for (const k of ['backgroundColor', 'backgroundImage', 'color', 'border', 'borderRadius', 'boxShadow', 'font', 'display', 'alignItems', 'justifyContent']) e.style[k] = cs[k];
    b.style.transition = '';
    Object.assign(e.style, { left: br.left + 'px', top: br.top + 'px', width: br.width + 'px', height: br.height + 'px' });
    el.append(e);
  }
  document.body.append(el); addEventListener('resize', () => peek === el && closePeek(true), { once: true });   // turned: the Edit page copy would sit off its button
  const d = el.querySelector('.pk-desc'); if (d) el.querySelector('.pk-more').hidden = d.scrollHeight <= d.clientHeight;   // short: no More
  void el.offsetWidth; el.classList.add('pk-on');   // fades in: styles.css .pk-on
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { el.querySelector('.pk-desc').classList.remove('clip'); e.target.remove(); return; }
    const add = e.target.closest('[data-add]'), edit = e.target.closest('[data-edit]');
    if (!add && !edit && e.target.closest('.pk-card')) return;   // a tap on the card's words does nothing
    closePeek();
    if (add) addToCart(add.dataset.add, 'variant');
    if (edit) myEdit(true);
  });
  return true;
}
function closePeek(now) {
  const el = peek; peek = null; if (!el) return;
  if (now) return el.remove();
  el.classList.remove('pk-on'); el.style.pointerEvents = 'none';   // fades out; the screen is live again at once
  // gone when the fade has really ended: the iPhone starts it a few frames late, so a 200 ms timer cut it off mid-fade (owner 2026-10-22:
  // "hitches mid"). The timer only backs up a fade that never runs (a hidden tab)
  el.querySelector('.pk-card').addEventListener('transitionend', (e) => e.propertyName === 'opacity' && el.remove());
  setTimeout(() => el.remove(), 1000);
}

// ---------- Variant sheet (Shopify POS): slides up over the grid, the cart stays in view ----------
function openVariantModal(groupId, back) {   // back: the category list it was opened from (its X steps back)
  const g = groupById(groupId);
  if (!g) return;
  if (!groupMembers(g.id).length) { showToast('No variants in this group'); return; }
  state.variantModal = { groupId: g.id, query: '', available: false, back };
  openListSheet(g.name, 'Search variants', 'Price');
}
// The variant sheet is also the customer picker (openCustomerModal): same top row, same list
function openListSheet(title, placeholder, col) {
  $('#variantTitle').textContent = title;
  $('#variantCol').textContent = col;
  $('#variantSearch').value = '';
  $('#variantSearch').placeholder = placeholder;
  $('#variantSheet').setAttribute('aria-label', title);
  $('#variantSheet').classList.toggle('cust', state.variantModal.kind === 'cust');   // phone: New customer moves to the bar (styles.css)
  renderVariantList();
  $('#variantList').scrollTop = 0;
  $('#variantSheet').classList.add('open');
  $('#sidebarToggle').setAttribute('aria-label', 'Close');   // the menu button turns into the sheet's X (styles.css)
}

function closeVariantSheet() {
  $('#variantSheet')?.classList.remove('open');
  $('#sidebarToggle')?.setAttribute('aria-label', 'Menu');
}
// The X: a variant list opened from a category's list steps back to it; anything else closes
function backVariantSheet() {
  const back = state.variantModal.back;
  if (!back) return closeVariantSheet();
  state.variantModal = back;
  openListSheet(back.title, 'Search items', 'Price');
}

// A My page category (owner 2026-10-21): its items in the variant sheet, an item with variants opens its own list
function openCatSheet(id) {
  const f = liveFolders().find(x => x.id === id); if (!f) return;
  state.variantModal = { kind: 'cat', id, title: f.name, query: '' };
  openListSheet(f.name, 'Search items', 'Price');
}
const priceRange = ps => {   // a price asked at sale has none to show: "—", never ₱0.00
  const pr = ps.filter(m => !askedPrice(m)).map(m => toNumber(m.price, 0)), lo = Math.min(...pr), hi = Math.max(...pr);
  const cut = x => peso(x).replace(/\.00$/, '');   // a range drops whole-peso .00 to stay short, as Items does
  return !pr.length ? '—' : lo === hi ? peso(lo) : `${cut(lo)}-${cut(hi)}`;
};
// One row for a category, a variant item or an item: picture, name, what's in it, price. No stock (owner 2026-10-21)
function cellRow(c, attrs) {
  const r = c.kind === 'cat' ? c.folder : c.kind === 'group' ? c.group : c.product, { img, hue } = itemLook(r);
  const sub = c.kind === 'cat' ? SalesMath.plural(c.n, 'item') : c.kind === 'group' ? `${c.memberCount} variants` : '';
  const pr = c.kind === 'cat' ? '' : priceRange(c.kind === 'group' ? groupMembers(r.id) : [r]);
  return `<button type="button" class="vs-row" ${attrs}><span class="pic"${hue == null || img ? '' : ` style="--tc:${hue}"`}>${img ? `<img src="${escapeHtml(img)}" alt="">` : ''}</span>
    <span class="nm">${escapeHtml(r.name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="amt num">${pr}</span></button>`;
}
const cellHit = (c, q) => !q || (c.kind === 'cat' ? c.folder : c.kind === 'group' ? c.group : c.product).name.toLowerCase().includes(q);
function renderCatSheet(vm) {
  const all = toCells(catProducts(vm.id)), q = vm.query.trim().toLowerCase(), shown = all.filter(c => cellHit(c, q));
  $('#variantAvail').hidden = true;
  $('#variantCount').textContent = `${shown.length} of ${all.length}`;
  $('#variantList').innerHTML = shown.map(c => cellRow(c, c.kind === 'group' ? `data-open-group="${c.group.id}"` : `data-variant-id="${c.product.id}"`)).join('')
    || '<div class="vs-empty">No items match</div>';
}

// Add tile (owner 2026-10-21): a half sheet asks Item or Category, then the Items page opens on that list as it is - its
// search, its rows - with ✕ where ☰ is and no tabs, stock or price. A tap ticks a row (quick stock's tick), the bar at the foot
// (quick stock's) adds the ticked ones; ✕ adds nothing. A row on My page when the list opened says "Already a tile" (owner 2026-10-21).
let addPick = null;   // { pick: 'item' | 'cat', was: the Items tab to come back to, had: keys on My page, sel: keys ticked }
function openAddTile(btn) {
  const { veil, close } = openSheet(btn, `<div class="fs-top">
    <button type="button" class="fs-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <h2 id="fsTitle">Add tile</h2><i></i></div><div class="fs-body"><div class="fs-rows"><button type="button" data-pick="item">Item</button><button type="button" data-pick="cat">Category</button></div></div>`, 'half');
  veil.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick]')?.dataset.pick, m = veil.firstChild;
    if (!pick || m.classList.contains('grow')) return;
    if (QS.on) { close(); return showToast('Finish quick stock first'); }   // one pick mode at a time on the Items page
    if (editorDirty()) { close(); return askLeave(true, () => addPickStart(pick)); }   // an item / modifier left open in Items with changes asks first
    // the sheet grows up to the full screen (owner 2026-10-21: "it goes up, it becomes a page"), then fades off the list under it
    m.style.height = m.offsetHeight + 'px';
    m.classList.add('grow');
    requestAnimationFrame(() => { m.style.height = innerHeight + 'px'; });
    setTimeout(() => { addPickStart(pick); close(); }, 300);
  });
}
function addPickStart(pick) {
  switchView('items');
  if (state.view !== 'items') return;   // refused (an exchange)
  addPick = { pick, was: itemsKind, q: itemsFilter.q, tops: { ...itemsTop, [itemsKind]: $('#itemsLines').scrollTop }, had: new Set(myTiles().map(tileKey)), sel: [] };
  addPickMenu();
  $('#itemsView').classList.remove('editing');
  addPickSearch('');
  setItemsKind(pick === 'cat' ? 'cats' : 'items');
  $('#itemsLines').scrollTop = 0;
}
// switchView off the Items page (or its ✕): the Items page as it was - its tab, search and place
function addPickOff() {
  if (!addPick) return;
  const { was, q, tops } = addPick;
  addPick = null;
  addPickMenu();
  addPickSearch(q);
  setItemsKind(was);
  Object.assign(itemsTop, tops);
  $('#itemsLines').scrollTop = tops[was] || 0;
}
const addPickSearch = q => { itemsFilter.q = $('#itemsSearch').value = q; $('#itemsFind').classList.toggle('typed', !!q); };
function addPickMenu() {
  document.body.classList.toggle('add-pick', !!addPick);
  const menu = $('.view-items .head [data-act="open-sidebar"]');
  menu.title = menu.ariaLabel = addPick ? 'Close' : 'Menu';
  addPickBar();
}
function addPickBar() {   // Check out's pill (.ph-bar), as New customer's (owner 2026-10-21)
  if (!$('#addPickBar')) {
    $('#app').insertAdjacentHTML('beforeend', '<div id="addPickBar" hidden><button type="button" class="ph-bar" id="addPickGo"></button></div>');
    $('#addPickGo').addEventListener('click', addPickAdd);
  }
  $('#addPickBar').hidden = !addPick;   // always there, as Check out is: nothing ticked reads as its empty cart (owner 2026-10-21)
  if (!addPick) return;
  const n = addPick.sel.length;
  $('#addPickGo').disabled = !n;
  $('#addPickGo').textContent = n ? `Add ${SalesMath.plural(n, 'tile')}` : addPick.pick === 'cat' ? 'No categories' : 'No items';
}
const addPickKey = id => addPick.pick === 'cat' ? 'c' + id : (groupById(id) ? 'g' : 'p') + id;   // an Items row's id is its family's, else its product's
const addPickOn = id => !!addPick && addPick.had.has(addPickKey(id));
function addPickMarkRows() {
  if (!addPick) return;
  $$('#itemsRows .row[data-id]').forEach(r => {
    const k = addPickKey(r.dataset.id), had = addPick.had.has(k);
    r.classList.add('qs-tick');
    r.classList.toggle('qs-in', had || addPick.sel.includes(k));
    r.classList.toggle('ap-had', had);
  });
}
// A tap on the Add list ticks or unticks a row; one on My page already can't be added twice
function addPickTap(id) {
  const k = addPickKey(id), i = addPick.sel.indexOf(k);
  if (addPick.had.has(k)) return showToast('Already a tile');
  if (i >= 0) addPick.sel.splice(i, 1); else addPick.sel.push(k);
  addPickMarkRows();
  addPickBar();
}
// The bar's Add: the ticked rows go on the end of My page in the order tapped, Sell opens on the first one's page
function addPickAdd() {
  const t = myTiles(), at = t.length;
  if (!addPick?.sel.length) return;
  t.push(...addPick.sel.map(k => k[0] === 'c' ? { cat: k.slice(1) } : k[0] === 'g' ? { g: k.slice(1) } : { id: k.slice(1) }));
  saveMyTiles(t);
  switchView('sell');
  state.page = pageOfTile(at);
  updateProductTrackPosition();
}

function renderVariantList() {
  const vm = state.variantModal;
  if (vm.kind === 'cust') return renderCustomerSheet(vm);
  if (vm.kind === 'cat') return renderCatSheet(vm);
  const members = groupMembers(vm.groupId);
  const q = vm.query.trim().toLowerCase();
  const out = p => stockLevel(p) === 'out';   // untracked (a drink, a cut) is never sold out and has no count
  const shown = members.filter(p => (!vm.available || !out(p))
    && (!q || [p.name, p.barcode, ...skusOf(p)].some(s => String(s || '').toLowerCase().includes(q))));
  $('#variantCount').textContent = `${shown.length} of ${members.length}`;
  const avail = $('#variantAvail');
  avail.hidden = !members.some(out);   // nothing sold out = nothing to filter
  avail.classList.toggle('active', vm.available);
  avail.setAttribute('aria-pressed', String(vm.available));
  $('#variantList').innerHTML = shown.length ? shown.map(p => `
    <button type="button" class="vs-row" data-variant-id="${p.id}">
      <span class="nm">${escapeHtml(p.name)}${out(p) ? '<small><b>Sold out</b></small>' : p.trackStock === false ? '' : `<small>${roundQty(p, p.stock)} available</small>`}</span>
      <span class="amt num">${askedPrice(p) ? '—' : peso(p.price)}</span>
    </button>`).join('') : '<div class="vs-empty">No variants match</div>';
}

function changePage(delta) {
  if (sellAsList()) return;   // the list scrolls, it has no pages
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

// Settings › Tile pictures and Cart pictures (owner 2026-10-14): this POS's own, like Tile size
function setTilePics(v) { state.tilePics = v; HWPOS_STORE.ui.set('tilePics', v); renderProducts(); }
function setCartPics(v) { state.cartPics = v; HWPOS_STORE.ui.set('cartPics', v); renderCart(); }
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
  if (tracked && left === 0) showDone(p.name, null, want === 1 ? 'Last one' : `Last ${SalesMath.qtyText(want)}`);   // the cart took what's left: never "0 left"
  else if (tracked && left > 0 && stockLevel({ ...p, stock: left }) === 'low') showDone(p.name, null, `${SalesMath.qtyText(left)} left`);   // the Added chip, with the count
}

// An item with no set price (askedPrice) asks for it first (the edit sheet's 'price'), then comes back with `price`:
// that line is its own, never merged (one cable at two prices is two lines), keyed by its own id + productId.
// `productId` may be such a line's id: the scanner card's + on it, one more at its price.
// An item with modifiers (bo-model itemModifiers) asks them next (the edit sheet's 'mods'), then comes back with `answers`
// (modifierAnswer snapshots) and `price` = its own + theirs. Such a line is its own too, and only the same answers at the
// same price add to it: two teas with different sweetness are two lines.
const answerKey = (as) => as.map(a => a.choiceId).join(',');
function addToCart(productId, via = 'other', fromScanCard = false, price, answers) {
  const line = state.cart.find(i => i.id === productId && i.productId);
  const p = state.products.find(x => x.id === (line ? line.productId : productId));
  if (!p) return;
  const typed = price !== undefined;
  if (!line && !typed && askedPrice(p)) return openEditSheet('price', p.id, via);
  if (!line && !answers && itemModifiers(p).length) {   // a tile or a size with lines of it on the cart: those first (openAgain)
    if (!typed && (via === 'tile' || via === 'variant') && state.cart.some(i => (i.productId || i.id) === p.id)) return openAgain(p, via);
    return openEditSheet('mods', p.id, { via, base: typed ? price : p.price });
  }
  stockOnAdd(p, cartWant(p) + 1, () => {
    beginCart();
    let it = line || (answers ? state.cart.find(i => i.productId === p.id && i.modifiers && answerKey(i.modifiers) === answerKey(answers) && i.price === price)
      : !typed && state.cart.find(i => i.id === p.id));
    if (!it) state.cart.push(it = { id: typed ? newId() : p.id, ...(typed && { productId: p.id }), name: p.name, sku: p.sku, brand: p.brand,
      unit: p.unit, price: typed ? price : p.price, ...(answers && { modifiers: answers }), qty: 0 });
    it.qty += 1;
    trackItemAdd({ ...p, price: it.price }, 1, via);
    renderCart();
    if (scanOpen()) scanHit(it.id, fromScanCard);   // the scanner's card says it: camera, search or a USB scanner
    else showDone(p.name);
  });
}

function findProductByCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return null;
  const lower = code.toLowerCase();
  const hit = p => (p.barcode && String(p.barcode).trim() === code);
  const sku = p => skusOf(p).some(s => s.toLowerCase() === lower);   // the main SKU or an Other SKU
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
  showConfirm({ title: product.name, message: `This item is ${offWhy(product)}. Sell anyway?`,
    okText: 'Sell anyway', danger: false, onConfirm: add });
  return false;
}

function clearCart(keepPrice) {
  if (!keepPrice) closeEditSheet(false, true);   // first, so its events are the sheet's own changes (and no PIN for a cart going away)
  state.discountOk = null;
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
  state.orderNote = '';
  renderCart();
  updateCustomerButton();
}

// The open sale survives a reload or a crash (owner 2026-10-09): every renderCart keeps it, init puts it back.
// Never an exchange (a reload starts it clean) nor a manager's yes (discountOk): a restored big discount asks again.
const CART_KEPT = ['cart', 'cartDiscount', 'scPwd', 'customer', 'orderNote', 'fulfilment', 'deliveryAddress', 'deliveryLocation', 'cartId', 'cartStartedAt', 'savedId'];
const keepCart = () => writeJsonStorage(STORAGE_CART, state.exchange ? null : Object.fromEntries(CART_KEPT.map(key => [key, state[key]])));
// At today's prices, a deleted item skipped, as Continue on a saved cart (todayLines): it can be days old.
function restoreCart() {
  const k = readJsonStorage(STORAGE_CART, null), { lines, gone } = todayLines(k?.cart);
  if (!lines.length) return;   // nothing left, or nothing readable: an empty POS, never a broken one
  Object.assign(state, Object.fromEntries(CART_KEPT.map(key => [key, k[key] ?? state[key]])), { cart: lines });
  state.customer = (k.customer && allCustomerRecords().find(c => c.id === k.customer.id)) || null;   // today's balance, as continueDraft
  if (gone.length) showToast(`Skipped ${gone.join(', ')} · no longer sold`);
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

// Big discounts (owner 2026-10-09). The sale's line + sale discounts added up, as a % of the sale before them;
// SC/PWD is the law's and never counts (when it wins, orderTotals gives no other discount).
const discountPct = (t = cartTotals()) => (t.scPwd || !t.subtotal ? 0 : SalesMath.round2(t.discount / t.subtotal * 100));
// The cart's discounts now (and their %), to put back when a manager says no.
const discSnap = (t = cartTotals()) => ({ lines: state.cart.map(i => [i, i.discount]), cd: state.cartDiscount, sc: state.scPwd, pct: discountPct(t), amt: discAmt(t) });
const discAmt = t => (t.scPwd ? 0 : t.discount);   // the pesos discountPct counts
const discPut = (s) => { s.lines.forEach(([i, d]) => { if (d) i.discount = d; else delete i.discount; }); state.cartDiscount = s.cd; state.scPwd = s.sc; };
// Past "Ask a manager for discounts over N%" (POS › Settings, bo-model discountLimit), past what a manager already
// approved on this sale and past `back` (the sheet's last state that passed), a role without "Give big discounts"
// gets the PIN pad: true = fine. Else `back` goes on the cart at once (Cancel leaves it), and the PIN puts this
// one on again, approved (state.discountOk -> the order's approvedBy), then runs `then`. No `back` (Check out): nothing moves.
function discountOk(back, then) {
  const lim = loadTillPerms().discountLimit, now = discSnap(), { pct, amt } = now;
  // what passed covers no more than it was, in % AND in pesos: a yes to 100% off ₱1.50 isn't 100% off a ₱385 line too
  const within = s => s && pct <= s.pct && amt <= s.amt;
  if (lim == null || pct <= lim || within(state.discountOk) || within(back)) return true;
  // An exchange: the sale's own yes stands for its swap up to the % it was (owner 2026-10-09), on pricier items too
  // (a collect); a bigger % asks again.
  const o = state.exchange && state.orders.find(r => r.id === state.exchange.orderId);
  const was = o && o.discountApprovedBy && { pct: discountPct(o), amt: Infinity, by: o.discountApprovedBy };
  if (within(was)) { state.discountOk = was; return true; }
  if (gate('discount', (by) => { discPut(now); state.discountOk = { pct, amt, by }; esFresh(); renderCart(); then?.(); },
    { pct }, `${pct}% off is over the ${lim}% limit.`)) return true;
  if (back) { discPut(back); esFresh(); renderCart(); }
  return false;
}
// The open sheet drawn again from the cart (its typed numbers were put back, or approved).
const esFresh = () => { if (es) { const { kind, id } = es; es = null; openEditSheet(kind, id); } };

function openEditSheet(kind, id, via) {
  if (kind !== 'ful' && kind !== 'price' && kind !== 'mods' && !state.cart.length) { flashControl($('#cartDiscountBtn')); flashControl($('#side')); return; }
  const was = !!es;
  closeAgain(true);
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
  } else if (kind === 'price') {   // an item with no set price (addToCart): id = the product, d = the typed price
    es = { kind, id, via, d: '', pct: false };
  } else if (kind === 'mods') {   // an item's modifiers (addToCart): id = the product, via = { via, base, line? } (esModsClick)
    via ||= {};
    const p = state.products.find(x => x.id === id), qs = p ? itemModifiers(p) : [], line = via.line && state.cart.find(i => i.id === via.line);
    if (!qs.length) return;
    // changing a cart line's answers (its sheet's Modifiers row): the same screens with its answers on, its price less theirs.
    // Only answers still on offer (freshAnswers): a removed, hidden or Unavailable one is off, so a Pick one asks again
    const had = line ? freshAnswers(p, line.modifiers, qs) : [];
    const ans = Object.fromEntries(qs.map(q => [q.id, had.filter(a => a.modifierId === q.id).map(a => a.choiceId)]));
    es = { kind, id, via: via.via, again: via.again, line: line ? line.id : null, base: moneyValue(line ? line.price - SalesMath.answersPrice(line) : via.base ?? p.price), qs, ans, at: 0 };
  } else {
    es = { kind, day: (state.pickupTime && state.pickupTime.day) || 'Today' };
  }
  Object.assign(es, { f: null, anim: false, opened: true, ok: discSnap() });   // ok: what a manager's "no" puts back (discountOk)
  drawEditSheet();
  if (!was) { $('#editSheet').classList.add('open'); esLine($('#editSheet')); }
}

// The one way a cart line leaves: the editor's Remove item and the swiped line's Delete (owner 2026-10-08).
function removeLine(item) {
  if (es && es.kind === 'line' && es.id === item.id) { es = null; $('#editSheet').classList.remove('open'); }   // the tablet's sheet can be open on it
  track('item_remove', { productId: item.productId || item.id, qty: item.qty, unitPrice: item.price });
  const at = state.cart.indexOf(item), was = Object.fromEntries(CART_KEPT.map(k => [k, state[k]]));
  const undo = () => {
    if (state.cart.includes(item)) return;
    if (!state.cart.length && !state.exchange) Object.assign(state, was);
    else state.cart.splice(Math.min(at, state.cart.length), 0, item);
    renderCart(); updateCustomerButton();
  };
  state.cart = state.cart.filter(i => i !== item);
  // the last line gone is a fresh sale, as Clear cart (owner 2026-10-09): no note, no nothing; a price being typed stays up
  if (!state.cart.length && !state.exchange) { clearCart(es?.kind === 'price'); if (es) drawEditSheet(); return showDone('Item removed', undo); }
  const list = $('#cartList'), top = list.scrollTop;
  renderCart();
  list.scrollTop = top;   // renderCart jumps to the newest line; a removal keeps the cashier's place
  if (es) state.cart.length || es.kind === 'price' ? drawEditSheet() : closeEditSheet();   // Discount / Walk-in open beside the rail: its totals follow
  showDone('Item removed', undo);
}

// Closing keeps what's on the cart (it followed every tap) and sends the events the old Save sent, once per open.
// `dropping`: the cart is being cleared, so a big discount isn't asked about. false = it asked (discountOk).
function closeEditSheet(swap, dropping) {
  if (!es) return;
  const typing = es.f === 'q';
  if (es.f) esSettle(es);
  if (typing) esWrite();   // a typed count is asked about as the sheet goes
  const o = es; es = null;
  const ok = dropping || discountOk(o.ok);   // before the events: a "no" puts the discount back, so none is sent
  const item = o.kind === 'line' && state.cart.find(i => i.id === o.id);
  if (item) {
    if (item.qty !== o.before.qty) track('item_qty', { productId: item.productId || item.id, from: o.before.qty, to: item.qty });
    const d = item.discount || null;
    if (JSON.stringify(d) !== JSON.stringify(o.before.discount)) track('discount', { scope: 'line', kind: (d || o.before.discount).type, value: d ? d.value : 0, productId: item.productId || item.id });
  } else if (o.kind === 'rd' && JSON.stringify([state.cartDiscount, state.scPwd]) !== JSON.stringify([o.before, o.beforeSc])) {
    const sc = state.scPwd || (!state.cartDiscount && o.beforeSc);   // an SC/PWD put on, or taken off with nothing in its place
    track('discount', sc ? { scope: 'cart', kind: sc.kind, value: state.scPwd ? esScRow(sc.kind).value : 0 }
      : { scope: 'cart', kind: (state.cartDiscount || o.before).type, value: state.cartDiscount ? state.cartDiscount.value : 0 });
  } else if (o.kind === 'ful') {
    state.deliveryAddress = (state.deliveryAddress || '').trim();
  }
  if (!swap) $('#editSheet').classList.remove('open');
  renderCart();
  return ok;
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
const CASH_MAX = 9999999;   // the most any cash keypad takes (checkout, a price asked at sale, the shift, cash in / out)
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
  const kin = o.anim === true || o.anim === 'swap' ? ' es-in' : '';
  if (o.kind === 'line') {
    const item = esItem();
    if (!item) return closeEditSheet();
    const p = productOf(item), step = stepFor(p);
    // SC/PWD replaces line discounts (never stacked), so under it the line shows gross and says why. No "2 × ₱245" under
    // the total: the Quantity box says it (owner 2026-10-14)
    const sc = cartTotals().scPwd && state.scPwd;
    const m = SalesMath.lineMoney(item.price, item.qty, sc ? null : item.discount, state.settings.store?.currency);
    head = `<p>${escapeHtml(item.name)}</p><div class="es-hero">${peso(m.lineTotal)}</div>${sc && item.discount ? `<p>${ES_SC[sc.kind]} applies</p>` : ''}`;
    rows = `<div class="es-row${o.f === 'q' ? ' on' : ''}"><span>Quantity</span>${stp(-1, item.qty <= step)}<button type="button" data-sf="q">${n('q', o.f === 'q' ? o.q || '0' : item.qty, ' q')}</button>${stp(1)}</div>
      <div class="es-row${o.f === 'd' ? ' on' : ''}" data-sf="d"><span>Discount</span>${n('d', o.f === 'd' ? esTyped(o) : esShown(item.discount), ' v')}${cv(o.f === 'd')}</div>
      <div class="es-row${o.f === 'n' ? ' on' : ''}" data-sf="n"><span>Note</span><small class="ad">${escapeHtml(item.note || '')}</small>${cv(o.f === 'n')}</div>`
      // its answers: the item's modifier screens again, with them on (esMods)
      + (item.modifiers && p && itemModifiers(p).length ? `<button type="button" class="es-row" data-mods><span>Modifiers</span><small class="ad">${escapeHtml(item.modifiers.map(a => a.choice ?? a.choiceName).join(', '))}</small>${cv()}</button>` : '');
    // the note types into the cart line as it goes (app.js #esNote input), on the slip under the line
    if (o.f === 'n') side = `<div class="es-keys es-addr${kin}"><div class="es-ah">Note</div>
      <textarea class="es-ta" id="esNote" rows="3" maxlength="120" placeholder="Add a note" aria-label="Note">${escapeHtml(item.note || '')}</textarea></div>`;
    else if (o.f) side = `<div class="es-keys${kin}">${seg(segBtn('Percent', o.pct, 'data-pct'), segBtn('Amount', !o.pct, 'data-amt'), o.f === 'd' ? '' : ' off')}${esKeys(o.f === 'd' || step < 1)}</div>`;
  } else if (o.kind === 'price') {
    head = `<p>Price for ${escapeHtml(state.products.find(p => p.id === o.id)?.name || 'item')}?</p><div class="es-hero">${esTyped(o)}</div>`;
    rows = '';
    side = `<div class="es-keys">${esKeys(true)}</div>`;
  } else if (o.kind === 'mods') {
    // one question per screen, in the item's order (modifiers-lab.html's POS screens): the item and what's picked so far, the
    // question, how many; a choice greyed Unavailable can't be picked (it is set back in Items › Modifiers). The name as
    // typed, never a "?" (owner 2026-10-24: "Toppings")
    // Picked so far (owner 2026-10-25, line-and-again-lab.html P): "+N" and the newest two over the name, never more than three
    // pills (esPicksPop cuts one that doesn't fit); a pill goes back to its question, "+N" lists every pick
    const q = o.qs[o.at], got = o.ans[q.id], did = esPicked(o), keep = did.slice(-2), k = did.length - keep.length;
    const picks = did.length ? `<div class="es-picks" data-fit><button type="button" class="more" data-more data-n="${k}">+${k}</button>${
      keep.map(d => `<button type="button" data-go="${d.i}">${escapeHtml(d.q + ' ' + d.v)}</button>`).join('')}</div>` : '';
    head = `${picks}<p>${escapeHtml(state.products.find(p => p.id === o.id)?.name || 'Item')}</p><div class="es-hero mq">${escapeHtml(esQName(q))}</div>
      <p class="es-off">Pick ${MODIFIER_PICKS[q.picks].toLowerCase()}</p>`;
    rows = q.choices.map(c => `<button type="button" class="es-row${got.includes(c.id) ? ' pick' : ''}${c.unavailable ? ' out' : ''}" data-ch="${escapeHtml(c.id)}"${c.unavailable ? ' aria-disabled="true"' : ''}>
      <span>${escapeHtml(c.name)}</span><small>${c.unavailable ? 'Unavailable' : c.price ? '+' + peso(c.price) : ''}</small></button>`).join('');
  } else if (o.kind === 'rd') {
    // what they pay, and while a discount is on, how much it takes off what: "₱13.00 off ₱65.00" (owner 2026-10-16).
    // Before = the sale with no sale discount and no Senior / PWD, so the VAT the exemption drops counts as off too.
    const t = cartTotals(), was = cartTotals(state.cart, null, null).total, off = moneyValue(was - t.total);
    head = `<div class="es-hero">${peso(t.total)}</div>${off > 0 ? `<p class="es-off"><b>${peso(off)}</b> off ${peso(was)}</p>` : ''}`;
    // Senior / PWD, then the saved ones, scroll under the total (any number of them); Custom stays put below.
    rows = `<div class="es-scroll">${Object.entries(ES_SC).map(([k, name]) => `<button type="button" class="es-row${o.f === k ? ' on' : o.pick === k ? ' pick' : ''}" data-sc="${k}" style="view-transition-name:es-${k}"><span>${name}</span><small class="ad">${
        o.pick !== k || !state.scPwd ? esShown(esScRow(k)) : t.scPwd ? escapeHtml(state.scPwd.name) : 'Promo is bigger'}</small>${cv(o.f === k)}</button>`).join('')
      + esPresets().map((d, i) => `<button type="button" class="es-row${o.pick === d.id ? ' pick' : ''}" data-pick="${escapeHtml(d.id)}" style="view-transition-name:es-p${i}"><span>${escapeHtml(d.name)}</span><small>${esShown(d)}</small></button>`).join('')}</div>`
      + `<div class="es-row${o.f === 'd' ? ' on' : o.pick === 'c' ? ' pick' : ''}" data-sf="d" style="view-transition-name:es-c"><span>Custom</span>${n('d', o.pick === 'c' ? esTyped(o) : '', ' v')}${cv(o.f === 'd')}</div>`;
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
  const left = o.kind === 'ful' || o.kind === 'price' || o.kind === 'mods' ? ''
    : o.f === 'd' ? (+o.d ? `<button type="button" class="es-q" data-sclr>${o.kind === 'line' ? 'Clear discount' : 'Clear'}</button>` : '')
    : o.f ? '' : o.kind === 'line' ? '<button type="button" class="es-q rm" data-remove>Remove item</button>' : o.pick !== null ? '<button type="button" class="es-q" data-sclr>Clear</button>' : '';
  const top = card.querySelector('.es-scroll')?.scrollTop || 0;   // a tap redraws the sheet; the list stays where it was scrolled
  // the questions' progress on ‹ Back's line: a short bar for every item (owner 2026-10-25: "line for everything"), grown from where it was (o.w)
  const w = o.kind === 'mods' && (o.at + 1) / o.qs.length;
  const prog = w ? `<div class="es-prog" aria-hidden="true"><i style="--w:${w};--was:${o.w ?? w}"></i></div>` : '';
  if (w) o.w = w;
  card.innerHTML = prog + esFrame(head, rows, side, left + (o.kind === 'mods' ? esModsFoot(o)
    : o.kind === 'price' ? `<button type="button" class="es-ink" data-apply${+o.d > 0 ? '' : ' disabled'}>Add</button>`
    : o.f ? `<button type="button" class="es-ink" data-apply${o.f === 'd' && !(+o.d > 0) ? ' disabled' : ''}>Apply</button>` : '<button type="button" class="es-ink" data-close>Done</button>'),   // a 0 discount waits, as the price ask's Add does
  `${o.kind === 'rd' ? ' fill' : o.kind === 'price' ? ' ask' : ''}${o.anim === true ? ' es-in' : o.anim === 'out' ? ' es-out' : ''}${o.dir ? ' es-' + o.dir : ''}`);
  if (o.kind === 'mods') esPicksPop(o, card);
  const list = card.querySelector('.es-scroll');
  if (list && o.opened) list.querySelector('.pick')?.scrollIntoView({ block: 'nearest' });   // just opened: the one on the sale in view
  else if (list) list.scrollTop = top;
  o.anim = o.opened = o.dir = false;   // dir: a question's slide, 'fwd' / 'bwd' (esModsClick)
}
// The hero line (owner 2026-10-16): every amount's top sits --hero-y from the top of the screen, checkout's included.
// The card starts lower on a tablet (the sheet's frame), so it says where: its inside's top, the slide-up ignored.
function esLine(sh) {
  const c = sh.querySelector('.es-card'), p = sh.offsetParent;
  const top = (p ? p.getBoundingClientRect().top + p.clientTop : 0) + sh.offsetTop + sh.clientTop + c.offsetTop + c.clientTop;
  sh.style.setProperty('--es-y', `${Math.round(top)}px`);
}
addEventListener('resize', () => $$('.esheet.open').forEach(esLine));
// The panel's frame: ✕ / Back, the head over its list, the side (keys or a field), the foot. The shift's panel wears it too.
const esFrame = (head, rows, side, foot, cls = '') => `<button type="button" class="es-x" data-close aria-label="Close">${esSvg('x', 'ix')}${esSvg('back', 'ib')}<span class="xl">Back</span></button>
    <div class="es-body${cls}"><div class="es-col"><div class="es-head">${head}</div><div class="es-list">${rows}</div></div>${side}</div>
    <div class="es-ft">${foot}</div>`;
const esKeys = (dec) => `<div class="es-kp">${[...'123456789', dec ? '.' : '', '0', 'del'].map(k => !k ? '<span></span>'
  : `<button type="button" data-sk="${k}"${k === 'del' ? ' aria-label="Delete"' : ''}>${k === 'del' ? esSvg('del') : k}</button>`).join('')}</div>`;
// The desk keyboard on the sheet's keys, as the shift's (shiftKey) and checkout's: digits, '.', Backspace, Enter = Apply / Add
function editKey(e) {
  if (!es || e.ctrlKey || e.metaKey || e.altKey || e.target.matches('input, textarea') || !$('#editSheet [data-sk]')) return;
  const k = e.key === 'Backspace' ? 'del' : e.key, q = k === 'Enter' ? '[data-apply]' : /^([\d.]|del)$/.test(k) && `[data-sk="${k}"]`, b = q && $(`#editSheet ${q}`);
  if (!b) return;
  e.preventDefault();   // a focused key would press itself again
  if (!b.disabled) editSheetClick({ target: b });
}

function editSheetClick(e) {
  const o = es, el = (q) => e.target.closest(q);
  if (!o) return;
  if (o.kind === 'mods') return esModsClick(el);
  if (el('[data-mods]')) return openEditSheet('mods', esItem()?.productId, { line: o.id });
  if (el('[data-close]')) return closeEditSheet();
  if (o.kind === 'ful') return esFulClick(el);
  if (o.kind === 'price') {   // our keys type it; Add puts the line on the cart at it, ✕ adds nothing
    if (el('[data-sk]')) { o.d = esPress(o.d, el('[data-sk]').dataset.sk, true, CASH_MAX); return drawEditSheet(); }
    if (!el('[data-apply]') || !(+o.d > 0)) return;
    closeEditSheet();
    return addToCart(o.id, o.via, false, moneyValue(o.d));
  }
  if (ES_SC[o.f]) $$('#editSheet [data-scf]').forEach(i => { o.sc[i.dataset.scf] = i.value; });   // the typed ID and name survive the redraw
  if (el('[data-remove]')) {
    const gone = esItem();
    es = null;
    $('#editSheet').classList.remove('open');
    return gone ? removeLine(gone) : renderCart();
  }
  const item = esItem(), step = item ? stepFor(productOf(item)) : 1, f0 = o.f;
  if (el('[data-sk]')) {
    const qty = o.f === 'q';
    o[o.f] = esPress(o.fresh ? '' : o[o.f], el('[data-sk]').dataset.sk, !qty || step < 1, qty ? 9999 : o.pct ? 100 : 99999);
    o.fresh = false;
    if (o.kind === 'rd' && o.f === 'd') o.pick = 'c';
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
  const typing = el('[data-sk]') || el('.es-seg button');   // the keys, Percent / Amount: shown, not put on yet
  esWrite();
  const draw = () => { drawEditSheet(); if (ES_SC[o.f]) ($$('#editSheet [data-scf]').find(i => !i.value.trim()) || $('#editSheet [data-scf]')).focus(); };
  // A phone's Discount (owner 2026-10-16): only the row tapped stays, so it glides into the first row's place and the
  // others fade (the browser's view transition, each row named in drawEditSheet); the number never moves. A plain swap without one.
  const glide = o.kind === 'rd' && !f0 !== !o.f && $('#editSheetCard').clientWidth <= 560 && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (glide) document.startViewTransition(draw); else draw();
  if (!typing && discountOk(o.ok)) o.ok = discSnap();   // anything else puts it on: past the limit, a manager is asked
  const note = $('#esNote');   // preventScroll: the panel slides in, and a plain focus scrolls the catalog under it
  if (note) { note.focus({ preventScroll: true }); note.selectionStart = note.value.length; }
}

// ---------- Modifiers at the sale (plans/modifiers-build.md) ----------
// Nothing starts picked. A line along the top fills as the questions go (owner 2026-10-24). Pick one must be answered: a
// tap on its choice goes on to the next question, and on the last one adds the item (or, changing a line, is its Done).
// Up to N / Any may be skipped: a big Next at the bottom, Add · price (or Done) on the last. ‹ Back steps back a question,
// at the first it closes (adding nothing), or goes back to the line's sheet when it was changing a line.
const esAnswers = (o) => o.qs.flatMap(q => q.choices.filter(c => o.ans[q.id].includes(c.id)).map(c => modifierAnswer(q, c)));
const esModsReady = (o) => o.qs.every(x => !x.required || o.ans[x.id].length);
const esModsPrice = (o, answers = esAnswers(o)) => moneyValue(o.base + SalesMath.answersPrice({ modifiers: answers }));
function esModsFoot(o) {
  if (o.qs[o.at].required) return '';   // Pick one: its tap goes on (esModsClick). One with every choice Unavailable isn't required, so it gets Next
  return o.at < o.qs.length - 1 ? '<button type="button" class="es-ink es-big" data-next>Next</button>'
    : `<button type="button" class="es-ink es-big" data-apply${esModsReady(o) ? '' : ' disabled'}>${o.line ? 'Done' : `Add · ${peso(esModsPrice(o))}`}</button>`;   // a line's Done is the line sheet's Done; its total says the price
}
function esModsApply(o) {
  if (!esModsReady(o)) return;
  const answers = esAnswers(o), price = esModsPrice(o, answers);
  const line = o.line && state.cart.find(i => i.id === o.line);
  if (line) { Object.assign(line, { price, modifiers: answers }); return openEditSheet('line', line.id); }
  closeEditSheet();
  addToCart(o.id, o.via, false, price, answers);
}
const esQName = (q) => q.name.replace(/\s*\?+\s*$/, '');
// the questions before this one that have a pick: { i, q: its name, v: the picks }
const esPicked = (o) => o.qs.slice(0, o.at).map((x, i) => ({ i, q: esQName(x), v: x.choices.filter(c => o.ans[x.id].includes(c.id)).map(c => c.name).join(', ') })).filter(d => d.v);
// after a draw: the pill row drops its oldest pill while it overflows ("+N" counts it), and "+N" open lists every pick under the row
function esPicksPop(o, card) {
  const r = card.querySelector('[data-fit]');
  if (!r) return;
  const more = r.querySelector('.more');
  let n = +more.dataset.n;
  more.hidden = !n;
  while (r.scrollWidth > r.clientWidth && r.children.length > 1) { more.hidden = false; r.children[1].remove(); more.textContent = '+' + ++n; }
  if (!o.pop) return;
  card.insertAdjacentHTML('beforeend', `<div class="es-veil" data-shut></div><div class="es-pop" role="dialog" aria-label="Picked">${
    esPicked(o).map(d => `<button type="button" data-go="${d.i}"><span>${escapeHtml(d.q)}</span><small>${escapeHtml(d.v)}</small></button>`).join('')}</div>`);
  card.querySelector('.es-pop').style.top = `${Math.round(r.getBoundingClientRect().bottom - card.getBoundingClientRect().top + 8)}px`;
}
function esModsClick(el) {
  const o = es, q = o.qs[o.at], row = el('[data-ch]');
  if (el('[data-more]')) { o.pop = true; return drawEditSheet(); }
  if (el('[data-shut]')) { o.pop = false; return drawEditSheet(); }
  if (el('[data-go]')) { o.pop = false; o.at = +el('[data-go]').dataset.go; o.dir = 'bwd'; return drawEditSheet(); }
  if (el('[data-close]')) {
    if (o.at) { o.at--; o.dir = 'bwd'; return drawEditSheet(); }
    if (o.again) { const p = state.products.find(x => x.id === o.id); closeEditSheet(); return p && openAgain(p, o.via); }   // Make another's first question: back to the shaded cart
    return o.line ? openEditSheet('line', o.line) : closeEditSheet();
  }
  if (el('[data-next]')) { o.at++; o.dir = 'fwd'; return drawEditSheet(); }
  if (el('[data-apply]')) return esModsApply(o);
  if (!row || row.classList.contains('out')) return;   // Unavailable: greyed, no tap
  const got = o.ans[q.id], id = row.dataset.ch, i = got.indexOf(id);
  if (q.max === 1) o.ans[q.id] = [id];
  else if (i >= 0) got.splice(i, 1);
  else if (got.length >= q.max) return flashControl(row);   // Up to 2: a third waits for one to come off
  else got.push(id);
  drawEditSheet();
  // Pick one: on once the tap has shown (modifiers-lab's 220 ms), to the next question or, on the last, the cart
  if (q.required) setTimeout(() => {
    if (es !== o || o.qs[o.at] !== q) return;   // a second fast tap, or Back meanwhile
    if (o.at < o.qs.length - 1) { o.at++; o.dir = 'fwd'; drawEditSheet(); } else esModsApply(o);
  }, 220);
}

// The same item again (owner 2026-10-25, line-and-again-lab.html 4 / 2b; was the peek card of 10-24): a tap on an item that asks
// modifiers, with lines of it on the cart already (same product = same item and variant), shows the cart with those lines shaded,
// the rest faded, and its button reads Make another (no name: the bar never grows). Phone: the cart rises from the bottom over the items; tablet: the cart
// stays, the items dim. A tap on the dim (or Esc) goes back; a line opens its sheet; Make another asks the questions (app.js #payBtn).
let againId = null, againVia = null;
function openAgain(p, via) {
  againId = p.id; againVia = via;
  if (!$('.ag-dim')) {
    $('.catalog-wrap').insertAdjacentHTML('beforeend', '<div class="ag-dim"></div>');
    $('.ag-dim').onclick = $('#againX').onclick = () => closeAgain();
    pullToClose($('#side .ag-top'), $('#side'), () => closeAgain());   // the phone's sheet pulls down as the Add tile sheet
  }
  $('#againTitle').textContent = p.name;
  const s = $('#side'), rise = !$('#app').classList.contains('again') && matchMedia('(max-width: 720px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  s.style.transition = 'none';   // the cart page's own slide (from the right) must not run
  if (rise) s.style.transform = 'translateY(100%)';   // shut below the screen first, then it slides up as the filter sheet does (openSheet)
  $('#app').classList.add('again');
  renderCart();
  void s.offsetWidth; s.style.transition = '';
  if (rise) requestAnimationFrame(() => requestAnimationFrame(() => { if (againId) s.style.transform = ''; }));
}
// now: no slide (Make another's questions open over it). The phone's sheet slides down first, as the Add tile sheet
function closeAgain(now) {
  if (!againId) return;
  againId = null;
  const s = $('#side'), done = () => {
    if (againId) return void (s.style.transform = '');   // opened again meanwhile
    s.style.transition = 'none'; s.style.transform = '';   // the cart page's own slide (to the right) must not run from here
    $('#app').classList.remove('again'); renderCart();
    void s.offsetWidth; s.style.transition = '';
  };
  if (now || !matchMedia('(max-width: 720px)').matches) return done();
  s.style.transform = 'translateY(100%)';
  setTimeout(done, 240);   // ponytail: the slide's .24s, as openSheet's close
}
function againMake() {
  const p = state.products.find(x => x.id === againId);
  if (p) openEditSheet('mods', p.id, { via: againVia, base: p.price, again: true });
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
  if (!methods.some(m => m.key === state.fulfilment)) state.fulfilment = state.settings.defaultFulfilment || 'walkin';
  const cur = methods.find(m => m.key === state.fulfilment) || methods[0];
  row.innerHTML = `<button type="button" class="pick" id="fulPick" aria-haspopup="dialog"><span>${escapeHtml(cur.label)}</span>${RAIL_UPDOWN}</button>`;
}
const fulfilLabel = () => orderFulfilLabel({ fulfilment: state.fulfilment });


// ---------- The + stack (Items +, owner 2026-10-17, Phantom's) ----------
// The page blurs, the choices stand over the + as a label and a round button, the + turns into ✕. A pick, a tap
// anywhere or Esc closes it. items: [{label, ic, run}], top to bottom (the last one sits nearest the thumb).
function openFabMenu(fab, items) {
  if (document.querySelector('.fab-veil:not(.out)')) return;   // one menu; a closing one may still fade
  fab.style.transition = 'none';   // measured at rest, not mid liquid-glass spring (app.js)
  const r = fab.getBoundingClientRect(), veil = document.createElement('div');
  fab.style.transition = '';
  veil.className = 'fab-veil';
  veil.style.cssText = `--fr:${innerWidth - r.right}px;--fb:${innerHeight - r.bottom}px;--fs:${r.width}px`;
  veil.innerHTML = `<div class="fab-stack" role="menu">${items.map((it, i) => `<button type="button" role="menuitem" data-i="${i}" style="--d:${(items.length - 1 - i) * 35}ms">
      <span>${escapeHtml(it.label)}</span><i>${it.ic}</i></button>`).join('')}</div>
    <button type="button" class="fab-x" aria-label="Close"><svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  document.body.append(veil);
  fab.setAttribute('aria-expanded', 'true');
  fab.style.visibility = 'hidden';   // the ✕ stands in for it; no blurred + glowing round the ✕
  veil.querySelector('.fab-x').focus({ preventScroll: true });   // a stray Enter (a scanner's) only closes it
  const close = () => {
    if (veil.classList.contains('out')) return false;
    veil.classList.add('out');
    fab.setAttribute('aria-expanded', 'false');
    fab.style.visibility = '';
    fab.focus({ preventScroll: true });
    removeEventListener('resize', moved);
    setTimeout(() => veil.remove(), calmMs(180));
    return true;
  };
  veil.close = close;   // lockTill: no menu waiting for the next person
  const w = innerWidth, moved = () => innerWidth !== w && close();   // a rotate moves the +; the ✕ was measured in px (iOS bars only change the height)
  addEventListener('resize', moved);
  veil.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (close() && b) items[b.dataset.i].run(); });
  veil.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.repeat) e.preventDefault();   // a held Enter that opened the menu must not pick from it
    else if (e.key === 'Tab') {   // focus stays in the menu
      const all = [...veil.querySelectorAll('button')], i = all.indexOf(document.activeElement);
      e.preventDefault();
      all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
    }
  });
}

// ---------- The morph menu (cart-lab-stack-c.html) ----------
// The menu grows out of its trigger's own box, each item the trigger's height, always in the same order (the hand
// learns where each choice is); the current one is only bold. A pick, a tap outside or Esc shrinks it back.
// items: [{label, run, cur, red, off}] or '-' for a divider. opts.w: width (default the trigger's), opts.right: right-align, opts.mid: centre.
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
  const left = Math.max(0, Math.min(innerWidth - w, opts.mid ? r.left + (r.width - w) / 2 : opts.right ? r.right - w : r.left));   // opts.mid: under a centred title
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
// The morph (the menus): m, already placed, grows out of the trigger's box r with a little
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
    ${F.creditLimit}</div><div class="co-error" id="custDup" hidden></div>${c ? '<div class="cs-grp"><button type="button" class="cs-row cs-del" data-cust-del>Delete customer</button></div>' : ''}`;
  const name = $('#custFields [name="name"]');
  $('#customerEditTitle').textContent = c ? 'Edit customer' : 'New customer';   // a fixed title in the bar (owner 2026-10-09), the Name row shows the name
  // the tablet: over the page's main pane, as the edit sheet is on Sell; the phone: a full page wherever it sits
  // ponytail: Sell (its picker) and Customers are the only ways in
  const sh = $('#customerEditModal'), frame = state.view === 'customers' ? $('#customersView') : $('.catalog-wrap');
  if (sh.parentNode !== frame) { frame.append(sh); void sh.offsetWidth; }   // moved: settle first, so it still slides up
  sh.classList.add('open');
  custWas = JSON.stringify(custFormValues());
  setTimeout(() => name.focus(), 50);
}
function closeCustomerEditModal() { $('#customerEditModal').classList.remove('open'); }
// The X, Esc and "Open Ana" ask first when a field changed (askLeave, owner 2026-10-22); Save and Delete close at once.
let custWas = '';
const custFormValues = () => Object.fromEntries($$('#custFields [name]').map(el => [el.name, el.type === 'checkbox' ? (el.checked ? 'on' : '') : el.value]));
// on screen only: left open on a page switched away from, Esc elsewhere must not ask about a sheet no one sees
const customerEditChanged = () => { const sh = $('#customerEditModal'); return sh.classList.contains('open') && sh.getClientRects().length > 0 && JSON.stringify(custFormValues()) !== custWas; };
const leaveCustomerEdit = (then = closeCustomerEditModal) => askLeave(customerEditChanged(), then);
// Not while they owe or are owed: the balance would go with them.
function deleteCustomer() {
  const c = allCustomerRecords().find(x => x.id === state.customerEditing?.id);
  if (!c) return;
  if (c.currentBalance) return showToast(`Settle the ${peso(Math.abs(c.currentBalance))} balance first`);
  showConfirm({ title: `Delete “${c.name}”?`, message: 'Their past sales keep the name.', okText: 'Delete', danger: true, onConfirm: () => {
    setCustomerDeleted(c.id, true);
    if (state.customer?.id === c.id) selectCustomer('walk-in');
    closeCustomerEditModal();
    renderCustomers();
    showDone('Customer deleted', () => { setCustomerDeleted(c.id, false); state.selectedCustomerId = c.id; renderCustomers(); });
  } });
}
// Credit on/off and the limit are a manager's call (TILL_ACTIONS.credit, owner 2026-10-06); `by` = who approved it.
// Only a change to them asks: fixing a phone number never needs a PIN.
function saveSavedCustomerFromModal(by = '') {
  const was = state.customerEditing;
  const values = custFormValues();
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
  if (!was) state.selectedCustomerId = c.id;
  if (state.view === 'customers') renderCustomers();
  showDone(`${was ? 'Saved' : 'Added'} “${c.name}”`);
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
// Blur swap (owner's pick, toast-lab.html 2026-10-19): lined up from the right, only the characters that changed
// melt from the old one into the new one; --k is the place from the right, for a 25ms stagger.
function blurSwap(now, before) {
  return [...now].map((c, k) => { const o = before[k - now.length + before.length];
    return o === c ? c : `<b class="nd" style="--k:${now.length - 1 - k}"><s aria-hidden="true">${o ?? ''}</s><u>${c}</u></b>`; }).join('');
}

function renderCart() {
  keepCart();
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
    const ag = againId && state.cart.some(i => (i.productId || i.id) === againId) && againId;
    if (againId && !ag) { againId = null; $('#app').classList.remove('again'); }   // its lines came off meanwhile
    list.innerHTML = back + state.cart.map(item => `
      <div class="line${!ag ? '' : (item.productId || item.id) === ag ? ' hl' : ' fade'}"><button type="button" class="row" data-id="${item.id}" title="Edit item">${linePic(item)}
        <span class="nm"><span>${escapeHtml(item.name)}</span><small class="num">${item.qty} × ${peso(item.price)}${item.discount ? ` · <span class="off">${peso(-normalizeOrderItem(item).lineDiscount)}</span>` : ''}</small>${
          SalesMath.answerLines(item, peso).map(t => `<small class="note">${escapeHtml(t)}</small>`).join('')}${item.note ? `<small class="note">${escapeHtml(item.note)}</small>` : ''}</span>
        <span class="amt num">${peso(normalizeOrderItem(item).lineGross)}</span>
      </button><button type="button" class="sw-del" data-del="${item.id}" tabindex="-1" aria-label="Delete">${esSvg('trash')}</button></div>`).join('');
    list.scrollTop = ag ? 0 : list.scrollHeight;   // the Make another sheet starts at its first line (owner 2026-10-25)
  }

  const note = $('#orderNote');   // the order's note (cart ⋯ Add note), under who it's for
  note.hidden = !state.orderNote;
  note.textContent = state.orderNote || '';
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
  const last = $('#cartBar')._last, cnt = Number(n).toLocaleString('en-PH');   // the pill's last numbers, for the blur swap
  $('#cartBar').disabled = n === 0 && !x;   // phone: what is in the cart, not Check out; an exchange opens it to see what comes back
  $('#cartBar').innerHTML = x ? `<span>${XCHG_ICON}Exchange</span><span class="num">${n ? (owe[2] ? `${owe[0]} ${peso(owe[2])}` : off ? `${peso(off)} off account` : 'Even swap') : `#${escapeHtml(x.o.number)}`}</span>`
    : n ? `<span>${blurSwap(cnt, last?.n ?? cnt)} ${SalesMath.pluralWord(n, 'item')}</span><span class="num">${blurSwap(peso(t.total), last?.t ?? peso(t.total))}</span>` : '<span>No items</span>';
  $('#cartBar')._last = n && !x ? { n: cnt, t: peso(t.total) } : null;
  if (!n && !x) $('#app').classList.remove('ph-cart');
  if (againId) { $('#payBtn').disabled = false; $('#payBtn').innerHTML = '<span>Make another</span>'; }
  if (myEditing) for (const b of [$('#cartBar'), $('#payBtn')]) { b.disabled = false; b.innerHTML = '<span>Done</span>'; }   // app.js's capture click ends editing, nothing else
  if (scanCardId) drawScanCard();

  renderFulRow();
  const cd = state.cartDiscount && state.cartDiscount.value ? state.cartDiscount : null;
  const discBtn = $('#cartDiscountBtn');
  discBtn.disabled = n === 0;
  discBtn.classList.toggle('on', !!cd || t.scPwd);
  // t.scPwd, not state.scPwd: a bigger line promo wins over SC/PWD (orderTotals), and then no ID goes on the sale
  const dWord = t.scPwd ? ES_SC[state.scPwd.kind] : cd && cd.name ? cd.name : cd && cd.type === 'percent' ? `Discount ${cd.value}%` : 'Discount';
  $('#cartDiscountLabel').textContent = dWord;
  $('#discountRow > span').textContent = SalesMath.discountName({ cartDiscount: cd, items: state.cart }) || 'Discount';   // the receipt's word (receiptParts)
  $('#cartDiscountAmt').textContent = t.discount > 0 ? peso(-t.discount) : '';
  // a discount on: the pill shows only its amount, the same every time; the words are for a screen reader (owner 2026-10-19)
  discBtn.classList.toggle('amt', t.discount > 0);
  if (t.discount > 0) discBtn.setAttribute('aria-label', `${dWord} ${peso(-t.discount)}`); else discBtn.removeAttribute('aria-label');
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
  }
  const next = state.customer;
  if (state.fulfilment === 'delivery' && (prev && prev.id) !== (next && next.id)) state.deliveryAddress = (next && next.address) || '';
  if (prev && prev.id !== (next && next.id)) track('customer_detach', { customerId: prev.id });
  if (next && next.id !== (prev && prev.id)) track('customer_attach', { customerId: next.id });
  if ((prev && prev.id) !== (next && next.id)) state.scPwd = null;   // the sale's discount stays; SC/PWD is the person's (owner 2026-10-09)
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
  lostSaleWas = lostSaleSnap();
  if (!product && !text) $('#lsItemInput').focus();
}
// Cancel, the X, a backdrop tap and Esc ask first when it changed (askLeave, owner 2026-10-22); Save closes at once.
let lostSaleWas = '';
const lostSaleSnap = () => JSON.stringify([$('#lsItemInput').value, $('#lsQtyInput').value, $('#lsSubSelect').value, state.lostSale?.reason, state.lostSale?.productId]);
const lostSaleChanged = () => !$('#lostSaleModal').hidden && lostSaleSnap() !== lostSaleWas;

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
  showDone(`Lost sale logged · ${fields.text}`);
}

