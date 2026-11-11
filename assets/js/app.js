/* =========================================================================
   VORBITozaur — client (vanilla JS)
   ========================================================================= */
(() => {
  'use strict';
  const A = window.APP;
  const $ = (s, r = document) => r.querySelector(s);
  /* v2.1.2: panou unic pe telefon — și când Chrome „Request Desktop Site” lărgește layout-ul */
  const NARROW_BP = 900;
  const isNarrow = () => {
    try {
      if (document.documentElement.classList.contains('mq-narrow')) return true;
      if (innerWidth <= NARROW_BP) return true;
      const sw = Math.min(screen.width || 0, screen.height || 0);
      return sw > 0 && sw <= 520; // ecran fizic de telefon
    } catch (e) { return innerWidth <= NARROW_BP; }
  };
  const syncNarrowClass = () => {
    let on = false;
    try {
      const sw = Math.min(screen.width || 0, screen.height || 0);
      on = innerWidth <= NARROW_BP || (sw > 0 && sw <= 520);
    } catch (e) { on = innerWidth <= NARROW_BP; }
    document.documentElement.classList.toggle('mq-narrow', on);
    return on;
  };

  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const isNum = v => typeof v === 'number';
  const fmtSize = P2P.fmtSize;
  const LIKE_EMOJI = '👍';
  // Retired stored codes remain in history, but never enter UI/layout/notifications.
  const isRetiredReaction = code => /^fire[123]$/.test(String(code || ''));
  const visibleReactions = m => (m?.reactions || []).filter(x=>!isRetiredReaction(x.emoji));
  const isLikeCode = code => [LIKE_EMOJI,'like','thumbsup'].includes(String(code || ''));
  const reactionLabel = code => isLikeCode(code) ? 'Like' : String(code || '');

  /* ---------------- stare ---------------- */
  const S = {
    me: A.me,
    convs: new Map(),
    contactPrefs: new Map(),
    restrictedContacts: new Set(),
    users: new Map([[A.me.id, A.me]]),
    current: null,
    msgs: new Map(),
    receipts: new Map(),
    typing: new Map(),
    online: {},
    presence: {},
    serverOffset: 0,
    cursor: 0,
    replyTo: null,
    drafts: new Map(),
    blobByAtt: new Map(),
    readSent: new Map(),
    settings: null,
    contacts: new Map(),
    e2eConv: new Map(),   // cid -> {on, reason}
  };

  let pendingListStatus=null, statusChangeSequence=0;
  function syncContactListMode(status=pendingListStatus ?? S.me.status) {
    const invisible=status==='invisible', root=document.documentElement;
    root.classList.toggle('self-invisible',invisible);
    root.style.setProperty('--contact-list-font-style',invisible ? 'italic' : 'normal');
  }
  syncContactListMode();

  /* ---------------- API ---------------- */
  let sessionRefresh = null;
  function refreshSession() {
    if (!sessionRefresh) sessionRefresh = (async () => {
      const r = await fetch('api/auth.php?action=me', { credentials: 'same-origin', cache: 'no-store' });
      if (r.status === 401) { location.href = 'login.php'; throw new Error('auth'); }
      const j = await r.json();
      if (!r.ok || !j.ok || !j.csrf) throw new Error(j.error || 'Reconectarea nu este disponibilă momentan.');
      // Never replay an old tab's send/edit/settings request as a different account.
      if (Number(j.user?.id) !== Number(A.me.id)) { location.href = 'index.php'; throw new Error('Contul conectat s-a schimbat.'); }
      A.csrf = j.csrf;
      if(j.user)applyUser(j.user); // A restored session also carries the current manual self status.
      const meta = $('meta[name="csrf-token"]'); if (meta) meta.content = j.csrf;
    })().finally(() => { sessionRefresh = null; });
    return sessionRefresh;
  }
  async function api(path, opts = {}, resumed = false) {
    const o = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-CSRF-Token': A.csrf } };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    if (opts.signal) o.signal = opts.signal;
    const r = await fetch(path, o);
    // 401/419 reject authentication/CSRF BEFORE mutations; never retry network errors or successes.
    if (!resumed && (r.status === 401 || r.status === 419)) {
      await refreshSession();
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return api(path, opts, true);
    }
    if (r.status === 401) { location.href = 'login.php'; throw new Error('auth'); }
    let j;
    try { j = await r.json(); } catch (_) { throw new Error('Eroare server (' + r.status + ')'); }
    if (!j.ok) throw new Error(j.error || 'Eroare');
    return j;
  }

  window.TexSession = { request: api }; // Shared guarded path for authenticated recovery settings.

  /* ---------------- emoticoane Yahoo! ---------------- */
  const EMO = window.YM_EMOTICONS || [];
  const emoMap = new Map(EMO.map(e => [e[2].toLowerCase(), e]));
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const emoSorted = EMO.slice().sort((a, b) => b[2].length - a[2].length);
  let emoRe;
  try {
    emoRe = new RegExp(emoSorted.map(e => (/^[a-z0-9]/i.test(e[2]) ? '(?<![a-z0-9])' : '') + reEsc(e[2])).join('|'), 'gi');
  } catch (_) {
    emoRe = new RegExp(emoSorted.map(e => reEsc(e[2])).join('|'), 'gi');
  }
  // v2.0.3: emoticoane Yahoo! HD (8×, xBR lanț, WebP animat); dacă WebP nu merge => GIF-ul original
  const emoSrc = name => `assets/emoticons/hd/${name}.webp?v=3`;
  const emoImg = e => `<img class="ym" src="${emoSrc(e[0])}" data-gif="${e[0]}" alt="${esc(e[2])}" title="${esc(e[1] + '  ' + e[2])}" draggable="false">`;
  document.addEventListener('error', ev => { const t = ev.target; if (t && t.tagName === 'IMG' && t.dataset && t.dataset.gif && !t.dataset.fb) { t.dataset.fb = '1'; t.src = 'assets/emoticons/' + t.dataset.gif + '.gif'; } }, true);
  function emoText(t) {
    if (S.settings && S.settings.emo === false) return esc(t);
    let out = '', last = 0, m;
    emoRe.lastIndex = 0;
    while ((m = emoRe.exec(t))) {
      const e = emoMap.get(m[0].toLowerCase());
      if (!e) continue;
      out += esc(t.slice(last, m.index)) + emoImg(e);
      last = m.index + m[0].length;
    }
    return out + esc(t.slice(last));
  }
  const urlRe = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,:;!?)\]]/gi;
  function rich(text) {
    text = String(text ?? '');
    let out = '', last = 0, m;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(text))) {
      out += emoText(text.slice(last, m.index));
      out += `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer nofollow">${esc(m[0])}</a>`;
      last = m.index + m[0].length;
    }
    return out + emoText(text.slice(last));
  }
  function isJumbo(text) {
    if (!text || text.length > 40) return false;
    let n = 0;
    let rest = text;
    if (!(S.settings && S.settings.emo === false)) rest = rest.replace(emoRe, () => { n++; return ''; });
    rest = rest.replace(/(\p{Extended_Pictographic}(\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*)/gu, () => { n++; return ''; }).replace(/[\s\uFE0F]/g, '');
    return rest === '' && n > 0 && n <= 3;
  }

  /* ---------------- formatare ---------------- */
  const tf = new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit' });
  const wf = new Intl.DateTimeFormat('ro-RO', { weekday: 'long' });
  const df = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
  const dsf = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short' });
  const fmtTime = ts => tf.format(new Date(ts * 1000));
  function fmtSep(ts) {
    const d = new Date(ts * 1000), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return 'Azi, ' + fmtTime(ts);
    if (diff === 1) return 'Ieri, ' + fmtTime(ts);
    if (diff < 7) { const w = wf.format(d); return w.charAt(0).toUpperCase() + w.slice(1) + ', ' + fmtTime(ts); }
    return df.format(d) + ', ' + fmtTime(ts);
  }
  function fmtShort(ts) {
    const s = Date.now() / 1000 - ts;
    if (s < 60) return 'acum';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 604800) return roCount(Math.floor(s / 86400), 'zi', 'zile');
    return dsf.format(new Date(ts * 1000));
  }
  const presenceNow = () => Date.now() / 1000 - (S.serverOffset || 0);
  function effectivePresence(id) {
    const p = S.presence[id];
    if (p) return TexPresence.effective(p, presenceNow());
    const u = S.users.get(+id);
    return TexPresence.effective({ manual: u?.status || 'available', last_activity: S.online[id] || u?.last_seen || 0 }, presenceNow());
  }
  const isOnline = id => effectivePresence(id).online;
  function lastSeenText(id) {
    const p = effectivePresence(id);
    if (p.idle) return 'Plecat';
    if (p.online) return S.presence[id]?.connection === 'uncertain' ? 'Activitate recentă' : 'Activ acum';
    return ''; // all offline/hidden states use the same peer-visible presentation
  }
  const initials = u => { const p = String(u.display_name || u.username || '?').trim().split(/\s+/); return esc(((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()); };
  const safeColor = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#0084ff';
  /* status tip Yahoo! Messenger */
  const STATUS = {
    available: { label: 'Disponibil' }, busy: { label: 'Ocupat' }, away: { label: 'Plecat' },
    invisible: { label: 'Invizibil' }, offline: { label: 'Invizibil' }, // statusul vechi rămâne compatibil
  };
  const statusOf = u => u && (S.presence[u.id] || S.online[u.id] || u.last_seen) ? effectivePresence(u.id).status : ((u && STATUS[u.status]) ? u.status : 'available');
  // Presentation-only comparison: never rewrite stored/custom status text or presence state.
  const statusTextKey = text => {
    const key=String(text||'').normalize('NFKC').trim().replace(/\s+/g,' ').replace(/\s*\/\s*/g,'/').toLocaleLowerCase('ro-RO');
    return key==='plecat/idle'||key==='idle'?'plecat':(key==='activ(ă) acum'||key==='activ acum')?'disponibil':key;
  };
  function distinctStatusSuffix(primary,secondary){
    const text=String(secondary||'').trim();
    if(!text)return '';
    return String(primary||'').split(/\s+·\s+/).some(part=>statusTextKey(part)===statusTextKey(text))?'':text;
  }
  /** textul afișat sub nume: mesajul personalizat sau eticheta tipului (pentru ocupat/plecat) */
  function statusLine(u) {
    if (!u) return '';
    const st = statusOf(u);
    if (st === 'offline') return '';
    const txt = String(u.status_text || '').trim();
    if (effectivePresence(u.id).idle) {
      const label='Plecat',detail=distinctStatusSuffix(label,txt);
      return label+(detail?' · '+detail:'');
    }
    return txt || (st === 'busy' || st === 'away' ? STATUS[st].label : '');
  }
  const statusDot = u => `<i class="sdot s-${statusOf(u)}" title="${esc(STATUS[statusOf(u)].label)}"></i>`;
  const avatar = (u, cls = '', online = false) => {
    const st = u && online && (statusOf(u) === 'busy' || statusOf(u) === 'away') ? ' st-' + statusOf(u) : '';
    const img = u && u.avatar ? `<img src="${esc(u.avatar)}" alt="" loading="lazy" decoding="async" draggable="false">` : '';
    return `<div class="avatar ${cls}${online ? ' online' : ''}${st}${img ? ' has-img' : ''}" style="--c:${safeColor(u && u.avatar_color)}" data-uid="${u ? u.id : ''}">${img || (u ? initials(u) : '?')}<span class="dot"></span></div>`;
  };
  const displayName = u => u ? (u.id !== S.me.id && S.contactPrefs.get(+u.id)?.alias || u.display_name || u.username || 'Contact') : 'Contact';
  const verifiedBadge = u => u?.verified ? '<span class="tex-verified" role="img" title="Tex Verified" aria-label="Tex Verified"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11"/><path d="m7 12 3 3 7-7"/></svg></span>' : '';
  // The stored TESTER value is a short, allow-listed code, not an authorization role.
  const staffLabels = new Map([['ADMIN','ADMIN'],['MOD','MOD'],['TESTER','PRODUCT TESTER']]);
  const staffBadge = u => {
    const label=staffLabels.get(u?.staff_label);
    return label ? '<span class="tex-staff tex-staff-'+u.staff_label.toLowerCase()+'" title="Etichetă vizuală atribuită de administratorii Tex; nu acordă permisiuni" aria-label="'+label+' — etichetă vizuală Tex">'+label+'</span>' : '';
  };
  const verifiedName = (u, label = displayName(u)) => {
    const badges=verifiedBadge(u)+staffBadge(u);
    return badges ? '<span class="verified-name"><span class="verified-name-text">'+esc(label)+'</span>'+badges+'</span>' : esc(label);
  };

  // Fade only the name text, never the independently colored verified/staff badges.
  const contactListName = (u, label = displayName(u)) => {
    const html=verifiedName(u,label);
    return u?.verified || staffLabels.has(u?.staff_label) ? html : '<span class="contact-name-text">'+html+'</span>';
  };
  const nameOf = id => { const u = S.users.get(id); return u ? displayName(u) : 'Utilizator'; };
  const directRestricted = cid => !isGroup(cid) && S.restrictedContacts.has(+peerOf(cid).id);
  const firstName = id => nameOf(id).split(/\s+/)[0];

  /* ---------------- UI helpers ---------------- */
  function toast(msg, err, action) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    if (action) {
      const b = document.createElement('button');
      b.className = 'toast-btn'; b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); t.classList.add('out'); setTimeout(() => t.remove(), 320); });
      t.appendChild(b);
    }
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, action ? 9000 : (err ? 4500 : 3000));
  }
  function openModal(el) { el.hidden = false; el.classList.remove('closing'); }
  function closeModal(el) { if (el.hidden) return; if (el.id === 'settings' && window.TexSettings) TexSettings.dismiss(); el.dispatchEvent(new Event('tex-modal-close')); el.classList.add('closing'); setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, 220); }
  function closePopover(el) { if (el.id === 'convMenu') $('#btnMore').setAttribute('aria-expanded', 'false'); if (el.hidden) return; el.classList.add('closing'); setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, 170); }
  function placePopover(pop, anchor, align = 'left') {
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = align === 'right' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, innerWidth - pw - 8));
    let top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    pop.style.setProperty('--ox', (r.left + r.width / 2 - left) + 'px');
    pop.style.setProperty('--oy', top < r.top ? '100%' : '0%');
  }

  /* v2.0: sunete Yahoo! Messenger (mesaj nou, conectare, deconectare) */
  const SND = {};
  function playSnd(name) {
    if (S.settings && S.settings.sound === false) return;
    try {
      const a = SND[name] || (SND[name] = Object.assign(new Audio('assets/sounds/' + name + '.mp3?v=' + encodeURIComponent(A.v || '2')), { preload: 'auto' }));
      a.pause(); a.currentTime = 0;
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => {});
    } catch (_) {}
  }
  /* v2.0.2: un singur criteriu „e al meu?” — robust la id string vs number și la mesajele locale/optimiste.
     Orice mesaj creat în ACEST browser (client_uid în OWN_UIDS), orice temporar (tmp_ / _state), sau cu
     sender_id == eu (numeric) e „al meu” => niciodată sunet. */
  const OWN_UIDS = new Set();
  const sameId = (a, b) => a != null && b != null && String(a).trim() !== '' && Number(a) === Number(b) && !Number.isNaN(Number(a));
  function isMine(m) {
    if (!m) return true; // fără mesaj => fără sunet
    if (m._own || m._state || m.outgoing || m.mine) return true;
    if (typeof m.id === 'string' && m.id.indexOf('tmp_') === 0) return true;
    if (m.client_uid && OWN_UIDS.has(m.client_uid)) return true;
    if (!S.me || m.sender_id == null || String(m.sender_id).trim() === '' || !Number.isFinite(Number(m.sender_id))) return true; // expeditor necunoscut => tăcere
    return sameId(m.sender_id, S.me.id);
  }
  /** Sunet mesaj nou — DOAR pentru mesaje primite de la altcineva. Verificarea e aici, nu la apelant. */
  function msgSound(m) {
    if (isMine(m) || S.restrictedContacts.has(+m.sender_id)) return;
    playSnd('mesaje');
  }
  let actx = null;
  function pop() {
    if (S.settings && S.settings.sound === false) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.26);
    } catch (_) {}
  }

  /* =====================================================================
     TEME & PALETE
     ===================================================================== */
  const PALETTES = [
    { id: 'vorbitozaur', name: 'Tex', sent: '#245c82', bgDark: '#15191c', recvDark: '#282e31', recvTextDark: '#f2f0eb', textDark: '#f2f0eb', bgLight: '#f7f6f2', recvLight: '#eeece6', recvTextLight: '#25292b' },
    { id: 'messenger', name: 'Clasic', sent: '#0084ff' },
    { id: 'gradient', name: 'Gradient', sent: '#a033ff', grad: 'linear-gradient(180deg,#ff6a88 0%,#a033ff 45%,#0084ff 100%)', gradDefault: true },
    { id: 'imessage', name: 'iMessage', sent: '#0a84ff', recvLight: '#e9e9eb', recvDark: '#262629' },
    { id: 'ocean', name: 'Ocean', sent: '#0077b6', grad: 'linear-gradient(180deg,#48cae4,#0077b6)', bgLight: '#f2fbff', bgDark: '#04131d', recvLight: '#e1f3fb', recvDark: '#12303f' },
    { id: 'sunset', name: 'Apus', sent: '#ff5e62', grad: 'linear-gradient(180deg,#ffb347,#ff5e62)', bgLight: '#fff8f4', bgDark: '#1a0d0a', recvLight: '#fdebe3', recvDark: '#33201b' },
    { id: 'forest', name: 'Pădure', sent: '#2e9e5b', grad: 'linear-gradient(180deg,#7bd389,#2e9e5b)', bgLight: '#f4faf5', bgDark: '#07140c', recvLight: '#e2f1e6', recvDark: '#17291e' },
    { id: 'lavender', name: 'Lavandă', sent: '#8b5cf6', grad: 'linear-gradient(180deg,#c084fc,#7c3aed)', bgLight: '#faf7ff', bgDark: '#100a1c', recvLight: '#efe7fd', recvDark: '#241a38' },
    { id: 'candy', name: 'Bomboană', sent: '#ff4fa3', grad: 'linear-gradient(180deg,#ff9ad5,#ff4fa3)', bgLight: '#fff6fb', bgDark: '#1c0a13', recvLight: '#fde4f1', recvDark: '#371d2a' },
    { id: 'yahoo', name: 'Yahoo!', sent: '#7b0099', grad: 'linear-gradient(180deg,#a64ac9,#6a0080)', recvLight: '#fff4c2', recvTextLight: '#3b2c00', recvDark: '#3a3000', recvTextDark: '#ffe9a3', bgLight: '#fcf8ff', bgDark: '#0f0614' },
    { id: 'midnight', name: 'Miezul nopții', sent: '#4f46e5', grad: 'linear-gradient(180deg,#6366f1,#312e81)', bgLight: '#f1f2ff', bgDark: '#0a0b1e', recvLight: '#e2e4ff', recvDark: '#1d2040' },
    { id: 'coffee', name: 'Cafea', sent: '#8d5b3c', grad: 'linear-gradient(180deg,#b07d56,#6f4428)', bgLight: '#fbf6f1', bgDark: '#140d08', recvLight: '#efe4d9', recvDark: '#2c2119' },
    { id: 'mono', name: 'Monocrom', sentLight: '#1c1c1e', sentTextLight: '#ffffff', sentDark: '#e5e5ea', sentTextDark: '#000000', sent: '#1c1c1e' },
  ];
  const MODE_DEF = {
    light: { recv: '#f0f0f0', recvText: '#050505', bg: '#ffffff', text: '#050505', sentText: '#ffffff' },
    dark: { recv: '#303030', recvText: '#e4e6eb', bg: '#000000', text: '#e4e6eb', sentText: '#ffffff' },
  };
  // implicit: tema „VORBITozaur” (negru + albastru)
  const DEFAULT_SETTINGS = { mode: 'light', palette: 'vorbitozaur', custom: null, gradient: false, sound: true, enter: true, emo: true, zoom: 100, notify: true, wall: null, presence: false, presenceUsers: [], presenceSound: false, presenceV217: true, e2eStrict: true };
  function resolvedMode() {
    const m = S.settings.mode;
    return m === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (m === 'dark' ? 'dark' : 'light');
  }
  function paletteColors(id, mode) {
    const p = PALETTES.find(x => x.id === id) || PALETTES[0];
    const sfx = mode === 'dark' ? 'Dark' : 'Light';
    const d = MODE_DEF[mode];
    const pick = k => p[k + sfx] ?? p[k] ?? d[k];
    return { sent: pick('sent'), sentText: pick('sentText'), recv: pick('recv'), recvText: pick('recvText'), bg: pick('bg'), text: pick('text'), grad: p.grad || null };
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = c => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
    return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(v || '');
  function wallColorDefaults(colors) {
    // Keep Neon defaults/swatch values identical to rendered colors; custom fields override below.
    if(S.settings.wall==='albastruNeon'){colors.sentText='#eff9ff';colors.recvText='#e2f0fa';colors.bg='#03080e';}
    return colors;
  }
  function currentColors() {
    const mode = resolvedMode();
    if (S.settings.palette === 'custom' && S.settings.custom) {
      const c = wallColorDefaults(paletteColors('messenger', mode));
      for (const k of ['sent', 'sentText', 'recv', 'recvText', 'bg', 'text']) if (hexOk(S.settings.custom[k])) c[k] = S.settings.custom[k];
      c.grad = `linear-gradient(180deg, ${shade(c.sent, 0.35)}, ${c.sent} 55%, ${shade(c.sent, -0.25)})`;
      return c;
    }
    const colors = wallColorDefaults(paletteColors(S.settings.palette, mode));
    const studio = typeof WALLS !== 'undefined' && WALLS.find(w => w.id === S.settings.wall && w.studio);
    if (studio && S.settings.palette === studio.palette) Object.assign(colors, studio.colors);
    return colors;
  }
  const APP_BRAND = 'Tex';
  function ensureBrand() {
    const heading = $('#sidebarBrand') || $('.sb-head h1');
    if (heading) { if (heading.id !== 'sidebarBrand') heading.id='sidebarBrand'; if (heading.textContent !== APP_BRAND) heading.textContent=APP_BRAND; }
  }
  ensureBrand();
  if ($('.sb-head')) new MutationObserver(ensureBrand).observe($('.sb-head'),{childList:true,subtree:true,characterData:true});
  function applyTheme(animate) {
    ensureBrand();
    const doIt = () => {
      const mode = resolvedMode();
      const root = document.documentElement;
      root.dataset.theme = mode;
      root.classList.toggle('pal-vz', S.settings.palette === 'vorbitozaur');
      const c = currentColors();
      const useGrad = S.settings.gradient && c.grad;
      root.style.setProperty('--sent', useGrad ? c.grad : c.sent);
      root.style.setProperty('--sent-solid', c.sent);
      root.style.setProperty('--sent-text', c.sentText);
      root.style.setProperty('--recv', c.recv);
      root.style.setProperty('--recv-text', c.recvText);
      root.style.setProperty('--chat-bg', c.bg);
      root.style.setProperty('--text', c.text);
      root.style.setProperty('--accent', c.sent);
      const meta = $('meta[name=theme-color]'); if (meta) meta.content = c.bg;
      root.style.setProperty('--reaction-accent', c.sent);
      applyWall();
      syncSettingsUI();
    };
    if (animate && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(doIt);
    else doIt();
  }
  let saveT = 0;
  function saveSettings() {
    try { localStorage.setItem('msgr.settings.' + S.me.id, JSON.stringify(S.settings)); } catch (_) {}
    clearTimeout(saveT);
    saveT = setTimeout(() => api('api/auth.php?action=settings', { body: { settings: S.settings } }).catch(() => {}), 600);
  }

  /* =====================================================================
     CONVERSAȚII
     ===================================================================== */
  const peerOf = convId => {
    const c = S.convs.get(convId);
    if (!c) return S.me;
    return c.members.find(m => m.id !== S.me.id) || S.me;
  };
  const convOf = cid => S.convs.get(cid);
  // Presentation only: canonical usernames, never display names/private aliases or numeric guesses.
  const buzzCaption = cid => {
    const c=S.convs.get(+cid);
    if(!c || c.is_group || c.members.length!==2)return 'BUZZ!!!';
    const names=c.members.map(u=>String(u.username || '').toLowerCase());
    return names.includes('mihaib') && names.includes('txc') ? 'NIR !!!' : 'BUZZ!!!';
  };
  function updateBuzzSendLabel(cid) {
    const caption=buzzCaption(cid), special=caption==='NIR !!!', button=$('#btnSend'), label=$('.ic-buzz b',button);
    const text=special ? caption : 'BUZZ!';if(label && label.textContent!==text)label.textContent=text;
    const title='Trimite mesajul sau un '+caption+' (Ctrl+G)';if(button.title!==title)button.title=title;
    const aria=special ? 'Trimite mesajul sau '+caption : 'Trimite mesajul sau un BUZZ';if(button.getAttribute('aria-label')!==aria)button.setAttribute('aria-label',aria);
  }
  const isGroup = cid => !!(S.convs.get(cid) && S.convs.get(cid).is_group);
  function convTitle(c) {
    if (!c) return '';
    if (!c.is_group) return displayName(peerOf(c.id));
    if (c.title) return c.title;
    return c.members.filter(m => m.id !== S.me.id).map(m => String(m.display_name).split(/\s+/)[0]).join(', ') || 'Grup';
  }
  function groupAvatar(c, cls = '') {
    const others = c.members.filter(m => m.id !== S.me.id);
    const a = others[0], b = others[1] || S.me;
    const on = others.some(m => isOnline(m.id));
    return `<div class="gavatar ${cls}${on ? ' online' : ''}">${avatar(a, 'g1')}${avatar(b, 'g2')}<span class="dot"></span></div>`;
  }
  const convAvatar = (c, cls = '') => c.is_group ? groupAvatar(c, cls) : avatar(peerOf(c.id), cls, isOnline(peerOf(c.id).id));
  function ingestConv(c) {
    for (const m of c.members) { S.users.set(m.id, Object.assign(S.users.get(m.id) || {}, m)); if (m.last_seen && !(S.online[m.id] > m.last_seen)) S.online[m.id] = m.last_seen; }
    const rc = {};
    for (const r of c.receipts || []) rc[r.user_id] = { delivered: r.delivered, read: r.read };
    S.receipts.set(c.id, rc);
    const old = S.convs.get(c.id);
    S.convs.set(c.id, Object.assign(old || {}, c));
  }
  function systemText(m) {
    const me = m.sender_id === S.me.id;
    const who = me ? 'Tu' : nameOf(m.sender_id);
    const mt = m.meta || {};
    switch (mt.event) {
      case 'group_created': return `${who} ${me ? 'ai creat' : 'a creat'} grupul „${mt.title || ''}”`;
      case 'group_renamed': return `${who} ${me ? 'ai redenumit' : 'a redenumit'} grupul în „${mt.title || ''}”`;
      case 'members_added': return `${who} ${me ? 'ai adăugat' : 'a adăugat'} pe ${(mt.user_ids || []).map(id => id === S.me.id ? 'tine' : nameOf(id)).join(', ')}`;
      case 'member_left': return `${who} ${me ? 'ai părăsit' : 'a părăsit'} grupul`;
      default: return 'Eveniment';
    }
  }
  function snippet(m) {
    if (!m) return '';
    const mine = m.sender_id === S.me.id;
    const who = mine ? 'Tu' : firstName(m.sender_id);
    if (m.type === 'system') return '<i>' + esc(systemText(m)) + '</i>';
    if (m._e2eFail || (m.type === 'text' && m.meta && m.meta.e2e && !m._dec)) return '🔒 ' + esc(mine ? 'Tu: ' : '') + 'Mesaj criptat';
    if (isGroup(m.conversation_id) && !mine && m.type === 'text') return esc(who) + ': ' + rich(String(m.body || '').replace(/\s+/g, ' ').slice(0, 120));
    switch (m.type) {
      case 'image': return esc(mine ? 'Ai trimis o poză' : who + ' a trimis o poză') + ' 📷';
      case 'video': return esc(mine ? 'Ai trimis un clip video' : who + ' a trimis un clip video');
      case 'audio': return esc(mine ? 'Ai trimis un mesaj audio' : who + ' a trimis un mesaj audio');
      case 'file': return esc((mine ? 'Ai trimis ' : who + ' a trimis ') + (m.attachment ? m.attachment.name : 'un fișier'));
      case 'buzz': return '<b class="snip-buzz">📳 ' + esc(mine ? 'Ai dat '+buzzCaption(m.conversation_id) : who+' ți-a dat '+buzzCaption(m.conversation_id)) + '</b>';
      case 'p2p': return '⚡ ' + esc((mine ? 'Ai trimis ' : who + ' trimite ') + 'P2P: ' + ((m.meta && m.meta.files && m.meta.files[0] && m.meta.files[0].name) || 'fișier'));
      default: return (mine ? 'Tu: ' : '') + rich(String(m.body || '').replace(/\s+/g, ' ').slice(0, 120));
    }
  }
  /* ---- titlul tab-ului / ferestrei: „(3) VORBITozaur” + „📳 BUZZ!!!” care clipește ---- */
  const TT = { away: 0, buzz: null, flash: null, on: false };
  function attending() { return !document.hidden && document.hasFocus(); }
  function totalUnread() { let n = 0; for (const c of S.convs.values()) n += Math.max(0, +c.unread || 0); return n + TT.away; }
  function baseTitle() { const n = totalUnread(); return (n ? `(${n > 99 ? '99+' : n}) ` : '') + (A.appName || 'Tex'); }
  function updateTitle() {
    if (TT.buzz) document.title = TT.on ? `📳 ${TT.buzz.caption} · ${TT.buzz.name}` : baseTitle();
    else document.title = baseTitle();
  }
  function titleBuzz(m) {
    TT.buzz = { cid: m.conversation_id, caption:buzzCaption(m.conversation_id), name: firstName(m.sender_id), until: Date.now() + 60000 };
    TT.on = true; updateTitle();
    clearInterval(TT.flash);
    TT.flash = setInterval(() => {
      if (Date.now() > TT.buzz.until) return stopTitleBuzz(); // după 1 minut rămâne doar numărul
      TT.on = !TT.on; updateTitle();
    }, 850);
  }
  function stopTitleBuzz() { clearInterval(TT.flash); TT.flash = null; TT.buzz = null; TT.on = false; updateTitle(); }
  function titleCaughtUp() { // fereastra e în față: ce e în conversația deschisă s-a „văzut”
    if (!attending()) return;
    TT.away = 0;
    if (TT.buzz && (TT.buzz.cid === S.current || !(S.convs.get(TT.buzz.cid) || {}).unread)) stopTitleBuzz();
    updateTitle();
  }
  document.addEventListener('visibilitychange', titleCaughtUp);
  window.addEventListener('focus', titleCaughtUp);

  const convEls = new Map();
  // v2.1.12: păstrăm nodurile rândului; typing/trimitere/receipt nu remontează avatarul sau întregul contact.
  function patchConvHtml(el, html) {
    if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
  }
  function syncConvPresence(li, c) {
    if (c.is_group) {
      li.classList.remove('is-offline');
      const av = $('.gavatar', li);
      if (av) av.classList.toggle('online', c.members.some(m => m.id !== S.me.id && isOnline(m.id)));
      return;
    }
    const p = peerOf(c.id), av = $('.avatar', li), on = isOnline(p.id);
    li.classList.toggle('is-offline', !on);
    if (!av) return;
    av.classList.toggle('online', on);
    av.classList.toggle('st-busy', on && statusOf(p) === 'busy');
    av.classList.toggle('st-away', on && statusOf(p) === 'away');
  }
  function updateConvItem(li, c) {
    // Cheia ignoră prezența (actualizată separat), dar prinde schimbările reale de profil/avatar.
    const avHtml = convAvatar(c), avKey = avHtml.replace(' online', '');
    if (li._avatarKey !== avKey) {
      const old = li.firstElementChild;
      if (old) { const t = document.createElement('div'); t.innerHTML = avHtml; const fresh = t.firstElementChild; if (old.classList.contains('avatar')) syncAvatarNode(old, fresh); else { old.className = fresh.className; stableAvatarHtml(old, fresh.innerHTML); } }
      li._avatarKey = avKey;
    }
    syncConvPresence(li, c);
    const peer = peerOf(c.id), lm = c.last_message;
    const typing = S.typing.get(c.id) && S.typing.get(c.id).size;
    patchConvHtml($('.conv-name', li), `${c.is_group ? '<span class="grp-ic" title="Grup">👥</span>' : ''}${c.is_group ? esc(convTitle(c)) : contactListName(peer,convTitle(c))}${!c.is_group && c.is_contact === false ? ' <span class="tag-new" title="Nu e în contactele tale">nou</span>' : ''}`);
    const sl = c.is_group ? roCount(c.members.length, 'membru', 'membri') : statusLine(peer);
    const status = $('.conv-status', li);
    status.hidden = !sl;
    patchConvHtml(status, sl ? `${c.is_group ? '' : statusDot(peer)}<span>${c.is_group ? esc(sl) : rich(sl)}</span>` : '');
    const typingTxt = typing ? (c.is_group ? esc(firstName(S.typing.get(c.id).values().next().value)) + ' scrie…' : 'scrie…') : '';
    patchConvHtml($('.conv-last', li), typing ? `<span class="typing-mini">${typingTxt}</span>` : (lm ? `<span class="snip">${snippet(lm)}</span><span class="t">· ${fmtShort(lm.created_at)}</span>` : '<span class="snip">Spune salut</span>'));
  }
  function createConvItem(c) {
    const li = document.createElement('li');
    li.className = 'conv new';
    li.dataset.id = c.id;
    const avHtml = convAvatar(c);
    li.innerHTML = `${avHtml}<div class="conv-body"><div class="conv-name"></div><div class="conv-status" hidden></div><div class="conv-last"></div></div><span class="unread-dot"></span><button class="icon-btn small conv-more" data-more="${c.id}" title="Opțiuni conversație" aria-label="Opțiuni"><svg width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z"/></svg></button>`;
    li._avatarKey = avHtml.replace(' online', '');
    li.addEventListener('animationend', () => li.classList.remove('new'), { once: true });
    updateConvItem(li, c);
    return li;
  }
  // Coalesce event bursts; do not rebuild/reposition contacts while a finger is scrolling.
  let convFrame = 0, convDirty = false, convScrollTimer = 0, convScrollAt = 0, convOrder = '';
  const uiVisible = () => !document.hidden && window.__texNativeVisible !== false;
  $('#convList').parentElement.addEventListener('scroll', () => {
    convScrollAt = Date.now(); clearTimeout(convScrollTimer);
    convScrollTimer = setTimeout(() => { if (convDirty) renderConvList(); }, 150);
  }, { passive: true });
  function renderConvList() {
    convDirty = true;
    if (!uiVisible()) { updateTitle(); return; }
    if (convFrame || Date.now() - convScrollAt < 140) return;
    convFrame = requestAnimationFrame(() => {
      convFrame = 0;
      if (!uiVisible()) return;
      if (Date.now() - convScrollAt < 140) return;
      convDirty = false; renderConvListNow();
    });
  }
  function renderConvListNow() {
    syncContactListMode();
    const list = $('#convList'), scroller = list.parentElement;
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const base = Array.from(S.convs.values()).sort((a, b) => (b.updated_at - a.updated_at) || (b.id - a.id));
    const connected = base.filter(c => !c.is_group && isOnline(peerOf(c.id).id));
    const offline = base.filter(c => !c.is_group && !isOnline(peerOf(c.id).id));
    const groups = base.filter(c => c.is_group);
    const sorted = [...connected, ...groups, ...offline];
    const category = c => c.is_group ? 'groups' : isOnline(peerOf(c.id).id) ? 'connected' : 'offline';
    const labels = { connected: 'Online', groups: 'Grupuri', offline: 'Offline' };
    const order = sorted.map(c => category(c) + ':' + c.id).join(',');
    const changed = order !== convOrder;
    const animate = changed && matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = new Map();
    if (animate) convEls.forEach((el, id) => { if (el.isConnected) first.set(id, el.getBoundingClientRect().top); });
    const headers = {}, usedHeaders = new Set();
    list.querySelectorAll('.conv-heading').forEach(h => { headers[h.dataset.category] = h; });
    let index = 0, previousCategory = '';
    sorted.forEach(c => {
      const cat = category(c);
      if (cat !== previousCategory) {
        const h = headers[cat] || document.createElement('li');
        h.className = 'conv-heading'; h.dataset.category = cat; h.setAttribute('role', 'presentation');
        if (h.textContent !== labels[cat]) h.textContent = labels[cat];
        if (list.children[index] !== h) list.insertBefore(h, list.children[index] || null);
        usedHeaders.add(h); index++; previousCategory = cat;
      }
      let li = convEls.get(c.id);
      if (!li) { li = createConvItem(c); convEls.set(c.id, li); }
      else updateConvItem(li, c);
      li.classList.toggle('active', c.id === S.current);
      li.classList.toggle('unread', !!c.unread);
      if (list.children[index] !== li) list.insertBefore(li, list.children[index] || null); index++;
    });
    Object.values(headers).forEach(h => { if (!usedHeaders.has(h)) h.remove(); });
    convEls.forEach((li, id) => { if (!S.convs.has(id)) { li.remove(); convEls.delete(id); } });
    $('#convEmpty').hidden = sorted.length > 0;
    filterConvs();
    // No repeated scrollTop assignment: that can interrupt touch momentum on WebKit.
    if (changed && scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
    convOrder = order;
    if (animate) {
      // Batch all geometry reads BEFORE any animation writes (no per-contact layout flush).
      const moves = [];
      sorted.forEach(c => { const li = convEls.get(c.id), f = first.get(c.id); if (f !== undefined) { const dy = f - li.getBoundingClientRect().top; if (Math.abs(dy) > 1) moves.push([li, dy]); } });
      moves.forEach(([li, dy]) => { li.style.transition = 'none'; li.style.transform = `translateY(${dy}px)`; });
      if (moves.length) requestAnimationFrame(() => requestAnimationFrame(() => moves.forEach(([li]) => { li.style.transition = 'transform .55s var(--spring-soft), background-color .2s'; li.style.transform = ''; })));
    }
    updateTitle();
  }
  const matchU = (u, q) => String(displayName(u)).toLowerCase().includes(q) || String(u.username || '').toLowerCase().includes(q);
  function filterConvs() {
    const q = $('#search').value.trim().toLowerCase();
    let shown = 0;
    convEls.forEach((li, id) => {
      const c = S.convs.get(id);
      const ok = !q || (c && (c.is_group ? (convTitle(c).toLowerCase().includes(q) || c.members.some(m => m.id !== S.me.id && matchU(m, q))) : matchU(peerOf(id), q)));
      li.hidden = !ok; if (ok) shown++;
    });
    $$('#convList .conv-heading').forEach(h => { let n = h.nextElementSibling, any = false; while (n && !n.classList.contains('conv-heading')) { if (!n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; });
    // v2.0: căutarea e DOAR în contactele mele (local). Persoane noi => butonul „Adaugă”.
    const box = $('#searchResults');
    if (!q) { box.hidden = true; box.innerHTML = ''; delete box._stableHtml; return; }
    const inList = new Set([...S.convs.values()].filter(c => !c.is_group).map(c => peerOf(c.id).id));
    const extra = [...S.contacts.values()].filter(u => !inList.has(u.id) && matchU(u, q));
    const extraGroup = (users, label) => users.length ? '<h5>'+label+'</h5>' + users.map(u => `<div class="conv${isOnline(u.id) ? '' : ' is-offline'}" data-user="${u.id}">${avatar(u, '', isOnline(u.id))}<div class="conv-body"><div class="conv-name">${contactListName(u)}</div><div class="conv-last"><span class="snip">@${esc(u.username)}${statusLine(u) ? ' · ' + rich(statusLine(u)) : ''}</span></div></div></div>`).join('') : '';
    let html = extraGroup(extra.filter(u=>isOnline(u.id)), 'Online') + extraGroup(extra.filter(u=>!isOnline(u.id)), 'Offline');
    if (!extra.length && !shown) html += `<div class="empty">Nu am găsit niciun contact pentru „${esc(q)}”.</div>`;
    html += `<button class="btn ghost wide add-hint" data-addq="${esc($('#search').value.trim())}">Caută „${esc($('#search').value.trim())}” printre utilizatorii noi</button>`;
    stableAvatarHtml(box, html); box.hidden = false;
  }
  async function loadConversations() {
    const j = await api('api/conversations.php');
    const seen = new Set(j.conversations.map(c => c.id));
    for (const id of [...S.convs.keys()]) if (!seen.has(id)) dropConv(id); // șterse/distruse între timp
    j.conversations.forEach(ingestConv);
    if (E2E.state === 'ready') {
      E2E.prefetch(j.conversations.flatMap(c => c.members.map(m => m.id))).catch(() => {});
      await Promise.all(j.conversations.map(c => prep(c.last_message).catch(() => {})));
    }
    renderConvList();
  }

  /* ---------------- căutare în contacte (locală) ---------------- */
  $('#search').addEventListener('focus', e => { e.target.removeAttribute('readonly'); });
  $('#search').addEventListener('pointerdown', e => { e.target.removeAttribute('readonly'); });
  $('#search').addEventListener('input', filterConvs);
  $('#search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; e.target.dispatchEvent(new Event('input')); } });
  async function openWithUser(userId) {
    const j = await api('api/conversations.php?action=open', { body: { user_id: userId } });
    await prepConv(j.conversation);
    ingestConv(j.conversation);
    renderConvList();
    openConversation(j.conversation.id);
  }
  $('#searchResults').addEventListener('click', async e => {
    const add = e.target.closest('[data-addq]');
    if (add) { openAddModal(add.dataset.addq); return; }
    const it = e.target.closest('[data-user]');
    if (!it) return;
    try { $('#search').value = ''; filterConvs(); await openWithUser(+it.dataset.user); } catch (err) { toast(err.message, true); }
  });
  $('#convList').addEventListener('click', e => {
    const mb = e.target.closest('[data-more]');
    if (mb) { e.stopPropagation(); openConvMenu(+mb.dataset.more, mb); return; }
    const li = e.target.closest('.conv'); if (li) openConversation(+li.dataset.id);
  });
  $('#convList').addEventListener('contextmenu', e => { const li = e.target.closest('.conv'); if (!li) return; e.preventDefault(); openConvMenu(+li.dataset.id, null, e.clientX, e.clientY); });

  /* ---------------- contacte: Adaugă / Șterge ---------------- */
  async function loadContacts() {
    const j = await api('api/contacts.php');
    S.contacts = new Map(j.contacts.map(u => [u.id, u]));
    S.contactPrefs = new Map((j.preferences || []).map(p => [+p.user_id,p]));
    S.restrictedContacts = new Set((j.restricted_ids || []).map(Number));
    j.contacts.forEach(u => { S.users.set(u.id, Object.assign(S.users.get(u.id) || {}, u)); if (u.last_seen && !(S.online[u.id] > u.last_seen)) S.online[u.id] = u.last_seen; });
  }
  const addM = $('#addModal');
  let addT = 0, addSeq = 0;
  function openAddModal(q) {
    openModal(addM);
    const inp = $('#addSearch');
    inp.value = q || '';
    runAddSearch();
    setTimeout(() => inp.focus(), 60);
  }
  function runAddSearch() {
    clearTimeout(addT);
    const q = $('#addSearch').value.trim();
    const box = $('#addResults');
    if (q.length < 2) { box.innerHTML = '<div class="empty muted">Scrie cel puțin două caractere din numele sau din numele de utilizator al persoanei.</div>'; return; }
    addT = setTimeout(async () => {
      const seq = ++addSeq;
      try {
        const j = await api('api/users.php?q=' + encodeURIComponent(q));
        if (seq !== addSeq) return;
        // v2.0.2: căutare globală; contactele existente nu pot fi re-adăugate (apar separat, cu „Scrie”)
        const newU = (j.users || []).filter(u => !S.contacts.has(+u.id));
        const known = (j.contacts || []).concat((j.users || []).filter(u => S.contacts.has(+u.id)));
        const row = (u, isC) => {
          S.users.set(u.id, Object.assign(S.users.get(u.id) || {}, u));
          return `<div class="add-row" data-uid="${u.id}">${avatar(u, '', isOnline(u.id))}<div class="conv-body"><div class="conv-name">${verifiedName(u)}</div><div class="conv-last"><span class="snip">@${esc(u.username)}${statusLine(u) ? ' · ' + rich(statusLine(u)) : ''}</span></div></div>${isC ? `<button class="btn ghost" data-open="${u.id}">Scrie</button>` : `<button class="btn primary" data-add="${u.id}">Adaugă</button>`}</div>`;
        };
        box.innerHTML = (newU.length ? newU.map(u => row(u, false)).join('') : '<div class="empty muted">Nu am găsit niciun utilizator nou pentru „' + esc(q) + '”.</div>')
          + (known.length ? '<div class="muted small" style="margin:10px 4px 4px">Deja în contactele tale</div>' + known.map(u => row(u, true)).join('') : '');
      } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
    }, 220);
  }
  $('#addSearch').addEventListener('input', runAddSearch);
  addM.addEventListener('click', async e => {
    if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) return closeModal(addM);
    const o = e.target.closest('[data-open]');
    if (o) { closeModal(addM); $('#search').value = ''; filterConvs(); try { await openWithUser(+o.dataset.open); } catch (err) { toast(err.message, true); } return; }
    const b = e.target.closest('[data-add]');
    if (!b) return;
    b.disabled = true;
    try {
      const id = +b.dataset.add;
      const j = await api('api/contacts.php?action=add', { body: { user_id: id } });
      S.contacts.set(id, j.contact);
      b.textContent = 'Adăugat'; b.classList.remove('primary');
      toast(j.contact.display_name + ' este acum în contactele tale');
      closeModal(addM);
      $('#search').value = ''; filterConvs();
      await openWithUser(id);
    } catch (err) { b.disabled = false; toast(err.message, true); }
  });
  $('#btnNew').addEventListener('click', () => openAddModal($('#search').value.trim()));

  /* ---------------- confirmare (modal) ---------------- */
  function confirmBox({ title, text, ok = 'Confirmă', danger = false, cancel = 'Anulează' }) {
    return new Promise(res => {
      const m = $('#confirmModal');
      $('#cfTitle').textContent = title;
      $('#cfText').innerHTML = text;
      const okB = $('#cfOk');
      okB.textContent = ok; okB.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
      $('#cfCancel').textContent = cancel;
      const done = v => { m.removeEventListener('click', h); closeModal(m); res(v); };
      const h = e => {
        if (e.target === okB) done(true);
        else if (e.target.id === 'cfCancel' || e.target.classList.contains('modal-backdrop')) done(false);
      };
      m.addEventListener('click', h);
      openModal(m);
      setTimeout(() => okB.focus(), 50);
    });
  }

  /* ---------------- meniu conversație: ștergere / distrugere / contact / grup ---------------- */
  window.addEventListener('tex-download-error', e => toast(e.detail, true));
  const convMenu = $('#convMenu');
  let menuFor = null;
  function openConvMenu(cid, anchor, x, y) {
    const c = S.convs.get(cid);
    if (!c) return;
    menuFor = cid;
    const peer = peerOf(cid);
    const isCreator = c.created_by === S.me.id;
    const items = [];
    if (c.is_group) items.push(['info', '', 'Informații despre grup']);
    else items.push(['contactinfo', '', 'Informații contact']);
    items.push(['safety', '', 'Cod de siguranță E2E']);
    if (!c.is_group) items.push(c.is_contact === false ? ['addc', '', 'Adaugă în contacte'] : ['delc', '', 'Șterge contactul']);
    items.push(['delete', '', 'Șterge conversația (doar pentru mine)']);
    if (c.is_group) items.push(['leave', '', 'Părăsește grupul']);
    if (!c.is_group || isCreator) items.push(['destroy', '', c.is_group ? 'Șterge definitiv grupul (pentru toți)' : 'Șterge definitiv conversația (pentru amândoi)', 'danger']);
    $('#convHeadActions').hidden = !anchor || anchor.id !== 'btnMore';
    $('#btnMore').setAttribute('aria-expanded', String(!!anchor && anchor.id === 'btnMore'));
    $('#convMenuItems').innerHTML = `<div class="cm-title">Contact și securitate · ${esc(convTitle(c))}</div>` + items.map(i => `${i[0] === 'delete' ? '<hr><div class="cm-category">Administrare</div>' : ''}<button data-cm="${i[0]}" class="${i[3] || ''}">${esc(i[2])}</button>`).join('');
    convMenu.classList.remove('closing');
    if (anchor) placePopover(convMenu, anchor, 'right');
    else { convMenu.hidden = false; convMenu.style.left = Math.min(x, innerWidth - convMenu.offsetWidth - 8) + 'px'; convMenu.style.top = Math.min(y, innerHeight - convMenu.offsetHeight - 8) + 'px'; }
    void peer;
  }
  document.addEventListener('click', e => { if (!convMenu.hidden && !e.target.closest('#convMenu,[data-more],#btnMore')) closePopover(convMenu); });
  convMenu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closePopover(convMenu); $('#btnMore').focus(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = Array.from(convMenu.querySelectorAll('button')).filter(b => !b.hidden && !b.closest('[hidden]'));
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (at + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    e.preventDefault(); buttons[next].focus();
  });
  convMenu.addEventListener('click', e => {
    if (e.target.closest('[data-head-action]')) { closePopover(convMenu); $('#btnMore').setAttribute('aria-expanded', 'false'); }
  }, true);
  convMenu.addEventListener('click', async e => {
    const b = e.target.closest('[data-cm]');
    if (!b || !menuFor) return;
    closePopover(convMenu);
    convAction(b.dataset.cm, menuFor);
  });
  function dropConv(cid) {
    TexConversationTools.forget(cid);
    readIndicators.delete(cid);
    S.convs.delete(cid); S.msgs.delete(cid); S.receipts.delete(cid); S.e2eConv.delete(cid);
    refreshContactE2E();
    const li = convEls.get(cid); if (li) { li.remove(); convEls.delete(cid); }
    if (S.current === cid) {
      S.current = null;
      $('#thread').hidden = true; $('#chatEmpty').hidden = false;
      $('#app').classList.remove('in-chat');
      history.replaceState(null, '', location.pathname + location.search);
    }
    renderConvList();
  }
  /** v2.0.2: golește firul local dar PĂSTREAZĂ contactul/conversația în listă */
  async function clearConv(cid, fresh) {
    TexConversationTools.forget(cid); TexConversationTools.loadPins(cid);
    readIndicators.delete(cid);
    S.msgs.delete(cid); S.receipts.delete(cid);
    for (const [id, el] of rowEls) if (el._m && el._m.conversation_id === cid) { el.remove(); rowEls.delete(id); }
    const c = S.convs.get(cid);
    if (c) { c.last_message = null; c.unread = 0; }
    if (fresh) { await prepConv(fresh); ingestConv(fresh); }
    renderConvList();
    if (S.current === cid) openConversation(cid);
  }
  async function convAction(act, cid) {
    const c = S.convs.get(cid);
    if (!c) return;
    const title = esc(convTitle(c));
    try {
      if (act === 'contactinfo' && !c.is_group) return openContactInfo(peerOf(cid).id);
      if (act === 'info') return openGroupInfo(cid);
      if (act === 'safety') return showSafety(cid);
      if (act === 'addc') {
        const p = peerOf(cid);
        const j = await api('api/contacts.php?action=add', { body: { user_id: p.id } });
        S.contacts.set(p.id, j.contact); c.is_contact = true; renderConvList(); renderThreadBanner();
        return toast(p.display_name + ' este acum în contactele tale');
      }
      if (act === 'delc') {
        const p = peerOf(cid);
        if (!await confirmBox({ title: 'Ștergi contactul?', text: `<b>${esc(p.display_name)}</b> dispare din lista ta de contacte, iar conversația se ascunde din listă. Istoricul nu se șterge (dacă vrei asta, folosește „Șterge conversația”). Dacă îți scrie din nou, conversația reapare.`, ok: 'Șterge contactul', danger: true })) return;
        await api('api/contacts.php?action=remove', { body: { user_id: p.id } });
        S.contacts.delete(p.id); dropConv(cid);
        return toast('Contact șters');
      }
      if (act === 'delete') {
        if (!await confirmBox({ title: 'Ștergi conversația?', text: `${!c.is_group && S.contacts.has(peerOf(cid).id) ? `Istoricul conversației cu <b>${title}</b> se golește <b>doar pentru tine</b>; contactul rămâne în listă.` : `Conversația cu <b>${title}</b> și tot istoricul ei dispar <b>doar pentru tine</b>.`} ${c.is_group ? 'Ceilalți membri' : 'Celălalt'} păstrează mesajele. Dacă primești un mesaj nou, conversația reapare (fără mesajele vechi).`, ok: 'Șterge', danger: true })) return;
        const j = await api('api/conversations.php?action=delete', { body: { conversation_id: cid } });
        if (j.kept) { await clearConv(cid, j.conversation); return toast('Conversație ștearsă — contactul rămâne în listă'); }
        dropConv(cid);
        return toast('Conversație ștearsă');
      }
      if (act === 'leave') {
        if (!await confirmBox({ title: 'Părăsești grupul?', text: `Nu vei mai primi mesaje din <b>${title}</b>. Cheia de criptare a grupului se schimbă, deci nu vei mai putea citi mesajele noi.`, ok: 'Părăsește', danger: true })) return;
        await api('api/conversations.php?action=leave', { body: { conversation_id: cid } });
        dropConv(cid);
        return toast('Ai părăsit grupul');
      }
      if (act === 'destroy') {
        const who = c.is_group ? 'TOȚI membrii grupului' : `tine <b>și pentru ${title}</b>`;
        if (!await confirmBox({ title: 'Ștergi definitiv conversația?', text: `Toate mesajele, pozele, fișierele, reacțiile și cheile de criptare din această conversație vor fi <b>șterse definitiv de pe server</b>, pentru ${who}.<br><br>${c.is_group ? 'Nu e nevoie de acordul celorlalți membri' : 'Nu e nevoie de acordul celuilalt'} și <b>nu se poate anula</b>. ${c.is_group ? 'Membrii' : 'Celălalt'} vor vedea doar că discuția a fost ștearsă definitiv.<br><small class="muted">Ce a salvat deja cineva pe propriul dispozitiv (descărcări, capturi de ecran) nu poate fi șters de la distanță.</small>`, ok: 'Șterge definitiv', danger: true })) return;
        const j = await api('api/conversations.php?action=destroy', { body: { conversation_id: cid } });
        dropConv(cid);
        if (j.conversation) { await prepConv(j.conversation); ingestConv(j.conversation); renderConvList(); } // v2.0.2: contactul rămâne
        return toast(`Conversația a fost ștearsă definitiv: ${roCount(j.deleted_messages,'mesaj','mesaje')} și ${roCount(j.deleted_files,'fișier','fișiere')} șterse de pe server`);
      }
    } catch (e) { toast(e.message, true); }
  }

  /* =====================================================================
     FIR DE MESAJE
     ===================================================================== */
  const BUZZ_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h8V5H8Zm4 14.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM2.5 7.5h1.6v9H2.5v-9Zm17.4 0h1.6v9h-1.6v-9ZM0 10h1.2v4H0v-4Zm22.8 0H24v4h-1.2v-4Z"/></svg>';
  const ICON = {
    sending: '<svg class="st-ic sending" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    sent: '<svg class="st-ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    delivered: '<svg class="st-ic" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.2" fill="currentColor"/><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    failed: '<svg class="st-ic failed" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.2" fill="currentColor"/><path d="M8 4.2v4.6M8 11.2v.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    react: '<svg viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Zm0-2a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm-3.5-9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm7 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM7 13h10a5 5 0 0 1-10 0Z" fill="currentColor"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M8 2h8v2l-1 1v5l3 3v2h-5v7h-2v-7H6v-2l3-3V5L8 4Z"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="m16 3 5 5L8 21H3v-5L16 3Zm0 3L5 17v2h2L18 8l-2-2Z"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" fill="currentColor"/></svg>',
  };
  const store = cid => {
    if (!S.msgs.has(cid)) S.msgs.set(cid, { list: [], byId: new Map(), hasMore: true, loaded: false });
    return S.msgs.get(cid);
  };
  const msgList = $('#msgList'), messagesEl = $('#messages');
  const rowEls = new Map();
  /* v2.1.15: stick-to-bottom robust pe Android WebView.
     Problema: după deschiderea tastaturii (sau resize), scrollTop nu se ajustează
     singur, deci nearBottom() devine fals și mesajele noi nu mai „lipesc” jos.
     Rezolvare:
       • flag „following” — true când utilizatorul e aproape de final SAU a fost
         recent (< 2 s); se dezactivează doar la scroll manual în sus.
       • prag lărgit când tastatura e deschisă (procent din clientHeight).
       • scrollBottom() folosește scrollTop direct (fără smooth); v2.1.33
         comasează rAF și limitează reancorările la conversația/intenția curentă. */
  let kbInset = 0, kbFocus = false;
  let following = true, lastNearBottomAt = 0, userScrolledUpAt = 0;
  function nearBottom() {
    const gap = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    const threshold = kbFocus && kbInset > 0
      ? Math.max(200, Math.round(messagesEl.clientHeight * 0.35))
      : 120;
    return gap < threshold;
  }
  function isFollowing() {
    if (following) return true;
    // dacă a fost jos în ultimele 2 s, încă „urmărește”
    return Date.now() - lastNearBottomAt < 2000;
  }
  function scrollBottom() {
    if (S.current && store(S.current).context) return;
    // instant, fără smooth — smooth scroll intră în cursă cu layout-ul pe WebView
    const target=messagesEl.scrollHeight-messagesEl.clientHeight;
    if (Math.abs(messagesEl.scrollTop-target)>1) messagesEl.scrollTop=target;
    following = true;
    lastNearBottomAt = Date.now();
  }
  let pinFrame=0, pinSettle=0, pinLate=0, scrollIntent=0;
  function cancelBottomPin() {
    scrollIntent++; cancelAnimationFrame(pinFrame); pinFrame=0;
    clearTimeout(pinSettle); clearTimeout(pinLate);
  }
  function pinToBottom() {
    if (!S.current || pinFrame || !uiVisible() || store(S.current).context) return;
    const cid=S.current, intent=scrollIntent;
    const valid=()=>cid===S.current && intent===scrollIntent && uiVisible() && !store(cid).context;
    pinFrame=requestAnimationFrame(()=>{
      pinFrame=0; if (!valid()) return;
      if (threadLayoutFrame) layout();
      scrollBottom();
      clearTimeout(pinSettle); clearTimeout(pinLate);
      pinSettle=setTimeout(()=>{ if(valid() && isFollowing())scrollBottom(); },150);
      pinLate=setTimeout(()=>{ if(valid() && isFollowing())scrollBottom(); },300);
    });
  }
  function manualScrollIntent(){cancelBottomPin();following=false;lastNearBottomAt=0;}
  messagesEl.addEventListener('wheel',manualScrollIntent,{passive:true});
  messagesEl.addEventListener('touchmove',manualScrollIntent,{passive:true});
  messagesEl.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse' && e.target===messagesEl)manualScrollIntent();},{passive:true});
  messagesEl.addEventListener('keydown',e=>{ if(!e.target.closest('input,textarea,select') && ['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key))manualScrollIntent(); });
  // urmărim scroll-ul manual ca să actualizăm flag-ul following
  messagesEl.addEventListener('scroll', () => {
    if (nearBottom()) {
      following = true;
      lastNearBottomAt = Date.now();
    } else {
      // utilizatorul a derulat în sus intenționat
      following = false;
      userScrolledUpAt = Date.now();
    }
  }, { passive: true });

  // Scrollbar discret, suprapus conținutului: nu rezervă un spațiu permanent lângă bule.
  const scrollIndicator = $('#messagesScrollIndicator');
  let scrollIndicatorFrame = 0, scrollIndicatorTimeout = 0;
  messagesEl.addEventListener('scroll', () => {
    if (!scrollIndicatorFrame) scrollIndicatorFrame = requestAnimationFrame(() => {
      scrollIndicatorFrame = 0;
      const view = messagesEl.clientHeight, full = messagesEl.scrollHeight;
      if (full <= view + 1) { scrollIndicator.classList.remove('visible'); return; }
      const track = messagesEl.getBoundingClientRect().height;
      const thumb = Math.max(24, Math.round(track * view / full));
      const position = Math.round((track - thumb) * messagesEl.scrollTop / (full - view));
      scrollIndicator.style.height = thumb + 'px';
      scrollIndicator.style.setProperty('--scroll-thumb-y', position + 'px');
      scrollIndicator.classList.add('visible');
    });
    clearTimeout(scrollIndicatorTimeout);
    scrollIndicatorTimeout = setTimeout(() => scrollIndicator.classList.remove('visible'), 900);
  }, { passive: true });

  function replyQuoteHtml(m) {
    const r = m.reply_to;
    if (!r) return '';
    const mine = m.sender_id === S.me.id;
    const who = mine ? (r.sender_id === S.me.id ? 'Ți-ai răspuns' : 'Ai răspuns lui ' + esc(firstName(r.sender_id))) : (r.sender_id === S.me.id ? esc(firstName(m.sender_id)) + ' ți-a răspuns' : esc(firstName(m.sender_id)) + ' a răspuns');
    let txt;
    if (r.deleted) txt = '<i>Mesaj indisponibil</i>';
    else if (r._e2eFail) txt = '🔒 <i>Mesaj criptat</i>';
    else if (r.type === 'image') txt = '📷 Poză';
    else if (r.type === 'video') txt = '🎬 Video';
    else if (r.type === 'buzz') txt = '📳 '+esc(buzzCaption(m.conversation_id));
    else if (r.type === 'text') txt = rich(String(r.body || '').slice(0, 160));
    else txt = '📎 ' + esc(r.body || 'Fișier');
    return `<div class="reply-label">${ICON.reply}${who}</div><div class="reply-quote" data-jump="${r.id}">${txt}</div>`;
  }
  function mediaSize(a) {
    let w = a.width || 280, h = a.height || 210;
    // #messages are `zoom` => clientWidth/Height sunt deja în unități locale (scalate)
    const cw = messagesEl.clientWidth || 400, maxW = Math.max(48, Math.min(330, cw * 0.68, cw - 64)), maxH = Math.max(120, Math.min(420, (messagesEl.clientHeight || 600) * 0.8));
    const s = Math.min(1, maxW / w, maxH / h);
    return [Math.round(w * s), Math.round(h * s)];
  }
  const ringHtml = pct => `<svg class="ring" viewBox="0 0 46 46"><circle class="bg" cx="23" cy="23" r="19"/><circle class="fg" cx="23" cy="23" r="19" stroke-dasharray="119.4" stroke-dashoffset="${(119.4 * (1 - pct)).toFixed(1)}"/></svg>`;
  const LOCK_SVG = '<svg class="lk" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 9h-1V7a4 4 0 0 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V7Z"/></svg>';
  const isE2E = m => !!(m && m.meta && m.meta.e2e);
  /** Fișier criptat E2E: descărcare + decriptare în browser => blob local */
  const decrypting = new Map();
  function decryptAtt(m, thenOpen) {
    const a = m.attachment;
    if (!a || S.blobByAtt.has(a.id)) return Promise.resolve(S.blobByAtt.get(a.id));
    if (decrypting.has(a.id)) return decrypting.get(a.id);
    const c = convOf(m.conversation_id);
    const pr = E2E.decryptFile(c, a.url, m.meta.e2e, a.mime, p => { const el = rowEls.get(String(m.id)); const sb = el && $('.dec-pct', el); if (sb) sb.textContent = Math.floor(p * 100) + '%'; })
      .then(blob => { const u = URL.createObjectURL(blob); S.blobByAtt.set(a.id, u); decrypting.delete(a.id); rerenderRow(m, true); if (thenOpen) thenOpen(u); return u; })
      .catch(e => { decrypting.delete(a.id); m._decErr = e.message; rerenderRow(m, true); throw e; });
    decrypting.set(a.id, pr);
    rerenderRow(m, true);
    return pr;
  }
  const AUTO_DEC = 30 * 1024 * 1024;
  function e2eFileHtml(m) {
    const a = m.attachment;
    const busy = decrypting.has(a.id);
    const kind = m.type === 'image' ? '🖼️' : m.type === 'video' ? '🎬' : m.type === 'audio' ? '🎵' : '📄';
    if (!m._e2eFail && !busy && !m._decErr && (m.type === 'image' || m.type === 'audio' || m.type === 'video') && a.size <= AUTO_DEC) setTimeout(() => decryptAtt(m).catch(() => {}), 0);
    const act = m._e2eFail ? '' : busy ? `<span class="dec-pct">…</span>` : `<button class="icon-btn small" data-dec="${m.id}" title="${m.type === 'file' ? 'Decriptează și descarcă' : 'Decriptează și deschide'}">${m.type === 'audio' || m.type === 'video' ? '▶' : '<svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z" fill="currentColor"/></svg>'}</button>`;
    const sub = m._e2eFail ? 'Nu am cheia pentru acest fișier' : m._decErr ? '⚠️ ' + esc(m._decErr) : busy ? 'Se decriptează…' : `${fmtSize(a.size)} · criptat E2E`;
    return `<div class="bubble"><div class="file-card"><div class="file-ic">${kind}</div><div class="file-meta"><div class="file-name">${LOCK_SVG}${esc(a.name)}</div><div class="file-sub">${sub}</div></div>${act}</div>${m.body && !m._captionFail ? '<div class="media-caption">'+rich(m.body)+'</div>' : ''}</div>`;
  }
  function bubbleHtml(m) {
    const mine = m.sender_id === S.me.id;
    if (m.type === 'system') return `<div class="sys-msg">${esc(systemText(m))}</div>`;
    if ((m._e2eFail || (m.meta && m.meta.e2e && !m._dec)) && m.type === 'text' && !m.deleted) return `<div class="bubble has-text e2e-fail" title="Nu pot decripta: cheia lipsește sau a fost resetată">🔒 <i>Mesaj criptat — nu poate fi citit pe acest dispozitiv</i></div>`;
    if (isE2E(m) && m.attachment && !S.blobByAtt.has(m.attachment.id) && !m._upload) return e2eFileHtml(m);
    if (m.type === 'buzz') return `<div class="bubble buzz" title="${esc(mine ? 'Ai dat '+buzzCaption(m.conversation_id) : firstName(m.sender_id)+' ți-a dat '+buzzCaption(m.conversation_id))}"><span class="bz-ic">${BUZZ_SVG}</span><b>${esc(buzzCaption(m.conversation_id))}</b></div>`;
    const a = m.attachment;
    const up = m._upload;
    const cap = m.body ? `<div class="media-caption">${rich(m.body)}</div>` : '';
    if (m.type === 'image' && a) {
      const [w, h] = mediaSize(a);
      const src = S.blobByAtt.get(a.id) || a.url;
      return `<div class="bubble media"><div class="media-box" style="width:${w}px;height:${h}px"><img class="media-img loading" src="${esc(src)}" width="${w}" height="${h}" style="width:${w}px;height:${h}px" alt="${esc(a.name)}" data-lb="${m.id}" loading="lazy" decoding="async">${up ? `<div class="up-overlay">${ringHtml(up.pct || 0)}</div>` : ''}</div>${cap}</div>`;
    }
    if (m.type === 'video' && a) {
      return `<div class="bubble media"><div class="media-box"><video class="media-video" src="${esc(S.blobByAtt.get(a.id) || a.url)}" controls preload="metadata" playsinline></video>${up ? `<div class="up-overlay">${ringHtml(up.pct || 0)}</div>` : ''}</div>${cap}</div>`;
    }
    if (m.type === 'audio' && a && !up) {
      const src = S.blobByAtt.get(a.id) || a.url;
      return `<div class="bubble audio-b"><div class="audio-name">🎵 ${isE2E(m) ? LOCK_SVG : ''}${esc(a.name)}</div><audio src="${esc(src)}" controls preload="metadata"></audio>${m.body ? '<div>' + rich(m.body) + '</div>' : ''}</div>`;
    }
    if ((m.type === 'file' || m.type === 'audio' || m.type === 'image' || m.type === 'video') && a) {
      const sub = up ? `Se încarcă… ${Math.floor((up.pct || 0) * 100)}% · ${fmtSize(a.size)}` : `${fmtSize(a.size)} · ${isE2E(m) ? 'criptat E2E' : esc(a.mime || '')}`;
      const blobU = S.blobByAtt.get(a.id);
      const dlHref = blobU && isE2E(m) ? blobU : a.url + '&download=1';
      return `<div class="bubble"><div class="file-card"><div class="file-ic">${up ? ringHtml(up.pct || 0).replace('class="ring"', 'class="ring" style="width:34px;height:34px"') : '📄'}</div><div class="file-meta"><div class="file-name">${isE2E(m) ? LOCK_SVG : ''}${esc(a.name)}</div><div class="file-sub">${sub}</div></div>${up ? '' : `<a class="dl icon-btn small" href="${esc(dlHref)}" title="Descarcă" download="${esc(a.name)}"><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z" fill="currentColor"/></svg></a>`}</div>${m.body ? '<div style="padding:0 12px 8px">' + rich(m.body) + '</div>' : ''}</div>`;
    }
    if (m.type === 'p2p') return `<div class="bubble p2p-b">${P2P.cardHtml(m, mine, firstName(mine ? peerOf(m.conversation_id).id : m.sender_id))}</div>`;
    // Emoji-only text uses the exact same sizing and active-theme surface as any other text.
    return `<div class="bubble has-text" data-who="${esc(nameOf(m.sender_id))}" data-t="${esc(fmtTime(m.created_at))}">${rich(m.body)}</div>`;
  }
  // Generic non-retired reactions remain ordinary badges.
  function reactRender(code) {
    if (isLikeCode(code)) return '<span class="rx-like" role="img" aria-label="Like">👍</span>';
    return esc(code);
  }
  function reactionsChipHtml(m) {
    const r = visibleReactions(m);
    if (!r.length) return '';
    const map = new Map();
    for (const x of r) {
      const k = isLikeCode(x.emoji) ? LIKE_EMOJI : x.emoji;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    }
    const parts = [];
    for (const [emoji, list] of map) {
      const who = list.map(x => (x.user_id === S.me.id ? 'Tu' : nameOf(x.user_id)) + ': ' + reactionLabel(emoji)).join(', ');
      parts.push(`<span class="rx" title="${esc(who)}">${reactRender(emoji)}${list.length > 1 ? `<span class="cnt">${list.length}</span>` : ''}</span>`);
    }
    return `<div class="reactions" data-react="${m.id}">${parts.join('')}</div>`;
  }
  function bubbleBlock(m) { return bubbleHtml(m)+reactionsChipHtml(m); }
  function rowInner(m) {
    const mine = m.sender_id === S.me.id;
    if (m.type === 'system') return `<div class="avatar-slot"></div>${bubbleHtml(m)}<div class="status-slot"></div>`;
    const sn = !mine && isGroup(m.conversation_id) ? `<div class="sender-name" data-identity-user="${m.sender_id}">${verifiedName(S.users.get(m.sender_id),nameOf(m.sender_id))}</div>` : '';
    // v2.1.3: placeholder din start pe rândurile proprii — slotul nu e niciodată „gol” înainte de updateStatuses
    const st0 = mine ? '<i class="st-ph" aria-hidden="true"></i>' : '';
    return `<div class="avatar-slot"></div>
      <div class="msg-col">${sn}${replyQuoteHtml(m)}
        <div class="bubble-wrap">${bubbleBlock(m)}
          <div class="msg-toolbar"><div class="msg-actions"><button class="icon-btn" data-a="react" title="Like" aria-label="Like">${ICON.react}</button><button class="icon-btn" data-a="reply" title="Răspunde" aria-label="Răspunde">${ICON.reply}</button>${isNum(m.id) && m.type !== 'system' ? `<button class="icon-btn" data-a="pin" title="${TexConversationTools.isPinned(m) ? 'Anulează fixarea' : 'Fixează mesajul'}" aria-label="${TexConversationTools.isPinned(m) ? 'Anulează fixarea' : 'Fixează mesajul'}" aria-pressed="${TexConversationTools.isPinned(m)}">${ICON.pin}</button>` : ''}${TexConversationTools.canEdit(m) ? `<button class="icon-btn" data-a="edit" title="Editează" aria-label="Editează">${ICON.edit}</button>` : ''}</div>
          <span class="msg-time${m.edited_at ? ' is-edited' : ''}" aria-label="${isE2E(m) ? 'Criptat end-to-end · ' : ''}${esc(fmtTime(m.created_at))}${m.edited_at ? ' · editat' : ''}"${isE2E(m) ? ' title="Criptat end-to-end"' : ''}>${isE2E(m) ? `<span class="message-lock" aria-hidden="true">${LOCK_SVG}</span>` : ''}${fmtTime(m.created_at)}${m.edited_at ? ' · editat' : ''}</span></div>
        </div>
      </div>
      <div class="status-slot">${st0}</div>`;
  }
  function setReactionClass(el,m){el.classList.toggle('has-reactions',visibleReactions(m).length>0);}
  function buildRow(m, appear) {
    const el = document.createElement('div');
    el.className = 'row ' + (m.type === 'system' ? 'sys' : m.sender_id === S.me.id ? 'out' : 'in') + (appear && !document.documentElement.classList.contains('mobile-ui') ? ' appear' : '');
    el.dataset.id = m.id;
    if (m.sender_id === S.me.id && m.type !== 'system') { // Albastru neon: direcție, fază și intensitate diferite per bulă
      el.style.setProperty('--gd', (9 + Math.random() * 8).toFixed(2) + 's');
      el.style.setProperty('--gdelay', (-Math.random() * 17).toFixed(2) + 's');
      el.style.setProperty('--gi', (.26 + Math.random() * .15).toFixed(2));
      el.style.setProperty('--gx', (Math.random() * 5 - 2.5).toFixed(2) + 'px');
      el.style.setProperty('--gy', (Math.random() * 4 - 2).toFixed(2) + 'px');
    }
    if(m.type!=='system'){el.tabIndex=0;el.setAttribute('aria-keyshortcuts','Shift+F10');}
    el.innerHTML = rowInner(m);
    el._m = m;
    if (m._state) el.classList.add(m._state);
    setReactionClass(el, m);
    // Mesajele proprii intră de lângă compozitor și pe telefon; ACK-ul păstrează rândul animat.
    const ownText = m.sender_id === S.me.id && m.type === 'text';
    if (appear && (!document.documentElement.classList.contains('mobile-ui') || ownText)) requestAnimationFrame(() => {
      el.classList.remove('appear');
      if (!el.isConnected || el._entrancePlayed) return;
      el._entrancePlayed = true;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const mine = m.sender_id === S.me.id;
      if (el.animate) el.animate(ownText ? [
        { opacity: .32, transform: 'translate3d(10px,18px,0) scale(.96)', transformOrigin: 'right bottom' },
        { opacity: 1, transform: 'none', transformOrigin: 'right bottom' }
      ] : [
        { opacity: .12, transform: `translate3d(${mine ? 6 : -4}px,10px,0)` },
        { opacity: 1, transform: 'none' }
      ], { duration: ownText ? 300 : mine ? 280 : 230, easing: 'cubic-bezier(.16,1,.3,1)' });
      else { el.classList.add(ownText ? 'text-enter' : 'send-enter'); el.addEventListener('animationend', () => el.classList.remove('text-enter', 'send-enter'), { once: true }); }
    });
    hookImages(el);
    rowEls.set(String(m.id), el);
    return el;
  }
  function hookImages(el) {
    $$('img.media-img', el).forEach(img => {
      const done = () => img.classList.remove('loading');
      if (img.complete && img.naturalWidth) done(); else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    });
  }
  function rerenderRow(m, force) {
    const el = rowEls.get(String(m.id));
    if (!el || !el.isConnected) return;
    // Keep the active touch target attached until release; apply the latest model once.
    if(lp?.handled && lp.row===el){el._touchRenderPending=m;return;}
    const keepScroll = isFollowing() || nearBottom();
    const media = $$('video, audio', el).find(v => !v.paused && !v.ended);
    if (media && !force) return; // nu întrerupe redarea
    // v2.1.1: păstrează status-slot (avatar/checkmark) ca să nu flash-uiască la confirmarea trimiterii
    const prevSlot = $('.status-slot', el);
    const prevAvatar = $('.avatar-slot', el);
    el.innerHTML = rowInner(m);
    el._m = m;
    setReactionClass(el, m);
    el.classList.toggle('sending', m._state === 'sending');
    el.classList.toggle('failed', m._state === 'failed');
    if (prevSlot) $('.status-slot', el)?.replaceWith(prevSlot);
    if (prevAvatar) $('.avatar-slot', el)?.replaceWith(prevAvatar);
    hookImages(el);
    if(toolbarRow===el)showMessageToolbar(el,true);
    queueThreadLayout();
    tighten(el);
    if (keepScroll || isFollowing()) pinToBottom();
  }
  /* v2.0: bulele „strânse” pe text — fără spațiul gol din dreapta când textul se rupe pe mai multe rânduri.
     Browserul lărgește bula la lățimea maximă când un rând se rupe; măsurăm cel mai lung rând real și
     fixăm lățimea bulei exact pe el. */
  function tightenBubble(b) {
    // Native intrinsic sizing only. Range-based repeated width shrinking + text-wrap:pretty
    // reflowed already-wrapped sentences and reserved blank space for hidden hover controls.
    b.style.removeProperty('width');
  }
  function tighten(root) {
    const list = root ? $$('.bubble.has-text:not(.jumbo)', root) : $$('.bubble.has-text:not(.jumbo)', msgList);
    list.forEach(tightenBubble);
  }
  let tightT = 0;
  const tightenSoon = () => { cancelAnimationFrame(tightT); tightT = requestAnimationFrame(() => tighten()); };
  let incomingGutter=-1;
  function syncIncomingGutter(){
    if(!messagesEl.getClientRects().length)return;
    const cs=getComputedStyle(messagesEl);
    // The right edge includes a real scrollbar outside clientWidth; mirror that on the left only.
    const gutter=Math.max(0,messagesEl.offsetWidth-messagesEl.clientWidth-(parseFloat(cs.borderLeftWidth)||0)-(parseFloat(cs.borderRightWidth)||0));
    if(gutter!==incomingGutter){incomingGutter=gutter;messagesEl.style.setProperty('--incoming-edge-inset',gutter+'px');}
  }
  if (window.ResizeObserver) { let lastW = 0; new ResizeObserver(() => { syncIncomingGutter(); const w = messagesEl.clientWidth; if (Math.abs(w - lastW) > 1) { lastW = w; tightenSoon(); } }).observe(messagesEl); }
  window.addEventListener('resize',syncIncomingGutter);

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => tightenSoon());

  const GROUP_GAP = 600, SEP_GAP = 1800;
  let threadLayoutFrame=0, statusFrame=0;
  function queueThreadLayout() { if(!threadLayoutFrame)threadLayoutFrame=requestAnimationFrame(()=>{threadLayoutFrame=0;layout();}); }
  function queueStatuses() { if(!statusFrame)statusFrame=requestAnimationFrame(()=>{statusFrame=0;updateStatuses();}); }
  function layout() {
    if(threadLayoutFrame){cancelAnimationFrame(threadLayoutFrame);threadLayoutFrame=0;}
    const cid = S.current;
    if (!cid) return;
    // Width-dependent gutter work belongs to ResizeObserver, not every message write.
    if(!window.ResizeObserver)syncIncomingGutter();
    const st = store(cid);
    const wantedSeparators=new Set();
    const list = st.list;
    const spareAvatars = new Map(); // move the existing avatar along an incoming streak, never reload it
    const dayOf = m => new Date(m.created_at * 1000).toDateString();
    for (let i = 0; i < list.length; i++) {
      const m = list[i], el = rowEls.get(String(m.id));
      if (!el) continue;
      const prev = list[i - 1], next = list[i + 1];
      const sep = !prev || (m.created_at - prev.created_at > SEP_GAP) || dayOf(m) !== dayOf(prev);
      if (sep) {
        const node=el._separator || (el._separator=document.createElement('div'));
        node.className='sep'; const label=fmtSep(m.created_at);
        if(node.textContent!==label)node.textContent=label;
        if(node.parentNode!==msgList || node.nextSibling!==el)msgList.insertBefore(node,el);
        wantedSeparators.add(node);
      }
      if (m.type === 'system') continue;
      const sysN = x => x && x.type === 'system';
      const joinPrev = prev && !sysN(prev) && !sep && prev.sender_id === m.sender_id && m.created_at - prev.created_at < GROUP_GAP && !m.reply_to && !visibleReactions(prev).length;
      const nextSep = next && ((next.created_at - m.created_at > SEP_GAP) || dayOf(next) !== dayOf(m));
      const joinNext = next && !sysN(next) && !nextSep && next.sender_id === m.sender_id && next.created_at - m.created_at < GROUP_GAP && !next.reply_to && !visibleReactions(m).length;
      el.classList.toggle('group-start', !joinPrev);
      el.classList.toggle('g-first', !joinPrev && !!joinNext);
      el.classList.toggle('g-mid', !!joinPrev && !!joinNext);
      el.classList.toggle('g-last', !!joinPrev && !joinNext);
      const slot = $('.avatar-slot', el);
      const wantAv = m.sender_id !== S.me.id && !joinNext;
      if (wantAv && !slot.firstChild) {
        const spare = spareAvatars.get(m.sender_id)?.shift();
        if (spare) slot.appendChild(spare); else slot.innerHTML = avatar(S.users.get(m.sender_id), 'sm');
      } else if (!wantAv && slot.firstElementChild) {
        if (!spareAvatars.has(m.sender_id)) spareAvatars.set(m.sender_id, []);
        spareAvatars.get(m.sender_id).push(slot.firstElementChild);
        slot.replaceChildren();
      }
    }
    $$('.sep',msgList).forEach(node=>{if(!wantedSeparators.has(node))node.remove();});
    updateStatuses();
  }
  const readIndicators = new Map();
  function updateStatuses() {
    if(statusFrame){cancelAnimationFrame(statusFrame);statusFrame=0;}
    const cid = S.current;
    if (!cid) return;
    const st = store(cid);
    const peer = peerOf(cid);
    let rc = (S.receipts.get(cid) || {})[peer.id] || { delivered: 0, read: 0 };
    if (isGroup(cid)) { // grup: „văzut” = citit de toți ceilalți membri
      const all = Object.entries(S.receipts.get(cid) || {}).filter(([u]) => +u !== S.me.id).map(([, v]) => v);
      rc = all.length ? { delivered: Math.min(...all.map(v => v.delivered)), read: Math.min(...all.map(v => v.read)) } : { delivered: 0, read: 0 };
    }
    // v2.1.3 Messenger-like: meta DOAR pe ultimul mesaj propriu.
    // Gutter-ul e rezervat în CSS (padding-right + status absolute) pe TOATE rândurile .out —
    // placeholder-ul păstrează conținut stabil în slot, dar lățimea rândului NU depinde de el.
    const ST_PH = '<i class="st-ph" aria-hidden="true"></i>';
    let lastMine = null;
    for (const m of st.list) {
      if (m.sender_id === S.me.id && m.type !== 'system') lastMine = m;
    }
    for (const m of st.list) {
      if (m.sender_id !== S.me.id || m.type === 'system') continue;
      const el = rowEls.get(String(m.id));
      if (!el) continue;
      const slot = $('.status-slot', el);
      if (!slot) continue;
      let html = ST_PH, key = 'ph';
      if (m === lastMine) {
        if (m._state === 'sending' || (!isNum(m.id) && m._state !== 'failed')) { html = ICON.sending; key = 's'; }
        else if (m._state === 'failed') { html = `<span data-retry="${m.id}" title="Netrimis · apasă pentru a reîncerca">${ICON.failed}</span>`; key = 'f'; }
        else if (isNum(m.id) && m.id <= rc.read) {
          html = isGroup(cid)
            ? `<span title="Văzut de toți">${ICON.delivered.replace('class="st-ic"', 'class="st-ic seen-all"')}</span>`
            : `<span title="Văzut de ${esc(displayName(peer))}">${avatar(peer, 'xs')}</span>`;
          key = 'r:' + (peer.avatar || '') + ':' + peer.display_name;
        } else if (isNum(m.id) && m.id <= rc.delivered) { html = ICON.delivered; key = 'd'; }
        else if (isNum(m.id)) { html = ICON.sent; key = 'n'; }
        else { html = ICON.sending; key = 's'; }
      }
      if (slot._k !== key) {
        slot.classList.add('quiet'); // fără animații meta
        if (key.startsWith('r:') && !isGroup(cid)) {
          let cached = readIndicators.get(cid);
          if (!cached) { cached = document.createElement('div'); readIndicators.set(cid, cached); }
          stableAvatarHtml(cached, html);
          // Keep the cached container itself: its children must not be consumed.
          slot.replaceChildren(cached);
        } else slot.innerHTML = html;
        slot._k = key;
      }
    }
  }

  function upsertMessage(m, opts = {}) {
    const cid = m.conversation_id;
    const st = store(cid);
    if (st.context && !opts.force && !st.byId.has(String(m.id)) && +m.id > st.contextEnd) return m;
    let existing = st.byId.get(String(m.id));
    if (!existing && m.client_uid) {
      existing = st.list.find(x => x.client_uid && x.client_uid === m.client_uid);
      if (existing) { st.byId.delete(String(existing.id)); const el = rowEls.get(String(existing.id)); if (el) { rowEls.delete(String(existing.id)); rowEls.set(String(m.id), el); el.dataset.id = m.id; } }
    }
    if (existing) {
      if (existing.attachment && m.attachment && S.blobByAtt.has(existing.attachment.id)) S.blobByAtt.set(m.attachment.id, S.blobByAtt.get(existing.attachment.id));
      const keepUpload = m._upload === undefined && existing._upload && !isNum(m.id) ? existing._upload : undefined;
      for (const k of Object.keys(existing)) if (!(k in m) && k[0] !== '_') delete existing[k];
      Object.assign(existing, m);
      if (isNum(m.id)) { delete existing._state; delete existing._upload; }
      if (keepUpload) existing._upload = keepUpload;
      st.byId.set(String(existing.id), existing);
      if (cid === S.current) rerenderRow(existing);
      return existing;
    }
    if (!st.loaded && !opts.force) return m;
    st.byId.set(String(m.id), m);
    // inserare în ordine (temporarele la final)
    let idx = st.list.length;
    if (isNum(m.id)) { while (idx > 0 && (!isNum(st.list[idx - 1].id) || st.list[idx - 1].id > m.id)) idx--; }
    st.list.splice(idx, 0, m);
    if (cid === S.current) {
      const mine = m.sender_id === S.me.id;
      const stick = mine || isFollowing() || nearBottom() || (kbFocus && kbInset > 0);
      const el = buildRow(m, !opts.noAnim);
      const afterM = st.list[idx + 1];
      const afterEl = afterM && rowEls.get(String(afterM.id));
      msgList.insertBefore(el, afterEl && afterEl.isConnected ? afterEl : null);
      queueThreadLayout();
      tighten(el);
      if (stick) pinToBottom();
      else if (!mine) showJump(true);
      queueMarkRead();
    }
    return m;
  }
  function showJump(newMsg) {
    const b = $('#jumpBtn');
    if (nearBottom()) { b.hidden = true; return; }
    b.hidden = false;
    $('#jumpLabel').textContent = newMsg ? 'Mesaj nou' : '';
  }
  messagesEl.addEventListener('scroll', () => {
    if (messagesEl.scrollTop < 200) loadOlder();
    if (nearBottom()) { $('#jumpBtn').hidden = true; queueMarkRead(); } else if ($('#jumpBtn').hidden) showJump(false);
  }, { passive: true });
  $('#jumpBtn').addEventListener('click', () => { pinToBottom(); $('#jumpBtn').hidden = true; });

  function renderThread() {
    const cid = S.current;
    const st = store(cid);
    msgList.innerHTML = '';
    rowEls.clear();
    const peer = peerOf(cid);
    const c = convOf(cid);
    const intro = document.createElement('div');
    intro.className = 'conv-intro';
    intro.innerHTML = c && c.is_group
      ? `${groupAvatar(c, 'xl')}<h3>${esc(convTitle(c))}</h3><div class="muted">${roCount(c.members.length, 'membru', 'membri')}: ${esc(c.members.map(m => m.id === S.me.id ? 'tu' : m.display_name).join(', '))}</div><div class="muted small e2e-intro" style="margin-top:6px"></div>`
      : `${avatar(peer, 'xl')}<h3>${verifiedName(peer)}</h3><div class="muted">@${esc(peer.username)}</div>${statusLine(peer) ? `<div class="intro-status">${statusDot(peer)}${rich(statusLine(peer))}</div>` : ''}<div class="muted small" style="margin-top:6px">Sunteți conectați pe ${esc(A.appName || 'Tex')}</div><div class="muted small e2e-intro"></div>`;
    intro.hidden = st.hasMore;
    intro.id = 'convIntro';
    msgList.appendChild(intro);
    const frag = document.createDocumentFragment();
    st.list.forEach(m => frag.appendChild(buildRow(m, false)));
    msgList.appendChild(frag);
    layout();
    tighten();
    following = !st.context;
    $('#historyContext').hidden = !st.context;
    $$('#composer button, #composer input, #composer textarea').forEach(el => { el.disabled = !!st.context; });
    if (!st.context) pinToBottom();
    renderThreadBanner();
    if (FIND.q) runFind(true);
  }
  function renderThreadBanner() {
    const c = convOf(S.current);
    const b = $('#contactBanner');
    if (!c || c.is_group || c.is_contact !== false) { b.hidden = true; return; }
    const p = peerOf(c.id);
    b.innerHTML = `<span><b>${esc(p.display_name)}</b> nu este în lista ta de contacte.</span><button class="btn primary" data-banner="addc">Adaugă</button><button class="btn ghost" data-banner="delete">Șterge</button>`;
    b.hidden = false;
  }
  $('#contactBanner').addEventListener('click', e => { const b = e.target.closest('[data-banner]'); if (b && S.current) convAction(b.dataset.banner, S.current); });
  let loadingOlder = false;
  async function loadOlder(lim = 40) {
    const cid = S.current;
    if (!cid || loadingOlder) return;
    const st = store(cid);
    if (!st.loaded || !st.hasMore) return;
    const first = st.list.find(m => isNum(m.id));
    if (!first) return;
    loadingOlder = true;
    $('#msgLoader').classList.add('on');
    try {
      const j = await api(`api/messages.php?conversation_id=${cid}&before_id=${first.id}&limit=${lim}`);
      await prepMany(j.messages);
      if (S.current !== cid) return;
      st.hasMore = j.has_more;
      const h0 = messagesEl.scrollHeight, t0 = messagesEl.scrollTop;
      const frag = document.createDocumentFragment();
      const add = j.messages.filter(m => !st.byId.has(String(m.id)));
      add.forEach(m => { st.byId.set(String(m.id), m); frag.appendChild(buildRow(m, false)); });
      st.list.unshift(...add);
      const intro = $('#convIntro');
      msgList.insertBefore(frag, intro.nextSibling);
      intro.hidden = st.hasMore;
      layout();
      tighten();
      if (FIND.q && !FIND.busy) runFind(true);
      messagesEl.scrollTop = t0 + (messagesEl.scrollHeight - h0);
    } catch (e) { toast(e.message, true); }
    finally { loadingOlder = false; $('#msgLoader').classList.remove('on'); }
  }
  async function jumpTo(id) {
    const cid = S.current; if (!cid) return;
    const st = store(cid);
    try {
      if (!st.byId.has(String(id))) {
        const j = await api(`api/conversation-tools.php?action=around&conversation_id=${cid}&message_id=${id}`);
        await prepMany(j.messages); if (S.current !== cid) return;
        st.list = j.messages; st.byId = new Map(j.messages.map(m => [String(m.id),m])); st.loaded = true; st.hasMore = j.has_more; st.context = true; st.contextEnd = +j.messages.at(-1).id;
        following = false; lastNearBottomAt = 0; renderThread();
      }
      const el = rowEls.get(String(id)); if (!el) throw new Error('Mesajul original nu mai este disponibil.');
      following = false; lastNearBottomAt = 0;
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'),1300);
    } catch (err) { toast(err.message,true); }
  }
  $('#historyLatest').addEventListener('click', async () => {
    const cid=S.current; if (!cid) return;
    S.drafts.set(cid,input.value); const st=store(cid); st.context=false; st.loaded=false; st.list=[]; st.byId.clear(); await openConversation(cid);
  });

  const E2E_REASON = { locked: 'E2E blocat pe acest dispozitiv — deblochează-l din bara din stânga', none: 'Nu ai activat încă criptarea E2E', unsupported: 'E2E necesită HTTPS', peer: 'Celălalt nu a activat încă criptarea E2E (trebuie să se conecteze o dată)', member: 'Un membru nu are încă E2E activat', waiting: 'Aștept cheia grupului de la ceilalți membri', conflict: 'Cheia grupului se sincronizează', error: 'Eroare E2E' };
  function e2eChip(e) {
    if (!e || e.reason === 'loading') return '<span class="e2e-chip off">Verificare E2E în curs</span>';
    return e.on ? `<span class="e2e-chip on" title="E2E disponibilă pentru mesajele și fișierele noi din această conversație">${LOCK_SVG}E2E</span>`
      : `<span class="e2e-chip off" title="${esc('E2E indisponibilă: ' + (E2E_REASON[e.reason] || e.reason || ''))}">🔓 E2E indisponibilă</span>`;
  }
  function renderHeader() {
    const cid = S.current;
    if (!cid) return;
    updateBuzzSendLabel(cid);
    const c = convOf(cid);
    const peer = peerOf(cid);
    const typing = S.typing.get(cid) && S.typing.get(cid).size;
    let html;
    if (c && c.is_group) {
      const on = c.members.filter(m => m.id !== S.me.id && isOnline(m.id)).length;
      const st = typing ? esc(firstName(S.typing.get(cid).values().next().value)) + ' scrie…' : `${roCount(c.members.length, 'membru', 'membri')}${on ? ' · ' + (on === 1 ? '1 activ' : roCount(on, 'activ', 'activi')) : ''}`;
      html = `${groupAvatar(c)}<div style="min-width:0"><div class="th-name">${esc(convTitle(c))}</div><div class="th-status${typing ? ' typing' : ''}">${st}</div></div>`;
    } else {
      const line = statusLine(peer), seen = distinctStatusSuffix(line,lastSeenText(peer.id));
      const statusHtml = typing ? 'scrie…' : (line ? `${statusDot(peer)}<span class="th-msg">${rich(line)}</span>${seen ? `<span class="th-seen"> · ${esc(seen)}</span>` : ''}` : esc(seen || '@' + peer.username));
      html = `${avatar(peer, '', isOnline(peer.id))}<div style="min-width:0"><div class="th-name">${verifiedName(peer)}</div><div class="th-status${typing ? ' typing' : ''}">${statusHtml}</div></div>`;
    }
    const el = $('#thPeer');
    if (c && !c.is_group) { el.setAttribute('role','button'); el.tabIndex=0; el.setAttribute('aria-haspopup','dialog'); el.setAttribute('aria-controls','contactInfo'); el.setAttribute('aria-label','Informații contact: '+displayName(peer)); el.title='Informații contact'; }
    else { for (const a of ['role','tabindex','aria-haspopup','aria-controls','aria-label','title']) el.removeAttribute(a); }
    $('#contactGateNotice').hidden = !directRestricted(cid);
    if (el._html !== html) { stableAvatarHtml(el, html); el._html = html; }
  }

  async function refreshE2E(cid) {
    const c = convOf(cid);
    if (!c) return;
    const st = await E2E.convStatus(c).catch(() => ({ on: false, reason: 'error' }));
    S.e2eConv.set(cid, st);
    if (!isGroup(cid) && ciUser && +peerOf(cid).id === ciUser) refreshContactE2E();
    if (S.current === cid) {
      $('#thPeer')._html = ''; renderHeader();
      const ei = $('.e2e-intro'); if (ei) ei.innerHTML = st.on ? '🔒 Mesajele și fișierele sunt criptate end-to-end. Nici serverul nu le poate citi.' : '🔓 ' + esc(E2E_REASON[st.reason] || 'Necriptat');
    }
    return st;
  }
  async function openConversation(cid) {
    cancelBottomPin();
    hideMessageToolbar();
    TexConversationTools.navigate?.(cid);
    if (!S.convs.has(cid)) return;
    const prev = S.current;
    if (prev && prev !== cid) { S.drafts.set(prev, $('#input').value); sendTyping(false); }
    S.current = cid;
    closeNotifs(cid);
    if (TT.buzz && TT.buzz.cid === cid && attending()) stopTitleBuzz();
    clearReply();
    $('#chatEmpty').hidden = true;
    const th = $('#thread');
    th.hidden = false;
    th.classList.remove('switching');
    if(!document.documentElement.classList.contains('mobile-ui') && !matchMedia('(prefers-reduced-motion: reduce)').matches){void th.offsetWidth;th.classList.add('switching');}
    $('#app').classList.add('in-chat');
    const chatHash = '#c=' + cid;
    if (location.hash !== chatHash) {
      // Pe telefon Back trebuie să revină la listă; pe desktop păstrăm un singur history entry.
      if (isNarrow()) history.pushState({ vtChat: cid }, '', chatHash);
      else history.replaceState(null, '', chatHash);
    }
    $('#input').value = S.drafts.get(cid) || '';
    autoGrow(); updateSendBtn();
    if (!$('#findBar').hidden) closeFind();
    $('#thread').classList.toggle('is-group', isGroup(cid));
    $('#btnP2PHead').hidden = $('#btnP2P').hidden = isGroup(cid); // P2P doar 1:1
    const vcBtn = $('#btnVideoCall'); if (vcBtn) vcBtn.hidden = isGroup(cid); // apel video doar 1:1
    refreshE2E(cid);
    renderHeader();
    TexConversationTools.renderPins();
    TexConversationTools.loadPins(cid);
    renderConvList();
    updateTyping();
    const st = store(cid);
    renderThread();
    if (!st.loaded) {
      $('#msgLoader').classList.add('on');
      try {
        const j = await api(`api/messages.php?conversation_id=${cid}&limit=40`);
        await prepMany(j.messages);
        const rc = {};
        (j.receipts || []).forEach(r => rc[r.user_id] = { delivered: r.delivered, read: r.read });
        S.receipts.set(cid, rc);
        const temps = st.list.filter(m => !isNum(m.id));
        st.list = []; st.byId.clear();
        j.messages.forEach(m => { st.list.push(m); st.byId.set(String(m.id), m); });
        temps.forEach(m => { st.list.push(m); st.byId.set(String(m.id), m); });
        st.hasMore = j.has_more; st.loaded = true;
        if (S.current === cid) renderThread();
      } catch (e) { toast(e.message, true); }
      finally { $('#msgLoader').classList.remove('on'); }
    }
    if (S.current === cid) { maybeMarkRead(true); if (matchMedia('(pointer:fine)').matches) $('#input').focus(); }
  }
  let vtHistoryBack = false;
  function closeThread(fromPop = false) {
    hideMessageToolbar();
    TexConversationTools.navigate?.(0);
    $('#app').classList.remove('in-chat');
    const hasChatHash = /^#c=\d+$/.test(location.hash);
    if (!fromPop && hasChatHash && history.state && history.state.vtChat != null && !vtHistoryBack) {
      // Intrarea a fost creată de openConversation(); popstate va închide efectiv firul.
      vtHistoryBack = true;
      history.back();
    } else if (hasChatHash) {
      // Deep link / intrare veche: nu ieșim din aplicație cu history.back().
      history.replaceState(null, '', location.pathname + location.search);
    }
    setTimeout(() => { if (!$('#app').classList.contains('in-chat') && isNarrow()) { /* păstrăm firul încărcat */ } }, 600);
  }
  $('#btnBack').addEventListener('click', () => { closeThread(); });

  // Back de sistem Android: consumă întâi overlay-ul vizibil, apoi firul de pe telefon.
  window.__vtBack = function () {
    try {
      if (window.TexMenuEmoji?.back()) return true;
      if (!lb.hidden) { closeLightbox(); return true; }
      if (!sheet.hidden) { closeSheet(); return true; }
      if (window.TexSettings && TexSettings.back()) return true;
      const modals = $$('.modal').filter(el => !el.hidden);
      if (modals.length) {
        const modal = modals[modals.length - 1];
        const close = $('[data-close], #cfCancel, [data-choice="cancel"]', modal);
        if (close) close.click(); else closeModal(modal);
        return true;
      }
      const popovers = [emoPanel, attachMenu, convMenu, $('#zoomPop'), $('#statusPop')];
      const pop = popovers.find(el => el && !el.hidden);
      if (pop) {
        closePopover(pop);
        return true;
      }
      if (!$('#findBar').hidden) { closeFind(); return true; }
      if (isNarrow() && $('#app').classList.contains('in-chat')) { closeThread(); return true; }
    } catch (_) {}
    return false;
  };

  // One geometry/read-receipt pass after a batch, rather than after every inserted row.
  let markReadFrame=0;
  function queueMarkRead(){
    if(!markReadFrame)markReadFrame=requestAnimationFrame(()=>{
      markReadFrame=0; if(threadLayoutFrame)layout(); maybeMarkRead();
    });
  }
  function maybeMarkRead(force) {
    const cid = S.current;
    if (!cid || store(cid).context || document.hidden || !document.hasFocus() && !force) return;
    if (isNarrow() && !$('#app').classList.contains('in-chat')) return;
    if (!nearBottom() && !force) return;
    const st = store(cid);
    let last = 0;
    for (const m of st.list) if (isNum(m.id) && m.sender_id !== S.me.id && m.id > last) last = m.id;
    const c = S.convs.get(cid);
    if (c && c.unread) { c.unread = 0; renderConvList(); }
    if (!last || (S.readSent.get(cid) || 0) >= last) return;
    S.readSent.set(cid, last);
    api('api/messages.php?action=read', { body: { conversation_id: cid, message_id: last } }).catch(() => S.readSent.delete(cid));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeMarkRead(); });
  window.addEventListener('focus', () => { maybeMarkRead(); if (S.current) closeNotifs(S.current); });

  /* =====================================================================
     TYPING
     ===================================================================== */
  let typingOn = false, typingLast = 0, typingStopT = 0;
  function sendTyping(on) {
    const cid = S.current;
    if (!cid) return;
    clearTimeout(typingStopT);
    if (on) {
      typingStopT = setTimeout(() => sendTyping(false), 4000);
      if (typingOn && Date.now() - typingLast < 3000) return;
      typingOn = true; typingLast = Date.now();
      api('api/messages.php?action=typing', { body: { conversation_id: cid, typing: true } }).catch(() => {});
    } else if (typingOn) {
      typingOn = false;
      api('api/messages.php?action=typing', { body: { conversation_id: cid, typing: false } }).catch(() => {});
    }
  }
  const typingTimers = new Map();
  function onTyping(d) {
    const cid = d.conversation_id;
    if (!S.typing.has(cid)) S.typing.set(cid, new Set());
    const set = S.typing.get(cid);
    const key = cid + ':' + d.user_id;
    clearTimeout(typingTimers.get(key));
    let changed;
    if (d.typing) {
      changed = !set.has(d.user_id);
      set.add(d.user_id);
      typingTimers.set(key, setTimeout(() => {
        if (set.delete(d.user_id)) { updateTyping(); renderConvList(); }
      }, 7000));
    } else changed = set.delete(d.user_id);
    // Evenimentele typing se repetă la ~3 s: reînnoim doar expirarea, nu redesenăm lista.
    if (changed) { updateTyping(); renderConvList(); }
  }
  function updateTyping() {
    const cid = S.current;
    const row = $('#typingRow');
    const on = !!(cid && S.typing.get(cid) && S.typing.get(cid).size);
    if (on) {
      const uidT = S.typing.get(cid).values().next().value;
      const slot = $('.avatar-slot', row);
      if (!slot.firstChild || +slot.firstChild.dataset.uid !== uidT) slot.innerHTML = avatar(S.users.get(uidT), 'sm');
    }
    // v2.1.15: folosim isFollowing() + pinToBottom() — mai robust pe WebView
    const stick = isFollowing() || nearBottom();
    row.classList.toggle('on', on);
    if (on && stick) {
      pinToBottom();
    }
    renderHeader();
  }

  /* =====================================================================
     COMPOZITOR & TRIMITERE
     ===================================================================== */
  const input = $('#input');
  // crește odată cu textul; fără bare de derulare (inclusiv la zoom mare)
  function autoGrow() {
    input.style.height = 'auto';
    const max = parseFloat(getComputedStyle(input).maxHeight) || 140;
    const h = input.scrollHeight;
    input.style.height = Math.ceil(Math.min(h, max)) + 'px';
    input.classList.toggle('scrolling', h > max + 1);
  }
  function updateSendBtn() { $('#btnSend').classList.toggle('has-text', input.value.trim().length > 0); $('#composer').classList.toggle('has-text', input.value.trim().length > 0); }
  input.addEventListener('input', () => { autoGrow(); updateSendBtn(); if (input.value.trim()) sendTyping(true); else sendTyping(false); });
  input.addEventListener('keydown', e => {
    // v2.1.7: Enter trimite și pe telefon (tastatura soft); Shift+Enter = rând nou
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && S.settings.enter !== false) { e.preventDefault(); if (input.value.trim()) sendText(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendText(); }
    else if (e.key === 'Escape' && S.replyTo) clearReply();
  });
  /* v2.1.13: tastatura Android/WebView poate acoperi viewport-ul chiar cu adjustResize.
     Calculăm doar partea vizibilă; dacă browserul face deja resize, insetul este 0.
     v2.1.15: folosim isFollowing() + pinToBottom() și reancorăm pe mai multe frame-uri. */
  let kbFrame = 0, kbStickT = 0;
  function syncKeyboardInset() {
    kbFrame = 0;
    const vv = window.visualViewport;
    const inset = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
    const opening = inset > kbInset + 24;
    const stick = opening && kbFocus && S.current && (isFollowing() || nearBottom());
    kbInset = inset;
    if(document.body.style.getPropertyValue('--kb-inset')!==inset+'px')document.body.style.setProperty('--kb-inset',inset+'px');
    if (!stick) return;
    pinToBottom();
    clearTimeout(kbStickT);
    kbStickT = setTimeout(() => { if (S.current && kbFocus && isFollowing()) pinToBottom(); }, 180);
  }
  function queueKeyboardInset() { if (!kbFrame) kbFrame = requestAnimationFrame(syncKeyboardInset); }
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', queueKeyboardInset, { passive: true });
    visualViewport.addEventListener('scroll', queueKeyboardInset, { passive: true });
  }
  input.addEventListener('focus', () => {
    kbFocus = true;
    queueKeyboardInset();
    setTimeout(syncKeyboardInset, 300);
    // pe Android, focus-ul poate deschide tastatura cu întârziere — reancorăm
    if (S.current && isFollowing()) pinToBottom();
  });
  input.addEventListener('blur', () => { kbFocus = false; });
  syncKeyboardInset();

  // v2.1.7: unele tastaturi Android (Gboard, Samsung) nu trimit keydown Enter — prindem rândul nou din beforeinput
  input.addEventListener('beforeinput', e => {
    if ((e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') && S.settings.enter !== false && !e.isComposing && !shiftHeld) {
      e.preventDefault(); if (input.value.trim()) sendText();
    }
  });
  let shiftHeld = false;
  input.addEventListener('keydown', e => { shiftHeld = e.shiftKey; }, true);
  input.addEventListener('keyup', e => { shiftHeld = e.shiftKey; });
  input.addEventListener('blur', () => { shiftHeld = false; });
  $('#btnSend').addEventListener('click', () => {
    if (input.value.trim()) sendText();
    else sendBuzz();
    input.focus();
  });
  /* ---------------- BUZZ!!! (ca în Yahoo! Messenger) ---------------- */
  let buzzAt = 0;
  const BUZZ_URL = 'assets/sounds/buzz.mp3?v=' + encodeURIComponent(A.v || '1');
  let buzzAudio = null;
  function buzzSound() {
    if (S.settings && S.settings.sound === false) return;
    try {
      if (!buzzAudio) { buzzAudio = new Audio(BUZZ_URL); buzzAudio.preload = 'auto'; }
      buzzAudio.pause(); buzzAudio.currentTime = 0;
      const pr = buzzAudio.play();
      if (pr && pr.catch) pr.catch(() => {}); // browserul blochează sunetul până la primul click în pagină
    } catch (_) {}
  }
  // pregătim / deblocăm audio-ul pe iOS/Safari la prima interacțiune (buzz + prezență + mesaje)
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, function prime() {
    document.removeEventListener('pointerdown', prime, true); document.removeEventListener('keydown', prime, true);
    try {
      if (!buzzAudio) { buzzAudio = new Audio(BUZZ_URL); buzzAudio.preload = 'auto'; }
      buzzAudio.muted = true;
      const pr = buzzAudio.play();
      if (pr && pr.then) pr.then(() => { buzzAudio.pause(); buzzAudio.currentTime = 0; buzzAudio.muted = false; }).catch(() => { buzzAudio.muted = false; });
      else { buzzAudio.muted = false; }
    } catch (_) {}
    ['conectare', 'deconectare', 'mesaje'].forEach(n => {
      try {
        const a = SND[n] || (SND[n] = Object.assign(new Audio('assets/sounds/' + n + '.mp3?v=' + encodeURIComponent(A.v || '2')), { preload: 'auto' }));
        a.muted = true;
        const pr = a.play();
        if (pr && pr.then) pr.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
        else a.muted = false;
      } catch (_) {}
    });
  }, true));
  function shakeWindow() {
    const app = $('#app');
    app.classList.remove('buzzing'); void app.offsetWidth; app.classList.add('buzzing');
    clearTimeout(shakeWindow.t); shakeWindow.t = setTimeout(() => app.classList.remove('buzzing'), 900);
  }
  function doBuzz(m, fromMe) {
    shakeWindow();
    // v2.0.3: sună la trimitere (local) și la primire; ecoul din poll e deja filtrat (!mine && !known)
    if (fromMe || !isMine(m)) buzzSound();
    if (!fromMe) {
      try { navigator.vibrate && navigator.vibrate([90, 50, 90, 50, 160]); } catch (_) {}
      if (m.conversation_id !== S.current || document.hidden) toast('📳 '+firstName(m.sender_id)+' ți-a dat '+buzzCaption(m.conversation_id));
    }
    const el = rowEls.get(String(m.id)) || (m.client_uid && [...rowEls.values()].find(r => r._m && r._m.client_uid === m.client_uid));
    const b = el && $('.bubble.buzz', el);
    if (b) { b.classList.remove('bz-go'); void b.offsetWidth; b.classList.add('bz-go'); }
  }
  async function sendBuzz() {
    const cid = S.current;
    if(cid&&directRestricted(cid))return toast('Mesajele directe sunt oprite pentru acest contact.',true);
    if (cid && store(cid).context) return toast('Revino la cele mai noi pentru a trimite.');
    if (!cid) return;
    const now = Date.now();
    if (now - buzzAt < 3000) { shakeWindow(); toast('Așteaptă puțin între două BUZZ-uri'); return; }
    buzzAt = now;
    const btn = $('#btnSend'); btn.classList.remove('fire'); void btn.offsetWidth; btn.classList.add('fire');
    const m = tempMessage(cid, { type: 'buzz', body: 'BUZZ!!!' });
    upsertMessage(m, { force: true });
    bumpConv(cid, m);
    doBuzz(m, true);
    try {
      const j = await api('api/messages.php?action=buzz', { body: { conversation_id: cid, client_uid: m.client_uid } });
      await prep(j.message);
      upsertMessage(j.message);
      bumpConv(cid, j.message);
    } catch (e) {
      m._state = 'failed';
      if (cid === S.current) rerenderRow(m);
      toast('BUZZ-ul nu a ajuns: ' + e.message, true);
    }
  }
  document.addEventListener('keydown', e => { // Ctrl+G = BUZZ (scurtătura clasică din YM)
    if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key === 'g' || e.key === 'G') && S.current && !$('#thread').hidden) { e.preventDefault(); sendBuzz(); }
  });

  function tempMessage(cid, fields) {
    const cu = uid();
    OWN_UIDS.add(cu); // v2.0.2: marcat local ca „al meu” (ecoul din poll nu va suna)
    return Object.assign({ id: 'tmp_' + cu, conversation_id: cid, sender_id: S.me.id, type: 'text', body: null, meta: null, attachment: null, reply_to: null, reactions: [], client_uid: cu, created_at: Math.floor(Date.now() / 1000), _state: 'sending' }, fields);
  }
  function replyRef() {
    if (!S.replyTo) return null;
    const r = S.replyTo;
    return { id: r.id, sender_id: r.sender_id, type: r.type, body: r.type === 'text' ? String(r.body || '').slice(0, 200) : (r.attachment ? r.attachment.name : '') };
  }
  let preparingText = false;
  async function sendText() {
    const cid = S.current;
    if(cid&&directRestricted(cid))return toast('Mesajele directe sunt oprite pentru acest contact.',true);
    if (cid && store(cid).context) return toast('Revino la cele mai noi pentru a trimite.');
    const originalInput = input.value;
    const body = originalInput.replace(/\s+$/, '');
    if (!cid || !body.trim() || preparingText) return;
    if (body.length > 10000) { toast('Mesajul e prea lung (max 10000 caractere)', true); return; }
    preparingText = true;
    let sealed;
    try { sealed = await sealText(cid, body); }
    catch (e) { toast('Mesajul nu a fost trimis: ' + e.message, true); return; }
    finally { preparingText = false; }
    // Nu ștergem ce a scris utilizatorul între timp și nu trimitem în altă conversație.
    if (S.current !== cid || input.value !== originalInput) return;
    input.value = ''; autoGrow(); updateSendBtn(); S.drafts.delete(cid);
    typingOn = false; clearTimeout(typingStopT);
    const m = tempMessage(cid, { body, reply_to: replyRef() });
    const replyId = S.replyTo ? S.replyTo.id : null;
    clearReply();
    upsertMessage(m, { force: true });
    bumpConv(cid, m);
    await deliver(m, replyId, sealed);
  }
  /** v2.0: textul se criptează în browser înainte de trimitere (dacă E2E e disponibil în conversație) */
  async function sealText(cid, text) {
    const c = convOf(cid);
    let enc = null;
    try { enc = c ? await E2E.encryptText(c, text) : null; } catch (e) { console.warn('E2E', e); }
    if (enc) return enc;
    if (S.settings.e2eStrict) throw new Error('E2E nu e disponibil în această conversație, iar „Trimite doar criptat” e activ');
    return { body: text, e2e: null };
  }
  async function deliver(m, replyId, presealed = null) {
    m._state = 'sending';
    if (m.conversation_id === S.current) rerenderRow(m);
    try {
      const sealed = presealed || await sealText(m.conversation_id, m.body);
      const j = await api('api/messages.php?action=send', { body: { conversation_id: m.conversation_id, body: sealed.body, e2e: sealed.e2e, reply_to_id: replyId, client_uid: m.client_uid } });
      if (sealed.e2e) { decCache.set(cacheKey(j.message), m.body); }
      await prep(j.message);
      upsertMessage(j.message);
      bumpConv(m.conversation_id, j.message);
      // v2.0.2: fără sunet la trimitere (înainte: pop())
    } catch (e) {
      m._state = 'failed'; m._replyId = replyId;
      if (m.conversation_id === S.current) rerenderRow(m);
      toast('Mesajul nu a fost trimis: ' + e.message, true);
    }
  }
  msgList.addEventListener('click', e => {
    const r = e.target.closest('[data-retry]');
    if (r) {
      const st = store(S.current);
      const m = st.byId.get(r.dataset.retry);
      if (m && m.type === 'buzz') { st.list.splice(st.list.indexOf(m), 1); st.byId.delete(String(m.id)); const el = rowEls.get(String(m.id)); if (el) el.remove(); buzzAt = 0; sendBuzz(); }
      else if (m && m.type === 'text') deliver(m, m._replyId || null);
      else if (m && m._file) { st.list.splice(st.list.indexOf(m), 1); st.byId.delete(String(m.id)); const el = rowEls.get(String(m.id)); if (el) el.remove(); uploadOne(m._file, m.conversation_id, m._replyId); }
    }
  });
  function bumpConv(cid, m) {
    const c = S.convs.get(cid);
    if (!c) return;
    if (!c.last_message || !isNum(c.last_message.id) || !isNum(m.id) || m.id >= c.last_message.id) c.last_message = m;
    c.updated_at = Math.max(c.updated_at || 0, m.created_at);
    renderConvList();
  }

  /* ---------------- reply ---------------- */
  function setReply(m) {
    if (!m || !isNum(m.id)) return;
    S.replyTo = m;
    const mine = m.sender_id === S.me.id;
    $('#replyTitle').textContent = mine ? 'Îți răspunzi ție' : 'Răspunzi lui ' + nameOf(m.sender_id);
    let sn;
    if (m.type === 'image') sn = '📷 Poză';
    else if (m.type === 'video') sn = '🎬 Video';
    else if (m.type === 'buzz') sn = '📳 '+esc(buzzCaption(m.conversation_id));
    else if (m.type === 'text') sn = rich(String(m.body || '').slice(0, 140));
    else if (m.type === 'p2p') sn = '⚡ Transfer P2P';
    else sn = '📎 ' + esc(m.attachment ? m.attachment.name : 'Fișier');
    $('#replySnippet').innerHTML = sn;
    $('#replyStrip').classList.add('on');
    input.focus();
  }
  function clearReply() { S.replyTo = null; $('#replyStrip').classList.remove('on'); }
  $('#replyClose').addEventListener('click', clearReply);

  /* =====================================================================
     REACȚII & ACȚIUNI PE BULE
     ===================================================================== */
  const msgOf = el => { const row = el.closest('.row') || el.closest('#messageToolbar')?._row; return row && row._m ? store(S.current).byId.get(String(row._m.id)) || row._m : null; };
  // One viewport-clamped toolbar, outside zoom/animated rows and scroll clipping.
  // Metadata is a real sibling of the controls, never an absolute overlay on bubble text.
  const floatingToolbar=document.createElement('div');floatingToolbar.id='messageToolbar';floatingToolbar.hidden=true;
  floatingToolbar.setAttribute('role','group');floatingToolbar.setAttribute('aria-label','Acțiuni și detalii mesaj');document.body.append(floatingToolbar);
  let toolbarRow=null,toolbarHideTimer=0,toolbarInput='keyboard';
  function cancelToolbarHide(){clearTimeout(toolbarHideTimer);toolbarHideTimer=0;}
  function hideMessageToolbar(){cancelToolbarHide();floatingToolbar.hidden=true;floatingToolbar._row=null;toolbarRow=null;}
  function positionMessageToolbar(){
    if(!toolbarRow?.isConnected)return hideMessageToolbar();
    const bubble=$('.bubble',toolbarRow);if(!bubble)return hideMessageToolbar();
    const bounds=messagesEl.getBoundingClientRect(),edge=6,gap=10;
    const leftBound=Math.max(edge,bounds.left+edge),rightBound=Math.min(innerWidth-edge,bounds.right-edge);
    floatingToolbar.style.maxWidth=Math.max(1,rightBound-leftBound)+'px';
    const b=bubble.getBoundingClientRect(),t=floatingToolbar.getBoundingClientRect(),own=toolbarRow.classList.contains('out');
    // Bubble edges and center ONLY. No pointer coordinates and no pointer-move positioning.
    const preferred=own?b.left-t.width-gap:b.right+gap,opposite=own?b.right+gap:b.left-t.width-gap;
    const fits=v=>v>=leftBound&&v+t.width<=rightBound;
    const left=Math.max(leftBound,Math.min(fits(preferred)?preferred:fits(opposite)?opposite:preferred,rightBound-t.width));
    const top=Math.max(edge,Math.min(b.top+(b.height-t.height)/2,innerHeight-t.height-edge));
    floatingToolbar.style.left=left+'px';floatingToolbar.style.top=top+'px';
  }
  function showMessageToolbar(row,refresh=false){
    cancelToolbarHide();
    if(!row?.isConnected||row.classList.contains('sys'))return hideMessageToolbar();
    if(toolbarRow===row&&!refresh&&!floatingToolbar.hidden)return;
    const source=$('.msg-toolbar',row);if(!source)return hideMessageToolbar();
    toolbarRow=row;floatingToolbar._row=row;floatingToolbar.innerHTML=source.innerHTML;floatingToolbar.hidden=false;
    positionMessageToolbar();
  }
  function scheduleToolbarHide(){
    if(toolbarHideTimer)return;
    toolbarHideTimer=setTimeout(()=>{
      toolbarHideTimer=0;
      const bubble=toolbarRow&&$('.bubble',toolbarRow);
      const keyboardFocus=toolbarInput==='keyboard'&&toolbarRow?.contains(document.activeElement);
      if(!floatingToolbar.matches(':hover')&&!floatingToolbar.contains(document.activeElement)&&!bubble?.matches(':hover')&&!keyboardFocus)hideMessageToolbar();
    },160);
  }
  const bubbleAt=target=>target?.closest?.('.bubble');
  function inToolbarBridge(x,y){
    if(!toolbarRow||floatingToolbar.hidden)return false;
    const bubble=$('.bubble',toolbarRow);if(!bubble)return false;
    const b=bubble.getBoundingClientRect(),t=floatingToolbar.getBoundingClientRect();
    // Only the narrow horizontal gap where bubble and toolbar vertical extents meet.
    const left=t.right<=b.left?t.right:b.right<=t.left?b.right:NaN;
    const right=t.right<=b.left?b.left:b.right<=t.left?t.left:NaN;
    return x>=left-4&&x<=right+4&&y>=Math.max(b.top,t.top)-4&&y<=Math.min(b.bottom,t.bottom)+4;
  }
  msgList.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch')return;
    const bubble=bubbleAt(e.target);if(!bubble)return;
    toolbarInput='pointer';showMessageToolbar(bubble.closest('.row'));
  });
  msgList.addEventListener('pointerout',e=>{
    if(e.pointerType==='touch')return;
    const bubble=bubbleAt(e.target);if(!bubble||bubble.contains(e.relatedTarget))return;
    if(floatingToolbar.contains(e.relatedTarget)){cancelToolbarHide();return;}
    scheduleToolbarHide();
  });
  document.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch')return;
    const bubble=bubbleAt(e.target);
    if(bubble&&msgList.contains(bubble)){
      toolbarInput='pointer';cancelToolbarHide();
      const row=bubble.closest('.row');
      if(row!==toolbarRow||floatingToolbar.hidden)showMessageToolbar(row);
      return; // Static while hovering this bubble, regardless of cursor movement.
    }
    if(floatingToolbar.hidden)return;
    if(floatingToolbar.contains(e.target)){cancelToolbarHide();return;}
    if(inToolbarBridge(e.clientX,e.clientY)){scheduleToolbarHide();return;}
    hideMessageToolbar();
  },{passive:true});
  document.addEventListener('keydown',()=>{toolbarInput='keyboard';},true);
  document.addEventListener('pointerdown',e=>{
    toolbarInput='pointer';
    if(!floatingToolbar.contains(e.target)&&!bubbleAt(e.target))hideMessageToolbar();
  },true);
  msgList.addEventListener('focusin',e=>{if(toolbarInput!=='keyboard')return;const row=e.target.closest('.row');if(row)showMessageToolbar(row);});
  msgList.addEventListener('focusout',scheduleToolbarHide);
  floatingToolbar.addEventListener('pointerenter',cancelToolbarHide);
  floatingToolbar.addEventListener('pointerleave',scheduleToolbarHide);floatingToolbar.addEventListener('focusout',scheduleToolbarHide);
  floatingToolbar.addEventListener('keydown',e=>{if(e.key==='Escape'){const row=toolbarRow;row?.focus({preventScroll:true});hideMessageToolbar();}});
  document.addEventListener('pointerout',e=>{if(e.pointerType!=='touch'&&!e.relatedTarget)hideMessageToolbar();});
  messagesEl.addEventListener('scroll',hideMessageToolbar,{passive:true});window.addEventListener('resize',hideMessageToolbar);window.addEventListener('blur',hideMessageToolbar);

  const myReaction = m => { const r = (m.reactions || []).find(x => x.user_id === S.me.id); return r ? r.emoji : null; };
  async function react(m, emoji) {
    if(isRetiredReaction(emoji))return;
    if (!m || !isNum(m.id)) return;
    const prev = m.reactions || [];
    const mine = myReaction(m);
    let next = prev.filter(x => x.user_id !== S.me.id);
    if (mine !== emoji) next = next.concat([{ user_id: S.me.id, emoji }]);
    m.reactions = next; rerenderRow(m);
    try {
      const j = await api('api/messages.php?action=react', { body: { message_id: m.id, emoji } });
      m.reactions = j.reactions; rerenderRow(m);
    } catch (e) { m.reactions = prev; rerenderRow(m); toast(e.message, true); }
  }
  function messageClick(e) {
    const a = e.target.closest('[data-a]');
    if (a) {
      const m = msgOf(a);
      if (a.dataset.a === 'react' && m) react(m,LIKE_EMOJI);
      if (a.dataset.a === 'reply') setReply(m);
      if (a.dataset.a === 'pin') TexConversationTools.pin(m);
      if (a.dataset.a === 'edit') TexConversationTools.edit(m);
      return;
    }
    const j = e.target.closest('[data-jump]');
    if (j) { jumpTo(+j.dataset.jump); return; }
    const lb = e.target.closest('[data-lb]');
    if (lb) { openLightbox(msgOf(lb), lb); return; }
    const p = e.target.closest('[data-p2p]');
    if (p) { const m = msgOf(p); if (m) Promise.resolve(P2P.action(p.dataset.p2p, m, p)).catch(err => toast(err.message, true)); return; }
    const dz = e.target.closest('[data-dec]');
    if (dz) {
      const m = msgOf(dz);
      if (m) decryptAtt(m, m.type === 'file' ? u => { const a = document.createElement('a'); a.href = u; a.download = m.attachment.name; document.body.appendChild(a); a.click(); a.remove(); } : null).catch(err => toast('Nu am putut decripta: ' + err.message, true));
      return;
    }
    const rr = e.target.closest('[data-react]');
    if (rr) {
      const m=msgOf(rr); if(!m)return;
      toast(visibleReactions(m).map(x => (x.user_id === S.me.id ? 'Tu' : nameOf(x.user_id)) + ': ' + reactionLabel(x.emoji)).join(' · '));
    }
  }
  msgList.addEventListener('click',messageClick);floatingToolbar.addEventListener('click',messageClick);
  msgList.addEventListener('dblclick', e => {
    const b = e.target.closest('.bubble');
    if (!b || e.target.closest('a,button,video,audio,.p2p-card')) return;
    if (Date.now() - likeAt < 500) return; // suppress synthetic duplicate Like after double-tap
    likeToggle(b);
    window.getSelection && window.getSelection().removeAllRanges();
  });
  // Like remains a generic, explicit reaction.
  let likeAt = 0;
  function likeToggle(b) {
    const m = msgOf(b);
    if (!m || !isNum(m.id)) return;
    likeAt = Date.now();
    react(m, LIKE_EMOJI);
  }
  msgList.addEventListener('keydown',e=>{if((e.key==='ContextMenu'||e.shiftKey&&e.key==='F10')&&!e.target.closest('a,button,input,textarea,video,audio')){const m=msgOf(e.target);if(m&&m.type!=='system'){e.preventDefault();openSheet(m);}}});
  /* long-press (mobil) & swipe pentru reply */
  const sheet = $('#actionSheet');
  let sheetFor = null;
  function openSheet(m) {
    if(!m)return;
    hideMessageToolbar();
    sheetFor = m;
    $('#asMetadata').textContent=(isE2E(m)?'Criptat end-to-end · ':'')+fmtTime(m.created_at)+(m.edited_at?' · editat':'');
    $('[data-act=like]',sheet).textContent=isLikeCode(myReaction(m)) ? 'Elimină reacția' : 'Îmi place 👍';
    $('[data-act=copy]', sheet).hidden = m.type !== 'text';
    $('[data-act=pin]', sheet).hidden = !isNum(m.id) || m.type === 'system';
    $('[data-act=pin]', sheet).textContent = TexConversationTools.isPinned(m) ? 'Anulează fixarea' : 'Fixează mesajul';
    $('[data-act=edit]', sheet).hidden = !TexConversationTools.canEdit(m);
    sheet.hidden = false;
    requestAnimationFrame(()=>{if(!sheet.hidden)($('[data-act=edit]:not([hidden])',sheet)||$('[data-act]:not([hidden])',sheet))?.focus({preventScroll:true});});
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
  }
  function closeSheet() { sheet.hidden = true; sheetFor = null; }
  sheet.addEventListener('click', e => {
    if (e.target.classList.contains('as-backdrop')) return closeSheet();
    const a = e.target.closest('[data-act]');
    if (!a || !sheetFor) return;
    if (a.dataset.act === 'like') react(sheetFor,LIKE_EMOJI);
    if (a.dataset.act === 'reply') setReply(sheetFor);
    if (a.dataset.act === 'pin') TexConversationTools.pin(sheetFor);
    if (a.dataset.act === 'edit') TexConversationTools.edit(sheetFor);
    if (a.dataset.act === 'copy') navigator.clipboard && navigator.clipboard.writeText(sheetFor.body || '').then(() => toast('Text copiat'));
    closeSheet();
  });
  const LP_SHEET_MS = 450, LP_MOVE = 10;
  const lpTarget = t => { const b = t.closest && t.closest('.bubble'); return b && !t.closest('a,button,video,audio,input,textarea,.msg-actions') && !b.closest('.row.sys') ? b : null; };
  /* Mouse hold on own messages retains edit/actions; no reaction gesture. */
  let mlp = null;
  msgList.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const b = lpTarget(e.target); if (!b || msgOf(b)?.sender_id!==S.me.id) return;
    mlp = { b, x: e.clientX, y: e.clientY };
    mlp.timer = setTimeout(() => { if (!mlp) return; window.getSelection?.().removeAllRanges(); openSheet(msgOf(b)); mlp = null; }, LP_SHEET_MS);
  });
  msgList.addEventListener('pointermove', e => {
    if (!mlp || e.pointerType !== 'mouse') return;
    if (Math.abs(e.clientX - mlp.x) > LP_MOVE || Math.abs(e.clientY - mlp.y) > LP_MOVE) { clearTimeout(mlp.timer); mlp = null; } // selecție de text / drag → anulează
  });
  const mlpCancel = () => { if (mlp) { clearTimeout(mlp.timer); mlp = null; } };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => msgList.addEventListener(ev, e => { if (e.pointerType === 'mouse') mlpCancel(); }));
  msgList.addEventListener('scroll', mlpCancel, { passive: true });

  /* Mobile: open while held at1500ms, never defer the action until release. */
  const LP_TOUCH_MS=1500;
  let lp = null, lastTap = null,holdClickBlock=null;
  function cancelMobileHold(){
    if(!lp)return;const c=lp;lp=null;
    clearTimeout(c.timer);c.b.classList.remove('pressed');c.row.style.transition='';c.row.style.transform='';
    const pending=c.row._touchRenderPending;delete c.row._touchRenderPending;
    if(pending && c.row.isConnected)rerenderRow(pending);
  }
  // Keep menu-hold cleanup valid even if an unrelated incoming update rerenders a row.
  // Finish the originating touch at document capture, not only on the detached target's ancestors.
  function finishHeldTouch(e){
    const g=holdClickBlock;if(!g?.held)return;
    const t=[...e.changedTouches].find(t=>t.identifier===g.id);if(!t)return;
    g.x=t.clientX;g.y=t.clientY;g.held=false;g.until=Date.now()+650;
    if(lp?.handled)cancelMobileHold();
    if(e.type==='touchend' && e.cancelable)e.preventDefault();
  }
  document.addEventListener('touchend',finishHeldTouch,{capture:true,passive:false});
  document.addEventListener('touchcancel',finishHeldTouch,{capture:true,passive:true});
  document.addEventListener('touchstart',()=>{if(holdClickBlock && !holdClickBlock.held)holdClickBlock=null;},{capture:true,passive:true});
  document.addEventListener('click',e=>{const g=holdClickBlock;if(g&&(e.detail!==0||e.sourceCapabilities?.firesTouchEvents)&&(g.held||Date.now()<g.until)&&Math.abs(e.clientX-g.x)<30&&Math.abs(e.clientY-g.y)<30){e.preventDefault();e.stopImmediatePropagation();}},true);
  messagesEl.addEventListener('scroll',cancelMobileHold,{passive:true});
  msgList.addEventListener('touchstart', e => {
    cancelMobileHold();
    const b = lpTarget(e.target);
    if (!b || e.touches.length > 1)return;
    const t = e.touches[0];
    lp = { b, id:t.identifier, x: t.clientX, y: t.clientY, dx: 0, moved: false, row: b.closest('.row'), t0: Date.now(), handled:false };
    const gesture=lp;
    lp.timer=setTimeout(()=>{
      if(lp!==gesture||lp.moved||!b.isConnected)return;
      const m=msgOf(b);if(!m||!isNum(m.id))return;
      lp.handled=true;lastTap=null;b.classList.remove('pressed');
      holdClickBlock={held:true,id:gesture.id,x:gesture.x,y:gesture.y,until:0};
      window.getSelection?.().removeAllRanges();
      openSheet(m); // Actions only, never an automatic reaction.
    },LP_TOUCH_MS);
  }, { passive: true });
  msgList.addEventListener('touchmove', e => {
    if (!lp || lp.handled) return;
    const t = e.touches[0];
    const dx = t.clientX - lp.x, dy = t.clientY - lp.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { lp.moved = true; clearTimeout(lp.timer);  lp.b.classList.remove('pressed'); }
    if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) { lp.row.style.transform = ''; lp = null; return; }
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) { lp.dx = Math.min(dx, 90); lp.row.style.transition = 'none'; lp.row.style.transform = `translateX(${lp.dx * 0.8}px)`; }
  }, { passive: true });
  msgList.addEventListener('touchend', e => {
    if (!lp) return;
    clearTimeout(lp.timer); 
    const c = lp; lp = null;
    const row = c.row;
    c.b.classList.remove('pressed');
    if (c.dx > 60) { const m = msgOf(c.b); if (m) setReply(m); if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {} }
    row.style.transition = 'transform .5s var(--spring)'; row.style.transform = '';
    if(c.handled){lastTap=null;if(e.cancelable)e.preventDefault();return;} // Already opened while held; release does nothing.
    // dublu-tap (<300ms, aceeași bulă, fără mișcare) → like 👍
    if (!c.moved && c.dx === 0 && Date.now() - c.t0 < 300 && lpTarget(e.target)) {
      const now = Date.now();
      if (lastTap && lastTap.b === c.b && now - lastTap.t < 300 && Math.abs(lastTap.x - c.x) < 30 && Math.abs(lastTap.y - c.y) < 30) {
        lastTap = null;
        if (e.cancelable) e.preventDefault(); // împiedică zoom-ul la dublu-tap și dblclick-ul sintetic
        likeToggle(c.b);
      } else lastTap = { b: c.b, t: now, x: c.x, y: c.y };
    } else lastTap = null;
  });
  msgList.addEventListener('touchcancel',cancelMobileHold);
  msgList.addEventListener('contextmenu', e => { const b=lpTarget(e.target);if(!b)return;e.preventDefault();if(!matchMedia('(pointer:coarse)').matches)openSheet(msgOf(b)); });

  /* =====================================================================
     EMOTICOANE YAHOO! — panou
     ===================================================================== */
  const emoPanel = $('#emoPanel');
  let emoCb = null;
  function renderEmoGrid(q) {
    q = (q || '').trim().toLowerCase();
    const list = q ? EMO.filter(e => e[1].toLowerCase().includes(q) || e[2].toLowerCase().includes(q)) : EMO;
    $('#emoGrid').innerHTML = list.map(e => `<button data-code="${esc(e[2])}" data-name="${esc(e[1])}" title="${esc(e[1])}  ${esc(e[2])}"><img src="${emoSrc(e[0])}" data-gif="${e[0]}" alt="${esc(e[2])}" loading="lazy" decoding="async"></button>`).join('') || '<div class="muted" style="grid-column:1/-1;padding:10px">Nimic găsit</div>';
  }
  function openEmoPanel(anchor, cb) {
    emoCb = cb || null;
    if (!$('#emoGrid').firstChild) renderEmoGrid('');
    emoPanel.classList.remove('closing');
    placePopover(emoPanel, anchor, 'right');
    if (matchMedia('(pointer:fine)').matches) setTimeout(() => $('#emoFilter').focus(), 50);
  }
  $('#btnEmo').addEventListener('click', e => { e.stopPropagation(); if (!emoPanel.hidden) return closePopover(emoPanel); openEmoPanel($('#btnEmo'), null); });
  $('#emoFilter').addEventListener('input', e => renderEmoGrid(e.target.value));
  $('#emoGrid').addEventListener('mouseover', e => { const b = e.target.closest('button'); if (b) $('#emoFoot').innerHTML = `<b>${esc(b.dataset.name)}</b> &nbsp; <code>${esc(b.dataset.code)}</code>`; });
  $('#emoGrid').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const code = b.dataset.code;
    if (emoCb) { emoCb(code); emoCb = null; closePopover(emoPanel); return; }
    const s = input.selectionStart ?? input.value.length, en = input.selectionEnd ?? s;
    const before = input.value.slice(0, s), after = input.value.slice(en);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    input.value = before + pad + code + ' ' + after;
    const pos = (before + pad + code + ' ').length;
    input.setSelectionRange(pos, pos);
    autoGrow(); updateSendBtn();
    b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    if (!e.shiftKey && matchMedia('(pointer:coarse)').matches) closePopover(emoPanel);
  });
  document.addEventListener('click', e => {
    if (!emoPanel.hidden && !e.target.closest('#emoPanel,#btnEmo')) closePopover(emoPanel);
    if (!$('#attachMenu').hidden && !e.target.closest('#attachMenu,#btnAttach')) closePopover($('#attachMenu'));
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#lightbox').hidden) return closeLightbox();
    if (!$('#zoomPop').hidden) return closePopover($('#zoomPop'));
    if (!emoPanel.hidden) return closePopover(emoPanel);
    if (!sheet.hidden) return closeSheet();
    if (!$('#settings').hidden) { if (window.TexSettings && TexSettings.back()) return; return closeModal($('#settings')); }
  });

  /* =====================================================================
     FIȘIERE: atașare, drag & drop, paste, upload în bucăți
     ===================================================================== */
  const attachMenu = $('#attachMenu');
  $('#btnAttach').addEventListener('click', e => { e.stopPropagation(); if (!attachMenu.hidden) return closePopover(attachMenu); attachMenu.classList.remove('closing'); placePopover(attachMenu, $('#btnAttach'), 'left'); });
  attachMenu.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closePopover(attachMenu);
    ({ image: '#fileImage', p2p: '#fileP2P', server: '#fileServer' })[b.dataset.act] && $(({ image: '#fileImage', p2p: '#fileP2P', server: '#fileServer' })[b.dataset.act]).click();
  });
  $('#btnImage').addEventListener('click', () => $('#fileImage').click());
  $('#btnP2P').addEventListener('click', () => $('#fileP2P').click());
  $('#btnP2PHead').addEventListener('click', () => $('#fileP2P').click());
  const btnVc = $('#btnVideoCall');
  if (btnVc) btnVc.addEventListener('click', () => { if (!S.current) return; Call.start(S.current); });
  const takeFiles = (el, fn) => el.addEventListener('change', () => { const f = Array.from(el.files || []); el.value = ''; if (f.length) fn(f); });
  takeFiles($('#fileImage'), f => uploadFiles(f, S.current));
  takeFiles($('#fileServer'), f => uploadFiles(f, S.current));
  takeFiles($('#fileP2P'), f => sendP2P(f));

  function sendP2P(files) {
    const cid = S.current;
    if (!cid) return;
    const replyId = S.replyTo ? S.replyTo.id : null;
    clearReply();
    P2P.sendFiles(cid, files, replyId);
  }
  const isMedia = f => /^(image|video)\//.test(f.type);
  function handleFiles(files) {
    if (!S.current || !files.length) return;
    const total = files.reduce((a, f) => a + f.size, 0);
    const tooBig = A.maxUpload > 0 && files.some(f => f.size > A.maxUpload);
    if (files.every(isMedia) && total < 200 * 1024 * 1024 && !tooBig) return uploadFiles(files, S.current);
    chooseSendMode(files, total, tooBig);
  }
  function chooseSendMode(files, total, tooBig) {
    const m = $('#sendChoice');
    $('#sendChoiceInfo').textContent = `${files.length} fișier${files.length > 1 ? 'e' : ''} · ${fmtSize(total)}` + (tooBig ? ' · depășește limita serverului, folosește P2P' : '');
    $('[data-choice=server]', m).disabled = tooBig;
    $('[data-choice=p2p]', m).disabled = !P2P.supported();
    m._files = files;
    openModal(m);
  }
  $('#sendChoice').addEventListener('click', e => {
    const m = $('#sendChoice');
    if (e.target.classList.contains('modal-backdrop')) return closeModal(m);
    const b = e.target.closest('[data-choice]');
    if (!b) return;
    const f = m._files; m._files = null;
    closeModal(m);
    if (b.dataset.choice === 'p2p') sendP2P(f);
    else if (b.dataset.choice === 'server') uploadFiles(f, S.current);
  });

  const chat = $('#chat'), drop = $('#dropOverlay');
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  chat.addEventListener('dragenter', e => { if (!hasFiles(e) || !S.current) return; e.preventDefault(); dragDepth++; drop.classList.add('on'); });
  chat.addEventListener('dragover', e => { if (!hasFiles(e) || !S.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  chat.addEventListener('dragleave', e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('on'); });
  chat.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; drop.classList.remove('on');
    handleFiles(Array.from(e.dataTransfer.files || []));
  });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });
  input.addEventListener('paste', e => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (files.length) { e.preventDefault(); handleFiles(files); }
  });

  function uploadFiles(files, cid) {
    if(cid&&directRestricted(cid))return toast('Mesajele directe sunt oprite pentru acest contact.',true);
    if (!cid) return;
    if (store(cid).context) return toast('Revino la cele mai noi pentru a trimite.');
    const replyId = S.replyTo ? S.replyTo.id : null;
    clearReply();
    files.forEach((f, i) => uploadOne(f, cid, i === 0 ? replyId : null));
  }
  function typeOfFile(f) { if (/^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(f.type)) return 'image'; if (/^video\//.test(f.type)) return 'video'; if (/^audio\//.test(f.type)) return 'audio'; return 'file'; }
  function imgDims(f) {
    return new Promise(res => {
      if (typeOfFile(f) !== 'image') return res(null);
      const u = URL.createObjectURL(f), im = new Image();
      im.onload = () => res([im.naturalWidth, im.naturalHeight, u]);
      im.onerror = () => res(null);
      im.src = u;
    });
  }
  function xhrChunk(url, blob, onProg, resumed = false) {
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('X-CSRF-Token', A.csrf);
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = e => onProg(e.loaded);
      x.onload = async () => {
        try {
          if (!resumed && (x.status === 401 || x.status === 419)) { await refreshSession(); return res(await xhrChunk(url, blob, onProg, true)); }
          const j = JSON.parse(x.responseText); if (j.ok) res(j); else rej(new Error(j.error || 'Eroare'));
        } catch (e) { rej(e instanceof SyntaxError ? new Error('Eroare server (' + x.status + ')') : e); }
      };
      x.onerror = () => rej(new Error('Conexiune întreruptă'));
      x.ontimeout = () => rej(new Error('Timeout'));
      x.send(blob);
    });
  }
  async function uploadOne(file, cid, replyId) {
    if(cid&&directRestricted(cid))return toast('Mesajele directe sunt oprite pentru acest contact.',true);
    const kind = typeOfFile(file);
    const dims = await imgDims(file);
    const fakeAttId = 'loc_' + uid();
    const att = { id: fakeAttId, name: file.name || 'fisier', mime: file.type, size: file.size, width: dims ? dims[0] : null, height: dims ? dims[1] : null, url: '#' };
    if (dims) S.blobByAtt.set(fakeAttId, dims[2]);
    else if (kind === 'video') S.blobByAtt.set(fakeAttId, URL.createObjectURL(file));
    const m = tempMessage(cid, { type: kind, attachment: att, _upload: { pct: 0 }, _file: file, _replyId: replyId });
    const st = store(cid);
    if (replyId) { const r = st.byId.get(String(replyId)); if (r) m.reply_to = { id: r.id, sender_id: r.sender_id, type: r.type, body: r.type === 'text' ? r.body : (r.attachment ? r.attachment.name : '') }; }
    upsertMessage(m, { force: true });
    bumpConv(cid, m);
    const setPct = p => {
      m._upload = { pct: p };
      const el = rowEls.get(String(m.id));
      if (!el) return;
      const fg = $('.ring .fg', el);
      if (fg) fg.setAttribute('stroke-dashoffset', (119.4 * (1 - p)).toFixed(1));
      const sub = $('.file-sub', el);
      if (sub) sub.textContent = `Se încarcă… ${Math.floor(p * 100)}% · ${fmtSize(file.size)}`;
    };
    try {
      // v2.0 E2E: fișierul se criptează în browser pe bucăți; serverul primește doar octeți cifrați
      let enc = null;
      const conv = convOf(cid);
      try { enc = conv ? await E2E.fileEncryptor(conv, file, { name: file.name || 'fisier', mime: file.type || 'application/octet-stream', size: file.size, type: kind, width: dims ? dims[0] : null, height: dims ? dims[1] : null }, A.chunkBytes || 2 * 1024 * 1024) : null; } catch (e) { console.warn('E2E file', e); }
      if (!enc && S.settings.e2eStrict) throw new Error('E2E nu e disponibil, iar „Trimite doar criptat” e activ');
      if (enc) {
        const init = await api('api/upload.php?action=init', { body: { conversation_id: cid, name: 'fisier-criptat.bin', size: enc.total } });
        const token = init.token;
        let off = 0, tries = 0;
        while (off < enc.total) {
          const idx = Math.floor(off / enc.ecs);
          try {
            const ct = await enc.chunk(idx);
            const part = ct.subarray(off - idx * enc.ecs);
            const j = await xhrChunk(`api/upload.php?action=chunk&token=${token}&offset=${off}`, new Blob([part]), l => setPct((off + l) / enc.total));
            off = j.received; tries = 0;
            setPct(off / enc.total);
          } catch (e) {
            if (++tries > 6) throw e;
            await sleep(800 * tries);
            try { const s2 = await api('api/upload.php?action=status', { body: { token } }); off = s2.received; } catch (_) {}
          }
        }
        const fin = await api('api/upload.php?action=finish', { body: { token, reply_to_id: replyId, client_uid: m.client_uid, e2e: enc.e2e } });
        const real = fin.message;
        await prep(real);
        if (real.attachment) {
          const local = S.blobByAtt.get(fakeAttId) || URL.createObjectURL(file);
          S.blobByAtt.set(real.attachment.id, local);
        }
        delete m._file;
        upsertMessage(real);
        bumpConv(cid, real);
        // v2.0.2: fără sunet la trimitere (înainte: pop())
        return;
      }
      const init = await api('api/upload.php?action=init', { body: { conversation_id: cid, name: file.name || 'fisier', size: file.size } });
      const token = init.token, cs = init.chunk_bytes || A.chunkBytes || 2 * 1024 * 1024;
      let off = 0, tries = 0;
      while (off < file.size) {
        const end = Math.min(off + cs, file.size);
        try {
          const j = await xhrChunk(`api/upload.php?action=chunk&token=${token}&offset=${off}`, file.slice(off, end), l => setPct((off + l) / Math.max(1, file.size)));
          off = j.received; tries = 0;
          setPct(off / Math.max(1, file.size));
        } catch (e) {
          if (++tries > 6) throw e;
          await sleep(800 * tries);
          try { const s = await api('api/upload.php?action=status', { body: { token } }); off = s.received; } catch (_) {}
        }
      }
      const fin = await api('api/upload.php?action=finish', { body: { token, reply_to_id: replyId, client_uid: m.client_uid, width: dims ? dims[0] : null, height: dims ? dims[1] : null } });
      const real = fin.message;
      if (real.attachment && S.blobByAtt.has(fakeAttId)) S.blobByAtt.set(real.attachment.id, S.blobByAtt.get(fakeAttId));
      delete m._file;
      upsertMessage(real);
      bumpConv(cid, real);
      // v2.0.2: fără sunet la trimitere (înainte: pop())
      // după ce originalul de pe server e în cache, eliberăm blob-ul local
      if (real.attachment && kind === 'image') {
        const pre = new Image();
        pre.onload = () => { const u = S.blobByAtt.get(real.attachment.id); S.blobByAtt.delete(real.attachment.id); S.blobByAtt.delete(fakeAttId); if (u) setTimeout(() => URL.revokeObjectURL(u), 5000); };
        pre.src = real.attachment.url;
      }
    } catch (e) {
      m._state = 'failed'; delete m._upload;
      if (cid === S.current) rerenderRow(m);
      toast(`„${file.name}” nu a fost trimis: ${e.message}`, true);
    }
  }

  /* ---------------- lightbox ---------------- */
  const lb = $('#lightbox');
  function openLightbox(m, imgEl) {
    if (!m || !m.attachment) return;
    const a = m.attachment;
    const src = imgEl.currentSrc || imgEl.src;
    $('#lbImg').src = src;
    $('#lbInfo').textContent = `${a.name} · ${a.width && a.height ? a.width + '×' + a.height + ' · ' : ''}${fmtSize(a.size)} · ${nameOf(m.sender_id)}, ${fmtSep(m.created_at)}`;
    const dl = $('#lbDownload');
    if (isNum(a.id)) { dl.href = isE2E(m) && S.blobByAtt.get(a.id) ? S.blobByAtt.get(a.id) : a.url + '&download=1'; dl.hidden = false; dl.setAttribute('download', a.name); } else dl.hidden = true;
    $('#lbStage').classList.remove('zoom');
    lb.hidden = false; lb.classList.remove('closing');
  }
  function closeLightbox() { if (lb.hidden) return; lb.classList.add('closing'); setTimeout(() => { lb.hidden = true; lb.classList.remove('closing'); $('#lbImg').removeAttribute('src'); }, 220); }
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lbStage').addEventListener('click', e => { if (e.target.id === 'lbImg') $('#lbStage').classList.toggle('zoom'); else closeLightbox(); });

  /* =====================================================================
     v2.0 — E2E: decriptare mesaje / pregătire
     ===================================================================== */
  const cacheKey = m => String(m.id) + ':' + (+m.edited_revision || 0);
  const decCache = new Map(); // id mesaj => text decriptat
  const metaCache = new Map(); // id mesaj => meta fișier/P2P decriptate
  async function prep(m) {
    if (!m) return m;
    const c = convOf(m.conversation_id);
    if (m.reply_to && m.reply_to.meta && m.reply_to.meta.e2e && !m.reply_to._dec && c) {
      const r = m.reply_to;
      try { r.body = decCache.has(cacheKey(r)) ? decCache.get(cacheKey(r)) : (r.type === 'text' ? await E2E.decryptText(c, r.body, r.meta.e2e) : (await E2E.decryptFileMeta(c, r.meta.e2e)).name); decCache.set(cacheKey(r), r.body); r._dec = 1; }
      catch (_) { r._e2eFail = true; r.body = ''; }
    }
    const e = m.meta && m.meta.e2e;
    if (!e || !c || m.deleted) return m;
    try {
      if (m.type === 'text') {
        if (!m._dec) { m.body = decCache.has(cacheKey(m)) ? decCache.get(cacheKey(m)) : await E2E.decryptText(c, m.body, e); decCache.set(cacheKey(m), m.body); m._dec = 1; }
        delete m._e2eFail;
      } else if (m.attachment) {
        let info = metaCache.get(m.id);
        if (!info) { info = await E2E.decryptFileMeta(c, e); metaCache.set(m.id, info); }
        Object.assign(m.attachment, { name: info.name || 'fisier', mime: info.mime || 'application/octet-stream', size: info.size || m.attachment.size, width: info.width || null, height: info.height || null });
        if (m.body && !m._dec) { try { m.body = await E2E.decryptText(c, m.body, m.meta.caption_e2e || Object.assign({}, e, { iv: e.bi || e.iv })); m._dec = 1; } catch (_) { m.body = ''; m._captionFail = true; } }
        delete m._e2eFail;
      } else if (m.type === 'p2p') {
        let info = metaCache.get(m.id);
        if (!info) { info = await E2E.decryptJson(c, e, 'p2pmeta'); metaCache.set(m.id, info); }
        if (info && Array.isArray(info.files) && m.meta.files) m.meta.files = m.meta.files.map((f, i) => Object.assign({}, f, info.files[i] || {}));
        delete m._e2eFail;
      }
    } catch (err) {
      m._e2eFail = true;
      if (m.attachment) m.attachment.name = 'fișier criptat';
    }
    return m;
  }
  const prepMany = list => Promise.all((list || []).map(prep));
  async function prepConv(c) {
    if (!c) return c;
    const known = S.convs.get(c.id);
    if (!known) S.convs.set(c.id, c); // ca să găsim membrii la decriptare
    try { await prep(c.last_message); } finally { if (!known) S.convs.delete(c.id); }
    return c;
  }
  async function reprepConv(cid) { // după ce primim o cheie nouă: redecriptăm ce n-a mers
    const st = S.msgs.get(cid);
    if (!st) return;
    const fails = st.list.filter(m => m._e2eFail);
    for (const m of fails) { delete m._dec; metaCache.delete(m.id); await prep(m); if (!m._e2eFail) rerenderRow(m, true); }
  }

  /* ---------------- E2E: deblocare / stare ---------------- */
  const e2eM = $('#e2eModal');
  function syncE2EUI() {
    const s = E2E.state;
    const banner = $('#e2eBanner');
    banner.hidden = !(s === 'locked' || s === 'none');
    if (!banner.hidden) $('#e2eBannerText').textContent = s === 'none' ? 'Activează criptarea end-to-end' : 'Criptarea E2E e blocată pe acest dispozitiv';
    const lbl = { ready: 'Activă pe acest dispozitiv', locked: 'Blocată — introdu parola cheii E2E (cea veche, dacă ai resetat parola contului)', none: 'Neactivată', unsupported: 'Indisponibilă (necesită HTTPS)', loading: '…' }[s] || s;
    const st = $('#setE2EState'); if (st) st.textContent = lbl;
    const fp = $('#setE2EFp'); if (fp) fp.textContent = E2E.fingerprint ? E2E.fingerprint.match(/.{1,4}/g).slice(0, 8).join(' ') : '—';
    const ub = $('#btnE2EUnlock'); if (ub) { ub.hidden = s === 'ready' || s === 'unsupported'; ub.textContent = s === 'none' ? 'Activează' : 'Deblochează'; }
    const rb = $('#btnE2EReset'); if (rb) rb.hidden = s === 'unsupported';
    const sc = $('#setE2EStrict'); if (sc) sc.checked = !!S.settings.e2eStrict;
  }
  function openE2E(reset) {
    e2eM.dataset.reset = reset ? '1' : '';
    $('#e2eTitle').textContent = reset ? 'Resetează cheile E2E' : E2E.state === 'none' ? 'Activează criptarea E2E' : 'Deblochează criptarea E2E';
    $('#e2eText').innerHTML = reset
      ? '⚠️ Se generează o pereche nouă de chei. <b>Mesajele criptate vechi nu vor mai putea fi citite</b> (nici aici, nici pe alte dispozitive), iar contactele vor vedea că cheia ta s-a schimbat.'
      : 'Introdu parola contului. Cheia privată se descifrează <b>doar în browserul tău</b>; serverul o păstrează numai criptată cu parola ta și nu o poate citi.';
    $('#e2ePw').value = ''; $('#e2eErr').textContent = '';
    $('#e2eOk').textContent = reset ? 'Resetează cheile' : 'Deblochează';
    $('#e2eOk').classList.toggle('danger-solid', !!reset);
    openModal(e2eM);
    setTimeout(() => $('#e2ePw').focus(), 60);
  }
  async function submitE2E() {
    const pw = $('#e2ePw').value;
    if (!pw) return;
    const btn = $('#e2eOk'); btn.disabled = true; $('#e2eErr').textContent = '';
    try {
      const r = await E2E.unlock(pw, { reset: e2eM.dataset.reset === '1' });
      closeModal(e2eM);
      toast(r === 'created' ? '🔒 Criptarea E2E a fost activată' : '🔒 Criptarea E2E a fost deblocată');
      onE2EChanged();
    } catch (e) { $('#e2eErr').textContent = e.message; }
    finally { btn.disabled = false; }
  }
  $('#e2eOk').addEventListener('click', submitE2E);
  $('#e2ePw').addEventListener('keydown', e => { if (e.key === 'Enter') submitE2E(); });
  $('#e2eBanner').addEventListener('click', () => openE2E(false));
  function onE2EChanged() {
    syncE2EUI();
    decCache.clear(); metaCache.clear();
    S.e2eConv.clear();
    refreshContactE2E();
    for (const [cid, st] of S.msgs) for (const m of st.list) if (m.meta && m.meta.e2e) { delete m._dec; m._e2eFail = false; }
    loadConversations().catch(() => {});
    if (S.current) { const cid = S.current; S.msgs.delete(cid); S.current = null; openConversation(cid); }
  }

  /* ---------------- grupuri ---------------- */
  const grpM = $('#groupModal');
  function contactPickHtml(exclude) {
    const list = [...S.contacts.values()].filter(u => !exclude.has(u.id)).sort((a, b) => String(a.display_name).localeCompare(b.display_name, 'ro'));
    if (!list.length) return '<div class="empty muted">Nu ai contacte disponibile. Adaugă întâi contacte cu butonul „Adaugă”.</div>';
    return list.map(u => `<label class="pick-row" data-name="${esc((u.display_name + ' ' + u.username).toLowerCase())}"><input type="checkbox" value="${u.id}">${avatar(u, 'sm', isOnline(u.id))}<span class="conv-body"><span class="conv-name">${verifiedName(u)}</span><span class="muted small">@${esc(u.username)}</span></span></label>`).join('');
  }
  function openGroupModal(addTo) {
    grpM.dataset.add = addTo || '';
    const c = addTo ? convOf(addTo) : null;
    $('#grpHead').textContent = c ? 'Adaugă membri în „' + convTitle(c) + '”' : 'Grup nou';
    $('#grpTitleRow').hidden = !!c;
    $('#grpTitle').value = '';
    $('#grpFilter').value = '';
    $('#grpList').innerHTML = contactPickHtml(new Set(c ? c.members.map(m => m.id) : []));
    $('#grpCreate').textContent = c ? 'Adaugă' : 'Creează grupul';
    updGrp();
    openModal(grpM);
  }
  function updGrp() {
    const n = $$('#grpList input:checked').length;
    const add = !!grpM.dataset.add;
    $('#grpCount').textContent = add ? roCount(n, 'contact selectat', 'contacte selectate') : roCount(n, 'contact selectat', 'contacte selectate') + ' · minim 2';
    $('#grpCreate').disabled = add ? n < 1 : n < 2;
  }
  $('#grpList').addEventListener('change', updGrp);
  $('#grpFilter').addEventListener('input', e => { const q = e.target.value.trim().toLowerCase(); $$('#grpList .pick-row').forEach(r => { r.hidden = q && !r.dataset.name.includes(q); }); });
  $('#grpCreate').addEventListener('click', async () => {
    const ids = $$('#grpList input:checked').map(i => +i.value);
    const btn = $('#grpCreate'); btn.disabled = true;
    try {
      if (grpM.dataset.add) {
        const cid = +grpM.dataset.add;
        const j = await api('api/conversations.php?action=add_members', { body: { conversation_id: cid, user_ids: ids } });
        ingestConv(j.conversation); E2E.invalidateGroup(cid);
        closeModal(grpM); renderConvList(); if (S.current === cid) { renderHeader(); refreshE2E(cid); }
        if (!$('#groupInfo').hidden) openGroupInfo(cid);
        toast('Membri adăugați');
      } else {
        const j = await api('api/conversations.php?action=create_group', { body: { user_ids: ids, title: $('#grpTitle').value.trim() } });
        await prepConv(j.conversation);
        ingestConv(j.conversation);
        closeModal(grpM); renderConvList(); openConversation(j.conversation.id);
      }
    } catch (e) { toast(e.message, true); }
    finally { updGrp(); }
  });
  $('#btnGroup').addEventListener('click', () => openGroupModal(null));
  ['#groupModal', '#groupInfo', '#safetyModal', '#e2eModal'].forEach(sel => $(sel).addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) closeModal($(sel)); }));
  $('#btnMore').addEventListener('click', e => {
    e.stopPropagation(); e.preventDefault();
    if (!convMenu.hidden) { closePopover(convMenu); return; }
    if (!S.current) return;
    const cid = S.current, btn = e.currentTarget;
    // după click-ul curent: altfel listenerul `document` închide meniul în aceeași tură
    setTimeout(() => { if (S.current === cid) openConvMenu(cid, btn); }, 0);
  });

  const giM = $('#groupInfo');
  function openGroupInfo(cid) {
    const c = convOf(cid);
    if (!c || !c.is_group) return;
    giM.dataset.cid = cid;
    const creator = c.created_by === S.me.id;
    $('#giAvatar').innerHTML = groupAvatar(c, 'xl');
    $('#giTitle').value = c.title || '';
    $('#giTitle').placeholder = convTitle(c);
    $('#giCount').textContent = roCount(c.members.length, 'membru', 'membri');
    $('#giMembers').innerHTML = c.members.slice().sort((a, b) => (b.id === c.created_by) - (a.id === c.created_by)).map(m => `<div class="pick-row">${avatar(m, 'sm', m.id === S.me.id || isOnline(m.id))}<span class="conv-body"><span class="conv-name" data-identity-user="${m.id}" data-self-label="${m.id === S.me.id ? 1 : 0}">${verifiedName(m,m.id === S.me.id ? m.display_name + ' (tu)' : displayName(m))}</span><span class="muted small">@${esc(m.username)}${m.id === c.created_by ? ' · creatorul grupului' : ''}</span></span>${m.id !== S.me.id && !S.contacts.has(m.id) ? `<button class="btn ghost small" data-gi-addc="${m.id}">Contact</button>` : ''}</div>`).join('');
    $('#giDestroy').hidden = !creator;
    openModal(giM);
  }
  giM.addEventListener('click', async e => {
    const cid = +giM.dataset.cid;
    const t = e.target;
    if (t.closest('#giRename')) {
      try { const j = await api('api/conversations.php?action=rename_group', { body: { conversation_id: cid, title: $('#giTitle').value.trim() } }); ingestConv(j.conversation); renderConvList(); renderHeader(); toast('Grup redenumit'); }
      catch (err) { toast(err.message, true); }
    } else if (t.closest('#giAdd')) openGroupModal(cid);
    else if (t.closest('#giSafety')) showSafety(cid);
    else if (t.closest('#giLeave')) { closeModal(giM); convAction('leave', cid); }
    else if (t.closest('#giDestroy')) { closeModal(giM); convAction('destroy', cid); }
    else if (t.closest('[data-gi-addc]')) {
      const uid = +t.closest('[data-gi-addc]').dataset.giAddc;
      try { const j = await api('api/contacts.php?action=add', { body: { user_id: uid } }); S.contacts.set(uid, j.contact); openGroupInfo(cid); toast('Contact adăugat'); } catch (err) { toast(err.message, true); }
    }
  });
  $('#giTitle').addEventListener('keydown', e => { if (e.key === 'Enter') $('#giRename').click(); });

  /* ---------------- cod de siguranță ---------------- */
  async function showSafety(cid) {
    const c = convOf(cid);
    if (!c) return;
    const m = $('#safetyModal');
    $('#sfCode').textContent = 'se calculează…';
    $('#sfText').innerHTML = c.is_group
      ? 'Toți membrii grupului trebuie să vadă <b>același cod</b>. Comparați-l pe un alt canal (față în față, telefon). Dacă diferă, cineva are o cheie falsă.'
      : `Compară acest cod cu <b>${esc(peerOf(cid).display_name)}</b> (față în față sau la telefon). Dacă e identic la amândoi, nimeni — nici serverul — nu se poate interpune între voi.`;
    openModal(m);
    try {
      if (E2E.state !== 'ready') throw new Error('Criptarea E2E nu e activă pe acest dispozitiv');
      const code = await E2E.safetyCode(c);
      $('#sfCode').textContent = code || 'Indisponibil: nu toți membrii au activat E2E';
    } catch (e) { $('#sfCode').textContent = e.message; }
  }

  /* ---------------- alerte de prezență (ca la Yahoo! Messenger) ---------------- */
  let presPrev = null, presenceFeedHealthy = false;
  const presWatch = () => new Set((Array.isArray(S.settings.presenceUsers) ? S.settings.presenceUsers : []).map(Number).filter(id => id && id !== S.me.id));
  function presenceCheck() {
    const now = new Set([...presWatch()].filter(id => isOnline(id)));
    if (!presenceFeedHealthy) { presPrev=null; return; }
    if (presPrev && S.settings.presence === true) {
      for (const id of now) if (!presPrev.has(id)) presenceToast(id, true);
      for (const id of presPrev) if (!now.has(id) && presWatch().has(id)) presenceToast(id, false);
    }
    presPrev = now;
  }
  const presQueue = [];
  function presenceToast(uid, on) {
    const u = S.users.get(uid);
    if (!u || S.restrictedContacts.has(+uid) || S.settings.presence !== true || !presWatch().has(+uid)) return;
    const key = 'tex.presence-toast.' + S.me.id + '.' + uid;
    const nonce = uid + '-' + Date.now() + '-' + Math.random();
    try {
      const previous = JSON.parse(localStorage.getItem(key) || 'null');
      if (previous && previous.on === on && Date.now() - previous.at < 60000) return;
      localStorage.setItem(key, JSON.stringify({ on, at: Date.now(), nonce }));
    } catch (_) {}
    setTimeout(() => {
    if (!presenceFeedHealthy || S.restrictedContacts.has(+uid) || S.settings.presence !== true || !presWatch().has(+uid) || isOnline(uid) !== on) return;
    try { if (JSON.parse(localStorage.getItem(key) || 'null')?.nonce !== nonce) return; } catch (_) {}
    const box = $('#presenceToasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'ym-toast ' + (on ? 'on' : 'off');
    el.innerHTML = `<div class="ym-t-head"><span>${esc(A.appName || 'Tex')}</span><button class="ym-t-x" aria-label="Închide">×</button></div><div class="ym-t-body">${avatar(u, '', on)}<div><b>${esc(displayName(u))}</b><div>${on ? 's-a conectat' : (u.status === 'offline' ? 's-a deconectat' : 's-a deconectat')}</div>${on && statusLine(u) ? `<div class="muted small">${rich(statusLine(u))}</div>` : ''}</div></div>`;
    el.addEventListener('click', ev => {
      if (ev.target.closest('.ym-t-x')) { el.remove(); return; }
      const c = [...S.convs.values()].find(x => !x.is_group && peerOf(x.id).id === uid);
      if (c) openConversation(c.id); else openWithUser(uid).catch(() => {});
      el.remove();
    });
    box.appendChild(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6000);
    if (S.settings.presenceSound !== false) playSnd(on ? 'conectare' : 'deconectare');
    }, 80);
  }

  window.addEventListener('storage', e => {
    if (e.key !== 'msgr.settings.' + S.me.id || !e.newValue) return;
    try { const x=JSON.parse(e.newValue); S.settings.presence=x.presence===true; S.settings.presenceUsers=Array.isArray(x.presenceUsers)?x.presenceUsers:[]; S.settings.presenceSound=x.presenceSound===true; presPrev=null; if (!S.settings.presence) $('#presenceToasts').replaceChildren(); } catch (_) {}
  });
  /* ---------------- teme cu fundal ---------------- */
  // 20 de teme de conversație, fiecare cu cerneală, hârtie și ritm propriu.
  // Modelele sunt desenate în CSS; nu încarcă imagini și nu afectează mesajele stocate.
  const studioTheme = (id, name, mode, base, accent, incoming, texture = '') => ({
    id: 'studio-' + id, name, mode, palette: 'mono', studio: true,
    bg: texture ? texture + ',' + base : base,
    preview: texture ? texture + ',' + base : base,
    colors: { sent: accent, sentText: '#ffffff', recv: incoming,
      recvText: mode === 'dark' ? '#f2f0eb' : '#25292b', bg: base,
      text: mode === 'dark' ? '#f2f0eb' : '#25292b', grad: null },
    chrome: { panel: shade(base, mode === 'dark' ? .035 : .38),
      input: shade(base, mode === 'dark' ? .09 : -.045),
      muted: mode === 'dark' ? '#b3b8b6' : '#626966',
      line: mode === 'dark' ? 'rgba(245,244,239,.11)' : 'rgba(35,42,43,.11)' }
  });
  // Colecția „Scene vii”: 20 de teme animate (paleta aici, mișcarea în assets/css/fx-themes.css).
  // Particulele se creează o singură dată în syncFxScene; la telefon se afișează mai puține.
  const fxTheme = (id, name, mode, c) => {
    const ink = mode === 'dark' ? '#f2f0eb' : '#25292b';
    return {
      id: 'fx-' + id, name, mode, palette: 'mono', studio: true, fx: true,
      bg: c.bg, preview: c.preview || c.bg,
      colors: { sent: c.sent, sentText: '#ffffff', recv: c.recv, recvText: ink, bg: c.base, text: ink, grad: null },
      chrome: { panel: c.panel, input: c.input, muted: c.muted,
        line: mode === 'dark' ? 'rgba(245,244,239,.11)' : 'rgba(35,42,43,.11)' }
    };
  };
  const WALLS = [
    { id: 'liquidGlass', name: 'Liquid Glass', mode: 'light', palette: 'imessage', accent: '#527a9d', bg: 'linear-gradient(145deg,#d9e4f2,#f1eff8)', preview: 'radial-gradient(circle at 22% 28%,rgba(96,150,255,.8),transparent 46%),radial-gradient(circle at 80% 22%,rgba(255,150,205,.7),transparent 44%),radial-gradient(circle at 70% 85%,rgba(90,215,190,.75),transparent 48%),linear-gradient(145deg,#d9e4f2,#f1eff8)' },
    { id: 'liquidGlassDark', name: 'Liquid Glass (întunecat)', mode: 'dark', palette: 'imessage', accent: '#ffffff', bg: 'linear-gradient(145deg,#050506,#16161b)', preview: 'radial-gradient(circle at 22% 28%,rgba(255,255,255,.7),transparent 46%),radial-gradient(circle at 80% 22%,rgba(255,255,255,.35),transparent 44%),radial-gradient(circle at 70% 85%,rgba(200,200,210,.5),transparent 48%),linear-gradient(145deg,#050506,#16161b)' },
    { id: 'albastruNeon', accent: '#39c5ff', name: 'Albastru neon', mode: 'dark', palette: 'vorbitozaur', bg: 'radial-gradient(ellipse at 10% 0%,rgba(0,166,255,.08),transparent 65%),var(--chat-bg)', preview: 'radial-gradient(ellipse at 10% 0%,rgba(0,166,255,.08),transparent 65%),#03080e' },
    { id: 'noapte', name: 'Noapte albastră', mode: 'dark', palette: 'vorbitozaur', bg: 'radial-gradient(1200px 600px at 80% -10%,rgba(26,115,255,.28),transparent 60%),radial-gradient(900px 500px at -10% 110%,rgba(60,180,255,.18),transparent 60%),#04070d' },
    { id: 'aurora', name: 'Aurora', mode: 'dark', palette: 'forest', bg: 'radial-gradient(900px 420px at 20% 0%,rgba(46,230,160,.30),transparent 65%),radial-gradient(800px 420px at 85% 15%,rgba(140,80,255,.28),transparent 60%),linear-gradient(180deg,#041016,#060a18)' },
    { id: 'apus', name: 'Apus', mode: 'dark', palette: 'sunset', bg: 'linear-gradient(180deg,#2b0f2e 0%,#5a1a2c 45%,#b2452b 85%,#f29a3a 100%)' },
    { id: 'ocean', name: 'Ocean adânc', mode: 'dark', palette: 'ocean', bg: 'radial-gradient(1000px 500px at 50% -20%,rgba(72,202,228,.30),transparent 60%),linear-gradient(180deg,#03263a,#010d17)' },
    { id: 'padure', name: 'Pădure', mode: 'dark', palette: 'forest', bg: 'radial-gradient(800px 400px at 0% 0%,rgba(123,211,137,.18),transparent 60%),linear-gradient(160deg,#0b1f14,#050d08)' },
    { id: 'neon', name: 'Neon', mode: 'dark', palette: 'gradient', bg: 'linear-gradient(rgba(255,0,170,.07) 1px,transparent 1px) 0 0/32px 32px,linear-gradient(90deg,rgba(0,200,255,.07) 1px,transparent 1px) 0 0/32px 32px,radial-gradient(900px 500px at 50% 120%,rgba(255,0,170,.30),transparent 60%),#07021a' },
    { id: 'toxicpulse', accent: '#ff4eae', name: 'ToxicPulse & Teccno (synthwave)', mode: 'dark', palette: 'sunset', bg: 'radial-gradient(900px 520px at 12% -5%,rgba(255,45,149,.25),transparent 58%),radial-gradient(820px 480px at 92% 18%,rgba(0,229,255,.15),transparent 55%),radial-gradient(760px 440px at 50% 110%,rgba(124,77,255,.32),transparent 60%),linear-gradient(180deg,#090b2b 0%,#1a0b3c 38%,#09071d 100%)' },
    { id: 'lavanda', name: 'Lavandă (luminos)', mode: 'light', palette: 'lavender', bg: 'radial-gradient(800px 400px at 100% 0%,rgba(192,132,252,.30),transparent 60%),radial-gradient(700px 400px at 0% 100%,rgba(124,58,237,.16),transparent 60%),#faf7ff' },
    { id: 'retro', name: 'Yahoo! Retro', mode: 'light', palette: 'yahoo', bg: 'repeating-linear-gradient(45deg,rgba(123,0,153,.05) 0 12px,transparent 12px 24px),linear-gradient(180deg,#fdfbff,#efe6f7)' },
    { id: 'ym', name: 'Yahoo! Messenger (listă clasică)', mode: 'light', palette: 'yahoo', bg: 'linear-gradient(180deg,#ffffff,#f2eef6)', special: true },
    { id: 'ym-dark', name: 'Yahoo! Messenger (negru)', mode: 'dark', palette: 'yahoo', bg: 'linear-gradient(180deg,#1a0a24,#0a0510)', special: true },
    { id: 'ym-dark-blue', name: 'Yahoo! Messenger (negru, albastru)', mode: 'dark', palette: 'imessage', bg: 'linear-gradient(180deg,#0a1630,#04080f)', special: true },
    { id: 'ym-dark-gray', name: 'Yahoo! Messenger (negru, gri)', mode: 'dark', palette: 'mono', bg: 'linear-gradient(180deg,#1c1d20,#0a0a0b)', special: true },
    { id: 'ym-dark-green', name: 'Yahoo! Messenger (negru, verde)', mode: 'dark', palette: 'forest', bg: 'linear-gradient(180deg,#0a2414,#040d07)', special: true },
    { id: 'ym-dark-teal', name: 'Yahoo! Messenger (negru, turcoaz)', mode: 'dark', palette: 'ocean', bg: 'linear-gradient(180deg,#06242a,#030c0f)', special: true },
    { id: 'ym-dark-red', name: 'Yahoo! Messenger (negru, roșu)', mode: 'dark', palette: 'sunset', bg: 'linear-gradient(180deg,#2a0a10,#0f0406)', special: true },
    studioTheme('hartie', 'Hârtie liniată', 'light', '#f7f4ec', '#365f56', '#ebe8df', 'repeating-linear-gradient(0deg,transparent 0 31px,rgba(48,64,60,.07) 31px 32px)'),
    studioTheme('cerneala', 'Cerneală', 'dark', '#171c20', '#36627c', '#2a3034'),
    studioTheme('lut', 'Lut ars', 'light', '#f7f1ec', '#79513e', '#eee3dc', 'repeating-linear-gradient(90deg,transparent 0 47px,rgba(93,70,58,.035) 47px 48px)'),
    studioTheme('salvie', 'Salvie', 'light', '#f2f5ef', '#45624d', '#e5ebdf', 'repeating-linear-gradient(145deg,transparent 0 31px,rgba(49,72,55,.035) 31px 32px)'),
    studioTheme('cobalt', 'Cobalt', 'dark', '#19212a', '#265589', '#2a333c', 'linear-gradient(rgba(236,242,247,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(236,242,247,.035) 1px,transparent 1px)'),
    studioTheme('miere', 'Miere', 'light', '#faf5e9', '#775522', '#efe8d7', 'radial-gradient(rgba(96,76,39,.13) 1px,transparent 1px)'),
    studioTheme('prune', 'Prune', 'dark', '#211e24', '#654367', '#312b34'),
    studioTheme('ardezie', 'Ardezie', 'dark', '#1c2326', '#52616e', '#2d3538', 'repeating-linear-gradient(0deg,transparent 0 39px,rgba(235,240,241,.035) 39px 40px)'),
    studioTheme('menta', 'Mentă', 'light', '#f1f7f3', '#2d6a56', '#e1ede6', 'radial-gradient(rgba(49,86,69,.12) 1px,transparent 1px)'),
    studioTheme('espresso', 'Espresso', 'dark', '#211e1b', '#64472f', '#322c27', 'repeating-linear-gradient(145deg,transparent 0 63px,rgba(241,235,224,.04) 63px 64px)'),
    studioTheme('atelier', 'Atelier', 'light', '#f8f6f1', '#724d59', '#eee9e4', 'repeating-linear-gradient(0deg,transparent 0 23px,rgba(84,64,69,.055) 23px 24px)'),
    studioTheme('harta', 'Hartă', 'light', '#f4f3ec', '#445e59', '#e9e9de', 'linear-gradient(rgba(74,83,72,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(74,83,72,.045) 1px,transparent 1px)'),
    studioTheme('zen', 'Zen', 'light', '#f6f6f1', '#485d52', '#eaece5'),
    studioTheme('ramura', 'Ramură', 'dark', '#19211d', '#456654', '#2a342d', 'repeating-linear-gradient(145deg,transparent 0 55px,rgba(229,238,227,.04) 55px 56px)'),
    studioTheme('caramida', 'Cărămidă', 'light', '#f8f2ed', '#8b4b3b', '#eee2da', 'radial-gradient(rgba(123,80,67,.12) 1px,transparent 1px)'),
    studioTheme('ploaie', 'Ploaie', 'dark', '#192127', '#456a7a', '#29343a'),
    studioTheme('luna', 'Lună', 'dark', '#191b26', '#595376', '#2b2d3a', 'radial-gradient(rgba(236,234,246,.3) 1px,transparent 1px)'),
    studioTheme('cupru', 'Cupru', 'dark', '#25201d', '#875438', '#342c27', 'repeating-linear-gradient(90deg,transparent 0 71px,rgba(243,225,204,.045) 71px 72px)'),
    studioTheme('tihna', 'Tihnă', 'light', '#f2f5f5', '#376073', '#e5ebeb'),
    studioTheme('fir', 'Fir de lumină', 'dark', '#1a2021', '#4b645d', '#293133', 'repeating-linear-gradient(0deg,transparent 0 63px,rgba(235,242,239,.045) 63px 64px)'),
    fxTheme('nordice', 'Lumini nordice', 'dark', { base: '#0a151d', panel: '#0f1c26', input: '#172a37', sent: '#17806f', recv: '#1a2c3a', muted: '#9db3bd',
      bg: 'linear-gradient(180deg,#07111a 0%,#0a1a24 60%,#0c1f27 100%)',
      preview: 'linear-gradient(110deg,#07111a 14%,#1f8f78 50%,#4666c9 84%)' }),
    fxTheme('ninsoare', 'Ninsoare', 'dark', { base: '#0f1a26', panel: '#142130', input: '#1d2d3f', sent: '#3a6ea5', recv: '#1f2e41', muted: '#a3b4c6',
      bg: 'linear-gradient(180deg,#0b1521,#142335 70%,#1a2d42)',
      preview: 'radial-gradient(#fff 1.5px,transparent 2px) 5px 7px/20px 20px,linear-gradient(180deg,#0b1521,#1a2d42)' }),
    fxTheme('licurici', 'Licurici', 'dark', { base: '#0a140e', panel: '#0f1b13', input: '#172a1d', sent: '#3e7a3a', recv: '#1a2b1f', muted: '#a5b9a8',
      bg: 'linear-gradient(180deg,#070f0a,#0b1a10)',
      preview: 'radial-gradient(circle at 25% 60%,#e4ff9a 0 2px,rgba(210,255,110,.35) 3px,transparent 9px),radial-gradient(circle at 72% 35%,#e4ff9a 0 2px,rgba(210,255,110,.35) 3px,transparent 9px),linear-gradient(180deg,#070f0a,#0b1a10)' }),
    fxTheme('lava', 'Lavă', 'dark', { base: '#170d0b', panel: '#1f1210', input: '#2d1a16', sent: '#b4472b', recv: '#2e1c18', muted: '#c4aaa3',
      bg: 'linear-gradient(180deg,#130a09,#1f100c)',
      preview: 'radial-gradient(circle at 28% 70%,#ff8f4a 0,transparent 32%),radial-gradient(circle at 72% 30%,#d9421f 0,transparent 34%),#170d0b' }),
    fxTheme('meteori', 'Meteori', 'dark', { base: '#0a0d20', panel: '#10142b', input: '#1a1f3b', sent: '#5648c4', recv: '#1c2142', muted: '#a4a9c9',
      bg: 'linear-gradient(180deg,#070a1a,#0e1330 70%,#151a3d)',
      preview: 'linear-gradient(125deg,transparent 45%,#dfe8ff 49%,transparent 53%),linear-gradient(180deg,#070a1a,#151a3d)' }),
    fxTheme('valuri', 'Valuri', 'light', { base: '#edf6f8', panel: '#f7fbfc', input: '#e0eef2', sent: '#1f6f8b', recv: '#dfeef3', muted: '#52666e',
      bg: 'linear-gradient(180deg,#f2f9fb,#e3f0f4)',
      preview: 'radial-gradient(circle at 50% 100%,transparent 0 5px,rgba(31,111,139,.4) 5px 6px,transparent 6px 11px,rgba(31,111,139,.4) 11px 12px,transparent 12px) 0 0/26px 13px,#e3f0f4' }),
    fxTheme('rasarit', 'Răsărit', 'light', { base: '#fdf1e6', panel: '#fff8f1', input: '#f6e6d6', sent: '#b4532a', recv: '#f7e4d3', muted: '#75604f',
      bg: 'linear-gradient(180deg,#fde4cf 0%,#fdf0e4 55%,#fff7ef 100%)',
      preview: 'radial-gradient(circle at 60% 105%,#ffb677 0,#ffd7ae 30%,transparent 62%),linear-gradient(180deg,#fde4cf,#fff7ef)' }),
    fxTheme('cod', 'Cod verde', 'dark', { base: '#050e09', panel: '#0a1710', input: '#112519', sent: '#1b7a45', recv: '#12261a', muted: '#8fb59d',
      bg: 'linear-gradient(180deg,#040b07,#08140d)',
      preview: 'repeating-linear-gradient(90deg,transparent 0 7px,rgba(70,255,150,.4) 7px 8px),#06100a' }),
    fxTheme('sakura', 'Sakura', 'light', { base: '#fdf3f5', panel: '#fff9fa', input: '#f7e5e9', sent: '#b04a6a', recv: '#f6e3e8', muted: '#7a5a64',
      bg: 'radial-gradient(ellipse at 0% 0%,#fbdde5,transparent 55%),linear-gradient(180deg,#fdf3f5,#fbeef1)',
      preview: 'radial-gradient(circle at 80% 24%,#f3a2b6 0 6px,transparent 7px),radial-gradient(circle at 62% 38%,#f8c3d0 0 5px,transparent 6px),radial-gradient(circle at 90% 50%,#f8c3d0 0 4px,transparent 5px),linear-gradient(180deg,#fdf3f5,#fbeef1)' }),
    fxTheme('dune', 'Dune', 'light', { base: '#f7edda', panel: '#fcf6ea', input: '#efe2c8', sent: '#8f5f20', recv: '#f0e2c6', muted: '#76654a',
      bg: 'linear-gradient(180deg,#f9efdc,#f2e3c8)',
      preview: 'repeating-radial-gradient(circle at 20% 145%,transparent 0 9px,rgba(150,105,40,.28) 9px 10px),#f6ead3' }),
    fxTheme('ceata', 'Ceață', 'light', { base: '#e8edef', panel: '#f3f6f7', input: '#dbe3e6', sent: '#4f6b78', recv: '#dde5e8', muted: '#556369',
      bg: 'linear-gradient(180deg,#eef2f4,#e1e8eb)',
      preview: 'radial-gradient(ellipse 60% 40% at 30% 45%,#fff,transparent),radial-gradient(ellipse 50% 40% at 75% 62%,#fff,transparent),#d7e0e4' }),
    fxTheme('prisma', 'Prismă', 'dark', { base: '#101018', panel: '#161620', input: '#20202e', sent: '#6b4fd0', recv: '#22222f', muted: '#a9a9c0',
      bg: 'linear-gradient(180deg,#0e0e15,#14141d)',
      preview: 'linear-gradient(rgba(16,16,24,.6),rgba(16,16,24,.6)),conic-gradient(from 20deg,#ff6aa8,#ffb86a,#f6ff6a,#6affb3,#6ac8ff,#a96aff,#ff6aa8)' }),
    fxTheme('constelatii', 'Constelații', 'dark', { base: '#0a0f22', panel: '#10162d', input: '#192040', sent: '#3f5fbf', recv: '#1b2445', muted: '#a2abc9',
      bg: 'linear-gradient(180deg,#080c1c,#0f1631)',
      preview: 'radial-gradient(#fff 1px,transparent 1.6px) 6px 8px/19px 17px,radial-gradient(rgba(190,205,255,.9) 1px,transparent 1.6px) 14px 3px/31px 27px,linear-gradient(180deg,#080c1c,#0f1631)' }),
    fxTheme('foc', 'Foc de tabără', 'dark', { base: '#130d08', panel: '#1b120c', input: '#2a1c13', sent: '#b3541e', recv: '#2b1d14', muted: '#c1ab9a',
      bg: 'linear-gradient(180deg,#0e0906,#170e08)',
      preview: 'radial-gradient(ellipse 60% 55% at 50% 112%,#ff8c32,transparent 70%),#130d08' }),
    fxTheme('bule', 'Bule', 'light', { base: '#e8f7f7', panel: '#f4fcfc', input: '#d9eeee', sent: '#1b7d84', recv: '#d6ecec', muted: '#4f686a',
      bg: 'linear-gradient(180deg,#f1fbfb,#dff3f3)',
      preview: 'radial-gradient(circle at 30% 60%,transparent 0 6px,rgba(27,125,132,.45) 6px 7px,transparent 7px),radial-gradient(circle at 68% 34%,transparent 0 9px,rgba(27,125,132,.45) 9px 10px,transparent 10px),#e4f5f5' }),
    fxTheme('nori', 'Nori', 'light', { base: '#e4f0fb', panel: '#f2f8fd', input: '#d6e6f5', sent: '#2d6db3', recv: '#d5e5f5', muted: '#556779',
      bg: 'linear-gradient(180deg,#cde3f6 0%,#e6f1fb 70%,#f1f7fd)',
      preview: 'radial-gradient(ellipse 22px 9px at 30% 40%,#fff 97%,transparent),radial-gradient(ellipse 30px 11px at 38% 38%,#fff 97%,transparent),radial-gradient(ellipse 24px 9px at 68% 66%,#fff 97%,transparent),linear-gradient(180deg,#cde3f6,#eaf3fb)' }),
    fxTheme('circuit', 'Circuit', 'dark', { base: '#061517', panel: '#0a1d20', input: '#11292d', sent: '#15808a', recv: '#12292d', muted: '#8db5b8',
      bg: 'linear-gradient(rgba(70,230,230,.06) 1px,transparent 1px) 0 0/40px 40px,linear-gradient(90deg,rgba(70,230,230,.06) 1px,transparent 1px) 0 0/40px 40px,linear-gradient(180deg,#051214,#081a1d)',
      preview: 'linear-gradient(rgba(70,230,230,.25) 1px,transparent 1px) 0 0/14px 14px,linear-gradient(90deg,rgba(70,230,230,.25) 1px,transparent 1px) 0 0/14px 14px,#061517' }),
    fxTheme('toamna', 'Toamnă', 'light', { base: '#faefe0', panel: '#fff7ec', input: '#f1e1cb', sent: '#a6481f', recv: '#f0dfc6', muted: '#785f4a',
      bg: 'linear-gradient(180deg,#fbf0e1,#f6e6d0)',
      preview: 'radial-gradient(ellipse 6px 4px at 28% 38%,#c5681f 97%,transparent),radial-gradient(ellipse 6px 4px at 60% 62%,#b5471f 97%,transparent),radial-gradient(ellipse 5px 3px at 78% 30%,#d49a2a 97%,transparent),linear-gradient(180deg,#fbf0e1,#f6e6d0)' }),
    fxTheme('lanterne', 'Lanterne', 'dark', { base: '#0d0f24', panel: '#12152e', input: '#1b1f3d', sent: '#b05a1e', recv: '#1d2145', muted: '#a6a9c8',
      bg: 'radial-gradient(circle at 85% 12%,rgba(255,220,160,.2) 0,transparent 22%),linear-gradient(180deg,#090b1d,#13163a 80%,#1c1f47)',
      preview: 'radial-gradient(circle at 30% 68%,#ffb347 0 5px,rgba(255,150,50,.35) 6px,transparent 12px),radial-gradient(circle at 70% 38%,#ffb347 0 4px,rgba(255,150,50,.35) 5px,transparent 10px),linear-gradient(180deg,#090b1d,#1c1f47)' }),
    fxTheme('furtuna', 'Furtună', 'dark', { base: '#0d1117', panel: '#131920', input: '#1d2530', sent: '#44607d', recv: '#1f2832', muted: '#9fadbb',
      bg: 'linear-gradient(180deg,#090d12,#121a22)',
      preview: 'repeating-linear-gradient(105deg,transparent 0 6px,rgba(200,220,240,.35) 6px 7px),linear-gradient(180deg,#090d12,#1a2430)' }),
  ];
  // Particulele (fulgi, licurici, frunze…) sunt simple <i>; CSS-ul temei alege forma și mișcarea.
  function syncFxScene(on) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    let sc = chat.querySelector(':scope > .fx-scene');
    if (!on) { if (sc) sc.remove(); return; }
    if (sc) return;
    sc = document.createElement('div');
    sc.className = 'fx-scene';
    sc.setAttribute('aria-hidden', 'true');
    let seed = 20261108;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const glyphs = 'アイウエオカキクケコサシスセソタチツテト0123456789';
    for (let n = 0; n < 28; n++) {
      const i = document.createElement('i');
      let g = ''; for (let k = 0; k < 14; k++) g += glyphs[Math.floor(rnd() * glyphs.length)];
      i.dataset.g = g;
      i.style.cssText = `--x:${(rnd() * 100).toFixed(1)}%;--y:${(rnd() * 100).toFixed(1)}%;--gy:${Math.floor(rnd() * 40) * 40}px;` +
        `--s:${(.6 + rnd()).toFixed(2)};--t:${(10 + rnd() * 16).toFixed(1)};--d:${(-rnd()).toFixed(3)};` +
        `--sw:${Math.round(-70 + rnd() * 140)}px;--rot:${Math.round(180 + rnd() * 540)}deg;--o:${(.45 + rnd() * .55).toFixed(2)}`;
      sc.appendChild(i);
    }
    chat.prepend(sc);
  }
  function applyWall() {
    const root = document.documentElement;
    const w = WALLS.find(x => x.id === S.settings.wall);
    root.classList.toggle('has-wall', !!w);
    const ymDark = !!w && w.id.startsWith('ym-dark');
    const ym = !!w && (w.id === 'ym' || ymDark);
    root.classList.toggle('theme-ym', ym);
    root.classList.toggle('theme-ym-dark', ymDark);
    if (w) { root.dataset.wall = w.id; root.style.setProperty('--chat-wall', w.bg); if (w.accent) root.style.setProperty('--reaction-accent', w.accent); }
    else { delete root.dataset.wall; root.style.removeProperty('--chat-wall'); }
    const studioVars = ['--app-bg','--panel','--input-bg','--line','--hover','--active','--muted','--shadow'];
    studioVars.forEach(key => root.style.removeProperty(key));
    if (w?.studio) {
      const dark = w.mode === 'dark';
      const values = [w.colors.bg,w.chrome.panel,w.chrome.input,w.chrome.line,
        dark ? 'rgba(245,244,239,.06)' : 'rgba(35,42,43,.05)',
        dark ? 'rgba(245,244,239,.10)' : 'rgba(35,42,43,.08)',w.chrome.muted,
        dark ? '0 12px 30px rgba(0,0,0,.22)' : '0 12px 30px rgba(30,38,35,.09)'];
      studioVars.forEach((key,i) => root.style.setProperty(key,values[i]));
    }
    if (w) root.classList.remove('pal-vz');
    syncFxScene(!!(w && w.fx));
    const logo = document.querySelector('.sb-logo');
    if (logo) {
      const v = (window.APP && APP.v) || '';
      const want = 'assets/img/logo-black.png?v=' + encodeURIComponent(v);
      if (logo.getAttribute('src') !== want) logo.setAttribute('src', want);
      logo.alt = 'Tex';
    }
  }
  function renderWalls() {
    const box = $('#walls');
    if (!box) return;
    const card = w => `<button type="button" class="wall${S.settings.wall === w.id ? ' on' : ''}${w.special ? ' special' : ''}" data-wall="${w.id}" aria-pressed="${S.settings.wall === w.id}"><span class="wsw" style="background:${w.preview || w.bg};--sw-a:${w.fx ? w.colors.sent : ''}"></span>${esc(w.name)}</button>`;
    box.innerHTML = `<button type="button" class="wall${!S.settings.wall ? ' on' : ''}" data-wall="" aria-pressed="${!S.settings.wall}"><span class="wsw" style="background:var(--chat-bg)"></span>Fără fundal</button>` +
      WALLS.filter(w => !w.studio).map(card).join('') +
      '<div class="wall-collection-heading">Colecția Tex · 20 de teme calme</div>' +
      WALLS.filter(w => w.studio && !w.fx).map(card).join('') +
      '<div class="wall-collection-heading">Scene vii · 20 de teme animate</div>' +
      WALLS.filter(w => w.fx).map(card).join('');
  }
  $('#walls') && $('#walls').addEventListener('click', e => {
    const b = e.target.closest('[data-wall]');
    if (!b) return;
    const w = WALLS.find(x => x.id === b.dataset.wall);
    S.settings.wall = w ? w.id : null;
    if (w) { S.settings.mode = w.mode; S.settings.palette = w.palette; S.settings.gradient = !w.studio; }
    applyTheme(true); renderPalettes(); renderWalls(); saveSettings();
  });


  /* =====================================================================
     v2.0 — CĂUTARE ÎN CONVERSAȚIE (în browser, merge și pe mesajele criptate E2E)
     Serverul nu poate căuta în mesajele criptate, deci căutăm local, în textul deja decriptat.
     „Caută în tot istoricul” încarcă (și decriptează) mesajele mai vechi, în pagini de 100.
     ===================================================================== */
  const FIND = { q: '', hits: [], i: -1, deep: false, busy: false };
  const fold = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function searchableText(m) {
    if (!m || m.deleted || m.type === 'system' || m._e2eFail) return '';
    const parts = [];
    if (m.body && m.type !== 'buzz') parts.push(m.body);
    if (m.attachment && m.attachment.name) parts.push(m.attachment.name);
    if (m.type === 'p2p' && m.meta && Array.isArray(m.meta.files)) m.meta.files.forEach(f => parts.push(f.name));
    return parts.join(' \n ');
  }
  function openFind() {
    if (!S.current) return;
    const bar = $('#findBar');
    bar.hidden = false;
    const inp = $('#findInput');
    inp.focus(); inp.select();
    if (inp.value.trim()) runFind();
  }
  function closeFind() {
    $('#findBar').hidden = true;
    FIND.q = ''; FIND.hits = []; FIND.i = -1;
    $$('.row.find-hit, .row.find-cur').forEach(r => r.classList.remove('find-hit', 'find-cur'));
    if (window.CSS && CSS.highlights) { CSS.highlights.delete('vz-find'); CSS.highlights.delete('vz-find-cur'); }
  }
  function runFind(keepPos) {
    const q = fold($('#findInput').value.trim());
    FIND.q = q;
    const st = S.current ? store(S.current) : null;
    const prevId = FIND.hits[FIND.i];
    FIND.hits = q && st ? st.list.filter(m => isNum(m.id) && fold(searchableText(m)).includes(q)).map(m => String(m.id)) : [];
    // cel mai recent rezultat primul (ca în Messenger): navigăm de jos în sus
    FIND.i = keepPos && prevId && FIND.hits.includes(prevId) ? FIND.hits.indexOf(prevId) : FIND.hits.length - 1;
    paintFind(true);
  }
  function paintFind(scroll) {
    $$('.row.find-hit, .row.find-cur').forEach(r => r.classList.remove('find-hit', 'find-cur'));
    const n = FIND.hits.length;
    const st = S.current ? store(S.current) : null;
    $('#findCount').textContent = !FIND.q ? '' : n ? `${FIND.i + 1} din ${n}` : 'niciun rezultat';
    $('#findPrev').disabled = $('#findNext').disabled = n < 2;
    $('#findDeep').hidden = !FIND.q || !st || !st.hasMore;
    const all = [], cur = [];
    FIND.hits.forEach((id, k) => {
      const el = rowEls.get(id);
      if (!el) return;
      el.classList.add(k === FIND.i ? 'find-cur' : 'find-hit');
      for (const b of $$('.bubble.has-text, .file-name, .audio-name, .p2p-name, .p2p-card b', el)) (k === FIND.i ? cur : all).push(...textRanges(b, FIND.q));
    });
    if (window.CSS && CSS.highlights && window.Highlight) {
      CSS.highlights.set('vz-find', new Highlight(...all));
      CSS.highlights.set('vz-find-cur', new Highlight(...cur));
    }
    if (scroll && n) { const el = rowEls.get(FIND.hits[FIND.i]); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  /** intervale de text (pentru evidențiere) — potrivire fără diacritice, fără să modificăm DOM-ul */
  function textRanges(root, q) {
    const out = [];
    if (!q) return out;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const t = node.nodeValue;
      // fold păstrează lungimea pentru literele românești (NFD + eliminare diacritice = 1 caracter/literă)
      const f = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (f.length !== t.length) { let i = t.toLowerCase().indexOf(q); while (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + q.length); out.push(r); i = t.toLowerCase().indexOf(q, i + q.length); } continue; }
      const fl = f.toLowerCase();
      let i = fl.indexOf(q);
      while (i >= 0) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + q.length); out.push(r); i = fl.indexOf(q, i + q.length); }
    }
    return out;
  }
  function stepFind(d) {
    const n = FIND.hits.length;
    if (!n) return;
    FIND.i = (FIND.i + d + n) % n;
    paintFind(true);
  }
  async function deepFind() {
    if (FIND.busy || !S.current) return;
    const cid = S.current, st = store(cid);
    FIND.busy = true;
    const btn = $('#findDeep');
    btn.disabled = true;
    try {
      let pages = 0;
      while (st.hasMore && S.current === cid && pages < 60) { // max ~6000 mesaje
        btn.textContent = `Se încarcă istoricul… (${st.list.length})`;
        await loadOlder(100);
        pages++;
      }
    } catch (e) { toast(e.message, true); }
    finally {
      FIND.busy = false; btn.disabled = false; btn.textContent = 'Caută în tot istoricul';
      if (S.current === cid) runFind(false);
    }
  }
  $('#btnFind').addEventListener('click', () => { if ($('#findBar').hidden) openFind(); else closeFind(); });
  let findT = 0;
  $('#findInput').addEventListener('input', () => { clearTimeout(findT); findT = setTimeout(() => runFind(false), 120); });
  $('#findInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? 1 : -1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  $('#findPrev').addEventListener('click', () => stepFind(-1));
  $('#findNext').addEventListener('click', () => stepFind(1));
  $('#findClose').addEventListener('click', closeFind);
  $('#findDeep').addEventListener('click', deepFind);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && S.current && !$('#thread').hidden) { e.preventDefault(); openFind(); }
  });

  /* =====================================================================
     LONG-POLL
     ===================================================================== */
  function handleEvent(ev) {
    const d = ev.data;
    switch (ev.type) {
      case 'contact_preference': applyContactPreference(d); break;
      case 'contact_gate': applyContactGate(+d.user_id,!!d.restricted); break;
      case 'message': {
        const cid = d.conversation_id;
        if (!S.convs.has(cid)) { loadConversations().catch(() => {}); return; }
        // v2.0.2: isMine() — id string/number, client_uid local, temporare; mesajele mele NU au sunet
        const mine = isMine(d);
        const known = store(cid).byId.has(String(d.id)) || store(cid).list.some(x => x.client_uid && x.client_uid === d.client_uid);
        upsertMessage(d);
        bumpConv(cid, d);
        if (!mine && !known) {
          const c = S.convs.get(cid);
          const visible = cid === S.current && !document.hidden && (!isNarrow() || $('#app').classList.contains('in-chat'));
          if (!visible || !nearBottom()) c.unread = (c.unread || 0) + 1;
          else if (!document.hasFocus()) TT.away++; // conversația e deschisă, dar fereastra nu e în față
          // v2.1.12: nu comutăm preview-ul pe mesaj în timp ce typing e activ.
          // Evenimentul typing:false trimis de server (sau expirarea) va afișa ultimul mesaj o singură dată.
          renderConvList();
          if (S.restrictedContacts.has(+d.sender_id)) break; // common-group content remains, without contact notifications
          if (d.type === 'buzz') { doBuzz(d, false); if (!attending() || cid !== S.current) titleBuzz(d); }
          else if (d.type !== 'system') msgSound(d); // msgSound re-verifică isMine(d)
          notify(d);
        }
        break;
      }
      case 'message_update':
        upsertMessage(d);
        updateEditedReferences(d);
        TexConversationTools.onUpdate(d);
        if (S.convs.get(d.conversation_id) && S.convs.get(d.conversation_id).last_message && S.convs.get(d.conversation_id).last_message.id === d.id) { S.convs.get(d.conversation_id).last_message = d; renderConvList(); }
        P2P.onMessageUpdate(d);
        break;
      case 'pins_update': TexConversationTools.loadPins(d.conversation_id); break;
      case 'receipt': {
        const rc = S.receipts.get(d.conversation_id) || {};
        rc[d.user_id] = { delivered: d.delivered, read: d.read };
        S.receipts.set(d.conversation_id, rc);
        if (d.conversation_id === S.current) queueStatuses();
        renderConvList();
        break;
      }
      case 'reaction': {
        const st = store(d.conversation_id);
        const m = st.byId.get(String(d.message_id));
        if (m) { const before=visibleReactions(m);m.reactions=d.reactions;const after=visibleReactions(m);if(JSON.stringify(before)!==JSON.stringify(after)){rerenderRow(m);if(!sameId(d.by,S.me.id)&&!S.restrictedContacts.has(+d.by)&&after.length>before.length)pop();} }
        break;
      }
      case 'profile': applyUser(d); break;
      case 'typing': onTyping(d); break;
      case 'presence': onPresenceEvent(d); break;
      case 'signal': if (d && d.transfer_id && String(d.transfer_id).startsWith('vc_')) Call.onSignal(d); else P2P.onSignal(d); break;
      case 'conv_destroyed': {
        const c = convOf(d.conversation_id);
        if (!c && !S.msgs.has(d.conversation_id)) break;
        dropConv(d.conversation_id);
        E2E.invalidateGroup(d.conversation_id);
        if (d.by !== S.me.id) toast(`💥 ${nameOf(d.by)} a distrus conversația${d.is_group && d.title ? ' „' + d.title + '”' : ''}. Toate mesajele au fost șterse de pe server.`);
        break;
      }
      case 'conv_removed': if (S.convs.has(d.conversation_id)) dropConv(d.conversation_id); break;
      case 'conv_cleared': if (S.convs.has(d.conversation_id)) api('api/conversations.php?action=get', { body: { conversation_id: d.conversation_id } }).then(j => clearConv(d.conversation_id, j.conversation)).catch(() => clearConv(d.conversation_id)); break;
      case 'conv_update':
        api('api/conversations.php?action=get', { body: { conversation_id: d.conversation_id } }).then(async j => {
          await prepConv(j.conversation); ingestConv(j.conversation); E2E.invalidateGroup(j.conversation.id);
          renderConvList(); if (S.current === j.conversation.id) { renderHeader(); refreshE2E(j.conversation.id); }
        }).catch(() => {});
        break;
      case 'conv_key':
        E2E.invalidateGroup(d.conversation_id);
        if (S.convs.has(d.conversation_id)) { reprepConv(d.conversation_id); if (S.current === d.conversation_id) refreshE2E(d.conversation_id); }
        break;
      case 'key_update':
        E2E.invalidateUser(d.user_id);
        S.e2eConv.clear();
        refreshContactE2E();
        if (S.current) refreshE2E(S.current);
        break;
    }
  }
  /* ---------------- notificări desktop ---------------- */
  const notifs = new Map();
  const canNotify = () => 'Notification' in window;
  function plainBody(m) {
    const who = firstName(m.sender_id);
    let t;
    switch (m.type) {
      case 'image': t = '📷 ' + who + ' ți-a trimis o poză'; break;
      case 'video': t = '🎬 ' + who + ' ți-a trimis un clip video'; break;
      case 'audio': t = '🎵 ' + who + ' ți-a trimis un mesaj audio'; break;
      case 'file': t = '📎 ' + (m.attachment ? m.attachment.name : 'Fișier'); break;
      case 'buzz': t = '📳 '+who+' ți-a dat '+buzzCaption(m.conversation_id); break;
      case 'p2p': t = '⚡ Transfer P2P: ' + ((m.meta && m.meta.files && m.meta.files[0] && m.meta.files[0].name) || 'fișier'); break;
      default: {
        let b = String(m.body || '');
        // fără HTML și fără coduri de emoticoane YM => text simplu
        b = b.replace(/<[^>]*>/g, '');
        if (emoRe) { emoRe.lastIndex = 0; b = b.replace(emoRe, ' '); }
        b = b.replace(/\s+/g, ' ').trim();
        t = b || '(emoticon)';
      }
    }
    if (m.body && m.type !== 'text' && m.type !== 'buzz') t += ': ' + String(m.body).replace(/\s+/g, ' ').slice(0, 60);
    if (m.reply_to) t = '↩ ' + t;
    return t.length > 140 ? t.slice(0, 137) + '…' : t;
  }
  function chatFocused(cid) {
    return cid === S.current && !document.hidden && document.hasFocus() && (!isNarrow() || $('#app').classList.contains('in-chat'));
  }
  let askedOnce = false;
  function askPermissionHint() {
    if (askedOnce || !canNotify() || Notification.permission !== 'default' || S.settings.notify === false) return;
    askedOnce = true;
    // unele browsere cer un gest al utilizatorului => încercăm, iar la revenire oferim un buton
    try { Notification.requestPermission().then(syncNotifyUI).catch(() => {}); } catch (_) {}
    const offer = () => {
      window.removeEventListener('focus', offer);
      if (Notification.permission === 'default') toast('Vrei notificări desktop pentru mesaje noi?', false, { label: 'Activează', run: () => enableNotifications(true) });
    };
    if (document.hasFocus()) offer(); else window.addEventListener('focus', offer);
  }
  function notify(m) {
    if (!m || isMine(m) || S.restrictedContacts.has(+m.sender_id)) return;
    if (S.settings.notify === false || !canNotify()) return;
    if (chatFocused(m.conversation_id)) return;
    if (Notification.permission === 'default') return askPermissionHint();
    if (Notification.permission !== 'granted') return;
    try {
      const u = S.users.get(m.sender_id);
      const n = new Notification(nameOf(m.sender_id), { body: plainBody(m), tag: 'c' + m.conversation_id, renotify: true, silent: S.settings.sound !== false, icon: 'assets/img/logo-192.png', data: { cid: m.conversation_id } });
      n.onclick = e => {
        e.preventDefault();
        try { window.focus(); if (window.parent) window.parent.focus(); } catch (_) {}
        if (isNarrow()) $('#app').classList.add('in-chat');
        openConversation(m.conversation_id);
        n.close();
      };
      n.onclose = () => { if (notifs.get(m.conversation_id) === n) notifs.delete(m.conversation_id); };
      notifs.set(m.conversation_id, n);
    } catch (e) { console.warn('notify', e); }
  }
  function closeNotifs(cid) { const n = notifs.get(cid); if (n) { try { n.close(); } catch (_) {} notifs.delete(cid); } }
  async function enableNotifications(fromToggle) {
    if (!canNotify()) { toast('Browserul nu suportă notificări desktop', true); S.settings.notify = false; syncNotifyUI(); return; }
    let perm = Notification.permission;
    if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (_) { perm = Notification.permission; } }
    if (perm === 'granted') {
      S.settings.notify = true; saveSettings();
      if (fromToggle) try { new Notification(A.appName || 'Tex', { body: 'Notificările desktop sunt active ✓', icon: 'assets/img/logo-192.png', tag: 'test' }); } catch (_) {}
    } else {
      S.settings.notify = false; saveSettings();
      toast(perm === 'denied' ? 'Notificările sunt blocate în browser. Permite-le din setările site-ului (iconița 🔒 din bara de adresă).' : 'Permisiunea pentru notificări nu a fost acordată.', true);
    }
    syncNotifyUI();
  }
  function syncNotifyUI() {
    const cb = $('#setNotify'), st = $('#notifyState');
    if (!cb) return;
    if (!canNotify()) { cb.checked = false; cb.disabled = true; st.textContent = 'Browserul nu suportă notificări desktop.'; return; }
    const perm = Notification.permission;
    cb.checked = S.settings.notify !== false && perm === 'granted';
    st.textContent = perm === 'granted' ? (cb.checked ? 'Active: primești o notificare când vine un mesaj și nu ești în acea conversație.' : 'Dezactivate.')
      : perm === 'denied' ? 'Blocate de browser: permite-le din setările site-ului (🔒 în bara de adresă), apoi bifează din nou.'
      : 'Bifează pentru a permite notificările (browserul îți va cere acordul).';
    if (!window.isSecureContext) st.textContent += ' Atenție: notificările necesită HTTPS (sau localhost).';
  }

  /* Activity, not heartbeat, controls Idle (5m) / offline (30m). */
  let nativeVisible = window.__texNativeVisible !== false;
  const PRES = { idle: false, level: '', pending: '', lastInput: document.hidden || !nativeVisible ? 0 : Date.now(), ctrl: null, t: 0, lastWrite: 0 };
  const actKey = () => 'tex.activity.' + S.me.id;
  function sharedActivity() { let shared = 0; try { shared = +localStorage.getItem(actKey()) || 0; } catch (_) {} return Math.min(Date.now(), TexPresence.latest(PRES.lastInput, shared)); }
  function computeIdle() { return Date.now() - sharedActivity() >= 300000; }
  function presTick() {
    clearTimeout(PRES.t);
    const age = Date.now() - sharedActivity(); const level = age >= 1800000 ? 'offline' : age >= 300000 ? 'idle' : 'active';
    if (level !== PRES.level) { PRES.level = level; PRES.idle = level !== 'active'; PRES.pending = level; if (PRES.ctrl) PRES.ctrl.abort(); }
    // Wake at the next real idle boundary, not every ten seconds in the background.
    const nextBoundary = age < 300000 ? 300000 : age < 1800000 ? 1800000 : null;
    if (nextBoundary !== null) PRES.t = setTimeout(presTick, Math.max(1000, nextBoundary - age + 50));
  }
  let lastActivitySample = 0;
  function presActivity() {
    if (document.hidden || !nativeVisible) return;
    if (!PRES.idle && PRES.level === 'active' && Date.now() - lastActivitySample < 1000) return;
    lastActivitySample = Date.now();
    const now = Date.now(); PRES.lastInput = now;
    if (now - PRES.lastWrite > 2000 || PRES.idle) { try { localStorage.setItem(actKey(), String(TexPresence.latest(now, sharedActivity()))); } catch (_) {} PRES.lastWrite = now; }
    if (PRES.idle || PRES.level !== 'active') presTick();
    else if (now - PRES.lastWrite < 50) presTick();
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'].forEach(ev => window.addEventListener(ev, presActivity, { passive: true, capture: true }));
  window.addEventListener('storage', e => { if (e.key === actKey()) presTick(); });
  function syncVisibilityWork() {
    document.documentElement.classList.toggle('tex-background', !uiVisible());
    if (uiVisible()) { presActivity(); refreshPresence(); if(S.current && isFollowing())pinToBottom(); } else { clearTimeout(presenceT); cancelBottomPin(); }
    presTick();
  }
  document.addEventListener('visibilitychange', syncVisibilityWork);
  window.addEventListener('tex-visibility', e => { nativeVisible = e.detail?.visible !== false; window.__texNativeVisible = nativeVisible; syncVisibilityWork(); });
  function acceptPresenceSnapshot(j) {
    presenceFeedHealthy = true;
    if (j.server_time) S.serverOffset = Date.now() / 1000 - j.server_time;
    S.online = Object.assign(S.online, j.online || {});
    S.presence = Object.assign(S.presence, j.presence || {});
  }
  function onPresenceEvent(d) {
    const id = +d.user_id;
    if (!id || sameId(id, S.me.id)) return;
    // Snapshots are newer than queued events; never let an old reconnect event resurrect hidden users.
    if (d.presence && !S.presence[id]) S.presence[id] = d.presence;
    if (!S.presence[id]) S.online[id] = d.online ? (+d.last_seen || 0) : 0;
  }

  // New bridges reuse the already parsed payload; old bridges remain compatible.
  window.__texAndroidPollDispatch = true;
  async function pollLoop() {
    let fail = 0;
    presTick();
    for (;;) {
      let ctrl = null;
      try {
        ctrl = PRES.ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 45000);
        const pres = PRES.pending; PRES.pending = '';
        const q = '&activity=' + Math.max(0, Math.floor(presenceNow() - (Date.now() - sharedActivity()) / 1000)) + (pres ? '&timeout=1' : !uiVisible() ? '&timeout=35' : '');
        let j;
        try { j = await api('api/poll.php?since=' + S.cursor + q, { signal: ctrl.signal }); }
        catch (e) { if (pres && !PRES.pending) PRES.pending = pres; throw e; } // tranziția nu s-a raportat => reîncercăm
        finally { clearTimeout(to); }
        if (fail) { presPrev = null; TexConversationTools.loadPins(); } // reconnect is a fresh baseline, not a toast storm
        fail = 0;
        acceptPresenceSnapshot(j);
        if (Array.isArray(j.restricted_ids)) {
          const next=new Set(j.restricted_ids.map(Number));
          for(const id of next)if(!S.restrictedContacts.has(id))applyContactGate(id,true);
          for(const id of [...S.restrictedContacts])if(!next.has(id))applyContactGate(id,false);
        }
        window.VORBITozaurAndroid?.onPoll?.({...j,events:j.events.filter(ev=>!S.restrictedContacts.has(+(ev.data?.sender_id || (ev.type==='presence'&&ev.data?.user_id) || 0)))});
        for (const ev of j.events) {
          try {
            if (ev.type === 'message' || ev.type === 'message_update') await prep(ev.data);
            handleEvent(ev);
          } catch (e) { console.error('event', ev, e); }
        }
        if (j.cursor > S.cursor) S.cursor = j.cursor;
        refreshPresence();
      } catch (e) {
        if (e.message === 'auth') return;
        if (ctrl && ctrl.signal.aborted && PRES.pending) continue; // abort voit (schimbare idle/back) => re-poll imediat
        presenceFeedHealthy = false;
        fail++;
        await sleep(Math.min(15000, 500 * 2 ** Math.min(fail, 5)));
      }
    }
  }
  let presenceT = 0;
  function refreshPresence(skipCheck) {
    clearTimeout(presenceT);
    if (uiVisible()) {
      renderConvList(); // data/signaling still update while hidden; presentation resumes once
      renderHeader();
      renderMe();
    }
    if (!skipCheck) try { presenceCheck(); } catch (e) { console.warn(e); }
    if (uiVisible()) presenceT = setTimeout(refreshPresence, 10000);
    else updateTitle();
  }

  /* Contact information is owner-local metadata; canonical users are never renamed. */
  const ciModal = $('#contactInfo');
  let ciUser = 0, ciData = null, ciController = null, ciReturnFocus = null;
  let ciE2ESequence = 0;
  async function refreshContactE2E() {
    const sequence=++ciE2ESequence, other=ciUser;
    if (!other || ciModal.hidden) return;
    const status=$('#ciE2EStatus'), detail=$('#ciE2EDetail'), unlock=$('#ciE2EUnlock');
    status.textContent='Se verifică starea E2E…'; detail.textContent=''; unlock.hidden=true;
    // Resolve the requested contact, never the unrelated currently open conversation.
    const matches=c=>!c.is_group && +peerOf(c.id).id===other;
    const current=S.convs.get(S.current);
    const conv=current && matches(current) ? current : [...S.convs.values()].find(matches);
    if (!conv) {
      status.textContent='Stare E2E indisponibilă';
      detail.textContent='Nu există o conversație directă disponibilă pentru verificare.';
      return;
    }
    const state=await E2E.convStatus(conv).catch(()=>({on:false,reason:'error'}));
    if (sequence!==ciE2ESequence || other!==ciUser || ciModal.hidden) return;
    if (S.convs.get(conv.id)!==conv || !matches(conv)) { refreshContactE2E(); return; }
    status.innerHTML=e2eChip(state);
    detail.textContent=state.on
      ? 'Criptarea E2E este disponibilă pentru mesajele și fișierele noi din această conversație. Mesajele anterioare își păstrează propria stare de criptare.'
      : (E2E_REASON[state.reason] || (state.reason==='loading' ? 'Verificarea cheilor este în curs.' : 'Criptarea E2E nu este disponibilă acum.'));
    unlock.hidden=!['locked','none'].includes(state.reason);
    unlock.textContent=state.reason==='none' ? 'Activează E2E' : 'Deblochează E2E';
  }

  function applyContactPreference(p) {
    if (!p || !Number.isSafeInteger(+p.user_id) || +p.user_id === +S.me.id) return;
    S.contactPrefs.set(+p.user_id, { user_id:+p.user_id, alias:String(p.alias || ''), ignored:!!p.ignored });
    const user=S.users.get(+p.user_id);
    if(user)$$('[data-identity-user="'+p.user_id+'"]').forEach(el=>patchConvHtml(el,verifiedName(user)));
    renderConvList(); renderHeader();
    const intro = $('#convIntro h3');
    if (intro && S.current && !isGroup(S.current) && +peerOf(S.current).id === +p.user_id) intro.innerHTML=verifiedName(peerOf(S.current));
    if (ciUser === +p.user_id && ciData) renderContactInfo();
  }
  function applyContactGate(other, restricted) {
    if (restricted) S.restrictedContacts.add(+other); else S.restrictedContacts.delete(+other);
    if (restricted) {
      Call.blockPeer?.(+other);
      P2P.blockPeer?.(+other);
      for (const [cid,n] of notifs) if (!isGroup(cid) && +peerOf(cid).id===+other) { n.close(); notifs.delete(cid); }
    }
    renderHeader();
    if (ciUser===+other && ciData) renderContactInfo();
  }
  function renderContactInfo() {
    if (!ciData || !ciUser) return;
    const c=ciData.contact, p=S.contactPrefs.get(ciUser) || {alias:'',ignored:false};
    $('#ciName').innerHTML=verifiedName(c,p.alias || c.display_name);
    $('#ciVerified').hidden=!c.verified;
    $('#ciOriginal').textContent=(p.alias ? 'Nume original: '+c.display_name+' · ' : '')+'@'+c.username;
    $('#ciCreated').textContent=c.created_at ? new Intl.DateTimeFormat('ro-RO',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Bucharest'}).format(new Date(c.created_at*1000))+' (Europe/Bucharest)' : 'Data înregistrării nu este disponibilă';
    const seconds=c.age_seconds;
    $('#ciAge').textContent=seconds==null ? 'Indisponibilă' : seconds>=86400 ? roCount(Math.floor(seconds/86400),'zi','zile') : seconds>=3600 ? roCount(Math.floor(seconds/3600),'oră','ore') : 'Mai puțin de o oră';
    $('#ciCount').textContent=Number(c.message_count).toLocaleString('ro-RO');
    if (document.activeElement!==$('#ciAlias')) $('#ciAlias').value=p.alias;
    $('#ciIgnore').textContent=p.ignored ? 'Nu mai ignora contactul' : 'Ignoră contactul';
    $('#ciIgnore').className=p.ignored ? 'btn ghost' : 'btn danger';
    $('#ciIgnoreState').textContent=p.ignored ? 'Ignori acest contact; mesajele directe sunt oprite.' : S.restrictedContacts.has(ciUser) ? 'Mesajele directe nu sunt disponibile pentru acest contact.' : 'Poți schimba mesaje directe cu acest contact.';
    $('#ciLoading').hidden=true; $('#ciDetails').hidden=false;
  }
  async function openContactInfo(other) {
    ciController?.abort(); ciController=new AbortController();
    ciUser=+other; ciData=null; ciReturnFocus=document.activeElement;
    ++ciE2ESequence; $('#ciE2EStatus').textContent='Se verifică starea E2E…'; $('#ciE2EDetail').textContent=''; $('#ciE2EUnlock').hidden=true;
    $('#ciDetails').hidden=true; $('#ciLoading').hidden=false; $('#ciError').hidden=true;
    for (const b of ciModal.querySelectorAll('#ciDetails button')) b.disabled=false;
    openModal(ciModal); $('#ciTitle').focus({preventScroll:true});
    const controller=ciController;
    try {
      const j=await api('api/contact-info.php?user_id='+encodeURIComponent(other),{signal:controller.signal});
      if (controller.signal.aborted || ciUser!==+other) return;
      ciData=j; applyContactPreference(j.preference); applyContactGate(+other,j.restricted); renderContactInfo();
      refreshContactE2E();
    } catch(e) { if (e.name!=='AbortError' && ciUser===+other) { $('#ciLoading').hidden=true; $('#ciError').textContent=e.message; $('#ciError').hidden=false; } }
  }
  async function saveContactPreference(action, values) {
    const other=ciUser; if (!other || !ciData) return;
    for (const b of ciModal.querySelectorAll('#ciDetails button')) b.disabled=true;
    $('#ciError').hidden=true;
    try {
      const j=await api('api/contact-info.php?action='+action,{body:{user_id:other,...values}});
      applyContactPreference(j.preference); applyContactGate(other,j.restricted);
      if (ciUser===other) { $('#ciAlias').value=j.preference.alias; toast(action==='alias' ? 'Numele a fost salvat doar pentru tine.' : j.preference.ignored ? 'Contactul a fost ignorat.' : 'Contactul nu mai este ignorat.'); }
    } catch(e) { if (ciUser===other) { $('#ciError').textContent=e.message; $('#ciError').hidden=false; } }
    finally { if(ciUser===other) for(const b of ciModal.querySelectorAll('#ciDetails button')) b.disabled=false; }
  }
  $('#ciE2ERefresh').addEventListener('click',refreshContactE2E);
  $('#ciE2EUnlock').addEventListener('click',()=>{closeModal(ciModal);openE2E(false);});
  $('#ciAliasForm').addEventListener('submit',e=>{e.preventDefault();saveContactPreference('alias',{alias:$('#ciAlias').value});});
  $('#ciResetAlias').addEventListener('click',()=>saveContactPreference('alias',{alias:''}));
  $('#ciIgnore').addEventListener('click',()=>saveContactPreference('ignore',{ignored:!S.contactPrefs.get(ciUser)?.ignored}));
  ciModal.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) closeModal(ciModal);});
  ciModal.addEventListener('tex-modal-close',()=>{ciController?.abort();++ciE2ESequence;ciUser=0;ciData=null;if(ciReturnFocus?.isConnected)ciReturnFocus.focus({preventScroll:true});});
  ciModal.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const items=[...ciModal.querySelectorAll('button,input')].filter(el=>!el.disabled&&el.getClientRects().length);
    if(!items.length)return;const first=items[0],last=items[items.length-1];
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('#ciTitle'))){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  function headerContactInfo(){if(S.current&&!isGroup(S.current))openContactInfo(peerOf(S.current).id);}
  $('#thPeer').addEventListener('click',headerContactInfo);
  $('#thPeer').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&S.current&&!isGroup(S.current)){e.preventDefault();headerContactInfo();}});
  $('#contactGateInfo').addEventListener('click',headerContactInfo);

  /* =====================================================================
     SETĂRI
     ===================================================================== */
  const setM = $('#settings');
  TexSettings.init(setM);
  function openSettings() {
    $('#setAvatar').outerHTML = avatar(S.me, 'xl').replace('class="avatar', 'id="setAvatar" class="avatar');
    $('#setName').value = S.me.display_name;
    $('#setUsername').textContent = S.me.username;
    patchConvHtml($('#setIdentityBadges'), verifiedBadge(S.me)+staffBadge(S.me));
    $('#setEmail').textContent = S.me.email ? ' · ' + S.me.email : '';
    $('#setAvatarColor').value = safeColor(S.me.avatar_color);
    $('#btnAvatarRemove').hidden = !S.me.avatar;
    $('#setSound').checked = S.settings.sound !== false;
    $('#setEnter').checked = S.settings.enter !== false;
    $('#setEmoAnim').checked = S.settings.emo !== false;
    $('#setPresence').checked = S.settings.presence === true;
    $('#setPresenceSound').checked = S.settings.presenceSound !== false;
    renderWalls(); syncE2EUI();
    renderPalettes();
    syncSettingsUI();
    TexSettings.show('', false);
    renderPresenceUsers();
    openModal(setM);
    syncNotifyUI();
    syncZoomUI();
  }
  function renderPalettes() {
    const mode = resolvedMode();
    $('#palettes').innerHTML = PALETTES.map(p => {
      const c = paletteColors(p.id, mode);
      return `<button class="pal" data-p="${p.id}"><span class="sw"><i style="background:${p.grad || c.sent}"></i><i style="background:${c.recv}"></i></span>${esc(p.name)}</button>`;
    }).join('') + `<button class="pal" data-p="custom"><span class="sw"><i style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"></i></span>Personalizat</button>`;
  }
  function syncSettingsUI() {
    if (!S.settings) return;
    const seg = $('#modeSeg');
    const modes = ['light', 'dark', 'auto'];
    $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.mode === S.settings.mode));
    let ink = $('.ink', seg);
    if (!ink) { ink = document.createElement('span'); ink.className = 'ink'; seg.prepend(ink); }
    ink.style.transform = `translateX(${Math.max(0, modes.indexOf(S.settings.mode)) * 100}%)`;
    $$('.pal', $('#palettes')).forEach(b => b.classList.toggle('on', b.dataset.p === S.settings.palette));
    const c = currentColors();
    $$('#customColors input').forEach(i => { i.value = hexOk(c[i.dataset.key]) ? c[i.dataset.key] : '#000000'; });
    $('#setGradient').checked = !!S.settings.gradient;
    $('#setGradient').disabled = !c.grad;
    $('#preview').innerHTML = `<div class="pv-row in"><div class="pv-b">${rich('Salut! Ce faci? :)')}</div></div><div class="pv-row out"><div class="pv-b">${rich('Bine, tu? =))')}</div></div><div class="pv-row out"><div class="pv-b">${rich('Uite noile culori! :x')}</div></div>`;
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#meAvatar').addEventListener('click', openSettings);
  setM.addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop') || e.target.closest('[data-close]')) return closeModal(setM);
    const md = e.target.closest('[data-mode]');
    if (md) { S.settings.mode = md.dataset.mode; S.settings.wall = null; renderWalls(); applyTheme(true); renderPalettes(); syncSettingsUI(); saveSettings(); return; }
    const p = e.target.closest('.pal');
    if (p) {
      const id = p.dataset.p;
      if (id === 'custom') { S.settings.custom = S.settings.custom || Object.assign({}, currentColors()); delete S.settings.custom.grad; }
      else { const def = PALETTES.find(x => x.id === id); S.settings.gradient = !!(def && def.gradDefault) || (S.settings.palette === id ? S.settings.gradient : !!(def && def.gradDefault)); }
      S.settings.palette = id;
      applyTheme(false); saveSettings();
      p.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
  });
  $('#customColors').addEventListener('input', e => {
    const i = e.target.closest('input[type=color]');
    if (!i) return;
    if (S.settings.palette !== 'custom') { S.settings.custom = Object.assign({}, currentColors()); delete S.settings.custom.grad; S.settings.palette = 'custom'; }
    S.settings.custom[i.dataset.key] = i.value;
    applyTheme(false); saveSettings();
  });
  $('#setGradient').addEventListener('change', e => { S.settings.gradient = e.target.checked; applyTheme(false); saveSettings(); });
  $('#btnResetColors').addEventListener('click', () => { S.settings.palette = 'vorbitozaur'; S.settings.custom = null; S.settings.gradient = false; S.settings.wall = null; S.settings.mode = 'light'; applyTheme(true); renderPalettes(); renderWalls(); saveSettings(); });
  function renderPresenceUsers() {
    const q = ($('#presenceFilter').value || '').toLowerCase();
    $('#presenceUsers').innerHTML = [...S.users.values()].filter(u => u.id !== S.me.id && (!q || matchU(u, q))).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ro')).map(u => `<label class="pick-row"><input type="checkbox" data-pres-user="${u.id}" ${presWatch().has(u.id) ? 'checked' : ''}><span>${esc(displayName(u))} <small>@${esc(u.username)}</small></span></label>`).join('') || '<p class="muted small">Niciun utilizator disponibil.</p>';
  }
  $('#presenceFilter').addEventListener('input', renderPresenceUsers);
  $('#presenceUsers').addEventListener('change', e => { const id = +e.target.dataset.presUser; if (!id) return; const selected = presWatch(); if (e.target.checked) selected.add(id); else selected.delete(id); S.settings.presenceUsers = [...selected]; presPrev = null; saveSettings(); });
  $('#setPresence').addEventListener('change', e => { S.settings.presence = e.target.checked; presPrev = null; $('#presenceToasts').replaceChildren(); saveSettings(); });
  $('#setPresenceSound').addEventListener('change', e => { S.settings.presenceSound = e.target.checked; saveSettings(); if (e.target.checked) playSnd('conectare'); });
  $('#setE2EStrict').addEventListener('change', e => { S.settings.e2eStrict = e.target.checked; saveSettings(); });
  $('#btnE2EUnlock').addEventListener('click', () => openE2E(false));
  $('#btnE2EReset').addEventListener('click', () => openE2E(true));
  $('#setSound').addEventListener('change', e => { S.settings.sound = e.target.checked; saveSettings(); if (e.target.checked) pop(); });
  $('#setNotify').addEventListener('change', e => {
    if (e.target.checked) enableNotifications(true);
    else { S.settings.notify = false; saveSettings(); syncNotifyUI(); }
  });

  /* ---------------- zoom text conversație (100–400%) ---------------- */
  function clampZoom(z) { z = Math.round((+z || 100) / 10) * 10; return Math.max(100, Math.min(400, z)); }
  function zoomFactor() { return (S.settings ? clampZoom(S.settings.zoom) : 100) / 100; }
  let zoomRT = 0, zoomSaveT = 0;
  function applyZoom(z, opts = {}) {
    z = clampZoom(z);
    const changed = z !== S.settings.zoom || opts.force;
    const wasBottom = nearBottom();
    // ancoră: păstrăm poziția relativă de citire
    const ratio = messagesEl.scrollHeight > messagesEl.clientHeight ? messagesEl.scrollTop / (messagesEl.scrollHeight - messagesEl.clientHeight) : 1;
    S.settings.zoom = z;
    document.documentElement.style.setProperty('--chat-zoom', String(z / 100));
    document.documentElement.classList.toggle('zoom-big', z >= 150); document.documentElement.classList.toggle('zoom-huge', z >= 250);
    syncZoomUI();
    requestAnimationFrame(autoGrow);
    if (!changed) return;
    const fix = () => { if (wasBottom || isFollowing()) scrollBottom(); else messagesEl.scrollTop = ratio * (messagesEl.scrollHeight - messagesEl.clientHeight); };
    requestAnimationFrame(fix); setTimeout(fix, 320);
    // dimensiunile pozelor depind de zoom => re-randare amânată
    clearTimeout(zoomRT);
    zoomRT = setTimeout(() => { if (S.current) { renderThread(); if (!wasBottom) fix(); } }, 350);
    if (!opts.noSave) { clearTimeout(zoomSaveT); zoomSaveT = setTimeout(saveSettings, 250); }
  }
  function syncZoomUI() {
    const z = S.settings ? clampZoom(S.settings.zoom) : 100;
    const pct = z + '%';
    const zv = $('#zoomVal'); if (zv && zv.textContent !== pct) { zv.textContent = pct; zv.animate && zv.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
    $('#zoomRange').value = z; $('#setZoom').value = z; $('#setZoomVal').textContent = pct;
    $$('#zoomSteps [data-z]').forEach(b => b.classList.toggle('on', +b.dataset.z === z));
    $('#zoomOut').disabled = z <= 100; $('#zoomIn').disabled = z >= 400;
    $('#btnZoom').classList.toggle('on', z !== 100);
    $('#btnZoom').title = 'Zoom conversație (mărime UI): ' + pct;
    $('#btnZoom').textContent = 'Zoom conversație (' + pct + ')';
  }
  const zoomPop = $('#zoomPop');
  $('#btnZoom').addEventListener('click', e => { e.stopPropagation(); if (!zoomPop.hidden) return closePopover(zoomPop); zoomPop.classList.remove('closing'); syncZoomUI(); placePopover(zoomPop, $('#btnMore'), 'right'); $('#zoomRange').focus(); });
  $('#zoomRange').addEventListener('input', e => applyZoom(e.target.value));
  $('#setZoom').addEventListener('input', e => applyZoom(e.target.value));
  $('#zoomIn').addEventListener('click', () => applyZoom(S.settings.zoom + (S.settings.zoom >= 200 ? 50 : 25)));
  $('#zoomOut').addEventListener('click', () => applyZoom(S.settings.zoom - (S.settings.zoom > 200 ? 50 : 25)));
  $('#zoomSteps').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) applyZoom(+b.dataset.z); });
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || !e.altKey) return;
    if (e.code === 'Equal' || e.code === 'NumpadAdd') { e.preventDefault(); applyZoom(S.settings.zoom + 25); }
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') { e.preventDefault(); applyZoom(S.settings.zoom - 25); }
    else if (e.code === 'Digit0' || e.code === 'Numpad0') { e.preventDefault(); applyZoom(100); }
  });
  document.addEventListener('click', e => { if (!zoomPop.hidden && !e.target.closest('#zoomPop,#btnZoom')) closePopover(zoomPop); });

  $('#setEnter').addEventListener('change', e => { S.settings.enter = e.target.checked; saveSettings(); });
  $('#setEmoAnim').addEventListener('change', e => { S.settings.emo = e.target.checked; saveSettings(); syncSettingsUI(); if (S.current) renderThread(); renderConvList(); });
  let profT = 0;
  function saveProfile() {
    clearTimeout(profT);
    profT = setTimeout(async () => {
      const name = $('#setName').value.trim();
      if (!name) return;
      try {
        const j = await api('api/auth.php?action=profile', { body: { display_name: name, avatar_color: $('#setAvatarColor').value } });
        applyUser(j.user);
        $('#setAvatar').outerHTML = avatar(S.me, 'xl').replace('class="avatar', 'id="setAvatar" class="avatar');
      } catch (e) { toast(e.message, true); }
    }, 500);
  }
  $('#setName').addEventListener('input', saveProfile);
  $('#setAvatarColor').addEventListener('input', saveProfile);
  let logoutFlight = null;
  function logoutAccount() {
    if (logoutFlight) return logoutFlight;
    $('#btnLogout').disabled=true; $('#statusLogout').disabled=true;
    closePopover($('#statusPop')); window.TexMenuEmoji?.closeSelects(); window.TexGalleryPreviews?.reset();
    logoutFlight=(async()=>{
      try { await api('api/auth.php?action=logout', { body: {} }); }
      catch (_) { logoutFlight=null; $('#btnLogout').disabled=false; $('#statusLogout').disabled=false; toast('Deconectarea nu a fost confirmată. Reîncearcă sau reîncarcă pagina.',true); return; }
      try { await E2E.forget(); } catch (_) {}
      location.href='login.php';
    })();
    return logoutFlight;
  }
  $('#btnLogout').addEventListener('click',logoutAccount);
  $('#statusLogout').addEventListener('click',logoutAccount);
  $('#btnTheme').addEventListener('click', () => {
    S.settings.mode = resolvedMode() === 'dark' ? 'light' : 'dark';
    S.settings.wall = null; // tema cu fundal își impune modul; comutarea manuală o dezactivează
    applyTheme(true); renderPalettes(); renderWalls(); saveSettings();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.mode === 'auto') applyTheme(true); });

  /* ---------------- avatar + status (ca la Yahoo! Messenger) ---------------- */
  function syncAvatarNode(old, fresh) {
    const oldImg = $('img', old), newImg = $('img', fresh);
    for (const a of [...old.attributes]) if (!fresh.hasAttribute(a.name) && a.name !== 'id') old.removeAttribute(a.name);
    for (const a of [...fresh.attributes]) if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
    if (oldImg && newImg) {
      if (oldImg.getAttribute('src') !== newImg.getAttribute('src')) oldImg.replaceWith(newImg);
    } else if (old.innerHTML !== fresh.innerHTML) old.replaceChildren(...fresh.childNodes);
    return old;
  }
  function stableAvatarHtml(el, html) {
    if (!el || el._stableHtml === html) return;
    const t = document.createElement('div'); t.innerHTML = html;
    const pools = new Map();
    const key = av => av.dataset.uid + ':' + ['sm','xs','lg','xl'].filter(c => av.classList.contains(c)).join(',');
    $$('.avatar[data-uid]', el).forEach(av => { const k = key(av); if (!pools.has(k)) pools.set(k, []); pools.get(k).push(av); });
    $$('.avatar[data-uid]', t).forEach(av => { const old = pools.get(key(av))?.shift(); if (old) av.replaceWith(syncAvatarNode(old, av)); });
    el.replaceChildren(...t.childNodes); el._stableHtml = html;
  }
  function refreshAvatars(id) {
    const u = S.users.get(id);
    if (!u) return;
    $$(`.avatar[data-uid="${id}"]`).forEach(el => {
      const cls = ['sm', 'xs', 'lg', 'xl'].filter(c => el.classList.contains(c)).join(' ');
      const t = document.createElement('div');
      t.innerHTML = avatar(u, cls, el.classList.contains('online') && (id === S.me.id || isOnline(id)));
      syncAvatarNode(el, t.firstElementChild);
    });
  }
  function applyUser(u) {
    if (!u || !u.id) return;
    const id = u.id;
    if (Number(id) === Number(S.me.id)) { Object.assign(S.me,u);syncContactListMode(); }
    S.users.set(id, Object.assign(S.users.get(id) || {}, u));
    if (S.contacts.has(id)) Object.assign(S.contacts.get(id),u);
    for (const c of S.convs.values()) { const mm = (c.members || []).find(x => x.id === id); if (mm) Object.assign(mm, u); }
    if (id !== S.me.id) {
      // v2.0.3: nu șterge prezența live doar pentru că profilul n-are last_seen; invizibil/offline => offline
      if (u.status === 'invisible' || u.status === 'offline') S.online[id] = 0;
      else if (u.last_seen && u.last_seen > (S.online[id] || 0)) S.online[id] = u.last_seen;
    }
    if (ciUser===+id && ciData) { Object.assign(ciData.contact,{display_name:u.display_name,username:u.username,verified:!!u.verified,staff_label:u.staff_label || ''}); renderContactInfo(); }
    refreshAvatars(id);
    $$('[data-identity-user="'+id+'"]').forEach(el=>patchConvHtml(el,verifiedName(u,el.dataset.selfLabel==='1' ? u.display_name+' (tu)' : displayName(u))));
    if (Number(id) === Number(S.me.id)) renderMe();
    renderConvList();
    renderHeader();
    try { presenceCheck(); } catch (_) {}
    const intro = $('#convIntro');
    if (intro && S.current && !isGroup(S.current) && peerOf(S.current).id === id) { $('h3',intro).innerHTML=verifiedName(u); const sl = statusLine(u); let el = $('.intro-status', intro); if (sl) { if (!el) { el = document.createElement('div'); el.className = 'intro-status'; $('h3', intro).nextElementSibling.after(el); } el.innerHTML = statusDot(u) + rich(sl); } else if (el) el.remove(); }
  }
  async function saveStatus(type, text) {
    const sequence=++statusChangeSequence;
    if (statusLocked(type)) text = '';
    lockStatusField(type);
    pendingListStatus=type;syncContactListMode(); // Immediate list typography; presence itself stays server-authoritative.
    try {
      const j = await api('api/auth.php?action=status', { body: { status: type, status_text: text } });
      if(sequence!==statusChangeSequence)return;
      pendingListStatus=null;applyUser(j.user);syncContactListMode();
      syncStatusUI();
    } catch (e) { if(sequence===statusChangeSequence){pendingListStatus=null;syncContactListMode();}toast(e.message, true); }
  }
  const statusLocked = st => st === 'invisible' || st === 'offline';
  function lockStatusField(st) {
    const locked = statusLocked(st), input = $('#statusText'), save = $('#statusSave');
    if (!input) return;
    input.disabled = locked; if (save) save.disabled = locked;
    if (locked) input.value = '';
    input.placeholder = locked ? 'Nu poți scrie un mesaj în acest mod' : 'Ce faci acum? (de exemplu, la o cafea)';
    $('.sp-msg', $('#statusPop'))?.classList.toggle('is-locked', locked);
  }
  function syncStatusUI() {
    syncContactListMode();
    const st = S.me.status || 'available';
    lockStatusField(st);
    $$('#statusPop [data-st]').forEach(b => b.classList.toggle('on', b.dataset.st === (st === 'offline' ? 'invisible' : st)));
    if (document.activeElement !== $('#statusText')) $('#statusText').value = S.me.status_text || '';
  }
  async function uploadAvatar(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return toast('Alege o imagine JPG, PNG, GIF sau WebP', true);
    if (file.size > 8 * 1024 * 1024) return toast('Imaginea este prea mare (maximum 8 MB)', true);
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const send = () => fetch('api/auth.php?action=avatar', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': A.csrf }, body: fd });
      let r = await send();
      if (r.status === 401 || r.status === 419) { await refreshSession(); r = await send(); }
      let j; try { j = await r.json(); } catch (_) { throw new Error('Eroare server (' + r.status + ')'); }
      if (!j.ok) throw new Error(j.error || 'Eroare');
      applyUser(j.user);
      $('#setAvatar').outerHTML = avatar(S.me, 'xl').replace('class="avatar', 'id="setAvatar" class="avatar');
      $('#btnAvatarRemove').hidden = !S.me.avatar;
      toast('Poza de profil a fost actualizată ✓');
    } catch (e) { toast(e.message, true); }
  }
  $('#btnAvatarUpload').addEventListener('click', () => $('#fileAvatar').click());
  $('#fileAvatar').addEventListener('change', e => { uploadAvatar(e.target.files[0]); e.target.value = ''; });
  $('#btnAvatarRemove').addEventListener('click', async () => {
    try {
      const j = await api('api/auth.php?action=avatar_remove', { body: {} });
      applyUser(j.user);
      $('#setAvatar').outerHTML = avatar(S.me, 'xl').replace('class="avatar', 'id="setAvatar" class="avatar');
      $('#btnAvatarRemove').hidden = true;
    } catch (e) { toast(e.message, true); }
  });
  const statusPop = $('#statusPop');
  $('#meStatusBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (!statusPop.hidden) return closePopover(statusPop);
    statusPop.classList.remove('closing'); syncStatusUI(); placePopover(statusPop, $('#meStatusBtn'), 'left');
    setTimeout(() => { if (!$('#statusText').disabled) $('#statusText').focus(); }, 60);
  });
  statusPop.addEventListener('click', e => {
    const b = e.target.closest('[data-st]');
    if (b) { saveStatus(b.dataset.st, $('#statusText').value); return; }
    if (e.target.closest('#statusSave')) { if (statusLocked(S.me.status)) return; saveStatus(S.me.status || 'available', $('#statusText').value); closePopover(statusPop); }
  });
  $('#statusText').addEventListener('keydown', e => { if ($('#statusText').disabled) return; if (e.key === 'Enter') { e.preventDefault(); $('#statusSave').click(); } if (e.key === 'Escape') closePopover(statusPop); });
  document.addEventListener('click', e => { if (!statusPop.hidden && !e.target.closest('#statusPop,#meStatusBtn')) closePopover(statusPop); });
  $('#meBarAvatar').addEventListener('click', openSettings);

  function renderMe() {
    // One class change updates the whole list immediately, including while list sorting is deferred.
    syncContactListMode();
    stableAvatarHtml($('#meAvatar'), avatar(S.me));
    stableAvatarHtml($('#meBarAvatar'), avatar(S.me, 'lg'));
    patchConvHtml($('#meName'), verifiedName(S.me,S.me.display_name));
    patchConvHtml($('#setIdentityBadges'), verifiedBadge(S.me)+staffBadge(S.me));
    $('#setVerified').hidden=!S.me.verified;
    $('#adminSection').hidden=!S.me.is_admin;
    const st = S.me.status || 'available';
    const idle = effectivePresence(S.me.id).idle && !['invisible', 'offline', 'away'].includes(st);
    const autoOffline = !!S.presence[S.me.id] && !effectivePresence(S.me.id).online && !['invisible','offline'].includes(st);
    const shownStatus = autoOffline ? 'offline' : idle ? 'away' : st;
    patchConvHtml($('#meStatusBtn'), `<i class="sdot s-${shownStatus}"></i><span class="ms-txt">${autoOffline ? 'Deconectat (inactiv)' : idle ? 'Plecat' : S.me.status_text ? rich(S.me.status_text) : esc(STATUS[st].label)}</span><svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5H7Z"/></svg>`);
    const statusDetail=distinctStatusSuffix(STATUS[st].label,S.me.status_text);
    $('#meStatusBtn').title = 'Status: ' + STATUS[st].label + (statusDetail ? ' · ' + statusDetail : '') + ' (clic pentru a schimba)';
    const w = $('#welcomeName'); if (w) w.textContent = String(S.me.display_name).split(/\s+/)[0];
  }

  /* =====================================================================
     PORNIRE
     ===================================================================== */
  function loadSettings() {
    let s = A.settings;
    if (!s || typeof s !== 'object') { try { s = JSON.parse(localStorage.getItem('msgr.settings.' + S.me.id) || 'null'); } catch (_) { s = null; } }
    S.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    if (!['light', 'dark', 'auto'].includes(S.settings.mode)) S.settings.mode = 'dark';
    if (S.settings.palette !== 'custom' && !PALETTES.some(p => p.id === S.settings.palette)) S.settings.palette = 'vorbitozaur';
    S.settings.zoom = clampZoom(S.settings.zoom);
    if (!s || !s.presenceV217) { S.settings.presence = false; S.settings.presenceUsers = []; S.settings.presenceV217 = true; }
    S.settings.presenceUsers = [...new Set((Array.isArray(S.settings.presenceUsers) ? S.settings.presenceUsers : []).map(Number).filter(Number.isSafeInteger))];
    // v2.0.1: E2E „Trimite doar criptat” ON by default pentru toată lumea (o singură migrare; ulterior pot debifa)
    if (!S.settings._e2eStrict201) { S.settings.e2eStrict = true; S.settings._e2eStrict201 = 1; }
  }
  window.addEventListener('popstate', () => {
    vtHistoryBack = false;
    const m = /^#c=(\d+)$/.exec(location.hash);
    if (m && S.convs.has(+m[1])) openConversation(+m[1]);
    else closeThread(true);
  });
  window.addEventListener('hashchange', () => {
    const m = /^#c=(\d+)$/.exec(location.hash);
    if (m && S.convs.has(+m[1]) && (+m[1] !== S.current || !$('#app').classList.contains('in-chat'))) openConversation(+m[1]);
  });
  window.addEventListener('resize', () => { queueKeyboardInset(); syncNarrowClass(); if (!isNarrow()) $('#app').classList.toggle('in-chat', !!S.current); });
  window.addEventListener('orientationchange', () => setTimeout(syncNarrowClass, 50));

  async function boot() {
    loadSettings();
    applyTheme(false);
    syncNarrowClass();
    applyZoom(S.settings.zoom, { noSave: true, force: true });
    renderMe();
    P2P.init({
      api, toast, iceServers: A.iceServers, me: S.me, peerOf, isBlocked: directRestricted,
      isGroup: cid => isGroup(cid),
      upsert: async m => { await prep(m); upsertMessage(m); bumpConv(m.conversation_id, m); },
      rerender: (id, force) => { for (const st of S.msgs.values()) { const m = st.byId.get(String(id)); if (m) { rerenderRow(m, force); break; } } },
      encSignal: async (cid, data) => { const c = convOf(cid); return c ? E2E.encryptJson(c, data, 'sig') : null; },
      decSignal: async (cid, enc) => { const c = convOf(cid); if (!c) throw new Error('conv'); return E2E.decryptJson(c, enc, 'sig'); },
      encMeta: async (cid, obj) => { const c = convOf(cid); return c ? E2E.encryptJson(c, obj, 'p2pmeta') : null; },
      e2eRequired: cid => { const e = S.e2eConv.get(cid); return !!(e && e.on); },
      uploadFiles,
    });
    Call.init({
      api, toast, iceServers: A.iceServers, me: S.me, peerOf, isBlocked: directRestricted, appName: A.appName,
      isGroup: cid => isGroup(cid),
      userOf: id => S.users.get(id) || { id, display_name: 'Contact' },
      avatarHtml: (u, cls) => avatar(u, cls || ''),
      encSignal: async (cid, data) => { const c = convOf(cid); return c ? E2E.encryptJson(c, data, 'sig') : null; },
      decSignal: async (cid, enc) => { const c = convOf(cid); if (!c) throw new Error('conv'); return E2E.decryptJson(c, enc, 'sig'); },
      e2eRequired: cid => { const e = S.e2eConv.get(cid); return !!(e && e.on); },
    });
    try { await E2E.init({ api, me: S.me, onKeyChange: uid => { const u = S.users.get(uid); toast(`🔑 Cheia de securitate a lui ${u ? u.display_name : 'un contact'} s-a schimbat (a resetat E2E sau a activat-o din nou). Verifică codul de siguranță dacă ai dubii.`); } }); } catch (_) {}
    syncE2EUI();
    try {
      const j = await api('api/poll.php?init=1&activity=' + Math.max(0, Math.floor(presenceNow() - (Date.now() - sharedActivity()) / 1000)));
      S.cursor = j.cursor; acceptPresenceSnapshot(j);
    } catch (_) {}
    try { await loadContacts(); } catch (_) {}
    try { await loadConversations(); } catch (e) { toast(e.message, true); }
    const m = /#c=(\d+)/.exec(location.hash);
    if (m && S.convs.has(+m[1])) openConversation(+m[1]);
    pollLoop();
    refreshPresence();
    setInterval(() => { if (!uiVisible()) return; convEls.forEach((li, id) => { const c = S.convs.get(id); const t = $('.conv-last .t', li); if (t && c.last_message) t.textContent = '· ' + fmtShort(c.last_message.created_at); }); }, 60000);
  }
  function updateEditedReferences(source) {
    for (const st of S.msgs.values()) for (const m of st.list) if (+m.reply_to?.id === +source.id) {
      m.reply_to = { id: source.id, sender_id: source.sender_id, type: source.type, body: source.type === 'text' ? source.body : source.attachment?.name || 'Fișier', edited_at: source.edited_at, edited_revision: source.edited_revision, _dec: 1, _e2eFail: source._e2eFail };
      if (m.conversation_id === S.current) rerenderRow(m);
    }
    if (+S.replyTo?.id === +source.id) setReply(source);
  }
  TexConversationTools.init({ api, S, buzzCaption, prep, prepMany, E2E, convOf, nameOf, toast, openModal, closeModal, openConversation, jumpTo, decryptAtt, onEdited: m => handleEvent({ type: 'message_update', data: m }) });
  boot();
})();
