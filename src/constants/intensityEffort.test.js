const fs = require('fs');
const path = require('path');
const { INTENSITY_LEVELS, EFFORT_KEYS, intensityOfHostEnergy, intensityFromText, effortFromText, intensityFit, effortFit, applyIntensityToCandidates, applyEffortToCandidates, energiesWithoutIntensity } = require('./intensityEffort');
const { practicalFacts } = require('../utils/gatheringPractical');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('vocabulary; intensity reuses the existing Energy scale', () => {
  it('the owner\'s values; effort equals the database CHECK', () => {
    expect(INTENSITY_LEVELS.map((i) => i.label)).toEqual(['Low-key', 'Moderate', 'High-energy']);
    const sql = read('supabase/migrations/20270207_gathering_effort_level.sql');
    expect([...new Set([...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))].sort()).toEqual([...EFFORT_KEYS].sort());
    expect(sql).not.toMatch(/add column[^;]*intensity/i);
  });
  it('intensity comes only from the host\'s declared 1-5 energy', () => {
    expect([1, 2, 3, 4, 5].map(intensityOfHostEnergy)).toEqual(['low_key', 'low_key', 'moderate', 'high_energy', 'high_energy']);
    for (const v of [null, undefined, 0, 6, 2.5, '3']) expect(intensityOfHostEnergy(v)).toBeNull();
  });
});

describe('explicit host declarations', () => {
  it('effort is shown only when declared, after skill level', () => {
    expect(practicalFacts({ format: 'class', skill_level: 'beginner', effort_level: 'light' }).slice(0, 3)).toEqual(['🎓 Class', '🎯 Beginner', '💪 Light effort']);
    expect(practicalFacts({ interest_tag: 'Hiking' })).toEqual([]);
  });
  it('asked in Create/Edit only where skill is relevant; not saved elsewhere', () => {
    for (const f of ['src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js']) {
      const s = read(f);
      expect(s).toContain('EFFORT_OPTIONS.map');
      expect(s).toMatch(/effortLevel: skillOptionsFor\(skillContext\(/);
      expect(s).not.toMatch(/Intensity/);
    }
    expect(read('src/services/gatherings.js')).toMatch(/skill_level, effort_level, features/);
  });
});

describe('typed-request recognition (activity word next to the qualifier)', () => {
  it('the owner\'s examples', () => {
    expect(effortFromText('an easy hike')).toEqual(['light']);
    expect(effortFromText('easy workout tomorrow')).toEqual(['light']);
    expect(intensityFromText('a high intensity workout')).toEqual(['high_energy']);
    expect(intensityFromText('a low-key game of volleyball')).toEqual(['low_key']);
    expect(effortFromText('a challenging climb')).toEqual(['challenging']);
    expect(intensityFromText('HIIT tonight')).toEqual(['high_energy']);
    expect(effortFromText('a moderate hike')).toEqual(['moderate']);
    expect(resolveAsk('an easy hike this weekend').effort).toEqual(['light']);
  });
  it('negative guards: no activity word, no attribute', () => {
    for (const t of ['an easy dinner', 'a high-energy restaurant', 'a low-key birthday', 'a hard decision', 'something easy tonight', 'a tough week', 'light snacks', 'a chill bar', 'intense conversation']) {
      expect([t, intensityFromText(t), effortFromText(t)]).toEqual([t, [], []]);
      expect([t, resolveAsk(t).intensity, resolveAsk(t).effort]).toEqual([t, [], []]);
    }
  });
});

describe('compatibility and ranking', () => {
  it('same = up, opposite ends = down modestly, moderate vs an end = neutral, unknown = neutral', () => {
    const e = (declared, asked) => effortFit({ effortLevel: declared }, [asked]).delta;
    expect([e('light', 'light'), e('challenging', 'light'), e('moderate', 'light'), e(undefined, 'light'), e('light', 'moderate')]).toEqual([2, -1, 0, 0, 0]);
    const i = (energy, asked) => intensityFit({ hostEnergy: energy }, [asked]).delta;
    expect([i(1, 'low_key'), i(5, 'low_key'), i(3, 'low_key'), i(null, 'low_key'), i(3, 'moderate')]).toEqual([2, -1, 0, 0, 2]);
  });
  it('nothing is removed; no ask = same array', () => {
    const cands = [{ id: 'a', effortLevel: 'challenging', hostEnergy: 5, score: 0 }, { id: 'b', score: 0 }];
    const out = applyEffortToCandidates(applyIntensityToCandidates(cands, ['low_key']), ['light']);
    expect(out.map((c) => [c.id, c.score])).toEqual([['a', -2], ['b', 0]]);
    expect(applyEffortToCandidates(cands, [])).toBe(cands);
    expect(applyIntensityToCandidates(cands, [])).toBe(cands);
  });
  it('the host energy scale is never counted twice (energy pass yields to the intensity pass)', () => {
    expect(energiesWithoutIntensity(['low_key', 'romantic'], ['low_key'])).toEqual(['romantic']);
    expect(energiesWithoutIntensity(['low_key'], [])).toEqual(['low_key']);
    expect(read('src/services/intentResolver.js')).toContain('energiesWithoutIntensity(');
  });
});

describe('scope: typed requests only, nothing to businesses', () => {
  it('not in Home/Discover/Gatherings feeds', () => {
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/GatheringsScreen.js', 'src/services/homeDashboard.js']) {
      if (fs.existsSync(path.join(ROOT, f))) expect([f, /intensityEffort|effort_level|effortLevel/.test(read(f))]).toEqual([f, false]);
    }
  });
  it('no business payload, posting or request carries them', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    const last = migs.filter((m) => /function\s+public\.get_business_opportunities\b/i.test(read(`supabase/migrations/${m}`))).pop();
    const body = read(`supabase/migrations/${last}`);
    expect(body).not.toMatch(/effort_level|energy_level|skill_level/);
    for (const m of migs.filter((x) => x >= '20270207')) {
      expect([m, /alter table public\.(business_\w+|brand_\w+)[^;]*(effort|intensity)/i.test(read(`supabase/migrations/${m}`))]).toEqual([m, false]);
    }
    expect(read('src/constants/intensityEffort.js').replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
});
