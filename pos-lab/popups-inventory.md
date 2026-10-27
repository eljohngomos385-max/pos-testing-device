# Pop-ups in pos-lab (inventory, 2026-10-27)

Every centred card over a dimmed page in `pos-lab/`, so they can all move to one new template.
Read-only survey; nothing in the app was changed.

## Summary

- **38 pop-ups**: 27 go through `showConfirm()` (pos-core.js:355), 11 are built by hand (1 of those is dead code).
- **By kind**
  - (a) yes / no confirm: **14**
  - (b) destructive confirm (delete, void, refund, clear): **11**
  - (c) info, one real action: **1** (the past shift / day paper)
  - (d) has a form or input inside: **7** (1 via `showConfirm` html, 6 hand-built)
  - (e) other (choice card, details, picker, peek): **5** (4 live + 1 dead)
- **No native `alert()` / `confirm()` / `prompt()`** anywhere in pos-lab's JS or index.html.
- **Two looks live side by side**
  - New card: `.pay-sheet.cf-sheet` in a `.rail-veil` (14px corners, small 36px buttons on the right). All `showConfirm`, What do you sell?, Record payment, Save cart / Print quote, Add note.
  - Old card: `.modal` in a `.modal-backdrop` (6px corners, a ✕ in the head, big 44px buttons). Lost sale, Order details, Pin delivery location, Select customer, and the Manager PIN card.

### Button pairs in use (Cancel side | OK side)

| Pair | Times |
|---|---|
| Cancel \| Delete (red) | 8 |
| Cancel \| Sell anyway | 3 |
| Keep editing \| Leave | 1 pop-up, about 13 ways in |
| Keep going \| Leave | 1 |
| Keep going \| Cancel exchange | 1 |
| Cancel \| Void sale | 1 |
| Cancel \| Refund | 1 |
| Cancel \| Clear (red) | 1 |
| Cancel \| Replace | 1 |
| Cancel \| Charge anyway | 1 |
| Cancel \| Exchange anyway | 1 |
| Cancel \| Swap | 1 |
| Cancel \| Hand back ₱X | 1 |
| Cancel \| New QR | 1 |
| Cancel \| Log out | 1 |
| Cancel \| Switch | 1 |
| Cancel \| Take off | 1 |
| Close \| Print | 1 |
| Cancel \| Save cart / Print quote / Save / Record payment | 4 (hand-built forms) |
| Retail \| Food (no cancel) | 1 |
| Cancel only (+ keypad) | 1 (Manager PIN) |
| ✕ + Cancel \| Log lost sale | 1 |
| ✕ + Clear pin \| Use pin | 1 |
| ✕ only | 2 (Order details, Select customer) |

### Odd ones out

- **Red is uneven.** Only Delete and Clear sale are red. Void sale, Refund, Replace the cart, Take off and New QR also throw something away but aren't red. The comment at pos-core.js:334 says red is "for a delete only", but Clear sale is red too.
- **Two ways to say "leave".**
  - Everywhere: "Leave without saving? / Your changes aren't saved yet. / Keep editing | Leave".
  - Adjust stock / price: "Leave quick stock? / 3 amounts not saved yet. / Keep going | Leave".
  - That title still uses the old names "quick stock" and "change price", but the app now says Adjust stock / Adjust price (commit 9d9791e).
- **"Sell anyway" is worded three ways.**
  - Out of stock: title "Out of stock", message is just the item name.
  - Hidden item scanned: the title is the item name, message "This item is hidden. Sell anyway?".
  - Saved cart with a hidden item: title "Sell anyway?", message "Bolt M8 is hidden.".
- **Credit limit, two wordings.** Checkout says "Ana **would go** ₱300.00 over their ₱5,000.00 credit limit."; exchange says "Ana **would be** ₱300.00 over …".
- **Name quotes differ.**
  - Curly quotes: `Delete "Name"?` for a category, discount, modifier, customer and saved cart.
  - No quotes: `Delete Table 1?` (QR), `Delete Maya?` (payment type), `Delete Dine in?` (sale type).
