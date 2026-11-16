/* Chat (owner 2026-11-15, built in pos-lab-chat). Design only, no AI yet. One page: "Hi El, ask anything" on white, a pale blue
   haze rising from the bottom, the asks as a sideways carousel (Granola) above a see-through box (ChatGPT / Claude).
   The asks answer from this POS's own sales maths, so the numbers match Reports; anything else gets "not connected yet". */
const CHT_ASKS = ['How did today go?', 'What sold most this week?', 'What sold most this month?'];
const chtMsgs = [];   // the chat on screen
// The chats so far, newest first: [{ id, title, at, msgs }], the title = its first question (ChatGPT's way).
// shortcut: one device-only list in HWPOS_STORE.ui, answers kept as their HTML; upgrade when chat syncs through Supabase.
const chtAll = () => { try { return JSON.parse(HWPOS_STORE.ui.get('chats', '[]')) || []; } catch { return []; } };
let chtId = null;
function chtSave() {
  const all = chtAll().filter(c => c.id !== chtId);
  chtId = chtId || crypto.randomUUID();
  all.unshift({ id: chtId, title: chtMsgs[0].text, at: new Date().toISOString(), msgs: chtMsgs });
  HWPOS_STORE.ui.set('chats', JSON.stringify(all.slice(0, 200)));
}
// Lab only: sample chats so History has something to show on a new phone (owner 2026-11-15: "show me history with a lot of stuff").
// shortcut: made once per device from the real answers; drop when chats sync from Supabase.
function chtSeed() {
  if (HWPOS_STORE.ui.get('chatsSeeded')) return;   // once per device, after any chats already there
  const asks = ['How did today go?', 'What sold most this week?', 'Which paint colours sell best?', 'What sold most this month?', 'Who owes us money?',
    'Is cement running low?', 'Best day of the week for sales', 'How much did we discount this month?', 'Compare this week to last week',
    'What should I reorder?', 'Slowest items this month', 'Cash vs GCash this week', 'Top customer this month', 'How busy are mornings?',
    'Which items lost money?', 'Sales for gravel and sand', 'How many orders today?', 'Average order size this month', 'What sold most last weekend?',
    'Refunds this month', 'Which supplier do I buy most from?', 'Plan stock for payday', 'Best selling tool', 'What changed since yesterday?'];
  const day = 864e5, now = Date.now();
  HWPOS_STORE.ui.set('chats', JSON.stringify(chtAll().concat(asks.map((q, i) => ({ id: crypto.randomUUID(), title: q, at: new Date(now - (i + 1) * day * 0.7).toISOString(),
    msgs: [{ me: true, text: q }, { html: chtAnswer(q) }] })))));
  HWPOS_STORE.ui.set('chatsSeeded', '1');
}
let chtQuery = '';
function renderChatHistory() {
  chtSeed();
  const q = chtQuery.trim().toLowerCase(), all = chtAll(), list = all.filter(c => c.title.toLowerCase().includes(q));
  $('.cht-hist .cht-sec').hidden = !!q || !all.length;   // Recents sits in the head (owner: it rode the list's pull-down bounce)
  $('#chtList').innerHTML = !all.length ? emptyState('clock', 'Your chats show here.')
    : !list.length ? noResults(chtQuery.trim())
    : list.map(c => `<button type="button" class="row" data-cht-open="${escapeHtml(c.id)}"><div class="nm"><span>${escapeHtml(c.title)}</span></div></button>`).join('');
}
const chtHistory = (on) => {
  $('.view-chat').classList.toggle('cht-hist-on', on);
  if (on) { chtQuery = $('#chtSearch').value = ''; $('#chtFind').classList.remove('typed'); renderChatHistory(); }
};

const chtWin = (days) => {
  const z = tillZone(), k = tillDay(Date.now());
  return { from: SalesMath.dayStartMs(SalesMath.addDays(k, -(days - 1)), z), to: SalesMath.dayStartMs(SalesMath.addDays(k, 1), z) };
};
const chtRows = (rows) => `<div class="cht-rows">${rows.map(r => `<div><span>${escapeHtml(r.name)}<small>${SalesMath.qtyText(r.unitsSold)} sold</small></span><b class="num">${peso(r.netSales)}</b></div>`).join('')}</div>`;

function chtAnswer(q) {
  const t = q.toLowerCase(), days = t.includes('today') ? 1 : t.includes('week') ? 7 : t.includes('month') ? 30 : 0;
  if (!days) return '<p>Chat isn’t connected yet. For now it answers the questions above the box.</p>';
  const win = chtWin(days), m = SalesMath.summarize(state.orders, win), top = SalesMath.topItems(state.orders, { ...win, limit: 3 });
  const when = days === 1 ? 'Today' : days === 7 ? 'In the last 7 days' : 'In the last 30 days';
  if (!m.orders) return `<p>${when} there are no sales yet.</p>`;
  const lead = days === 1 ? `${when} you made <b class="num">${peso(m.netSales)}</b> in net sales from ${SalesMath.plural(m.orders, 'order')}.`
    : `${when}, these sold the most. Net sales were <b class="num">${peso(m.netSales)}</b> in all.`;
  return `<p>${lead}</p>${top.length ? (days === 1 ? '<p>Top items so far:</p>' : '') + chtRows(top) : ''}`;
}

// the look the owner picked in pos-lab-chat's try-out (2026-11-15): the questions as pills, dark mode with the blue glow
const CHT_TRY = { asks: 'pills', dark: 'colour' };
const chtOpt = (k) => CHT_TRY[k];

function renderChat() {
  const on = chtMsgs.length > 0, log = $('#chtLog'), view = $('.view-chat');
  view.classList.toggle('cht-on', on);
  for (const k in CHT_TRY) view.dataset[k] = chtOpt(k);
  $('#chtAsks').innerHTML = on ? '' : CHT_ASKS.map(a => `<button type="button" class="cht-ask" data-ask="${a}">${a}</button>`).join('');
  if (!on) {
    const first = (state.user?.name || $('.user-name')?.textContent || '').trim().split(/\s+/)[0];   // the name on the menu's name row
    log.innerHTML = `<div class="cht-hi"><h2>${first ? `Hi ${escapeHtml(first)}, ask anything` : 'Ask anything'}</h2></div>`;
    return;
  }
  log.innerHTML = `<div class="cht-thread">${chtMsgs.map(m => m.me ? `<div class="cht-me">${escapeHtml(m.text)}</div>` : `<div class="cht-ai">${m.html}</div>`).join('')}</div>`;
  log.scrollTop = log.scrollHeight;
}

