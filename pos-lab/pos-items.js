// Till › Items: the catalog list and the item editor.

// ---------- Items view (pos-items-rail-lab.html) ----------
// The catalog as items: a group's products are one item's variants. The editor works on a copy; Save writes it back.
const ITEMS_FILTER_DEF = { cat: '', stock: '' };
const itemsFilter = { q: '', ...ITEMS_FILTER_DEF };
const itemQty = SalesMath.qtyText;   // the one quantity format, the back office's too
const itemInitials = s => s.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '+';
const itemThumb = (it, big) => `<span class="thumb${big ? ' big' : ''}"${it.hue == null ? '' : ` style="--h:${it.hue}"`} aria-hidden="true">${it.img ? `<img src="${escapeHtml(it.img)}" alt="">` : itemInitials(it.name)}</span>`;
// The family's level is bo-model familyLevel, the same one the back office's Items list and item
// page show (one size out of three = Low, all out = Out). No sale clock here: the till has no Dead filter.
const itemStk = it => ({ out: 'stk-out', low: 'stk-low' })[familyLevel(it.members, null, Date.now(), tillZone())] || '';
const itemOnHand = it => (it.track ? `${itemQty(onHandOf(it.members))} ${escapeHtml(it.unit)}` : '');   // stock off: no count, never "0"
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
      it = { id: key, name: g ? g.name : p.name, cat: folderName(folder), cats: catIds.map(folderName), catIds, unit: p.unit || 'pc',
        soldBy: p.soldBy === 'measure' ? 'measure' : 'each', img: (g ? g.imageUrl : p.imageUrl) || '', color: (g ? g.color : p.color) || '', desc: (g ? g.description : p.description) || '',
        hidden: !!p.hidden, marginMode: p.marginMode === 'flat' ? 'flat' : 'percent', reorder: p.reorderPoint || 0, track: p.trackStock !== false,
        sellOut: !!p.sellOutOfStock, sups: supplierIdsOf(p), main: p.supplierId || '', mods: [...(p.modifierIds || [])], hideCh: [...(p.hiddenChoiceIds || [])].sort(),
        weight: p.weight || '', size: p.size || '', length: p.length || '', component: !!p.component, variants: [], members: [] };
      it.hue = TILE_COLORS[it.color];   // the thumb is the Sell tile: its colour, or plain with none (owner 2026-10-22: no made-up hue)
      byKey.set(key, it);
    }
    it.members.push(p);
    it.variants.push({ id: p.id, name: g ? p.name : '', sku: p.sku || '', alts: [...p.aliases || []], barcode: p.barcode || '', cost: p.cost || 0, price: askedPrice(p) ? null : p.price, stock: p.stock || 0,
      madeFrom: (p.madeFrom || []).map(m => ({ ...m })) });
    if (p.madeFrom?.length) it.made = true;
  });
  return [...byKey.values()];
}
const itemCategories = () => state.folders.filter(f => f.id !== 'all').map(f => f.name);
// ponytail: read straight off the back office's list each time; the POS keeps no copy of its own.
const posSuppliers = () => readJsonStorage(STORAGE_SUPPLIERS, []) || [];

function renderItems() {
  const rows = $('#itemsRows');
  if (!rows) return;
  fillItemsPane(itemsKind, $('#itemsBand'), rows);
  addPickMarkRows();   // Add tile's ticks (pos-sell.js)
  if (itemsKind !== 'items') return;
  $('#itemsFilter')?.classList.toggle('on', Object.keys(ITEMS_FILTER_DEF).some(k => itemsFilter[k] !== ITEMS_FILTER_DEF[k]));
  qsMarkRows(); if ($('#qs') && !$('#qs').contains(document.activeElement)) qsRender(); else qsTickbar();   // quick stock (pos-stock.js): the dots, the phone's Review bar
}

