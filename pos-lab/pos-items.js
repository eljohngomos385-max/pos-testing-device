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
  if (itemsKind !== 'items') return renderKindRows();
  $('#itemsBand').classList.remove('k2');
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
  itemIsNew = !it; kindEdit = null;
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

// ---------- Categories and Modifiers (the back office's bo-catalog.js, on the till) ----------
// The top bar's switch picks the list; search and + follow it. A category or a modifier opens in the item editor's
// slide-over: its name, a modifier's options, and ticks for the items it's on. These Saves write (folders, modifiers,
// the items' folders / modifierIds); the item editor's Save is still design only.
let itemsKind = 'items', kindEdit = null;
const KIND = { items: ['item', 'Search items, SKU or barcode'], cats: ['category', 'Search categories'], mods: ['modifier', 'Search modifiers'],
  discs: ['discount', 'Search discounts'] };
const kindCats = () => state.folders.filter(f => f.id !== 'all');
// Discounts (bo-model loadDiscounts): a name and a % or amount, picked in the cart's Discount sheet. Senior / PWD are built in.
const kindList = kind => (kind === 'cats' ? kindCats() : kind === 'discs' ? liveDiscounts() : loadModifiers().filter(m => !m.archived));
const isOn = { cats: (p, id) => foldersOf(p).includes(id), mods: (p, id) => (p.modifierIds || []).includes(id) };
const itemsWith = (kind, id, all = catalogItems()) => all.filter(it => it.members.some(m => isOn[kind](m, id)));
const modSummary = m => m.options.map(o => `${escapeHtml(o.name)} +${peso(o.price)}`).join(' · ');

function setItemsKind(kind) {
  // The pill slides from the old tab to the new one: a ::before placed by --x / --w. Until the first switch (and after a
  // resize, which moves the tabs) the current tab paints its own background instead.
  const box = $('#itemsKinds'), place = b => { box.style.setProperty('--x', `${b.offsetLeft}px`); box.style.setProperty('--w', `${b.offsetWidth}px`); };
  if (!box.classList.contains('slid')) { place(box.querySelector('.cur')); box.classList.add('slid'); box.offsetWidth; }   // start where it is, then move
  itemsKind = kind;
  $$('#itemsKinds [data-kind]').forEach(b => { b.classList.toggle('cur', b.dataset.kind === kind); b.setAttribute('aria-selected', b.dataset.kind === kind); });
  place(box.querySelector('.cur'));
  $('#itemsSearch').placeholder = KIND[kind][1];
  $('#itemsFilter').hidden = kind !== 'items';   // category and stock filter items only
  $('#itemsAdd').title = $('#itemsAdd').ariaLabel = `New ${KIND[kind][0]}`;
  renderItems();
}

function renderKindRows() {
  const q = itemsFilter.q.trim().toLowerCase(), all = catalogItems(), cats = itemsKind === 'cats';
  const list = kindList(itemsKind).filter(x => !q || [x.name, ...(x.options || []).map(o => o.name)].some(n => n.toLowerCase().includes(q)));
  const discs = itemsKind === 'discs';
  $('#itemsBand').classList.add('k2');
  $('#itemsBand').innerHTML = `<span>${KIND[itemsKind][0].replace(/^./, c => c.toUpperCase())} <span class="num">· ${list.length}</span></span><span>${discs ? 'Value' : 'Items'}</span>`;
  $('#itemsRows').innerHTML = list.map(x => `<button type="button" class="row cols k2" data-id="${escapeHtml(x.id)}">
      <span class="nm">${cats ? itemThumb({ hue: itemHue(x.id), name: x.name }) : ''}<span class="tx"><b>${escapeHtml(x.name)}</b>${
        discs ? (x.builtin ? '<small>Asks for the ID number and name</small>' : '') : cats ? '' : `<small>${modSummary(x) || 'No options yet'}</small>`}</span></span>
      <span class="num">${discs ? esShown(x) : itemsWith(itemsKind, x.id, all).length}</span></button>`).join('')
    || `<div class="empty"><b>${q ? 'No matches' : `No ${cats ? 'categories' : 'modifiers'} yet`}</b><span>${q ? 'Try a different name.'
      : cats ? 'Tap + to add one, then tick its items.' : `A modifier is a list of choices sold with an item, like Cut to length +${peso(20)}. Tap + to add one.`}</span></div>`;
}