function chtSend(text) {
  text = text.trim();
  if (!text || chtBusy) return;
  const ai = { html: '', md: '' };
  chtMsgs.push({ me: true, text }, ai);
  $('#chtIn').value = '';
  $('#chtBox').classList.remove('typed');
  chtFit();
  chtSave();
  renderChat();
  chtAsk(ai, $('#chtLog').querySelector('.cht-ai:last-child'));
}

/* ---------- AI (pos-lab-scribe, owner 2026-11-15) ----------
   Claude Haiku 5.5 through serve.py (ai-chat's proxy, copied: the key stays in ~/.pos-lab on the computer), its reply drawn
   as it streams by ai-chat's smd.js. The model asks for the store's numbers through CHT_TOOLS; they run here, on this
   POS's own data (the demo store from demo-fill.js: products, sales, suppliers, POs, the price log), so it never guesses.
   shortcut: the browser runs the tools and the proxy is open to anyone with the link (serve.py's LIMIT); the real app
   asks from the hosted back end, per store, behind sign-in. */
const CHT_MODEL = 'claude-haiku-5-5';   // owner 2026-11-15: Anthropic, Haiku 5.5 (was DeepSeek)
let chtBusy = null, chtSmd = null;   // chtBusy: the AbortController while a reply streams
const chtDate = (ts) => new Date(typeof ts === 'string' && !/^\d+$/.test(ts) ? ts : SalesMath.tsOf({ ts })).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
const chtWords = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
const chtMatch = (p, q) => { const hay = [p.name, p.sku, p.brand, p.folder, ...(p.aliases || [])].join(' ').toLowerCase(); return chtWords(q).every(w => hay.includes(w)); };
const chtItems = (q) => (state.products || []).filter(p => !p.deleted && chtMatch(p, q));
const chtSupName = () => { const m = new Map(loadSuppliers().map(s => [s.id, s.name])); return (id) => m.get(id) || ''; };
const chtMoney = (v) => (v == null || v === '' ? 'asked at sale' : peso(v));

