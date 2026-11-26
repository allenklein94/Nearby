-- Rollback for migration 20270370: reasons back to the English values, free text again, 0356's urgent rule verbatim.
-- Run before rolling back 20270369. Rows: each code back to the exact value the app/system sent; a row the migration
-- turned into 'other' with "Original reason: ..." at the start of details gets that original text back.
alter table public.reports drop constraint if exists reports_reason_code_check;
drop trigger if exists aa_normalize_report_reason on public.reports;
drop function if exists public._normalize_report_reason();

alter table public.reports disable trigger freeze_report_evidence;
update public.reports
   set reason = case
         when reason = 'other' and details like 'Original reason: %'
           then substring(split_part(details, E'\n', 1) from length('Original reason: ') + 1)
         when reason = 'inappropriate_photo' then 'Inappropriate photo'
         when reason = 'harassment' then 'Harassment or abuse'
         when reason = 'fake_profile' then 'Fake profile'
         when reason = 'spam_scam' then 'Spam or scam'
         when reason = 'underage_user' then 'Underage user'
         when reason = 'other' then 'Other'
         when reason = 'sponsored_content' then 'Sponsored content'
         when reason = 'auto_photo_failed' then 'Automated: photo failed content moderation'
         when reason = 'auto_possible_minor' then 'Automated: possible minor detected in profile photo'
         when reason = 'auto_age_check_failed' then 'Automated: age-verification check failed to complete, treated as unverified'
         else reason end,
       details = case
         when reason = 'other' and details like 'Original reason: %'
           then nullif(substring(details from length(split_part(details, E'\n', 1)) + 2), '')
         else details end;
alter table public.reports enable trigger freeze_report_evidence;

-- 20270356's version, verbatim
create or replace function private.is_urgent_report_reason(p text)
returns boolean
language sql
immutable
as $function$
  select coalesce(p in ('Harassment or abuse', 'Underage user'), false);
$function$;
revoke all on function private.is_urgent_report_reason(text) from public, anon, authenticated;

drop function if exists private.report_reason_code(text);
