-- "Ask a specific business" on a gathering now reaches that business as an OPPORTUNITY (2026-09-20).
-- Before: request_business_partnership only created a co-host partnership request (shown under Bookings,
-- with the host's name), so the business never got a request in its offer workflow. Now the gathering
-- ALSO gets (or reuses) a structured business_requests row -- independent of the consumer-facing gathering
-- -- and exactly ONE pending business_request_offers row for the named business, flagged is_directed
-- (no fan-out to anyone else). It flows through get_business_opportunities and the normal
-- respond -> offer -> accept workflow. No AI anywhere: category/date/party size come from the gathering,
-- the request text is a fixed generic phrase (never the host's title -- minimum-payload rule).
-- A directed request pings the owner immediately (it is a direct ask, not a broadcast) and is excluded
-- from the hourly digest so it is never announced twice.

alter table public.business_request_offers
  add column if not exists is_directed boolean not null default false;

create or replace function public._route_gathering_to_partner(gathering_id_param uuid, partner_id_param uuid, notify_param boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_g record;
  v_request_id uuid;
  v_party integer;
  v_expires timestamptz;
  v_offer_id uuid;
  v_profile uuid;
  service_key text;
begin
  select id, host_id, scheduled_at, precise_lat, precise_lng, interest_tag into v_g
  from gatherings where id = gathering_id_param;
  if v_g.id is null or v_g.precise_lat is null or v_g.precise_lng is null or v_g.scheduled_at < now() then
    return null;
  end if;
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    return null;
  end if;

  select id into v_request_id from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc limit 1;

  if v_request_id is null then
    select count(*) into v_party from gathering_interest
    where gathering_id = gathering_id_param and status = 'approved';
    v_party := coalesce(v_party, 0) + 1;
    v_expires := least(v_g.scheduled_at, now() + interval '30 days');
    if v_expires < now() + interval '1 hour' then v_expires := now() + interval '1 hour'; end if;
    insert into business_requests (
      requester_id, raw_text, category, party_size, date, latitude, longitude,
      radius_miles, expires_at, gathering_id
    ) values (
      v_g.host_id,
      case when v_g.interest_tag is not null then 'A ' || v_g.interest_tag || ' gathering looking for a place to go'
           else 'A gathering looking for a place to go' end,
      v_g.interest_tag, v_party, v_g.scheduled_at::date, v_g.precise_lat, v_g.precise_lng,
      15, v_expires, gathering_id_param
    ) returning id into v_request_id;
  end if;

  insert into business_request_offers (request_id, partner_id, is_directed)
  values (v_request_id, partner_id_param, true)
  on conflict (request_id, partner_id) do update
    set is_directed = true
    where business_request_offers.is_directed = false and business_request_offers.status = 'pending'
  returning id into v_offer_id;

  if v_offer_id is not null and notify_param then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for v_profile in select id from profiles where managed_partner_id = partner_id_param loop
      continue when not coalesce((select notify_business from profiles where id = v_profile), true);
      continue when service_key is null;
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_profile,
          'title', 'A customer asked for your business',
          'body', 'New request: ' || public.business_safe_request_summary(v_request_id),
          'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', v_request_id)
        )
      );
    end loop;
  end if;

  return v_request_id;
end;
$function$;
revoke all on function public._route_gathering_to_partner(uuid, uuid, boolean) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_business_partnership(target_type_param text, target_id_param uuid, partner_id_param uuid, message_param text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
  v_owns_target boolean;
begin
  if target_type_param not in ('gathering', 'community') then
    raise exception 'Invalid target type';
  end if;

  if target_type_param = 'gathering' then
    select exists(select 1 from gatherings where id = target_id_param and host_id = auth.uid()) into v_owns_target;
  else
    select exists(select 1 from community_members where community_id = target_id_param and user_id = auth.uid() and role in ('creator', 'leader')) into v_owns_target;
  end if;

  if not v_owns_target then
    raise exception 'You can only request a business partner for a gathering you host or a community you lead';
  end if;

  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;

  insert into business_partnership_requests (requester_id, target_type, target_id, partner_id, message)
  values (auth.uid(), target_type_param, target_id_param, partner_id_param, nullif(trim(coalesce(message_param, '')), ''))
  on conflict (target_type, target_id, partner_id) where status = 'pending' do nothing
  returning id into v_request_id;

  if v_request_id is null then
    raise exception 'A request for this business is already pending';
  end if;

  -- The host asked a SPECIFIC business: that business also gets a real opportunity in its
  -- normal offer workflow (20270127). Best effort -- the partnership request stands either way.
  if target_type_param = 'gathering' then
    begin
      perform public._route_gathering_to_partner(target_id_param, partner_id_param, true);
    exception when others then
      raise warning 'directed gathering request routing failed: %', sqlerrm;
    end;
  end if;

  return v_request_id;
end;
$function$;

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
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
      jsonb_build_object(
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', public.business_safe_request_summary(br.id),
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
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

CREATE OR REPLACE FUNCTION public.send_business_opportunity_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_since timestamptz;
  v_count integer;
  v_sent integer := 0;
  service_key text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is null then
    return 0;
  end if;

  for v_row in
    select p.id as user_id, p.managed_partner_id as partner_id, s.last_digest_at
    from profiles p
    left join business_opportunity_digest_state s on s.user_id = p.id
    where p.managed_partner_id is not null
      and coalesce(p.notify_business, true)
      and (s.last_digest_at is null or s.last_digest_at <= now() - interval '6 hours')
  loop
    v_since := coalesce(v_row.last_digest_at, now() - interval '1 day');
    select count(*) into v_count
    from business_request_offers o
    join business_requests r on r.id = o.request_id
    where o.partner_id = v_row.partner_id
      and o.status = 'pending'
      and o.viewed_at is null
      and o.created_at > v_since
      and r.status = 'open'
      and r.expires_at > now()
      and not public._opportunity_is_urgent(r.id)
      and not o.is_directed;
    continue when v_count = 0;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_row.user_id,
        'title', v_count || ' new ' || case when v_count = 1 then 'opportunity' else 'opportunities' end || ' that fit your business',
        'body', 'Nearby matched them for you. Open to view and reply.',
        'data', jsonb_build_object('type', 'business_opportunities_digest', 'count', v_count)
      )
    );
    insert into business_opportunity_digest_state (user_id, last_digest_at) values (v_row.user_id, now())
    on conflict (user_id) do update set last_digest_at = excluded.last_digest_at;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$function$;

revoke all on function public.request_business_partnership(text, uuid, uuid, text) from public, anon;
grant execute on function public.request_business_partnership(text, uuid, uuid, text) to authenticated;
revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;

-- Backfill: pending "specific business" asks on still-upcoming gatherings (no push: these are stale asks).
do $backfill$
declare r record;
begin
  for r in select target_id, partner_id from business_partnership_requests
           where status = 'pending' and target_type = 'gathering' loop
    begin
      perform public._route_gathering_to_partner(r.target_id, r.partner_id, false);
    exception when others then
      raise warning 'backfill skipped: %', sqlerrm;
    end;
  end loop;
end
$backfill$;
