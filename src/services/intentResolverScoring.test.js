// 10/10 roadmap Part 8: technical validation. Unit tests for
// intentResolverScoring.js's pure functions -- run anywhere, no
// device/network needed.
const {
  extractMeaningfulWords,
  titleMentionBonus,
  matchesDateWindow,
  dateWindowToDateRange,
  scoreGatheringForResolver,
  priceAndPartyBonus,
  attributeAndCuisineBonus,
  SCORE_HAPPENING_NOW,
  SCORE_INTEREST_MATCH,
  SCORE_CLOSE_DISTANCE,
  SCORE_CONFIRMED_AVAILABILITY_FLOOR,
} = require('./intentResolverScoring');

describe('extractMeaningfulWords', () => {
  it('keeps 4+ character words and drops stopwords', () => {
    // "want", "find", and "tonight" are all in the stopword list on
    // purpose (see the source file's own comment) -- only "pickleball"
    // and "game" survive.
    expect(extractMeaningfulWords('I want to find a pickleball game tonight')).toEqual(['pickleball', 'game']);
  });

  it('returns an empty array for null/empty input', () => {
    expect(extractMeaningfulWords(null)).toEqual([]);
    expect(extractMeaningfulWords('')).toEqual([]);
  });

  it('is case-insensitive and strips punctuation', () => {
    expect(extractMeaningfulWords('COFFEE, anyone?')).toEqual(['coffee', 'anyone']);
  });
});

describe('titleMentionBonus', () => {
  it('awards the bonus when the title contains a meaningful word', () => {
    expect(titleMentionBonus('Pickleball Meetup', ['pickleball'])).toBe(SCORE_HAPPENING_NOW);
  });

  it('awards nothing when there is no overlap', () => {
    expect(titleMentionBonus('Coffee Chat', ['pickleball'])).toBe(0);
  });

  it('awards nothing with no meaningful words or no title', () => {
    expect(titleMentionBonus('Coffee Chat', [])).toBe(0);
    expect(titleMentionBonus(null, ['coffee'])).toBe(0);
  });
});

describe('priceAndPartyBonus', () => {
  it('awards the bonus when price_level matches', () => {
    expect(priceAndPartyBonus({ price_level: '$$', party_type: null }, '$$', null)).toBe(SCORE_HAPPENING_NOW);
  });

  it('awards the bonus when party_type matches', () => {
    expect(priceAndPartyBonus({ price_level: null, party_type: 'solo' }, null, 'solo')).toBe(SCORE_HAPPENING_NOW);
  });

  it('does not double-count when both match', () => {
    expect(priceAndPartyBonus({ price_level: '$', party_type: 'date' }, '$', 'date')).toBe(SCORE_HAPPENING_NOW);
  });

  it('awards nothing when nothing was implied by the ask', () => {
    expect(priceAndPartyBonus({ price_level: '$', party_type: 'solo' }, null, null)).toBe(0);
  });

  it('awards nothing for a real mismatch, never a fabricated match', () => {
    expect(priceAndPartyBonus({ price_level: '$$$', party_type: 'groups' }, '$', 'date')).toBe(0);
  });

  it('awards nothing when the gathering itself never set a value', () => {
    expect(priceAndPartyBonus({ price_level: null, party_type: null }, '$', 'solo')).toBe(0);
  });
});

// Taxonomy Post-Implementation Audit remediation (CLAUDE.md, Aug 28 2026),
// item 3.
describe('attributeAndCuisineBonus', () => {
  it('awards a bonus for a real cuisine match', () => {
    expect(attributeAndCuisineBonus({ cuisine: 'italian', attributes: [] }, [], 'italian')).toBe(SCORE_HAPPENING_NOW);
  });

  it('awards a bonus for a real attribute overlap', () => {
    expect(attributeAndCuisineBonus({ cuisine: null, attributes: ['outdoor_seating', 'quiet'] }, ['outdoor_seating'], null)).toBe(SCORE_HAPPENING_NOW);
  });

  it('awards both bonuses additively when cuisine and attributes both match -- these are two separate signals, unlike priceAndPartyBonus', () => {
    expect(attributeAndCuisineBonus({ cuisine: 'italian', attributes: ['date_friendly'] }, ['date_friendly'], 'italian')).toBe(SCORE_HAPPENING_NOW * 2);
  });

  it('awards nothing when nothing was implied by the ask', () => {
    expect(attributeAndCuisineBonus({ cuisine: 'italian', attributes: ['date_friendly'] }, [], null)).toBe(0);
  });

  it('awards nothing for a real mismatch, never a fabricated match', () => {
    expect(attributeAndCuisineBonus({ cuisine: 'mexican', attributes: ['upscale'] }, ['outdoor_seating'], 'italian')).toBe(0);
  });

  it('awards nothing when the business itself never set a value', () => {
    expect(attributeAndCuisineBonus({ cuisine: null, attributes: [] }, ['outdoor_seating'], 'italian')).toBe(0);
  });

  it('does not award the attribute bonus twice for multiple overlapping attributes', () => {
    expect(attributeAndCuisineBonus({ cuisine: null, attributes: ['outdoor_seating', 'quiet', 'casual'] }, ['outdoor_seating', 'quiet'], null)).toBe(SCORE_HAPPENING_NOW);
  });
});

