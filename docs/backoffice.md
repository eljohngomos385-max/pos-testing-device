# Back Office design system (`backoffice.html`, `body.bo-light`)

The POS is dark; the Back Office is **light**. It is a separate design system in the same
`styles.css`, scoped entirely to `body.bo-light`. Everything in `docs/design-pos.md` (dark tokens, shine, gloss)
**does not apply here** — don't carry dark-mode recipes across.

**Authoritative blocks:** `BACK OFFICE — SHOPIFY ADMIN REDESIGN (v21)` holds the tokens/shell;
`BACK OFFICE — CARD SYSTEM (v22)` holds the card markup; `BACK OFFICE — FLAT CARDS (v23)` flattens v22's
tray into one surface; `BACK OFFICE — DENSE TABLES (v24)` sets the width of the list pages;
`BACK OFFICE — ONE FONT (v25)` sits last and holds the font token and the fixed row height
and the width of the list pages. Older back-office blocks sit above all three and are
superseded — **edit v23 for anything about how a card looks**, v21 for tokens, never the earlier
ones, or your change won't paint. Last block wins. Bump `?v=NN` on `styles.css` + `backoffice.js`
in `backoffice.html`.

### The feel
Shopify-admin calm: near-white grey canvas, white cards, **one** black topbar, ink is grey-black
(`#303030`), not pure black. Inter, 13px base, letter-spacing 0. Restrained, dense, data-first.

### Depth comes from hairlines, not shadows
This is the rule that matters most and the one most recently corrected:
- Every card/panel = `background: var(--po-surface)` + `1px solid var(--po-line)` + `var(--po-shadow-card)`.
- `--po-shadow-card` is deliberately **almost invisible** (`0 1px 1px rgba(0,0,0,0.03)`). The border
  does the separating. **Never re-add a heavier card shadow or a `0 0 0 1px` ring on top of the border** —
  ring + border double the hairline and the card starts to float.
- Only genuinely floating layers cast: `--po-shadow-pop` (search dropdown, toast). Nothing inline.
- Buttons keep their own 1px bottom shadow (`inset 0 -1px 0` on primary) — that's a control affordance,
  not elevation. Leave it.

### Radius
`--po-r-card: 8px` — **every card, panel, KPI, box and dropdown is 8px.** No 12px, no 16px.
`--po-r-button` / `--po-r-input` are 8px too, so the whole page is one radius; small inner things
(seg-btn, sr-item, sidebar link) sit at 6–7px so they nest, and pills use `--po-r-pill` 999px.
Pull the token, don't type `8px`.

