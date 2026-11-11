<?php
declare(strict_types=1);
/** Additive, restart-safe schema: no existing rows, keys or profile columns are removed. */
function release217_schema(bool $mysql): array
{
    $id = $mysql ? 'INT UNSIGNED' : 'INTEGER';
    $text = $mysql ? 'VARCHAR(255)' : 'TEXT';
    $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
    return [
        "CREATE TABLE IF NOT EXISTS conversation_pins (conversation_id $id NOT NULL, message_id $id NOT NULL, pinned_by $id NOT NULL, pinned_at BIGINT NOT NULL, PRIMARY KEY (conversation_id,message_id))$tail",
        "CREATE TABLE IF NOT EXISTS message_edits (message_id $id NOT NULL PRIMARY KEY, edited_at BIGINT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)$tail",
        "CREATE TABLE IF NOT EXISTS user_security (user_id $id NOT NULL PRIMARY KEY, question $text NULL, answer_hash $text NULL, recovery_version INTEGER NOT NULL DEFAULT 0, auth_version INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL DEFAULT 0)$tail",
        "CREATE TABLE IF NOT EXISTS recovery_limits (bucket_key VARCHAR(64) NOT NULL PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL)$tail",
        "CREATE TABLE IF NOT EXISTS recovery_grants (token_hash VARCHAR(64) NOT NULL PRIMARY KEY, user_id $id NOT NULL, session_hash VARCHAR(64) NOT NULL, recovery_version INTEGER NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT NULL)$tail",
        "CREATE TABLE IF NOT EXISTS user_presence (user_id $id NOT NULL PRIMARY KEY, last_activity BIGINT NOT NULL DEFAULT 0, last_heartbeat BIGINT NOT NULL DEFAULT 0, last_state VARCHAR(16) NOT NULL DEFAULT 'offline')$tail",
    ];
}
function migrate_release217(PDO $pdo, bool $mysql): void
{
    // Avoid DDL/metadata locks on every poll, and permit least-privilege app users after manual provisioning.
    try { $pdo->query('SELECT 1 FROM user_security,recovery_limits,recovery_grants,user_presence,conversation_pins,message_edits WHERE 1=0'); return; }
    catch (PDOException $e) { if ($e->getCode()!=='42S02' && !str_contains($e->getMessage(),'no such table')) throw $e; }
    // Fail closed rather than silently enabling a partially provisioned recovery mechanism.
    foreach (release217_schema($mysql) as $sql) $pdo->exec($sql);
}
