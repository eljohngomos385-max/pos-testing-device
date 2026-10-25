// Style diff: does page A look like page B? Compares EVERY computed CSS property (plus x / width / height)
// of matching parts on two back office views and lists each difference. Run it in the page console:
//   const { diffViews, TABLE_PAIRS } = await import('/scripts/style-diff.js');
//   console.table(await diffViews('transactions', 'products', TABLE_PAIRS.ordersVsItems));
// A pair is [part name, selector on view A, selector on view B]. Empty result = the two match.

const NOISE = new Set(['inline-size', 'block-size', 'perspective-origin', 'transform-origin', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y']);
const wait = ms => new Promise(r => setTimeout(r, ms));

function snap(pairs, side) {
  const out = {};
  for (const p of pairs) {
    const el = document.querySelector(p[side]);
    if (!el) { out[p[0]] = null; continue; }
    const c = getComputedStyle(el), r = el.getBoundingClientRect(), s = {};
    for (const k of c) if (!k.startsWith('--') && !NOISE.has(k)) s[k] = c.getPropertyValue(k);
    s['@x'] = Math.round(r.x); s['@w'] = Math.round(r.width); s['@h'] = Math.round(r.height);
    out[p[0]] = s;
  }
  return out;
}

async function show(view) {   // a side-bar view name, or a hash for a sub-view ('#/products?view=stock')
  if (view.startsWith('#')) location.hash = view;
  else document.querySelector(`.side-link[data-view="${view}"]`).click();
  await wait(900);
}

export async function diffViews(viewA, viewB, pairs, { skipWidth = [] } = {}) {
  await show(viewA); const a = snap(pairs, 1);
  await show(viewB); const b = snap(pairs, 2);
  await show(viewA);
  const rows = [];
  for (const [name] of pairs) {
    if (!a[name] || !b[name]) { rows.push({ part: name, prop: 'MISSING', [viewA]: !!a[name], [viewB]: !!b[name] }); continue; }
    for (const k of new Set([...Object.keys(a[name]), ...Object.keys(b[name])])) {
      if (skipWidth.includes(name) && (k === '@w' || k === 'width')) continue;
      if (a[name][k] !== b[name][k]) rows.push({ part: name, prop: k, [viewA]: a[name][k], [viewB]: b[name][k] });
    }
  }
  return rows;
}

// Role check: every cell of one role (name, plain, money, …) must look the same on every table.
//   const { roleCheck, TABLE_ROLES } = await import('/scripts/style-diff.js');
//   console.table(await roleCheck(TABLE_ROLES));   // empty = every role is one look everywhere
// A table: [view, row selector, header selector, {column number: role}, {role: extra selector inside the view}].
const TYPE = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'letter-spacing'];
export async function roleCheck(tables) {
  const seen = {}, rows = [];
  const take = (role, where, el, num) => {
    if (!el) { rows.push({ role, where, prop: 'MISSING' }); return; }
    const c = getComputedStyle(el), s = Object.fromEntries(TYPE.map(k => [k, c.getPropertyValue(k)]));
    s['font-family'] = s['font-family'].split(',')[0];   // the font that renders; some sheets repeat the fallbacks
    if (num !== undefined && c.fontVariantNumeric !== (num ? 'tabular-nums' : 'normal')) rows.push({ role, where, prop: 'figures', got: c.fontVariantNumeric });
    if (!seen[role]) { seen[role] = { where, s }; return; }
    for (const k of TYPE) if (s[k] !== seen[role].s[k]) rows.push({ role, where, prop: k, got: s[k], want: seen[role].s[k], ref: seen[role].where });
  };
  for (const [view, rowSel, thSel, cols, extra = {}] of tables) {
    await show(view);
    const tr = document.querySelector(rowSel);
    if (!tr) { rows.push({ role: '-', where: view, prop: 'NO ROW' }); continue; }
    take('header', `${view} th`, document.querySelector(thSel));
    for (const [n, role] of Object.entries(cols)) {
      const td = tr.children[n - 1], el = td && (td.querySelector(':scope > strong') || td);
      take(role, `${view} col ${n}`, el, td ? td.matches('.n, .num') : undefined);
    }
    for (const [role, sel] of Object.entries(extra)) take(role, `${view} ${sel}`, document.querySelector(sel));
  }
  return rows;
}

export const TABLE_ROLES = [
  ['products', '.view-products .pd-row', '.view-products .data-table th:nth-child(5)',
    { 3: 'name', 4: 'faint', 5: 'plain', 6: 'plain', 7: 'plain', 8: 'money', 9: 'plain', 10: 'plain' },
    { note: '.view-products .pd-vcount' }],
  ['#/products?view=stock', '[data-pd-view="stock"] .pd-row', '[data-pd-view="stock"] th:nth-child(3)',
    { 2: 'name', 3: 'plain', 4: 'plain', 5: 'money', 6: 'plain' },
    { note: '[data-pd-view="stock"] .pd-vcount' }],
  ['transactions', '.view-tx .tx tr[data-receipt]:not(.dim)', '.view-tx .tx th:nth-child(3)',
    { 1: 'name', 2: 'plain', 3: 'plain', 4: 'plain', 5: 'plain', 8: 'money' },
    { faint: '.view-tx .tx tr[data-receipt]:not(.dim) td.cust .mut' }],
  ['dashboard', '.calm-dash .tx tr[data-receipt]:not(.dim)', '.calm-dash .tx th:nth-child(2)',
    { 1: 'name', 2: 'plain', 4: 'plain', 5: 'plain', 8: 'money' },
    { faint: '.calm-dash .tx tr[data-receipt]:not(.dim) td.cust .mut' }],
  ['customers', '.view-customers .data-table tbody tr', '.view-customers .data-table th:nth-child(2)',
    { 1: 'name', 2: 'plain', 3: 'plain', 4: 'money', 5: 'plain', 6: 'plain', 7: 'plain' },
    { faint: '.view-customers .data-table td .muted' }],
  ['sales', '.calm-sales section.top tr:not(:has(th))', '.calm-sales section.top th.qty',
    { 1: 'name', 2: 'plain', 3: 'money', 4: 'plain' },
    { note: '.calm-sales section.top .nm small' }],
];

// Parts every list page shares. Cells whose width follows their content are compared without width.
export const TABLE_PAIRS = {
  ordersVsItems: [
    ['page',        '.view-tx .c-main',                    '.view-products'],
    ['head row',    '.view-tx .bar',                       '.view-products .view-head'],
    ['tabs',        '.view-tx .bar .seg',                  '.view-products .view-head .seg'],
    ['tab',         '.view-tx .bar .seg > *',              '.view-products .view-head .seg > *'],
    ['light button','.view-tx .bar > .btn',                '.view-products .view-actions > .secondary-btn'],
    ['filter bar',  '.view-tx .filters',                   '.view-products .list-filters'],
    ['search',      '.view-tx .filters input',             '.view-products .list-filters input'],
    ['filter',      '.view-tx .filters .pick',             '.view-products .list-filters .ms-pick > summary'],
    ['card',        '.view-tx .card',                      '.view-products .blk-table'],
    ['card title',  '.view-tx .head',                      '.view-products .bo-card-head'],
    ['title word',  '.view-tx .head .lbl',                 '.view-products .bo-card-label'],
    ['title count', '.view-tx .head .sum',                 '.view-products .bo-card-sub'],
    ['table',       '.view-tx .tx',                        '.view-products .data-table'],
    ['header cell', '.view-tx .tx th:nth-child(3)',        '.view-products .data-table th:nth-child(5)'],
    ['row',         '.view-tx .tx tr[data-receipt]:not(.dim)', '.view-products .data-table .pd-row'],
    ['key cell',    '.view-tx .tx tr[data-receipt]:not(.dim) td.id', '.view-products .data-table .pd-row > td:nth-child(3)'],
    ['plain cell',  '.view-tx .tx tr[data-receipt]:not(.dim) td:nth-child(4)', '.view-products .data-table .pd-row > td:nth-child(5)'],
    ['staff cell',  '.view-tx .tx tr[data-receipt]:not(.dim) td:nth-child(4)', '.view-products .data-table .pd-row > td:nth-child(5)'],
    ['fulfil cell', '.view-tx .tx tr[data-receipt]:not(.dim) td:nth-child(5)', '.view-products .data-table .pd-row > td:nth-child(6)'],
    ['time cell',   '.view-tx .tx tr[data-receipt]:not(.dim) td.t', '.view-products .data-table .pd-row > td:nth-child(5)'],
    ['empty dash',  '.view-tx .tx tr[data-receipt]:not(.dim) td.cust .mut', '.view-products .data-table .pd-row > td.mono'],
    ['money cell',  '.view-tx .tx tr[data-receipt]:not(.dim) td.amt', '.view-products .data-table .pd-row > td:nth-child(8)'],
    ['pill',        '.view-tx .tx tr[data-receipt]:not(.dim) .pill', '.view-products .data-table .pd-row .status-pill'],
    ['pager',       '.view-tx .pager',                     '.view-products .bo-pager'],
    ['pager button','.view-tx .pager .icon-btn:not([disabled])', '.view-products .bo-pager .bo-page-btn:not([disabled]):not(.on)'],
  ],
};
