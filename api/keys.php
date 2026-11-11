<?php
declare(strict_types=1);
/**
 * v2.0 — chei pentru criptarea end-to-end (E2E).
 *
 * Serverul stochează DOAR:
 *  - cheia publică ECDH P-256 a fiecărui utilizator (JWK public, „pub_jwk”)
 *  - cheia privată CRIPTATĂ în browser cu o cheie derivată din parolă (PBKDF2-SHA256 → AES-256-GCM).
 *    Serverul nu are parola în clar după login, deci nu poate decripta cheia privată.
 *  - cheile de grup „împachetate” (wrapped) pentru fiecare membru (AES-GCM cu cheie ECDH între membri).
 *
 * GET  ?action=mine                       -> înregistrarea mea (pentru deblocare pe un dispozitiv nou)
 * GET  ?action=pub&ids=1,2                -> cheile publice ale unor utilizatori (contacte / membri comuni)
 * POST ?action=setup {password, pub_jwk, enc_priv, kdf_salt, kdf_iter, iv, fingerprint, replace}
 * POST ?action=verify {password}          -> verifică parola (deblocare E2E pe sesiuni vechi)
 * GET  ?action=conv&conversation_id=N     -> versiunea cheii de grup + cheile mele împachetate + cine nu o are
 * POST ?action=wrap {conversation_id, key_version, fresh, keys:[{user_id, wrapped}]}
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
$pdo = db();

function key_row(int $u): ?array
{
    $st = db()->prepare('SELECT * FROM user_keys WHERE user_id = ?');
    $st->execute([$u]);
    return $st->fetch() ?: null;
}

if ($method === 'GET') {
    session_write_close();
    switch ($action) {
        case 'mine':
            $r = key_row($uid);
            json_out(['ok' => true, 'key' => $r ? [
                'pub_jwk' => json_decode($r['pub_jwk'], true), 'enc_priv' => $r['enc_priv'], 'kdf_salt' => $r['kdf_salt'],
                'kdf_iter' => (int)$r['kdf_iter'], 'iv' => $r['iv'], 'fingerprint' => $r['fingerprint'], 'updated_at' => (int)$r['updated_at'],
            ] : null]);

        case 'pub':
            $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', explode(',', (string)($_GET['ids'] ?? ''))), fn($x) => $x > 0))), 0, 100);
            $out = [];
            foreach ($ids as $id) {
                if ($id !== $uid && !share_conversation($uid, $id) && !is_contact($uid, $id)) continue;
                $r = key_row($id);
                $out[(string)$id] = $r ? ['pub_jwk' => json_decode($r['pub_jwk'], true), 'fingerprint' => $r['fingerprint'], 'updated_at' => (int)$r['updated_at']] : null;
            }
            json_out(['ok' => true, 'keys' => $out]);

        case 'conv':
            $cid = (int)($_GET['conversation_id'] ?? 0);
            require_member($cid, $uid);
            $st = $pdo->prepare('SELECT key_version, is_group FROM conversations WHERE id = ?');
            $st->execute([$cid]);
            $c = $st->fetch();
            $kv = (int)$c['key_version'];
            $st = $pdo->prepare('SELECT key_version, wrapped, wrapped_by FROM conversation_keys WHERE conversation_id = ? AND user_id = ? ORDER BY key_version');
            $st->execute([$cid, $uid]);
            $mine = array_map(fn($r) => ['kv' => (int)$r['key_version'], 'wrapped' => $r['wrapped'], 'by' => (int)$r['wrapped_by']], $st->fetchAll());
            $st = $pdo->prepare('SELECT cm.user_id, (SELECT 1 FROM conversation_keys k WHERE k.conversation_id = cm.conversation_id AND k.key_version = ? AND k.user_id = cm.user_id) AS has_key FROM conversation_members cm WHERE cm.conversation_id = ?');
            $st->execute([$kv, $cid]);
            $members = array_map(fn($r) => ['id' => (int)$r['user_id'], 'has_key' => (bool)$r['has_key']], $st->fetchAll());
            json_out(['ok' => true, 'key_version' => $kv, 'is_group' => (bool)$c['is_group'], 'mine' => $mine, 'members' => $members]);
    }
    json_error('Acțiune necunoscută', 404);
}

require_post();
session_write_close();
$in = input();

switch ($action) {
    case 'verify':
        $u = get_user($uid);
        if (!$u || !password_verify((string)($in['password'] ?? ''), $u['password_hash'])) { usleep(300000); json_error('Parola este greșită'); }
        json_out(['ok' => true]);

    case 'setup':
        $u = get_user($uid);
        if (!$u || !password_verify((string)($in['password'] ?? ''), $u['password_hash'])) { usleep(300000); json_error('Parola este greșită'); }
        $pub = $in['pub_jwk'] ?? null;
        if (!is_array($pub) || ($pub['kty'] ?? '') !== 'EC' || ($pub['crv'] ?? '') !== 'P-256' || isset($pub['d']) || empty($pub['x']) || empty($pub['y'])) json_error('Cheie publică invalidă');
        $pubClean = ['kty' => 'EC', 'crv' => 'P-256', 'x' => (string)$pub['x'], 'y' => (string)$pub['y']];
        $b64 = '#^[A-Za-z0-9+/=_-]{8,8000}$#';
        foreach (['enc_priv', 'kdf_salt', 'iv', 'fingerprint'] as $k) if (!preg_match($b64, (string)($in[$k] ?? ''))) json_error('Date cheie invalide (' . $k . ')');
        $iter = (int)($in['kdf_iter'] ?? 310000);
        if ($iter < 100000 || $iter > 5000000) json_error('Număr de iterații invalid');
        $exists = key_row($uid);
        if ($exists && empty($in['replace'])) json_error('Cheile E2E există deja', 409);
        $now = time();
        if ($exists) {
            $pdo->prepare('UPDATE user_keys SET pub_jwk = ?, enc_priv = ?, kdf_salt = ?, kdf_iter = ?, iv = ?, fingerprint = ?, updated_at = ? WHERE user_id = ?')
                ->execute([json_encode($pubClean), $in['enc_priv'], $in['kdf_salt'], $iter, $in['iv'], $in['fingerprint'], $now, $uid]);
            // cheile de grup împachetate pentru vechea cheie nu mai pot fi deschise
            $pdo->prepare('DELETE FROM conversation_keys WHERE user_id = ? OR wrapped_by = ?')->execute([$uid, $uid]);
        } else {
            $pdo->prepare('INSERT INTO user_keys (user_id, pub_jwk, enc_priv, kdf_salt, kdf_iter, iv, fingerprint, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
                ->execute([$uid, json_encode($pubClean), $in['enc_priv'], $in['kdf_salt'], $iter, $in['iv'], $in['fingerprint'], $now, $now]);
        }
        push_event(array_merge(contact_ids($uid), [$uid]), 'key_update', ['user_id' => $uid, 'fingerprint' => $in['fingerprint']]);
        json_out(['ok' => true]);

    case 'wrap':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $kv = (int)($in['key_version'] ?? 0);
        $st = $pdo->prepare('SELECT key_version FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        $cur = (int)$st->fetchColumn();
        if ($kv !== $cur) json_error('Versiunea cheii s-a schimbat', 409);
        $members = member_ids($cid);
        $fresh = !empty($in['fresh']);
        $pdo->beginTransaction();
        $st = $pdo->prepare('SELECT COUNT(*) FROM conversation_keys WHERE conversation_id = ? AND key_version = ?');
        $st->execute([$cid, $kv]);
        $n = (int)$st->fetchColumn();
        if ($fresh && $n > 0) { $pdo->rollBack(); json_error('Cheia a fost deja generată de alt membru', 409); }
        if (!$fresh) {
            $st = $pdo->prepare('SELECT 1 FROM conversation_keys WHERE conversation_id = ? AND key_version = ? AND user_id = ?');
            $st->execute([$cid, $kv, $uid]);
            if (!$st->fetchColumn()) { $pdo->rollBack(); json_error('Nu ai cheia curentă a grupului', 409); }
        }
        $sel = $pdo->prepare('SELECT 1 FROM conversation_keys WHERE conversation_id = ? AND key_version = ? AND user_id = ?');
        $ins = $pdo->prepare('INSERT INTO conversation_keys (conversation_id, key_version, user_id, wrapped, wrapped_by, created_at) VALUES (?,?,?,?,?,?)');
        $added = 0;
        foreach ((array)($in['keys'] ?? []) as $k) {
            $to = (int)($k['user_id'] ?? 0);
            $w = (string)($k['wrapped'] ?? '');
            if (!in_array($to, $members, true) || strlen($w) > 4000 || $w === '') continue;
            $sel->execute([$cid, $kv, $to]);
            if ($sel->fetchColumn()) continue;
            $ins->execute([$cid, $kv, $to, $w, $uid, time()]);
            $added++;
        }
        $pdo->commit();
        if ($added) push_event($members, 'conv_key', ['conversation_id' => $cid, 'key_version' => $kv]);
        json_out(['ok' => true, 'added' => $added]);
}
json_error('Acțiune necunoscută', 404);
