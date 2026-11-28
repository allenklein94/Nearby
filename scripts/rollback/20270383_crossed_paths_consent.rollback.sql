-- Rollback for migration 20270383 (crossed paths only between people who both chose it).
-- Since 2026-11-28 its statements are applied first by 20270353 (moved forward, verbatim), so 20270383 only re-states them:
-- the state after rolling back 20270383 = the state after 20270384's rollback = what 20270353 left. Nothing to undo here.
-- Rolling back 20270353 removes the sighting consent (see that rollback). Run the rollbacks newest first.
select 1;
