import fs from 'fs';
import path from 'path';
import { presentOffer, offerCard, offerMediaView, OFFER_RENDERINGS } from './offerPresentationEngine';
import { resetAssembledForTests, markAssembled } from './offerAssembly';

// Owner item 21 (2026-10-11): one Offer Presentation Engine. offer data + brand assets + offer type + consumer context ->
// static card / animated card / video offer / confirmation. Screens lay out what it returns; they never decide it.

const NOW = new Date(2026, 9, 11, 15, 0);
const later = new Date(2026, 9, 11, 21, 0).toISOString();
const earlier = new Date(2026, 9, 11, 9, 0).toISOString();
const reply = (extra = {}) => ({ id: 'o1', status: 'offered', offer_type: 'standard', viewed_at: null, ...extra });
const ctx = (extra = {}) => ({ context: { now: NOW, playedIds: new Set(), ...extra } });

beforeEach(() => resetAssembledForTests());

describe('which card, from the stored state', () => {
  test.each([
    ['pending', 'waiting'], ['offered', 'open'], ['accepted', 'booked'], ['completed', 'visited'],
    ['declined', 'closed'], ['withdrawn', 'closed'], ['cancelled', 'closed'],
  ])('%s -> %s', (status, card) => expect(offerCard({ status }, NOW)).toBe(card));
  test('an open reply past its valid_until is closed and says it expired', () => {
    const p = presentOffer(reply({ valid_until: earlier }), ctx());
    expect(p.card).toBe('closed');
    expect(p.statusLine).toMatch(/expired/i);
    expect(p.rendering).toBe('static');
  });
});

describe('the four outputs', () => {
  test('animated: a newly received open reply builds itself in, once', () => {
    const played = new Set();
    expect(presentOffer(reply(), ctx({ playedIds: played })).rendering).toBe('animated');
    markAssembled('o1', played);
    expect(presentOffer(reply(), ctx({ playedIds: played })).rendering).toBe('static');
  });
  test('static: already seen, Reduce Motion, or the owner preview', () => {
    expect(presentOffer(reply({ viewed_at: earlier }), ctx()).rendering).toBe('static');
    expect(presentOffer(reply(), ctx({ reduceMotion: true })).rendering).toBe('static');
    expect(presentOffer({ offer_type: 'standard' }, ctx({ viewer: 'owner_preview' })).rendering).toBe('static');
  });
  test('video: tap-to-play only with a screened poster, else an honest label', () => {
    expect(offerMediaView({ media_path: 'a.mp4', media_type: 'video', media_poster_path: 'a.jpg' }).kind).toBe('video');
    expect(offerMediaView({ media_path: 'a.mp4', media_type: 'video' }).kind).toBe('video_label');
    expect(offerMediaView({ media_path: 'a.jpg', media_type: 'image' }).kind).toBe('image');
    expect(offerMediaView({})).toBeNull();
  });
  test('confirmation: the booked card, "You\'re booked" only for a confirmed reservation, plays only after the tap', () => {
    const booked = presentOffer({ id: 'o1', status: 'accepted', business_reservations: [{ status: 'confirmed' }] }, ctx({ justAccepted: true }));
    expect(booked.rendering).toBe('confirmation');
    expect(booked.confirmation).toMatchObject({ booked: true, titleKey: 'ui.requestDetail.youreBooked', plays: true, visitConfirmed: false });
    const noRow = presentOffer({ id: 'o1', status: 'accepted' }, ctx());
    expect(noRow.confirmation).toMatchObject({ booked: false, state: 'accepted', plays: false });
    expect(presentOffer({ id: 'o1', status: 'completed', business_reservations: [{ status: 'confirmed' }] }, ctx()).confirmation.visitConfirmed).toBe(true);
  });
  test('every rendering is one of the declared ones', () => {
    for (const o of [reply(), { status: 'accepted' }, { status: 'declined' }, { status: 'pending' }]) {
      expect(OFFER_RENDERINGS).toContain(presentOffer(o, ctx()).rendering);
    }
  });
});

describe('copy comes from the one source', () => {
  test('heard line: first-ever wording only for the customer, never in the owner preview', () => {
    expect(presentOffer(reply(), ctx({ isFirstEverReply: true })).heard).toMatch(/first/i);
    expect(presentOffer(reply(), ctx({ viewer: 'owner_preview', isFirstEverReply: true })).heard).not.toMatch(/first/i);
  });
  test('the reply kind decides the status line (item 121)', () => {
    expect(presentOffer(reply({ offer_type: 'alt_time' }), ctx()).replyKind).toBe('alternative');
    expect(presentOffer(reply({ discount_pct: 20 }), ctx()).replyKind).toBe('offer');
    expect(presentOffer(reply(), ctx()).replyKind).toBe('availability');
  });
  test('redeem instructions only on the booked card', () => {
    expect(presentOffer(reply({ redemption_instructions: 'Show this' }), ctx()).redemption).toBeNull();
    expect(presentOffer({ status: 'accepted', redemption_instructions: 'Show this' }, ctx()).redemption).toBe('Show this');
  });
});

describe('fairness (item 17)', () => {
  test('two businesses with the same content get the same presentation, whatever their brand', () => {
    const a = presentOffer(reply({ id: 'a', discount_pct: 20 }), { business: { name: 'A', logoUri: 'x' }, ...ctx() });
    const b = presentOffer(reply({ id: 'b', discount_pct: 20 }), { business: { name: 'B', logoUri: null }, ...ctx() });
    const strip = ({ business, ...rest }) => rest;
    expect(strip(a)).toEqual(strip(b));
    expect(Object.keys(a.business)).toEqual(['name', 'logoUri']);
  });
  test('the engine never reads payment, sponsorship, ranking or plan fields', () => {
    const src = fs.readFileSync(path.join(__dirname, 'offerPresentationEngine.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/sponsor|paid|payment|rank|score|priority|is_premium|plan_tier|boost/i);
  });
  test('the customer card, the owner preview, the assembly and the media all read the engine', () => {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/presentOffer\(o,/);
    expect(read('screens/BusinessRequestDetailScreen.js')).not.toMatch(/OFFER_STATUS_COPY|acceptedBookingState\(/);
    expect(read('screens/BusinessDashboardScreen.js')).toMatch(/viewer: 'owner_preview'/);
    expect(read('components/OfferAssembly.js')).toMatch(/assemblesNow\(offer, \{ reduceMotion \}\)/);
    expect(read('components/OfferMedia.js')).toMatch(/offerMediaView\(/);
  });
});
