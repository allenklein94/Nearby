-- Rollback of 20270414 (business duplicate warnings). Drops only what 20270414 added; no application, business or media
-- row is touched. Deploy order on rollback: screen-business-content without the fingerprint call can stay (it ignores
-- PGRST202), but redeploying the previous version first is cleaner.
select cron.unschedule('purge-business-duplicate-records') where exists (select 1 from cron.job where jobname = 'purge-business-duplicate-records');
drop function if exists private.purge_business_duplicate_records();
drop function if exists public.admin_dismiss_business_duplicate(text, uuid, uuid, text);
drop function if exists public.admin_business_duplicate_warnings();
drop table if exists private.business_duplicate_dismissals;
drop function if exists private.business_application_contact_keys(uuid);
drop function if exists private.business_phone_key(text);
drop function if exists public.record_business_media_fingerprint(uuid, text, text, text);
drop function if exists private.business_media_in_use(uuid, text, text);
drop table if exists private.business_media_fingerprints;
