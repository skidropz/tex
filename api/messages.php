<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    session_write_close();
    $cid = (int)($_GET['conversation_id'] ?? 0);
    require_member($cid, $uid);
    $before = (int)($_GET['before_id'] ?? 0);
    $limit = max(1, min(100, (int)($_GET['limit'] ?? 40)));
    // v2.0: mesajele de dinainte de „Șterge conversația” nu mai apar pentru mine
    $cl = db()->prepare('SELECT cleared_id FROM conversation_members WHERE conversation_id = ? AND user_id = ?');
    $cl->execute([$cid, $uid]);
    $cleared = (int)$cl->fetchColumn();
    $cl->closeCursor();
    if ($before > 0) {
        $st = db()->prepare("SELECT * FROM messages WHERE conversation_id = ? AND id < ? AND id > ? ORDER BY id DESC LIMIT $limit");
        $st->execute([$cid, $before, $cleared]);
    } else {
        $st = db()->prepare("SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT $limit");
        $st->execute([$cid, $cleared]);
    }
    $rows = array_reverse($st->fetchAll());
    $msgs = format_messages($rows);
    if ($msgs && !$before) {
        $lastOther = 0;
        foreach ($msgs as $m) if ($m['sender_id'] !== $uid) $lastOther = $m['id'];
        if ($lastOther) mark_receipt($cid, $uid, $lastOther, false);
    }
    json_out(['ok' => true, 'messages' => $msgs, 'has_more' => count($rows) === $limit, 'receipts' => receipts_for_conv($cid)]);
}

require_post();
session_write_close();
$in = input();
$action = $_GET['action'] ?? 'send';
$cid = (int)($in['conversation_id'] ?? 0);

switch ($action) {
    case 'send':
        require_member($cid, $uid);
        $body = (string)($in['body'] ?? '');
        $meta = null;
        $e2e = e2e_meta_in($in['e2e'] ?? null);
        if ($e2e) {
            // v2.0 E2E: body = text cifrat (base64, AES-256-GCM). Serverul NU vede textul în clar.
            if (!preg_match('#^[A-Za-z0-9+/=]{16,60000}$#', $body)) json_error('Mesaj criptat invalid');
            $meta = ['e2e' => $e2e];
        } else {
            $body = preg_replace('/\r\n?/', "\n", $body);
            if (trim($body) === '') json_error('Mesajul este gol');
            if (mb_strlen($body) > 10000) json_error('Mesajul este prea lung (maximum 10.000 de caractere)');
        }
        $reply = (int)($in['reply_to_id'] ?? 0) ?: null;
        $cu = isset($in['client_uid']) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$in['client_uid']), 0, 64) : null;
        $msg = create_message($cid, $uid, 'text', $body, $meta, null, $reply, $cu);
        push_event(array_diff(member_ids($cid), [$uid]), 'typing', ['conversation_id' => $cid, 'user_id' => $uid, 'typing' => false]);
        json_out(['ok' => true, 'message' => $msg]);

    case 'buzz': // BUZZ!!! ca în Yahoo! Messenger: mesaj special, ambele ferestre se scutură
        require_member($cid, $uid);
        $st = db()->prepare("SELECT MAX(created_at) FROM messages WHERE conversation_id = ? AND sender_id = ? AND type = 'buzz'");
        $st->execute([$cid, $uid]);
        $last = (int)$st->fetchColumn();
        if ($last && time() - $last < 3) json_error('Așteaptă puțin între două BUZZ-uri', 429);
        $cu = isset($in['client_uid']) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$in['client_uid']), 0, 64) : null;
        $msg = create_message($cid, $uid, 'buzz', 'BUZZ!!!', null, null, null, $cu);
        json_out(['ok' => true, 'message' => $msg]);

    case 'read':
        require_member($cid, $uid);
        $mid = (int)($in['message_id'] ?? 0);
        if ($mid > 0) mark_receipt($cid, $uid, $mid, true);
        json_out(['ok' => true]);

    case 'typing':
        require_member($cid, $uid);
        contact_assert_conversation_allowed($cid,$uid);
        push_event(array_diff(member_ids($cid), [$uid]), 'typing', ['conversation_id' => $cid, 'user_id' => $uid, 'typing' => (bool)($in['typing'] ?? true)]);
        json_out(['ok' => true]);

    case 'react':
        $mid = (int)($in['message_id'] ?? 0);
        $st = db()->prepare('SELECT conversation_id FROM messages WHERE id = ?');
        $st->execute([$mid]);
        $cid = (int)$st->fetchColumn();
        require_member($cid, $uid);
        contact_assert_conversation_allowed($cid,$uid);
        $emoji = (string)($in['emoji'] ?? '');
        if (preg_match('/^fire[123]$/D', $emoji)) json_error('Reacțiile cu flăcări au fost eliminate.',410);
        if (mb_strlen($emoji) > 16 || preg_match('/[<>&"\'\s]/', $emoji)) json_error('Reacție invalidă');
        $st = db()->prepare('SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?');
        $st->execute([$mid, $uid]);
        $cur = $st->fetchColumn();
        db()->prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?')->execute([$mid, $uid]);
        if ($emoji !== '' && $cur !== $emoji) {
            db()->prepare('INSERT INTO reactions (message_id, user_id, emoji, created_at) VALUES (?,?,?,?)')->execute([$mid, $uid, $emoji, time()]);
        }
        $reacts = reactions_for([$mid])[$mid] ?? [];
        push_event(member_ids($cid), 'reaction', ['conversation_id' => $cid, 'message_id' => $mid, 'reactions' => $reacts, 'by' => $uid]);
        json_out(['ok' => true, 'reactions' => $reacts]);

    default:
        json_error('Acțiune necunoscută', 404);
}
