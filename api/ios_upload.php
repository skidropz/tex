<?php
declare(strict_types=1);
/** Locked, resumable upload chunks for the native iOS client.
 * init/finish remain on the existing upload.php. No plaintext fallback. */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
$action = (string)($_GET['action'] ?? '');
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && $action === 'capabilities') {
    session_write_close();
    json_out(['ok' => true, 'resumable' => function_exists('flock')]);
}
require_post();
session_write_close();
if (!in_array($action, ['chunk', 'status'], true)) json_error('Acțiune necunoscută', 404);
$token = $action === 'chunk' ? (string)($_GET['token'] ?? '') : (string)(input()['token'] ?? '');
if (!preg_match('/^[0-9a-f]{40}$/D', $token)) json_error('Token invalid');
$pdo = db();
$st = $pdo->prepare('SELECT * FROM attachments WHERE upload_token = ? AND uploader_id = ?');
$st->execute([$token, $uid]);
$a = $st->fetch();
if (!$a) json_error('Upload inexistent', 404);
$cid = (int)$a['conversation_id'];
require_member($cid, $uid);
contact_assert_conversation_allowed($cid, $uid);
$relative = (string)$a['stored_path'];
if (!preg_match('#^\d{4}/\d{2}/' . preg_quote($token, '#') . '\.bin$#D', $relative)) json_error('Cale de upload invalidă', 500);
$part = UPLOAD_DIR . '/' . $relative . '.part';
// Lock file is intentionally retained: unlinking it would allow two processes
// to lock different inodes. Upload cleanup may delete it after all activity ends.
$lock = @fopen($part . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX)) json_error('Nu pot bloca uploadul', 503);
$st->execute([$token, $uid]); $a = $st->fetch();
if (!$a) json_error('Upload inexistent', 404);
if ((int)$a['complete'] !== 0) json_out(['ok' => true, 'received' => (int)$a['size'], 'size' => (int)$a['size'], 'complete' => true]);
clearstatcache(true, $part);
$received = is_file($part) ? filesize($part) : false;
$size = (int)$a['size'];
if ($received === false || $received < 0 || $received > $size) json_error('Stare de upload invalidă', 409);
// Recover a crash between file write and DB update; the file is the source of truth.
if ($received !== (int)$a['received']) $pdo->prepare('UPDATE attachments SET received=? WHERE id=?')->execute([$received, (int)$a['id']]);
if ($action === 'status') json_out(['ok' => true, 'received' => $received, 'size' => $size, 'complete' => false]);
$offset = (int)($_GET['offset'] ?? -1);
if ($offset !== $received) json_out(['ok' => true, 'received' => $received, 'resync' => true]);
$chunk = max(1, min(16 * 1048576, (int)(app_config()['app']['chunk_bytes'] ?? 2097152)));
$input = fopen('php://input', 'rb'); $tmp = fopen('php://temp/maxmemory:2097152', 'w+b');
if (!$input || !$tmp) json_error('Nu pot citi datele', 500);
$length = stream_copy_to_stream($input, $tmp, $chunk + 1);
if ($length === false || $length <= 0 || $length > $chunk || $length > $size - $received) json_error('Segment de upload invalid', 400);
rewind($tmp);
$out = fopen($part, 'ab');
if (!$out) json_error('Nu pot scrie segmentul', 500);
$written = stream_copy_to_stream($tmp, $out);
fflush($out);
if (function_exists('fsync')) @fsync($out);
fclose($out); fclose($tmp); fclose($input);
clearstatcache(true, $part);
$new = filesize($part);
if ($written !== $length || $new !== $received + $length) json_error('Scriere incompletă; reia de la starea confirmată', 503);
$pdo->prepare('UPDATE attachments SET received=? WHERE id=?')->execute([$new, (int)$a['id']]);
json_out(['ok' => true, 'received' => $new, 'written' => $written]);
