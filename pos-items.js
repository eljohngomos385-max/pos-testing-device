// Till › Items: the catalog list and the item editor.

// ---------- Items view (pos-items-rail-lab.html) ----------
// The catalog as items: a group's products are one item's variants. The editor works on a copy and Save is not
// connected yet -- the catalog's writes wait for the back office + sync (ROADMAP.md), so Save only checks the form.
const ITEMS_FILTER_DEF = { cat: '', stock: '' };
const itemsFilter = { q: '', ...ITEMS_FILTER_DEF };
const itemHue = s => [...String(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const itemQty = SalesMath.qtyText;   // the one quantity format, the back office's too
const itemInitials = s => s.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '+';
const itemThumb = (it, big) => `<span class="thumb${big ? ' big' : ''}" style="--h:${it.hue}" aria-hidden="true">${it.img ? `<img src="${it.img}" alt="">` : itemInitials(it.name)}</span>`;
// The family's level is bo-model familyLevel, the same one the back office's Items list and item
// page show (one size out of three = Low, all out = Out). No sale clock here: the till has no Dead filter.
const itemStk = it => ({ out: 'stk-out', low: 'stk-low' })[familyLevel(it.members, null, Date.now(), tillZone())] || '';
// Markup and margin are SalesMath.unitMargin's, the back office's: margin takes the tax out of the price first.
const itemMargin = v => SalesMath.unitMargin(v.cost, v.price, state.settings);
const itemPct = (n, dp) => SalesMath.pctText(n / 100, 1, dp);   // unitMargin gives percent points (the back office's pct)
const itemMarkupText = (cost, price) => itemPct(itemMargin({ cost, price }).markup, 0);
function itemPriceText(it) {
  const ps = it.variants.map(v => v.price), lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? peso(lo) : `<small class="from">from </small>${peso(lo)}<span class="hi">–${peso(hi)}</span>`;
}

function catalogItems() {
  const byKey = new Map(), sup = new Map(posSuppliers().map(s => [s.id, s.name]));
  state.products.forEach(p => {
    if (p.archived) return;   // archived is gone; hidden is still listed here, only off the tiles
    const g = p.groupId ? groupById(p.groupId) : null, key = g ? g.id : p.id;
    let it = byKey.get(key);
    if (!it) {
      const folder = (g && g.folder) || p.folder;
      it = { id: key, name: g ? g.name : p.name, cat: folderName(folder), cats: foldersOf(p).map(folderName), hue: itemHue(folder), unit: p.unit || 'pc',
        soldBy: p.soldBy === 'measure' ? 'measure' : 'each', brand: p.brand || '', img: '', marginMode: 'percent',
        reorder: p.reorderPoint || 0, track: p.trackStock !== false, sellOut: false, supplier: sup.get(p.supplierId) || '', alt: (p.altSupplierIds || []).map(id => sup.get(id)).filter(Boolean), weight: '', size: '', length: '', variants: [], members: [] };
      byKey.set(key, it);
    }
    it.members.push(p);
    const vn = g && p.name.startsWith(g.name) ? p.name.slice(g.name.length).trim() : p.name;   // 'Common Wire Nails 2"' -> '2"'
    it.variants.push({ id: p.id, name: g ? vn : '', sku: p.sku || '', barcode: p.barcode || '', cost: p.cost || 0, price: p.price || 0, stock: p.stock || 0 });
  });
  return [...byKey.values()];
}
const itemCategories = () => state.folders.filter(f => f.id !== 'all').map(f => f.name);
// Items keep supplier ids (supplierId + altSupplierIds, bo-model.js); this form shows the names.
// ponytail: read straight off the back office's list each time; the POS keeps no copy of its own.
const posSuppliers = () => readJsonStorage(STORAGE_SUPPLIERS, []) || [];
const itemSuppliers = () => posSuppliers().filter(s => !s.archived && s.name).map(s => s.name).sort();

function renderItems() {
  const rows = $('#itemsRows');
  if (!rows) return;
  const q = itemsFilter.q.trim().toLowerCase();
  const list = catalogItems().filter(it => {
    if (itemsFilter.cat && !it.cats.includes(itemsFilter.cat)) return false;
    if (itemsFilter.stock === 'low' && itemStk(it) !== 'stk-low') return false;
    if (itemsFilter.stock === 'out' && itemStk(it) !== 'stk-out') return false;
    return !q || it.name.toLowerCase().includes(q) || it.variants.some(v => [v.name, v.sku, v.barcode].some(x => x.toLowerCase().includes(q)));
  }).sort((a, b) => a.name.localeCompare(b.name));
  $('#itemsBand').innerHTML = `<span>Item <span class="num">· ${list.length}</span></span><span>Category</span><span>Price</span><span>In stock</span>`;
  rows.innerHTML = list.map(it => {
    const vn = it.variants.length;
    return `<button type="button" class="row cols" data-id="${escapeHtml(it.id)}">
      <span class="nm">${itemThumb(it)}<span class="tx"><b>${escapeHtml(it.name)}</b>${vn > 1 ? `<small>${vn} variants</small>` : ''}</span></span>
      <span class="cat">${escapeHtml(it.cat)}</span>
      <span class="pr num">${itemPriceText(it)}</span>
      <span class="num ${itemStk(it)}">${itemQty(onHandOf(it.members))} ${escapeHtml(it.unit)}</span></button>`;
  }).join('') || '<div class="empty"><b>No items</b><span>Nothing matches this search or filter.</span></div>';
  $('#itemsFilter')?.classList.toggle('on', Object.keys(ITEMS_FILTER_DEF).some(k => itemsFilter[k] !== ITEMS_FILTER_DEF[k]));
}

// The editor: a working copy E of the item. Nothing here writes to the catalog.
let itemEdit = null, itemIsNew = false;
const blankVariant = () => ({ id: newId(), name: '', sku: '', barcode: '', cost: 0, price: 0, stock: 0, fresh: true });

function openItemEditor(id) {
  const it = id ? catalogItems().find(x => x.id === id) : null;
  itemIsNew = !it;
  itemEdit = it || { id: newId(), name: '', cat: '', hue: 220, unit: 'pc', soldBy: 'each', brand: '', img: '', marginMode: 'percent', reorder: 0, sellOut: false,
    supplier: '', alt: [], weight: '', size: '', length: '', variants: [blankVariant()], since: tillDay(Date.now()) };
  const v0 = itemEdit.variants[0];
  itemEdit.marginValue = marginFromPrice(v0.cost, v0.price, itemEdit.marginMode);
  renderItemForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
}
const closeItemEditor = () => $('#itemsView').classList.remove('editing');

const ifr = (label, ctl) => `<div class="fr"><span class="lb">${label}</span><div class="ctl">${ctl}</div></div>`;
const iinp = (f, v, attrs = '') => `<input class="in" data-f="${f}" value="${escapeHtml(v)}" ${attrs}>`;
const IMONEY = 'type="number" step="0.01" min="0" inputmode="decimal"';
const ipills = (f, cur, opts) => `<div class="pills" data-pills="${f}">${opts.map(([k, l]) => `<button type="button" class="${cur === k ? 'cur' : ''}" data-v="${escapeHtml(k)}">${l}</button>`).join('')}</div>`;
const icard = (title, body, sub = '') => `<section class="card fc"><h3>${title}${sub ? `<span>${sub}</span>` : ''}</h3>${body}</section>`;
const imarginNote = v => { const m = itemMargin(v); return `<b>${peso(m.profit)}</b> gross profit on each · <b>${itemPct(m.markup)}</b> markup on cost · <b>${itemPct(m.margin)}</b> margin`; };

function itemVariantRow(v) {
  const E = itemEdit;
  return `<div class="vt" data-vid="${escapeHtml(v.id)}">
    <input class="in" data-v="name" value="${escapeHtml(v.name)}" placeholder="e.g. Red, 2 inch">
    <input class="in" data-v="sku" value="${escapeHtml(v.sku)}">
    <input class="in" data-v="barcode" value="${escapeHtml(v.barcode)}" inputmode="numeric">
    <input class="in n" data-v="cost" value="${v.cost || ''}" ${IMONEY}>
    <input class="in n" data-v="price" value="${v.price || ''}" ${IMONEY}>
    <span class="mg num">${itemMarkupText(v.cost, v.price)}</span>
    ${v.fresh ? `<input class="in n" data-v="stock" value="${v.stock || ''}" type="number" step="${E.soldBy === 'measure' ? .01 : 1}" min="0" placeholder="0">`
      : `<span class="st num ${v.stock <= 0 ? 'stk-out' : ''}">${itemQty(v.stock)} ${escapeHtml(E.unit)}</span>`}
    <button type="button" class="del" data-act="del-variant" aria-label="Remove variant" title="Remove variant"><svg class="ic" viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  </div>`;
}

function renderItemForm() {
  const E = itemEdit, fam = E.variants.length > 1, v0 = E.variants[0], shared = fam ? 'Shared by every variant' : '';
  const sups = itemSuppliers();
  const details = icard('Details', [
    ifr('Name', iinp('name', E.name, 'placeholder="Portland Cement 40kg"')),
    ifr('Brand', iinp('brand', E.brand)),
    ifr('Image', `${itemThumb(E, true)}<label class="act">Upload<input type="file" accept="image/*" id="itemImg" hidden></label>${E.img ? '<button type="button" class="link" data-act="img-clear">Remove</button>' : ''}`),
  ].join(''), shared);
  const soldAs = icard('Sold as', [
    ifr('How it is sold', ipills('soldBy', E.soldBy, [['each', 'Each'], ['measure', 'By measure']])),
    ifr('Unit', iinp('unit', E.unit, 'placeholder="pc" style="width:150px"')),
  ].join(''), shared);
  const pricing = fam ? '' : icard('Pricing', [
    ifr('Cost', `<input class="in short num" data-f="cost" value="${v0.cost || ''}" ${IMONEY}>`),
    ifr('Markup', ipills('marginMode', E.marginMode, [['flat', 'Flat'], ['percent', 'Percent']])),
    ifr(E.marginMode === 'percent' ? 'Markup on cost (%)' : 'Markup per unit', `<input class="in short num" data-f="marginValue" value="${E.marginValue || ''}" type="number" step="0.01" inputmode="decimal">`),
    ifr('Price', `<input class="in short num" data-f="price" value="${v0.price || ''}" ${IMONEY}>`),
  ].join('') + `<div class="note num" id="itemMarginNote">${imarginNote(v0)}</div>`);
  const inventory = icard('Inventory', [
    fam ? '' : itemIsNew ? ifr('Opening quantity', `<input class="in short num" data-f="stock" value="${v0.stock || ''}" type="number" step="${E.soldBy === 'measure' ? .01 : 1}" min="0" placeholder="0">`)
      : ifr('In stock', `<input class="in short num" value="${itemQty(v0.stock)} ${escapeHtml(E.unit)}" disabled><button type="button" class="link" data-act="stock">Adjust stock</button>`),
    itemIsNew ? ifr('In store since', `<input class="in short" type="date" data-f="since" value="${E.since}">`) : '',
    ifr('Danger level', `<input class="in short num" data-f="reorder" value="${E.reorder}" type="number" step="1" min="0" inputmode="numeric">`),
    ifr('Sell when out of stock', `<input type="checkbox" class="sw" data-f="sellOut" ${E.sellOut ? 'checked' : ''} aria-label="Sell when out of stock">`),
    fam ? '' : ifr('SKU', iinp('sku', v0.sku)),
    fam ? '' : ifr('Barcode', iinp('barcode', v0.barcode, 'inputmode="numeric"')),
  ].join(''), shared);
  const variants = fam
    ? icard('Variants', `<div class="vt-wrap"><div class="vt th"><span>Variant</span><span>SKU</span><span>Barcode</span><span>Cost</span><span>Price</span><span>Markup</span><span>Stock</span><span></span></div>
        <div>${E.variants.map(itemVariantRow).join('')}</div></div>
        <div class="foot"><span>Stock on a variant that exists is moved with Adjust stock.</span><button type="button" class="act" data-act="add-variant">Add variant</button></div>`,
        `${E.variants.length} in this item`)
    : icard('Variants', `<div class="blurb">Sold in sizes or colours? Add a variant. Each one gets its own SKU, barcode, price and stock.</div>
        <div class="foot" style="justify-content:flex-end"><button type="button" class="act" data-act="add-variant">Add variant</button></div>`);
  const org = icard('Organization', [
    ifr('Category', `<input class="in" data-f="cat" value="${escapeHtml(E.cat)}" list="itemCatList" placeholder="Uncategorized">`),
    ifr('Supplier', `<input class="in" data-f="supplier" value="${escapeHtml(E.supplier)}" list="itemSupList" placeholder="No supplier">`),
    sups.length ? ifr('Also stocked by', `<div class="pills" data-multi="alt">${sups.filter(s => s !== E.supplier).map(s => `<button type="button" class="${E.alt.includes(s) ? 'cur' : ''}" data-v="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>`) : '',
  ].join(''));
  const specs = icard('Specs', [
    ifr('Weight', iinp('weight', E.weight, 'placeholder="2.5 kg"')),
    ifr('Size', iinp('size', E.size, 'placeholder="3/4 in"')),
    ifr('Length', iinp('length', E.length, 'placeholder="8 ft"')),
  ].join(''), 'Free text');
  $('#itemForm').innerHTML = `<div class="form">
    ${details}${soldAs}${pricing}${inventory}${variants}${org}${specs}
    <datalist id="itemCatList">${itemCategories().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
    <datalist id="itemSupList">${sups.map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
  </div>`;
}

// cost / margin / price: any two drive the third (the back office's three-way binding)
function itemReprice(from) {
  const E = itemEdit, v0 = E.variants[0], pct = E.marginMode === 'percent', f = $('#itemForm');
  if (from === 'price') {
    E.marginValue = marginFromPrice(v0.cost, v0.price, E.marginMode);
    f.querySelector('[data-f=marginValue]').value = E.marginValue || '';
  } else {
    v0.price = priceFromMargin(v0.cost, E.marginMode, E.marginValue);   // bo-model's, as the back office editor
    f.querySelector('[data-f=price]').value = v0.price || '';
  }
  $('#itemMarginNote').innerHTML = imarginNote(v0);
}

function saveItem() {
  const E = itemEdit;
  if (!E.name.trim()) { showToast('Give the item a name'); $('#itemForm').querySelector('[data-f=name]').focus(); return; }
  if (E.variants.length > 1 && E.variants.some(v => !v.name.trim())) { showToast('Name every variant'); return; }
  showToast("Saving isn't connected yet");   // ponytail: design only until the back office owns catalog writes
}

