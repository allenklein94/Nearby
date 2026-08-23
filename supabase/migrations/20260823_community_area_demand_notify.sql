-- Community demand-generation -- the deliberately-deferred other half of the
-- Community Area work (Aug 17 2026): "communities becoming a real Tier 2
-- supply source for aggregated-demand notifications... a natural next step
-- once Area exists." Mirrors notify_aggregated_demand_threshold()'s own
-- shape exactly (real haversine radius, fire-once-on-crossing-2, a push to
-- the people who'd actually act on it) -- just scoped to a community's own
-- coarse Area point + interest_tag instead of a business's exact location.
--
-- Radius is a fixed 15 miles (AskBusinessScreen's own default request
-- radius, reused rather than inventing a new number) -- communities have no
-- per-request radius of their own to read, and Area is deliberately coarse
-- to begin with.
--
-- Notifies the community's own creator + any leaders (community_members.role
-- in ('creator','leader')) -- never exposed publicly, never a new stranger-
-- discovery surface. A community with no Area set is simply never matched,
-- same "no Area set -> excluded, never penalized" rule the intent resolver's
-- own Community Area scoring already established.
create or replace function notify_community_area_demand_threshold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_key text;
  v_community record;
  v_prior_count integer;
  v_leader_ids uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_community in
    select c.id, c.name, c.area_lat, c.area_lng
    from communities c
    where c.interest_tag = new.category
    and c.area_lat is not null
    and c.area_lng is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(c.area_lat)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(c.area_lng)) +
        sin(radians(c.area_lat)) * sin(radians(new.latitude))
      ))
    )) <= 15
  loop
    -- Real count of other open requests near this community's own Area
    -- point in the same category -- same "count everything real within
    -- reach" shape the business-side trigger already uses.
    select count(*) into v_prior_count
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_community.area_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_community.area_lng)) +
          sin(radians(v_community.area_lat)) * sin(radians(br.latitude))
        ))
      )) <= 15;

    -- Same crossing-point-only rule as the business/group-intent triggers --
    -- fires once when real nearby demand for this category first reaches 2,
    -- never again for the 3rd/4th/etc. request.
    if v_prior_count = 1 then
      select array_agg(user_id) into v_leader_ids
      from community_members
      where community_id = v_community.id and role in ('creator', 'leader');

      if v_leader_ids is not null then
        for i in 1 .. array_length(v_leader_ids, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_leader_ids[i],
              'title', 'Growing demand near your community',
              'body', '2 or more people are now looking for ' || new.category || ' near ' || v_community.name || '.',
              'data', jsonb_build_object('type', 'community_area_demand_growing', 'community_id', v_community.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function notify_community_area_demand_threshold() from public, anon, authenticated;

create trigger business_requests_community_area_demand_notify
  after insert on business_requests
  for each row execute function notify_community_area_demand_threshold();
