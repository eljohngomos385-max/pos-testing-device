# Back Office design system (`backoffice.html`, `body.bo-light`)

The POS is dark; the Back Office is **light**. It is a separate design system in the same
`styles.css`, scoped entirely to `body.bo-light`. Everything in `docs/design-pos.md` (dark tokens, shine, gloss)
**does not apply here** — don't carry dark-mode recipes across.

**`design.html` is the block catalogue** — open it in a browser. It loads the real `styles.css` and
renders every block with the real class names, so a block cannot look right there and wrong in the
product. Find the block, copy its markup, fill it with data. **If no block fits, add one there
first**, then use it. It also carries the Don't list and what we borrow from Polaris / Primer /
Carbon. This file stays the *why*; `design.html` is the *what*.

**Authoritative blocks:** `BACK OFFICE — SHOPIFY ADMIN REDESIGN (v21)` holds the tokens/shell;
`BACK OFFICE — CARD SYSTEM (v22)` holds the card markup; `BACK OFFICE — FLAT CARDS (v23)` flattens v22's
tray into one surface; `BACK OFFICE — DENSE TABLES (v24)` sets the width of the list pages;
`BACK OFFICE — ONE FONT (v25)` sits last and holds the font token and the fixed row height
and the width of the list pages. Older back-office blocks sit above all three and are
superseded — **edit v23 for anything about how a card looks**, v21 for tokens, never the earlier
ones, or your change won't paint. Last block wins. Bump `?v=NN` on `styles.css` + `backoffice.js`
in `backoffice.html`.

## Calm pages — Dashboard, Sales › Summary, Sales › Transactions (2026-09-25) — overrides the Dashboard, Summary and Transactions notes below

Ported 1:1 from the owner-approved labs: **`dashboard-calm-lab.html` is the Dashboard,
`sales-calendar-lab.html` is Sales › Summary, `transactions-lab.html` is Sales › Transactions.** The labs stay the spec; change a lab first, then port.

- **`bo-calm.css`** is the labs' `<style>` verbatim, prefixed: lab `body` → `body.bo-light .calm-dash` /
  `.calm-sales`, `main` → `.c-main`, `aside` → `.c-aside`, every other selector scoped under the root.
  The labs' `--b-*` tokens are mapped onto the app's tokens in its first block. Nothing else styles these
  two pages — not `bo-blocks.css`, not `bo-sales.css`.
- **`node scripts/design-check.mjs`** is the gate: it opens each lab and its app page in Edge on the same
  data and compares computed styles and sizes selector by selector. Run it after touching either page.
- **Dashboard** (`backoffice.js`, "Dashboard (dashboard-calm-lab.html"): greeting + one `.pick` button
  (range + comparison menu, a native popover), the KPI strip whose tabs pick what the bars show, bars per
  hour (today, store hours) or per day, Recent transactions (20), and a fixed rail: daily target, monthly
  target, low stock (top 5 by days left), payment methods. The window always ends now. Bar and receipt
  pop-ups are `#dashPop`. State is all in the URL: `range`, `vs` (''/day/none), `chart` (rev/gp/n/mg),
  `at` (hour or ISO day), `receipt`. **Gone:** Edit (custom rail), the % toggle, Export CSV, "Ends on".
  "Set target" opens the same `openTargetDialog()`.
