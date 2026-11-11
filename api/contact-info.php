<?php
declare(strict_types=1);
require __DIR__.'/../lib/bootstrap.php';
$uid=require_auth(); $method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method!=='GET') require_post();
session_write_close(); header('Cache-Control: no-store');
$in=$method==='GET' ? $_GET : input(); $other=(int)($in['user_id'] ?? 0);
if ($other<1 || $other===$uid || !contact_can_view_info($uid,$other)) json_error('Contact indisponibil.',404);
$user=get_user($other); if (!$user) json_error('Contact indisponibil.',404);
$pdo=db(); $action=(string)($_GET['action'] ?? 'info');
if ($method!=='GET') {
    $mysql=$pdo->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql';
    if ($action==='alias') {
        $alias=$in['alias'] ?? ''; if (!is_string($alias) || !mb_check_encoding($alias,'UTF-8')) json_error('Nume invalid.');
        $alias=trim(preg_replace('/\s+/u',' ',$alias));
        if (mb_strlen($alias)>64 || preg_match('/[\x00-\x1F\x7F]/u',$alias)) json_error('Numele poate avea maximum 64 de caractere, fără caractere de control.');
        $sql='INSERT INTO contact_preferences (user_id,contact_id,alias,ignored,updated_at) VALUES (?,?,?,0,?) '.($mysql?'ON DUPLICATE KEY UPDATE alias=VALUES(alias),updated_at=VALUES(updated_at)':'ON CONFLICT(user_id,contact_id) DO UPDATE SET alias=excluded.alias,updated_at=excluded.updated_at');
        $pdo->prepare($sql)->execute([$uid,$other,$alias,time()]);
    } elseif ($action==='ignore') {
        if (!is_bool($in['ignored'] ?? null)) json_error('Opțiunea de ignorare este invalidă.');
        $sql="INSERT INTO contact_preferences (user_id,contact_id,alias,ignored,updated_at) VALUES (?,?,'',?,?) ".($mysql?'ON DUPLICATE KEY UPDATE ignored=VALUES(ignored),updated_at=VALUES(updated_at)':'ON CONFLICT(user_id,contact_id) DO UPDATE SET ignored=excluded.ignored,updated_at=excluded.updated_at');
        $pdo->beginTransaction();
        try {
            contact_lock_pair($pdo,$uid,$other);
            $pdo->prepare($sql)->execute([$uid,$other,(int)$in['ignored'],time()]);
            $pdo->commit();
        } catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack();throw $e; }
        // No alias or private preference is sent to the peer; only the communication gate.
        $restricted=contact_pair_restricted($uid,$other);
        push_event([$uid],'contact_gate',['user_id'=>$other,'restricted'=>$restricted]);
        push_event([$other],'contact_gate',['user_id'=>$uid,'restricted'=>$restricted]);
    } else json_error('Acțiune necunoscută.',404);
    $st=$pdo->prepare('SELECT alias,ignored FROM contact_preferences WHERE user_id=? AND contact_id=?'); $st->execute([$uid,$other]); $p=$st->fetch();
    $preference=['user_id'=>$other,'alias'=>(string)$p['alias'],'ignored'=>(bool)$p['ignored']];
    push_event([$uid],'contact_preference',$preference);
    json_out(['ok'=>true,'preference'=>$preference,'restricted'=>contact_pair_restricted($uid,$other)]);
}
if ($action!=='info') json_error('Acțiune necunoscută.',404);
$st=$pdo->prepare("SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.is_group=0 AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id=c.id)=2 AND m.sender_id IN (?,?) AND m.type<>'system'"); $st->execute([$uid,$other,$uid,$other]); $count=(int)$st->fetchColumn();
$st=$pdo->prepare('SELECT alias,ignored FROM contact_preferences WHERE user_id=? AND contact_id=?'); $st->execute([$uid,$other]); $p=$st->fetch() ?: ['alias'=>'','ignored'=>0];
$created=(int)($user['created_at'] ?? 0); $now=time(); if ($created<=0 || $created>$now) $created=null;
json_out(['ok'=>true,'contact'=>['id'=>$other,'display_name'=>(string)$user['display_name'],'username'=>(string)$user['username'],'verified'=>!empty($user['tex_verified']),'staff_label'=>tex_display_label($user['tex_display_label'] ?? ''),'created_at'=>$created,'age_seconds'=>$created!==null?$now-$created:null,'message_count'=>$count], 'preference'=>['user_id'=>$other,'alias'=>(string)$p['alias'],'ignored'=>(bool)$p['ignored']], 'restricted'=>contact_pair_restricted($uid,$other)]);
