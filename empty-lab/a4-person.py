# Person: head circle (70, hy, Rh) on a half-ellipse of shoulders (centre 70,112, rx, ry; sides drop to y=122),
# joined by a small fillet f. Prints the SVG path.
import math, sys
hy, Rh, rx, ry, f = [float(v) for v in sys.argv[1:6]]
cx, ey, bot, rc = 70, 112, 122, 6
def off(t):   # point on the ellipse at angle t (t=-90° is the top) pushed out by f along its normal
    x, y = cx + rx * math.cos(t), ey + ry * math.sin(t)
    nx, ny = math.cos(t) / rx, math.sin(t) / ry; l = math.hypot(nx, ny)
    return (x, y), (x + f * nx / l, y + f * ny / l)
lo, hi = -math.pi / 2, 0.0   # right side: find t where the offset point is Rh+f from the head centre
g = lambda t: math.hypot(off(t)[1][0] - cx, off(t)[1][1] - hy) - (Rh + f)
for _ in range(80):
    m = (lo + hi) / 2
    if g(lo) * g(m) <= 0: hi = m
    else: lo = m
(E, C) = off(lo)
k = Rh / (Rh + f)
Hp = (cx + (C[0] - cx) * k, hy + (C[1] - hy) * k)
r = lambda v: f'{v:.2f}'
mx = lambda x: 2 * cx - x
d = (f'M{r(mx(Hp[0]))} {r(Hp[1])}A{Rh:g} {Rh:g} 0 1 1 {r(Hp[0])} {r(Hp[1])}'
     f'A{f:g} {f:g} 0 0 0 {r(E[0])} {r(E[1])}A{rx:g} {ry:g} 0 0 1 {r(cx + rx)} {ey}'
     f'L{r(cx + rx)} {bot - rc}A{rc} {rc} 0 0 1 {r(cx + rx - rc)} {bot}L{r(cx - rx + rc)} {bot}'
     f'A{rc} {rc} 0 0 1 {r(cx - rx)} {bot - rc}L{r(cx - rx)} {ey}A{rx:g} {ry:g} 0 0 1 {r(mx(E[0]))} {r(E[1])}'
     f'A{f:g} {f:g} 0 0 0 {r(mx(Hp[0]))} {r(Hp[1])}Z')
print(d)
