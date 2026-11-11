<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
enforce_https(); security_headers(); start_session(); require_post();
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) json_error('Cerere prea mare.', 413);
$action = (string)($_GET['action'] ?? ''); $in = input();
// Only canonical IPs from the web server are used, never untrusted forwarded headers.
if (random_int(1, 100) === 1) {
    db()->prepare('DELETE FROM recovery_limits WHERE expires_at < ?')->execute([time() - 3600]);
    db()->prepare('DELETE FROM recovery_grants WHERE expires_at < ?')->execute([time() - 86400]);
}
switch ($action) {
    case 'status':
        $s = recovery_security(require_auth());
        json_out(['ok'=>true, 'configured'=>!empty($s['answer_hash']), 'question'=>(string)($s['question'] ?? '')]);
    case 'setup':
        $uid = require_auth();
        recovery_throttle('setup-ip', recovery_ip(), 20, 900); recovery_throttle('setup-account', 'uid:' . $uid, 5, 900);
        $pw = (string)($in['current_password'] ?? '');
        try { [$q, $hash] = recovery_fields((string)($in['question'] ?? ''), (string)($in['answer'] ?? '')); }
        catch (InvalidArgumentException $e) { json_error($e->getMessage()); }
        $pdo=db(); $pdo->beginTransaction();
        try {
            $pdo->prepare('UPDATE users SET last_seen=last_seen WHERE id=?')->execute([$uid]);
            $u=get_user($uid);
            if ((int)($_SESSION['auth_version'] ?? 0)!==recovery_auth_version($uid) || strlen($pw)>1024 || !$u || !password_verify($pw,$u['password_hash'])) { $pdo->rollBack(); json_error('Parola curentă nu este corectă.'); }
            recovery_set($uid,$q,$hash); $pdo->commit(); unset($_SESSION['recovery_challenge']);
        } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        json_out(['ok'=>true, 'configured'=>true]);
    case 'question':
        recovery_throttle('lookup-ip', recovery_ip(), 40, 900);
        $login = mb_substr(trim((string)($in['login'] ?? '')), 0, 190);
        $u = recovery_user($login); recovery_throttle('lookup-account', recovery_account_subject($u, $login), 10, 900);
        $s = $u ? recovery_security((int)$u['id']) : null;
        $challenge = bin2hex(random_bytes(32));
        $_SESSION['recovery_challenge'] = ['id'=>$challenge, 'uid'=>!empty($s['answer_hash']) ? (int)$u['id'] : 0, 'version'=>(int)($s['recovery_version'] ?? -1), 'expires'=>time()+RECOVERY_TTL];
        // A real user-supplied public question necessarily reveals some account information.
        json_out(['ok'=>true, 'challenge'=>$challenge, 'question'=>!empty($s['answer_hash']) ? $s['question'] : 'Care este răspunsul de recuperare al contului?']);
    case 'verify':
        recovery_throttle('answer-ip', recovery_ip(), 20, 900);
        $ch = $_SESSION['recovery_challenge'] ?? [];
        $uid = (int)($ch['uid'] ?? 0);
        recovery_throttle('answer-account', 'uid:' . $uid, 5, 900);
        $s = $uid ? recovery_security($uid) : null;
        $valid = !empty($ch['id']) && hash_equals($ch['id'], (string)($in['challenge'] ?? '')) && ($ch['expires'] ?? 0) > time() && $s && (int)$s['recovery_version'] === (int)$ch['version'];
        $dummy = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
        try { $material = recovery_answer_material((string)($in['answer'] ?? '')); }
        catch (InvalidArgumentException $e) { $material = ''; $valid = false; }
        $verified = password_verify($material, $valid ? $s['answer_hash'] : $dummy);
        if (!$valid || !$verified) json_error(RECOVERY_GENERIC);
        unset($_SESSION['recovery_challenge']); session_regenerate_id(true);
        $grant = recovery_grant($uid, (int)$s['recovery_version']); $_SESSION['recovery_grant_uid'] = $uid;
        json_out(['ok'=>true, 'grant'=>$grant, 'expires_in'=>RECOVERY_TTL]);
    case 'reset':
        recovery_throttle('reset-ip', recovery_ip(), 20, 3600);
        recovery_throttle('reset-account', 'uid:' . (int)($_SESSION['recovery_grant_uid'] ?? 0), 5, 3600);
        $pw = (string)($in['password'] ?? '');
        if (!password_policy($pw)) json_error('Parola nouă: minim 12 caractere, maxim 72 octeți.');
        if (($in['ack_e2e'] ?? false) !== true) json_error('Confirmă avertismentul despre istoricul criptat.');
        if (!recovery_reset((string)($in['grant'] ?? ''), $pw)) json_error(RECOVERY_GENERIC);
        device_auth_forget_current();
        unset($_SESSION['recovery_grant_uid']);
        session_regenerate_id(true);
        json_out(['ok'=>true, 'e2e_warning'=>true]);
    default: json_error('Acțiune necunoscută.', 404);
}
