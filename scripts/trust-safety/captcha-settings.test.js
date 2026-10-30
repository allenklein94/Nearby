const { lockoutCheck, approvalCode } = require('./captcha-settings');
const b5 = require('./b5-auth-settings');

describe('CAPTCHA switch: never locks out a device that cannot send a token', () => {
  const s = (ua) => ({ ua, last: '2026-10-30' });
  test('older app builds, unknown clients and website sessions are found; our own scripts are not', () => {
    const c = lockoutCheck([s('Nearby/86 CFNetwork/3860'), s('Nearby/88 CFNetwork/3860'), s('Mozilla/5.0 (iPhone)'), s('node'), s('okhttp/4.9'), s(null)], 88);
    expect(c.oldBuilds.map((x) => x.ua)).toEqual(['Nearby/86 CFNetwork/3860']);
    expect(c.web).toHaveLength(1);
    expect(c.unknown.map((x) => x.ua)).toEqual(['okhttp/4.9', null]);
  });
  test('no minimum build = every app build counts as old', () => {
    expect(lockoutCheck([s('Nearby/99 x')], NaN).oldBuilds).toHaveLength(1);
  });
  test('the approval code binds the minimum build and the exact site key', () => {
    const cfg = { siteKey: '0x4AAAAAAAB1234567890abc', host: 'https://allenklein94.github.io' };
    expect(approvalCode(88, cfg)).toMatch(/^captcha:[0-9a-f]{32}$/);
    expect(approvalCode(88, cfg)).not.toBe(approvalCode(87, cfg));
    expect(approvalCode(88, cfg)).not.toBe(approvalCode(88, { ...cfg, siteKey: '0x4AAAAAAAB000000000000' }));
  });
});

describe('B5 password settings: exactly the three approved keys', () => {
  test('the change and its approval code are fixed', () => {
    expect(b5.PROPOSED).toEqual({ password_min_length: 10, security_update_password_require_reauthentication: true, mailer_notifications_password_changed_enabled: true });
    expect(b5.approvalCode()).toBe('b5:126c06eaa041a886eacbf236dda3c4acdca9be11cf9d9c65cfd3f28fadad56ff');
  });
});