function openKindEditor(kind, id) {
  const was = kindList(kind).find(x => x.id === id);
  const picked = new Set(was && isOn[kind] ? itemsWith(kind, was.id).map(it => it.id) : []);   // a discount isn't on items
  kindEdit = { kind, id: was ? was.id : '', name: was ? was.name : '', picked, first: new Set(picked),
    type: was?.type || 'percent', value: was ? String(was.value) : '', builtin: was?.builtin || '',
    options: was ? structuredClone(was.options || []) : kind === 'mods' ? [{ id: newId(), name: '', price: '' }] : [] };
  itemEdit = null;
  renderKindForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
  if (!was) setTimeout(() => $('#itemForm [data-k=name]')?.focus(), 300);
}

function renderKindForm() {
  const K = kindEdit, cats = K.kind === 'cats';
  if (K.kind === 'discs') {   // name, % or amount (a dropdown, the ⋯ menu's morph), value; Senior / PWD keep their name and stay %
    const pct = K.type === 'percent', unit = pct ? '%' : SalesMath.currencySymbol(state.settings.store?.currency);
    $('#itemForm').innerHTML = `<div class="form">${icard('Details', [
      ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Summer sale"${K.builtin ? ' disabled' : ''}>`),
      K.builtin ? '' : ifr('Type', `<button type="button" class="act st-pick" data-ka="type" aria-haspopup="menu" aria-expanded="false"><span>${pct ? 'Percent' : 'Amount'}</span><svg class="ic" viewBox="0 0 24 24"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg></button>`),
      ifr(`Value (${unit})`, `<input class="in short num" data-k="value" value="${escapeHtml(K.value)}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0">`),
    ].join('') + (K.builtin ? '<div class="note">Built in. The till asks for the ID number and name, and the rate comes off the price before VAT.</div>' : ''))}</div>`;
    return;
  }
  // What it's on now comes first, so the ticks you'd change are at the top; the order holds while you tick.
  const items = catalogItems().sort((a, b) => (K.first.has(b.id) - K.first.has(a.id)) || a.name.localeCompare(b.name));
  const opt = (o, i) => `<div class="opt" data-i="${i}">
      <input class="in" data-o="name" value="${escapeHtml(o.name)}" placeholder="Option, like Cut to length">
      <input class="in n num" data-o="price" value="${escapeHtml(o.price)}" ${IMONEY} placeholder="0.00" aria-label="Price">
      <button type="button" class="del" data-ka="opt-del" aria-label="Remove option" title="Remove option"><svg class="ic" viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  $('#itemForm').innerHTML = `<div class="form">
    ${icard('Details', ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="${cats ? 'Plumbing' : 'Cutting'}">`))}
    ${cats ? '' : icard('Options', `<div>${K.options.map(opt).join('')}</div>
        <div class="foot"><span>The price is added to the item's.</span><button type="button" class="act" data-ka="opt-add">Add option</button></div>`)}
    ${icard('Items', `<div class="pick-find"><input class="in" data-k="q" placeholder="Search items" autocomplete="off"></div>
        <div class="picks">${items.map(it => `<label class="pick" data-find="${escapeHtml(it.name.toLowerCase())}"><input type="checkbox" data-pick="${escapeHtml(it.id)}"${K.picked.has(it.id) ? ' checked' : ''}>
          ${itemThumb(it)}<span>${escapeHtml(it.name)}</span></label>`).join('')}</div>`, SalesMath.plural(K.picked.size, 'item'))}
  </div>`;
}

function kindInput(t) {
  const K = kindEdit;
  if (t.dataset.k === 'name') K.name = t.value;
  else if (t.dataset.k === 'value') K.value = t.value;
  else if (t.dataset.o) K.options[Number(t.closest('.opt').dataset.i)][t.dataset.o] = t.value;
  else if (t.dataset.pick) {
    K.picked[t.checked ? 'add' : 'delete'](t.dataset.pick);
    t.closest('.fc').querySelector('h3 span').textContent = SalesMath.plural(K.picked.size, 'item');
  } else if (t.dataset.k === 'q') {   // filters the ticks in place, so the box keeps its focus
    const q = t.value.trim().toLowerCase();
    $$('#itemForm .pick').forEach(r => { r.hidden = !!q && !r.dataset.find.includes(q); });
  }
}
function kindClick(b) {
  const K = kindEdit;
  if (b.dataset.ka === 'opt-add') { K.options.push({ id: newId(), name: '', price: '' }); renderKindForm(); $('#itemForm .opt:last-child [data-o=name]').focus(); }
  if (b.dataset.ka === 'opt-del') { K.options.splice(Number(b.closest('.opt').dataset.i), 1); renderKindForm(); }
  if (b.dataset.ka === 'type') openMenu(b, [['percent', 'Percent'], ['amount', 'Amount']].map(([k, label]) => ({ label, cur: K.type === k,
    run: () => { K.type = k; renderKindForm(); $('#itemForm [data-k=value]').focus(); } })));
}

// Puts the category / modifier on every variant of the ticked items and takes it off the rest (bo-catalog setCats):
// folder stays folders[0], and a family's own folder follows it. Archived items keep theirs.
function tagItems(kind, id, keys, at) {
  const on = new Set(catalogItems().filter(it => keys.has(it.id)).flatMap(it => it.members.map(m => m.id))), firstOf = new Map();
  state.products = state.products.map(p => {
    if (p.archived || isOn[kind](p, id) === on.has(p.id)) return p;   // untouched rows keep their stamp
    if (kind === 'mods') { const ids = p.modifierIds || []; return { ...p, modifierIds: on.has(p.id) ? ids.concat(id) : ids.filter(x => x !== id), updatedAt: at }; }
    const folders = on.has(p.id) ? foldersOf(p).concat(id) : foldersOf(p).filter(x => x !== id);
    if (p.groupId) firstOf.set(p.groupId, folders[0] || '');
    return { ...p, folders, folder: folders[0] || '', updatedAt: at };
  });
  saveProducts();
  if (!firstOf.size) return;
  state.groups = state.groups.map(g => (firstOf.has(g.id) ? { ...g, folder: firstOf.get(g.id), updatedAt: at } : g));
  saveGroups();
}

function saveKind() {
  const K = kindEdit, word = KIND[K.kind][0], name = K.name.trim(), at = new Date().toISOString();
  if (!name) { showToast(`Give the ${word} a name`); $('#itemForm [data-k=name]').focus(); return; }
  if (kindList(K.kind).some(x => x.id !== K.id && x.name.toLowerCase() === name.toLowerCase())) { showToast(`A ${word} has that name already`); return; }
  const id = K.id || newId();
  if (K.kind === 'discs') {
    const v = round2(Number(K.value)), pct = K.builtin || K.type === 'percent';   // checked as it will be stored
    if (!(v >= 0.01) || (pct && v > 100)) { showToast(pct ? 'Use a percent from 0.01 to 100' : 'Use an amount above 0'); $('#itemForm [data-k=value]').focus(); return; }
    const list = loadDiscounts();
    const row = stampRow({ ...DISCOUNT_DEFAULTS, ...list.find(d => d.id === id), id, name, type: pct ? 'percent' : 'amount', value: v });
    saveDiscounts(K.id ? list.map(d => (d.id === id ? row : d)) : list.concat(row));
    return closeKindEditor('Saved');
  }
  if (K.kind === 'cats') {
    const row = stampRow({ builtin: false, ...state.folders.find(f => f.id === id), id, name });
    state.folders = K.id ? state.folders.map(f => (f.id === id ? row : f)) : state.folders.concat(row);
    writeJsonStorage(STORAGE_FOLDERS, state.folders);
  } else {
    const named = K.options.filter(o => String(o.name).trim());
    if (named.some(o => !(Number(o.price) >= 0))) { showToast('A price must be 0 or more'); return; }
    const list = loadModifiers();
    const row = stampRow({ ...MODIFIER_DEFAULTS, ...list.find(m => m.id === id), id, name,
      options: named.map(o => ({ id: o.id, name: String(o.name).trim(), price: round2(o.price) })) });
    saveModifiers(K.id ? list.map(m => (m.id === id ? row : m)) : list.concat(row));
  }
  tagItems(K.kind, id, K.picked, at);
  closeKindEditor('Saved');
}

// A category goes (its items stay, they only leave it); a modifier is archived, as in the back office.
function dropKind() {
  const K = kindEdit, at = new Date().toISOString();
  if (K.kind === 'cats') {
    return showConfirm({ title: `Delete “${K.name}”?`, message: 'Its items stay; they only leave this category.', okText: 'Delete', danger: true, from: $('#itemMore'),
      onConfirm: () => {
        tagItems('cats', K.id, new Set(), at);
        state.folders = state.folders.filter(f => f.id !== K.id);
        writeJsonStorage(STORAGE_FOLDERS, state.folders);
        closeKindEditor('Deleted');
      } });
  }
  if (K.kind === 'discs') {   // archived, not removed: old sales keep its name, and a sync never brings it back
    return showConfirm({ title: `Delete “${K.name}”?`, message: 'Sales that used it keep it on their receipt.', okText: 'Delete', danger: true, from: $('#itemMore'),
      onConfirm: () => { saveDiscounts(loadDiscounts().map(d => (d.id === K.id ? stampRow({ ...d, archived: true }) : d))); closeKindEditor('Deleted'); } });
  }
  saveModifiers(loadModifiers().map(m => (m.id === K.id ? stampRow({ ...m, archived: true }) : m)));
  closeKindEditor('Archived');
}
function closeKindEditor(msg) { closeItemEditor(); renderItems(); showToast(msg); }
