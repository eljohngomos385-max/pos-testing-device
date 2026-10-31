# py .claude/skills/start-lines/draw.py phone|ipad: every page's top in one sheet.
# Red = the start line (126 phone / 76 iPad), blue = where the page starts (iPad split pages: left pane | right pane).
# Green number = on the line, blue = off by (+n). Only page names and numbers are written: no other labels.
import json, os, re, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
dev = sys.argv[1] if len(sys.argv) > 1 else 'phone'
OUT = os.environ.get('START_LINES_OUT') or os.path.join(tempfile.gettempdir(), 'start-lines')
D = os.path.join(OUT, dev)
j = json.load(open(os.path.join(D, 'm.json'), encoding='utf-8'))
REF, m = j['line'], {k: v for k, v in j['pages'].items() if 'err' not in v}
ipad = dev == 'ipad'
VW, S = (1180, 1) if ipad else (393, 2)        # CSS width, screenshot scale
H = 300 if ipad else 470                        # CSS px shown from the top
k = 0.55 if ipad else 1.0                       # sheet px per CSS px
PER = 4 if ipad else 8
SPLIT = 490                                     # iPad: the list pane's right edge, drawing only
SPLITS = {'Orders', 'Customers', 'An order', 'Refund', 'A customer'}
try: fb = ImageFont.truetype('segoeuib.ttf', 20)
except OSError: fb = ImageFont.load_default()
W, Hh, gap, top = int(VW * k), int(H * k), 18, 34
names = list(m); rows = (len(names) + PER - 1) // PER
sheet = Image.new('RGB', (PER * (W + gap) + gap, rows * (Hh + top + gap) + gap), 'white'); d = ImageDraw.Draw(sheet)
RED, BLUE, GREEN = (230, 40, 40), (30, 110, 240), (40, 150, 60)
for i, n in enumerate(names):
    v = m[n]; x0 = gap + (i % PER) * (W + gap); y0 = gap + (i // PER) * (Hh + top + gap) + top
    im = Image.open(os.path.join(D, re.sub(r'[^a-z0-9]+', '-', n, flags=re.I) + '.png')).convert('RGB')
    sheet.paste(im.crop((0, 0, VW * S, H * S)).resize((W, Hh), Image.LANCZOS), (x0, y0))
    yy = lambda y: y0 + int(y * k)
    d.line((x0, yy(REF), x0 + W, yy(REF)), fill=RED, width=2)
    L, R = v.get('left'), v.get('right')
    if ipad and n in SPLITS and None not in (L, R) and L != R:
        d.line((x0, yy(L), x0 + int(SPLIT * k), yy(L)), fill=BLUE, width=2)
        d.line((x0 + int(SPLIT * k), yy(R), x0 + W, yy(R)), fill=BLUE, width=2); vals = [L, R]
    else:
        d.line((x0, yy(v['start']), x0 + W, yy(v['start'])), fill=BLUE, width=2); vals = [v['start']]
    lbl = '  |  '.join(f'{x}' + ('' if x == REF else f' ({"+" if x > REF else ""}{x - REF})') for x in vals)
    d.text((x0, y0 - top + 4), n, font=fb, fill='black')
    d.text((x0 + W - d.textlength(lbl, font=fb), y0 - top + 4), lbl, font=fb, fill=GREEN if set(vals) == {REF} else BLUE)
out = os.path.join(OUT, f'start-lines-{dev}.png'); sheet.save(out); print('ok', out)
