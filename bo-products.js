/* Back office - Products. Renders the whole #view section; see CONTRACT.
   Products creates items and owns name/pricing/margin/variants/barcode.
   Inventory moves stock - the only stock this page writes is an opening count,
   and even that goes through makeMovement/appendMovements. */
(function () {
  const VIEW = 'products';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);
  // One list, two readings: Catalog (what it is, what it costs) and Stock (how many, is it moving).
  // Both are sidebar links (data-sub), so this registers no tree of its own.

  /* ---------- shared reads ---------- */
  const params = () => Router.route().params;
  const isStock = () => params().view === 'stock';
  // The detail segment: '' | 'new' | '<id>' (item page) | '<id>/edit' (editor). The editor
  // and its actions only ever want the id.
  const editId = () => state.detailId.replace(/\/edit$/, '');
  // A bare id is the item page (bo-item.js) when it is loaded; it owns the root then.
  const onItemPage = () => !!state.detailId && state.detailId !== 'new'
    && !state.detailId.endsWith('/edit') && typeof window.renderProductPage === 'function';

  /* ---------- stock level: bo-model's STOCK_LEVEL, one answer for filter, tile and pill ---------- */
  const LEVEL_OPTS = [['out', 'Out of stock'], ['low', 'Low'], ['dead', 'Dead']];
  // ?level= is a comma list; ?low=1 is the old checkbox, read as level=low but never written.
  const levelsOf = (p) => (p.level ? p.level.split(',').filter(Boolean) : p.low === '1' ? ['low'] : []);
  // An item's level: a family is one item (bo-model familyLevel over its live variants), so the
  // filter, the row's pill and the tiles (stockCounts) give one answer. A plain product is a family of one.
  const famKey = (x) => x.groupId || x.id;
  const famLevel = (members, facts) => {
    const live = members.filter((m) => !m.archived);
    return familyLevel(live.length ? live : members, facts.clock, facts.now, boZone());
  };
  // In stock is the normal state: plain muted words. A pill is for Out, Low and Dead only.
  const levelPill = (key) => (key === 'ok' ? `<span class="muted">${STOCK_LEVEL.ok[1]}</span>`
    : `<span class="status-pill ${STOCK_LEVEL[key][0]}">${STOCK_LEVEL[key][1]}</span>`);

  // Once per paint: the sale clock off the movement log (last sold, dead), and units sold in
  // 30 days off the ladder, so voids and refunds take theirs back like on the item page.
  function stockFacts() {
    const now = Date.now();
    const units = soldLast30(now);
    const sold = { get: (id) => units.get(id)?.unitsSold || 0 };
    const clock = saleClock(loadMovements(), boZone(), state.orders);
    return { clock, sold, now, level: (p) => stockLevel(p, clock.get(p.id), now, boZone()) };
  }
  // Store days, as the item page reads it: Never · Today · Yesterday · 3 days ago.
  const lastSold = (ms, now) => SalesMath.agoText(ms, now, boZone());

  // Who typed an opening count: the back office's name (actor), linked to its staff id, as every movement is.
  const who = () => { const staff = actor(); return { staff, staffId: staffIdOf(staff) }; };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // One unit's profit, margin (tax out of the price first) and markup (on cost): sales-math's, the only copy.
  const marginOf = (cost, price) => SalesMath.unitMargin(cost, price, state.settings);
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // A url that cannot break out of url('...') or an attribute; anything else = no image.
  const safeUrl = (u) => (/^(https?:\/\/|\/|\.\/|data:image\/)[^'"()\\\s]*$/i.test(String(u || '')) ? String(u) : '');
  const thumb = (url) => {
    const u = safeUrl(url);
    return `<span class="pd-thumb"${u ? ` style="background-image:url('${escapeHtml(u)}')"` : ''}></span>`;
  };

  // ponytail: the picture IS the product row - a shrunk data: URL. It rides the catalog
  // sync, works offline, and disappears when the product does, so there is nothing to
  // garbage-collect. Move to R2 + a link only if catalogs outgrow ~8KB a product.
  const IMG_MAX = 256;
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    const done = (fn, arg) => { URL.revokeObjectURL(img.src); fn(arg); };
    img.onload = () => {
      const s = Math.min(IMG_MAX / img.width, IMG_MAX / img.height, 1);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      // Safari < 16 has no webp encoder and silently hands back a PNG. Both are fine.
      done(resolve, c.toDataURL('image/webp', 0.8));
    };
    img.onerror = () => done(reject, new Error('Not an image'));
    img.src = URL.createObjectURL(file);
  });

  const opt = (v, label, on) => `<option value="${escapeHtml(v)}"${v === on ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  /* ---------- Which columns to show ----------
     A display preference, not a filter: it stays with the person, not with the link,
     so it lives in storage rather than the URL. Status is off by default — Inventory
     is where stock levels are answered. */
  const STORAGE_COLS = 'hwpos.bo.pdCols';
  const COLUMNS = [
    ['sku', 'SKU'], ['cat', 'Category'], ['supplier', 'Supplier'],
    ['cost', 'Cost'], ['price', 'Price'], ['margin', 'Margin'], ['stock', 'Stock'],
    ['status', 'Status'],
  ];
  // Stock is off too (2026-09-26): the Stock view answers it, and with it on the default
  // set ran past a 1440px card.
  const DEFAULT_COLS = COLUMNS.map(([k]) => k).filter((k) => k !== 'status' && k !== 'stock');

  const loadCols = () => loadColPrefs(STORAGE_COLS, COLUMNS, DEFAULT_COLS);   // backoffice.js, shared with Suppliers
  const saveCols = (set) => saveColPrefs(STORAGE_COLS, COLUMNS, set);

  // Pictures are the store's call, not the person's (owner, 2026-09-26): off for a hardware
  // shop's 500 SKUs, on for a cafe's menu. So it rides the synced settings, not pdCols. Its switch is the
  // first row of the Columns menu, over a hairline (owner, 2026-09-26: a button of its own was too loud).
  const showPics = () => !!state.settings.productPictures;

  // One class per hidden column on the table; the cells carry data-col and CSS does the rest.
  function applyCols() {
    const on = loadCols();
    const t = root().querySelector('#pdTable');
    if (!t) return;
    COLUMNS.forEach(([k]) => t.classList.toggle('hide-' + k, !on.has(k)));
    t.classList.toggle('pics', showPics());
  }

  const statusPill = (p, facts) =>
    (p.archived ? '<span class="status-pill muted">Archived</span>' : levelPill(facts.level(p)));

  /* ================= LIST ================= */

  // Stock view: name, how many, how fast, what it is worth, when it last sold, is that a
  // problem, fix it. Catalog view keeps the definition columns and the chooser.
  const HEAD_STOCK = `<th>Name</th><th class="num">In stock</th><th class="num">Units sold 30d</th>
    <th class="num">Stock value</th><th class="num">Last sold</th><th>Status</th><th class="num"></th>`;
  const HEAD_CATALOG = `<th class="pd-img-col" data-col="img"></th><th>Name</th>
    <th data-col="sku">SKU</th><th data-col="cat">Category</th><th data-col="supplier">Supplier</th>
    <th class="num" data-col="cost">Cost</th><th class="num" data-col="price">Price</th>
    <th class="num" data-col="margin">Margin</th>
    <th class="num" data-col="stock">Stock</th><th data-col="status">Status</th><th class="num"></th>`;

  // Catalog | Stock is a switch inside the page (owner, 2026-09-23), not two sidebar links:
  // one table, two column sets. Search and filters ride along; only `view` and the page change. No title beside it
  // (owner 2026-09-28): the lit sidebar row already says Items.
  const viewSwitch = (stock) => {
    const href = (v) => Router.href(VIEW, '', { ...params(), view: v === 'catalog' ? '' : v, page: '' });
    return `<div class="seg pd-switch" aria-label="Items view">${[['catalog', 'Catalog'], ['stock', 'Stock']].map(([v, label]) =>
      `<a class="seg-btn${(v === 'stock') === stock ? ' active' : ''}" href="${escapeHtml(href(v))}">${label}</a>`).join('')}</div>`;
  };

  function listShell(stock) {
    const folders = state.folders.filter((f) => f.id !== 'all');
    return `
      <header class="view-head">
        <div class="view-title-wrap">${viewSwitch(stock)}</div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="import">Import CSV</button>
          <button class="secondary-btn small" data-act="export">Export CSV</button>
          <button class="primary-btn small" data-act="new">Add item</button>
          <input type="file" id="pdFile" accept=".csv,text/csv" hidden>
        </div>
      </header>
      ${stock ? '<div class="kpi-row pd-kpis" id="pdKpis"></div>' : ''}
      <div class="pd-filters list-filters">
        <input class="search-input small q-input" placeholder="Search name, SKU, barcode..." autocomplete="off"
               value="${escapeHtml(state.invQuery)}">
        <select class="bo-select" data-filter="cat">
          ${opt('', 'All categories')}${folders.map((f) => opt(f.id, f.name)).join('')}
        </select>
        <select class="bo-select" data-filter="supplier">
          ${opt('', 'All suppliers')}${loadSuppliers().map((s) => opt(s.id, s.name)).join('')}${opt('none', 'No supplier')}
        </select>
        <span class="pd-level" id="pdLevel"></span>
        <label class="bo-check"><input type="checkbox" data-filter="archived"> Show archived</label>
        ${stock ? '' : colsMenu(COLUMNS, loadCols(),
          '<label class="bo-check" title="A store setting: every terminal follows it."><input type="checkbox" data-pics> Show pictures</label><hr>')}
      </div>
      <div id="pdImport"></div>
      <section class="bo-card blk-table pd-list" data-pd-view="${stock ? 'stock' : 'catalog'}">
        <div class="bo-card-head">
          <span class="bo-card-label">${stock ? 'In stock' : 'All items'}</span>
          <span class="bo-card-sub" id="pdShown"></span>
          <div class="pd-bulk" id="pdBulk" hidden>
            <span class="pd-bulk-n"></span>
            <button class="secondary-btn small" data-act="bulk-export">Export CSV</button>
            <button class="secondary-btn small" data-act="bulk-archive">Archive</button>
            <button class="link-btn" data-act="bulk-clear">Clear</button>
          </div>
        </div>
        <div class="bo-card-inset flush">
          <div class="table-wrap">
            <table class="data-table" id="pdTable">
              <thead><tr>
                <th class="pd-sel"><input type="checkbox" data-pick-all aria-label="Select all on this page"></th>
                ${stock ? HEAD_STOCK : HEAD_CATALOG}
              </tr></thead>
              <tbody></tbody>
            </table>
          </div>
          <div id="pdPager"></div>
        </div>
      </section>`;
  }

  function syncControls() {
    const p = params();
    const r = root();
    r.querySelector('[data-filter="cat"]').value = p.cat || '';
    r.querySelector('[data-filter="supplier"]').value = p.supplier || '';
    r.querySelector('[data-filter="archived"]').checked = p.archived === '1';
    // Redrawn each render so the label tracks the URL; reopen it if a tick was just made.
    const lvl = r.querySelector('#pdLevel');
    const open = !!lvl.querySelector('.ms-pick[open]');
    lvl.innerHTML = multiPick('level', 'All stock levels', '', 'stock levels', LEVEL_OPTS, levelsOf(p));
    if (open) lvl.querySelector('.ms-pick').open = true;
    const on = loadCols();
    r.querySelectorAll('[data-col-toggle]').forEach((b) => { b.checked = on.has(b.dataset.colToggle); });
    const pics = r.querySelector('[data-pics]');
    if (pics) pics.checked = showPics();
  }

  // The URL is the filter. One predicate, shared by the table and by Export. withLevel false
  // is the set the KPI tiles count, so a tile never reads 0 because its own filter is on.
  function filterProducts(facts = stockFacts(), withLevel = true) {
    const p = params();
    const levels = withLevel ? levelsOf(p) : [];
    const q = state.invQuery.trim().toLowerCase();
    // Searching "pvc elbow" has to find the variants, so the group name is part
    // of the haystack. Built once, and only when there is something to search.
    const gname = q ? new Map(loadGroups().map((g) => [g.id, g.name])) : null;
    const list = state.products.map(normalizeProduct).filter((item) => {
      if (item.archived && p.archived !== '1') return false;
      if (p.cat && !item.folders.includes(p.cat)) return false;
      if (p.supplier && (p.supplier === 'none'
        ? supplierIdsOf(item).length : !supplierIdsOf(item).includes(p.supplier))) return false;
      if (!q) return true;
      const hay = `${item.name} ${item.sku} ${item.barcode} `
        + `${item.aliases.join(' ')} ${gname.get(item.groupId) || ''}`;
      return hay.toLowerCase().includes(q);
    });
    if (!levels.length) return list;
    // A level keeps or drops a whole family, by the family's level, so a row never shows half of one.
    const fams = new Map();
    list.forEach((x) => (fams.get(famKey(x)) || fams.set(famKey(x), []).get(famKey(x))).push(x));
    const keep = new Set([...fams].filter(([, ms]) => levels.includes(famLevel(ms, facts))).map(([k]) => k));
    return list.filter((x) => keep.has(famKey(x)));
  }

  // A family's margin in whole percents with one sign, "30–37%": the spread is the point,
  // the decimals only pushed the column off the card.
  // Each end is SalesMath.pctText (unitMargin gives percent points), so a minus is a true minus.
  const marginRange = (vals) => {
    const [lo, hi] = [Math.min(...vals), Math.max(...vals)].map((v) => escapeHtml(SalesMath.pctText(v / 100, 1, 0)));
    return lo === hi ? lo : `${lo.replace('%', '')}&ndash;${hi}`;
  };

  // Stock view KPIs. Out / Low / Dead toggle their key in ?level=; Stock value clears it.
  function paintKpis(facts) {
    const el = root().querySelector('#pdKpis');
    if (!el) return;
    const levels = levelsOf(params());
    const shown = filterProducts(facts, false);
    const n = stockCounts(shown, facts.clock, facts.now, boZone());   // one per item, as the rows are
    const cash = stockValueOf(shown);
    // kpi() owns the tile markup; this only stamps the click target and the selected state.
    const tile = (key, html) => html.replace('class="bo-card blk-kpi"',
      `class="bo-card blk-kpi pd-kpi${key && levels.includes(key) ? ' on' : ''}" data-level="${key}" role="button" tabindex="0"`);
    el.innerHTML = tile('out', kpi('Out of stock', String(n.out), 'nothing on hand'))
      + tile('low', kpi('Low', String(n.low), 'at or below danger level'))
      + tile('dead', kpi('Dead', String(n.dead), `no sale in ${DEAD_DAYS} days`))
      + tile('', kpi('Stock value', pesoShort(cash), 'at cost'));
  }

  function paintTable() {
    const p = params();
    const stock = isStock();
    const facts = stockFacts();
    const groupMap = new Map(loadGroups().map((g) => [g.id, g]));
    const supplierMap = new Map(loadSuppliers().map((s) => [s.id, s.name]));

    // A family is ONE row. Its variants are inside the product, not loose in this
    // list - "Common Wire Nails" reads as one thing until you open it.
    const rows = [];
    const fams = new Map();
    filterProducts(facts).forEach((item) => {
      const g = item.groupId ? groupMap.get(item.groupId) : null;
      if (!g) {
        rows.push({ key: item.name, html: stock ? stockRowHtml(item, facts) : rowHtml(item, supplierMap, facts) });
        return;
      }
      if (!fams.has(g.id)) fams.set(g.id, []);
      fams.get(g.id).push(item);
    });
    fams.forEach((members, gid) => {
      const g = groupMap.get(gid);
      rows.push({ key: g.name,
        html: stock ? stockGroupRowHtml(g, members, facts) : groupRowHtml(g, members, supplierMap, facts) });
    });
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const filtered = state.invQuery || p.cat || p.supplier || levelsOf(p).length;
    const pg = paginate(rows, p.page);
    paintKpis(facts);
    root().querySelector('#pdTable tbody').innerHTML = pg.rows.map((r) => r.html).join('')
      || `<tr><td colspan="12" class="bo-empty">${filtered ? 'No items match these filters.' : 'No items yet. Add one to get started.'}</td></tr>`;
    root().querySelector('#pdPager').innerHTML = pagerHtml(pg);
    root().querySelector('#pdShown').textContent = `${rows.length} shown`;
    paintPicked();
  }

  /* Ticked rows: product ids and family ids, kept across pages and filters until an
     action runs or Clear. In memory only - a selection is not worth syncing. */
  const picked = new Set();
  const pickBox = (id) =>
    `<td class="pd-sel"><input type="checkbox" data-pick="${escapeHtml(id)}"${picked.has(id) ? ' checked' : ''} aria-label="Select"></td>`;

  function paintPicked() {
    const r = root();
    const boxes = [...r.querySelectorAll('[data-pick]')];
    const all = r.querySelector('[data-pick-all]');
    const on = boxes.filter((b) => b.checked).length;
    all.checked = boxes.length > 0 && on === boxes.length;
    all.indeterminate = on > 0 && on < boxes.length;
    r.querySelector('#pdBulk').hidden = !picked.size;
    r.querySelector('#pdShown').hidden = !!picked.size;
    r.querySelector('.pd-bulk-n').textContent = `${picked.size} selected`;
  }

  // A family tick means every variant in it.
  const pickedProducts = () => state.products.filter((x) => picked.has(x.id) || picked.has(x.groupId));

  const editBtn = '<td class="num pd-act"><button class="secondary-btn small" data-act="edit">Edit</button></td>';

  // Stock view. A plain product gets Adjust (backoffice.js opens the dialog off data-adjust-open);
  // a family does not - its row opens the item page, where each variant is adjusted.
  const stockCells = (name, onHand, sold, value, last, level, act) => `
        <td>${name}</td>
        <td class="num"><strong>${onHand}</strong></td>
        <td class="num">${sold ? SalesMath.qtyText(sold) : '&mdash;'}</td>
        <td class="num">${peso(value)}</td>
        <td class="num">${last}</td>
        <td>${levelPill(level)}</td>
        <td class="num pd-act">${act}</td>`;

  function stockRowHtml(p, facts) {
    const c = facts.clock.get(p.id);
    return `
      <tr class="pd-row${p.archived ? ' pd-arch' : ''}" data-id="${escapeHtml(p.id)}">
        ${pickBox(p.id)}${stockCells(escapeHtml(p.name),
          `${SalesMath.qtyText(p.stock)} ${escapeHtml(p.unit)}`, facts.sold.get(p.id) || 0, stockValueOf([p]),
          lastSold(c && c.lastSale, facts.now), facts.level(p),
          `<button class="secondary-btn small" data-adjust-open="${escapeHtml(p.id)}">Adjust</button>`)}
      </tr>`;
  }

  function stockGroupRowHtml(g, members, facts) {
    const sales = members.map((m) => (facts.clock.get(m.id) || {}).lastSale).filter((t) => t != null);
    return `
      <tr class="pd-row${members.every((m) => m.archived) ? ' pd-arch' : ''}" data-id="${escapeHtml(g.id)}">
        ${pickBox(g.id)}${stockCells(`${escapeHtml(g.name)}
            <span class="pd-vcount">${SalesMath.plural(members.length, 'variant')}</span>`,
          `${SalesMath.qtyText(onHandOf(members))} ${escapeHtml(members[0].unit)}`,
          members.reduce((n, m) => n + (facts.sold.get(m.id) || 0), 0),
          stockValueOf(members),
          lastSold(sales.length ? Math.max(...sales) : null, facts.now),
          famLevel(members, facts), '')}
      </tr>`;
  }

  function rowHtml(p, supplierMap, facts) {
    return `
      <tr class="pd-row${p.archived ? ' pd-arch' : ''}" data-id="${escapeHtml(p.id)}">
        ${pickBox(p.id)}
        <td class="pd-img-col" data-col="img">${thumb(p.imageUrl)}</td>
        <td>${escapeHtml(p.name)}</td>
        <td class="mono" data-col="sku">${escapeHtml(p.sku || '-')}</td>
        <td data-col="cat">${escapeHtml(folderName(p.folder))}</td>
        <td data-col="supplier">${escapeHtml(supplierMap.get(p.supplierId) || '-')}${
          p.altSupplierIds.length ? `<span class="muted"> +${p.altSupplierIds.length}</span>` : ''}</td>
        <td class="num" data-col="cost">${peso(p.cost)}</td>
        <td class="num" data-col="price"><strong>${peso(p.price)}</strong></td>
        <td class="num" data-col="margin">${marginRange([marginOf(p.cost, p.price).margin])}</td>
        <td class="num" data-col="stock">${SalesMath.qtyText(p.stock)} ${escapeHtml(p.unit)}</td>
        <td data-col="status">${statusPill(p, facts)}</td>
        ${editBtn}
      </tr>`;
  }

  // The collapsed family: aggregates, and the picture is the group's unless every
  // variant brought its own.
  function groupRowHtml(g, members, supplierMap, facts) {
    const stock = onHandOf(members);
    const sups = new Set(members.map((m) => m.supplierId));
    const alts = new Set(members.flatMap((m) => m.altSupplierIds));
    const status = levelPill(famLevel(members, facts));
    return `
      <tr class="pd-row${members.every((m) => m.archived) ? ' pd-arch' : ''}" data-id="${escapeHtml(g.id)}">
        ${pickBox(g.id)}
        <td class="pd-img-col" data-col="img">${thumb(imageFor(members[0], [g]))}</td>
        <td>${escapeHtml(g.name)}
            <span class="pd-vcount">${SalesMath.plural(members.length, 'variant')}</span></td>
        <td class="mono" data-col="sku">&mdash;</td>
        <td data-col="cat">${escapeHtml(folderName(g.folder || members[0].folder))}</td>
        <td data-col="supplier">${sups.size > 1 ? 'Mixed' : escapeHtml(supplierMap.get(members[0].supplierId) || '-')}${
          alts.size ? `<span class="muted"> +${alts.size}</span>` : ''}</td>
        <td class="num" data-col="cost">${rangeText(members.map((m) => m.cost))}</td>
        <td class="num" data-col="price"><strong>${rangeText(members.map((m) => m.price))}</strong></td>
        <td class="num" data-col="margin">${marginRange(members.map((m) => marginOf(m.cost, m.price).margin))}</td>
        <td class="num" data-col="stock">${SalesMath.qtyText(stock)} ${escapeHtml(members[0].unit)}</td>
        <td data-col="status">${status}</td>
        ${editBtn}
      </tr>`;
  }

  /* ================= CSV ================= */

  let pending = null;   // the parsed import, waiting for the user to confirm

  function exportCsv() {
    const list = filterProducts();
    downloadCsv('items.csv', [PRODUCT_COLUMNS.map((c) => c.head)].concat(list.map(productToCsvRow)));
    showToast(`Exported ${SalesMath.plural(list.length, 'item')}`);
  }

  // Pure: what an import WOULD do. Matches by SKU, then barcode, then name, and names
  // the categories it would have to create. Exported for scripts/products-check.mjs.
  function planImport(rows, products, folders, suppliers = []) {
    const headers = (rows[0] || []).map((h) => String(h).trim().toLowerCase());
    const bySku = new Map(), byBarcode = new Map(), byName = new Map();
    products.forEach((p) => {
      if (p.sku) bySku.set(String(p.sku).toLowerCase(), p);
      if (p.barcode) byBarcode.set(String(p.barcode).toLowerCase(), p);
      if (p.name) byName.set(String(p.name).toLowerCase(), p);
    });
    const byId = new Map(folders.map((f) => [f.id, f]));
    const byFolderName = new Map(folders.map((f) => [String(f.name).toLowerCase(), f]));
    const made = new Map();
    const out = { create: [], update: [], failed: [], folders: [], suppliers: [] };
    // Suppliers the same way: ids on our own export, names on anyone else's. A name stored as an id
    // left the item on no supplier's page and out of the "No supplier" filter too.
    const supById = new Map(suppliers.map((s) => [s.id, s]));
    const supByName = new Map(suppliers.map((s) => [String(s.name).toLowerCase(), s]));
    const supId = (name) => {
      const key = String(name).toLowerCase();
      let s = supById.get(name) || supByName.get(key);
      // An id we don't have (another store's export) is not a name: no supplier called "3f2a…".
      if (!s && /^(sup_|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(name)) return '';
      if (!s) {
        s = { ...SUPPLIER_DEFAULTS, id: newId('sup'), name, updatedAt: new Date().toISOString() };
        supByName.set(key, s);
        out.suppliers.push(s);
      }
      return s.id;
    };

    // Not a PRODUCT_COLUMNS field (bo-model.js owns that list) — read straight off the
    // header row so an importer's "in store since" survives without editing that file.
    const sinceCol = headers.indexOf('in_store_since') >= 0 ? headers.indexOf('in_store_since')
      : headers.indexOf('opening_since');

    rows.slice(1).forEach((row, i) => {
      if (row.every((c) => String(c).trim() === '')) return;
      const { product, errors } = productFromCsvRow(row, headers);
      const match = (product.sku && bySku.get(String(product.sku).toLowerCase()))
        || (product.barcode && byBarcode.get(String(product.barcode).toLowerCase()))
        || byName.get(String(product.name).toLowerCase()) || null;
      // Stock with no cost on file prices every unit at ₱0 — cash tied up on the shelf
      // reads as nothing until someone notices the margin report is lying. Only a new product
      // takes its stock from the file, so an update row is never refused for it.
      if (!match && (Number(product.stock) || 0) > 0 && !(Number(product.cost) > 0)) {
        errors.push('stock > 0 needs a cost — refusing to import at cost 0');
      }
      if (errors.length) { out.failed.push({ line: i + 2, name: product.name || '(no name)', errors }); return; }
      if (sinceCol >= 0) {
        const since = String(row[sinceCol] || '').trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(since)) product.openingSince = since;
      }
      // The category column carries ids on a file we exported and names on one we
      // did not, | between several. Accept either, and create what neither knows about.
      if (product.folders) {
        product.folders = product.folders.map((name) => {
          const key = String(name).toLowerCase();
          const hit = byId.get(name) || byFolderName.get(key) || made.get(key);
          if (hit) return hit.id;
          const base = slug(name);
          let id = base ? 'cat_' + base : 'cat_' + (out.folders.length + 1);
          if (byId.has(id)) id += '_' + (out.folders.length + 1);
          const f = { id, name, builtin: false, updatedAt: new Date().toISOString() };
          made.set(key, f);
          out.folders.push(f);
          return id;
        });
        product.folder = product.folders[0];   // normalizeProduct keeps `folder` first
      }
      if (product.supplierId) product.supplierId = supId(product.supplierId);
      if (product.altSupplierIds) product.altSupplierIds = product.altSupplierIds.map(supId).filter(Boolean);
      (match ? out.update : out.create).push({ product, match });
    });
    return out;
  }

  function paintImport() {
    const el = root().querySelector('#pdImport');
    if (!pending) { el.innerHTML = ''; return; }
    const fails = pending.failed.map((f) =>
      `<div class="pd-fail"><span>Line ${f.line} &middot; ${escapeHtml(f.name)}</span>`
      + `<span class="muted">${escapeHtml(f.errors.join('; '))}</span></div>`).join('');
    const total = pending.create.length + pending.update.length;
    el.innerHTML = `
      <section class="bo-card">
        <div class="bo-card-head">
          <span class="bo-card-label">Import preview</span>
          <span class="bo-card-sub">${escapeHtml(pending.file)}</span>
        </div>
        <div class="bo-card-inset">
          <div class="pd-imp-sum">
            <span><strong>${pending.create.length}</strong> new</span>
            <span><strong>${pending.update.length}</strong> updated</span>
            <span><strong>${pending.failed.length}</strong> skipped</span>
            ${pending.folders.length ? `<span><strong>${pending.folders.length}</strong> new ${SalesMath.pluralWord(pending.folders.length, 'category', 'categories')}</span>` : ''}
            ${pending.suppliers.length ? `<span><strong>${pending.suppliers.length}</strong> new ${SalesMath.pluralWord(pending.suppliers.length, 'supplier')}</span>` : ''}
          </div>
          <p class="pd-hint">Stock is applied only to new items, as an opening count. Items that already exist keep the stock Inventory has for them.</p>
          ${fails ? `<div class="pd-fails">${fails}</div>` : ''}
          <div class="pd-actions">
            <button class="secondary-btn small" data-act="import-cancel">Cancel</button>
            <button class="primary-btn small" data-act="import-apply"${total ? '' : ' disabled'}>Apply import</button>
          </div>
        </div>
      </section>`;
  }

  function commitImport(plan) {
    if (plan.folders.length) {
      saveFolders(state.folders.concat(plan.folders));
    }
    if (plan.suppliers.length) saveSuppliers(loadSuppliers().concat(plan.suppliers));
    const list = state.products.slice();
    const idx = new Map(list.map((p, i) => [p.id, i]));
    const stamp = new Date().toISOString();
    const movements = [];
    plan.update.forEach(({ product, match }) => {
      const rest = { ...product };
      delete rest.stock;                 // Inventory owns stock once a product exists
      const next = normalizeProduct({ ...match, ...rest, id: match.id, updatedAt: stamp });
      const at = idx.get(match.id);
      if (at == null) list.push(next); else list[at] = next;
    });
    plan.create.forEach(({ product }) => {
      const rest = { ...product };
      const opening = num(rest.stock);
      const happenedOn = rest.openingSince;
      delete rest.stock;
      delete rest.openingSince;      // not a product field — only fed the movement below
      const next = normalizeProduct({ ...rest, id: newId('p'), stock: 0, updatedAt: stamp });
      if (opening > 0) {
        const mv = makeMovement({ productId: next.id, qty: opening, reason: 'count', note: 'Opening stock (import)',
          happenedOn, ...who() });
        applyMovement(next, mv);
        movements.push(mv);
      }
      list.push(next);
    });
    state.products = list;
    saveProducts();
    appendMovements(movements);
  }

  /* ================= EDITOR =================
     Ported from product-edit-lab.html (2026-10-01). One editor for a plain product, a family
     and a new one: the form edits P, Save turns P into product rows. The classes are pe-*
     because .card / .chip / .menu already mean something else in this app. */

  const PE_CHEV = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
  const PE_PLUS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>';
  const PE_X = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3l6 6M9 3 3 9"/></svg>';
  const UNITS = [['Counted', ['pc', 'box', 'bag', 'set', 'pair', 'roll', 'sheet', 'can']], ['Measured', ['m', 'ft', 'kg', 'L', 'gal']]];
  // Sold per picks soldBy: a measured unit takes decimals. A unit you typed keeps what it was.
  const soldByFor = (unit, was) => (UNITS[1][1].includes(unit) ? 'measure' : UNITS[0][1].includes(unit) ? 'each' : was || 'each');

  let P = null, openV = -1, dirty = false;

  const val = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));   // '' is no answer, not 0
  const markupOf = (c, p) => (val(c) && val(p) != null ? marginOf(c, p).markup : null);
  const fmtPct = (m) => (m == null || !Number.isFinite(m) ? '' : String(round2(m)));
  const profitLine = (c, p, withMarkup) => {
    const cc = val(c), pp = val(p);
    if (cc == null || pp == null) return '';
    const m = markupOf(cc, pp);
    return `<b>${peso(marginOf(cc, pp).profit)}</b> gross profit on each${withMarkup && m != null ? ` · ${SalesMath.pctText(m / 100)} markup` : ''}`;
  };
  // A variant row names what makes it this one; the family name is already the title.
  const blankVariant = () => ({ id: '', short: '', prefixed: true, sku: '', barcode: '', cost: '', price: '', openingQty: '', isNew: true });
  const vName = (v) => (v.prefixed ? `${P.name.trim()} ${v.short.trim()}` : v.short.trim());
  const liveStock = (id) => { const x = state.products.find((p) => p.id === id); return x ? round2(num(x.stock)) : 0; };

  // What every variant shares (and what a plain product has the same way).
  const sharedOf = (b) => ({
    cats: foldersOf(b), sups: supplierIdsOf(b), main: b.supplierId, mods: [...b.modifierIds],
    unit: b.unit || 'pc', low: b.reorderPoint || '', track: b.trackStock, hidden: b.hidden, sellOut: b.sellOutOfStock,
    weight: b.weight, size: b.size, length: b.length, since: isoDate(Date.now()),
  });

  function loadP(id) {
    const g = loadGroups().find((x) => x.id === id);
    if (g) {
      const live = state.products.map(normalizeProduct).filter((x) => x.groupId === g.id);
      // All archived: the family was archived in one go, so its variants share the newest stamp;
      // an older one was removed from the list before and stays removed on Restore.
      const last = live.reduce((m, x) => (x.updatedAt > m ? x.updatedAt : m), '');
      const members = live.some((x) => !x.archived) ? live.filter((x) => !x.archived) : live.filter((x) => x.updatedAt === last);
      const b = members[0] || normalizeProduct({ folder: g.folder });
      const pre = g.name + ' ';
      return { ...sharedOf(b), key: id, family: true, gid: g.id, name: g.name, desc: g.description || '',
        photo: safeUrl(imageFor(b, [g])), archived: members.length > 0 && members.every((m) => m.archived),
        variants: members.map((m) => ({ id: m.id, short: m.name.startsWith(pre) ? m.name.slice(pre.length) : m.name,
          prefixed: m.name.startsWith(pre), sku: m.sku, barcode: m.barcode, cost: m.cost, price: m.price })) };
    }
    const p = id === 'new' ? normalizeProduct({ folder: params().cat || '' })
      : state.products.map(normalizeProduct).find((x) => x.id === id);
    if (!p) return null;
    if (p.groupId && loadGroups().some((x) => x.id === p.groupId)) return { ...loadP(p.groupId), key: id };
    return { ...sharedOf(p), key: id, family: false, isNew: id === 'new', id: p.id, name: p.name, desc: p.description,
      photo: safeUrl(p.imageUrl), sku: p.sku, barcode: p.barcode, archived: p.archived,
      cost: id === 'new' ? '' : p.cost, price: id === 'new' ? '' : p.price, openingQty: '' };
  }

  /* ---- pieces ---- */
  const peCard = (title, body, right = '') => `<section class="pe-card">${title ? `<div class="pe-band">${title}${right ? `<span class="pe-r">${right}</span>` : ''}</div>` : ''}${body}</section>`;
  const fld = (label, ctl) => `<label class="pe-f"><span>${label}</span>${ctl}</label>`;
  const inp = (k, v, attrs = '') => `<input class="pe-in" data-k="${k}" value="${escapeHtml(v == null ? '' : v)}"${attrs}>`;
  const money = (attr, v) => `<div class="pe-affix pre"><i>${escapeHtml(SalesMath.currencySymbol(storeCurrency()))}</i><input class="pe-in" ${attr} value="${escapeHtml(v == null ? '' : v)}" inputmode="decimal" placeholder="0.00"></div>`;
  const qty = (attr, v) => `<div class="pe-affix suf"><i>${escapeHtml(P.unit)}</i><input class="pe-in" ${attr} value="${escapeHtml(v == null ? '' : v)}" inputmode="decimal" placeholder="0"></div>`;
  const pick = (id, inner) => `<button type="button" class="pe-pick" popovertarget="${id}">${inner}${PE_CHEV}</button><div class="pe-menu" id="${id}" popover></div>`;
  const chipX = (list, i, v) => `<button type="button" class="pe-x" data-pe="del" data-list="${list}" data-i="${i}" aria-label="Remove ${escapeHtml(v)}">${PE_X}</button>`;
  const chipAdd = (id, n, word) => `<button type="button" class="pe-chip-add" popovertarget="${id}">${PE_PLUS}${n ? 'Add' : word}</button><div class="pe-menu" id="${id}" popover></div>`;
  const sw = (label, k, on) => `<label class="pe-sw">${label}<input type="checkbox" data-k="${k}"${on ? ' checked' : ''}></label>`;
  const modsById = () => new Map(loadModifiers().map((m) => [m.id, m]));
  const modSummary = (m) => (m.options.length ? m.options.map((o) => `${o.name} +${peso(o.price)}`).join(' · ') : 'No options yet');

  function vRow(v, i) {
    const stock = !P.track ? '' : v.isNew ? (val(v.openingQty) ? `${v.openingQty} ${escapeHtml(P.unit)}` : 'New') : `${liveStock(v.id)} ${escapeHtml(P.unit)}`;
    return `<button type="button" class="pe-vrow${i === openV ? ' open' : ''}" data-pe="open-v" data-i="${i}">
        <span><b>${escapeHtml(v.short || 'New variant')}</b><small>${escapeHtml(v.sku || 'No SKU')}</small></span>
        <span class="pe-num">${val(v.price) != null ? peso(v.price) : '<span class="pe-muted">No price</span>'}</span>
        <span class="pe-num pe-muted">${stock}</span>${PE_CHEV}
      </button>`;
  }
  function vEdit(v, i) {
    const at = (k) => `data-v="${k}" data-i="${i}"`;
    return `<div class="pe-vedit">
        ${fld('Variant', `<input class="pe-in" ${at('short')} value="${escapeHtml(v.short)}" placeholder="Red, 2 inch, 1 gal">`)}
        <div class="pe-row2">${fld('Cost', money(at('cost'), v.cost))}${fld('Price', money(at('price'), v.price))}</div>
        <div class="pe-say" data-vprofit>${profitLine(v.cost, v.price, true)}</div>
        <div class="pe-row2">${fld('SKU', `<input class="pe-in" ${at('sku')} value="${escapeHtml(v.sku)}">`)}${fld('Barcode', `<input class="pe-in" ${at('barcode')} value="${escapeHtml(v.barcode)}" inputmode="numeric">`)}</div>
        ${v.isNew && P.track ? `<div class="pe-row2">${fld('Opening stock', qty(at('openingQty'), v.openingQty))}<span></span></div>` : ''}
        <div class="pe-vfoot"><button type="button" class="pe-quiet" data-pe="del-v" data-i="${i}">Remove variant</button></div>
      </div>`;
  }

  function cardsHtml() {
    const T = P.track;
    const photo = `<div class="pe-f"><span>Photo</span><label class="pe-photo${P.photo ? ' has' : ''}"${P.photo ? ` style="background-image:url('${escapeHtml(P.photo)}')"` : ''}>
        ${P.photo ? '' : PE_PLUS}<input type="file" accept="image/*" data-pe-img hidden></label>
        ${P.photo ? '<button type="button" class="pe-quiet" data-pe="photo-clear">Remove</button>' : ''}</div>`;
    const about = peCard('', `<div class="pe-about">${photo}<div class="pe-fields">
        ${fld('Name', `<input class="pe-in big" data-k="name" value="${escapeHtml(P.name)}" placeholder="${P.family ? 'Acrylic Paint Tint' : 'Portland Cement 40kg'}">`)}
        ${fld('Description', `<textarea class="pe-in" data-k="desc" rows="2" placeholder="What it is, what it fits, how to use it">${escapeHtml(P.desc)}</textarea>`)}
      </div></div>`);

    const cat = peCard('Categories', `<div class="pe-chips">
        ${P.cats.map((c, i) => `<span class="pe-chip"><span>${escapeHtml(folderName(c))}</span>${chipX('cats', i, folderName(c))}</span>`).join('')}
        ${chipAdd('pe-m-cat', P.cats.length, 'Add category')}</div>`);

    const price = P.family ? '' : peCard('Price', `<div class="pe-body">
        <div class="pe-row3">
          ${fld('Cost', money('data-k="cost"', P.cost))}
          ${fld('Markup', `<div class="pe-affix suf"><i>%</i><input class="pe-in" data-k="markup" value="${escapeHtml(fmtPct(markupOf(P.cost, P.price)))}" inputmode="decimal" placeholder="0"></div>`)}
          ${fld('Price', money('data-k="price"', P.price))}
        </div>
        <div class="pe-say" data-profit>${profitLine(P.cost, P.price)}</div>
      </div><button type="button" class="pe-vadd" data-pe="add-variant">${PE_PLUS}Add variants</button>`);

    const variants = !P.family ? '' : peCard('Variants', `<div class="pe-vlist">
        ${P.variants.map((v, i) => vRow(v, i) + (i === openV ? vEdit(v, i) : '')).join('')}
        <button type="button" class="pe-vadd" data-pe="add-variant">${PE_PLUS}Add variant</button>
        ${T && P.variants.some((v) => v.isNew && val(v.openingQty)) ? `<div class="pe-since">New stock was in store since <input class="pe-in" type="date" data-k="since" value="${P.since}" max="${isoDate(Date.now())}"></div>` : ''}
      </div>`, `${P.variants.length}`);

    const mods = modsById();
    const mod = peCard('Modifiers', `<div class="pe-chips">
        ${P.mods.map((id, i) => { const m = mods.get(id); return m ? `<span class="pe-chip" title="${escapeHtml(modSummary(m))}"><span>${escapeHtml(m.name)}</span>${chipX('mods', i, m.name)}</span>` : ''; }).join('')}
        ${chipAdd('pe-m-mod', P.mods.length, 'Add modifier')}</div>`);

    const stock = peCard('Stock', `<div class="pe-body">
        ${!T || P.family || P.isNew ? '' : `<div class="pe-line"><span class="pe-onhand">${liveStock(P.id)}<small>${escapeHtml(P.unit)} on hand</small></span>
          <button type="button" class="secondary-btn small" data-adjust-open="${escapeHtml(P.id)}">Adjust</button></div>`}
        <div class="pe-row2">
          ${fld('Sold per', pick('pe-m-unit', `<span>${escapeHtml(P.unit)}</span>`))}
          ${T ? fld('Low stock at', qty('data-k="low"', P.low)) : '<span></span>'}
        </div>
        ${!T || P.family || !P.isNew ? '' : `<div class="pe-row2">${fld('Opening stock', qty('data-k="openingQty"', P.openingQty))}
          ${fld('In store since', `<input class="pe-in" type="date" data-k="since" value="${P.since}" max="${isoDate(Date.now())}">`)}</div>`}
        ${P.family ? '' : `<div class="pe-row2">${fld('SKU', inp('sku', P.sku))}${fld('Barcode', inp('barcode', P.barcode, ' inputmode="numeric"'))}</div>`}
        ${sw('Track stock', 'track', T)}
        ${T ? sw('Sell when out of stock', 'sellOut', P.sellOut) : ''}
      </div>`);

    // Optional main supplier (owner, 2026-10-01): purchase orders go to it. Tap a name to make it
    // main, tap the main one to have none.
    const supName = new Map(loadSuppliers().map((s) => [s.id, s.name]));
    const sups = peCard('Suppliers', `<div class="pe-chips">
        ${P.sups.map((s, i) => `<span class="pe-chip"><button type="button" class="pe-nm" data-pe="main" data-i="${i}"
          title="${s === P.main ? 'Main supplier: purchase orders go here. Tap for none' : 'Make this the main supplier'}">${escapeHtml(supName.get(s) || s)}</button>${s === P.main ? '<em>Main</em>' : ''}${chipX('sups', i, supName.get(s) || s)}</span>`).join('')}
        ${chipAdd('pe-m-sup', P.sups.length, 'Add supplier')}</div>`);

    const specs = peCard('Specs', `<div class="pe-body"><div class="pe-row3">
        ${fld('Weight', inp('weight', P.weight, ' placeholder="2.5 kg"'))}
        ${fld('Size', inp('size', P.size, ' placeholder="3/4 in"'))}
        ${fld('Length', inp('length', P.length, ' placeholder="8 ft"'))}
      </div></div>`);

    return about + cat + price + variants + mod + stock + sups + specs;
  }

  function paintEditor() {
    const n = P.family ? P.variants.length : 0;
    root().innerHTML = `<div class="pe">
        <header class="item-head"><a class="item-back" href="${escapeHtml(Router.href(VIEW, ''))}">Items</a>
          <h1>${escapeHtml(P.name || 'New item')}</h1>${P.family ? `<span class="pe-muted">${SalesMath.plural(n, 'variant')}</span>` : ''}</header>
        <div class="pe-side">${peCard('Status', `<div class="pe-body">${pick('pe-m-status',
          `<i class="pe-dot${P.hidden ? '' : ' on'}"></i><span>${P.hidden ? 'Hidden' : 'Active'}</span>`)}</div>`)}</div>
        <div class="pe-col">${cardsHtml()}</div>
        <div class="pe-formbar">${P.isNew ? '' : `<button type="button" class="pe-quiet" data-pe="archive">${P.archived ? 'Restore' : 'Archive'}</button>`}
          <button type="button" class="primary-btn small" data-pe="save"${dirty ? '' : ' disabled'}>Save</button></div>
      </div>`;
    root().querySelectorAll('textarea.pe-in').forEach(grow);
  }

  function renderEditor(id) {
    if (!P || P.key !== id || P.visit !== state.visit) {   // a re-render (sync, Adjust) keeps what is being typed
      P = loadP(id); openV = -1; dirty = false;
      if (P) P.visit = state.visit;
    }
    if (!P) {
      root().innerHTML = `<header class="view-head"><div class="view-title-wrap"><h1>Item not found</h1>
        <span class="muted">It may have been removed.</span></div>
        <div class="view-actions"><button class="secondary-btn small" data-act="back">Back to items</button></div></header>`;
      return;
    }
    paintEditor();
  }

  const grow = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
  const touch = () => { dirty = true; const b = root().querySelector('[data-pe="save"]'); if (b) b.disabled = false; };
  const focusV = (i, k) => { const el = root().querySelector(`[data-v="${k}"][data-i="${i}"]`); if (el) el.focus(); };

  /* ---- menus: filled when they open, searched as you type ---- */
  function menuItems(id, q) {
    const has = (s) => String(s).toLowerCase().includes(q.trim().toLowerCase());
    const is = (s) => String(s).toLowerCase() === q.trim().toLowerCase();
    const btn = (v, label, on, sub) => `<button type="button" role="menuitemradio" aria-checked="${!!on}" data-pe-pick="${id}" data-v="${escapeHtml(v)}">${sub
      ? `<span class="pe-opt">${escapeHtml(label)}<small>${escapeHtml(sub)}</small></span>` : escapeHtml(label)}</button>`;
    const add = (names, word) => (q.trim() && !names.some(is)
      ? `<button type="button" class="new" data-pe-pick="${id}" data-new="${escapeHtml(q.trim())}">${word} “${escapeHtml(q.trim())}”</button>` : '');
    const none = (hits) => (hits ? '' : `<div class="pe-none">${q.trim() ? 'No match' : 'All added'}</div>`);
    if (id === 'pe-m-status') {
      return btn('active', 'Active', !P.hidden, 'Sells on the till') + btn('hidden', 'Hidden', P.hidden, 'Kept, but not on the till');
    }
    if (id === 'pe-m-unit') {
      return UNITS.map(([g, us]) => [g, us.filter(has)]).filter(([, us]) => us.length)
        .map(([g, us]) => `<div class="pe-grp">${g}</div>${us.map((u) => btn(u, u, u === P.unit)).join('')}`).join('')
        + add(UNITS.flatMap(([, us]) => us), 'Use');
    }
    if (id === 'pe-m-mod') {   // lists are made on the Modifiers page, so this only picks
      const hits = loadModifiers().filter((m) => !m.archived && !P.mods.includes(m.id) && has(m.name));
      return hits.map((m) => btn(m.id, m.name, false, modSummary(m))).join('') + none(hits.length);
    }
    const [all, mine] = id === 'pe-m-cat' ? [state.folders.filter((f) => f.id !== 'all'), P.cats] : [loadSuppliers(), P.sups];
    const hits = all.filter((x) => !mine.includes(x.id) && has(x.name));
    return hits.map((x) => btn(x.id, x.name, false)).join('') + add(all.map((x) => x.name), 'Add')
      + (q.trim() ? '' : none(hits.length));
  }

  document.addEventListener('toggle', (e) => {
    const m = e.target;
    if (!m.matches || !m.matches('.pe-menu') || e.newState !== 'open' || !mine(m)) return;
    const search = m.id !== 'pe-m-status';   // two choices need no search box
    m.innerHTML = (search ? `<input class="pe-ms" placeholder="${m.id === 'pe-m-unit' ? 'Search or type your own' : 'Search'}" data-ms="${m.id}">` : '')
      + `<div class="pe-ml">${menuItems(m.id, '')}</div>`;
    const b = root().querySelector(`[popovertarget="${m.id}"]`).getBoundingClientRect();
    m.style.position = 'fixed';
    m.style.width = Math.max(b.width, 240) + 'px';
    m.style.left = Math.max(16, Math.min(b.left, innerWidth - m.offsetWidth - 16)) + 'px';
    const below = innerHeight - b.bottom - 16;
    m.style.top = (below < Math.min(m.offsetHeight, 240) ? Math.max(16, b.top - 6 - m.offsetHeight) : b.bottom + 6) + 'px';
    if (search) m.querySelector('.pe-ms').focus();
  }, true);

  // ponytail: "Add “x”" makes the category or supplier on the spot, before Save, like the lab.
  // An abandoned edit leaves an unused name behind; the Categories page can delete it.
  function peChoose(t) {
    const id = t.dataset.pePick;
    let v = t.dataset.v;
    const made = t.dataset.new;
    if (id === 'pe-m-cat' && made) v = addFolder(made);
    if (id === 'pe-m-sup' && made) {
      v = newId('sup');
      saveSuppliers(loadSuppliers().concat({ ...SUPPLIER_DEFAULTS, id: v, name: made, updatedAt: new Date().toISOString() }));
    }
    if (id === 'pe-m-cat') P.cats.push(v);
    if (id === 'pe-m-sup') { if (!P.sups.length) P.main = v; P.sups.push(v); }   // the first one is main until you say otherwise
    if (id === 'pe-m-mod') P.mods.push(v);
    if (id === 'pe-m-status') P.hidden = v === 'hidden';
    if (id === 'pe-m-unit') P.unit = made || v;
    t.closest('.pe-menu').hidePopover();
    dirty = true;
    paintEditor();
  }

  function peClick(t) {
    if (t.dataset.pePick) { peChoose(t); return; }
    const a = t.dataset.pe, i = Number(t.dataset.i);
    if (a === 'open-v') { openV = openV === i ? -1 : i; paintEditor(); return; }
    if (a === 'add-variant') {
      if (!P.family) {
        // A plain product grows variants by becoming a family: it is variant one, keeping its id,
        // stock and history. Nothing is written until Save.
        Object.assign(P, { family: true, gid: newId('grp'), variants: [{ ...blankVariant(), id: P.isNew ? '' : P.id,
          isNew: !!P.isNew, sku: P.sku, barcode: P.barcode, cost: P.cost, price: P.price, openingQty: P.openingQty }] });
        openV = 0;
      } else {
        P.variants.push(blankVariant());
        openV = P.variants.length - 1;
      }
      touch(); paintEditor(); focusV(openV, 'short'); return;
    }
    if (a === 'del-v') {
      if (P.variants.length < 2) { showToast('An item needs at least one variant'); return; }
      P.variants.splice(i, 1); openV = -1; touch(); paintEditor(); return;
    }
    if (a === 'del') {
      const [gone] = P[t.dataset.list].splice(i, 1);
      if (t.dataset.list === 'sups' && gone === P.main) P.main = '';
      touch(); paintEditor(); return;
    }
    if (a === 'main') {
      const s = P.sups[i];
      if (P.main === s) P.main = '';
      else { P.main = s; P.sups.unshift(...P.sups.splice(i, 1)); }
      touch(); paintEditor(); return;
    }
    if (a === 'photo-clear') { P.photo = ''; touch(); paintEditor(); return; }
    if (a === 'save') { if (P.family) saveGroup(); else save(); return; }
    if (a === 'archive') archive();
  }

  function peInput(t) {
    if (t.dataset.ms) { t.closest('.pe-menu').querySelector('.pe-ml').innerHTML = menuItems(t.dataset.ms, t.value); return; }
    if (t.matches('textarea')) grow(t);
    const k = t.dataset.k;
    const box = (key) => root().querySelector(`[data-k="${key}"]`);
    if (k) {
      if (k === 'track') { P.track = t.checked; touch(); paintEditor(); return; }
      if (k === 'sellOut') P.sellOut = t.checked;
      else if (k === 'markup') {
        const m = val(t.value), c = val(P.cost);
        if (m != null && c != null) { P.price = priceFromMargin(c, 'percent', m); box('price').value = P.price; }
      } else P[k] = t.value;
      // Cost moves the price at the same markup; a typed price moves the markup.
      if (k === 'cost') {
        const m = val(box('markup') && box('markup').value);
        if (m != null && val(P.cost) != null) { P.price = priceFromMargin(P.cost, 'percent', m); box('price').value = P.price; }
      }
      if (k === 'price' && box('markup')) box('markup').value = fmtPct(markupOf(P.cost, P.price));
      if (k === 'name') root().querySelector('.item-head h1').textContent = t.value || 'New item';
      const pl = root().querySelector('[data-profit]');
      if (pl) pl.innerHTML = profitLine(P.cost, P.price);
    }
    if (t.dataset.v) {
      const i = Number(t.dataset.i), v = P.variants[i];
      v[t.dataset.v] = t.value;
      const rowEl = root().querySelector(`.pe-vrow[data-i="${i}"]`);
      if (rowEl) rowEl.outerHTML = vRow(v, i);
      root().querySelector('[data-vprofit]').innerHTML = profitLine(v.cost, v.price, true);
      // The "in store since" line appears with the first opening quantity.
      if (t.dataset.v === 'openingQty' && !!root().querySelector('.pe-since') !== P.variants.some((x) => x.isNew && val(x.openingQty))) {
        paintEditor(); focusV(i, 'openingQty');
      }
    }
    touch();
  }

  /* ---- save ---- */
  const bad = (msg) => { showToast(msg); return null; };
  const moneyOk = (...xs) => xs.every((x) => val(x) != null && val(x) >= 0);

  // The fields a plain product and every variant of a family are written with.
  const sharedFields = (was) => ({
    folders: P.cats, folder: P.cats[0] || '', supplierId: P.main, altSupplierIds: P.sups.filter((s) => s !== P.main),
    modifierIds: P.mods, unit: P.unit || 'pc', soldBy: soldByFor(P.unit, was && was.soldBy),
    reorderPoint: val(P.low) || 0, trackStock: P.track, hidden: P.hidden, sellOutOfStock: !!P.sellOut,
    weight: String(P.weight || '').trim(), size: String(P.size || '').trim(), length: String(P.length || '').trim(),
  });
  const opening = (productId, q) => (P.track && val(q) > 0
    ? makeMovement({ productId, qty: val(q), reason: 'count', note: 'Opening stock', happenedOn: P.since, ...who() }) : null);

  function save() {
    if (!P.name.trim()) return bad('Name the item');
    if (!moneyOk(P.cost, P.price)) return bad('Cost and price need a number, 0 or more');
    if (P.isNew && P.openingQty !== '' && !(val(P.openingQty) >= 0)) return bad('Opening stock needs a number, 0 or more');
    const existing = P.isNew ? null : state.products.find((x) => x.id === P.id);
    if (!P.isNew && !existing) return bad('That item no longer exists');

    const cost = val(P.cost), price = val(P.price);
    const marginMode = (existing && existing.marginMode) || 'percent';
    const next = normalizeProduct({
      ...(existing || {}), ...sharedFields(existing),
      id: existing ? existing.id : newId('p'),
      name: P.name.trim(), description: String(P.desc || '').trim(), imageUrl: P.photo,
      sku: String(P.sku || '').trim(), barcode: String(P.barcode || '').trim(),
      cost, price, marginMode, marginValue: marginFromPrice(cost, price, marginMode),
      stock: existing ? existing.stock : 0,
      updatedAt: new Date().toISOString(),
    });
    // A new product may open with a quantity, but it still arrives as a movement.
    const mv = P.isNew ? opening(next.id, P.openingQty) : null;
    if (mv) applyMovement(next, mv);

    const list = state.products.slice();
    const at = list.findIndex((x) => x.id === next.id);
    if (at >= 0) list[at] = next; else list.push(next);
    state.products = list;
    saveProducts();
    appendMovements(mv ? [mv] : []);
    done();
    return next;
  }

  /* A family is one form and several product rows. A variant IS a product (bo-model.js); the
     group carries the shared name, picture, description and first category. */
  function saveGroup() {
    if (!P.name.trim()) return bad('Name the item');
    for (let i = 0; i < P.variants.length; i += 1) {
      const v = P.variants[i];
      const fail = !v.short.trim() ? `Variant ${i + 1} needs a name`
        : !moneyOk(v.cost, v.price) ? `${v.short}: cost and price need a number, 0 or more` : '';
      if (fail) { openV = i; paintEditor(); return bad(fail); }
    }
    const stamp = new Date().toISOString();
    const groups = loadGroups();
    const gi = groups.findIndex((x) => x.id === P.gid);
    const g = { ...GROUP_DEFAULTS, ...(groups[gi] || { id: P.gid }),
      name: P.name.trim(), folder: P.cats[0] || '', imageUrl: P.photo, description: String(P.desc || '').trim(), updatedAt: stamp };
    if (gi >= 0) groups[gi] = g; else groups.push(g);
    saveGroups(groups);

    const list = state.products.slice();
    const byId = new Map(list.map((x, i) => [x.id, i]));
    const keep = new Set(P.variants.map((v) => v.id).filter(Boolean));
    // A variant taken off the list is archived, never deleted - an old receipt has to stay resolvable.
    list.forEach((x, i) => {
      if (x.groupId === P.gid && !x.archived && !keep.has(x.id)) list[i] = { ...x, archived: true, updatedAt: stamp };
    });
    const movements = [];
    P.variants.forEach((v) => {
      const existing = v.id && byId.has(v.id) ? list[byId.get(v.id)] : null;
      const cost = val(v.cost), price = val(v.price);
      const marginMode = (existing && existing.marginMode) || 'percent';
      const next = normalizeProduct({
        ...(existing || {}), ...sharedFields(existing),
        id: existing ? existing.id : newId('p'), groupId: P.gid,
        archived: existing ? !!existing.archived : !!P.archived,
        name: vName(v), sku: String(v.sku || '').trim(), barcode: String(v.barcode || '').trim(),
        imageUrl: '',   // one photo per product, on the group (owner, 2026-10-01)
        cost, price, marginMode, marginValue: marginFromPrice(cost, price, marginMode),
        stock: existing ? existing.stock : 0, updatedAt: stamp,
      });
      const mv = existing ? null : opening(next.id, v.openingQty);
      if (mv) { applyMovement(next, mv); movements.push(mv); }
      if (existing) list[byId.get(v.id)] = next; else list.push(next);
    });
    state.products = list;
    saveProducts();
    appendMovements(movements);
    done();
    return g;
  }

  function done() {
    P = null;
    refreshSharedState();
    showToast('Saved');
    Router.go(VIEW, '');   // Save is done with this product - back to the list
  }

  // Archive a product, or every variant of a family. Restoring asks nothing.
  function archive() {
    const ids = new Set(P.family ? P.variants.map((v) => v.id).filter(Boolean) : [P.id]);
    const to = !P.archived;
    // ponytail: native confirm(), same as cancelling a PO in bo-suppliers.js. Archiving is
    // reversible from this very button, so it needs the pause, not a designed dialog.
    if (to && !confirm(`Archive "${P.name}"?

It stops showing in the POS. Old orders still resolve, and you can restore it from this page.`)) return;
    const stamp = new Date().toISOString();
    state.products = state.products.map((x) => (ids.has(x.id) ? { ...x, archived: to, updatedAt: stamp } : x));
    saveProducts();
    P.archived = to;
    refreshSharedState();
    paintEditor();
    showToast(to ? 'Archived - old orders still resolve' : 'Restored');
  }

  /* ================= render + events ================= */

  window.renderProducts = function () {
    const r = root();
    if (state.detailId && !onItemPage()) { renderEditor(editId()); return; }
    P = null;
    if (onItemPage()) { window.renderProductPage(state.detailId); return; }
    // The search box is inside the view, so the shell is rebuilt only when it is
    // missing or the Catalog | Stock view changed - re-rendering it on every keystroke
    // would steal focus.
    const stock = isStock();
    const list = r.querySelector('.pd-list');
    if (!list || list.dataset.pdView !== (stock ? 'stock' : 'catalog')) r.innerHTML = listShell(stock);
    syncControls();
    applyCols();
    paintImport();
    paintTable();
  };

  const rebuild = () => { root().innerHTML = ''; refreshSharedState(); renderCurrentView(); };
  const mine = (el) => !!el && !!root() && root().contains(el);

  document.addEventListener('click', (e) => {
    const r = root();
    if (!r || r.hidden || !e.target.closest || onItemPage()) return;

    const pe = e.target.closest('[data-pe], [data-pe-pick]');
    if (mine(pe)) { peClick(pe); return; }

    const tileEl = e.target.closest('.pd-kpi');
    if (mine(tileEl)) {
      const key = tileEl.dataset.level;
      const on = new Set(levelsOf(params()));
      if (!key) on.clear(); else if (on.has(key)) on.delete(key); else on.add(key);
      Router.setParams({ level: [...on].join(','), low: '', page: '' });
      return;
    }

    const rowEl = e.target.closest('.pd-row');
    // Buttons in a row (Edit, Adjust) are their own click, not the row's.
    if (mine(rowEl) && !e.target.closest('a, button, .pd-sel')) { Router.go(VIEW, rowEl.dataset.id); return; }

    const btn = e.target.closest('[data-act]');
    if (!mine(btn)) return;
    const act = btn.dataset.act;
    if (act === 'back') Router.go(VIEW, '');
    else if (act === 'new') Router.go(VIEW, 'new');
    else if (act === 'edit') Router.go(VIEW, btn.closest('.pd-row').dataset.id + '/edit');
    else if (act === 'ms-clear') Router.setParams({ [btn.dataset.key]: '', low: '', page: '' });
    else if (act === 'export') exportCsv();
    else if (act === 'bulk-clear') { picked.clear(); paintTable(); }
    else if (act === 'bulk-export') {
      const list = pickedProducts().map(normalizeProduct);
      downloadCsv('items.csv', [PRODUCT_COLUMNS.map((c) => c.head)].concat(list.map(productToCsvRow)));
      showToast(`Exported ${SalesMath.plural(list.length, 'item')}`);
    } else if (act === 'bulk-archive') {
      const ids = new Set(pickedProducts().filter((x) => !x.archived).map((x) => x.id));
      if (!ids.size) { showToast('Those are already archived'); return; }
      if (!confirm(`Archive ${SalesMath.plural(ids.size, 'item')}?

They stop showing in the POS. Old orders still resolve, and you can restore each one from its page.`)) return;
      // Never delete: an old receipt has to stay resolvable.
      const stamp = new Date().toISOString();
      state.products = state.products.map((x) => (ids.has(x.id) ? { ...x, archived: true, updatedAt: stamp } : x));
      saveProducts();
      picked.clear();
      refreshSharedState();
      renderCurrentView();
      showToast(`Archived ${ids.size} - old orders still resolve`);
    }
    else if (act === 'import') r.querySelector('#pdFile').click();
    else if (act === 'import-cancel') { pending = null; paintImport(); }
    else if (act === 'import-apply') {
      const plan = pending;
      pending = null;
      commitImport(plan);
      rebuild();
      const n = plan.create.length + plan.update.length;
      showToast(`Imported ${SalesMath.plural(n, 'item')}`);
    }
  });

  // The KPI tiles are role=button divs (kpi() owns their markup), so give them the keyboard.
  document.addEventListener('keydown', (e) => {
    const t = e.target.closest && e.target.closest('.pd-kpi');
    if (mine(t) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); }
    if (e.key === 'Enter' && e.target.matches && e.target.matches('.pe-ms')) {
      e.preventDefault();
      const first = e.target.closest('.pe-menu').querySelector('[data-pe-pick]');
      if (first) first.click();
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !mine(el) || onItemPage()) return;
    if (P && el.closest('.pe')) peInput(el);
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (!mine(el) || onItemPage()) return;
    if (el.dataset.multi) {
      const picked = [...root().querySelectorAll(`input[data-multi="${el.dataset.multi}"]:checked`)].map((i) => i.value);
      Router.setParams({ [el.dataset.multi]: picked.join(','), low: '', page: '' });
      return;
    }
    if (el.dataset.filter) {
      Router.setParams({ [el.dataset.filter]: el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value, page: '' });
      return;
    }
    if (el.dataset.pick !== undefined) {
      if (el.checked) picked.add(el.dataset.pick); else picked.delete(el.dataset.pick);
      paintPicked();
      return;
    }
    if (el.dataset.pickAll !== undefined) {
      root().querySelectorAll('[data-pick]').forEach((b) => {
        b.checked = el.checked;
        if (el.checked) picked.add(b.dataset.pick); else picked.delete(b.dataset.pick);
      });
      paintPicked();
      return;
    }
    if (el.dataset.colToggle) {
      const on = loadCols();
      if (el.checked) on.add(el.dataset.colToggle); else on.delete(el.dataset.colToggle);
      saveCols(on);
      applyCols();                 // CSS hides the cells; no need to rebuild the rows
      return;
    }
    if (el.dataset.pics !== undefined) {
      state.settings = { ...state.settings, productPictures: el.checked };
      HWPOS_STORE.settings.set({ productPictures: el.checked });
      applyCols();
      return;
    }
    if (el.dataset.peImg !== undefined) {
      const img = el.files && el.files[0];
      el.value = '';
      if (!img || !P) return;
      try {
        P.photo = await shrink(img);
        touch();
        paintEditor();
      } catch (err) {
        showToast('Could not read that image');
      }
      return;
    }
    if (el.id === 'pdFile') {
      const file = el.files && el.files[0];
      el.value = '';
      if (!file) return;
      try {
        pending = { ...planImport(parseCsv(await file.text()), state.products, state.folders, loadSuppliers()), file: file.name };
        paintImport();
      } catch (err) {
        showToast((err && err.message) || 'Could not read that CSV');
      }
    }
  });

  if (typeof module !== 'undefined') module.exports = { planImport };
})();
