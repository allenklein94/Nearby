// 10/10 roadmap Part 8: technical validation. Unit tests for
// intentPatterns.js's pure functions (Part 7's Home progressive
// personalization).
const { findRecurringIntentPattern, formatSmartPlaceholder } = require('./intentPatterns');

// A known Friday evening -- 2026-08-14 is a Friday. Time chosen well past
// 18:00 local so getTimePeriod(now) reliably reads 'evening'.
const FRIDAY_EVENING = new Date('2026-08-14T20:00:00');
// A real Wednesday (2026-08-12), same clock time -- still "evening",
// wrong day-of-week, used to build historical rows that should NOT match.
const WEDNESDAY_EVENING = new Date('2026-08-12T20:00:00');

function fridayRow(daysAgoWeeks, category = 'Coffee') {
  const d = new Date(FRIDAY_EVENING);
  d.setDate(d.getDate() - daysAgoWeeks * 7);
  return { category, created_at: d.toISOString() };
}

describe('findRecurringIntentPattern', () => {
  it('returns null with no rows', () => {
    expect(findRecurringIntentPattern([], FRIDAY_EVENING)).toBeNull();
  });

  it('returns null when the same day/period/category shows up fewer than 3 times', () => {
    const rows = [fridayRow(1), fridayRow(2)];
    expect(findRecurringIntentPattern(rows, FRIDAY_EVENING)).toBeNull();
  });

  it('finds a real recurring Friday-evening-Coffee pattern at 3+ occurrences', () => {
    const rows = [fridayRow(1), fridayRow(2), fridayRow(3)];
    const pattern = findRecurringIntentPattern(rows, FRIDAY_EVENING);
    expect(pattern).toMatchObject({ category: 'Coffee', period: 'evening', count: 3 });
  });

  it('never surfaces a pattern that does not match "right now"', () => {
    const rows = [
      { category: 'Coffee', created_at: WEDNESDAY_EVENING.toISOString() },
      { category: 'Coffee', created_at: WEDNESDAY_EVENING.toISOString() },
      { category: 'Coffee', created_at: WEDNESDAY_EVENING.toISOString() },
    ];
    // These rows form a real Wednesday-evening pattern, but "now" is Friday
    // evening -- must not surface.
    expect(findRecurringIntentPattern(rows, FRIDAY_EVENING)).toBeNull();
  });

  it('ignores rows with no category or no created_at', () => {
    const rows = [
      { category: null, created_at: FRIDAY_EVENING.toISOString() },
      { category: 'Coffee', created_at: null },
      fridayRow(1),
      fridayRow(2),
    ];
    expect(findRecurringIntentPattern(rows, FRIDAY_EVENING)).toBeNull();
  });
});

describe('formatSmartPlaceholder', () => {
  it('formats an evening pattern as "tonight?"', () => {
    expect(formatSmartPlaceholder({ category: 'Coffee', period: 'evening' })).toBe('Coffee tonight?');
  });

  it('formats a weekend pattern as "this weekend?"', () => {
    expect(formatSmartPlaceholder({ category: 'Hiking', period: 'weekend' })).toBe('Hiking this weekend?');
  });

  it('returns null for no pattern', () => {
    expect(formatSmartPlaceholder(null)).toBeNull();
  });
});
