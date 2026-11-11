/* Preserve all original controls/listeners; only reparent sections into accessible subpages. */
window.TexSettings = (() => {
  let modal, body, nav, backButton, heading, current = '', ownHistory = false, consumePop = false;
  const labels = { profile: 'Profil', appearance: 'Aspect și teme', messages: 'Mesaje', notifications: 'Notificări', presence: 'Alerte de prezență', security: 'Securitate și recuperare', account: 'Cont' };
  let transitionId = 0, pageAnimations = [];
  function show(page = '', focus = true, fromHistory = false) {
    if (!fromHistory && labels[page] && !current) { history.pushState({ ...history.state, texSettings: true }, '', location.href); ownHistory = true; }
    if (!fromHistory && !page && ownHistory) { consumePop = true; ownHistory = false; history.back(); }
    current = labels[page] ? page : '';
    const target = current, id = ++transitionId;
    pageAnimations.forEach(a => a.cancel()); pageAnimations = [];
    const old = nav.hidden ? body.querySelector('[data-settings-page]:not([hidden])') : nav;
    const next = target ? body.querySelector('[data-settings-page="' + target + '"]') : nav;
    const animated = focus && !modal.hidden && old && next && old !== next && typeof old.animate === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    function apply() {
      if (id !== transitionId) return;
      body.querySelectorAll('[data-settings-page]').forEach(p => { p.hidden = p.dataset.settingsPage !== target; });
      nav.hidden = !!target; backButton.hidden = !target; heading.textContent = labels[target] || 'Setări';
      body.scrollTop = 0; body.removeAttribute('aria-busy'); body.classList.remove('settings-changing');
      if (focus) (target ? next?.querySelector('h4') : nav.querySelector('[data-settings-go]'))?.focus({ preventScroll: true });
      if (animated) {
        const enter = next.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 150, easing: 'ease-out' });
        pageAnimations.push(enter); enter.finished.then(() => { if (id === transitionId) pageAnimations = []; }, () => {});
      }
    }
    if (animated) {
      body.setAttribute('aria-busy', 'true'); body.classList.add('settings-changing');
      const exit = old.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 90, easing: 'ease-in' });
      pageAnimations.push(exit); exit.finished.then(apply, () => {});
    } else apply();
  }
  function init(el) {
    modal = el; body = el.querySelector('.modal-body'); heading = el.querySelector('.modal-head h3');
    nav = document.createElement('nav'); nav.className = 'settings-nav'; nav.setAttribute('aria-label', 'Categorii setări');
    for (const [id, name] of Object.entries(labels)) { const b = document.createElement('button'); b.type = 'button'; b.className = 'settings-link'; b.dataset.settingsGo = id; b.textContent = name; nav.append(b); }
    const groups = new Map();
    for (const section of [...body.querySelectorAll(':scope > .set-sec')]) {
      const h = section.querySelector('h4')?.textContent || '';
      const id = section.dataset.settingsCategory || (/Profil|Status/.test(h) ? 'profile' : /Mod|Teme|Palete|Culori|Zoom/.test(h) ? 'appearance' : /Securitate|recuperare/.test(h) ? 'security' : /Alerte/.test(h) ? 'presence' : /Notificări/.test(h) ? 'notifications' : /Altele/.test(h) ? 'messages' : 'account');
      if (!groups.has(id)) { const page = document.createElement('div'); page.dataset.settingsPage = id; page.className = 'settings-page'; groups.set(id, page); }
      const title = section.querySelector('h4'); if (title) title.tabIndex = -1;
      groups.get(id).append(section);
    }
    body.prepend(nav); for (const page of groups.values()) body.append(page);
    backButton = document.createElement('button'); backButton.type = 'button'; backButton.className = 'btn ghost'; backButton.id = 'settingsBack'; backButton.textContent = 'Înapoi'; backButton.addEventListener('click', () => show());
    el.querySelector('.modal-head').prepend(backButton);
    nav.addEventListener('click', e => { const b = e.target.closest('[data-settings-go]'); if (b) show(b.dataset.settingsGo); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && current) { e.preventDefault(); e.stopPropagation(); show(); } });
    window.addEventListener('popstate', e => {
      if (consumePop) { consumePop = false; e.stopImmediatePropagation(); return; }
      if (ownHistory && current) { ownHistory = false; show('', true, true); e.stopImmediatePropagation(); }
    });
    show('', false);
  }
  function back() { if (modal && !modal.hidden && current && [...document.querySelectorAll('.modal:not([hidden])')].at(-1) === modal) { show(); return true; } return false; }
  function dismiss() { if (ownHistory) { consumePop = true; ownHistory = false; history.back(); } show('', false, true); }
  return { init, show, back, dismiss, get current() { return current; } };
})();
