-- Item 63 follow-up (owner, 2026-10-12, option 1): mark the two automatic writers' replies so the customer's ranking
-- (src/utils/replyFit.js) can tell them apart from a business's own "Yes, you can host them as requested".
--   'policy' = _match_request_to_policy_core (standing party-size auto-accept)
--   'ai'     = _ai_auto_respond_to_business_requests (AI auto-respond)
-- Neither checks a single requested time against the business's availability (a request stores one start, no end, so
-- their hours-overlap checks are skipped, and unknown operating hours count as open), so the client treats a marked reply as
-- UNKNOWN for a stated time: it stays listed, it just cannot qualify on time or be "Our pick" on that basis.
-- Null = every other reply (unchanged). Only these two functions write it; customers and businesses have no write path to
-- business_request_offers (SELECT-only RLS). A marked row never returns to 'pending' (reopen_business_request re-pends only
-- rows with responded_at null; both writers set responded_at), so the marker cannot outlive the reply it describes.
-- Only the two INSERT ... ON CONFLICT statements change; everything else in both functions is the live definition verbatim.

alter table public.business_request_offers add column if not exists auto_reply text;
alter table public.business_request_offers drop constraint if exists business_request_offers_auto_reply_check;
alter table public.business_request_offers add constraint business_request_offers_auto_reply_check
  check (auto_reply is null or auto_reply in ('policy', 'ai'));
comment on column public.business_request_offers.auto_reply is
  'Item 63: which automatic writer made this reply (policy | ai); null = any other reply. A marked reply has not verified a stated time.';

CREATE OR REPLACE FUNCTION public._match_request_to_policy_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
      and not public._business_closed_for_request(p.id, request_id_param)
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at, auto_reply)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now(), 'policy'
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now(),
          auto_reply = excluded.auto_reply
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_policy',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      when public._business_closed_for_request(bfp.partner_id, request_id_param) then 'hours_mismatch'  -- item 116: known closed then
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and not public._business_closed_for_request(bfp.partner_id, request_id_param)
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public._ai_auto_respond_to_business_requests(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_exp record;
  v_reason text;
  v_offer_price numeric;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bap.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name, p.ai_trust_level
    from business_ai_policies bap
    join brand_partners p on p.id = bap.partner_id and p.active = true
    left join reputation r on r.partner_id = bap.partner_id
    where bap.enabled = true
    and bap.action_type = 'auto_respond_offer'
    and p.ai_trust_level >= 2
    and bap.trust_level <= p.ai_trust_level
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bap.created_at desc
  loop
    v_reason := null;
    v_exp := null;

    if category_param is null or (v_policy.conditions ->> 'category') is distinct from category_param then
      v_reason := 'category_mismatch';
    elsif party_size_param is not null and v_policy.conditions ? 'party_size_max'
          and party_size_param > (v_policy.conditions ->> 'party_size_max')::integer then
      v_reason := 'party_size_out_of_range';
    elsif v_policy.conditions ? 'hours_start' and v_policy.conditions ? 'hours_end'
          and time_window_start_param is not null and time_window_end_param is not null
          and not ((time_window_start_param, time_window_end_param) overlaps
                    ((v_policy.conditions ->> 'hours_start')::time, (v_policy.conditions ->> 'hours_end')::time)) then
      v_reason := 'hours_mismatch';
    else
      select * into v_exp from business_experiences
      where id = (v_policy.conditions ->> 'experience_id')::uuid
      and partner_id = v_policy.partner_id and active = true;

      if v_exp.id is null then
        v_reason := 'experience_inactive';
      end if;
    end if;

    if v_reason is not null then
      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, requires_approval, approval_result, outcome
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('policy_name', v_policy.name),
        false, 'blocked', v_reason
      )
      on conflict (policy_id, (input_ref ->> 'request_id')) where approval_result = 'blocked' do nothing;
      continue;
    end if;

    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    v_offer_price := case v_exp.price_level
      when '$' then 15 when '$$' then 35 when '$$$' then 65 else null
    end;

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at, auto_reply
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now(), 'ai'
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now(), auto_reply = excluded.auto_reply
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      insert into ai_actions (
        partner_id, action_type, trust_level, risk_level, policy_id, input_ref,
        proposed_action, actual_action, confidence, requires_approval, approval_result
      ) values (
        v_policy.partner_id, 'auto_respond_offer', v_policy.ai_trust_level, 'medium', v_policy.id,
        jsonb_build_object('request_id', request_id_param, 'category', category_param, 'party_size', party_size_param),
        jsonb_build_object('experience_id', v_exp.id, 'experience_title', v_exp.title, 'price_level', v_exp.price_level),
        jsonb_build_object('offer_type', 'standard', 'offer_price', v_offer_price),
        null, false, 'auto_applied'
      );

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'ai_auto_respond',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_policy.partner_id, 'policy_id', v_policy.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_policy.partner_id));
    end if;
  end loop;

  return v_new_count;
end;
$function$;

revoke all on function public._match_request_to_policy_core(uuid, double precision, double precision, double precision, integer, time without time zone, time without time zone) from public, anon, authenticated;
revoke all on function public._ai_auto_respond_to_business_requests(uuid, double precision, double precision, double precision, text, integer, time without time zone, time without time zone) from public, anon, authenticated;
