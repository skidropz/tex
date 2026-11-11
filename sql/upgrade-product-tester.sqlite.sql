-- PRODUCT TESTER: migrare pentru o bază SQLite existentă (NU MySQL/MariaDB).
-- Fă backup bazei înainte de execuție. Reconstruiește DOAR tabelul original
-- account_display_labels, păstrând toate rândurile și cele patru coloane.
-- Codul intern TESTER este afișat în interfață ca PRODUCT TESTER.
-- Poate fi rulată din nou pe schema originală sau pe schema deja migrată.
BEGIN IMMEDIATE;
CREATE TABLE account_display_labels__tester_upgrade (
  user_id INTEGER NOT NULL PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '' CHECK(label IN ('','ADMIN','MOD','TESTER')),
  updated_by INTEGER NULL,
  updated_at BIGINT NOT NULL
);
INSERT INTO account_display_labels__tester_upgrade (user_id,label,updated_by,updated_at)
    SELECT user_id,label,updated_by,updated_at FROM account_display_labels;
DROP TABLE account_display_labels;
ALTER TABLE account_display_labels__tester_upgrade RENAME TO account_display_labels;
COMMIT;
