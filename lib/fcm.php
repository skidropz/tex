<?php
declare(strict_types=1);

/**
 * Tex v2.1.6 — Firebase Cloud Messaging (HTTP v1) pentru aplicația Android.
 *
 *  - cont de serviciu: config/fcm-service-account.json (sau app_config()['fcm']['service_account'])
 *    — directorul config/ e blocat de .htaccess; fișierul NU se pune în zip-ul public.
 *  - OAuth2: JWT RS256 semnat cu cheia contului de serviciu → access token (scope firebase.messaging),
 *    păstrat ~55 min în data/fcm-oauth.cache.php (data/ e blocat de .htaccess).
 *  - trimitere: POST https://fcm.googleapis.com/v1/projects/<project>/messages:send
 *    DOAR-DATA, prioritate HIGH (aplicația decide afișarea: în față = notificări locale, în fundal = FCM).
 *  - push-urile se pun în coadă și se trimit DUPĂ răspunsul HTTP (fastcgi_finish_request /
 *    litespeed_finish_request), ca trimiterea unui mesaj să nu încetinească.
 *  - token-uri invalide (UNREGISTERED / NOT_FOUND / INVALID_ARGUMENT pe token) => șterse din fcm_tokens.
 * Orice eroare FCM e doar logată (error_log) — nu afectează niciodată chat-ul.
 */

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_DEFAULT_PROJECT = 'vorbitozaur-chat';

function fcm_config(): array
{
    $c = app_config()['fcm'] ?? [];
    return (is_array($c) ? $c : []) + [
        'enabled' => true,
        'service_account' => APP_ROOT . '/config/fcm-service-account.json',
        'project_id' => null,        // implicit: project_id din contul de serviciu
        'presence' => true,          // push „X s-a conectat / deconectat”
        'presence_throttle' => 60,   // secunde minime între două push-uri de prezență pentru același user
    ];
}

function fcm_service_account(): ?array
{
    static $sa = false;
    if ($sa !== false) return $sa;
    $sa = null;
    $cfg = fcm_config();
    if (empty($cfg['enabled'])) return null;
    $path = (string)$cfg['service_account'];
    if ($path === '' || !is_file($path) || !is_readable($path)) return null;
    $j = json_decode((string)file_get_contents($path), true);
    if (!is_array($j) || empty($j['client_email']) || empty($j['private_key'])) {
        error_log('[fcm] cont de serviciu invalid: ' . basename($path));
        return null;
    }
    $sa = $j;
    return $sa;
}

function fcm_enabled(): bool
{
    return fcm_service_account() !== null && function_exists('openssl_sign');
}

function fcm_project_id(): string
{
    $p = fcm_config()['project_id'] ?? null;
    if (is_string($p) && $p !== '') return $p;
    $sa = fcm_service_account();
    return (string)($sa['project_id'] ?? FCM_DEFAULT_PROJECT);
}

function fcm_b64url(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

/** Cerere HTTP POST (cURL dacă există, altfel stream). Întoarce [status, body]. */
function fcm_http_post(string $url, string $body, array $headers, int $timeout = 8): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => $timeout,
        ]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if ($resp === false) error_log('[fcm] curl: ' . curl_error($ch));
        curl_close($ch);
        return [$code, $resp === false ? '' : (string)$resp];
    }
    $ctx = stream_context_create(['http' => [
        'method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $body,
        'timeout' => $timeout, 'ignore_errors' => true,
    ]]);
    $resp = @file_get_contents($url, false, $ctx);
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) $code = (int)$m[1];
    return [$code, $resp === false ? '' : (string)$resp];
}

function fcm_token_cache_file(): string
{
    return DATA_DIR . '/fcm-oauth.cache.php';
}

