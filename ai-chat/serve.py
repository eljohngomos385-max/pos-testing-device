#!/usr/bin/env python3
"""AI chat test: serves this folder and forwards POST /api/chat to Anthropic or DeepSeek, streaming the reply back.

The key lives here, in ~/.pos-lab/<provider>-key.txt (outside the repo), and never goes back to a page. It is pasted
once on this computer; a phone reaching this through a Cloudflare tunnel chats with it but can't read or change it.
The browser can't call DeepSeek directly anyway (CORS), so the proxy is needed.

ponytail: a lab proxy. Anyone with the tunnel link can chat on the key, so it stops after LIMIT asks per run
(restart to reset). The real app calls the AI from the hosted back end, per store, behind sign-in.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
KEY_DIR = os.path.join(os.path.expanduser('~'), '.pos-lab')   # the Anthropic one is shared with scripts/ask-serve.py
LIMIT = 300
used = 0
URLS = {'anthropic': 'https://api.anthropic.com/v1/messages',
        'deepseek': 'https://api.deepseek.com/chat/completions'}
DEMO = '''## Streaming check

This reply has **bold**, *italic*, `inline code` and a [link](https://github.com/thetarnav/streaming-markdown).

1. A numbered list
2. That builds **while it streams**
   - with a nested point

| Item | Sold | Sales |
|---|---:|---:|
| Latex Paint Red 1L | 12 | 2,850.00 |
| Hammer 16oz | 4 | 1,120.00 |

```js
const total = items.reduce((s, i) => s + i.price * i.qty, 0)
```

> A quote, then a rule.

---

Done.'''


def key_file(provider):
    return os.path.join(KEY_DIR, provider + '-key.txt')


def api_key(provider):
    try:
        with open(key_file(provider), encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


class Handler(SimpleHTTPRequestHandler):
    def local(self):
        # cloudflared adds Cf-Connecting-IP to everything it brings in, so only this computer lacks it
        return 'Cf-Connecting-IP' not in self.headers

    def send_json(self, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/keys':   # which keys are saved, never the keys themselves
            return self.send_json({'local': self.local(), **{p: bool(api_key(p)) for p in URLS}})
        super().do_GET()

    def fail(self, code, text):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def demo(self):
        # a canned answer in OpenAI-style SSE, a few characters at a time, to watch the markdown build with no key
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()
        think = 'They want every kind of markdown, so: a heading, a list, a table, code and a quote.'
        pieces = [{'reasoning_content': think[i:i + 6]} for i in range(0, len(think), 6)]
        pieces += [{'content': DEMO[i:i + 4]} for i in range(0, len(DEMO), 4)]
        if 'search' in json.dumps(self.ask.get('messages', [])[-1:]).lower():   # cat/ shows a search; other pages skip it
            pieces.insert(0, {'search': 'hammer prices'})
        time.sleep(0.6)   # a moment before the first byte, like a real model
        for d in pieces:
            ev = {'choices': [{'delta': d}]}
            try:
                self.wfile.write(b'data: ' + json.dumps(ev).encode('utf-8') + b'\n\n')
                self.wfile.flush()
            except OSError:
                return
            time.sleep(1.5 if 'search' in d else 0.02)

    def do_POST(self):
        global used
        n = int(self.headers.get('Content-Length') or 0)
        if not 0 < n <= 600_000:
            return self.fail(413, 'That is too much to send.')
        try:
            ask = json.loads(self.rfile.read(n))
            provider = ask['provider']
        except (ValueError, KeyError, TypeError):
            return self.fail(400, 'Bad request.')
        if self.path == '/api/key':
            if not self.local():
                return self.fail(403, 'Save the key on the computer that runs the chat.')
            if provider not in URLS or not str(ask.get('key', '')).strip():
                return self.fail(400, 'Bad request.')
            os.makedirs(KEY_DIR, exist_ok=True)
            with open(key_file(provider), 'w', encoding='utf-8') as f:
                f.write(str(ask['key']).strip())
            return self.send_json({'ok': True})
        if self.path != '/api/chat':
            return self.send_error(404)
        if provider == 'demo':
            self.ask = ask
            return self.demo()
        if provider not in URLS or not isinstance(ask.get('messages'), list):
            return self.fail(400, 'Bad request.')
        url, key = URLS[provider], api_key(provider)
        if not key:
            return self.fail(503, 'No ' + provider + ' key saved yet. Paste it on the computer that runs the chat.')
        if used >= LIMIT:
            return self.fail(429, 'The chat has used its ' + str(LIMIT) + ' questions for this run. Restart serve.py.')
        used += 1
        if provider == 'anthropic':
            body = {'model': ask['model'], 'max_tokens': 4096, 'stream': True, 'messages': ask['messages']}
            head = {'x-api-key': key, 'anthropic-version': '2023-06-01'}
        else:
            body = {'model': ask['model'], 'stream': True, 'messages': ask['messages']}
            if ask.get('thinking') in ('enabled', 'disabled'):
                body['thinking'] = {'type': ask['thinking']}   # deepseek-flash thinks unless told not to
            head = {'Authorization': 'Bearer ' + key}
        req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'),
                                     headers={**head, 'content-type': 'application/json'})
        try:
            res = urllib.request.urlopen(req, timeout=300)
        except urllib.error.HTTPError as e:
            return self.fail(e.code, e.read().decode('utf-8', 'replace'))
        except OSError as e:
            return self.fail(502, 'Could not reach ' + provider + ': ' + str(e))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()
        with res:
            for line in res:   # pass the provider's SSE through as-is; the page reads both formats
                try:
                    self.wfile.write(line)
                    self.wfile.flush()
                except OSError:
                    return     # the page stopped or closed


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8677
    print(f'AI chat  http://127.0.0.1:{port}/  (keys saved: {", ".join(p for p in URLS if api_key(p)) or "none"})')
    ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=HERE)).serve_forever()
