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
  // Photo fills is the only photo tile (owner 2026-10-29: Photo top went); the List calls it On
  tilePics: { get opts() { return [['off', 'Off'], ['fill', state.sellLayout === 'grid' ? 'Photo fills' : 'On']]; }, now: () => state.tilePics, set: setTilePics },
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
// The list opens on its groups (owner 2026-11-04, iPhone Settings): a group's row shows only that group's card under
// its name, ‹ in place of ☰. '' = the groups. A choice's ticks and Payment types come back to the open group.
function openSec(sec) {
  $('#setTitle').textContent = sec ? $(`#settingsView [data-sec="${sec}"] .lb`).textContent : 'Settings';
  $$('#settingsView [data-sec-of]').forEach(c => { c.hidden = c.dataset.secOf !== sec; });
  $$('#settingsView .st-home').forEach(c => { c.hidden = !!sec; });
  $('#setSecBack').hidden = !sec;
  $('#settingsPage [data-act="open-sidebar"]').hidden = !!sec;
  $('#settingsView').scrollTop = 0;
}
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
  const k = ptOpen;
  shrinkPic(e, (pic) => { setPic(k, pic); if (ptOpen === k) qrRow(); });
}
// a picked file -> a small data URL (Payment types' picture, Settings › Receipt's logo and footer picture)
function shrinkPic(e, done) {
  const f = e.target.files[0];
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
    done(jpg.length < png.length ? jpg : png);
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
// Settings › Store › Store details (owner 2026-11-06): name, address, phone and TIN, the receipt's top lines. The same
// settings.store the back office edits. ponytail: no manager PIN, as Payment types; add one if a store asks.
// Up to 3 phone numbers (owner 2026-11-06), kept in the one phone field as "a / b" so the receipt, the printer and
// the back office read them unchanged. ponytail: a joined string; a list when a number needs a label of its own.
const STORE_KEYS = ['name', 'address', 'phone', 'tin'], PHONES_MAX = 3, PHONE_SEP = ' / ';
const phoneInputs = () => [...$('#storeForm').querySelectorAll('[name=phone]')];
const storeTyped = () => ({ ...Object.fromEntries(['name', 'address', 'tin'].map(k => [k, $('#storeForm').elements[k].value.trim()])),
  phone: phoneInputs().map(i => i.value.trim()).filter(Boolean).join(PHONE_SEP) });
const storeChanged = () => STORE_KEYS.some(k => storeTyped()[k] !== (currentStoreInfo()[k] || ''));
function addPhoneRow(value = '') {
  const rows = phoneInputs(), row = rows[0].closest('.fr').cloneNode(true), input = row.querySelector('input');
  input.value = value;
  rows[rows.length - 1].closest('.fr').after(row);
  $('#storeAddPhone').hidden = rows.length + 1 >= PHONES_MAX;
  return input;
}
function openStore() {
  const f = $('#storeForm'), s = currentStoreInfo(), [first = '', ...more] = (s.phone || '').split(PHONE_SEP);
  phoneInputs().slice(1).forEach(i => i.closest('.fr').remove());
  ['name', 'address', 'tin'].forEach(k => { f.elements[k].value = s[k] || ''; });
  phoneInputs()[0].value = first;
  $('#storeAddPhone').hidden = false;
  more.slice(0, PHONES_MAX - 1).forEach(n => addPhoneRow(n));
  $('#storeSave').disabled = true;   // greyed until something changed, as Add payment type
  showStPage('storePage');
}
function saveStore() {
  const v = storeTyped();
  if (!v.name) return $('#storeForm').elements.name.focus();   // a receipt needs a name; the rest may be blank
  state.settings.store = { ...state.settings.store, ...v };
  saveSettings();
  renderRoleSwitcher();   // the side menu's store name
  openPayTypes(false);
  showToast('Saved');
}
function bindStore() {
  $('#posStoreRow').addEventListener('click', openStore);
  $('#storeBack').addEventListener('click', () => askLeave(storeChanged(), () => openPayTypes(false)));
  $('#storeAddPhone').addEventListener('click', () => addPhoneRow().focus());
  $('#storeForm').addEventListener('input', () => { $('#storeSave').disabled = !storeTyped().name || !storeChanged(); });
  // Save is the form's submit button (form="storeForm"): Return on the keyboard saves, and does nothing while it is greyed
  $('#storeForm').addEventListener('submit', (e) => { e.preventDefault(); saveStore(); });
}
// Settings › Receipt (owner 2026-11-06): the style (Classic, Modern), what the last line says (Receipt says), a top and a bottom
// picture (the logo; the store's QR or art), header and footer words, and whether the name, address and phone show. Preview opens the Test print's sample in a sheet (receiptLook in pos-core.js).
// Each change saves as it is made, as a payment type's page. ponytail: no manager PIN, as Store details.
const LOOK_PICS = { logo: '#rcLogoThumb', footerImg: '#rcFootThumb' };   // one Pictures row shows both (owner 2026-11-08); Remove is on the Pictures page
function saveLook(patch) {
  const was = state.settings.receipt;
  state.settings.receipt = { ...was, ...patch };
  if (saveSettings()) { renderLook(); return true; }
  state.settings.receipt = was;
  showToast('Picture too big to save. Try a smaller one');
  return false;
}
function renderLook() {
  const look = receiptLook();
  Object.entries(LOOK_PICS).forEach(([k, thumb]) => {
    $(thumb).hidden = !look[k];
    if (look[k]) $(thumb).src = look[k];
  });
  $('#rcPicsAdd').hidden = !!(look.logo || look.footerImg);
}
function openLook() {
  const look = receiptLook();
  $('#rcStyle').value = look.style;
  $('#rcSays').value = look.says;
  $('#rcName').checked = look.showName;
  $('#rcAddress').checked = look.showAddress;
  $('#rcPhone').checked = look.showPhone;
  $('#rcTin').checked = look.showTin;
  $('#rcHeader').value = look.header;
  $('#rcFooter').value = look.footer;
  renderLook();
  showStPage('receiptPage');
}
function bindLook() {
  $('#posReceiptRow').addEventListener('click', openLook);
  $('#receiptBack').addEventListener('click', () => openPayTypes(false));
  $('#rcPreviewRow').addEventListener('click', (e) => openSheet(e.currentTarget, `<div class="fs-top">
    <button type="button" class="fs-x cta-2" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg></button>
    <h2 id="fsTitle">Preview</h2><i></i></div><div class="fs-body">${buildReceiptPreview(sampleTestOrder())}</div>`, 'rc-sheet'));
  $('#rcStyle').addEventListener('change', (e) => saveLook({ style: e.target.value }));   // Classic or Modern (receipt.css)
  $('#rcSays').addEventListener('change', (e) => saveLook({ says: e.target.value }));   // Invoice # and 'This serves as your invoice.' once BIR registered
  $('#rcName').addEventListener('change', (e) => saveLook({ showName: e.target.checked }));   // off when the logo already has the name
  $('#rcAddress').addEventListener('change', (e) => saveLook({ showAddress: e.target.checked }));
  $('#rcPhone').addEventListener('change', (e) => saveLook({ showPhone: e.target.checked }));
  $('#rcTin').addEventListener('change', (e) => saveLook({ showTin: e.target.checked }));   // not every store has a TIN (owner 2026-11-06)
  $('#rcHeader').addEventListener('input', (e) => saveLook({ header: e.target.value }));
  $('#rcFooter').addEventListener('input', (e) => saveLook({ footer: e.target.value }));
  $('#rcPicsRow').addEventListener('click', (e) => openPics(e.currentTarget, 'logo'));   // the receipt, the top box picked
  $('#rcPicsRow').addEventListener('keydown', (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.currentTarget.click(); } });   // a div, not a label: no file input in it
}
// Settings › Receipt › Top / Bottom picture (owner 2026-11-06, "canvas amount of control"): the receipt itself with two boxes, top and
// bottom. Tap one to pick it, drag its bottom corners to size it inside the paper's margins, tap it again to add the picture: it goes
// through the crop screen into the box drawn, keeping its own shape; then the corners crop it, a drag or a pinch moves it, Crop crops it again. One ink: anything that
// isn't white is solid black, on screen as on paper (owner: "the darkest one", no grey). Each change saves as it is made, as the page.
// logo / footerImg is the box baked at 80mm's 576 dots (a 58mm POS prints it at 2/3, printer.js picRaster); logoFit / footerImgFit
// keep the box (w, h: shares of the paper's width), the crop (zoom, cx, cy) and the original (src), so it can be changed again.
const PIC_DOTS = 576, PIC_INK = 224;   // lighter than this is the paper
const PIC_BOX = { logo: { w: 0.6, h: 0.3 }, footerImg: { w: 0.6, h: 0.6 } };   // an empty box: printer.js RECEIPT_PICS
const BLANK_PIC = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
// the picture covers its box at zoom 1; (cx, cy) is its point at the box's centre, kept so no white edge shows
function clampFit(img, f) {
  const r = f.w / f.h, s = Math.max(r / img.width, 1 / img.height) * f.zoom;
  const hw = r / 2 / (img.width * s), hh = 1 / 2 / (img.height * s);
  f.cx = Math.min(1 - hw, Math.max(hw, f.cx));
  f.cy = Math.min(1 - hh, Math.max(hh, f.cy));
}
// the box at w x h px with its crop of the picture, in the one ink
function drawFit(cv, img, f, w, h) {
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true }), s = Math.max(w / img.width, h / img.height) * f.zoom;
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.drawImage(img, w / 2 - f.cx * img.width * s, h / 2 - f.cy * img.height * s, img.width * s, img.height * s);
  const px = g.getImageData(0, 0, w, h), d = px.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < PIC_INK ? 17 : 255;
  g.putImageData(px, 0, 0);
  return cv;
}
// anything in the picture prints at all (a pale one is all paper)
const inked = (img) => drawFit(document.createElement('canvas'), img, { zoom: 1, cx: 0.5, cy: 0.5 }, img.width, img.height)
  .getContext('2d').getImageData(0, 0, img.width, img.height).data.includes(17);