- **One delete has no message:** Orders › saved cart › Delete. Every other delete says what happens.
- **Titles without "?":** Out of stock, Over the credit limit, Hand back ₱X, Swap on #N, Shift · time / Day · date.
- **"Cancel exchange" is the OK button,** with "Keep going" as the cancel, so a "Cancel" word sits on the go-ahead side.
- **Apostrophes are mixed.** The refund line uses a straight `'` ("Ana's account", pos-orders.js:921); the swap line uses a curly `'`.
- **Hand-built forms aren't dimmed.** The dim rule is `.rail-veil:has(> .cf-sheet)` (styles.css:8784), so Record payment, Save cart / Print quote and Add note sit over a page that isn't dimmed. The confirms on the same card are dimmed.
- **Dead pop-up:** `#paymentModal` (index.html:808, "Payment / Total due / Complete & print"). It is only ever hidden, never opened; checkout is a page now.
- **Leftover old styles:** `.confirm-modal` (styles.css:1326-1351) now only styles the Lost sale card. The saturated red `.primary-btn.danger` (1352-1357) is overridden to the tinted red inside `.cf-sheet` (8156).

## How the confirm card looks now (`showConfirm`, pos-core.js:355-400)

- **Markup:** `<div class="rail-veil"><form class="pay-sheet cf-sheet" role="alertdialog">` holds:
  - `.ph`: a bold title, then a `.cf-msg` line.
  - `.pb`: `secondary-btn small` (Cancel) and `primary-btn small` (OK), plus `.danger` when `danger` is set.
- **Size and place:**
  - Width `min(340px, screen − 24px)`, set in JS (370).
  - Centred by `centreSheet()` (341-346), which writes left / top in px once. It does not re-centre on rotate or resize.
  - The same on tablet and phone.
- **Card** (styles.css:8126-8128):
  - padding 16px, gap 14px, radius `--rl-r` (14px, 7163), background `--rl-card` (= `--surface-2`, 7154).
  - shadow `--shadow-raised` plus a 1px `--line` ring; text 13px `--ink`.
- **Title:** 15px / 550 (8132).
- **Message:** 13px, line-height 1.45, `--ink-secondary`; it scrolls when long, while title and buttons stay put (8149-8151).
- **Buttons:** right-aligned, gap 8px (8145); 36px tall, 13px / 590, no caps (8155).
  - Danger: `--danger-bg` fill with `--danger` text; on hover a 1px `--danger` ring (8156-8157).
- **Dim:** `rgb(0 0 0 / .42)` dark, `.30` light, fading in over .14s (8784-8785). The z-index is the veil's: 150 (7294).
- **Open:** opacity 0 → 1 and scale .96 → 1 over 140ms ease-out.
- **Close:** fade to 0 and scale .98 over 90ms.
- **Reduced motion:** both are 0ms (`calmMs`).
- **Keys:** Enter = OK; Esc, a tap outside or Cancel = cancel; Tab stays inside.
  - Focus lands on the first input in the message, otherwise on OK.
  - A tap in the first 350ms is ignored (double-tap guard).
  - Only one card at a time: a new ask replaces the open one.
- **Extras:** `html` replaces the message. Used for the Hand back method dropdown and the past shift / day paper (`.sh-slip`, 8297).

### The old card (`.modal-backdrop` + `.modal`)