/** Access token OAuth2 (cache ~55 min). $force = ignoră cache-ul (după un 401). */
function fcm_access_token(bool $force = false): ?string
{
    static $mem = null;
    if (!$force && $mem && $mem['exp'] > time() + 60) return $mem['token'];
    $file = fcm_token_cache_file();
    if (!$force && is_file($file)) {
        $raw = (string)@file_get_contents($file);
        $raw = preg_replace('/^<\?php[^\n]*\n/', '', $raw);
        $c = json_decode((string)$raw, true);
        if (is_array($c) && !empty($c['token']) && (int)($c['exp'] ?? 0) > time() + 60) {
            $mem = $c;
            return $c['token'];
        }
    }
    $sa = fcm_service_account();
    if (!$sa) return null;
    $now = time();
    $tokenUri = (string)($sa['token_uri'] ?? 'https://oauth2.googleapis.com/token');
    $jwtHead = fcm_b64url(json_encode(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => (string)($sa['private_key_id'] ?? '')]));
    $jwtClaims = fcm_b64url(json_encode([
        'iss' => $sa['client_email'], 'scope' => FCM_SCOPE, 'aud' => $tokenUri,
        'iat' => $now, 'exp' => $now + 3600,
    ]));
    $key = openssl_pkey_get_private((string)$sa['private_key']);
    if (!$key) { error_log('[fcm] cheie privată invalidă'); return null; }
    $sig = '';
    if (!openssl_sign($jwtHead . '.' . $jwtClaims, $sig, $key, OPENSSL_ALGO_SHA256)) { error_log('[fcm] openssl_sign eșuat'); return null; }
    $jwt = $jwtHead . '.' . $jwtClaims . '.' . fcm_b64url($sig);
    [$code, $resp] = fcm_http_post($tokenUri, http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $jwt,
    ]), ['Content-Type: application/x-www-form-urlencoded'], 10);
    $j = json_decode($resp, true);
    if ($code !== 200 || empty($j['access_token'])) {
        error_log('[fcm] OAuth eșuat HTTP ' . $code . ': ' . substr($resp, 0, 300));
        return null;
    }
    $mem = ['token' => (string)$j['access_token'], 'exp' => $now + min(3300, (int)($j['expires_in'] ?? 3600) - 120)];
    if (is_dir(DATA_DIR)) {
        @file_put_contents($file, "<?php http_response_code(403); exit; ?>\n" . json_encode($mem), LOCK_EX);
        @chmod($file, 0600);
    }
    return $mem['token'];
}

/** Token-urile FCM ale unor useri: [ ['user_id'=>..,'token'=>..,'platform'=>..], ... ] */
function fcm_tokens_for(array $userIds): array
{
    $userIds = array_values(array_unique(array_filter(array_map('intval', $userIds))));
    if (!$userIds) return [];
    try {
        $in = implode(',', array_fill(0, count($userIds), '?'));
        $st = db()->prepare("SELECT user_id, token, platform FROM fcm_tokens WHERE user_id IN ($in)");
        $st->execute($userIds);
        return $st->fetchAll();
    } catch (Throwable $e) {
        error_log('[fcm] tokens: ' . $e->getMessage());
        return [];
    }
}

function fcm_delete_token(string $token): void
{
    try { db()->prepare('DELETE FROM fcm_tokens WHERE token = ?')->execute([$token]); }
    catch (Throwable $e) { error_log('[fcm] delete: ' . $e->getMessage()); }
}

/**
 * Pune în coadă un push DOAR-DATA către toți destinatarii (toate dispozitivele lor).
 * $data: valori scalare (FCM cere string-uri). $opts: priority (high|normal), ttl (sec), collapse_key.
 */
function fcm_queue(array $userIds, array $data, array $opts = []): void
{
    $sender=(int)($data['sender_id'] ?? $data['user_id'] ?? 0);
    if ($sender) $userIds=array_values(array_filter($userIds,fn($to)=>!contact_pair_restricted($sender,(int)$to)));
    if (!fcm_enabled() || !$userIds) return;
    $tokens = fcm_tokens_for($userIds);
    if (!$tokens) return;
    $GLOBALS['__fcm_queue'] ??= [];
    $strData = [];
    foreach ($data as $k => $v) if ($v !== null) $strData[(string)$k] = is_bool($v) ? ($v ? '1' : '0') : (string)$v;
    foreach ($tokens as $t) $GLOBALS['__fcm_queue'][] = ['recipient_id'=>(int)$t['user_id'], 'token' => (string)$t['token'], 'data' => $strData, 'opts' => $opts];
    if (empty($GLOBALS['__fcm_shutdown'])) {
        $GLOBALS['__fcm_shutdown'] = true;
        register_shutdown_function('fcm_flush');
    }
}

/** Trimite coada (rulează la shutdown, după ce clientul a primit deja răspunsul). */
function fcm_flush(): void
{
    $q = $GLOBALS['__fcm_queue'] ?? [];
    $GLOBALS['__fcm_queue'] = [];
    if (!$q) return;
    // răspunsul către client pleacă acum; push-urile se trimit „în spate”
    if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
    elseif (function_exists('litespeed_finish_request')) @litespeed_finish_request();
    @ignore_user_abort(true);
    @set_time_limit(30);
    try { fcm_send_batch($q); }
    catch (Throwable $e) { error_log('[fcm] flush: ' . $e->getMessage()); }
}

/**
 * Trimite imediat coada (fără să închidă răspunsul) — pentru poll.php, unde scriptul mai stă
 * până la 20 s în long-poll și shutdown-ul ar întârzia push-ul de prezență.
 */
