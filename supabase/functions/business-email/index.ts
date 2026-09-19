import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';
import { emailConfigured, sendEmail } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CODE_TTL_MS = 30 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Business owner email notifications: { action: 'start', email } sends a 6-digit code, { action: 'confirm', code }
// verifies it, { action: 'remove' } deletes the address. send-push emails only a verified + enabled address.
serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing auth' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userError } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !userData?.user) return json({ error: 'Invalid session' }, 401);
    const myId = userData.user.id;

    const { data: profile } = await admin.from('profiles').select('managed_partner_id').eq('id', myId).single();
    if (!profile?.managed_partner_id) return json({ error: 'Only a business owner can do this' }, 403);

    const body = await req.json();

    if (body.action === 'remove') {
      await admin.from('business_email_settings').delete().eq('user_id', myId);
      return json({ ok: true });
    }

    if (body.action === 'start') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'Enter a valid email address' }, 400);
      if (!emailConfigured()) return json({ ok: false, reason: 'email_not_configured' });

      const { data: existing } = await admin.from('business_email_settings').select('code_sent_at').eq('user_id', myId).maybeSingle();
      if (existing?.code_sent_at && Date.now() - new Date(existing.code_sent_at).getTime() < RESEND_COOLDOWN_MS) {
        return json({ error: 'Please wait a minute before requesting another code' }, 429);
      }

      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const sent = await sendEmail(email, 'Your Nearby verification code', `Your Nearby business email verification code is ${code}. It expires in 30 minutes. If you didn't ask for this, ignore this email.`);
      if (!sent.sent) return json({ ok: false, reason: sent.reason });

      const { error } = await admin.from('business_email_settings').upsert({
        user_id: myId, email, verified_at: null, code_hash: await sha256(`${myId}:${code}`),
        code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(), code_attempts: 0,
        code_sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: 'Could not save this address' }, 500);
      return json({ ok: true });
    }

    if (body.action === 'confirm') {
      const code = String(body.code || '').trim();
      const { data: row } = await admin.from('business_email_settings').select('*').eq('user_id', myId).maybeSingle();
      if (!row?.code_hash || !row.code_expires_at || new Date(row.code_expires_at).getTime() < Date.now()) {
        return json({ ok: false, reason: 'code_expired' });
      }
      if (row.code_attempts >= MAX_ATTEMPTS) return json({ ok: false, reason: 'too_many_attempts' });
      if ((await sha256(`${myId}:${code}`)) !== row.code_hash) {
        await admin.from('business_email_settings').update({ code_attempts: row.code_attempts + 1 }).eq('user_id', myId);
        return json({ ok: false, reason: 'wrong_code' });
      }
      await admin.from('business_email_settings').update({
        verified_at: new Date().toISOString(), code_hash: null, code_expires_at: null, code_attempts: 0, enabled: true, updated_at: new Date().toISOString(),
      }).eq('user_id', myId);
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
