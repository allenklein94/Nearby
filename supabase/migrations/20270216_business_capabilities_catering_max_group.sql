-- Item 80 (owner, LOCKED 2026-09-26): business CAPABILITIES are a named view over the ONE shared attribute vocabulary
-- (private_dining = Private events, group_friendly = Groups, outdoor_seating = Outdoor dining, catering = Catering); reservations
-- stay the booking mode (item 72). Delivery and Takeout are deliberately NOT added anywhere (outside the Nearby loop).
--
-- 1. `catering` joins the vocabulary (33 -> 34): the six CHECKs and the six validating functions are widened in place from
--    their live bodies (same recipe as 20270200), guarded to fail loudly.
-- 2. `brand_partners.max_group_size`: the largest group the business can host, TOTAL people (the canonical capacity
--    semantics), owner-declared via set_business_max_group_size, NULL = not said, never guessed.
-- 3. `_business_request_fanout`: a business whose KNOWN max is below the request's party size is ordered last (strongly
--    de-prioritized, not filtered); one whose known max covers it goes ahead of unknowns after the occasion/tag keys. Unknown on
--    either side = neutral. The number is never put in any business-facing payload.

do $mig$
declare
  new_list text := $q$'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu', 'pet_friendly', 'romantic', 'catering'$q$;
begin
  execute 'alter table public.brand_partners drop constraint if exists brand_partners_attributes_check';
  execute 'alter table public.brand_partners add constraint brand_partners_attributes_check check (attributes <@ array[' || new_list || ']::text[])';
  execute 'alter table public.brand_partners drop constraint if exists brand_partners_priority_attributes_check';
  execute 'alter table public.brand_partners add constraint brand_partners_priority_attributes_check check (priority_attributes <@ array[' || new_list || ']::text[])';
  execute 'alter table public.business_requests drop constraint if exists business_requests_attributes_check';
  execute 'alter table public.business_requests add constraint business_requests_attributes_check check (attributes <@ array[' || new_list || ']::text[])';
  execute 'alter table public.business_partner_requests drop constraint if exists business_partner_requests_attributes_check';
  execute 'alter table public.business_partner_requests add constraint business_partner_requests_attributes_check check (attributes <@ array[' || new_list || ']::text[])';
  execute 'alter table public.business_experiences drop constraint if exists business_experiences_attributes_check';
  execute 'alter table public.business_experiences add constraint business_experiences_attributes_check check (attributes <@ array[' || new_list || ']::text[])';
  execute 'alter table public.profiles drop constraint if exists profiles_venue_preferences_check';
  execute 'alter table public.profiles add constraint profiles_venue_preferences_check check (venue_preferences <@ array[' || new_list || ']::text[])';
end
$mig$;

do $mig$
declare
  v_def text; v_new text; r record; n int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_business_request', 'update_business_profile', 'answer_preference_poll',
                        'set_business_priority_attributes', 'create_business_experience', 'update_business_experience')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $q$'romantic'$q$, $q$'romantic', 'catering'$q$);
    if v_new = v_def then raise exception 'no attribute list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'expected 6 functions, patched %', n; end if;
end
$mig$;

-- 2. Largest group the business can host (total people).
alter table public.brand_partners add column if not exists max_group_size integer;
alter table public.brand_partners drop constraint if exists brand_partners_max_group_size_check;
alter table public.brand_partners add constraint brand_partners_max_group_size_check check (max_group_size is null or max_group_size between 1 and 5000);

create or replace function public.set_business_max_group_size(partner_id_param uuid, max_group_size_param integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    raise exception 'Only the business owner can change this.';
  end if;
  if max_group_size_param is not null and (max_group_size_param < 1 or max_group_size_param > 5000) then
    raise exception 'Enter a group size between 1 and 5000, or leave it blank.';
  end if;
  update brand_partners set max_group_size = max_group_size_param where id = partner_id_param;
end;
$$;
revoke all on function public.set_business_max_group_size(uuid, integer) from public, anon;
grant execute on function public.set_business_max_group_size(uuid, integer) to authenticated;

-- 3. Routing reads it (patched from the live body; guarded).
do $mig$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)'::regprocedure);
  v_new := v_def;
  v_new := replace(v_new, $q$  v_req_group text;
$q$, $q$  v_req_group text;
  v_req_party integer;
$q$);
  v_new := replace(v_new, $q$select raw_text, attributes, cuisine, occasion, category into v_raw_text, v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category from business_requests where id = request_id_param;$q$,
    $q$select raw_text, attributes, cuisine, occasion, category, party_size into v_raw_text, v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category, v_req_party from business_requests where id = request_id_param;$q$);
  v_new := replace(v_new, $q$select p.id, p.attributes, p.cuisine, p.offered_occasions, (3958.8$q$, $q$select p.id, p.attributes, p.cuisine, p.offered_occasions, p.max_group_size, (3958.8$q$);
  v_new := replace(v_new, $q$    order by
      -- a business that explicitly says it offers this occasion is routed the request first$q$, $q$    order by
      -- item 80: a business whose DECLARED largest group is below the party size goes last (strongly de-prioritized, not removed)
      (v_req_party is not null and e.max_group_size is not null and e.max_group_size < v_req_party) asc,
      -- a business that explicitly says it offers this occasion is routed the request first$q$);
  v_new := replace(v_new, $q$      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) desc,
$q$, $q$      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) desc,
      -- item 80: a declared largest group that covers the party goes ahead of an unknown one
      (v_req_party is not null and e.max_group_size is not null and e.max_group_size >= v_req_party) desc,
$q$);
  if (length(v_new) - length(v_def)) < 400 or position('v_req_party integer' in v_new) = 0 or position('p.max_group_size' in v_new) = 0
     or position('e.max_group_size < v_req_party' in v_new) = 0 or position('e.max_group_size >= v_req_party' in v_new) = 0
     or position('party_size into' in v_new) = 0 then
    raise exception '_business_request_fanout patch did not apply cleanly';
  end if;
  execute v_new;
end
$mig$;
revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text) from public, anon, authenticated;
