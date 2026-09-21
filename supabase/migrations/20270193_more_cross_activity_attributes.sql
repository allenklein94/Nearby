-- Item 39: four more cross-activity attributes in the ONE shared vocabulary (now 24 keys): wifi, food_available,
-- beginner_friendly, reservation_required. Same recipe as 20261229: all 6 CHECKs are widened and every function that carries
-- the list is widened in place from its live body (guarded: fails loudly if a body did not contain the expected list).
-- A business declares them; a customer can ask for them; nothing is inferred. Kept business-only on the consumer dining
-- preference surfaces where they are not a personal "vibe" (see BUSINESS_ONLY_ATTRIBUTE_KEYS).

alter table public.brand_partners drop constraint if exists brand_partners_attributes_check;
alter table public.brand_partners add constraint brand_partners_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);
alter table public.brand_partners drop constraint if exists brand_partners_priority_attributes_check;
alter table public.brand_partners add constraint brand_partners_priority_attributes_check check (priority_attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);
alter table public.business_requests drop constraint if exists business_requests_attributes_check;
alter table public.business_requests add constraint business_requests_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);
alter table public.business_partner_requests drop constraint if exists business_partner_requests_attributes_check;
alter table public.business_partner_requests add constraint business_partner_requests_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);
alter table public.business_experiences drop constraint if exists business_experiences_attributes_check;
alter table public.business_experiences add constraint business_experiences_attributes_check check (attributes <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);
alter table public.profiles drop constraint if exists profiles_venue_preferences_check;
alter table public.profiles add constraint profiles_venue_preferences_check check (venue_preferences <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale', 'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront', 'late_night', 'board_game_friendly', 'photography_friendly', 'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required']::text[]);

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
    v_new := replace(v_def, $q$'corporate_events'$q$, $q$'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required'$q$);
    if v_new = v_def then raise exception 'no attribute list found in %', r.sig; end if;
    execute v_new;
    n := n + 1;
  end loop;
  if n <> 6 then raise exception 'expected 6 functions, patched %', n; end if;
end
$mig$;
