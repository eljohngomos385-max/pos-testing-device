/* ==========================================================
   Hardware POS — Router
   ----------------------------------------------------------
   Real URLs. The address bar IS the app state:

     /admin/products?q=pvc&category=plumbing
     /admin/products/p001
     /admin/sales?range=30d&date=2026-09-05

   A link reproduces exactly what the sender was looking at, refresh lands in
   the same place, and back/forward walk the filters. Needs the server to serve
   the shell for unmatched /admin paths (see scripts/serve.py).

   Usage:
     HWPOS_ROUTER.start(onRoute)        // fires immediately + on every change
     HWPOS_ROUTER.route()               // { view, id, params }
     HWPOS_ROUTER.go('products', 'p001')
     HWPOS_ROUTER.setParams({ range: '7d' })   // merge into the query string
     HWPOS_ROUTER.href('sales', '', { range: '30d' })
   ========================================================== */
(function () {
  'use strict';

  const BASE = '/admin';

  // ponytail: opened straight off disk (file://) or as /backoffice.html there is no
  // server rewriting paths, so fall back to the hash and keep working. Delete this
  // branch once the app is only ever reached through a real host.
  const usePath = location.protocol !== 'file:' && !/\.html?$/i.test(location.pathname);

  let listener = null;
  let last = null;

  // Current route as a plain "/view/id?query" string, whichever mode we're in.
  function raw() {
    if (usePath) {
      const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
      return (p || '/') + location.search;
    }
    return '/' + location.hash.replace(/^#\/?/, '');
  }

  function route() {
    const [path, query = ''] = raw().split('?');
    const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    // Everything after the view is the id, slashes included, so a page can own a real
    // multi-segment path (/admin/inventory/adjust/new) instead of a %2F in the address bar.
    return { view: seg[0] || '', id: seg.slice(1).join('/'), params };
  }

  // Empty values are dropped, so a cleared filter leaves the URL clean.
  function href(view, id, params) {
    const path = '/' + [view, id].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
    const pairs = Object.entries(params || {}).filter(([, v]) => v !== '' && v != null);
    const query = new URLSearchParams(pairs).toString();
    const head = usePath ? BASE + path : location.pathname + '#' + path;
    return head + (query ? '?' + query : '');
  }

  function fire() {
    const url = raw();
    if (url === last) return;
    last = url;
    if (listener) listener(route());
  }

  function go(view, id, params, opts) {
    const url = href(view, id, params);
    // Same URL, nothing to push — but still repaint if the caller asked.
    if (url !== location.pathname + location.search + location.hash) {
      history[opts && opts.replace ? 'replaceState' : 'pushState']({}, '', url);
    }
    fire();
  }

  // Merge into the current query string without leaving the page. Filter changes
  // replace by default: typing in a search box should not fill up the back button.
  function setParams(patch, opts) {
    const cur = route();
    const next = { ...cur.params };
    Object.entries(patch).forEach(([k, v]) => {
      if (v === '' || v == null) delete next[k];
      else next[k] = String(v);
    });
    go(cur.view, cur.id, next, { replace: !opts || opts.replace !== false });
  }

  function start(onRoute) {
    listener = onRoute;
    window.addEventListener('popstate', fire);
    if (!usePath) window.addEventListener('hashchange', fire);

    // In-app links navigate without a page load; anything else behaves normally.
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.hasAttribute('data-jump') || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const url = new URL(a.getAttribute('href'), location.href);
      if (url.origin !== location.origin) return;
      if (usePath ? !url.pathname.startsWith(BASE) : url.pathname !== location.pathname) return;
      e.preventDefault();
      history.pushState({}, '', url.pathname + url.search + url.hash);
      fire();
    });

    fire();
  }

  window.HWPOS_ROUTER = { start, route, go, setParams, href, get usePath() { return usePath; } };
})();
