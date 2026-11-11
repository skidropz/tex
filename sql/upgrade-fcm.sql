-- =====================================================================
-- VORBITozaur 2.1.6 — push FCM (Firebase Cloud Messaging) — upgrade MANUAL (opțional)
-- =====================================================================
-- NU e obligatoriu: aplicația creează singură tabelul la prima cerere
-- (lib/bootstrap.php -> migrate_fcm(), apoi scrie data/schema-fcm.lock).
-- Rulează din phpMyAdmin doar dacă preferi. Sigur: doar CREATE TABLE IF NOT EXISTS.
-- =====================================================================

-- MySQL / MariaDB
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  platform VARCHAR(16) NOT NULL DEFAULT 'android',
  app_version VARCHAR(32) NULL DEFAULT NULL,
  updated_at INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_fcm_token (token),
  KEY idx_fcm_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SQLite (doar demo local) — echivalent:
-- CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, platform TEXT NOT NULL DEFAULT 'android', app_version TEXT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
-- CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);
