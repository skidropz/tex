<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
enforce_https();
security_headers();
start_session();
$uid = current_user_id();
$me = $uid ? get_user($uid) : null;
if (!$me) { header('Location: login.php'); exit; }
$cfg = app_config();
$v = '2.2.5' . (TEX_LOCAL_DEMO ? '.' . time() : ''); // local: cache nou la fiecare încărcare
$boot = [
    'me' => public_user($me) + ['email' => $me['email']],
    'settings' => $me['settings'] ? json_decode($me['settings'], true) : null,
    'csrf' => csrf_token(),
    'iceServers' => $cfg['ice_servers'],
    'chunkBytes' => (int)$cfg['app']['chunk_bytes'],
    'maxUpload' => (int)$cfg['app']['max_upload_bytes'],
    'appName' => $cfg['app']['name'],
    'v' => $v,
];
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
?><!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<script src="assets/js/mobile-viewport.js?v=<?= $v ?>"></script>
<meta name="theme-color" content="#f7f5f1">
<meta name="application-name" content="<?= h($cfg['app']['name']) ?>">
<meta name="apple-mobile-web-app-title" content="<?= h($cfg['app']['name']) ?>">
<meta name="description" content="Tex: chat în timp real">
<meta name="csrf-token" content="<?= h(csrf_token()) ?>">
<title><?= h($cfg['app']['name']) ?></title>
<link rel="icon" href="favicon.ico?v=2.1.40" sizes="any">
<link rel="icon" href="assets/img/favicon-32.png?v=<?= $v ?>" type="image/png" sizes="32x32">
<link rel="icon" href="assets/img/favicon-16.png?v=<?= $v ?>" type="image/png" sizes="16x16">
<link rel="icon" href="assets/img/icon-192.png?v=<?= $v ?>" type="image/png" sizes="192x192">
<link rel="icon" href="assets/img/favicon.svg?v=2.1.40" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?= $v ?>">
<link rel="manifest" href="manifest.webmanifest?v=2.1.40">
<link rel="stylesheet" href="assets/css/app.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/verified.css?v=<?= $v ?>-pt1">
<script>
  // aplică tema înainte de randare (fără flash)
  (function(){try{var s=JSON.parse(localStorage.getItem('msgr.settings.' + <?= (int)$uid ?>)||'null')||<?= json_encode($boot['settings']) ?>||{};var m=s.mode||'light';if(m==='auto')m=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=m;var W={liquidGlass:'light',liquidGlassDark:'dark',albastruNeon:'dark',noapte:'dark',aurora:'dark',apus:'dark',ocean:'dark',padure:'dark',neon:'dark',toxicpulse:'dark',lavanda:'light',retro:'light',ym:'light','ym-dark':'dark','ym-dark-blue':'dark','ym-dark-gray':'dark','ym-dark-green':'dark','ym-dark-teal':'dark','ym-dark-red':'dark','studio-hartie':'light','studio-cerneala':'dark','studio-lut':'light','studio-salvie':'light','studio-cobalt':'dark','studio-miere':'light','studio-prune':'dark','studio-ardezie':'dark','studio-menta':'light','studio-espresso':'dark','studio-atelier':'light','studio-harta':'light','studio-zen':'light','studio-ramura':'dark','studio-caramida':'light','studio-ploaie':'dark','studio-luna':'dark','studio-cupru':'dark','studio-tihna':'light','studio-fir':'dark','fx-nordice':'dark','fx-ninsoare':'dark','fx-licurici':'dark','fx-lava':'dark','fx-meteori':'dark','fx-valuri':'light','fx-rasarit':'light','fx-cod':'dark','fx-sakura':'light','fx-dune':'light','fx-ceata':'light','fx-prisma':'dark','fx-constelatii':'dark','fx-foc':'dark','fx-bule':'light','fx-nori':'light','fx-circuit':'dark','fx-toamna':'light','fx-lanterne':'dark','fx-furtuna':'dark'};if(s.wall&&W[s.wall]){document.documentElement.dataset.theme=W[s.wall];document.documentElement.classList.add('has-wall');document.documentElement.dataset.wall=s.wall;if(s.wall==='ym'||s.wall.indexOf('ym-dark')===0){document.documentElement.classList.add('theme-ym');if(s.wall.indexOf('ym-dark')===0)document.documentElement.classList.add('theme-ym-dark');}}else if((s.palette||'vorbitozaur')==='vorbitozaur')document.documentElement.classList.add('pal-vz');var sw=Math.min(screen.width||0,screen.height||0);if(innerWidth<=900||(sw>0&&sw<=520))document.documentElement.classList.add('mq-narrow');}catch(e){}})();
  window.APP = <?= json_encode($boot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP) ?>;
