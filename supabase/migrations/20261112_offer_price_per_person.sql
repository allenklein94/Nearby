-- Item 93 follow-up (CLAUDE.md, "add the per-person field follow-up"): the
-- multi-business-comparison audit for Item 93 found a real, deliberately-
-- disclosed gap rather than guessing at it -- business_request_offers.
-- offer_price is a single flat number with no way to know whether a
-- business meant "$70 per person" or "$70 total" (a real venue rental fee
-- can honestly be either). The consumer-facing comparison card
-- (BusinessRequestDetailScreen.js's "Compare Your Options") was rendering
-- every price the same bare "$X.XX", which the item's own mock explicitly
-- contradicts ("Restaurant A -- $70/person"). This adds the real field
-- rather than fabricating a label with nothing behind it.
--
-- A second, genuinely live bug was found while wiring this up, not
-- hypothetical: _match_request_to_package() (Item 68) already computes
-- offer_price two different ways depending on whether the request's own
-- party_size is known -- price_per_person * party_size (a real total) when
-- it is, but price_per_person UNCHANGED (a real per-person rate, not a
-- total) when party_size is null. Every offer auto-generated from an
-- Occasion Package match with an unknown party size has therefore always
-- stored a genuinely per-person number under offer_price while the client
-- rendered it exactly like a flat total -- a real, silent mislabeling this
-- migration also fixes at the source, not just for future offers.

alter table public.business_request_offers
  add column if not exists price_is_per_person boolean not null default false;

-- ---------------------------------------------------------------------
-- _match_request_to_package: correctly flag which real case actually
-- happened (multiplied-into-a-total vs. genuinely-still-per-person) in
-- both the preferred-binding block and the general scan loop below it.
-- Unchanged signature -- CREATE OR REPLACE is safe here.
-- ---------------------------------------------------------------------

create or replace function public._match_request_to_package(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  occasion_param text,
  party_size_param integer,
  date_param date,
  preferred_package_id_param uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_pkg record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  v_offer_price numeric;
  v_price_is_per_person boolean;
  i integer;
begin
  if occasion_param is null then
    return 0;
  end if;

  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_package_id_param is not null then
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true
    where bop.id = preferred_package_id_param
    and bop.active = true
    and bop.occasion_type = occasion_param
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      v_offer_price := case
        when v_preferred.price_per_person is not null and party_size_param is not null
          then v_preferred.price_per_person * party_size_param
        else v_preferred.price_per_person
      end;
      -- Genuinely per-person only when a real rate exists AND it could NOT
      -- be multiplied into a total (party size unknown) -- the exact other
      -- half of the case expression directly above, never re-derived
      -- separately so the two can't drift apart.
      v_price_is_per_person := (v_preferred.price_per_person is not null and party_size_param is null);

      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (
        request_id, partner_id, offer_type, offer_description, offer_title, included_items,
        offer_price, price_is_per_person, package_id, status, responded_at
      )
      values (
        request_id_param, v_preferred.partner_id, 'standard',
        v_preferred.name || coalesce(': ' || v_preferred.description, ''),
        v_preferred.name, v_preferred.included_items,
        v_offer_price, v_price_is_per_person, v_preferred.id, 'offered', now()
      )
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_title = excluded.offer_title, included_items = excluded.included_items,
            offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
            package_id = excluded.package_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your occasion package was just matched!',
                'body', '"' || v_preferred.name || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_pkg in
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true
    where bop.active = true
    and bop.occasion_type = occasion_param
    and (preferred_package_id_param is null or bop.id != preferred_package_id_param)
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and (
      date_param is null or bop.available_days is null
      or extract(dow from date_param)::smallint = any(bop.available_days)
    )
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by bop.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_pkg.partner_id
    ) into v_already_offered;

    v_offer_price := case
      when v_pkg.price_per_person is not null and party_size_param is not null
        then v_pkg.price_per_person * party_size_param
      else v_pkg.price_per_person
    end;
    v_price_is_per_person := (v_pkg.price_per_person is not null and party_size_param is null);

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_description, offer_title, included_items,
      offer_price, price_is_per_person, package_id, status, responded_at
    )
    values (
      request_id_param, v_pkg.partner_id, 'standard',
      v_pkg.name || coalesce(': ' || v_pkg.description, ''),
      v_pkg.name, v_pkg.included_items,
      v_offer_price, v_price_is_per_person, v_pkg.id, 'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_title = excluded.offer_title, included_items = excluded.included_items,
          offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
          package_id = excluded.package_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_pkg.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your occasion package was just matched!',
              'body', '"' || v_pkg.name || '" matches a new request: "' || left(coalesce(v_raw_text, ''), 60) || '"',
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return v_new_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- submit_business_offer: a business can now explicitly mark its own
-- manually-typed price as per-person -- unchecked (the default) still
-- means exactly what it always meant, a flat number, so no existing offer
-- or in-flight client call changes meaning. New trailing optional param --
-- old 10-arg signature explicitly dropped first per this repo's own
-- "changing the parameter list creates a second overload" convention.
-- ---------------------------------------------------------------------

drop function if exists public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[]);

