/* =========================================================================
   VORBITozaur 2.0 — criptare end-to-end (E2E) cu Web Crypto API
   -------------------------------------------------------------------------
   • Fiecare utilizator are o pereche de chei ECDH P-256.
     - cheia publică stă pe server (o pot citi contactele);
     - cheia privată e generată în browser, salvată NE-EXTRASIBILĂ în IndexedDB și,
       pentru alte dispozitive, urcată pe server DOAR criptată cu o cheie derivată din
       parola ta (PBKDF2-SHA256, 310.000 iterații → AES-256-GCM). Serverul nu o poate citi.
   • Conversații 1:1: cheia = HKDF(ECDH(eu, celălalt), "dm:<id>") → AES-256-GCM.
     Nu e nevoie ca celălalt să fie online.
   • Grupuri: o cheie aleatoare de 256 biți pe „versiune”, împachetată (AES-GCM) pentru
     fiecare membru cu cheia ECDH dintre cel care împachetează și membru. La plecarea
     unui membru versiunea crește (rotire) → plecatul nu mai citește mesajele noi.
   • Se criptează: textul mesajelor, fișierele urcate pe server (pe bucăți de 1 MB,
     AES-GCM, numele/tipul/dimensiunile în metadate cifrate), lista de fișiere P2P și
     semnalizarea WebRTC (SDP/ICE) => serverul nu poate face MITM pe conexiunea P2P.
   • NU se criptează (serverul are nevoie de ele): cine vorbește cu cine și când,
     prezența/statusul, BUZZ, „scrie…”, confirmările de citire, reacțiile, numele
     grupurilor, avatarele, mărimea fișierelor.
   ========================================================================= */
