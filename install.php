<?php
declare(strict_types=1);
/**
 * Installer web: testează conexiunea MySQL, scrie config/config.php și creează tabelele.
 * După instalare se creează data/installed.lock și installerul se blochează.
 * (Recomandat: șterge install.php după instalare.)
 */
require __DIR__ . '/lib/bootstrap.php';
start_session();
$lock = DATA_DIR . '/installed.lock';
$msg = ''; $ok = false; $err = '';

function checks(): array {
    return [
        'PHP >= 8.0' => version_compare(PHP_VERSION, '8.0.0', '>='),
        'Extensie PDO MySQL' => extension_loaded('pdo_mysql'),
        'Extensie PDO SQLite (opțional, demo)' => extension_loaded('pdo_sqlite'),
        'Extensie fileinfo (MIME corect)' => extension_loaded('fileinfo'),
        'Extensie mbstring' => extension_loaded('mbstring'),
        'uploads/ poate fi scris' => is_writable(UPLOAD_DIR),
        'data/ poate fi scris' => is_writable(DATA_DIR),
        'config/ poate fi scris (pentru a salva config.php)' => is_writable(APP_ROOT . '/config'),
    ];
}

if (is_file($lock)) {
    $msg = 'Aplicația este deja instalată. Pentru reinstalare șterge fișierul data/installed.lock (din File Manager).';
} elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!hash_equals(csrf_token(), (string)($_POST['csrf'] ?? ''))) { $err = 'Sesiunea de securitate a expirat, reîncarcă pagina.'; }
    else {
        $driver = ($_POST['driver'] ?? 'mysql') === 'sqlite' ? 'sqlite' : 'mysql';
        $db = [
            'driver' => $driver,
            'host' => trim((string)($_POST['host'] ?? 'localhost')),
            'port' => (int)($_POST['port'] ?? 3306) ?: 3306,
            'name' => trim((string)($_POST['name'] ?? '')),
            'user' => trim((string)($_POST['user'] ?? '')),
            'pass' => (string)($_POST['pass'] ?? ''),
            'charset' => 'utf8mb4',
        ];
        try {
            if ($driver === 'mysql') {
                $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'], $db['port'], $db['name']), $db['user'], $db['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $sql = file_get_contents(APP_ROOT . '/sql/schema.sql');
                $sql = preg_replace('/^--.*$/m', '', $sql);
                foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) $pdo->exec($stmt);
            } else {
                $pdo = new PDO('sqlite:' . DATA_DIR . '/messenger.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                $pdo->exec(file_get_contents(APP_ROOT . '/sql/schema.sqlite.sql'));
            }
            $config = [
                'db' => $driver === 'mysql' ? $db : ['driver' => 'sqlite'],
                'app' => ['name' => mb_substr(trim((string)($_POST['app_name'] ?? 'Tex')) ?: 'Tex', 0, 40), 'poll_timeout' => 20, 'max_upload_bytes' => 0, 'chunk_bytes' => 2097152, 'secure_cookies' => null],
                'ice_servers' => [['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']]],
            ];
            $php = "<?php\n// Generat de install.php la " . date('c') . "\nreturn " . var_export($config, true) . ";\n";
            if ($driver === 'sqlite') $php = str_replace("'driver' => 'sqlite',", "'driver' => 'sqlite', 'sqlite_path' => __DIR__ . '/../data/messenger.sqlite',", $php);
            if (@file_put_contents(APP_ROOT . '/config/config.php', $php) === false) {
                $err = 'Tabelele au fost create, dar nu am putut scrie config/config.php. Copiază manual config.example.php ca config.php și completează datele.';
            } else {
                @chmod(APP_ROOT . '/config/config.php', 0640);
                @file_put_contents($lock, date('c'));
                $ok = true;
                $msg = 'Instalare reușită! Tabelele au fost create și config/config.php a fost salvat.';
            }
        } catch (Throwable $e) {
            $err = 'Eroare: ' . $e->getMessage();
        }
    }
}
?><!DOCTYPE html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instalare Tex</title>
<link rel="icon" href="favicon.ico?v=2.1.33" sizes="any">
<link rel="icon" href="assets/img/favicon-32.png?v=2.1.33" type="image/png" sizes="32x32"><link rel="icon" href="assets/img/favicon.svg?v=2.1.33" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png?v=2.1.33"><meta name="theme-color" content="#04070d">
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:radial-gradient(circle at 50% 0,#0b2a66,#04070d 60%);min-height:100vh;margin:0;padding:30px 14px;color:#050505}
.inst-logo{display:block;width:96px;height:96px;margin:0 auto 10px;filter:brightness(0)}
.card{max-width:560px;margin:auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.1)}
h1{margin:0 0 6px;font-size:24px}p{color:#65676b}
label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}
input,select{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid #ccd0d5;font-size:15px}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:linear-gradient(135deg,#3cb4ff,#1a73ff 55%,#0b3fd1);color:#fff;font-weight:700;font-size:16px;cursor:pointer}
.ok{background:#e7f7ec;color:#11772f;padding:12px;border-radius:10px}.err{background:#fde8ea;color:#b3132c;padding:12px;border-radius:10px;word-break:break-word}
ul{padding-left:18px}li{margin:3px 0}.y{color:#11772f}.n{color:#b3132c}
.row{display:grid;grid-template-columns:2fr 1fr;gap:10px}
a.btn{display:block;text-align:center;margin-top:16px;padding:13px;border-radius:10px;background:#0084ff;color:#fff;text-decoration:none;font-weight:700}
</style><script src="assets/js/mobile-viewport.js?v=2.1.33"></script></head><body><div class="card">
<img class="inst-logo" src="assets/img/logo.png?v=2.1.33" alt="">
<h1>⚙️ Instalare Tex</h1>
<p>Completează datele bazei de date MySQL create în cPanel (MySQL® Databases).</p>
<?php if ($msg): ?><div class="<?= $ok ? 'ok' : 'err' ?>"><?= h($msg) ?></div><?php endif; ?>
<?php if ($err): ?><div class="err"><?= h($err) ?></div><?php endif; ?>
<?php if ($ok): ?>
  <p><b>Important:</b> din motive de securitate, șterge acum fișierul <code>install.php</code> din File Manager.</p>
  <a class="btn" href="login.php">Deschide aplicația →</a>
<?php elseif (!is_file($lock)): ?>
<h3>Verificări server</h3><ul>
<?php foreach (checks() as $k => $v): ?><li class="<?= $v ? 'y' : 'n' ?>"><?= $v ? '✔' : '✘' ?> <?= h($k) ?></li><?php endforeach; ?>
</ul>
<form method="post">
  <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
  <label>Tip bază de date</label>
  <select name="driver" onchange="document.getElementById('my').style.display=this.value==='mysql'?'':'none'">
    <option value="mysql">MySQL / MariaDB (recomandat pe cPanel)</option>
    <option value="sqlite">SQLite (doar demo / trafic mic)</option>
  </select>
  <div id="my">
    <div class="row"><div><label>Host</label><input name="host" value="localhost"></div><div><label>Port</label><input name="port" value="3306"></div></div>
    <label>Nume bază de date (ex. cpaneluser_messenger)</label><input name="name" placeholder="cpaneluser_messenger">
    <label>Utilizator MySQL</label><input name="user" placeholder="cpaneluser_msguser">
    <label>Parolă MySQL</label><input name="pass" type="password">
  </div>
  <label>Numele aplicației</label><input name="app_name" value="Tex">
  <button type="submit">Instalează</button>
</form>
<?php endif; ?>
</div></body></html>
