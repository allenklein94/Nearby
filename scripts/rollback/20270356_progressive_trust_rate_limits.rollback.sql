-- Rollback for migration 20270356 (I2 rate limits). Run after 20270357's rollback. Removes every limit at once (the
-- approved numbers in private.rate_limit_rules go too: export them first if they are to be re-applied).
drop trigger if exists zz_rate_limit on public.messages;
drop trigger if exists zz_rate_limit on public.gathering_messages;
drop trigger if exists zz_rate_limit on public.community_messages;
drop trigger if exists zz_rate_limit on public.plan_messages;
drop trigger if exists zz_rate_limit on public.business_messages;
drop trigger if exists zz_rate_limit on public.social_invites;
drop trigger if exists zz_rate_limit on public.reports;
drop trigger if exists zz_rate_limit on public.business_requests;
drop trigger if exists zz_rate_limit_profile_change on public.profiles;
drop trigger if exists zz_rate_limit_extra_photo on public.profile_photos;
drop function if exists public._rate_limit_insert();
drop function if exists public._rate_limit_profile_change();
drop function if exists public._rate_limit_extra_photo();
drop function if exists private.enforce_rate_limit(text);
drop function if exists private.rate_limit_count(text, uuid, timestamptz);
drop function if exists private.trust_level(uuid);
select cron.unschedule('purge-profile-change-log') where exists (select 1 from cron.job where jobname = 'purge-profile-change-log');
drop function if exists private.purge_profile_change_log();
drop table if exists private.profile_change_log;
drop table if exists private.rate_limit_rules;
drop table if exists private.trust_settings;
