#!/usr/bin/env python3
"""The lab's static server (serve.py's) plus POST /api/ask: the Ask test (pos-lab/sky-lab.html) talks to Claude here.

The API key never reaches a page. It is read from ANTHROPIC_API_KEY or ~/.pos-lab/anthropic-key.txt, outside the
folder this serves. The model, the instructions and the reply size are fixed here; the page sends only the chat and
a snapshot of the store's data. Claude's stream comes back as plain text, so the page just appends what arrives.

ponytail: a lab proxy. Anyone with the tunnel link can use it, so it stops after LIMIT asks per run (restart to reset).
The real app would call this from the hosted back end, per store, behind sign-in.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from functools import partial
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import ROOT, SPAHandler  # noqa: E402

KEY_FILE = os.path.join(os.path.expanduser('~'), '.pos-lab', 'anthropic-key.txt')
MODEL = 'claude-sonnet-5-5'
LIMIT = 300
used = 0

RULES = """You are Ask, the assistant inside a point-of-sale app. You answer the store owner's questions about their own store, using only the data below. Today's numbers come from the app's own maths: use the figures in SUMMARY as they are, never re-add them. For anything else, work it out from ORDERS and ITEMS and say briefly how.

Write short and plain: a one-line answer first, then a few lines or a small list if needed. No greetings, no filler. Money in the store's currency with its symbol, as in the data.

When a chart helps (a ranking, a split, a trend), add one fenced block instead of a long list:
```chart
{"type": "bars", "title": "Top items this week", "note": "by sales", "unit": "money", "rows": [{"label": "Latex Paint Red 1L", "value": 2850}]}
```
type: "bars" (a ranking, up to 10 rows), "donut" (parts of a whole, up to 6 rows), or "columns" (over time, oldest first, label = short day or hour like "Mon" or "Oct 14"). unit: "money" or "count". At most one chart per answer, valid JSON only, numbers without symbols. Tables in markdown are fine for small lists of facts.

If the data cannot answer it, say so in one line."""


def api_key():
    k = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if not k and os.path.isfile(KEY_FILE):
        with open(KEY_FILE, encoding='utf-8') as f:
            k = f.read().strip()
    return k


class AskHandler(SPAHandler):
    def reply(self, code, text):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        global used
        if self.path.split('?', 1)[0] != '/api/ask':
            return self.send_error(404)
        n = int(self.headers.get('Content-Length') or 0)
        if not 0 < n <= 600_000:
            return self.reply(413, 'That is too much to send.')
        key = api_key()
        if not key:
            return self.reply(503, 'Ask has no API key yet. Put it in ' + KEY_FILE + ' and ask again.')
        if used >= LIMIT:
            return self.reply(429, 'Ask has used its ' + str(LIMIT) + ' questions for this run. Restart the lab server.')
        try:
            ask = json.loads(self.rfile.read(n))
            msgs = [{'role': m['role'], 'content': str(m['content'])[:4000]} for m in ask['messages'][-20:]
                    if m.get('role') in ('user', 'assistant')]
            data = str(ask.get('data', ''))[:500_000]
        except (ValueError, KeyError, TypeError):
            return self.reply(400, 'Bad request.')
        if not msgs or msgs[-1]['role'] != 'user':
            return self.reply(400, 'Bad request.')
        used += 1
        body = {'model': MODEL, 'max_tokens': 2048, 'stream': True, 'messages': msgs,
                # the data block is cached, so a follow-up question doesn't pay for the whole store again
                'system': [{'type': 'text', 'text': RULES}, {'type': 'text', 'text': data, 'cache_control': {'type': 'ephemeral'}}]}
        req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps(body).encode('utf-8'), headers={
            'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
        try:
            res = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get('error', {}).get('message', '')
            except ValueError:
                msg = ''
            return self.reply(502, 'Claude said no (' + str(e.code) + '). ' + msg)
        except OSError as e:
            return self.reply(502, 'Could not reach Claude: ' + str(e))
        self.send_response(200)
        # event-stream so the tunnel passes each piece on at once instead of holding the reply
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.end_headers()
        with res:
            for line in res:
                if not line.startswith(b'data: '):
                    continue
                ev = json.loads(line[6:])
                if ev.get('type') == 'content_block_delta' and ev['delta'].get('type') == 'text_delta':
                    out = ev['delta']['text']
                elif ev.get('type') == 'error':
                    out = '\n\n(Claude stopped: ' + ev.get('error', {}).get('message', 'error') + ')'
                else:
                    continue
                try:
                    self.wfile.write(out.encode('utf-8'))
                    self.wfile.flush()
                except OSError:
                    return   # the page closed


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    print(f'Lab  http://127.0.0.1:{port}/pos-lab/sky-lab.html  (Ask key: {"found" if api_key() else "missing, see " + KEY_FILE})')
    ThreadingHTTPServer.request_queue_size = 128
    # 127.0.0.1 only: the tunnel reaches it, the local network does not
    ThreadingHTTPServer(('127.0.0.1', port), partial(AskHandler, directory=ROOT)).serve_forever()
