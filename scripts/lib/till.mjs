/* A headless till. Boots the REAL app.js (and data.js) in a node:vm realm behind a
   localStorage shim and a null-object DOM, so a whole trading day -- sales, credit, splits,
   voids, returns, refunds, stock -- can be rung from Node without a browser.

   The point is that it drives the shipped functions. `ring()` fills the real cart and calls
   the real `completeSale()`; `void`/`return`/`refund` call `voidOrder`/`recordReturn`/
   `refundOrder`. If the harness and the till ever disagree, the harness is wrong -- there is
   no second implementation of the money here to drift.

   import { boot } from './lib/till.mjs';
*/
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

// A DOM element that swallows everything. app.js renders on every mutation, so the harness
// needs the render calls to be harmless rather than stubbed one id at a time. Elements are
// remembered per selector, which is what lets the harness set #checkoutTender and have
// completeSale read it back.
function fakeEl(sel = '') {
  const el = {
    sel,
    value: '',
    textContent: '',
    innerHTML: '',
    innerText: '',
    hidden: false,
    disabled: false,
    checked: false,
    scrollTop: 0,
    offsetWidth: 800, clientWidth: 800, offsetHeight: 600, clientHeight: 600,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [], childNodes: [], parentElement: null, firstChild: null,
    focus() {}, blur() {}, click() {}, select() {}, remove() {}, scrollIntoView() {},
    appendChild(c) { this.children.push(c); return c; },
    insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, hasAttribute: () => false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }),
  };
  return el;
}

