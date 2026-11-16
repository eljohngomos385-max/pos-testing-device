# Magnifier silhouette (local frame: ring centre at 0,0, handle along +x): ring R, handle tapering from
# half-width h0 (aimed at x=D) to a round cap of radius h1 centred at x=E, welded to the ring by fillet f.
import math, sys
R, D, h0, E, h1, f = [float(v) for v in sys.argv[1:7]]
# top edge: line through (D, h0) tangent to the cap circle (E, 0, h1), on the +y side
dx = E - D
dist = math.hypot(dx, h0)
ang = math.atan2(-h0, dx) + math.asin(h1 / dist)       # direction from (D,h0) toward the tangent point
u = (math.cos(ang), math.sin(ang))
L = math.sqrt(dist**2 - h1**2)
Tc = (D + u[0] * L, h0 + u[1] * L)                       # tangent point on the cap
n = (-u[1], u[0]) if (-u[1]) * 0 + u[0] > 0 else (u[1], -u[0])
n = (-u[1], u[0]); n = n if n[1] > 0 else (-n[0], -n[1])  # outward normal (+y side)
# fillet centre C = (D,h0) + t*u + f*n with |C| = R + f
p0 = (D + f * n[0], h0 + f * n[1])
b = 2 * (p0[0] * u[0] + p0[1] * u[1]); c = p0[0]**2 + p0[1]**2 - (R + f)**2
t = (-b + math.sqrt(b * b - 4 * c)) / 2
C = (p0[0] + t * u[0], p0[1] + t * u[1])
P1 = (C[0] * R / (R + f), C[1] * R / (R + f))            # on the ring
T = (D + t * u[0], h0 + t * u[1])                        # on the handle edge
r = lambda v: f'{v:.2f}'
d = (f'M{r(P1[0])} {r(P1[1])}A{f:g} {f:g} 0 0 1 {r(T[0])} {r(T[1])}L{r(Tc[0])} {r(Tc[1])}'
     f'A{h1:g} {h1:g} 0 0 0 {r(Tc[0])} {r(-Tc[1])}L{r(T[0])} {r(-T[1])}'
     f'A{f:g} {f:g} 0 0 1 {r(P1[0])} {r(-P1[1])}A{R:g} {R:g} 0 1 0 {r(P1[0])} {r(P1[1])}Z')
print(d)
