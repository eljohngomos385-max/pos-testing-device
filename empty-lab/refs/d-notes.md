# D · Line + dashes — measurements of ref-03 (256×438 px)

Measured with PIL + numpy (stroke centres from intensity-weighted runs, colours = darkest pixel of each part).
"Figure" = the drawer front, 135 px wide (stroke centres x 39 → 174). All % below are of that width.

## Strokes
- Main line: **#A3C4EA**, **2.4 px = 1.8 %** of figure width, round joins/caps. Darkest pixel (164,197,235).
  Relative to the app blue #4388F7: ~45 % of it over a cool grey — paler and greyer than a plain white tint.
  App-derived: `color-mix(in srgb, #4388F7 40%, #DCE2E6)` ≈ #9FBEED.
- The ✕ on the paper: same blue, **3.4 px** (1.4× the main line), arms 16 px across (12 %), centred on the paper.
- Handle: a U, 30 × 9 px, **2.6 px at 50 % opacity** — the only "pale" line inside the figure.

## Fills
- Missing paper: **#F7FAFF** = #4388F7 at 4 % over white (exact match), opaque.
- Drawer front, the two cards behind it: **pure white, opaque** — they hide the diagonal that runs behind.

## Dashes (the missing thing)
- **8 on / 5.2 off** (period 13.2 = 9.8 %), **butt caps**, starts right after the 4 px corner.
- Paper: 86 × (runs behind the cards) px, **rx 4** (3 %).

## Radii
- Paper 4 · front 6 (4.4 %) · card tops 5 · notch top fillets 5 (convex), notch bottom 2 · handle 4.

## Shape
- Paper top y 126 → front bottom y 274: figure 135 × 150 (incl. the walls).
- Walls slope out at 0.51 px/px from the paper sides (y 170) to the front's top corners (y 213).
- Two stacked card tops behind the front (y 193 and 203), sides on the same slope 8 px inside the walls.
- Front: 135 × 61, notch 50 wide × 15 deep, centred.

## Scatter (decoration)
- Colour **#DCE7F1** (one value for crosses and lines) — ≈ 12 % of the app blue over a light cool grey.
- **5 crosses**, chunky, round caps, each turned a little (0, ±8, -16, -18°):

  | where (relative to figure) | arm span | stroke |
  |---|---|---|
  | above-left of the paper (94, 80) | 8 px | 3 |
  | right of the paper, biggest (205, 141) | 16 px (12 %) | 4.6 |
  | far left, cut by the edge (4.5, 177) | 9 px | 3.6 |
  | bottom-left (21, 245) | 8 px | 3 |
  | bottom-right (225, 239) | 11 px | 3.6 |

  Spread: they ring the figure at 0.8–1.3 figure-widths from its centre, none touching it, none inside.
- **3 diagonal lines**, all **45°** rising to the right, **1.3 px**, same colour. Lengths 75 / 88 / 113 px
  (55–85 % of figure width). Each is one long line with 1–2 tiny breaks: gap 1.4–3, a dot/dash 1.5–8, gap, line on.
  One passes behind the front (hidden by its white fill). Placement: top-left, top-right, bottom-right.
- Whole scatter spans the full image width (0–256) and y 51–252; the figure sits inside it.

## Text
- "결과가 없습니다", one line, **400 weight, ~26 px** (glyph height 24 px), colour **#262F38** darkest (avg ink #3E444A).
- **Left-aligned** at x 18–20 — not under the figure's left edge (39); the figure is **not** centred
  either (centre x 106.5 of 256, 21 px left of middle). Looks like a screen crop, not a rule.
- Figure width : font size = 135 : 26 ≈ **5.2 : 1**.
- Gap front bottom → glyph top: **38 px ≈ 1.5× the font size**.
- Background pure white, no card, no button.

## Recipe (proven by d2-copy.html — img/d2-compare.png: ref | copy | overlay)
```
line   stroke #A3C4EA 2.4  round caps/joins      (app: cta 40 % over #DCE2E6)
solid  line + fill = page background (opaque, hides scatter behind)
dashed line + dasharray 8 5.2, butt caps, fill #F7FAFF (cta 4 % over bg)
mark   line at 3.4 (the ✕ / arrow / % on the dashed thing)
pale   line at 50 %, 2.6 (handles, text rows)
scatter #DCE7F1: 5 crosses 8–16 px, stroke 3–4.6, slight turns; 3 × 45° lines 1.3 px with a dot-break
text   one line, ~1.5× font size below the figure
```
Copy score: mean |Δ| 2.52 / 255 over the frame (blank white = 3.69); overlay is ~all shared pixels.
Left over: the ref is a soft, slightly blurred bitmap, ours is crisp; the Korean font is Malgun Gothic,
not the ref's (glyphs 2 px shorter).

## Round-2 design decisions (d2-line.html)
- Same recipe, scatter = the ref's own 5 crosses + 3 lines at the same positions relative to the figure.
- Figure is centred in the card (the ref's left offset is a crop).
- Text **centred** — see report; left is on the Align switch to compare.
- The ref's 256-px frame is scaled to the 300-px card (×1.17), so the figure is 53 % of the card like the ref
  (stroke shows at 2.8 px, still 1.8 % of the figure).
- Title 19 px / 600 + one 14 px grey line (app sizes, smaller than the ref's 26 px line).
- Text **centred**: with the figure centred, left text reads lopsided; the ref's left text is a crop artefact.
- Dark: line = cta 60 % over #6F7782, scatter = cta 22 % over --bg, paper = cta 9 % over --bg.
- Fix round after the first screenshots: folder front lowered so the dashed tag shows, box tape line removed,
  dark line lighter, clock arrow at mark weight, figure scaled up to the ref's proportion.
