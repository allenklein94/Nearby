-- Rollback for migration 20270380 (duplicate-photo detection activation). Run BEFORE rolling back 20270379 or earlier.
-- Near-duplicate matching goes back to off (distances null = no comparison, no new similar-photo case). Exact-copy
-- matching stays as 20270358 set it (turn it off with scripts/trust-safety/photo-detection-switch.js off --all).
-- KEPT on purpose: every review case already opened, its history and admin notes (they never restricted anyone; deleting
-- them would lose the audit trail). Perceptual hashes are kept too (moderate-photo records them while off as well).
update private.account_signal_settings
   set similar_photo_max_dhash = null, similar_photo_max_phash = null, updated_at = now()
 where id;
drop function if exists private.evaluate_existing_photo_signals();
