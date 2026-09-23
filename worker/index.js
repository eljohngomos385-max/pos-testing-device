/* ==========================================================
   Hardware POS — Worker API (Cloudflare Workers + D1)
   ----------------------------------------------------------
   D1 cannot be reached from a browser, so this is the only way in. Every
   tablet and every back-office tab talks to these routes and nothing else.

   The route shape is not invented here -- it is exactly the surface
   `createRemoteStore()` in data-store.js already documents:
     GET    /products          list        (?since=ISO for sync pulls)
     GET    /products/:id      get
     POST   /products          add
     PATCH  /products/:id      put
     DELETE /products/:id      remove
     PUT    /products          replaceAll
   ...for every collection, plus /health. Event tables also take POST [rows] as one batch.

   Paging contract for `?since=`: `since` is compared against `received_at` (the SERVER clock,
   set on every insert/update -- never the client's `ts`/`updated_at`, which a late-arriving
   offline tablet can backdate past what a reader already pulled). Ordered `received_at, id`,
   capped at 5000 rows. A caller that gets back exactly 5000 rows has more: repeat the same
   `since` with `&after=<lastRow.id>` to page past rows that share a `received_at` millisecond
   without skipping or repeating any. `purchaseOrders` compares `synced_received_at` instead --
   its own `received_at` column is a real business field (the PO's received-shipment date).

   Deploy: wrangler deploy    Secrets: wrangler secret put SUPABASE_JWT_SECRET
   ========================================================== */

