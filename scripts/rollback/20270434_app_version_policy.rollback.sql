-- Rollback of 20270434 (minimum supported app version). Puts 20270427's pre-request check back under its public name
-- (body unchanged: 0434 only moved it) and drops the version policy. Data: the policy, availability and change-log rows
-- go with the tables. They are configuration, not personal data, but export them first if the log matters
-- (copy (select * from private.app_version_policy_log) ...). With enforcement on, rolling back = no version check at all.
drop function if exists public.nearby_pre_request();
alter function private._business_pre_request() set schema public;
alter function public._business_pre_request() rename to nearby_pre_request;
revoke all on function public.nearby_pre_request() from public;
grant execute on function public.nearby_pre_request() to anon, authenticated, service_role;

drop policy if exists nearby_app_version_insert on storage.objects;
drop policy if exists nearby_app_version_update on storage.objects;
drop policy if exists nearby_app_version_delete on storage.objects;
drop function if exists public.app_version_allows();
drop function if exists private._app_version_gate();
drop function if exists private._static_page_request();
drop function if exists private._request_client_build(json);
drop function if exists public.app_version_ok();
drop function if exists public.get_app_version_policy(text);
drop trigger if exists app_version_policy_guard on private.app_version_policy;
drop function if exists private._app_version_policy_guard();
drop trigger if exists app_version_settings_log on private.app_version_settings;
drop function if exists private._app_version_settings_log();
drop table if exists private.app_version_settings;
drop function if exists private._update_url_channel(text, text);
drop table if exists private.app_version_policy_log;
drop table if exists private.app_build_availability;
drop table if exists private.app_version_policy;

alter role authenticator set pgrst.db_pre_request to 'public.nearby_pre_request';
notify pgrst, 'reload config';
