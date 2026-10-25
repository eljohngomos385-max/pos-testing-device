// Viz lab by page: the owner's picks put where they'd sit in the back office, one shape kit everywhere
// (donut, side bars, funnel, sankey). pages.mjs pastes this at the end of v2-pages.html; cards move, they aren't copied.
(() => {
  // [page, note, [[row title, grid class, ids]]]
  const PAGES = [
    ['Home', 'Small and fast: top 5 + Other, short rows.', [
      ['Numbers', 'grid full', ['N5-7']],
      ['Cards', 'pg-small', ['T8-6', 'T8-1', 'T8-3', 'T8-4', 'T8-5']],
    ]],
    ['Sales', 'The bigger blocks.', [
      ['Over time · stacked columns', 'grid full', ['P6-1']],
      ['Top items · side bars', 'grid full', ['D2-6']],
      ['Categories · side bars, then the table', 'grid wide', ['D2-10', 'D2-15']],
      ['Payment methods · donut, staff · side bars with no colour each', 'grid wide', ['H3-16', 'T8-8']],
    ]],
    ['Orders breakdown', 'Where gross sales went.', [
      ['Gross → profit · funnel', 'grid wide', ['O6-2', 'O6-1']],
      ['What time · stacked columns', 'grid wide', ['P6-4', 'P6-5']],
    ]],
    ['Stock history', 'Where the stock went.', [
      ['Opening → kept · funnel, came in → went out · sankey', 'grid wide', ['O6-3', 'E2-11']],
      ['Movements · table', 'grid full', ['M4-3']],
    ]],
    ['Customers', 'Who buys, who owes.', [
      ['Where net sales came from · sankey', 'grid full', ['U8-1']],
      ['By type · donut, top customers · side bars', 'grid wide', ['U8-2', 'U8-3']],
      ['Account money · funnel, owed · side bars', 'grid wide', ['U8-4', 'U8-5']],
    ]],
    ['Suppliers', 'What we buy, what we owe.', [
      ['Where the buying went · sankey', 'grid full', ['U8-6']],
      ['By category · donut, per supplier · side bars', 'grid wide', ['U8-7', 'U8-8']],
      ['What we owe · side bars, POs · funnel', 'grid wide', ['U8-9', 'U8-10']],
    ]],
  ];

  const main = document.querySelector('main.sheet');
  const byId = {};
  for (const spec of main.querySelectorAll('.spec')) byId[spec.querySelector('.tag b')?.textContent.trim()] = spec;
  const old = [...main.querySelectorAll('section.cat')];

  const nav = [];
  PAGES.forEach(([page, note, rows], i) => {
    const s = document.createElement('section');
    s.className = 'cat'; s.id = 'pg-' + i;
    s.innerHTML = `<h2>${page}</h2><p class="why">${note}</p>`;
    for (const [title, cls, ids] of rows) {
      const grid = document.createElement('div');
      grid.className = cls;
      for (const id of ids) {
        if (byId[id]) grid.append(byId[id]);
        else grid.insertAdjacentHTML('beforeend', `<div class="spec"><div class="tag"><b>${id}</b> not built yet</div></div>`);
      }
      s.insertAdjacentHTML('beforeend', `<h3 class="pg-row">${title}</h3>`);
      s.append(grid);
    }
    main.append(s);
    nav.push(`<a href="#pg-${i}">${page}</a>`);
  });
  // ponytail: unpicked cards park off-screen at full width, not removed - their resize handlers still draw, and a 0px card draws negative widths
  const park = document.createElement('div');
  park.style.cssText = 'position:absolute;left:-20000px;top:0;width:1400px;visibility:hidden';
  park.setAttribute('aria-hidden', 'true');
  park.append(...old);
  document.body.append(park);

  const top = document.querySelector('.lab-top-in');
  top.querySelectorAll('a').forEach(a => a.remove());
  top.querySelector('h1').textContent = 'Viz lab by page';
  top.insertAdjacentHTML('beforeend', nav.join(''));
  document.head.insertAdjacentHTML('beforeend', `<style>
    .pg-small { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; align-items: start; }
    .cat h3.pg-row { font-size: 13px; font-weight: 600; color: var(--ink-3); margin: 24px 0 8px; }
  </style>`);
  dispatchEvent(new Event('resize'));
})();
