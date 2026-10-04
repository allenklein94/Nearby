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
    expect(offer({}).destination.params).toEqual({ requestId: 'r1', focusOfferId: 'o1' });
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
  const pickedForYou = home.slice(home.indexOf("{t('ui.home.pickedForYou')}</Text>"), home.indexOf('dashboard?.weeklyRecap &&'));
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
    for (const src of [home, discover]) expect(src).toMatch(/resultRowView\(item, \{ language, myUserId \}\)/);
    expect(discover.match(rawSubtitle) ?? []).toHaveLength(0);
    // Home keeps exactly one: a friend's own request row, which is a person's words, not a recommendation
    expect(home.match(rawSubtitle) ?? []).toHaveLength(1);
    expect(home.slice(home.indexOf("if (item.type === 'friend_request') {"), home.indexOf('const row = resultRowView(item, { language, myUserId });'))).toMatch(rawSubtitle);
    // Home's surprise lane rows specifically
    const lanes = home.slice(home.indexOf('surpriseShown.lanes.map'), home.indexOf('surpriseShown.connectedLine &&'));
    expect(lanes).toMatch(/resultRowView\(item, \{ language, myUserId \}\)/);
  });
  it('only openDestination follows a destination; the context object is the one place destinations are built', () => {
    const resolver = read('services/intentResolver.js');
    const nav = resolver.slice(resolver.indexOf('export function navigateToIntentResultItem('));
    expect(nav.slice(0, nav.indexOf('\n}\n'))).toMatch(/openDestination\(navigation, intentResultDestination\(item/);
    expect(read('services/openDestination.js')).toMatch(/navigation\.navigate\(destination\.screen/);
  });
});

// ---- Remaining surfaces (owner, 2026-09-28): Gatherings feed, Activity rows, Google Places, the sponsored slot ----------------
describe('Gatherings feed', () => {
  const feedCard = (g) => gatheringCardModel(g, { myUserId: ME, now: NOW.getTime() });
  it('identity, when/where, destination and join action from the context object', () => {
    const card = feedCard(gathering());
    expect(card.entity).toEqual({ kind: 'gathering', id: 'g1', title: 'Coffee meetup' });
    expect(card.meta).toBe('1.1 mi · Tonight · 6:30 PM');
    expect(card.destination).toEqual({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: 'g1' } });
    expect(card.action).toMatchObject({ kind: 'join', label: 'Join' });
  });
  it('join states are preserved (full = waitlist, approval, invite-only is not joinable from a card)', () => {
    expect(feedCard(gathering({ capacity: 2, approvedCount: 1 })).action.label).toBe('Join Waitlist');
    expect(feedCard(gathering({ requires_approval: true })).action.label).toBe('Request to Join');
    expect(feedCard(gathering({ visibility: 'invite_only' })).action).toMatchObject({ kind: 'view', status: 'Invite only' });
  });
  it('missing data: no time or distance = no line, no id = no destination and no action', () => {
    expect(feedCard(gathering({ scheduled_at: null, distanceMiles: null })).meta).toBeNull();
    const noId = feedCard(gathering({ id: null }));
    expect(noId.destination).toBeNull();
    expect(noId.action).toBeNull();
  });
});