- **Backdrop** (styles.css:1263-1273): `rgba(0,0,0,.25)`, grid-centred, 20px padding, z-index 100, fades in over .16s.
- **Card** (1280-1291): `--surface`, radius `--r-modal` (6px, line 54), `--shadow-modal`, 1px `--line`, max-height 86vh.
- **Open:** `pop` .18s (rise 6px, scale .99).
- **Close:** instant (`hidden = true`), no closing animation.
- **Widths:** 440 default; 380 small / confirm (1293, 1326); 720 map (1323); 805 order details (2877).
- **Head and body:** 18/20px padding, title 16px / 590 (1359-1371); ✕ 28px (1372-1379); body padding 6px 20px 20px (1380).
- **On the phone** the only difference is that Order details' trip buttons go two across (7426).
- **Manager PIN card** (8306-8342): `.pin-pad`, the same surface, radius, shadow and pop; width min(360px, 100%); a round keypad. On the sign-in lock screen the same pad goes full screen with no card (`.pin-lock`).
- **Peek** (8738-8754): its own fixed card, centred with CSS.
  - Width 340px on a phone, 520px on a tablet (≥ 768px wide).
  - Dim .42 / .30; opacity and scale .96 over .2s, played in reverse when it closes.

## Every pop-up

Kind: a = yes/no, b = destructive, c = info, d = form/input inside, e = other. "Red" = `danger: true`.

