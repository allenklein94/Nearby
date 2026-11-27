-- Gathering cuisine (owner, 2026-11-27, device findings item 7 follow-up): cuisine is an optional structured fact of a
-- gathering, separate from its activity ("Dinner", gatherings.activity), category (interest_tag) and editable title.
-- "Italian dinner tomorrow for four" = activity Dinner, cuisine italian.
--   * gatherings.cuisine: nullable, the same closed vocabulary business_requests / brand_partners use (20270214); only for a
--     food category (the taxonomy's cuisine parents, = CUISINE_PARENT_TAGS in src/constants/categoryTree.js). A category
--     change to a non-food tag clears it (never refused, so builds <= 88, which never send it, keep working).
--   * readable like every other public gathering column (the column allowlist, item 146 convention). INSERT/UPDATE for
--     authenticated are table-level already, so the host can set and edit it; existing row policies decide whose row.
--   * a request made from a gathering (create_business_request_for_gathering, unchanged) inherits the gathering's cuisine
--     when it carries none: a BEFORE INSERT trigger on business_requests, so routing (_business_request_fanout's cuisine
--     overlap = ranking only, never eligibility) and the business's Opportunity card (get_business_opportunities) see it.
--     A request's own cuisine always wins; a request aimed at a non-food category never gets one.
-- Existing rows: none changed (no backfill; every gathering stays NULL). No push, no client function.
-- Compatibility: builds <= 88 never select or write the column (it is not in their select lists), so they are unchanged.
-- release-gate: none (no build needs it; the new build falls back when the column is missing: services/gatherings.js).

alter table public.gatherings add column if not exists cuisine text;

alter table public.gatherings drop constraint if exists gatherings_cuisine_check;
alter table public.gatherings add constraint gatherings_cuisine_check check (
  cuisine is null or cuisine = any (array['italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean',
    'indian', 'thai', 'seafood', 'bbq', 'korean', 'vietnamese', 'greek', 'other']::text[])
);

create or replace function private._is_cuisine_parent_tag(tag text)
returns boolean language sql immutable set search_path = '' as $$
  select tag = any (array['Restaurants', 'Fine Dining', 'Fast Casual', 'Food Trucks', 'Takeout & Delivery', 'Family Dining', 'Foodie']::text[]);
$$;
revoke all on function private._is_cuisine_parent_tag(text) from public, anon, authenticated;

-- A cuisine only on a food gathering: cleared (never refused) when the category isn't a cuisine parent.
-- security definer: fired by the host's own insert/update, it reads only private._is_cuisine_parent_tag (clients have no
-- usage on the private schema) and touches nothing but NEW.
create or replace function private.gathering_cuisine_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cuisine is not null and not private._is_cuisine_parent_tag(new.interest_tag) then
    new.cuisine := null;
  end if;
  return new;
end $$;
revoke all on function private.gathering_cuisine_guard() from public, anon, authenticated;

drop trigger if exists gathering_cuisine_guard on public.gatherings;
create trigger gathering_cuisine_guard
  before insert or update of cuisine, interest_tag on public.gatherings
  for each row execute function private.gathering_cuisine_guard();

grant select (cuisine) on public.gatherings to anon, authenticated;

-- A request made from a gathering inherits its cuisine (only when the request names none and its category is food).
create or replace function private.business_request_inherit_gathering_cuisine()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only a food gathering can hold a cuisine (gathering_cuisine_guard), so its cuisine is copied when the request names no
  -- category (the app may send none) or a food one; a request the person aimed at a non-food category never gets one.
  if new.gathering_id is not null and new.cuisine is null and (new.category is null or private._is_cuisine_parent_tag(new.category)) then
    select g.cuisine into new.cuisine from public.gatherings g where g.id = new.gathering_id;
  end if;
  return new;
end $$;
revoke all on function private.business_request_inherit_gathering_cuisine() from public, anon, authenticated;

drop trigger if exists business_request_inherit_gathering_cuisine on public.business_requests;
create trigger business_request_inherit_gathering_cuisine
  before insert on public.business_requests
  for each row execute function private.business_request_inherit_gathering_cuisine();
