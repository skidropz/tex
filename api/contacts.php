<?php
declare(strict_types=1);
/**
 * v2.0: lista de contacte.
 *  GET              -> contactele mele
 *  POST ?action=add    {user_id}  -> adaugă contact (+ deschide conversația 1:1)
 *  POST ?action=remove {user_id}  -> șterge contactul (conversația 1:1 dispare din listă; istoricul rămâne)
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    session_write_close();
    $st = db()->prepare('SELECT u.*,COALESCE(f.is_verified,0) AS tex_verified,COALESCE(d.label,\'\') AS tex_display_label FROM contacts c JOIN users u ON u.id = c.contact_id LEFT JOIN account_flags f ON f.user_id=u.id LEFT JOIN account_display_labels d ON d.user_id=u.id WHERE c.user_id = ? ORDER BY u.display_name, u.username');
    $st->execute([$uid]);
    json_out(['ok' => true, 'contacts' => array_map(fn($u) => public_user($u, false), $st->fetchAll()), 'preferences'=>contact_preferences_for($uid), 'restricted_ids'=>contact_restricted_ids($uid)]);
}

require_post();
session_write_close();
$in = input();
$action = $_GET['action'] ?? '';
$other = (int)($in['user_id'] ?? 0);
if ($other <= 0 || $other === $uid || !get_user($other)) json_error('Utilizator inexistent');

switch ($action) {
    case 'add':
        add_contact($uid, $other);
        json_out(['ok' => true, 'contact' => public_user(get_user($other), false)]);

    case 'remove':
        db()->prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?')->execute([$uid, $other]);
        // conversația 1:1 dispare din listă (doar pentru mine); reapare dacă primesc un mesaj nou
        $st = db()->prepare('SELECT c.id FROM conversations c
            JOIN conversation_members a ON a.conversation_id = c.id AND a.user_id = ?
            JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id = ?
            WHERE c.is_group = 0 LIMIT 1');
        $st->execute([$uid, $other]);
        $cid = (int)$st->fetchColumn();
        if ($cid) {
            db()->prepare('UPDATE conversation_members SET hidden = 1 WHERE conversation_id = ? AND user_id = ?')->execute([$cid, $uid]);
            push_event([$uid], 'conv_removed', ['conversation_id' => $cid, 'reason' => 'contact_removed']);
        }
        json_out(['ok' => true, 'conversation_id' => $cid ?: null]);

    default:
        json_error('Acțiune necunoscută', 404);
}
