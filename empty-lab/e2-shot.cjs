// node e2-shot.cjs  -> copy shot (scratch) + e2-light.png / e2-dark.png
const { chromium } = require(process.env.LOCALAPPDATA + '/Temp/pos-app-verify-playwright/node_modules/playwright-core');
const path = require('path'), url = f => 'file:///' + path.resolve(__dirname, f).replace(/\\/g, '/');
const which = process.argv[2] || 'all';
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  if (which === 'all' || which === 'copy') {
    const p = await b.newPage({ viewport: { width: 609, height: 420 }, deviceScaleFactor: 1 });
    await p.goto(url('e2-copy.html')); await p.waitForTimeout(200);
    await p.screenshot({ path: process.argv[3] || path.join(__dirname, 'img/e2-copy-shot.png') });
  }
  if (which === 'all' || which === 'glow') {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    for (const t of ['light', 'dark']) {
      await p.goto(url('e2-glow.html') + '#' + t); await p.reload(); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(__dirname, `img/e2-${t}.png`), fullPage: true });
    }
  }
  await b.close();
})();
