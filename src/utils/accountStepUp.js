// The app's side of 20270375's step-up (D1/D2). Before a number change or a deletion the person confirms with a FRESH sign-in
// code to the account's current number (email accounts: their email). Auth verifies that code (also with Twilio Verify); the
// server ties the fresh session to the established session that began the step-up and deletes it again. Pure helpers only;
// the calls live in services/accountStepUp.js. The SERVER decides everything (begin / complete / the auth.users guard).

// The session id inside an access token (already issued by Auth; only read, never trusted for anything by the app).
export function sessionIdFromAccessToken(token) {
  try {
    const part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function'
      ? atob(part + '='.repeat((4 - (part.length % 4)) % 4))
      : Buffer.from(part, 'base64').toString('utf8');
    const id = JSON.parse(json).session_id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

// What the person is told when the server refuses (its hint), as a translation key. Unknown = null (the caller shows its
// ordinary recoverable error).
const REFUSALS = {
  phone_change_wait: 'phoneChangeWait',
  account_on_hold: 'accountOnHold',
  mfa_required: 'accountOnHold',
  rate_limited: 'stepUpRateLimited',
  step_up_failed: 'stepUpFailed',
  step_up_unknown: 'stepUpFailed',
  step_up_required: 'stepUpFailed',
  session_unknown: 'stepUpFailed',
};
export function stepUpRefusal(error) {
  return (error && REFUSALS[error.hint]) || null;
}

// 20270375 not live yet (the function doesn't exist): the app goes on exactly as before.
export function stepUpUnavailable(error) {
  return !!error && (error.code === 'PGRST202' || /Could not find the function/i.test(error.message || ''));
}

// Where the code goes: the account's phone, else its email. Nothing = no step-up possible (the server then refuses).
export function stepUpTarget(user) {
  if (user?.phone) return { phone: user.phone.startsWith('+') ? user.phone : `+${user.phone}` };
  if (user?.email) return { email: user.email };
  return null;
}

// "•••0181" (or "a•••@example.com") for the message: never the whole number or address.
export function maskedTarget(target) {
  if (target?.phone) return `•••${target.phone.replace(/\D/g, '').slice(-4)}`;
  if (target?.email) {
    const [name, domain] = target.email.split('@');
    return `${name.slice(0, 1)}•••@${domain}`;
  }
  return '';
}
