import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const iterations = Math.max(1, parseInt(args.get('iterations') || '3000', 10) || 3000);
const seed = parseInt(args.get('seed') || '20260527', 10) || 20260527;

function loadPlaywright() {
  try { return require('playwright-core'); }
  catch (_) {
    const fallback = process.env.PLAYWRIGHT_CORE_PATH
      || join(process.env.LOCALAPPDATA || '', 'Temp', 'pos-app-verify-playwright', 'node_modules', 'playwright-core');
    if (fallback && existsSync(fallback)) return require(fallback);
    throw new Error('playwright-core was not found. Install it or set PLAYWRIGHT_CORE_PATH.');
  }
}

function edgePath() {
  const candidates = [
    process.env.EDGE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error('Microsoft Edge was not found. Set EDGE_PATH to the browser executable.');
  return found;
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
]);

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const requested = normalize(join(rootDir, pathname));
      if (!requested.startsWith(rootDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const info = await stat(requested);
      if (!info.isFile()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes.get(extname(requested).toLowerCase()) || 'application/octet-stream' });
      createReadStream(requested).pipe(res);
    } catch (_) {
      res.writeHead(404); res.end('Not found');
    }
  });
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => resolveServer({ server, url: `http://127.0.0.1:${server.address().port}/index.html` }));
  });
}

const { chromium } = loadPlaywright();
const { server, url } = await startStaticServer();
let browser;