// Money crosses the wire in PESOS and is stored in CENTAVOS. The conversion is
// here, not in the client, because there is one Worker and there will one day be
// tablets running a build nobody has updated in a year. The trust boundary owns it.
const TABLES = {
  products:       { money: ['price', 'cost'], json: [], stamp: 'updated_at', event: false,
                    cols: ['id', 'store_id', 'sku', 'barcode', 'name', 'unit', 'cost', 'price',
                           'margin_mode', 'margin_value', 'stock', 'danger_level', 'sell_out_of_stock',
                           'supplier_id', 'folder_id', 'group_id', 'weight', 'size', 'length', 'image_url',
                           'archived', 'updated_at'] },
  groups:         { table: 'product_groups', money: [], json: [], stamp: 'updated_at', event: false,
                    cols: ['id', 'store_id', 'name', 'folder_id', 'image_url', 'updated_at'] },
  suppliers:      { money: ['min_order'], json: ['order_days'], stamp: 'updated_at', event: false,
                    cols: ['id', 'store_id', 'name', 'contact', 'phone', 'email', 'address', 'note',
                           'order_days', 'min_order', 'quoted_lead_days', 'updated_at'] },
  // received_at here is the PO's own received-shipment date (a real column, client-settable);
  // the sync cursor lives in `synced_received_at` instead so the two never collide.
  purchaseOrders: { table: 'purchase_orders', money: ['total'], json: [], stamp: 'updated_at', event: false,
                    cursor: 'synced_received_at',
                    cols: ['id', 'store_id', 'supplier_id', 'number', 'status', 'ordered_at', 'sent_at',
                           'promised_at', 'expected_at', 'received_at', 'total', 'note', 'updated_at'] },
  poItems:        { table: 'purchase_order_items', money: ['cost', 'invoice_cost'], scaled: ['qty', 'received_qty'],
                    nullable: ['invoice_cost'], json: [], stamp: '', event: false,
                    cols: ['id', 'store_id', 'po_id', 'product_id', 'qty', 'cost', 'received_qty',
                           'invoice_cost', 'short_reason'] },
  customers:      { money: ['credit_limit'], json: [], stamp: 'updated_at', event: false,
                    cols: ['id', 'store_id', 'name', 'phone', 'address', 'credit_limit', 'updated_at'] },
  orders:         { money: ['subtotal', 'discount', 'total', 'vat_amount'], json: ['items', 'payments', 'delivery'],
                    stamp: 'synced_at', event: true, patchable: ['fulfilment_status'], required: ['number', 'status', 'ts'],
                    cols: ['id', 'store_id', 'number', 'ts', 'status', 'cashier', 'register', 'customer_id',
                           'payment_method', 'subtotal', 'discount', 'total', 'vat_amount', 'items', 'payments',
                           'fulfilment', 'delivery', 'fulfilment_status', 'synced_at'] },
  customerLedger: { table: 'customer_ledger', money: ['amount'], json: [], stamp: 'ts', event: true,
                    required: ['customer_id', 'type', 'amount'],
                    cols: ['id', 'store_id', 'ts', 'customer_id', 'type', 'amount', 'order_id', 'note'] },
  stockMovements: { table: 'stock_movements', money: ['unit_cost'], scaled: ['qty', 'expected', 'counted', 'balance_after'],
                    nullable: ['expected', 'counted', 'balance_after', 'happened_on'], json: [], stamp: 'ts', event: true,
                    required: ['product_id', 'qty', 'reason'],
                    cols: ['id', 'store_id', 'ts', 'product_id', 'qty', 'reason', 'ref_id',
                           'unit_cost', 'staff', 'note', 'expected', 'counted', 'balance_after', 'happened_on'] },
  // The till's tap stream (HWPOS_STORE.events). received_at is the DB default, never the client's.
  tillEvents:     { table: 'till_events', money: [], json: ['data'], stamp: 'ts', event: true, required: ['type'],
                    cols: ['id', 'store_id', 'ts', 'type', 'session_id', 'terminal', 'cashier', 'cart_id',
                           'online', 'app_version', 'data'] },
  // Event logs (bo-model.js EVENT_LOGS). Route name = the client log name.
  priceLog:       { table: 'price_log', money: ['old_value', 'new_value'], nullable: ['old_value'],
                    json: [], stamp: 'ts', event: true, required: ['product_id', 'field', 'new_value'],
                    cols: ['id', 'store_id', 'ts', 'staff', 'product_id', 'field', 'old_value', 'new_value',
                           'reason', 'source'] },
  lostDemand:     { table: 'lost_demand', money: [], scaled: ['qty'], nullable: ['qty'], json: [], stamp: 'ts', event: true,
                    cols: ['id', 'store_id', 'ts', 'staff', 'product_id', 'text', 'qty', 'reason',
                           'substitute_product_id', 'terminal'] },
  deliveryEvents: { table: 'delivery_events', money: [], json: [], stamp: 'ts', event: true, required: ['order_id', 'event'],
                    cols: ['id', 'store_id', 'ts', 'staff', 'order_id', 'event', 'driver', 'lat', 'lng', 'note',
                           'terminal'] },
  supplierMessages: { table: 'supplier_messages', money: [], json: [], stamp: 'ts', event: true, required: ['direction'],
                    cols: ['id', 'store_id', 'ts', 'staff', 'supplier_id', 'po_id', 'direction', 'channel', 'text'] },
  decisions:      { money: [], json: ['inputs', 'choice'], stamp: 'ts', event: true, required: ['kind'],
                    cols: ['id', 'store_id', 'ts', 'staff', 'kind', 'subject_id', 'inputs', 'rule', 'choice',
                           'accepted', 'actor'] },
};

const json = (body, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body),
    { status: body === null ? 204 : status, headers: { 'content-type': 'application/json' } });
const fail = (status, msg) => json({ error: msg }, status);

// ---- Auth: Supabase issues the JWT, we only check it ----
// ponytail: HS256 against the project's legacy JWT secret -- one WebCrypto call and
// no key fetching. Move to JWKS + RS256 if the project switches to asymmetric keys.
const b64url = (s) => atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));

async function verify(token, secret) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s || !secret) return null;
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(b64url(s), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(h + '.' + p));
    if (!ok) return null;
    const claims = JSON.parse(b64url(p));
    // An expired token is not a token. Without this the signature alone would let a
    // leaked session work forever.
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch (_) { return null; }
}

