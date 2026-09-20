-- Available window on an offer (owner item 42): "Available 6:00-8:00 PM". A time-of-day window (no date of its own: it
-- applies to the day the visit is for), entered by the owner, shown to the customer on the offer, never inferred.
-- Written by the ONE offer writer (submit_business_offer) and the reviewer-approval path (same fields), like valid_until.
alter table public.business_request_offers add column if not exists available_from time;
alter table public.business_request_offers add column if not exists available_until time;
alter table public.business_request_offers drop constraint if exists business_request_offers_available_window_check;
alter table public.business_request_offers add constraint business_request_offers_available_window_check
  check ((available_from is null and available_until is null) or (available_from is not null and available_until is not null and available_until > available_from)) not valid;

drop function if exists public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text, offer_title_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], price_is_per_person_param boolean DEFAULT false, discount_pct_param numeric DEFAULT NULL::numeric, redemption_instructions_param text DEFAULT NULL::text, media_poster_path_param text DEFAULT NULL::text, creative_id_param uuid DEFAULT NULL::uuid, valid_until_param timestamp with time zone DEFAULT NULL::timestamp with time zone, available_from_param time without time zone DEFAULT NULL::time without time zone, available_until_param time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_creative record;
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

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;

  -- A saved creative REPLACES any media passed: its file and poster come from the library row (already screened).
  if creative_id_param is not null then
    select * into v_creative from business_creatives
     where id = creative_id_param and partner_id = v_partner_id and archived_at is null;
    if not found then raise exception 'That saved creative is not available.'; end if;
    media_path_param := v_creative.media_path;
    media_type_param := v_creative.media_type;
    media_poster_path_param := v_creative.poster_path;
  end if;
  if valid_until_param is not null and (valid_until_param <= now() or valid_until_param > now() + interval '30 days') then
    raise exception 'Pick an end time that is later than now (within 30 days).';
  end if;
  -- "Available 6:00-8:00 PM": the owner's own time-of-day window for when this offer can be used, on the day the visit
  -- is for (the accepted alternative time's day, else the request's date). Both ends or neither; same-day only.
  if (available_from_param is null) <> (available_until_param is null) then
    raise exception 'Set both a start and an end for the available window, or neither.';
  end if;
  if available_from_param is not null and available_until_param <= available_from_param then
    raise exception 'The available window must end after it starts.';
  end if;
  if redemption_instructions_param is not null and length(redemption_instructions_param) > 500 then
    raise exception 'Redemption instructions are too long.';
  end if;
  -- A video offer must carry a preview image (the frame Nearby screened); an image offer needs none.
  if media_type_param = 'video' and media_poster_path_param is null then
    raise exception 'A video needs a preview image.';
  end if;
  -- Media must live in this business's own folder of the offer-media bucket.
  if media_path_param is not null and media_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;
  if media_poster_path_param is not null and media_poster_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
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
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      media_poster_path = case when media_type_param = 'video' then media_poster_path_param else null end,
      redemption_instructions = nullif(trim(coalesce(redemption_instructions_param, '')), ''),
      creative_id = creative_id_param,
      valid_until = valid_until_param,
      available_from = available_from_param,
      available_until = available_until_param,
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
$function$;


revoke all on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time) from public, anon;
grant execute on function public.submit_business_offer(uuid, text, text, numeric, timestamptz, uuid, text, text, text, text[], boolean, numeric, text, text, uuid, timestamptz, time, time) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
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
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
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

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
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
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
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
