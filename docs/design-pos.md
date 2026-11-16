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
- **Row = label left, value right, space-between.** This is the repeating unit (totals, meta rows, cart items, settings rows): `display:flex; justify-content:space-between`. Value is tabular-nums, hugging the right edge; which side is dark follows **Rows** below. Numbers in a stack must right-align to each other.
- **Groups are one segmented control, one active member.** Payment methods, Settings size toggles: equal-width siblings in a track; exactly one is inverted-white (active), the rest sit on the grey ladder. Selection is shown by inversion, never by an outline-only change. (Walk-in/Pickup/Delivery is no longer a group: it is one `.pick` dropdown in `.f-row`, opening a `.rail-menu`, sharing the `.opts` row with Discount.)
- **Consistent gutters build the rhythm.** Spacing comes from a small set of steps — 4 / 6 / 7 / 8 / 12 / 14 / 16 / 18 / 24 / 28px. Reach for an existing step; don't introduce a 13px or 21px one-off. Edge padding for page content is 28px; the hamburger row gap is 7px.
- **Things that belong together touch; things that don't get a gutter or a hairline.** Separators (`--line`) appear only to divide genuinely distinct groups — and prefer *space* over a line. (E.g. no divider above collapsed totals; the line only animates in when the section expands.)
- **Symmetry by default.** Equal left/right padding, centered receipts (`max-width` + auto-center), mirrored button pairs. Asymmetry should be intentional (label/value rows), never accidental drift.

---

