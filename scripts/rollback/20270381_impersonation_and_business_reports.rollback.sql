-- Rollback for migration 20270381 (run before rolling back anything older). Rows filed meanwhile are kept: an
-- impersonation report becomes 'fake_profile' with "Original reason: Impersonation" at the start of its details (nothing
-- lost; 20270370's rollback then turns fake_profile into 'Fake profile' as usual); a business report keeps its server copy
-- in content_excerpt and becomes a plain report with no person and no content reference ("[business <id>]" prepended to
-- details), because 20270372's content types don't include 'business'.
drop trigger if exists capture_report_content_business on public.reports;
drop function if exists private._capture_report_business();

alter table public.reports drop constraint if exists reports_reason_code_check;
alter table public.reports drop constraint if exists reports_content_type_check;

alter table public.reports disable trigger freeze_report_evidence;
update public.reports
   set reason = 'fake_profile',
       details = 'Original reason: Impersonation' || coalesce(E'\n' || details, '')
 where reason = 'impersonation';
update public.reports
   set details = '[business ' || content_id::text || ']' || coalesce(' ' || details, ''),
       content_type = null,
       content_id = null
 where content_type = 'business';
alter table public.reports enable trigger freeze_report_evidence;

alter table public.reports drop column if exists review_priority;

-- 20270372's content-type check + 20270370's reason check, verbatim
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer'));
alter table public.reports add constraint reports_reason_code_check check (reason in (
  'inappropriate_photo', 'harassment', 'fake_profile', 'spam_scam', 'underage_user', 'other',
  'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed'));

-- 20270370's mapping, verbatim
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

-- 20270372's _capture_report_content, verbatim
create or replace function public._capture_report_content()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sender uuid;
  v_body text;
  v_at timestamptz;
  v_partner uuid;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
    return new;
  end if;

  if new.content_type = 'business_offer' then
    -- read as the reporter: only an offer they can see (their own request, their group plan, match or gathering)
    select o.partner_id,
           concat_ws(E'\n',
             nullif(btrim(o.offer_title), ''),
             nullif(btrim(o.offer_description), ''),
             case when coalesce(array_length(o.included_items, 1), 0) > 0
                  then 'Included: ' || array_to_string(o.included_items, ', ') end,
             case when nullif(btrim(o.redemption_instructions), '') is not null
                  then 'Redemption: ' || btrim(o.redemption_instructions) end),
           coalesce(o.responded_at, o.created_at)
      into v_partner, v_body, v_at
      from business_request_offers o
     where o.id = new.content_id and o.offer_description is not null;
    if v_partner is null then
      raise exception 'That offer isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    -- who answers for it (its manager) + its name are set next by _capture_report_business_offer (server side)
    new.content_excerpt := left(coalesce(v_body, ''), 1800);
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'match_chat' then
    if not exists (select 1 from matches m
                    where m.id = new.content_id
                      and ((m.user_a = new.reporter_id and m.user_b = new.reported_id)
                        or (m.user_b = new.reporter_id and m.user_a = new.reported_id))) then
      raise exception 'That chat isn''t with this person' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    select left(string_agg(to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC: '
                           || coalesce(nullif(btrim(x.body), ''), '[' || coalesce(x.media_type, 'media') || ']'),
                           E'\n' order by x.created_at), 4000),
           max(x.created_at)
      into v_body, v_at
      from (select mm.body, mm.media_type, mm.created_at from messages mm
             where mm.match_id = new.content_id and mm.sender_id = new.reported_id
             order by mm.created_at desc limit 20) x;
    new.content_excerpt := v_body;
    new.content_sent_at := v_at;
    new.content_captured_at := now();
    return new;
  end if;

  if new.content_type = 'message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[' || coalesce(m.media_type, 'media') || ']'), m.created_at
      into v_sender, v_body, v_at from messages m where m.id = new.content_id;
  elsif new.content_type = 'gathering_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from gathering_messages m where m.id = new.content_id;
  elsif new.content_type = 'community_message' then
    select m.sender_id, coalesce(nullif(btrim(m.body), ''), '[media]'), m.created_at
      into v_sender, v_body, v_at from community_messages m where m.id = new.content_id;
  elsif new.content_type = 'plan_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from plan_messages m where m.id = new.content_id;
  elsif new.content_type = 'business_message' then
    select m.sender_id, m.body, m.created_at
      into v_sender, v_body, v_at from business_messages m where m.id = new.content_id;
  end if;

  -- not visible to the reporter, gone, or written by someone else: refused, never attached to the wrong person
  if v_sender is null or v_sender is distinct from new.reported_id then
    raise exception 'That message isn''t from this person' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  new.content_excerpt := left(v_body, 2000);
  new.content_sent_at := v_at;
  new.content_captured_at := now();
  return new;
end;
$function$;
revoke all on function public._capture_report_content() from public, anon, authenticated;
