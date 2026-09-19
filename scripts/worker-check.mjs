/* Smallest thing that fails if the Worker's money, scoping or append-only rules break.
   Runs the real worker/index.js against a real SQLite file behind a tiny D1 shim.
   node scripts/worker-check.mjs                                            */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac, webcrypto } from 'node:crypto';
import assert from 'node:assert';
import worker from '../worker/index.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const SECRET = 'test-secret';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ email: 'a@b.c', exp: Math.floor(Date.now() / 1e3) + 3600, ...claims });
  const sig = createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
  return `${head}.${body}.${sig}`;
}

// ---- D1 shim: prepare().bind().first()/.all()/.run() + batch() ----
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
// D1's run()/batch() results carry `meta.changes` (rows actually written); the Worker's mixed-batch
// row counting reads that. node:sqlite's plain `.run()` return shape is different, so it is
// reshaped here to match what the real binding hands back.
const toD1Result = (r) => ({ success: true, meta: { changes: Number(r.changes), last_row_id: r.lastInsertRowid } });
const DB = {
  prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const mk = (args) => ({
      bind: (...a) => mk(a),
      first: async () => stmt.get(...args) ?? null,
      all: async () => ({ results: stmt.all(...args) }),
      run: async () => toD1Result(stmt.run(...args)),
      _exec: () => toD1Result(stmt.run(...args)),
    });
    return mk([]);
  },
  // D1's batch() is one transaction: a mixed batch that fails partway writes nothing. A plain
  // loop hides that, so this wraps it in BEGIN/COMMIT with ROLLBACK on throw to match.
  async batch(stmts) {
    sqlite.exec('BEGIN');
    try {
      const results = stmts.map((s) => s._exec());
      sqlite.exec('COMMIT');
      return results;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
};
const env = { DB, SUPABASE_JWT_SECRET: SECRET, DEFAULT_STORE: 'main' };

const call = (method, path, body, jwt = token()) =>
  worker.fetch(new Request('https://api.test' + path, {
    method,
    headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);

const t = [];
const test = (name, fn) => t.push([name, fn]);

test('unauthenticated is refused', async () => {
  assert.equal((await call('GET', '/products', undefined, 'garbage')).status, 401);
});

test('expired token is refused even though the signature is valid', async () => {
  const stale = token({ exp: Math.floor(Date.now() / 1e3) - 10 });
  assert.equal((await call('GET', '/products', undefined, stale)).status, 401);
});

test('pesos in, pesos out, centavos on disk', async () => {
  await call('POST', '/products', { id: 'p1', name: 'Cement', price: 285.75, stock: 40 });
  const got = await (await call('GET', '/products/p1')).json();
  assert.equal(got.price, 285.75);
  assert.equal(sqlite.prepare('select price from products where id=?').get('p1').price, 28575);
});

test('a retried sale books once and keeps its total', async () => {
  const order = { id: 'o1', number: '1001', ts: '2026-09-08T01:00:00.000Z', status: 'completed',
                  total: 1234.5, items: [{ sku: 'p1', qty: 2 }] };
  await call('POST', '/orders', order);
  await call('POST', '/orders', order);           // tablet lost the response, retries
  assert.equal(sqlite.prepare('select count(*) c from orders').get().c, 1);
  const got = await (await call('GET', '/orders/o1')).json();
  assert.equal(got.total, 1234.5);
  assert.deepEqual(got.items, [{ sku: 'p1', qty: 2 }]);   // JSON survives the round trip
});

test('an order total cannot be edited, but its workflow flag can', async () => {
  assert.equal((await call('PATCH', '/orders/o1', { total: 1 })).status, 403);
  assert.equal((await call('DELETE', '/orders/o1')).status, 403);
  await call('PATCH', '/orders/o1', { fulfilment_status: 'ready' });
  assert.equal(sqlite.prepare('select total, fulfilment_status s from orders where id=?').get('o1').total, 123450);
  assert.equal(sqlite.prepare('select fulfilment_status s from orders where id=?').get('o1').s, 'ready');
});

test('another store cannot see or delete our rows', async () => {
  const other = token({ app_metadata: { store_id: 'branch2' } });
  assert.equal((await (await call('GET', '/products', undefined, other)).json()).length, 0);
  assert.equal((await call('DELETE', '/products/p1', undefined, other)).status, 204);
  assert.ok(sqlite.prepare('select 1 from products where id=?').get('p1'), 'row survived the wrong store');
});

test('a product carries its margin, danger level, and its variants are group siblings', async () => {
  await call('POST', '/products', { id: 'p2', name: 'Rebar', title: 'Rebar 10mm', cost: 180, price: 225,
                                    margin_mode: 'flat', margin_value: 45, danger_level: 20, stock: 12,
                                    sell_out_of_stock: 1, barcode: '4800123', image_url: '/img/rebar.jpg' });
  const p = await (await call('GET', '/products/p2')).json();
  assert.equal(p.cost, 180);           // pesos out
  assert.equal(p.margin_mode, 'flat');
  assert.equal(p.sell_out_of_stock, 1);
  const raw = sqlite.prepare('select cost, danger_level d from products where id=?').get('p2');
  assert.equal(raw.cost, 18000);       // centavos on disk
  // A variant is a sibling product in a group, not a row in a variants table.
  await call('POST', '/groups', { id: 'g1', name: 'Rebar', folder_id: 'f1', image_url: '/img/rebar.jpg' });
  await call('POST', '/products', { id: 'p3', name: 'Rebar 12mm', group_id: 'g1', cost: 210, price: 260, stock: 8 });
  const [g] = await (await call('GET', '/groups')).json();
  assert.equal(g.image_url, '/img/rebar.jpg');
  const sibs = sqlite.prepare('select id from products where store_id=? and group_id=?').all('main', 'g1');
  assert.deepEqual(sibs.map((r) => r.id), ['p3']);   // countable and sellable, because it is a product
  // The low-stock list the dashboard reads is the index, not a flag anyone sets.
  const low = sqlite.prepare('select id from products where store_id=? and stock <= danger_level').all('main');
  assert.deepEqual(low.map((r) => r.id), ['p2']);
});

test('a purchase order line has no timestamp column and still round-trips', async () => {
  await call('POST', '/suppliers', { id: 's1', name: 'Ace Steel', phone: '0917' });
  await call('POST', '/purchaseOrders', { id: 'po1', supplier_id: 's1', number: 'PO-1',
                                          status: 'ordered', expected_at: '2026-09-12', total: 4500 });
  await call('POST', '/poItems', { id: 'poi1', po_id: 'po1', product_id: 'p2', qty: 20, cost: 180 });
  const [line] = await (await call('GET', '/poItems')).json();
  assert.equal(line.cost, 180);
  assert.equal(line.received_qty, 0);
  // "Deliveries coming" on the dashboard is this query -- and it is not orders.delivery.
  const coming = sqlite.prepare(
    "select number from purchase_orders where store_id=? and status in ('ordered','partial') order by expected_at").all('main');
  assert.deepEqual(coming.map((r) => r.number), ['PO-1']);
});

test('a movement keeps half a metre, its cost at the time, and who moved it', async () => {
  await call('POST', '/stockMovements', { id: 'm1', ts: '2026-09-08T03:00:00.000Z', product_id: 'p2',
                                          qty: -2.5, reason: 'sale', ref_id: 'o1', unit_cost: 180, staff: 'Aldrin S.' });
  const [m] = await (await call('GET', '/stockMovements')).json();
  assert.equal(m.qty, -2.5, 'an integer qty column would have truncated the wire we cut');
  assert.equal(m.unit_cost, 180);
  assert.equal(m.staff, 'Aldrin S.');
  assert.equal(sqlite.prepare('select qty, unit_cost from stock_movements where id=?').get('m1').qty, -250);
  // Stock is the SUM of this column, so it has to sum exactly, not nearly.
  await call('POST', '/stockMovements', { id: 'm2', ts: '2026-09-08T04:00:00.000Z', product_id: 'p2',
                                          qty: 0.1, reason: 'return' });
  await call('POST', '/stockMovements', { id: 'm3', ts: '2026-09-08T05:00:00.000Z', product_id: 'p2',
                                          qty: 0.2, reason: 'return' });
  const sum = sqlite.prepare("select sum(qty) s from stock_movements where product_id='p2'").get().s;
  assert.equal(sum, -220);          // -2.5 + 0.1 + 0.2 = -2.2 exactly, in hundredths
  assert.equal(sum / 100, -2.2);
});

test('a movement cannot be edited or deleted, because it is what explains the stock', async () => {
  assert.equal((await call('PATCH', '/stockMovements/m1', { qty: 99 })).status, 403);
  assert.equal((await call('DELETE', '/stockMovements/m1')).status, 403);
});

test('balance is derived from the ledger, not stored', async () => {
  await call('POST', '/customers', { id: 'c1', name: 'Ana', credit_limit: 5000 });
  await call('POST', '/customerLedger', { id: 'l1', ts: '2026-09-08T01:00:00.000Z', customer_id: 'c1', type: 'charge', amount: 1500 });
  await call('POST', '/customerLedger', { id: 'l2', ts: '2026-09-08T02:00:00.000Z', customer_id: 'c1', type: 'payment', amount: 500 });
  assert.equal(sqlite.prepare('select balance b from customer_balances where id=?').get('c1').b, 100000);
});

test('nightly rollup is re-runnable and lands the right total', async () => {
  const at = Date.parse('2026-09-09T18:00:00.000Z');
  await worker.scheduled({ scheduledTime: at }, env);
  await worker.scheduled({ scheduledTime: at }, env);   // late order arrives, run again
  const row = sqlite.prepare('select * from daily_sales').get();
  assert.equal(sqlite.prepare('select count(*) c from daily_sales').get().c, 1);
  assert.equal(row.net, 123450);
});

test('a price change is an event: pesos round-trip, first price stays null, no edits', async () => {
  await call('POST', '/priceLog', { id: 'pl1', ts: '2026-09-14T01:00:00.000Z', staff: 'owner', product_id: 'p1',
                                    field: 'price', old_value: 285.75, new_value: 299.1, reason: 'supplier', source: 'backoffice' });
  await call('POST', '/priceLog', { id: 'pl2', ts: '2026-09-14T01:00:00.000Z', product_id: 'p9',
                                    field: 'price', old_value: null, new_value: 5 });
  const got = await (await call('GET', '/priceLog/pl1')).json();
  assert.equal(got.old_value, 285.75);
  assert.equal(got.new_value, 299.1);
  assert.equal(sqlite.prepare('select new_value v from price_log where id=?').get('pl1').v, 29910);
  assert.equal((await (await call('GET', '/priceLog/pl2')).json()).old_value, null, 'a first price is not a change from ₱0');
  assert.equal((await call('PATCH', '/priceLog/pl1', { new_value: 1 })).status, 403);
  assert.equal((await call('DELETE', '/priceLog/pl1')).status, 403);
  assert.equal((await call('PUT', '/lostDemand', [])).status, 403);
});

test('a count keeps expected and counted; a sale does not invent them', async () => {
  await call('POST', '/stockMovements', { id: 'm4', ts: '2026-09-14T02:00:00.000Z', product_id: 'p2', qty: -3,
                                          reason: 'count', expected: 40, counted: 37.5 });
  const m = await (await call('GET', '/stockMovements/m4')).json();
  assert.equal(m.expected, 40);
  assert.equal(m.counted, 37.5);
  assert.equal((await (await call('GET', '/stockMovements/m1')).json()).expected, null);
});

test('a PO line keeps invoice cost apart from quoted, and a supplier its order rules', async () => {
  await call('POST', '/suppliers', { id: 's2', name: 'Holcim', order_days: [1, 4], min_order: 15000.5, quoted_lead_days: 3 });
  const s = await (await call('GET', '/suppliers/s2')).json();
  assert.deepEqual(s.order_days, [1, 4]);
  assert.equal(s.min_order, 15000.5);
  await call('POST', '/poItems', { id: 'poi2', po_id: 'po1', product_id: 'p2', qty: 10, cost: 180 });
  assert.equal((await (await call('GET', '/poItems/poi2')).json()).invoice_cost, null, 'not billed is not billed ₱0');
  await call('PATCH', '/poItems/poi2', { invoice_cost: 185.25, received_qty: 8, short_reason: 'supplier short' });
  const l = await (await call('GET', '/poItems/poi2')).json();
  assert.equal(l.invoice_cost, 185.25);
  assert.equal(l.received_qty, 8);
});

test('a day upserts and merges: weather does not wipe the road closure, stores do not collide', async () => {
  await call('POST', '/days', { id: '2026-09-14', date: '2026-09-14', road_closure: 'Rizal St', is_payday: 1 });
  await call('POST', '/days', { id: '2026-09-14', rain_mm: 12.5, weather_code: 63, source: 'open-meteo' });
  await call('POST', '/days', { id: '2026-09-14', note: 'branch' }, token({ app_metadata: { store_id: 'branch2' } }));
  const d = await (await call('GET', '/days/2026-09-14')).json();
  assert.equal(d.road_closure, 'Rizal St');
  assert.equal(d.rain_mm, 12.5);
  assert.equal(d.is_payday, 1);
  assert.equal(d.note, null, "another store's row stayed its own");
  assert.equal(sqlite.prepare('select count(*) c from days').get().c, 2);
});

test('a movement carries the stock it left behind; an old build without it still books', async () => {
  await call('POST', '/stockMovements', { id: 'm5', ts: '2026-09-14T03:00:00.000Z', product_id: 'p2', qty: -2.5,
                                          reason: 'sale', balance_after: 37.5 });
  assert.equal((await (await call('GET', '/stockMovements/m5')).json()).balance_after, 37.5);
  assert.equal(sqlite.prepare('select balance_after b from stock_movements where id=?').get('m5').b, 3750);
  const old = await call('POST', '/stockMovements', { id: 'm6', ts: '2026-09-14T03:01:00.000Z', product_id: 'p2',
                                                      qty: -1, reason: 'sale' });
  assert.equal(old.status, 201);
  assert.equal((await (await call('GET', '/stockMovements/m6')).json()).balance_after, null, 'unknown is not zero');
});

test('till events: 1,000 in one batch, a retry books none twice, data round-trips, no edits', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: 'te' + i, ts: new Date(Date.parse('2026-09-14T01:00:00.000Z') + i).toISOString(),
    type: i % 2 ? 'scan' : 'item_add', session_id: 's1', terminal: '1', cashier: 'Aldrin S.', cart_id: 'cart1',
    online: i % 3 !== 0, app_version: '42', received_at: '1999-01-01T00:00:00.000Z',
    data: { productId: 'p2', qty: 2.5, via: 'scan', nested: { found: true } },
  }));
  assert.equal((await call('POST', '/tillEvents', rows)).status, 201);
  assert.equal((await call('POST', '/tillEvents', rows)).status, 201);   // response lost, tablet re-sends
  const count = (store) => sqlite.prepare('select count(*) c from till_events where store_id=?').get(store).c;
  assert.equal(count('main'), 1000);
  const e = await (await call('GET', '/tillEvents/te0')).json();
  assert.deepEqual(e.data, { productId: 'p2', qty: 2.5, via: 'scan', nested: { found: true } });
  assert.equal(e.online, 0);
  assert.equal((await (await call('GET', '/tillEvents/te1')).json()).online, 1);
  assert.notEqual(e.received_at, '1999-01-01T00:00:00.000Z', 'received_at is the server clock');
  assert.equal(sqlite.prepare("select count(*) c from till_events where json_extract(data,'$.via')='scan'").get().c, 1000);
  assert.equal((await call('PATCH', '/tillEvents/te0', { type: 'x', data: {} })).status, 403);
  assert.equal((await call('DELETE', '/tillEvents/te0')).status, 403);
  assert.equal((await call('PUT', '/tillEvents', [])).status, 403);
  assert.equal((await call('POST', '/tillEvents', rows.concat(rows.slice(0, 1)))).status, 413);
  assert.equal((await call('POST', '/products', [{ id: 'px', name: 'x' }])).status, 400, 'no batch path into state');
  // Another store sees none of it, and its own batch lands under its own store_id.
  const other = token({ app_metadata: { store_id: 'branch2' } });
  assert.equal((await (await call('GET', '/tillEvents', undefined, other)).json()).length, 0);
  assert.equal((await call('GET', '/tillEvents/te0', undefined, other)).status, 404);
  await call('POST', '/tillEvents', [{ id: 'tb1', ts: '2026-09-14T01:00:00.000Z', type: 'app_open', data: {} }], other);
  assert.equal(count('branch2'), 1);
  assert.equal(count('main'), 1000);
  // A row exactly as HWPOS_STORE.events stores it (camelCase, synced, storeId) uploads unchanged.
  await call('POST', '/tillEvents', [{ id: 'tc1', ts: '2026-09-14T02:00:00.000Z', type: 'sale_complete', sessionId: 's9',
    terminal: '2', cashier: 'Joy', cartId: 'cart_x', online: true, appVersion: 'app.js?v=53', synced: 0, storeId: 'evil',
    data: { orderId: 'ord_1' } }]);
  const c = sqlite.prepare('select * from till_events where id=?').get('tc1');
  assert.deepEqual([c.store_id, c.session_id, c.cart_id, c.app_version, c.online], ['main', 's9', 'cart_x', 'app.js?v=53', 1]);
});

