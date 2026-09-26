const fs = require('fs');
const path = require('path');
const { SOCIAL_CONTEXTS, socialSignalsFromText, isValidSocialSignals, gatheringSocialFacts, socialFit, applySocialToCandidates } = require('./socialContext');
const { resolveAsk } = require('../utils/askResolver');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const sig = (t) => { const s = socialSignalsFromText(t); return [s.social_context, s.meet_new_people]; };

describe('the contract', () => {
  it('four mutually exclusive scale values, an independent meet flag, null = not said', () => {
    expect(SOCIAL_CONTEXTS).toEqual(['solo', 'one_on_one', 'small_group', 'group']);
    expect(socialSignalsFromText('')).toEqual({ social_context: null, meet_new_people: null, source: { social_context: null, meet_new_people: null } });
    for (const v of [...SOCIAL_CONTEXTS, null]) for (const m of [true, false, null]) expect(isValidSocialSignals({ social_context: v, meet_new_people: m })).toBe(true);
    for (const bad of [{ social_context: 'friends', meet_new_people: null }, { social_context: 'family', meet_new_people: null }, { social_context: null, meet_new_people: 'yes' }, { social_context: 'date', meet_new_people: null }, null]) {
      expect(isValidSocialSignals(bad)).toBe(false);
    }
  });
  it('invalid signals change nothing', () => {
    const cands = [{ type: 'gathering', id: 'a', partyType: 'groups', score: 1 }];
    expect(applySocialToCandidates(cands, { social_context: 'friends', meet_new_people: null })).toBe(cands);
  });
  it('internal source marker: explicit vs normalized vs unknown', () => {
    expect(socialSignalsFromText('a small group hike').source.social_context).toBe('explicit');
    expect(socialSignalsFromText('pickleball with a few friends').source.social_context).toBe('normalized');
    expect(socialSignalsFromText('dinner tonight').source).toEqual({ social_context: null, meet_new_people: null });
  });
});

describe('explicit social language', () => {
  it("the owner's examples", () => {
    expect(sig('solo yoga')).toEqual(['solo', null]);
    expect(sig('coffee with one friend')).toEqual(['one_on_one', null]);
    expect(sig('coffee with my friend')).toEqual(['one_on_one', null]);
    expect(sig('casual pickleball with a few friends tonight')).toEqual(['small_group', null]);
    expect(sig('big group hike')).toEqual(['group', null]);
    expect(sig('I want to meet new people tonight')).toEqual([null, true]);
    expect(sig('a small group hike where I can meet new people')).toEqual(['small_group', true]);
    expect(sig("big group and I don't want to meet strangers")).toEqual(['group', false]);
    expect(resolveAsk('pickleball with a few friends tonight').social.social_context).toBe('small_group');
  });
  it('counted forms follow the headcount', () => {
    expect(sig('hike with two friends')[0]).toBe('small_group');
    expect(sig('a group of 12 for soccer')[0]).toBe('group');
    expect(sig('a group of four')[0]).toBe('small_group');
    expect(sig('one on one tennis')[0]).toBe('one_on_one');
    expect(sig('just me and one other person')[0]).toBe('one_on_one');
  });
});

describe('ambiguous language declares nothing', () => {
  it('negative guards', () => {
    for (const t of ['something fun tonight', 'dinner tonight', 'a table for a party of 6', 'a family-friendly afternoon', 'date night', 'dinner with friends', 'drinks with my friends and their partners',
      "I don't want to go alone", 'just me and my wife', 'coffee with my friend and her sister', 'a family day out']) {
      expect([t, sig(t)]).toEqual([t, [null, null]]);
    }
    expect(sig('not here to meet people')).toEqual([null, null]);
    for (const t of ['a table for a party of 2', 'dinner for 2', 'reservation for two']) expect([t, sig(t)]).toEqual([t, [null, null]]);
  });
  it('family/date/friends never become a social context value', () => {
    for (const t of ['with my family', 'on a date', 'with friends', 'with coworkers']) expect(SOCIAL_CONTEXTS).not.toContain(socialSignalsFromText(t).social_context ?? 'x');
  });
});

