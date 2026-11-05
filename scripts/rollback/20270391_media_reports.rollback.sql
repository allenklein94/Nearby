-- Rollback of 20270391 (photo reports, removal, real file deletion). A photo report is kept as a plain report about the poster: its
-- server copy stays in content_excerpt, "[photo <story id> <path>]" goes at the start of its details. Holds and the queue go, so
-- held files stay in the bucket, unreadable to anyone but the service role, and need listing first. The expiry job returns
-- to its old POST, which deletes nothing. Defect only; owner decides.
drop policy if exists "Admins can view reported media" on storage.objects;
drop function if exists public.admin_report_media_visible(text);
drop function if exists public.admin_remove_reported_media(uuid, text);
drop function if exists public.admin_get_report_media(uuid[]);
drop function if exists public.remove_gathering_memory(uuid);

drop trigger if exists queue_story_file on public.stories;
drop function if exists private._queue_story_file();
drop trigger if exists report_media_follow_outcome on public.report_actions;
drop function if exists private._report_media_follow_outcome();
drop trigger if exists hold_reported_story_media on public.reports;
drop function if exists private._hold_reported_story_media();
drop trigger if exists capture_report_content_story on public.reports;
drop function if exists private._capture_report_story();

alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports disable trigger freeze_report_evidence;
update public.reports r
   set details = '[photo ' || r.content_id::text || coalesce(' ' || (select e.media_path from private.report_media_evidence e where e.report_id = r.id), '') || ']'
                 || coalesce(' ' || r.details, ''),
       content_type = null,
       content_id = null
 where r.content_type = 'story';
alter table public.reports enable trigger freeze_report_evidence;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat',
                      'business_offer', 'business'));

drop table if exists private.story_media_removals;
drop table if exists private.story_file_cleanup;
drop table if exists private.report_media_evidence;

-- 20270381's function, verbatim
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

-- baseline's function, verbatim
CREATE OR REPLACE FUNCTION public.delete_expired_stories()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  expired_paths text[];
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  -- Gathering-linked stories are deliberately excluded — they're
  -- meant to persist as archived memories of the experience, not
  -- expire on the normal 24-hour personal-story timer. If the
  -- gathering itself is ever deleted, gathering_id goes null via
  -- the foreign key, and the story naturally becomes subject to
  -- normal expiry on the next run.
  select array_agg(media_path) into expired_paths
  from stories
  where expires_at <= now()
  and gathering_id is null;

  if expired_paths is not null and array_length(expired_paths, 1) > 0 then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/stories',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object('prefixes', expired_paths)
    );
  end if;

  delete from stories where expires_at <= now() and gathering_id is null;
end;
$function$;
revoke all on function public.delete_expired_stories() from public, anon, authenticated, service_role;
grant execute on function public.delete_expired_stories() to service_role;
