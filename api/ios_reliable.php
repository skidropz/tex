<?php
declare(strict_types=1);
/** E2E text send with a durable idempotency key. This endpoint never accepts plaintext. */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = (string)($_GET['action'] ?? '');
$pdo = db();
if ($method === 'GET') {
    session_write_close();
    if ($action === 'capabilities') {
        try { $pdo->query('SELECT user_id FROM ios_message_dedup WHERE 1=0'); }
        catch (Throwable $e) { json_error('Migrarea iOS pentru mesaje nu a fost instalată', 503); }
        json_out(['ok' => true, 'reliable_version' => 1]);
    }
    if ($action === 'status') {
        $key = (string)($_GET['client_uid'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $key)) json_error('Identificator invalid');
        $st = $pdo->prepare('SELECT message_id FROM ios_message_dedup WHERE user_id=? AND client_uid=?');
        $st->execute([$uid, $key]); $id = (int)$st->fetchColumn();
        json_out(['ok' => true, 'committed' => $id > 0, 'message_id' => $id > 0 ? $id : null]);
    }
    json_error('Acțiune necunoscută', 404);
}
require_post(); session_write_close();
if ($action !== 'send') json_error('Acțiune necunoscută', 404);
$in = input(); $cid = (int)($in['conversation_id'] ?? 0); require_member($cid, $uid);
$key = (string)($in['client_uid'] ?? '');
$body = (string)($in['body'] ?? '');
$e2e = e2e_meta_in($in['e2e'] ?? null);
if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/D', $key)) json_error('Identificator invalid');
if (!$e2e || !preg_match('#^[A-Za-z0-9+/=]{16,60000}$#D', $body)) json_error('Mesaj criptat invalid');
$reply = (int)($in['reply_to_id'] ?? 0) ?: null;
$members = array_map('intval', (array)($in['members'] ?? [])); sort($members, SORT_NUMERIC);
if (count($members) < 2 || count($members) > 50 || count(array_unique($members)) !== count($members) || !in_array($uid, $members, true)) json_error('Membri invalizi');
$keys = [];
foreach ((array)($in['fingerprints'] ?? []) as $row) {
    if (!is_array($row)) json_error('Amprentă invalidă');
    $id = (int)($row['id'] ?? 0); $fp = (string)($row['fingerprint'] ?? '');
    if ($id <= 0 || isset($keys[$id]) || !preg_match('#^[A-Za-z0-9+/]{43}$#D', $fp)) json_error('Amprentă invalidă');
    $keys[$id] = $fp;
}
ksort($keys, SORT_NUMERIC);
if (array_map('intval', array_keys($keys)) !== $members) json_error('Lista de chei nu corespunde membrilor');
$hash = hash('sha256', json_encode([$cid, $body, $e2e, $reply, $members, $keys], JSON_UNESCAPED_SLASHES));
function ios_existing(PDO $pdo, int $user, string $key, string $hash, int $cid): ?array {
    $st = $pdo->prepare('SELECT conversation_id,request_hash,message_id FROM ios_message_dedup WHERE user_id=? AND client_uid=?');
    $st->execute([$user, $key]); $r = $st->fetch();
    if (!$r) return null;
    if ((int)$r['conversation_id'] !== $cid || !hash_equals((string)$r['request_hash'], $hash)) json_error('Identificatorul a fost folosit pentru alt conținut', 409);
    $id = (int)$r['message_id'];
    if ($id <= 0) json_error('Operația nu este încă finalizată', 503);
    $msg = get_message($id);
    // A deleted message must never be recreated by a replay.
    if (!$msg) json_error('Mesajul a fost deja procesat și ulterior șters', 410);
    return $msg;
}
if ($existing = ios_existing($pdo, $uid, $key, $hash, $cid)) json_out(['ok' => true, 'message' => $existing, 'duplicate' => true]);
$mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
try {
    $pdo->beginTransaction();
    $pdo->prepare('INSERT INTO ios_message_dedup (user_id,client_uid,conversation_id,request_hash,message_id,created_at) VALUES (?,?,?,?,0,?)')
        ->execute([$uid, $key, $cid, $hash, time()]);
    // The membership range, conversation and public key rows are checked in the
    // same transaction as the message; a stale group key or member set is refused.
    $suffix = $mysql ? ' FOR UPDATE' : '';
    $st = $pdo->prepare('SELECT is_group,key_version FROM conversations WHERE id=?' . $suffix);
    $st->execute([$cid]); $conv = $st->fetch();
    if (!$conv) { $pdo->rollBack(); json_error('Conversația nu mai există', 404); }
    $st = $pdo->prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? ORDER BY user_id' . $suffix);
    $st->execute([$cid]); $current = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
    if ($current !== $members || !in_array($uid, $current, true)) { $pdo->rollBack(); json_error('Membrii s-au schimbat. Verifică mesajul în așteptare.', 409); }
    if ((int)$conv['is_group'] && (int)$e2e['kv'] !== (int)$conv['key_version']) { $pdo->rollBack(); json_error('Versiunea cheii grupului s-a schimbat.', 409); }
    $st = $pdo->prepare('SELECT fingerprint FROM user_keys WHERE user_id=?' . $suffix);
    foreach ($members as $id) {
        $st->execute([$id]); $actual = $st->fetchColumn(); $st->closeCursor();
        if (!is_string($actual) || !hash_equals($keys[$id], $actual)) { $pdo->rollBack(); json_error('Cheia unui participant s-a schimbat.', 409); }
    }
    $msg = create_message($cid, $uid, 'text', $body, ['e2e' => $e2e], null, $reply, $key);
    $pdo->prepare('UPDATE ios_message_dedup SET message_id=? WHERE user_id=? AND client_uid=?')->execute([(int)$msg['id'], $uid, $key]);
    $pdo->commit();
    push_event(array_diff(member_ids($cid), [$uid]), 'typing', ['conversation_id' => $cid, 'user_id' => $uid, 'typing' => false]);
    json_out(['ok' => true, 'message' => $msg, 'duplicate' => false]);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    // Another concurrent request may have committed the same UUID while we waited.
    if ($existing = ios_existing($pdo, $uid, $key, $hash, $cid)) json_out(['ok' => true, 'message' => $existing, 'duplicate' => true]);
    throw $e;
}
