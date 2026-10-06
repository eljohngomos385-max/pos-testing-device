/* ==========================================================
   Hardware POS — PIN: who is at the till, and the manager's approval
   ----------------------------------------------------------
   Three parts, kept apart on purpose:
   1. pinWho(pin) -- THE check: the staff record a PIN names, or null. Today it reads the staff
      list on this till (bo-model staffByPin), so it works with no internet.
      BACK-OFFICE INTEGRATION PLUGS IN HERE: swap pinWho's body for the hosted staff lookup and
      keep staffByPin as the offline fallback. Nothing else in this file reads a PIN.
   2. The lockout (pinLock*): 5 wrong -> wait 30s, the next lockout 1 min, then 5 min (and stays
      5 min) until 5 quiet minutes pass. One record in HWPOS_STORE.ui ('pinLock'), so a reload can't skip
      the wait; every lockout is a row in the append-only pinLockouts log (bo-model EVENT_LOGS:
      uuid, updatedAt, storeId) and a till event.
   3. The pad (#pinModal): one keypad for both -- the sign-in, full screen on the plain page
      (lockTill), and a manager's approval, a card over the page with Cancel (gate).
   ========================================================== */

// ---------- 1. The check ----------
const pinWho = (pin) => staffByPin(pin);

// ---------- 2. The lockout ----------
const PIN_TRIES = 5;
const PIN_WAITS = [30, 60, 300];   // seconds: the first lockout, the second, every one after
const PIN_QUIET = PIN_WAITS[PIN_WAITS.length - 1] * 1000;
// A right PIN does not clear the count -- else 4 guesses + your own PIN, over and over, never
// locks. The count starts over after 5 quiet minutes: no wrong try and no wait running.
function pinLockState() {
  const s = { fails: 0, strikes: 0, until: 0, last: 0 };
  let t;
  try { t = { ...s, ...JSON.parse(HWPOS_STORE.ui.get('pinLock') || '{}') }; } catch (_) { return s; }
  const now = Date.now();
  // ponytail: the device clock -- set back, the wait is pulled in to 5 min from now (and saved, so
  // it really ends); set forward, it ends the wait early. A server time check when PINs move to the back office.
  if (t.until - now > PIN_QUIET || t.last > now) {
    t.until = Math.min(t.until, now + PIN_QUIET);
    t.last = Math.min(t.last, now);
    pinLockSave(t);
  }
  return now - Math.max(t.last, t.until) > PIN_QUIET ? s : t;
}
const pinLockSave = (s) => HWPOS_STORE.ui.set('pinLock', JSON.stringify(s));
// Seconds left.
const pinWaitLeft = () => Math.max(0, Math.ceil((pinLockState().until - Date.now()) / 1000));
// A wrong PIN. Returns the wait it started, 0 while tries are left.
function pinWrong(kind) {
  const s = pinLockState(), now = Date.now();
  s.last = now;
  if (++s.fails < PIN_TRIES) { pinLockSave(s); return 0; }
  const wait = PIN_WAITS[Math.min(s.strikes, PIN_WAITS.length - 1)];
  pinLockSave({ fails: 0, strikes: s.strikes + 1, until: now + wait * 1000, last: now });
  const row = { kind, tries: PIN_TRIES, strike: s.strikes + 1, waitSec: wait, register: String(currentStoreInfo().registerNo) };
  appendEvents('pinLockouts', [makeEvent(row, state.user?.name || '')]);
  track('pin_lockout', row);
  return wait;
}

