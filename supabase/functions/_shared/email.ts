// Minimal transactional-email adapter (Resend REST API). Deliberately provider-thin: one function, one env pair. Returns
// { sent: false, reason: 'email_not_configured' } when RESEND_API_KEY / EMAIL_FROM are unset so callers stay honest
// (nothing is stored, nothing is promised) until a real provider account is connected.
export function emailConfigured(): boolean {
  return !!(Deno.env.get('RESEND_API_KEY') && Deno.env.get('EMAIL_FROM'));
}

export async function sendEmail(to: string, subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!key || !from) return { sent: false, reason: 'email_not_configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!res.ok) return { sent: false, reason: `provider_error_${res.status}` };
  return { sent: true };
}
