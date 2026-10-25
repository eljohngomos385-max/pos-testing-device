// Viz lab — stitches viz.css + data.js + parts/*.html into one self-contained index.html.
// Run: node viz-lab/build.mjs [partsDir] [out.html] [title]   default: parts → index.html. Parts join in file-name order.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const [partsDir = 'parts', outFile = 'index.html', title = 'Back office viz lab'] = process.argv.slice(2);
const parts = readdirSync(join(dir, partsDir)).filter(f => f.endsWith('.html')).sort();
const body = parts.map(f => `<!-- ===== part ${f} ===== -->\n` + readFileSync(join(dir, partsDir, f), 'utf8')).join('\n');
// The top nav lists every category the parts declare (<section class="cat" id=… data-nav=…>).
const nav = [...body.matchAll(/<section class="cat" id="([^"]+)" data-nav="([^"]+)"/g)].map(m => `<a href="#${m[1]}">${m[2]}</a>`).join('');
const count = (body.match(/class="spec[" ]/g) || []).length;

writeFileSync(join(dir, outFile), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap" rel="stylesheet">
<style>
${readFileSync(join(dir, 'viz.css'), 'utf8')}
</style>
<script>
${readFileSync(join(dir, 'data.js'), 'utf8')}
</script>
</head><body>
<header class="lab-top"><div class="lab-top-in"><h1>${title} · ${count}</h1>${nav}</div></header>
<main class="sheet">
${body}
</main>
</body></html>
`);
console.log(`${outFile}: ${parts.length} parts, ${count} components`);
