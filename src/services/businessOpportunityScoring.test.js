import { scoreBusinessOpportunity } from './businessOpportunityScoring';
import { SCORE_INTEREST_MATCH, SCORE_HAPPENING_NOW, SCORE_OWN_NETWORK, SCORE_CLOSE_DISTANCE } from './intentResolverScoring';

describe('scoreBusinessOpportunity', () => {
  it('returns 0 and no reasons when nothing overlaps', () => {
    const result = scoreBusinessOpportunity({});
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('scores a real priority-attribute match at SCORE_OWN_NETWORK', () => {
    const result = scoreBusinessOpportunity({
      requestAttributes: ['date_friendly'],
      businessPriorityAttributes: ['date_friendly'],
    });
    expect(result.score).toBe(SCORE_OWN_NETWORK);
    expect(result.reasons).toEqual([
      { label: 'Matches what you said you want more of', points: SCORE_OWN_NETWORK },
    ]);
  });

  it('scores a general (non-priority) attribute match at SCORE_INTEREST_MATCH', () => {
    const result = scoreBusinessOpportunity({
      requestAttributes: ['outdoor_seating'],
      businessAttributes: ['outdoor_seating'],
      businessPriorityAttributes: [],
    });
    expect(result.score).toBe(SCORE_INTEREST_MATCH);
    expect(result.reasons).toEqual([{ label: 'You already offer this', points: SCORE_INTEREST_MATCH }]);
  });

  it('never double-counts an attribute that is both a priority and a general attribute', () => {
    const result = scoreBusinessOpportunity({
      requestAttributes: ['date_friendly'],
      businessAttributes: ['date_friendly'],
      businessPriorityAttributes: ['date_friendly'],
    });
    expect(result.score).toBe(SCORE_OWN_NETWORK);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].label).toBe('Matches what you said you want more of');
  });

  it('scores a real cuisine match at SCORE_INTEREST_MATCH', () => {
    const result = scoreBusinessOpportunity({
      requestCuisine: 'italian',
      businessCuisine: 'italian',
    });
    expect(result.score).toBe(SCORE_INTEREST_MATCH);
    expect(result.reasons).toEqual([{ label: 'Matches your cuisine', points: SCORE_INTEREST_MATCH }]);
  });

  it('does not credit a cuisine mismatch', () => {
    const result = scoreBusinessOpportunity({
      requestCuisine: 'italian',
      businessCuisine: 'mexican',
    });
    expect(result.score).toBe(0);
  });

  it('scores a real timing fit against a real, anchored date/time (a Saturday, so weekend wins over the hour)', () => {
    const result = scoreBusinessOpportunity({
      requestDate: '2026-08-29', // a real Saturday
      requestTimeWindowStart: '10:00:00',
      businessPriorityTimeWindows: ['weekend'],
    });
    expect(result.score).toBe(SCORE_HAPPENING_NOW);
    expect(result.reasons).toEqual([{ label: 'Fits your usual weekend hours', points: SCORE_HAPPENING_NOW }]);
  });

  it('does not credit timing when the business has no matching priority window', () => {
    const result = scoreBusinessOpportunity({
      requestDate: '2026-08-29',
      requestTimeWindowStart: '10:00:00',
      businessPriorityTimeWindows: ['evening'],
    });
    expect(result.score).toBe(0);
  });

  it('does not attempt a timing score when the request has no date/time at all', () => {
    const result = scoreBusinessOpportunity({
      businessPriorityTimeWindows: ['morning', 'afternoon', 'evening', 'weekend'],
    });
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
  });

  it('scales a real active temporary priority signal by its own real strength', () => {
    const result = scoreBusinessOpportunity({
      requestCategory: 'Coffee',
      activePrioritySignals: [{ category: 'Coffee', strength: 0.5 }],
    });
    expect(result.score).toBe(Math.round(0.5 * SCORE_OWN_NETWORK));
    expect(result.reasons).toEqual([
      { label: "You're actively boosting Coffee this week", points: Math.round(0.5 * SCORE_OWN_NETWORK) },
    ]);
  });

  it('does not credit an active priority signal for a different category', () => {
    const result = scoreBusinessOpportunity({
      requestCategory: 'Coffee',
      activePrioritySignals: [{ category: 'Music', strength: 1 }],
    });
    expect(result.score).toBe(0);
  });

  // Universal Signal Remediation Pass, P1 item 5 (CLAUDE.md, Aug 28 2026).
  it('scores a real budget_max proportionally, capped at SCORE_OWN_NETWORK', () => {
    const atReference = scoreBusinessOpportunity({ requestBudgetMax: 150 });
    expect(atReference.score).toBe(SCORE_OWN_NETWORK);

    const half = scoreBusinessOpportunity({ requestBudgetMax: 75 });
    expect(half.score).toBe(Math.round(0.5 * SCORE_OWN_NETWORK));

    const overReference = scoreBusinessOpportunity({ requestBudgetMax: 500 });
    expect(overReference.score).toBe(SCORE_OWN_NETWORK);

    const low = scoreBusinessOpportunity({ requestBudgetMax: 30 });
    expect(low.score).toBeGreaterThan(0);
    expect(low.score).toBeLessThan(half.score);
  });

  it('a real, present budget always scores strictly higher than a smaller real budget -- never a hard filter', () => {
    const small = scoreBusinessOpportunity({ requestBudgetMax: 20 });
    const large = scoreBusinessOpportunity({ requestBudgetMax: 150 });
    expect(small.score).toBeGreaterThan(0);
    expect(large.score).toBeGreaterThan(small.score);
  });

  it('does not credit a null/zero budget', () => {
    expect(scoreBusinessOpportunity({ requestBudgetMax: null }).score).toBe(0);
    expect(scoreBusinessOpportunity({ requestBudgetMax: 0 }).score).toBe(0);
  });

  // Universal Signal Remediation Pass, P1 item 6 (CLAUDE.md, Aug 28 2026).
  it('scores a real party-size fit against the fulfillment policy range at SCORE_CLOSE_DISTANCE', () => {
    const result = scoreBusinessOpportunity({
      requestPartySize: 4,
      fulfillmentPolicy: { party_size_min: 2, party_size_max: 6 },
    });
    expect(result.score).toBe(SCORE_CLOSE_DISTANCE);
    expect(result.reasons).toEqual([
      { label: 'Within your usual party size range', points: SCORE_CLOSE_DISTANCE },
    ]);
  });

  it('does not credit party size outside the fulfillment policy range', () => {
    expect(
      scoreBusinessOpportunity({
        requestPartySize: 10,
        fulfillmentPolicy: { party_size_min: 2, party_size_max: 6 },
      }).score
    ).toBe(0);
  });

  it('does not attempt a party-size score when the business has no fulfillment policy', () => {
    expect(scoreBusinessOpportunity({ requestPartySize: 4, fulfillmentPolicy: null }).score).toBe(0);
  });

  it('does not attempt a party-size score when the request has no party size at all', () => {
    expect(
      scoreBusinessOpportunity({
        requestPartySize: null,
        fulfillmentPolicy: { party_size_min: 2, party_size_max: 6 },
      }).score
    ).toBe(0);
  });

  // "Intelligent demand inbox" Phase 2 (CLAUDE.md, Sep 3 2026).
  it('scores a real occasion match at SCORE_OWN_NETWORK', () => {
    const result = scoreBusinessOpportunity({
      requestOccasion: 'birthday',
      businessPriorityOccasions: ['birthday', 'anniversary'],
    });
    expect(result.score).toBe(SCORE_OWN_NETWORK);
    expect(result.reasons).toEqual([
      { label: 'Matches an occasion you want more of (birthday)', points: SCORE_OWN_NETWORK },
    ]);
  });

  it('does not credit an occasion mismatch', () => {
    expect(
      scoreBusinessOpportunity({
        requestOccasion: 'date_night',
        businessPriorityOccasions: ['birthday'],
      }).score
    ).toBe(0);
  });

  it('does not credit an occasion match when the business has declared no priority occasions', () => {
    expect(scoreBusinessOpportunity({ requestOccasion: 'birthday', businessPriorityOccasions: [] }).score).toBe(0);
  });

  it('does not attempt an occasion score when the request has no occasion at all', () => {
    expect(
      scoreBusinessOpportunity({
        requestOccasion: null,
        businessPriorityOccasions: ['birthday', 'anniversary', 'celebration'],
      }).score
    ).toBe(0);
  });

  it('combines several real, distinct signals additively, one reason per signal', () => {
    const result = scoreBusinessOpportunity({
      requestAttributes: ['date_friendly', 'outdoor_seating'],
      requestCuisine: 'italian',
      requestCategory: 'Foodie',
      requestDate: '2026-08-29',
      requestTimeWindowStart: '19:00:00',
      businessAttributes: ['outdoor_seating'],
      businessCuisine: 'italian',
      businessPriorityAttributes: ['date_friendly'],
      businessPriorityTimeWindows: ['weekend'],
      activePrioritySignals: [{ category: 'Foodie', strength: 1 }],
    });
    // date_friendly (priority) + outdoor_seating (general) + cuisine + weekend timing + full-strength boost
    expect(result.score).toBe(SCORE_OWN_NETWORK + SCORE_INTEREST_MATCH + SCORE_INTEREST_MATCH + SCORE_HAPPENING_NOW + SCORE_OWN_NETWORK);
    expect(result.reasons).toHaveLength(5);
  });
});

