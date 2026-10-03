// One word, one number: fails when a retired sales word is back on a screen or in a CSV header.
// The words are owner-settled (pos-vault features/sales-terms, 2026-10-02).
// Run: node scripts/words-check.mjs
import { readFileSync, readdirSync } from 'node:fs';

const FILES = ['index.html', 'backoffice.html', 'app.js', 'backoffice.js', 'bo-sales.js', 'bo-transactions.js',
  'bo-staff.js', 'bo-insights.js', 'bo-item.js', 'bo-inventory.js', 'bo-products.js', 'bo-catalog.js', 'bo-suppliers.js',
  'printer.js', 'router.js', 'bo-model.js',
  ...readdirSync(new URL('..', import.meta.url)).filter((f) => /^pos-.*\.js$/.test(f))];
// Only text a person reads: quoted strings, template text and HTML text. Code names (calmRow,
// revenuePesos) and comments are not screens.
const RETIRED = [
  [/\bRevenue\b/, 'Net sales'],
  [/(^|[^s] )Profit\b|^Profit\b/, 'Gross profit'],
  [/\bNot collected\b/, 'Unpaid'],
  [/\b\d+ transactions?\b|\$\{[^}]+\} transactions?\b|\btransaction\$\{/, 'order(s)'],
  [/\bTransactions?\b/, 'Order(s)'],
  [/\bVAT included\b/, 'taxLine(o) — the tax name comes from Settings'],
  // Products → Items. Capitalised only, plus the lowercase phrases a person reads: route ids
  // ('products') and code names (state.products, data-product) stay.
  [/\bProducts?\b/, 'Item(s)'],
  [/\b(?:a|the|no|every|\d+) products?\b|\bproducts?\$\{|\bproducts\.csv\b|\bsearch products?\b|\bproduct-days\b/i, 'item(s)'],
  // Category on screen; "folder" is the code name only.
  [/\bFolders?\b|\b(?:[Aa]|[Tt]he|[Nn]ew|[Tt]his|[Aa]nother|[Nn]o|[Rr]ename|[Dd]elete) folders?\b/, 'Category'],
  [/\bQty sold\b|\bSold 30d\b/, 'Units sold'],
  [/^\s*Spent\s*$|\bLifetime Value\b/, 'Total spent'],
  [/\bCash in stock\b|\bCash tied up\b|\bTied up now\b|\bOn hand at cost\b|\bPeso-days\b/, 'Stock value'],
  [/\bReceipt total\b|\breceipt_total\b|\b\d+ receipts\b|\$\{[^}]+\} receipts?\b|\breceipt\$\{|\bold receipts\b/i, 'Total / order(s) — a receipt is the paper'],
  [/\b[Tt]he cashier\b/, 'Staff — "Cashier" only on the printed receipt'],
  [/\bBack Office\b/, 'Back office'],
  [/\bOn hand\b/, 'In stock'],
  [/\bOutstanding\b/, 'Incoming (supplier money) / Balance (customer money)'],
  [/\bCharge balance\b|\bCharged to account\b|\bactive debtors\b/, 'Account / Balance'],
];
// Comments out; a // inside a URL (https://) is not one.
const strip = (line) => line.replace(/(^|[^:])\/\/.*$/, '$1').replace(/^\s*\*.*$/, '').replace(/<!--.*?-->/g, '');
const texts = (line) => [...line.matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`|>([^<>{}]+)</g)]
  .map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);

// ponytail: one line at a time, so text in a template that wraps onto the next line is not read;
// reading whole files mismatches quotes on every apostrophe.
const bad = [];
for (const f of FILES) {
  let src;
  try { src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'); } catch { continue; }
  src.split(/\r?\n/).forEach((raw, i) => {
    for (const t of texts(strip(raw))) for (const [re, use] of RETIRED)
      if (re.test(t)) bad.push(`${f}:${i + 1}  "${t.trim().slice(0, 60)}"  → ${use}`);
  });
}
if (bad.length) { console.error(`words-check: ${bad.length} retired word(s)\n` + bad.join('\n')); process.exit(1); }
console.log('words-check: ok');
