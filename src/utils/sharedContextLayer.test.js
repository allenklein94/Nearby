// The shared context layer across the main consumer discovery surfaces (owner, 2026-09-28). Every recommendation explains itself
// once, opens one destination and offers one accurate action, whatever surface draws it:
//   Home: Picked For You cards + the Best Pick hero (gatheringCardModel) and perk rows (recommendationRow)
//   Discover: browse cards (gatheringCardModel for gatherings, contextItem for perks / communities / businesses)
//   Surprise Me and typed-ask rows on both screens (resultRowView)
// all built on utils/recommendationContext.js, and every tap goes through services/openDestination.js.
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));

import fs from 'fs';
import path from 'path';
import { Linking } from 'react-native';
import { recommendationContext, contextItem, contextItemFromRecommendation, resultRowView, validReasons } from './recommendationContext';
import { gatheringCardModel } from './recommendationCard';
import { recommendationRow, communityReason } from './recommendationFacts';
import { appendReason, askedForReason, activityReason, occasionOfferedReason, becauseYouLikeReason } from '../constants/recommendationReasonVocabulary';
import { openDestination } from '../services/openDestination';

const NOW = new Date(2026, 8, 28, 15, 0); // local 3 PM
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 8, 28 + dayOffset, h, m).toISOString();
const ME = 'me';
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const coastal = { id: 'bp1', name: 'Coastal Coffee', latitude: 1, longitude: 2, address: '1 Main' };
const gathering = (over = {}) => ({
  id: 'g1', title: 'Coffee meetup', interest_tag: 'Coffee', host_id: 'host', visibility: 'everyone', is_public: true,
  scheduled_at: at(18, 30), distanceMiles: 1.1, attendees: [], approvedCount: 0, ...over,
});

// The same gathering drawn by each surface.
const homeCard = (g, reasons = ['Because you like Coffee'], opts = {}) =>
  gatheringCardModel(g, { signals: reasons.map((text) => ({ kind: 'reason', text })), myUserId: ME, now: NOW.getTime(), ...opts });
const discoverCard = homeCard; // Discover passes its ordered candidate reasons the same way
const surpriseRow = (g, reasons = ['Because you like Coffee']) =>
  resultRowView({ type: 'gathering', ...g, startsAt: g.scheduled_at, reasons }, { myUserId: ME, now: NOW });

describe('one explanation, one destination, one action across Home, Discover and Surprise Me', () => {
  it('the same gathering reads the same everywhere', () => {
    const g = gathering();
    const home = homeCard(g);
    const disc = discoverCard(g);
    const row = surpriseRow(g);
    expect(home.why).toBe('Because you like Coffee');
    expect(disc.reasons[0]).toBe('Because you like Coffee');
    expect(row.reason).toBe('Because you like Coffee');
    expect(home.meta).toBe('1.1 mi · Tonight · 6:30 PM');
    expect(disc.meta).toBe(home.meta);
    expect(row.meta).toBe(home.meta);
    const dest = { kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: 'g1' } };
    expect(home.destination).toEqual(dest);
    expect(disc.destination).toEqual(dest);
    expect(row.destination).toEqual(dest);
  });

  it('distance and time restated as a reason become the context line, never the explanation', () => {
    const card = homeCard(gathering(), ['1.1 mi away', 'Happening today', 'Starts in 20 min', 'Tonight', 'Trending nearby']);
    expect(card.reasons).toEqual(['Trending nearby']);
    expect(validReasons({ reasons: ['Close by', 'Very close', 'Because you asked for Coffee'] })).toEqual(['Because you asked for Coffee']);
  });

  it('category, activity and occasion explanations come from the one vocabulary and pass through unchanged', () => {
    const reasons = [askedForReason('Coffee'), activityReason('grabbing a coffee'), occasionOfferedReason('Birthday')].filter(Boolean);
    expect(reasons).toEqual(['Because you asked for Coffee', 'Good for grabbing a coffee', 'Offers Birthday experiences']);
    const row = resultRowView({ type: 'business_occasion_package', id: 'pk', partnerId: 'bp1', title: 'Birthday package', reasons: reasons.slice(2) });
    expect(row.reason).toBe('Offers Birthday experiences');
  });

  it('never a generic fallback: no real reason = no reason', () => {
    expect(homeCard(gathering(), []).why).toBeNull();
    expect(surpriseRow(gathering(), []).reason).toBeNull();
    expect(becauseYouLikeReason('')).toBeNull();
    const src = ['utils/recommendationContext.js', 'screens/HomeScreen.js', 'screens/DiscoverHubScreen.js'].map(read).join('\n');
    expect(src).not.toMatch(/Matches what you're looking for|Matches your interests'|Great fit for the occasion/);
  });
});

