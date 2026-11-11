-- VORBITozaur — schema MySQL / MariaDB (utf8mb4)
-- Importă acest fișier în phpMyAdmin sau rulează install.php

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  email VARCHAR(190) NULL DEFAULT NULL, -- opțional (conturile noi au doar username)
  display_name VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar_color VARCHAR(16) NOT NULL DEFAULT '#0084ff',
  avatar_path VARCHAR(255) NULL DEFAULT NULL, -- poză de profil (uploads/avatars/...)
  status_type VARCHAR(16) NOT NULL DEFAULT 'available', -- available | busy | away | invisible
  status_text VARCHAR(140) NULL DEFAULT NULL, -- mesaj de status (ca la Yahoo! Messenger)
  settings TEXT NULL,
  created_at INT UNSIGNED NOT NULL,
  last_seen INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  is_group TINYINT(1) NOT NULL DEFAULT 0,
  title VARCHAR(100) NULL,
  last_message_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  key_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at INT UNSIGNED NOT NULL,
  updated_at INT UNSIGNED NOT NULL,
  KEY idx_conv_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  last_delivered_id INT UNSIGNED NOT NULL DEFAULT 0,
  last_read_id INT UNSIGNED NOT NULL DEFAULT 0,
  cleared_id INT UNSIGNED NOT NULL DEFAULT 0,
  hidden TINYINT(1) NOT NULL DEFAULT 0,
  joined_at INT UNSIGNED NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_cm_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uploader_id INT UNSIGNED NOT NULL,
  conversation_id INT UNSIGNED NOT NULL,
  upload_token VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(255) NOT NULL,
  mime VARCHAR(127) NOT NULL DEFAULT 'application/octet-stream',
  size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  received BIGINT UNSIGNED NOT NULL DEFAULT 0,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  complete TINYINT(1) NOT NULL DEFAULT 0,
  created_at INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_att_token (upload_token),
  KEY idx_att_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'text',
  body TEXT NULL,
  meta TEXT NULL,
  attachment_id INT UNSIGNED NULL,
  reply_to_id INT UNSIGNED NULL,
  client_uid VARCHAR(64) NULL,
  created_at INT UNSIGNED NOT NULL,
  KEY idx_msg_conv (conversation_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reactions (
  message_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  emoji VARCHAR(32) NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  PRIMARY KEY (message_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  type VARCHAR(24) NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  created_at INT UNSIGNED NOT NULL,
  KEY idx_ev_user (user_id, id),
  KEY idx_ev_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v2.0.0: contacte, chei E2E
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

-- v2.1.6: push FCM (token-uri dispozitive Android)
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
-- Tex 2.1.17: additive, idempotent. Select the existing database first.
CREATE TABLE IF NOT EXISTS conversation_pins (conversation_id INT UNSIGNED NOT NULL, message_id INT UNSIGNED NOT NULL, pinned_by INT UNSIGNED NOT NULL, pinned_at BIGINT NOT NULL, PRIMARY KEY (conversation_id,message_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS message_edits (message_id INT UNSIGNED NOT NULL PRIMARY KEY, edited_at BIGINT NOT NULL, revision INTEGER NOT NULL DEFAULT 1) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS user_security (user_id INT UNSIGNED NOT NULL PRIMARY KEY, question VARCHAR(255) NULL, answer_hash VARCHAR(255) NULL, recovery_version INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS recovery_limits (bucket_key VARCHAR(64) NOT NULL PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS recovery_grants (token_hash VARCHAR(64) NOT NULL PRIMARY KEY, user_id INT UNSIGNED NOT NULL, session_hash VARCHAR(64) NOT NULL, recovery_version INTEGER NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS user_presence (user_id INT UNSIGNED NOT NULL PRIMARY KEY, last_activity BIGINT NOT NULL DEFAULT 0, last_heartbeat BIGINT NOT NULL DEFAULT 0, last_state VARCHAR(16) NOT NULL DEFAULT 'offline') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tex 2.1.32: private per-owner contact preferences
CREATE TABLE IF NOT EXISTS contact_preferences (
 user_id INT UNSIGNED NOT NULL,
 contact_id INT UNSIGNED NOT NULL,
 alias VARCHAR(64) NOT NULL DEFAULT '',
 ignored TINYINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at INT UNSIGNED NOT NULL,
 PRIMARY KEY (user_id,contact_id),
 KEY idx_contact_preferences_reverse (contact_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin roles and public verification. NO account, password or role is seeded here.
CREATE TABLE IF NOT EXISTS account_flags (
 user_id INT UNSIGNED NOT NULL PRIMARY KEY,
 is_admin TINYINT UNSIGNED NOT NULL DEFAULT 0,
 is_verified TINYINT UNSIGNED NOT NULL DEFAULT 0,
 verified_by INT UNSIGNED NULL,
 verified_at BIGINT NULL,
 updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS admin_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 actor_id INT UNSIGNED NOT NULL,
 target_id INT UNSIGNED NOT NULL,
 action VARCHAR(32) NOT NULL,
 created_at BIGINT NOT NULL,
 KEY idx_admin_audit_target (target_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tex2.1.35: visual labels only, unrelated to account_flags.is_admin.
CREATE TABLE IF NOT EXISTS account_display_labels (
 user_id INT UNSIGNED NOT NULL PRIMARY KEY,
 label VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
 updated_by INT UNSIGNED NULL,
 updated_at BIGINT NOT NULL,
 CONSTRAINT chk_tex_display_label CHECK (label IN ('','ADMIN','MOD','TESTER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
