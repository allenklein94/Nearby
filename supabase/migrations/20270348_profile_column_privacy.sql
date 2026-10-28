-- Trust & safety N6 (owner approved Option 1, 2026-10-28; priority 1): another signed-in person can read only a profile's
-- PUBLIC columns, never its private ones.
-- Proven before this migration, read-only under the real `authenticated` role: `authenticated` held a whole-table SELECT on
-- profiles (all 107 columns) and the read policy is row-level only, so any signed-in account read every column of every
-- screened, unhidden profile (exact birthdate, orientation, gender/ethnicity incl. their "hidden" switches, dating
-- preferences, wide_area, timezone, last activity, is_admin, managed_partner_id, referral codes, counters, notification
-- settings). people_visible_to_me (security_invoker) passed the same columns through.
-- Fix:
--   * profiles: the table-level SELECT for authenticated is replaced by a column grant on the public-profile columns only
--     (what other people's cards, chats, embeds and profiles show). INSERT/UPDATE grants are unchanged.
--   * the caller's whole own row comes from get_my_profile() (security definer, auth.uid() only); the app reads its own
--     profile only through it (services/myProfile.js, with a fallback while this migration is not live).
--   * 36 policies on other tables that looked up the caller's own managed_partner_id / is_admin / is_premium / gender in
--     profiles now ask small own-row helpers (my_managed_partner_id, check_is_admin, my_is_premium,
--     my_gender_is_woman, partner_owner_blocked_with_me); same meaning, no profile column read by the caller. The 3
--     policies that read only public columns (id, photo_verified, profile_hidden) are unchanged.
--   * people_visible_to_me and dating_candidates_visible_to_me become owner-run views (security_invoker = false,
--     security_barrier) that repeat the profiles read rule + the block rule in their WHERE and return only what a
--     viewer may see: age (never the birthdate), gender / ethnicity NULL when the person hid them, gender identity and
--     who they're interested in only for a person in Dating who hasn't hidden gender. No client write to either view.
--   * get_friend_dining_preferences(friend): an accepted, unblocked friend's cuisine / venue answers (the occasion
--     planner's one read of another person's private columns), else nothing.
-- Not changed: service-role reads (every edge function reading profiles uses the service key), SECURITY DEFINER
-- functions, profile rows. sexual_orientation stays a public-profile field shown on a visible profile (as the app shows
-- it today; there is no hide switch for it) through people_visible_to_me only, never by a direct read of profiles.
-- Installed build 86 reads its own row with select('*') and other private columns directly, so it stops working after
-- this migration (fails closed: errors, never more data). Rollout: the new build on every installed device first.
-- A later migration that adds a profiles column a viewer may read must grant select on that column itself.

lock table public.profiles in share row exclusive mode;

-- 1. Own-row helpers for policies (each reads only the caller's own row).
create or replace function public.my_managed_partner_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select managed_partner_id from profiles where id = auth.uid();
$$;
create or replace function public.my_is_premium() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_premium from profiles where id = auth.uid()), false);
$$;
create or replace function public.my_gender_is_woman() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select lower(coalesce(gender, '')) = any (array['female', 'woman']) from profiles where id = auth.uid()), false);
$$;
-- Is the caller in a block (either way) with the person who manages this business?
create or replace function public.partner_owner_blocked_with_me(p_partner uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p2 where p2.managed_partner_id = p_partner and is_blocked(auth.uid(), p2.id));
$$;
revoke all on function public.my_managed_partner_id() from public, anon;
revoke all on function public.my_is_premium() from public, anon;
revoke all on function public.my_gender_is_woman() from public, anon;
revoke all on function public.partner_owner_blocked_with_me(uuid) from public, anon;
grant execute on function public.my_managed_partner_id() to authenticated, service_role;
grant execute on function public.my_is_premium() to authenticated, service_role;
grant execute on function public.my_gender_is_woman() to authenticated, service_role;
grant execute on function public.partner_owner_blocked_with_me(uuid) to authenticated, service_role;