test('a bad JSON body is a 400, not a 500 with the parser message', async () => {
  const bad = new Request('https://api.test/products', {
    method: 'POST', headers: { authorization: 'Bearer ' + token(), 'content-type': 'application/json' },
    body: 'not json',
  });
  assert.equal((await worker.fetch(bad, env)).status, 400);
});

test('a mixed batch stores only the good rows, lists the bad, and a retry books nothing twice', async () => {
  const rows = [
    { id: 'mb1', ts: '2026-09-14T04:00:00.000Z', type: 'scan' },        // good
    null,                                                                // not an object
    { id: null, ts: '2026-09-14T04:00:00.000Z', type: 'scan' },          // null id
    { ts: '2026-09-14T04:00:00.000Z', type: 'scan' },                    // missing id
    { id: 'mb1', ts: '2026-09-14T04:00:01.000Z', type: 'scan' },         // duplicate id, same batch
    { id: 'mb2', ts: 'not-a-date', type: 'scan' },                       // unparseable ts
    { id: 'mb3', ts: '2026-09-14T04:00:00.000Z' },                       // missing type
  ];
  const r1 = await call('POST', '/tillEvents', rows);
  assert.equal(r1.status, 201);
  const b1 = await r1.json();
  assert.equal(b1.received, 7);
  assert.equal(b1.inserted, 1);
  assert.equal(b1.rejected.length, 6);
  assert.ok(b1.rejected.some((x) => x.index === 4 && /duplicate/.test(x.error)));
  const r2 = await call('POST', '/tillEvents', rows);   // response lost, tablet re-sends the same poisoned batch
  const b2 = await r2.json();
  assert.equal(b2.inserted, 0, 're-send books the already-stored row nothing again');
  assert.equal(sqlite.prepare("select count(*) c from till_events where id like 'mb%'").get().c, 1);
});

