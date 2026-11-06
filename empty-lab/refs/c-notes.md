# C · Blue gradient objects — measured from ref-06.png

Ref is 503×529 px (a screenshot; the "Visit site" chip and icons are page UI, ignored).
Measured with PIL + numpy (mask = |pixel − bg| summed over RGB > 40).

## Frame
- Background **#F4F8FB** (243.6 / 247.5 / 250.5), flat, noise std 0.3–0.6.
- 4 objects in a 2×2: jug 167×158, beaker+flask 188×128, teapot 197×214, bowls 200×121 (w×h px).
  → each object ≈ 33–40 % of the frame width. Left margin 50–83, top 57.
- Gaps between groups: 29–31 px across, 36 px down (≈ 6–7 % of the frame). Inside a group objects touch
  or overlap (beaker↔flask, bowl in bowl). Each row shares a baseline (jug + beaker both end at y 214;
  teapot 463, bowls 460).
- **No floor shadow, no outline, no ground line.** Side-view silhouettes only, no top faces, no perspective.

## Gradient stops (vertical line through the object, top → bottom)
| object | 0 % | 25 % | 50 % | 75 % | 100 % | darkest / lightest |
|---|---|---|---|---|---|---|
| teapot x190 | #12284E | #12356F | #4D89E0 | #B2D0F4 | #C1E0F3 | dark 0–20 %, light 85–100 % |
| teapot (10 % steps) | #0F2B55 · #112F63 · #19427D · #3163B5 · #4D89E0 · #76ACEE · #A0C7F2 · #BED8F9 · #C5E0F9 · #CBE4F3 | | | | | |
| jug x150 | #293C5E | #569FEA | #ADD1F9 | #D3E6F7 | #D7E8F8 | dark only at the very top (0–8 %), light from 50 % |
| beaker x330 | #C0E1F7 | #C5E2FB | #C7E3FB | #A7CCF6 | #3F5C83 | **inverse**: pale top, dark foot (97 %) |
| flask x415 | #5192DE | #62A7EF | #A6CBF5 | #80B6EF | #1F4BB7 | dark foot |
| lower bowl x380 | #8BBBE6 | #689FEE | #3265BD | #4981D4 | #1E3961 | pale rim, navy foot |
| upper bowl x380 | #B2D2E9 | #80B6F2 | #73AEF0 | #6BA4EE | #639AEA | flat mid blue |

- **Direction**: vertical. The teapot is perfectly even across x (rows are one colour ±3) — a pure top→bottom ramp.
  Bowls add a horizontal change: lit left (#A6CBEE→#C7DEF5), a soft dark blob right of centre (#2956A2),
  mid blue right (#4682E4→#66A5F0).
- Ramp shape: navy holds the top ~20 %, the cross-over runs 30 → 75 %, ice holds the last ~20 %.
- The mid of every ramp is ≈ **#4D89E0**, i.e. the app blue **#4388F7**.

## Highlight
- One per object, on the **left**, 6–12 px inside the contour. Teapot: a sliver ≈ 10 px wide × 40 px tall
  (5 % × 20 % of the object), **crisp on its outer side** (one-pixel step 75 → 186 luminance), fading inward
  over ~12 px and downward. Peak ≈ #9FB6D8 on navy → white at α ≈ 0.6–0.85.
- Bowls/beaker: softer, blurred white columns (σ ≈ 6 px), α ≈ 0.3.
- A second, fainter streak (α ≈ 0.2) 6–8 px right of the first on the teapot.

## Grain
- Residual std after a 4 px blur: teapot 0.8–0.9, jug 0.5 (≈ none — those are smooth); bowls **4.4 light rim,
  10.8 mid, 17 foot** — grain grows with darkness. Background 0.3.
- Speckle size ≈ 2 px (autocorr 0.89 / 0.75 at dx 1/2, 0.72 / 0.40 at dy 1/2) ≈ 1 % of the object width.
- The bowl foot has horizontal streaks (brushed glaze), not round dots.

## Edges & strokes
- Edges crisp: one anti-aliased pixel (e.g. 140 → 176 → 234 across the teapot's right side). No outline.
- Handles are solid navy strokes **#13294D**: teapot handle 7 px on a 214 px object (**3.3 %**), jug handle 7 px
  on 158 px (4.4 %). Knob/lid also solid navy.

## Recipe (proven in c2-copy.html → img/c2-compare.png)
1. Side-view silhouette, no outline, flat bg; objects grouped 1–3, touching, one shared baseline.
2. Fill = vertical `linearGradient` on the object's own box. Teapot ramp (navy-heavy):
   0 #0E2753 · .15 #0D2B58 · .28 #183C75 · .35 #224E93 · .41 #3364B5 · .48 #467ED8 · .55 #609AEA ·
   .61 #7DB1F1 · .68 #9AC4F3 · .74 #B4D2F3 · .81 #C2DCF9 · 1 #C4E1F7.
   Light ramp (jug): navy only as a thin top band, ice from 50 %. Inverse ramp (beaker, bowls): pale top, navy foot.
3. Handles, knobs, wheels: solid navy, stroke ≈ 3.5 % of object height, round joins.
4. Highlight: a tapered white sliver on the left, horizontal white gradient (α .25 → .88 → 0), blur σ 1;
   optional faint second streak; bowls get a σ 6 soft column instead.
5. Overlap shadow: a navy ellipse at α .75, blur σ 6, clipped to the lower object.
6. Grain: `feTurbulence fractalNoise baseFrequency .7 numOctaves 2`, R channel copied to RGB, then
   `feComposite arithmetic k1=−c k2=1+c/2 k3=c k4=−c/2` (c ≈ .65) → noise strong in darks, ~0 in ice.
   **k3 = −k1 is required**: otherwise alpha drops below 1 and the shape washes out (+18 brightness, found
   on a flat-colour test). Foot: extra streak noise `baseFrequency ".08 .9"`.
7. Copy result: on-object colour diff (3 px blur) **9.3/255 teapot, 9.6/255 bowls**; silhouette mismatch 4.5 % /
   1.5 % of ref area; sampled teapot line avg Δ 2.6; bowl lines Δ 7–16 (the shadow blob is the loosest part).