try {
  browser = await chromium.launch({ executablePath: edgePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(err.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try {
      return typeof eval('state') === 'object'
        && typeof cartTotals === 'function'
        && typeof completeSale === 'function'
        && typeof voidOrder === 'function'
        && typeof exchangeOrder === 'function';
    } catch (_) { return false; }
  }, null, { timeout: 10000 });

  const result = await page.evaluate(({ iterations, seed }) => {
    const failures = [];
    const samples = [];
    let rng = seed >>> 0;
    const random = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 0x100000000;
    };
    const chance = p => random() < p;
    const pick = list => list[Math.floor(random() * list.length)];
    const money = value => Math.round((Number(value) || 0) * 100) / 100;
    const approx = (a, b, eps = 0.01) => Math.abs(money(a) - money(b)) <= eps;
    const stateRef = eval('state');

    function fail(message, detail = {}) {
      failures.push({ message, detail });
    }

    function independentDiscount(gross, disc) {
      if (!disc || !disc.value) return { net: gross, off: 0 };
      const value = Number(disc.value) || 0;
      const off = disc.type === 'percent'
        ? Math.min(gross, gross * (value / 100))
        : Math.min(gross, value);
      return { net: gross - off, off };
    }

    function independentCart(cart, cartDiscount, vatRate) {
      let lineGross = 0;
      let lineDiscount = 0;
      const lines = cart.map(item => {
        const gross = Number(item.price) * Number(item.qty);
        const disc = independentDiscount(gross, item.discount);
        lineGross += gross;
        lineDiscount += disc.off;
        return {
          id: item.id,
          gross: money(gross),
          lineDiscount: money(disc.off),
          lineTotal: money(disc.net),
        };
      });
      const subtotalAfterLineDiscount = lineGross - lineDiscount;
      const cartDisc = independentDiscount(subtotalAfterLineDiscount, cartDiscount);
      const total = cartDisc.net;
      const vatAmount = vatRate > 0 ? total * (vatRate / (1 + vatRate)) : 0;
      return {
        lines,
        subtotal: money(lineGross),
        lineDiscountOff: money(lineDiscount),
        cartDiscountOff: money(cartDisc.off),
        discount: money(lineDiscount + cartDisc.off),
        total: money(total),
        vatAmount: money(vatAmount),
        vatableSales: money(total - vatAmount),
      };
    }

    function roundedTender(total) {
      if (total <= 0) return 0;
      if (total <= 500) return Math.ceil(total / 50) * 50;
      if (total <= 1000) return Math.ceil(total / 100) * 100;
      if (total <= 5000) return Math.ceil(total / 500) * 500;
      return Math.ceil(total / 1000) * 1000;
    }

    function resetAll() {
      [
        'hwpos.folders.v2', 'hwpos.products.v2', 'hwpos.groups.v1', 'hwpos.orders.v1',
        'hwpos.orderSeq.v1', 'hwpos.customers.v1', 'hwpos.customerLedger.v1',
        'hwpos.drawerCloseouts.v1', 'hwpos.settings.v1', 'hwpos.role.v1',
      ].forEach(key => localStorage.removeItem(key));
      stateRef.folders = loadFolders();
      stateRef.products = loadProducts().map(p => ({ ...p, stock: p.stock > 0 ? Math.max(20000, p.stock) : 0 }));
      stateRef.groups = loadGroups();
      stateRef.orders = [];
      stateRef.customers = [];
      stateRef.customerLedger = [];
      stateRef.drawerCloseouts = [];
      stateRef.settings = loadSettings();
      stateRef.vatRate = stateRef.settings.vatRate ?? 0.12;
      stateRef.role = 'manager';
      stateRef.cart = [];
      stateRef.cartDiscount = null;
      stateRef.paymentMethod = 'cash';
      stateRef.customer = null;
      stateRef.fulfilment = 'pickup';
      stateRef.deliveryAddress = '';
      stateRef.deliveryLocation = null;
      saveProducts();
      saveSavedCustomers();
      saveCustomerLedger();
      saveDrawerCloseouts();
      renderCart();
    }

    function resetCart() {
      clearCart();
      stateRef.cart = [];
      stateRef.cartDiscount = null;
      stateRef.paymentMethod = 'cash';
      stateRef.customer = null;
      stateRef.fulfilment = 'pickup';
      stateRef.deliveryAddress = '';
      stateRef.deliveryLocation = null;
      const tender = document.querySelector('#checkoutTender');
      if (tender) tender.value = '';
    }

    function addRandomCart() {
      const sellable = stateRef.products.filter(p => p.stock > 0 && Number(p.price) > 0);
      const lineCount = 1 + Math.floor(random() * 8);
      const used = new Set();
      for (let i = 0; i < lineCount; i += 1) {
        const candidates = sellable.filter(p => !used.has(p.id));
        const product = pick(candidates.length ? candidates : sellable);
        used.add(product.id);
        addToCart(product.id);
        const item = stateRef.cart.find(x => x.id === product.id);
        item.qty = 1 + Math.floor(random() * 9);
        item.price = money(Number(item.price) + (chance(0.08) ? random() * 0.99 : 0));
        if (chance(0.35)) {
          const gross = item.price * item.qty;
          item.discount = chance(0.5)
            ? { type: 'percent', value: money(random() * 35) }
            : { type: 'amount', value: money(random() * gross * 0.7) };
        }
      }
      if (chance(0.32)) {
        const roughSubtotal = stateRef.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
        stateRef.cartDiscount = chance(0.45)
          ? { type: 'percent', value: money(random() * 20) }
          : { type: 'amount', value: money(random() * roughSubtotal * 0.3) };
      }
      renderCart();
    }

    function auditCartMath(label) {
      const actual = cartTotals();
      const expected = independentCart(stateRef.cart, stateRef.cartDiscount, stateRef.vatRate);
      for (const key of ['subtotal', 'lineDiscountOff', 'cartDiscountOff', 'discount', 'total', 'vatAmount', 'vatableSales']) {
        if (!approx(actual[key], expected[key])) fail(`${label}: cart ${key} mismatch`, { actual: actual[key], expected: expected[key] });
      }
      return expected;
    }

    function auditOrder(order, expected, label) {
      if (!approx(order.subtotal, expected.subtotal)) fail(`${label}: order subtotal mismatch`, { actual: order.subtotal, expected: expected.subtotal });
      if (!approx(order.discount, expected.discount)) fail(`${label}: order discount mismatch`, { actual: order.discount, expected: expected.discount });
      if (!approx(order.total, expected.total)) fail(`${label}: order total mismatch`, { actual: order.total, expected: expected.total });
      if (!approx(order.vatAmount, expected.vatAmount)) fail(`${label}: VAT mismatch`, { actual: order.vatAmount, expected: expected.vatAmount });
      if (!approx(order.vatableSales, expected.vatableSales)) fail(`${label}: vatable sales mismatch`, { actual: order.vatableSales, expected: expected.vatableSales });
      for (const item of order.items || []) {
        const line = expected.lines.find(x => x.id === item.id);
        if (!line) {
          fail(`${label}: unexpected order item`, { item });
          continue;
        }
        if (!approx(item.lineGross, line.gross)) fail(`${label}: line gross mismatch`, { item: item.name, actual: item.lineGross, expected: line.gross });
        if (!approx(item.lineDiscount, line.lineDiscount)) fail(`${label}: line discount mismatch`, { item: item.name, actual: item.lineDiscount, expected: line.lineDiscount });
        if (!approx(item.lineTotal, line.lineTotal)) fail(`${label}: line total mismatch`, { item: item.name, actual: item.lineTotal, expected: line.lineTotal });
      }
      const paid = money((order.payments || []).filter(p => p.method !== 'unpaid').reduce((sum, p) => sum + Number(p.amount || 0), 0));
      if (order.status !== 'saved' && !approx(paid, order.total)) fail(`${label}: payment total mismatch`, { paid, total: order.total, payments: order.payments });
      if (order.paymentMethod === 'cash') {
        const cash = order.payments.find(p => p.method === 'cash');
        if (cash && !approx(cash.change, Math.max(0, Number(cash.tendered || 0) - order.total))) {
          fail(`${label}: cash change mismatch`, { cash, total: order.total });
        }
      }
      if (order.paymentMethod === 'split') {
        const cash = order.payments.find(p => p.method === 'cash');
        const credit = order.payments.find(p => p.method === 'credit');
        if (!cash || !credit) fail(`${label}: split missing cash or credit row`, { payments: order.payments });
        else if (!approx(cash.amount + credit.amount, order.total)) fail(`${label}: split total mismatch`, { cash, credit, total: order.total });
      }
    }

    resetAll();
    const expectedStock = new Map(stateRef.products.map(p => [p.id, Number(p.stock) || 0]));
    const startingCustomerBalances = new Map(allCustomerRecords().map(c => [c.id, Number(c.currentBalance) || 0]));
    const expectedCustomerBalances = new Map(startingCustomerBalances);
    let expectedDrawerCash = 0;
    let completed = 0;
    let saved = 0;
    let voided = 0;
    let refunded = 0;
    let exchanged = 0;
    let customerPayments = 0;
    let maxTotal = 0;
    let minTotal = Infinity;

    for (let i = 0; i < iterations; i += 1) {
      resetCart();
      addRandomCart();
      const expected = auditCartMath(`iteration ${i + 1}`);
      maxTotal = Math.max(maxTotal, expected.total);
      minTotal = Math.min(minTotal, expected.total);
      const customers = allCustomerRecords();
      const customer = chance(0.35) ? pick(customers) : null;
      const modeRoll = random();
      const tenderInput = document.querySelector('#checkoutTender');

      if (modeRoll < 0.08) {
        saveCurrentReceipt(customer ? { id: customer.id, name: customer.name, phone: customer.phone || '', address: customer.address || '' } : null);
        const order = loadOrders()[0];
        auditOrder(order, expected, `saved ${i + 1}`);
        if (order.paymentMethod !== 'unpaid' || order.payments[0]?.method !== 'unpaid') fail(`saved ${i + 1}: unpaid payment mismatch`, order);
        saved += 1;
        continue;
      }

      if (modeRoll < 0.18 && customer) {
        stateRef.customer = customer;
        stateRef.paymentMethod = 'credit';
      } else if (modeRoll < 0.28 && customer && expected.total > 1) {
        stateRef.customer = customer;
        stateRef.paymentMethod = 'split';
        tenderInput.value = String(money(expected.total * (0.1 + random() * 0.75)));
      } else {
        stateRef.paymentMethod = 'cash';
        tenderInput.value = String(roundedTender(expected.total));
      }

      completeSale();
      const order = loadOrders()[0];
      auditOrder(order, expected, `sale ${i + 1}`);
      completed += 1;

      for (const item of order.items) {
        expectedStock.set(item.id, Math.max(0, (expectedStock.get(item.id) || 0) - item.qty));
      }
      const cashPaid = (order.payments || []).filter(p => p.method === 'cash').reduce((sum, p) => sum + Number(p.amount || 0), 0);
      expectedDrawerCash = money(expectedDrawerCash + cashPaid);
      const creditPaid = (order.payments || []).filter(p => p.method === 'credit').reduce((sum, p) => sum + Number(p.amount || 0), 0);
      if (creditPaid > 0 && order.customer) {
        expectedCustomerBalances.set(order.customer.id, money((expectedCustomerBalances.get(order.customer.id) || 0) + creditPaid));
      }

      if (chance(0.04)) {
        const before = new Map(stateRef.products.map(p => [p.id, p.stock]));
        voidOrder(order.id, 'math audit void');
        const updated = loadOrders().find(o => o.id === order.id);
        if (updated.status !== 'voided') fail(`void ${i + 1}: status mismatch`, updated);
        for (const item of order.items) expectedStock.set(item.id, (expectedStock.get(item.id) || 0) + item.qty);
        if (creditPaid > 0 && order.customer) expectedCustomerBalances.set(order.customer.id, money((expectedCustomerBalances.get(order.customer.id) || 0) - creditPaid));
        voided += 1;
      } else if (chance(0.04)) {
        refundOrder(order.id, 'math audit refund');
        const updated = loadOrders().find(o => o.id === order.id);
        if (updated.status !== 'refunded') fail(`refund ${i + 1}: status mismatch`, updated);
        for (const item of order.items) expectedStock.set(item.id, (expectedStock.get(item.id) || 0) + item.qty);
        if (creditPaid > 0 && order.customer) expectedCustomerBalances.set(order.customer.id, money((expectedCustomerBalances.get(order.customer.id) || 0) - creditPaid));
        refunded += 1;
      } else if (chance(0.03)) {
        const replacement = stateRef.products.find(p => p.stock > 0 && p.price > 0 && !(order.items || []).some(item => item.id === p.id));
        if (replacement) {
          const exchangedResult = exchangeOrder(order.id, [{ id: replacement.id, qty: 1 }], 'math audit exchange');
          if (!exchangedResult?.exchangeSale) fail(`exchange ${i + 1}: no exchange sale`);
          for (const item of order.items) expectedStock.set(item.id, (expectedStock.get(item.id) || 0) + item.qty);
          if (creditPaid > 0 && order.customer) expectedCustomerBalances.set(order.customer.id, money((expectedCustomerBalances.get(order.customer.id) || 0) - creditPaid));
          expectedStock.set(replacement.id, Math.max(0, (expectedStock.get(replacement.id) || 0) - 1));
          expectedDrawerCash = money(expectedDrawerCash + money(replacement.price));
          exchanged += 1;
        }
      }

      if (chance(0.07)) {
        const debtors = Array.from(expectedCustomerBalances.entries()).filter(([, balance]) => balance > 0);
        if (debtors.length) {
          const [id, balance] = pick(debtors);
          const payment = money(Math.min(balance, 1 + random() * Math.max(1, balance)));
          recordCreditPayment(id, payment, 'math audit payment');
          expectedCustomerBalances.set(id, money(balance - payment));
          customerPayments += 1;
        }
      }

      if (failures.length > 25) break;
    }

    for (const product of stateRef.products) {
      const expected = expectedStock.get(product.id);
      if (expected !== undefined && Number(product.stock) !== expected) {
        fail('final stock mismatch', { sku: product.sku, actual: product.stock, expected });
      }
    }
    const customers = allCustomerRecords();
    for (const [id, expected] of expectedCustomerBalances) {
      const actual = customers.find(c => c.id === id)?.currentBalance || 0;
      if (!approx(actual, expected)) fail('final customer balance mismatch', { id, actual, expected });
    }
    const drawer = buildCashDrawerSummary();
    const expectedOpenCash = loadOrders()
      .filter(order => order.status === 'completed')
      .flatMap(order => order.payments || [])
      .filter(payment => payment.method === 'cash')
      .reduce((sum, payment) => money(sum + Number(payment.amount || 0)), 0);
    if (!approx(drawer.expectedCash, expectedOpenCash)) fail('cash drawer summary mismatch', { actual: drawer.expectedCash, expected: expectedOpenCash });
    const closeout = closeCashDrawer({ countedCash: drawer.expectedCash + 12.34, notes: 'math audit' });
    if (!approx(closeout.difference, 12.34)) fail('cash drawer closeout difference mismatch', closeout);

    const completedOrders = loadOrders().filter(order => order.status === 'completed');
    const reportRevenue = completedOrders.reduce((sum, order) => money(sum + order.total), 0);
    const aiMetrics = window.HWPOS_AI.metrics({ range: 'all' });
    if (!approx(aiMetrics.sales.revenue, reportRevenue)) fail('AI/report revenue mismatch', { actual: aiMetrics.sales.revenue, expected: reportRevenue });

    if (samples.length < 5) {
      for (const order of loadOrders().slice(0, 5)) {
        samples.push({ number: order.number, status: order.status, total: order.total, paymentMethod: order.paymentMethod });
      }
    }

    return {
      ok: failures.length === 0,
      failures,
      config: { iterations, seed },
      counts: { completed, saved, voided, refunded, exchanged, customerPayments },
      totals: {
        minTotal: minTotal === Infinity ? 0 : money(minTotal),
        maxTotal: money(maxTotal),
        completedRevenue: reportRevenue,
        drawerExpectedCash: drawer.expectedCash,
      },
      samples,
      consoleErrors: [],
    };
  }, { iterations, seed });

  result.consoleErrors = consoleErrors;
  if (consoleErrors.length) result.failures.push(...consoleErrors.map(e => ({ message: `console error: ${e}` })));
  result.ok = result.failures.length === 0;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
