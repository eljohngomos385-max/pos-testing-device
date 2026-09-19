# POS front-end design system (`index.html`, `app.js`, `styles.css`)

The dark POS interface. Read this before any front-end change to the POS so conventions
don't have to be re-explained. The Back Office is a separate, light system — see
`docs/backoffice.md`; do not carry these recipes across.

---

## Design language — the feel

A **monochrome, dark, Apple-grade** interface: near-black canvas, white type at graded opacities, white as the only accent. No colored chrome — color appears *only* to carry meaning (warn/danger/ok). Calm, flat, high-contrast, money-first. Everything is built from the `:root` tokens — **never hardcode a hex/size that a token already names.**

### Color is an elevation ladder, not decoration
Surfaces get lighter as they rise toward the user. Read this as depth:
`--bg #121212` (canvas) → `--bg-soft #1C1C1C` → `--bg-softer #232323` → `--surface #2A2A2A` (interactive control resting) → `--surface-hover #333` (hover/raised). `--surface-2 #1F1F1F` is the sidebar.
- **Hover = one rung up the ladder** (e.g. `--surface` → `--surface-hover`). Pressed = a touch lighter still. Don't invent hover colors; step the ladder.
- The **hairline shine** (`inset 0 1px 0 rgba(255,255,255,0.07)`) simulates light catching the top edge of a raised surface — it reinforces the same "lit from above" depth model. That's why it belongs on raised controls/boxes.

### Ink is white at four opacities = hierarchy
`--ink` 100% (primary values, titles) → `--ink-secondary` 70% (body, labels-in-context) → `--ink-tertiary` 45% (muted labels, captions, placeholders) → `--ink-quaternary` 28% (chevrons, faint glyphs). **Importance is expressed by opacity, not by color.** Borders follow the same idea: `--line` 8% (default hairline), `--line-strong` 14% (emphasis).

### White is the accent (inverted emphasis)
The loudest thing on screen is white-on-dark inverted to **dark-on-white**: `--accent #fff` bg with `--accent-ink #121212` text. This is reserved for the single primary action / active state in a group (Check out, the active Pickup/Delivery pill, active folder pill). Because white can't show a white shine, active white buttons use the **gloss** recipe instead (see below). Everything non-primary stays on the grey ladder.

### Semantic color only for meaning, always tinted
`--warn` amber, `--danger` red, `--ok` green — each **always paired with its translucent `-bg`** (e.g. `--danger` text on `--danger-bg` fill). Never use a saturated fill; the tint keeps the dark theme intact. Credit/owed balances → warn; over-limit/destructive → danger; completed/in-stock → ok.

### Typography — tight, weighted, tabular
- System font stack; base **14px / line-height 1.5 / letter-spacing -0.15px**. Headings tighten further (-0.3px).
- **Apple numeric weights**: 510 (medium labels), 590 (semibold titles), 650/700 (bold totals & values). Avoid 400/500/600 round numbers — match the 510/590/650 rhythm already in use.
- **Size roles**: 11px uppercase +0.4px tracking = a *label* (always `--ink-tertiary`); 13–15px = body/title; 17px/700 = a total; 20–24px = page/stat headline; 34–84px = hero amounts (clamp the giant ones, see overflow rule).
- **All money/quantities use `font-variant-numeric: tabular-nums`** so digits align in columns. Non-negotiable for any number that sits in a row or stacks vertically.

### Radius hierarchy = size of the thing
Small interactive controls and chips: `--r-button`/`--r-card`/`--r-chip` 4px. Inputs, icon buttons, pills, mid buttons: `--r-input` 10px. Large surface containers (cart 10px, orders box 16px) get rounder as they get bigger. Modals `--r-modal` 6px; hero cards ~18px. Pills that should read as fully round use 9999px. **Pick radius by the element's size class, consistent with its neighbors.**

### Shadows are restrained
Cards are flat (`--shadow-card: none`) — depth comes from the color ladder + hairline, not drop shadows. Only floating layers cast: `--shadow-raised` (dropdowns/toasts), `--shadow-modal` (dialogs). Don't add shadows to inline surfaces.

## Alignment & relationships — how elements relate

The layout reads as a **grid of aligned edges and shared baselines**. When you place or move anything, make it line up with something already there.

