// Recovered 2026-10-28 from the LIVE bundle (get-online-status v3, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ONLINE_THRESHOLD_MINUTES = 5;
serve(async (req)=>{
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({
        error: 'Missing auth'
      }), {
        status: 401
      });
    }
    const supabaseAuth = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({
        error: 'Invalid session'
      }), {
        status: 401
      });
    }
    const myId = userData.user.id;
    const { userIds } = await req.json();
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return new Response(JSON.stringify({
        statuses: {}
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Only reveal online status for people the caller is genuinely
    // connected to (matches or accepted friends) — without this,
    // any authenticated user could check the live online status of
    // literally anyone, with no relationship to them required,
    // which is a real stalking-adjacent privacy risk.
    const { data: matches } = await admin.from('matches').select('user_a, user_b').or(`user_a.eq.${myId},user_b.eq.${myId}`);
    const { data: friends } = await admin.from('friendships').select('user_a, user_b').eq('status', 'accepted').or(`user_a.eq.${myId},user_b.eq.${myId}`);
    const connectedIds = new Set();
    for (const m of matches ?? [])connectedIds.add(m.user_a === myId ? m.user_b : m.user_a);
    for (const f of friends ?? [])connectedIds.add(f.user_a === myId ? f.user_b : f.user_a);
    const allowedUserIds = userIds.filter((id)=>connectedIds.has(id));
    if (allowedUserIds.length === 0) {
      return new Response(JSON.stringify({
        statuses: {}
      }), {
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data, error } = await admin.from('presence_reports').select('user_id').in('user_id', allowedUserIds).gte('reported_at', threshold);
    if (error) {
      return new Response(JSON.stringify({
        error: error.message
      }), {
        status: 500
      });
    }
    const onlineSet = new Set((data ?? []).map((r)=>r.user_id));
    const statuses = Object.fromEntries(allowedUserIds.map((id)=>[
        id,
        onlineSet.has(id)
      ]));
    return new Response(JSON.stringify({
      statuses
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
