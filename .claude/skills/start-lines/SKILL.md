---
name: start-lines
description: Check that every POS page (pos-lab) starts on the same line under its ☰ / ‹ row: 126 on phone, 76 on iPad, the line where Orders' first date band sits. Draws the red line (where pages should start) and the blue line (where each page starts) on screenshots of every page and sub page, phone and iPad, and makes before/after sheets. Use after adding or changing a page, when the owner asks for the "red line / blue line" check or the start lines, or when they say a page starts too high or too low.
---

# Start lines

**The rule (owner 2026-10-31):** every page's first thing sits on Orders' line: **126 on phone, 76 on iPad**.
- Red line = the start line. Blue line = where the page starts.
- Start = the first painted box (a card, the picker, a date band, the receipt; at least 180 wide) or line of words
  (a section title like Settings' "Appearance") under the bottom of the ☰ / ‹ button.
- **Exceptions, left as they are:** Items, Refund, A customer, Item editor, Category editor, Modifier editor, Discount editor.
- On iPad, pages with a list and a detail side (Orders, Customers, An order, Refund, A customer) are checked side by side.

## Run it
The pos-static server must be running (`preview_start {name: "pos-static"}`, 127.0.0.1:8642). Run from the repo root:

1. Before you change anything: `node .claude/skills/start-lines/measure.cjs phone before` and `... ipad before`
2. After your change: `node .claude/skills/start-lines/measure.cjs phone` and `... ipad`
   - Each page prints `ok`, `exc` (an exception) or `OFF` with how far off it is and where the gap comes from
     (the first thing and its parents' top / padding-top / margin-top). Exit code 1 if any page is OFF.
3. `py .claude/skills/start-lines/draw.py phone` and `... ipad`: every page in one sheet (`start-lines-<dev>.png`).
4. `py .claude/skills/start-lines/compare.py`: before | after for every page that moved (`before-after.png`).
5. Send the sheets with SendUserFile. Output goes to `%TEMP%\start-lines\` (set `START_LINES_OUT` to change it).

## A new page
Add one line to `PAGES` in `measure.cjs`: `['Name', ['step', 'step']]`. Each step is JS run in the page, 600ms apart.
Open the page the way a person reaches it, using the app's own openers (`switchView`, `openPayType`, a `.click()`).
If it has a list and a detail side on iPad, add it to `SPLITS` in `measure.cjs` and `draw.py`.
A page the owner says may start elsewhere goes in `EXCEPT`, and on the list above, with the date.

## Fixing a page that is OFF
- Change the shared rule the chain points at, not one page. The rules that set the line today (styles.css):
  - `.frost .page > .c-scroll`: head height + `--rl-gap` (8). Orders' band adds its 8.
  - `.lv .st-page .c-body { padding-top: 8px }`. The first `.fc-t` title gets -1, so its words sit on the line.
  - `.lv .kinds.rp-units` margin -8: Shift's and Reports' picker.
  - `.frost .o-main > .paper-scroll:has(> .receipt-preview)`: the receipt, from the bar's own height.
- Re-run until every page reads `ok` or `exc` on both phone and iPad. Then bump `styles.css?v=`.

## Showing it to the owner
- Only page names and numbers on the pictures. Never invented labels or notes on the screenshots.
- Green number = on the line, blue = off by (+n).
- If Reports reads its date bar instead of Day / Week / Month, the ‹ date › bar is on at rest again: see `regressions/2026-10-31-1200`.
