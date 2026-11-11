<?php
/**
 * Router pentru serverul PHP încorporat (demo local):
 *   PHP_CLI_SERVER_WORKERS=8 php -S 0.0.0.0:8080 router.php
 * Blochează accesul direct la foldere private (echivalentul .htaccess).
 */
// Rezistent la cwd greșit (ex. server pornit din alt folder / workeri): lucrăm mereu din folderul aplicației
if (getcwd() !== __DIR__) @chdir(__DIR__);
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
if (preg_match('#^/(config|lib|data|sql|uploads)(/|$)|/\.|\.(md|sqlite|lock|part|bin)$#i', $path) || $path === '/install.php') {
    http_response_code(403);
    echo 'Forbidden';
    return true;
}
if ($path === '/sw.js') {
    header('Content-Type: application/javascript');
    header('Service-Worker-Allowed: /');
    header('Cache-Control: no-cache');
    readfile(__DIR__ . '/sw.js');
    return true;
}
if (str_starts_with($path, '/p2p-dl/')) { // ar trebui interceptat de service worker
    http_response_code(404);
    echo 'Descărcarea P2P necesită service worker activ. Reîncarcă pagina.';
    return true;
}
$file = __DIR__ . $path;
if ($path === '/' || $path === '') { require __DIR__ . '/index.php'; return true; }
if (is_file($file)) {
    if (str_ends_with($file, '.php')) { chdir(dirname($file)); require $file; return true; }
    return false; // fișier static
}
http_response_code(404);
echo 'Not found';
return true;
