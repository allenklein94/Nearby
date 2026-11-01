const { sessionIdFromAccessToken, stepUpRefusal, stepUpUnavailable, stepUpTarget, maskedTarget } = require('./accountStepUp');
const fs = require('fs');
const path = require('path');

const tok = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('20270375 step-up helpers', () => {
  test('reads the session id from an access token, nothing else', () => {
    expect(sessionIdFromAccessToken(tok({ session_id: 'abc-123', sub: 'u' }))).toBe('abc-123');
    expect(sessionIdFromAccessToken(tok({ sub: 'u' }))).toBeNull();
    expect(sessionIdFromAccessToken('garbage')).toBeNull();
    expect(sessionIdFromAccessToken(null)).toBeNull();
  });

  test('server refusals map to the person\'s own words; unknown = the ordinary error', () => {
    expect(stepUpRefusal({ hint: 'phone_change_wait' })).toBe('phoneChangeWait');
    expect(stepUpRefusal({ hint: 'account_on_hold' })).toBe('accountOnHold');
    expect(stepUpRefusal({ hint: 'rate_limited' })).toBe('stepUpRateLimited');
    expect(stepUpRefusal({ hint: 'step_up_required' })).toBe('stepUpFailed');
    expect(stepUpRefusal({ hint: 'something_else' })).toBeNull();
    expect(stepUpRefusal(null)).toBeNull();
  });

  test('before 0375 is live the app goes on as before', () => {
    expect(stepUpUnavailable({ code: 'PGRST202' })).toBe(true);
    expect(stepUpUnavailable({ message: 'Could not find the function public.begin_account_step_up' })).toBe(true);
    expect(stepUpUnavailable({ code: '42501' })).toBe(false);
  });

  test('the code goes to the account\'s phone, else its email; shown masked', () => {
    expect(stepUpTarget({ phone: '15615550181' })).toEqual({ phone: '+15615550181' });
    expect(stepUpTarget({ phone: '', email: 'a@b.co' })).toEqual({ email: 'a@b.co' });
    expect(stepUpTarget({})).toBeNull();
    expect(maskedTarget({ phone: '+15615550181' })).toBe('•••0181');
    expect(maskedTarget({ email: 'alex@example.com' })).toBe('a•••@example.com');
  });

  test('Settings begins the step-up BEFORE the code is sent and changes the number / deletes only after it', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/accountStepUp.js'), 'utf8');
    expect(svc.indexOf("rpc('begin_account_step_up'")).toBeLessThan(svc.indexOf('signInWithOtp'));
    expect(svc).toMatch(/shouldCreateUser: false/);
    const settings = fs.readFileSync(path.join(__dirname, '../screens/SettingsScreen.js'), 'utf8');
    const confirm = settings.slice(settings.indexOf('async function confirmStepUp'), settings.indexOf('async function startPhoneChange'));
    expect(confirm.indexOf('finishStepUp')).toBeLessThan(confirm.indexOf('startPhoneChange'));
    expect(confirm.indexOf('finishStepUp')).toBeLessThan(confirm.indexOf('runDeletion'));
  });
});
