<?php
declare(strict_types=1);
/**
 * Semnalizare WebRTC pentru transferuri P2P și apeluri video (fișierul NU trece prin server).
 * offer  -> creează un mesaj "p2p" în conversație (card cu Acceptă)
 * signal -> trimite accept / SDP / ICE / cancel către celălalt peer (livrat prin long-poll + VoIP push pt. iOS)
 * status -> actualizează starea transferului în mesaj (finalizat / anulat)
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
require_post();
session_write_close();
$in = input();
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'offer':
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        $tid = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($in['transfer_id'] ?? ''));
        if (strlen($tid) < 8) json_error('transfer_id invalid');
        $files = [];
        foreach ((array)($in['files'] ?? []) as $f) {
            $files[] = [
                'name' => mb_substr(preg_replace('/[\x00-\x1F\x7F]/u', '', (string)($f['name'] ?? 'fisier')), 0, 200),
                'size' => max(0, (int)($f['size'] ?? 0)),
                'mime' => mb_substr((string)($f['mime'] ?? 'application/octet-stream'), 0, 100),
            ];
        }
        if (!$files) json_error('Niciun fișier');
        $meta = ['transfer_id' => $tid, 'files' => array_slice($files, 0, 50), 'status' => 'offered', 'sender_id' => $uid];
        // v2.0 E2E: lista reală de fișiere (nume, tip) e cifrată; în clar rămân doar mărimile
        $e2e = e2e_meta_in($in['e2e'] ?? null);
        if ($e2e) $meta['e2e'] = $e2e;
        $cu = isset($in['client_uid']) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$in['client_uid']), 0, 64) : null;
        $msg = create_message($cid, $uid, 'p2p', null, $meta, null, (int)($in['reply_to_id'] ?? 0) ?: null, $cu);
        json_out(['ok' => true, 'message' => $msg]);

    case 'signal':
        $to = (int)($in['to_user_id'] ?? 0);
        if ($to === $uid || !share_conversation($uid, $to)) json_error('Destinatar invalid', 403);
        $kind = (string)($in['kind'] ?? '');
        if (!in_array($kind, ['accept', 'offer', 'answer', 'ice', 'cancel', 'decline', 'done', 'busy', 'unavailable', 'call-invite', 'call-accept', 'call-decline', 'call-hangup', 'call-offer', 'call-answer', 'call-ice', 'call-busy'], true)) json_error('Tip semnal invalid');
        if (!in_array($kind,['cancel','decline','done','busy','unavailable','call-decline','call-hangup','call-busy'],true) && contact_pair_restricted($uid,$to)) json_error('Comunicarea directă nu este disponibilă pentru acest contact, pentru că a fost ignorat.',403);
        $data = $in['data'] ?? null;
        if (contact_pair_restricted($uid,$to)) $data=null; // cleanup only: no arbitrary payload through an ignored peer

        $enc = json_encode($data);
        if ($enc !== false && strlen($enc) > 200000) json_error('Semnal prea mare');
        $cleanTid = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($in['transfer_id'] ?? ''));
        push_event([$to], 'signal', [
            'from' => $uid,
            'transfer_id' => $cleanTid,
            'message_id' => (int)($in['message_id'] ?? 0),
            'kind' => $kind,
            'data' => $data,
        ]);
        if (function_exists('apns_notify_call_signal')) {
            apns_notify_call_signal($uid, $to, $kind, $cleanTid, $data);
        }
        json_out(['ok' => true]);

    case 'status':
        $mid = (int)($in['message_id'] ?? 0);
        $st = db()->prepare("SELECT * FROM messages WHERE id = ? AND type = 'p2p'");
        $st->execute([$mid]);
        $m = $st->fetch();
        if (!$m) json_error('Mesaj inexistent', 404);
        require_member((int)$m['conversation_id'], $uid);
        $status = (string)($in['status'] ?? '');
        if (!in_array($status, ['offered', 'completed', 'cancelled', 'failed', 'expired'], true)) json_error('Status invalid');
        $meta = json_decode((string)$m['meta'], true) ?: [];
        $meta['status'] = $status;
        $meta['status_by'] = $uid;
        db()->prepare('UPDATE messages SET meta = ? WHERE id = ?')->execute([json_encode($meta, JSON_UNESCAPED_UNICODE), $mid]);
        $msg = get_message($mid);
        push_event(member_ids((int)$m['conversation_id']), 'message_update', $msg);
        json_out(['ok' => true, 'message' => $msg]);

    default:
        json_error('Acțiune necunoscută', 404);
}
