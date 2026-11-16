// node a4-grain-shot.cjs copy [out.png]  -> shot of a4-grain-copy.html at the ref crop's size
// node a4-grain-shot.cjs design          -> img/a4-grain-light.png + img/a4-grain-dark.png
const { chromium } = require('/Users/eljohn/POS APP/node_modules/playwright-core');
const path = require('path'), url = f => 'file://' + path.resolve(__dirname, f);
const which = process.argv[2] || 'all';
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  if (which === 'all' || which === 'copy') {
    const p = await b.newPage({ viewport: { width: 736, height: 588 }, deviceScaleFactor: 1 });
    await p.goto(url('a4-grain-copy.html')); await p.waitForTimeout(300);
    await p.screenshot({ path: process.argv[3] || path.join(__dirname, 'img/a4-grain-copy-shot.png') });
  }
  if (which === 'all' || which === 'design') {
    const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
    for (const t of ['light', 'dark']) {
      await p.goto(url('a4-grain.html') + '#' + t); await p.setViewportSize({ width: 1400, height: 900 }); await p.reload(); await p.waitForTimeout(400);
      await p.setViewportSize({ width: 1400, height: await p.evaluate(() => document.documentElement.scrollHeight) }); await p.waitForTimeout(300);

      await p.screenshot({ path: path.join(__dirname, `img/a4-grain-${t}.png`) });
    }
  }
  await b.close();
})();
