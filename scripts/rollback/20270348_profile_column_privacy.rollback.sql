-- Rollback for migration 20270348 (N6 profile column privacy): restores the production definitions read 2026-10-28 before it
-- was applied. Run the rollbacks newest first (20270354 -> 20270347); each assumes the later ones were already rolled back.
-- WARNING: this re-opens N6 (every signed-in account reads all profiles columns of every visible profile). Never run it
-- while external users exist; the app keeps working either way (readMyProfile / selectPeople fall back on their own).
lock table public.profiles in share row exclusive mode;
-- 1. profiles: whole-table SELECT for authenticated again (the column grant is dropped with it).
revoke select on public.profiles from authenticated;
grant select on public.profiles to authenticated;
-- 2. Policies: back to their production text.
alter policy "Business owners can view their own AI action log" on public.ai_actions
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = ai_actions.partner_id)))));
alter policy "Business owners can create offers for their business" on public.brand_offers
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
alter policy "Business owners can delete their own offers" on public.brand_offers
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
alter policy "Business owners can update their own offers" on public.brand_offers
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = brand_offers.partner_id)))));
alter policy "Business owners can view their own AI policies" on public.business_ai_policies
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_ai_policies.partner_id)))));
alter policy "Business owners can view their own suggestion history" on public.business_attribute_suggestions
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = business_attribute_suggestions.partner_id)))));
alter policy "Business owners can view their own availability postings" on public.business_availability
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_availability.partner_id)))));
alter policy "Business owners can view their own screening history" on public.business_content_screening_results
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_content_screening_results.partner_id)))));
alter policy "Owners read their creatives" on public.business_creatives
  using ((partner_id = ( SELECT profiles.managed_partner_id
   FROM profiles
  WHERE (profiles.id = auth.uid()))));
alter policy "Business owners can view their own customer notes" on public.business_customer_notes
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_customer_notes.partner_id)))));
alter policy "Anyone can view active experiences, owner sees all" on public.business_experiences
  using (((active = true) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = business_experiences.partner_id))))));
alter policy "Business owners can view their own fulfillment policy" on public.business_fulfillment_policies
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_fulfillment_policies.partner_id)))));
alter policy "Business owners can view their own invoices" on public.business_invoices
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_invoices.partner_id)))));
alter policy "Business owners can view their own match exclusions" on public.business_match_exclusions
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_match_exclusions.partner_id)))));
alter policy "Business owners can reply within an existing conversation" on public.business_messages
  with check (((sender_id = auth.uid()) AND (from_business = true) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_messages.partner_id)))) AND (NOT is_blocked(auth.uid(), conversation_with_id))));
alter policy "Followers can message a business they follow" on public.business_messages
  with check (((sender_id = auth.uid()) AND (from_business = false) AND (conversation_with_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM business_followers bf
  WHERE ((bf.brand_partner_id = business_messages.partner_id) AND (bf.user_id = auth.uid())))) AND (NOT (EXISTS ( SELECT 1
   FROM profiles p2
  WHERE ((p2.managed_partner_id = business_messages.partner_id) AND is_blocked(auth.uid(), p2.id)))))));
alter policy "Only the follower and business owner can see this conversation," on public.business_messages
  using ((((conversation_with_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_messages.partner_id))))) AND (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE (((b.blocker_id = auth.uid()) AND (b.blocked_id = business_messages.sender_id)) OR ((b.blocker_id = business_messages.sender_id) AND (b.blocked_id = auth.uid()))))))));
alter policy "Admins can update pending requests" on public.business_partner_requests
  using (((status = 'pending'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))));
alter policy "Admins can view all requests" on public.business_partner_requests
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
alter policy "Requester or target business owner can view requests" on public.business_partnership_requests
  using (((requester_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = business_partnership_requests.partner_id))))));
alter policy "Business owners can view payment rows on their own offers" on public.business_payments
  using ((EXISTS ( SELECT 1
   FROM ((business_reservations res
     JOIN business_request_offers bro ON ((bro.id = res.offer_id)))
     JOIN profiles p ON ((p.managed_partner_id = bro.partner_id)))
  WHERE ((res.id = business_payments.reservation_id) AND (p.id = auth.uid())))));
alter policy "Business owners can view their own priority signals" on public.business_priority_signals
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = business_priority_signals.partner_id)))));
alter policy "Business owners can view their own offer rows" on public.business_request_offers
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_request_offers.partner_id)))));
alter policy "Business owners can view reservations on their own offers" on public.business_reservations
  using ((EXISTS ( SELECT 1
   FROM (business_request_offers bro
     JOIN profiles p ON ((p.managed_partner_id = bro.partner_id)))
  WHERE ((bro.id = business_reservations.offer_id) AND (p.id = auth.uid())))));
alter policy "Business owners can post updates for their business" on public.business_updates
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = business_updates.partner_id)))));
alter policy "Users can express interest, respecting women-only gatherings" on public.gathering_interest
  with check (((auth.uid() = user_id) AND (status = 'pending'::text) AND (NOT (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_interest.gathering_id) AND (g.women_only = true) AND (NOT (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = auth.uid()) AND (lower(COALESCE(p.gender, ''::text)) = ANY (ARRAY['female'::text, 'woman'::text])))))))))) AND (EXISTS ( SELECT 1
   FROM gatherings g
  WHERE ((g.id = gathering_interest.gathering_id) AND (g.scheduled_at >= now()))))));
alter policy "Admins can review submissions" on public.id_verification_submissions
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
alter policy "Admins can view all submissions" on public.id_verification_submissions
  using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true))))));
