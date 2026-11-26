-- "Unsafe activity or situation" as an urgent report reason + urgent safety reports first in the admin queue
-- (owner approved 2026-11-07). Staged after 20270397; deploy only with its own approval. Needs 20270370 (reason codes)
-- and 20270381 (review_priority).
--
-- 1. Reason 'unsafe_situation' (the app sends the English value 'Unsafe activity or situation'; 20270370's mapping turns
--    it into the code). Offered on people, messages, gatherings, communities, businesses and offers (not on photos).
-- 2. URGENT, like 'harassment' and 'underage_user': private.is_urgent_report_reason now names all three. The urgent cap
--    (20270356 / 20270358: 30 per rolling 24 h) is ONE shared allowance: enforce_rate_limit('urgent_report') counts every
--    report by that reporter whose reason is urgent, whichever of the three, so the new reason adds no allowance.
--    Urgent reports still skip the ordinary 10/day cap, exactly as before.
-- 3. Admin queue order (reports.review_priority, generated, ordering only):
--       2 = urgent safety (unsafe_situation, harassment, underage_user)
--       1 = impersonation (unchanged)
--       0 = everything else
--    The admin screens order open reports by it, then OLDEST first within each group (owner: the longest-waiting urgent
--    report first). Existing harassment / underage rows move up with the regenerated column.
-- Nothing here suspends, hides, removes, notifies or restricts anyone: an urgent reason only orders the queue and selects
-- the cap; every outcome stays an admin's decision. Not changed: who can report, evidence capture + freeze, retention,
-- the reporter's Activity statuses (20270397), cases.
-- Rollback: scripts/rollback/20270398_unsafe_report_reason.rollback.sql

-- 1. reason code (20270381's mapping + the new reason) -----------------------------------------------------------------
create or replace function private.report_reason_code(p text)
returns text
language sql
immutable
as $function$
  select case
    when p in ('inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user',
               'unsafe_situation', 'other',
               'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed') then p
    when p = 'Inappropriate photo' then 'inappropriate_photo'
    when p = 'Harassment or abuse' then 'harassment'
    when p = 'Fake profile' then 'fake_profile'
    when p = 'Impersonation' then 'impersonation'
    when p = 'Spam or scam' then 'spam_scam'
    when p = 'Underage user' then 'underage_user'
    when p = 'Unsafe activity or situation' then 'unsafe_situation'
    when p = 'Other' then 'other'
    when p = 'Sponsored content' then 'sponsored_content'
    when p = 'Automated: photo failed content moderation' then 'auto_photo_failed'
    when p = 'Automated: possible minor detected in profile photo' then 'auto_possible_minor'
    when p = 'Automated: age-verification check failed to complete, treated as unverified' then 'auto_age_check_failed'
  end;
$function$;
revoke all on function private.report_reason_code(text) from public, anon, authenticated;

alter table public.reports drop constraint if exists reports_reason_code_check;
alter table public.reports add constraint reports_reason_code_check check (reason in (
  'inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'unsafe_situation',
  'other', 'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed'));

-- 2. urgent: one shared cap for all three --------------------------------------------------------------------------------
create or replace function private.is_urgent_report_reason(p text)
returns boolean
language sql
immutable
as $function$
  select coalesce(private.report_reason_code(p) in ('harassment', 'underage_user', 'unsafe_situation'), false);
$function$;
revoke all on function private.is_urgent_report_reason(text) from public, anon, authenticated;

-- 3. queue priority (a generated column's expression can't be altered on PG 15: dropped and re-added, same name, still
--    last; no index, view, policy or column grant uses it) -------------------------------------------------------------
alter table public.reports drop column review_priority;
alter table public.reports add column review_priority smallint
  generated always as (case when reason in ('unsafe_situation', 'harassment', 'underage_user') then 2
                            when reason = 'impersonation' then 1
                            else 0 end) stored;