const CHT_TOOLS = [
  ['find_items', 'Items in the catalog: price, cost, margin (profit as % of price), markup, stock on hand, reorder point, supplier, and units/net sales in the last 30 days.',
    { query: { type: 'string', description: 'words in the name, brand, SKU or category; empty = all' },
      sort: { type: 'string', enum: ['best_selling', 'low_stock', 'lowest_margin', 'highest_margin', 'name'] },
      only_low_stock: { type: 'boolean', description: 'only items at or under their reorder point (what to reorder)' }, limit: { type: 'integer' } }],
  ['price_history', 'Every price and cost change logged for the matching items, newest first.', { query: { type: 'string' } }, ['query']],
  ['suppliers', 'The suppliers: contact, phone, email, address, notes, which items they supply, purchase orders and money spent.', {}],
  ['purchase_orders', 'Purchase orders, newest first, with their lines.',
    { supplier: { type: 'string', description: 'part of a supplier name' }, status: { type: 'string', description: 'draft, ordered, partial, received or cancelled' }, limit: { type: 'integer' } }],
  ['sales', 'Sales for a window: net sales, orders, average sale, gross profit, margin, units, refunds, voids, and the top items.',
    { days: { type: 'integer', description: 'the last N days including today (1 = today)' }, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD, inclusive' } }],
  ['checks', 'Post-dated checks the store issued to suppliers: check number, payee, amount, due date, invoice, bank, with totals per due date.',
    { supplier: { type: 'string', description: 'part of a supplier name' }, from: { type: 'string', description: 'YYYY-MM-DD, due on or after' }, to: { type: 'string', description: 'YYYY-MM-DD, due on or before' } }],
  ['customers', 'Customers with their account balance (what they owe) and credit limit.',
    { query: { type: 'string' }, owing: { type: 'boolean', description: 'only those who owe money' } }],
].map(([name, description, properties, required = []]) => ({ name, description, input_schema: { type: 'object', properties, required } }));

function chtSold30() {
  const top = SalesMath.topItems(state.orders, chtWin(30));
  return new Map(top.map(r => [r.key, r]));
}
const CHT_RUN = {
  find_items({ query = '', sort = 'best_selling', limit, only_low_stock = false }) {
    limit ||= only_low_stock ? 60 : 25;   // a reorder list comes whole
    const sold = chtSold30(), sup = chtSupName();
    let rows = chtItems(query).filter(p => !only_low_stock || (p.trackStock !== false && p.reorderPoint > 0 && p.stock <= p.reorderPoint)).map(p => ({ p, s: sold.get(p.id) }));
    const mg = (p) => (p.price > 0 ? (p.price - (p.cost || 0)) / p.price : -1);   // profit as a share of the price; -1 = no set price
    if (/margin/.test(sort)) rows = rows.filter(r => r.p.price > 0);
    rows.sort(sort === 'low_stock' ? (a, b) => (a.p.stock - (a.p.reorderPoint || 0)) - (b.p.stock - (b.p.reorderPoint || 0))
      : sort === 'lowest_margin' ? (a, b) => mg(a.p) - mg(b.p) : sort === 'highest_margin' ? (a, b) => mg(b.p) - mg(a.p)
      : sort === 'name' ? (a, b) => a.p.name.localeCompare(b.p.name) : (a, b) => (b.s?.netSales || 0) - (a.s?.netSales || 0));
    return { found: rows.length, items: rows.slice(0, Math.min(limit, 60)).map(({ p, s }) => ({
      name: p.name, sku: p.sku, category: p.folder, unit: p.unit, price: chtMoney(p.price), cost: peso(p.cost || 0),
      margin: p.price > 0 ? Math.round((p.price - (p.cost || 0)) / p.price * 1000) / 10 + '%' : '', markup: p.price > 0 && p.cost > 0 ? Math.round((p.price / p.cost - 1) * 1000) / 10 + '%' : '',
      profitEach: p.price > 0 ? peso(p.price - (p.cost || 0)) : '',
      onHand: p.trackStock === false ? 'not counted' : p.stock, reorderPoint: p.reorderPoint || 0,
      stockState: p.trackStock === false ? '' : p.stock <= 0 ? 'out of stock' : p.stock <= (p.reorderPoint || 0) ? 'low, reorder' : 'ok', supplier: sup(p.supplierId),
      sold30Days: s ? SalesMath.qtyText(s.unitsSold) : '0', netSales30Days: peso(s?.netSales || 0) })) };
  },
  price_history({ query }) {
    const log = loadEvents('priceLog'), of = (p) => log.filter(e => e.productId === p.id);
    return chtItems(query).map(p => ({ p, ch: of(p) })).sort((a, b) => b.ch.length - a.ch.length).slice(0, 10)   // the ones that changed first
      .map(({ p, ch }) => ({ item: p.name, priceNow: chtMoney(p.price), costNow: peso(p.cost || 0),
        changes: ch.sort((a, b) => SalesMath.tsOf(b) - SalesMath.tsOf(a)).slice(0, 25)
          .map(e => ({ date: chtDate(SalesMath.tsOf(e)), what: e.field, from: chtMoney(e.old), to: chtMoney(e.new), reason: e.reason || '', by: e.staff || '' })) }));
  },
  suppliers() {
    const pos = loadPurchaseOrders();
    return loadSuppliers().map(s => {
      const items = (state.products || []).filter(p => !p.deleted && supplierIdsOf(p).includes(s.id));
      const mine = pos.filter(o => (o.items || []).some(l => lineSupplier(o, l) === s.id));
      const spent = mine.filter(o => o.status !== 'cancelled').reduce((t, o) => t + (o.items || [])
        .filter(l => lineSupplier(o, l) === s.id).reduce((n, l) => n + (l.receivedQty || 0) * (l.invoiceCost ?? l.cost ?? 0), 0), 0);
      const last = mine.map(o => o.orderedAt || o.updatedAt).filter(Boolean).sort().pop();
      return { name: s.name, contact: s.contact, phone: s.phone, email: s.email, address: s.address, note: s.note,
        itemCount: items.length, someItems: items.slice(0, 8).map(p => p.name), purchaseOrders: mine.length,
        lastOrdered: last ? chtDate(last) : '', spentOnReceived: peso(spent) };
    });
  },
  purchase_orders({ supplier = '', status = '', limit = 10 }) {
    const sup = chtSupName(), q = supplier.toLowerCase(), byId = new Map((state.products || []).map(p => [p.id, p.name]));
    return loadPurchaseOrders().filter(o => (!status || o.status === status) && (!q || (o.items || []).some(l => sup(lineSupplier(o, l)).toLowerCase().includes(q))))
      .sort((a, b) => String(b.orderedAt || b.updatedAt).localeCompare(String(a.orderedAt || a.updatedAt))).slice(0, Math.min(limit, 30))
      .map(o => ({ number: o.number, status: o.status, ordered: o.orderedAt ? chtDate(o.orderedAt) : '', expected: o.expectedAt ? chtDate(o.expectedAt) : '',
        received: o.receivedAt ? chtDate(o.receivedAt) : '', note: o.note || '',
        total: peso((o.items || []).reduce((t, l) => t + l.qty * (l.cost || 0), 0)),
        lines: (o.items || []).map(l => ({ item: byId.get(l.productId) || l.productId, supplier: sup(lineSupplier(o, l)), qty: l.qty, received: l.receivedQty || 0, cost: peso(l.cost || 0) })) }));
  },
  sales({ days, from, to }) {
    const z = tillZone();
    const win = from ? { from: SalesMath.dayStartMs(from, z), to: SalesMath.dayStartMs(SalesMath.addDays(to || from, 1), z) } : chtWin(days || 7);
    const m = SalesMath.summarize(state.orders, win), top = SalesMath.topItems(state.orders, { ...win, limit: 10 });
    return { from: chtDate(win.from), to: chtDate(win.to - 1), netSales: peso(m.netSales), orders: m.orders, averageSale: peso(m.averageSale),
      grossProfit: peso(m.grossProfit), margin: Math.round(m.margin * 1000) / 10 + '%', unitsSold: m.unitsSold, refunds: m.refundCount, voids: m.voidCount,
      topItems: top.map(r => ({ name: r.name, sold: SalesMath.qtyText(r.unitsSold), netSales: peso(r.netSales) })) };
  },
  checks({ supplier = '', from = '', to = '' }) {
    const q = supplier.toLowerCase();
    const rows = (window.HWPOS_DEMO_CHECKS || []).filter(c => (!q || c.payee.toLowerCase().includes(q)) && (!from || c.due >= from) && (!to || c.due <= to))
      .sort((a, b) => a.due.localeCompare(b.due) || a.number.localeCompare(b.number));
    const byDue = {};
    for (const c of rows) byDue[c.due] = (byDue[c.due] || 0) + c.amount;
    return { count: rows.length, total: peso(rows.reduce((t, c) => t + c.amount, 0)),
      totalsByDueDate: Object.entries(byDue).map(([due, t]) => ({ due: chtDate(due + 'T00:00'), total: peso(t) })),
      checks: rows.map(c => ({ number: c.number, payee: c.payee, amount: peso(c.amount), due: chtDate(c.due + 'T00:00'), invoice: c.invoice, bank: c.bank, status: c.status })) };
  },
  customers({ query = '', owing = false }) {
    return allCustomerRecords().filter(c => (!owing || c.currentBalance > 0) && chtWords(query).every(w => (c.name + ' ' + (c.phone || '')).toLowerCase().includes(w)))
      .sort((a, b) => b.currentBalance - a.currentBalance).slice(0, 40)
      .map(c => ({ name: c.name, phone: c.phone || '', owes: peso(c.currentBalance || 0), creditLimit: c.creditLimit == null ? 'no limit' : peso(c.creditLimit), credit: c.creditOn ? 'on' : 'off' }));
  },
};

const chtSystem = () => `You are the assistant inside the point-of-sale app of ${currentStoreInfo().name || 'the store'}, a hardware store in the Philippines.
The company's name is ${currentStoreInfo().name || 'not set'} (from the store's settings); say it when asked.
Its suppliers, purchase orders, price changes, customers' accounts, post-dated checks and every sale are in the tools.
Today is ${new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}. The person asking runs the store.
Answer from the tools only: call them for any number, price, stock, supplier or customer, and never make one up. If the tools don't have it, say so.
Reply in the language of the person's latest message (English, Filipino, Bisaya or Taglish), even if earlier messages were in another.
It is read on a phone. Be conversational, like Claude: a helpful colleague texting the owner. Warm, plain words, "you",
no jargon (say "nothing ordered yet", not "no open PO"; "rebar 16mm", not "Deformed Bar Grade 33 16mm × 6m").
- Open with the answer in one or two easy sentences, its key figure in bold.
- Then, only if it helps, up to three or four short groups. Each starts with a bold title on its own line (e.g. **Needs attention**)
  or one short sentence, then at most four bullets.
- Bullets are quick to read: about ten words, one number each, the thing in bold first: "**Holcim cement** – sold out, 363 sold this month".
- Pick what matters to an owner (what's up or down, what to act on, what's due); leave out the rest.
- In a summary, round big amounts (₱3.04M, ₱560K). Exact amounts (₱186,450.00) for a single record (a check, an invoice, a price) and when asked.
- A list of records: one record per bullet, e.g. "**#0004581 · VIC Enterprises** – ₱186,450.00, due Dec 15".
- Never pack several numbers or records into one long sentence or bullet.
- End with one short, friendly line offering more (e.g. "Want the full reorder list?").
No tables, no headings (#).`;

// The reply shows a few letters every frame, however the words arrive (owner 2026-11-15: the model's chunks of a few
// words read as jumps, "not smooth"); faster when it falls behind, so it never lags far. Each piece fades in (.fade).
function chtDrip(write) {
  let q = '', raf = 0, drained = null;
  const tick = () => {
    let n = Math.max(2, Math.ceil(q.length / 24));
    if (/[\ud800-\udbff]/.test(q[n - 1] || '')) n++;   // never split an emoji in two
    write(q.slice(0, n)); q = q.slice(n);
    raf = q ? requestAnimationFrame(tick) : 0;
    if (!q && drained) { drained(); drained = null; }
  };
  return { push(t) { q += t; raf ||= requestAnimationFrame(tick); },
    drain: () => (q ? new Promise(r => { drained = r; }) : Promise.resolve()) };
}

// ai-chat's renderer: only http(s) links, each streamed piece in its own span so it fades in
function chtRenderer(root) {
  const r = chtSmd.default_renderer(root);
  r.set_attr = (data, type, value) => {
    if ((type === chtSmd.HREF || type === chtSmd.SRC) && !/^https?:\/\//i.test(value)) return;
    chtSmd.default_set_attr(data, type, value);
  };
  r.add_text = (data, text) => {
    const s = document.createElement('span');
    s.className = 'fade';
    s.textContent = text;
    data.nodes[data.index].appendChild(s);
  };
  return r;
}

// Anthropic's stream, block by block: text shows as it comes; thinking (empty text + signature) and tool calls are kept
// whole so the turn goes back unchanged with the lookups' results.
async function chtAsk(ai, el) {
  const log = $('#chtLog'), sp = chtSpeaker();   // sp: reads the reply aloud as it comes, when the speaker is on
  chtBusy = new AbortController();
  // earlier turns go back whole, their lookups and results included (ai.turn), so the model sees where its numbers came
  // from (owner 2026-11-15: with only the text it decided its own earlier answers were made up); text only for older chats
  const msgs = chtMsgs.slice(0, -1).flatMap(m => m.me ? [{ role: 'user', content: m.text }]
    : m.turn || [{ role: 'assistant', content: m.md || new DOMParser().parseFromString(m.html, 'text/html').body.textContent || '…' }]);
  const base = msgs.length;
  // "Thinking" with its dots going 1, 2, 3 and round again (owner 2026-11-15), until the first words arrive
  el.innerHTML = '<span class="cht-think" role="status">Thinking<i>.</i><i>.</i><i>.</i></span>';
  try {
    chtSmd = chtSmd || await import('./smd.js');
    const parser = chtSmd.parser(chtRenderer(el));
    const drip = chtDrip((t) => {
      el.querySelector('.cht-think')?.remove();   // the first words take its place
      const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      chtSmd.parser_write(parser, t);
      if (stick) log.scrollTop = log.scrollHeight;
    });
    try {
      for (let round = 0; round < 8; round++) {   // a few lookups, then the answer
        const res = await fetch('/api/chat', { method: 'POST', signal: chtBusy.signal, headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: 'anthropic', model: CHT_MODEL, max_tokens: 16000, output_config: { effort: 'low' },
            cache_control: { type: 'ephemeral' }, system: chtSystem(), tools: CHT_TOOLS, messages: msgs }) });
        if (!res.ok) throw new Error(await res.text());
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const blocks = [];
        let buf = '', stop = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const lines = (buf += value).split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const ev = JSON.parse(line.slice(5));
            if (ev.type === 'error') throw new Error(ev.error?.message || 'error');
            if (ev.type === 'content_block_start') blocks[ev.index] = { ...ev.content_block, ...(ev.content_block.type === 'tool_use' ? { json: '' } : {}) };
            else if (ev.type === 'message_delta') stop = ev.delta?.stop_reason || stop;
            else if (ev.type === 'content_block_stop' && blocks[ev.index]?.type === 'tool_use') {
              const t = blocks[ev.index];
              t.input = t.json ? JSON.parse(t.json) : {};
              delete t.json;
            } else if (ev.type === 'content_block_delta') {
              const blk = blocks[ev.index], d = ev.delta;
              if (d.type === 'thinking_delta') blk.thinking += d.thinking;
              else if (d.type === 'signature_delta') blk.signature = (blk.signature || '') + d.signature;
              else if (d.type === 'input_json_delta') blk.json += d.partial_json;
              else if (d.type === 'text_delta') { blk.text += d.text; ai.md += d.text; drip.push(d.text); sp?.push(d.text); }
            }
          }
        }
        if (stop === 'refusal') throw new Error('It can’t help with that one.');
        const calls = blocks.filter(b => b?.type === 'tool_use');
        if (stop !== 'tool_use' || !calls.length) { msgs.push({ role: 'assistant', content: blocks.filter(Boolean) }); ai.turn = msgs.slice(base); sp?.end(); break; }
        msgs.push({ role: 'assistant', content: blocks.filter(Boolean) });
        msgs.push({ role: 'user', content: calls.map(c => {   // every result in one message
          try { return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(CHT_RUN[c.name](c.input || {})) }; }
          catch (e) { return { type: 'tool_result', tool_use_id: c.id, content: String(e.message || e), is_error: true }; }
        }) });
        if (ai.md && !/\s$/.test(ai.md)) { ai.md += '\n\n'; drip.push('\n\n'); }   // text before a lookup ends its paragraph
      }
    } finally { await drip.drain(); chtSmd.parser_end(parser); el.querySelector('.cht-think')?.remove(); }
    ai.html = el.innerHTML;
  } catch (e) {
    if (sp && chtVoice === sp && e.name === 'AbortError') chtHush();
    if (e.name === 'AbortError') ai.html = el.innerHTML;
    else el.innerHTML = ai.html = `<p>${escapeHtml(String(e.message || e).slice(0, 300))}</p>`;
  } finally {
    chtBusy = null;
    if (chtMsgs.includes(ai)) chtSave();
  }
}

