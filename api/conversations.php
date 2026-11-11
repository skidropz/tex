<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function conv_summary(int $convId, int $uid): ?array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT c.*, cm.last_read_id, cm.cleared_id, cm.hidden FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ? WHERE c.id = ?');
    $st->execute([$uid, $convId]);
    $c = $st->fetch();
    if (!$c) return null;
    $st = $pdo->prepare('SELECT u.*,COALESCE(f.is_verified,0) AS tex_verified,COALESCE(d.label,\'\') AS tex_display_label,COALESCE(f.is_admin,0) AS tex_is_admin FROM conversation_members cm JOIN users u ON u.id = cm.user_id LEFT JOIN account_flags f ON f.user_id=u.id LEFT JOIN account_display_labels d ON d.user_id=u.id WHERE cm.conversation_id = ? ORDER BY cm.joined_at, u.id');
    $st->execute([$convId]);
    $members = array_map(fn($u) => public_user($u, (int)$u['id'] === $uid), $st->fetchAll());
    $cleared = (int)$c['cleared_id'];
    $last = ($c['last_message_id'] && (int)$c['last_message_id'] > $cleared) ? get_message((int)$c['last_message_id']) : null;
    $st = $pdo->prepare('SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND id > ? AND id > ? AND sender_id <> ?');
    $st->execute([$convId, (int)$c['last_read_id'], $cleared, $uid]);
    $isGroup = (bool)$c['is_group'];
    $isContact = true;
    if (!$isGroup) {
        foreach ($members as $m) if ($m['id'] !== $uid) $isContact = is_contact($uid, $m['id']);
    }
    return [
        'id' => (int)$c['id'],
        'is_group' => $isGroup,
        'title' => $c['title'],
        'created_by' => isset($c['created_by']) ? (int)$c['created_by'] : null,
        'key_version' => (int)($c['key_version'] ?? 1),
        'members' => $members,
        'last_message' => $last,
        'unread' => (int)$st->fetchColumn(),
        'receipts' => receipts_for_conv($convId),
        'cleared_id' => $cleared,
        'is_contact' => $isContact,
        'updated_at' => (int)$c['updated_at'],
    ];
}

function group_title(string $t): string
{
    $t = trim(preg_replace('/\s+/u', ' ', $t));
    return mb_substr($t, 0, 100);
}

if ($method === 'GET') {
    session_write_close();
    $st = db()->prepare('SELECT c.id FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id WHERE cm.user_id = ? AND cm.hidden = 0 ORDER BY c.updated_at DESC, c.id DESC LIMIT 300');
    $st->execute([$uid]);
    $list = [];
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $cid) {
        $s = conv_summary((int)$cid, $uid);
        if ($s) {
            // mesajele primite până acum sunt "livrate"
            if ($s['last_message'] && $s['last_message']['sender_id'] !== $uid) mark_receipt((int)$cid, $uid, $s['last_message']['id'], false);
            $list[] = $s;
        }
    }
    json_out(['ok' => true, 'conversations' => $list]);
}

require_post();
session_write_close();
$in = input();
$action = $_GET['action'] ?? 'open';
$pdo = db();

