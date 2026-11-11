<?php
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
enforce_https();
security_headers();
start_session();
if (current_user_id() && get_user((int)current_user_id())) { header('Location: index.php'); exit; }
$cfg = app_config();
$v = '2.1.41';
?><!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="application-name" content="<?= h($cfg['app']['name']) ?>">
<meta name="description" content="Tex: chat în timp real">
<meta name="csrf-token" content="<?= h(csrf_token()) ?>">
<title>Conectare · <?= h($cfg['app']['name']) ?></title>
<link rel="icon" href="favicon.ico?v=2.1.33" sizes="any">
<link rel="icon" href="assets/img/favicon-32.png?v=<?= $v ?>" type="image/png" sizes="32x32">
<link rel="icon" href="assets/img/favicon-16.png?v=<?= $v ?>" type="image/png" sizes="16x16">
<link rel="icon" href="assets/img/favicon.svg?v=2.1.33" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=<?= $v ?>">
<link rel="manifest" href="manifest.webmanifest?v=2.1.33">
<script src="assets/js/mobile-viewport.js?v=<?= $v ?>"></script>
<meta name="theme-color" content="#04070d">
<link rel="stylesheet" href="assets/css/login.css?v=<?= $v ?>">
<script>(function(){try{var s=JSON.parse(localStorage.getItem('msgr.settings')||'{}');var m=s.mode||'light';if(m==='auto')m=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=m;}catch(e){}})();</script>
<link rel="stylesheet" href="assets/css/menu-emoji.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/recovery.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/legal.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/atelier-login.css?v=<?= $v ?>">
</head>
<body>
<div class="login-stage">
  <main class="card" id="card">
    <img class="logo" src="assets/img/logo-black.png?v=<?= $v ?>" alt="" width="96" height="96">
    <h1><?= h($cfg['app']['name']) ?></h1>
    <p class="sub">Pentru tine. Pentru prieteni.</p>

    <div class="tabs" role="tablist">
      <button class="tab active" data-tab="login" role="tab">Conectare</button>
      <button class="tab" data-tab="register" role="tab">Creează cont</button>
      <span class="tab-ink"></span>
    </div>

    <div class="forms">
      <form id="loginForm" class="form active" autocomplete="on">
        <label><span>Nume de utilizator (ID)</span><input name="login" required autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="ex. mihai_p" autofocus></label>
        <label><span>Parolă</span><input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn" type="submit"><span>Conectează-te</span></button><button id="forgotOpen" type="button" class="forgot-link">Ai uitat parola?</button>
      </form>
      <form id="registerForm" class="form" autocomplete="on">
        <label><span>Numele afișat</span><input name="display_name" maxlength="64" placeholder="ex. Mihai Popescu" autocomplete="name"></label>
        <label><span>ID-ul</span><input name="username" required pattern="[A-Za-z0-9_.]{3,32}" maxlength="32" placeholder="ex. mihai_p" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"></label>
        <label><span>Parola</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
        <label><span>Întrebarea ta de securitate</span><input name="security_question" minlength="5" maxlength="200" required autocomplete="off"></label>
        <label><span>Răspuns secret</span><input name="security_answer" type="password" minlength="5" maxlength="256" required autocomplete="off"></label>
        <p class="recovery-note">Alege un răspuns greu de ghicit. Majusculele și spațiile repetate se ignoră iar diacriticele și punctuația se păstrează. Această recuperare nu decriptează istoricul E2E.</p>
        <button class="btn" type="submit"><span>Creează cont</span></button>
      </form>
    </div>
    <div class="error" id="err" role="alert"></div>
  </main>
  <footer class="login-footer">
    <p>Făurit de<br>Sandor Laszlo, Bențe Mihai și Lăcătuș Răzvan</p>
    <a id="legalOpen" class="legal-link" href="#legalDialog" aria-haspopup="dialog" aria-controls="legalDialog" aria-expanded="false">Termeni, Condiții și Confidențialitate</a>
  </footer>