window.E2E = (() => {
  'use strict';
  const subtle = window.crypto && window.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const SALT = te.encode('VORBITozaur-E2E-v1');
  const ITER = 310000;
  const FILE_CS = 1024 * 1024; // bucată de fișier în clar (cifrat: +16 octeți tag)
  let ctx = null;
  const st = { state: 'unsupported', priv: null, pub: null, fp: null, uid: 0 };
  const pubs = new Map();     // uid -> Promise<{jwk, fp, key}|null>
  const dmKeys = new Map();   // cid:fp -> Promise<CryptoKey>
  const groups = new Map();   // cid -> {info, at, keys: Map(kv -> {key, raw})}
  const groupLoads = new Map();

  const b64 = u8 => { u8 = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(String(s)), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const supported = () => !!(subtle && window.isSecureContext && window.indexedDB && window.TextEncoder);

  /* ---------------- API minimal (login.php nu are app.js) ---------------- */
  async function api(path, opts = {}) {
    if (ctx && ctx.api) return ctx.api(path, opts);
    const csrf = (document.querySelector('meta[name=csrf-token]') || {}).content || '';
    const o = { method: opts.body !== undefined ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(path, o);
    const j = await r.json().catch(() => ({ ok: false, error: 'Eroare server (' + r.status + ')' }));
    if (!j.ok) { const e = new Error(j.error || 'Eroare'); e.status = r.status; throw e; }
    return j;
  }

  /* ---------------- IndexedDB (cheia privată ne-extrasibilă) ---------------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('vorbitozaur-e2e', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('keys');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction('keys', mode);
      const req = fn(tx.objectStore('keys'));
      tx.oncomplete = () => { db.close(); res(req && req.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  const idbGet = k => idbOp('readonly', s => s.get(k));
  const idbPut = (k, v) => idbOp('readwrite', s => s.put(v, k));
  const idbDel = k => idbOp('readwrite', s => s.delete(k));

  /* ---------------- primitive ---------------- */
  async function fingerprintOf(jwk) {
    const h = new Uint8Array(await subtle.digest('SHA-256', te.encode('P-256:' + jwk.x + ':' + jwk.y)));
    return b64(h).replace(/=+$/, '');
  }
  async function kdf(password, salt, iter) {
    const base = await subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function hkdfKey(bits, info) {
    const base = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function pairKey(otherPubKey, info) {
    const bits = await subtle.deriveBits({ name: 'ECDH', public: otherPubKey }, st.priv, 256);
    return hkdfKey(bits, info);
  }
  async function aesEnc(key, data, aad) {
    const iv = rand(12);
    const p = { name: 'AES-GCM', iv }; if (aad) p.additionalData = te.encode(aad);
    const ct = await subtle.encrypt(p, key, typeof data === 'string' ? te.encode(data) : data);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function aesDec(key, ivB64, ctB64, aad) {
    const p = { name: 'AES-GCM', iv: unb64(ivB64) }; if (aad) p.additionalData = te.encode(aad);
    return new Uint8Array(await subtle.decrypt(p, key, unb64(ctB64)));
  }

  /* ---------------- cheile mele ---------------- */
  async function saveLocal(priv, pub, fp) {
    await idbPut('u' + st.uid, { priv, pub, fp, uid: st.uid, at: Date.now() });
    Object.assign(st, { priv, pub, fp, state: 'ready' });
    dmKeys.clear(); groups.clear();
  }
  async function init(c) {
    ctx = c || ctx;
    st.uid = ctx && ctx.me ? ctx.me.id : st.uid;
    if (!supported()) { st.state = 'unsupported'; return st.state; }
    let rec = null;
    try { rec = await idbGet('u' + st.uid); } catch (_) {}
    let server = null;
    try { server = (await api('api/keys.php?action=mine')).key; } catch (_) { server = undefined; }
    if (server === null) { st.state = 'none'; if (rec) await idbDel('u' + st.uid).catch(() => {}); return st.state; }
    if (rec && rec.priv && (server === undefined || server.fingerprint === rec.fp)) {
      Object.assign(st, { priv: rec.priv, pub: rec.pub, fp: rec.fp, state: 'ready' });
      return st.state;
    }
    if (rec) await idbDel('u' + st.uid).catch(() => {}); // cheile au fost resetate pe alt dispozitiv
    st.state = 'locked';
    return st.state;
  }
  /** Deblochează (sau creează la prima utilizare) cheile cu parola contului. */
  async function unlock(password, opts = {}) {
    if (!supported()) throw new Error('Criptarea E2E necesită HTTPS și un browser modern');
    const j = await api('api/keys.php?action=mine');
    if (j.key && !opts.reset) {
      const kek = await kdf(password, unb64(j.key.kdf_salt), j.key.kdf_iter);
      let pkcs8;
      try { pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.key.iv) }, kek, unb64(j.key.enc_priv)); }
      catch (_) { throw new Error('Parolă greșită: nu pot debloca cheia E2E'); }
      const priv = await subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      await saveLocal(priv, j.key.pub_jwk, j.key.fingerprint);
      return 'unlocked';
    }
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pkcs8 = await subtle.exportKey('pkcs8', kp.privateKey);
    const pj = await subtle.exportKey('jwk', kp.publicKey);
    const pub = { kty: 'EC', crv: 'P-256', x: pj.x, y: pj.y };
    const salt = rand(16), iv = rand(12);
    const kek = await kdf(password, salt, ITER);
    const enc = await subtle.encrypt({ name: 'AES-GCM', iv }, kek, pkcs8);
    const fp = await fingerprintOf(pub);
    try {
      await api('api/keys.php?action=setup', { body: { password, pub_jwk: pub, enc_priv: b64(new Uint8Array(enc)), kdf_salt: b64(salt), kdf_iter: ITER, iv: b64(iv), fingerprint: fp, replace: !!opts.reset } });
    } catch (e) {
      if (!opts.reset && /există deja/.test(e.message)) return unlock(password); // alt tab le-a creat între timp
      throw e;
    }
    const priv = await subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    await saveLocal(priv, pub, fp);
    return 'created';
  }
  /** Apelat din login.php imediat după autentificare (parola e încă în formular). */
  async function afterLogin(uid, password) {
    if (!supported() || !uid || !password) return 'skip';
    st.uid = uid;
    try { return await unlock(password); } catch (e) { console.warn('E2E', e); return 'error'; }
  }
  async function forget() { pubs.clear(); dmKeys.clear(); groups.clear(); try { await idbDel('u' + st.uid); } catch (_) {} st.priv = null; st.state = 'locked'; }

  /* ---------------- cheile publice ale altora (TOFU) ---------------- */
  const pinKey = () => 'vz.e2e.pins.' + st.uid;
  function checkPin(uid, fp) {
    let pins = {};
    try { pins = JSON.parse(localStorage.getItem(pinKey()) || '{}'); } catch (_) {}
    const old = pins[uid];
    if (old !== fp) { pins[uid] = fp; try { localStorage.setItem(pinKey(), JSON.stringify(pins)); } catch (_) {} }
    if (old && old !== fp && ctx && ctx.onKeyChange) ctx.onKeyChange(uid);
  }
  async function importPub(jwk) {
    return subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  }
  function prefetch(ids) {
    const need = [...new Set(ids.map(Number))].filter(id => id && !pubs.has(id));
    if (!need.length) return Promise.resolve();
    const all = (async () => {
      const out = new Map();
      for (let i = 0; i < need.length; i += 90) {
        const part = need.slice(i, i + 90);
        try {
          const j = await api('api/keys.php?action=pub&ids=' + part.join(','));
          for (const id of part) {
            const k = j.keys[String(id)];
            if (!k || !k.pub_jwk) { out.set(id, null); continue; }
            try {
              const fp = await fingerprintOf(k.pub_jwk);
              out.set(id, { jwk: k.pub_jwk, fp, key: await importPub(k.pub_jwk) });
              if (id !== st.uid) checkPin(id, fp);
            } catch (_) { out.set(id, null); }
          }
        } catch (_) { part.forEach(id => out.set(id, undefined)); }
      }
      return out;
    })();
    need.forEach(id => pubs.set(id, all.then(m => { const v = m.get(id); if (v === undefined) { pubs.delete(id); return null; } return v; })));
    return all;
  }
  async function getPub(uid) {
    uid = Number(uid);
    if (uid === st.uid && st.pub) return { jwk: st.pub, fp: st.fp, key: await importPub(st.pub) };
    if (!pubs.has(uid)) prefetch([uid]);
    return pubs.get(uid);
  }
  function invalidateUser(uid) {
    pubs.delete(Number(uid));
    for (const k of [...dmKeys.keys()]) dmKeys.delete(k);
    groups.clear();
  }

  /* ---------------- cheia unei conversații ---------------- */
  const ready = () => st.state === 'ready' && !!st.priv;
  const otherOf = conv => (conv.members || []).find(m => m.id !== st.uid);
  async function dmKey(conv) {
    const o = otherOf(conv);
    if (!o) return null;
    const p = await getPub(o.id);
    if (!p) return null;
    const k = conv.id + ':' + p.fp + ':' + st.fp;
    if (!dmKeys.has(k)) dmKeys.set(k, pairKey(p.key, 'dm:' + conv.id).catch(e => { dmKeys.delete(k); throw e; }));
    return dmKeys.get(k);
  }
  async function loadGroup(cid, force) {
    const g = groups.get(cid);
    if (g && !force && Date.now() - g.at < 30000) return g;
    if (groupLoads.has(cid)) return groupLoads.get(cid);
    const pr = (async () => {
      const info = await api('api/keys.php?action=conv&conversation_id=' + cid);
      const keys = (g && g.keys) || new Map();
      await prefetch(info.mine.map(x => x.by).concat(info.members.map(m => m.id)));
      for (const w of info.mine) {
        if (keys.has(w.kv)) continue;
        try {
          const by = await getPub(w.by);
          if (!by) continue;
          const wk = await pairKey(by.key, 'wrap:' + cid + ':' + w.kv);
          const o = JSON.parse(w.wrapped);
          const raw = await aesDec(wk, o.iv, o.ct, 'gk:' + cid + ':' + w.kv);
          keys.set(w.kv, { raw, key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) });
        } catch (e) { console.warn('E2E unwrap', cid, w.kv, e); }
      }
      const res = { info, keys, at: Date.now() };
      groups.set(cid, res);
      return res;
    })().finally(() => groupLoads.delete(cid));
    groupLoads.set(cid, pr);
    return pr;
  }
  async function wrapFor(cid, kv, raw, userIds) {
    const out = [];
    for (const id of userIds) {
      const p = await getPub(id);
      if (!p) continue;
      const wk = await pairKey(p.key, 'wrap:' + cid + ':' + kv);
      const e = await aesEnc(wk, raw, 'gk:' + cid + ':' + kv);
      out.push({ user_id: id, wrapped: JSON.stringify(e) });
    }
    return out;
  }
  /** „Vindecă” grupul: dă cheia curentă membrilor care au între timp chei E2E, dar nu au primit-o. */
  async function heal(cid, g) {
    const kv = g.info.key_version, mine = g.keys.get(kv);
    if (!mine) return;
    const missing = g.info.members.filter(m => !m.has_key).map(m => m.id);
    if (!missing.length) return;
    await prefetch(missing);
    const keys = await wrapFor(cid, kv, mine.raw, missing);
    if (keys.length) { try { await api('api/keys.php?action=wrap', { body: { conversation_id: cid, key_version: kv, fresh: false, keys } }); g.at = 0; } catch (_) {} }
  }
  /** Cheia cu care TRIMIT în conversație: {key, kv} sau {key:null, reason}. */
  async function sendKey(conv, retry = 0) {
    if (!ready()) return { key: null, reason: st.state === 'unsupported' ? 'unsupported' : 'locked' };
    if (!conv.is_group) {
      const k = await dmKey(conv).catch(() => null);
      return k ? { key: k, kv: 0 } : { key: null, reason: 'peer' };
    }
    const g = await loadGroup(conv.id, retry > 0);
    const kv = g.info.key_version;
    if (g.keys.has(kv)) { heal(conv.id, g).catch(() => {}); return { key: g.keys.get(kv).key, kv }; }
    if (g.info.members.some(m => m.has_key)) return { key: null, reason: 'waiting' };
    // nimeni nu are cheia versiunii curente => o generez eu (doar dacă toți membrii au chei E2E)
    const ids = g.info.members.map(m => m.id);
    await prefetch(ids);
    for (const id of ids) if (!(await getPub(id))) return { key: null, reason: 'member' };
    const raw = rand(32);
    const keys = await wrapFor(conv.id, kv, raw, ids);
    try {
      await api('api/keys.php?action=wrap', { body: { conversation_id: conv.id, key_version: kv, fresh: true, keys } });
    } catch (e) {
      if (retry < 2) return sendKey(conv, retry + 1);
      return { key: null, reason: 'conflict' };
    }
    g.keys.set(kv, { raw, key: await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']) });
    return { key: g.keys.get(kv).key, kv };
  }
  async function readKey(conv, kv) {
    if (!ready()) return null;
    if (!conv.is_group) return dmKey(conv).catch(() => null);
    let g = await loadGroup(conv.id);
    if (!g.keys.has(kv)) g = await loadGroup(conv.id, true);
    return g.keys.has(kv) ? g.keys.get(kv).key : null;
  }
  /** Status E2E pentru antet: 'on' | 'off' + motiv. */
  async function convStatus(conv) {
    if (!supported()) return { on: false, reason: 'unsupported' };
    if (!ready()) return { on: false, reason: st.state };
    try { const k = await sendKey(conv); return k.key ? { on: true } : { on: false, reason: k.reason }; }
    catch (_) { return { on: false, reason: 'error' }; }
  }

  /* ---------------- mesaje ---------------- */
  async function encryptText(conv, text) {
    const k = await sendKey(conv);
    if (!k.key) return null;
    const e = await aesEnc(k.key, text, 'msg:' + conv.id);
    return { body: e.ct, e2e: { iv: e.iv, kv: k.kv } };
  }
  async function decryptText(conv, body, e2e) {
    const key = await readKey(conv, e2e.kv || 0);
    if (!key) throw new Error('nokey');
    return td.decode(await aesDec(key, e2e.iv, body, 'msg:' + conv.id));
  }
  async function encryptJson(conv, obj, tag) {
    const k = await sendKey(conv);
    if (!k.key) return null;
    const e = await aesEnc(k.key, JSON.stringify(obj), (tag || 'json') + ':' + conv.id);
    return { iv: e.iv, m: e.ct, kv: k.kv };
  }
  async function decryptJson(conv, e, tag) {
    const key = await readKey(conv, e.kv || 0);
    if (!key) throw new Error('nokey');
    return JSON.parse(td.decode(await aesDec(key, e.iv, e.m, (tag || 'json') + ':' + conv.id)));
  }

  /* ---------------- fișiere (pe bucăți) ---------------- */
  function chunkIv(base, i) { const iv = base.slice(); const dv = new DataView(iv.buffer); dv.setUint32(8, (dv.getUint32(8) ^ i) >>> 0); return iv; }
  async function fileEncryptor(conv, file, info, maxChunk) {
    const k = await sendKey(conv);
    if (!k.key) return null;
    const cs = Math.max(64 * 1024, Math.min(FILE_CS, (maxChunk || FILE_CS) - 64));
    const n = Math.max(1, Math.ceil(file.size / cs));
    const base = rand(12);
    const meta = await aesEnc(k.key, JSON.stringify(info), 'fmeta:' + conv.id);
    return {
      cs, n, total: file.size + 16 * n, ecs: cs + 16,
      e2e: { iv: b64(base), cs, t: info.type, m: meta.ct, mi: meta.iv, kv: k.kv },
      async chunk(i) {
        const plain = await file.slice(i * cs, Math.min(file.size, (i + 1) * cs)).arrayBuffer();
        return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(base, i), additionalData: te.encode(i + '/' + n) }, k.key, plain));
      },
    };
  }
  async function decryptFileMeta(conv, e) {
    const key = await readKey(conv, e.kv || 0);
    if (!key) throw new Error('nokey');
    return JSON.parse(td.decode(await aesDec(key, e.mi, e.m, 'fmeta:' + conv.id)));
  }
  /** Descarcă fișierul cifrat și îl decriptează în flux (bucată cu bucată). */
  async function decryptFile(conv, url, e, mime, onProg, opts = {}) {
    const key = await readKey(conv, e.kv || 0);
    if (!key) throw new Error('Nu am cheia acestei conversații');
    if (opts.signal?.aborted) throw new DOMException('Anulat','AbortError');
    if (opts.sameOrigin) { const u = new URL(url,location.href); if (u.origin !== location.origin || !['https:','http:'].includes(u.protocol) || u.username || u.password) throw Error('Adresă nesigură'); }
    if (opts.maxBytes) {
      const {bytes:all} = await TexPreviewBytes.read(url,{signal:opts.signal,maxBytes:opts.maxBytes});
      const ecs=(e.cs||FILE_CS)+16, n=Math.max(1,Math.ceil(all.length/ecs)), base=unb64(e.iv), parts=[];
      for(let i=0;i<n;i++) {
        if(opts.signal?.aborted)throw new DOMException('Anulat','AbortError');
        parts.push(new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:chunkIv(base,i),additionalData:te.encode(i+'/'+n)},key,all.subarray(i*ecs,Math.min(all.length,(i+1)*ecs)))));
        if(onProg)onProg((i+1)/n);
      }
      if(opts.signal?.aborted)throw new DOMException('Anulat','AbortError');
      return new Blob(parts,{type:mime||'application/octet-stream'});
    }
    const r = await fetch(url, { credentials: 'same-origin', signal: opts.signal, ...(opts.sameOrigin ? {redirect:'error'} : {}) });
    if (!r.ok) throw new Error('Descărcare eșuată (' + r.status + ')');
    const ecs = (e.cs || FILE_CS) + 16;
    const base = unb64(e.iv);
    const parts = [];
    let total = +r.headers.get('Content-Length') || 0, n = 0, idx = 0;
    if (opts.maxBytes && total > opts.maxBytes) { await r.body?.cancel(); throw Error('Fișier prea mare pentru previzualizare'); }
    const flush = async chunk => {
      if (opts.signal?.aborted) throw new DOMException('Anulat','AbortError');
      parts.push(new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: chunkIv(base, idx), additionalData: te.encode(idx + '/' + n) }, key, chunk)));
      idx++;
    };
    if (!total || !r.body || !r.body.getReader) { // fără Content-Length: citim tot, apoi decriptăm
      const all = new Uint8Array(await r.arrayBuffer());
      if (opts.maxBytes && all.length > opts.maxBytes) throw Error('Fișier prea mare pentru previzualizare');
      n = Math.max(1, Math.ceil(all.length / ecs));
      for (let i = 0; i < n; i++) { await flush(all.subarray(i * ecs, Math.min(all.length, (i + 1) * ecs))); if (onProg) onProg((i + 1) / n); }
      return new Blob(parts, { type: mime || 'application/octet-stream' });
    }
    n = Math.max(1, Math.ceil(total / ecs));
    let buf = new Uint8Array(0), got = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        got += value.length;
        if (opts.signal?.aborted || (opts.maxBytes && got > opts.maxBytes)) { await reader.cancel(); throw Error('Previzualizare anulată sau prea mare'); }
        const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
        while (buf.length > ecs || (buf.length === ecs && idx < n - 1)) { await flush(buf.slice(0, ecs)); buf = buf.slice(ecs); }
        if (onProg && total) onProg(got / total);
      }
      if (done) break;
    }
    if (buf.length) await flush(buf);
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  }

  /* ---------------- cod de siguranță (verificare în afara aplicației) ---------------- */
  async function safetyCode(conv) {
    const ids = (conv.members || []).map(m => m.id).sort((a, b) => a - b);
    const fps = [];
    for (const id of ids) { const p = await getPub(id); if (!p) return null; fps.push(id + ':' + p.fp); }
    const h = new Uint8Array(await subtle.digest('SHA-256', te.encode(fps.join('|'))));
    let digits = '';
    for (let i = 0; i < 30; i += 5) {
      const v = ((h[i] << 24) | (h[i + 1] << 16) | (h[i + 2] << 8) | h[i + 3]) >>> 0;
      digits += String(v % 100000).padStart(5, '0') + String((v ^ (h[i + 4] << 8)) % 100000).padStart(5, '0');
    }
    return digits.match(/.{5}/g).join(' ');
  }

  return {
    supported, init, unlock, afterLogin, forget, prefetch, invalidateUser, convStatus,
    encryptText, decryptText, encryptJson, decryptJson, fileEncryptor, decryptFileMeta, decryptFile, safetyCode,
    invalidateGroup: cid => groups.delete(cid),
    get state() { return st.state; }, get fingerprint() { return st.fp; },
  };
})();