export function boot({ now = null, seed = true } = {}) {
  const storage = new Map();
  // A movable clock. Orders, movements and ledger entries all stamp themselves off `Date`,
  // so a year of trading is just this number walking forward -- no waiting, and every
  // date-bucketed report downstream gets real spread instead of 4,000 rows on one day.
  let clockAt = now;
  class TillDate extends Date {
    constructor(...a) { super(...(a.length ? a : [clockAt == null ? Date.now() : clockAt])); }
    static now() { return clockAt == null ? Date.now() : clockAt; }
  }
  const els = new Map();
  const el = (sel) => {
    if (!els.has(sel)) els.set(sel, fakeEl(sel));
    return els.get(sel);
  };
  const toasts = [];
  // Answer to window.confirm. Both manager overrides at checkout -- over the credit limit and
  // short of stock -- are a confirm(), so the harness has to be able to be the manager who
  // says no as well as the one who waves it through.
  let confirmAnswer = true;

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Date: TillDate, Math, Number, String, Array, Object, JSON, Set, Map, RegExp, Error, Promise,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
      key: (i) => [...storage.keys()][i] ?? null,
      get length() { return storage.size; },
    },
    document: {
      addEventListener() {}, removeEventListener() {},
      querySelector: (s) => el(s),
      querySelectorAll: () => [],
      getElementById: (id) => el('#' + id),
      createElement: () => fakeEl(),
      documentElement: fakeEl(':root'),
      body: fakeEl('body'),
      head: fakeEl('head'),
      hidden: false,
      visibilityState: 'visible',
    },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: (fn) => { fn(); return 0; }, cancelAnimationFrame() {},
    fetch: () => Promise.reject(new Error('offline')),
    alert() {},
    getComputedStyle: () => ({ getPropertyValue: () => '', width: '800px', height: '600px' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    location: { href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', search: '' },
    history: { pushState() {}, replaceState() {} },
    open: () => null,
    print() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    confirm: () => confirmAnswer,
    prompt: () => null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = createContext(sandbox);
  const load = (file) => new Script(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'),
    { filename: file }).runInContext(context);
  // Same realm, separate scripts: data.js's top-level consts become app.js's globals, and
  // `run()` below can reach app.js's own lexical `state` the same way.
  if (seed) load('data.js');
  load('bo-model.js');
  load('app.js');
  // app.js hydrates state on DOMContentLoaded, which never fires in here.
  new Script('init()', { filename: 'boot' }).runInContext(context);

  // Evaluate an expression against app.js's lexical scope. This is the whole harness.
  const run = (code) => new Script(code, { filename: 'till.mjs' }).runInContext(context);

  // A bridge installed once, so the hot paths are a plain function call instead of compiling
  // a fresh Script per lookup. Across a year that is a few hundred thousand compiles saved.
  run(`globalThis.__till = {
    snap: (v) => (v == null ? v : JSON.parse(JSON.stringify(v))),
    products: () => state.products,
    find: (k) => state.products.find(x => x.sku === k || x.id === k || x.name === k) || null,
    count: () => state.orders.length,
    newest: () => state.orders[0],
    order: (k) => state.orders.find(x => x.number === k || x.id === k) || null,
  };`);
  const H = sandbox.__till;

  const json = (k, fallback) => JSON.parse(storage.get(k) || fallback);
  // The till's live array, copied out. Reading it through `localStorage` meant re-parsing the
  // whole catalogue on every lookup, and a year of trading does a few hundred thousand.
  const products = () => H.snap(H.products());
  const bySku = (sku) => H.snap(H.find(sku));

  const orders = () => json('hwpos.orders.v1', '[]');
  const movements = (sku) => {
    const all = json('hwpos.stockMovements.v1', '[]');
    if (!sku) return all;
    const p = bySku(sku);
    return all.filter((m) => m.productId === (p && p.id));
  };
  const ledger = (customerId) => json('hwpos.customerLedger.v1', '[]')
    .filter((e) => !customerId || e.customerId === customerId);

  // What was on the shelf before the harness rang anything. The seed products carry a bare
  // `stock` with no movement behind it, so `cached === logged` can never hold on its own --
  // the invariant that actually means something is `cached === opening + logged`.
  const opening = new Map(products().map((p) => [p.id, Number(p.stock || 0)]));

  // Quantities are hundredths of a unit; float sums have to be pulled back to that grid or
  // 0.1 + 0.2 makes the reconciliation fail for reasons that have nothing to do with the till.
  const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const customerNamed = (name) => run('allCustomerRecords()').find((c) => c.name === name || c.id === name);

  // `[sku, qty]` or `[sku, qty, price]` -> the cart line shape app.js expects.
  const lines = (items = []) => items.map(([sku, qty, price]) => {
    const p = bySku(sku);
    if (!p) throw new Error(`no such product: ${sku}`);
    return { id: p.id, name: p.name, sku: p.sku, brand: p.brand, unit: p.unit,
             price: price != null ? price : p.price, qty };
  });

  function setCart({ items = [], customer = null, method = 'cash', discount = null,
                     fulfilment = 'pickup', address = '' }) {
    const cust = typeof customer === 'string' ? customerNamed(customer) : customer;
    if (customer && !cust) throw new Error(`no such customer: ${customer}`);
    run(`state.cart = ${JSON.stringify(lines(items))};
         state.customer = ${JSON.stringify(cust || null)};
         state.paymentMethod = ${JSON.stringify(method)};
         state.cartDiscount = ${JSON.stringify(discount)};
         state.fulfilment = ${JSON.stringify(fulfilment)};
         state.deliveryAddress = ${JSON.stringify(address)};`);
  }

  const till = {
    context, run, el, orders, movements, ledger, products, bySku, lines,
    /** Move the till's clock. Everything it writes from here on is stamped with this. */
    clock(ts) { clockAt = ts instanceof Date ? ts.getTime() : ts; return clockAt; },
    get toasts() { return toasts; },
    set confirm(v) { confirmAnswer = v; },

    totals: () => run('cartTotals()'),

    /** Ring a sale through the real completeSale(). Returns the order, or null if the till
     *  refused it (short tender, over limit, no customer on a charge). */
    ring(opts) {
      setCart(opts);
      const before = H.count();
      // Go through the checkout screen, not straight to `completeSale()`. The contractor and
      // wholesale price tiers are applied by `openPaymentModal()` -- a harness that skips it
      // rings every contractor sale at the walk-in price and would never notice.
      run('openPaymentModal()');
      // Then pick the method, the way the cashier taps a card on that screen. The checkout
      // resets to cash until one is chosen, so this has to come after the screen opens.
      run(`state.paymentMethod = ${JSON.stringify(opts.method || 'cash')};
           state.paymentMethodChosen = true;`);
      const tender = opts.tendered == null ? '' : String(opts.tendered);
      el('#checkoutTender').value = tender;
      el('#tenderInput').value = tender;
      el('#otherMethodInput').value = opts.otherName || '';
      confirmAnswer = opts.approve !== false;
      run('completeSale()');
      // Read the one new order out of the till's own array. `orders()` re-parses the whole
      // history, which is fine once and quadratic across a year of them.
      if (H.count() === before) return null;                    // refused; the error is on screen
      run('clearCart()');
      return H.snap(H.newest());
    },

    error: () => el('#checkoutError').textContent,

    void: (number) => till.op('voidOrder', number),
    refund: (number) => till.op('refundOrder', number),
    return: (number) => till.op('recordReturn', number),
    op(fn, number, ...rest) {
      const o = H.order(number);
      if (!o) throw new Error(`no such order: ${number}`);
      return H.snap(run(`${fn}(${[o.id, ...rest].map((a) => JSON.stringify(a)).join(', ')})`));
    },

    /** Opening stock, written as a movement so the log explains it like everything else. */
    setStock(sku, qty, { reason = 'adjustment', note = 'Opening stock' } = {}) {
      const p = bySku(sku);
      if (!p) throw new Error(`no such product: ${sku}`);
      const delta = qty - Number(p.stock || 0);
      if (!delta) return;
      run(`(() => { const p = state.products.find(x => x.id === ${JSON.stringify(p.id)});
             const mv = makeMovement({ productId: p.id, qty: ${delta}, reason: ${JSON.stringify(reason)},
               note: ${JSON.stringify(note)}, unitCost: p.cost, staff: 'Harness' });
             applyMovement(p, mv); appendMovements([mv]); saveProducts(); })()`);
    },

    /** Just what the shelf says. The log is not read, so this stays cheap in a loop. */
    onHand: (sku) => Number((H.find(sku) || {}).stock || 0),

    /** The two numbers that must never disagree: the cached field and opening + the log.
     *  Reads the whole movement log, so this is for reconciling, not for driving. */
    stock(sku) {
      const p = H.find(sku);
      const logged = round(movements(sku).reduce((n, m) => n + m.qty, 0));
      const open = opening.has(p.id) ? opening.get(p.id) : Number(p.stock || 0);
      return { cached: round(p.stock), opening: open, logged, expected: round(open + logged), product: p };
    },

    exchange: (number, items) => till.op('exchangeOrder', number,
      till.lines(items).map((l) => ({ id: l.id, qty: l.qty, price: l.price }))),

    /** Pay down an account. The other half of a credit sale, and the only thing that moves a
     *  balance without an order behind it. */
    payCredit(name, amount, note) {
      const c = customerNamed(name);
      if (!c) throw new Error(`no such customer: ${name}`);
      return run(`recordCreditPayment(${JSON.stringify(c.id)}, ${Number(amount)}, ${JSON.stringify(note || '')})`);
    },

    balance(name) {
      const c = customerNamed(name);
      return ledger(c && c.id).reduce((n, e) => n + (e.type === 'payment' ? -e.amount : e.amount), 0);
    },
  };
  return till;
}
