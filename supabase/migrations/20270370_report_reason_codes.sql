-- Report reasons as stable codes (owner approved 2026-10-31). Staged after 20270369; deploy only with its own approval.
--
-- Before: reports.reason was free text. The app saved fixed English values (never a translation), and the urgent-report
-- rule (20270356) matched two of those English strings, so a wording change would have silently broken it, and a direct
-- API call could store any text at all.
-- After:
--   * reports.reason holds one of ten codes (check constraint):
--       people's reasons   inappropriate_photo, harassment, fake_profile, spam_scam, underage_user, other
--       written by Nearby  sponsored_content ("Report this ad"), auto_photo_failed, auto_possible_minor,
--                          auto_age_check_failed (moderate-photo's automated flags)
--   * private.report_reason_code(text) is the ONE mapping: a code maps to itself, the exact English value the app (build
--     87 and every older build), services/sponsored.js and the live moderate-photo send maps to its code, anything else
--     maps to nothing. Mirrored by src/utils/reportReasons.js (parity guard reportReasons.test.js).
--   * A BEFORE INSERT trigger (aa_ so it runs before 20270355's evidence capture and 20270356's rate limit) stores the
--     code; an unknown reason is refused (hint 'report_reason_invalid'), so a direct API call can't store arbitrary text
--     or dodge a rule with an unlisted value. The automated codes are refused for signed-in / anonymous callers: only the
--     service role (moderate-photo) files them.
--   * The urgent rule reads codes: harassment + underage_user, exactly as before (legacy values still count, via the
--     mapping). A reason can't be changed after filing (20270355's evidence freeze, unchanged).
--   * Existing rows: mapped to their code. A row whose reason maps to nothing (none on prod at 2026-10-31: its one row is
--     moderate-photo's) becomes 'other' and keeps its original text at the start of details, so nothing is lost.
-- Not changed: who can report, report evidence, caps, cases (0357/0369 never read the reason), the admin queue's columns
-- (the website/app shows labels from reportReasons.js; an older app shows the code text, admin-only).

create or replace function private.report_reason_code(p text)
returns text
language sql
immutable
as $function$
  select case
    when p in ('inappropriate_photo', 'harassment', 'fake_profile', 'spam_scam', 'underage_user', 'other',
               'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed') then p
    when p = 'Inappropriate photo' then 'inappropriate_photo'
    when p = 'Harassment or abuse' then 'harassment'
    when p = 'Fake profile' then 'fake_profile'
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

-- Urgent safety reasons: exempt from the ordinary report cap (20270356). Same two reasons, now by code.
create or replace function private.is_urgent_report_reason(p text)
returns boolean
language sql
immutable
as $function$
  select coalesce(private.report_reason_code(p) in ('harassment', 'underage_user'), false);
$function$;
revoke all on function private.is_urgent_report_reason(text) from public, anon, authenticated;

create or replace function public._normalize_report_reason()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code text := private.report_reason_code(new.reason);
begin
  if v_code is null then
    raise exception 'Choose a reason for this report.' using errcode = '22023', hint = 'report_reason_invalid';
  end if;
  if v_code like 'auto\_%' and coalesce(auth.role(), '') in ('authenticated', 'anon') then
    raise exception 'Choose a reason for this report.' using errcode = '22023', hint = 'report_reason_invalid';
  end if;
  new.reason := v_code;
  return new;
end;
$function$;
revoke all on function public._normalize_report_reason() from public, anon, authenticated;

drop trigger if exists aa_normalize_report_reason on public.reports;
create trigger aa_normalize_report_reason before insert on public.reports
  for each row execute function public._normalize_report_reason();

-- Existing rows. The evidence freeze (20270355) keeps reason/details unchanged on every UPDATE, so it is paused for this
-- one statement only (same transaction; nothing else can write meanwhile).
alter table public.reports disable trigger freeze_report_evidence;
update public.reports
   set details = case when private.report_reason_code(reason) is null
                      then 'Original reason: ' || coalesce(reason, '(none)') || coalesce(E'\n' || details, '')
                      else details end,
       reason = coalesce(private.report_reason_code(reason), 'other')
 where reason is distinct from coalesce(private.report_reason_code(reason), 'other');
alter table public.reports enable trigger freeze_report_evidence;

alter table public.reports drop constraint if exists reports_reason_code_check;
alter table public.reports add constraint reports_reason_code_check check (reason in (
  'inappropriate_photo', 'harassment', 'fake_profile', 'spam_scam', 'underage_user', 'other',
  'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed'));