// ---- Row conversion, both directions ----
// Only the columns the caller actually sent, so the schema's DEFAULTs still apply.
// Nulling an absent column instead would push NULL into `not null default 0` and
// the whole insert would fail.
function toRow(t, obj, user) {
  const row = { store_id: user.store_id };
  for (const c of t.cols) {
    if (c === 'store_id') continue;
    // snake_case, or the client's own camelCase (session_id <- sessionId), so a tablet uploads its rows as stored.
    let v = obj[c] !== undefined ? obj[c] : obj[c.replace(/_(\w)/g, (_, x) => x.toUpperCase())];
    if (v === undefined) continue;
    // The till keeps orders.ts and customerLedger.ts as epoch ms; D1 keeps ISO text, which ?since=
    // and the rollup's date(ts, ...) read. A numeric date column is converted here, once.
    if (typeof v === 'number' && Number.isFinite(v) && (c === 'ts' || c.endsWith('_at'))) v = new Date(v).toISOString();
    // `nullable` columns keep null: an invoice not yet billed is not a ₱0 invoice.
    if (v === null && (t.nullable || []).includes(c)) v = null;
    else if (t.money.includes(c) || (t.scaled || []).includes(c)) v = Math.round(Number(v || 0) * 100);
    else if (t.json.includes(c)) {
      // Already a JSON string (a retry re-sending what we stored) -> keep it. Otherwise it is a
      // live value that still needs encoding. JSON.stringify-ing an already-encoded string would
      // double-encode it, so a stored row would read back as a string, not the object it was.
      if (v !== null && typeof v === 'string') { try { JSON.parse(v); } catch (_) { v = JSON.stringify(v); } }
      else if (v !== null) v = JSON.stringify(v);
    }
    else if (typeof v === 'boolean') v = v ? 1 : 0;   // SQLite has no boolean; `online: true` is 1
    row[c] = v;
  }
  // received_at / synced_received_at is the sync cursor, server clock only -- it is deliberately
  // never in t.cols, so a client value for it can never reach `row` here.
  // Only invent a missing stamp for STATE columns (updated_at/synced_at). A missing 'ts' on an
  // event row is now a validation error (rowError), not a server-invented event time.
  if (t.stamp && t.stamp !== 'ts' && !row[t.stamp]) row[t.stamp] = new Date().toISOString();
  return row;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The row check every insert (single or batched) runs before it ever reaches SQL: a bad row here
// is a 400/rejected entry, not a 500 that poisons a whole batch (D1 batch is one transaction).
function rowError(t, o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 'row is not an object';
  if (typeof o.id !== 'string' || !o.id) return 'missing id';
  if (t.stamp === 'ts') {
    const ts = o.ts;
    if (!Number.isFinite(ts) && (typeof ts !== 'string' || Number.isNaN(Date.parse(ts)))) return 'missing or unparseable ts';
  }
  // Columns that are `not null` with no default: absent here means toRow will skip the key
  // entirely and the insert dies on a constraint -- which, inside a batch, fails every row in
  // it. Empty string fails too (a blank reason is not a reason); 0/false are legitimate values.
  for (const c of t.required || []) {
    const v = o[c] !== undefined ? o[c] : o[c.replace(/_(\w)/g, (_, x) => x.toUpperCase())];
    if (v === undefined || v === null || v === '') return `missing ${c}`;
  }
  // An object or array in a plain column cannot be bound by D1: inside a batch that one row would
  // 500 every row with it. store_id is never read from the client (toRow).
  for (const c of t.cols) {
    if (c === 'store_id' || t.json.includes(c)) continue;
    const v = o[c] !== undefined ? o[c] : o[c.replace(/_(\w)/g, (_, x) => x.toUpperCase())];
    if (v !== null && typeof v === 'object') return `bad ${c}`;
  }
  if (t.cols.includes('happened_on')) {
    const h = o.happened_on !== undefined ? o.happened_on : o.happenedOn;
    if (h !== undefined && h !== null && !ISO_DATE.test(h)) return 'bad happened_on';
  }
  return null;
}

function insertSql(table, cols, conflict) {
  return `insert into ${table} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')}) ${conflict}`;
}

function fromRow(t, row) {
  if (!row) return row;
  const out = Object.assign({}, row);
  // null stays null (not-null columns never hold one), so a sale's absent `expected` is not 0.
  for (const c of t.money.concat(t.scaled || [])) out[c] = out[c] == null ? null : out[c] / 100;
  for (const c of t.json) { try { out[c] = JSON.parse(out[c]); } catch (_) { out[c] = null; } }
  return out;
}

async function handle(req, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const name = parts[0];
  const id = parts[1] ? decodeURIComponent(parts[1]) : '';
  if (name === 'health') return json({ ok: true, ts: new Date().toISOString() });

  const t = TABLES[name];
  if (!t) return fail(404, 'unknown collection');
  const table = t.table || name;

  const auth = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
  const claims = await verify(auth, env.SUPABASE_JWT_SECRET);
  if (!claims) return fail(401, 'bad token');
  // Access is decided here, on the server. The front end hiding a link is cosmetic.
  const user = {
    email: claims.email,
    store_id: (claims.app_metadata && claims.app_metadata.store_id) || env.DEFAULT_STORE,
  };
  if (!user.store_id) return fail(403, 'no store');

  const db = env.DB;
  const scope = 'where store_id = ?';
  const cursor = t.cursor || 'received_at';
  const now = () => new Date().toISOString();

  if (req.method === 'GET') {
    if (id) {
      const row = await db.prepare(`select * from ${table} ${scope} and id = ?`).bind(user.store_id, id).first();
      return row ? json(fromRow(t, row)) : fail(404, 'not found');
    }
    // `since` is how a tablet pulls only what changed while it was asleep -- against the SERVER
    // clock (see the paging contract at the top of this file), never the client's own stamp.
    const since = url.searchParams.get('since');
    let q;
    if (since) {
      const after = url.searchParams.get('after');
      q = after
        ? db.prepare(`select * from ${table} ${scope} and (${cursor} > ?2 or (${cursor} = ?2 and id > ?3))
                       order by ${cursor}, id limit 5000`).bind(user.store_id, since, after)
        : db.prepare(`select * from ${table} ${scope} and ${cursor} > ?2
                       order by ${cursor}, id limit 5000`).bind(user.store_id, since);
    } else {
      const order = t.stamp ? `order by ${t.stamp} desc` : '';
      q = db.prepare(`select * from ${table} ${scope} ${order} limit 5000`).bind(user.store_id);
    }
    const { results } = await q.all();
    return json(results.map((r) => fromRow(t, r)));
  }

  if (req.method === 'POST' && !id) {
    let body;
    try { body = await req.json(); } catch (_) { return fail(400, 'invalid JSON body'); }
    // An offline tablet uploads its backlog as one array. One statement per row inside one
    // batch (= one transaction), each `on conflict(id) do nothing`, so re-sending a batch whose
    // response was lost books nothing twice. Only event tables: state rows go one at a time.
    // ponytail: capped at 1000 rows per request (D1's per-invocation query limit on the paid
    // plan); the client chunks. Multi-row VALUES would cut statements if that limit bites.
    if (Array.isArray(body)) {
      if (!t.event) return fail(400, 'batch insert is for event tables');
      if (body.length > 1000) return fail(413, 'max 1000 rows per batch');
      // Bad rows are rejected one by one, not by failing the whole (atomic) batch: a single
      // poisoned row must not turn 999 good ones into a 500 a tablet then retries forever.
      const rejected = [];
      const seen = new Set();
      const stmts = [];
      body.forEach((o, index) => {
        const err = rowError(t, o);
        if (!err && seen.has(o.id)) { rejected.push({ index, id: o.id, error: 'duplicate id in this batch' }); return; }
        if (err) { rejected.push({ index, id: o && typeof o === 'object' ? o.id : undefined, error: err }); return; }
        seen.add(o.id);
        const r = toRow(t, o, user);
        const cols = Object.keys(r);
        stmts.push(db.prepare(insertSql(table, cols, 'on conflict(id) do nothing')).bind(...cols.map((c) => r[c])));
      });
      // meta.changes per statement is the only honest count: `on conflict do nothing` makes a
      // row that already existed (this store or, by id collision, another) a no-op, not an insert.
      let inserted = 0;
      if (stmts.length) {
        const results = await db.batch(stmts);
        inserted = results.reduce((n, res) => n + ((res && res.meta && res.meta.changes) || 0), 0);
      }
      const resBody = { received: body.length, inserted, rejected };
      return json(resBody, stmts.length ? 201 : (body.length ? 400 : 201));
    }
    const err = rowError(t, body);
    if (err) return fail(400, err);
    const row = toRow(t, body, user);
    const cols = Object.keys(row);
    // A tablet that loses the response retries the same client-generated id, so a
    // duplicate must be a no-op -- but ONLY a duplicate. `or ignore` would also
    // swallow a not-null or foreign-key violation and silently lose the sale.
    await db.prepare(insertSql(table, cols, 'on conflict(id) do nothing')).bind(...cols.map((c) => row[c])).run();
    return json(fromRow(t, row), 201);
  }

  if (req.method === 'PATCH' && id) {
    let patch;
    try { patch = await req.json(); } catch (_) { return fail(400, 'invalid JSON body'); }
    // Money is never edited, only appended to. A void or a refund is another row.
    const allowed = t.event ? (t.patchable || []) : t.cols.filter((c) => c !== 'id' && c !== 'store_id');
    const keys = Object.keys(patch).filter((k) => allowed.includes(k));
    if (!keys.length) return fail(t.event ? 403 : 400, t.event ? 'append-only table' : 'nothing to update');
    const row = toRow(t, patch, user);
    if (!t.event && t.stamp) keys.push(t.stamp);
    // An UPDATE never sees the column DEFAULT, so the cursor has to be bumped by hand here --
    // otherwise a patched row would stop showing up in anyone's `?since=` pull.
    const sets = keys.map((k) => k + ' = ?').concat(`${cursor} = ?`);
    await db.prepare(`update ${table} set ${sets.join(', ')} ${scope} and id = ?`)
      .bind(...keys.map((k) => row[k]), now(), user.store_id, id).run();
    const after = await db.prepare(`select * from ${table} ${scope} and id = ?`).bind(user.store_id, id).first();
    return json(fromRow(t, after));
  }

  if (req.method === 'DELETE' && id) {
    if (t.event) return fail(403, 'append-only table');
    await db.prepare(`delete from ${table} ${scope} and id = ?`).bind(user.store_id, id).run();
    return json(null);
  }

  if (req.method === 'PUT' && !id) {
    if (t.event) return fail(403, 'append-only table');
    let list;
    try { list = await req.json(); } catch (_) { return fail(400, 'invalid JSON body'); }
    if (!Array.isArray(list)) return fail(400, 'expected an array');
    // One batch = one transaction. A half-written catalog is worse than an old one.
    // Fresh inserts, so the cursor's column DEFAULT sets it -- no need to bind it here.
    await db.batch([
      db.prepare(`delete from ${table} ${scope}`).bind(user.store_id),
      ...list.map((o) => {
        const r = toRow(t, o, user);
        const cols = Object.keys(r);
        return db.prepare(insertSql(table, cols, '')).bind(...cols.map((c) => r[c]));
      }),
    ]);
    return json(list.length);
  }

  return fail(405, 'method not allowed');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try { res = await handle(req, env, url); }
    catch (e) { res = fail(500, String((e && e.message) || e)); }
    res = new Response(res.body, res);
    for (const k of Object.keys(cors)) res.headers.set(k, cors[k]);
    return res;
  },

  // Nightly rollup. Re-runnable by design: a late order from a tablet that was offline for days
  // just makes the next run overwrite the right day(s) with the correct totals.
  //
  // Keyed by the STORE-LOCAL date, not UTC: the store is UTC+TZ_OFFSET_MIN (default 480 = +8,
  // Manila), so an order at 2026-09-13T17:30Z is 2026-09-14 local and must land on that day, not
  // the UTC day. Rebuilds the last 7 local days (not just "yesterday") so a tablet that was
  // offline for more than a day is still corrected by the next run. Delete-then-insert per day
  // (not upsert) so a day whose orders were all voided doesn't keep a stale total.
  async scheduled(event, env) {
    const offset = Number(env.TZ_OFFSET_MIN) || 480;
    const localNow = new Date(event.scheduledTime + offset * 60000);
    const stmts = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(localNow.getTime() - i * 864e5).toISOString().slice(0, 10);
      stmts.push(
        env.DB.prepare('delete from daily_sales where day = ?1').bind(day),
        env.DB.prepare(
          `insert into daily_sales (day, store_id, order_count, gross, discount, vat, net)
           select ?1, store_id, count(*), sum(subtotal), sum(discount), sum(vat_amount), sum(total)
           from orders where date(ts, '+' || ?2 || ' minutes') = ?1 and status = 'completed'
           group by store_id`
        ).bind(day, offset),
      );
    }
    await env.DB.batch(stmts);
  },
};
