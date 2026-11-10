async (page) => {
  const URL = 'http://localhost:8655/pos-lab/';
  const fails = [], log = [], errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  const ok = (n, c, extra) => { if (!c) fails.push(n + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); log.push(n); };
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const W = ms => page.waitForTimeout(ms || 330);
  const ev = (f, a) => page.evaluate(f, a);
  const dump = () => page.evaluate(() => JSON.stringify(Array.from({ length: localStorage.length }, (_, i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i))])));
  const original = await dump();
  // one known store for every case: empty browser, Food picked, its demo loaded
  await ev(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'load' });
  await W(900);
  await page.locator('.rail-veil [data-v]', { hasText: 'Food' }).first().click();
  await W(1800);
  await page.waitForLoadState('load');
  await W(500);
  const backup = await dump();
  const fresh = async () => {
    await ev(b => { localStorage.clear(); JSON.parse(b).forEach(([k, v]) => localStorage.setItem(k, v)); }, backup);
    await page.goto(URL, { waitUntil: 'load' });
    await W(900);
    await ev(() => switchView('items'));
    await W(200);
  };
  const tap = async s => { if (s.startsWith('.cf-sheet')) await W(420); await page.locator(s).first().click({ timeout: 4000 }); await W(); };   // a pop-up ignores taps for its first 350ms (showConfirm's double tap guard)
  const sheet = () => page.locator('.cf-sheet').count();
  const title = () => page.locator('#itemTitle').textContent();
  const st = () => ev(() => ({ waiting: !!modFromItem, kind: !!kindEdit, item: !!itemEdit, sub: itemSub, picking: document.querySelector('#itemForm').closest('.editor').classList.contains('picking'), editing: document.querySelector('#itemsView').classList.contains('editing') }));
  const stored = n => ev(n => loadModifiers().filter(m => m.name === n && !m.archived).map(m => m.id), n);
  const rows = () => page.locator('#itemForm .pick.mod-on .tx').evaluateAll(e => e.map(x => x.firstChild.textContent.trim()));
  const firstId = () => ev(() => catalogItems().find(i => i.variants?.length === 1 && !i.mods.length)?.id || catalogItems()[0].id);
  const open = async id => { await ev(i => openItemEditor(i), id); await W(); };
  const NAME = '#itemForm [data-k=name]', NEW = '#itemForm [data-act=mod-new]', ADD = '#itemForm [data-act=mod-add]', ORD = '#itemForm [data-act=mod-order]', BACK = '#itemBack', SAVE = '#itemSave', MODS = '#itemForm [data-sub=mods]', PILL = '#kindPickGo';
  const OKS = '.cf-sheet [type=submit]', KEEP = '.cf-sheet [data-cancel]';
  const toast = async () => (await page.locator('#toast').textContent()) || '';
  const saveShown = () => page.locator(SAVE).isVisible();
  const addChoice = async c => { await tap('#itemForm [data-ka=choice-add]'); await page.locator('#itemForm [data-c=name]').fill(c); await W(60); };

  let crash = null;
  try {
  for (const [w, h] of [[393, 852], [1024, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    const t = n => w + ' ' + n;

    // 1: an item with unsaved changes; in, out, typed then Back
    await fresh();
    const id = await firstId();
    await open(id);
    await page.locator('#itemForm [data-f=name]').fill('Zed test');
    await tap(MODS); await tap(ADD);
    await page.locator('#itemForm label.pick').first().click(); await W(100);
    const ticked = await ev(() => [...modAdding]);
    ok(t('1 one ticked'), ticked.length === 1, ticked);
    await tap(NEW);
    ok(t('1 no leave question going in'), await sheet() === 0);
    ok(t('1 title New modifier'), await title() === 'New modifier', await title());
    let s = await st();
    ok(t('1 item waits'), s.waiting && s.kind && !s.item, s);
    await W(200);
    ok(t('1 name focused'), await ev(() => document.activeElement?.dataset?.k === 'name'));
    await tap(BACK);
    ok(t('1 untouched Back asks nothing'), await sheet() === 0);
    ok(t('1 back on Add page'), await title() === 'Add modifier', await title());
    ok(t('1 tick kept'), await page.locator('#itemForm [data-add-mod]:checked').count() === 1);
    ok(t('1 pill says Add 1'), (await page.locator(PILL).textContent()).includes('Add 1') && await page.locator(PILL).isEnabled());
    await tap(NEW);
    await page.locator(NAME).fill('Zzz'); await W(50);
    await tap(BACK);
    ok(t('1 typed Back asks'), await sheet() === 1);
    await tap(KEEP); await W(200);
    ok(t('1 keep editing stays'), await page.locator(NAME).inputValue() === 'Zzz' && (await st()).waiting);
    await tap(BACK); await tap(OKS); await W(200);
    ok(t('1 leave lands on Add page'), await title() === 'Add modifier', await title());
    ok(t('1 nothing stored'), (await stored('Zzz')).length === 0);
    ok(t('1 tick still kept'), await page.locator('#itemForm [data-add-mod]:checked').count() === 1);
    s = await st();
    ok(t('1 item back'), !s.waiting && !s.kind && s.item && s.sub === 'modadd', s);

    // 2: every wrong Save, then Save from the choice page, then the item's own Save
    await tap(NEW);
    await tap(SAVE);
    ok(t('2 no name refused'), (await toast()).includes('name') && (await st()).waiting, await toast());
    await page.locator(NAME).fill('Ice'); await W(50);
    await tap(SAVE);
    ok(t('2 duplicate refused'), (await toast()).includes('already') && (await st()).waiting, await toast());
    await page.locator(NAME).fill('Size'); await W(50);
    await tap(SAVE);
    ok(t('2 no choice refused'), (await toast()).includes('choice') && (await st()).waiting, await toast());
    await addChoice('Large');
    await page.locator('#itemForm [data-c=price]').fill('10'); await W(50);
    ok(t('2 no Save on Add choice'), !(await saveShown()));
    await page.locator('#itemForm [data-c=name]').press('Enter'); await W(150);
    ok(t('2 Enter on a choice saves nothing'), await title() === 'Add choice' && (await stored('Size')).length === 0 && (await st()).waiting, await title());
    await tap(BACK); await W(150);
    ok(t('2 Back from the choice = the modifier'), await title() === 'Size' && await saveShown() && (await st()).waiting, await title());
    ok(t('2 Back stored nothing yet'), (await stored('Size')).length === 0);
    await addChoice('Small');
    ok(t('2 a second choice can be added'), await title() === 'Add choice' && !(await saveShown()), await title());
    await tap(BACK); await W(150);
    const f2 = await page.locator('#itemForm').innerText();
    ok(t('2 both choices listed'), f2.includes('Large') && f2.includes('Small'), f2);
    await tap(SAVE); await W(200);
    ok(t('2 lands on Modifiers'), await title() === 'Modifiers', await title());
    const size = await stored('Size');
    ok(t('2 stored once'), size.length === 1, size);
    const r2 = await rows();
    ok(t('2 new one last, ticked one too'), r2.length === 2 && r2[r2.length - 1] === 'Size', r2);
    s = await st();
    ok(t('2 state clean'), !s.waiting && !s.kind && s.item && s.sub === 'mods' && !s.picking && s.editing, s);
    ok(t('2 Saved shown'), (await toast()).includes('Saved'), await toast());
    ok(t('2 choice price stored'), await ev(n => loadModifiers().find(m => m.name === n).options[0].price === 10, 'Size'));
    await tap(BACK); await W(200);
    ok(t('2 item name kept'), await page.locator('#itemForm [data-f=name]').inputValue() === 'Zed test');
    await tap(SAVE); await W(400);
    const saved = await ev(i => { const p = catalogItems().find(x => x.id === i); return { name: p.name, mods: p.mods }; }, id);
    ok(t('2 item saved with name + mods'), saved.name === 'Zed test' && saved.mods.includes(size[0]) && saved.mods.length === 2, saved);
    ok(t('2 editor closed'), !(await st()).editing);

    // 3: a brand-new unsaved item, thrown away afterwards
    await fresh();
    const count = await ev(() => catalogItems().length);
    await ev(() => openItemEditor(null)); await W();
    await tap(MODS); await tap(ADD); await tap(NEW);
    ok(t('3 no ask on a new item'), await sheet() === 0);
    await page.locator(NAME).fill('Sz2'); await addChoice('A'); await tap(BACK); await W(150);
    ok(t('3 choice Back stays in form'), await title() === 'Sz2', await title());
    await tap(SAVE); await W(200);
    ok(t('3 on the list'), (await rows()).includes('Sz2'));
    ok(t('3 still a new item'), await ev(() => itemIsNew));
    await tap(BACK); await tap(BACK);
    ok(t('3 throwing the item away asks'), await sheet() === 1);
    await tap(OKS); await W(200);
    ok(t('3 no item created'), await ev(() => catalogItems().length) === count);
    ok(t('3 modifier stays in the store'), (await stored('Sz2')).length === 1);

    // 4: all on the item
    await fresh();
    await open(id);
    await ev(() => { itemEdit.mods = kindList('mods').map(m => m.id); itemGo('mods'); }); await W();
    ok(t('4 Add row there'), await page.locator(ADD).isVisible());
    await tap(ADD);
    const f4 = await page.locator('#itemForm').innerText();
    ok(t('4 says none left, offers New'), f4.includes('No other modifiers.') && f4.includes('New modifier'), f4);
    ok(t('4 no pill'), !(await page.locator(PILL).isVisible()));
    if (w === 393) await page.screenshot({ path: 'C:/Users/eljoh/POS APP/shots/mods-port/v6-phone-none-left.png' });
    await tap(NEW); await page.locator(NAME).fill('Sz3'); await addChoice('B'); await tap(BACK); await tap(SAVE); await W(200);
    ok(t('4 joined, 4 rows'), (await rows()).length === 4, await rows());

    // 9: ordering still works after, on the same page
    await tap(ORD);
    ok(t('9 Add hidden while ordering'), !(await page.locator(ADD).isVisible()));
    const before9 = await rows();
    const lastRow = page.locator('#itemForm .pick.mod-on').last(), b = await lastRow.boundingBox();
    await page.mouse.move(b.x + 80, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 80, b.y - b.height, { steps: 6 }); await page.mouse.up(); await W(400);
    const after9 = await rows();
    ok(t('9 drag moved the new row'), after9[3] !== before9[3] && after9.includes('Sz3'), after9);
    await tap(ORD);
    ok(t('9 Done brings Add back'), await page.locator(ADD).isVisible());

    // 5: a store with no modifiers at all
    await fresh();
    await ev(() => saveModifiers(loadModifiers().map(m => ({ ...m, archived: true }))));
    await open(id);
    await tap(MODS);
    ok(t('5 Add row with an empty store'), await page.locator(ADD).isVisible() && await page.locator(ORD).count() === 0);
    await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('First'); await addChoice('One'); await tap(BACK); await tap(SAVE); await W(200);
    ok(t('5 first modifier made'), JSON.stringify(await rows()) === '["First"]', await rows());

    // 6: the blue button on Asked on / Add items stays in the modifier, with this same item picked
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Sz6'); await addChoice('C'); await tap(BACK);
    await ev(i => { kindEdit.picked.add(i); itemGo('items'); }, id); await W();
    ok(t('6 on the picking page'), (await st()).picking);
    ok(t('6 Asked on says Done, not Save'), (await page.locator(PILL).innerText()).includes('Done') && !(await page.locator(PILL).innerText()).includes('Save'), await page.locator(PILL).innerText());
    await tap(PILL); await W(250);
    s = await st();
    ok(t('6 stays on the modifier'), await title() === 'Sz6' && s.waiting && !s.picking && await saveShown(), s);
    ok(t('6 no pill left'), !(await page.locator(PILL).isVisible()));
    ok(t('6 search bar gone'), !(await page.locator('#itemFind').isVisible()));
    ok(t('6 nothing stored yet'), (await stored('Sz6')).length === 0);
    await tap('#itemForm [data-sub=add]');
    await page.locator('#itemForm label.pick').first().click(); await W(120);
    const tick6 = await ev(() => document.querySelector('#itemForm label.pick [data-pick]').dataset.pick);
    ok(t('6 Add items says Add 1'), (await page.locator(PILL).innerText()).includes('Add 1'), await page.locator(PILL).innerText());
    await tap(PILL); await W(250);
    ok(t('6 Add items stays on the modifier'), await title() === 'Sz6' && (await st()).waiting && (await stored('Sz6')).length === 0, await title());
    ok(t('6 ticks kept'), await ev(([a, b]) => kindEdit.picked.has(a) && kindEdit.picked.has(b), [id, tick6]));
    ok(t('6 the row counts them'), (await page.locator('#itemForm').innerText()).includes('2 items'), await page.locator('#itemForm').innerText());
    await tap(SAVE); await W(250);
    s = await st();
    ok(t('6 Save leaves, picks gone'), await title() === 'Modifiers' && !s.waiting && !s.picking && s.sub === 'mods', s);
    const id6 = (await stored('Sz6'))[0];
    ok(t('6 the other item got it'), await ev(([i, m]) => catalogItems().find(x => x.id === i).mods.includes(m), [tick6, id6]));
    await tap(BACK); await tap(SAVE); await W(400);
    const once = await ev(([i, m]) => catalogItems().find(x => x.id === i).mods.filter(x => x === m).length, [id, id6]);
    ok(t('6 on the item exactly once'), once === 1, once);

    // 21: the blue button before anything is typed, double tapped, and a tick that Back on the modifier throws away
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await tap('#itemForm [data-sub=add]');
    await page.locator('#itemForm label.pick').first().click(); await W(120);
    await page.locator(PILL).dblclick(); await W(450);
    s = await st();
    ok(t('21 no name needed, double tap lands once'), await title() === 'New modifier' && s.waiting && !s.picking && await sheet() === 0, await title());
    await tap(BACK);
    ok(t('21 a tick counts as a change'), await sheet() === 1);
    await tap(OKS); await W(200);
    ok(t('21 leave: back on Add modifier, nothing stored'), await title() === 'Add modifier' && !(await st()).waiting, await title());

    // 10: walking off to another screen and back
    await fresh();
    await open(id);
    await page.locator('#itemForm [data-f=name]').fill('Walk');
    await tap(MODS); await tap(ADD); await tap(NEW);
    await ev(() => switchView('sell')); await W(); await ev(() => switchView('items')); await W();
    await tap(BACK); await W(150);
    ok(t('10 back after walking off'), await title() === 'Add modifier', await title());
    await tap(BACK); await tap(BACK);
    ok(t('10 item kept its name'), await page.locator('#itemForm [data-f=name]').inputValue() === 'Walk');

    // 11: double tap on the row
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD);
    await page.locator(NEW).dblclick(); await W(400);
    s = await st();
    ok(t('11 double tap, one form'), s.waiting && s.kind && !s.item && await title() === 'New modifier', s);
    await tap(BACK); await W(150);
    ok(t('11 one Back gets out'), await title() === 'Add modifier', await title());

    // 12: many modifiers: the row stays while searching
    await fresh();
    await ev(() => { const l = loadModifiers(); for (let i = 0; i < 12; i++) l.push(stampRow({ ...MODIFIER_DEFAULTS, id: newId(), name: 'Bulk ' + i, picks: 'one', options: [{ id: newId(), name: 'x', price: 0, unavailable: false, removed: false }] })); saveModifiers(l); });
    await open(id);
    await tap(MODS); await tap(ADD);
    ok(t('12 search shows'), await page.locator('#itemFind').isVisible());
    ok(t('12 New row first card'), await ev(() => document.querySelector('#itemForm .fc [data-act=mod-new]').closest('.fc') === document.querySelector('#itemForm .fc')));
    await page.locator('#itemFindQ').fill('Bulk 3'); await W(200);
    ok(t('12 list filtered'), await page.locator('#itemForm label.pick:visible').count() === 1, await page.locator('#itemForm label.pick:visible').count());
    await tap(NEW);
    ok(t('12 New opens while searching'), await title() === 'New modifier', await title());
    await tap(BACK); await W(150);
    ok(t('12 search cleared on return'), await page.locator('#itemFindQ').inputValue() === '');

    // 8: the ordinary ways in are unchanged
    await fresh();
    await ev(() => openKindEditor('mods', null)); await W();
    ok(t('8 Modifiers tab: nothing waiting'), !(await st()).waiting);
    await tap(BACK); await W(150);
    ok(t('8 Modifiers tab: Back closes'), !(await st()).editing);
    await ev(() => openKindEditor('mods', null)); await W();
    await page.locator(NAME).fill('Tab1'); await addChoice('A');
    ok(t('8 Modifiers tab: no Save on Add choice'), !(await saveShown()));
    await tap(BACK); await W(150);
    ok(t('8 Modifiers tab: Back = the modifier, nothing stored'), await title() === 'Tab1' && await saveShown() && (await stored('Tab1')).length === 0, await title());
    await tap(SAVE); await W(250);
    ok(t('8 Modifiers tab: Save on the modifier closes as before'), !(await st()).editing && (await stored('Tab1')).length === 1);

    // 8b: on the Modifiers tab the blue button still saves and stays, as before
    await ev(n => openKindEditor('mods', loadModifiers().find(m => m.name === n).id), 'Tab1'); await W();
    await tap('#itemForm [data-sub=add]');
    await page.locator('#itemForm label.pick').first().click(); await W(120);
    await tap(PILL); await W(250);
    ok(t('8b tab: saves, stays on the modifier'), await title() === 'Tab1' && (await st()).editing && await ev(n => kindEdit.picked.size === 1 && itemsWith('mods', loadModifiers().find(m => m.name === n).id).length === 1, 'Tab1'), await title());
    await ev(() => itemGo('items')); await W();
    ok(t('8b tab: Asked on still says Save'), (await page.locator(PILL).innerText()).includes('Save'), await page.locator(PILL).innerText());
    await ev(() => itemGo('', true)); await W();
    await tap(BACK); await W(150);
    if (await sheet()) { await tap(OKS); await W(200); }

    // 20: Edit choice, a blank choice, Back keeping an edit, Hidden as it was
    await ev(n => openKindEditor('mods', loadModifiers().find(m => m.name === n).id), 'Tab1'); await W();
    ok(t('20 modifier page has Save'), await saveShown());
    await tap('#itemForm [data-sub^="choice:"]');
    ok(t('20 Edit choice title, no Save'), await title() === 'Edit choice' && !(await saveShown()), await title());
    await page.locator('#itemForm [data-c=name]').fill('Renamed'); await W(60);
    await tap(BACK); await W(150);
    ok(t('20 Back keeps the edit on the row'), (await page.locator('#itemForm').innerText()).includes('Renamed'));
    ok(t('20 not stored until Save'), await ev(n => loadModifiers().find(m => m.name === n).options[0].name === 'A', 'Tab1'));
    await tap(BACK);
    ok(t('20 leaving with an edit asks'), await sheet() === 1);
    await tap(KEEP); await W(200);
    await tap(SAVE); await W(250);
    ok(t('20 Save stores the edit'), await ev(n => loadModifiers().find(m => m.name === n).options[0].name === 'Renamed', 'Tab1'));
    await ev(n => openKindEditor('mods', loadModifiers().find(m => m.name === n).id), 'Tab1'); await W();
    await tap('#itemForm [data-ka=choice-add]');
    ok(t('20 blank Add choice has no Save'), !(await saveShown()));
    await tap(BACK); await W(150);
    ok(t('20 blank choice goes'), await ev(() => kindEdit.options.length === 1) && await saveShown());
    await tap('#itemForm [data-sub^="choice:"]');
    await tap('#itemForm [data-ka=choice-del]'); await W(150);
    ok(t('20 Remove choice lands on the modifier with Save'), await title() === 'Tab1' && await saveShown(), await title());
    await ev(() => itemGo('hidden')); await W();
    ok(t('20 Hidden keeps its Save'), await title() === 'Hidden' && await saveShown(), await title());
    await ev(() => itemGo('', true)); await W();
    await tap(BACK); await W(150);
    if (await sheet()) { await tap(OKS); await W(200); }
    ok(t('20 closed'), !(await st()).editing);
    await open(id);
    await page.locator('#itemForm [data-f=name]').fill('Dirty'); await tap(BACK);
    ok(t('8 ordinary item Back still asks'), await sheet() === 1);
    await tap(OKS); await W(150);

    // 13: Asked on left open, then another screen drops the editor (pos-sell.js addPickStart): the next item must not look like it
    await fresh();
    await ev(() => openKindEditor('mods', kindList('mods')[0].id)); await W();
    await ev(() => itemGo('items')); await W();
    ok(t('13 on the picking page'), (await st()).picking);
    await ev(() => document.querySelector('#itemsView').classList.remove('editing'));
    await open(id);
    ok(t('13 next item not picking'), !(await st()).picking);
    await tap(BACK); await W(150);

    // 14: two in a row, then the sale side of it
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Two1'); await addChoice('A'); await tap(BACK); await tap(SAVE); await W(200);
    await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Two2'); await addChoice('B'); await tap(BACK); await tap(SAVE); await W(200);
    ok(t('14 both on the item, in order'), JSON.stringify((await rows()).slice(-2)) === '["Two1","Two2"]', await rows());
    await tap(BACK); await W(150); await tap(SAVE); await W(400);
    const p14 = await ev(i => state.products.find(x => x.id === i)?.modifierIds, id);
    const m14 = await ev(() => loadModifiers().filter(m => /^Two/.test(m.name)).map(m => m.id));
    ok(t('14 product carries both'), m14.length === 2 && m14.every(x => p14?.includes(x)), { p14, m14 });

    // 15: double tap on Save
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Dbl'); await addChoice('A'); await tap(BACK);
    await page.locator(SAVE).dblclick(); await W(500);
    ok(t('15 stored once'), (await stored('Dbl')).length === 1, await stored('Dbl'));
    ok(t('15 on the item once'), (await rows()).filter(x => x === 'Dbl').length === 1, await rows());
    s = await st();
    ok(t('15 still in the item'), s.editing && s.item && s.sub === 'mods', s);

    // 16: an untouched item, a new modifier, then walking away from the item
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Walk2'); await addChoice('A'); await tap(BACK); await tap(SAVE); await W(200);
    await tap(BACK); await W(150); await tap(BACK);
    ok(t('16 the new row counts as a change'), await sheet() === 1);
    await tap(OKS); await W(200);
    ok(t('16 kept in the store'), (await stored('Walk2')).length === 1);
    const m16 = (await stored('Walk2'))[0];
    ok(t('16 item left as it was'), await ev(([i, m]) => !catalogItems().find(x => x.id === i).mods.includes(m), [id, m16]));

    // 17: the item page keeps its scroll
    await fresh();
    await open(id);
    const top17 = await ev(() => { const f = document.querySelector('#itemForm'); f.scrollTop = 120; return f.scrollTop; });
    await ev(() => document.querySelector('#itemForm [data-sub=mods]').click()); await W();   // a real click would scroll the row into view first
    await tap(ADD); await tap(NEW);
    await tap(BACK); await W(150); await tap(BACK); await W(150); await tap(BACK); await W(250);
    ok(t('17 scroll back where it was'), Math.abs(await ev(() => document.querySelector('#itemForm').scrollTop) - top17) <= 2, top17);

    // 18: the words on the new row and a name that needs escaping
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('<b>"x"&y'); await addChoice('A & <i>'); await tap(BACK); await tap(SAVE); await W(200);
    ok(t('18 odd name shown as typed'), (await rows()).includes('<b>"x"&y'), await rows());
    ok(t('18 nothing injected'), await page.locator('#itemForm .pick.mod-on b, #itemForm .pick.mod-on i').count() === 0);

    // 19: a Leave tapped the instant the question appears is ignored (double tap guard), the next one works
    await fresh();
    await open(id);
    await tap(MODS); await tap(ADD); await tap(NEW);
    await page.locator(NAME).fill('Quick'); await W(50);
    await page.locator(BACK).click();
    await ev(() => document.querySelector('.cf-sheet [type=submit]').click());
    ok(t('19 too-quick Leave ignored'), await sheet() === 1 && (await st()).waiting);
    await tap(OKS); await W(200);
    ok(t('19 next Leave works'), await sheet() === 0 && await title() === 'Add modifier', await title());

    // 7: iPad only: the list beside the form
    if (w === 1024) {
      await fresh();
      const other = await ev(i => catalogItems().find(x => x.id !== i).id, id);
      await open(id);
      await page.locator('#itemForm [data-f=name]').fill('Tablet');
      await tap(MODS); await tap(ADD); await tap(NEW);
      await ev(i => openItemEditor(i), other); await W();
      ok(t('7 other row asks when the item has changes'), await sheet() === 1);
      await tap(KEEP); await W(150);
      s = await st();
      ok(t('7 keep editing, item still waiting'), s.waiting && s.kind, s);
      await ev(i => openItemEditor(i), other); await W(); await tap(OKS); await W(300);
      s = await st();
      ok(t('7 leave opens the other, nothing waiting'), !s.waiting && !s.kind && s.item && await ev(() => itemEdit.id) === other, s);
      await tap(BACK); await W(150);
      ok(t('7 then Back closes'), !(await st()).editing);
      await fresh();
      await open(id);
      await tap(MODS); await tap(ADD); await tap(NEW);
      await ev(i => openItemEditor(i), other); await W();
      ok(t('7 clean item: no question'), await sheet() === 0);
      s = await st();
      ok(t('7 clean item: other opens'), !s.waiting && await ev(() => itemEdit?.id) === other, s);
    }
  }
  } catch (e) {
    crash = { err: String(e).slice(0, 260), after: log.slice(-2), title: await page.locator('#itemTitle').textContent().catch(() => ''), sheet: await page.locator('.rail-veil').allInnerTexts().catch(() => []) };
  }
  await ev(b => { localStorage.clear(); JSON.parse(b).forEach(([k, v]) => localStorage.setItem(k, v)); }, original);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(URL, { waitUntil: 'load' });
  return { crash, total: log.length, fails, errs };
}
