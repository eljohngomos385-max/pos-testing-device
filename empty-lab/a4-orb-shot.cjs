// node a4-orb-shot.cjs [copy OUT.png | orb]  -> copy shot (400×400, dpr 1) or img/a4-orb-light.png + a4-orb-dark.png
const { chromium } = require('/Users/eljohn/POS APP/node_modules/playwright-core');
const path = require('path'), url = f => 'file://' + path.resolve(__dirname, f);
const which = process.argv[2] || 'all';
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  if (which === 'all' || which === 'copy') {
    const p = await b.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
    await p.goto(url(process.argv[4] || 'a4-orb-copy.html')); await p.waitForTimeout(200);
    await p.screenshot({ path: process.argv[3] || path.join(__dirname, 'img/a4-orb-copy-shot.png') });
  }
  if (which === 'all' || which === 'orb') {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    for (const t of ['light', 'dark']) {
      await p.goto(url('a4-orb.html') + '#' + t); await p.reload(); await p.waitForTimeout(300);
      await p.screenshot({ path: path.join(__dirname, `img/a4-orb-${t}.png`), fullPage: true });
    }
  }
  await b.close();
})();
