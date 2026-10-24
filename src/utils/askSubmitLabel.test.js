// Owner idea "384": AskBusiness's Send names who really receives the request, and screen readers hear exactly what is shown.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const fs = require('fs');
const path = require('path');
const { askRecipient, askSubmitLabel } = require('./askSubmitLabel');
const askBusiness = require('../i18n/ui/askBusiness').default;
const { businessActionRoute } = require('./businessAction');

const coastal = { id: 'p1', name: 'Coastal Coffee' };

describe('askSubmitLabel (idea 384)', () => {
  test('one business targeted (Reserve / Book / Request, a picked partner) = "Ask {name}"', () => {
    expect(askSubmitLabel({ targetPartner: coastal })).toBe('Ask Coastal Coffee');
  });

  test('a gathering request to one business = "Ask {name}" (server routes only to the target)', () => {
    expect(askSubmitLabel({ targetPartner: coastal, gatheringId: 'g1' })).toBe('Ask Coastal Coffee');
  });

  test('general nearby request = "Ask Nearby Businesses"', () => {
    expect(askSubmitLabel({})).toBe('Ask Nearby Businesses');
  });

  test('a posting without a target (plan stop, posting push, no booking mode) fans out on the server = "Ask Nearby Businesses"', () => {
    expect(askSubmitLabel({ matchedAvailability: { availabilityId: 'a1', partnerName: 'Coastal Coffee' } })).toBe('Ask Nearby Businesses');
  });

  test('the deliberate Reserve / Book / Request on a business\'s own posting is asked of that business only = "Ask {name}"', () => {
    const route = businessActionRoute({ kind: 'book' }, { partner: { id: 'p1', name: 'Coastal Coffee' }, matchedAvailability: { availabilityId: 'a1', partnerName: 'Coastal Coffee' } });
    expect(route.params.targetPartner).toEqual({ id: 'p1', name: 'Coastal Coffee' });
    expect(route.params.matchedAvailability.availabilityId).toBe('a1');
    expect(askSubmitLabel(route.params)).toBe('Ask Coastal Coffee');
  });

  test('match and community paths take no target: never name one business', () => {
    expect(askRecipient({ targetPartner: coastal, matchId: 'm1' }).kind).toBe('nearby');
    expect(askRecipient({ targetPartner: coastal, communityId: 'c1' }).kind).toBe('nearby');
  });

  test('a business without a name never yields "Ask undefined"', () => {
    expect(askSubmitLabel({ targetPartner: { id: 'p1' } })).toBe('Ask Nearby Businesses');
  });

  test('both labels exist in every language, the one-business label carries the name', () => {
    const langs = Object.keys(askBusiness);
    expect(langs.length).toBe(11);
    for (const l of langs) {
      expect(askBusiness[l].askNearbyBusinesses).toBeTruthy();
      expect(askBusiness[l].ask).toContain('{name}');
    }
  });

  test('the screen speaks the same label it shows', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/AskBusinessScreen.js'), 'utf8');
    expect(src).toMatch(/accessibilityLabel=\{askSubmitLabel\(\{ targetPartner, matchId, communityId \}\)\}/);
    expect(src).toMatch(/<Text style=\{styles\.submitButtonText\}>\{askSubmitLabel\(\{ targetPartner, matchId, communityId \}\)\}<\/Text>/);
    expect(src).not.toMatch(/askNearbyBusinessesA11y/);
  });
});
