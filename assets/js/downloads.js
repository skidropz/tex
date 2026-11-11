/* Tex 2.1.17: one download path for HTTP/session, decrypted blobs and P2P.
   Native bytes use an origin-restricted WebMessage port, not a URL handed to DownloadManager.
   Chunks are acknowledged after disk writes; no full-file base64 allocation. */
(function () {
  'use strict';
  if (window.TexFiles) return;
  const requests = new Map(); let seq = 0;
  const safeName = name => String(name || 'fisier').replace(/[\\/\x00-\x1f\x7f:*?"<>|]/g, '_').replace(/^\.+/, '_').trim().slice(0, 180) || 'fisier';
  const nativeAvailable = () => !!(window.TexDownload && typeof TexDownload.postMessage === 'function');
  function message(op, data) {
    if (!nativeAvailable()) return Promise.reject(new Error('Salvarea necesită aplicația Tex actualizată și Android System WebView actualizat.'));
    return new Promise((resolve, reject) => {
      const request = String(++seq);
      const timer = setTimeout(() => { requests.delete(request); reject(new Error('Salvarea nu răspunde. Reîncearcă.')); }, 30000);
      requests.set(request, { resolve, reject, timer });
      TexDownload.onmessage = e => {
        let j; try { j = JSON.parse(e.data); } catch (_) { return; }
        const p = requests.get(j.request); if (!p) return;
        requests.delete(j.request); clearTimeout(p.timer);
        if (j.error) p.reject(new Error(j.error)); else p.resolve(j);
      };
      try { TexDownload.postMessage(JSON.stringify(Object.assign({ request, op }, data))); }
      catch (e) { requests.delete(request); clearTimeout(timer); reject(e); }
    });
  }
  async function openNativeSink(info) {
    const j = await message('start', { name: safeName(info.name), mime: info.mime || 'application/octet-stream' });
    const id = j.id; let ended = false;
    return {
      async write(data) {
        const b = data instanceof Uint8Array ? data : new Uint8Array(data);
        for (let i = 0; i < b.length; i += 49152) {
          let raw = ''; const chunk = b.subarray(i, i + 49152);
          for (let k = 0; k < chunk.length; k++) raw += String.fromCharCode(chunk[k]);
          await message('write', { id, bytes: btoa(raw) });
        }
      },
      async close() { if (!ended) { await message('finish', { id }); ended = true; } },
      async abort() { if (!ended) { ended = true; await message('abort', { id }).catch(() => {}); } }
    };
  }
  function error(e) { window.dispatchEvent(new CustomEvent('tex-download-error', { detail: e.message || String(e) })); }
  async function saveUrl(url, name, mime) {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin || !['https:', 'http:', 'blob:'].includes(u.protocol)) throw new Error('Adresa de descărcare nu aparține aplicației.');
    const res = await fetch(u.href, { credentials: 'same-origin', redirect: 'error' });
    if (!res.ok) throw new Error('Descărcarea a eșuat (' + res.status + '). Verifică sesiunea.');
    if (!res.body) throw new Error('Actualizează Android System WebView pentru descărcări.');
    const type = mime || res.headers.get('Content-Type') || 'application/octet-stream';
    // Avoid saving an HTML login page in place of an attachment.
    if (!mime && /text\/html/i.test(type) && !/\.html?$/i.test(name || '')) throw new Error('Sesiunea a expirat. Autentifică-te din nou.');
    const sink = await openNativeSink({ name: name || 'fisier', mime: type.split(';')[0] });
    const reader = res.body.getReader();
    try { while (true) { const part = await reader.read(); if (part.done) break; await sink.write(part.value); } await sink.close(); }
    catch (e) { await reader.cancel().catch(() => {}); await sink.abort(); throw e; }
    finally { reader.releaseLock(); }
  }
  // Capture also programmatic a.click(), lightbox originals and E2E decrypted object URLs.
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[download]');
    if (!a || !nativeAvailable()) return;
    e.preventDefault();
    saveUrl(a.href, a.getAttribute('download') || 'fisier').catch(error);
  }, true);
  window.TexFiles = { nativeAvailable, openNativeSink, saveUrl, safeName, error };
})();
