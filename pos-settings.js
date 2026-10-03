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
  state.settings.churnThresholdDays = Math.max(1, parseInt($('#posChurnDays')?.value || '30', 10) || 30);
  saveSettings();
}

// The drawer for THIS register on one store day (the store's clock, not the browser's): cash taken,
// less cash handed back over the counter (a void or refund row pays out the way the sale came in, on
// the day it happens). The closeout screen was removed on purpose; ponytail: kept only because
// customer-ledger-check and till-run call it as the till's own cash count.
function buildCashDrawerSummary(date = new Date()) {
  const z = tillZone(), key = tillDay(+date);
  const from = SalesMath.dayStartMs(key, z), to = SalesMath.dayStartMs(SalesMath.addDays(key, 1), z);
  const reg = String(currentStoreInfo().registerNo);
  const day = loadOrders().filter(o => String(o.register) === reg && o.ts >= from && o.ts < to);
  // Plus cash paid on account at this till today (customers bug 9); a back-office payment has no register.
  const ledger = loadCustomerLedger(), undone = undoneIds(ledger);
  const onAccount = ledger.filter(r => r.type === 'payment' && r.method === 'cash' && String(r.register) === reg && !undone.has(r.id)
    && SalesMath.tsOf(r) >= from && SalesMath.tsOf(r) < to).reduce((n, r) => n + cent(r.amount), 0);
  return {
    date: key,
    expectedCash: moneyValue((SalesMath.tenders(day).get('cash') || 0) + unc(onAccount)),
    cashSales: day.filter(o => SalesMath.isSale(o) && (o.payments || []).some(p => p.method === 'cash' && p.amount > 0)).length,
    adjustments: day.filter(SalesMath.isReversal).length,
  };
}

