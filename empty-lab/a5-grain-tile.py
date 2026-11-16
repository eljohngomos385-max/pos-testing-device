# Seamless film-grain tile -> img/grain-tile.png (grey, 128 = no change)
# Per-pixel Gaussian noise, lightly clumped (sigma .6 px: ref-11's grain is ~1.5 px, autocorr .42 at 1 px).
# a4-grain.html adds it to the coloured picture inside the tone filter (col + K*(tile - .5)), so specks lighten and
# darken equally everywhere, like the ref (skew 0). The page draws it 1 tile px = 1 device px, so it never grows with the icon.
import numpy as np
from PIL import Image
N, SIG, SD = 256, .6, 28   # SD = tile spread in levels; the page's K scales it (K .25 -> ~7 levels, ref-11 6.4-7.5)
rng = np.random.default_rng(11)
n = rng.normal(0, 1, (N, N))
k = np.exp(-np.arange(-2, 3) ** 2 / (2 * SIG ** 2)); k /= k.sum()
for ax in (0, 1):   # separable blur with wrap-around -> the tile repeats with no seam
    n = sum(w * np.roll(n, s, axis=ax) for s, w in zip(range(-2, 3), k))
n = (n - n.mean()) / n.std()
g = np.clip(128 + n * SD, 0, 255).round().astype(np.uint8)
Image.fromarray(np.dstack([g, g, g])).save('img/grain-tile.png')
print('ok', N, SIG, SD)