create or replace function public.submit_business_offer(
  request_id_param uuid,
  offer_type_param text,
  offer_description_param text,
  offer_price_param numeric default null::numeric,
  proposed_time_param timestamp with time zone default null::timestamp with time zone,
  experience_id_param uuid default null::uuid,
  media_path_param text default null::text,
  media_type_param text default null::text,
  offer_title_param text default null::text,
  included_items_param text[] default '{}'::text[],
  price_is_per_person_param boolean default false
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
  service_key text;
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
  from business_requests where id = request_id_param;
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  v_offer_title := nullif(trim(coalesce(offer_title_param, '')), '');

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_title = v_offer_title,
      included_items = coalesce(v_items, '{}'),
      offer_price = offer_price_param,
      price_is_per_person = coalesce(price_is_per_person_param, false),
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      responded_at = now()
  where id = v_row.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select name into v_partner_name from brand_partners where id = v_partner_id;
  if coalesce((select notify_business from profiles where id = v_requester_id), true) then
    select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(request_id_param);

    if v_offer_title is not null then
      v_push_title := 'New offer for your request!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' sent you "' || v_offer_title || '"';
    elsif v_occ_type is not null then
      v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' responded to your ' || lower(_occasion_noun(v_occ_type)) || ' request'
        || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
    else
      v_push_title := 'New offer for your request!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' responded to "' || left(v_raw_text, 60) || '"';
    end if;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', v_push_title,
        'body', v_push_body,
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', request_id_param, 'offer_id', v_row.id)
      )
    );
  end if;

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$
;

revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean) from public, anon;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- admin_review_business_content_screening: offer_response branch reads the
-- same real boolean back out of its own jsonb content_snapshot (added to
-- the Edge Function's contentSnapshot alongside offerPrice). Whole function
-- re-pasted, CREATE OR REPLACE, unchanged signature -- same established
-- precedent this function's every prior touch has followed. Only the
-- offer_response branch's UPDATE actually changed.
-- ---------------------------------------------------------------------

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
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
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

    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
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

    if coalesce((select notify_business from profiles where id = v_requester_id), true) then
      select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      select name into v_partner_name from brand_partners where id = v_row.partner_id;
      select occasion_type, who_for_name into v_occ_type, v_occ_who
      from _occasion_context_for_business_request(nullif(v_row.content_snapshot->>'requestId', '')::uuid);

      if v_offer_title is not null then
        v_push_title := 'New offer for your request!';
        v_push_body := coalesce(v_partner_name, 'A business') || ' sent you "' || v_offer_title || '"';
      elsif v_occ_type is not null then
        v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
        v_push_body := coalesce(v_partner_name, 'A business') || ' responded to your ' || lower(_occasion_noun(v_occ_type)) || ' request'
          || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
      else
        v_push_title := 'New offer for your request!';
        v_push_body := coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"';
      end if;

      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_requester_id,
          'title', v_push_title,
          'body', v_push_body,
          'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
        )
      );
    end if;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

-- ---------------------------------------------------------------------
-- get_business_opportunities (Item 69, extended by Item 80/81): add
-- price_is_per_person to the already-fixed jsonb column list, so the
-- dashboard's own "Upcoming Nearby Visits" card (via formatOfferSummary())
-- can render the same honest "/person" suffix the consumer's comparison
-- card now does. RETURNS jsonb, not RETURNS TABLE -- plain CREATE OR
-- REPLACE is safe, no overload risk.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id,
      jsonb_build_object(
        'raw_text', br.raw_text,
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'gathering_id', br.gathering_id,
        'match_id', br.match_id,
        'attributes', br.attributes,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'plan_label', br.plan_label,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$;
