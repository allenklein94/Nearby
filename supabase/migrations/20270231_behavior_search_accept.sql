-- Interests evolve from behavior, owner item 95. Two more private behavior signals feed the existing ranking-only
-- affinity (behavior_events, 20261215): a SEARCH whose words name a canonical category, and an ACCEPTED business offer
-- (the request's own category). Same privacy as before: owner-only, 90 days, never read by another user or a business,
-- and it NEVER edits profiles.interests (a person adds a learned interest only by their own tap in Settings).
-- Weights: open / search = 1 (a glance), create / join / accept = 3 (a deliberate act); still capped at 12 per category.
-- Also: forget one category (the transparency list in Settings), alongside the existing clear-all.

alter table public.behavior_events drop constraint if exists behavior_events_event_type_check;
alter table public.behavior_events add constraint behavior_events_event_type_check
  check (event_type in ('open', 'create', 'join', 'search', 'accept'));
alter table public.behavior_events drop constraint if exists behavior_events_entity_type_check;
alter table public.behavior_events add constraint behavior_events_entity_type_check
  check (entity_type in ('gathering', 'community', 'business_request', 'search'));
-- A search has no entity; everything else still needs one.
alter table public.behavior_events alter column entity_id drop not null;
alter table public.behavior_events drop constraint if exists behavior_events_entity_required;
alter table public.behavior_events add constraint behavior_events_entity_required
  check ((entity_type = 'search') = (entity_id is null));
alter table public.behavior_events drop constraint if exists behavior_events_search_shape;
alter table public.behavior_events add constraint behavior_events_search_shape
  check ((event_type = 'search') = (entity_type = 'search'));

create or replace function public.record_behavior_event(event_type_param text, entity_type_param text, entity_id_param uuid, category_param text)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or category_param is null or length(category_param) = 0 or length(category_param) > 60 then return; end if;
  if event_type_param not in ('open', 'create', 'join', 'search', 'accept')
     or entity_type_param not in ('gathering', 'community', 'business_request', 'search')
     or (event_type_param = 'search') <> (entity_type_param = 'search')
     or (entity_type_param = 'search') <> (entity_id_param is null) then
    raise exception 'Invalid behavior event.';
  end if;
  -- The two new signals learn only real consumer categories (a search's words are never stored, only the category they
  -- named). open/create/join keep their original behavior.
  if event_type_param in ('search', 'accept')
     and not exists (select 1 from category_tag_groups where tag = category_param and not coalesce(business_only, false)) then
    return;
  end if;
  -- One event per user+type+entity per hour (a search: per category per hour): repetition within the hour is not a
  -- stronger preference.
  if exists (select 1 from behavior_events where user_id = auth.uid() and event_type = event_type_param
             and created_at > now() - interval '1 hour'
             and (case when event_type_param = 'search' then category = category_param else entity_id = entity_id_param end)) then
    return;
  end if;
  delete from behavior_events where user_id = auth.uid() and created_at < now() - interval '90 days';
  insert into behavior_events (user_id, event_type, entity_type, entity_id, category)
  values (auth.uid(), event_type_param, entity_type_param, entity_id_param, category_param);
end;
$function$;
revoke all on function public.record_behavior_event(text, text, uuid, text) from public, anon;

create or replace function public.get_my_behavior_categories(days_back_param integer default 90)
returns table(category text, weight integer)
language sql security definer stable set search_path to 'public' as $function$
  select be.category,
         least(12, sum(case when be.event_type in ('open', 'search') then 1 else 3 end))::integer
  from behavior_events be
  where be.user_id = auth.uid() and be.created_at >= now() - make_interval(days => least(coalesce(days_back_param, 90), 90))
  group by be.category
  order by 2 desc;
$function$;
revoke all on function public.get_my_behavior_categories(integer) from public, anon;

create or replace function public.forget_my_behavior_category(category_param text)
returns void language sql security definer set search_path to 'public' as $function$
  delete from behavior_events where user_id = auth.uid() and category = category_param;
$function$;
revoke all on function public.forget_my_behavior_category(text) from public, anon;
grant execute on function public.forget_my_behavior_category(text) to authenticated;
