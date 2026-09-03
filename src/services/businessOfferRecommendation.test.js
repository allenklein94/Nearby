import {
  computeOfferTypeAcceptanceRates,
  bestAcceptedOfferType,
  rankExperiencesForOpportunity,
  buildOfferTitleScaffold,
  MAX_OFFER_SUGGESTIONS,
} from './businessOfferRecommendation';
import { SCORE_INTEREST_MATCH, SCORE_CLOSE_DISTANCE, SCORE_HAPPENING_NOW } from './intentResolverScoring';

describe('computeOfferTypeAcceptanceRates', () => {
  it('returns nothing for a type with fewer than 3 real responded offers', () => {
    const offers = [
      { offer_type: 'discount', responded_at: '2026-01-01', status: 'accepted' },
      { offer_type: 'discount', responded_at: '2026-01-02', status: 'accepted' },
    ];
    expect(computeOfferTypeAcceptanceRates(offers)).toEqual({});
  });

  it('computes a real accepted/responded percentage once the sample is large enough', () => {
    const offers = [
      { offer_type: 'discount', responded_at: '2026-01-01', status: 'accepted' },
      { offer_type: 'discount', responded_at: '2026-01-02', status: 'completed' },
      { offer_type: 'discount', responded_at: '2026-01-03', status: 'declined' },
      { offer_type: 'discount', responded_at: '2026-01-04', status: 'declined' },
    ];
    expect(computeOfferTypeAcceptanceRates(offers)).toEqual({
      discount: { rate: 50, sampleSize: 4 },
    });
  });

  it('ignores offers with no responded_at (still pending) and offers of a different type', () => {
    const offers = [
      { offer_type: 'discount', responded_at: null, status: 'pending' },
      { offer_type: 'discount', responded_at: '2026-01-01', status: 'accepted' },
      { offer_type: 'discount', responded_at: '2026-01-02', status: 'accepted' },
      { offer_type: 'discount', responded_at: '2026-01-03', status: 'accepted' },
      { offer_type: 'perk', responded_at: '2026-01-04', status: 'declined' },
    ];
    expect(computeOfferTypeAcceptanceRates(offers)).toEqual({
      discount: { rate: 100, sampleSize: 3 },
    });
  });
});

describe('bestAcceptedOfferType', () => {
  it('returns null when no type has enough real history', () => {
    expect(bestAcceptedOfferType({})).toBeNull();
  });

  it('picks the real highest-rate type', () => {
    const rates = {
      discount: { rate: 40, sampleSize: 5 },
      perk: { rate: 80, sampleSize: 3 },
    };
    expect(bestAcceptedOfferType(rates)).toEqual({ offerType: 'perk', rate: 80, sampleSize: 3 });
  });
});

describe('rankExperiencesForOpportunity', () => {
  it('returns an empty list when nothing overlaps, never a padded fallback', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: [],
      experiences: [{ id: 'e1', active: true, title: 'A Date Here', attributes: ['date_friendly'] }],
    });
    expect(result).toEqual([]);
  });

  it('scores a real attribute overlap at SCORE_INTEREST_MATCH', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      experiences: [{ id: 'e1', active: true, title: 'A Date Here', attributes: ['date_friendly'] }],
    });
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(SCORE_INTEREST_MATCH);
    expect(result[0].reasons).toEqual([
      { label: 'Matches what this request is looking for', points: SCORE_INTEREST_MATCH },
    ]);
  });

  it('stacks a real party-type match on top of an attribute match', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      requestPartyType: 'date',
      experiences: [{ id: 'e1', active: true, title: 'A Date Here', attributes: ['date_friendly'], party_type: 'date' }],
    });
    expect(result[0].score).toBe(SCORE_INTEREST_MATCH + SCORE_INTEREST_MATCH);
    expect(result[0].reasons).toHaveLength(2);
  });

  it('scores a real price-level match at SCORE_HAPPENING_NOW', () => {
    const result = rankExperiencesForOpportunity({
      requestPriceLevel: '$$',
      experiences: [{ id: 'e1', active: true, title: 'Nice Dinner', attributes: [], price_level: '$$' }],
    });
    expect(result[0].score).toBe(SCORE_HAPPENING_NOW);
  });

  it('scores a real fulfillment-policy party-size fit at SCORE_CLOSE_DISTANCE', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      requestPartySize: 4,
      experiences: [{ id: 'e1', active: true, title: 'A Date Here', attributes: ['date_friendly'] }],
      fulfillmentPolicy: { party_size_min: 2, party_size_max: 8 },
    });
    expect(result[0].reasons.map((r) => r.label)).toContain('Within your usual party size range');
    expect(result[0].score).toBe(SCORE_INTEREST_MATCH + SCORE_CLOSE_DISTANCE);
  });

  it('never credits a party-size fit when the request falls outside the policy range', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      requestPartySize: 20,
      experiences: [{ id: 'e1', active: true, title: 'A Date Here', attributes: ['date_friendly'] }],
      fulfillmentPolicy: { party_size_min: 2, party_size_max: 8 },
    });
    expect(result[0].score).toBe(SCORE_INTEREST_MATCH);
  });

  it('excludes an inactive experience even if it would otherwise match', () => {
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      experiences: [{ id: 'e1', active: false, title: 'A Date Here', attributes: ['date_friendly'] }],
    });
    expect(result).toEqual([]);
  });

  it('sorts highest-scoring experience first and caps at MAX_OFFER_SUGGESTIONS', () => {
    const experiences = [
      { id: 'low', active: true, title: 'Low', attributes: ['date_friendly'] },
      { id: 'high', active: true, title: 'High', attributes: ['date_friendly'], party_type: 'date' },
      { id: 'e3', active: true, title: 'E3', attributes: ['date_friendly'] },
      { id: 'e4', active: true, title: 'E4', attributes: ['date_friendly'] },
    ];
    const result = rankExperiencesForOpportunity({
      requestAttributes: ['date_friendly'],
      requestPartyType: 'date',
      experiences,
    });
    expect(result.length).toBeLessThanOrEqual(MAX_OFFER_SUGGESTIONS);
    expect(result[0].experienceId).toBe('high');
  });
});

describe('buildOfferTitleScaffold', () => {
  it('builds a real scaffold from a real occasion + category', () => {
    expect(buildOfferTitleScaffold({ occasion: 'birthday', category: 'Foodie' })).toBe('Birthday Foodie');
  });

  it('returns null when occasion is missing -- never fabricates one', () => {
    expect(buildOfferTitleScaffold({ occasion: null, category: 'Foodie' })).toBeNull();
  });

  it('returns null when category is missing -- never fabricates one', () => {
    expect(buildOfferTitleScaffold({ occasion: 'birthday', category: null })).toBeNull();
  });

  it('returns null when both are missing', () => {
    expect(buildOfferTitleScaffold({})).toBeNull();
  });
});
