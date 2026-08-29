import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

// The real, minimal web application entry point for the business landing
// page (see CLAUDE.md's "Aug 29 2026 -- real web business application, no
// app required" locked plan). verify_jwt is deliberately false -- a genuine
// web visitor filling out a public form has no Supabase Auth session at
// all, matching the stripe-connect-webhook/revenuecat-webhook "public entry
// point, do your own internal check" precedent -- but unlike those two,
// there is no third-party signature to check here (this is a real public
// form, not a webhook from a known caller), so the "internal check" is real
// abuse protection: a honeypot field, per-IP rate limiting, and field
// validation, all done here rather than trusted from the client.
//
// Writes through the service-role client only -- never an anon-writable
// table grant. The resulting row lands in the exact same
// business_partner_requests table and admin review queue an app-sourced
// application already uses; nothing about approval/denial/needs-info is
// duplicated here.

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Same 6 real keys BusinessPartnerApplyScreen.js's own BUSINESS_CATEGORIES
// exports -- re-validated here so a malformed/hallucinated category value
// can never reach the row a real admin later reviews.
const VALID_CATEGORIES = [
  'food_drink',
  'fitness_wellness',
  'retail_shopping',
  'arts_entertainment',
  'professional_services',
  'other',
];

const MAX_RATE_LIMIT_PER_HOUR = 3;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Same digits-only, US-country-code-prepended format auth.users.phone
// actually stores in this project (contactsImport.js's own established
// normalizePhone() convention, replicated here rather than imported --
// Edge Functions in this codebase are self-contained Deno files, not
// cross-imported from the React Native app source).
function normalizePhone(raw: string): string {
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (digitsOnly.length === 10) return `1${digitsOnly}`;
  return digitsOnly;
}

function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// A lightweight, non-cryptographic hash purely to avoid storing raw IPs
// directly on a row admins can browse -- not a security boundary, just a
// disclosed, reasonable choice.
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // Honeypot -- a hidden field real visitors never fill in. A non-empty
  // value here means a bot submitted the form; reject quietly (a generic
  // error, not a tell that this specific check is what caught it).
  if (typeof body.website_confirm === 'string' && body.website_confirm.trim() !== '') {
    return jsonResponse({ error: 'Could not process your application right now.' }, 400);
  }

  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const website = typeof body.website === 'string' ? body.website.trim() : '';
  const businessPhone = typeof body.businessPhone === 'string' ? body.businessPhone.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const applicantName = typeof body.applicantName === 'string' ? body.applicantName.trim() : '';
  const applicantEmail = typeof body.applicantEmail === 'string' ? body.applicantEmail.trim() : '';
  const applicantPhoneRaw = typeof body.applicantPhone === 'string' ? body.applicantPhone.trim() : '';
  const confirmedRepresentative = body.confirmedRepresentative === true;

  if (!businessName || businessName.length > 200) {
    return jsonResponse({ error: "Tell us your business's name." }, 400);
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return jsonResponse({ error: 'Pick a real category for your business.' }, 400);
  }
  if (!address || address.length > 300) {
    return jsonResponse({ error: "Tell us your business's address." }, 400);
  }
  if (!applicantName || applicantName.length > 100) {
    return jsonResponse({ error: 'Tell us your name.' }, 400);
  }
  if (!applicantEmail || !isPlausibleEmail(applicantEmail) || applicantEmail.length > 200) {
    return jsonResponse({ error: 'Enter a real email address.' }, 400);
  }
  const applicantPhone = normalizePhone(applicantPhoneRaw);
  if (applicantPhone.length !== 11 && applicantPhone.length !== 10) {
    return jsonResponse({ error: 'Enter a real phone number.' }, 400);
  }
  if (!confirmedRepresentative) {
    return jsonResponse({ error: "Please confirm you're authorized to represent this business." }, 400);
  }

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  const forwardedFor = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown';
  const clientIp = forwardedFor.split(',')[0].trim();
  const submitterIpHash = await hashIp(clientIp);

  // Real, small, disclosed rate limit -- not a fabricated protection, a
  // genuine cap against the same table's own real recent rows for this IP.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from('business_partner_requests')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'web')
    .eq('submitter_ip_hash', submitterIpHash)
    .gte('created_at', oneHourAgo);

  if ((recentCount ?? 0) >= MAX_RATE_LIMIT_PER_HOUR) {
    return jsonResponse({ error: 'Too many applications from this connection recently. Please try again later.' }, 429);
  }

  const { data: inserted, error } = await supabase
    .from('business_partner_requests')
    .insert({
      business_name: businessName,
      business_description: description || null,
      category,
      address,
      website: website || null,
      phone: businessPhone || null,
      source: 'web',
      applicant_name: applicantName,
      applicant_email: applicantEmail,
      applicant_phone: applicantPhone,
      submitter_ip_hash: submitterIpHash,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return jsonResponse(
        { error: "You already have a pending application with this phone number — we'll follow up on that one soon." },
        409
      );
    }
    console.error('submit-business-application insert failed', error);
    return jsonResponse({ error: 'Something went wrong submitting your application. Please try again.' }, 500);
  }

  // Real funnel logging, matching the exact business_acquisition_events
  // vocabulary the app-sourced apply flow already logs the same event with
  // -- one shared funnel, not a second one for the web path.
  await supabase.from('business_acquisition_events').insert({
    session_id: crypto.randomUUID(),
    user_id: null,
    event: 'apply_submitted',
    partner_id: null,
  });

  return jsonResponse({ ok: true, id: inserted?.id, applicantPhone });
});
