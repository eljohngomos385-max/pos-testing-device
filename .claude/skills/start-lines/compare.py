# py .claude/skills/start-lines/compare.py: before | after for every page whose start moved (needs both `measure.cjs <dev> before`
# and `measure.cjs <dev>` runs). Columns: Phone before, Phone after, iPad before, iPad after. Red = the line, blue = the start.
import json, os, re, tempfile
from PIL import Image, ImageDraw, ImageFont
OUT = os.environ.get('START_LINES_OUT') or os.path.join(tempfile.gettempdir(), 'start-lines')
def load(d):
    p = os.path.join(OUT, d, 'm.json')
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else None
M = {d: load(d) for d in ('before-phone', 'phone', 'before-ipad', 'ipad')}
COLS = [c for c in (('Phone before', 'before-phone'), ('Phone after', 'phone'), ('iPad before', 'before-ipad'), ('iPad after', 'ipad')) if M[c[1]]]
def start(d, n):
    v = M[d]['pages'].get(n, {}); return v.get('right') if 'ipad' in d and n == 'An order' else v.get('start')
moved = [n for n in M[COLS[1][1]]['pages'] if any(M[a] and M[b] and start(a, n) != start(b, n) for a, b in (('before-phone', 'phone'), ('before-ipad', 'ipad')))]
if not moved: raise SystemExit('nothing moved')
try: fb, fs = ImageFont.truetype('segoeuib.ttf', 18), ImageFont.truetype('segoeui.ttf', 16)
except OSError: fb = fs = ImageFont.load_default()
RED, BLUE, GREEN, K = (230, 40, 40), (30, 110, 240), (40, 150, 60), 0.6
DETAIL = {'An order', 'Refund', 'A customer'}   # iPad: show the detail pane
def tile(d, n):
    ipad = 'ipad' in d; S, ref = (1, 76) if ipad else (2, 126)
    x0, x1 = ((490, 1180) if n in DETAIL else (240, 940)) if ipad else (0, 393); h = 190 if ipad else 280
    im = Image.open(os.path.join(OUT, d, re.sub(r'[^a-z0-9]+', '-', n, flags=re.I) + '.png')).convert('RGB')
    im = im.crop((x0 * S, 0, x1 * S, h * S)).resize((int((x1 - x0) * K), int(h * K)), Image.LANCZOS)
    s = start(d, n); dr = ImageDraw.Draw(im)
    dr.line((0, int(ref * K), im.width, int(ref * K)), fill=RED, width=2)
    if s is not None: dr.line((0, int(s * K), im.width, int(s * K)), fill=BLUE, width=2)
    return im, s, ref
rows = [[tile(d, n) for _, d in COLS] for n in moved]
gap, lab = 16, 26
W = gap + sum(t[0].width + gap for t in rows[0]) + 2 * gap
rh = max(t[0].height for t in rows[0])
sheet = Image.new('RGB', (W, 34 + len(rows) * (rh + lab + gap) + gap), 'white'); dr = ImageDraw.Draw(sheet)
x = gap
for i, (im, _, _) in enumerate(rows[0]):
    dr.text((x, 8), COLS[i][0], font=fb, fill='black'); x += im.width + gap + (gap if i == 1 else 0)
y = 34
for n, row in zip(moved, rows):
    x = gap
    for i, (im, s, ref) in enumerate(row):
        sheet.paste(im, (x, y + lab))
        dr.text((x, y + 2), f'{n}  {s}' + ('' if s == ref else f' ({"+" if s > ref else ""}{s - ref})'), font=fs, fill=GREEN if s == ref else BLUE)
        x += im.width + gap + (gap if i == 1 else 0)
    y += rh + lab + gap
out = os.path.join(OUT, 'before-after.png'); sheet.save(out); print('ok', out, f'{len(moved)} page(s) moved')
