# E · glow — measured from ref-01 / ref-02

Measured with PIL + numpy (scripts in the session scratchpad). ref-01 and ref-02 are the same scale
(title is 168 px wide in both). Glow alpha = how much of the object blue sits on white:
`a = (255 - R) / (255 - 35)`; every glow pixel checked lies exactly on the white → object-blue line.

## Scale
- Phone frame ≈ 434 px wide in ref-01 (centre x 312; iOS "◄ App Store" at x 110 and its 9 px cap
  height both give ≈ 1.157 px per pt). All pt values below = px ÷ 1.157.
- Page bg: pure white #FFFFFF.

## Glow
- Colour: the object's own blue, **#2391FF** (35,145,255), no second hue — pale stops are just lower alpha.
- Shape: it is the glass piece's **blue drop shadow + the blue part blurred behind frosted glass**.
  Round-ish, hugging the object, **offset down**: glow centroid (317,447) vs blue flap centroid (307,399)
  → 48 px below ≈ 0.39 × object width. Halo under the glass edge 0.24–0.38, over the top only 0.10.
- Peak alpha: 0.36–0.42 (seen through the frost, just under the blue piece).
- Falloff outside a glass edge (alpha vs px past the edge, ref-01 left / ref-02 lock bottom):
  0 px .19–.24 · 8 px .13–.19 · 16 px .08–.11 · 24 px .04–.05 · 32 px 0.
  ≈ a Gaussian edge with σ ≈ 15 px (13 pt) — in CSS `blur(15px)` / box-shadow blur ≈ 30 px.
  Reach past the object ≈ 30 px = **25 % of the object width**.
- Glow box (any tint): 158 × 183 px = 1.3 × 1.35 the envelope (122 × 135 px). Taller than wide (the down offset).
- Frost (ref-02 lock): where solid blue sits behind, the glass reads a .30–.37 (≈ 65–70 % white
  + blur); where only shadow sits behind, a .06–.10 (≈ 85 % white).

## Object
- Envelope 122 × 135 px = **28 % of frame width** (105 pt). With the wave + arrow 164 px = 38 %.
- ref-02 servers + lock 160 × 150 px incl. glow tint; solid part 112 × 110.

## Text block (centred)
- Gap object bottom → title cap top: 115 px (99 pt) = 26 % of frame width; glow end → title 81 px.
- Title: cap height ≈ 15 px → ≈ 21 px font (18 pt), semibold/bold, colour ≈ #1F1F1F, 168 px wide.
- Title baseline → sub first baseline: 49 px (42 pt).
- Sub: cap height ≈ 12.5 px → ≈ 17.5 px font (15 pt), regular, colour ≈ #262626
  (NOT grey — near-black, the hierarchy is size + weight only), line pitch 22 px (19 pt, lh ≈ 1.27).
- Sub line widths 293 / 350 px; max text width ≈ 81 % of frame width (303 pt).
- Whole block (envelope top → sub bottom) 340 px = 294 pt.

## Copy recipe (e2-copy.html, see img/e2-compare.png)
Layer order (bottom → top), all one blue:
1. **Glow** = the blue piece + the glass piece, blurred σ 15 px, opacity .5; the glass part moved 11 px down.
2. **Glass** = white at 60 % over a σ 7 px blur of the blue that sits behind it (SVG stand-in for backdrop-filter).
3. **Blue piece** on top, crisp, corners rounded (stroke-linejoin round, 13 px).
Text: 22 px / 700 title #1F1F1F, 17.5 px / 22 px sub #262626 (Segoe UI here; ref font is a
grotesk, so glyph shapes differ — widths matched to ±8 px).

Result after 5 rounds: mean abs diff 4.96 / 255 whole crop, 7.7 on the figure box.
Glow alpha vs ref, same pixels (ref → copy):
- right of glass, every 4 px: .23 .18 .13 .08 .05 .02 .00 → .23 .20 .15 .10 .08 .05 .03
- below glass, every 4 px: .24 .20 .15 .10 .07 .04 .02 → .24 .20 .15 .10 .07 .05 .03
- inside glass under the blue: .38 .37 .33 .30 .24 → .38 .35 .31 .27 .23
- tint box 235–394 × 335–521 → 231–401 × 342–520; weighted centre 317,447 → 316,449.

## How it goes into e2-glow.html (300 × 420 card)
- The app's line icon in --cta-solid on a **frosted white round** (the glass piece), 88 px
  (≈ 29 % of the card width, ref 28 %).
- Behind the round: the round's own shape in --cta-solid, blur 12 px (σ scaled 15 px ÷ 1.157 × 0.92),
  opacity .5, moved 9 px down → reach ≈ 24 px past the round (ref 25 %), stronger under than over.
- A small blue disc behind the round's lower half shows through the frost (ref-02 / ref-04 hint):
  backdrop-filter blur on the round does the frosting.
- Text: title 18 px / 700, sub 15 px / 19 px, one line; gap round → title 64 px, title → sub 10 px.
  Sub in --ink-secondary (ref is near-black; the owner asked for a grey line, tertiary read too faint).
