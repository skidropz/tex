-- VORBITozaur — schema SQLite (fallback pentru demo local)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NULL UNIQUE COLLATE NOCASE, -- opțional (conturile noi au doar username)
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#0084ff',
  avatar_path TEXT NULL,
  status_type TEXT NOT NULL DEFAULT 'available',
  status_text TEXT NULL,
  settings TEXT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  is_group INTEGER NOT NULL DEFAULT 0,
  title TEXT NULL,
  last_message_id INTEGER NULL,
  created_by INTEGER NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at);
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  last_delivered_id INTEGER NOT NULL DEFAULT 0,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  cleared_id INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cm_user ON conversation_members(user_id);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  upload_token TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  received INTEGER NOT NULL DEFAULT 0,
  width INTEGER NULL,
  height INTEGER NULL,
  complete INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_conv ON attachments(conversation_id);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT NULL,
  meta TEXT NULL,
  attachment_id INTEGER NULL,
  reply_to_id INTEGER NULL,
  client_uid TEXT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ev_user ON events(user_id, id);
CREATE INDEX IF NOT EXISTS idx_ev_created ON events(created_at);

-- v2.0.0
CREATE TABLE IF NOT EXISTS contacts (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, contact_id));
CREATE INDEX IF NOT EXISTS idx_ct_contact ON contacts(contact_id);
CREATE TABLE IF NOT EXISTS user_keys (user_id INTEGER NOT NULL PRIMARY KEY, pub_jwk TEXT NOT NULL, enc_priv TEXT NOT NULL, kdf_salt TEXT NOT NULL, kdf_iter INTEGER NOT NULL DEFAULT 310000, iv TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS conversation_keys (conversation_id INTEGER NOT NULL, key_version INTEGER NOT NULL, user_id INTEGER NOT NULL, wrapped TEXT NOT NULL, wrapped_by INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (conversation_id, key_version, user_id));

-- v2.1.6: push FCM
CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, platform TEXT NOT NULL DEFAULT 'android', app_version TEXT NULL, updated_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fcm_user ON fcm_tokens(user_id);
-- Tex 2.1.17: additive, idempotent. Select the existing database first.
CREATE TABLE IF NOT EXISTS conversation_pins (conversation_id INTEGER NOT NULL, message_id INTEGER NOT NULL, pinned_by INTEGER NOT NULL, pinned_at BIGINT NOT NULL, PRIMARY KEY (conversation_id,message_id));
CREATE TABLE IF NOT EXISTS message_edits (message_id INTEGER NOT NULL PRIMARY KEY, edited_at BIGINT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS user_security (user_id INTEGER NOT NULL PRIMARY KEY, question TEXT NULL, answer_hash TEXT NULL, recovery_version INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recovery_limits (bucket_key VARCHAR(64) NOT NULL PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_grants (token_hash VARCHAR(64) NOT NULL PRIMARY KEY, user_id INTEGER NOT NULL, session_hash VARCHAR(64) NOT NULL, recovery_version INTEGER NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT NULL);
CREATE TABLE IF NOT EXISTS user_presence (user_id INTEGER NOT NULL PRIMARY KEY, last_activity BIGINT NOT NULL DEFAULT 0, last_heartbeat BIGINT NOT NULL DEFAULT 0, last_state VARCHAR(16) NOT NULL DEFAULT 'offline');

-- Tex 2.1.32: private per-owner contact preferences
CREATE TABLE IF NOT EXISTS contact_preferences (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, alias TEXT NOT NULL DEFAULT '', ignored INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,contact_id));
CREATE INDEX IF NOT EXISTS idx_contact_preferences_reverse ON contact_preferences(contact_id,user_id);

-- Admin roles are never seeded by installation or an HTTP request.
CREATE TABLE IF NOT EXISTS account_flags (user_id INTEGER NOT NULL PRIMARY KEY, is_admin INTEGER NOT NULL DEFAULT 0, is_verified INTEGER NOT NULL DEFAULT 0, verified_by INTEGER NULL, verified_at BIGINT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL, target_id INTEGER NOT NULL, action TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit(target_id,id);

-- Display labels never authorize access and are not automatically assigned.
CREATE TABLE IF NOT EXISTS account_display_labels (user_id INTEGER NOT NULL PRIMARY KEY, label TEXT NOT NULL DEFAULT '' CHECK(label IN ('','ADMIN','MOD','TESTER')), updated_by INTEGER NULL, updated_at BIGINT NOT NULL);
