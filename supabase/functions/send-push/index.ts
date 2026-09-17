import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
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
  'aggregated_demand_growing',
  'occasion_demand_growing',
  'community_area_demand_growing',
  'group_intent_signal'
]);
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
    if (!profile?.expo_push_token) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: 'no_token'
      }), {
        status: 200
      });
    }
    const tier = notificationTier(data?.type);
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
        channelId: isImportant ? 'important-alerts' : 'recommendations'
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