document.addEventListener('click', (e) => {
  const ask = e.target.closest('[data-ask]');
  if (ask) return chtSend(ask.dataset.ask);
  if (e.target.closest('#chtNew')) { chtHush(); chtBusy?.abort(); chtMsgs.length = 0; chtId = null; return renderChat(); }
  if (e.target.closest('#chtHist')) return chtHistory(true);
  if (e.target.closest('#chtHistX')) return chtHistory(false);
  const open = e.target.closest('[data-cht-open]');
  if (open) {
    const c = chtAll().find(x => x.id === open.dataset.chtOpen);
    if (c) { chtHush(); chtBusy?.abort(); chtId = c.id; chtMsgs.splice(0, chtMsgs.length, ...c.msgs); }
    chtHistory(false);
    return renderChat();
  }
});
$('#chtBox').addEventListener('submit', (e) => { e.preventDefault(); chtSend($('#chtIn').value); });

// The keyboard (owner 2026-11-15: "it brings the entire page up"). A phone app is told the keyboard's height by iOS / Android;
// a web page reads it off visualViewport, the part of the screen still showing. Safari slides the whole page up to show the box:
// the page is slid back down by that much (--cht-pan) and only the questions + box rise by the keyboard (--cht-kb).
const chtKb = () => {
  const vv = window.visualViewport, view = $('.view-chat');
  const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-height')) || innerHeight;
  const typing = !!vv && document.activeElement === $('#chtIn');
  // the keys' height = the window less what still shows. Not --app-height: in the Home Screen app that is sometimes the whole
  // screen (status bar included) and sometimes not, which lifted the box ~a status bar too high (owner 2026-11-15: "a really
  // big space" above the keys, gone after a new chat re-measured)
  const kb = typing ? Math.max(0, Math.round(innerHeight - vv.height)) : 0;
  view.style.setProperty('--cht-kb', kb + 'px');
  view.style.setProperty('--cht-pan', (typing ? Math.round(vv.offsetTop) : 0) + 'px');
  view.classList.toggle('cht-kb', kb > 80);
  if (kb > 80 && chtMsgs.length) $('#chtLog').scrollTop = $('#chtLog').scrollHeight;
};
window.visualViewport?.addEventListener('resize', chtKb);
window.visualViewport?.addEventListener('scroll', chtKb);
// the greeting leaves the moment the box is tapped, as Gemini's does, not once the keys are fully up
$('#chtIn').addEventListener('focus', () => { $('.view-chat').classList.add('cht-typing'); chtKb(); });
$('#chtIn').addEventListener('blur', () => { $('.view-chat').classList.remove('cht-typing'); setTimeout(chtKb, 0); });
$('#chtIn').addEventListener('touchend', (e) => {   // take the cursor without Safari's own slide; chtKb lifts the box
  if (chtTapEaten) { chtTapEaten = false; return e.preventDefault(); }   // the finger lifting off a hold to speak
  if (document.activeElement === e.target) return;
  e.preventDefault();
  e.target.focus({ preventScroll: true });
}, { passive: false });
$('#chtIn').addEventListener('input', (e) => { $('#chtBox').classList.toggle('typed', !!e.target.value.trim()); chtFit(); });
wireFind('#chtFind', '#chtSearch', '#chtSearchX', (q) => { chtQuery = q; renderChatHistory(); });

