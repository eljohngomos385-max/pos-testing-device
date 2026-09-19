#!/usr/bin/env python3
"""Dev server with SPA fallback — what nginx/Netlify will do in production.

Real files are served as-is. Anything under /admin that has no file extension
falls back to backoffice.html, so /admin/products/p001 survives a refresh and a
pasted link exactly the way it will once this is hosted.

ponytail: 30 lines of stdlib instead of a dev-server dependency. In production
this is one `try_files $uri /backoffice.html;` line, or a Netlify _redirects rule:
    /admin/*  /backoffice.html  200
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELLS = {'/admin': 'backoffice.html'}


class SPAHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        full = super().translate_path(path)
        if os.path.isfile(full):
            return full
        clean = path.split('?', 1)[0].split('#', 1)[0]
        # A route has no file extension; a missing asset should stay a 404 so
        # a typo'd <script src> doesn't silently serve HTML.
        if '.' in clean.rsplit('/', 1)[-1]:
            return full
        for prefix, shell in SHELLS.items():
            if clean == prefix or clean.startswith(prefix + '/'):
                return os.path.join(ROOT, shell)
        return full

    def end_headers(self):
        # Dev only: makes ?v=NN cache-busting unnecessary while iterating.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '" 200' not in (fmt % args):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f'POS    http://localhost:{port}/')
    print(f'Admin  http://localhost:{port}/admin')
    ThreadingHTTPServer(('', port), partial(SPAHandler, directory=ROOT)).serve_forever()
