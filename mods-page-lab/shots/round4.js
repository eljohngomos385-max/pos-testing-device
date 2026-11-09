// mods-page-lab only: shoots round 3 (i..r) step by step, 50 modifiers seeded in the test browser, the old list put back after
async (page) => {
  const dir = 'C:/Users/eljoh/POS APP/mods-page-lab/shots/r4-';
  let mv = '';
  const shot = n => page.screenshot({ path: `${dir}${mv}-${n}.png` });
  const w = ms => page.waitForTimeout(ms);
  const open = async (asked = ['Ice', 'Sweetness', 'Toppings']) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto('http://localhost:8655/mods-page-lab/?mv=' + mv);
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
  const row = name => page.locator(`#itemForm .pick[data-mod]`).filter({ hasText: new RegExp(`^\s*${name}`) }).first();
  const tick = name => page.locator(`#itemForm label.pick:has-text("${name}") input`).first().click();
  const back = () => page.evaluate(() => itemGo(itemParent(itemSub) || '', true));
  const tap = async (sel, ms = 400) => { await page.locator(sel).first().click(); await w(ms); };
  const menu = async label => { await page.locator(`.rail-menu button:has-text("${label}")`).first().click(); await w(500); };
  // press on a row, (hold,) move by dy, shoot mid-way, let go
  const drag = async (loc, dy, n, hold = 0) => {
    const b = await loc.boundingBox(), x = b.x + b.width - 30, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); if (hold) await w(hold);
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x, y + dy * i / 8); await w(30); }
    await w(250); await shot(n); await page.mouse.up(); await w(450);
  };
  const swipe = async (loc) => {
    const b = await loc.boundingBox(), x = b.x + b.width - 40, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(x - i * 14, y); await w(20); }
    await page.mouse.up(); await w(400);
  };

  await page.goto('http://localhost:8655/mods-page-lab/?mv=i'); await w(800);
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
  const errs = [];
  const ONLY = '';   // e.g. 'o' re-shoots one version
  const run = async (v, f) => { mv = v; if (ONLY && !ONLY.includes(v)) return; try { await f(); } catch (e) { errs.push(v + ': ' + e.message.split('\n')[0]); } };

  try {
    await run('i', async () => {
      await open(); await shot(1);
      await tap('#itemForm .mv-go:has-text("IceAll")', 500); await shot(2); await back(); await w(500);
      await tap('[data-mvtab=ord]'); await shot(3);
      await drag(row('Toppings'), -110, 4); await shot(5);
      await tap('[data-mvtab=all]'); await shot(6);
      await tick('Cheese'); await w(300); await shot(7);
      await tap('[data-mvtab=on]'); await shot(8);
    });
    await run('j', async () => {
      await open(); await shot(1);
      await tap('#itemForm .mv-go:has-text("IceAll")', 500); await shot(2); await back(); await w(500);
      await drag(row('Toppings'), -110, 3, 600); await shot(4);
      await swipe(row('Ice')); await shot(5);
      await tap('#itemForm .mv-sw.swiped .mv-sw-rm'); await shot(6);
      await tap('#itemForm [data-act=mv-add]', 500); await shot(7);
      await tick('Cheese'); await w(300); await back(); await w(500); await shot(8);
    });
    await run('k', async () => {
      await open(); await shot(1);
      await tap('#itemForm .pick[data-mod]:has-text("Toppings") .mv-more', 500); await shot(2);
      await menu('Move up'); await shot(3);
      await tap('#itemForm .pick[data-mod]:has-text("IceAll") .mv-more', 500); await shot(4);
      await menu('Remove from this item'); await shot(5);
      await tap('#itemForm .mv-go:has-text("Sweetness")', 500); await shot(6);
    });
    await run('l', async () => {
      await open(); await shot(1);
      await tap('#itemForm .mv-go:has-text("IceAll")', 500); await shot(2);
      await page.locator('#itemForm').evaluate(f => f.scrollTop = 99999); await w(200); await shot(3); await back(); await w(500);
      await tap('#itemForm [data-sub=modord]', 500); await shot(4);
      await drag(row('Toppings'), -110, 5); await shot(6);
      await back(); await w(500); await shot(7);
    });
    await run('m', async () => {
      await open(); await shot(1);
      await tap('#itemForm .pick[data-mod]:has-text("Toppings") .mv-num', 500); await shot(2);
      await menu('Ask 1st'); await shot(3);
      await tap('#itemForm .mv-go:has-text("IceAll")', 500); await page.locator('#itemForm').evaluate(f => f.scrollTop = 99999); await w(200); await shot(4);
    });
    await run('n', async () => {
      await open(); await shot(1);
      await tap('[data-mvacc]:has-text("IceAll")'); await shot(2);
      await tap('#itemForm .mv-tools [data-d="1"]'); await shot(3);
      await tap('#itemForm .mv-tools [data-mvrm]'); await shot(4);
      await tap('#itemForm [data-act=mv-add]', 500); await shot(5);
    });
    await run('o', async () => {
      await open(); await shot(1);
      await tap('#itemForm [data-mvpop]:has-text("IceAll")', 600); await shot(2);
      await tap('.mv-pop [data-d="1"]'); await shot(3);
      await tap('.mv-pop [data-mvclose]', 600); await shot(4);
      await tap('#itemForm [data-mvpop]:has-text("Toppings")', 600); await tap('.mv-pop [data-mvrm]', 600); await shot(5);
    });
    await run('p', async () => {
      await open(); await shot(1);
      await tap('#itemForm [data-act=mv-add]', 500); await shot(2);
      await tap('#itemForm [data-mvtog]:has-text("Cheese")', 300); await shot(3);
      await tap('#itemForm [data-mvtog]:has-text("Ice")', 300); await shot(4);
      await back(); await w(500); await shot(5);
    });
    await run('q', async () => {
      await open(); await shot(1);
      await tap('[data-mvacc]:has-text("Toppings")'); await shot(2);
      await tap('#itemForm .mv-tools [data-d="-1"]'); await shot(3);
      await tap('#itemForm .mv-tools [data-mvrm]'); await shot(4);
    });
    await run('r', async () => {
      await open(); await shot(1);
      await tap('#itemForm [data-mvorder]'); await shot(2);
      await tap('#itemForm .mv-selrow:has-text("Toppings")', 300); await shot(3);
      await tap('#itemForm [data-mvshift="-1"]'); await shot(4);
      await tap('#itemForm .mv-selrow:has-text("IceAll")', 300); await tap('#itemForm [data-mvselrm]'); await shot(5);
      await tap('#itemForm [data-mvorder]'); await shot(6);
    });
    mv = 'i'; await open([]); await shot('empty');
  } finally {
    await page.evaluate(o => (o == null ? localStorage.removeItem(STORAGE_MODIFIERS) : localStorage.setItem(STORAGE_MODIFIERS, o)), orig);
  }
  return errs.length ? errs.join('\n') : 'done';
}
