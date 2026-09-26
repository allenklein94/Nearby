import fs from 'fs';
import path from 'path';
import { DIETARY_OPTIONS } from './businessAttributes';
import {
  DIETARY_KEYS, BUSINESS_DIETARY_OPTIONS, dietaryOptionsOf, dietaryOptionsLine, dietaryRelevantFor, dietaryFromAsk,
  applyDietaryToCandidates, dietaryCovers, DIETARY_FIT_POINTS,
} from './dietaryOptions';
import { attributesFromAsk } from './askFacets';
import { scoreBusinessOpportunity } from '../services/businessOpportunityScoring';

const ROOT = path.join(__dirname, '../..');
const r = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const mig = r('supabase/migrations/20270230_business_dietary_options.sql');

describe('business dietary options (item 88): one vocabulary, two views', () => {
  it('the business keys ARE the request dietary keys, and == the new CHECK and setter list', () => {
    expect(BUSINESS_DIETARY_OPTIONS.map((o) => o.key)).toEqual(DIETARY_OPTIONS.map((o) => o.key));
    const lists = [...mig.matchAll(/array\['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher'\]/g)];
    expect(lists.length).toBe(2); // table CHECK + setter
    expect(DIETARY_KEYS).toEqual(['vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'nut_allergy', 'shellfish_allergy', 'halal', 'kosher']);
  });
  it('owner-facing wording names an offer, allergies are "can accommodate", nothing declared = hidden', () => {
    expect(dietaryOptionsLine({ dietary_options: ['halal', 'vegan'] })).toBe('Vegan options · Halal');
    expect(dietaryOptionsLine({ dietary_options: ['nut_allergy'] })).toBe('Can accommodate nut allergies');
    expect(dietaryOptionsLine({ dietary_options: [] })).toBeNull();
    expect(dietaryOptionsLine({})).toBeNull();
    expect(dietaryOptionsOf({ dietary_options: ['vegan', 'bogus'] })).toEqual(['vegan']);
  });
  it('asked only where relevant: food businesses, or one that already declared some', () => {
    expect(dietaryRelevantFor({ category: 'food_drink' })).toBe(true);
    expect(dietaryRelevantFor({ category: 'entertainment_nightlife', attributes: ['food_available'] })).toBe(true);
    expect(dietaryRelevantFor({ category: 'events', attributes: ['catering'] })).toBe(true);
    expect(dietaryRelevantFor({ category: 'activities_recreation', cuisine: 'thai' })).toBe(true);
    expect(dietaryRelevantFor({ category: 'auto' })).toBe(false);
    expect(dietaryRelevantFor({ category: 'wellness_beauty', attributes: ['quiet'] })).toBe(false);
    expect(dietaryRelevantFor({ category: 'auto', dietary_options: ['vegan'] })).toBe(true);
  });
});

describe('the ask side: the person\'s own words only', () => {
  it('reads explicit dietary words', () => {
    expect(dietaryFromAsk('vegan dinner tonight')).toEqual(['vegan']);
    expect(dietaryFromAsk('somewhere with gluten-free options for my celiac friend')).toEqual(['gluten_free']);
    expect(dietaryFromAsk('halal or kosher lunch')).toEqual(['halal', 'kosher']);
    expect(dietaryFromAsk('my son has a peanut allergy')).toEqual(['nut_allergy']);
    expect(dietaryFromAsk('allergic to shellfish')).toEqual(['shellfish_allergy']);
    expect(dietaryFromAsk('lactose intolerant, need dairy-free')).toEqual(['dairy_free']);
    expect(dietaryFromAsk('plant-based brunch')).toEqual(['vegan']);
  });
  it('infers nothing from food words, cuisine or negation', () => {
    for (const t of ['dinner tonight', 'thai food', 'a salad place', 'vegetable soup', 'non-vegetarian thali', 'not vegan, just hungry', 'sushi'])
      expect([t, dietaryFromAsk(t)]).toEqual([t, []]);
  });
  it('accessibility words become the existing accessibility attributes (no AI needed)', () => {
    expect(attributesFromAsk('dinner somewhere wheelchair accessible')).toContain('wheelchair_accessible');
    expect(attributesFromAsk('my grandma uses a wheelchair')).toContain('wheelchair_accessible');
    expect(attributesFromAsk('need accessible parking')).toContain('accessible_parking');
    expect(attributesFromAsk('with an accessible restroom')).toContain('accessible_restroom');
    for (const t of ['an accessible price', 'easy to get to', 'dinner tonight'])
      expect([t, attributesFromAsk(t).some((a) => a.startsWith('accessible') || a === 'wheelchair_accessible')]).toEqual([t, false]);
  });
});

describe('matching ranks, never removes', () => {
  const biz = (id, dietary) => ({ id, type: 'business_availability', score: 1, businessPartner: dietary === undefined ? undefined : { dietary_options: dietary } });
  it('lifts a business that declared EVERY need; partial / undeclared / no partner row stay put', () => {
    const list = [biz('all', ['vegan', 'gluten_free']), biz('part', ['vegan']), biz('none', []), biz('unknown')];
    const out = applyDietaryToCandidates(list, ['vegan', 'gluten_free']);
    expect(out.map((c) => c.score)).toEqual([1 + DIETARY_FIT_POINTS, 1, 1, 1]);
    expect(out[0].dietaryReason).toBe('Vegan options · Gluten-free options');
    expect(out).toHaveLength(4);
    expect(applyDietaryToCandidates(list, [])).toBe(list);
  });
  it('business side: the opportunity reason fires only on full coverage', () => {
    expect(dietaryCovers({ dietary_options: ['halal'] }, ['halal'])).toBe(true);
    expect(dietaryCovers({ dietary_options: ['halal'] }, ['halal', 'nut_allergy'])).toBe(false);
    expect(dietaryCovers({ dietary_options: ['halal'] }, [])).toBeNull();
    const keys = (req, biz) => scoreBusinessOpportunity({ requestDietary: req, businessDietaryOptions: biz }).reasons.map((x) => x.key);
    expect(keys(['vegan'], ['vegan', 'vegetarian'])).toContain('dietary');
    expect(keys(['vegan', 'kosher'], ['vegan'])).not.toContain('dietary');
    expect(keys([], ['vegan'])).not.toContain('dietary');
  });
  it('routing: a covering business goes ahead, nothing is filtered by dietary', () => {
    expect(mig).toMatch(/\(cardinality\(coalesce\(v_req_dietary, '\{\}'\)\) > 0 and coalesce\(e\.dietary_options, '\{\}'\) @> v_req_dietary\) desc/);
    expect(mig).toMatch(/_business_request_fanout dietary patch did not apply/);
    expect(mig).not.toMatch(/where[^\n]*dietary_options/);
  });
});

describe('structured and declared only; wired where it matters', () => {
  it('the only writer is the owner setter; nothing derives it from text, menus, cuisine or photos', () => {
    expect(mig).toMatch(/managed_partner_id = partner_id_param/);
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const writers = walk(path.join(ROOT, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f) && /set_business_dietary_options/.test(fs.readFileSync(f, 'utf8')));
    expect(writers.map((f) => path.relative(ROOT, f))).toEqual(['src/services/brandOffers.js']);
    for (const fn of ['create-assistant', 'business-onboarding-assistant', 'screen-business-content', 'submit-business-application'])
      expect(r(`supabase/functions/${fn}/index.ts`)).not.toMatch(/dietary_options/);
    expect(r('src/constants/dietaryOptions.js').match(/export function dietaryOptionsOf[\s\S]*?\n}/)[0]).not.toMatch(/description|menu|cuisine|photo/);
  });
  it('an access or dietary need from an ask is never stored on the person', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter((f) => f >= '20270230');
    for (const f of migs) expect(r(`supabase/migrations/${f}`)).not.toMatch(/alter table public\.profiles/);
  });
  it('dashboard, public profile, resolver and card are wired', () => {
    const dash = r('src/screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/dietaryRelevantFor\(selectedPartner\)/);
    expect(dash).toMatch(/setBusinessDietaryOptions\(selectedPartner\.id, v\)/);
    expect(dash).toMatch(/requestDietary: req\.dietary/);
    expect(r('src/screens/BusinessProfileScreen.js')).toMatch(/dietaryOptionsLine\(partner\)/);
    expect(r('src/services/intentResolver.js')).toMatch(/applyDietaryToCandidates\(deduped, dietaryFromAsk\(rawText\)\)/);
    expect(r('src/services/brandOffers.js')).toMatch(/outdoor_capacity, dietary_options'\)/);
    expect(r('src/utils/businessOpportunityCard.js')).toMatch(/'cuisine', 'dietary', 'party_size'/);
  });
});
