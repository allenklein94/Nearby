-- Item 62 (owner, 2026-10-12): several businesses replying to ONE request show as ONE notification on the phone, replaced in
-- place, instead of a pile. Every reply still pushes at once (nothing is delayed, held, replayed or staged); each reply push
-- carries collapse_key 'offers:<request id>', which send-push passes to Expo as collapseId (iOS: replaces the shown one) and tag
-- (Android: replaces the shown one). Grouping is by request id only: replies to different requests never replace each other.
-- Wording: 1 open reply = today's text, unchanged (each path keeps its own); 2+ = "{emoji} N businesses responded" /
-- "See their replies to your {what}.", N = the request's replies with status 'offered' (one row per business: unique
-- (request_id, partner_id)). The words are decided in _push_outbox_deliver right before the hand-off, so a RETRY or a
-- late hand-off carries the count as it is then, never an older one; an advisory lock per request makes two replies
-- committing at the same moment count each other (the second waits for the first to commit, then counts both).
-- 0 open replies at hand-off = not sent (status failed, reason stated). Known limit (documented): the count is true when sent; a later withdrawal does not change a notification already shown.
-- The roll-up drops offer_id (its tap opens the request, not one business's offer) and carries reply_count.

-- One source for "what this request is" in reply pushes (was inline in _business_reply_push; identical output).
create or replace function public._business_reply_what(request_id_param uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_category text; v_gathering uuid; v_occ_type text; v_occ_who text;
begin
  select category, gathering_id into v_category, v_gathering from business_requests where id = request_id_param;
  select c.occasion_type, c.who_for_name into v_occ_type, v_occ_who from public._occasion_context_for_business_request(request_id_param) c;
  return case
      when v_gathering is not null then coalesce(lower(v_category) || ' ', '') || 'gathering'
      when v_occ_type is not null then lower(public._occasion_noun(v_occ_type)) || case when v_occ_who is not null then ' for ' || v_occ_who else '' end
      when v_category is not null then lower(v_category) || ' request'
      else 'request'
    end;
end;
$$;
revoke all on function public._business_reply_what(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._business_reply_push(offer_id_param uuid, OUT title text, OUT body text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record; v_partner_name text; v_category text; v_gathering uuid; v_occ_type text; v_occ_who text; v_kind text; v_what text;
begin
  select * into o from business_request_offers where id = offer_id_param;
  if not found then return; end if;
  select name into v_partner_name from brand_partners where id = o.partner_id;
  select category, gathering_id into v_category, v_gathering from business_requests where id = o.request_id;
  select c.occasion_type, c.who_for_name into v_occ_type, v_occ_who from public._occasion_context_for_business_request(o.request_id) c;
  v_kind := public._business_reply_kind(o.offer_type, o.offer_title, o.offer_price, o.discount_pct, o.included_items);
  v_what := public._business_reply_what(o.request_id);
  title := public._offer_push_emoji(v_category, v_occ_type) || ' ' || coalesce(v_partner_name, 'A business') || ' responded';
  body := case v_kind
      when 'availability' then 'They can take you for your ' || v_what || '.'
      when 'alternative' then 'They suggested another time for your ' || v_what || '.'
      else 'They sent an offer for your ' || v_what
           || case when nullif(trim(coalesce(o.offer_title, '')), '') is not null then ': ' || trim(o.offer_title) else '.' end
    end;
end;
$function$;

-- The ONE rule for a reply push's words, decided from the LIVE open replies right before each hand-off:
--   2+ open replies -> the roll-up with the count;
--   1 open reply    -> that reply's own words: a push still about it keeps exactly what was queued (each path's text);
--                      a push that had rolled up, or was about a reply no longer open, becomes the remaining reply's text;
--   0 open replies  -> not sent (returns false): nothing it could say would still be true.
create or replace function public._refresh_reply_push(outbox_id_param bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  o record; v_req uuid; v_n integer; v_one uuid; v_category text; v_occ_type text; v_t text; v_b text;
begin
  select * into o from push_outbox where id = outbox_id_param;
  if not found or o.data->>'type' is distinct from 'business_offer_received' or not (o.data ? 'collapse_key') then return true; end if;
  v_req := (o.data->>'request_id')::uuid;
  -- serialize per request: a reply committing at the same moment is counted by whichever hands off second
  perform pg_advisory_xact_lock(hashtextextended('reply_push:' || v_req::text, 0));
  select count(*), min(id::text)::uuid into v_n, v_one from business_request_offers where request_id = v_req and status = 'offered';
  if v_n = 0 then
    return false;
  elsif v_n = 1 then
    if not (o.data ? 'reply_count') and (o.data->>'offer_id' is null or (o.data->>'offer_id')::uuid = v_one) then
      return true;  -- still about the one open reply: exactly as queued
    end if;
    select p.title, p.body into v_t, v_b from public._business_reply_push(v_one) p;
    update push_outbox set title = v_t, body = v_b,
      data = (o.data - 'reply_count') || jsonb_build_object('offer_id', v_one), updated_at = now()
    where id = o.id;
    return true;
  end if;
  select category into v_category from business_requests where id = v_req;
  select c.occasion_type into v_occ_type from public._occasion_context_for_business_request(v_req) c;
  update push_outbox set
    title = public._offer_push_emoji(v_category, v_occ_type) || ' ' || v_n || ' businesses responded',
    body = 'See their replies to your ' || public._business_reply_what(v_req) || '.',
    data = (o.data - 'offer_id') || jsonb_build_object('reply_count', v_n),
    updated_at = now()
  where id = o.id;
  return true;
end;
$$;
revoke all on function public._refresh_reply_push(bigint) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._push_outbox_deliver(outbox_id_param bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_key text;
  v_req bigint;
begin
  select * into o from push_outbox where id = outbox_id_param for update;
  if not found or o.status not in ('pending', 'retry') then
    return coalesce(o.status, 'missing');
  end if;
  -- Item 62: a reply push is worded from the request's LIVE open replies at the moment it is handed off (first try or retry)
  if o.data->>'type' = 'business_offer_received' and o.data ? 'collapse_key' then
    if not public._refresh_reply_push(o.id) then
      update push_outbox set status = 'failed', last_error = 'not sent: no open reply left on this request', updated_at = now()
      where id = o.id;
      return 'failed';
    end if;
    select * into o from push_outbox where id = outbox_id_param;
  end if;
  begin
    -- test switch, transaction-local only: lets the journey prove a failed hand-off is kept and retried
    if current_setting('app.push_handoff_test_failure', true) = 'on' then
      raise exception 'simulated hand-off failure';
    end if;
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
    if v_key is null then
      raise exception 'service_role_key is not configured';
    end if;
    select net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('recipient_id', o.recipient_id, 'title', o.title, 'body', o.body, 'data', o.data)
    ) into v_req;
    update push_outbox set status = 'queued', net_request_id = v_req, attempts = attempts + 1, last_error = null,
                           updated_at = now()
    where id = o.id;
    return 'queued';
  exception when others then
    update push_outbox set status = 'retry', attempts = attempts + 1, last_error = left(sqlerrm, 500),
                           next_attempt_at = now() + make_interval(mins => least(5 * (attempts + 1), 20)), updated_at = now()
    where id = o.id;
    return 'retry';
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._on_business_offer_sent(e domain_events)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_requester uuid;
  v_title text;
  v_body text;
  v_label text;
  v_profile uuid;
  v_summary text;
begin
  select * into o from business_request_offers where id = e.object_id;
  if not found then return; end if;

  if e.source in ('submit_business_offer', 'admin_review_business_content_screening') then
    select requester_id into v_requester from business_requests where id = o.request_id;
    select p.title, p.body into v_title, v_body from public._business_reply_push(o.id) p;
    perform public._notify_event_recipient(e.id, v_requester,
      coalesce((select notify_business from profiles where id = v_requester), true),
      v_title, v_body,
      jsonb_build_object('type', 'business_offer_received', 'request_id', o.request_id, 'offer_id', o.id,
                         'collapse_key', 'offers:' || o.request_id));
    return;
  end if;

  v_summary := public.business_safe_request_summary(o.request_id);
  if e.source = 'match_availability' then
    select title into v_label from business_availability where id = (e.payload->>'availability_id')::uuid;
    v_title := 'Your availability was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_package' then
    select name into v_label from business_occasion_packages where id = (e.payload->>'package_id')::uuid;
    v_title := 'Your occasion package was just matched!';
    v_body := '"' || v_label || '" matches a new request: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'match_policy' then
    v_title := 'Auto-accepted a new request!';
    v_body := 'Your fulfillment policy auto-accepted: ' || coalesce(v_summary, 'a new request');
  elsif e.source = 'ai_auto_respond' then
    select name into v_label from business_ai_policies where id = (e.payload->>'policy_id')::uuid;
    v_title := 'Your AI Automation auto-responded!';
    v_body := 'Policy "' || v_label || '" auto-sent an offer for: ' || v_summary;
  else
    return;
  end if;

  for v_profile in select id from profiles where managed_partner_id = o.partner_id loop
    perform public._notify_event_recipient(e.id, v_profile,
      -- the package match never honored the business mute (pre-item-125 behavior, kept exactly)
      true,
      v_title, v_body,
      jsonb_build_object('type', 'business_opportunity_received', 'request_id', o.request_id));
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision DEFAULT 15, bundle_occasion_param text DEFAULT NULL::text, bundle_components_param text[] DEFAULT NULL::text[], discount_pct_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_matched_people uuid[] := array[]::uuid[];
  v_req record;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
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

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;
  if _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param) is not null then
    raise exception '%', _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param);
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
  -- 20270227: each part must belong to this occasion's bundle (Family Fun only with Family Gathering). A validation error.
  if public._bundle_component_problem(bundle_occasion_param, v_bundle_components) is not null then
    raise exception '%', public._bundle_component_problem(bundle_occasion_param, v_bundle_components);
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components, discount_pct
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components, discount_pct_param
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
      if not (v_req.requester_id = any(v_matched_people)) then v_matched_people := array_append(v_matched_people, v_req.requester_id); end if;

      if coalesce((select notify_business from profiles where id = v_req.requester_id), true) then
        select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_req.id);

        if v_occ_type is not null then
          v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
          v_push_body := trim(title_param) || ' just became available for your ' || lower(_occasion_noun(v_occ_type)) || ' request'
            || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
        else
          v_push_title := 'New offer for your request!';
          v_push_body := trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"';
        end if;

        perform public._send_push(v_req.requester_id, v_push_title, v_push_body, jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id, 'collapse_key', 'offers:' || v_req.id));
      end if;
    end if;
  end loop;

  -- Privacy floor: how many requests matched is a demand figure about unconnected people, so it is returned only when
  -- >= demand_min_people() DISTINCT people are behind it (else null). The offers themselves are sent regardless.
  return jsonb_build_object(
    'availabilityId', v_availability_id,
    'matchedCount', case when coalesce(array_length(v_matched_people, 1), 0) >= public.demand_min_people() then v_matched_count end
  );
end;
$function$;

