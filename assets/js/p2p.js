/* =========================================================================
   P2P file transfer — WebRTC DataChannel, semnalizare prin backend PHP (long-poll).
   Fișierele NU trec prin server => fără limită de mărime.
   Recepție: File System Access API (scriere directă pe disc) -> Service Worker stream
   (download în flux) -> memorie (Blob) ca ultimă variantă.
   ========================================================================= */
window.P2P = (() => {
  'use strict';
  let ctx = null;
  const T = new Map();               // transfer_id -> transfer
  const TAB = Math.random().toString(36).slice(2, 10);
  const READ_BLOCK = 1024 * 1024;    // citim fișierul în blocuri de 1MB
  const HIGH_WATER = 8 * 1024 * 1024;
  const LOW_WATER = 1024 * 1024;
  const WINDOW = 32 * 1024 * 1024;   // max bytes ne-confirmate (flow control)
  const ACK_EVERY = 2 * 1024 * 1024;
  let swReg = null;

  const rnd = (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = b => { if (b < 1024) return b + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1); return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i]; };
  const fmtDur = s => { if (!isFinite(s) || s < 0) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  function init(c) {
    ctx = c;
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('sw.js?v=2.1.32', { scope: './' }).then(() => navigator.serviceWorker.ready).then(r => { swReg = r; }).catch(e => console.warn('SW', e));
    }
    window.addEventListener('beforeunload', e => {
      for (const t of T.values()) {
        if (t.role === 'sender' && ['waiting', 'connecting', 'transferring'].includes(t.state)) { e.preventDefault(); e.returnValue = ''; return ''; }
        if (t.role === 'receiver' && ['connecting', 'transferring'].includes(t.state)) { e.preventDefault(); e.returnValue = ''; return ''; }
      }
    });
  }

  const supported = () => 'RTCPeerConnection' in window;

  /* ---------------- semnalizare ---------------- */
  // v2.0: SDP + ICE sunt cifrate E2E cu cheia conversației => serverul nu poate înlocui amprenta DTLS (fără MITM)
  const SECRET_KINDS = ['offer', 'answer', 'ice'];
  async function signal(t, kind, data = {}, required = false) {
    const payload = { fromTab: TAB, toTab: t.peerTab || null };
    if (SECRET_KINDS.includes(kind) && ctx.encSignal && t.convId) {
      let enc = null;
      try { enc = await ctx.encSignal(t.convId, data); } catch (e) { console.warn('E2E signal', e); }
      if (enc) payload.enc = enc; else Object.assign(payload, data);
    } else Object.assign(payload, data);
    return ctx.api('api/signal.php?action=signal', {
      body: { to_user_id: t.peer, transfer_id: t.tid, message_id: t.msgId, kind, data: payload }
    }).catch(e => { if (required) throw e; console.warn('signal', kind, e); });
  }
  function setStatus(t, status) {
    if (!t.msgId) return;
    ctx.api('api/signal.php?action=status', { body: { message_id: t.msgId, status } }).then(j => ctx.upsert(j.message)).catch(() => {});
  }

  /* ---------------- expeditor ---------------- */
  async function sendFiles(convId, files, replyTo) {
    if(ctx.isBlocked?.(convId)){ctx.toast('Comunicarea directă este oprită, pentru că ai ignorat acest contact.',true);return;}
    if (!supported()) { ctx.toast('Browserul nu suportă WebRTC. Trimit prin server.', true); return ctx.uploadFiles(files, convId); }
    files = Array.from(files);
    if (!files.length) return;
    if (ctx.isGroup && ctx.isGroup(convId)) { ctx.toast('În grupuri fișierele se trimit prin server (P2P e doar 1:1).'); return ctx.uploadFiles(files, convId); }
    const peer = ctx.peerOf(convId);
    const tid = rnd(20);
    const t = { tid, role: 'sender', convId, peer: peer.id, files, total: files.reduce((a, f) => a + f.size, 0), state: 'waiting', bytes: 0, acked: 0, sent: 0 };
    T.set(tid, t);
    try {
      const real = files.map(f => ({ name: f.name, size: f.size, mime: f.type || 'application/octet-stream' }));
      let e2e = null;
      try { e2e = ctx.encMeta ? await ctx.encMeta(convId, { files: real }) : null; } catch (_) {}
      const j = await ctx.api('api/signal.php?action=offer', {
        body: { conversation_id: convId, transfer_id: tid, client_uid: 'p2p' + tid, reply_to_id: replyTo || null, e2e,
          files: e2e ? real.map(f => ({ name: 'fisier-criptat', size: f.size, mime: 'application/octet-stream' })) : real }
      });
      t.msgId = j.message.id;
      ctx.upsert(j.message);
      ctx.toast('⚡ Oferta P2P a fost trimisă. Ține pagina deschisă până se termină transferul.');
    } catch (e) { T.delete(tid); ctx.toast(e.message, true); }
  }

  function newPC(t) {
    const pc = new RTCPeerConnection({ iceServers: ctx.iceServers || [] });
    t.pc = pc; t.iceQueue = t.iceQueue || []; t.iceOut = [];
    pc.onicecandidate = e => {
      if (!e.candidate) return;
      t.iceOut.push(e.candidate.toJSON());
      clearTimeout(t.iceTimer);
      t.iceTimer = setTimeout(() => { const c = t.iceOut.splice(0); if (c.length) signal(t, 'ice', { candidates: c }); }, 120);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') fail(t, 'Conexiunea directă P2P a eșuat (rețea sau firewall restrictiv). Poți trimite prin server.');
      if (pc.connectionState === 'disconnected' && t.state === 'transferring') {
        setTimeout(() => { if (pc.connectionState !== 'connected' && t.state === 'transferring') fail(t, 'Conexiunea s-a întrerupt.'); }, 6000);
      }
    };
    clearTimeout(t.connectTimer);
    t.connectTimer = setTimeout(() => { if (t.state === 'connecting') fail(t, 'Conexiunea P2P nu s-a stabilit în 30 de secunde (poate rețeaua este restrictivă).'); }, 30000);
    return pc;
  }

  async function addIce(t, list) {
    for (const c of list || []) {
      if (t.pc && t.pc.remoteDescription) { try { await t.pc.addIceCandidate(c); } catch (e) { console.warn(e); } }
      else (t.iceQueue = t.iceQueue || []).push(c);
    }
  }
  async function flushIce(t) { const q = (t.iceQueue || []).splice(0); for (const c of q) { try { await t.pc.addIceCandidate(c); } catch (e) {} } }

  async function startSender(t) {
    t.state = 'connecting'; render(t);
    const pc = newPC(t);
    const dc = pc.createDataChannel('file', { ordered: true });
    dc.binaryType = 'arraybuffer';
    t.dc = dc;
    dc.onopen = () => sendLoop(t).catch(e => fail(t, 'Eroare la trimitere: ' + e.message));
    dc.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'ack') {
        t.acked = m.bytes; t.bytes = m.bytes;
        (t.ackWaiters || []).splice(0).forEach(r => r());
        progress(t);
        if (m.done) finish(t);
      } else if (m.t === 'cancel') { cancelLocal(t, 'Anulat de destinatar'); }
    };
    dc.onclose = () => { if (t.state === 'transferring') fail(t, 'Canalul de date s-a închis.'); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal(t, 'offer', { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
  }

  function waitLow(dc) { return new Promise(r => { const h = () => { dc.removeEventListener('bufferedamountlow', h); r(); }; dc.addEventListener('bufferedamountlow', h); }); }
  function waitAck(t) { return new Promise(r => { (t.ackWaiters = t.ackWaiters || []).push(r); setTimeout(r, 2000); }); }

  async function sendLoop(t) {
    clearTimeout(t.connectTimer);
    t.state = 'transferring'; t.start = performance.now(); render(t);
    const dc = t.dc;
    dc.bufferedAmountLowThreshold = LOW_WATER;
    let max = (t.pc.sctp && t.pc.sctp.maxMessageSize) || 65536;
    if (!max || max > 65536) max = 65536;
    const chunk = Math.max(16384, max);
    for (let i = 0; i < t.files.length; i++) {
      const f = t.files[i];
      dc.send(JSON.stringify({ t: 'file', i, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' }));
      let off = 0;
      while (off < f.size) {
        if (t.state !== 'transferring') return;
        const buf = await f.slice(off, Math.min(off + READ_BLOCK, f.size)).arrayBuffer();
        for (let p = 0; p < buf.byteLength; p += chunk) {
          if (t.state !== 'transferring') return;
          while (dc.bufferedAmount > HIGH_WATER) await waitLow(dc);
          while (t.sent - t.acked > WINDOW && t.state === 'transferring') await waitAck(t);
          const part = buf.slice(p, p + chunk);
          dc.send(part);
          t.sent += part.byteLength;
        }
        off += buf.byteLength;
      }
      dc.send(JSON.stringify({ t: 'eof', i }));
    }
    dc.send(JSON.stringify({ t: 'done' }));
  }

  function finish(t) {
    if (t.state === 'done') return;
    t.state = 'done'; t.bytes = t.total;
    clearTimeout(t.connectTimer);
    render(t);
    if (t.role === 'sender') setStatus(t, 'completed');
    setTimeout(() => { try { t.pc && t.pc.close(); } catch (_) {} }, 1500);
  }

  /* ---------------- destinatar ---------------- */
  const accepting = new Set();
  async function accept(m) {
    if(ctx.isBlocked?.(m.conversation_id)){ctx.toast('Comunicarea directă este oprită, pentru că ai ignorat acest contact.',true);return;}
    const tid = m.meta && m.meta.transfer_id;
    if (accepting.has(tid)) return;
    accepting.add(tid);
    try { return await accept0(m); } finally { accepting.delete(tid); }
  }
  async function accept0(m) {
    const meta = m.meta || {};
    const files = meta.files || [];
    const tid = meta.transfer_id;
    if (!supported()) { ctx.toast('Browserul nu suportă WebRTC.', true); return; }
    if (!tid || !files.length) { ctx.toast('Oferta nu mai este disponibilă. Cere să ți se trimită din nou fișierul.', true); return; }
    if (T.has(tid) && ['connecting', 'transferring'].includes(T.get(tid).state)) return;
    const t = { tid, role: 'receiver', convId: m.conversation_id, peer: m.sender_id, msgId: m.id, meta: files, total: files.reduce((a, f) => a + f.size, 0), state: 'connecting', bytes: 0, saved: [], sinkMode: 'memory' };
    // alegem unde scriem (trebuie apelat direct din gestul utilizatorului)
    try {
      if (window.TexFiles && TexFiles.nativeAvailable()) {
        t.sinkMode = 'native';
      } else if (files.length === 1 && window.showSaveFilePicker) {
        t.fileHandles = [await window.showSaveFilePicker({ suggestedName: files[0].name })];
        t.sinkMode = 'disk';
      } else if (files.length > 1 && window.showDirectoryPicker) {
        t.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        t.sinkMode = 'disk';
      } else if (swReg && swReg.active && navigator.serviceWorker.controller && !window.AndroidBridge && !/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        t.sinkMode = 'stream';
      } else if (t.total > 256 * 1024 ** 2 && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
        ctx.toast('Pentru fișiere de peste 256 MB pe telefon, folosește aplicația Tex actualizată sau cere să ți se trimită prin server.', true); return;
      } else if (t.total > 1.5 * 1024 ** 3) {
        if (!confirm('Browserul tău nu poate scrie direct pe disc; fișierul (' + fmtSize(t.total) + ') va fi ținut în memorie până la final. Continui?')) return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // utilizatorul a anulat dialogul
      console.warn(e);
    }
    // A picker can exist but reject on mobile WebView; re-check the memory fallback.
    if (t.sinkMode === 'memory' && t.total > 256 * 1024 ** 2 && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      ctx.toast('Fișierul este prea mare pentru memoria browserului. Instalează aplicația Tex actualizată sau cere să ți se trimită prin server.', true); return;
    }
    if(ctx.isBlocked?.(m.conversation_id)){cancelLocal(t,'Contact ignorat');return;}
    T.set(tid, t);
    render(t);
    try { await signal(t, 'accept', {}, true); }
    catch (e) { fail(t, 'Acceptarea nu a ajuns la expeditor: ' + e.message); return; }
    if (t.pc) return; // an offer can arrive while the accept API call is still resolving
    clearTimeout(t.connectTimer);
    t.connectTimer = setTimeout(() => {
      if (t.state === 'connecting' && !t.pc) fail(t, 'Expeditorul nu răspunde. Trebuie să țină pagina deschisă (fișierul se află doar în browserul lui).');
    }, 20000);
  }

  async function onOffer(t, sdp) {
    const pc = newPC(t);
    pc.ondatachannel = e => setupRecv(t, e.channel);
    await pc.setRemoteDescription(sdp);
    await flushIce(t);
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    signal(t, 'answer', { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
  }

  const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|opus|m4a|aac|flac|weba)$/i;
  const isAudio = f => !!f && (/^audio\//.test(f.mime || f.type || '') || AUDIO_EXT.test(f.name || ''));
  const TEE_MAX = 200 * 1024 * 1024;
  /** v2.0: pentru wav/mp3 & co. păstrăm o copie în memorie (≤200 MB) => buton ▶ Play în bulă */
  async function openSink(t, info) {
    const sink = await openSink0(t, info);
    if (!isAudio(info) || info.size > TEE_MAX || t.sinkMode === 'memory' || (t.sinkMode === 'native' && info.size > 16 * 1024 * 1024)) return sink;
    const parts = [];
    return {
      write: b => { parts.push(b.slice ? b.slice(0) : b); return sink.write(b); },
      close: async () => {
        await sink.close();
        t.playable = t.playable || {};
        t.playable[info.i] = URL.createObjectURL(new Blob(parts, { type: playMime(info) }));
        parts.length = 0;
      },
      abort: () => { parts.length = 0; return sink.abort(); },
    };
  }
  function playMime(f) {
    if (/^audio\//.test(f.mime || '')) return f.mime;
    const ext = String(f.name || '').split('.').pop().toLowerCase();
    return ({ mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm' })[ext] || 'audio/mpeg';
  }
  async function openSink0(t, info) {
    info = Object.assign({}, info, { name: window.TexFiles ? TexFiles.safeName(info.name) : String(info.name).replace(/[\\/\x00-\x1f]/g, '_') });
    if (t.sinkMode === 'native') return TexFiles.openNativeSink(info);
    if (t.sinkMode === 'disk') {
      let handle = t.fileHandles && t.fileHandles[info.i];
      if (!handle && t.dirHandle) handle = await t.dirHandle.getFileHandle(info.name.replace(/[\\/:*?"<>|]/g, '_'), { create: true });
      if (handle) {
        const w = await handle.createWritable();
        return { write: b => w.write(b), close: () => w.close(), abort: () => w.abort().catch(() => {}) };
      }
    }
    if (t.sinkMode === 'stream' && swReg && swReg.active) {
      try { return await swSink(info); } catch (e) { t.sinkMode = 'memory'; console.warn('SW sink', e); }
    }
    const parts = [];
    return {
      write: b => { parts.push(b); },
      close: async () => {
        const blob = new Blob(parts, { type: info.mime || 'application/octet-stream' });
        parts.length = 0;
        const url = URL.createObjectURL(blob);
        t.saved.push({ name: info.name, url, mime: info.mime });
        if (isAudio(info)) { t.playable = t.playable || {}; t.playable[info.i] = URL.createObjectURL(new Blob([blob], { type: playMime(info) })); }
        // Mobile browsers may block automatic downloads after an asynchronous transfer.
        // Keep the explicit download link; desktop retains auto-save behavior.
        if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) {
          const a = document.createElement('a'); a.href = url; a.download = info.name; document.body.appendChild(a); a.click(); a.remove();
        }
      },
      abort: () => { parts.length = 0; }
    };
  }

  function swSink(info) {
    return new Promise((resolve, reject) => {
      const id = rnd(16);
      const ch = new MessageChannel();
      const to = setTimeout(() => reject(new Error('SW timeout')), 4000);
      ch.port1.onmessage = e => {
        if (e.data && e.data.type === 'ready') {
          clearTimeout(to);
          const ifr = document.createElement('iframe');
          ifr.hidden = true;
          ifr.src = 'p2p-dl/' + id + '/' + encodeURIComponent(info.name);
          document.body.appendChild(ifr);
          resolve({
            write: b => ch.port1.postMessage(b, [b]),
            close: () => { ch.port1.postMessage('end'); setTimeout(() => ifr.remove(), 30000); },
            abort: () => { ch.port1.postMessage('abort'); setTimeout(() => ifr.remove(), 1000); }
          });
        }
      };
      swReg.active.postMessage({ type: 'stream', id, name: info.name, size: info.size, mime: info.mime }, [ch.port2]);
    });
  }

  function setupRecv(t, dc) {
    dc.binaryType = 'arraybuffer';
    t.dc = dc;
    t.chain = Promise.resolve();
    t.lastAck = 0;
    dc.onopen = () => { clearTimeout(t.connectTimer); t.state = 'transferring'; t.start = performance.now(); render(t); };
    if (dc.readyState === 'open') dc.onopen();
    dc.onmessage = e => {
      const data = e.data;
      t.chain = t.chain.then(() => handleRecv(t, data)).catch(err => fail(t, 'Eroare la salvare: ' + err.message));
    };
    dc.onclose = () => { if (t.state === 'transferring') fail(t, 'Canalul de date s-a închis.'); };
  }

  async function handleRecv(t, data) {
    if (t.state === 'failed' || t.state === 'cancelled') return;
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (m.t === 'file') {
        if (t.sink || m.i !== (t.nextFile || 0) || !t.meta[m.i] || !Number.isSafeInteger(m.size) || m.size < 0 || m.size !== t.meta[m.i].size) throw new Error('Metadatele fișierului nu corespund ofertei.');
        t.cur = m; t.fileBytes = 0; t.sink = await openSink(t, m);
        if (['failed', 'cancelled'].includes(t.state)) { await t.sink.abort(); t.sink = null; return; }
        t.fileIndex = m.i; render(t);
      }
      else if (m.t === 'eof') { if (!t.sink || m.i !== t.fileIndex || t.fileBytes !== t.cur.size) throw new Error('Fișier incomplet. Cere să ți se trimită din nou.'); await t.sink.close(); t.sink = null; t.nextFile = m.i + 1; render(t); }
      else if (m.t === 'done') { if (t.sink || t.nextFile !== t.meta.length || t.bytes !== t.total) throw new Error('Transfer incomplet.'); t.dc.send(JSON.stringify({ t: 'ack', bytes: t.bytes, done: true })); finish(t); }
      else if (m.t === 'cancel') { cancelLocal(t, 'Anulat de expeditor'); }
      return;
    }
    if (!t.sink) return;
    if (t.fileBytes + data.byteLength > t.cur.size) throw new Error('Fișierul depășește mărimea acceptată.');
    await t.sink.write(data);
    t.fileBytes += data.byteLength;
    t.bytes += data.byteLength;
    if (t.bytes - t.lastAck >= ACK_EVERY) { t.lastAck = t.bytes; try { t.dc.send(JSON.stringify({ t: 'ack', bytes: t.bytes })); } catch (_) {} }
    progress(t);
  }

  /* ---------------- comune ---------------- */
  function fail(t, msg) {
    if (['done', 'failed', 'cancelled'].includes(t.state)) return;
    t.state = 'failed'; t.error = msg;
    clearTimeout(t.connectTimer);
    try { t.sink && t.sink.abort(); } catch (_) {}
    try { t.pc && t.pc.close(); } catch (_) {}
    render(t);
  }
  function cancelLocal(t, reason) {
    if (['done', 'cancelled'].includes(t.state)) return;
    t.state = 'cancelled'; t.error = reason || 'Anulat';
    clearTimeout(t.connectTimer);
    try { t.sink && t.sink.abort(); } catch (_) {}
    try { t.pc && t.pc.close(); } catch (_) {}
    render(t);
  }
  function cancel(t) {
    try { t.dc && t.dc.readyState === 'open' && t.dc.send(JSON.stringify({ t: 'cancel' })); } catch (_) {}
    if (t.peer) signal(t, 'cancel');
    cancelLocal(t, 'Anulat');
    setStatus(t, 'cancelled');
  }

  async function onSignal(ev) {
    let d = ev.data || {};
    const tid = ev.transfer_id;
    const t = T.get(tid);
    if (d.toTab && d.toTab !== TAB) return; // semnal pentru alt tab
    if (!t) return;
    if (t.peer && ev.from !== t.peer) return;
    if (SECRET_KINDS.includes(ev.kind)) {
      if (d.enc) {
        try { d = Object.assign({}, d, await ctx.decSignal(t.convId, d.enc)); }
        catch (e) { return fail(t, 'Semnal P2P care nu poate fi verificat (cheie E2E diferită?). Conexiunea a fost refuzată.'); }
      } else if (ctx.e2eRequired && ctx.e2eRequired(t.convId)) {
        return fail(t, 'Semnal P2P necriptat într-o conversație E2E — refuzat (posibil atac MITM).');
      }
    }
    try {
      switch (ev.kind) {
        case 'accept':
          if (t.role !== 'sender') return;
          if (['connecting', 'transferring'].includes(t.state)) { signal({ ...t, peerTab: d.fromTab }, 'busy'); return; }
          t.peerTab = d.fromTab; t.bytes = 0; t.acked = 0; t.sent = 0; t.error = null;
          await startSender(t);
          break;
        case 'offer':
          if (t.role !== 'receiver' || t.pc) return;
          t.peerTab = d.fromTab;
          await onOffer(t, d.sdp);
          break;
        case 'answer':
          if (t.role !== 'sender' || !t.pc) return;
          await t.pc.setRemoteDescription(d.sdp);
          await flushIce(t);
          break;
        case 'ice':
          await addIce(t, d.candidates);
          break;
        case 'cancel':
        case 'decline':
          cancelLocal(t, ev.kind === 'decline' ? 'Refuzat' : 'Anulat de celălalt utilizator');
          break;
        case 'busy':
          fail(t, 'Transferul este deja în curs în altă fereastră.');
          break;
      }
    } catch (e) { console.error(e); fail(t, 'Eroare WebRTC: ' + e.message); }
  }

  function onMessageUpdate(m) {
    const tid = m.meta && m.meta.transfer_id;
    const t = tid && T.get(tid);
    if (t && m.meta.status === 'cancelled' && !['done', 'cancelled'].includes(t.state)) cancelLocal(t, 'Anulat');
  }

  /* ---------------- UI ---------------- */
  let progTimer = 0;
  function progress(t) {
    const now = performance.now();
    if (now - (t.lastUi || 0) < 150) return;
    t.lastUi = now;
    const card = document.querySelector('.p2p-card[data-tid="' + t.tid + '"]');
    if (!card) return;
    const pct = t.total ? Math.min(100, t.bytes / t.total * 100) : 100;
    const el = card.querySelector('.p2p-bar i'); if (el) el.style.width = pct.toFixed(1) + '%';
    const st = card.querySelector('.p2p-status'); if (st) st.textContent = statusText(t);
  }
  function statusText(t) {
    if (t.state === 'transferring') {
      const secs = (performance.now() - t.start) / 1000;
      const speed = secs > 0.3 ? t.bytes / secs : 0;
      const pct = t.total ? Math.floor(t.bytes / t.total * 100) : 100;
      const eta = speed ? (t.total - t.bytes) / speed : NaN;
      return `${pct}% · ${fmtSize(t.bytes)} din ${fmtSize(t.total)}${speed ? ' · ' + fmtSize(speed) + '/s' : ''}${eta ? ' · ' + fmtDur(eta) + ' rămas' : ''}`;
    }
    return '';
  }
  function render(t, force) { if (t.msgId) ctx.rerender(t.msgId, force); }

  function cardHtml(m, mine, peerName) {
    const meta = m.meta || {};
    const files = meta.files || [];
    const total = files.reduce((a, f) => a + (f.size || 0), 0);
    const t = T.get(meta.transfer_id);
    const urlFor = i => {
      if (!t) return null;
      if (t.role === 'sender' && t.files && t.files[i] && isAudio(files[i])) {
        t.urls = t.urls || {};
        return t.urls[i] || (t.urls[i] = URL.createObjectURL(new Blob([t.files[i]], { type: playMime(files[i]) })));
      }
      return t.playable && t.playable[i];
    };
    const playBtn = (f, i) => {
      if (!isAudio(f)) return '';
      const u = urlFor(i);
      const on = t && t.playing === i;
      return u ? `<button class="p2p-play${on ? ' on' : ''}" data-p2p="play" data-i="${i}" title="${on ? 'Oprește' : 'Ascultă'} ${esc(f.name)}">${on ? '❚❚' : '▶'}</button>` : `<span class="p2p-play off" title="Disponibil după primirea fișierului">♪</span>`;
    };
    const list = files.slice(0, 4).map((f, i) => `<li>${playBtn(f, i)}<span>${esc(f.name)}</span><span>${fmtSize(f.size)}</span></li>`).join('') +
      (files.length > 4 ? `<li><span>…și încă ${files.length - 4}</span><span></span></li>` : '');
    let status = '', btns = '', bar = '';
    const B = (act, label, primary) => `<button class="btn${primary ? ' primary' : ''}" data-p2p="${act}" data-mid="${m.id}">${label}</button>`;
    const st = t ? t.state : null;
    if (st === 'waiting') { status = `Se așteaptă ca ${esc(peerName)} să accepte… Ține pagina deschisă.`; btns = B('cancel', 'Anulează'); }
    else if (st === 'connecting') { status = 'Se conectează direct (WebRTC)…'; btns = B('cancel', 'Anulează'); bar = '<div class="p2p-bar"><i style="width:2%"></i></div>'; }
    else if (st === 'transferring') {
      const pct = t.total ? t.bytes / t.total * 100 : 0;
      bar = `<div class="p2p-bar"><i style="width:${pct.toFixed(1)}%"></i></div>`;
      status = statusText(t) || 'Se transferă…'; btns = B('cancel', 'Anulează');
    }
    else if (st === 'done') {
      bar = '<div class="p2p-bar"><i style="width:100%"></i></div>';
      if (t.role === 'sender') status = '✓ Trimis direct (P2P)';
      else {
        status = t.sinkMode === 'native' ? 'Primit pe telefon · alege destinația în dialogul Salvare' : t.sinkMode === 'disk' ? '✓ Primit și salvat pe disc' : (t.sinkMode === 'stream' ? '✓ Primit (descărcat în folderul Descărcări)' : '✓ Primit');
        btns = (t.saved || []).map(s => `<a class="btn" href="${s.url}" download="${esc(s.name)}">Descarcă ${esc(s.name.length > 24 ? s.name.slice(0, 22) + '…' : s.name)}</a>`).join('');
      }
    }
    else if (st === 'failed') {
      status = '⚠️ ' + esc(t.error || 'Eșuat');
      btns = t.role === 'sender' ? B('server', 'Trimite prin server', true) + B('cancel', 'Renunță') : B('retry', 'Reîncearcă', true);
    }
    else if (st === 'cancelled') status = esc(t.error || 'Anulat');
    else {
      const s = meta.status || 'offered';
      if (s === 'completed') status = '✓ Transfer finalizat';
      else if (s === 'cancelled') status = 'Transfer anulat';
      else if (s === 'expired' || s === 'failed') status = 'Transfer expirat';
      else if (m.created_at && Date.now() / 1000 - m.created_at > 86400) status = 'Oferta a expirat (are mai mult de 24 de ore)';
      else if (mine) status = 'Fișierele nu mai sunt disponibile în această fereastră (pagina a fost reîncărcată sau oferta vine din alt browser).';
      else { status = 'Direct de la browserul expeditorului · fără limită de mărime'; btns = B('accept', 'Acceptă', true) + B('decline', 'Refuză'); }
    }
    const title = mine ? 'Transfer P2P trimis' : `${esc(peerName)} îți trimite ${files.length > 1 ? roCount(files.length, 'fișier', 'fișiere') : 'un fișier'}`;
    const playing = t && isNum(t.playing) && urlFor(t.playing);
    const player = playing ? `<audio class="p2p-audio" src="${esc(playing)}" controls autoplay preload="auto" data-i="${t.playing}"></audio>` : '';
    const lock = meta.e2e ? `<span class="e2e-tag" title="Lista de fișiere și semnalizarea sunt criptate end-to-end; fișierul circulă direct, criptat DTLS">🔒 E2E</span>` : '';
    return `<div class="p2p-card" data-tid="${esc(meta.transfer_id)}">
      <div class="p2p-head"><div class="file-ic">⚡</div><div class="file-meta"><div class="p2p-title">${title} ${lock}</div><div class="file-sub">${roCount(files.length, 'fișier', 'fișiere')} · ${fmtSize(total)}</div></div></div>
      <ul class="p2p-files">${list}</ul>${player}${bar}
      <div class="p2p-status">${status}</div>
      ${btns ? `<div class="p2p-btns">${btns}</div>` : ''}
    </div>`;
  }

  const isNum = v => typeof v === 'number';
  function action(act, m, el) {
    const t = T.get(m.meta && m.meta.transfer_id);
    if (act === 'play') {
      if (!t) return;
      const i = +(el && el.dataset.i);
      t.playing = t.playing === i ? null : i;
      return render(t, true);
    }
    if (act === 'accept' || act === 'retry') {
      if (t && ['connecting', 'transferring'].includes(t.state)) return;
      if (t) { try { t.pc && t.pc.close(); } catch (_) {} T.delete(t.tid); }
      return accept(m);
    }
    if (act === 'decline') {
      const tmp = { tid: m.meta.transfer_id, peer: m.sender_id, msgId: m.id };
      signal(tmp, 'decline');
      setStatus(tmp, 'cancelled');
      return;
    }
    if (act === 'cancel' && t) return cancel(t);
    if (act === 'server' && t && t.files) {
      t.state = 'cancelled'; t.error = 'Trimis prin server';
      setStatus(t, 'cancelled');
      ctx.uploadFiles(t.files, t.convId);
    }
  }

  function blockPeer(id){for(const t of T.values())if(+t.peer===+id&&['waiting','connecting','transferring'].includes(t.state))cancel(t);}
  return { blockPeer, init, sendFiles, onSignal, onMessageUpdate, cardHtml, action, supported, fmtSize, TAB };
})();
