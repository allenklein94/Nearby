// Guards the "Nearby manages the complexity for businesses" shape of the dashboard (CLAUDE.md, locked 2026-09-19):
// four owner nouns, secondary areas collapsed, aggregated demand living with Opportunities (not Home).
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'BusinessDashboardScreen.js'), 'utf8');
const idx = (needle) => src.indexOf(needle);

describe('business dashboard simplicity', () => {
  it('names the tabs in the owner\'s words and keeps five tabs', () => {
    const tabs = src.match(/\{ key: '(home|opportunities|bookings|offers|profile)', icon: '[^']+', label: '([^']+)'/g) ?? [];
    expect(tabs.map((t) => t.match(/label: '([^']+)'/)[1])).toEqual(['Home', 'Opportunities', 'Bookings', 'Availability', 'Profile']);
  });
  it('renders "Demand near you" once, inside the Opportunities gate, after the opportunity list', () => {
    expect(src.match(/<DemandNearYouCard/g)).toHaveLength(1);
    const card = idx('<DemandNearYouCard');
    const gateStart = src.lastIndexOf("{on('opportunities') && (", card);
    expect(gateStart).toBeGreaterThan(idx('new opportunit'));
    expect(src.slice(gateStart, card)).not.toMatch(/\{on\('(home|bookings|offers|profile)'\)/);
  });
  it('keeps packages, rewards and signature experiences behind "More ways to offer"', () => {
    expect(src).toContain("on('offers') && moreOffersOpen");
    expect(idx('More ways to offer')).toBeLessThan(idx('Occasion Packages</Text>'));
    expect(idx('{moreOffersOpen && (')).toBeLessThan(idx('Occasion Packages</Text>'));
  });
  it('leads Profile with Tell Nearby and keeps policy/notifications/payments/AI behind Settings', () => {
    const settings = idx('{profileSettingsOpen && (');
    for (const needle of ['Fulfillment Policy</Text>', '<BusinessNotificationPreferences />', 'Get Paid via Stripe', 'AI Automation Settings']) {
      expect(idx(needle)).toBeGreaterThan(settings);
    }
    expect(idx('<TellNearbyBusinessCard')).toBeLessThan(settings);
  });
});
