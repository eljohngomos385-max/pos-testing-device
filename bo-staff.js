/* Back office — Staff. Renders the whole .view[data-view="staff"]; see CONTRACT.
   Three tabs on one URL (/admin/staff?tab=…) plus /admin/staff/<id> for one person. */
(function () {
  const VIEW = 'staff';
  const root = () => document.querySelector(`.view[data-view="${VIEW}"]`);

  const TABS = { people: 'People', attendance: 'Attendance', payroll: 'Payroll', access: 'Page access' };
  (globalThis.HWPOS_SUBNAV = globalThis.HWPOS_SUBNAV || {}).staff = { param: 'tab', def: 'people', items: Object.entries(TABS) };
  const MARKS = ['present', 'late', 'halfday', 'dayoff', 'absent'];

  /* ---------- Pay maths (the only part of this file with a test) ----------
     A monthly salary and a daily rate are two numbers the owner keeps in his
     head; they are related by however many days he counts as a month. Six-day
     week = 26 in a PH hardware store, but that is a shop policy, not a law, so
     it is a field. Nothing here overwrites what was typed — dailyFromMonthly
     only ever feeds a suggestion. */
  const WORK_DAY_OPTIONS = [22, 24, 26, 30];
  const DEFAULT_WORK_DAYS = 26;
  const workDaysOf = (u) =>
    WORK_DAY_OPTIONS.includes(Number(u && u.workDays)) ? Number(u.workDays) : DEFAULT_WORK_DAYS;

  // Centavos in, one rounding at the end — same rule as bo-model.js.
  const dailyFromMonthly = (monthly, days) =>
    round2(cent(monthly) / (Number(days) || DEFAULT_WORK_DAYS) / 100);

  // The monthly salary wins when it is set, so the figure the owner typed is the
  // figure payroll shows. Only a day-rate-only person gets it multiplied up.
  const monthlyCost = (u) =>
    Number(u.salary) > 0 ? round2(u.salary) : round2(cent(u.salaryPerDay) * workDaysOf(u) / 100);

  const totalPayroll = (list) => round2(list.reduce((sum, u) => sum + cent(monthlyCost(u)), 0) / 100);

  // A half day is half a day's pay; a day off and an absence are neither worked nor paid.
  const WORKED = { present: 1, late: 1, halfday: 0.5, dayoff: 0, absent: 0 };
  function attendanceTotals(marks) {
    const t = { present: 0, late: 0, halfday: 0, dayoff: 0, absent: 0, days: 0 };
    for (const m of marks) {
      if (WORKED[m] === undefined) continue;
      t[m] += 1;
      t.days += WORKED[m];
    }
    return t;
  }
  // ponytail: an estimate for the owner's eyes, not a payroll run — no deductions,
  // no SSS/PhilHealth/Pag-IBIG, no overtime, no holiday premium.
  const payEstimate = (daysWorked, dailyRate) => round2(cent(dailyRate) * Number(daysWorked || 0) / 100);

  /* ---- What is left on payday ----
     The monthly salary is what the person is owed for a full month. Two things take
     from it and nothing else does: days they did not work, and money already handed
     to them. A day off is a rest day the shop gave, so it costs nothing; an absence
     costs a whole day at the daily rate and a half day costs half of one. */
  const unpaidDays = (t) => round2(Number(t.absent || 0) + Number(t.halfday || 0) * 0.5);
  const absenceCut = (days, dailyRate) => round2(cent(dailyRate) * Number(days || 0) / 100);

  // A cash advance is money already paid, so it comes off whatever is left. The result
  // is allowed below zero - someone who drew more than they earned owes the difference,
  // and flooring that at zero is how a shop loses money quietly.
  const netPay = (monthly, cut, advances) =>
    round2((cent(monthly) - cent(cut) - cent(advances)) / 100);

  /* ---- Clock in / out: real hours from hwpos.clock.v1 ----
     Rows are { ts, staffId, event: 'in'|'out' }; a day is the LOCAL date of ts, same as isoDate.
     In and out pair in time order. An 'in' still open at the end counts until `now` only when
     `date` is today; any other day it is left out of the hours and flagged `open`. An 'out'
     with no 'in' before it pairs with nothing and is counted in `strayOuts`. */
  const localDate = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function hoursWorked(clockEvents, staffId, date, now = Date.now()) {
    const rows = (clockEvents || [])
      .filter((e) => e.staffId === staffId && localDate(e.ts) === date)
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    const shifts = [];
    let openIn = null, strayOuts = 0;
    for (const e of rows) {
      // ponytail: a second 'in' while already in is a double tap, so the first one stands.
      if (e.event === 'in') { if (!openIn) openIn = e.ts; }
      else if (e.event === 'out') {
        if (openIn) { shifts.push({ in: openIn, out: e.ts }); openIn = null; } else strayOuts += 1;
      }
    }
    const open = !!openIn;
    if (open) shifts.push({ in: openIn, out: null });
    const untilNow = open && date === localDate(now);
    const ms = shifts.reduce((sum, s) =>
      sum + (s.out ? Date.parse(s.out) : untilNow ? now : Date.parse(s.in)) - Date.parse(s.in), 0);
    return { hours: round2(ms / 3600000), shifts, open, strayOuts };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WORK_DAY_OPTIONS, dailyFromMonthly, monthlyCost, totalPayroll, attendanceTotals,
      payEstimate, unpaidDays, absenceCut, netPay, hoursWorked };
  }
  if (typeof document === 'undefined') return;   // Node loads this file for the maths only

  /* ---------- Attendance store ----------
     One blob, { 'YYYY-MM-DD': { name: mark } }, keyed by NAME because that is what
     the dashboard card already reads. Read once per render, never per person. */
  const readAllAttendance = () => readJsonStorage(STORAGE_ATTENDANCE, {}) || {};

  function markAttendance(date, name, mark) {
    const all = readAllAttendance();
    // Merge into the day, never replace it: two people marked today must both survive.
    all[date] = { ...(all[date] || {}), [name]: mark };
    storageSet(STORAGE_ATTENDANCE, JSON.stringify(all));
  }

  /* ---------- Cash advances ----------
     One flat list, each row naming the person and the day the money was handed over.
     Append only, like every other money row here: a mistake is voided, never spliced
     out, because "we paid you 1,700 on the 12th" is a fact even when it was a typo. */
  const readAdvances = () => {
    const raw = readJsonStorage(STORAGE_ADVANCES, []);
    return Array.isArray(raw) ? raw : [];
  };
  const saveAdvances = (list) => storageSet(STORAGE_ADVANCES, JSON.stringify(list));

  // The advances that count against one month's pay for one person.
  const advancesFor = (list, staffId, month) =>
    list.filter((a) => a.staffId === staffId && !a.voided && String(a.date).startsWith(month));
  const advanceTotal = (list) => round2(list.reduce((sum, a) => sum + cent(a.amount), 0) / 100);

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
  const markPill = (m) => {
    const [tone, label] = ATTEND_LABEL[m] || ATTEND_LABEL.absent;
    return `<span class="status-pill ${tone}">${label}</span>`;
  };
  const dash = (v) => (v ? escapeHtml(v) : '<span class="muted">—</span>');
  // A card holding a table is a blk-table; the same card with nothing to list is a blk-empty.
  const tblCard = (has) => (has ? 'bo-card blk-table' : 'bo-card blk-empty');
  const dateText = (iso) => (iso ? new Date(iso + 'T00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' }) : '');


  const head = (title, back, actions) => `
    <header class="view-head">
      <div class="view-title-wrap">${back}<h1>${title}</h1></div>
      <div class="view-actions">${actions}</div>
    </header>`;

  /* ---------- Tab 1: People ---------- */
  function peopleHtml(staff, q, tab) {
    const needle = q.toLowerCase();
    const rows = needle
      ? staff.filter((u) => (u.name + ' ' + roleName(u.role) + ' ' + (u.phone || '')).toLowerCase().includes(needle))
      : staff;
    const active = staff.filter((u) => u.active);
    const pg = paginate(rows, Router.route().params.page);
    const body = rows.length ? pg.rows.map((u) => `
      <tr data-id="${escapeHtml(u.id)}">
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td>${rolePill(u.role)}</td>
        <td>${dash(u.phone)}</td>
        <td class="num">${peso(u.salary)}</td>
        <td class="num">${peso(u.salaryPerDay)}</td>
        <td>${u.startedAt ? escapeHtml(dateText(u.startedAt)) : '<span class="muted">—</span>'}</td>
        <td>${u.active ? '<span class="status-pill ok">Active</span>' : '<span class="status-pill muted">Inactive</span>'}</td>
      </tr>`).join('') : '';

    return head('Staff', '',
      `<button class="secondary-btn small" data-act="exportCsv">Export CSV</button>
       <button class="primary-btn small" data-act="add">Add staff</button>`) + `
      <div class="dash-stack">
        <section class="${tblCard(body)}">
          <div class="bo-card-head">
            <span class="bo-card-label">People</span>
            <input class="search-input small q-input" data-act="q" placeholder="Search staff…" autocomplete="off" value="${escapeHtml(q)}" />
            <span class="bo-card-sub">Payroll ${peso(totalPayroll(active))}/mo</span>
          </div>
          <div class="bo-card-inset flush">
            ${body ? `<div class="table-wrap"><table class="data-table"><thead><tr>
                <th>Name</th><th>Role</th><th>Phone</th><th class="num">Monthly salary</th>
                <th class="num">Daily rate</th><th>Start date</th><th>Status</th>
              </tr></thead><tbody>${body}</tbody></table></div>${pagerHtml(pg)}`
            : `<div class="bo-empty">${staff.length ? 'No staff match that search' : 'No staff yet. Add the first one.'}</div>`}
          </div>
        </section>
      </div>`;
  }

  /* ---------- The person editor ---------- */
  function personHtml(u, isNew, attendance) {
    const days = workDaysOf(u);
    const recent = [];
    // Newest first, last 14 days — one walk of the blob's keys, not a lookup per day.
    Object.keys(attendance).sort().reverse().forEach((date) => {
      if (recent.length >= 14) return;
      const mark = attendance[date][u.name];
      if (mark) recent.push([date, mark]);
    });

    const field = (label, name, value, type = 'text') =>
      `<div class="setting-row"><label>${label}</label>
        <input class="text-input${type === 'date' ? ' bo-date' : ''}" type="${type}" data-field="${name}" value="${escapeHtml(value)}" /></div>`;

    return head(isNew ? 'New staff' : escapeHtml(u.name), `<button class="link-btn" data-act="back">← All staff</button>`,
      `${isNew ? '' : `<button class="secondary-btn small${u.active ? ' danger' : ''}" data-act="toggleActive">${u.active ? 'Deactivate' : 'Reactivate'}</button>`}
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
              ${field('Phone', 'phone', u.phone, 'tel')}
              ${field('Email', 'email', u.email, 'email')}
              ${field('Start date', 'startedAt', u.startedAt || '', 'date')}
              <div class="setting-row"><label>Active</label>
                <input type="checkbox" data-field="active"${u.active ? ' checked' : ''} /></div>
            </div>
          </section>

          <section class="bo-card">
            <div class="bo-card-head"><span class="bo-card-label">Pay</span></div>
            <div class="bo-card-inset">
              <div class="setting-row"><label>Monthly salary</label>
                <span class="st-pair">
                  <input class="text-input" type="number" min="0" step="0.01" data-field="salary" value="${u.salary || ''}" />
                  <select class="bo-select" data-field="workDays" title="Working days per month">${WORK_DAY_OPTIONS
                    .map((d) => `<option value="${d}"${d === days ? ' selected' : ''}>${d} days/mo</option>`).join('')}</select>
                </span></div>
              <div class="setting-row st-stack"><span class="st-hint" data-role="payHint"></span></div>
              <div class="setting-row"><label>Salary per day</label>
                <input class="text-input" type="number" min="0" step="0.01" data-field="salaryPerDay" value="${u.salaryPerDay || ''}" /></div>
              <div class="setting-row"><label>Estimated monthly cost</label>
                <span class="num mono" data-role="monthlyCost">${peso(monthlyCost(u))}</span></div>
            </div>
          </section>
        </div>

        <section class="bo-card ${recent.length ? 'blk-list' : 'blk-empty'}">
          <div class="bo-card-head">
            <span class="bo-card-label">Attendance</span>
            <span class="bo-card-sub">Last ${recent.length} marked ${recent.length === 1 ? 'day' : 'days'} · mark on the Attendance tab</span>
          </div>
          <div class="bo-card-inset">
            ${recent.length ? `<div class="mini-list">${recent.map(([date, mark]) => `
              <div class="mini-list-row">
                <div class="ml-left"><span class="ml-name">${escapeHtml(dateText(date))}</span></div>
                ${markPill(mark)}
              </div>`).join('')}</div>`
            : '<div class="bo-empty">Nothing marked yet</div>'}
          </div>
        </section>
      </div>`;
  }

  // The hint is the only thing that updates without a re-render, so a keystroke
  // never steals the caret out of the field being typed in.
  function refreshPayHints() {
    const r = root();
    const val = (f) => Number(r.querySelector(`[data-field="${f}"]`)?.value) || 0;
    const monthly = val('salary'), daily = val('salaryPerDay');
    const days = Number(r.querySelector('[data-field="workDays"]')?.value) || DEFAULT_WORK_DAYS;
    const hint = r.querySelector('[data-role="payHint"]');
    if (!hint) return;
    const suggested = dailyFromMonthly(monthly, days);
    hint.innerHTML = !monthly
      ? 'Type a monthly salary and this suggests a daily rate.'
      : `${peso(monthly)} ÷ ${days} days = ${peso(suggested)}/day`
        + (Math.abs(suggested - round2(daily)) < 0.005 ? ' — matches the daily rate below.'
          : ` <button class="link-btn" data-act="useDaily" data-value="${suggested}">Use ${peso(suggested)}</button>`);
    r.querySelector('[data-role="monthlyCost"]').textContent =
      peso(monthlyCost({ salary: monthly, salaryPerDay: daily, workDays: days }));
  }

  /* ---------- Tab 2: Attendance ---------- */
  function attendanceHtml(staff, tab, date, all) {
    const roster = staff.filter((u) => u.active);
    const today = all[date] || {};
    // Same fallback as the dashboard card, so the two screens never disagree about
    // today. The month summary below counts real marks only — that one is the ledger.
    const isToday = date === isoDate(Date.now());
    const markOf = (u) => today[u.name] || (isToday ? u.attendance : '') || '';
    const inToday = roster.filter((u) => WORKED[markOf(u)] > 0).length;

    // One pass over the month, one Map — not a lookup per person per day.
    const month = date.slice(0, 7);
    const perName = new Map(roster.map((u) => [u.name, []]));
    for (const day of Object.keys(all)) {
      if (!day.startsWith(month)) continue;
      for (const [name, mark] of Object.entries(all[day])) perName.get(name)?.push(mark);
    }

    // Clocking is for today only: a past day's hours are a record, not a button.
    const clock = isToday ? loadEvents('clock') : [];
    const hm = (iso) => new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    const clockCell = (u) => {
      if (!isToday) return '';
      const h = hoursWorked(clock, u.id, date);
      const times = h.shifts.map((s) => `${hm(s.in)}–${s.out ? hm(s.out) : 'now'}`).join(', ');
      return `<span class="st-clock">
        <span class="st-clock-times">${times ? `${escapeHtml(times)} · ${h.hours} h` : '<span class="muted">Not clocked in</span>'}</span>
        <button class="secondary-btn small" data-act="clock" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.name)}"
          data-event="${h.open ? 'out' : 'in'}">${h.open ? 'Clock out' : 'Clock in'}</button>
      </span>`;
    };

    const rows = roster.map((u) => `
      <div class="setting-row">
        <label>${escapeHtml(u.name)} ${rolePill(u.role)}</label>
        ${clockCell(u)}
        <span class="seg">${MARKS.map((m) => `<button class="seg-btn${markOf(u) === m ? ' active' : ''}"
          data-act="mark" data-name="${escapeHtml(u.name)}" data-mark="${m}">${ATTEND_LABEL[m][1]}</button>`).join('')}</span>
      </div>`).join('');

    const summary = roster.map((u) => {
      const t = attendanceTotals(perName.get(u.name) || []);
      return `<tr>
        <td><strong>${escapeHtml(u.name)}</strong></td>
        <td class="num">${t.present}</td><td class="num">${t.late}</td><td class="num">${t.halfday}</td>
        <td class="num">${t.dayoff}</td><td class="num">${t.absent}</td>
        <td class="num">${t.days}</td>
        <td class="num">${peso(payEstimate(t.days, u.salaryPerDay))}</td>
      </tr>`;
    }).join('');

    return head(TABS.attendance, '', '') + `
      <div class="dash-stack">
        <section class="bo-card${rows ? '' : ' blk-empty'}">
          <div class="bo-card-head">
            <span class="bo-card-label">Mark attendance</span>
            <input type="date" class="bo-date" data-act="date" value="${escapeHtml(date)}" />
            <span class="bo-card-sub">${inToday} of ${roster.length} in</span>
          </div>
          <div class="bo-card-inset">${rows || '<div class="bo-empty">No active staff</div>'}</div>
        </section>

        <section class="${tblCard(summary)}">
          <div class="bo-card-head">
            <span class="bo-card-label">${escapeHtml(new Date(date + 'T00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }))}</span>
            <span class="st-note">Estimate only: daily rate × days worked, a half day counting 0.5. No deductions, overtime or government contributions.</span>
          </div>
          <div class="bo-card-inset flush">
            ${summary ? `<div class="table-wrap"><table class="data-table"><thead><tr>
              <th>Name</th><th class="num">Present</th><th class="num">Late</th><th class="num">Half</th>
              <th class="num">Off</th><th class="num">Absent</th><th class="num">Days worked</th><th class="num">Est. pay</th>
            </tr></thead><tbody>${summary}</tbody></table></div>` : '<div class="bo-empty">Nothing marked this month</div>'}
          </div>
        </section>
      </div>`;
  }

  /* ---------- Tab 3: Payroll ----------
     The one screen that answers "what do I hand this person on payday". Everything on
     it already lives somewhere else - the salary on the person, the absences in the
     attendance blob, the advances in their own list - so this tab only reads, apart
     from the advances it takes. */
  const monthName = (month) =>
    new Date(month + '-01T00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  function payrollLine(u, marks, advances, month) {
    const t = attendanceTotals(marks);
    const unpaid = unpaidDays(t);
    const cut = absenceCut(unpaid, u.salaryPerDay);
    const drawn = advanceTotal(advancesFor(advances, u.id, month));
    const gross = monthlyCost(u);
    return { u, unpaid, cut, drawn, gross, net: netPay(gross, cut, drawn) };
  }

  function payrollHtml(staff, tab, date, all, advances) {
    const month = date.slice(0, 7);
    const roster = staff.filter((u) => u.active);

    // One walk of the month, one Map - the same shape the attendance summary uses.
    const perName = new Map(roster.map((u) => [u.name, []]));
    for (const day of Object.keys(all)) {
      if (!day.startsWith(month)) continue;
      for (const [name, mark] of Object.entries(all[day])) perName.get(name)?.push(mark);
    }

    const lines = roster.map((u) => payrollLine(u, perName.get(u.name) || [], advances, month));
    const netTotal = round2(lines.reduce((sum, l) => sum + cent(l.net), 0) / 100);
    const drawnTotal = round2(lines.reduce((sum, l) => sum + cent(l.drawn), 0) / 100);
    const none = '<span class="muted">\u2014</span>';

    const rows = lines.map((l) => `
      <tr>
        <td><strong>${escapeHtml(l.u.name)}</strong></td>
        <td class="num">${peso(l.gross)}</td>
        <td class="num">${peso(l.u.salaryPerDay)}</td>
        <td class="num">${l.unpaid || none}</td>
        <td class="num${l.cut ? ' st-cut' : ''}">${l.cut ? '-' + peso(l.cut) : none}</td>
        <td class="num${l.drawn ? ' st-cut' : ''}">${l.drawn ? '-' + peso(l.drawn) : none}</td>
        <td class="num${l.net < 0 ? ' st-cut' : ''}"><strong>${peso(l.net)}</strong></td>
        <td class="num"><button class="secondary-btn small" data-act="ca" data-id="${escapeHtml(l.u.id)}">Advance</button></td>
      </tr>`).join('');

    const byId = new Map(staff.map((u) => [u.id, u.name]));
    const monthRows = advances
      .filter((a) => String(a.date).startsWith(month))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((a) => `
        <tr>
          <td>${escapeHtml(dateText(a.date))}</td>
          <td><strong>${escapeHtml(byId.get(a.staffId) || a.staffId)}</strong></td>
          <td class="num${a.voided ? ' st-void' : ''}">${peso(a.amount)}</td>
          <td>${dash(a.note)}</td>
          <td class="num">${a.voided ? '<span class="status-pill muted">Voided</span>'
            : `<button class="link-btn" data-act="voidCa" data-id="${escapeHtml(a.id)}">Void</button>`}</td>
        </tr>`).join('');

    return head(TABS.payroll, '', '') + `
      <div class="dash-stack">
        <section class="${tblCard(rows)}">
          <div class="bo-card-head">
            <span class="bo-card-label">Payroll · ${peso(netTotal)} to pay out</span>
            <input type="month" class="bo-date" data-act="month" value="${escapeHtml(month)}" />
            <span class="st-note">Salary, less days not worked, less cash already drawn. An absence
              costs a full day at the daily rate and a half day costs half; a day off costs nothing.</span>
          </div>
          <div class="bo-card-inset flush">
            ${rows ? `<div class="table-wrap"><table class="data-table"><thead><tr>
              <th>Name</th><th class="num">Monthly salary</th><th class="num">Daily rate</th>
              <th class="num">Unpaid days</th><th class="num">Less absences</th>
              <th class="num">Less advances</th><th class="num">Net pay</th><th class="num">Cash advance</th>
            </tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="bo-empty">No active staff</div>'}
          </div>
        </section>

        <section class="${tblCard(monthRows)}">
          <div class="bo-card-head">
            <span class="bo-card-label">Cash advances</span>
            <span class="bo-card-sub">${peso(drawnTotal)} drawn in ${escapeHtml(monthName(month))}</span>
            <button class="secondary-btn small" data-act="exportCa">Export CSV</button>
          </div>
          <div class="bo-card-inset flush">
            ${monthRows ? `<div class="table-wrap"><table class="data-table"><thead><tr>
              <th>Date</th><th>Name</th><th class="num">Amount</th><th>Reason</th><th class="num"></th>
            </tr></thead><tbody>${monthRows}</tbody></table></div>`
            : '<div class="bo-empty">Nothing drawn this month</div>'}
          </div>
        </section>
      </div>
      <dialog id="caDlg" class="bo-dialog adj-dlg"></dialog>`;
  }

  // Built and shown in one step, like the stock adjustment popup it is modelled on.
  function openAdvanceDialog(staffId, month) {
    const dlg = root().querySelector('#caDlg');
    const u = loadStaff().find((x) => x.id === staffId);
    if (!dlg || !u) return;
    const drawn = advanceTotal(advancesFor(readAdvances(), u.id, month));
    // Default into the month being paid, so an advance booked from an older month's
    // screen does not land on today and miss the payroll it belongs to.
    const today = isoDate(Date.now());
    const date = today.startsWith(month) ? today : month + '-01';
    dlg.innerHTML = `
      <div class="bod-head">
        <div class="bod-title"><h2>Cash advance \u2014 ${escapeHtml(u.name)}</h2></div>
        <button type="button" class="bod-close" aria-label="Close">&times;</button>
      </div>
      <div class="adj-body">
        <form class="adj-form" data-act="caForm" data-id="${escapeHtml(u.id)}">
          <div class="adj-grid">
            <label class="adj-field"><span>Amount</span>
              <input name="amount" type="number" min="0" step="0.01" inputmode="decimal" autocomplete="off" required></label>
            <label class="adj-field"><span>Date handed over</span>
              <input name="date" type="date" value="${escapeHtml(date)}" required></label>
            <label class="adj-field adj-note"><span>Reason</span>
              <input name="note" type="text" placeholder="What is it for?" autocomplete="off"></label>
          </div>
          <div class="adj-foot">
            <span class="adj-preview">Monthly salary ${peso(monthlyCost(u))}</span>
            <span class="adj-last">Already drawn ${peso(drawn)}</span>
            <button type="button" class="secondary-btn small" data-act="caCancel">Cancel</button>
            <button type="submit" class="primary-btn small">Record advance</button>
          </div>
        </form>
      </div>`;
    dlg.showModal();
    dlg.querySelector('input[name="amount"]').focus();
  }

  /* ---------- Tab 4: Page access ---------- */
  function accessHtml(tab) {
    const access = loadAccess();
    const rows = Object.keys(STAFF_ROLES).map((role) => {
      const on = new Set(access[role]);
      const locked = role === 'owner';
      return `<tr>
        <td>${rolePill(role)}</td>
        ${ACCESS_VIEWS.map((v) => `<td class="num"><input type="checkbox" data-act="access" data-role="${role}" data-page="${v}"${on.has(v) ? ' checked' : ''}${locked ? ' disabled' : ''} /></td>`).join('')}
      </tr>`;
    }).join('');

    return head(TABS.access, '', '') + `
      <div class="dash-stack">
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
        </section>
      </div>`;
  }

  /* ---------- Render ---------- */
  window.renderStaff = function () {
    const el = root();
    const { params } = Router.route();
    const tab = TABS[params.tab] ? params.tab : 'people';
    const staff = loadStaff();
    // Typing in the search box re-routes, which re-renders this whole view — put
    // the caret back where it was so the field keeps working.
    const caret = document.activeElement?.dataset?.act === 'q' ? document.activeElement.selectionStart : null;

    if (state.detailId) {
      const isNew = state.detailId === 'new';
      const person = isNew ? { ...STAFF_DEFAULTS, id: '' } : staff.find((u) => u.id === state.detailId);
      el.innerHTML = person ? personHtml(person, isNew, readAllAttendance())
        : head('That person no longer exists', '', '<button class="secondary-btn small" data-act="back">All staff</button>')
          + '<section class="bo-card blk-empty"><div class="bo-empty">Not found</div></section>';
      if (person) refreshPayHints();
      return;
    }

    if (tab === 'attendance') el.innerHTML = attendanceHtml(staff, tab, isoDate(state.anchor), readAllAttendance());
    else if (tab === 'payroll') el.innerHTML = payrollHtml(staff, tab, isoDate(state.anchor), readAllAttendance(), readAdvances());
    else if (tab === 'access') el.innerHTML = accessHtml(tab);
    else {
      el.innerHTML = peopleHtml(staff, state.invQuery, tab);
      const q = el.querySelector('[data-act="q"]');
      if (caret != null && q) { q.focus(); q.setSelectionRange(caret, caret); }
    }
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
      name: val('name'), role: val('role'), phone: val('phone'), email: val('email'),
      startedAt: val('startedAt'), workDays: Number(val('workDays')) || DEFAULT_WORK_DAYS,
      salary: round2(val('salary')), salaryPerDay: round2(val('salaryPerDay')),
      active: !!r.querySelector('[data-field="active"]')?.checked,
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

    if (act === 'ca') return openAdvanceDialog(el.dataset.id, isoDate(state.anchor).slice(0, 7));
    if (act === 'caCancel') return root().querySelector('#caDlg')?.close();
    if (act === 'voidCa') {
      const list = readAdvances();
      const a = list.find((x) => x.id === el.dataset.id);
      if (!a) return;
      a.voided = true;
      saveAdvances(list);
      showToast('Advance voided');
      return renderCurrentView();
    }
    if (act === 'exportCa') {
      const byId = new Map(loadStaff().map((u) => [u.id, u.name]));
      const rows = [['date', 'name', 'amount', 'reason', 'status']];
      readAdvances().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .forEach((a) => rows.push([a.date, byId.get(a.staffId) || a.staffId, a.amount, a.note || '',
          a.voided ? 'voided' : 'active']));
      return downloadCsv('cash-advances.csv', rows);
    }
    if (act === 'back') return Router.go(VIEW, '');
    if (act === 'add') return Router.go(VIEW, 'new');
    if (act === 'exportCsv') {
      const rows = [['name', 'role', 'phone', 'email', 'start_date', 'monthly_salary', 'daily_rate', 'status']];
      loadStaff().forEach((u) => rows.push([u.name, roleName(u.role), u.phone, u.email, u.startedAt || '',
        u.salary, u.salaryPerDay, u.active ? 'active' : 'inactive']));
      return downloadCsv('staff.csv', rows);
    }
    if (act === 'useDaily') {
      const input = root().querySelector('[data-field="salaryPerDay"]');
      input.value = el.dataset.value;
      return refreshPayHints();
    }
    if (act === 'mark') {
      markAttendance(isoDate(state.anchor), el.dataset.name, el.dataset.mark);
      return renderCurrentView();
    }
    if (act === 'clock') {
      const { id, name, event } = el.dataset;
      appendEvents('clock', [makeEvent({ staffId: id, staffName: name, event }, actor())]);
      // Clocking in means they are here, so an unmarked day becomes present. A mark someone
      // already set is left alone. ponytail: never 'late' — no shift start time is configured
      // anywhere; compare against one here once Settings grows it.
      const today = isoDate(Date.now());
      if (event === 'in' && !(readAllAttendance()[today] || {})[name]) markAttendance(today, name, 'present');
      showToast(`${name} clocked ${event}`);
      return renderCurrentView();
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
      // Deactivate, never delete: an old sale names a cashier and that name has to resolve.
      if (act === 'toggleActive') form.active = !form.active;
      if (i < 0) {
        list.push({ ...STAFF_DEFAULTS, ...form, id: newId('u') });
      } else {
        list[i] = { ...list[i], ...form };
      }
      persist(list, act === 'toggleActive' ? (form.active ? 'Reactivated' : 'Deactivated') : 'Saved');
      // A new person has a new URL; everyone else just repaints in place.
      if (i < 0) Router.go(VIEW, ''); else renderCurrentView();
    }
  });

  document.addEventListener('submit', (e) => {
    if (!owned(e) || e.target.dataset.act !== 'caForm') return;
    e.preventDefault();
    const f = new FormData(e.target);
    const amount = round2(f.get('amount'));
    if (!(amount > 0)) return showToast('Enter an amount');
    const list = readAdvances();
    list.push({
      id: newId('ca'), staffId: e.target.dataset.id, amount,
      date: String(f.get('date') || isoDate(Date.now())),
      note: String(f.get('note') || '').trim(),
      createdAt: new Date().toISOString(),
    });
    saveAdvances(list);
    root().querySelector('#caDlg')?.close();
    showToast(`Advance of ${peso(amount)} recorded`);
    renderCurrentView();
  });

  document.addEventListener('input', (e) => {
    if (owned(e) && e.target.dataset.field) refreshPayHints();
  });

  document.addEventListener('change', (e) => {
    if (!owned(e)) return;
    if (e.target.dataset.act === 'date') Router.setParams({ date: e.target.value });
    // The month picker names a month; everything else here works in days, so pin the 1st.
    else if (e.target.dataset.act === 'month') Router.setParams({ date: e.target.value + '-01' });
    else if (e.target.dataset.field) refreshPayHints();
  });
})();
