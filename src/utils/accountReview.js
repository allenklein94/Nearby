// Manual appeals (owner, 2026-11-07): a suspended account, a recovery hold or an admin's pause always tells the person how to
// ask for a review, using the ONE support address (constants/support.js). No address configured + verified = no line at all.
// No appeal screen, no automated appeals: an admin reviews by hand and reverses with the existing controls.
import { tr } from '../i18n/translate';
import { SUPPORT_EMAIL, SUPPORT_EMAIL_VERIFIED } from '../constants/support';

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

export function supportEmail(config = { email: SUPPORT_EMAIL, verified: SUPPORT_EMAIL_VERIFIED }) {
  const email = typeof config?.email === 'string' ? config.email.trim() : '';
  return config?.verified === true && EMAIL.test(email) ? email : null;
}

export function reviewRequestLine(config) {
  const email = supportEmail(config);
  return email ? tr('ui.shared.errors.requestReview', { email }) : null;
}

export function withReviewLine(message, config) {
  const line = reviewRequestLine(config);
  return line ? `${message} ${line}` : message;
}

// Supabase Auth refuses a banned account (0351 suspension, 0375 recovery hold) on verify / sign-in / refresh.
export function isSignInBlocked(error) {
  if (!error) return false;
  if (error.code === 'user_banned') return true;
  return /\buser (is )?banned\b/i.test(String(error.message ?? ''));
}
