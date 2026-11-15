import { secretKey } from '../_shared/supabaseKeys.ts';
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { sendEmail } from '../_shared/email.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = secretKey();

// Item 141: notification priority (high / medium / low) per push type, and how each is delivered. MUST equal
// src/constants/notificationTier.js NOTIFICATION_PRIORITY_BY_TYPE and PRIORITY_DELIVERY (Jest asserts equality). Unknown = medium.
const NOTIFICATION_PRIORITY_BY_TYPE = {
  business_offer_received: 'high',
  social_offer_received: 'high',
  group_plan_offer_pending: 'high',
  business_request_expiring: 'high',
  account_security_notice: 'high',
  gathering_reminder: 'high',
  gathering_updated: 'high',
  gathering_cancelled: 'high',
  community_cancelled: 'high',
  plan_item_time_changed: 'high',
  plan_reservation_cancelled: 'high',
  plan_cancelled: 'high',
  occasion_group_plan_cancelled: 'high',
  business_reservation_cancelled: 'high',
  message: 'high',
  plan_message: 'high',
  video_call: 'high',
  business_opportunity_received: 'high',
  business_offer_accepted: 'high',
  reservation_cancelled_by_customer: 'high',
  match: 'medium',
  new_match: 'medium',
  friend_discovery_match: 'medium',
  wave: 'medium',
  screenshot: 'medium',
  friend_request: 'medium',
  friend_accepted: 'medium',
  birthday: 'medium',
  friend_joined_gathering: 'medium',
  occasion_surprise_revealed: 'medium',
  gathering_approved: 'medium',
  gathering_waitlisted: 'medium',
  gathering_interest: 'medium',
  gathering_invite: 'medium',
  gathering_business_reminder: 'medium',
  birthday_upcoming: 'medium',
  anniversary_upcoming: 'medium',
  occasion_upcoming: 'medium',
  business_reservation_confirmed: 'medium',
  plan_organizer_added: 'medium',
  plan_confirmed: 'medium',
  plan_addon_removed: 'medium',
  business_offer_withdrawn: 'medium',
  business_offer_revised: 'medium',
  business_offer_declined: 'medium',
  business_request_all_declined: 'medium',
  group_plan_invite: 'medium',
  group_plan_response: 'medium',
  group_plan_confirmed: 'medium',
  group_plan_reservation_confirmed: 'medium',
  group_plan_removed: 'medium',
  social_offer_responded: 'medium',
  date_proposal: 'medium',
  date_proposal_response: 'medium',
  experience_shared: 'medium',
  preference_poll_received: 'medium',
  occasion_group_plan_invite: 'medium',
  occasion_group_plan_decided: 'medium',
  occasion_group_plan_voting_business: 'medium',
  occasion_group_plan_stalled: 'medium',
  occasion_group_plan_date_set: 'medium',
  occasion_group_plan_guest_rsvp: 'medium',
  business_partner_approved: 'medium',
  business_partner_denied: 'medium',
  business_partner_needs_info: 'medium',
  admin_report_received: 'medium',
  admin_screening_outage: 'medium',
  business_partnership_response: 'medium',
  business_request_cancelled: 'medium',
  business_offer_review_result: 'medium',
  recommended_gathering: 'low',
  recurring_gathering: 'low',
  recommended_business_availability: 'low',
  group_intent_signal: 'low',
  crossed_paths_sighting: 'low',
  new_story: 'low',
  business_update: 'low',
  business_recall_outreach: 'low',
  first_mission_reminder: 'low',
  momentum_streak_nudge: 'low',
  reward_tier_nudge: 'low',
  match_reminder: 'low',
  playlist_addition: 'low',
  trip_idea_addition: 'low',
  shared_decision_addition: 'low',
  constitution_addition: 'low',
  memory_addition: 'low',
  stress_test_addition: 'low',
  timeline_addition: 'low',
  aggregated_demand_growing: 'low',
  occasion_demand_growing: 'low',
  community_area_demand_growing: 'low',
  business_opportunities_digest: 'low'
};
const PRIORITY_DELIVERY = {
  high: { sound: 'default', priority: 'high', channelId: 'important-alerts', interruptionLevel: 'active' },
  medium: { sound: null, priority: 'default', channelId: 'updates', interruptionLevel: 'active' },
  low: { sound: null, priority: 'normal', channelId: 'recommendations', interruptionLevel: 'passive' }
};
// Item 140: each push type's next-action button (the push's categoryId; the app registers the categories with labels in the
// person's language). MUST equal src/constants/notificationActions.js NOTIFICATION_ACTION_BY_TYPE (Jest asserts equality).
const NOTIFICATION_ACTION_BY_TYPE = {
  match: 'open_chat',
  new_match: 'open_chat',
  friend_discovery_match: 'open_chat',
  message: 'reply',
  plan_message: 'reply',
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
  friend_accepted: 'view_profile',
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
  business_offer_revised: 'view_offer',
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
  admin_report_received: 'review_reports',
  admin_screening_outage: 'review_content',
  account_security_notice: 'open_settings',
  business_opportunity_received: 'view_opportunities',
  business_opportunities_digest: 'view_opportunities',
  aggregated_demand_growing: 'view_opportunities',
  occasion_demand_growing: 'view_opportunities',
  business_request_cancelled: 'view_opportunities',
  business_request_expiring: 'review_request',
  business_offer_review_result: 'view_your_offers',
  business_offer_accepted: 'view_booking',
  reservation_cancelled_by_customer: 'view_booking'
};
// Item 143: a person's notification choices (customer and business-owner alike) are applied once, in the database's
// _send_push, before anything reaches this function; nothing here mutes.
// The email fallback carries ONLY the owner's business alerts: exactly the types in the owner_* notification groups
// (src/constants/notificationPreferences.js; guard src/constants/sendPushDigestEmail.test.js keeps the two lists equal).
// A person's own social/customer pushes (waves, messages, their own requests) are never emailed to the business address,
// whatever their priority. The low-priority digest is included: it is THE summary a web-only owner needs.
const EMAIL_TYPES = new Set([
  'business_opportunity_received', 'business_opportunities_digest', 'business_request_cancelled', 'business_request_expiring',
  'business_offer_accepted', 'business_offer_review_result', 'reservation_cancelled_by_customer',
  'aggregated_demand_growing', 'occasion_demand_growing',
]);
const LINK_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TYPE = /^[a-z_]{1,64}$/;
function businessWebLinkUrl(baseUrl, type, requestId) {
  if (!baseUrl) return null;
  if (!type || !LINK_TYPE.test(type) || !requestId || !LINK_UUID.test(requestId)) return baseUrl;
  return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}n=${encodeURIComponent(type)}&r=${requestId}`;
}
function notificationPriority(type) {
  return NOTIFICATION_PRIORITY_BY_TYPE[type] ?? 'medium';
}
// Item 62: replies to ONE request replace each other on the phone instead of piling up. The database sets collapse_key
// 'offers:<request id>' on reply pushes only; Expo maps collapseId to apns-collapse-id (iOS replaces the shown one) and tag to
// the FCM notification tag (Android replaces the shown one; collapseId alone only coalesces in transit there).
const REPLACE_KEY = /^offers:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function replaceInPlace(data) {
  const k = data?.collapse_key;
  return typeof k === 'string' && REPLACE_KEY.test(k) ? { collapseId: k, tag: k } : {};
}
// The email fallback for ONE business alert (EMAIL_TYPES only, a verified + enabled address only). Used when the owner has
// no push token, and when Expo says the stored token is dead (DeviceNotRegistered: the app was deleted). Never throws.
async function emailBusinessAlert(admin, recipientId, title, body, data) {
  if (!EMAIL_TYPES.has(data?.type)) return { emailed: false, emailReason: undefined };
  const { data: es } = await admin.from('business_email_settings').select('email, verified_at, enabled').eq('user_id', recipientId).maybeSingle();
  if (!(es?.email && es.verified_at && es.enabled)) return { emailed: false, emailReason: undefined };
  const webUrl = Deno.env.get('BUSINESS_WEB_URL');
  // Owner, 2026-11-14: an alert about ONE request links to it (the website opens the push's own destination,
  // src/utils/businessWebLink.js; same `?n=<type>&r=<request id>` shape, guard keeps them equal). No personal data.
  const linked = businessWebLinkUrl(webUrl, data?.type, data?.request_id);
  const linkLine = !webUrl ? '' : linked !== webUrl ? `\n\nOpen this request: ${linked}` : `\n\nOpen your Nearby business dashboard: ${webUrl}`;
  const sent = await sendEmail(es.email, title, `${body ?? ''}${linkLine}`);
  // Never a silent failure: a verified owner is waiting on this alert, so an unconfigured/failed provider shows up in the function logs.
  if (!sent.sent) console.warn(`business email alert NOT sent (${sent.reason}) for ${data?.type}; set RESEND_API_KEY and EMAIL_FROM secrets`);
  return { emailed: sent.sent, emailReason: sent.reason };
}
// Dead tokens (20270421): only Expo's DeviceNotRegistered means the app is gone; every other error is left alone.
const DEAD_TOKEN_ERROR = 'DeviceNotRegistered';
function expoHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // Expo enhanced push security: once the owner turns it on and sets EXPO_ACCESS_TOKEN, Expo accepts only signed sends.
    ...(Deno.env.get('EXPO_ACCESS_TOKEN') ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` } : {})
  };
}
// The receipt check (cron, 20270421): sends older than 15 minutes; a dead device clears its token and its business alert is
// emailed once (the database hands each recorded send out once). An Expo/network failure changes nothing (asked again later).
async function checkReceipts(admin) {
  const { data: due, error: dueError } = await admin.rpc('_push_receipts_due', { limit_param: 300 });
  if (dueError) return { checked: 0, error: 'not_installed' };
  const ids = (due ?? []).map((r) => r.ticket_id).filter(Boolean);
  if (!ids.length) return { checked: 0 };
  let receipts;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { checked: 0, error: `expo_${res.status}` };
    receipts = (await res.json())?.data;
  } catch (_e) {
    return { checked: 0, error: 'expo_unreachable' };
  }
  if (!receipts || typeof receipts !== 'object') return { checked: 0, error: 'expo_bad_reply' };
  let invalidated = 0;
  let emailed = 0;
  for (const id of ids) {
    const r = receipts[id];
    const outcome = !r ? 'pending' : r.status === 'ok' ? 'ok' : r.details?.error === DEAD_TOKEN_ERROR ? 'device_not_registered' : 'other_error';
    const { data: settled, error: settleError } = await admin.rpc('_settle_push_receipt', { ticket_id_param: id, outcome_param: outcome });
    if (settleError || !settled) continue;
    if (settled.invalidated) invalidated += 1;
    if (settled.email) {
      const e = await emailBusinessAlert(admin, settled.recipient_id, settled.email.title, settled.email.body, settled.email.data);
      if (e.emailed) emailed += 1;
    }
  }
  return { checked: ids.length, invalidated, emailed };
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
    const payload = await req.json();
    if (payload?.action === 'check_receipts') {
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      return new Response(JSON.stringify({ ok: true, ...(await checkReceipts(admin)) }), { headers: { 'Content-Type': 'application/json' } });
    }
    const { recipient_id, title, body, data } = payload;
    if (!recipient_id || !title) {
      return new Response(JSON.stringify({
        error: 'recipient_id and title are required'
      }), {
        status: 400
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // N1 (20270347): the token lives in private.push_tokens, read only through push_token_for_delivery (service role).
    // Fallback to the old profiles column only while that migration is not live (the function is missing).
    let pushToken = null;
    const { data: storedToken, error: tokenError } = await admin.rpc('push_token_for_delivery', { recipient_param: recipient_id });
    if (!tokenError) {
      pushToken = storedToken ?? null;
    } else {
      const { data: profile } = await admin.from('profiles').select('expo_push_token').eq('id', recipient_id).maybeSingle();
      pushToken = profile?.expo_push_token ?? null;
    }
    const notifPriority = notificationPriority(data?.type);
    if (!pushToken) {
      // Business Web parity: an owner who only uses the website has no push token. If they have a verified, enabled
      // email address (business_email_settings) send the same BUSINESS alert there (EMAIL_TYPES only).
      // No-op (and never an error) until the email provider is configured.
      const { emailed, emailReason } = await emailBusinessAlert(admin, recipient_id, title, body, data);
      return new Response(JSON.stringify({
        ok: true,
        skipped: 'no_token',
        emailed,
        emailReason
      }), {
        status: 200
      });
    }
    const delivery = PRIORITY_DELIVERY[notifPriority];
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data: data ?? {},
        ...delivery,
        ...(NOTIFICATION_ACTION_BY_TYPE[data?.type] ? { categoryId: `nearby_${NOTIFICATION_ACTION_BY_TYPE[data?.type]}` } : {}),
        ...replaceInPlace(data)
      })
    });
    const result = await pushResponse.json();
    // 20270421: one message = one ticket. Accepted -> recorded for the receipt check (a business alert with its words, so a
    // dead device can still be emailed once). Refused as DeviceNotRegistered -> the token is cleared and the alert emailed now.
    // Before 20270421 is live the calls fail quietly; nothing here changes the push itself or the response's shape.
    const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data;
    let tokenCleared = false;
    let emailed = false;
    try {
      if (ticket?.status === 'ok' && ticket.id) {
        const isAlert = EMAIL_TYPES.has(data?.type);
        await admin.rpc('_record_push_ticket', {
          ticket_id_param: String(ticket.id), recipient_id_param: recipient_id, token_param: pushToken,
          email_title_param: isAlert ? title : null, email_body_param: isAlert ? (body ?? '') : null,
          email_data_param: isAlert ? { type: data?.type, request_id: data?.request_id ?? null } : null,
        });
      } else if (ticket?.status === 'error' && ticket.details?.error === DEAD_TOKEN_ERROR) {
        const { data: cleared } = await admin.rpc('_invalidate_push_token', { recipient_id_param: recipient_id, token_param: pushToken });
        tokenCleared = cleared === true;
        emailed = (await emailBusinessAlert(admin, recipient_id, title, body, data)).emailed;
      }
    } catch (e) {
      console.warn('send-push: ticket bookkeeping failed (push unaffected)', String(e));
    }
    return new Response(JSON.stringify({
      ok: true,
      result,
      ...(tokenCleared ? { tokenCleared } : {}),
      ...(emailed ? { emailed } : {})
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
