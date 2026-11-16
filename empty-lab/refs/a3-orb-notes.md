# A3 · Orb — what ref-12 measures

ref-12.png is 720 × 900. Only the top orb was measured (y < 460). PIL + numpy; R = orb radius, D = diameter.

## The orb
| what | number |
|---|---|
| page | #F5F5F5, flat (std 0, no grain) |
| circle (least-squares fit to the half-way edge, 180 angles) | centre 376.2, 225.2 · R 158.7 px · D 317 px (44% of the 720 frame) · residual 0.4 px = a true circle |
| violet core (most violet point, 3 px blur) | 44% across, 33% down the diameter = 0.11 R left, 0.35–0.38 R up of centre · #5F4AF4 there |
| core → Azure | Azure ring (#3875FC) sits 0.55 of the way from the core to the rim |
| Mist | only at the lower rim: bottom edge #A8D2FC → #C7E6F8 in the last 8 px. Top rim stays #5087FE. Pure Mist #C9EEFF is never reached inside the orb — it is the colour of the rim light, not a fill |
| outer edge | 10→90% in ~2 px = 0.6% of D (σ ≈ 0.8 px = 0.25% of D) |
| rim light | inside only: Mist rising over the last ~20 px (6% of D), ≈ .04 opacity at 15 px in, .17 at 5 px, .31 at 2.5 px; similar all round (a bit stronger top-left) |
| outer glow | **none**: ring 3–6 px outside = #F5F5F5 ±1, 6+ px out exactly #F5F5F5 |
| grain | none (std 0.4–0.7 inside = JPEG, page 0.0) |
| shadow, outline, highlight dot | none |

Vertical profile through the core (fitted model, top → bottom, every 0.1 R):
`#4A84FC #3974FB #426BF9 #4A61F7 #5258F7 #5951F6 #5F4AF4(core) #5D4CF5 #5851F6 #5456F7 #4F5CF7(centre) #4962F8 #4369F8 #3D6FFA #3876FC #4782FC #568EFB #699EFC #7DAEFC #95C3FC (rim)`

## The recipe (one gradient + one rim, both portable to any shape)
1. **Body = ONE focal radial gradient** in the shape's own box (objectBoundingBox):
   focal fx .4444 fy .31 (the core), end circle cx .4789 cy .4189 r .5906.
   Stops: 0 #6148F4 · .139 #5852F6 · .278 #4E5CF7 · .417 #4369F8 · .556 #3875FC (Azure) · .694 #548DFB · .833 #7AABFC · .972 #A7D3FB · 1 #B0DBFB.
   Fitted by least squares on every pixel inside 0.9 R: mean abs error 1.1/255. The end circle sits lower than the focal point, so the bottom rim reaches t ≈ 1 (pale) and the top rim only t ≈ .7 (still blue). That one offset is the whole "lit from the top, Mist at the bottom" look.
2. **Rim = Mist #C9EEFF at .8 × (1 − the shape's alpha blurred by σ = 2.5% of D)**, inside the edge only (feGaussianBlur on SourceAlpha → arithmetic k2 1 k3 −1 → flood Mist → in). It follows any outline, holes included.
3. **Edge** 0.8 px blur on the circle (0.25% of D). At card size this is under half a pixel, so a3-orb.html leaves it to antialiasing.

## Copy (a3-orb-copy.html → img/a3-orb-compare.png: ref | copy | diff × 8)
Crop x176–576, y25–425 (400 × 400), dpr 1.
| | mean abs diff /255 |
|---|---|
| whole crop | **1.00** (blank #F5F5F5 page: 45.1; blank white: 53.3) |
| inside 0.5 R | 1.05 |
| 0.5–0.85 R | 1.16 |
| 0.85–0.95 R | 1.46 |
| 0.95–0.99 R (rim light) | 3.9 |
| ±1% R at the edge | 10.7 (JPEG ringing on the ref's edge; best over radius 158.7–159.5 × blur 0–1.5) |
| outside | 1.2 |
- Rim done with the stop-based ring (radial, centred) instead of the filter: 0.97 overall. The filter version is used because it carries over to shapes.
- Left over: the ref's rim light is a touch stronger top-left and at the very bottom; not visible at card size.

## Used in a3-orb.html (140-unit box at 128 px, white card)
- Same gradient geometry and stop offsets, same rim (σ = 2.5% of the object's larger side, set per picture from its measured box, Mist .8).
- Ref Azure #3875FC → app blue **#4388F7** at .556. Iris and the light end keep the ref's step from Azure: core #6C5BEF (= #4388F7 + the ref's Iris − Azure), mids mixed at the ref's fractions (.22/.46/.73 from Iris; .23/.55/.925 toward the end #B0DBFB).
- Measured result (all 21 pictures, light): object median **#639AF8**, hue 216° (app blue 217°, ref Azure 222°); darkest 10% #5A6FF3 (the violet core). The ref orb's own median is #4F7EFA against its Azure #3875FC, so both read lighter than their Azure; ours a bit more because thin parts (handles, tiles) get rim from both sides.
- One object per picture: body shapes are unioned through a mask, details are holes cut through it (tag hole, slot, clock hands, list rows, toggle knob, cash eye). No second layer, nothing see-through, no glow, no drop shadow.
- Dark (no ref, **a guess**): light end of the gradient deeper (#5494F8 → #8DBEFA instead of → #B0DBFB) and Mist rim .45, so the lower rim doesn't glare on #121212. Object median #5B92F8. Holes show the card, so they read dark in dark mode.
