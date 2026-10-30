#!/usr/bin/env python3
"""pos-thin's own dev server — this folder only, threaded, no-store.

Same lessons as scripts/serve.py: the app asks for ~20 files at once, and a single-threaded
http.server refuses the rest of them on Windows, which cloudflared turns into 502s. And on a
phone there is no hard reload, so every response says no-store: an edit lands on the next tap.

    python _serve.py 8650      ->   http://127.0.0.1:8650/
"""
import functools
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))


class Quiet(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass   # a tunnel's traffic would bury every other line


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8650
    ThreadingHTTPServer.request_queue_size = 128
    print(f'pos-thin  http://127.0.0.1:{port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Quiet, directory=HERE)).serve_forever()
