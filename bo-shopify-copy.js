// Lab copy only (backoffice-shopify.html): markup changes the shared modules can't take without
// changing the real back office. Each one re-applies after every render (owner 2026-10-19).
(function () {
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ‹ Customers / Name: the older "← Back" links (Customer, Stock history's full pages, Staff) become the path, like Categories.
  function crumbs() {
    document.querySelectorAll('.view-title-wrap .link-btn:not(.item-back)').forEach(function (a) {
      var t = a.textContent.trim();
      if (t.charAt(0) !== '←') return;
      a.textContent = t.slice(1).trim().replace(/^All /, '').replace(/^\w/, function (c) { return c.toUpperCase(); });
      a.classList.add('item-back');
    });
  }

  // Stock history's Movements / Price changes: search and picks leave the title row for Items' floating bar.
  // bo-inventory.js listens on document by id, so the moved controls keep working.
  function stockBar() {
    var q = document.querySelector('.view-inv .view-head #invSearch');
    if (!q) return;
    var head = q.closest('.view-head'), bar = document.createElement('div');
    bar.className = 'list-filters';
    head.querySelectorAll('#invSearch, .bo-select, .bo-date').forEach(function (el) { bar.appendChild(el); });
    head.after(bar);
  }

  // A supplier's contact details: one Items-style table instead of two loose lines under the name.
  function supplierInfo() {
    var c = document.querySelector('.view-suppliers .sup-contact');
    if (!c || c.querySelector('.link-btn')) return;   // the empty state keeps its "Add them"
    var id = (location.hash.match(/^#\/suppliers\/([^/?]+)/) || [])[1];
    var s = id && loadSuppliers().find(function (x) { return x.id === id; });
    if (!s) return;
    var cell = function (v, html) { return v ? (html || esc(v)) : '<span class="muted">—</span>'; };
    var t = document.createElement('section');
    t.className = 'bo-card blk-table sup-info';
    t.innerHTML = '<div class="bo-card-head"><span class="bo-card-label">Contact</span></div>' +
      '<div class="bo-card-inset flush"><table class="data-table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Notes</th></tr></thead>' +
      '<tbody><tr><td>' + cell(s.contact) + '</td>' +
      '<td>' + cell(s.phone, s.phone && '<a href="tel:' + esc(s.phone.replace(/\s+/g, '')) + '">' + esc(s.phone) + '</a>') + '</td>' +
      '<td>' + cell(s.email, s.email && '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>') + '</td>' +
      '<td>' + cell(s.address) + '</td><td>' + cell(s.note) + '</td></tr></tbody></table></div>';
    c.replaceWith(t);
  }

  // Pages with a view switch (Sales, Orders, Items): the page's name first, the switch beside it (owner 2026-10-19).
  // The name is the sidebar's, so the two always match.
  function switchTitle() {
    var seg = document.querySelector('.view.active .pd-switch'), nav = document.querySelector('.side-link.active');
    if (!seg || !nav || seg.previousElementSibling) return;
    var h = document.createElement('h1');
    h.textContent = nav.textContent.trim();
    seg.before(h);
  }
  // Customers and Suppliers: List | Breakdown like Orders. Breakdown is an empty page for now (owner 2026-10-19).
  // Customers keeps one header for list and record, so the switch comes off on a customer's page.
  function breakdownSwitch() {
    ['customers', 'suppliers'].forEach(function (name) {
      var v = document.querySelector('.view-' + name + '.active'), m = location.hash.match('^#/' + name + '(\\?.*)?$');
      if (!v) return;
      var seg = v.querySelector('.copy-switch'), bd = !!m && /[?&]view=breakdown\b/.test(m[1] || '');
      v.classList.toggle('is-breakdown', bd);
      if (!m) { if (seg) seg.remove(); return; }
      if (!seg) {
        var h = v.querySelector('.view-head .view-title-wrap h1');
        if (!h) return;
        seg = document.createElement('div');
        seg.className = 'seg pd-switch copy-switch';
        seg.setAttribute('aria-label', h.textContent.trim() + ' view');
        seg.innerHTML = '<a class="seg-btn" href="#/' + name + '">List</a><a class="seg-btn" href="#/' + name + '?view=breakdown">Breakdown</a>';
        h.after(seg);
      }
      seg.children[0].classList.toggle('active', !bd);
      seg.children[1].classList.toggle('active', bd);
    });
  }
  // Text chevrons ‹ › (View all, Settings rows, Sales' period arrows) become one drawn chevron at the text's
  // cap height (owner 2026-10-19, "C"); Sales › Items' hover chevron is the same shape in the css.
  var CHEV = '<svg class="chev" viewBox="0 0 6 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.25 1 4.75 4.5 1.25 8"/></svg>';
  function chevrons() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), hits = [];
    for (var n; (n = w.nextNode());) if (/[‹›]/.test(n.data) && n.parentElement.closest('a, button, .set-chev')) hits.push(n);
    hits.forEach(function (n) {
      var t = document.createElement('template');
      t.innerHTML = esc(n.data).replace(/[‹›]/g, function (c) { return c === '‹' ? CHEV.replace('chev"', 'chev back"') : CHEV; });
      n.replaceWith(t.content);
    });
  }
  function run() { crumbs(); stockBar(); supplierInfo(); switchTitle(); breakdownSwitch(); chevrons(); }
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  addEventListener('hashchange', run);
  run();
})();
