# POS front-end design system (`index.html`, `pos-*.js` + `app.js`, `styles.css`)

The till's logic is one classic script per screen (`pos-*.js`, then `app.js` for events + `init()`; order:
`index.html`); README.md says what each holds. One global scope: a new top-level name must
not repeat one in another script, and nothing may run at load that a later file defines.
The till has no folder strip and no product / folder modals any more (`#productModal`,
`#folderModal` are gone): items are edited on the Items page (`.lv .iv`), categories in the back office.

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
The loudest thing on screen is white-on-dark inverted to **dark-on-white**: `--accent #fff` bg with `--accent-ink #121212` text. This is reserved for the single primary action / active state in a group (Check out = `.rail-h .go`: flat `var(--accent)`, `--accent-hover` / `--accent-pressed`, disabled at `opacity: .3`; the light theme flips `--accent` to `#303030`). Everything non-primary stays on the grey ladder. One exception: a discount that is on shows in blue `--rl-on` (`.d-row.on`).

### Semantic color only for meaning, always tinted
`--warn` amber, `--danger` red, `--ok` green — each **always paired with its translucent `-bg`** (e.g. `--danger` text on `--danger-bg` fill). Never use a saturated fill; the tint keeps the dark theme intact. Credit/owed balances → warn; over-limit/destructive → danger; completed/in-stock → ok.

### Typography — tight, weighted, tabular
- System font stack; base **14px / line-height 1.5 / letter-spacing -0.15px**. Headings tighten further (-0.3px).
- **Apple numeric weights**: 510 (medium labels), 590 (semibold titles), 650/700 (bold totals & values). Avoid 400/500/600 round numbers — match the 510/590/650 rhythm already in use.
- **Size roles**: 11px uppercase +0.4px tracking = a *label* (always `--ink-tertiary`); 13–15px = body/title; 17px/700 = a total; 20–24px = page/stat headline; 34–84px = hero amounts (clamp the giant ones, see overflow rule).
- **All money/quantities use `font-variant-numeric: tabular-nums`** so digits align in columns. Non-negotiable for any number that sits in a row or stacks vertically.

### Radius hierarchy = size of the thing
Small interactive controls and chips: `--r-button`/`--r-card`/`--r-chip` 4px. Inputs, icon buttons, pills, mid buttons: `--r-input` 10px. Large surface containers get rounder as they get bigger (sale sidebar and `.lv` cards `--rl-r` 14px, Customers list box 16px). Modals `--r-modal` 6px; hero cards ~18px. Pills that should read as fully round use 9999px. **Pick radius by the element's size class, consistent with its neighbors.**

### Shadows are restrained
Cards are flat (`--shadow-card: none`) — depth comes from the color ladder + hairline, not drop shadows. Only floating layers cast: `--shadow-raised` (dropdowns/toasts), `--shadow-modal` (dialogs). Don't add shadows to inline surfaces.

## Alignment & relationships — how elements relate

The layout reads as a **grid of aligned edges and shared baselines**. When you place or move anything, make it line up with something already there.

- **Anchors stay put across views.** The hamburger is the canonical example: identical position (16px from top, 48px) on every page so it never jumps when navigating. Treat persistent controls as fixed anchors.
- **Paired columns share a top edge.** Left list and right detail begin at the same Y: Sell's search row ↔ the sale sidebar's customer card; Orders' `.o-rail` head ↔ `.o-top`. A column that fills height also shares its **bottom** edge with its neighbor (Customers' list box bottom ↔ detail scroll bottom; the floating action button rides that shared bottom).
- **Title + subtitle align on the baseline**, not the box (`align-items: baseline` in `.view-title-wrap`). A label and its count/sub sit on one line, sub in tertiary ink.
- **Row = label left, value right, space-between.** This is the repeating unit (totals, meta rows, cart items, settings rows): `display:flex; justify-content:space-between`. Label is muted/tertiary, value is primary ink + tabular-nums, hugging the right edge. Numbers in a stack must right-align to each other.
- **Groups are one segmented control, one active member.** Payment methods, Settings size toggles: equal-width siblings in a track; exactly one is inverted-white (active), the rest sit on the grey ladder. Selection is shown by inversion, never by an outline-only change. (Walk-in/Pickup/Delivery is no longer a group: it is one `.pick` dropdown in `.f-row`, opening a `.rail-menu`, sharing the `.opts` row with Discount.)
- **Consistent gutters build the rhythm.** Spacing comes from a small set of steps — 4 / 6 / 7 / 8 / 12 / 14 / 16 / 18 / 24 / 28px. Reach for an existing step; don't introduce a 13px or 21px one-off. Edge padding for page content is 28px; the hamburger row gap is 7px.
- **Things that belong together touch; things that don't get a gutter or a hairline.** Separators (`--line`) appear only to divide genuinely distinct groups — and prefer *space* over a line. (E.g. no divider above collapsed totals; the line only animates in when the section expands.)
- **Symmetry by default.** Equal left/right padding, centered receipts (`max-width` + auto-center), mirrored button pairs. Asymmetry should be intentional (label/value rows), never accidental drift.

