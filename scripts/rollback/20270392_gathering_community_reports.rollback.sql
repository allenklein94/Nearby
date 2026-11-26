-- Rollback of 20270392 (direct gathering and community reports). Each such report is kept as a plain report about the owner: its
-- server copy stays in content_excerpt, "[gathering <id>]" or "[community <id>]" goes at the start of its details. Defect only; owner
-- decides. Deploy order on the way back: an app build with Report Gathering keeps working (it files about the owner, id in details).
drop trigger if exists capture_report_content_object on public.reports;
drop function if exists private._capture_report_object();

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports disable trigger freeze_report_evidence;
update public.reports r
   set details = '[' || r.content_type || ' ' || r.content_id::text || ']' || coalesce(' ' || r.details, ''),
       content_type = null,
       content_id = null
 where r.content_type in ('gathering', 'community');
alter table public.reports enable trigger freeze_report_evidence;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer', 'business', 'story'));

-- 20270391's function
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

  if new.content_type = 'story' then
    -- read as the reporter: only a Story or memory they can see. Who posted it and the copy are set next, server side, by
    -- _capture_report_story.
    select st.user_id, st.created_at into v_sender, v_at from stories st where st.id = new.content_id;
    if v_sender is null then
      raise exception 'That photo isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    new.content_sent_at := v_at;
    new.content_captured_at := now();
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
