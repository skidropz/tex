/* Tex — lista de conversații stă mereu în dreapta, iar lățimea ei se poate trage cu mouse-ul
   (sau cu tastatura: ← → pe mâner, Home/End; dublu clic = lățimea implicită).
   Doar pe desktop; pe telefon lista rămâne pe tot ecranul. */
(function () {
  const KEY = 'tex.sidebarWidth', MIN = 248, MAX = 640;
  const root = document.documentElement;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const narrow = () => root.classList.contains('mq-narrow') || innerWidth <= 900;
  const limit = w => Math.max(MIN, Math.min(w, MAX, Math.round(innerWidth * 0.6)));
  const handle = document.createElement('div');
  handle.className = 'sb-resizer';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Lățimea listei de conversații');
  handle.tabIndex = 0;
  sidebar.appendChild(handle);

  const syncCompact = () => sidebar.classList.toggle('is-compact', sidebar.getBoundingClientRect().width < 340);
  if (window.ResizeObserver) new ResizeObserver(syncCompact).observe(sidebar);
  const apply = (w, save) => {
    w = limit(w);
    root.style.setProperty('--sb-w', w + 'px');
    handle.setAttribute('aria-valuenow', String(w));
    handle.setAttribute('aria-valuemin', String(MIN));
    handle.setAttribute('aria-valuemax', String(MAX));
    if (save) try { localStorage.setItem(KEY, String(w)); } catch (_) {}
  };
  const saved = parseInt((() => { try { return localStorage.getItem(KEY); } catch (_) { return ''; } })(), 10);
  if (saved) apply(saved, false);
  const current = () => Math.round(sidebar.getBoundingClientRect().width);

  let drag = null;
  handle.addEventListener('pointerdown', e => {
    if (narrow() || e.button) return;
    drag = { x: e.clientX, w: current() };
    handle.setPointerCapture(e.pointerId);
    root.classList.add('sb-resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!drag) return;
    apply(drag.w + (drag.x - e.clientX), false); // lista e în dreapta: tragi spre stânga ca să o lărgești
  });
  const end = e => {
    if (!drag) return;
    drag = null;
    root.classList.remove('sb-resizing');
    apply(current(), true);
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    root.style.removeProperty('--sb-w');
    try { localStorage.removeItem(KEY); } catch (_) {}
    handle.setAttribute('aria-valuenow', String(current()));
  });
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') apply(current() + step, true);
    else if (e.key === 'ArrowRight') apply(current() - step, true);
    else if (e.key === 'Home') apply(MIN, true);
    else if (e.key === 'End') apply(MAX, true);
    else return;
    e.preventDefault();
  });
  addEventListener('resize', () => { const v = parseInt(root.style.getPropertyValue('--sb-w'), 10); if (v) apply(v, false); });
})();
