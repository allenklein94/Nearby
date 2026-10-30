// New accounts only by phone (20270367): the Auth API checks, written ONCE and run against two targets:
//   - an isolated local Supabase Auth (the production version) + Postgres + a mail catcher: scripts/replay/signup-hook-auth-local.sh
//   - production, only after 0367 is deployed AND the hook is switched on (src/qa/signupPhoneOnlyAuthApi.live.js).
// Attribution: a refusal counts as the hook's only when Auth returns the hook's http_code (403) AND its exact message.
// Format validation, rate limits, CAPTCHA or a blocked domain answer with other statuses/messages, so they FAIL a check,
// never pass it; the negative control below proves such a refusal is told apart.
const HOOK_MESSAGE = 'New Nearby accounts are created with a phone number in the Nearby app.';

const refusedByHook = (error) => Boolean(error) && error.status === 403 && error.message === HOOK_MESSAGE;
const describeError = (error) => (error ? { status: error.status, code: error.code, message: error.message } : null);

// A syntactically valid NEW address on a real, accepted domain: the dedicated test account's own mailbox with a
// "+signup-hook-<time>" tag (a distinct address to Auth). If the hook ever failed open, the only mail it could cause goes
// to that same test mailbox. No test account = a reserved example.com address (never delivered).
function probeAddress(existingEmail, now = Date.now()) {
  const tag = `signup-hook-${now}`;
  if (existingEmail && /^[^@+\s]+@[^@\s]+\.[^@\s]+$/.test(existingEmail)) {
    const [local, domain] = existingEmail.split('@');
    return `${local}+${tag}@${domain}`;
  }
  return `${tag}@example.com`;
}

// target = {
//   auth(): a fresh auth client (signUp, signInWithOtp, signInWithPassword, verifyOtp, resetPasswordForEmail, signOut),
//   usersWithEmail(email) -> [ids], deleteUser(id), magicLinkHash(email) -> hashed_token (admin generateLink),
//   existing: { email, password } | null, phoneSignup: { phone, otp } | null (local only: a test OTP, never a real SMS),
//   recovery: bool, mailTo(email) -> count | undefined (local mail catcher only) }
// Returns [{ check, pass, detail }]. Leaves nothing behind: any account the probe address got is deleted by its exact address.
async function runSignupHookChecks(target, { now = Date.now() } = {}) {
  const out = [];
  const record = (check, pass, detail) => out.push({ check, pass: Boolean(pass), detail });
  const probe = probeAddress(target.existing?.email, now);
  try {
    // Negative control: a malformed address is refused BEFORE the hook, and the attribution test says "not the hook".
    const bad = await target.auth().signUp({ email: `not-an-email-${now}`, password: `Pw-${now}-long!` });
    record('control: malformed address refused by validation, not attributed to the hook',
      bad.error && !refusedByHook(bad.error), describeError(bad.error));

    const signUp = await target.auth().signUp({ email: probe, password: `Pw-${now}-long!` });
    const afterSignUp = await target.usersWithEmail(probe);
    record('email sign-up (valid new address): refused by the hook', refusedByHook(signUp.error), describeError(signUp.error));
    record('email sign-up: no account created', afterSignUp.length === 0, { accounts: afterSignUp.length });

    const otp = await target.auth().signInWithOtp({ email: probe, options: { shouldCreateUser: true } });
    const afterOtp = await target.usersWithEmail(probe);
    record('email code / magic link to the new address: refused by the hook', refusedByHook(otp.error), describeError(otp.error));
    record('email code: no account created', afterOtp.length === 0, { accounts: afterOtp.length });

    if (target.mailTo) {
      const sent = await target.mailTo(probe);
      record('no email sent to the new address', sent === 0, { messages: sent });
    }

    if (target.phoneSignup) { // positive control: the same hook lets a phone account through, end to end
      const { phone, otp: code } = target.phoneSignup;
      const sent = await target.auth().signInWithOtp({ phone });
      const client = target.auth();
      const verified = sent.error ? null : await client.verifyOtp({ phone, token: code, type: 'sms' });
      record('control: new phone account created through phone OTP',
        !sent.error && verified && !verified.error && verified.data?.user?.phone === phone.replace(/^\+/, ''),
        { send: describeError(sent.error), verify: describeError(verified?.error), phone: verified?.data?.user?.phone });
      await client.signOut();
    }

    if (target.existing) {
      const { email, password } = target.existing;
      const pw = target.auth();
      const byPassword = await pw.signInWithPassword({ email, password });
      record('existing email account: password sign-in still works', !byPassword.error && byPassword.data?.user?.email === email, describeError(byPassword.error));
      await pw.signOut();
      const link = target.auth();
      const byLink = await link.verifyOtp({ token_hash: await target.magicLinkHash(email), type: 'magiclink' });
      record('existing email account: server-issued magic link (App Review / review-login path) still works',
        !byLink.error && byLink.data?.user?.email === email, describeError(byLink.error));
      await link.signOut();
      if (target.recovery) {
        const before = target.mailTo ? await target.mailTo(email) : undefined;
        const reset = await target.auth().resetPasswordForEmail(email);
        const after = target.mailTo ? await target.mailTo(email) : undefined;
        record('existing email account: password recovery still sends', !reset.error && (before === undefined || after === before + 1),
          { error: describeError(reset.error), mailBefore: before, mailAfter: after });
      }
    }
  } finally {
    for (const id of await target.usersWithEmail(probe)) await target.deleteUser(id);
    const left = await target.usersWithEmail(probe);
    record('cleanup: no probe account left', left.length === 0, { accounts: left.length });
  }
  return out;
}

module.exports = { HOOK_MESSAGE, refusedByHook, probeAddress, runSignupHookChecks };
