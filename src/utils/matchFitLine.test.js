import { matchFitLine } from './matchFitLine';

describe('matchFitLine', () => {
  it('renders nothing when the server withheld the aggregate', () => {
    expect(matchFitLine(null)).toBeNull();
    expect(matchFitLine(undefined)).toBeNull();
    expect(matchFitLine({ pct_yes: null })).toBeNull();
  });
  it('shows yes / somewhat / no, dropping zero buckets', () => {
    expect(matchFitLine({ people_count: 6, pct_yes: 67, pct_somewhat: 17, pct_no: 17 }))
      .toBe('How well your matches land: 67% yes · 17% somewhat · 17% no');
    expect(matchFitLine({ people_count: 5, pct_yes: 100, pct_somewhat: 0, pct_no: 0 }))
      .toBe('How well your matches land: 100% yes');
  });
  it('never carries an identity or people count', () => {
    expect(matchFitLine({ people_count: 5, pct_yes: 80, pct_somewhat: 20, pct_no: 0 })).not.toMatch(/people|reviewer/i);
  });
});
