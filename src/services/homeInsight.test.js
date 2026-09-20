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
    expect(r.cta.params).toEqual({ initialMode: 'people' });
    expect(r.basis).toMatch(/5 are nearby/);
    expect(getHomeInsight(d, morning)).toBeNull();
    expect(getHomeInsight({ ...d, motivations: [] }, evening)).toBeNull();
  });

  test('friends planning and starting-soon lines are unchanged and have no CTA', () => {
    expect(getHomeInsight({ friendsActivity: [1, 2] }, evening)).toEqual({ kind: 'friends_planning', text: '2 of your friends are already making plans.' });
    expect(getHomeInsight({ happeningNow: [1] }, evening).text).toBe('1 thing starts near you in the next 30 minutes.');
  });

  test('nothing substantiated -> nothing shown', () => {
    expect(getHomeInsight(null)).toBeNull();
    expect(getHomeInsight({}, evening)).toBeNull();
  });
});