/* ---------- The box grows with what's typed (owner 2026-11-15, Claude / ChatGPT's) ----------
   One line: [+][words][mic][send]. Past one line the words take the full width on top and the buttons drop to a row
   under them; up to 9 lines, then it scrolls. It goes back to one line only once the text is shorter than when it grew
   (or empty), so it doesn't flick between the two at the edge. */
let chtGrewAt = 0;
function chtFit() {
  const ta = $('#chtIn'), box = $('#chtBox'), over = () => ta.scrollHeight > 40;
  ta.style.height = 'auto';
  if (!box.classList.contains('cht-multi') && over()) { box.classList.add('cht-multi'); chtGrewAt = ta.value.length; }
  else if (box.classList.contains('cht-multi') && ta.value.length < chtGrewAt) { box.classList.remove('cht-multi'); if (over()) box.classList.add('cht-multi'); }
  ta.style.height = '';
  ta.style.height = Math.min(ta.scrollHeight, 222) + 'px';
}
// a computer's Enter sends; on a phone Return is a new line and the arrow sends (Claude's app)
$('#chtIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); $('#chtBox').requestSubmit(); }
});
// the thread keeps clear of the box, however tall it is
new ResizeObserver(() => $('.view-chat').style.setProperty('--cht-box-h', $('#chtBox').offsetHeight + 'px')).observe($('#chtBox'));

/* ---------- Talk: hold to speak (owner 2026-11-15, DeepSeek's way) ----------
   Hold the box or the mic: the box gives way to a blue glow rising from the bottom, "Release to send, slide up to
   cancel", and a wave that follows the voice. Let go: the clip goes to Scribe v3 (straight from the phone with a one-use pass from serve.py) with the language
   hint, and its words are sent as the question. Slide up first and nothing is sent. A tap on the mic picks the language.
   Scribe live has no Bisaya (it drops 'ceb', tested 2026-11-15), so the clip is sent whole on release.
   shortcut: the hint is per device (HWPOS_STORE.ui 'voiceLang', the mic's tap menu); a store setting once Settings has one. */
