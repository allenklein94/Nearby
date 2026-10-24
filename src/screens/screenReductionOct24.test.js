// Screen-reduction audit 2026-10-24 (owner approved items 1-3): MyBusinessApplication folded into BusinessPartnerApply,
// EmergencyContacts and Billing folded into Settings as sections that open in place. Nothing lost: same services, same actions.
const fs = require('fs');
const path = require('path');
const { SCREEN_REGISTRY, RULE14_DECISIONS } = require('../constants/screenRegistry');
const { notificationDestination } = require('../navigation/notificationDestinations');

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
};
const root = read('navigation/RootNavigator.js');
const settings = read('screens/SettingsScreen.js');
const apply = read('screens/BusinessPartnerApplyScreen.js');
const FOLDED = { MyBusinessApplication: 'MyBusinessApplicationScreen', EmergencyContacts: 'EmergencyContactsScreen', Billing: 'BillingScreen' };

describe('the three screens are gone', () => {
  test.each(Object.entries(FOLDED))('%s: no file, no route, no registry entry; recorded as folded', (route, file) => {
    expect(fs.existsSync(path.join(SRC, `screens/${file}.js`))).toBe(false);
    expect(root).not.toMatch(new RegExp(`name="${route}"|${file}`));
    expect(SCREEN_REGISTRY[route]).toBeUndefined();
    expect(RULE14_DECISIONS.folded[route]).toBeTruthy();
  });

  test('nothing navigates to the old routes', () => {
    const pattern = /navigate\(\s*'(MyBusinessApplication|EmergencyContacts|Billing)'|to\('(MyBusinessApplication|EmergencyContacts|Billing)'|screen: '(MyBusinessApplication|EmergencyContacts|Billing)'/;
    expect(walk(SRC).filter((f) => pattern.test(fs.readFileSync(f, 'utf8')))).toEqual([]);
  });

  test('69 registered screens', () => {
    expect(Object.keys(SCREEN_REGISTRY)).toHaveLength(69);
  });
});

describe('1. one application, one screen', () => {
  test('the declined and needs-info pushes open the application screen', async () => {
    for (const type of ['business_partner_denied', 'business_partner_needs_info']) {
      expect(await notificationDestination({ type })).toEqual({ name: 'BusinessPartnerApply' });
    }
  });

  test('Profile opens the one screen whatever the status', () => {
    const profile = read('screens/ProfileScreen.js');
    expect(profile).toMatch(/navigation\.navigate\('BusinessPartnerApply'\)/);
    expect(profile).not.toMatch(/myBusinessRequestStatus/);
  });

  test('the screen reads the latest application and decides its view from the one helper', () => {
    expect(apply).toMatch(/getMyBusinessPartnerRequest\(\)/);
    expect(apply).toMatch(/applicationView\(request, \{ startingNew \}\)/);
    // a decline restarts in place, never by navigating
    expect(apply).toMatch(/onPress=\{startNewApplication\}/);
    expect(apply).not.toMatch(/navigate\('BusinessPartnerApply'\)/);
  });

  test('needs info resends onto the same row from the Apply form itself (no second form)', () => {
    expect(apply).toMatch(/resubmitBusinessPartnerRequest\(request\.id, \{/);
    expect(apply).toMatch(/resendFormFrom\(data\)/);
    expect(apply.match(/placeholder="Coastal Coffee"/g)).toHaveLength(1); // one business-name input
    expect(apply).toMatch(/accessibilityLabel="Resend application"/);
    // fields resubmit can't save are not offered while resending
    expect(apply).toMatch(/\{!resending && \(<>\s*\{subcategoryOptionsFor/);
    expect(apply).toMatch(/\{!resending && \(<>\s*<Text style=\{styles\.label\}>Location on the map/);
  });

  test('approved keeps its way to the dashboard; the map pin return never resets the form (loaded once, not on focus)', () => {
    expect(apply).toMatch(/navigation\.navigate\('BusinessDashboard'\)/);
    expect(apply).not.toMatch(/useFocusEffect/);
  });
});

describe('2. Emergency contacts open in place under Settings > Safety', () => {
  test('the row toggles in place, says whether it is expanded, and closes Blocked users (one Safety section open)', () => {
    const start = settings.indexOf("t('ui.settings.emergencyContactsA11y')");
    const row = settings.slice(settings.lastIndexOf('<TouchableOpacity', start), settings.indexOf('</TouchableOpacity>', start));
    expect(row).toMatch(/setShowBlocked\(false\); setShowEmergency\(\(v\) => !v\)/);
    expect(row).toMatch(/accessibilityState=\{\{ expanded: showEmergency \}\}/);
    expect(row).not.toMatch(/navigate/);
    expect(settings).toMatch(/\{showEmergency && <EmergencyContactsSection \/>\}/);
    expect(settings).toMatch(/setShowEmergency\(false\); setShowBlocked\(\(v\) => !v\)/);
  });

  test('the date check-in link opens Settings with the section open and scrolled to', () => {
    expect(read('components/DateCheckInModal.js')).toMatch(/navigation\.navigate\('Settings', \{ openEmergencyContacts: Date\.now\(\) \}\)/);
    expect(settings).toMatch(/if \(!route\?\.params\?\.openEmergencyContacts\) return undefined;\s*\n\s*setShowBlocked\(false\);\s*\n\s*setShowEmergency\(true\);/);
    expect(settings).toMatch(/scrollTo\(\{ y: emergencyYRef\.current, animated: true \}\)/);
  });

  test('list, add (name + phone required) and remove are all still there, through the same service', () => {
    const section = read('components/EmergencyContactsSection.js');
    expect(section).toMatch(/import \{ getMyEmergencyContacts, addEmergencyContact, deleteEmergencyContact \} from '\.\.\/services\/emergencyContacts'/);
    expect(section).toMatch(/if \(!name\.trim\(\) \|\| !phone\.trim\(\)\)/);
    expect(section).toMatch(/addEmergencyContact\(name\.trim\(\), phone\.trim\(\), relationship\.trim\(\)\)/);
    expect(section).toMatch(/deleteEmergencyContact\(contact\.id\)/);
    expect(section).toMatch(/onRetry=\{load\}/);
  });
});

describe('3. Your subscription opens in place under Settings > Manage Subscription', () => {
  test('the row toggles in place and says whether it is expanded', () => {
    const start = settings.indexOf("accessibilityLabel={t('settings.manageSubscription')}");
    const row = settings.slice(settings.lastIndexOf('<TouchableOpacity', start), settings.indexOf('</TouchableOpacity>', start));
    expect(row).toMatch(/setShowSubscription\(\(v\) => !v\)/);
    expect(row).toMatch(/accessibilityState=\{\{ expanded: showSubscription \}\}/);
    expect(row).not.toMatch(/navigate/);
    expect(settings).toMatch(/\{showSubscription && <SubscriptionStatusSection navigation=\{navigation\} \/>\}/);
  });

  test('status, manage, restore and upgrade (Paywall stays its own screen) are all still there; re-read on focus', () => {
    const section = read('components/SubscriptionStatusSection.js');
    expect(section).toMatch(/getSubscriptionDetails, restorePurchases, openSubscriptionManagement/);
    expect(section).toMatch(/useFocusEffect\(load\)/);
    expect(section).toMatch(/openSubscriptionManagement\(details\?\.managementURL \|\| null\)/);
    expect(section).toMatch(/onPress=\{handleRestore\}/);
    expect(section).toMatch(/navigation\.navigate\('Paywall'\)/);
    expect(SCREEN_REGISTRY.Paywall).toBeTruthy();
  });
});
