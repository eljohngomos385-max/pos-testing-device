// Till › Items: the catalog list and the item editor.

// ---------- Items view (pos-items-rail-lab.html) ----------
// The catalog as items: a group's products are one item's variants. The editor works on a copy and Save is not
// connected yet -- the catalog's writes wait for the back office + sync (ROADMAP.md), so Save only checks the form.
const ITEMS_FILTER_DEF = { cat: '', stock: '' };
const itemsFilter = { q: '', ...ITEMS_FILTER_DEF };
const itemHue = s => [...String(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const itemQty = SalesMath.qtyText;   // the one quantity format, the back office's too
const itemInitials = s => s.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '+';
const itemThumb = (it, big) => `<span class="thumb${big ? ' big' : ''}" style="--h:${it.hue}" aria-hidden="true">${it.img ? `<img src="${escapeHtml(it.img)}" alt="">` : itemInitials(it.name)}</span>`;
// The family's level is bo-model familyLevel, the same one the back office's Items list and item
// page show (one size out of three = Low, all out = Out). No sale clock here: the till has no Dead filter.
const itemStk = it => ({ out: 'stk-out', low: 'stk-low' })[familyLevel(it.members, null, Date.now(), tillZone())] || '';
// Markup and margin are SalesMath.unitMargin's, the back office's: margin takes the tax out of the price first.
const itemMargin = v => SalesMath.unitMargin(v.cost, v.price, state.settings);
const itemPct = (n, dp) => SalesMath.pctText(n / 100, 1, dp);   // unitMargin gives percent points (the back office's pct)
const itemMarkupText = (cost, price) => itemPct(itemMargin({ cost, price }).markup, 0);
function itemPriceText(it) {
  const ps = it.variants.filter(v => !askedPrice(v)).map(v => v.price), lo = Math.min(...ps), hi = Math.max(...ps);
  if (!ps.length) return '—';   // every variant's price is asked at sale
  return lo === hi ? peso(lo) : `<small class="from">from </small>${peso(lo)}<span class="hi">–${peso(hi)}</span>`;
}

function catalogItems() {
  const byKey = new Map();
  state.products.forEach(p => {
    if (p.archived) return;   // archived is gone; hidden is still listed here, only off the tiles
    const g = p.groupId ? groupById(p.groupId) : null, key = g ? g.id : p.id;
    let it = byKey.get(key);
    if (!it) {
      // a family's name, photo and description are its group's; the rest its first member's, as the back office's item page reads them
      const folder = (g && g.folder) || p.folder, catIds = foldersOf(p);
      it = { id: key, name: g ? g.name : p.name, cat: folderName(folder), cats: catIds.map(folderName), catIds, hue: itemHue(folder), unit: p.unit || 'pc',
        soldBy: p.soldBy === 'measure' ? 'measure' : 'each', img: (g ? g.imageUrl : p.imageUrl) || '', desc: (g ? g.description : p.description) || '',
        hidden: !!p.hidden, marginMode: p.marginMode === 'flat' ? 'flat' : 'percent', reorder: p.reorderPoint || 0, track: p.trackStock !== false,
        sellOut: !!p.sellOutOfStock, sups: supplierIdsOf(p), main: p.supplierId || '', mods: [...(p.modifierIds || [])],
        weight: p.weight || '', size: p.size || '', length: p.length || '', variants: [], members: [] };
      byKey.set(key, it);
    }
    it.members.push(p);
    const vn = g && p.name.startsWith(g.name) ? p.name.slice(g.name.length).trim() : p.name;   // 'Common Wire Nails 2"' -> '2"'
    it.variants.push({ id: p.id, name: g ? vn : '', sku: p.sku || '', barcode: p.barcode || '', cost: p.cost || 0, price: askedPrice(p) ? null : p.price, stock: p.stock || 0 });
  });
  return [...byKey.values()];
}
const itemCategories = () => state.folders.filter(f => f.id !== 'all').map(f => f.name);
// ponytail: read straight off the back office's list each time; the POS keeps no copy of its own.
const posSuppliers = () => readJsonStorage(STORAGE_SUPPLIERS, []) || [];

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
// Apple Settings (owner 2026-10-08): blocks of rows, each word at the side of its field like the customer form; a long
// list (categories, modifiers, suppliers, one variant) is a row with its value and ›, opening its own page.
let itemEdit = null, itemIsNew = false, itemSub = '', itemMainScroll = 0;   // itemSub: '' = the item, else 'cats' | 'mods' | 'sups' | a variant's id
const blankVariant = () => ({ id: newId(), name: '', sku: '', barcode: '', cost: 0, price: null, stock: 0, fresh: true });
// Sold per: bo-products UNITS, its soldByFor. A measured unit sells in decimals; a unit typed elsewhere keeps what it was.
const ITEM_UNITS = [['pc', 'box', 'bag', 'set', 'pair', 'roll', 'sheet', 'can'], ['m', 'ft', 'kg', 'L', 'gal']];
const soldByFor = (unit, was) => (ITEM_UNITS[1].includes(unit) ? 'measure' : ITEM_UNITS[0].includes(unit) ? 'each' : was || 'each');

function openItemEditor(id) {
  const it = id ? catalogItems().find(x => x.id === id) : null;
  itemIsNew = !it; kindEdit = null; itemSub = '';
  itemEdit = it || { id: newId(), name: '', desc: '', cat: '', catIds: [], hue: 220, unit: 'pc', soldBy: 'each', img: '', hidden: false, marginMode: 'percent',
    reorder: 0, track: true, sellOut: false, sups: [], main: '', mods: [], weight: '', size: '', length: '', variants: [blankVariant()], since: tillDay(Date.now()) };
  const v0 = itemEdit.variants[0];
  itemEdit.marginValue = itemMarkupOf(v0, itemEdit.marginMode);
  renderItemForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
}
const closeItemEditor = () => $('#itemsView').classList.remove('editing');
// a subpage slides in over the item; '' slides back to where the item was scrolled
function itemGo(sub) {
  const f = $('#itemForm');
  if (sub) itemMainScroll = f.scrollTop;
  itemSub = sub;
  renderItemForm(sub ? 'push' : 'pop');
  f.scrollTop = sub ? 0 : itemMainScroll;
}

// the rows: a field, a switch, a dropdown, a › to a subpage, a blue action
const ICHEV = '<svg class="ic chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
const IUPDOWN = '<svg class="ic" viewBox="0 0 24 24"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></svg>';
const ifr = (label, ctl, end) => `<div class="fr"><span class="lb">${label}</span><div class="ctl${end ? ' end' : ''}">${ctl}</div></div>`;
const iinp = (f, v, attrs = '') => `<input class="in" data-f="${f}" value="${escapeHtml(v)}" ${attrs}>`;
const IMONEY = 'type="number" step="0.01" min="0" inputmode="decimal"';
const isw = (label, f, on) => `<label class="fr"><span class="lb">${label}</span><span class="ctl end"><input type="checkbox" class="sw" data-f="${f}"${on ? ' checked' : ''}></span></label>`;
const ipick = (act, text) => `<button type="button" class="act st-pick" data-act="${act}" aria-haspopup="menu" aria-expanded="false"><span>${text}</span>${IUPDOWN}</button>`;
const inav = (label, value, sub) => `<button type="button" class="fr nav" data-sub="${escapeHtml(sub)}"><span class="lb">${label}</span><span class="ctl end"><span class="vv${value === 'None' ? ' ph' : ''}">${value}</span>${ICHEV}</span></button>`;   // nothing set reads as a hint, like rednote's "Edit birthday"
const iadd = (act, text, cls = '') => `<button type="button" class="fr add${cls}" data-act="${act}">${text}</button>`;
// a block: a small grey title above, the rows on one tile, a footnote under; ' r' = values to the right edge (rednote's settings)
const icard = (title, body, foot = '', cls = '') => `${title ? `<h3 class="fc-t">${title}</h3>` : ''}<section class="card fc${cls}">${body}</section>${foot ? `<p class="fc-n">${foot}</p>` : ''}`;
// a blank Price is asked at sale (askedPrice): no markup, no profit to show
const itemMarkupOf = (v, mode) => (askedPrice(v) ? null : marginFromPrice(v.cost, v.price, mode));
const imarginNote = v => { if (askedPrice(v)) return '—'; const m = itemMargin(v); return `${peso(m.profit)} · ${itemPct(m.margin)} margin`; };
const iprofit = v => `Profit <span class="num" id="itemMarginNote">${imarginNote(v)}</span>`;   // the Price block's footnote
const istep = () => (itemEdit.soldBy === 'measure' ? .01 : 1);
const iqty = (attr, v) => `<input class="in num" ${attr} value="${v || ''}" type="number" step="${istep()}" min="0" inputmode="decimal" placeholder="0">`;
const ionHand = v => `<span class="vv num${v.stock <= 0 ? ' stk-out' : ''}">${itemQty(v.stock)} ${escapeHtml(itemEdit.unit)}</span><button type="button" class="link" data-act="stock">Adjust</button>`;
const ilist = a => (a.length ? escapeHtml(a.length > 2 ? `${a[0]}, ${a[1]} +${a.length - 2}` : a.join(', ')) : 'None');
const supName = id => (posSuppliers().find(s => s.id === id) || {}).name || '';
const icurrency = () => SalesMath.currencySymbol(state.settings.store?.currency);

function renderItemForm(dir) {
  const E = itemEdit, v = E.variants.find(x => x.id === itemSub);
  const [title, html] = itemSub === 'cats' ? ['Categories', itemTickPage('catIds', kindCats().map(c => [c.id, c.name]), 'No categories yet. Add them under Categories.')]
    : itemSub === 'mods' ? ['Modifiers', itemTickPage('mods', kindList('mods').map(m => [m.id, m.name, modSummary(m)]), 'No modifiers yet. Add them under Modifiers.')]
    : itemSub === 'sups' ? ['Suppliers', itemSupsPage()]
    : itemSub === 'specs' ? ['Specs', itemSpecsPage()]
    : v ? [v.fresh ? 'Add variant' : 'Edit variant', itemVariantPage(v)] : [E.name || 'New item', itemMainPage()];   // a fixed title: typing a variant's name doesn't echo up there
  $('#itemForm').closest('.editor').classList.toggle('sub', !!itemSub);   // a subpage has only Back, as in Apple Settings
  $('#itemMore').hidden = true;   // the item has no ⋯ (owner 2026-10-09): Archive is the last block, Back discards a new one
  $('#itemForm').innerHTML = `<div class="form${dir ? ' ' + dir : ''}">${html}</div>`;
  $('#itemTitle').textContent = title;   // small, in the top bar beside Back (rednote's Edit profile)
}

// rednote's Edit profile (owner 2026-10-09): the photo centred on top, white blocks on the grey page, the word in a
// column on the left and its value just after it (not pushed right); Status worded as the back office's; the
// description its own block under Name and Status (rednote's Bio), growing as it is typed.
const ICAM = '<svg class="ic" viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.5" r="3.2"/></svg>';
function itemMainPage() {
  const E = itemEdit, fam = E.variants.length > 1, v0 = E.variants[0], T = E.track;
  const photo = `<div class="fphoto"><label for="itemImg" aria-label="${E.img ? 'Change photo' : 'Add photo'}">${itemThumb(E, true)}<span class="cam">${ICAM}</span>
    <input type="file" accept="image/*" id="itemImg" hidden></label>${E.img ? '<button type="button" class="link" data-act="img-clear">Remove photo</button>' : ''}</div>`;
  const about = icard('', [
    ifr('Name', iinp('name', E.name, 'placeholder="Add name"')),
    ifr('Status', ipick('status', E.hidden ? 'Hidden' : 'Active'), true),
  ].join(''), '', ' r');
  const desc = icard('', ifr('Description', `<textarea class="in" data-f="desc" rows="1" placeholder="Add description">${escapeHtml(E.desc)}</textarea>`), '', ' r');
  const vrow = v => `<button type="button" class="fr nav wide" data-sub="${escapeHtml(v.id)}"><span class="lb${v.name ? '' : ' ph'}">${escapeHtml(v.name || 'No name')}</span>
    <span class="ctl end"><span class="vv num">${askedPrice(v) ? '—' : peso(v.price)}${T ? ` · ${itemQty(v.stock)} ${escapeHtml(E.unit)}` : ''}</span>${ICHEV}</span></button>`;
  // small blocks, one job each (rednote's Account security): one item = [Price, Cost, Markup, profit under it] [Add variant];
  // a family = its variants and Add variant on one block, each variant's numbers on its own page
  const price = fam ? icard('', E.variants.map(vrow).join('') + iadd('add-variant', 'Add variant'))
    : icard('', [
      ifr('Price', `<input class="in num" data-f="price" value="${v0.price ?? ''}" ${IMONEY} placeholder="Asked at sale">`),
      ifr('Cost', `<input class="in num" data-f="cost" value="${v0.cost || ''}" ${IMONEY} placeholder="0.00">`),
      ifr('Markup', `<input class="in num" data-f="marginValue" value="${E.marginValue || ''}" type="number" step="0.01" inputmode="decimal" placeholder="0">${ipick('mmode', E.marginMode === 'percent' ? '%' : icurrency())}`),
    ].join(''), iprofit(v0), ' r')
    + icard('', iadd('add-variant', 'Add variant'));
  // stock out on the page, not behind a › (owner 2026-10-09); a family counts per variant, on each variant's page
  const stock = icard('', [
    isw('Track stock', 'track', T),
    !T || fam ? '' : itemIsNew ? ifr('Opening stock', iqty('data-f="stock"', v0.stock)) : ifr('In stock', ionHand(v0), true),
    T ? ifr('Low stock at', iqty('data-f="reorder"', E.reorder)) : '',
    T && !fam && itemIsNew ? ifr('In store since', `<input class="in" type="date" data-f="since" value="${E.since}">`) : '',
    T ? isw('Sell when out of stock', 'sellOut', E.sellOut) : '',
  ].join(''), T ? '' : 'Not counted: never low, never out.', ' r');
  const codes = icard('', [   // how it's sold and scanned; a family's SKU and barcode are per variant
    ifr('Sold per', ipick('unit', escapeHtml(E.unit)), true),
    fam ? '' : ifr('SKU', iinp('sku', v0.sku, 'placeholder="Add SKU"')),
    fam ? '' : ifr('Barcode', iinp('barcode', v0.barcode, 'inputmode="numeric" placeholder="Add barcode"')),
  ].join(''), '', ' r');
  const mods = new Map(kindList('mods').map(m => [m.id, m.name]));
  const more = icard('', [
    inav('Categories', ilist(E.catIds.map(folderName).filter(Boolean)), 'cats'),
    inav('Modifiers', ilist(E.mods.map(id => mods.get(id)).filter(Boolean)), 'mods'),
    inav('Suppliers', ilist([E.main, ...E.sups.filter(id => id !== E.main)].filter(Boolean).map(supName).filter(Boolean)), 'sups'),
    inav('Specs', escapeHtml([E.weight, E.size, E.length].filter(Boolean).join(' · ')) || 'None', 'specs'),
  ].join(''), '', ' r');
  const archive = itemIsNew ? '' : icard('', iadd('archive', 'Archive item', ' red'));   // the ⋯ menu's last action, now the last block
  return photo + about + desc + price + stock + codes + more + archive;
}
function itemSpecsPage() {
  const E = itemEdit;
  return icard('', [
    ifr('Weight', iinp('weight', E.weight, 'placeholder="Add weight"')),
    ifr('Size', iinp('size', E.size, 'placeholder="Add size"')),
    ifr('Length', iinp('length', E.length, 'placeholder="Add length"')),
  ].join(''));
}

// a subpage's ticks: search above (a store runs to 50-100 categories), the list on one tile
function itemTickPage(key, rows, empty) {
  const on = itemEdit[key];
  return icard('', (rows.length > 8 ? IFIND : '') + rows.map(([id, name, sub]) => `<label class="pick" data-find="${escapeHtml(name.toLowerCase())}"><input type="checkbox" data-tick="${key}" value="${escapeHtml(id)}"${on.includes(id) ? ' checked' : ''}>
      <span class="tx">${escapeHtml(name)}${sub ? `<small>${sub}</small>` : ''}</span></label>`).join('') || `<div class="pick">${empty}</div>`);
}
function itemSupsPage() {
  const E = itemEdit, rows = posSuppliers().filter(s => !s.archived && s.name).sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.id, s.name]);
  return icard('', ifr('Main supplier', ipick('main', escapeHtml(supName(E.main) || 'None')), true), 'Purchase orders go to the main supplier.')
    + itemTickPage('sups', rows, 'No suppliers yet. Add them in the back office.');
}
function itemVariantPage(v) {
  const E = itemEdit;
  const vin = (k, attrs = '') => `<input class="in" data-v="${k}" value="${escapeHtml(v[k])}" ${attrs}>`;
  return icard('', ifr('Name', vin('name', 'placeholder="Add name, like Red or 2 inch"')), '', ' r')
    + icard('', ifr('Price', `<input class="in num" data-v="price" value="${v.price ?? ''}" ${IMONEY} placeholder="Asked at sale">`)
      + ifr('Cost', `<input class="in num" data-v="cost" value="${v.cost || ''}" ${IMONEY} placeholder="0.00">`), iprofit(v), ' r')
    + icard('', [
      !E.track ? '' : v.fresh ? ifr('Opening stock', iqty('data-v="stock"', v.stock)) : ifr('In stock', ionHand(v), true),
      ifr('SKU', vin('sku', 'placeholder="Add SKU"')),
      ifr('Barcode', vin('barcode', 'inputmode="numeric" placeholder="Add barcode"')),
    ].join(''), '', ' r')
    + (E.variants.length > 1 ? icard('', iadd('del-variant', 'Remove variant', ' red')) : '');
}

