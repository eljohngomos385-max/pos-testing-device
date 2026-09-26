/* Back office — Staff. Renders the whole .view[data-view="staff"]; see CONTRACT.
   One page (/admin/staff): People, then Page access under it; /admin/staff/<id> is one person.
   Name, role and page access only (owner, 2026-09-24): no attendance, clock or payroll --
   the POS is not a time clock. What a person rang up is read off the orders. */
(function () {
  const VIEW = 'staff';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  /* ---------- What each person rang up, last 30 days ----------
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
  const NONE = { revenue: 0, sales: 0, voids: 0, refunds: 0, last: 0 };

  if (typeof module !== 'undefined' && module.exports) module.exports = { salesByName };
  if (typeof document === 'undefined') return;   // Node loads this file for the maths only

  /* ---------- Page access ---------- */
  const STORAGE_ACCESS = 'hwpos.access.v1';
  const ACCESS_VIEWS = ['dashboard', 'sales', 'products', 'inventory', 'customers', 'suppliers', 'staff', 'insights', 'payments', 'settings'];
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
  const rolePill = (r) => `<span class="role-pill ${escapeHtml(r)}">${escapeHtml(roleName(r))}</span>`;
  const MUTED = '<span class="muted">—</span>';
  const count = (n) => (n ? String(n) : MUTED);
  // A card holding a table is a blk-table; the same card with nothing to list is a blk-empty.
  const tblCard = (has) => (has ? 'bo-card blk-table' : 'bo-card blk-empty');

  const head = (title, back, actions) => `
    <header class="view-head">
      <div class="view-title-wrap">${back}<h1>${title}</h1></div>
      <div class="view-actions">${actions}</div>
    </header>`;

  /* ---------- People ---------- */
  function peopleHtml(staff, q, sales) {
    const needle = q.toLowerCase();
    // Archived people (someone who left) are hidden unless asked for, like archived products.
    const showArch = Router.route().params.archived === '1';
    const archived = staff.filter((u) => !u.active).length;
    const rows = staff.filter((u) => (showArch || u.active)
      && (!needle || (u.name + ' ' + roleName(u.role)).toLowerCase().includes(needle)));
    const pg = paginate(rows, Router.route().params.page);
    const body = rows.length ? pg.rows.map((u) => {
      const s = sales.get(u.name) || NONE;
      return `
      <tr data-id="${escapeHtml(u.id)}">
        <td><strong>${escapeHtml(u.name)}</strong>${u.active ? '' : ' <span class="status-pill muted">Archived</span>'}</td>
        <td>${rolePill(u.role)}</td>
        <td class="num">${s.revenue ? peso(s.revenue) : MUTED}</td>
        <td class="num">${count(s.sales)}</td>
        <td class="num">${count(s.voids)}</td>
        <td class="num">${count(s.refunds)}</td>
        <td>${s.last ? escapeHtml(shortDate(s.last)) : MUTED}</td>
      </tr>`;
    }).join('') : '';

    return head('Staff', '',
      `<button class="secondary-btn small" data-act="exportCsv">Export CSV</button>
       <button class="primary-btn small" data-act="add">Add staff</button>`) + `
      <div class="list-filters">
        <input class="search-input small q-input" data-act="q" placeholder="Search staff…" autocomplete="off" value="${escapeHtml(q)}" />
        ${archived ? `<label class="bo-check"><input type="checkbox" data-act="archived"${showArch ? ' checked' : ''}> Show archived (${archived})</label>` : ''}
      </div>
      <div class="dash-stack">
        <section class="${tblCard(body)}">
          <div class="bo-card-head">
            <span class="bo-card-label">People</span>
            <span class="bo-card-sub">Last ${DAYS} days</span>
          </div>
          <div class="bo-card-inset flush">
            ${body ? `<div class="table-wrap"><table class="data-table"><thead><tr>
                <th>Name</th><th>Role</th><th class="num">Revenue</th><th class="num">Sales</th>
                <th class="num">Voids</th><th class="num">Refunds</th><th>Last sale</th>
              </tr></thead><tbody>${body}</tbody></table></div>${pagerHtml(pg)}`
            : `<div class="bo-empty">${staff.length ? 'No staff match that search' : 'No staff yet. Add the first one.'}</div>`}
          </div>
        </section>
        ${accessHtml()}
      </div>`;
  }

  /* ---------- The person editor ---------- */
  function personHtml(u, isNew, s) {
    const field = (label, name, value, type = 'text') =>
      `<div class="setting-row"><label>${label}</label>
        <input class="text-input" type="${type}" data-field="${name}" value="${escapeHtml(value)}" /></div>`;
    const access = loadAccess()[u.role] || [];

    return head(isNew ? 'New staff' : escapeHtml(u.name), `<button class="link-btn" data-act="back">← All staff</button>`,
      `${isNew ? '' : `<button class="secondary-btn small${u.active ? ' danger' : ''}" data-act="toggleActive">${u.active ? 'Archive' : 'Restore'}</button>`}
       <button class="primary-btn small" data-act="save">Save</button>`) + `
      <div class="dash-stack">
        <div class="dash-grid">
          <section class="bo-card">
            <div class="bo-card-head"><span class="bo-card-label">Details</span></div>
            <div class="bo-card-inset">
              ${field('Name', 'name', u.name)}
              <div class="setting-row"><label>Role</label>
                <select class="bo-select" data-field="role">${Object.entries(STAFF_ROLES)
                  .map(([k, v]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
              ${field('Email', 'email', u.email, 'email')}
              <div class="setting-row"><label>Can open</label>
                <span class="st-note">${escapeHtml(access.map((v) => v[0].toUpperCase() + v.slice(1)).join(', ') || 'Nothing')} · set per role on the Staff page</span></div>
            </div>
          </section>

          ${isNew ? '' : `<section class="bo-card blk-list">
            <div class="bo-card-head">
              <span class="bo-card-label">Last ${DAYS} days</span>
              <button class="secondary-btn small" data-act="tx">View their transactions</button>
            </div>
            <div class="bo-card-inset">
              <div class="bd-rows">
                ${bdRow('Revenue', peso(s.revenue))}${bdRow('Sales', String(s.sales))}
                ${bdRow('Average sale', peso(s.sales ? s.revenue / s.sales : 0))}
                ${bdRow('Voids', String(s.voids))}${bdRow('Refunds and returns', String(s.refunds))}
                ${bdRow('Last sale', s.last ? escapeHtml(shortDate(s.last)) : '—')}
              </div>
            </div>
          </section>`}
        </div>
      </div>`;
  }

  /* ---------- Page access: a card on the Staff page ---------- */
  function accessHtml() {
    const access = loadAccess();
    const rows = Object.keys(STAFF_ROLES).map((role) => {
      const on = new Set(access[role]);
      const locked = role === 'owner';
      return `<tr>
        <td>${rolePill(role)}</td>
        ${ACCESS_VIEWS.map((v) => `<td class="num"><input type="checkbox" data-act="access" data-role="${role}" data-page="${v}"${on.has(v) ? ' checked' : ''}${locked ? ' disabled' : ''} /></td>`).join('')}
      </tr>`;
    }).join('');

    return `
        <section class="bo-card blk-table">
          <div class="bo-card-head">
            <span class="bo-card-label">Page access</span>
            <span class="st-note">The sidebar hides what a role can't open; the server is what refuses it. Until the Worker is deployed this is cosmetic.</span>
          </div>
          <div class="bo-card-inset flush">
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Role</th>
              ${ACCESS_VIEWS.map((v) => `<th class="num">${v[0].toUpperCase() + v.slice(1)}</th>`).join('')}
            </tr></thead><tbody>${rows}</tbody></table></div>
          </div>
        </section>`;
  }

  /* ---------- Render ---------- */
  window.renderStaff = function () {
    const el = root();
    const staff = loadStaff();
    const sales = salesByName(state.orders);
    // Typing in the search box re-routes, which re-renders this whole view — put
    // the caret back where it was so the field keeps working.
    const caret = document.activeElement?.dataset?.act === 'q' ? document.activeElement.selectionStart : null;

    if (state.detailId) {
      const isNew = state.detailId === 'new';
      const person = isNew ? { ...STAFF_DEFAULTS, id: '' } : staff.find((u) => u.id === state.detailId);
      el.innerHTML = person ? personHtml(person, isNew, sales.get(person.name) || NONE)
        : head('That person no longer exists', '', '<button class="secondary-btn small" data-act="back">All staff</button>')
          + '<section class="bo-card blk-empty"><div class="bo-empty">Not found</div></section>';
      return;
    }

    el.innerHTML = peopleHtml(staff, state.invQuery, sales);
    const q = el.querySelector('[data-act="q"]');
    if (caret != null && q) { q.focus(); q.setSelectionRange(caret, caret); }
  };

  /* ---------- Events: one delegated listener per type ---------- */
  const owned = (e) => root() && root().contains(e.target) && !root().hidden;

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

  document.addEventListener('click', (e) => {
    if (!owned(e)) return;
    const el = e.target.closest('[data-act]');
    if (!el) {
      const row = e.target.closest('tr[data-id]');
      if (row) Router.go(VIEW, row.dataset.id);
      return;
    }
    const act = el.dataset.act;

    if (act === 'back') return Router.go(VIEW, '');
    if (act === 'archived') return Router.setParams({ archived: el.checked ? '1' : '', page: '' });
    if (act === 'add') return Router.go(VIEW, 'new');
    if (act === 'tx') {
      const u = loadStaff().find((x) => x.id === state.detailId);
      return u && Router.go('transactions', '', { range: '30d', staff: u.name });
    }
    if (act === 'exportCsv') {
      const sales = salesByName(state.orders);
      const rows = [['name', 'role', 'email', 'status', `revenue_${DAYS}d`, `sales_${DAYS}d`, `voids_${DAYS}d`, `refunds_${DAYS}d`]];
      loadStaff().forEach((u) => {
        const s = sales.get(u.name) || NONE;
        rows.push([u.name, roleName(u.role), u.email, u.active ? 'active' : 'archived', round2(s.revenue), s.sales, s.voids, s.refunds]);
      });
      return downloadCsv('staff.csv', rows);
    }
    if (act === 'access') {
      const map = loadAccess();
      const set = new Set(map[el.dataset.role]);
      el.checked ? set.add(el.dataset.page) : set.delete(el.dataset.page);
      map[el.dataset.role] = ACCESS_VIEWS.filter((v) => set.has(v));
      return saveAccess(map);   // the checkbox already shows the new state; no re-render
    }

    if (act === 'save' || act === 'toggleActive') {
      const form = readForm();
      if (!form.name) return showToast('Name is required');
      const list = loadStaff();
      const i = list.findIndex((u) => u.id === state.detailId);
      // Archive, never delete: an old sale names a cashier and that name has to resolve.
      if (act === 'toggleActive') form.active = !list[i].active;   // the button only shows on a saved person
      if (i < 0) {
        list.push({ ...STAFF_DEFAULTS, ...form, id: newId('u') });
      } else {
        list[i] = { ...list[i], ...form };
      }
      persist(list, act === 'toggleActive' ? (form.active ? 'Restored' : 'Archived') : 'Saved');
      // A new person has a new URL; everyone else just repaints in place.
      if (i < 0) Router.go(VIEW, ''); else renderCurrentView();
    }
  });
})();
