# CLAUDE.md — EJ Hardware POS

Vanilla HTML/CSS/JS POS. No build step. `index.html` + `pos-*.js` (one per screen) + `app.js` (events
+ init) + `styles.css`, plus a
light-themed back office at `backoffice.html`. See `README.md` for architecture, state keys and
verify scripts; `ROADMAP.md` is the feature spec (Products, Inventory, Sales, Suppliers, page
access) and carries the decisions already settled for each page.

**This ships online.** Real stores, several POS terminals per store, one hosted back office they
all sync into. That is what decides whether a change is cheap or a migration.

## Read before you edit

The conventions live in `docs/`. **Read the matching file before changing anything in that area** —
it is there so the same decisions don't have to be re-explained, and so they don't get quietly
reversed.

| Touching | Read first |
|---|---|
| `index.html`, `pos-*.js`, `app.js`, `styles.css` — the dark POS | `docs/design-pos.md` |
| `backoffice.html`, `backoffice.js`, `bo-*.js`, `router.js` | `docs/backoffice.md` |
| `printer.js` or anything on the receipt path | `docs/printing.md` |
| Data shape, sync, storage, `worker/`, `schema.sql`, `data-store.js` | `docs/architecture.md` |

## The vault — `C:\Users\eljoh\Desktop\pos-vault`

The shared brain for this app: owner decisions, what's wrong today, plans, per-session logs.
`docs/` holds the rules for how code and screens are written; the vault holds *what was decided and why*.

- `C:\Users\eljoh\Desktop\pos-vault\CLAUDE.md` — the vault protocol; follow it.
- Session start: read `pos-vault/guidelines.md` + the matching `pos-vault/features/<feature>.md`,
  create your session file in `pos-vault/sessions/per-agent/`, scan today's other session files.
- **Update the vault every turn, not at the end.** Decision, change, discovery, dead end → session
  file (running log) **and** the matching `features/*.md` (Decisions / Recent changes / Learnings,
  with the *why*). Owner decisions in a feature note are settled — don't relitigate them.
- "X is broken" → create a regression file in `pos-vault/regressions/` and follow the regression protocol.
- **Picking the app back up? Read `pos-vault/plans/start-here.md` first**: what the rebuild did, where each number comes from, what is open, what is next.
- Sales numbers or their words → `features/sales-terms.md` first. Data model, sync, Supabase →
  `features/database.md`. The rebuild order → `plans/data-core-rebuild.md`.

## Always

- **Pull colors, sizes and radii from the `:root` CSS variables** (`--surface`, `--line`, `--ink*`,
  `--r-input`; the `--po-*` set in `body.bo-light` for the back office). Never hardcode a value a
  token already names.
- **Bump the `?v=NN` query** on the `styles.css` / `pos-*.js` / `app.js` includes in `index.html`, and on
  `styles.css` / `backoffice.js` in `backoffice.html`, when shipping CSS or JS changes.
- **New code never touches `localStorage` directly** — it goes through `HWPOS_STORE` in
  `data-store.js`.
- **Money is never stored as REAL.** Postgres: exact `numeric(12,2)` in the store's currency
  (decided 2026-10-02, no Worker). Until the schema moves, `schema.sql` and the Worker keep integer
  centavos. Show amounts only through `peso()` (pos-core.js, backoffice.js), never a hardcoded `₱`.
- **Every record carries a client-generated UUID, `updated_at` and `store_id`.** Orders and ledger
  rows are append-only; a void or a refund is a new row, never an edit.
- Match surrounding code style. Keep changes minimal and consistent with the existing component.
- When asked for a tweak that already has a convention in `docs/`, apply the convention automatically.

## Checks

`node --check` on `app.js` and every `pos-*.js`, and `node scripts/verify-order-format.mjs`, are the reliable deterministic
gates — always run them. Also run `node scripts/printer-check.mjs` after touching `printer.js`, and
`node scripts/worker-check.mjs` after touching `worker/index.js` or `schema.sql`.

The browser-based `scripts/math-audit.mjs` (Playwright + Edge) is **flaky under load**: orphaned
Edge processes from repeated runs cause timeouts that surface as phantom "subtotal/VAT mismatch"
failures (same code yields 0 then 49). Don't trust a single audit run; if it fails, check for
piled-up `msedge.exe` processes before suspecting the diff.
