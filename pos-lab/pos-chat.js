/* Chat (owner 2026-11-15, built in pos-lab-chat). Design only, no AI yet. One page: "Hi El, ask anything" on white, a pale blue
   haze rising from the bottom, the asks as a sideways carousel (Granola) above a see-through box (ChatGPT / Claude).
   The asks answer from this POS's own sales maths, so the numbers match Reports; anything else gets "not connected yet". */
const CHT_ASKS = ['How did today go?', 'What sold most this week?', 'What sold most this month?'];
const chtMsgs = [];   // the chat on screen
// The chats so far, newest first: [{ id, title, at, msgs }], the title = its first question (ChatGPT's way).
// shortcut: one device-only list in HWPOS_STORE.ui, answers kept as their HTML; upgrade when chat syncs through Supabase.
const chtAll = () => { try { return JSON.parse(HWPOS_STORE.ui.get('chats', '[]')) || []; } catch { return []; } };
let chtId = null;
function chtSave() {
  const all = chtAll().filter(c => c.id !== chtId);
  chtId = chtId || crypto.randomUUID();
  all.unshift({ id: chtId, title: chtMsgs[0].text, at: new Date().toISOString(), msgs: chtMsgs });
  HWPOS_STORE.ui.set('chats', JSON.stringify(all.slice(0, 200)));
}
// Lab only: sample chats so History has something to show on a new phone (owner 2026-11-15: "show me history with a lot of stuff").
// shortcut: made once per device from the real answers; drop when chats sync from Supabase.
function chtSeed() {
  if (HWPOS_STORE.ui.get('chatsSeeded')) return;   // once per device, after any chats already there
  const asks = ['How did today go?', 'What sold most this week?', 'Which paint colours sell best?', 'What sold most this month?', 'Who owes us money?',
    'Is cement running low?', 'Best day of the week for sales', 'How much did we discount this month?', 'Compare this week to last week',
    'What should I reorder?', 'Slowest items this month', 'Cash vs GCash this week', 'Top customer this month', 'How busy are mornings?',
    'Which items lost money?', 'Sales for gravel and sand', 'How many orders today?', 'Average order size this month', 'What sold most last weekend?',
    'Refunds this month', 'Which supplier do I buy most from?', 'Plan stock for payday', 'Best selling tool', 'What changed since yesterday?'];
  const day = 864e5, now = Date.now();
  HWPOS_STORE.ui.set('chats', JSON.stringify(chtAll().concat(asks.map((q, i) => ({ id: crypto.randomUUID(), title: q, at: new Date(now - (i + 1) * day * 0.7).toISOString(),
    msgs: [{ me: true, text: q }, { html: chtAnswer(q) }] })))));
  HWPOS_STORE.ui.set('chatsSeeded', '1');
}
let chtQuery = '';
function renderChatHistory() {
  chtSeed();
  const q = chtQuery.trim().toLowerCase(), all = chtAll(), list = all.filter(c => c.title.toLowerCase().includes(q));
  $('.cht-hist .cht-sec').hidden = !!q || !all.length;   // Recents sits in the head (owner: it rode the list's pull-down bounce)
  $('#chtList').innerHTML = !all.length ? emptyState('clock', 'Your chats show here.')
    : !list.length ? noResults(chtQuery.trim())
    : list.map(c => `<button type="button" class="row" data-cht-open="${escapeHtml(c.id)}"><div class="nm"><span>${escapeHtml(c.title)}</span></div></button>`).join('');
}
const chtHistory = (on) => {
  $('.view-chat').classList.toggle('cht-hist-on', on);
  if (on) { chtQuery = $('#chtSearch').value = ''; $('#chtFind').classList.remove('typed'); renderChatHistory(); }
};

const chtWin = (days) => {
  const z = tillZone(), k = tillDay(Date.now());
  return { from: SalesMath.dayStartMs(SalesMath.addDays(k, -(days - 1)), z), to: SalesMath.dayStartMs(SalesMath.addDays(k, 1), z) };
};
const chtRows = (rows) => `<div class="cht-rows">${rows.map(r => `<div><span>${escapeHtml(r.name)}<small>${SalesMath.qtyText(r.unitsSold)} sold</small></span><b class="num">${peso(r.netSales)}</b></div>`).join('')}</div>`;

function chtAnswer(q) {
  const t = q.toLowerCase(), days = t.includes('today') ? 1 : t.includes('week') ? 7 : t.includes('month') ? 30 : 0;
  if (!days) return '<p>Chat isn’t connected yet. For now it answers the questions above the box.</p>';
  const win = chtWin(days), m = SalesMath.summarize(state.orders, win), top = SalesMath.topItems(state.orders, { ...win, limit: 3 });
  const when = days === 1 ? 'Today' : days === 7 ? 'In the last 7 days' : 'In the last 30 days';
  if (!m.orders) return `<p>${when} there are no sales yet.</p>`;
  const lead = days === 1 ? `${when} you made <b class="num">${peso(m.netSales)}</b> in net sales from ${SalesMath.plural(m.orders, 'order')}.`
    : `${when}, these sold the most. Net sales were <b class="num">${peso(m.netSales)}</b> in all.`;
  return `<p>${lead}</p>${top.length ? (days === 1 ? '<p>Top items so far:</p>' : '') + chtRows(top) : ''}`;
}