</script>
<link rel="stylesheet" href="assets/css/menu-emoji.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/recovery.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/mobile-performance.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/atelier.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/airy.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/ym-classic.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/liquid-glass.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/uniform.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/neon-glow.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/studio-wall.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/fx-themes.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/frosted.css?v=<?= $v ?>">
</head>
<body>

<div class="app" id="app">
  <!-- ============ SIDEBAR ============ -->
  <aside class="sidebar" id="sidebar">
    <header class="sb-head">
      <button class="avatar-btn" id="meAvatar" title="Profil și setări" hidden></button>
      <img class="sb-logo" src="assets/img/logo-black.png?v=<?= $v ?>" alt="">
      <h1 id="sidebarBrand">Tex</h1>
      <div class="sb-actions">
        <button class="icon-btn" id="btnSettings" title="Setări"><svg width="20" height="20" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.49.49 0 0 0 .12.64L4.57 11c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65a7.3 7.3 0 0 0 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65Z"/></svg></button>
        <button class="icon-btn" id="btnGroup" title="Grup nou"><svg width="20" height="20" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z"/></svg></button>
        <button class="icon-btn add-btn" id="btnNew" title="Adaugă contact nou (caută ID)"><svg width="20" height="20" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6Zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"/></svg><span class="add-lbl">Adaugă</span></button>
      </div>
    </header>
    <!-- profilul meu: avatar + nume + status (ca la Yahoo! Messenger) -->
    <div class="me-bar" id="meBar">
      <button class="avatar-btn" id="meBarAvatar" title="Profil, poză și setări"></button>
      <div class="me-info">
        <div class="me-name" id="meName"></div>
        <button class="me-status" id="meStatusBtn" title="Schimbă statusul"></button>
      </div>
    </div>
    <div class="sb-search">
      <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>
      <input id="search" type="text" inputmode="search" name="msgr_contact_filter" placeholder="Caută în contacte" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" readonly>
    </div>
    <button class="e2e-banner" id="e2eBanner" hidden><span></span><span id="e2eBannerText">Criptarea end-to-end este blocată</span><b>Deblochează</b></button>
    <div class="sb-scroll">
      <div id="searchResults" class="search-results" hidden></div>
      <ul id="convList" class="conv-list"></ul>
      <div id="convEmpty" class="conv-empty" hidden>
        <p>Încă nu ai conversații</p>
        <p class="muted">Adaugă un ID ca să începi o conversație</p>
      </div>
    </div>
  </aside>

  <!-- ============ CHAT ============ -->
  <main class="chat" id="chat">
    <div class="chat-empty" id="chatEmpty">
      <div class="logo-bubble"><img src="assets/img/logo-black.png?v=<?= $v ?>" alt=""></div>
      <h2>Conversațiile tale, într-un singur loc!</h2>
      <p class="muted">Alege o conversație sau adaugă un ID ca să începi</p>
    </div>
    <section class="thread" id="thread" hidden>
      <header class="th-head">
        <button class="icon-btn back-btn" id="btnBack" title="Înapoi"><svg viewBox="0 0 24 24"><path d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41Z"/></svg></button>
        <div class="th-peer" id="thPeer"></div>
        <div class="th-actions">
          <button class="icon-btn accent" id="btnMore" aria-haspopup="true" aria-controls="convMenu" aria-expanded="false" aria-label="Opțiuni conversație" title="Opțiuni conversație"><svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg></button>
        </div>
      </header>
      <div class="find-bar" id="findBar" hidden>
        <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z"/></svg>
        <input id="findInput" type="search" placeholder="Caută în conversație…" autocomplete="off" aria-label="Caută mesaje în conversație">
        <span class="find-count" id="findCount"></span>
        <button class="icon-btn small" id="findPrev" title="Mai vechi (Enter)"><svg viewBox="0 0 24 24"><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41Z"/></svg></button>
        <button class="icon-btn small" id="findNext" title="Mai noi (Shift+Enter)"><svg viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z"/></svg></button>
        <button class="btn ghost small" id="findDeep" hidden>Caută în tot istoricul</button>
        <button class="icon-btn small" id="findClose" title="Închide (Esc)"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button>
      </div>
      <section id="pinnedBar" class="pinned-bar" hidden aria-label="Mesaje fixate"><b id="pinnedCount"></b><div id="pinnedItems"></div></section>
      <div id="historyContext" class="history-context" hidden><span>Istoric în jurul mesajului selectat.</span><button id="historyLatest" class="btn ghost small">Revino la cele mai noi</button></div>
      <div class="contact-banner" id="contactBanner" hidden></div>
      <div class="messages-wrap">
        <div class="messages" id="messages">
          <div class="msg-loader" id="msgLoader"><span></span><span></span><span></span></div>
          <div class="msg-list" id="msgList"></div>
          <div class="typing-row" id="typingRow" aria-live="polite">
            <div class="avatar-slot"></div>
            <div class="typing-bubble"><span></span><span></span><span></span></div>
          </div>
        </div>
        <div id="messagesScrollIndicator" aria-hidden="true"></div>
        <button class="jump-btn" id="jumpBtn" hidden><svg viewBox="0 0 24 24"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z"/></svg><span id="jumpLabel"></span></button>
        <div class="drop-overlay" id="dropOverlay"><div><svg viewBox="0 0 24 24"><path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.99 5.99 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z"/></svg><p>Lasă fișierele aici</p><small>Pozele se trimit în calitate originală · Fișierele mari prin P2P</small></div></div>
      </div>
      <div class="reply-strip" id="replyStrip">
        <div class="reply-inner">
          <div class="reply-text"><b id="replyTitle"></b><span id="replySnippet"></span></div>
          <button class="icon-btn small" id="replyClose" title="Anulează"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button>
        </div>
      </div>
      <div id="contactGateNotice" class="contact-gate-notice" hidden>Ai ignorat acest contact. Mesajele directe sunt blocate. <button class="btn ghost small" id="contactGateInfo">Detalii contact</button></div>
      <footer class="composer" id="composer">
        <div class="cmp-left">
          <button class="icon-btn accent" id="btnAttach" title="Mai multe"><svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2Z"/></svg></button>
          <button class="icon-btn accent" id="btnImage" title="Trimite poze / video"><svg viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5Z"/></svg></button>
          <button class="icon-btn accent" id="btnP2P" title="Fișier P2P (fără limită de mărime)"><svg viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5Z"/></svg></button>
        </div>
        <div class="cmp-input">
          <textarea id="input" rows="1" placeholder="Aa" maxlength="10000"></textarea>
          <button class="icon-btn accent emo-btn" id="btnEmo" title="Emoticoane Yahoo! Messenger" aria-label="Emoticoane"><svg class="composer-smile" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8 14a4.5 4.5 0 0 0 8 0M8.5 9h.01M15.5 9h.01"/></svg></button>
        </div>
        <button class="icon-btn accent send-btn" id="btnSend" title="Trimite mesajul sau un BUZZ (Ctrl+G)" aria-label="Trimite mesajul sau un BUZZ">
          <span class="ic-like ic-buzz" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 3v13h8V5H8Zm4 14.2a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM2.5 7.5h1.6v9H2.5v-9Zm17.4 0h1.6v9h-1.6v-9ZM0 10h1.2v4H0v-4Zm22.8 0H24v4h-1.2v-4Z"/></svg><b>BUZZ!</b></span>
          <svg class="ic-send" viewBox="0 0 24 24"><path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a.99.99 0 0 0-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91Z"/></svg>
        </button>
        <input type="file" id="fileImage" accept="image/*,video/*" multiple hidden>
        <input type="file" id="fileServer" multiple hidden>
        <input type="file" id="fileP2P" multiple hidden>
      </footer>
    </section>
  </main>