- **Anchors stay put across views.** The hamburger is the canonical example: identical position (16px from top, 48px) on every page so it never jumps when navigating. Treat persistent controls as fixed anchors.
- **Paired columns share a top edge.** Left list and right detail begin at the same Y: Sell's search row ↔ the receipt panel header; Orders' search row ↔ the receipt preview top. A column that fills height also shares its **bottom** edge with its neighbor (orders list box bottom ↔ receipt scroll bottom; the floating action button rides that shared bottom).
- **Title + subtitle align on the baseline**, not the box (`align-items: baseline` in `.view-title-wrap`, `.cart-title-wrap`). A label and its count/sub sit on one line, sub in tertiary ink.
- **Row = label left, value right, space-between.** This is the repeating unit (totals, meta rows, cart items, settings rows): `display:flex; justify-content:space-between`. Label is muted/tertiary, value is primary ink + tabular-nums, hugging the right edge. Numbers in a stack must right-align to each other.
- **Groups are one segmented control, one active member.** Pickup/Delivery, payment methods, size toggles: equal-width siblings in a track; exactly one is inverted-white (active), the rest sit on the grey ladder. Selection is shown by inversion, never by an outline-only change.
- **Consistent gutters build the rhythm.** Spacing comes from a small set of steps — 4 / 6 / 7 / 8 / 12 / 14 / 16 / 18 / 24 / 28px. Reach for an existing step; don't introduce a 13px or 21px one-off. Edge padding for page content is 28px; the hamburger row gap is 7px.
- **Things that belong together touch; things that don't get a gutter or a hairline.** Separators (`--line`) appear only to divide genuinely distinct groups — and prefer *space* over a line. (E.g. no divider above collapsed totals; the line only animates in when the section expands.)
- **Symmetry by default.** Equal left/right padding, centered receipts (`max-width` + auto-center), mirrored button pairs. Asymmetry should be intentional (label/value rows), never accidental drift.

---

## Layout grammar (applies to every view)

- **Hamburger is anchored in the same spot on every page: 16px from the top of the content area, 48×48px.** When switching views it must not move.
  - Sell: `.search-row` lives in `.catalog` (`padding-top: 8px`) inside `.content-row` (`padding: 8px …`) → 8 + 8 = 16px.
  - Orders: `.orders-search-row` inside `.orders-col` (no padding) inside `.orders-layout` (`padding-top: 16px`) → 16px.
  - Customers / Reports / Settings: `.view-head` (`padding-top: 16px`).
  - If you change any of these paddings, re-check that the hamburger still lands at 16px on all pages.