alter policy "See notices sent to you only if mutual, premium, or super" on public.notices
  using (((auth.uid() = to_user) AND (NOT is_blocked(from_user, to_user)) AND ((is_super = true) OR has_mutual_notice(from_user, to_user) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_premium = true)))))));
alter policy "Business owners can upload their own logo" on storage.objects
  with check (((bucket_id = 'business-logos'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.managed_partner_id)::text = (storage.foldername(objects.name))[1]))))));
alter policy "Business owners can upload their own offer media" on storage.objects
  with check (((bucket_id = 'business-offer-media'::text) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND ((profiles.managed_partner_id)::text = (storage.foldername(objects.name))[1]))))));
alter policy "Users can view their own verification photos, admins can view a" on storage.objects
  using (((bucket_id = 'id-verification'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))))));
alter policy "Business owners can view their own contract" on public.partner_contracts
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.managed_partner_id = partner_contracts.partner_id)))));
alter policy "Admins can resolve reports" on public.reports
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
alter policy "Admins can view all reports" on public.reports
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_admin = true)))));
alter policy "Users can post their own stories" on public.stories
  with check (((auth.uid() = user_id) AND ((partner_id IS NULL) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.managed_partner_id = stories.partner_id))))) AND ((gathering_id IS NULL) OR viewer_was_at_gathering(gathering_id))));
-- 3. The people views: back to the invoker-run, wide production views.
drop view public.dating_candidates_visible_to_me;
drop view public.people_visible_to_me;
create view public.people_visible_to_me with (security_invoker = true) as
 SELECT id,
    display_name,
    bio,
    birthdate,
    photo_url,
    photo_verified,
    is_premium,
    expo_push_token,
    created_at,
    is_admin,
    terms_accepted_at,
    interests,
    pronouns,
    gender,
    sexual_orientation,
    profile_hidden,
    basics,
    discovery_gender,
    show_me,
    preferred_min_age,
    preferred_max_age,
    notify_matches,
    gender_hidden,
    ethnicity,
    ethnicity_hidden,
    ethnicity_preferences,
    prompts,
    relationship_intention,
    read_receipts_enabled,
    women_message_first,
    referral_code,
    referred_by,
    bonus_notices,
    gender_identity,
    interested_in_genders,
    discovery_view_style,
    wide_area,
    seen_browse_callout,
    browse_views_today,
    browse_views_date,
    ai_uses_today,
    ai_uses_date,
    spotify_access_token,
    spotify_refresh_token,
    spotify_token_expires_at,
    favorite_tracks,
    quick_filter_order,
    quick_filter_visible,
    last_home_visit,
    last_activity_check,
    managed_partner_id,
    connection_goal,
    timezone,
    gatherings_created_today,
    gatherings_created_date,
    communities_created_today,
    communities_created_date,
    friend_requests_sent_today,
    friend_requests_sent_date,
    stories_posted_today,
    stories_posted_date,
    onboarding_motivations,
    social_comfort_level,
    monthly_interests,
    monthly_interests_updated_at,
    home_quick_pick_categories,
    voice_intro_path,
    intent_visibility,
    open_to_friend_discovery,
    contacts_matched_calls_today,
    contacts_matched_date,
    dating_preferences_set,
    seen_home_first_run_moment,
    dating_pref_hair_colors,
    height_inches,
    dating_pref_min_height_inches,
    dating_pref_max_height_inches,
    dating_pref_eye_colors,
    quick_filter_config,
    friend_quick_filter_order,
    friend_quick_filter_visible,
    friend_quick_filter_config,
    notify_things_to_do_frequency,
    notify_things_to_do_categories,
    notify_things_to_do_max_distance_miles,
    notify_things_to_do_time_pref,
    notify_nearby_opportunities_frequency,
    notify_nearby_opportunities_categories,
    notify_nearby_opportunities_max_distance_miles,
    notify_nearby_opportunities_time_pref,
    notify_social,
    notify_discovery,
    notify_proximity,
    notify_planning,
    notify_business,
    notify_community,
    people_submode_dating_uses,
    people_submode_friends_uses,
    cuisine_preferences,
    venue_preferences,
    notify_dating,
    interest_groups,
    share_interest_in_demand,
    interested_demand_disclosure_ack_at,
    show_sponsored_places,
    notification_mutes
   FROM profiles p
  WHERE ((id = auth.uid()) OR (NOT viewer_blocked_either_way(id)));
create view public.dating_candidates_visible_to_me with (security_invoker = true) as
 SELECT id,
    display_name,
    photo_url,
    bio,
    discovery_gender,
    birthdate,
    ethnicity,
    interests,
    basics,
    height_inches,
    photo_verified,
    relationship_intention,
    gender_identity,
    interested_in_genders,
    show_me,
    wide_area,
    is_dating_discoverable(onboarding_motivations) AS dating_opted_in
   FROM people_visible_to_me v
  WHERE ((id <> auth.uid()) AND is_dating_discoverable(onboarding_motivations));
revoke all on public.people_visible_to_me from public, anon, authenticated;
revoke all on public.dating_candidates_visible_to_me from public, anon, authenticated;
grant select, insert, update, delete, references, trigger on public.people_visible_to_me to authenticated;
grant select on public.dating_candidates_visible_to_me to authenticated;
-- 4. The new functions (nothing else calls them; the app falls back when they are missing).
drop function if exists public.get_friend_dining_preferences(uuid);
drop function if exists public.get_my_profile();
drop function if exists public.partner_owner_blocked_with_me(uuid);
drop function if exists public.my_gender_is_woman();
drop function if exists public.my_is_premium();
drop function if exists public.my_managed_partner_id();
-- 5. The coarse wide_area check.
alter table public.profiles drop constraint if exists profiles_wide_area_coarse;