</div>

<!-- Meniu atașare -->
<div class="popover attach-menu" id="attachMenu" hidden>
  <button data-act="image"><div><b>Poze și video</b><small>În calitate originală, stocate pe server</small></div></button>
  <button data-act="p2p"><div><b>Fișier P2P</b><small>Direct între voi, fără limită de mărime</small></div></button>
  <button data-act="server"><div><b>Fișier pe server</b><small>Se încarcă pe server și rămâne disponibil</small></div></button>
</div>

<!-- Status (ca la Yahoo! Messenger) -->
<div class="popover status-pop" id="statusPop" hidden>
  <div class="sp-types"><button data-st="available"><i class="sdot s-available"></i><span><b>Available</b><small>Apari online</small></span></button>
    <button data-st="busy"><i class="sdot s-busy"></i><span><b>DND</b><small>Nu deranja</small></span></button>
    <button data-st="away"><i class="sdot s-away"></i><span><b>Idle</b><small>Nu sunt la calculator</small></span></button>
    <button data-st="invisible"><i class="sdot s-invisible"></i><span><b>Invisible</b><small>Apari offline pentru ceilalți</small></span></button>
  </div>
  <label class="sp-msg"><span>Status</span><input id="statusText" maxlength="140" placeholder="Ce faci acum? (de exemplu, la o cafea)" autocomplete="off"></label>
  <button class="btn primary wide" id="statusSave">Salvează statusul</button>
  <button class="btn danger wide" id="statusLogout" type="button">Deconectare</button>
