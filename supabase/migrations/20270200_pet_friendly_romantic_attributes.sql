-- Items 51/52: "Pet-friendly" (pets welcome, beyond dogs) and "Romantic" as their own attributes in the ONE shared vocabulary
-- (31 -> 33). dog_friendly stays (dogs specifically); date_friendly stays (a good fit for a date); romantic is the atmosphere.
-- Same recipe as 20270198: 6 CHECKs widened, 6 functions widened in place from their live bodies, guarded to fail loudly.
-- Declared by the business, never inferred. Both are ordinary personal "vibes" too (not business-only).

do $mig$
declare
  new_list text := $q$'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu', 'pet_friendly', 'romantic'$q$;
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
    v_new := replace(v_def, $q$'kid_menu'$q$, $q$'kid_menu', 'pet_friendly', 'romantic'$q$);
    if v_new = v_def then raise exception 'no attribute list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'expected 6 functions, patched %', n; end if;
end
$mig$;