// the dropdowns, the ⋯ menu's morph as in Settings
function itemPick(b) {
  const E = itemEdit, v0 = E.variants[0], act = b.dataset.act;
  const opt = (k, label, cur, run) => ({ label, cur, run });
  const items = act === 'status' ? [opt('', 'Active', !E.hidden, () => { E.hidden = false; renderItemForm(); }), opt('', 'Hidden', E.hidden, () => { E.hidden = true; renderItemForm(); })]
    : act === 'mmode' ? [['percent', 'Percent (%)'], ['flat', `Flat (${icurrency()})`]].map(([k, label]) => opt(k, label, E.marginMode === k,
      () => { E.marginMode = k; E.marginValue = itemMarkupOf(v0, k); renderItemForm(); }))
    : act === 'unit' ? [...(ITEM_UNITS.flat().includes(E.unit) ? [] : [E.unit]), ...ITEM_UNITS[0], '-', ...ITEM_UNITS[1]].map(u => (u === '-' ? u
      : opt(u, u, E.unit === u, () => { E.soldBy = soldByFor(u, E.soldBy); E.unit = u; renderItemForm(); })))
    : act === 'main' ? ['', ...E.sups].map(id => opt(id, id ? supName(id) : 'None', E.main === id, () => { E.main = id; b.firstChild.textContent = supName(id) || 'None'; }))
    : null;
  if (items) openMenu(b, items, { w: 200, right: true });
}

