import fs from 'fs';
import path from 'path';
import { recommendationContext, intentResultDestination, resultRowAction, CONTEXT_FIELDS } from './recommendationContext';

// Item 135: every recommendation carries entity / reason / context / destination / action, composed from the single sources.
const NOW = new Date(2026, 8, 28, 15, 0); // local 3 PM
const tonight = new Date(2026, 8, 28, 18, 30).toISOString();
const coastal = { id: 'bp1', name: 'Coastal Coffee', latitude: 1, longitude: 2, address: '1 Main' };

describe('the context object', () => {
  it('the owner example: Coastal Coffee, a reason, 1.1 mi · tonight, Get an offer, tap opens the request form', () => {
    const item = { type: 'business_availability', id: 'post1', partnerId: 'bp1', title: 'Coastal Coffee has availability',
      distanceMiles: 1.1, postingStartsAt: tonight, postingEndsAt: new Date(2026, 8, 28, 21, 0).toISOString(),
      reasons: ['Good for grabbing a coffee'], businessPartner: coastal, matchedAvailability: { availabilityId: 'post1' } };
    const c = recommendationContext(item, { now: NOW, typedText: 'coffee tonight' });
    expect(c.entity).toEqual({ kind: 'business_availability', id: 'post1', title: 'Coastal Coffee has availability' });
    expect(c.reason).toBe('Good for grabbing a coffee');
    expect(c.context).toMatch(/^1\.1 mi · /);
    expect(c.action).toEqual({ kind: 'request', label: 'Get an offer' });
    expect(c.destination).toMatchObject({ kind: 'navigate', screen: 'AskBusiness' });
    expect(c.destination.params.matchedAvailability).toEqual({ availabilityId: 'post1' });
    expect(c.fields).toEqual(CONTEXT_FIELDS);
  });
  it('a declared booking mode drives the action and the destination together', () => {
    const item = { type: 'business_policy_match', id: 'x', partnerId: 'bp1', businessPartner: { ...coastal, booking_mode: 'reservation_required' } };
    const c = recommendationContext(item, { now: NOW });
    expect(c.action.label).toBe('Book');
    expect(c.destination.params.targetPartner).toEqual({ id: 'bp1', name: 'Coastal Coffee' });
  });
  it('a gathering: reason, measured context, state-driven action, detail destination', () => {
    const c = recommendationContext({ type: 'gathering', id: 'g1', title: 'Coffee', startsAt: tonight, distanceMiles: 0.4,
      reasons: ['Happening today', 'Because you like Coffee'] }, { now: NOW });
    expect(c.reason).toBe('Because you like Coffee'); // a time-only reason is context, never the why
    expect(c.context).toMatch(/^0\.4 mi · /);
    expect(c.destination).toEqual({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: 'g1' } });
    expect(c.action).toBeTruthy(); // from gatheringPrimaryAction (unknown viewer state = View)
  });
  it('missing data is an absent part, never a placeholder', () => {
    const c = recommendationContext({ type: 'community', id: 'c1', title: 'Runners' }, { now: NOW });
    expect(c.reason).toBeNull();
    expect(c.context).toBeNull();
    expect(c.action).toBeNull();
    expect(c.fields).toEqual(['entity', 'destination']);
    expect(recommendationContext(null).fields).toEqual([]);
  });
  it('destinations cover every result kind the resolver returns', () => {
    expect(intentResultDestination({ type: 'perk', id: 'p' })).toEqual({ kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: 'p' } });
    expect(intentResultDestination({ type: 'friend_request', userId: 'u' }).screen).toBe('ViewProfile');
    expect(intentResultDestination({ type: 'friend_discovery' }).screen).toBe('FriendDiscovery');
  });
  it('row action labels stay business-only', () => {
    expect(resultRowAction({ type: 'gathering', id: 'g' })).toBeNull();
    expect(resultRowAction({ type: 'business_availability', id: 'x', businessPartner: coastal }).label).toBe('Get an offer');
  });
  it('taps follow the context destination; no screen builds its own intent-result route', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    const nav = src.slice(src.indexOf('export function navigateToIntentResultItem('));
    expect(nav).toMatch(/intentResultDestination\(item/);
    expect(nav.slice(0, nav.indexOf('\n}\n'))).not.toMatch(/navigate\('(GatheringDetail|BrandOffers|CommunityDetail)'/);
  });
});
