// Makes v2-topics.html: v2.html with topics.js pasted at the end, so the same cards show grouped by topic.
// Run after every v2 build: node viz-lab/topics.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(dir, 'v2.html'), 'utf8')
  .replace('<title>Back office viz lab v2</title>', '<title>Viz lab by topic</title>')
  .replace('</main>', `</main>\n<script>\n${readFileSync(join(dir, 'topics.js'), 'utf8')}</script>`);
writeFileSync(join(dir, 'v2-topics.html'), page);
console.log('v2-topics.html written');
