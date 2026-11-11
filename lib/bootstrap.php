<?php
declare(strict_types=1);

/**
 * VORBITozaur — bootstrap comun: config, DB (MySQL sau SQLite fallback), sesiune, CSRF, helpers.
 */

define('APP_ROOT', dirname(__DIR__));
// Demo-ul pornește explicit cu TEX_LOCAL_DEMO=1; datele și încărcările lui sunt izolate.
// Configurația cPanel și baza de producție nu sunt citite sau modificate în acest mod.
define('TEX_LOCAL_DEMO', PHP_SAPI === 'cli-server' && getenv('TEX_LOCAL_DEMO') === '1');
define('UPLOAD_DIR', APP_ROOT . '/uploads' . (TEX_LOCAL_DEMO ? '/local-demo' : ''));
define('DATA_DIR', APP_ROOT . '/data' . (TEX_LOCAL_DEMO ? '/local-demo' : ''));

require_once __DIR__ . '/release217.php';
require_once __DIR__ . '/device-auth.php';
require_once __DIR__ . '/recovery.php';
require_once __DIR__ . '/presence.php';
require_once __DIR__ . '/contact-info.php';
require_once __DIR__ . '/admin.php';
require_once __DIR__ . '/fcm.php'; // v2.1.6: push FCM (Android)
require_once __DIR__ . '/apns.php';

// erori neprinse: le scriem în log-ul PHP și răspundem cu JSON curat (fără detalii interne)
set_exception_handler(function (Throwable $e): void {
    error_log('[app] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine() . ' ' . ($_SERVER['REQUEST_URI'] ?? ''));
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['ok' => false, 'error' => 'Eroare de server. Încearcă din nou.']);
});

error_reporting(E_ALL);
ini_set('display_errors', '0');

