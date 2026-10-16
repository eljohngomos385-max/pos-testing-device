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
  tilePics: { opts: [['off', 'Off'], ['top', 'Photo top'], ['fill', 'Photo fills']], now: () => state.tilePics, set: setTilePics },
  cartPics: { opts: [['off', 'Off'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], now: () => state.cartPics, set: setCartPics },
  theme: { opts: [['dark', 'Dark'], ['light', 'Light'], ['system', 'System']], now: () => state.theme || 'dark', set: applyTheme },
  driver: { opts: [['browser', 'Browser'], ['network', 'Wi-Fi'], ['bluetooth', 'Bluetooth']], now: () => printerConfig().driver || 'browser', set: v => savePrinting({ driver: v }) },
  width: { opts: [['58mm', '58 mm'], ['80mm', '80 mm']], now: () => printerConfig().width || '80mm', set: v => savePrinting({ width: v }) },
  discountLimit: { opts: [10, 15, 20, 25, 30, 50].map(n => [n, `${n}%`]).concat([[null, 'Never ask']]), now: () => loadTillPerms().discountLimit, set: setDiscountLimit },
  refundPin: { opts: [['ask', 'Ask a manager'], ['any', 'Anyone can']], now: () => roleCan('cashier', 'refund') ? 'any' : 'ask', set: setRefundPin },
  startCash: { opts: [['ask', 'Ask every shift'], ['float', 'Keep a float']], now: () => state.settings.startCash, set: v => setShiftPick({ startCash: v }) },
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
// ponytail: no manager PIN to change these, and no rename (delete and add again); add both if a store asks.
// Caps for both pages: TYPES_ON_MAX / OWN_TYPES_MAX (bo-model.js). Past 7 the sale's list scrolls on a phone, tolerated.
const tooMany = () => showToast(`${TYPES_ON_MAX} can be on at once. Turn one off first`);
// Delete (owner 2026-10-16, Quick stock's way): the trash top right lets you tick your own types, the bar at the bottom
// deletes them after one confirm, and Back turns into × to leave ticking. Built-ins and the primary fulfilment type can't be ticked;
// with none to tick there's no trash.
const TRASH_IC = '<svg class="ic" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>';
const BACK_IC = '<svg class="ic" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>';
const CLOSE_IC = '<svg class="ic" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const TYPE_KINDS = {
  pt: { get: () => payTypes(), save: (p) => savePayTypes(p), render: () => renderPayTypes(), page: 'payTypesPage', word: 'payment type' },
  ft: { get: () => fulTypes(), save: (p) => saveFulTypes(p), render: () => renderFulTypes(), page: 'fulTypesPage', word: 'fulfilment type' },
};
const tickBtn = (k, l) => `<button type="button" class="ty-tick" data-del="${k}" aria-label="Select ${l}" aria-pressed="false"></button>`;
// after each render (on = keep ticking); opening the page starts it off
function syncTypeEdit(kind, on) {
  const page = $(`#${TYPE_KINDS[kind].page}`), btn = page.querySelector('.ty-edit-btn'), back = page.querySelector('.back'), any = !!page.querySelector('[data-del]');
  on = on && any;
  page.classList.toggle('ty-edit', on);
  btn.hidden = !any || on;   // ticking: the trash steps aside, Back becomes the ×
  btn.innerHTML = TRASH_IC;
  btn.title = 'Delete';
  btn.setAttribute('aria-label', 'Delete');
  back.innerHTML = on ? CLOSE_IC : BACK_IC;
  back.title = on ? 'Cancel' : 'Back';
  back.setAttribute('aria-label', on ? 'Cancel delete' : 'Back to settings');
  if (!on) page.querySelectorAll('[data-del]').forEach(t => t.setAttribute('aria-pressed', 'false'));
  typeBar(page);
}
// the bar under the list: N selected · Delete
function typeBar(page) {
  const n = page.querySelectorAll('[data-del][aria-pressed="true"]').length, go = page.querySelector('.ty-go');
  page.querySelector('.ty-bar').hidden = !page.classList.contains('ty-edit');
  go.disabled = !n;
  go.innerHTML = n ? `<span>${n} selected</span><span>Delete</span>` : '<span>Tap the ones to delete</span>';
}
function bindTypeEdit(kind) {
  const K = TYPE_KINDS[kind], page = $(`#${K.page}`);
  page.querySelector('.ty-edit-btn').addEventListener('click', () => syncTypeEdit(kind, true));
  // while ticking, Back's × only leaves ticking (capture: before Back's own handler)
  page.addEventListener('click', (e) => {
    if (!page.classList.contains('ty-edit') || !e.target.closest('.back')) return;
    e.stopPropagation();
    syncTypeEdit(kind, false);
  }, true);
  page.addEventListener('click', (e) => {
    const row = e.target.closest('label.fr');
    if (!row || !page.classList.contains('ty-edit')) return;
    e.preventDefault();   // ticking: a tap on the row ticks it, never flips its switch
    const t = row.querySelector('[data-del]');
    if (t) { t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true'); typeBar(page); }
  });
  page.querySelector('.ty-go').addEventListener('click', () => {
    const names = [...page.querySelectorAll('[data-del][aria-pressed="true"]')].map(t => t.dataset.del);
    showConfirm({ title: names.length === 1 ? `Delete ${names[0]}?` : `Delete ${names.length} ${K.word}s?`, message: 'Past sales keep the name.', okText: 'Delete', danger: true,
      onConfirm: () => {
        const { hidden, custom } = K.get();
        K.save({ hidden: hidden.filter(h => !names.includes(h)), custom: custom.filter(n => !names.includes(n)) });
        page.classList.remove('ty-edit');
        K.render();
      } });
  });
}
const addedOff = (name) => showToast(`${name} added, switched off. ${TYPES_ON_MAX} can be on at once`);
const PAY_TYPES = [['cash', 'Cash', 'Always on. The cash drawer counts it.'], ['gcash', 'GCash', ''], ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'Staff type the name at checkout'], ['credit', 'Account', 'Pay later. Shows once a customer is picked.'], ['split', 'Split', 'Part one way, the rest another']];
const payTypes = () => ({ hidden: [], custom: [], ...state.settings.payments });
const payTypesOn = () => { const { hidden, custom } = payTypes(); return [...PAY_TYPES.map(t => t[0]), ...custom].filter(k => k === 'cash' || !hidden.includes(k)).length; };
function openPayTypes(open) {
  showStPage(open ? 'payTypesPage' : 'settingsPage');
  $('#payTypesPage').classList.remove('ty-edit');
  if (open) renderPayTypes(); else renderPosSettings(false);
}
function renderPayTypes() {
  const { hidden, custom } = payTypes();
  // the label is for= its switch: without it a tap on the name went to the row's first control, a custom type's Delete
  const row = (key, label, note, mine) => `<label class="fr" for="pt-${escapeHtml(key)}"><span class="lb">${mine ? tickBtn(escapeHtml(key), escapeHtml(label)) : ''}${escapeHtml(label)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</span><span class="v"><input type="checkbox" class="sw" id="pt-${escapeHtml(key)}" data-pt="${escapeHtml(key)}" aria-label="Show ${escapeHtml(label)} at checkout"${key === 'cash' || !hidden.includes(key) ? ' checked' : ''}${key === 'cash' ? ' disabled' : ''}></span></label>`;
  $('#payTypesList').innerHTML = PAY_TYPES.map(([k, l, n]) => row(k, l, n)).join('') + custom.map(n => row(n, n, '', true)).join('')
    + '<button type="button" class="fr add" data-pt-add>Add payment type</button>';
  syncTypeEdit('pt', $('#payTypesPage').classList.contains('ty-edit'));
}
function savePayTypes(patch) {
  state.settings.payments = { ...payTypes(), ...patch };
  saveSettings();
}
// Add a payment type (owner 2026-10-15): its own page, a Name and Save; Save goes back to the list.
function addPayType() {
  if (payTypes().custom.length >= OWN_TYPES_MAX) return showToast(`${OWN_TYPES_MAX} is the most. Delete one first`);
  $('#payTypeAddForm').reset();
  showStPage('payTypeAddPage');
  $('#ptName').focus();
}
function savePayTypeAdd() {
  const name = typeName($('#ptName').value), { custom } = payTypes();
  if (!name) return $('#ptName').focus();
  // a custom name is saved as the sale's method, so the words the sale maths already reads (unpaid = no money taken) are taken too
  const taken = [...PAY_TYPES.flatMap(([k, l]) => [k, l]), ...Object.entries(SalesMath.TENDER_LABEL).flat(), 'Void', 'Refund', ...custom];
  if (taken.some(n => n.toLowerCase() === name.toLowerCase())) return showToast(`${name} is taken. Pick another name`);
  const { hidden } = payTypes(), full = payTypesOn() >= TYPES_ON_MAX;   // with the list full, a new one starts off
  savePayTypes({ custom: [...custom, name], hidden: full ? [...hidden, name] : hidden });
  openPayTypes(true);
  if (full) addedOff(name);
}
function bindPayTypes() {
  $('#posPayTypesRow')?.addEventListener('click', () => openPayTypes(true));
  $('#payTypesBack')?.addEventListener('click', () => openPayTypes(false));
  $('#payTypeAddBack').addEventListener('click', () => openPayTypes(true));
  $('#payTypeAddSave').addEventListener('click', savePayTypeAdd);
  $('#payTypeAddForm').addEventListener('submit', (e) => { e.preventDefault(); savePayTypeAdd(); });   // Return on the keyboard
  const list = $('#payTypesList');
  list?.addEventListener('change', (e) => {
    const k = e.target.dataset.pt, { hidden } = payTypes();
    if (k && e.target.checked && payTypesOn() >= TYPES_ON_MAX) { e.target.checked = false; return tooMany(); }
    if (k) savePayTypes({ hidden: e.target.checked ? hidden.filter(h => h !== k) : [...hidden, k] });   // no re-render: the switch keeps focus
  });
  list?.addEventListener('click', (e) => {
    if (e.target.closest('[data-pt-add]')) addPayType();
  });
  bindTypeEdit('pt');
}

