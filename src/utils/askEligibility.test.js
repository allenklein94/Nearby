// Item 118: typed-ask Stage 1 (eligibility) is one ordered pass of the EXISTING hard constraints, recorded by rule, run before
// any ranking. The resolver-level before/after comparison lives in services/askEligibility.regression.test.js.
const fs = require('fs');
const path = require('path');
const { runAskEligibility, ELIGIBILITY_RULES } = require('./askEligibility');
const { parseAskFacets } = require('../constants/askFacets');

const c = (id, category, extra = {}) => ({ id, type: 'business_availability', partnerId: `p-${id}`, category, score: 10, ...extra });

describe('runAskEligibility', () => {
  it('no constraint in the ask = everyone eligible, nothing recorded', async () => {
    const list = [c('a', 'Coffee'), c('b', null)];
    const out = await runAskEligibility(list, { facets: parseAskFacets('coffee tonight') });
    expect(out.items).toEqual(list);
    expect(out.removed).toEqual({});
  });

  it('records each removal under the first rule that fails, in the canonical order', async () => {
    const list = [c('kids-no', 'Restaurants'), c('wash', 'Car Wash'), c('bar', 'Bars & Lounges'), c('park', 'Parks'), c('cafe', 'Coffee')];
    const out = await runAskEligibility(list, {
      restrictionFacts: { children: true }, declinedLookup: async () => new Map([['p-kids-no', 'children']]),
      isPartnerResult: () => true, isBusiness: () => true,
      openEndedGroups: ['food_drink', 'entertainment_nightlife'],
      facets: parseAskFacets('something fun, no alcohol'),
    });
    expect(out.items.map((x) => x.id)).toEqual(['cafe']); // wash + park are outside the ask's groups, bar is alcohol
    expect(out.removed).toEqual({ compatibility: 1, open_ended: 2, ask_facets: 1 });
    expect(out.compatibilityCaption).toMatch(/children/);
  });

  it('unknown is never a failure: no category / unknown environment / failed lookup all stay', async () => {
    const list = [c('x', null), c('y', null)];
    const out = await runAskEligibility(list, {
      restrictionFacts: { children: true }, declinedLookup: async () => { throw new Error('down'); }, isPartnerResult: () => true,
      openEndedGroups: ['food_drink'], facets: parseAskFacets('something outside, nothing crowded'),
    });
    expect(out.items).toEqual(list);
    expect(out.removed).toEqual({});
  });

  it('open now keeps only confirmed-usable results, only when asked', async () => {
    const { candidateEntity } = require('./operatingStatus');
    const now = Date.now();
    const live = c('live', 'Coffee', { postingStartsAt: new Date(now - 6e5).toISOString(), postingEndsAt: new Date(now + 6e5).toISOString() });
    const unknown = c('unknown', 'Coffee');
    const toEntity = (x) => candidateEntity(x, new Map());
    expect((await runAskEligibility([live, unknown], { openNowOnly: false, toEntity })).items).toHaveLength(2);
    const out = await runAskEligibility([live, unknown], { openNowOnly: true, toEntity });
    expect(out.items.map((x) => x.id)).toEqual(['live']);
    expect(out.removed).toEqual({ open_now: 1 });
  });

  it('the rule list is exactly the existing audit codes', () => {
    const { SIGNAL_CODES } = require('./typedAskAudit');
    for (const r of ELIGIBILITY_RULES) expect(Object.keys(SIGNAL_CODES)).toContain(r);
  });
});

describe('the resolver runs eligibility before any ranking step', () => {
  const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
  const body = src.slice(src.indexOf('export async function resolveIntent('));
  it('Stage 1 comes before the first ranking pass and the trace', () => {
    const elig = body.indexOf('await runAskEligibility(');
    expect(elig).toBeGreaterThan(0);
    expect(elig).toBeLessThan(body.indexOf('createScoreTrace('));
    expect(elig).toBeLessThan(body.indexOf("step('weather')"));
    expect(elig).toBeLessThan(body.indexOf('applyDistanceWillingness('));
    expect(elig).toBeLessThan(body.indexOf('applyTransportMode('));
  });
  it('no removal is left inside the ranking stage', () => {
    const ranking = body.slice(body.indexOf('deduped = eligibility.items;'), body.indexOf('deduped.sort(compareRanked)'));
    expect(ranking.length).toBeGreaterThan(1000);
    for (const f of ['filterOpenNow(', 'narrowToGroup(', 'openEndedEligible(', 'askFacetsEligible(', 'applyRestrictionsToCandidates(', 'applyOpenEndedAsk(', 'applyAskFacets(', 'getDeclinedBusinesses(']) {
      expect(ranking).not.toContain(f);
    }
  });
});