// ---------- 3. The pad ----------
// What the pad is for: { signIn: true } (nothing closes it) or { action, again, data } (Cancel does).
let pinAsk = null;
let pinTimer = 0;
const PIN_ICON = {
  del: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>',
  go: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

function showPin(title, msg, lock = false) {
  $('#pinTitle').textContent = title;
  $('#pinMessage').textContent = msg;
  $('#pinMessage').hidden = !msg;
  $('#pinModal').classList.toggle('pin-lock', lock);
  $('#pinKeys').innerHTML ||= [...'123456789', 'del', '0', 'go'].map(k => `<button type="button" class="pin-key${k.length > 1 ? ' fn' : ''}" data-pk="${k}"${
    k === 'del' ? ' aria-label="Delete"' : k === 'go' ? ' aria-label="Enter"' : ''}>${PIN_ICON[k] || k}</button>`).join('');
  $('#pinInput').value = '';
  $('#pinDots').classList.remove('shake');   // a pad closed mid-shake never got its animationend
  pinSay('');
  $('#pinModal').hidden = false;
  document.activeElement?.blur?.();   // a focused search box behind would take the digits
  pinTick();
}
// The line under the store: "Enter PIN", or why not.
function pinSay(text) { $('#pinAskText').textContent = text || 'Enter PIN'; }
function pinDots() {
  const v = $('#pinInput').value, n = v.length > 6 ? 0 : v.length;   // past 6 = a scan, not a PIN (pinKey)
  $('#pinDots').innerHTML = Array.from({ length: Math.max(4, n) }, (_, i) => `<i${i < n ? ' class="on"' : ''}></i>`).join('');
}
// The countdown: keys off and "Too many tries · wait 0:45" until the wait is over.
function pinTick() {
  clearTimeout(pinTimer);
  const left = pinWaitLeft(), was = $('#pinModal').classList.contains('pin-wait');
  $('#pinModal').classList.toggle('pin-wait', left > 0);
  $$('#pinKeys .pin-key').forEach(b => { b.disabled = left > 0; });
  if (left > 0) {
    $('#pinInput').value = '';
    pinSay(`Too many tries · wait ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
    if (!$('#pinModal').hidden) pinTimer = setTimeout(pinTick, 1000);
  } else if (was) pinSay('');
  pinDots();
}
function pinKey(k) {
  if (!pinAsk || pinWaitLeft()) return;
  const input = $('#pinInput');
  if (k === 'go') return approveWithPin();
  if (!input.value) pinSay('');   // a new try: the last one's "Can’t approve this" goes
  // A 7th digit is a barcode scanner, not a person: the input holds 7 (no dots) until Enter or ‹
  // drops it without a try, so a scan at a locked till is never a wrong PIN. A letter or '-' (a store
  // SKU like HW-0012) is a scan too: 'scan' fills all 7 at once.
  input.value = k === 'del' ? (input.value.length > 6 ? '' : input.value.slice(0, -1)) : k === 'scan' ? '0000000' : (input.value + k).slice(0, 7);
  pinDots();
}
// Wrong: the dots shake and empty.
function pinShake(say = '') {
  $('#pinInput').value = '';
  const dots = $('#pinDots');
  dots.classList.remove('shake');
  void dots.offsetWidth;   // restart the animation on a second wrong in a row
  dots.classList.add('shake');
  pinSay(say);
  pinTick();
}

// The till's sign-in (lead default 2026-10-02, features/staff-permissions). Once anyone active has
// a till PIN the till opens on it and runs as that person: their role picks the pages and the PIN
// gates, their name and id go on every order and receipt (currentStoreInfo().cashier). No PINs yet = the owner.
// ponytail: the person lives in memory -- a reload asks for the PIN again, which a till can afford.
const tillPins = () => loadStaff().some(u => u.active && isPin(u.pin));
// The till behind the lock screen: inert (no Tab, Space or click reaches it) and run as nobody --
// no role, so the least pages and no till action -- until a PIN signs someone in.
const pinCover = (on) => $$('#app > :not(#pinModal):not(.toast)').forEach(el => { el.inert = on; });
function lockTill() {
  state.user = null;
  state.role = '';
  applyRoleGating();
  pinCover(true);
  pinAsk = { signIn: true };
  const store = currentStoreInfo();
  showPin(store.name, store.address, true);
}
function signIn(u) {
  state.user = { id: u.id, name: u.name, role: u.role };
  state.role = u.role;
  pinCover(false);
  applyRoleGating();
  renderRoleSwitcher();
  if (state.view === 'orders') renderOrders();   // the day totals follow the role's switch
  track('sign_in', { staffId: u.id });
}

// Void, refund and selling past a credit limit (owner, 2026-10-02, features/staff-permissions). A
// role whose switch is on (bo-model TILL_ACTIONS, set in the back office) goes ahead: true. Anyone
// else gets the pad and false; a manager's PIN, checked on this till with no internet, logs the
// approval with their staff id and runs `again(staffId)` -- the same action, approved.
// `note`: what the manager is approving, said first ("Mara would go ₱300.00 over …").
function gate(action, again, data = {}, note = '') {
  if (roleCan(state.role, action)) return true;
  pinAsk = { action, again, data };
  showPin('Manager PIN', `${note ? note + ' ' : ''}To ${TILL_ACTIONS[action].toLowerCase()}, a manager enters their PIN.`);
  if (!pinWaitLeft() && !loadStaff().some(u => u.active && isPin(u.pin) && roleCan(u.role, action))) pinSay('No manager PIN set yet');
  return false;
}

// → (or Enter): the PIN typed so far.
function approveWithPin() {
  if (!pinAsk || pinWaitLeft()) return;
  const pin = $('#pinInput').value.trim();
  if (!pin) return;
  if (pin.length > 6) { $('#pinInput').value = ''; return pinDots(); }   // a scan (pinKey): no try
  const who = pinWho(pin);
  if (!who) {
    pinWrong(pinAsk.signIn ? 'signIn' : pinAsk.action);
    return pinShake();
  }
  if (pinAsk.signIn) {
    pinAsk = null;
    $('#pinModal').hidden = true;
    return signIn(who);
  }
  // A real PIN, but not someone this action may be approved by: not a guess, so no strike.
  if (!roleCan(who.role, pinAsk.action)) return pinShake('Can’t approve this');
  const { action, again, data } = pinAsk;
  pinAsk = null;
  $('#pinModal').hidden = true;
  track('approval', { action, staffId: who.id, ...data });
  again(who.id);
}

// Taps on the keys, and a desk keyboard's digits / Backspace / Enter while the pad is up. Window,
// capture: the checkout's cash keys and the scanner listen on the document and must not see these.
function bindPinPad() {
  $('#pinKeys').addEventListener('click', (e) => { const b = e.target.closest('[data-pk]'); if (b) pinKey(b.dataset.pk); });
  $('#pinDots').addEventListener('animationend', (e) => e.currentTarget.classList.remove('shake'));
  window.addEventListener('keydown', (e) => {
    if ($('#pinModal').hidden || e.ctrlKey || e.metaKey || e.altKey || !/^.$|^Backspace$|^Enter$/.test(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    pinKey(e.key === 'Backspace' ? 'del' : e.key === 'Enter' ? 'go' : /\d/.test(e.key) ? e.key : 'scan');
  }, true);
  // Switch person: the name in the sidebar locks the till for the next one (only once PINs exist).
  $('.user-row')?.addEventListener('click', () => { if (tillPins()) lockTill(); });
}
