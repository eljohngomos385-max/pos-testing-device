/* CART LAB CHECKOUT (2026-09-29): the real POS checkout, dropped into the cart labs so Check out runs the
   actual flow: method tiles -> that method's one detail -> Sale complete, with the items column turning into
   the printed receipt. CSS is copied verbatim from styles.css (.view-checkout / .co-* / .rp-*, light theme);
   the markup is index.html's checkout view; the logic mirrors app.js (renderCheckout, applyPayMethods,
   showPayStep, updateChange, quickTenders, completeSale, showCheckoutSuccess, buildReceiptPreview).
   Labs call labCheckout.open({ lines, totals, customer, fulfil, onCustomer, onSold }). Money in centavos.
   Opening and closing MORPH the lab sidebar into the checkout (?co=flush | simple2, see LAB_CSS).
   VERSION 2 (2026-09-29): a copy of cart-lab-checkout.js (kept as Simplified 1). Simplified no longer flies anything:
   the sidebar tucks away what checkout doesn't need in place, the Total stays at the bottom, the pane fades in.
   ?head=0 drops the Item / Amount band (sidebar and checkout) and puts the item count beside Total.
   ponytail: a lab copy, not a shared module with the app; re-copy the CSS block if the real checkout changes. */
(() => {
'use strict';
const CSS = `.lab-co {
  --bg: #FFFFFF;             /* --po-bg */
  --bg-soft: #EDEDED;        /* --btn-soft */
  --bg-softer: #E4E4E4;      /* --btn-soft-hover */
  --surface: #F9F9F9;        /* --blk-bg */
  --surface-hover: #F6F6F6;  /* --tbl-hover */
  --surface-2: #FFFFFF;      /* --po-sidebar */
  --line: #E1E1E1;           /* --blk-outline */
  --line-strong: #D4D4D4;    /* --btn-line */
  --tile: #F3F3F3;           /* soft grey tile, same as the checkout lab's payment tiles */
  --ink: #303030;
  --ink-secondary: #616161;
  --ink-tertiary: #8C8C8C;
  --ink-quaternary: #B5B5B5;
  --accent: #303030;
  --accent-hover: #1A1A1A;
  --accent-pressed: #000000;
  --accent-tint: rgba(0, 0, 0, 0.06);
  --accent-ink: #FFFFFF;
  --warn: #7A5B00;
  --warn-bg: #FCEFC7;
  --danger: #D72C0D;         /* --trend-down */
  --danger-bg: #F8D8D0;
  --ok: #047B5D;             /* --trend-up */
  --ok-bg: #D3ECDD;
  --shadow-card: 0 1px 2px -1px rgb(26 26 26 / .07);   /* --card-shadow */
  --shadow-raised: 0 4px 16px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
  --shadow-modal: 0 20px 50px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08);
  --lt-ring: 0 0 0 1px var(--line), var(--shadow-card);
  --lt-primary-shadow: inset 0 -1px 0 rgba(0,0,0,0.2), 0 1px 0 rgba(0,0,0,0.1);
  color-scheme: light;
}
/* lab host: the checkout view fills the screen like switchView('checkout'); base resets from styles.css */
.lab-co { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: var(--bg); color: var(--ink);
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
          font-size: 14px; line-height: 1.5; letter-spacing: -0.15px; }
:where(.lab-co) button { font-family: inherit; border: none; background: none; cursor: pointer; color: inherit; padding: 0; }
:where(.lab-co) h2 { margin: 0; }
.lab-co[hidden] { display: none; }
.receipt-preview {
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 2px 0 18px;
}
.rp-label {
  width: min(320px, 100%);
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--ink-tertiary);
}
.rp-paper {
  width: min(460px, 100%);
  flex: 0 0 auto;
  margin: auto auto;
  background: #fff;
  color: #111;
  border-radius: 4px;
  padding: 28px 28px 32px;
  font-family: "SF Mono", "Menlo", "Consolas", "Courier New", monospace;
  font-size: 14px;
  line-height: 1.42;
  box-shadow: 0 8px 32px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18);
  border: none;
}
.rp-center { text-align: center; }
.rp-store { font-size: 18px; font-weight: 800; letter-spacing: 0.4px; }
.rp-small { font-size: 12px; }
.rp-rule { border-top: 1px dashed #111; margin: 11px 0; }
.rp-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}
.rp-item { margin: 9px 0; }
.rp-item-name { font-weight: 800; }
.rp-item-line { font-size: 12px; }
.rp-total {
  border-top: 1px solid #111;
  border-bottom: 1px solid #111;
  margin: 9px 0;
  padding: 6px 0;
  font-size: 17px;
  font-weight: 800;
}
.rp-status {
  margin-top: 8px;
  padding: 6px 8px;
  text-align: center;
  border: 1px solid #111;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.4px;
}
.rp-status.saved {
  background: #111;
  color: #fff;
}
.rp-thanks {
  margin-top: 8px;
  font-weight: 800;
}
/* ----- Checkout: one page that moves forward (checkout-calm-lab.html) -----
   The total has one place at the top of the payment column and never moves; only the step under it
   changes: how they pay -> that method's one detail -> done. Every choice is the same 160x112 tile.
   The items column is the list itself (no box); after the sale it shows the printed receipt. */
.view-checkout {
  --co-m: 20px;                                   /* page margin: Cancel's inset, column gutters */
  --co-items-w: clamp(340px, 32vw, 420px);
  --co-cust-h: 50px;                              /* customer row; its centre lines up with Cancel's */
  --co-tw: 160px;
  --co-gap: 14px;
  --co-ease: cubic-bezier(.2, .8, .2, 1);
}
.co [hidden] { display: none !important; }
.co .num { font-variant-numeric: tabular-nums; }
.co { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--co-items-w); }
.co-ic { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.co-pay { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; }
/* Cancel's box is nudged so the chevron's ink sits exactly --co-m from the top and the left */
.co-top { display: flex; align-items: center; padding: calc(var(--co-m) - 16.75px) var(--co-m) 0 calc(var(--co-m) - 14px); }
.co-cancel { display: inline-flex; align-items: center; gap: 4px; min-width: 92px; height: 44px; padding: 0 12px 0 8px; border-radius: var(--r-input);
             color: var(--ink); font-size: 15px; font-weight: 560; transition: background-color .12s, opacity .25s; }
.co-cancel:hover { background: var(--surface-hover); }
.co-cancel .co-ic { width: 18px; height: 18px; stroke-width: 2; color: var(--ink-secondary); }
.is-done .co-cancel { opacity: 0; pointer-events: none; }
.co-stage { overflow: auto; padding: 0 var(--co-m) 56px; }
/* --lift centres the total + method tiles once per size (centreCheckout), never per step */
.co-col { display: grid; width: 100%; max-width: 820px; margin: 0 auto; padding-top: var(--lift, 0px); }
.co-hero { padding: clamp(16px, 4vh, 40px) 0 clamp(20px, 4vh, 36px); text-align: center; font-size: clamp(54px, 5.4vw, 72px); font-weight: 600;
           letter-spacing: -.04em; line-height: 1; }

.co-step { display: grid; gap: 12px; animation: co-in .3s var(--co-ease) both; }
.co-step > :not(.co-tiles) { width: 100%; max-width: 440px; justify-self: center; }
/* --cols is how many across the count wants; one tile size at any count, a tight column drops to fewer across */
.co-tiles { --cols: 2; display: grid; gap: var(--co-gap); justify-self: center; width: 100%;
            max-width: calc(var(--cols) * var(--co-tw) + (var(--cols) - 1) * var(--co-gap));
            grid-template-columns: repeat(auto-fill, minmax(max(140px, (100% - (var(--cols) - 1) * var(--co-gap)) / var(--cols)), 1fr)); }
.co-tile { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 112px; padding: 0 10px;
           border-radius: 14px; background: var(--tile); color: var(--ink); font-size: 15px; font-weight: 560; text-align: center;
           transition: background-color .12s, transform .1s; }
.co-tile:hover { background: var(--surface-hover); }
.co-tile:active { transform: scale(.98); }
.co-tile .co-ic { width: 26px; height: 26px; stroke-width: 1.5; color: var(--ink-secondary); }
.co-big { font-size: 20px; font-weight: 600; letter-spacing: -.02em; line-height: 1.15; }
.co-tile small { color: var(--ink-tertiary); font-size: 12.5px; font-weight: 400; }
.co-tile small.up { color: var(--ok); font-weight: 500; }

/* cash: the typed amount is one line under the quick amounts, as wide as their row */
.co-step > .co-cash-in { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; margin-top: 2px;
                         max-width: calc(var(--cols, 4) * var(--co-tw) + (var(--cols, 4) - 1) * var(--co-gap)); }
.co-field { display: flex; align-items: center; gap: 6px; height: 56px; padding: 0 18px; border: 1px solid var(--line); border-radius: var(--r-input);
            background: var(--surface-2); font-size: 22px; font-weight: 600; letter-spacing: -.02em; cursor: text; }
.co-field:focus-within, .co-ref:focus { border-color: var(--ink-tertiary); }
.co-cur { color: var(--ink-tertiary); font-weight: 500; }
.co-field input { flex: 1; min-width: 0; padding: 0; border: 0; outline: 0; background: none; font: inherit; letter-spacing: inherit; }
.co-field input::placeholder, .co-ref::placeholder { color: var(--ink-quaternary); }
.co-ref { height: 50px; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--r-input); outline: 0; background: var(--surface-2); font-size: 15px; }
.co-ask { color: var(--ink-secondary); font-size: 14px; font-weight: 500; text-align: center; }
.co-change { min-height: 24px; text-align: center; font-size: 17px; font-weight: 560; color: var(--ink-tertiary); }
.co-change.up { color: var(--ok); }
.co-change.down { color: var(--danger); }
.co-error { width: 100%; max-width: 440px; justify-self: center; margin-top: 12px; padding: 9px 11px; border-radius: var(--r-input);
            background: var(--danger-bg); color: var(--danger); font-size: 13px; font-weight: 600; text-align: center; }

.co-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 56px; padding: 0 22px;
          border: 1px solid var(--line-strong); border-radius: var(--r-input); background: var(--surface-2); color: var(--ink);
          font-size: 15px; font-weight: 600; white-space: nowrap; transition: background-color .12s, opacity .2s; }
.co-btn:hover { background: var(--surface-hover); }
.co-btn.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-ink); box-shadow: var(--lt-primary-shadow, none); }
.co-btn.primary:hover { background: var(--accent-hover); }
.co-btn:disabled { opacity: .35; cursor: default; pointer-events: none; }
.co-step > .co-btn { height: 50px; margin-top: 6px; }

/* items column: the list itself, head and Total pinned, only the rows scroll */
.co-items { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid var(--line); }
.co-cust { display: flex; align-items: center; gap: 10px; height: var(--co-cust-h); padding: 0 var(--co-m); border-bottom: 1px solid var(--line);
           font-size: 14px; font-weight: 560; text-align: left; transition: background-color .12s; }
.co-cust:hover { background: var(--surface-hover); }
.co-cust span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-cust .co-ic { width: 18px; height: 18px; color: var(--ink-secondary); }
.co-cust .co-chev { width: 16px; height: 16px; color: var(--ink-tertiary); }
.is-done .co-cust { pointer-events: none; }
.co-list { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; }
.co-head { display: flex; justify-content: space-between; gap: 12px; padding: 11px var(--co-m); background: var(--surface); border-bottom: 1px solid var(--line);
           color: var(--ink-secondary); font-size: 12px; font-weight: 500; }
.co-rows { overflow-y: auto; overscroll-behavior: contain; }
.co-row { display: flex; align-items: center; gap: 12px; min-height: 45px; padding: 7px var(--co-m); }
.co-row + .co-row { border-top: 1px solid var(--line); }
.co-nm { flex: 1; min-width: 0; font-size: 13px; line-height: 1.3; }
.co-nm small { display: block; color: var(--ink-tertiary); font-size: 12px; }
.co-amt { font-size: 13px; font-weight: 600; white-space: nowrap; }
.co-sum { padding: 14px var(--co-m) 16px; border-top: 1px solid var(--line); }
.co-disc, .co-total { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.co-disc { margin-bottom: 6px; color: var(--ink-secondary); font-size: 13px; }
.co-total > :first-child { font-size: 14px; font-weight: 600; }
.co-total > :last-child { font-size: 22px; font-weight: 600; letter-spacing: -.02em; line-height: 1.1; }
/* after the sale: the printed receipt, under the customer row */
.co-rcpt { position: absolute; inset: var(--co-cust-h) 0 0; overflow-y: auto; overscroll-behavior: contain; padding: var(--co-m); background: var(--surface);
           visibility: hidden; opacity: 0; transition: opacity .25s, visibility 0s .25s; }
.is-done .co-rcpt { visibility: visible; opacity: 1; transition: opacity .25s; }
.co-rcpt .receipt-preview { max-height: none; overflow: visible; padding: 0; }
.co-rcpt .rp-paper { margin: 0 auto; animation: co-print .9s var(--co-ease) both; }

/* sale complete: the moment sits in the middle of the column */
.is-done .co-stage { display: grid; align-content: center; }
.co-done { display: grid; justify-items: center; gap: 4px; padding: 24px 0 4px; text-align: center; }
.co-done > :not(.co-mark) { animation: co-rise .45s var(--co-ease) both; animation-delay: calc(var(--i, 0) * 70ms + 160ms); }
.co-mark { position: relative; width: 72px; height: 72px; margin-bottom: 14px; animation: co-pop .42s var(--co-ease) both; }
.co-mark::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--ok-bg); animation: co-pulse .85s .38s ease-out both; }
.co-mark svg { position: relative; display: block; width: 100%; height: 100%; }
.co-mark .m-c { fill: var(--ok-bg); stroke: var(--ok); stroke-width: 3; stroke-dasharray: 189; stroke-dashoffset: 189; transform: rotate(-90deg); transform-origin: center;
                animation: co-draw .5s .05s var(--co-ease) forwards; }
.co-mark .m-k { fill: none; stroke: var(--ok); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 36; stroke-dashoffset: 36;
                animation: co-draw .3s .42s var(--co-ease) forwards; }
.co-done-h { font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
/* the one number here is the change to hand back, said in one line */
.co-done-chg { display: flex; align-items: baseline; justify-content: center; gap: 14px; margin-top: 6px; }
.co-done-chg > :first-child { color: var(--ink-secondary); font-size: 22px; font-weight: 560; }
.co-done-num { margin-right: -.035em; font-size: 64px; font-weight: 600; letter-spacing: -.035em; line-height: 1.1; transition: color .4s; }
.co-done-num.settled { color: var(--ok); }
.co-done-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; max-width: 380px; margin-top: 28px; }
.co-done-acts .co-btn { height: 50px; }

@keyframes co-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes co-draw { to { stroke-dashoffset: 0; } }
@keyframes co-pop { from { opacity: 0; transform: scale(.6); } }
@keyframes co-pulse { from { opacity: .9; transform: scale(1); } to { opacity: 0; transform: scale(1.9); } }
@keyframes co-rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes co-print { from { clip-path: inset(0 0 100% 0); transform: translateY(-24px); } to { clip-path: inset(0 0 0 0); transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .co *, .co *::before { animation-duration: .01ms !important; animation-delay: 0s !important; transition-duration: .01ms !important; }
}
@media (max-width: 720px) {
  .co { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
  .co-items { max-height: 40vh; border-left: 0; border-top: 1px solid var(--line); }
}
.lab-co .co-tile:hover { background: var(--bg-soft); }
.lab-co .co-tile:active { background: var(--bg-softer); }`;

const MARKUP = `
<div class="co" id="checkoutApp">
  <section class="co-pay" aria-label="Payment">
    <header class="co-top">
      <button type="button" class="co-cancel" id="checkoutCancelBtn">
        <svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span id="checkoutBackText">Cancel</span>
      </button>
    </header>
    <div class="co-stage">
      <div class="co-col" id="checkoutSteps">
        <div class="co-hero num" id="checkoutTotalDue">₱0.00</div>
        <div class="co-step" data-step="method"><div class="co-tiles" id="checkoutMethods"></div></div>
        <div class="co-step" data-step="cash" hidden>
          <div class="co-tiles" id="checkoutQuick"></div>
          <div class="co-cash-in">
            <label class="co-field num"><span class="co-cur">₱</span><input type="text" id="checkoutTender" inputmode="decimal" autocomplete="off" placeholder="Other amount" aria-label="Cash received" /></label>
            <button type="button" class="co-btn primary" id="checkoutCompleteBtn" data-complete disabled>Complete sale</button>
          </div>
          <div class="co-change num" id="checkoutChange" aria-live="polite"></div>
        </div>
        <div class="co-step" data-step="paid" hidden>
          <h2 class="co-ask" id="checkoutAsk"></h2>
          <input type="text" id="otherMethodInput" class="co-ref" placeholder="e.g. Maya, bank transfer" autocomplete="off" aria-label="Payment method name" />
          <button type="button" class="co-btn primary" data-complete>Complete sale</button>
        </div>
        <div class="co-error" id="checkoutError" hidden></div>
      </div>
      <div class="co-done" id="checkoutDone" aria-live="polite" hidden>
        <div class="co-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="m-c" cx="32" cy="32" r="30"/><path class="m-k" d="M20 33l8 8 16-17"/></svg></div>
        <h2 class="co-done-h" style="--i:1">Sale complete</h2>
        <div class="co-done-chg" id="successChangeBlock" style="--i:2"><span>Change</span><span class="co-done-num num" id="successChange">₱0.00</span></div>
        <div class="co-done-acts" style="--i:4">
          <button type="button" class="co-btn" id="successPrintBtn">Print receipt</button>
          <button type="button" class="co-btn primary" id="successNewSaleBtn">New sale</button>
        </div>
      </div>
    </div>
  </section>
  <aside class="co-items" aria-label="Items">
    <button type="button" class="co-cust" id="checkoutCustBtn" title="Change customer">
      <svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>
      <span id="checkoutSub">Walk-in customer</span>
      <svg class="co-ic co-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    <div class="co-list">
      <div class="co-head"><span>Item</span><span>Amount</span></div>
      <div class="co-rows" id="checkoutCartList"></div>
      <div class="co-sum">
        <div class="co-disc" id="checkoutDiscountRow" hidden><span id="checkoutDiscountLabel">Discount</span><span class="num" id="checkoutDiscount"></span></div>
        <div class="co-total"><span>Total</span><span class="num" id="checkoutTotal">₱0.00</span></div>
      </div>
    </div>
    <div class="co-rcpt" id="checkoutReceipt" aria-label="Receipt"></div>
  </aside>
</div>`;

const $ = s => view.querySelector(s), $$ = s => view.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const peso = c => '₱' + (c / 100).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const toC = s => Math.round((parseFloat(s) || 0) * 100);
const STORE = {name: 'EJ Hardware', address: 'Main Store, Laguna', phone: '0917-000-0000', cashier: 'El John', registerNo: '1'};
const KNOWN_METHOD_LABELS = {cash: 'Cash', gcash: 'GCash', qr: 'QR', credit: 'Account', split: 'Split payment'};
const coIcon = d => `<svg class="co-ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const PAY_TILES = [
  ['cash', 'Cash', coIcon('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7"/><circle cx="12" cy="14" r="3"/>')],
  ['gcash', 'GCash', coIcon('<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01" stroke-width="2.4"/>')],
  ['qr', 'QR', coIcon('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h2v2h-2v2h2M18 14h3M18 18h1v1h1v2M21 14v2M14 18v3h2"/>')],
  ['other', 'Other', coIcon('<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>')],
  ['credit', 'Account', coIcon('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>')],
  ['split', 'Split', coIcon('<path d="M12 3v18M4 7h5M4 12h5M15 9h5M15 15h5"/>')],
];

// ---- lab only: Check out MORPHS the sale sidebar into the checkout (View Transitions; no support = instant) ----
// ?co=flush (default): the sidebar becomes the real app's items column. ?co=simple2: the sidebar stays in its own
// skin and simplifies with nothing flying -- the fulfilment row, the ⋯, Discount and Check out shrink away where they
// are, the choice fades in on the customer row, the Total stays put, and the checkout pane (its own big total) fades in.
const LAB_CSS = `
:root { --labco-e: cubic-bezier(.2, .8, .2, 1); }
::view-transition-group(*) { animation-duration: .36s; animation-timing-function: cubic-bezier(.2, .8, .2, 1); }
::view-transition-old(root), ::view-transition-new(root) { animation-duration: .24s; }
/* boxes that change height keep their content pinned to the top instead of stretching it */
::view-transition-old(co-col), ::view-transition-new(co-col), ::view-transition-old(co-items), ::view-transition-new(co-items),
::view-transition-old(co-who), ::view-transition-new(co-who) { height: 100%; object-fit: none; object-position: left top; }
::view-transition-group(co-col), ::view-transition-group(co-items), ::view-transition-group(co-who) { overflow: clip; }
::view-transition-old(co-paycard) { animation: labco-out .2s cubic-bezier(.4, 0, 1, 1) both; }
::view-transition-new(co-paycard) { animation: labco-in .3s .08s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes labco-out { to { opacity: 0; transform: translateY(12px); } }
@keyframes labco-in { from { opacity: 0; transform: translateY(12px); } }
.lab-co.simple { right: var(--lab-right, 0px); background: var(--page, #FFFFFF); }
.lab-co.simple .co { grid-template-columns: minmax(0, 1fr); }
.lab-co.simple .co-items { display: none; }
.lab-co.tint { --tile: #FFFFFF; }
/* co-anim is on only while tucking / untucking, so the sidebar's own hover transitions are untouched the rest of the time */
.co-anim .f-row, .co-anim .more, .co-anim #discBtn, .co-anim #go, .co-anim .pay {
  overflow: hidden; transition: height .26s var(--labco-e), width .26s var(--labco-e), margin .26s var(--labco-e),
                                border-width .26s var(--labco-e), padding .26s var(--labco-e), opacity .14s linear; }
.co-mode .f-row { height: 0; opacity: 0; border-top-width: 0; }
.co-mode .more { width: 0; padding: 0; opacity: 0; border-left-width: 0; }
.co-mode #discBtn { height: 0; opacity: 0; margin-bottom: calc(-1 * var(--gap)); border-bottom-width: 0; }
.co-mode #go { height: 0; padding: 0; opacity: 0; margin-top: calc(-1 * var(--gap)); border-width: 0; }
.co-mode #disc { display: none; }
.co-mode .pay { padding-top: 6px; padding-bottom: 6px; }     /* the Total row alone, centred in its card */
.co-mode .cust .co-meta { flex: none; color: var(--ink-3); font-weight: 500; animation: labco-fade .18s .1s both; }
.co-mode #lines > * { pointer-events: none; }
.lab-rcpt { position: absolute; inset: 0; z-index: 2; overflow-y: auto; overscroll-behavior: contain; padding: 20px; border-radius: inherit;
            background: #F9F9F9; animation: labco-fade .25s both; }
.lab-rcpt .receipt-preview { max-height: none; overflow: visible; padding: 0; }
.lab-rcpt .rp-paper { margin: 0 auto; animation: co-print .9s cubic-bezier(.2, .8, .2, 1) both; }
@keyframes labco-fade { from { opacity: 0; } }
.lab-nohead .i-head, .lab-nohead .co-head { display: none; }
.lab-cnt { margin-left: 6px; color: var(--ink-3); font-size: 13px; font-weight: 500; }
`;
const q = s => document.querySelector(s);
const modeWanted = /^simple/.test(new URLSearchParams(location.search).get('co')) ? 'simple' : 'flush';
let mode = 'flush';
// Pairs of [old element, new element, name]; getters, because the new ones exist only after the update.
const PAIRS = {
  flush: [[() => q('#side'), () => $('.co-items'), 'co-col'], [() => q('#who'), () => $('#checkoutCustBtn'), 'co-cust'],
          [() => q('.i-head'), () => $('.co-head'), 'co-head'], [() => q('#lines'), () => $('#checkoutCartList'), 'co-rows'],
          [() => q('#sum'), () => $('.co-total'), 'co-total']],
};
// Simplified: plain fades and in-place collapses (no named pairs, so nothing travels across the screen).
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
let tuckT;
function tuck(on) {
  const side = q('#side');
  clearTimeout(tuckT); side.classList.add('co-anim');
  side.classList.toggle('co-mode', on);
  tuckT = setTimeout(() => side.classList.remove('co-anim'), 300);
}
function morph(pairs, update) {
  const name = (els, on) => els.forEach(([el, n]) => { if (el) el.style.viewTransitionName = on ? n : ''; });
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  const before = pairs.map(([o, , n]) => [o(), n]);
  name(before, true);
  let after = [];
  document.startViewTransition(() => { name(before, false); update(); after = pairs.map(([, nw, n]) => [nw(), n]); name(after, true); })
    .finished.finally(() => name(after, false));
}
const back = pairs => pairs.map(([o, nw, n]) => [nw, o, n]);
function fitSimple() {
  if (mode !== 'simple') return;
  view.style.setProperty('--lab-right', `${innerWidth - q('#side').getBoundingClientRect().left}px`);
  view.classList.toggle('tint', getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)');
}

const style = document.createElement('style'); style.textContent = CSS + LAB_CSS; document.head.append(style);
const view = document.createElement('section');
view.className = 'view-checkout lab-co'; view.hidden = true; view.innerHTML = MARKUP;
document.body.append(view);

let sale = null, seq = 0, successT = 0;
const st = {method: 'cash', label: '', chosen: false};

// Quick cash: Exact, then the next ₱500 / ₱1,000 / ₱5,000 / ₱10,000 above the total -- three of them, never below it.
function quickTenders(c) {
  const above = m => (Math.floor(c / m) + 1) * m;
  return [c, ...new Set([50000, 100000, 500000, 1000000].map(above))].slice(0, 4);
}
console.assert(quickTenders(43750).join() === '43750,50000,100000,500000' && quickTenders(50000).join() === '50000,100000,500000,1000000', 'quickTenders');

function renderCheckout() {
  const t = sale.totals;
  $('#checkoutCartList').innerHTML = sale.lines.map(l => `
      <div class="co-row">
        <span class="co-nm">${esc(l.name)}<small class="num">${l.qty} × ${peso(l.price)}</small></span>
        <span class="co-amt num">${peso(l.price * l.qty)}</span>
      </div>`).join('');
  $('#checkoutDiscountRow').hidden = !(t.off > 0);
  $('#checkoutDiscount').textContent = '−' + peso(t.off);
  $('#checkoutTotal').textContent = peso(t.total);
  $('#checkoutTotalDue').textContent = peso(t.total);
  setError('');
  if (!sale.customer && (st.method === 'credit' || st.method === 'split')) st.method = 'cash';
  applyPayMethods(!!sale.customer);
  renderQuickCashOptions(t.total);
  if (!st.chosen) st.method = 'cash';
  $('#checkoutApp').classList.remove('is-done');
  $('#checkoutSteps').hidden = false;
  $('#checkoutDone').hidden = true;
  $('#checkoutTender').value = '';
  showPayStep();
  $('#checkoutSub').textContent = sale.customer || 'Walk-in customer';
}
function applyPayMethods(canCharge) {
  const needsAccount = m => m === 'credit' || m === 'split';
  const tiles = PAY_TILES.filter(([m]) => canCharge || !needsAccount(m));
  const grid = $('#checkoutMethods');
  grid.style.setProperty('--cols', tiles.length <= 4 ? 2 : tiles.length <= 6 ? 3 : 4);
  grid.innerHTML = tiles.map(([m, label, icon]) =>
    `<button type="button" class="co-tile" data-co-method data-method="${m}">${icon}<span>${esc(label)}</span></button>`).join('');
}
function renderQuickCashOptions(total) {
  const wrap = $('#checkoutQuick'), q = quickTenders(total);
  const short = v => peso(v).replace(/\.00$/, '');
  wrap.parentElement.style.setProperty('--cols', q.length);
  wrap.innerHTML = q.map((v, i) => `<button type="button" class="co-tile" data-co-cash="${v}">${i === 0
    ? '<span class="co-big">Exact</span><small>No change</small>'
    : `<span class="co-big num">${short(v)}</span><small class="up num">Change ${peso(v - total)}</small>`}</button>`).join('');
}
function showPayStep() {
  const m = st.method;
  const step = !st.chosen ? 'method' : (m === 'cash' || m === 'split') ? 'cash' : 'paid';
  $$('#checkoutSteps [data-step]').forEach(el => { el.hidden = el.dataset.step !== step; });
  $('#checkoutBackText').textContent = step === 'method' ? 'Cancel' : 'Back';
  $('#checkoutQuick').hidden = m === 'split';
  $('#checkoutTender').placeholder = m === 'split' ? 'Cash now' : 'Other amount';
  const typing = m === 'other' && !st.label;
  $('#otherMethodInput').hidden = !typing;
  $('#checkoutAsk').textContent = m === 'credit' ? `Charge to ${sale.customer || 'account'}`
    : typing ? 'Paid with' : `Paid with ${st.label || KNOWN_METHOD_LABELS[m] || m}`;
  updateChange();
  if (step === 'method') centreCheckout();
}
// Total + method tiles centred on their ink, 3% above the middle of the payment column; set from the method step only.
function centreCheckout() {
  const steps = $('#checkoutSteps'), hero = $('#checkoutTotalDue'), method = $('#checkoutSteps [data-step="method"]'), col = $('.co-pay');
  if (view.hidden || method.hidden) return;
  steps.style.setProperty('--lift', '0px');
  const cs = getComputedStyle(hero);
  const inkTop = hero.getBoundingClientRect().top + parseFloat(cs.paddingTop) + parseFloat(cs.fontSize) * 0.14;
  const box = col.getBoundingClientRect();
  const lift = box.top + box.height * 0.47 - (inkTop + method.getBoundingClientRect().bottom) / 2;
  steps.style.setProperty('--lift', `${Math.max(0, Math.round(lift))}px`);
}
function updateChange() {
  const total = sale.totals.total;
  const raw = $('#checkoutTender').value.trim();
  const tender = toC(raw), split = st.method === 'split', d = tender - total;
  const ok = split ? tender > 0 && d < 0 : d >= 0;
  const el = $('#checkoutChange');
  el.textContent = !raw ? ''
    : split ? (d < 0 ? `On account ${peso(-d)}` : 'Use Cash for the full amount')
    : d < 0 ? `Short ${peso(-d)}` : d > 0 ? `Change ${peso(d)}` : 'No change';
  el.className = 'co-change num' + (!raw ? '' : !ok ? ' down' : split ? '' : ' up');
  $('#checkoutCompleteBtn').disabled = !raw || !ok;
  setError('');
}
function setError(msg) { const e = $('#checkoutError'); e.textContent = msg; e.hidden = !msg; }

function completeSale() {
  const total = sale.totals.total;
  let tendered = total, change = 0;
  const isSplit = st.method === 'split';
  if (['cash', 'gcash', 'qr', 'other', 'split'].includes(st.method)) {
    const raw = $('#checkoutTender').value.trim();
    tendered = raw ? toC(raw) : total;
    if (tendered < total && !isSplit) { setError('Tendered amount is below the total.'); $('#checkoutTender').focus(); return; }
    change = Math.max(0, tendered - total);
  }
  if (isSplit && tendered >= total) { setError('A split needs a cash amount below the total. Use Cash for the full amount.'); $('#checkoutTender').focus(); return; }
  const otherName = $('#otherMethodInput').value.trim();
  if (st.method === 'other' && !otherName) { setError('Please enter the payment method name.'); $('#otherMethodInput').focus(); return; }
  const method = st.method === 'other' ? otherName : st.method;
  const payments = method === 'credit' ? [{method: 'credit', label: 'Account', amount: total}]
    : isSplit ? [{method: 'cash', amount: tendered, tendered, change}, {method: 'credit', label: 'Charge balance', amount: total - tendered}]
    : method !== 'cash' ? [{method: 'other', label: KNOWN_METHOD_LABELS[method] || method, amount: total}]
    : [{method: 'cash', amount: total, tendered, change}];
  const order = {number: `${STORE.registerNo}-${String(++seq).padStart(3, '0')}`, ts: Date.now(), lines: sale.lines, totals: sale.totals,
                 customer: sale.customer, fulfil: sale.fulfil, payments, change};
  sale.onSold();
  showCheckoutSuccess(order);
}
function showCheckoutSuccess(order) {
  const change = order.change;
  $('#successChangeBlock').hidden = !(change > 0);
  $('#checkoutSteps').hidden = true;
  $('#checkoutDone').hidden = false;
  $('#checkoutApp').classList.add('is-done');
  const receipt = $('#checkoutReceipt'); receipt.innerHTML = buildReceiptPreview(order); receipt.scrollTop = 0;
  if (mode === 'simple') {   // the receipt prints inside the sidebar's own items card
    const rc = document.createElement('div'); rc.className = 'lab-rcpt'; rc.innerHTML = receipt.innerHTML; q('.card.items').append(rc);
  }
  const changeEl = $('#successChange');
  if (change > 0) {
    changeEl.classList.remove('settled');
    changeEl.textContent = peso(0);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    clearTimeout(successT);
    successT = setTimeout(() => {
      const t0 = performance.now();
      const step = now => {
        const k = still ? 1 : Math.min(1, (now - t0) / 700);
        changeEl.textContent = peso(Math.round(change * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(step); else changeEl.classList.add('settled');
      };
      requestAnimationFrame(step);
    }, still ? 0 : 280);
  }
}
function buildReceiptPreview(o) {
  const d = new Date(o.ts);
  const dateText = d.toLocaleDateString('en-PH', {year: 'numeric', month: '2-digit', day: '2-digit'})
    + ' ' + d.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit', hour12: false});
  const lines = o.lines.map(i => `
    <div class="rp-item">
      <div class="rp-item-name">${esc(i.name)}</div>
      <div class="rp-row rp-item-line"><span>${i.qty}  × ${peso(i.price)}</span><span>${peso(i.price * i.qty)}</span></div>
    </div>`).join('');
  const payRows = o.payments.map(p => p.method === 'cash'
    ? `<div class="rp-row"><span>CASH</span><span>${peso(p.tendered || p.amount)}</span></div>${p.change > 0 ? `<div class="rp-row"><span>CHANGE</span><span>${peso(p.change)}</span></div>` : ''}`
    : `<div class="rp-row"><span>${esc(String(p.label || p.method).toUpperCase())}</span><span>${peso(p.amount)}</span></div>`).join('');
  const t = o.totals;
  return `
    <div class="receipt-preview">
      <div class="rp-paper">
        <div class="rp-center rp-store">${STORE.name}</div>
        <div class="rp-center rp-small">${STORE.address}</div>
        <div class="rp-center rp-small">Tel: ${STORE.phone}</div>
        <div class="rp-rule"></div>
        <div class="rp-row"><span>Receipt #</span><span>${o.number}</span></div>
        <div class="rp-row"><span>Date</span><span>${dateText}</span></div>
        <div class="rp-row"><span>Cashier</span><span>${STORE.cashier}</span></div>
        ${o.customer ? `<div class="rp-small">Customer: ${esc(o.customer)}</div>` : ''}
        <div class="rp-small"><strong>${esc(o.fulfil.toUpperCase())}</strong></div>
        <div class="rp-rule"></div>
        ${lines}
        <div class="rp-rule"></div>
        <div class="rp-row"><span>Subtotal</span><span>${peso(t.sub)}</span></div>
        ${t.off > 0 ? `<div class="rp-row"><span>Discount</span><span>-${peso(t.off)}</span></div>` : ''}
        <div class="rp-row rp-small"><span>VAT (12%)</span><span>${peso(t.vat)}</span></div>
        <div class="rp-row rp-total"><span>TOTAL</span><span>${peso(t.total)}</span></div>
        ${payRows}
        <div class="rp-rule"></div>
        <div class="rp-center rp-thanks">Thank you!</div>
      </div>
    </div>`;
}

function close() {
  clearTimeout(successT);
  if (mode === 'simple') {
    sale = null; tuck(false);
    [view, q('.lab-rcpt'), q('.co-meta')].forEach(el => el?.animate({ opacity: [1, 0] }, { duration: 140 * calm, fill: 'forwards' }));
    setTimeout(() => {
      if (sale) return;                               // Check out was tapped again meanwhile
      q('.lab-rcpt')?.remove(); q('.co-meta')?.remove();
      view.hidden = true; view.getAnimations().forEach(a => a.cancel());
    }, 150 * calm);
    return;
  }
  morph(back(PAIRS[mode]), () => {
    view.hidden = true; sale = null;
    q('.lab-rcpt')?.remove(); q('.co-meta')?.remove(); q('#side')?.classList.remove('co-mode');
  });
}
function selectPayMethod(method) {
  st.method = method; st.label = ''; st.chosen = true;
  $('#otherMethodInput').value = '';
  $('#checkoutTender').value = '';
  showPayStep();
  // No autofocus on cash: a tablet keyboard would cover the amounts.
  if (method === 'split') setTimeout(() => $('#checkoutTender').focus(), 60);
  else if (method === 'other') setTimeout(() => $('#otherMethodInput').focus(), 60);
}
$('#checkoutMethods').addEventListener('click', e => { const c = e.target.closest('[data-co-method]'); if (c) selectPayMethod(c.dataset.method); });
// Back: a method's detail -> the method tiles; the tiles -> the cart.
$('#checkoutCancelBtn').addEventListener('click', () => {
  if ($('#checkoutApp').classList.contains('is-done')) return;
  if (st.chosen) { st.chosen = false; st.method = 'cash'; st.label = ''; $('#checkoutTender').value = ''; showPayStep(); }
  else close();
});
// Lab stand-in for the customer picker: the lab's next customer, then the checkout re-renders like the app's does.
$('#checkoutCustBtn').addEventListener('click', () => { sale.customer = sale.onCustomer(); renderCheckout(); });
$('#checkoutTender').addEventListener('input', e => {
  const v = e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*$/, '$1');
  if (v !== e.target.value) e.target.value = v;
  updateChange();
});
$('#checkoutTender').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#checkoutCompleteBtn').disabled) completeSale(); });
$('#otherMethodInput').addEventListener('keydown', e => { if (e.key === 'Enter') completeSale(); });
// A cash amount is the decision: the tap finishes the sale.
$('#checkoutQuick').addEventListener('click', e => {
  const b = e.target.closest('[data-co-cash]'); if (!b) return;
  $('#checkoutTender').value = (b.dataset.coCash / 100).toFixed(2);
  updateChange(); completeSale();
});
$('#checkoutSteps').addEventListener('click', e => { if (e.target.closest('[data-complete]')) completeSale(); });
addEventListener('resize', () => { if (sale) { fitSimple(); centreCheckout(); } });
// Simplified: the sidebar's customer row is the checkout's (the real one opens the picker; the lab cycles customers).
document.addEventListener('click', e => {
  if (!sale || mode !== 'simple' || !e.target.closest('#who')) return;
  e.stopPropagation();
  if (!$('#checkoutApp').classList.contains('is-done')) { sale.customer = sale.onCustomer(); renderCheckout(); }
}, true);
$('#successPrintBtn').addEventListener('click', () => {
  const b = $('#successPrintBtn'); b.textContent = 'Printing…'; setTimeout(() => { b.textContent = 'Print receipt'; }, 1200);
});
$('#successNewSaleBtn').addEventListener('click', close);

// ?head=0: rows of name-left / amount-right explain themselves, so no Item / Amount band. The count the band carried
// moves beside Total, in the sidebar and in the checkout's items column, mirrored from the lab's own #count.
if (new URLSearchParams(location.search).get('head') === '0') {
  document.documentElement.classList.add('lab-nohead');
  const count = q('#count'), sync = () => {
    const t = count && /\d/.test(count.textContent) ? count.textContent : '';   // 'Item' / 'No items' = empty cart: nothing
    document.querySelectorAll('.lab-cnt').forEach(el => { el.textContent = t; });
  };
  [q('#sum .l'), $('.co-total > :first-child')].forEach(l => {
    if (!l) return;
    const c = document.createElement('span'); c.className = 'lab-cnt';
    l.insertBefore(c, l.querySelector('.ic'));
  });
  if (count) new MutationObserver(sync).observe(count, { childList: true, characterData: true, subtree: true });
  sync();
}

window.labCheckout = {
  open(o) {
    if (!o.lines.length) return;
    sale = {...o, customer: o.customer || ''};
    st.method = 'cash'; st.label = ''; st.chosen = false;
    mode = modeWanted === 'simple' && q('#side .card.pay') ? 'simple' : 'flush';   // simple needs the round-3 sidebar
    view.classList.toggle('simple', mode === 'simple');
    if (mode === 'simple') {
      q('.co-meta')?.remove(); q('.lab-rcpt')?.remove();
      const meta = document.createElement('span'); meta.className = 'co-meta'; meta.textContent = o.fulfil;
      q('#who').insertBefore(meta, q('#who .chev'));
      tuck(true);
      view.getAnimations().forEach(a => a.cancel());
      view.hidden = false; fitSimple(); renderCheckout();
      view.animate({ opacity: [0, 1] }, { duration: 200 * calm, easing: 'ease-out' });
      return;
    }
    morph(PAIRS[mode], () => {
      view.hidden = false;
      fitSimple();
      renderCheckout();
    });
  },
};
})();
