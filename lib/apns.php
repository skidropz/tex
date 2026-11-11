<?php
declare(strict_types=1);
/**
 * Native iOS APNs + PushKit VoIP (separate from Android FCM).
 * Uses a single Apple APNs Auth Key (.p8, ES256) for both <bundle_id> and <bundle_id>.voip.
 * Never puts message text, caller name or E2E key material in push payloads.
 */
function apns_config(): array {
    $c = app_config()['apns'] ?? [];
    return (is_array($c) ? $c : []) + ['enabled' => false, 'team_id' => '', 'key_id' => '', 'key_path' => '', 'topics' => []];
}
function apns_enabled(): bool {
    $c = apns_config();
    if (empty($c['enabled']) || !function_exists('curl_init') || !function_exists('openssl_sign') || !defined('CURL_VERSION_HTTP2')) return false;
    $version = curl_version();
    if (!(($version['features'] ?? 0) & CURL_VERSION_HTTP2)) return false;
    if (!preg_match('/^[A-Z0-9]{10}$/D', (string)$c['team_id']) || !preg_match('/^[A-Z0-9]{10}$/D', (string)$c['key_id'])) return false;
    $path = realpath((string)$c['key_path']); $root = realpath(APP_ROOT);
    if (!$path || !$root || !is_file($path) || !is_readable($path) || $path === $root || str_starts_with($path, $root . DIRECTORY_SEPARATOR)) return false;
    return is_array($c['topics']) && count($c['topics']) > 0;
}
function apns_topic_allowed(string $topic, string $environment): bool {
    $topics = apns_config()['topics'];
    if (!is_array($topics)) return false;
    if (isset($topics[$topic]) && is_array($topics[$topic]) && in_array($environment, $topics[$topic], true)) return true;
    // Automatically allow PushKit VoIP topic (<bundle_id>.voip) when <bundle_id> is configured.
    if (str_ends_with($topic, '.voip')) {
        $base = substr($topic, 0, -5);
        if ($base !== '' && !str_ends_with($base, '.voip') && isset($topics[$base]) && is_array($topics[$base]) && in_array($environment, $topics[$base], true)) {
            return true;
        }
    }
    return false;
}
function apns_b64url(string $value): string { return rtrim(strtr(base64_encode($value), '+/', '-_'), '='); }
function apns_der_length(string $der, int &$at): int {
    if ($at >= strlen($der)) throw new RuntimeException('Invalid ECDSA signature');
    $n = ord($der[$at++]);
    if ($n < 128) return $n;
    $count = $n & 127;
    if ($count < 1 || $count > 2 || $at + $count > strlen($der)) throw new RuntimeException('Invalid ECDSA signature');
    $n = 0; for ($i = 0; $i < $count; $i++) $n = ($n << 8) | ord($der[$at++]);
    return $n;
}
function apns_der_to_jose(string $der): string {
    $at = 0;
    if (($der[$at++] ?? '') !== "\x30") throw new RuntimeException('Invalid ECDSA sequence');
    $length = apns_der_length($der, $at);
    if ($at + $length !== strlen($der)) throw new RuntimeException('Invalid ECDSA length');
    $out = '';
    for ($i = 0; $i < 2; $i++) {
        if (($der[$at++] ?? '') !== "\x02") throw new RuntimeException('Invalid ECDSA integer');
        $len = apns_der_length($der, $at);
        if ($len < 1 || $at + $len > strlen($der)) throw new RuntimeException('Invalid ECDSA integer length');
        $value = substr($der, $at, $len); $at += $len;
        if ((ord($value[0]) & 0x80) !== 0) throw new RuntimeException('Negative ECDSA integer');
        $value = ltrim($value, "\x00");
        if (strlen($value) > 32) throw new RuntimeException('ECDSA integer too large');
        $out .= str_pad($value, 32, "\x00", STR_PAD_LEFT);
    }
    if ($at !== strlen($der) || strlen($out) !== 64) throw new RuntimeException('Invalid ECDSA signature');
    return $out;
}
function apns_jwt(): string {
    static $jwt = null, $jwtAt = 0;
    if ($jwt !== null && (time() - $jwtAt) < 2400) return $jwt;
    if (!apns_enabled()) throw new RuntimeException('APNs disabled');
    $c = apns_config();
    $pkey = openssl_pkey_get_private((string)file_get_contents((string)$c['key_path']));
    $details = $pkey ? openssl_pkey_get_details($pkey) : false;
    if (!$pkey || !$details || ($details['type'] ?? -1) !== OPENSSL_KEYTYPE_EC || ($details['ec']['curve_name'] ?? '') !== 'prime256v1') throw new RuntimeException('APNs key is not P-256');
    $jwtAt = time();
    $header = apns_b64url(json_encode(['alg' => 'ES256', 'kid' => (string)$c['key_id']]));
    $claims = apns_b64url(json_encode(['iss' => (string)$c['team_id'], 'iat' => $jwtAt]));
    $signature = '';
    if (!openssl_sign($header . '.' . $claims, $signature, $pkey, OPENSSL_ALGO_SHA256)) throw new RuntimeException('Could not sign APNs JWT');
    return $jwt = $header . '.' . $claims . '.' . apns_b64url(apns_der_to_jose($signature));
}
function apns_ensure_shutdown(): void {
    if (empty($GLOBALS['__ios_apns_shutdown'])) {
        $GLOBALS['__ios_apns_shutdown'] = true;
        register_shutdown_function('apns_flush');
    }
}
function apns_notify_message(int $cid, int $sender, array $msg): void {
    try {
        if (!apns_enabled() || empty($msg['id']) || in_array((string)($msg['type'] ?? ''), ['', 'system'], true)) return;
        $GLOBALS['__ios_apns_queue'][] = [$cid, $sender, (int)$msg['id']];
        apns_ensure_shutdown();
    } catch (Throwable $e) { error_log('[apns] enqueue failed'); }
}
/**
 * Enqueues a PushKit VoIP push on 'call-invite' (to <bundle_id>.voip tokens ONLY),
 * or a silent background push on 'call-hangup'/'call-decline' (to <bundle_id> tokens ONLY,
 * never .voip, strictly obeying Apple's iOS 13+ CallKit reporting requirement).
 */
