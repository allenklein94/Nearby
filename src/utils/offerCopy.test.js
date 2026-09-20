const fs = require('fs');
const path = require('path');
const { businessReplyTitle, offerRevealHeader } = require('./offerCopy');

describe('offer copy is a personal response, not an ad', () => {
  it('says "made you an offer" only for a real offer', () => {
    expect(businessReplyTitle('Coastal Coffee', { status: 'offered' })).toBe('Coastal Coffee made you an offer');
    expect(businessReplyTitle('Coastal Coffee', { status: 'accepted' })).toBe('Coastal Coffee made you an offer');
    expect(businessReplyTitle('Coastal Coffee', { status: 'declined' })).toBe('Coastal Coffee responded to your request');
    expect(businessReplyTitle('Coastal Coffee', { status: 'withdrawn' })).toBe('Coastal Coffee responded to your request');
    expect(businessReplyTitle(null, { status: 'offered' })).toBe('A local business made you an offer');
  });
  it('the reveal header uses the same wording', () => {
    expect(offerRevealHeader('Coastal Coffee')).toBe('Coastal Coffee made you an offer');
  });
  it('no consumer offer surface uses ad language', () => {
    for (const f of ['screens/BusinessRequestDetailScreen.js', 'screens/ActivityScreen.js', 'components/OfferReveal.js', 'components/OfferMedia.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/sponsored|promoted content|advertisement/i);
    }
  });
  it('the offer push says "made you an offer"', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270153_offer_push_personal_copy.sql'), 'utf8');
    expect(sql).toMatch(/made you an offer/);
    expect(sql).not.toMatch(/sent you "/);
  });
});