const CHT_LANGS = [['', 'Auto-detect'], ['en', 'English'], ['fil', 'Filipino'], ['ceb', 'Bisaya']];
const chtLang = () => HWPOS_STORE.ui.get('voiceLang', '') || '';
const CHT_HOLD_MS = 320, CHT_CANCEL_PX = 150;   // 150: a small drift up while talking isn't a cancel (owner: 70 cancelled "barely sliding up")
let chtV = null, chtPress = null, chtTapEaten = false, chtRecog = false;
// The wave's AudioContext. iOS starts one only inside a touch, so it is made (and woken) on any touch or tap on the page,
// the press that begins a hold included (owner 2026-11-15: the line sat flat on a fresh page, moved only after a Send tap)
let chtAudio = null;
const chtWake = () => { try { chtAudio ||= new AudioContext(); if (chtAudio.state !== 'running') chtAudio.resume().catch(() => {}); } catch {} };
for (const ev of ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown']) document.addEventListener(ev, chtWake, { capture: true, passive: true });
let chtHintT = 0;
function chtHint(text) {   // a short note in the box's placeholder
  const inp = $('#chtIn');
  inp.placeholder = text;
  clearTimeout(chtHintT);
  chtHintT = setTimeout(() => { inp.placeholder = 'Ask about your store'; }, 2600);
}

async function chtHoldStart() {
  chtHush();   // talking over it stops it
  chtSession('play-and-record');
  const v = chtV = { cancel: false, chunks: [], level: 0, bars: new Array(44).fill(0), t0: performance.now() };
  // a one-use pass for Scribe, fetched while talking, so the clip goes from the phone straight to ElevenLabs on release
  v.pass = fetch('/api/scribe-pass').then(r => (r.ok ? r.json() : null)).then(j => j?.token || null).catch(() => null);
  $('#chtIn').blur();
  const view = $('.view-chat');
  view.classList.add('cht-holding');
  view.classList.remove('cht-hold-cancel');
  $('.cht-hold-hint').textContent = 'Release to send, slide up to cancel';
  navigator.vibrate?.(10);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (chtV !== v) return stream.getTracks().forEach(t => t.stop());   // let go before the mic was ready
    v.stream = stream;
    try { v.rec = new MediaRecorder(stream, { audioBitsPerSecond: 48000 }); } catch { v.rec = new MediaRecorder(stream); }   // speech-grade: a smaller upload
    v.rec.ondataavailable = (e) => { if (e.data.size) v.chunks.push(e.data); };
    v.rec.start();
    try {
      // the shared one woken by the press; else one of its own (a recording page may start one). The analyser runs into a
      // silent gain to the speaker, as Safari only runs a graph that ends there.
      let ctx = chtAudio;
      await ctx?.resume().catch(() => {});   // the mic coming on can pause it on iPhone
      if (ctx?.state !== 'running') { const own = new AudioContext(); await own.resume().catch(() => {}); if (own.state === 'running' || !ctx) { ctx = v.ctx = own; } else own.close(); }
      v.src = ctx.createMediaStreamSource(stream);
      v.an = ctx.createAnalyser(); v.an.fftSize = 1024;
      const mute = ctx.createGain(); mute.gain.value = 0;
      v.src.connect(v.an); v.an.connect(mute); mute.connect(ctx.destination);
      if (chtV === v) chtWave(v);
    } catch {}   // no wave is fine; the recording still runs
  } catch (e) {
    chtV = null;
    view.classList.remove('cht-holding');
    chtHint(e.name === 'NotAllowedError' ? 'Allow the microphone to talk' : 'The mic didn’t start');
  }
}

// the wave: the voice's loudness every few frames, newest on the right, taller in the middle (DeepSeek's); the glow swells with it
function chtWave(v) {
  const c = $('.cht-hold-wave'), g = c.getContext('2d'), dpr = devicePixelRatio || 1, buf = new Float32Array(v.an.fftSize);
  const W = c.clientWidth, H = c.clientHeight, N = v.bars.length, step = W / N, bw = Math.max(1.5, step * .4);
  c.width = W * dpr; c.height = H * dpr; g.scale(dpr, dpr); g.fillStyle = '#fff';
  let n = 0;
  const tick = () => {
    if (chtV !== v) return g.clearRect(0, 0, W, H);
    v.an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const x of buf) sum += x * x;
    const db = 10 * Math.log10(sum / buf.length + 1e-10);   // the voice's loudness, -55 dB (room) .. -18 dB (talking up close) → 0..1
    const target = Math.max(0, Math.min(1, (db + 55) / 37));
    v.level += (target - v.level) * (target > v.level ? .5 : .12);   // rises with a word, settles back slower: it breathes
    if (++n % 3 === 0) { v.bars.shift(); v.bars.push(v.level); }
    g.clearRect(0, 0, W, H);
    v.bars.forEach((l, i) => {
      const env = .3 + .7 * Math.sin(Math.PI * i / (N - 1)), h = Math.max(3, (3 + l * (H - 3)) * env);
      g.globalAlpha = .5 + .5 * env;
      g.beginPath(); g.roundRect(i * step + (step - bw) / 2, (H - h) / 2, bw, h, bw / 2); g.fill();
    });
    $('.view-chat').style.setProperty('--cht-level', v.level.toFixed(3));
    requestAnimationFrame(tick);
  };
  tick();
}

