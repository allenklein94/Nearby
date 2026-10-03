-- Owner item 156, Gap 2 (2026-10-03, LOCKED): learn from a server-confirmed redemption.
-- A redemption (business_request_offers.status -> 'completed', confirmed by the 6-digit code or the business) is stronger
-- evidence than an accept, but it is the SAME transaction, so it must never count twice:
--   * the person already has an 'accept' row for that request (item 95) -> that row is CONFIRMED in place
--     (redeemed_at = now()); its weight stays 3 and its 90-day window now runs from the confirmation;
--   * no accept row (the fire-and-forget accept never landed, aged out, or was forgotten) -> one 'redeem' row, weight 3.
--   * an accept recorded AFTER a redemption, or a second accept for the same request, adds nothing.
-- Category = the request's own category, only a real consumer tag. No amount, spend or "loved it" signal is learned.
-- Same privacy as every behavior row: owner-only, 90 days, Forget (by category) / Clear history / account cascade remove it,
-- never read by a business, never written to profiles.interests. Clients cannot record 'redeem' (record_behavior_event
-- still refuses it); only this trigger writes it. A failure here never blocks the redemption itself.

alter table public.behavior_events add column if not exists redeemed_at timestamptz;

alter table public.behavior_events drop constraint if exists behavior_events_event_type_check;
alter table public.behavior_events add constraint behavior_events_event_type_check
  check (event_type in ('open', 'create', 'join', 'search', 'accept', 'redeem'));
alter table public.behavior_events drop constraint if exists behavior_events_redeem_shape;
alter table public.behavior_events add constraint behavior_events_redeem_shape
  check ((event_type <> 'redeem' or (entity_type = 'business_request' and redeemed_at is not null))
         and (redeemed_at is null or event_type in ('accept', 'redeem')));

-- Weights unchanged (open/search 1, everything else 3, cap 12); the window counts from the latest evidence on the row.
create or replace function public.get_my_behavior_categories(days_back_param integer default 90)
returns table(category text, weight integer)
language sql security definer stable set search_path to 'public' as $function$
  select be.category,
         least(12, sum(case when be.event_type in ('open', 'search') then 1 else 3 end))::integer
  from behavior_events be
  where be.user_id = auth.uid()
    and coalesce(be.redeemed_at, be.created_at) >= now() - make_interval(days => least(coalesce(days_back_param, 90), 90))
  group by be.category
  order by 2 desc;
$function$;
revoke all on function public.get_my_behavior_categories(integer) from public, anon;

-- Patched from the live body (20270255): the accept guard and the purge window are the only changes.
create or replace function public.record_behavior_event(event_type_param text, entity_type_param text, entity_id_param uuid, category_param text,
  origin_lat_param double precision default null, origin_lng_param double precision default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_trip numeric;
begin
  if auth.uid() is null or category_param is null or length(category_param) = 0 or length(category_param) > 60 then return; end if;
  if event_type_param not in ('open', 'create', 'join', 'search', 'accept')
     or entity_type_param not in ('gathering', 'community', 'business_request', 'search')
     or (event_type_param = 'search') <> (entity_type_param = 'search')
     or (entity_type_param = 'search') <> (entity_id_param is null) then
    raise exception 'Invalid behavior event.';
  end if;
  if event_type_param in ('search', 'accept')
     and not exists (select 1 from category_tag_groups where tag = category_param and not coalesce(business_only, false)) then
    return;
  end if;
  if exists (select 1 from behavior_events where user_id = auth.uid() and event_type = event_type_param
             and created_at > now() - interval '1 hour'
             and (case when event_type_param = 'search' then category = category_param else entity_id = entity_id_param end)) then
    return;
  end if;
  -- item 156: one transaction is one piece of evidence. An accept for a request this person already has an accept or a
  -- confirmed redemption for adds nothing.
  if event_type_param = 'accept' and exists (select 1 from behavior_events where user_id = auth.uid()
       and entity_id = entity_id_param and event_type in ('accept', 'redeem')) then
    return;
  end if;
  -- the trip of a real choice: a join measured from where the person was when they chose; an accepted offer from the
  -- request's own location to the business that was chosen. Anything unknown = no trip (the event still counts as before).
  if event_type_param = 'join' and entity_type_param = 'gathering'
     and origin_lat_param between -90 and 90 and origin_lng_param between -180 and 180 then
    select public._trip_miles(origin_lat_param, origin_lng_param, g.precise_lat::double precision, g.precise_lng::double precision)
      into v_trip from gatherings g where g.id = entity_id_param;
  elsif event_type_param = 'accept' and entity_type_param = 'business_request' then
    select public._trip_miles(r.latitude, r.longitude, bp.latitude, bp.longitude)
      into v_trip
      from business_requests r
      join business_request_offers o on o.request_id = r.id and o.status in ('accepted', 'completed')
      join brand_partners bp on bp.id = o.partner_id
     where r.id = entity_id_param and r.requester_id = auth.uid()
     limit 1;
  end if;
  if v_trip is not null and v_trip > 500 then v_trip := null; end if;
  delete from behavior_events where user_id = auth.uid() and coalesce(redeemed_at, created_at) < now() - interval '90 days';
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category, trip_miles)
  values (auth.uid(), event_type_param, entity_type_param, entity_id_param, category_param, v_trip);
end;
$function$;
revoke all on function public.record_behavior_event(text, text, uuid, text, double precision, double precision) from public, anon;
grant execute on function public.record_behavior_event(text, text, uuid, text, double precision, double precision) to authenticated;

-- The one writer of 'redeem': fires only on the real transition into 'completed'.
create or replace function public._learn_from_redemption()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_requester uuid;
  v_category text;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then return new; end if;
  begin
    select r.requester_id, r.category into v_requester, v_category from business_requests r where r.id = new.request_id;
    if v_requester is null or v_category is null
       or not exists (select 1 from category_tag_groups where tag = v_category and not coalesce(business_only, false)) then
      return new;
    end if;
    -- confirm every existing accept for this request (the requester's, and group participants who recorded theirs on it)
    update behavior_events set redeemed_at = now()
     where entity_type = 'business_request' and entity_id = new.request_id
       and event_type = 'accept' and redeemed_at is null;
    -- the requester with no evidence for this request yet gets one row, weight 3
    if not exists (select 1 from behavior_events where user_id = v_requester and entity_id = new.request_id
                   and event_type in ('accept', 'redeem')) then
      insert into behavior_events (user_id, event_type, entity_type, entity_id, category, redeemed_at)
      values (v_requester, 'redeem', 'business_request', new.request_id, v_category, now());
    end if;
  exception when others then
    raise warning 'learn_from_redemption skipped: %', sqlerrm; -- never blocks the redemption
  end;
  return new;
end;
$function$;
revoke all on function public._learn_from_redemption() from public, anon, authenticated;

drop trigger if exists business_request_offers_learn_from_redemption on public.business_request_offers;
create trigger business_request_offers_learn_from_redemption
  after update of status on public.business_request_offers
  for each row execute function public._learn_from_redemption();