-- 2. Policies on other tables: own-row helpers instead of reading profiles' private columns (generated from production's
-- policy text; only the profiles lookups changed).
alter policy "Business owners can view their own AI action log" on public.ai_actions
  using (COALESCE((my_managed_partner_id() = ai_actions.partner_id), false));

alter policy "Business owners can create offers for their business" on public.brand_offers
  with check (COALESCE((my_managed_partner_id() = brand_offers.partner_id), false));

alter policy "Business owners can delete their own offers" on public.brand_offers
  using (COALESCE((my_managed_partner_id() = brand_offers.partner_id), false));

alter policy "Business owners can update their own offers" on public.brand_offers
  using (COALESCE((my_managed_partner_id() = brand_offers.partner_id), false));

alter policy "Business owners can view their own AI policies" on public.business_ai_policies
  using (COALESCE((my_managed_partner_id() = business_ai_policies.partner_id), false));

alter policy "Business owners can view their own suggestion history" on public.business_attribute_suggestions
  using (COALESCE((my_managed_partner_id() = business_attribute_suggestions.partner_id), false));

alter policy "Business owners can view their own availability postings" on public.business_availability
  using (COALESCE((my_managed_partner_id() = business_availability.partner_id), false));

alter policy "Business owners can view their own screening history" on public.business_content_screening_results
  using (COALESCE((my_managed_partner_id() = business_content_screening_results.partner_id), false));

alter policy "Owners read their creatives" on public.business_creatives
  using ((partner_id = my_managed_partner_id()));

alter policy "Business owners can view their own customer notes" on public.business_customer_notes
  using (COALESCE((my_managed_partner_id() = business_customer_notes.partner_id), false));

alter policy "Anyone can view active experiences, owner sees all" on public.business_experiences
  using (((active = true) OR COALESCE((my_managed_partner_id() = business_experiences.partner_id), false)));

alter policy "Business owners can view their own fulfillment policy" on public.business_fulfillment_policies
  using (COALESCE((my_managed_partner_id() = business_fulfillment_policies.partner_id), false));

alter policy "Business owners can view their own invoices" on public.business_invoices
  using (COALESCE((my_managed_partner_id() = business_invoices.partner_id), false));

alter policy "Business owners can view their own match exclusions" on public.business_match_exclusions
  using (COALESCE((my_managed_partner_id() = business_match_exclusions.partner_id), false));

alter policy "Business owners can reply within an existing conversation" on public.business_messages
  with check (((sender_id = auth.uid()) AND (from_business = true) AND COALESCE((my_managed_partner_id() = business_messages.partner_id), false) AND (NOT is_blocked(auth.uid(), conversation_with_id))));

alter policy "Followers can message a business they follow" on public.business_messages
  with check (((sender_id = auth.uid()) AND (from_business = false) AND (conversation_with_id = auth.uid()) AND (EXISTS ( SELECT 1 FROM business_followers bf WHERE ((bf.brand_partner_id = business_messages.partner_id) AND (bf.user_id = auth.uid())))) AND (NOT partner_owner_blocked_with_me(business_messages.partner_id))));

alter policy "Only the follower and business owner can see this conversation," on public.business_messages
  using ((((conversation_with_id = auth.uid()) OR COALESCE((my_managed_partner_id() = business_messages.partner_id), false)) AND (NOT (EXISTS ( SELECT 1 FROM blocks b WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = business_messages.sender_id)) OR ((b.blocker_id = business_messages.sender_id) AND (b.blocked_id = auth.uid()))))))));

alter policy "Admins can update pending requests" on public.business_partner_requests
  using (((status = 'pending'::text) AND check_is_admin(auth.uid())));

alter policy "Admins can view all requests" on public.business_partner_requests
  using (check_is_admin(auth.uid()));

alter policy "Requester or target business owner can view requests" on public.business_partnership_requests
  using (((requester_id = auth.uid()) OR COALESCE((my_managed_partner_id() = business_partnership_requests.partner_id), false)));

