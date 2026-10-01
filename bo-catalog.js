/* Back office - Categories and Modifiers, the two lists that file products (product-edit-lab.html
   port, 2026-10-01). Both copy the Products page: a table, click a row for its page.
   Categories: an item sits in several; deleting one leaves its items alone (they only lose it).
   Modifiers: lists of options (name + price), switched on per item in the product editor. No stock.
   The POS does not read modifiers yet; the rows are shaped so it can (ids on every option). */
(function () {
  const params = () => Router.route().params;
  const rootOf = (view) => document.querySelector(`.view[data-view="${view}"]`);
  const mineIn = (view, el) => !!el && !!rootOf(view) && rootOf(view).contains(el);
  const stamp = () => new Date().toISOString();

  // A family is one item here, as on the Products list: its variants move together.
  const groupNames = () => new Map(loadGroups().map((g) => [g.id, g.name]));
  function items() {
    const names = groupNames(), by = new Map();
    state.products.map(normalizeProduct).filter((p) => !p.archived).forEach((p) => {
      const key = p.groupId && names.has(p.groupId) ? p.groupId : p.id;
      if (!by.has(key)) by.set(key, { key, name: key === p.id ? p.name : names.get(key), members: [] });
      by.get(key).members.push(p);
    });
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const priceText = (ms) => {
    const v = ms.map((m) => Number(m.price) || 0), lo = Math.min(...v), hi = Math.max(...v);
    return lo === hi ? peso(lo) : `${peso(lo)}&ndash;${peso(hi)}`;
  };
  const skuText = (it) => (it.members.length > 1 ? `${it.members.length} variants` : escapeHtml(it.members[0].sku || ''));
  // Every member of the item gets the same change; folder stays folders[0] for the readers of one.
  function setCats(keys, fn) {
    const ids = new Set(items().filter((it) => keys.has(it.key)).flatMap((it) => it.members.map((m) => m.id)));
    const firstOf = new Map(), at = stamp();
    state.products = state.products.map((p) => {
      if (!ids.has(p.id)) return p;
      const folders = fn(foldersOf(p));
      if (folders.join() === foldersOf(p).join()) return p;   // untouched rows keep their stamp
      if (p.groupId) firstOf.set(p.groupId, folders[0] || '');
      return { ...p, folders, folder: folders[0] || '', updatedAt: at };
    });
    saveProducts();
    // The family row keeps a folder of its own, read first by the list and the till's Items page.
    if (!firstOf.size) return;
    saveGroups(loadGroups().map((g) => (firstOf.has(g.id) ? { ...g, folder: firstOf.get(g.id), updatedAt: at } : g)));
  }

  const head = (title, actions, back) => `
    <header class="item-head">${back ? `<a class="item-back" href="${escapeHtml(back[1])}">${back[0]}</a>` : ''}
      <h1>${title}</h1><div class="view-actions">${actions}</div></header>`;
  const card = (label, sub, right, table) => `
    <section class="bo-card blk-table">
      <div class="bo-card-head"><span class="bo-card-label">${label}</span><span class="bo-card-sub">${sub}</span>${right}</div>
      <div class="bo-card-inset flush"><div class="table-wrap">${table}</div></div>
    </section>`;
  const search = (ph) => `<div class="list-filters"><input class="search-input small" data-find placeholder="${ph}" autocomplete="off"></div>`;
  const tbl = (heads, rows, cols, empty) => `<table class="data-table"><thead><tr>${heads}</tr></thead>
    <tbody>${rows || `<tr><td colspan="${cols}" class="bo-empty">${empty}</td></tr>`}</tbody></table>`;
  // A name form, the editor's card: new and rename share it.
  const nameForm = (title, back, value, save) => `<div class="pe">${head(escapeHtml(title), '', back)}
      <div class="pe-col"><section class="pe-card"><div class="pe-body">
        <label class="pe-f"><span>Name</span><input class="pe-in big" data-name value="${escapeHtml(value)}" placeholder="Plumbing"></label>
      </div></section></div>
      <div class="pe-formbar"><button type="button" class="primary-btn small" data-cg="${save}">Save</button></div></div>`;

  /* ================= Categories ================= */
  const CV = 'categories';
  const cats = () => state.folders.filter((f) => f.id !== 'all');
  const catHref = (id = '', p) => Router.href(CV, id, p);

  window.renderCategories = function () {
    const r = rootOf(CV);
    const [id, sub] = state.detailId.split('/');
    if (id === 'new') { r.innerHTML = nameForm('New category', ['Categories', catHref()], '', 'cat-create'); r.querySelector('[data-name]').focus(); return; }
    if (!id) { r.innerHTML = catList(); return; }
    const f = cats().find((x) => x.id === id);
    if (!f) { r.innerHTML = head('Category not found', '', ['Categories', catHref()]); return; }
    if (sub === 'edit') { r.innerHTML = nameForm(f.name, [escapeHtml(f.name), catHref(id)], f.name, 'cat-rename'); return; }
    r.innerHTML = sub === 'add' ? catAdd(f) : catPage(f);
  };

  function catList() {
    const all = items();
    const rows = cats().map((f) => {
      const n = all.filter((it) => it.members.some((m) => m.folders.includes(f.id))).length;
      return `<tr class="pd-row" data-go="${CV}" data-id="${escapeHtml(f.id)}" data-find-row="${escapeHtml(f.name.toLowerCase())}">
        <td>${escapeHtml(f.name)}</td><td class="num">${n}</td></tr>`;
    }).join('');
    return `${head('Categories', '<a class="primary-btn small" href="' + escapeHtml(catHref('new')) + '">Add category</a>')}
      ${search('Search categories')}
      ${card('All categories', `${cats().length}`, '', tbl('<th>Category</th><th class="num">Items</th>', rows, 2, 'No categories yet.'))}`;
  }

  function catPage(f) {
    const mine = items().filter((it) => it.members.some((m) => m.folders.includes(f.id)));
    const rows = mine.map((it) => `<tr class="pd-row" data-go="products" data-id="${escapeHtml(it.key)}/edit">
        <td>${escapeHtml(it.name)}</td><td>${skuText(it)}</td><td class="num">${priceText(it.members)}</td>
        <td class="num"><button type="button" class="link-btn" data-cg="cat-out" data-key="${escapeHtml(it.key)}">Remove</button></td></tr>`).join('');
    return `${head(escapeHtml(f.name), `<button class="secondary-btn small" data-cg="cat-del">Delete</button>
        <a class="secondary-btn small" href="${escapeHtml(catHref(`${f.id}/edit`))}">Rename</a>
        <a class="primary-btn small" href="${escapeHtml(catHref(`${f.id}/add`))}">Add items</a>`, ['Categories', catHref()])}
      ${card('Items', `${mine.length}`, '', tbl('<th>Item</th><th>SKU</th><th class="num">Price</th><th class="num"></th>', rows, 4, 'Nothing in this category yet.'))}`;
  }

  // Every item not in it yet, ticks on the left, Add top right (the Products list's bulk bar).
  function catAdd(f) {
    const rest = items().filter((it) => !it.members.some((m) => m.folders.includes(f.id)));
    const rows = rest.map((it) => `<tr data-find-row="${escapeHtml(it.name.toLowerCase())}">
        <td class="pd-sel"><input type="checkbox" data-tick="${escapeHtml(it.key)}" aria-label="${escapeHtml(it.name)}"></td>
        <td>${escapeHtml(it.name)}</td><td>${skuText(it)}</td><td>${escapeHtml(foldersOf(it.members[0]).map(folderName).join(', '))}</td>
        <td class="num">${priceText(it.members)}</td></tr>`).join('');
    return `${head(`Add items to ${escapeHtml(f.name)}`, '<button class="primary-btn small" data-cg="cat-add" disabled>Add</button>', [escapeHtml(f.name), catHref(f.id)])}
      ${search('Search products')}
      ${card('Products', `${rest.length}`, '', tbl('<th class="pd-sel"></th><th>Item</th><th>SKU</th><th>Categories</th><th class="num">Price</th>', rows, 5, 'Every product is in this category already.'))}`;
  }

  function catAct(t) {
    const r = rootOf(CV), [id] = state.detailId.split('/');
    const a = t.dataset.cg;
    if (a === 'cat-create' || a === 'cat-rename') {
      const name = r.querySelector('[data-name]').value.trim();
      if (!name) { r.querySelector('[data-name]').focus(); return; }
      if (cats().some((f) => f.id !== id && f.name.toLowerCase() === name.toLowerCase())) { showToast('A category has that name already'); return; }
      if (a === 'cat-create') { Router.go(CV, addFolder(name), {}, { replace: true }); return; }
      saveFolders(state.folders.map((f) => (f.id === id ? { ...f, name, updatedAt: stamp() } : f)));
      Router.go(CV, id, {}, { replace: true });
    } else if (a === 'cat-out') {
      setCats(new Set([t.dataset.key]), (fs) => fs.filter((x) => x !== id));
      renderCategories();
    } else if (a === 'cat-add') {
      const keys = new Set([...r.querySelectorAll('[data-tick]:checked')].map((x) => x.dataset.tick));
      setCats(keys, (fs) => fs.concat(id));
      showToast(`Added ${keys.size} item${keys.size === 1 ? '' : 's'}`);
      Router.go(CV, id, {}, { replace: true });
    } else if (a === 'cat-del') {
      const f = cats().find((x) => x.id === id);
      if (!confirm(`Delete “${f.name}”? Its items stay; they only leave this category.`)) return;
      setCats(new Set(items().map((it) => it.key)), (fs) => fs.filter((x) => x !== id));   // archived keep it; addFolder won't reuse it
      saveFolders(state.folders.filter((x) => x.id !== id));
      Router.go(CV, '');
    }
  }

  /* ================= Modifiers ================= */
  const MV = 'modifiers';
  const PE_X = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
  let M = null;   // the list being edited; written only on Save
  const usedBy = (id) => items().filter((it) => it.members.some((m) => m.modifierIds.includes(id))).length;
  const summary = (m) => m.options.map((o) => `${escapeHtml(o.name)} +${peso(o.price)}`).join(' · ');

  window.renderModifiers = function () {
    const r = rootOf(MV), id = state.detailId;
    if (!id) {
      M = null;
      const show = params().archived === '1';
      const rows = loadModifiers().filter((m) => show || !m.archived).map((m) => `<tr class="pd-row${m.archived ? ' pd-arch' : ''}" data-go="${MV}" data-id="${escapeHtml(m.id)}" data-find-row="${escapeHtml(m.name.toLowerCase())}">
          <td>${escapeHtml(m.name)}</td><td class="muted">${summary(m) || 'No options yet'}</td><td class="num">${usedBy(m.id)}</td></tr>`).join('');
      r.innerHTML = `${head('Modifiers', `<a class="primary-btn small" href="${escapeHtml(Router.href(MV, 'new'))}">Add modifier</a>`)}
        <div class="list-filters"><input class="search-input small" data-find placeholder="Search modifiers" autocomplete="off">
          <label class="bo-check"><input type="checkbox" data-cg="mod-arch"${show ? ' checked' : ''}> Show archived</label></div>
        ${card('All modifiers', '', '', tbl('<th>Modifier</th><th>Options</th><th class="num">Items</th>', rows, 3, 'No modifiers yet. A modifier is a list of choices sold with an item, like Cut to length +₱20.'))}`;
      return;
    }
    if (!M || M.key !== id || M.visit !== state.visit) {
      const was = loadModifiers().find((m) => m.id === id);
      if (id !== 'new' && !was) { r.innerHTML = head('Modifier not found', '', ['Modifiers', Router.href(MV, '')]); return; }
      M = { key: id, visit: state.visit, ...(was ? structuredClone(was) : { ...MODIFIER_DEFAULTS, options: [{ id: newId('opt'), name: '', price: '' }] }) };
    }
    paintMod();
  };

  function paintMod() {
    const r = rootOf(MV);
    const row = (o, i) => `<div class="pe-orow">
        <input class="pe-in" data-o="name" data-i="${i}" value="${escapeHtml(o.name)}" placeholder="Option, like Cut to length">
        <div class="pe-affix pre"><i>₱</i><input class="pe-in pe-num" data-o="price" data-i="${i}" value="${escapeHtml(o.price)}" inputmode="decimal" placeholder="0.00"></div>
        <button type="button" class="pe-x" data-cg="opt-del" data-i="${i}" aria-label="Remove option">${PE_X}</button></div>`;
    r.innerHTML = `<div class="pe">${head(escapeHtml(M.name || 'New modifier'), '', ['Modifiers', Router.href(MV, '')])}
      <div class="pe-col">
        <section class="pe-card"><div class="pe-body"><label class="pe-f"><span>Name</span><input class="pe-in big" data-m="name" value="${escapeHtml(M.name)}" placeholder="Cutting"></label></div></section>
        <section class="pe-card"><div class="pe-band">Options<span class="pe-r">Price is added to the item's</span></div>
          <div class="pe-body">${M.options.map(row).join('')}</div>
          <button type="button" class="pe-vadd" data-cg="opt-add">Add option</button></section>
      </div>
      <div class="pe-formbar">${M.id ? `<button type="button" class="pe-quiet" data-cg="mod-archive">${M.archived ? 'Restore' : 'Archive'}</button>` : ''}
        <button type="button" class="primary-btn small" data-cg="mod-save">Save</button></div></div>`;
  }

  function modAct(t) {
    const a = t.dataset.cg, i = Number(t.dataset.i);
    if (a === 'mod-arch') { Router.setParams({ archived: t.checked ? '1' : '' }); return; }
    if (a === 'opt-add') { M.options.push({ id: newId('opt'), name: '', price: '' }); paintMod(); rootOf(MV).querySelector(`[data-o="name"][data-i="${M.options.length - 1}"]`).focus(); return; }
    if (a === 'opt-del') { M.options.splice(i, 1); paintMod(); return; }
    const list = loadModifiers();
    if (a === 'mod-archive') {
      saveModifiers(list.map((m) => (m.id === M.id ? { ...m, archived: !m.archived, updatedAt: stamp() } : m)));
      Router.go(MV, '');
      return;
    }
    if (a !== 'mod-save') return;
    const name = M.name.trim();
    if (!name) { rootOf(MV).querySelector('[data-m="name"]').focus(); return; }
    const named = M.options.filter((o) => String(o.name).trim());
    if (named.some((o) => !(Number(o.price) >= 0))) { showToast('A price must be a number, 0 or more'); return; }
    const options = named.map((o) => ({ id: o.id, name: String(o.name).trim(), price: round2(o.price) }));
    const next = { ...MODIFIER_DEFAULTS, ...M, id: M.id || newId('mod'), name, options, updatedAt: stamp() };
    delete next.key; delete next.visit;
    saveModifiers(M.id ? list.map((m) => (m.id === M.id ? next : m)) : list.concat(next));
    M = null;
    showToast('Saved');
    Router.go(MV, '');
  }

  /* ================= events ================= */
  document.addEventListener('click', (e) => {
    if (!e.target.closest) return;
    const t = e.target.closest('[data-cg]');
    if (mineIn(CV, t)) { catAct(t); return; }
    if (mineIn(MV, t)) { if (t.dataset.cg !== 'mod-arch') modAct(t); return; }
    // A row opens its page, like the Products list; its own buttons and ticks do not.
    const row = e.target.closest('tr[data-go]');
    if ((mineIn(CV, row) || mineIn(MV, row)) && !e.target.closest('a, button, input')) Router.go(row.dataset.go, row.dataset.id);
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (mineIn(MV, t) && t.dataset.cg === 'mod-arch') modAct(t);
    if (mineIn(CV, t) && t.dataset.tick !== undefined) {
      const n = rootOf(CV).querySelectorAll('[data-tick]:checked').length;
      const b = rootOf(CV).querySelector('[data-cg="cat-add"]');
      b.disabled = !n;
      b.textContent = n ? `Add ${n}` : 'Add';
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    // Search filters the rows in place; the table is one store's catalogue, not a page of a server list.
    if ((mineIn(CV, t) || mineIn(MV, t)) && t.dataset.find !== undefined) {
      const q = t.value.trim().toLowerCase();
      t.closest('.view').querySelectorAll('[data-find-row]').forEach((tr) => { tr.hidden = !!q && !tr.dataset.findRow.includes(q); });
    }
    if (!M || !mineIn(MV, t)) return;
    if (t.dataset.m === 'name') { M.name = t.value; rootOf(MV).querySelector('.item-head h1').textContent = t.value || 'New modifier'; }
    if (t.dataset.o) M.options[Number(t.dataset.i)][t.dataset.o] = t.value;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('[data-name]') || !mineIn(CV, e.target)) return;
    rootOf(CV).querySelector('.pe-formbar [data-cg]').click();
  });
})();
