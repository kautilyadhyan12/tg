-- Staff and member are separate (ROADMAP Stage 2 item 4a-ii; spec Part 3 §10.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Until now the console refused a staff row whose membership in the same gym was closed
-- after the row was written (the "ghost" of 2026-08-22: an account deleted and restored),
-- unless the person owns the gym. From now the staff row alone decides, and deleting an
-- account deletes its staff rows instead. This removes the rows the old rule refused, and
-- the rows of accounts inside their deletion window, so nobody refused before is let in.
-- A gym's owner keeps their row, as the old rule kept it.
DELETE FROM gym_staff s
WHERE NOT EXISTS (SELECT 1 FROM gyms g WHERE g.id = s.gym_id AND g.owner_user_id = s.user_id)
  AND (
    EXISTS (SELECT 1 FROM users u WHERE u.id = s.user_id AND u.status <> 'active')
    OR (
      NOT EXISTS (
        SELECT 1 FROM gym_members m
        WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL)
      AND EXISTS (
        SELECT 1 FROM gym_members m
        WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at >= s.created_at)
    )
  );