// cost / margin / price: any two drive the third (the back office's three-way binding)
function itemReprice(from) {
  const E = itemEdit, v0 = E.variants[0], f = $('#itemForm');
  if (from === 'price') {
    E.marginValue = itemMarkupOf(v0, E.marginMode);
    f.querySelector('[data-f=marginValue]').value = E.marginValue || '';
  } else if (E.marginValue != null) {   // no markup typed: the price stays as it is (blank = asked at sale)
    v0.price = priceFromMargin(v0.cost, E.marginMode, E.marginValue);   // bo-model's, as the back office editor
    f.querySelector('[data-f=price]').value = v0.price;
  }
  $('#itemMarginNote').innerHTML = imarginNote(v0);
}
// a tick list's search: hides the rows in place, so the box keeps its focus
const IFIND = '<div class="pick-find"><input class="in" data-k="q" type="search" placeholder="Search" autocomplete="off"></div>';
const filterPicks = q => { q = q.trim().toLowerCase(); $$('#itemForm .pick[data-find]').forEach(r => { r.hidden = !!q && !r.dataset.find.includes(q); }); };

function saveItem() {
  const E = itemEdit;
  if (!E.name.trim()) { if (itemSub) itemGo(''); showToast('Give the item a name'); $('#itemForm').querySelector('[data-f=name]').focus(); return; }
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
  $('#itemsBand').classList.add('k2');   // k2 hides the head: the rows say it (owner 2026-10-09)
  $('#itemsRows').innerHTML = list.map(x => `<button type="button" class="row cols k2" data-id="${escapeHtml(x.id)}">
      <span class="nm">${cats ? itemThumb({ hue: itemHue(x.id), name: x.name }) : ''}<span class="tx"><b>${escapeHtml(x.name)}</b>${
        discs ? (x.builtin ? '<small>Asks for the ID number and name</small>' : '') : cats ? '' : `<small>${modSummary(x) || 'No options yet'}</small>`}</span></span>
      <span class="num">${discs ? esShown(x) : SalesMath.plural(itemsWith(itemsKind, x.id, all).length, 'item')}</span></button>`).join('')
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
  $('#itemForm').closest('.editor').classList.remove('sub');
  const K = kindEdit, cats = K.kind === 'cats', head = '';
  $('#itemTitle').textContent = K.name || `New ${KIND[K.kind][0]}`;
  $('#itemMore').hidden = false;   // a category's Delete, a modifier's Archive
  if (K.kind === 'discs') {   // name, % or amount (a dropdown, the ⋯ menu's morph), value; Senior / PWD keep their name and stay %
    const pct = K.type === 'percent', unit = pct ? '%' : icurrency();
    $('#itemForm').innerHTML = `<div class="form">${head}${icard('', [
      ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Add name, like Summer sale"${K.builtin ? ' disabled' : ''}>`),
      K.builtin ? '' : ifr('Type', `<button type="button" class="act st-pick" data-ka="type" aria-haspopup="menu" aria-expanded="false"><span>${pct ? 'Percent' : 'Amount'}</span>${IUPDOWN}</button>`, true),
      ifr(`Value (${unit})`, `<input class="in num" data-k="value" value="${escapeHtml(K.value)}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0">`),
    ].join(''), K.builtin ? 'Built in. The till asks for the ID number and name, and the rate comes off the price before VAT.' : '')}</div>`;
    return;
  }
  // What it's on now comes first, so the ticks you'd change are at the top; the order holds while you tick.
  const items = catalogItems().sort((a, b) => (K.first.has(b.id) - K.first.has(a.id)) || a.name.localeCompare(b.name));
  const opt = (o, i) => `<div class="opt" data-i="${i}">
      <input class="in" data-o="name" value="${escapeHtml(o.name)}" placeholder="Option name">
      <input class="in num" data-o="price" value="${escapeHtml(o.price)}" ${IMONEY} placeholder="0.00" aria-label="Price">
      <button type="button" class="del" data-ka="opt-del" aria-label="Remove option" title="Remove option"><svg class="ic" viewBox="0 0 24 24" style="width:15px;height:15px"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  $('#itemForm').innerHTML = `<div class="form">${head}
    ${icard('', ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Add name, like ${cats ? 'Plumbing' : 'Cutting'}">`))}
    ${cats ? '' : icard('Options', K.options.map(opt).join('') + '<button type="button" class="fr add" data-ka="opt-add">Add option</button>', "The price is added to the item's.")}
    ${icard(`Items <span class="num" id="kindCount">· ${K.picked.size}</span>`, (items.length > 8 ? IFIND : '') + items.map(it => `<label class="pick" data-find="${escapeHtml(it.name.toLowerCase())}"><input type="checkbox" data-pick="${escapeHtml(it.id)}"${K.picked.has(it.id) ? ' checked' : ''}>
          ${itemThumb(it)}<span class="tx">${escapeHtml(it.name)}</span></label>`).join(''))}
  </div>`;
}

function kindInput(t) {
  const K = kindEdit;
  if (t.dataset.k === 'name') { K.name = t.value; $('#itemTitle').textContent = K.name || `New ${KIND[K.kind][0]}`; }
  else if (t.dataset.k === 'value') K.value = t.value;
  else if (t.dataset.o) K.options[Number(t.closest('.opt').dataset.i)][t.dataset.o] = t.value;
  else if (t.dataset.pick) {
    K.picked[t.checked ? 'add' : 'delete'](t.dataset.pick);
    $('#kindCount').textContent = `· ${K.picked.size}`;
  }
}
function kindClick(b) {
  const K = kindEdit;
  if (b.dataset.ka === 'opt-add') { K.options.push({ id: newId(), name: '', price: '' }); renderKindForm(); $$('#itemForm .opt [data-o=name]').pop().focus(); }
  if (b.dataset.ka === 'opt-del') { K.options.splice(Number(b.closest('.opt').dataset.i), 1); renderKindForm(); }
  if (b.dataset.ka === 'type') openMenu(b, [['percent', 'Percent'], ['amount', 'Amount']].map(([k, label]) => ({ label, cur: K.type === k,
    run: () => { K.type = k; renderKindForm(); $('#itemForm [data-k=value]').focus(); } })), { w: 200, right: true });
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
