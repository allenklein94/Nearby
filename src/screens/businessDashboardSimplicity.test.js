// Guards the "Nearby manages the complexity for businesses" shape of the dashboard (CLAUDE.md, locked 2026-09-19):
// four owner nouns, secondary areas collapsed, aggregated demand living with Opportunities (not Home).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
const idx = (needle) => src.indexOf(needle);

describe('business dashboard simplicity', () => {
  it('names the tabs in the owner\'s words and keeps five tabs', () => {
    const keys = (src.match(/\{ key: '(home|opportunities|bookings|offers|profile)', icon: '[^']+' \}/g) ?? []).map((m) => m.match(/key: '(\w+)'/)[1]);
    expect(keys).toEqual(['home', 'opportunities', 'bookings', 'offers', 'profile']);
    const en = require('../i18n/ui/bizDash3').default.en.section;
    expect(keys.map((k) => en[k])).toEqual(['Home', 'Opportunities', 'Bookings', 'Availability', 'Profile']);
  });
  it('renders "Demand near you" once, inside the Opportunities gate, after the opportunity list', () => {
    expect(src.match(/<DemandNearYouCard/g)).toHaveLength(1);
    const card = idx('<DemandNearYouCard');
    const gateStart = src.lastIndexOf("{on('opportunities') && (", card);
    expect(gateStart).toBeGreaterThan(idx('ui.bizDash2.newOpportunitiesFit'));
    expect(src.slice(gateStart, card)).not.toMatch(/\{on\('(home|bookings|offers|profile)'\)/);
  });
  it('keeps packages, rewards and signature experiences behind "More ways to offer"', () => {
    expect(src).toContain("on('offers') && moreOffersOpen");
    expect(idx("t('ui.bizDash2.moreWaysToOffer')")).toBeLessThan(idx("t('ui.bizDash2.occasionPackages')}</Text>"));
    expect(idx('{moreOffersOpen && (')).toBeLessThan(idx("t('ui.bizDash2.occasionPackages')}</Text>"));
  });
  it('leads Profile with Tell Nearby and keeps policy/notifications/payments/AI behind Settings', () => {
    const settings = idx('{profileSettingsOpen && (');
    for (const needle of ["t('ui.bizDash2.fulfillmentPolicy')}</Text>", '<BusinessNotificationPreferences />', "t('ui.bizDash3.getPaidViaStripe')", "t('ui.bizDash3.aiAutomationSettings')"]) {
      expect(idx(needle)).toBeGreaterThan(settings);
    }
    expect(idx('<TellNearbyBusinessCard')).toBeLessThan(settings);
  });
});