// P1 item 7 (CLAUDE.md, Aug 28 2026 Full Coherence Audit): closes the
// audit's own "Business Opportunity ranking still lives in its own
// weather-blind world" finding, reusing the identical shared weatherBias
// primitive/weight every other weather-aware surface already uses.
describe('scoreBusinessOpportunity weather bonus', () => {
  it('awards SCORE_HAPPENING_NOW for a genuinely indoor-category request when weather is indoor-biased', () => {
    const result = scoreBusinessOpportunity({
      requestCategory: 'Coffee',
      weather: { forecast_label: 'Quiet' },
    });
    expect(result.score).toBe(SCORE_HAPPENING_NOW);
    expect(result.reasons).toEqual([
      { label: 'A good indoor option with weather coming in', points: SCORE_HAPPENING_NOW },
    ]);
  });

  it('awards SCORE_HAPPENING_NOW for a genuinely outdoor-category request when weather is outdoor-biased', () => {
    const result = scoreBusinessOpportunity({
      requestCategory: 'Hiking',
      weather: { forecast_label: 'Excellent' },
    });
    expect(result.score).toBe(SCORE_HAPPENING_NOW);
    expect(result.reasons).toEqual([{ label: 'Great weather for this', points: SCORE_HAPPENING_NOW }]);
  });

  it('awards nothing for a genuinely ambiguous category, even with a real weather signal', () => {
    expect(scoreBusinessOpportunity({ requestCategory: 'Sports', weather: { forecast_label: 'Quiet' } }).score).toBe(0);
  });

  it('awards nothing when weather is unknown (no coordinates / not yet resolved)', () => {
    expect(scoreBusinessOpportunity({ requestCategory: 'Coffee', weather: null }).score).toBe(0);
  });

  it('awards nothing for an indoor category on a genuinely good-weather day (mismatched bias)', () => {
    expect(scoreBusinessOpportunity({ requestCategory: 'Coffee', weather: { forecast_label: 'Excellent' } }).score).toBe(0);
  });

  it('does not double-count -- indoor bias wins over outdoor bias for a mixed signal, matching isWeatherIndoorBiased/isWeatherOutdoorBiased precedence', () => {
    // outdoor_favorable true AND rain_risk high -- indoor always wins.
    const result = scoreBusinessOpportunity({
      requestCategory: 'Coffee',
      weather: { forecast_label: 'Good', rain_risk: 'high', outdoor_favorable: true },
    });
    expect(result.score).toBe(SCORE_HAPPENING_NOW);
    expect(result.reasons).toHaveLength(1);
  });
});
