const pw = require(process.env.LOCALAPPDATA + '/Temp/pos-app-verify-playwright/node_modules/playwright-core');
(async () => {
  const b = await pw.chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const p = await b.newPage({ viewport: { width: 600, height: 950 }, deviceScaleFactor: 3 });
  await p.goto('http://127.0.0.1:8691/phone.html?still#items');
  await p.waitForTimeout(2500);
  const fr = p.frames()[1];
  await fr.evaluate(() => { document.body.classList.add('light-theme'); });
  await p.waitForTimeout(600);
  const r = await p.locator('#dev').boundingBox();
  await p.screenshot({ path: process.argv[2], clip: r });
  await b.close();
})();
