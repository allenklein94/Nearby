-- Rollback for migration 20270372 (offer safety). Restores every function, grant, trigger and constraint to what it was
-- before. Refuses (raises, nothing changed) when rolling back would have to destroy evidence or records the migration made
-- possible: a 'business_offer' report or a 'package' screening result. The owner decides those rows first.
do $$
begin
  if exists (select 1 from public.reports where content_type = 'business_offer') then
    raise exception 'reports about business offers exist (20270372); resolve them before rolling back';
  end if;
  if exists (select 1 from public.business_content_screening_results where target_type = 'package') then
    raise exception 'package screening results exist (20270372); decide them before rolling back';
  end if;
end $$;

-- 3. report this offer
drop trigger if exists capture_report_content_offer on public.reports;
drop function if exists private._capture_report_business_offer();
alter table public.reports drop constraint if exists reports_content_type_check;
alter table public.reports add constraint reports_content_type_check check (
  content_type is null
  or content_type in ('message', 'gathering_message', 'community_message', 'plan_message', 'business_message', 'match_chat'));
-- 20270355's version, verbatim
create or replace function public._capture_report_content()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_sender uuid;
  v_body text;
  v_at timestamptz;
begin
  new.content_excerpt := null;
  new.content_sent_at := null;
  new.content_captured_at := null;
  if new.content_type is null then
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

-- 2. contact rule
drop trigger if exists offer_contact_guard on public.business_request_offers;
drop trigger if exists offer_contact_guard on public.business_availability;
drop trigger if exists offer_contact_guard on public.business_occasion_packages;
drop trigger if exists offer_contact_guard on public.brand_offers;
drop function if exists private._offer_contact_guard();
drop function if exists private._refuse_offer_contact(text[]);
drop function if exists public.offer_contact_info_kind(text[]);
drop function if exists private.offer_contact_kind_any(text[]);
drop function if exists private.offer_contact_kind(text);

-- 1. screening binding
drop trigger if exists apply_approved_package on public.business_content_screening_results;
drop function if exists private._apply_approved_package_screening();
drop trigger if exists zz_requires_screening on public.brand_offers;
drop trigger if exists zz_requires_screening on public.business_updates;
drop function if exists private._brand_offer_requires_screening();
drop function if exists private._business_update_requires_screening();
drop function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint);
alter function private.submit_business_offer_unscreened(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) rename to submit_business_offer;
alter function private.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) set schema public;
revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) to authenticated;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time, timestamptz, smallint) to service_role;
drop function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric);
alter function private.post_business_availability_unscreened(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric) rename to post_business_availability;
alter function private.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric) set schema public;
revoke all on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric) to authenticated;
grant execute on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[], numeric) to service_role;
drop function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]);
alter function private.update_business_profile_unscreened(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) rename to update_business_profile;
alter function private.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) set schema public;
revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) from postgres, service_role;  -- original ACL order: PUBLIC, postgres, anon, authenticated, service_role (regranted below)
drop function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text);
alter function private.create_business_experience_unscreened(uuid, text, text, text, text[], text, text, boolean, text, text) rename to create_business_experience;
alter function private.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) set schema public;
revoke all on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to authenticated;
grant execute on function public.create_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to service_role;
drop function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text);
alter function private.update_business_experience_unscreened(uuid, text, text, text, text[], text, text, boolean, text, text) rename to update_business_experience;
alter function private.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) set schema public;
revoke all on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to authenticated;
grant execute on function public.update_business_experience(uuid, text, text, text, text[], text, text, boolean, text, text) to service_role;
drop function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]);
alter function private.create_occasion_package_unscreened(text, text, text, text[], integer, numeric, smallint[]) rename to create_occasion_package;
alter function private.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) set schema public;
revoke all on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) to authenticated;
grant execute on function public.create_occasion_package(text, text, text, text[], integer, numeric, smallint[]) to service_role;
drop function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]);
alter function private.update_occasion_package_unscreened(uuid, text, text, text, text[], integer, numeric, smallint[]) rename to update_occasion_package;
alter function private.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) set schema public;
revoke all on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) from service_role;  -- restore the original ACL order (authenticated, then service_role)
grant execute on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) to authenticated;
grant execute on function public.update_occasion_package(uuid, text, text, text, text[], integer, numeric, smallint[]) to service_role;
-- update_business_profile also had PUBLIC + anon EXECUTE before 20270372
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) to public;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) to postgres;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) to anon;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) to authenticated;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text, text[]) to service_role;
drop function if exists private._caller_partner();
drop function if exists private.screening_content_update(text, text);
drop function if exists private.screening_content_perk(text, text, text);
drop function if exists private.screening_content_package(text, text, text[]);
drop function if exists private._package_items(text[]);
drop function if exists private.screening_content_experience(text, text, text, text);
drop function if exists private.screening_content_profile(text, text, text, text);
drop function if exists private.screening_content_availability(text, text);
drop function if exists private.screening_content_offer_response(uuid, text, text, text[], text, text, text, text, uuid);
drop function if exists private.require_business_screening(uuid, text, uuid, jsonb);
drop function if exists private._is_server_write();
drop function if exists private._screening_snapshot_matches(jsonb, jsonb);
drop function if exists private._screening_value(jsonb);

drop index if exists public.business_content_screening_unconsumed_idx;
alter table public.business_content_screening_results drop constraint if exists business_content_screening_results_target_type_check;
alter table public.business_content_screening_results add constraint business_content_screening_results_target_type_check
  check (target_type = any (array['business_profile', 'offer', 'experience', 'availability', 'update', 'offer_response', 'creative']));
alter table public.business_content_screening_results drop column if exists consumed_at;