</div>

<!-- Panou emoticoane YM -->
<div class="popover emo-panel" id="emoPanel" hidden>
  <div class="emo-head"><b>Emoticoane</b><input id="emoFilter" type="search" placeholder="Caută…"></div>
  <div class="emo-grid" id="emoGrid"></div>
  <div class="emo-foot" id="emoFoot">Treci cursorul peste un emoticon ca să vezi scurtătura</div>
</div>

<!-- Zoom text conversație -->
<div class="popover zoom-pop" id="zoomPop" hidden>
  <div class="zp-head"><b>Zoom conversație</b><span class="zp-val" id="zoomVal">100%</span></div>
  <div class="zp-row">
    <button class="icon-btn small" id="zoomOut" title="Micșorează (Ctrl+Alt+-)">−</button>
    <input type="range" id="zoomRange" min="100" max="400" step="10" value="100" aria-label="Zoom conversație">
    <button class="icon-btn small" id="zoomIn" title="Mărește (Ctrl+Alt+=)">+</button>
  </div>
  <div class="zp-steps" id="zoomSteps"><button data-z="100">100%</button><button data-z="150">150%</button><button data-z="200">200%</button><button data-z="300">300%</button><button data-z="400">400%</button></div>
</div>


<!-- Meniu acțiuni (long-press pe mobil) -->
<div class="action-sheet" id="actionSheet" hidden>
  <div class="as-backdrop"></div>
  <div class="as-panel">
    <p id="asMetadata" class="as-metadata"></p>
    <button data-act="like">Îmi place 👍</button>
    <button data-act="pin">Fixează mesajul</button><button data-act="edit">Editează</button><button data-act="reply">Răspunde</button>
    <button data-act="copy">Copiază textul</button>
    <button data-act="close" class="as-cancel">Anulează</button>
  </div>
</div>

<!-- Lightbox poze -->
<div class="lightbox" id="lightbox" hidden>
  <div class="lb-top">
    <div class="lb-info" id="lbInfo"></div>
    <a class="icon-btn light" id="lbDownload" title="Descarcă originalul" download><svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7ZM5 18v2h14v-2H5Z"/></svg></a>
    <button class="icon-btn light" id="lbClose" title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button>
  </div>
  <div class="lb-stage" id="lbStage"><img id="lbImg" alt=""></div>
</div>

<!-- Dialog alegere mod trimitere fișiere -->
<div class="modal" id="sendChoice" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card small">
    <h3>Cum trimiți fișierele?</h3>
    <p class="muted" id="sendChoiceInfo"></p>
    <div class="choice-btns">
      <button class="btn primary" data-choice="p2p"> P2P direct <small>fără limită dar ambii conectați</small></button>
      <button class="btn" data-choice="server"> Pe server <small>rămâne disponibil oricând</small></button>
      <button class="btn ghost" data-choice="cancel">Anulează</button>
    </div>
  </div>
</div>

