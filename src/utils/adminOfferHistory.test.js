import { offerHistorySteps, offerHistoryTitle, historyUnavailable } from './adminOfferHistory';

describe('admin offer history lines (20270416)', () => {
  const at = '2026-11-01T15:00:00Z';
  test('every stored step, in order; missing steps show nothing', () => {
    const steps = offerHistorySteps({ created_at: at, screening: 'low', viewed_at: at, accepted_at: at, completed_at: at });
    expect(steps.map((s) => s.split(' ')[0])).toEqual(['Created', 'Screened:', 'Viewed', 'Accepted', 'Redeemed']);
    expect(offerHistorySteps({ created_at: at, screening: 'low' })).toHaveLength(2);
  });
  test('screening outcome named; automatic replies say so; no record is said, never guessed', () => {
    expect(offerHistorySteps({ screening: 'high' })).toEqual(['Screened: blocked']);
    expect(offerHistorySteps({ screening: 'automatic' })).toEqual(['Automatic reply (not screened)']);
    expect(offerHistorySteps({ screening: null })).toEqual(['Screening: no record']);
  });
  test('title marks kept and reported offers, shortened', () => {
    expect(offerHistoryTitle({ offer_title: 'Coffee for two', source: 'kept', reported: true })).toBe('Coffee for two (kept after deletion, reported)');
    expect(offerHistoryTitle({ offer_title: 'Coffee for two', source: 'live', reported: false })).toBe('Coffee for two');
    expect(offerHistoryTitle({ offer_description: 'x'.repeat(100) }).length).toBe(80);
  });
  test('missing function before deploy = nothing to show', () => {
    expect(historyUnavailable({ code: 'PGRST202' })).toBe(true);
    expect(historyUnavailable({ code: '42501' })).toBe(false);
    expect(historyUnavailable(null)).toBe(false);
  });
});
