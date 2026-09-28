-- ──────────────────────────────────────────────────────────────────────────────
-- Post-event anonymisation (docs/03 §11, docs/08 §9).
--
-- Run this once the reports have been exported and the backups copied off the
-- machine. It clears the two fields nobody needs afterwards — phone number and
-- roll number — and leaves every ticket, session and payment row intact, so the
-- numbers in the debrief still add up a year later.
--
-- The registration form promised this. Running it is how the promise is kept.
--
--   docker compose exec -T db mysql -uplayplex -pplayplex playplex < scripts/anonymise.sql
--
-- It is safe to run twice: the second run reports 0 rows changed.
-- ──────────────────────────────────────────────────────────────────────────────

START TRANSACTION;

-- A name is kept, because a session row with no name at all is unreadable in the
-- audit trail; what is discarded is everything that could be used to contact
-- someone. Phone is NOT NULL and uniquely indexed, so it is replaced with a
-- per-row placeholder rather than emptied.
UPDATE student
SET phone      = CONCAT('anon-', LPAD(id, 8, '0')),
    roll_no    = NULL,
    department = NULL,
    year_of_study = NULL
WHERE phone NOT LIKE 'anon-%';

SELECT ROW_COUNT() AS students_anonymised;

COMMIT;

-- Verification: this must come back with zero rows.
SELECT COUNT(*) AS contactable_students_remaining
FROM student
WHERE phone NOT LIKE 'anon-%' OR roll_no IS NOT NULL;

-- And these must be unchanged — the reports still work.
SELECT (SELECT COUNT(*) FROM ticket)      AS tickets_kept,
       (SELECT COUNT(*) FROM play_session) AS sessions_kept,
       (SELECT COUNT(*) FROM payment)      AS payments_kept,
       (SELECT COALESCE(SUM(amount_paise), 0) FROM payment) AS total_paise_kept;