<!-- Private contact details: never profile edits. -->
<div class="modal" id="contactInfo" hidden role="dialog" aria-modal="true" aria-labelledby="ciTitle">
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <header class="modal-head"><h3 id="ciTitle" tabindex="-1">Informații contact</h3><button class="icon-btn" data-close aria-label="Închide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 4 6 6 6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6Z"/></svg></button></header>
    <div class="modal-body contact-info-body">
      <p id="ciLoading" class="muted" role="status">Se încarcă…</p>
      <p id="ciError" class="ci-error" role="alert" hidden></p>
      <div id="ciDetails" hidden>
        <section class="ci-section"><h4 id="ciName"></h4><p class="muted small" id="ciOriginal"></p><p class="verified-help" id="ciVerified" hidden>Tex Verified: bifă acordată contactelor care au donat și susțin platforma Tex.</p>
          <dl class="ci-facts"><div><dt>Cont creat</dt><dd id="ciCreated"></dd></div><div><dt>Vechimea contului</dt><dd id="ciAge"></dd></div><div><dt>Total mesaje păstrate · ambele sensuri</dt><dd id="ciCount"></dd></div></dl>
          <p class="muted small">Numărăm mesajele păstrate în conversațiile voastre 1:1, inclusiv fișiere și BUZZ. Nu includem grupurile sau evenimentele de sistem. Golirea locală nu scade totalul iar mesajele șterse definitiv nu mai pot fi numărate.</p>
        </section>
        <section class="ci-section" aria-labelledby="ciE2ETitle"><h4 id="ciE2ETitle">Criptare end-to-end</h4><p id="ciE2EStatus" role="status" aria-live="polite" aria-atomic="true">Se verifică starea E2E…</p><p id="ciE2EDetail" class="muted small"></p><div class="row-btns"><button class="btn ghost" type="button" id="ciE2ERefresh">Reverifică starea E2E</button><button class="btn primary" type="button" id="ciE2EUnlock" hidden>Deblochează E2E</button></div></section>
        <form id="ciAliasForm" class="ci-section"><h4>Numele apare doar pentru tine</h4><label class="field"><span>Alias privat (maximum 64 de caractere)</span><input id="ciAlias" maxlength="64" autocomplete="off" aria-describedby="ciAliasHelp"></label><p id="ciAliasHelp" class="muted small">Nu schimbă numele sau ID-ul contului. Contactul și ceilalți utilizatori nu văd acest alias.</p><div class="row-btns"><button class="btn primary" type="submit">Salvează numele</button><button class="btn ghost" type="button" id="ciResetAlias">Restabilește numele original</button></div></form>
        <section class="ci-section"><h4>Comunicare directă</h4><p id="ciIgnoreState" class="muted small"></p><p class="muted small">Dacă ignori un contact, mesajele directe, apelurile, BUZZ și transferurile noi sunt blocate în ambele sensuri. Istoricul și mesajele din grupurile comune rămân disponibile. Poți anula această alegere oricând.</p><button class="btn danger" type="button" id="ciIgnore">Ignoră contactul</button></section>
      </div>
    </div>
  </div>
</div>

