<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth(); $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') require_post();
session_write_close();
$in = $method === 'GET' ? $_GET : input();
$cid = (int)($in['conversation_id'] ?? 0); require_member($cid, $uid);
$pdo = db(); $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
$st = $pdo->prepare('SELECT cleared_id FROM conversation_members WHERE conversation_id=? AND user_id=?'); $st->execute([$cid,$uid]); $cleared = (int)$st->fetchColumn();
$action = (string)($_GET['action'] ?? '');
if ($method === 'GET') {
    if ($action === 'gallery') {
        $before = max(0,(int)($in['before_id'] ?? 0)); $limit = max(1,min(50,(int)($in['limit'] ?? 30)));
        $types = ['all'=>['image','video','audio','file','p2p'],'photos'=>['image'],'videos'=>['video'],'files'=>['audio','file','p2p']];
        $chosen = $types[(string)($in['filter'] ?? 'all')] ?? $types['all']; $ph = implode(',',array_fill(0,count($chosen),'?'));
        $sql = "SELECT m.* FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id AND a.conversation_id=m.conversation_id WHERE m.conversation_id=? AND m.id>? AND m.type IN ($ph) AND (m.type='p2p' OR a.complete=1)";
        $params = array_merge([$cid,$cleared],$chosen); if ($before) { $sql .= ' AND m.id<?'; $params[]=$before; }
        $st = $pdo->prepare($sql . ' ORDER BY m.id DESC LIMIT ' . ($limit+1)); $st->execute($params); $rows=$st->fetchAll(); $more=count($rows)>$limit; $rows=array_slice($rows,0,$limit);
        json_out(['ok'=>true,'messages'=>format_messages($rows),'has_more'=>$more,'next_before'=>$rows ? (int)end($rows)['id'] : 0]);
    }
    if ($action === 'pins') {
        $pdo->exec('DELETE FROM message_edits WHERE message_id NOT IN (SELECT id FROM messages)');
        // Physical deletion cannot leave a retrievable orphan, even after an external maintenance cleanup.
        $pdo->prepare('DELETE FROM conversation_pins WHERE conversation_id=? AND message_id NOT IN (SELECT id FROM messages WHERE conversation_id=?)')->execute([$cid,$cid]);
        $st=$pdo->prepare('SELECT m.* FROM conversation_pins p JOIN messages m ON m.id=p.message_id AND m.conversation_id=p.conversation_id WHERE p.conversation_id=? AND m.id>? ORDER BY p.pinned_at DESC,p.message_id DESC LIMIT 100'); $st->execute([$cid,$cleared]);
        json_out(['ok'=>true,'messages'=>format_messages($st->fetchAll())]);
    }
    if ($action === 'around') {
        $mid=(int)($in['message_id'] ?? 0);
        $st=$pdo->prepare('SELECT id FROM messages WHERE id=? AND conversation_id=? AND id>?'); $st->execute([$mid,$cid,$cleared]); if (!$st->fetchColumn()) json_error('Mesaj indisponibil.',404);
        $st=$pdo->prepare('SELECT * FROM messages WHERE conversation_id=? AND id>? AND id<=? ORDER BY id DESC LIMIT 31'); $st->execute([$cid,$cleared,$mid]); $rows=array_reverse($st->fetchAll());
        $first=(int)$rows[0]['id']; $st=$pdo->prepare('SELECT * FROM messages WHERE conversation_id=? AND id>? ORDER BY id LIMIT 20'); $st->execute([$cid,$mid]); $rows=array_merge($rows,$st->fetchAll());
        $st=$pdo->prepare('SELECT id FROM messages WHERE conversation_id=? AND id>? AND id<? LIMIT 1'); $st->execute([$cid,$cleared,$first]);
        json_out(['ok'=>true,'messages'=>format_messages($rows),'has_more'=>(bool)$st->fetchColumn()]);
    }
    json_error('Acțiune necunoscută.',404);
}
contact_assert_conversation_allowed($cid,$uid);
$mid=(int)($in['message_id'] ?? 0);
if (!in_array($action,['pin','edit'],true)) json_error('Acțiune necunoscută.',404);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>100000) json_error('Cerere prea mare.',413);
$pdo->beginTransaction();
try {
    // Serialize pin limit and edits with destruction of the same conversation. SQLite obtains its write lock here.
    $pdo->prepare('UPDATE conversations SET updated_at=updated_at WHERE id=?')->execute([$cid]);
    $membership=$pdo->prepare('SELECT cleared_id FROM conversation_members WHERE conversation_id=? AND user_id=?' . ($mysql ? ' FOR UPDATE' : '')); $membership->execute([$cid,$uid]); $memberRow=$membership->fetch();
    if (!$memberRow) { $pdo->rollBack(); json_error('Conversație inexistentă',404); }
    $cleared=(int)$memberRow['cleared_id'];
    $st=$pdo->prepare('SELECT * FROM messages WHERE id=? AND conversation_id=? AND id>?' . ($mysql ? ' FOR UPDATE' : '')); $st->execute([$mid,$cid,$cleared]); $m=$st->fetch();
    if (!$m) { $pdo->rollBack(); json_error('Mesaj indisponibil.',404); }
    if ($action==='pin') {
        if ($m['type']==='system') { $pdo->rollBack(); json_error('Acest mesaj nu poate fi fixat.'); }
        $pin=($in['pinned'] ?? false)===true;
        if ($pin) {
            $st=$pdo->prepare('SELECT COUNT(*) FROM conversation_pins WHERE conversation_id=?'); $st->execute([$cid]); $count=(int)$st->fetchColumn();
            $st=$pdo->prepare('SELECT message_id FROM conversation_pins WHERE conversation_id=? AND message_id=?'); $st->execute([$cid,$mid]);
            if (!$st->fetchColumn() && $count>=100) { $pdo->rollBack(); json_error('Maximum 100 de mesaje fixate într-o conversație.'); }
            $sql=$mysql ? 'INSERT IGNORE INTO conversation_pins (conversation_id,message_id,pinned_by,pinned_at) VALUES (?,?,?,?)' : 'INSERT INTO conversation_pins (conversation_id,message_id,pinned_by,pinned_at) VALUES (?,?,?,?) ON CONFLICT(conversation_id,message_id) DO NOTHING';
            $pdo->prepare($sql)->execute([$cid,$mid,$uid,time()]);
        } else $pdo->prepare('DELETE FROM conversation_pins WHERE conversation_id=? AND message_id=?')->execute([$cid,$mid]);
        $pdo->commit(); push_event(member_ids($cid),'pins_update',['conversation_id'=>$cid]); json_out(['ok'=>true]);
    }
    if ((int)$m['sender_id']!==$uid) { $pdo->rollBack(); json_error('Poți edita doar mesajele tale.',403); }
    if ($m['type']!=='text' && (!$m['attachment_id'] || !in_array($m['type'],['image','video','audio','file'],true))) { $pdo->rollBack(); json_error('Acest tip de mesaj nu poate fi editat.'); }
    $st=$pdo->prepare('SELECT revision FROM message_edits WHERE message_id=?'); $st->execute([$mid]); $revision=(int)$st->fetchColumn();
    if ($revision!==(int)($in['if_revision'] ?? -1)) { $pdo->rollBack(); json_error('Mesajul a fost modificat între timp. Redeschide editorul.',409); }
    $body=(string)($in['body'] ?? ''); $meta=$m['meta'] ? json_decode($m['meta'],true) : [];
    $oldEncrypted=!empty($meta['e2e']);
    if ($oldEncrypted) {
        $e=e2e_meta_in($in[$m['type']==='text' ? 'e2e' : 'caption_e2e'] ?? null);
        if (!$e || !preg_match('#^[A-Za-z0-9+/=]{16,60000}$#D',$body)) { $pdo->rollBack(); json_error('Editare criptată invalidă.'); }
        if ($m['type']==='text') $meta['e2e']=$e; else $meta['caption_e2e']=$e; // binary IV/chunks/file metadata remain untouched
    } else {
        if (!empty($in['e2e']) || !empty($in['caption_e2e'])) { $pdo->rollBack(); json_error('Modul de criptare al mesajului nu se schimbă prin editare.'); }
        $body=preg_replace('/\r\n?/',"\n",$body);
        if (!mb_check_encoding($body,'UTF-8') || mb_strlen($body)>($m['type']==='text' ? 10000 : 2000) || ($m['type']==='text' && trim($body)==='')) { $pdo->rollBack(); json_error('Text gol sau prea lung.'); }
    }
    $pdo->prepare('UPDATE messages SET body=?,meta=? WHERE id=? AND conversation_id=? AND sender_id=?')->execute([$body,$meta ? json_encode($meta,JSON_UNESCAPED_UNICODE) : null,$mid,$cid,$uid]);
    $sql='INSERT INTO message_edits (message_id,edited_at,revision) VALUES (?,?,1) ' . ($mysql ? 'ON DUPLICATE KEY UPDATE edited_at=VALUES(edited_at), revision=revision+1' : 'ON CONFLICT(message_id) DO UPDATE SET edited_at=excluded.edited_at,revision=message_edits.revision+1'); $pdo->prepare($sql)->execute([$mid,time()]);
    $pdo->commit(); $message=get_message($mid); push_event(member_ids($cid),'message_update',$message); json_out(['ok'=>true,'message'=>$message]);
} catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
