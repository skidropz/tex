<?php
declare(strict_types=1);
require __DIR__.'/lib/bootstrap.php';
enforce_https(); security_headers(); header('Cache-Control: no-store'); start_session();
$uid=current_user_id();
if (!$uid) { header('Location: login.php'); exit; }
if (!tex_is_admin($uid)) { http_response_code(403); header('Content-Type: text/plain; charset=utf-8'); exit('Acces nepermis.'); }
$me=get_user($uid); if (!$me) { http_response_code(403); exit; }
$settings=json_decode((string)($me['settings'] ?? ''),true); $mode=$settings['mode'] ?? 'dark';
if (!in_array($mode,['dark','light','auto'],true)) $mode='dark';
$v='2.1.35';
?><!DOCTYPE html>
<html lang="ro" data-theme="<?= h($mode==='light'?'light':'dark') ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="csrf-token" content="<?= h(csrf_token()) ?>">
<meta name="robots" content="noindex,nofollow">
<title>Administrare · Tex</title>
<link rel="icon" href="favicon.ico?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/login.css?v=<?= $v ?>">
<link rel="stylesheet" href="assets/css/verified.css?v=<?= $v ?>-pt1">
<link rel="stylesheet" href="assets/css/admin.css?v=<?= $v ?>">
<?php if ($mode==='auto'): ?><script>document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';</script><?php endif; ?>
<script src="assets/js/mobile-viewport.js?v=<?= $v ?>"></script>
<script src="assets/js/admin.js?v=<?= $v ?>-pt1" defer></script>
</head>
<body class="admin-page" data-admin-user="<?= (int)$uid ?>">
<main class="admin-shell">
  <header class="admin-head"><div><h1>Administrare Tex</h1><p>Conectat ca @<?= h((string)$me['username']) ?></p></div><a class="admin-back" href="index.php">Înapoi la conversații</a></header>
  <section class="admin-panel" aria-labelledby="adminAccountsTitle">
    <h2 id="adminAccountsTitle">Conturi, bifă și etichete vizuale</h2>
    <p class="admin-note">„Tex Verified” înseamnă un marcaj acordat de administratorii Tex. Nu reprezintă verificarea independentă a identității, o certificare sau afiliere cu alt serviciu. Bifa și etichetele vizuale ADMIN/MOD/PRODUCT TESTER sunt independente. Etichetele sunt publice, nu acordă drepturi de administrare sau moderare. Atribuirea, schimbarea și eliminarea lor sunt înregistrate în jurnal, la fel ca bifa. Acest panou nu acordă roluri de administrator și nu oferă acces la mesaje, parole sau chei.</p>
    <form id="adminSearch" class="admin-search" role="search"><label for="adminQuery">Caută după nume sau nume de utilizator<input id="adminQuery" type="search" maxlength="64" autocomplete="off"></label><button type="submit">Caută</button></form>
    <p id="adminError" class="admin-error" role="alert" hidden></p>
    <p id="adminStatus" class="admin-status" role="status" aria-live="polite"></p>
    <ul id="adminUsers" class="admin-users" aria-label="Conturi"></ul>
    <div class="admin-pages"><button id="adminNext" type="button" hidden>Pagina următoare</button><a href="login.php">Pagina de conectare</a></div>
  </section>
  <section class="admin-panel" aria-labelledby="adminAuditTitle"><div class="admin-audit-head"><h2 id="adminAuditTitle">Ultimele modificări</h2><button id="adminAuditRefresh" type="button">Actualizează jurnalul</button></div><p class="admin-note">Maximum 30 de evenimente recente. Ore: Europe/Bucharest. Jurnalul păstrează administratorul, contul vizat, acțiunea și momentul, nu conținutul conversațiilor.</p><ul id="adminAudit" class="admin-audit" aria-label="Jurnal administrare"></ul></section>
</main>
</body>
</html>