<!-- Setări -->
<div class="modal" id="settings" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <header class="modal-head"><h3>Setări</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body">
      <section class="set-sec" id="adminSection" data-settings-category="account" <?= !empty($me['tex_is_admin']) ? '' : 'hidden' ?>><h4>Administrare</h4><p class="muted small">Administrare autorizată a marcajului Tex Verified, fără acces la conținutul conversațiilor.</p><a class="btn ghost" id="adminLink" href="admin.php">Deschide administrarea</a></section>
      <section class="set-sec">
        <h4>Profil</h4>
        <div class="profile-row">
          <div class="avatar xl" id="setAvatar"></div>
          <div class="grow">
            <label class="field"><span>Nume afișat</span><input id="setName" maxlength="64"></label>
            <div class="muted small">@<span id="setUsername"></span><span id="setIdentityBadges"></span><span id="setEmail"></span></div>
            <p class="verified-help" id="setVerified" hidden>Tex Verified: marcaj acordat de administratorii Tex conturilor care au donat și susțin platforma.</p>
          </div>
          <label class="color-dot" title="Culoare avatar (când nu ai poză)"><input type="color" id="setAvatarColor"></label>
        </div>
        <div class="row-btns avatar-btns">
          <button class="btn" id="btnAvatarUpload"> Încarcă poză de profil</button>
          <button class="btn ghost" id="btnAvatarRemove" hidden>Elimină poza</button>
          <input type="file" id="fileAvatar" accept="image/jpeg,image/png,image/gif,image/webp" hidden>
        </div>
        <div class="muted small">JPG, PNG sau WebP (decupate pătrat, 256×256) ori GIF animat, maximum 8 MB.</div>
      </section>
      <section class="set-sec">
        <h4>Mod</h4>
        <div class="segmented" id="modeSeg">
          <button data-mode="light"> Luminos</button>
          <button data-mode="dark"> Întunecat</button>
          <button data-mode="auto"> Automat</button>
        </div>
      </section>
      <section class="set-sec">
        <h4>Teme de conversație</h4>
        <div class="walls" id="walls"></div>
        <div class="muted small">O temă schimbă fundalul, culorile mesajelor și modul luminos sau întunecat. Temele Yahoo! Messenger păstrează lista clasică de contacte în partea dreaptă.</div>
      </section>
      <section class="set-sec">
        <h4>Palete de culori</h4>
        <div class="palettes" id="palettes"></div>
      </section>
      <section class="set-sec">
        <h4>Culori personalizate</h4>
        <div class="custom-colors" id="customColors">
          <label><input type="color" data-key="sent"><span>Bulă trimisă</span></label>
          <label><input type="color" data-key="sentText"><span>Text trimis</span></label>
          <label><input type="color" data-key="recv"><span>Bulă primită</span></label>
          <label><input type="color" data-key="recvText"><span>Text primit</span></label>
          <label><input type="color" data-key="bg"><span>Fundal chat</span></label>
          <label><input type="color" data-key="text"><span>Text general</span></label>
        </div>
        <label class="check"><input type="checkbox" id="setGradient"> Gradient pe bulele trimise</label>
        <div class="preview" id="preview">
          <div class="pv-row in"><div class="pv-b">Salut! Ce faci? :)</div></div>
          <div class="pv-row out"><div class="pv-b">Bine, tu? =))</div></div>
          <div class="pv-row out"><div class="pv-b">Uite noile culori!</div></div>
        </div>
        <div class="row-btns"><button class="btn ghost" id="btnResetColors">Resetează la paleta implicită</button></div>
      </section>
      <section class="set-sec">
        <h4>Mărimea textului din conversație</h4>
        <div class="zoom-set"><span>A</span><input type="range" id="setZoom" min="100" max="400" step="10" value="100" aria-label="Zoom conversație"><span class="big">A</span><b id="setZoomVal">100%</b></div>
        <div class="muted small">Mărește mesajele din conversație (pe mobil bara de scriere rămâne la mărimea normală): bule, poze, avatare, reacții, citate, ore, „scrie…”, butoane și câmpul de scriere. Lista de conversații rămâne la mărimea normală. Scurtături: Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0.</div>
      </section>
      <section class="set-sec">
        <h4>Notificări</h4>
        <label class="check"><input type="checkbox" id="setNotify"> Notificări desktop</label>
        <div class="muted small" id="notifyState"></div>
      </section>
      <section class="set-sec">
        <h4>Securitate și criptare</h4>
        <div class="kv"><span>Criptare end-to-end</span><b id="setE2EState">…</b></div>
        <div class="kv"><span>Amprenta cheii tale</span><code id="setE2EFp">—</code></div>
        <label class="check"><input type="checkbox" id="setE2EStrict" checked> Trimite doar criptat (blochează trimiterea dacă E2E nu este disponibil)</label>
        <div class="row-btns"><button class="btn primary" id="btnE2EUnlock" hidden>Deblochează</button><button class="btn ghost" id="btnE2EReset">Resetează cheile E2E</button></div>
        <div class="muted small">Mesajele text, fișierele încărcate pe server și detaliile transferurilor P2P sunt criptate în browser (ECDH P-256 și AES-256-GCM). Serverul nu poate citi conținutul, dar poate vedea participanții, momentul conversației, dimensiunea fișierelor, reacțiile și stările de prezență. Conexiunea este protejată prin HTTPS pe server și prin originea securizată localhost la testarea locală.</div>
      </section>
      <section class="set-sec recovery-section" data-settings-category="security">
        <h4>Recuperarea parolei</h4><p class="muted small" id="recoveryInfo" role="status" aria-live="polite"></p>
        <p class="muted small">Întrebările de securitate oferă mai puțină protecție decât metodele de verificare independente. Nu folosi un răspuns public sau ușor de ghicit. Recuperarea schimbă doar parola contului, nu decriptează istoricul E2E.</p>
        <form id="recoverySetup" autocomplete="off">
          <label class="field"><span>Întrebarea ta de securitate</span><input id="recoveryQuestion" name="question" minlength="5" maxlength="200" required autocomplete="off"></label>
          <label class="field"><span>Răspuns secret</span><input name="answer" type="password" minlength="4" maxlength="256" required autocomplete="off"></label>
          <p class="muted small">Nu diferențiem majusculele, spațiile de la capete și cele repetate se ignoră. Diacriticele și punctuația se păstrează.</p>
          <label class="field"><span>Parola curentă a contului</span><input name="current_password" type="password" required autocomplete="current-password"></label>
          <button class="btn primary" type="submit">Salvează recuperarea</button>
        </form>
      </section>
      <section class="set-sec">
        <h4>Alerte de prezență</h4>
        <label class="check"><input type="checkbox" id="setPresence"> Afișează alerte în colț pentru utilizatorii selectați (sunt oprite implicit)</label>
        <label class="field"><span>Caută utilizatorii pentru alerte</span><input id="presenceFilter" type="search" autocomplete="off"></label><div id="presenceUsers" class="pick-list"></div>
        <label class="check"><input type="checkbox" id="setPresenceSound"> Sunet la conectare și deconectare</label>
      </section>
      <section class="set-sec">
        <h4>Altele</h4>
        <label class="check"><input type="checkbox" id="setSound" checked> Sunet la mesaj nou</label>
        <label class="check"><input type="checkbox" id="setEnter" checked> Enter trimite mesajul (Shift+Enter = rând nou)</label>
        <label class="check"><input type="checkbox" id="setEmoAnim" checked> Convertește scurtăturile în emoticoane</label>
      </section>
      <section class="set-sec">
        <button class="btn danger wide" id="btnLogout">Deconectare</button>
        <div class="muted small app-ver"><?= h($cfg['app']['name']) ?> v<?= $v ?></div>
      </section>
    </div>
  </div>
