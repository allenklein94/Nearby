-- Rollback for migration 20270352 (id-verification upload limits): restores the production definitions read 2026-10-27 before it was applied.
-- Run the rollbacks newest first (20270352 -> 20270347); each assumes the later ones were already rolled back.
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'id-verification';