function apns_notify_call_signal(int $sender, int $to, string $kind, string $tid, mixed $data): void {
    try {
        if (!apns_enabled() || $sender <= 0 || $to <= 0 || $sender === $to) return;
        if (!str_starts_with($tid, 'vc_') || strlen($tid) > 64) return;
        if (!in_array($kind, ['call-invite', 'call-hangup', 'call-decline'], true)) return;
        $convId = is_array($data) ? (int)($data['convId'] ?? 0) : 0;
        $fromTab = is_array($data) ? substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string)($data['fromTab'] ?? '')), 0, 48) : '';
        $GLOBALS['__ios_apns_call_queue'][] = [$sender, $to, $kind, $tid, $convId, $fromTab];
        apns_ensure_shutdown();
    } catch (Throwable $e) { error_log('[apns] call enqueue failed'); }
}
function apns_flush(): void {
    $msgQueue = $GLOBALS['__ios_apns_queue'] ?? []; $GLOBALS['__ios_apns_queue'] = [];
    $callQueue = $GLOBALS['__ios_apns_call_queue'] ?? []; $GLOBALS['__ios_apns_call_queue'] = [];
    if (!$msgQueue && !$callQueue) return;
    if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
    elseif (function_exists('litespeed_finish_request')) @litespeed_finish_request();
    @ignore_user_abort(true); @set_time_limit(120);
    try {
        $pdo = db();
        if ($pdo->inTransaction()) return;
        $jwt = apns_jwt();
        $deliveries = [];
        $minUpdated = time() - 90 * 86400;

        foreach ($msgQueue as [$cid, $sender, $mid]) {
            $check = $pdo->prepare('SELECT id FROM messages WHERE id=? AND conversation_id=? AND sender_id=?');
            $check->execute([$mid, $cid, $sender]); if (!$check->fetchColumn()) continue;
            $to = array_values(array_filter(member_ids($cid), fn($id) => (int)$id !== $sender && !contact_pair_restricted($sender, (int)$id)));
            if (!$to) continue;
            $sql = 'SELECT token_hash,token,installation_id,user_id,topic,environment,generation FROM ios_apns_tokens WHERE user_id IN (' . implode(',', array_fill(0, count($to), '?')) . ") AND topic NOT LIKE '%.voip' AND updated_at >= ?";
            $st = $pdo->prepare($sql); $st->execute(array_merge($to, [$minUpdated]));
            foreach ($st->fetchAll() as $row) {
                if (!apns_topic_allowed((string)$row['topic'], (string)$row['environment'])) continue;
                $deliveries[] = [
                    'row' => $row,
                    'sender' => $sender,
                    'check_block' => true,
                    'push_type' => 'alert',
                    'priority' => 10,
                    'expiration' => time() + 3600,
                    'payload' => json_encode([
                        'aps' => ['alert' => ['title' => 'Tex', 'body' => 'Ai un mesaj nou.'], 'sound' => 'default'],
                        'conversation_id' => (int)$cid,
                    ], JSON_UNESCAPED_UNICODE),
                ];
            }
        }

        foreach ($callQueue as [$sender, $to, $kind, $tid, $convId, $fromTab]) {
            if (!share_conversation($sender, $to)) continue;
            if ($kind === 'call-invite') {
                if (contact_pair_restricted($sender, $to)) continue;
                $st = $pdo->prepare("SELECT token_hash,token,installation_id,user_id,topic,environment,generation FROM ios_apns_tokens WHERE user_id=? AND topic LIKE '%.voip' AND updated_at >= ?");
                $st->execute([$to, $minUpdated]);
                foreach ($st->fetchAll() as $row) {
                    if (!apns_topic_allowed((string)$row['topic'], (string)$row['environment'])) continue;
                    $deliveries[] = [
                        'row' => $row,
                        'sender' => $sender,
                        'check_block' => true,
                        'push_type' => 'voip',
                        'priority' => 10,
                        'expiration' => time() + 40,
                        'payload' => json_encode([
                            'aps' => new stdClass(),
                            'tex_voip' => [
                                'kind' => 'call-invite',
                                'transfer_id' => $tid,
                                'from' => $sender,
                                'conv_id' => $convId,
                                'from_tab' => $fromTab,
                            ],
                        ], JSON_UNESCAPED_UNICODE),
                    ];
                }
            } else {
                // Silent background push on standard topic (never .voip) to end ringing if still pending.
                $st = $pdo->prepare("SELECT token_hash,token,installation_id,user_id,topic,environment,generation FROM ios_apns_tokens WHERE user_id=? AND topic NOT LIKE '%.voip' AND updated_at >= ?");
                $st->execute([$to, $minUpdated]);
                foreach ($st->fetchAll() as $row) {
                    if (!apns_topic_allowed((string)$row['topic'], (string)$row['environment'])) continue;
                    $deliveries[] = [
                        'row' => $row,
                        'sender' => $sender,
                        'check_block' => false,
                        'push_type' => 'background',
                        'priority' => 5,
                        'expiration' => time() + 60,
                        'payload' => json_encode([
                            'aps' => ['content-available' => 1],
                            'tex_call_end' => ['transfer_id' => $tid, 'kind' => $kind],
                        ], JSON_UNESCAPED_UNICODE),
                    ];
                }
            }
        }

        if ($deliveries) apns_send_deliveries($deliveries, $jwt);
    } catch (Throwable $e) { error_log('[apns] delivery failed: ' . get_class($e)); }
}
function apns_send_deliveries(array $deliveries, string $jwt): void {
    foreach (array_chunk($deliveries, 40) as $chunk) {
        $multi = curl_multi_init(); $requests = [];
        foreach ($chunk as $item) {
            $row = $item['row'];
            if (!empty($item['check_block']) && contact_pair_restricted((int)$item['sender'], (int)$row['user_id'])) continue;
            $host = $row['environment'] === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
            $url = 'https://' . $host . '/3/device/' . $row['token'];
            $headers = [
                'authorization: bearer ' . $jwt,
                'apns-topic: ' . $row['topic'],
                'apns-push-type: ' . $item['push_type'],
                'apns-priority: ' . (int)$item['priority'],
                'apns-expiration: ' . (int)$item['expiration'],
                'content-type: application/json',
            ];
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_POST => true,
                CURLOPT_POSTFIELDS => $item['payload'],
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT => 12,
                CURLOPT_FOLLOWLOCATION => false,
            ]);
            curl_multi_add_handle($multi, $ch);
            $requests[] = [$ch, $row];
        }
        do {
            $status = curl_multi_exec($multi, $running);
            if ($running) curl_multi_select($multi, 0.5);
        } while ($running && $status === CURLM_OK);
        foreach ($requests as [$ch, $row]) {
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $httpVersion = (int)curl_getinfo($ch, CURLINFO_HTTP_VERSION);
            $body = (string)curl_multi_getcontent($ch); $reason = json_decode($body, true)['reason'] ?? '';
            if ($code === 410 && $reason === 'Unregistered') {
                db()->prepare('DELETE FROM ios_apns_tokens WHERE token_hash=? AND generation=?')->execute([$row['token_hash'], $row['generation']]);
            } elseif ($code !== 200 || $httpVersion !== CURL_HTTP_VERSION_2_0) {
                error_log('[apns] HTTP ' . $code . ' ' . preg_replace('/[^A-Za-z]/', '', (string)$reason));
            }
            curl_multi_remove_handle($multi, $ch); curl_close($ch);
        }
        curl_multi_close($multi);
    }
}