</div>
<section id="forgotDialog" class="forgot-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="forgotTitle" aria-describedby="forgotSecurityHelp">
  <div class="forgot-card">
    <header><h2 id="forgotTitle">Recuperarea parolei</h2><button id="forgotClose" type="button">Închide</button></header>
    <p class="recovery-note" id="forgotSecurityHelp">Întrebările de securitate oferă mai puțină protecție decât o metodă de verificare independentă. Recuperarea funcționează doar dacă ai configurat o întrebare; nu poți reseta parola prin e-mail.</p>
    <form id="forgotLookup">
      <h3>1. Contul tău</h3>
      <label for="forgotLogin">ID<input id="forgotLogin" required maxlength="190" autocomplete="username"></label>
      <button type="submit">Continuă</button>
    </form>
    <form id="forgotVerify" hidden>
      <h3>2. Întrebarea de securitate</h3>
      <div class="recovery-question"><span>Întrebarea ta</span><p id="forgotQuestion" aria-live="polite"></p></div>
      <label for="forgotAnswer">Răspunsul tău<input id="forgotAnswer" type="password" maxlength="256" autocomplete="off" required></label>
      <button type="submit">Verifică răspunsul</button>
    </form>
    <form id="forgotReset" hidden>
      <h3>3. Parola nouă</h3>
      <label for="forgotPassword">Parolă nouă<input id="forgotPassword" type="password" minlength="6" autocomplete="new-password" aria-describedby="forgotPasswordHelp" required></label>
      <p class="recovery-help" id="forgotPasswordHelp">Folosește o parolă puternică, personală..</p>
      <label for="forgotConfirm">Confirmă parola<input id="forgotConfirm" type="password" autocomplete="new-password" required></label>
      <p class="recovery-note" id="forgotE2EHelp">Atenție: resetarea schimbă doar parola de conectare. Cheia E2E rămâne criptată cu parola veche. Dispozitivele deja deblocate pot păstra accesul; fără cheia locală sau parola veche, istoricul criptat poate rămâne inaccesibil. Nu ștergem și nu înlocuim cheile.</p>
      <label class="recovery-ack" for="forgotAck"><input id="forgotAck" type="checkbox" required aria-describedby="forgotE2EHelp"><span>Am înțeles limitarea istoricului E2E.</span></label>
      <button type="submit">Resetează parola</button>
    </form>
    <p id="forgotError" role="alert" aria-live="assertive"></p>
  </div>
</section>

<?php define('TEX_LEGAL_INCLUDE', true); require __DIR__ . '/lib/legal-content.php'; ?>
<script src="assets/js/legal.js?v=<?= $v ?>"></script>
<script src="assets/js/e2e.js?v=<?= $v ?>"></script>
<script>
(function () {
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const tabs = document.querySelectorAll('.tab');
  const ink = document.querySelector('.tab-ink');
  const err = document.getElementById('err');
  function setTab(name) {
    tabs.forEach((t, i) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      if (on) ink.style.transform = `translateX(${i * 100}%)`;
    });
    document.querySelectorAll('.form').forEach(f => f.classList.toggle('active', f.id === name + 'Form'));
    err.textContent = ''; err.classList.remove('show');
    const first = document.querySelector('#' + name + 'Form input');
    setTimeout(() => first && first.focus(), 250);
  }
  tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
  if (location.hash === '#register') setTab('register');

  async function submit(form, action) {
    const btn = form.querySelector('.btn');
    btn.classList.add('loading'); btn.disabled = true;
    err.classList.remove('show');
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const r = await fetch('api/auth.php?action=' + action, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(data)
      });
      const j = await r.json().catch(() => ({ ok: false, error: 'Eroare server (' + r.status + ')' }));
      if (!j.ok) throw new Error(j.error || 'Eroare');
      const secret = form.querySelector('[name=security_answer]'); if (secret) secret.value = '';
      delete data.security_answer;
      // v2.0: deblochează / creează cheile E2E cu parola, cât timp e încă în formular (nu se trimite nicăieri în clar în afara HTTPS)
      if (window.E2E && j.user && data.password) { try { await Promise.race([E2E.afterLogin(j.user.id, data.password), new Promise(r => setTimeout(r, 15000))]); } catch (_) {} }
      document.getElementById('card').classList.add('leaving');
      setTimeout(() => location.href = 'index.php', 280);
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
      const card = document.getElementById('card');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      btn.classList.remove('loading'); btn.disabled = false;
    }
  }
  document.getElementById('loginForm').addEventListener('submit', e => { e.preventDefault(); submit(e.target, 'login'); });
  document.getElementById('registerForm').addEventListener('submit', e => { e.preventDefault(); submit(e.target, 'register'); });
})();
</script>
<script src="assets/js/recovery.js?v=<?= $v ?>"></script>
<script src="assets/js/menu-emoji.js?v=<?= $v ?>"></script>
</body>
</html>
