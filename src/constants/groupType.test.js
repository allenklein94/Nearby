const fs = require('fs');
const path = require('path');
const { EXPERIENCE_PARTY_TYPE_OPTIONS, ACCOMMODATE_PARTY_TYPE_OPTIONS } = require('./businessAttributes');
const { accommodatesPartyTypeBonus, LARGE_GROUP_PARTY_SIZE, SCORE_HAPPENING_NOW } = require('../services/intentResolverScoring');
const { priceAndPartyBonus } = require('../services/intentResolverScoring');
const { LARGE_GROUP_MIN } = require('../services/businessOpportunityScoring');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const KEYS = ['solo', 'friends', 'groups', 'date', 'family', 'coworkers', 'new_people'];
const quoted = (s) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

describe('group type (owner item 43): one closed vocabulary everywhere', () => {
  it('client list, both edge functions and the DB migration agree', () => {
    expect(ACCOMMODATE_PARTY_TYPE_OPTIONS.map((o) => o.key)).toEqual(KEYS);
    for (const f of ['create-assistant', 'business-onboarding-assistant']) {
      expect(quoted(read(`supabase/functions/${f}/index.ts`).match(/VALID_PARTY_TYPES = \[([^\]]*)\]/)[1])).toEqual(KEYS);
    }
    const mig = read('supabase/migrations/20270197_group_type_vocabulary.sql');
    for (const k of ['family', 'coworkers', 'new_people']) expect(mig).toContain(`'${k}'`);
    expect(read('src/screens/CreateGatheringScreen.js')).toMatch(/key: 'coworkers'/);
  });
  it('"coffee" and "coffee with 8 coworkers" rank differently for a business that takes big groups', () => {
    const bigGroupShop = { accommodates_party_types: ['groups'] };
    expect(accommodatesPartyTypeBonus(bigGroupShop, null, null)).toBe(0);
    expect(accommodatesPartyTypeBonus(bigGroupShop, 'coworkers', 8)).toBe(SCORE_HAPPENING_NOW);
    expect(accommodatesPartyTypeBonus({ accommodates_party_types: ['coworkers'] }, 'coworkers', 3)).toBe(SCORE_HAPPENING_NOW);
    expect(accommodatesPartyTypeBonus({ accommodates_party_types: ['solo'] }, 'coworkers', 8)).toBe(0);
  });
  it('large group is derived from the headcount, once, and matches the business-side cutoff', () => {
    expect(LARGE_GROUP_PARTY_SIZE).toBe(LARGE_GROUP_MIN);
    const shop = { accommodates_party_types: ['groups', 'friends'] };
    expect(accommodatesPartyTypeBonus(shop, 'friends', 9)).toBe(SCORE_HAPPENING_NOW); // never stacked
    expect(accommodatesPartyTypeBonus(shop, null, 6)).toBe(0);
    expect(accommodatesPartyTypeBonus(shop, null, 7)).toBe(SCORE_HAPPENING_NOW);
  });
  it('a gathering declared for coworkers matches an ask for coworkers, not friends', () => {
    expect(priceAndPartyBonus({ party_type: 'coworkers', price_level: null }, null, 'coworkers')).toBe(SCORE_HAPPENING_NOW);
    expect(priceAndPartyBonus({ party_type: 'coworkers', price_level: null }, null, 'friends')).toBe(0);
  });
  it('couple and kids are not separate types (couple = date, kids = family + kid_friendly)', () => {
    expect(KEYS).not.toContain('couple');
    expect(KEYS).not.toContain('kids');
  });
});

describe('group type shows up on every surface from the one list', () => {
  it('card labels, the Gatherings People filter and the Discover ask tag all read the shared vocabulary', () => {
    const { PARTY_TYPE_LABELS } = require('./gatheringDisplaySignals');
    for (const k of KEYS) expect(PARTY_TYPE_LABELS[k]).toBeTruthy();
    expect(read('src/screens/GatheringsScreen.js')).toMatch(/PARTY_TYPE_FILTER_OPTIONS = \[\{ key: null, label: 'Any' \}, \.\.\.EXPERIENCE_PARTY_TYPE_OPTIONS/);
    expect(read('src/screens/DiscoverHubScreen.js')).toMatch(/\['family', 'coworkers', 'new_people'\]\.includes/);
  });
});