</div>

<!-- v2.0: Adaugă contact -->
<div class="modal" id="addModal" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <header class="modal-head"><h3>Adaugă contact</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body">
      <label class="field"><span>Caută după nume sau ID</span><input id="addSearch" type="text" inputmode="search" name="msgr_add_user_filter" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" placeholder="ex. andrei"></label>
      <div class="add-results" id="addResults"></div>
      <div class="muted small">Apar doar ID-urile care nu sunt în lista ta.</div>
    </div>
  </div>
</div>

<!-- v2.0: Grup nou / adaugă membri -->
<div class="modal" id="groupModal" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <header class="modal-head"><h3 id="grpHead">Grup nou</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body">
      <label class="field" id="grpTitleRow"><span>Numele grupului (opțional)</span><input id="grpTitle" maxlength="80" placeholder="ex. Gașca de la liceu"></label>
      <input id="grpFilter" type="search" class="pick-filter" placeholder="Filtrează contactele…" autocomplete="off">
      <div class="pick-list" id="grpList"></div>
      <div class="modal-foot"><span class="muted small" id="grpCount"></span><button class="btn primary" id="grpCreate" disabled>Creează grupul</button></div>
    </div>
  </div>
</div>

<!-- v2.0: Info grup -->
<div class="modal" id="groupInfo" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <header class="modal-head"><h3>Detalii despre grup</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body">
      <div class="gi-top"><div id="giAvatar"></div><div class="grow"><label class="field"><span>Numele grupului</span><input id="giTitle" maxlength="80"></label><button class="btn small" id="giRename">Salvează numele</button></div></div>
      <h4 class="gi-h"><span id="giCount"></span><button class="btn ghost small" id="giAdd"> Adaugă membri</button></h4>
      <div class="pick-list" id="giMembers"></div>
      <div class="row-btns">
        <button class="btn ghost" id="giSafety"> Cod de siguranță</button>
        <button class="btn danger" id="giLeave"> Părăsește grupul</button>
        <button class="btn danger-solid" id="giDestroy">Șterge definitiv conversația</button>
      </div>
    </div>
  </div>
</div>

<!-- v2.0: Confirmare -->
<div class="modal" id="confirmModal" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card small">
    <h3 id="cfTitle"></h3>
    <div class="cf-text" id="cfText"></div>
    <div class="row-btns end"><button class="btn ghost" id="cfCancel">Anulează</button><button class="btn" id="cfOk">OK</button></div>
  </div>
</div>

<!-- v2.0: Cod de siguranță E2E -->
<div class="modal" id="safetyModal" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card small">
    <header class="modal-head"><h3> Cod de siguranță</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body"><div class="sf-code" id="sfCode"></div><p class="muted small" id="sfText"></p></div>
  </div>
</div>

<!-- v2.0: Deblocare E2E -->
<div class="modal" id="e2eModal" hidden>
  <div class="modal-backdrop"></div>
  <div class="modal-card small">
    <header class="modal-head"><h3 id="e2eTitle">Deblochează criptarea E2E</h3><button class="icon-btn" data-close title="Închide"><svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"/></svg></button></header>
    <div class="modal-body">
      <p class="small" id="e2eText"></p>
      <label class="field"><span>Parola cheii E2E (parola veche, dacă ai recuperat contul)</span><input id="e2ePw" type="password" autocomplete="current-password"></label>
      <div class="err small" id="e2eErr"></div>
      <div class="row-btns end"><button class="btn primary" id="e2eOk">Deblochează</button></div>
    </div>
  </div>
</div>