---

## Layout grammar (applies to every view)

- **Hamburger is anchored in the same spot on every page: 16px from the top of the content area, 48×48px.** When switching views it must not move.
  - Sell: `.search-row` lives in `.catalog` (`padding-top: 8px`) inside `.content-row` (`padding: 8px …`) → 8 + 8 = 16px.
  - Orders: `.lv .head .sq` in `.o-rail` (`margin: 8px 0`) inside `.ov` (`padding: 8px 18px`) → 8 + 8 = 16px.
  - Items: `.lv .page` (`padding-top: 16px`).
  - Customers: `.orders-layout` (`padding-top: 16px`). Reports / Settings: `.view-head` (`padding-top: 16px`).
  - If you change any of these paddings, re-check that the hamburger still lands at 16px on all pages.
- **Hamburger + search + barcode sit in one row, all 48px tall, edge-to-edge.** Gap between them is `7px` (`.search-row`). To widen the search bar, shrink the gap — never move the hamburger/barcode (they're pinned to the row edges; the search bar is `flex: 1`).
- Sell hamburger/barcode use `.ghost-icon`; Orders/Items use `.lv .sq` (48px, `var(--rl-r)`, `--rl-card` fill, 1px `--line` border, row gap 7px in `.lv .head`); Customers/Reports/Settings use `.view-hamburger`. **Keep them visually identical** (48px, `var(--rl-r)` radius — the sale sidebar's customer card, which they line up with — `var(--rl-soft)` bg (the sidebar's Item / Amount band) with an inset `var(--rl-hair)` hairline ring (softer than `--line`: 3% white dark, `#EBEBEB` light) in both themes, no top shine). Product tiles wear the same fill and ring. The Customers search (`.orders-search-wrap input`) wears Sell's search fill, ring and corner too, and its row uses the same 7px gap — only its text/icon stay smaller (13px / 14px). The product grid below them is deliberately **not** flush with the sidebar's cards (tried; too cramped): `.catalog` keeps its 14px gap under the search row, and its last row ends level with the **Check out button's** bottom, not the card's (`.catalog` bottom padding 21px = rail margin 8 + card border 1 + `.pay` padding 12).
- **Horizontal page padding is 28px** for `.view-head` / `.orders-layout`; Sell resolves to 28px too (18px row + 10px catalog). The `.lv` pages (Orders, Items) use 18px, like the sale sidebar's row.

## The hairline shine (signature surface highlight)

Every raised dark surface gets a faint top highlight so it doesn't look dead/flat:

```css
box-shadow: inset 0 1px 0 rgba(255,255,255,0.07);
```

Still on: `.ghost-icon` (modal close / map buttons; in `.search-row` the `--rl-hair` ring replaces it), `.od-details-btn`, `.orders-list`, `.order-row.active` (Customers), the Reports boxes. It survives `:focus` (focus only changes background) and `overflow: hidden`.

**Not on the sale sidebar or the `.lv` pages.** `.rail-h` and `.lv` cards are a 1px border plus `--rl-shadow` (`none` in dark): an inset top highlight on top of the border doubled it. New cards in those families follow them, not the shine.