describe('matching existing gathering fields (nothing stored)', () => {
  it('party_type, capacity and group_size_feel; 3 is neither; conflicts cancel', () => {
    const f = (c) => [...gatheringSocialFacts(c).contexts];
    expect(f({ partyType: 'solo' })).toEqual(['solo']);
    expect(f({ capacity: 1 })).toEqual(['one_on_one']);
    expect(f({ capacity: 2 })).toEqual([]);
    expect([1, 2, 3, 4, 5].map((n) => f({ groupSizeFeel: n }))).toEqual([['small_group'], ['small_group'], [], ['group'], ['group']]);
    expect(f({ partyType: 'groups' })).toEqual(['group']);
    expect(f({ capacity: 1, groupSizeFeel: 5 })).toEqual([]);
    // capacity counts guests (the host is never a row): capacity 1 = two people = one-on-one, never solo; an intimate feel supports it
    expect(f({ capacity: 1, groupSizeFeel: 1 })).toEqual(['one_on_one']);
    expect(f({ capacity: 1, groupSizeFeel: 2 })).toEqual(['one_on_one']);
    expect(f({ capacity: 1, groupSizeFeel: 2, partyType: 'groups' })).toEqual([]);
    expect(f({ capacity: 2, groupSizeFeel: 2 })).toEqual(['small_group']);
    for (const c of [1, 2]) { expect(f({ capacity: c })).not.toContain('solo'); expect(gatheringSocialFacts({ capacity: c }).meetNewPeople).toBeNull(); }
    expect(gatheringSocialFacts({ partyType: 'new_people' }).meetNewPeople).toBe(true);
    expect(gatheringSocialFacts({ partyType: 'friends' }).meetNewPeople).toBeNull();
  });
});

describe('ranking only', () => {
  const g = (o) => ({ type: 'gathering', score: 0, ...o });
  const d = (c, text, opts) => socialFit(g(c), socialSignalsFromText(text), opts).delta;
  it('fit up, clear mismatch down modestly, unknown neutral on either side', () => {
    expect(d({ groupSizeFeel: 2 }, 'with a few friends')).toBe(2);
    expect(d({ groupSizeFeel: 5 }, 'with a few friends')).toBe(-1);
    expect(d({ groupSizeFeel: 3 }, 'with a few friends')).toBe(0);
    expect(d({}, 'with a few friends')).toBe(0);
    expect(d({ groupSizeFeel: 2 }, 'dinner tonight')).toBe(0);
    expect(d({ capacity: 1 }, 'big group hike')).toBe(-1);
    expect(d({ capacity: 1 }, 'solo yoga')).toBe(0);
    expect(d({ partyType: 'new_people' }, 'meet new people')).toBe(2);
    expect(d({ partyType: 'new_people' }, "I don't want to meet strangers")).toBe(-1);
    expect(d({ partyType: 'friends' }, 'meet new people')).toBe(0);
  });
  it('independent signals add up', () => {
    expect(d({ groupSizeFeel: 1, partyType: 'new_people' }, 'a small group where I can meet new people')).toBe(4);
  });
  it('never double-counts the existing party-type match', () => {
    expect(d({ partyType: 'new_people' }, 'meet new people', { partyType: 'new_people' })).toBe(0);
    expect(d({ partyType: 'solo' }, 'solo yoga', { partyType: 'solo' })).toBe(0);
    expect(d({ partyType: 'solo' }, 'solo yoga', { partyType: null })).toBe(2);
  });
  it('nothing removed, nothing added, only gatherings touched, no signal = same array', () => {
    const cands = [g({ id: 'a', groupSizeFeel: 5 }), g({ id: 'b' }), { type: 'business_availability', id: 'c', score: 0, partyType: 'new_people' }, { type: 'community', id: 'd', score: 0 }];
    const out = applySocialToCandidates(cands, socialSignalsFromText('a few friends, meet new people'));
    expect(out.map((c) => [c.id, c.score])).toEqual([['a', -1], ['b', 0], ['c', 0], ['d', 0]]);
    expect(applySocialToCandidates(cands, socialSignalsFromText('dinner tonight'))).toBe(cands);
  });
});

describe('scope and privacy boundary', () => {
  it('no new storage: no social_context / meet_new_people column in any migration', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    for (const f of fs.readdirSync(dir)) expect([f, /add\s+column[^;]*(social_context|meet_new_people)/i.test(fs.readFileSync(path.join(dir, f), 'utf8'))]).toEqual([f, false]);
    for (const f of ['src/services/gatherings.js', 'src/screens/CreateGatheringScreen.js', 'src/screens/EditGatheringScreen.js']) expect(read(f)).not.toMatch(/social_context|meet_new_people|socialContext/);
  });
  it('wired only into the typed-ask resolver', () => {
    expect(read('src/services/intentResolver.js')).toContain('applySocialToCandidates(deduped, socialSignalsFromText(rawText)');
    for (const f of ['src/screens/HomeScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/GatheringsScreen.js', 'src/services/homeDashboard.js', 'src/services/homeRecommendations.js',
      'src/screens/BusinessDashboardScreen.js', 'src/services/businessFulfillment.js', 'src/services/notifications.js', 'src/services/friendDiscovery.js', 'src/utils/gatheringPractical.js']) {
      expect([f, /socialContext|socialSignalsFromText|applySocialToCandidates/.test(read(f))]).toEqual([f, false]);
    }
  });
  it('never reaches a business payload', () => {
    const dir = path.join(ROOT, 'supabase');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(dir).filter((f) => /\.(sql|ts)$/.test(f))) expect([f, /social_context|meet_new_people/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});
