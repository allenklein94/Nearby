-- CLAUDE.md, "Aug 25 2026 -- building the taxonomy audit's real
-- recommendations", Phases 1 and 2. Bundled into one migration since both
-- are part of one authorized, cohesive build pass -- matches this schema's
-- own precedent (e.g. 20260814_business_fulfillment.sql) of bundling
-- related tables/RPCs for one feature rather than splitting every column
-- into its own file.

-- ============================================================
-- PHASE 1 -- Dating Preferences consolidation: one-time gender
-- backfill (data-only, no new schema)
-- ============================================================
-- Legacy single-select discovery_gender/show_me -> new multi-select
-- gender_identity/interested_in_genders, only when the new fields are
-- still genuinely empty. A literal translation of what the legacy value
-- already meant, never an invented preference:
--   discovery_gender 'Men'/'Women'/'Other'/'Prefer not to say'
--     -> gender_identity ['Man']/['Woman']/['Other']/['Prefer not to say']
--   show_me 'Men'/'Women'/'Everyone'
--     -> interested_in_genders ['Man']/['Woman']/<all 9 GENDER_IDENTITY_OPTIONS>
-- 'Everyone' means "show me any gender" -- the honest new-field equivalent
-- is being interested in every real identity option, not a guess.
update profiles
set gender_identity = case discovery_gender
  when 'Men' then array['Man']
  when 'Women' then array['Woman']
  when 'Other' then array['Other']
  when 'Prefer not to say' then array['Prefer not to say']
  else gender_identity
end
where (gender_identity is null or array_length(gender_identity, 1) is null)
and discovery_gender is not null;

update profiles
set interested_in_genders = case show_me
  when 'Men' then array['Man']
  when 'Women' then array['Woman']
  when 'Everyone' then array['Man', 'Woman', 'Non-binary', 'Trans man', 'Trans woman', 'Genderfluid', 'Agender', 'Other', 'Prefer not to say']
  else interested_in_genders
end
where (interested_in_genders is null or array_length(interested_in_genders, 1) is null)
and show_me is not null;

-- ============================================================
-- PHASE 2 -- Business Attributes: a small curated tag set, not a
-- general free-text system, per the audit's own sized-down
-- recommendation.
-- ============================================================
alter table brand_partners add column if not exists attributes text[] not null default '{}';
alter table brand_partners add column if not exists cuisine text;

alter table brand_partners
  add constraint brand_partners_attributes_check
  check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]);

alter table brand_partners
  add constraint brand_partners_cuisine_check
  check (cuisine is null or cuisine in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other'));

-- business_requests: the consumer's own optional ask-level preference,
-- never inferred -- explicitly picked on AskBusinessScreen's own solo
-- mode. Same curated vocabulary as brand_partners.attributes/cuisine so
-- overlap can be computed directly, no translation layer.
alter table business_requests add column if not exists attributes text[] not null default '{}';
alter table business_requests add column if not exists cuisine text;

alter table business_requests
  add constraint business_requests_attributes_check
  check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]);

alter table business_requests
  add constraint business_requests_cuisine_check
  check (cuisine is null or cuisine in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other'));

-- update_business_profile() -- gains attributes_param/cuisine_param.
-- Every other line is byte-for-byte the live function pulled fresh via
-- the Management API before this migration was written. The argument
-- list changes (two new trailing DEFAULT-NULL params) -- a plain CREATE
-- OR REPLACE would silently create a second, orphaned overload rather
-- than truly replacing the original (Postgres identifies a function by
-- name + argument-type list, not name alone), the exact class of bug
-- this schema's own history has caught and fixed more than once. Explicit
-- DROP of the old 8-arg signature first, matching this file's own
-- established discipline.
drop function if exists update_business_profile(uuid, text, text, text, double precision, double precision, text, text);

create function update_business_profile(
  partner_id_param uuid,
  name_param text,
  description_param text,
  address_param text,
  latitude_param double precision,
  longitude_param double precision,
  logo_url_param text,
  category_param text default null,
  attributes_param text[] default null,
  cuisine_param text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if name_param is null or trim(name_param) = '' then
    raise exception 'Business name cannot be empty';
  end if;

  if category_param is not null and category_param not in (
    'food_drink', 'fitness_wellness', 'retail_shopping',
    'arts_entertainment', 'professional_services', 'other'
  ) then
    raise exception 'Invalid category';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param,
      category = category_param,
      attributes = coalesce(attributes_param, attributes),
      cuisine = case when attributes_param is not null then cuisine_param else cuisine end
  where id = partner_id_param;
end;
$function$;

revoke all on function update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text) from public, anon;
grant execute on function update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text) to authenticated;

