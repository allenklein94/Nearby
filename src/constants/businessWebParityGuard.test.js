// Business website == business app in logic: both run the SAME BusinessDashboardScreen. What can differ is the
// platform shell around it, so this guards the seams: dialogs work on web, and every screen the dashboard navigates
// to is either registered in the web navigator or honestly guarded as app-only.
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

// No exemptions: a business owner must never be sent "to the app" for a core operation.

describe('business web parity', () => {
  const dashboard = read('src/screens/BusinessDashboardScreen.js');
  const webNav = read('src/navigation/BusinessWebNavigator.js');

  it('installs the Alert shim in the web root (react-native-web Alert.alert is a no-op)', () => {
    const app = read('App.web.js');
    expect(app).toMatch(/installWebAlert\(Alert\)/);
  });

  it('every screen the dashboard navigates to is registered on the business website', () => {
    const targets = [...dashboard.matchAll(/navigation\.navigate\('(\w+)'/g)].map((m) => m[1]);
    for (const t of new Set(targets)) expect(webNav).toMatch(new RegExp(`name="${t}"`));
  });

  it('the website never tells an owner to go use the app', () => {
    expect(dashboard).not.toMatch(/Open the Nearby app to/);
  });

  it('a live Stripe key is inert until the owner sets STRIPE_LIVE_APPROVED (hard gate), in every function that uses the key', () => {
    for (const fn of ['business-stripe-connect-onboarding', 'create-business-payment-intent']) {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).toMatch(/\(sk\|rk\)_live_/);
      expect(src).toMatch(/STRIPE_LIVE_APPROVED'\) !== 'true'/);
    }
  });
});
