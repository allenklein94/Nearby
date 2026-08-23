// Phase 1 of the "Build everything" plan (CLAUDE.md) -- unit tests for
// homeRecommendations.js's pure buildHomeRecommendations() function, same
// "run anywhere, no device/network needed" convention as
// intentResolverScoring.test.js.
const { buildHomeRecommendations, MAX_HOME_RECOMMENDATIONS } = require('./homeRecommendations');

const gathering = (overrides = {}) => ({
  id: 'g1',
  title: 'Coffee Chat',
  interest_tag: 'Coffee',
  scheduled_at: new Date().toISOString(),
  matchesYourInterests: false,
  distanceMiles: 10,
  ...overrides,
});

const offer = (overrides = {}) => ({
  id: 'o1',
  title: '10% Off',
  target_interest_tag: null,
  partner_id: 'partner1',
  brand_partners: { name: 'Coastal Coffee' },
  ...overrides,
});

describe('buildHomeRecommendations', () => {
  it('returns nothing for empty context', () => {
    expect(buildHomeRecommendations()).toEqual([]);
    expect(buildHomeRecommendations({ gatherings: [], offers: [] })).toEqual([]);
  });

  it('scores a gathering only on real, itemized signals -- never a bare number with no reason', () => {
    const results = buildHomeRecommendations({ gatherings: [gathering({ matchesYourInterests: true })] });
    expect(results).toHaveLength(1);
    expect(results[0].reasons).toContain('Matches your interests');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('excludes a gathering the caller is already committed to', () => {
    const results = buildHomeRecommendations({
      gatherings: [gathering({ matchesYourInterests: true })],
      excludeIds: new Set(['g1']),
    });
    expect(results).toEqual([]);
  });

  it('skips a gathering with no real signal at all -- never fabricates a reason to include it', () => {
    const results = buildHomeRecommendations({ gatherings: [gathering({ scheduled_at: '2020-01-01T00:00:00Z' })] });
    expect(results).toEqual([]);
  });

  it('ranks a closer, interest-matching, happening-today gathering above a plain one', () => {
    const strong = gathering({ id: 'strong', matchesYourInterests: true, distanceMiles: 0.5, scheduled_at: new Date().toISOString() });
    const weak = gathering({ id: 'weak', matchesYourInterests: false, distanceMiles: 40, scheduled_at: new Date().toISOString() });
    const results = buildHomeRecommendations({ gatherings: [weak, strong] });
    expect(results[0].id).toBe('strong');
  });

  it('adds a real weather bonus only for a category this app can honestly classify', () => {
    // Coffee is a real indoor category (constants/gatheringIndoorOutdoor.js)
    const withRisk = buildHomeRecommendations({
      gatherings: [gathering({ scheduled_at: new Date().toISOString() })],
      weather: { rain_risk: 'high' },
    });
    expect(withRisk[0].reasons).toContain('A good indoor option with weather coming in');

    // Sports is deliberately unclassified -- no bonus either way, even
    // with the identical weather signal.
    const noBonusForAmbiguous = buildHomeRecommendations({
      gatherings: [gathering({ interest_tag: 'Sports', scheduled_at: new Date().toISOString() })],
      weather: { rain_risk: 'high' },
    });
    expect(noBonusForAmbiguous[0].reasons).not.toContain('A good indoor option with weather coming in');
  });

  it('adds a real outdoor-favorable bonus for a real outdoor category', () => {
    const results = buildHomeRecommendations({
      gatherings: [gathering({ interest_tag: 'Hiking', scheduled_at: new Date().toISOString() })],
      weather: { outdoor_favorable: true },
    });
    expect(results[0].reasons).toContain('Great weather for this');
  });

  it('scores an offer on real target-interest and business-name signals only', () => {
    const results = buildHomeRecommendations({ offers: [offer({ target_interest_tag: 'Coffee' })] });
    expect(results[0].reasons).toEqual(['Matches your interests', 'At Coastal Coffee']);
  });

  it('still surfaces an untargeted offer, just with a smaller reason set', () => {
    const results = buildHomeRecommendations({ offers: [offer()] });
    expect(results[0].reasons).toEqual(['At Coastal Coffee']);
  });

  it('adds a real "loved this host before" bonus only when the gathering\'s host is in positiveHostIds', () => {
    const withBonus = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1', scheduled_at: new Date().toISOString() })],
      positiveHostIds: new Set(['host1']),
    });
    expect(withBonus[0].reasons).toContain('You loved a gathering with this host before');

    const noBonus = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host2', scheduled_at: new Date().toISOString() })],
      positiveHostIds: new Set(['host1']),
    });
    expect(noBonus[0].reasons).not.toContain('You loved a gathering with this host before');
  });

  it('adds a real "loved this business before" bonus only when the offer\'s partner is in positivePartnerIds', () => {
    const withBonus = buildHomeRecommendations({
      offers: [offer({ partner_id: 'partner1' })],
      positivePartnerIds: new Set(['partner1']),
    });
    expect(withBonus[0].reasons).toContain('You loved this business last time');

    const noBonus = buildHomeRecommendations({
      offers: [offer({ partner_id: 'partner2' })],
      positivePartnerIds: new Set(['partner1']),
    });
    expect(noBonus[0].reasons).not.toContain('You loved this business last time');
  });

  it('caps the merged, sorted result at MAX_HOME_RECOMMENDATIONS', () => {
    const many = Array.from({ length: MAX_HOME_RECOMMENDATIONS + 5 }, (_, i) =>
      gathering({ id: `g${i}`, matchesYourInterests: true })
    );
    const results = buildHomeRecommendations({ gatherings: many });
    expect(results).toHaveLength(MAX_HOME_RECOMMENDATIONS);
  });
});
