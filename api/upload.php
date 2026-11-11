<?php
declare(strict_types=1);
/**
 * Upload pe server în bucăți (chunked) — calitate originală, fără recomprimare.
 * Fluxul: init -> chunk (repetat, body brut) -> finish.  Suportă reluare (status).
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
require_post();
session_write_close();
@set_time_limit(0);

$cfg = app_config()['app'];
$maxBytes = (int)($cfg['max_upload_bytes'] ?? 0);
$chunkBytes = (int)($cfg['chunk_bytes'] ?? 2097152);
$action = $_GET['action'] ?? '';
$pdo = db();

function att_by_token(string $token, int $uid): array
{
    $st = db()->prepare('SELECT * FROM attachments WHERE upload_token = ? AND uploader_id = ?');
    $st->execute([$token, $uid]);
    $a = $st->fetch();
    if (!$a) json_error('Upload inexistent', 404);
    return $a;
}

function ensure_upload_dir(string $sub): void
{
    $dir = UPLOAD_DIR . '/' . $sub;
    if (!is_dir($dir) && !@mkdir($dir, 0775, true)) json_error('Folderul uploads/ nu poate fi scris. Setează permisiunile 755 sau 775.', 500);
}

switch ($action) {
    case 'init':
        $in = input();
        $cid = (int)($in['conversation_id'] ?? 0);
        require_member($cid, $uid);
        contact_assert_conversation_allowed($cid,$uid);
        $name = (string)($in['name'] ?? 'fisier');
        $name = preg_replace('/[\x00-\x1F\x7F\/\\\\:*?"<>|]+/u', '_', $name);
        $name = trim($name, " .") ?: 'fisier';
        $name = mb_substr($name, 0, 200);
        $size = (int)($in['size'] ?? -1);
        if ($size < 0) json_error('Mărime invalidă');
        if ($maxBytes > 0 && $size > $maxBytes) json_error('Fișierul depășește limita serverului. Folosește transferul P2P.');
        $free = @disk_free_space(UPLOAD_DIR);
        if ($free !== false && $size > $free - 50 * 1024 * 1024) json_error('Spațiu insuficient pe server. Folosește transferul P2P.');
        $token = bin2hex(random_bytes(20));
        $sub = date('Y/m');
        ensure_upload_dir($sub);
        // Numele stocat NU păstrează extensia originală (.bin) => niciun risc de execuție pe server.
        $stored = $sub . '/' . $token . '.bin';
        if (@file_put_contents(UPLOAD_DIR . '/' . $stored . '.part', '') === false) json_error('Nu pot scrie în uploads/', 500);
        $pdo->prepare('INSERT INTO attachments (uploader_id, conversation_id, upload_token, original_name, stored_path, mime, size, received, complete, created_at) VALUES (?,?,?,?,?,?,?,0,0,?)')
            ->execute([$uid, $cid, $token, $name, $stored, 'application/octet-stream', $size, time()]);
        json_out(['ok' => true, 'token' => $token, 'chunk_bytes' => $chunkBytes]);

    case 'chunk':
        $a = att_by_token((string)($_GET['token'] ?? ''), $uid);
        contact_assert_conversation_allowed((int)$a['conversation_id'],$uid);
        if ($a['complete']) json_error('Upload deja finalizat');
        $offset = (int)($_GET['offset'] ?? -1);
        $received = (int)$a['received'];
        if ($offset !== $received) json_out(['ok' => true, 'received' => $received, 'resync' => true]);
        $part = UPLOAD_DIR . '/' . $a['stored_path'] . '.part';
        $inS = fopen('php://input', 'rb');
        $outS = fopen($part, 'ab');
        if (!$inS || !$outS) json_error('Eroare la scriere', 500);
        $written = stream_copy_to_stream($inS, $outS, $chunkBytes + 1024);
        fclose($inS); fclose($outS);
        clearstatcache(true, $part);
        $newSize = filesize($part);
        if ($newSize > (int)$a['size']) { @unlink($part); json_error('Date în plus față de mărimea declarată'); }
        $pdo->prepare('UPDATE attachments SET received = ? WHERE id = ?')->execute([$newSize, $a['id']]);
        json_out(['ok' => true, 'received' => $newSize, 'written' => $written]);

    case 'status':
        $a = att_by_token((string)(input()['token'] ?? ''), $uid);
        json_out(['ok' => true, 'received' => (int)$a['received'], 'size' => (int)$a['size'], 'complete' => (bool)$a['complete']]);

    case 'abort':
        $a = att_by_token((string)(input()['token'] ?? ''), $uid);
        if (!$a['complete']) {
            @unlink(UPLOAD_DIR . '/' . $a['stored_path'] . '.part');
            $pdo->prepare('DELETE FROM attachments WHERE id = ?')->execute([$a['id']]);
        }
        json_out(['ok' => true]);

    case 'finish':
        $in = input();
        $a = att_by_token((string)($in['token'] ?? ''), $uid);
        contact_assert_conversation_allowed((int)$a['conversation_id'],$uid);
        if ($a['complete']) json_error('Upload deja finalizat');
        $part = UPLOAD_DIR . '/' . $a['stored_path'] . '.part';
        clearstatcache(true, $part);
        if (!is_file($part) || filesize($part) !== (int)$a['size']) json_error('Upload incomplet');
        $final = UPLOAD_DIR . '/' . $a['stored_path'];
        if (!@rename($part, $final)) json_error('Nu pot finaliza fișierul', 500);
        $e2e = e2e_meta_in($in['e2e'] ?? null);
        if ($e2e) {
            // v2.0 E2E: fișierul e cifrat în browser (AES-256-GCM pe bucăți). Serverul păstrează doar octeți cifrați;
            // numele real, tipul MIME și dimensiunile sunt în metadatele cifrate ($e2e['m']).
            $type = $e2e['t'] ?? 'file';
            $pdo->prepare("UPDATE attachments SET mime = 'application/octet-stream', width = NULL, height = NULL, complete = 1, received = size WHERE id = ?")->execute([$a['id']]);
            $reply = (int)($in['reply_to_id'] ?? 0) ?: null;
            $cu = isset($in['client_uid']) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$in['client_uid']), 0, 64) : null;
            $msg = create_message((int)$a['conversation_id'], $uid, $type, null, ['e2e' => $e2e], (int)$a['id'], $reply, $cu);
            json_out(['ok' => true, 'message' => $msg]);
        }
        // Detectare MIME reală din conținut (nu din ce trimite browserul)
        $mime = 'application/octet-stream';
        if (function_exists('finfo_open')) {
            $fi = finfo_open(FILEINFO_MIME_TYPE);
            $det = $fi ? finfo_file($fi, $final) : false;
            if ($det) $mime = $det;
        } elseif (function_exists('mime_content_type')) {
            $mime = mime_content_type($final) ?: $mime;
        }
        // fallback după extensie pentru tipuri pe care libmagic le raportează generic
        $ext = strtolower(pathinfo($a['original_name'], PATHINFO_EXTENSION));
        $byExt = ['mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime', 'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'ogg' => 'audio/ogg', 'wav' => 'audio/wav', 'heic' => 'image/heic', 'avif' => 'image/avif', 'webp' => 'image/webp', 'pdf' => 'application/pdf'];
        if (in_array($mime, ['application/octet-stream', 'application/x-empty'], true) && isset($byExt[$ext])) $mime = $byExt[$ext];
        $w = $h = null;
        $type = 'file';
        $imageMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'];
        if (in_array($mime, $imageMimes, true)) {
            $info = @getimagesize($final);
            if ($info) { $w = $info[0]; $h = $info[1]; $type = 'image'; }
            // corecție orientare EXIF (doar dimensiuni; fișierul rămâne original, browserul aplică orientarea)
            if ($info && $mime === 'image/jpeg' && function_exists('exif_read_data')) {
                $exif = @exif_read_data($final);
                if (!empty($exif['Orientation']) && in_array((int)$exif['Orientation'], [5, 6, 7, 8], true)) { [$w, $h] = [$h, $w]; }
            }
        } elseif (str_starts_with($mime, 'video/')) {
            $type = 'video';
        } elseif (str_starts_with($mime, 'audio/')) {
            $type = 'audio';
        }
        if (isset($in['width'], $in['height']) && $type !== 'image' && (int)$in['width'] > 0) { $w = (int)$in['width']; $h = (int)$in['height']; }
        $pdo->prepare('UPDATE attachments SET mime = ?, width = ?, height = ?, complete = 1, received = size WHERE id = ?')->execute([$mime, $w, $h, $a['id']]);
        $reply = (int)($in['reply_to_id'] ?? 0) ?: null;
        $cu = isset($in['client_uid']) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)$in['client_uid']), 0, 64) : null;
        $caption = trim((string)($in['caption'] ?? ''));
        $msg = create_message((int)$a['conversation_id'], $uid, $type, $caption !== '' ? mb_substr($caption, 0, 2000) : null, null, (int)$a['id'], $reply, $cu);
        json_out(['ok' => true, 'message' => $msg]);

    default:
        json_error('Acțiune necunoscută', 404);
}
