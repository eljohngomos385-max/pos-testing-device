import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(key, value);
}

const transactionCount = Math.max(1, parseInt(args.get('transactions') || '1000', 10) || 1000);
const seed = parseInt(args.get('seed') || '20260527', 10) || 20260527;
const headless = args.get('headed') !== 'true';

function loadPlaywright() {
  try {
    return require('playwright-core');
  } catch (_) {
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
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const requested = normalize(join(rootDir, pathname));
      if (!requested.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const info = await stat(requested);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeTypes.get(extname(requested).toLowerCase()) || 'application/octet-stream' });
      createReadStream(requested).pipe(res);
    } catch (_) {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({ server, url: `http://127.0.0.1:${address.port}/index.html` });
    });
  });
}

const { chromium } = loadPlaywright();
const { server, url } = await startStaticServer();
let browser;

try {
  browser = await chromium.launch({ executablePath: edgePath(), headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    try {
      return typeof eval('state') === 'object' && typeof completeSale === 'function' && typeof saveCurrentReceipt === 'function';
    } catch (_) {
      return false;
    }
  }, null, { timeout: 10000 });

  const result = await page.evaluate(async ({ transactionCount, seed }) => {
    const failures = [];
    const warnings = [];
    const samples = [];
    const startedAt = performance.now();
    let rng = seed >>> 0;
    const random = () => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 0x100000000;
    };
    const pick = list => list[Math.floor(random() * list.length)];
    const chance = p => random() < p;
    const money = value => Math.round((Number(value) || 0) * 100) / 100;
    const stateRef = eval('state');
    const storageKeys = [
      'hwpos.folders.v2',
      'hwpos.products.v2',
      'hwpos.groups.v1',
      'hwpos.orders.v1',
      'hwpos.orderSeq.v1',
      'hwpos.customers.v1',
      'hwpos.settings.v1',
      'hwpos.role.v1',
    ];

    function assert(condition, message) {
      if (!condition) failures.push(message);
    }

    function roundedTender(total) {
      if (total <= 0) return 0;
      if (total <= 500) return Math.ceil(total / 50) * 50;
      if (total <= 1000) return Math.ceil(total / 100) * 100;
      if (total <= 5000) return Math.ceil(total / 500) * 500;
      return Math.ceil(total / 1000) * 1000;
    }

    function resetSession() {
      for (const key of storageKeys) localStorage.removeItem(key);
      stateRef.folders = loadFolders();
      stateRef.products = loadProducts().map(p => ({
        ...p,
        stock: p.stock > 0 ? Math.max(p.stock, 10000) : 0,
      }));
      stateRef.groups = loadGroups();
      stateRef.orders = [];
      stateRef.customers = [];
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
      renderCart();
    }

    function resetReceiptState() {
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
      const delivery = document.querySelector('#deliveryAddrInput');
      if (delivery) delivery.value = '';
    }

    function addRandomCartItems() {
      const sellable = stateRef.products.filter(p => p.stock > 0 && Number(p.price) > 0);
      const lineCount = 1 + Math.floor(random() * 6);
      const used = new Set();
      for (let line = 0; line < lineCount; line += 1) {
        const product = pick(sellable.filter(p => !used.has(p.id)) || sellable);
        if (!product) continue;
        used.add(product.id);
        addToCart(product.id);
        const item = stateRef.cart.find(i => i.id === product.id);
        if (!item) continue;
        item.qty = 1 + Math.floor(random() * 5);
        if (chance(0.08)) {
          item.discount = chance(0.5)
            ? { type: 'percent', value: 5 + Math.floor(random() * 16) }
            : { type: 'amount', value: money(Math.min(item.price * item.qty * 0.25, 5 + Math.floor(random() * 45))) };
        }
      }
      if (chance(0.12)) {
        stateRef.cartDiscount = chance(0.45)
          ? { type: 'percent', value: 5 + Math.floor(random() * 11) }
          : { type: 'amount', value: 10 + Math.floor(random() * 90) };
      }
      renderCart();
    }

    function prepareFulfilment(customer) {
      if (!chance(0.22)) {
        stateRef.fulfilment = 'pickup';
        stateRef.deliveryAddress = '';
        stateRef.deliveryLocation = null;
        return;
      }
      stateRef.fulfilment = 'delivery';
      stateRef.deliveryAddress = chance(0.7)
        ? (customer?.address || `Delivery Zone ${1 + Math.floor(random() * 8)}`)
        : '';
      stateRef.deliveryLocation = chance(0.65)
        ? {
            lat: 14.1 + random() * 0.35,
            lng: 121.1 + random() * 0.45,
            zoom: 16 + Math.floor(random() * 5),
            provider: 'openstreetmap',
            attribution: '© OpenStreetMap contributors',
          }
        : null;
    }

    function paymentTotal(order) {
      return money((order.payments || [])
        .filter(p => p.method !== 'unpaid')
        .reduce((sum, p) => sum + (Number(p.amount) || 0), 0));
    }

    resetSession();
    const customers = allCustomerRecords();
    const expectedCredit = new Map();
    let completed = 0;
    let saved = 0;
    let cash = 0;
    let credit = 0;
    let split = 0;
    let delivery = 0;
    let discounted = 0;
    let maxOrderJsonBytes = 0;
    const expectedStock = new Map(stateRef.products.map(p => [p.id, Number(p.stock) || 0]));

    for (let i = 0; i < transactionCount; i += 1) {
      resetReceiptState();
      addRandomCartItems();
      const beforeOrders = loadOrders().length;
      const willSave = chance(0.1);
      let customer = null;
      if (chance(0.28) || willSave) customer = chance(0.72) ? pick(customers) : null;
      prepareFulfilment(customer);
      if (stateRef.fulfilment === 'delivery') delivery += 1;
      if (stateRef.cartDiscount || stateRef.cart.some(item => item.discount)) discounted += 1;

      if (willSave) {
        const override = chance(0.55)
          ? (customer ? { id: customer.id, name: customer.name, phone: customer.phone || '', address: customer.address || '' }
            : { id: `draft-${i}`, name: `Draft Customer ${i + 1}`, phone: '', address: '' })
          : null;
        saveCurrentReceipt(override);
        saved += 1;
      } else {
        const r = random();
        let method = 'cash';
        if (r > 0.82 && customer) method = 'credit';
        else if (r > 0.68 && customer) method = 'split';
        stateRef.customer = method === 'cash' && chance(0.2) ? customer : (method === 'cash' ? null : customer);
        stateRef.paymentMethod = method;
        const totals = cartTotals();
        const tender = document.querySelector('#checkoutTender');
        if (method === 'cash') {
          const tendered = roundedTender(totals.total);
          if (tender) tender.value = String(tendered);
          cash += 1;
        } else if (method === 'split') {
          const tendered = Math.max(1, money(totals.total * (0.2 + random() * 0.55)));
          if (tender) tender.value = String(tendered);
          split += 1;
        } else {
          if (tender) tender.value = '';
          credit += 1;
        }
        completeSale();
        completed += 1;
      }

      const orders = loadOrders();
      if (orders.length !== beforeOrders + 1) {
        failures.push(`transaction ${i + 1}: expected order count ${beforeOrders + 1}, got ${orders.length}`);
        break;
      }
      const order = orders[0];
      if (order.fulfilment === 'delivery' && order.deliveryAddress == null) {
        failures.push(`transaction ${i + 1}: delivery address should normalize to a string`);
      }
      if (order.status === 'saved') {
        assert(order.paymentMethod === 'unpaid', `transaction ${i + 1}: saved order is not unpaid`);
        assert(order.payments.length === 1 && order.payments[0].method === 'unpaid', `transaction ${i + 1}: saved order payment row is wrong`);
      } else {
        assert(order.paymentMethod !== 'unpaid', `transaction ${i + 1}: completed order is unpaid`);
        assert(paymentTotal(order) === money(order.total), `transaction ${i + 1}: payments ${paymentTotal(order)} do not equal total ${order.total}`);
        const creditApplied = (order.payments || [])
          .filter(p => p.method === 'credit')
          .reduce((sum, p) => sum + p.amount, 0);
        if (creditApplied > 0) {
          assert(!!order.customer, `transaction ${i + 1}: credit payment has no customer`);
          expectedCredit.set(order.customer.id, money((expectedCredit.get(order.customer.id) || 0) + creditApplied));
        }
        for (const item of order.items) {
          expectedStock.set(item.id, Math.max(0, (expectedStock.get(item.id) || 0) - item.qty));
        }
      }
      if (order.fulfilment === 'delivery' && order.deliveryLocation) {
        assert(Number.isFinite(order.deliveryLocation.lat), `transaction ${i + 1}: delivery map latitude is invalid`);
        assert(Number.isFinite(order.deliveryLocation.lng), `transaction ${i + 1}: delivery map longitude is invalid`);
        assert(order.deliveryLocation.zoom >= 12 && order.deliveryLocation.zoom <= 20, `transaction ${i + 1}: delivery map zoom is invalid`);
      }
      assert(order.items.length > 0, `transaction ${i + 1}: order has no items`);
      assert(order.total >= 0, `transaction ${i + 1}: order total is negative`);
      maxOrderJsonBytes = Math.max(maxOrderJsonBytes, JSON.stringify(order).length);
      if (samples.length < 5) {
        samples.push({
          number: order.number,
          status: order.status,
          paymentMethod: order.paymentMethod,
          items: order.items.length,
          total: order.total,
          fulfilment: order.fulfilment,
        });
      }
      if (failures.length > 20) break;
    }

    const orders = loadOrders();
    const numbers = orders.map(o => o.number);
    const ids = orders.map(o => o.id);
    assert(orders.length === transactionCount, `expected ${transactionCount} orders, got ${orders.length}`);
    assert(new Set(ids).size === ids.length, 'duplicate order IDs found');
    assert(new Set(numbers).size === numbers.length, 'duplicate order numbers found');
    const seqs = numbers.map(n => parseInt(String(n).split('-')[1], 10)).filter(Number.isFinite).sort((a, b) => a - b);
    assert(seqs[0] === 1, `first order sequence should be 1, got ${seqs[0]}`);
    assert(seqs[seqs.length - 1] === transactionCount, `last order sequence should be ${transactionCount}, got ${seqs[seqs.length - 1]}`);
    assert(orders.every(o => o.schemaVersion === 1 && o.formatKey === 'hwpos.order.v1'), 'not every order uses the canonical order format');

    for (const product of stateRef.products) {
      const expected = expectedStock.get(product.id);
      if (expected !== undefined) {
        assert(Number(product.stock) === expected, `stock mismatch for ${product.sku || product.id}: expected ${expected}, got ${product.stock}`);
      }
    }

    for (const [id, addedCredit] of expectedCredit) {
      const savedCustomer = stateRef.customers.find(c => c.id === id);
      assert(!!savedCustomer, `credit customer ${id} was not saved after balance update`);
      const seedCustomer = customers.find(c => c.id === id);
      const expectedBalance = money((Number(seedCustomer?.currentBalance) || 0) + addedCredit);
      assert(money(savedCustomer.currentBalance) === expectedBalance, `credit customer ${id} balance ${savedCustomer?.currentBalance} should be ${expectedBalance}`);
    }

    const renderStarted = performance.now();
    switchView('orders');
    renderOrders();
    const renderOrdersMs = performance.now() - renderStarted;
    const reportStarted = performance.now();
    switchView('reports');
    renderReports();
    const renderReportsMs = performance.now() - reportStarted;
    const ordersJson = localStorage.getItem('hwpos.orders.v1') || '';
    const productsJson = localStorage.getItem('hwpos.products.v2') || '';
    const customersJson = localStorage.getItem('hwpos.customers.v1') || '';
    const storageBytes = ordersJson.length + productsJson.length + customersJson.length;
    if (ordersJson.length > 4_500_000) {
      warnings.push(`orders storage is ${ordersJson.length} bytes, close to typical 5MB localStorage limits`);
    }
    if (renderOrdersMs > 2000) warnings.push(`orders render took ${Math.round(renderOrdersMs)}ms`);
    if (renderReportsMs > 2000) warnings.push(`reports render took ${Math.round(renderReportsMs)}ms`);

    return {
      ok: failures.length === 0,
      failures,
      warnings,
      config: { transactionCount, seed },
      counts: { completed, saved, cash, credit, split, delivery, discounted },
      samples,
      storage: {
        ordersBytes: ordersJson.length,
        productsBytes: productsJson.length,
        customersBytes: customersJson.length,
        totalBytes: storageBytes,
        maxOrderJsonBytes,
      },
      renderMs: {
        orders: Math.round(renderOrdersMs),
        reports: Math.round(renderReportsMs),
      },
      durationMs: Math.round(performance.now() - startedAt),
      consoleErrors: [],
    };
  }, { transactionCount, seed });

  result.consoleErrors = consoleErrors;
  if (consoleErrors.length) result.failures.push(...consoleErrors.map(e => `console error: ${e}`));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok || result.failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
