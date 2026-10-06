// Till › Settings, and the cash drawer count.

function renderPosSettings() {
  const currentSize = state.tileSize || 'md';
  $$('#posSizeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.size === currentSize);
  });
  const currentText = state.tileText || 'md';
  $$('#posTextToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.text === currentText);
  });
  const showCb = $('#posShowPrice');
  if (showCb) showCb.checked = state.showPrice;
  const stockCb = $('#posTileStock');
  if (stockCb) stockCb.checked = state.tileStock;
  const currentTheme = state.theme || 'dark';
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === currentTheme);
  });
  const headCb = $('#posCartHead');
  if (headCb) headCb.checked = state.cartHead;
  const p = printerConfig();
  $$('#posWidthToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.width === (p.width || '80mm'));
  });
  const po = $('#posPrintOnSale');
  if (po) po.checked = !!p.printOnSale;
  const pc = $('#posPrintCut');
  if (pc) pc.checked = p.cut !== false;
  const pm = $('#posPrintMap');
  if (pm) pm.checked = p.mapOnReceipt !== false;
  const ip = $('#posPrinterIp');
  if (ip) ip.value = p.netUrl || '';
  $$('#posDriverToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.driver === (p.driver || 'browser'));
  });
  const netRow = $('#posNetRow');
  if (netRow) netRow.hidden = p.driver !== 'network';
  const scanRow = $('#posScanRow');
  if (scanRow) scanRow.hidden = p.driver !== 'network';
  const listRow = $('#posPrinterListRow');
  if (listRow) listRow.hidden = p.driver !== 'network';
  renderPrinterList();
  setScanStatus('');
  refreshPrinterStatus();
  const btRow = $('#posBtRow');
  if (btRow) btRow.hidden = p.driver !== 'bluetooth';
  const btStatus = $('#posBtStatus');
  if (btStatus) btStatus.textContent = p.btName ? 'Paired: ' + p.btName : 'Not paired';
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

function applyTheme(theme) {
  state.theme = theme;
  storageSet(STORAGE_THEME, theme);
  document.body.classList.toggle('light-theme', theme === 'light');
  $$('#posThemeToggle .bb-size-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
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

// THIS register's cash over [from, to), the one sum the day count above and the shift close
// (pos-shift.js) both read: cash taken on sales, cash handed back (a void or refund row pays out the
// way the sale came in), and cash paid on account at this till (customers bug 9; a back-office
// payment has no register). Pesos, unsigned.
function drawerCash(from, to = Infinity) {
  const reg = String(currentStoreInfo().registerNo);
  const rows = loadOrders().filter(o => String(o.register) === reg && o.ts >= from && o.ts < to);
  const cash = list => SalesMath.tenders(list).get('cash') || 0;
  const ledger = loadCustomerLedger(), undone = undoneIds(ledger);
  const onAccount = ledger.filter(r => r.type === 'payment' && r.method === 'cash' && String(r.register) === reg && !undone.has(r.id)
    && SalesMath.tsOf(r) >= from && SalesMath.tsOf(r) < to).reduce((n, r) => n + cent(r.amount), 0);
  return { rows, sales: cash(rows.filter(SalesMath.isSale)), back: -cash(rows.filter(SalesMath.isReversal)) || 0, onAccount: unc(onAccount) };
}

