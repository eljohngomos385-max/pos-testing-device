// Viz lab by topic: the same cards as v2.html, regrouped so every design of one thing sits in one spot.
// topics.mjs pastes this at the end of v2-topics.html; the parts have drawn by then, so moving a card keeps its chart and clicks.
(() => {
  const PAGES = [
    ['Home', [
      ['overall', 'Overall outlook'],
      ['folder', 'Folder tab'],
      ['pay', 'Payment methods'],
      ['target', 'Targets'],
    ]],
    ['Sales', [
      ['cal', 'Calendar'],
      ['top', 'Top items'],
      ['staff', 'Staff'],
      ['cat', 'Categories'],
      ['pairs', 'Bought together'],
      ['avg', 'Average sale'],
      ['time', 'Sales over time'],
    ]],
    ['Orders breakdown', [
      ['page', 'The whole page'],
      ['ladder', 'Gross → net → profit'],
      ['funnel', 'Flows and funnels'],
      ['ful', 'Fulfilment'],
      ['hour', 'Orders: what time'],
    ]],
    ['Stock history', [
      ['outlook', 'Stock overall'],
      ['lost', 'Lost demand'],
      ['counts', 'Counts that didn’t match'],
      ['costs', 'Supplier cost changes'],
      ['moves', 'Movements'],
      ['price', 'Price changes'],
    ]],
    ['Customers', [['cust', 'Customer breakdown']]],
    ['Suppliers', [['supp', 'Supplier breakdown']]],
  ];
  // ponytail: sorted by the card's title band (plus a few by number); a new card with a new title lands in Other
  const topicOf = (id, tag, b) => {
    const has = (...w) => w.some(x => b.startsWith(x));
    if (/^N5-/.test(id)) return 'folder';
    if (/^Q7-/.test(id)) return 'overall';
    if (/^R7-/.test(id)) return 'cust';
    if (/^S7-/.test(id)) return 'supp';
    if (/^C2-1[12]$/.test(id)) return 'page';
    if (has('Average sale', 'Average ticket')) return 'avg';
    if (has('Payment')) return 'pay';
    if (has('Month target', 'Daily target', 'Days at the daily target', 'Days that hit')) return 'target';
    if (has('Net sales by day') && /calendar|month view/i.test(tag)) return 'cal';
    if (has('Top items', 'Top 10', 'Categories and their top items')) return 'top';
    if (has('Categories', 'Where net sales come from')) return 'cat';
    if (has('Staff', 'Voids and refunds')) return 'staff';
    if (has('Bought together')) return 'pairs';
    if (/Net =/.test(tag)) return 'ladder';
    if (has('Net sales','Average day', 'Daily net sales', 'How each')) return 'time';
    if (has('From gross', 'Where gross sales went')) return 'funnel';
    if (has('Gross', 'Taken off', 'Summary')) return 'ladder';
    if (has('Fulfilment')) return 'ful';
    if (has('Orders', 'Day\t')) return 'hour';
    if (has('Lost demand')) return 'lost';
    if (has('Counts that')) return 'counts';
    if (has('Supplier costs')) return 'costs';
    if (has('Movements', 'Moves by reason', 'Stock moves')) return 'moves';
    if (has('Price changes')) return 'price';
    if (has('Came in', 'Stock', 'Where it went', 'Where stock went', 'Back in')) return 'outlook';
    return 'other';
  };

  const main = document.querySelector('main.sheet');
  const old = [...main.querySelectorAll('section.cat')];
  const groups = {};
  for (const spec of main.querySelectorAll('.spec')) {
    const tag = spec.querySelector('.tag')?.innerText.trim() || '';
    const band = spec.querySelector('.card')?.innerText.split('\n')[0].trim() || '';
    (groups[topicOf(tag.split(/\s/)[0], tag, band)] ||= []).push(spec);
  }

  const nav = [];
  const section = (key, name, page) => {
    const specs = groups[key] || [];
    const s = document.createElement('section');
    s.className = 'cat'; s.id = 't-' + key;
    s.innerHTML = `<h2>${name} <span class="tp-n">${specs.length}</span></h2><p class="why">${page}</p>`;
    // keep each card in a grid like the one it came from (wide/normal), so it draws at the size it was built for
    let grid = null;
    for (const sp of specs) {
      const cls = sp.parentElement.className;
      if (!grid || grid.className !== cls) { grid = document.createElement('div'); grid.className = cls; s.append(grid); }
      grid.append(sp);
    }
    main.append(s);
    nav.push(`<a href="#t-${key}">${name}</a>`);
  };
  for (const [page, topics] of PAGES) {
    nav.push(`<span class="tp-page">${page}</span>`);
    for (const [key, name] of topics) section(key, name, page);
  }
  if (groups.other) { nav.push('<span class="tp-page">More</span>'); section('other', 'Other', 'Cards that fit none of the topics above'); }
  old.forEach(s => s.remove());

  const top = document.querySelector('.lab-top-in');
  top.querySelectorAll('a').forEach(a => a.remove());
  top.querySelector('h1').textContent = `Viz lab by topic · ${main.querySelectorAll('.spec').length}`;
  top.insertAdjacentHTML('beforeend', nav.join(''));
  document.head.insertAdjacentHTML('beforeend', `<style>
    .lab-top .tp-page { font-size: 11px; font-weight: 650; color: var(--ink-4); margin: 0 2px 0 10px; text-transform: uppercase; letter-spacing: .04em; }
    .lab-top .tp-page:first-of-type { margin-left: 0; }
    .cat > h2 .tp-n { font-size: 12px; font-weight: 500; color: var(--ink-4); margin-left: 4px; }
  </style>`);
  dispatchEvent(new Event('resize'));
})();
