<?php
declare(strict_types=1);
/**
 * Căutare GLOBALĂ de utilizatori — folosită de butonul „Adaugă”.
 * v2.0.2: caută în TOȚI utilizatorii (username / nume afișat / email exact), acceptă „@username”,
 * nu mai depinde de mbstring, folosește NOT EXISTS (robust la NULL) și întoarce separat:
 *   users    = oameni noi (NU sunt în contacte) — cu buton „Adaugă”
 *   contacts = potriviri care sunt deja în contacte (doar informativ, ca rezultatul să nu pară gol)
 */
require __DIR__ . '/../lib/bootstrap.php';
$uid = require_auth();
session_write_close();

$q = trim((string)($_GET['q'] ?? ''));
$q = ltrim($q, "@ \t");
if ($q === '') json_out(['ok' => true, 'users' => [], 'contacts' => []]);
$lower = function_exists('mb_strtolower') ? mb_strtolower($q, 'UTF-8') : strtolower($q);
// Caracter de escape portabil („!”): `ESCAPE '\\'` e eroare de sintaxă în MySQL
$like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $lower) . '%';
$email = strpos($q, '@') !== false ? $lower : "\x01-no-email-\x01";
$sql = "SELECT u.*, COALESCE(f.is_verified,0) AS tex_verified,COALESCE(d.label,'') AS tex_display_label, CASE WHEN EXISTS (SELECT 1 FROM contacts c WHERE c.user_id = ? AND c.contact_id = u.id) THEN 1 ELSE 0 END AS is_contact
    FROM users u LEFT JOIN account_flags f ON f.user_id=u.id LEFT JOIN account_display_labels d ON d.user_id=u.id
    WHERE u.id <> ?
      AND (LOWER(u.username) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.email, '')) = ?)
    ORDER BY is_contact ASC, u.username ASC LIMIT 40";
$st = db()->prepare($sql);
$st->execute([$uid, $uid, $like, $like, $email]);
$new = []; $known = [];
foreach ($st->fetchAll() as $u) {
    $pu = public_user($u, false);
    if ((int)$u['is_contact'] === 1) { $pu['is_contact'] = true; $known[] = $pu; }
    else $new[] = $pu;
}
json_out(['ok' => true, 'users' => array_slice($new, 0, 20), 'contacts' => array_slice($known, 0, 10)]);