<!-- v2.0: meniu conversație -->
<div class="popover conv-menu" id="convMenu" hidden aria-label="Opțiuni conversație">
  <div id="convHeadActions"><div class="cm-category">Istoric</div><button id="btnGallery" data-head-action="gallery">Istoric fișiere</button><hr><div class="cm-category">Comunicare</div><button id="btnVideoCall" data-head-action>Apel video</button><button id="btnP2PHead" data-head-action>Trimite fișier P2P</button><hr><div class="cm-category">Afișare și căutare</div><button id="btnZoom" data-head-action>Zoom conversație</button><button id="btnTheme" data-head-action>Mod luminos / întunecat</button><button id="btnFind" data-head-action>Caută în conversație</button><hr></div>
  <div id="convMenuItems"></div>
</div>

<!-- v2.0: alerte de prezență (dreapta-jos, ca la Yahoo! Messenger) -->
<div class="presence-toasts" id="presenceToasts" aria-live="polite"></div>

<div class="modal" id="recoveryInvite" hidden role="dialog" aria-modal="true" aria-labelledby="recoveryInviteTitle"><div class="modal-backdrop"></div><div class="modal-card small"><h3 id="recoveryInviteTitle">Adaugă recuperarea parolei</h3><p>Contul tău nu are încă o întrebare de securitate. O poți configura acum sau din Setări → Securitate și recuperare.</p><p class="muted small">Nu recuperează cheile sau istoricul E2E. Alege un răspuns secret, greu de ghicit.</p><div class="row-btns"><button class="btn primary" id="recoveryConfigure">Configurează</button><button class="btn ghost" id="recoveryLater" data-close>Mai târziu</button></div></div></div>

<div class="modal" id="attachmentGallery" hidden role="dialog" aria-modal="true" aria-labelledby="galleryTitle"><div class="modal-backdrop"></div><div class="modal-card"><header class="modal-head"><h3 id="galleryTitle">Galeria atașamentelor</h3><button class="icon-btn" data-close title="Închide" aria-label="Închide">×</button></header><div class="modal-body"><label class="field">Categorie<select id="galleryFilter"><option value="all">Toate</option><option value="photos">Poze</option><option value="videos">Video</option><option value="files">Fișiere și audio</option></select></label><div id="galleryViewer"></div><p class="err" id="galleryError" role="alert"></p><div id="galleryItems"></div><button class="btn ghost" id="galleryMore">Încarcă mesajele mai vechi</button></div></div></div>
<div class="modal" id="messageEditor" hidden role="dialog" aria-modal="true" aria-labelledby="editTitle"><div class="modal-backdrop"></div><div class="modal-card"><header class="modal-head"><h3 id="editTitle">Editează mesajul</h3><button class="icon-btn" data-close title="Anulează" aria-label="Anulează">×</button></header><form id="editForm" class="modal-body"><label class="field"><span>Text</span><textarea id="editText" rows="7" maxlength="10000"></textarea></label><p class="muted small">Editarea nu schimbă ora trimiterii și nu înlocuiește fișierul. Enter păstrează rândul nou.</p><p id="editError" class="err" role="alert"></p><div class="row-btns"><button type="button" data-close class="btn ghost">Anulează</button><button id="editSave" type="submit" class="btn primary">Salvează</button></div></form></div></div>
<div class="toasts" id="toasts"></div>

<script src="assets/js/emoticons.js?v=<?= $v ?>"></script>
<script src="assets/js/preview-bytes.js?v=<?= $v ?>"></script>
<script src="assets/js/ro.js?v=<?= $v ?>"></script>
<script src="assets/js/e2e.js?v=<?= $v ?>"></script>
<script src="assets/js/downloads.js?v=<?= $v ?>"></script>
<script src="assets/js/p2p.js?v=<?= $v ?>"></script>
<script src="assets/js/videocall.js?v=<?= $v ?>"></script>
<script src="assets/js/presence-policy.js?v=<?= $v ?>"></script>
<script src="assets/js/settings-nav.js?v=<?= $v ?>"></script>
<script src="assets/js/gallery-previews.js?v=<?= $v ?>"></script>
<script src="assets/js/conversation-tools.js?v=<?= $v ?>"></script>
<script src="assets/js/app.js?v=<?= $v ?>-pt1"></script>
<script src="assets/js/sidebar-resize.js?v=<?= $v ?>"></script>
<script src="assets/js/liquid-glass.js?v=<?= $v ?>"></script>
<script src="assets/js/recovery.js?v=<?= $v ?>"></script>
<script src="assets/js/menu-emoji.js?v=<?= $v ?>"></script>
</body>
</html>
