// Recovered 2026-10-28 from the LIVE bundle (setup-review-account v8, Management API function-body endpoint): the deployed,
// type-stripped JavaScript, verbatim. Not redeployed. Its SUPABASE_SERVICE_ROLE_KEY is already the project's new secret key
// at runtime (digest compared 2026-10-28), so it does not depend on the legacy JWT secret.
// ONE change from the live bundle: the App Store reviewer's email is read from REVIEWER_EMAIL instead of being
// inline (this repository is public). Before ever redeploying this file, set that secret to the live value.
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const REVIEWER_PHONE = '+15555550199';
const REVIEWER_EMAIL = Deno.env.get('REVIEWER_EMAIL'); // live v8 has the address inline; kept out of this public repo
serve(async (req)=>{
  try {
    // Critical: this function creates or returns a known, pre-verified
    // demo account's exact userId, phone, and email — and was
    // previously callable by anyone with just the public anon key.
    // This should only ever run manually by you, during App Store
    // setup, so it now requires the service role key directly.
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: existingUsers } = await admin.auth.admin.listUsers();
    const existing = existingUsers?.users?.find((u)=>u.phone === REVIEWER_PHONE.replace('+', ''));
    let userId;
    if (existing) {
      userId = existing.id;
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        phone: REVIEWER_PHONE,
        phone_confirm: true,
        email: REVIEWER_EMAIL,
        email_confirm: true
      });
      if (createError || !created?.user) {
        return new Response(JSON.stringify({
          error: createError?.message
        }), {
          status: 500
        });
      }
      userId = created.user.id;
    }
    await admin.from('profiles').upsert({
      id: userId,
      display_name: 'App Reviewer',
      bio: 'Demo account for App Store review.',
      birthdate: '1995-01-01',
      photo_url: 'demo/placeholder.jpg',
      photo_verified: true,
      terms_accepted_at: new Date().toISOString()
    });
    return new Response(JSON.stringify({
      ok: true,
      userId
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
