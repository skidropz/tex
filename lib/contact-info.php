<?php
declare(strict_types=1);
/** Preferences NEVER enter public_user(), conversation payloads, profile broadcasts or peer keys. */
function contact_preferences_for(int $uid): array {
    $s=db()->prepare('SELECT contact_id,alias,ignored FROM contact_preferences WHERE user_id=?'); $s->execute([$uid]);
    return array_map(fn($p)=>['user_id'=>(int)$p['contact_id'],'alias'=>(string)$p['alias'],'ignored'=>(bool)$p['ignored']],$s->fetchAll());
}
function contact_restricted_ids(int $uid): array {
    $s=db()->prepare('SELECT contact_id FROM contact_preferences WHERE user_id=? AND ignored=1 UNION SELECT user_id FROM contact_preferences WHERE contact_id=? AND ignored=1'); $s->execute([$uid,$uid]);
    return array_map('intval',$s->fetchAll(PDO::FETCH_COLUMN));
}
function contact_lock_pair(PDO $pdo,int $a,int $b): void {
    if ($pdo->getAttribute(PDO::ATTR_DRIVER_NAME)!=='mysql') return;
    $ids=[$a,$b]; sort($ids,SORT_NUMERIC);
    $st=$pdo->prepare('SELECT id FROM users WHERE id=? FOR UPDATE');
    foreach(array_unique($ids) as $id) { $st->execute([$id]); $st->fetchColumn(); $st->closeCursor(); }
}
function contact_pair_restricted(int $a,int $b): bool {
    if ($a===$b) return false;
    $s=db()->prepare('SELECT 1 FROM contact_preferences WHERE ignored=1 AND ((user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)) LIMIT 1'); $s->execute([$a,$b,$b,$a]); return (bool)$s->fetchColumn();
}
function contact_direct_peer(int $cid,int $uid): int {
    $s=db()->prepare('SELECT b.user_id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id<>? WHERE c.id=? AND c.is_group=0'); $s->execute([$uid,$uid,$cid]); return (int)$s->fetchColumn();
}
function contact_assert_conversation_allowed(int $cid,int $uid): void {
    $other=contact_direct_peer($cid,$uid);
    if ($other && contact_pair_restricted($uid,$other)) json_error('Comunicarea directă nu este disponibilă pentru acest contact, pentru că a fost ignorat.',403);
}
function contact_can_view_info(int $uid,int $other): bool {
    if (is_contact($uid,$other)) return true;
    $s=db()->prepare('SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.is_group=0 AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id=c.id)=2 LIMIT 1'); $s->execute([$uid,$other]); return (bool)$s->fetchColumn();
}
/** Filter queued notifications/signals too; cursor still advances past filtered events. */
function contact_event_allowed(int $uid,string $type,array $p,array $restricted): bool {
    if (!$restricted) return true;
    if ($type==='signal') {
        if (in_array($p['kind'] ?? '',['cancel','decline','done','busy','unavailable','call-decline','call-hangup','call-busy'],true)) return true;
        return !isset($restricted[(int)($p['from'] ?? 0)]);
    }
    if ($type==='presence') return !isset($restricted[(int)($p['user_id'] ?? 0)]);
    if ($type==='typing') return !isset($restricted[(int)($p['user_id'] ?? 0)]);
    if (in_array($type,['message','message_update','reaction','receipt','pins_update'],true)) {
        static $peers=[]; $cid=(int)($p['conversation_id'] ?? 0); $key=$uid.':'.$cid;
        if (!array_key_exists($key,$peers)) $peers[$key]=contact_direct_peer($cid,$uid);
        $other=$peers[$key];
        return !$other || !isset($restricted[$other]);
    }
    return true;
}
