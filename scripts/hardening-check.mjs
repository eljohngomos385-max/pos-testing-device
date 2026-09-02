import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

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
      resolveServer({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

const { chromium } = loadPlaywright();
const { server, baseUrl } = await startStaticServer();
let browser;

const report = {
  ok: false,
  checks: [],
  failures: [],
};

function pass(name, details = {}) {
  report.checks.push({ name, ok: true, details });
}

function fail(name, error) {
  const message = error?.message || String(error);
  report.checks.push({ name, ok: false, error: message });
  report.failures.push(`${name}: ${message}`);
}

async function runCheck(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

try {
  browser = await chromium.launch({ executablePath: edgePath(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  await runCheck('barcode camera fallback decodes without BarcodeDetector', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      delete window.BarcodeDetector;
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      delete window.BarcodeDetector;
      const img = new Image();
      img.src = 'test-barcode-4801234500059.png';
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      function draw() {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const w = 900;
        const h = Math.round(img.height * (w / img.width));
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        requestAnimationFrame(draw);
      }
      draw();
      const stream = canvas.captureStream(15);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => stream },
      });
    });
    await page.click('#scanBtn');
    await page.waitForFunction(() => document.body.innerText.includes('Brass Faucet 1/2"'), null, { timeout: 6000 });
    await page.waitForFunction(() => document.querySelector('#cartCount')?.textContent.trim() === '1 items', null, { timeout: 3000 });
    const scannerStillOpen = await page.$eval('#barcodeModal', el => !el.hidden);
    if (!scannerStillOpen) throw new Error('Scanner closed after the first barcode');
    await page.waitForTimeout(500);
    const countAfterHold = await page.$eval('#cartCount', el => el.textContent.trim());
    if (countAfterHold !== '1 items') throw new Error(`Held barcode should not duplicate immediately, got ${countAfterHold}`);
    await page.fill('#barcodeManualInput', '4801234600039');
    await page.click('#barcodeManualBtn');
    await page.waitForFunction(() => document.querySelector('#cartCount')?.textContent.trim() === '2 items', null, { timeout: 3000 });
    const scannerOpenAfterManual = await page.$eval('#barcodeModal', el => !el.hidden);
    if (!scannerOpenAfterManual) throw new Error('Scanner closed after manual barcode add');
  });

  await runCheck('delivery map GPS, zoom, sale persistence, receipt preview', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 14.12345, longitude: 121.54321 } }) },
      });
    });
    await page.click('.product-card[data-id]');
    await page.click('.fulfil-pill[data-fulfil="delivery"]');
    await page.fill('#deliveryAddrInput', 'GPS delivery test');
    await page.click('#deliveryPinBtn');
    await page.waitForSelector('#deliveryMapModal:not([hidden])');
    await page.waitForTimeout(250);
    const box = await page.locator('#deliveryMapStage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -800);
    await page.mouse.wheel(0, -800);
    await page.click('#deliveryMapSave');
    await page.click('#deliverySaveBtn');
    await page.click('#payBtn');
    await page.click('[data-co-cash="exact"]');
    await page.click('#checkoutCompleteBtn');
    await page.waitForSelector('.view-checkout-success.active');
    const result = await page.evaluate(() => {
      const order = JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]')[0] || {};
      return {
        fulfilment: order.fulfilment,
        deliveryAddress: order.deliveryAddress,
        deliveryLocation: order.deliveryLocation,
        receiptHasMap: !!document.querySelector('.rp-map-thumb'),
      };
    });
    if (result.fulfilment !== 'delivery') throw new Error('sale did not save as delivery');
    if (result.deliveryAddress !== 'GPS delivery test') throw new Error('delivery address was not saved');
    if (!result.deliveryLocation || result.deliveryLocation.zoom < 18) throw new Error('delivery pin was not saved with close zoom');
    if (!result.receiptHasMap) throw new Error('receipt preview is missing delivery map');
  });

  await runCheck('offline sale persists while already loaded', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await context.setOffline(true);
    await page.click('.product-card[data-id]');
    await page.click('#payBtn');
    await page.click('[data-co-cash="exact"]');
    await page.click('#checkoutCompleteBtn');
    await page.waitForSelector('.view-checkout-success.active');
    const count = await page.evaluate(() => JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]').length);
    await context.setOffline(false);
    if (count !== 1) throw new Error(`expected 1 offline order, got ${count}`);
  });

  await runCheck('saved receipt does not complete sale or reduce stock', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.click('.product-card[data-id]');
    const before = await page.evaluate(() => {
      const id = eval('state').cart[0].id;
      const product = eval('state').products.find(p => p.id === id);
      return { id, stock: product.stock };
    });
    await page.click('#saveBtn');
    await page.click('#saveReceiptConfirmBtn');
    const result = await page.evaluate((productId) => {
      const order = JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]')[0] || {};
      const stored = JSON.parse(localStorage.getItem('hwpos.products.v2') || '[]').find(p => p.id === productId);
      const live = eval('state').products.find(p => p.id === productId);
      const product = stored || live;
      return { order, stock: product?.stock };
    }, before.id);
    if (result.order.status !== 'saved' || result.order.paymentMethod !== 'unpaid') throw new Error('saved receipt was not stored as unpaid draft');
    if (result.stock !== before.stock) throw new Error(`saved receipt changed stock from ${before.stock} to ${result.stock}`);
  });

  await runCheck('completed sale reduces stock and reload preserves order', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.click('.product-card[data-id]');
    const before = await page.evaluate(() => {
      const id = eval('state').cart[0].id;
      const product = eval('state').products.find(p => p.id === id);
      return { id, stock: product.stock };
    });
    await page.click('#payBtn');
    await page.click('[data-co-cash="exact"]');
    await page.click('#checkoutCompleteBtn');
    await page.waitForSelector('.view-checkout-success.active');
    await page.reload({ waitUntil: 'networkidle' });
    const result = await page.evaluate((productId) => {
      const orders = JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]');
      const product = JSON.parse(localStorage.getItem('hwpos.products.v2') || '[]').find(p => p.id === productId);
      return { orderCount: orders.length, stock: product?.stock };
    }, before.id);
    if (result.orderCount !== 1) throw new Error(`order was not preserved after reload, got ${result.orderCount}`);
    if (result.stock !== before.stock - 1) throw new Error(`stock should be ${before.stock - 1}, got ${result.stock}`);
  });

  await runCheck('void and refund restore stock and require manager', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    const result = await page.evaluate(() => {
      state.role = 'manager';
      state.products = loadProducts().map(p => ({ ...p, stock: Math.max(5, Number(p.stock) || 5) }));
      saveProducts();
      const product = state.products.find(p => p.stock > 0 && p.price > 0);
      const before = product.stock;
      addToCart(product.id);
      document.querySelector('#checkoutTender').value = String(cartTotals().total);
      state.paymentMethod = 'cash';
      completeSale();
      const sold = loadOrders()[0];
      const afterSale = state.products.find(p => p.id === product.id).stock;
      state.role = 'cashier';
      const denied = voidOrder(sold.id, 'cashier attempt');
      state.role = 'manager';
      const voided = voidOrder(sold.id, 'manager void');
      const afterVoid = state.products.find(p => p.id === product.id).stock;

      clearCart();
      addToCart(product.id);
      document.querySelector('#checkoutTender').value = String(cartTotals().total);
      state.paymentMethod = 'cash';
      completeSale();
      const second = loadOrders()[0];
      const afterSecondSale = state.products.find(p => p.id === product.id).stock;
      const refunded = refundOrder(second.id, 'manager refund');
      const afterRefund = state.products.find(p => p.id === product.id).stock;
      return {
        before,
        afterSale,
        denied: denied == null,
        voidedStatus: voided?.status,
        afterVoid,
        afterSecondSale,
        refundedStatus: refunded?.status,
        afterRefund,
      };
    });
    if (!result.denied) throw new Error('cashier was allowed to void');
    if (result.voidedStatus !== 'voided') throw new Error('void did not set status');
    if (result.refundedStatus !== 'refunded') throw new Error('refund did not set status');
    if (result.afterSale !== result.before - 1 || result.afterVoid !== result.before) throw new Error(`void stock mismatch ${JSON.stringify(result)}`);
    if (result.afterSecondSale !== result.before - 1 || result.afterRefund !== result.before) throw new Error(`refund stock mismatch ${JSON.stringify(result)}`);
  });

  await runCheck('exchange refunds original and creates replacement sale', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    const result = await page.evaluate(() => {
      state.role = 'manager';
      state.products = loadProducts().map(p => ({ ...p, stock: Math.max(5, Number(p.stock) || 5) }));
      saveProducts();
      const sellable = state.products.filter(p => p.stock > 0 && p.price > 0);
      const originalProduct = sellable[0];
      const replacement = sellable[1];
      const originalBefore = originalProduct.stock;
      const replacementBefore = replacement.stock;
      addToCart(originalProduct.id);
      document.querySelector('#checkoutTender').value = String(cartTotals().total);
      completeSale();
      const originalOrder = loadOrders()[0];
      const exchanged = exchangeOrder(originalOrder.id, [{ id: replacement.id, qty: 1 }], 'test exchange');
      const orders = loadOrders();
      return {
        originalStatus: orders.find(o => o.id === originalOrder.id)?.status,
        exchangeStatus: exchanged?.exchangeSale?.status,
        exchangeOriginalId: exchanged?.exchangeSale?.originalOrderId,
        originalStock: state.products.find(p => p.id === originalProduct.id).stock,
        replacementStock: state.products.find(p => p.id === replacement.id).stock,
        originalBefore,
        replacementBefore,
      };
    });
    if (result.originalStatus !== 'refunded') throw new Error(`original was not refunded ${JSON.stringify(result)}`);
    if (result.exchangeStatus !== 'completed') throw new Error(`replacement sale was not completed ${JSON.stringify(result)}`);
    if (!result.exchangeOriginalId) throw new Error('exchange sale did not reference original order');
    if (result.originalStock !== result.originalBefore) throw new Error(`original stock not restored ${JSON.stringify(result)}`);
    if (result.replacementStock !== result.replacementBefore - 1) throw new Error(`replacement stock not reduced ${JSON.stringify(result)}`);
  });

  await runCheck('customer credit ledger and payment reduce utang', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    const result = await page.evaluate(() => {
      state.role = 'manager';
      state.customers = [];
      saveSavedCustomers();
      state.customerLedger = [];
      saveCustomerLedger();
      state.products = loadProducts().map(p => ({ ...p, stock: Math.max(5, Number(p.stock) || 5) }));
      saveProducts();
      state.customer = allCustomerRecords()[0];
      const customerId = state.customer.id;
      const startingBalance = Number(state.customer.currentBalance) || 0;
      addToCart(state.products.find(p => p.stock > 0 && p.price > 0).id);
      const total = cartTotals().total;
      state.paymentMethod = 'credit';
      completeSale();
      const charged = loadSavedCustomers().find(c => c.id === customerId);
      recordCreditPayment(customerId, Math.min(50, total), 'test payment');
      const paid = loadSavedCustomers().find(c => c.id === customerId);
      const ledger = loadCustomerLedger();
      return { total, startingBalance, charged: charged.currentBalance, paid: paid.currentBalance, ledgerTypes: ledger.map(x => x.type) };
    });
    if (result.charged !== result.startingBalance + result.total) throw new Error(`credit charge mismatch ${JSON.stringify(result)}`);
    if (!(result.paid < result.charged)) throw new Error(`payment did not reduce balance ${JSON.stringify(result)}`);
    if (!result.ledgerTypes.includes('charge') || !result.ledgerTypes.includes('payment')) throw new Error('ledger missing charge/payment entries');
  });

  await runCheck('cash drawer closeout and reorder list', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    const result = await page.evaluate(() => {
      state.role = 'manager';
      state.products = loadProducts().map((p, i) => ({ ...p, stock: i === 0 ? 1 : Math.max(10, Number(p.stock) || 10), reorderPoint: i === 0 ? 5 : Number(p.reorderPoint) || 0 }));
      saveProducts();
      addToCart(state.products.find(p => p.stock > 1 && p.price > 0).id);
      const total = cartTotals().total;
      document.querySelector('#checkoutTender').value = String(total);
      state.paymentMethod = 'cash';
      completeSale();
      const summary = buildCashDrawerSummary();
      const closeout = closeCashDrawer({ countedCash: total + 20, notes: 'test' });
      const reorder = buildReorderList();
      return { total, summary, closeout, reorderFirst: reorder[0] };
    });
    if (result.summary.expectedCash !== result.total) throw new Error(`drawer expected cash mismatch ${JSON.stringify(result.summary)}`);
    if (result.closeout.difference !== 20) throw new Error(`drawer difference mismatch ${JSON.stringify(result.closeout)}`);
    if (!result.reorderFirst || result.reorderFirst.suggestedQty < 1) throw new Error('reorder list did not include low stock item');
  });

  await runCheck('orders search finds item names and statuses', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    const result = await page.evaluate(() => {
      state.products = loadProducts().map(p => ({ ...p, stock: Math.max(5, Number(p.stock) || 5) }));
      saveProducts();
      const product = state.products.find(p => p.stock > 0 && p.price > 0);
      addToCart(product.id);
      document.querySelector('#checkoutTender').value = String(cartTotals().total);
      completeSale();
      const created = loadOrders()[0];
      switchView('orders');
      state.ordersQuery = product.name.slice(0, 5).toLowerCase();
      renderOrders();
      const byItem = document.querySelector('#ordersList')?.innerText || '';
      const order = created;
      refundOrder(order.id, 'search status');
      state.ordersQuery = 'refunded';
      renderOrders();
      const byStatus = document.querySelector('#ordersList')?.innerText || '';
      return { productName: product.name, orderNumber: created.number, byItem, byStatus };
    });
    if (!result.byItem.includes(result.orderNumber)) throw new Error('item-name search did not find receipt');
    if (!/Refunded/i.test(result.byStatus)) throw new Error('status search did not find refunded receipt');
  });

  await runCheck('back office dashboard sees POS sale', async () => {
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.click('.product-card[data-id]');
    await page.click('#payBtn');
    await page.click('[data-co-cash="exact"]');
    await page.click('#checkoutCompleteBtn');
    await page.waitForSelector('.view-checkout-success.active');
    const bo = await context.newPage();
    await bo.goto(`${baseUrl}/backoffice.html`, { waitUntil: 'networkidle' });
    const dashboard = await bo.locator('body').innerText();
    await bo.close();
    if (!/Transactions\s+1\b/i.test(dashboard.replace(/\r?\n/g, ' '))) {
      throw new Error('Back Office dashboard did not show 1 transaction');
    }
  });

  await runCheck('full backup export and restore round trip', async () => {
    await page.goto(`${baseUrl}/backoffice.html#settings`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('hwpos.products.v2', JSON.stringify([{ id: 'p-test', name: 'Backup Test', sku: 'BKP-1', price: 10, stock: 3 }]));
      localStorage.setItem('hwpos.orders.v1', JSON.stringify([{ id: 'o-test', number: '1-1', status: 'completed', items: [], total: 0 }]));
      localStorage.setItem('hwpos.customers.v1', JSON.stringify([{ id: 'c-test', name: 'Backup Customer' }]));
      localStorage.setItem('hwpos.settings.v1', JSON.stringify({ store: { name: 'Backup Store' } }));
    });
    const backup = await page.evaluate(() => buildFullBackup());
    await page.evaluate(() => localStorage.clear());
    await page.evaluate((payload) => restoreFullBackup(payload), backup);
    const restored = await page.evaluate(() => ({
      products: JSON.parse(localStorage.getItem('hwpos.products.v2') || '[]').length,
      orders: JSON.parse(localStorage.getItem('hwpos.orders.v1') || '[]').length,
      customers: JSON.parse(localStorage.getItem('hwpos.customers.v1') || '[]').length,
      settings: JSON.parse(localStorage.getItem('hwpos.settings.v1') || '{}')?.store?.name,
    }));
    if (restored.products !== 1 || restored.orders !== 1 || restored.customers !== 1 || restored.settings !== 'Backup Store') {
      throw new Error(`restore mismatch: ${JSON.stringify(restored)}`);
    }
  });

  if (consoleErrors.length) {
    report.failures.push(...consoleErrors.map(e => `console error: ${e}`));
  }
  report.ok = report.failures.length === 0;
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
