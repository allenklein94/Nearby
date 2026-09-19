jest.mock('./supabase', () => ({ supabase: {} }));
const { experienceStopFromItem, navigateToExperienceStop } = require('./plans');

const component = { key: 'dinner', label: '🍽️ Dinner' };

describe('experienceStopFromItem', () => {
  it('turns an availability item into a stop bound to the exact posting', () => {
    const stop = experienceStopFromItem(component, { type: 'business_availability', id: 'avail-1', title: 'X has availability', matchedAvailability: { availabilityId: 'avail-1' } });
    expect(stop).toEqual({ componentKey: 'dinner', componentLabel: '🍽️ Dinner', stopType: 'business_availability', refId: 'avail-1', title: 'X has availability' });
  });
  it('turns a gathering into a stop', () => {
    expect(experienceStopFromItem(component, { type: 'gathering', id: 'g1', title: 'Jazz night' }).stopType).toBe('gathering');
  });
  it('never makes a perk, community, package or friend result a stop', () => {
    for (const type of ['perk', 'community', 'business_policy_match', 'business_occasion_package', 'friend_request']) {
      expect(experienceStopFromItem(component, { type, id: 'x', title: 't' })).toBeNull();
    }
  });
});

describe('navigateToExperienceStop', () => {
  it('opens a gathering stop on the gathering', () => {
    const navigate = jest.fn();
    navigateToExperienceStop({ navigate }, { stopType: 'gathering', refId: 'g1' });
    expect(navigate).toHaveBeenCalledWith('GatheringDetail', { gatheringId: 'g1' });
  });
  it('continues a business stop through the existing ask flow, bound to that posting, with the plan\'s party size', () => {
    const navigate = jest.fn();
    navigateToExperienceStop({ navigate }, { stopType: 'business_availability', refId: 'a1', title: 'Chef tasting', subtitle: 'Nonna', category: 'Foodie' }, { partySize: 2 });
    const [screen, params] = navigate.mock.calls[0];
    expect(screen).toBe('AskBusiness');
    expect(params.matchedAvailability.availabilityId).toBe('a1');
    expect(params.prefillCategory).toBe('Foodie');
    expect(params.prefillPartySize).toBe(2);
  });
  it('carries the stop id so the ask can link its request back to the stop', () => {
    const navigate = jest.fn();
    navigateToExperienceStop({ navigate }, { id: 'stop-1', stopType: 'business_availability', refId: 'a1', title: 'T', state: 'chosen' });
    expect(navigate.mock.calls[0][1].experienceStopId).toBe('stop-1');
  });
  it('sends an already-requested stop to its request instead of asking twice', () => {
    const navigate = jest.fn();
    navigateToExperienceStop({ navigate }, { id: 'stop-1', stopType: 'business_availability', refId: 'a1', requestId: 'req-1', state: 'requested' });
    expect(navigate).toHaveBeenCalledWith('BusinessRequestDetail', { requestId: 'req-1' });
  });
  it('lets a cancelled stop be requested again', () => {
    const navigate = jest.fn();
    navigateToExperienceStop({ navigate }, { id: 'stop-1', stopType: 'business_availability', refId: 'a1', requestId: 'req-1', state: 'cancelled' });
    expect(navigate.mock.calls[0][0]).toBe('AskBusiness');
  });
});
