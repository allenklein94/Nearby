import { learnedAffinities, LEARNED_MIN_WEIGHT } from './learnedAffinity';

jest.mock('../services/supabase', () => {
  const rpc = jest.fn(() => Promise.resolve({ error: null }));
  return { supabase: { rpc, from: jest.fn(), auth: { getUser: jest.fn() } } };
});

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

describe('interests evolve from behavior, transparently (item 95)', () => {
  it('lists affinities once they amount to a deliberate act or three glances, strongest first, at most 5', () => {
    const rows = [{ category: 'Coffee', weight: 9 }, { category: 'Yoga', weight: 2 }, { category: 'Wine', weight: 3 },
      { category: 'A', weight: 4 }, { category: 'B', weight: 5 }, { category: 'C', weight: 6 }, { category: 'D', weight: 7 }];
    const out = learnedAffinities(rows, ['Wine']);
    expect(out.map((a) => a.category)).toEqual(['Coffee', 'D', 'C', 'B', 'A']);
    expect(out.every((a) => a.weight >= LEARNED_MIN_WEIGHT)).toBe(true);
    expect(learnedAffinities(rows, ['Wine']).find((a) => a.category === 'Wine')).toBeUndefined(); // cut by the top-5 cap
    expect(learnedAffinities([{ category: 'Wine', weight: 3 }], ['Wine'])[0].inProfile).toBe(true);
    expect(learnedAffinities(null)).toEqual([]);
  });
  it('a search records only a canonical category from the words, never the words themselves', () => {
    const { supabase } = require('../services/supabase');
    const { recordSearchBehavior } = require('../services/behaviorSignals');
    supabase.rpc.mockClear();
    recordSearchBehavior('cafe near me');
    expect(supabase.rpc).toHaveBeenCalledWith('record_behavior_event', { event_type_param: 'search', entity_type_param: 'search', entity_id_param: null, category_param: 'Coffee' });
    supabase.rpc.mockClear();
    recordSearchBehavior('italian'); // a cuisine: not learned from a search
    recordSearchBehavior('food & drink'); // a whole group: not learned from a search
    recordSearchBehavior('zzqx');
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
  it('the four signals feed the one private behavior store', () => {
    expect(read('screens/GatheringDetailScreen.js')).toMatch(/recordBehaviorEvent\('open', 'gathering'/); // views
    expect(read('screens/GatheringDetailScreen.js')).toMatch(/recordBehaviorEvent\('join', 'gathering'/); // joins
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/recordSearchBehavior\(term\)/); // searches
    expect(read('services/intentResolver.js')).toMatch(/recordSearchBehavior\(typedText\)/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/recordAcceptBehavior\(request\?\.id, request\?\.category\)/); // accepted offers
    expect(read('screens/GroupPlanScreen.js')).toMatch(/recordAcceptBehavior\(/);
  });
  it('Surprise Me asks are not learned as searches (the backstop returns first)', () => {
    const r = read('services/intentResolver.js');
    const body = r.slice(r.indexOf('export async function runIntentSearch'));
    expect(body.indexOf("if (pick) return { outcome: 'pick_for_me'")).toBeLessThan(body.indexOf('recordSearchBehavior(typedText)'));
  });
  it('behavior ranks only: nothing edits profile interests except the person tapping "Add to my interests" in Settings', () => {
    const src = path.join(__dirname, '..');
    const callers = walk(src).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /addLearnedInterestToProfile\(/.test(fs.readFileSync(f, 'utf8')));
    expect(callers.map((f) => path.relative(src, f)).sort()).toEqual(['screens/SettingsScreen.js', 'services/behaviorSignals.js']);
    expect(read('screens/SettingsScreen.js')).toMatch(/onPress=\{\(\) => addLearnedInterestToProfile\(a\.category\)/);
    const mig = read('../supabase/migrations/20270231_behavior_search_accept.sql');
    expect(mig).not.toMatch(/update\s+(public\.)?profiles/i);
    expect(mig).toMatch(/when be\.event_type in \('open', 'search'\) then 1 else 3/);
  });
  it('Settings shows what was learned, with Forget and the explicit add, and says it never changes interests on its own', () => {
    // the wording lives in the Settings ui namespace (localization pass 5); the screen reads it by key
    const s = read('screens/SettingsScreen.js') + JSON.stringify(require('../i18n/ui/settings').default.en);
    expect(s).toContain("t('ui.settings.whatNearbyHasNoticed')");
    expect(s).toContain('What Nearby has noticed');
    expect(s).toContain('It never changes your interests on its own.');
    expect(s).toMatch(/forgetBehaviorCategory\(a\.category\)/);
  });
});

describe('item 157: repeated evidence before personalizing', () => {
  const fs = require('fs');
  const path = require('path');
  it('the bar lives in the one server read (2 separate pieces of evidence), and Settings adds no second bar', () => {
    const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
    const latest = fs.readdirSync(dir).sort().filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('function public.get_my_behavior_categories')).pop();
    const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
    const minEvidence = fs.readdirSync(dir).sort().filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('function public.behavior_min_evidence')).pop();
    expect(sql).toMatch(/having count\(distinct coalesce\(be\.entity_id::text, 'search:' \|\| be\.id::text\)\) >= public\.behavior_min_evidence\(\)/);
    expect(fs.readFileSync(path.join(dir, minEvidence), 'utf8')).toMatch(/behavior_min_evidence\(\)\s*returns integer language sql immutable set search_path to 'public' as \$\$ select 2 \$\$/);
    expect(LEARNED_MIN_WEIGHT).toBe(1);
  });
});
