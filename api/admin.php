<?php
declare(strict_types=1);
require __DIR__.'/../lib/bootstrap.php';
enforce_https(); security_headers(); header('Cache-Control: no-store');
$uid=require_auth(); tex_require_admin($uid);
$method=$_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method==='POST') require_post(); elseif ($method!=='GET') json_error('Metodă nepermisă.',405);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>4096) json_error('Cerere prea mare.',413);
$action=(string)($_GET['action'] ?? 'list');
if ($method==='GET' && $action==='session') json_out(['ok'=>true,'user_id'=>$uid,'csrf'=>csrf_token()]);
session_write_close(); $pdo=db();
if ($method==='GET' && $action==='list') {
    $q=$_GET['q'] ?? ''; if (!is_string($q) || !mb_check_encoding($q,'UTF-8') || mb_strlen($q)>64) json_error('Căutare invalidă.');
    $q=trim($q); $after=max(0,(int)($_GET['after'] ?? 0));
    $like='%'.str_replace(['!','%','_'],['!!','!%','!_'],mb_strtolower($q,'UTF-8')).'%';
    $sql="SELECT u.id,u.username,u.display_name,u.created_at,COALESCE(f.is_verified,0) AS verified,COALESCE(d.label,'') AS staff_label FROM users u LEFT JOIN account_flags f ON f.user_id=u.id LEFT JOIN account_display_labels d ON d.user_id=u.id WHERE u.id>?";
    $args=[$after]; if ($q!=='') { $sql.=" AND (LOWER(u.username) LIKE ? ESCAPE '!' OR LOWER(u.display_name) LIKE ? ESCAPE '!')"; $args[]=$like; $args[]=$like; }
    $st=$pdo->prepare($sql.' ORDER BY u.id LIMIT 51'); $st->execute($args); $rows=$st->fetchAll();
    $more=count($rows)>50; if ($more) array_pop($rows);
    $users=array_map(fn($u)=>['id'=>(int)$u['id'],'username'=>(string)$u['username'],'display_name'=>(string)$u['display_name'],'created_at'=>(int)$u['created_at'],'verified'=>(bool)$u['verified'],'staff_label'=>tex_display_label($u['staff_label'])],$rows);
    json_out(['ok'=>true,'users'=>$users,'has_more'=>$more,'next_after'=>$users ? $users[count($users)-1]['id'] : $after]);
}
if ($method==='GET' && $action==='audit') {
    $st=$pdo->query('SELECT a.id,a.actor_id,a.target_id,a.action,a.created_at,u.username AS actor_username,t.username AS target_username FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN users t ON t.id=a.target_id ORDER BY a.id DESC LIMIT 30');
    json_out(['ok'=>true,'events'=>array_map(fn($a)=>['id'=>(int)$a['id'],'actor_id'=>(int)$a['actor_id'],'target_id'=>(int)$a['target_id'],'actor'=>(string)($a['actor_username'] ?? ''),'target'=>(string)($a['target_username'] ?? ''),'action'=>(string)$a['action'],'created_at'=>(int)$a['created_at']],$st->fetchAll())]);
}
if ($method!=='POST' || !in_array($action,['verify','staff_label'],true)) json_error('Acțiune necunoscută.',404);
$in=input(); $target=$in['user_id'] ?? null; $verified=$in['verified'] ?? null; $label=$in['staff_label'] ?? null;
if (($in['actor_id'] ?? null)!==$uid) json_error('Contul conectat s-a schimbat. Reîncarcă administrarea.',409);
if (!is_int($target) || $target<1) json_error('Opțiune invalidă.');
if ($action==='verify' && !is_bool($verified)) json_error('Opțiune invalidă.');
if ($action==='staff_label' && (!is_string($label) || !in_array($label,['','ADMIN','MOD','TESTER'],true))) json_error('Etichetă invalidă.');
$mysql=$pdo->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql'; $changed=false;
$pdo->beginTransaction();
try {
    // Canonical account-lock ordering serializes cross-admin edits; role is rechecked under lock.
    $ids=[$uid,$target]; sort($ids,SORT_NUMERIC);
    $lock=$pdo->prepare('SELECT id FROM users WHERE id IN (?,?) ORDER BY id'.($mysql?' FOR UPDATE':'')); $lock->execute($ids);
    $found=array_map('intval',$lock->fetchAll(PDO::FETCH_COLUMN));
    if (!in_array($uid,$found,true) || !in_array($target,$found,true)) { $pdo->rollBack(); json_error('Cont indisponibil.',404); }
    $st=$pdo->prepare('SELECT is_admin FROM account_flags WHERE user_id=?'.($mysql?' FOR UPDATE':'')); $st->execute([$uid]);
    if ((int)$st->fetchColumn()!==1) { $pdo->rollBack(); json_error('Acces nepermis.',403); }
    if ($action==='verify') {
        $st=$pdo->prepare('SELECT is_verified FROM account_flags WHERE user_id=?'); $st->execute([$target]); $old=(int)$st->fetchColumn()===1;
        if ($old!==$verified) {
            $now=time();
            $sql='INSERT INTO account_flags (user_id,is_admin,is_verified,verified_by,verified_at,updated_at) VALUES (?,0,?,?,?,?) '.($mysql?'ON DUPLICATE KEY UPDATE is_verified=VALUES(is_verified),verified_by=VALUES(verified_by),verified_at=VALUES(verified_at),updated_at=VALUES(updated_at)':'ON CONFLICT(user_id) DO UPDATE SET is_verified=excluded.is_verified,verified_by=excluded.verified_by,verified_at=excluded.verified_at,updated_at=excluded.updated_at');
            // is_admin is deliberately NEVER changed by verification, including a badge on the admin itself.
            $pdo->prepare($sql)->execute([$target,(int)$verified,$verified?$uid:null,$verified?$now:null,$now]);
            $pdo->prepare('INSERT INTO admin_audit (actor_id,target_id,action,created_at) VALUES (?,?,?,?)')->execute([$uid,$target,$verified?'verified_granted':'verified_revoked',$now]);
            $changed=true;
        }
    } else {
        // Target's canonical users row is locked above even when no label row exists yet.
        $st=$pdo->prepare('SELECT label FROM account_display_labels WHERE user_id=?'.($mysql?' FOR UPDATE':''));
        $st->execute([$target]); $old=tex_display_label($st->fetchColumn());
        if ($old!==$label) {
            $now=time();
            $sql='INSERT INTO account_display_labels (user_id,label,updated_by,updated_at) VALUES (?,?,?,?) '.($mysql?'ON DUPLICATE KEY UPDATE label=VALUES(label),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)':'ON CONFLICT(user_id) DO UPDATE SET label=excluded.label,updated_by=excluded.updated_by,updated_at=excluded.updated_at');
            $pdo->prepare($sql)->execute([$target,$label,$uid,$now]);
            // Compare canonical before/after values, never connection ROW_COUNT accounting.
            // Label + audit either commit together or both roll back. No account_flags writes here.
            $event='label_'.strtolower($old ?: 'none').'_to_'.strtolower($label ?: 'none');
            $pdo->prepare('INSERT INTO admin_audit (actor_id,target_id,action,created_at) VALUES (?,?,?,?)')->execute([$uid,$target,$event,$now]);
            $changed=true;
        }
    }
    $pdo->commit();
} catch(Throwable $e) { if($pdo->inTransaction())$pdo->rollBack();throw $e; }
if ($changed) broadcast_profile($target);
json_out(['ok'=>true,'user_id'=>$target,'changed'=>$changed]+($action==='verify' ? ['verified'=>$verified] : ['staff_label'=>$label]));
