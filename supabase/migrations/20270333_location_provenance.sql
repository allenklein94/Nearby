-- Owner decision 2026-10-22 (Google storage fix, Option 1 "person confirms a pin" + sign-up "fill, business confirms").
-- Google's terms: a place ID may be kept indefinitely, Google coordinates only 30 days, nothing else may be kept.
-- A Google result now only centres the map; the person confirms the spot, and every stored location records HOW it was
-- reached (utils/locationProvenance.js is the one client rule). Confirmation is provenance, never a claim that
-- Google-derived values became independent data: 'google_confirmed' rows stay findable for the owner's terms review.
-- Rows written before this migration keep location_source NULL (= not recorded).

-- 1. Gatherings: source of the point + Google's place ID. Both PRIVATE like precise_lat/lng (a place ID locates the
--    meet-up point exactly, item 146): INSERT only, no client SELECT, no UPDATE (location is fixed after creation, item 73).
alter table public.gatherings add column if not exists location_source text;
alter table public.gatherings add column if not exists google_place_id text;
alter table public.gatherings drop constraint if exists gatherings_location_source_check;
alter table public.gatherings add constraint gatherings_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'google_adjusted', 'google_confirmed', 'business_profile')
);
alter table public.gatherings drop constraint if exists gatherings_google_place_id_source_check;
alter table public.gatherings add constraint gatherings_google_place_id_source_check check (
  google_place_id is null or location_source in ('google_adjusted', 'google_confirmed')
);
grant insert (location_source, google_place_id) on public.gatherings to authenticated;

-- 2. Business sign-up: who supplied the name/address, when the business confirmed Google-filled values, the pin's source
--    and Google's place ID. Phone and website are never filled from Google any more (typed by the business).
alter table public.business_partner_requests add column if not exists google_place_id text;
alter table public.business_partner_requests add column if not exists details_source text;
alter table public.business_partner_requests add column if not exists details_confirmed_at timestamptz;
alter table public.business_partner_requests add column if not exists location_source text;
alter table public.business_partner_requests drop constraint if exists bpr_details_source_check;
alter table public.business_partner_requests add constraint bpr_details_source_check check (
  details_source is null or details_source in ('business_entered', 'business_confirmed_google')
);
alter table public.business_partner_requests drop constraint if exists bpr_google_confirmed_check;
alter table public.business_partner_requests add constraint bpr_google_confirmed_check check (
  details_source is distinct from 'business_confirmed_google' or details_confirmed_at is not null
);
alter table public.business_partner_requests drop constraint if exists bpr_location_source_check;
alter table public.business_partner_requests add constraint bpr_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'google_adjusted', 'google_confirmed')
);
-- Coordinates are only ever the business's confirmed pin: none without a recorded source.
alter table public.business_partner_requests drop constraint if exists bpr_coordinates_need_source_check;
alter table public.business_partner_requests add constraint bpr_coordinates_need_source_check check (
  (latitude is null and longitude is null) or location_source is not null
) not valid;

-- 3. Businesses: the same two facts, carried over on approval. A later coordinate change through the profile editor
--    (update_business_profile, fed by the app's address geocoding) is labelled 'address_geocoded' by trigger, so a stale
--    'google_confirmed' never outlives the point it described.
alter table public.brand_partners add column if not exists location_source text;
alter table public.brand_partners add column if not exists google_place_id text;
alter table public.brand_partners drop constraint if exists brand_partners_location_source_check;
alter table public.brand_partners add constraint brand_partners_location_source_check check (
  location_source is null or location_source in ('device', 'host_pin', 'google_adjusted', 'google_confirmed', 'address_geocoded')
);

create or replace function public._brand_partner_location_provenance()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude)
     and new.location_source is not distinct from old.location_source then
    new.location_source := case when new.latitude is null and new.longitude is null then null else 'address_geocoded' end;
    new.google_place_id := null;
  end if;
  return new;
end;
$function$;
revoke all on function public._brand_partner_location_provenance() from public, anon, authenticated;

drop trigger if exists brand_partner_location_provenance on public.brand_partners;
create trigger brand_partner_location_provenance
  before update of latitude, longitude on public.brand_partners
  for each row execute function public._brand_partner_location_provenance();

-- Approval copies the business's confirmed location and its provenance (otherwise unchanged).
create or replace function public.approve_business_partner_request(request_id_param uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req record;
  new_partner_id uuid;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories, location_source, google_place_id)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories,
          case when req.latitude is null then null else req.location_source end, req.google_place_id)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  if true then
    perform public._send_push(req.requester_id, 'You''re approved as a partner! 🎉', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id));
  end if;

  return new_partner_id;
end;
$function$;

-- 4. Address searches (Google Geocoding: the pin screens' search and the business address editor) now count against the
--    same app-wide daily Google budget as Places calls (migration 20270332), kind 'geocode'. Otherwise unchanged.
create or replace function public.claim_places_search(kind_param text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_day date := (now() at time zone 'America/Los_Angeles')::date;
  v_limit int;
  v_calls int;
begin
  if auth.uid() is null then return false; end if;
  if kind_param is null or kind_param not in ('nearby', 'text', 'details', 'geocode') then
    raise exception 'Unknown places call' using errcode = '22023';
  end if;
  select daily_limit into v_limit from places_search_budget where id = 1;
  if coalesce(v_limit, 0) > 0 then
    insert into places_search_usage as u (day, calls) values (v_day, 1)
      on conflict (day) do update set calls = u.calls + 1 where u.calls < v_limit
      returning calls into v_calls;
  end if;
  if v_calls is null then
    insert into places_search_usage as u (day, refused) values (v_day, 1)
      on conflict (day) do update set refused = u.refused + 1;
    return false;
  end if;
  return true;
end;
$function$;