alter policy "Business owners can view payment rows on their own offers" on public.business_payments
  using ((EXISTS ( SELECT 1 FROM (business_reservations res JOIN business_request_offers bro ON ((bro.id = res.offer_id))) WHERE ((res.id = business_payments.reservation_id) AND (bro.partner_id = my_managed_partner_id())))));

alter policy "Business owners can view their own priority signals" on public.business_priority_signals
  using (COALESCE((my_managed_partner_id() = business_priority_signals.partner_id), false));

alter policy "Business owners can view their own offer rows" on public.business_request_offers
  using (COALESCE((my_managed_partner_id() = business_request_offers.partner_id), false));

alter policy "Business owners can view reservations on their own offers" on public.business_reservations
  using ((EXISTS ( SELECT 1 FROM business_request_offers bro WHERE ((bro.id = business_reservations.offer_id) AND (bro.partner_id = my_managed_partner_id())))));

alter policy "Business owners can post updates for their business" on public.business_updates
  with check (COALESCE((my_managed_partner_id() = business_updates.partner_id), false));

alter policy "Users can express interest, respecting women-only gatherings" on public.gathering_interest
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (NOT (EXISTS ( SELECT 1 FROM gatherings g WHERE ((g.id = gathering_interest.gathering_id) AND (g.women_only = true) AND (NOT my_gender_is_woman()))))) AND (EXISTS ( SELECT 1 FROM gatherings g WHERE ((g.id = gathering_interest.gathering_id) AND (g.scheduled_at >= now()))))));

alter policy "Admins can review submissions" on public.id_verification_submissions
  using (check_is_admin(auth.uid()))
  with check (check_is_admin(auth.uid()));

alter policy "Admins can view all submissions" on public.id_verification_submissions
  using (((auth.uid() = user_id) OR check_is_admin(auth.uid())));

alter policy "See notices sent to you only if mutual, premium, or super" on public.notices
  using (((auth.uid() = to_user) AND (NOT is_blocked(from_user, to_user)) AND ((is_super = true) OR has_mutual_notice(from_user, to_user) OR my_is_premium())));

alter policy "Business owners can upload their own logo" on storage.objects
  with check (((bucket_id = 'business-logos'::text) AND COALESCE(((my_managed_partner_id())::text = (storage.foldername(objects.name))[1]), false)));

alter policy "Business owners can upload their own offer media" on storage.objects
  with check (((bucket_id = 'business-offer-media'::text) AND COALESCE(((my_managed_partner_id())::text = (storage.foldername(objects.name))[1]), false)));

alter policy "Users can view their own verification photos, admins can view a" on storage.objects
  using (((bucket_id = 'id-verification'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR check_is_admin(auth.uid()))));

alter policy "Business owners can view their own contract" on public.partner_contracts
  using (COALESCE((my_managed_partner_id() = partner_contracts.partner_id), false));

alter policy "Admins can resolve reports" on public.reports
  using (check_is_admin(auth.uid()));

alter policy "Admins can view all reports" on public.reports
  using (check_is_admin(auth.uid()));

alter policy "Users can post their own stories" on public.stories
  with check (((auth.uid() = user_id) AND ((partner_id IS NULL) OR COALESCE((my_managed_partner_id() = stories.partner_id), false)) AND ((gathering_id IS NULL) OR viewer_was_at_gathering(gathering_id))));

-- 3. The caller's own whole row.
create or replace function public.get_my_profile() returns setof public.profiles
  language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid();
$$;
revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated, service_role;

-- 4. An accepted, unblocked friend's dining answers (occasion planning), else no row.
create or replace function public.get_friend_dining_preferences(p_friend uuid)
  returns table (cuisine_preferences text[], venue_preferences text[])
  language sql stable security definer set search_path = public as $$
  select p.cuisine_preferences, p.venue_preferences
    from profiles p
   where p.id = p_friend
     and auth.uid() is not null
     and exists (select 1 from friendships f
                  where f.status = 'accepted'
                    and ((f.user_a = auth.uid() and f.user_b = p_friend) or (f.user_b = auth.uid() and f.user_a = p_friend)))
     and not is_blocked(auth.uid(), p_friend);
