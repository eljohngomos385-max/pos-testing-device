# A3 · Grain — what ref-11 measures

ref-11.png is 736 × 1308; the ball sits in the bottom half. Measured with PIL + numpy
(`measure.py` + small scratch scripts). Ratios are of the ball's diameter **D = 917 px**.

## Shape
- A plain **circle**: centre (367.6, 1218.5), r 458.5 (fitted on 90 rim points, worst miss 0.8 px).
  Only its top 60 % is in frame.
- Page around it **#F4F3F1** (warm light grey), dead flat: grain std 0.0 on the page.

## Edge
- **Crisp.** Page → ball in 1–2 px at the top (246 → 195 → 128): 0.2 % of D. measure.py's 21 px "edge"
  on a 35 px strip is the mottle, not the rim.
- Where a light patch meets the rim (left, x ≈ 100) the contrast drops, so the rim *looks* soft there.
  That is colour, not blur.
- **Absent:** no outline, no outer glow, no drop shadow, no blur outside the shape, no grain on the page.
  Everything happens inside the circle.

## Colour: one lightness ramp
- Every pixel's colour is predicted from its lightness alone within **1.8/255**. So the look = a grey
  "darkness" field pushed through one colour table (navy → mid blue → pale grey-blue).
- Ramp (17 steps, darkest → lightest): `#204D84 #28578E #316098 #3969A1 #4172AC #497BB8 #5284C1 #5B8DC8
  #6696CE #729ED2 #7FA7D5 #8BAFDA #97B7DD #A6BFDD #B3C7DF #C3CFDE #CED7E2`.
  OKLCH: navy L .42 C .10, mid L .66 C .10, light end L .88 C .02 (almost grey), hue 253° throughout.
- Area of the ball: **49 % light** (top of ramp), **43 % mid**, **8 % dark** (navy core only).
- Darkest patch (1st pct) **#2D5B91**, a single soft core low in the ball. Lightest **#CCD5E1**.
- Rim band: 2–20 px inside the edge the ball averages **#6392C7**; 250 px in it is **#9FBADB**.
  The edge zone reads bluer than the middle (a dome-like limb).

## Mottle (the cloudy patches)
- Soft blobs, no hard edges. Autocorrelation of the de-grained lightness halves at
  **100 px across (11 % of D)** and **65 px down (7 % of D)**; gone at 160 px (**17 % of D**).
  Patches are wider than tall.
- Fitted as a rim band (falloff 130 px = 14 % D) + 14 Gaussian blobs, σ 30–200 px (**3–22 % of D**),
  stretched up to 2.5 : 1. The navy core: σ 50 px (5.5 % D), strongest weight.
- One thing the fit can't do: a thin **light sheen streak** top-right that is a bit lighter than the
  light end. My model only darkens.

## Grain
- **std 6.0–7.4 / 255** (6.7 mean), the same in dark and light areas (7.6 → 6.1 as it gets lighter).
- **Monochrome** (R/G/B high-pass correlate 0.99).
- **Fine**: autocorr 0.40 at 1 px, ~0 at 2 px → about 1.5 px grains. That is a device-pixel property,
  so in the designs it is kept at ~1.5 device px, not scaled with the object.

## Copy — a3-grain-copy.html → img/a3-grain-compare.png (ref | copy)
```
white  + rim band (radial gradient, 1 − exp(−w·e^(−d/λ)))   ┐ grey "darkness" field
       + 14 blobs (radial gradients, 1 − exp(−w·gauss))      ┘ (black at opacity, so they multiply)
filter (sRGB):  feComponentTransfer table = the ramp
              + feTurbulence fractalNoise 1.2 → grey → feGaussianBlur .65 → arithmetic k3 .65
clip to the circle (crisp edge, nothing outside)
```
| | ref | copy |
|---|---|---|
| mean abs diff /255 | — | **8.10** (blank page 63.8) |
| diff with grain blurred out (σ 3) | — | **4.22** |
| grain std / autocorr 1 px | 6.74 / .38 | 6.69 / .36 |
| rim position | — | within 0.8 px |
| mean colour | 165 190 219 | 167 191 219 |

Two independent grains of std 6.7 alone cost ≈ 7 points, so 8.1 is close to the floor.
Round history: 12.1 (gradient tails left on, every blob added ~1 % grey everywhere) → 7.8 (tails cut)
→ 8.3 (grain made as strong as the ref's, which raises the diff) → 8.1 (rim moved 1.5 px down).

## Used in a3-grain.html
- Ramp re-hued in OKLCH to the app blue's hue (259.5°) and chroma ×1.8 so the mid step lands on
  **#4A8FFF ≈ #4388F7**; light end stays pale (#CAD7EC), navy end #0045A6.
- Per picture: the object's own silhouette (holes are cut-outs that show the card), a white base,
  **3 blobs** placed in object units (navy core σ ≈ 15 % of the object width low in the body, two mid
  streaks ≈ 30 × 10 % across the top), and a rim band (the silhouette blurred, inverted).
- 2 filters per picture, both shared by every picture: `rim` (blur σ 6 units, darkens up to .42) and
  `tone` (colour table + grain) + one mask for the silhouette. A theme flip re-renders in 2 frames
  (33 ms), same as a2-glass.
- Grain: turbulence 2.2 per unit, blur .36, k3 .78 → on the 2x shot **std 6.66, autocorr .40 at 1 px**
  = the ref's 6.7 / .40.
- Tone split on the shot: **27 % light / 54 % mid / 19 % dark** vs the ref's 49 / 43 / 8. Bluer on
  purpose: the ref's pale grey-blue end next to the card's white loses the outline at 128 px.
  A "more like the ref" variant = lower the blob weights / `RIM_K`.
- Dark mode ramp is **my guess** (no dark ref): navy L .30 → light L .74, never grey.