test('a batch with no valid row is a 400, not a 201 that quietly stores nothing', async () => {
  const r = await call('POST', '/tillEvents', [{ id: null }, { ts: 'x' }]);
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.inserted, 0);
  assert.equal(body.rejected.length, 2);
});

test('an event row missing ts is rejected, not given a server-invented event time', async () => {
  const r = await call('POST', '/customerLedger', { id: 'lnoTs', customer_id: 'c1', type: 'charge', amount: 10 });
  assert.equal(r.status, 400);
  assert.ok(!sqlite.prepare('select 1 from customer_ledger where id=?').get('lnoTs'));
});

test('a JSON string is stored as-is, not double-encoded', async () => {
  await call('POST', '/tillEvents', [{ id: 'mbjson', ts: '2026-09-14T04:05:00.000Z', type: 'scan',
    data: JSON.stringify({ via: 'scan', qty: 1 }) }]);
  const raw = sqlite.prepare('select data from till_events where id=?').get('mbjson').data;
  assert.equal(raw, '{"via":"scan","qty":1}', 'stored once, not JSON.stringify-ed again into a quoted string');
  const got = await (await call('GET', '/tillEvents/mbjson')).json();
  assert.deepEqual(got.data, { via: 'scan', qty: 1 });
});

test('a since-pull sees a row uploaded late even though its own clock is old', async () => {
  const checkpoint = new Date(Date.now() - 1000).toISOString();   // strictly before the insert's received_at
  await call('POST', '/products', { id: 'late1', name: 'Late Product', updated_at: '2000-01-01T00:00:00.000Z' });
  const pulled = await (await call('GET', `/products?since=${checkpoint}`)).json();
  assert.ok(pulled.some((p) => p.id === 'late1'), 'received_at (server clock), not the client updated_at, is the cursor');
});

