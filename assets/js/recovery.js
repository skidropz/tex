/* Recovery secrets are transient input values only, never local/session storage or logs. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  async function api(action, values = {}) {
    if (window.APP?.me && window.TexSession?.request) return window.TexSession.request('api/recovery.php?action=' + action, { body: values });
    const r = await fetch('api/recovery.php?action=' + action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': $('meta[name=csrf-token]').content }, body: JSON.stringify(values) });
    const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Operația a eșuat.'); return j;
  }
  function busy(form, on) { form.querySelectorAll('button').forEach(b => { b.disabled = on; }); }
  const setup = $('#recoverySetup');
  if (setup) {
    let configured = false;
    const uid = window.APP?.me?.id;
    const dismissKey = 'tex.recovery-invite.' + uid;
    const info = $('#recoveryInfo'), invite = $('#recoveryInvite');
    setup.addEventListener('submit', async e => {
      e.preventDefault(); busy(setup, true); info.textContent = '';
      try {
        const values = Object.fromEntries(new FormData(setup)); await api('setup', values);
        setup.reset(); configured = true; info.textContent = 'Întrebarea de recuperare a fost salvată. Răspunsul nu este afișat niciodată.';
        invite.hidden = true;
      } catch (err) { info.textContent = err.message; }
      finally { busy(setup, false); }
    });
    invite.addEventListener('keydown', e => { if (e.key==='Escape') { e.stopPropagation(); $('#recoveryLater').click(); } });
    $('#recoveryLater').addEventListener('click', () => { invite.hidden = true; try { localStorage.setItem(dismissKey, String(Date.now() + 30 * 86400000)); } catch (_) {} });
    $('#recoveryConfigure').addEventListener('click', () => {
      invite.hidden = true; $('#btnSettings').click(); window.TexSettings.show('security'); $('#recoveryQuestion').focus();
    });
    // Once at boot, never on every render; a dismissal lasts 30 days on this account/device.
    api('status').then(j => {
      configured = j.configured;
      info.textContent = configured ? 'Recuperarea este configurată. Poți înlocui întrebarea și răspunsul, cu parola curentă.' : 'Recuperarea nu este încă configurată.';
      let dismissed = 0; try { dismissed = +localStorage.getItem(dismissKey) || 0; } catch (_) {}
      if (!configured && dismissed < Date.now()) { invite.hidden = false; try { localStorage.setItem(dismissKey, String(Date.now() + 30 * 86400000)); } catch (_) {} }
    }).catch(() => { info.textContent = 'Nu am putut verifica recuperarea. Reîncarcă pentru a reîncerca.'; });
  }
  const dialog = $('#forgotDialog');
  if (!dialog) return;
  let challenge = '', grant = '';
  const error = $('#forgotError');
  function clear() { challenge = ''; grant = ''; dialog.querySelectorAll('form').forEach(f => f.reset()); $('#forgotLookup').hidden = false; $('#forgotVerify').hidden = true; $('#forgotReset').hidden = true; $('#forgotQuestion').textContent = ''; error.textContent = ''; }
  $('#forgotOpen').addEventListener('click', () => { clear(); dialog.hidden = false; $('#forgotLogin').value = $('#loginForm [name=login]').value; $('#forgotLogin').focus(); });
  $('#forgotClose').addEventListener('click', () => { dialog.hidden = true; clear(); $('#forgotOpen').focus(); });
  dialog.addEventListener('keydown', e => { if (e.key === 'Escape') $('#forgotClose').click(); });
  $('#forgotLookup').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget; busy(form, true); error.textContent = '';
    try { const j = await api('question', { login: $('#forgotLogin').value }); challenge = j.challenge; $('#forgotQuestion').textContent = j.question; form.hidden = true; $('#forgotVerify').hidden = false; $('#forgotAnswer').focus(); }
    catch (err) { error.textContent = err.message; } finally { busy(form, false); }
  });
  $('#forgotVerify').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget; busy(form, true); error.textContent = '';
    try { const j = await api('verify', { challenge, answer: $('#forgotAnswer').value }); $('#forgotAnswer').value = ''; grant = j.grant; challenge = ''; form.hidden = true; $('#forgotReset').hidden = false; $('#forgotPassword').focus(); }
    catch (err) { error.textContent = err.message; $('#forgotAnswer').value = ''; } finally { busy(form, false); }
  });
  $('#forgotReset').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.currentTarget; busy(form, true); error.textContent = '';
    try {
      if ($('#forgotPassword').value !== $('#forgotConfirm').value) throw new Error('Parolele nu coincid.');
      await api('reset', { grant, password: $('#forgotPassword').value, ack_e2e: $('#forgotAck').checked });
      clear(); dialog.hidden = true;
      $('#loginForm [name=password]').value=''; $('#loginForm [name=password]').focus();
      $('#err').textContent = 'Parola de conectare a fost resetată. Cheia E2E păstrează parola veche; istoricul nu a fost șters sau recuperat prin resetare.'; $('#err').classList.add('show');
    } catch (err) { error.textContent = err.message; } finally { busy(form, false); }
  });
})();
