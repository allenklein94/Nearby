-- Impersonation as its own report reason + "Report business" (owner approved 2026-11-01). Staged after 20270380; deploy
-- only with its own approval. Needs 20270355 (report evidence), 20270370 (reason codes), 20270372 (offer reports).
--
-- 1. Reason 'impersonation' ("Pretending to be someone else", a person, a public figure or a business), separate from
--    'fake_profile'. The app sends the English value 'Impersonation' (like every other reason; 20270370's mapping turns it
--    into the code). Existing 'fake_profile' rows stay as they are (nobody can tell which of them were impersonation).
--    NOT urgent: an impersonation report counts against the ordinary report cap like any other (only harassment and
--    underage user have their own ceiling, unchanged), so the reason can't be used to flood the queue.
-- 2. Priority in the existing admin queue: reports.review_priority (generated, 1 = impersonation, else 0). The admin screens
--    order open reports by it, then newest first. Ordering only: nobody is hidden, limited, suspended or told anything
--    because of it; every outcome stays an admin's decision.
-- 3. Report a business: reports.content_type 'business', content_id = the business (brand_partners.id). The server reads
--    the business AS THE REPORTER (only an active business they can see; else refused, hint 'report_content_mismatch'),
--    keeps its own copy (name, address, description at that moment) and sets reported_id to NULL whatever the client sent:
--    the report is about the business itself, never automatically about its owner or staff. A business can't report itself.
--    With no person on it, 20270369's "open an investigation" refuses it as before (hint 'report_no_account') and the
--    admin screens offer no Suspend; the admin resolves it (outcome recorded, 20270355) and uses the existing business
--    tools (e.g. revoke Verified Business, 20270371).
-- Not changed: who can report, caps, the evidence freeze, retention, the admin notice, offer reports (still about the
-- business's manager, 20270372), cases.

-- 1. reason code -------------------------------------------------------------------------------------------------------
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

alter table public.reports drop constraint if exists reports_reason_code_check;
alter table public.reports add constraint reports_reason_code_check check (reason in (
  'inappropriate_photo', 'harassment', 'fake_profile', 'impersonation', 'spam_scam', 'underage_user', 'other',
  'sponsored_content', 'auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed'));

-- 2. queue priority ----------------------------------------------------------------------------------------------------
alter table public.reports add column if not exists review_priority smallint
  generated always as (case when reason = 'impersonation' then 1 else 0 end) stored;

-- 3. business reports --------------------------------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer', 'business'));

-- 20270372's function with one more branch (business); every other branch unchanged. Runs as the reporter.
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

  if new.content_type = 'business' then
    -- read as the reporter: only an active business they can see (brand_partners' own read policy)
    select bp.id,
           concat_ws(E'\n',
             nullif(btrim(bp.address), ''),
             nullif(btrim(bp.description), ''))
      into v_partner, v_body
      from brand_partners bp
     where bp.id = new.content_id;
    if v_partner is null then
      raise exception 'That business isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    -- it is about the business itself; its name is added next by _capture_report_business (server side)
    new.content_excerpt := left(coalesce(v_body, ''), 1800);
    new.content_captured_at := now();
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

-- Runs right after _capture_report_content (trigger names sort: capture_report_content < capture_report_content_business),
-- which has already proved, as the reporter, that they can see the business (content_captured_at is set only then; a
-- client can't set it). Server side: nobody is named (reported_id NULL, whatever the client sent) and the copy names the
-- business. Someone who manages that business can't report it.
create or replace function private._capture_report_business()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name text;
begin
  if new.content_type is distinct from 'business' then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That business isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  if new.reporter_id is not null
     and exists (select 1 from profiles p where p.id = new.reporter_id and p.managed_partner_id = new.content_id) then
    raise exception 'You can''t report your own business' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select bp.name into v_name from brand_partners bp where bp.id = new.content_id;
  new.reported_id := null;
  new.content_excerpt := left('Business: ' || coalesce(v_name, '(no name)')
                              || case when coalesce(new.content_excerpt, '') <> '' then E'\n' || new.content_excerpt else '' end, 2000);
  return new;
end;
$function$;
revoke all on function private._capture_report_business() from public, anon, authenticated;

drop trigger if exists capture_report_content_business on public.reports;
create trigger capture_report_content_business before insert on public.reports
  for each row execute function private._capture_report_business();