function fcm_send_now(): void
{
    $q = $GLOBALS['__fcm_queue'] ?? [];
    $GLOBALS['__fcm_queue'] = [];
    if (!$q) return;
    try { fcm_send_batch($q); }
    catch (Throwable $e) { error_log('[fcm] send_now: ' . $e->getMessage()); }
}

function fcm_build_message(array $item): array
{
    $o = $item['opts'];
    $android = ['priority' => (($o['priority'] ?? 'high') === 'normal') ? 'NORMAL' : 'HIGH'];
    if (isset($o['ttl'])) $android['ttl'] = max(0, (int)$o['ttl']) . 's';
    if (!empty($o['collapse_key'])) $android['collapse_key'] = (string)$o['collapse_key'];
    return ['message' => ['token' => $item['token'], 'data' => (object)$item['data'], 'android' => $android]];
}

/** Interpretează eroarea FCM: true = token-ul nu mai e valid (se șterge). */
function fcm_token_is_dead(int $code, string $resp): bool
{
    if ($code === 404) return true;
    $j = json_decode($resp, true);
    $err = $j['error'] ?? [];
    $status = (string)($err['status'] ?? '');
    if ($status === 'NOT_FOUND' || $status === 'UNREGISTERED') return true;
    foreach ((array)($err['details'] ?? []) as $d) {
        $ec = (string)($d['errorCode'] ?? '');
        if ($ec === 'UNREGISTERED') return true;
        if ($ec === 'INVALID_ARGUMENT' && stripos((string)($err['message'] ?? ''), 'registration token') !== false) return true;
    }
    if ($code === 400 && $status === 'INVALID_ARGUMENT' && stripos((string)($err['message'] ?? ''), 'registration token') !== false) return true;
    return false;
}

/** Trimite un lot (paralel cu curl_multi dacă există). */
function fcm_send_batch(array $items, bool $retried = false): void
{
    $items=array_filter($items,static function($it){$from=(int)($it['data']['sender_id'] ?? $it['data']['user_id'] ?? 0);$to=(int)($it['recipient_id'] ?? 0);return !$from || !$to || !contact_pair_restricted($from,$to);});
    if (!$items) return;
    $access = fcm_access_token();
    if (!$access) return;
    $url = 'https://fcm.googleapis.com/v1/projects/' . rawurlencode(fcm_project_id()) . '/messages:send';
    $headers = ['Authorization: Bearer ' . $access, 'Content-Type: application/json; charset=utf-8'];
    $results = []; // [i => [code, body]]
    if (function_exists('curl_multi_init')) {
        foreach (array_chunk($items, 50, true) as $chunk) {
            $mh = curl_multi_init();
            $hs = [];
            foreach ($chunk as $i => $it) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => json_encode(fcm_build_message($it), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    CURLOPT_HTTPHEADER => $headers,
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_CONNECTTIMEOUT => 5,
                    CURLOPT_TIMEOUT => 10,
                ]);
                curl_multi_add_handle($mh, $ch);
                $hs[$i] = $ch;
            }
            do {
                $st = curl_multi_exec($mh, $running);
                if ($running) curl_multi_select($mh, 1.0);
            } while ($running && $st === CURLM_OK);
            foreach ($hs as $i => $ch) {
                $results[$i] = [(int)curl_getinfo($ch, CURLINFO_HTTP_CODE), (string)curl_multi_getcontent($ch)];
                curl_multi_remove_handle($mh, $ch);
                curl_close($ch);
            }
            curl_multi_close($mh);
        }
    } else {
        foreach ($items as $i => $it) {
            $results[$i] = fcm_http_post($url, json_encode(fcm_build_message($it), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $headers, 10);
        }
    }
    $retry = [];
    foreach ($results as $i => [$code, $resp]) {
        if ($code >= 200 && $code < 300) continue;
        if ($code === 401 && !$retried) { $retry[$i] = $items[$i]; continue; }
        if (fcm_token_is_dead($code, $resp)) { fcm_delete_token($items[$i]['token']); continue; }
        error_log('[fcm] send HTTP ' . $code . ': ' . substr($resp, 0, 300));
    }
    if ($retry) {
        fcm_access_token(true); // token OAuth expirat/revocat => unul nou
        fcm_send_batch($retry, true);
    }
}

/* ---------- evenimente de domeniu ---------- */

