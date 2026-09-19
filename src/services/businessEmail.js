import { supabase, functionUrl } from './supabase';

// Business owner email notifications (20261208_business_email_notifications.sql + business-email Edge Function). Lets a
// website-only owner (no phone push token) still get Important-tier alerts by email. Address is verified with a 6-digit code.

async function callBusinessEmail(payload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Not signed in');
  const response = await fetch(functionUrl('business-email'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error ?? 'Something went wrong. Please try again.');
  return result;
}

// { email, verified, enabled } or null when no address is saved.
export async function getMyBusinessEmailSettings() {
  const { data, error } = await supabase.rpc('get_my_business_email_settings');
  if (error) throw new Error(error.message);
  return data ?? null;
}

// { ok: true } or { ok: false, reason: 'email_not_configured' | provider_error_* }
export const startBusinessEmailVerification = (email) => callBusinessEmail({ action: 'start', email });
// { ok: true } or { ok: false, reason: 'wrong_code' | 'code_expired' | 'too_many_attempts' }
export const confirmBusinessEmail = (code) => callBusinessEmail({ action: 'confirm', code });
export const removeBusinessEmail = () => callBusinessEmail({ action: 'remove' });

export async function setBusinessEmailEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_business_email_enabled', { enabled_param: enabled });
  if (error) throw new Error(error.message);
}

const REASON_COPY = {
  email_not_configured: "Email alerts aren't switched on for Nearby yet. Phone notifications still work.",
  wrong_code: "That code doesn't match. Check it and try again.",
  code_expired: 'That code has expired. Send a new one.',
  too_many_attempts: 'Too many tries. Send a new code.',
};
export function businessEmailReasonCopy(reason) {
  return REASON_COPY[reason] || "We couldn't send that right now. Please try again in a moment.";
}