// Settings › Fulfilment types (owner 2026-10-16): Payment types' twin. A switch per type says if the sale offers it, and the
// store adds its own names. The primary is what a sale starts on: any type that's on, always on, so it has no switch or Delete.
// ponytail: no rename (delete and add again), like Payment types.
const fulTypes = () => ({ hidden: [], custom: [], ...state.settings.fulfilment });
const fulPrimary = () => state.settings.defaultFulfilment || 'walkin';
function openFulTypes(open) {
  showStPage(open ? 'fulTypesPage' : 'settingsPage');
  $('#fulTypesPage').classList.remove('ty-edit');
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
    return `<label class="fr" for="ft-${k}"><span class="lb">${mine && !main ? tickBtn(k, l) : ''}${l}</span><span class="v"><input type="checkbox" class="sw" id="ft-${k}" data-ft="${k}" aria-label="Show ${l} on the sale"${main || !hidden.includes(key) ? ' checked' : ''}${main ? ' disabled' : ''}></span></label>`;
  };
  $('#fulTypesList').innerHTML = FULFIL_BUILTINS.map(([k, l]) => row(k, l)).join('') + custom.map(n => row(n, n, true)).join('')
    + '<button type="button" class="fr add" data-ft-add>Add fulfilment type</button>';
  renderFulPrimary();
  syncTypeEdit('ft', $('#fulTypesPage').classList.contains('ty-edit'));
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
function bindFulTypes() {
  $('#posFulTypesRow').addEventListener('click', () => openFulTypes(true));
  $('#fulTypesBack').addEventListener('click', () => openFulTypes(false));
  $('#fulTypeAddBack').addEventListener('click', () => openFulTypes(true));
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
    if (e.target.closest('[data-ft-add]')) addFulType();
  });
  bindTypeEdit('ft');
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

