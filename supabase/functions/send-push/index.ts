import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { sendEmail } from '../_shared/email.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// Item 110 (CLAUDE.md, "distinguish Important (relationship/contextual)
// from Recommendation (discovery)... much less spammy"): every caller of
// this function already passes `data.type` (used client-side for tap
// routing by notifications.js's own routeNotificationTap() switch), so the
// tier can be derived here with zero changes needed to any of the ~60
// Postgres notify_* functions that call this. This list MUST be kept in
// sync with src/constants/notificationTier.js's own RECOMMENDATION_TYPES
// set (that file's own Jest test guards it against drift on the client
// side; there is no equivalent automated guard for this Deno copy, since
// this function can't import from src/ -- re-check both together by hand
// whenever a push type is added, renamed, or reclassified).
const RECOMMENDATION_TYPES = new Set([
  'recommended_gathering',
  'recommended_business_availability',
  'first_mission_reminder',
  'momentum_streak_nudge',
  'reward_tier_nudge',
  'business_opportunity_received',
  'business_opportunities_digest',
  'aggregated_demand_growing',
  'occasion_demand_growing',
  'community_area_demand_growing',
  'group_intent_signal'
]);
// Item 140: each push type's next-action button (the push's categoryId; the app registers the categories with labels in the
// person's language). MUST equal src/constants/notificationActions.js NOTIFICATION_ACTION_BY_TYPE (Jest asserts equality).
const NOTIFICATION_ACTION_BY_TYPE = {
  match: 'open_chat',
  new_match: 'open_chat',
  friend_discovery_match: 'open_chat',
  message: 'reply',
  playlist_addition: 'open_chat',
  trip_idea_addition: 'open_chat',
  shared_decision_addition: 'open_chat',
  constitution_addition: 'open_chat',
  memory_addition: 'open_chat',
  stress_test_addition: 'open_chat',
  timeline_addition: 'open_chat',
  match_reminder: 'open_chat',
  screenshot: 'open_chat',
  video_call: 'open_chat',
  wave: 'view_notices',
  gathering_approved: 'view_plan',
  gathering_reminder: 'view_plan',
  gathering_updated: 'view_plan',
  gathering_waitlisted: 'view_plan',
  gathering_business_reminder: 'view_plan',
  gathering_interest: 'view_attendees',
  gathering_invite: 'view_invite',
  recommended_gathering: 'view_gathering',
  friend_joined_gathering: 'view_gathering',
  recurring_gathering: 'view_gathering',
  gathering_cancelled: 'find_something_else',
  community_cancelled: 'find_something_else',
  first_mission_reminder: 'browse_gatherings',
  friend_request: 'view_friend_request',
  friend_accepted: 'view_friends',
  birthday: 'view_profile',
  crossed_paths_sighting: 'view_profile',
  new_story: 'view_profile',
  occasion_surprise_revealed: 'view_profile',
  birthday_upcoming: 'start_planning',
  anniversary_upcoming: 'start_planning',
  occasion_upcoming: 'start_planning',
  business_recall_outreach: 'plan_visit',
  momentum_streak_nudge: 'view_progress',
  reward_tier_nudge: 'view_progress',
  business_offer_received: 'view_offer',
  business_reservation_confirmed: 'view_plan',
  plan_organizer_added: 'view_plan',
  plan_confirmed: 'view_plan',
  plan_reservation_cancelled: 'view_plan',
  plan_cancelled: 'view_plan',
  plan_addon_removed: 'view_plan',
  plan_item_time_changed: 'view_plan',
  business_offer_withdrawn: 'review_request',
  business_offer_declined: 'review_request',
  business_request_all_declined: 'review_request',
  business_reservation_cancelled: 'review_request',
  recommended_business_availability: 'see_details',
  business_update: 'view_business',
  group_plan_invite: 'view_invite',
  occasion_group_plan_invite: 'view_invite',
  group_plan_response: 'view_plan',
  group_plan_confirmed: 'view_plan',
  group_plan_offer_pending: 'view_plan',
  group_plan_reservation_confirmed: 'view_plan',
  group_plan_removed: 'view_plan',
  social_offer_received: 'view_offer',
  social_offer_responded: 'view_plan',
  occasion_group_plan_decided: 'view_plan',
  occasion_group_plan_voting_business: 'view_plan',
  occasion_group_plan_stalled: 'view_plan',
  occasion_group_plan_date_set: 'view_plan',
  occasion_group_plan_cancelled: 'view_plan',
  occasion_group_plan_guest_rsvp: 'view_plan',
  date_proposal: 'view_proposal',
  date_proposal_response: 'view_plan',
  experience_shared: 'view_plan',
  preference_poll_received: 'answer_question',
  group_intent_signal: 'see_ideas',
  community_area_demand_growing: 'view_community',
  business_partnership_response: 'see_details',
  business_partner_approved: 'open_dashboard',
  business_partner_denied: 'view_application',
  business_partner_needs_info: 'view_application',
  business_opportunity_received: 'view_opportunities',
  business_opportunities_digest: 'view_opportunities',
  aggregated_demand_growing: 'view_opportunities',
  occasion_demand_growing: 'view_opportunities',
  business_request_cancelled: 'view_opportunities',
  business_offer_review_result: 'view_your_offers',
  business_offer_accepted: 'view_booking',
  reservation_cancelled_by_customer: 'view_booking'
};
// Business-owner mute groups (business_notification_prefs). MUST match
// src/constants/businessNotificationGroups.js BUSINESS_NOTIFICATION_GROUP_BY_TYPE (Jest asserts equality).
const BUSINESS_NOTIFICATION_GROUP_BY_TYPE = {
  business_opportunity_received: 'requests',
  business_opportunities_digest: 'requests',
  business_request_cancelled: 'requests',
  business_offer_accepted: 'offers',
  business_offer_declined: 'offers',
  business_offer_review_result: 'offers',
  business_offer_withdrawn: 'offers',
  business_reservation_confirmed: 'reservations',
  business_reservation_cancelled: 'reservations',
  reservation_cancelled_by_customer: 'reservations',
  aggregated_demand_growing: 'demand',
  occasion_demand_growing: 'demand'
};
// A new request is recommendation-tier (quiet push) but it is THE alert a web-only owner needs, so it is also emailed.
const EMAIL_EXTRA_TYPES = new Set(['business_opportunity_received', 'business_opportunities_digest']);
function notificationTier(type) {
  return RECOMMENDATION_TYPES.has(type) ? 'recommendation' : 'important';
}
serve(async (req)=>{
  try {
    // Critical: this function was previously callable by anyone
    // using only the public anon key, with no verification at all —
    // meaning any unauthenticated caller could send arbitrary,
    // fake push notifications to any user, impersonating the app.
    // Every legitimate caller (database triggers, other functions)
    // already passes the service role key as Authorization — this
    // just verifies that's genuinely what was sent.
    const authHeader = req.headers.get('Authorization');
    const expectedAuth = `Bearer ${SERVICE_ROLE_KEY}`;
    if (authHeader !== expectedAuth) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401
      });
    }
    const { recipient_id, title, body, data } = await req.json();
    if (!recipient_id || !title) {
      return new Response(JSON.stringify({
        error: 'recipient_id and title are required'
      }), {
        status: 400
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin.from('profiles').select('expo_push_token').eq('id', recipient_id).maybeSingle();
    // Owner mute preferences apply to push AND email. Only owners have a row; account events map to no group.
    const muteGroup = BUSINESS_NOTIFICATION_GROUP_BY_TYPE[data?.type];
    if (muteGroup) {
      const { data: prefs } = await admin.from('business_notification_prefs').select('muted_groups').eq('user_id', recipient_id).maybeSingle();
      if (prefs?.muted_groups?.includes(muteGroup)) {
        return new Response(JSON.stringify({
          ok: true,
          skipped: 'muted'
        }), {
          status: 200
        });
      }
    }
    const tier = notificationTier(data?.type);
    if (!profile?.expo_push_token) {
      // Business Web parity: an owner who only uses the website has no push token. If they have a verified, enabled
      // email address (business_email_settings) send the same alert there -- Important-tier plus new requests, so a
      // web-only owner isn't flooded with recommendations. No-op (and never an error) until the email provider is configured.
      let emailed = false;
      let emailReason;
      if (tier === 'important' || EMAIL_EXTRA_TYPES.has(data?.type)) {
        const { data: es } = await admin.from('business_email_settings').select('email, verified_at, enabled').eq('user_id', recipient_id).maybeSingle();
        if (es?.email && es.verified_at && es.enabled) {
          const webUrl = Deno.env.get('BUSINESS_WEB_URL');
          const sent = await sendEmail(es.email, title, `${body ?? ''}${webUrl ? `\n\nOpen your Nearby business dashboard: ${webUrl}` : ''}`);
          emailed = sent.sent;
          emailReason = sent.reason;
          // Never a silent failure: a verified owner is waiting on this alert, so an unconfigured/failed provider shows up in the function logs.
          if (!sent.sent) console.warn(`business email alert NOT sent (${sent.reason}) for ${data?.type}; set RESEND_API_KEY and EMAIL_FROM secrets`);
        }
      }
      return new Response(JSON.stringify({
        ok: true,
        skipped: 'no_token',
        emailed,
        emailReason
      }), {
        status: 200
      });
    }
    const isImportant = tier === 'important';
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: profile.expo_push_token,
        title,
        body,
        data: data ?? {},
        sound: isImportant ? 'default' : null,
        priority: isImportant ? 'high' : 'default',
        channelId: isImportant ? 'important-alerts' : 'recommendations',
        ...(NOTIFICATION_ACTION_BY_TYPE[data?.type] ? { categoryId: `nearby_${NOTIFICATION_ACTION_BY_TYPE[data?.type]}` } : {})
      })
    });
    const result = await pushResponse.json();
    return new Response(JSON.stringify({
      ok: true,
      result
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500
    });
  }
});
