-- Tex 2.1.17: additive, idempotent. Select the existing database first.
CREATE TABLE IF NOT EXISTS conversation_pins (conversation_id INTEGER NOT NULL, message_id INTEGER NOT NULL, pinned_by INTEGER NOT NULL, pinned_at BIGINT NOT NULL, PRIMARY KEY (conversation_id,message_id));
CREATE TABLE IF NOT EXISTS message_edits (message_id INTEGER NOT NULL PRIMARY KEY, edited_at BIGINT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS user_security (user_id INTEGER NOT NULL PRIMARY KEY, question TEXT NULL, answer_hash TEXT NULL, recovery_version INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recovery_limits (bucket_key VARCHAR(64) NOT NULL PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS recovery_grants (token_hash VARCHAR(64) NOT NULL PRIMARY KEY, user_id INTEGER NOT NULL, session_hash VARCHAR(64) NOT NULL, recovery_version INTEGER NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT NULL);
CREATE TABLE IF NOT EXISTS user_presence (user_id INTEGER NOT NULL PRIMARY KEY, last_activity BIGINT NOT NULL DEFAULT 0, last_heartbeat BIGINT NOT NULL DEFAULT 0, last_state VARCHAR(16) NOT NULL DEFAULT 'offline');