describe('matchesDateWindow', () => {
  it('always matches when dateWindow is unset or flexible', () => {
    expect(matchesDateWindow(new Date().toISOString(), null)).toBe(true);
    expect(matchesDateWindow(new Date().toISOString(), 'flexible')).toBe(true);
  });

  it('matches "today" only for a timestamp on today\'s calendar date', () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(matchesDateWindow(today.toISOString(), 'today')).toBe(true);
    expect(matchesDateWindow(tomorrow.toISOString(), 'today')).toBe(false);
  });

  it('matches "weekend" for a Saturday and a Sunday, not a weekday', () => {
    // Anchor "now" to a known Wednesday (2026-08-12) so this test is
    // deterministic regardless of when it actually runs.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00Z'));
    try {
      const saturday = new Date('2026-08-15T20:00:00Z').toISOString();
      const sunday = new Date('2026-08-16T10:00:00Z').toISOString();
      const monday = new Date('2026-08-17T10:00:00Z').toISOString();
      expect(matchesDateWindow(saturday, 'weekend')).toBe(true);
      expect(matchesDateWindow(sunday, 'weekend')).toBe(true);
      expect(matchesDateWindow(monday, 'weekend')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('dateWindowToDateRange', () => {
  it('returns null/null for flexible/unset', () => {
    expect(dateWindowToDateRange('flexible')).toEqual({ start: null, end: null });
    expect(dateWindowToDateRange(undefined)).toEqual({ start: null, end: null });
  });

  it('returns a single-day range for "today"', () => {
    const { start, end } = dateWindowToDateRange('today');
    expect(start).toBe(end);
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a genuine Saturday-through-Sunday range for "weekend", never just Saturday', () => {
    const { start, end } = dateWindowToDateRange('weekend');
    const startDate = new Date(`${start}T00:00:00Z`);
    const endDate = new Date(`${end}T00:00:00Z`);
    expect(startDate.getUTCDay()).toBe(6); // Saturday
    expect(endDate.getUTCDay()).toBe(0); // Sunday
    expect(endDate.getTime() - startDate.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('scoreGatheringForResolver', () => {
  it('scores an interest match, close distance, and happening-today independently', () => {
    const todayIso = new Date().toISOString();
    const gathering = { matchesYourInterests: true, distanceMiles: 0.5, scheduled_at: todayIso };
    expect(scoreGatheringForResolver(gathering)).toBe(SCORE_INTEREST_MATCH + SCORE_CLOSE_DISTANCE + SCORE_HAPPENING_NOW);
  });

  it('scores zero for a distant, non-matching, non-today gathering', () => {
    const gathering = { matchesYourInterests: false, distanceMiles: 50, scheduled_at: '2020-01-01T00:00:00Z' };
    expect(scoreGatheringForResolver(gathering)).toBe(0);
  });

  it('does not add distance points at exactly the 2-mile boundary', () => {
    const gathering = { matchesYourInterests: false, distanceMiles: 2, scheduled_at: '2020-01-01T00:00:00Z' };
    expect(scoreGatheringForResolver(gathering)).toBe(0);
  });
});

// Universal Signal Remediation Pass, P0 item 3 (CLAUDE.md, Aug 28 2026):
// a real regression guard for the cross-tier ranking invariant this
// constant exists to protect -- resolvePolicyOnlyBusinesses() (the
// "may be able to help" tier) never awards more than SCORE_CLOSE_DISTANCE,
// so a confirmed business_availability candidate's own minimum possible
// score must always exceed it. This test fails loudly if a future edit
// to either constant quietly reopens the exact bug this floor closed.
describe('SCORE_CONFIRMED_AVAILABILITY_FLOOR', () => {
  it('structurally exceeds policy-only businesses\' own real maximum possible score (SCORE_CLOSE_DISTANCE)', () => {
    expect(SCORE_CONFIRMED_AVAILABILITY_FLOOR).toBeGreaterThan(SCORE_CLOSE_DISTANCE);
  });
});
