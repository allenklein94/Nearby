// The shared Auth checks for 20270367 (run for real by scripts/replay/signup-hook-auth-local.js and, after the switch,
// src/qa/signupPhoneOnlyAuthApi.live.js): attribution and the probe address, plus a fake Auth that fails open.
const { refusedByHook, probeAddress, runSignupHookChecks, HOOK_MESSAGE } = require('./signupHookChecks');

describe('a refusal counts as the hook only with its own status AND message', () => {
  test('hook refusal yes; validation, rate limit, CAPTCHA, wrong status no', () => {
    expect(refusedByHook({ status: 403, message: HOOK_MESSAGE })).toBe(true);
    expect(refusedByHook({ status: 400, message: 'Unable to validate email address: invalid format' })).toBe(false);
    expect(refusedByHook({ status: 400, message: 'Email address "x@example.com" is invalid' })).toBe(false);
    expect(refusedByHook({ status: 429, message: 'email rate limit exceeded' })).toBe(false);
    expect(refusedByHook({ status: 400, message: 'captcha protection: request disallowed' })).toBe(false);
    expect(refusedByHook({ status: 422, message: HOOK_MESSAGE })).toBe(false);
    expect(refusedByHook(null)).toBe(false);
  });
  test('the probe is a valid new address on the test mailbox domain, else example.com', () => {
    expect(probeAddress('qa.person@outlook.com', 1)).toBe('qa.person+signup-hook-1@outlook.com');
    expect(probeAddress(null, 2)).toBe('signup-hook-2@example.com');
    expect(probeAddress('already+tag@x.com', 3)).toBe('signup-hook-3@example.com');
  });
});

describe('an Auth that does NOT run the hook fails the checks and is cleaned up', () => {
  test('fail-open sign-up = FAIL + the created account removed', async () => {
    const users = new Map();
    const ok = { data: {}, error: null };
    const auth = () => ({
      signUp: async ({ email }) => (email.includes('@') ? (users.set(email, `id-${users.size}`), ok) : { error: { status: 400, message: 'invalid format' } }),
      signInWithOtp: async () => ok,
      signOut: async () => ok,
    });
    const results = await runSignupHookChecks({
      auth, existing: null, phoneSignup: null,
      usersWithEmail: async (e) => (users.has(e) ? [users.get(e)] : []),
      deleteUser: async (id) => { for (const [k, v] of users) if (v === id) users.delete(k); },
    }, { now: 5 });
    const byName = Object.fromEntries(results.map((r) => [r.check, r.pass]));
    expect(byName['email sign-up (valid new address): refused by the hook']).toBe(false);
    expect(byName['email sign-up: no account created']).toBe(false);
    expect(byName['cleanup: no probe account left']).toBe(true);
    expect(users.size).toBe(0);
  });
});
