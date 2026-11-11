/* Local static document: no telemetry, requests, consent assumption or auth changes. */
(() => {
  'use strict';
  const dialog = document.getElementById('legalDialog');
  const opener = document.getElementById('legalOpen');
  const close = document.getElementById('legalClose');
  if (!dialog || !opener || !close) return;
  const region = dialog.querySelector('.legal-body');
  let active = false, previous = null, scrollY = 0, savedStyles = null, backgrounds = [];
  function focusable() {
    return [...dialog.querySelectorAll('a[href],button:not([disabled]),[tabindex="0"]')].filter(el => el.getClientRects().length);
  }
  function fitViewport() {
    const viewport = window.visualViewport;
    dialog.style.setProperty('--legal-height', Math.round(viewport ? viewport.height : window.innerHeight) + 'px');
    dialog.style.setProperty('--legal-top', Math.round(viewport ? viewport.offsetTop : 0) + 'px');
  }
  function show(event) {
    if (event) event.preventDefault();
    if (active) return;
    previous = document.activeElement;
    scrollY = window.scrollY;
    savedStyles = {};
    for (const key of ['position','top','left','width','overflow']) savedStyles[key] = document.body.style[key];
    Object.assign(document.body.style, { position:'fixed', top:-scrollY + 'px', left:'0', width:'100%', overflow:'hidden' });
    active = true; dialog.hidden = false; opener.setAttribute('aria-expanded', 'true');
    fitViewport();
    window.addEventListener('resize', fitViewport);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitViewport);
    region.scrollTop = 0;
    close.focus({ preventScroll:true });
    backgrounds = [...document.querySelectorAll('.login-stage,#forgotDialog')].map(el => ({ el, hidden:el.getAttribute('aria-hidden'), inert:el.inert }));
    for (const entry of backgrounds) { entry.el.setAttribute('aria-hidden', 'true'); if ('inert' in entry.el) entry.el.inert = true; }
  }
  function hide() {
    if (!active) return;
    active = false;
    window.removeEventListener('resize', fitViewport);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', fitViewport);
    for (const entry of backgrounds) { if (entry.hidden === null) entry.el.removeAttribute('aria-hidden'); else entry.el.setAttribute('aria-hidden', entry.hidden); if ('inert' in entry.el) entry.el.inert = entry.inert; }
    backgrounds = []; dialog.hidden = true; opener.setAttribute('aria-expanded', 'false');
    Object.assign(document.body.style, savedStyles);
    window.scrollTo(0, scrollY);
    if (previous && previous.isConnected) previous.focus({ preventScroll:true });
  }
  opener.addEventListener('click', show);
  close.addEventListener('click', hide);
  // Backdrop mouse/touch click is deliberate; text selection inside does not close it.
  let backdropDown = false;
  dialog.addEventListener('pointerdown', e => { backdropDown = e.target === dialog; });
  dialog.addEventListener('pointercancel', () => { backdropDown = false; });
  dialog.addEventListener('click', e => { if (e.target === dialog && backdropDown) hide(); backdropDown = false; });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); return; }
    if (e.key !== 'Tab') return;
    const items = focusable(), first = items[0], last = items[items.length - 1];
    if (!first) { e.preventDefault(); close.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  document.addEventListener('focusin', e => { if (active && !dialog.contains(e.target)) close.focus({ preventScroll:true }); });
  region.addEventListener('click', e => {
    const link = e.target.closest('a[href^="#legal-"]');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target || !region.contains(target)) return;
    e.preventDefault(); region.scrollTop += target.getBoundingClientRect().top - region.getBoundingClientRect().top - 12;
    target.setAttribute('tabindex', '-1'); target.focus({ preventScroll:true });
  });
})();
