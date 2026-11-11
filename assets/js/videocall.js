/* =========================================================================
   VORBITozaur Video Call 2.1 — WebRTC 1:1, UI tip Messenger, 60 FPS fix
   Semnalizare prin api/signal.php (long-poll), SDP/ICE cifrate E2E când e activ.
   ========================================================================= */
window.Call = (() => {
  'use strict';

  let ctx = null;
  const TAB = Math.random().toString(36).slice(2, 10);
  const SECRET = ['call-offer', 'call-answer', 'call-ice'];
  const RING_TIMEOUT = 45000;

  /** @type {null | {
   *  id:string, role:'caller'|'callee', convId:number, peer:number,
   *  state:string, pc:RTCPeerConnection|null, local:MediaStream|null,
   *  remote:MediaStream|null, peerTab:string|null, iceQueue:any[], iceOut:any[],
   *  facing:'user'|'environment', startedAt:number, timer:any, ringTimer:any,
   *  camOn:boolean, micOn:boolean, audioOnly:boolean
   * }} */
  let C = null;
  let ringAudio = null;
  let ringOsc = null;
  let actx = null;
  let durTimer = 0;
  let statsTimer = 0;

  const rnd = (n = 18) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const supported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const secureOk = () => window.isSecureContext || /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);

  /* ---------- media constraints: 60 FPS FIXED + calitate mare ---------- */
  function videoConstraints(facing) {
    return {
      facingMode: facing || 'user',
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    };
  }
  function audioConstraints() {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
  }
  async function getLocalStream(facing, video = true) {
    const tries = [
      { audio: audioConstraints(), video: video ? videoConstraints(facing) : false },
      { audio: true, video: video ? { facingMode: facing || 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } } : false },
      { audio: true, video: video ? { facingMode: facing || 'user', frameRate: { ideal: 60, max: 60 } } : false },
      { audio: true, video: video ? true : false },
    ];
    let last = null;
    for (const c of tries) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(c);
        // Re-aplică constraint pe track (unele browsere ignoră idealul din getUserMedia)
        const vt = s.getVideoTracks()[0];
        if (vt) {
          try {
            await vt.applyConstraints({
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
              frameRate: { ideal: 60, max: 60 },
            });
          } catch (_) {}
        }
        return s;
      } catch (e) { last = e; }
    }
    if (last && (last.name === 'NotAllowedError' || last.name === 'PermissionDeniedError')) {
      throw new Error('Permisiunea pentru cameră și microfon a fost refuzată. Apasă pe lacătul de lângă adresă, permite accesul la cameră și la microfon, apoi încearcă din nou apelul.');
    }
    throw last || new Error('Camera/microfon indisponibile');
  }

  /** Constrânge encoderul outbound: maxFramerate 60 + bitrate mare (calitate întâi). */
  async function applyEncoderParams(pc) {
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      const track = sender.track;
      if (!track || track.kind !== 'video') continue;
      try {
        if (RTCRtpSender.getCapabilities) {
          const caps = RTCRtpSender.getCapabilities('video');
          if (caps && caps.codecs && sender.setCodecPreferences) {
            const prefer = [];
            for (const name of ['video/AV1', 'video/VP9', 'video/H264', 'video/VP8']) {
              for (const c of caps.codecs) if (c.mimeType.toLowerCase() === name.toLowerCase()) prefer.push(c);
            }
            for (const c of caps.codecs) if (!prefer.includes(c)) prefer.push(c);
            try { sender.setCodecPreferences(prefer); } catch (_) {}
          }
        }
      } catch (_) {}
      try {
        const params = sender.getParameters() || {};
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        const settings = track.getSettings ? track.getSettings() : {};
        const h = settings.height || 720;
        const w = settings.width || 1280;
        let maxBitrate = 2_500_000;
        if (h >= 1080 || w >= 1920) maxBitrate = 8_000_000;
        else if (h >= 720 || w >= 1280) maxBitrate = 4_500_000;
        else maxBitrate = 2_500_000;
        const enc = params.encodings[0];
        enc.maxFramerate = 60;
        enc.maxBitrate = maxBitrate;
        if ('priority' in enc || true) enc.priority = 'high';
        if ('networkPriority' in enc || true) enc.networkPriority = 'high';
        params.degradationPreference = 'maintain-framerate';
        await sender.setParameters(params);
      } catch (e) { console.warn('setParameters', e); }
    }
  }

  /* ---------- signaling ---------- */
  async function signal(kind, data = {}) {
    if (!C) return;
    const payload = Object.assign({ fromTab: TAB, toTab: C.peerTab || null }, data);
    let bodyData = payload;
    if (SECRET.includes(kind) && ctx.encSignal && C.convId) {
      try {
        const enc = await ctx.encSignal(C.convId, data);
        if (enc) bodyData = { fromTab: TAB, toTab: C.peerTab || null, enc };
      } catch (e) { console.warn('E2E call signal', e); }
    }
    return ctx.api('api/signal.php?action=signal', {
      body: {
        to_user_id: C.peer,
        transfer_id: C.id,
        message_id: 0,
        kind,
        data: bodyData,
      }
    }).catch(e => console.warn('call signal', kind, e));
  }

  /* ---------- peer connection ---------- */
  function newPC() {
    const pc = new RTCPeerConnection({
      iceServers: ctx.iceServers || [],
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    C.pc = pc;
    C.iceQueue = [];
    C.iceOut = [];
    pc.onicecandidate = e => {
      if (!e.candidate || !C) return;
      C.iceOut.push(e.candidate.toJSON());
      clearTimeout(C._iceT);
      C._iceT = setTimeout(() => {
        const c = C && C.iceOut.splice(0);
        if (c && c.length) signal('call-ice', { candidates: c });
      }, 80);
    };
    pc.ontrack = e => {
      if (!C) return;
      const stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      C.remote = stream;
      const v = $('#vcRemote');
      if (v) {
        v.srcObject = stream;
        v.play().catch(() => { v.dataset.needsGesture = '1'; });
      }
      showStage('active');
    };
    pc.onconnectionstatechange = () => {
      if (!C) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        C.state = 'active';
        C.startedAt = C.startedAt || Date.now();
        stopRing();
        showStage('active');
        startDuration();
        applyEncoderParams(pc);
        startStats();
      } else if (st === 'failed') {
        hangup('Conexiunea video a eșuat (rețea sau firewall restrictiv). Serverul are nevoie de un releu TURN în configurare.', true);
      } else if (st === 'disconnected') {
        setTimeout(() => {
          if (C && C.pc && C.pc.connectionState === 'disconnected') hangup('Conexiunea s-a întrerupt.', true);
        }, 8000);
      }
    };
    return pc;
  }

  async function addIce(list) {
    if (!C) return;
    for (const c of list || []) {
      if (C.pc && C.pc.remoteDescription) {
        try { await C.pc.addIceCandidate(c); } catch (e) { console.warn(e); }
      } else C.iceQueue.push(c);
    }
  }
  async function flushIce() {
    if (!C || !C.pc) return;
    const q = C.iceQueue.splice(0);
    for (const c of q) { try { await C.pc.addIceCandidate(c); } catch (_) {} }
  }

  async function attachLocal(pc, stream) {
    for (const track of stream.getTracks()) pc.addTrack(track, stream);
    await applyEncoderParams(pc);
  }

  /* ---------- call lifecycle ---------- */
  async function start(convId) {
    if(ctx.isBlocked?.(convId)){ctx.toast('Comunicarea directă este oprită, pentru că ai ignorat acest contact.',true);return;}
    if (!supported()) { ctx.toast('Browserul nu suportă apeluri video (WebRTC).', true); return; }
    if (!secureOk()) { ctx.toast('Apelurile video cer HTTPS (sau localhost).', true); return; }
    if (C) { ctx.toast('Ești deja într-un apel.', true); return; }
    if (ctx.isGroup && ctx.isGroup(convId)) { ctx.toast('Apelurile video sunt disponibile doar în conversațiile 1:1.', true); return; }
    const peer = ctx.peerOf(convId);
    if (!peer || peer.id === ctx.me.id) { ctx.toast('Selectează o conversație 1:1.', true); return; }

    let stream;
    try { stream = await getLocalStream('user', true); }
    catch (e) {
      ctx.toast('Nu am acces la cameră/microfon: ' + (e.message || e.name), true);
      return;
    }

    if(ctx.isBlocked?.(convId)){stream.getTracks().forEach(t=>t.stop());return;}
    C = {
      id: 'vc_' + rnd(20),
      role: 'caller',
      convId,
      peer: peer.id,
      state: 'ringing-out',
      pc: null,
      local: stream,
      remote: null,
      peerTab: null,
      iceQueue: [],
      iceOut: [],
      facing: 'user',
      startedAt: 0,
      camOn: true,
      micOn: true,
      audioOnly: false,
    };
    bindLocalPreview(stream);
    showStage('outgoing');
    updatePeerUI(peer);
    startRing(false);
    await signal('call-invite', { convId, video: true, name: ctx.me.display_name || '' });
    C.ringTimer = setTimeout(() => {
      if (C && C.state === 'ringing-out') hangup('Nu a răspuns nimeni.', true);
    }, RING_TIMEOUT);
  }

  async function onIncoming(ev, data) {
    if (C) {
      // busy
      const tmp = { id: ev.transfer_id, peer: ev.from, peerTab: data.fromTab, convId: data.convId };
      const old = C;
      C = tmp;
      await signal('call-busy', {});
      C = old;
      return;
    }
    const convId = data.convId || 0;
    C = {
      id: ev.transfer_id,
      role: 'callee',
      convId,
      peer: ev.from,
      state: 'ringing-in',
      pc: null,
      local: null,
      remote: null,
      peerTab: data.fromTab || null,
      iceQueue: [],
      iceOut: [],
      facing: 'user',
      startedAt: 0,
      camOn: true,
      micOn: true,
      audioOnly: false,
      _pendingInvite: data,
    };
    const peer = ctx.userOf ? ctx.userOf(ev.from) : { id: ev.from, display_name: data.name || 'Contact' };
    updatePeerUI(peer);
    showStage('incoming');
    startRing(true);
    C.ringTimer = setTimeout(() => {
      if (C && C.state === 'ringing-in') decline('Nu a răspuns.');
    }, RING_TIMEOUT);
    try {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
      if (document.hidden && Notification && Notification.permission === 'granted') {
        new Notification(ctx.appName || 'Tex', { body: (peer.display_name || 'Cineva') + ' te apelează video…', tag: 'vc-' + C.id });
      }
    } catch (_) {}
  }

  async function accept() {
    if (!C || C.role !== 'callee' || C.state !== 'ringing-in') return;
    if(ctx.isBlocked?.(C.convId)){await decline();return;}
    const acceptingCall=C;
    clearTimeout(C.ringTimer);
    stopRing();
    let stream;
    try { stream = await getLocalStream(C.facing, true); }
    catch (e) {
      ctx.toast('Nu am acces la cameră/microfon: ' + (e.message || e.name), true);
      await decline();
      return;
    }
    if(C!==acceptingCall||ctx.isBlocked?.(acceptingCall.convId)){stream.getTracks().forEach(t=>t.stop());if(C===acceptingCall)cleanup();return;}
    C.local = stream;
    C.state = 'connecting';
    bindLocalPreview(stream);
    showStage('connecting');
    await signal('call-accept', { fromTab: TAB });
  }

  async function decline(reason) {
    if (!C) return;
    const was = C.state;
    try { await signal('call-decline', { reason: reason || 'refused' }); } catch (_) {}
    cleanup();
    if (was === 'ringing-in') ctx.toast('Apel refuzat.');
  }

  async function onAccepted(data) {
    if (!C || C.role !== 'caller') return;
    clearTimeout(C.ringTimer);
    stopRing();
    C.peerTab = data.fromTab || null;
    C.state = 'connecting';
    showStage('connecting');
    const pc = newPC();
    await attachLocal(pc, C.local);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await applyEncoderParams(pc);
    await signal('call-offer', { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  }

  async function onOffer(sdp) {
    if (!C || C.role !== 'callee') return;
    if (!C.local) {
      try { C.local = await getLocalStream(C.facing, true); bindLocalPreview(C.local); }
      catch (e) { return hangup('Cameră indisponibilă: ' + e.message, true); }
    }
    C.state = 'connecting';
    showStage('connecting');
    const pc = newPC();
    await attachLocal(pc, C.local);
    await pc.setRemoteDescription(sdp);
    await flushIce();
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await applyEncoderParams(pc);
    await signal('call-answer', { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
  }

  async function onAnswer(sdp) {
    if (!C || C.role !== 'caller' || !C.pc) return;
    await C.pc.setRemoteDescription(sdp);
    await flushIce();
    await applyEncoderParams(C.pc);
  }

  async function hangup(msg, err) {
    if (!C) return;
    try { await signal('call-hangup', { reason: msg || 'hangup' }); } catch (_) {}
    cleanup();
    if (msg) ctx.toast(msg, !!err);
  }

  function cleanup() {
    stopRing();
    stopDuration();
    stopStats();
    clearTimeout(C && C.ringTimer);
    clearTimeout(C && C._iceT);
    try {
      if (C && C.local) C.local.getTracks().forEach(t => t.stop());
    } catch (_) {}
    try { if (C && C.pc) C.pc.close(); } catch (_) {}
    const remote = $('#vcRemote');
    const local = $('#vcLocal');
    if (remote) remote.srcObject = null;
    if (local) local.srcObject = null;
    C = null;
    hideOverlay();
  }

  /* ---------- controls ---------- */
  function toggleMic() {
    if (!C || !C.local) return;
    C.micOn = !C.micOn;
    C.local.getAudioTracks().forEach(t => { t.enabled = C.micOn; });
    $('#vcMute') && $('#vcMute').classList.toggle('off', !C.micOn);
    $('#vcMute') && ($('#vcMute').title = C.micOn ? 'Dezactivează microfonul' : 'Activează microfonul');
  }
  function toggleCam() {
    if (!C || !C.local) return;
    C.camOn = !C.camOn;
    C.local.getVideoTracks().forEach(t => { t.enabled = C.camOn; });
    $('#vcCam') && $('#vcCam').classList.toggle('off', !C.camOn);
    $('#vcPip') && $('#vcPip').classList.toggle('cam-off', !C.camOn);
  }
  async function switchCamera() {
    const c=C;
    if(!c||!c.local||c.switching||c.state!=='active')return;
    const old=c.local.getVideoTracks()[0],sender=c.pc?.getSenders().find(s=>s.track?.kind==='video');
    if(!old||!sender){ctx.toast('Camera nu este disponibilă în acest apel.',true);return;}
    c.switching=true;const button=$('#vcFlip'),cam=$('#vcCam');button.disabled=true;button.setAttribute('aria-busy','true');cam.disabled=true;
    const settings=old.getSettings?.()||{},previous=c.facing||'user',next=previous==='user'?'environment':'user';
    let fresh=null,released=false,adopted=false;
    const alive=()=>C===c&&c.pc?.connectionState!=='closed';
    const acquire=video=>navigator.mediaDevices.getUserMedia({audio:false,video});
    const adopt=async(stream,facing)=>{
      const track=stream.getVideoTracks()[0];
      if(!track)throw Error('Camera nu a furnizat imagine.');
      if(!alive()){stream.getTracks().forEach(t=>t.stop());return false;}
      track.enabled=c.camOn;
      await sender.replaceTrack(track); // Same sender/PC/session/audio. No renegotiation/restart.
      if(!alive()){stream.getTracks().forEach(t=>t.stop());return false;}
      for(const t of c.local.getVideoTracks()){c.local.removeTrack(t);if(t!==track)t.stop();}
      c.local.addTrack(track);c.facing=track.getSettings?.().facingMode||facing;
      bindLocalPreview(c.local);return true;
    };
    try {
      const cameras=(navigator.mediaDevices.enumerateDevices ? await navigator.mediaDevices.enumerateDevices().catch(()=>[]) : []).filter(d=>d.kind==='videoinput');
      if(!alive())return;
      if(cameras.length===1&&!matchMedia('(pointer:coarse)').matches)throw Error('Este disponibilă o singură cameră.');
      const label=next==='environment'?/back|rear|environment|spate/i:/front|user|facetime|față/i;
      const candidates=cameras.filter(d=>d.deviceId&&d.deviceId!==settings.deviceId);
      const target=candidates.find(d=>label.test(d.label))||candidates[0];
      const constraint={width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30,max:60},...(target?{deviceId:{exact:target.deviceId}}:{facingMode:{exact:next}})};
      try{fresh=await acquire(constraint);}catch(err){
        // Some mobile hardware cannot open both cameras concurrently. Only release on busy-hardware errors.
        if(!alive())return;
        if(!['NotReadableError','TrackStartError','AbortError'].includes(err.name))throw err;
        old.stop();released=true;fresh=await acquire(constraint);
      }
      if(!alive())return;
      const track=fresh.getVideoTracks()[0],actual=track?.getSettings?.()||{};
      if(settings.deviceId&&actual.deviceId===settings.deviceId&&actual.facingMode!==next)throw Error('O a doua cameră nu este disponibilă.');
      const facing=actual.facingMode||(target&&/front|user|facetime|față/i.test(target.label)?'user':target&&/back|rear|environment|spate/i.test(target.label)?'environment':target?'unknown':next);
      adopted=await adopt(fresh,facing);
      if(adopted)await applyEncoderParams(c.pc);
    }catch(err){
      if(fresh&&!adopted){fresh.getTracks().forEach(t=>t.stop());fresh=null;}
      if(alive()&&released){
        let recovery;
        try{recovery=await acquire(settings.deviceId?{deviceId:{exact:settings.deviceId}}:{facingMode:{exact:previous}});if(!await adopt(recovery,previous))recovery.getTracks().forEach(t=>t.stop());}
        catch(_){recovery?.getTracks().forEach(t=>t.stop());if(alive()){c.camOn=false;$('#vcCam').classList.add('off');$('#vcPip').classList.add('cam-off');}}
      }
      if(alive())ctx.toast('Nu am putut schimba camera. '+(released&&!c.camOn?'Camera nu a putut fi restabilită; sunetul apelului continuă.':err.name==='NotAllowedError'?'Acces refuzat; camera anterioară este păstrată.':err.message||err.name),true);
    }finally{
      if(fresh&&!adopted)fresh.getTracks().forEach(t=>t.stop());
      c.switching=false;
      if(C===c){button.disabled=c.state!=='active';button.removeAttribute('aria-busy');cam.disabled=false;}
    }
  }

  /* ---------- UI ---------- */
  function ensureDOM() {
    if ($('#vcOverlay')) return;
    const el = document.createElement('div');
    el.id = 'vcOverlay';
    el.className = 'vc-overlay';
    el.hidden = true;
    el.innerHTML = `
      <div class="vc-stage" id="vcStage">
        <video id="vcRemote" class="vc-remote" autoplay playsinline></video>
        <div class="vc-fallback" id="vcFallback">
          <div class="vc-avatar" id="vcAvatar"></div>
          <div class="vc-name" id="vcName"></div>
          <div class="vc-status" id="vcStatus"></div>
        </div>
        <div class="vc-pip" id="vcPip">
          <video id="vcLocal" class="vc-local" autoplay playsinline muted></video>
          <div class="vc-pip-off">Cameră oprită</div>
        </div>
        <header class="vc-top">
          <div class="vc-top-info">
            <div class="vc-top-name" id="vcTopName"></div>
            <div class="vc-top-meta"><span id="vcDur">00:00</span><span class="vc-sep">·</span><span id="vcStats" title="FPS / rezoluție estimate">—</span></div>
          </div>
        </header>
        <div class="vc-incoming" id="vcIncoming" hidden>
          <div class="vc-in-card">
            <div class="vc-in-avatar" id="vcInAvatar"></div>
            <div class="vc-in-name" id="vcInName"></div>
            <div class="vc-in-sub">Apel video primit…</div>
            <div class="vc-in-actions">
              <button type="button" class="vc-btn decline" id="vcDecline" title="Refuză"><svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.41 7.46 7 12 7s8.66 1.41 11.71 4.66c.39.39.39 1.03 0 1.42l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85.96.96 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg><span>Refuză</span></button>
              <button type="button" class="vc-btn accept" id="vcAccept" title="Acceptă"><svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg><span>Acceptă</span></button>
            </div>
          </div>
        </div>
        <footer class="vc-controls" id="vcControls">
          <button type="button" class="vc-ctrl" id="vcMute" title="Dezactivează microfonul"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/></svg></button>
          <button type="button" class="vc-ctrl" id="vcCam" title="Oprește camera"><svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg></button>
          <button type="button" class="vc-ctrl" id="vcFlip" title="Schimbă camera" aria-label="Schimbă camera"><svg viewBox="0 0 24 24"><path d="M9 12c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3zm8.28-5.28L15.66 5.1A2.99 2.99 0 0 0 13.5 4.2H10.5c-.91 0-1.76.37-2.37.99L6.72 6.72C5.65 7.79 5 9.29 5 11v.5H3.5L6 14l2.5-2.5H7V11c0-1.24.5-2.4 1.41-3.28L9.99 6.14c.27-.28.65-.44 1.05-.44h2.92c.4 0 .78.16 1.05.44l1.58 1.58C17.5 8.6 18 9.76 18 11v.5h-1.5L19 14l2.5-2.5H20V11c0-1.71-.65-3.21-1.72-4.28z"/></svg><span class="vc-flip-label">Schimbă camera</span></button>
          <button type="button" class="vc-ctrl hang" id="vcHang" title="Închide apelul"><svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .4-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.996.996 0 0 1 0-1.41C3.34 8.41 7.46 7 12 7s8.66 1.41 11.71 4.66c.39.39.39 1.03 0 1.42l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.3 11.3 0 0 0-2.67-1.85.96.96 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg></button>
        </footer>
      </div>`;
    document.body.appendChild(el);

    $('#vcAccept').addEventListener('click', () => accept());
    $('#vcDecline').addEventListener('click', () => decline());
    $('#vcMute').addEventListener('click', () => toggleMic());
    $('#vcCam').addEventListener('click', () => toggleCam());
    $('#vcFlip').addEventListener('click', () => switchCamera());
    $('#vcHang').addEventListener('click', () => hangup('Apel închis.'));

    $('#vcOverlay').addEventListener('click', () => {
      const v = $('#vcRemote');
      if (v && v.dataset.needsGesture) {
        v.play().then(() => { delete v.dataset.needsGesture; }).catch(() => {});
      }
      try { ensureAudio(); } catch (_) {}
    });

    // PiP drag (simplu)
    const pip = $('#vcPip');
    let drag = null;
    pip.addEventListener('pointerdown', e => {
      if (e.button && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, l: pip.offsetLeft, t: pip.offsetTop };
      pip.setPointerCapture(e.pointerId);
    });
    pip.addEventListener('pointermove', e => {
      if (!drag) return;
      const nx = drag.l + (e.clientX - drag.x);
      const ny = drag.t + (e.clientY - drag.y);
      pip.style.left = Math.max(8, Math.min(innerWidth - pip.offsetWidth - 8, nx)) + 'px';
      pip.style.top = Math.max(8, Math.min(innerHeight - pip.offsetHeight - 8, ny)) + 'px';
      pip.style.right = 'auto';
      pip.style.bottom = 'auto';
    });
    pip.addEventListener('pointerup', () => { drag = null; });
  }

  function bindLocalPreview(stream) {
    const v = $('#vcLocal');
    if (v) { const facing=stream.getVideoTracks()[0]?.getSettings?.().facingMode||C?.facing; v.style.transform=facing==='user'?'scaleX(-1)':'none'; v.srcObject = stream; v.muted = true; v.play().catch(() => {}); }
  }

  function updatePeerUI(peer) {
    ensureDOM();
    const name = (peer && peer.display_name) || 'Contact';
    const avHtml = ctx.avatarHtml ? ctx.avatarHtml(peer, 'xl') : `<div class="avatar xl">${esc((name || '?')[0])}</div>`;
    $('#vcName').textContent = name;
    $('#vcTopName').textContent = name;
    $('#vcInName').textContent = name;
    $('#vcAvatar').innerHTML = avHtml;
    $('#vcInAvatar').innerHTML = avHtml;
  }

  function showStage(mode) {
    ensureDOM();
    const ov = $('#vcOverlay');
    ov.hidden = false;
    ov.dataset.mode = mode;
    document.documentElement.classList.add('vc-open');
    $('#vcFlip').disabled=mode!=='active'||!!C?.switching; $('#vcCam').disabled=!!C?.switching;
    const incoming = $('#vcIncoming');
    const controls = $('#vcControls');
    const fallback = $('#vcFallback');
    const pip = $('#vcPip');
    const remote = $('#vcRemote');
    incoming.hidden = mode !== 'incoming';
    controls.hidden = mode === 'incoming';
    pip.hidden = mode === 'incoming' || mode === 'outgoing';
    if (mode === 'outgoing' || mode === 'incoming' || mode === 'connecting') {
      fallback.hidden = false;
      remote.classList.remove('on');
      $('#vcStatus').textContent =
        mode === 'outgoing' ? 'Se apelează…' :
        mode === 'incoming' ? 'Apel video primit…' :
        'Se conectează…';
    }
    if (mode === 'active') {
      fallback.hidden = true;
      remote.classList.add('on');
      pip.hidden = false;
      controls.hidden = false;
    }
    if (mode === 'outgoing') pip.hidden = false;
  }

  function hideOverlay() {
    const ov = $('#vcOverlay');
    if (ov) { ov.hidden = true; delete ov.dataset.mode; }
    document.documentElement.classList.remove('vc-open');
  }

  function startDuration() {
    stopDuration();
    const tick = () => {
      if (!C || !C.startedAt) return;
      const s = Math.floor((Date.now() - C.startedAt) / 1000);
      const m = Math.floor(s / 60);
      const r = s % 60;
      const el = $('#vcDur');
      if (el) el.textContent = String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    };
    tick();
    durTimer = setInterval(tick, 1000);
  }
  function stopDuration() { clearInterval(durTimer); durTimer = 0; }

  function startStats() {
    stopStats();
    statsTimer = setInterval(async () => {
      if (!C || !C.pc) return;
      try {
        const stats = await C.pc.getStats();
        let fps = null, w = null, h = null;
        stats.forEach(r => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            if (r.framesPerSecond != null) fps = Math.round(r.framesPerSecond);
            if (r.frameWidth) w = r.frameWidth;
            if (r.frameHeight) h = r.frameHeight;
          }
        });
        const local = C.local && C.local.getVideoTracks()[0];
        const ls = local && local.getSettings ? local.getSettings() : {};
        const el = $('#vcStats');
        if (el) {
          const parts = [];
          if (fps != null) parts.push(fps + ' fps');
          else if (ls.frameRate) parts.push('~' + Math.round(ls.frameRate) + ' fps loc');
          if (w && h) parts.push(w + '×' + h);
          else if (ls.width && ls.height) parts.push(ls.width + '×' + ls.height + ' loc');
          el.textContent = parts.join(' · ') || '—';
        }
      } catch (_) {}
    }, 2000);
  }
  function stopStats() { clearInterval(statsTimer); statsTimer = 0; }

  /* ---------- ringtone (WebAudio) ---------- */
  function ensureAudio() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (_) {}
    return actx;
  }
  function startRing(incoming) {
    stopRing();
    const a = ensureAudio();
    if (!a) return;
    const master = a.createGain();
    master.gain.value = incoming ? 0.18 : 0.12;
    master.connect(a.destination);
    ringOsc = { master, nodes: [], timer: 0 };
    const beep = () => {
      if (!ringOsc) return;
      const now = a.currentTime;
      const freqs = incoming ? [880, 988] : [640, 760];
      freqs.forEach((f, i) => {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.9, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        o.connect(g); g.connect(master);
        o.start(now + i * 0.08);
        o.stop(now + 0.4);
        ringOsc.nodes.push(o);
      });
    };
    beep();
    ringOsc.timer = setInterval(beep, incoming ? 1400 : 2000);
  }
  function stopRing() {
    if (ringOsc) {
      clearInterval(ringOsc.timer);
      try { ringOsc.nodes.forEach(n => { try { n.stop(); } catch (_) {} }); } catch (_) {}
      try { ringOsc.master.disconnect(); } catch (_) {}
      ringOsc = null;
    }
  }

  /* ---------- signal router ---------- */
  async function onSignal(ev) {
    if (!ev || !ev.transfer_id || !String(ev.transfer_id).startsWith('vc_')) return false;
    let d = ev.data || {};
    if (d.toTab && d.toTab !== TAB) return true;

    if (SECRET.includes(ev.kind)) {
      if (!C || C.id !== ev.transfer_id) return true;
      if (d.enc) {
        try { d = Object.assign({}, d, await ctx.decSignal(C.convId, d.enc)); }
        catch (e) {
          hangup('Semnal video care nu poate fi verificat (cheie E2E diferită?).', true);
          return true;
        }
      } else if (ctx.e2eRequired && ctx.e2eRequired(C.convId)) {
        hangup('Semnal video necriptat într-o conversație E2E — refuzat.', true);
        return true;
      }
    }

    try {
      switch (ev.kind) {
        case 'call-invite':
          if (C && C.id === ev.transfer_id) return true;
          await onIncoming(ev, d);
          break;
        case 'call-accept':
          if (!C || C.id !== ev.transfer_id) return true;
          await onAccepted(d);
          break;
        case 'call-decline':
          if (!C || C.id !== ev.transfer_id) return true;
          cleanup();
          ctx.toast('Apel refuzat.');
          break;
        case 'call-offer':
          if (!C || C.id !== ev.transfer_id) return true;
          C.peerTab = d.fromTab || C.peerTab;
          await onOffer(d.sdp);
          break;
        case 'call-answer':
          if (!C || C.id !== ev.transfer_id) return true;
          await onAnswer(d.sdp);
          break;
        case 'call-ice':
          if (!C || C.id !== ev.transfer_id) return true;
          await addIce(d.candidates);
          break;
        case 'call-hangup':
          if (!C || C.id !== ev.transfer_id) return true;
          cleanup();
          ctx.toast('Apel închis.');
          break;
        case 'call-busy':
          if (!C || C.id !== ev.transfer_id) return true;
          cleanup();
          ctx.toast('Utilizatorul este ocupat în alt apel.', true);
          break;
        default:
          return false;
      }
    } catch (e) {
      console.error(e);
      hangup('Eroare apel video: ' + e.message, true);
    }
    return true;
  }

  function init(c) {
    ctx = c;
    ensureDOM();
    window.addEventListener('beforeunload', e => {
      if (C && ['ringing-out', 'ringing-in', 'connecting', 'active'].includes(C.state)) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });
  }

  function active() { return !!C; }
  function currentConv() { return C ? C.convId : null; }

  function blockPeer(id){if(C&&+C.peer===+id){signal('call-hangup',{reason:'ignore'});cleanup();}}
  return { blockPeer, init, start, accept, decline, hangup, onSignal, supported, secureOk, active, currentConv, TAB };
})();