describe('gathering join states drive the action on every surface', () => {
  const states = [
    ['open upcoming, attendance known', { attendees: [] }, 'join', 'Join'],
    ['needs approval', { attendees: [], requires_approval: true }, 'join', 'Request to Join'],
    ['requested', { attendees: [{ user_id: ME, status: 'pending' }] }, 'requested', 'Requested'],
    ['waitlisted', { attendees: [{ user_id: ME, status: 'waitlisted' }] }, 'requested', 'On waitlist'],
    ['attending', { attendees: [{ user_id: ME, status: 'approved' }] }, 'view_plan', 'View Plan'],
    ['hosting', { host_id: ME }, 'view_plan', 'View Plan'],
    ['attendance unknown', { attendees: undefined }, 'view', 'View'],
    ['past', { scheduled_at: at(10, 0, -2), attendees: [] }, 'view', 'View Past Event'],
  ];
  it.each(states)('%s', (_label, over, kind, label) => {
    const g = gathering(over);
    for (const card of [homeCard(g), discoverCard(g)]) {
      expect(card.action.kind).toBe(kind);
      expect(card.action.label).toBe(label);
    }
  });
  it('the trending card offers the private Interested toggle (low commitment) from the same object', () => {
    const card = homeCard(gathering(), ['Trending nearby'], { actionOpts: { lowCommitment: true, interestedIds: new Set(['g1']) } });
    expect(card.action).toMatchObject({ kind: 'interested', label: '★ Interested' });
  });
  it('a finished gathering says so instead of dropping its time', () => {
    expect(homeCard(gathering({ scheduled_at: at(10, 0, -2) })).meta).toBe('1.1 mi · Already happened');
  });
});

describe('businesses: declared booking mode vs none', () => {
  const posting = (partner) => ({ type: 'business_availability', id: 'post1', partnerId: 'bp1', title: 'Coastal Coffee has availability',
    subtitle: 'Coastal Coffee has availability · $12 · Because you asked for Coffee', reasons: ['Because you asked for Coffee'],
    distanceMiles: 0.4, businessPartner: partner, matchedAvailability: { availabilityId: 'post1' } });
  it('declared booking mode: the action and the tap destination agree', () => {
    const row = resultRowView(posting({ ...coastal, booking_mode: 'reservation_required' }), { now: NOW });
    expect(row.action.label).toBe('Book');
    expect(row.destination).toMatchObject({ kind: 'navigate', screen: 'AskBusiness' });
    // a posting result books against that posting (item 72), the same route whose action it names
    expect(row.destination.params.matchedAvailability).toEqual({ availabilityId: 'post1' });
    const policy = resultRowView({ type: 'business_policy_match', id: 'x', partnerId: 'bp1', businessPartner: { ...coastal, booking_mode: 'reservation_required' } }, { now: NOW });
    expect(policy.action.label).toBe('Book');
    expect(policy.destination.params.targetPartner).toEqual({ id: 'bp1', name: 'Coastal Coffee' });
  });
  it('no declared booking mode: Get an offer, the request form', () => {
    const row = resultRowView(posting(coastal), { now: NOW });
    expect(row.action).toEqual({ kind: 'request', label: 'Get an offer' });
    expect(row.destination.screen).toBe('AskBusiness');
  });
  it('the resolver subtitle is a detail line, never a second explanation', () => {
    const row = resultRowView(posting(coastal), { now: NOW });
    expect(row.reason).toBe('Because you asked for Coffee');
    expect(row.meta).toBe('0.4 mi · Coastal Coffee has availability · $12');
  });
  it('Discover business cards open the profile with their own search reason', () => {
    const c = recommendationContext(contextItem('business', { ...coastal, distanceMiles: 2, searchReason: 'Coffee' }));
    expect(c.destination).toEqual({ kind: 'navigate', screen: 'BusinessProfile', params: { partnerId: 'bp1' } });
    expect(c.context).toBe('2.0 mi'); // the one distance format
    expect(c.action).toBeNull(); // the profile carries the booking CTA
  });
  it('a full gathering row keeps its waitlist line and is marked', () => {
    const row = resultRowView({ type: 'gathering', ...gathering(), startsAt: at(18, 30), isFull: true,
      subtitle: '🔒 Full — Join Waitlist (4/4 spots taken)', reasons: [] }, { myUserId: ME, now: NOW });
    expect(row.warn).toBe(true);
    expect(row.meta).toContain('Full — Join Waitlist');
  });
});

