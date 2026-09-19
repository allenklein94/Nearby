import fs from 'fs';
import path from 'path';
import { OFFERED_OCCASION_KEYS, OFFERED_OCCASION_OPTIONS, OCCASION_OPTIONS, occasionPhrase } from './businessAttributes';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('Occasions we offer', () => {
  it('is exactly the six agreed occasions, all existing occasion keys (no invented "group events")', () => {
    expect(OFFERED_OCCASION_KEYS).toEqual(['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering']);
    OFFERED_OCCASION_KEYS.forEach((k) => expect(OCCASION_OPTIONS.map((o) => o.key)).toContain(k));
    expect(OFFERED_OCCASION_KEYS).not.toContain('group_events');
  });
  it('labels family_gathering Group/Family for businesses', () => {
    expect(OFFERED_OCCASION_OPTIONS.find((o) => o.key === 'family_gathering').label).toBe('Group/Family');
  });
  it('the client list equals the database CHECK and RPC list', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    const lists = [...mig.matchAll(/array\[([^\]]*)\]::text\[\]/g)].map((m) => m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, '')));
    const offered = lists.filter((l) => l.length === 6);
    expect(offered.length).toBe(2); // the CHECK and the RPC validation
    offered.forEach((l) => expect(l).toEqual(OFFERED_OCCASION_KEYS));
  });
  it('the fan-out ranks an offering business first and never invents a package', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    expect(mig).toMatch(/v_req_occasion = any\(e\.offered_occasions\)\) desc,/);
    expect(mig).toMatch(/insert into business_request_offers \(request_id, partner_id\)/); // plain pending row only
  });
  it('is separate from want-more: its own column and RPC', () => {
    const mig = read('supabase/migrations/20270101_occasions_we_offer.sql');
    expect(mig).toMatch(/add column if not exists offered_occasions/);
    expect(mig).not.toMatch(/set priority_occasions/);
  });
});

describe('occasionPhrase', () => {
  it('uses the right article', () => {
    expect(occasionPhrase('anniversary')).toBe('an anniversary');
    expect(occasionPhrase('birthday')).toBe('a birthday');
    expect(occasionPhrase('date_night')).toBe('a date night');
  });
});

describe('scoring an offered occasion', () => {
  it('credits an offered occasion once, silent without one', () => {
    const r = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessOfferedOccasions: ['anniversary'] });
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.some((x) => /You offer this occasion/.test(x.label))).toBe(true);
    expect(scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessOfferedOccasions: [] }).score).toBe(0);
    expect(scoreBusinessOpportunity({ requestOccasion: null, businessOfferedOccasions: ['anniversary'] }).score).toBe(0);
  });
  it('does not stack on top of the stronger want-more credit', () => {
    const both = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessPriorityOccasions: ['anniversary'], businessOfferedOccasions: ['anniversary'] });
    const wantOnly = scoreBusinessOpportunity({ requestOccasion: 'anniversary', businessPriorityOccasions: ['anniversary'] });
    expect(both.score).toBe(wantOnly.score);
  });
});

// ---- consumer-side discovery (migration 20270102) ----
import {
  businessFitsOccasion, occasionBonus, occasionOfferingScore, dedupeBusinessTiers,
  SCORE_CONFIRMED_AVAILABILITY_FLOOR, SCORE_HAPPENING_NOW,
} from '../services/intentResolverScoring';

describe('consumer-side: businessFitsOccasion / occasionBonus', () => {
  it('an explicit offering counts, and so does want-more; neither stacks', () => {
    expect(businessFitsOccasion({ offered_occasions: ['birthday'] }, 'birthday')).toBe(true);
    expect(businessFitsOccasion({ priority_occasions: ['birthday'] }, 'birthday')).toBe(true);
    expect(occasionBonus({ offered_occasions: ['birthday'], priority_occasions: ['birthday'] }, 'birthday')).toBe(SCORE_HAPPENING_NOW);
  });
  it('is silent without a real occasion or a real declaration', () => {
    expect(occasionBonus({ offered_occasions: ['birthday'] }, null)).toBe(0);
    expect(occasionBonus({ offered_occasions: ['anniversary'] }, 'birthday')).toBe(0);
    expect(occasionBonus({}, 'birthday')).toBe(0);
  });
});

describe('consumer-side: the offers-this-occasion tier', () => {
  it('can never outrank confirmed availability or a package', () => {
    expect(occasionOfferingScore(0.5)).toBeLessThan(SCORE_CONFIRMED_AVAILABILITY_FLOOR);
    expect(occasionOfferingScore(null)).toBeLessThan(SCORE_CONFIRMED_AVAILABILITY_FLOOR);
  });
  it('keeps one card per business at its strongest tier', () => {
    const avail = { type: 'business_availability', partnerId: 'a' };
    const pkg = { type: 'business_occasion_package', partnerId: 'a' };
    const offering = { type: 'business_policy_match', viaOccasionOffering: true, partnerId: 'a' };
    const policy = { type: 'business_policy_match', partnerId: 'a' };
    // live slot + package both stay (different products); the weaker two are dropped
    expect(dedupeBusinessTiers([avail, pkg, offering, policy])).toEqual([avail, pkg]);
    // no live slot/package: offering beats policy-only
    expect(dedupeBusinessTiers([policy, offering])).toEqual([offering]);
    // a package beats offering
    expect(dedupeBusinessTiers([offering, pkg])).toEqual([pkg]);
    // different businesses are untouched, other candidate types pass through
    const other = { type: 'business_policy_match', partnerId: 'b' };
    const gathering = { type: 'gathering', id: 'g' };
    expect(dedupeBusinessTiers([offering, other, gathering])).toEqual([offering, other, gathering]);
  });
});

// ---- one occasion vocabulary across the product ----
describe('occasion vocabulary is shared, not duplicated', () => {
  const { ONBOARDING_OCCASION_KEYS, CELEBRATE_OCCASION_KEYS } = require('./businessAttributes');
  const allKeys = OCCASION_OPTIONS.map((o) => o.key);
  it('onboarding and the celebrate wizard only use keys from the one list', () => {
    ONBOARDING_OCCASION_KEYS.forEach((k) => expect(allKeys).toContain(k));
    CELEBRATE_OCCASION_KEYS.forEach((k) => expect(allKeys).toContain(k));
  });
  it('the consumer intent extractor (create-assistant) can produce every offerable occasion', () => {
    const src = read('supabase/functions/create-assistant/index.ts');
    const list = /const VALID_OCCASIONS = \[([\s\S]*?)\];/.exec(src)[1];
    OFFERED_OCCASION_KEYS.forEach((k) => expect(list).toContain(`'${k}'`));
  });
  it('no offerable occasion key exists outside OCCASION_OPTIONS', () => {
    const keys = OFFERED_OCCASION_KEYS.filter((k) => !allKeys.includes(k));
    expect(keys).toEqual([]);
  });
});
