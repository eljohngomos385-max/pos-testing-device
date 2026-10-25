// Till › Settings, and the cash drawer count.

// The page's choices ([data-pick] rows, each opening its own page of ticks): the choices in the order they always
// show, what is on now, and the setter each one already had. A pick runs the setter, then the page redraws from state.
const savePrinting = (patch) => { state.settings.printing = { ...printerConfig(), ...patch }; saveSettings(); };
const SETTING_PICKS = {
  // Wide is the phone's (2 across at Medium's height, owner 2026-10-13); a tablet runs it as Medium (getSellGridProfile), so it reads Medium there
  tileSize: { get opts() { return [['sm', 'Small'], ['md', 'Medium'], ...(innerWidth > 720 ? [] : [['wide', 'Wide']]), ['lg', 'Large']]; },
    now: () => (state.tileSize === 'wide' && innerWidth > 720 ? 'md' : state.tileSize) || 'md', set: setTileSize },
  tileText: { opts: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']], now: () => state.tileText || 'md', set: setTileText },
  tileShow: { opts: [['both', 'Price and stock'], ['price', 'Price'], ['stock', 'Stock'], ['name', 'Name only']], now: tileShowNow, set: setTileShow },
  sellLayout: { opts: [['grid', 'Grid'], ['list', 'List']], now: () => (state.sellLayout === 'grid' ? 'grid' : 'list'),
    set: v => setSellLayout(v === 'grid' ? 'grid' : state.sellLayout === 'grid' ? 'list' : state.sellLayout) },   // List keeps Separate rows as it was
  // List: the rows' pictures are on or off (Photo fills is a tile's); On keeps a tile's Photo fills
  tilePics: { get opts() { return state.sellLayout === 'grid' ? [['off', 'Off'], ['top', 'Photo top'], ['fill', 'Photo fills']] : [['off', 'Off'], ['top', 'On']]; },
    now: () => (state.sellLayout !== 'grid' && state.tilePics === 'fill' ? 'top' : state.tilePics), set: v => setTilePics(v === 'top' && state.tilePics === 'fill' ? 'fill' : v) },
  cartPics: { opts: [['off', 'Off'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], now: () => state.cartPics, set: setCartPics },
  theme: { opts: [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], now: () => state.theme || 'dark', set: applyTheme },
  driver: { opts: [['browser', 'Browser'], ['network', 'Wi-Fi'], ['bluetooth', 'Bluetooth']], now: () => printerConfig().driver || 'browser', set: v => savePrinting({ driver: v }) },
  width: { opts: [['58mm', '58 mm'], ['80mm', '80 mm']], now: () => printerConfig().width || '80mm', set: v => savePrinting({ width: v }) },
  discountLimit: { opts: [10, 15, 20, 25, 30, 50].map(n => [n, `${n}%`]).concat([[null, 'Never ask']]), now: () => loadTillPerms().discountLimit, set: setDiscountLimit },
  refundPin: { opts: [['ask', 'Ask a manager'], ['any', 'Anyone can']], now: () => roleCan('cashier', 'refund') ? 'any' : 'ask', set: setRefundPin },
  startCash: { opts: [['ask', 'Ask every shift'], ['float', 'Keep a float']], now: () => state.settings.startCash, set: v => setShiftPick({ startCash: v }) },
  // Business type (owner 2026-10-22: its own page, not a pop-up): retail and food for now. A food store's part is an Ingredient (partWord)
  bizType: { opts: [['retail', 'Retail'], ['food', 'Food']], now: () => (state.settings.store?.businessType === 'food' ? 'food' : 'retail'),
    set: v => { state.settings.store = { ...state.settings.store, businessType: v }; saveSettings(); if (v === 'food') seedFoodDemo(); renderItems(); renderProducts(); } },
  // ponytail: 12–6 AM only; widen it when a store runs past 6 AM
  autoClose: { opts: [0, 1, 2, 3, 4, 5, 6].map(h => [h, `${h || 12} AM`]), now: () => state.settings.autoClose, set: v => setShiftPick({ autoClose: v }) },
};
// Refunds and exchanges (owner 2026-10-09): the cashier role's "Refund a sale" switch (Back office › Staff & access),
// here so a store can turn the manager's PIN off for a day with no manager in. Changing it is a refund call of its own.
function setRefundPin(v) {
  const put = () => {
    const p = loadTillPerms();
    saveTillPerms({ ...p, cashier: p.cashier.filter(a => a !== 'refund').concat(v === 'any' ? ['refund'] : []) });
    renderPosSettings(false);
  };
  if (gate('refund', put, { refundPin: v }, 'Changing who may refund.')) put();
}
// The discount limit (owner 2026-10-09): one value, kept with the till perms, that Back office › Staff & access shows too.
// Settings is open to a cashier, so changing it is a big-discount call of its own.
function setDiscountLimit(v) {
  const put = () => { saveTillPerms({ ...loadTillPerms(), discountLimit: v }); renderPosSettings(false); };
  if (gate('discount', put, { discountLimit: v }, 'Changing when a manager is asked.')) put();
}
// Shift (owner 2026-10-10): how a shift starts and when one nobody closed closes itself. Settings is open to a
// cashier: a shift call of its own.
function setShiftPick(patch) {
  const put = () => { Object.assign(state.settings, patch); saveSettings(); renderPosSettings(false); };
  if (gate('shift', put, patch, 'Changing how shifts work.')) put();
}
// Settings is a stack of pages in one view: the list, Payment types (and its Add), and one choice's ticks.
function showStPage(id) { $$('.view-settings .st-page').forEach(p => { p.hidden = p.id !== id; }); }
// One choice as its own page (owner 2026-10-15, "the Facebook route", no pop-ups): the row's word on top, a tick
// per choice. A tick sets it and the page stays, like iPhone Settings.
let stPick = '';
function openPick(key) {
  const pk = SETTING_PICKS[key];
  stPick = key;
  $('#pickTitle').textContent = $(`#settingsView [data-pick="${key}"] .lb`).textContent;
  $('#pickList').innerHTML = pk.opts.map(([, label], i) => `<label class="pick"><input type="radio" name="stPick" value="${i}"><span class="tx">${escapeHtml(label)}</span></label>`).join('');
  showStPage('pickPage');
  renderPick();
}
// The ticks follow state: a gated setter (a manager's PIN) that was cancelled leaves the old one ticked.
function renderPick() {
  const pk = SETTING_PICKS[stPick];
  if (pk) { const now = pk.now(); $$('#pickList input').forEach(r => { r.checked = pk.opts[r.value][0] === now; }); }
}
function bindPick() {
  $('#pickBack').addEventListener('click', () => { stPick = ''; showStPage('settingsPage'); });
  $('#pickList').addEventListener('change', (e) => {
    const key = stPick;
    SETTING_PICKS[key].set(SETTING_PICKS[key].opts[e.target.value][0]);
    renderPosSettings(key === 'driver');
  });
}

// printer = false: redraw labels and which rows show, but leave the printer list, a running scan's progress
// line and the probe alone (a theme or paper pick has nothing to do with them).
function renderPosSettings(printer = true) {
  $$('#settingsView [data-pick]').forEach(b => {
    const pk = SETTING_PICKS[b.dataset.pick], now = pk.now();
    const val = (pk.opts.find(o => o[0] === now) || pk.opts[0])[1];
    b.querySelector('.vv').textContent = val;
    b.setAttribute('aria-label', b.querySelector('.lb').textContent + ', ' + val);   // "Tile size, Medium", not just "Medium"
  });
  renderPick();
  $('#sellRowsRow').hidden = state.sellLayout === 'grid';   // Separate rows: List only
  $('#sellRows').checked = state.sellLayout === 'rows';
  const p = printerConfig();
  const saleRow = $('#posPrintOnSaleRow');   // the browser's own dialog can't print by itself (checkout's printOnSale gate)
  if (saleRow) saleRow.hidden = p.driver !== 'network' && p.driver !== 'bluetooth';
  const po = $('#posPrintOnSale');
  if (po) po.checked = !!p.printOnSale;
  const pc = $('#posPrintCut');
  if (pc) pc.checked = p.cut !== false;
  const pm = $('#posPrintMap');
  if (pm) pm.checked = p.mapOnReceipt !== false;
  const ip = $('#posPrinterIp');
  if (ip) ip.value = p.netUrl || '';
  const netRow = $('#posNetRow');
  if (netRow) netRow.hidden = p.driver !== 'network';
  const scanRow = $('#posScanRow');
  if (scanRow) scanRow.hidden = p.driver !== 'network';
  const listRow = $('#posPrinterListRow');
  if (listRow) listRow.hidden = p.driver !== 'network';
  if (printer) {
    renderPrinterList();
    setScanStatus('');
    refreshPrinterStatus();
  }
  const btRow = $('#posBtRow');
  if (btRow) btRow.hidden = p.driver !== 'bluetooth';
  const btStatus = $('#posBtStatus');
  if (btStatus) btStatus.textContent = p.btName ? 'Paired: ' + p.btName : 'Not paired';
  const ptNow = $('#posPayTypesNow');
  if (ptNow) ptNow.textContent = `${payTypesOn()} on`;
  const ftNow = $('#posFulTypesNow');
  if (ftNow) ftNow.textContent = `${fulfilMethods(state.settings).length} on`;
  const acct = $('#posAcctEmail');
  if (acct) acct.textContent = loadStaff().find(u => u.role === 'owner')?.email || 'Account';
  const churnInput = $('#posChurnDays');
  if (churnInput) churnInput.value = state.settings.churnThresholdDays || 30;
  const tz = $('#posTimeZone');
  if (tz) {
    const zone = SalesMath.storeZone(state.settings);
    // The browser's own zone list, filled once; ponytail: a browser without it offers the saved zone and Manila only.
    if (!tz.options.length) tz.innerHTML = [...new Set([zone, 'Asia/Manila', ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort()
      .map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z.replace(/_/g, ' '))}</option>`).join('');
    tz.value = zone;
  }
}

// Settings › Payment types (owner 2026-10-13): its own page. Each type's switch says if the checkout shows it, and the store
// adds its own names. The same { hidden, custom } as Back office › Payments; one of your own switched off goes in hidden too.
// ponytail: no manager PIN to change these; add one if a store asks. Your own types rename on their page.
// Caps for both pages: TYPES_ON_MAX / OWN_TYPES_MAX (bo-model.js). Past 7 the sale's list scrolls on a phone, tolerated.
const tooMany = () => showToast(`${TYPES_ON_MAX} can be on at once. Turn one off first`);
// Delete (owner 2026-10-22): your own type's page ends in a red Delete, one confirm; past sales keep the name.
// Built-ins and the primary fulfilment type have none.
const addedOff = (name) => showToast(`${name} added, switched off. ${TYPES_ON_MAX} can be on at once`);   // a notice wraps; a done toast is cut to one line
const PAY_TYPES = [['cash', 'Cash', 'Always on. The cash drawer counts it.'], ['gcash', 'GCash', ''], ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'Staff type the name at checkout'], ['credit', 'Account', 'Pay later. Shows once a customer is picked.'], ['split', 'Split', 'Part one way, the rest another']];
// qrCodes: a picture per type. ponytail: rides in settings as a data URL (HWPOS_STORE); with Supabase it goes to R2 and settings keep its address
const payTypes = () => ({ hidden: [], custom: [], ref: ['gcash', 'qr'], opts: {}, qrCodes: {}, ...state.settings.payments });
// Ask for (owner 2026-10-17, presets 2026-10-22): per type, on its own page; on = a box at checkout (and split), asked as its word
const payRefOn = (k) => payTypes().ref.includes(k);
const PAY_REFABLE = ['cash', 'gcash', 'qr', 'other', 'credit'];   // and every one of your own: all but Split have a page (its parts follow their own types)
const ASKS = ['Reference no.', 'Last 4 digits', 'Approval code', 'Cheque no.', 'Account no.', 'Name', 'Phone no.'];
// A type's settings (owner 2026-10-22): its word to ask for, Must fill in, Opens cash drawer. The defaults are today's: only Cash opens the drawer.
// No "Counts as cash": BIR's Z-reading (RMO 24-2023 Annex D-2) keeps Cash in drawer apart from cheque, card, gift cert.
const opt = (k) => ({ ask: 'Reference no.', must: false, drawer: k === 'cash', ...payTypes().opts[k] });
const askNow = (k) => (payRefOn(k) ? opt(k).ask : 'Nothing');
const typeKey = (m) => (PAY_TYPES.some(t => t[0] === m) || payTypes().custom.includes(m) ? m : 'other');   // a typed Other name = Other
// a sale's payment row -> its type: GCash, QR and your own are stored as 'other' + their word (buildOrderPayments)
const payKey = (p) => (p.method === 'other' ? PAY_TYPES.find(t => t[1] === p.label)?.[0] || typeKey(p.label) : p.method);
// a custom name is saved as the sale's method, so the words the sale maths already reads (unpaid = no money taken) are taken too
const payNameTaken = (name, skip) => [...PAY_TYPES.flatMap(([k, l]) => [k, l]), ...Object.entries(SalesMath.TENDER_LABEL).flat(), 'Void', 'Refund',
  ...payTypes().custom.filter(n => n !== skip)].some(n => n.toLowerCase() === name.toLowerCase());
const fitName = (n) => (n.length > 24 ? n.slice(0, 23).trimEnd() + '…' : n);
let ptOpen = '';
const setOpt = (patch) => savePayTypes({ opts: { ...payTypes().opts, [ptOpen]: { ...opt(ptOpen), ...patch } } });
const payTypesOn = () => { const { hidden, custom } = payTypes(); return [...PAY_TYPES.map(t => t[0]), ...custom].filter(k => k === 'cash' || !hidden.includes(k)).length; };
function openPayTypes(open) {
  showStPage(open ? 'payTypesPage' : 'settingsPage');
  if (open) renderPayTypes(); else renderPosSettings(false);
}
function renderPayTypes() {
  const { hidden, custom } = payTypes();
  // the label is for= its switch: without it a tap on the name went to the row's first control, a custom type's Delete
  // every type but Split: the switch shows it, the rest of the row (name, gap, ›) opens its page, like QR codes' rows
  const row = (key, label, note, mine) => `<label class="fr${mine || PAY_REFABLE.includes(key) ? ` qr-row" data-pt-open="${escapeHtml(key)}` : ''}" for="pt-${escapeHtml(key)}"><span class="lb">${escapeHtml(label)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</span><span class="v"><input type="checkbox" class="sw" id="pt-${escapeHtml(key)}" data-pt="${escapeHtml(key)}" aria-label="Show ${escapeHtml(label)} at checkout"${key === 'cash' || !hidden.includes(key) ? ' checked' : ''}${key === 'cash' ? ' disabled' : ''}>${mine || PAY_REFABLE.includes(key) ? `<button type="button" class="pt-go" aria-label="${escapeHtml(label)} settings">${QR_CHEV}</button>` : ''}</span></label>`;   // the › is a button: a keyboard reaches the page too
  $('#payTypesList').innerHTML = PAY_TYPES.map(([k, l, n]) => row(k, l, n)).join('') + custom.map(n => row(n, n, '', true)).join('')
    + '<button type="button" class="fr add" data-pt-add>Add payment type</button>';
}
function savePayTypes(patch) {
  state.settings.payments = { ...payTypes(), ...patch };
  return saveSettings();
}
const without = (o, k) => { const { [k]: _, ...rest } = o; return rest; };
// Add a payment type (owner 2026-10-15): its own page, a Name and Save; Save goes back to the list.
function addPayType() {
  if (payTypes().custom.length >= OWN_TYPES_MAX) return showToast(`${OWN_TYPES_MAX} is the most. Delete one first`);
  $('#payTypeAddForm').reset();
  $('#payTypeAddSave').disabled = true;   // greyed until there's a name (blind test 2026-10-23)
  showStPage('payTypeAddPage');
  $('#ptName').focus();
}
function savePayTypeAdd() {
  const name = fitName(typeName($('#ptName').value)), { custom } = payTypes();
  if (!name) return $('#ptName').focus();
  if (payNameTaken(name)) return showToast(`${name} is taken. Pick another name`);
  const { hidden } = payTypes(), full = payTypesOn() >= TYPES_ON_MAX;   // with the list full, a new one starts off
  savePayTypes({ custom: [...custom, name], hidden: full ? [...hidden, name] : hidden, ref: payTypes().ref.filter(n => n !== name), opts: without(payTypes().opts, name), qrCodes: without(payTypes().qrCodes, name) });   // a new one asks no ref, starts clean
  openPayTypes(true);
  if (full) addedOff(name);
}
// One type's page (owner 2026-10-22), the same rows for every type in checkout's order: Name (your own) + Show at checkout |
// Picture | Ask for › + Must fill in | Opens cash drawer | Delete (your own)
function openPayType(key) {
  ptOpen = key;
  showStPage('payTypePage');
  $('#ptTitle').textContent = PAY_TYPES.find(t => t[0] === key)?.[1] || key;
  $('#ptOn').checked = key === 'cash' || !payTypes().hidden.includes(key);
  $('#ptOn').disabled = key === 'cash';   // Cash is always on, as on the list
  // ponytail: built-ins keep their name (it is the sale's method word); only your own can be renamed
  $('#ptNameRow').hidden = $('#ptDelCard').hidden = !payTypes().custom.includes(key);
  $('#ptRename').value = key;
  $('#ptAskV').textContent = askNow(key);
  $('#ptMust').closest('.fr').hidden = $('#ptMustNote').hidden = askNow(key) === 'Nothing';   // nothing asked = nothing to fill in
  $('#qrPicIn').closest('.card').hidden = key === 'cash';   // Cash goes straight to its amounts: a picture would never show
  $('#ptMust').checked = opt(key).must;
  mustNote();
  $('#ptDrawer').checked = opt(key).drawer;
  qrRow();
}
// the note says what the switch does now
const mustNote = () => { $('#ptMustNote').textContent = $('#ptMust').checked ? 'On: the sale can’t finish until it’s filled in.' : 'Off: staff can skip it.'; };
// Picture: Add picture, or its thumb + Remove
function qrRow() {
  const pic = payTypes().qrCodes[ptOpen];
  $('#qrThumb').hidden = $('#qrRm').hidden = !pic;
  $('#qrAdd').hidden = !!pic;
  if (pic) $('#qrThumb').src = pic;
}
function setPic(k, pic) {
  const was = payTypes().qrCodes, rest = without(was, k);
  if (savePayTypes({ qrCodes: pic ? { ...rest, [k]: pic } : rest })) return;
  savePayTypes({ qrCodes: was });
  showToast('Picture too big to save. Try a smaller one');
}
// a photo or screenshot of the store's QR, made 600px at most so settings stay small: a photo as JPEG (~40 KB, PNG ~400 KB), a flat QR as PNG
function addPayPic(e) {
  const f = e.target.files[0], k = ptOpen;
  e.target.value = '';
  if (!f) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => {
    const s = Math.min(1, 600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // the card is white under it; JPEG would turn see-through black
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    const png = c.toDataURL('image/png'), jpg = c.toDataURL('image/jpeg', 0.85);
    setPic(k, jpg.length < png.length ? jpg : png);
    if (ptOpen === k) qrRow();
  };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('That file is not a picture'); };
  img.src = url;
}
function renderAsk() {
  const now = askNow(ptOpen);
  $$('#ptAskList input').forEach(r => { r.checked = r.value === now; });
}
// Rename your own type: every setting moves with it; past sales keep the name they were rung under
function renamePayType(e) {
  const from = ptOpen, name = fitName(typeName(e.target.value)), p = payTypes();
  const back = (msg) => { e.target.value = from; msg ? showToast(msg) : hideToast(); };   // no message: an earlier "taken" goes too
  if (!name || name === from) return back();
  if (payNameTaken(name, from)) return back(`${name} is taken. Pick another name`);
  const swap = (list) => list.map(n => (n === from ? name : n));
  const move = (o) => { const { [from]: v, ...rest } = o, clean = without(rest, name); return v === undefined ? clean : { ...clean, [name]: v }; };
  savePayTypes({ custom: swap(p.custom), hidden: swap(p.hidden), ref: swap(p.ref), opts: move(p.opts), qrCodes: move(p.qrCodes) });
  ptOpen = name;
  $('#ptTitle').textContent = e.target.value = name;
}
// Delete, like Settings › QR codes' Delete table: your own types only
function deletePayType() {
  const k = ptOpen, p = payTypes(), drop = (o) => without(o, k);
  showConfirm({ title: `Delete ${k}?`, message: 'Past sales keep the name.', okText: 'Delete', danger: true,
    onConfirm: () => {
      savePayTypes({ custom: p.custom.filter(n => n !== k), hidden: p.hidden.filter(n => n !== k), ref: p.ref.filter(n => n !== k), opts: drop(p.opts), qrCodes: drop(p.qrCodes) });
      openPayTypes(true);
      showDone(`${k} deleted`);
    } });
}
// a type's switch, from the list or its page; the cap turns a switch on back off
function setPayOn(k, input) {
  const { hidden } = payTypes();
  if (input.checked && payTypesOn() >= TYPES_ON_MAX) { input.checked = false; return tooMany(); }
  savePayTypes({ hidden: input.checked ? hidden.filter(h => h !== k) : [...hidden, k] });
}
function bindPayTypes() {
  $('#payTypeBack').addEventListener('click', () => openPayTypes(true));
  $('#ptOn').addEventListener('change', (e) => setPayOn(ptOpen, e.target));
  // Ask for: its own page, like Settings' other choices (#pickPage): Nothing or a preset; on/off stays in payments.ref
  $('#ptAskList').innerHTML = ['Nothing', ...ASKS].map(a => `<label class="pick"><input type="radio" name="ptAsk" value="${a}"><span class="tx">${a}</span></label>`).join('');
  $('#ptAskRow').addEventListener('click', () => { showStPage('ptAskPage'); renderAsk(); });
  $('#ptAskBack').addEventListener('click', () => openPayType(ptOpen));
  $('#ptAskList').addEventListener('change', (e) => {
    const v = e.target.value, ref = payTypes().ref.filter(r => r !== ptOpen);
    savePayTypes({ ref: v === 'Nothing' ? ref : [...ref, ptOpen] });
    if (v !== 'Nothing') setOpt({ ask: v });
    renderAsk();
  });
  [['ptMust', 'must'], ['ptDrawer', 'drawer']].forEach(([id, k]) => $('#' + id).addEventListener('change', (e) => setOpt({ [k]: e.target.checked })));
  $('#ptMust').addEventListener('change', mustNote);
  $('#ptRename').addEventListener('change', renamePayType);
  $('#ptRename').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#qrPicIn').addEventListener('change', addPayPic);
  $('#qrRm').addEventListener('click', (e) => { e.preventDefault(); setPic(ptOpen); qrRow(); });   // inside the row's label: not the file picker
  $('#ptDel').addEventListener('click', deletePayType);
  $('#posPayTypesRow')?.addEventListener('click', () => openPayTypes(true));
  $('#payTypesBack')?.addEventListener('click', () => openPayTypes(false));
  $('#payTypeAddBack').addEventListener('click', () => askLeave($('#ptName').value.trim(), () => openPayTypes(true)));   // a typed name asks first (owner 2026-10-22)
  $('#payTypeAddSave').addEventListener('click', savePayTypeAdd);
  $('#ptName').addEventListener('input', (e) => { $('#payTypeAddSave').disabled = !typeName(e.target.value); });
  $('#payTypeAddForm').addEventListener('submit', (e) => { e.preventDefault(); savePayTypeAdd(); });   // Return on the keyboard
  const list = $('#payTypesList');
  list?.addEventListener('change', (e) => {
    if (e.target.dataset.pt) setPayOn(e.target.dataset.pt, e.target);   // no re-render: the switch keeps focus
  });
  list?.addEventListener('click', (e) => {
    if (e.target.closest('[data-pt-add]')) return addPayType();
    const open = !e.target.closest('.sw') && e.target.closest('[data-pt-open]');
    if (open) { e.preventDefault(); openPayType(open.dataset.ptOpen); }   // the row opens its page; only the switch flips
  });
}

// Settings › Fulfilment types (owner 2026-10-16): Payment types' twin. A switch per type says if the sale offers it, and the
// store adds its own names. The primary is what a sale starts on: any type that's on, always on, so it has no switch or Delete.
// Your own types open a page (owner 2026-10-22): Show on the sale and a red Delete. ponytail: no rename (delete and add again).
const fulTypes = () => ({ hidden: [], custom: [], ...state.settings.fulfilment });
const fulPrimary = () => state.settings.defaultFulfilment || 'walkin';
function openFulTypes(open) {
  showStPage(open ? 'fulTypesPage' : 'settingsPage');
  if (open) renderFulTypes(); else renderPosSettings(false);
}
// The primary's choices = the types that are on (fulfilMethods); a switch redraws them.
function renderFulPrimary() {
  $('#fulPrimary').innerHTML = fulfilMethods(state.settings).map(m => `<option value="${escapeHtml(m.key)}"${m.key === fulPrimary() ? ' selected' : ''}>${escapeHtml(m.label)}</option>`).join('');
}
function renderFulTypes() {
  const { hidden, custom } = fulTypes(), primary = fulPrimary();
  const row = (key, label, mine) => {
    const main = key === primary, k = escapeHtml(key), l = escapeHtml(label);
    return `<label class="fr${mine ? ` qr-row" data-ft-open="${k}` : ''}" for="ft-${k}"><span class="lb">${l}</span><span class="v"><input type="checkbox" class="sw" id="ft-${k}" data-ft="${k}" aria-label="Show ${l} on the sale"${main || !hidden.includes(key) ? ' checked' : ''}${main ? ' disabled' : ''}>${mine ? `<button type="button" class="pt-go" aria-label="${l} settings">${QR_CHEV}</button>` : ''}</span></label>`;
  };
  $('#fulTypesList').innerHTML = FULFIL_BUILTINS.map(([k, l]) => row(k, l)).join('') + custom.map(n => row(n, n, true)).join('')
    + '<button type="button" class="fr add" data-ft-add>Add fulfilment type</button>';
  renderFulPrimary();
}
function saveFulTypes(patch) {
  state.settings.fulfilment = { ...fulTypes(), ...patch };
  saveSettings();
  renderFulRow();   // a type switched off or deleted must not stay picked on the open cart
}
function addFulType() {
  if (fulTypes().custom.length >= OWN_TYPES_MAX) return showToast(`${OWN_TYPES_MAX} is the most. Delete one first`);
  $('#fulTypeAddForm').reset();
  showStPage('fulTypeAddPage');
  $('#ftName').focus();
}
function saveFulTypeAdd() {
  const name = typeName($('#ftName').value), { custom } = fulTypes();
  if (!name) return $('#ftName').focus();
  // the name is saved as the sale's fulfilment, so a built-in's key or word is taken too
  if ([...FULFIL_BUILTINS.flatMap(([k, l]) => [k, l]), ...custom].some(n => n.toLowerCase() === name.toLowerCase())) return showToast(`${name} is taken. Pick another name`);
  const { hidden } = fulTypes(), full = fulfilMethods(state.settings).length >= TYPES_ON_MAX;   // with the list full, a new one starts off
  saveFulTypes({ custom: [...custom, name], hidden: full ? [...hidden, name] : hidden });
  openFulTypes(true);
  if (full) addedOff(name);
}
let ftOpen = '';
function openFtType(key) {
  ftOpen = key;
  showStPage('ftTypePage');
  const main = key === fulPrimary();
  $('#ftTitle').textContent = key;
  $('#ftOn').checked = main || !fulTypes().hidden.includes(key);
  $('#ftOn').disabled = main;
  $('#ftDelCard').hidden = main;   // what sales start on can't go; pick another Primary first
}
function bindFulTypes() {
  $('#posFulTypesRow').addEventListener('click', () => openFulTypes(true));
  $('#fulTypesBack').addEventListener('click', () => openFulTypes(false));
  $('#fulTypeAddBack').addEventListener('click', () => askLeave($('#ftName').value.trim(), () => openFulTypes(true)));   // as Payment types'
  $('#fulTypeAddSave').addEventListener('click', saveFulTypeAdd);
  $('#fulTypeAddForm').addEventListener('submit', (e) => { e.preventDefault(); saveFulTypeAdd(); });   // Return on the keyboard
  $('#fulPrimary').addEventListener('change', (e) => { state.settings.defaultFulfilment = e.target.value; saveSettings(); renderFulTypes(); });
  const list = $('#fulTypesList');
  list.addEventListener('change', (e) => {
    const k = e.target.dataset.ft, { hidden } = fulTypes();
    if (k && e.target.checked && fulfilMethods(state.settings).length >= TYPES_ON_MAX) { e.target.checked = false; return tooMany(); }
    if (k) { saveFulTypes({ hidden: e.target.checked ? hidden.filter(h => h !== k) : [...hidden, k] }); renderFulPrimary(); }   // the list stays: the switch keeps focus
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-ft-add]')) return addFulType();
    const open = !e.target.closest('.sw') && e.target.closest('[data-ft-open]');
    if (open) { e.preventDefault(); openFtType(open.dataset.ftOpen); }   // the row opens its page; only the switch flips
  });
  $('#ftTypeBack').addEventListener('click', () => openFulTypes(true));
  $('#ftOn').addEventListener('change', (e) => {
    const { hidden } = fulTypes();
    if (e.target.checked && fulfilMethods(state.settings).length >= TYPES_ON_MAX) { e.target.checked = false; return tooMany(); }
    saveFulTypes({ hidden: e.target.checked ? hidden.filter(h => h !== ftOpen) : [...hidden, ftOpen] });
  });
  $('#ftDel').addEventListener('click', () => {
    const k = ftOpen, f = fulTypes();
    showConfirm({ title: `Delete ${k}?`, message: 'Past sales keep the name.', okText: 'Delete', danger: true,
      onConfirm: () => {
        saveFulTypes({ custom: f.custom.filter(n => n !== k), hidden: f.hidden.filter(n => n !== k) });
        openFulTypes(true);
        showDone(`${k} deleted`);
      } });
  });
}

// Log out of the account (owner 2026-10-13): front end only for now, the sign-in page is a placeholder until accounts exist.
// ponytail: nothing is signed out or remembered; Sign in returns to the POS (its PIN screen once PINs are set up).
// While it's up the POS behind is inert, like the PIN screen's pinCover: no Tab, tap or scanner reaches it.
function signInCover(on) {
  $$('#app > :not(#signInScreen):not(.toast)').forEach(el => { el.inert = on; });
  $('#signInScreen').hidden = !on;
  if (on) { $('#signInForm').reset(); $('#signInForm .si-in').focus(); }
}
function logOut() {
  showConfirm({ title: 'Log out of this POS?', message: 'Signing back in needs the account’s email and password.', okText: 'Log out',
    onConfirm: () => signInCover(true) });
}

function applyTheme(theme) {
  state.theme = theme;
  storageSet(STORAGE_THEME, theme);
  paintTheme();
}
// System (owner 2026-10-15) follows the device's light or dark mode, and changes with it.
const sysLight = matchMedia('(prefers-color-scheme: light)');
function paintTheme() { document.body.classList.toggle('light-theme', state.theme === 'light' || (state.theme === 'system' && sysLight.matches)); }
sysLight.addEventListener('change', paintTheme);

function persistPosSettings() {
  state.settings.printing = {
    ...printerConfig(),
    printOnSale: !!$('#posPrintOnSale')?.checked,
    cut: !!$('#posPrintCut')?.checked,
    mapOnReceipt: !!$('#posPrintMap')?.checked,
    netUrl: ($('#posPrinterIp')?.value || '').trim(),
  };
  // No churn box on the till today: without this guard every printer save reset the back office's days to 30.
  const churn = $('#posChurnDays');
  if (churn) state.settings.churnThresholdDays = Math.max(1, parseInt(churn.value || '30', 10) || 30);
  // The store's clock (SalesMath.storeZone): days, bands and reports all turn over in this zone.
  const zone = $('#posTimeZone')?.value;
  if (zone) state.settings.store = { ...state.settings.store, timeZone: zone };
  saveSettings();
}

// The drawer for THIS register on one store day (the store's clock, not the browser's): cash taken,
// less cash handed back over the counter (a void or refund row pays out the way the sale came in, on
// the day it happens). The closeout screen was removed on purpose; ponytail: kept only because
// customer-ledger-check and till-run call it as the till's own cash count.
function buildCashDrawerSummary(date = new Date()) {
  const z = tillZone(), key = tillDay(+date);
  const d = drawerCash(SalesMath.dayStartMs(key, z), SalesMath.dayStartMs(SalesMath.addDays(key, 1), z));
  return {
    date: key,
    expectedCash: moneyValue(unc(cent(d.sales) - cent(d.back) + cent(d.onAccount))),
    cashSales: d.rows.filter(o => SalesMath.isSale(o) && (o.payments || []).some(p => p.method === 'cash' && p.amount > 0)).length,
    adjustments: d.rows.filter(SalesMath.isReversal).length,
  };
}

// A register's cash over [from, to), or the whole store's (reg null: every POS, the one drawer a shift counts) --
// the one sum the day count above and the shift (pos-shift.js) both read: cash taken on sales, cash handed back
// (a void or refund row pays out the way the sale came in), and cash paid on account at a POS (customers bug 9;
// a back-office payment has no register). Pesos, unsigned.
function drawerCash(from, to = Infinity, reg = String(currentStoreInfo().registerNo)) {
  const here = r => (reg === null ? r.register != null : String(r.register) === reg);
  const rows = loadOrders().filter(o => here(o) && o.ts >= from && o.ts < to);
  const cash = list => SalesMath.tenders(list).get('cash') || 0;
  const ledger = loadCustomerLedger(), undone = undoneIds(ledger);
  const onAccount = ledger.filter(r => r.type === 'payment' && r.method === 'cash' && here(r) && !undone.has(r.id)
    && SalesMath.tsOf(r) >= from && SalesMath.tsOf(r) < to).reduce((n, r) => n + cent(r.amount), 0);
  return { rows, sales: cash(rows.filter(SalesMath.isSale)), back: -cash(rows.filter(SalesMath.isReversal)) || 0, onAccount: unc(onAccount) };
}

