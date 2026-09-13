-- Item 81 ("One Plan can contain multiple businesses" -- CLAUDE.md): the
-- user's own mock is a genuine chronological itinerary -- 6:30 PM Ride,
-- 7:00 PM Dinner, 9:00 PM Live music, 10:30 PM Ride home -- not just the
-- flat, one-slot-per-type readiness rollup Item 80 shipped. Two real gaps
-- against that mock, both closed here without inventing a second
-- business-request system (same discipline as Item 80): (1) nothing
-- carried a specific point-in-time for an engagement, so nothing could be
-- sorted into a real timeline; (2) the "one open add-on per type" guard
-- (Item 80's own accidental-double-tap protection) also, as a side
-- effect, blocked the exact case this mock requires -- a genuine SECOND
-- Transportation add-on (the ride home) alongside the first (the ride
-- there).
--
-- Fix: two small, nullable, purely-descriptive columns on business_
-- requests (never touched by matching/fanout logic, which still only
-- ever reads date/time_window_start/time_window_end/latitude/longitude/
-- etc. exactly as before) --
--   plan_time  (time without time zone) -- when, within the PLAN's own
--     timeline, this specific engagement happens. Deliberately distinct
--     from time_window_start/time_window_end, which stay what they
--     always were: the requester's desired AVAILABILITY window for
--     matching a business. plan_time is a pure display/ordering label
--     the requester sets deliberately (a native time picker -- never
--     AI-inferred, per this repo's own standing "AI never assigns a
--     specific date/time" rule) and can freely edit after the fact via
--     the new set_plan_item_time RPC below, on ANY of their own requests
--     in a plan (the primary included).
--   plan_label (text) -- a short, freely-typed distinguishing label
--     ("Ride home" vs "Ride there") for a timeline entry. Reuses create_
--     plan_addon_request's own pre-existing note_param (already wired at
--     the DB layer since Item 80, but with no UI surface -- Item 80's
--     own disclosed leftover #2) as its source: the same trimmed value
--     that's already appended into raw_text for the business now ALSO
--     lands here verbatim, so the client can render a clean structured
--     label without regex-parsing a sentence back out of raw_text.
--
-- The duplicate-add-on guard is relaxed to match: an OPEN add-on of the
-- same type is only rejected as a duplicate when its plan_time AND
-- plan_label both also match (null-safe via IS NOT DISTINCT FROM) -- an
-- accidental double-tap (same type, no time/label set yet, submitted
-- twice in a row) is still caught; a deliberate second Transportation
-- add-on at a different time is not.
--
-- Also adds a 7th add-on type, 'entertainment' (matches the mock's own
-- "🎵 Live music"), reusing the already-live 'Music' leaf tag under the
-- entertainment_nightlife major -- no new taxonomy value needed, unlike
-- Item 80's three brand-new leaf tags.

alter table business_requests add column plan_time time;
alter table business_requests add column plan_label text;

alter table business_requests drop constraint business_requests_addon_type_check;
alter table business_requests add constraint business_requests_addon_type_check
  check (addon_type is null or addon_type in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift', 'entertainment'));

-- ---------------------------------------------------------------------
-- create_plan_addon_request gains a 4th trailing param (plan_time_param).
-- Per this repo's own standing convention, a new trailing param -- even
-- with a default -- creates a second overload unless the old exact
-- signature is explicitly dropped first.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_plan_addon_request(uuid, text, text);

CREATE FUNCTION public.create_plan_addon_request(
  parent_request_id_param uuid,
  addon_type_param text,
  note_param text DEFAULT NULL,
  plan_time_param time DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent record;
  v_category text;
  v_business_major text;
  v_label text;
  v_plan_label text;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_raw_text text;
  v_existing_open_id uuid;
  v_notified_count integer := 0;
  v_avail_new_count integer := 0;
  v_ai_new_count integer := 0;
begin
  if addon_type_param is null or addon_type_param not in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift', 'entertainment') then
    raise exception 'Invalid add-on type';
  end if;

  select * into v_parent from business_requests
    where id = parent_request_id_param and requester_id = auth.uid()
    for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_parent.parent_request_id is not null then
    raise exception 'Add-ons cannot themselves have add-ons.';
  end if;
  if v_parent.status = 'cancelled' then
    raise exception 'This plan was cancelled -- add-ons cannot be added to a cancelled request.';
  end if;

  v_plan_label := nullif(trim(coalesce(note_param, '')), '');

  select id into v_existing_open_id from business_requests
    where parent_request_id = parent_request_id_param
    and addon_type = addon_type_param
    and status = 'open'
    and plan_time is not distinct from plan_time_param
    and plan_label is not distinct from v_plan_label
    limit 1;
  if v_existing_open_id is not null then
    raise exception 'You already have an open % request for this plan at that time.', addon_type_param;
  end if;

  v_category := case addon_type_param
    when 'dessert' then 'Bakeries'
    when 'flowers' then 'Florist'
    when 'photographer' then 'Photography'
    when 'decorations' then 'Party & Event Decor'
    when 'gift' then 'Gift Shop'
    when 'entertainment' then 'Music'
    else null
  end;
  v_business_major := case addon_type_param
    when 'dessert' then 'food_drink'
    when 'flowers' then 'shopping'
    when 'photographer' then 'arts_culture_learning'
    when 'decorations' then 'shopping'
    when 'gift' then 'shopping'
    when 'entertainment' then 'entertainment_nightlife'
    when 'transportation' then 'auto_transportation'
  end;
  v_label := case addon_type_param
    when 'dessert' then 'Dessert'
    when 'flowers' then 'Flowers'
    when 'photographer' then 'Photographer'
    when 'decorations' then 'Decorations'
    when 'transportation' then 'Transportation'
    when 'gift' then 'Gift'
    when 'entertainment' then 'Entertainment'
  end;

  v_raw_text := v_label || case when v_parent.occasion is not null and v_parent.occasion <> 'other'
    then ' for a ' || replace(v_parent.occasion, '_', ' ') || ' celebration'
    else ' to go with an upcoming plan' end
    || case when v_plan_label is not null then ' — ' || left(v_plan_label, 200) else '' end;

  v_expires_at := coalesce(v_parent.expires_at, now() + interval '48 hours');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start,
    time_window_end, latitude, longitude, radius_miles, expires_at, occasion,
    parent_request_id, addon_type, plan_time, plan_label
  ) values (
    auth.uid(), v_raw_text, v_category, v_parent.party_size, v_parent.date,
    v_parent.time_window_start, v_parent.time_window_end, v_parent.latitude,
    v_parent.longitude, v_parent.radius_miles, v_expires_at, v_parent.occasion,
    parent_request_id_param, addon_type_param, plan_time_param, v_plan_label
  ) returning id into v_request_id;

  select public._business_request_fanout(
    v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles,
    case when v_category is not null then array[v_category] else null end,
    case when v_category is null then v_business_major else null end
  ) into v_notified_count;

  if v_category is not null then
    select public._match_request_to_availability(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.date, v_parent.time_window_start, v_parent.time_window_end, null, v_parent.party_size) into v_avail_new_count;
    select public._ai_auto_respond_to_business_requests(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.party_size, v_parent.time_window_start, v_parent.time_window_end) into v_ai_new_count;
  end if;

  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'addonType', addon_type_param, 'category', v_category, 'notifiedCount', v_notified_count);
end;
$function$;

REVOKE ALL ON FUNCTION public.create_plan_addon_request(uuid, text, text, time) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_plan_addon_request(uuid, text, text, time) TO authenticated;

-- ---------------------------------------------------------------------
-- The one new consumer-facing RPC: freely retime/relabel any of the
-- caller's OWN requests within a plan (primary or add-on) after the
-- fact -- e.g. correcting "6:30 PM" to "7:00 PM," or adding a label to
-- the primary once a business accepts ("Dinner at Restaurant A" is
-- derived client-side from the accepted offer's own real business name,
-- never typed here, but the *time* itself is exactly this RPC's job).
-- Deliberately has no other guard beyond real ownership -- editing a
-- purely descriptive label/time is safe even on a cancelled/expired row
-- (it's just metadata, never re-triggers matching).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_plan_item_time(
  request_id_param uuid,
  plan_time_param time DEFAULT NULL,
  plan_label_param text DEFAULT NULL,
  clear_label boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated record;
begin
  update business_requests
  set
    plan_time = plan_time_param,
    plan_label = case when clear_label then null
      when plan_label_param is not null then nullif(trim(plan_label_param), '')
      else plan_label end
  where id = request_id_param and requester_id = auth.uid()
  returning id, plan_time, plan_label into v_updated;

  if v_updated.id is null then
    raise exception 'Request not found.';
  end if;

  return jsonb_build_object('requestId', v_updated.id, 'planTime', v_updated.plan_time, 'planLabel', v_updated.plan_label);
end;
$function$;

REVOKE ALL ON FUNCTION public.set_plan_item_time(uuid, time, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_plan_item_time(uuid, time, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------
-- get_business_opportunities (Item 69, extended by Item 80): add
-- plan_time/plan_label to the already-fixed jsonb column list -- a
-- business deciding on a Transportation add-on genuinely needs to know
-- WHICH ride this is ("Ride home," 10:30 PM), not just that it's a
-- Transportation request. Same privacy boundary as everything else this
-- function returns -- both are purely descriptive, non-identity fields.
-- Plain CREATE OR REPLACE on an unchanged jsonb-returning signature --
-- no overload risk (RETURNS jsonb, not RETURNS TABLE).
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
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price,
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
