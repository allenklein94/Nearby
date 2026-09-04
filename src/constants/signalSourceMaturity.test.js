// Phase J (CLAUDE.md) -- unit tests for signalSourceMaturity.js's two pure
// functions, same "run anywhere, no device/network needed" convention as
// intentResolverScoring.test.js / recommendationReasonVocabulary.test.js.
const {
  SIGNAL_SOURCES,
  MATURITY_WINDOW_DAYS,
  MIN_MATURITY_WITH_HISTORY,
  computeAccountMaturity,
  weightSignal,
} = require('./signalSourceMaturity');

describe('computeAccountMaturity', () => {
  it('defaults to full trust when no inputs are given -- a caller that never wires this up sees no change', () => {
    expect(computeAccountMaturity()).toBe(1);
    expect(computeAccountMaturity({})).toBe(1);
  });

  it('returns a real fraction of elapsed real days for a brand-new account with no history', () => {
    expect(computeAccountMaturity({ accountAgeDays: MATURITY_WINDOW_DAYS / 2, hasBehavioralHistory: false })).toBe(0.5);
    expect(computeAccountMaturity({ accountAgeDays: 0, hasBehavioralHistory: false })).toBe(0);
  });

  it('reaches full trust once the account is at least MATURITY_WINDOW_DAYS old, history or not', () => {
    expect(computeAccountMaturity({ accountAgeDays: MATURITY_WINDOW_DAYS, hasBehavioralHistory: false })).toBe(1);
    expect(computeAccountMaturity({ accountAgeDays: MATURITY_WINDOW_DAYS * 5, hasBehavioralHistory: false })).toBe(1);
  });

  it('never exceeds 1 even for an implausibly large accountAgeDays', () => {
    expect(computeAccountMaturity({ accountAgeDays: 99999, hasBehavioralHistory: false })).toBe(1);
  });

  it('floors at MIN_MATURITY_WITH_HISTORY the instant real behavioral history exists, even on day zero', () => {
    expect(computeAccountMaturity({ accountAgeDays: 0, hasBehavioralHistory: true })).toBe(MIN_MATURITY_WITH_HISTORY);
    expect(computeAccountMaturity({ accountAgeDays: 1, hasBehavioralHistory: true })).toBe(MIN_MATURITY_WITH_HISTORY);
  });

  it('history never lowers maturity below what real elapsed age alone would already earn', () => {
    const halfway = computeAccountMaturity({ accountAgeDays: MATURITY_WINDOW_DAYS * 0.9, hasBehavioralHistory: true });
    expect(halfway).toBeGreaterThan(MIN_MATURITY_WITH_HISTORY);
    expect(halfway).toBeCloseTo(0.9, 5);
  });
});

describe('weightSignal', () => {
  it('never scales an EXPLICIT or CONTEXTUAL contribution, even at zero maturity', () => {
    expect(weightSignal(5, SIGNAL_SOURCES.EXPLICIT, 0)).toBe(5);
    expect(weightSignal(3, SIGNAL_SOURCES.CONTEXTUAL, 0)).toBe(3);
  });

  it('scales a BEHAVIORAL, SOCIAL, or TRANSACTIONAL contribution by real maturity', () => {
    expect(weightSignal(6, SIGNAL_SOURCES.TRANSACTIONAL, 0.5)).toBe(3);
    expect(weightSignal(6, SIGNAL_SOURCES.SOCIAL, 0.25)).toBe(1.5);
    expect(weightSignal(6, SIGNAL_SOURCES.BEHAVIORAL, 1)).toBe(6);
  });

  it('passes every source through unscaled when maturity itself was never computed', () => {
    expect(weightSignal(6, SIGNAL_SOURCES.TRANSACTIONAL, null)).toBe(6);
    expect(weightSignal(6, SIGNAL_SOURCES.TRANSACTIONAL, undefined)).toBe(6);
  });
});
