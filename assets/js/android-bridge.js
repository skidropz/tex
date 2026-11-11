/* VORBITozaur Android bridge v2.1.6 — injectat la document-start (androidx.webkit) sau după onPageFinished.
   Nu necesită modificări pe server: leagă API-urile web folosite de app.js de window.AndroidBridge.
   - Android WebView NU are window.Notification => app.js nu trimitea notificări. Aici oferim un polyfill
     (permission = 'granted') care trimite titlu + text DEJA decriptat (plainBody din app.js) la notifyMessage.
   - BUZZ: notificare cu „ți-a dat BUZZ” / navigator.vibrate([..5 pași]) / poll.php type=buzz / toast → notifyBuzz.
   - Prezență: toast-urile .ym-toast din #presenceToasts → notifyPresence(connected|disconnected, nume).
   - v2.1.6 FCM: după login (APP.me există) → AndroidBridge.registerPushToken(csrf) (token FCM → api/fcm_register.php);
     la logout → token-ul e șters de pe server înainte de api/auth.php?action=logout. */
(function () {
  if (window.__vtAndroidBridgeInstalled) return;
  function hasBridge() {
    try { return !!(window.AndroidBridge && typeof AndroidBridge.notifyMessage === 'function'); }
    catch (_) { return false; }
  }
  if (!hasBridge()) return;
  window.__vtAndroidBridgeInstalled = true;

  function safe(fn) { try { return fn(); } catch (e) { try { console.warn('AndroidBridge', e); } catch (_) {} } }
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1).map(function (a) { return a == null ? '' : String(a); });
    return safe(function () { return AndroidBridge[name].apply(AndroidBridge, args); });
  }

  // 2.1.28: commit changed HttpOnly cookies BEFORE a subsequent request acknowledges rotation.
  // No cookie values/passwords cross the bridge. Older APKs keep their lifecycle flush fallback.
  safe(function () {
    if (!window.fetch || typeof AndroidBridge.persistSessionCookies !== 'function') return;
    var cookieFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      return cookieFetch(input, init).then(function (res) {
        safe(function () {
          if (new URL(res.url, location.href).origin === location.origin && res.headers.get('X-Tex-Session-Persist') === '1') AndroidBridge.persistSessionCookies();
        });
        return res;
      });
    };
  });

  var recent = {};
  function dedup(key, ms) {
    var now = Date.now();
    if (recent[key] && now - recent[key] < (ms || 2000)) return true;
    recent[key] = now;
    return false;
  }
  var lastBuzzAt = 0;
  function fireBuzz(who, msgId) {
    who = String(who || '').replace(/^📳\s*/, '').trim() || 'Cineva';
    if (Date.now() - lastBuzzAt < 3000) return; // o singură notificare + vibrație per BUZZ
    lastBuzzAt = Date.now();
    if (msgId != null && typeof AndroidBridge.notifyBuzzId === 'function') call('notifyBuzzId', msgId, who.split(/\s+/)[0]);
    else call('notifyBuzz', who.split(/\s+/)[0]);
  }
  function buzzNameFrom(text) {
    var m = String(text || '').match(/📳?\s*(.+?)\s*(ți|ti)-a dat (?:BUZZ|NIR !!!)/i);
    return m ? m[1].trim() : '';
  }
  function isBuzzText(t) { return /(?:BUZZ|NIR !!!)/i.test(String(t || '')) && /(ți|ti)-a dat/i.test(String(t || '')); }

  /* ---------- 1) Notification polyfill (sursa principală pentru mesaje primite) ---------- */
  function androidNotifAllowed() {
    try { return typeof AndroidBridge.notificationsEnabled !== 'function' || !!AndroidBridge.notificationsEnabled(); }
    catch (_) { return true; }
  }
  function VtNotification(title, opts) {
    opts = opts || {};
    var self = this;
    this.title = String(title == null ? '' : title);
    this.body = String(opts.body == null ? '' : opts.body);
    this.tag = opts.tag || '';
    this.data = opts.data;
    this.onclick = null; this.onclose = null; this.onshow = null; this.onerror = null;
    var full = this.title + ' ' + this.body;
    {
      if (isBuzzText(full)) {
        fireBuzz(buzzNameFrom(this.body) || this.title);
      } else if (!dedup('n:' + this.title + ':' + this.body, 1500)) {
        call('notifyMessage', this.title || 'Tex', this.body);
      }
    }
    setTimeout(function () { if (typeof self.onshow === 'function') safe(function () { self.onshow({ target: self }); }); }, 0);
  }
  VtNotification.prototype.close = function () {};
  VtNotification.prototype.addEventListener = function (type, fn) { this['on' + type] = fn; };
  VtNotification.prototype.removeEventListener = function () {};
  VtNotification.requestPermission = function (cb) {
    safe(function () { if (typeof AndroidBridge.requestNotificationPermission === 'function') AndroidBridge.requestNotificationPermission(); });
    var p = 'granted';
    if (typeof cb === 'function') safe(function () { cb(p); });
    return Promise.resolve(p);
  };
  try {
    Object.defineProperty(VtNotification, 'permission', {
      get: function () { return androidNotifAllowed() ? 'granted' : 'denied'; },
      configurable: true
    });
  } catch (_) { VtNotification.permission = 'granted'; }
  VtNotification.maxActions = 0;
  try {
    Object.defineProperty(window, 'Notification', { value: VtNotification, writable: true, configurable: true });
  } catch (_) { window.Notification = VtNotification; }

  /* ---------- 2) navigator.vibrate: pattern-ul BUZZ (5 pași) → vibrație nativă puternică ---------- */
  safe(function () {
    var ov = navigator.vibrate ? navigator.vibrate.bind(navigator) : null;
    navigator.vibrate = function (pattern) {
      var arr = Array.isArray(pattern) ? pattern : [pattern];
      if (arr.length >= 3) {
        // doBuzz() din app.js vibrează DOAR la BUZZ primit
        // app.js apelează notify() imediat după => lăsăm notifyBuzz (vibrează + notificare) să câștige;
        // dacă nu vine notificare (chat deschis/în față), doar vibrăm.
        setTimeout(function () {
          if (Date.now() - lastBuzzAt > 3000) { lastBuzzAt = Date.now(); call('vibrateBuzz'); }
        }, 350);
        return true;
      }
      try { return ov ? ov(pattern) : true; } catch (_) { return false; }
    };
  });

  /* ---------- 3) poll.php: rezervă pentru BUZZ (tipul e vizibil fără decriptare) ---------- */
  function myId() {
    try { if (window.APP && APP.me && APP.me.id != null) return +APP.me.id; } catch (_) {}
    try { if (window.APP && APP.user && APP.user.id != null) return +APP.user.id; } catch (_) {}
    return null;
  }
  function knownName(uid) {
    try {
      var av = document.querySelector('.ym-toast .avatar[data-uid="' + uid + '"], .conv .avatar[data-uid="' + uid + '"]');
      var row = av && av.closest('.conv, .ym-toast');
      var el = row && row.querySelector('.conv-name, b');
      if (el && el.textContent) return el.textContent.trim();
    } catch (_) {}
    return 'Cineva';
  }
  function onPoll(j) {
    if (!j || !Array.isArray(j.events)) return;
    var me = myId();
    j.events.forEach(function (ev) {
      var d = ev && ev.data;
      if (ev && ev.type === 'message' && d && d.id != null && (me == null || +d.sender_id !== me)) call('markNotified', d.id);
      if (!ev || ev.type !== 'message' || !d || d.type !== 'buzz') return;
      if (me != null && +d.sender_id === me) return;
      if (me == null && d.client_uid) return;
      setTimeout(function () { fireBuzz(knownName(d.sender_id), d.id); }, 1500);
    });
  }
  safe(function () {
    if (!window.fetch) return;
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var p = origFetch(input, init);
      if (!/api\/poll\.php/i.test(url) || /init=1/.test(url)) return p;
      return p.then(function (res) {
        // 2.1.30 app.js forwards its parsed payload. Retain the fallback for older servers.
        if (!window.__texAndroidPollDispatch) safe(function () { res.clone().json().then(onPoll).catch(function () {}); });
        return res;
      });
    };
  });

  /* ---------- 4) DOM: toast-uri de prezență + toast BUZZ ---------- */
  function onPresenceNode(n) {
    if (!n || n.nodeType !== 1 || !n.classList || !n.classList.contains('ym-toast')) return;
    var on = n.classList.contains('on');
    var b = n.querySelector('b');
    var name = b ? (b.textContent || '').trim() : 'Contact';
    if (dedup((on ? 'on:' : 'off:') + name, 4000)) return;
    call('notifyPresence', on ? 'connected' : 'disconnected', name);
  }
  function onToastNode(n) {
    if (!n || n.nodeType !== 1) return;
    var t = n.textContent || '';
    if (isBuzzText(t)) fireBuzz(buzzNameFrom(t));
  }
  function watch(id, handler) {
    var box = document.getElementById(id);
    if (!box || box.__vtObserved) return !!box;
    box.__vtObserved = true;
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes || [];
        for (var k = 0; k < added.length; k++) handler(added[k]);
      }
    }).observe(box, { childList: true });
    return true;
  }
  function boot() {
    var a = watch('presenceToasts', onPresenceNode);
    var b = watch('toasts', onToastNode);
    return a && b;
  }
  if (!boot() && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });

  /* ---------- 5) v2.1.6: push FCM — înregistrare după login, ștergere la logout ---------- */
  function csrfToken() {
    try { if (window.APP && APP.csrf) return String(APP.csrf); } catch (_) {}
    try { var m = document.querySelector('meta[name="csrf-token"]'); if (m) return m.getAttribute('content') || ''; } catch (_) {}
    return '';
  }
  var pushRegisteredFor = null, pushAttemptAt = 0;
  function tryRegisterPush() {
    if (typeof AndroidBridge.registerPushToken !== 'function') return true;
    var me = myId();
    if (me == null) return false;
    var now = Date.now(), active = safe(function () { return typeof AndroidBridge.pushActive === 'function' && AndroidBridge.pushActive(); });
    if (pushRegisteredFor === me && now - pushAttemptAt < (active ? 900000 : 30000)) return true;
    pushRegisteredFor = me; pushAttemptAt = now;
    call('registerPushToken', csrfToken());
    return true;
  }
  if (!tryRegisterPush() && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryRegisterPush, { once: true });
  // Resume does not need another network registration if the same account/token is active.
  // Native onNewToken still handles token rotation; account changes/logout invalidate this guard.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && myId() != null) { tryRegisterPush(); }
  });
  safe(function () {
    if (!window.fetch) return;
    var f2 = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/api\/auth\.php\?action=logout/i.test(url) && typeof AndroidBridge.pushToken === 'function') {
        var tok = safe(function () { return AndroidBridge.pushToken(); }) || '';
        pushRegisteredFor = null;
        if (!tok) return f2(input, init);
        var unreg = f2('api/fcm_register.php', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
          body: JSON.stringify({ token: tok, platform: 'android', delete: true })
        }).catch(function () {});
        return unreg.then(function () { call('pushLoggedOut'); return f2(input, init); });
      }
      return f2(input, init);
    };
  });

  window.VORBITozaurAndroid = {
    version: safe(function () { return AndroidBridge.appVersion(); }) || '',
    onPoll: function (j) { safe(function () { onPoll(j); }); },
    notifyMessage: function (title, body) { call('notifyMessage', title, body); },
    notifyPresence: function (state, name) { call('notifyPresence', state, name); },
    notifyBuzz: function (name) { fireBuzz(name); },
    registerPush: function () { tryRegisterPush(); },
    vibrateBuzz: function () { call('vibrateBuzz'); }
  };
})();