function app_config(): array
{
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $default = [
        'db' => ['driver' => 'sqlite', 'sqlite_path' => DATA_DIR . '/messenger.sqlite', 'charset' => 'utf8mb4', 'port' => 3306],
        'app' => ['name' => 'Tex', 'poll_timeout' => 20, 'max_upload_bytes' => 0, 'chunk_bytes' => 2 * 1024 * 1024, 'secure_cookies' => null, 'force_https' => true, 'hsts' => true],
        'ice_servers' => [['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']]],
    ];
    $file = APP_ROOT . '/config/config.php';
    $user = !TEX_LOCAL_DEMO && is_file($file) ? (require $file) : [];
    if (!is_array($user)) $user = [];
    if (TEX_LOCAL_DEMO) {
        $default['app']['force_https'] = false;
        $default['app']['hsts'] = false;
        $default['app']['secure_cookies'] = false;
    }
    $cfg = $default;
    foreach ($user as $k => $v) {
        $cfg[$k] = (is_array($v) && isset($default[$k]) && $k !== 'ice_servers') ? array_merge($default[$k], $v) : $v;
    }
    // v1.7: aplicația se numește acum simplu „VORBITozaur” — și pentru config.php-urile vechi
    // generate de install.php cu „VORBITozaur 1.0” (nu trebuie editat config-ul de pe server).
    if (isset($cfg['app']['name']) && preg_match('/^\s*VORBITozaur\s+v?1\.0\s*$/iu', (string)$cfg['app']['name'])) $cfg['app']['name'] = 'VORBITozaur';
    // v2.1.16: presentation name, without rewriting the deployed configuration.
    $cfg['app']['name'] = 'Tex';
    if (TEX_LOCAL_DEMO) $cfg['fcm'] = ['enabled' => false, 'presence' => false];
    $cfg['_has_config'] = !TEX_LOCAL_DEMO && is_file($file);
    return $cfg;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = app_config()['db'];
    $opts = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    if (($c['driver'] ?? 'sqlite') === 'mysql') {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $c['host'], (int)($c['port'] ?? 3306), $c['name'], $c['charset'] ?? 'utf8mb4');
        $pdo = new PDO($dsn, $c['user'], $c['pass'], $opts);
        $pdo->exec("SET time_zone = '+00:00'");
    } else {
        $path = $c['sqlite_path'] ?? (DATA_DIR . '/messenger.sqlite');
        $new = !is_file($path);
        if (!is_dir(dirname($path))) @mkdir(dirname($path), 0775, true);
        $pdo = new PDO('sqlite:' . $path, null, null, $opts);
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
        $pdo->exec('PRAGMA foreign_keys = OFF');
        // LOWER() din SQLite știe doar ASCII → îl înlocuim cu varianta Unicode (ă, î, ș, ț...), ca în MySQL
        if (method_exists($pdo, 'sqliteCreateFunction')) {
            @$pdo->sqliteCreateFunction('lower', fn($s) => $s === null ? null : mb_strtolower((string)$s, 'UTF-8'), 1);
        }
        if ($new || !sqlite_has_tables($pdo)) {
            $pdo->exec(file_get_contents(APP_ROOT . '/sql/schema.sqlite.sql'));
        }
    }
    migrate_email_optional($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    migrate_profile_columns($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    migrate_v2($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    migrate_fcm($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    migrate_release217($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    migrate_device_auth($pdo, ($c['driver'] ?? 'sqlite') === 'mysql');
    if (($c['driver'] ?? 'sqlite') !== 'mysql') {
        $pdo->exec("CREATE TABLE IF NOT EXISTS contact_preferences (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, alias TEXT NOT NULL DEFAULT '', ignored INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,contact_id));
CREATE INDEX IF NOT EXISTS idx_contact_preferences_reverse ON contact_preferences(contact_id,user_id);

-- Admin roles are never seeded by installation or an HTTP request.
CREATE TABLE IF NOT EXISTS account_flags (user_id INTEGER NOT NULL PRIMARY KEY, is_admin INTEGER NOT NULL DEFAULT 0, is_verified INTEGER NOT NULL DEFAULT 0, verified_by INTEGER NULL, verified_at BIGINT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL, target_id INTEGER NOT NULL, action TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_id,id);
-- Display labels never authorize access and are not automatically assigned.
CREATE TABLE IF NOT EXISTS account_display_labels (user_id INTEGER NOT NULL PRIMARY KEY, label TEXT NOT NULL DEFAULT '' CHECK(label IN ('','ADMIN','MOD','TESTER')), updated_by INTEGER NULL, updated_at BIGINT NOT NULL);

");
    }
    return $pdo;
}

/**
 * Migrare automată (o singură dată): coloana users.email devine opțională (NULL),
 * ca să se poată crea conturi doar cu username + parolă. Conturile existente
 * (și emailurile lor) rămân neatinse.
 */
function migrate_email_optional(PDO $pdo, bool $mysql): void
{
    $flag = DATA_DIR . '/schema-email-optional.lock';
    if (is_file($flag)) return;
    try {
        if ($mysql) {
            $st = $pdo->query("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'");
            $nullable = $st->fetchColumn();
            if ($nullable === 'NO') {
                $pdo->exec('ALTER TABLE users MODIFY email VARCHAR(190) NULL DEFAULT NULL');
            }
        } else {
            if (!sqlite_has_tables($pdo)) return;
            $notnull = null;
            foreach ($pdo->query('PRAGMA table_info(users)') as $col) {
                if (strtolower($col['name']) === 'email') $notnull = (int)$col['notnull'];
            }
            if ($notnull === 1) {
                $cols = [];
                foreach ($pdo->query('PRAGMA table_info(users)') as $col) $cols[] = '"' . str_replace('"', '""', $col['name']) . '"';
                $list = implode(', ', $cols);
                $idx = $pdo->query("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL")->fetchAll(PDO::FETCH_COLUMN);
                $create = (string)$pdo->query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")->fetchColumn();
                $newCreate = preg_replace('/(\bemail\s+TEXT\s+)NOT\s+NULL/i', '$1NULL', $create, 1);
                $newCreate = preg_replace('/^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["`]?users["`]?/i', 'CREATE TABLE users__new', $newCreate, 1);
                $pdo->exec('BEGIN IMMEDIATE');
                try {
                    $pdo->exec($newCreate);
                    $pdo->exec("INSERT INTO users__new ($list) SELECT $list FROM users");
                    $pdo->exec('DROP TABLE users');
                    $pdo->exec('ALTER TABLE users__new RENAME TO users');
                    foreach ($idx as $sql) $pdo->exec($sql);
                    $pdo->exec('COMMIT');
                } catch (Throwable $e) {
                    $pdo->exec('ROLLBACK');
                    throw $e;
                }
            }
        }
        @file_put_contents($flag, date('c'));
    } catch (Throwable $e) {
        error_log('migrate_email_optional: ' . $e->getMessage());
    }
}

/**
 * Migrare automată (o singură dată): avatar (poză) + status tip Yahoo! Messenger.
 * Adaugă coloanele lipsă în users; datele existente rămân neatinse.
 */
function migrate_profile_columns(PDO $pdo, bool $mysql): void
{
    $flag = DATA_DIR . '/schema-profile.lock';
    if (is_file($flag)) return;
    try {
        if (!$mysql && !sqlite_has_tables($pdo)) return;
        $have = [];
        if ($mysql) {
            foreach ($pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'") as $r) $have[strtolower($r['COLUMN_NAME'])] = true;
        } else {
            foreach ($pdo->query('PRAGMA table_info(users)') as $col) $have[strtolower($col['name'])] = true;
        }
        $add = $mysql ? [
            'avatar_path' => 'ALTER TABLE users ADD COLUMN avatar_path VARCHAR(255) NULL DEFAULT NULL',
            'status_type' => "ALTER TABLE users ADD COLUMN status_type VARCHAR(16) NOT NULL DEFAULT 'available'",
            'status_text' => 'ALTER TABLE users ADD COLUMN status_text VARCHAR(140) NULL DEFAULT NULL',
        ] : [
            'avatar_path' => 'ALTER TABLE users ADD COLUMN avatar_path TEXT NULL',
            'status_type' => "ALTER TABLE users ADD COLUMN status_type TEXT NOT NULL DEFAULT 'available'",
            'status_text' => 'ALTER TABLE users ADD COLUMN status_text TEXT NULL',
        ];
        foreach ($add as $col => $sql) if (empty($have[$col])) $pdo->exec($sql);
        if (is_dir(DATA_DIR)) @file_put_contents($flag, date('c'));
    } catch (Throwable $e) {
        error_log('migrate_profile_columns: ' . $e->getMessage());
    }
}

/**
 * Migrare automată v2.0.0 (o singură dată, sigură: doar CREATE TABLE IF NOT EXISTS / ADD COLUMN):
 *  - contacts: lista de contacte (separată de căutarea globală)
 *  - user_keys: cheia publică E2E + cheia privată CRIPTATĂ cu parola (serverul nu o poate citi)
 *  - conversation_keys: cheia de grup împachetată (wrapped) pentru fiecare membru
 *  - conversations.created_by / key_version, conversation_members.cleared_id / hidden
 * Contactele existente sunt reconstruite din conversațiile 1:1 existente (nimic nu se șterge).
 */
function migrate_v2(PDO $pdo, bool $mysql): void
{
    $flag = DATA_DIR . '/schema-v2.lock';
    if (is_file($flag)) return;
    try {
        if (!$mysql && !sqlite_has_tables($pdo)) return;
        if ($mysql) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS contacts (
                user_id INT UNSIGNED NOT NULL, contact_id INT UNSIGNED NOT NULL, created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (user_id, contact_id), KEY idx_ct_contact (contact_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            $pdo->exec("CREATE TABLE IF NOT EXISTS user_keys (
                user_id INT UNSIGNED NOT NULL PRIMARY KEY, pub_jwk TEXT NOT NULL, enc_priv TEXT NOT NULL,
                kdf_salt VARCHAR(64) NOT NULL, kdf_iter INT UNSIGNED NOT NULL DEFAULT 310000, iv VARCHAR(64) NOT NULL,
                fingerprint VARCHAR(80) NOT NULL, created_at INT UNSIGNED NOT NULL, updated_at INT UNSIGNED NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
            $pdo->exec("CREATE TABLE IF NOT EXISTS conversation_keys (
                conversation_id INT UNSIGNED NOT NULL, key_version INT UNSIGNED NOT NULL, user_id INT UNSIGNED NOT NULL,
                wrapped TEXT NOT NULL, wrapped_by INT UNSIGNED NOT NULL, created_at INT UNSIGNED NOT NULL,
                PRIMARY KEY (conversation_id, key_version, user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $pdo->exec("CREATE TABLE IF NOT EXISTS contacts (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, contact_id))");
            $pdo->exec("CREATE INDEX IF NOT EXISTS idx_ct_contact ON contacts(contact_id)");
            $pdo->exec("CREATE TABLE IF NOT EXISTS user_keys (user_id INTEGER NOT NULL PRIMARY KEY, pub_jwk TEXT NOT NULL, enc_priv TEXT NOT NULL, kdf_salt TEXT NOT NULL, kdf_iter INTEGER NOT NULL DEFAULT 310000, iv TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
            $pdo->exec("CREATE TABLE IF NOT EXISTS conversation_keys (conversation_id INTEGER NOT NULL, key_version INTEGER NOT NULL, user_id INTEGER NOT NULL, wrapped TEXT NOT NULL, wrapped_by INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, key_version, user_id))");
        }
        $cols = function (string $table) use ($pdo, $mysql): array {
            $have = [];
            if ($mysql) {
                $st = $pdo->prepare('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
                $st->execute([$table]);
                foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $c) $have[strtolower($c)] = true;
            } else {
                foreach ($pdo->query('PRAGMA table_info(' . $table . ')') as $c) $have[strtolower($c['name'])] = true;
            }
            return $have;
        };
        $int = $mysql ? 'INT UNSIGNED' : 'INTEGER';
        $c = $cols('conversations');
        if (empty($c['created_by'])) $pdo->exec("ALTER TABLE conversations ADD COLUMN created_by $int NULL");
        if (empty($c['key_version'])) $pdo->exec("ALTER TABLE conversations ADD COLUMN key_version $int NOT NULL DEFAULT 1");
        $c = $cols('conversation_members');
        if (empty($c['cleared_id'])) $pdo->exec("ALTER TABLE conversation_members ADD COLUMN cleared_id $int NOT NULL DEFAULT 0");
        if (empty($c['hidden'])) $pdo->exec('ALTER TABLE conversation_members ADD COLUMN hidden ' . ($mysql ? 'TINYINT(1)' : 'INTEGER') . ' NOT NULL DEFAULT 0');
        // contacte din conversațiile 1:1 existente (ambele direcții)
        $ins = $mysql ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
        $pdo->exec("$ins INTO contacts (user_id, contact_id, created_at)
            SELECT a.user_id, b.user_id, c.created_at FROM conversations c
            JOIN conversation_members a ON a.conversation_id = c.id
            JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id <> a.user_id
            WHERE c.is_group = 0");
        if (is_dir(DATA_DIR)) @file_put_contents($flag, date('c'));
    } catch (Throwable $e) {
        error_log('migrate_v2: ' . $e->getMessage());
    }
}

/**
 * Migrare automată v2.1.6 (o singură dată, sigură: doar CREATE TABLE IF NOT EXISTS):
 *  - fcm_tokens: token-urile Firebase Cloud Messaging ale dispozitivelor (push Android în fundal).
 * Echivalent manual: sql/upgrade-fcm.sql.
 */
function migrate_fcm(PDO $pdo, bool $mysql): void
{
    $flag = DATA_DIR . '/schema-fcm.lock';
    if (is_file($flag)) return;
    try {
        if (!$mysql && !sqlite_has_tables($pdo)) return;
        if ($mysql) {
            $pdo->exec("CREATE TABLE IF NOT EXISTS fcm_tokens (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_id INT UNSIGNED NOT NULL,
                token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                platform VARCHAR(16) NOT NULL DEFAULT 'android',
                app_version VARCHAR(32) NULL DEFAULT NULL,
                updated_at INT UNSIGNED NOT NULL,
                created_at INT UNSIGNED NOT NULL,
                UNIQUE KEY uq_fcm_token (token),
                KEY idx_fcm_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $pdo->exec("CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, platform TEXT NOT NULL DEFAULT 'android', app_version TEXT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL)");
            $pdo->exec("CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id)");
        }
        if (is_dir(DATA_DIR)) @file_put_contents($flag, date('c'));
    } catch (Throwable $e) {
        error_log('migrate_fcm: ' . $e->getMessage());
    }
}

/** Validează metadatele E2E trimise de client (doar câmpuri tehnice: iv, versiunea cheii etc.). */
function e2e_meta_in($e): ?array
{
    if (!is_array($e)) return null;
    $iv = (string)($e['iv'] ?? '');
    if (!preg_match('#^[A-Za-z0-9+/=_-]{8,64}$#', $iv)) return null;
    $out = ['v' => 1, 'iv' => $iv, 'kv' => max(0, (int)($e['kv'] ?? 0))];
    foreach (['m', 'mi'] as $k) { // metadate criptate (nume fișier, mime, dimensiuni) + iv-ul lor
        if (isset($e[$k]) && is_string($e[$k]) && preg_match('#^[A-Za-z0-9+/=_-]{8,8000}$#', $e[$k])) $out[$k] = $e[$k];
    }
    if (isset($e['cs'])) $out['cs'] = max(0, min(64 * 1024 * 1024, (int)$e['cs'])); // mărime bucată (fișiere)
    if (isset($e['t']) && in_array($e['t'], ['image', 'video', 'audio', 'file'], true)) $out['t'] = $e['t'];
    return $out;
}

function is_contact(int $uid, int $other): bool
{
    $st = db()->prepare('SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?');
    $st->execute([$uid, $other]);
    return (bool)$st->fetchColumn();
}

function add_contact(int $uid, int $other): void
{
    if ($uid === $other) return;
    if (is_contact($uid, $other)) return;
    db()->prepare('INSERT INTO contacts (user_id, contact_id, created_at) VALUES (?,?,?)')->execute([$uid, $other, time()]);
}

/** Șterge de pe disc + din DB toate atașamentele unei conversații. */
function purge_conversation_files(int $convId): int
{
    $pdo = db();
    $st = $pdo->prepare('SELECT id, stored_path FROM attachments WHERE conversation_id = ?');
    $st->execute([$convId]);
    $n = 0;
    foreach ($st->fetchAll() as $a) {
        $p = (string)$a['stored_path'];
        if ($p !== '' && !str_contains($p, '..')) { @unlink(UPLOAD_DIR . '/' . $p); @unlink(UPLOAD_DIR . '/' . $p . '.part'); }
        $n++;
    }
    $pdo->prepare('DELETE FROM attachments WHERE conversation_id = ?')->execute([$convId]);
    return $n;
}

function sqlite_has_tables(PDO $pdo): bool
{
    return (bool)$pdo->query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")->fetchColumn();
}

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443);
}

/** Cerere locală (demo pe localhost / serverul PHP încorporat)? */
function is_local_request(): bool
{
    $host = strtolower((string)preg_replace('/:\d+$/', '', (string)($_SERVER['HTTP_HOST'] ?? '')));
    return PHP_SAPI === 'cli-server' || in_array($host, ['localhost', '127.0.0.1', '[::1]', '::1'], true) || str_ends_with($host, '.localhost');
}

/**
 * v2.0: HTTPS obligatoriu (config app.force_https, implicit true). Redirect 301 http -> https
 * pentru paginile HTML. Pe localhost / demo nu se aplică. Certificatul vine din cPanel (AutoSSL / Let's Encrypt).
 */
function enforce_https(): void
{
    $force = app_config()['app']['force_https'] ?? true;
    if (!$force || is_https() || is_local_request() || PHP_SAPI === 'cli') return;
    $host = (string)($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '' || !preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $host)) return;
    header('Location: https://' . $host . ($_SERVER['REQUEST_URI'] ?? '/'), true, 301);
    exit;
}

/** HSTS doar când suntem deja pe HTTPS (altfel browserul ignoră oricum header-ul). */
function security_headers(): void
{
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin');
    header('Permissions-Policy: camera=(self), microphone=(self), geolocation=()');
    if (is_https() && (app_config()['app']['hsts'] ?? true)) header('Strict-Transport-Security: max-age=31536000');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $secure = app_config()['app']['secure_cookies'];
    if ($secure === null) $secure = is_https();
    session_name('MSGRSESS');
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 30,
        'path' => '/',
        'secure' => is_https() || (bool)$secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
    session_start();
    device_auth_bootstrap();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
}

function csrf_token(): string
{
    start_session();
    return $_SESSION['csrf'];
}

function check_csrf(): void
{
    $tok = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($tok) || !hash_equals(csrf_token(), $tok)) {
        json_error('Sesiunea de securitate a expirat. Reîncarcă pagina.', 419);
    }
}

function current_user_id(): ?int
{
    start_session();
    // Validated/resumed once at session start, before CSRF and any protected action.
    return isset($_SESSION['uid']) ? (int)$_SESSION['uid'] : null;
}

function require_auth(): int
{
    $uid = current_user_id();
    if (!$uid) json_error('Neautentificat', 401);
    return $uid;
}

function json_out($data, int $code = 200): void
{
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function json_error(string $msg, int $code = 400): void
{
    json_out(['ok' => false, 'error' => $msg], $code);
}

function input(): array
{
    static $in = null;
    if ($in !== null) return $in;
    $ct = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($ct, 'application/json') !== false) {
        $in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
    } else {
        $in = $_POST;
    }
    return $in;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_error('Metodă nepermisă', 405);
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') json_error('Origine nepermisă.', 403);
    if ($origin !== '') {
        $expected = (is_https() ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? '');
        if (!hash_equals(strtolower($expected), strtolower(rtrim($origin, '/')))) json_error('Origine nepermisă.', 403);
    }
    check_csrf();
}

function h(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/* ---------- domeniu ---------- */

const STATUS_TYPES = ['available', 'busy', 'away', 'invisible', 'offline'];

/**
 * Datele publice ale unui user. $self = true când îl vede chiar el.
 * Un user „invizibil” apare celorlalți ca offline (fără „activ acum”).
 */
function public_user(array $u, bool $self = true): array
{
    $type = in_array($u['status_type'] ?? '', STATUS_TYPES, true) ? $u['status_type'] : 'available';
    $hidden = !$self && in_array($type, ['invisible', 'offline'], true);
    $effective = !$self ? presence_effective($u, presence_row((int)$u['id'])) : null;
    if (!$self && !$effective['online']) $hidden = true;
    $av = $u['avatar_path'] ?? null;
    $public = [
        'id' => (int)$u['id'],
        'username' => $u['username'],
        'display_name' => $u['display_name'],
        'verified' => !empty($u['tex_verified']),
        'staff_label' => tex_display_label($u['tex_display_label'] ?? ''),
        'avatar_color' => $u['avatar_color'],
        'avatar' => $av ? 'api/avatar.php?u=' . (int)$u['id'] . '&v=' . substr(md5((string)$av), 0, 10) : null,
        'status' => $self ? $type : $effective['status'],
        'status_text' => $hidden ? '' : (string)($u['status_text'] ?? ''),
        'last_seen' => $hidden ? 0 : (int)($u['last_seen'] ?? 0),
    ];
    if ($self) $public['is_admin'] = !empty($u['tex_is_admin']);
    return $public;
}

/** Userii care „îl văd” pe $uid: contacte + oricine cu care are o conversație (1:1 sau grup). */
function contact_ids(int $uid): array
{
    $ids = [];
    try {
        $st = db()->prepare('SELECT contact_id FROM contacts WHERE user_id = ?');
        $st->execute([$uid]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $ids[(int)$id] = true;
        // și cine m-a adăugat pe mine (ca să primesc alerte când mă conectez)
        $st = db()->prepare('SELECT user_id FROM contacts WHERE contact_id = ?');
        $st->execute([$uid]);
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $ids[(int)$id] = true;
    } catch (Throwable $_) {}
    $st = db()->prepare('SELECT DISTINCT b.user_id FROM conversation_members a JOIN conversation_members b ON a.conversation_id = b.conversation_id WHERE a.user_id = ? AND b.user_id <> ?');
    $st->execute([$uid, $uid]);
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $id) $ids[(int)$id] = true;
    return array_keys($ids);
}

/** Anunță contactele că s-a schimbat profilul (avatar / status / nume). */
function broadcast_profile(int $uid): void
{
    $u = get_user($uid);
    if (!$u) return;
    push_event(contact_ids($uid), 'profile', public_user($u, false));
    push_event([$uid], 'profile', public_user($u, true));
}

function get_user(int $id): ?array
{
    $st = db()->prepare('SELECT u.*,COALESCE(f.is_verified,0) AS tex_verified,COALESCE(f.is_admin,0) AS tex_is_admin,COALESCE(d.label,\'\') AS tex_display_label FROM users u LEFT JOIN account_flags f ON f.user_id=u.id LEFT JOIN account_display_labels d ON d.user_id=u.id WHERE u.id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function is_member(int $convId, int $uid): bool
{
    $st = db()->prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?');
    $st->execute([$convId, $uid]);
    return (bool)$st->fetchColumn();
}

function require_member(int $convId, int $uid): void
{
    if ($convId <= 0 || !is_member($convId, $uid)) json_error('Conversație inexistentă', 404);
}

function member_ids(int $convId): array
{
    $st = db()->prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?');
    $st->execute([$convId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function share_conversation(int $a, int $b): bool
{
    $st = db()->prepare('SELECT 1 FROM conversation_members m1 JOIN conversation_members m2 ON m1.conversation_id = m2.conversation_id WHERE m1.user_id = ? AND m2.user_id = ? LIMIT 1');
    $st->execute([$a, $b]);
    return (bool)$st->fetchColumn();
}

/** Inserează un eveniment pentru fiecare user din listă (consumat de long-poll). */
function push_event(array $userIds, string $type, array $payload): void
{
    if (!$userIds) return;
    $st = db()->prepare('INSERT INTO events (user_id, type, payload, created_at) VALUES (?, ?, ?, ?)');
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $now = time();
    foreach (array_unique($userIds) as $u) $st->execute([(int)$u, $type, $json, $now]);
}

function reactions_for(array $msgIds): array
{
    if (!$msgIds) return [];
    $in = implode(',', array_fill(0, count($msgIds), '?'));
    $st = db()->prepare("SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN ($in) ORDER BY created_at");
    $st->execute(array_values($msgIds));
    $out = [];
    foreach ($st->fetchAll() as $r) $out[(int)$r['message_id']][] = ['user_id' => (int)$r['user_id'], 'emoji' => $r['emoji']];
    return $out;
}

/** Formatează rânduri de mesaje pentru client (cu atașament, reply, reacții). */
function format_messages(array $rows): array
{
    if (!$rows) return [];
    $ids = array_map(fn($r) => (int)$r['id'], $rows);
    $reacts = reactions_for($ids);
    $replyIds = array_values(array_unique(array_filter(array_map(fn($r) => (int)($r['reply_to_id'] ?? 0), $rows))));
    $replies = [];
    $editIds = array_values(array_unique(array_merge($ids, $replyIds)));
    $edited = [];
    $ep = implode(',', array_fill(0, count($editIds), '?'));
    $es = db()->prepare("SELECT * FROM message_edits WHERE message_id IN ($ep)"); $es->execute($editIds);
    foreach ($es->fetchAll() as $e) $edited[(int)$e['message_id']] = $e;
    if ($replyIds) {
        $in = implode(',', array_fill(0, count($replyIds), '?'));
        $st = db()->prepare("SELECT m.id, m.sender_id, m.type, m.body, m.meta, a.original_name FROM messages m LEFT JOIN attachments a ON a.id = m.attachment_id WHERE m.id IN ($in)");
        $st->execute($replyIds);
        foreach ($st->fetchAll() as $r) {
            $rm = $r['meta'] ? json_decode((string)$r['meta'], true) : null;
            $e2e = is_array($rm) && !empty($rm['e2e']);
            $replies[(int)$r['id']] = [
                'id' => (int)$r['id'], 'sender_id' => (int)$r['sender_id'], 'type' => $r['type'],
                // mesajele criptate E2E se trimit întregi (textul cifrat nu poate fi trunchiat); clientul le decriptează
                'body' => $e2e ? (string)$r['body'] : (in_array($r['type'], ['text', 'buzz'], true) ? mb_substr((string)$r['body'], 0, 200) : ($r['original_name'] ?? '')),
                'meta' => $e2e ? ['e2e' => $rm['e2e']] : null,
                'edited_at' => (int)($edited[(int)$r['id']]['edited_at'] ?? 0),
                'edited_revision' => (int)($edited[(int)$r['id']]['revision'] ?? 0),
            ];
        }
    }
    $attIds = array_values(array_unique(array_filter(array_map(fn($r) => (int)($r['attachment_id'] ?? 0), $rows))));
    $atts = [];
    if ($attIds) {
        $in = implode(',', array_fill(0, count($attIds), '?'));
        $st = db()->prepare("SELECT id, original_name, mime, size, width, height FROM attachments WHERE id IN ($in)");
        $st->execute($attIds);
        foreach ($st->fetchAll() as $a) {
            $atts[(int)$a['id']] = [
                'id' => (int)$a['id'], 'name' => $a['original_name'], 'mime' => $a['mime'], 'size' => (int)$a['size'],
                'width' => $a['width'] !== null ? (int)$a['width'] : null, 'height' => $a['height'] !== null ? (int)$a['height'] : null,
                'url' => 'api/file.php?id=' . (int)$a['id'],
            ];
        }
    }
    $out = [];
    foreach ($rows as $r) {
        $id = (int)$r['id'];
        $out[] = [
            'id' => $id,
            'conversation_id' => (int)$r['conversation_id'],
            'sender_id' => (int)$r['sender_id'],
            'type' => $r['type'],
            'body' => $r['body'],
            'meta' => $r['meta'] ? json_decode($r['meta'], true) : null,
            'attachment' => $r['attachment_id'] ? ($atts[(int)$r['attachment_id']] ?? null) : null,
            'reply_to' => $r['reply_to_id'] ? ($replies[(int)$r['reply_to_id']] ?? ['id' => (int)$r['reply_to_id'], 'deleted' => true]) : null,
            'reactions' => $reacts[$id] ?? [],
            'client_uid' => $r['client_uid'] ?? null,
            'created_at' => (int)$r['created_at'],
            'edited_at' => (int)($edited[$id]['edited_at'] ?? 0),
            'edited_revision' => (int)($edited[$id]['revision'] ?? 0),
        ];
    }
    return $out;
}

function get_message(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM messages WHERE id = ?');
    $st->execute([$id]);
    $r = $st->fetch();
    return $r ? format_messages([$r])[0] : null;
}

/** Creează un mesaj și notifică membrii conversației. */
function create_message(int $convId, int $uid, string $type, ?string $body, ?array $meta = null, ?int $attachmentId = null, ?int $replyTo = null, ?string $clientUid = null): array
{
    $pdo = db();
    $other=$type!=='system' ? contact_direct_peer($convId,$uid) : 0;
    $ownTransaction=$other && !$pdo->inTransaction();
    if ($ownTransaction) $pdo->beginTransaction();
    try {
    if ($other) { contact_lock_pair($pdo,$uid,$other); contact_assert_conversation_allowed($convId,$uid); }
    if ($replyTo) {
        $st = $pdo->prepare('SELECT conversation_id FROM messages WHERE id = ?');
        $st->execute([$replyTo]);
        if ((int)$st->fetchColumn() !== $convId) $replyTo = null;
    }
    $now = time();
    $st = $pdo->prepare('INSERT INTO messages (conversation_id, sender_id, type, body, meta, attachment_id, reply_to_id, client_uid, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    $st->execute([$convId, $uid, $type, $body, $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null, $attachmentId, $replyTo, $clientUid, $now]);
    $mid = (int)$pdo->lastInsertId();
    $pdo->prepare('UPDATE conversations SET last_message_id = ?, updated_at = ? WHERE id = ?')->execute([$mid, $now, $convId]);
    // o conversație „ștearsă” (ascunsă) reapare la mesaj nou — doar cu mesajele noi
    $pdo->prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND hidden <> 0')->execute([$convId]);
    // expeditorul a "citit" propriul mesaj
    $pdo->prepare('UPDATE conversation_members SET last_read_id = ?, last_delivered_id = ? WHERE conversation_id = ? AND user_id = ?')->execute([$mid, $mid, $convId, $uid]);
    $msg = get_message($mid);
    push_event(member_ids($convId), 'message', $msg);
    if ($ownTransaction) $pdo->commit();
    // v2.1.6: push FCM către ceilalți membri (trimis după răspuns; nu și expeditorului)
    if ($msg) fcm_notify_message($convId, $uid, $msg);
    if ($msg) apns_notify_message($convId, $uid, $msg);
    return $msg;
    } catch (Throwable $e) { if ($ownTransaction && $pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}

function receipts_for_conv(int $convId): array
{
    $st = db()->prepare('SELECT user_id, last_delivered_id, last_read_id FROM conversation_members WHERE conversation_id = ?');
    $st->execute([$convId]);
    return array_map(fn($r) => ['user_id' => (int)$r['user_id'], 'delivered' => (int)$r['last_delivered_id'], 'read' => (int)$r['last_read_id']], $st->fetchAll());
}

/** Marchează livrat/citit până la $msgId și trimite chitanță celorlalți membri. */
function mark_receipt(int $convId, int $uid, int $msgId, bool $read): void
{
    $pdo = db();
    $st = $pdo->prepare('SELECT last_delivered_id, last_read_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?');
    $st->execute([$convId, $uid]);
    $cur = $st->fetch();
    $st->closeCursor(); // SQLite: eliberează snapshot-ul de citire înainte de UPDATE (altfel „database is locked”)
    if (!$cur) return;
    $maxSt = $pdo->prepare('SELECT MAX(id) FROM messages WHERE conversation_id = ? AND id <= ?');
    $maxSt->execute([$convId, $msgId]);
    $msgId = (int)$maxSt->fetchColumn();
    $maxSt->closeCursor();
    $newDel = max((int)$cur['last_delivered_id'], $msgId);
    $newRead = $read ? max((int)$cur['last_read_id'], $msgId) : (int)$cur['last_read_id'];
    if ($newDel === (int)$cur['last_delivered_id'] && $newRead === (int)$cur['last_read_id']) return;
    $upd = $pdo->prepare('UPDATE conversation_members SET last_delivered_id = ?, last_read_id = ? WHERE conversation_id = ? AND user_id = ?');
    for ($try = 0; ; $try++) {
        try { $upd->execute([$newDel, $newRead, $convId, $uid]); break; }
        catch (PDOException $e) {
            if ($try >= 5 || stripos($e->getMessage(), 'locked') === false) throw $e;
            usleep(50000 * ($try + 1));
        }
    }
    push_event(member_ids($convId), 'receipt', ['conversation_id' => $convId, 'user_id' => $uid, 'delivered' => $newDel, 'read' => $newRead]);
}

function random_color(): string
{
    $c = ['#0084ff', '#a334fa', '#ff5ca1', '#fa3c4c', '#ff7e29', '#f5b400', '#13cf13', '#00c6c6', '#6a5acd', '#e68585', '#20b2aa', '#7646ff'];
    return $c[random_int(0, count($c) - 1)];
}
