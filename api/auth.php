<?php
declare(strict_types=1);
require __DIR__ . '/../lib/bootstrap.php';
start_session();

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'me':
        $uid = require_auth();
        $u = get_user($uid);
        if (!$u) { session_destroy(); json_error('Neautentificat', 401); }
        json_out(['ok' => true, 'user' => public_user($u) + ['email' => $u['email']], 'settings' => $u['settings'] ? json_decode($u['settings'], true) : null, 'csrf' => csrf_token()]);

    case 'register':
        require_post();
        $in = input();
        $username = trim((string)($in['username'] ?? ''));
        $name = trim((string)($in['display_name'] ?? ''));
        $pass = (string)($in['password'] ?? '');
        if (!preg_match('/^[A-Za-z0-9_.]{3,32}$/', $username)) json_error('Numele de utilizator: 3–32 de caractere (litere, cifre, _ sau .)');
        if (!password_policy($pass)) json_error('Parola: minim 12 caractere, maxim 72 octeți.');
        recovery_throttle('signup-ip', recovery_ip(), 10, 3600);
        try { [$question, $answerHash] = recovery_fields((string)($in['security_question'] ?? ''), (string)($in['security_answer'] ?? '')); }
        catch (InvalidArgumentException $e) { json_error($e->getMessage()); }
        if ($name === '') $name = $username;
        $name = mb_substr($name, 0, 64);
        // username-ul trebuie să fie unic și să nu se confunde cu emailul unui cont mai vechi (login acceptă ambele)
        $st = db()->prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) OR (email IS NOT NULL AND LOWER(email) = LOWER(?))');
        $st->execute([$username, $username]);
        if ($st->fetchColumn()) json_error('Numele de utilizator este deja folosit');
        db()->beginTransaction();
        $st = db()->prepare('INSERT INTO users (username, email, display_name, password_hash, avatar_color, created_at, last_seen) VALUES (?,?,?,?,?,?,?)');
        $st->execute([$username, null, $name, password_hash($pass, PASSWORD_DEFAULT), random_color(), time(), time()]);
        $uid = (int)db()->lastInsertId();
        recovery_set($uid, $question, $answerHash);
        db()->commit();
        presence_touch($uid, time());
        device_auth_login($uid, recovery_auth_version($uid), get_user($uid)['password_hash']);
        json_out(['ok' => true, 'user' => public_user(get_user($uid))]);

    case 'login':
        require_post();
        $in = input();
        $login = trim((string)($in['login'] ?? ''));
        $pass = (string)($in['password'] ?? '');
        if ($login === '') json_error('Scrie username-ul');
        // username (principal); emailul e acceptat doar pentru conturile vechi care îl au completat
        $st = db()->prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1');
        $st->execute([$login]);
        $u = $st->fetch();
        if (!$u && strpos($login, '@') !== false) {
            $st = db()->prepare('SELECT * FROM users WHERE email IS NOT NULL AND LOWER(email) = LOWER(?) LIMIT 1');
            $st->execute([$login]);
            $u = $st->fetch();
        }
        $loginAuthVersion = $u ? recovery_auth_version((int)$u['id']) : 0;
        if (strlen($pass)>1024 || !$u || !password_verify($pass, $u['password_hash'])) {
            usleep(random_int(200000, 400000));
            json_error('Datele de conectare sunt incorecte');
        }
        $fresh=get_user((int)$u['id']);
        if (!$fresh || !hash_equals($fresh['password_hash'],$u['password_hash']) || $loginAuthVersion!==recovery_auth_version((int)$u['id'])) json_error('Datele de conectare sunt incorecte');
        if (password_needs_rehash($u['password_hash'], PASSWORD_DEFAULT)) {
            $newHash = password_hash($pass, PASSWORD_DEFAULT); $pdo = db();
            $pdo->beginTransaction();
            try {
                $rehash = $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?');
                $rehash->execute([$newHash, $u['id'], $u['password_hash']]);
                if ($rehash->rowCount() === 1) {
                    // A work-factor rehash is NOT a password change: preserve verified devices atomically.
                    $pdo->prepare('UPDATE auth_devices SET credential_tag=? WHERE user_id=? AND auth_version=? AND credential_tag=?')->execute([hash('sha256',$newHash), $u['id'], $loginAuthVersion, hash('sha256',$u['password_hash'])]);
                    $u['password_hash'] = $newHash;
                }
                $pdo->commit();
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $e; }
        }
        device_auth_login((int)$u['id'], $loginAuthVersion, $u['password_hash']);
        presence_touch((int)$u['id'], time());
        json_out(['ok' => true, 'user' => public_user(get_user((int)$u['id']))]);

    case 'logout':
        require_post();
        device_auth_forget_current();
        $_SESSION = [];
        $cookie = session_get_cookie_params();
        setcookie(session_name(), '', ['expires'=>time()-3600, 'path'=>$cookie['path'], 'secure'=>$cookie['secure'], 'httponly'=>true, 'samesite'=>'Lax']);
        session_destroy();
        json_out(['ok' => true]);

    case 'settings':
        require_post();
        $uid = require_auth();
        $in = input();
        $settings = $in['settings'] ?? null;
        if (!is_array($settings)) json_error('Setări invalide');
        $json = json_encode($settings, JSON_UNESCAPED_UNICODE);
        if (strlen($json) > 8000) json_error('Setări prea mari');
        db()->prepare('UPDATE users SET settings = ? WHERE id = ?')->execute([$json, $uid]);
        json_out(['ok' => true]);

    case 'profile':
        require_post();
        $uid = require_auth();
        $in = input();
        $name = trim((string)($in['display_name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 64) json_error('Nume invalid');
        $color = (string)($in['avatar_color'] ?? '');
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $color)) $color = get_user($uid)['avatar_color'];
        db()->prepare('UPDATE users SET display_name = ?, avatar_color = ? WHERE id = ?')->execute([$name, $color, $uid]);
        session_write_close();
        broadcast_profile($uid);
        json_out(['ok' => true, 'user' => public_user(get_user($uid))]);

    case 'status':
        // status tip Yahoo! Messenger: tip (disponibil / ocupat / plecat / invizibil) + mesaj
        require_post();
        $uid = require_auth();
        $in = input();
        $type = (string)($in['status'] ?? 'available');
        if (!in_array($type, STATUS_TYPES, true)) json_error('Status invalid');
        $text = trim(preg_replace('/\s+/u', ' ', (string)($in['status_text'] ?? '')));
        $text = mb_substr($text, 0, 140);
        if ($type === 'invisible' || $type === 'offline') $text = ''; // în modul invizibil/deconectat nu există mesaj de status
        db()->prepare('UPDATE users SET status_type = ?, status_text = ? WHERE id = ?')->execute([$type, $text === '' ? null : $text, $uid]);
        presence_reconcile($uid);
        session_write_close();
        broadcast_profile($uid);
        json_out(['ok' => true, 'user' => public_user(get_user($uid))]);

    case 'avatar':
        // încărcare poză de profil (multipart, câmp "avatar")
        require_post();
        $uid = require_auth();
        session_write_close();
        $f = $_FILES['avatar'] ?? null;
        if (!$f || !is_array($f) || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) json_error('Alege o imagine');
        if ($f['size'] > 8 * 1024 * 1024) json_error('Imaginea e prea mare (max. 8 MB)');
        $info = @getimagesize($f['tmp_name']);
        $types = [IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif', IMAGETYPE_WEBP => 'webp'];
        if (!$info || !isset($types[$info[2]])) json_error('Format acceptat: JPG, PNG, GIF sau WebP');
        $dir = UPLOAD_DIR . '/avatars';
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) json_error('Nu am putut crea folderul pentru pozele de profil', 500);
        $base = $uid . '_' . bin2hex(random_bytes(6));
        $rel = null;
        $isGif = $info[2] === IMAGETYPE_GIF;
        // GIF-urile rămân neatinse (avatare animate, ca la YM); restul -> pătrat 256×256 (dacă există GD)
        if (!$isGif && function_exists('imagecreatetruecolor')) {
            // unele build-uri GD nu au toate formatele => verificăm fiecare decodor
            $fn = [IMAGETYPE_JPEG => 'imagecreatefromjpeg', IMAGETYPE_PNG => 'imagecreatefrompng', IMAGETYPE_WEBP => 'imagecreatefromwebp'][$info[2]] ?? null;
            $srcImg = ($fn && function_exists($fn) && function_exists('imagepng')) ? @$fn($f['tmp_name']) : false;
            if ($srcImg) {
                if ($info[2] === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
                    $o = (int)(@exif_read_data($f['tmp_name'])['Orientation'] ?? 1);
                    if ($o === 3) $srcImg = imagerotate($srcImg, 180, 0);
                    elseif ($o === 6) $srcImg = imagerotate($srcImg, -90, 0);
                    elseif ($o === 8) $srcImg = imagerotate($srcImg, 90, 0);
                }
                $w = imagesx($srcImg); $h = imagesy($srcImg); $side = min($w, $h);
                $out = imagecreatetruecolor(256, 256);
                imagealphablending($out, false); imagesavealpha($out, true);
                imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
                imagecopyresampled($out, $srcImg, 0, 0, (int)(($w - $side) / 2), (int)(($h - $side) / 2), 256, 256, $side, $side);
                $rel = 'avatars/' . $base . '.png';
                if (!imagepng($out, UPLOAD_DIR . '/' . $rel, 6)) $rel = null;
            }
        }
        if ($rel === null) {
            $rel = 'avatars/' . $base . '.' . $types[$info[2]];
            if (!move_uploaded_file($f['tmp_name'], UPLOAD_DIR . '/' . $rel)) json_error('Nu am putut salva imaginea', 500);
        }
        $old = get_user($uid)['avatar_path'] ?? null;
        db()->prepare('UPDATE users SET avatar_path = ? WHERE id = ?')->execute([$rel, $uid]);
        if ($old && str_starts_with($old, 'avatars/') && $old !== $rel) @unlink(UPLOAD_DIR . '/' . $old);
        broadcast_profile($uid);
        json_out(['ok' => true, 'user' => public_user(get_user($uid))]);

    case 'avatar_remove':
        require_post();
        $uid = require_auth();
        session_write_close();
        $old = get_user($uid)['avatar_path'] ?? null;
        db()->prepare('UPDATE users SET avatar_path = NULL WHERE id = ?')->execute([$uid]);
        if ($old && str_starts_with($old, 'avatars/')) @unlink(UPLOAD_DIR . '/' . $old);
        broadcast_profile($uid);
        json_out(['ok' => true, 'user' => public_user(get_user($uid))]);

    default:
        json_error('Acțiune necunoscută', 404);
}
