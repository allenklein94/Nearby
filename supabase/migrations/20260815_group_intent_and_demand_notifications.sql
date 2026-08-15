-- Nearby 2.0 vision, partial build continuation (see CLAUDE.md's "Nearby
-- 2.0 partial build" plan section for the full reasoning). The previous
-- migration (20260815_group_intent_and_aggregated_demand.sql) built two
-- real, resolve-time/dashboard-time RPCs for layers 3 and 1. This closes
-- the "proactive surface (a Home card / notification)" half of layer 3's
-- own description, and the "presented to businesses... rather than each
-- request being left to expire independently" framing of layer 1 -- both
-- via a real push the moment a real, meaningful threshold is genuinely
-- crossed, not on every subsequent insert (which would nag).
--
-- Both triggers fire on business_requests INSERT and compute the SAME
-- real "did this new row make a real count go from 1 to 2" crossing
-- check the two RPCs already expose read-only -- this is the write-side,
-- notification-triggering counterpart, using the identical connected-set
-- and haversine definitions already established in the prior migration
-- and in _business_request_fanout()/get_aggregated_demand_for_partner(),
-- not a new definition of either.

create or replace function public.notify_group_intent_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_connected_user record;
  v_prior_count integer;
begin
  if new.status <> 'open' or new.category is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_connected_user in
    select case when f.user_a = new.requester_id then f.user_b else f.user_a end as user_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = new.requester_id or f.user_b = new.requester_id)
    union
    select case when m.user_a = new.requester_id then m.user_b else m.user_a end as user_id
    from matches m
    where m.user_a = new.requester_id or m.user_b = new.requester_id
  loop
    -- How many of THIS connected user's own connections already have a
    -- real open request in this category, not counting the new row?
    -- Mirrors get_my_group_intent_signals()'s own connected-set + real
    -- open/expiry/category filters exactly.
    select count(distinct br.requester_id) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.requester_id <> v_connected_user.user_id
      and (
        exists (
          select 1 from friendships f2
          where f2.status = 'accepted'
          and ((f2.user_a = v_connected_user.user_id and f2.user_b = br.requester_id)
            or (f2.user_a = br.requester_id and f2.user_b = v_connected_user.user_id))
        )
        or exists (
          select 1 from matches m2
          where (m2.user_a = v_connected_user.user_id and m2.user_b = br.requester_id)
            or (m2.user_a = br.requester_id and m2.user_b = v_connected_user.user_id)
        )
      );

    -- Fire exactly once, at the real 1 -> 2 crossing -- never again for
    -- the 3rd/4th/etc. request in the same category, so this can't nag.
    if v_prior_count = 1 then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
        body := jsonb_build_object(
          'recipient_id', v_connected_user.user_id,
          'title', 'A few people you know want this too',
          'body', '2 or more people you''re connected to are looking for ' || new.category || ' right now.',
          'data', jsonb_build_object('type', 'group_intent_signal', 'category', new.category)
        )
      );
    end if;
  end loop;

  return new;
end;
$function$;

-- Pure internal trigger function, no legitimate direct caller -- same
-- "revoke from public, anon, authenticated" posture as
-- _business_request_fanout() (it only ever runs in trigger context).
revoke all on function public.notify_group_intent_threshold() from public, anon, authenticated;

drop trigger if exists business_requests_group_intent_notify on public.business_requests;
create trigger business_requests_group_intent_notify
after insert on public.business_requests
for each row execute function public.notify_group_intent_threshold();

create or replace function public.notify_aggregated_demand_threshold()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_service_key text;
  v_partner record;
  v_prior_count integer;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner in the same
    -- category, mirroring get_aggregated_demand_for_partner()'s own
    -- "within the requester's own radius_miles of the business" rule.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as the group-intent trigger above --
    -- fires once when real nearby demand for this category first reaches
    -- 2, never again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Growing demand nearby',
              'body', '2 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.',
              'data', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.notify_aggregated_demand_threshold() from public, anon, authenticated;

drop trigger if exists business_requests_aggregated_demand_notify on public.business_requests;
create trigger business_requests_aggregated_demand_notify
after insert on public.business_requests
for each row execute function public.notify_aggregated_demand_threshold();