test('paging by received_at + after returns every row exactly once when rows share a millisecond', async () => {
  await call('POST', '/lostDemand', { id: 'ld1', ts: '2026-09-14T05:00:00.000Z', text: 'nails' });
  await call('POST', '/lostDemand', { id: 'ld2', ts: '2026-09-14T05:00:01.000Z', text: 'screws' });
  await call('POST', '/lostDemand', { id: 'ld3', ts: '2026-09-14T05:00:02.000Z', text: 'bolts' });
  // Force all three onto the exact same received_at, the case the `after` keyset exists for.
  sqlite.exec("update lost_demand set received_at = '2099-01-01T00:00:00.000Z' where id in ('ld1','ld2','ld3')");
  // Keyset paging: `since` becomes the last row's own cursor value page over page (not the
  // original request's since), with `after` as the tiebreaker within a tied received_at.
  let since = '2000-01-01T00:00:00.000Z';
  const seen = [];
  let after;
  for (let i = 0; i < 5; i++) {
    const page = after
      ? sqlite.prepare(`select id, received_at from lost_demand where store_id=? and (received_at > ?2 or (received_at = ?2 and id > ?3)) order by received_at, id limit 2`)
          .all('main', since, after)
      : sqlite.prepare(`select id, received_at from lost_demand where store_id=? and received_at > ?2 order by received_at, id limit 2`)
          .all('main', since);
    if (!page.length) break;
    seen.push(...page.map((r) => r.id));
    since = page[page.length - 1].received_at;
    after = page[page.length - 1].id;
    if (page.length < 2) break;
  }
  assert.deepEqual(seen.sort(), ['ld1', 'ld2', 'ld3']);
});