function openPics(btn, pick) {
  const look = receiptLook(), r = toReceiptViewModel(sampleTestOrder()), fits = {}, imgs = {}, boxes = {};
  r.look.logo = r.look.footerImg = BLANK_PIC;   // a stand-in, so the receipt lays out each picture's place; its box goes there
  const { m } = openSheet(btn, `<div class="fs-top">
    <button type="button" class="fs-x cta-2" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg></button>
    <h2 id="fsTitle">Pictures</h2><i></i></div><div class="fs-body"><div class="receipt-preview"><div class="rp-paper">${receiptBody(r)}</div></div>
    <input type="file" accept="image/*" hidden></div>
    <div class="pic-bar" hidden><button type="button" class="cta-2" data-act="add" aria-label="Replace picture"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-photo"/></svg></button><button type="button" class="cta-2 crop" data-act="crop"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-crop"/></svg>Crop</button><button type="button" class="cta-2" data-act="rm" aria-label="Remove picture"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"/></svg></button></div>`, 'rc-sheet');
  const rcpt = m.querySelector('.rcpt'), input = m.querySelector('input[type=file]'), bar = m.querySelector('.pic-bar');
  m.querySelectorAll('.rcpt img.pic').forEach((el) => {
    const k = el.classList.contains('foot') ? 'footerImg' : 'logo', box = document.createElement('div');
    box.className = k === 'logo' ? 'pbox' : 'pbox foot';
    box.innerHTML = '<canvas></canvas><span>Add picture</span><i class="pb-l"></i><i class="pb-r"></i>';
    el.replaceWith(box);
    boxes[k] = box;
    fits[k] = { ...PIC_BOX[k], zoom: 1, cx: 0.5, cy: 0.5, ...look[k + 'Fit'] };
  });
  let sel = pick, queued = false;
  const paint = () => {
    queued = false;
    Object.entries(boxes).forEach(([k, box]) => {
      const f = fits[k], img = imgs[k];
      box.style.width = f.w * 100 + 'cqw'; box.style.height = f.h * 100 + 'cqw';
      box.classList.toggle('on', k === sel);
      box.classList.toggle('has', !!img);
      if (!img) return;
      clampFit(img, f);
      const dpr = devicePixelRatio || 1;
      drawFit(box.firstChild, img, f, Math.round(box.clientWidth * dpr), Math.round(box.clientHeight * dpr));
    });
    bar.hidden = !imgs[sel];
  };
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  const save = (k) => {
    const f = fits[k], img = imgs[k];
    if (!img) return saveLook({ [k + 'Fit']: { ...f } });   // an empty box keeps its size for the picture to come
    const cv = drawFit(document.createElement('canvas'), img, f, Math.round(f.w * PIC_DOTS), Math.round(f.h * PIC_DOTS));
    return saveLook({ [k]: cv.toDataURL('image/png'), [k + 'Fit']: { ...f } });   // PNG: one ink stays one ink (JPEG would grey its edges)
  };
  // not saved (the phone is full; saveLook says so): the box goes back to what is saved
  const undo = (k, was, img) => { fits[k] = was; imgs[k] = img; paint(); };
  const shape = (f, ar) => { if (ar > f.w / f.h) f.h = f.w / ar; else f.w = f.h * ar; };   // inside the box drawn, in the picture's shape
  // a saved picture in its box (one fitted before the boxes takes the box in its own shape)
  const loading = new Set();   // a tap on a box still loading its picture isn't a tap on an empty box
  const load = (k, src) => {
    const img = new Image();
    loading.add(k);
    img.onload = () => {
      loading.delete(k);
      imgs[k] = img;
      if (!look[k + 'Fit']?.h) shape(fits[k], img.width / img.height);
      if (src === look[k]) Object.assign(fits[k], { zoom: 1, cx: 0.5, cy: 0.5 });   // no original kept: the baked box is the picture
      paint();
    };
    img.onerror = () => loading.delete(k);   // a broken saved picture: the box takes a new one
    img.src = src;
  };
  Object.keys(boxes).forEach((k) => { const src = fits[k].src || look[k]; if (src) load(k, src); });
  // the part kept on the crop screen (shares of the picture) into box k: a new picture takes the box drawn, a cropped-again one keeps
  // its width; the box shows the part, zoomed in
  const place = (k, img, c, fresh) => {
    const f = fits[k], ar = c.w * img.width / (c.h * img.height), was = { ...f }, old = imgs[k];
    if (fresh) shape(f, ar);
    else { f.h = f.w / ar; if (f.h > 1) { f.h = 1; f.w = ar; } }
    f.w = Math.max(0.1, f.w); f.h = Math.max(0.05, f.h);
    const W = f.w / f.h, s = Math.max(W / (c.w * img.width), 1 / (c.h * img.height));
    Object.assign(f, { src: img.src, zoom: Math.max(1, s / Math.max(W / img.width, 1 / img.height)), cx: c.x + c.w / 2, cy: c.y + c.h / 2 });
    imgs[k] = img;
    clampFit(img, f);
    if (!save(k)) return undo(k, was, old);
    paint();
  };
  // what box k shows now, as shares of its picture: where Crop starts
  const shown = (k) => {
    const f = fits[k], img = imgs[k], W = f.w / f.h, s = Math.max(W / img.width, 1 / img.height) * f.zoom, w = W / s / img.width, h = 1 / s / img.height;
    return { x: f.cx - w / 2, y: f.cy - h / 2, w, h };
  };
  paint();
  requestAnimationFrame(() => boxes[pick].scrollIntoView({ block: 'center' }));
  let adding = sel;
  const add = () => { adding = sel; input.click(); };
  // a new picture goes through the crop screen first; its ✕ adds nothing (a Replace keeps the old one)
  input.addEventListener('change', (e) => shrinkPic(e, (pic) => {
    const k = adding, img = new Image();
    img.onerror = () => showToast('That file is not a picture');
    img.onload = () => inked(img) ? openCrop(boxes[k], img, { x: 0, y: 0, w: 1, h: 1 }, true, (c) => place(k, img, c, true)) : showToast('Too light to print. Try a darker picture');
    img.src = pic;
  }));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'), k = sel;
    if (!b || !imgs[k]) return;
    if (b.dataset.act === 'add') add();
    if (b.dataset.act === 'crop') openCrop(b, imgs[k], shown(k), false, (c) => place(k, imgs[k], c, false));
    if (b.dataset.act === 'rm') showConfirm({ title: `Remove the ${k === 'logo' ? 'top' : 'bottom'} picture?`, message: 'The box stays for another one.', okText: 'Remove', onConfirm: () => {
      const { src, ...box } = fits[k];
      if (!saveLook({ [k]: '', [k + 'Fit']: box })) return;
      fits[k] = box;
      imgs[k] = null;
      paint();
    } });
  });
  // a tap picks a box (then adds to an empty one), a corner sizes it, one finger moves the picture in it, two pinch it
  const fingers = new Map();
  let g = null;
  rcpt.addEventListener('pointerdown', (e) => {
    const box = e.target.closest('.pbox'), k = Object.keys(boxes).find(n => boxes[n] === box);
    if (!k) return;
    box.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 1) g = { k, corner: e.target.tagName === 'I', x: e.clientX, y: e.clientY, h: fits[k].h, was: { ...fits[k] }, moved: false, pinch: 0 };
  });
  rcpt.addEventListener('pointermove', (e) => {
    const at = fingers.get(e.pointerId);
    if (!at || !g || g.k !== sel) return;   // only the picked box changes
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > 6 || fingers.size > 1) g.moved = true;
    if (!g.moved) return;
    const f = fits[g.k], img = imgs[g.k], { left, width } = rcpt.getBoundingClientRect();
    if (g.corner) {   // the width both ways from the paper's middle (it prints centred), the height from its top
      f.w = Math.min(1, Math.max(0.1, 2 * Math.abs(e.clientX - left - width / 2) / width));
      f.h = Math.min(1, Math.max(0.05, g.h + (e.clientY - g.y) / width));   // never taller than the paper is wide
    } else if (!img) return;
    else if (fingers.size === 1) {
      const s = Math.max(f.w / img.width, f.h / img.height) * width * f.zoom;
      f.cx -= (e.clientX - at[0]) / (img.width * s);
      f.cy -= (e.clientY - at[1]) / (img.height * s);
    } else {
      const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (g.pinch) f.zoom = Math.min(8, Math.max(1, f.zoom * d / g.pinch));   // 8: Crop's smallest part
      g.pinch = d;
    }
    redraw();
  });
  const lift = (e) => {
    fingers.delete(e.pointerId);
    if (!g) return;
    if (fingers.size) { g.pinch = 0; return; }
    const { k, moved, was } = g;
    g = null;
    if (moved) return k === sel && !save(k) && undo(k, was, imgs[k]);
    if (e.type === 'pointercancel') return;
    if (k !== sel) { sel = k; paint(); } else if (!imgs[k] && !loading.has(k)) add();
  };
  rcpt.addEventListener('pointerup', lift);
  rcpt.addEventListener('pointercancel', lift);
  rcpt.addEventListener('click', (e) => { if (!e.target.closest('.pbox') && sel) { sel = null; paint(); } });   // the paper lets go
}
// The crop screen (owner 2026-11-06, Photos' crop): the whole picture in its ink, the part kept in a frame, the rest dimmed. Drag a corner
// to size the frame, inside it to move it; ✓ keeps it (lit once something changed, unless the picture is new), ✕ changes nothing.
function openCrop(btn, img, was, fresh, done) {
  const c = { ...was }, start = JSON.stringify(c), MIN = 0.125, PAD = 14;   // MIN: an eighth of each side, so the box zooms 8x at most; PAD: the dots' room
  const { m, close } = openSheet(btn, `<div class="fs-top">
    <button type="button" class="fs-x cta-2" aria-label="Cancel"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg></button>
    <h2>Crop</h2>
    <button type="button" class="fs-ok cta" aria-label="Done"${fresh ? '' : ' disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg></button>
    </div><div class="fs-body"><canvas class="crop-stage" aria-label="The picture: drag the frame's corners over the part to keep"></canvas></div>`, 'crop-sheet');
  m.removeAttribute('aria-labelledby');   // the Pictures sheet under it owns #fsTitle
  m.setAttribute('aria-label', 'Crop');
  const cv = m.querySelector('.crop-stage'), ok = m.querySelector('.fs-ok'), ink = drawFit(document.createElement('canvas'), img, { zoom: 1, cx: 0.5, cy: 0.5 }, img.width, img.height);
  const u = Math.min((cv.clientWidth - 2 * PAD) / img.width, Math.max(160, innerHeight - 260) / img.height), pw = img.width * u, ph = img.height * u, dpr = devicePixelRatio || 1;
  const mw = Math.min(1, Math.max(MIN, 44 / pw)), mh = Math.min(1, Math.max(MIN, 44 / ph));   // and never under a finger's 44px, so the frame can still be grabbed
  cv.style.width = pw + 2 * PAD + 'px'; cv.style.height = ph + 2 * PAD + 'px';
  cv.width = Math.round((pw + 2 * PAD) * dpr); cv.height = Math.round((ph + 2 * PAD) * dpr);
  const g = cv.getContext('2d'), cta = getComputedStyle(m).getPropertyValue('--cta-solid').trim();
  const corner = (i, j) => [PAD + (c.x + i * c.w) * pw, PAD + (c.y + j * c.h) * ph];
  const paint = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, pw + 2 * PAD, ph + 2 * PAD);
    g.drawImage(ink, PAD, PAD, pw, ph);
    const [x, y] = corner(0, 0);
    g.fillStyle = 'rgba(0,0,0,.45)';   // what's cut off, dimmed
    g.beginPath(); g.rect(PAD, PAD, pw, ph); g.rect(x, y, c.w * pw, c.h * ph); g.fill('evenodd');
    g.strokeStyle = cta; g.lineWidth = 2;
    g.strokeRect(x, y, c.w * pw, c.h * ph);
    g.fillStyle = '#fff';   // the corner dots, as the box's
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { g.beginPath(); g.arc(...corner(i, j), 7, 0, 7); g.fill(); g.stroke(); }
    ok.disabled = !fresh && JSON.stringify(c) === start;
  };
  paint();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    if (drag) return;   // one finger at a time: a second one doesn't move the frame
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const [d, ...at] = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => { const [cx, cy] = corner(i, j); return [Math.hypot(cx - x, cy - y), i, j]; }).sort((p, q) => p[0] - q[0])[0];   // the nearest corner
    const [x0, y0] = corner(0, 0), inside = x > x0 && y > y0 && x < x0 + c.w * pw && y < y0 + c.h * ph;
    if (d >= 26 && !inside) return;
    cv.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, at: d < 26 && at, x: e.clientX, y: e.clientY, s: { ...c } };
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    const dx = (e.clientX - drag.x) / pw, dy = (e.clientY - drag.y) / ph, s = drag.s;
    if (!drag.at) { c.x = clamp(s.x + dx, 0, 1 - s.w); c.y = clamp(s.y + dy, 0, 1 - s.h); return paint(); }
    const [i, j] = drag.at;   // the opposite corner stays put
    if (i) c.w = clamp(s.w + dx, Math.min(mw, s.w), 1 - s.x);
    else { c.x = clamp(s.x + dx, 0, s.x + s.w - Math.min(mw, s.w)); c.w = s.x + s.w - c.x; }
    if (j) c.h = clamp(s.h + dy, Math.min(mh, s.h), 1 - s.y);
    else { c.y = clamp(s.y + dy, 0, s.y + s.h - Math.min(mh, s.h)); c.h = s.y + s.h - c.y; }
    paint();
  });
  const lift = (e) => { if (drag?.id === e.pointerId) drag = null; };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  ok.addEventListener('click', () => { done({ ...c }); close(); });
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

