-- Rollback of 20270396 (link destination safety). Linked public text then needs only 0373's word screening again; the
-- link-check columns, budget table and functions go. Deploy the previous screen-user-content first (or together): the 0396
-- version calls functions this removes and would answer 503 for every linked text (fail closed, never open). Defect only;
-- owner decides.
select cron.unschedule('purge-link-check-usage') where exists (select 1 from cron.job where jobname = 'purge-link-check-usage');
drop function if exists private.purge_link_check_usage();

-- 20270373's function
create or replace function private.ugc_require(p_text text, p_is_name boolean)
returns text
language plpgsql
stable
security definer
set search_path to 'private', 'public'
as $function$
declare
  v_outcome text;
begin
  if private.ugc_norm(p_text) = '' then return 'none'; end if;
  v_outcome := private.ugc_screening_lookup(auth.uid(), private.ugc_text_sha(p_text), p_is_name);
  if v_outcome is null then
    raise exception 'This needs to go through Nearby''s content check before it can be published.'
      using errcode = '42501', hint = 'screening_required';
  elsif v_outcome = 'refuse' then
    raise exception 'This can''t be published on Nearby. Please change it and try again.'
      using errcode = '42501', hint = 'content_not_allowed';
  end if;
  return v_outcome;
end;
$function$;
revoke all on function private.ugc_require(text, boolean) from public, anon, authenticated;

drop function if exists public.find_ugc_link_screening(uuid, text, boolean);
drop function if exists private.ugc_link_screening_lookup(uuid, text, boolean);
drop function if exists public.record_ugc_link_screening(uuid, text, text, boolean, text, integer, text[], text, text[], text[], text, text);
drop function if exists public.claim_link_checks(uuid, integer);
drop table if exists private.link_check_usage;
drop function if exists public.ugc_links_for_check(text);
drop function if exists private.ugc_links(text);
alter table private.ugc_screenings drop column if exists link_threats, drop column if exists link_count, drop column if exists link_check;