// One kind's list into a band + rows: the live list, or the swipe's peek at the tab beside it (app.js).
function fillItemsPane(kind, band, rows) {
  if (kind !== 'items') return renderKindRows(kind, band, rows);
  band.classList.remove('k2');
  const q = itemsFilter.q.trim().toLowerCase();
  const list = catalogItems().filter(it => {
    if (addPick) { if (!it.members.some(onTill)) return false; }   // Add tile: what Sell can show, no filter (its button is hidden)
    else if (itemsFilter.cat && !itemsFilter.cat.some(c => it.cats.includes(c))) return false;   // '' = any, else the picks (openFilterSheet)
    if (!addPick && itemsFilter.stock && !itemsFilter.stock.some(s => itemStk(it) === 'stk-' + s)) return false;
    return !q || it.name.toLowerCase().includes(q) || it.variants.some(v => [v.name, v.sku, ...v.alts, v.barcode].some(x => x.toLowerCase().includes(q)));
  }).sort((a, b) => a.name.localeCompare(b.name));
  band.innerHTML = `<span>Item <span class="num">· ${list.length}</span></span><span>Category</span><span>Price</span><span>In stock</span>`;
  rows.innerHTML = list.map(it => {
    const vn = it.variants.length, vs = vn > 1 ? `${vn} variants` : '', oh = itemOnHand(it);
    // phone (G2, owner 2026-10-16): stock · variants under the name, the price or a short range always right
    const ps = it.variants.filter(v => !askedPrice(v)).map(v => v.price), lo = Math.min(...ps), hi = Math.max(...ps);
    const cut = x => peso(x).replace(/\.00$/, '');   // ponytail: a range drops whole-peso .00 to stay short
    const rng = !ps.length ? '—' : lo === hi ? peso(lo) : `${cut(lo)}-${cut(hi)}`;
    const stk = !oh || addPick ? '' : itemStk(it) === 'stk-out' ? '<span class="stk-out">Out of stock</span>' : `<span class="${itemStk(it)}">${it.made ? `Can make ${oh}` : `${oh} in stock`}</span>`;
    const tl = addPickOn(it.id) ? 'Already a tile' : '', v0 = [vs, tl].filter(Boolean).join(' · ');   // Add tile (pos-sell.js)
    const line = [stk, vs, tl, it.component ? partWord() : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="row cols" data-id="${escapeHtml(it.id)}">
      <span class="nm">${itemThumb(it)}<span class="tx"><b>${escapeHtml(it.name)}</b>${v0 ? `<small class="v0">${v0}</small>` : ''}${line ? `<small class="sub">${line}</small>` : ''}</span><span class="rt">${rng}</span></span>
      <span class="cat">${escapeHtml(it.cat)}</span>
      <span class="pr num">${itemPriceText(it)}</span>
      <span class="num ${itemStk(it)}">${itemOnHand(it) || '—'}</span></button>`;
  }).join('') || '<div class="empty"><b>No items</b><span>Nothing matches this search or filter.</span></div>';
}

// The editor: a working copy E of the item. Only Save (and the photo / colour) write to the catalog.
// Apple Settings (owner 2026-10-08): blocks of rows, each word at the side of its field like the customer form; a long
// list (categories, modifiers, suppliers, one variant) is a row with its value and ›, opening its own page.
let itemEdit = null, itemIsNew = false, itemSub = '', itemMainScroll = 0;   // itemSub: '' = the item, else 'cats' | 'mods' | 'sups' | a variant's id
const blankVariant = () => ({ id: newId(), name: '', sku: '', alts: [], barcode: '', cost: 0, price: null, stock: 0, madeFrom: [], fresh: true });
// Sold per: bo-products UNITS, its soldByFor. A measured unit sells in decimals; a unit typed elsewhere keeps what it was.
const ITEM_UNITS = [['pc', 'box', 'bag', 'set', 'pair', 'roll', 'sheet', 'can'], ['m', 'ft', 'kg', 'L', 'gal']];
const soldByFor = (unit, was) => (ITEM_UNITS[1].includes(unit) ? 'measure' : ITEM_UNITS[0].includes(unit) ? 'each' : was || 'each');

function openItemEditor(id) {
  if (editorDirty()) return askLeave(true, () => { closeItemEditor(); openItemEditor(id); });   // another row on a tablet
  const it = id ? catalogItems().find(x => x.id === id) : null;
  itemIsNew = !it; kindEdit = null; itemSub = '';
  itemEdit = it || { id: newId(), name: '', desc: '', cat: '', catIds: [], unit: 'pc', soldBy: 'each', img: '', color: '', hidden: false, marginMode: 'percent',
    reorder: 0, track: true, sellOut: false, sups: [], main: '', mods: [], hideCh: [], weight: '', size: '', length: '', component: false, variants: [blankVariant()], since: tillDay(Date.now()) };
  const v0 = itemEdit.variants[0];
  itemEdit.marginValue = itemMarkupOf(v0, itemEdit.marginMode);
  renderItemForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
  editorFirst = editorSnap();
}
const closeItemEditor = () => $('#itemsView').classList.remove('editing');
// What the open editor's Save would write, as text: leaving with it changed asks first (askLeave, owner 2026-10-22).
// A saved item's photo + colour save on the spot, so they're left out; a new item's wait for Save, so they count.
let editorFirst = '';
const editorSnap = () => (kindEdit ? JSON.stringify({ ...kindEdit, sub: 0, first: 0, af: 0, picked: [...kindEdit.picked].sort() })
  : JSON.stringify({ ...itemEdit, hue: 0, ...(itemIsNew ? {} : { img: 0, color: 0 }) }));
const editorDirty = () => $('#itemsView').classList.contains('editing') && editorSnap() !== editorFirst;
// a subpage slides in over the item or the category; '' slides back to where the page was scrolled
function itemGo(sub, back) {
  const f = $('#itemForm'), K = kindEdit;
  if (sub && !(K ? K.sub : itemSub)) itemMainScroll = f.scrollTop;   // the page's place, not a subpage's (variant -> Made from)
  if (!K && itemSub.startsWith('alts:')) { const v = altsOf(); v.alts = v.alts.filter(s => s.trim()); }   // a box left empty goes
  const nv = !K && !sub && itemEdit.variants.find(x => x.id === itemSub);   // back from Add variant with nothing typed: it goes, as a blank choice does (kindBack)
  if (nv && itemEdit.variants.length > 1 && blankV(nv)) itemEdit.variants.splice(itemEdit.variants.indexOf(nv), 1);
  if (K) K.sub = sub; else itemSub = sub;
  (K ? renderKindForm : renderItemForm)(sub && !back ? 'push' : 'pop');
  f.scrollTop = sub ? 0 : itemMainScroll;
}
// Back from a subpage (app.js #itemBack): a variant's Made from to the variant, a modifier's choices to Modifiers, else the item
const itemParent = s => (/^(made|alts):/.test(s) && itemEdit.variants.length > 1 ? s.slice(5) : s.startsWith('modch:') ? 'mods' : '');
const blankV = v => JSON.stringify({ ...v, id: 0 }) === JSON.stringify({ ...blankVariant(), id: 0 });   // a new variant nothing was typed in
// a variant needs a name (owner 2026-10-29): one left with something typed but no name asks before Back; a tap outside stays
function itemBackSub() {
  const E = itemEdit, v = E.variants.find(x => x.id === itemSub);
  if (!v || E.variants.length < 2 || v.name.trim() || blankV(v)) return itemGo(itemParent(itemSub), true);
  showConfirm({ title: 'Give the variant a name', message: 'Every variant needs one.', okText: 'Remove variant', cancelText: 'Add a name',
    onConfirm: () => { E.variants.splice(E.variants.indexOf(v), 1); itemGo('', true); },
    onCancel: () => $('#itemForm [data-v=name]')?.focus() });
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
// a blank Price is asked at sale (askedPrice) and no cost has no markup: nothing to hold, so a cost typed later
// leaves the price alone. Kept exact (shown to 2 places): a rounded one walked the price off a centavo.
const itemMarkupOf = (v, mode) => (askedPrice(v) || !Number(v.cost) ? null : marginFromPrice(v.cost, v.price, mode, true));
const markupText = m => (m ? round2(m) : '');
const imarginNote = v => { if (askedPrice(v)) return '—'; const m = itemMargin(v); return `${peso(m.profit)} · ${itemPct(m.margin)} margin`; };
const iprofit = v => `Profit <span class="num" id="itemMarginNote">${imarginNote(v)}</span>`;   // the Price block's footnote
const istep = () => (itemEdit.soldBy === 'measure' ? .01 : 1);
const iqty = (attr, v) => `<input class="in num" ${attr} value="${v || ''}" type="number" step="${istep()}" min="0" inputmode="decimal" placeholder="0">`;
const ionHand = v => `<span class="vv num${v.stock <= 0 ? ' stk-out' : ''}">${itemQty(v.stock)} ${escapeHtml(itemEdit.unit)}</span><button type="button" class="link cta-3" data-act="stock">Adjust</button>`;
const ilist = a => (a.length ? escapeHtml(a.length > 2 ? `${a[0]}, ${a[1]} +${a.length - 2}` : a.join(', ')) : 'None');
const supName = id => (posSuppliers().find(s => s.id === id) || {}).name || '';
const icurrency = () => SalesMath.currencySymbol(state.settings.store?.currency);

function renderItemForm(dir) {
  const E = itemEdit, v = E.variants.find(x => x.id === itemSub);
  const [title, html] = itemSub === 'cats' ? ['Categories', itemTickPage('catIds', kindCats().map(c => [c.id, c.name]), 'No categories yet. Add them under Categories.')]
    : itemSub === 'mods' ? ['Modifiers', itemModsPage()]
    : itemSub.startsWith('modch:') ? itemChoicePage(itemSub.slice(6))
    : itemSub === 'sups' ? ['Suppliers', itemSupsPage()]
    : itemSub === 'specs' ? ['Specs', itemSpecsPage()]
    : itemSub === 'look' ? ['Tile appearance', lookPage(E)]
    : itemSub.startsWith('made:') ? ['Made from', itemMadePage(E.variants.find(x => 'made:' + x.id === itemSub))]
    : itemSub.startsWith('alts:') ? ['SKU', itemSkuPage(altsOf())]
    : v ? [v.fresh ? 'Add variant' : 'Edit variant', itemVariantPage(v)] : [E.name || 'New item', itemMainPage()];   // a fixed title: typing a variant's name doesn't echo up there
  $('#itemForm').closest('.editor').classList.toggle('sub', !!itemSub && itemSub !== 'mods' && !itemSub.startsWith('modch:'));   // a subpage has only Back, as in Apple Settings; Modifiers keeps Save (owner 2026-10-24)
  $('#itemForm').innerHTML = `<div class="form${dir ? ' ' + dir : ''}">${html}</div>`;
  $('#itemTitle').textContent = title;   // small, in the top bar beside Back (rednote's Edit profile)
  // a long tick list (Made from, Categories, Modifiers): search in the bar where the title was; the title fades back in on scroll
  const find = $('#itemFind');
  find.hidden = !itemSub || $$('#itemForm .pick[data-find]').length <= 8;
  $('#itemFindQ').value = ''; find.classList.remove('typed');
}

// rednote's Edit profile (owner 2026-10-09): the photo centred on top, white blocks on the grey page, the word in a
// column on the left and its value just after it (not pushed right); Status worded as the back office's; the
// description its own block under Name and Status (rednote's Bio), growing as it is typed.
function itemMainPage() {
  const E = itemEdit, fam = E.variants.length > 1, v0 = E.variants[0], T = E.track;
  // A component / an ingredient (owner 2026-10-20): only what making things needs -- name, cost, stock, low stock at, unit.
  // Never on Sell, always counted. A made item (v0.madeFrom) can't be one, nor can a family: parts don't nest.
  const made = !fam && v0.madeFrom.length > 0;
  if (E.component) return itemPartPage();
  // the photo stays on top as the tile's preview; it and Edit open the Tile appearance page (owner 2026-10-22, iPhone Contacts)
  const photo = lookHead(E);
  const about = icard('', [
    ifr('Name', iinp('name', E.name, 'placeholder="Add name"')),
    ifr('Status', ipick('status', E.hidden ? 'Hidden' : 'Active'), true),
    fam || made ? '' : isw(partWord(), 'component', false),
  ].join(''), fam || made ? '' : IPART_NOTE, ' r');
  // the word on top, the text under it across the tile (iOS Notes' block, owner 2026-10-22)
  const desc = icard('', `<label class="fr stk"><span class="lb">Description</span><textarea class="in" data-f="desc" rows="2" placeholder="Add description">${escapeHtml(E.desc)}</textarea></label>`);
  const vrow = v => `<button type="button" class="fr nav wide" data-sub="${escapeHtml(v.id)}"><span class="lb${v.name ? '' : ' ph'}">${escapeHtml(v.name || 'No name')}</span>
    <span class="ctl end"><span class="vv num">${askedPrice(v) ? '—' : peso(v.price)}${T ? ` · ${itemQty(v.stock)} ${escapeHtml(E.unit)}` : ''}</span>${ICHEV}</span></button>`;
  // small blocks, one job each (rednote's Account security): one item = [Price, Cost, Markup, profit under it] [Add variant];
  // a family = its variants and Add variant on one block, each variant's numbers on its own page
  const price = fam ? icard('', E.variants.map(vrow).join('') + iadd('add-variant', 'Add variant'))
    : icard('', [
      ifr('Price', `<input class="in num" data-f="price" value="${v0.price ?? ''}" ${IMONEY} placeholder="Asked at sale">`),
      made ? ifr('Cost', `<span class="vv num">${peso(v0.cost)}</span>`, true) : ifr('Cost', `<input class="in num" data-f="cost" value="${v0.cost || ''}" ${IMONEY} placeholder="0.00">`),
      ifr('Markup', `<input class="in num" data-f="marginValue" value="${markupText(E.marginValue)}" type="number" step="0.01" inputmode="decimal" placeholder="0">${ipick('mmode', E.marginMode === 'percent' ? '%' : icurrency())}`),
    ].join(''), iprofit(v0), ' r')
    + icard('', iadd('add-variant', 'Add variant'));
  // stock out on the page, not behind a › (owner 2026-10-09); a family counts per variant, on each variant's page
  const stock = made ? icard('', [imadeRow(v0), ifr('Can make', icanMake(v0), true), isw('Sell when out of stock', 'sellOut', E.sellOut)].join(''), IMADE_NOTE, ' r')
    : icard('', [
    fam || itemUsed(v0.id) ? '' : imadeRow(v0),
    isw('Track stock', 'track', T),
    !T || fam ? '' : itemIsNew ? ifr('Opening stock', iqty('data-f="stock"', v0.stock)) : ifr('In stock', ionHand(v0), true),
    T ? ifr('Low stock at', iqty('data-f="reorder"', E.reorder)) : '',
    T && !fam && itemIsNew ? ifr('In store since', `<input class="in" type="date" data-f="since" value="${E.since}">`) : '',
    T ? isw('Sell when out of stock', 'sellOut', E.sellOut) : '',
  ].join(''), T ? '' : 'Not counted: never low, never out.', ' r');
  const codes = icard('', [   // how it's sold and scanned; a family's SKU and barcode are per variant
    ifr('Sold per', ipick('unit', escapeHtml(E.unit)), true),
    fam ? '' : iskuRow(v0),
    fam ? '' : ifr('Barcode', iinp('barcode', v0.barcode, 'inputmode="numeric" placeholder="Add barcode"')),
  ].join(''), '', ' r');
  const by = modsById();
  const more = icard('', [
    inav('Categories', ilist(E.catIds.map(folderName).filter(Boolean)), 'cats'),
    inav('Modifiers', ilist(E.mods.filter(id => by.has(id)).map(id => by.get(id).name)), 'mods'),   // names only (owner 2026-10-25: the older row, not "4 of 5")
    inav('Suppliers', ilist([E.main, ...E.sups.filter(id => id !== E.main)].filter(Boolean).map(supName).filter(Boolean)), 'sups'),
    inav('Specs', escapeHtml([E.weight, E.size, E.length].filter(Boolean).join(' · ')) || 'None', 'specs'),
  ].join(''), '', ' r');
  const archive = itemIsNew ? '' : icard('', iadd('archive', 'Archive item', ' red'));   // the ⋯ menu's last action, now the last block
  return photo + about + desc + price + stock + codes + more + archive;
}
// the component's short page: Name + the switch, Cost, its stock, Unit
function itemPartPage() {
  const E = itemEdit, v0 = E.variants[0];
  // Status shows but can't change (owner 2026-10-22): a part is never on Sell
  return icard('', [ifr('Name', iinp('name', E.name, 'placeholder="Add name"')), ifr('Status', '<span class="vv ph">Hidden</span>', true), isw(partWord(), 'component', true)].join(''), IPART_NOTE, ' r')
    + icard('', ifr('Cost', `<input class="in num" data-f="cost" value="${v0.cost || ''}" ${IMONEY} placeholder="0.00">`), '', ' r')
    + icard('', [
      itemIsNew ? ifr('Opening stock', iqty('data-f="stock"', v0.stock)) : ifr('In stock', ionHand(v0), true),
      ifr('Low stock at', iqty('data-f="reorder"', E.reorder)),
      itemIsNew ? ifr('In store since', `<input class="in" type="date" data-f="since" value="${E.since}">`) : '',
      ifr('Unit', ipick('unit', escapeHtml(E.unit)), true),
    ].join(''), '', ' r')
    + (itemIsNew ? '' : icard('', iadd('archive', 'Archive item', ' red')));
}
const IPART_NOTE = 'Used to make other items. Not sold on its own.';
const IMADE_NOTE = 'Selling it takes these off stock.';
// Made from: what 1 sold takes off stock. Parts are live products that aren't made themselves and aren't this item.
const itemUsed = id => state.products.some(p => !p.archived && p.madeFrom?.some(m => m.id === id));   // a part can't be made: no nesting
const iprods = () => new Map(state.products.map(p => [p.id, p]));
const imadeRow = (v, by = iprods()) => inav('Made from', ilist(v.madeFrom.map(m => by.get(m.id)?.name).filter(Boolean)), 'made:' + v.id);
const icanMake = v => { const { n } = madeOf(v.madeFrom, iprods()); return `<span class="vv num${n === 0 ? ' stk-out' : ''}">${n == null ? '—' : itemQty(n)}</span>`; };
function itemMadePage(v) {
  const E = itemEdit, own = new Set(E.variants.map(x => x.id)), on = new Map(v.madeFrom.map(m => [m.id, m.qty]));
  const all = state.products.filter(p => !p.archived && !own.has(p.id) && !p.madeFrom?.length).sort((a, b) => a.name.localeCompare(b.name));
  const row = p => `<label class="pick" data-find="${escapeHtml(p.name.toLowerCase())}"><input type="checkbox" data-made="${escapeHtml(p.id)}"${on.has(p.id) ? ' checked' : ''}>
      <span class="tx">${escapeHtml(p.name)}<small>${p.trackStock === false ? 'Not counted' : `${itemQty(p.stock)} ${escapeHtml(p.unit || 'pc')} in stock`}</small></span>
      <span class="mq"${on.has(p.id) ? '' : ' hidden'}><input class="in num" data-mq="${escapeHtml(p.id)}" value="${on.get(p.id) ?? 1}" type="number" step="${stepFor(p)}" min="0" inputmode="decimal" aria-label="Amount per 1 sold">${escapeHtml(p.unit || 'pc')}</span></label>`;
  const parts = all.filter(p => p.component), rest = all.filter(p => !p.component);
  return (parts.length ? icard(partWord() + 's', parts.map(row).join('')) : '')
    + icard(parts.length ? 'Other items' : '', rest.map(row).join('') || '<div class="pick">No other items yet.</div>', 'Amount per 1 sold. ' + IMADE_NOTE);
}
// a Made from tick or amount onto the variant; its cost follows the parts, the price stays and the markup follows it
function itemMadeSet(t) {
  const E = itemEdit, v = E.variants.find(x => 'made:' + x.id === itemSub), id = t.dataset.made || t.dataset.mq;
  if (t.dataset.made) {
    v.madeFrom = t.checked ? [...v.madeFrom, { id, qty: 1 }] : v.madeFrom.filter(m => m.id !== id);
    const mq = t.closest('.pick').querySelector('.mq'), box = mq.querySelector('input');
    mq.hidden = !t.checked; box.value = 1;
    if (t.checked) box.select();
  } else { const m = v.madeFrom.find(x => x.id === id); if (m) m.qty = Number(t.value) || 0; }
  if (v.madeFrom.length) v.cost = madeOf(v.madeFrom, iprods()).cost;
  if (v === E.variants[0]) E.marginValue = itemMarkupOf(v, E.marginMode);
}
// SKU (owner 2026-10-26): one row, "PVC-ELB-12 +4", opening a page with the main SKU on top and the others under it --
// a supplier's name for the item, a nickname. Search and scans match any; receipts show the main one. The others are
// the product's aliases (bo-model skusOf).
const altsOf = () => itemEdit.variants.find(x => 'alts:' + x.id === itemSub);
const iskuRow = v => { const a = skusOf({ sku: v.sku, aliases: v.alts }); return inav('SKU', a.length ? escapeHtml(a[0]) + (a.length > 1 ? ` +${a.length - 1}` : '') : 'None', 'alts:' + v.id); };
const itemSkuPage = v => icard('', ifr('Main', `<input class="in" data-alt="main" value="${escapeHtml(v.sku)}" placeholder="Add SKU" aria-label="Main SKU">`), 'Receipts show this one.', ' r')
  + icard('Other SKUs', v.alts.map((s, i) => `<div class="fr wide"><input class="in" data-alt="${i}" value="${escapeHtml(s)}" placeholder="Add SKU" aria-label="Other SKU"></div>`).join('')
  + iadd('add-alt', 'Add SKU'), "A supplier's name for it, a nickname. Search and scans find the item by these too.");
function itemSpecsPage() {
  const E = itemEdit;
  return icard('', [
    ifr('Weight', iinp('weight', E.weight, 'placeholder="Add weight"')),
    ifr('Size', iinp('size', E.size, 'placeholder="Add size"')),
    ifr('Length', iinp('length', E.length, 'placeholder="Add length"')),
  ].join(''));
}

// a subpage's ticks: search up in the bar (a store runs to 50-100 categories), the list on one tile
function itemTickPage(key, rows, empty) {
  const on = itemEdit[key];
  return icard('', rows.map(([id, name, sub]) => `<label class="pick" data-find="${escapeHtml(name.toLowerCase())}"><input type="checkbox" data-tick="${key}" value="${escapeHtml(id)}"${on.includes(id) ? ' checked' : ''}>
      <span class="tx">${escapeHtml(name)}${sub ? `<small>${sub}</small>` : ''}</span></label>`).join('') || `<div class="pick">${empty}</div>`);
}
function itemSupsPage() {
  const E = itemEdit, rows = posSuppliers().filter(s => !s.archived && s.name).sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.id, s.name]);
  return icard('', ifr('Main supplier', ipick('main', escapeHtml(supName(E.main) || 'None')), true), 'Purchase orders go to the main supplier.')
    + itemTickPage('sups', rows, 'No suppliers yet. Add them in the back office.');
}

// ---------- An item's modifiers (plans/modifiers-build.md): which it asks, in what order, which choices it offers ----------
// The link lives on the item's products: modifierIds in asking order, hiddenChoiceIds = choices this item never offers.
// A choice added later shows on every item until hidden; nothing starts picked at the sale (bo-model itemModifiers).
const modsById = () => new Map(kindList('mods').map(m => [m.id, m]));
// a modifier's choices on one line, as modifiers-lab.html draws it: "Fresh milk, Oat +₱30.00"
const choiceList = (m, name = escapeHtml) => liveChoices(m).map(o => [name(o.name), modPrice(o.price)].filter(Boolean).join(' ')).join(', ');
const choicesText = (m, hidden) => {
  const all = liveChoices(m), n = all.filter(o => !hidden.includes(o.id)).length;
  return n < all.length ? `${n} of ${all.length} choices` : all.length === 1 ? '1 choice' : `All ${all.length} choices`;
};
// what Save writes: the hidden choices of the modifiers the item still asks, still live
const itemHidden = (E, by = modsById()) => {
  const ok = new Set(E.mods.flatMap(id => (by.has(id) ? liveChoices(by.get(id)).map(o => o.id) : [])));
  return E.hideCh.filter(id => ok.has(id));
};
const IGRIP = '<span class="grip" aria-hidden="true"><svg class="ic" viewBox="0 0 24 24"><path d="M5 8h14M5 12h14M5 16h14"/></svg></span>';
const modFind = m => escapeHtml([m.name, ...liveChoices(m).map(o => o.name)].join(' ').toLowerCase());
// the ones it asks on top, in order (≡ drags them); a tap on the name picks which choices it offers
function itemModsPage() {
  const E = itemEdit, by = modsById(), on = E.mods.filter(id => by.has(id)).map(id => by.get(id));
  const rest = [...by.values()].filter(m => !E.mods.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name));
  const tick = (m, c) => `<input type="checkbox" data-tick="mods" value="${escapeHtml(m.id)}"${c ? ' checked' : ''} aria-label="${escapeHtml(m.name)}">`;
  const sel = on.map(m => `<div class="pick mod-on" data-mod="${escapeHtml(m.id)}" data-find="${modFind(m)}">
      <button type="button" class="tx" data-sub="modch:${escapeHtml(m.id)}">${escapeHtml(m.name)}<small>${choicesText(m, E.hideCh)}</small></button>${tick(m, true)}${IGRIP}</div>`).join('');
  const off = rest.map(m => `<label class="pick" data-find="${modFind(m)}">${tick(m)}<span class="tx">${escapeHtml(m.name)}<small>${choiceList(m)}</small></span></label>`).join('');
  if (!sel && !off) return icard('', '<div class="pick">No modifiers yet. Add them on the Modifiers tab.</div>');
  return icard('', sel + off, sel ? 'Tap a name to choose which of its choices this item offers. Drag ≡ to change the order.' : '');
}
// one modifier on this item: a switch per choice; the last one on stays on (a question with no answer can't be asked)
function itemChoicePage(mid) {
  const E = itemEdit, m = modsById().get(mid);
  if (!m) return ['Modifiers', itemModsPage()];
  const all = liveChoices(m), left = all.filter(o => !E.hideCh.includes(o.id)).length;
  const rows = all.map(o => {
    const on = !E.hideCh.includes(o.id), sub = [o.price ? `+${peso(o.price)}` : '', o.unavailable ? 'Unavailable' : ''].filter(Boolean).join(' · ');
    return `<label class="fr"><span class="lb">${escapeHtml(o.name)}${sub ? `<small>${sub}</small>` : ''}</span><span class="ctl end"><input type="checkbox" class="sw" data-ch="${escapeHtml(o.id)}"${on ? ' checked' : ''}${on && left === 1 ? ' disabled' : ''}></span></label>`;
  }).join('');
  return [m.name, icard(`On ${escapeHtml(E.name.trim() || 'this item')}`, rows, `Off = this item never offers it. Other items still do. To rename or add choices, open ${escapeHtml(m.name)} on the Modifiers tab.`)];
}
function itemChoiceSet(t) {
  const E = itemEdit, id = t.dataset.ch;
  E.hideCh = t.checked ? E.hideCh.filter(x => x !== id) : [...E.hideCh, id].sort();
  renderItemForm();
}
// a modifier ticked off takes its hidden choices with it; the list re-sorts (picked on top) unless a search is typed
function itemModTick(t) {
  const E = itemEdit, m = modsById().get(t.value);
  if (!t.checked && m) { const ids = new Set(m.options.map(o => o.id)); E.hideCh = E.hideCh.filter(x => !ids.has(x)); }
  if ($('#itemFindQ').value.trim()) return;
  const f = $('#itemForm'), y = f.scrollTop;
  renderItemForm(); f.scrollTop = y;
}
// ≡ drag: the row rides the finger, the others step aside; let go and the asking order is the new one
function modGrip(e) {
  const g = e.target.closest('#itemForm .pick.mod-on .grip');
  if (!g || e.button) return;
  const row = g.closest('.pick'), rows = [...row.parentElement.querySelectorAll('.pick.mod-on:not([hidden])')], i0 = rows.indexOf(row);
  const h = row.offsetHeight, y0 = e.clientY;
  let to = i0;
  e.preventDefault(); g.setPointerCapture(e.pointerId); row.classList.add('dragging');
  const move = (ev) => {
    const dy = Math.min(Math.max(ev.clientY - y0, -i0 * h), (rows.length - 1 - i0) * h);
    to = Math.round(i0 + dy / h);
    row.style.transform = `translateY(${dy}px)`;
    rows.forEach((r, i) => { if (r !== row) r.style.transform = i > i0 && i <= to ? `translateY(${-h}px)` : i < i0 && i >= to ? `translateY(${h}px)` : ''; });
  };
  const end = (ev) => {
    ['pointermove', 'pointerup', 'pointercancel'].forEach((k, i) => g.removeEventListener(k, i ? end : move));
    if (ev.type === 'pointercancel') to = i0;
    const ids = rows.map(r => r.dataset.mod), was = new Set(ids), E = itemEdit;
    ids.splice(to, 0, ...ids.splice(i0, 1));
    let k = 0;
    E.mods = E.mods.map(id => (was.has(id) ? ids[k++] : id));   // the shown rows swap places; the rest keep theirs
    renderItemForm();
  };
  g.addEventListener('pointermove', move); g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
}
function itemVariantPage(v) {
  const E = itemEdit, made = v.madeFrom.length > 0;
  const vin = (k, attrs = '') => `<input class="in" data-v="${k}" value="${escapeHtml(v[k])}" ${attrs}>`;
  return icard('', ifr('Name', vin('name', 'placeholder="Add name, like Red or 2 inch"')), '', ' r')
    + icard('', ifr('Price', `<input class="in num" data-v="price" value="${v.price ?? ''}" ${IMONEY} placeholder="Asked at sale">`)
      + (made ? ifr('Cost', `<span class="vv num">${peso(v.cost)}</span>`, true) : ifr('Cost', `<input class="in num" data-v="cost" value="${v.cost || ''}" ${IMONEY} placeholder="0.00">`)), iprofit(v), ' r')
    + (itemUsed(v.id) ? '' : icard('', imadeRow(v) + (made ? ifr('Can make', icanMake(v), true) : ''), made ? IMADE_NOTE : '', ' r'))
    + icard('', [
      !E.track || made ? '' : v.fresh ? ifr('Opening stock', iqty('data-v="stock"', v.stock)) : ifr('In stock', ionHand(v), true),
      iskuRow(v),
      ifr('Barcode', vin('barcode', 'inputmode="numeric" placeholder="Add barcode"')),
    ].join(''), '', ' r')
    + (E.variants.length > 1 ? icard('', iadd('del-variant', 'Remove variant', ' red')) : '');
}

// the dropdowns, the ⋯ menu's morph as in Settings. On the phone Markup is the cart ⋯'s half sheet (as app.js
// #cartMoreBtn); Sold per is that sheet at the Filters sheet's height, so its long list scrolls (owner 2026-10-29)
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
  if (act === 'unit') openActionSheet(b, E.component ? 'Unit' : 'Sold per', items, '');
  else if (act === 'mmode' && matchMedia('(max-width: 720px)').matches) openActionSheet(b, 'Markup', items);
  else if (items) openMenu(b, items, { w: 200, right: true });
}

// cost / margin / price: any two drive the third (the back office's three-way binding)
function itemReprice(from) {
  const E = itemEdit, v0 = E.variants[0], f = $('#itemForm');
  if (!f.querySelector('[data-f=price]')) return;   // a component's page: Cost only, no price to follow
  if (from === 'price') {
    E.marginValue = itemMarkupOf(v0, E.marginMode);
    f.querySelector('[data-f=marginValue]').value = markupText(E.marginValue);
  } else if (E.marginValue != null && Number(v0.cost)) {   // no markup, or no cost for it to sit on: the price stays (blank = asked at sale)
    v0.price = priceFromMargin(v0.cost, E.marginMode, E.marginValue);   // bo-model's, as the back office editor
    f.querySelector('[data-f=price]').value = v0.price;
  }
  $('#itemMarginNote').innerHTML = imarginNote(v0);
}
// a tick list's search: hides the rows in place, so the box keeps its focus
const IFIND = '<div class="pick-find"><input class="in" data-k="q" type="search" placeholder="Search" autocomplete="off"></div>';
const filterPicks = q => { q = q.trim().toLowerCase(); $$('#itemForm .pick[data-find]').forEach(r => { r.hidden = !!q && !r.dataset.find.includes(q); }); };

// The tile's colour (owner 2026-10-14): the sell tile wears it when there is no photo; the first, empty swatch = the plain tile.
// A photo covers it, so with one the swatches are greyed and can't be tapped (owner 2026-10-22).
const tileSwatches = E => `<div class="tcolors" role="group" aria-label="Tile colour">${['', ...Object.keys(TILE_COLORS)].map(k =>
  `<button type="button" class="tc${k ? '' : ' none'}${(E.color || '') === k ? ' on' : ''}" data-look="color" data-c="${k}"${k ? ` style="--tc:${TILE_COLORS[k]}"` : ''}
    aria-label="${k || 'No colour'}" aria-pressed="${(E.color || '') === k}"${E.img ? ' disabled' : ''}></button>`).join('')}</div>`;
// The photo on top of the item's editor and the category's, the tile's preview: one button, it and Edit open Tile appearance
// (owner 2026-10-22, iPhone Contacts). Its taps are lookClick's, the same for both editors.
const lookHead = E => `<div class="fphoto"><button type="button" class="fph" data-look="open">${itemThumb(E, true)}<span class="link">Edit</span></button></div>`;
// Tile appearance: the preview (a tap picks a photo too; the row is the one Tab reaches), the photo's rows, then the colours
const lookPage = E => {
  const word = E.img ? 'Change photo' : 'Add photo';
  return `<div class="fphoto"><button type="button" class="fph" data-look="pick" tabindex="-1" aria-label="${word}">${itemThumb(E, true)}</button><input type="file" accept="image/*" id="lookImg" hidden></div>`
    + icard('', `<button type="button" class="fr add" data-look="pick">${word}</button>${E.img ? '<button type="button" class="fr add red" data-look="clear">Remove photo</button>' : ''}`)
    + icard('Colour', `<div class="fr">${tileSwatches(E)}</div>`, E.img ? 'Remove the photo to pick a colour.' : 'Shows on Sell when there is no photo.');
};
// An item's look saves on the spot (setItemLook); a category's waits for its Save
const setLook = p => (kindEdit ? (Object.assign(kindEdit, p), renderKindForm()) : setItemLook(p));
function lookClick(b) {
  const L = b.dataset.look;
  if (L === 'open') itemGo('look');
  else if (L === 'pick') $('#lookImg').click();
  else if (L === 'clear') setLook({ img: '' });
  else setLook({ color: b.dataset.c });
}
// a photo still shrinking lands only while its editor is still on Tile appearance: not another item's, not a page it'd redraw
function lookPhoto(file) {
  const o = kindEdit || itemEdit, here = () => (kindEdit || itemEdit) === o && (kindEdit ? kindEdit.sub : itemSub) === 'look';
  shrinkPhoto(file).then(img => here() && setLook({ img }), () => showToast('That file isn’t a photo'));
}
// A category's thumb: its photo, else its colour, else plain (as its Sell tile)
const catLook = x => ({ name: x.name, color: x.color, img: x.img ?? x.imageUrl ?? '', hue: TILE_COLORS[x.color] });
// The photo and the tile colour save on the spot (owner 2026-10-14), onto the family's group or the lone product, so the
// tiles, the cart and every POS show them; the rest of the editor's Save is still design only. A new item keeps them
// with the form until its Save works.
function setItemLook(patch) {
  const E = itemEdit, row = { updatedAt: new Date().toISOString() };
  if ('img' in patch) row.imageUrl = E.img = patch.img;
  if ('color' in patch) row.color = E.color = patch.color;
  if (catalogItems().some(it => it.id === E.id)) {
    const put = rows => rows.map(r => (r.id === E.id ? { ...r, ...row } : r));
    // a family's members get it too: a cart line reads a member's own photo first (itemLook), an old one would stay
    if (groupById(E.id)) { state.groups = put(state.groups); saveGroups(); state.products = state.products.map(p => (p.groupId === E.id ? { ...p, ...row } : p)); }
    else state.products = put(state.products);
    saveProducts();
    renderItems(); renderProducts(); renderCart();
  }
  E.hue = TILE_COLORS[E.color];
  renderItemForm();
}
function saveItem() {
  const E = itemEdit;
  if (!E.name.trim()) { if (itemSub) itemGo(''); showToast('Give the item a name'); $('#itemForm').querySelector('[data-f=name]').focus(); return; }
  if (E.variants.length > 1 && E.variants.some(v => !v.name.trim())) { showToast('Name every variant'); return; }
  // Item Save writes the catalog (owner's go for components, 2026-10-20): each variant is a product row, a family adds a
  // group; a dropped variant is archived, never deleted; a new one's Opening stock is an 'opening' movement.
  const name = E.name.trim(), fam = E.variants.length > 1, C = E.component && !fam;
  // one SKU, one item (owner 2026-10-26): a scan or a receipt line has to land on exactly one
  const mine = new Set(E.variants.map(v => v.id)), taken = new Map();
  state.products.forEach(p => { if (!p.archived && !mine.has(p.id)) skusOf(p).forEach(s => taken.set(s.toLowerCase(), [p.id, p.name])); });
  for (const v of E.variants) for (const s of skusOf({ sku: v.sku, aliases: v.alts })) {
    const [id, who] = taken.get(s.toLowerCase()) || [];
    if (id && id !== v.id) { showToast(`${who} already has the SKU ${s}`); return; }
    taken.set(s.toLowerCase(), [v.id, fam ? v.name.trim() : name]);
  }
  const was = new Map(state.products.map(p => [p.id, p])), old = catalogItems().find(it => it.id === E.id);
  const gid = fam ? (groupById(E.id) ? E.id : old?.members[0]?.groupId || newId()) : '';
  const who = currentStoreInfo().cashier, staffId = state.user?.id || '', moves = [];
  const rows = E.variants.map(v => {
    const base = was.get(v.id) || {}, made = C ? [] : v.madeFrom.filter(m => was.has(m.id) && Number(m.qty) > 0)   // a 0 amount drops the part
      .map(m => ({ id: m.id, qty: Math.max(stepFor(was.get(m.id)), roundQty(was.get(m.id), m.qty)) }));
    const row = stampRow(normalizeProduct({ ...base, id: v.id, name: fam ? v.name.trim() : name, sku: v.sku.trim(), barcode: v.barcode.trim(),
      aliases: [...new Map(skusOf({ aliases: v.alts }).filter(s => s.toLowerCase() !== v.sku.trim().toLowerCase()).map(s => [s.toLowerCase(), s])).values()],   // no repeats, not the main one again
      cost: v.cost, price: C ? null : v.price, marginMode: E.marginMode, marginValue: C || askedPrice(v) ? 0 : marginFromPrice(v.cost, v.price, E.marginMode),
      groupId: fam ? gid : base.groupId || '', folders: E.catIds, folder: E.catIds[0] || '', unit: E.unit, soldBy: E.soldBy,
      hidden: E.hidden, reorderPoint: E.reorder || 0, trackStock: C || E.track, sellOutOfStock: !C && E.sellOut,
      supplierId: E.main, altSupplierIds: E.sups, modifierIds: E.mods, hiddenChoiceIds: itemHidden(E), weight: E.weight, size: E.size, length: E.length,
      description: fam ? base.description || '' : E.desc.trim(), imageUrl: fam ? base.imageUrl || '' : E.img, color: fam ? base.color || '' : E.color,
      component: C, madeFrom: made }));
    if (!was.has(v.id) && row.trackStock && !made.length && Number(v.stock)) {   // applied before it's appended (balanceAfter)
      const mv = makeMovement({ productId: v.id, qty: v.stock, reason: 'opening', happenedOn: itemIsNew ? E.since : '', unitCost: row.cost, staff: who, staffId });
      applyMovement(row, mv); moves.push(mv);
    }
    return row;
  });
  const ids = new Set(rows.map(r => r.id)), gone = new Set((old?.members || []).map(m => m.id).filter(id => !ids.has(id)));
  state.products = state.products.map(p => (ids.has(p.id) ? rows.find(r => r.id === p.id) : gone.has(p.id) ? stampRow({ ...p, archived: true }) : p))
    .concat(rows.filter(r => !was.has(r.id)));
  if (fam) {
    const g = stampRow({ ...groupById(gid), id: gid, name, folder: E.catIds[0] || '', imageUrl: E.img, color: E.color, description: E.desc.trim() });
    state.groups = groupById(gid) ? state.groups.map(x => (x.id === gid ? g : x)) : state.groups.concat(g);
    saveGroups();
  }
  if (moves.length) appendMovements(moves);
  withStock(state.products);   // every count from the ledger again: a made item turned plain gets its own stock back
  saveProducts();   // recounts every made item (withMade) and their cost
  closeItemEditor(); renderItems(); renderProducts(); renderCart(); showDone('Saved');
}

// ---------- Categories and Modifiers (the back office's bo-catalog.js, on the till) ----------
// The top bar's switch picks the list; search and + follow it. A category or a modifier opens in the item editor's
// slide-over: its name, a modifier's options, and ticks for the items it's on. These Saves write (folders, modifiers,
// the items' folders / modifierIds); the item editor's Save is still design only.
let itemsKind = 'items', kindEdit = null;
const KIND = { items: ['item', 'Search'], cats: ['category', 'Search categories'], mods: ['modifier', 'Search modifiers'],
  discs: ['discount', 'Search discounts'], addons: ['add-on', 'Search add-ons'], hub: ['', 'Search'] };   // a list's search says which list it is
// The hub (owner 2026-10-18, Mail's Mailboxes): the five lists as equal rows; Items opens the last one, ‹ comes back here
const HUB = [['items', 'Items'], ['cats', 'Categories'], ['mods', 'Modifiers'], ['addons', 'Add-ons'], ['discs', 'Discounts']];
const kindCats = () => state.folders.filter(f => f.id !== 'all');
// Discounts (bo-model loadDiscounts): a name and a % or amount, picked in the cart's Discount sheet. Senior / PWD are built in.
const kindList = kind => (kind === 'cats' ? kindCats() : kind === 'discs' ? liveDiscounts() : kind === 'addons' ? [] :   // ponytail: Add-ons is a word only (owner try-out 2026-10-18), no data yet
   loadModifiers().filter(m => !m.archived));
const isOn = { cats: (p, id) => foldersOf(p).includes(id), mods: (p, id) => (p.modifierIds || []).includes(id) };
const itemsWith = (kind, id, all = catalogItems()) => all.filter(it => it.members.some(m => isOn[kind](m, id)));

// A .kinds switch: the pill slides from the old tab to `key`'s, a ::before placed by --x / --w. Until the first switch (and
// after a resize, which moves the tabs) the current tab paints its own background instead. Items and Reports use it.
function slidePill(box, attr, key) {
  const place = b => { box.style.setProperty('--x', `${b.offsetLeft}px`); box.style.setProperty('--w', `${b.offsetWidth}px`); };
  const shown = box.offsetWidth > 0;   // on a hidden page nothing can be measured: the tab paints itself
  if (!shown) box.classList.remove('slid');
  else if (!box.classList.contains('slid')) { place(box.querySelector('.cur')); box.classList.add('slid'); box.offsetWidth; }   // start where it is, then move
  box.querySelectorAll(`[data-${attr}]`).forEach(b => { b.classList.toggle('cur', b.dataset[attr] === key); b.setAttribute('aria-selected', b.dataset[attr] === key); });
  if (shown) place(box.querySelector('.cur'));
}

// Apple's segmented control on a .kinds switch: press the pill (it shrinks a touch) and it rides the finger 1:1, its width
// blending between the tabs it passes; let go and it settles on the nearest tab, picked through that tab's own click.
// A tap on another tab is still a plain click.
function wireSegDrag(box, attr) {
  let drag = null;
  const tabs = () => [...box.querySelectorAll(`[data-${attr}]`)];
  const mid = b => b.offsetLeft + b.offsetWidth / 2;
  const nearest = c => tabs().reduce((a, b) => (Math.abs(mid(b) - c) < Math.abs(mid(a) - c) ? b : a));
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest(`[data-${attr}]`);
    if (e.button || !b?.classList.contains('cur')) return;
    slidePill(box, attr, b.dataset[attr]);   // the pill as a ::before, placed on its tab
    drag = { id: e.pointerId, grab: e.clientX - mid(b), c: mid(b) };   // finger to the pill's centre, in the box's px
    box.setPointerCapture(e.pointerId);
    box.classList.add('press');
  });
  box.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    const bs = tabs(), cs = bs.map(mid);
    const c = drag.c = Math.min(Math.max(e.clientX - drag.grab, cs[0]), cs.at(-1));
    const i = Math.max(0, cs.findIndex((m, j) => c <= cs[j + 1]));
    const t = cs[i + 1] === undefined ? 0 : (c - cs[i]) / (cs[i + 1] - cs[i]);
    const w = bs[i].offsetWidth + t * ((bs[i + 1] || bs[i]).offsetWidth - bs[i].offsetWidth);
    box.classList.add('held');
    box.style.setProperty('--x', `${c - w / 2}px`); box.style.setProperty('--w', `${w}px`);
  });
  const end = (e) => {
    if (drag?.id !== e.pointerId) return;
    const b = nearest(drag.c); drag = null;
    box.classList.remove('press', 'held');
    if (e.type === 'pointerup' && !b.classList.contains('cur')) b.click();
    else slidePill(box, attr, box.querySelector('.cur').dataset[attr]);   // let go on its own tab, or cancelled: home
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

const itemsTop = {};   // each tab keeps its place in the list, as an iPhone's tabs do (owner asked 2026-10-16)
function setItemsKind(kind) {
  itemsTop[itemsKind] = $('#itemsLines').scrollTop;
  itemsKind = kind;
  const kb = $('#itemsKinds'), cur = kb.querySelector(`[data-kind="${kind}"]`);
  slidePill(kb, 'kind', kind);
  if (kb.offsetWidth && cur) kb.scrollTo({ behavior: 'smooth',   // the picked word slides fully into view, clear of the faded edge
    left: Math.min(Math.max(kb.scrollLeft, cur.offsetLeft + cur.offsetWidth + 28 - kb.clientWidth), cur.offsetLeft - 28) });
  $('#itemsView').classList.toggle('hub', kind === 'hub');
  $('#itemsSearch').placeholder = KIND[kind][1];
  $('#itemsFilter').hidden = kind !== 'items';   // category and stock filter items only
  $('#itemsAdd').title = $('#itemsAdd').ariaLabel = `New ${KIND[kind][0]}`;
  renderItems();
  $('#itemsLines').scrollTop = itemsTop[kind] || 0;
}

function renderKindRows(kind, band, rows) {
  if (kind === 'hub') {
    band.classList.add('k2');
    rows.innerHTML = HUB.map(([k, word]) => `<button type="button" class="row cols k2" data-hub="${k}"><span class="nm"><span class="tx"><b>${word}</b></span></span>
      <span class="num">${k === 'items' ? catalogItems().length : kindList(k).length}${ICHEV}</span></button>`).join('');
    return;
  }
  const q = itemsFilter.q.trim().toLowerCase(), all = catalogItems(), cats = kind === 'cats', mods = kind === 'mods';
  // a modifier is found by its choices too (Sweetness by "50%"); the choice that matched reads darker
  const list = kindList(kind).filter(x => (!addPick || (!x.archived && toCells(catProducts(x.id)).length)) && (!q || [x.name, ...(mods ? liveChoices(x) : []).map(o => o.name)].some(n => n.toLowerCase().includes(q))));   // Add tile: a category with nothing to sell makes no tile
  const discs = kind === 'discs';
  const hit = s => (q && s.toLowerCase().includes(q) ? `<b class="hit">${escapeHtml(s)}</b>` : escapeHtml(s));
  band.classList.add('k2');   // k2 hides the head: the rows say it (owner 2026-10-09)
  rows.innerHTML = list.map(x => `<button type="button" class="row cols k2" data-id="${escapeHtml(x.id)}">
      <span class="nm">${cats ? itemThumb(catLook(x)) : ''}<span class="tx"><b>${escapeHtml(x.name)}</b>${
        discs ? (x.builtin ? '<small>Asks for the ID number and name</small>' : '') : cats ? (addPickOn(x.id) ? '<small>Already a tile</small>' : '')
        : `<small class="mline"><span class="ch">${choiceList(x, hit)}</span><span>&nbsp;· ${SalesMath.plural(itemsWith(kind, x.id, all).length, 'item')}</span></small>`}</span></span>
      <span class="num">${discs ? esShown(x) : mods ? '' : SalesMath.plural(addPick ? toCells(catProducts(x.id)).length : itemsWith(kind, x.id, all).length, 'item')}</span></button>`).join('')
    || `<div class="empty"><b>${q ? 'No matches' : `No ${cats ? 'categories' : kind === 'addons' ? 'add-ons' : 'modifiers'} yet`}</b><span>${q ? 'Try a different name.' : kind === 'addons' ? ''
      : cats ? 'Tap + to add one, then tick its items.' : 'A question the POS asks when you sell an item, like Gift wrap or Assembly.'}</span></div>`;
}

function openKindEditor(kind, id) {
  if (editorDirty()) return askLeave(true, () => { closeItemEditor(); openKindEditor(kind, id); });
  const was = kindList(kind).find(x => x.id === id);
  const picked = new Set(was && isOn[kind] ? itemsWith(kind, was.id).map(it => it.id) : []);   // a discount isn't on items
  kindEdit = { kind, id: was ? was.id : '', sub: '', name: was ? was.name : '', picked, first: new Set(picked),
    img: was?.imageUrl || '', color: was?.color || '', type: was?.type || 'percent', value: was ? String(was.value) : '', builtin: was?.builtin || '', af: { ...PICK_AF_DEF } };
  if (kind === 'mods') {   // every choice, removed ones too (they stay as tombstones); a price is text while typed, '' = no extra
    Object.assign(kindEdit, { picks: was?.picks || 'one', options: (was?.options || []).map(o => ({ ...o, price: o.price ? String(o.price) : '' })),
      u0: Object.fromEntries((was?.options || []).map(o => [o.id, !!o.unavailable])),   // Status as it opened (saveKind)
      hide: modHideOf(was) });
  }
  itemEdit = null;
  renderKindForm();
  $('#itemsView').classList.add('editing');
  $('#itemForm').scrollTop = 0;
  editorFirst = editorSnap();
  if (!was) setTimeout(() => $('#itemForm [data-k=name]')?.focus(), 300);
}

function renderKindForm(dir) {
  $('#itemForm').closest('.editor').classList.toggle('picking', kindEdit.sub === 'items');
  if (kindEdit.sub === 'items') return renderPickPage(dir);
  if (kindEdit.kind === 'mods') return renderModForm(dir);
  const K = kindEdit, cats = K.kind === 'cats', head = cats ? lookHead(catLook(K)) : '';
  $('#itemForm').closest('.editor').classList.toggle('sub', !!K.sub);   // a subpage has only Back
  $('#itemFind').hidden = true;   // its own search stays in the form
  $('#itemTitle').textContent = K.sub ? 'Tile appearance' : K.name || `New ${KIND[K.kind][0]}`;
  if (K.sub) { $('#itemForm').innerHTML = `<div class="form ${dir || ''}">${lookPage(catLook(K))}</div>`; return; }
  if (K.kind === 'discs') {   // name, % or amount (a dropdown, the ⋯ menu's morph), value; Senior / PWD keep their name and stay %
    const pct = K.type === 'percent', unit = pct ? '%' : icurrency();
    $('#itemForm').innerHTML = `<div class="form">${head}${icard('', [
      ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Add name, like Summer sale"${K.builtin ? ' disabled' : ''}>`),
      K.builtin ? '' : ifr('Type', `<button type="button" class="act st-pick" data-ka="type" aria-haspopup="menu" aria-expanded="false"><span>${pct ? 'Percent' : 'Amount'}</span>${IUPDOWN}</button>`, true),
      ifr(`Value (${unit})`, `<input class="in num" data-k="value" value="${escapeHtml(K.value)}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0">`),
    ].join(''), K.builtin ? 'Built in. The till asks for the ID number and name, and the rate comes off the price before VAT.' : '')}${kindDropRow()}</div>`;
    return;
  }
  // its items on their own page, in their own card, as a modifier's Asked on: no long list here (owner 2026-10-27)
  $('#itemForm').innerHTML = `<div class="form ${dir || ''}">${head}
    ${icard('', ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Add name, like Plumbing">`), '', ' r')}
    ${icard('', inav('Items', K.picked.size ? SalesMath.plural(K.picked.size, 'item') : 'None', 'items'), '', ' r')}
    ${kindDropRow()}
  </div>`;
}
// Delete is the page's last block, red, as the item's Archive (owner 2026-10-29): only a saved one, never a built-in
const kindDropRow = () => (kindEdit.id && !kindEdit.builtin ? icard('', `<button type="button" class="fr add red" data-ka="drop">Delete ${KIND[kindEdit.kind][0]}</button>`) : '');

function kindInput(t) {
  const K = kindEdit;
  if (t.dataset.k === 'name') { K.name = t.value; $('#itemTitle').textContent = K.name || `New ${KIND[K.kind][0]}`; }
  else if (t.dataset.k === 'value') K.value = t.value;
  else if (t.dataset.c) modCur()[t.dataset.c] = t.value;   // a choice's Name / Price
  else if (t.dataset.hon) modHonSet(t);
  else if (t.dataset.pick) {
    K.picked[t.checked ? 'add' : 'delete'](t.dataset.pick);
    kindPickBar();
  }
}
function kindClick(b) {
  const K = kindEdit, ka = b.dataset.ka, menu = (opts, cur, run) => openMenu(b, opts.map(([k, label]) => ({ label, cur: cur === k, run: () => run(k) })), { w: 200, right: true });
  if (b.dataset.sub) return itemGo(b.dataset.sub);   // a modifier's subpages
  if (ka === 'type') menu([['percent', 'Percent'], ['amount', 'Amount']], K.type, k => { K.type = k; renderKindForm(); $('#itemForm [data-k=value]').focus(); });
  if (ka === 'picks') menu(Object.entries(MODIFIER_PICKS), K.picks, k => { K.picks = k; renderKindForm(); });
  if (ka === 'status') menu([[false, 'Available'], [true, 'Unavailable']], !!modCur().unavailable, v => { modCur().unavailable = v; renderKindForm(); });
  if (ka === 'choice-add') {
    const o = { id: newId(), name: '', price: '', unavailable: false, removed: false, fresh: true };
    K.options.push(o); itemGo('choice:' + o.id);
    $('#itemForm [data-c=name]').focus({ preventScroll: true });
  }
  if (ka === 'choice-del') {   // a saved choice stays as a tombstone (removed) so a sync never brings it back; off every item on Save
    const o = modCur();
    if (o.fresh) K.options.splice(K.options.indexOf(o), 1); else o.removed = true;
    delete K.hide[o.id];
    itemGo('', true);
  }
  if (ka === 'drop') dropKind();
}

// ---------- A modifier's pages: the modifier, a choice, which items ask it, what is hidden where ----------
// K.sub: '' | 'choice:<id>' (Add / Edit choice) | 'items' (Asked on) | 'hidden'. Save on any of them writes it all (owner 2026-10-24).
const PICKS_NOTE = { one: 'Exactly one', upto2: 'None, one or two', upto3: 'None, or up to three', any: 'None, one, or as many as they like' };
const modCur = () => kindEdit.options.find(o => o.id === kindEdit.sub.slice(kindEdit.sub.indexOf(':') + 1));
// { choiceId: [item ids it's hidden on] }, from the items that ask this modifier
function modHideOf(m) {
  const ids = new Set((m?.options || []).map(o => o.id)), out = {};
  if (m) itemsWith('mods', m.id).forEach(it => it.hideCh.forEach(c => { if (ids.has(c)) (out[c] ||= []).push(it.id); }));
  Object.values(out).forEach(a => a.sort());
  return out;
}
const modPickBtn = (ka, text) => `<button type="button" class="act st-pick" data-ka="${ka}" aria-haspopup="menu" aria-expanded="false"><span>${text}</span>${IUPDOWN}</button>`;
const modPrice = p => (Number(p) > 0 ? `+${peso(round2(Number(p)))}` : '');
// the items a choice is hidden on, of those still asked (Save writes only those, modWriteHidden)
const modHidOn = (K, o) => (K.hide[o.id] || []).filter(id => K.picked.has(id));

function renderModForm(dir) {
  const K = kindEdit, s = K.sub, o = s.includes(':') ? modCur() : null;
  const [title, html] = s === 'hidden' ? ['Hidden', modHiddenPage()]
    : o ? [o.fresh ? 'Add choice' : 'Edit choice', modChoicePage(o)]
    : [K.name || 'New modifier', modMainPage()];
  $('#itemForm').closest('.editor').classList.remove('sub');   // every subpage keeps Save too (owner 2026-10-24)
  $('#itemFind').hidden = true;
  $('#itemTitle').textContent = title;
  $('#itemForm').innerHTML = `<div class="form ${dir || ''}">${html}</div>`;
}
function modMainPage() {
  const K = kindEdit, nHid = K.options.filter(o => !o.removed).reduce((n, o) => n + modHidOn(K, o).length, 0);
  const crow = o => {
    const n = modHidOn(K, o).length, sub = [o.unavailable ? 'Unavailable' : '', n ? `Hidden on ${SalesMath.plural(n, 'item')}` : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="fr nav" data-sub="choice:${escapeHtml(o.id)}"><span class="lb">${escapeHtml(o.name)}${sub ? `<small>${sub}</small>` : ''}</span>
      <span class="ctl end"><span class="vv num">${modPrice(o.price)}</span>${ICHEV}</span></button>`;
  };
  return icard('', ifr('Name', `<input class="in" data-k="name" value="${escapeHtml(K.name)}" placeholder="Add name, like Gift wrap">`), '', ' r')
    + icard('', ifr('Customer picks', modPickBtn('picks', MODIFIER_PICKS[K.picks]), true), PICKS_NOTE[K.picks], ' r')
    + icard('Choices', K.options.filter(o => !o.removed).map(crow).join('') + '<button type="button" class="fr add" data-ka="choice-add">Add choice</button>', '', ' r')
    + icard('', inav('Asked on', K.picked.size ? SalesMath.plural(K.picked.size, 'item') : 'None', 'items')
      + (nHid ? inav('Hidden', String(nHid), 'hidden') : ''), '', ' r')
    + kindDropRow();
}
function modChoicePage(o) {
  return icard('', ifr('Name', `<input class="in" data-c="name" value="${escapeHtml(o.name)}" placeholder="Add name, like Large">`)
      + ifr('Price', `<input class="in num" data-c="price" value="${escapeHtml(o.price)}" ${IMONEY} placeholder="No extra">`), 'Added to the item’s price. Empty = no extra.', ' r')
    + (o.fresh ? '' : icard('', ifr('Status', modPickBtn('status', o.unavailable ? 'Unavailable' : 'Available'), true),
        'Unavailable: greyed on the POS, on every item. Set it back to Available when it’s in. To hide it on one item, open the item.', ' r')
      + icard('', '<button type="button" class="fr add red" data-ka="choice-del">Remove choice</button>'));
}
// Hidden: every choice hidden somewhere, a block per choice, an on/off per item; on = offered again and it leaves the
// list. All on one page, as Quick stock (owner 2026-10-24). A draft like the rest: Save writes it.
function modHiddenPage() {
  const K = kindEdit, by = new Map(catalogItems().map(it => [it.id, it]));
  const sw = (o, it) => `<label class="fr"><span class="lb">${escapeHtml(it.name)}</span><span class="ctl end"><input type="checkbox" class="sw" data-hon="${escapeHtml(it.id)}" data-uc="${escapeHtml(o.id)}"></span></label>`;
  const secs = K.options.filter(o => !o.removed).map(o => [o, modHidOn(K, o).map(id => by.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))])
    .filter(([, its]) => its.length).map(([o, its], i, all) => icard(escapeHtml(o.name), its.map(it => sw(o, it)).join(''), i === all.length - 1 ? 'Turn one on to offer it on that item again.' : ''));
  return secs.join('') || icard('', '<div class="pick">Nothing is hidden.</div>');
}
function modHonSet(t) {
  const K = kindEdit, c = t.dataset.uc;
  K.hide[c] = (K.hide[c] || []).filter(x => x !== t.dataset.hon);
  if (!K.hide[c].length) delete K.hide[c];
  renderKindForm();
}
// A category's Items and a modifier's Asked on (owner 2026-10-27): Adjust stock's picking page. ‹ + search + filter
// (category, selected or not) in the bar, the ticks, its pill at the bottom saves and lands back on the category /
// modifier. What it's on now comes first, and the order holds while you tick.
const PICK_AF_DEF = { cat: '', on: '' };
function renderPickPage(dir) {
  const K = kindEdit, f = K.af, mods = K.kind === 'mods';
  const vis = catalogItems().filter(it => !(mods && it.component)   // a part is never sold, so never asked
      && (!f.cat || f.cat.some(c => it.cats.includes(c))) && (!f.on || f.on.includes(K.picked.has(it.id) ? 'sel' : 'not')))
    .sort((a, b) => (K.first.has(b.id) - K.first.has(a.id)) || a.name.localeCompare(b.name));
  $('#itemForm').closest('.editor').classList.add('sub');   // no Save up top: the pill is it
  $('#itemTitle').textContent = mods ? 'Asked on' : 'Items';
  $('#itemFind').hidden = false;
  $('#itemFindFilter').classList.toggle('on', Object.keys(PICK_AF_DEF).some(k => f[k] !== PICK_AF_DEF[k]));
  if (dir === 'push') { $('#itemFindQ').value = ''; $('#itemFind').classList.remove('typed'); }
  $('#itemForm').innerHTML = `<div class="form ${dir || ''}">${icard('', vis.map(it => `<label class="pick" data-find="${escapeHtml(it.name.toLowerCase())}"><input type="checkbox" data-pick="${escapeHtml(it.id)}"${K.picked.has(it.id) ? ' checked' : ''}>
      ${itemThumb(it)}<span class="tx">${escapeHtml(it.name)}</span></label>`).join('') || '<div class="pick">No items match.</div>')}</div>`;
  filterPicks($('#itemFindQ').value);
  kindPickBar();
}
const kindPickBar = () => { $('#kindPickGo').innerHTML = `<span>${SalesMath.plural(kindEdit.picked.size, 'item')}</span><span>Save</span>`; };
// the bar's filter; a modifier's sheet also ticks all the rows on screen, or none (owner 2026-10-27: not a category's)
function pickFilter(b) {
  const K = kindEdit, all = on => () => {
    $$('#itemForm .pick:not([hidden]) [data-pick]').forEach(x => { x.checked = on; K.picked[on ? 'add' : 'delete'](x.dataset.pick); });
    kindPickBar();
  };
  openFilterSheet(b, () => [
    ['Category', 'cat', [['', 'All'], ...itemCategories().map(c => [c, c])]],
    ['Show', 'on', [['', 'All'], ['sel', 'Selected'], ['not', 'Not selected']]],
  ], K.af, PICK_AF_DEF, () => renderKindForm(), K.kind === 'mods' ? [['All shown', all(true)], ['None shown', all(false)]] : []);
}
// Back on a modifier's subpage: a new choice left blank goes; else the modifier
function kindBack() {
  const K = kindEdit, o = K.kind === 'mods' && K.sub.includes(':') ? modCur() : null;
  if (o?.fresh) { if (String(o.name).trim()) delete o.fresh; else K.options.splice(K.options.indexOf(o), 1); }
  itemGo('', true);
}
// What was hidden where, onto the items that ask it: only live choices, never all of them (then none is hidden)
function modWriteHidden(K, at) {
  const mine = new Set(K.options.map(o => o.id)), live = K.options.filter(o => !o.removed);
  const keyOf = p => (p.groupId && groupById(p.groupId) ? p.groupId : p.id);
  state.products = state.products.map(p => {
    if (p.archived) return p;
    const key = keyOf(p), now = (p.hiddenChoiceIds || []).filter(c => !mine.has(c));
    let add = K.picked.has(key) ? live.filter(o => (K.hide[o.id] || []).includes(key)).map(o => o.id) : [];
    if (add.length === live.length) add = [];
    const next = [...now, ...add].sort();
    return JSON.stringify(next) === JSON.stringify([...(p.hiddenChoiceIds || [])].sort()) ? p : { ...p, hiddenChoiceIds: next, updatedAt: at };
  });
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
  if (!name) { if (K.sub) kindBack(); showToast(`Give the ${word} a name`); $('#itemForm [data-k=name]').focus(); return; }
  if (kindList(K.kind).some(x => x.id !== K.id && x.name.toLowerCase() === name.toLowerCase())) { showToast(`A ${word} has that name already`); return; }
  const id = K.id || newId();
  if (K.kind === 'discs') {
    const v = round2(Number(K.value)), pct = K.builtin || K.type === 'percent';   // checked as it will be stored
    if (!(v >= 0.01) || (pct && v > 100)) { showToast(pct ? 'Use a percent from 0.01 to 100' : 'Use an amount above 0'); $('#itemForm [data-k=value]').focus(); return; }
    const put = () => {
      const list = loadDiscounts();
      const row = stampRow({ ...DISCOUNT_DEFAULTS, ...list.find(d => d.id === id), id, name, type: pct ? 'percent' : 'amount', value: v });
      saveDiscounts(K.id ? list.map(d => (d.id === id ? row : d)) : list.concat(row));
      closeKindEditor('Saved');
    };
    // a discount's size is a manager's (else a cashier sets Senior to 100%, which never asks at the sale)
    if (gate('discount', put, {}, 'Changing a discount.')) put();
    return;
  }
  if (K.kind === 'cats') {
    const row = stampRow({ builtin: false, ...state.folders.find(f => f.id === id), id, name, imageUrl: K.img, color: K.color });
    state.folders = K.id ? state.folders.map(f => (f.id === id ? row : f)) : state.folders.concat(row);
    writeJsonStorage(STORAGE_FOLDERS, state.folders);
  } else {
    const live = K.options.filter(o => !o.removed), names = live.map(o => String(o.name).trim().toLowerCase());
    if (!live.length) { showToast('Add a choice'); return; }
    if (names.some(n => !n)) { showToast('Name every choice'); return; }
    if (new Set(names).size < names.length) { showToast('Two choices have the same name'); return; }
    if (live.some(o => !(Number(o.price || 0) >= 0))) { showToast('A price must be 0 or more'); return; }
    const list = loadModifiers(), now = new Map((list.find(m => m.id === id)?.options || []).map(o => [o.id, o]));
    // Status as stored now unless this page changed it (a POS may have set Unavailable while it was open); removed stays removed
    const unav = o => (!!o.unavailable !== !!K.u0[o.id] ? !!o.unavailable : !!now.get(o.id)?.unavailable);
    const row = stampRow({ ...MODIFIER_DEFAULTS, ...list.find(m => m.id === id), id, name, picks: K.picks,   // prices round2 pesos, as products'
      options: K.options.map(o => ({ id: o.id, name: String(o.name).trim(), price: round2(Number(o.price) || 0), unavailable: unav(o), removed: !!o.removed || !!now.get(o.id)?.removed })) });
    saveModifiers(K.id ? list.map(m => (m.id === id ? row : m)) : list.concat(row));
    modWriteHidden({ ...K, id }, at);   // tagItems below saves the products
  }
  tagItems(K.kind, id, K.picked, at);
  const stay = !!K.sub;
  if (stay) kindSaved(id);
  closeKindEditor('Saved', stay);
}
// Save on a subpage (a choice, Asked on, a category's Items) writes it all, then lands on the category / modifier, not
// the list (owner 2026-10-27); the editor now holds what was saved
function kindSaved(id) {
  const K = kindEdit;
  K.id = id;
  if (K.kind === 'mods') { K.options.forEach(o => delete o.fresh); K.u0 = Object.fromEntries(K.options.map(o => [o.id, !!o.unavailable])); }
  itemGo('', true);
  editorFirst = editorSnap();
}

// A category goes (its items stay, they only leave it); a modifier is archived, as in the back office.
function dropKind() {
  const K = kindEdit, at = new Date().toISOString();
  if (K.kind === 'cats') {
    return showConfirm({ title: `Delete “${K.name}”?`, message: 'Its items stay; they only leave this category.', okText: 'Delete', danger: true,
      onConfirm: () => {
        tagItems('cats', K.id, new Set(), at);
        state.folders = state.folders.filter(f => f.id !== K.id);
        writeJsonStorage(STORAGE_FOLDERS, state.folders);
        closeKindEditor('Deleted');
      } });
  }
  if (K.kind === 'discs') {   // archived, not removed: old sales keep its name, and a sync never brings it back
    return showConfirm({ title: `Delete “${K.name}”?`, message: 'Sales that used it keep it on their receipt.', okText: 'Delete', danger: true,
      onConfirm: () => { saveDiscounts(loadDiscounts().map(d => (d.id === K.id ? stampRow({ ...d, archived: true }) : d))); closeKindEditor('Deleted'); } });
  }
  // a modifier: off every item (its hidden choices too), the row archived so old sales and a sync still know it
  showConfirm({ title: `Delete “${K.name}”?`, message: 'It comes off every item. Sales that used it keep it on their receipt.', okText: 'Delete', danger: true,
    onConfirm: () => {
      const list = loadModifiers(), ids = new Set((list.find(m => m.id === K.id)?.options || []).map(o => o.id));
      state.products = state.products.map(p => ((p.hiddenChoiceIds || []).some(c => ids.has(c)) ? { ...p, hiddenChoiceIds: p.hiddenChoiceIds.filter(c => !ids.has(c)), updatedAt: at } : p));
      tagItems('mods', K.id, new Set(), at);
      saveModifiers(list.map(m => (m.id === K.id ? stampRow({ ...m, archived: true }) : m)));
      closeKindEditor('Deleted');
    } });
}
function closeKindEditor(msg, stay) {
  if (itemsFilter.cat) {   // a picked category was renamed or deleted: it lets go
    const cat = itemsFilter.cat.filter(c => state.folders.some(f => f.name === c));
    itemsFilter.cat = cat.length ? cat : '';
  }
  if (!stay) closeItemEditor();
  renderItems(); showDone(msg);
}
