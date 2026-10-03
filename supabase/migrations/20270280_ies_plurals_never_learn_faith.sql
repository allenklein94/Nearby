-- Item 183 (owner, 2026-10-03, LOCKED): resolver and privacy fixes, not a taxonomy change.
--
-- (1) -ies plurals follow ordinary English, in the ONE plural rule (item 182) and all four copies: a noun whose singular
--     ends in -ie keeps it (movies = movie, patisseries = patisserie, from the one exception list); every other -ies
--     plural becomes -y (charities = charity, galleries = gallery, libraries = library, bakeries = bakery). Singular words
--     are never rewritten ("patisserie" stays "patisserie"). The list is identical to IE_SINGULAR_NOUNS in
--     src/constants/categorySynonyms.js and APPLY_IE_NOUNS in docs/business.html (pluralNormalization.regression.test.js).
--     No stored key changes: no seeded synonym phrase contains an -ies word, and there are 0 dismissals.
--
-- (2) Faith & Spirituality is never learned. An explicit search may resolve to it, but nothing turns that (or a join,
--     a view, a community created or a redemption in that category) into learned affinity: record_behavior_event and the
--     redemption trigger skip it, and get_my_behavior_categories never returns it (defense in depth, so no ranking,
--     "Based on your recent activity" reason or Settings "What Nearby has noticed" row can come from it). A person may
--     still DECLARE it as their own interest; that is their explicit choice, unchanged. 0 such rows existed.

create or replace function public._category_singular(w text)
returns text language sql immutable set search_path = public as $$
  select case
    when char_length(w) > 4 and w ~ 'ies$' then
      case when left(w, -1) = any (array['auntie', 'barbie', 'beanie', 'birdie', 'boogie', 'bookie', 'bootie', 'boulangerie', 'brasserie', 'brownie', 'budgie', 'calorie', 'charcuterie', 'collie', 'cookie', 'coterie', 'cowrie', 'creperie', 'cutie', 'doggie', 'eyrie', 'foodie', 'freebie', 'fromagerie', 'genie', 'goalie', 'goodie', 'hippie', 'hoodie', 'indie', 'junkie', 'kiddie', 'lassie', 'lingerie', 'magpie', 'meanie', 'menagerie', 'movie', 'newbie', 'oldie', 'patisserie', 'pixie', 'prairie', 'quickie', 'reverie', 'rookie', 'roomie', 'rotisserie', 'selfie', 'smoothie', 'sortie', 'specie', 'sweetie', 'talkie', 'techie', 'veggie', 'walkie', 'yorkie', 'zombie']) then left(w, -1) else left(w, -3) || 'y' end
    when char_length(w) > 4 and w ~ '(ss|ch|sh|x)es$' then left(w, -2)
    when char_length(w) > 3 and w ~ '(ss|ch|sh)e$' then left(w, -1)
    when char_length(w) > 4 and w !~ 'ss$' then regexp_replace(w, 's$', '')
    else w
  end
$$;

-- The one list of categories that are never learned from behavior. Identical to NEVER_LEARNED_CATEGORIES in
-- src/services/behaviorSignals.js (test-enforced).
create or replace function public._category_never_learned(c text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(c, '') = any (array['Faith & Spirituality'])
$$;
revoke all on function public._category_never_learned(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_behavior_event(event_type_param text, entity_type_param text, entity_id_param uuid, category_param text, origin_lat_param double precision DEFAULT NULL::double precision, origin_lng_param double precision DEFAULT NULL::double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- item 183: a sensitive category (religion) is never learned, from any kind of event.
  if public._category_never_learned(category_param) then return; end if;
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

CREATE OR REPLACE FUNCTION public._learn_from_redemption()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requester uuid;
  v_category text;
begin
  if new.status <> 'completed' or old.status is not distinct from 'completed' then return new; end if;
  begin
    select r.requester_id, r.category into v_requester, v_category from business_requests r where r.id = new.request_id;
    if v_requester is null or v_category is null or public._category_never_learned(v_category)
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

CREATE OR REPLACE FUNCTION public.get_my_behavior_categories(days_back_param integer DEFAULT 90)
 RETURNS TABLE(category text, weight integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select be.category,
         least(12, sum(case when be.event_type in ('open', 'search') then 1 else 3 end))::integer
  from behavior_events be
  where be.user_id = auth.uid()
    and not public._category_never_learned(be.category)
    and coalesce(be.redeemed_at, be.created_at) >= now() - make_interval(days => least(coalesce(days_back_param, 90), 90))
  group by be.category
  having count(distinct coalesce(be.entity_id::text, 'search:' || be.id::text)) >= public.behavior_min_evidence()
  order by 2 desc;
$function$;
revoke all on function public.get_my_behavior_categories(integer) from public, anon;
grant execute on function public.get_my_behavior_categories(integer) to authenticated;

delete from public.behavior_events where category = 'Faith & Spirituality';
