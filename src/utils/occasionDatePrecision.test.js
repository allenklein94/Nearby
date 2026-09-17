import {
  OCCASION_DATE_PRECISION_OPTIONS,
  occasionDatePrecisionLabel,
  occasionDatePrecisionIcon,
  normalizeOccasionDateForPrecision,
  formatOccasionDateForPrecision,
  occasionDueLabel,
} from './occasionDatePrecision';

describe('occasionDatePrecisionLabel/Icon', () => {
  it('returns the right label/icon for each key', () => {
    expect(occasionDatePrecisionLabel('weekend')).toBe('Weekend');
    expect(occasionDatePrecisionIcon('flexible')).toBe('🌀');
  });

  it('falls back to Exact date for an unrecognized key', () => {
    expect(occasionDatePrecisionLabel('bogus')).toBe('Exact date');
    expect(occasionDatePrecisionIcon('bogus')).toBe('📅');
  });

  it('exposes exactly the 4 real precision values', () => {
    expect(OCCASION_DATE_PRECISION_OPTIONS.map((o) => o.key)).toEqual(['exact', 'weekend', 'around', 'flexible']);
  });
});

describe('normalizeOccasionDateForPrecision', () => {
  it('leaves an exact pick untouched', () => {
    expect(normalizeOccasionDateForPrecision('exact', new Date('2026-10-15T00:00:00'))).toBe('2026-10-15');
  });

  it('leaves an around pick untouched (best-guess anchor)', () => {
    expect(normalizeOccasionDateForPrecision('around', new Date('2026-10-15T00:00:00'))).toBe('2026-10-15');
  });

  it('rounds a weekend pick forward to that week\'s Saturday', () => {
    // 2026-10-15 is a Thursday.
    expect(normalizeOccasionDateForPrecision('weekend', new Date('2026-10-15T00:00:00'))).toBe('2026-10-17');
  });

  it('leaves a pick that already falls on Saturday unchanged', () => {
    expect(normalizeOccasionDateForPrecision('weekend', new Date('2026-10-17T00:00:00'))).toBe('2026-10-17');
  });

  it('rounds a flexible pick to the 1st of that month', () => {
    expect(normalizeOccasionDateForPrecision('flexible', new Date('2026-10-15T00:00:00'))).toBe('2026-10-01');
  });
});

describe('formatOccasionDateForPrecision', () => {
  it('returns an empty string for a missing date', () => {
    expect(formatOccasionDateForPrecision('exact', null)).toBe('');
  });

  it('formats exact as a plain month/day', () => {
    expect(formatOccasionDateForPrecision('exact', '2026-10-15')).toBe('October 15');
  });

  it('formats weekend with a "Weekend of" prefix', () => {
    expect(formatOccasionDateForPrecision('weekend', '2026-10-17')).toBe('Weekend of October 17');
  });

  it('formats around with a short-form "~" prefix', () => {
    expect(formatOccasionDateForPrecision('around', '2026-10-15', { short: true })).toBe('~Oct 15');
  });

  it('formats around with a long-form "Around" prefix', () => {
    expect(formatOccasionDateForPrecision('around', '2026-10-15')).toBe('Around October 15');
  });

  it('formats flexible as "Sometime in {Month}" with no day', () => {
    expect(formatOccasionDateForPrecision('flexible', '2026-10-01')).toBe('Sometime in October 2026');
  });

  it('formats flexible short-form with no year', () => {
    expect(formatOccasionDateForPrecision('flexible', '2026-10-01', { short: true })).toBe('Sometime in Oct');
  });
});

describe('occasionDueLabel', () => {
  it('reads "is today"/"is tomorrow"/"is in N days" for an exact occasion', () => {
    expect(occasionDueLabel('exact', '2026-10-15', 0)).toBe('is today');
    expect(occasionDueLabel('exact', '2026-10-15', 1)).toBe('is tomorrow');
    expect(occasionDueLabel('exact', '2026-10-15', 5)).toBe('is in 5 days');
  });

  it('defaults to exact phrasing when precision is missing (pre-migration rows)', () => {
    expect(occasionDueLabel(undefined, '2026-10-15', 3)).toBe('is in 3 days');
  });

  it('never claims a fake day count for a weekend occasion', () => {
    expect(occasionDueLabel('weekend', '2026-10-17', 2)).toBe('is coming up weekend of Oct 17');
  });

  it('never claims a fake day count for an around occasion', () => {
    expect(occasionDueLabel('around', '2026-10-15', 2)).toBe('is coming up ~Oct 15');
  });

  it('never claims a fake day count for a flexible occasion', () => {
    expect(occasionDueLabel('flexible', '2026-10-01', 20)).toBe('is coming up sometime in Oct');
  });
});