The white gloss (gradient + inset highlight) for active white buttons is gone with the old cart: Check out is flat `.rail-h .go`, and Walk-in/Pickup/Delivery is a dropdown (Walk-in is the default, owner 2026-10-03). The `.cart`, `.fulfil-pill`, `.cart-discount-btn`, `.charge-btn`, `.cart-foot` rules left in `styles.css` match no markup; don't style new things through them.

## Collapsible totals/sections mechanic

Reusable expand/collapse: a header row toggles `.open`; the detail panel animates explicit pixel `height` for smoothness. Copy this pattern (don't reinvent) for any collapsible list:

- Closed = `height: 0; overflow: hidden`. Open = measure inner, set px height, then `height: auto` on `transitionend`. Close = lock current px, then `requestAnimationFrame` → `0`.
- A chevron (`<polyline points="6 9 12 15 18 9">`) rotates 180° via `.open`.
- Live instances: order-detail modal Items (`#odmItemsToggle`) and Total/subtotals (`#odmTotalToggle`).
- The sale sidebar's totals use a lighter CSS-only version: `.rail-h .sum` (`#totalRow`, `aria-expanded`) opens `.rail-h .break` (`#totalsDetail`) by animating `grid-template-rows` `0fr` → `1fr`; no pixel measuring.
- **Separator lines appear only when expanded.** No always-on divider above collapsed totals.

## Orders page specifics

- An `.lv` page (`.ov`): `.o-rail` on the left (460px; 340 at ≤1100px, 320 at ≤920px container width) holds `.head` (`.sq` hamburger + `.card.find` search/filter) over `.card.list`; `.o-main` on the right is `.o-top` (back, title, `.acts`: Print, Refund, ⋯) over `.paper-scroll` with the receipt.
- Selecting a row shows its receipt. **The full details modal opens only from ⋯ › Order details** — never by clicking the receipt. ⋯ also holds Refund items, Exchange and Void sale (red).
- At ≤720px container width the receipt slides over the list (`.ov.reading`) and `.o-top .back` appears.
- Order-details modal is **wide** (`width: min(805px, 100%)`), items collapsed by default. `.odm-actions` is a 4-column grid of boxed buttons (Void / Refund / Refund items / Exchange): `border: 1px solid var(--line)`, `border-radius: 10px`.
- Customers still uses the older recipe: search row **outside** the grey box (`.orders-list`, `var(--bg-soft)`, radius 16px, starts at the first row), detail top-aligned with the search, `.od-foot` an absolute overlay pinned bottom-right ("View full history" / "Record payment").

## Returns, exchanges and the asks

- **Refund and Void always ask first** (`showConfirm` in `app.js`): "Refund #N? — ₱X goes back to the customer." / "Void #N? — The sale stays on record, marked voided." A void works only on today's sale with no refunds; each void or refund is a **new order row** (`originalOrderId`), never an edit.
- **Refund items** (`pickReturnLines`): a qty box per line, capped at what is left, with a live **Coming back ₱X** row (`SalesMath.refundPart`).
- **Exchange** goes through the sell cart: the picked lines come back, the customer's new items ring as usual, and the cart's Check out reads **Exchange**. The confirm says "Coming back ₱X · Going out ₱Y." then **Collect ₱N (tender)**, **Hand back ₱N (tender)** or **Even swap, no money changes hands**.
- **Duplicate phone**: typing a number another customer has shows a note with **Open \<name\>** (`data-open-cust`). Mid-sale it puts that customer on the receipt; otherwise it opens their page.
- **Lost sale** (sidebar ⋯, `#lostSaleModal`): Asked for (catalog search), Qty, Why (Out of stock / Not carried / Too expensive / Other), Bought instead, **Log lost sale**.
- **Numbers on screen**: every quantity through `SalesMath.qtyText` (`qty-check` fails on a `parseInt` quantity), every amount through `peso()`. No hand-built `₱`, no `toFixed` for display.

## Cross-device / touch

- **The till's sidebar rules are the till's alone**: the base `.sidebar` / `.side-*` / `.brand-*` / `.user-row` rules, the `#app::before` backdrop and the ≤920px icons-only `@media` block in `styles.css` are all scoped to `:where(#app:not(.bo-app))`, because the back office is `#app` with `.sidebar` / `.side-link` too. A new sidebar rule gets the same scope (`:where()` keeps specificity unchanged).
- **Safe-area inset (`env(safe-area-inset-bottom)`) is applied exactly once** — on the sale sidebar `.rail-h` only (its rules are scoped `.rail-h`, never bare `.rail`: the back office loads styles.css and has its own `.rail`) (its bottom margin; its bottom padding at ≤720px). Never double up (a child like `.pay` or `.go` must not also add it). Keep a constant base gap + single inset so the gap is tight on desktop and clears the home indicator on iPad/iPhone.
- **pos-lab phone (≤720px): insets come from `var(--ph-safe)`, never raw `env()`.** The phone block sets `--ph-safe: env(safe-area-inset-bottom, 0px)`; devices.html overrides the variable to fake an iPhone (an iframe's `env()` is always 0). A rule on raw `env()` looks right in the preview and wrong on the phone — the variant sheet stopped 34px short of the bar on a real iPhone (2026-10-08). A layer that sits *above* the bottom bar adds nothing: the bar already clears the home bar.
- Product-grid swipe is tuned for **low resistance**: drag engages after 4px, page flips at 12% of width, plus flick detection (`elapsed < 300ms && |dx| > 30 && velocity > 0.25`). Don't raise these without reason.

## Settings-driven display

Sell tiles are kept **flat** (`var(--rl-soft)` + the inset `--rl-hair` ring, no gradient/shadow/lift) — the user rejected the 3D look. Both themes share one tile shape and type: `var(--r-input)` corners, names as typed in 500 weight (no capitals). Themes differ in **colour only** — a light-theme rule never changes radius, case, weight or size. Two independent Settings → Appearance controls:
- **Tile size** (`hwpos.tileSize`, S/M/L) → items-per-page + grid density (`grid.dataset.size`).
- **Tile text size** (`hwpos.tileText`, S/M/L/XL) → `.pc-name` font only, via `grid.dataset.text` → `--pc-name-size` (11/13/15/18px). Independent of tile size.

Pattern for a new display pref: add `STORAGE_*` const + `TILE_*` list, init in `state`, a setter that persists + `renderProducts()`, a toggle in the Appearance panel, sync in `renderPosSettings()`, and a click listener.

## Reports page & payment-method infrastructure

**Hidden**: no role in `ROLE_ALLOWED` (pos-core.js) includes `reports`, so the side link never shows; add it back to the manager set to bring it back. The page (`renderReports()` in `pos-customers.js`) still works and stays deliberately minimal: **Today's net sales + order count** (`SalesMath.summarize`), a **last-7-days bar chart stacked by payment method** (segments `flex-grow` by amount, order count under each bar, legend with per-method money + orders), and a **live list of today's sales still standing** (newest first; #, customer, time, cashier, method dot + `SalesMath.payWord`, amount; tap to open the order). No avg-basket, low-stock, or cash-drawer sections — they were removed. Styled like Customers: `bg-soft` rounded-16 boxes with the hairline, list scrolls inside its box.

Payment methods are SalesMath's, the back office's too:
- Money per method is `SalesMath.tenders` (a split sale is its legs; what went back is taken off); words from `SalesMath.tenderLabel`. GCash, QR and a store's own method ("Maya") keep their names from the order.
- Colours: `PAY_KEYS` (`cash, gcash, qr, credit, other`) → `payColor(k)` = `var(--pm-*)` tokens, set for both themes (a deliberate data-viz exception to the monochrome theme); a store's own method wears Other's. The Orders Payment filter uses the same keys and colours.
- Real-time: re-renders on the `storage` event and `visibilitychange` (cross-tab on one device), plus a 4s `reportsLive()` poll guarded by `reportsSignature()` (the stored orders string itself; the seam a future backend push/sync replaces). **True multi-device real-time needs the backend sync layer** — local storage is per-device.
