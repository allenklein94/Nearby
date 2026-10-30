// Recovered 2026-10-28 from the LIVE bundle (review-login v6, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
// ONE change from the live bundle: the App Store reviewer's email is read from REVIEWER_EMAIL instead of being
// inline (this repository is public). Before ever redeploying this file, set that secret to the live value.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const REVIEW_LOGIN_PIN = Deno.env.get('REVIEW_LOGIN_PIN');
const REVIEWER_EMAIL = Deno.env.get('REVIEWER_EMAIL'); // live v6 has the address inline; kept out of this public repo
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
// 2026-10-30 (final gap audit, staged, NOT deployed): the per-IP limit keys on the FIRST x-forwarded-for entry, which a
// caller can set, so rotating it would allow unlimited PIN guesses. A GLOBAL cap on failed attempts (all callers) bounds
// brute force regardless of the address; the cost is that a flood can lock the reviewer login for the window, acceptable
// for a path used only during App Review. No PIN configured = the path is closed. Constant-time comparison.
const GLOBAL_MAX_FAILURES = 20;
function samePin(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for(let i = 0; i < Math.max(x.length, y.length); i++)diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
serve(async (req)=>{
  try {
    if (!REVIEW_LOGIN_PIN || !REVIEWER_EMAIL) {
      return new Response(JSON.stringify({
        error: 'Invalid code'
      }), {
        status: 401
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Rate-limit before checking the PIN at all (per address AND for all callers).
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    // 2026-10-30 (staged): RECORD FIRST, then count, then check the PIN. Counting first let N simultaneous guesses all see
    // the same count before any was recorded (the caps only held one request at a time). Now every request's own row is
    // already in the count, so the 21st request to record always sees >= 21 and is refused: at most GLOBAL_MAX_FAILURES
    // PIN checks per window however requests interleave (and MAX_ATTEMPTS per address). A refused request removes its own
    // row (the table stays bounded under a flood; rows that reached the PIN check stay); a correct PIN removes its own row.
    // Cannot record = closed.
    const { data: attempt, error: recordError } = await admin.from('review_login_attempts').insert({
      ip_address: ip
    }).select('id').single();
    if (recordError || !attempt) {
      return new Response(JSON.stringify({
        error: 'Try again later.'
      }), {
        status: 503
      });
    }
    const { count } = await admin.from('review_login_attempts').select('id', {
      count: 'exact',
      head: true
    }).eq('ip_address', ip).gte('attempted_at', windowStart);
    const { count: allAttempts } = await admin.from('review_login_attempts').select('id', {
      count: 'exact',
      head: true
    }).gte('attempted_at', windowStart);
    if (count == null || allAttempts == null || count > MAX_ATTEMPTS || allAttempts > GLOBAL_MAX_FAILURES) {
      await admin.from('review_login_attempts').delete().eq('id', attempt.id);
      return new Response(JSON.stringify({
        error: 'Too many attempts. Try again later.'
      }), {
        status: 429
      });
    }
    const { pin } = await req.json();
    if (!pin || !samePin(pin, REVIEW_LOGIN_PIN)) {
      return new Response(JSON.stringify({
        error: 'Invalid code'
      }), {
        status: 401
      });
    }
    await admin.from('review_login_attempts').delete().eq('id', attempt.id);
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: REVIEWER_EMAIL
    });
    if (error || !data) {
      return new Response(JSON.stringify({
        error: error?.message
      }), {
        status: 500
      });
    }
    return new Response(JSON.stringify({
      email: REVIEWER_EMAIL,
      tokenHash: data.properties.hashed_token
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