- **Sales › Summary** (`bo-sales.js`, `calendar()`): month or year calendar with its own window — it
  ignores the range picker and filters (the other tabs keep them). **One period control** (owner 2026-09-26, replaces the Month/Year segment + stepper): `‹ [September 2026 ▾] ›` joined into one group, its `.pick` menu (`#calRange`) This month · Last month · This year · Last year, then **Compare to**: Previous month · Same month last year · No comparison (a year: Previous year · No comparison). **No comparison is the default**: no strip chips, no Top 10 Trend column, no chip in the day/week pop-up; comparing puts "vs August" on the button. A finished period compares with the whole one before; the one you're in, with the same days so far (`calCompare()`, tested in `scripts/sales-check.mjs`). No Trend column when the compared period sold nothing. URL: `view` (year), `month`, `vs` (''/prev/year),
  `day` / `week` (a centred pop-up over the calendar since 2026-09-26, not a side panel; its sections are widget cards; backdrop, ✕ and Esc close it), `top` (the Top 10 card's `.pick` menu `#calTop`, not a `<select>`; its See all opens the Items tab). Sales stays in its own 1180px frame, narrower than Dashboard/Transactions. **Gone:** the Summary blocks grid, `#staffDlg`, the Summary CSV. Strip (owner 2026-09-26, to read like the
  Dashboard's): Revenue · Gross profit · Receipts · Margin · Target (month view), the calendar card's tabs (URL `chart`). No Best or Slowest stat
  (Best dropped 2026-09-26): the best finished day (month) keeps its heat and gets a white "Best" tag in the top right corner (a green dot on a phone); the slowest a red "Slowest" one;
  the slowest finished day (month) is red on the calendar instead (`.loss`, "Slowest day" in the legend), unless it beat the bar.
- **Sales › Transactions** (`bo-transactions.js`, `txPage()`, root class `.calm-tx`; its own view `/admin/transactions`
  since 2026-09-26 so it can be worked on apart from Sales; `renderSales` forwards old `?by=tx` links, filters kept):
  **List | Breakdown** `.pd-switch` (no title, owner 2026-09-28) · **black** Export CSV (List only, left of the range) · range `.pick`. Export CSV (`.btn`, the app's primary look, with the download icon); search + three filter
  `.pick`s (payment, staff, fulfilment — popover menus that stay open while you tick); one card, "All
  transactions ₱net" (the net faint, ink-3, beside the name; no "n shown", owner 2026-09-25) and Clear
  filters; Time and Total sort; 50 a page (like Products) with a 34px pager band, "1–50 of N" left, 24px ‹ ›
  right. A row opens the
  Dashboard's `receiptPop()` in the page's own `<dialog>`, ‹ › walking the filtered, sorted list. URL: `pay`,
  `staff`, `ful`, `q`, `sort`/`dir`, `page`, `receipt`, plus `range`/`date` and `view`. **Breakdown** (`?view=breakdown`,
  owner 2026-09-28; the blocks were a Widgets rail beside the table from 2026-09-26, now **no Widgets menu** here —
  the in-page switch keeps you on the page, one click away): the same search, filters and range as the List, the
  blocks full width under them — Net sales one line across, then Payment and Staff (pesos first, every staff
  member) and Fulfilment (count first), the second number always showing. No graphs or bars. A block row ticks its
  filter; each block ignores its own filter. Channels and Stores join as more blocks later. The old `txShow` key
  is no longer read.
  The range menu keeps **Ends on**
  (`data-app-only`, which design-check strips) so receipts older than 30 days stay reachable. CSV = the
  filtered, searched, sorted rows.
- **Widgets menu** (owner 2026-09-26): Show all · Hide all side by side at the top, then one tick per block.
  **Rail order = tick order** (owner 2026-09-28): a tick puts that card last, Show all adds the rest in menu order;
  the menu itself stays in its fixed order. One helper set in `backoffice.js` serves the menu (the Dashboard's; Customers
  and Transactions dropped theirs 2026-09-28): `widgetsOn(page, W)` / `widgetsMenu()` / `widgetsTick()`, stored as an ordered list in
  `HWPOS_STORE.ui` `<page>Show`; with no `<page>Show` yet, the old hide list `<page>Hide` sets it (menu order).
  Showing or hiding redraws through `slideRender()` (`backoffice.js`): the table slides its width (260ms), the
  widgets fade in alongside it (40ms behind, table on top, both land together); rail cards carry `data-rail="id"` so one that stays glides (FLIP) to its new place. A `display: contents` table column is measured and animated through its children (Transactions used it; no page does now). No View Transitions, no fly-in (owner: "cringe"); a plain fade only.
- **Customers** (root class `.calm-cust`, the `:is(.calm-tx, .calm-cust)` rules): Outstanding credit, Credit limit
  pool, Utilization, Near limit in **one thin strip over the filters** (`#custStrip`, owner 2026-09-28; a Widgets rail
  from 2026-09-26, now **no Widgets menu** — four single totals aren't worth a click or a switch, and they're why
  you open the page). Always on, four across (two by two under 900px), hairlines between, the note when you point
  at a figure. **Near limit is a button** for `?status=Near limit` (tinted while on); its count uses `custStatus()`,
  the filter's own test. The old `custShow` key is no longer read. The account page keeps its figures, inside its
  one account card.
- **Every list page has one layout** (owner 2026-09-26): title + actions, then `.list-filters` (search first and
  growing, filters after it), then the `.blk-table` card. `.blk-table` in `bo-blocks.css` is the Transactions
  table: 36px head with a faint count, no stripes, 34px hairline rows. Never put the search in the title row or a card head.
- Helpers both pages share, next to `deltaOf()`: `pesoK` (₱12.3k), `hourShort` (9a), `calmMetrics`,
  `calmChip` (the trend chip, right of the number).

## Blocks (v35, 2026-09-22) — read this first, it overrides everything below

**`bo-blocks.css` is the one place the back office's look comes from.** It is ported from the lab
file `blocks-v2.html` and loaded **last** in `backoffice.html`, after `styles.css` and every
`bo-*.css`, so it wins. Every piece of UI is one block type, marked by a class on `.bo-card`:

| Class | Block |
|---|---|
| `.bo-card` | the shell: `--blk-bg` grey, `--blk-r` 12px, inset hairline. Every card is one. |
| `.blk-kpi` | label, then number left with its `.trend` chip **right, on the same line**. Label → number is `--kpi-gap` 8px on every KPI and rail card, whatever sits below |
| `.blk-list` | striped `.mini-list-row` rows (the white row is the stripe), no count in the head |
| `.blk-chart` | `.blk-head` (`.blk-head-value` + `.trend`), `.blk-keys` switches, `.blk-plot` |
| `.blk-table` | white card, `--tbl-shadow` = the cards' `--blk-outline` hairline, lifted by the shared `--card-shadow`, tinted header, hairline rows **and** stripes on rows 2, 4, 6… (`--tbl-stripe`, owner 2026-09-22; the first row stays white under the tinted header) |
| `.blk-empty` / `.bo-empty` | label + one centred line |
| `.btn` `.primary-btn` `.secondary-btn` `.seg-btn` `.pbtn` | 28px lab buttons and pill filters |
| `.status-pill` | 20px pills |

Layout: `.blk-grid` (auto-fill units of `--blk-unit`), `.w2` / `.full` spans. **Dashboard layout** (owner, 2026-09-22, from `dashboard-lab.html`): `.dash-stack` is
a fixed main column plus a widget rail `--rail-w` wide. **Its rules are scoped to `#dashStack`, never `.dash-stack`** — that class is every page's plain card stack (Sales, Inventory, Staff, Suppliers…), and styling the class turned every page into a dashboard. It drops to one column under 1024px.
- **Main is fixed.** It is the same in every store and nobody edits it:
  - the Sales trend card `#dashTrend` (owner's design, 2026-09-23): the four KPIs in `#dashKpis` across its top —
    Revenue · Profit · Transactions · Margin, hairlines between, 4 across, 2 under 1280px, 1 under 560px — then one
    revenue line. Scrubbing the chart swaps all four to that hour/day and hides the chips.
  - Recent transactions: the newest `RECENT_TX` (20). The Customer cell truncates at 160px (full name in `title`), and the table drops the global 860px `min-width` so it fits the column.
- **The rail is the owner's.** `DASH_W` in `backoffice.js` holds the cards (`daily`, `monthly`, `low`, `pay`, all on by default; the rail follows tick order), one card wide, so widgets only ever stack.
  - The same engine as Sales › Transactions (owner 2026-09-26): a **Widgets** `.pick` left of the range, Show all · Hide all then one tick per card, no × on the cards. Which are on, in tick order, is per device in `HWPOS_STORE.ui` `dashShow`; all off drops `#dashGrid` to one column (`.solo`), redrawn through `slideRender()`.
  - Low stock lives in the rail, not the KPIs: a bare count, the 5 that run out soonest, each with an Out or Low `.status-pill`, with a quiet "View all ›" to Products → Stock filtered to Out + Low (`?view=stock&level=out,low`) top right, across from the label. Recent transactions uses the same `.link-btn.view-all`.
  - Payment methods is a table of amounts only, no headline number and no percents: its total is Revenue, already the first KPI, and shares live on the Sales page. Each row leads with a swatch in its pay-pill's hue (`.sw.pay` in `bo-blocks.css`): the pill's text colour lifted to a soft pastel, since the raw ink read too dark and the pill fill too faint (owner, 2026-09-23).
- **Targets** are stored in `state.settings.targets = { month, override: { date, amount } | null }` and saved through `saveSettings()`. The ··· on a target card opens `#targetDlg`.
  - Today's target = (month − sold before today) ÷ days left, today included. Every day counts as open.
  - The override applies only while `override.date` is today.
  - Monthly "On pace for" = month-to-date ÷ days elapsed × days in the month.

**Rules.** Change a type's token at the top of `bo-blocks.css` and every page moves together. A
page file (`bo-*.css`) lays blocks out; it never restyles a shell, KPI, list, table, button or pill.
KPIs go through `kpi()` / `statCell()` in `backoffice.js`, trends through `deltaOf()`. **A trend
never sits under its number** — the lab's combined block I is banned; rows inside a block keep a
plain coloured `.trend-plain`. The page is one tone, white; only the sidebar under it is off-white (v35, see Chrome). Type is Inter.

**This supersedes** the notes further down about 8px radius, the grey `#F6F6F6` canvas and two-tone
sidebar, striped-by-default tables (v33), Geist as the one font, and the old `.lc` chart markup.
They are kept as history; where they disagree with this section, this section is right.

### The feel
Shopify-admin calm: near-white grey canvas, white cards, **one** black topbar, ink is grey-black
(`#303030`), not pure black. Inter, 13px base, letter-spacing 0. Restrained, dense, data-first.

### Depth: a hairline plus the one card shadow (owner, 2026-09-26)
This is the rule that matters most and the one most recently corrected:
- Every card = its hairline + **`var(--card-shadow)`**, defined once with the block tokens at the top of
  `bo-blocks.css` (`0 1px 2px -1px rgb(26 26 26 / .07)`): a soft lift that fades under the card edge.
  `.bo-card`/`.panel` carry it after their inset hairline, `.blk-table` on itself (its hairline is on
  `::after`), and `bo-calm.css`'s `.card` / `.w` / `.strip` / `section.top` read the same token.
  **Change the token to change every card; never type a card shadow anywhere else.**
- **No crisp offset line.** A 1px offset under the border reads as a double hairline (the owner rejected
  it) — the shadow must blur out, not draw a second edge. The border still does the separating.
- **Never add a `0 0 0 1px` ring on top of the border** — ring + border double the hairline.
- Only the outer card gets it. Things inside a card (`#dashKpis` / `.sh-kpis` KPIs, the dashboard's
  bars `.panel`, tables, rows), controls, pills, menus and popovers never do.
- `--po-shadow-card` is **not** the card shadow any more: only the sidebar and the mobile menu button
  still use it, and no card reads it.
- Only genuinely floating layers cast a real drop shadow: `--po-shadow-pop` (search dropdown, toast). Nothing inline.
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
- Chrome: `--po-sidebar-w 240px` (v35, 2026-09-26; 192px since v29; one grey fill for the active row — a lit sub-link leaves its parent unfilled, no hook line). The look is the Notion lab's
  (`SIDEBAR + SHEET (v35)`): an off-white `--po-sidebar-bg #F6F6F6` sidebar sitting under a white
  sheet. `.bo-main` scrolls on its own with a straight left edge (no rounded corners, owner 2026-09-26) and `--po-sheet-shadow`, and goes
  flat below 1024px. Rows are 30px with 14px text and solid one-colour 16px icons. Drag its right edge to resize (168–320px, double-click resets; under 168px the edge follows at half speed and springs back to 168 on release; dragged left of 96px it previews the icon rail, back past 128px it opens again, and only letting go folds it, keeping its pre-drag width for unfolding); the width is a per-device pref in `HWPOS_STORE.ui`, never synced. **There is no topbar** — `--po-topbar-h` is `0px` and kept only
  so the sidebar/main offsets stay expressed in one place. The global search went with it; the
  hamburger survives as a fixed 38px button (one `.bo-hamburger` rule: surface, strong line, card shadow) that CSS shows only below 1024px, where the sidebar overlays;
  there the top slot (store switcher, or ← Back in Settings) is padded 54px clear of it, and so is every page's title row (`.view-head`, the calm pages' `.c-main > .bar`, 46px left padding). The overlay keeps its
  full labels: every POS till sidebar rule in `styles.css` (the base ones, its `#app::before` backdrop and the
  icons-only `@media (max-width: 920px)` block) is scoped at the source to `:where(#app:not(.bo-app))` (2026-09-27),
  since both pages are `#app` and share `.sidebar` / `.side-link`. `.bo-sidebar` starts clean; don't undo till rules one by one.
- **Sidebar state** (2026-09-27, owner: one source of truth). Two classes on `.bo-app`, one breakpoint read:
  - `.side-rail` — the desktop pref (full or 60px rail), saved as `sidebarRail` in `HWPOS_STORE.ui`. CSS reads it at 1024px+ only.
  - `.side-open` — the <1024px overlay is open. In memory only, never saved; the one `matchMedia('(min-width: 1024px)')`
    listener in `backoffice.html` drops it on every crossing of 1024px (either way), so a resize always lands shut. The
    hamburger toggles it; picking a page (not a tree chevron) or tapping the backdrop clears it. The CSS that hides the
    sidebar lives only inside `@media (max-width: 1023px)`, so at 1024px+ the sidebar is always there, full or rail.
  - There is no `.sidebar-collapsed` in the back office (that's the till's); don't reintroduce a second flag.
- Fold to icons (2026-09-26, the lab's `.fold`): the panel-icon button `#sideRailBtn` right of the store
  switcher folds the sidebar to a 60px icon rail on desktop and unfolds it again. That is
  `.bo-app.side-rail` (it sets `--po-sidebar-w: 60px`, so `.bo-main` follows) and `sidebarRail` in
  `HWPOS_STORE.ui`, per device, never synced. It is **not** `.side-open`, which is the
  <1024px overlay being open; below 1024px the button hides and `.side-rail` does nothing. On the
  rail: names, trees, chevrons, the store/account text and the resizer hide; icons and badges
  centre; each link's name is its `title`; the button sits over the store badge, shown on hover
  (the badge otherwise; in Settings the slot shows ←, and hover still shows the fold button). It folds in **one motion, nothing re-lays out** (owner, 2026-09-26: the old
  `display:none` swap flashed): names clip and fade under the closing edge, icons nudge 3px to
  centre, an open tree slides shut on its grid rows, the button rides the edge. Don't bring back
  `display:none` or a column swap on `.side-rail`. Clicking a
  badge unfolds first (its menu needs the width); an active tree parent navigates instead of
  folding its tree. CSS is at the end of `SIDEBAR + SHEET (v35)`; JS is next to the resize code
  in `backoffice.html`.
- **One header line** (owner, 2026-09-26): the store switcher, the fold button and every page's title share one centre line, 36px from the top. The sidebar's top row has 20px top padding (= the pages' top padding) and is 32px tall; every page's title row (`.view-head`, the calm pages' `.bar`) is at least 32px tall, and the content starts 16px under it (68px from the top) on every page. Change one and you change the other.

### Type
Inter. 17px/700 page title · 13.5px/650 panel title · 13px/500 body & rows · 12px secondary ·
11–11.5px labels & subs. KPI value 20px/700. Negative tracking only on headings (-0.01/-0.02em).
**All money and counts get `font-variant-numeric: tabular-nums`** and right-align in their column.

### Layout grammar
- Shell: fixed black topbar (46px) → fixed sidebar below it → `.bo-main` offset by both.
- `.view` is `max-width: 1240px`, centered, `padding: 20px 24px 48px`.
- `.view-head`: title left, `.view-actions` pushed right with `margin-left: auto`.
  **One title slot for every page** (`PAGE HEAD (v34)`, last in styles.css, 2026-09-20): the head is
  at least a `--po-head-h` (32px) line with `--po-head-gap` under it, so every `h1` lands on the same
  coordinate and moving those two tokens moves every page together. **Nothing goes under a title —
  no description line** (the owner removed them all). A back link sits *before* the `h1` like a
  breadcrumb and a detail page's one fact (SKU, PO status) sits *after* it, same line (the item
  page is the one exception: its own `.item-head`, see Products below). A sub-page
  is titled by its own name ("Movement history", not "Inventory" + a sub); the default tab keeps
  the page's name. Never override `.view-head` / `.view-title-wrap` geometry in a `bo-*.css`.
- **Narrow widths fold by the container, never the window** (2026-09-27, so the sidebar open or folded
  changes nothing). One rule per shared piece, no per-page breakpoints:
  - **Page head** (`.view-head`, and the item page's `.item-head`): a `min-height`, not a height; out
    of room it wraps like the calm pages' `.bar` — title left (`margin-right: auto`), the actions on
    the next line from the left edge, never stacked in a column. Purchase orders uses it as is.
    Under 1024px the fixed hamburger clears the **title only** (its first child gets a 46px left
    margin; `.item-head` pads 46px since its back link and name are two lines): a wrapped second line
    starts at the page gutter like the cards under it.
  - **Sales bar**: under 640px of page, `‹ period ›` always starts the second line and Export follows,
    so the picker sits on the same spot in Summary and Items (their first lines differ in length).
  - **KPI strip** (`.calm-dash .strip`, Dashboard and Stock history): folds by its own card
    (`container: strip`) — 2×2 under 944px of card, which is what "₱1,477,772 −4.5%" needs a stat
    wide; on a phone the value shrinks with `cqi`. **The chip stays right of its number, same row,
    never under or over it** (owner). The Products stock tiles do the same by the page (`container: pd`,
    2×2 under 600px). `.kpi-row.joined` tiles are at least 216px.
  - **Card heads** (`.bo-card-head`, the calm `.head`): wrap whole items; a label or button never
    breaks mid-phrase or clips past the card. The label and buttons are `nowrap`; a `.bo-card-sub`
    is not — it drops to its own line and wraps its text (Insights' age buckets).
  - **Tables** keep their 860px floor and scroll inside their card; on a phone the low-value columns
    step out by a container query on the table's card (receipts `.tx .opt` under 640px, Staff's
    Email under 480px), so the money column stays in view.
- `.panel-head`: title left, sub/link right via `margin-left: auto`, `border-bottom: 1px solid --po-line`,
  `padding-bottom: 10px; margin-bottom: 12px`. Every card body row after it is label-left/value-right.
- Grid gutter is **10px** everywhere (`--blk-gap`), across and down alike; card padding is `--blk-pad` 14px.
  Card padding is **14px** (see v23 below). Reach for an existing step — no one-off 13/21px.
- Rows in a **table** separate with `border-bottom: 1px solid --po-line`, and the last row drops it.
  Rows in a **row list** separate with a stripe instead (v33 below), and so does any table over a
  couple of rows. Stripes or hairlines, never both.
- Status/pay/role pills: **solid fill + dark ink, no dot, 20px tall everywhere** (`--po-pill-*` tokens;
  2026-09-19). The owner found tint + dot washed out, then found Shopify's mint/neon badge "too close to
  Shopify" — the fills are our own old tint hues one step deeper. No outlines, no per-table height override.

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
5. The shadow comes free: the shell (`.bo-card`, calm `.card`) already carries `var(--card-shadow)`.
   Never hardcode a card shadow; a new shell class uses `box-shadow: var(--card-shadow)`.
6. Money and counts: `.num` / `--po-mono` (Geist + `tabular-nums`), right-aligned. Labels: sentence case,
   `--po-ink-tertiary`.
7. Empty? `.bo-empty`, centered tertiary text. Never a blank card.
8. Bump `?v=NN` in `backoffice.html`.

### Sales-trend line chart (v35)
> **Superseded 2026-09-25:** the Dashboard and Sales › Summary now draw the calm pages' bars (see Calm pages at the top); `renderLineChart` is deleted.
The lab's block L. `renderLineChart(el, data)` draws an SVG in real pixels at the `.blk-plot` box's
width (ResizeObserver redraws it), so text never stretches. Two straight-segment lines (the curve read as decoration, owner 2026-09-22) — sales
`--chart-1`, gross profit `--chart-2` — share **one axis** (profit is always ≤ revenue). Gridlines sit on a round step just above the peak (₱0/10k/20k/30k for a ₱29k peak), the left gutter fits the widest ₱ label, and 20px on the right lets the last date centre under "now". Only the front
line gets the gradient fade. The `.blk-keys` buttons in the same `.bo-card` switch a line off; the
last one showing can't be hidden. Settings → Appearance → Chart colours puts `body.chart-blues` on,
which re-points `--chart-2` to a deeper blue (stored via `HWPOS_STORE.ui` `chartHue`). **Line by default;
Settings → Appearance → Chart style → Bars** (owner, 2026-09-23) puts `body.chart-bars` on (stored via
`HWPOS_STORE.ui` `chartStyle`) and the same function draws top-rounded bars, one per bucket mid-slot,
profit over revenue. Scrubbing dims every bar but the hovered one.

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
> **Superseded 2026-09-25** by Calm pages at the top. Kept for the history.
> **Superseded in part (2026-09-22):** the body below the head is now main + rail, described under Blocks above. The head, range picker, chart bucketing and transaction-row notes here still hold; the Overview, `.dash-top` and `.dash-grid-3` rows are gone.

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
   The Dashboard's own Time cell (`dashTime`) prints just the day for an older sale, the full time as
   its title, and below 700px of card (1280 wide) the Customer column hides — the eight columns fit
   the card without a scrollbar at 1280 and 1440.
   Fulfilment is plain
   secondary-ink text (`Delivery` / `Walk-in`) so the two pills keep the only colour in the row;
   customer falls back to `—`, not "Walk-in", or the two columns would say the same word.
   `normalizeOrderRecord` in `backoffice.js` must carry `fulfilment` through — the POS writes it,
   the back office normalizer drops anything it doesn't list. Credit sales print **Account** (the POS writes it too since 2026-09-25; older orders say
   "Charge to account") — `normalizeOrder` pins `paymentMethodLabel` to `PAY_LABELS.credit` for that
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

3. `.dash-grid-3` — Low stock · Deliveries coming. Mini-lists cap at 5 rows and
   reserve height for 5 (`min-height`), so a short list doesn't shrink its card. **Deliveries coming is a stub**: the POS
   records `fulfilment: 'delivery'` and an address but no scheduled date, so the card renders
   `.bo-empty` until checkout writes an `o.deliveryDate` to list.

Top SKUs and Revenue breakdown used to live here and were **removed** — they belong on their own
page, not in the glance. Don't re-add them to the dashboard.

All numbers derive from `loadOrders()`: `rangeWindows()` gives current + previous windows,
`metricsOf()`/`deltaOf()` the KPIs, `orderProfit()` gross profit (revenue ex-VAT − `cost`×qty).
The tx table shows **every** status — voids and refunds must stay visible.
Empty state is `.bo-empty` centered tertiary text, never a blank card.

### Sales page (`bo-sales.js`)
> **Summary superseded 2026-09-25** by Calm pages at the top; the tab and toolbar notes still hold.

> **Rebuilt 2026-09-22** (owner, from `sales-lab.html`). The page was too fragmented: seven tabs,
> three of them one card's worth of numbers. Patterns, By employee and By payment are **gone as tabs**
> and live on the Summary as blocks. Recent transactions is gone too — Transactions has its own
> sidebar page. Don't bring any of them back as tabs.

**Summary | Items is a switch inside the page, not sidebar links** (owner, 2026-09-27: the sidebar means "go
somewhere else"; Items is the same month seen a different way, so the switch goes where the eyes already are).
It is Products' Catalog | Stock component (`.seg.pd-switch` of `<a class="seg-btn">` links, `tabSwitch()` in
`bo-sales.js`), leading the `.bar` — **no `Sales` title** (owner, 2026-09-28: the lit sidebar row names the
page) — before `‹ period ›`. The switch takes the bar's auto margin and Items' Export CSV sits *left* of the
picker, so **the switch and the picker hold still on a switch; only what is below changes** (measured at 1440/1024/390: same
boxes). Both tabs share one comparison: the period menu's Compare to (`?vs=`), no separate switch (owner, 2026-09-30).
The URL is unchanged — `?by=items` is Items, no `by` the Summary — and the switch carries every param
(`month`, `view`, `vs`, Items' `ct`/view picks/`sort`) except `day`/`week` (the pop-up), `page`, `all` and `q`. Sales
registers no `HWPOS_SUBNAV`.

**Two tabs over one `agg()` pass: Summary · Items** (owner, 2026-09-26, round 4). Old
`?by=item|category|basket` links redirect to Items; old `?by=staff` links open the Summary.
- **The Summary keeps its Top 10**: the glance for the month. Its See all opens Items **on the same month**
  (`?month=`, `?view=year` for a year).
- **Items is the Summary's month in more depth**, not a second range picker: the Summary's `‹ September 2026 ›`
  (`periodNav`), Export CSV left of it. **Ported from `sales-items-lab-3.html` (owner, 2026-09-30)**; the
  lab's cards and CSS live under `.calm-sales .si` in `bo-calm.css`. Top to bottom:
  1. **Strip A**: Items sold · Top 10 share · Margin · New sellers (Best day when not comparing) · Didn't sell; the counts open their page.
  2. **Categories**: Donut (default) / Map / Bars / Rank. Top 5 + Other; Show all (`?all=categories`) is a
     table. A category click / Enter cuts the items to it (`?ct=`, again undoes); on the Categories page it
     opens All items cut to it.
  3. **Top 10 items**: Bars (default, profit inside revenue) / Table. Show all (`?all=items`) is the full
     table with search (`?q=`) and pages.
  4. **What moved**: Slope (default) / Split / Lists. **Only when comparing.**
  5. **Bought together** (`basketAffinity`): Network (default) / Ring / Table; Show all (`?all=pairs`).
     A pair's % is taken from its rarer item. The network gives a group of 4+ a half-width cell.
  - **Each card's view is a dropdown on its band**: the app's `.pick` button + popover `.menu` (✓ on
    the current one, right-aligned to the button). **Never a native `<select>`** (owner, 2026-09-30,
    rejected the OS list). It is `?cats=`/`?list=`/`?moved=`/`?pairs=`, and the default clears the param.
  - **No comparison (no `?vs=`, the default) = plain facts**: no Trend column, no chips, Rank leaves the Categories
    menu and What moved leaves the page. Don't show within-month substitutes. It is also off when the
    period before has no sales.
  - Old `?x=item|category|basket` and `?all=item|category|basket` links redirect to their `?all=` page.
  - Under 760px (container) the bands wrap under their pick, and slope/network scroll inside their card.
- **By staff is gone as a page** ("staff is just one thing"): the Summary's Staff card carries a quiet
  "1 void · 2 refunds" after a cashier's name (refunds = `isReversal`: refunded originals and return rows).

**The Summary is the Shopify analytics grid, not the dashboard's main + rail.** Blocks from
`bo-blocks.css`; `bo-sales.css` only lays them out.

1. `.stat-grid.show-delta.sales-kpis` — six `statCell()`s across: **Revenue · Gross profit · Margin ·
   Transactions · Average basket · Items sold**, each with its delta against the previous window
   (always on — this page is the report, not the glance). 6 → 3 columns under 1280px, 2 under 700px.
2. `.sales-grid` — three equal columns, **every row the same fixed height** (`grid-auto-rows`), so no
   block leaves a hole and none stretches too wide. 3 → 2 columns under 1100px, 1 under 700px.
   - **Sales over time** (`.w2`, spans two) — `renderLineChart` over **this page's filtered rows**
     (`trendSeries(rows)`), not `state.orders`: a line that disagreed with the payment and staff
     filters above it would be worse than none.
   - **Sales breakdown** — `bd-rows`: Gross sales · Discounts · Returns (n) · VAT included · Before
     VAT, then a **Net sales** total row. Gross is worked back from revenue (`revenue + discounts +
     returns`, `offTop()`), so the card always adds up. More discount or returns is the bad
     direction — `worse()` flips the chip's tone. Voids go in the foot: "n voided, no revenue".
   - **Sales by hour of day** / **Sales by day of week** — see Patterns below.
   - **Payment methods** — top 6 by revenue with share, then a Total row. Credit carries a
     "Not yet collected" pill.
   - **Sales by staff** — top 6. **A name is a button that opens `#staffDlg`**: Revenue, Gross
     profit, Transactions, Average basket, Voids, their top 5 items, and **View their transactions**,
     which lands on the Transactions tab filtered to them. Same `agg()`, narrowed to one cashier, on
     the page's own window and filters. A peek, not a route — same reasoning as `#orderDlg`.
   - **Top items** — top 5, foot link into Items.
   - **Targets** — the dashboard's `DASH_WIDGETS.monthly` over `daily` (dots stripped), one block.
     Calendar, not range: they ignore the filters on purpose. Click opens `openTargetDialog()`;
     saving calls `renderCurrentView()`, so whichever page opened it repaints.

> **Superseded 2026-09-25** by the calm Transactions page (see Calm pages at the top).

**Transactions has the Products toolbar** (`.tx-filters`, 2026-09-22): search, All payment types and
All employees on one row under the head, not in the card head or `view-actions`. The head keeps
only the range picker and Export. The card is "All transactions" with an "n shown" count.
Payment type and employee are **multi-pick checkbox menus** (`multiPick()`, a `<details>` like
Products' Columns), on every Sales tab: `?pay=` and `?staff=` are comma lists, none ticked = all.

**Products (both views) has the same row** (2026-09-22; On hand moved there 2026-09-23), between the KPI cards and the table: search,
All categories, All stock levels (In stock / Low / Out of stock — `statusOf()`'s tones). Both are
`multiPick()` (now in `backoffice.js`, shared with Sales): `?cat=` and `?level=` are comma lists.
The row lives in the shell between `#invKpis` and `#invMain` so a re-render never eats the caret.
The other Inventory tabs keep search + single category select in the head; they read `?cat=` as a list.

**Dialogs sit at body level** (`#orderDlg`, `#targetDlg`). A `<dialog>` inside a hidden
`.view` section never shows — `#targetDlg` used to live in the dashboard section and couldn't open
from Sales.

### Sales → hour and weekday blocks (were the Patterns tab)
> **Superseded 2026-09-25:** gone with the old Summary.

**A profile is not a timeline**: the range is folded, so every Monday in the window lands on one
Monday, and every 2 PM on one 2 PM. "What time do we get busy" is a different question from "what
happened on Tuesday", and only the folded version answers it.

- **By hour** — `getHours()`, trimmed by `openHours()` to the hours that sold ±1 (6 AM–8 PM when
  nothing sold), so a shop open 8 to 6 doesn't plot fourteen flat hours.
- **By weekday** — 7 slots, **Monday first** (`(getDay() + 6) % 7`). A shop's week does not start
  on Sunday.
- Both heads name the peak and what it took (`peakHead()`) — that one sentence is the reason to plot
  a profile.
- **Lines, not bars** — the lab drew the weekday as bars; the one-chart rule above wins. Both pass
  `data-still` so `drawLineChart` skips the live halo and end dot: a profile has no "now".

Voids are skipped in every profile — `saleSign` is 0, so they book no money and belong to no hour.
Walk-in vs delivery was cut with the tab.

### One width for every page

`body.bo-light .view` is `max-width: 1560px` and **nothing overrides it**. Products and Inventory
were once widened for their columns while the rest sat at 1240px, so moving between pages slid the
whole layout sideways. The widest table sets the width and every page keeps it, full or empty. A
new page that wants to be narrower is wrong about the page, not about the token.

### Tables are dense and the list pages are wide (v24)
A row is one line of text. `6px 14px` on a cell, `7px 14px` on a header, and nothing in a data
cell wraps — long SKUs and supplier names scroll sideways inside `.table-wrap` rather than
doubling every row's height. If a cell needs a second line, it is the wrong cell.
**The pager is as tall as the head row** (owner, 2026-09-23): `.bo-pager` is `--tbl-row` high
with 24px page buttons, in `bo-blocks.css`.
**50 rows a page on list pages, 25 on a single record's page** (owner, 2026-09-26): `paginate(rows,
page, size)` in `bo-model.js` defaults to `PAGE_ROWS` (50); the customer and supplier pages pass
`DETAIL_ROWS` (25), and their capped tables (Items bought, the supplier's POs) cut at it too. A second
paged table on one page names its own URL key: `pagerHtml(pg, 'stpage')` (the customer's Statement).

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

**Stock is off by default too** (2026-09-26): the Stock view answers it, and with it on the default
set ran past a 1440px card. In the Stock view "In stock" is muted text; only Out / Low / Dead get a
pill. Family margin reads as a whole-percent range (`18–42%`), SKUs are not tabular (tnum widens
the hyphens), and the filter row wears the Transactions `.pick` look — on-state tint when a filter
is set, Show archived as a toggle pill.

**One dropdown language** (owner, 2026-09-26): every filter, check-menu, range menu and `<select>` in the
back office wears the Dashboard's `.pick` + `.menu` — 28px hairline button, drawn chevron, white card at
`--b-r-cell` with `--b-pop-shadow`, 7px 10px rows, grey hover, blue ✓ right. It is written once, the
`ONE DROPDOWN LANGUAGE` block at the end of `bo-calm.css`; never a page copy. `<details>` menus
(`multiPick`, Columns) close on an outside click or Esc and flip to the button's right edge (`.flip`)
near the page edge — both wired once in `backoffice.js`. Form and dialog selects keep their field width.

### Products — Pictures (2026-09-26)
**Pictures is a store setting, not a column**: `state.settings.productPictures`, written through
`HWPOS_STORE.settings.set()`, so it syncs and is the same on every terminal of that store. A retail
counter doesn't want thumbnails; a café does. It is **Show pictures**, the first row of the Columns
menu over a hairline, ✓ when on (owner, 2026-09-26: its own image-icon button in the filter row was too
loud). Catalog only, since Stock has no Columns menu. Not a `COLUMNS` entry: it is not saved in pdCols. **Off by default** — no image column, normal row
height. On adds `.pics` to `#pdTable`: a 48px rounded thumb column (`--po-r-inner`), taller rows,
variant count under the name, and the quiet placeholder only for products without a photo.
Still 50 rows a page either way. Demo mode reseeds settings on load, so it resets to off there.

### Columns menus — Products and Suppliers (2026-09-26)
One mechanism in `backoffice.js`: `colsMenu(cols, on, first)` draws the `<details class="pd-cols">`,
`loadColPrefs` / `saveColPrefs` keep which are on per device (`hwpos.bo.pdCols`, `hwpos.bo.supCols`), and
`hideColsClass` puts a `hide-<key>` class over the table; cells carry `data-col` and each page's CSS hides
them, so a tick never re-renders. The menu sits at the right end of the filter row. On Suppliers the name
always shows; the other seven columns are in the menu, all on by default. A new list reuses these four.
The Suppliers filter row is always there (owner 2026-09-26): search, a `?show=` select (All suppliers · Has low
stock · Has open POs), then Columns -- the Purchase orders / Products format.

### Products — ticking rows
Each row starts with a tick box (`.pd-sel`, not a `COLUMNS` entry, so it cannot be hidden); the
header box ticks the page. The ticked ids live in the in-memory `picked` Set in `bo-products.js`,
kept across pages and filters until an action runs or **Clear**, and never stored. A family row's
id stands for every variant in it. While anything is ticked, `#pdBulk` ("N selected · Export CSV ·
Archive · Clear") replaces "N shown" in the card head. Bulk Archive asks once, sets `archived` +
`updatedAt` and never deletes, same as the editor's Archive.

### Products — one table, two views, and an item page (2026-09-23)
The product pages were ~11 screens (Products, On hand, Movement history, Cost changes, Price
history, six Stock-health tabs). The owner's rules for the merge: simple first, click for detail;
every block points to an action; **never a second copy of the item table**. So:

- **`/admin/products` has a Catalog | Stock switch inside the page**, `?view=stock` — a `.seg`
  leading the head with no `Products` title (`viewSwitch()`, 2026-09-28), like Gmail's tabs. **One sidebar link, Products; never a
  second "Inventory" link or a sidebar tree for this** (owner, 2026-09-23: two links read as two
  pages — "you duplicated the thing"). Sales' Summary | Items (2026-09-27) is the only other in-page switch; this one flips columns
  on the same table, it is not a sub-page. Switching keeps `q`, `cat`, `supplier` and `level`.
- **Stock level filter on both views**: a `multiPick` writing `?level=out,low,dead`. `?low=1` is
  still read as `level=low`, never written.
- **Out / Low / Dead are one rule**, `stockLevel(p, clock)` in `bo-model.js` with
  `saleClock(movements)`: dead = on the shelf and no sale in `DEAD_DAYS` (90) — since the last
  sale, or since the first movement if it never sold; no movements at all is not dead. Pills come
  from `STOCK_LEVEL`. Don't write a second dead-stock test.
- **Stock view only: four KPI tiles** — Out · Low · Dead · Cash in stock. They count the searched
  set before the level filter; clicking Out/Low/Dead toggles it in `?level=`, Cash clears it.
  Columns: name · on hand · sold 30d · stock value · last sold · status · Adjust. A family row sums
  its variants, shows the worst status and has no Adjust (open it and adjust per variant).
  Incoming was not carried over.
- **Catalog view** keeps the column chooser and adds an Edit button per row.
- **A row opens the item page** `/admin/products/<id>` (`bo-item.js`, `renderProductPage(id)`;
  product or family id). **One column in a 1180px frame** (owner, 2026-09-26: "this can be one
  column for everything"), every card full width, in this order: KPI bar → Variants (family only)
  → Stock movements (last 10) → Price & cost changes (last 10) — both with View all into Stock
  history `?q=<name>` — → Often bought with (top 5, hidden when empty). An empty card is one quiet line.
  **KPIs are one bar**: `.kpi-row.joined` (hairlines between the tiles) in the `.cust-sum` card
  dress — on hand · stock value · margin (a family's is the plain average of its variants) · last
  sold · units sold. **On hand carries the status**: the `STOCK_LEVEL` pill beside the number, where
  a trend chip goes, never under it and never a second copy in the head. One row wide; below a
  1000px page it wraps 3 + 2 with a hairline over the second row, never 4 + a lone tile.
  **Head** is its own `.item-head`, not `.view-head` (the one exception to "nothing under a
  title"): a back line on its own (a drawn chevron + "Products" in `--b-data`, `aria-label="Back
  to Products"`) that returns to the list as it was left — a capture-phase click on the list notes
  its URL, filters and all; opened cold it is plain `/admin/products`. Then the product name, with
  the period `.pick` + `.menu` (the Dashboard's dropdown, Last 7/30/90 days, `?period=`, 30 the
  default and cleared), Adjust stock (products only) and Edit, all 28px and centred on the title;
  under it one muted line, category · SKU (or N variants). A table card keeps only `.blk-table`'s
  own hairline; a border on top of it drew the doubled edge the owner saw on Stock movements.
- **The editor moved to `/admin/products/<id>/edit`** (and `new`). Save and Back still land on
  the list.

### Adjust is one global dialog
**Adjust opens `#adjustDlg`, a native `<dialog>` at body level in `backoffice.html`**, from any
page: stamp a button `data-adjust-open="<productId>"` and nothing else. One **capture-phase**
document listener in `backoffice.js` opens it (`window.openAdjustDialog`, owned by
`bo-inventory.js`) before any row-click handler sees the click; after a save `commit()` re-renders
the current view. Last movement lives in its footer: it only matters once you are about to move
the stock.

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

**The height is a setting.** Settings → Appearance → *Back office row size* is an S/M/L `<select>`
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

### Stock history — the `inventory` view (2026-09-23)
One page, laid out like the dashboard (owner's call; it was the Stock health tree). In the sidebar
it is **Stock history**, the one leaf of a static tree under Products (owner, 2026-09-25): a
`.side-sub[data-view="inventory"]` in backoffice.html, and `paint()` keeps Products lit on this view
so the tree stays open. The Reports section went with it.
- **Revamp (owner, 2026-09-26: "looks ugly as hell … doesn't make sense").** The overview is now a
  Dashboard page: `render()` puts `.calm-dash` on the view while `?tab=` is the overview, so the bar,
  KPI tabs, bars, tables, pills and rail cards are bo-calm.css's. bo-inventory.css only adds what the
  Dashboard lacks (header buttons, which calm's `button { font: inherit }` strips; the small type pick;
  a container query so 1024 wide drops the rail and makes the strip 2×2). It answers four questions:
  what came in, what went out, what went missing or was fixed, and what to act on.
- **Header:** title, the range `.pick` + `.menu` popover (Today / Last 7 days / Last 30 days,
  `?period=`, default 7; 7 and 30 are calendar days, today included), then Receive stock and New
  adjustment. Today compares with **yesterday up to the same time**, not all of yesterday.
- **KPI strip = folder tabs** (`?chart=in|out|lost|adj`, default `in`); the picked one is the only
  series the bars show, from ₱0 up (`shPlot`, the Dashboard's `dashPlot`). Hover tip lists all four.
  **Received** (deliveries, returns, transfers in), **Went out** (sold, used, transferred, lost),
  **Lost** (shrinkage, breakage, write-off, and short shelf counts), all ₱ at cost; **Adjusted** is a
  count of hand-typed changes. Each tab has a `title` saying so. ₱1M+ reads `₱1.25M`.
- **Chips** are `calmChip`, beside the number, hidden when the previous period is 0. Only **Lost**
  has a good direction (up is red); Received, Went out and Adjusted stay grey — a quiet week buys and
  sells less, and that is not bad news. A period with nothing in the picked series says so in the
  panel ("No stock lost today.") instead of drawing flat bars.
- **Movements** in the period, newest first, top 10, with a type pick in its head (`?type=`):
  **All but sales** (default — the POS writes hundreds of sales and they buried the deliveries,
  fixes and losses), All, Received, Sold, Lost, Adjusted (`MOVE_TYPES`; Received/Lost match the
  KPIs). Every reason is a coloured pill (owner wanted colour back): delivery green, return and
  adjustment amber, shelf count blue, shrinkage/breakage/write-off red, sale and transfer grey. The
  full Movements page uses the same tones as `.status-pill` and its Show select carries the types
  plus one-reason options. View all passes `type` and `from` = the period's first day.
- **Price changes** in the period, latest 5. Empty cards (Movements or Price changes) collapse to
  one line: name, why it is empty, View all — never a big blank table.
- **Rail = what to act on**, each a Dashboard band card, dropped when empty (all empty → `.dash.solo`):
  **Lost demand** (top 5 asked-for-while-out in the period, `N×`; always shown, a quiet line when empty), **Counts that didn't match** ("system →
  shelf", short in red, over plain), **Supplier costs changed** (`costDrift`, book → paid, %),
  **Where it went** (out by reason, ₱ and %; only with two or more reasons).
- Numbers come from `stockFlow()` — `{ in, out, lost, adj }` in total and per bucket, `why` by
  reason (gated in `scripts/inventory-check.mjs`). A movement's time is `happenedOn` only when it is
  a different day from `ts`; a bare date parses as UTC midnight (8 AM here), which put same-day
  deliveries in the wrong hour bar.
- **View all opens a full page inside Stock history** (`?tab=movements|prices|lost|counts`), with a
  "← Stock history" back link. It is not a sidebar entry. SUBNAV lists only `overview` and
  `reorder`, so these pages fall back to the default and keep Stock history lit.
- **Counts is called Shelf check.** "Counts" read as stock movements.
- **Sell-through was dropped.** Old `?tab=sell` links land on the overview.
- **One chart only** (owner, 2026-09-26, reversing the earlier "no charts"): the bars show *how
  much*; the tables still show *which* item. One series at a time — the mirrored in/out chart with
  an unsigned axis below zero did not read without explaining.
- **No Reorder or Adjust buttons on these pages** (the owner rejected them).
- **Old links redirect:** `?tab=stock` → `/admin/products?view=stock` (q, cat and level kept);
  `?tab=cost` → `?tab=prices`.

### Stock view — why these columns
- **Sold 30d is the point.** "47 on hand" answers nothing on its own — 47 of something that
  sells 40 a week is nearly out, 47 of something that sells one a month is dead money. It comes
  out of the movement log that is already loaded (`sold30` in `bo-inventory.js`), so there is no
  new state. Nothing sold in the window prints `—`, not a zero that reads like a measurement.
- **Days left was removed (2026-09-12).** Days of cover is on-hand divided by that same rate, so
  it restated the column beside it, and it was blank on every product that had not sold in a
  month — most of the table. The decision it was there to serve, what to order and how urgently,
  is Products → Stock (Out/Low filter) plus **Add low stock items** on a purchase order.
- **The category `<select>` excludes the built-in `all` folder.** `data.js` seeds
  `{ id: 'all', name: 'All Items' }`; as an option it reads as a second "All categories" and
  filters to almost nothing. Products already filtered it out — Inventory does now too. Any new
  folder dropdown must do the same.

### Stock history → Price changes: the Cost changes card

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
has one tab per section (cash tied up, stockouts, dead stock, sell-through,
counts, lost sales). Basket affinity moved to Sales → **Bought together** (`?by=basket`, all receipts
ever, no range; its Products/Categories toggle is `?pairs=`) and the Customer habits link went. The Deliveries tab (customer delivery orders) was removed 2026-09-24;
Transactions already shows each order's fulfilment. The Customers list
shows orders, spent and last order (the date only), read from `HWPOS_INSIGHTS.customerTotals`
(under 880px of card Phone hides, under 760px Orders too, and a name truncates at 160px, so seven columns fit beside the rail
at 1440 and 1280; normal balance states are muted text, pills only for In use / Near limit — 2026-09-26). **No
next-order prediction** (owner, 2026-09-27: the Next order column, "Next order due" and the Due / Overdue / On track
pills were a median-gap guess; the back office shows facts, a forecast waits for a real model). Cadence is read off
**Export for AI**. The reorder, lead times and prices tabs were
removed 2026-09-23 (see "Buying removed" below); their old `?tab=` links redirect (`MOVED`). **Nothing it computes
is stored** — `HWPOS_AI.snapshot().insights` and **Export for AI** rebuild it on read. Export writes
every collection plus insights and the field dictionary as one JSON file.

Its date key is a fixed UTC+8 (`TZ_MIN`), never `ts.slice(0, 10)`.

**Cash tied up is the first tab** (2026-09-14, the owner asked for it by name). Two things:
- **How long the cash has sat.** Stock on hand at cost, split 0–15, 16–30, 31–60, 61–90 and 90+
  days. The split walks stock-in movements newest first, because the oldest stock sells first.
- **Money in and out over the last 15 and 30 days.** Bought, sold at cost and lost.
No new capture is needed. It reads the movement log and the `unitCost` that sales and deliveries
already stamp. `cashAsleep` stays in the data; its tab was folded into this one.

### Buying removed — no forecasting in the POS (2026-09-23)

The owner is simplifying the app first. Removed: the **Needs buying** page and link, and the
**Buying** sidebar tree (Reorder plan, Supplier lead times, Price history).
- **No reorder forecast, on purpose.** The owner: reordering needs a lot of context the POS doesn't
  have, so it is a job for something else. **Removed entirely 2026-09-27** (owner: "build it from
  the ground up again"): `reorderPlan`, `demandStats`, the `Z` table / `zFor`, and the `demand`,
  `reorder` and `reorderBySupplier` sections of `buildInsights` are gone, so Export for AI and
  `HWPOS_AI.snapshot().insights` carry no forecast either. `scripts/backtest.mjs` (it only compared
  `reorderPlan` with `suggestQty`) and the POS's dead `buildReorderList()` went with them. Don't
  port the old formula back; the owner rebuilds it from scratch.
- **Count accuracy is facts only** (2026-09-27): counts, last counted, Mean miss (`meanAbsVariance`,
  the average |counted − expected|) and each count's expected / counted / variance in `history`,
  biggest average miss first. The Confidence column and the per-count `accuracy` score were removed
  by the owner (a made-up score).
- **"What's low?"** is Products → Stock, Out/Low filter. **"Order it"** is Purchase orders → a draft
  with a supplier → **Add low stock items**: adds that supplier's low and out products
  (`lowStockLines` in bo-inventory.js = `reorderGroups` + `suggestQty`, top up to twice the
  reorder point), skipping ones already on the PO. It writes no `decisions` rows. The suggested
  qty is only a pre-fill: each line's qty is the same editable input as any other PO line until the
  PO receives stock. This stays (2026-09-27).
- **Lead time is one Suppliers column:** Delivers in (average days, rounded), from
  `supplierLeadTimes`. On time (%) and the other lead-time stats were dropped.
- **Price history** duplicated the item page and Stock history → Price changes.
- **Old links redirect:** `/admin/inventory?tab=reorder` and `/admin/insights?tab=reorder` go to
  Products → Stock (Out + Low); `?tab=leads` to Suppliers; `?tab=prices` to Stock history → Price
  changes.

### Inventory — reasons and count variance

Losses are three events, not one adjustment: **shrinkage** (lost or stolen), **damage**, **writeoff**
(expired, unsellable), with `adjustment` left for used or other with a note. A count movement keeps
`expected` and `counted`, so variance survives the correction. A count that matches writes nothing.

### Suppliers — what gets captured

Supplier detail (2026-09-26): the name as the heading with **Edit** (a `bo-dialog adj-dlg` for name,
contact, phone, email, address, note) and **New purchase order**; contact · phone · email and
address · note as read-only lines under it; a joined KPI strip (`.kpi-row.joined`, one card, hairlines) of On hand at cost, Incoming, Delivers in (measured only) —
Products dropped, the card head counts them; Products by stock value as value | bar | % (bar scaled to the biggest, <1% for the tail) (paginated at 25, `DETAIL_ROWS`); last 25 POs. Order
days, minimum order, quoted lead days and on-time were removed that day; old records may still carry
the fields and nothing reads them (`schema.sql` columns are still there). A PO carries `sentAt` (stamped by Mark ordered) and **Supplier promised**
(`promisedAt`), which the dashboard's Deliveries coming prefers over `expectedAt`
(`SUP_RULES.dueDate`). Receiving asks per line for **invoice cost** (written onto the delivery
movement's `unitCost`, so Cost changes sees what was billed) and a **short reason** when less
arrived than was still to come. The pasted supplier Conversation card was removed 2026-09-24: no
connector fed it, only manual pastes and demo data.

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

### Staff — name, role, page access

Attendance, clock in/out, payroll and cash advances were removed (owner, 2026-09-24): the POS is
not a time clock. A person is a name, a role and the pages that role opens. **Staff lives in
Settings › Staff & access** (`/admin/settings/staff`, `?person=<id|new>` for one person; 2026-09-26):
People with a Role `<select>` per row (search only past 10 staff), then a Roles list — name, head count,
a muted "Dashboard, Sales +3" line; a click opens `#setDlg` with the page checkboxes. Both save on change
with a toast, no Save button. Access stays per role (`hwpos.access.v1`); Owner is locked to all.
Old `/admin/staff[/<id>]` URLs redirect there. **No sales numbers here** — what a person rang up is
the Sales Summary's Staff card; `salesByName` stays exported (gated by `scripts/staff-check.mjs`).

Someone who leaves is **archived, never deleted** — their name stays on old orders. Archived people
drop off People unless "Show archived (N)" is ticked (`?archived=1`), same as archived products.

**One page, no sub-tabs** (owner, 2026-09-24): the People table, then the Roles grid under it.
The data field is still `active`.

### Decision log

`hwpos.decisions.v1` records what a rule suggested and what the person did: one `reprice` row per Apply in Cost changes. Rows name
`inputs`, `rule` with a version, `choice` and `accepted`. **Every back-office event row names
`actor()`** (backoffice.js) — the store's cashier setting until there is a login.

### Customers — the account page

`/admin/customers` is the list; `/admin/customers/<id>` is one account's history. The id is on the
URL (`state.detailId`), so a link to a customer is shareable, and one `renderCustomers()` picks the
screen. The list filters by balance status (`?status=`, the Status pill's words) and last order
(`?last=7|30|90`, `-90` = nothing in 90+ days) with two `bo-select`s beside search. Clicking a row navigates; the back link sits before the page title (which becomes the customer's
name), not between the cards.

The top is **one account card** (owner, 2026-09-26; was a KPI strip plus a Details card): a head band
with the status pill and Edit, the joined strip (Total spent · Balance · Average order · Last purchase),
a hairline, then Phone · Address · Available credit (`.cust-sum` in `bo-calm.css`).
Under it Statement (25 a page on `?stpage=`), **Transactions** (25 a page, each row opens the
existing `#orderDlg` receipt via the delegated `tr[data-order]` handler — no new dialog), and
**Items bought**, one line per product across every order (top 25 by spend). Voided and refunded orders stay in the
transaction list because they happened, but they are excluded from spend, averages and the item
rollup.

### Customers — adding one, and the statement

**Add customer** / **Edit** open `#custDlg`, the same `.adj-*` small form the inventory adjustment
uses. Those classes are **not scoped to `.view-inv`** — they are the back office's one small-form
dialog, used by Customers. The balance is never a field on that form:
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

`supplierId` is the **main** supplier, and it is **optional** (owner, 2026-10-01): a purchase
order and a reorder list need one answer to "who do we buy this from", but a product can also have
suppliers and no main. In the editor, the first supplier added becomes main; tap a name to make it
main, tap the main one to have none. `altSupplierIds` on the product is who else stocks it, for the day the
primary cannot deliver. `supplierIdsOf(p)` in `bo-model.js` is the one helper that returns primary
first then the backups; `normalizeProduct` dedupes it and drops the primary from it, so the two
fields can never disagree.

Three places read the helper and nothing else needs to: the Products supplier filter (a product
shows under **any** supplier that carries it), the Suppliers aggregation (a product lands in every
one of its suppliers' lists, so counts and on-hand values **overlap between suppliers on purpose**
— each line reads "what this supplier can sell us", not a slice of the warehouse), and the
products list column, which prints the primary and `+N` for the rest. Inventory's reorder grouping
deliberately still uses `p.supplierId` alone, so PO creation is unchanged.

The editor control is the Suppliers chip card. `alt_supplier_ids` is a json column on `products`
(2026-10-01), written whole with the row like `category_ids`.

### The product editor — one column, ported from the lab (2026-10-01) — overrides the layout notes below

`product-edit-lab.html` is the reference. `paintEditor()` in `bo-products.js` draws it; every
class is `pe-*` (`.card` / `.chip` / `.menu` already mean something else here) and lives under
`body.bo-light .pe` in `bo-products.css`, with its own local tokens (`--in-h`, `--in-r`, `--pe-pad`,
`--pe-gap`) on top of the `--po-*` / `--b-*` ones.

- **Grid** `minmax(0,1fr) minmax(0,720px) minmax(0,1fr)`: the form is the middle track, Status
  sits alone in the right track (max 260px). Below 1180px Status stacks above the form.
- **One editor for a product, a family and a new one.** It edits a draft `P`; Save turns `P` into
  product rows (`save()` / `saveGroup()`). "Add variants" makes a plain product variant one of a
  new family, keeping its id, stock and history. A variant taken off the list is archived, never
  deleted.
- **Pickers are popovers** (`popover` + `popovertarget`), filled when they open, with a search box
  and "Add “x”" for categories and suppliers. Status has two choices and no search.
- **Save stays at the bottom** (`.pe-formbar`), Archive quiet on its left; both rules below still
  hold. Save returns to the list.
- The `.pd-editor` / `.setting-row` layout described below is gone; the Archive, Save-returns
  and Price-history notes still apply.

### Categories and Modifiers pages (2026-10-01)

`bo-catalog.js`, views `categories` and `modifiers` (sidebar: under Products, after Stock history).
Both copy the Products list: `.bo-card.blk-table` table, click a row for its page, search filters
rows in place.

- **Categories** — `/admin/categories` (name + item count) → `/<id>` (its items, Remove per row;
  Delete, Rename, Add items in the head) → `/<id>/add` (every item not in it, ticks on the left,
  "Add N" top right) · `/new` and `/<id>/edit` share one name form. A family counts and moves as
  one item. Delete confirms, then strips the category from every live item; archived ones keep it (their
  stamp is what Restore reads), and `addFolder` never reuses an id a product still holds.
- **Modifiers** — `/admin/modifiers` (name, options summary, items using it; Show archived) →
  `/<id>` editor: Name card + Options card (name, ₱ price, ×), Save and Archive at the bottom.
  Archive, never delete — an old order line may name the option.

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
editor to find it is "not the best"). It is Stock history → Price changes
(`/admin/inventory?tab=prices`; its own sidebar link was folded in 2026-09-23): every `priceLog` row, newest first, filtered by the page's
search and category. The editor's Pricing card only links to it (`?q=<product name>`). Nothing new is
recorded; `saveProducts` and the POS already diff every save into `priceLog`.

**Fulfilment types are a second card on the Payments page** (2026-09-20; the owner wanted to add
types beyond Pickup/Delivery). The page keeps its name -- do not rename it. Both cards share one
renderer (`methodCardHtml`/`METHOD_CARDS` in backoffice.js): built-ins you switch off, your own
names you add, one locked entry per card (`cash`, `pickup`). `settings.fulfilment` has the same
`{hidden, custom}` shape as `settings.payments`; the POS `applyFulfilMethods()` hides and inserts
pills from it. A custom type is stored in the order's existing `fulfilment` column **as its own
name** -- no schema column, no worker field, and a removed type never rewrites past sales.
`orderFulfilLabel()` in bo-model.js is the one place that turns that column into a word (the back
office says "Walk-in" where the POS pill says "Pickup"); every table, CSV and receipt calls it.

**Payments is a Manage page that drives the POS checkout grid** (2026-09-19; GCash is Philippine-only,
so a store elsewhere must be able to hide it). It writes `settings.payments = {hidden: [kind], custom:
[name]}`; the POS `applyPayMethods()` hides those cards and inserts one card per custom name. Cash can't
be hidden. A custom card sells as kind `other` with the name as `paymentMethodLabel`, so reports need
no new kind and removing a method never rewrites past sales. Each tick saves on change (toast);
Add opens `#setDlg` for the name, Remove drops a custom one. Owner-only by default (`ACCESS_VIEWS`).
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

### Foundation (v33) — rows, stripes, and the shadcn half

2026-09-20, the owner, twice. First: the dashboard's mini-lists and the Overview card "look ugly",
and Shopify's *Total sales breakdown* "is nice and easy to see". Then, on v32's answer: it is "too
close to Shopify, it doesn't really have our own blend", the tables are "not even clean to see",
and — on the stripes — **"I like zebra honestly, you just implemented it badly."** Plus: use shadcn
for the basics, hybrid the two, keep our colours.

So v33 is the basics done once, and everything after it is assembly. It is a hybrid on purpose:
**the geometry and the interaction are shadcn's, the palette and the density are ours.** The shadcn
values were read out of its own registry (`ui.shadcn.com/r/styles/new-york-v4/*.json`) — nothing is
installed, there is no build step, and there is not going to be one. We copied recipes, not code.

**What v32 got wrong about the stripe, because the idea was right and the drawing was not.** v32
drew it as an inset rounded band (`margin-inline: -6px` + `--po-r-card`) floating inside the card.
A rounded band with its own margins is the shape of a *selected* row, so on a three-row card the
middle one looked picked out rather than alternate. **A stripe is a band**: full width of the card,
square sides, identical on every even row. `.mini-list` bleeds out with `margin-inline: -14px` and
each row pads itself back in, so the text still lands on the card's 14px gutter — lined up with the
head — while the fill behind it runs wall to wall. Only the last row takes `--po-r-card` on its
bottom corners, so a stripe never squares off the card.

- **A row is one line.** Name and its one second fact (`.ml-sub`) side by side, never stacked — v25's
  table rule, now off tables too. Three low-stock products cost 171px stacked, 96px on one line.
- **Stripes, not hairlines** (`--po-row-alt #F4F4F4`). Never both: two separators for one boundary
  is the card-inside-a-card mistake again. One step deeper than Shopify's #F7F7F7 because that is
  our page colour — at #F7F7F7 the band matches the canvas and the card stops reading as a card.
- **Tables are striped by default** now, not opt-in. `.no-zebra` gives hairlines back for the two-
  or three-row tables where there is nothing to track across.
- **A list row is roomier than a table row** — `calc(var(--po-row-h) + 8px)`. Eight lines can afford
  the air; fifty cannot. Both still track the density setting.
- **Hover is a darkening layer**, `rgba(0,0,0,.045)`, not a grey. A flat grey disappears on a stripe.
- `.ml-value` is the answer (600, ink, tabular). `.ml-trail` is the optional third column, fixed at
  58px so values line up. `.warn`/`.danger` colour **the value only**; the row never turns red.
- **Payment is a pill, the everyday "done" state is not** (owner, 2026-09-26, reversing the
  plain-text payment rule: "we need to be able to distinguish it at a glance"). Every Payment cell
  goes through `txPayStatus()` / `payPill()` in `backoffice.js`: one soft hue per method — cash green,
  GCash blue, Maya violet, QR teal, card rose, Account amber, split and anything else grey (`.pay-*` in
  `bo-calm.css`; a custom method takes the tone its name contains). A voided or saved row greys its
  pay pill. The done states — Completed, a Received PO, a Clear balance — are muted text, so the
  exceptions (Voided, Refunded, Active, In use, Ordered, Overdue…) are the only other pills. Pills,
  not dots: dots were turned down 2026-09-19.

**A stat row is padded, never a fixed height.** Three separate things pushed the text to the top of
its own stripe and all three are worth remembering: a fixed `height` leaves one auto track that
stretches, and baseline-aligning inside a stretched track pins items to the top; `align-items:
baseline` across a 13px label and a 17px value makes the track as tall as the big number's ascent
*plus* its descent; and `.kpi-label` still carried `margin-bottom: 6px` from the stacked-KPI era, a
phantom that grew the track without drawing anything. So: symmetric `padding`, `align-items: center`
on the row (the value and its delta keep their baseline inside `.kpi-main`, where they are adjacent
and it shows), and the label margin zeroed. **If a row ever looks top-heavy again, check for a
leftover margin on a child before touching the row.**

**A stat cell is a row too.** `.dash-top .stat` / `.sales-top .stat` are label-left, value-and-delta-
right, one line, same full-bleed stripe. Stacked, three numbers had to fill the height of the chart
card beside them and had nothing to put in it — ₱0 at 25px in 100px of white is what made the
Overview read as broken on an empty day. **Cards size to their rows now**: `.dash-top` and
`.dash-grid-3` are `align-items: start` and the 275px `min-height` on dashboard lists is gone, so a
short card is short. Ragged card bottoms are the accepted cost; a striped list stopping halfway up
a white card reads as a list that failed to load. This supersedes the "flex: 1 insets so they match
height" note under *Landing page* above.

**The shadcn half**, all new in v33 and all catalogued in `design.html`:

- **One focus ring for the product** — a 3px translucent halo in the accent plus a solid border, on
  `:focus-visible` only. Reads on any background, never shifts layout, replaces the four different
  focus styles that had accumulated. Never `outline: none` without putting it back: half this app is
  driven from a keyboard at a counter.
- **`.btn`** — three variants (default / `.primary` / `.ghost` / `.danger`) and three heights
  (26 / 32 / 38). The 32 matches an input so a button beside a field lines up for free. `.danger` is
  for the confirm inside a dialog, never a red button sitting next to Save in a toolbar.
- **Popups use the native `popover` attribute and `<dialog>`** — no library, no JS. The browser
  gives us the top layer, light-dismiss, Esc and focus return: every part a hand-rolled dropdown
  gets wrong. The motion is shadcn's, fade plus a 96% zoom, **150ms in and 100ms out**. It animates
  *both* ways only because of `@starting-style` + `transition-behavior: allow-discrete`; without
  those a menu fades in and then vanishes on close, which is the tell of a cheap one.
- **One accent** (`--po-accent`, the existing link blue) drives link, ring and selection, so the
  page reads as one system. Changing that line rebrands the product.

### Sidebar (v26–v27)
One flush full-height column (the user rejected an inset floating island): **location switcher** on
top (business name small, location big, because the location is what you switch), then three
sections (2026-09-19, the owner asked for "1 click deep, not a lot when a dropdown is open"):
`Main menu` (Dashboard, Sales, Transactions, Products, Customers: Products moved up by the owner 2026-09-26; Sales is a plain link with no tree since 2026-09-27), `Stock` (
Suppliers, with Purchase orders as a tree leaf under it (`data-sub="suppliers orders"`, owner 2026-09-26); Stock history is a tree leaf under Products since 2026-09-25, which
emptied and removed `Reports`). **Settings sits at the bottom, in `.side-footer`** (2026-09-26; `Manage` is gone):
clicking it swaps the sidebar to `.side-setnav` — Store, Tax,
Payments, Receipt & printing, Staff & access, Appearance, Data, each its own route
(`/admin/settings/<section>`; Payments keeps `/admin/payments`). **← Back takes the store switcher's slot**
(`[data-set-back]`, owner 2026-09-27): it goes to the last main-nav URL, else the Dashboard; the footer's
Settings row hides while in Settings, the account row stays; no Esc binding. Each section is one column of
cards; typed values read as rows (`.set-rows`: label, value, ›) and a click opens that card's fields in
`#setDlg` (Save/Cancel). On/off and pick-one settings save on change; no Save bar. Appearance is per device. Every choice is a native `<select>`; on/off
stays a checkbox. Daily-work sub-pages
are their own links; reports stay in a tree. **Rule: nothing sits more than one fold deep, and an
open tree holds at most ~6 items.** Section labels are buttons that fold their links
(`aria-expanded`, remembered per device in `HWPOS_STORE.ui` `sideFolded`, never synced). Section
folds and page trees share one animation: `SIDEBAR FOLDS (v30)`, a one-row grid sliding
0fr <-> 1fr around `.side-fold-in`; don't swap it back to `display: none`. The chevron on any page
with a tree opens that tree in place (`.open`) without navigating; clicking the name navigates. **One tree open at a time** (owner, 2026-09-26): opening a tree (chevron, re-clicking the active page, or navigating) slides every other shut, the active page's included (`shutTrees()`), and every open *and* close animates -- never add a `display: none` on `.folded` / `.side-sub` again (that is what made folding snap). **Sales is a plain link** (owner, 2026-09-27): no `data-sub`, no tree; it stays lit on both Summary and Items, which switch inside the page (see Sales page). It was `data-sub="summary items"` with Items as a tree leaf (2026-09-26); don't bring the leaf back. Re-clicking a page folds its tree only when you are on that page itself; from one of its leaves (Purchase orders, Stock history) the name navigates back to the page (owner, 2026-09-26). The chevron still folds it from a leaf. `paint()` calls `shutTrees()` whenever the lit link changes, so Back/Forward and in-page links can't leave two trees open. **Every dropdown animates** (`DROPDOWN MOTION (v31)`, CSS only):
menus keep opening with `hidden` / `<details>`, and the CSS fades and drops them 4px using
`@starting-style` + `display ... allow-discrete`. A new dropdown adds its class to that rule. Tried and rejected, don't redo:
six labelled sections with every sub-page as its own link ("stuff gets lost"), and a bare
Shopify list with no labels or chevrons ("too much like Shopify"). Then the **account switcher** as a row: blue user badge, name + role. Only the store switcher (green store badge) carries the ⌄.
**Solid one-colour icons** (v35, 2026-09-26, Lucide from `dashboard-sidebar-notion-lab.html`): shapes are `.f` (filled); inner detail is a `.k` stroke or `.hole` dot painted in `--knock`, the row's own fill, so it stays a cutout on rest, hover and active -- a new icon uses those classes, never a white stroke. Names are 400 in `--po-sidebar-ink` #262626, icons a step softer in `--po-sidebar-icon` #454545, both `--po-sidebar-ink-hi` on the active row; the tree under them is `--po-ink-secondary`. (v34 had Shopify's filled rounded icons, `.i-cut`/`.i-hole`, and 550 parents.) Menus: `renderSwitchers()` in
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
keys, space-separated: the link opens the first and carries all of them as
its own tree -- that is how Analytics splits into four short entries. Its `groups` are no longer
reached (no plain Analytics link); the nav markup is the grouping now. `goSub()` navigates them,
`paint()` lights the deep link when the URL's sub-page has one (else the view's plain link), and
`buildSubnav()` leaves those keys out of the tree -- a view whose every key has a link gets no tree
and needs no plain link. `data-sub` is for sub-pages that are somewhere else; two readings of the same
thing are an in-page switch instead (Products' Catalog | Stock, Sales' Summary | Items — owner,
2026-09-27). A view with a switch registers no `HWPOS_SUBNAV`, or `buildSubnav()` grows a tree back
under its plain link.

**The switch looks and moves one way** (owner, 2026-09-28, `switcher-lab.html` #1 and
`sales-switcher-lab.html`): a grey track (`--btn-soft`) with the picked view on a white thumb, and no page
title beside it, so it is sized as the heading: a pill, 30px tall, 13.5px text (34px with square corners was too big and boxy). The thumb is the active link's own background (`bo-products.css`), so it is right without JS.
On a click `switchSettle()` (backoffice.js, run from `paint()`) glides a `.pd-glide` from the old place to the
new one (200ms) and fades what sits below the head in (180ms opacity only, no slide). A new in-page switch uses
`.seg.pd-switch` and gets both for free.

**Analytics** is the page title of the `insights` view (the sidebar shows its four report links). The key, URL and role-access entry stay
`insights`, so saved links and access maps keep working. Its page title is the report name.
CSS: `SIDEBAR SWITCHERS (v26)` + `SIDEBAR LOOK (v27)` + `COMPACT SIDEBAR (v28)` (Shopify density:
~27px rows, no dividers, flat white active row; keeps the v27 muted grey ink -- the user rejected
darker, bolder nav text in v28; v34 `SIDEBAR WEIGHT` later asked for the 550 parent weight; v35 `SIDEBAR + SHEET` supersedes the look), last in styles.css.
