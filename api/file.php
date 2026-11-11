<?php
declare(strict_types=1);
/**
 * Servește fișierele din uploads/ doar membrilor conversației, cu MIME corect,
 * suport Range (video / reluare download) și cache.
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = current_user_id();
session_write_close();
if (!$uid) { http_response_code(401); exit('Neautentificat'); }

$id = (int)($_GET['id'] ?? 0);
$st = db()->prepare('SELECT a.* FROM attachments a JOIN conversation_members cm ON cm.conversation_id = a.conversation_id AND cm.user_id = ? WHERE a.id = ? AND a.complete = 1');
$st->execute([$uid, $id]);
$a = $st->fetch();
if (!$a) { http_response_code(404); exit('Fișier inexistent'); }
$path = UPLOAD_DIR . '/' . $a['stored_path'];
if (!is_file($path)) { http_response_code(404); exit('Fișier lipsă pe disc'); }

$size = filesize($path);
// Preview bounds are enforced before any bytes leave PHP, even without streaming APIs/Content-Length.
$preview = isset($_GET['preview_cap']);
$previewCap = $preview ? filter_var($_GET['preview_cap'], FILTER_VALIDATE_INT) : 0;
$previewText = $preview && !empty($_GET['preview_text']);
if ($preview && (!$previewCap || $previewCap < 1 || $previewCap > 16 * 1048576 + 65536 || ($previewText && $previewCap > 65536))) { http_response_code(400); exit('Limită invalidă'); }
if ($preview && !$previewText && $size > $previewCap) { http_response_code(413); exit('Fișier prea mare pentru previzualizare'); }
if ($preview) @ini_set('zlib.output_compression', '0');
$mime = $a['mime'] ?: 'application/octet-stream';
$etag = '"' . sha1($a['upload_token']) . '"';
$inlineOk = preg_match('#^(image/(jpeg|png|gif|webp|avif|bmp)|video/|audio/|application/pdf$)#', $mime);
$download = !empty($_GET['download']) || !$inlineOk;

while (ob_get_level()) ob_end_clean();
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
header($preview ? 'Cache-Control: private, no-store, no-transform' : 'Cache-Control: private, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('Accept-Ranges: bytes');
if (!$preview && ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }

$fname = $a['original_name'];
$ascii = preg_replace('/[^\x20-\x7E]/', '_', $fname);
$ascii = str_replace(['"', '\\'], '_', $ascii);
header('Content-Type: ' . ($download && !$inlineOk ? 'application/octet-stream' : $mime));
header(sprintf('Content-Disposition: %s; filename="%s"; filename*=UTF-8\'\'%s', $download ? 'attachment' : 'inline', $ascii, rawurlencode($fname)));

$start = 0; $end = $size - 1;
if (!$preview && isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
    if ($m[1] === '' && $m[2] !== '') { $start = max(0, $size - (int)$m[2]); }
    else { $start = (int)$m[1]; if ($m[2] !== '') $end = min((int)$m[2], $size - 1); }
    if ($start > $end || $start >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
    http_response_code(206);
    header("Content-Range: bytes $start-$end/$size");
}
if ($previewText && $size > $previewCap) {
    $end = $previewCap - 1;
    http_response_code(206);
    header("Content-Range: bytes 0-$end/$size");
}
header('Content-Length: ' . ($end - $start + 1));
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;

@set_time_limit(0);
$fp = fopen($path, 'rb');
fseek($fp, $start);
$left = $end - $start + 1;
while ($left > 0 && !feof($fp) && !connection_aborted()) {
    $buf = fread($fp, (int)min(1048576, $left));
    if ($buf === false) break;
    echo $buf;
    flush();
    $left -= strlen($buf);
}
fclose($fp);