describe('perks, communities, requests and offers', () => {
  it('Home perk rows and Discover perk cards open the perk', () => {
    const row = recommendationRow({ type: 'perk', id: 'p1', title: '10% off', reasons: ['Because you like Coffee'], data: { distanceMiles: 0.3 } });
    expect(row.destination).toEqual({ kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: 'p1' } });
    expect(row).toMatchObject({ why: 'Because you like Coffee', meta: '0.3 mi' });
    const disc = recommendationContext(contextItem('perk', { id: 'p1', title: '10% off', distanceMiles: 0.3 }, { reasons: [becauseYouLikeReason('Coffee')], redeemed: false }));
    expect(disc.destination).toEqual(row.destination);
    expect(disc.action).toEqual({ kind: 'redeem', label: 'Redeem' });
    expect(recommendationContext(contextItem('perk', { id: 'p1' }, { redeemed: true })).action).toMatchObject({ kind: 'status', label: 'Redeemed ✓' });
  });
  it('a community names a reason only for a declared interest', () => {
    const c = { id: 'c1', name: 'Runners', interest_tag: 'Running', distanceMiles: 3 };
    expect(recommendationContext(contextItem('community', c, { reasons: [communityReason(c, ['Running'])] })).reason).toBe('Because you like Running');
    const none = recommendationContext(contextItem('community', c, { reasons: [communityReason(c, ['Coffee'])] }));
    expect(none.reason).toBeNull();
    expect(none.destination).toEqual({ kind: 'navigate', screen: 'CommunityDetail', params: { communityId: 'c1', communityName: 'Runners' } });
  });
  it('a request opens its detail; an offer is actionable only while it can still be taken', () => {
    expect(recommendationContext(contextItem('business_request', { id: 'r1', title: 'Coffee for 4' })).destination)
      .toEqual({ kind: 'navigate', screen: 'BusinessRequestDetail', params: { requestId: 'r1' } });
    const offer = (over) => recommendationContext(contextItem('business_offer', { id: 'o1', request_id: 'r1', status: 'offered', offer_title: 'Latte + pastry', price: 8, ...over }));
    expect(offer({}).action).toEqual({ kind: 'view_offer', label: 'View Offer' });
    expect(offer({}).destination.params).toEqual({ requestId: 'r1' });
    expect(offer({ valid_until: at(9, 0, -1) }).action).toBeNull(); // expired
    expect(offer({ status: 'declined' }).action).toBeNull();
    expect(offer({ request_id: null }).destination).toBeNull();
  });
});

