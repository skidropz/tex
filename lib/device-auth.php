<?php
declare(strict_types=1);
/** Persistent device credentials, not passwords. PHP sessions remain short-lived/replaceable.
 * Only hashes are stored; daily CAS rotation, acknowledged delivery, then 120s overlap for in-flight requests.
 * Each request also checks revocation and the current account/password generation.
 */
const DEVICE_AUTH_TTL = 180 * 86400;
const DEVICE_AUTH_ROTATE = 86400;
const DEVICE_AUTH_COOKIE = 'TEXDEVICE';

function device_auth_schema(bool $mysql): array
{
    $id = $mysql ? 'INT UNSIGNED' : 'INTEGER';
    $indexes = $mysql ? ', INDEX auth_devices_user (user_id), INDEX auth_devices_expiry (expires_at)' : '';
    $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    $sql = ["CREATE TABLE IF NOT EXISTS auth_devices (selector VARCHAR(32) NOT NULL PRIMARY KEY, user_id $id NOT NULL, validator_hash VARCHAR(64) NOT NULL, previous_hash VARCHAR(64) NULL, previous_until BIGINT NOT NULL DEFAULT 0, rotation_pending INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL, credential_tag VARCHAR(64) NOT NULL, rotated_at BIGINT NOT NULL, expires_at BIGINT NOT NULL$indexes)$tail"];
    if (!$mysql) {
        $sql[] = 'CREATE INDEX IF NOT EXISTS auth_devices_user ON auth_devices (user_id)';
        $sql[] = 'CREATE INDEX IF NOT EXISTS auth_devices_expiry ON auth_devices (expires_at)';
    }
    return $sql;
}
function migrate_device_auth(PDO $pdo, bool $mysql): void
{
    try { $pdo->query('SELECT 1 FROM auth_devices WHERE 1=0'); return; }
    catch (PDOException $e) { if ($e->getCode() !== '42S02' && !str_contains($e->getMessage(), 'no such table')) throw $e; }
    foreach (device_auth_schema($mysql) as $sql) $pdo->exec($sql);
}
function device_auth_transport(): bool { return is_https() || is_local_request(); }
function device_auth_options(int $expires): array
{
    return ['expires'=>$expires, 'path'=>'/', 'secure'=>is_https() || !is_local_request(), 'httponly'=>true, 'samesite'=>'Lax'];
}
function device_auth_cookie(?string $value, int $expires = 0): void
{
    if (headers_sent()) throw new RuntimeException('Authentication headers already sent');
    header('X-Tex-Session-Persist: 1');
    setcookie(DEVICE_AUTH_COOKIE, $value ?? '', device_auth_options($value === null ? time()-3600 : $expires));
    if ($value === null) unset($_COOKIE[DEVICE_AUTH_COOKIE]);
    else $_COOKIE[DEVICE_AUTH_COOKIE] = $value;
}
function device_auth_parts(): ?array
{
    $cookie = $_COOKIE[DEVICE_AUTH_COOKIE] ?? '';
    return is_string($cookie) && preg_match('/\A([0-9a-f]{32}):([0-9a-f]{64})\z/D', $cookie, $m) ? [$m[1], $m[2]] : null;
}
function device_auth_account(int $uid): ?array
{
    $st = db()->prepare('SELECT u.id,u.password_hash,COALESCE(s.auth_version,0) AS auth_version FROM users u LEFT JOIN user_security s ON s.user_id=u.id WHERE u.id=?');
    $st->execute([$uid]); $a = $st->fetch();
    if (!$a) return null;
    $a['credential_tag'] = hash('sha256', $a['password_hash']);
    unset($a['password_hash']);
    return $a;
}
function device_auth_row(string $selector): ?array
{
    $st = db()->prepare('SELECT * FROM auth_devices WHERE selector=?');
    $st->execute([$selector]); return $st->fetch() ?: null;
}
function device_auth_valid(array $row, array $account): bool
{
    return (int)$row['user_id'] === (int)$account['id'] && (int)$row['expires_at'] > time()
        && (int)$row['auth_version'] === (int)$account['auth_version']
        && hash_equals($row['credential_tag'], $account['credential_tag']);
}
function device_auth_matches(array $row, array $parts): bool
{
    if (!hash_equals($row['selector'], $parts[0])) return false;
    $hash = hash('sha256', $parts[1]);
    return hash_equals($row['validator_hash'], $hash)
        || ((int)$row['previous_until'] >= time() && is_string($row['previous_hash']) && hash_equals($row['previous_hash'], $hash));
}
function device_auth_browser_request(): bool
{
    // Native FCM HttpURLConnection forwards WebView cookies but does NOT import Set-Cookie.
    // Renew only on regular browser chat/auth/poll paths, never background push or media streams.
    return device_auth_transport() && in_array(basename($_SERVER['SCRIPT_NAME'] ?? ''), ['index.php','auth.php','poll.php'], true);
}
function device_auth_renew(array $row, ?array $parts, bool $primarySession = false): void
{
    if (!device_auth_browser_request()) return;
    $now = time(); $presented = $parts && hash_equals($row['selector'],$parts[0]) ? hash('sha256',$parts[1]) : '';
    $current = $presented !== '' && hash_equals($row['validator_hash'],$presented);
    $previous = $parts && device_auth_matches($row,$parts) && !$current;
    if ($current && (int)$row['rotation_pending'] === 1) {
        // A later request proves Set-Cookie reached the client. Only now retire its old secret.
        $st = db()->prepare('UPDATE auth_devices SET rotation_pending=0, previous_until=? WHERE selector=? AND validator_hash=? AND rotation_pending=1');
        $st->execute([$now+120,$row['selector'],$row['validator_hash']]);
        $row['rotation_pending'] = 0;
    }
    if ($current && (int)$row['rotated_at'] > $now - DEVICE_AUTH_ROTATE) return;
    if ($previous && (int)$row['rotation_pending'] === 0) return; // harmless in-flight old request
    if (!$current && !$previous && !$primarySession) return;
    // If Set-Cookie was lost (e.g. app killed), an unacknowledged old validator remains valid
    // only until ITS ORIGINAL expiry. Re-deliver a new secret, never extend the old one's lease.
    $previousHash = $previous ? $row['previous_hash'] : $row['validator_hash'];
    $previousUntil = $previous ? (int)$row['previous_until'] : (int)$row['expires_at'];
    $secret = bin2hex(random_bytes(32)); $hash = hash('sha256',$secret);
    $st = db()->prepare('UPDATE auth_devices SET previous_hash=?, previous_until=?, rotation_pending=1, validator_hash=?, rotated_at=?, expires_at=? WHERE selector=? AND validator_hash=? AND rotated_at=? AND expires_at>? AND rotation_pending=?');
    $st->execute([$previousHash,$previousUntil,$hash,$now,$now+DEVICE_AUTH_TTL,$row['selector'],$row['validator_hash'],$row['rotated_at'],$now,$row['rotation_pending']]);
    if ($st->rowCount() === 1) device_auth_cookie($row['selector'].':'.$secret,$now+DEVICE_AUTH_TTL);
}
function device_auth_issue(array $account): void
{
    if (!device_auth_browser_request()) return;
    $selector = bin2hex(random_bytes(16)); $secret = bin2hex(random_bytes(32)); $now = time();
    db()->prepare('DELETE FROM auth_devices WHERE user_id=? AND expires_at<?')->execute([$account['id'], $now]);
    $st = db()->prepare('INSERT INTO auth_devices (selector,user_id,validator_hash,auth_version,credential_tag,rotated_at,expires_at) VALUES (?,?,?,?,?,?,?)');
    $st->execute([$selector, $account['id'], hash('sha256',$secret), $account['auth_version'], $account['credential_tag'], $now, $now+DEVICE_AUTH_TTL]);
    $_SESSION['device_selector'] = $selector;
    device_auth_cookie($selector.':'.$secret, $now+DEVICE_AUTH_TTL);
}
function device_auth_reject(): void
{
    unset($_SESSION['uid'], $_SESSION['auth_version'], $_SESSION['credential_tag'], $_SESSION['device_selector']);
    if (isset($_COOKIE[DEVICE_AUTH_COOKIE])) device_auth_cookie(null);
}
function device_auth_forget_current(): void
{
    $uid = (int)($_SESSION['uid'] ?? 0); $selector = $_SESSION['device_selector'] ?? '';
    if ($uid && is_string($selector) && $selector !== '') {
        // Revokes all PHP sessions resumed from this device, not other accounts/devices.
        db()->prepare('DELETE FROM auth_devices WHERE selector=? AND user_id=?')->execute([$selector,$uid]);
    }
    device_auth_cookie(null);
    unset($_SESSION['uid'], $_SESSION['auth_version'], $_SESSION['credential_tag'], $_SESSION['device_selector']);
}
function device_auth_bootstrap(): void
{
    $uid = (int)($_SESSION['uid'] ?? 0); $parts = device_auth_parts();
    if ($uid) {
        $account = device_auth_account($uid);
        if (!$account || (int)($_SESSION['auth_version'] ?? 0) !== (int)$account['auth_version']) { device_auth_reject(); return; }
        $selector = $_SESSION['device_selector'] ?? null;
        $row = $selector ? device_auth_row($selector) : null;
        if ($row && !device_auth_valid($row,$account)) {
            // An atomic work-factor rehash may have committed between these two reads.
            $account = device_auth_account($uid); $row = device_auth_row($selector);
        }
        if (!$account || (int)($_SESSION['auth_version'] ?? 0) !== (int)$account['auth_version']
            || ($selector && (!$row || !device_auth_valid($row,$account)))) { device_auth_reject(); return; }
        if (isset($_SESSION['credential_tag']) && !hash_equals($_SESSION['credential_tag'],$account['credential_tag'])) {
            // A verified password rehash may update device tags; a real password change never does.
            if (!$row) { device_auth_reject(); return; }
        }
        $_SESSION['credential_tag'] = $account['credential_tag'];
        if (!$selector) device_auth_issue($account); // Upgrade a valid pre-2.1.28 session without a new login.
        elseif ($row) device_auth_renew($row,$parts,true);
        return;
    }
    if (!$parts || !device_auth_transport()) { if (isset($_COOKIE[DEVICE_AUTH_COOKIE])) device_auth_cookie(null); return; }
    $row = device_auth_row($parts[0]); $account = $row ? device_auth_account((int)$row['user_id']) : null;
    if ($row && $account && !device_auth_valid($row,$account)) {
        $row = device_auth_row($parts[0]); $account = $row ? device_auth_account((int)$row['user_id']) : null;
    }
    if (!$row || !$account || !device_auth_valid($row,$account) || !device_auth_matches($row,$parts)) { device_auth_reject(); return; }
    session_regenerate_id(true);
    header('X-Tex-Session-Persist: 1');
    // Never restore old recovery grants/challenges or another account's CSRF context.
    $_SESSION = ['uid'=>(int)$account['id'], 'auth_version'=>(int)$account['auth_version'],
        'credential_tag'=>$account['credential_tag'], 'device_selector'=>$row['selector'], 'csrf'=>bin2hex(random_bytes(32))];
    device_auth_renew($row,$parts);
}
function device_auth_login(int $uid, int $authVersion, string $verifiedHash): void
{
    $account = device_auth_account($uid);
    if (!$account || (int)$account['auth_version'] !== $authVersion || !hash_equals($account['credential_tag'],hash('sha256',$verifiedHash))) json_error('Date de conectare schimbate. Încearcă din nou.',401);
    device_auth_forget_current();
    session_regenerate_id(true);
    $_SESSION = ['uid'=>$uid, 'auth_version'=>$authVersion, 'credential_tag'=>$account['credential_tag'], 'csrf'=>bin2hex(random_bytes(32))];
    device_auth_issue($account);
}