- **Hamburger + search + barcode sit in one row, all 48px tall, edge-to-edge.** Gap between them is `7px` (`.search-row`). To widen the search bar, shrink the gap — never move the hamburger/barcode (they're pinned to the row edges; the search bar is `flex: 1`).
- Sell hamburger/barcode use `.ghost-icon`; other pages use `.view-hamburger`. **Keep both visually identical** (48px, `var(--r-input)` radius, `var(--surface)` bg, no border).
- **Horizontal page padding is 28px** for `.view-head` / `.orders-layout`; Sell resolves to 28px too (18px row + 10px catalog).

## The hairline shine (signature surface highlight)

Every raised dark surface gets a faint top highlight so it doesn't look dead/flat:

```css
box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
```

Already on: `.ghost-icon`, `#searchInput`, `.view-hamburger`, `.orders-search-wrap input`, `.cart` (receipt), `.od-details-btn`, `.orders-list`, `.order-row.active`. **Add it to any new dark surface/button/input/box** for consistency. It survives `:focus` (focus only changes background) and `overflow: hidden`.

## Active/white-button gloss

White (`#fff`) active buttons can't show a white shine, so use a **visible gloss** instead — bright top edge + faint bottom shadow + subtle gradient. Apply **only in the active/enabled state** (inactive/disabled stay flat):

```css
background: linear-gradient(180deg, #ffffff 0%, #e6e6e6 100%);
box-shadow: inset 0 1px 0 rgba(255,255,255,1), inset 0 -2px 4px rgba(0,0,0,0.10);
```

On: `.fulfil-pill.active` (Pickup/Delivery), `.cart-discount-btn.active`, enabled `.charge-btn` (Check out). Disabled `.charge-btn` sets `box-shadow: none`. Watch specificity: the `.cart .cart-fulfilment-row .fulfil-pill.active` rule (4 classes) is what actually paints the fulfil pill — edit that one for background changes.

## Collapsible totals/sections mechanic

Reusable expand/collapse: a header row toggles `.open`; the detail panel animates explicit pixel `height` for smoothness. Copy this pattern (don't reinvent) for any collapsible list:

- Closed = `height: 0; overflow: hidden`. Open = measure inner, set px height, then `height: auto` on `transitionend`. Close = lock current px, then `requestAnimationFrame` → `0`.
- A chevron (`<polyline points="6 9 12 15 18 9">`) rotates 180° via `.open`.
- Live instances: cart totals (`#totalRow` / `.totals-detail`), order-detail modal Items (`#odmItemsToggle`) and Total/subtotals (`#odmTotalToggle`).
- **Separator lines appear only when expanded.** No always-on divider above collapsed totals (`.cart-foot` has `border-top: none`; the line comes from `.totals.open .row.total`).

## Orders page specifics

- Search row sits **outside** the grey container box. The box (`background: var(--bg-soft)`, `border-radius: 16px`) lives on `.orders-list` only — it starts at the first order row, never wraps the hamburger/search.
- Selecting an order row only highlights it. **Opening the full details modal happens only via the "View order details" button** — never by clicking the receipt preview area.
- Receipt preview (right column) is **top-aligned** with the search bar and fills to the **bottom** of the container: `.od-inner { margin: 0 }`, `.od-scroll { flex: 1; padding-top: 0 }`, and `.od-foot` is an **absolute** overlay pinned bottom-right (`pointer-events: none` on the wrapper, `auto` on the button) so the scroll area uses full height.
- Order-details modal is **wide** (`width: min(805px, 100%)`), items collapsed by default. Action buttons (Void/Refund/Return/Exchange) are boxed: `border: 1px solid var(--line)`, `border-radius: 10px`.

## Cross-device / touch

- **Safe-area inset (`env(safe-area-inset-bottom)`) is applied exactly once** — on `.cart-foot` only. Never double up (a child like `.cart-actions` must not also add it). Keep a constant base gap + single inset so the gap is tight on desktop and clears the home indicator on iPad/iPhone.
- Product-grid swipe is tuned for **low resistance**: drag engages after 4px, page flips at 12% of width, plus flick detection (`elapsed < 300ms && |dx| > 30 && velocity > 0.25`). Don't raise these without reason.

## Settings-driven display

Sell tiles are kept **flat** (`var(--surface)`, no gradient/shadow/lift) — the user rejected the 3D look. Two independent Settings → Appearance controls:
- **Tile size** (`hwpos.tileSize`, S/M/L) → items-per-page + grid density (`grid.dataset.size`).
- **Tile text size** (`hwpos.tileText`, S/M/L/XL) → `.pc-name` font only, via `grid.dataset.text` → `--pc-name-size` (11/13/15/18px). Independent of tile size.

Pattern for a new display pref: add `STORAGE_*` const + `TILE_*` list, init in `state`, a setter that persists + `renderProducts()`, a toggle in the Appearance panel, sync in `renderPosSettings()`, and a click listener.

## Reports page & payment-method infrastructure

Reports is deliberately minimal: **Today's Revenue + Transactions count**, a **last-7-days revenue bar chart stacked by payment method** (vertical bars, each day's bar split into colored segments per method, txn count under each bar, legend with per-method totals + transaction counts), and a **live list of every completed sale today** (newest first, each row shows #, cashier, a method chip with color dot, amount; tap a row to open its order-detail modal). No avg-basket, low-stock, or cash-drawer sections — they were removed. Styled like Orders: transparent `.view-reports .page-pad` (flex column), `bg-soft` rounded-16 boxes with the hairline, list scrolls inside its box.

Payment method is preserved per order so the breakdown is real:
- `normalizeOrderRecord` keeps the legacy `paymentMethod` coerced to `cash/credit/split/unpaid` (drawer + credit math depend on it), and **additionally** stores `paymentKind` (`cash|gcash|qr|credit|split|other|unpaid`) and `paymentMethodLabel` (display string, incl. custom names like "Maya"). Without this, GCash/QR/custom collapse to "Cash" and the info is lost.
- `orderPaymentLabel(o)` returns `paymentMethodLabel` for completed sales. `REPORT_METHOD_META` maps each `paymentKind` to a muted categorical color + label (a deliberate data-viz exception to the monochrome theme); `reportMethodKind(o)`/`reportMethodMeta(kind)` are the accessors used by the chart, legend, and the tx-row color dots.
- Chart/legend aggregate from real `loadOrders()` data over the trailing 7 days; bar height is the day total scaled to the range max, segments use `flex-grow` proportional to each method's amount.
- Real-time: re-renders on the `storage` event and `visibilitychange` (cross-tab on one device), plus a 4s `reportsLive()` poll guarded by `reportsSignature()` (the seam a future backend push/sync replaces). **True multi-device real-time needs the backend sync layer** — localStorage is per-device.
