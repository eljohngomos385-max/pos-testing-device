// QR codes (owner 2026-10-16, built in qr-lab): one printed QR per table, shared by everyone at it. A switch says if the
// table takes orders; staff confirm every QR order on the POS. Tap a table → its page: the QR, Print, name, New QR,
// Delete. Tables live in state.settings.qrTables, saved like any setting (saveSettings → HWPOS_STORE).
// ponytail: front end only. The guest menu, and the orders it sends, come with Supabase.
const QR_BASE = 'https://order.example/t/';   // ponytail: placeholder until the guest menu has a real address
let qrOpenId = '';
const QR_CHEV = '<svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

const qrToken = () => newId().replace(/-/g, '').slice(0, 12);
function qrTables() {
  if (!Array.isArray(state.settings.qrTables)) {
    const now = new Date().toISOString();
    state.settings.qrTables = Array.from({ length: 8 }, (_, i) => ({ id: newId(), name: `Table ${i + 1}`, on: i < 3, token: qrToken(), updatedAt: now }));
    saveSettings();
  }
  return state.settings.qrTables;
}
function qrSave(t) { t.updatedAt = new Date().toISOString(); saveSettings(); }
const qrFind = (id) => qrTables().find(t => t.id === id);

function showQrPage(id) { $$('.view-qr .st-page').forEach(p => { p.hidden = p.id !== id; }); }

function renderQr() {
  const list = qrTables();
  showQrPage('qrPage');
  // By name, numbers in order (Table 2 before Table 10), so a new or renamed table lands in its place
  const byName = [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  $('#qrList').innerHTML = byName.map(t => {
    const n = escapeHtml(t.name);
    // The switch turns it on/off; the rest of the row (name, gap, ›) opens the table, like iPhone's Wi-Fi row
    return `<div class="fr qr-row" data-qr-open="${t.id}"><button type="button" class="lb">${n}</button><span class="v"><input type="checkbox" class="sw" data-qr-on="${t.id}" aria-label="${n} taking orders"${t.on ? ' checked' : ''}>${QR_CHEV}</span></div>`;
  }).join('') + '<button type="button" class="fr add" id="qrAdd">Add table</button>';
}

function openQrTable(id) {
  const t = qrFind(id);
  if (!t) return renderQr();
  qrOpenId = id;
  showQrPage('qrTablePage');
  $('#qrTitle').textContent = t.name;
  $('#qrName').value = t.name;
  $('#qrOn').checked = t.on;
  $('#qrArt').replaceChildren(new ZXingBrowser.BrowserQRCodeSvgWriter().write(QR_BASE + t.token, 200, 200));
}

function bindQr() {
  $('#qrList').addEventListener('click', (e) => {
    const open = !e.target.closest('.sw') && e.target.closest('[data-qr-open]');
    if (open) return openQrTable(open.dataset.qrOpen);
    if (!e.target.closest('#qrAdd')) return;
    const list = qrTables();
    // Lowest free "Table N": delete Table 1, add, and Table 1 is back (owner 2026-10-17)
    let n = 1;
    while (list.some(t => t.name === `Table ${n}`)) n++;
    list.push({ id: newId(), name: `Table ${n}`, on: false, token: qrToken(), updatedAt: new Date().toISOString() });
    saveSettings();
    renderQr();
  });
  $('#qrList').addEventListener('change', (e) => {
    const t = qrFind(e.target.dataset.qrOn);
    if (!t) return;
    t.on = e.target.checked;
    qrSave(t);
    renderQr();
  });
  $('#qrBack').addEventListener('click', renderQr);
  $('#qrOn').addEventListener('change', (e) => { const t = qrFind(qrOpenId); if (t) { t.on = e.target.checked; qrSave(t); } });
  $('#qrName').addEventListener('change', (e) => {
    const t = qrFind(qrOpenId), name = e.target.value.trim();
    if (!t) return;
    if (!name) { e.target.value = t.name; return; }
    t.name = name;
    qrSave(t);
    $('#qrTitle').textContent = name;
  });
  // ponytail: a toast for now; prints through printer.js once the sticker layout is decided
  $('#qrPrint').addEventListener('click', () => showToast('Printing the QR'));
  $('#qrNew').addEventListener('click', () => {
    const t = qrFind(qrOpenId);
    if (!t) return;
    showConfirm({
      title: `New QR for ${t.name}?`,
      message: 'Old photos and the sticker on the table stop working. Print the new one.',
      okText: 'New QR',
      onConfirm: () => { t.token = qrToken(); qrSave(t); openQrTable(t.id); showToast('New QR made'); },
    });
  });
  $('#qrDelete').addEventListener('click', () => {
    const t = qrFind(qrOpenId);
    if (!t) return;
    showConfirm({
      title: `Delete ${t.name}?`,
      message: 'Its QR stops working.',
      okText: 'Delete',
      danger: true,
      onConfirm: () => { state.settings.qrTables = qrTables().filter(x => x.id !== t.id); saveSettings(); renderQr(); showToast(`${t.name} deleted`); },
    });
  });
}