async function chtHoldEnd(send) {
  const v = chtV;
  if (!v) return;
  chtV = null;
  const view = $('.view-chat'), quit = (note) => { view.classList.remove('cht-holding', 'cht-hold-cancel', 'cht-recog'); if (note) chtHint(note); };
  view.style.setProperty('--cht-level', 0);
  const short = performance.now() - v.t0 < 600;   // too short to be words
  if (send && !short) {   // let go: the glow stays, "Recognizing…" until the words are back, then it sends (owner 2026-11-15)
    chtRecog = true;
    view.classList.add('cht-recog');
    try { chtWake(); chtChime(); } catch {}   // the soft ding as you let go: "got it" (owner 2026-11-15); it plays again as the reply starts speaking
    $('.cht-hold-hint').textContent = 'Recognizing…';
  } else quit(!send ? (v.cancel ? 'Cancelled' : '') : 'Hold to talk');
  v.src?.disconnect();
  v.ctx?.close();
  if (v.rec && v.rec.state !== 'inactive') { const stopped = new Promise(r => { v.rec.onstop = r; }); v.rec.stop(); await stopped; }
  v.stream?.getTracks().forEach(t => t.stop());
  chtSession('playback');   // the mic is off: back to the loudspeaker
  if (!send || short) return;
  try {
    if (!v.chunks.length) throw new Error('Didn’t catch that');
    const blob = new Blob(v.chunks, { type: v.rec.mimeType || 'audio/mp4' }), lang = chtLang(), token = await v.pass;
    let r;
    if (token) {   // straight to Scribe v3 (skips the tunnel to the computer and back); else through serve.py as before
      const f = new FormData();
      f.append('model_id', 'scribe_v3');
      if (lang) f.append('language_code', lang);   // a hint: other languages still come through
      f.append('file', blob, 'clip.' + (blob.type.includes('webm') ? 'webm' : 'mp4'));
      r = await fetch('https://api.elevenlabs.io/v1/speech-to-text?token=' + encodeURIComponent(token), { method: 'POST', body: f });
    } else r = await fetch('/api/scribe?lang=' + lang, { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
    if (!r.ok) throw new Error(await r.text());
    const text = String((await r.json()).text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();   // drop sound tags like (laughs)
    if (!text) throw new Error('Didn’t catch that');
    quit();
    chtSend(text);
  } catch (e) { quit(String(e.message || e).replace(/\s+/g, ' ').slice(0, 60)); }
  finally { chtRecog = false; }
}

function chtLangMenu() {
  const cur = chtLang();
  openMenu(chtTalkBtn(), CHT_LANGS.map(([code, label]) => ({ label, cur: code === cur,
    run: () => { HWPOS_STORE.ui.set('voiceLang', code); chtHint(code ? 'Talk in ' + label : 'Talk in any language'); } })), { w: 170, right: true });
}
const chtTalkBtn = () => $('#chtBox .cht-ic[aria-label="Talk"]');

// press and hold: on the box (not while typing in it, not on + or send) or on the mic
$('#chtBox').addEventListener('pointerdown', (e) => {
  if (e.button > 0 || chtV || chtRecog || chtBusy) return;
  const mic = !!e.target.closest('[aria-label="Talk"]');
  if (!mic && (e.target.closest('button') || document.activeElement === $('#chtIn'))) return;
  const p = chtPress = { id: e.pointerId, x: e.clientX, y: e.clientY, mic, held: false };
  p.timer = setTimeout(() => {
    p.held = true;
    try { $('#chtBox').setPointerCapture(p.id); } catch {}
    chtHoldStart();
  }, CHT_HOLD_MS);
});
$('#chtBox').addEventListener('pointermove', (e) => {
  const p = chtPress;
  if (!p || e.pointerId !== p.id) return;
  if (!p.held) { if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) { clearTimeout(p.timer); chtPress = null; } return; }
  if (!chtV) return;
  const cancel = p.y - e.clientY > CHT_CANCEL_PX;
  if (cancel === chtV.cancel) return;
  chtV.cancel = cancel;
  $('.view-chat').classList.toggle('cht-hold-cancel', cancel);
  $('.cht-hold-hint').textContent = cancel ? 'Release to cancel' : 'Release to send, slide up to cancel';
});
const chtLift = (e) => {
  const p = chtPress;
  if (!p || e.pointerId !== p.id) return;
  chtPress = null;
  clearTimeout(p.timer);
  if (p.held) { chtTapEaten = e.pointerType === 'touch'; chtHoldEnd(e.type === 'pointerup' && !chtV?.cancel); }
  else if (p.mic && e.type === 'pointerup') chtLangMenu();
};
$('#chtBox').addEventListener('pointerup', chtLift);
$('#chtBox').addEventListener('pointercancel', chtLift);
$('#chtBox').addEventListener('contextmenu', (e) => e.preventDefault());
// iOS's own long press on the box (its text loupe magnified the hint, owner's screenshot): not while it isn't being typed in;
// a tap still focuses it (#chtIn's touchend), + and send still click
$('#chtBox').addEventListener('touchstart', (e) => {
  if (document.activeElement !== $('#chtIn') && !e.target.closest('button:not([aria-label="Talk"])')) e.preventDefault();
}, { passive: false });   // a long press is talking, not the copy menu

/* ---------- Spoken replies (owner 2026-11-15: "it can speak back to me", the press-to-talk way, not a live call) ----------
   With the speaker on (the head's speaker button; per device, HWPOS_STORE.ui 'speakReplies', on at first), each reply is read
   aloud by ElevenLabs (serve.py /api/speak, the voice "Sarah") a sentence or two at a time as it streams in, the next one
   fetched while this one plays. A new question, a hold to talk, New chat or the button stops it. Played through the
   page's AudioContext (chtAudio, woken by touches), as iOS won't start an <audio> that wasn't tapped. */
const chtSpeakOn = () => HWPOS_STORE.ui.get('speakReplies', '1') === '1';
// iPhone: once the page uses the mic, Safari plays sound in "call" mode, quieter (owner 2026-11-15: "the volume is a bit lower"),
// and stays there. Safari's audio-session setting puts it back: record mode while holding, playback once the mic is off.
const chtSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };
// the voice a little louder and even: a gain into a limiter, so the boost never crackles
let chtVoiceOut = null;
const chtOut = () => {
  if (chtVoiceOut?.context === chtAudio) return chtVoiceOut;
  const g = chtAudio.createGain(), lim = chtAudio.createDynamicsCompressor();
  g.gain.value = 1.6;
  lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = .003; lim.release.value = .2;
  g.connect(lim); lim.connect(chtAudio.destination);
  return (chtVoiceOut = g);
};
let chtVoice = null;
// what a person would say: no markdown marks or bullets, ₱1,234.50 → "1,234 pesos and 50 centavos", #0004581 → "number 0004581"
// ₱3.04M / ₱578.7K → "3 million 40 thousand" / "578 thousand 700" (owner 2026-11-15: it read "3.04 m")
const chtBig = (n, unit) => {
  const v = Math.round(parseFloat(n.replace(/,/g, '')) * { k: 1e3, m: 1e6, b: 1e9 }[unit.toLowerCase()]);
  const parts = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']].reduce((o, [d, w]) => { const q = Math.floor(o.r / d); if (q) o.s.push(q + ' ' + w); o.r -= q * d; return o; }, { r: v, s: [] });
  return [...parts.s, ...(parts.r ? [parts.r] : [])].join(' ');
};
const chtSpoken = (md) => md.replace(/₱\s?([\d.,]+)\s?([KkMmBb])\b/g, (_, n, u) => chtBig(n, u) + ' pesos')
  .replace(/#(\d+)/g, 'number $1').replace(/[*_`#>|]+/g, '')
  .replace(/^\s*(?:[-•]|\d+\.)\s+/gm, '')
  .replace(/₱\s?([\d,]+)(?:\.(\d\d))?/g, (_, w, c) => w + ' pesos' + (c && c !== '00' ? ' and ' + (+c) + ' centavos' : ''))
  .replace(/×/g, ' by ').replace(/\s+/g, ' ').trim();
function chtSpeaker() {
  chtHush();
  if (!chtSpeakOn()) return null;
  chtWake();
  if (!chtV) chtSession('playback');
  const sp = chtVoice = { buf: '', q: [], playing: false, off: false, ctl: new AbortController() };
  let said = '';   // what's been read so far: sent along so each piece carries on the same tone instead of starting over
  const say = (md) => {
    const text = chtSpoken(md);
    if (!/[\p{L}\d]/u.test(text)) return;
    const prev = said;
    said += ' ' + text;
    sp.q.push(fetch('/api/speak', { method: 'POST', signal: sp.ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, prev }) })
      .then(r => (r.ok ? r.arrayBuffer() : null)).then(b => b && chtAudio.decodeAudioData(b)).catch(() => null));
    if (!sp.playing) next();
  };
  const next = async () => {
    if (sp.off || !sp.q.length) { sp.playing = false; return; }
    sp.playing = true;
    const buf = await sp.q[0];
    if (sp.off) return;
    sp.q.shift();
    if (!buf) return next();
    const src = sp.src = chtAudio.createBufferSource();
    src.buffer = buf; src.connect(chtOut()); src.onended = next;
    src.start(sp.chimed ? 0 : chtChime());   // the first piece waits for the chime
    sp.chimed = true;
  };
  // cut at a sentence end (". " "? " "! ") or a line break: the first piece at 40+ letters so it starts soon, the rest at 160+
  // so there are fewer fresh starts (each piece is spoken on its own)
  sp.push = (t) => {
    sp.buf += t;
    for (let m; (m = sp.buf.match(said ? /^[\s\S]{160,}?(?:[.!?](?=\s)|\n)/ : /^[\s\S]{40,}?(?:[.!?](?=\s)|\n)/));) { say(m[0]); sp.buf = sp.buf.slice(m[0].length); }
  };
  sp.end = () => { if (sp.buf.trim()) say(sp.buf); sp.buf = ''; };
  return sp;
}
// the ding before it starts talking (owner 2026-11-15: "an Apple-sounding chime", not cheap beeps). Drawn here, no sound file:
// each note is a struck glass: a sine plus a few quieter overtones that die away faster, a soft 4 ms attack, a long natural
// fade, a little warmth (low-pass) and a short room echo (a made-up reverb). CHT_DING picks one; 'glass' is the default.
const CHT_DINGS = {
  glass: { notes: [[1046.5, 0]], parts: [[1, 1, 1], [2, .28, .55], [3, .1, .35], [4.2, .05, .2]], decay: 1.1, vol: .32, room: .28 },
  pair:  { notes: [[1046.5, 0], [1318.5, .13]], parts: [[1, 1, 1], [2, .22, .5], [4, .08, .25]], decay: .8, vol: .27, room: .3 },
  rise:  { notes: [[783.99, 0], [1046.5, .085], [1318.5, .17]], parts: [[1, 1, 1], [2, .2, .5], [3, .06, .3]], decay: .7, vol: .24, room: .32 },
  // the owner's pick, made richer (2026-11-15: "rise is the best, more luxurious, less chimey"): lower, the overtones nearly gone,
  // each note two tones a few cents apart (a fuller, softer body), a slower attack, the notes ringing into each other, a longer room
  warm:  { notes: [[587.33, 0], [739.99, .1], [880, .2]], parts: [[1, 1, 1], [2, .07, .45]], decay: 1.5, vol: .2, room: .36,
           attack: .014, lp: 2600, roomSec: 2.2, detune: 4 },
  lux:   { notes: [[587.33, 0], [739.99, .09], [880, .18], [1108.73, .27]], parts: [[1, 1, 1], [2, .05, .4], [.5, .18, .9]], decay: 1.8, vol: .17, room: .4,
           attack: .018, lp: 2300, roomSec: 2.6, detune: 5 },
};
  // the owner's pick after warm (2026-11-15: "lux and warm too loud; warm, but less prominent, quicker, toned down, too high"):
  // warm a fourth lower (A4 C#5 E5), the notes closer together, a shorter ring and room, about half as loud
