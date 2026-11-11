-- =====================================================================
-- VORBITozaur 1.x -> 2.0.0 — upgrade MANUAL (opțional) pentru MySQL/MariaDB
-- =====================================================================
-- NU e obligatoriu: aplicația face singură aceeași migrare la prima cerere
-- (lib/bootstrap.php -> migrate_v2(), apoi scrie data/schema-v2.lock).
-- Folosește acest fișier doar dacă preferi să rulezi migrarea din phpMyAdmin.
-- Sigur: doar CREATE TABLE IF NOT EXISTS / ADD COLUMN / INSERT IGNORE.
-- Nu șterge și nu modifică date existente. Fă totuși un backup înainte.
-- Dacă o coloană există deja, phpMyAdmin dă eroarea „Duplicate column” —
-- e în regulă, treci la instrucțiunea următoare.
-- =====================================================================

CREATE TABLE IF NOT EXISTS contacts (
  user_id INT UNSIGNED NOT NULL,
  contact_id INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, contact_id),
  KEY idx_ct_contact (contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_keys (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  pub_jwk TEXT NOT NULL,
  enc_priv TEXT NOT NULL,
  kdf_salt VARCHAR(64) NOT NULL,
  kdf_iter INT UNSIGNED NOT NULL DEFAULT 310000,
  iv VARCHAR(64) NOT NULL,
  fingerprint VARCHAR(80) NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  updated_at INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_keys (
  conversation_id INT UNSIGNED NOT NULL,
  key_version INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  wrapped TEXT NOT NULL,
  wrapped_by INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  PRIMARY KEY (conversation_id, key_version, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE conversations ADD COLUMN created_by INT UNSIGNED NULL;
ALTER TABLE conversations ADD COLUMN key_version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE conversation_members ADD COLUMN cleared_id INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN hidden TINYINT(1) NOT NULL DEFAULT 0;

-- contactele inițiale = persoanele cu care ai deja o conversație 1:1
INSERT IGNORE INTO contacts (user_id, contact_id, created_at)
  SELECT a.user_id, b.user_id, c.created_at FROM conversations c
  JOIN conversation_members a ON a.conversation_id = c.id
  JOIN conversation_members b ON b.conversation_id = c.id AND b.user_id <> a.user_id
  WHERE c.is_group = 0;
