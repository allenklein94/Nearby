jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./proximity', () => ({}));
jest.mock('./gatherings', () => ({}));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn() }));
import { getHomeInsight } from './homeDashboard';

const evening = new Date(2026, 8, 22, 19, 0, 0);
const morning = new Date(2026, 8, 22, 9, 0, 0);

describe('getHomeInsight', () => {
  test('a Best Pick alone no longer claims it is a night to meet someone', () => {
    expect(getHomeInsight({ bestPick: { id: 'g' }, nearbyPeopleCount: 0, motivations: ['Go on dates'] }, evening)).toBeNull();
  });

  test('the People line needs evening + intent + enough people, and carries a Meet People CTA and its basis', () => {
    const d = { nearbyPeopleCount: 5, motivations: ['Go on dates'] };
    const r = getHomeInsight(d, evening);
    expect(r.kind).toBe('meet_tonight');
    expect(r.cta.label).toBe('Meet People');
    expect(r.cta.params).toEqual({ initialMode: 'people', initialPeopleSubMode: 'dating', context: 'meet_tonight' });
    expect(r.basis).toMatch(/5 were near you in the last day/);
    expect(getHomeInsight(d, morning)).toBeNull();
    expect(getHomeInsight({ ...d, motivations: [] }, evening)).toBeNull();
  });

  test('every insight line carries a CTA with a destination', () => {
    const f = getHomeInsight({ friendsActivity: [1, 2] }, evening);
    expect(f.text).toBe('2 of your friends are already making plans.');
    // a set of specific gatherings: one opens it, several are listed (destination contract, item 136)
    const two = getHomeInsight({ friendsActivity: [{ id: 'a' }, { id: 'b' }] }, evening);
    expect(two.cta.destination.kind).toBe('inline');
    expect(getHomeInsight({ happeningNow: [{ id: 'g' }] }, evening).cta.destination.screen).toBe('GatheringDetail');
    expect(getHomeInsight({ happeningNow: [{ id: 'g' }] }, evening).text).toBe('1 thing starts near you in the next 30 minutes.');
  });

  test('nothing substantiated -> nothing shown', () => {
    expect(getHomeInsight(null)).toBeNull();
    expect(getHomeInsight({}, evening)).toBeNull();
  });
});