### Tokens (all in the v21 `body.bo-light` block)
- Surfaces: `--po-bg #F6F6F6` (canvas; #F1F1F1 until 2026-09-19, "too dark") → `--po-sidebar #FAFAFA` (v29) → `--po-surface #FFFFFF` (cards).
  The grey canvas stays: an all-white canvas was tried 2026-09-19 and rejected ("too white").
  Hover is `--po-surface-hover #F7F7F7` for white things, `rgba(0,0,0,0.05)` for grey ones.
- Lines: `--po-line #E1E1E1` default hairline, `--po-line-strong #D2D2D2` for input/button borders.
- Ink: `--po-ink #303030` → `--po-ink-secondary #6B6B6B` → `--po-ink-tertiary #8A8A8A`.
  Headings and values go `#1A1A1A`.
- Semantic pairs, always tint-bg + dark text: `--po-success`, `--po-warn`, `--po-danger`.
  `--po-accent-link #1F5199` is the *only* blue — links/`.link-btn` only, never a button fill.
- Chrome: `--po-sidebar-w 192px` (v29 sidebar, sized from crm-ui-table at ~92%; one grey fill for the active row — a lit sub-link leaves its parent unfilled, no hook line). Drag its right edge to resize (168–320px, double-click resets); the width is a per-device pref in `HWPOS_STORE.ui`, never synced. **There is no topbar** — `--po-topbar-h` is `0px` and kept only
  so the sidebar/main offsets stay expressed in one place. The global search went with it; the
  hamburger survives as a fixed 38px button that CSS shows only below 1024px, where the sidebar overlays.

### Type
Inter. 17px/700 page title · 13.5px/650 panel title · 13px/500 body & rows · 12px secondary ·
11–11.5px labels & subs. KPI value 20px/700. Negative tracking only on headings (-0.01/-0.02em).
**All money and counts get `font-variant-numeric: tabular-nums`** and right-align in their column.

### Layout grammar
- Shell: fixed black topbar (46px) → fixed sidebar below it → `.bo-main` offset by both.
- `.view` is `max-width: 1240px`, centered, `padding: 20px 24px 48px`.
- `.view-head`: title left, `.view-actions` pushed right with `margin-left: auto`.
- `.panel-head`: title left, sub/link right via `margin-left: auto`, `border-bottom: 1px solid --po-line`,
  `padding-bottom: 10px; margin-bottom: 12px`. Every card body row after it is label-left/value-right.
- Grid gutter is **12px** everywhere (`.kpi-row`, `.dash-grid`, `.dash-col`); 16px inside settings.
  Card padding is **14px** (see v23 below). Reach for an existing step — no one-off 13/21px.
- Rows in lists/tables separate with `border-bottom: 1px solid --po-line`, and the **last row drops it**.
- Status/pay pills: tinted bg + dark text + a leading `::before` colour dot. No outlines, no saturated fills.

### One card, one surface (v23) — the structural rule
**A card is a single white box.** Head, body and table all sit on the same surface, separated by
hairlines. There is no box inside a box: two borders, two radii and two greys for one card's worth
of content is exactly what this replaced. Notion does it this way and so do we.

The markup did not change — v23 is CSS only, so every existing page flattened at once:

```html
<div class="bo-card">
  <div class="bo-card-head"><h2>Sales trend</h2><span class="bo-card-sub">vs previous 30 days</span></div>
  <div class="bo-card-inset">…content…</div>   <!-- .flush = padding:0 for tables/charts -->
</div>
```

- `.bo-card` — `--po-surface` white, hairline, 8px, **`padding: 0`**. The children pad themselves,
  so a table can run edge to edge while text next to it stays inset.
- `.bo-card-head` — `13px 14px 11px`, on the same white. Title left; `.bo-card-sub` and any
  `.link-btn` ("Manage inventory →") sit right **in the head**, never under the list — a link below
  the last row reads as one more row.
- `.bo-card-inset` — no longer an inset. Transparent, no border, no radius, just `0 14px 14px`
  padding. `.flush` drops the padding for tables and charts; `.flush:last-child` clips its bottom
  corners to the card's 8px so the last table row can't square them off.
- **Two insets in one card are sections, split by a hairline**, not by a gap
  (`.bo-card-inset + .bo-card-inset` gets a `border-top` and 14px of padding back).
  Sales' Overview splits the other way — `.sales-stats` swaps that for a `border-left`, and the
  media query below 1024px puts it back to a top border when the columns stack.
- Gutter *between* cards stays `--po-gap` 10px (`.dash-stack`, `.dash-grid-2`).
- Everything inside lines its padding up with the head: `.stat` is `12px 14px 14px`,
  `.kpi-body` `13px 14px 0`, `.kpi-foot` `9px 14px 12px`. **14px is the card's left edge** — a new
  child that doesn't respect it will visibly step in or out.

**Separate with a hairline, never with a second surface.** If two things in a card need to be told
apart, the answer is a `1px solid var(--po-line)` between them, a tinted table header strip, or
nothing at all. Reaching for a nested background, a second border or a card-inside-a-card is the
one move this section exists to prevent.

**Sentence case, never caps.** Labels, column headers and axis ticks are plain **Geist** at
11.5px in `--po-ink-tertiary` — no `text-transform`, no wide tracking.

**One typeface: Geist (v25).** `--po-mono` no longer resolves to a monospace face — it resolves
to Geist, same as everything else. What makes a column of money line up is
`font-variant-numeric: tabular-nums`, which Geist has; a second typeface on the same screen just
read as a second design. The token stayed rather than being deleted from ~20 rules, so "this is
a value" still has one name to point at. **Do not set `font-family` on a value** — add
`.num` or `.mono` and let the token do it.

**No line under a card head.** `.bo-card-head` has no `border-bottom`. Where a table follows, its
tinted `th` strip already marks the boundary; where text follows, the head's own spacing does.

**A row that is a link still looks like a row.** `a.mini-list-row` inherits colour and drops its
underline (hover underlines the name only) — blue underlined text inside a list reads as a mistake.

### Adding a new card — the checklist
1. `.bo-card` > `.bo-card-head` > `.bo-card-inset`. Never a fourth level, never a nested `.bo-card`.
2. Table or chart? Add `.flush` and let it bleed. Text, stats or a mini-list? Leave the padding on.
3. Need two regions? Second `.bo-card-inset`, hairline included for free. Not a second card.
4. Every colour, radius and gap comes from a `--po-*` token. If you are typing `8px` or `#E1E1E1`,
   the token already exists.
5. Money and counts: `.num` / `--po-mono` (Geist + `tabular-nums`), right-aligned. Labels: sentence case,
   `--po-ink-tertiary`.
6. Empty? `.bo-empty`, centered tertiary text. Never a blank card.
7. Bump `?v=NN` in `backoffice.html`.

### Sales-trend line chart
`.lc` = `.lc-y` (absolute ₱ ticks) + `.lc-plot` (the SVG) + `.lc-x` (absolutely positioned weekday
ticks, `left: %`, first/last pulled inside). The SVG is `viewBox="0 0 600 230"` with
`preserveAspectRatio="none"`, so **every stroke needs `vector-effect: non-scaling-stroke`** or it
distorts. Layers bottom-up: `.lc-grid` dotted lines → `.lc-area` revenue fill → `.lc-alt` dashed
grey gross profit → `.lc-cur` black revenue. **Both series share one axis** — profit is
always ≤ revenue, so a second scale would only lie about the gap. Hover is HTML, not SVG: invisible `.lc-band` columns delegate
`mouseover` and position `.lc-guide` / `.lc-dot` / `.lc-tip` by percentage (`.at-left`/`.at-right`
flip the tooltip at the edges). **Line only — never bars for the trend.**

**`renderLineChart(el, data)` is the only chart in the product, and it takes any ordered list of
`{ label, title, revenue, profit, txns }`** — it does not know or care whether the buckets are days,
hours or weekdays. Anything that wants a graph builds that list and calls it. Do not add a chart
library, a second renderer, or bars.

### Routing — real URLs (`router.js`)
Path-based, History API, **the URL is the state**:
```
/admin/sales?range=30d&date=2026-09-05
/admin/inventory?q=pvc
/admin/products/p001
```
A pasted link reproduces the screen exactly, refresh lands in the same place, and back/forward walk
the filters. `HWPOS_ROUTER` exposes `start(cb)` / `route()` → `{ view, id, params }` / `go()` /
`setParams()` / `href()`, and intercepts in-app `<a>` clicks so nothing full-reloads.

**`applyRoute()` in `backoffice.js` is the only writer of `state.view`, `state.range`,
`state.anchor` and the search queries.** Controls never mutate state — they navigate
(`Router.setParams({ range: '7d' })`) and the route writes back. `paint()` syncs every control that
mirrors the URL, so a control on an off-screen view can't drift. Filters `replace` history (typing
in a search box must not fill the back button); range and date `push`.

Serving this needs the shell returned for unmatched `/admin` paths — `scripts/serve.py` locally,
one `_redirects` line on Cloudflare Pages. **Assets in `backoffice.html` must stay absolute
(`/styles.css`)**, or they resolve against the route and 404. `router.js` falls back to hash mode on
`file://` so opening the file directly still works.

