-- Rollback of 20270398 (run before rolling back anything older). Rows filed meanwhile are kept: an 'unsafe_situation'
-- report becomes 'other' with "Original reason: Unsafe activity or situation" at the start of its details (nothing lost;
-- it then counts against the ordinary cap like 'other'). Harassment / underage go back to the ordinary queue order.
-- Defect only; owner decides.
alter table public.reports drop constraint if exists reports_reason_code_check;

alter table public.reports disable trigger freeze_report_evidence;
update public.reports
   set reason = 'other',
       details = 'Original reason: Unsafe activity or situation' || coalesce(E'\n' || details, '')
 where reason = 'unsafe_situation';
alter table public.reports enable trigger freeze_report_evidence;

-- 20270381's queue priority, verbatim
alter table public.reports drop column if exists review_priority;
alter table public.reports add column if not exists review_priority smallint
  generated always as (case when reason = 'impersonation' then 1 else 0 end) stored;

-- 20270381's reason check, verbatim
alter table public.reports add constraint reports_reason_code_check check (reason in (
  'inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'other',
  'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed'));

-- 20270370's urgent rule, verbatim
create or replace function private.is_urgent_report_reason(p text)
returns boolean
language sql
immutable
as $function$
  select coalesce(private.report_reason_code(p) in ('harassment', 'underage_user'), false);
$function$;
revoke all on function private.is_urgent_report_reason(text) from public, anon, authenticated;

-- 20270381's mapping, verbatim
create or replace function private.report_reason_code(p text)
returns text
language sql
immutable
as $function$
  select case
    when p in ('inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'other',
               'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed') then p
    when p = 'Inappropriate photo' then 'inappropriate_photo'
    when p = 'Harassment or abuse' then 'harassment'
    when p = 'Fake profile' then 'fake_profile'
    when p = 'Impersonation' then 'impersonation'
    when p = 'Spam or scam' then 'spam_scam'
    when p = 'Underage user' then 'underage_user'
    when p = 'Other' then 'other'
    when p = 'Sponsored content' then 'sponsored_content'
    when p = 'Automated: photo failed content moderation' then 'auto_photo_failed'
    when p = 'Automated: possible minor detected in profile photo' then 'auto_possible_minor'
    when p = 'Automated: age-verification check failed to complete, treated as unverified' then 'auto_age_check_failed'
  end;
$function$;
revoke all on function private.report_reason_code(text) from public, anon, authenticated;
