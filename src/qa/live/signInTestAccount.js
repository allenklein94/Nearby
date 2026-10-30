// Sign the DEDICATED live-test account in on a supabase-js client, also once Auth CAPTCHA (Turnstile) is on.
// Password sign-in is tried first (today). When Auth refuses it for a missing CAPTCHA token, or when
// NEARBY_TEST_SIGNIN=link forces it, the session comes from a server-issued magic link instead: the service key (from
// NEARBY_SERVICE_ROLE_KEY, else read via the Management API with SUPABASE_ACCESS_TOKEN, never printed) asks Auth's admin API
// for a one-time link token, which the client verifies (verification is not CAPTCHA-gated). No email is sent; nothing but
// Auth's own sign-in bookkeeping is written. Never the owner's primary account.
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const REF = 'enmosvippabmuqslzrox';

async function serviceKey() {
  if (process.env.NEARBY_SERVICE_ROLE_KEY) return process.env.NEARBY_SERVICE_ROLE_KEY;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('CAPTCHA is on: set SUPABASE_ACCESS_TOKEN (or NEARBY_SERVICE_ROLE_KEY) for the link sign-in');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`api-keys: HTTP ${res.status}`);
  const keys = await res.json();
  const k = keys.find((x) => x.type === 'secret' && x.api_key) || keys.find((x) => x.name === 'service_role' && x.api_key);
  if (!k) throw new Error('no service key available');
  return k.api_key;
}

const isCaptcha = (e) => e && (e.code === 'captcha_failed' || /captcha/i.test(String(e.message ?? '')));

async function signInTestAccount(client, { email, password }) {
  if (process.env.NEARBY_TEST_SIGNIN !== 'link') {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return { user: data.user, via: 'password' };
    if (!isCaptcha(error)) throw new Error(`sign in: ${error.message}`);
  }
  const admin = createClient(URL, await serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError) throw new Error(`link: ${linkError.message}`);
  const { data, error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (error) throw new Error(`link sign in: ${error.message}`);
  return { user: data.user, via: 'link' };
}

module.exports = { signInTestAccount, serviceKeyForCleanup: serviceKey };
