// Till › Settings, and the cash drawer count.

// The page's dropdowns ([data-pick] buttons): the choices in the order they always show, what is on now, and the
// setter each one already had. A pick runs the setter, then the page redraws from state.
const savePrinting = (patch) => { state.settings.printing = { ...printerConfig(), ...patch }; saveSettings(); };
const SETTING_PICKS = {
  // Wide is the phone's (2 across at Medium's height, owner 2026-10-13); a tablet runs it as Medium (getSellGridProfile), so it reads Medium there
  tileSize: { get opts() { return [['sm', 'Small'], ['md', 'Medium'], ...(innerWidth > 720 ? [] : [['wide', 'Wide']]), ['lg', 'Large']]; },
    now: () => (state.tileSize === 'wide' && innerWidth > 720 ? 'md' : state.tileSize) || 'md', set: setTileSize },
  tileText: { opts: [['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'Extra large']], now: () => state.tileText || 'md', set: setTileText },
  tileShow: { opts: [['price', 'Price'], ['stock', 'Stock'], ['name', 'Name only']], now: () => state.tileStock ? 'stock' : state.showPrice ? 'price' : 'name', set: setTileShow },
  tilePics: { opts: [['off', 'Off'], ['top', 'Photo top'], ['fill', 'Photo fills']], now: () => state.tilePics, set: setTilePics },
  cartPics: { opts: [['off', 'Off'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']], now: () => state.cartPics, set: setCartPics },
  theme: { opts: [['dark', 'Dark'], ['light', 'Light']], now: () => state.theme || 'dark', set: applyTheme },
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
function openSettingMenu(btn) {
  const pk = SETTING_PICKS[btn.dataset.pick], now = pk.now();
  openMenu(btn, pk.opts.map(([v, label]) => ({ label, cur: v === now, run: () => { if (v !== now) pk.set(v); renderPosSettings(btn.dataset.pick === 'driver'); } })));
}

// printer = false: redraw labels and which rows show, but leave the printer list, a running scan's progress
// line and the probe alone (a theme or paper pick has nothing to do with them).
function renderPosSettings(printer = true) {
  $$('#settingsView [data-pick]').forEach(b => {
    const pk = SETTING_PICKS[b.dataset.pick], now = pk.now();
    const val = (pk.opts.find(o => o[0] === now) || pk.opts[0])[1];
    b.firstElementChild.textContent = val;
    b.setAttribute('aria-label', b.closest('.fr').querySelector('.lb').textContent + ', ' + val);   // "Tile size, Medium", not just "Medium"
  });
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
const PAY_TYPES = [['cash', 'Cash', 'Always on. The cash drawer counts it.'], ['gcash', 'GCash', ''], ['qr', 'QR', 'Any QR wallet'],
  ['other', 'Other', 'Staff type the name at checkout'], ['credit', 'Account', 'Pay later. Shows once a customer is picked.'], ['split', 'Split', 'Part one way, the rest another']];
const payTypes = () => ({ hidden: [], custom: [], ...state.settings.payments });
const payTypesOn = () => { const { hidden, custom } = payTypes(); return [...PAY_TYPES.map(t => t[0]), ...custom].filter(k => k === 'cash' || !hidden.includes(k)).length; };
function openPayTypes(open) {
  $('#settingsPage').hidden = open;
  $('#payTypesPage').hidden = !open;
  if (open) renderPayTypes(); else renderPosSettings(false);
}
function renderPayTypes() {
  const { hidden, custom } = payTypes();
  // the label is for= its switch: without it a tap on the name went to the row's first control, a custom type's Delete
  const row = (key, label, note, mine) => `<label class="fr" for="pt-${escapeHtml(key)}"><span class="lb">${escapeHtml(label)}${note ? `<small>${escapeHtml(note)}</small>` : ''}</span><span class="v">${mine
    ? `<button type="button" class="act icon" data-pt-del="${escapeHtml(key)}" aria-label="Delete ${escapeHtml(label)}" title="Delete"><svg class="ic" viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg></button>` : ''}<input type="checkbox" class="sw" id="pt-${escapeHtml(key)}" data-pt="${escapeHtml(key)}" aria-label="Show ${escapeHtml(label)} at checkout"${key === 'cash' || !hidden.includes(key) ? ' checked' : ''}${key === 'cash' ? ' disabled' : ''}></span></label>`;
  $('#payTypesList').innerHTML = PAY_TYPES.map(([k, l, n]) => row(k, l, n)).join('') + custom.map(n => row(n, n, '', true)).join('')
    + '<button type="button" class="fr add" data-pt-add>Add payment type</button>';
}
function savePayTypes(patch) {
  state.settings.payments = { ...payTypes(), ...patch };
  saveSettings();
}
function addPayType() {
  showConfirm({ title: 'Add a payment type', okText: 'Add',
    html: '<label class="pf"><span class="lb">Name</span><input class="text-input" id="ptName" maxlength="24" placeholder="e.g. Maya or Card" autocomplete="off"></label>',
    onConfirm: () => {
      const name = ($('#ptName')?.value || '').trim(), { custom } = payTypes();
      if (!name) return;
      // a custom name is saved as the sale's method, so the words the sale maths already reads (unpaid = no money taken) are taken too
      const taken = [...PAY_TYPES.flatMap(([k, l]) => [k, l]), ...Object.entries(SalesMath.TENDER_LABEL).flat(), 'Void', 'Refund', ...custom];
      if (taken.some(n => n.toLowerCase() === name.toLowerCase())) return showToast(`${name} is taken. Pick another name`);
      savePayTypes({ custom: [...custom, name] });
      renderPayTypes();
    } });
}
function bindPayTypes() {
  $('#posPayTypesRow')?.addEventListener('click', () => openPayTypes(true));
  $('#payTypesBack')?.addEventListener('click', () => openPayTypes(false));
  const list = $('#payTypesList');
  list?.addEventListener('change', (e) => {
    const k = e.target.dataset.pt, { hidden } = payTypes();
    if (k) savePayTypes({ hidden: e.target.checked ? hidden.filter(h => h !== k) : [...hidden, k] });   // no re-render: the switch keeps focus
  });
  list?.addEventListener('click', (e) => {
    if (e.target.closest('[data-pt-add]')) return addPayType();
    const del = e.target.closest('[data-pt-del]')?.dataset.ptDel;
    if (!del) return;
    showConfirm({ title: `Delete ${del}?`, message: 'Past sales paid with it keep the name.', okText: 'Delete', danger: true,
      onConfirm: () => { const { hidden, custom } = payTypes(); savePayTypes({ hidden: hidden.filter(h => h !== del), custom: custom.filter(n => n !== del) }); renderPayTypes(); } });
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
  document.body.classList.toggle('light-theme', theme === 'light');
}

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

