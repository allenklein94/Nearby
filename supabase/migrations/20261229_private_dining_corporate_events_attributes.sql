-- Two new business attributes: private_dining and corporate_events (what a business offers; also what a customer can ask for
-- and what a business can say it wants more of). ONE shared 20-value list everywhere it is enforced.
--
-- This also repairs drift that pre-dated it: business_partner_requests / business_experiences / priority_attributes (and the
-- setters set_business_priority_attributes, create_business_experience, update_business_experience) still allowed only the
-- original 8 values although the app offers all of them, so picking e.g. "Dog-Friendly" under "want more" would have errored.
--
-- Function bodies are widened in place from their live definition (guarded: the migration fails loudly if a body did not
-- contain the expected list, rather than silently doing nothing).

alter table public.brand_partners drop constraint if exists brand_partners_attributes_check;
alter table public.brand_partners add constraint brand_partners_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);
alter table public.brand_partners drop constraint if exists brand_partners_priority_attributes_check;
alter table public.brand_partners add constraint brand_partners_priority_attributes_check check (priority_attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);
alter table public.business_requests drop constraint if exists business_requests_attributes_check;
alter table public.business_requests add constraint business_requests_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);
alter table public.business_partner_requests drop constraint if exists business_partner_requests_attributes_check;
alter table public.business_partner_requests add constraint business_partner_requests_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);
alter table public.business_experiences drop constraint if exists business_experiences_attributes_check;
alter table public.business_experiences add constraint business_experiences_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);
alter table public.profiles drop constraint if exists profiles_venue_preferences_check;
alter table public.profiles add constraint profiles_venue_preferences_check check (venue_preferences <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]);

do $mig$
declare
  v_def text;
  v_new text;
  r record;
  v_eight constant text := $q$'casual', 'upscale']::text[]$q$;
  v_eight_to constant text := $q$'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events']::text[]$q$;
begin
  -- Functions that already listed all 18: append the two new values after the last one.
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('create_business_request', 'update_business_profile', 'answer_preference_poll')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $q$'fitness_focused'$q$, $q$'fitness_focused', 'private_dining', 'corporate_events'$q$);
    if v_new = v_def then raise exception 'no attribute list found in %', r.sig; end if;
    execute v_new;
  end loop;

  -- Functions that only knew the original 8: widen to the full list.
  for r in
    select p.oid, p.oid::regprocedure::text as sig from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('set_business_priority_attributes', 'create_business_experience', 'update_business_experience')
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, v_eight, v_eight_to);
    if v_new = v_def then raise exception 'no 8-value attribute list found in %', r.sig; end if;
    execute v_new;
  end loop;
end
$mig$;
