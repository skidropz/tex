<?php
declare(strict_types=1);
/** Servește poza de profil a unui user (doar pentru utilizatori autentificați). */
require __DIR__ . '/../lib/bootstrap.php';
require_auth();
session_write_close();
$u = get_user((int)($_GET['u'] ?? 0));
$rel = $u['avatar_path'] ?? null;
if (!$rel || !preg_match('#^avatars/[A-Za-z0-9_]+\.(png|jpg|gif|webp)$#', $rel) || !is_file(UPLOAD_DIR . '/' . $rel)) {
    http_response_code(404);
    exit;
}
$path = UPLOAD_DIR . '/' . $rel;
$mime = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp'][pathinfo($path, PATHINFO_EXTENSION)];
$etag = '"' . md5($rel . filemtime($path)) . '"';
header('Content-Type: ' . $mime);
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=31536000, immutable');
header('ETag: ' . $etag);
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
header('Content-Length: ' . filesize($path));
readfile($path);
