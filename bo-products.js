/* Back office - Products. Renders the whole #view section; see CONTRACT.
   Products creates items and owns name/pricing/margin/variants/barcode.
   Inventory moves stock - the only stock this page writes is an opening count,
   and even that goes through makeMovement/appendMovements. */
(function () {
  const VIEW = 'products';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  /* ---------- shared reads ---------- */
  const params = () => Router.route().params;
  const loadGroups = () => readJsonStorage(STORAGE_GROUPS, null)
    || (typeof SEED_GROUPS !== 'undefined' ? SEED_GROUPS.map((g) => ({ ...g })) : []);
  const putGroups = (list) => storageSet(STORAGE_GROUPS, JSON.stringify(list));
  // ponytail: backoffice.js ships loadFolders but no saveFolders. Same storageSet seam,
  // not a second store - move it up to the shell when another page needs it too.

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
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

  // attr is data-f on a product or group, data-v on a variant row - collect() and the
  // variant reader both pick the hidden input up unchanged.
  const imgPick = (value, attr) => {
    const u = safeUrl(value);
    return `<span class="pd-imgpick">${thumb(u)}`
      + `<input type="hidden" ${attr}="imageUrl" value="${escapeHtml(u)}">`
      + `<label class="link-btn">${u ? 'Change' : 'Upload'}<input type="file" accept="image/*" data-img="1" hidden></label>`
      + `<button type="button" class="link-btn pd-imgclear" data-act="img-clear"${u ? '' : ' hidden'}>Remove</button>`
      + `</span>`;
  };
  function setImage(wrap, url) {
    wrap.querySelector('input[type=hidden]').value = url;
    wrap.querySelector('.pd-thumb').style.backgroundImage = url ? `url('${url}')` : '';
    wrap.querySelector('label.link-btn').firstChild.nodeValue = url ? 'Change' : 'Upload';
    wrap.querySelector('.pd-imgclear').hidden = !url;
  }

  const opt = (v, label, on) => `<option value="${escapeHtml(v)}"${v === on ? ' selected' : ''}>${escapeHtml(label)}</option>`;

  // Type to filter, or type a name that does not exist yet and save creates it.
  // ponytail: native <datalist>, not a custom combobox - the browser already does
  // the filtering, the keyboard and the phone keyboard.
  const combo = (name, value, id, names, placeholder) =>
    `<input class="text-input" data-f="${name}" list="${id}" value="${escapeHtml(value || '')}"`
    + ` placeholder="${escapeHtml(placeholder)}" autocomplete="off">`
    + `<datalist id="${id}">${names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>`;
  const nameOf = (list, id) => (list.find((x) => x.id === id) || {}).name || '';

  /* ---------- Which columns to show ----------
     A display preference, not a filter: it stays with the person, not with the link,
     so it lives in storage rather than the URL. Status is off by default — Inventory
     is where stock levels are answered. */
  const STORAGE_COLS = 'hwpos.bo.pdCols';
  const COLUMNS = [
    ['img', 'Image'], ['sku', 'SKU'], ['cat', 'Category'], ['supplier', 'Supplier'],
    ['cost', 'Cost'], ['price', 'Price'], ['margin', 'Margin'], ['stock', 'Stock'],
    ['status', 'Status'],
  ];
  const DEFAULT_COLS = COLUMNS.map(([k]) => k).filter((k) => k !== 'status');

  function loadCols() {
    const raw = readJsonStorage(STORAGE_COLS, null);
    return new Set(Array.isArray(raw) ? raw.filter((k) => COLUMNS.some(([c]) => c === k)) : DEFAULT_COLS);
  }
  const saveCols = (set) => storageSet(STORAGE_COLS, JSON.stringify(COLUMNS.map(([k]) => k).filter((k) => set.has(k))));

  // One class per hidden column on the table; the cells carry data-col and CSS does the rest.
  function applyCols() {
    const on = loadCols();
    const t = root().querySelector('#pdTable');
    if (t) COLUMNS.forEach(([k]) => t.classList.toggle('hide-' + k, !on.has(k)));
  }

  function statusPill(p) {
    if (p.archived) return '<span class="status-pill muted">Archived</span>';
    if (!(num(p.stock) > 0)) return '<span class="status-pill danger">Out of stock</span>';
    if (isLow(p)) return '<span class="status-pill warn">Low</span>';
    return '<span class="status-pill ok">In stock</span>';
  }

  /* ================= LIST ================= */

  function listShell() {
    const folders = state.folders.filter((f) => f.id !== 'all');
    return `
      <header class="view-head">
        <div class="view-title-wrap"><h1>Products</h1></div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="import">Import CSV</button>
          <button class="secondary-btn small" data-act="export">Export CSV</button>
          <button class="primary-btn small" data-act="new">Add product</button>
          <input type="file" id="pdFile" accept=".csv,text/csv" hidden>
        </div>
      </header>
      <div class="pd-filters">
        <input class="search-input small q-input" placeholder="Search name, SKU, barcode..." autocomplete="off"
               value="${escapeHtml(state.invQuery)}">
        <select class="bo-select" data-filter="cat">
          ${opt('', 'All categories')}${folders.map((f) => opt(f.id, f.name)).join('')}
        </select>
        <select class="bo-select" data-filter="supplier">
          ${opt('', 'All suppliers')}${loadSuppliers().map((s) => opt(s.id, s.name)).join('')}${opt('none', 'No supplier')}
        </select>
        <label class="bo-check"><input type="checkbox" data-filter="low"> Low stock only</label>
        <label class="bo-check"><input type="checkbox" data-filter="archived"> Show archived</label>
        <details class="pd-cols">
          <summary class="secondary-btn small">Columns</summary>
          <div class="pd-cols-menu">
            ${COLUMNS.map(([k, label]) =>
              `<label class="bo-check"><input type="checkbox" data-col-toggle="${k}"> ${label}</label>`).join('')}
          </div>
        </details>
      </div>
      <div id="pdImport"></div>
      <section class="bo-card pd-list">
        <div class="bo-card-head">
          <span class="bo-card-label">All products</span>
          <span class="bo-card-sub" id="pdShown"></span>
        </div>
        <div class="bo-card-inset flush">
          <div class="table-wrap">
            <table class="data-table" id="pdTable">
              <thead><tr>
                <th class="pd-img-col" data-col="img"></th><th>Name</th>
                <th data-col="sku">SKU</th><th data-col="cat">Category</th><th data-col="supplier">Supplier</th>
                <th class="num" data-col="cost">Cost</th><th class="num" data-col="price">Price</th>
                <th class="num" data-col="margin">Margin</th>
                <th class="num" data-col="stock">Stock</th><th data-col="status">Status</th>
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
    r.querySelector('[data-filter="low"]').checked = p.low === '1';
    r.querySelector('[data-filter="archived"]').checked = p.archived === '1';
    const on = loadCols();
    r.querySelectorAll('[data-col-toggle]').forEach((b) => { b.checked = on.has(b.dataset.colToggle); });
  }

  // The URL is the filter. One predicate, shared by the table and by Export.
  function filterProducts() {
    const p = params();
    const q = state.invQuery.trim().toLowerCase();
    // Searching "pvc elbow" has to find the variants, so the group name is part
    // of the haystack. Built once, and only when there is something to search.
    const gname = q ? new Map(loadGroups().map((g) => [g.id, g.name])) : null;
    return state.products.map(normalizeProduct).filter((item) => {
      if (item.archived && p.archived !== '1') return false;
      if (p.cat && item.folder !== p.cat) return false;
      if (p.supplier && (p.supplier === 'none'
        ? item.supplierId : !supplierIdsOf(item).includes(p.supplier))) return false;
      if (p.low === '1' && !isLow(item)) return false;
      if (!q) return true;
      const hay = `${item.name} ${item.sku} ${item.barcode} `
        + `${item.aliases.join(' ')} ${gname.get(item.groupId) || ''}`;
      return hay.toLowerCase().includes(q);
    });
  }

  // Min-max of a column, printed as one value when the family agrees.
  const rangeText = (vals, fmt) =>
    (Math.min(...vals) === Math.max(...vals)
      ? fmt(vals[0])
      : `${fmt(Math.min(...vals))} &ndash; ${fmt(Math.max(...vals))}`);

  function paintTable() {
    const p = params();
    const groupMap = new Map(loadGroups().map((g) => [g.id, g]));
    const supplierMap = new Map(loadSuppliers().map((s) => [s.id, s.name]));

    // A family is ONE row. Its variants are inside the product, not loose in this
    // list - "Common Wire Nails" reads as one thing until you open it.
    const rows = [];
    const fams = new Map();
    filterProducts().forEach((item) => {
      const g = item.groupId ? groupMap.get(item.groupId) : null;
      if (!g) { rows.push({ key: item.name, html: rowHtml(item, supplierMap) }); return; }
      if (!fams.has(g.id)) fams.set(g.id, []);
      fams.get(g.id).push(item);
    });
    fams.forEach((members, gid) => {
      const g = groupMap.get(gid);
      rows.push({ key: g.name, html: groupRowHtml(g, members, supplierMap) });
    });
    rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const filtered = state.invQuery || p.cat || p.supplier || p.low;
    const pg = paginate(rows, p.page);
    root().querySelector('#pdTable tbody').innerHTML = pg.rows.map((r) => r.html).join('')
      || `<tr><td colspan="10" class="bo-empty">${filtered ? 'No products match these filters.' : 'No products yet. Add one to get started.'}</td></tr>`;
    root().querySelector('#pdPager').innerHTML = pagerHtml(pg);
    root().querySelector('#pdShown').textContent = `${rows.length} shown`;
  }

  function rowHtml(p, supplierMap) {
    const markup = marginSummary(p.cost, p.price).markup;
    return `
      <tr class="pd-row${p.archived ? ' pd-arch' : ''}" data-id="${escapeHtml(p.id)}">
        <td class="pd-img-col" data-col="img">${thumb(p.imageUrl)}</td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td class="mono" data-col="sku">${escapeHtml(p.sku || '-')}</td>
        <td data-col="cat">${escapeHtml(folderName(p.folder))}</td>
        <td data-col="supplier">${escapeHtml(supplierMap.get(p.supplierId) || '-')}${
          p.altSupplierIds.length ? `<span class="muted"> +${p.altSupplierIds.length}</span>` : ''}</td>
        <td class="num" data-col="cost">${peso(p.cost)}</td>
        <td class="num" data-col="price"><strong>${peso(p.price)}</strong></td>
        <td class="num" data-col="margin">${markup.toFixed(1)}%</td>
        <td class="num" data-col="stock">${p.stock} ${escapeHtml(p.unit)}</td>
        <td data-col="status">${statusPill(p)}</td>
      </tr>`;
  }

  // The collapsed family: aggregates, and the picture is the group's unless every
  // variant brought its own.
  function groupRowHtml(g, members, supplierMap) {
    const stock = round2(members.reduce((n, m) => n + num(m.stock), 0));
    const sups = new Set(members.map((m) => m.supplierId));
    const alts = new Set(members.flatMap((m) => m.altSupplierIds));
    const status = stock <= 0
      ? '<span class="status-pill danger">Out of stock</span>'
      : members.some(isLow)
        ? '<span class="status-pill warn">Low</span>'
        : '<span class="status-pill ok">In stock</span>';
    return `
      <tr class="pd-row${members.every((m) => m.archived) ? ' pd-arch' : ''}" data-id="${escapeHtml(g.id)}">
        <td class="pd-img-col" data-col="img">${thumb(imageFor(members[0], [g]))}</td>
        <td><strong>${escapeHtml(g.name)}</strong>
            <span class="pd-vcount">${members.length} variants</span></td>
        <td class="mono" data-col="sku">&mdash;</td>
        <td data-col="cat">${escapeHtml(folderName(g.folder || members[0].folder))}</td>
        <td data-col="supplier">${sups.size > 1 ? 'Mixed' : escapeHtml(supplierMap.get(members[0].supplierId) || '-')}${
          alts.size ? `<span class="muted"> +${alts.size}</span>` : ''}</td>
        <td class="num" data-col="cost">${rangeText(members.map((m) => m.cost), peso)}</td>
        <td class="num" data-col="price"><strong>${rangeText(members.map((m) => m.price), peso)}</strong></td>
        <td class="num" data-col="margin">${rangeText(members.map((m) => marginSummary(m.cost, m.price).markup), (v) => v.toFixed(1) + '%')}</td>
        <td class="num" data-col="stock">${stock} ${escapeHtml(members[0].unit)}</td>
        <td data-col="status">${status}</td>
      </tr>`;
  }

  /* ================= CSV ================= */

  let pending = null;   // the parsed import, waiting for the user to confirm

  function exportCsv() {
    const list = filterProducts();
    downloadCsv('products.csv', [PRODUCT_COLUMNS.map((c) => c.head)].concat(list.map(productToCsvRow)));
    showToast(`Exported ${list.length} product${list.length === 1 ? '' : 's'}`);
  }

  // Pure: what an import WOULD do. Matches by SKU, then barcode, then name, and names
  // the categories it would have to create. Exported for scripts/products-check.mjs.
  function planImport(rows, products, folders) {
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
    const out = { create: [], update: [], failed: [], folders: [] };

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
      // The category column carries an id on a file we exported and a name on one we
      // did not. Accept either, and create what neither knows about.
      if (product.folder) {
        const key = String(product.folder).toLowerCase();
        const hit = byId.get(product.folder) || byFolderName.get(key) || made.get(key);
        if (hit) product.folder = hit.id;
        else {
          const base = slug(product.folder);
          let id = base ? 'cat_' + base : 'cat_' + (out.folders.length + 1);
          if (byId.has(id)) id += '_' + (out.folders.length + 1);
          const f = { id, name: product.folder, builtin: false };
          made.set(key, f);
          out.folders.push(f);
          product.folder = id;
        }
      }
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
            ${pending.folders.length ? `<span><strong>${pending.folders.length}</strong> new categor${pending.folders.length === 1 ? 'y' : 'ies'}</span>` : ''}
          </div>
          <p class="pd-hint">Stock is applied only to new products, as an opening count. Products that already exist keep the stock Inventory has for them.</p>
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
          happenedOn });
        applyMovement(next, mv);
        movements.push(mv);
      }
      list.push(next);
    });
    state.products = list;
    saveProducts();
    appendMovements(movements);
  }

  /* ================= EDITOR ================= */

  const row = (label, control, hint, id) => `
    <div class="setting-row">
      <label${id ? ` id="${id}"` : ''}>${escapeHtml(label)}${hint ? `<div class="pd-hint">${escapeHtml(hint)}</div>` : ''}</label>
      <div class="pd-control">${control}</div>
    </div>`;
  const field = (name, value, attrs = '') =>
    `<input class="text-input" data-f="${name}" value="${escapeHtml(value == null ? '' : value)}" ${attrs}>`
    + `<span class="pd-err" data-err="${name}"></span>`;
  // Who else stocks it. The primary is not repeated - it is the row above.
  const altSupCtl = (suppliers, picked, primary) => {
    const on = new Set(picked || []);
    const opts = suppliers.filter((s) => s.id !== primary).map((s) =>
      `<option value="${escapeHtml(s.id)}"${on.has(s.id) ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
    return opts
      ? `<select class="bo-select pd-alt-sup" data-f="altSuppliers" multiple size="4">${opts}</select>`
      : '<span class="pd-hint">Nobody else on file yet.</span>';
  };
  const segCtl = (name, value, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) =>
    `<button type="button" class="seg-btn${v === value ? ' active' : ''}" data-seg-val="${escapeHtml(v)}">${escapeHtml(l)}</button>`).join('')}</div>`;
  const card = (label, body, sub) => `
    <section class="bo-card">
      <div class="bo-card-head"><span class="bo-card-label">${escapeHtml(label)}</span>${sub ? `<span class="bo-card-sub">${escapeHtml(sub)}</span>` : ''}</div>
      <div class="bo-card-inset">${body}</div>
    </section>`;

  const MARGIN_LABEL = { percent: 'Markup on cost (%)', flat: 'Profit per unit' };

  // "Add variant" clicked on a plain product: open its new family with a blank row
  // waiting. Transient intent, not a filter - it has no business on the URL.
  let addOnRender = false;

  function renderEditor(id) {
    const groups = loadGroups();
    const g = groups.find((x) => x.id === id);
    if (g) { renderGroupEditor(g); return; }
    const products = state.products.map(normalizeProduct);
    const suppliers = loadSuppliers();
    const isNew = id === 'new';
    const p = isNew ? normalizeProduct({ folder: params().cat || '' }) : products.find((x) => x.id === id);
    if (!p) {
      root().innerHTML = `<header class="view-head"><div class="view-title-wrap"><h1>Product not found</h1>
        <span class="muted">It may have been removed.</span></div>
        <div class="view-actions"><button class="secondary-btn small" data-act="back">Back to products</button></div></header>`;
      return;
    }
    const folders = state.folders.filter((f) => f.id !== 'all');
    const money = ' type="number" step="0.01" min="0" inputmode="decimal"';

    root().innerHTML = `
      <header class="view-head pd-editor-head">
        <div class="view-title-wrap">
          <h1>${escapeHtml(p.name || 'New product')}</h1>
          <span class="muted">${escapeHtml(p.sku || (isNew ? 'Draft' : 'No SKU'))}</span>
        </div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="back">Products</button>
        </div>
      </header>
      <div class="pd-editor">
       <div class="dash-stack pd-main">
        ${card('Details', [
          row('Name', field('name', p.name, 'placeholder="Portland Cement 40kg"')),
          row('Brand', field('brand', p.brand)),
          row('Image', imgPick(p.imageUrl, 'data-f'),
            'Each variant can carry its own; this is the one they fall back to'),
        ].join(''))}

        ${card('Sold as', [
          row('How it is sold', segCtl('soldBy', p.soldBy, [['each', 'Each'], ['measure', 'By measure']]),
            'Each = pc / box / bag, whole numbers. By measure = m / kg / L, decimals allowed.'),
          row('Unit', field('unit', p.unit, 'placeholder="pc"')),
        ].join(''))}

        ${card('Pricing', [
          row('Cost', field('cost', p.cost, money), 'What we pay per unit'),
          row('Margin', segCtl('marginMode', p.marginMode, [['flat', 'Flat'], ['percent', 'Percent']])),
          row(MARGIN_LABEL[p.marginMode], field('marginValue', p.marginValue, ' type="number" step="0.01" inputmode="decimal"'), '', 'pdMarginLabel'),
          row('Price', field('price', p.price, money),
            'The authoritative number - margin recomputes it when cost changes'),
          `<div class="pd-margin" id="pdMargin">${marginLine(marginSummary(p.cost, p.price))}</div>`,
          isNew ? '' : `<a class="link-btn" href="${escapeHtml(Router.href('inventory', '', { tab: 'prices', q: p.name }))}">See price history</a>`,
        ].join(''))}

        ${card('Inventory', [
          row('On hand', `<input class="text-input" value="${escapeHtml(p.stock + ' ' + p.unit)}" disabled>`
            + `<a class="link-btn" href="${escapeHtml(Router.href('inventory', '', {}))}">Move stock in Inventory</a>`,
            'Products creates items; Inventory moves stock.'),
          isNew ? row('Opening quantity',
            field('openingQty', '', ' type="number" step="0.01" min="0" inputmode="decimal" placeholder="0"'),
            'Saved as a stock count movement, not a bare number') : '',
          isNew ? row('In store since',
            `<input class="bo-date" type="date" data-f="openingSince" value="${isoDate(Date.now())}" max="${isoDate(Date.now())}">`,
            'Already on the shelf? Backdate it instead of counting it in today.') : '',
          row('Danger level', field('reorderPoint', p.reorderPoint, ' type="number" step="1" min="0" inputmode="numeric"'),
            'At or below this it lands on the low-stock list'),
          row('Sell when out of stock', `<input type="checkbox" data-f="sellOutOfStock"${p.sellOutOfStock ? ' checked' : ''}>`),
          row('SKU', field('sku', p.sku)),
          row('Barcode', field('barcode', p.barcode)),
        ].join(''))}

        ${card('Variants', `
          <div class="bo-empty">Sold in sizes or colours? Add a variant. Each one is its own
            item with its own SKU, barcode, price, stock and picture.</div>
          <div class="pd-actions"><button class="secondary-btn small" data-act="add-variant">Add variant</button></div>`)}

       </div>

       <div class="dash-stack pd-rail">
        ${card('Organization', [
          row('Category', combo('folder', nameOf(folders, p.folder), 'pdFolders',
            folders.map((f) => f.name), 'Uncategorized'),
            'Pick one, or type a new name and it is created on save'),
          row('Supplier', combo('supplier', nameOf(suppliers, p.supplierId), 'pdSuppliers',
            suppliers.map((x) => x.name), 'No supplier'),
            'Pick one, or type a new name and it is created on save'),
          row('Also stocked by', altSupCtl(suppliers, p.altSupplierIds, p.supplierId),
            'Hold Ctrl to pick more than one. Purchase orders still use the supplier above.'),
        ].join(''))}

        ${card('Specs', [
          row('Weight', field('weight', p.weight, 'placeholder="2.5 kg"')),
          row('Size', field('size', p.size, 'placeholder="3/4 in"')),
          row('Length', field('length', p.length, 'placeholder="8 ft"')),
        ].join(''), 'Free text - nothing computes on these')}
       </div>

        ${formBar(isNew ? '' :
          `<button class="link-btn pd-archive" data-act="archive">${p.archived ? 'Restore' : 'Archive'}</button>`)}
      </div>`;
  }

  /* You fill a form top to bottom; Save belongs where you finish, not where you started.
     Archive sits at the far left of the same bar - the destructive verb never shares an
     edge with the one people aim for. */
  const formBar = (left) => `<div class="pd-formbar">${left}
    <button class="primary-btn" data-act="save">Save</button></div>`;

  /* ---------- The family editor: shared fields on top, variants as sub-items ----------
     A variant IS a product (see bo-model.js), so this screen edits several product
     rows at once. Everything above the table is shared and written to every member;
     the table owns what makes a variant its own item - name, SKU, barcode, price,
     picture and stock. */

  const MONEY_ATTR = ' type="number" step="0.01" min="0" inputmode="decimal"';
  const vMarkup = (cost, price) => marginSummary(num(cost), num(price)).markup.toFixed(1) + '%';

  function variantRowHtml(v) {
    const isNew = !v.id;
    const cell = (name, attrs = '') =>
      `<input class="text-input" data-v="${name}" value="${escapeHtml(v[name] == null ? '' : v[name])}"${attrs}>`;
    return `
      <tr class="pd-vrow" data-vid="${escapeHtml(v.id || '')}">
        <td class="pd-vname">
          ${cell('name', ' placeholder="e.g. Red, 2 inch"')}
          <div class="pd-vimg">${imgPick(v.imageUrl, 'data-v')}</div>
        </td>
        <td class="pd-vsku">${cell('sku')}</td>
        <td class="pd-vsku">${cell('barcode')}</td>
        <td class="num pd-vnum">${cell('cost', MONEY_ATTR)}</td>
        <td class="num pd-vnum">${cell('price', MONEY_ATTR)}</td>
        <td class="num pd-vmargin">${vMarkup(v.cost, v.price)}</td>
        <td class="num pd-vnum">${isNew
          ? `<input class="text-input" data-v="openingQty" type="number" step="0.01" min="0" placeholder="0">`
          : `<span class="pd-vstock">${v.stock} ${escapeHtml(v.unit)}</span>`}</td>
        <td class="pd-vdel"><button type="button" class="link-btn" data-act="del-variant" title="Remove variant">Remove</button></td>
      </tr>`;
  }

  function renderGroupEditor(g) {
    const members = state.products.map(normalizeProduct)
      .filter((x) => x.groupId === g.id && !x.archived);
    // Shared values come off the first variant - they are written back to all of them.
    const base = members[0] || normalizeProduct({ folder: g.folder });
    const folders = state.folders.filter((f) => f.id !== 'all');
    const suppliers = loadSuppliers();
    const n = members.length + (addOnRender ? 1 : 0);

    root().innerHTML = `
      <header class="view-head pd-editor-head">
        <div class="view-title-wrap">
          <h1>${escapeHtml(g.name)}</h1>
          <span class="muted">${n} variant${n === 1 ? '' : 's'}</span>
        </div>
        <div class="view-actions">
          <button class="secondary-btn small" data-act="back">Products</button>
        </div>
      </header>
      <div class="dash-stack">
        ${card('Details', [
          row('Name', field('name', g.name, 'placeholder="Boysen Paint"'),
            'The family name. Variants are named in the table below.'),
          row('Category', combo('folder', nameOf(folders, g.folder || base.folder), 'pdFolders',
            folders.map((f) => f.name), 'Uncategorized'),
            'Pick one, or type a new name and it is created on save'),
          row('Supplier', combo('supplier', nameOf(suppliers, base.supplierId), 'pdSuppliers',
            suppliers.map((x) => x.name), 'No supplier'),
            'Pick one, or type a new name and it is created on save'),
          row('Also stocked by', altSupCtl(suppliers, base.altSupplierIds, base.supplierId),
            'Hold Ctrl to pick more than one. Purchase orders still use the supplier above.'),
          row('Brand', field('brand', base.brand)),
          row('Image', imgPick(g.imageUrl, 'data-f'),
            'The fallback picture, for variants that have none of their own'),
        ].join(''), 'Shared by every variant')}

        ${card('Variants', `
          <div class="table-wrap">
            <table class="data-table pd-vtable" id="pdVariants">
              <thead><tr>
                <th>Variant</th><th>SKU</th><th>Barcode</th>
                <th class="num">Cost</th><th class="num">Price</th><th class="num">Margin</th>
                <th class="num">Stock</th><th></th>
              </tr></thead>
              <tbody>${members.map(variantRowHtml).join('')}${addOnRender ? variantRowHtml(normalizeProduct({})) : ''}</tbody>
            </table>
          </div>
          <p class="pd-hint">Stock on a variant that already exists is moved in Inventory. A new
            variant may open with a quantity - it is saved as a stock count movement.</p>
          <label class="adj-field pd-vsince"><span>New variants in store since</span>
            <input class="bo-date" type="date" data-f="openingSince" value="${isoDate(Date.now())}" max="${isoDate(Date.now())}"></label>
          <div class="pd-actions"><button class="secondary-btn small" data-act="add-variant">Add variant</button></div>`,
          `${n} in this family`)}

        ${card('Sold as', [
          row('How it is sold', segCtl('soldBy', base.soldBy, [['each', 'Each'], ['measure', 'By measure']]),
            'Each = pc / box / bag, whole numbers. By measure = m / kg / L, decimals allowed.'),
          row('Unit', field('unit', base.unit, 'placeholder="pc"')),
          row('Danger level', field('reorderPoint', base.reorderPoint, ' type="number" step="1" min="0" inputmode="numeric"'),
            'At or below this a variant lands on the low-stock list'),
          row('Sell when out of stock', `<input type="checkbox" data-f="sellOutOfStock"${base.sellOutOfStock ? ' checked' : ''}>`),
        ].join(''), 'Shared by every variant')}

        ${card('Specs', [
          row('Weight', field('weight', base.weight, 'placeholder="2.5 kg"')),
          row('Size', field('size', base.size, 'placeholder="3/4 in"')),
          row('Length', field('length', base.length, 'placeholder="8 ft"')),
        ].join(''), 'Free text - nothing computes on these')}

        ${formBar('')}
      </div>`;
    addOnRender = false;
  }

  const marginLine = (s) => `You make <strong>${peso(s.profit)}</strong> · `
    + `<strong>${s.markup.toFixed(1)}%</strong> markup on cost · `
    + `<strong>${s.margin.toFixed(1)}%</strong> margin on price`;

  /* ---- the three-way binding: any two of cost / margin / price drive the third ---- */
  const fieldEl = (name) => root().querySelector(`[data-f="${name}"]`);
  const segValue = (name) => {
    const on = root().querySelector(`.seg[data-seg="${name}"] .seg-btn.active`);
    return on ? on.dataset.segVal : '';
  };

  function reprice(edited) {
    const cost = num(fieldEl('cost').value);
    const mode = segValue('marginMode');
    if (edited === 'price') fieldEl('marginValue').value = marginFromPrice(cost, num(fieldEl('price').value), mode);
    else fieldEl('price').value = priceFromMargin(cost, mode, num(fieldEl('marginValue').value));
    root().querySelector('#pdMarginLabel').firstChild.nodeValue = MARGIN_LABEL[mode];
    root().querySelector('#pdMargin').innerHTML = marginLine(marginSummary(cost, num(fieldEl('price').value)));
  }

  /* ---- save ---- */
  function collect() {
    const out = {};
    root().querySelectorAll('[data-f]').forEach((el) => {
      out[el.dataset.f] = el.type === 'checkbox' ? el.checked
        : el.multiple ? Array.from(el.selectedOptions, (o) => o.value)
        : el.value.trim();
    });
    root().querySelectorAll('.seg[data-seg]').forEach((s) => { out[s.dataset.seg] = segValue(s.dataset.seg); });
    return out;
  }

  // The combo boxes hold a typed name; saving turns it into an id and creates the
  // category or the supplier when that name is new. '' is a real answer (none).
  function resolveFolder(f) {
    const name = String(f.folder || '').trim();
    if (!name) return '';
    const hit = state.folders.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const base = slug(name);
    const made = { id: base ? 'cat_' + base : newId('cat'), name, builtin: false };
    saveFolders(state.folders.concat(made));
    return made.id;
  }

  function resolveSupplier(f) {
    const name = String(f.supplier || '').trim();
    if (!name) return '';
    const list = loadSuppliers();
    const hit = list.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const made = { ...SUPPLIER_DEFAULTS, id: newId('sup'), name };
    saveSuppliers(list.concat(made));
    return made.id;
  }

  function save(id, opts = {}) {
    const f = collect();
    const errs = {};
    if (!f.name) errs.name = 'Name is required';
    ['cost', 'price'].forEach((k) => {
      const n = Number(f[k]);
      if (f[k] === '' || !Number.isFinite(n) || n < 0) errs[k] = 'Enter a number, 0 or more';
    });
    if (f.openingQty !== undefined && f.openingQty !== '' && !(Number(f.openingQty) >= 0)) {
      errs.openingQty = 'Enter a quantity, 0 or more';
    }
    root().querySelectorAll('[data-err]').forEach((el) => { el.textContent = errs[el.dataset.err] || ''; });
    if (Object.keys(errs).length) { showToast('Fix the highlighted fields'); return null; }

    const isNew = id === 'new';
    const existing = isNew ? null : state.products.find((x) => x.id === id);
    if (!isNew && !existing) { showToast('That product no longer exists'); return null; }

    const next = normalizeProduct({
      ...(existing || {}),
      id: existing ? existing.id : newId('p'),
      name: f.name, brand: f.brand, folder: resolveFolder(f), supplierId: resolveSupplier(f),
      altSupplierIds: f.altSuppliers || (existing ? existing.altSupplierIds : []),
      imageUrl: f.imageUrl, soldBy: f.soldBy, unit: f.unit || 'pc',
      cost: Number(f.cost), price: Number(f.price),
      marginMode: f.marginMode, marginValue: num(f.marginValue),
      reorderPoint: num(f.reorderPoint), sellOutOfStock: !!f.sellOutOfStock,
      sku: f.sku, barcode: f.barcode,
      weight: f.weight, size: f.size, length: f.length,
      stock: existing ? existing.stock : 0,
      updatedAt: new Date().toISOString(),
    });

    // A new product may open with a quantity, but it still arrives as a movement.
    const movements = [];
    const opening = num(f.openingQty);
    if (isNew && opening > 0) {
      const mv = makeMovement({ productId: next.id, qty: opening, reason: 'count', note: 'Opening stock',
        happenedOn: f.openingSince });
      applyMovement(next, mv);
      movements.push(mv);
    }

    const list = state.products.slice();
    const at = list.findIndex((x) => x.id === next.id);
    if (at >= 0) list[at] = next; else list.push(next);
    state.products = list;
    saveProducts();
    appendMovements(movements);
    refreshSharedState();
    if (opts.toast !== false) showToast('Saved');
    if (opts.go === false) return next;
    Router.go(VIEW, '');   // Save is done with this product - go back to the list
    return next;
  }

  /* ---------- saving a family: one form, several product rows ---------- */

  function saveGroup(gid) {
    const f = collect();
    const rows = Array.from(root().querySelectorAll('.pd-vrow')).map((tr) => {
      const v = { id: tr.dataset.vid || '' };
      tr.querySelectorAll('[data-v]').forEach((el) => { v[el.dataset.v] = el.value.trim(); });
      return v;
    });

    if (!f.name) { showToast('Name the product'); return null; }
    if (!rows.length) { showToast('A product needs at least one variant'); return null; }
    for (let i = 0; i < rows.length; i += 1) {
      const v = rows[i];
      if (!v.name) { showToast(`Variant ${i + 1} needs a name`); return null; }
      const bad = ['cost', 'price'].find((k) => v[k] === '' || !(Number(v[k]) >= 0));
      if (bad) { showToast(`Variant ${i + 1}: ${bad} must be a number, 0 or more`); return null; }
    }

    const folder = resolveFolder(f);
    const supplierId = resolveSupplier(f);
    const altSupplierIds = f.altSuppliers || [];

    const groups = loadGroups();
    const at = groups.findIndex((x) => x.id === gid);
    const g = { ...GROUP_DEFAULTS, ...(groups[at] || { id: gid }),
                name: f.name, folder, imageUrl: safeUrl(f.imageUrl) };
    if (at >= 0) groups[at] = g; else groups.push(g);
    putGroups(groups);

    const stamp = new Date().toISOString();
    const list = state.products.slice();
    const byId = new Map(list.map((x, i) => [x.id, i]));
    const keep = new Set(rows.map((v) => v.id).filter(Boolean));
    const movements = [];

    // A variant taken off the table is archived, never deleted - an old receipt
    // has to stay resolvable.
    list.forEach((x, i) => {
      if (x.groupId === gid && !x.archived && !keep.has(x.id)) {
        list[i] = { ...x, archived: true, updatedAt: stamp };
      }
    });

    rows.forEach((v) => {
      const existing = v.id && byId.has(v.id) ? list[byId.get(v.id)] : null;
      const cost = Number(v.cost);
      const price = Number(v.price);
      const marginMode = (existing && existing.marginMode) || 'percent';
      const next = normalizeProduct({
        ...(existing || {}),
        id: existing ? existing.id : newId('p'),
        groupId: gid, archived: false,
        name: v.name, sku: v.sku, barcode: v.barcode, imageUrl: v.imageUrl,
        cost, price, marginMode, marginValue: marginFromPrice(cost, price, marginMode),
        folder, supplierId, altSupplierIds, brand: f.brand,
        soldBy: f.soldBy, unit: f.unit || 'pc',
        reorderPoint: num(f.reorderPoint), sellOutOfStock: !!f.sellOutOfStock,
        weight: f.weight, size: f.size, length: f.length,
        stock: existing ? existing.stock : 0,
        updatedAt: stamp,
      });
      const opening = num(v.openingQty);
      if (!existing && opening > 0) {
        const mv = makeMovement({ productId: next.id, qty: opening, reason: 'count', note: 'Opening stock',
          happenedOn: f.openingSince });
        applyMovement(next, mv);
        movements.push(mv);
      }
      if (existing) list[byId.get(v.id)] = next; else list.push(next);
    });

    state.products = list;
    saveProducts();
    appendMovements(movements);
    refreshSharedState();
    showToast('Saved');
    Router.go(VIEW, '');
    return g;
  }

  // A plain product grows variants by becoming a family. It keeps its stock and its
  // history by staying a product - it is simply variant one now.
  function convertToGroup() {
    const id = state.detailId;
    const f = collect();
    if (!f.name) { showToast('Name the product first'); return; }

    let seed = null;
    let folder = resolveFolder(f);
    if (id !== 'new') {
      seed = save(id, { go: false, toast: false });
      if (!seed) return;
      folder = seed.folder;
    }

    const g = { ...GROUP_DEFAULTS, id: newId('grp'), name: f.name, folder, imageUrl: safeUrl(f.imageUrl) };
    putGroups(loadGroups().concat(g));

    if (seed) {
      const list = state.products.slice();
      const at = list.findIndex((x) => x.id === seed.id);
      list[at] = { ...list[at], groupId: g.id, updatedAt: new Date().toISOString() };
      state.products = list;
      saveProducts();
    }
    refreshSharedState();
    addOnRender = true;
    Router.go(VIEW, g.id);
  }

  /* ================= render + events ================= */

  window.renderProducts = function () {
    const r = root();
    if (state.detailId) { renderEditor(state.detailId); return; }
    // The search box is inside the view, so the shell is rebuilt only when it is
    // missing - re-rendering it on every keystroke would steal focus.
    if (!r.querySelector('.pd-list')) r.innerHTML = listShell();
    syncControls();
    applyCols();
    paintImport();
    paintTable();
  };

  const rebuild = () => { root().innerHTML = ''; refreshSharedState(); renderCurrentView(); };
  const mine = (el) => !!el && !!root() && root().contains(el);
  const isFamily = () => !!state.detailId && loadGroups().some((g) => g.id === state.detailId);

  document.addEventListener('click', (e) => {
    const r = root();
    if (!r || r.hidden || !e.target.closest) return;

    const segBtn = e.target.closest('.seg-btn');
    if (mine(segBtn)) {
      segBtn.parentElement.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === segBtn));
      // Price is authoritative, so switching mode recomputes the margin, not the price.
      if (segBtn.parentElement.dataset.seg === 'marginMode') reprice('price');
      return;
    }

    const rowEl = e.target.closest('.pd-row');
    if (mine(rowEl) && !e.target.closest('a')) { Router.go(VIEW, rowEl.dataset.id); return; }

    const btn = e.target.closest('[data-act]');
    if (!mine(btn)) return;
    const act = btn.dataset.act;
    if (act === 'back') Router.go(VIEW, '');
    else if (act === 'new') Router.go(VIEW, 'new');
    else if (act === 'export') exportCsv();
    else if (act === 'import') r.querySelector('#pdFile').click();
    else if (act === 'import-cancel') { pending = null; paintImport(); }
    else if (act === 'import-apply') {
      const plan = pending;
      pending = null;
      commitImport(plan);
      rebuild();
      const n = plan.create.length + plan.update.length;
      showToast(`Imported ${n} product${n === 1 ? '' : 's'}`);
    } else if (act === 'save') {
      if (isFamily()) saveGroup(state.detailId); else save(state.detailId);
    } else if (act === 'add-variant') {
      if (!isFamily()) { convertToGroup(); return; }
      const tb = r.querySelector('#pdVariants tbody');
      tb.insertAdjacentHTML('beforeend', variantRowHtml(normalizeProduct({})));
      tb.lastElementChild.querySelector('[data-v="name"]').focus();
    } else if (act === 'del-variant') {
      const tr = btn.closest('.pd-vrow');
      if (r.querySelectorAll('.pd-vrow').length < 2) {
        showToast('A product needs at least one variant');
        return;
      }
      tr.remove();
    } else if (act === 'img-clear') {
      setImage(btn.closest('.pd-imgpick'), '');
    } else if (act === 'archive') {
      const list = state.products.slice();
      const at = list.findIndex((x) => x.id === state.detailId);
      if (at < 0) return;
      // ponytail: native confirm(), same as cancelling a PO in bo-suppliers.js. Archiving is
      // reversible from this very button, so it needs the pause, not a designed dialog.
      // Restoring is not destructive and asks nothing.
      if (!list[at].archived
        && !confirm(`Archive "${list[at].name}"?

It stops showing in the POS. Old receipts still resolve, and you can restore it from this page.`)) return;
      // Never delete: an old receipt has to stay resolvable.
      list[at] = { ...list[at], archived: !list[at].archived, updatedAt: new Date().toISOString() };
      state.products = list;
      saveProducts();
      refreshSharedState();
      renderCurrentView();
      showToast(list[at].archived ? 'Archived - old receipts still resolve' : 'Restored');
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !mine(el)) return;
    if (el.dataset.v) {
      const tr = el.closest('.pd-vrow');
      if (el.dataset.v === 'cost' || el.dataset.v === 'price') {
        tr.querySelector('.pd-vmargin').textContent =
          vMarkup(tr.querySelector('[data-v="cost"]').value, tr.querySelector('[data-v="price"]').value);
      }
      return;
    }
    if (!el.dataset.f) return;
    const f = el.dataset.f;
    if ((f === 'cost' || f === 'marginValue' || f === 'price') && !isFamily()) reprice(f);
  });

  document.addEventListener('change', async (e) => {
    const el = e.target;
    if (!mine(el)) return;
    if (el.dataset.filter) {
      Router.setParams({ [el.dataset.filter]: el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value, page: '' });
      return;
    }
    if (el.dataset.colToggle) {
      const on = loadCols();
      if (el.checked) on.add(el.dataset.colToggle); else on.delete(el.dataset.colToggle);
      saveCols(on);
      applyCols();                 // CSS hides the cells; no need to rebuild the rows
      return;
    }
    if (el.dataset.img) {
      const img = el.files && el.files[0];
      el.value = '';
      if (!img) return;
      try {
        setImage(el.closest('.pd-imgpick'), await shrink(img));
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
        pending = { ...planImport(parseCsv(await file.text()), state.products, state.folders), file: file.name };
        paintImport();
      } catch (err) {
        showToast((err && err.message) || 'Could not read that CSV');
      }
    }
  });

  if (typeof module !== 'undefined') module.exports = { planImport };
})();
