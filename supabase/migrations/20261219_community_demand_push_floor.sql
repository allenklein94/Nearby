-- Community leaders' "Growing demand near your community" push now honors the same shared floor
-- (demand_min_people() = 5, distinct people) as the business-facing demand aggregates (20261218).

create or replace function public.notify_community_area_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_community record;
  v_prior_count integer;
  v_requester_counted boolean;
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
    -- Distinct PEOPLE excluding the inserted row; fires only when this request brings the count to the shared
    -- privacy floor (demand_min_people()).
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
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
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(user_id) into v_leader_ids
      from community_members
      where community_id = v_community.id and role in ('creator', 'leader');

      if v_leader_ids is not null then
        for i in 1 .. array_length(v_leader_ids, 1) loop
          continue when not coalesce((select notify_community from profiles where id = v_leader_ids[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_leader_ids[i],
              'title', 'Growing demand near your community',
              'body', '5 or more people are now looking for ' || new.category || ' near ' || v_community.name || '.',
              'data', jsonb_build_object('type', 'community_area_demand_growing', 'community_id', v_community.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;
