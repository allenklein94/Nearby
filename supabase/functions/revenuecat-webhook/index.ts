// Recovered 2026-10-28 from the LIVE bundle (revenuecat-webhook v2, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET");
// Event types that mean the person genuinely has active premium access
const GRANTS_PREMIUM = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "PRODUCT_CHANGE"
]);
// Only EXPIRATION means access actually ends. CANCELLATION alone
// does not — someone who cancels still has access until their
// current paid period genuinely runs out, which RevenueCat then
// reports separately as EXPIRATION.
const REVOKES_PREMIUM = new Set([
  "EXPIRATION"
]);
Deno.serve(async (req)=>{
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405
    });
  }
  if (WEBHOOK_SECRET) {
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
  }
  let payload;
  try {
    payload = await req.json();
  } catch  {
    return new Response("Invalid JSON", {
      status: 400
    });
  }
  const event = payload?.event;
  if (!event) {
    return new Response("Missing event", {
      status: 400
    });
  }
  const eventType = event.type;
  const userId = event.app_user_id;
  if (!userId) {
    return new Response("Missing app_user_id", {
      status: 400
    });
  }
  // Events we don't need to act on (billing issues, transfers, etc.)
  // are acknowledged with 200 so RevenueCat doesn't retry them
  // forever, but we don't touch is_premium for them.
  if (!GRANTS_PREMIUM.has(eventType) && !REVOKES_PREMIUM.has(eventType)) {
    return new Response(JSON.stringify({
      received: true,
      action: "none"
    }), {
      status: 200
    });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const newPremiumStatus = GRANTS_PREMIUM.has(eventType);
  // A single atomic RPC call, restricted to the service_role only —
  // it sets the trusted-update flag and performs the update within
  // the same function invocation, so the flag genuinely applies
  // rather than risking being lost between two separate requests.
  const { error } = await supabase.rpc("set_premium_status", {
    user_id_param: userId,
    new_status: newPremiumStatus
  });
  if (error) {
    console.error("Failed to update is_premium:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500
    });
  }
  return new Response(JSON.stringify({
    received: true,
    user_id: userId,
    event_type: eventType,
    is_premium: newPremiumStatus
  }), {
    status: 200
  });
});
/* esm.sh - @supabase/supabase-js@2.111.0 */