describe('Activity rows (transactional: destination + action, never a reason)', () => {
  const row = (offer, requestId = 'r1') => recommendationContext(contextItem('business_offer', { ...offer, request_id: requestId }, { reasons: ['Because you like Coffee'] }));
  const offered = { id: 'o1', status: 'offered', offer_title: 'Latte + pastry', price: 8 };
  it('an open offer reply shows View Offer and opens its request', () => {
    const c = row(offered);
    expect(c.action).toEqual({ kind: 'view_offer', label: 'View Offer' });
    expect(c.destination).toEqual({ kind: 'navigate', screen: 'BusinessRequestDetail', params: { requestId: 'r1', focusOfferId: 'o1' } });
    expect(c.reason).toBeNull(); // a reason passed to a transactional row is dropped
  });
  it('plain availability is not called an offer', () => {
    expect(row({ id: 'o2', status: 'offered' }).action).toEqual({ kind: 'view_offer', label: 'View' });
  });
  it('expired, declined, withdrawn, accepted: no action (the row is history), still opens the request', () => {
    for (const over of [{ valid_until: at(9, 0, -1) }, { status: 'declined' }, { status: 'withdrawn' }, { status: 'accepted' }]) {
      const c = row({ ...offered, ...over });
      expect(c.action).toBeNull();
      expect(c.destination.params.requestId).toBe('r1');
    }
  });
  it('authorization failure: the request row could not be read = no destination and no action', () => {
    const c = row(offered, null);
    expect(c.destination).toBeNull();
    expect(c.action).toBeNull();
  });
  it('the screen routes offers, requests, updates, reminders and accepted invites through the shared rule', () => {
    const src = read('screens/ActivityScreen.js');
    expect(src).toMatch(/contextItem\('business_offer'/);
    expect(src).toMatch(/disabled=\{!ctx\.destination\}/);
    expect(src).not.toMatch(/offerPrimaryAction\(/);
    expect(src).not.toMatch(/navigation\.navigate\('(GatheringDetail|BusinessRequestDetail|BusinessProfile|CommunityDetail)'/);
  });
});

describe('Google Places', () => {
  it('distance + directions from the context; no reason, no booking mode, no action', () => {
    const c = recommendationContext(contextItem('place', { placeId: 'pl1', name: 'Blue Cafe', latitude: 40, longitude: -75, distanceMiles: 0.6 }, { reasons: ['Because you like Coffee'] }));
    expect(c.context).toBe('0.6 mi');
    expect(c.destination).toEqual({ kind: 'url', url: 'https://www.google.com/maps/dir/?api=1&destination=40,-75&destination_place_id=pl1' });
    expect(c.reason).toBeNull();
    expect(c.action).toBeNull();
  });
  it('address only = directions by address; nothing known = no destination (the old code opened a null URL)', () => {
    expect(recommendationContext(contextItem('place', { placeId: 'pl2', name: 'X', address: '1 Main St' })).destination.url).toContain('1%20Main%20St');
    const none = recommendationContext(contextItem('place', { placeId: 'pl3', name: 'Y' }));
    expect(none.destination).toBeNull();
    expect(none.context).toBeNull();
  });
  it('Discover and the Places screen open places only through openDestination', () => {
    for (const f of ['screens/DiscoverHubScreen.js']) {
      const src = read(f);
      expect(src).toMatch(/contextItem\('place'/);
      expect(src).not.toMatch(/Linking\.openURL\(buildDirectionsUrl/);
    }
  });
});

describe('sponsored slot: shared destination only, never organic', () => {
  const card = { placement_id: 'pl', title: 'Latte week', partner_id: 'bp1', partner_name: 'Coastal Coffee', item_kind: 'offer', item_id: 'p9' };
  it('opens the promoted offer or business; carries no reason and no action', () => {
    const c = recommendationContext(contextItem('sponsored', card, { reasons: ['Because you like Coffee'] }));
    expect(c.destination).toEqual({ kind: 'navigate', screen: 'BrandOffers', params: { highlightOfferId: 'p9' } });
    expect(c.reason).toBeNull();
    expect(c.action).toBeNull();
    expect(recommendationContext(contextItem('sponsored', { ...card, item_kind: 'business', item_id: null })).destination)
      .toEqual({ kind: 'navigate', screen: 'BusinessProfile', params: { partnerId: 'bp1' } });
    expect(recommendationContext(contextItem('sponsored', { ...card, item_id: null })).destination).toBeNull();
  });
  it('the label stays, the tap is recorded then follows the shared rule, and no organic code reads sponsorship', () => {
    const slot = read('components/SponsoredSpotlightSlot.js');
    expect(slot).toMatch(/recordSponsoredTap\(card\.placement_id\)[\s\S]*openDestination\(navigation, recommendationContext\(contextItem\('sponsored', card\)\)\.destination\)/);
    expect(slot).not.toMatch(/navigation\.navigate\(/);
    expect(read('components/SponsoredCard.js')).toMatch(/SPONSORED_LABEL/);
    // ranking / selection code only (the context module maps a sponsored card's ids for its destination, nothing else)
    for (const f of ['utils/homeAttention.js', 'constants/signalPriority.js', 'utils/discoverSections.js', 'utils/gatheringFeedRanking.js']) {
      const code = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(code).not.toMatch(/placement_id|sponsored_(seen|payments)|getSponsoredSpotlight/);
    }
  });
});

describe('exceptions kept on purpose', () => {
  it('literal keyword search rows show only when/where, no recommendation reason', () => {
    const src = read('screens/DiscoverHubScreen.js');
    const block = src.slice(src.indexOf('{gatheringsToShow.map((g) =>'), src.indexOf('{showCommunities && isSearching && loadingSearch'));
    expect(block).toMatch(/card\.meta/);
    expect(block).not.toMatch(/card\.reasons|card\.why|primaryReasonLine/);
  });
});

describe('the context module never ranks', () => {
  it('builds presentation only: no score, tier or compare function reads it', () => {
    const code = read('utils/recommendationContext.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/\bscore\b|rankVector|compareRanked|tierVector/);
  });
});
