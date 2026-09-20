// Phase 1 of the "Build everything" plan (CLAUDE.md) -- unit tests for
// homeRecommendations.js's pure buildHomeRecommendations() function, same
// "run anywhere, no device/network needed" convention as
// intentResolverScoring.test.js.
const { buildHomeRecommendations, MAX_HOME_RECOMMENDATIONS } = require('./homeRecommendations');

// Forecast facts covering "now" (weather is judged at each gathering's own time).
const H = 3600;
const wx = (block, sun = true) => {
  const nowS = Math.floor(Date.now() / 1000);
  return {
    forecast_blocks: [{ dt: nowS - H, temp: 70, pop: 0, id: 800, ...block }],
    sunrise: sun ? nowS - 2 * H : null,
    sunset: sun ? nowS + 2 * H : null,
  };
};

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
      weather: wx({ pop: 0.8, id: 501 }),
    });
    expect(withRisk[0].reasons).toContain('A good indoor option with weather coming in');

    // Sports is deliberately unclassified -- no bonus either way, even
    // with the identical weather signal.
    const noBonusForAmbiguous = buildHomeRecommendations({
      gatherings: [gathering({ interest_tag: 'Sports', scheduled_at: new Date().toISOString() })],
      weather: wx({ pop: 0.8, id: 501 }),
    });
    expect(noBonusForAmbiguous[0].reasons).not.toContain('A good indoor option with weather coming in');
  });

  it('adds a real outdoor-favorable bonus for a real outdoor category', () => {
    const results = buildHomeRecommendations({
      gatherings: [gathering({ interest_tag: 'Hiking', scheduled_at: new Date().toISOString() })],
      weather: wx({}),
    });
    expect(results[0].reasons).toContain('Great weather for this');
  });

  it('gives no outdoor bonus with an unknown forecast, at night, or with no covering block', () => {
    const g = () => [gathering({ interest_tag: 'Hiking', scheduled_at: new Date().toISOString() })];
    const reasons = (weather) => (buildHomeRecommendations({ gatherings: g(), weather })[0]?.reasons ?? []);
    expect(reasons({ forecast_blocks: null, sunrise: 1, sunset: 2 })).not.toContain('Great weather for this');
    expect(reasons(wx({}, false))).not.toContain('Great weather for this'); // no sun times
    const night = wx({});
    night.sunrise += 6 * H; night.sunset += 6 * H; // now is before sunrise
    expect(reasons(night)).not.toContain('Great weather for this');
    const far = wx({});
    far.forecast_blocks[0].dt += 10 * H; // block does not cover the gathering
    expect(reasons(far)).not.toContain('Great weather for this');
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

  it('credits a loved KIND of experience once, never stacked on a repeat host', () => {
    const today = new Date().toISOString();
    const kind = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'other', interest_tag: 'Outdoor Dining', scheduled_at: today })],
      positiveCategories: new Set(['Outdoor Dining']),
    });
    expect(kind[0].reasons).toContain('You loved this kind of experience last time');
    const both = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1', interest_tag: 'Outdoor Dining', scheduled_at: today })],
      positiveHostIds: new Set(['host1']),
      positiveCategories: new Set(['Outdoor Dining']),
    });
    expect(both[0].reasons).toContain('You loved a gathering with this host before');
    expect(both[0].reasons).not.toContain('You loved this kind of experience last time');
    const none = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'other', interest_tag: 'Board Games', scheduled_at: today })],
      positiveCategories: new Set(['Outdoor Dining']),
    });
    expect(none[0]?.reasons ?? []).not.toContain('You loved this kind of experience last time');
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

  it('Phase J: an omitted accountAgeDays/hasBehavioralHistory produces byte-identical scores to before -- zero regression', () => {
    const withoutMaturity = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1', matchesYourInterests: true, distanceMiles: 0.5 })],
      positiveHostIds: new Set(['host1']),
    });
    const withFullMaturity = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1', matchesYourInterests: true, distanceMiles: 0.5 })],
      positiveHostIds: new Set(['host1']),
      accountAgeDays: 14,
      hasBehavioralHistory: true,
    });
    expect(withoutMaturity[0].score).toBe(withFullMaturity[0].score);
  });

  it('Phase J: dampens the TRANSACTIONAL "loved this host before" bonus for a brand-new, no-history account', () => {
    const mature = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1' })],
      positiveHostIds: new Set(['host1']),
    });
    const brandNew = buildHomeRecommendations({
      gatherings: [gathering({ host_id: 'host1' })],
      positiveHostIds: new Set(['host1']),
      accountAgeDays: 0,
      hasBehavioralHistory: false,
    });
    expect(brandNew[0].score).toBeLessThan(mature[0].score);
    expect(brandNew[0].score).toBeGreaterThan(0);
    // The reason text itself never changes -- it's still honestly true,
    // only the ranking weight behind it is smaller for a thin-history
    // account.
    expect(brandNew[0].reasons).toContain('You loved a gathering with this host before');
  });

  it('Phase J: never dampens EXPLICIT (interests) or CONTEXTUAL (distance/today/weather) bonuses, even at zero maturity', () => {
    const brandNew = buildHomeRecommendations({
      gatherings: [
        gathering({
          matchesYourInterests: true,
          distanceMiles: 0.5,
          scheduled_at: new Date().toISOString(),
        }),
      ],
      weather: { rain_risk: 'high' },
      accountAgeDays: 0,
      hasBehavioralHistory: false,
    });
    const mature = buildHomeRecommendations({
      gatherings: [
        gathering({
          matchesYourInterests: true,
          distanceMiles: 0.5,
          scheduled_at: new Date().toISOString(),
        }),
      ],
      weather: { rain_risk: 'high' },
    });
    expect(brandNew[0].score).toBe(mature[0].score);
  });

  it('caps the merged, sorted result at MAX_HOME_RECOMMENDATIONS', () => {
    const many = Array.from({ length: MAX_HOME_RECOMMENDATIONS + 5 }, (_, i) =>
      gathering({ id: `g${i}`, matchesYourInterests: true })
    );
    const results = buildHomeRecommendations({ gatherings: many });
    expect(results).toHaveLength(MAX_HOME_RECOMMENDATIONS);
  });
});

describe('broad interest group', () => {
  const { buildHomeRecommendations } = require('./homeRecommendations');
  const { CATEGORY_GROUPS } = require('../constants/gatheringCategories');
  const g = CATEGORY_GROUPS[0];
  it('gives a weak reason for a tag in a picked group, none otherwise', () => {
    const gath = { id: 'x', title: 'T', interest_tag: g.tags[0], matchesYourInterests: false };
    const withGroup = buildHomeRecommendations({ gatherings: [gath], interestGroups: [g.key] });
    expect(withGroup[0]?.reasons).toContain('In a category you like');
    const without = buildHomeRecommendations({ gatherings: [gath] });
    expect(without.length).toBe(0);
  });
});
