const { formatPreciseBucketLine, formatInterestLine } = require('./groupInsightsLabels');

describe('formatPreciseBucketLine', () => {
  test('formats a real precise bucket', () => {
    expect(formatPreciseBucketLine({ label: '25-34', pct: 50 })).toBe('25-34 · 50%');
    expect(formatPreciseBucketLine({ label: 'Women', pct: 67 })).toBe('Women · 67%');
  });

  test('returns null for a suppressed/missing bucket rather than a fake line', () => {
    expect(formatPreciseBucketLine(null)).toBeNull();
    expect(formatPreciseBucketLine({ label: '25-34', pct: null })).toBeNull();
    expect(formatPreciseBucketLine({ label: null, pct: 50 })).toBeNull();
  });
});

describe('formatInterestLine', () => {
  test('coarse tier joins plain interest names with no counts', () => {
    expect(formatInterestLine({ tier: 'coarse', interestNames: ['Coffee', 'Foodie', 'Music'] }))
      .toBe('Coffee · Foodie · Music');
  });

  test('precise tier includes real counts and the shared category icon', () => {
    const line = formatInterestLine({
      tier: 'precise',
      interestCounts: [{ tag: 'Coffee', count: 10 }, { tag: 'Foodie', count: 7 }],
    });
    expect(line).toContain('☕ Coffee · 10');
    expect(line).toContain('🍽️ Foodie · 7');
  });

  test('falls back to coarse names if precise tier has no counts yet', () => {
    expect(formatInterestLine({ tier: 'precise', interestCounts: [], interestNames: ['Coffee'] }))
      .toBe('Coffee');
  });

  test('returns null when there is nothing real to show', () => {
    expect(formatInterestLine({ tier: 'none', interestNames: [], interestCounts: [] })).toBeNull();
    expect(formatInterestLine()).toBeNull();
  });
});
