import { cleanAgeRange, ageRangeLabel, ageFits, askedChildAges, applySuitedAgesToCandidates, AGE_MIN_OPTIONS, AGE_MAX_OPTIONS, AGE_BANDS, ageBandOf } from './suitedAges';
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
    expect(ageRangeLabel(0, 30)).toBe('All ages'); // out-of-range bound dropped, leaving 0+ = the All ages band
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

describe('quick age bands over the same range (owner decision 2026-09-26)', () => {
  const band = (k) => AGE_BANDS.find((b) => b.key === k);
  it('Kids = 0–12, Teens = 13–17, All ages = 0 with no upper end', () => {
    expect([band('kids').min, band('kids').max]).toEqual([0, 12]);
    expect([band('teens').min, band('teens').max]).toEqual([13, 17]);
    expect([band('all_ages').min, band('all_ages').max]).toEqual([0, null]);
    expect(ageRangeLabel(0, 12)).toBe('Kids (up to 12)');
    expect(ageRangeLabel(13, 17)).toBe('Teens (13–17)');
    expect(ageRangeLabel(0, null)).toBe('All ages');
  });
  it('All ages is an explicit declaration, distinct from unset', () => {
    expect(ageBandOf(null, null)).toBeNull();
    expect(ageRangeLabel(null, null)).toBeNull();
    expect(ageBandOf(0, null).key).toBe('all_ages');
    for (const age of [0, 4, 12, 17]) {
      expect(ageFits(0, null, age)).toBe(true);
      expect(ageFits(null, null, age)).toBeNull();
    }
    const out = applySuitedAgesToCandidates([{ ageMin: 0, ageMax: null, score: 0 }, { score: 0 }], [6]);
    expect(out.map((c) => c.score)).toEqual([2, 0]); // declared All ages lifts; unset stays neutral
    expect(out[0].subtitle).toBe('Suited to all ages');
  });
  it('bands are the same min/max pair the existing chips, clean-up and DB CHECK already accept', () => {
    for (const b of AGE_BANDS) {
      expect(cleanAgeRange(b.min, b.max)).toEqual({ min: b.min, max: b.max });
      if (b.min != null) expect(AGE_MIN_OPTIONS).toContain(b.min);
      if (b.max != null) expect(AGE_MAX_OPTIONS).toContain(b.max);
    }
    // no new column or field anywhere: bands live only in this helper and the picker
    const migs = fs.readdirSync(path.join(__dirname, '../../supabase/migrations'));
    for (const f of migs) expect(r(`supabase/migrations/${f}`)).not.toMatch(/age_band/);
    expect(r('src/services/gatherings.js')).not.toMatch(/age_band|ageBand/);
    expect(r('src/services/brandOffers.js')).not.toMatch(/age_band|ageBand/);
  });
  it('exact ranges still work and are never mistaken for a band', () => {
    expect(ageBandOf(3, 8)).toBeNull();
    expect(ageRangeLabel(3, 8)).toBe('Ages 3–8');
    expect(ageBandOf(null, 12)).toBeNull(); // "Up to age 12" is its own exact range, not Kids
    expect(ageRangeLabel(null, 12)).toBe('Up to age 12');
    expect(ageBandOf(13, null)).toBeNull();
    const out = applySuitedAgesToCandidates([{ ageMin: 3, ageMax: 8, score: 0 }, { ageMin: 13, ageMax: 17, score: 0 }, { ageMin: 0, ageMax: 12, score: 0 }], [5]);
    expect(out.map((c) => c.score)).toEqual([2, -2, 2]);
    expect(out[0].subtitle).toBe('Suited to ages 3–8');
    expect(out[2].subtitle).toBe('Suited to kids up to 12');
  });
  it('the picker offers the bands AND keeps the exact From / To chips one tap away', () => {
    const src = r('src/components/AgeRangePicker.js');
    expect(src).toMatch(/AGE_BANDS\.map/);
    expect(src).toMatch(/AGE_MIN_OPTIONS\.map/);
    expect(src).toMatch(/AGE_MAX_OPTIONS\.map/);
    expect(src).toMatch(/Exact ages/);
    expect(src).toMatch(/set\(null, null\)/); // tapping the selected band returns to not said
  });
  it('no age is inferred or verified: only stated numeric ages are read from an ask', () => {
    expect(askedChildAges('dinner with my kids')).toEqual([]);
    expect(askedChildAges('something for my teenager')).toEqual([]);
    expect(askedChildAges('family friendly bowling')).toEqual([]);
    const src = r('src/utils/suitedAges.js');
    expect(src).not.toMatch(/interest_tag|category|attributes|photo|review|description/);
  });
  it('gathering ages never enforce join or invite eligibility', () => {
    const dir = path.join(__dirname, '../../supabase/migrations');
    const gated = /function\s+public\.(join_gathering|approve_gathering_interest|_promote_from_waitlist|invite_friend_to_gathering|send_social_invite|set_gathering_interested)\s*\(/;
    for (const f of fs.readdirSync(dir)) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!/suited_age/.test(sql)) continue;
      expect(sql).not.toMatch(gated); // no file that touches suited ages defines a join/invite function
      expect(sql).not.toMatch(/gatherings[\s\S]{0,200}suited_age[\s\S]{0,200}raise exception/);
    }
    for (const f of ['CreateGatheringScreen', 'EditGatheringScreen']) {
      expect(r(`src/screens/${f}.js`)).toMatch(/AgeRangePicker/);
    }
    expect(r('src/components/AgeRangePicker.js')).toMatch(/doesn't stop anyone from joining/);
  });
  it('No children / 21+ compatibility is unchanged: any declared range (bands included) conflicts, decided server-side', () => {
    const mig = r('supabase/migrations/20270226_setting_conflicts_structured.sql');
    expect(mig).toMatch(/bp\.suited_age_min is not null or bp\.suited_age_max is not null then v := v \|\| public\._setting_conflict_message\(r, 'Suited ages'/);
    // matching never hides a business by its suited ages: the one compatibility rule does not read them
    const dir = path.join(__dirname, '../../supabase/migrations');
    const latest = fs.readdirSync(dir).sort().filter((f) => /function public\._business_declines\(/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop();
    const body = fs.readFileSync(path.join(dir, latest), 'utf8').split(/function public\._business_declines\(/)[1].split(/\$\$;/)[0];
    expect(body).not.toMatch(/suited_age/);
  });
});