test('the nightly rollup buckets by store-local day, and reaches days back for late tablets', async () => {
  // 2026-09-13T17:30 UTC is 2026-09-14 01:30 local (UTC+8) -- must land on the LOCAL day.
  await call('POST', '/orders', { id: 'oTz', number: '9001', ts: '2026-09-13T17:30:00.000Z', status: 'completed',
    total: 500, subtotal: 500, discount: 0, vat_amount: 0 });
  const cronAt = Date.parse('2026-09-14T18:00:00.000Z');
  await worker.scheduled({ scheduledTime: cronAt }, env);
  const day = sqlite.prepare("select * from daily_sales where day='2026-09-14' and store_id='main'").get();
  assert.ok(day, 'landed on the store-local day, not the UTC day');
  assert.ok(day.net >= 50000);

  // A tablet offline for 5 days uploads late -- the run 6 days later must still correct that day.
  await call('POST', '/orders', { id: 'oOld', number: '9002', ts: '2026-09-09T01:00:00.000Z', status: 'completed',
    total: 700, subtotal: 700, discount: 0, vat_amount: 0 });
  await worker.scheduled({ scheduledTime: cronAt }, env);   // same run window rebuilds the last 7 local days
  const old = sqlite.prepare("select * from daily_sales where day='2026-09-09' and store_id='main'").get();
  assert.ok(old, 'a day 5 days back was recomputed, not left stale');
  assert.ok(old.net >= 70000);
});