| # | Where | Screen / flow | Title | Message | Buttons (cancel \| OK) | Red | Extra content | Kind |
|---|---|---|---|---|---|---|---|---|
| 1 | pos-core.js:350 `askLeave` | Leaving any form with changes. Called from:<br>• Items › item / category / modifier › ‹ back (app.js:599)<br>• Items › item › Adjust stock (app.js:653)<br>• tablet: tapping another item or category while editing (pos-items.js:101, :628)<br>• Sell › add-tile pick while an Items editor has changes (pos-sell.js:495)<br>• Customer edit › ✕ / Esc / "Open Ana" (pos-sell.js:1919)<br>• Lost sale › ✕ / Cancel / tap outside / Esc (app.js:901, 907, 917)<br>• Settings › Payment types › Add › ‹ (pos-settings.js:307)<br>• Settings › Sale types › Add › ‹ (pos-settings.js:379)<br>• Save cart / Print quote / Add note › Cancel (pos-checkout.js:824)<br>• Record payment › Cancel (pos-customers.js:134) | Leave without saving? | Your changes aren't saved yet. | Keep editing \| Leave | no | — | a |
| 2 | app.js:425 | Orders › sale › Refund › tick lines › Refund | Refund 2 items on #1-044? | ₱570.00 back to the customer. (or "₱300.00 comes off Ana's account · ₱270.00 back to the customer.") | Cancel \| Refund | no | — | b |
| 3 | app.js:428 | Orders › sale › ⋯ › Void sale (menu on tablet, half sheet on phone) | Void #1-044? | The sale stays on record, marked voided. | Cancel \| Void sale | no | — | b |
| 4 | app.js:440 | Orders › saved cart / quote › ⋯ › Delete | Delete "Ana"? (or the cart's status label) | *(none)* | Cancel \| Delete | yes | — | b |
| 5 | app.js:840 | Sell › cart ⋯ › Clear sale | Clear the sale? | Every item comes off the cart. | Cancel \| Clear | yes | — | b |
| 6 | pos-checkout.js:893 | Orders › saved cart › Continue, with items already in the cart | Replace the cart? | The items in the cart now are removed. | Cancel \| Replace | no | — | a |
| 7 | pos-checkout.js:896 | Orders › saved cart › Continue, when an item is now hidden / archived | Sell anyway? | Bolt M8 is hidden. (one sentence per item) | Cancel \| Sell anyway | no | — | a |
| 8 | pos-checkout.js:1003 | Checkout › Account, over the credit limit (the role may go past it) | Over the credit limit | Ana would go ₱300.00 over their ₱5,000.00 credit limit. | Cancel \| Charge anyway | no | — | a |
| 9 | pos-orders.js:971 | Exchange › ✕ (top left) with new items in the cart | Cancel exchange? | The new items come off the cart. Nothing is saved. | Keep going \| Cancel exchange | no | — | a |
| 10 | pos-orders.js:995 | Exchange › pay button, nothing to collect | Even swap on #1-044 / Swap on #1-044 | No money changes hands. (or "₱120.00 comes off Ana's account. No cash changes hands.") | Cancel \| Swap | no | — | a |
| 11 | pos-orders.js:1001 | Exchange › pay button, money goes back | Hand back ₱120.00 | *(html)* | Cancel \| Hand back ₱120.00 | no | "Hand back with" dropdown (Cash, GCash, …) | d |
| 12 | pos-orders.js:1057 | Exchange on an account sale, over the credit limit | Over the credit limit | Ana would be ₱300.00 over their ₱5,000.00 credit limit. | Cancel \| Exchange anyway | no | — | a |
| 13 | pos-items.js:890 | Items › Categories › category › Delete | Delete "Paint"? | Its items stay; they only leave this category. | Cancel \| Delete | yes | — | b |
| 14 | pos-items.js:899 | Items › Discounts › discount › Delete | Delete "Senior"? | Sales that used it keep it on their receipt. | Cancel \| Delete | yes | — | b |
| 15 | pos-items.js:903 | Items › Modifiers › modifier › Delete | Delete "Sweetness"? | It comes off every item. Sales that used it keep it on their receipt. | Cancel \| Delete | yes | — | b |
| 16 | pos-qr.js:81 | Settings › QR codes › table › New QR | New QR for Table 1? | Old photos and the sticker on the table stop working. Print the new one. | Cancel \| New QR | no | — | a |
| 17 | pos-qr.js:91 | Settings › QR codes › table › Delete | Delete Table 1? | Its QR stops working. | Cancel \| Delete | yes | — | b |
| 18 | pos-sell.js:644 | Sell › adding an item past its stock (tile, scan, search, variant, qty) | Out of stock | Bolt M8 *(just the name)* | Cancel \| Sell anyway | no | — | a |
| 19 | pos-sell.js:731 | Sell › scanning / typing the code of a hidden, archived or component item | Bolt M8 | This item is hidden. Sell anyway? | Cancel \| Sell anyway | no | — | a |
| 20 | pos-sell.js:1925 | Customers › customer › Edit › Delete | Delete "Ana Cruz"? | Their past sales keep the name. | Cancel \| Delete | yes | — | b |
| 21 | pos-settings.js:272 | Settings › Payment types › own type › Delete | Delete Maya? | Past sales keep the name. | Cancel \| Delete | yes | — | b |
| 22 | pos-settings.js:402 | Settings › Sale types › own type › Delete | Delete Dine in? | Past sales keep the name. | Cancel \| Delete | yes | — | b |
| 23 | pos-settings.js:420 | Settings › Log out | Log out of this POS? | Signing back in needs the account's email and password. | Cancel \| Log out | no | — | a |
| 24 | pos-stock.js:197 | Items › Adjust stock › mode picker, switching to / from Count with amounts typed | Switch to Count? | The amounts you typed are cleared. | Cancel \| Switch | no | — | a |
| 25 | pos-stock.js:301 | Items › Adjust stock / Adjust price › leave with unsaved amounts | Leave quick stock? / Leave change price? | 3 amounts not saved yet. / 3 prices not saved yet. | Keep going \| Leave | no | — | a |
| 26 | pos-stock.js:335 | Items › Adjust stock › tap a ticked row that has an amount | Take it off the list? | The amount you typed is cleared. | Cancel \| Take off | no | — | a |
| 27 | pos-shift.js:346 | Shift › Past shifts › a shift or day | Shift · 3:45 PM / Day · Oct 27, 2026 | *(html)* | Close \| Print | no | The printed X / Z paper (monospace slip) | c |
| 28 | app.js:1365 `askBizType` (hand-built, cf-sheet) | First open on a new device | What do you sell? | You can change this later in Settings. | Retail \| Food (equal, no cancel, can't close) | no | — | e |
| 29 | pos-checkout.js:804 `openCartForm` (hand-built, pay-sheet) | Sell › cart ⋯ › Save cart / Print quote | Save cart / Print quote | — | Cancel \| Save cart / Print quote | no | "Customer name" input | d |
| 30 | pos-checkout.js:799 → 804 (same) | Sell › cart ⋯ › Add note / Edit note | Add note / Edit note | — | Cancel \| Save | no | "Note" input | d |
| 31 | pos-customers.js:82 `openPaySheet` (hand-built, pay-sheet) | Customers › customer › Record payment | Record payment | Ana Cruz owes ₱1,200.00 (small line) | Cancel \| Record payment → "Record ₱500.00" | no | Amount (+ Full balance), Method dropdown, receipts to tick, Note | d |
| 32 | pos-pin.js:158 `gate` (index.html:951, old modal style) | Manager approval: void, refund, over limit, discount over limit, credit on/off, changing a discount, Settings refund / discount / shift rules | Manager PIN | "50% off is over the 20% limit. To give big discounts, a manager enters their PIN." (the note, then "To …, a manager enters their PIN.") | Cancel | no | Lock line, PIN dots, 3×4 keypad; wrong PIN shakes | d |
| 33 | index.html:896 `#lostSaleModal` (old modal) | Sell › cart ⋯ › Lost sale; search with no result › log it | Lost sale | — | ✕, Cancel \| Log lost sale | no | Asked for (search), Qty, Why (4 segments), Bought instead (dropdown) | d |
| 34 | index.html:856 `#deliveryMapModal` (old modal) | Sell › sale type Delivery › map | Pin delivery location | — | ✕, Clear pin \| Use pin | no | Zoom − / +, Use device location, the map, coordinates | d |
| 35 | index.html:931 `#orderDetailModal` (old modal) | Orders › ⋯ › Order details (tablet; phone only for deliveries) | Order #1-044 · Refunded | — | ✕ | no | Meta rows, items, totals, delivery trip buttons | e |
| 36 | index.html:770 `#customerModal` (old modal) | Customer button while not on Sell (rare; Sell uses the sheet) | Select customer | — | ✕ | no | Walk-in, Add new customer, the list | e |
| 37 | pos-sell.js:370 `openPeek` (own `.pk-card`) | Sell › hold a tile | Item / category name, "4 variants" | Description (2 lines + More) | none: tap a row adds it, tap outside closes | no | Rows with stock and price; Edit page button on My page | e |
| 38 | index.html:808 `#paymentModal` (old modal) | **Dead:** never opened, only hidden (pos-checkout.js:477, 487) | Payment | Total due | Cancel \| Complete & print | no | Cash / Account / Split, tendered, quick cash | e |

## Sheets (not pop-ups)

They slide up or sit in a pane, so they stay out of the pop-up template:

- **Filter sheet** (`openFilterSheet`, pos-orders.js:359). Orders / Items / Customers filters: full height from the top, ✕ and ✓.
- **Half sheets** (`openActionSheet`, pos-orders.js:396).
  - Phone only: the cart ⋯ "Sale", the order ⋯ "#1-044" and the Adjust stock mode picker.
  - On the tablet these are the morph menus (`openMenu`, pos-sell.js:1636), which grow from their button.
- **Edit sheet** (`.esheet` `#editSheet`): line qty / discount, cart discount, the price ask, modifiers, sale type. Its "+N" picks list (`.es-pop`, pos-sell.js:1464) drops under the pills.
- **Customer edit** (`.esheet.cust-sheet` `#customerEditModal`) and the **shift sheet** (`#shiftSheet`).
- **List sheet** (`.vsheet` `#variantSheet`): variants, and the customer picker on Sell.
- **Scan sheet** (`#scanSheet`), **Make another** (`openAgain`, the shaded cart), and the **Items + menu** (`.fab-veil`).
- **Full-screen covers, not cards:** the PIN lock screen (`#pinModal.pin-lock`) and the sign-in page (`#signInScreen`, after Log out).