switch ($action) {
    case 'open':
        $other = (int)($in['user_id'] ?? 0);
        if ($other === $uid || !get_user($other)) json_error('Utilizator inexistent');
        $st = $pdo->prepare('SELECT c.id FROM conversations c
            JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
            JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
            WHERE c.is_group = 0 LIMIT 1');
        $st->execute([$uid, $other]);
        $cid = (int)$st->fetchColumn();
        if (!$cid) {
            if (contact_pair_restricted($uid,$other)) json_error('Comunicarea directă nu este disponibilă pentru acest contact, pentru că a fost ignorat.',403);
            $now = time();
            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO conversations (is_group, title, created_by, created_at, updated_at) VALUES (0, NULL, ?, ?, ?)')->execute([$uid, $now, $now]);
            $cid = (int)$pdo->lastInsertId();
            $ins = $pdo->prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?,?,?)');
            $ins->execute([$cid, $uid, $now]);
            $ins->execute([$cid, $other, $now]);
            $pdo->commit();
        } else {
            // dacă o ștersesem din listă, reapare (fără mesajele șterse)
            $pdo->prepare('UPDATE conversation_members SET hidden = 0 WHERE conversation_id = ? AND user_id = ?')->execute([$cid, $uid]);
        }
        json_out(['ok' => true, 'conversation' => conv_summary($cid, $uid)]);

    case 'get':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        json_out(['ok' => true, 'conversation' => conv_summary($cid, $uid)]);

    case 'create_group':
        $title = group_title((string)($in['title'] ?? ''));
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($in['user_ids'] ?? [])), fn($x) => $x > 0 && $x !== $uid)));
        if (count($ids) < 2) json_error('Alege cel puțin două contacte pentru grup');
        if (count($ids) > 49) json_error('Maxim 50 de membri într-un grup');
        foreach ($ids as $id) {
            if (contact_pair_restricted($uid,$id)) json_error('Nu poți invita acest contact, pentru că a fost ignorat.',403);
            if (!get_user($id)) json_error('Utilizator inexistent');
            if (!is_contact($uid, $id)) json_error('Poți adăuga în grup doar persoane din lista ta de contacte');
        }
        if ($title === '') {
            $names = [];
            foreach (array_slice($ids, 0, 3) as $id) $names[] = explode(' ', (string)get_user($id)['display_name'])[0];
            $title = implode(', ', $names) . (count($ids) > 3 ? ' +' . (count($ids) - 3) : '');
        }
        $now = time();
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO conversations (is_group, title, created_by, key_version, created_at, updated_at) VALUES (1, ?, ?, 1, ?, ?)')->execute([$title, $uid, $now, $now]);
        $cid = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?,?,?)');
        $ins->execute([$cid, $uid, $now]);
        foreach ($ids as $id) $ins->execute([$cid, $id, $now]);
        $pdo->commit();
        $msg = create_message($cid, $uid, 'system', null, ['event' => 'group_created', 'title' => $title]);
        json_out(['ok' => true, 'conversation' => conv_summary($cid, $uid), 'message' => $msg]);

    case 'rename_group':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $st = $pdo->prepare('SELECT is_group FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        if (!(int)$st->fetchColumn()) json_error('Doar grupurile pot fi redenumite');
        $title = group_title((string)($in['title'] ?? ''));
        if ($title === '') json_error('Scrie un nume pentru grup');
        $pdo->prepare('UPDATE conversations SET title = ? WHERE id = ?')->execute([$title, $cid]);
        create_message($cid, $uid, 'system', null, ['event' => 'group_renamed', 'title' => $title]);
        push_event(member_ids($cid), 'conv_update', ['conversation_id' => $cid]);
        json_out(['ok' => true, 'conversation' => conv_summary($cid, $uid)]);

    case 'add_members':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $st = $pdo->prepare('SELECT is_group FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        if (!(int)$st->fetchColumn()) json_error('Membrii se pot adăuga doar în grupuri');
        $have = member_ids($cid);
        $ids = array_values(array_unique(array_filter(array_map('intval', (array)($in['user_ids'] ?? [])), fn($x) => $x > 0 && !in_array($x, $have, true))));
        if (!$ids) json_error('Alege cel puțin un contact nou');
        if (count($have) + count($ids) > 50) json_error('Maxim 50 de membri într-un grup');
        $now = time();
        $ins = $pdo->prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_id, last_delivered_id) VALUES (?,?,?,?,?)');
        $st = $pdo->prepare('SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id = ?');
        $st->execute([$cid]);
        $maxId = (int)$st->fetchColumn();
        foreach ($ids as $id) {
            if (contact_pair_restricted($uid,$id)) json_error('Nu poți invita acest contact, pentru că a fost ignorat.',403);
            if (!get_user($id) || !is_contact($uid, $id)) json_error('Poți adăuga doar persoane din lista ta de contacte');
            $ins->execute([$cid, $id, $now, $maxId, $maxId]);
        }
        create_message($cid, $uid, 'system', null, ['event' => 'members_added', 'user_ids' => $ids]);
        push_event(member_ids($cid), 'conv_update', ['conversation_id' => $cid]);
        json_out(['ok' => true, 'conversation' => conv_summary($cid, $uid)]);

    case 'leave':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $st = $pdo->prepare('SELECT is_group FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        if (!(int)$st->fetchColumn()) json_error('Poți părăsi doar grupuri. Pentru 1:1 folosește „Șterge conversația”.');
        create_message($cid, $uid, 'system', null, ['event' => 'member_left']);
        $pdo->prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?')->execute([$cid, $uid]);
        // E2E: cheia de grup se rotește => cine a plecat nu mai poate citi mesajele noi
        $pdo->prepare('UPDATE conversations SET key_version = key_version + 1 WHERE id = ?')->execute([$cid]);
        $left = member_ids($cid);
        if (!$left) {
            purge_conversation_files($cid);
            $pdo->prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)')->execute([$cid]);
            $pdo->prepare('DELETE FROM conversation_pins WHERE conversation_id = ?')->execute([$cid]);
        $pdo->prepare('DELETE FROM message_edits WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)')->execute([$cid]);
        $pdo->prepare('DELETE FROM messages WHERE conversation_id = ?')->execute([$cid]);
            $pdo->prepare('DELETE FROM conversation_keys WHERE conversation_id = ?')->execute([$cid]);
            $pdo->prepare('DELETE FROM conversations WHERE id = ?')->execute([$cid]);
        } else {
            push_event($left, 'conv_update', ['conversation_id' => $cid]);
        }
        push_event([$uid], 'conv_removed', ['conversation_id' => $cid, 'reason' => 'left']);
        json_out(['ok' => true]);

    case 'delete':
        // „Șterge conversația” = doar pentru mine: ascunde firul + golește istoricul meu (celălalt păstrează tot)
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $st = $pdo->prepare('SELECT COALESCE(MAX(id),0) FROM messages WHERE conversation_id = ?');
        $st->execute([$cid]);
        $maxId = (int)$st->fetchColumn();
        // v2.0.2: într-o conversație 1:1 cu un CONTACT, contactul rămâne în listă — doar firul se golește.
        $st = $pdo->prepare('SELECT is_group FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        $isGroup = (int)$st->fetchColumn() === 1;
        $peer = 0;
        if (!$isGroup) { foreach (member_ids($cid) as $m) if ($m !== $uid) $peer = $m; }
        $keep = !$isGroup && $peer && is_contact($uid, $peer);
        $pdo->prepare('UPDATE conversation_members SET cleared_id = ?, hidden = ?, last_read_id = CASE WHEN last_read_id > ? THEN last_read_id ELSE ? END WHERE conversation_id = ? AND user_id = ?')
            ->execute([$maxId, $keep ? 0 : 1, $maxId, $maxId, $cid, $uid]);
        if ($keep) {
            push_event([$uid], 'conv_cleared', ['conversation_id' => $cid]);
            json_out(['ok' => true, 'kept' => true, 'conversation' => conv_summary($cid, $uid)]);
        }
        push_event([$uid], 'conv_removed', ['conversation_id' => $cid, 'reason' => 'deleted']);
        json_out(['ok' => true]);

    case 'destroy':
        // „Conversation destroy”: șterge DEFINITIV de pe server tot firul (mesaje, reacții, fișiere, chei)
        // pentru TOȚI participanții, fără acordul celuilalt. În grupuri: doar creatorul grupului.
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $st = $pdo->prepare('SELECT * FROM conversations WHERE id = ?');
        $st->execute([$cid]);
        $c = $st->fetch();
        if (!$c) json_error('Conversație inexistentă', 404);
        if ((int)$c['is_group'] && (int)($c['created_by'] ?? 0) !== $uid) json_error('Într-un grup, doar creatorul îl poate șterge definitiv. Tu îl poți șterge doar pentru tine sau poți părăsi grupul.', 403);
        $members = member_ids($cid);
        $files = purge_conversation_files($cid);
        $st = $pdo->prepare('SELECT COUNT(*) FROM messages WHERE conversation_id = ?');
        $st->execute([$cid]);
        $count = (int)$st->fetchColumn();
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)')->execute([$cid]);
        $pdo->prepare('DELETE FROM conversation_pins WHERE conversation_id = ?')->execute([$cid]);
        $pdo->prepare('DELETE FROM message_edits WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)')->execute([$cid]);
        $pdo->prepare('DELETE FROM messages WHERE conversation_id = ?')->execute([$cid]);
        $pdo->prepare('DELETE FROM conversation_keys WHERE conversation_id = ?')->execute([$cid]);
        $pdo->prepare('DELETE FROM conversation_members WHERE conversation_id = ?')->execute([$cid]);
        $pdo->prepare('DELETE FROM conversations WHERE id = ?')->execute([$cid]);
        // evenimentele încă nelivrate din acest fir (mesaje, reacții, „scrie…”) dispar și ele
        if ($members) {
            $in2 = implode(',', array_fill(0, count($members), '?'));
            $pdo->prepare("DELETE FROM events WHERE user_id IN ($in2) AND payload LIKE ?")->execute(array_merge($members, ['%"conversation_id":' . $cid . ',%']));
            $pdo->prepare("DELETE FROM events WHERE user_id IN ($in2) AND payload LIKE ?")->execute(array_merge($members, ['%"conversation_id":' . $cid . '}%']));
        }
        $pdo->commit();
        push_event($members, 'conv_destroyed', ['conversation_id' => $cid, 'by' => $uid, 'is_group' => (bool)$c['is_group'], 'title' => $c['title']]);
        // v2.0.2: distrugerea șterge FIRUL, nu contactul. Pentru 1:1 recreăm o conversație goală, vizibilă
        // doar pentru cine îl are pe celălalt în contacte (pentru ceilalți rămâne ascunsă până la un mesaj nou).
        $fresh = null;
        if (!(int)$c['is_group'] && count($members) === 2) {
            [$m1, $m2] = $members;
            $keep1 = is_contact($m1, $m2); $keep2 = is_contact($m2, $m1);
            if ($keep1 || $keep2) {
                $now = time();
                $pdo->beginTransaction();
                $pdo->prepare('INSERT INTO conversations (is_group, title, created_by, created_at, updated_at) VALUES (0, NULL, ?, ?, ?)')->execute([$uid, $now, $now]);
                $ncid = (int)$pdo->lastInsertId();
                $ins = $pdo->prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at, hidden) VALUES (?,?,?,?)');
                $ins->execute([$ncid, $m1, $now, $keep1 ? 0 : 1]);
                $ins->execute([$ncid, $m2, $now, $keep2 ? 0 : 1]);
                $pdo->commit();
                $vis = array_values(array_filter([$keep1 ? $m1 : 0, $keep2 ? $m2 : 0]));
                push_event($vis, 'conv_update', ['conversation_id' => $ncid]);
                if (in_array($uid, $vis, true)) $fresh = conv_summary($ncid, $uid);
            }
        }
        json_out(['ok' => true, 'deleted_messages' => $count, 'deleted_files' => $files, 'conversation' => $fresh]);

    default:
        json_error('Acțiune necunoscută', 404);
}