**Adding a view = one entry in `VIEW_LABELS`** plus the `.side-link[data-view]` and
`.view[data-view]` markup — never a second list.

### Landing page = Dashboard
Head: greeting + **`.range-picker`** + Export CSV. **One control, not two**: the `.range-btn` pill
reads `Last 15 days | Aug 20, 2026` (span left, the day it ends on right of a hairline), and opens
an `.rp-menu` holding the four spans (Today · Last 7 / 15 / 30 days, current one inverted `.on`)
over a hairline with a native `<input type="date" id="dashDate">` labelled "Ends on". Only the menu
is ours — the calendar is the browser's, so the field shows the browser's date format.
`renderDashboard()` repaints the button, the ticked option and the field every render, so the
picker can never drift from `state`.
**Every window ends on `state.anchor`** (the picked day, default today, capped at today):
`rangeStart()` counts `RANGE_DAYS` back from it, `rangeEnd()` is the day after, and the previous
window is the equal span before that. `dayBuckets`/`hourBuckets` read the same anchor, so chart,
KPIs and table always describe one span. `rangeLabel()` says "Today"/"Last 7 days" only while the
anchor *is* today; otherwise it prints the date (`Sep 5, 2026`, `15 days to Sep 5, 2026`).
The Sales page carries the same `.range-select` — one `state.range`, every copy synced on change. Then `.dash-stack`, three rows —
**sales is the centrepiece, everything else supports it**:

1. `.dash-top` — **Sales trend beside Overview**, `minmax(0, 2.4fr) minmax(0, 1fr)`, still **two
   separate cards** (the chart alone ate the fold). Both are flex columns with `flex: 1` insets so
   they match height; single column under 1024px.
   **Sales trend** — the line chart, revenue against gross profit on one shared axis.
   **The range dropdown drives it too** — one control for the whole dashboard: Today plots 24 hourly
   buckets, 7d/30d plot days. `trendBuckets(range)` picks `hourBuckets()` or `dayBuckets(n)` and
   stamps each bucket with its own `label` (x tick) and `title` (tooltip), so `renderLineChart`
   never branches on the range. The chart's total and the Overview revenue are the same number by
   construction; if they ever disagree, the bucketing is wrong.
   **Overview** — head label + `#statRangeLabel` sub (`RANGE_LABEL`), then `#kpiRow`, **one
   `.stat-bar` inset** holding three `.stat` cells **stacked vertically** (`grid-template-columns:
   1fr; grid-auto-rows: 1fr`), split by a single `.stat + .stat` hairline — nothing around them, the
   shared white inset does the grouping; a full box per cell read as three cards —
   **Revenue · Gross profit · Transactions** in that order, money first — label, value, and the
   `.kpi-delta` right-aligned on the value's line. **Value only, no `unit` caption** (the margin %
   and "receipts" were cut) the cell is `space-between` at 25px — label at the top where it
   belongs, the number taking the slack under it (centring the pair dropped the label too low) (arrow + percent, green up / red danger down,
   `vs yesterday` in its `title`). **The sparkline was removed** — the trend chart already draws
   the shape; the delta is the only thing the cell adds. The delta hides behind a `%`
   `.pct-toggle`** in the card head (on by default) (`.stat-bar.show-delta` gates it, choice kept in
   `hwpos.bo.statDeltas`) — the percent isn't wanted every glance. Three numbers in one
   bar, not four trays; avg basket was cut because the dashboard is a glance, not a report.
2. **Recent transactions**, full width, in a `.flush` inset — newest `RECENT_TX` (25) only (it's the
   recents list, not the ledger; Sales > Transactions is where you page through everything) — eight columns,
   **Receipt · Time · Customer · Staff · Fulfilment · Payment · Status · Total**. The column reads
   **Staff**, not "Cashier" — whoever rang the sale isn't always a cashier, and Staff is what the
   nav already calls them. (The field on the order is still `o.cashier`, and so is the CSV header.) `txTime()` prints a bare
   clock for today and date-prefixes anything older, because 7d/30d rows are otherwise ambiguous.
   Fulfilment is plain
   secondary-ink text (`Delivery` / `Walk-in`) so the two pills keep the only colour in the row;
   customer falls back to `—`, not "Walk-in", or the two columns would say the same word.
   `normalizeOrderRecord` in `backoffice.js` must carry `fulfilment` through — the POS writes it,
   the back office normalizer drops anything it doesn't list. Credit sales print **Account**, not the POS's
   "Charge to account" — `normalizeOrder` pins `paymentMethodLabel` to `PAY_LABELS.credit` for that
   kind and honours the stored label for every other (custom names like "Maya").
   **A transaction row opens its receipt.** Every `tr[data-order]` — the dashboard's list and
   the Sales page's, which is the same `TX_COLUMNS` table — opens `#orderDlg`, a native
   `<dialog>` shown with `showModal()`: backdrop, Escape and focus trapping come from the
   browser. It is a **peek, not a route** — no URL of its own, so closing it leaves you exactly
   where you were in a 50-row ledger. `openOrderDialog(id)` and the delegated click live in
   `backoffice.js`, so any page that stamps `data-order` on a row gets it for free; only the
   ledger's rows carry it, aggregate cuts (By item, By category) have no order to open.
   Its classes are **`.bod-*`, not `.od-*`** — the dark POS already owns `.od-*` for its own
   order detail and those rules are unscoped, so the first draft came out black.
   `normalizeOrder` carries `subtotal`, `tendered`, `change` and `deliveryAddress` for it; the
   tables never needed them and it dropped all four.

3. `.dash-grid-3` — Low stock · Deliveries coming · Attendance. Mini-lists cap at 5 rows and
   reserve height for 5 (`min-height`), so a short list doesn't shrink its card.
   **Attendance is read-only here** — one `status-pill` per person (Present · Late · Half day ·
   Day off · Absent, via `ATTEND_LABEL`). The dashboard presents the day; marking happens
   elsewhere. `readAttendance()` reads today's marks from `hwpos.attendance.v1`
   (`{ 'YYYY-MM-DD': { name: mark } }`) and falls back to the seeded `STAFF[].attendance`. **Deliveries coming is a stub**: the POS
   records `fulfilment: 'delivery'` and an address but no scheduled date, so the card renders
   `.bo-empty` until checkout writes an `o.deliveryDate` to list.

