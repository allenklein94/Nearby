// Business website == business app in logic: both run the SAME BusinessDashboardScreen. What can differ is the
// platform shell around it, so this guards the seams: dialogs work on web, and every screen the dashboard navigates
// to is either registered in the web navigator or honestly guarded as app-only.
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

// Documented, disclosed app-only screens (hosting a gathering / community). Each must be guarded by a web check.
const APP_ONLY = ['CreateGathering', 'GatheringDetail', 'CreateCommunity', 'CommunityDetail'];

describe('business web parity', () => {
  const dashboard = read('src/screens/BusinessDashboardScreen.js');
  const webNav = read('src/navigation/BusinessWebNavigator.js');

  it('installs the Alert shim in the web root (react-native-web Alert.alert is a no-op)', () => {
    const app = read('App.web.js');
    expect(app).toMatch(/installWebAlert\(Alert\)/);
  });

  it('every screen the dashboard navigates to is web-registered or a guarded app-only screen', () => {
    const targets = [...dashboard.matchAll(/navigation\.navigate\('(\w+)'/g)].map((m) => m[1]);
    for (const t of new Set(targets)) {
      if (APP_ONLY.includes(t)) {
        expect(dashboard).toMatch(new RegExp(`Platform\\.OS === 'web'[\\s\\S]{0,400}navigation\\.navigate\\('${t}'`));
      } else {
        expect(webNav).toMatch(new RegExp(`name="${t}"`));
      }
    }
  });
});