describe('incomplete data is omitted, never invented', () => {
  it('no distance, no time, no reason', () => {
    const card = homeCard(gathering({ distanceMiles: null, scheduled_at: null }), []);
    expect(card.meta).toBeNull();
    expect(card.why).toBeNull();
    const row = resultRowView({ type: 'perk', id: 'p1', title: '10% off' });
    expect(row).toMatchObject({ reason: null, meta: null, action: null });
  });
  it('an unavailable destination is null and opening it does nothing', () => {
    const nav = { navigate: jest.fn() };
    expect(homeCard(gathering({ id: null })).destination).toBeNull();
    expect(homeCard(gathering({ id: null })).action).toBeNull();
    expect(contextItem('unknown_kind', { id: 'x' })).toBeNull();
    expect(recommendationContext(contextItemFromRecommendation({ type: 'perk', title: 'x' })).destination).toBeNull();
    expect(openDestination(nav, null)).toBe(false);
    expect(openDestination(nav, { kind: 'navigate' })).toBe(false);
    expect(openDestination(nav, { kind: 'url', url: '' })).toBe(false);
    expect(nav.navigate).not.toHaveBeenCalled();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
  it('opening a destination navigates exactly there (extra params only add, e.g. openJoin)', () => {
    const nav = { navigate: jest.fn() };
    expect(openDestination(nav, homeCard(gathering()).destination, { openJoin: true })).toBe(true);
    expect(nav.navigate).toHaveBeenCalledWith('GatheringDetail', { gatheringId: 'g1', openJoin: true });
    openDestination(nav, { kind: 'url', url: 'maps://x' });
    expect(Linking.openURL).toHaveBeenCalledWith('maps://x');
  });
  it('a ranking pass records its explanation once in reasons (the list the context reads)', () => {
    expect(appendReason(['A'], 'B')).toEqual(['A', 'B']);
    expect(appendReason(['A'], 'A')).toEqual(['A']);
    expect(appendReason(undefined, null)).toEqual([]);
  });
});

describe('guards: surfaces render the shared object and do not rebuild its rules', () => {
  const home = read('screens/HomeScreen.js');
  const discover = read('screens/DiscoverHubScreen.js');
  const pickedForYou = home.slice(home.indexOf('Picked For You</Text>'), home.indexOf('dashboard?.weeklyRecap &&'));
  it('Home Picked For You + Best Pick build from the card model and tap its destination', () => {
    expect(pickedForYou).toMatch(/homeGatheringCard\(attention\.hero/);
    expect(pickedForYou).toMatch(/homeGatheringCard\(g, \{ signals, variant \}\)/);
    expect(pickedForYou).toMatch(/openDestination\(navigation, heroCard\.destination\)/);
    expect(pickedForYou).toMatch(/openDestination\(navigation, card\.destination\)/);
    expect(pickedForYou).toMatch(/openDestination\(navigation, row\.destination\)/);
    expect(pickedForYou).not.toMatch(/navigation\.navigate\('(GatheringDetail|BrandOffers)'/);
    expect(pickedForYou).not.toMatch(/formatHeroDateTime|recommendationFacts\(g\)|categorizeReasonText/);
    expect(home).not.toMatch(/function handleRecommendationTap/);
    expect(home).not.toMatch(/gatheringPrimaryAction\(/);
  });
  it('Discover browse cards never navigate to an object screen themselves', () => {
    expect(discover).not.toMatch(/navigation\.navigate\('(GatheringDetail|BrandOffers|CommunityDetail|BusinessProfile)'/);
    expect(discover).not.toMatch(/factsMeta\(|gatheringPrimaryAction\(/);
    expect(discover).toMatch(/perkContext\(o\)/);
    expect(discover).toMatch(/communityContext\(c\)/);
    expect(discover).toMatch(/businessContext\(b\)/);
  });
  it('Surprise Me and typed-ask rows on both screens use the one row view', () => {
    const rawSubtitle = /item\.subtitle \? \(?\s*<Text/g;
    for (const src of [home, discover]) expect(src).toMatch(/resultRowView\(item\)/);
    expect(discover.match(rawSubtitle) ?? []).toHaveLength(0);
    // Home keeps exactly one: a friend's own request row, which is a person's words, not a recommendation
    expect(home.match(rawSubtitle) ?? []).toHaveLength(1);
    expect(home.slice(home.indexOf("if (item.type === 'friend_request') {"), home.indexOf('const row = resultRowView(item);'))).toMatch(rawSubtitle);
    // Home's surprise lane rows specifically
    const lanes = home.slice(home.indexOf('surprise.lanes.map'), home.indexOf('surprise.connectedPerson &&'));
    expect(lanes).toMatch(/resultRowView\(item\)/);
  });
  it('only openDestination follows a destination; the context object is the one place destinations are built', () => {
    const resolver = read('services/intentResolver.js');
    const nav = resolver.slice(resolver.indexOf('export function navigateToIntentResultItem('));
    expect(nav.slice(0, nav.indexOf('\n}\n'))).toMatch(/openDestination\(navigation, intentResultDestination\(item/);
    expect(read('services/openDestination.js')).toMatch(/navigation\.navigate\(destination\.screen/);
  });
});