Top SKUs and Revenue breakdown used to live here and were **removed** — they belong on their own
page, not in the glance. Don't re-add them to the dashboard.

All numbers derive from `loadOrders()`: `rangeWindows()` gives current + previous windows,
`metricsOf()`/`deltaOf()` the KPIs, `orderProfit()` gross profit (revenue ex-VAT − `cost`×qty).
The tx table shows **every** status — voids and refunds must stay visible.
Empty state is `.bo-empty` centered tertiary text, never a blank card.

### Sales page (`bo-sales.js`)

Seven tabs over one `agg()` pass: Summary · Patterns · By item · By category · By employee ·
By payment · Transactions. **The Summary is a second dashboard, aimed at sales.** **Two blocks over the ledger** —
`.sales-top` is a `1.5fr / 1fr` grid holding Overview and Payment mix, then Recent transactions runs
full width beneath it:

1. **Overview** — one `.bo-card` tray holding **two** `.bo-card-inset.stat-bar` insets side by side
   (`.sales-stats`, `1fr 1fr`), each stacking three `.stat` cells **vertically** with a `border-top`
   hairline between them — the same mechanics as the dashboard's Overview. Left inset is the money
   (**Revenue · Gross profit · Margin**), right is the volume (**Transactions · Average basket ·
   Items sold**). Cells are `statCell()`. Six cells strung across the full width read as six cards
   and pushed the sales below the fold — **don't put them back in a row.** Deltas are always on here
   (no `%` toggle): this page is the report, not the glance.
2. **Payment mix**, beside it, one white inset holding a plain `.mini-list` — name, `N txns · share`
   sub, `.share-bar`, revenue. **Not the table**: the four-column version was more furniture than
   answer, and **See all →** (`data-act="tab" data-by="payment"`) is one click to the real cut.
3. **Recent transactions** — the newest `RECENT` (25) of the window, `TX_COLUMNS`, full width because
   eight columns need it, with its own **See all →** into the Transactions tab.

Both cards in `.sales-top` are flex columns with `flex: 1` insets, so their bottoms line up.

**The summary's table is `sortable = false`.** There is one `?sort` key in the URL and the
Transactions tab owns it, along with searching and paging past 25.

**Top items was removed from the Summary** — By item is an entire tab of it. Same reasoning as the
dashboard: a cut that has its own page doesn't get a preview on the glance.

**The Summary carries a Sales trend chart** (2026-09-12), below the reversal note and above Recent
transactions. It is the dashboard's chart and the dashboard's markup — `trend-head`, `trend-legend`,
`renderLineChart` — with one difference that matters: the buckets are built from **this page's
filtered rows**, not from `state.orders`. `trendBuckets()` in the shell cannot be reused directly
because it ignores the payment and staff selects sitting right above the chart, and a line that
disagreed with the numbers beside it would be worse than no line.

### Sales → Patterns

Three questions the ledger could always answer and never did. **A profile is not a timeline**: the
range is folded, so every Monday in the window lands on one Monday, and every 2 PM on one 2 PM.
"What time do we get busy" is a different question from "what happened on Tuesday", and only the
folded version answers it.

- **Sales by hour of day** — 24 slots, `getHours()`. The card sub names the busiest hour and what it
  took, because that one sentence is the whole reason to plot the profile.
- **Sales by day of week** — 7 slots, **Monday first** (`(getDay() + 6) % 7`). A shop's week does not
  start on Sunday.
- **Walk-in vs delivery** — rides the same `agg()` pass (`fuls`), so it costs no second walk. Each
  side also collects a `top` map of what it sells, and the table prints the highest-quantity item:
  "delivery is 12% of revenue" is half an answer without "and it is mostly PVC pipe". An order with
  no `fulfilment` field is a walk-in, never a third row.

Voids are skipped in every profile — `saleSign` is 0, so they book no money and belong to no hour.
The CSV from this tab is the **hour** profile; the weekday chart is seven numbers anyone can read
off the screen.

### One width for every page

`body.bo-light .view` is `max-width: 1560px` and **nothing overrides it**. Products and Inventory
were once widened for their columns while the rest sat at 1240px, so moving between pages slid the
whole layout sideways. The widest table sets the width and every page keeps it, full or empty. A
new page that wants to be narrower is wrong about the page, not about the token.

### Tables are dense and the list pages are wide (v24)
A row is one line of text. `6px 14px` on a cell, `7px 14px` on a header, and nothing in a data
cell wraps — long SKUs and supplier names scroll sideways inside `.table-wrap` rather than
doubling every row's height. If a cell needs a second line, it is the wrong cell.

`.view` is 1240px, but **Products and Inventory are 1560px** — they hold columns, not prose.
Don't widen the dashboard or a settings page to match; reading down a form wants the narrow measure.

