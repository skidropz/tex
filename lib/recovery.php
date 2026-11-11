<?php
declare(strict_types=1);
const RECOVERY_TTL = 300;
const RECOVERY_GENERIC = 'Verificarea nu a reușit sau a expirat. Reîncearcă mai târziu.';
// No answer plaintext is stored, logged, sent back or placed in a URL.
function recovery_normalize(string $answer): string
{
    if (!mb_check_encoding($answer, 'UTF-8') || strlen($answer) > 1024) throw new InvalidArgumentException('Răspuns invalid.');
    return mb_strtolower(trim((string)preg_replace('/\s+/u', ' ', $answer)), 'UTF-8');
}
function recovery_answer_material(string $answer): string
{
    // A 64-character prehash also avoids bcrypt's 72-byte input truncation for Unicode answers.
    return base64_encode(hash('sha384', "TexRecovery:v1\0" . recovery_normalize($answer), true));
}
function recovery_fields(string $question, string $answer): array
{
    $q = trim((string)preg_replace('/\s+/u', ' ', $question));
    $n = recovery_normalize($answer);
    if (!mb_check_encoding($q, 'UTF-8') || mb_strlen($q) < 10 || mb_strlen($q) > 200 || preg_match('/[\x00-\x1f\x7f]/u', $q)) throw new InvalidArgumentException('Întrebarea: 10–200 caractere, fără caractere de control.');
    if (mb_strlen($n) < 8 || mb_strlen($n) > 256) throw new InvalidArgumentException('Răspunsul: 8–256 caractere. Alege un răspuns greu de ghicit.');
    return [$q, password_hash(recovery_answer_material($answer), PASSWORD_DEFAULT)];
}
function password_policy(string $password): bool
{
    return mb_check_encoding($password, 'UTF-8') && mb_strlen($password) >= 12 && strlen($password) <= 72 && !str_contains($password, "\0");
}
function recovery_security(int $uid): ?array
{
    $s = db()->prepare('SELECT * FROM user_security WHERE user_id = ?'); $s->execute([$uid]);
    return $s->fetch() ?: null;
}
function recovery_auth_version(int $uid): int { return (int)(recovery_security($uid)['auth_version'] ?? 0); }
function recovery_set(int $uid, string $question, string $answerHash): void
{
    $pdo = db();
    $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $sql = 'INSERT INTO user_security (user_id, question, answer_hash, recovery_version, updated_at) VALUES (?,?,?,1,?) ';
    $sql .= $mysql ? 'ON DUPLICATE KEY UPDATE question=VALUES(question), answer_hash=VALUES(answer_hash), recovery_version=recovery_version+1, updated_at=VALUES(updated_at)'
        : 'ON CONFLICT(user_id) DO UPDATE SET question=excluded.question, answer_hash=excluded.answer_hash, recovery_version=user_security.recovery_version+1, updated_at=excluded.updated_at';
    $pdo->prepare($sql)->execute([$uid, $question, $answerHash, time()]);
    $pdo->prepare('DELETE FROM recovery_grants WHERE user_id = ?')->execute([$uid]);
}
/** Atomic fixed-window counters; account keys resolve to uid, including legacy email aliases. */
function recovery_limit(string $operation, string $subject, int $limit, int $seconds, ?int $now = null): bool
{
    $now = $now ?? time(); $end = (intdiv($now, $seconds) + 1) * $seconds;
    $key = hash('sha256', $operation . '|' . $subject . '|' . intdiv($now, $seconds));
    $pdo = db(); $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $sql = 'INSERT INTO recovery_limits (bucket_key, hits, expires_at) VALUES (?,1,?) ' . ($mysql
        ? 'ON DUPLICATE KEY UPDATE hits=hits+1' : 'ON CONFLICT(bucket_key) DO UPDATE SET hits=recovery_limits.hits+1');
    $pdo->prepare($sql)->execute([$key, $end]);
    $s = $pdo->prepare('SELECT hits FROM recovery_limits WHERE bucket_key = ?'); $s->execute([$key]);
    return (int)$s->fetchColumn() <= $limit;
}
function recovery_throttle(string $op, string $subject, int $max, int $seconds): void
{
    if (!recovery_limit($op, $subject, $max, $seconds)) { header('Retry-After: ' . $seconds); json_error('Prea multe încercări. Reîncearcă mai târziu.', 429); }
}
function recovery_ip(): string { return 'ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'); }
function recovery_user(string $login): ?array
{
    $s = db()->prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR (email IS NOT NULL AND LOWER(email)=LOWER(?)) LIMIT 1');
    $s->execute([$login, $login]); return $s->fetch() ?: null;
}
function recovery_account_subject(?array $user, string $login): string
{
    return $user ? 'uid:' . $user['id'] : 'login:' . mb_strtolower($login, 'UTF-8');
}
function recovery_grant(int $uid, int $version): string
{
    $token = bin2hex(random_bytes(32));
    db()->prepare('INSERT INTO recovery_grants (token_hash,user_id,session_hash,recovery_version,expires_at) VALUES (?,?,?,?,?)')
        ->execute([hash('sha256', $token), $uid, hash('sha256', session_id()), $version, time() + RECOVERY_TTL]);
    return $token;
}
/** Transactional claim + credential update. Failure cannot leave a reusable consumed grant. */
function recovery_reset(string $token, string $password, ?int $now = null): bool
{
    if (!preg_match('/^[a-f0-9]{64}$/D', $token) || !password_policy($password)) return false;
    $now = $now ?? time(); $pdo = db(); $mysql = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql';
    $pdo->beginTransaction();
    try {
        $owner=$pdo->prepare('SELECT user_id FROM recovery_grants WHERE token_hash=? AND session_hash=?'); $owner->execute([hash('sha256',$token),hash('sha256',session_id())]); $ownerId=(int)$owner->fetchColumn();
        if (!$ownerId) { $pdo->rollBack(); return false; }
        $pdo->prepare('UPDATE users SET last_seen=last_seen WHERE id=?')->execute([$ownerId]);
        $s = $pdo->prepare('SELECT g.*, s.recovery_version AS current_version FROM recovery_grants g JOIN user_security s ON s.user_id=g.user_id WHERE g.token_hash=?' . ($mysql ? ' FOR UPDATE' : ''));
        $s->execute([hash('sha256', $token)]); $grant = $s->fetch();
        if (!$grant || $grant['consumed_at'] !== null || (int)$grant['expires_at'] <= $now || !hash_equals($grant['session_hash'], hash('sha256', session_id())) || (int)$grant['recovery_version'] !== (int)$grant['current_version']) { $pdo->rollBack(); return false; }
        $s = $pdo->prepare('UPDATE recovery_grants SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?');
        $s->execute([$now, hash('sha256', $token), $now]);
        if ($s->rowCount() !== 1) { $pdo->rollBack(); return false; }
        $pdo->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute([password_hash($password, PASSWORD_DEFAULT), $grant['user_id']]);
        $pdo->prepare('UPDATE user_security SET auth_version=auth_version+1, recovery_version=recovery_version+1, updated_at=? WHERE user_id=?')->execute([$now, $grant['user_id']]);
        $pdo->prepare('DELETE FROM auth_devices WHERE user_id=?')->execute([$grant['user_id']]);
        $pdo->prepare('UPDATE recovery_grants SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL')->execute([$now, $grant['user_id']]);
        // Never delete, replace or rewrap user_keys/conversation_keys: old password is not known here.
        $pdo->commit(); return true;
    } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
}