## Buttons — the blue one (`.cta`)
- **Disabled is solid, never see-through** (owner 2026-11-15: "faded blue and not transparent"). One rule, `.cta:disabled` in styles.css: the blue mixed 30% into the page (`color-mix(in srgb, var(--cta-solid) 30%, var(--bg))`), the words the same way, no shadow, opacity 1. It covers every blue button: Check out, the phone's bar ("No items"), Complete sale, Add, ✓, Save, Next. **Never fade a `.cta` with `opacity`**; a new blue button gets this for free. The exchange's colour fades the same way (`--cta-solid: var(--xchg)`).
- Check: scratch `cta-scan.mjs` style: every `.cta`, every page, phone + iPad, dark + light, disabled → opacity 1, opaque colour, no gradient.
- **No control is ever see-through when off** (owner 2026-11-15), blue or not: never `opacity` on a button, switch, key or card. Off = its words or icon go to `--ink-quaternary` (steppers, PIN keys, the scan card's −, a card that can't be picked yet), a colour is toned down with `filter` (tile swatches, an always-on switch), a track is a solid mix (dark's off switch: `color-mix(in srgb, #fff 14%, var(--bg))`). The glass material (`.cta-2`, the glass rows, the search bar) is the one see-through look, on purpose (owner 2026-11-11; confirmed 2026-11-15: "only the checkout / done / select type buttons" must be solid, the rest may be see-through).

## Rows — two kinds for every table and form (owner 2026-10-17)

Every list or form on a POS page uses **one of these two rows**, phone and tablet, dark and light. A new page
or table picks one and reuses its class; it never gets its own heights, sizes or inks. Measurements and the
build plan: `pos-vault/plans/uniform-lists.md`.

**List row = Orders' `.lv .row`.** A record you tap to open: an order, customer, cash move or shift.
- 58px tall; padding 9px 12px on phone, 9px 16px on tablet.
- Left: title 14/500 `--ink` (receipt no., name, note), and under it a sub line 12/400 `--ink-tertiary` ("Walk-in · 2:15 PM · Ana").
- Right: money **on the title's line** (never centred alone), 14px tabular via `peso()`, in Items' price weight (510); its meta (method) is under it at 12 tertiary.
- Grouped under Orders' grey band: the plain date or group name + count on the left, the total on the right.
- On: Orders, Customers, Customer › Recent orders, Cash in & out, Past shifts. Reports' Top items + Top categories are Items' tablet row (48, 32px picture) with this row's text and money (`.rp-li`).

**Setting row = `.fr`.** A word and its value, or one thing with a switch or ›.
- 48px tall, padding 6px 16px, 16/400, letter-spacing −0.15px; word and value centred top to bottom.
- The word starts 16px from the left. The value ends 16px from the right (40px when a › follows: 6px gap + the 18px ›, ~13px of air to its ink, as rednote's; the same on item edit's › rows and after a switch, as QR and Payment types). Typed values (inputs) are right-aligned too.
- Lives in a `.card.fc` (`--rl-r`). The block title sits outside, above it (`h3.fc-t`, 14/400 `--ink-tertiary`), with any footnote at 12 tertiary and a link (Print report, See all) at the title's right.
- A two-line row (name + grey sub + stepper, Quick stock) is 56px; a growing text box (Description) may grow.
- Money as a value is `.v.num.amt`: 15/400, a step under its 16px word so the word leads (owner 2026-10-17; 16/510 read too big). Text values (a name, a phone) stay 16. 510 is the 14px list row's. A total line (Expected cash, Net sales) is `<b>` on both sides; a count goes on the word as `<small>· n</small>`, and only when it is over 0.
- A money ladder (Shift's drawer and By method, Reports' By method and Breakdown) lists every line, ₱0.00 too: a quiet day says so (owner 2026-10-17). Only a line a store may never use ("Paid on account") hides at 0.

**Dark ink = what the page is about.** One side is `--ink`, the other `--ink-secondary`:
- Facts and forms (Item edit, Customer info, Shift): what was typed or counted is the point, so the word is grey and the value dark. This is the default (`.lv .fr > .lb`).
- Settings and choices (Settings + its sub pages, QR, QR table's switch rows): the setting is the point, so the word is dark and the value grey with ›. Use `.st-page .fr .lb`. A Settings value before its › is `--ink-tertiary`, one step darker than the › (`--ink-quaternary`), so the two read as one pair (rednote's #999 + #CCC, owner 2026-10-17).
- A row that is just a name (a table, an item, "Payment types ›") shows the name dark.

**Kept different on purpose:** the Items list (phone: name + stock line; tablet: a column table), which the owner likes as it is, and Quick stock's 56px stepper rows. In light theme, list pages sit on a white canvas and setting pages on a grey canvas with white cards (2026-10-09).

**Building one:** a list inside a card is `icard(title, rows, '', ' fc-rows')` with `.row` > `.nm` (span + small) and `.rt` (`.amt`); a group's count goes on the title as `<span class="num">· n</span>`, its total as `<span class="tot num">` (or a `.link` when it opens something). Items' own rows are `.lv .page .row:where(:not(.fc-rows > *))` so they never reach a card list on a `.page`. (`.sh-move` was the third recipe; deleted 2026-10-17.)

**First card under the pill** (Reports): no title over it, 32px under the pill: the room the title took (`.rp-body > :first-child`). Shift has no pill since Cash in & out became its own page (2026-11-09), so its first card sits on the start line. The page's one action is a word top right (Shift: Print), going somewhere is a › row (`.fr.nav`, Shift: Past shifts). A title inside the card was tried and turned down ("ugly", 2026-10-17); Reports' Sales line is the one exception.

## The hero line — one spot for every big amount (owner 2026-10-16)

Every page whose subject is **one big amount** — checkout pay and cash, Walk-in, Discount, a cart line, the price
ask, Start shift, Close shift (count), Cash in / out, and any new one — puts that amount in **the same place**:

- **Top of the amount = `--hero-y`** from the top of the screen. **Its list or keys start `--hero-gap` under it.** Size = `--hero-fs`. All three live on `:root` in `styles.css`. Checkout pay is the reference.
- A small grey line above the amount (the item name, "Starting cash?") sits *above* the line, it never pushes the amount down. Discount's "₱13.00 off ₱65.00" sits in the gap, absolute: the rows never move.
- **Lists:** one column of 56px rows, max 420 wide (checkout's methods and cash amounts too, tablet included). **Keypads:** the amount over the keys (`.es-body.ask`), never beside them.
- Back is `‹ Back` (checkout: `‹ Cancel`) top-left on phone *and* tablet; no ✕ on these pages.
- Sheets get there by CSS: `.es-body` padding = `--hero-y` − `--es-y` (where the card's inside starts, set by `esLine()` in pos-sell.js on open/resize) − 24 (the name line slot). Checkout subtracts its Cancel bar (`--co-top-h`). **A new hero page uses `esFrame` + these tokens; never its own padding, cqh offset or JS centring.**
- **Panels never move the amount** (phone, owner 2026-10-16): Pickup / Delivery / Senior / Custom open *under* the rows with checkout Cash's fade + rise (`co-in`). Walk-in keeps all its rows; Discount keeps only the tapped row, which glides into the first row's slot (view transition) while the others fade.
- **Phone checkout: Complete sale / Done sit on Check out's spot** (owner 2026-10-17): same pill, same place on every checkout page (`.co-step > .co-btn`, `.co-keyin > .co-btn` in the phone block). The tablet and the sheets' white button stay where they are.
- Check: scout every hero page on phone 393×852 and tablet 1180×820 — the amount's box top must be equal on all of them.

## Layout grammar (applies to every view)

- **The menu header and every page's ☰ sit on one line: `--head-y`** (`:root`, 8px phone / 16px at ≥721px; pos-lab, owner 2026-10-29). The menu's title + switch (`.side-top`), every page's ☰ (Sell, Orders, QR, Items, Customers, Shift, Reports, Settings) and every inner page's ‹ Back (order, item, category, customer, Past shifts) all hang from it. When switching views nothing moves, and with the menu open the "EJ Hardware" row lines up with the ☰ beside it.
  - **Moving one means moving both.** To raise or lower the header, change `--head-y` only — the menu and all pages follow together. Never give one page or the menu its own padding, `top:` or offset to "fix" a line; that is how they drifted apart before.
  - Check: `hdr.cjs`-style measure, menu open, menu button centre = page ☰ centre on all 8 pages, phone 393×852 (30) and iPad 1180×820 (38).
  - Checkout's ‹ Cancel is on this line too (owner 2026-10-29: it sat under the iPad clock): `.co-top` hangs from `--co-y` = `--head-y`; the iPad pane (`#app.co-side`, `top: 0`, so it skips `.main`'s clock padding) adds `--ph-top` itself. Its amount stays on the hero line (`--co-top-h` follows `--co-y`).
  - **Every page starts on one line under it: 126 on phone, 76 on iPad** (owner 2026-10-31), where Orders' first date band sits. The page's first card, picker, band, receipt or section title lands there.
    - Exceptions: Items, Refund, A customer, and the main page of the item / category / modifier / discount editors. Their inner pages follow it: first card 16 under Back (owner 2026-11-10), `.lv .editor.sub > .form-scroll > .form`.
    - Fix it in the shared rule: `.lv .st-page .c-body`, `.rp-units`, the frost `c-scroll` / `paper-scroll` padding. Never one page's own offset.
    - Check with the `start-lines` skill (`.claude/skills/start-lines/`) after adding or changing any page.
  - **Checkout: the amount holds still, only the step under it scrolls** (owner 2026-10-29), like the cart's rows under its Total: `.co-col` fills the stage, `.co-col > .co-step` is the scroller. Never make `.co-stage` scroll again.
- **Frost top — the tag is class `frost` on the view** (pos-lab, owner 2026-10-30). Every page whose rows scroll: the head (☰ + search / ‹ Back, title, Save) stays put and the rows slide up behind a soft frost under it and the clock, no hard edge. When the owner says "frost top" (or "frost it", "like Reports' top"), it means this.
  - **To add a page:** put `frost` on its `<section class="view …">`. A `.page > .head` + `.c-scroll` / `.list` joins on its own; another head shape gets its selector in `FROST_HEADS` (app.js, sets `--head-h`) and its pane in the `SHARED FROST` block (styles.css).
  - **One look:** canvas 50%, blur 8, solid to 12px above the head's foot, clear 16px below it. Change it only in the `SHARED FROST` block. Items keeps 80% + blur 12 (owner 2026-10-18).
  - **At rest the frost is off** (owner 2026-11-06): app.js toggles `.scrolled` on the frost box once its rows scroll; the frost fades in then. At rest it hazed the first row's top.
  - **A bar that sticks under the head** (Orders' date band, the Refund bar, Reports' date bar): the frost goes solid down to that bar's top, or rows read sharp in the gap above it.
  - **Not on Sell / the cart / checkout** unless the owner names them (they asked for Sell to stay as is, 2026-10-30).
  - Check: every frost view, phone 393×852 + iPad 1180×820, light + dark: no page errors, a tap on the head after scrolling lands on the head, first row at rest where it was.
- **Every slide-up sheet's cards sit 16 from the screen edge: `--sheet-x`** (`:root`, owner 2026-11-01, matching Claude's Select model sheet). The short sheets (Sale, Order ⋯, Add tile, Adjust stock, Markup) and the tall ones (Filters, Sold per) both pad `.fs-body` with it. **A new sheet uses `var(--sheet-x)`; never its own 24 or 20.** On the iPad every sheet, short or tall, is the same 640-wide panel in the middle (`.fsheet`'s `min(100%, 640px)`; owner 2026-11-01), so a new sheet sets no width of its own. The words inside a row card stay 16 in (`.fs-rows button`).
  - Check: open each sheet in the app at 393×852 and read the first card's `getBoundingClientRect().left` = 16. Measure in the app, never from a screenshot.
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

## Motion — three kinds only (owner 2026-11-16, picked in `pos-lab-motion/`)

Apple's rule: a page **slides**, a sheet **pops up**, a pop-up **grows in**. Nothing else moves a whole screen.

- **A page with ‹ slides** in from the right and back out to the right, **measured off iOS Settings and Claude's app** (owner
  2026-11-16, screen recordings split into frames: the two move the same). `--push-dur` .4s, `--push-ease`
  `cubic-bezier(.25, 1, .325, 1)`: 46% at 50ms, 76% at 100ms, 91% at 150ms, within 2% of theirs. **Always a cubic-bezier,
  never `linear()`**: a fitted `linear()` spring matched as well on paper but stuttered on the iPhone (Safari runs a bezier
  on the GPU, not a point list). The earlier `cubic-bezier(.32,.72,0,1)` was smooth but rushed mid-way. The page under moves a third left (`-30%`,
  as theirs). **Transform only.** iOS also greys the page under (~10%) and Claude rounds the moving page's leading corners, but
  both (a filter, a rounded clip on a full-screen picture) made it stutter on the iPhone, worst going back (owner 2026-11-16).
  Keep them out; no shadow either (it read "floaty").
  - **One mechanism for every ‹ page**: Settings, QR codes, Shift, the item editor and (phone) an order's / customer's page go
    through `bindPageSlide()` in app.js. A tap that can open or leave a page (per page: any button in Settings / QR / Shift; a
    row or ‹ elsewhere) is held one frame, the page is snapshotted, the tap is replayed inside `document.startViewTransition`,
    and styles.css "Motion" slides the two pictures, clipped to `.main` (the iPad's menu never moves). Other taps are never
    held. Direction: back to a page seen since the menu opened this one, or any `.back`, slides back. While it runs, the
    CSS slides of `.o-main` / `.editor` land at once under the pictures; opened from elsewhere (Reports → an order) they
    still slide by CSS on the same tokens. Safari < 18 has no view transitions: instant.
  - **☰ / ‹ ride with their pages**, no in-place crossfade (tried 2026-11-16): lifted out of the page picture it left a square
    gap where it sat, and ours shares its row with the search bar, which slid under it mid-swipe. iOS's back button gets away
    with it because it sits alone on its bar.
  - **The edge swipe back follows the finger** (owner 2026-11-16): `pageSwipeBack` starts the real back as the finger
    moves and scrubs both pictures (the page under comes out from its third-left spot, no gap). The pictures take a few
    frames to come, by when the finger is ahead: they glide to it (.45 of the gap a frame), then ride it exactly; a jump read jerky. Let go past a quarter or
    flicked: it carries on; else it slides home and the page that was showing is opened again (by what opened it). An item
    editor with unsaved changes keeps the old drag (it asks on let-go), whose list under it now moves with the finger too.
  - **A modifier question, Pickup's / Delivery's page: the sheet stays, only its content changes** (owner 2026-11-16, as
    checkout's steps fade). A pick moves on at once; the new content fades in over the old in one go (.2s), the old
    held still under it. Out-then-in dipped through blank and read as a flash. pos-sell.js drawEditSheet, `q-body`; ‹, the name, the progress bar and the
    foot are pictured on their own above it and stay still. Under the fade the old 24px nudge class is not set: it replayed
    after the fade (the wiggle). Tried a page slide first: it read as a page swipe. The edge swipe on a later question fades
    the one before in as the finger goes; on the first it moves the whole sheet off to Sell.
  - **Discount's Senior / PWD, Delivery, a line's Note** go through the same fade (they open a page in the sheet). A page that
    wants the keyboard waits for the fade's drawing: `esFocusSoon` focuses a stand-in field inside the tap (the iPhone shows
    its keyboard only then) and hands the focus over once the page is drawn. Focusing right after the redraw call threw (the
    page wasn't there yet) and cut the rest of the tap short.
  - **Checkout's steps fade the same way** (owner 2026-11-16): methods → Cash's amounts / a confirm, and Back. The step showing
    is `co-body`; the new one fades in over the last, which goes a touch behind (a taller one must not linger). The amount
    stays and glides (its own padding transition) to where Cash puts it. Opening the checkout just shows its first step.
  - **Let go and it carries on at the finger's speed**: the finish curve's first slope is set from the finger
    (`cubic-bezier(.3, y1, .325, 1)`, .24–.42s by the distance left); a fixed .14s after a slow hold read as a snap. A finger
    still for 80ms before it lifts is no flick (it went back on a held short swipe).
  - **A swipe holds the finger on the page** (`setPointerCapture` on `<html>`) and the edit sheet is `touch-action: pan-y`:
    a back that redraws what the finger touched otherwise lost it (the browser took the drag as its own pan and cancelled it).
  - **Leaving the app mid-swipe settles it** (visibilitychange / pagehide / blur cancel the swipe): it came back stuck half-way.
  - **A new ‹ page uses one of these two ways**, never its own timing.
- **A full-screen page that is an overlay slides over**: the phone's edit sheet (a modifier's choices, a cart line, Adjust stock,
  a customer) comes in from the right over Sell and **Sell stays still**; ‹ slides it back out. On the iPad it is a sheet beside
  the cart and rises like one.
- **Sheets pop up** with today's timing (.24s in / .16s out, `--rl-ease`): "quicker, more responsive" than iOS's slower sheet.
- **Pop-ups grow in** with today's `centreSheet` (scale .94 → 1, .22s; out .09s).
- **Menu pages just switch**, as Apple's iPad sidebar apps do; on the phone the menu sliding shut is the motion.
- **Checkout's parts fade**, nothing rises into place (`co-in` / `co-rise` are opacity only; the phone's keypad and OK fade in).

## Cross-device / touch

- **The till's sidebar rules are the till's alone**: the base `.sidebar` / `.side-*` / `.brand-*` / `.user-row` rules, the `#app::before` backdrop and the ≤920px icons-only `@media` block in `styles.css` are all scoped to `:where(#app:not(.bo-app))`, because the back office is `#app` with `.sidebar` / `.side-link` too. A new sidebar rule gets the same scope (`:where()` keeps specificity unchanged).
- **The menu (pos-lab, owner 2026-11-09)**: the side menu with the page peeking 76 at the right on the phone (`--half-w: calc(100vw - 76px)`), 320 wide on the iPad. Top row: store name, switch; a tap on the peeking page or a swipe closes it. Rows, all in one list: Sell, Orders, Open tickets (food stores only, gated in `canAccess`; view key stays `tables`; the tables themselves are Settings › Store › Tables, `state.settings.tables`), Items, Customers, Shift, Reports, Chat, QR codes, Cash in & out, Back office. Foot: one name row, name · POS on one line, with the gear on the right (Settings keeps its `.side-link`, placed with CSS, so role gating and `switchView` stay as they are). `.side-nav` is the scroller, for the list on a small phone. Dark: the menu's white is **#F8F8F8**, a step under the app's #FFF so it doesn't shine (owner 2026-11-15, measured off DeepSeek's sidebar; `body:not(.light-theme) .sidebar { --ink }`), the menu only.
- **The phone's slide-over card (owner 2026-11-15)**: with the menu open, the page card keeps its hairline edge and, in dark too, a light shadow to its left (`-1px 0 5px rgb(0 0 0 / .08)`, tight to the edge: wider or darker read too much and "floaty"): the menu under it is #161616, not black, so it shows. Light keeps its own softer one.
- **The menu's icons (owner 2026-11-15, tried in pos-lab-icons)**: flat glyphs in the style of Settings › Payment types › Icon, one solid shape on nothing (no line, no tile, no blue, no duotone); Customers and Cash are that set's own; QR codes is four equal solid squares (the set's own QR was too busy; the owner: "just four blobs"), and Back office is a laptop (four squares read as QR codes). Grey, the open page's brighter: dark `--ink-secondary` / `--ink` (#F8F8F8); light `--side-ic` #525252 / `--side-ic-on` #222222; the open page's icon a touch past the text (dark #FFFFFF, `--side-ic-on`). Light's menu text is #1A1A1A (not #000) and its open-page pill `--side-pill` #E8E6E7, so the open page shows as clearly as in dark. The gear keeps its line.
- **Safe-area inset (`env(safe-area-inset-bottom)`) is applied exactly once** — on the sale sidebar `.rail-h` only (its rules are scoped `.rail-h`, never bare `.rail`: the back office loads styles.css and has its own `.rail`) (its bottom margin; its bottom padding at ≤720px). Never double up (a child like `.pay` or `.go` must not also add it). Keep a constant base gap + single inset so the gap is tight on desktop and clears the home indicator on iPad/iPhone.
- **pos-lab phone (≤720px): insets come from `var(--ph-safe)`, never raw `env()`.** The phone block sets `--ph-safe: env(safe-area-inset-bottom, 0px)`; devices.html overrides the variable to fake an iPhone (an iframe's `env()` is always 0). A rule on raw `env()` looks right in the preview and wrong on the phone — the variant sheet stopped 34px short of the bar on a real iPhone (2026-10-08). A layer that sits *above* the bottom bar adds nothing: the bar already clears the home bar.
- **The top is the same rule: `var(--ph-top)`, never raw `env(safe-area-inset-top)`.** The app runs under the clock (home-screen app, black-translucent). Pages inside `.main` clear it through `.main`'s padding. A full-screen layer outside it (fixed, on #app) joins the one list `html.side-half :is(.qs-pg)` in styles.css, or, when its top row is absolute (a ✕ over a camera or paper), adds `var(--ph-top)` to that `top`. phone.html and devices-all.html now always set `--ph-top` the way the phone does, so a page that forgets it shows under the clock in the preview too (2026-10-27).
- Product-grid swipe is tuned for **low resistance**: drag engages after 4px, page flips at 12% of width, plus flick detection (`elapsed < 300ms && |dx| > 30 && velocity > 0.25`). Don't raise these without reason.

## Settings-driven display

Sell tiles are kept **flat** (`var(--rl-soft)` + the inset `--rl-hair` ring, no gradient/shadow/lift) — the user rejected the 3D look. Both themes share one tile shape and type: `var(--r-input)` corners, names as typed in 500 weight (no capitals). Themes differ in **colour only** — a light-theme rule never changes radius, case, weight or size. Two independent Settings → Appearance controls:
- **Tile size** (`hwpos.tileSize`, S/M/L, plus Wide on the phone only) → items-per-page + grid density (`grid.dataset.size`). Until a POS picks one: **Wide on a phone, Medium wider** (`defaultTileSize()` in pos-lab/pos-core.js, owner 2026-11-15).
- **View** (Settings › Appearance, `ui.sellLayout`): **Grid** = tiles in pages you swipe left/right; **Grid list** (`gridlist`, owner 2026-11-15) = the same tiles at the same size and order on one page that scrolls up and down, in the List's scroller (`.product-grid.sl` → `.sl-tiles`), so on the phone it runs under the search bar and the cart pill with the frost at each end; **List** = A–Z rows (Separate rows = `rows`). A search is always rows; My page is always swipe pages.
- **Tile text size** (`hwpos.tileText`, S/M/L/XL) → `.pc-name` font only, via `grid.dataset.text` → `--pc-name-size` (11/13/15/18px). Independent of tile size.

Pattern for a new display pref: add `STORAGE_*` const + `TILE_*` list, init in `state`, a setter that persists + `renderProducts()`, a toggle in the Appearance panel, sync in `renderPosSettings()`, and a click listener.

## Reports page & payment-method infrastructure

**Hidden**: no role in `ROLE_ALLOWED` (pos-core.js) includes `reports`, so the side link never shows; add it back to the manager set to bring it back. The page (`renderReports()` in `pos-customers.js`) still works and stays deliberately minimal: **Today's net sales + order count** (`SalesMath.summarize`), a **last-7-days bar chart stacked by payment method** (segments `flex-grow` by amount, order count under each bar, legend with per-method money + orders), and a **live list of today's sales still standing** (newest first; #, customer, time, cashier, method dot + `SalesMath.payWord`, amount; tap to open the order). No avg-basket, low-stock, or cash-drawer sections — they were removed. Styled like Customers: `bg-soft` rounded-16 boxes with the hairline, list scrolls inside its box.

Payment methods are SalesMath's, the back office's too:
- Money per method is `SalesMath.tenders` (a split sale is its legs; what went back is taken off); words from `SalesMath.tenderLabel`. GCash, QR and a store's own method ("Maya") keep their names from the order.
- Colours: `PAY_KEYS` (`cash, gcash, qr, credit, other`) → `payColor(k)` = `var(--pm-*)` tokens, set for both themes (a deliberate data-viz exception to the monochrome theme); a store's own method wears Other's. The Orders Payment filter uses the same keys and colours.
- Real-time: re-renders on the `storage` event and `visibilitychange` (cross-tab on one device), plus a 4s `reportsLive()` poll guarded by `reportsSignature()` (the stored orders string itself; the seam a future backend push/sync replaces). **True multi-device real-time needs the backend sync layer** — local storage is per-device.

## Empty states (pos-lab)

The words are the owner's pick **C1** (2026-11-06): one 17px line under the picture, no title. The picture is **Grain** (2026-11-16): the page's thing as one solid object, in cloudy blue with fine film grain, 140px everywhere. The reference is [a4-grain.html](../empty-lab/a4-grain.html), which was measured from the owner's grainy-ball picture (`refs/ref-11.png`). Before that, the picture was the B3 silhouette in a blue haze.

- **One helper.** `emptyState(pic, line, more)` in `pos-lab/pos-core.js` draws every empty page. `emptyAct(word, target)` puts a blue word inside the line (for example "Start a sale"). `noResults(q)` is the search one. A page never builds its own empty markup.
- **There are 12 pictures:** search, tag, folder, box, receipt, grid, toggle, plus, percent, person, cash and clock.
- **The pictures are baked WebP images, not live SVG.** Each is in `pos-lab/img/empty/` as `<pic>.webp` (light) and `<pic>-dark.webp`, at 3x, about 25 KB each. `.empty .pic` in `styles.css` shows the dark one, and `body.light-theme` swaps in the light one.
- **Why baked.** The lab draws the look with live SVG filters: the colour table, the rim and the grain. iPhone Safari draws those on the CPU, and draws them again for every swipe peek, which made swipes lag (2026-11-06).
- **Why prefetched.** `EMPTY_PICS` in pos-core.js fetches every picture once at start and keeps it as a `blob:` URL. Without this, the first visit to a page showed it without its picture for a moment, because `scripts/serve.py` sends `no-store`. In the Capacitor build the files ship inside the app.
- **The grain is real film grain:** per-pixel specks that lighten and darken equally. The lab draws it 1 speck = 1 screen pixel at any size, which is why it is baked at 3x. Grain that is part of the drawing grows with the icon and reads as "paper mache" (owner, 2026-11-16).
- **Shapes.** Each picture is one silhouette. Parts are joined by a small rounded corner, never a big flare: the owner called big ones "too welded". Details such as the tag hole are cut through the shape, never a second layer on top.
- **A speed fix never changes the look.** Prove a speed fix with a pixel diff against the old screenshots. A sharpened shape was rejected as "you removed the core design".
- **Adding or changing a picture:**
  - Draw it in [a4-grain.html](../empty-lab/a4-grain.html). Its shapes are shared with a4-orb.html; `a4-mag.py` and `a4-person.py` rebuild the magnifier and person paths.
  - Map the picture to its card in `PICS` in [scripts/bake-empty-pics.mjs](../scripts/bake-empty-pics.mjs).
  - Run `node scripts/bake-empty-pics.mjs`. It needs Edge, playwright-core and python3 with Pillow.
  - Add its name to the prefetch list in pos-core.js.
  - Each picture's pattern is the lab card's, fixed by the map, so it never changes when the POS adds or reorders pages.

**The lab files** are all in [empty-lab/](../empty-lab/):

| Option | Files |
|---|---|
| **Grain (in the app, 2026-11-16)** | [a4-grain](../empty-lab/a4-grain.html), [a3-grain](../empty-lab/a3-grain.html), [a3-grain-copy](../empty-lab/a3-grain-copy.html) |
| Orb (liked, same shapes) | [a4-orb](../empty-lab/a4-orb.html), [a3-orb](../empty-lab/a3-orb.html), [a3-orb-copy](../empty-lab/a3-orb-copy.html) |
| Both, icons only | [a4-icons](../empty-lab/a4-icons.html) |
| **B: silhouette (before)** | [b3-silhouette](../empty-lab/b3-silhouette.html) (C1), [b2-silhouette](../empty-lab/b2-silhouette.html), [b-silhouette](../empty-lab/b-silhouette.html), [b2-copy](../empty-lab/b2-copy.html) |
| All drawings | [silhouettes](../empty-lab/silhouettes.html) |
| A: glass | [a2-glass](../empty-lab/a2-glass.html), [a-glass](../empty-lab/a-glass.html), [a2-copy](../empty-lab/a2-copy.html) |
| C: gradient | [c2-gradient](../empty-lab/c2-gradient.html), [c-gradient](../empty-lab/c-gradient.html), [c2-copy](../empty-lab/c2-copy.html) |
| D: line | [d2-line](../empty-lab/d2-line.html), [d-line](../empty-lab/d-line.html), [d2-copy](../empty-lab/d2-copy.html) |
| E: glow | [e2-glow](../empty-lab/e2-glow.html), [e-glow](../empty-lab/e-glow.html), [e2-copy](../empty-lab/e2-copy.html) |
| Reports | [reports-empty](../empty-lab/reports-empty.html), [reports-empty-2](../empty-lab/reports-empty-2.html) |

The screenshots are in `empty-lab/img/`. `baked-before-after.png` and `baked-light-dark.png` show that the baked pictures match the live ones.
