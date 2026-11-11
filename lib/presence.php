<?php
declare(strict_types=1);
const PRES_IDLE_SECONDS = 300;
const PRES_OFFLINE_SECONDS = 1800;
/** Connection transport and interaction age are independent; a one-minute gap is not a logout. */
function presence_effective(array $u, array $p, ?int $now = null, bool $self = false): array
{
    $now = $now ?? time(); $manual = (string)($u['status_type'] ?? 'available');
    $activity = (int)($p['last_activity'] ?? $u['last_seen'] ?? 0); $heartbeat = (int)($p['last_heartbeat'] ?? 0);
    if (in_array($manual, ['invisible', 'offline'], true)) return ['status'=>'offline','manual'=>$self ? $manual : 'offline','online'=>false,'idle'=>false,'last_activity'=>0,'last_heartbeat'=>0,'connection'=>'offline'];
    $age = max(0, $now - $activity);
    $online = $activity > 0 && $age < PRES_OFFLINE_SECONDS;
    $idle = $online && $age >= PRES_IDLE_SECONDS;
    // All peer-offline states share one payload: manual Invisible, explicit Offline, or auto-offline.
    // In particular, a live background heartbeat must not reveal a hidden/offline connection.
    if (!$online && !$self) return ['status'=>'offline','manual'=>'offline','online'=>false,'idle'=>false,'last_activity'=>0,'last_heartbeat'=>0,'connection'=>'offline'];
    return ['status'=>!$online ? 'offline' : ($idle ? 'away' : $manual), 'manual'=>$manual, 'online'=>$online, 'idle'=>$idle,
        'last_activity'=>$activity, 'last_heartbeat'=>$heartbeat,
        'connection'=>!$online ? 'offline' : ($heartbeat && $now-$heartbeat <= 120 ? 'connected' : 'uncertain')];
}
function presence_row(int $uid): array
{
    $s = db()->prepare('SELECT * FROM user_presence WHERE user_id=?'); $s->execute([$uid]); return $s->fetch() ?: [];
}
function presence_touch(int $uid, int $activity, ?int $now = null): void
{
    $now = $now ?? time(); $activity = max(0, min($now, $activity)); $pdo = db();
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $sql = 'INSERT INTO user_presence (user_id,last_activity,last_heartbeat) VALUES (?,?,?) ' . ($mysql
        ? 'ON DUPLICATE KEY UPDATE last_activity=GREATEST(last_activity,VALUES(last_activity)), last_heartbeat=GREATEST(last_heartbeat,VALUES(last_heartbeat))'
        : 'ON CONFLICT(user_id) DO UPDATE SET last_activity=MAX(user_presence.last_activity,CAST(excluded.last_activity AS INTEGER)), last_heartbeat=MAX(user_presence.last_heartbeat,CAST(excluded.last_heartbeat AS INTEGER))');
    $pdo->prepare($sql)->execute([$uid, $activity, $now]);
    // Legacy last_seen is real interaction time, never an artificial heartbeat or fabricated stale time.
    $pdo->prepare('UPDATE users SET last_seen=CASE WHEN last_seen < ? THEN ? ELSE last_seen END WHERE id=?')->execute([$activity, $activity, $uid]);
    presence_reconcile($uid, $now);
}
function presence_reconcile(int $uid, ?int $now = null): array
{
    $u = get_user($uid); if (!$u) return [];
    $p = presence_row($uid); $state = presence_effective($u, $p, $now);
    if (!$p) return $state; // old account, not yet using 2.1.17
    $newState = $state['online'] ? ($state['idle'] ? 'idle' : $state['status']) : 'offline';
    if (($p['last_state'] ?? 'offline') !== $newState) {
        $s = db()->prepare('UPDATE user_presence SET last_state=? WHERE user_id=? AND last_state=?'); $s->execute([$newState, $uid, $p['last_state']]);
        if ($s->rowCount() === 1) {
            $watchers = contact_ids($uid);
            push_event($watchers, 'presence', ['user_id'=>$uid, 'online'=>$state['online'], 'last_seen'=>$state['last_activity'], 'presence'=>$state, 'at'=>$now ?? time()]);
            // Entering Idle is not a disconnect. Only actual online/offline transitions trigger presence push.
            $before = ($p['last_state'] ?? 'offline') !== 'offline';
            if ($before !== $state['online']) fcm_notify_presence($uid, $state['online'], $watchers);
        }
    }
    return $state;
}
function presence_snapshot(int $uid): array
{
    $ids = contact_ids($uid); $ids[] = $uid; $map = []; $online = [];
    foreach (array_unique($ids) as $id) {
        $p = presence_reconcile((int)$id);
        if (!$p) continue;
        // Never send the real invisible/manual-hidden state, including in snapshots/events.
        $map[(int)$id] = $p; $online[(int)$id] = $p['last_activity'];
    }
    return ['online'=>$online, 'presence'=>$map, 'server_time'=>time()];
}
