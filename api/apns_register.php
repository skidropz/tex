<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth(); require_post(); session_write_close();
$in = input();
$installation = strtolower((string)($in['installation_id'] ?? ''));
$topic = (string)($in['topic'] ?? '');
$environment = (string)($in['environment'] ?? '');
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/D', $installation)
    || !preg_match('/^[A-Za-z0-9][A-Za-z0-9.\-]{2,254}$/D', $topic) || !in_array($environment, ['sandbox', 'production'], true)) json_error('Identificare APNs invalidă');
$pdo = db();
if (!empty($in['delete'])) {
    $pdo->prepare('DELETE FROM ios_apns_tokens WHERE user_id=? AND installation_id=? AND topic=? AND environment=?')->execute([$uid, $installation, $topic, $environment]);
    json_out(['ok' => true, 'enabled' => false]);
}
if (!function_exists('apns_enabled') || !apns_enabled() || !apns_topic_allowed($topic, $environment)) json_error('APNs nu este configurat pe server pentru această aplicație.', 503);
$token = strtolower((string)($in['token'] ?? ''));
if (strlen($token) % 2 || !preg_match('/^[0-9a-f]{32,512}$/D', $token)) json_error('Token APNs invalid');
$hash = hash('sha256', $token); $generation = bin2hex(random_bytes(16)); $now = time();
try {
    $pdo->beginTransaction();
    // Token rotation or account switch: replace only this installation/topic or
    // a matching high-entropy device token, never all devices for an account.
    $pdo->prepare('DELETE FROM ios_apns_tokens WHERE token_hash=? OR (installation_id=? AND topic=? AND environment=?)')->execute([$hash, $installation, $topic, $environment]);
    $pdo->prepare('INSERT INTO ios_apns_tokens (token_hash,token,installation_id,user_id,topic,environment,generation,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$hash, $token, $installation, $uid, $topic, $environment, $generation, $now]);
    $pdo->commit();
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
$st = $pdo->prepare('SELECT token_hash FROM ios_apns_tokens WHERE user_id=? ORDER BY updated_at DESC, token_hash DESC');
$st->execute([$uid]); $hashes = $st->fetchAll(PDO::FETCH_COLUMN);
foreach (array_slice($hashes, 10) as $old) $pdo->prepare('DELETE FROM ios_apns_tokens WHERE user_id=? AND token_hash=?')->execute([$uid, $old]);
if (random_int(1, 20) === 1) $pdo->prepare('DELETE FROM ios_apns_tokens WHERE updated_at < ?')->execute([$now - 90 * 86400]);
json_out(['ok' => true, 'enabled' => true]);
