-- Rollback for migration 20270358 (trust & safety thresholds). Run before 20270357's rollback. Turns every limit and the
-- duplicate-photo case rules off again (the mechanisms stay, enforcing nothing). Open review cases stay as they are.
delete from private.rate_limit_rules;
update private.trust_settings set established_min_account_age = null, updated_at = now() where id;
update private.account_signal_settings
   set duplicate_photo_min_accounts = null, similar_name_min_similarity = null, updated_at = now()
 where id;
