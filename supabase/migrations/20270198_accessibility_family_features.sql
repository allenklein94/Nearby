-- Items 49/50: accessibility and family features as STRUCTURED, declared data (never inferred from a description).
-- (1) Seven new keys join the ONE shared attribute vocabulary (24 -> 31): wheelchair_accessible, accessible_parking,
--     accessible_restroom, service_animal_friendly, stroller_friendly, family_seating, kid_menu. ("Quiet environment" and
--     "kids welcome" are the existing `quiet` and `kid_friendly`.) Same recipe as 20270193: the 6 CHECKs are widened and the 6
--     functions that carry the list are widened in place from their live bodies, guarded to fail loudly.
-- (2) gatherings.features: what a HOST declares about their own gathering, a closed list of 8 (the seven-key family/accessibility
--     set the UI offers). Hosts write their own row through the existing RLS policy; nothing is derived from the category.
-- Age range is intentionally NOT added here (a numeric min/max, not a tag).

do $mig$
declare
  new_list text := $q$'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu'$q$;
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
    v_new := replace(v_def, $q$'reservation_required'$q$, $q$'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu'$q$);
    if v_new = v_def then raise exception 'no attribute list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'expected 6 functions, patched %', n; end if;
end
$mig$;

alter table public.gatherings add column if not exists features text[] not null default '{}';
alter table public.gatherings drop constraint if exists gatherings_features_check;
alter table public.gatherings add constraint gatherings_features_check check (
  features <@ array['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'quiet', 'kid_friendly', 'stroller_friendly', 'family_seating']::text[]
);
