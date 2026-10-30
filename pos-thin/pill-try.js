// pos-thin (owner 2026-10-29) — the sidebar's Pills knobs.
// The two bar controls (the Items switch and Reports' Day | Week | Month capsule) read
// --try-pill-h / --try-pill-fs / --try-pill-side, declared at the end of styles.css. This
// file only moves those numbers and remembers them on this device (HWPOS_STORE.ui, so the
// app's own storage rules still hold). A link can carry a state for a screenshot:
//   index.html#reports?pills=28,12.5,20     (height, words, sides)
//   index.html?knobs                        opens the sidebar on load
(() => {
  const root = document.documentElement;
  const ui = window.HWPOS_STORE && window.HWPOS_STORE.ui;
  const params = new URLSearchParams(location.search);

  const fields = [
    { id: 'ptH', out: 'ptHV', key: 'pillTry.h', css: '--try-pill-h', unit: 'px', min: 22, max: 44 },
    { id: 'ptFs', out: 'ptFsV', key: 'pillTry.fs', css: '--try-pill-fs', unit: 'px', min: 10, max: 16 },
    { id: 'ptSide', out: 'ptSideV', key: 'pillTry.side', css: '--try-pill-side', unit: 'px', min: 8, max: 32 },
  ].map((f) => ({ ...f, input: document.getElementById(f.id), outEl: document.getElementById(f.out) }))
    .filter((f) => f.input);

  if (!fields.length) return;   // another page's copy: nothing to wire

  // a saved value wins, else the page's own default (?pills=... wins over both, for a shot)
  const linked = (params.get('pills') || '').split(',').map((v) => parseFloat(v));
  fields.forEach((f, i) => {
    const saved = ui ? parseFloat(ui.get(f.key)) : NaN;
    const value = Number.isFinite(linked[i]) ? linked[i] : Number.isFinite(saved) ? saved : parseFloat(f.input.value);
    f.input.value = String(value);
  });

  // A pill that has already slid keeps its old --x / --w, which the new height and word size
  // move out from under it. Dropping .slid puts the pick back on the tab's own background, the
  // way it looks before the first switch (pos-items.js slidePill's own rule).
  const unsettle = () => document.querySelectorAll('.kinds.slid').forEach((box) => {
    box.classList.remove('slid');
    box.style.removeProperty('--x');
    box.style.removeProperty('--w');
  });

  const apply = () => {
    fields.forEach((f) => {
      const value = parseFloat(f.input.value);
      root.style.setProperty(f.css, value + f.unit);
      if (f.outEl) f.outEl.textContent = Number.isInteger(value) ? String(value) : value.toFixed(1);
    });
    unsettle();
  };

  fields.forEach((f) => {
    f.input.addEventListener('input', apply);
    f.input.addEventListener('change', () => { if (ui) ui.set(f.key, f.input.value); });
  });

  apply();

  // ?knobs — the sidebar open on load, so the knobs (or a screenshot of them) are there without a tap.
  // Late enough to land after the first-load "What do you sell?" card, which makes the app inert.
  if (params.has('knobs')) setTimeout(() => document.querySelector('[data-act="open-sidebar"]')?.click(), 900);

  // ?shot — only for screenshots: answer the one-time "What do you sell?" card so the page behind it shows
  if (params.has('shot')) setTimeout(() => document.querySelector('.rail-veil [data-v]')?.click(), 600);

  // ?theme=light|dark|system — the same call Settings' toggle makes, so a shot can be taken in either
  const theme = params.get('theme');
  if (theme && /^(light|dark|system)$/.test(theme) && typeof window.applyTheme === 'function') window.applyTheme(theme);
})();
