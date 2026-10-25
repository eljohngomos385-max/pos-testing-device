// Makes v2-pages.html: v2.html with pages.js pasted at the end, so the picks show page by page.
// Run after every v2 build: node viz-lab/pages.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'v2.html'), 'utf8')
  .replace('<title>Back office viz lab v2</title>', '<title>Viz lab by page</title>')
  .replace('</main>', `</main>\n<script>\n${readFileSync(join(dir, 'pages.js'), 'utf8')}</script>`);
writeFileSync(join(dir, 'v2-pages.html'), page);
console.log('v2-pages.html written');