/** Textul notificării pentru un mesaj (fără conținut în clar pentru mesajele E2E). */
function fcm_message_preview(array $msg): string
{
    $type = (string)($msg['type'] ?? 'text');
    $e2e = is_array($msg['meta'] ?? null) && !empty($msg['meta']['e2e']);
    if ($type === 'buzz') return 'ți-a dat BUZZ!!!';
    if ($type === 'text') {
        if ($e2e) return 'Mesaj nou';
        $b = trim(preg_replace('/\s+/u', ' ', (string)($msg['body'] ?? '')));
        return $b === '' ? 'Mesaj nou' : (mb_strlen($b) > 140 ? mb_substr($b, 0, 140) . '…' : $b);
    }
    $labels = ['image' => '📷 Imagine', 'video' => '🎬 Video', 'audio' => '🎤 Mesaj audio', 'file' => '📎 Fișier', 'p2p' => '📎 Fișier (P2P)'];
    $label = $labels[$type] ?? 'Mesaj nou';
    if (!$e2e && $type !== 'p2p') {
        $cap = trim((string)($msg['body'] ?? ''));
        if ($cap !== '') return $label . ': ' . (mb_strlen($cap) > 100 ? mb_substr($cap, 0, 100) . '…' : $cap);
    }
    return $label;
}

/** Apelat din create_message(): push la ceilalți membri (nu și la expeditor). */
function fcm_notify_message(int $convId, int $senderId, array $msg): void
{
    try {
        $type = (string)($msg['type'] ?? '');
        if ($type === 'system' || $type === '') return;
        if (!fcm_enabled()) return;
        $to = array_values(array_diff(member_ids($convId), [$senderId]));
        if (!$to) return;
        $u = get_user($senderId);
        $name = $u ? (string)($u['display_name'] ?: $u['username']) : 'Tex';
        $st = db()->prepare('SELECT is_group, title FROM conversations WHERE id = ?');
        $st->execute([$convId]);
        $c = $st->fetch() ?: ['is_group' => 0, 'title' => null];
        $st->closeCursor();
        $title = $name;
        if ((int)$c['is_group'] && trim((string)$c['title']) !== '') $title = $name . ' · ' . trim((string)$c['title']);
        $buzz = $type === 'buzz';
        fcm_queue($to, [
            'type' => $buzz ? 'buzz' : 'message',
            'msg_type' => $type,
            'conv_id' => $convId,
            'message_id' => (int)$msg['id'],
            'sender_id' => $senderId,
            'sender_name' => $name,
            'title' => $buzz ? '📳 BUZZ!!!' : $title,
            'body' => $buzz ? $name . ' ți-a dat BUZZ!!!' : fcm_message_preview($msg),
            'channel' => $buzz ? 'buzz' : 'messages',
            'ts' => (int)($msg['created_at'] ?? time()),
        ], ['priority' => 'high', 'ttl' => $buzz ? 120 : 86400]);
    } catch (Throwable $e) {
        error_log('[fcm] notify_message: ' . $e->getMessage());
    }
}

/** Apelat din poll.php când se scrie evenimentul `presence` (conectat / deconectat). */
function fcm_notify_presence(int $uid, bool $online, array $watchers): void
{
    try {
        $cfg = fcm_config();
        if (empty($cfg['presence']) || !$watchers || !fcm_enabled()) return;
        // Presence opt-in is separate from message notifications and applies to selected accounts only.
        $allowed = [];
        $query = db()->prepare('SELECT settings FROM users WHERE id=?');
        foreach ($watchers as $watcher) {
            $query->execute([(int)$watcher]); $settings = json_decode((string)($query->fetchColumn() ?: '{}'), true) ?: [];
            if (($settings['presence'] ?? false) === true && in_array($uid, array_map('intval', (array)($settings['presenceUsers'] ?? [])), true)) $allowed[] = (int)$watcher;
        }
        $watchers = $allowed; if (!$watchers) return;
        // anti-spam: tab-uri care trec des în fundal / înapoi
        $flag = DATA_DIR . '/fcm-presence-' . $uid . '.lock';
        $thr = max(0, (int)($cfg['presence_throttle'] ?? 60));
        if ($thr && is_file($flag) && time() - (int)@filemtime($flag) < $thr) return;
        if (is_dir(DATA_DIR)) @touch($flag);
        $u = get_user($uid);
        if (!$u) return;
        $name = (string)($u['display_name'] ?: $u['username']);
        $now = time();
        fcm_queue($watchers, [
            'type' => 'presence',
            'user_id' => $uid,
            'online' => $online ? '1' : '0',
            'sender_name' => $name,
            'title' => 'Tex',
            'body' => $name . ($online ? ' s-a conectat' : ' s-a deconectat'),
            'channel' => 'presence',
            'ts' => $now,
        ], ['priority' => 'normal', 'ttl' => 300, 'collapse_key' => 'presence-' . $uid]);
    } catch (Throwable $e) {
        error_log('[fcm] notify_presence: ' . $e->getMessage());
    }
}
