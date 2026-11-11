-- PRODUCT TESTER: actualizare pentru o bază MySQL/MariaDB existentă.
-- IMPORTANT: fă mai întâi backup bazei și selectează baza aplicației în
-- phpMyAdmin. Execută întregul fișier. Scriptul poate fi repetat.
-- Nu importă schema completă, nu schimbă utilizatori și nu acordă permisiuni.
-- Codul stocat este TESTER; în interfață se afișează PRODUCT TESTER.
-- Baza originală folosește constrângerea chk_tex_display_label.

-- Oprește importul dacă baza nu a fost selectată sau tabelul nu există.
SELECT user_id,label,updated_by,updated_at FROM account_display_labels LIMIT 0;

SET @tex_label_check_exists = (
    SELECT COUNT(*)
    FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'account_display_labels'
      AND CONSTRAINT_NAME = 'chk_tex_display_label'
      AND CONSTRAINT_TYPE = 'CHECK'
);
SET @tex_is_mariadb = LOCATE('MariaDB', VERSION()) > 0;
SET @tex_major = CAST(SUBSTRING_INDEX(VERSION(), '.', 1) AS UNSIGNED);
SET @tex_minor = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 2), '.', -1) AS UNSIGNED);
SET @tex_patch = CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(VERSION(), '.', 3), '.', -1) AS UNSIGNED);
-- MySQL înainte de 8.0.16 nu aplică CHECK și nu suportă sintaxa ADD
-- CONSTRAINT ... CHECK. Nu este nevoie de ALTER pe aceste versiuni.
SET @tex_supports_check = @tex_is_mariadb OR @tex_major > 8 OR
    (@tex_major = 8 AND (@tex_minor > 0 OR @tex_patch >= 16));
SET @tex_new_check = CONCAT(
    'ADD CONSTRAINT chk_tex_display_label CHECK (label IN (',
    QUOTE(''), ',', QUOTE('ADMIN'), ',', QUOTE('MOD'), ',', QUOTE('TESTER'), '))'
);
-- Înlocuiește constrângerea într-un singur ALTER (fără interval neprotejat).
-- MariaDB folosește DROP CONSTRAINT, iar MySQL 8.0.16+ folosește DROP CHECK.
SET @tex_upgrade = IF(
    @tex_supports_check,
    CONCAT('ALTER TABLE account_display_labels ',
        IF(@tex_label_check_exists > 0,
           IF(@tex_is_mariadb,
              'DROP CONSTRAINT chk_tex_display_label, ',
              'DROP CHECK chk_tex_display_label, '),
           ''),
        @tex_new_check),
    'SELECT 1 AS check_neaplicat_de_server'
);
PREPARE tex_upgrade_stmt FROM @tex_upgrade;
EXECUTE tex_upgrade_stmt;
DEALLOCATE PREPARE tex_upgrade_stmt;
