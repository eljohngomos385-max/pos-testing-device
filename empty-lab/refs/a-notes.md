# A · Glass — what the references measure

Measured with PIL + numpy on the PNGs in this folder. All px are the screenshot's own px.

## Colours
| what | ref-01 (envelope) | ref-02 (server + lock) | ref-04 (icon set) | ref-05 (3×3) |
|---|---|---|---|---|
| page bg | #FFFFFF | #FFFFFF | #FFFFFF | #FFFFFF |
| solid blue (flat, no gradient) | #2290FF | #2290FF | #0181FF | #184AE7 (deep) |
| frost with nothing behind | #EAF5FF–#EDF6FF | #EEF7FF top → #F2F8FF bottom | #EBF5FF–#EEF7FF | #CFE4FE (opaque pale blue) |
| frost over solid (plateau) | #B9DCFF–#BDDEFF | #ABD5FF–#B0D7FE | #B0D8FF right at the edge | #6490F4 |
| glow just outside the frost | #D2E8FF (all round) | #C7E2FE under, #D6EBFE right | none | none |
| marks on solid | white #FFFFFF lines | white dots + 1 line | – | – |
| marks on frost | – | keyhole = solid blue, crisp | – | – |
| title | #1A1A1A | #1A1A1A | – | – |
| sub line | #1D1D1D (regular, not grey) | #191919 | – | – |

- Solid is **flat**, one value. Round 1's top-to-bottom gradient on the solid is not in any ref.
- Frost is **almost white**: blue shows through at only 2–7 % where nothing is behind it. Round 1's frost was far bluer (#B2CFFD at 74 %) — that is the main reason it read less "glass".
- Blue seen through frost: plateau ≈ 30–38 % of the solid (ref-02: (255−171)/221 = .38), i.e. frost ≈ white 62–65 % over a blurred backdrop.
- No white rim / highlight stroke on the frost edge in any ref (edge goes #0181FF → #3092F3 → #B8DCFC in one px).
- No grey drop shadow anywhere. The only "shadow" is the blue glow.

## Sizes (ref-02 is a real phone screen, 424 px wide)
- Whole figure 150 × 143 px (solid+frost), 158 × 156 with glow → **35 % of screen width**.
- Server bars 114 × 34.5, gap 4, radius 8 (= 23 % of bar height). Dots r 3.6, white line 63 × 2.8.
- Lock body 80 × 56, r 8; shackle 57 wide, leg 12.5, hole 32; keyhole r 7.5 + stem 7→10 wide.
- Lock (frost) is 53 % of the figure width; it overlaps the solid by ~57 px (the right half of the bars).
- ref-04: Message solid pill 66 × 27 (r = h/2), frost pill 61 × 25, frost overlaps solid's lower-right quarter. Friend head r 19.2, frost dome 57 × 34 covers the head's lower 40 %.
- Title: 21 px glyph height (cap + descender) ≈ **22 px font, bold**. Sub ≈ **16 px, line 21 px**. Title/sub = 1.35.
- Figure ≈ 6.5 × the title font size.
- Gap figure bottom → title top = **92 px** (both ref-01 and ref-02) = 22 % of screen width = 4.2 × title size. Title top → sub top 53 px; sub line pitch 21 px.

## Blur, glow (fitted by rendering, not guessed — see Copy below)
- Blue seen through the frost: Gaussian **σ ≈ 6.5 px on an 80 px lock (8 %)** in ref-02; **σ ≈ 13 px on a 60 px frost (≈ 20 %)** in ref-04. 10–90 % falloff of the server edge under the lock = 23 px.
- Glow (ref-02): the frost shape in solid blue, **30 % opacity, σ 12 px (15 % of lock width), offset +6 x / +14 y** → strongest just outside the lower-right edge, gone ~35 px below. It sits behind everything, so the frost also shows it faintly (that is where the 2–4 % base tint comes from).
- ref-01 glow is the same idea but centred and larger (fades to white ~40 px out from a 120 px envelope).

## Copy (a2-copy.html → img/a2-compare.png, left = ref, right = copy)
Recipe that matched, in SVG:
```
glow  = frost shape, fill blue, translate(+6,+14), feGaussianBlur σ12, opacity .30   (behind)
solid = flat blue
frost = clip(frost shape) { white
                            + (solid + glow) blurred σf, at opacity k
                            + blue at t
                            + white gradient 0 → L top to bottom }
marks = crisp blue on frost, white on solid (on top)
```
| figure | σf | k | t | L | glow | mean abs diff / 255 (whole crop) | at 1/4 thumbnail |
|---|---|---|---|---|---|---|---|
| ref-04 Message | 13 | .40 | .06 | .30 | none | 2.4 | 2.7 |
| ref-04 Friend | 13 | .40 | .06 | .30 | none | 2.1 | 1.8 |
| ref-02 server + lock | 6.5 | .45 | .02 | .30 | .30 / σ12 / (6,14) | 3.1 | 2.7 |

- What it took: geometry within ±0.5 px mattered more than any paint value (a 1 px-wide bubble alone cost 2 points); then a grid search over σf/k/t/L/glow, 200+ renders.
- "frost = white 55–60 % over the solid blurred by ~10 % of the frost's width" is the one-line rule. Tint ≤ 6 %. No rim, no stroke, no grey shadow.
- Left over: the ref frost is a touch lighter bottom-right and its blue a touch more saturated close to the overlap; not visible at thumbnail size.

## Used in a2-glass.html (140-unit viewBox drawn at 128 px)
- Solid #4388F7 flat (the app's --cta-solid; the refs' #2290FF is the same hue family, a bit brighter).
- Light: σf 10 units (≈ 11 % of a 90-unit frost), k .45, t .07, L .15; glow .28 / σ 13 / (+5,+12). Tint and lift moved off the fitted .02–.06 / .30 because at card size on the app's white the fitted frost vanished (search lens, person body); this is still far lighter than round 1.
- Dark (no ref — my own): frost base #343941, k .6, t .12, L .04, glow .5.
- Figure 128 px in a 300 px card = 43 % (ref 35 %; bumped after the first screenshot read small). Title 17 px bold, sub 14 px — kept the app sizes (ref ratio would give 15.6 / 11.3 px, too small to read on the POS); gap figure → title 26 px plus the glow's own room (ref 92 px on a 424 screen would push the words off a 420 card).
- Sub line is grey (#8C8C8C, --ink-tertiary) as asked, not the refs' near-black.
- Weak spot: a frost shape with little solid behind it (search lens, cart bag) stays faint, as in the refs' logic — the refs always overlap the frost on a big solid.
