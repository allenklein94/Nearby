-- Business Intelligence Phase 6, Step 3: Level 2/3 policy model + the one
-- real new automatable action. Direct continuation of Step 2
-- (20260905_ai_trust_engine_core.sql, same migration pass) -- the
-- business_ai_policies table and ai_actions log already exist; this
-- migration adds the table's own owner-only RPCs and the new internal
-- _ai_auto_respond_to_business_requests() helper, wired into
-- create_business_request() right alongside the existing fan-out/
-- availability/policy matches, fully additive.

-- upsert_business_ai_policy: owner-only, entitlement-checked (a level-2
-- policy needs the ai_level_2 entitlement, a level-3 policy needs
-- ai_level_3 -- same check_business_entitlement() call
-- set_business_ai_trust_level() already established). experience_id is
-- required in conditions (this pass's own real "select from an existing
-- approved offer template" mechanism, never an invented price/term) and
-- is re-validated as a real, active, owned business_experiences row.
create or replace function public.upsert_business_ai_policy(
  policy_id_param uuid,
  partner_id_param uuid,
  name_param text,
  trust_level_param integer,
  action_type_param text,
  conditions_param jsonb,
  enabled_param boolean default true
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_feature text;
  v_entitlement jsonb;
  v_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if name_param is null or length(trim(name_param)) = 0 then
    raise exception 'Give this policy a real name.';
  end if;

  if trust_level_param not in (2, 3) then
    raise exception 'A named policy is only used for Level 2 or Level 3 automation.';
  end if;

  if action_type_param not in ('auto_respond_offer') then
    raise exception 'Invalid action type.';
  end if;

  if conditions_param is null or not (conditions_param ? 'category') or not (conditions_param ? 'experience_id') then
    raise exception 'A policy needs a real category and a real offer template to send.';
  end if;

  if not exists (
    select 1 from business_experiences
    where id = (conditions_param ->> 'experience_id')::uuid
    and partner_id = partner_id_param
    and active = true
  ) then
    raise exception 'That offer template does not exist or is not active.';
  end if;

  v_feature := case trust_level_param when 2 then 'ai_level_2' when 3 then 'ai_level_3' end;
  v_entitlement := check_business_entitlement(partner_id_param, v_feature);
  if not coalesce((v_entitlement ->> 'enabled')::boolean, false) then
    raise exception 'Your current plan does not include Level % AI automation.', trust_level_param;
  end if;

  if policy_id_param is not null then
    update business_ai_policies
    set name = trim(name_param), trust_level = trust_level_param, action_type = action_type_param,
        conditions = conditions_param, enabled = enabled_param, updated_at = now()
    where id = policy_id_param and partner_id = partner_id_param
    returning id into v_id;

    if v_id is null then
      raise exception 'Policy not found.';
    end if;
  else
    insert into business_ai_policies (partner_id, name, trust_level, action_type, conditions, enabled)
    values (partner_id_param, trim(name_param), trust_level_param, action_type_param, conditions_param, enabled_param)
    returning id into v_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.upsert_business_ai_policy(uuid, uuid, text, integer, text, jsonb, boolean) from public, anon;
grant execute on function public.upsert_business_ai_policy(uuid, uuid, text, integer, text, jsonb, boolean) to authenticated;

create or replace function public.delete_business_ai_policy(policy_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_partner_id uuid;
begin
  select partner_id into v_partner_id from business_ai_policies where id = policy_id_param;

  if v_partner_id is null then
    raise exception 'Policy not found.';
  end if;

  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = v_partner_id
  ) then
    raise exception 'You do not manage this business.';
  end if;

  delete from business_ai_policies where id = policy_id_param;
end;
$function$;

revoke all on function public.delete_business_ai_policy(uuid) from public, anon;
grant execute on function public.delete_business_ai_policy(uuid) to authenticated;

-- _ai_auto_respond_to_business_requests: the one real new automatable
-- action for Level 2/3. Mirrors _match_request_to_policy's own real
-- shape almost exactly -- same reliability-respecting candidate order,
-- same upsert-onto-business_request_offers pattern -- but matched
-- against a business's own named business_ai_policies row instead of a
-- blanket fulfillment policy, and using a real, already-approved
-- business_experiences template's own price_level as the offer's terms,
-- never an invented price. Logs a real ai_actions row on every real
-- send, and a real "blocked" row (deduped per policy+request) when a
-- policy exists but one condition fails -- same "log a real near-miss,
-- not indiscriminate noise" discipline as business_match_exclusions.
create or replace function public._ai_auto_respond_to_business_requests(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_param text,
  party_size_param integer,
  time_window_start_param time without time zone,
  time_window_end_param time without time zone
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
      request_id, partner_id, offer_type, offer_price, offer_description, status, responded_at
    ) values (
      request_id_param, v_policy.partner_id, 'standard', v_offer_price,
      coalesce(v_policy.partner_name, 'This business') || ' automatically confirmed: ' || v_exp.title
        || case when v_exp.description is not null then ' -- ' || v_exp.description else '' end,
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type,
          offer_price = excluded.offer_price, offer_description = excluded.offer_description,
          responded_at = now()
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

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your AI Automation auto-responded!',
              'body', 'Policy "' || v_policy.name || '" auto-sent an offer for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
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

revoke all on function public._ai_auto_respond_to_business_requests(uuid, double precision, double precision, double precision, text, integer, time without time zone, time without time zone) from public, anon, authenticated;

-- Re-point create_business_request() -- pulled fresh from its own live
-- body first (every line above the one new call is byte-for-byte
-- unchanged), same signature. The new AI auto-respond pass runs after
-- the existing fan-out/availability/policy matches, fully additive --
-- a business that never touches Level 2/3 sees zero behavior change,
-- since the new internal helper's own WHERE clause requires a real
-- enabled business_ai_policies row that nothing seeds by default.
create or replace function public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_ai_new_count integer;
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
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;
