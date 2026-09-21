import { cleanAgeRange, ageRangeLabel, ageFits, askedChildAges, applySuitedAgesToCandidates, AGE_MIN_OPTIONS, AGE_MAX_OPTIONS } from './suitedAges';
import { practicalFacts } from './gatheringPractical';

const fs = require('fs');
const path = require('path');
const r = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('suited age range (item 50)', () => {
  it('labels exactly what was declared; nothing declared, nothing shown', () => {
    expect(ageRangeLabel(3, 8)).toBe('Ages 3–8');
    expect(ageRangeLabel(5, null)).toBe('Ages 5+');
    expect(ageRangeLabel(null, 12)).toBe('Up to age 12');
    expect(ageRangeLabel(4, 4)).toBe('Age 4');
    expect(ageRangeLabel(null, null)).toBeNull();
    expect(ageRangeLabel(9, 3)).toBeNull(); // an impossible pair is dropped, never shown
    expect(ageRangeLabel(0, 30)).toBe('Ages 0+'); // out-of-range bound dropped
  });
  it('options never reach 21+ (that would be a restriction, a separate decision)', () => {
    expect(Math.max(...AGE_MIN_OPTIONS, ...AGE_MAX_OPTIONS)).toBeLessThanOrEqual(18);
  });
  it('fit is unknown without a declared range', () => {
    expect(ageFits(3, 8, 5)).toBe(true);
    expect(ageFits(3, 8, 10)).toBe(false);
    expect(ageFits(5, null, 12)).toBe(true);
    expect(ageFits(null, null, 5)).toBeNull();
  });
  it('reads a child\'s age only from the person\'s own words', () => {
    expect(askedChildAges('something for my 5 year old')).toEqual([5]);
    expect(askedChildAges('with my 3 and 6 year olds')).toEqual([3, 6]);
    expect(askedChildAges('kids aged 4')).toEqual([4]);
    expect(askedChildAges('my 7-year-old')).toEqual([7]);
    expect(askedChildAges('a 30 year old birthday')).toEqual([]);
    expect(askedChildAges('coffee tonight')).toEqual([]);
  });
  it('ranks a fit up and a known miss down, leaves unknown alone, removes nothing', () => {
    const list = [{ ageMin: 3, ageMax: 8, score: 1 }, { ageMin: 13, ageMax: null, score: 1 }, { score: 1 }];
    const out = applySuitedAgesToCandidates(list, [5]);
    expect(out.map((c) => c.score)).toEqual([3, -1, 1]);
    expect(out[0].subtitle).toBe('Suited to ages 3–8');
    expect(out).toHaveLength(3);
    expect(applySuitedAgesToCandidates(list, [])).toBe(list);
    // a family of a 3 and a 9 needs a range that covers both
    expect(applySuitedAgesToCandidates([{ ageMin: 3, ageMax: 8, score: 0 }], [3, 9])[0].score).toBe(-2);
  });
  it('a gathering shows its declared range, and the DB + wiring are in place', () => {
    expect(practicalFacts({ suited_age_min: 3, suited_age_max: 8 })).toEqual(['🧒 Ages 3–8']);
    expect(practicalFacts({})).toEqual([]);
    const mig = r('supabase/migrations/20270199_suited_age_range.sql');
    expect(mig).toMatch(/suited_age_min <= suited_age_max/);
    expect(mig).toMatch(/managed_partner_id = partner_id_param/);
    expect(r('src/services/gatherings.js')).toMatch(/suited_age_min, suited_age_max'/);
    for (const f of ['CreateGatheringScreen', 'EditGatheringScreen']) expect(r(`src/screens/${f}.js`)).toMatch(/AgeRangePicker/);
    expect(r('src/screens/BusinessDashboardScreen.js')).toMatch(/setBusinessSuitedAges/);
    expect(r('src/services/intentResolver.js')).toMatch(/askedChildAges/);
  });
  it('age range never restricts joining: no server function reads it', () => {
    const mig = r('supabase/migrations/20270199_suited_age_range.sql');
    expect(mig).not.toMatch(/join_gathering|raise exception 'You must be/);
  });
});
