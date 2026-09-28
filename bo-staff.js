/* Back office — Staff & access. Renders Settings › Staff & access (#staffPane,
   /admin/settings/staff): People with a role picked in place, then Roles with the pages each
   opens; ?person=<id|new> is one person. The old /admin/staff URLs redirect here (applyRoute).
   Name, role and page access only (owner, 2026-09-24): no attendance, clock or payroll --
   the POS is not a time clock. What a person rang up lives in Sales, not here (2026-09-26). */
(function () {
  const root = () => document.getElementById('staffPane');

  /* ---------- What each person rang up, last 30 days ----------
     Not drawn here any more; kept for Sales › By staff and gated by scripts/staff-check.mjs.
     Orders name the cashier, so the join is by name. Voids and refunds are counted, not
     summed: for money they never happened. */
  const DAYS = 30;
  function salesByName(orders, now = Date.now()) {
    const from = now - DAYS * 864e5, by = new Map();
    for (const o of orders || []) {
      if (!(o.ts >= from)) continue;
      const r = by.get(o.cashier) || { revenue: 0, sales: 0, voids: 0, refunds: 0, last: 0 };
      if (o.status === 'completed') { r.sales += 1; r.revenue += Number(o.total) || 0; r.last = Math.max(r.last, o.ts); }
      else if (o.status === 'voided') r.voids += 1;
      else if (o.status === 'refunded' || o.status === 'return') r.refunds += 1;
      by.set(o.cashier, r);
    }
    return by;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { salesByName };
  if (typeof document === 'undefined') return;   // Node loads this file for the maths only

  /* ---------- Page access ---------- */
  const STORAGE_ACCESS = 'hwpos.access.v1';
  // Keys, not labels: 'staff' is Settings › Staff & access, 'insights' is Analytics. Saved maps use these.
  const ACCESS_VIEWS = ['dashboard', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'staff', 'insights', 'payments', 'settings'];
  const PAGE_LABEL = { inventory: 'Stock history', insights: 'Analytics', staff: 'Staff & access' };
  const pageLabel = (v) => PAGE_LABEL[v] || v[0].toUpperCase() + v.slice(1);
  const DEFAULT_ACCESS = {
    owner: ACCESS_VIEWS,
    manager: ['dashboard', 'sales', 'products', 'inventory', 'customers', 'suppliers'],
    cashier: ['dashboard', 'sales', 'customers'],
    stock: ['dashboard', 'products', 'inventory', 'suppliers'],
  };
  function loadAccess() {
    const raw = readJsonStorage(STORAGE_ACCESS, null) || {};
    const out = {};
    for (const role of Object.keys(STAFF_ROLES)) {
      // Owner is always everything: locking yourself out of your own back office is not a feature.
      out[role] = role === 'owner' ? ACCESS_VIEWS.slice()
        : (Array.isArray(raw[role]) ? raw[role].filter((v) => ACCESS_VIEWS.includes(v)) : (DEFAULT_ACCESS[role] || []).slice());
    }
    return out;
  }
  const saveAccess = (map) => storageSet(STORAGE_ACCESS, JSON.stringify(map));

  /* ---------- Small shared bits ---------- */
  const roleName = (r) => STAFF_ROLES[r] || r || '—';
  const MUTED = '<span class="muted">—</span>';
  const person = () => Router.route().params.person || '';
  const goPerson = (id) => Router.go('settings', 'staff', { person: id });
  const roleSelect = (u, attrs) => `<select class="bo-select" ${attrs}>${Object.entries(STAFF_ROLES)
    .map(([k, v]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${v}</option>`).join('')}</select>`;

  const head = (title, back, actions) => `
    <header class="view-head">
      <div class="view-title-wrap">${back}<h1>${title}</h1></div>
      <div class="view-actions">${actions}</div>
    </header>`;

  /* ---------- People: name, email, and a role picked in place ---------- */
  function peopleHtml(staff, q) {
    const needle = q.toLowerCase();
    // Archived people (someone who left) are hidden unless asked for, like archived products.
    const showArch = Router.route().params.archived === '1';
    const archived = staff.filter((u) => !u.active).length;
    // A handful of people is read at a glance; the search box earns its place past ten.
    const search = staff.length > 10 || !!q;
    const rows = staff.filter((u) => (showArch || u.active)
      && (!needle || (u.name + ' ' + roleName(u.role)).toLowerCase().includes(needle)));
    const pg = paginate(rows, Router.route().params.page);
    const body = rows.length ? pg.rows.map((u) => `
      <tr data-id="${escapeHtml(u.id)}">
        <td>${escapeHtml(u.name)}${u.active ? '' : ' <span class="status-pill muted">Archived</span>'}</td>
        <td>${u.email ? escapeHtml(u.email) : MUTED}</td>
        <td class="num">${roleSelect(u, `data-act="role" aria-label="Role for ${escapeHtml(u.name)}"`)}</td>
      </tr>`).join('') : '';

    return head('Staff &amp; access', '',
      `<button class="secondary-btn small" data-act="exportCsv">Export CSV</button>
       <button class="primary-btn small" data-act="add">Add staff</button>`) + `
      ${search || archived ? `<div class="list-filters">
        ${search ? `<input class="search-input small q-input" data-act="q" placeholder="Search staff…" autocomplete="off" value="${escapeHtml(q)}" />` : ''}
        ${archived ? `<label class="bo-check"><input type="checkbox" data-act="archived"${showArch ? ' checked' : ''}> Show archived (${archived})</label>` : ''}
      </div>` : ''}
      <div class="set-col">
        <section class="${body ? 'bo-card blk-table' : 'bo-card blk-empty'}">
          <div class="bo-card-head">
            <span class="bo-card-label">People</span>
            <span class="bo-card-sub">A role sets the pages they open. Saves as you pick.</span>
          </div>
          <div class="bo-card-inset flush">
            ${body ? `<div class="table-wrap"><table class="data-table"><thead><tr>
                <th>Name</th><th>Email</th><th class="num">Role</th>
              </tr></thead><tbody>${body}</tbody></table></div>${pagerHtml(pg)}`
            : `<div class="bo-empty">${staff.length ? 'No staff match that search' : 'No staff yet. Add the first one.'}</div>`}
          </div>
        </section>
        ${rolesHtml(staff)}
      </div>`;
  }

  /* ---------- Roles: one row each, its pages in a line; the checkboxes live in #setDlg ---------- */
  const pagesLine = (role, on) => role === 'owner' ? 'Every page' : !on.length ? 'No pages'
    : on.slice(0, 3).map(pageLabel).join(', ') + (on.length > 3 ? ` +${on.length - 3}` : '');

  function rolesHtml(staff) {
    const access = loadAccess();
    const rows = Object.keys(STAFF_ROLES).map((role) => {
      const n = staff.filter((u) => u.active && u.role === role).length;
      return `<button type="button" class="setting-row" data-act="roleOpen" data-role="${role}">
          <span class="set-lbl">${escapeHtml(roleName(role))}<span class="set-count">${n} ${n === 1 ? 'person' : 'people'}</span></span>
          <span class="set-val">${escapeHtml(pagesLine(role, access[role]))}</span><span class="set-chev" aria-hidden="true">›</span></button>`;
    }).join('');

    return `
        <section class="bo-card blk-table">
          <div class="bo-card-head">
            <span class="bo-card-label">Roles</span>
            <span class="bo-card-sub">The pages each role opens</span>
          </div>
          <div class="bo-card-inset flush set-rows">${rows}</div>
        </section>`;
  }

  // Ticks save as they change (owner, 2026-09-24), so the dialog has Done, not Save.
  function openRole(role) {
    const on = new Set(loadAccess()[role]);
    const locked = role === 'owner';
    openSetDialog(`${escapeHtml(roleName(role))} can open`, ACCESS_VIEWS.map((v) => `<label class="bo-check"><input type="checkbox" data-act="access" data-role="${role}" data-page="${v}"${on.has(v) ? ' checked' : ''}${locked ? ' disabled' : ''}> ${escapeHtml(pageLabel(v))}</label>`).join('')
      + `<p class="adj-note set-dlg-note">${locked ? 'Owner always opens everything: locking yourself out is not a setting.'
        : "The sidebar hides what this role can't open. Until the Worker is deployed, nothing else stops it."}</p>`);
  }

  /* ---------- The person editor ---------- */
  function personHtml(u, isNew) {
    const field = (label, name, value, type = 'text') =>
      `<div class="setting-row"><label>${label}</label>
        <input class="text-input" type="${type}" data-field="${name}" value="${escapeHtml(value)}" /></div>`;
    const access = loadAccess()[u.role] || [];

    return head(isNew ? 'New staff' : escapeHtml(u.name), `<button class="link-btn" data-act="back">← Staff &amp; access</button>`,
      `${isNew ? '' : `<button class="secondary-btn small" data-act="tx">View their transactions</button>
       <button class="secondary-btn small${u.active ? ' danger' : ''}" data-act="toggleActive">${u.active ? 'Archive' : 'Restore'}</button>`}
       <button class="primary-btn small" data-act="save">Save</button>`) + `
      <div class="set-col">
        <section class="bo-card">
          <div class="bo-card-head"><span class="bo-card-label">Details</span></div>
          <div class="bo-card-inset">
            ${field('Name', 'name', u.name)}
            <div class="setting-row"><label>Role</label>${roleSelect(u, 'data-field="role"')}</div>
            ${field('Email', 'email', u.email, 'email')}
            <div class="setting-row"><label>Can open</label>
              <span class="st-note">${escapeHtml(access.map(pageLabel).join(', ') || 'Nothing')} · set per role under Roles</span></div>
          </div>
        </section>
      </div>`;
  }

  /* ---------- Render: Settings › Staff & access calls this ---------- */
  window.renderStaff = function () {
    const el = root();
    const staff = loadStaff();
    // Typing in the search box re-routes, which re-renders this whole pane — put
    // the caret back where it was so the field keeps working.
    const caret = document.activeElement?.dataset?.act === 'q' ? document.activeElement.selectionStart : null;
    const id = person();

    if (id) {
      const isNew = id === 'new';
      const u = isNew ? { ...STAFF_DEFAULTS, id: '' } : staff.find((x) => x.id === id);
      el.innerHTML = u ? personHtml(u, isNew)
        : head('That person no longer exists', '', '<button class="secondary-btn small" data-act="back">All staff</button>')
          + '<section class="bo-card blk-empty"><div class="bo-empty">Not found</div></section>';
      return;
    }

    el.innerHTML = peopleHtml(staff, state.invQuery);
    const q = el.querySelector('[data-act="q"]');
    if (caret != null && q) { q.focus(); q.setSelectionRange(caret, caret); }
  };

  /* ---------- Events: one delegated listener per type ---------- */
  const owned = (e) => root() && root().contains(e.target) && !root().hidden && !root().closest('.view').hidden;
  const stamp = () => new Date().toISOString();

  function persist(list, msg) {
    saveStaff(list);
    showToast(msg);
    refreshSharedState();
  }

  function readForm() {
    const r = root();
    const val = (f) => r.querySelector(`[data-field="${f}"]`)?.value.trim() || '';
    return {
      name: val('name'), role: val('role'), email: val('email'),
    };
  }

  // Role and page access save as they change: no Save button to forget.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.act === 'access' && el.closest('#setDlg')) {
      const map = loadAccess();
      const set = new Set(map[el.dataset.role]);
      if (el.checked) set.add(el.dataset.page); else set.delete(el.dataset.page);
      map[el.dataset.role] = ACCESS_VIEWS.filter((v) => set.has(v));
      saveAccess(map);
      showToast(`${roleName(el.dataset.role)} ${el.checked ? 'can' : 'can no longer'} open ${pageLabel(el.dataset.page)}`);
      return renderCurrentView();   // the role's line of pages, under the dialog
    }
    if (!owned(e)) return;
    if (el.dataset.act === 'role') {
      const list = loadStaff();
      const u = list.find((x) => x.id === el.closest('tr[data-id]').dataset.id);
      if (!u) return;
      Object.assign(u, { role: el.value, updatedAt: stamp() });
      persist(list, `${u.name} is now ${roleName(u.role)}`);
      return renderCurrentView();   // the Roles card counts people per role
    }
  });

  document.addEventListener('click', (e) => {
    if (!owned(e)) return;
    // The role picker sits in a clickable row; picking a role is not opening the person.
    if (e.target.closest('select')) return;
    const el = e.target.closest('[data-act]');
    if (!el) {
      const row = e.target.closest('tr[data-id]');
      if (row) goPerson(row.dataset.id);
      return;
    }
    const act = el.dataset.act;

    if (act === 'roleOpen') return openRole(el.dataset.role);
    if (act === 'back') return Router.go('settings', 'staff');
    if (act === 'archived') return Router.setParams({ archived: el.checked ? '1' : '', page: '' });
    if (act === 'add') return goPerson('new');
    if (act === 'tx') {
      const u = loadStaff().find((x) => x.id === person());
      return u && Router.go('transactions', '', { range: '30d', staff: u.name });
    }
    if (act === 'exportCsv') {
      const rows = [['name', 'role', 'email', 'status']];
      loadStaff().forEach((u) => rows.push([u.name, roleName(u.role), u.email, u.active ? 'active' : 'archived']));
      return downloadCsv('staff.csv', rows);
    }

    if (act === 'save' || act === 'toggleActive') {
      const form = readForm();
      if (!form.name) return showToast('Name is required');
      const list = loadStaff();
      const i = list.findIndex((u) => u.id === person());
      // Archive, never delete: an old sale names a cashier and that name has to resolve.
      if (act === 'toggleActive') form.active = !list[i].active;   // the button only shows on a saved person
      form.updatedAt = stamp();
      if (i < 0) {
        list.push({ ...STAFF_DEFAULTS, ...form, id: newId('u') });
      } else {
        list[i] = { ...list[i], ...form };
      }
      persist(list, act === 'toggleActive' ? (form.active ? 'Restored' : 'Archived') : 'Saved');
      // A new person has a new URL; everyone else just repaints in place.
      if (i < 0) Router.go('settings', 'staff'); else renderCurrentView();
    }
  });
})();
