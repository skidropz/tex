<?php
/**
 * Copiază acest fișier ca  config/config.php  și completează datele bazei de date.
 * (Sau rulează install.php din browser – îl creează automat.)
 *
 * Dacă config/config.php NU există, aplicația folosește automat SQLite în data/messenger.sqlite
 * (potrivit doar pentru demo local).
 */
return [
    'db' => [
        'driver'   => 'mysql',          // 'mysql' (cPanel) sau 'sqlite' (demo local)
        'host'     => 'localhost',
        'port'     => 3306,
        'name'     => 'cpaneluser_messenger',
        'user'     => 'cpaneluser_msguser',
        'pass'     => 'PAROLA_TA_AICI',
        'charset'  => 'utf8mb4',
        // doar pentru sqlite:
        'sqlite_path' => __DIR__ . '/../data/messenger.sqlite',
    ],
    'app' => [
        'name'              => 'VORBITozaur',
        // Cât ține un long-poll (secunde). Pe hosting partajat 20–25 e o valoare bună.
        'poll_timeout'      => 20,
        // Limită pentru upload pe server (fallback HTTP), în bytes. 0 = fără limită (doar spațiul pe disc).
        'max_upload_bytes'  => 0,
        // Mărimea unei bucăți (chunk) la upload. Trebuie să fie < post_max_size din PHP.
        'chunk_bytes'       => 2 * 1024 * 1024,
        // Forțează cookie "secure" (setează true dacă site-ul e doar pe HTTPS). null = auto-detect.
        'secure_cookies'    => null,
        // v2.0: redirecționează automat http:// -> https:// (ignorat pe localhost). Pune false doar dacă
        // hostul face deja redirectul sau nu ai încă certificat SSL (AutoSSL / Let's Encrypt din cPanel).
        'force_https'       => true,
        // v2.0: trimite antetul HSTS (browserul ține minte să folosească doar HTTPS 1 an). Doar pe HTTPS.
        'hsts'              => true,
    ],
    // v2.1.6: push Firebase Cloud Messaging (aplicația Android, în fundal / închisă).
    // Pune fișierul JSON al contului de serviciu Firebase în  config/fcm-service-account.json
    // (directorul config/ e blocat de .htaccess; NU-l pune nicăieri public și nu-l urca în git/zip).
    // Fără fișier => push-ul e pur și simplu dezactivat (chat-ul merge normal).
    'fcm' => [
        'enabled'           => true,
        'service_account'   => __DIR__ . '/fcm-service-account.json',
        // 'project_id'     => 'vorbitozaur-chat',   // implicit: project_id din fișierul de mai sus
        'presence'          => true,                 // push „X s-a conectat / deconectat”
        'presence_throttle' => 60,                   // secunde între două push-uri de prezență ale aceluiași user
    ],
    // Servere ICE pentru WebRTC (P2P). STUN public implicit. Adaugă un TURN pentru rețele restrictive (NAT simetric).
    'ice_servers' => [
        ['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']],
        // ['urls' => 'turn:turn.exemplu.ro:3478', 'username' => 'user', 'credential' => 'parola'],
    ],
];
