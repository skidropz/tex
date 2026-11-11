<?php
declare(strict_types=1);
/**
 * Long-poll: ține conexiunea deschisă până apar evenimente noi (sau timeout).
 * Funcționează pe hosting partajat (fără WebSockets).
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
session_write_close(); // foarte important: eliberează lock-ul de sesiune

@set_time_limit(0);
ignore_user_abort(false);
$timeout = (int)(app_config()['app']['poll_timeout'] ?? 20);
$timeout = max(1, min(55, (int)($_GET['timeout'] ?? $timeout)));
$since = (int)($_GET['since'] ?? 0);
// Serverul PHP încorporat cu un singur worker (ex. Windows) s-ar bloca la long-poll => polling scurt.
if (PHP_SAPI === 'cli-server' && ((int)getenv('PHP_CLI_SERVER_WORKERS') < 2 || PHP_OS_FAMILY === 'Windows')) $timeout = 1;
$pdo = db();

// Interaction timestamps are max-reconciled across tabs/devices. Visibility loss is not a logout.
$activity = max(0, min(time(), (int)($_GET['activity'] ?? 0)));
if (!$activity && ($_GET['pres'] ?? '') === 'back') $activity = time(); // older clients: explicit return only
presence_touch($uid, $activity);
if (isset($_GET['init'])) {
    $st = $pdo->prepare('SELECT COALESCE(MAX(id),0) FROM events WHERE user_id = ?'); $st->execute([$uid]);
    json_out(['ok'=>true, 'cursor'=>(int)$st->fetchColumn(), 'events'=>[]] + presence_snapshot($uid));
}
fcm_send_now();

// curățenie ocazională a evenimentelor vechi
if (random_int(1, 50) === 1) {
    $pdo->prepare('DELETE FROM events WHERE created_at < ?')->execute([time() - 3600]);
    // upload-uri neterminate mai vechi de 2 zile
    $old = $pdo->prepare('SELECT id, stored_path FROM attachments WHERE complete = 0 AND created_at < ?');
    $old->execute([time() - 172800]);
    foreach ($old->fetchAll() as $a) {
        @unlink(UPLOAD_DIR . '/' . $a['stored_path'] . '.part');
        $pdo->prepare('DELETE FROM attachments WHERE id = ?')->execute([$a['id']]);
    }
}

$start = microtime(true);
$st = $pdo->prepare('SELECT id, type, payload FROM events WHERE user_id = ? AND id > ? ORDER BY id LIMIT 500');
$events = [];
while (true) {
    $st->execute([$uid, $since]);
    $rows = $st->fetchAll();
    if ($rows) {
        $restricted=array_fill_keys(contact_restricted_ids($uid),true);
        foreach ($rows as $r) {
            $payload=json_decode($r['payload'],true);
            // Pending events must not resurrect a now-hidden user or reveal a stale manual status.
            if ($r['type']==='presence' && !empty($payload['user_id'])) {
                $p=presence_reconcile((int)$payload['user_id']);
                $payload=['user_id'=>(int)$payload['user_id'],'online'=>$p['online'] ?? false,'last_seen'=>$p['last_activity'] ?? 0,'presence'=>$p,'at'=>time()];
            } elseif ($r['type']==='profile' && !empty($payload['id'])) {
                $user=get_user((int)$payload['id']); if ($user) $payload=public_user($user,(int)$user['id']===$uid);
            }
            $since=(int)$r['id'];
            if (!is_array($payload) || !contact_event_allowed($uid,(string)$r['type'],$payload,$restricted)) continue;
            $events[] = ['id' => (int)$r['id'], 'type' => $r['type'], 'data' => $payload];
            $since = (int)$r['id'];
        }
        break;
    }
    if (microtime(true) - $start >= $timeout) break;
    usleep(600000);
}

// mesajele primite sunt acum "livrate"
$maxPerConv = [];
foreach ($events as $e) {
    if ($e['type'] === 'message' && (int)$e['data']['sender_id'] !== $uid) {
        $c = (int)$e['data']['conversation_id'];
        $maxPerConv[$c] = max($maxPerConv[$c] ?? 0, (int)$e['data']['id']);
    }
}
foreach ($maxPerConv as $c => $m) mark_receipt($c, $uid, $m, false);

json_out(['ok'=>true, 'cursor'=>$since, 'events'=>$events,'restricted_ids'=>contact_restricted_ids($uid)] + presence_snapshot($uid));
