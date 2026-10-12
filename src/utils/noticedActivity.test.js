// Owner item 54: "You've been into X lately." The server rule is proven by journey noticedActivity; here: the helpers, the
// once-per-category day rule, the locked wording (item 60 stands) and the Home/Settings wiring.
const fs = require('fs');
const path = require('path');
const { noticedCategories, takeNoticedMoment, NOTICED_SEEN_KEY, NOTICED_MAX_NAMED } = require('./noticedActivity');

function memoryStorage(initial = {}) {
  const m = { ...initial };
  return { m, getItem: async (k) => (k in m ? m[k] : null), setItem: async (k, v) => { m[k] = v; } };
}

describe('noticedCategories', () => {
  it('names at most two, in the server order, never empty or repeated', () => {
    expect(NOTICED_MAX_NAMED).toBe(2);
    expect(noticedCategories([{ category: 'Hiking' }, { category: 'Hiking' }, { category: '' }, { category: 'Pickleball' }, { category: 'Yoga' }]))
      .toEqual(['Hiking', 'Pickleball']);
    expect(noticedCategories(null)).toEqual([]);
    expect(noticedCategories([])).toEqual([]);
  });
});

describe('takeNoticedMoment: occasionally, never nagging', () => {
  it('a new category shows on the day it first qualifies, for the rest of that day, then never again', async () => {
    const s = memoryStorage();
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: '2026-10-12' }, s)).toEqual(['Hiking']);
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: '2026-10-12' }, s)).toEqual(['Hiking']);
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: '2026-10-13' }, s)).toEqual([]);
    expect(JSON.parse(s.m[NOTICED_SEEN_KEY])).toEqual({ userId: 'u', seen: { Hiking: '2026-10-12' } });
  });
  it('a later new category brings the line back, naming only the new one', async () => {
    const s = memoryStorage();
    await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: '2026-10-12' }, s);
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking', 'Pickleball'], dayKey: '2026-10-20' }, s)).toEqual(['Pickleball']);
  });
  it('nothing qualifying, no account, or broken storage = no line', async () => {
    expect(await takeNoticedMoment({ userId: 'u', categories: [], dayKey: 'd' }, memoryStorage())).toEqual([]);
    expect(await takeNoticedMoment({ userId: null, categories: ['Hiking'], dayKey: 'd' }, memoryStorage())).toEqual([]);
    const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => {} };
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: 'd' }, broken)).toEqual([]);
    const full = memoryStorage();
    full.setItem = async () => { throw new Error('full'); };
    expect(await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: 'd' }, full)).toEqual([]);
  });
  it('another account on the device starts fresh', async () => {
    const s = memoryStorage();
    await takeNoticedMoment({ userId: 'u', categories: ['Hiking'], dayKey: '2026-10-12' }, s);
    expect(await takeNoticedMoment({ userId: 'v', categories: ['Hiking'], dayKey: '2026-10-13' }, s)).toEqual(['Hiking']);
  });
});

describe('wording (owner item 54, LOCKED; item 60 stands)', () => {
  const home = require('../i18n/ui/home').default;
  it('English is exactly the approved behavior wording', () => {
    expect(home.en.noticedLately).toBe("You've been into {categories} lately.");
    expect(home.en.noticedLink).toBe('See what Nearby noticed →');
  });
  it('no language claims a preference or a trait', () => {
    for (const [lang, block] of Object.entries(home)) {
      const all = [block.noticedLately, block.noticedLatelyA11y, block.noticedLink];
      expect(all.every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
      expect(block.noticedLately).toContain('{categories}');
      if (lang === 'en') for (const x of all) expect(x).not.toMatch(/you like|seem to|enjoy|learning what/i);
    }
  });
});

describe('wiring', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const homeSrc = read('screens/HomeScreen.js');
  it('Home names only what the server returned, in the person\'s language, and goes to Settings > What Nearby has noticed', () => {
    expect(homeSrc).toMatch(/takeNoticedMoment\(\{ userId: myId, categories: noticedCategories\(rows\), dayKey: localDayKey\(\) \}, AsyncStorage\)/);
    expect(homeSrc).toMatch(/noticed\.length > 0 &&/);
    expect(homeSrc).toMatch(/joinAnd\(noticed\.map\(\(c\) => categoryName\(c, language\)\)\)/);
    expect(homeSrc).toMatch(/navigation\.navigate\('Settings', \{ scrollToNoticed: Date\.now\(\) \}\)/);
    expect(read('screens/SettingsScreen.js')).toMatch(/route\?\.params\?\.scrollToNoticed/);
  });
  it('the line sits inside Picked For You (it explains the picks), after its cards', () => {
    const picked = homeSrc.indexOf('{(attention.shown > 0) && (');
    const line = homeSrc.indexOf('{noticed.length > 0 && (');
    const plans = homeSrc.indexOf('{(homePlans.total > 0) && (');
    expect(picked).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(homeSrc.indexOf('{attention.items.map(renderAttentionEntry)}'));
    expect(line).toBeLessThan(plans);
  });
  it('Home never changes the profile from it (item 95: only the Settings tap adds an interest), and never animates it', () => {
    expect(homeSrc).not.toMatch(/addLearnedInterestToProfile|forgetBehaviorCategory/);
    const block = homeSrc.slice(homeSrc.indexOf('{noticed.length > 0 && ('), homeSrc.indexOf('{(homePlans.total > 0) && ('));
    expect(block).not.toMatch(/Animated|motion|playHaptic/);
  });
  it('the service reads the one server rule', () => {
    expect(read('services/behaviorSignals.js')).toMatch(/rpc\('get_my_noticed_categories'\)/);
  });
  it('the server rule counts only doing, lately, on 2+ separate things, and never reads profile details beyond declared interests', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270302_noticed_activity.sql'), 'utf8');
    const fn = sql.slice(sql.indexOf('create or replace function'));
    expect(fn).toMatch(/event_type in \('join', 'create', 'accept', 'redeem'\)/);
    expect(fn).toMatch(/interval '30 days'/);
    expect(fn).toMatch(/did_count >= public\.behavior_min_evidence\(\)/);
    expect(fn).toMatch(/_category_never_learned/);
    expect(fn).toMatch(/limit 2/);
    expect(fn.match(/p\.\w+/g).filter((x) => !['p.id', 'p.interests', 'p.monthly_interests'].includes(x))).toEqual([]);
    expect(sql).toMatch(/revoke all on function public\.get_my_noticed_categories\(\) from public, anon/);
  });
});