// the look the owner picked in pos-lab-chat's try-out (2026-11-15): the questions as pills, dark mode with the blue glow
const CHT_TRY = { asks: 'pills', dark: 'colour' };
const chtOpt = (k) => CHT_TRY[k];

function renderChat() {
  const on = chtMsgs.length > 0, log = $('#chtLog'), view = $('.view-chat');
  view.classList.toggle('cht-on', on);
  for (const k in CHT_TRY) view.dataset[k] = chtOpt(k);
  $('#chtAsks').innerHTML = on ? '' : CHT_ASKS.map(a => `<button type="button" class="cht-ask" data-ask="${a}">${a}</button>`).join('');
  if (!on) {
    const first = (state.user?.name || $('.user-name')?.textContent || '').trim().split(/\s+/)[0];   // the name on the menu's name row
    log.innerHTML = `<div class="cht-hi"><h2>${first ? `Hi ${escapeHtml(first)}, ask anything` : 'Ask anything'}</h2></div>`;
    return;
  }
  log.innerHTML = `<div class="cht-thread">${chtMsgs.map(m => m.me ? `<div class="cht-me">${escapeHtml(m.text)}</div>` : `<div class="cht-ai">${m.html}</div>`).join('')}</div>`;
  log.scrollTop = log.scrollHeight;
}

function chtSend(text) {
  text = text.trim();
  if (!text) return;
  chtMsgs.push({ me: true, text }, { html: chtAnswer(text) });
  chtSave();
  $('#chtIn').value = '';
  $('#chtBox').classList.remove('typed');
  renderChat();
}

document.addEventListener('click', (e) => {
  const ask = e.target.closest('[data-ask]');
  if (ask) return chtSend(ask.dataset.ask);
  if (e.target.closest('#chtNew')) { chtMsgs.length = 0; chtId = null; return renderChat(); }
  if (e.target.closest('#chtHist')) return chtHistory(true);
  if (e.target.closest('#chtHistX')) return chtHistory(false);
  const open = e.target.closest('[data-cht-open]');
  if (open) {
    const c = chtAll().find(x => x.id === open.dataset.chtOpen);
    if (c) { chtId = c.id; chtMsgs.splice(0, chtMsgs.length, ...c.msgs); }
    chtHistory(false);
    return renderChat();
  }
});
$('#chtBox').addEventListener('submit', (e) => { e.preventDefault(); chtSend($('#chtIn').value); });

// The keyboard (owner 2026-11-15: "it brings the entire page up"). A phone app is told the keyboard's height by iOS / Android;
// a web page reads it off visualViewport, the part of the screen still showing. Safari slides the whole page up to show the box:
// the page is slid back down by that much (--cht-pan) and only the questions + box rise by the keyboard (--cht-kb).
const chtKb = () => {
  const vv = window.visualViewport, view = $('.view-chat');
  const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-height')) || innerHeight;
  const typing = !!vv && document.activeElement === $('#chtIn');
  const kb = typing ? Math.max(0, Math.round(appH - vv.height)) : 0;
  view.style.setProperty('--cht-kb', kb + 'px');
  view.style.setProperty('--cht-pan', (typing ? Math.round(vv.offsetTop) : 0) + 'px');
  view.classList.toggle('cht-kb', kb > 80);
  if (kb > 80 && chtMsgs.length) $('#chtLog').scrollTop = $('#chtLog').scrollHeight;
};
window.visualViewport?.addEventListener('resize', chtKb);
window.visualViewport?.addEventListener('scroll', chtKb);
// the greeting leaves the moment the box is tapped, as Gemini's does, not once the keys are fully up
$('#chtIn').addEventListener('focus', () => { $('.view-chat').classList.add('cht-typing'); chtKb(); });
$('#chtIn').addEventListener('blur', () => { $('.view-chat').classList.remove('cht-typing'); setTimeout(chtKb, 0); });
$('#chtIn').addEventListener('touchend', (e) => {   // take the cursor without Safari's own slide; chtKb lifts the box
  if (document.activeElement === e.target) return;
  e.preventDefault();
  e.target.focus({ preventScroll: true });
}, { passive: false });
$('#chtIn').addEventListener('input', (e) => $('#chtBox').classList.toggle('typed', !!e.target.value.trim()));
wireFind('#chtFind', '#chtSearch', '#chtSearchX', (q) => { chtQuery = q; renderChatHistory(); });
