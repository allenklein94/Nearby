-- Direct reporting of a gathering or a community (owner, 2026-11-06: required before outside users; approved exception to the
-- freeze). Staged after 20270391; own deploy approval. Reuses the existing report path: public.reports, its caps, the evidence
-- freeze, the admin queue and notice, outcomes and 12-month retention. Needs 20270355, 20270356, 20270370, 20270381, 20270391.
--
-- 1. reports.content_type 'gathering' or 'community', content_id = its id. The server reads it AS THE REPORTER, so anything they
--    can see can be reported without joining, and anything they can't is refused the same way as something that doesn't exist
--    (hint report_content_mismatch): no client can use a report to learn that a hidden object exists.
-- 2. The report is about its owner (reported_id = host / creator, set by the server whatever the client sent), so the existing
--    admin tools work from it. Your own gathering or community is refused. No owner left = nobody named; it is still filed.
-- 3. Evidence: the server writes its own copy into content_excerpt: title, description, owner (name + id, so the copy still says
--    who after their account goes), time, category, audience, area words, cover reference, and for a gathering its host-written
--    steps. Fixed from then on (20270355), so it survives the object being edited or deleted and the owner's account being
--    deleted. Never the gathering's point (locked rule: it lives only on the gathering). The object row is share-locked while
--    the copy is taken, so a report and an edit or delete happen one after the other: a delete that lands first refuses the
--    report; one that lands second leaves the whole copy.
--    Cover photos: the copy names the file; the file itself is NOT held. Until screening exists only the host can read a
--    gathering cover (20270390), so no reporter can have seen one; holding covers is a job for the migration that shows them.
-- 4. Duplicates: while one of your reports on this object is open and its copy is unchanged, another is refused
--    (hint report_duplicate; the app says you already reported it). A refused duplicate uses no report allowance. A resolved
--    report, or a copy that has changed since (the object was edited: new evidence), can be filed again. One person's reports
--    on one object are serialized, so two sent at once can't both pass. Different people each file their own.
-- Not changed: who can report, caps, reasons, the freeze, retention, the admin notice, every other report type. Nobody is
-- restricted, hidden or told anything by a report. Admins read these only through the existing reports policies.

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer', 'business', 'story', 'gathering', 'community'));

-- 20270391's function with one more branch (gathering, community); every other branch unchanged. Runs as the reporter.
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
  v_object uuid;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
    return new;
  end if;

  if new.content_type in ('gathering', 'community') then
    -- read as the reporter: only a gathering or community they can see, joined or not (its own read policy). Who owns it, the
    -- copy and the duplicate check are done next, server side, by _capture_report_object.
    if new.content_type = 'gathering' then
      select g.id into v_object from gatherings g where g.id = new.content_id;
    else
      select c.id into v_object from communities c where c.id = new.content_id;
    end if;
    if v_object is null then
      raise exception 'That isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    new.content_captured_at := now();
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

-- Runs right after _capture_report_content (trigger names sort: capture_report_content < capture_report_content_object), which has
-- already proved, as the reporter, that they can see it (content_captured_at is set only then; a client can't set it).
create or replace function private._capture_report_object()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_gathering gatherings%rowtype;
  v_community communities%rowtype;
  v_owner uuid;
  v_owner_name text;
  v_copy text;
begin
  if new.content_type is null or new.content_type not in ('gathering', 'community') then
    return new;
  end if;
  if new.content_captured_at is null then
    raise exception 'That isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
  end if;

  if new.content_type = 'gathering' then
    select * into v_gathering from gatherings g where g.id = new.content_id for share;
    if not found then
      raise exception 'That isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    v_owner := v_gathering.host_id;
  else
    select * into v_community from communities c where c.id = new.content_id for share;
    if not found then
      raise exception 'That isn''t available' using errcode = '22023', hint = 'report_content_mismatch';
    end if;
    v_owner := v_community.creator_id;
  end if;

  if v_owner is not null and v_owner = new.reporter_id then
    raise exception 'You can''t report your own' using errcode = '22023', hint = 'report_content_mismatch';
  end if;
  select p.display_name into v_owner_name from profiles p where p.id = v_owner;

  -- fixed facts first, so a long description can't push them out of the copy
  if new.content_type = 'gathering' then
    v_copy := concat_ws(E'\n',
      'Gathering: ' || v_gathering.title,
      'Host: ' || coalesce(nullif(btrim(v_owner_name), ''), '(no name)') || coalesce(' (' || v_owner::text || ')', ''),
      'When: ' || to_char(v_gathering.scheduled_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC',
      'Category: ' || nullif(btrim(v_gathering.interest_tag), ''),
      'Audience: ' || v_gathering.visibility || case when v_gathering.women_only then ', women only' else '' end,
      'Community: ' || (select c.name from communities c where c.id = v_gathering.community_id),
      'Business: ' || (select bp.name from brand_partners bp where bp.id = v_gathering.hosting_partner_id),
      'Cover photo: ' || nullif(btrim(v_gathering.cover_photo_path), ''),
      'Description: ' || nullif(btrim(v_gathering.description), ''),
      'Steps: ' || case when v_gathering.timeline_steps is not null then v_gathering.timeline_steps::text end);
  else
    v_copy := concat_ws(E'\n',
      'Community: ' || v_community.name,
      'Creator: ' || coalesce(nullif(btrim(v_owner_name), ''), '(no name)') || coalesce(' (' || v_owner::text || ')', ''),
      'Category: ' || nullif(btrim(v_community.interest_tag), ''),
      'Audience: ' || case when v_community.is_public then 'public' else 'private' end,
      'Status: ' || v_community.status,
      'Area: ' || nullif(concat_ws(', ', nullif(btrim(v_community.area_label), ''), nullif(btrim(v_community.area_city), ''),
                                   nullif(btrim(v_community.area_region), '')), ''),
      'Business: ' || (select bp.name from brand_partners bp where bp.id = v_community.hosting_partner_id),
      'Cover photo: ' || nullif(btrim(v_community.cover_photo_url), ''),
      'Description: ' || nullif(btrim(v_community.description), ''));
  end if;
  v_copy := left(v_copy, 4000);

  -- One person's reports on one object go one at a time, so the check below sees the other's committed row. Only for the caller's
  -- own id: this trigger runs before RLS refuses a borrowed reporter_id, and answering there would tell anyone who has reported what.
  if new.reporter_id = auth.uid() then
    perform pg_advisory_xact_lock(hashtextextended('report:' || new.reporter_id::text || ':' || new.content_id::text, 0));
    if exists (select 1 from reports r
                where r.reporter_id = new.reporter_id
                  and r.content_type = new.content_type
                  and r.content_id = new.content_id
                  and not coalesce(r.resolved, false)
                  and r.content_excerpt = v_copy) then
      raise exception 'You''ve already reported this' using errcode = '22023', hint = 'report_duplicate';
    end if;
  end if;

  new.reported_id := v_owner;
  new.content_excerpt := v_copy;
  return new;
end;
$function$;
revoke all on function private._capture_report_object() from public, anon, authenticated;

drop trigger if exists capture_report_content_object on public.reports;
create trigger capture_report_content_object before insert on public.reports
  for each row execute function private._capture_report_object();