$$;
revoke all on function public.get_friend_dining_preferences(uuid) from public, anon;
grant execute on function public.get_friend_dining_preferences(uuid) to authenticated, service_role;

-- 5. The people views: owner-run, narrowed. (Dropped first: their column lists shrink.)
drop view if exists public.dating_candidates_visible_to_me;
drop view if exists public.people_visible_to_me;

create view public.people_visible_to_me with (security_invoker = false, security_barrier = true) as
 SELECT p.id,
    p.display_name,
    p.bio,
    p.photo_url,
    p.photo_verified,
    p.is_premium,
    p.created_at,
    p.interests,
    p.pronouns,
    p.basics,
    p.prompts,
    p.relationship_intention,
    p.connection_goal,
    p.favorite_tracks,
    p.voice_intro_path,
    p.open_to_friend_discovery,
    date_part('year', age(current_date, p.birthdate))::integer AS age,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.gender END AS gender,
    p.sexual_orientation,
    CASE WHEN coalesce(p.ethnicity_hidden, false) THEN NULL ELSE p.ethnicity END AS ethnicity,
    CASE WHEN coalesce(p.gender_hidden, false) OR NOT is_dating_discoverable(p.onboarding_motivations) THEN NULL
         ELSE p.gender_identity END AS gender_identity,
    CASE WHEN coalesce(p.gender_hidden, false) OR NOT is_dating_discoverable(p.onboarding_motivations) THEN NULL
         ELSE p.interested_in_genders END AS interested_in_genders
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND (p.id = auth.uid()
         OR (((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
             AND NOT viewer_blocked_either_way(p.id)));

create view public.dating_candidates_visible_to_me with (security_invoker = false, security_barrier = true) as
 SELECT p.id,
    p.display_name,
    p.photo_url,
    p.bio,
    p.discovery_gender,
    date_part('year', age(current_date, p.birthdate))::integer AS age,
    CASE WHEN coalesce(p.ethnicity_hidden, false) THEN NULL ELSE p.ethnicity END AS ethnicity,
    p.interests,
    p.basics,
    p.height_inches,
    p.photo_verified,
    p.relationship_intention,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.gender_identity END AS gender_identity,
    CASE WHEN coalesce(p.gender_hidden, false) THEN NULL ELSE p.interested_in_genders END AS interested_in_genders,
    p.show_me,
    p.wide_area,
    is_dating_discoverable(p.onboarding_motivations) AS dating_opted_in
   FROM profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND is_dating_discoverable(p.onboarding_motivations)
    AND ((p.photo_verified = true AND p.profile_hidden = false) OR check_is_admin(auth.uid()))
    AND NOT viewer_blocked_either_way(p.id);

revoke all on public.people_visible_to_me from public, anon, authenticated;
revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select on public.people_visible_to_me to authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;

-- 6. profiles: only the public-profile columns are readable by a signed-in client.
revoke select on public.profiles from authenticated;
grant select (id, display_name, bio, photo_url, photo_verified, is_premium, created_at, interests, pronouns,
              profile_hidden, basics, prompts, relationship_intention, read_receipts_enabled, women_message_first,
              favorite_tracks, voice_intro_path, connection_goal, open_to_friend_discovery)
  on public.profiles to authenticated;

-- 7. wide_area stays in the Dating view (owner, 2026-10-28) only as the coarse 0.1-degree bucket the app writes
-- (wideAreaLabel in services/proximity.js): the database refuses anything finer, so no client can put exact coordinates
-- there for daters to read. Every production value already has this shape (checked 2026-10-28).
alter table public.profiles add constraint profiles_wide_area_coarse
  check (wide_area is null or wide_area ~ '^-?[0-9]{1,3}(\.[0-9])?,-?[0-9]{1,3}(\.[0-9])?$');
