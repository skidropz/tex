<?php
declare(strict_types=1);
/**
 * v2.1.6 — înregistrare token FCM (push Android).
 *
 * POST JSON { token, platform?: 'android'|'ios'|'web', app_version?, delete?: bool }
 *  - autentificare: sesiunea (cookie MSGRSESS — aplicația Android îl ia din CookieManager-ul WebView-ului)
 *  - CSRF: antetul X-CSRF-Token (din pagină) SAU, pentru re-înregistrarea nativă la rotirea token-ului,
 *    Content-Type: application/json + antetul X-VT-Push: 1 (ambele forțează preflight CORS => imposibil cross-site;
 *    cookie-ul de sesiune e oricum SameSite=Lax).
 *  - upsert după token (UNIQUE): același dispozitiv logat pe alt cont => token-ul trece la contul nou.
 *  - delete=true => șterge token-ul (logout); token gol => șterge token-urile userului pentru platforma dată.
 */
require __DIR__ . '/../lib/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') json_error('Metodă nepermisă', 405);
$uid = require_auth();
$hdrTok = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
$csrfOk = is_string($hdrTok) && $hdrTok !== '' && hash_equals(csrf_token(), $hdrTok);
$nativeOk = ($_SERVER['HTTP_X_VT_PUSH'] ?? '') === '1' && stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== false;
if (!$csrfOk && !$nativeOk) json_error('Sesiunea de securitate a expirat. Reîncarcă pagina.', 419);
session_write_close();

$in = input();
$token = trim((string)($in['token'] ?? ''));
$platform = strtolower(trim((string)($in['platform'] ?? 'android')));
if (!in_array($platform, ['android', 'ios', 'web'], true)) $platform = 'android';
$ver = substr(preg_replace('/[^0-9A-Za-z._-]/', '', (string)($in['app_version'] ?? '')), 0, 32) ?: null;
$pdo = db();

if ($token === '') {
    $pdo->prepare('DELETE FROM fcm_tokens WHERE user_id = ? AND platform = ?')->execute([$uid, $platform]);
    json_out(['ok' => true, 'deleted' => true]);
}
if (strlen($token) > 512 || !preg_match('/^[A-Za-z0-9_:\-.]{20,512}$/', $token)) json_error('Token FCM invalid');

if (!empty($in['delete'])) {
    $pdo->prepare('DELETE FROM fcm_tokens WHERE token = ? AND user_id = ?')->execute([$token, $uid]);
    json_out(['ok' => true, 'deleted' => true]);
}

$now = time();
$upd = $pdo->prepare('UPDATE fcm_tokens SET user_id = ?, platform = ?, app_version = COALESCE(?, app_version), updated_at = ? WHERE token = ?');
$upd->execute([$uid, $platform, $ver, $now, $token]);
if ($upd->rowCount() === 0) {
    try {
        $pdo->prepare('INSERT INTO fcm_tokens (user_id, token, platform, app_version, updated_at, created_at) VALUES (?,?,?,?,?,?)')
            ->execute([$uid, $token, $platform, $ver, $now, $now]);
    } catch (PDOException $e) {
        // cursă / MySQL rowCount 0 la valori identice: token-ul există deja => update simplu
        $pdo->prepare('UPDATE fcm_tokens SET user_id = ?, platform = ?, app_version = COALESCE(?, app_version), updated_at = ? WHERE token = ?')
            ->execute([$uid, $platform, $ver, $now + 1, $token]);
    }
}
// max 10 dispozitive / user: le păstrăm pe cele mai recente
$st = $pdo->prepare('SELECT id FROM fcm_tokens WHERE user_id = ? ORDER BY updated_at DESC, id DESC');
$st->execute([$uid]);
$ids = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
$st->closeCursor();
foreach (array_slice($ids, 10) as $old) $pdo->prepare('DELETE FROM fcm_tokens WHERE id = ?')->execute([$old]);
// tokenuri abandonate (> 90 zile fără re-înregistrare)
if (random_int(1, 20) === 1) $pdo->prepare('DELETE FROM fcm_tokens WHERE updated_at < ?')->execute([$now - 90 * 86400]);

json_out(['ok' => true, 'push' => fcm_enabled()]);