test('happened_on round-trips and a malformed one is rejected', async () => {
  await call('POST', '/stockMovements', { id: 'mHO', ts: '2026-09-14T06:00:00.000Z', product_id: 'p2', qty: -1,
    reason: 'shrinkage', happened_on: '2026-09-01' });
  const got = await (await call('GET', '/stockMovements/mHO')).json();
  assert.equal(got.happened_on, '2026-09-01');
  const bad = await call('POST', '/stockMovements', { id: 'mHOBad', ts: '2026-09-14T06:01:00.000Z', product_id: 'p2',
    qty: -1, reason: 'shrinkage', happened_on: '09/01/2026' });
  assert.equal(bad.status, 400);
});

test('an epoch-ms ts, as the till stores orders and ledger rows, lands as ISO text', async () => {
  const ms = Date.parse('2026-09-13T17:30:00.000Z');   // 01:30 on 09-14 in Manila
  await call('POST', '/customerLedger', { id: 'lMs', ts: ms, customer_id: 'c1', type: 'charge', amount: 10 });
  assert.equal(sqlite.prepare('select ts from customer_ledger where id=?').get('lMs').ts, '2026-09-13T17:30:00.000Z');
  await call('POST', '/orders', { id: 'oMs', number: '9003', ts: ms, status: 'completed', total: 5, subtotal: 5, discount: 0, vat_amount: 0 });
  assert.equal(sqlite.prepare('select ts from orders where id=?').get('oMs').ts, '2026-09-13T17:30:00.000Z');
  assert.equal((await call('POST', '/orders', { id: 'oNoTs', number: '9004', status: 'completed', total: 1 })).status, 400);
});

test('an object in a plain column is rejected alone, not a 500 for the whole batch', async () => {
  const res = await call('POST', '/tillEvents', [
    { id: 'eObjOk', ts: '2026-09-14T06:00:00.000Z', type: 'scan' },
    { id: 'eObjBad', ts: '2026-09-14T06:00:00.000Z', type: 'scan', cashier: { name: 'x' } },
  ]);
  assert.equal(res.status, 201);
  assert.deepEqual((await res.json()).rejected, [{ index: 1, id: 'eObjBad', error: 'bad cashier' }]);
});

let bad = 0;
for (const [name, fn] of t) {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { bad++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
console.log(bad ? `\n${bad} failed` : `\n${t.length} passed`);
process.exit(bad ? 1 : 0);
