-- Intent engine vision -- Business-side Experience Bundles (2026-09-10,
-- direct user request: "finish business side experience bundles"). See
-- CLAUDE.md's Active section and memory project_intent_engine_vision.
--
-- experienceAssembly.js's cross-category "Experiences" section
-- (services/experienceAssembly.js) already regroups multiple *different*
-- businesses'/gatherings' own real postings into one recipe (dinner from
-- one place, live music from another, dessert from a third). This closes
-- the other half: a SINGLE business can now optionally self-declare that
-- ONE of its own live availability postings covers MULTIPLE components of
-- one specific occasion's template all by itself -- e.g. a restaurant's own
-- "Date Night Package" that includes dinner AND live music AND dessert,
-- sold and fulfilled entirely by that one business. Still no fabricated
-- signal: the business itself explicitly ticks which real components its
-- one posting covers (no AI involved in this field at all, unlike most
-- other business-facing AI-suggested fields in this schema) -- same
-- "business declares its own real capability" honesty as every other
-- per-posting field on this table.
--
-- Two new nullable/defaulted columns on business_availability (the live,
-- time-boxed posting table -- NOT business_experiences/"Signature
-- Experiences," which is a different, older, single-category showcase
-- concept never wired into the intent resolver; see that table's own
-- 20260903_v2_business_signature_experiences.sql header):
--   bundle_occasion: which occasion template (if any) this posting is
--     meant to fulfill wholesale -- restricted to the 5 real occasions
--     experienceTemplates.js actually defines a template for (bundling for
--     casual_hangout/business_meal/other would have no components to
--     cover).
--   bundle_components: which of that template's own real component keys
--     (a flat union across all 5 templates -- experienceAssembly.js
--     interprets them contextually against the specific occasion's own
--     template at read time, same "flat CHECK vocabulary, contextual
--     meaning at read time" precedent brand_partners.categories/attributes
--     already established) this one posting covers by itself. Only counts
--     as a genuine multi-part bundle once at least 2 keys are set --
--     enforced client-side (experienceAssembly.js), not by this schema,
--     since "at least 2 of THIS occasion's own keys" needs the template
--     itself to evaluate.

alter table public.business_availability
  add column if not exists bundle_occasion text,
  add column if not exists bundle_components text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_availability_bundle_occasion_check'
  ) then
    alter table public.business_availability
      add constraint business_availability_bundle_occasion_check
      check (bundle_occasion is null or bundle_occasion in (
        'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_availability_bundle_components_check'
  ) then
    alter table public.business_availability
      add constraint business_availability_bundle_components_check
      check (bundle_components <@ array[
        'dinner', 'something_to_do', 'finish_the_night',
        'something_fun', 'sweet_treat',
        'food', 'family_fun'
      ]::text[]);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_availability_bundle_requires_occasion_check'
  ) then
    alter table public.business_availability
      add constraint business_availability_bundle_requires_occasion_check
      check (bundle_components = '{}' or bundle_occasion is not null);
  end if;
end $$;

-- ---------- FUNCTION: post_business_availability ----------
-- Adding two new trailing default params changes this function's own real
-- argument list even though its return type (jsonb) is unchanged -- per
-- this migration series' own now-repeatedly-learned lesson (CLAUDE.md
-- Standing Conventions: "CREATE OR REPLACE FUNCTION creates a second
-- overload... even with an unchanged return type"), a plain CREATE OR
-- REPLACE here would silently leave the old 9-arg signature live
-- side-by-side, so the drop below is required first. Every other line is
-- byte-for-byte the live version (confirmed via pg_get_functiondef before
-- writing this) plus the two new params/validation/insert columns.
drop function if exists public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision);

create function public.post_business_availability(
  category_param text,
  title_param text,
  description_param text,
  offer_type_param text,
  price_param numeric,
  capacity_param integer,
  starts_at_param timestamptz,
  ends_at_param timestamptz,
  radius_miles_param double precision default 15,
  bundle_occasion_param text default null,
  bundle_components_param text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_req record;
  service_key text;
  v_bundle_components text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  if bundle_occasion_param is not null and bundle_occasion_param not in (
    'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
  ) then
    raise exception 'Invalid bundle occasion';
  end if;

  v_bundle_components := coalesce(bundle_components_param, '{}');
  if not (v_bundle_components <@ array[
    'dinner', 'something_to_do', 'finish_the_night',
    'something_fun', 'sweet_treat',
    'food', 'family_fun'
  ]::text[]) then
    raise exception 'Invalid bundle component';
  end if;
  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (capacity_param is null or br.party_size is null or capacity_param >= br.party_size)
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;

      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_req.requester_id,
          'title', 'New offer for your request!',
          'body', trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"',
          'data', jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id)
        )
      );
    end if;
  end loop;

  return jsonb_build_object('availabilityId', v_availability_id, 'matchedCount', v_matched_count);
end;
$function$;

revoke all on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[]) from public, anon;
grant execute on function public.post_business_availability(text, text, text, text, numeric, integer, timestamptz, timestamptz, double precision, text, text[]) to authenticated;

-- ---------- FUNCTION: search_active_business_availability ----------
-- RETURNS TABLE's column list is changing again (4th time), so per this
-- same lesson a real drop is required -- CREATE OR REPLACE cannot change
-- it and would just create a second overload. Every other line is
-- byte-for-byte the live version (confirmed via pg_get_functiondef before
-- writing this) plus the two new trailing columns.
drop function if exists public.search_active_business_availability(text, double precision, double precision, double precision, integer);

create function public.search_active_business_availability(
  category_param text default null,
  latitude_param double precision default null,
  longitude_param double precision default null,
  radius_miles_param double precision default 15,
  party_size_param integer default null
)
returns table(
  id uuid, partner_id uuid, partner_name text, title text, description text,
  offer_type text, price numeric, category text, starts_at timestamp with time zone,
  ends_at timestamp with time zone, distance_miles double precision,
  attributes text[], cuisine text, remaining_capacity integer,
  accommodates_party_types text[], priority_occasions text[], subcategory text,
  categories text[], bundle_occasion text, bundle_components text[]
)
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
    p.attributes, p.cuisine, ba.remaining_capacity, p.accommodates_party_types, p.priority_occasions, p.subcategory,
    p.categories, ba.bundle_occasion, ba.bundle_components
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
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
  limit 30;
$function$;

revoke all on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) from public, anon;
grant execute on function public.search_active_business_availability(text, double precision, double precision, double precision, integer) to authenticated;

-- ---------- FUNCTION: admin_review_business_content_screening ----------
-- Same "byte-for-byte the live version" discipline, return type (void)
-- and param list unchanged -- a plain CREATE OR REPLACE is safe here (only
-- the availability insert branch's column list changes). Handles the
-- MEDIUM/UNCERTAIN-tier raw-insert path, since that path bypasses
-- post_business_availability() entirely (it inserts directly, reading the
-- held content_snapshot) -- confirmed via pg_get_functiondef this is the
-- only other write path into business_availability besides the RPC above.
create or replace function public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := now();
    v_ends_at := case
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      )
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select name into v_partner_name from brand_partners where id = v_row.partner_id;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', 'New offer for your request!',
        'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"',
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
      )
    );
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;