Where a table has few columns (Inventory's four), every column after the first gets `width: 1px`
so it shrinks to its content and the product name absorbs the slack. Without it the columns drift
apart on a wide page and the eye has to travel.

### Products — the column chooser
The catalog answers "what is this and what does it cost", so it carries the definition columns.
**Which of them are visible is the user's choice**, kept in `hwpos.bo.pdCols`, not in the URL: it is
a display preference that should follow the person, not the link they paste to a colleague.
**Status is off by default** — stock levels are Inventory's answer, and printing them on a price
list is the duplication this split exists to remove.

Every `th` and `td` carries `data-col="<key>"`; `applyCols()` toggles one `hide-<key>` class on
`#pdTable` and CSS hides the cells. **A toggle never re-renders a row.** Adding a column means
one entry in `COLUMNS`, the `data-col` stamp on the header and both row builders
(`rowHtml` and `groupRowHtml` — the family row is easy to forget), and one selector in
`bo-products.css`.

### Inventory — four columns and a popup
The On hand tab answers two questions: how many are there, and is that a problem. So it is
**Product · On hand · Status · Adjust**, and nothing else. SKU, danger level, value at cost and
the category sub-line were all removed: the category `<select>` above the table replaces the
sub-line, Needs buying is the whole page for danger levels, and Movement history is the whole
page for the log. Stock value at cost survives as a KPI, where one number belongs.

**Adjust opens `#adjustDlg`, a native `<dialog>`.** It used to expand a row inline, which pushed
every product below it down the page. The dialog element is rendered **inside the view root**, at
the end of `shell()`, so the module's `mine(e)` event gate still matches it — `showModal()` puts it
in the top layer regardless of where it sits in the DOM. Last movement lives in its footer: it
only matters once you are about to move the stock.

**One control asks what happened, not two.** Reason and Mode were the same question twice: the
mode silently overrode the reason, and most of the fifteen combinations were nonsense. `ADJ_EVENTS`
is now the whole vocabulary — six named events, each carrying its own `reason:mode` pair:

| What happened | Logs as | Sign |
|---|---|---|
| Received new stock | `delivery` | + |
| Customer return | `return` | + |
| Transferred in / out | `transfer` | + / − |
| Damaged, lost or used | `adjustment` | − (note required) |
| Counted the shelf | `count` | set to the counted number |

A delivery is the only thing that adds stock blindly; **any other upward correction is a count**,
which is what a shop actually does when it finds more than the screen says. Sale is deliberately
absent — the POS writes those against a receipt, and a hand-typed one would move stock with
nothing behind it. The history filter and the multi-line adjustment document still list all six
`STOCK_REASONS`, because those read and group rather than write them.

**The dialog does not ask for a unit cost.** Nothing is bought on a count, a transfer or a
breakage, so there is no price to type; the movement takes the product's cost through the existing
fallback in `stockMovement()`, and Movement history still prints the stamped figure. A cost that
differs from the product's own therefore only enters the log where a document supplies one — a
received purchase order.

**Closing is wired once, in `backoffice.js`, for every back office dialog** — a click on
`.bod-close` closes whichever `<dialog>` it is inside, and a click that lands on a `DIALOG`
element itself is the backdrop. Never add a per-dialog close handler.

### One row height, everywhere (v25)

**Every back office table row is the same height, on every page.** The cell sets
`height: var(--po-row-h)` with zero vertical padding, so a row of plain text, a row with a status
pill and a row with an Adjust button all measure the same. Before this, Inventory's rows stood
half again as tall as Movement history's — the 32px `.secondary-btn.small` in the Adjust column
was setting the height, not the padding.

**The height is a setting.** Settings → Appearance → *Back office row size* is an S/M/L control
that writes `hwpos.bo.density` and stamps `data-density` on `<body>`; `applyDensity()` in
`backoffice.js` runs at the top of `init()`, before the first paint, so nothing resizes on screen.
Only two tokens change, which is why changing size never re-renders a table and no page has to
know the setting exists:

| `data-density` | `--po-row-h` | `--po-row-font` |
|---|---|---|
| `sm` | 27px | 12px |
| *(none)* / `md` | 32px | 13px |
| `lg` | 42px | 15px |

It is a **display preference, not a store setting** — it stays on the device, like tile size, and
never syncs. Bad eyesight belongs to the person at the screen, not to the business.

Four rules follow from it:

- **Anything sized inside a row derives from `--po-row-h`.** `.secondary-btn.small` in a cell is
  `calc(var(--po-row-h) - 8px)`; `.status-pill` drops its vertical padding. A new inline control
  with a hardcoded height looks right at M and breaks S and L.
- **Nothing in a row may wrap.** `td`/`th` are `white-space: nowrap` and `.table-wrap` scrolls
  when the row will not fit. A fixed height is only fixed if the content is one line — Suppliers
  ran 20px over everyone else at L because its phone column broke across three lines.
- **Set `line-height` in the cell as a *length*.** Unitless inherits as a multiplier, so a smaller
  inline child gets a shorter line box and the two stack into a line taller than either.
- **A second fact goes beside the name, never under it.** Use `<span class="row-sub">` (inline,
  two below the row font, tertiary, capped at 140px and ellipsised), not `<div class="muted-sub">`.
  A stacked sub-line is a second row's worth of height for something that is rarely a second row's
  worth of information — it is what made Suppliers, Customers and Inventory each taller than the
  next.

### Inventory — what a stock page is for

Six columns: **Product · Category · On hand · Sold 30d · Status · Adjust**.

- **Category is a column, not a sub-line.** The filter above the table narrows; the column tells
  you what you are looking at while you scan. Both are needed.
- **Sold 30d is the point.** "47 on hand" answers nothing on its own — 47 of something that
  sells 40 a week is nearly out, 47 of something that sells one a month is dead money. It comes
  out of the movement log that is already loaded (`sold30` in `bo-inventory.js`), so there is no
  new state. Nothing sold in the window prints `—`, not a zero that reads like a measurement.
- **Days left was removed (2026-09-12).** Days of cover is on-hand divided by that same rate, so
  it restated the column beside it, and it was blank on every product that had not sold in a
  month — most of the table. The decision it was there to serve, what to order and how urgently,
  lives in Needs buying, which already sorts by danger level.
- **The category `<select>` excludes the built-in `all` folder.** `data.js` seeds
  `{ id: 'all', name: 'All Items' }`; as an option it reads as a second "All categories" and
  filters to almost nothing. Products already filtered it out — Inventory does now too. Any new
  folder dropdown must do the same.

### Inventory → Cost changes

The bug this tab exists to surface (2026-09-12): `receivePo` stamps the delivery's real
`unitCost` onto every movement, and **nothing ever writes it back to `product.cost`**. So when a
supplier's price moves and nobody retypes the cost, the shelf price stops earning the margin it
was set to earn, and Sales keeps subtracting the stale cost — reporting a gross profit that was
never made. The log already knew. `costDrift(products, movements)` is just the comparison.

- **`lastPaid()` reads only `reason === 'delivery'` movements.** A sale or an adjustment says
  nothing about what a supplier charges. Latest `ts` wins, per product.
- **Percent, not pesos, decides what is worth showing.** `DRIFT_MIN = 1` percent: a ₱20 rise on a
  ₱1,200 item is noise, the same rise on a ₱60 item is the whole margin. The sort is by magnitude
  of percent for the same reason.
- **A product with no cost on file is the worst row on the page, not a 0% row.** Every sale of it
  has booked the whole price as profit. `gapPct` is `null` there, it sorts first, and it gets no
  suggested price — it has no margin to hold, so that decision belongs in the product editor.
- **The suggested price is read off `cost` and `price`, never off the stored `marginValue`.** That
  field is only as fresh as the last time somebody opened the editor, and a stale `0` in it would
  price the product at cost.
- **Apply writes cost *and* price together.** Writing the new cost alone would fix the reports and
  quietly leave the shelf earning less. One decision, one button.
- **No "apply all", deliberately.** Some rises get absorbed to hold a customer, some get passed on
  the same day. A bulk button makes that judgement for every product at once, silently. The
  product name is a link into the editor for anything that needs more thought.

### Insights — the data an ordering model reads (2026-09-14)

`/admin/insights` is `bo-insights.js`. `buildInsights(data, { now })` is pure and runs in node
(`scripts/insights-check.mjs`); `dataFromDump()` accepts a snapshot or raw storage keys. The page
has one tab per section (cash tied up, reorder, stockouts, dead stock, sell-through, lead times,
customer cycles, basket, deliveries, staff, counts, lost sales, prices, days). **Nothing it computes
is stored** — `HWPOS_AI.snapshot().insights` and **Export for AI** rebuild it on read. Export writes
every collection plus insights and the field dictionary as one JSON file.

Its date key is a fixed UTC+8 (`TZ_MIN`), never `ts.slice(0, 10)`.

**Cash tied up is the first tab** (2026-09-14, the owner asked for it by name). Two things:
- **How long the cash has sat.** Stock on hand at cost, split 0–15, 16–30, 31–60, 61–90 and 90+
  days. The split walks stock-in movements newest first, because the oldest stock sells first.
- **Money in and out over the last 15 and 30 days.** Bought, sold at cost and lost.
No new capture is needed. It reads the movement log and the `unitCost` that sales and deliveries
already stamp. `cashAsleep` stays in the data; its tab was folded into this one.

**The day spine** (`hwpos.days.v1`, one upserted row per local date) is filled by the Days tab's
button: Open-Meteo archive and forecast (free, no key) for rain, rain hours while open and max
temperature, plus Nager.Date holidays and paydays (15th and month end). Forecast rows are marked
`open-meteo-forecast` and re-fetched until the day is past.

### Needs buying — on `suggestQty`, `reorderPlan` parked (2026-09-14)

Needs buying lists every product at or below its typed **reorder point** (`isLow`), grouped by
supplier, most urgent first, and suggests `suggestQty`: top up to twice the reorder point. That is
the placeholder, on purpose. `reorderPlan` (bo-insights.js) is **parked until the capture layer has
data** (the till event stream, lost demand, real lead times), so no new maths drives ordering yet.
It still renders on the Insights reorder tab; do not wire it back or extend it without the owner's
OK. Create purchase order still writes one `decisions` row per line (`rule: 'suggestQty v0'`, inputs
`onHand, reorderPoint`). `scripts/inventory-check.mjs` asserts the list and the rows.

### Inventory — reasons and count variance

Losses are three events, not one adjustment: **shrinkage** (lost or stolen), **damage**, **writeoff**
(expired, unsellable), with `adjustment` left for used or other with a note. A count movement keeps
`expected` and `counted`, so variance survives the correction. A count that matches writes nothing.

### Suppliers — what gets captured

Supplier detail: **order days** (seg buttons, `orderDays` 0 = Sunday), **minimum order** in pesos,
**quoted lead days**. A PO carries `sentAt` (stamped by Mark ordered) and **Supplier promised**
(`promisedAt`), which the dashboard's Deliveries coming prefers over `expectedAt`
(`SUP_RULES.dueDate`). Receiving asks per line for **invoice cost** (written onto the delivery
movement's `unitCost`, so Cost changes sees what was billed) and a **short reason** when less
arrived than was still to come. **Conversation** on a PO or supplier appends the pasted message to
`hwpos.supplierMessages.v1`.

### Backdating when stock was really there (2026-09-14)

Stock isn't always entered the day it arrived, so four places let a person say "this was really
here since —" instead of stamping the moment they typed it: the Adjust dialog on Inventory's On
hand tab ("In store since" for events that add stock, "Happened on" for events that remove it),
the adjustment/stock-count document's own Date field, the product editor's opening quantity ("In
store since", plus an optional `in_store_since` CSV column on import), and Suppliers' receiving
dialog ("Arrived on"). Every one of these is a `happenedOn` (`'YYYY-MM-DD'`, local) passed into
`makeMovement`/`receivePo` (bo-model.js) — **`ts` never changes, it stays the moment the entry was
typed**; `happenedOn` is when the stock really moved. Insights and any report that cares how long
stock sat on the shelf reads `happenedOn` (falling back to `ts` when absent, on movements written
before this existed). A full receipt also back-dates `po.receivedAt` to local noon of the arrival
date (or now, if it's today), and a PO's `sentAt` — set once by Mark ordered — stays editable
afterward from its own "Sent on" field on the PO detail page, so `sentAt → receivedAt` lead time
reflects when things actually happened, not when someone got around to the computer. CSV import
also refuses a new-product row with `stock > 0` and no cost: importing it at cost 0 would make that
stock's value invisible on every margin report until someone noticed. A row that matches an existing
product is never refused for it — its stock is ignored anyway.

### Staff — clock in and out

The Attendance tab has a Clock in / Clock out button per person. Each tap appends one
`hwpos.clock.v1` row (`staffId`, `staffName`, `in`|`out`); hours are paired in→out per person per
date and shown beside the day mark. The day mark itself is unchanged.

### Decision log

`hwpos.decisions.v1` records what a rule suggested and what the person did: one `reorder` row per
PO line created from Needs buying, one `reprice` row per Apply in Cost changes. Rows name
`inputs`, `rule` with a version, `choice` and `accepted`. **Every back-office event row names
`actor()`** (backoffice.js) — the store's cashier setting until there is a login.

### Customers — the account page

`/admin/customers` is the list; `/admin/customers/<id>` is one account's history. The id is on the
URL (`state.detailId`), so a link to a customer is shareable, and one `renderCustomers()` picks the
screen. Clicking a row navigates; the back link lives above the page title, not between the cards.

The history is three cards: the account's facts, **Transactions** (paginated, each row opens the
existing `#orderDlg` receipt via the delegated `tr[data-order]` handler — no new dialog), and
**Items bought**, one line per product across every order. Voided and refunded orders stay in the
transaction list because they happened, but they are excluded from spend, averages and the item
rollup.

### Customers — adding one, and the statement

**Add customer** / **Edit** open `#custDlg`, the same `.adj-*` small form the inventory adjustment
uses. Those classes are **not scoped to `.view-inv`** — they are the back office's one small-form
dialog, shared by Customers and by Staff's cash advance. The balance is never a field on that form:
it is the sum of what was charged and what was paid, and typing over it makes the ledger and the
account disagree. A saved record is written under its own id ahead of the seeded list, so editing a
seeded customer overrides it instead of duplicating it.

The **Statement** card replaces the shop's paper workflow: keep a customer's receipts in a pile,
total them by hand when they finally pay. Nothing new is recorded to make it work — an order
charged to account already carries a `{ method: 'credit' }` entry in `o.payments`, so `creditOn()`
plus a date range over `customerOrders()` reproduces the pile exactly. The range lives on the URL
(`?from=&to=&all=`) like every other filter, `Include cash sales` widens it to every receipt, and
**Export CSV** writes date / receipt number / items / charged / receipt total. Voided and refunded
orders are excluded from the money, the same rule the rest of the page follows.

### One product, several suppliers

`supplierId` stays the **primary** — a purchase order and a reorder list each need one answer to
"who do we buy this from". `altSupplierIds` on the product is who else stocks it, for the day the
primary cannot deliver. `supplierIdsOf(p)` in `bo-model.js` is the one helper that returns primary
first then the backups; `normalizeProduct` dedupes it and drops the primary from it, so the two
fields can never disagree.

Three places read the helper and nothing else needs to: the Products supplier filter (a product
shows under **any** supplier that carries it), the Suppliers aggregation (a product lands in every
one of its suppliers' lists, so counts and on-hand values **overlap between suppliers on purpose**
— each line reads "what this supplier can sell us", not a slice of the warehouse), and the
products list column, which prints the primary and `+N` for the rest. Inventory's reorder grouping
deliberately still uses `p.supplierId` alone, so PO creation is unchanged.

The editor control is a plain `<select multiple size="4">` — native, no widget, and `collect()`
reads it with one extra branch. Like `aliases`, the field is client-side only: it is not in
`schema.sql` or the Worker's column list, and a proper sync needs a join table, not a text column.

### Payroll — what is left on payday

The Staff page's **Payroll** tab answers one question: how much cash does this person get. Monthly
salary, less days not worked, less cash already drawn. A **day off** costs nothing (the shop gave
it), an **absence** costs a full day at the daily rate, a **half day** costs half of one. Cash
advances live in `hwpos.advances.v1`, append-only money rows that are in `BACKUP_KEYS` with the
orders — voiding one is a flag, never a delete. Net pay is **allowed to go negative**: someone who
drew more than they earned owes the difference, and flooring that at zero is how a shop loses money
quietly. `unpaidDays` / `absenceCut` / `netPay` are exported and gated by `scripts/staff-check.mjs`.

### The product editor — Save is at the bottom

The editor is a form you fill top to bottom, so **Save sits at the end of it**, not in the page
header. `formBar()` in `bo-products.js` renders the closing `.pd-formbar` for both the single
product and the family editor; the header keeps only the way back to the list. The same bar holds
**Archive**, pushed to the far left with `margin-right: auto` — a destructive verb never shares an
edge with the one people aim for.

**Archive asks first**, with a native `confirm()`, the way cancelling a purchase order already
does in `bo-suppliers.js`. It is reversible from the very same button, so it wants the pause, not
a designed dialog — and **Restore asks nothing**, because putting something back is not
destructive.

**Archive is quiet.** It is a `.link-btn.pd-archive` — tertiary grey, 12.5px/500, red only on
hover and `:focus-visible` — the same treatment the variants table's Remove already uses. A
full-size bordered red button beside Save made the destructive verb the loudest thing on the bar.

**Save returns to the list.** You came from the table, you finished the product, you go back to the
table — staying on a saved form invites a second save of the same thing.

**Two columns, 930px, centred.** The single-product editor is `.pd-editor`, a grid of
`minmax(0, 1fr) 300px` with `--po-gap` between: a 620px **main column** — Details (Name, Brand,
Image) · Sold as · Pricing · Inventory · Variants — and a 300px **rail** holding **Organization**
(Category, Supplier, Also stocked by) and **Specs**. The rail is what files the product; the main
column is what you price and stock. A 620px form alone on a 1560px page was 900px of nothing to
its right, and the page width is not negotiable (see *One width for every page*), so the form
grew a second column instead of the page shrinking.

`.pd-editor` and the head that precedes it (`.pd-editor-head:has(+ .pd-editor)`) carry
`width: 100%; max-width: 930px; margin-inline: auto`. **The `width` is load-bearing**: `.view` is
a flex column, and an auto cross-axis margin switches off the stretch, so without it the shell
shrink-wraps its content instead of its cap. `.pd-formbar` is `grid-column: 1 / -1` — Save closes
the whole form, not one column of it, and its right edge lands on the shell's. Below 900px the
grid drops to one column and the rail stacks under the main column.

**Price history is its own page, not an editor card** (2026-09-19, the owner: having to open the
editor to find it is "not the best"). It is Inventory's `prices` tab with its own sidebar link under
Stock (`/admin/inventory?tab=prices`): every `priceLog` row, newest first, filtered by the page's
search and category. The editor's Pricing card only links to it (`?q=<product name>`). Nothing new is
recorded; `saveProducts` and the POS already diff every save into `priceLog`.

**Payments is a Manage page that drives the POS checkout grid** (2026-09-19; GCash is Philippine-only,
so a store elsewhere must be able to hide it). It writes `settings.payments = {hidden: [kind], custom:
[name]}`; the POS `applyPayMethods()` hides those cards and inserts one card per custom name. Cash can't
be hidden. A custom card sells as kind `other` with the name as `paymentMethodLabel`, so reports need
no new kind and removing a method never rewrites past sales. Edits sit in a draft until Save (toast
"Payment methods saved"); reopening the page drops an unsaved draft. Owner-only by default (`ACCESS_VIEWS`).
Settings aren't in D1 yet, so this reaches other tabs on the same device, not other terminals.

**The family editor stays one full-width column** — its variants table wants every column it can
have — and the `:has(+ .pd-editor)` guard is what keeps it out of the cap. Its head is now full
width too; it used to be capped at 620px above a 1560px table.

A row is a two-track grid of `200px minmax(0, 380px)` — a settings form is read label-then-control,
and a metre of nothing between the halves is what the measure prevents. Note that the shared v25
`justify-content: space-between` is a valid grid property and will shove the control track to the
right edge, so the editor restates `justify-content: start`. **In the rail the label sits over its
control** (`.pd-rail .setting-row` goes to a single `minmax(0, 1fr)` track) — 300px has no room for
a 200px label track. Same `.setting-row` / `.pd-control` / `.pd-hint` markup, one CSS override; do
not grow a parallel set of row classes for the rail.

### Sidebar (v26–v27)
One flush full-height column (the user rejected an inset floating island): **location switcher** on
top (business name small, location big, because the location is what you switch), then four
sections (2026-09-19, the owner asked for "1 click deep, not a lot when a dropdown is open"):
`Main menu` (Dashboard, Sales, Transactions, Customers), `Stock` (Products, Inventory, Needs buying,
Purchase orders, Suppliers), `Reports` (Stock health, Buying, Customer habits, Days & staff -- the
Analytics view split four ways) and `Manage` (Staff, Attendance, Settings). Daily-work sub-pages
are their own links; reports stay in a tree. **Rule: nothing sits more than one fold deep, and an
open tree holds at most ~6 items.** Section labels are buttons that fold their links
(`aria-expanded`, remembered per device in `HWPOS_STORE.ui` `sideFolded`, never synced). Section
folds and page trees share one animation: `SIDEBAR FOLDS (v30)`, a one-row grid sliding
0fr <-> 1fr around `.side-fold-in`; don't swap it back to `display: none`. The chevron on any page
with a tree opens that tree in place (`.open`) without navigating; clicking the name navigates. **Every dropdown animates** (`DROPDOWN MOTION (v31)`, CSS only):
menus keep opening with `hidden` / `<details>`, and the CSS fades and drops them 4px using
`@starting-style` + `display ... allow-discrete`. A new dropdown adds its class to that rule. Tried and rejected, don't redo:
six labelled sections with every sub-page as its own link ("stuff gets lost"), and a bare
Shopify list with no labels or chevrons ("too much like Shopify"). Then then the **account switcher** as a card (name + role, no avatar).
Outline icons in muted ink; the active page is a white pill. Menus: `renderSwitchers()` in
backoffice.js, run on every paint. Until a stores table exists there is one location (first part
of the store address); picking an account sets `settings.store.cashier`, which `actor()` reads.
It needs a PIN once there is a login.

**Pages have no tab strips; their sub-pages are an accordion tree in the sidebar.** A module
registers `globalThis.HWPOS_SUBNAV[view] = { param, def, items: [[key, label]], groups? }` next to
its own tab list (globalThis, not window, because the node checks load modules bare);
`buildSubnav()` renders it and `paint()` marks the active leaf from the URL param. The tree opens
while its page is active; clicking the active page again folds it. `groups: [[label, keys]]` adds
a second fold level, and opening one group closes its siblings (Analytics uses it).

A sub-page can be brought out as its own sidebar link:
`<button class="side-link" data-view="inventory" data-sub="reorder">`. `data-sub` may list several
keys (`data-sub="cycles basket deliveries"`): the link opens the first and carries all of them as
its own tree -- that is how Analytics splits into four short entries. Its `groups` are no longer
reached (no plain Analytics link); the nav markup is the grouping now. `goSub()` navigates them,
`paint()` lights the deep link when the URL's sub-page has one (else the view's plain link), and
`buildSubnav()` leaves those keys out of the tree -- a view whose every key has a link gets no tree
and needs no plain link.

**Analytics** is the page title of the `insights` view (the sidebar shows its four report links). The key, URL and role-access entry stay
`insights`, so saved links and access maps keep working. Its page title is the report name.
CSS: `SIDEBAR SWITCHERS (v26)` + `SIDEBAR LOOK (v27)` + `COMPACT SIDEBAR (v28)` (Shopify density:
~27px rows, no dividers, flat white active row; keeps the v27 muted grey ink -- the user rejected
darker, bolder nav text), last in styles.css.
