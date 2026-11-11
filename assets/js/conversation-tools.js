/* Tex 2.1.17: server-paginated media, synchronized multi-pin and ownership-safe editing. */
window.TexConversationTools = (() => {
  let E, editorFor = null;
  const pins = new Map();
  const gallery = { cid: 0, before: 0, more: true, busy: false, seq: 0, items: new Map() };
  const $ = s => document.querySelector(s);
  const date = new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bucharest' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const isPinned = m => (pins.get(+m.conversation_id) || []).some(p => +p.id === +m.id);
  const canEdit = m => !!m && +m.sender_id === +E?.S.me.id && /^\d+$/.test(String(m.id)) && !m._state && !m.deleted && !m._e2eFail && !m._captionFail && (m.type === 'text' ? (!m.meta?.e2e || !!m._dec) : !!m.attachment && ['image','video','audio','file'].includes(m.type));
  const preview = m => m.type==='buzz' && E?.buzzCaption?.(m.conversation_id)==='NIR !!!' ? 'NIR !!!' : m._e2eFail ? 'Mesaj criptat — cheia nu este disponibilă' : m.type === 'text' ? String(m.body || '').replace(/\s+/g, ' ').slice(0,140) : (m.attachment?.name || (m.type === 'p2p' ? 'Transfer P2P' : m.type === 'buzz' ? 'BUZZ!!!' : 'Mesaj')) + (m.body ? ' · ' + String(m.body).replace(/\s+/g,' ').slice(0,80) : '');
  function renderPins() {
    const list = pins.get(E.S.current) || [], bar = $('#pinnedBar');
    bar.hidden = !list.length;
    $('#pinnedCount').textContent = 'Mesaje fixate (' + list.length + ')';
    $('#pinnedItems').innerHTML = list.map(m => `<div class="pinned-item"><button class="pinned-source" data-pin-jump="${m.id}" title="Mergi la mesajul original"><b>${esc(E.nameOf(m.sender_id))}</b><span>${esc(preview(m))}${m.edited_at ? ' · editat' : ''}</span></button><button class="icon-btn small" data-unpin="${m.id}" title="Anulează fixarea" aria-label="Anulează fixarea">×</button></div>`).join('');
    document.querySelectorAll('#msgList .row[data-id] [data-a=pin]').forEach(b => { const m = b.closest('.row')._m; const on = isPinned(m); b.title = on ? 'Anulează fixarea' : 'Fixează mesajul'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(on)); });
  }
  async function loadPins(cid = E.S.current) {
    if (!cid) return;
    try { const j = await E.api(`api/conversation-tools.php?action=pins&conversation_id=${cid}`); await E.prepMany(j.messages); pins.set(+cid,j.messages); if (E.S.current === +cid) renderPins(); }
    catch (_) { /* A lost connection must not remove cached pins or claim a successful mutation. */ }
  }
  async function pin(m, value = !isPinned(m)) {
    if (!m || !/^\d+$/.test(String(m.id))) return;
    try { await E.api('api/conversation-tools.php?action=pin', { body: { conversation_id: m.conversation_id, message_id: m.id, pinned: value } }); await loadPins(m.conversation_id); }
    catch (err) { E.toast(err.message, true); }
  }
  function onUpdate(m) {
    const list = pins.get(+m.conversation_id);
    if (list?.some(p => +p.id === +m.id)) { pins.set(+m.conversation_id,list.map(p => +p.id === +m.id ? m : p)); if (E.S.current === +m.conversation_id) renderPins(); }
  }
  function edit(m) {
    if (!canEdit(m)) return;
    editorFor = { ...m }; $('#editText').value = m.body || ''; $('#editText').maxLength = m.type === 'text' ? 10000 : 2000;
    $('#editError').textContent = ''; $('#editTitle').textContent = m.type === 'text' ? 'Editează mesajul' : 'Editează descrierea fișierului';
    $('#editSave').disabled=false; E.openModal($('#messageEditor')); $('#editText').focus();
  }
  function clearEditor() { editorFor = null; $('#editText').value = ''; }
  async function saveEdit(e) {
    e.preventDefault(); if (!editorFor) return;
    const m = editorFor, text = $('#editText').value.replace(/\r\n?/g,'\n'), button = $('#editSave');
    if (m.type === 'text' && !text.trim()) { $('#editError').textContent = 'Mesajul nu poate fi gol.'; return; }
    button.disabled = true;
    try {
      const body = { conversation_id: m.conversation_id, message_id: m.id, if_revision: m.edited_revision || 0, body: text };
      if (m.meta?.e2e) {
        const sealed = await E.E2E.encryptText(E.convOf(m.conversation_id), text);
        if (!sealed?.e2e) throw new Error('E2E trebuie deblocat pentru a edita acest mesaj.');
        body.body = sealed.body; body[m.type === 'text' ? 'e2e' : 'caption_e2e'] = sealed.e2e;
      }
      const j = await E.api('api/conversation-tools.php?action=edit', { body }); await E.prep(j.message); E.onEdited(j.message);
      if (editorFor === m) { clearEditor(); E.closeModal($('#messageEditor')); }
    } catch (err) { $('#editError').textContent = err.message; }
    finally { if (editorFor === m || !editorFor) button.disabled = false; }
  }
  function stopGallery() { gallery.seq++; gallery.busy=false; gallery.pageCtrl?.abort(); window.TexGalleryPreviews?.reset(); $('#galleryViewer').replaceChildren(); }
  function navigate(cid) { if(gallery.cid && +gallery.cid!==+cid) { stopGallery(); E.closeModal($('#attachmentGallery')); } }
  function galleryRow(m) {
    const encrypted = !!m._e2eFail, p2p = m.type === 'p2p', media = ['image','video','audio'].includes(m.type);
    const name = encrypted ? 'Fișier criptat — cheia nu este disponibilă' : p2p ? (m.meta?.files || []).map(f => f.name || 'fișier').join(', ') || 'Transfer P2P' : m.attachment?.name || 'Fișier';
    return `<article class="gallery-item" data-gallery-id="${m.id}"><div><b>${esc(name)}</b><time datetime="${new Date(m.created_at*1000).toISOString()}">${esc(date.format(new Date(m.created_at*1000)))} · ${esc(E.nameOf(m.sender_id))}</time>${p2p ? '<p class="muted small">Transfer P2P: nu este arhivat pe server. Copia poate exista doar pe dispozitivul care l-a primit.</p>' : ''}${m.body && !encrypted ? '<p class="gallery-caption">'+esc(m.body)+'</p>' : ''}</div>${!p2p && !encrypted && m.attachment ? '<div class="gallery-preview" data-preview></div>' : ''}<div class="row-btns">${!p2p && !encrypted && m.attachment ? `<button class="btn primary small" data-gallery-save>Descarcă</button>` : ''}<button class="btn ghost small" data-gallery-source>Mergi la mesaj</button></div></article>`;
  }
  async function galleryMore(reset = false) {
    if (reset) { stopGallery(); gallery.before = 0; gallery.more = true; gallery.busy = false; gallery.items.clear(); $('#galleryItems').replaceChildren(); $('#galleryViewer').replaceChildren(); }
    if (gallery.busy || !gallery.more) return;
    const seq = gallery.seq, cid = gallery.cid, filter = $('#galleryFilter').value;
    gallery.busy = true; $('#galleryMore').disabled = true; $('#galleryError').textContent = '';
    try {
      gallery.pageCtrl = new AbortController();
      const j = await E.api(`api/conversation-tools.php?action=gallery&conversation_id=${cid}&filter=${encodeURIComponent(filter)}&before_id=${gallery.before}&limit=30`,{signal:gallery.pageCtrl.signal});
      await E.prepMany(j.messages); if (seq !== gallery.seq || cid !== gallery.cid) return;
      for (const m of j.messages) { if (gallery.items.has(+m.id)) continue; gallery.items.set(+m.id,m); $('#galleryItems').insertAdjacentHTML('beforeend', galleryRow(m)); window.TexGalleryPreviews?.watch($('#galleryItems').lastElementChild,m); }
      gallery.before = j.next_before; gallery.more = j.has_more;
      if (!gallery.items.size) $('#galleryItems').textContent = 'Nu există atașamente disponibile în această categorie.';
    } catch (err) { if (seq === gallery.seq) $('#galleryError').textContent = err.message; }
    finally { if (seq === gallery.seq) { gallery.busy = false; $('#galleryMore').disabled = false; $('#galleryMore').hidden = !gallery.more; } }
  }
  function openGallery() {
    gallery.cid = E.S.current; if (!gallery.cid) return;
    $('#galleryFilter').value = 'all'; E.openModal($('#attachmentGallery')); galleryMore(true);
  }
  async function galleryAction(e) {
    const row = e.target.closest('[data-gallery-id]'), m = row && gallery.items.get(+row.dataset.galleryId); if (!m) return;
    if (e.target.closest('[data-gallery-source]')) { E.closeModal($('#attachmentGallery')); if (E.S.current !== gallery.cid) await E.openConversation(gallery.cid); await E.jumpTo(m.id); return; }
    const b=e.target.closest('[data-gallery-save]'); if(!b)return;
    b.disabled=true;
    try { const url=m.meta?.e2e?await E.decryptAtt(m):m.attachment.url; await window.TexFiles.saveUrl(url,m.attachment.name); }
    catch(err){ $('#galleryError').textContent=err.message; }
    finally { b.disabled=false; }
  }

  function init(env) {
    E = env; window.TexGalleryPreviews?.init(env);
    $('#btnGallery').addEventListener('click', openGallery);
    $('#pinnedItems').addEventListener('click', e => { const j=e.target.closest('[data-pin-jump]'), u=e.target.closest('[data-unpin]'); if (j) E.jumpTo(+j.dataset.pinJump); if (u) { const m=(pins.get(E.S.current)||[]).find(m=>+m.id===+u.dataset.unpin); pin(m,false); } });
    $('#editForm').addEventListener('submit',saveEdit);
    $('#messageEditor').addEventListener('tex-modal-close',clearEditor);
    $('#attachmentGallery').addEventListener('tex-modal-close',()=> { stopGallery(); });
    $('#messageEditor').addEventListener('click',e => { if (e.target.closest('[data-close],.modal-backdrop')) { clearEditor(); E.closeModal($('#messageEditor')); } });
    $('#galleryFilter').addEventListener('change',()=>galleryMore(true)); $('#galleryMore').addEventListener('click',()=>galleryMore());
    $('#galleryItems').addEventListener('click',galleryAction);
    $('#attachmentGallery').addEventListener('click',e => { if (e.target.closest('[data-close],.modal-backdrop')) { stopGallery(); E.closeModal($('#attachmentGallery')); } });
    for (const id of ['messageEditor','attachmentGallery']) $('#'+id).addEventListener('keydown', e => { if (e.key==='Escape') { e.preventDefault(); e.stopPropagation(); E.closeModal($('#'+id)); } });
    document.addEventListener('visibilitychange',()=> { if (!document.hidden) loadPins(); });
  }
  function forget(cid) { pins.delete(+cid); if (E.S.current===+cid) renderPins(); if (gallery.cid===+cid) { stopGallery(); gallery.items.clear(); E.closeModal($('#attachmentGallery')); } if (+editorFor?.conversation_id===+cid) { clearEditor(); E.closeModal($('#messageEditor')); } }
  return { init, pin, edit, forget, canEdit, isPinned, loadPins, renderPins, onUpdate, preview, openGallery, navigate };
})();
