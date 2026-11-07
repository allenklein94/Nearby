// Manual appeals (owner, 2026-11-07): suspension, recovery hold and admin pause messages tell the person how to ask for a
// review, through ONE support address that is shown only once configured AND verified. No screen, no automated appeals.
const mockSupport = { email: null, verified: false };
jest.mock('../constants/support', () => ({
  get SUPPORT_EMAIL() { return mockSupport.email; },
  get SUPPORT_EMAIL_VERIFIED() { return mockSupport.verified; },
}));

const fs = require('fs');
const path = require('path');
const { supportEmail, reviewRequestLine, isSignInBlocked } = require('./accountReview');
const { recoverableErrorCopy, accountRuleMessage } = require('./recoverableError');
const { restrictionRefusal, restrictionRefusalMessage } = require('./accountRestrictions');
const { setCurrentLanguage } = require('../i18n/translate');

const ADDRESS = 'appeals@example.test';
const paused = { hint: 'account_restricted', details: '{"capability":"messages","until":"2026-11-10T22:27:36Z"}' };
const banned = { code: 'user_banned', status: 403, message: 'User is banned' };

beforeEach(() => { mockSupport.email = null; mockSupport.verified = false; setCurrentLanguage('en'); });

describe('the support address', () => {
  test('the shipped config shows no address (none configured or verified yet)', () => {
    const real = jest.requireActual('../constants/support');
    expect(real.SUPPORT_EMAIL).toBeNull();
    expect(real.SUPPORT_EMAIL_VERIFIED).toBe(false);
    expect(supportEmail({ email: real.SUPPORT_EMAIL, verified: real.SUPPORT_EMAIL_VERIFIED })).toBeNull();
  });
  test('shown only when configured AND verified AND a real address', () => {
    expect(supportEmail({ email: ADDRESS, verified: false })).toBeNull();
    expect(supportEmail({ email: '', verified: true })).toBeNull();
    expect(supportEmail({ email: 'not an address', verified: true })).toBeNull();
    expect(supportEmail({ email: ` ${ADDRESS} `, verified: true })).toBe(ADDRESS);
  });
  test('no address = no review line anywhere (never a placeholder or a made-up address)', () => {
    expect(reviewRequestLine()).toBeNull();
    expect(accountRuleMessage('account_suspended')).toBe("This account is suspended, so it can't message, invite, connect or host.");
    expect(restrictionRefusalMessage(restrictionRefusal(paused), () => 'November 10')).toBe(
      'Nearby paused this on your account after a review. Available again: November 10. Everything else works as usual.');
    const copy = recoverableErrorCopy({ what: 'complete that', error: banned });
    expect(copy.message).not.toMatch(/@|\{email\}/);
  });
  test('no source file hard-codes a support address of its own', () => {
    const root = path.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(root).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => /['"`][^'"`\s]*support@[^'"`\s]*['"`]|mailto:/i.test(fs.readFileSync(f, 'utf8')));
    expect(hits.map((f) => path.relative(root, f))).toEqual([]);
  });
});

describe('with a configured + verified address', () => {
  beforeEach(() => { mockSupport.email = ADDRESS; mockSupport.verified = true; });
  const line = `If you think this is a mistake, email ${ADDRESS} with the phone number on your account to ask for a review.`;

  test('suspension says how to ask for a review', () => {
    expect(accountRuleMessage('account_suspended')).toBe(`This account is suspended, so it can't message, invite, connect or host. ${line}`);
    expect(recoverableErrorCopy({ what: 'send that', error: { hint: 'account_suspended' } })).toMatchObject({ canRetry: false, message: expect.stringContaining(line) });
  });
  test("an admin's pause says until when AND how to ask for a review (every path, incl. the chat composer)", () => {
    const msg = restrictionRefusalMessage(restrictionRefusal(paused), () => 'November 10');
    expect(msg).toBe(`Nearby paused this on your account after a review. Available again: November 10. Everything else works as usual. ${line}`);
    expect(recoverableErrorCopy({ what: 'send that', error: paused }).message).toContain(line);
  });
  test('ordinary limits are not appealable decisions: no review line', () => {
    for (const hint of ['rate_limited', 'gathering_limit', 'friend_request_limit', 'phone_required', 'offer_contact_info']) {
      expect(accountRuleMessage(hint)).not.toContain(ADDRESS);
    }
  });
  test('sign-in refused for a suspended / held account: plain words + the review line, no Try Again, shown signed out', () => {
    expect(isSignInBlocked(banned)).toBe(true);
    expect(isSignInBlocked({ message: 'Invalid Refresh Token: User Banned' })).toBe(true);
    expect(isSignInBlocked({ code: 'otp_expired', message: 'Token has expired' })).toBe(false);
    const copy = recoverableErrorCopy({ what: 'complete that', error: banned });
    expect(copy.canRetry).toBe(false);
    expect(copy.message).toBe(`This account can't sign in right now. It has been suspended, or it is on hold while an account problem is checked. ${line}`);
    expect(copy.message).not.toMatch(/User is banned/);
  });
  test('in the person\'s language, with the address unchanged', () => {
    setCurrentLanguage('es');
    expect(accountRuleMessage('account_suspended')).toContain(`escribe a ${ADDRESS}`);
  });
  test('every language has both strings with the {email} slot', () => {
    const shared = require('../i18n/ui/shared').default;
    for (const [lang, ui] of Object.entries(shared)) {
      expect([lang, typeof ui.errors.signInBlocked, (ui.errors.requestReview || '').includes('{email}')]).toEqual([lang, 'string', true]);
    }
  });
});

describe('wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('both sign-in paths on the signed-out Login screen reach the shared copy', () => {
    const login = src('screens/LoginScreen.js');
    expect(login).toMatch(/isSignInBlocked\(verifyError\)/);
    expect(login).toMatch(/verifyOtp\(\{\s*phone: e164Phone[\s\S]*?presentRecoverableError/);
  });
  test('the chat composer uses the one account-rule wording', () => {
    expect(src('hooks/useChatComposer.js')).toMatch(/accountRuleMessage\(e\?\.hint\)/);
  });
});
