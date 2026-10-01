// Item 136: every recommendation's destination honors the contract for what it claims. Runs the REAL producers.
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/proximity', () => ({}));
jest.mock('../services/gatherings', () => ({}));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn() }));
import fs from 'fs';
import path from 'path';
import { DESTINATION_CONTRACT, satisfiesContract } from './destinationContract';
import { recommendationContext, contextItem, intentResultDestination } from '../utils/recommendationContext';
import { getHomeInsight } from '../services/homeDashboard';
import { homeQuickStatRows } from '../utils/homeQuiet';

const evening = new Date(2026, 8, 22, 19, 0, 0);
const soon = new Date(evening.getTime() + 20 * 60 * 1000).toISOString();
const nav = (row) => ({ kind: 'navigate', screen: row.screen, params: row.params });

describe('object destinations (the shared context layer)', () => {
  const dest = (kind, row) => recommendationContext(contextItem(kind, row)).destination;
  test.each([
    ['gathering', 'gathering', { id: 'g1', title: 'Coffee' }],
    ['business_offer', 'business_offer', { id: 'o1', request_id: 'r1', status: 'offered' }],
    ['business_request', 'business_request', { id: 'r1' }],
    ['business', 'business', { id: 'p1', name: 'Coastal Coffee' }],
    ['perk', 'perk', { id: 'k1' }],
    ['community', 'community', { id: 'c1', name: 'Runners' }],
    ['place', 'place', { placeId: 'x', latitude: 1, longitude: 2 }],
  ])('%s', (claim, kind, row) => {
    const d = dest(kind, row);
    expect(d).not.toBeNull();
    expect(satisfiesContract(claim, d)).toBe(true);
  });
  test('"Coastal Coffee made you an offer" opens that offer, not just its request', () => {
    expect(dest('business_offer', { id: 'o1', request_id: 'r1' }).params).toEqual({ requestId: 'r1', focusOfferId: 'o1' });
    expect(satisfiesContract('business_offer', { kind: 'navigate', screen: 'BusinessRequestDetail', params: { requestId: 'r1' } })).toBe(false);
  });
  test('a friend request opens that person', () => {
    expect(satisfiesContract('friend_request', intentResultDestination({ type: 'friend_request', userId: 'u1' }))).toBe(true);
  });
  test('no real destination = nothing happens, never a wrong screen', () => {
    expect(dest('gathering', { title: 'no id' })).toBeNull();
    expect(dest('business_offer', { id: 'o1' })).toBeNull();
  });
});

describe('Home statements', () => {
  test('"Meet someone new tonight" goes to People', () => {
    const r = getHomeInsight({ meetPeopleCount: 5, motivations: ['Go on dates'] }, evening);
    expect(r.kind).toBe('meet_tonight');
    expect(satisfiesContract('meet_people', r.cta.destination)).toBe(true);
  });
  test('one gathering starting soon opens that gathering', () => {
    const r = getHomeInsight({ happeningNow: [{ id: 'g1', scheduled_at: soon }] }, evening);
    expect(r.cta.destination).toEqual({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: 'g1' } });
    expect(satisfiesContract('gathering_set', r.cta.destination)).toBe(true);
  });
  test('several gatherings starting soon list exactly those, each to its own detail', () => {
    const r = getHomeInsight({ happeningNow: [{ id: 'g1', scheduled_at: soon }, { id: 'g2', scheduled_at: soon }] }, evening);
    expect(r.cta.destination.kind).toBe('inline');
    expect(r.cta.destination.items.map((i) => i.gathering.id)).toEqual(['g1', 'g2']);
    expect(satisfiesContract('gathering_set', r.cta.destination)).toBe(true);
  });
  test('"2 of your friends are making plans" lists their gatherings with who is hosting', () => {
    const friends = [
      { id: 'g1', title: 'Coffee', scheduled_at: soon, profiles: { display_name: 'Sam' } },
      { id: 'g2', title: 'Run', scheduled_at: soon, profiles: { display_name: 'Alex' } },
    ];
    const r = getHomeInsight({ friendsActivity: friends }, evening);
    expect(satisfiesContract('gathering_set', r.cta.destination)).toBe(true);
    expect(r.cta.destination.items[0].reasons).toEqual(['Sam is hosting this']);
  });
  test('the old generic Discover list fails the contract for a set of gatherings', () => {
    expect(satisfiesContract('gathering_set', { kind: 'navigate', screen: 'Discover', params: { initialMode: 'things', initialTypeTab: 'gatherings' } })).toBe(false);
  });
  test('Quick Stats rows', () => {
    const rows = homeQuickStatRows({ meetPeopleCount: 4, gatheringsTodayCount: 3, mostRecentSighting: { otherUserId: 'u1', profiles: { display_name: 'Sam' } } });
    const by = Object.fromEntries(rows.map((r) => [r.key, nav(r)]));
    expect(satisfiesContract('meet_people', by.people)).toBe(true);
    expect(satisfiesContract('gatherings_today', by.today)).toBe(true);
    expect(satisfiesContract('crossed_paths', by.crossed)).toBe(true);
  });
});

describe('pushes and screens follow the contract', () => {
  test('an offer push carries the offer into the request screen', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'notifications.js'), 'utf8');
    expect(src).toMatch(/business_offer_received' && data\.offer_id \? \{ focusOfferId: data\.offer_id \}/);
  });
  test('the request screen scrolls to and marks the focused offer', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'BusinessRequestDetailScreen.js'), 'utf8');
    expect(src).toContain('route.params?.focusOfferId');
    expect(src).toContain('onOfferLayout(o.id, e)');
  });
  test('Home opens insight destinations through the shared opener, never a hand-built screen', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8');
    expect(src).not.toMatch(/navigate\(insight\.cta\.screen/);
    expect(src).toContain('openDestination(navigation, insight.cta.destination)');
  });
  test('every contract entry is well formed', () => {
    for (const [k, r] of Object.entries(DESTINATION_CONTRACT)) {
      expect(['navigate', 'url', 'set']).toContain(r.kind);
      if (r.kind === 'navigate') expect(typeof r.screen).toBe('string');
      if (r.kind === 'set') expect(DESTINATION_CONTRACT[r.item]).toBeDefined();
      expect(k).toMatch(/^[a-z_]+$/);
    }
  });
});