-- create_business_request() -- gains attributes_param/cuisine_param,
-- stored on the new row, threaded through to nothing else in this
-- function's own body (the fanout call below is what actually reads
-- them, via the row it just inserted -- no param needs passing there).
-- Explicitly DROP + CREATE since the argument list changes (two new
-- trailing DEFAULT-NULL params) -- matches this schema's own established
-- "drop the old signature explicitly, don't leave an orphaned overload"
-- discipline. Every other line is byte-for-byte the live function pulled
-- fresh via the Management API before this migration was written.
drop function if exists create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid);

create function create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15,
  submission_id_param uuid default null,
  preferred_availability_id_param uuid default null,
  attributes_param text[] default null,
  cuisine_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_expires_at := case
    when date_param is not null and time_window_end_param is not null
      then (date_param + time_window_end_param)::timestamptz
    when date_param is not null
      then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;

  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id, attributes, cuisine
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text) from public, anon;
grant execute on function create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text) to authenticated;

-- _business_request_fanout() -- same signature (no arg-list change), so
-- a plain CREATE OR REPLACE is safe. Every line is byte-for-byte the live
-- function pulled fresh via the Management API, except one new, additive
-- ordering tier: a real attribute/cuisine overlap count between the
-- request and each eligible partner, inserted as the FIRST sort key.
-- Zero effect on the common case (most requests set no attributes/
-- cuisine at all, so overlap_count is 0 for everyone and the existing
-- established/completion_rate/distance order is completely unchanged --
-- matches this file's own "never worse for the common case" precedent
-- from the Aug 15 reliability-weighting fix on this exact function).
-- Deliberately NOT touched: _match_request_to_availability()/
-- _match_request_to_policy() (the two auto-accept RPCs) -- those stay
-- governed purely by category/date/time/party-size/radius, unchanged.
create or replace function public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine into v_raw_text, v_req_attributes, v_req_cuisine from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      -- Real attribute/cuisine overlap with what this request actually
      -- asked for -- 0 (a no-op) whenever the request specified no
      -- attributes/cuisine at all, which is the common case today.
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      -- Established (5+ real past opportunities) partners next, ranked
      -- by real completion rate. Everyone else (no row, or under the
      -- threshold) falls through in exactly their prior distance-only
      -- order -- completion_rate is null for them, "nulls last" keeps
      -- them as one undifferentiated group below the established ones.
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'A customer is asking for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$;

-- search_active_business_availability() -- return shape changes (2 new
-- trailing columns), so DROP + CREATE, matching this schema's own
-- established convention for a return-type change. Purely additive,
-- read-only, zero risk -- every other line is byte-for-byte the live
-- function pulled fresh via the Management API.
drop function if exists search_active_business_availability(text, double precision, double precision, double precision);

create function search_active_business_availability(category_param text default null, latitude_param double precision default null, longitude_param double precision default null, radius_miles_param double precision default 15)
 returns table(id uuid, partner_id uuid, partner_name text, title text, description text, offer_type text, price numeric, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, distance_miles double precision, attributes text[], cuisine text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    ba.id, ba.partner_id, p.name as partner_name, ba.title, ba.description,
    ba.offer_type, ba.price, ba.category, ba.starts_at, ba.ends_at,
    case
      when latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null then null
      else (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      ))
    end as distance_miles,
    p.attributes, p.cuisine
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or ba.remaining_capacity > 0)
  and (category_param is null or ba.category is null or ba.category = category_param)
  and (
    latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null
    or (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
  )
  order by distance_miles asc nulls last, ba.created_at desc
  limit 6;
$function$;

revoke all on function search_active_business_availability(text, double precision, double precision, double precision) from public, anon;
grant execute on function search_active_business_availability(text, double precision, double precision, double precision) to authenticated;
