# B · Soft silhouette — measured from the refs (round 2)

Measured with PIL + numpy on the PNGs as given (ref-07 is a 682×511 grid of six ~206×242 tiles;
ref-08 434×601; ref-09 349×771). "Edge 90→10" = px for the R channel to go from 90% to 10% of
the way between the object fill and the darkest blue next to it, on a 7-row average.

## Colours

| | ref-07 (summer tiles) | ref-08 (MUJI penguin) | ref-09 (cold brew) |
|---|---|---|---|
| object fill | **#FCFDFE** (page is #FFFFFF, so: the page white) | #DFF1FD flat, pale ice | #EDF9FC |
| blue right at the object (haze centre) | #67B1D6–#71B6D8 (darkest 10%), #53A9D5 at the shadow side | rim peak #79C4DE (sides), #51C1DF (above head) | #2FBBE9 |
| haze edge / far | #B7E0F1–#BAE1F2 (lightest 10%), tile corners #AADEF1 / #C0E6F6 | fades to #E3ECEF then #FFFFFF | #A9E2F6 / #B8E7F7 |
| haze mean | #95CDE8 (hue ≈199°, L ≈ 75%) | — | #9DDFF4 |
| background tint | page white #FFFFFF around tiles | white, pink #FCE7E8 bottom-left, warm #F1EEE9 bottom-right | blue all over |

All three blues are cyan-sky (hue 195–200°). Ours is the app's #4388F7 (217°): owner wants the
haze to read as that blue at full strength next to the object, fading to the page only at the edges.

## Blur (silhouette edge)

- ref-08: edge 90→10 = **33 px** on a 250 px wide body → **13% of object width**. Inner edge is
  sharper than the outer fade: rim peak sits ~30–40 px outside the fill edge, rim → page fade is
  55 px (22% of width).
- ref-07 bottle: 18–19 px on a ~62 px bottle → ~29% (small thumbnail; very foggy).
- ref-09 cup: 14–16 px on a ~165 px cup → ~9%.
- So: **9–29%, typical 13%** of object width. Gaussian 90→10 ≈ 2.56σ → σ ≈ 5% of object width.

## Grain

- ref-08: std **5.0** (0–255, high-pass 3 px) in the blue rim, **0.0 inside the fill**, 0.4 on the
  white page. Grain lives only in the blue. Autocorrelation 0.36 at 1 px, ~0 at 2 px → ~1 px grains.
- ref-07: std 1.8 in the haze, 0.13 in the fill; ~1 px (thumbnail, so grain is shrunk).
- ref-09: std 1.7 in the haze, 2.45 on the cup (that one is image noise, autocorr 0.9).

## Where the blue sits, how big things are

- ref-07: **whole tile is haze**; darkest right around the object (a soft blue "shadow" offset
  to one side), lighter toward the tile edges. Per tile: solid object core 9–21%, object incl.
  feather 16–38%, **haze 60–82%** of the frame.
- ref-08: **a rim around the object** that fades to white/pink; blue ≈ 30% of the frame, fill ≈ 29%.
  The bottom of the body has no rim — it melts into the page.
- ref-09: whole frame blue, object 47% of width.
- Inside every object: one flat pale, no outline, no ring, no inner lines (owner tip: the object is
  a hole in the haze, the same white as the paper).

## Copy recipe (empty-lab/b2-copy.html, compare in img/b2-compare.png)

Penguin (ref-08), SVG user units = px:
1. page: white + pink radial bottom-left (#FCE2E6), pink top-right (#FBE8EA), warm bottom-right (#EFEDE6).
2. rim: the shape, `feMorphology dilate 38` → `feGaussianBlur 30`, fill #3DB5DF, faded out over
   the bottom 30% by a mask.
3. grain: same rim alpha × `feTurbulence fractalNoise .9, 2 octaves` → dark dots (#0D7094) at .55 +
   white dots at .6. Gives std 5.6 (ref 5.0) only in the blue.
4. fill: the shape, `feGaussianBlur 9.5`, #DFF1FD, drawn last.

Bottle tile (ref-07): radial #80C1E3 → #93CEEC → #B9E2F3 field + a light top-right corner;
a bottle-shaped shadow #3594CA offset (18,6) blur 18; grain dots #0E5C86 at .09 (std 1.78, ref 1.8);
bottle #FCFDFE blur 7.

Result (mean |diff| per channel, 0–255, text masked out): penguin **9.4** (8.9 after 6 px blur),
bottle **10.2** (9.0). Edge 90→10: penguin 33 vs 33 px, bottle 18 vs 18 px. Grain std 5.6 vs 5.0,
1.78 vs 1.8. Darkest blue next to the bottle #5DABD5 vs #53A9D5. Left differences are the hand-drawn
penguin outline and the tile's lighter top-left, not the recipe.

## Design recipe (b2-silhouette.html), 320-unit picture box at 400 px (1 unit = 1.25 px)

- object: solid shape, fill = the card's own colour (`--bg`), `feGaussianBlur 4.5`
  (about 12% edge on a ~110 unit object). Parts further back are at a lower opacity so the fog shows through.
- rim: the same shape, `dilate 16` then `blur 16`, #4388F7 at full strength. The bluest point sits
  right at the object, like ref-07's dark halo.
- field: ellipse rx 98 / ry 92, blur 30, #4388F7 at .9 (dark .42). This is the all-over sky, fading
  to the page only at the edges.
- grain: `feTurbulence fractalNoise 1.1, 2 octaves`, masked to the haze alpha (none on the object).
  Dark dots: RGB .1/.3/.75, alpha 1.0x-.45. Light dots: white, alpha .7x-.35. The filter must use
  `color-interpolation-filters="sRGB"`, because linearRGB lets the white dots wash the blue out.
- an invisible full-box rect (fill-opacity .002) inside the grain group. Without it, Edge culls
  the top of the haze in cards that start off-screen (fullPage and scrolled shots).
- cut-outs only where the thing needs one to read (tag hole, clock hands, plus, %, eye pupil, coin).

Measured in img/b2-light.png: haze centre **#4F8EF3** vs #4388F7 (dark: #3D76D1), grain std
**5.2** in the haze (ref-08: 5.0).
