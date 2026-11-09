// mods-page-lab only: shoots round 2 (e, f, g) step by step, with 50 modifiers seeded in the test browser and the old list put back after
async (page) => {
  const dir = 'C:/Users/eljoh/POS APP/mods-page-lab/shots/r2-';
  const shot = n => page.screenshot({ path: dir + n + '.png' });
  const w = ms => page.waitForTimeout(ms);
  const open = async (mv, size = { width: 393, height: 852 }) => {
    await page.setViewportSize(size);
    await page.goto('http://localhost:8655/mods-page-lab/?mv=' + mv);
    await w(900);
    await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      applyTheme('light'); switchView('items'); await w(500);
      openItemEditor('d6cdc82b-e077-45bd-8fb9-8d2d30fcdc95');
      const by = [...modsById().values()], id = n => by.find(m => m.name === n).id;
      itemEdit.mods = [id('Ice'), id('Sweetness')]; itemEdit.hideCh = [];
      await w(300); itemGo('mods'); await w(700);
    });
  };
  const tick = name => page.locator(`#itemForm label.pick:has-text("${name}") input`).first().click();
  const go = name => page.locator(`#itemForm .pick.mod-on .tx:has-text("${name}")`).first().click();
  const back = () => page.evaluate(() => itemGo(itemParent(itemSub) || '', true));

  // seed: the 3 real ones + 47 more, as a busy café / food stall would have
  await page.goto('http://localhost:8655/mods-page-lab/?mv=e'); await w(800);
  const orig = await page.evaluate(() => localStorage.getItem(STORAGE_MODIFIERS));
  await page.evaluate(() => {
    const names = ['Size', 'Milk', 'Sugar level', 'Extra shot', 'Syrup', 'Cheese', 'Sauce', 'Spice level', 'Rice', 'Side', 'Drink', 'Egg', 'Dip', 'Bread', 'Doneness',
      'Cup', 'Lid', 'Straw', 'Whipped cream', 'Drizzle', 'Foam', 'Temperature', 'Tea base', 'Fruit', 'Jelly', 'Noodles', 'Broth', 'Meat', 'Veggies', 'Dressing',
      'Crust', 'Slice', 'Gravy', 'Soup', 'Dessert', 'Packaging', 'Utensils', 'Napkins', 'Sinkers', 'Salt', 'Pepper', 'Vinegar', 'Garlic', 'Onion', 'Chili oil', 'Calamansi', 'Ketchup'];
    const list = loadModifiers();
    names.forEach((n, i) => list.push({ id: 'seed-' + i, name: n, archived: false,
      options: ['Regular', 'Large +₱10', 'None'].map((o, j) => ({ id: `seed-${i}-${j}`, name: o.split(' +')[0], price: j === 1 ? 10 : 0 })) }));
    saveModifiers(list);
  });

  try {
    // e: as now, the line under the name says it opens
    await open('e'); await shot('e-1');
    await tick('Toppings'); await w(400); await shot('e-2jump'); await page.locator('#itemForm').evaluate(f => f.scrollTop = 0); await w(200); await shot('e-2');
    await go('Ice'); await w(500); await shot('e-3');
    await back(); await w(500); await page.fill('#itemFindQ', 'sau'); await w(300); await shot('e-4');

    // f: two cards
    await open('f'); await shot('f-1');
    await page.locator('#itemForm').evaluate(f => f.scrollTop = 99999); await w(200); await shot('f-1b');
    await page.locator('#itemForm').evaluate(f => f.scrollTop = 0);
    await tick('Toppings'); await w(400); await page.locator('#itemForm').evaluate(f => f.scrollTop = 0); await w(200); await shot('f-2');
    await go('Ice'); await w(500); await shot('f-3');
    await back(); await w(500); await page.fill('#itemFindQ', 'sau'); await w(300); await shot('f-4');

    // g: top card + Add modifier page
    await open('g'); await shot('g-1');
    await page.click('#itemForm [data-act=mv-add]'); await w(500); await shot('g-2');
    await tick('Toppings'); await w(300); await tick('Cheese'); await w(300); await shot('g-3');
    await back(); await w(500); await shot('g-4');
    await go('Ice'); await w(500); await shot('g-5');

    // iPad
    await open('f', { width: 1180, height: 820 }); await shot('f-ipad');
    await open('g', { width: 1180, height: 820 }); await page.click('#itemForm [data-act=mv-add]'); await w(500); await shot('g-ipad');
  } finally {
    await page.evaluate(o => (o == null ? localStorage.removeItem(STORAGE_MODIFIERS) : localStorage.setItem(STORAGE_MODIFIERS, o)), orig);
  }
  return 'done';
}
