const { formatOccasionRecallSummary, occasionRecallLikedText } = require('./occasionRecall');

describe('formatOccasionRecallSummary', () => {
  it('composes a real summary from all three real parts', () => {
    const recall = {
      planType: 'business', partnerName: 'Bella Trattoria', offer_price: 65, price_is_per_person: true,
      proposedTime: '2026-09-19T19:00:00.000Z',
    };
    const result = formatOccasionRecallSummary(recall);
    expect(result).toContain('Bella Trattoria');
    expect(result).toContain('$65.00/person');
  });

  it('omits a missing part rather than fabricating it', () => {
    expect(formatOccasionRecallSummary({ planType: 'business', partnerName: 'Bella Trattoria' })).toBe('Bella Trattoria');
    expect(formatOccasionRecallSummary({ planType: 'business', offer_price: 40 })).toBe('$40.00');
  });

  it('never renders a flat (non-per-person) price with the /person suffix', () => {
    expect(formatOccasionRecallSummary({ planType: 'business', offer_price: 40, price_is_per_person: false })).toBe('$40.00');
  });

  it('returns null for a gathering-type recall, or no recall at all', () => {
    expect(formatOccasionRecallSummary({ planType: 'gathering', gatheringTitle: 'Picnic' })).toBeNull();
    expect(formatOccasionRecallSummary(null)).toBeNull();
    expect(formatOccasionRecallSummary({ planType: 'business' })).toBeNull();
  });
});

describe('occasionRecallLikedText', () => {
  it('returns real, honest text for a loved_it rating', () => {
    expect(occasionRecallLikedText({ planType: 'business', satisfactionRating: 'loved_it' })).toBe('You loved it last time!');
  });

  it('returns text for a good rating with a real willingness to repeat', () => {
    expect(occasionRecallLikedText({ planType: 'business', satisfactionRating: 'good', wouldRepeat: 'yes' })).toBe('You liked it last time.');
    expect(occasionRecallLikedText({ planType: 'business', satisfactionRating: 'good', wouldRepeat: 'no' })).toBeNull();
  });

  it('never fabricates positivity for a missing, neutral, or negative rating', () => {
    expect(occasionRecallLikedText({ planType: 'business' })).toBeNull();
    expect(occasionRecallLikedText({ planType: 'business', satisfactionRating: 'okay' })).toBeNull();
    expect(occasionRecallLikedText({ planType: 'business', satisfactionRating: 'not_for_me' })).toBeNull();
    expect(occasionRecallLikedText(null)).toBeNull();
    expect(occasionRecallLikedText({ planType: 'gathering', satisfactionRating: 'loved_it' })).toBeNull();
  });
});
