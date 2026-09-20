-- Offer push copy is a personal response, never an ad (owner item 43): "Coastal Coffee made you an offer ...". Only the
-- three push body strings change; submit_business_offer's signature, grants and behavior are unchanged (same overload).
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
      v_push_body := coalesce(v_partner_name, 'A business') || ' made you an offer: "' || v_offer_title || '"';
    elsif v_occ_type is not null then
      v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' made you an offer on your ' || lower(_occasion_noun(v_occ_type)) || ' request'
        || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
    else
      v_push_title := 'New offer for your request!';
      v_push_body := coalesce(v_partner_name, 'A business') || ' made you an offer on "' || left(v_raw_text, 60) || '"';
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