CHT_DINGS.soft = { notes: [[440, 0], [554.37, .065], [659.25, .13]], parts: [[1, 1, 1], [2, .04, .4]], decay: .95, vol: .1, room: .26,
  attack: .012, lp: 2000, roomSec: 1.5, detune: 4 };
const CHT_DING = 'soft';
function chtChime(ac = chtAudio, style = CHT_DING) {
  const d = CHT_DINGS[style], t = ac.currentTime + .02, out = ac.createGain(), warm = ac.createBiquadFilter(), room = ac.createConvolver(), wet = ac.createGain();
  warm.type = 'lowpass'; warm.frequency.value = d.lp || 5200;
  const n = Math.round(ac.sampleRate * (d.roomSec || 1.4)), ir = ac.createBuffer(2, n, ac.sampleRate);   // the room: noise fading away
  for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.2; }
  room.buffer = ir; wet.gain.value = d.room;
  out.connect(warm); warm.connect(ac.destination); warm.connect(room); room.connect(wet); wet.connect(ac.destination);
  for (const [hz, at] of d.notes) for (const [mul, g, life] of d.parts) for (const cents of d.detune ? [-d.detune, d.detune] : [0]) {
    const o = ac.createOscillator(), env = ac.createGain(), s = t + at, end = s + d.decay * life;
    o.type = 'sine'; o.frequency.value = hz * mul; o.detune.value = cents;
    env.gain.setValueAtTime(0, s);
    env.gain.linearRampToValueAtTime(d.vol * g / (d.detune ? 1.6 : 1), s + (d.attack || .004));
    env.gain.exponentialRampToValueAtTime(.0001, end);
    o.connect(env); env.connect(out);
    o.start(s); o.stop(end + .05);
  }
  return t + d.notes.at(-1)[1] + .32;   // the voice comes in as the ding rings out
}
function chtHush() {
  const sp = chtVoice;
  if (!sp) return;
  chtVoice = null;
  sp.off = true;
  sp.ctl.abort();
  try { sp.src?.stop(); } catch {}
}
const CHT_SPK = '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/>';
function chtSpeakIcon() {
  const on = chtSpeakOn(), b = $('#chtSpeak');
  b.setAttribute('aria-pressed', on);
  b.title = on ? 'Spoken replies on' : 'Spoken replies off';
  b.setAttribute('aria-label', b.title);
  b.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${CHT_SPK}${on
    ? '<path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>' : '<path d="M16 9.5l5 5M21 9.5l-5 5"/>'}</svg>`;
}
chtSpeakIcon();
$('#chtSpeak').addEventListener('click', () => {
  HWPOS_STORE.ui.set('speakReplies', chtSpeakOn() ? '0' : '1');
  if (!chtSpeakOn()) chtHush();
  chtSpeakIcon();
  chtHint(chtSpeakOn() ? 'Replies will be read aloud' : 'Replies are silent');
});
