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
serve(async (req)=>{
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    // Rate-limit by IP before checking the PIN at all — without
    // this, the PIN could be brute-forced by simply calling this
    // endpoint repeatedly with different values, since there was
    // previously no limit on attempts.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
    const { count } = await admin.from('review_login_attempts').select('id', {
      count: 'exact',
      head: true
    }).eq('ip_address', ip).gte('attempted_at', windowStart);
    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return new Response(JSON.stringify({
        error: 'Too many attempts. Try again later.'
      }), {
        status: 429
      });
    }
    const { pin } = await req.json();
    if (!pin || pin !== REVIEW_LOGIN_PIN) {
      await admin.from('review_login_attempts').insert({
        ip_address: ip
      });
      return new Response(JSON.stringify({
        error: 'Invalid code'
      }), {
        status: 401
      });
    }
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
