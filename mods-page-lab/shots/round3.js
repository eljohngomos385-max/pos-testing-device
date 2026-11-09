// mods-page-lab only: shoots G2 (?mv=h) step by step, 50 modifiers seeded in the test browser, the old list put back after
async (page) => {
  const dir = 'C:/Users/eljoh/POS APP/mods-page-lab/shots/r3-';
  const shot = n => page.screenshot({ path: dir + n + '.png' });
  const w = ms => page.waitForTimeout(ms);
  const open = async (asked = ['Ice', 'Sweetness'], size = { width: 393, height: 852 }) => {
    await page.setViewportSize(size);
    await page.goto('http://localhost:8655/mods-page-lab/?mv=h');
    await w(900);
    await page.evaluate(async (asked) => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      applyTheme('light'); switchView('items'); await w(500);
      openItemEditor('d6cdc82b-e077-45bd-8fb9-8d2d30fcdc95');
      const by = [...modsById().values()];
      itemEdit.mods = asked.map(n => by.find(m => m.name === n).id); itemEdit.hideCh = [];
      await w(300); itemGo('mods'); await w(700);
    }, asked);
  };
  const tick = name => page.locator(`#itemForm label.pick:has-text("${name}") input`).first().click();
  const back = () => page.evaluate(() => itemGo(itemParent(itemSub) || '', true));
  const edit = () => page.click('#itemForm [data-mvorder]');

  await page.goto('http://localhost:8655/mods-page-lab/?mv=h'); await w(800);
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
    await open(['Ice', 'Sweetness', 'Toppings']); await shot('1-open');
    await page.click('#itemForm .mv-go:has-text("Ice")'); await w(500); await shot('2-ice');
    await back(); await w(500);
    await edit(); await w(300); await shot('3-edit');
    // drag Toppings to the top: hold ≡, move, shoot mid-drag, let go
    const g = await page.locator('#itemForm .pick.mv-ed:has-text("Toppings") .grip').boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - i * 9); await w(30); }
    await w(250); await shot('4-drag'); await page.mouse.up(); await w(400); await shot('5-dropped');
    await page.click('#itemForm .pick.mv-ed:has-text("Ice") .mv-minus'); await w(400); await shot('6-minus');
    await edit(); await w(300); await shot('7-done');
    await page.click('#itemForm [data-act=mv-add]'); await w(500); await shot('8-add');
    await tick('Cheese'); await w(300); await shot('9-ticked');
    await back(); await w(500); await shot('10-back');

    await open([]); await shot('11-none-asked');
    await page.evaluate(() => { saveModifiers([]); renderItemForm(); }); await w(300); await shot('12-store-none');
  } finally {
    await page.evaluate(o => (o == null ? localStorage.removeItem(STORAGE_MODIFIERS) : localStorage.setItem(STORAGE_MODIFIERS, o)), orig);
  }
  // iPad, real data
  await open(['Ice', 'Sweetness', 'Toppings'], { width: 1180, height: 820 }); await shot('ipad-open');
  await edit(); await w(300); await shot('ipad-edit');
  return 'done';
}
